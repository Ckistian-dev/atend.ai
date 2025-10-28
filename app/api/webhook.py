import logging
from fastapi import APIRouter, Request, BackgroundTasks, HTTPException, Response # Import Response
from app.db.database import SessionLocal, get_db # Import get_db
from app.crud import crud_user, crud_atendimento, crud_config # Import crud_config
from app.db import models, schemas # Import models
from app.core.config import settings # Import settings
from app.services.whatsapp_service import WhatsAppService, get_whatsapp_service # Import WhatsAppService
from app.services.gemini_service import GeminiService, get_gemini_service # Import GeminiService
from app.services.security import decrypt_token # Import decrypt_token
import json # Import json
from datetime import datetime, timezone # Import datetime, timezone
from sqlalchemy.future import select # Para usar select
from sqlalchemy.orm import joinedload # Para carregar relacionamentos
from typing import Optional # Importa Optional

logger = logging.getLogger(__name__)
router = APIRouter()

# ===============================================
# == Webhook para Evolution API (Não Oficial) ==
# ===============================================

async def set_atendimento_status_to_received_evolution(data: dict):
    """
    Função de background (Evolution) que marca o atendimento como 'Mensagem Recebida'.
    Refatorada para usar sessões curtas e evitar conflitos de transação.
    """
    instance_name = data.get('instance')
    message_data = data.get('data', {})
    key = message_data.get('key', {})
    contact_number_full = key.get('remoteJid', '')
    atendimento_id_to_update = None
    user_id_for_log = None # Para log em caso de erro

    try:
        if not instance_name or not contact_number_full or "@g.us" in contact_number_full:
            if "@g.us" in contact_number_full: logger.info(f"Evo Webhook: Mensagem de grupo ignorada: {contact_number_full}")
            else: logger.warning(f"Evo Webhook: Dados insuficientes (instância ou JID) ou mensagem de grupo.")
            return

        jid_part = contact_number_full.split('@')[0]
        contact_number = "".join(filter(str.isdigit, jid_part))

        # --- SESSÃO 1: Ler usuário e buscar/criar atendimento ---
        atendimento_reloaded = None # Define fora do with
        was_created = False
        async with SessionLocal() as db_read_evo:
            user = await crud_user.get_user_by_instance(db_read_evo, instance_name=instance_name)
            if not user:
                logger.warning(f"Evo Webhook: Usuário não encontrado para instância {instance_name}")
                return
            user_id_for_log = user.id

            if user.api_type != models.ApiType.evolution:
                logger.warning(f"Evo Webhook: Usuário {user.id} (instância {instance_name}) recebeu msg Evolution, mas está configurado para {user.api_type}. Ignorando.")
                return

            # Passa a sessão db_read_evo
            result = await crud_atendimento.get_or_create_atendimento_by_number(db=db_read_evo, number=contact_number, user=user)

            if not result:
                logger.error(f"Evo Webhook: Falha ao obter/criar atendimento para {contact_number} (User {user.id})")
                return

            atendimento, was_created = result
            # É importante commitar aqui para garantir que o atendimento/contato exista
            await db_read_evo.commit()

            if atendimento:
                atendimento_id_to_update = atendimento.id
                # Recarrega o atendimento após commit para garantir estado atualizado
                atendimento_reloaded = await db_read_evo.get(models.Atendimento, atendimento_id_to_update)
                if not atendimento_reloaded:
                     logger.error(f"Evo Webhook: Falha ao recarregar atendimento {atendimento_id_to_update} após commit na Sessão 1.")
                     return
            else:
                 logger.error(f"Evo Webhook: Atendimento retornou None após commit na Sessão 1 para {contact_number} (User {user.id})")
                 return


            # Verifica status DEPOIS de obter/criar e commitar, usando o objeto recarregado
            situacoes_de_parada = ["Ignorar Contato", "Atendente Chamado", "Concluído"]
            if not was_created and atendimento_reloaded.status in situacoes_de_parada:
                logger.info(f"Evo Webhook: Mensagem de {contact_number} ignorada. Atendimento ID {atendimento_reloaded.id} com status '{atendimento_reloaded.status}'.")
                atendimento_id_to_update = None # Não atualiza
                return
        # --- FIM SESSÃO 1 ---

        # --- SESSÃO 2: Atualizar Status (se necessário) ---
        if atendimento_id_to_update:
            async with SessionLocal() as db_update_evo:
                async with db_update_evo.begin(): # Inicia transação
                    atendimento_to_update = await db_update_evo.get(models.Atendimento, atendimento_id_to_update, with_for_update=True) # Trava a linha
                    if atendimento_to_update:
                        situacoes_de_parada_final = ["Ignorar Contato", "Atendente Chamado", "Concluído"]
                        if atendimento_to_update.status in situacoes_de_parada_final:
                             logger.info(f"Evo Webhook: Status do Atendimento {atendimento_id_to_update} mudou para '{atendimento_to_update.status}' antes do update. Abortando.")
                        else:
                            atendimento_to_update.status = "Mensagem Recebida"
                            atendimento_to_update.updated_at = datetime.now(timezone.utc)
                            logger.info(f"Evo Webhook: Atendimento ID {atendimento_id_to_update} ({contact_number}) marcado como 'Mensagem Recebida'.")
                    else:
                        logger.warning(f"Evo Webhook: Atendimento {atendimento_id_to_update} não encontrado na sessão de update.")
        # --- FIM SESSÃO 2 ---

    except Exception as e:
        logger.error(f"Evo Webhook (Background - Atendimento ID: {atendimento_id_to_update}, User: {user_id_for_log}): ERRO CRÍTICO: {e}", exc_info=True)


