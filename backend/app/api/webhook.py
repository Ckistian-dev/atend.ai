import logging
import json
from fastapi import APIRouter, Request, HTTPException, Response, BackgroundTasks

# Importa as configurações para acessar o token de verificação
from app.core.config import settings

# Importa o nosso novo produtor de mensagens para RabbitMQ
from app.services.message_producer import send_webhook_to_queue

logger = logging.getLogger(__name__)
router = APIRouter()

@router.post("/official/webhook", summary="Receber eventos da API Oficial (Meta)")
async def receive_official_webhook(request: Request, background_tasks: BackgroundTasks):
    """
    Endpoint para receber webhooks da API Oficial do WhatsApp (Meta).
    Envia os eventos para uma fila RabbitMQ para processamento assíncrono.
    """
    try:
        payload = await request.json()
        if payload.get('object') == 'whatsapp_business_account' and isinstance(payload.get('entry'), list):
            for entry in payload['entry']:
                if isinstance(entry.get('changes'), list):
                    for change in entry['changes']:
                        if isinstance(change.get('value'), dict):
                            value_payload = change['value']
                            messages = value_payload.get('messages')
                            statuses = value_payload.get('statuses')
                            
                            # Se houver mensagens ou status, envia o payload 'value' para a fila.
                            # Usamos BackgroundTasks para que a chamada ao RabbitMQ não bloqueie a resposta à Meta.
                            if messages or statuses:
                                logger.info("Webhook: Adicionando tarefa em background para enviar ao RabbitMQ.")
                                background_tasks.add_task(send_webhook_to_queue, value_payload)
                            else:
                                logger.info("Webhook: Payload 'value' recebido sem 'messages' ou 'statuses'. Nada a fazer.")

            return Response(status_code=200)
        else:
            logger.warning(f"WBP Webhook: Payload recebido com estrutura inválida: {payload}")
            raise HTTPException(status_code=400, detail="Invalid payload structure")

    except json.JSONDecodeError:
        logger.error("WBP Webhook: Erro ao decodificar JSON.", exc_info=True)
        raise HTTPException(status_code=400, detail="Invalid JSON data")
    except Exception as e:
        logger.error(f"WBP Webhook: Erro inesperado no endpoint principal: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/official/webhook", summary="Verificar webhook da API Oficial (Meta)")
async def verify_official_webhook(request: Request):
    """
    Endpoint GET para a verificação inicial do webhook pela Meta.
    Este é o endpoint que a Meta chama com o 'hub.challenge'.
    """
    verify_token = request.query_params.get('hub.verify_token')
    mode = request.query_params.get('hub.mode')
    challenge = request.query_params.get('hub.challenge')

    # Verifica se o token de verificação está configurado nas variáveis de ambiente
    if not settings.WBP_VERIFY_TOKEN:
        logger.error("WBP Webhook Verify: WBP_VERIFY_TOKEN não configurado!")
        raise HTTPException(status_code=500, detail="Server configuration error")

    # Valida se o modo e o token correspondem ao esperado
    if mode == 'subscribe' and verify_token == settings.WBP_VERIFY_TOKEN:
        logger.info("WBP Webhook: Verificação GET bem-sucedida!")
        return Response(content=challenge, status_code=200, media_type="text/plain")
    else:
        logger.warning(f"WBP Webhook: Falha na verificação GET. Modo: {mode}, Token Recebido: '{verify_token}'")
        raise HTTPException(status_code=403, detail="Verification token mismatch")