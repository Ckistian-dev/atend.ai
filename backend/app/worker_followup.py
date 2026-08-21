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

from sqlalchemy import select
from sqlalchemy.orm import joinedload

async def run_auto_conclude_for_company(company_id: int):
    """Executa a lógica de auto-conclusão para atendimentos inativos da empresa."""
    async with SessionLocal() as db:
        try:
            async with db.begin():
                company = await db.get(models.Company, company_id)
                if not company:
                    return
                config = company.followup_config or {}
                auto_conclude_days = config.get("auto_conclude_days", 0)
                if auto_conclude_days and isinstance(auto_conclude_days, int) and auto_conclude_days > 0:
                    old_tickets = await crud_atendimento.get_atendimentos_by_status_and_inactivity(
                        db, company.id, "Atendente Chamado", auto_conclude_days
                    )
                    if old_tickets:
                        for ticket in old_tickets:
                            ticket_locked = await db.get(models.Atendimento, ticket.id, with_for_update=True)
                            if ticket_locked and ticket_locked.status == "Atendente Chamado":
                                ticket_locked.status = "Concluído"
                                ticket_locked.updated_at = datetime.now(timezone.utc)
                                db.add(ticket_locked)
                        logger.info(f"Follow-up: {len(old_tickets)} atendimentos auto-concluídos para a empresa {company_id}.")
        except Exception as e:
            logger.error(f"Erro na auto-conclusão para a empresa {company_id}: {e}", exc_info=True)

