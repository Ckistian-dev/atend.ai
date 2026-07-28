import asyncio
import json
import logging
import random
import uuid
import re
from typing import Dict, List, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload
from sqlalchemy.future import select
from datetime import datetime, timezone, timedelta

from app.db.database import SessionLocal
from app.crud import crud_atendimento, crud_config, crud_user
from app.services.whatsapp_service import get_whatsapp_service, MessageSendError
from app.services.gemini_service import get_gemini_service
from app.services.google_calendar_service import get_google_calendar_service
from app.services.google_drive_service import get_drive_service # <--- Import do serviço de Drive
from app.services.config_service import SITUATIONS, ConfigService
parse_drive_index = ConfigService.parse_drive_index
from app.db import models, schemas
from app.services.agent_service import agente_atendimento, ContextoSaaS, contabilizar_tokens_pydantic
from pydantic_ai.messages import ModelRequest, ModelResponse, UserPromptPart, TextPart

logger = logging.getLogger(__name__)

# Dicionário global para controlar e permitir cancelamento de tasks de atendimento ativas por ID
_active_processing_tasks: Dict[int, asyncio.Task] = {}

def cancel_active_atendimento_task(atendimento_id: int) -> bool:
    """
    Interrompe a task de IA em andamento para o atendimento_id fornecido se ela estiver rodando.
    Retorna True se uma task ativa foi cancelada, False caso contrário.
    """
    task = _active_processing_tasks.get(atendimento_id)
    if task and not task.done():
        logger.info(f"[BARRAMENTO AMBIENTE] Interrompendo task de IA ativa para Atendimento ID {atendimento_id} devido a nova mensagem recebida.")
        task.cancel()
        return True
def selecionar_ultimas_mensagens_historico(historico_previo: List[Dict[str, Any]], max_dialogo: int = 10) -> List[Dict[str, Any]]:
    """
    Seleciona as mensagens do histórico anterior garantindo que até `max_dialogo`
    mensagens reais de diálogo (mensagens do usuário ou respostas principais da IA) 
    sejam mantidas, junto com suas respectivas pesquisas associadas.
    """
    if not historico_previo:
        return []

    dialogo_count = 0
    cut_index = 0

    # Percorre de trás para frente contando mensagens de diálogo reais
    for i in range(len(historico_previo) - 1, -1, -1):
        msg = historico_previo[i]
        role = msg.get("role") or "user"
        msg_type = msg.get("type") or "text"

        # Mensagens de diálogo são mensagens do usuário ou mensagens de resposta da IA (excluindo registros de busca interna)
        is_dialogue = (role in ["user", "client"]) or (role == "assistant" and msg_type != "search")

        if is_dialogue:
            dialogo_count += 1

        if dialogo_count > max_dialogo:
            cut_index = i + 1
            break

    return historico_previo[cut_index:]


def converter_historico_para_pydantic(historico_db: List[Dict[str, Any]]) -> List[Any]:
    """
    Converte o histórico de conversa do banco de dados (lista de dicts)
    para o formato de mensagens nativo do PydanticAI (ModelRequest / ModelResponse),
    agrupando mensagens consecutivas do mesmo papel ("user" / "assistant")
    para manter a alternância correta exigida pelas LLMs.
    """
    if not historico_db:
        return []

    pydantic_messages = []
    grouped_turns: List[Dict[str, Any]] = []

    for msg in historico_db:
        role = msg.get("role") or "user"
        content = msg.get("content") or ""
        caption = msg.get("caption")

        if caption and caption.strip():
            content = f"{content}\n[Legenda: {caption}]"

        content_clean = str(content).strip()
        if not content_clean:
            continue

        # Normaliza o papel do emissor
        role_normalized = "user" if role in ["user", "client"] else "assistant"

        if grouped_turns and grouped_turns[-1]["role"] == role_normalized:
            grouped_turns[-1]["contents"].append(content_clean)
        else:
            grouped_turns.append({"role": role_normalized, "contents": [content_clean]})

    for turn in grouped_turns:
        full_text = "\n".join(turn["contents"]).strip()
        if not full_text:
            continue

        if turn["role"] == "user":
            pydantic_messages.append(
                ModelRequest(parts=[UserPromptPart(content=full_text)])
            )
        else:
            pydantic_messages.append(
                ModelResponse(parts=[TextPart(content=full_text)])
            )

    return pydantic_messages