@router.post("/evolution/messages-upsert", summary="Receber eventos de novas mensagens (Evolution)")
async def receive_evolution_messages_upsert(request: Request, background_tasks: BackgroundTasks):
    """Endpoint para receber webhooks da Evolution API."""
    try:
        data = await request.json()
        is_new_message = (
            data.get("event") == "messages.upsert" and
            isinstance(data.get("data"), dict) and
            isinstance(data.get("data").get("key"), dict) and
            not data.get("data", {}).get("key", {}).get("fromMe", False) and
            data.get("instance")
        )

        if is_new_message:
            background_tasks.add_task(set_atendimento_status_to_received_evolution, data)
            return {"status": "message_triggered"}
        else:
            return {"status": "event_ignored_or_invalid"}

    except json.JSONDecodeError:
         logger.error("Evo Webhook: Erro ao decodificar JSON.")
         raise HTTPException(status_code=400, detail="Invalid JSON data")
    except Exception as e:
         logger.error(f"Evo Webhook: Erro inesperado ao processar corpo do webhook: {e}", exc_info=True)
         raise HTTPException(status_code=500, detail="Internal server error processing webhook")


# ===========================================
# == Webhook para API Oficial (Meta/WBP) ==
# ===========================================

async def process_official_message_task(value_payload: dict): # Recebe 'value'
    """
    Função de background (Oficial) que processa a mensagem, baixa mídia, chama IA e salva no DB.
    Refatorada para usar sessões curtas e evitar conflitos.
    Itera sobre múltiplas mensagens se vierem no mesmo 'value'.
    """
    logger.info("WBP Webhook (Background): Iniciando processamento de 'value'...")
    whatsapp_service = get_whatsapp_service()
    gemini_service = get_gemini_service()
    atendimento_id_log = None
    user_id_log = None

    try:
        metadata = value_payload.get('metadata', {})
        phone_number_id = metadata.get('phone_number_id')
        messages = value_payload.get('messages', [])
        contacts_data = value_payload.get('contacts', [{}])[0]
        profile_name = contacts_data.get('profile', {}).get('name', '')

        if not phone_number_id:
            logger.error("WBP Webhook (Background): phone_number_id não encontrado no payload 'value'.")
            return

        user: Optional[models.User] = None
        async with SessionLocal() as db_read_user:
            user = await crud_user.get_user_by_wbp_phone_number_id(db_read_user, phone_number_id=phone_number_id)

        if not user:
            logger.warning(f"WBP Webhook (Background): Usuário não encontrado para wbp_phone_number_id {phone_number_id}")
            return
        user_id_log = user.id

        if user.api_type != models.ApiType.official:
            logger.warning(f"WBP Webhook: Usuário {user.id} (WBP ID {phone_number_id}) recebeu msg Oficial, mas está configurado para {user.api_type}. Ignorando.")
            return

        for message_data in messages:
            atendimento_id_log = None
            atendimento_id = None # Define o ID do atendimento para este loop
            try:
                msg_type = message_data.get('type')
                msg_id_wamid = message_data.get('id')
                timestamp_s_str = message_data.get('timestamp', '0')
                try:
                    timestamp_s = int(timestamp_s_str)
                except ValueError:
                    logger.warning(f"WBP Webhook: Timestamp inválido recebido '{timestamp_s_str}' para msg {msg_id_wamid}. Usando 0.")
                    timestamp_s = 0
                sender_number = message_data.get('from')

                if not sender_number or not msg_id_wamid:
                    logger.warning(f"WBP Webhook (Background): Mensagem sem 'from' ou 'id'. Pulando. Payload msg: {message_data}")
                    continue

                cleaned_sender_number = "".join(filter(str.isdigit, sender_number))

                atendimento_reloaded_after_create: Optional[models.Atendimento] = None
                was_created = False
                async with SessionLocal() as db_get_create:
                    result = await crud_atendimento.get_or_create_atendimento_by_number(db=db_get_create, number=cleaned_sender_number, user=user)
                    if not result:
                        logger.error(f"WBP Webhook (Background): Falha CRÍTICA ao obter/criar atendimento para {cleaned_sender_number} (User {user.id})")
                        continue

                    atendimento_obj, was_created = result
                    await db_get_create.commit()

                    if atendimento_obj:
                         await db_get_create.refresh(atendimento_obj, ['contact', 'active_persona']) # Recarrega com relações
                         atendimento_reloaded_after_create = atendimento_obj
                         atendimento_id = atendimento_obj.id # Guarda o ID
                         atendimento_id_log = atendimento_obj.id
                    else:
                         logger.error(f"WBP Webhook: get_or_create retornou None mesmo sem erro explícito para {cleaned_sender_number}.")
                         continue

                if not atendimento_reloaded_after_create:
                     logger.error(f"WBP Webhook: Falha ao obter estado do atendimento {atendimento_id_log} após get/create.")
                     continue

                situacoes_de_parada = ["Ignorar Contato", "Atendente Chamado", "Concluído"]
                if not was_created and atendimento_reloaded_after_create.status in situacoes_de_parada:
                    logger.info(f"WBP Webhook: Mensagem {msg_id_wamid} de {cleaned_sender_number} ignorada. Atendimento ID {atendimento_reloaded_after_create.id} com status '{atendimento_reloaded_after_create.status}'.")
                    continue

                formatted_msg_content = ""
                media_info_gemini = None
                mime_type_original = None
                caption = ""
                media_id_from_payload = None

                if msg_type == 'text':
                    formatted_msg_content = message_data.get('text', {}).get('body', '').strip()
                    
                elif msg_type in ['image', 'audio', 'video', 'document', 'sticker']:
                    media_id = message_data.get(msg_type, {}).get('id')
                    mime_type_original = message_data.get(msg_type, {}).get('mime_type', 'application/octet-stream')
                    caption = message_data.get(msg_type, {}).get('caption', '').strip()
                    if media_id:
                        media_id_from_payload = media_id

                    if media_id:
                        logger.info(f"WBP Webhook: Mídia recebida (Tipo: {msg_type}, ID: {media_id}) para msg {msg_id_wamid}. Baixando...")
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
                                        logger.info(f"WBP Webhook: Mídia {media_id} ...")
                                        media_info_gemini = {"mime_type": mime_type_original, "data": media_bytes}
                                    else: formatted_msg_content = f"[Mídia ({msg_type}) recebida, falha no download]"
                                else: formatted_msg_content = f"[Mídia ({msg_type}) recebida, mas ID ausente no payload]"
                            except Exception as decrypt_err:
                                logger.error(f"WBP Webhook: Falha ao descriptografar token para baixar mídia {media_id} (User {user.id}): {decrypt_err}")
                                formatted_msg_content = f"[Mídia ({msg_type}) recebida, falha ao baixar: Erro de token]"
                    else: formatted_msg_content = f"[Mídia ({msg_type}) recebida, mas ID ausente no payload]"

                    if caption and not media_info_gemini:
                        caption_text = f"\n[Legenda]: {caption}"
                        if formatted_msg_content: formatted_msg_content += caption_text
                        else: formatted_msg_content = caption_text

                elif msg_type == 'contacts':
                    contacts_list = message_data.get('contacts', [])
                    contact_names = [f"{c.get('name',{}).get('formatted_name','N/A')} ({c.get('phones',[{}])[0].get('wa_id','N/A')})" for c in contacts_list]
                    formatted_msg_content = f"[Contato compartilhado]: {', '.join(contact_names)}"
                elif msg_type == 'location':
                    lat = message_data.get('location',{}).get('latitude')
                    lon = message_data.get('location',{}).get('longitude')
                    name = message_data.get('location',{}).get('name')
                    address = message_data.get('location',{}).get('address')
                    formatted_msg_content = f"[Localização compartilhada]: {name or 'Localização'} ({lat}, {lon}) {address or ''}"
                else:
                    logger.info(f"WBP Webhook: Tipo de mensagem não tratado recebido: {msg_type} para msg {msg_id_wamid}. Payload: {message_data}")
                    formatted_msg_content = f"[Mensagem do tipo '{msg_type}' recebida, conteúdo não processado]"

                if media_info_gemini:
                    try:
                        analysis_result = None # Define a variável
                        async with SessionLocal() as db_gemini_ctx:
                            stmt = select(models.Atendimento).where(models.Atendimento.id == atendimento_id)\
                                .options(joinedload(models.Atendimento.active_persona))
                            result_at = await db_gemini_ctx.execute(stmt)
                            atendimento_ctx_ia = result_at.scalar_one_or_none()

                            if not atendimento_ctx_ia: raise ValueError("Atendimento não encontrado na sessão Gemini.")

                            current_conversa_list_for_context = json.loads(atendimento_ctx_ia.conversa or "[]")
                            persona_config = atendimento_ctx_ia.active_persona
                            if not persona_config:
                                if user.default_persona_id: persona_config = await crud_config.get_config(db_gemini_ctx, user.default_persona_id, user.id)
                            if not persona_config: raise ValueError("Nenhuma persona encontrada para análise de mídia.")

                            user_for_gemini = await db_gemini_ctx.get(models.User, user.id)
                            if not user_for_gemini: raise ValueError("Usuário não encontrado na sessão Gemini.")

                            analysis_result = await gemini_service.transcribe_and_analyze_media(
                                media_info_gemini, current_conversa_list_for_context,
                                persona_config, persona_config.contexto_json,
                                db_gemini_ctx, user_for_gemini
                            )

                        prefix = "[Áudio transcrito]" if msg_type == 'audio' else f"[Análise de Mídia ({mime_type_original})]"
                        formatted_msg_content = f"{prefix}: {analysis_result or 'Falha na análise'}" # <--- Já preenche o content
                        if caption: formatted_msg_content += f"\n[Legenda]: {caption}"

                    except Exception as gemini_err:
                        logger.error(f"WBP Webhook: Erro Gemini ao analisar mídia ID {media_id} (msg {msg_id_wamid}): {gemini_err}", exc_info=True)
                        formatted_msg_content = f"[Mídia ({msg_type}) recebida ({mime_type_original}), erro na análise/transcrição]" # <--- Preenche em caso de erro

                if formatted_msg_content or media_id_from_payload: # Salva se tiver texto OU media_id
                    formatted_msg = schemas.FormattedMessage(
                        id=msg_id_wamid,
                        role='user',
                        content=formatted_msg_content or None, # <--- Usa o content gerado
                        timestamp=timestamp_s,
                        type=msg_type if msg_type in ['image', 'audio', 'document', 'video', 'sticker'] else 'text',
                        media_id=media_id_from_payload, # <<-- SALVA O media_id
                        mime_type=mime_type_original,   # <<-- SALVA O mime_type
                        filename=message_data.get('document', {}).get('filename') # Salva filename se for documento
                    )
                    try:
                        async with SessionLocal() as db_save_msg:
                            async with db_save_msg.begin():
                                atendimento_to_update = await db_save_msg.get(models.Atendimento, atendimento_id, with_for_update=True)
                                if not atendimento_to_update:
                                    logger.error(f"WBP Webhook: Atendimento {atendimento_id} desapareceu antes de salvar msg {msg_id_wamid}.")
                                    continue

                                try:
                                    current_conversa_str = atendimento_to_update.conversa or "[]"
                                    current_conversa_list = json.loads(current_conversa_str)
                                except (json.JSONDecodeError, TypeError):
                                    logger.warning(f"WBP Webhook: Conversa JSON inválida ao salvar msg {msg_id_wamid}. Reiniciando.")
                                    current_conversa_list = []

                                current_conversa_list.append(formatted_msg.model_dump())
                                current_conversa_list.sort(key=lambda x: x.get('timestamp') or 0)

                                atendimento_to_update.conversa = json.dumps(current_conversa_list, ensure_ascii=False)
                                atendimento_to_update.status = "Mensagem Recebida"
                                atendimento_to_update.updated_at = datetime.now(timezone.utc)

                            logger.info(f"WBP Webhook: Mensagem {msg_id_wamid} adicionada e status atualizado para Atendimento {atendimento_id}.")

                    except Exception as save_err:
                        logger.error(f"WBP Webhook: Erro na TRANSAÇÃO ao salvar msg {msg_id_wamid} no Atendimento {atendimento_id}: {save_err}", exc_info=True)
                        continue
                else:
                     logger.info(f"WBP Webhook: Mensagem {msg_id_wamid} (tipo {msg_type}) não gerou conteúdo processável.")

            except Exception as inner_loop_err:
                 logger.error(f"WBP Webhook (Background): Erro INESPERADO no loop interno para msg {msg_id_wamid} (Atendimento ID: {atendimento_id_log}, User: {user_id_log}): {inner_loop_err}", exc_info=True)
                 continue

    except Exception as e:
        logger.error(f"WBP Webhook (Background): ERRO CRÍTICO GERAL no processamento do 'value' (User: {user_id_log}): {e}", exc_info=True)


