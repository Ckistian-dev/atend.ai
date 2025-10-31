import logging
import json
import uuid
from fastapi import APIRouter, Depends, HTTPException, Body, Response, Query
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
        .join(models.Atendimento.contact, isouter=True)
        .where(models.Atendimento.user_id == current_user.id)
    )

    # Aplicar filtro de busca se existir
    if search:
        search_term = f"%{search.lower()}%"
        stmt_base = stmt_base.where(
            (models.Contact.whatsapp.ilike(search_term)) |
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
            joinedload(models.Atendimento.contact), 
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

@router.post("/{atendimento_id}/send_message", response_model=schemas.Atendimento)
async def send_manual_message(
    atendimento_id: int,
    payload: SendMessagePayload = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user),
    whatsapp_service: WhatsAppService = Depends(get_whatsapp_service)
):
    """
    Endpoint para o atendente humano enviar uma mensagem manual.
    1. Envia a mensagem pela API (Evolution ou Oficial)
    2. Salva a mensagem enviada no histórico (conversa JSON)
    3. Define o status como 'Aguardando Resposta'
    """
    # 1. Busca o atendimento e o contato
    db_atendimento = await crud_atendimento.get_atendimento(db, atendimento_id=atendimento_id, user_id=current_user.id)
    if not db_atendimento or not db_atendimento.contact:
        raise HTTPException(status_code=404, detail="Atendimento ou contato não encontrado")

    contact_number = db_atendimento.contact.whatsapp
    text_to_send = payload.text

    try:
        # 2. Tenta enviar a mensagem usando o serviço (que já lida com Evo/Oficial)
        # O user é passado para o serviço poder verificar o api_type e tokens
        send_result = await whatsapp_service.send_text_message(
            user=current_user,
            number=contact_number,
            text=text_to_send
        )
        
        logger.info(f"Mensagem manual enviada para {contact_number} (Atendimento ID: {atendimento_id}). API Msg ID: {send_result.get('id')}")

        # 3. Prepara a mensagem para salvar no histórico
        message_id = send_result.get('id') or f"manual-{uuid.uuid4()}"
        # Usa o timestamp do resultado se disponível (Evolution), senão, usa o atual
        timestamp_epoch = send_result.get('timestamp', int(datetime.now(timezone.utc).timestamp()))
        
        formatted_message = schemas.FormattedMessage(
            id=str(message_id),
            role='assistant', # 'assistant' representa o atendente/IA
            content=text_to_send,
            timestamp=timestamp_epoch 
        )

        # 4. Adiciona a mensagem à conversa e atualiza o status
        # Usando a função que você já tem no crud_atendimento
        atendimento_atualizado = await crud_atendimento.add_message_to_conversa(
            db=db, # Passa a sessão
            atendimento_id=atendimento_id,
            user_id=current_user.id,
            message=formatted_message
        )
        
        if not atendimento_atualizado:
             # Isso não deve acontecer se o get_atendimento funcionou, mas é uma segurança
            raise HTTPException(status_code=500, detail="Falha ao salvar mensagem no histórico após envio")
        
        await db.commit() # Commita APENAS a adição da msg 
        await db.refresh(atendimento_atualizado) # Faz o refresh no objeto que já tínhamos
        return atendimento_atualizado # Retorna o objeto atualizado (sem mudança de status)

    except MessageSendError as e:
        logger.error(f"Erro ao ENVIAR mensagem manual para {contact_number} (Atendimento ID: {atendimento_id}): {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=f"Falha ao enviar mensagem pela API do WhatsApp: {e}")
    except Exception as e:
        await db.rollback()
        logger.error(f"Erro INESPERADO ao enviar mensagem manual (Atendimento ID: {atendimento_id}): {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro interno: {e}")

@router.post("/{atendimento_id}/send_media", response_model=schemas.Atendimento)
async def send_manual_media_message(
    atendimento_id: int,
    file: UploadFile = File(...),
    type: str = Form(...), # 'image', 'audio', 'document'
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user),
    whatsapp_service: WhatsAppService = Depends(get_whatsapp_service),
    gemini_service: GeminiService = Depends(get_gemini_service)
):
    """
    Endpoint para o atendente humano enviar uma MÍDIA manual (imagem, áudio, doc).
    AGORA TAMBÉM GERA TRANSCRIÇÃO/ANÁLISE para o conteúdo.
    """
    
