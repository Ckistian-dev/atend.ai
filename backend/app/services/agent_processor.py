import asyncio
import json
import logging
import math
import os
from typing import Dict, List, Any, Optional
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload
from sqlalchemy.future import select

from app.db.database import SessionLocal
from app.crud import crud_atendimento, crud_config, crud_user
from app.db import models
from app.graph.state import AgentState
from app.graph.workflow import run_agent_workflow
from app.services.gemini_service import get_gemini_service
from app.services.google_calendar_service import get_google_calendar_service
from app.services.agent_service import TABELA_PRECOS, BASE_FLASH_PRICE
from app.services.whatsapp_service import get_whatsapp_service

try:
    from langgraph.errors import NodeCancelledError
except ImportError:
    class NodeCancelledError(Exception):
        pass

logger = logging.getLogger(__name__)

# Dicionário global para controlar e permitir cancelamento de tasks ativas
_active_processing_tasks: Dict[int, asyncio.Task] = {}

def cancel_active_atendimento_task(atendimento_id: int) -> bool:
    """
    Interrompe a task de IA em andamento para o atendimento_id fornecido se ela estiver rodando.
    Retorna True se uma task ativa foi cancelada, False caso contrário.
    """
    task = _active_processing_tasks.get(atendimento_id)
    if task and not task.done():
        logger.info(f"[Barramento] Interrompendo task de IA ativa para Atendimento ID {atendimento_id} devido a nova mensagem.")
        task.cancel()
        return True
    return False

