# c:\Users\sirle\OneDrive\Área de Trabalho\Sites\AtendAI\backend\app\api\landingpage.py

import logging
from typing import Dict, List, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.database import get_db
from app.db import models, schemas
from app.api import dependencies
from app.services.gemini_service import GeminiService, get_gemini_service
from app.crud import crud_config, crud_atendimento
from app.services.google_sheets_service import GoogleSheetsService

logger = logging.getLogger(__name__)
router = APIRouter()

class LandingPageRequest(BaseModel):
    whatsapp: str
    company_description: str

def _format_sheet_data_to_string(sheet_data: Dict[str, List[Dict[str, Any]]]) -> str:
    """Converte dados da planilha (JSON) em string para o prompt."""
    buffer = []
    for sheet_name, rows in sheet_data.items():
        if not rows: continue
        headers = list(rows[0].keys())
        buffer.append(f"# {sheet_name}")
        buffer.append("|".join(headers))
        for row in rows:
            values = [str(row.get(h, "") or "").strip() for h in headers]
            buffer.append("|".join(values))
        buffer.append("\n")
    return "\n".join(buffer)

@router.post("/setup", status_code=status.HTTP_200_OK, summary="Configuração Automática via Landing Page")
async def setup_from_landing_page(
    payload: LandingPageRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user),
    gemini_service: GeminiService = Depends(get_gemini_service)
):
    """
    Endpoint para integração com Landing Page.
    1. Gera uma persona (System Prompt) com base na descrição e instruções.
    2. Salva essa persona como uma Configuração do usuário.
    3. Cria (ou atualiza) um Atendimento para o WhatsApp fornecido, atribuindo a nova persona.
    """
    try:
        # 0. Buscar Configuração Base "Configuração base Teste Grátis"
        # Tenta encontrar uma configuração com este nome exato.
        stmt_base = select(models.Config).where(models.Config.nome_config == "Configuração base Teste Grátis").limit(1)
        result_base = await db.execute(stmt_base)
        base_config = result_base.scalars().first()

        base_instruction = None
        rag_instruction = None
        spreadsheet_id_for_new_config = None
        config_copy_data = {}

        if base_config:
            logger.info(f"Configuração base encontrada: {base_config.id}")
            
            # Copiar configurações (Notificação, Agendamento, Drive)
            config_copy_data = {
                "notification_active": base_config.notification_active,
                "notification_destination": base_config.notification_destination,
                "available_hours": base_config.available_hours,
                "is_calendar_active": base_config.is_calendar_active,
                "google_calendar_credentials": base_config.google_calendar_credentials,
                "drive_id": base_config.drive_id
            }

            # Lógica das Planilhas
            sheets_service = GoogleSheetsService()
            
            # A planilha de SYSTEM da base serve para criar o prompt (Instrução do Gerador)
            if base_config.spreadsheet_id:
                try:
                    sheet_data = await sheets_service.get_sheet_as_json(base_config.spreadsheet_id)
                    base_instruction = _format_sheet_data_to_string(sheet_data)
                except Exception as e:
                    logger.error(f"Erro ao ler planilha de sistema da base: {e}")

            # A planilha de RAG da base será o Prompt Fixo (System Sheet) da nova config
            if base_config.spreadsheet_rag_id:
                spreadsheet_id_for_new_config = base_config.spreadsheet_rag_id
                try:
                    rag_sheet_data = await sheets_service.get_sheet_as_json(base_config.spreadsheet_rag_id)
                    rag_instruction = _format_sheet_data_to_string(rag_sheet_data)
                except Exception as e:
                    logger.error(f"Erro ao ler planilha de RAG da base para fixed prompt: {e}")

        # 1. Gerar Persona com IA
        logger.info(f"Gerando persona para usuário {current_user.id} via Landing Page.")
        generated_prompt = await gemini_service.generate_persona_prompt(
            company_description=payload.company_description,
            db=db,
            user=current_user,
            base_instruction=base_instruction,
            fixed_instruction=rag_instruction
        )

        # 2. Criar Configuração (Persona) no Banco
        config_in = schemas.ConfigCreate(
            nome_config=f"Persona Landing Page - {payload.whatsapp}",
            prompt=generated_prompt,
            spreadsheet_id=spreadsheet_id_for_new_config, # Base RAG ID -> New System ID
            **config_copy_data # Aplica configurações copiadas
        )
        # create_config já faz o commit
        new_config = await crud_config.create_config(db=db, config=config_in, user_id=current_user.id)

        # 3. Criar ou Atualizar Atendimento
        # Verifica se já existe um atendimento para este número e usuário
        stmt = select(models.Atendimento).where(
            models.Atendimento.whatsapp == payload.whatsapp,
            models.Atendimento.user_id == current_user.id
        )
        result = await db.execute(stmt)
        existing_atendimento = result.scalars().first()

        if existing_atendimento:
            # Se já existe, atualiza a persona ativa
            update_data = schemas.AtendimentoUpdate(active_persona_id=new_config.id)
            await crud_atendimento.update_atendimento(db, existing_atendimento, update_data)
            await db.commit()
            logger.info(f"Atendimento {existing_atendimento.id} atualizado com nova persona.")
        else:
            # Se não existe, cria um novo
            atendimento_in = schemas.AtendimentoCreate(
                whatsapp=payload.whatsapp,
                status="Novo Atendimento",
                active_persona_id=new_config.id,
                nome_contato="Lead Landing Page"
            )
            # create_atendimento faz flush, precisamos confirmar a transação
            await crud_atendimento.create_atendimento(db, atendimento_in, current_user.id)
            await db.commit()
            logger.info(f"Novo atendimento criado para {payload.whatsapp} .")

        return {"message": "Configuração realizada com sucesso", "persona_id": new_config.id}

    except Exception as e:
        logger.error(f"Erro no setup da landing page: {e}", exc_info=True)
        # Rollback em caso de erro para evitar dados inconsistentes
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao processar solicitação: {str(e)}")
