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

    now = datetime.now(timezone.utc)
    
    # Busca atendimentos atualizados nas últimas 24h (filtro amplo no banco)
    # Passamos 'now' como earliest_time para ignorar o filtro de "mais antigo que X" do SQL,
    # pois faremos a verificação precisa do timestamp do cliente via Python.
    earliest_time = now
    latest_time = now - timedelta(hours=24)

    atendimentos = await crud_atendimento.get_atendimentos_for_followup(
        db, user_id=user.id, earliest_time=earliest_time, latest_time=latest_time
    )

    for at in atendimentos:
        try:
            conversa = json.loads(at.conversa or "[]")
            
            # 1. Encontrar o timestamp da ÚLTIMA MENSAGEM DO CLIENTE
            last_client_ts = 0
            for msg in reversed(conversa):
                if msg.get('role') == 'user':
                    raw_ts = msg.get('timestamp')
                    # Tratamento robusto para timestamp (int/float ou string ISO)
                    if isinstance(raw_ts, (int, float)):
                        last_client_ts = float(raw_ts)
                    elif isinstance(raw_ts, str):
                        try:
                            dt = datetime.fromisoformat(raw_ts.replace("Z", "+00:00"))
                            last_client_ts = dt.timestamp()
                        except: pass
                    break
            
            if last_client_ts == 0:
                continue

            # 2. Calcular inatividade baseada no CLIENTE
            time_since_client = now.timestamp() - last_client_ts
            inactive_hours = time_since_client / 3600

            # Janela de 24h estrita baseada na mensagem do cliente
            if inactive_hours > 24:
                continue

            # 3. Verificar intervalos pendentes
            target_interval = None
            
            for interval in intervals:
                hours = interval['hours']
                if inactive_hours >= hours:
                    # Verifica se JÁ ENVIAMOS este follow-up APÓS a última mensagem do cliente
                    tag = f"followup_{hours}h_sent"
                    already_sent = False
                    
                    for msg in conversa:
                        # Pega timestamp da mensagem
                        m_ts = 0
                        m_raw = msg.get('timestamp')
                        if isinstance(m_raw, (int, float)): m_ts = float(m_raw)
                        elif isinstance(m_raw, str):
                            try: m_ts = datetime.fromisoformat(m_raw.replace("Z", "+00:00")).timestamp()
                            except: pass
                        
                        # Só conta se foi enviada DEPOIS do cliente falar
                        if m_ts > last_client_ts and msg.get('tag') == tag:
                            already_sent = True
                            break
                    
                    if not already_sent:
                        target_interval = interval
                        break # Envia apenas o primeiro intervalo pendente (sequencial)
            
            if not target_interval:
                continue

            followup_key = f"followup_{target_interval['hours']}h_sent"
            
            logger.info(f"Follow-up (At. {at.id}): Inativo por {inactive_hours:.2f}h. Gerando follow-up de {target_interval['hours']}h.")

            # Chama o serviço de IA específico para follow-up
            ia_response = await gemini_service.generate_followup_action(
                whatsapp=at,
                conversation_history_db=conversa,
                db=db,
                user=user
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
            logger.info(f"Verificando atendimentos para follow-up...")
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