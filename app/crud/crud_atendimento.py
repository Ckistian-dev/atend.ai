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
    
    # Garante que o campo updated_at seja atualizado automaticamente
    db_atendimento.updated_at = datetime.now(timezone.utc)
    
    await db.commit()
    await db.refresh(db_atendimento)
    return db_atendimento

async def get_or_create_atendimento_by_number(db: AsyncSession, number: str, user: models.User) -> Optional[Tuple[models.Atendimento, bool]]:
    """
    Busca um atendimento que não esteja permanentemente fechado. Se não encontrar, cria um novo.
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
                # --- CORREÇÃO AQUI ---
                # Removemos 'Atendente Chamado' da lista. Agora a busca encontrará
                # atendimentos em qualquer estado que não seja finalizado.
                # A decisão de ignorar a mensagem será tomada no webhook.
                models.Atendimento.status.notin_(['Concluído', 'Ignorar Contato'])
            )
            .order_by(models.Atendimento.created_at.desc()) # Pega o mais recente se houver múltiplos
        )
        existing_atendimento = atendimento_query.scalars().first()
        if existing_atendimento:
            logger.info(f"Atendimento ativo/pausado (ID: {existing_atendimento.id}) encontrado para {number}.")
            atendimento_completo = await get_atendimento(db, existing_atendimento.id, user.id)
            return atendimento_completo, False  # Retorna False porque não foi criado agora

    if not user.default_persona_id:
        logger.error(f"Utilizador {user.id} não tem persona padrão configurada. Não é possível criar novo atendimento.")
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
        status="Novo Atendimento" # Status inicial, será atualizado pelo webhook para "Mensagem Recebida"
    )
    db.add(new_atendimento)
    await db.commit()
    await db.refresh(new_atendimento)
    logger.info(f"Nenhum atendimento ativo encontrado. Novo atendimento criado (ID: {new_atendimento.id}) para o contato {contact.id}.")
    
    atendimento_completo = await get_atendimento(db, new_atendimento.id, user.id)
    return atendimento_completo, True # Retorna True porque foi criado agora

async def get_atendimentos_para_processar(db: AsyncSession, user_id: int) -> List[models.Atendimento]:
    """
    Busca atendimentos com status 'Mensagem Recebida' que não foram atualizados nos últimos 30 segundos.
    """
    cooldown_limit = datetime.now(timezone.utc) - timedelta(seconds=30)
    
    result = await db.execute(
        select(models.Atendimento)
        .where(
            models.Atendimento.user_id == user_id,
            models.Atendimento.status == "Mensagem Recebida",
            models.Atendimento.updated_at < cooldown_limit
        )
        .options(joinedload(models.Atendimento.contact), joinedload(models.Atendimento.active_persona))
        .order_by(models.Atendimento.updated_at.asc()) # Processa os mais antigos primeiro
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
    
    # Contagem de atendimentos finalizados (status 'Concluído') nas últimas 24h
    finalizados_hoje_query = await db.execute(
        select(func.count(models.Atendimento.id))
        .where(
            models.Atendimento.user_id == user_id,
            models.Atendimento.status == 'Concluído',
            models.Atendimento.updated_at >= datetime.now(timezone.utc) - timedelta(days=1)
        )
    )
    finalizados_hoje = finalizados_hoje_query.scalar_one_or_none() or 0
    
    # Atividade recente para o log do dashboard
    recent_activity_query = await db.execute(
        select(models.Atendimento)
        .where(models.Atendimento.user_id == user_id)
        .options(joinedload(models.Atendimento.contact))
        .order_by(models.Atendimento.updated_at.desc())
        .limit(20) # Limita a 20 para performance
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
                "id": a.id, # Adicionado ID para linkar na interface
                "whatsapp": a.contact.whatsapp, 
                "situacao": a.status, 
                "observacao": a.observacoes,
                "active_persona_id": a.active_persona_id,
                "updated_at": a.updated_at.isoformat() # Adicionado para exibir data/hora
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
        await db.commit()
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