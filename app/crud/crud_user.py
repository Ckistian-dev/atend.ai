# app/crud/crud_user.py

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.db import models
from app.db.schemas import UserCreate, UserUpdate
from app.services.security import get_password_hash
import logging

logger = logging.getLogger(__name__)

async def get_user(db: AsyncSession, user_id: int) -> models.User | None:
    """Busca um utilizador pelo seu ID."""
    return await db.get(models.User, user_id)

async def get_user_by_email(db: AsyncSession, email: str) -> models.User | None:
    """Busca um utilizador pelo seu endereço de e-mail."""
    result = await db.execute(select(models.User).filter(models.User.email == email))
    return result.scalars().first()

async def get_user_by_instance(db: AsyncSession, instance_name: str) -> models.User | None:
    """Busca um utilizador pelo nome da sua instância do WhatsApp."""
    result = await db.execute(select(models.User).where(models.User.instance_name == instance_name))
    return result.scalars().first()

async def create_user(db: AsyncSession, user: UserCreate) -> models.User:
    """Cria um novo utilizador no banco de dados com senha hasheada."""
    hashed_password = get_password_hash(user.password)
    # A lógica para criar um utilizador foi simplificada, assumindo que não é criada pela API pública
    db_user = models.User(email=user.email, hashed_password=hashed_password)
    db.add(db_user)
    await db.commit()
    await db.refresh(db_user)
    return db_user

async def update_user(db: AsyncSession, db_user: models.User, user_in: UserUpdate) -> models.User:
    """Atualiza os dados de um utilizador existente."""
    update_data = user_in.model_dump(exclude_unset=True)
    
    for key, value in update_data.items():
        setattr(db_user, key, value)
    db.add(db_user)
    return db_user

async def decrement_user_tokens(db: AsyncSession, db_user: models.User, amount: int = 1):
    """Diminui os tokens de um utilizador pela quantidade especificada."""
    if db_user.tokens is not None and db_user.tokens >= amount:
        db_user.tokens -= amount
        await db.commit()
        await db.refresh(db_user)
        logger.info(f"DEBUG: {amount} token(s) deduzido(s) do utilizador {db_user.id}. Restantes: {db_user.tokens}")
    else:
        logger.warning(f"Utilizador {db_user.id} não possui tokens suficientes para deduzir {amount} token(s).")