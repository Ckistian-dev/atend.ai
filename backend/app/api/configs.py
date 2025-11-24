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
from app.services.google_drive_service import get_drive_service

logger = logging.getLogger(__name__)
router = APIRouter()

SITUATIONS = [
    {"cor": "#144cd1", "nome": "Mensagem Recebida"},
    {"cor": "#f0ad60", "nome": "Atendente Chamado"},
    {"cor": "#e5da61", "nome": "Aguardando Resposta"},
    {"cor": "#5fd395", "nome": "Concluído"},
    {"cor": "#d569dd", "nome": "Gerando Resposta"},
    {"cor": "#837676", "nome": "Ignorar Contato"},
]

@router.post("/", response_model=Config, status_code=status.HTTP_201_CREATED, summary="Criar uma nova Configuração")
async def create_config(config: ConfigCreate, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_active_user)):
    new_config = await crud_config.create_config(db=db, config=config, user_id=current_user.id)
    await db.commit()
    await db.refresh(new_config)
    return new_config

@router.get("/", response_model=List[Config], summary="Listar todas as Configurações")
async def read_configs(db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_active_user)):
    return await crud_config.get_configs_by_user(db=db, user_id=current_user.id)

@router.put("/{config_id}", response_model=Config, summary="Atualizar uma Configuração")
async def update_config(config_id: int, config: ConfigUpdate, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_active_user)):
    db_config = await crud_config.get_config(db=db, config_id=config_id, user_id=current_user.id)
    if db_config is None:
        raise HTTPException(status_code=404, detail="Configuração não encontrada")
    updated = await crud_config.update_config(db=db, db_config=db_config, config_in=config)
    await db.commit()
    await db.refresh(updated)
    return updated

@router.delete("/{config_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Apagar uma Configuração")
async def delete_config(config_id: int, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_active_user)):
    if current_user.default_persona_id == config_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Não é possível apagar uma configuração que está definida como padrão.")
    deleted_config = await crud_config.delete_config(db=db, config_id=config_id, user_id=current_user.id)
    if deleted_config is None:
        raise HTTPException(status_code=404, detail="Configuração não encontrada")
    await db.commit()
    return

@router.post("/sync_sheet", summary="Sincronizar planilha do Google Sheets com uma Configuração")
async def sync_google_sheet(
    payload: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user)
):
    config_id = payload.get("config_id")
    spreadsheet_id = payload.get("spreadsheet_id") # Opcional

    if not config_id:
        raise HTTPException(status_code=400, detail="config_id é obrigatório.")

    db_config = await crud_config.get_config(db=db, config_id=config_id, user_id=current_user.id)
    if not db_config:
        raise HTTPException(status_code=404, detail="Configuração não encontrada.")
    
    # Se um novo spreadsheet_id foi enviado, atualiza a configuração primeiro
    if spreadsheet_id:
        db_config.spreadsheet_id = spreadsheet_id
        db.add(db_config)
        # O commit será feito junto com a atualização do contexto
    
    # Após a possível atualização, verifica se há um spreadsheet_id para usar
    final_spreadsheet_id = db_config.spreadsheet_id
    if not final_spreadsheet_id:
        raise HTTPException(status_code=400, detail="Nenhum link de planilha associado a esta configuração. Salve o link primeiro.")

    try:
        sheets_service = GoogleSheetsService()
        sheet_data_json = await sheets_service.get_sheet_as_json(final_spreadsheet_id)
        
        config_update = ConfigUpdate(contexto_json=sheet_data_json)
        updated_config = await crud_config.update_config(db=db, db_config=db_config, config_in=config_update)
        
        await db.commit()

        await db.refresh(updated_config)

        return {
            "message": "Planilha sincronizada com sucesso!", 
            "sheets_found": list(sheet_data_json.keys()),
            "contexto_json": updated_config.contexto_json
        }
    
    except Exception as e:
        logger.error(f"Falha na rota sync_sheet: {e}", exc_info=True)
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Falha ao sincronizar planilha: {str(e)}")

@router.post("/sync_drive", summary="Sincronizar pasta do Google Drive")
async def sync_google_drive(
    payload: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user)
):
    config_id = payload.get("config_id")
    folder_id = payload.get("drive_id")

    if not config_id:
        raise HTTPException(status_code=400, detail="config_id é obrigatório.")

    db_config = await crud_config.get_config(db=db, config_id=config_id, user_id=current_user.id)
    if not db_config:
        raise HTTPException(status_code=404, detail="Configuração não encontrada.")
    
    # Atualiza o ID da pasta se foi enviado
    if folder_id:
        db_config.drive_id = folder_id
        # Não faz commit ainda, espera o sync
    
    final_folder_id = db_config.drive_id
    if not final_folder_id:
        raise HTTPException(status_code=400, detail="Nenhum ID de pasta associado. Insira o ID da pasta do Google Drive.")

    try:
        drive_service = get_drive_service()
        # Chama o serviço (que pode ser síncrono, mas rodamos no endpoint async)
        # Se a lib do google for síncrona, o ideal é usar run_in_executor, mas para simplicidade aqui:
        drive_data = await drive_service.list_files_in_folder(final_folder_id)
        
        # O serviço retorna um dicionário com a estrutura da árvore e a contagem
        files_tree = drive_data.get("tree", {})
        files_count = drive_data.get("count", 0)

        # Agora o ConfigUpdate aceitará o campo arquivos_drive_json
        config_update = ConfigUpdate(arquivos_drive_json=files_tree)
        updated_config = await crud_config.update_config(db=db, db_config=db_config, config_in=config_update)
        
        await db.commit()
        await db.refresh(updated_config)

        return {
            "message": "Pasta do Drive sincronizada com sucesso!", 
            "files_count": files_count,
            "arquivos_drive_json": updated_config.arquivos_drive_json
        }
    
    except Exception as e:
        logger.error(f"Falha na rota sync_drive: {e}", exc_info=True)
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Falha ao sincronizar Drive: {str(e)}")

@router.get("/situations", response_model=List[Dict[str, str]], summary="Listar situações padrão")
async def get_situations():
    """
    Retorna a lista padrão de situações de atendimento.
    """
    return SITUATIONS