async def process_official_status_task(value_payload: dict):
    """
    Função de background (Oficial) que processa atualizações de status de mensagens (ex: falhas).
    """
    logger.info("WBP Webhook (Background): Iniciando processamento de 'status'...")
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
                        stmt_contact = select(models.Contact).where(
                            models.Contact.whatsapp == cleaned_recipient_number,
                            models.Contact.user_id == user.id
                        )
                        contact_result = await db_update.execute(stmt_contact)
                        contact = contact_result.scalar_one_or_none()

                        if not contact:
                            logger.warning(f"WBP Webhook (Status): Falha para msg {msg_id_wamid}. Contato {cleaned_recipient_number} (User {user.id}) não encontrado.")
                            continue
                        
                        # 2. Encontrar Atendimento
                        stmt_atendimento = select(models.Atendimento).where(
                            models.Atendimento.contact_id == contact.id,
                            models.Atendimento.user_id == user.id
                        ).with_for_update() # Trava a linha
                        
                        atendimento_result = await db_update.execute(stmt_atendimento)
                        atendimento = atendimento_result.scalar_one_or_none()
                        
                        if not atendimento:
                            logger.warning(f"WBP Webhook (Status): Falha para msg {msg_id_wamid}. Atendimento para Contato {contact.id} (User {user.id}) não encontrado.")
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

