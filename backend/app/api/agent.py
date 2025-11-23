# app/api/agent.py

from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.dependencies import get_current_active_user, get_db
from app.db import models
router = APIRouter()

@router.post("/start", summary="Iniciar o agente de atendimento para o usuário logado")
async def start_agent(
    background_tasks: BackgroundTasks,
    current_user: models.User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    if current_user.agent_running:
        raise HTTPException(status_code=400, detail="O agente já está em execução.")

    current_user.agent_running = True
    db.add(current_user)
    await db.commit()

    return {"status": "success", "message": "Agente de atendimento iniciado em segundo plano."}

@router.post("/stop", summary="Parar o agente de atendimento para o usuário logado")
async def stop_agent(
    current_user: models.User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    current_user.agent_running = False
    db.add(current_user)
    await db.commit()
    return {"status": "success", "message": "Sinal de parada enviado ao agente."}

@router.get("/status", summary="Verificar o status do agente")
def get_agent_status(current_user: models.User = Depends(get_current_active_user)):
    # O status em memória (agent_status) reflete o estado real do processo.
    # O status no banco (current_user.agent_running) reflete o estado desejado.
    # Em condições normais, eles devem ser iguais. Usamos o do banco como fonte principal.
    return {"status": "running" if current_user.agent_running else "stopped"}