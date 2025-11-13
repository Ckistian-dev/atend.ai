import logging
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Any, Dict

from app.api import dependencies
from app.db.database import get_db
from app.db import models
from app.crud import crud_atendimento # ATUALIZADO para usar o novo CRUD

logger = logging.getLogger(__name__)
router = APIRouter()

@router.get("/", response_model=Dict[str, Any], summary="Obter dados agregados para o dashboard")
async def get_dashboard_data(
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Endpoint que coleta, formata e retorna todas as métricas
    necessárias para popular o dashboard do frontend.
    """
    dashboard_data = await crud_atendimento.get_dashboard_data(db, user_id=current_user.id)
    return dashboard_data