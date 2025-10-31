import asyncio
import json
import logging
import random
import uuid
from typing import Dict, List, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload # Importar joinedload
from datetime import datetime, timezone

from app.db.database import SessionLocal
from app.crud import crud_atendimento, crud_user, crud_config
from app.services.whatsapp_service import WhatsAppService, get_whatsapp_service, MessageSendError
from app.services.gemini_service import GeminiService, get_gemini_service
from app.db import models, schemas

logger = logging.getLogger(__name__)

agent_status: Dict[int, bool] = {}

# --- Função _process_raw_message (EVOLUTION ONLY - sem alterações) ---
async def _process_raw_message_evolution(
    raw_msg: dict,
    history_list_for_context: list,
    instance_name: str,
    persona_config: models.Config,
    whatsapp_service: WhatsAppService,
    gemini_service: GeminiService,
    db: AsyncSession, # Recebe sessão para deduzir token
    user: models.User
) -> Optional[Dict[str, Any]]:
    """
    Processa uma mensagem bruta da API Evolution, transcreve mídias se necessário, e retorna um dicionário formatado.
    """
    try:
        key = raw_msg.get("key", {})
        msg_content = raw_msg.get("message", {})
        msg_id = key.get("id")
        timestamp = raw_msg.get("messageTimestamp", 0) # Pegar timestamp se disponível (vem como int)

        if not msg_content or not msg_id:
            return None

        role = "assistant" if key.get("fromMe") else "user"
        content = ""
        media_processed = False # Flag para saber se processamos mídia

        if msg_content.get("conversation") or msg_content.get("extendedTextMessage"):
            content = msg_content.get("conversation") or msg_content.get("extendedTextMessage", {}).get("text", "")

        elif msg_content.get("audioMessage") or msg_content.get("imageMessage") or msg_content.get("documentMessage") or msg_content.get("videoMessage"):
            # Apenas processa mídia se instance_name estiver disponível
            if not instance_name:
                logger.warning(f"Evolution: Instance name não disponível, não é possível buscar mídia para msg {msg_id}.")
                content = "[Mídia recebida, mas não foi possível processar (sem instance_name)]"
            else:
                media_data = await whatsapp_service.get_media_and_convert_evolution(instance_name, raw_msg)
                media_processed = True
                if media_data:
                    # Chamar IA para transcrever/analisar
                    try:
                        # --- Usa sessão db recebida para dedução de token ---
                         analysis_result = await gemini_service.transcribe_and_analyze_media(
                            media_data=media_data,
                            db_history=history_list_for_context, # Usar histórico atual como contexto
                            config=persona_config,
                            contexto_planilha=persona_config.contexto_json,
                            db=db, # Passa a sessão recebida
                            user=user
                        )
                         # --------------------------------------------------
                         prefix = "[Áudio transcrito]" if 'audio' in media_data['mime_type'] else f"[Análise de Mídia ({media_data['mime_type']})]"
                         content = f"{prefix}: {analysis_result}"

                        # Adicionar legenda se houver (para imagem/documento/video)
                         caption = ""
                         if msg_content.get("imageMessage"): caption = msg_content["imageMessage"].get("caption", "")
                         elif msg_content.get("documentMessage"): caption = msg_content["documentMessage"].get("caption", "")
                         elif msg_content.get("videoMessage"): caption = msg_content["videoMessage"].get("caption", "")
                         if caption and caption.strip():
                            content += f"\n[Legenda]: {caption.strip()}"

                    except Exception as gemini_err:
                        logger.error(f"Evolution: Erro Gemini ao processar mídia da msg {msg_id}: {gemini_err}", exc_info=True)
                        content = f"[Mídia recebida ({media_data.get('mime_type', 'N/A')}), erro na análise/transcrição]"
                else:
                    content = "[Falha ao baixar/converter mídia]"

        # Outros tipos de mensagem podem ser tratados aqui se necessário (localização, contato, etc.)

        if content and content.strip():
            # Retorna o dicionário no formato esperado pelo histórico do DB
            return {
                "id": msg_id,
                "role": role,
                "content": content.strip(),
                "timestamp": int(timestamp) # Garantir que seja int
            }
        elif media_processed: # Se tentamos processar mídia mas não gerou conteúdo
            return {
                "id": msg_id,
                "role": role,
                "content": "[Mídia recebida, mas conteúdo não pôde ser extraído/processado]",
                "timestamp": int(timestamp)
            }

        return None

    except Exception as e:
        logger.error(f"Evolution: Erro ao processar mensagem individual ID {msg_id}: {e}", exc_info=True)
        return None

