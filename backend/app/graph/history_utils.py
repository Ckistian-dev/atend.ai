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
