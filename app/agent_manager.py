import asyncio
import json
import logging
import random
from typing import Dict, List, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timezone

from app.db.database import SessionLocal
from app.crud import crud_atendimento, crud_user, crud_config
from app.services.whatsapp_service import WhatsAppService, get_whatsapp_service, MessageSendError
from app.services.gemini_service import GeminiService, get_gemini_service
from app.db import models, schemas

logger = logging.getLogger(__name__)

agent_status: Dict[int, bool] = {}

async def _process_raw_message(
    raw_msg: dict, 
    history_list_for_context: list,
    instance_name: str, 
    persona_config: models.Config, 
    whatsapp_service: WhatsAppService, 
    gemini_service: GeminiService,
    db: AsyncSession,
    user: models.User
) -> Optional[Dict[str, Any]]:
    """
    Processa uma mensagem bruta da API, transcreve mídias se necessário, e retorna um dicionário formatado.
    """
    try:
        key = raw_msg.get("key", {})
        msg_content = raw_msg.get("message", {})
        msg_id = key.get("id")

        if not msg_content or not msg_id:
            return None

        role = "assistant" if key.get("fromMe") else "user"
        content = ""
        
        if msg_content.get("conversation") or msg_content.get("extendedTextMessage"):
            content = msg_content.get("conversation") or msg_content.get("extendedTextMessage", {}).get("text", "")
        
        elif msg_content.get("audioMessage"):
            media_data = await whatsapp_service.get_media_and_convert(instance_name, raw_msg)
            if media_data:
                transcription = await gemini_service.transcribe_and_analyze_media(
                    media_data, history_list_for_context, persona_config, persona_config.contexto_json, db, user
                )
                content = f"[Áudio transcrito]: {transcription}"
            else:
                content = "[Falha ao processar áudio]"
        
        elif msg_content.get("imageMessage") or msg_content.get("documentMessage"):
            media_data = await whatsapp_service.get_media_and_convert(instance_name, raw_msg)
            if media_data:
                analysis = await gemini_service.transcribe_and_analyze_media(
                    media_data, history_list_for_context, persona_config, persona_config.contexto_json, db, user
                )
                content = f"[Análise de Mídia]: {analysis}"
                caption_text = ""
                if msg_content.get("imageMessage"):
                    caption_text = msg_content["imageMessage"].get("caption", "").strip()
                elif msg_content.get("documentMessage"):
                    caption_text = msg_content["documentMessage"].get("caption", "").strip()
                if caption_text:
                    content += f"\n[Legenda da Mídia]: {caption_text}"
            else:
                content = "[Falha ao processar mídia]"

        if content and content.strip():
            return {"id": msg_id, "role": role, "content": content}
        
        return None
        
    except Exception as e:
        logger.error(f"Erro ao processar mensagem individual ID {msg_id}: {e}", exc_info=True)
        return None

async def _synchronize_and_process_history(
    db: AsyncSession, 
    atendimento: models.Atendimento, 
    user: models.User, 
    persona_config: models.Config,
    whatsapp_service: WhatsAppService,
    gemini_service: GeminiService
) -> List[Dict[str, Any]]:
    """
    Busca o histórico da API, remove mensagens temporárias do DB, processa as novas e retorna o histórico completo.
    """
    logger.info(f"Iniciando sincronização de histórico para o atendimento ID {atendimento.id}...")

    if not user.instance_id:
        logger.warning(f"Utilizador {user.id} não possui um instance_id configurado. Não é possível buscar o histórico.")
        return json.loads(atendimento.conversa) if atendimento.conversa else []
    
    try:
        db_history = json.loads(atendimento.conversa) if atendimento.conversa else []
    except (json.JSONDecodeError, TypeError):
        db_history = []
    
    clean_db_history = [
        msg for msg in db_history 
        if not str(msg.get('id', '')).startswith('sent_') and not str(msg.get('id', '')).startswith('internal_')
    ]
    
    had_temporary_messages = len(db_history) > len(clean_db_history)
    if had_temporary_messages:
        logger.info(f"Removendo {len(db_history) - len(clean_db_history)} mensagens temporárias antes da sincronização.")
    
    processed_message_ids = {msg['id'] for msg in clean_db_history}
    
    raw_history_api = await whatsapp_service.fetch_chat_history(user.instance_id, atendimento.contact.whatsapp, count=100)
    
    if not raw_history_api:
        logger.warning("Não foi possível buscar o histórico da API.")
        if had_temporary_messages:
            logger.info("Salvando histórico limpo no DB após falha na API.")
            update_schema = schemas.AtendimentoUpdate(conversa=json.dumps(clean_db_history))
            await crud_atendimento.update_atendimento(db, db_atendimento=atendimento, atendimento_in=update_schema)
            await db.commit()
            await db.refresh(atendimento)
        return clean_db_history

    newly_processed_messages = []
    for raw_msg in reversed(raw_history_api):
        msg_id = raw_msg.get("key", {}).get("id")
        if msg_id and msg_id not in processed_message_ids:
            current_context_history = clean_db_history + newly_processed_messages
            processed_msg = await _process_raw_message(
                raw_msg, current_context_history, user.instance_name, persona_config, whatsapp_service, gemini_service, db, user
            )
            if processed_msg:
                newly_processed_messages.append(processed_msg)
    
    if newly_processed_messages or had_temporary_messages:
        updated_history = clean_db_history + newly_processed_messages
        if newly_processed_messages:
            logger.info(f"Sincronização: {len(newly_processed_messages)} mensagens novas processadas.")
        
        logger.info(f"Salvando histórico atualizado (total: {len(updated_history)} mensagens) no DB para atendimento ID {atendimento.id}.")
        update_schema = schemas.AtendimentoUpdate(conversa=json.dumps(updated_history))
        await crud_atendimento.update_atendimento(db, db_atendimento=atendimento, atendimento_in=update_schema)
        await db.commit()
        await db.refresh(atendimento)
        return updated_history
    else:
        logger.info(f"Sincronização concluída. Nenhuma alteração no histórico para o atendimento ID {atendimento.id}.")
        return clean_db_history


