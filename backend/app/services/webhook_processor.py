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
from app.services.prospect_service import get_prospect_service
from app.services.security import decrypt_token

logger = logging.getLogger(__name__)

async def _process_single_message(message_data: Dict[str, Any], user: models.User, phone_number_id: str):
    """
    Processa UMA ÚNICA mensagem do webhook.
    """
    whatsapp_service = get_whatsapp_service()
    gemini_service = get_gemini_service()
    atendimento_id = None
    msg_id_wamid = message_data.get('id')

    try:
        msg_type = message_data.get('type')
        if msg_type == 'reaction':
            logger.info(f"WBP Webhook: Reação ignorada de {message_data.get('from')}.")
            return

        timestamp_s = int(message_data.get('timestamp', '0'))
        sender_number = message_data.get('from')

        if not sender_number or not msg_id_wamid:
            return

        cleaned_sender_number = format_whatsapp_number(sender_number)

        # --- Etapa 1: Obter ou Criar Atendimento (Mantido igual) ---
        async with SessionLocal() as db_session:
            result = await crud_atendimento.get_or_create_atendimento_by_number(db=db_session, number=cleaned_sender_number, user=user)
            if not result:
                return

            atendimento_obj, was_created = result
            await db_session.commit()
            atendimento_id = atendimento_obj.id

            try:
                current_conversa_list_for_context = json.loads(atendimento_obj.conversa or "[]")
            except (json.JSONDecodeError, TypeError):
                current_conversa_list_for_context = []
            
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

        # --- Lógica de Resposta (Mantida igual) ---
        context_data = message_data.get('context')
        if context_data and context_data.get('id'):
            replied_msg_id = context_data['id']
            original_msg = next((msg for msg in current_conversa_list_for_context if msg.get('id') == replied_msg_id), None)
            if original_msg:
                quote = (original_msg.get('content', '')[:100] + '...')
                reply_prefix = f"[Mensagem Referenciada]: \"{quote}\"\n"

        # --- Etapa 2: Processar Conteúdo ---
        if msg_type == 'text':
            formatted_msg_content = message_data.get('text', {}).get('body', '').strip()
            
            if formatted_msg_content == "/reset":
                # Lógica de reset mantida...
                async with SessionLocal() as db_delete:
                    at = await db_delete.get(models.Atendimento, atendimento_id)
                    if at: await db_delete.delete(at); await db_delete.commit()
                return 

        elif msg_type == 'interactive':
            # Trata respostas de botões e listas da API oficial (clique do usuário)
            interactive_data = message_data.get('interactive', {})
            interactive_type = interactive_data.get('type')
            if interactive_type == 'button_reply':
                formatted_msg_content = interactive_data.get('button_reply', {}).get('title', '')
            elif interactive_type == 'list_reply':
                formatted_msg_content = interactive_data.get('list_reply', {}).get('title', '')
            else:
                formatted_msg_content = "[Interação via botão]"

        elif msg_type == 'button':
            # Trata botões simples (quick replies)
            formatted_msg_content = message_data.get('button', {}).get('text', '')

        # --- ALTERAÇÃO PRINCIPAL AQUI: Tratamento de Mídia ---
        elif msg_type in ['image', 'audio', 'video', 'document', 'sticker']:
            media_obj = message_data.get(msg_type, {})
            media_id = media_obj.get('id')
            media_id_from_payload = media_id
            
            # Limpeza do mime_type (ex: 'audio/ogg; codecs=opus' -> 'audio/ogg')
            raw_mime = media_obj.get('mime_type', 'application/octet-stream')
            mime_type_original = raw_mime.split(';')[0].strip()
            
            caption = media_obj.get('caption', '').strip()

            if media_id:
                logger.info(f"WBP Webhook: Mídia {msg_type} recebida ({mime_type_original}). Baixando...")
                
                if not settings.WBP_ACCESS_TOKEN:
                    formatted_msg_content = f"[Mídia ({msg_type}) ignorada: Token não configurado no .env]"
                else:
                    try:
                        # 1. Pega token do settings
                        decrypted_token = settings.WBP_ACCESS_TOKEN
                        
                        # 2. Pega URL (Usa o service atualizado)
                        media_url = await whatsapp_service.get_media_url_official(media_id, decrypted_token)
                        
                        if media_url:
                            # 3. Baixa Bytes (Usa o service atualizado)
                            media_bytes = await whatsapp_service.download_media_official(media_url, decrypted_token)
                            
                            if media_bytes:
                                # Monta o pacote EXATAMENTE como o GeminiService espera
                                media_info_gemini = {
                                    "data": media_bytes,       # Chave 'data' com bytes
                                    "mime_type": raw_mime      # Passa o raw completo, o Gemini se vira
                                }
                                # Não definimos formatted_msg_content aqui, pois a IA vai gerar a descrição
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
            # Lógica de localização mantida igual
            loc = message_data.get('location', {})
            lat, lng = loc.get('latitude'), loc.get('longitude')
            if lat and lng:
                formatted_msg_content = f"[Localização]\nMaps: http://maps.google.com/?q={lat},{lng}"
                if loc.get('name'): formatted_msg_content += f"\nLocal: {loc.get('name')}"
                if loc.get('address'): formatted_msg_content += f"\nEndereço: {loc.get('address')}"
            else:
                formatted_msg_content = "[Localização sem coordenadas]"

        else:
            formatted_msg_content = f"[Mensagem tipo '{msg_type}' não suportada]"

        # --- Etapa 3: Análise de Mídia com IA (Gemini) ---
        if media_info_gemini:
            try:
                async with SessionLocal() as db_gemini_ctx:
                    # Precisamos buscar o usuário nesta sessão para que o decremento de tokens funcione
                    user_for_gemini = await db_gemini_ctx.get(models.User, user.id)
                    
                    if not user_for_gemini:
                        raise ValueError("Usuário não encontrado para sessão Gemini")

                    # Busca configurações do atendimento
                    stmt = select(models.Atendimento).where(models.Atendimento.id == atendimento_id).options(joinedload(models.Atendimento.active_persona))
                    atendimento_ctx = (await db_gemini_ctx.execute(stmt)).scalar_one()
                    
                    persona = atendimento_ctx.active_persona or await crud_config.get_config(db_gemini_ctx, user.default_persona_id, user.id)

                    # Chama o serviço atualizado
                    analysis_result = await gemini_service.transcribe_and_analyze_media(
                        media_data=media_info_gemini,
                        db_history=json.loads(atendimento_ctx.conversa or "[]"),
                        persona=persona,
                        db=db_gemini_ctx,
                        user=user_for_gemini,
                        atendimento_id=atendimento_id
                    )
                
                # Formata a mensagem final que vai para o banco
                prefix_tipo = "Áudio" if 'audio' in mime_type_original else "Imagem/Doc"
                formatted_msg_content = f"[{prefix_tipo} Transcrito]: {analysis_result}"
                
                if caption: 
                    formatted_msg_content += f"\n[Legenda Original]: {caption}"

            except Exception as e:
                logger.error(f"WBP Webhook: Falha na análise Gemini: {e}", exc_info=True)
                formatted_msg_content = f"[Mídia recebida ({mime_type_original}) - Falha na análise IA]"

        # --- Etapa 4: Salvar Mensagem (Mantido igual) ---
        if reply_prefix:
            formatted_msg_content = reply_prefix + formatted_msg_content

        if formatted_msg_content or media_id_from_payload:
            # Criação do objeto FormattedMessage e salvamento no banco...
            # (O código original de salvamento estava correto, mantive a lógica resumida aqui)
            formatted_msg = schemas.FormattedMessage(
                id=msg_id_wamid, role='user', content=formatted_msg_content,
                timestamp=timestamp_s, status='unread',
                type=msg_type if msg_type in ['image', 'audio', 'document', 'video', 'location'] else 'text',
                media_id=media_id_from_payload, mime_type=mime_type_original,
                filename=message_data.get('document', {}).get('filename')
            )
            
            async with SessionLocal() as db_save:
                async with db_save.begin():
                    atend = await db_save.get(models.Atendimento, atendimento_id, with_for_update=True)
                    if atend:
                        msgs = json.loads(atend.conversa or "[]")
                        if not any(m.get('id') == msg_id_wamid for m in msgs):
                            msgs.append(formatted_msg.model_dump())
                            msgs.sort(key=lambda x: x.get('timestamp') or 0)
                            atend.conversa = json.dumps(msgs, ensure_ascii=False)
                            if deve_mudar_status: atend.status = "Mensagem Recebida"
                            atend.updated_at = datetime.now(timezone.utc)
                            logger.info(f"WBP Webhook: Msg {msg_id_wamid} salva.")

            # --- NOTIFICAÇÃO PROSPECT AI (Fora da transação de salvamento) ---
            # Se o atendimento está em 'Atendente Chamado', notifica nova mensagem
            if atendimento_id:
                logger.info(f"WBP Webhook: Verificando se deve notificar ProspectAI para Atendimento {atendimento_id}")
                async with SessionLocal() as db_notify:
                    at_notify = await db_notify.get(models.Atendimento, atendimento_id, options=[joinedload(models.Atendimento.active_persona)])
                    if at_notify and at_notify.status and at_notify.status.strip() == "Atendente Chamado":
                        logger.info(f"WBP Webhook: Detectada nova mensagem em atendimento pendente ({atendimento_id}). Status atual: {at_notify.status}. Disparando...")
                        try:
                            user_notify = await db_notify.get(models.User, user.id)
                            persona_notify = at_notify.active_persona
                            if not persona_notify and user_notify.default_persona_id:
                                persona_notify = await db_notify.get(models.Config, user_notify.default_persona_id)
                            
                            if persona_notify:
                                prospect_service = get_prospect_service()
                                await prospect_service.notify_atendente_if_needed(
                                    db_notify, user_notify, at_notify, persona_notify, is_new_status=False
                                )
                        except Exception as notify_err:
                            logger.error(f"WBP Webhook: Erro ao disparar notificação ProspectAI: {notify_err}")

    except Exception as e:
        logger.error(f"WBP Webhook: Erro processamento single msg {msg_id_wamid}: {e}", exc_info=True)
        

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

            if not msg_id_wamid or not recipient_id_num:
                continue
            
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
                            logger.warning(f"WBP Webhook (Status): Msg {msg_id_wamid} status {status}. Atendimento para {cleaned_recipient_number} (User {user.id}) não encontrado.")
                            continue
                        
                        atendimento_id_log = atendimento.id # Para log

                        # 3. Atualizar JSON da Conversa
                        conversa_list = json.loads(atendimento.conversa or "[]")
                        message_found = False
                        status_hierarchy = {'sent': 1, 'delivered': 2, 'read': 3, 'failed': 4}
                        
                        for msg in conversa_list:
                            # Encontra a mensagem pelo WAMID
                            if msg.get('id') == msg_id_wamid:
                                message_found = True
                                current_status = msg.get('status', '')
                                current_level = status_hierarchy.get(current_status, 0)
                                new_level = status_hierarchy.get(status, 0)
                                
                                # Apenas atualiza se o novo status for mais "avançado" ou se for 'failed'
                                if new_level >= current_level or status == 'failed':
                                    msg['status'] = status
                                    if status == 'failed':
                                        errors = status_data.get('errors', [{}])[0]
                                        msg['error_code'] = errors.get('code')
                                        msg['error_title'] = errors.get('title')
                                        logger.error(f"WBP Webhook: *** FALHA NA ENTREGA (Recebido via Webhook) *** Msg ID={msg_id_wamid}, Dest={recipient_id_num}, Code={msg['error_code']}, Title='{msg['error_title']}'")
                                break
                        
                        if message_found:
                            atendimento.conversa = json.dumps(conversa_list, ensure_ascii=False)
                            if status == 'failed':
                                atendimento.updated_at = datetime.now(timezone.utc)
                            logger.info(f"WBP Webhook (Status): Atendimento {atendimento.id} atualizado com status '{status}' para msg {msg_id_wamid}.")
                        else:
                            logger.warning(f"WBP Webhook (Status): Mensagem {msg_id_wamid} NÃO encontrada no Atendimento {atendimento.id} para marcar como '{status}'.")
                
                except Exception as e:
                    logger.error(f"WBP Webhook (Status): Erro na TRANSAÇÃO ao processar '{status}' para msg {msg_id_wamid} (Atendimento {atendimento_id_log}): {e}", exc_info=True)
                    # O 'begin()' cuida do rollback
    
    except Exception as e:
        logger.error(f"WBP Webhook (Status): ERRO CRÍTICO GERAL (User: {user_id_log}, Msg: {msg_id_wamid_log}): {e}", exc_info=True)