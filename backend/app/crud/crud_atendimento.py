import logging
from sqlalchemy import select, func, text, or_, and_
from sqlalchemy.orm import joinedload, selectinload, undefer
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession
from app.db import models, schemas
from datetime import datetime, timedelta, timezone # Import timezone
from typing import List, Tuple, Optional, Dict, Any
import json # Import json
from app.crud import crud_user
from app.services.whatsapp_service import format_whatsapp_number

logger = logging.getLogger(__name__)

def parse_timestamp_to_datetime(ts: Any) -> datetime:
    """Converte qualquer formato de timestamp (int, float, ISO str, datetime) em datetime com timezone UTC."""
    if isinstance(ts, datetime):
        if ts.tzinfo is None:
            return ts.replace(tzinfo=timezone.utc)
        return ts
    if isinstance(ts, (int, float)):
        val = float(ts)
        if val > 1e11:
            val = val / 1000.0
        return datetime.fromtimestamp(val, tz=timezone.utc)
    if isinstance(ts, str):
        try:
            val = float(ts)
            if val > 1e11:
                val = val / 1000.0
            return datetime.fromtimestamp(val, tz=timezone.utc)
        except ValueError:
            pass
        try:
            return datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except Exception:
            pass
    return datetime.now(timezone.utc)

async def get_atendimento(db: AsyncSession, atendimento_id: int, company_id: int) -> Optional[models.Atendimento]:
    """Busca um atendimento específico pelo ID, carregando relacionamentos e mensagens."""
    result = await db.execute(
        select(models.Atendimento)
        .where(models.Atendimento.id == atendimento_id, models.Atendimento.company_id == company_id)
        .options(
            joinedload(models.Atendimento.active_persona),
            joinedload(models.Atendimento.assigned_user),
            selectinload(models.Atendimento.mensagens)
        )
    )
    return result.scalars().first()

async def get_atendimentos_by_user(db: AsyncSession, company_id: int) -> List[models.Atendimento]:
    """Lista todos os atendimentos de uma empresa ordenados pela última mensagem."""
    result = await db.execute(
        select(models.Atendimento)
        .where(models.Atendimento.company_id == company_id)
        .options(
            joinedload(models.Atendimento.active_persona),
            selectinload(models.Atendimento.mensagens)
        )
        .order_by(func.coalesce(models.Atendimento.last_message_at, models.Atendimento.updated_at, models.Atendimento.created_at).desc())
    )
    return result.scalars().all()

async def get_messages_for_atendimento(
    db: AsyncSession, 
    atendimento_id: int, 
    company_id: int
) -> List[models.Message]:
    """Retorna todas as mensagens de um atendimento ordenadas cronologicamente."""
    stmt = (
        select(models.Message)
        .where(
            models.Message.atendimento_id == atendimento_id,
            models.Message.company_id == company_id
        )
        .order_by(models.Message.timestamp.asc())
    )
    res = await db.execute(stmt)
    return res.scalars().all()

async def has_newer_user_messages(
    db: AsyncSession,
    atendimento_id: int,
    company_id: int,
    last_processed_msg_id: int
) -> bool:
    """Verifica com alta eficiência se existem mensagens novas do cliente (role 'user' ou 'client') gravadas após last_processed_msg_id."""
    if not last_processed_msg_id or last_processed_msg_id <= 0:
        return False
    stmt = (
        select(models.Message.id)
        .where(
            models.Message.atendimento_id == atendimento_id,
            models.Message.company_id == company_id,
            models.Message.id > last_processed_msg_id,
            models.Message.role.in_(["user", "client"]),
            models.Message.type != "reaction"
        )
        .limit(1)
    )
    res = await db.execute(stmt)
    return res.scalar_one_or_none() is not None

async def get_message_by_wamid_or_id(
    db: AsyncSession, 
    company_id: int, 
    message_id: str,
    atendimento_id: Optional[int] = None
) -> Optional[models.Message]:
    """Busca uma mensagem específica pelo WAMID (message_id) ou ID inteiro primário."""
    if not message_id or str(message_id).strip().lower() in ['null', 'none', 'undefined', '']:
        return None

    msg_id_str = str(message_id).strip()
    conditions = [
        models.Message.message_id == msg_id_str
    ]
    try:
        msg_int_id = int(msg_id_str)
        if -2147483648 <= msg_int_id <= 2147483647:
            conditions.append(models.Message.id == msg_int_id)
    except (ValueError, TypeError):
        pass

    query = select(models.Message).where(
        models.Message.company_id == company_id,
        or_(*conditions)
    )
    if atendimento_id:
        query = query.where(models.Message.atendimento_id == atendimento_id)

    res = await db.execute(query)
    return res.scalars().first()

