import logging
import json
from datetime import datetime, timezone
from sqlalchemy.future import select
from sqlalchemy.orm import joinedload
from typing import Optional, Dict, Any

from app.core.config import settings
from app.db.database import SessionLocal
from app.crud import crud_user, crud_atendimento, crud_config
from app.db import models, schemas
from app.services.whatsapp_service import get_whatsapp_service, format_whatsapp_number
from app.services.gemini_service import get_gemini_service
from app.services.security import decrypt_token

logger = logging.getLogger(__name__)

async def _process_single_message(message_data: Dict[str, Any], company: models.Company, phone_number_id: str):
    """
    Processa UMA ÚNICA mensagem do webhook da Meta.
    Persiste mensagens e mídias (bytes) diretamente na tabela 'mensagens'.
    Reações são aplicadas sem acionar o agente de IA.
    """
    whatsapp_service = get_whatsapp_service()
    gemini_service = get_gemini_service()
    atendimento_id = None
    msg_id_wamid = message_data.get('id')

    try:
        msg_type = message_data.get('type')
        sender_number = message_data.get('from')
        cleaned_sender_number = format_whatsapp_number(sender_number) if sender_number else ""

        # --- TRATAMENTO DE REAÇÕES (NÃO ACIONA IA) ---
        if msg_type == 'reaction':
            reaction_obj = message_data.get('reaction', {})
            target_msg_id = reaction_obj.get('message_id')
            emoji = reaction_obj.get('emoji', '')

            if target_msg_id and cleaned_sender_number:
                async with SessionLocal() as db_session:
                    result = await crud_atendimento.get_or_create_atendimento_by_number(
                        db=db_session, 
                        number=cleaned_sender_number, 
                        company=company
                    )
                    if result:
                        atendimento_obj, _ = result
                        await crud_atendimento.apply_reaction_to_message(
                            db=db_session,
                            company_id=company.id,
                            atendimento_id=atendimento_obj.id,
                            target_message_id=target_msg_id,
                            emoji=emoji,
                            sender_number=cleaned_sender_number
                        )
                        await db_session.commit()
                        logger.info(f"WBP Webhook: Reação '{emoji}' aplicada à mensagem {target_msg_id} (Atendimento {atendimento_obj.id}). IA NÃO acionada.")
            return

        if msg_type in ['unsupported', 'order', 'system', 'ephemeral_setting', 'unknown']:
            logger.info(f"WBP Webhook: Mensagem do tipo '{msg_type}' ignorada de {message_data.get('from')}.")
            return

        timestamp_s = int(message_data.get('timestamp', '0'))

        if not sender_number or not msg_id_wamid:
            return

        # --- Etapa 1: Obter ou Criar Atendimento ---
        async with SessionLocal() as db_session:
            result = await crud_atendimento.get_or_create_atendimento_by_number(db=db_session, number=cleaned_sender_number, company=company)
            if not result:
                return

            atendimento_obj, was_created = result
            await db_session.commit()
            atendimento_id = atendimento_obj.id
            
            status_que_bloqueiam_reabertura = ["Ignorar Contato", "Atendente Chamado"]
            deve_mudar_status = True
            if not was_created and atendimento_obj.status in status_que_bloqueiam_reabertura:
                deve_mudar_status = False
        
        reply_prefix = ""
        formatted_msg_content = ""
        media_info_gemini = None
        mime_type_original = None
        caption = ""
        media_id_from_payload = None
        downloaded_media_bytes = None
        document_filename = None

        # --- Lógica de Resposta (Context / Quoted Msg) ---
        context_data = message_data.get('context')
        quoted_msg_structured = None
        quoted_msg_id = None
        if context_data and context_data.get('id'):
            quoted_msg_id = context_data['id']
            async with SessionLocal() as db_q:
                original_msg = await crud_atendimento.get_message_by_wamid_or_id(db_q, company_id=company.id, message_id=quoted_msg_id)
                if original_msg:
                    quoted_msg_structured = {
                        "content": original_msg.content or original_msg.caption or '',
                        "role": original_msg.role or 'assistant',
                        "id": original_msg.message_id
                    }
                    quote = ((original_msg.content or original_msg.caption or '')[:100] + '...')
                    reply_prefix = f"[Mensagem Referenciada]: \"{quote}\"\n"

        # --- Etapa 2: Processar Conteúdo ---
        if msg_type == 'text':
            formatted_msg_content = message_data.get('text', {}).get('body', '').strip()
            
            if formatted_msg_content == "/reset":
                async with SessionLocal() as db_delete:
                    at = await db_delete.get(models.Atendimento, atendimento_id)
                    if at: 
                        await db_delete.delete(at)
                        await db_delete.commit()
                return 

        elif msg_type == 'interactive':
            interactive_data = message_data.get('interactive', {})
            interactive_type = interactive_data.get('type')
            if interactive_type == 'button_reply':
                formatted_msg_content = interactive_data.get('button_reply', {}).get('title', '')
            elif interactive_type == 'list_reply':
                formatted_msg_content = interactive_data.get('list_reply', {}).get('title', '')
            else:
                formatted_msg_content = "[Interação via botão]"

        elif msg_type == 'button':
            formatted_msg_content = message_data.get('button', {}).get('text', '')

        # --- Tratamento de Mídia com Download e Persistência Binária ---
        elif msg_type in ['image', 'audio', 'video', 'document', 'sticker']:
            media_obj = message_data.get(msg_type, {})
            media_id = media_obj.get('id')
            media_id_from_payload = media_id
            document_filename = media_obj.get('filename')
            
            raw_mime = media_obj.get('mime_type', 'application/octet-stream')
            mime_type_original = raw_mime.split(';')[0].strip()
            caption = media_obj.get('caption', '').strip()

            if media_id:
                logger.info(f"WBP Webhook: Mídia {msg_type} recebida ({mime_type_original}). Baixando para salvar no banco...")
                
                if not settings.WBP_ACCESS_TOKEN:
                    formatted_msg_content = f"[Mídia ({msg_type}) ignorada: Token não configurado no .env]"
                else:
                    try:
                        decrypted_token = settings.WBP_ACCESS_TOKEN
                        media_url = await whatsapp_service.get_media_url_official(media_id, decrypted_token)
                        
                        if media_url:
                            media_bytes = await whatsapp_service.download_media_official(media_url, decrypted_token)
                            
                            if media_bytes:
                                downloaded_media_bytes = media_bytes
                                media_info_gemini = {
                                    "data": media_bytes,
                                    "mime_type": raw_mime
                                }
                            else:
                                formatted_msg_content = f"[Mídia ({msg_type}) recebida, mas download veio vazio]"
                        else:
                            formatted_msg_content = f"[Mídia ({msg_type}) recebida, falha na URL]"
                            
                    except Exception as e:
                        logger.error(f"WBP Webhook: Erro download mídia {media_id}: {e}")
                        formatted_msg_content = f"[Mídia ({msg_type}) - Erro no Download]"
            else:
                formatted_msg_content = f"[Mídia ({msg_type}) sem ID]"

            if caption and not media_info_gemini:
                formatted_msg_content += f"\n[Legenda]: {caption}"

        elif msg_type == 'location':
            loc = message_data.get('location', {})
            lat, lng = loc.get('latitude'), loc.get('longitude')
            if lat and lng:
                formatted_msg_content = f"[Localização]\nMaps: http://maps.google.com/?q={lat},{lng}"
                if loc.get('name'): formatted_msg_content += f"\nLocal: {loc.get('name')}"
                if loc.get('address'): formatted_msg_content += f"\nEndereço: {loc.get('address')}"
            else:
                formatted_msg_content = "[Localização sem coordenadas]"

        else:
            logger.info(f"WBP Webhook: Mensagem do tipo '{msg_type}' não suportada/ignorada de {sender_number}.")
            return

        # --- Etapa 3: Análise de Mídia com IA (Gemini) ---
        if media_info_gemini:
            try:
                async with SessionLocal() as db_gemini_ctx:
                    company_for_gemini = await db_gemini_ctx.get(models.Company, company.id)
                    if not company_for_gemini:
                        raise ValueError("Empresa não encontrada para sessão Gemini")

                    stmt = select(models.Atendimento).where(models.Atendimento.id == atendimento_id).options(joinedload(models.Atendimento.active_persona))
                    atendimento_ctx = (await db_gemini_ctx.execute(stmt)).scalar_one()
                    
                    persona = atendimento_ctx.active_persona or await crud_config.get_config(db_gemini_ctx, company_for_gemini.default_persona_id, company_for_gemini.id)

                    # Carrega histórico para análise
                    msgs_db = await crud_atendimento.get_messages_for_atendimento(db_gemini_ctx, atendimento_id, company.id)
                    hist_for_gemini = [
                        {"role": m.role, "content": m.content or m.caption or "", "timestamp": int(m.timestamp.timestamp()) if m.timestamp else 0}
                        for m in msgs_db[-10:]
                    ]

                    analysis_result = await gemini_service.transcribe_and_analyze_media(
                        media_data=media_info_gemini,
                        db_history=hist_for_gemini,
                        persona=persona,
                        db=db_gemini_ctx,
                        company=company_for_gemini,
                        atendimento_id=atendimento_id
                    )
                
                prefix_tipo = "Áudio" if 'audio' in (mime_type_original or '') else "Imagem/Doc"
                formatted_msg_content = f"[{prefix_tipo} Transcrito]: {analysis_result}"
                
                if caption: 
                    formatted_msg_content += f"\n[Legenda Original]: {caption}"

            except Exception as e:
                logger.error(f"WBP Webhook: Falha na análise Gemini: {e}", exc_info=True)
                formatted_msg_content = f"[Mídia recebida ({mime_type_original}) - Falha na análise IA]"

        # --- Etapa 4: Salvar Mensagem na Tabela 'mensagens' com media_bytes ---
        if reply_prefix:
            formatted_msg_content = reply_prefix + formatted_msg_content

        if formatted_msg_content or media_id_from_payload or downloaded_media_bytes:
            msg_payload_dict = {
                "id": msg_id_wamid,
                "role": "user",
                "content": formatted_msg_content,
                "caption": caption if caption else None,
                "timestamp": timestamp_s,
                "status": "unread",
                "type": msg_type if msg_type in ['image', 'audio', 'document', 'video', 'location', 'sticker'] else 'text',
                "media_id": media_id_from_payload,
                "mime_type": mime_type_original,
                "filename": document_filename,
                "quoted_msg": quoted_msg_structured,
                "quoted_msg_id": quoted_msg_id,
                "is_ai": False,
                "is_template": False
            }

            async with SessionLocal() as db_save:
                async with db_save.begin():
                    # 1. Salva a mensagem na tabela mensagens com os bytes da mídia
                    await crud_atendimento.save_message(
                        db=db_save,
                        company_id=company.id,
                        atendimento_id=atendimento_id,
                        message_data=msg_payload_dict,
                        media_bytes=downloaded_media_bytes
                    )

                    # 2. Atualiza o atendimento
                    atend = await db_save.get(models.Atendimento, atendimento_id, with_for_update=True)
                    if atend:
                        if deve_mudar_status:
                            atend.status = "Mensagem Recebida"
                        atend.updated_at = datetime.now(timezone.utc)
                        db_save.add(atend)

                    logger.info(f"WBP Webhook: Mensagem {msg_id_wamid} (Atend {atendimento_id}) salva na tabela mensagens (bytes: {len(downloaded_media_bytes) if downloaded_media_bytes else 0}).")
                    
                    # BARRAMENTO: Cancela a resposta da IA que estava sendo gerada para reiniciar com a mensagem atualizada
                    from app.services.agent_processor import cancel_active_atendimento_task
                    cancel_active_atendimento_task(atendimento_id)

    except Exception as e:
        logger.error(f"WBP Webhook: Erro processamento single msg {msg_id_wamid}: {e}", exc_info=True)


