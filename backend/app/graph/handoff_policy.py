import re
import logging
from typing import List, Dict, Any, Tuple, Optional

logger = logging.getLogger(__name__)

# Expressões regulares rigorosas para pedidos explícitos de atendimento humano
EXPLICIT_HUMAN_REQUEST_PATTERNS = [
    re.compile(r'\b(?:falar|conversar|passar|transferir|chamar|atendimento|suporte|contato)\s+(?:com\s+)?(?:um\s+|uma\s+)?(?:humano|atendente|pessoa|especialista|vendedor|operador|consultor|suporte\s+humano)\b', re.IGNORECASE),
    re.compile(r'\b(?:quero|preciso|gostaria\s+de)\s+(?:falar|conversar)\s+(?:com\s+)?(?:um\s+|uma\s+)?(?:humano|atendente|pessoa|algu[eé]m|algu[eé]m\s+real)\b', re.IGNORECASE),
    re.compile(r'\b(?:me\s+)?(?:passa|transfere|chama|conecta|direciona)\s+(?:para\s+)?(?:um\s+|uma\s+)?(?:humano|atendente|pessoa|operador|algu[eé]m\s+real)\b', re.IGNORECASE),
    re.compile(r'\b(?:tem|teria|posso\s+falar\s+com|consigo\s+falar\s+com)\s+(?:um\s+|uma\s+)?(?:atendente|humano|pessoa\s+real|especialista)\b', re.IGNORECASE),
    re.compile(r'\b(?:atendente|humano|pessoa\s+real)\s+(?:por\s+favor|porfavor|agora)\b', re.IGNORECASE),
    re.compile(r'\b(?:quero\s+(?:um\s+)?humano|quero\s+(?:um\s+)?atendente|fale\s+com\s+humano|chame\s+um\s+humano)\b', re.IGNORECASE),
    re.compile(r'\b(?:falar\s+com\s+algu[eé]m|falar\s+com\s+gente|falar\s+com\s+uma\s+pessoa)\b', re.IGNORECASE),
    re.compile(r'\b(?:atendimento\s+humano|suporte\s+humano|atendente\s+humano)\b', re.IGNORECASE),
    re.compile(r'\b(?:transfere\s+logo|me\s+passa\s+para\s+algu[eé]m|me\s+transfere)\b', re.IGNORECASE),
]

# Expressões regulares para escalações formais / reclamações graves
FORMAL_ESCALATION_PATTERNS = [
    re.compile(r'\b(?:procon|reclame\s+aqui|ouvidoria|processo\s+judicial|processar\s+voc[eê]s|advogado|acionar\s+justi[çc]a|jur[ií]dico)\b', re.IGNORECASE),
    re.compile(r'\b(?:estorno\s+(?:do\s+dinheiro|banc[aá]rio|no\s+cart[aã]o|integral)|devolver\s+meu\s+dinheiro|estornar\s+o\s+valor)\b', re.IGNORECASE),
    re.compile(r'\b(?:cancelar\s+(?:a\s+compra|o\s+pedido|o\s+contrato|o\s+plano|a\s+assinatura))\b', re.IGNORECASE),
    re.compile(r'\b(?:reclama[çc][aã]o\s+formal|abrir\s+uma\s+reclama[çc][aã]o)\b', re.IGNORECASE),
]

# Gatilhos em mensagens anteriores da IA oferecendo transferência humana
ASSISTANT_TRANSFER_OFFER_PATTERNS = [
    re.compile(r'\b(?:deseja|quer|prefere|posso|gostaria\s+que\s+eu)\s+(?:te\s+)?(?:transfira|passar|direcionar|encaminhar)\s+(?:para\s+)?(?:um\s+)?(?:atendente|nossa\s+equipe|especialista|suporte)\b', re.IGNORECASE),
    re.compile(r'\b(?:prefere\s+falar\s+com\s+(?:a\s+nossa\s+equipe|um\s+atendente|um\s+especialista))\b', re.IGNORECASE),
    re.compile(r'\b(?:posso\s+transferir\s+seu\s+atendimento)\b', re.IGNORECASE),
    re.compile(r'\b(?:deseja\s+falar\s+com\s+um\s+(?:atendente|especialista|humano))\b', re.IGNORECASE),
]

# Respostas afirmativas curtas do cliente a ofertas
AFFIRMATIVE_RESPONSES = {
    "sim", "quero", "pode ser", "por favor", "porfavor", "prefiro", "transfere",
    "sim por favor", "sim quero", "quero sim", "pode transferir", "pode passar",
    "sim pode transferir", "transfere sim", "claro", "com certeza", "isso"
}

# Expressões de interesse comercial / vendas / dúvidas que NUNCA devem ser confundidas com handoff
SALES_AND_INQUIRY_PATTERNS = [
    re.compile(r'\b(?:or[çc]amento|or[çc]ar|cota[çc][aã]o|cotar|pre[çc]o|valor|quanto\s+custa|tabela|cat[aá]logo)\b', re.IGNORECASE),
    re.compile(r'\b(?:gostaria\s+de\s+(?:saber|comprar|fazer|realizar|ver|conhecer|tirar\s+d[uú]vida))\b', re.IGNORECASE),
    re.compile(r'\b(?:interessad[oa]|interesse|comprar|adquirir|contratar|assinar|agendar)\b', re.IGNORECASE),
    re.compile(r'\b(?:medida|altura|largura|tamanho|peso|dimens[aã]o|disponibilidade|modelo|especifica[çc][aã]o)\b', re.IGNORECASE),
]

