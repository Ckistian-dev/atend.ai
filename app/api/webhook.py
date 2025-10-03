# app/api/webhook.py

import logging
import json
import asyncio
from fastapi import APIRouter, Request, BackgroundTasks, HTTPException
from app.db.database import SessionLocal
from app.crud import crud_user, crud_atendimento
from app.services.whatsapp_service import get_whatsapp_service
from app.services.gemini_service import get_gemini_service
from app.db import schemas
from typing import Dict, List

logger = logging.getLogger(__name__)
router = APIRouter()

async def _format_history_for_db(
    raw_history: List[dict], 
    instance_name: str, 
    contact_number: str
) -> List[Dict[str, str]]:
    """
    Formata o histórico bruto da API do WhatsApp para o formato do banco de dados,
    processando mídias (áudios, imagens, documentos) conforme necessário.
    """
    history_list = []
    whatsapp_service = get_whatsapp_service()
    gemini_service = get_gemini_service()

    for msg in reversed(raw_history):
        try:
            msg_content = msg.get("message", {})
            if not msg_content:
                continue

            role = "assistant" if msg.get("key", {}).get("fromMe") else "user"
            content = ""
            
            if msg_content.get("conversation") or msg_content.get("extendedTextMessage"):
                content = msg_content.get("conversation") or msg_content.get("extendedTextMessage", {}).get("text", "")
            
            elif msg_content.get("audioMessage"):
                logger.info(f"Áudio encontrado no histórico de {contact_number}. Processando...")
                media_data = await whatsapp_service.get_media_and_convert(instance_name, msg)
                if media_data:
                    transcription = gemini_service.transcribe_and_analyze_media(media_data, history_list)
                    content = f"[Áudio transcrito]: {transcription}"
                else:
                    content = "[Falha ao processar áudio do histórico]"
            
            elif msg_content.get("imageMessage") or msg_content.get("documentMessage"):
                logger.info(f"Mídia (imagem/doc) encontrada no histórico de {contact_number}. Processando...")
                media_data = await whatsapp_service.get_media_and_convert(instance_name, msg)
                if media_data:
                    analysis = gemini_service.transcribe_and_analyze_media(media_data, history_list)
                    content = f"[Análise de Mídia]: {analysis}"
                else:
                    content = "[Falha ao processar mídia do histórico]"

            if content:
                history_list.append({"role": role, "content": content})
        
        except Exception as e:
            logger.warning(f"Não foi possível processar uma mensagem do histórico: {e} - Mensagem: {msg}")
            continue
            
    return history_list


async def process_incoming_message(data: dict):
    """
    Processa uma mensagem recebida do webhook.
    """
    async with SessionLocal() as db:
        try:
            instance_name = data.get('instance')
            message_data = data.get('data', {})
            key = message_data.get('key', {})
            contact_number_full = key.get('remoteJid', '')
            if not contact_number_full: return
            
            # Verifica se o JID da mensagem contém '@g.us', indicando que é um grupo.
            if "@g.us" in contact_number_full:
                logger.info(f"Mensagem de grupo ignorada, vinda de: {contact_number_full}")
                return # Interrompe o processamento para esta mensagem
            
            contact_number = contact_number_full.split('@')[0]
            
            user = await crud_user.get_user_by_instance(db, instance_name=instance_name)
            if not user: return

            result = await crud_atendimento.get_or_create_atendimento_by_number(db, number=contact_number, user=user)
            if not result: return

            atendimento, was_created = result
            
            situacoes_de_parada = ["Ignorar Contato", "Atendente Chamado", "Concluído"]
            if not was_created and atendimento.status in situacoes_de_parada:
                logger.info(f"Mensagem recebida de {contact_number}, mas o atendimento ID {atendimento.id} está com status '{atendimento.status}'. A nova mensagem será ignorada.")
                return

            history_list = []
            
            whatsapp_service = get_whatsapp_service()
            gemini_service = get_gemini_service()

            if was_created:
                logger.info(f"Novo atendimento. Buscando as últimas 32 mensagens para {contact_number}...")
                raw_history = await whatsapp_service.fetch_chat_history(instance_name, contact_number, count=32)
                
                if raw_history:
                    history_list = await _format_history_for_db(raw_history, instance_name, contact_number)
                    logger.info(f"Histórico de {len(history_list)} mensagens formatado e pronto para o DB.")
            else:
                try:
                    history_list = json.loads(atendimento.conversa) if atendimento.conversa else []
                except (json.JSONDecodeError, TypeError):
                    history_list = []
            
            current_message_content = message_data.get('message', {})
            content_for_history = ""
            
            if current_message_content.get('conversation') or current_message_content.get('extendedTextMessage'):
                content_for_history = current_message_content.get('conversation') or current_message_content.get('extendedTextMessage', {}).get('text', '')
            
            elif "audioMessage" in current_message_content:
                media_data = await whatsapp_service.get_media_and_convert(instance_name, message_data)
                if media_data:
                    transcription = gemini_service.transcribe_and_analyze_media(media_data, history_list)
                    content_for_history = f"[Áudio transcrito]: {transcription}"
                else:
                    content_for_history = "[Falha ao processar áudio recebido]"

            elif "imageMessage" in current_message_content or "documentMessage" in current_message_content:
                media_data = await whatsapp_service.get_media_and_convert(instance_name, message_data)
                if media_data:
                    analysis = gemini_service.transcribe_and_analyze_media(media_data, history_list)
                    content_for_history = f"[Análise de Mídia]: {analysis}"
                else:
                    content_for_history = "[Falha ao processar mídia recebida]"

            if not content_for_history or not content_for_history.strip():
                logger.info(f"Mensagem de {contact_number} não continha conteúdo processável. Ignorando.")
                return
            
            history_list.append({"role": "user", "content": content_for_history})

            new_conversation_history = json.dumps(history_list)

            atendimento_update = schemas.AtendimentoUpdate(
                conversa=new_conversation_history,
                status="Resposta Recebida"
            )
            await crud_atendimento.update_atendimento(db, db_atendimento=atendimento, atendimento_in=atendimento_update)
            
            await db.commit()
            
            logger.info(f"Mensagem de '{contact_number}' processada. Histórico atualizado no atendimento {atendimento.id}.")

        except Exception as e:
            await db.rollback()
            logger.error(f"ERRO CRÍTICO no processamento do webhook: {e}", exc_info=True)


@router.post("/evolution/messages-upsert", summary="Receber eventos de novas mensagens")
async def receive_evolution_messages_upsert(request: Request, background_tasks: BackgroundTasks):
    try:
        data = await request.json()
        is_new_message = (
            data.get("event") == "messages.upsert" and
            not data.get("data", {}).get("key", {}).get("fromMe", False)
        )

        if is_new_message:
            background_tasks.add_task(process_incoming_message, data)

        return {"status": "message_received"}
    except Exception as e:
        logger.error(f"Erro ao processar corpo do webhook: {e}")
        return {"status": "error"}