async def process_official_message_task(value_payload: dict):
    """
    Função principal que recebe o payload 'value' do webhook, encontra a empresa
    e delega o processamento de cada mensagem para uma função isolada.
    """
    logger.info("WBP Webhook (Worker): Iniciando processamento de 'value'...")
    user_id_log = None

    try:
        metadata = value_payload.get('metadata', {})
        phone_number_id = metadata.get('phone_number_id')
        messages = value_payload.get('messages', [])

        if not phone_number_id:
            logger.error("WBP Webhook (Worker): phone_number_id não encontrado no payload 'value'.")
            return

        company: Optional[models.Company] = None
        async with SessionLocal() as db_read:
            result = await db_read.execute(
                select(models.Company)
                .where(models.Company.wbp_phone_number_id == phone_number_id)
                .options(joinedload(models.Company.users))
            )
            company = result.unique().scalars().first()

        if not company:
            logger.warning(f"WBP Webhook (Worker): Empresa não encontrada para wbp_phone_number_id {phone_number_id}")
            return
            
        user_id_log = company.users[0].id if company.users else None

        for message_data in messages:
            await _process_single_message(message_data, company, phone_number_id)

    except Exception as e:
        logger.error(f"WBP Webhook (Worker): ERRO CRÍTICO GERAL no processamento do 'value' (User: {user_id_log}): {e}", exc_info=True)


