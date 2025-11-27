import logging
from fastapi import APIRouter, Depends, Body, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Any, Dict, List
from datetime import datetime, timedelta

from app.api import dependencies
from app.db.database import get_db
from app.db import models
from app.crud import crud_atendimento, crud_config
from app.services.gemini_service import get_gemini_service

logger = logging.getLogger(__name__)
router = APIRouter()

@router.get("/", response_model=Dict[str, Any], summary="Obter dados agregados para o dashboard")
async def get_dashboard_data(
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user),
    start_date_str: str = None,
    end_date_str: str = None
):
    """
    Endpoint que coleta, formata e retorna todas as métricas
    necessárias para popular o dashboard do frontend.
    """
    start_date = datetime.fromisoformat(start_date_str) if start_date_str else datetime.now() - timedelta(days=30)
    end_date = datetime.fromisoformat(end_date_str) if end_date_str else datetime.now()

    dashboard_data = await crud_atendimento.get_dashboard_data(db, user_id=current_user.id, start_date=start_date, end_date=end_date)
    return dashboard_data

@router.post("/analyze", summary="Analisar dados com IA")
async def analyze_data_with_ia(
    payload: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user),
    gemini_service = Depends(get_gemini_service)
):
    question = payload.get("question")
    contexts = payload.get("contexts", [])
    start_date_str = payload.get("start_date_str")
    end_date_str = payload.get("end_date_str")

    if not question:
        raise HTTPException(status_code=400, detail="A pergunta é obrigatória.")

    start_date = datetime.fromisoformat(start_date_str) if start_date_str else None
    end_date = datetime.fromisoformat(end_date_str) if end_date_str else None

    atendimentos_data = []
    if 'atendimentos' in contexts and start_date and end_date:
        atendimentos_data = await crud_atendimento.get_atendimentos_no_periodo(db, user_id=current_user.id, start_date=start_date, end_date=end_date)

    persona_data = None
    if 'persona' in contexts and current_user.default_persona_id:
        persona_data = await crud_config.get_config(db, config_id=current_user.default_persona_id, user_id=current_user.id)

    analysis = await gemini_service.analyze_data(
        question=question,
        user=current_user,
        atendimentos=atendimentos_data,
        persona=persona_data,
        db=db
    )

    return {"analysis": analysis}