async def get_message_by_media_id(
    db: AsyncSession,
    company_id: int,
    media_id: str,
    atendimento_id: Optional[int] = None
) -> Optional[models.Message]:
    """Busca uma mensagem pelo media_id, message_id ou id primário para recuperação de bytes."""
    if not media_id or str(media_id).strip().lower() in ['null', 'none', 'undefined', '']:
        return None

    media_id_str = str(media_id).strip()
    conditions = [
        models.Message.media_id == media_id_str,
        models.Message.message_id == media_id_str
    ]
    try:
        msg_int_id = int(media_id_str)
        # Limita ao intervalo válido de INTEGER (int32) do PostgreSQL (-2^31 a 2^31 - 1)
        if -2147483648 <= msg_int_id <= 2147483647:
            conditions.append(models.Message.id == msg_int_id)
    except (ValueError, TypeError):
        pass

    query = (
        select(models.Message)
        .where(
            models.Message.company_id == company_id,
            or_(*conditions)
        )
        .options(undefer(models.Message.media_bytes))
    )
    if atendimento_id:
        query = query.where(models.Message.atendimento_id == atendimento_id)
    res = await db.execute(query)
    return res.scalars().first()

async def save_message(
    db: AsyncSession,
    company_id: int,
    atendimento_id: int,
    message_data: Dict[str, Any],
    media_bytes: Optional[bytes] = None
) -> models.Message:
    """
    Cria ou atualiza uma mensagem individual na tabela 'mensagens'.
    Persiste arquivos de mídia diretamente em 'media_bytes' (BYTEA).
    """
    msg_id = str(message_data.get("id") or message_data.get("message_id") or "")
    if not msg_id:
        import uuid
        msg_id = f"msg_{uuid.uuid4().hex[:12]}"

    ts = parse_timestamp_to_datetime(message_data.get("timestamp"))

    stmt = select(models.Message).where(
        models.Message.company_id == company_id,
        models.Message.message_id == msg_id
    )
    res = await db.execute(stmt)
    existing_msg = res.scalars().first()

    content_val = message_data.get("content")
    if content_val is None:
        content_val = message_data.get("caption") or message_data.get("filename") or ""

    if existing_msg:
        # Atualiza campos se fornecidos
        if message_data.get("content") is not None:
            existing_msg.content = str(message_data["content"])
        if message_data.get("caption") is not None:
            existing_msg.caption = message_data["caption"]
        if message_data.get("status") is not None:
            existing_msg.status = message_data["status"]
        if message_data.get("type") is not None:
            existing_msg.type = message_data["type"]
        if message_data.get("media_id") is not None:
            existing_msg.media_id = message_data["media_id"]
        if message_data.get("mime_type") is not None:
            existing_msg.mime_type = message_data["mime_type"]
        if message_data.get("filename") is not None:
            existing_msg.filename = message_data["filename"]
        if message_data.get("error_code") is not None:
            existing_msg.error_code = message_data["error_code"]
        if message_data.get("error_title") is not None:
            existing_msg.error_title = message_data["error_title"]
        if message_data.get("reaction") is not None:
            existing_msg.reaction = message_data["reaction"]
        if message_data.get("reactions") is not None:
            existing_msg.reactions = message_data["reactions"]
        if media_bytes is not None:
            existing_msg.media_bytes = media_bytes
        db.add(existing_msg)
        target_msg = existing_msg
    else:
        new_msg = models.Message(
            company_id=company_id,
            atendimento_id=atendimento_id,
            message_id=msg_id,
            role=message_data.get("role", "user"),
            type=message_data.get("type", "text"),
            content=str(content_val),
            caption=message_data.get("caption"),
            timestamp=ts,
            message_date=ts,
            status=message_data.get("status", "received"),
            error_code=message_data.get("error_code"),
            error_title=message_data.get("error_title"),
            media_id=message_data.get("media_id"),
            media_url=message_data.get("url") or message_data.get("media_url"),
            mime_type=message_data.get("mime_type"),
            filename=message_data.get("filename"),
            media_bytes=media_bytes,
            reaction=message_data.get("reaction"),
            reactions=message_data.get("reactions"),
            quoted_msg_id=message_data.get("quoted_msg_id"),
            is_ai=bool(message_data.get("is_ai", False)),
            is_template=bool(message_data.get("is_template", False)),
            buttons=message_data.get("buttons"),
            quoted_msg=message_data.get("quoted_msg"),
            extra_data=message_data.get("extra_data")
        )
        db.add(new_msg)
        target_msg = new_msg

    # Atualiza last_message_at e updated_at no Atendimento pai
    if atendimento_id:
        try:
            atend_stmt = select(models.Atendimento).where(
                models.Atendimento.id == atendimento_id,
                models.Atendimento.company_id == company_id
            )
            atend_res = await db.execute(atend_stmt)
            db_atend = atend_res.scalars().first()
            if db_atend:
                now_utc = datetime.now(timezone.utc)
                if not db_atend.last_message_at or ts >= db_atend.last_message_at:
                    db_atend.last_message_at = ts
                db_atend.updated_at = now_utc
                db.add(db_atend)
        except Exception as e:
            logger.warning(f"Erro ao atualizar last_message_at no Atendimento {atendimento_id}: {e}")

    return target_msg

