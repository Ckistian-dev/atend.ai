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

# --- Função _process_raw_message (sem alterações) ---
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

# --- Função _synchronize_and_process_history (sem alterações) ---
async def _synchronize_and_process_history(
    db: AsyncSession,
    atendimento: models.Atendimento,
    user: models.User,
    persona_config: models.Config,
    whatsapp_service: WhatsAppService,
    gemini_service: GeminiService
) -> List[Dict[str, Any]]:
    """
    Busca o histórico da API, remove mensagens temporárias do DB, processa as novas,
    SALVA o histórico atualizado no DB e retorna o histórico completo.
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

    try:
        # Tenta buscar o histórico da API
        raw_history_api = await whatsapp_service.fetch_chat_history(user.instance_id, atendimento.contact.whatsapp, count=100)

        if not raw_history_api:
             # Se a API falhar ou não retornar nada, usamos o histórico limpo que já tínhamos
            logger.warning(f"Não foi possível buscar o histórico da API para atendimento {atendimento.id} ou não há mensagens. Usando histórico do DB.")
            final_history = clean_db_history
            if had_temporary_messages: # Salva apenas se removemos temporárias
                 logger.info("Salvando histórico limpo no DB após falha/ausência na API.")
                 update_schema = schemas.AtendimentoUpdate(conversa=json.dumps(final_history))
                 await crud_atendimento.update_atendimento(db, db_atendimento=atendimento, atendimento_in=update_schema)
                 await db.commit()
                 await db.refresh(atendimento)
            return final_history

        # Processa apenas mensagens novas que não estão no histórico limpo do DB
        newly_processed_messages = []
        for raw_msg in reversed(raw_history_api): # Processa do mais antigo para o mais novo
            msg_id = raw_msg.get("key", {}).get("id")
            if msg_id and msg_id not in processed_message_ids:
                # O contexto para processar a mensagem N inclui as N-1 mensagens já processadas neste ciclo
                current_context_history = clean_db_history + newly_processed_messages
                processed_msg = await _process_raw_message(
                    raw_msg, current_context_history, user.instance_name, persona_config, whatsapp_service, gemini_service, db, user
                )
                if processed_msg:
                    newly_processed_messages.append(processed_msg)
                    processed_message_ids.add(msg_id) # Adiciona ao set para evitar reprocessamento

        final_history = clean_db_history + newly_processed_messages

        if newly_processed_messages or had_temporary_messages:
            if newly_processed_messages:
                 logger.info(f"Sincronização: {len(newly_processed_messages)} mensagens novas processadas.")

            logger.info(f"Salvando histórico atualizado (total: {len(final_history)} mensagens) no DB para atendimento ID {atendimento.id}.")
            update_schema = schemas.AtendimentoUpdate(conversa=json.dumps(final_history))
            # Use o objeto 'atendimento' que foi passado para a função
            await crud_atendimento.update_atendimento(db, db_atendimento=atendimento, atendimento_in=update_schema)
            await db.commit()
            await db.refresh(atendimento) # Atualiza o objeto 'atendimento' com os dados salvos

        else:
             logger.info(f"Sincronização concluída. Nenhuma alteração no histórico para o atendimento ID {atendimento.id}.")

        return final_history

    except Exception as e:
        logger.error(f"Erro durante a sincronização do histórico para atendimento {atendimento.id}: {e}", exc_info=True)
        # Em caso de erro na sincronização, retorna o histórico limpo do DB como fallback seguro
        return clean_db_history


# --- Função atendimento_agent_task (COM ALTERAÇÕES) ---
async def atendimento_agent_task(user_id: int):
    """
    O agente inteligente de atendimento com retentativa, sincronização dupla e segura.
    """
    logger.info(f"-> Agente de atendimento INICIADO para o utilizador {user_id}.")
    agent_status[user_id] = True

    whatsapp_service = get_whatsapp_service()
    gemini_service = get_gemini_service()

    while agent_status.get(user_id, False):
        action_taken = False
        atendimento_id_processed = None # Para logs em caso de erro externo
        try:
            async with SessionLocal() as db:
                user = await crud_user.get_user(db, user_id)
                if not user:
                    logger.warning(f"Agente: Utilizador {user_id} não encontrado. A parar o agente.")
                    stop_agent_for_user(user_id)
                    return

                # Prioriza respostas diretas, depois follow-ups
                atendimentos_para_responder = await crud_atendimento.get_atendimentos_para_processar(db, user_id=user_id)
                atendimentos_para_followup = await crud_atendimento.get_atendimentos_for_followup(db, user=user)

                # Combina e ordena, garantindo que não haja duplicatas se um atendimento estiver em ambas as listas
                atendimento_ids = set()
                atendimentos_para_processar = []
                for at in atendimentos_para_responder + atendimentos_para_followup:
                    if at.id not in atendimento_ids:
                        atendimentos_para_processar.append(at)
                        atendimento_ids.add(at.id)

                if atendimentos_para_processar:
                    atendimentos_para_processar.sort(key=lambda a: a.updated_at) # Processa o mais antigo primeiro
                    atendimento = atendimentos_para_processar[0]
                    atendimento_id_processed = atendimento.id # Guarda o ID para log de erro
                    action_taken = True

                    try:
                        logger.info(f"Agente (Utilizador {user_id}): Processando atendimento ID {atendimento.id} com status '{atendimento.status}'.")

                        # --- ETAPA 1: SINCRONIZAÇÃO INICIAL ---
                        persona_config = await crud_config.get_config(db, config_id=atendimento.active_persona_id, user_id=user.id)
                        if not persona_config:
                            raise ValueError(f"Persona ID {atendimento.active_persona_id} não encontrada para o atendimento {atendimento.id}.")

                        history_before_ia = await _synchronize_and_process_history(
                            db, atendimento, user, persona_config, whatsapp_service, gemini_service
                        )

                        # *** NOVO: Guarda os IDs das mensagens do usuário ANTES da IA ***
                        user_message_ids_before_ia = {msg['id'] for msg in history_before_ia if msg.get('role') == 'user'}

                        atendimento_refreshed = await crud_atendimento.get_atendimento(db, atendimento.id, user.id)
                        if not atendimento_refreshed or atendimento_refreshed.status not in ["Mensagem Recebida", "Aguardando Resposta"]: # Adicionado "Aguardando Resposta" para Followup
                             logger.info(f"Atendimento {atendimento.id} não requer mais processamento neste ciclo (status atual: {atendimento_refreshed.status if atendimento_refreshed else 'N/A'}).")
                             continue

                        # Se for um atendimento 'Mensagem Recebida' e a última msg não for do user, não precisa chamar IA
                        if atendimento_refreshed.status == "Mensagem Recebida" and (not history_before_ia or history_before_ia[-1]['role'] == 'assistant'):
                            logger.info(f"Atendimento {atendimento.id} já parece respondido após sincronização inicial. Marcando como 'Aguardando Resposta'.")
                            final_update = schemas.AtendimentoUpdate(status="Aguardando Resposta")
                            await crud_atendimento.update_atendimento(db, db_atendimento=atendimento_refreshed, atendimento_in=final_update)
                            await db.commit()
                            continue

                        # --- ETAPA 2: GERAÇÃO IA ---
                        logger.info(f"Atendimento {atendimento.id} apto para gerar resposta. Chamando IA...")
                        ia_response = await gemini_service.generate_conversation_action(
                            config=persona_config, contact=atendimento.contact,
                            conversation_history_db=history_before_ia, contexto_planilha=persona_config.contexto_json,
                            db=db, user=user
                        )

                        message_to_send = ia_response.get("mensagem_para_enviar")
                        intended_status_after_send = ia_response.get("nova_situacao", "Aguardando Resposta")
                        intended_observation = ia_response.get("observacoes", "")
                        # history_with_sent_markers = history_before_ia.copy() # Não precisamos mais disso aqui

                        if message_to_send and isinstance(message_to_send, str):
                            message_to_send = message_to_send.replace('\\n', '\n')

                        # --- ETAPA 3: ENVIO DE MENSAGEM ---
                        all_parts_sent = True
                        if message_to_send:
                            message_parts = [part.strip() for part in message_to_send.split('\n\n') if part.strip()]
                            MAX_SEND_ATTEMPTS = 3
                            SEND_RETRY_DELAY = 10

                            for i, part in enumerate(message_parts):
                                part_sent_successfully = False
                                for attempt in range(MAX_SEND_ATTEMPTS):
                                    try:
                                        logger.info(f"Enviando parte {i+1}/{len(message_parts)} para {atendimento.contact.whatsapp} (Tentativa {attempt + 1})...")
                                        await whatsapp_service.send_text_message(user.instance_name, atendimento.contact.whatsapp, part)
                                        part_sent_successfully = True
                                        break
                                    except MessageSendError as e:
                                        logger.warning(f"Falha na tentativa {attempt + 1} de enviar a parte {i+1} para {atendimento.id}. Erro: {e}. Aguardando {SEND_RETRY_DELAY}s.")
                                        if attempt < MAX_SEND_ATTEMPTS - 1:
                                            await asyncio.sleep(SEND_RETRY_DELAY)

                                if part_sent_successfully:
                                    logger.info(f"Parte {i+1} enviada com sucesso para {atendimento.id}.")
                                    # Não adicionamos mais marcadores temporários aqui
                                    if i < len(message_parts) - 1:
                                        await asyncio.sleep(random.uniform(15, 30))
                                else:
                                    logger.error(f"FALHA CRÍTICA ao enviar parte {i+1} para {atendimento.id} após {MAX_SEND_ATTEMPTS} tentativas. Abortando envio.")
                                    all_parts_sent = False
                                    intended_status_after_send = "Falha no Envio"
                                    intended_observation += f" | Falha ao enviar parte {i+1}/{len(message_parts)}."
                                    break
                        else:
                            logger.info(f"IA decidiu não enviar mensagem para atendimento {atendimento.id}.")
                            # Não adicionamos marcador interno aqui, a Sync 2 cuidará do histórico final

                        # --- ETAPA 4: SINCRONIZAÇÃO FINAL E ATUALIZAÇÃO DE STATUS ---
                        final_status = intended_status_after_send
                        final_observation = intended_observation
                        latest_history = [] # Para armazenar o resultado da Sync 2

                        if all_parts_sent:
                            logger.info(f"Envio (ou não envio intencional) concluído para {atendimento.id}. Iniciando re-sincronização final...")
                            try:
                                # --- SINCRONIZAÇÃO 2 ---
                                # Chama a função novamente. Ela buscará, processará E SALVARÁ o histórico mais recente no DB.
                                # Recarrega o atendimento ANTES da sync 2 para garantir que ela use o objeto mais atual
                                atendimento_before_sync2 = await crud_atendimento.get_atendimento(db, atendimento.id, user.id)
                                if atendimento_before_sync2:
                                    latest_history = await _synchronize_and_process_history(
                                        db, atendimento_before_sync2, user, persona_config, whatsapp_service, gemini_service
                                    )
                                else:
                                    logger.warning(f"Não foi possível recarregar atendimento {atendimento.id} antes da Sync 2.")
                                    latest_history = history_before_ia # Fallback

                                # *** VERIFICAÇÃO FINAL MELHORADA ***
                                user_message_ids_after_send = {msg['id'] for msg in latest_history if msg.get('role') == 'user'}
                                new_user_messages_detected = user_message_ids_after_send - user_message_ids_before_ia

                                if new_user_messages_detected:
                                    logger.info(f"{len(new_user_messages_detected)} nova(s) mensagem(ns) de usuário detectada(s) após envio/ação para {atendimento.id}. IDs: {new_user_messages_detected}. Marcando como 'Mensagem Recebida'.")
                                    final_status = "Mensagem Recebida" # Garante que o agente pegue na próxima volta
                                # else: Mantém o status intencionado pela IA (ou 'Aguardando Resposta')

                            except Exception as resync_err:
                                logger.warning(f"Falha na re-sincronização final para {atendimento.id}: {resync_err}. O status final pode não refletir novas mensagens imediatamente.", exc_info=True)
                                # Mantemos o 'intended_status_after_send' pois não conseguimos confirmar o estado mais recente.
                        # else: O status já foi definido como "Falha no Envio"

                        # --- ATUALIZAÇÃO FINAL (APENAS STATUS E OBS) ---
                        logger.info(f"Atualizando status final do atendimento {atendimento.id} para '{final_status}'.")
                        final_update_payload = schemas.AtendimentoUpdate(
                            status=final_status,
                            observacoes=final_observation
                        )
                        atendimento_final_ref = await crud_atendimento.get_atendimento(db, atendimento.id, user.id)
                        if atendimento_final_ref:
                            await crud_atendimento.update_atendimento(db, db_atendimento=atendimento_final_ref, atendimento_in=final_update_payload)
                            await db.commit()
                        else:
                             logger.warning(f"Não foi possível recarregar o atendimento {atendimento.id} para atualização final de status.")


                    except Exception as process_err:
                        logger.error(f"Falha CRÍTICA ao processar atendimento {atendimento.id}. Marcando com erro.", exc_info=True)
                        try:
                            err_update = schemas.AtendimentoUpdate(status="Erro no Agente", observacoes=f"Falha final no processamento: {str(process_err)[:250]}")
                            atendimento_err_ref = await crud_atendimento.get_atendimento(db, atendimento.id, user.id)
                            if atendimento_err_ref:
                                await crud_atendimento.update_atendimento(db, atendimento_err_ref, err_update)
                                await db.commit()
                        except Exception as update_err:
                             logger.error(f"Falha ao tentar marcar atendimento {atendimento.id} com erro: {update_err}", exc_info=True)
                             await db.rollback()


        except Exception as outer_err:
            logger.error(f"ERRO CRÍTICO no ciclo do agente para user {user_id} (possivelmente ao buscar atendimentos ou erro inesperado no processamento do ID {atendimento_id_processed}): {outer_err}", exc_info=True)
            await asyncio.sleep(60)

        # Pausa entre os ciclos
        sleep_time = random.uniform(15, 30) if action_taken else random.uniform(15, 30) # Ajuste nos tempos de sleep
        await asyncio.sleep(sleep_time)

    logger.info(f"-> Agente de atendimento FINALIZADO para o utilizador {user_id}.")


# --- Funções start/stop agent (sem alterações) ---
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