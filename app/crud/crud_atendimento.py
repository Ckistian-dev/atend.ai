import logging
from sqlalchemy import select, func, or_ # Import 'or_'
from sqlalchemy.orm import joinedload
from sqlalchemy.ext.asyncio import AsyncSession
from app.db import models, schemas
from datetime import datetime, timedelta, timezone # Import timezone
from typing import List, Tuple, Optional, Dict, Any
from app.services import google_service, security # Import security for decrypt
import json # Import json

logger = logging.getLogger(__name__)

async def get_atendimento(db: AsyncSession, atendimento_id: int, user_id: int) -> Optional[models.Atendimento]:
    """Busca um atendimento específico pelo ID, carregando relacionamentos."""
    result = await db.execute(
        select(models.Atendimento)
        .where(models.Atendimento.id == atendimento_id, models.Atendimento.user_id == user_id)
        .options(
            joinedload(models.Atendimento.contact),
            joinedload(models.Atendimento.active_persona) # Carrega a persona ativa também
        )
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
    needs_refresh = False
    for field, value in update_data.items():
        # --- NOVO: Lógica para adicionar mensagem à conversa ---
        if field == 'conversa' and isinstance(value, dict) and 'add_message' in value:
            try:
                current_conversa_str = db_atendimento.conversa or "[]"
                current_conversa_list = json.loads(current_conversa_str)
                new_message = value['add_message'] # Espera um dict de mensagem formatado
                # Garante que a nova mensagem tenha timestamp para ordenação
                if 'timestamp' not in new_message:
                     new_message['timestamp'] = datetime.now(timezone.utc).isoformat()
                current_conversa_list.append(new_message)
                # Ordena por timestamp antes de salvar
                current_conversa_list.sort(key=lambda x: x.get('timestamp') or '1970-01-01T00:00:00+00:00')
                setattr(db_atendimento, 'conversa', json.dumps(current_conversa_list, ensure_ascii=False))
                needs_refresh = True # Precisa recarregar para ver a conversa atualizada
            except (json.JSONDecodeError, TypeError) as e:
                logger.error(f"Erro ao adicionar mensagem à conversa (Atendimento ID {db_atendimento.id}): {e}. Conversa atual: {db_atendimento.conversa}")
                # Opcional: definir um estado de erro ou logar mais detalhes
        # ---------------------------------------------------
        else:
            setattr(db_atendimento, field, value)

    db_atendimento.updated_at = datetime.now(timezone.utc)
    db.add(db_atendimento)
    # O commit será feito pela rota/serviço que chamou esta função.
    # Se precisar do objeto atualizado imediatamente após esta chamada (antes do commit),
    # pode ser necessário fazer flush e refresh, mas geralmente não é o caso aqui.
    # await db.flush()
    # await db.refresh(db_atendimento)
    return db_atendimento


async def add_message_to_conversa(
    db: AsyncSession,
    atendimento_id: int,
    user_id: int,
    message: schemas.FormattedMessage # Usando o schema definido
) -> Optional[models.Atendimento]:
    """Adiciona uma mensagem formatada à conversa de um atendimento existente."""
    db_atendimento = await get_atendimento(db, atendimento_id=atendimento_id, user_id=user_id)
    if not db_atendimento:
        logger.warning(f"Tentativa de adicionar mensagem a atendimento inexistente ou não pertencente ao user: ID {atendimento_id}, User {user_id}")
        return None

    try:
        current_conversa_str = db_atendimento.conversa or "[]"
        current_conversa_list = json.loads(current_conversa_str)

        # Garante timestamp se não existir
        if not message.timestamp:
            message.timestamp = datetime.now(timezone.utc).isoformat()

        current_conversa_list.append(message.model_dump()) # Adiciona o dict da mensagem

        # Ordena pelo timestamp antes de salvar
        current_conversa_list.sort(key=lambda x: x.get('timestamp') or '1970-01-01T00:00:00+00:00')

        db_atendimento.conversa = json.dumps(current_conversa_list, ensure_ascii=False)
        db_atendimento.updated_at = datetime.now(timezone.utc) # Atualiza timestamp do atendimento
        db.add(db_atendimento)
        await db.commit() # Salva a adição da mensagem
        await db.refresh(db_atendimento) # Recarrega para obter estado atualizado
        logger.info(f"Mensagem ID {message.id} adicionada à conversa do Atendimento ID {atendimento_id}.")
        return db_atendimento

    except (json.JSONDecodeError, TypeError) as e:
        logger.error(f"Erro ao adicionar mensagem (ID: {message.id}) à conversa (Atendimento ID {atendimento_id}): {e}. Conversa atual: {db_atendimento.conversa}")
        await db.rollback()
        return None
    except Exception as e:
        logger.error(f"Erro inesperado ao adicionar mensagem (ID: {message.id}) ao atendimento {atendimento_id}: {e}", exc_info=True)
        await db.rollback()
        return None


async def get_or_create_atendimento_by_number(db: AsyncSession, number: str, user: models.User) -> Optional[Tuple[models.Atendimento, bool]]:
    """Busca ou cria um atendimento. Faz commit internamente."""
    # 1. Buscar/Criar Contato
    contact_query = await db.execute(
        select(models.Contact).where(models.Contact.whatsapp == number, models.Contact.user_id == user.id)
    )
    contact = contact_query.scalars().first()

    if not contact:
        logger.info(f"Contato {number} não encontrado para user {user.id}. Criando novo contato.")
        # Lógica Google Contacts (mantida, mas não bloqueante)
        if user.google_refresh_token:
            logger.info(f"Tentando adicionar novo contato ({number}) ao Google Agenda do usuário {user.id}...")
            try:
                g_service = await google_service.get_google_service_from_user(user)
                if g_service:
                    await google_service.create_google_contact(g_service, number, f"AtendAI {number}")
            except Exception as e:
                logger.error(f"Falha não fatal ao tentar criar contato no Google para {number}: {e}", exc_info=False) # Não mostra stacktrace completo
        else:
            logger.info(f"Novo contato ({number}). Usuário {user.id} sem Google Agenda conectado.")

        # Cria o contato no banco de dados do AtendAI
        contact = models.Contact(whatsapp=number, user_id=user.id)
        db.add(contact)
        try:
            await db.commit()
            await db.refresh(contact)
            logger.info(f"Novo contato (ID: {contact.id}) criado para {number}.")
        except Exception as e: # Captura erro de constraint (ex: número duplicado por race condition)
            await db.rollback()
            logger.error(f"Erro ao criar contato {number}: {e}. Tentando buscar novamente.")
            # Tenta buscar novamente caso outro processo tenha criado o contato enquanto tentávamos commitar
            contact_query = await db.execute(select(models.Contact).where(models.Contact.whatsapp == number, models.Contact.user_id == user.id))
            contact = contact_query.scalars().first()
            if not contact:
                 logger.error(f"Falha CRÍTICA: Não foi possível criar ou encontrar o contato {number} após erro.")
                 return None # Não conseguiu criar nem encontrar

    # 2. Buscar Atendimento Ativo
    atendimento_query = await db.execute(
        select(models.Atendimento)
        .where(
            models.Atendimento.contact_id == contact.id,
            models.Atendimento.user_id == user.id,
            models.Atendimento.status.notin_(['Concluído', 'Ignorar Contato'])
        )
        .order_by(models.Atendimento.created_at.desc())
        .options(joinedload(models.Atendimento.contact), joinedload(models.Atendimento.active_persona)) # Carrega relacionamentos
    )
    existing_atendimento = atendimento_query.scalars().first()

    if existing_atendimento:
        logger.debug(f"Atendimento ativo (ID: {existing_atendimento.id}, Status: {existing_atendimento.status}) encontrado para {number}.")
        return existing_atendimento, False # Retorna o existente e False (não foi criado)

    # 3. Criar Novo Atendimento (se nenhum ativo foi encontrado)
    if not user.default_persona_id:
        logger.error(f"Usuário {user.id} não tem persona padrão configurada. Não é possível criar novo atendimento para {number}.")
        return None # Retorna None se não puder criar

    logger.info(f"Nenhum atendimento ativo encontrado para {number}. Criando novo atendimento...")
    new_atendimento = models.Atendimento(
        contact_id=contact.id, user_id=user.id,
        active_persona_id=user.default_persona_id, status="Novo Atendimento" # Status inicial
    )
    db.add(new_atendimento)
    try:
        await db.commit()
        await db.refresh(new_atendimento)
        logger.info(f"Novo atendimento criado (ID: {new_atendimento.id}) para o contato {contact.id} ({number}).")
        # Recarrega com relacionamentos após criar
        return await get_atendimento(db, new_atendimento.id, user.id), True # Retorna o novo e True (foi criado)
    except Exception as e:
        await db.rollback()
        logger.error(f"Erro ao criar novo atendimento para {number}: {e}", exc_info=True)
        return None # Falha ao criar


async def delete_atendimento(db: AsyncSession, atendimento_id: int, user_id: int) -> Optional[models.Atendimento]:
    """Busca e prepara um atendimento para exclusão. Não faz commit."""
    db_atendimento = await get_atendimento(db, atendimento_id=atendimento_id, user_id=user_id)
    if db_atendimento:
        await db.delete(db_atendimento)
        # O commit deve ser feito na rota que chamou
    return db_atendimento

# --- FUNÇÃO ALTERADA ---
async def get_atendimentos_para_processar(db: AsyncSession, user_id: int) -> List[models.Atendimento]:
    """
    Busca atendimentos com status 'Mensagem Recebida' que tenham mais de 15 segundos
    desde a última atualização.
    """
    # Calcula o tempo limite (15 segundos atrás)
    time_limit = datetime.now(timezone.utc) - timedelta(seconds=15)

    result = await db.execute(
        select(models.Atendimento)
        .where(
            models.Atendimento.user_id == user_id,
            models.Atendimento.status == "Mensagem Recebida",
            # --- NOVA CONDIÇÃO DE TEMPO ---
            models.Atendimento.updated_at <= time_limit
            # -----------------------------
        )
        .options(
            joinedload(models.Atendimento.contact),
            joinedload(models.Atendimento.active_persona) # Garante que a persona está carregada
        )
        .order_by(models.Atendimento.updated_at.asc()) # Pega o mais antigo primeiro
    )
    return result.scalars().all()
# --- FIM DA ALTERAÇÃO ---


async def get_dashboard_data(db: AsyncSession, user_id: int) -> Dict[str, Any]:
    """Coleta dados para o novo dashboard de atendimentos."""
    # (Sem alterações nesta função por enquanto)
    status_counts_query = await db.execute(
        select(models.Atendimento.status, func.count(models.Atendimento.id))
        .where(models.Atendimento.user_id == user_id)
        .group_by(models.Atendimento.status)
    )
    status_counts = {status: count for status, count in status_counts_query.all()}

    now_utc = datetime.now(timezone.utc)
    start_of_day_utc = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)

    finalizados_hoje_query = await db.execute(
        select(func.count(models.Atendimento.id))
        .where(
            models.Atendimento.user_id == user_id,
            models.Atendimento.status == 'Concluído',
            models.Atendimento.updated_at >= start_of_day_utc # Ajustado para início do dia UTC
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
            "ativos": status_counts.get("Aguardando Resposta", 0) + status_counts.get("Mensagem Recebida", 0) + status_counts.get("Novo Atendimento", 0), # Incluindo Novos
            "finalizadosHoje": finalizados_hoje,
            "ignorados": status_counts.get("Ignorar Contato", 0),
            "erros": status_counts.get("Erro no Agente", 0) + status_counts.get("Falha no Envio", 0) # Somando erros
        },
        "recentActivity": [
            {
                "id": a.id,
                "whatsapp": a.contact.whatsapp if a.contact else "N/A", # Checar se contato existe
                "situacao": a.status,
                "observacao": a.observacoes,
                "active_persona_id": a.active_persona_id,
                "updated_at": a.updated_at.isoformat() if a.updated_at else None # Tratar None
            }
            for a in recent_activity
        ]
    }
    return dashboard_data


async def get_atendimentos_for_followup(db: AsyncSession, user: models.User) -> List[models.Atendimento]:
    """Busca atendimentos que precisam de follow-up."""
    if not user.followup_interval_minutes or user.followup_interval_minutes <= 0:
        return []

    time_limit = datetime.now(timezone.utc) - timedelta(minutes=user.followup_interval_minutes)

    result = await db.execute(
        select(models.Atendimento)
        .where(
            models.Atendimento.user_id == user.id,
            models.Atendimento.status == "Aguardando Resposta",
            models.Atendimento.updated_at <= time_limit # <= para incluir exatamente o limite
        )
        .options(
            joinedload(models.Atendimento.contact),
            joinedload(models.Atendimento.active_persona) # Garante que a persona está carregada
        )
        .order_by(models.Atendimento.updated_at.asc()) # Processa o mais antigo primeiro
    )
    return result.scalars().all()

