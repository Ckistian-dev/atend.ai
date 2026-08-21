import ast
import operator
import logging
import pytz
import re
import uuid
import json
import asyncio
from datetime import datetime, time, timedelta, timezone
from typing import Dict, Any, List, Optional

from sqlalchemy import select
from app.graph.state import AgentState
from app.db import models
from app.db.database import SessionLocal
from app.crud import crud_atendimento
from app.services.google_calendar_service import get_google_calendar_service
from app.services.google_drive_service import get_drive_service
from app.services.gemini_service import get_gemini_service
from app.services.web_search_service import extrair_texto_bruto_url

logger = logging.getLogger(__name__)

# Operadores para cálculo matemático seguro
_MATH_OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}

def _eval_expr_node(node):
    if isinstance(node, ast.Expression):
        return _eval_expr_node(node.body)
    elif isinstance(node, ast.Constant):
        if isinstance(node.value, (int, float)):
            return node.value
        raise ValueError("Constantes não numéricas não permitidas.")
    elif isinstance(node, ast.BinOp):
        op_type = type(node.op)
        if op_type in _MATH_OPERATORS:
            return _MATH_OPERATORS[op_type](_eval_expr_node(node.left), _eval_expr_node(node.right))
        raise ValueError(f"Operador não suportado: {op_type}")
    elif isinstance(node, ast.UnaryOp):
        op_type = type(node.op)
        if op_type in _MATH_OPERATORS:
            return _MATH_OPERATORS[op_type](_eval_expr_node(node.operand))
        raise ValueError(f"Operador unário não suportado: {op_type}")
    else:
        raise ValueError(f"Expressão inválida: {type(node)}")

async def _obter_data_hora_atual() -> str:
    tz = pytz.timezone("America/Sao_Paulo")
    now = datetime.now(tz)
    dias_semana = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado", "Domingo"]
    dia_semana_str = dias_semana[now.weekday()]
    return f"Data e Hora Atual: {dia_semana_str}, {now.strftime('%d/%m/%Y às %H:%M:%S')} (Horário de Brasília)."

async def _executar_calculo_matematico(expressao: str) -> str:
    try:
        clean_exp = expressao.replace(",", ".").strip()
        parsed = ast.parse(clean_exp, mode='eval')
        res = _eval_expr_node(parsed.body)
        if isinstance(res, float) and res.is_integer():
            res = int(res)
        elif isinstance(res, float):
            res = round(res, 4)
        return f"Resultado exato do cálculo ({expressao}): {res}"
    except Exception as e:
        return f"Erro ao calcular '{expressao}': {e}"

async def _consultar_agenda(config_id: int, data_desejada: str = "hoje") -> str:
    async with SessionLocal() as db:
        persona = await db.get(models.Config, config_id)
        if not persona or not persona.is_calendar_active or not persona.google_calendar_credentials:
            return "O sistema de agendamento está desativado ou sem credenciais no momento."

    tz = pytz.timezone("America/Sao_Paulo")
    now_local = datetime.now(tz)
    data_str = data_desejada.strip().lower()
    target_date = now_local.date()

    if "amanhã" in data_str or "amanha" in data_str:
        target_date = now_local.date() + timedelta(days=1)
    elif "hoje" in data_str:
        target_date = now_local.date()
    else:
        match = re.search(r'(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?', data_str)
        if match:
            day, month = int(match.group(1)), int(match.group(2))
            year = int(match.group(3)) if match.group(3) else now_local.year
            if year < 100: year += 2000
            try:
                target_date = datetime(year, month, day).date()
            except ValueError:
                pass

    start_dt = tz.localize(datetime.combine(target_date, time.min))
    end_dt = tz.localize(datetime.combine(target_date, time.max))

    cal_service = get_google_calendar_service(persona)
    events = await asyncio.to_thread(
        cal_service.get_upcoming_events,
        max_results=50,
        time_min=start_dt.isoformat(),
        time_max=end_dt.isoformat()
    )

    horarios_ocupados = [e['start'].get('dateTime', e['start'].get('date')) for e in events] if events else []
    horario_trabalho = persona.available_hours or "Horário comercial padrão."

    return (
        f"Agenda para {target_date.strftime('%d/%m/%Y')} ({data_desejada}):\n"
        f"- Horários de Trabalho: {horario_trabalho}\n"
        f"- Horários Já Ocupados: {', '.join(horarios_ocupados) if horarios_ocupados else 'Nenhum'}\n"
        f"Instrução: Proponha 2 opções de horários livres dentro do expediente."
    )

