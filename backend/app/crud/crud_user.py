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
    result = await db.execute(
        select(models.User)
        .filter(models.User.email == email)
        .options(joinedload(models.User.company))
    )
    return result.scalars().first()

async def get_users(db: AsyncSession, skip: int = 0, limit: int = 100) -> List[models.User]:
    """Busca todos os utilizadores com paginação, ordenados por ID."""
    result = await db.execute(
        select(models.User)
        .order_by(models.User.id)
        .offset(skip)
        .limit(limit)
        .options(joinedload(models.User.company))
    )
    users = result.scalars().all()
    return users

async def get_company(db: AsyncSession, company_id: int) -> models.Company | None:
    """Busca uma empresa pelo seu ID."""
    return await db.get(models.Company, company_id)

async def get_company_by_wbp_phone_number_id(db: AsyncSession, phone_number_id: str) -> Optional[models.Company]:
    """Busca uma empresa pelo ID do número de telefone da API Oficial."""
    if not phone_number_id:
        return None
    result = await db.execute(
        select(models.Company).where(models.Company.wbp_phone_number_id == phone_number_id)
    )
    return result.scalars().first()

async def decrement_company_tokens(
    db: AsyncSession,
    db_company: models.Company,
    usage: int,
    atendimento_id: Optional[int] = None,
    token_type: str = "inference"
):
    """Deduz os tokens usados pela empresa do seu saldo e atualiza o atendimento."""
    if db_company.tokens is None:
        db_company.tokens = 0
    
    db_company.tokens -= usage
    
    if atendimento_id:
        stmt = select(models.Atendimento).where(models.Atendimento.id == atendimento_id)
        result = await db.execute(stmt)
        atendimento = result.scalars().first()
        if atendimento:
            if atendimento.token_usage is None:
                atendimento.token_usage = 0
            atendimento.token_usage += usage
            db.add(atendimento)
    
    logger.info(
        f"DEDUÇÃO DE TOKENS: Tipo='{token_type}', Consumo={usage} tokens, "
        f"Empresa={db_company.id} ({db_company.name}), "
        f"Saldo Anterior={db_company.tokens + usage}, Saldo Atual={db_company.tokens}"
    )
    db.add(db_company)
        
async def get_companies_with_agent_running(db: AsyncSession) -> List[models.Company]:
    """
    Busca todas as empresas no banco de dados que estão com o
    agente de IA ativado (agent_running == True).
    """
    stmt = select(models.Company).where(models.Company.agent_running == True)
    result = await db.execute(stmt)
    companies = result.scalars().all()
    return companies

async def get_companies_with_followup_active(db: AsyncSession) -> List[models.Company]:
    """
    Busca todas as empresas com o sistema de follow-up ativo.
    """
    stmt = (
        select(models.Company)
        .where(models.Company.followup_active == True)
        .options(joinedload(models.Company.default_persona)) # Eager load a persona padrão
    )
    result = await db.execute(stmt)
    return result.scalars().unique().all()

async def get_token_usage_in_period(db: AsyncSession, company_id: int, start_date: datetime, end_date: datetime) -> int:
    """Retorna o total de tokens consumidos em um período para cálculos de média por empresa."""
    stmt = select(func.sum(models.Atendimento.token_usage)).where(
        models.Atendimento.company_id == company_id,
        models.Atendimento.created_at >= start_date,
        models.Atendimento.created_at <= end_date
    )
    result = await db.execute(stmt)
    return result.scalar() or 0
