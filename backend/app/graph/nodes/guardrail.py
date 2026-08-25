import re
import json
import asyncio
import logging
from typing import Dict, Any

from google.genai import types
from app.graph.state import AgentState, EvaluationResult
from app.graph.prompts import GUARDRAIL_JUDGE_PROMPT
from app.graph.history_utils import format_conversation_history
from app.services.gemini_service import get_gemini_service
from app.db.database import SessionLocal
from app.crud import crud_atendimento

logger = logging.getLogger(__name__)

async def guardrail_node(state: AgentState) -> Dict[str, Any]:
    """
    Nó 5: Juiz Guardrail Anti-Alucinação.
    Avalia se o draft_response é 100% suportado pelo contexto e regras do tenant.

    @param state: Estado atual do grafo.
    @returns: Dicionário com 'validation_passed', 'critique' e 'retry_count'.
    """
    gemini_svc = get_gemini_service()
    model_name = state.get("ai_model") or "gemini-3.5-flash-lite"
    draft_response = state.get("draft_response", "")
    retrieved_context = state.get("retrieved_context") or "Nenhum contexto recuperado."
    tool_results = state.get("tool_results") or []
    retry_count = state.get("retry_count", 0)
    last_processed_msg_id = state.get("last_processed_msg_id", 0)

    # Verificação de nova mensagem do cliente antes do julgamento
    if last_processed_msg_id > 0:
        async with SessionLocal() as db_check_guard:
            if await crud_atendimento.has_newer_user_messages(db_check_guard, state.get("atendimento_id"), state.get("tenant_id"), last_processed_msg_id):
                logger.info(f"[Guardrail Node] Nova mensagem do cliente detectada antes da avaliação (Atend {state.get('atendimento_id')}). Abortando ciclo.")
                raise asyncio.CancelledError()

    # Avaliação de Grounding pelo Juiz LLM com histórico coeso
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
(Nota: A IA tem capacidade total de sintetizar o texto em voz humana e enviá-lo como áudio real no WhatsApp).

--- RESPOSTA GERADA PARA AVALIAÇÃO ---
{draft_response}
"""

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
            f"[Guardrail Node] Resultado da avaliação: is_valid={evaluation.is_valid}, "
            f"critique='{evaluation.critique}'"
        )

        if evaluation.is_valid:
            return {
                "validation_passed": True,
                "critique": "",
                "final_response": draft_response,
                "input_tokens": state.get("input_tokens", 0) + in_tokens,
                "output_tokens": state.get("output_tokens", 0) + out_tokens
            }
        else:
            return {
                "validation_passed": False,
                "critique": evaluation.critique,
                "retry_count": retry_count + 1,
                "input_tokens": state.get("input_tokens", 0) + in_tokens,
                "output_tokens": state.get("output_tokens", 0) + out_tokens
            }

    except Exception as e:
        logger.error(f"[Guardrail Node] Erro na avaliação do juiz: {e}. Aprovando com cautela.", exc_info=True)
        return {
            "validation_passed": True,
            "critique": "",
            "final_response": draft_response
        }