def get_last_assistant_text(history: List[Dict[str, Any]]) -> str:
    """Extrai o texto consolidado da última mensagem enviada pela IA no histórico."""
    if not history:
        return ""
    for msg in reversed(history):
        role = (msg.get("role") or "").strip().lower()
        if role in ["assistant", "ia", "bot", "atendente"]:
            content = str(msg.get("content") or "").strip()
            caption = str(msg.get("caption") or "").strip()
            if caption and caption not in content:
                content = f"{content} {caption}".strip()
            if content:
                return content
    return ""

def is_explicit_human_request(text: str) -> bool:
    """Verifica se o usuário pediu expressamente para falar com um atendente humano / pessoa."""
    if not text or not str(text).strip():
        return False
    clean = str(text).strip().lower()
    return any(p.search(clean) for p in EXPLICIT_HUMAN_REQUEST_PATTERNS)

def is_formal_escalation(text: str) -> bool:
    """Verifica se o usuário acionou um caso formal grave (Procon, processo, estorno, cancelamento)."""
    if not text or not str(text).strip():
        return False
    clean = str(text).strip().lower()
    return any(p.search(clean) for p in FORMAL_ESCALATION_PATTERNS)

def was_responding_to_transfer_offer(last_assistant_msg: str, user_input: str) -> bool:
    """Verifica se a IA perguntou anteriormente se o cliente queria transferência e se o cliente respondeu 'sim'."""
    if not last_assistant_msg or not user_input:
        return False
    
    clean_last = last_assistant_msg.strip().lower()
    clean_user = user_input.strip().lower().rstrip('.!?,')

    # Checa se a IA ofereceu transferência explicitamente
    offered = any(p.search(clean_last) for p in ASSISTANT_TRANSFER_OFFER_PATTERNS)
    if not offered:
        return False

    # Checa se o cliente deu uma resposta afirmativa
    if clean_user in AFFIRMATIVE_RESPONSES:
        return True
    
    if any(clean_user.startswith(aff) for aff in ["sim", "quero", "pode transferir", "pode passar", "prefiro"]):
        return True

    return False

def is_sales_or_inquiry_intent(text: str) -> bool:
    """Verifica se a mensagem contém interesse comercial, dúvidas de produtos/serviços ou pedido de orçamento."""
    if not text:
        return False
    clean = str(text).strip().lower()
    return any(p.search(clean) for p in SALES_AND_INQUIRY_PATTERNS)

def should_allow_handoff(
    user_input: str,
    history: List[Dict[str, Any]],
    requested_by_ai: bool = False,
    persona_rules: Optional[str] = None
) -> Tuple[bool, str]:
    """
    Função Autoridade Central (Single Source of Truth) para decisão de Transbordo Humano.
    
    @param user_input: Mensagem atual do cliente.
    @param history: Histórico de mensagens anteriores.
    @param requested_by_ai: Se o nó gerador ou roteador tentou solicitar transbordo.
    @param persona_rules: Regras específicas opcionais da persona.
    @returns: (allowed: bool, reason: str)
    """
    clean_input = str(user_input or "").strip()

    # 1. Pedido explícito e inequívoco do cliente por atendente humano
    if is_explicit_human_request(clean_input):
        return True, "Solicitação explícita de atendente humano pelo cliente."

    # 2. Confirmação de oferta prévia de transferência feita pela IA
    last_assistant = get_last_assistant_text(history)
    if was_responding_to_transfer_offer(last_assistant, clean_input):
        return True, "Cliente confirmou oferta anterior de transferência humana."

    # 3. Escalação formal / Reclamação grave / Cancelamento
    if is_formal_escalation(clean_input):
        return True, "Escalação formal / Reclamação grave detectada."

    # 4. Caso o cliente esteja em fluxo de vendas, interesse, orçamento ou dúvidas
    if is_sales_or_inquiry_intent(clean_input):
        return False, "Mensagem do cliente é uma dúvida, interesse ou pedido de orçamento comercial (não é transbordo)."

    # 5. Respostas curtas/afirmativas em meio a diálogo sem oferta de transferência
    clean_lower = clean_input.lower().rstrip('.!?,')
    if clean_lower in AFFIRMATIVE_RESPONSES:
        return False, "Resposta afirmativa ou de continuidade a diálogo anterior da IA."

    # 6. Primeiro contato ou mensagens de saudação + assunto
    if not history or len(history) <= 2:
        return False, "Início de atendimento (primeiro contato do cliente)."

    # 7. Regra padrão para qualquer outro caso: NÃO autorizar transbordo indevido
    return False, "Cliente não solicitou atendimento humano e não há regra de transbordo aplicável."
