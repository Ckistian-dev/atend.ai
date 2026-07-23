import os
import json
import logging
from typing import Optional, Literal, Any, Dict, List
from dataclasses import dataclass
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from pydantic_ai import Agent, RunContext
from app.db import models
from app.crud import crud_config, crud_atendimento
from app.core.config import settings
from app.services.google_sheets_service import GoogleSheetsService
from app.services.google_drive_service import get_drive_service
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# Configura a chave de API do Gemini para o Pydantic AI
if not os.environ.get("GOOGLE_API_KEY") and settings.GOOGLE_API_KEYS:
    keys = [k.strip() for k in settings.GOOGLE_API_KEYS.split(",") if k.strip()]
    if keys:
        os.environ["GOOGLE_API_KEY"] = keys[0]

# --- ESTRUTURA DE RETORNO DO AGENTE ---
class WorkflowNodeData(BaseModel):
    label: str = Field(..., description="Nome curto da etapa em caixa alta (ex: 'BOAS-VINDAS', 'TRIAGEM DE NECESSIDADE', 'OFERTA DE PRODUTOS', 'TRANSBORDO')")
    description: str = Field(..., description="OBRIGATÓRIO E DETALHADO: Instruções completas e claras para a IA sobre o que fazer e falar nesta etapa. NUNCA deixe em branco nem use texto genérico.")
    node_type: Literal['start', 'message', 'decision', 'action', 'end'] = Field(
        ...,
        description="OBRIGATÓRIO: O tipo visual do balão. Use 'start' para início/abertura, 'message' para diálogos textuais, 'decision' para triagem/opções, 'action' para chamadas/ferramentas, e 'end' para encerramento/transbordo."
    )

class WorkflowNodePosition(BaseModel):
    x: float = Field(..., description="Coordenada X em pixels (progresso em escada: 100, 450, 800, 1150...)")
    y: float = Field(..., description="Coordenada Y em pixels (progresso em escada: 80, 280, 480, 680...)")

class WorkflowNode(BaseModel):
    id: str = Field(..., description="ID único do nó (ex: 'node_inicio', 'node_triagem', 'node_vendas', 'node_fim')")
    type: str = Field(default="custom", description="Sempre 'custom'")
    position: WorkflowNodePosition
    data: WorkflowNodeData

class WorkflowEdge(BaseModel):
    id: str = Field(..., description="ID único da conexão (ex: 'edge_inicio_triagem')")
    source: str = Field(..., description="ID do nó de origem")
    target: str = Field(..., description="ID do nó de destino")
    sourceHandle: Optional[str] = Field("s-right", description="Handle de saída: 's-right', 's-bot', 's-left', 's-top'")
    targetHandle: Optional[str] = Field("t-left", description="Handle de entrada: 't-left', 't-top', 't-bot', 't-right'")
    label: Optional[str] = Field(None, description="Texto ou rótulo condicional da conexão (ex: 'Opção 1', 'Sim', 'Não')")

class WorkflowData(BaseModel):
    nodes: List[WorkflowNode] = Field(default_factory=list, description="Lista completa de nós do fluxo visual")
    edges: List[WorkflowEdge] = Field(default_factory=list, description="Lista completa de conexões entre os nós")

class AlteracaoItem(BaseModel):
    acao: str = Field(description="Ação a ser executada: 'adicionar', 'modificar' ou 'remover'")
    aba: str = Field(description="Nome da aba na planilha onde a alteração deve ocorrer")
    coluna_1: str = Field(description="Categoria ou identificador da linha")
    valor_antigo: Optional[str] = Field(None, description="Valor anterior (se aplicável/modificar/remover)")
    valor_novo: str = Field(description="Novo valor sugerido")
    motivo: Optional[str] = Field(None, description="Explicação do porquê desta alteração")

