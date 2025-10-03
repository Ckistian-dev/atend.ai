# app/crud/crud_atendimento.py

import logging
from sqlalchemy import select, func
from sqlalchemy.orm import joinedload
from sqlalchemy.ext.asyncio import AsyncSession
from app.db import models, schemas
from datetime import datetime, timedelta, timezone
from typing import List, Tuple, Optional, Dict, Any

logger = logging.getLogger(__name__)

async def get_atendimento(db: AsyncSession, atendimento_id: int, user_id: int) -> Optional[models.Atendimento]:
    """Busca um atendimento específico pelo ID."""
    result = await db.execute(
        select(models.Atendimento)
        .where(models.Atendimento.id == atendimento_id, models.Atendimento.user_id == user_id)
        .options(joinedload(models.Atendimento.contact)) # Carrega os dados do contato junto
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
    """Atualiza os dados de um atendimento."""
    update_data = atendimento_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_atendimento, field, value)
    await db.commit()
    await db.refresh(db_atendimento)
    return db_atendimento

async def get_or_create_atendimento_by_number(db: AsyncSession, number: str, user: models.User) -> Optional[Tuple[models.Atendimento, bool]]:
    """
    Busca um atendimento ativo. Se não encontrar, cria um novo.
    Retorna o atendimento e um booleano 'was_created'.
    """
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
                models.Atendimento.status.notin_(['Concluído', 'Ignorar Contato', 'Vendedor Chamado'])
            )
        )
        existing_atendimento = atendimento_query.scalars().first()
        if existing_atendimento:
            logger.info(f"Atendimento ativo encontrado para {number}.")
            atendimento_completo = await get_atendimento(db, existing_atendimento.id, user.id)
            return atendimento_completo, False  # Retorna False porque não foi criado agora

    if not user.default_persona_id:
        logger.error(f"Utilizador {user.id} não tem persona padrão configurada.")
        return None

    if not contact:
        contact = models.Contact(whatsapp=number, user_id=user.id)
        db.add(contact)
        await db.commit()
        await db.refresh(contact)

    new_atendimento = models.Atendimento(
        contact_id=contact.id,
        user_id=user.id,
        active_persona_id=user.default_persona_id,
        status="Aguardando Resposta" # Começa como aguardando, será atualizado no webhook
    )
    db.add(new_atendimento)
    await db.commit()
    await db.refresh(new_atendimento)
    logger.info(f"Novo atendimento criado (ID: {new_atendimento.id}) para o contato {contact.id}.")
    
    atendimento_completo = await get_atendimento(db, new_atendimento.id, user.id)
    return atendimento_completo, True # Retorna True porque foi criado agora

async def get_atendimentos_for_processing(db: AsyncSession, user_id: int) -> List[models.Atendimento]:
    """Busca atendimentos que precisam de uma ação da IA (resposta ou follow-up)."""
    # Lógica de Follow-up (exemplo: se passaram 24h desde a última atualização)
    # follow_up_time_limit = datetime.now(timezone.utc) - timedelta(hours=24)
    
    result = await db.execute(
        select(models.Atendimento)
        .where(
            models.Atendimento.user_id == user_id,
            models.Atendimento.status.in_(['Resposta Recebida']) #, 'Aguardando Follow-up'])
        )
        .options(joinedload(models.Atendimento.contact), joinedload(models.Atendimento.active_persona))
    )
    return result.scalars().all()

async def get_dashboard_data(db: AsyncSession, user_id: int) -> Dict[str, Any]:
    """Coleta dados para o novo dashboard de atendimentos."""
    # ... (a lógica das stats no topo da função permanece a mesma) ...
    status_counts_query = await db.execute(
        select(models.Atendimento.status, func.count(models.Atendimento.id))
        .where(models.Atendimento.user_id == user_id)
        .group_by(models.Atendimento.status)
    )
    status_counts = {status: count for status, count in status_counts_query.all()}
    recent_atendimentos_query = await db.execute(
        select(func.count(models.Atendimento.id))
        .where(
            models.Atendimento.user_id == user_id,
            models.Atendimento.created_at >= datetime.now(timezone.utc) - timedelta(days=1)
        )
    )
    recent_atendimentos = recent_atendimentos_query.scalar_one_or_none() or 0
    
    # Atividade recente para o log do dashboard
    recent_activity_query = await db.execute(
        select(models.Atendimento)
        .where(models.Atendimento.user_id == user_id)
        .options(joinedload(models.Atendimento.contact))
        .order_by(models.Atendimento.updated_at.desc())
    )
    recent_activity = recent_activity_query.scalars().all()
    
    dashboard_data = {
        "stats": {
            "totalAtendimentos": sum(status_counts.values()),
            "ativos": status_counts.get("Aguardando Resposta", 0) + status_counts.get("Resposta Recebida", 0),
            "finalizadosHoje": recent_atendimentos,
            "ignorados": status_counts.get("Ignorar Contato", 0)
        },
        "recentActivity": [
            {
                "whatsapp": a.contact.whatsapp, 
                "situacao": a.status, 
                "observacao": a.observacoes,
                "active_persona_id": a.active_persona_id # <-- NOVO
            } 
            for a in recent_activity
        ]
    }
    return dashboard_data

async def delete_atendimento(db: AsyncSession, atendimento_id: int, user_id: int) -> Optional[models.Atendimento]:
    """Apaga um atendimento específico de um utilizador."""
    db_atendimento = await get_atendimento(db, atendimento_id=atendimento_id, user_id=user_id)
    if db_atendimento:
        await db.delete(db_atendimento)
        # O commit será feito na rota da API para garantir a transação.
    return db_atendimento

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