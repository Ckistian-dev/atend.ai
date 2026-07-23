import asyncio
import logging
import sys
from datetime import datetime, timezone, timedelta

from sqlalchemy import select
from app.db.database import SessionLocal
from app.db import models
from app.services.integration_service import IntegrationService

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    stream=sys.stdout
)
logger = logging.getLogger("worker_integrations")

async def sync_due_integrations():
    """
    Verifica e executa integrações do tipo Polling ativas que estão prontas para sincronização.
    """
    async with SessionLocal() as db:
        try:
            now = datetime.now(timezone.utc)
            stmt = select(models.Integration).where(
                models.Integration.enabled == True,
                models.Integration.integration_type == "polling"
            )
            res = await db.execute(stmt)
            integrations = res.scalars().all()

            if not integrations:
                logger.debug("Nenhuma integração Polling ativa cadastrada.")
                return

            tasks_to_run = []
            for integration in integrations:
                last_sync = integration.last_sync_at
                interval_minutes = integration.sync_interval_minutes or 5

                # Se nunca sincronizou ou se já passou o tempo do intervalo
                if last_sync is None or (now - last_sync) >= timedelta(minutes=interval_minutes):
                    tasks_to_run.append(integration)

            if tasks_to_run:
                logger.info(f"Encontradas {len(tasks_to_run)} integrações prontas para sincronização por Polling.")
                for integration in tasks_to_run:
                    try:
                        logger.info(f"Executando Polling para integração '{integration.name}' (ID: {integration.id})...")
                        count = await IntegrationService.run_integration_sync(db, integration)
                        logger.info(f"Sucesso na integração '{integration.name}' (ID: {integration.id})! {count} vetores atualizados.")
                    except Exception as e:
                        logger.error(f"Erro ao sincronizar integração '{integration.name}' (ID: {integration.id}): {e}", exc_info=True)
            else:
                logger.debug("Nenhuma integração pendente de sincronização neste ciclo.")

        except Exception as e:
            logger.error(f"Erro no ciclo do worker de integrações: {e}", exc_info=True)

async def main():
    logger.info("--- INICIANDO WORKER DE INTEGRAÇÕES (POLLING 5 MIN) ---")
    while True:
        try:
            await sync_due_integrations()
        except Exception as e:
            logger.error(f"Erro crítico no loop principal do worker: {e}", exc_info=True)
        
        # Dorme 30 segundos antes de checar a próxima fila de integrações
        await asyncio.sleep(30)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Worker de Integrações encerrado pelo usuário.")