async def process_atendimento_followup_task(atendimento_id: int, company_id: int):
    """Processa um atendimento elegível para verificar e enviar o follow-up correspondente."""
    async with SessionLocal() as db:
        try:
            # 1. Carrega o atendimento e a empresa
            at = await db.get(
                models.Atendimento,
                atendimento_id,
                options=[joinedload(models.Atendimento.active_persona)]
            )
            company = await db.get(models.Company, company_id)
            
            if not at or not company:
                return
                
            # Garante que o status ainda é 'Aguardando Resposta'
            if at.status != "Aguardando Resposta":
                return
                
            config = company.followup_config or {}
            if not is_within_business_hours(config):
                return
                
            intervals = sorted(config.get("intervals", []), key=lambda x: x['hours'])
            if not intervals:
                return
                
            msgs_db = await crud_atendimento.get_messages_for_atendimento(db, atendimento_id, company_id)
            conversa = [
                {
                    "id": m.message_id,
                    "role": m.role,
                    "content": m.content or "",
                    "timestamp": int(m.timestamp.timestamp()) if m.timestamp else 0,
                    "type": m.type,
                    "tag": (m.extra_data or {}).get("tag") if isinstance(m.extra_data, dict) else None
                }
                for m in msgs_db
            ]
            
            # Encontrar timestamp da última mensagem do cliente
            last_client_ts = 0
            for msg in reversed(conversa):
                if msg.get('role') == 'user':
                    last_client_ts = _get_ts_from_message(msg)
                    if last_client_ts > 0:
                        break
            
            if last_client_ts == 0:
                return
                
            # Anti-Burst: Verificar se um follow-up foi enviado recentemente
            last_followup_ts = 0
            for msg in reversed(conversa):
                if msg.get('type') == 'followup':
                    ts = _get_ts_from_message(msg)
                    if ts > last_client_ts:
                        last_followup_ts = ts
                        break
                        
            now = datetime.now(timezone.utc)
            if last_followup_ts > 0 and intervals:
                min_gap_hours = intervals[0]['hours']
                time_since_last_followup_hours = (now.timestamp() - last_followup_ts) / 3600
                if time_since_last_followup_hours < min_gap_hours:
                    return
                    
            # Calcular inatividade baseada na última mensagem do cliente
            inactive_hours = (now.timestamp() - last_client_ts) / 3600
            if inactive_hours > 24:
                return
                
            # Verificar intervalos pendentes
            target_interval = None
            for interval in intervals:
                hours = interval['hours']
                if inactive_hours >= hours:
                    tag = f"followup_{hours}h_sent"
                    already_sent = False
                    for msg in conversa:
                        m_ts = _get_ts_from_message(msg)
                        if m_ts > last_client_ts and msg.get('tag') == tag:
                            already_sent = True
                            break
                    if not already_sent:
                        target_interval = interval
                        break
                        
            if not target_interval:
                return
                
            followup_key = f"followup_{target_interval['hours']}h_sent"
            logger.info(f"Follow-up (At. {atendimento_id}): Inativo por {inactive_hours:.2f}h. Gerando follow-up de {target_interval['hours']}h.")
            
            # Chama o serviço de IA para o follow-up
            gemini_service = get_gemini_service()
            ia_response = await gemini_service.generate_followup_action(
                whatsapp=at,
                conversation_history_db=conversa,
                db=db,
                company=company
            )
            
            action = ia_response.get("action") or ia_response.get("acao")
            message_to_send = ia_response.get("mensagem_para_enviar") or ia_response.get("mensagem")
            
            if action == "skip":
                logger.info(f"Follow-up (At. {atendimento_id}): IA decidiu pular o follow-up.")
                reason = message_to_send or "IA decidiu pular este follow-up."
                
                async with SessionLocal() as db_final:
                    async with db_final.begin():
                        at_locked = await db_final.get(models.Atendimento, atendimento_id, with_for_update=True)
                        if at_locked and at_locked.status == "Aguardando Resposta":
                            current_msgs = await crud_atendimento.get_messages_for_atendimento(db_final, atendimento_id, company_id)
                            already_sent = False
                            for msg in current_msgs:
                                m_ts = int(msg.timestamp.timestamp()) if msg.timestamp else 0
                                msg_tag = (msg.extra_data or {}).get("tag") if isinstance(msg.extra_data, dict) else None
                                if m_ts > last_client_ts and msg_tag == followup_key:
                                    already_sent = True
                                    break
                                    
                            if not already_sent:
                                system_message = {
                                    "id": f"skip-{int(now.timestamp())}",
                                    "role": "system",
                                    "content": reason,
                                    "timestamp": int(now.timestamp()),
                                    "type": "followup_skipped",
                                    "extra_data": {"tag": followup_key}
                                }
                                await crud_atendimento.save_message(
                                    db=db_final,
                                    company_id=company_id,
                                    atendimento_id=atendimento_id,
                                    message_data=system_message
                                )
                                at_locked.updated_at = datetime.now(timezone.utc)
                                db_final.add(at_locked)
                                logger.info(f"Follow-up (At. {atendimento_id}): Registro de skip salvo com sucesso.")
                            else:
                                logger.warning(f"Follow-up (At. {atendimento_id}): Detectado skip duplicado no lock, cancelando.")
                return
                
            if message_to_send:
                message_to_send = message_to_send.replace('\\n', '\n').replace('\\', '')
                
                whatsapp_service = get_whatsapp_service()
                sent_info = await whatsapp_service.send_text_message(company, at.whatsapp, message_to_send)
                
                new_message = {
                    "id": sent_info.get('id'),
                    "role": "assistant",
                    "content": message_to_send,
                    "timestamp": int(now.timestamp()),
                    "type": "followup",
                    "is_ai": True,
                    "extra_data": {"tag": followup_key}
                }
                
                async with SessionLocal() as db_final:
                    async with db_final.begin():
                        at_locked = await db_final.get(models.Atendimento, atendimento_id, with_for_update=True)
                        if at_locked and at_locked.status == "Aguardando Resposta":
                            current_msgs = await crud_atendimento.get_messages_for_atendimento(db_final, atendimento_id, company_id)
                            already_sent = False
                            for msg in current_msgs:
                                m_ts = int(msg.timestamp.timestamp()) if msg.timestamp else 0
                                msg_tag = (msg.extra_data or {}).get("tag") if isinstance(msg.extra_data, dict) else None
                                if m_ts > last_client_ts and msg_tag == followup_key:
                                    already_sent = True
                                    break
                                    
                            if not already_sent:
                                await crud_atendimento.save_message(
                                    db=db_final,
                                    company_id=company_id,
                                    atendimento_id=atendimento_id,
                                    message_data=new_message
                                )
                                at_locked.updated_at = datetime.now(timezone.utc)
                                db_final.add(at_locked)
                                logger.info(f"Follow-up (At. {atendimento_id}): Mensagem enviada e salva com sucesso.")
                            else:
                                logger.warning(f"Follow-up (At. {atendimento_id}): Detectada mensagem duplicada no lock, cancelando salvamento.")
            else:
                logger.warning(f"Follow-up (At. {atendimento_id}): IA não retornou mensagem para envio. Resposta: {ia_response}")
        except Exception as e:
            logger.error(f"Follow-up: Erro processando atendimento {atendimento_id}: {e}", exc_info=True)

