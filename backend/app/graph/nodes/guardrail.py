import re
import json
import asyncio
import logging
from typing import Dict, Any, List, Tuple

from google.genai import types
from app.graph.state import AgentState, EvaluationResult
from app.graph.prompts import GUARDRAIL_JUDGE_PROMPT
from app.graph.history_utils import format_conversation_history
from app.services.gemini_service import get_gemini_service
from app.db.database import SessionLocal
from app.crud import crud_atendimento

logger = logging.getLogger(__name__)

URL_PATTERN = re.compile(
    r'(?:https?://|www\.)[^\s<>"\'\)]+|(?:[a-zA-Z0-9_\-\.]+\.(?:com|br|org|net|io|me|site|store|shop|app|online|edu|gov)(?:/[^\s<>"\'\)]*)?)',
    re.IGNORECASE
)

def clean_url(raw_url: str) -> str:
    """Limpa pontuação terminal e caracteres espúrios grudados na URL."""
    url = raw_url.strip()
    while url and url[-1] in '.,;:!?)>"\'\\]':
        if url[-1] == ')' and url.count('(') >= url.count(')'):
            break
        url = url[:-1]
    while url and url[0] in '(<>"\'\\[':
        url = url[1:]
    return url.strip()

def extract_urls(text: str) -> List[str]:
    """Extrai todas as URLs válidas de um texto estruturado."""
    if not text:
        return []
    raw_matches = URL_PATTERN.findall(text)
    cleaned = []
    for m in raw_matches:
        u = clean_url(m)
        if u and len(u) >= 4 and '.' in u:
            if not (u.startswith('http://') or u.startswith('https://') or u.startswith('www.')):
                if not re.search(r'\.(?:com|br|org|net|io|me|site|store|shop|app|online|edu|gov)(?:/|$)', u, re.IGNORECASE):
                    continue
            cleaned.append(u)
    return list(dict.fromkeys(cleaned))

def normalize_for_comparison(url: str) -> str:
    """Normaliza protocolo e barras terminais para comparação precisa de caminhos e parâmetros."""
    u = url.strip().lower()
    u = re.sub(r'^https?://', '', u)
    u = re.sub(r'^www\.', '', u)
    return u.rstrip('/')

def validate_response_urls(draft_response: str, sources_text: str) -> Tuple[bool, str]:
    """
    Valida de forma determinística que todas as URLs do draft_response:
    1. Não foram inventadas/alucinadas.
    2. Não foram comprimidas, truncadas ou encurtadas em relação à fonte original.
    """
    draft_urls = extract_urls(draft_response)
    if not draft_urls:
        return True, ""

    source_urls = extract_urls(sources_text)
    source_norm_map = {normalize_for_comparison(su): su for su in source_urls}

    for du in draft_urls:
        du_norm = normalize_for_comparison(du)

        # 1. Correspondência exata (mesmo caminho e parâmetros)
        if du_norm in source_norm_map:
            continue

        # 2. Se a URL gerada é uma versão comprimida/truncada de alguma URL da fonte
        truncated_match = None
        for su in source_urls:
            su_norm = normalize_for_comparison(su)
            if su_norm.startswith(du_norm) and len(su_norm) > len(du_norm):
                truncated_match = su
                break

        if truncated_match:
            return False, (
                f"A URL '{du}' foi comprimida ou truncada. Envie a URL exatamente e integralmente "
                f"como ela consta na base de conhecimento ou diretrizes da empresa: '{truncated_match}'."
            )

        # 3. Checagem se existe literalmente no texto bruto das fontes
        if du in sources_text:
            continue

        # 4. Caso contrário, a URL foi inventada ou alterada
        return False, (
            f"A URL '{du}' não foi encontrada no contexto recuperado ou nas diretrizes da empresa. "
            f"NUNCA invente ou altere URLs."
        )

    return True, ""


MEDIA_TAG_GENERAL_REGEX = re.compile(r'\[(?:MEDIA|ARQUIVO|IMAGEM|DOC|FOTO|VIDEO):\s*([^\]]+)\]', re.IGNORECASE)