async def _agendar_reuniao(config_id: int, atendimento_id: int, data_hora_iso: str, email_cliente: str) -> str:
    async with SessionLocal() as db:
        persona = await db.get(models.Config, config_id)
        atendimento = await db.get(models.Atendimento, atendimento_id)
        if not persona or not persona.google_calendar_credentials or not atendimento:
            return "Erro: Credenciais ou atendimento indisponíveis para agendamento."

    try:
        calendar_service = get_google_calendar_service(persona)
        service = calendar_service.get_service()

        dt_start = datetime.fromisoformat(data_hora_iso)
        dt_end = dt_start + timedelta(hours=1)

        event_body = {
            'summary': f'Reunião: {atendimento.nome_contato or atendimento.whatsapp}',
            'description': f'Agendado automaticamente pelo AtendAI.\nWhatsApp: {atendimento.whatsapp}',
            'start': {'dateTime': dt_start.isoformat(), 'timeZone': 'America/Sao_Paulo'},
            'end': {'dateTime': dt_end.isoformat(), 'timeZone': 'America/Sao_Paulo'},
            'attendees': [{'email': email_cliente.strip()}] if "@" in email_cliente else []
        }

        event = await asyncio.to_thread(
            lambda: service.events().insert(calendarId='primary', body=event_body, sendUpdates='all').execute()
        )
        link = event.get('hangoutLink')
        res_msg = f"Reunião agendada com sucesso para {data_hora_iso}."
        if link: res_msg += f" Link da videochamada: {link}"
        return res_msg
    except Exception as e:
        logger.error(f"Erro ao agendar reunião: {e}")
        return f"Erro ao agendar reunião: {e}"

async def _consultar_link(url: str, tenant_id: int, atendimento_id: int) -> str:
    try:
        dados_web = await extrair_texto_bruto_url(url)
        if not dados_web.get("sucesso"):
            return f"Não foi possível extrair o conteúdo do link {url}."

        texto_bruto = dados_web.get("texto_bruto", "")
        gemini_svc = get_gemini_service()
        async with SessionLocal() as db:
            company = await db.get(models.Company, tenant_id)
            resumo = await gemini_svc.analisar_e_sumarizar_conteudo_url(
                url=url,
                texto_bruto=texto_bruto,
                db_history=[],
                db=db,
                company=company,
                atendimento_id=atendimento_id
            )
            return f"Conteúdo analisado do link ({url}):\n{resumo}"
    except Exception as e:
        return f"Erro ao processar link {url}: {e}"

async def _atualizar_nome(atendimento_id: int, novo_nome: str) -> str:
    if not novo_nome or not str(novo_nome).strip():
        return "Nome inválido."
    clean_nome = str(novo_nome).strip()
    if clean_nome.lower() in ["null", "none", "não informado", "desconhecido", "cliente"]:
        return "Nome não fornecido."
    async with SessionLocal() as db:
        async with db.begin():
            at = await db.get(models.Atendimento, atendimento_id, with_for_update=True)
            if at:
                at.nome_contato = clean_nome
                return f"Nome do cliente registrado no CRM: '{clean_nome}'."
    return "Atendimento não encontrado."

async def _adicionar_tag(atendimento_id: int, tenant_id: int, nome_tag: str) -> str:
    if not nome_tag or not str(nome_tag).strip():
        return "Nome da tag não informado."
    nome_tag_clean = str(nome_tag).strip()
    async with SessionLocal() as db:
        tags_disponiveis = await crud_atendimento.get_all_user_tags(db, company_id=tenant_id)
        tag_match = next((t for t in tags_disponiveis if t['name'].lower() == nome_tag_clean.lower()), None)
        tag_nome_final = tag_match['name'] if tag_match else nome_tag_clean
        tag_color_final = tag_match['color'] if tag_match else '#3b82f6'

        async with db.begin():
            at = await db.get(models.Atendimento, atendimento_id, with_for_update=True)
            if at:
                current_tags = at.tags or []
                if not isinstance(current_tags, list):
                    current_tags = json.loads(current_tags) if isinstance(current_tags, str) else list(current_tags)
                found = False
                for t in current_tags:
                    if isinstance(t, dict) and t.get("name", "").strip().lower() == tag_nome_final.lower():
                        t["name"] = tag_nome_final
                        t["color"] = tag_color_final
                        found = True
                        break
                if not found:
                    current_tags.append({"name": tag_nome_final, "color": tag_color_final})
                at.tags = current_tags
                return f"Tag '{tag_nome_final}' aplicada com sucesso."
    return "Atendimento não encontrado."