# --- Função _synchronize_and_process_history_evolution (Refatorada para usar sessão externa) ---
async def _synchronize_and_process_history_evolution(
    db: AsyncSession, # Recebe a sessão externa para operações de escrita
    atendimento_id: int,
    user_id: int,
    whatsapp_service: WhatsAppService,
    gemini_service: GeminiService
) -> List[Dict[str, Any]]:
    """
    (EVOLUTION ONLY) Busca histórico da API Evolution, processa novas msgs, salva no DB (usando a sessão 'db') e retorna.
    """
    logger.info(f"(Evolution) Iniciando sincronização de histórico para atendimento ID {atendimento_id}...")

    # Variáveis para guardar dados lidos em sessões separadas
    user_instance_id = None
    user_instance_name = None
    atendimento_conversa = "[]"
    atendimento_contato_whatsapp = None
    persona_config = None

    try:
        # --- SESSÃO 1: Ler dados do usuário e atendimento ---
        async with SessionLocal() as db_read_user:
            user = await db_read_user.get(models.User, user_id)
            if not user: raise ValueError("Usuário não encontrado para sync Evolution.")
            user_instance_id = user.instance_id
            user_instance_name = user.instance_name

            # Carrega atendimento COM relacionamentos necessários aqui
            atendimento = await db_read_user.get(
                models.Atendimento,
                atendimento_id,
                options=[
                    joinedload(models.Atendimento.contact),
                    joinedload(models.Atendimento.active_persona) # Carrega persona ativa
                ]
            )
            if not atendimento: raise ValueError("Atendimento não encontrado para sync Evolution.")
            atendimento_conversa = atendimento.conversa or "[]"
            if not atendimento.contact: raise ValueError("Contato não encontrado no atendimento para sync.")
            atendimento_contato_whatsapp = atendimento.contact.whatsapp

            # Pega persona ativa carregada ou busca a default
            persona_config = atendimento.active_persona
            if not persona_config:
                if user.default_persona_id:
                    # Busca a default na mesma sessão
                    persona_config = await crud_config.get_config(db_read_user, user.default_persona_id, user.id)
            if not persona_config:
                raise ValueError(f"Nenhuma persona ativa ou padrão encontrada para atendimento {atendimento_id} no sync.")
        # --- FIM SESSÃO 1 ---

        if not user_instance_id or not user_instance_name:
            logger.warning(f"Utilizador {user_id} sem instance_id ou instance_name. Impossível buscar histórico Evolution.")
            try:
                # Retorna o histórico lido da Sessão 1
                return json.loads(atendimento_conversa)
            except: return []

        try:
            db_history = json.loads(atendimento_conversa)
        except (json.JSONDecodeError, TypeError):
            db_history = []

        clean_db_history = [msg for msg in db_history if msg.get('id') and not str(msg['id']).startswith(('assistant_', 'internal_'))]
        processed_message_ids = {msg['id'] for msg in clean_db_history}
        had_temporary_messages = len(db_history) > len(clean_db_history)

        try:
            raw_history_api = await whatsapp_service.fetch_chat_history_evolution(
                user_instance_id, atendimento_contato_whatsapp, count=50
            )

            if not raw_history_api:
                logger.warning(f"Evolution: Histórico da API vazio ou falhou para atendimento {atendimento_id}. Usando apenas histórico do DB AtendAI.")
                final_history = clean_db_history
                if had_temporary_messages:
                    logger.info(f"Evolution: Salvando histórico limpo ({len(final_history)} msgs) no DB AtendAI.")
                    final_history.sort(key=lambda x: x.get('timestamp', 0))
                    # --- Usa a sessão 'db' externa para salvar ---
                    atendimento_to_update = await db.get(models.Atendimento, atendimento_id)
                    if atendimento_to_update:
                        atendimento_to_update.conversa = json.dumps(final_history, ensure_ascii=False)
                        atendimento_to_update.updated_at = datetime.now(timezone.utc)
                        db.add(atendimento_to_update)
                    # ---------------------------------------------
                return final_history

            newly_processed_messages = []
            # Usa uma única sessão para processar todas as novas mensagens (dedução de token)
            async with SessionLocal() as db_process_msgs:
                user_for_token = await db_process_msgs.get(models.User, user_id) # Precisa do usuário na sessão
                if not user_for_token: raise ValueError("Usuário não encontrado na sessão de processamento de msgs.")

                for raw_msg in reversed(raw_history_api):
                    msg_id = raw_msg.get("key", {}).get("id")
                    if msg_id and msg_id not in processed_message_ids:
                        current_context_history = clean_db_history + newly_processed_messages
                        processed_msg = await _process_raw_message_evolution(
                            raw_msg, current_context_history, user_instance_name, persona_config,
                            whatsapp_service, gemini_service,
                            db_process_msgs, user_for_token # Passa sessão e usuário corretos
                        )
                        if processed_msg:
                            newly_processed_messages.append(processed_msg)
                            processed_message_ids.add(msg_id)

            final_history = clean_db_history + newly_processed_messages
            final_history.sort(key=lambda x: x.get('timestamp', 0))

            if newly_processed_messages or had_temporary_messages:
                logger.info(f"Evolution: Sincronização concluída. {len(newly_processed_messages)} novas processadas. Total: {len(final_history)}. Salvando no DB AtendAI.")
                # --- Usa a sessão 'db' externa para salvar ---
                atendimento_to_update = await db.get(models.Atendimento, atendimento_id)
                if atendimento_to_update:
                    atendimento_to_update.conversa = json.dumps(final_history, ensure_ascii=False)
                    atendimento_to_update.updated_at = datetime.now(timezone.utc)
                    db.add(atendimento_to_update)
                # ---------------------------------------------
            else:
                logger.info(f"Evolution: Sincronização concluída. Nenhuma alteração no histórico para atendimento ID {atendimento_id}.")

            return final_history

        except Exception as e:
            logger.error(f"Evolution: Erro CRÍTICO durante sincronização do histórico para atendimento {atendimento_id}: {e}", exc_info=True)
            clean_db_history.sort(key=lambda x: x.get('timestamp', 0)) # Garante ordem
            return clean_db_history

    except Exception as e:
        logger.error(f"Evolution Sync: Erro CRÍTICO GERAL ao preparar sync: {e}", exc_info=True)
        return [] # Retorna lista vazia em caso de falha de setup


