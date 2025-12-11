import asyncio
import logging
import sys
from datetime import datetime, timezone, timedelta
import pytz
import json

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import SessionLocal
from app.db import models
from app.crud import crud_user, crud_atendimento
from app.services.gemini_service import get_gemini_service
from app.services.whatsapp_service import get_whatsapp_service

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
                    stream=sys.stdout)
logger = logging.getLogger(__name__)

def is_within_business_hours(config: dict) -> bool:
    """Verifica se a hora atual está dentro do horário comercial configurado."""
    try:
        now_utc = datetime.now(timezone.utc)
        user_tz = pytz.timezone(config.get("timezone", "America/Sao_Paulo"))
        now_local = now_utc.astimezone(user_tz)

        business_hours = config.get("business_hours", {})
        start_time_str = business_hours.get("start", "00:00")
        end_time_str = business_hours.get("end", "23:59")
        active_days = business_hours.get("days", list(range(7)))

        start_time = datetime.strptime(start_time_str, "%H:%M").time()
        end_time = datetime.strptime(end_time_str, "%H:%M").time()
        
        day_of_week = now_local.isoweekday() % 7

        if day_of_week not in active_days:
            return False

        if not (start_time <= now_local.time() <= end_time):
            return False

        return True
    except Exception as e:
        logger.error(f"Follow-up: Erro ao verificar horário comercial: {e}", exc_info=True)
        return False

async def process_followups_for_user(user: models.User, db: AsyncSession):
    """Processa todos os follow-ups pendentes para um usuário."""
    if not user.followup_active or not user.followup_config:
        return

    config = user.followup_config
    if not is_within_business_hours(config):
        return

    intervals = sorted(config.get("intervals", []), key=lambda x: x['hours'])
    if not intervals:
        return

    gemini_service = get_gemini_service()
    whatsapp_service = get_whatsapp_service()

    min_hours = intervals[0]['hours']
    now = datetime.now(timezone.utc)
    earliest_time = now - timedelta(hours=min_hours)
    latest_time = now - timedelta(hours=24)

    atendimentos = await crud_atendimento.get_atendimentos_for_followup(
        db, user_id=user.id, earliest_time=earliest_time, latest_time=latest_time
    )

    for at in atendimentos:
        try:
            inactive_duration = now - at.updated_at
            inactive_hours = inactive_duration.total_seconds() / 3600

            target_interval = next((interval for interval in reversed(intervals) if inactive_hours >= interval['hours']), None)
            
            if not target_interval:
                continue

            conversa = json.loads(at.conversa or "[]")
            followup_key = f"followup_{target_interval['hours']}h_sent"
            
            if any(msg.get("tag") == followup_key for msg in conversa):
                continue

            logger.info(f"Follow-up (At. {at.id}): Inativo por {inactive_hours:.2f}h. Gerando follow-up de {target_interval['hours']}h.")

            # A persona ativa já é carregada na busca de atendimentos
            persona_config = at.active_persona
            # Se não houver persona no atendimento, usa a padrão do usuário (também já carregada)
            if not persona_config:
                persona_config = user.default_persona

            if not persona_config:
                logger.warning(f"Follow-up (At. {at.id}): Pulando, sem persona ativa no atendimento e sem persona padrão no usuário.")
                continue

            contexto_planilha = persona_config.contexto_json
            arquivos_drive_json = persona_config.arquivos_drive_json

            ia_response = await gemini_service.generate_conversation_action(
                whatsapp=at,
                conversation_history_db=conversa,
                contexto_planilha=contexto_planilha,
                arquivos_drive_json=arquivos_drive_json,
                db=db,
                user=user,
                followup_interval_hours=target_interval['hours']
            )

            message_to_send = ia_response.get("mensagem_para_enviar")

            if message_to_send:
                sent_info = await whatsapp_service.send_text_message(user, at.whatsapp, message_to_send)
                
                new_message = {
                    "id": sent_info.get('id'), "role": "assistant", "content": message_to_send,
                    "timestamp": int(now.timestamp()), "type": "followup", "tag": followup_key
                }
                conversa.append(new_message)
                at.conversa = json.dumps(conversa, ensure_ascii=False)
                db.add(at)
                await db.commit()
                logger.info(f"Follow-up (At. {at.id}): Mensagem enviada.")

        except Exception as e:
            logger.error(f"Follow-up: Erro ao processar atendimento {at.id}: {e}", exc_info=True)
            await db.rollback()

async def followup_poller():
    """Loop que verifica e dispara follow-ups."""
    logger.info("Worker-Followup: Iniciando poller de follow-up...")
    while True:
        try:
            async with SessionLocal() as db:
                users_with_followup = await crud_user.get_users_with_followup_active(db)
                
                if users_with_followup:
                    tasks = [process_followups_for_user(user, db) for user in users_with_followup]
                    await asyncio.gather(*tasks)

            await asyncio.sleep(300)
        except Exception as e:
            logger.error(f"Worker-Followup: Erro crítico no loop: {e}", exc_info=True)
            await asyncio.sleep(300)

async def main():
    logger.info("--- INICIANDO SERVIÇO DE WORKER (FOLLOW-UP) ---")
    await followup_poller()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Worker-Followup: Recebido sinal de parada. Desligando...")