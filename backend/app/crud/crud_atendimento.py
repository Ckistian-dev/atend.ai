import logging
from sqlalchemy import select, func
from sqlalchemy.orm import joinedload
from sqlalchemy.dialects.postgresql import JSONB
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

async def create_atendimento(db: AsyncSession, atendimento_in: schemas.AtendimentoCreate, user_id: int) -> models.Atendimento:
    """
    Cria um novo atendimento e carrega seus relacionamentos para evitar erros de lazy-loading.
    Não faz commit.
    """
    # Exclui os campos que não pertencem ao modelo do banco de dados, pois são usados apenas para a lógica de envio de template na rota.
    create_data = atendimento_in.model_dump(exclude={'template_name', 'template_language_code', 'template_components'})

    db_atendimento = models.Atendimento(
        **create_data,
        user_id=user_id
    )
    db.add(db_atendimento)
    await db.flush() # Envia o objeto para o banco para obter um ID e valores padrão.

    # Recarrega o objeto e seu relacionamento 'active_persona' explicitamente.
    # Isso é crucial para que a resposta da API possa ser serializada sem erros de I/O (lazy loading).
    await db.refresh(db_atendimento, attribute_names=['active_persona'])

    # O commit será feito na rota que chamou a função.
    return db_atendimento

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


async def get_all_user_tags(db: AsyncSession, user_id: int) -> List[Dict[str, str]]:
    """Busca todas as tags únicas de todos os atendimentos de um usuário."""
    try:
        # Esta query extrai o array de tags de cada atendimento
        query = select(models.Atendimento.tags).where(
            models.Atendimento.user_id == user_id,
            models.Atendimento.tags != None,  # Ignora atendimentos sem tags
            func.jsonb_array_length(models.Atendimento.tags.cast(JSONB)) > 0 # Ignora arrays vazios
        )
        result = await db.execute(query)
        
        # Processa os resultados para criar um conjunto de tags únicas
        all_tags_lists = result.scalars().all()
        unique_tags = {} # Usar um dict para garantir unicidade pelo nome
        for tags_list in all_tags_lists:
            for tag in tags_list:
                # Adiciona ao dict usando o nome como chave para evitar duplicatas
                if isinstance(tag, dict) and 'name' in tag and 'color' in tag:
                    unique_tags[tag['name'].lower()] = {'name': tag['name'], 'color': tag['color']}
        
        return list(unique_tags.values())
    except Exception as e:
        logger.error(f"Erro ao buscar tags para o usuário {user_id}: {e}", exc_info=True)
        return []

async def get_atendimentos_no_periodo(db: AsyncSession, user_id: int, start_date: datetime, end_date: datetime) -> List[models.Atendimento]:
    """Busca todos os atendimentos de um usuário dentro de um período de datas."""
    query = select(models.Atendimento).where(
        models.Atendimento.user_id == user_id,
        models.Atendimento.created_at.between(start_date, end_date)
    )
    result = await db.execute(query)
    return result.scalars().all()


