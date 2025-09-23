# app/api/agent.py

from fastapi import APIRouter, Depends, BackgroundTasks
from app.api.dependencies import get_current_active_user
from app.db import models
from app.agent_manager import start_agent_for_user, stop_agent_for_user, agent_status

router = APIRouter()

@router.post("/start", summary="Iniciar o agente de atendimento para o usuário logado")
def start_agent(
    background_tasks: BackgroundTasks,
    current_user: models.User = Depends(get_current_active_user)
):
    start_agent_for_user(current_user.id, background_tasks)
    return {"status": "success", "message": "Agente de atendimento iniciado em segundo plano."}

@router.post("/stop", summary="Parar o agente de atendimento para o usuário logado")
def stop_agent(current_user: models.User = Depends(get_current_active_user)):
    stop_agent_for_user(current_user.id)
    return {"status": "success", "message": "Sinal de parada enviado ao agente."}

@router.get("/status", summary="Verificar o status do agente")
def get_agent_status(current_user: models.User = Depends(get_current_active_user)):
    is_running = agent_status.get(current_user.id, False)
    return {"status": "running" if is_running else "stopped"}