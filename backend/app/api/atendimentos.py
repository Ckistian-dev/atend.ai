import logging
import json
import uuid
from fastapi import APIRouter, Depends, HTTPException, Body, Response, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
import mimetypes
from fastapi import (
    APIRouter, Depends, HTTPException, Body, 
    UploadFile, File, Form
)
from starlette.responses import RedirectResponse
import httpx

from sqlalchemy import select, func
from sqlalchemy.orm import joinedload

from app.api import dependencies
from app.db.database import get_db
from app.db import models, schemas
from app.crud import crud_atendimento, crud_user
from app.services.whatsapp_service import WhatsAppService, get_whatsapp_service, MessageSendError
from app.services.security import decrypt_token
from app.services.gemini_service import GeminiService, get_gemini_service
from app.tasks import processar_envio_mensagem_manual, processar_envio_media_manual

logger = logging.getLogger(__name__)
router = APIRouter()

@router.get("/", response_model=schemas.AtendimentoPage)
async def get_atendimentos(
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user),
    # --- 5. ADICIONAR PARÂMETROS DE PAGINAÇÃO E FILTRO ---
    search: Optional[str] = Query(None, description="Termo de busca para contato, status ou observação"),
    page: int = Query(1, ge=1, description="Número da página"),
    limit: int = Query(20, ge=1, le=1000, description="Itens por página")
    # ------------------------------------------------------
):
    """Lista todos os atendimentos (com contatos) para o usuário."""
    
    # --- 6. SUBSTITUIR A LÓGICA ANTIGA PELA NOVA LÓGICA DE QUERY ---
    
    # Calcular offset
    skip = (page - 1) * limit

    # Query base com join no contato
    stmt_base = (
        select(models.Atendimento)
        .where(models.Atendimento.user_id == current_user.id)
    )

    # Aplicar filtro de busca se existir
    if search:
        search_term = f"%{search.lower()}%"
        stmt_base = stmt_base.where(
            (models.Atendimento.whatsapp.ilike(search_term)) |
            (models.Atendimento.status.ilike(search_term)) |
            (models.Atendimento.observacoes.ilike(search_term))
        )

    # Query para contar o total de itens (com filtro, mas sem paginação)
    stmt_count = select(func.count()).select_from(stmt_base.subquery())
    total_result = await db.execute(stmt_count)
    total = total_result.scalar() or 0

    # Query para buscar os dados da página (com filtro, ordenação e paginação)
    stmt_data = (
        stmt_base
        .order_by(models.Atendimento.updated_at.desc())
        .offset(skip)
        .limit(limit)
        .options(
            joinedload(models.Atendimento.active_persona) # <-- ADICIONAR ESTA LINHA
        )
    )
    
    data_result = await db.execute(stmt_data)
    items = data_result.scalars().unique().all() # .unique() para evitar duplicatas do join

    return {"total": total, "items": items}
    # -----------------------------------------------------------------