def extract_media_tags(text: str) -> List[str]:
    """Extrai todos os identificadores ou descrições passadas em tags de mídia."""
    if not text:
        return []
    matches = MEDIA_TAG_GENERAL_REGEX.findall(text)
    return [m.strip() for m in matches if m.strip()]

def validate_response_media(
    draft_response: str, 
    media_file_ids: List[str], 
    sources_text: str
) -> Tuple[bool, str]:
    """
    Valida de forma determinística que todas as tags de mídia do draft_response:
    1. Não utilizam nomes descritivos com espaços ou títulos em português no lugar do id_arquivo.
    2. Usam um id_arquivo existente no contexto recuperado / fontes.
    3. Se prometeu envio de vídeo/foto, incluiu a tag correspondente ou media_file_ids.
    """
    tags = extract_media_tags(draft_response)
    
    for tag in tags:
        # Se contiver espaços ou texto descritivo
        if " " in tag:
            return False, (
                f"A tag '[MEDIA: {tag}]' contém texto descritivo com espaços em vez do 'id_arquivo' técnico do Google Drive. "
                f"Use estritamente o código exato presente no campo 'id_arquivo' dos documentos recuperados da base de conhecimento (ex: [MEDIA: 1PLqahFtwRcDQv8TPkIU97g-wsJ0WRXkA])."
            )
        
        # Se a tag não aparece no texto das fontes recuperadas
        if tag not in sources_text:
            return False, (
                f"O identificador de mídia '[MEDIA: {tag}]' não foi encontrado no contexto RAG recuperado. "
                f"Utilize estritamente o 'id_arquivo' do Google Drive fornecido no contexto de documentos."
            )

    # Checagem de promessa explícita de mídia sem tag ou sem media_file_ids
    lower_draft = (draft_response or "").lower()
    media_promise_patterns = [
        r'\b(?:veja|assista|segue|confira|envio|estou enviando)\s+(?:o\s+)?(?:vídeo|video)\b',
        r'\b(?:veja|segue|confira|envio|estou enviando)\s+(?:a\s+)?(?:foto|imagem)\b',
        r'\b(?:segue|envio|estou enviando)\s+(?:o\s+)?(?:catálogo|catalogo|pdf|documento)\b',
    ]
    has_promise = any(re.search(pat, lower_draft) for pat in media_promise_patterns)
    has_attached_media = bool(tags or (media_file_ids and len(media_file_ids) > 0))

    if has_promise and not has_attached_media:
        if "id_arquivo" in sources_text:
            return False, (
                "A mensagem informa ao cliente que está enviando/mostrando um vídeo, foto ou catálogo, "
                "mas não incluiu a tag [MEDIA: id_arquivo] nem preencheu o campo media_file_ids. "
                "Insira a tag [MEDIA: <id_exato>] com o id_arquivo presente no contexto RAG."
            )

    return True, ""


