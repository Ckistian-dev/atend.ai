import aio_pika
import json
import logging
import asyncio
import time  # <--- IMPORT NOVO PARA O CONTROLE DE TEMPO
import sys

# Configuração de logging DEVE vir antes dos imports da app
logging.basicConfig(level=logging.INFO, 
                    format='%(asctime)s - %(levelname)s - %(message)s',
                    stream=sys.stdout)

# Importa as configurações centralizadas
from app.core.config import settings
# Importa as funções de processamento que contêm a lógica de negócio
from app.services.webhook_processor import process_official_message_task, process_official_status_task
logger = logging.getLogger(__name__)

async def process_message(body: bytes) -> bool:
    """
    Função que decodifica a mensagem e chama a lógica de negócio assíncrona apropriada.
    """
    try:
        data = json.loads(body)
        
        # --- INÍCIO DA PROTEÇÃO ANTI-FLOOD (EFEITO MANADA) ---
        try:
            message_timestamp = None
            
            # Tenta extrair o timestamp se for uma mensagem recebida
            if 'messages' in data and isinstance(data['messages'], list) and len(data['messages']) > 0:
                message_timestamp = data['messages'][0].get('timestamp')
            
            # Tenta extrair o timestamp se for uma atualização de status
            elif 'statuses' in data and isinstance(data['statuses'], list) and len(data['statuses']) > 0:
                message_timestamp = data['statuses'][0].get('timestamp')
            
            # Se encontrou um timestamp, verifica a idade
            if message_timestamp:
                current_time = int(time.time())
                msg_time = int(message_timestamp)
                age = current_time - msg_time
                
                if age > settings.MAX_MESSAGE_AGE_SECONDS:
                    logger.warning(f"🚫 [ANTI-FLOOD] Mensagem IGNORADA! Atraso de {age}s (Limite: {settings.MAX_MESSAGE_AGE_SECONDS}s). Timestamp: {msg_time}")
                    # Retorna True para confirmar (ack) a mensagem e removê-la da fila sem processar
                    return True
                    
        except Exception as e:
            # Se der erro na verificação do tempo, apenas loga e tenta processar normalmente
            logger.error(f"Erro na verificação anti-flood: {e}")
        # --- FIM DA PROTEÇÃO ANTI-FLOOD ---

        logger.info(f"[*] Mensagem recebida (Processando): {json.dumps(data)[:200]}...")

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
    connection = await aio_pika.connect_robust(settings.RABBITMQ_URL)
    logger.info("Conexão com RabbitMQ estabelecida.")

    async with connection:
        # Criando o canal
        channel = await connection.channel()

        # Define que o worker só pegará uma mensagem por vez (Quality of Service)
        await channel.set_qos(prefetch_count=1)

        # Declara a fila, garantindo que ela exista e seja durável
        queue = await channel.declare_queue(settings.RABBITMQ_WEBHOOK_QUEUE, durable=True)

        logger.info(f"[*] Aguardando mensagens na fila '{settings.RABBITMQ_WEBHOOK_QUEUE}'. Para sair, pressione CTRL+C")

        # Itera sobre as mensagens da fila de forma assíncrona
        async with queue.iterator() as queue_iter:
            async for message in queue_iter:
                async with message.process():
                    # logger.info(f" [x] Recebido da fila '{message.routing_key}'") # Comentado para reduzir log
                    
                    # Chama a função de processamento assíncrona
                    success = await process_message(message.body)

                    if success:
                        # logger.info(" [x] Done, message acknowledged.")
                        pass
                    else:
                        logger.warning(" [!] Message processing failed, message rejected.")

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Consumidor interrompido pelo usuário.")