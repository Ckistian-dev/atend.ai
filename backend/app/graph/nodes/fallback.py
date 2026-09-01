import logging
from typing import Dict, Any

from google.genai import types
from app.graph.state import AgentState
from app.graph.handoff_policy import should_allow_handoff
from app.services.gemini_service import get_gemini_service
from app.graph.prompts import FALLBACK_PROMPT, RESILIENT_FALLBACK_PROMPT

logger = logging.getLogger(__name__)

async def fallback_node(state: AgentState) -> Dict[str, Any]:
    """
    Nó 6: Nó de Fallback e Tratamento Resiliente.
    Acionado quando retry_count >= 3 ou quando o fluxo de transbordo é acionado.

    - Se o cliente NÃO solicitou atendimento humano (should_allow_handoff == False):
      Gera mensagem resiliente informando que a informação não foi localizada, mantendo
      o atendimento ativo com a IA (status_final = 'Aguardando Resposta').
    - Se o cliente realmente pediu atendente ou há regra válida de transbordo:
      Executa a transferência humanizada para a equipe (status_final = 'Atendente Chamado').

    @param state: Estado atual do grafo.
    @returns: Dicionário com 'final_response', status adequado e tokens consumidos.
    """
    gemini_svc = get_gemini_service()
    model_name = state.get("ai_model") or "gemini-3.5-flash-lite"
    user_input = state.get("user_input", "")
    history = state.get("conversation_history", [])

    logger.warning(
        f"[Fallback Node] Acionado para Atend {state.get('atendimento_id')} "
        f"(Retries: {state.get('retry_count')}, Intent: {state.get('intent_category')})"
    )

    in_tokens = 0
    out_tokens = 0

    # ──────────────────────────────────────────────────────────────────────────
    # 1. Validação Central de Transbordo (Handoff Policy)
    # ──────────────────────────────────────────────────────────────────────────
    allowed_handoff, reason = should_allow_handoff(
        user_input=user_input,
        history=history,
        requested_by_ai=True
    )

    # ──────────────────────────────────────────────────────────────────────────
    # CASO A: Falso Transbordo / Informação Não Localizada -> Resiliência Ativa
    # ──────────────────────────────────────────────────────────────────────────
    if not allowed_handoff:
        logger.warning(
            f"[Fallback Node] Transbordo não autorizado para Atend {state.get('atendimento_id')}. "
            f"Motivo: {reason}. Gerando resposta resiliente (sem transferir)."
        )
        fallback_msg = "Não localizei essa informação específica aqui no momento. Para confirmar com certeza, recomendo verificar diretamente no canal ou site oficial. Posso te ajudar com mais alguma coisa?"
        try:
            clean_model = model_name.replace("google:", "").replace("google-cloud:", "")
            config = types.GenerateContentConfig(
                system_instruction=RESILIENT_FALLBACK_PROMPT,
                temperature=0.3,
                automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True)
            )
            response = await gemini_svc.client.aio.models.generate_content(
                model=clean_model,
                contents=f"O cliente perguntou: '{user_input}'\nGere a resposta resiliente informando que não localizou a informação específica.",
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
            logger.error(f"[Fallback Node] Erro ao gerar resposta resiliente: {e}")

        audit_trail = dict(state.get("ai_audit_trail") or {})
        audit_trail["fallback"] = {
            "type": "resilient_not_found",
            "fallback_msg": fallback_msg,
            "status_final": "Aguardando Resposta",
            "intent_handoff": False,
            "reason": reason
        }


        return {
            "final_response": fallback_msg,
            "status_final": "Aguardando Resposta",
            "intent_handoff": False,
            "validation_passed": True,
            "ai_audit_trail": audit_trail,
            "input_tokens": state.get("input_tokens", 0) + in_tokens,
            "output_tokens": state.get("output_tokens", 0) + out_tokens
        }


    # ──────────────────────────────────────────────────────────────────────────
    # CASO B: Transbordo Legítimo e Autorizado
    # ──────────────────────────────────────────────────────────────────────────
    logger.info(f"[Fallback Node] Executando transbordo legítimo para Atend {state.get('atendimento_id')}. Motivo: {reason}")
    nature_identity = str(state.get("nature_identity") or "human").strip().lower()

    team_members = state.get("team_members") or []
    raw_dest = state.get("handoff_destinatario")
    resolved_dest_name = None

    # Filtra membros públicos válidos (não-admin)
    public_members = [
        m for m in team_members
        if not m.get("is_admin")
        and m.get("role") != "admin"
        and (m.get("name") or "").strip().lower() not in ["admin", "administrador"]
        and (m.get("department") or "").strip().lower() not in ["admin", "administrador"]
    ]

    if raw_dest and str(raw_dest).strip() and public_members:
        clean_d = str(raw_dest).strip().lower()
        if clean_d not in ["admin", "administrador"]:
            for m in public_members:
                m_name = (m.get("name") or "").strip().lower()
                m_dept = (m.get("department") or "").strip().lower()
                if clean_d in m_name or m_name in clean_d:
                    resolved_dest_name = m.get("name")
                    break
                if m_dept and (clean_d in m_dept or m_dept in clean_d):
                    resolved_dest_name = m.get("department")
                    break

    if not resolved_dest_name and len(public_members) == 1:
        single_m = public_members[0]
        resolved_dest_name = single_m.get("department") or single_m.get("name")

    nome_cliente = (state.get("nome_cliente") or "").strip().lower()

    if resolved_dest_name:
        clean_dest = resolved_dest_name.strip().lower()
        if clean_dest in ["admin", "administrador"] or (nome_cliente and (clean_dest == nome_cliente or clean_dest in nome_cliente or nome_cliente in clean_dest)):
            resolved_dest_name = None

    dest_prompt_str = f" para {resolved_dest_name}" if resolved_dest_name else " para a nossa equipe"

    if nature_identity == "human":
        system_instruction_to_use = f"""Você é um atendente da equipe da empresa.
O atendimento precisa ser encaminhado{dest_prompt_str} para dar continuidade.
Gere uma mensagem curta, empática, direta e 100% humanizada informando que você está passando o cliente para a nossa equipe dar continuidade no atendimento.
REGRAS CRÍTICAS DE IDENTIDADE HUMANA:
- 🚨 NUNCA use o nome do PRÓPRIO CLIENTE na mensagem de transferência (ex: NUNCA diga 'vou te passar para [Nome do Cliente]').
- Use sempre termos de equipe como 'nossa equipe' ou 'um colega da nossa equipe' (ex: \"Vou te passar aqui para a nossa equipe dar continuidade no seu atendimento. Só um instante!\").
- NUNCA use palavras como 'humano', 'robô', 'IA', 'assistente virtual' ou 'sistema'.
- NUNCA mencione 'Admin', 'Administrador' ou termos técnicos.
- NUNCA invente nomes, cargos ou setores que não existam na equipe da empresa.
- NUNCA inicie com interjeições robóticas como 'Entendido!', 'Perfeito!', 'Com certeza!' ou 'Isso mesmo!'.
- NUNCA reinicie com saudações como 'Oi, [Nome]!' ou 'Tudo bem?'.
- Use *negrito* com 1 asterisco se necessário.
"""
        fallback_msg = f"Vou transferir seu atendimento para a nossa equipe dar continuidade por aqui. Só um instante!"
    elif nature_identity == "ai":
        system_instruction_to_use = f"""Você é o Assistente Virtual de IA da empresa.
O sistema não conseguiu responder com total certeza ou o cliente solicitou atendimento humano.
Sua tarefa é gerar uma mensagem curta, empática, direta e amigável informando que você está transferindo o atendimento para a nossa equipe.
- 🚨 NUNCA use o nome do PRÓPRIO CLIENTE na mensagem de transferência (ex: NUNCA diga 'vou te passar para [Nome do Cliente]').
- Transfira sempre para 'a nossa equipe'.
- NUNCA mencione 'Admin' ou 'Administrador'.
- NUNCA inicie com interjeições robóticas como 'Entendido!', 'Perfeito!', 'Com certeza!' ou 'Isso mesmo!'.
- NUNCA reinicie com saudações como 'Oi, [Nome]!' ou 'Tudo bem?'.
- Use *negrito* com 1 asterisco se necessário.
"""
        fallback_msg = f"Estou transferindo seu atendimento para a nossa equipe. Em instantes daremos continuidade por aqui. Obrigado pela paciência!"
    else:  # "ignore"
        system_instruction_to_use = f"""Você é o consultor de atendimento da empresa.
Gere uma mensagem curta, direta e profissional informando que está direcionando o atendimento{dest_prompt_str} para dar continuidade.
- Não mencione robô nem humano. Use termos neutros como 'nossa equipe' ou 'o setor responsável'.
- NUNCA mencione 'Admin' ou 'Administrador'.
- NUNCA inicie com interjeições robóticas como 'Entendido!', 'Perfeito!', 'Com certeza!' ou 'Isso mesmo!'.
- NUNCA reinicie com saudações como 'Oi, [Nome]!' ou 'Tudo bem?'.
- Use *negrito* com 1 asterisco se necessário.
"""
        fallback_msg = f"Estou direcionando seu atendimento para {resolved_dest_name or 'nossa equipe'} que dará continuidade por aqui. Só um momento!"

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

    audit_trail = dict(state.get("ai_audit_trail") or {})
    audit_trail["fallback"] = {
        "type": "authorized_handoff",
        "fallback_msg": fallback_msg,
        "status_final": "Atendente Chamado",
        "intent_handoff": True,
        "destination": resolved_dest_name or "nossa equipe",
        "reason": reason
    }

    return {
        "final_response": fallback_msg,
        "status_final": "Atendente Chamado",
        "intent_handoff": True,
        "validation_passed": True,
        "ai_audit_trail": audit_trail,
        "input_tokens": state.get("input_tokens", 0) + in_tokens,
        "output_tokens": state.get("output_tokens", 0) + out_tokens
    }