async def get_dashboard_data(
    db: AsyncSession, 
    user_id: int, 
    start_date: datetime, 
    end_date: datetime
) -> Dict[str, Any]:
    """Coleta, agrega e formata dados para o dashboard, filtrados por período."""

    # --- LÓGICA ORIGINAL PARA CARREGAR O DASHBOARD ---

    # --- 1. Métricas para os Cards ---
    base_query = select(models.Atendimento).where(
        models.Atendimento.user_id == user_id,
        models.Atendimento.created_at.between(start_date, end_date),
        models.Atendimento.status != 'Ignorar Contato' # Exclui o status
    )

    # Mapeamento de cores para ser usado nas queries
    status_colors = {
        "Mensagem Recebida": "#144cd1",
        "Atendente Chamado": "#f0ad60",
        "Aguardando Resposta": "#e5da61",
        "Concluído": "#5fd395",
        "Gerando Resposta": "#d569dd",
    }

    total_atendimentos_query = await db.execute(select(func.count()).select_from(base_query.subquery()))
    total_atendimentos = total_atendimentos_query.scalar_one_or_none() or 0

    concluidos_query = await db.execute(select(func.count()).select_from(
        base_query.where(models.Atendimento.status == 'Concluído').subquery()
    ))
    total_concluidos = concluidos_query.scalar_one_or_none() or 0

    taxa_conversao = (total_concluidos / total_atendimentos * 100) if total_atendimentos > 0 else 0

    # --- 2. Gráfico de Rosca (Atendimentos por Situação) ---
    status_counts_query = await db.execute(
        select(models.Atendimento.status, func.count(models.Atendimento.id))
        .where(
            models.Atendimento.user_id == user_id,
            models.Atendimento.created_at.between(start_date, end_date),
            models.Atendimento.status != 'Ignorar Contato' # Exclui o status
        )
        .group_by(models.Atendimento.status)
    )
    atendimentos_por_situacao = [
        {"name": status, "value": count, "color": status_colors.get(status, "#808080")}
        for status, count in status_counts_query.all()
    ]

    # --- 3. Gráfico de Linhas (Contatos por Dia) ---
    # Contagem individual para cada status por dia
    status_filters = [
        func.count().filter(models.Atendimento.status == status).label(status)
        for status in status_colors.keys()
    ]

    date_series_query = await db.execute(
        select(
            func.date_trunc('day', models.Atendimento.created_at).label('day'),
            func.count(models.Atendimento.id).label('total'),
            *status_filters
        ).where(
            models.Atendimento.user_id == user_id,
            models.Atendimento.created_at.between(start_date, end_date),
            models.Atendimento.status != 'Ignorar Contato' # Exclui o status
        )
        .group_by('day')
        .order_by('day')
    )
    
    # --- LÓGICA APRIMORADA PARA GARANTIR TODOS OS DIAS NO PERÍODO ---
    # 1. Cria um dicionário com todos os dias do período, inicializados com zero.
    all_days_in_period = {}
    current_day = start_date
    while current_day <= end_date:
        day_key = current_day.strftime('%d/%m')
        all_days_in_period[day_key] = {
            "date": day_key,
            "total": 0
        }
        for status in status_colors.keys():
            all_days_in_period[day_key][status] = 0
        current_day += timedelta(days=1)

    # 2. Preenche o dicionário com os dados do banco.
    results = date_series_query.mappings().all()
    for row in results:
        day_key = row['day'].strftime('%d/%m')
        if day_key in all_days_in_period:
            for status in status_colors.keys():
                all_days_in_period[day_key][status] = row.get(status, 0)
            all_days_in_period[day_key]['total'] = row.get('total', 0)
    
    # 3. Converte o dicionário para a lista final.
    contatos_por_dia = list(all_days_in_period.values())
    # --- 4. Consumo de Tokens (Estimativa) ---
    # Esta é uma estimativa, pois não temos um log de transações de tokens.
    # A lógica é: (Tokens no início do mês - Tokens atuais) / atendimentos no período.
    # Isso pode ser impreciso se o período cruzar meses.
    # Uma implementação futura ideal teria uma tabela de transações de tokens.
    
    # Para simplificar, vamos calcular o consumo médio como um valor fixo por enquanto.
    # Em um cenário real, buscaríamos o usuário e faríamos o cálculo.
    # user = await crud_user.get_user(db, user_id=user_id)
    # tokens_consumidos = 9999 - user.tokens 
    # consumo_medio_tokens = (tokens_consumidos / total_atendimentos) if total_atendimentos > 0 else 0
    # Por enquanto, retornamos um valor simulado.
    consumo_medio_tokens = 1.25 # Valor simulado
    # Lógica aprimorada: Contar tokens consumidos analisando o histórico de conversas.
    # Cada mensagem com role 'assistant' no período representa um token consumido.
    atendimentos_no_periodo_query = await db.execute(base_query)
    atendimentos_no_periodo = atendimentos_no_periodo_query.scalars().all()

    tokens_consumidos = 0
    for atendimento in atendimentos_no_periodo:
        try:
            conversa_list = json.loads(atendimento.conversa or "[]")
            for msg in conversa_list:
                # Verifica se a mensagem é do assistente e está dentro do período
                if msg.get('role') == 'assistant':
                    msg_timestamp = msg.get('timestamp')
                    if msg_timestamp:
                        # Converte timestamp (pode ser int ou str ISO) para datetime
                        if isinstance(msg_timestamp, (int, float)):
                            msg_dt = datetime.fromtimestamp(msg_timestamp, tz=timezone.utc)
                        else:
                            msg_dt = datetime.fromisoformat(str(msg_timestamp).replace("Z", "+00:00"))
                        
                        if start_date <= msg_dt <= end_date:
                            tokens_consumidos += 1
        except (json.JSONDecodeError, TypeError, ValueError):
            continue # Ignora conversas malformadas

    consumo_medio_tokens = (tokens_consumidos / total_atendimentos) if total_atendimentos > 0 else 0

    # --- NOVO: Lógica para Atividade Recente ---
    # Busca o último atendimento atualizado no período para exibir no header.
    recent_activity_query = await db.execute(
        select(models.Atendimento)
        .where(
            models.Atendimento.user_id == user_id,
            models.Atendimento.created_at.between(start_date, end_date)
        )
        .order_by(models.Atendimento.updated_at.desc())
        .limit(1)
    )
    recent_activity = recent_activity_query.scalars().first()

    dashboard_data = {
        "stats": {
            "totalAtendimentos": {
                "value": total_atendimentos,
                "label": "Total de Atendimentos"
            },
            "totalConcluidos": {
                "value": total_concluidos,
                "label": "Atendimentos Concluídos"
            },
            "taxaConversao": {
                "value": f"{taxa_conversao:.1f}%",
                "label": "Taxa de Conversão"
            },
            "consumoMedioTokens": {
                "value": f"{consumo_medio_tokens:.2f}",
                "label": "Tokens / Atendimento (médio)"
            }
        },
        "charts": {
            "atendimentosPorSituacao": atendimentos_por_situacao,
            "contatosPorDia": contatos_por_dia
        },
        # Adiciona a atividade recente ao payload. Retorna como uma lista para manter
        # a compatibilidade com o frontend que espera `recentActivity[0]`.
        "recentActivity": [
            {
                "id": recent_activity.id,
                "whatsapp": recent_activity.whatsapp,
                "situacao": recent_activity.status,
                "observacao": recent_activity.observacoes
            }
        ] if recent_activity else []
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

async def get_atendimentos_for_followup(db: AsyncSession, user_id: int, earliest_time: datetime, latest_time: datetime) -> list[models.Atendimento]:
    """
    Busca atendimentos de um usuário em 'Aguardando Resposta' dentro da janela de tempo para follow-up.
    """
    stmt = (
        select(models.Atendimento)
        .where(
            models.Atendimento.user_id == user_id,
            models.Atendimento.status == "Aguardando Resposta",
            models.Atendimento.updated_at < earliest_time,
            models.Atendimento.updated_at > latest_time
        )
        .options(joinedload(models.Atendimento.active_persona)) # Eager load persona
    )
    result = await db.execute(stmt)
    return result.scalars().unique().all()