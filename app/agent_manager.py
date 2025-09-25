# app/agent_manager.py

import asyncio
import json
import logging
from typing import Dict
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import SessionLocal
from app.crud import crud_atendimento, crud_user, crud_config
from app.services.whatsapp_service import WhatsAppService, get_whatsapp_service
from app.services.gemini_service import GeminiService, get_gemini_service
from app.db import models, schemas

logger = logging.getLogger(__name__)

agent_status: Dict[int, bool] = {}

async def atendimento_agent_task(user_id: int):
    """
    O agente inteligente de atendimento. Roda continuamente para um utilizador,
    processando uma ação de cada vez para manter a responsividade.
    """
    logger.info(f"-> Agente de atendimento INICIADO para o utilizador {user_id}.")
    agent_status[user_id] = True
    
    whatsapp_service = get_whatsapp_service()
    gemini_service = get_gemini_service()

    while agent_status.get(user_id, False):
        action_taken = False
        try:
            async with SessionLocal() as db:
                
                # --- A LINHA QUE FALTAVA ESTÁ AQUI ---
                # Busca o objeto do utilizador no início de cada ciclo
                user = await crud_user.get_user(db, user_id)
                if not user:
                    logger.warning(f"Agente: Utilizador {user_id} não encontrado. A parar o agente.")
                    stop_agent_for_user(user_id)
                    return
                # --- FIM DA CORREÇÃO ---

                # 1. Busca por respostas (prioridade alta)
                atendimentos_para_responder = await crud_atendimento.get_atendimentos_for_processing(db, user_id=user_id)
                
                # 2. Busca por follow-ups (prioridade média) - agora a variável 'user' existe
                atendimentos_para_followup = await crud_atendimento.get_atendimentos_for_followup(db, user=user)

                atendimentos_para_processar = atendimentos_para_responder + atendimentos_para_followup
                
                if atendimentos_para_processar:
                    atendimento = atendimentos_para_processar[0]
                    action_taken = True
                    logger.info(f"Agente (Utilizador {user_id}): Processando atendimento ID {atendimento.id} para {atendimento.contact.whatsapp}")

                    situacoes_de_parada = ["Ignorar Contato", "Atendente Chamado", "Concluído"]
                    if atendimento.status in situacoes_de_parada:
                        logger.info(f"Atendimento {atendimento.id} com status '{atendimento.status}'. Nenhuma ação será tomada.")
                        update = schemas.AtendimentoUpdate(status="Aguardando") 
                        await crud_atendimento.update_atendimento(db, atendimento, update)
                        await db.commit() # Adicionado commit
                        continue

                    persona_config = await crud_config.get_config(db, config_id=atendimento.active_persona_id, user_id=user_id)
                    if not persona_config:
                        logger.error(f"Persona com ID {atendimento.active_persona_id} não encontrada. Pulando atendimento {atendimento.id}.")
                        update = schemas.AtendimentoUpdate(status="Erro: Persona não encontrada")
                        await crud_atendimento.update_atendimento(db, atendimento, update)
                        await db.commit() # Adicionado commit
                        continue
                    
                    history = json.loads(atendimento.conversa) if atendimento.conversa else []
                    
                    ia_response = gemini_service.generate_conversation_action(
                        config=persona_config,
                        contact=atendimento.contact,
                        conversation_history_db=history,
                        contexto_planilha=persona_config.contexto_json
                    )

                    message_to_send = ia_response.get("mensagem_para_enviar")
                    new_status = ia_response.get("nova_situacao", "Aguardando Resposta")
                    new_observation = ia_response.get("observacoes", "")
                    
                    if message_to_send:
                        # A variável 'user' já foi buscada no início do ciclo
                        success = await whatsapp_service.send_text_message(user.instance_name, atendimento.contact.whatsapp, message_to_send)
                        if success:
                            logger.info(f"Mensagem enviada para {atendimento.contact.whatsapp}.")
                            history.append({"role": "assistant", "content": message_to_send})
                            await crud_user.decrement_user_tokens(db, db_user=user)
                        else:
                            logger.error(f"FALHA ao enviar mensagem para {atendimento.contact.whatsapp}.")
                            new_status = "Falha no Envio"
                    else:
                        logger.info(f"IA decidiu não enviar mensagem para {atendimento.contact.whatsapp}.")
                        history.append({"role": "assistant", "content": "[Ação Interna: Não responder]"})

                    final_update = schemas.AtendimentoUpdate(
                        status=new_status,
                        observacoes=new_observation,
                        conversa=json.dumps(history)
                    )
                    await crud_atendimento.update_atendimento(db, db_atendimento=atendimento, atendimento_in=final_update)
                    await db.commit()

        except Exception as e:
            logger.error(f"ERRO no ciclo do agente (Utilizador {user_id}): {e}", exc_info=True)
        
        sleep_time = 10 if action_taken else 20
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