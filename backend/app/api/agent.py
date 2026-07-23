# app/api/agent.py

# 1. Importações nativas/padrão do Python
import logging

# 2. Importações de terceiros
from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

# 3. Importações locais do projeto
from app.api.dependencies import get_current_active_user, get_db
from app.db import models
from app.services.agent_service import AgentService

logger = logging.getLogger(__name__)
router = APIRouter()


# Altera o estado do agente de atendimento da empresa para ativo, permitindo o processamento automático de mensagens
@router.post("/start", summary="Iniciar o agente de atendimento para o usuário logado")
async def start_agent(
    background_tasks: BackgroundTasks,
    current_user: models.User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Inicia o agente de atendimento associado à empresa do usuário autenticado.
    """
    try:
        await AgentService.start_agent(db=db, current_user=current_user)
        return {"status": "success", "message": "Agente de atendimento iniciado em segundo plano."}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Erro ao iniciar o agente: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Erro interno ao iniciar o agente.")


# Envia um sinal de parada desativando a flag de execução do agente de atendimento da empresa do usuário logado
@router.post("/stop", summary="Parar o agente de atendimento para o usuário logado")
async def stop_agent(
    current_user: models.User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Para o agente de atendimento associado à empresa do usuário autenticado.
    """
    try:
        await AgentService.stop_agent(db=db, current_user=current_user)
        return {"status": "success", "message": "Sinal de parada enviado ao agente."}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Erro ao parar o agente: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Erro interno ao parar o agente.")


# Retorna se o agente de atendimento da empresa do usuário logado está rodando (running) ou parado (stopped)
@router.get("/status", summary="Verificar o status do agente")
async def get_agent_status(current_user: models.User = Depends(get_current_active_user)):
    """
    Retorna o status atual do agente de atendimento.
    """
    status_str = AgentService.get_agent_status(current_user=current_user)
    return {"status": status_str}