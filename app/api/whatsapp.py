from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Dict, Any

from app.api import dependencies
from app.db.database import get_db
from app.db import models
from app.db.schemas import UserUpdate
from app.crud import crud_user
from app.services.whatsapp_service import WhatsAppService, get_whatsapp_service

router = APIRouter()

@router.get("/instance", summary="Obter o nome da instância do utilizador logado", response_model=Dict[str, str | None])
async def get_instance_name(
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    return {"instance_name": current_user.instance_name}

@router.post("/instance", summary="Guardar o nome da instância para o utilizador", response_model=Dict[str, Any])
async def set_instance_name(
    instance_name: str = Body(..., embed=True, description="O nome a ser guardado para a instância."),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    user_update_data = UserUpdate(instance_name=instance_name)
    await crud_user.update_user(db, db_user=current_user, user_in=user_update_data)
    return {"status": "success", "instance_name": instance_name}

@router.get("/status", summary="Verificar status da ligação com o WhatsApp")
async def get_status(
    current_user: models.User = Depends(dependencies.get_current_active_user),
    whatsapp_service: WhatsAppService = Depends(get_whatsapp_service),
):
    instance_name = current_user.instance_name
    if not instance_name:
        return {"status": "no_instance_name"}
    return await whatsapp_service.get_connection_status(instance_name)

@router.get("/connect", summary="Obter QR Code para conectar")
async def connect(
    current_user: models.User = Depends(dependencies.get_current_active_user),
    whatsapp_service: WhatsAppService = Depends(get_whatsapp_service),
):
    instance_name = current_user.instance_name
    if not instance_name:
        raise HTTPException(status_code=400, detail="Nome da instância não configurado. Guarde-o primeiro.")
    result = await whatsapp_service.create_and_connect_instance(instance_name)
    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result.get("detail"))
    return result

@router.post("/disconnect", summary="Desconectar do WhatsApp")
async def disconnect(
    current_user: models.User = Depends(dependencies.get_current_active_user),
    whatsapp_service: WhatsAppService = Depends(get_whatsapp_service),
):
    instance_name = current_user.instance_name
    if not instance_name:
        raise HTTPException(status_code=400, detail="Nome da instância não configurado.")
    result = await whatsapp_service.disconnect_instance(instance_name)
    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result.get("detail"))
    return result