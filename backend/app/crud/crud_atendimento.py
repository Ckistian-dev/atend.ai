import logging
from sqlalchemy import select, func
from sqlalchemy.orm import joinedload
from sqlalchemy.ext.asyncio import AsyncSession
from app.db import models, schemas
from datetime import datetime, timedelta, timezone # Import timezone
from typing import List, Tuple, Optional, Dict, Any
import json # Import json

logger = logging.getLogger(__name__)

async def get_atendimento(db: AsyncSession, atendimento_id: int, user_id: int) -> Optional[models.Atendimento]:
    """Busca um atendimento específico pelo ID, carregando relacionamentos."""
    result = await db.execute(
        select(models.Atendimento)
        .where(models.Atendimento.id == atendimento_id, models.Atendimento.user_id == user_id)
        .options(
            joinedload(models.Atendimento.active_persona) # Carrega a persona ativa também
        )
    )
    return result.scalars().first()

async def get_atendimentos_by_user(db: AsyncSession, user_id: int) -> List[models.Atendimento]:
    """Lista todos os atendimentos de um usuário."""
    result = await db.execute(
        select(models.Atendimento)
        .where(models.Atendimento.user_id == user_id)
        .options(
            joinedload(models.Atendimento.active_persona)
        )
        .order_by(models.Atendimento.updated_at.desc())
    )
    return result.scalars().all()

async def update_atendimento(db: AsyncSession, db_atendimento: models.Atendimento, atendimento_in: schemas.AtendimentoUpdate) -> models.Atendimento:
    """Atualiza os dados de um atendimento. Não faz commit."""
    update_data = atendimento_in.model_dump(exclude_unset=True)
    
    for field, value in update_data.items():
        
        # --- INÍCIO DA MODIFICAÇÃO ---
        
        if field == 'conversa':
            
            # CASO 1: É um dict (lógica antiga de 'add_message')
            if isinstance(value, dict) and 'add_message' in value:
                try:
                    current_conversa_str = db_atendimento.conversa or "[]"
                    current_conversa_list = json.loads(current_conversa_str)
                    new_message = value['add_message'] # Espera um dict de mensagem formatado
                    
                    if 'timestamp' not in new_message:
                        new_message['timestamp'] = datetime.now(timezone.utc).isoformat()
                    
                    current_conversa_list.append(new_message)
                    current_conversa_list.sort(key=lambda x: x.get('timestamp') or '1970-01-01T00:00:00+00:00')
                    
                    setattr(db_atendimento, 'conversa', json.dumps(current_conversa_list, ensure_ascii=False))
                    needs_refresh = True 
                
                except (json.JSONDecodeError, TypeError) as e:
                    logger.error(f"Erro ao adicionar mensagem à conversa (Atendimento ID {db_atendimento.id}): {e}. Conversa atual: {db_atendimento.conversa}")
            
            # CASO 2: É uma string (nova lógica de 'mark_as_read' / substituição total)
            elif isinstance(value, str):
                # Simplesmente define o valor, pois já é uma string JSON
                setattr(db_atendimento, field, value)
            
            # CASO 3: É outra coisa (ex: None ou um tipo inesperado)
            elif value is not None:
                # Loga um aviso se não for um dict esperado ou uma string
                logger.warning(f"Tipo inesperado para 'conversa' no update (Atendimento ID {db_atendimento.id}): {type(value)}")
        
        # Para todos os outros campos (status, active_persona_id, etc.)
        else:
            setattr(db_atendimento, field, value)
            

    db_atendimento.updated_at = datetime.now(timezone.utc)
    db.add(db_atendimento)
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
    # 1. Buscar Atendimento Ativo
    atendimento_query = await db.execute(
        select(models.Atendimento)
        .where(
            models.Atendimento.whatsapp == number,
            models.Atendimento.user_id == user.id,
        )
        .order_by(models.Atendimento.created_at.desc())
        .options(joinedload(models.Atendimento.active_persona)) # Carrega relacionamentos
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
        whatsapp=number, user_id=user.id,
        active_persona_id=user.default_persona_id, status="Mensagem Recebida" # Status inicial
    )
    db.add(new_atendimento)
    try:
        await db.commit()
        await db.refresh(new_atendimento)
        logger.info(f"Novo atendimento criado (ID: {new_atendimento.id}) para o contato ({number}).")
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
                "whatsapp": a.whatsapp if a.whatsapp else "N/A", # Checar se contato existe
                "situacao": a.status,
                "observacao": a.observacoes,
                "active_persona_id": a.active_persona_id,
                "updated_at": a.updated_at.isoformat() if a.updated_at else None # Tratar None
            }
            for a in recent_activity
        ]
    }
    return dashboard_data


async def get_atendimentos_para_processar(db: AsyncSession) -> List[models.Atendimento]:
    """
    Busca TODOS os atendimentos que receberam uma mensagem e estão
    aguardando processamento (status 'Mensagem Recebida' por mais de 10s).
    
    Esta é uma consulta otimizada em massa (bulk query) que o agent_processor.py usa.
    """
    try:
        # Define o tempo limite (10 segundos atrás)
        tempo_limite = datetime.now(timezone.utc) - timedelta(seconds=10)
        
        # Cria a consulta
        stmt = (
            select(models.Atendimento)
            .join(models.User, models.Atendimento.user_id == models.User.id)
            .where(
                models.User.agent_running == True, # Filtra por usuários com agente ativo
                models.Atendimento.status == "Mensagem Recebida",
                models.Atendimento.updated_at < tempo_limite
            )
            .order_by(models.Atendimento.updated_at.asc()) # Processa os mais antigos primeiro
        )
        
        result = await db.execute(stmt)
        atendimentos = result.scalars().unique().all()
        return atendimentos
        
    except Exception as e:
        logger.error(f"Erro ao buscar atendimentos para processar (em massa): {e}", exc_info=True)
        return []