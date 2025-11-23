import asyncio
import logging
import random
import sys
from app.services.agent_processor import run_agent_cycle
# O sqs_service e webhook_processor não são importados aqui

# Configuração básica do logging
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
                    stream=sys.stdout)
logger = logging.getLogger(__name__)

async def agent_db_poller():
    """
    Loop infinito que verifica o banco de dados por atendimentos
    que precisam de processamento pela IA (ex: "Mensagem Recebida" > 15s).
    """
    logger.info("Worker-Agent: Iniciando poller do banco de dados (Agente de IA)...")
    
    while True:
        try:
            await run_agent_cycle() # Executa um ciclo completo do agente
            
            # Aguarda 5 segundos (como no seu requisito) + um jitter
            sleep_time = 5
            logger.info(f"Worker-Agent: Ciclo completo. Aguardando {sleep_time:.2f}s...")
            await asyncio.sleep(sleep_time)
            
        except Exception as e:
            logger.error(f"Worker-Agent: Erro crítico no loop do Agente DB: {e}", exc_info=True)
            await asyncio.sleep(60) # Pausa longa em caso de erro crítico


async def main():
    """
    Função principal do worker de agente.
    """
    logger.info("--- INICIANDO SERVIÇO DE WORKER (AGENTE IA) ---")
    await agent_db_poller()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Worker-Agent: Recebido sinal de parada. Desligando...")