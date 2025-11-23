from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.db import models
import logging
from typing import Optional, List

logger = logging.getLogger(__name__)

async def get_user(db: AsyncSession, user_id: int) -> models.User | None:
    """Busca um utilizador pelo seu ID."""
    return await db.get(models.User, user_id)

async def get_user_by_email(db: AsyncSession, email: str) -> models.User | None:
    """Busca um utilizador pelo seu endereço de e-mail."""
    result = await db.execute(select(models.User).filter(models.User.email == email))
    return result.scalars().first()

async def get_user_by_wbp_phone_number_id(db: AsyncSession, phone_number_id: str) -> Optional[models.User]:
    """Busca um utilizador pelo ID do número de telefone da API Oficial."""
    if not phone_number_id:
        return None
    result = await db.execute(
        select(models.User).where(models.User.wbp_phone_number_id == phone_number_id)
    )
    return result.scalars().first()


async def decrement_user_tokens(db: AsyncSession, db_user: models.User, amount: int = 1):
    """Diminui os tokens de um utilizador pela quantidade especificada."""
    if db_user.tokens is not None and db_user.tokens >= amount:
        db_user.tokens -= amount
        logger.info(f"DEBUG: {amount} token(s) deduzido(s) do utilizador {db_user.id}. Restantes: {db_user.tokens}")
        db.add(db_user)
    else:
        logger.warning(f"Utilizador {db_user.id} não possui tokens suficientes para deduzir {amount} token(s).")
        
async def get_users_with_agent_running(db: AsyncSession) -> List[models.User]:
    """
    Busca todos os usuários no banco de dados que estão com o
    agente de IA ativado (agent_running == True).
    """
    # Isso assume que a coluna no seu models.User se chama 'agent_running'
    # Se o nome for diferente (como 'agent_runing'), ajuste abaixo.
    stmt = select(models.User).where(models.User.agent_running == True)
    result = await db.execute(stmt)
    users = result.scalars().all()
    return users