class FeedbackAgentResponse(BaseModel):
    analise_geral: str = Field(description="Explicação detalhada da reorganização ou alteração realizada no fluxo ou sistema")
    alteracoes_planilha: Optional[List[AlteracaoItem]] = Field(default=None, description="Melhorias recomendadas na Planilha de Instruções de Sistema")
    alteracoes_rag: Optional[List[AlteracaoItem]] = Field(default=None, description="Melhorias recomendadas na Planilha de RAG (Base de Conhecimento)")
    novo_workflow: Optional[WorkflowData] = Field(default=None, description="O novo fluxo visual (Workflow) contendo obrigatoriamente a lista de 'nodes' e 'edges' quando no modo 'flow' ou se houver alterações no fluxo")

# --- CONTEXTO DE DEPENDÊNCIA (MULTI-TENANT) ---
@dataclass
class ContextoFeedback:
    db: AsyncSession
    company_id: int
    config_id: int
    modo: Literal['conversation', 'knowledge', 'flow']
    feedback: str
    atendimento_id: Optional[int] = None
    user: Optional[models.User] = None
    current_workflow: Optional[Dict[str, Any]] = None


# --- O AGENTE ---
feedback_agent = Agent(
    'google:gemini-2.5-flash',  # Usamos o 2.5 flash como modelo padrão para análises estruturadas rápidas
    deps_type=ContextoFeedback,
    output_type=FeedbackAgentResponse,
    retries=2
)