# --- Função Principal do Agente (Refatorada com Sessões Curtas) ---
async def atendimento_agent_task(user_id: int):
    """
    O agente inteligente de atendimento que agora lida com ambas APIs usando sessões curtas.
    """
    logger.info(f"-> Agente de atendimento INICIADO para o utilizador {user_id}.")
    agent_status[user_id] = True

    whatsapp_service = get_whatsapp_service()
    gemini_service = get_gemini_service()

    while agent_status.get(user_id, False):
        action_taken_in_cycle = False
        atendimento_id_being_processed = None # Para log em caso de erro
        atendimento_contato_num_log = "N/A" # Para log
        user_api_type_log = "N/A" # Para log

        try:
            # --- ETAPA 1: LER QUAL ATENDIMENTO PROCESSAR (SESSÃO CURTA) ---
            atendimento_id_para_processar: Optional[int] = None
            user_data_for_agent: Optional[models.User] = None # Guardar dados do user

            async with SessionLocal() as db_read_queue:
                user_data_for_agent = await db_read_queue.get(models.User, user_id) # Pega o usuário
                if not user_data_for_agent:
                    logger.warning(f"Agente: Utilizador {user_id} não encontrado. Parando agente.")
                    stop_agent_for_user(user_id)
                    return

                user_api_type_log = user_data_for_agent.api_type.value if user_data_for_agent.api_type else "N/A"

                if user_data_for_agent.tokens is not None and user_data_for_agent.tokens <= 0:
                    logger.warning(f"Agente: Utilizador {user_id} sem tokens. Pausando agente por 5 minutos.")
                    await asyncio.sleep(300)
                    continue

                atendimentos_para_responder = await crud_atendimento.get_atendimentos_para_processar(db_read_queue, user_id=user_id)
                atendimentos_para_followup = await crud_atendimento.get_atendimentos_for_followup(db_read_queue, user=user_data_for_agent)

                unique_atendimentos = {at.id: at for at in atendimentos_para_responder + atendimentos_para_followup}
                atendimentos_para_processar = sorted(unique_atendimentos.values(), key=lambda a: a.updated_at)

                if not atendimentos_para_processar:
                    await asyncio.sleep(random.uniform(5, 15))
                    continue

                atendimento_selecionado = atendimentos_para_processar[0]
                atendimento_id_para_processar = atendimento_selecionado.id
                atendimento_id_being_processed = atendimento_selecionado.id # Para log de erro
                # Corrigido para carregar o contato se ele existir
                if atendimento_selecionado.contact:
                    atendimento_contato_num_log = atendimento_selecionado.contact.whatsapp
                else: # Tenta carregar explicitamente se não veio no join inicial
                     try:
                         # Usa uma subconsulta para evitar erro de sessão diferente
                         contact_q = await db_read_queue.get(models.Contact, atendimento_selecionado.contact_id)
                         if contact_q: atendimento_contato_num_log = contact_q.whatsapp
                     except Exception as contact_load_err:
                          logger.warning(f"Agente: Erro ao carregar contato {atendimento_selecionado.contact_id} separadamente: {contact_load_err}")

                action_taken_in_cycle = True
            # --- FIM ETAPA 1 ---

            if not atendimento_id_para_processar or not user_data_for_agent:
                # Segurança caso algo falhe na leitura
                continue

            logger.info(f"Agente (User {user_id}, API: {user_api_type_log}): Processando atendimento ID {atendimento_id_para_processar} (Contato: {atendimento_contato_num_log})")

            # --- ETAPA 2: MARCAR COMO "GERANDO RESPOSTA" (SESSÃO CURTA COM TRANSAÇÃO) ---
            marked_generating = False
            try:
                async with SessionLocal() as db_mark_generating:
                    async with db_mark_generating.begin():
                        atendimento_to_mark = await db_mark_generating.get(models.Atendimento, atendimento_id_para_processar, with_for_update=True)
                        if atendimento_to_mark and atendimento_to_mark.status in ["Mensagem Recebida", "Aguardando Resposta"]: # Só marca se estiver nesses status
                            atendimento_to_mark.status = "Gerando Resposta"
                            atendimento_to_mark.updated_at = datetime.now(timezone.utc)
                            marked_generating = True
                        else:
                             logger.warning(f"Agente: Atendimento {atendimento_id_para_processar} não encontrado ou status mudou antes de marcar 'Gerando Resposta' (Status atual: {atendimento_to_mark.status if atendimento_to_mark else 'N/A'}). Pulando.")
                             continue # Pula o ciclo

                if marked_generating:
                     logger.info(f"Agente: Atendimento {atendimento_id_para_processar} marcado como 'Gerando Resposta'.")

            except Exception as lock_err:
                logger.error(f"Agente: Falha ao marcar atendimento {atendimento_id_para_processar} como 'Gerando Resposta': {lock_err}", exc_info=True)
                continue # Pula para o próximo ciclo
            # --- FIM ETAPA 2 ---


            # --- ETAPA 3: PREPARAR DADOS PARA IA (LER HISTÓRICO, PERSONA) ---
            conversation_history: List[Dict[str, Any]] = [] # Zera para cada ciclo
            persona_config: Optional[models.Config] = None
            contact_para_ia: Optional[models.Contact] = None # Para passar para Gemini
            situacoes_para_ia: Optional[List[Dict[str, str]]] = None

            try:
                async with SessionLocal() as db_read_context:
                    # Carrega atendimento com relacionamentos necessários
                    atendimento_context = await db_read_context.get(
                        models.Atendimento,
                        atendimento_id_para_processar,
                        options=[
                            joinedload(models.Atendimento.contact),
                            joinedload(models.Atendimento.active_persona)
                        ]
                    )
                    if not atendimento_context: raise ValueError("Atendimento não encontrado para ler contexto.")

                    contact_para_ia = atendimento_context.contact # Guarda o contato

                    # Pega persona ativa carregada ou busca a default
                    persona_config = atendimento_context.active_persona
                    if not persona_config:
                        if user_data_for_agent.default_persona_id:
                            persona_config = await crud_config.get_config(db_read_context, user_data_for_agent.default_persona_id, user_id)
                    if not persona_config:
                        raise ValueError(f"Nenhuma persona ativa ou padrão encontrada para atendimento {atendimento_id_para_processar}.")
                    
                    # --- NOVO: Carregar persona PADRÃO para as SITUAÇÕES ---
                    default_persona_for_situations: Optional[models.Config] = None
                    if user_data_for_agent.default_persona_id:
                        if user_data_for_agent.default_persona_id == persona_config.id:
                            # Se a persona ativa JÁ é a padrão, reutiliza
                            default_persona_for_situations = persona_config
                        else:
                            # Busca a persona padrão separadamente
                            default_persona_for_situations = await crud_config.get_config(db_read_context, user_data_for_agent.default_persona_id, user_id)
                    
                    # Se não achou a padrão, usa a ativa como fallback
                    if not default_persona_for_situations:
                        default_persona_for_situations = persona_config

                    # Extrai as situações
                    if default_persona_for_situations:
                        situacoes_para_ia = default_persona_for_situations.situacoes_disponiveis
                    # ----------------------------------------------------

                    # Obter histórico (sincronizar se for Evolution)
                    if user_data_for_agent.api_type == models.ApiType.evolution:
                        async with SessionLocal() as db_sync_evo:
                             conversation_history = await _synchronize_and_process_history_evolution(
                                db_sync_evo,
                                atendimento_id_para_processar,
                                user_id,
                                whatsapp_service,
                                gemini_service
                            )
                             await db_sync_evo.commit()

                    elif user_data_for_agent.api_type == models.ApiType.official:
                        try:
                            conversation_history = json.loads(atendimento_context.conversa or "[]")
                            # Garante ordenação aqui, antes de passar para a IA
                            conversation_history.sort(key=lambda x: x.get('timestamp') or 0)
                        except (json.JSONDecodeError, TypeError):
                            logger.warning(f"Agente (Oficial): Campo 'conversa' inválido para atendimento {atendimento_id_para_processar}. Reiniciando histórico.")
                            conversation_history = []
                        logger.info(f"Agente (Oficial): Usando histórico do DB ({len(conversation_history)} msgs) para atendimento {atendimento_id_para_processar}.")
                    else:
                        raise ValueError(f"Tipo de API desconhecido: {user_data_for_agent.api_type}")

            except Exception as context_err:
                 logger.error(f"Agente: Erro ao preparar contexto para IA (Atendimento {atendimento_id_para_processar}): {context_err}", exc_info=True)
                 # Tentar reverter status se falhou em preparar contexto?
                 try:
                     async with SessionLocal() as db_revert:
                          async with db_revert.begin():
                             at_revert = await db_revert.get(models.Atendimento, atendimento_id_para_processar)
                             if at_revert and at_revert.status == "Gerando Resposta":
                                 at_revert.status = "Mensagem Recebida" # Assume que algo deu errado, melhor tentar de novo
                                 at_revert.updated_at = datetime.now(timezone.utc)
                 except Exception: pass # Ignora erro ao reverter
                 continue # Pula o ciclo
            # --- FIM ETAPA 3 ---

            # Verifica se última mensagem é do assistente (segurança extra)
            if conversation_history and conversation_history[-1].get('role') == 'assistant':
                logger.warning(f"Agente: Atendimento {atendimento_id_para_processar} marcado como 'Gerando Resposta', mas última msg já é 'assistant' (após ler contexto). Revertendo para 'Aguardando Resposta'.")
                try:
                     async with SessionLocal() as db_revert_assistant:
                          async with db_revert_assistant.begin():
                             at_revert_as = await db_revert_assistant.get(models.Atendimento, atendimento_id_para_processar)
                             if at_revert_as:
                                 at_revert_as.status = "Aguardando Resposta"
                                 at_revert_as.updated_at = datetime.now(timezone.utc)
                except Exception: pass
                continue


            # --- ETAPA 4: GERAÇÃO IA ---
            ia_response = None
            try:
                logger.info(f"Agente: Atendimento {atendimento_id_para_processar} apto para IA. Chamando Gemini...")
                async with SessionLocal() as db_gemini_deduct:
                    user_for_gemini = await db_gemini_deduct.get(models.User, user_id)
                    if not user_for_gemini: raise ValueError("Usuário não encontrado na sessão Gemini.")

                    ia_response = await gemini_service.generate_conversation_action(
                        config=persona_config, contact=contact_para_ia,
                        conversation_history_db=conversation_history, # Usa o histórico lido
                        contexto_planilha=persona_config.contexto_json,
                        situacoes_disponiveis=situacoes_para_ia,
                        db=db_gemini_deduct, user=user_for_gemini
                    )
                if not ia_response: raise ValueError("IA não retornou resposta.")

            except Exception as ia_err:
                logger.error(f"Agente: Falha na GERAÇÃO IA para atendimento {atendimento_id_para_processar}: {ia_err}", exc_info=True)
                # Tentar marcar com erro e reverter status
                try:
                     async with SessionLocal() as db_ia_fail:
                          async with db_ia_fail.begin():
                             at_ia_fail = await db_ia_fail.get(models.Atendimento, atendimento_id_para_processar)
                             if at_ia_fail:
                                 at_ia_fail.status = "Erro no Agente"
                                 at_ia_fail.observacoes = f"IA Error: {str(ia_err)[:250]}"
                                 at_ia_fail.updated_at = datetime.now(timezone.utc)
                except Exception: pass
                continue # Pula o ciclo
            # --- FIM ETAPA 4 ---

            # --- ETAPA 5: ENVIO DE MENSAGEM ---
            message_to_send = ia_response.get("mensagem_para_enviar")
            intended_status_after_send = ia_response.get("nova_situacao", "Aguardando Resposta") # Default
            intended_observation = ia_response.get("observacoes", "")
            message_sent_successfully = False
            sent_messages_info: List[Dict[str, Any]] = []

            if message_to_send and isinstance(message_to_send, str) and message_to_send.strip():
                message_to_send_cleaned = message_to_send.strip().replace('\\n', '\n')
                message_parts = [part.strip() for part in message_to_send_cleaned.split('\n\n') if part.strip()]
                part_send_success = True

                for i, part in enumerate(message_parts):
                    try:
                        logger.info(f"Agente: Enviando parte {i+1}/{len(message_parts)} para {atendimento_contato_num_log} (Atendimento {atendimento_id_para_processar})...")
                        sent_info = await whatsapp_service.send_text_message(user_data_for_agent, atendimento_contato_num_log, part)

                        if not sent_info:
                            logger.error(f"Agente: FALHA CRÍTICA ao enviar parte {i+1} para {atendimento_id_para_processar}. (send_text_message retornou None)")
                            raise MessageSendError(f"Falha no envio (retorno nulo) da parte {i+1}")

                        logger.info(f"Agente: Parte {i+1} enviada com sucesso para {atendimento_id_para_processar}. (ID: {sent_info.get('id')})")
                        sent_messages_info.append({
                            "id": sent_info.get('id') or f"assistant_{uuid.uuid4()}",
                            "content": part,
                            "timestamp": sent_info.get('timestamp', int(datetime.now(timezone.utc).timestamp()))
                        })
                        if i < len(message_parts) - 1: await asyncio.sleep(random.uniform(2, 5))

                    except MessageSendError as send_err:
                        logger.error(f"Agente: FALHA CRÍTICA ao enviar parte {i+1} para {atendimento_id_para_processar}. Erro: {send_err}")
                        intended_status_after_send = "Falha no Envio" # Marca o status pretendido como falha
                        intended_observation += f" | Erro ao enviar parte {i+1}: {str(send_err)[:100]}"
                        part_send_success = False
                        break

                message_sent_successfully = part_send_success
            else:
                logger.info(f"Agente: IA decidiu não enviar mensagem para atendimento {atendimento_id_para_processar}.")
                message_sent_successfully = True # Intencional, considera sucesso
            # --- FIM ETAPA 5 ---

            # --- ETAPA 6: ATUALIZAÇÃO FINAL (SESSÃO CURTA COM TRANSAÇÃO E LOCK) ---
            try:
                logger.info(f"Agente: Verificando status atual do Atendimento {atendimento_id_para_processar} ANTES da atualização final.")

                async with SessionLocal() as db_final:
                    async with db_final.begin(): # Inicia transação final
                        # Recarrega e TRAVA o atendimento (SEM JOIN)
                        atendimento_final_ref = await db_final.get(
                            models.Atendimento,
                            atendimento_id_para_processar,
                            with_for_update=True # <-- LOCK crucial
                        )

                        if not atendimento_final_ref:
                            logger.warning(f"Agente: Não foi possível recarregar/travar atendimento {atendimento_id_para_processar} para atualização final.")
                            continue # Pula o ciclo (rollback automático)

                        current_db_status = atendimento_final_ref.status
                        
                        # --- CORREÇÃO: Relê o histórico DENTRO da transação final ---
                        try:
                            current_conversation_history = json.loads(atendimento_final_ref.conversa or "[]")
                            # Garante a ordenação do histórico lido
                            current_conversation_history.sort(key=lambda x: x.get('timestamp') or 0)
                        except (json.JSONDecodeError, TypeError):
                             logger.warning(f"Agente: JSON da conversa corrompido no Atendimento {atendimento_id_para_processar} durante update final. Reiniciando.")
                             current_conversation_history = []
                        # --- FIM CORREÇÃO ---
                        
                        # Adiciona mensagens enviadas ao histórico ATUALIZADO
                        final_conversation_history = current_conversation_history # Começa com o histórico mais recente
                        if message_sent_successfully and sent_messages_info:
                            try:
                                for msg_info in sent_messages_info:
                                    assistant_message = schemas.FormattedMessage(
                                        id=msg_info['id'], role='assistant',
                                        content=msg_info['content'], timestamp=msg_info['timestamp']
                                    )
                                    final_conversation_history.append(assistant_message.model_dump())
                                # Ordena DEPOIS de adicionar as novas mensagens
                                final_conversation_history.sort(key=lambda x: x.get('timestamp') or 0)
                            except Exception as json_err:
                                logger.error(f"Erro ao adicionar respostas da IA ao histórico final: {json_err}")
                                # Continua mesmo com erro ao adicionar, para salvar o status

                        final_status_to_set = ""
                        final_observation = intended_observation

                        if current_db_status == "Gerando Resposta":
                            # Ninguém mexeu. Aplica o status da IA (ou Falha no Envio).
                            final_status_to_set = intended_status_after_send
                            logger.info(f"Agente: Atendimento {atendimento_id_para_processar} ainda 'Gerando Resposta'. Aplicando status: '{final_status_to_set}'")
                        else:
                            # Status mudou! Mantém o status do DB.
                            final_status_to_set = current_db_status
                            if message_sent_successfully and message_to_send: # Adiciona Obs APENAS se a IA enviou algo
                                 final_observation += " | IA respondeu, mas novo evento ocorreu durante geração."
                            logger.info(f"Agente: Atendimento {atendimento_id_para_processar} mudou para '{current_db_status}' durante geração. Mantendo status atual.")

                        # Atualiza o objeto na sessão final
                        atendimento_final_ref.status = final_status_to_set
                        atendimento_final_ref.observacoes = final_observation
                        atendimento_final_ref.conversa = json.dumps(final_conversation_history, ensure_ascii=False) # Salva histórico final ATUALIZADO
                        atendimento_final_ref.updated_at = datetime.now(timezone.utc)

                        # Commit automático ao sair do 'async with db_final.begin():'

                    logger.info(f"Agente: Atendimento {atendimento_id_para_processar} finalizado neste ciclo.")

            except Exception as final_update_err:
                 logger.error(f"Agente: Falha CRÍTICA na ATUALIZAÇÃO FINAL do atendimento {atendimento_id_para_processar}: {final_update_err}", exc_info=True)
                 # Rollback é automático. O status pode ficar como "Gerando Resposta".
                 continue # Pula o ciclo

            # --- FIM ETAPA 6 ---

        except Exception as outer_err:
            logger.error(f"Agente: ERRO CRÍTICO no ciclo principal para user {user_id} (Atendimento ID: {atendimento_id_being_processed}).", exc_info=True)
            await asyncio.sleep(60) # Pausa mais longa

        # Pausa entre os ciclos
        sleep_time = random.uniform(1, 5) if action_taken_in_cycle else random.uniform(10, 20)
        await asyncio.sleep(sleep_time)

    logger.info(f"-> Agente de atendimento FINALIZADO para o utilizador {user_id}.")


# --- Funções start/stop agent (sem alterações) ---
def start_agent_for_user(user_id: int, background_tasks):
    if not agent_status.get(user_id, False):
        background_tasks.add_task(atendimento_agent_task, user_id)
        logger.info(f"Agente para usuário {user_id} adicionado à fila de inicialização.")
    else:
        logger.warning(f"Tentativa de iniciar agente já em execução para usuário {user_id}.")

def stop_agent_for_user(user_id: int):
    if agent_status.get(user_id, False):
        agent_status[user_id] = False
        logger.info(f"Sinal de parada enviado para o agente do usuário {user_id}.")
    else:
        logger.warning(f"Tentativa de parar agente inativo para usuário {user_id}.")

# def get_agent_status(user_id: int):
#     return {"status": "running" if agent_status.get(user_id, False) else "stopped"}