async def guardrail_node(state: AgentState) -> Dict[str, Any]:
    """
    Nó 5: Juiz Guardrail Anti-Alucinação e Auditor Soberano de Atendimento.
    Em uma ÚNICA chamada semântica, audita:
    1. Factualidade e Grounding da resposta (zero alucinação).
    2. Validade Semântica do Transbordo Humano (aprova ou rejeita transferências).
    3. Integridade de URLs, mídias, tom de voz e regras da Persona.

    @param state: Estado atual do grafo.
    @returns: Dicionário com 'validation_passed', 'critique', 'approve_handoff' e 'retry_count'.
    """
    gemini_svc = get_gemini_service()
    model_name = state.get("ai_model") or "gemini-3.5-flash-lite"
    draft_response = state.get("draft_response", "")
    retrieved_context = state.get("retrieved_context") or "Nenhum contexto recuperado."
    tool_results = state.get("tool_results") or []
    retry_count = state.get("retry_count", 0)
    last_processed_msg_id = state.get("last_processed_msg_id", 0)
    intent_handoff_proposto = bool(state.get("intent_handoff"))

    # Verificação de nova mensagem do cliente antes do julgamento
    if last_processed_msg_id > 0:
        async with SessionLocal() as db_check_guard:
            if await crud_atendimento.has_newer_user_messages(db_check_guard, state.get("atendimento_id"), state.get("tenant_id"), last_processed_msg_id):
                logger.info(f"[Guardrail Node] Nova mensagem do cliente detectada antes da avaliação (Atend {state.get('atendimento_id')}). Abortando ciclo.")
                raise asyncio.CancelledError()

    # Formatação do histórico para o Juiz
    history = state.get("conversation_history") or []
    history_str = format_conversation_history(history, max_messages=50)
    if state.get("user_input"):
        history_str = f"{history_str}\n\nUSER: {state.get('user_input')}".strip()

    persona_prompt = state.get("persona_prompt") or ""
    workflow_context = state.get("workflow_context") or ""
    workflow_sec = f"\n--- ROTEIRO / FLUXO DE ATENDIMENTO ---\n{workflow_context}\n" if workflow_context else ""
    
    resumo_crm = state.get("resumo_crm")
    resumo_sec = f"\n--- RESUMO CONSOLIDADO DO CRM ---\n{resumo_crm.strip()}\n" if resumo_crm and resumo_crm.strip() else ""
    
    tools_summary = "\n".join([f"- Ferramenta {t.get('tool_name')}: {t.get('result')}" for t in tool_results])

    send_as_audio = state.get("send_as_audio", False)
    formato_envio = "MENSAGEM DE VOZ / ÁUDIO NO WHATSAPP (Sintetizada por TTS)" if send_as_audio else "TEXTO NO WHATSAPP"

    destinatario_transbordo = state.get("handoff_destinatario") or "Equipe Geral"
    status_proposto = "SOLICITAÇÃO DE TRANSBORDO PARA EQUIPE" if intent_handoff_proposto else "ATENDIMENTO DIRETO PELA IA (SEM TRANSBORDO)"

    eval_prompt = f"""--- DIRETRIZES DA PERSONA / EMPRESA ---
{persona_prompt}
{workflow_sec}
{resumo_sec}

--- HISTÓRICO DA CONVERSA ---
{history_str}

--- CONTEXTO RECUPERADO DA BASE DE CONHECIMENTO ---
{retrieved_context}

--- RETORNO DE FERRAMENTAS ---
{tools_summary if tools_summary else 'Nenhuma ferramenta executada.'}

--- FORMATO DE ENVIO PLANEJADO ---
Formato: {formato_envio}

--- AÇÃO PROPOSTA PELA IA PARA AUDITORIA DO JUIZ ---
Status de Transbordo Proposto: {status_proposto} (Destinatário: {destinatario_transbordo})
Mensagem Gerada para Avaliação:
{draft_response}
"""

    # Validação determinística de URLs (garantia de não corrupção de links)
    sources_text_combined = f"{persona_prompt}\n{workflow_sec}\n{resumo_sec}\n{history_str}\n{retrieved_context}\n{tools_summary}"
    urls_valid, url_critique = validate_response_urls(draft_response, sources_text_combined)
    if not urls_valid:
        logger.warning(f"[Guardrail Node] Reprovação de integridade de URLs: {url_critique}")

    # Validação determinística de Mídias (garantia de IDs válidos e envio real)
    media_valid, media_critique = validate_response_media(
        draft_response=draft_response,
        media_file_ids=state.get("media_file_ids") or [],
        sources_text=sources_text_combined
    )
    if not media_valid:
        logger.warning(f"[Guardrail Node] Reprovação de integridade de Mídias: {media_critique}")

    try:
        clean_model = model_name.replace("google:", "").replace("google-cloud:", "")
        config = types.GenerateContentConfig(
            system_instruction=GUARDRAIL_JUDGE_PROMPT,
            response_mime_type="application/json",
            response_schema=EvaluationResult,
            temperature=0.0,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True)
        )

        response = await gemini_svc.client.aio.models.generate_content(
            model=clean_model,
            contents=eval_prompt,
            config=config
        )

        eval_data = json.loads(response.text)
        evaluation = EvaluationResult(**eval_data)

        # Verificação se nova mensagem chegou durante o julgamento do guardrail
        if last_processed_msg_id > 0:
            async with SessionLocal() as db_check_guard_post:
                if await crud_atendimento.has_newer_user_messages(db_check_guard_post, state.get("atendimento_id"), state.get("tenant_id"), last_processed_msg_id):
                    logger.info(f"[Guardrail Node] Nova mensagem do cliente detectada logo após avaliação (Atend {state.get('atendimento_id')}). Abortando ciclo.")
                    raise asyncio.CancelledError()

        # Contabilização de tokens
        usage = getattr(response, "usage_metadata", None)
        in_tokens = (getattr(usage, "prompt_token_count", 0) or 0) + (getattr(usage, "tool_use_prompt_token_count", 0) or 0)
        candidates_tokens = getattr(usage, "candidates_token_count", 0) or 0
        thoughts_tokens = getattr(usage, "thoughts_token_count", 0) or 0
        out_tokens = candidates_tokens + thoughts_tokens
        total_tokens = getattr(usage, "total_token_count", 0) or 0
        if total_tokens > (in_tokens + out_tokens):
            out_tokens += (total_tokens - (in_tokens + out_tokens))

        logger.info(
            f"[Guardrail Node] Veredito do Juiz (Atend {state.get('atendimento_id')}): "
            f"is_valid={evaluation.is_valid}, approve_handoff={evaluation.approve_handoff}, "
            f"reason='{evaluation.reason}', critique='{evaluation.critique}'"
        )

        # Se as URLs ou Mídias falharam na checagem estrita, reprova conjuntamente
        final_is_valid = evaluation.is_valid and urls_valid and media_valid

        audit_trail = dict(state.get("ai_audit_trail") or {})
        iterations = list(audit_trail.get("iterations") or [])
        if iterations:
            iterations[-1]["guardrail"] = {
                "is_valid": evaluation.is_valid,
                "approve_handoff": evaluation.approve_handoff,
                "critique": evaluation.critique,
                "reason": evaluation.reason,
                "urls_valid": urls_valid,
                "url_critique": url_critique if not urls_valid else None,
                "media_valid": media_valid,
                "media_critique": media_critique if not media_valid else None
            }
        audit_trail["iterations"] = iterations

        if not final_is_valid:
            critique_list = []
            if not urls_valid and url_critique:
                critique_list.append(url_critique)
            if not media_valid and media_critique:
                critique_list.append(media_critique)
            if evaluation.critique and evaluation.critique.strip().lower() != "aprovado":
                critique_list.append(evaluation.critique)
            final_critique = " | ".join(critique_list) if critique_list else "Proposta reprovada pelo Juiz de atendimento."

            return {
                "validation_passed": False,
                "approve_handoff": False,
                "intent_handoff": False,
                "critique": final_critique,
                "retry_count": retry_count + 1,
                "ai_audit_trail": audit_trail,
                "input_tokens": state.get("input_tokens", 0) + in_tokens,
                "output_tokens": state.get("output_tokens", 0) + out_tokens
            }
        else:
            # Resposta aprovada pelo Juiz
            handoff_aprovado = bool(evaluation.approve_handoff)
            is_conclude = bool(state.get("intent_conclude") or state.get("status_final") == "Concluído")
            
            if handoff_aprovado:
                status_final_val = "Atendente Chamado"
            elif is_conclude:
                status_final_val = "Concluído"
            else:
                status_final_val = "Aguardando Resposta"

            return {
                "validation_passed": True,
                "approve_handoff": handoff_aprovado,
                "intent_handoff": handoff_aprovado,
                "critique": "",
                "final_response": draft_response,
                "status_final": status_final_val,
                "ai_audit_trail": audit_trail,
                "input_tokens": state.get("input_tokens", 0) + in_tokens,
                "output_tokens": state.get("output_tokens", 0) + out_tokens
            }


    except Exception as e:
        logger.error(f"[Guardrail Node] Erro na avaliação do Juiz: {e}", exc_info=True)
        if not urls_valid:
            return {
                "validation_passed": False,
                "critique": url_critique,
                "retry_count": retry_count + 1
            }
        if not media_valid:
            return {
                "validation_passed": False,
                "critique": media_critique,
                "retry_count": retry_count + 1
            }
        # Em caso de falha de conexão do juiz, aprova mantendo status seguro
        return {
            "validation_passed": True,
            "critique": "",
            "final_response": draft_response,
            "intent_handoff": False,
            "status_final": state.get("status_final") or "Aguardando Resposta"
        }
