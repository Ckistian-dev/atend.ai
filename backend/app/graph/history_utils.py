import pytz
from datetime import datetime
from typing import List, Dict, Any, Optional

def format_conversation_history(
    history: List[Dict[str, Any]], 
    max_messages: int = 50
) -> str:
    """
    Formata e consolida o histórico de mensagens em turnos contínuos e coesos para os nós do LangGraph.
    
    Principais benefícios:
    1. Agrupa balões consecutivos do mesmo emissor (USER ou ASSISTANT) evitando fragmentação.
    2. Identifica e marca intervalos de inatividade / mudança de data para manter a noção temporal.
    3. Preserva transcrições de mídia (imagens, áudios, documentos) e legendas originais.
    4. Garante janela ampla (até 50 mensagens) para que a IA nunca perca o contexto de produtos/acordos.
    """
    if not history:
        return "Nenhum histórico anterior."

    # Seleciona até max_messages mensagens mais recentes
    selected_msgs = history[-max_messages:] if len(history) > max_messages else history

    tz = pytz.timezone("America/Sao_Paulo")
    turns: List[str] = []
    current_role: Optional[str] = None
    current_contents: List[str] = []
    last_timestamp: Optional[int] = None

    for msg in selected_msgs:
        raw_role = (msg.get("role") or "user").strip().lower()
        role = "USER" if raw_role in ["user", "client"] else "ASSISTANT"
        content = str(msg.get("content") or "").strip()
        caption = str(msg.get("caption") or "").strip()
        msg_type = (msg.get("type") or "text").strip().lower()
        ts = msg.get("timestamp") or 0

        # Formata o conteúdo do balão
        balloon_text = content
        if caption and caption not in balloon_text:
            balloon_text = f"{balloon_text}\n[Legenda: {caption}]".strip() if balloon_text else f"[Legenda: {caption}]"

        if msg_type not in ["text", "sending"] and f"[{msg_type}" not in balloon_text.lower():
            balloon_text = f"[{msg_type.upper()}]: {balloon_text}".strip()

        if not balloon_text:
            continue

        # Verifica gap temporal (> 2 horas)
        time_gap_marker = ""
        if last_timestamp and ts and ts > last_timestamp:
            gap_seconds = ts - last_timestamp
            if gap_seconds >= 7200:  # Mais de 2 horas de intervalo
                try:
                    dt_curr = datetime.fromtimestamp(ts, tz=tz)
                    gap_hours = gap_seconds / 3600
                    if gap_hours >= 24:
                        gap_days = int(gap_hours // 24)
                        time_gap_marker = f"\n--- ⏳ [Retomada do contato após {gap_days} dia(s) ({dt_curr.strftime('%d/%m/%Y às %H:%M')})] ---"
                    else:
                        time_gap_marker = f"\n--- ⏳ [Retomada do contato após {int(gap_hours)}h ({dt_curr.strftime('%d/%m/%Y às %H:%M')})] ---"
                except Exception:
                    pass

        # Se houver marcador de tempo ou mudança de papel, consolida o bloco anterior
        if time_gap_marker or (role != current_role and current_contents):
            if current_role and current_contents:
                merged_block = "\n".join(current_contents)
                turns.append(f"{current_role}: {merged_block}")
                current_contents = []
            if time_gap_marker:
                turns.append(time_gap_marker)

        current_role = role
        current_contents.append(balloon_text)
        if ts:
            last_timestamp = ts

    # Consolida o último bloco pendente
    if current_role and current_contents:
        merged_block = "\n".join(current_contents)
        turns.append(f"{current_role}: {merged_block}")

    return "\n\n".join(turns) if turns else "Nenhum histórico anterior."


def get_last_assistant_message(history: List[Dict[str, Any]]) -> str:
    """
    Retorna o texto da última mensagem/bloco enviado pelo assistente (IA).
    """
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


def is_false_handoff_trigger(user_input: str, history: List[Dict[str, Any]]) -> bool:
    """
    Verifica se uma tentativa de transbordo é FALSA (ou seja, se a transferência NÃO é autorizada/legítima).
    Delega diretamente para o módulo central handoff_policy.py.
    
    Retorna True se for um falso positivo de transbordo (o atendimento DEVE continuar com a IA).
    Retorna False se o transbordo for legítimo e autorizado.
    """
    from app.graph.handoff_policy import should_allow_handoff
    allowed, _ = should_allow_handoff(user_input=user_input, history=history)
    return not allowed



# Stopwords genéricas em português para extração de substantivos contextuais em qualquer nicho/empresa
PORTUGUESE_STOPWORDS = {
    "a", "ao", "aos", "aquela", "aquelas", "aquele", "aqueles", "aquilo", "as", "até", "com", "como", "da", "das", 
    "de", "dela", "delas", "dele", "deles", "depois", "do", "dos", "e", "ela", "elas", "ele", "eles", "em", "entre", 
    "era", "eram", "éramos", "essa", "essas", "esse", "esses", "esta", "estas", "este", "estes", "estou", "eu", 
    "foi", "fomos", "foram", "isso", "isto", "já", "lhe", "lhes", "mais", "mas", "me", "mesmo", "meu", "meus", 
    "minha", "minhas", "muito", "na", "não", "nao", "nas", "nem", "no", "nos", "nós", "nossa", "nossas", "nosso", "nossos", 
    "num", "numa", "o", "os", "ou", "para", "pela", "pelas", "pelo", "pelos", "por", "qual", "quando", "que", "quem", 
    "se", "seja", "sejam", "sem", "ser", "seu", "seus", "só", "so", "sua", "suas", "também", "tambem", "te", "tem", "temos", "tenho", 
    "ter", "teu", "teus", "tinha", "tinham", "toda", "todas", "todo", "todos", "tu", "tua", "tuas", "tudo", "um", 
    "uma", "umas", "uns", "você", "voce", "vocês", "voces", "vos", "olá", "ola", "oi", "bom", "boa", "dia", "tarde", "noite", 
    "sim", "ok", "quero", "gostaria", "pode", "podemos", "seria", "favor", "obrigado", "obrigada", "valeu",
    "deseja", "prefere", "temos", "consegue", "ajudar", "sobre", "qualquer", "aqui", "ali", "então", "entao"
}

def extract_substantive_tokens(text: str, max_tokens: int = 4) -> List[str]:
    """
    Extrai palavras-chave substantivas e relevantes de forma genérica e multi-tenant (qualquer nicho/segmento).
    """
    if not text:
        return []
    import re
    # Remove URLs, tags e pontuações estranhas
    clean_t = re.sub(r'https?://[^\s]+', '', text)
    clean_t = re.sub(r'\[.*?\]', '', clean_t)
    tokens = re.findall(r'\b[a-zA-ZÀ-ÿ0-9_\-]{3,}\b', clean_t.lower())
    substantives = []
    for t in tokens:
        if t not in PORTUGUESE_STOPWORDS and not t.isdigit() and len(t) >= 3:
            if t not in substantives:
                substantives.append(t)
    return substantives[:max_tokens]

def synthesize_contextual_search_query(
    user_input: str, 
    history: List[Dict[str, Any]], 
    default_query: Optional[str] = None
) -> str:
    """
    Sintetiza uma query de busca RAG contextualizada combinando o assunto em discussão
    no histórico recente com a escolha/resposta atual do cliente de forma 100% genérica (multi-tenant).
    """
    clean_input = str(user_input or "").strip()
    
    # Se a query padrão gerada pelo roteador for rica (>= 2 palavras substantivas e não genérica), utiliza diretamente
    if default_query and len(default_query.split()) >= 2:
        dq_lower = default_query.strip().lower()
        if dq_lower not in ["sim", "não", "nao", "quero", "ok", "pode ser", "produtos", "informações", "serviços"]:
            return default_query.strip()

    # Extrai termos substantivos da última mensagem do assistente e do input do usuário
    last_assistant = get_last_assistant_message(history)
    assistant_tokens = extract_substantive_tokens(last_assistant, max_tokens=4)
    user_tokens = extract_substantive_tokens(clean_input, max_tokens=3)

    combined_tokens = []
    for t in assistant_tokens:
        if t not in combined_tokens:
            combined_tokens.append(t)
    for t in user_tokens:
        if t not in combined_tokens:
            combined_tokens.append(t)

    if combined_tokens:
        return " ".join(combined_tokens[:5])

    # Fallback genérico para o input do usuário ou default_query
    return default_query or clean_input or "informações"


