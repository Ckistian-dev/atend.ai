import re
import json
import random
import asyncio
import logging
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from sqlalchemy import select

from app.graph.state import AgentState
from app.db import models
from app.db.database import SessionLocal
from app.crud import crud_atendimento
from app.services.whatsapp_service import get_whatsapp_service
from app.services.gemini_service import get_gemini_service

logger = logging.getLogger(__name__)

# Lock global para controle sequencial por atendimento
_output_locks: Dict[int, asyncio.Lock] = {}
_global_lock = asyncio.Lock()

MEDIA_TAG_REGEX = re.compile(r'\[(?:MEDIA|ARQUIVO|IMAGEM|DOC|FOTO|VIDEO):\s*([^\]]+)\]', re.IGNORECASE)
URL_REGEX = re.compile(
    r'(?:https?://[^\s]+|www\.[^\s]+|[a-zA-Z0-9_\-\.]+\.(?:com|br|org|net|io|me|site|store|shop|app|online)(?:/[^\s]*)?)',
    re.IGNORECASE
)
AUDIO_TAG_REGEX = re.compile(r'^\s*\[(?:AUDIO|ÁUDIO|VOZ)\]\s*', re.IGNORECASE)
TEXT_TAG_REGEX = re.compile(r'^\s*\[(?:TEXTO|TEXT)\]\s*', re.IGNORECASE)

async def _get_lock(atendimento_id: int) -> asyncio.Lock:
    async with _global_lock:
        if atendimento_id not in _output_locks:
            _output_locks[atendimento_id] = asyncio.Lock()
        return _output_locks[atendimento_id]


def build_delivery_queue(
    final_response: str, 
    media_file_ids: List[str],
    default_is_audio: bool = False,
    has_tts_voice: bool = False
) -> List[Dict[str, Any]]:
    """
    Constrói a fila unificada e ordenada de entrega (balões de áudio, texto e mídias intercaladas).
    Garante categoricamente que NENHUM link/URL seja enviado por áudio e NENHUM colchete de mídia vaze no texto.
    """
    queue: List[Dict[str, Any]] = []
    used_media_ids = set()

    linhas = [l.strip() for l in (final_response or "").split("\n") if l.strip()]

    def _process_text_chunk(chunk: str):
        if not chunk:
            return

        is_explicit_audio = bool(AUDIO_TAG_REGEX.match(chunk))
        is_explicit_text = bool(TEXT_TAG_REGEX.match(chunk))
        clean_chunk = AUDIO_TAG_REGEX.sub('', chunk)
        clean_chunk = TEXT_TAG_REGEX.sub('', clean_chunk)
        # Garante que nenhum resíduo de tag de mídia vaze como texto bruto
        clean_chunk = MEDIA_TAG_REGEX.sub('', clean_chunk).strip()

        # Descarta chunks vazios ou que contenham apenas pontuações isoladas
        if not clean_chunk or not re.search(r'[a-zA-Z0-9À-ÿ]', clean_chunk):
            return

        wants_audio = (is_explicit_audio or (default_is_audio and not is_explicit_text)) and has_tts_voice

        url_match = URL_REGEX.search(clean_chunk)
        if not wants_audio or not url_match:
            # Sem URL ou modo texto normal
            queue.append({
                "type": "audio" if wants_audio else "text",
                "content": clean_chunk
            })
            return

        # --- CASO CRÍTICO: Chunk quer áudio MAS contém URL ---
        # NUNCA sintetizar URL em áudio. Separar parte conversacional em áudio e URL em texto.
        url_start = url_match.start()
        url_end = url_match.end()
        text_before = clean_chunk[:url_start].strip()
        url_and_rest = clean_chunk[url_start:].strip()

        # Limpa conectivos do final do texto anterior (ex: " em:", " no link:", " acesse:")
        text_before_clean = re.sub(
            r'(\s+(?:em|no link|no site|acesse|acesse em|pelo link|no catálogo))\s*:?\s*$', 
            '', 
            text_before, 
            flags=re.IGNORECASE
        ).strip()

        if clean_chunk.endswith('?') and not text_before_clean.endswith(('?', '.', '!')):
            text_before_clean += '?'
        elif text_before_clean and not text_before_clean.endswith(('?', '.', '!')):
            text_before_clean += '.'

        if url_and_rest.endswith('?') and '=' not in url_and_rest:
            url_and_rest = url_and_rest.rstrip('?')
        elif url_and_rest.endswith('.') and not url_and_rest.endswith('..'):
            url_and_rest = url_and_rest.rstrip('.')

        if len(text_before_clean) >= 8:
            queue.append({"type": "audio", "content": text_before_clean})
            queue.append({"type": "text", "content": url_and_rest})
        else:
            queue.append({"type": "text", "content": clean_chunk})

    for l in linhas:
        # Se a linha contiver tags [MEDIA: id], decompõe respeitando a ordem
        parts = MEDIA_TAG_REGEX.split(l)
        if len(parts) > 1:
            # parts alterna entre [texto_antes, id_capturado, texto_depois, ...]
            is_match = False
            for chunk in parts:
                chunk = chunk.strip()
                if not chunk:
                    is_match = not is_match
                    continue
                if is_match:
                    queue.append({"type": "media", "file_id": chunk})
                    used_media_ids.add(chunk)
                else:
                    if len(chunk) > 250:
                        frases = [p.strip() for p in chunk.replace(". ", ".\n").replace("! ", "!\n").replace("? ", "?\n").split("\n") if p.strip()]
                        for f in frases:
                            _process_text_chunk(f)
                    else:
                        _process_text_chunk(chunk)
                is_match = not is_match
        else:
            if len(l) > 250:
                frases = [p.strip() for p in l.replace(". ", ".\n").replace("! ", "!\n").replace("? ", "?\n").split("\n") if p.strip()]
                for f in frases:
                    _process_text_chunk(f)
            else:
                _process_text_chunk(l)

    # Mídias adicionais em media_file_ids que não foram citadas com tag no texto vão ao final
    for f_id in (media_file_ids or []):
        f_id_clean = str(f_id).strip()
        if f_id_clean and f_id_clean not in used_media_ids:
            queue.append({"type": "media", "file_id": f_id_clean})
            used_media_ids.add(f_id_clean)

    return queue


