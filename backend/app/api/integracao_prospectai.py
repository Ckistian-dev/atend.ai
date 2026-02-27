from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Dict, Any
import logging

from app.db.database import get_db
from app.db import models
from app.api.dependencies import get_current_active_user
from app.services.prospect_service import get_prospect_service

logger = logging.getLogger(__name__)
router = APIRouter()

@router.post("/send", summary="Enviar mensagem via ProspectAI")
async def send_prospect_message(
    payload: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user)
):
    """
    Endpoint para envio de mensagens (notificações) através da API do ProspectAI.
    Espera um JSON com 'remoteJid' (ID do destino) e 'text' (conteúdo da mensagem).
    """
    remote_jid = payload.get("remoteJid")
    text = payload.get("text")

    if not remote_jid or not text:
        raise HTTPException(
            status_code=400, 
            detail="Os campos 'remoteJid' e 'text' são obrigatórios no corpo da requisição."
        )

    service = get_prospect_service()
    try:
        # Chama o método send_notification do serviço ProspectService
        result = await service.send_notification(
            db=db,
            user=current_user,
            destination_jid=remote_jid,
            message=text
        )
        return result
    except Exception as e:
        logger.error(f"Erro na rota de envio ProspectAI: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro ao processar envio via ProspectAI: {str(e)}")