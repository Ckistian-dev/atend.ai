from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func
from sqlalchemy.orm import joinedload
from app.db import models
import logging
from typing import Optional, List
from datetime import datetime

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


async def decrement_user_tokens(db: AsyncSession, db_user: models.User, usage: int, atendimento_id: Optional[int] = None):
    """Deduz os tokens usados pelo usuário do seu saldo e atualiza o atendimento."""
    if db_user.tokens is None:
        db_user.tokens = 0
    
    db_user.tokens -= usage
    
    if atendimento_id:
        stmt = select(models.Atendimento).where(models.Atendimento.id == atendimento_id)
        result = await db.execute(stmt)
        atendimento = result.scalars().first()
        if atendimento:
            if atendimento.token_usage is None:
                atendimento.token_usage = 0
            atendimento.token_usage += usage
            db.add(atendimento)
    
    logger.info(f"DEBUG: {usage} token(s) deduzido(s) do utilizador {db_user.id}. Restantes: {db_user.tokens}")
    db.add(db_user)
        
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

async def get_users_with_followup_active(db: AsyncSession) -> List[models.User]:
    """
    Busca todos os usuários com o sistema de follow-up ativo.
    """
    stmt = (
        select(models.User)
        .where(models.User.followup_active == True)
        .options(joinedload(models.User.default_persona)) # Eager load a persona padrão
    )
    result = await db.execute(stmt)
    return result.scalars().unique().all()

async def get_token_usage_in_period(db: AsyncSession, user_id: int, start_date: datetime, end_date: datetime) -> int:
    """Retorna o total de tokens consumidos em um período para cálculos de média."""
    stmt = select(func.sum(models.Atendimento.token_usage)).where(
        models.Atendimento.user_id == user_id,
        models.Atendimento.created_at >= start_date,
        models.Atendimento.created_at <= end_date
    )
    result = await db.execute(stmt)
    return result.scalar() or 0
