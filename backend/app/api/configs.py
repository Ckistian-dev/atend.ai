# app/api/configs.py

# 1. Importações nativas/padrão do Python
import logging
from typing import List, Dict, Any, Optional

# 2. Importações de terceiros
from fastapi import APIRouter, Depends, HTTPException, status, Body, BackgroundTasks, Request
from sqlalchemy.ext.asyncio import AsyncSession

# 3. Importações locais do projeto
from app.api import dependencies
from app.db import models, schemas
from app.db.database import get_db
from app.services.gemini_service import GeminiService, get_gemini_service
from app.services.config_service import (
    ConfigService,
    ConfigNotFoundError,
    ConfigValidationError,
    SITUATIONS
)

logger = logging.getLogger(__name__)
router = APIRouter()


# Cria uma nova configuração de persona para a empresa
@router.post("/", response_model=schemas.Config, status_code=status.HTTP_201_CREATED, summary="Criar uma nova Configuração")
async def create_config(
    config: schemas.ConfigCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Cria uma nova configuração de persona para a empresa do usuário logado.
    """
    company_id = current_user.company_id or 0
    return await ConfigService.create_config(db=db, config=config, company_id=company_id)


# Lista todas as configurações de persona ativas da empresa
@router.get("/", response_model=List[schemas.Config], summary="Listar todas as Configurações")
async def read_configs(
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Lista todas as configurações registradas para a empresa do usuário atual.
    """
    company_id = current_user.company_id or 0
    return await ConfigService.get_configs_by_user(db=db, company_id=company_id)


# Atualiza os dados de uma configuração de persona existente
@router.put("/{config_id}", response_model=schemas.Config, summary="Atualizar uma Configuração")
async def update_config(
    config_id: int,
    config: schemas.ConfigUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Atualiza as informações de uma configuração de persona ativa.
    """
    company_id = current_user.company_id or 0
    try:
        return await ConfigService.update_config(
            db=db,
            company_id=company_id,
            config_id=config_id,
            config_in=config
        )
    except ConfigNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


# Apaga uma configuração de persona que não seja a padrão
@router.delete("/{config_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Apagar uma Configuração")
async def delete_config(
    config_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Remove uma configuração de persona contanto que não esteja definida como padrão da empresa.
    """
    company_id = current_user.company_id or 0
    try:
        await ConfigService.delete_config(
            db=db,
            company=current_user.company,
            company_id=company_id,
            config_id=config_id
        )
        return
    except ConfigNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ConfigValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))