# --- SYSTEM PROMPT DINÂMICO ---
@feedback_agent.system_prompt
def construir_prompt_feedback(ctx: RunContext[ContextoFeedback]) -> str:
    modo = ctx.deps.modo
    prompt = (
        "Você é um Engenheiro de Prompt Sênior, Arquiteto de Fluxos e Estrategista de IA especialista em Atendimento ao Cliente.\n"
        "Sua missão é analisar as configurações da IA e propor melhorias estruturadas com base no feedback do usuário.\n\n"
        "--- DIRETRIZES FUNDAMENTAIS PARA CRIAÇÃO DE REGRAS ---\n"
        "1. VERBOS NO IMPERATIVO: Todas as regras sugeridas devem iniciar com verbos no imperativo (ex: 'Responda', 'Pergunte', 'Encaminhe', 'Solicite', 'Evite', 'Nunca informe').\n"
        "2. SEM EXEMPLOS LITERAIS: PROIBIDO incluir falas literais, diálogos de exemplo ou simulações de conversas nas regras.\n"
        "3. GENÉRICO E ESCALÁVEL: Escreva regras abstratas e universais que sirvam para qualquer interação futura semelhante.\n"
        "4. RESOLUÇÃO DE RAIZ: Solucione diretamente o ponto fraco ou erro apontado pelo usuário no feedback.\n\n"
    )
    
    if modo == 'conversation':
        prompt += (
            "--- CONTEXTO ATUAL: ANÁLISE COMPLETA DE CONVERSA ---\n"
            "Você possui acesso a todo o ecossistema da IA (histórico, persona, instruções, RAG, drive, workflow visual e agenda).\n\n"
            "PROTOCOLO DE INVESTIGAÇÃO:\n"
            "1. Chame `obter_historico_conversa` para entender exatamente onde ocorreu o desvio no atendimento.\n"
            "2. Chame `obter_configuracoes_persona` e `obter_planilha_instrucoes` para verificar as regras vigentes.\n"
            "3. Se o desvio envolver dados de produtos, preços ou estoque, consulte `obter_planilha_conhecimento_rag` ou `obter_arquivos_drive`.\n"
            "4. Se envolver o roteiro de passos da conversa, consulte `obter_fluxo_visual`.\n\n"
            "SUGESTÕES MULTI-PILAR:\n"
            "- Sugira alterações na planilha de instruções (`alteracoes_planilha`) para comportamentos, postura e tom da IA.\n"
            "- Sugira alterações na planilha RAG (`alteracoes_rag`) para inclusão ou correção de fatos, preços, políticas ou produtos.\n"
            "- Sugira um novo fluxo visual (`novo_workflow`) caso o roteiro exija novos blocos, etapas ou transições.\n\n"
            "Ferramentas disponíveis: `obter_historico_conversa`, `obter_configuracoes_persona`, `obter_planilha_instrucoes`, "
            "`obter_planilha_conhecimento_rag`, `obter_arquivos_drive`, `obter_fluxo_visual`, `obter_agenda_disponibilidade`.\n"
        )
    elif modo == 'knowledge':
        prompt += (
            "--- CONTEXTO ATUAL: BASE DE CONHECIMENTO E INSTRUÇÕES ---\n"
            "Neste modo, o foco é exclusivamente a otimização da Base de Conhecimento (RAG) e das Instruções do Sistema.\n"
            "Você NÃO tem acesso ao histórico da conversa, drive, fluxo visual ou agenda.\n\n"
            "PROTOCOLO DE INVESTIGAÇÃO:\n"
            "1. Chame `obter_planilha_instrucoes` para ler as regras de atendimento atuais.\n"
            "2. Chame `obter_planilha_conhecimento_rag` para ler a base de FAQ/produtos atual.\n"
            "3. Proponha ajustes claros em `alteracoes_planilha` e/ou `alteracoes_rag` conforme solicitado.\n\n"
            "Ferramentas disponíveis: `obter_planilha_instrucoes`, `obter_planilha_conhecimento_rag`.\n"
            "Se o usuário solicitar alterações fora desse escopo (ex: workflow visual), esclareça na `analise_geral` que tal alteração deve ser feita no modo de fluxo.\n"
        )
    elif modo == 'flow':
        wf_str = json.dumps(ctx.deps.current_workflow, ensure_ascii=False) if ctx.deps.current_workflow else "Nenhum workflow enviado no contexto inicial"
        prompt += (
            "--- CONTEXTO ATUAL: EDITOR DE FLUXO VISUAL (WORKFLOW) ---\n"
            "Neste modo, você edita DIRETAMENTE a estrutura de nós e conexões do fluxo visual do assistente.\n"
            "Sua tarefa é analisar o fluxo atual, aplicar os pedidos do usuário e RETORNAR o fluxo completo reestruturado no objeto `novo_workflow`.\n\n"
            f"ESTADO ATUAL DO FLUXO (JSON):\n{wf_str}\n\n"
            "DIRETRIZES OBRIGATÓRIAS DE ATUAÇÃO DA IA DE FLUXO:\n"
            "1. FOCO TOTAL EM ESTRUTURA E CONTEÚDO (SEM NECESSIDADE DE CALCULAR X, Y):\n"
            "   - VOCÊ NÃO PRECISA SE PREOCUPAR COM COORDENADAS (X, Y) OU HANDLES DE CONEXÃO. Um algoritmo pós-processador organizará automaticamente os balões na escada visual perfeita.\n"
            "   - Concentre-se 100% em adicionar, remover ou modificar os balões (nós) e definir as conexões (edges) de o que entra e o que sai de cada nó (`source` e `target`).\n"
            "2. VARIABILIDADE DOS TIPOS DE BALÃO (`node_type`):\n"
            "   - Atribua o `node_type` correto a cada balão: 'start' (Início - Verde), 'decision' (Decisão/Menu - Amarelo), 'action' (Ação/Ferramenta - Roxo), 'message' (Diálogo - Azul), 'end' (Encerramento/Transbordo - Vermelho).\n"
            "3. PREENCHIMENTO COMPLETO DAS INSTRUÇÕES (`description`):\n"
            "   - OBRIGATÓRIO: Escreva orientações detalhadas, ricas e acionáveis para o assistente em cada nó (`description`).\n"
            "4. DEFINIÇÃO DAS CONEXÕES E RÓTULOS (`edges`):\n"
            "   - Conecte o nó de origem (`source`) ao nó de destino (`target`). Para saídas de nós 'decision', informe no campo `label` da edge a opção correspondente (ex: 'Sim', 'Não', 'Opção 1').\n\n"
            "Ferramentas disponíveis: `obter_fluxo_visual`.\n"
        )
        
    prompt += "\nInspecione o estado atual via ferramentas antes de responder. Monte uma resposta precisa e bem fundamentada."
    return prompt