async def _enviar_arquivo_do_drive(id_ou_termo: str, legenda: Optional[str], config_id: int, tenant_id: int, atendimento_id: int) -> str:
    if not id_ou_termo:
        return "Nenhum arquivo ou termo de busca informado para envio do Drive."
    
    from app.services.google_drive_service import get_drive_service
    from app.services.whatsapp_service import get_whatsapp_service
    from app.services.gemini_service import get_gemini_service
    import random

    try:
        kv_record = None
        real_file_id = None

        async with SessionLocal() as db_kv:
            # 1. Tenta por id_arquivo exato
            stmt_kv = select(models.KnowledgeVector).where(
                models.KnowledgeVector.config_id == config_id,
                models.KnowledgeVector.raw_data.op("->>")("id_arquivo") == id_ou_termo
            )
            res_kv = await db_kv.execute(stmt_kv)
            kv_record = res_kv.scalar_one_or_none()

            # 2. Se não encontrou por ID exato, faz busca semântica/textual nos arquivos do Drive
            if not kv_record:
                gemini_svc = get_gemini_service()
                query_emb = await gemini_svc.generate_embedding(id_ou_termo)
                
                if query_emb:
                    stmt_search = select(models.KnowledgeVector).where(
                        models.KnowledgeVector.config_id == config_id,
                        models.KnowledgeVector.origin == "drive"
                    ).order_by(
                        models.KnowledgeVector.embedding.cosine_distance(query_emb).asc()
                    ).limit(1)
                    res_search = await db_kv.execute(stmt_search)
                    kv_record = res_search.scalar_one_or_none()

                # Fallback por ILIKE no content ou raw_data
                if not kv_record:
                    stmt_like = select(models.KnowledgeVector).where(
                        models.KnowledgeVector.config_id == config_id,
                        models.KnowledgeVector.origin == "drive",
                        models.KnowledgeVector.content.ilike(f"%{id_ou_termo[:30]}%")
                    ).limit(1)
                    res_like = await db_kv.execute(stmt_like)
                    kv_record = res_like.scalar_one_or_none()

            if kv_record and kv_record.raw_data:
                real_file_id = kv_record.raw_data.get("id_arquivo")

        if not real_file_id:
            return f"Não foi possível localizar o arquivo '{id_ou_termo}' no Google Drive da empresa."

        drive_svc = get_drive_service()
        file_bytes = await asyncio.to_thread(drive_svc.download_file_bytes, real_file_id)
        if not file_bytes:
            return f"Não foi possível baixar os bytes do arquivo '{real_file_id}' do Google Drive."

        filename = kv_record.raw_data.get("nome_exato") or "arquivo"
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

        whatsapp_svc = get_whatsapp_service()
        async with SessionLocal() as db_send:
            company = await db_send.get(models.Company, tenant_id)
            atendimento = await db_send.get(models.Atendimento, atendimento_id)
            if not company or not atendimento:
                return "Empresa ou Atendimento não encontrado."

            logger.info(f"[Tools Node] Enviando mídia '{filename}' ({media_type}) do Drive para {atendimento.whatsapp}...")
            media_sent = await whatsapp_svc.send_media_message(
                company=company,
                number=atendimento.whatsapp,
                media_type=media_type,
                file_bytes=file_bytes,
                filename=filename,
                mimetype=mimetype,
                caption=legenda
            )
            media_msg_id = (media_sent.get("id") if isinstance(media_sent, dict) else None) or f"ai_media_{int(datetime.now().timestamp())}_{random.randint(100, 999)}"
            media_id_saved = (media_sent.get("media_id") if isinstance(media_sent, dict) else None) or media_msg_id

            await crud_atendimento.save_message(
                db=db_send,
                company_id=tenant_id,
                atendimento_id=atendimento_id,
                message_data={
                    "id": media_msg_id,
                    "role": "assistant",
                    "content": legenda or filename or "Mídia enviada",
                    "caption": legenda,
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
            await db_send.commit()

        return f"Arquivo '{filename}' ({media_type}) enviado com sucesso para o cliente no WhatsApp."

    except Exception as e:
        logger.error(f"[Tools Node] Erro ao enviar arquivo do drive: {e}", exc_info=True)
        return f"Erro ao enviar arquivo do Drive: {e}"

async def _transferir_para_atendente(atendimento_id: int, tenant_id: int, destinatario: Optional[str] = None, departamento: Optional[str] = None, motivo: Optional[str] = None) -> str:
    async with SessionLocal() as db:
        async with db.begin():
            at = await db.get(models.Atendimento, atendimento_id, with_for_update=True)
            if not at:
                return "Atendimento não encontrado."

            at.status = "Atendente Chamado"

            assigned_user_name = None
            if destinatario and str(destinatario).strip():
                dest_clean = str(destinatario).strip()
                users_res = await db.execute(
                    select(models.User).where(models.User.company_id == tenant_id)
                )
                company_users = list(users_res.scalars().all())

                matched_user = None
                for u in company_users:
                    u_name = (u.name or "").strip().lower()
                    u_email = (u.email or "").strip().lower()
                    if dest_clean.lower() in u_name or dest_clean.lower() in u_email or u_name in dest_clean.lower():
                        matched_user = u
                        break

                if matched_user:
                    at.assigned_user_id = matched_user.id
                    at.assigned_department = matched_user.department or departamento or at.assigned_department
                    assigned_user_name = matched_user.name or matched_user.email
                else:
                    if not departamento:
                        departamento = dest_clean

            if departamento and str(departamento).strip():
                at.assigned_department = str(departamento).strip()

            if motivo and str(motivo).strip():
                at.observacoes = f"{at.observacoes or ''}\n[Transbordo IA]: {motivo.strip()}".strip()

            db.add(at)

            target_str = f"ao atendente '{assigned_user_name}' (Setor: {at.assigned_department or 'Geral'})" if assigned_user_name else (f"ao setor '{at.assigned_department}'" if at.assigned_department else "à equipe de suporte")
            return f"Atendimento transferido com sucesso {target_str}."

async def tools_node(state: AgentState) -> Dict[str, Any]:
    """
    Nó 3: Execução assíncrona e segura de micro-ferramentas do sistema.

    @param state: Estado atual do grafo.
    @returns: Dicionário com resultados das ferramentas em 'tool_results'.
    """
    tool_name = state.get("tool_to_call")
    tool_args = state.get("tool_args") or {}
    config_id = state.get("config_id")
    tenant_id = state.get("tenant_id")
    atendimento_id = state.get("atendimento_id")

    logger.info(f"[Tools Node] Executando ferramenta '{tool_name}' com args: {tool_args}")

    resultado_str = ""
    extra_state_updates = {}
    try:
        if tool_name == "executar_calculo_matematico":
            exp = tool_args.get("expressao", "")
            resultado_str = await _executar_calculo_matematico(exp)

        elif tool_name == "consultar_agenda_google":
            data_desejada = tool_args.get("data_desejada", "hoje")
            resultado_str = await _consultar_agenda(config_id, data_desejada)

        elif tool_name == "agendar_reuniao":
            dt = tool_args.get("data_hora_iso", "")
            email = tool_args.get("email_cliente", "")
            resultado_str = await _agendar_reuniao(config_id, atendimento_id, dt, email)

        elif tool_name == "consultar_conteudo_link":
            url = tool_args.get("url", "")
            resultado_str = await _consultar_link(url, tenant_id, atendimento_id)

        elif tool_name == "obter_data_hora_atual":
            resultado_str = await _obter_data_hora_atual()

        elif tool_name == "atualizar_nome_contato":
            novo_nome = tool_args.get("novo_nome", "")
            resultado_str = await _atualizar_nome(atendimento_id, novo_nome)

        elif tool_name == "adicionar_tag_ao_cliente":
            nome_tag = tool_args.get("nome_da_tag", "")
            resultado_str = await _adicionar_tag(atendimento_id, tenant_id, nome_tag)

        elif tool_name == "transferir_para_atendente":
            dest = tool_args.get("destinatario") or tool_args.get("usuario") or tool_args.get("atendente") or tool_args.get("nome") or state.get("handoff_destinatario")
            dept = tool_args.get("departamento") or tool_args.get("setor")
            motivo = tool_args.get("motivo")
            resultado_str = await _transferir_para_atendente(atendimento_id, tenant_id, dest, dept, motivo)
            extra_state_updates["status_final"] = "Atendente Chamado"
            extra_state_updates["intent_handoff"] = True
            if dest: extra_state_updates["handoff_destinatario"] = dest
            if dept: extra_state_updates["handoff_department"] = dept
            if motivo: extra_state_updates["handoff_motivo"] = motivo

        elif tool_name == "enviar_arquivo_do_drive":
            id_ou_termo = (
                tool_args.get("id_arquivo") or 
                tool_args.get("file_id") or 
                tool_args.get("busca") or 
                tool_args.get("arquivo") or 
                tool_args.get("termo") or 
                tool_args.get("nome_arquivo") or 
                tool_args.get("query") or 
                state.get("user_input", "")
            )
            leg = tool_args.get("legenda") or tool_args.get("caption") or None
            resultado_str = await _enviar_arquivo_do_drive(str(id_ou_termo), leg, config_id, tenant_id, atendimento_id)

        else:
            resultado_str = f"Ferramenta '{tool_name}' executada com parâmetros {tool_args}."

    except Exception as e:
        logger.error(f"[Tools Node] Erro ao executar ferramenta {tool_name}: {e}", exc_info=True)
        resultado_str = f"Erro na execução da ferramenta {tool_name}: {e}"

    tool_result_item = {
        "tool_name": tool_name,
        "args": tool_args,
        "result": resultado_str
    }

    return {
        "tool_results": [tool_result_item],
        **extra_state_updates
    }
