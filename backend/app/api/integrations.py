# app/api/integrations.py

import logging
import uuid
from typing import List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, status, Body, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from app.api import dependencies
from app.db import models, schemas
from app.db.database import get_db
from app.services.integration_service import (
    IntegrationService,
    verify_webhook_token_secure,
    validate_url_security
)

logger = logging.getLogger(__name__)
router = APIRouter()

# --- REQUISIÇÕES PROTEGIDAS DA CONFIGURAÇÃO DE PERSONA ---

@router.get("/configs/{config_id}/integrations", response_model=List[schemas.Integration], summary="Listar integrações de uma Persona")
async def list_persona_integrations(
    config_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Lista todas as integrações cadastradas para a persona especificada.
    """
    company_id = current_user.company_id or 0
    # Verifica permissão da persona
    config = await db.get(models.Config, config_id)
    if not config or config.company_id != company_id:
        raise HTTPException(status_code=404, detail="Persona não encontrada.")

    stmt = select(models.Integration).where(models.Integration.config_id == config_id).order_by(models.Integration.id.desc())
    res = await db.execute(stmt)
    return res.scalars().all()


@router.post("/configs/{config_id}/integrations", response_model=schemas.Integration, status_code=status.HTTP_201_CREATED, summary="Criar nova Integração")
async def create_integration(
    config_id: int,
    payload: schemas.IntegrationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Cria uma nova integração (Polling ou Webhook) para a persona.
    Gera um token secreto único para autenticação via Header X-Webhook-Token.
    """
    company_id = current_user.company_id or 0
    config = await db.get(models.Config, config_id)
    if not config or config.company_id != company_id:
        raise HTTPException(status_code=404, detail="Persona não encontrada.")

    # Se for polling, valida segurança da URL
    if payload.integration_type == "polling" and payload.url:
        try:
            validate_url_security(payload.url)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    webhook_token = uuid.uuid4().hex

    new_integration = models.Integration(
        config_id=config_id,
        name=payload.name,
        integration_type=payload.integration_type or "polling",
        url=payload.url,
        webhook_token=webhook_token,
        method=(payload.method or "GET").upper(),
        headers=payload.headers,
        body=payload.body,
        items_path=payload.items_path or "",
        title_field=payload.title_field,
        content_field=payload.content_field,
        category=payload.category or "integração",
        sync_interval_minutes=payload.sync_interval_minutes or 5,
        enabled=payload.enabled if payload.enabled is not None else True,
        last_status="pending"
    )

    db.add(new_integration)
    await db.commit()
    await db.refresh(new_integration)
    return new_integration


@router.put("/configs/integrations/{integration_id}", response_model=schemas.Integration, summary="Atualizar Integração")
async def update_integration(
    integration_id: int,
    payload: schemas.IntegrationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Atualiza as configurações de uma integração existente.
    """
    company_id = current_user.company_id or 0
    integration = await db.get(models.Integration, integration_id)
    if not integration:
        raise HTTPException(status_code=404, detail="Integração não encontrada.")

    config = await db.get(models.Config, integration.config_id)
    if not config or config.company_id != company_id:
        raise HTTPException(status_code=403, detail="Acesso negado a esta integração.")

    update_data = payload.model_dump(exclude_unset=True)

    if "url" in update_data and update_data["url"] and integration.integration_type == "polling":
        try:
            validate_url_security(update_data["url"])
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    for key, value in update_data.items():
        setattr(integration, key, value)

    db.add(integration)
    await db.commit()
    await db.refresh(integration)
    return integration


@router.delete("/configs/integrations/{integration_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Excluir Integração")
async def delete_integration(
    integration_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Exclui uma integração e limpa seus vetores no banco de dados RAG.
    """
    company_id = current_user.company_id or 0
    integration = await db.get(models.Integration, integration_id)
    if not integration:
        raise HTTPException(status_code=404, detail="Integração não encontrada.")

    config = await db.get(models.Config, integration.config_id)
    if not config or config.company_id != company_id:
        raise HTTPException(status_code=403, detail="Acesso negado a esta integração.")

    # Apaga vetores RAG associados a esta integração
    origin_tag = f"integration_{integration.id}"
    await db.execute(delete(models.KnowledgeVector).where(
        models.KnowledgeVector.config_id == integration.config_id,
        models.KnowledgeVector.origin == origin_tag
    ))

    await db.delete(integration)
    await db.commit()
    return None


@router.post("/configs/integrations/{integration_id}/sync", summary="Sincronizar Integração Manualmente (Testar)")
async def sync_integration_now(
    integration_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Dispara a sincronização imediata de uma integração Polling.
    """
    company_id = current_user.company_id or 0
    integration = await db.get(models.Integration, integration_id)
    if not integration:
        raise HTTPException(status_code=404, detail="Integração não encontrada.")

    config = await db.get(models.Config, integration.config_id)
    if not config or config.company_id != company_id:
        raise HTTPException(status_code=403, detail="Acesso negado a esta integração.")

    try:
        count = await IntegrationService.run_integration_sync(db, integration)
        return {"message": f"Sincronização concluída com sucesso! {count} vetores atualizados.", "updated_items": count}
    except Exception as e:
        logger.error(f"Erro na sincronização manual da integração {integration_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/configs/integrations/{integration_id}/last-payload", summary="Obter último payload recebido pelo Webhook/Polling")
async def get_last_integration_payload(
    integration_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Retorna o último payload JSON recebido ao vivo para permitir mapeamento dinâmico na UI.
    """
    company_id = current_user.company_id or 0
    integration = await db.get(models.Integration, integration_id)
    if not integration:
        raise HTTPException(status_code=404, detail="Integração não encontrada.")

    config = await db.get(models.Config, integration.config_id)
    if not config or config.company_id != company_id:
        raise HTTPException(status_code=403, detail="Acesso negado.")

    return {
        "has_payload": integration.last_payload is not None,
        "data": integration.last_payload,
        "last_sync_at": integration.last_sync_at
    }


@router.post("/configs/integrations/test-endpoint", summary="Testar Requisição HTTP de Endpoint")
async def test_integration_endpoint(
    payload: schemas.TestEndpointPayload,
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Executa uma requisição de teste para o endpoint informado para permitir a seleção gráfica dos campos no frontend.
    Protegido contra requisições SSRF.
    """
    try:
        res = await IntegrationService.test_endpoint(payload.model_dump())
        return res
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao testar endpoint: {str(e)}")


# --- RECEIVER PÚBLICO DE WEBHOOK (AUTENTICADO VIA HEADER X-Webhook-Token) ---

@router.post("/integrations/webhook", summary="Webhook de Entrada (Recepção de Dados em Tempo Real)")
async def receive_integration_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Endpoint público de Webhook que recebe requisições de plataformas externas em tempo real.
    A autenticação é feita obrigatoriamente através do Header `X-Webhook-Token` (ou `Authorization`).
    """
    header_token = request.headers.get("x-webhook-token") or request.headers.get("x-api-key")
    if not header_token:
        # Tenta extrair do Header Authorization: Bearer <token>
        auth_header = request.headers.get("authorization")
        if auth_header and auth_header.startswith("Bearer "):
            header_token = auth_header.split(" ")[1]

    if not header_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Header 'X-Webhook-Token' ou 'Authorization: Bearer <token>' obrigatório."
        )

    # Localiza a integração pelo token
    stmt = select(models.Integration).where(models.Integration.webhook_token == header_token, models.Integration.enabled == True)
    res = await db.execute(stmt)
    integration = res.scalars().first()

    if not integration:
        # Validação constante contra timing attacks (apenas se nenhum token for encontrado)
        verify_webhook_token_secure(header_token, "invalid_dummy_token_string")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token de webhook inválido ou integração desativada.")

    # Concatena verificação segura HMAC
    if not verify_webhook_token_secure(header_token, integration.webhook_token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token de webhook inválido.")

    try:
        body_json = await request.json()
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payload inválido. Esperado JSON.")

    try:
        processed_count = await IntegrationService.process_payload_for_integration(db, integration, body_json)
        return {
            "status": "success",
            "message": f"Webhook recebido e processado com sucesso. {processed_count} vetores atualizados.",
            "processed_count": processed_count
        }
    except Exception as e:
        logger.error(f"Erro ao processar payload do Webhook (ID: {integration.id}): {e}", exc_info=True)
        integration.last_status = "error"
        integration.last_error = str(e)
        db.add(integration)
        await db.commit()
        raise HTTPException(status_code=500, detail=f"Erro interno ao processar dados do webhook: {str(e)}")
