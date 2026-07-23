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

# Conjunto global para evitar que o mesmo atendimento seja processado concorrentemente por múltiplas tasks
_active_processing_ids = set()

def build_prompt_from_persona_form(persona_form: Dict[str, Any]) -> str:
    """
    Compila os dados estruturados do formulário de persona em um system prompt
    textual rico e pronto para ser enviado à IA.
    Retorna string vazia se o formulário não tiver dados relevantes.
    """
    if not persona_form:
        return ""

    parts = []

    # --- Identidade ---
    ai_name = persona_form.get("ai_name", "").strip()
    company_name = persona_form.get("company_name", "").strip()
    role = persona_form.get("role", "").strip()
    segment = persona_form.get("segment", "").strip()

    identity_parts = []
    if ai_name:
        identity_parts.append(f"Seu nome é **{ai_name}**.")
    if role:
        identity_parts.append(f"Você é {role}.")
    if company_name:
        identity_parts.append(f"Você representa a empresa **{company_name}**.")
    if segment:
        identity_parts.append(f"O segmento de atuação é: {segment}.")

    nature_identity = str(persona_form.get("nature_identity", "human")).lower()
    if nature_identity == "ai":
        identity_parts.append("Caso o usuário pergunte diretamente se você é um robô ou inteligência artificial, confirme abertamente e de forma transparente que você é um assistente virtual da empresa.")
    elif nature_identity == "ignore":
        identity_parts.append("Caso o usuário pergunte se você é um robô ou inteligência artificial, desvie de forma evasiva e cordial sem confirmar e nem negar, mantendo o foco em tirar as dúvidas do cliente.")
    else:  # 'human'
        identity_parts.append("REGRA ESTREITA DE OCULTAÇÃO DA NATUREZA ARTIFICIAL: Adote uma persona estritamente humana em todas as interações. Caso o usuário pergunte diretamente se você é um robô ou inteligência artificial, afirme categoricamente ser um atendente humano da equipe e contorne qualquer questionamento com naturalidade.")

    if identity_parts:
        parts.append("## IDENTIDADE\n" + "\n".join(identity_parts))

    # --- Missão / Objetivo ---
    objective = persona_form.get("objective", "").strip()
    if objective:
        parts.append(f"## MISSÃO\n{objective}")

    # --- Tom de Voz e Estilo de Comunicação ---
    formality_raw = persona_form.get("formality")
    if formality_raw is None:
        formality_raw = persona_form.get("tone", "formal")
    
    if isinstance(formality_raw, (int, float)):
        is_informal = formality_raw > 0.5
    else:
        is_informal = str(formality_raw).lower() in ("informal", "1", "1.0", "true")

    objectivity_raw = persona_form.get("objectivity", "direto")
    if isinstance(objectivity_raw, (int, float)):
        is_detailed = objectivity_raw > 0.5
    else:
        is_detailed = str(objectivity_raw).lower() in ("detalhado", "explicativo", "1", "1.0", "true")

    qualities = persona_form.get("qualities") or []

    tone_lines = []
    if is_informal:
        tone_lines.append("- Linguagem informal, amigável, descontraída e próxima do cliente.")
    else:
        tone_lines.append("- Linguagem formal, profissional, respeitosa e sem gírias.")

    if is_detailed:
        tone_lines.append("- Comunicação detalhada, explicativa e didática, fornecendo informações completas.")
    else:
        tone_lines.append("- Comunicação direta, objetiva, concisa e focada na solução rápida.")

    if isinstance(qualities, list) and qualities:
        tone_lines.append(f"- Qualidades e atributos de personalidade: {', '.join(qualities)}.")
    elif isinstance(qualities, str) and qualities:
        tone_lines.append(f"- Qualidades e atributos de personalidade: {qualities}.")

    if tone_lines:
        parts.append("## TOM DE VOZ E ESTILO DE COMUNICAÇÃO\n" + "\n".join(tone_lines))

    # --- Idioma ---
    language = persona_form.get("language", "").strip()
    if language and language.lower() not in ("português", "pt-br", ""):
        parts.append(f"## IDIOMA\nResponda SEMPRE em {language}. Nunca mude de idioma mesmo que o cliente escreva em outro.")
    elif language.lower() in ("português", "pt-br"):
        parts.append("## IDIOMA\nResponda SEMPRE em português brasileiro.")

    # --- Apresentação inicial ---
    greeting = persona_form.get("greeting", "").strip()
    if greeting:
        parts.append(f"## SAUDAÇÃO INICIAL\nUse como saudação/apresentação: \"{greeting}\"")

    # --- Produtos e Serviços ---
    products = persona_form.get("products", "").strip()
    if products:
        parts.append(f"## PRODUTOS E SERVIÇOS\n{products}")

    # --- Informações da Empresa ---
    company_info = persona_form.get("company_info", "").strip()
    if company_info:
        parts.append(f"## SOBRE A EMPRESA\n{company_info}")

    # --- Perguntas Frequentes Inline (FAQ rápido) ---
    faq = persona_form.get("faq", "").strip()
    if faq:
        parts.append(f"## FAQ RÁPIDO\n{faq}")

    # --- Regras e Restrições ---
    restrictions = persona_form.get("restrictions")
    if isinstance(restrictions, list) and restrictions:
        rest_lines = [f"- {r.strip()}" for r in restrictions if str(r).strip()]
        if rest_lines:
            parts.append("## REGRAS E RESTRIÇÕES\n" + "\n".join(rest_lines))
    elif isinstance(restrictions, str) and restrictions.strip():
        parts.append(f"## REGRAS E RESTRIÇÕES\n{restrictions.strip()}")

    # --- Regras de Transferência para Humano ---
    handoff_rules = persona_form.get("handoff_rules")
    if isinstance(handoff_rules, list) and handoff_rules:
        handoff_lines = [f"- {h.strip()}" for h in handoff_rules if str(h).strip()]
        if handoff_lines:
            parts.append("## REGRAS DE TRANSFERÊNCIA\n" + "\n".join(handoff_lines))
    elif isinstance(handoff_rules, str) and handoff_rules.strip():
        parts.append(f"## REGRAS DE TRANSFERÊNCIA\n{handoff_rules.strip()}")

    # --- Horário de Funcionamento (texto livre) ---
    business_hours = persona_form.get("business_hours", "").strip()
    if business_hours:
        parts.append(f"## HORÁRIO DE ATENDIMENTO\n{business_hours}")

    # --- Instruções Adicionais ---
    extra_instructions = persona_form.get("extra_instructions", "").strip()
    if extra_instructions:
        parts.append(f"## INSTRUÇÕES ADICIONAIS\n{extra_instructions}")

    return "\n\n".join(parts)