# --- FERRAMENTAS ---

@feedback_agent.tool
async def obter_historico_conversa(ctx: RunContext[ContextoFeedback]) -> str:
    """Retorna o histórico da conversa de atendimento correspondente."""
    if ctx.deps.modo != 'conversation':
        return "Erro: O histórico de conversa não está disponível neste contexto."
    if not ctx.deps.atendimento_id:
        return "Nenhum atendimento associado."
    
    atend = await crud_atendimento.get_atendimento(ctx.deps.db, atendimento_id=ctx.deps.atendimento_id, company_id=ctx.deps.company_id)
    if not atend:
        return "Atendimento não encontrado."
    
    try:
        conversa_list = json.loads(atend.conversa or "[]")
    except Exception:
        conversa_list = []
        
    if not conversa_list:
        return "Nenhuma mensagem encontrada no histórico deste atendimento."
        
    if len(conversa_list) > 50:
        conversa_list = conversa_list[-50:]
        
    lines = []
    for msg in conversa_list:
        role = "IA" if msg.get("is_ai") or msg.get("role") == "assistant" else "Cliente"
        content = msg.get("content") or msg.get("caption") or ""
        lines.append(f"{role}: {content}")
        
    return "\n".join(lines)

@feedback_agent.tool
async def obter_configuracoes_persona(ctx: RunContext[ContextoFeedback]) -> str:
    """Retorna as configurações e prompt de sistema da persona atual."""
    if ctx.deps.modo != 'conversation':
        return "Erro: Acesso às configurações da persona não é permitido neste contexto."
        
    cfg = await crud_config.get_config(ctx.deps.db, config_id=ctx.deps.config_id, company_id=ctx.deps.company_id)
    if not cfg:
        return "Configuração não encontrada."
        
    return (
        f"Nome Persona: {cfg.nome_config}\n"
        f"Modelo de IA: {cfg.ai_model}\n"
        f"Temperatura: {cfg.temperature}\n"
        f"Thinking Level: {cfg.thinking_level}\n"
        f"Prompt de Sistema Atual:\n{cfg.prompt or 'Nenhum'}"
    )

@feedback_agent.tool
async def obter_planilha_instrucoes(ctx: RunContext[ContextoFeedback]) -> str:
    """Retorna o conteúdo da planilha de instruções de sistema (regras de atendimento)."""
    if ctx.deps.modo not in ['conversation', 'knowledge']:
        return "Erro: Acesso à planilha de instruções não é permitido neste contexto."
        
    cfg = await crud_config.get_config(ctx.deps.db, config_id=ctx.deps.config_id, company_id=ctx.deps.company_id)
    if not cfg:
        return "Configuração não encontrada."
    if not cfg.spreadsheet_id:
        return "Planilha de sistema não configurada ou vazia."
        
    sheets_service = GoogleSheetsService()
    try:
        data = await sheets_service.get_sheet_as_json(cfg.spreadsheet_id)
        return json.dumps(data, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"Erro ao ler planilha de sistema: {e}")
        return f"Erro ao ler a planilha de sistema: {str(e)}"

@feedback_agent.tool
async def obter_planilha_conhecimento_rag(ctx: RunContext[ContextoFeedback]) -> str:
    """Retorna o conteúdo da planilha de RAG (Base de Conhecimento/FAQ)."""
    if ctx.deps.modo not in ['conversation', 'knowledge']:
        return "Erro: Acesso à planilha RAG não é permitido neste contexto."
        
    cfg = await crud_config.get_config(ctx.deps.db, config_id=ctx.deps.config_id, company_id=ctx.deps.company_id)
    if not cfg:
        return "Configuração não encontrada."
    if not cfg.spreadsheet_rag_id:
        return "Planilha RAG não configurada."
        
    sheets_service = GoogleSheetsService()
    try:
        data = await sheets_service.get_sheet_as_json(cfg.spreadsheet_rag_id)
        return json.dumps(data, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"Erro ao ler planilha RAG: {e}")
        return f"Erro ao ler a planilha RAG: {str(e)}"

