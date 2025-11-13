import logging
from fastapi import APIRouter, Request, HTTPException, Response # Import Response
from app.db.database import SessionLocal, get_db # Import get_db
from app.crud import crud_user, crud_atendimento, crud_config # Import crud_config
from app.db import models, schemas # Import models
from app.core.config import settings # Import settings
from app.services.whatsapp_service import  get_whatsapp_service
from app.services.gemini_service import get_gemini_service
from app.services.security import decrypt_token # Import decrypt_token
import json # Import json
from datetime import datetime, timezone # Import datetime, timezone
from sqlalchemy.future import select # Para usar select
from sqlalchemy.orm import joinedload # Para carregar relacionamentos
from typing import Optional # Importa Optional
from app.tasks import process_official_message_task, process_official_status_task

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/official/webhook", summary="Receber eventos da API Oficial (Meta)")
async def receive_official_webhook(request: Request):
    """
    Endpoint para receber webhooks da API Oficial do WhatsApp (Meta).
    Modificado para iterar sobre 'entry' e 'changes'.
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

                            if messages:
                                process_official_message_task.delay(value_payload)
                            elif statuses:
                                # Em vez de apenas logar, chamamos a task para processar o status
                                # A task cuidará de logar a falha e atualizar o DB
                                process_official_status_task.delay(value_payload)
                                
            return Response(status_code=200)
        else:
            logger.warning(f"WBP Webhook: Payload recebido com estrutura inválida ou 'object' não esperado: {payload}")
            raise HTTPException(status_code=400, detail="Invalid payload structure")

    except json.JSONDecodeError:
         logger.error("WBP Webhook: Erro ao decodificar JSON.")
         raise HTTPException(status_code=400, detail="Invalid JSON data")
    except Exception as e:
         logger.error(f"WBP Webhook: Erro inesperado no endpoint principal: {e}", exc_info=True)
         raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/official/webhook", summary="Verificar webhook da API Oficial (Meta)")
async def verify_official_webhook(request: Request):
    """
    Endpoint GET para a verificação inicial do webhook pela Meta.
    """
    verify_token = request.query_params.get('hub.verify_token')
    mode = request.query_params.get('hub.mode')
    challenge = request.query_params.get('hub.challenge')

    if not settings.WBP_VERIFY_TOKEN:
         logger.error("WBP Webhook Verify: WBP_VERIFY_TOKEN não configurado!")
         raise HTTPException(status_code=500, detail="Server configuration error")

    if mode == 'subscribe' and verify_token == settings.WBP_VERIFY_TOKEN:
         logger.info("WBP Webhook: Verificação GET bem-sucedida!")
         return Response(content=challenge, status_code=200, media_type="text/plain")
    else:
         logger.warning(f"WBP Webhook: Falha na verificação GET. Modo: {mode}, Token Recebido: '{verify_token}'")
         raise HTTPException(status_code=403, detail="Verification token mismatch")
