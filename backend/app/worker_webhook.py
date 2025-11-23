# app/worker_webhook.py (Código adaptado para o seu worker)

import aio_pika
import os
import json
import logging
import asyncio

# Importa as funções de processamento que contêm a lógica de negócio
from app.services.webhook_processor import process_official_message_task, process_official_status_task

# Configuração básica de logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

RABBITMQ_URL = os.getenv("RABBITMQ_URL")
QUEUE_NAME = os.getenv("RABBITMQ_WEBHOOK_QUEUE")
logger = logging.getLogger(__name__)

async def process_message(body: bytes) -> bool:
    """
    Função que decodifica a mensagem e chama a lógica de negócio assíncrona apropriada.
    """
    try:
        data = json.loads(body)
        logger.info(f"[*] Mensagem recebida: {json.dumps(data)[:200]}...") # Loga o início da mensagem

        # Verifica se a mensagem é de 'messages' ou 'statuses' e chama a função correta
        if 'messages' in data:
            logger.info("Worker: Detectado payload de 'message'. Iniciando process_official_message_task.")
            await process_official_message_task(data)
        elif 'statuses' in data:
            logger.info("Worker: Detectado payload de 'status'. Iniciando process_official_status_task.")
            await process_official_status_task(data)
        else:
            logger.warning(f"Worker: Mensagem recebida sem 'messages' ou 'statuses'. Payload: {data}")

        logger.info("[*] Tarefa de processamento da mensagem concluída.")
        return True
    except json.JSONDecodeError:
        logger.error("Erro ao decodificar JSON da mensagem.")
        return False # Indica falha no processamento
    except Exception as e:
        logger.error(f"Erro ao processar a mensagem: {e}", exc_info=True)
        return False # Indica falha no processamento

async def main() -> None:
    # aio_pika gerencia a reconexão automaticamente com `connect_robust`
    connection = await aio_pika.connect_robust(RABBITMQ_URL)
    logger.info("Conexão com RabbitMQ estabelecida.")

    async with connection:
        # Criando o canal
        channel = await connection.channel()

        # Define que o worker só pegará uma mensagem por vez (Quality of Service)
        await channel.set_qos(prefetch_count=1)

        # Declara a fila, garantindo que ela exista e seja durável
        queue = await channel.declare_queue(QUEUE_NAME, durable=True)

        logger.info(f"[*] Aguardando mensagens na fila '{QUEUE_NAME}'. Para sair, pressione CTRL+C")

        # Itera sobre as mensagens da fila de forma assíncrona
        async with queue.iterator() as queue_iter:
            async for message in queue_iter:
                async with message.process():
                    logger.info(f" [x] Recebido da fila '{message.routing_key}'")
                    
                    # Chama a função de processamento assíncrona
                    success = await process_message(message.body)

                    if success:
                        logger.info(" [x] Done, message acknowledged.")
                    else:
                        # A mensagem não será reenfileirada por padrão com `message.process()`.
                        # Para rejeitar e reenfileirar, você usaria message.nack(requeue=True)
                        # Para rejeitar e descartar (ou enviar para DLX), basta não fazer nada
                        # ou usar message.reject(requeue=False). O `async with` já faz isso.
                        logger.warning(" [!] Message processing failed, message rejected.")

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Consumidor interrompido pelo usuário.")
