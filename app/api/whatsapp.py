import logging
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
logger = logging.getLogger(__name__)

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

@router.get("/connect", summary="Obter QR Code para conectar e salvar Instance ID")
async def connect(
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user),
    whatsapp_service: WhatsAppService = Depends(get_whatsapp_service),
):
    """Gera um QR Code, conecta a instância e guarda o UUID da instância no banco de dados do utilizador."""
    logger.info(f"Iniciando processo de conexão para o utilizador: {current_user.email}")
    instance_name = current_user.instance_name
    if not instance_name:
        logger.error(f"Tentativa de conexão falhou para {current_user.email}: Nome da instância não configurado.")
        raise HTTPException(status_code=400, detail="Nome da instância não configurado. Guarde-o primeiro.")
    
    logger.info(f"Chamando create_and_connect_instance para a instância '{instance_name}'...")
    result = await whatsapp_service.create_and_connect_instance(instance_name)
    logger.debug(f"Resultado da API da Evolution: {result}")
    
    if result.get("status") == "error":
        logger.error(f"Erro da API da Evolution para a instância '{instance_name}': {result.get('detail')}")
        raise HTTPException(status_code=500, detail=result.get("detail"))

    # Lógica para salvar o ID da instância no usuário
    instance_data = result.get("instance")
    if result.get("status") == "qrcode" and instance_data:
        logger.debug(f"Dados da instância recebidos: {instance_data}")
        # A API pode retornar 'id' ou 'instanceId'
        instance_id = instance_data.get("id") or instance_data.get("instanceId")
        logger.info(f"Instance ID extraído: '{instance_id}'")

        if instance_id and instance_id != current_user.instance_id:
            logger.info(f"Atualizando instance_id de '{current_user.instance_id}' para '{instance_id}' para o utilizador {current_user.id}")
            try:
                user_update = UserUpdate(instance_id=instance_id)
                await crud_user.update_user(db, db_user=current_user, user_in=user_update)
                await db.commit() # Garante que a transação seja salva no banco de dados.
                await db.refresh(current_user) # Atualiza o objeto current_user com os novos dados.
                logger.info(f"Instance ID '{instance_id}' salvo com sucesso para o utilizador {current_user.id}.")
            except Exception as e:
                await db.rollback()
                logger.error(f"ERRO AO SALVAR instance_id no banco de dados para o utilizador {current_user.id}: {e}", exc_info=True)
        elif not instance_id:
            logger.warning(f"Não foi possível encontrar 'id' ou 'instanceId' nos dados da instância para '{instance_name}'.")
        else:
            logger.info(f"O instance_id '{instance_id}' já está atualizado para o utilizador {current_user.id}.")
    else:
        logger.warning(f"Não foi possível obter dados da instância ou o status não é 'qrcode'. Status: {result.get('status')}")

    return result

@router.post("/disconnect", summary="Desconectar do WhatsApp")
async def disconnect(
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user),
    whatsapp_service: WhatsAppService = Depends(get_whatsapp_service),
):
    """Desconecta a instância do WhatsApp do utilizador e limpa o instance_id."""
    instance_name = current_user.instance_name
    if not instance_name:
        raise HTTPException(status_code=400, detail="Nome da instância não configurado.")
    
    result = await whatsapp_service.disconnect_instance(instance_name)
    
    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result.get("detail"))

    if current_user.instance_id:
        logger.info(f"Limpando instance_id para o utilizador {current_user.id}")
        user_update = UserUpdate(instance_id=None)
        await crud_user.update_user(db, db_user=current_user, user_in=user_update)
        await db.commit() # Garante que a remoção seja salva.
        await db.refresh(current_user)

    return result