async def output_node(state: AgentState) -> Dict[str, Any]:
    """
    Nó 7: Envio Sequencial de Mensagens e Mídias Intercaladas com Simulação de Digitação e Persistência no CRM.

    @param state: Estado final do grafo.
    @returns: Dicionário final do estado.
    """
    final_response = state.get("final_response") or state.get("draft_response") or ""
    atendimento_id = state.get("atendimento_id")
    tenant_id = state.get("tenant_id")
    resumo_crm = state.get("resumo_crm") or ""
    status_final = state.get("status_final") or "Aguardando Resposta"
    tts_voice = state.get("tts_voice")
    raw_media_ids = state.get("media_file_ids") or []
    if isinstance(raw_media_ids, str):
        raw_media_ids = [raw_media_ids]

    has_tts_voice = bool(tts_voice and str(tts_voice).strip() and str(tts_voice).strip().lower() not in ["none", "null", ""])
    send_as_audio = bool(state.get("send_as_audio"))

    delivery_queue = build_delivery_queue(
        final_response=final_response,
        media_file_ids=raw_media_ids,
        default_is_audio=send_as_audio,
        has_tts_voice=has_tts_voice
    )

    if not delivery_queue:
        logger.warning(f"[Output Node] Fila de entrega vazia para Atend {atendimento_id}. Nada a enviar.")
        return state

    whatsapp_svc = get_whatsapp_service()
    gemini_svc = get_gemini_service()

    last_processed_msg_id = state.get("last_processed_msg_id", 0)

    lock = await _get_lock(atendimento_id)
    async with lock:
        # 1. Carrega atendimento e empresa do banco
        async with SessionLocal() as db_read:
            atendimento = await db_read.get(models.Atendimento, atendimento_id)
            company = await db_read.get(models.Company, tenant_id)

            if not atendimento or not company:
                logger.error(f"[Output Node] Atendimento {atendimento_id} ou Empresa {tenant_id} não encontrado!")
                return state

            # Verificação imediata no banco antes de qualquer envio
            if last_processed_msg_id > 0 and await crud_atendimento.has_newer_user_messages(db_read, atendimento_id, tenant_id, last_processed_msg_id):
                logger.info(f"[Output Node] Nova mensagem do cliente detectada antes do início dos envios (Atend {atendimento_id}). Cancelando envio.")
                raise asyncio.CancelledError()

            destinatario_numero = atendimento.whatsapp

        # 2. Execução sequencial da fila de entrega (balões de áudio, texto e mídias intercaladas)
        total_items = len(delivery_queue)
        for idx, item in enumerate(delivery_queue):
            curr_task = asyncio.current_task()
            if curr_task and curr_task.cancelling() > 0:
                logger.info(f"[Output Node] Interrupção detectada antes do item #{idx+1}/{total_items}. Abortando envio.")
                raise asyncio.CancelledError()

            # Verificação de segurança no banco para novas mensagens e barramento cross-process
            async with SessionLocal() as db_check:
                if last_processed_msg_id > 0 and await crud_atendimento.has_newer_user_messages(db_check, atendimento_id, tenant_id, last_processed_msg_id):
                    logger.info(f"[Output Node] Nova mensagem do cliente detectada antes do item #{idx+1} (Atend {atendimento_id}). Cancelando envio.")
                    raise asyncio.CancelledError()

                at_chk = await db_check.get(models.Atendimento, atendimento_id)
                if at_chk and at_chk.status not in ["Gerando Resposta", "Mensagem Recebida"]:
                    logger.info(f"[Output Node] Status alterado para '{at_chk.status}'. Abortando envio.")
                    raise asyncio.CancelledError()

            # --- CASO A: ITEM É BALÃO DE ÁUDIO ---
            if item["type"] == "audio":
                balao = item["content"]
                # Trava absoluta contra URLs em áudio
                if URL_REGEX.search(balao):
                    item["type"] = "text"
                else:
                    chars_per_sec = random.uniform(0.08, 0.15)
                    recording_delay = min(max(len(balao) * chars_per_sec, 2.0), 10.0)
                    logger.info(f"[Output Node] Item #{idx+1}/{total_items} (Áudio): Simulando gravação por {recording_delay:.1f}s...")
                    await asyncio.sleep(recording_delay)

                    if curr_task and curr_task.cancelling() > 0:
                        raise asyncio.CancelledError()

                    async with SessionLocal() as db_check_post:
                        if last_processed_msg_id > 0 and await crud_atendimento.has_newer_user_messages(db_check_post, atendimento_id, tenant_id, last_processed_msg_id):
                            logger.info(f"[Output Node] Nova mensagem do cliente chegou durante processamento do áudio #{idx+1}. Cancelando envio.")
                            raise asyncio.CancelledError()

                    try:
                        audio_enviado = False
                        try:
                            logger.info(f"[Output Node] Gerando áudio via Gemini TTS (Voz: '{tts_voice}') para Atend {atendimento_id}...")
                            async with SessionLocal() as db_tts:
                                audio_bytes = await gemini_svc.generate_tts(
                                    text=balao,
                                    db=db_tts,
                                    company=company,
                                    atendimento_id=atendimento_id
                                )

                            if audio_bytes:
                                sent_info = await whatsapp_svc.send_media_message(
                                    company=company,
                                    number=destinatario_numero,
                                    media_type="audio",
                                    file_bytes=audio_bytes,
                                    filename="audio.ogg",
                                    mimetype="audio/ogg"
                                )

                                msg_id = (sent_info.get("id") if isinstance(sent_info, dict) and sent_info.get("id") else None) or f"ai_audio_{int(datetime.now().timestamp())}_{random.randint(100, 999)}"
                                media_id_saved = (sent_info.get("media_id") if isinstance(sent_info, dict) else None) or msg_id

                                async with SessionLocal() as db_write_audio:
                                    async with db_write_audio.begin():
                                        await crud_atendimento.save_message(
                                            db=db_write_audio,
                                            company_id=tenant_id,
                                            atendimento_id=atendimento_id,
                                            message_data={
                                                "id": msg_id,
                                                "role": "assistant",
                                                "content": balao,
                                                "timestamp": int(datetime.now().timestamp()),
                                                "type": "audio",
                                                "media_id": media_id_saved,
                                                "filename": "audio.ogg",
                                                "mime_type": "audio/ogg",
                                                "status": "sent",
                                                "is_ai": True
                                            },
                                            media_bytes=audio_bytes
                                        )
                                audio_enviado = True
                                logger.info(f"[Output Node] Áudio #{idx+1} enviado e salvo com sucesso no Atend {atendimento_id}.")
                        except Exception as tts_err:
                            logger.error(f"[Output Node] Falha ao gerar/enviar áudio via TTS: {tts_err}. Fallback para texto.", exc_info=True)

                        if not audio_enviado:
                            # Fallback para texto caso falhe
                            item["type"] = "text"

                    except asyncio.CancelledError:
                        raise
                    except Exception as send_err:
                        logger.error(f"[Output Node] Falha no envio do áudio #{idx+1}: {send_err}", exc_info=True)

            # --- CASO B: ITEM É BALÃO DE TEXTO ---
            if item["type"] == "text":
                balao = item["content"]
                chars_per_sec = random.uniform(0.05, 0.09)
                typing_delay = min(max(len(balao) * chars_per_sec, 1.2), 4.5)
                logger.info(f"[Output Node] Item #{idx+1}/{total_items} (Texto): Simulando digitação por {typing_delay:.1f}s...")
                await asyncio.sleep(typing_delay)

                if curr_task and curr_task.cancelling() > 0:
                    raise asyncio.CancelledError()

                async with SessionLocal() as db_check_post:
                    if last_processed_msg_id > 0 and await crud_atendimento.has_newer_user_messages(db_check_post, atendimento_id, tenant_id, last_processed_msg_id):
                        logger.info(f"[Output Node] Nova mensagem do cliente chegou durante processamento do texto #{idx+1}. Cancelando envio.")
                        raise asyncio.CancelledError()

                try:
                    sent_info = await whatsapp_svc.send_text_message(
                        company=company,
                        number=destinatario_numero,
                        text=balao
                    )

                    msg_id = (sent_info.get("id") if isinstance(sent_info, dict) and sent_info.get("id") else None) or f"ai_{int(datetime.now().timestamp())}_{random.randint(100, 999)}"

                    async with SessionLocal() as db_write:
                        async with db_write.begin():
                            await crud_atendimento.save_message(
                                db=db_write,
                                company_id=tenant_id,
                                atendimento_id=atendimento_id,
                                message_data={
                                    "id": msg_id,
                                    "role": "assistant",
                                    "content": balao,
                                    "timestamp": int(datetime.now().timestamp()),
                                    "status": "sent",
                                    "is_ai": True,
                                    "type": "text"
                                }
                            )
                    logger.info(f"[Output Node] Texto #{idx+1} enviado e salvo com sucesso no Atend {atendimento_id}.")
                except asyncio.CancelledError:
                    raise
                except Exception as send_err:
                    logger.error(f"[Output Node] Falha no envio do balão de texto #{idx+1}: {send_err}", exc_info=True)
                except asyncio.CancelledError:
                    raise
                except Exception as send_err:
                    logger.error(f"[Output Node] Falha no envio do balão #{idx+1}: {send_err}", exc_info=True)

            # --- CASO B: ITEM É UMA MÍDIA INTERCALADA (FOTO, VÍDEO, DOCUMENTO) ---
            elif item["type"] == "media":
                f_id = item["file_id"]
                if not f_id or not str(f_id).strip():
                    continue
                f_id = str(f_id).strip()

                logger.info(f"[Output Node] Item #{idx+1}/{total_items} (Mídia): Preparando download e envio do arquivo '{f_id}'...")

                try:
                    from app.services.google_drive_service import get_drive_service
                    drive_svc = get_drive_service()

                    real_drive_id = f_id
                    filename = "arquivo"
                    media_type = "document"
                    mimetype = "application/octet-stream"

                    async with SessionLocal() as db_kv:
                        stmt_kv = select(models.KnowledgeVector).where(
                            models.KnowledgeVector.config_id == state.get("config_id"),
                            models.KnowledgeVector.raw_data.op("->>")("id_arquivo") == f_id
                        )
                        res_kv = await db_kv.execute(stmt_kv)
                        kv_record = res_kv.scalar_one_or_none()

                        if not kv_record:
                            stmt_alt = select(models.KnowledgeVector).where(
                                models.KnowledgeVector.config_id == state.get("config_id"),
                                models.KnowledgeVector.origin == "drive",
                                (
                                    models.KnowledgeVector.raw_data.op("->>")("nome_exato").ilike(f"%{f_id}%") |
                                    models.KnowledgeVector.content.ilike(f"%{f_id}%")
                                )
                            ).limit(1)
                            res_alt = await db_kv.execute(stmt_alt)
                            kv_record = res_alt.scalar_one_or_none()

                        if kv_record and kv_record.raw_data:
                            real_drive_id = kv_record.raw_data.get("id_arquivo") or kv_record.raw_data.get("ID") or f_id
                            filename = kv_record.raw_data.get("nome_exato") or kv_record.raw_data.get("nome") or "arquivo"
                            raw_cat = (kv_record.category or "document").lower().strip()
                            mimetype = kv_record.raw_data.get("mime_type") or "application/octet-stream"

                            CATEGORY_TO_MEDIA_TYPE = {
                                "fotos": "image", "foto": "image", "imagens": "image", "imagem": "image", "image": "image",
                                "videos": "video", "video": "video", "vídeos": "video", "vídeo": "video",
                                "audios": "audio", "audio": "audio", "áudios": "audio", "áudio": "audio",
                            }
                            media_type = CATEGORY_TO_MEDIA_TYPE.get(raw_cat, "document")
                            if media_type == "document" and mimetype != "application/octet-stream":
                                if "image" in mimetype: media_type = "image"
                                elif "video" in mimetype: media_type = "video"
                                elif "audio" in mimetype: media_type = "audio"

                    if not kv_record and len(real_drive_id) < 15:
                        logger.warning(f"[Output Node] '{f_id}' não foi localizado no banco nem é um ID de arquivo do Google Drive válido. Ignorando.")
                        continue

                    file_bytes = await asyncio.to_thread(drive_svc.download_file_bytes, real_drive_id)
                    if not file_bytes:
                        logger.warning(f"[Output Node] Não foi possível baixar arquivo '{real_drive_id}' do Drive.")
                        continue

                    # Pausa curta realista antes de disparar o upload da imagem
                    await asyncio.sleep(1.0)

                    # Se for imagem, transcreve com Gemini Vision para manter histórico contextual
                    transcricao_imagem = ""
                    if media_type == "image" or ("image" in (mimetype or "")):
                        try:
                            async with SessionLocal() as db_vision:
                                transcricao_imagem = await gemini_svc.transcribe_and_analyze_media(
                                    media_data={"data": file_bytes, "mime_type": mimetype or "image/jpeg"},
                                    db_history=[],
                                    persona=None,
                                    db=db_vision,
                                    company=company,
                                    atendimento_id=atendimento_id
                                )
                        except Exception as vision_err:
                            logger.warning(f"[Output Node] Erro ao transcrever imagem enviada pela IA: {vision_err}")

                    msg_content = f"[Arquivo Enviado: {filename}]"
                    if transcricao_imagem and not transcricao_imagem.startswith("[Erro"):
                        msg_content += f"\n\n[Transcrição da Imagem Enviada pela IA]:\n{transcricao_imagem.strip()}"

                    logger.info(f"[Output Node] Enviando mídia do Drive '{filename}' ({media_type}) para {destinatario_numero}...")
                    media_sent = await whatsapp_svc.send_media_message(
                        company=company,
                        number=destinatario_numero,
                        media_type=media_type,
                        file_bytes=file_bytes,
                        filename=filename,
                        mimetype=mimetype,
                        caption=None
                    )
                    media_msg_id = (media_sent.get("id") if isinstance(media_sent, dict) else None) or f"ai_media_{int(datetime.now().timestamp())}_{random.randint(100, 999)}"
                    media_id_saved = (media_sent.get("media_id") if isinstance(media_sent, dict) else None) or media_msg_id

                    async with SessionLocal() as db_m:
                        async with db_m.begin():
                            await crud_atendimento.save_message(
                                db=db_m,
                                company_id=tenant_id,
                                atendimento_id=atendimento_id,
                                message_data={
                                    "id": media_msg_id,
                                    "role": "assistant",
                                    "content": msg_content,
                                    "caption": None,
                                    "timestamp": int(datetime.now().timestamp()),
                                    "status": "sent",
                                    "is_ai": True,
                                    "type": media_type,
                                    "media_id": media_id_saved,
                                    "filename": filename,
                                    "mime_type": mimetype
                                },
                                media_bytes=file_bytes
                            )
                    logger.info(f"[Output Node] Mídia '{filename}' enviada com sucesso.")
                except Exception as media_err:
                    logger.error(f"[Output Node] Erro ao enviar mídia {f_id}: {media_err}", exc_info=True)

        # 3. Atualização final do Atendimento (Resumo, Status, Nome do Contato e Tags)
        try:
            async with SessionLocal() as db_final:
                async with db_final.begin():
                    at_final = await db_final.get(models.Atendimento, atendimento_id, with_for_update=True)
                    if at_final:
                        has_newer_after_send = last_processed_msg_id > 0 and await crud_atendimento.has_newer_user_messages(
                            db_final, atendimento_id, tenant_id, last_processed_msg_id
                        )
                        if has_newer_after_send or at_final.status == "Mensagem Recebida":
                            logger.info(
                                f"[Output Node] Nova mensagem do cliente detectada após envio (Atend {atendimento_id}). "
                                f"Definindo status como 'Mensagem Recebida' para reprocessar a mensagem pendente imediatamente."
                            )
                            at_final.status = "Mensagem Recebida"
                        else:
                            at_final.status = status_final
                            # Garante que todas as mensagens processadas nesta resposta estejam visualizadas
                            try:
                                _, wamid_list_final = await crud_atendimento.mark_atendimento_messages_as_read(
                                    db=db_final,
                                    company_id=tenant_id,
                                    atendimento_id=atendimento_id
                                )
                                if wamid_list_final and company and company.wbp_phone_number_id:
                                    asyncio.create_task(whatsapp_svc.mark_messages_as_read_batch(company, wamid_list_final))
                            except Exception as read_post_err:
                                logger.warning(f"[Output Node] Erro ao sincronizar recibos de leitura pós-envio: {read_post_err}")

                        # Atribuição de Atendente / Setor no Transbordo
                        # Atribuição de Atendente / Setor no Transbordo
                        if status_final == "Atendente Chamado" or state.get("intent_handoff"):
                            destinatario = state.get("handoff_destinatario")
                            dept_override = state.get("handoff_department")
                            motivo = state.get("handoff_motivo")
                            team_members = state.get("team_members") or []

                            valid_dept_map = {}
                            valid_user_map = {}
                            for m in team_members:
                                m_name = (m.get("name") or "").strip()
                                m_email = (m.get("email") or "").strip()
                                m_dept = (m.get("department") or "").strip()
                                m_role = (m.get("role") or "").strip()
                                is_adm = m.get("is_admin") or m_role == "admin" or m_name.lower() in ["admin", "administrador"]

                                if m_dept and m_dept.lower() not in ["admin", "administrador"]:
                                    valid_dept_map[m_dept.lower()] = m_dept
                                if not is_adm:
                                    if m_name:
                                        valid_user_map[m_name.lower()] = m
                                    if m_email:
                                        valid_user_map[m_email.lower()] = m

                            assigned_user = None
                            resolved_dept = None

                            if destinatario and str(destinatario).strip():
                                dest_clean = str(destinatario).strip().lower()
                                if dest_clean not in ["admin", "administrador"]:
                                    # 1. Busca por correspondência de usuário cadastrado não-admin
                                    for key, u in valid_user_map.items():
                                        if dest_clean == key or dest_clean in key or key in dest_clean:
                                            assigned_user = u
                                            resolved_dept = u.get("department")
                                            break

                                    # 2. Se não encontrou usuário, busca por cargo/departamento cadastrado
                                    if not assigned_user:
                                        for key, dept_name in valid_dept_map.items():
                                            if dest_clean == key or dest_clean in key or key in dest_clean:
                                                resolved_dept = dept_name
                                                break

                            # Validação de dept_override caso exista
                            if not resolved_dept and dept_override and str(dept_override).strip():
                                dept_clean = str(dept_override).strip().lower()
                                if dept_clean not in ["admin", "administrador"]:
                                    for key, dept_name in valid_dept_map.items():
                                        if dept_clean == key or dept_clean in key or key in dept_clean:
                                            resolved_dept = dept_name
                                            break

                            # 3. Fallback seguro com base nos usuários cadastrados
                            if not assigned_user and not resolved_dept:
                                dist_users = [u for u in team_members if u.get("participates_distribution")]
                                if not dist_users:
                                    non_admin_users = [
                                        u for u in team_members
                                        if not u.get("is_admin")
                                        and u.get("role") != "admin"
                                        and (u.get("name") or "").strip().lower() not in ["admin", "administrador"]
                                    ]
                                    if non_admin_users:
                                        assigned_user = non_admin_users[0]
                                        resolved_dept = assigned_user.get("department")
                                    else:
                                        # Fallback silencioso para Admin quando não houver outro atendente
                                        first_admin = next((u for u in team_members if u.get("role") == "admin"), team_members[0] if team_members else None)
                                        if first_admin:
                                            assigned_user = first_admin

                            if assigned_user:
                                at_final.assigned_user_id = assigned_user.get("id")
                                if resolved_dept and resolved_dept.lower() not in ["admin", "administrador"]:
                                    at_final.assigned_department = resolved_dept
                                logger.info(f"[Output Node] Transbordo atribuído ao usuário ID {assigned_user.get('id')} ('{assigned_user.get('name')}')")
                            elif resolved_dept and resolved_dept.lower() not in ["admin", "administrador"]:
                                at_final.assigned_department = resolved_dept
                                logger.info(f"[Output Node] Transbordo atribuído ao cargo/setor cadastrado '{resolved_dept}'")

                            if motivo and str(motivo).strip():
                                at_final.observacoes = f"{at_final.observacoes or ''}\n[Transbordo IA]: {motivo.strip()}".strip()

                            # Distribuição igualitária para usuários que participam da distribuição
                            await crud_atendimento.distribute_atendimento(db_final, at_final)

                        if resumo_crm and resumo_crm.strip():
                            at_final.resumo = resumo_crm.strip()

                        novo_nome = state.get("novo_nome_cliente")
                        if novo_nome and str(novo_nome).strip():
                            at_final.nome_contato = str(novo_nome).strip()

                        tags_para_add = state.get("tags_para_adicionar") or []
                        tags_cadastradas = await crud_atendimento.get_all_user_tags(db_final, company_id=tenant_id)
                        tag_lookup = {
                            t['name'].strip().lower(): t 
                            for t in tags_cadastradas 
                            if isinstance(t, dict) and 'name' in t
                        }

                        tags_atuais = list(at_final.tags or [])
                        updated_tags = []
                        nomes_atuais = set()
                        modificado = False

                        for t in tags_atuais:
                            t_name = t.get("name") if isinstance(t, dict) else str(t)
                            t_color = t.get("color") if isinstance(t, dict) else None
                            if t_name and str(t_name).strip():
                                clean_name = str(t_name).strip()
                                key = clean_name.lower()
                                if key in tag_lookup:
                                    official_tag = tag_lookup[key]
                                    official_name = official_tag.get('name', clean_name)
                                    official_color = official_tag.get('color', t_color or '#3B82F6')
                                    if official_color != t_color or official_name != clean_name:
                                        modificado = True
                                    updated_tags.append({"name": official_name, "color": official_color})
                                else:
                                    updated_tags.append({"name": clean_name, "color": t_color or '#3B82F6'})
                                nomes_atuais.add(key)

                        if tags_para_add:
                            for tag in tags_para_add:
                                if tag and str(tag).strip():
                                    clean_tag = str(tag).strip()
                                    key = clean_tag.lower()
                                    if key not in nomes_atuais:
                                        if key in tag_lookup:
                                            official_tag = tag_lookup[key]
                                            updated_tags.append({
                                                "name": official_tag.get('name', clean_tag),
                                                "color": official_tag.get('color', '#3B82F6')
                                            })
                                        else:
                                            updated_tags.append({
                                                "name": clean_tag,
                                                "color": '#3B82F6'
                                            })
                                        nomes_atuais.add(key)
                                        modificado = True

                        if modificado:
                            at_final.tags = updated_tags

                        # --- PERSISTÊNCIA DO LOG ESTRUTURADO DE AUDITORIA DA IA NO BANCO ---
                        audit_trail = dict(state.get("ai_audit_trail") or {})
                        audit_trail["final_outcome"] = {
                            "status_final": status_final,
                            "final_response": final_response,
                            "intent_handoff": bool(state.get("intent_handoff")),
                            "intent_conclude": bool(state.get("intent_conclude")),
                            "total_retries": state.get("retry_count", 0),
                            "tokens": {
                                "input": state.get("input_tokens", 0),
                                "output": state.get("output_tokens", 0)
                            }
                        }

                        current_ai_logs = list(at_final.ai_logs or [])
                        current_ai_logs.append(audit_trail)
                        if len(current_ai_logs) > 100:
                            current_ai_logs = current_ai_logs[-100:]
                        at_final.ai_logs = current_ai_logs

            logger.info(f"[Output Node] Ciclo concluído com sucesso para o Atend {atendimento_id}. Status: '{status_final}' | Log da IA persistido em atendimentos.ai_logs.")

        except Exception as update_err:
            logger.error(f"[Output Node] Erro ao atualizar status/resumo do Atend {atendimento_id}: {update_err}", exc_info=True)


    return state
