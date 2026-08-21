import logging
from typing import Dict, Any

from google.genai import types
from app.graph.state import AgentState
from app.graph.prompts import FALLBACK_PROMPT
from app.services.gemini_service import get_gemini_service

logger = logging.getLogger(__name__)

async def fallback_node(state: AgentState) -> Dict[str, Any]:
    """
    Nó 6: Nó de Fallback e Transbordo Humano.
    Acionado quando retry_count >= 3 ou quando o cliente solicita atendimento humano diretamente.

    @param state: Estado atual do grafo.
    @returns: Dicionário com 'final_response' de transbordo e status 'Atendente Chamado'.
    """
    gemini_svc = get_gemini_service()
    model_name = state.get("ai_model") or "gemini-3.5-flash-lite"
    user_input = state.get("user_input", "")

    logger.warning(
        f"[Fallback Node] Acionando transbordo para Atend {state.get('atendimento_id')} "
        f"(Retries: {state.get('retry_count')}, Intent: {state.get('intent_category')})"
    )

    nature_identity = str(state.get("nature_identity") or "human").strip().lower()

    handoff_dest = state.get("handoff_destinatario")
    dest_prompt_str = f" para o(a) atendente ou setor '{handoff_dest}'" if handoff_dest else ""

    if nature_identity == "human":
        system_instruction_to_use = f"""Você é um atendente da equipe da empresa.
O atendimento precisa ser encaminhado{dest_prompt_str} para dar continuidade.
Gere uma mensagem curta, empática e 100% humanizada informando que você está passando o cliente{dest_prompt_str} para dar continuidade no atendimento.
REGRAS CRÍTICAS DE IDENTIDADE HUMANA:
- NUNCA use palavras como 'humano', 'robô', 'IA', 'assistente virtual' ou 'sistema'.
- Fale naturalmente como colega de trabalho: ex: "Entendido! Vou te passar aqui para o(a) {handoff_dest or 'colega da equipe'} que vai dar continuidade no seu atendimento. Só um instante!", "Perfeito! Estou transferindo aqui para o setor responsável te atender melhor por aqui."
- Use *negrito* com 1 asterisco se necessário.
"""
        fallback_msg = f"Entendido! Vou transferir seu atendimento para {handoff_dest or 'um colega da nossa equipe'} dar continuidade por aqui. Só um instante!"
    elif nature_identity == "ai":
        system_instruction_to_use = f"""Você é o Assistente Virtual de IA da empresa.
O sistema não conseguiu responder com total certeza ou o cliente solicitou atendimento humano.
Sua tarefa é gerar uma mensagem curta, empática e amigável informando que você está transferindo o atendimento{dest_prompt_str} e que em breve dará continuidade.
- Use *negrito* com 1 asterisco se necessário.
- Não invente respostas para a dúvida que não foi respondida.
"""
        fallback_msg = f"Entendido! Estou transferindo seu atendimento para {handoff_dest or 'a nossa equipe humana'}. Em instantes daremos continuidade por aqui. Obrigado pela paciência!"
    else:  # "ignore"
        system_instruction_to_use = f"""Você é o consultor de atendimento da empresa.
Gere uma mensagem curta e profissional informando que está direcionando o atendimento{dest_prompt_str} para dar continuidade.
- Não mencione robô nem humano. Use termos neutros como 'especialista da equipe' ou 'setor responsável'.
- Use *negrito* com 1 asterisco se necessário.
"""
        fallback_msg = f"Entendido! Estou direcionando seu atendimento para {handoff_dest or 'um especialista da nossa equipe'} que dará continuidade por aqui. Só um momento!"

    in_tokens = 0
    out_tokens = 0

    try:
        clean_model = model_name.replace("google:", "").replace("google-cloud:", "")
        config = types.GenerateContentConfig(
            system_instruction=system_instruction_to_use,
            temperature=0.3,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True)
        )
        response = await gemini_svc.client.aio.models.generate_content(
            model=clean_model,
            contents=f"Gere a mensagem de transbordo amigável para o cliente que disse: '{user_input}'",
            config=config
        )
        if response.text and response.text.strip():
            fallback_msg = response.text.strip()

        usage = getattr(response, "usage_metadata", None)
        if usage:
            in_tokens = (getattr(usage, "prompt_token_count", 0) or 0) + (getattr(usage, "tool_use_prompt_token_count", 0) or 0)
            candidates_tokens = getattr(usage, "candidates_token_count", 0) or 0
            thoughts_tokens = getattr(usage, "thoughts_token_count", 0) or 0
            out_tokens = candidates_tokens + thoughts_tokens
            total_tokens = getattr(usage, "total_token_count", 0) or 0
            if total_tokens > (in_tokens + out_tokens):
                out_tokens += (total_tokens - (in_tokens + out_tokens))

    except Exception as e:
        logger.error(f"[Fallback Node] Erro ao gerar mensagem personalizada de fallback: {e}")

    return {
        "final_response": fallback_msg,
        "status_final": "Atendente Chamado",
        "validation_passed": True,
        "input_tokens": state.get("input_tokens", 0) + in_tokens,
        "output_tokens": state.get("output_tokens", 0) + out_tokens
    }