@feedback_agent.tool
async def obter_arquivos_drive(ctx: RunContext[ContextoFeedback]) -> str:
    """Retorna os arquivos e mídias indexados na pasta do Google Drive."""
    if ctx.deps.modo != 'conversation':
        return "Erro: Acesso ao Google Drive não é permitido neste contexto."
        
    cfg = await crud_config.get_config(ctx.deps.db, config_id=ctx.deps.config_id, company_id=ctx.deps.company_id)
    if not cfg:
        return "Configuração não encontrada."
    if not cfg.drive_id:
        return "Google Drive não configurado."
        
    drive_service = get_drive_service()
    try:
        drive_data = await drive_service.list_files_in_folder(cfg.drive_id)
        return json.dumps(drive_data, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"Erro ao listar arquivos do drive: {e}")
        return f"Erro ao listar arquivos do drive: {str(e)}"

@feedback_agent.tool
async def obter_fluxo_visual(ctx: RunContext[ContextoFeedback]) -> str:
    """Retorna a estrutura atual do workflow visual (nodes e edges)."""
    if ctx.deps.modo not in ['conversation', 'flow']:
        return "Erro: Acesso ao fluxo visual não é permitido neste contexto."
        
    if ctx.deps.current_workflow:
        return json.dumps(ctx.deps.current_workflow, ensure_ascii=False, indent=2)

    cfg = await crud_config.get_config(ctx.deps.db, config_id=ctx.deps.config_id, company_id=ctx.deps.company_id)
    if not cfg:
        return "Configuração não encontrada."
    return json.dumps(cfg.workflow_json or {"nodes": [], "edges": []}, ensure_ascii=False, indent=2)

@feedback_agent.tool
async def obter_agenda_disponibilidade(ctx: RunContext[ContextoFeedback]) -> str:
    """Retorna as janelas de disponibilidade da agenda da persona."""
    if ctx.deps.modo != 'conversation':
        return "Erro: Acesso à agenda não é permitido neste contexto."
        
    cfg = await crud_config.get_config(ctx.deps.db, config_id=ctx.deps.config_id, company_id=ctx.deps.company_id)
    if not cfg:
        return "Configuração não encontrada."
        
    is_connected = bool(cfg.google_calendar_credentials)
    is_active = cfg.is_calendar_active
    available_hours = cfg.available_hours or {}
    
    return (
        f"Google Calendar Conectado: {is_connected}\n"
        f"Google Calendar Ativo: {is_active}\n"
        f"Janelas de Horários Disponíveis:\n{json.dumps(available_hours, ensure_ascii=False, indent=2)}"
    )

# --- FUNÇÃO PRINCIPAL DE INVOCAÇÃO ---