def converter_historico_para_pydantic(historico_db: List[Dict[str, Any]]) -> list:
    """
    Converte o histórico JSON salvo no banco para a estrutura nativa de memória do PydanticAI.
    """
    pydantic_history = []
    
    # Se a conversa estiver vazia, retorna lista vazia
    if not historico_db:
        return pydantic_history

    # Separamos a ÚLTIMA mensagem se for do user
    if historico_db[-1].get('role') == 'user':
        mensagens_de_contexto = historico_db[:-1]
    else:
        mensagens_de_contexto = historico_db

    for msg in mensagens_de_contexto:
        role = msg.get('role')
        conteudo = msg.get('content') or "[Mídia ou mensagem sem texto]"
        
        if role == 'user':
            pydantic_history.append(
                ModelRequest(parts=[UserPromptPart(content=conteudo)])
            )
        elif role == 'assistant':
            pydantic_history.append(
                ModelResponse(parts=[TextPart(content=conteudo)])
            )

    return pydantic_history

async def process_single_atendimento(atendimento_id: int, company: models.Company):
    if atendimento_id in _active_processing_ids:
        logger.warning(f"Atendimento {atendimento_id} já está sendo processado em outra task. Pulando redundância.")
        return

    _active_processing_ids.add(atendimento_id)
    try:
        await _process_single_atendimento_inner(atendimento_id, company)
    finally:
        _active_processing_ids.discard(atendimento_id)


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
                temperature=float(persona_config.temperature or 0.1),
                top_p=float(persona_config.top_p or 0.95),
                top_k=int(persona_config.top_k or 40),
                thinking_budget=persona_config.thinking_budget,
                thinking_level=str(persona_config.thinking_level or "medium").strip("'\"").strip().lower(),
                tts_voice=str(persona_config.tts_voice or "").strip("'\"").strip(),
                # --- Micro-tools ---
                empresa=company_for_gemini,
                atendimento=atendimento_for_gemini,
                whatsapp_service=whatsapp_service,
                categorias_conhecimento=categorias_conhecimento
            )
            
            # 6. Executa o Agente do Pydantic AI com histórico de mensagens nativo
            if conversation_history and conversation_history[-1].get("role") == "user":
                ultima_mensagem = conversation_history[-1].get("content", "") or "Olá"
            else:
                ultima_mensagem = "Olá"
            memoria_ia = converter_historico_para_pydantic(conversation_history)
            
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

            resultado_ia = await agente_atendimento.run(
                ultima_mensagem,
                deps=contexto,
                message_history=memoria_ia,
                model=model_to_use,
                model_settings=model_settings
            )
            
            # 7. Converte a resposta estruturada para o formato esperado pelo restante do agent_processor
            dados = resultado_ia.output
            logger.info(f"[Passo 3/5 - IA] Retorno recebido com sucesso do LLM. Output Resumo: '{dados.resumo}'")

            # Escreve o input e output detalhado em last_prompt.txt de forma humanizada e amigável
            try:
                from pydantic_core import to_jsonable_python
                parts = []
                parts.append("=" * 80)
                parts.append(f"🕒 CICLO DO AGENTE: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
                parts.append(f"🤖 MODELO UTILIZADO: {model_to_use}")
                parts.append("=" * 80)
                parts.append("")

                messages = resultado_ia.all_messages()
                system_prompt_content = ""
                conversation_parts = []
                
                for msg in messages:
                    msg_dict = to_jsonable_python(msg)
                    role = msg_dict.get("role", "unknown")
                    parts_list = msg_dict.get("parts", [])
                    
                    for p in parts_list:
                        part_kind = p.get("part_kind")
                        content = p.get("content") or p.get("text")
                        
                        if part_kind in ["system-prompt", "system"] or (content and ("--- CONTEXTO DO ATENDIMENTO ---" in str(content) or "Assistente virtual" in str(content))):
                            system_prompt_content = str(content)
                        elif part_kind == "user-prompt":
                            conversation_parts.append(f"[Cliente 👤] {content}")
                        elif part_kind == "tool-call" or ("tool_name" in p and "args" in p):
                            tool_name = p.get("tool_name")
                            args = p.get("args") or {}
                            args_str = ", ".join(f"{k}={repr(v)}" for k, v in args.items())
                            conversation_parts.append(f"[Ação da IA 🛠️] Executar ferramenta '{tool_name}' com: {args_str}")
                        elif part_kind == "tool-return" or "outcome" in p:
                            tool_name = p.get("tool_name")
                            conversation_parts.append(f"[Resultado da Ferramenta '{tool_name}' 📥] {content}")
                        elif part_kind == "text" or role == "model":
                            conversation_parts.append(f"[IA 🤖] {content}")
                        else:
                            if content:
                                conversation_parts.append(f"[{role.upper()}] {content}")

                # Fallback de garantia: se o prompt do sistema não veio nas partes da mensagem, gera via construir_prompt_base
                if not system_prompt_content:
                    try:
                        from app.services.agent_service import construir_prompt_base
                        class MockRunContext:
                            def __init__(self, deps):
                                self.deps = deps
                        system_prompt_content = construir_prompt_base(MockRunContext(contexto))
                    except Exception as sys_err:
                        logger.warning(f"Não foi possível obter o prompt do sistema dinamicamente: {sys_err}")

                if system_prompt_content:
                    parts.append("--- 🧠 PROMPT DO SISTEMA (INSTRUÇÕES DO AGENTE) ---")
                    parts.append(system_prompt_content.strip())
                    parts.append("")
                    parts.append("-" * 80)
                    parts.append("")

                if conversation_parts:
                    parts.append("--- 💬 FLUXO DE CONVERSA E AÇÕES DA RODADA ---")
                    parts.append("\n".join(conversation_parts))
                    parts.append("")
                    parts.append("-" * 80)
                    parts.append("")

                parts.append("--- 📝 RESUMO FINAL / STATUS ---")
                parts.append(f"Resumo da Rodada: {dados.resumo}")
                parts.append("Próximo Status: Aguardando Resposta")
                parts.append("")
                parts.append("-" * 80)
                parts.append("")

                if resultado_ia.usage:
                    u = resultado_ia.usage
                    parts.append("--- 📊 CONSUMO DE TOKENS DO CICLO ---")
                    parts.append(f"Tokens de Entrada (Prompt): {getattr(u, 'input_tokens', 0)}")
                    parts.append(f"Tokens de Saída (Resposta): {getattr(u, 'output_tokens', 0)}")
                    parts.append(f"Total de Tokens Consumidos: {getattr(u, 'total_tokens', getattr(u, 'input_tokens', 0) + getattr(u, 'output_tokens', 0))}")
                    parts.append("")
                    parts.append("-" * 80)
                    parts.append("")

                # Adiciona o ciclo formatado ao last_prompt.txt (modo append 'a')
                parts.append("=" * 80)
                parts.append("\n")

                with open("last_prompt.txt", "a", encoding="utf-8") as f:
                    f.write("\n".join(parts))
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
                    if at.id in _active_processing_ids:
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
