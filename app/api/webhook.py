# app/api/webhook.py

import logging
from fastapi import APIRouter, Request, BackgroundTasks, HTTPException
from app.db.database import SessionLocal
from app.crud import crud_user, crud_atendimento
from app.db import schemas

logger = logging.getLogger(__name__)
router = APIRouter()

async def set_atendimento_status_to_received(data: dict):
    """
    Função de background que apenas atualiza o status do atendimento para 'Mensagem Recebida'.
    """
    async with SessionLocal() as db:
        try:
            instance_name = data.get('instance')
            message_data = data.get('data', {})
            key = message_data.get('key', {})
            contact_number_full = key.get('remoteJid', '')

            if not contact_number_full or "@g.us" in contact_number_full:
                if "@g.us" in contact_number_full:
                    logger.info(f"Mensagem de grupo ignorada: {contact_number_full}")
                return

            contact_number = contact_number_full.split('@')[0]
            
            user = await crud_user.get_user_by_instance(db, instance_name=instance_name)
            if not user:
                logger.warning(f"Webhook: Usuário não encontrado para a instância {instance_name}")
                return

            result = await crud_atendimento.get_or_create_atendimento_by_number(db, number=contact_number, user=user)
            if not result:
                return

            atendimento, was_created = result
            
            # Verifica se o atendimento está em um estado que impede o processamento de novas mensagens
            situacoes_de_parada = ["Ignorar Contato", "Atendente Chamado", "Concluído"]
            if not was_created and atendimento.status in situacoes_de_parada:
                logger.info(f"Mensagem de {contact_number} ignorada. Atendimento ID {atendimento.id} com status '{atendimento.status}'.")
                return

            # A única responsabilidade do webhook agora é sinalizar que uma nova mensagem chegou.
            atendimento_update = schemas.AtendimentoUpdate(status="Mensagem Recebida")
            await crud_atendimento.update_atendimento(db, db_atendimento=atendimento, atendimento_in=atendimento_update)
            
            await db.commit()
            logger.info(f"Atendimento ID {atendimento.id} para {contact_number} marcado como 'Mensagem Recebida'. O agente irá processar.")

        except Exception as e:
            await db.rollback()
            logger.error(f"ERRO CRÍTICO no webhook simplificado: {e}", exc_info=True)


@router.post("/evolution/messages-upsert", summary="Receber eventos de novas mensagens")
async def receive_evolution_messages_upsert(request: Request, background_tasks: BackgroundTasks):
    try:
        data = await request.json()
        is_new_message = (
            data.get("event") == "messages.upsert" and
            not data.get("data", {}).get("key", {}).get("fromMe", False)
        )

        if is_new_message:
            # A tarefa de background agora é muito mais leve
            background_tasks.add_task(set_atendimento_status_to_received, data)

        return {"status": "message_triggered"}
    except Exception as e:
        logger.error(f"Erro ao processar corpo do webhook: {e}")
        raise HTTPException(status_code=400, detail="Invalid JSON data")