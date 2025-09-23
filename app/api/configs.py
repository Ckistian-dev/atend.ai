# app/api/configs.py

from fastapi import APIRouter, Depends, HTTPException, status, Body
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Dict, Any
import logging

from app.db.database import get_db
from app.db import models
from app.db.schemas import Config, ConfigCreate, ConfigUpdate, UserUpdate
from app.crud import crud_config, crud_user
from app.api.dependencies import get_current_active_user
from app.services.google_sheets_service import GoogleSheetsService

logger = logging.getLogger(__name__)
router = APIRouter()

@router.post("/", response_model=Config, status_code=status.HTTP_201_CREATED, summary="Criar uma nova Persona")
async def create_config(config: ConfigCreate, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_active_user)):
    new_config = await crud_config.create_config(db=db, config=config, user_id=current_user.id)
    await db.commit()
    await db.refresh(new_config)
    return new_config

@router.get("/", response_model=List[Config], summary="Listar todas as Personas")
async def read_configs(db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_active_user)):
    return await crud_config.get_configs_by_user(db=db, user_id=current_user.id)

@router.put("/{config_id}", response_model=Config, summary="Atualizar uma Persona")
async def update_config(config_id: int, config: ConfigUpdate, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_active_user)):
    db_config = await crud_config.get_config(db=db, config_id=config_id, user_id=current_user.id)
    if db_config is None:
        raise HTTPException(status_code=404, detail="Configuração não encontrada")
    updated = await crud_config.update_config(db=db, db_config=db_config, config_in=config)
    await db.commit()
    await db.refresh(updated)
    return updated

@router.delete("/{config_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Apagar uma Persona")
async def delete_config(config_id: int, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_active_user)):
    if current_user.default_persona_id == config_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Não é possível apagar uma persona que está definida como padrão.")
    deleted_config = await crud_config.delete_config(db=db, config_id=config_id, user_id=current_user.id)
    if deleted_config is None:
        raise HTTPException(status_code=404, detail="Configuração não encontrada")
    await db.commit()
    return

@router.post("/sync_sheet", summary="Sincronizar planilha do Google Sheets com uma Persona/Contexto")
async def sync_google_sheet(
    payload: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user)
):
    config_id = payload.get("config_id")
    spreadsheet_id = payload.get("spreadsheet_id")

    if not config_id or not spreadsheet_id:
        raise HTTPException(status_code=400, detail="config_id e spreadsheet_id são obrigatórios.")

    db_config = await crud_config.get_config(db=db, config_id=config_id, user_id=current_user.id)
    if not db_config:
        raise HTTPException(status_code=404, detail="Configuração não encontrada.")

    try:
        sheets_service = GoogleSheetsService()
        sheet_data_json = await sheets_service.get_sheet_as_json(spreadsheet_id)
        
        config_update = ConfigUpdate(contexto_json=sheet_data_json)
        updated_config = await crud_config.update_config(db=db, db_config=db_config, config_in=config_update)
        
        user_update = UserUpdate(spreadsheet_id=spreadsheet_id)
        updated_user = await crud_user.update_user(db=db, db_user=current_user, user_in=user_update)

        await db.commit()

        await db.refresh(updated_config)
        await db.refresh(updated_user)

        return {"message": "Planilha sincronizada com sucesso!", "sheets_found": list(sheet_data_json.keys())}
    
    except Exception as e:
        logger.error(f"Falha na rota sync_sheet: {e}", exc_info=True)
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Falha ao sincronizar planilha: {str(e)}")