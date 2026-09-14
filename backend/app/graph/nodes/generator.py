import re
import json
import asyncio
import logging
from typing import Dict, Any

from google.genai import types
from app.graph.state import AgentState, GeneratorOutput
from app.graph.prompts import GENERATOR_SYSTEM_PROMPT
from app.graph.history_utils import format_conversation_history
from app.services.gemini_service import get_gemini_service
from app.db.database import SessionLocal
from app.crud import crud_atendimento

logger = logging.getLogger(__name__)

MEDIA_TAG_REGEX = re.compile(r'\[(?:MEDIA|ARQUIVO|IMAGEM|DOC|FOTO|VIDEO):\s*([^\]]+)\]', re.IGNORECASE)

async def generator_node(state: AgentState) -> Dict[str, Any]:
    """
    Nó 4: Geração de Resposta estritamente ancorada no contexto e ferramentas.
    Se houver 'critique' de uma tentativa anterior, injeta instruções de correção.

    @param state: Estado atual do grafo.
    @returns: Dicionário com 'draft_response' e 'resumo_crm'.
    """
    gemini_svc = get_gemini_service()
    model_name = state.get("ai_model") or "gemini-3.5-flash-lite"
    user_input = state.get("user_input", "")
    history = state.get("conversation_history", [])
    critique = state.get("critique")
    retrieved_context = state.get("retrieved_context") or "Nenhum contexto RAG consultado."
    tool_results = state.get("tool_results")
    last_processed_msg_id = state.get("last_processed_msg_id", 0)

    # Verificação de nova mensagem do cliente antes de gerar
    if last_processed_msg_id > 0:
        async with SessionLocal() as db_check_gen:
            if await crud_atendimento.has_newer_user_messages(db_check_gen, state.get("atendimento_id"), state.get("tenant_id"), last_processed_msg_id):
                logger.info(f"[Generator Node] Nova mensagem do cliente detectada antes da geração (Atend {state.get('atendimento_id')}). Abortando ciclo.")
                raise asyncio.CancelledError()

    # 1. Seção de Crítica (Loop de Auto-Correção)
    if critique and critique.strip() and critique.strip().lower() != "aprovado":
        secao_critica = f"""🚨 ALERTA DE AUTO-CORREÇÃO DO JUIZ:
Sua resposta anterior foi REJEITADA com a seguinte crítica:
"{critique}"
Você DEVE corrigir este erro agora. Remova afirmações não suportadas e siga estritamente o contexto.
🚨 SALVAGUARDA DE FACTUALIDADE: Baseie-se ESTRITAMENTE nos dados reais informados pelo cliente e no contexto RAG recuperado. Ignore quaisquer medidas, números ou dados técnicos citados na crítica que não tenham sido expressamente informados pelo cliente ou pela base de conhecimento.
"""
    else:
        secao_critica = ""

    # 2. Formatação dos retornos de ferramentas e resumo anterior
    tool_results_str = "Nenhuma ferramenta executada nesta rodada."
    if tool_results:
        tool_results_str = "\n".join([f"- Ferramenta {t.get('tool_name')}: {t.get('result')}" for t in tool_results])

    resumo_crm_anterior = state.get("resumo_crm")
    resumo_anterior_sec = f"\n--- RESUMO ANTERIOR DO CRM ---\n{resumo_crm_anterior}\n" if resumo_crm_anterior else ""

    nome_cliente_atual = state.get("nome_cliente")
    nome_cliente_info = nome_cliente_atual.strip() if nome_cliente_atual and str(nome_cliente_atual).strip() else "Não cadastrado / Desconhecido"

    current_tags = state.get("current_tags") or []
    tags_atuais_info = ", ".join([f"'{t}'" for t in current_tags]) if current_tags else "Nenhuma tag aplicada ainda"

    available_tags = state.get("available_tags") or []
    available_tags_info = ", ".join([f"'{t}'" for t in available_tags]) if available_tags else "Nenhuma tag cadastrada na empresa (NÃO adicione tags ao campo tags_para_adicionar)"

    # Resolução de TTS / Resposta em Áudio
    tts_voice = state.get("tts_voice")
    if tts_voice and str(tts_voice).strip() and str(tts_voice).strip().lower() not in ["none", "null", ""]:
        tts_voice_clean = str(tts_voice).strip()
        tts_voice_info = f"""🎙️ DIRETRIZES DE RESPOSTA EM ÁUDIO / VOZ (TTS Voz '{tts_voice_clean}' Ativa):
- Você tem a capacidade de enviar mensagens de voz faladas com entonação humana para o cliente no WhatsApp.
- QUANDO ATIVAR `send_as_audio = True`:
  1. Se a última mensagem do cliente for um áudio gravado (identificada por `[ÁUDIO]` ou `[Áudio Transcrito]`).
  2. Se o cliente pedir para responder por áudio/voz (ex: "manda áudio", "me manda um áudio", "responde por voz", "fala comigo", "não consigo ler", "você consegue me enviar um áudio?").
  3. Se as instruções da Persona determinarem que você responda por áudio/voz.
- DECISÃO DINÂMICA DE BALÕES (ÁUDIO VS TEXTO):
  - QUANDO `send_as_audio = True`:
    * Você PODE e DEVE decidir quais balões enviar em áudio e quais em texto na mesma resposta.
    * Para marcar um balão específico como áudio, inicie-o com a tag `[AUDIO]` (ex: `[AUDIO] Olá, que bom falar com você!`).
    * Para marcar um balão específico como texto (contendo links/URLs ou especificações detalhadas), inicie-o com a tag `[TEXTO]` (ex: `[TEXTO] Acesse o link: https://...`).
    * Balões normais sem tag são falados em áudio por padrão, EXCETO balões que contenham links/URLs ou que estejam marcados com `[TEXTO]`.
  - QUANDO `send_as_audio = False` (RESPOSTA EM TEXTO NORMAL):
    * 🚨 NUNCA use tags como `[TEXTO]`, `[AUDIO]` ou `[VOZ]`. Escreva diretamente o texto limpo sem tags de formatação entre colchetes.
- 🚨 REGRA SUPREMA: É TERMINANTEMENTE PROIBIDO ENVIAR LINKS/URLS EM ÁUDIO:
  - NUNCA coloque links, sites, URLs (ex: https://..., www....) dentro de áudios. A síntese de voz não deve soletrar links.
  - Se for enviar ou sugerir um link/site, coloque SEMPRE o link em um balão de TEXTO separado (usando `[TEXTO]` se send_as_audio=True ou quebra de linha), para que o cliente consiga clicar normalmente no WhatsApp.
- REGRAS PARA O TEXTO QUANDO ENVIADO EM ÁUDIO:
  - Escreva um texto EXTREMAMENTE NATURAL, DIRETO e CONVERSACIONAL (máximo de 1 a 2 frases curtas).
  - NUNCA use marcadores de lista (*, -, •), títulos (#), tabelas, URLs ou emojis soltos no texto do áudio.
- SE NÃO FOR RESPONDER POR ÁUDIO: Mantenha `send_as_audio = False` e formule o texto normal formatado para WhatsApp."""
    else:
        tts_voice_info = "🎙️ RESPOSTA POR ÁUDIO (TTS): Voz desativada. Mantenha `send_as_audio = False` e NUNCA inclua tags `[TEXTO]` ou `[AUDIO]` no corpo da mensagem."

    data_hora_info = state.get("data_hora_atual") or "Horário atual de Brasília"

    # 3. Formata o System Prompt completo
    system_prompt = GENERATOR_SYSTEM_PROMPT.format(
        secao_critica=secao_critica,
        persona_prompt=state.get("persona_prompt") or "Você é um assistente virtual prestativo.",
        workflow_context=state.get("workflow_context") or "",
        calendar_context=state.get("calendar_context") or "",
        resumo_anterior_sec=resumo_anterior_sec,
        nome_cliente_info=nome_cliente_info,
        tags_atuais_info=tags_atuais_info,
        available_tags_info=available_tags_info,
        company_team_info=state.get("company_team_info") or "- Nenhum atendente cadastrado",
        tts_voice_info=tts_voice_info,
        data_hora_info=data_hora_info,
        retrieved_context=retrieved_context,
        tool_results=tool_results_str
    )

    # 5. Histórico da Conversa
    history_str = format_conversation_history(history, max_messages=50)
    user_turn_prompt = f"""--- HISTÓRICO DA CONVERSA ---
{history_str}

--- MENSAGEM ATUAL DO CLIENTE ---
USER: {user_input}
"""

    logger.info(
        f"[Generator Node] Gerando resposta (Model: {model_name}, Retry: {state.get('retry_count', 0)}) "
        f"para Atend {state.get('atendimento_id')}"
    )

    try:
        clean_model = model_name.replace("google:", "").replace("google-cloud:", "")
        temp_val = float(state.get("temperature", 0.5)) if state.get("temperature") is not None else 0.5
        top_p_val = float(state.get("top_p", 0.95)) if state.get("top_p") is not None else 0.95
        top_k_val = int(state.get("top_k", 40)) if state.get("top_k") is not None else 40

        config = types.GenerateContentConfig(
            system_instruction=system_prompt,
            response_mime_type="application/json",
            response_schema=GeneratorOutput,
            temperature=min(max(temp_val, 0.0), 2.0),
            top_p=top_p_val,
            top_k=top_k_val,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True)
        )

        response = await gemini_svc.client.aio.models.generate_content(
            model=clean_model,
            contents=user_turn_prompt,
            config=config
        )

        output_data = json.loads(response.text)
        gen_output = GeneratorOutput(**output_data)

        # Verificação se nova mensagem chegou durante a geração da resposta
        if last_processed_msg_id > 0:
            async with SessionLocal() as db_check_gen_post:
                if await crud_atendimento.has_newer_user_messages(db_check_gen_post, state.get("atendimento_id"), state.get("tenant_id"), last_processed_msg_id):
                    logger.info(f"[Generator Node] Nova mensagem do cliente detectada logo após geração (Atend {state.get('atendimento_id')}). Abortando ciclo.")
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

        raw_text = gen_output.response_text or ""
        is_audio_active = bool(gen_output.send_as_audio and tts_voice)
        # Se não for envio de áudio, limpa qualquer resíduo de [TEXTO], [AUDIO], etc.
        if not is_audio_active:
            clean_draft_resp = re.sub(r'\[(?:TEXTO|TEXT|AUDIO|ÁUDIO|VOZ)\]\s*', '', raw_text, flags=re.IGNORECASE).strip()
        else:
            clean_draft_resp = raw_text.strip()

        logger.info(f"[Generator Node] Resposta gerada (send_as_audio={gen_output.send_as_audio}, intent_handoff={gen_output.intent_handoff}, handoff_destinatario={gen_output.handoff_destinatario}): '{clean_draft_resp[:100]}...'")

        text_media_ids = [m.strip() for m in MEDIA_TAG_REGEX.findall(clean_draft_resp) if m.strip()]
        all_media_ids = list(dict.fromkeys((gen_output.media_file_ids or []) + text_media_ids))

        handoff_dest = gen_output.handoff_destinatario.strip() if gen_output.handoff_destinatario and gen_output.handoff_destinatario.strip() else None
        handoff_mot = gen_output.handoff_motivo.strip() if gen_output.handoff_motivo and gen_output.handoff_motivo.strip() else None
        intent_handoff_val = bool(gen_output.intent_handoff or state.get("intent_handoff"))
        is_conclude = bool(gen_output.intent_conclude or state.get("intent_conclude"))

        audit_trail = dict(state.get("ai_audit_trail") or {})
        iterations = list(audit_trail.get("iterations") or [])
        iterations.append({
            "retry_count": state.get("retry_count", 0),
            "critique_received": state.get("critique") or None,
            "draft_response": clean_draft_resp,
            "send_as_audio": gen_output.send_as_audio,
            "intent_handoff": gen_output.intent_handoff,
            "handoff_destinatario": handoff_dest,
            "handoff_motivo": handoff_mot,
            "resumo_atualizado": gen_output.resumo_atualizado,
            "tags_para_adicionar": gen_output.tags_para_adicionar,
            "guardrail": None
        })
        audit_trail["iterations"] = iterations

        novo_nome_val = gen_output.novo_nome_cliente.strip() if gen_output.novo_nome_cliente and gen_output.novo_nome_cliente.strip() else None
        nome_cliente_check = (novo_nome_val or nome_cliente_atual or "").strip().lower()
        nome_cliente_tokens = set(t for t in re.split(r'\s+', nome_cliente_check) if len(t) > 2) if nome_cliente_check else set()

        sanitized_tags = []
        for t in (gen_output.tags_para_adicionar or []):
            if not t or not str(t).strip():
                continue
            t_clean = str(t).strip()
            t_lower = t_clean.lower()
            # Descarta qualquer tag que coincida com o nome do cliente ou partes dele
            if nome_cliente_check and (t_lower == nome_cliente_check or t_lower in nome_cliente_tokens):
                logger.warning(f"[Generator Node] Tag descartada por corresponder ao nome do cliente: '{t_clean}'")
                continue
            sanitized_tags.append(t_clean)

        # Higienização de IDs de mídia: apenas IDs que realmente constam no contexto recuperado
        valid_context_str = f"{state.get('retrieved_context') or ''}\n{str(state.get('tool_results') or [])}"
        sanitized_media_ids = []
        for fid in all_media_ids:
            if not fid:
                continue
            fid_clean = str(fid).strip()
            if " " in fid_clean or len(fid_clean) > 80:
                logger.warning(f"[Generator Node] Media ID descartado por formato inválido/espaços: '{fid_clean}'")
                continue
            if fid_clean not in valid_context_str:
                logger.warning(f"[Generator Node] Media ID descartado por não constar no contexto recuperado: '{fid_clean}'")
                continue
            sanitized_media_ids.append(fid_clean)

        return {
            "draft_response": clean_draft_resp,
            "send_as_audio": bool(gen_output.send_as_audio and tts_voice),
            "resumo_crm": gen_output.resumo_atualizado,
            "status_final": "Atendente Chamado" if intent_handoff_val else ("Concluído" if is_conclude else "Aguardando Resposta"),
            "intent_conclude": is_conclude,
            "intent_handoff": intent_handoff_val,
            "handoff_destinatario": handoff_dest,
            "handoff_motivo": handoff_mot,
            "media_file_ids": sanitized_media_ids,
            "novo_nome_cliente": novo_nome_val,
            "tags_para_adicionar": sanitized_tags,
            "ai_audit_trail": audit_trail,
            "input_tokens": state.get("input_tokens", 0) + in_tokens,
            "output_tokens": state.get("output_tokens", 0) + out_tokens
        }




    except Exception as e:
        logger.error(f"[Generator Node] Erro na geração: {e}", exc_info=True)
        return {
            "draft_response": "Olá! Recebi sua mensagem e vou verificar as informações para você.",
            "send_as_audio": False,
            "resumo_crm": state.get("resumo_crm") or "Atendimento em andamento.",
            "status_final": "Aguardando Resposta"
        }
