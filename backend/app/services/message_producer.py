# app/services/message_producer.py (Exemplo de um novo arquivo/módulo)

import aio_pika
import os
import json
import logging
import asyncio

# Configuração básica de logging
logger = logging.getLogger(__name__)

RABBITMQ_URL = os.getenv("RABBITMQ_URL")
QUEUE_NAME = os.getenv("RABBITMQ_WEBHOOK_QUEUE")

async def send_webhook_to_queue(webhook_data: dict):
    """
    Conecta ao RabbitMQ de forma assíncrona, garante que a fila exista e envia uma mensagem.
    """
    try:
        # Estabelece a conexão assíncrona com o RabbitMQ
        connection = await aio_pika.connect_robust(RABBITMQ_URL)

        async with connection:
            # Cria um canal
            channel = await connection.channel()

            # Declara a fila. `durable=True` garante que a fila sobreviva a reinicializações do RabbitMQ.
            await channel.declare_queue(QUEUE_NAME, durable=True)

            message_body = json.dumps(webhook_data).encode()

            # Cria a mensagem com modo de entrega persistente
            message = aio_pika.Message(
                body=message_body,
                delivery_mode=aio_pika.DeliveryMode.PERSISTENT
            )

            # Publica a mensagem na Default Exchange, roteando para a nossa fila
            await channel.default_exchange.publish(
                message,
                routing_key=QUEUE_NAME
            )
            logger.info(f" [x] Sent message to queue '{QUEUE_NAME}'")

    except asyncio.CancelledError:
        logger.warning("Envio para o RabbitMQ cancelado.")
    except Exception as e:
        logger.error(f"Ocorreu um erro inesperado ao enviar para o RabbitMQ: {e}", exc_info=True)
        # Aqui você pode adicionar uma lógica de fallback, se necessário
        raise
