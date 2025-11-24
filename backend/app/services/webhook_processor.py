import logging
import json
from datetime import datetime, timezone
from sqlalchemy.future import select
from sqlalchemy.orm import joinedload
from typing import Optional, Dict, Any

from app.db.database import SessionLocal
from app.crud import crud_user, crud_atendimento, crud_config
from app.db import models, schemas
from app.services.whatsapp_service import get_whatsapp_service
from app.services.gemini_service import get_gemini_service
from app.services.security import decrypt_token

logger = logging.getLogger(__name__)

async def _process_single_message(message_data: Dict[str, Any], user: models.User, phone_number_id: str):
    """
    Processa UMA ÚNICA mensagem do webhook. Esta função é isolada para evitar vazamento de estado.
    """
    whatsapp_service = get_whatsapp_service()
    gemini_service = get_gemini_service()
    atendimento_id = None
    msg_id_wamid = message_data.get('id')

    try:
        msg_type = message_data.get('type')
        timestamp_s_str = message_data.get('timestamp', '0')
        try:
            timestamp_s = int(timestamp_s_str)
        except ValueError:
            logger.warning(f"WBP Webhook: Timestamp inválido '{timestamp_s_str}' para msg {msg_id_wamid}. Usando 0.")
            timestamp_s = 0
        sender_number = message_data.get('from')

        if not sender_number or not msg_id_wamid:
            logger.warning(f"WBP Webhook (Worker): Mensagem sem 'from' ou 'id'. Pulando. Payload: {message_data}")
            return

        cleaned_sender_number = "".join(filter(str.isdigit, sender_number))

        # --- Etapa 1: Obter ou Criar Atendimento ---
        async with SessionLocal() as db_session:
            result = await crud_atendimento.get_or_create_atendimento_by_number(db=db_session, number=cleaned_sender_number, user=user)
            if not result:
                logger.error(f"WBP Webhook: Falha CRÍTICA ao obter/criar atendimento para {cleaned_sender_number} (User {user.id})")
                return

            atendimento_obj, was_created = result
            await db_session.commit()
            atendimento_id = atendimento_obj.id
            
            # Status que, se o atendimento já tiver, não devem ser alterados para "Mensagem Recebida".
            status_que_bloqueiam_reabertura = ["Ignorar Contato", "Atendente Chamado"]
            deve_mudar_status = True
            if not was_created and atendimento_obj.status in status_que_bloqueiam_reabertura:
                logger.info(f"WBP Webhook: Mensagem {msg_id_wamid} de {cleaned_sender_number}. Atendimento ID {atendimento_id} está em '{atendimento_obj.status}', status NÃO será alterado.")
                deve_mudar_status = False

        # --- Etapa 2: Processar Conteúdo da Mensagem (Texto, Mídia, etc.) ---
        formatted_msg_content = ""
        media_info_gemini = None
        mime_type_original = None
        caption = ""
        media_id_from_payload = None

        if msg_type == 'text':
            formatted_msg_content = message_data.get('text', {}).get('body', '').strip()
        
        elif msg_type in ['image', 'audio', 'video', 'document', 'sticker']:
            media_obj = message_data.get(msg_type, {})
            media_id = media_obj.get('id')
            media_id_from_payload = media_id
            mime_type_original = media_obj.get('mime_type', 'application/octet-stream')
            caption = media_obj.get('caption', '').strip()

            if media_id:
                logger.info(f"WBP Webhook: Mídia recebida (Tipo: {msg_type}, ID: {media_id}). Baixando...")
                if not user.wbp_access_token:
                    logger.error(f"WBP Webhook: User {user.id} não tem wbp_access_token para baixar mídia {media_id}.")
                    formatted_msg_content = f"[Mídia ({msg_type}) recebida, falha ao baixar: Token ausente]"
                else:
                    try:
                        decrypted_token = decrypt_token(user.wbp_access_token)
                        media_url = await whatsapp_service.get_media_url_official(media_id, decrypted_token)
                        if media_url:
                            media_bytes = await whatsapp_service.download_media_official(media_url, decrypted_token)
                            if media_bytes:
                                media_info_gemini = {"mime_type": mime_type_original, "data": media_bytes}
                            else: formatted_msg_content = f"[Mídia ({msg_type}) recebida, falha no download]"
                        else: formatted_msg_content = f"[Mídia ({msg_type}) recebida, falha ao obter URL]"
                    except Exception as media_err:
                        logger.error(f"WBP Webhook: Falha ao baixar/descriptografar mídia {media_id} (User {user.id}): {media_err}")
                        formatted_msg_content = f"[Mídia ({msg_type}) recebida, falha ao baixar: Erro de token/processamento]"
            else:
                formatted_msg_content = f"[Mídia ({msg_type}) recebida, mas ID ausente no payload]"

            if caption and not media_info_gemini:
                formatted_msg_content += f"\n[Legenda]: {caption}"

        # ... (outros tipos de mensagem como 'contacts', 'location') ...
        else:
            logger.info(f"WBP Webhook: Tipo de mensagem não tratado: {msg_type}. Payload: {message_data}")
            formatted_msg_content = f"[Mensagem do tipo '{msg_type}' recebida, conteúdo não processado]"

        # --- Etapa 3: Análise de Mídia com IA (se aplicável) ---
        if media_info_gemini:
            try:
                async with SessionLocal() as db_gemini_ctx:
                    # Busca o atendimento e suas relações necessárias para a IA
                    stmt = select(models.Atendimento).where(models.Atendimento.id == atendimento_id).options(joinedload(models.Atendimento.active_persona))
                    atendimento_ctx_ia = (await db_gemini_ctx.execute(stmt)).scalar_one()
                    
                    current_conversa_list = json.loads(atendimento_ctx_ia.conversa or "[]")
                    persona_config = atendimento_ctx_ia.active_persona or await crud_config.get_config(db_gemini_ctx, user.default_persona_id, user.id)
                    
                    if not persona_config: raise ValueError("Nenhuma persona (ativa ou padrão) encontrada para análise de mídia.")

                    user_for_gemini = await db_gemini_ctx.get(models.User, user.id)
                    if not user_for_gemini: raise ValueError("Usuário não encontrado na sessão Gemini.")

                    analysis_result = await gemini_service.transcribe_and_analyze_media(
                        media_info_gemini, current_conversa_list, persona_config.contexto_json, db_gemini_ctx, user_for_gemini
                    )

                prefix = "[Áudio transcrito]" if 'audio' in mime_type_original else f"[Análise de Mídia ({mime_type_original})]"
                formatted_msg_content = f"{prefix}: {analysis_result or 'Falha na análise'}"
                if caption: formatted_msg_content += f"\n[Legenda]: {caption}"

            except Exception as gemini_err:
                logger.error(f"WBP Webhook: Erro Gemini ao analisar mídia (msg {msg_id_wamid}): {gemini_err}", exc_info=True)
                formatted_msg_content = f"[Mídia ({msg_type}) recebida ({mime_type_original}), erro na análise/transcrição]"

        # --- Etapa 4: Salvar Mensagem no Banco de Dados ---
        if formatted_msg_content or media_id_from_payload:
            formatted_msg = schemas.FormattedMessage(
                id=msg_id_wamid, role='user', content=formatted_msg_content or None,
                timestamp=timestamp_s, status='unread',
                type=msg_type if msg_type in ['image', 'audio', 'document', 'video', 'sticker'] else 'text',
                media_id=media_id_from_payload, mime_type=mime_type_original,
                filename=message_data.get('document', {}).get('filename')
            )
            
            async with SessionLocal() as db_save_msg:
                async with db_save_msg.begin(): # Inicia uma transação
                    atendimento_to_update = await db_save_msg.get(models.Atendimento, atendimento_id, with_for_update=True)
                    if not atendimento_to_update:
                        logger.error(f"WBP Webhook: Atendimento {atendimento_id} desapareceu antes de salvar msg {msg_id_wamid}.")
                        return

                    try:
                        current_conversa_list = json.loads(atendimento_to_update.conversa or "[]")
                    except (json.JSONDecodeError, TypeError):
                        current_conversa_list = []

                    # Evita duplicatas
                    if any(m.get('id') == msg_id_wamid for m in current_conversa_list):
                        logger.warning(f"WBP Webhook: Mensagem {msg_id_wamid} já existe no atendimento {atendimento_id}. Pulando salvamento.")
                        return

                    current_conversa_list.append(formatted_msg.model_dump())
                    current_conversa_list.sort(key=lambda x: x.get('timestamp') or 0)
                    atendimento_to_update.conversa = json.dumps(current_conversa_list, ensure_ascii=False)
                    
                    if deve_mudar_status:
                        atendimento_to_update.status = "Mensagem Recebida"
                    
                    atendimento_to_update.updated_at = datetime.now(timezone.utc)
            
            logger.info(f"WBP Webhook: Mensagem {msg_id_wamid} salva no Atendimento {atendimento_id}.")
        else:
            logger.info(f"WBP Webhook: Mensagem {msg_id_wamid} (tipo {msg_type}) não gerou conteúdo para salvar.")

    except Exception as e:
        logger.error(f"WBP Webhook: Erro INESPERADO no processamento da msg {msg_id_wamid} (Atendimento {atendimento_id}): {e}", exc_info=True)
        # Não relance o erro para que a mensagem seja confirmada no RabbitMQ e não tente novamente.

