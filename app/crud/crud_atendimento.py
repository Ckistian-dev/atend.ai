import logging
from sqlalchemy import select, func
from sqlalchemy.orm import joinedload
from sqlalchemy.ext.asyncio import AsyncSession
from app.db import models, schemas
from datetime import datetime, timedelta, timezone
from typing import List, Tuple, Optional, Dict, Any
from app.services import google_service

logger = logging.getLogger(__name__)

async def get_atendimento(db: AsyncSession, atendimento_id: int, user_id: int) -> Optional[models.Atendimento]:
    """Busca um atendimento específico pelo ID."""
    result = await db.execute(
        select(models.Atendimento)
        .where(models.Atendimento.id == atendimento_id, models.Atendimento.user_id == user_id)
        .options(joinedload(models.Atendimento.contact))
    )
    return result.scalars().first()

async def get_atendimentos_by_user(db: AsyncSession, user_id: int) -> List[models.Atendimento]:
    """Lista todos os atendimentos de um usuário."""
    result = await db.execute(
        select(models.Atendimento)
        .where(models.Atendimento.user_id == user_id)
        .options(joinedload(models.Atendimento.contact))
        .order_by(models.Atendimento.updated_at.desc())
    )
    return result.scalars().all()

async def update_atendimento(db: AsyncSession, db_atendimento: models.Atendimento, atendimento_in: schemas.AtendimentoUpdate) -> models.Atendimento:
    """Atualiza os dados de um atendimento. Não faz commit."""
    update_data = atendimento_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_atendimento, field, value)
    
    db_atendimento.updated_at = datetime.now(timezone.utc)
    db.add(db_atendimento)
    # O commit será feito pela rota da API que chamou esta função.
    return db_atendimento

async def get_or_create_atendimento_by_number(db: AsyncSession, number: str, user: models.User) -> Optional[Tuple[models.Atendimento, bool]]:
    """Busca ou cria um atendimento. Faz commit internamente pois é um fluxo complexo."""
    contact_query = await db.execute(
        select(models.Contact).where(models.Contact.whatsapp == number, models.Contact.user_id == user.id)
    )
    contact = contact_query.scalars().first()

    if contact:
        atendimento_query = await db.execute(
            select(models.Atendimento)
            .where(
                models.Atendimento.contact_id == contact.id,
                models.Atendimento.user_id == user.id,
                models.Atendimento.status.notin_(['Concluído', 'Ignorar Contato'])
            )
            .order_by(models.Atendimento.created_at.desc())
        )
        existing_atendimento = atendimento_query.scalars().first()
        if existing_atendimento:
            return await get_atendimento(db, existing_atendimento.id, user.id), False

    if not user.default_persona_id:
        logger.error(f"Usuário {user.id} não tem persona padrão. Não é possível criar novo atendimento.")
        return None

    if not contact:
        if user.google_refresh_token:
            logger.info(f"Novo contato ({number}). Tentando adicionar ao Google Agenda do usuário {user.id}...")
            try:
                g_service = await google_service.get_google_service_from_user(user)
                if g_service:
                    await google_service.create_google_contact(g_service, number, f"AtendAI {number}")
            except Exception as e:
                logger.error(f"Falha não fatal ao tentar criar contato no Google para {number}: {e}", exc_info=True)
        else:
            logger.info(f"Novo contato ({number}). Usuário {user.id} sem Google Agenda conectado.")

        contact = models.Contact(whatsapp=number, user_id=user.id)
        db.add(contact)
        await db.commit()
        await db.refresh(contact)

    new_atendimento = models.Atendimento(
        contact_id=contact.id, user_id=user.id,
        active_persona_id=user.default_persona_id, status="Novo Atendimento"
    )
    db.add(new_atendimento)
    await db.commit()
    await db.refresh(new_atendimento)
    logger.info(f"Novo atendimento criado (ID: {new_atendimento.id}) para o contato {contact.id}.")
    
    return await get_atendimento(db, new_atendimento.id, user.id), True

async def delete_atendimento(db: AsyncSession, atendimento_id: int, user_id: int) -> Optional[models.Atendimento]:
    """Busca e prepara um atendimento para exclusão. Não faz commit."""
    db_atendimento = await get_atendimento(db, atendimento_id=atendimento_id, user_id=user_id)
    if db_atendimento:
        await db.delete(db_atendimento)
    return db_atendimento

async def get_atendimentos_para_processar(db: AsyncSession, user_id: int) -> List[models.Atendimento]:
    """
    Busca atendimentos com status 'Mensagem Recebida'.
    """
    result = await db.execute(
        select(models.Atendimento)
        .where(
            models.Atendimento.user_id == user_id,
            models.Atendimento.status == "Mensagem Recebida",
        )
        .options(joinedload(models.Atendimento.contact), joinedload(models.Atendimento.active_persona))
        .order_by(models.Atendimento.updated_at.asc())
    )
    return result.scalars().all()


async def get_dashboard_data(db: AsyncSession, user_id: int) -> Dict[str, Any]:
    """Coleta dados para o novo dashboard de atendimentos."""
    status_counts_query = await db.execute(
        select(models.Atendimento.status, func.count(models.Atendimento.id))
        .where(models.Atendimento.user_id == user_id)
        .group_by(models.Atendimento.status)
    )
    status_counts = {status: count for status, count in status_counts_query.all()}
    
    finalizados_hoje_query = await db.execute(
        select(func.count(models.Atendimento.id))
        .where(
            models.Atendimento.user_id == user_id,
            models.Atendimento.status == 'Concluído',
            models.Atendimento.updated_at >= datetime.now(timezone.utc) - timedelta(days=1)
        )
    )
    finalizados_hoje = finalizados_hoje_query.scalar_one_or_none() or 0
    
    recent_activity_query = await db.execute(
        select(models.Atendimento)
        .where(models.Atendimento.user_id == user_id)
        .options(joinedload(models.Atendimento.contact))
        .order_by(models.Atendimento.updated_at.desc())
        .limit(20)
    )
    recent_activity = recent_activity_query.scalars().all()
    
    dashboard_data = {
        "stats": {
            "totalAtendimentos": sum(status_counts.values()),
            "ativos": status_counts.get("Aguardando Resposta", 0) + status_counts.get("Mensagem Recebida", 0),
            "finalizadosHoje": finalizados_hoje,
            "ignorados": status_counts.get("Ignorar Contato", 0)
        },
        "recentActivity": [
            {
                "id": a.id,
                "whatsapp": a.contact.whatsapp, 
                "situacao": a.status, 
                "observacao": a.observacoes,
                "active_persona_id": a.active_persona_id,
                "updated_at": a.updated_at.isoformat()
            } 
            for a in recent_activity
        ]
    }
    return dashboard_data

async def get_atendimentos_for_followup(db: AsyncSession, user: models.User) -> List[models.Atendimento]:
    """Busca atendimentos que precisam de follow-up com base no intervalo definido pelo utilizador."""
    if not user.followup_interval_minutes or user.followup_interval_minutes <= 0:
        return []
        
    time_limit = datetime.now(timezone.utc) - timedelta(minutes=user.followup_interval_minutes)
    
    result = await db.execute(
        select(models.Atendimento)
        .where(
            models.Atendimento.user_id == user.id,
            models.Atendimento.status == "Aguardando Resposta",
            models.Atendimento.updated_at < time_limit
        )
        .options(joinedload(models.Atendimento.contact), joinedload(models.Atendimento.active_persona))
    )
    return result.scalars().all()