async def contabilizar_tokens_feedback(
    resultado_ia: Any, 
    company_id: int,
    config_id: int,
    atendimento_id: Optional[int],
    model_name: str,
    db: AsyncSession
):
    """
    Contabiliza os tokens consumidos pelo agente de feedback e deduz do saldo da empresa.
    """
    import math
    from app.crud import crud_user
    from app.services.agent_service import TABELA_PRECOS, BASE_FLASH_PRICE
    
    usage_obj = getattr(resultado_ia, "usage", None)
    if usage_obj is None:
        logger.warning("Objeto resultado_ia do feedback não possui atributo 'usage'.")
        return
        
    if callable(usage_obj):
        try:
            uso = usage_obj()
        except TypeError:
            uso = usage_obj
    else:
        uso = usage_obj
        
    input_tokens = getattr(uso, "input_tokens", getattr(uso, "request_tokens", 0)) or 0
    output_tokens = getattr(uso, "output_tokens", getattr(uso, "response_tokens", 0)) or 0 
    
    if input_tokens == 0 and output_tokens == 0:
        logger.warning("Uso de tokens retornou zero para a análise de feedback.")
        return

    nome_modelo_limpo = model_name.replace("google:", "").replace("google-cloud:", "") if model_name else "gemini-3.1-flash-lite"
    precos = TABELA_PRECOS.get(nome_modelo_limpo, TABELA_PRECOS.get("gemini-3.1-flash-lite", {"input_text": 0.25, "output": 1.50}))
    
    multiplicador_input = precos["input_text"] / BASE_FLASH_PRICE
    multiplicador_output = precos["output"] / BASE_FLASH_PRICE

    tokens_input_equivalentes = input_tokens * multiplicador_input
    tokens_output_equivalentes = output_tokens * multiplicador_output
    
    total_equivalente = tokens_input_equivalentes + tokens_output_equivalentes
    tokens_para_deduzir = math.ceil(total_equivalente)

    logger.info(
        f"Bilhetagem Feedback (Model: {model_name}): "
        f"In={input_tokens} Out={output_tokens} | "
        f"Multiplicadores (In={multiplicador_input}x, Out={multiplicador_output}x) | "
        f"Total Deduzido = {tokens_para_deduzir} tokens."
    )

    try:
        if tokens_para_deduzir > 0:
            comp = await db.get(models.Company, company_id)
            if comp:
                await crud_user.decrement_company_tokens(
                    db,
                    db_company=comp,
                    usage=tokens_para_deduzir,
                    atendimento_id=atendimento_id,
                    token_type="gemini_inference"
                )
    except Exception as e:
        logger.error(f"Falha ao deduzir tokens de feedback da empresa {company_id}: {e}", exc_info=True)