async def process_official_message_task(value_payload: dict): # Recebe 'value'
    """
    Função principal que recebe o payload 'value' do webhook, encontra o usuário
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

        user: Optional[models.User] = None
        async with SessionLocal() as db_read_user:
            user = await crud_user.get_user_by_wbp_phone_number_id(db_read_user, phone_number_id=phone_number_id)

        if not user:
            logger.warning(f"WBP Webhook (Worker): Usuário não encontrado para wbp_phone_number_id {phone_number_id}")
            return
        user_id_log = user.id

        for message_data in messages:
            # Chama a função isolada para cada mensagem.
            # O `await` aqui garante que as mensagens de um mesmo webhook sejam processadas sequencialmente,
            # o que é mais seguro para evitar race conditions no mesmo atendimento.
            await _process_single_message(message_data, user, phone_number_id)

    except Exception as e:
        logger.error(f"WBP Webhook (Worker): ERRO CRÍTICO GERAL no processamento do 'value' (User: {user_id_log}): {e}", exc_info=True)


async def process_official_status_task(value_payload: dict):
    """
    Função de background (Oficial) que processa atualizações de status de mensagens (ex: falhas).
    """
    logger.info("WBP Webhook (Worker): Iniciando processamento de 'status'...")
    user_id_log = None
    atendimento_id_log = None
    msg_id_wamid_log = None

    try:
        metadata = value_payload.get('metadata', {})
        phone_number_id = metadata.get('phone_number_id')
        status_data_list = value_payload.get('statuses', [])

        if not phone_number_id or not status_data_list:
            logger.warning("WBP Webhook (Status): Payload de status incompleto (sem phone_number_id ou statuses).")
            return

        # --- SESSÃO 1: Obter Usuário ---
        user: Optional[models.User] = None
        async with SessionLocal() as db_read_user:
            user = await crud_user.get_user_by_wbp_phone_number_id(db_read_user, phone_number_id=phone_number_id)

        if not user:
            logger.warning(f"WBP Webhook (Status): Usuário não encontrado para wbp_phone_number_id {phone_number_id}")
            return
        user_id_log = user.id

        # --- Processa cada status no payload ---
        for status_data in status_data_list:
            status = status_data.get('status')
            msg_id_wamid = status_data.get('id')
            recipient_id_num = status_data.get('recipient_id')
            msg_id_wamid_log = msg_id_wamid # Para log de erro

            # Só nos importamos com 'failed'
            if status != 'failed' or not msg_id_wamid or not recipient_id_num:
                logger.info(f"WBP Webhook (Status): Status '{status}' ignorado para msg {msg_id_wamid}.")
                continue
            
            errors = status_data.get('errors', [{}])[0]
            error_code = errors.get('code')
            error_title = errors.get('title')
            
            # Logamos a falha aqui, pois é o ponto de entrada
            logger.error(f"WBP Webhook: *** FALHA NA ENTREGA (Recebido via Webhook) *** Msg ID={msg_id_wamid}, Dest={recipient_id_num}, Code={error_code}, Title='{error_title}'")

            cleaned_recipient_number = "".join(filter(str.isdigit, recipient_id_num))

            # --- SESSÃO 2: Atualizar Atendimento ---
            async with SessionLocal() as db_update:
                try:
                    async with db_update.begin():
                        # 1. Encontrar Contato (Precisamos do contato para achar o atendimento)
                        stmt_atendimento = select(models.Atendimento).where(
                            models.Atendimento.whatsapp == cleaned_recipient_number,
                            models.Atendimento.user_id == user.id
                        )
                        
                        atendimento_result = await db_update.execute(stmt_atendimento)
                        atendimento = atendimento_result.scalar_one_or_none()
                        
                        if not atendimento:
                            logger.warning(f"WBP Webhook (Status): Falha para msg {msg_id_wamid}. Contato {cleaned_recipient_number} (User {user.id}) não encontrado.")
                            continue
                        
                        if not atendimento:
                            logger.warning(f"WBP Webhook (Status): Falha para msg {msg_id_wamid}. Atendimento para Contato {atendimento.whatsapp} (User {user.id}) não encontrado.")
                            continue
                        
                        atendimento_id_log = atendimento.id # Para log

                        # 3. Atualizar JSON da Conversa
                        conversa_list = json.loads(atendimento.conversa or "[]")
                        message_found = False
                        for msg in conversa_list:
                            # Encontra a mensagem pelo WAMID
                            if msg.get('id') == msg_id_wamid:
                                msg['status'] = 'failed'
                                msg['error_code'] = error_code
                                msg['error_title'] = error_title
                                message_found = True
                                break
                        
                        if message_found:
                            atendimento.conversa = json.dumps(conversa_list, ensure_ascii=False)
                            atendimento.updated_at = datetime.now(timezone.utc)
                            # O 'begin()' cuida do commit
                            logger.info(f"WBP Webhook (Status): Atendimento {atendimento.id} atualizado com status 'failed' para msg {msg_id_wamid}.")
                        else:
                            logger.warning(f"WBP Webhook (Status): Mensagem {msg_id_wamid} NÃO encontrada no Atendimento {atendimento.id} para marcar como 'failed'.")
                
                except Exception as e:
                    logger.error(f"WBP Webhook (Status): Erro na TRANSAÇÃO ao processar 'failed' para msg {msg_id_wamid} (Atendimento {atendimento_id_log}): {e}", exc_info=True)
                    # O 'begin()' cuida do rollback
    
    except Exception as e:
        logger.error(f"WBP Webhook (Status): ERRO CRÍTICO GERAL (User: {user_id_log}, Msg: {msg_id_wamid_log}): {e}", exc_info=True)