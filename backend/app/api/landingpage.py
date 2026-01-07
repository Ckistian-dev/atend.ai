# c:\Users\sirle\OneDrive\Área de Trabalho\Sites\AtendAI\backend\app\api\landingpage.py

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.database import get_db
from app.db import models, schemas
from app.api import dependencies
from app.services.gemini_service import GeminiService, get_gemini_service
from app.crud import crud_config, crud_atendimento

logger = logging.getLogger(__name__)
router = APIRouter()

class LandingPageRequest(BaseModel):
    whatsapp: str
    company_description: str


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
        # 1. Gerar Persona com IA
        logger.info(f"Gerando persona para usuário {current_user.id} via Landing Page.")
        generated_prompt = await gemini_service.generate_persona_prompt(
            company_description=payload.company_description,
            db=db,
            user=current_user
        )

        # 2. Criar Configuração (Persona) no Banco
        config_in = schemas.ConfigCreate(
            nome_config=f"Persona Landing Page - {payload.whatsapp}",
            prompt=generated_prompt
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