@router.put("/{atendimento_id}", response_model=schemas.Atendimento)
async def update_atendimento(
    atendimento_id: int,
    atendimento_in: schemas.AtendimentoUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """Atualiza o status ou persona de um atendimento (usado pelos modais)."""
    db_atendimento = await crud_atendimento.get_atendimento(db, atendimento_id=atendimento_id, user_id=current_user.id)
    if not db_atendimento:
        raise HTTPException(status_code=404, detail="Atendimento não encontrado")
    
    updated_atendimento = await crud_atendimento.update_atendimento(db, db_atendimento=db_atendimento, atendimento_in=atendimento_in)
    await db.commit()
    await db.refresh(updated_atendimento)
    return updated_atendimento

@router.delete("/{atendimento_id}", response_model=schemas.Atendimento)
async def delete_atendimento(
    atendimento_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """Apaga um atendimento (usado pelo modal de exclusão)."""
    deleted_atendimento = await crud_atendimento.delete_atendimento(db, atendimento_id=atendimento_id, user_id=current_user.id)
    if not deleted_atendimento:
        raise HTTPException(status_code=404, detail="Atendimento não encontrado")
    
    await db.commit()
    return deleted_atendimento

class SendMessagePayload(schemas.BaseModel):
    text: str

@router.post("/{atendimento_id}/send_message", status_code=status.HTTP_202_ACCEPTED)
async def send_manual_message(
    atendimento_id: int,
    payload: SendMessagePayload = Body(...),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Endpoint para enfileirar o envio de uma mensagem de texto manual.
    """
    processar_envio_mensagem_manual.delay(
        atendimento_id=atendimento_id,
        user_id=current_user.id,
        payload_json=payload.model_dump()
    )
    return {"status": "mensagem_enfileirada"}

@router.post("/{atendimento_id}/send_media", status_code=status.HTTP_202_ACCEPTED)
async def send_manual_media_message(
    atendimento_id: int,
    file: UploadFile = File(...),
    type: str = Form(...), # 'image', 'audio', 'document'
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Endpoint para enfileirar o envio de uma mídia manual.
    """
    import base64
    file_bytes = await file.read()
    file_bytes_b64 = base64.b64encode(file_bytes).decode('utf-8')

    processar_envio_media_manual.delay(
        atendimento_id=atendimento_id,
        user_id=current_user.id,
        form_data={'type': type},
        file_bytes_b64=file_bytes_b64,
        filename=file.filename,
        content_type=file.content_type
    )
    await file.close()
    return {"status": "midia_enfileirada"}
        
        
@router.get( "/{atendimento_id}/media/{media_id}", summary="Baixar mídia diretamente (API Oficial)", )
async def download_media_directly(
    atendimento_id: int,
    media_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user),
    whatsapp_service: WhatsAppService = Depends(get_whatsapp_service)
):
    """
    Busca a URL da Meta, baixa o arquivo no backend e o retorna para o cliente.
    """
    # 1. Verificações (atendimento, token)
    db_atendimento = await crud_atendimento.get_atendimento(db, atendimento_id=atendimento_id, user_id=current_user.id)
    if not db_atendimento: raise HTTPException(status_code=404, detail="Atendimento não encontrado.")
    if not current_user.wbp_access_token: raise HTTPException(status_code=403, detail="Token não configurado.")

    decrypted_token = "TOKEN_ERRO_DECRIPT"
    try:
        decrypted_token = decrypt_token(current_user.wbp_access_token)
    except Exception as e:
        logger.error(f"Erro ao descriptografar token p/ download (User {current_user.id}): {e}")
        raise HTTPException(status_code=500, detail="Erro nas credenciais.")

    media_url: Optional[str] = None
    try:
        # 2. Obter a URL da mídia da Meta
        logger.debug(f"Buscando URL para media_id {media_id}...")
        media_url = await whatsapp_service.get_media_url_official(media_id, decrypted_token)
        if not media_url:
            raise HTTPException(status_code=404, detail="URL da mídia não encontrada na Meta (inválida ou expirada?).")

        # --- LOG TEMPORÁRIO ADICIONADO ---
        logger.info(f"!!! [DEBUG] URL COMPLETA DA META OBTIDA: {media_url}")
        # ---------------------------------

        # (O log anterior que mostrava só o início foi removido/substituído por este)

        token_preview = decrypted_token[:10] + "..." + decrypted_token[-5:] if len(decrypted_token) > 15 else decrypted_token
        logger.debug(f"Tentando baixar da Meta URL com token preview: {token_preview}")

        # 3. Baixar a mídia AQUI no backend usando httpx
        logger.info(f"Baixando mídia {media_id} diretamente da Meta...")
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
             headers = {"Authorization": f"Bearer {decrypted_token}"}
             media_response = await client.get(media_url, headers=headers)

             logger.debug(f"Resposta da Meta - Status: {media_response.status_code}")
             logger.debug(f"Resposta da Meta - Headers: {media_response.headers}")

             content_type = media_response.headers.get('content-type', '').lower()
             if media_response.status_code != 200 or 'text/html' in content_type:
                 response_body_text = "[Não foi possível ler corpo da resposta]"
                 try:
                     response_body_text = (await media_response.aread(1024)).decode('utf-8', errors='ignore')
                 except Exception as read_err:
                     logger.warning(f"Não foi possível ler o corpo da resposta de erro da Meta: {read_err}")
                 logger.error(f"Erro ao baixar mídia {media_id}: Meta retornou status {media_response.status_code} / tipo {content_type}. Corpo (início): {response_body_text}")
                 media_response.raise_for_status()
                 raise HTTPException(status_code=502, detail="Falha ao baixar mídia da Meta: Resposta inesperada (HTML). Verifique o token/permissões.")

             # media_bytes = await media_response.aread() # Usar .aread() se for ler de novo
             media_bytes = media_response.content # Usar .content se já leu tudo implicitamente com raise_for_status/headers
             logger.info(f"Mídia {media_id} baixada ({len(media_bytes)} bytes, tipo: {content_type}). Retornando para o frontend.")

             # 4. Retorna os bytes
             return Response(content=media_bytes, media_type=content_type)

    except httpx.HTTPStatusError as e:
        is_download_error = media_url is not None
        log_prefix = "Erro HTTP da Meta ao BAIXAR mídia" if is_download_error else "Erro HTTP da Meta ao BUSCAR URL"
        # O log detalhado já foi feito acima se o erro foi no download
        if not is_download_error:
             logger.error(f"{log_prefix} {media_id}: Status {e.response.status_code}. Resposta: {e.response.text if e.response else 'N/A'}", exc_info=False)

        error_detail = f"Erro {e.response.status_code} na Meta."
        try: meta_error = e.response.json(); error_detail = meta_error.get("error", {}).get("message", error_detail); 
        except Exception: pass
        raise HTTPException(status_code=502, detail=f"Erro API WhatsApp: {error_detail}")

    except Exception as e:
        logger.error(f"Erro inesperado ao processar mídia {media_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro interno ao processar mídia: {str(e)}")