async def followup_poller():
    """Loop que verifica e dispara follow-ups de forma concorrente e segura."""
    logger.info("Worker-Followup: Iniciando poller de follow-up...")
    while True:
        try:
            logger.info("Verificando atendimentos para follow-up...")
            async with SessionLocal() as db:
                # 1. Obter todas as empresas com follow-up ativo
                stmt = select(models.Company).where(models.Company.followup_active == True)
                res = await db.execute(stmt)
                companies = res.scalars().all()
                company_ids = [c.id for c in companies]
            
            # Executa a auto-conclusão para cada empresa em background
            for cid in company_ids:
                asyncio.create_task(run_auto_conclude_for_company(cid))

            # 2. Identifica os atendimentos candidatos a follow-up
            tasks = []
            async with SessionLocal() as db:
                for cid in company_ids:
                    company = await db.get(models.Company, cid)
                    if not company or not is_within_business_hours(company.followup_config or {}):
                        continue
                    
                    now = datetime.now(timezone.utc)
                    config = company.followup_config or {}
                    intervals = config.get("intervals", [])
                    if not intervals:
                        continue
                    
                    min_hours = min(interval['hours'] for interval in intervals)
                    earliest_time = now - timedelta(hours=min_hours)
                    latest_time = now - timedelta(hours=24)
                    
                    stmt_at = (
                        select(models.Atendimento.id)
                        .where(
                            models.Atendimento.company_id == cid,
                            models.Atendimento.status == "Aguardando Resposta",
                            models.Atendimento.updated_at < earliest_time,
                            models.Atendimento.updated_at > latest_time
                        )
                    )
                    res_at = await db.execute(stmt_at)
                    atendimento_ids = res_at.scalars().all()
                    
                    for at_id in atendimento_ids:
                        tasks.append((at_id, cid))
            
            if tasks:
                logger.info(f"Encontrados {len(tasks)} atendimentos candidatos a follow-up. Processando com limite de concorrência...")
                sem = asyncio.Semaphore(10)  # Limita a 10 conexões simultâneas da pool do SQLAlchemy
                
                async def sem_task(at_id, cid):
                    async with sem:
                        await process_atendimento_followup_task(at_id, cid)
                
                await asyncio.gather(*(sem_task(at_id, cid) for at_id, cid in tasks))
            else:
                logger.info("Nenhum atendimento elegível para follow-up neste ciclo.")
                
            await asyncio.sleep(30)
            
        except Exception as e:
            logger.error(f"Worker-Followup: Erro crítico no loop: {e}", exc_info=True)
            await asyncio.sleep(30)

async def main():
    logger.info("--- INICIANDO SERVIÇO DE WORKER (FOLLOW-UP) ---")
    await followup_poller()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Worker-Followup: Recebido sinal de parada. Desligando...")