# 1. Busca o atendimento (com persona carregada para Gemini)
    # Certifique-se que get_atendimento carrega active_persona
    db_atendimento = await crud_atendimento.get_atendimento(db, atendimento_id=atendimento_id, user_id=current_user.id)
    if not db_atendimento or not db_atendimento.contact:
        raise HTTPException(status_code=404, detail="Atendimento ou contato não encontrado")
    
    # Verifica se a persona está carregada (necessário para Gemini)
    if not db_atendimento.active_persona and not current_user.default_persona_id:
         logger.warning(f"Atendimento {atendimento_id} sem persona ativa e usuário sem padrão. Análise de mídia enviada será pulada.")
         # Considerar buscar a persona padrão aqui se active_persona for None
         # persona_config = await crud_config.get_config(db, current_user.default_persona_id, current_user.id)
         persona_config = None # Ou tratar o erro
    elif not db_atendimento.active_persona and current_user.default_persona_id:
         # Tenta carregar a persona padrão se a do atendimento for nula
         persona_config = await db.get(models.Config, current_user.default_persona_id)
         if persona_config and persona_config.user_id != current_user.id: # Segurança extra
              persona_config = None
    else:
        persona_config = db_atendimento.active_persona # Usa a persona do atendimento

    if type not in ['image', 'audio', 'document', 'video']: # <-- ADICIONADO 'video'
        raise HTTPException(status_code=400, detail="Tipo de mídia inválido.")

    contact_number = db_atendimento.contact.whatsapp
    generated_content = None # Variável para guardar o texto gerado
    
    try:
        # 2. Ler o arquivo
        file_bytes = await file.read()
        filename = file.filename or "media_file"
        mimetype = file.content_type
        
        if not mimetype:
            mimetype, _ = mimetypes.guess_type(filename)
            if not mimetype: mimetype = 'application/octet-stream'
        
        logger.info(f"Enviando mídia manual (Tipo: {type}, Nome: {filename}) para Atendimento {atendimento_id}")

        # --- INÍCIO: GERAR CONTEÚDO COM GEMINI (PARA IMAGEM/ÁUDIO/DOCUMENTO ENVIADOS) ---
        if type in ['image', 'audio', 'document', 'video'] and persona_config: # <-- MUDANÇA 1 (adicionado 'video')
            logger.info(f"Gerando análise/transcrição para mídia enviada ({type})...")
            try:
                media_info_for_gemini = {"mime_type": mimetype, "data": file_bytes}
                current_conversa_list = json.loads(db_atendimento.conversa or "[]")
                
                analysis_result = await gemini_service.transcribe_and_analyze_media(
                    media_data=media_info_for_gemini, # Nome do argumento corrigido
                    db_history=current_conversa_list, # Renomeado para db_history
                    config=persona_config,            # Renomeado para config
                    contexto_planilha=persona_config.contexto_json, # Renomeado para contexto_planilha
                    db=db, 
                    user=current_user 
                )
                
                # --- INÍCIO MUDANÇA 2: Lógica de prefixo atualizada ---
                prefix = "[Descrição da Imagem]" # Padrão
                if type == 'audio':
                    prefix = "[Áudio transcrito]"
                elif type == 'document':
                    prefix = "[Documento transcrito]"
                elif type == 'video': # <-- ADICIONADO
                    prefix = "[Vídeo analisado]" # <-- ADICIONADO
                
                generated_content = f"{prefix}: {analysis_result or 'Não foi possível processar'}"
                logger.info("Análise/transcrição da mídia enviada concluída.")

            except Exception as gemini_err:
                logger.error(f"Erro Gemini ao analisar mídia ENVIADA (Atendimento {atendimento_id}): {gemini_err}", exc_info=True)
                
                # --- INÍCIO MUDANÇA 3: Lógica de fallback de erro atualizada ---
                error_type_text = "Mídia"
                if type == 'audio': error_type_text = "Áudio"
                elif type == 'image': error_type_text = "Imagem"
                elif type == 'document': error_type_text = "Documento"
                elif type == 'video': error_type_text = "Vídeo" # <-- ADICIONADO
                generated_content = f"[{error_type_text} enviada, erro na análise/transcrição]"
                # --- FIM MUDANÇA 3 ---
        
        # --- INÍCIO MUDANÇA 4: Bloco 'else' (fallback qnd não há persona) atualizado ---
        else:
            # Fallback se não houver persona ou se o tipo não estiver no 'if'
            fallback_type_text = "Mídia"
            if type == 'audio': fallback_type_text = "Áudio"
            elif type == 'image': fallback_type_text = "Imagem"
            elif type == 'video': fallback_type_text = "Vídeo"
            
            # O 'elif' de documento foi removido, então o fallback para doc (sem persona)
            # deve ser o comportamento antigo.
            if type == 'document':
                generated_content = f"[Documento enviado: {filename}]"
            else:
                generated_content = f"[{fallback_type_text} enviada]"

        # 3. Tenta enviar a mídia pela API do WhatsApp
        send_result = await whatsapp_service.send_media_message(
            user=current_user,
            number=contact_number,
            media_type=type,
            file_bytes=file_bytes, # Envia os bytes originais (a conversão é feita dentro do service)
            filename=filename,
            mimetype=mimetype,
            caption=None # O frontend não manda caption, mas o 'content' agora é a análise
        )
        
        logger.info(f"Mídia manual enviada para {contact_number}. API Msg ID: {send_result.get('id')}")

        # 4. Prepara a mensagem para salvar no histórico (COM O CONTEÚDO GERADO)
        message_id = send_result.get('id') or f"manual-{uuid.uuid4()}"
        timestamp_epoch = send_result.get('timestamp', int(datetime.now(timezone.utc).timestamp()))
        media_id_from_send = send_result.get("media_id") 
        
        # Usa o mimetype que foi efetivamente UPLOADADO (pode ser diferente do original se houve conversão)
        # Se houve conversão, o service retorna o media_id, indicando WBP. Assumimos MP3.
        final_mimetype_saved = 'audio/mpeg' if type == 'audio' and media_id_from_send else mimetype

        formatted_message = schemas.FormattedMessage(
            id=str(message_id),
            role='assistant',
            content=generated_content, # <<<--- USA O CONTEÚDO GERADO PELO GEMINI
            timestamp=timestamp_epoch,
            type=type,
            url=None, 
            filename=filename,
            media_id=media_id_from_send, 
            mime_type=final_mimetype_saved # <<<--- SALVA O MIMETYPE CORRETO
        )

        # 5. Adiciona a mensagem à conversa
        atendimento_atualizado = await crud_atendimento.add_message_to_conversa(
            db=db,
            atendimento_id=atendimento_id,
            user_id=current_user.id,
            message=formatted_message
        )
        
        if not atendimento_atualizado:
             raise HTTPException(status_code=500, detail="Falha ao salvar mídia no histórico após envio")

        await db.commit() # Commita APENAS a adição da msg
        await db.refresh(atendimento_atualizado) # Faz o refresh no objeto que já tínhamos
        return atendimento_atualizado # Retorna o objeto atualizado (sem mudança de status)

    except MessageSendError as e:
        logger.error(f"Erro ao ENVIAR mídia manual (Atendimento ID: {atendimento_id}): {e}", exc_info=True)
        # Opcional: Salvar a falha no histórico do DB
        raise HTTPException(status_code=502, detail=f"Falha ao enviar mídia: {e}")
    except Exception as e:
        await db.rollback()
        logger.error(f"Erro INESPERADO ao enviar mídia manual (Atendimento ID: {atendimento_id}): {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro interno: {e}")
    finally:
        await file.close() # Importante fechar o arquivo
        
        
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
    # 1. Verificações (atendimento, api_type, token - igual)
    db_atendimento = await crud_atendimento.get_atendimento(db, atendimento_id=atendimento_id, user_id=current_user.id)
    if not db_atendimento: raise HTTPException(status_code=404, detail="Atendimento não encontrado.")
    if current_user.api_type != models.ApiType.official: raise HTTPException(status_code=400, detail="Download direto indisponível.")
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