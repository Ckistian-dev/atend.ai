# app/crud/crud_config.py

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.db import models
from app.db.schemas import ConfigCreate, ConfigUpdate
from typing import List, Optional

async def get_config(db: AsyncSession, config_id: int, user_id: int) -> Optional[models.Config]:
    """Busca uma configuração específica de um utilizador pelo ID."""
    result = await db.execute(
        select(models.Config).filter(models.Config.id == config_id, models.Config.user_id == user_id)
    )
    return result.scalars().first()

async def get_configs_by_user(db: AsyncSession, user_id: int) -> List[models.Config]:
    """Lista todas as configurações de um utilizador."""
    result = await db.execute(
        select(models.Config)
        .filter(models.Config.user_id == user_id)
        .order_by(models.Config.nome_config)
    )
    return result.scalars().all()

async def create_config(db: AsyncSession, config: ConfigCreate, user_id: int) -> models.Config:
    """Cria uma nova configuração para um utilizador."""
    db_config = models.Config(**config.model_dump(), user_id=user_id)
    db.add(db_config)
    await db.commit()
    await db.refresh(db_config)
    return db_config

async def update_config(db: AsyncSession, db_config: models.Config, config_in: ConfigUpdate) -> models.Config:
    """Atualiza os dados de uma configuração."""
    update_data = config_in.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_config, key, value)
    db.add(db_config)
    return db_config

async def delete_config(db: AsyncSession, config_id: int, user_id: int) -> Optional[models.Config]:
    """Apaga uma configuração de um utilizador."""
    db_config = await get_config(db, config_id, user_id)
    if db_config:
        await db.delete(db_config)
        await db.commit()
    return db_config