async def process_single_atendimento(atendimento_id: int, company: models.Company):
    current_task = asyncio.current_task()
    existing_task = _active_processing_tasks.get(atendimento_id)
    
    if existing_task and not existing_task.done():
        logger.warning(f"Atendimento {atendimento_id} já está sendo processado em outra task ativa. Pulando redundância.")
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
    Processa um único atendimento de ponta a ponta.
    Esta função é o coração do agente, orquestrando a leitura do estado atual,
    a geração de resposta pela IA, o envio de mensagens/arquivos e a atualização final do banco de dados.
    É projetada para ser executada de forma assíncrona para cada atendimento.
    """
    # Log inicial para rastrear qual usuário está processando qual atendimento.
    logger.info(f"[ATENDIMENTO INICIADO] ID: {atendimento_id} | Empresa ID: {company.id}")
    
    # Inicializa os serviços necessários para o processamento.
    whatsapp_service = get_whatsapp_service()
    gemini_service = get_gemini_service()
    drive_service = get_drive_service()
    
    # Variável para logging, armazena o número de WhatsApp do contato.
    atendimento_contato_num_log = "N/A"

    try:
        # --- ETAPA 1: BLOQUEIO E ATUALIZAÇÃO DE STATUS ---
        logger.info(f"[Passo 1/5 - Bloqueio] Tentando travar atendimento ID {atendimento_id}...")
        marked_generating = False
        try:
            async with SessionLocal() as db_mark_generating:
                async with db_mark_generating.begin():
                    # Bloqueia a linha do atendimento no banco de dados para escrita.
                    atendimento_to_mark = await db_mark_generating.get(models.Atendimento, atendimento_id, with_for_update=True)
                    if atendimento_to_mark:
                         atendimento_contato_num_log = atendimento_to_mark.whatsapp
                    
                    # Verifica se o atendimento está em um estado que permite o processamento.
                    if atendimento_to_mark and atendimento_to_mark.status in ["Mensagem Recebida"]:
                        atendimento_to_mark.status = "Gerando Resposta"
                        atendimento_to_mark.updated_at = datetime.now(timezone.utc)
                        marked_generating = True
                    else:
                        logger.warning(f"[Passo 1/5 - Bloqueio] Atendimento {atendimento_id} pulado. Status atual: '{atendimento_to_mark.status if atendimento_to_mark else 'N/A'}' (esperado: 'Mensagem Recebida').")
                        return 

        except Exception as lock_err:
            logger.error(f"[Passo 1/5 - Bloqueio] Falha crítica ao marcar status de processamento: {lock_err}")
            return
        
        if not marked_generating: return

        logger.info(f"[Passo 1/5 - Bloqueio] Atendimento ID {atendimento_id} travado com sucesso e marcado como 'Gerando Resposta'.")

        # --- ETAPA 2: COLETA DE CONTEXTO PARA A IA ---
        logger.info(f"[Passo 2/5 - Contexto] Iniciando coleta de contexto e histórico de mensagens...")
        conversation_history = []
        persona_config = None

        try:
            # Abre uma nova sessão para ler os dados do atendimento.
            async with SessionLocal() as db_read_context:
                atendimento_context = await db_read_context.get(
                    models.Atendimento,
                    atendimento_id,
                    options=[joinedload(models.Atendimento.active_persona)]
                )
                if not atendimento_context: raise ValueError("Atendimento não encontrado.")
                atendimento_contato_num_log = atendimento_context.whatsapp

                # Carrega a persona ativa específica para este atendimento.
                persona_config = atendimento_context.active_persona
                # Se não houver persona específica, usa a persona padrão do usuário.
                if not persona_config:
                    if company.default_persona_id:
                        persona_config = await crud_config.get_config(db_read_context, company.default_persona_id, company.id)
                
                # Se nenhuma persona for encontrada, o processo não pode continuar.
                if not persona_config:
                    raise ValueError("Nenhuma persona configurada para esta empresa/atendimento.")
                
                logger.info(f"[Passo 2/5 - Contexto] Persona carregada: ID {persona_config.id} | Nome: {persona_config.nome_config or 'N/A'}")

                # Carrega o histórico da conversa a partir do campo JSON no banco de dados.
                try:
                    conversation_history = json.loads(atendimento_context.conversa or "[]")
                    conversation_history.sort(key=lambda x: x.get('timestamp') or 0) # Garante a ordem cronológica.
                except:
                    conversation_history = []
                
                logger.info(f"[Passo 2/5 - Contexto] Histórico carregado: {len(conversation_history)} mensagens no total.")

        # Se ocorrer um erro ao coletar o contexto, o status do atendimento é revertido para "Erro Contexto".
        except Exception as context_err:
            logger.error(f"[Passo 2/5 - Contexto] Falha ao ler dados de contexto para o atendimento ID {atendimento_id}: {context_err}")
            try:
                async with SessionLocal() as db_revert:
                    async with db_revert.begin():
                        at_revert = await db_revert.get(models.Atendimento, atendimento_id)
                        if at_revert and at_revert.status == "Gerando Resposta":
                            at_revert.status = "Erro Contexto"
                            at_revert.updated_at = datetime.now(timezone.utc)
            except Exception: pass
            return 

        # --- ETAPA 3: GERAÇÃO DA RESPOSTA PELA IA ---
        ia_response = None
        
        try:
            logger.info(f"[Passo 3/5 - IA] Preparando dados do contexto para envio à IA...")
            # 0. Coleta os dados do banco em uma transação curta para liberar a conexão antes de chamar a IA
            async with SessionLocal() as db_gemini_deduct:
                company_for_gemini = await db_gemini_deduct.get(models.Company, company.id)
                # Re-busca a persona_config para garantir os valores mais recentes da transação do banco
                persona_config = await db_gemini_deduct.get(models.Config, persona_config.id)
                workflow_context = gemini_service._format_workflow_to_markdown(persona_config.workflow_json)
                available_tags = await crud_atendimento.get_all_user_tags(db_gemini_deduct, company_id=company.id)
                available_tags_names = [t['name'] for t in available_tags]
                
                # Busca as categorias reais de conhecimento disponíveis no banco
                categorias_conhecimento = []
                try:
                    stmt_cats = select(models.KnowledgeVector.category).where(
                        models.KnowledgeVector.config_id == persona_config.id
                    ).distinct()
                    res_cats = await db_gemini_deduct.execute(stmt_cats)
                    categorias_conhecimento = sorted(list({str(r).strip() for r in res_cats.scalars().all() if r and str(r).strip()}))
                    logger.info(f"[Passo 2/5 - Contexto] Categorias de conhecimento disponíveis na base: {categorias_conhecimento}")
                except Exception as cat_err:
                    logger.error(f"[Passo 2/5 - Contexto] Erro ao buscar categorias de conhecimento: {cat_err}")
                
                atendimento_for_gemini = await db_gemini_deduct.get(models.Atendimento, atendimento_id)
                datetime_context = gemini_service._get_datetime_context(company_for_gemini)

            # 3. Recupera Calendar Context (Fora do bloco SessionLocal)
            calendar_context = ""
            if persona_config.is_calendar_active and persona_config.available_hours:
                logger.info(f"[Passo 3/5 - IA] Configuração do Calendário está ativa. Buscando eventos no Google Calendar...")
                booked_events_str = ""
                if persona_config.google_calendar_credentials:
                    try:
                        cal_service = get_google_calendar_service(persona_config)
                        events = await asyncio.to_thread(cal_service.get_upcoming_events)
                        if events:
                            booked_list = [f"- {e['start'].get('dateTime', e['start'].get('date'))}" for e in events]
                            booked_events_str = "\n# HORÁRIOS JÁ OCUPADOS (NÃO AGENDAR NESTES)\n" + "\n".join(booked_list) + "\n"
                    except Exception as cal_err:
                        logger.error(f"[Passo 3/5 - IA] Erro ao carregar eventos da agenda Google: {cal_err}")

                hours_summary = []
                for day, intervals in persona_config.available_hours.items():
                    if intervals:
                        if isinstance(intervals, str):
                            hours_summary.append(f"{day.capitalize()}: {intervals}")
                        elif isinstance(intervals, list):
                            formatted_intervals = []
                            for i in intervals:
                                if isinstance(i, dict):
                                    start = i.get('start')
                                    end = i.get('end')
                                    if start and end:
                                        formatted_intervals.append(f"{start}-{end}")
                                    elif start:
                                        formatted_intervals.append(start)
                                    elif end:
                                        formatted_intervals.append(end)
                                elif isinstance(i, str):
                                    formatted_intervals.append(i)
                            if formatted_intervals:
                                hours_summary.append(f"{day.capitalize()}: {', '.join(formatted_intervals)}")
                        else:
                            hours_summary.append(f"{day.capitalize()}: {str(intervals)}")
                
                hours_text = " | ".join(hours_summary) if hours_summary else "Não configurado"
                calendar_context = f"\n# DISPONIBILIDADE DE AGENDA\n- Horários de Trabalho: {hours_text}\n"
                calendar_context += booked_events_str
                calendar_context += "Se o cliente demonstrar interesse em agendar, verifique a disponibilidade real (horários de trabalho vs ocupados) e proponha um horário livre usando a tool correspondente.\n"


            
            # --- RESOLUÇÃO DE PERSONA PROMPT E PÁGINA DE INSTRUÇÕES ---
            persona_form_data = getattr(persona_config, 'persona_form', None)
            persona_from_tab = build_prompt_from_persona_form(persona_form_data) if persona_form_data else ""
            
            has_spreadsheet_id = bool(persona_config.spreadsheet_id and str(persona_config.spreadsheet_id).strip())
            instructions_page_prompt = (persona_config.prompt or "").strip() if has_spreadsheet_id else ""

            if persona_from_tab and instructions_page_prompt:
                persona_prompt_resolved = f"{persona_from_tab}\n\n## MATRIZ DE INSTRUÇÕES DO SISTEMA\n{instructions_page_prompt}"
                logger.info(f"[Passo 3/5 - IA] Usando ABA DE PERSONA e PÁGINA DE INSTRUÇÕES (Planilha ID: {persona_config.spreadsheet_id}) no system prompt.")
            elif persona_from_tab:
                persona_prompt_resolved = persona_from_tab
                logger.info(f"[Passo 3/5 - IA] Planilha de instruções não configurada (ID ausente). Usando apenas a ABA DE PERSONA no system prompt.")
            elif instructions_page_prompt:
                persona_prompt_resolved = instructions_page_prompt
                logger.info(f"[Passo 3/5 - IA] Aba de persona não preenchida. Usando apenas a PÁGINA DE INSTRUÇÕES da planilha como system prompt.")
            else:
                persona_prompt_resolved = "Você é um assistente virtual útil."
                logger.info(f"[Passo 3/5 - IA] Nenhuma instrução ou persona configurada. Usando prompt fallback padrão.")

            contexto = ContextoSaaS(
                db=None,
                company_id=company.id,
                config_id=persona_config.id,
                atendimento_id=atendimento_id,
                nome_cliente=atendimento_context.nome_contato or "Desconhecido",
                data_hora_atual=datetime_context,
                persona_prompt=persona_prompt_resolved,
                model_name=persona_config.ai_model or "gemini-3.1-flash-lite",
                rag_context="",
                workflow_context=workflow_context,
                calendar_context=calendar_context,
                available_tags=available_tags_names,
                drive_ativo=bool(persona_config.drive_id),
                calendar_ativo=bool(persona_config.is_calendar_active),
                # --- Configuracoes de inferencia vindas da Config do cliente ---
                temperature=float(persona_config.temperature if persona_config.temperature is not None else 0.5),
                top_p=float(persona_config.top_p if persona_config.top_p is not None else 0.95),
                top_k=int(persona_config.top_k if persona_config.top_k is not None else 40),
                thinking_budget=persona_config.thinking_budget,
                thinking_level=str(persona_config.thinking_level or "medium").strip("'\"").strip().lower(),
                tts_voice=str(persona_config.tts_voice or "").strip("'\"").strip(),
                allow_send_values=bool(getattr(persona_config, 'allow_send_values', True) if getattr(persona_config, 'allow_send_values', None) is not None else True),
                # --- Micro-tools ---
                empresa=company_for_gemini,
                atendimento=atendimento_for_gemini,
                whatsapp_service=whatsapp_service,
                categorias_conhecimento=categorias_conhecimento
            )
            
            # 6. Executa o Agente do Pydantic AI com histórico de mensagens nativo
            # Coleta TODAS as mensagens consecutivas do usuário no final da conversa
            user_msgs_tail = []
            idx_split = len(conversation_history)
            
            while idx_split > 0 and conversation_history[idx_split - 1].get("role") in ["user", "client"]:
                idx_split -= 1
                msg_item = conversation_history[idx_split]
                c_text = str(msg_item.get("content") or "").strip()
                if msg_item.get("caption"):
                    c_text = f"{c_text}\n[Legenda: {msg_item.get('caption')}]".strip()
                if c_text:
                    user_msgs_tail.insert(0, c_text)

            if user_msgs_tail:
                ultima_mensagem = "\n".join(user_msgs_tail)
                historico_previo = conversation_history[:idx_split]
            else:
                ultima_mensagem = "Olá"
                historico_previo = conversation_history
                
            # Otimização de Tokens: Limita o histórico prévio às últimas 10 mensagens de diálogo reais (mantendo buscas associadas) e injeta a síntese CRM se houver histórico mais antigo
            resumo_crm_extra = None
            MAX_DIALOGO = 10
            historico_filtrado = selecionar_ultimas_mensagens_historico(historico_previo, max_dialogo=MAX_DIALOGO)
            
            if len(historico_filtrado) < len(historico_previo):
                resumo_crm_extra = (atendimento_context.resumo or "").strip() or None
                historico_previo = historico_filtrado
                logger.info(f"[Passo 3/5 - IA] Histórico prévio truncado para as últimas {MAX_DIALOGO} mensagens de diálogo ({len(historico_previo)} registros brutos). Síntese CRM injetada no prompt.")

            contexto.resumo_crm_context = resumo_crm_extra
            memoria_ia = converter_historico_para_pydantic(historico_previo)
            
            model_to_use = contexto.model_name
            if not model_to_use.startswith("google:") and not model_to_use.startswith("google-cloud:"):
                model_to_use = f"google:{model_to_use}"

            logger.info(f"[Passo 3/5 - IA] Executando Pydantic AI com o modelo '{model_to_use}'...")
            
            import os
            try:
                os.environ["GOOGLE_API_KEY"] = gemini_service.api_key
            except Exception as key_err:
                logger.warning(f"[Passo 3/5 - IA] Não foi possível definir GOOGLE_API_KEY no ambiente: {key_err}")

            from pydantic_ai.models.google import GoogleModelSettings

            thinking_cfg = {}
            is_gemini_3 = "gemini-3" in contexto.model_name
            if is_gemini_3:
                raw_lvl = (contexto.thinking_level or "").strip("'\"").strip().lower()
                if raw_lvl and raw_lvl not in ("default", "none", "null", ""):
                    thinking_cfg["thinking_level"] = raw_lvl.upper()
            elif contexto.thinking_budget is not None:
                thinking_cfg["thinking_budget"] = contexto.thinking_budget

            model_settings_dict = {
                "temperature": contexto.temperature,
                "top_p": contexto.top_p,
                "top_k": contexto.top_k,
            }
            if thinking_cfg:
                model_settings_dict["google_thinking_config"] = thinking_cfg

            model_settings = GoogleModelSettings(**model_settings_dict)

            logger.info(
                f"[Passo 3/5 - IA] ModelSettings: temperature={contexto.temperature}, "
                f"top_p={contexto.top_p}, top_k={contexto.top_k}, "
                f"thinking_config={thinking_cfg}"
            )

            from pydantic_ai.usage import UsageLimits

            resultado_ia = await agente_atendimento.run(
                ultima_mensagem,
                deps=contexto,
                message_history=memoria_ia,
                model=model_to_use,
                model_settings=model_settings,
                usage_limits=UsageLimits(request_limit=15)
            )
            
            # 7. Converte a resposta estruturada para o formato esperado pelo restante do agent_processor
            dados = resultado_ia.output
            logger.info(f"[Passo 3/5 - IA] Retorno recebido com sucesso do LLM. Output Resumo: '{dados.resumo}'")

            # Escreve o input e output detalhado em last_prompt.txt de forma clara, ordenada e de fácil leitura
            try:
                from pydantic_core import to_jsonable_python
                from app.services.agent_service import construir_prompt_base

                parts = []
                parts.append("=" * 80)
                parts.append("📌 REGISTRO DETALHADO DO ÚLTIMO PROMPT E ORDEM DE EXECUÇÃO DA IA (LAST PROMPT)")
                parts.append("=" * 80)
                parts.append(f"🕒 Data/Hora do Ciclo: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}")
                parts.append(f"👤 Atendimento ID: {atendimento_id} | Contato: {atendimento_contato_num_log}")
                parts.append(f"🤖 Modelo Utilizado: {model_to_use}")
                parts.append("=" * 80)
                parts.append("")

                # 1. OBTER O PROMPT DO SISTEMA (SYSTEM PROMPT / PERSONA & REGRAS)
                class MockRunContext:
                    def __init__(self, deps):
                        self.deps = deps

                try:
                    system_prompt_str = construir_prompt_base(MockRunContext(contexto))
                except Exception as sys_err:
                    system_prompt_str = f"Erro ao renderizar system prompt: {sys_err}"

                parts.append("--------------------------------------------------------------------------------")
                parts.append("🧠 1. PROMPT DO SISTEMA (SYSTEM PROMPT / PERSONA, FLUXO & REGRAS)")
                parts.append("--------------------------------------------------------------------------------")
                parts.append(system_prompt_str.strip())
                parts.append("")
                parts.append("-" * 80)
                parts.append("")

                # 2. OBTER A SEQUÊNCIA CRONOLÓGICA DAS MENSAGENS E AÇÕES (ORDEM EXATA DE ENVIO)
                parts.append("--------------------------------------------------------------------------------")
                parts.append("💬 2. SEQUÊNCIA CRONOLÓGICA DE MENSAGENS E AÇÕES (ORDEM EXATA DE ENVIO)")
                parts.append("--------------------------------------------------------------------------------")

                messages = resultado_ia.all_messages()
                ordem_count = 1

                for msg_idx, msg in enumerate(messages):
                    msg_dict = to_jsonable_python(msg)
                    parts_list = msg_dict.get("parts", [])

                    for p in parts_list:
                        part_kind = p.get("part_kind")
                        content = p.get("content") or p.get("text")

                        # Ignora o system prompt no fluxo de conversa pois ele já está na Seção 1
                        if part_kind in ["system-prompt", "system"]:
                            continue

                        if part_kind == "user-prompt":
                            is_latest = (content == ultima_mensagem)
                            tag_label = "MENSAGEM ATUAL DA RODADA" if is_latest else "HISTÓRICO"
                            parts.append(f"[Ordem #{ordem_count:02d}] 👤 CLIENTE ({tag_label})")
                            parts.append(f"{content}")
                            parts.append("")
                            ordem_count += 1

                        elif part_kind == "tool-call" or ("tool_name" in p and "args" in p):
                            tool_name = p.get("tool_name")
                            args = p.get("args") or {}
                            try:
                                args_formatted = json.dumps(args, ensure_ascii=False, indent=2)
                            except Exception:
                                args_formatted = str(args)
                            parts.append(f"[Ordem #{ordem_count:02d}] 🛠️ AÇÃO DA IA (CHAMADA DE FERRAMENTA)")
                            parts.append(f"Ferramenta: {tool_name}")
                            parts.append(f"Parâmetros:\n{args_formatted}")
                            parts.append("")
                            ordem_count += 1

                        elif part_kind == "tool-return" or "outcome" in p:
                            tool_name = p.get("tool_name")
                            parts.append(f"[Ordem #{ordem_count:02d}] 📥 RETORNO DA FERRAMENTA ('{tool_name}')")
                            parts.append(f"Retorno:\n{content}")
                            parts.append("")
                            ordem_count += 1

                        elif part_kind == "text" or msg_dict.get("role") == "model":
                            if content:
                                parts.append(f"[Ordem #{ordem_count:02d}] 🤖 RESPOSTA DA IA")
                                parts.append(f"{content}")
                                parts.append("")
                                ordem_count += 1

                parts.append("-" * 80)
                parts.append("")

                # 3. SAÍDA E RESUMO FINAL DA RODADA
                parts.append("--------------------------------------------------------------------------------")
                parts.append("📝 3. RESUMO CONSOLIDADO E STATUS DA RODADA")
                parts.append("--------------------------------------------------------------------------------")
                parts.append(f"Resumo CRM: {dados.resumo}")
                parts.append("Próximo Status: Aguardando Resposta")
                parts.append("")
                parts.append("-" * 80)
                parts.append("")

                # 4. CONSUMO DE TOKENS DO CICLO
                if resultado_ia.usage:
                    u = resultado_ia.usage
                    in_t = getattr(u, 'input_tokens', getattr(u, 'request_tokens', 0)) or 0
                    out_t = getattr(u, 'output_tokens', getattr(u, 'response_tokens', 0)) or 0
                    tot_t = getattr(u, 'total_tokens', in_t + out_t) or (in_t + out_t)
                    parts.append("--------------------------------------------------------------------------------")
                    parts.append("📊 4. CONSUMO DE TOKENS DO CICLO")
                    parts.append("--------------------------------------------------------------------------------")
                    parts.append(f"- Tokens de Entrada (Prompt + Histórico): {in_t:,}")
                    parts.append(f"- Tokens de Saída (Respostas + Ações): {out_t:,}")
                    parts.append(f"- Total de Tokens Consumidos: {tot_t:,}")
                    parts.append("")

                parts.append("=" * 80)

                # Adiciona ao 'last_prompt.txt' (modo 'a') para acumular os registros de cada ciclo
                with open("last_prompt.txt", "a", encoding="utf-8") as f:
                    f.write("\n".join(parts) + "\n\n")
            except Exception as f_err:
                logger.error(f"Erro ao gravar last_prompt.txt: {f_err}", exc_info=True)
            
            ia_response = {
                "resumo": dados.resumo or "",
                "nova_situacao": "Aguardando Resposta"
            }
            
            # 8. Contabiliza tokens
            logger.info(f"[Passo 3/5 - IA] Iniciando contabilização de tokens...")
            await contabilizar_tokens_pydantic(resultado_ia, contexto, company_for_gemini)
            
            if not ia_response:
                raise ValueError("A IA retornou um resultado vazio ou inválido.")

        # Se a IA falhar permanentemente, o status é atualizado para "Erro IA" com detalhes do erro.
        except Exception as ia_err:
            logger.error(f"[Passo 3/5 - IA] Falha crítica na geração ou execução da IA: {ia_err}", exc_info=True)
            try:
                async with SessionLocal() as db_ia_fail:
                    async with db_ia_fail.begin():
                        at_ia_fail = await db_ia_fail.get(models.Atendimento, atendimento_id)
                        if at_ia_fail:
                            at_ia_fail.status = "Erro IA"
                            at_ia_fail.resumo = f"IA Error: {str(ia_err)[:250]}"
                            at_ia_fail.updated_at = datetime.now(timezone.utc)
            except Exception: pass
            return

        # --- ETAPA 4: EXECUÇÃO DAS AÇÕES (MIGRADAS PARA AS MICRO-TOOLS) ---
        logger.info(f"[Passo 4/5 - Ações] Ações delegadas para execução interna nas ferramentas da IA.")
        intended_status_after_send = ia_response.get("nova_situacao", "Aguardando Resposta")
        intended_resumo = ia_response.get("resumo", "")

        # --- ETAPA 5: ATUALIZAÇÃO FINAL DO ATENDIMENTO ---
        try:
            logger.info(f"[Passo 5/5 - Finalização] Iniciando persistência final do status e resumo no banco de dados...")
            async with SessionLocal() as db_final:
                async with db_final.begin():
                    # Bloqueia novamente a linha para garantir a consistência dos dados.
                    at_final = await db_final.get(models.Atendimento, atendimento_id, with_for_update=True)
                    if at_final:
                        # Atualiza o status apenas se ele ainda for "Gerando Resposta", para evitar sobrescrever uma mudança manual ou de tool.
                        if at_final.status == "Gerando Resposta":
                             at_final.status = intended_status_after_send
                             logger.info(f"[Passo 5/5 - Finalização] Definindo status final do atendimento como '{intended_status_after_send}'")
                        else:
                             logger.info(f"[Passo 5/5 - Finalização] Status já alterado anteriormente para '{at_final.status}'. Mantendo.")

                        if at_final.status == "Atendente Chamado":
                            logger.info(f"[Passo 5/5 - Finalização] Status é 'Atendente Chamado'. Distribuindo atendimento para equipe humana...")
                            await crud_atendimento.distribute_atendimento(db_final, at_final)
                        
                        # Salva as observações da IA (resumo)
                        at_final.resumo = intended_resumo
                        at_final.updated_at = datetime.now(timezone.utc)
            
            logger.info(f"[ATENDIMENTO CONCLUÍDO] Atendimento ID {atendimento_id} processado com total sucesso.")

        except Exception as final_err:
            logger.error(f"[Passo 5/5 - Finalização] Erro ao persistir atualizações finais: {final_err}")

    # Bloco de captura para erros inesperados e graves durante todo o processo.
    except asyncio.CancelledError:
        logger.info(f"[BARRAMENTO AMBIENTE] Atendimento ID {atendimento_id} teve sua geração de IA cancelada por nova mensagem. Revertendo status para 'Mensagem Recebida'.")
        try:
            async with SessionLocal() as db_cancel:
                async with db_cancel.begin():
                    at_cancel = await db_cancel.get(models.Atendimento, atendimento_id)
                    if at_cancel and at_cancel.status == "Gerando Resposta":
                        at_cancel.status = "Mensagem Recebida"
                        at_cancel.updated_at = datetime.now(timezone.utc)
        except Exception: pass
        raise
    except Exception as outer_err:
        logger.error(f"[ATENDIMENTO ERRO] ERRO CRÍTICO GERAL no processamento do atendimento {atendimento_id}: {outer_err}", exc_info=True)
        # Tenta reverter o status para "Erro IA" para que o atendimento possa ser analisado manualmente.
        try:
            async with SessionLocal() as db_fail:
                async with db_fail.begin():
                    at_fail = await db_fail.get(models.Atendimento, atendimento_id)
                    if at_fail and at_fail.status == "Gerando Resposta":
                        at_fail.status = "Erro IA"
                        at_fail.resumo = f"Outer Error: {str(outer_err)[:100]}"
                        at_fail.updated_at = datetime.now(timezone.utc)
                        logger.info(f"[ATENDIMENTO ERRO] Status revertido para 'Erro IA' com sucesso.")
        except: pass


async def run_agent_cycle():
    """
    Executa um ciclo completo de verificação e processamento do agente.
    Esta função é o ponto de entrada principal para o loop do agente, que é executado periodicamente.
    As tarefas de processamento são disparadas em background (create_task), portanto o ciclo retorna
    imediatamente — sem bloquear enquanto a IA gera resposta ou os delays de digitação correm.
    O status 'Gerando Resposta' garante que ciclos seguintes não dupliquem o processamento.
    """
    logger.info("Agente (Ciclo Otimizado): Iniciando ciclo...")
    
    # Dicionário para garantir que cada atendimento seja processado apenas uma vez por ciclo, evitando duplicidade.
    atendimentos_para_processar: Dict[int, models.Atendimento] = {}

    async with SessionLocal() as db:
        try:
            # 1. Busca todos os atendimentos que estão aguardando uma resposta e suas respectivas empresas
            atendimentos_msg_recebida = await crud_atendimento.get_atendimentos_para_processar(db)
            
            if atendimentos_msg_recebida:
                logger.info(f"Agente (Ciclo): {len(atendimentos_msg_recebida)} atendimentos (Mensagem Recebida) encontrados.")
                for at in atendimentos_msg_recebida:
                    # Adiciona o atendimento ao dicionário, garantindo que não haja duplicatas.
                    if at.id not in atendimentos_para_processar:
                        atendimentos_para_processar[at.id] = at

            # 2. Dispara cada atendimento como uma task independente em background.
            #    O ciclo retorna imediatamente; cada task roda no event loop de forma autônoma.
            if atendimentos_para_processar:
                logger.info(f"Agente (Ciclo): Disparando {len(atendimentos_para_processar)} tarefa(s) em background.")
                for at in atendimentos_para_processar.values():
                    task = _active_processing_tasks.get(at.id)
                    if task and not task.done():
                        logger.info(f"Agente (Ciclo): Atendimento {at.id} já está em processamento ativo. Pulando disparo.")
                        continue
                    if at.company:
                        asyncio.create_task(process_single_atendimento(at.id, at.company))
                    else:
                        logger.warning(f"Agente (Ciclo): Atendimento {at.id} sem empresa carregada.")
            else:
                logger.info("Agente (Ciclo): Nenhum atendimento para processar.")

        except Exception as cycle_err:
            logger.error(f"Agente (Ciclo): Erro CRÍTICO no loop principal: {cycle_err}", exc_info=True)