@router.post("/official/webhook", summary="Receber eventos da API Oficial (Meta)")
async def receive_official_webhook(request: Request, background_tasks: BackgroundTasks):
    """
    Endpoint para receber webhooks da API Oficial do WhatsApp (Meta).
    Modificado para iterar sobre 'entry' e 'changes'.
    """
    try:
        payload = await request.json()
        if payload.get('object') == 'whatsapp_business_account' and isinstance(payload.get('entry'), list):
            for entry in payload['entry']:
                if isinstance(entry.get('changes'), list):
                    for change in entry['changes']:
                        if isinstance(change.get('value'), dict):
                            value_payload = change['value']
                            messages = value_payload.get('messages')
                            statuses = value_payload.get('statuses')

                            if messages:
                                background_tasks.add_task(process_official_message_task, value_payload)
                            elif statuses:
                                # Em vez de apenas logar, chamamos a task para processar o status
                                # A task cuidará de logar a falha e atualizar o DB
                                background_tasks.add_task(process_official_status_task, value_payload)
                                
            return Response(status_code=200)
        else:
            logger.warning(f"WBP Webhook: Payload recebido com estrutura inválida ou 'object' não esperado: {payload}")
            raise HTTPException(status_code=400, detail="Invalid payload structure")

    except json.JSONDecodeError:
         logger.error("WBP Webhook: Erro ao decodificar JSON.")
         raise HTTPException(status_code=400, detail="Invalid JSON data")
    except Exception as e:
         logger.error(f"WBP Webhook: Erro inesperado no endpoint principal: {e}", exc_info=True)
         raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/official/webhook", summary="Verificar webhook da API Oficial (Meta)")
async def verify_official_webhook(request: Request):
    """
    Endpoint GET para a verificação inicial do webhook pela Meta.
    """
    verify_token = request.query_params.get('hub.verify_token')
    mode = request.query_params.get('hub.mode')
    challenge = request.query_params.get('hub.challenge')

    if not settings.WBP_VERIFY_TOKEN:
         logger.error("WBP Webhook Verify: WBP_VERIFY_TOKEN não configurado!")
         raise HTTPException(status_code=500, detail="Server configuration error")

    if mode == 'subscribe' and verify_token == settings.WBP_VERIFY_TOKEN:
         logger.info("WBP Webhook: Verificação GET bem-sucedida!")
         return Response(content=challenge, status_code=200, media_type="text/plain")
    else:
         logger.warning(f"WBP Webhook: Falha na verificação GET. Modo: {mode}, Token Recebido: '{verify_token}'")
         raise HTTPException(status_code=403, detail="Verification token mismatch")

