import json
import logging
from datetime import datetime, timezone
from typing import Dict, Any


from google.genai import types
from app.graph.state import AgentState, RouterDecision
from app.graph.prompts import ROUTER_SYSTEM_PROMPT
from app.graph.history_utils import (
    format_conversation_history, 
    is_false_handoff_trigger, 
    synthesize_contextual_search_query
)
from app.services.gemini_service import get_gemini_service

logger = logging.getLogger(__name__)

async def router_node(state: AgentState) -> Dict[str, Any]:
    """
    Nó 1: Avalia a entrada do usuário e classifica a intenção em RAG, Tool, Chat Direto ou Handoff.

    @param state: Estado atual do grafo.
    @returns: Dicionário com campos atualizados do estado.
    """
    gemini_svc = get_gemini_service()
    user_input = state.get("user_input", "")
    history = state.get("conversation_history", [])
    model_name = state.get("ai_model") or "gemini-3.5-flash-lite"
    resumo_crm = state.get("resumo_crm")

    # Constrói o histórico coeso e abrangente para o roteador
    history_str = format_conversation_history(history, max_messages=40)
    resumo_sec = f"\n--- RESUMO DO HISTÓRICO ANTERIOR (CRM) ---\n{resumo_crm.strip()}\n" if resumo_crm and resumo_crm.strip() else ""

    user_prompt = f"""{resumo_sec}--- HISTÓRICO DA CONVERSA ---
{history_str}

--- MENSAGEM ATUAL DO CLIENTE ---
USER: {user_input}
"""

    try:
        clean_model = model_name.replace("google:", "").replace("google-cloud:", "")
        config = types.GenerateContentConfig(
            system_instruction=ROUTER_SYSTEM_PROMPT,
            response_mime_type="application/json",
            response_schema=RouterDecision,
            temperature=0.1,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True)
        )

        response = await gemini_svc.client.aio.models.generate_content(
            model=clean_model,
            contents=user_prompt,
            config=config
        )

        # Parseia o retorno estruturado
        decision_data = json.loads(response.text)
        decision = RouterDecision(**decision_data)

        # Contabilização de tokens (incluindo pensamentos / reasoning)
        usage = getattr(response, "usage_metadata", None)
        in_tokens = (getattr(usage, "prompt_token_count", 0) or 0) + (getattr(usage, "tool_use_prompt_token_count", 0) or 0)
        candidates_tokens = getattr(usage, "candidates_token_count", 0) or 0
        thoughts_tokens = getattr(usage, "thoughts_token_count", 0) or 0
        out_tokens = candidates_tokens + thoughts_tokens
        total_tokens = getattr(usage, "total_token_count", 0) or 0
        if total_tokens > (in_tokens + out_tokens):
            out_tokens += (total_tokens - (in_tokens + out_tokens))

        logger.info(
            f"[Router Node] Decisão para Atend {state.get('atendimento_id')}: "
            f"intent='{decision.intent}', query='{decision.search_query}', tool='{decision.tool_to_call}'"
        )

        # Parseia tool_args se veio como string JSON ou dict
        parsed_tool_args = {}
        if decision.tool_args:
            if isinstance(decision.tool_args, dict):
                parsed_tool_args = decision.tool_args
            elif isinstance(decision.tool_args, str):
                try:
                    parsed_tool_args = json.loads(decision.tool_args)
                except Exception:
                    parsed_tool_args = {}

        final_intent = decision.intent
        final_tool = decision.tool_to_call
        final_search_query = decision.search_query
        final_target_category = decision.target_category
        handoff_dest = decision.handoff_destinatario.strip() if decision.handoff_destinatario and decision.handoff_destinatario.strip() else None

        # 1. Interceptação determinística de falso positivo de transbordo
        if final_intent == "handoff" or final_tool == "transferir_para_atendente":
            from app.graph.handoff_policy import should_allow_handoff, is_sales_or_inquiry_intent
            allowed, reason = should_allow_handoff(user_input=user_input, history=history)
            if not allowed:
                logger.warning(
                    f"[Router Node] Falso positivo de handoff interceptado para Atend {state.get('atendimento_id')} "
                    f"(user_input='{user_input}'). Motivo: {reason}. Reclassificando para 'rag'."
                )
                final_intent = "rag"
                final_tool = None
                handoff_dest = None
                final_search_query = synthesize_contextual_search_query(user_input, history, final_search_query)

        # 2. Se a mensagem foi classificada como 'direct_chat' mas contém interesse comercial/orçamento/dúvidas, promove para 'rag'
        if final_intent == "direct_chat":
            from app.graph.handoff_policy import is_sales_or_inquiry_intent
            if is_sales_or_inquiry_intent(user_input):
                logger.info(
                    f"[Router Node] Mensagem de direct_chat contém interesse comercial/orçamento para Atend {state.get('atendimento_id')}. "
                    f"Promovendo para 'rag'."
                )
                final_intent = "rag"
                final_search_query = synthesize_contextual_search_query(user_input, history, user_input)

        # 3. Se a intenção final for RAG, garante query de busca enriquecida com o histórico recente
        if final_intent == "rag":
            final_search_query = synthesize_contextual_search_query(user_input, history, final_search_query)

        is_handoff = bool(final_intent == "handoff" or final_tool == "transferir_para_atendente")
        is_conclude = bool(final_intent == "conclude" or final_tool == "concluir_atendimento")

        audit_trail = {
            "turn_timestamp": datetime.now(timezone.utc).isoformat(),
            "user_input": user_input,
            "router": {
                "intent": final_intent,
                "search_query": final_search_query,
                "target_category": final_target_category,
                "tool_to_call": final_tool,
                "tool_args": parsed_tool_args,
                "intent_handoff": is_handoff,
                "reason": decision.reason if hasattr(decision, "reason") else None
            },
            "retrieval": None,
            "tools": [],
            "iterations": [],
            "fallback": None,
            "final_outcome": None
        }

        return {
            "intent_category": final_intent,
            "search_query": final_search_query,
            "target_category": final_target_category,
            "tool_to_call": final_tool,
            "tool_args": parsed_tool_args,
            "intent_handoff": is_handoff,
            "intent_conclude": is_conclude,
            "handoff_destinatario": handoff_dest if is_handoff else None,
            "ai_audit_trail": audit_trail,
            "input_tokens": state.get("input_tokens", 0) + in_tokens,
            "output_tokens": state.get("output_tokens", 0) + out_tokens
        }

    except Exception as e:
        logger.error(f"[Router Node] Erro no roteamento: {e}. Aplicando fallback para RAG.", exc_info=True)
        fallback_query = synthesize_contextual_search_query(user_input, history, user_input)
        audit_trail = {
            "turn_timestamp": datetime.now(timezone.utc).isoformat(),
            "user_input": user_input,
            "router": {
                "intent": "rag",
                "search_query": fallback_query,
                "target_category": None,
                "tool_to_call": None,
                "tool_args": {},
                "intent_handoff": False,
                "error": str(e)
            },
            "retrieval": None,
            "tools": [],
            "iterations": [],
            "fallback": None,
            "final_outcome": None
        }
        return {
            "intent_category": "rag",
            "search_query": fallback_query,
            "target_category": None,
            "tool_to_call": None,
            "tool_args": {},
            "intent_handoff": False,
            "ai_audit_trail": audit_trail
        }



