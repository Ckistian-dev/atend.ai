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

def _get_ts_from_message(msg: dict) -> float:
    """Helper to extract a float timestamp from a message dict."""
    raw_ts = msg.get('timestamp')
    if isinstance(raw_ts, (int, float)):
        return float(raw_ts)
    elif isinstance(raw_ts, str):
        try:
            # Handles ISO format strings like '2024-01-01T12:00:00Z' or '2024-01-01T12:00:00+00:00'
            return datetime.fromisoformat(raw_ts.replace("Z", "+00:00")).timestamp()
        except (ValueError, TypeError):
            pass
    return 0.0

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
    auto_conclude_days = config.get("auto_conclude_days", 0)

    # --- LÓGICA DE AUTO-CONCLUSÃO ---
    if auto_conclude_days and isinstance(auto_conclude_days, int) and auto_conclude_days > 0:
        try:
            old_tickets = await crud_atendimento.get_atendimentos_by_status_and_inactivity(
                db, user.id, "Atendente Chamado", auto_conclude_days
            )
            
            if old_tickets:
                for ticket in old_tickets:
                    ticket.status = "Concluído"
                    # Atualiza timestamp para refletir a conclusão
                    ticket.updated_at = datetime.now(timezone.utc)
                    db.add(ticket)
                
                await db.commit()
                logger.info(f"Follow-up: {len(old_tickets)} atendimentos 'Atendente Chamado' auto-concluídos para user {user.id} (Inatividade > {auto_conclude_days} dias).")
        except Exception as e:
            logger.error(f"Erro na auto-conclusão para user {user.id}: {e}", exc_info=True)

    # Se não houver intervalos configurados, encerra aqui (após ter tentado a auto-conclusão)
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
                    last_client_ts = _get_ts_from_message(msg)
                    if last_client_ts > 0:
                        break
            
            if last_client_ts == 0:
                continue

            # 1.5. Anti-Burst: Verificar se um follow-up foi enviado recentemente.
            last_followup_ts = 0
            for msg in reversed(conversa):
                if msg.get('type') == 'followup':
                    ts = _get_ts_from_message(msg)
                    if ts > last_client_ts: # Só conta follow-ups após a última msg do cliente
                        last_followup_ts = ts
                        break # Pega o mais recente

            # Se um follow-up já foi enviado, garante um intervalo mínimo antes de enviar o próximo.
            if last_followup_ts > 0 and intervals:
                # Usa o primeiro intervalo como o "gap" mínimo para evitar rajadas.
                min_gap_hours = intervals[0]['hours']
                time_since_last_followup_hours = (now.timestamp() - last_followup_ts) / 3600
                
                if time_since_last_followup_hours < min_gap_hours:
                    # logger.debug(f"Follow-up (At. {at.id}): Pulando, último follow-up enviado há {time_since_last_followup_hours:.2f}h (mínimo {min_gap_hours}h).")
                    continue

            # 2. Calcular inatividade baseada na ÚLTIMA MENSAGEM DO CLIENTE
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
                        m_ts = _get_ts_from_message(msg)
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

            action = ia_response.get("action")
            message_to_send = ia_response.get("mensagem_para_enviar")

            if action == "skip":
                logger.info(f"Follow-up (At. {at.id}): IA decidiu pular o follow-up (Risco de loop/insatisfação).")
                continue

            elif message_to_send:
                # Limpa a mensagem (remove backslashes e corrige newlines literais)
                message_to_send = message_to_send.replace('\\n', '\n').replace('\\', '')
                
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