# Define a configuração indicada como a persona padrão da empresa
@router.post("/{config_id}/set-default", summary="Definir uma configuração como persona padrão da empresa")
async def set_default_persona(
    config_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Define a configuração indicada como a persona padrão da empresa do usuário logado.
    """
    company_id = current_user.company_id or 0
    try:
        return await ConfigService.set_default_persona(db=db, company_id=company_id, config_id=config_id)
    except ConfigNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


# Gera a URL de autenticação do Google Drive para provisionamento de recursos
@router.get("/google-auth-url", summary="URL de Autenticação do Google para Provisionamento")
async def get_google_auth_url(redirect_uri: str):
    """
    Gera a URL OAuth para que o usuário autorize o acesso à sua conta do Google Drive/Sheets.
    """
    url = await ConfigService.get_google_auth_url(redirect_uri)
    return {"authorization_url": url}


# Provisiona recursos no Google Drive (planilhas ou pastas) para a persona
@router.post("/provision", summary="Provisionar nova Planilha/Pasta usando Login do Google")
async def provision_google_resource(
    payload: schemas.ProvisionWithCodePayload = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Realiza o intercâmbio de tokens OAuth temporários e cria cópias ou pastas exclusivas no Google Drive.
    """
    company_id = current_user.company_id or 0
    try:
        return await ConfigService.provision_google_resource(db=db, company_id=company_id, payload=payload)
    except ConfigNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Sincroniza a planilha de instruções (sistema ou RAG) com o banco de dados
@router.post("/sync_sheet", summary="Sincronizar planilha do Google Sheets com uma Configuração")
async def sync_google_sheet(
    payload: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Sincroniza os dados da planilha Google Sheets vinculada e gera os embeddings apropriados.
    """
    try:
        config_id = int(payload.get("config_id"))
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="config_id é obrigatório e deve ser um número inteiro.")

    spreadsheet_id = payload.get("spreadsheet_id")
    sync_type = payload.get("type", "system")
    company_id = current_user.company_id or 0

    try:
        itens_processados = await ConfigService.sync_google_sheet(
            db=db,
            company_id=company_id,
            config_id=config_id,
            spreadsheet_id=spreadsheet_id,
            sync_type=sync_type
        )
        return {
            "message": f"Sincronização ({sync_type.upper()}) concluída com sucesso!", 
            "sheets_found": itens_processados,
        }
    except ConfigNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ConfigValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Falha ao processar a planilha: {str(e)}")


# Sincroniza a pasta do Google Drive indexando arquivos para o RAG
@router.post("/sync_drive", summary="Sincronizar pasta do Google Drive")
async def sync_google_drive(
    payload: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Sincroniza os arquivos contidos em uma pasta do Google Drive gerando embeddings de busca para RAG.
    """
    try:
        config_id = int(payload.get("config_id"))
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="config_id é obrigatório e deve ser um número inteiro.")

    folder_id = payload.get("drive_id")
    company_id = current_user.company_id or 0

    try:
        itens_processados = await ConfigService.sync_google_drive(
            db=db,
            company_id=company_id,
            config_id=config_id,
            folder_id=folder_id
        )
        return {
            "message": "Sincronização do Google Drive concluída com sucesso!",
            "files_found": itens_processados,
        }
    except ConfigNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ConfigValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Falha ao processar o Drive: {str(e)}")


# Recebe notificações de alteração de planilhas/pastas no Drive via webhook
@router.post("/drive-webhook", summary="Webhook para receber notificações de alteração do Google Drive/Sheets")
async def drive_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    """
    Webhook que recebe alterações de arquivos e pastas integrados ao Google Drive.
    """
    channel_id = request.headers.get("x-goog-channel-id")
    resource_state = request.headers.get("x-goog-resource-state")
    channel_token = request.headers.get("x-goog-channel-token")

    query_params = dict(request.query_params)
    body_json = None
    try:
        body_json = await request.json()
    except Exception:
        pass

    try:
        result = await ConfigService.process_drive_webhook(
            db=db,
            channel_id=channel_id,
            resource_state=resource_state,
            channel_token=channel_token,
            background_tasks=background_tasks,
            query_params=query_params,
            body_json=body_json
        )
        return result
    except Exception as e:
        logger.error(f"Erro ao processar webhook do Drive: {e}", exc_info=True)
        return {"status": "error", "detail": str(e)}


# Lista as situações padrão de atendimento do sistema
@router.get("/situations", response_model=List[Dict[str, str]], summary="Listar situações padrão")
async def get_situations():
    """
    Retorna a lista de situações e cores correspondentes mapeadas no sistema.
    """
    return SITUATIONS


# Gera a URL de autorização para conectar a agenda do Google Calendar
@router.get("/google-calendar/auth-url")
async def get_calendar_auth_url(
    redirect_uri: str,
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Gera a URL de consentimento OAuth do Google Calendar para a empresa do usuário.
    """
    url = await ConfigService.get_calendar_auth_url(redirect_uri)
    return {"authorization_url": url}


# Processa o callback de conexão com o Google Calendar e salva credenciais
@router.post("/google-calendar/callback")
async def calendar_callback(
    payload: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Callback executado após aprovação da agenda, gravando as credenciais no banco.
    """
    code = payload.get("code")
    redirect_uri = payload.get("redirect_uri")
    config_id_raw = payload.get("config_id")
    
    if not all([code, redirect_uri, config_id_raw]):
        raise HTTPException(status_code=400, detail="Parâmetros ausentes.")

    try:
        config_id = int(config_id_raw)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="config_id deve ser um número inteiro.")

    company_id = current_user.company_id or 0
    try:
        await ConfigService.calendar_callback(
            db=db,
            company_id=company_id,
            config_id=config_id,
            code=code,
            redirect_uri=redirect_uri
        )
        return {"message": "Agenda conectada com sucesso."}
    except ConfigNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Desconecta a agenda do Google Calendar associada à configuração
@router.post("/google-calendar/{config_id}/disconnect")
async def disconnect_calendar(
    config_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Remove as credenciais e conexões ativas com o Google Calendar para a persona.
    """
    company_id = current_user.company_id or 0
    await ConfigService.disconnect_calendar(db=db, company_id=company_id, config_id=config_id)
    return {"message": "Agenda desconectada."}


# Analisa o fluxo do assistente visual via IA (Gemini) no modo de edição
@router.post("/{config_id}/analyze_workflow", summary="Analisar fluxo via IA para melhoria (Modo Edição Direta)")
async def analyze_workflow_feedback(
    config_id: int,
    payload: schemas.WorkflowFeedbackPayload = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user),
    gemini_service: GeminiService = Depends(get_gemini_service)
):
    """
    Oferece sugestões inteligentes de refinamento de comportamento ou fluxos do assistente via Gemini.
    """
    company_id = current_user.company_id or 0
    try:
        return await ConfigService.analyze_workflow_feedback(
            db=db,
            company_id=company_id,
            config_id=config_id,
            feedback=payload.feedback,
            user=current_user,
            gemini_service=gemini_service,
            current_workflow=payload.current_workflow
        )
    except ConfigNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


# Aplica as alterações no fluxo visual da persona (modo edição direta)
@router.post("/{config_id}/apply_workflow", summary="Aplicar novo fluxo na Persona (Modo Edição Direta)")
async def apply_workflow_feedback(
    config_id: int,
    payload: schemas.ApplyWorkflowPayload = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Grava o novo objeto de fluxo visual (React Flow JSON) da persona.
    """
    company_id = current_user.company_id or 0
    try:
        return await ConfigService.apply_workflow_feedback(
            db=db,
            company_id=company_id,
            config_id=config_id,
            novo_workflow=payload.novo_workflow
        )
    except ConfigNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


# Analisa a base de conhecimento (planilhas) via IA no modo de visualização de conhecimento
@router.post("/{config_id}/analyze_knowledge", summary="Analisar base de conhecimento via IA para melhoria (Modo Conhecimento)")
async def analyze_knowledge_feedback(
    config_id: int,
    payload: schemas.WorkflowFeedbackPayload = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Oferece sugestões inteligentes de refinamento das planilhas de instruções e RAG via Pydantic AI.
    """
    company_id = current_user.company_id or 0
    try:
        return await ConfigService.analyze_knowledge_feedback(
            db=db,
            company_id=company_id,
            config_id=config_id,
            feedback=payload.feedback,
            user=current_user
        )
    except ConfigNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


# Aplica as alterações (planilhas e fluxo) diretamente na configuração (sem atendimento)
@router.post("/{config_id}/apply_feedback", summary="Aplicar sugestões estruturadas na Persona (Sistema, RAG e Fluxo)")
async def apply_config_feedback(
    config_id: int,
    payload: schemas.ApplyFeedbackPayload = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Aplica as modificações estruturadas propostas pela IA de feedback na planilha de sistema, planilha RAG ou workflow.
    """
    company_id = current_user.company_id or 0
    try:
        return await ConfigService.apply_config_feedback(
            db=db,
            company_id=company_id,
            config_id=config_id,
            payload=payload
        )
    except ConfigNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))