def build_prompt_from_persona_form(persona_form: Any) -> str:
    """
    Converte os dados estruturados do formulário da Aba Persona em um System Prompt limpo.
    """
    if not persona_form:
        return ""
    if isinstance(persona_form, str):
        return persona_form.strip()
    if not isinstance(persona_form, dict):
        return ""

    lines = []

    # Seção 1: Identidade
    ai_name = str(persona_form.get("ai_name") or "").strip()
    company_name = str(persona_form.get("company_name") or "").strip()
    role = str(persona_form.get("role") or "").strip()
    language = str(persona_form.get("language") or "Português (BR)").strip()
    nature_identity = str(persona_form.get("nature_identity") or "human").strip().lower()

    identity_parts = []
    if ai_name: identity_parts.append(f"Nome da IA / Atendente: {ai_name}")
    if company_name: identity_parts.append(f"Empresa / Marca: {company_name}")
    if role: identity_parts.append(f"Função / Cargo: {role}")
    if language: identity_parts.append(f"Idioma: {language}")

    if nature_identity == "ai":
        identity_parts.append("Natureza da Identidade: IA (Transparente)")
        identity_parts.append("Postura: Você é abertamente uma inteligência artificial assistente. Se o cliente perguntar se é IA/robô, confirme com simpatia e presteza.")
        identity_parts.append("Postura de Transbordo: Ao transferir para atendimento humano, informe com clareza e de forma direta que está transferindo o atendimento para nossa equipe. 🚨 NUNCA use o nome do PRÓPRIO CLIENTE na mensagem de transferência (ex: nunca diga 'vou te passar para [Nome do Cliente]'). Use sempre 'a nossa equipe'.")
    elif nature_identity == "ignore":
        identity_parts.append("Natureza da Identidade: Neutra / Evasiva")
        identity_parts.append("Postura: Se o cliente perguntar se você é um robô/IA, desvie educadamente mantendo o foco total em ajudar com o atendimento, sem confirmar nem negar.")
        identity_parts.append("Postura de Transbordo: Ao transferir, use termos neutros da equipe (ex: 'Vou direcionar seu atendimento para a nossa equipe dar continuidade por aqui...'), sem enfatizar humano vs robô, sem inventar cargos inexistentes e 🚨 NUNCA use o nome do próprio cliente como atendente.")
    else:  # "human" (padrão)
        identity_parts.append("Natureza da Identidade: HUMANA (Atendente Real da Empresa)")
        identity_parts.append("Postura: Você deve agir, falar e se comportar EXATAMENTE como um atendente humano real da empresa. NUNCA diga, insinue ou admita que é uma IA, robô, bot ou assistente virtual.")
        identity_parts.append("Postura de Transbordo: NUNCA use termos como 'atendente humano', 'equipe humana' ou 'transferir para um humano'. Fale naturalmente de colega para colega como alguém da equipe: 'Vou te passar aqui para um colega da equipe dar continuidade', 'Só um instante que vou transferir para nossa equipe te atender'. 🚨 NUNCA use o nome do PRÓPRIO CLIENTE como atendente (ex: NUNCA diga 'vou te passar para o [Nome do Cliente]'). NUNCA invente cargos ou setores que não existam na equipe cadastrada e NUNCA inicie com 'Entendido!' ou 'Com certeza!'.")


    if identity_parts:
        lines.append("## IDENTIDADE DA PERSONA")
        lines.extend([f"- {p}" for p in identity_parts])
        lines.append("")

    # Seção 2: Tom de Voz
    style_parts = []
    formality = persona_form.get("formality")
    if formality is not None:
        try:
            f_val = float(formality)
            if f_val <= 0.3: style_parts.append("Formalidade: FORMAL - Linguagem culta e profissional.")
            elif f_val >= 0.7: style_parts.append("Formalidade: INFORMAL - Linguagem leve e próxima.")
            else: style_parts.append("Formalidade: SEMI-FORMAL - Equilíbrio profissional e acolhedor.")
        except Exception: pass

    objectivity = persona_form.get("objectivity")
    if objectivity is not None:
        try:
            o_val = float(objectivity)
            if o_val <= 0.3: style_parts.append("Objetividade: DIRETO - Mensagens concisas e diretas.")
            elif o_val >= 0.7: style_parts.append("Objetividade: DETALHADO - Explicações completas.")
            else: style_parts.append("Objetividade: MODERADO - Nível ideal de detalhes.")
        except Exception: pass

    qualities = persona_form.get("qualities")
    if qualities:
        q_str = ", ".join(qualities) if isinstance(qualities, list) else str(qualities)
        style_parts.append(f"Atributos: {q_str}")

    style_parts.append("Naturalidade no WhatsApp: Converse como uma pessoa real no chat. NUNCA use interjeições robóticas de confirmação ('Entendido!', 'Isso mesmo!', 'Perfeito!', 'Com certeza!') e NUNCA repita saudações ('Oi!', 'Tudo bem?') se a conversa já estiver em andamento. Vá direto ao assunto.")
    style_parts.append("Resiliência e Prioridade de Transbordo: Se houver regra específica da empresa/persona determinando transferência para determinado assunto (ex: cancelamentos, reclamações formais), transfira imediatamente sem hesitar. Em casos gerais, seja resiliente e não sugira transferência sem motivo. Se o cliente pedir atendente de forma genérica, ofereça ajuda por aqui e transfira apenas após confirmação. NUNCA transfira o atendimento no primeiro contato, em dúvidas de produtos/serviços, em pedidos de orçamento, nem quando o cliente responder 'Sim', 'Quero', 'Pode ser', 'Isso', 'Ok' ou escolher uma opção/plano/item em resposta a uma pergunta da IA. Prossiga sempre o atendimento com a IA e avance no diálogo.")


    if style_parts:
        lines.append("## TOM DE VOZ E COMUNICAÇÃO")
        lines.extend([f"- {s}" for s in style_parts])
        lines.append("")

    # Seção 3: Missão
    objective = str(persona_form.get("objective") or "").strip()
    if objective:
        lines.append("## MISSÃO E OBJETIVO")
        lines.append(objective)
        lines.append("")

    # Seção 4: Regras e Restrições
    restrictions = persona_form.get("restrictions")
    if restrictions:
        r_list = restrictions if isinstance(restrictions, list) else [restrictions]
        lines.append("## REGRAS E RESTRIÇÕES")
        lines.extend([f"- {r}" for r in r_list if str(r).strip()])
        lines.append("")

    handoff_rules = persona_form.get("handoff_rules")
    if handoff_rules:
        h_list = handoff_rules if isinstance(handoff_rules, list) else [handoff_rules]
        lines.append("## REGRAS DE TRANSBORDO")
        lines.extend([f"- {h}" for h in h_list if str(h).strip()])
        lines.append("")

    # Seção 5: Instruções Adicionais
    extra = str(persona_form.get("extra_instructions") or "").strip()
    if extra:
        lines.append("## INSTRUÇÕES ADICIONAIS")
        lines.append(extra)
        lines.append("")

    return "\n".join(lines).strip()