async def atendimento_agent_task(user_id: int):
    """
    O agente inteligente de atendimento com retentativa simples e segura.
    """
    logger.info(f"-> Agente de atendimento INICIADO para o utilizador {user_id}.")
    agent_status[user_id] = True
    
    whatsapp_service = get_whatsapp_service()
    gemini_service = get_gemini_service()

    while agent_status.get(user_id, False):
        action_taken = False
        try:
            async with SessionLocal() as db:
                user = await crud_user.get_user(db, user_id)
                if not user:
                    logger.warning(f"Agente: Utilizador {user_id} não encontrado. A parar o agente.")
                    stop_agent_for_user(user_id)
                    return

                atendimentos_para_responder = await crud_atendimento.get_atendimentos_para_processar(db, user_id=user_id)
                atendimentos_para_followup = await crud_atendimento.get_atendimentos_for_followup(db, user=user)
                atendimentos_para_processar = atendimentos_para_responder + atendimentos_para_followup

                if atendimentos_para_processar:
                    atendimentos_para_processar.sort(key=lambda a: a.updated_at)
                    atendimento = atendimentos_para_processar[0]
                    action_taken = True
                    
                    try:
                        logger.info(f"Agente (Utilizador {user_id}): Processando atendimento ID {atendimento.id} com status '{atendimento.status}'.")
                        
                        MAX_PROCESS_ATTEMPTS = 3
                        PROCESS_RETRY_DELAY = 10
                        full_history = None
                        ia_response = None

                        # --- ETAPA 1: SINCRONIZAÇÃO (com retentativas) ---
                        for attempt in range(MAX_PROCESS_ATTEMPTS):
                            try:
                                if atendimento.status == "Mensagem Recebida":
                                    persona_config_sync = await crud_config.get_config(db, config_id=atendimento.active_persona_id, user_id=user.id)
                                    if not persona_config_sync: raise ValueError("Persona não encontrada para sincronização.")
                                    full_history = await _synchronize_and_process_history(db, atendimento, user, persona_config_sync, whatsapp_service, gemini_service)
                                else:
                                    full_history = json.loads(atendimento.conversa) if atendimento.conversa else []
                                break 
                            except Exception as sync_err:
                                logger.warning(f"Falha na Sincronização para Atendimento ID {atendimento.id} (tentativa {attempt + 1}): {sync_err}")
                                if attempt == MAX_PROCESS_ATTEMPTS - 1: raise
                                await asyncio.sleep(PROCESS_RETRY_DELAY)
                        
                        last_message_is_from_user = not full_history or full_history[-1]['role'] == 'user'
                        if atendimento.status == "Mensagem Recebida" and not last_message_is_from_user:
                                logger.info(f"Atendimento {atendimento.id} já respondido. Finalizando ciclo.")
                                final_update = schemas.AtendimentoUpdate(status="Aguardando Resposta")
                                await crud_atendimento.update_atendimento(db, db_atendimento=atendimento, atendimento_in=final_update)
                                await db.commit()
                                continue

                        # --- ETAPA 2: GERAÇÃO IA (com retentativas) ---
                        logger.info(f"Atendimento {atendimento.id} apto para gerar resposta. Chamando IA...")
                        persona_config = await crud_config.get_config(db, config_id=atendimento.active_persona_id, user_id=user.id)
                        if not persona_config: raise ValueError("Persona não encontrada para geração de IA.")

                        for attempt in range(MAX_PROCESS_ATTEMPTS):
                            try:
                                ia_response = await gemini_service.generate_conversation_action(
                                    config=persona_config, contact=atendimento.contact,
                                    conversation_history_db=full_history, contexto_planilha=persona_config.contexto_json,
                                    db=db, user=user
                                )
                                break
                            except Exception as ia_err:
                                logger.warning(f"Falha na Geração da IA para Atendimento ID {atendimento.id} (tentativa {attempt + 1}): {ia_err}")
                                if attempt == MAX_PROCESS_ATTEMPTS - 1: raise
                                await asyncio.sleep(PROCESS_RETRY_DELAY)
                        
                        # --- ETAPA 3: ENVIO DE MENSAGEM ---
                        message_to_send = ia_response.get("mensagem_para_enviar")
                        new_status = ia_response.get("nova_situacao", "Aguardando Resposta")
                        new_observation = ia_response.get("observacoes", "")
                        history_after_response = full_history.copy()
                        
                        if message_to_send and isinstance(message_to_send, str):
                            message_to_send = message_to_send.replace('\\n', '\n')

                        if message_to_send:
                            message_parts = [part.strip() for part in message_to_send.split('\n\n') if part.strip()]
                            
                            for i, part in enumerate(message_parts):
                                try:
                                    await whatsapp_service.send_text_message(user.instance_name, atendimento.contact.whatsapp, part)
                                    pending_id = f"sent_{datetime.now(timezone.utc).isoformat()}"
                                    history_after_response.append({"id": pending_id, "role": "assistant", "content": part})
                                    if i < len(message_parts) - 1:
                                        await asyncio.sleep(random.uniform(5, 10))
                                except MessageSendError as e:
                                    logger.error(f"FALHA CRÍTICA ao enviar mensagem para {atendimento.contact.whatsapp}. Erro: {e}")
                                    new_status = "Falha no Envio"
                                    new_observation += f" | Falha ao enviar parte {i+1}/{len(message_parts)}."
                                    break
                        else:
                            logger.info(f"IA decidiu não enviar mensagem para {atendimento.contact.whatsapp}.")
                            pending_id = f"internal_{datetime.now(timezone.utc).isoformat()}"
                            history_after_response.append({"id": pending_id, "role": "assistant", "content": "[Ação Interna: Não responder]"})

                        final_update = schemas.AtendimentoUpdate(
                            status=new_status, observacoes=new_observation,
                            conversa=json.dumps(history_after_response)
                        )
                        await crud_atendimento.update_atendimento(db, db_atendimento=atendimento, atendimento_in=final_update)
                        await db.commit()

                    except Exception as process_err:
                        logger.error(f"Falha ao processar atendimento {atendimento.id} após todas as tentativas. Marcando com erro.", exc_info=True)
                        err_update = schemas.AtendimentoUpdate(status="Erro no Agente", observacoes=f"Falha final no processamento: {str(process_err)}")
                        await crud_atendimento.update_atendimento(db, atendimento, err_update)
                        await db.commit()

        except Exception as outer_err:
            logger.error(f"ERRO CRÍTICO no ciclo do agente (fora do processamento de atendimento): {outer_err}", exc_info=True)
        
        sleep_time = 5 if action_taken else 15
        await asyncio.sleep(sleep_time)

    logger.info(f"-> Agente de atendimento FINALIZADO para o utilizador {user_id}.")


def start_agent_for_user(user_id: int, background_tasks):
    if not agent_status.get(user_id, False):
        background_tasks.add_task(atendimento_agent_task, user_id)
    else:
        logger.warning(f"Tentativa de iniciar agente que já está rodando para o utilizador {user_id}.")

def stop_agent_for_user(user_id: int):
    if agent_status.get(user_id, False):
        agent_status[user_id] = False
        logger.info(f"Sinal de parada enviado para o agente do utilizador {user_id}.")
    else:
        logger.warning(f"Tentativa de parar agente que não está rodando para o utilizador {user_id}.")