def organizar_layout_topologico(wf: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """
    Organiza o fluxo no layout exato de ESCADA EM ÁRVORE:
    - Transição Pai -> Filho: desloca generosamente para a direita (DELTA_X = 550) e um pouco para baixo (STAIR_STEP_Y = 140) formando a escada.
    - Balões que saem do mesmo lugar (irmãos): ocupam a mesma coluna (X = X_pai + 550) em linhas separadas (ROW_GAP_Y = 220).
    - TODAS as conexões saem da direita ('s-right') e entram pela esquerda ('t-left') com curvas bezier suaves.
    """
    if not wf or not isinstance(wf, dict):
        return wf

    nodes = wf.get("nodes", [])
    edges = wf.get("edges", [])
    if not nodes:
        return wf

    node_map = {n["id"]: n for n in nodes if isinstance(n, dict) and "id" in n}
    if not node_map:
        return wf

    adj = {nid: [] for nid in node_map}
    in_degree = {nid: 0 for nid in node_map}
    valid_edges = []

    for e in edges:
        e_dict = dict(e) if isinstance(e, dict) else {}
        src = e_dict.get("source")
        tgt = e_dict.get("target")
        if src in node_map and tgt in node_map and src != tgt:
            adj[src].append(tgt)
            in_degree[tgt] += 1
            valid_edges.append(e_dict)

    # Identifica o nó de entrada (start)
    start_id = None
    for nid, n in node_map.items():
        data = n.get("data", {}) if isinstance(n.get("data"), dict) else {}
        if data.get("node_type") == "start":
            start_id = nid
            break

    if not start_id:
        zeros = [nid for nid, deg in in_degree.items() if deg == 0]
        start_id = zeros[0] if zeros else list(node_map.keys())[0]

    DELTA_X = 550       # Deslocamento horizontal à direita ("o dobro na horizontal")
    STAIR_STEP_Y = 140  # Deslocamento vertical descendente do degrau ("um pouco a baixo, formando uma escada")
    ROW_GAP_Y = 220     # Distância vertical entre balões irmãos na mesma coluna ("mesma coluna em linhas diferentes")

    positions = {}
    occupied_y_by_x = {}

    def layout_node(nid: str, x_pos: float, parent_y: float) -> None:
        if nid in positions:
            return

        current_max_y = occupied_y_by_x.get(x_pos, parent_y)
        target_y = max(parent_y, current_max_y)

        positions[nid] = {"x": x_pos, "y": target_y}
        occupied_y_by_x[x_pos] = target_y + ROW_GAP_Y

        children = [c for c in adj[nid] if c not in positions]
        if not children:
            return

        child_x = x_pos + DELTA_X
        # O 1º filho desce o degrau da escada (STAIR_STEP_Y) em relação ao pai
        child_start_y = target_y + STAIR_STEP_Y

        for idx, child_id in enumerate(children):
            c_y = child_start_y if idx == 0 else occupied_y_by_x.get(child_x, child_start_y)
            layout_node(child_id, child_x, c_y)

    # Posiciona a árvore a partir do nó raiz
    layout_node(start_id, 80, 80)

    # Posiciona nós isolados remanescentes
    current_max_x80 = occupied_y_by_x.get(80, 80)
    for nid in node_map:
        if nid not in positions:
            positions[nid] = {"x": 80, "y": current_max_x80}
            current_max_x80 += ROW_GAP_Y

    # Aplica as posições finais aos nós do workflow
    for nid, pos in positions.items():
        n_obj = node_map[nid]
        if "position" not in n_obj or not isinstance(n_obj["position"], dict):
            n_obj["position"] = {}
        n_obj["position"]["x"] = pos["x"]
        n_obj["position"]["y"] = pos["y"]

    # TODAS as conexões saem da direita ('s-right') e entram pela esquerda ('t-left')
    for e in valid_edges:
        e["sourceHandle"] = "s-right"
        e["targetHandle"] = "t-left"

    return {
        "nodes": list(node_map.values()),
        "edges": valid_edges
    }


async def executar_agente_feedback(
    db: AsyncSession,
    company_id: int,
    config_id: int,
    feedback: str,
    modo: Literal['conversation', 'knowledge', 'flow'],
    user: models.User,
    atendimento_id: Optional[int] = None,
    current_workflow: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Executa o agente de feedback Pydantic AI para propor melhorias baseadas no contexto e modo,
    usando as configurações do modelo da persona ativa e decrementando os tokens consumidos.
    """
    # 1. Carrega as configurações da Persona da empresa no banco de dados
    query = select(models.Config).where(models.Config.id == config_id)
    res = await db.execute(query)
    persona_config = res.scalar_one_or_none()

    if not persona_config:
        # Fallback para company_id
        query = select(models.Config).where(models.Config.company_id == company_id)
        res = await db.execute(query)
        persona_config = res.scalar_one_or_none()

    # 2. Configura a chave de API do Gemini para o Pydantic AI
    from app.services.gemini_service import get_gemini_service
    try:
        gemini_service = get_gemini_service()
        if gemini_service and gemini_service.api_key:
            os.environ["GOOGLE_API_KEY"] = gemini_service.api_key
    except Exception as key_err:
        logger.warning(f"Não foi possível definir GOOGLE_API_KEY no feedback: {key_err}")

    # 3. Resolve o modelo e as configurações de inferência do banco de dados
    model_name = "gemini-3.1-flash-lite"
    temperature = 0.2
    top_p = 0.95
    top_k = 40
    thinking_level = "medium"
    thinking_budget = None

    if persona_config:
        if persona_config.ai_model:
            model_name = persona_config.ai_model
        if persona_config.temperature is not None:
            temperature = float(persona_config.temperature)
        if persona_config.top_p is not None:
            top_p = float(persona_config.top_p)
        if persona_config.top_k is not None:
            top_k = int(persona_config.top_k)
        if persona_config.thinking_level:
            thinking_level = str(persona_config.thinking_level).strip("'\"").strip().lower()
        if persona_config.thinking_budget is not None:
            thinking_budget = persona_config.thinking_budget

    model_to_use = model_name
    if not model_to_use.startswith("google:") and not model_to_use.startswith("google-cloud:"):
        model_to_use = f"google:{model_to_use}"

    # 4. Configura as opções do modelo Google (incluindo thinking_config)
    from pydantic_ai.models.google import GoogleModelSettings
    thinking_cfg = {}
    is_gemini_3 = "gemini-3" in model_to_use
    if is_gemini_3:
        raw_lvl = (thinking_level or "").strip("'\"").strip().lower()
        if raw_lvl and raw_lvl not in ("default", "none", "null", ""):
            thinking_cfg["thinking_level"] = raw_lvl.upper()
    elif thinking_budget is not None:
        thinking_cfg["thinking_budget"] = thinking_budget

    model_settings_dict = {
        "temperature": temperature,
        "top_p": top_p,
        "top_k": top_k,
    }
    if thinking_cfg:
        model_settings_dict["google_thinking_config"] = thinking_cfg

    model_settings = GoogleModelSettings(**model_settings_dict)

    deps = ContextoFeedback(
        db=db,
        company_id=company_id,
        config_id=config_id,
        modo=modo,
        feedback=feedback,
        atendimento_id=atendimento_id,
        user=user,
        current_workflow=current_workflow
    )
    
    prompt_usuario = (
        f"FEEDBACK/INSTRUÇÃO DO USUÁRIO:\n"
        f"\"{feedback}\"\n\n"
    )
    if modo == 'flow':
        prompt_usuario += (
            "IMPORTANTE (MODO FLOW):\n"
            "1. Organize a disposição dos nós em ESCADA DIAGONAL DESCENDENTE (staircase: incrementando X e Y a cada etapa).\n"
            "2. Atribua o `node_type` correto para cada balão ('start', 'message', 'decision', 'action', 'end') conforme a função do nó. NÃO use apenas 'message'.\n"
            "3. Preencha o campo `description` de TODOS os balões com instruções completas e ricas do que a IA deve falar/fazer.\n"
            "4. Forneça o resultado completo em `novo_workflow` com `nodes` e `edges`."
        )
    else:
        prompt_usuario += "Use as ferramentas apropriadas para carregar as informações do sistema atuais e atenda à solicitação."

    try:
        # Executa o agente Pydantic AI com o modelo e configurações resolvidos
        result = await feedback_agent.run(
            prompt_usuario, 
            deps=deps,
            model=model_to_use,
            model_settings=model_settings
        )
        
        # Contabiliza e desconta os tokens equivalentes consumidos no Gemini
        await contabilizar_tokens_feedback(
            resultado_ia=result,
            company_id=company_id,
            config_id=config_id,
            atendimento_id=atendimento_id,
            model_name=model_name,
            db=db
        )
        
        # Converte a resposta estruturada em um dicionário compatível com a API/Frontend
        resp: FeedbackAgentResponse = result.output
        
        novo_wf = None
        if resp.novo_workflow:
            if isinstance(resp.novo_workflow, BaseModel):
                novo_wf = resp.novo_workflow.model_dump()
            elif isinstance(resp.novo_workflow, dict):
                novo_wf = resp.novo_workflow
            elif isinstance(resp.novo_workflow, str):
                try:
                    novo_wf = json.loads(resp.novo_workflow)
                except Exception:
                    pass

        if novo_wf and isinstance(novo_wf, dict):
            novo_wf = organizar_layout_topologico(novo_wf)

        return {
            "analise_geral": resp.analise_geral,
            "alteracoes_planilha": [item.model_dump() for item in resp.alteracoes_planilha] if resp.alteracoes_planilha else [],
            "alteracoes_rag": [item.model_dump() for item in resp.alteracoes_rag] if resp.alteracoes_rag else [],
            "novo_workflow": novo_wf
        }
        
    except Exception as e:
        logger.error(f"Erro ao executar o agente de feedback: {e}", exc_info=True)
        return {
            "analise_geral": f"Erro interno ao processar o feedback com a IA: {str(e)}",
            "alteracoes_planilha": [],
            "alteracoes_rag": [],
            "novo_workflow": None
        }
