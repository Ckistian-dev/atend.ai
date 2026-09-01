# app/services/conversa_migration.py

import logging
import json
import uuid
import time
from typing import List, Dict, Any, Optional, Tuple, Set
from datetime import datetime, timezone
from sqlalchemy import select, func, text, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from app.db import models

logger = logging.getLogger(__name__)

def parse_legacy_timestamp(ts: Any, fallback_dt: Optional[datetime] = None) -> datetime:
    """
    Converte qualquer formato legado de timestamp (int, float, string epoch em segundos ou ms,
    string ISO-8601, string de data formatada ou datetime) em um objeto datetime UTC timezone-aware.
    """
    if isinstance(ts, datetime):
        if ts.tzinfo is None:
            return ts.replace(tzinfo=timezone.utc)
        return ts.astimezone(timezone.utc)

    if isinstance(ts, (int, float)):
        val = float(ts)
        if val > 1e11:  # Timestamp em milissegundos
            val = val / 1000.0
        try:
            return datetime.fromtimestamp(val, tz=timezone.utc)
        except Exception:
            pass

    if isinstance(ts, str):
        val_str = ts.strip()
        if not val_str or val_str.lower() in ("null", "none", "undefined"):
            pass
        else:
            # Tenta converter string numérica (epoch)
            try:
                val_float = float(val_str)
                if val_float > 1e11:
                    val_float = val_float / 1000.0
                return datetime.fromtimestamp(val_float, tz=timezone.utc)
            except (ValueError, OverflowError):
                pass

            # Tenta parsing ISO 8601
            try:
                dt = datetime.fromisoformat(val_str.replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    return dt.replace(tzinfo=timezone.utc)
                return dt.astimezone(timezone.utc)
            except Exception:
                pass

            # Tenta formatos comuns de data e hora
            for fmt in (
                "%Y-%m-%d %H:%M:%S",
                "%Y-%m-%d %H:%M:%S.%f",
                "%Y-%m-%dT%H:%M:%S",
                "%Y-%m-%dT%H:%M:%S.%f",
                "%d/%m/%Y %H:%M:%S",
                "%d/%m/%Y %H:%M",
                "%Y/%m/%d %H:%M:%S"
            ):
                try:
                    dt = datetime.strptime(val_str, fmt)
                    return dt.replace(tzinfo=timezone.utc)
                except Exception:
                    continue

    if fallback_dt is not None:
        if fallback_dt.tzinfo is None:
            return fallback_dt.replace(tzinfo=timezone.utc)
        return fallback_dt.astimezone(timezone.utc)

    return datetime.now(timezone.utc)


def normalize_role(raw_role: Any) -> str:
    """Normaliza o papel do remetente."""
    if not raw_role or not isinstance(raw_role, str):
        return "user"
    r = raw_role.strip().lower()
    if r in ("user", "cliente", "client", "customer"):
        return "user"
    if r in ("assistant", "ia", "ai", "bot", "assistente", "atendente", "agent"):
        return "assistant"
    if r in ("system", "sistema"):
        return "system"
    return r[:50]


def normalize_legacy_message(
    msg_dict: Dict[str, Any],
    atendimento: models.Atendimento,
    index: int
) -> models.Message:
    """
    Mapeia um dicionário de mensagem legado para a entidade models.Message.
    """
    raw_id = msg_dict.get("message_id") or msg_dict.get("id")
    raw_id_str = str(raw_id).strip() if raw_id is not None else ""

    # Determina o message_id único
    if raw_id_str and raw_id_str.lower() not in ("none", "null", "undefined", ""):
        # Se for um WAMID ou ID com formato reconhecível, usa diretamente
        if raw_id_str.startswith("wamid.") or raw_id_str.startswith("msg_") or len(raw_id_str) > 10:
            msg_id = raw_id_str[:255]
        elif raw_id_str.isdigit():
            # ID puramente numérico vindo do JSON legado
            msg_id = f"legacy_{atendimento.id}_{raw_id_str}_{index}"[:255]
        else:
            msg_id = raw_id_str[:255]
    else:
        msg_id = f"legacy_{atendimento.id}_{index}_{uuid.uuid4().hex[:8]}"[:255]

    role = normalize_role(msg_dict.get("role"))
    msg_type = str(msg_dict.get("type") or "text").strip().lower()[:50]

    # Conteúdo / texto
    content = msg_dict.get("content")
    caption = msg_dict.get("caption")
    if content is not None:
        content_str = str(content)
    else:
        content_str = str(caption or msg_dict.get("filename") or "")

    ts = parse_legacy_timestamp(msg_dict.get("timestamp"), fallback_dt=atendimento.created_at)

    # Status
    status = msg_dict.get("status")
    if not status or not isinstance(status, str):
        status = "received" if role == "user" else "sent"
    else:
        status = status.strip()[:50]

    # Determina se é IA
    is_ai = bool(msg_dict.get("is_ai"))
    if not is_ai and role == "assistant" and msg_dict.get("is_ai") is not False:
        # Se papel for assistant e não for explicitamente falso, considera resposta do sistema/IA
        is_ai = True

    is_template = bool(msg_dict.get("is_template", False))

    media_url = msg_dict.get("url") or msg_dict.get("media_url")
    if media_url is not None:
        media_url = str(media_url)

    media_id = msg_dict.get("media_id")
    if media_id is not None:
        media_id = str(media_id)[:255]

    mime_type = msg_dict.get("mime_type")
    if mime_type is not None:
        mime_type = str(mime_type)[:150]

    filename = msg_dict.get("filename")
    if filename is not None:
        filename = str(filename)[:255]

    reaction = msg_dict.get("reaction")
    if reaction is not None:
        reaction = str(reaction)[:50]

    reactions = msg_dict.get("reactions") if isinstance(msg_dict.get("reactions"), dict) else None
    quoted_msg = msg_dict.get("quoted_msg") if isinstance(msg_dict.get("quoted_msg"), dict) else None
    quoted_msg_id = msg_dict.get("quoted_msg_id")
    if quoted_msg_id is not None:
        quoted_msg_id = str(quoted_msg_id)[:255]

    buttons = msg_dict.get("buttons") if isinstance(msg_dict.get("buttons"), list) else None
    extra_data = msg_dict.get("extra_data") if isinstance(msg_dict.get("extra_data"), dict) else None

    return models.Message(
        company_id=atendimento.company_id,
        atendimento_id=atendimento.id,
        message_id=msg_id,
        role=role,
        type=msg_type,
        content=content_str,
        caption=str(caption) if caption is not None else None,
        timestamp=ts,
        message_date=ts,
        status=status,
        error_code=str(msg_dict.get("error_code"))[:50] if msg_dict.get("error_code") else None,
        error_title=str(msg_dict.get("error_title")) if msg_dict.get("error_title") else None,
        media_id=media_id,
        media_url=media_url,
        mime_type=mime_type,
        filename=filename,
        reaction=reaction,
        reactions=reactions,
        quoted_msg_id=quoted_msg_id,
        quoted_msg=quoted_msg,
        is_ai=is_ai,
        is_template=is_template,
        buttons=buttons,
        extra_data=extra_data,
        created_at=ts
    )


async def migrate_legacy_conversations_for_session(
    db: AsyncSession,
    dry_run: bool = False,
    company_id: Optional[int] = None,
    batch_size: int = 100
) -> Dict[str, Any]:
    """
    Executa a migração de todas as conversas legadas do campo 'conversa' da tabela 'atendimentos'
    para a tabela 'mensagens'.
    
    A operação é completamente IDEMPOTENTE: mensagens que já existem na tabela 'mensagens'
    (identificadas por message_id ou pela assinatura de conteúdo/tempo) são preservadas e não duplicadas.
    """
    start_time = time.time()
    stats = {
        "atendimentos_total": 0,
        "atendimentos_com_conversa": 0,
        "mensagens_migradas": 0,
        "mensagens_ja_existentes": 0,
        "mensagens_invalidas": 0,
        "erros": 0,
        "dry_run": dry_run,
        "elapsed_seconds": 0.0
    }

    # Query para buscar atendimentos que possuem conteúdo no campo 'conversa'
    query = select(models.Atendimento).where(
        models.Atendimento.conversa.isnot(None),
        models.Atendimento.conversa != "[]",
        models.Atendimento.conversa != ""
    )

    if company_id is not None:
        query = query.where(models.Atendimento.company_id == company_id)

    query = query.order_by(models.Atendimento.id.asc())

    res = await db.execute(query)
    atendimentos = res.scalars().all()
    stats["atendimentos_total"] = len(atendimentos)

    logger.info(f"[Migração de Conversas] Encontrados {len(atendimentos)} atendimentos com histórico legado para processar (dry_run={dry_run}).")

    for atendimento in atendimentos:
        try:
            raw_conversa = atendimento.conversa
            if not raw_conversa or raw_conversa.strip() in ("", "[]", "null"):
                continue

            if isinstance(raw_conversa, str):
                try:
                    msgs_list = json.loads(raw_conversa)
                except Exception as parse_err:
                    logger.warning(f"Atendimento ID {atendimento.id}: JSON de conversa inválido ignorado: {parse_err}")
                    stats["erros"] += 1
                    continue
            elif isinstance(raw_conversa, list):
                msgs_list = raw_conversa
            else:
                continue

            if not isinstance(msgs_list, list) or len(msgs_list) == 0:
                continue

            stats["atendimentos_com_conversa"] += 1

            # Busca todas as mensagens já existentes neste atendimento na tabela 'mensagens'
            existing_msgs_res = await db.execute(
                select(models.Message).where(models.Message.atendimento_id == atendimento.id)
            )
            existing_msgs = existing_msgs_res.scalars().all()

            existing_msg_ids: Set[str] = {m.message_id for m in existing_msgs if m.message_id}
            # Assinatura de conteúdo: (role, content_prefix, type, timestamp_second)
            existing_signatures: Set[Tuple[str, str, str, int]] = set()
            for m in existing_msgs:
                ts_sec = int(m.timestamp.timestamp()) if m.timestamp else 0
                content_prefix = (m.content or m.caption or "")[:100].strip()
                existing_signatures.add((m.role, content_prefix, m.type, ts_sec))
                # Também adiciona variações de +- 2 segundos para tolerância de arredondamento
                existing_signatures.add((m.role, content_prefix, m.type, ts_sec - 1))
                existing_signatures.add((m.role, content_prefix, m.type, ts_sec + 1))

            new_messages_to_insert: List[models.Message] = []

            for idx, msg_item in enumerate(msgs_list):
                if not isinstance(msg_item, dict):
                    stats["mensagens_invalidas"] += 1
                    continue

                msg_model = normalize_legacy_message(msg_item, atendimento, idx)

                # Verifica se o message_id exato já existe
                if msg_model.message_id in existing_msg_ids:
                    stats["mensagens_ja_existentes"] += 1
                    continue

                # Verifica se a assinatura composta (role, content, type, timestamp) já existe
                ts_sec = int(msg_model.timestamp.timestamp())
                content_prefix = (msg_model.content or msg_model.caption or "")[:100].strip()
                sig = (msg_model.role, content_prefix, msg_model.type, ts_sec)

                if sig in existing_signatures:
                    stats["mensagens_ja_existentes"] += 1
                    continue

                # Mensagem inédita!
                new_messages_to_insert.append(msg_model)
                existing_msg_ids.add(msg_model.message_id)
                existing_signatures.add(sig)

            if new_messages_to_insert:
                stats["mensagens_migradas"] += len(new_messages_to_insert)
                if not dry_run:
                    db.add_all(new_messages_to_insert)
                    await db.flush()

        except Exception as e:
            logger.error(f"[Migração de Conversas] Erro ao processar Atendimento ID {atendimento.id}: {e}", exc_info=True)
            stats["erros"] += 1

    if not dry_run and stats["mensagens_migradas"] > 0:
        await db.commit()
        logger.info(f"[Migração de Conversas] Commit realizado com sucesso. {stats['mensagens_migradas']} mensagens migradas.")

    stats["elapsed_seconds"] = round(time.time() - start_time, 3)
    logger.info(
        f"[Migração de Conversas Concluída] "
        f"Atendimentos: {stats['atendimentos_total']} | "
        f"Com conversa: {stats['atendimentos_com_conversa']} | "
        f"Migradas: {stats['mensagens_migradas']} | "
        f"Já existentes (puladas): {stats['mensagens_ja_existentes']} | "
        f"Erros: {stats['erros']} | "
        f"Tempo: {stats['elapsed_seconds']}s"
    )
    return stats