async def apply_reaction_to_message(
    db: AsyncSession,
    company_id: int,
    atendimento_id: int,
    target_message_id: str,
    emoji: str,
    sender_number: Optional[str] = None
) -> Optional[models.Message]:
    """
    Aplica ou remove uma reação em uma mensagem específica (target_message_id / WAMID).
    Se emoji for vazio (''), remove a reação.
    """
    stmt = select(models.Message).where(
        models.Message.company_id == company_id,
        models.Message.message_id == target_message_id
    )
    res = await db.execute(stmt)
    target_msg = res.scalars().first()

    if not target_msg:
        # Tenta buscar pelo atendimento caso o target_message_id seja id numérico
        logger.warning(f"Mensagem alvo para reação não encontrada: message_id={target_message_id}, company_id={company_id}")
        return None

    sender_key = sender_number or "user"
    current_reactions = dict(target_msg.reactions or {})

    if emoji and emoji.strip():
        clean_emoji = emoji.strip()
        target_msg.reaction = clean_emoji
        current_reactions[sender_key] = {
            "emoji": clean_emoji,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    else:
        # Remoção de reação
        target_msg.reaction = None
        current_reactions.pop(sender_key, None)

    target_msg.reactions = current_reactions
    db.add(target_msg)
    logger.info(f"Reação '{emoji}' aplicada à mensagem {target_message_id} (Atendimento {atendimento_id}).")
    return target_msg

async def update_message_status(
    db: AsyncSession,
    company_id: int,
    message_id: str,
    status: str,
    error_code: Optional[str] = None,
    error_title: Optional[str] = None
) -> Optional[models.Message]:
    """Atualiza o status de entrega/leitura/falha de uma mensagem pelo WAMID."""
    msg = await get_message_by_wamid_or_id(db, company_id=company_id, message_id=message_id)
    if msg:
        msg.status = status
        if error_code:
            msg.error_code = str(error_code)
        if error_title:
            msg.error_title = str(error_title)
        db.add(msg)
        return msg
    return None

async def distribute_atendimento(db: AsyncSession, atendimento: models.Atendimento):
    """
    Distribui o atendimento igualitariamente entre os usuários da mesma empresa
    que participam da distribuição de contatos, tagueando o atendimento.
    """
    company_id = atendimento.company_id
    if not company_id:
        return

    # 1. Buscar usuários que participam da distribuição
    stmt_users = select(models.User).where(
        models.User.company_id == company_id,
        models.User.participates_distribution == True
    )
    res_users = await db.execute(stmt_users)
    candidates = res_users.scalars().all()
    if not candidates:
        logger.info(f"Nenhum usuário configurado para distribuição de contatos na empresa {company_id}.")
        return

    # 2. Verificar se o atendimento já possui a tag de algum dos candidatos
    current_tags = atendimento.tags or []
    if not isinstance(current_tags, list):
        try:
            current_tags = json.loads(current_tags) if isinstance(current_tags, str) else list(current_tags)
        except:
            current_tags = []

    candidate_identifiers = set()
    for u in candidates:
        if u.name:
            candidate_identifiers.add(u.name.strip().lower())
        if u.email:
            candidate_identifiers.add(u.email.strip().lower())

    candidate_identifiers.discard(None)

    has_agent_tag = False
    for tag in current_tags:
        if isinstance(tag, dict) and tag.get("name"):
            tag_name_lower = str(tag.get("name")).strip().lower()
            if tag_name_lower in candidate_identifiers:
                has_agent_tag = True
                break

    if has_agent_tag:
        logger.info(f"Atendimento {atendimento.id} já possui tag de agente associado. Pulando distribuição.")
        return

    # 3. Distribuição igualitária: contar atendimentos de cada candidato
    user_counts = []
    for u in candidates:
        name_to_check = u.name if u.name else u.email
        stmt_count = select(func.count(models.Atendimento.id)).where(
            models.Atendimento.company_id == company_id,
            models.Atendimento.tags.cast(JSONB).contains([{"name": name_to_check}])
        )
        count_res = await db.execute(stmt_count)
        count = count_res.scalar() or 0
        user_counts.append((count, u))

    # Ordenar por count ascendente e depois por ID do usuário
    user_counts.sort(key=lambda x: (x[0], x[1].id))
    selected_user = user_counts[0][1]

    # 4. Adicionar a tag
    selected_name = selected_user.name if selected_user.name else selected_user.email
    selected_color = selected_user.profile_color or "#3b82f6"

    new_tag = {"name": selected_name, "color": selected_color}
    current_tags.append(new_tag)
    atendimento.tags = current_tags
    logger.info(f"Atendimento {atendimento.id} distribuído para o usuário {selected_name} (Cor: {selected_color}).")

async def create_atendimento(db: AsyncSession, atendimento_in: schemas.AtendimentoCreate, company_id: int) -> models.Atendimento:
    """
    Cria um novo atendimento e carrega seus relacionamentos para evitar erros de lazy-loading.
    Não faz commit.
    """
    create_data = atendimento_in.model_dump(exclude={'template_name', 'template_language_code', 'template_components'})
    if not create_data.get('last_message_at'):
        create_data['last_message_at'] = datetime.now(timezone.utc)

    db_atendimento = models.Atendimento(
        **create_data,
        company_id=company_id
    )
    db.add(db_atendimento)
    await db.flush()

    if db_atendimento.status == "Atendente Chamado":
        await distribute_atendimento(db, db_atendimento)

    await db.refresh(db_atendimento, attribute_names=['active_persona', 'mensagens'])
    return db_atendimento

async def mark_atendimento_messages_as_read(
    db: AsyncSession,
    company_id: int,
    atendimento_id: int
) -> Tuple[Optional[models.Atendimento], List[str]]:
    """
    Marca todas as mensagens não lidas como 'read'
    exclusivamente na tabela 'mensagens' (e sincroniza a conversa legada se houver).
    Retorna o atendimento atualizado e a lista de WAMIDs para envio de recibos à Meta.
    """
    stmt_msgs = (
        select(models.Message)
        .where(
            models.Message.company_id == company_id,
            models.Message.atendimento_id == atendimento_id,
            or_(
                models.Message.status == "unread",
                and_(
                    models.Message.role.in_(["user", "client"]),
                    models.Message.status != "read"
                )
            )
        )
    )
    res_msgs = await db.execute(stmt_msgs)
    unread_messages = res_msgs.scalars().all()

    wamid_list: List[str] = []
    for msg in unread_messages:
        msg.status = "read"
        db.add(msg)
        if msg.message_id and str(msg.message_id).startswith("wamid."):
            wamid_list.append(str(msg.message_id))

    await db.flush()

    db_atendimento = await get_atendimento(db, atendimento_id=atendimento_id, company_id=company_id)
    if db_atendimento and db_atendimento.conversa and db_atendimento.conversa != "[]":
        try:
            conv = json.loads(db_atendimento.conversa)
            if isinstance(conv, list):
                updated = False
                for m in conv:
                    if isinstance(m, dict) and (m.get("status") == "unread" or (m.get("role") in ["user", "client"] and m.get("status") != "read")):
                        m["status"] = "read"
                        updated = True
                if updated:
                    db_atendimento.conversa = json.dumps(conv)
                    db.add(db_atendimento)
                    await db.flush()
        except Exception:
            pass

    logger.info(f"Atendimento {atendimento_id}: {len(unread_messages)} mensagens marcadas como 'read' na tabela mensagens ({len(wamid_list)} WAMIDs).")
    return db_atendimento, wamid_list

async def mark_atendimento_messages_as_unread(
    db: AsyncSession,
    company_id: int,
    atendimento_id: int
) -> Optional[models.Atendimento]:
    """
    Marca a última mensagem do cliente no atendimento como 'unread'
    exclusivamente na tabela 'mensagens' (e sincroniza a conversa legada se houver).
    """
    stmt_last_msg = (
        select(models.Message)
        .where(
            models.Message.company_id == company_id,
            models.Message.atendimento_id == atendimento_id,
            models.Message.role.in_(["user", "client"])
        )
        .order_by(models.Message.timestamp.desc(), models.Message.id.desc())
        .limit(1)
    )
    res_last = await db.execute(stmt_last_msg)
    last_msg = res_last.scalars().first()

    # Se não houver mensagem de user/client, busca a última mensagem de qualquer role
    if not last_msg:
        stmt_any_last = (
            select(models.Message)
            .where(
                models.Message.company_id == company_id,
                models.Message.atendimento_id == atendimento_id
            )
            .order_by(models.Message.timestamp.desc(), models.Message.id.desc())
            .limit(1)
        )
        res_any = await db.execute(stmt_any_last)
        last_msg = res_any.scalars().first()

    if last_msg:
        last_msg.status = "unread"
        db.add(last_msg)
        await db.flush()

    db_atendimento = await get_atendimento(db, atendimento_id=atendimento_id, company_id=company_id)
    if db_atendimento and db_atendimento.conversa and db_atendimento.conversa != "[]":
        try:
            conv = json.loads(db_atendimento.conversa)
            if isinstance(conv, list) and len(conv) > 0:
                last_idx = -1
                for idx, m in enumerate(conv):
                    if isinstance(m, dict) and m.get("role") in ["user", "client"]:
                        last_idx = idx
                if last_idx == -1:
                    last_idx = len(conv) - 1
                if last_idx != -1 and isinstance(conv[last_idx], dict):
                    conv[last_idx]["status"] = "unread"
                    db_atendimento.conversa = json.dumps(conv)
                    db.add(db_atendimento)
                    await db.flush()
        except Exception:
            pass

    logger.info(f"Atendimento {atendimento_id}: Última mensagem marcada como 'unread' na tabela mensagens.")
    return db_atendimento

async def update_atendimento(db: AsyncSession, db_atendimento: models.Atendimento, atendimento_in: schemas.AtendimentoUpdate) -> models.Atendimento:
    """Atualiza os dados de um atendimento e sincroniza mensagens se aplicável."""
    old_status = db_atendimento.status
    update_data = atendimento_in.model_dump(exclude_unset=True)
    
    for field, value in update_data.items():
        if field == 'conversa':
            if isinstance(value, dict) and 'add_message' in value:
                # Adiciona mensagem na tabela mensagens
                new_msg_data = value['add_message']
                await save_message(
                    db=db,
                    company_id=db_atendimento.company_id,
                    atendimento_id=db_atendimento.id,
                    message_data=new_msg_data
                )
            elif isinstance(value, str):
                # Se for JSON string (ex: atualização de status legado)
                try:
                    msgs_list = json.loads(value)
                    if isinstance(msgs_list, list):
                        for m in msgs_list:
                            if isinstance(m, dict):
                                target_id = m.get("message_id") or m.get("id")
                                if target_id:
                                    msg_rec = await get_message_by_wamid_or_id(
                                        db, 
                                        company_id=db_atendimento.company_id, 
                                        message_id=str(target_id),
                                        atendimento_id=db_atendimento.id
                                    )
                                    if msg_rec and m.get("status") and msg_rec.status != m.get("status"):
                                        msg_rec.status = m["status"]
                                        db.add(msg_rec)
                except Exception as parse_err:
                    logger.warning(f"Erro ao processar sync de conversa string em update_atendimento: {parse_err}")
                setattr(db_atendimento, 'conversa', value)
        else:
            setattr(db_atendimento, field, value)

    db_atendimento.updated_at = datetime.now(timezone.utc)
    db.add(db_atendimento)

    if db_atendimento.status == "Atendente Chamado" and old_status != "Atendente Chamado":
        await distribute_atendimento(db, db_atendimento)

    return db_atendimento

async def add_message_to_conversa(
    db: AsyncSession,
    atendimento_id: int,
    company_id: int,
    message: schemas.FormattedMessage,
    media_bytes: Optional[bytes] = None
) -> Optional[models.Atendimento]:
    """Persiste a mensagem diretamente na tabela 'mensagens' e atualiza o atendimento."""
    db_atendimento = await get_atendimento(db, atendimento_id=atendimento_id, company_id=company_id)
    if not db_atendimento:
        logger.warning(f"Tentativa de adicionar mensagem a atendimento inexistente: ID {atendimento_id}, Empresa {company_id}")
        return None

    try:
        msg_dict = message.model_dump()
        await save_message(
            db=db,
            company_id=company_id,
            atendimento_id=atendimento_id,
            message_data=msg_dict,
            media_bytes=media_bytes
        )

        db_atendimento.updated_at = datetime.now(timezone.utc)
        db.add(db_atendimento)
        await db.commit()
        await db.refresh(db_atendimento, attribute_names=['mensagens', 'active_persona'])
        logger.info(f"Mensagem ID {message.id or message.message_id} salva na tabela mensagens do Atendimento ID {atendimento_id}.")
        return db_atendimento

    except Exception as e:
        logger.error(f"Erro ao salvar mensagem no atendimento {atendimento_id}: {e}", exc_info=True)
        await db.rollback()
        return None


async def get_or_create_atendimento_by_number(db: AsyncSession, number: str, company: models.Company) -> Optional[Tuple[models.Atendimento, bool]]:
    """Busca ou cria um atendimento. Faz commit internamente."""
    formatted_number = format_whatsapp_number(number)

    # 1. Buscar Atendimento Ativo
    atendimento_query = await db.execute(
        select(models.Atendimento)
        .where(
            models.Atendimento.whatsapp == formatted_number,
            models.Atendimento.company_id == company.id,
        )
        .order_by(models.Atendimento.created_at.desc())
        .options(joinedload(models.Atendimento.active_persona)) # Carrega relacionamentos
    )
    existing_atendimento = atendimento_query.scalars().first()

    if existing_atendimento:
        logger.debug(f"Atendimento ativo (ID: {existing_atendimento.id}, Status: {existing_atendimento.status}) encontrado para {formatted_number}.")
        return existing_atendimento, False # Retorna o existente e False (não foi criado)

    # 3. Criar Novo Atendimento (se nenhum ativo foi encontrado)
    if not company.default_persona_id:
        logger.error(f"Empresa {company.id} não tem persona padrão configurada. Não é possível criar novo atendimento para {formatted_number}.")
        return None # Retorna None se não puder criar

    logger.info(f"Nenhum atendimento ativo encontrado para {formatted_number}. Criando novo atendimento...")
    now_utc = datetime.now(timezone.utc)
    new_atendimento = models.Atendimento(
        whatsapp=formatted_number, company_id=company.id,
        active_persona_id=company.default_persona_id, status="Mensagem Recebida", # Status inicial
        last_message_at=now_utc
    )
    db.add(new_atendimento)
    try:
        await db.commit()
        await db.refresh(new_atendimento)
        logger.info(f"Novo atendimento criado (ID: {new_atendimento.id}) para o contato ({formatted_number}).")
        # Recarrega com relacionamentos após criar
        return await get_atendimento(db, new_atendimento.id, company.id), True # Retorna o novo e True (foi criado)
    except Exception as e:
        await db.rollback()
        logger.error(f"Erro ao criar novo atendimento para {number}: {e}", exc_info=True)
        return None # Falha ao criar


async def delete_atendimento(db: AsyncSession, atendimento_id: int, company_id: int) -> Optional[models.Atendimento]:
    """Busca e prepara um atendimento para exclusão. Não faz commit."""
    db_atendimento = await get_atendimento(db, atendimento_id=atendimento_id, company_id=company_id)
    if db_atendimento:
        await db.delete(db_atendimento)
        # O commit deve ser feito na rota que chamou
    return db_atendimento


async def get_all_user_tags(db: AsyncSession, company_id: int) -> List[Dict[str, str]]:
    """Busca todas as tags únicas de todos os atendimentos de uma empresa."""
    try:
        # Esta query extrai o array de tags de cada atendimento
        query = select(models.Atendimento.tags).where(
            models.Atendimento.company_id == company_id,
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
        logger.error(f"Erro ao buscar tags para a empresa {company_id}: {e}", exc_info=True)
        return []

async def get_atendimentos_no_periodo(db: AsyncSession, company_id: int, start_date: datetime, end_date: datetime) -> List[models.Atendimento]:
    """Busca todos os atendimentos de uma empresa dentro de um período de datas."""
    query = select(models.Atendimento).where(
        models.Atendimento.company_id == company_id,
        models.Atendimento.created_at.between(start_date, end_date)
    )
    result = await db.execute(query)
    return result.scalars().all()


async def get_dashboard_data(
    db: AsyncSession, 
    company_id: int, 
    start_date: datetime, 
    end_date: datetime
) -> Dict[str, Any]:
    """Coleta, agrega e formata dados para o dashboard, filtrados por período."""

    # --- LÓGICA ORIGINAL PARA CARREGAR O DASHBOARD ---

    # --- 1. Métricas para os Cards ---
    base_query = select(models.Atendimento).where(
        models.Atendimento.company_id == company_id,
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
            models.Atendimento.company_id == company_id,
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
            func.date_trunc('day', func.timezone('America/Sao_Paulo', models.Atendimento.created_at)).label('day'),
            func.count(models.Atendimento.id).label('total'),
            func.sum(models.Atendimento.token_usage).label('tokens'),
            *status_filters
        ).where(
            models.Atendimento.company_id == company_id,
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
            "total": 0,
            "tokens": 0
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
            all_days_in_period[day_key]['tokens'] = row.get('tokens', 0) or 0
    
    # 3. Converte o dicionário para a lista final.
    contatos_por_dia = list(all_days_in_period.values())
    
    # --- 4. Consumo de Tokens (Real) ---
    # Busca o total de tokens consumidos no período usando a tabela de histórico
    total_tokens_periodo = await crud_user.get_token_usage_in_period(db, company_id, start_date, end_date)
    
    # Calcula a média por atendimento
    consumo_medio_tokens = (total_tokens_periodo / total_atendimentos) if total_atendimentos > 0 else 0

    # --- 5. Métricas de Tempo (Atendimento e Resposta) ---
    atendimentos_com_tempo_query = await db.execute(
        select(models.Atendimento.created_at, models.Atendimento.updated_at, models.Atendimento.conversa)
        .where(
            models.Atendimento.company_id == company_id,
            models.Atendimento.created_at.between(start_date, end_date),
            models.Atendimento.status != 'Ignorar Contato'
        )
    )
    atendimentos_lista = atendimentos_com_tempo_query.all()
    
    tempos_atendimento_segundos = []
    tempos_resposta_segundos = []
    
    for row in atendimentos_lista:
        created_at, updated_at, conversa_json = row
        # Tempo de atendimento
        if updated_at and created_at:
            delta = (updated_at - created_at).total_seconds()
            if delta > 0:
                tempos_atendimento_segundos.append(delta)
        
        # Tempo de resposta
        if conversa_json:
            try:
                conversa = json.loads(conversa_json)
                last_user_time = None
                for msg in conversa:
                    if msg.get('role') == 'user':
                        if not last_user_time:
                            last_user_time = msg.get('timestamp')
                    elif msg.get('role') == 'assistant':
                        if msg.get('is_ai') is True:
                            last_user_time = None
                            continue
                        else:
                            if last_user_time:
                                current_time = msg.get('timestamp')
                                if current_time and last_user_time:
                                    try:
                                        diff = float(current_time) - float(last_user_time)
                                        if diff >= 0:
                                            tempos_resposta_segundos.append(diff)
                                    except (ValueError, TypeError):
                                        pass
                                last_user_time = None
            except (json.JSONDecodeError, TypeError):
                pass
                
    tempo_medio_atendimento = sum(tempos_atendimento_segundos) / len(tempos_atendimento_segundos) if tempos_atendimento_segundos else 0
    tempo_medio_resposta = sum(tempos_resposta_segundos) / len(tempos_resposta_segundos) if tempos_resposta_segundos else 0

    def formatar_tempo(segundos):
        if segundos == 0:
            return "—"
        
        if segundos < 60:
            return f"{int(segundos)}s"
        
        minutos_total = int(segundos // 60)
        segundos_rest = int(segundos % 60)
        
        if minutos_total < 60:
            if segundos_rest > 0:
                return f"{minutos_total}m {segundos_rest}s"
            return f"{minutos_total}m"
            
        horas_total = int(minutos_total // 60)
        minutos_rest = int(minutos_total % 60)
        
        if horas_total < 24:
            if minutos_rest > 0:
                return f"{horas_total}h {minutos_rest}m"
            return f"{horas_total}h"
            
        dias_total = int(horas_total // 24)
        horas_rest = int(horas_total % 24)
        
        if horas_rest > 0:
            return f"{dias_total}d {horas_rest}h"
        return f"{dias_total}d"

    # --- NOVO: Lógica para Atividade Recente ---
    # Busca o último atendimento atualizado no período para exibir no header.
    recent_activity_query = await db.execute(
        select(models.Atendimento)
        .where(
            models.Atendimento.company_id == company_id,
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
            "tempoMedioAtendimento": {
                "value": formatar_tempo(tempo_medio_atendimento),
                "label": "T. Médio de Atendimento"
            },
            "tempoMedioResposta": {
                "value": formatar_tempo(tempo_medio_resposta),
                "label": "Resposta Humana (Média)"
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
                "resumo": recent_activity.resumo
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
        # Define o tempo limite (10 segundos de debounce após a última mensagem)
        tempo_limite = datetime.now(timezone.utc) - timedelta(seconds=10)
        
        # Cria a consulta
        stmt = (
            select(models.Atendimento)
            .options(joinedload(models.Atendimento.company))
            .join(models.Company, models.Atendimento.company_id == models.Company.id)
            .where(
                models.Company.agent_running == True, # Filtra por empresas com agente ativo
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

async def get_atendimentos_for_followup(db: AsyncSession, company_id: int, earliest_time: datetime, latest_time: datetime) -> list[models.Atendimento]:
    """
    Busca atendimentos de uma empresa em 'Aguardando Resposta' dentro da janela de tempo para follow-up.
    """
    stmt = (
        select(models.Atendimento)
        .where(
            models.Atendimento.company_id == company_id,
            models.Atendimento.status == "Aguardando Resposta",
            models.Atendimento.updated_at < earliest_time,
            models.Atendimento.updated_at > latest_time
        )
        .options(joinedload(models.Atendimento.active_persona)) # Eager load persona
    )
    result = await db.execute(stmt)
    return result.scalars().unique().all()

async def get_atendimentos_by_status_and_inactivity(db: AsyncSession, company_id: int, status: str, days_inactive: int) -> List[models.Atendimento]:
    """Busca atendimentos com um status específico que não foram atualizados há X dias por empresa."""
    limit_date = datetime.now(timezone.utc) - timedelta(days=days_inactive)
    stmt = (
        select(models.Atendimento)
        .where(
            models.Atendimento.company_id == company_id,
            models.Atendimento.status == status,
            models.Atendimento.updated_at < limit_date
        )
    )
    result = await db.execute(stmt)
    return result.scalars().all()

async def delete_tag_from_all_atendimentos(db: AsyncSession, company_id: int, tag_name: str) -> int:
    """
    Remove uma tag pelo nome de todos os atendimentos da empresa especificada.
    Retorna o número de linhas afetadas.
    """
    try:
        # Usamos uma query SQL nativa para performance e atomicidade
        query = text("""
            UPDATE atendimentos
            SET tags = COALESCE(
                (
                    SELECT json_agg(elem)
                    FROM jsonb_array_elements(tags::jsonb) elem
                    WHERE elem->>'name' != CAST(:tag_name AS text)
                ),
                '[]'::json
            )
            WHERE company_id = :company_id
              AND tags IS NOT NULL
              AND tags::jsonb @> jsonb_build_array(jsonb_build_object('name', CAST(:tag_name AS text)))
        """)
        result = await db.execute(query, {"company_id": company_id, "tag_name": tag_name})
        return result.rowcount
    except Exception as e:
        logger.error(f"Erro ao excluir tag '{tag_name}' para a empresa {company_id}: {e}", exc_info=True)
        raise e

async def get_company_departments(db: AsyncSession, company_id: int) -> List[str]:
    """
    Retorna uma lista consolidada de setores/departamentos da empresa,
    obtidos a partir dos usuários cadastrados e atendimentos existentes.
    """
    try:
        # 1. Departamentos dos usuários
        stmt_users = select(models.User.department).where(
            models.User.company_id == company_id,
            models.User.department.isnot(None),
            models.User.department != ""
        ).distinct()
        res_users = await db.execute(stmt_users)
        user_depts = [d for d in res_users.scalars().all() if d and d.strip()]

        # 2. Departamentos dos atendimentos
        stmt_atend = select(models.Atendimento.assigned_department).where(
            models.Atendimento.company_id == company_id,
            models.Atendimento.assigned_department.isnot(None),
            models.Atendimento.assigned_department != ""
        ).distinct()
        res_atend = await db.execute(stmt_atend)
        atend_depts = [d for d in res_atend.scalars().all() if d and d.strip()]

        # Une e ordena sem duplicatas (mantendo a capitalização mais frequente / limpa)
        dept_dict = {}
        for d in user_depts + atend_depts:
            clean = d.strip()
            key = clean.lower()
            if key not in dept_dict:
                dept_dict[key] = clean

        return sorted(list(dept_dict.values()))
    except Exception as e:
        logger.error(f"Erro ao buscar departamentos para empresa {company_id}: {e}", exc_info=True)
        return []