async def process_official_status_task(value_payload: dict):
    """
    Função de background (Oficial) que processa atualizações de status de mensagens na tabela 'mensagens'.
    """
    logger.info("WBP Webhook (Worker): Iniciando processamento de 'status'...")
    user_id_log = None
    msg_id_wamid_log = None

    try:
        metadata = value_payload.get('metadata', {})
        phone_number_id = metadata.get('phone_number_id')
        status_data_list = value_payload.get('statuses', [])

        if not phone_number_id or not status_data_list:
            logger.warning("WBP Webhook (Status): Payload de status incompleto (sem phone_number_id ou statuses).")
            return

        company: Optional[models.Company] = None
        async with SessionLocal() as db_read:
            result = await db_read.execute(
                select(models.Company)
                .where(models.Company.wbp_phone_number_id == phone_number_id)
                .options(joinedload(models.Company.users))
            )
            company = result.unique().scalars().first()

        if not company:
            logger.warning(f"WBP Webhook (Status): Empresa não encontrada para wbp_phone_number_id {phone_number_id}")
            return
            
        user_id_log = company.users[0].id if company.users else None

        for status_data in status_data_list:
            status = status_data.get('status')
            msg_id_wamid = status_data.get('id')
            recipient_id_num = status_data.get('recipient_id')
            msg_id_wamid_log = msg_id_wamid

            if not msg_id_wamid or not recipient_id_num:
                continue

            error_code = None
            error_title = None
            if status == 'failed':
                errors = status_data.get('errors', [{}])[0]
                error_code = errors.get('code')
                error_title = errors.get('title')
                logger.error(f"WBP Webhook: *** FALHA NA ENTREGA *** Msg ID={msg_id_wamid}, Dest={recipient_id_num}, Code={error_code}, Title='{error_title}'")

            async with SessionLocal() as db_update:
                async with db_update.begin():
                    updated_msg = await crud_atendimento.update_message_status(
                        db=db_update,
                        company_id=company.id,
                        message_id=msg_id_wamid,
                        status=status,
                        error_code=error_code,
                        error_title=error_title
                    )
                    if updated_msg:
                        logger.info(f"WBP Webhook (Status): Mensagem {msg_id_wamid} atualizada para status '{status}' na tabela mensagens.")
                    else:
                        logger.warning(f"WBP Webhook (Status): Mensagem {msg_id_wamid} não encontrada na tabela mensagens para atualizar status para '{status}'.")

    except Exception as e:
        logger.error(f"WBP Webhook (Status): ERRO CRÍTICO GERAL (User: {user_id_log}, Msg: {msg_id_wamid_log}): {e}", exc_info=True)