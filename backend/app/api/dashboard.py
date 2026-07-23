# app/api/dashboard.py

# 1. Importações nativas/padrão do Python
import logging
from typing import Any, Dict

# 2. Importações de terceiros
from fastapi import APIRouter, Depends, Body, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

# 3. Importações locais do projeto
from app.api import dependencies
from app.db.database import get_db
from app.db import models
from app.services.gemini_service import GeminiService, get_gemini_service
from app.services.dashboard_service import DashboardService

logger = logging.getLogger(__name__)
router = APIRouter()


# Retorna dados quantitativos e consolidados de atendimentos para renderizar nos painéis gráficos do dashboard
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
    try:
        return await DashboardService.get_dashboard_data(
            db=db,
            current_user=current_user,
            start_date_str=start_date_str,
            end_date_str=end_date_str
        )
    except Exception as e:
        logger.error(f"Erro ao buscar dados do dashboard: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Erro interno ao processar dados do dashboard.")


# Envia métricas e atendimentos de um período para o Gemini analisar de forma qualitativa e responder a uma pergunta do usuário
@router.post("/analyze", summary="Analisar dados com IA")
async def analyze_data_with_ia(
    payload: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user),
    gemini_service: GeminiService = Depends(get_gemini_service)
):
    """
    Endpoint que extrai os atendimentos do período e solicita à IA do Gemini uma
    análise estruturada baseada na pergunta/comando informada pelo cliente.
    """
    question = payload.get("question")
    model_name = payload.get("model")
    start_date_str = payload.get("start_date_str")
    end_date_str = payload.get("end_date_str")

    try:
        return await DashboardService.analyze_data_with_ia(
            db=db,
            current_user=current_user,
            question=question,
            model_name=model_name,
            start_date_str=start_date_str,
            end_date_str=end_date_str,
            gemini_service=gemini_service
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Erro ao analisar dados com IA no dashboard: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))