async def process_single_atendimento(atendimento_id: int, company: models.Company):
    """
    Controla o ciclo assíncrono de processamento por atendimento evitando concorrência.
    """
    current_task = asyncio.current_task()
    existing_task = _active_processing_tasks.get(atendimento_id)

    if existing_task and not existing_task.done():
        logger.warning(f"Atendimento {atendimento_id} já está em processamento ativo. Pulando.")
        return

    if current_task:
        _active_processing_tasks[atendimento_id] = current_task

    try:
        await _process_single_atendimento_inner(atendimento_id, company)
    finally:
        if _active_processing_tasks.get(atendimento_id) == current_task:
            _active_processing_tasks.pop(atendimento_id, None)

async def _process_single_atendimento_inner(atendimento_id: int, company: models.Company):
    """
    Orquestra a execução do Grafo LangGraph para um atendimento.
    """
    logger.info(f"[LangGraph Agente] Iniciando Atendimento ID: {atendimento_id} | Empresa: {company.id}")
    gemini_service = get_gemini_service()

    try:
        # --- PASSO 1: BLOQUEIO E MARCAÇÃO DE STATUS ---
        marked_generating = False
        async with SessionLocal() as db_mark:
            async with db_mark.begin():
                atendimento = await db_mark.get(models.Atendimento, atendimento_id, with_for_update=True)
                if atendimento and atendimento.status in ["Mensagem Recebida"]:
                    atendimento.status = "Gerando Resposta"
                    atendimento.updated_at = datetime.now(timezone.utc)
                    marked_generating = True
                else:
                    logger.warning(f"Atendimento {atendimento_id} não elegível para processamento (status: {atendimento.status if atendimento else 'None'}).")
                    return

        if not marked_generating:
            return

        # --- PASSO 2: COLETA DE CONTEXTO E CONFIGURAÇÃO ---
        async with SessionLocal() as db_ctx:
            # Visualização automática de mensagens pela IA: marca como lida no banco e envia tiques azuis à Meta
            try:
                _, wamid_list = await crud_atendimento.mark_atendimento_messages_as_read(
                    db=db_ctx,
                    company_id=company.id,
                    atendimento_id=atendimento_id
                )
                await db_ctx.commit()

                if wamid_list and company and company.wbp_phone_number_id:
                    whatsapp_svc = get_whatsapp_service()
                    asyncio.create_task(whatsapp_svc.mark_messages_as_read_batch(company, wamid_list))
                    logger.info(f"[LangGraph Agente] {len(wamid_list)} mensagem(ns) marcada(s) como visualizada(s)/lida(s) pela IA no Atendimento ID {atendimento_id}.")
            except Exception as read_err:
                logger.warning(f"[LangGraph Agente] Falha ao marcar mensagens como lidas pela IA (Atend {atendimento_id}): {read_err}")

            atendimento_ctx = await db_ctx.get(
                models.Atendimento,
                atendimento_id,
                options=[joinedload(models.Atendimento.active_persona)]
            )
            if not atendimento_ctx:
                raise ValueError("Atendimento não encontrado.")

            persona_config = atendimento_ctx.active_persona
            if not persona_config and company.default_persona_id:
                persona_config = await crud_config.get_config(db_ctx, company.default_persona_id, company.id)

            if not persona_config:
                raise ValueError(f"Nenhuma persona configurada para a empresa {company.id}.")

            msgs_db = await crud_atendimento.get_messages_for_atendimento(db_ctx, atendimento_id, company.id)
            last_processed_msg_id = max([m.id for m in msgs_db]) if msgs_db else 0
            conversation_history = [
                {
                    "id": m.message_id,
                    "role": m.role,
                    "content": m.content or "",
                    "caption": m.caption or "",
                    "timestamp": int(m.timestamp.timestamp()) if m.timestamp else 0,
                    "type": m.type,
                    "is_ai": m.is_ai,
                    "reaction": m.reaction
                }
                for m in msgs_db
                if m.type != 'reaction'
            ]
            conversation_history.sort(key=lambda x: x.get('timestamp') or 0)

            available_tags = await crud_atendimento.get_all_user_tags(db_ctx, company_id=company.id)
            available_tags_names = [t['name'] for t in available_tags]

            current_tags_raw = atendimento_ctx.tags or []
            if isinstance(current_tags_raw, str):
                try:
                    current_tags_raw = json.loads(current_tags_raw)
                except Exception:
                    current_tags_raw = []
            current_tags_names = [t['name'] if isinstance(t, dict) and 'name' in t else str(t) for t in current_tags_raw]

            workflow_context = gemini_service._format_workflow_to_markdown(persona_config.workflow_json)

            # Coleta de atendentes e setores da empresa
            users_stmt = select(models.User).where(models.User.company_id == company.id)
            users_res = await db_ctx.execute(users_stmt)
            company_users = list(users_res.scalars().all())

            team_members = []
            team_lines = []
            registered_depts = set()
            for u in company_users:
                u_name = (u.name or u.email.split('@')[0]).strip()
                raw_dept = (u.department or '').strip()
                u_dept = raw_dept if raw_dept else ('Atendimento Geral' if u.role != 'admin' else '')
                
                is_admin = u.role == 'admin' or u_name.lower() in ['admin', 'administrador'] or raw_dept.lower() in ['admin', 'administrador']
                
                team_members.append({
                    "id": u.id,
                    "name": u_name,
                    "email": u.email,
                    "department": u_dept,
                    "role": u.role,
                    "participates_distribution": bool(u.participates_distribution),
                    "is_admin": is_admin
                })
                
                # Apenas atendentes e setores públicos reais são expostos no prompt da IA
                if not is_admin:
                    if u_dept and u_dept.lower() not in ['admin', 'administrador']:
                        registered_depts.add(u_dept)
                    team_lines.append(f"- Atendente: {u_name} | Cargo/Setor: {u_dept or 'Atendimento Geral'}")

            depts_formatted = ", ".join([f"'{d}'" for d in sorted(registered_depts)]) if registered_depts else "Nenhum cargo específico cadastrado"
            team_lines_str = "\n".join(team_lines) if team_lines else "- Nenhum atendente específico cadastrado (atendimento geral pela equipe)"

            company_team_info = (
                f"Setores: [{depts_formatted}] | Atendentes: {team_lines_str}\n"
                f"- Transbordo restrito aos setores/atendentes acima. NUNCA use o nome do PRÓPRIO CLIENTE no transbordo nem mencione 'Admin'. Use 'nossa equipe'."
            )



        # --- PASSO 3: RESOLUÇÃO DE CALENDÁRIO ---
        calendar_context = ""
        if persona_config.is_calendar_active and persona_config.available_hours:
            booked_events_str = ""
            if persona_config.google_calendar_credentials:
                try:
                    cal_service = get_google_calendar_service(persona_config)
                    events = await asyncio.to_thread(cal_service.get_upcoming_events)
                    if events:
                        booked_list = [f"- {e['start'].get('dateTime', e['start'].get('date'))}" for e in events]
                        booked_events_str = "\n# HORÁRIOS JÁ OCUPADOS (NÃO AGENDAR NESTES)\n" + "\n".join(booked_list) + "\n"
                except Exception as cal_err:
                    logger.error(f"Erro ao carregar eventos da agenda: {cal_err}")

            calendar_context = f"\n# DISPONIBILIDADE DE AGENDA\n- Horários de Trabalho: {persona_config.available_hours}\n{booked_events_str}"

        # --- PASSO 4: RESOLUÇÃO DE PERSONA PROMPT ---
        persona_form_data = getattr(persona_config, 'persona_form', None)
        persona_from_tab = build_prompt_from_persona_form(persona_form_data) if persona_form_data else ""
        has_spreadsheet_id = bool(persona_config.spreadsheet_id and str(persona_config.spreadsheet_id).strip())
        instructions_page_prompt = (persona_config.prompt or "").strip() if has_spreadsheet_id else ""

        if persona_from_tab and instructions_page_prompt:
            persona_prompt_resolved = f"{persona_from_tab}\n\n## INSTRUÇÕES COMPLEMENTARES (FALLBACK)\n{instructions_page_prompt}"
        elif persona_from_tab:
            persona_prompt_resolved = persona_from_tab
        elif instructions_page_prompt:
            persona_prompt_resolved = instructions_page_prompt
        else:
            persona_prompt_resolved = "Você é um assistente virtual útil e profissional."

        # Extrai a última mensagem consolidada do cliente
        user_msgs_tail = []
        idx_split = len(conversation_history)
        while idx_split > 0 and conversation_history[idx_split - 1].get("role") in ["user", "client"]:
            idx_split -= 1
            msg_item = conversation_history[idx_split]
            c_text = str(msg_item.get("content") or "").strip()
            caption = str(msg_item.get("caption") or "").strip()
            if caption and caption not in c_text:
                c_text = f"{c_text}\n[Legenda: {caption}]".strip() if c_text else f"[Legenda: {caption}]"
            if c_text:
                user_msgs_tail.insert(0, c_text)

        ultima_mensagem = "\n".join(user_msgs_tail) if user_msgs_tail else "Olá"

        # Data e hora atual formatada em horário local de Brasília
        import pytz
        tz_br = pytz.timezone("America/Sao_Paulo")
        now_br = datetime.now(tz_br)
        dias_semana = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado", "Domingo"]
        data_hora_atual_str = f"{dias_semana[now_br.weekday()]}, {now_br.strftime('%d/%m/%Y às %H:%M:%S')} (Horário de Brasília)"

        # --- PASSO 5: MONTAGEM DO ESTADO DO LANGGRAPH ---
        ai_model_to_use = persona_config.ai_model or "gemini-3.5-flash-lite"

        nature_id_val = "human"
        if isinstance(persona_form_data, dict):
            nature_id_val = str(persona_form_data.get("nature_identity") or "human").strip().lower()

        initial_state: AgentState = {
            "tenant_id": company.id,
            "config_id": persona_config.id,
            "atendimento_id": atendimento_id,
            "user_input": ultima_mensagem,
            "conversation_history": conversation_history[:idx_split],
            "nome_cliente": atendimento_ctx.nome_contato,
            "ai_model": ai_model_to_use,
            "persona_prompt": persona_prompt_resolved,
            "nature_identity": nature_id_val,
            "workflow_context": workflow_context,
            "calendar_context": calendar_context,
            "available_tags": available_tags_names,
            "current_tags": current_tags_names,
            "team_members": team_members,
            "company_team_info": company_team_info,
            "drive_ativo": bool(persona_config.drive_id),
            "calendar_ativo": bool(persona_config.is_calendar_active),
            "tts_voice": str(persona_config.tts_voice or "").strip("'\"").strip(),
            "data_hora_atual": data_hora_atual_str,
            "temperature": persona_config.temperature if persona_config.temperature is not None else 0.5,
            "top_p": persona_config.top_p if persona_config.top_p is not None else 0.95,
            "top_k": persona_config.top_k if persona_config.top_k is not None else 40,
            "thinking_budget": persona_config.thinking_budget,
            "thinking_level": str(persona_config.thinking_level or "medium").strip("'\"").strip().lower() if persona_config.thinking_level else "medium",
            "resumo_crm": atendimento_ctx.resumo or "",
            "last_processed_msg_id": last_processed_msg_id,
            "retry_count": 0,
            "validation_passed": False,
            "send_as_audio": False,
            "input_tokens": 0,
            "output_tokens": 0
        }

        # --- PASSO 6: EXECUÇÃO DO GRAFO LANGGRAPH ---
        final_state = await run_agent_workflow(initial_state)

        # --- PASSO 7: CONTABILIZAÇÃO DE TOKENS ---
        in_t = final_state.get("input_tokens", 0)
        out_t = final_state.get("output_tokens", 0)
        tot_t = in_t + out_t

        nome_modelo_limpo = ai_model_to_use.replace("google:", "").replace("google-cloud:", "")
        precos = TABELA_PRECOS.get(nome_modelo_limpo, TABELA_PRECOS.get("gemini-3.5-flash-lite", {"input_text": 0.25, "output": 1.50}))
        
        multiplicador_input = precos["input_text"] / BASE_FLASH_PRICE
        multiplicador_output = precos["output"] / BASE_FLASH_PRICE
        tokens_deduzir = math.ceil((in_t * multiplicador_input) + (out_t * multiplicador_output))

        if tokens_deduzir > 0:
            async with SessionLocal() as db_tokens:
                async with db_tokens.begin():
                    comp = await db_tokens.get(models.Company, company.id)
                    if comp:
                        await crud_user.decrement_company_tokens(
                            db_tokens,
                            db_company=comp,
                            usage=tokens_deduzir,
                            atendimento_id=atendimento_id,
                            token_type="gemini_inference"
                        )
            logger.info(f"[LangGraph] Tokens deduzidos: {tokens_deduzir} (In: {in_t}, Out: {out_t})")

        # --- PASSO 8: REGISTRO EM LAST_PROMPT.TXT ---
        try:
            log_entry = [
                "=" * 80,
                f"📌 EXECUÇÃO DO RAG AGÊNTICO LANGGRAPH - {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}",
                f"👤 Atendimento ID: {atendimento_id} | Empresa ID: {company.id}",
                f"🤖 Modelo: {ai_model_to_use} | Tentativas: {final_state.get('retry_count', 0)}",
                f"🎯 Intenção: {final_state.get('intent_category')} | Status Final: {final_state.get('status_final')}",
                "-" * 80,
                "📥 MENSAGEM DO CLIENTE:",
                ultima_mensagem,
                "-" * 80,
                "🔍 CONTEXTO RAG RECUPERADO:",
                str(final_state.get("retrieved_context") or "Nenhum"),
                "-" * 80,
                "💬 RESPOSTA ENVIADA:",
                str(final_state.get("final_response") or "Nenhuma"),
                "-" * 80,
                f"📊 CONSUMO DE TOKENS: {tot_t:,} (In: {in_t:,} | Out: {out_t:,})",
                "=" * 80,
                "\n"
            ]
            with open("last_prompt.txt", "a", encoding="utf-8") as f:
                f.write("\n".join(log_entry))
        except Exception as f_err:
            logger.error(f"Erro ao salvar last_prompt.txt: {f_err}")

    except (asyncio.CancelledError, NodeCancelledError):
        logger.info(f"[Barramento] Atendimento {atendimento_id} cancelado/reiniciado devido a nova mensagem. Revertendo status para 'Mensagem Recebida'...")
        try:
            async with SessionLocal() as db_cancel:
                async with db_cancel.begin():
                    at_cancel = await db_cancel.get(models.Atendimento, atendimento_id)
                    if at_cancel and at_cancel.status == "Gerando Resposta":
                        at_cancel.status = "Mensagem Recebida"
                        at_cancel.updated_at = datetime.now(timezone.utc)
                        db_cancel.add(at_cancel)
        except Exception as c_err:
            logger.error(f"Erro ao reverter status no cancelamento: {c_err}")
        return

    except Exception as e:
        # Tratamento de cancelamento encapsulado pelo LangGraph
        if (
            isinstance(e, (asyncio.CancelledError, NodeCancelledError))
            or "cancelled" in type(e).__name__.lower()
            or "cancelled" in str(e).lower()
        ):
            logger.info(f"[Barramento] Atendimento {atendimento_id} cancelado/reiniciado devido a nova mensagem ({type(e).__name__}). Revertendo status para 'Mensagem Recebida'...")
            try:
                async with SessionLocal() as db_cancel:
                    async with db_cancel.begin():
                        at_cancel = await db_cancel.get(models.Atendimento, atendimento_id)
                        if at_cancel and at_cancel.status == "Gerando Resposta":
                            at_cancel.status = "Mensagem Recebida"
                            at_cancel.updated_at = datetime.now(timezone.utc)
                            db_cancel.add(at_cancel)
            except Exception as c_err:
                logger.error(f"Erro ao reverter status no cancelamento: {c_err}")
            return

        logger.error(f"[LangGraph Erro] Falha crítica no atendimento {atendimento_id}: {e}", exc_info=True)
        try:
            async with SessionLocal() as db_fail:
                async with db_fail.begin():
                    at_fail = await db_fail.get(models.Atendimento, atendimento_id)
                    if at_fail and at_fail.status == "Gerando Resposta":
                        at_fail.status = "Erro IA"
                        at_fail.resumo = f"Erro LangGraph: {str(e)[:250]}"
                        at_fail.updated_at = datetime.now(timezone.utc)
        except Exception: pass

async def run_agent_cycle():
    """
    Ciclo contínuo de verificação de atendimentos pendentes acionado pelo worker.
    """
    logger.info("Agente (LangGraph): Iniciando ciclo de verificação...")
    async with SessionLocal() as db:
        try:
            atendimentos = await crud_atendimento.get_atendimentos_para_processar(db)
            if atendimentos:
                logger.info(f"Agente (LangGraph): {len(atendimentos)} atendimento(s) encontrado(s).")
                for at in atendimentos:
                    task = _active_processing_tasks.get(at.id)
                    if task and not task.done():
                        continue
                    if at.company:
                        asyncio.create_task(process_single_atendimento(at.id, at.company))
            else:
                logger.info("Agente (LangGraph): Nenhum atendimento para processar.")
        except Exception as e:
            logger.error(f"Agente (LangGraph): Erro no ciclo: {e}", exc_info=True)
