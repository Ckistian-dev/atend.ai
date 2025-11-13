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
from app.crud import crud_atendimento, crud_config
from app.services.whatsapp_service import get_whatsapp_service, MessageSendError
from app.services.gemini_service import get_gemini_service
from app.api.configs import SITUATIONS
from app.db import models, schemas

logger = logging.getLogger(__name__)

agent_status: Dict[int, bool] = {}


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
                if atendimento_selecionado.whatsapp:
                    atendimento_contato_num_log = atendimento_selecionado.whatsapp
                else: # Tenta carregar explicitamente se não veio no join inicial
                     try:
                         # Usa uma subconsulta para evitar erro de sessão diferente
                         contact_q = await db_read_queue.get(models.Atendimento, atendimento_selecionado.whatsapp)
                         if contact_q: atendimento_contato_num_log = contact_q.whatsapp
                     except Exception as contact_load_err:
                          logger.warning(f"Agente: Erro ao carregar contato {atendimento_selecionado.whatsapp} separadamente: {contact_load_err}")

                action_taken_in_cycle = True
            # --- FIM ETAPA 1 ---

            if not atendimento_id_para_processar or not user_data_for_agent:
                # Segurança caso algo falhe na leitura
                continue

            logger.info(f"Agente (User {user_id}: Processando atendimento ID {atendimento_id_para_processar} (Contato: {atendimento_contato_num_log})")

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
            contact_para_ia: Optional[models.Atendimento] = None # Para passar para Gemini
            situacoes_para_ia: Optional[List[Dict[str, str]]] = None

            try:
                async with SessionLocal() as db_read_context:
                    # Carrega atendimento com relacionamentos necessários
                    atendimento_context = await db_read_context.get(
                        models.Atendimento,
                        atendimento_id_para_processar,
                        options=[
                            joinedload(models.Atendimento.active_persona)
                        ]
                    )
                    if not atendimento_context: raise ValueError("Atendimento não encontrado para ler contexto.")

                    contact_para_ia = atendimento_context.whatsapp # Guarda o contato

                    # Pega persona ativa carregada ou busca a default
                    persona_config = atendimento_context.active_persona
                    if not persona_config:
                        if user_data_for_agent.default_persona_id:
                            persona_config = await crud_config.get_config(db_read_context, user_data_for_agent.default_persona_id, user_id)
                    if not persona_config:
                        raise ValueError(f"Nenhuma persona ativa ou padrão encontrada para atendimento {atendimento_id_para_processar}.")
                    
                    situacoes_para_ia = SITUATIONS

                    try:
                        conversation_history = json.loads(atendimento_context.conversa or "[]")
                        # Garante ordenação aqui, antes de passar para a IA
                        conversation_history.sort(key=lambda x: x.get('timestamp') or 0)
                    except (json.JSONDecodeError, TypeError):
                        logger.warning(f"Agente (Oficial): Campo 'conversa' inválido para atendimento {atendimento_id_para_processar}. Reiniciando histórico.")
                        conversation_history = []
                    logger.info(f"Agente (Oficial): Usando histórico do DB ({len(conversation_history)} msgs) para atendimento {atendimento_id_para_processar}.")


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
                        whatsapp=atendimento_context,
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
