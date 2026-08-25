import json
import logging
from typing import Dict, Any

from google.genai import types
from app.graph.state import AgentState, RouterDecision
from app.graph.prompts import ROUTER_SYSTEM_PROMPT
from app.graph.history_utils import format_conversation_history
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

        handoff_dest = decision.handoff_destinatario.strip() if decision.handoff_destinatario and decision.handoff_destinatario.strip() else None

        return {
            "intent_category": decision.intent,
            "search_query": decision.search_query,
            "target_category": decision.target_category,
            "tool_to_call": decision.tool_to_call,
            "tool_args": parsed_tool_args,
            "intent_handoff": decision.intent == "handoff" or decision.tool_to_call == "transferir_para_atendente",
            "handoff_destinatario": handoff_dest,
            "input_tokens": state.get("input_tokens", 0) + in_tokens,
            "output_tokens": state.get("output_tokens", 0) + out_tokens
        }

    except Exception as e:
        logger.error(f"[Router Node] Erro no roteamento: {e}. Aplicando fallback para RAG.", exc_info=True)
        return {
            "intent_category": "rag",
            "search_query": user_input,
            "target_category": None,
            "tool_to_call": None,
            "tool_args": {}
        }
