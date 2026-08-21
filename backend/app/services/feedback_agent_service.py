import os
import json
import logging
from typing import Optional, Literal, Any, Dict, List
from dataclasses import dataclass
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from pydantic_ai import Agent, RunContext
from pydantic_ai.models.google import GoogleModel
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
    label: str = Field(..., description="Nome curto da etapa em caixa alta (ex: 'BOAS-VINDAS', 'TRIAGEM', 'PRODUTOS', 'TRANSBORDO')")
    description: str = Field(..., description="Instruções completas e ricas para a IA sobre o que falar e fazer nesta etapa.")
    node_type: Literal['start', 'message', 'decision', 'action', 'end'] = Field(
        ...,
        description="Tipo do nó: 'start' (Início), 'message' (Diálogo), 'decision' (Menu/Opções), 'action' (Ferramenta), 'end' (Encerramento/Transbordo)."
    )

class WorkflowNodePosition(BaseModel):
    x: float = Field(default=100.0, description="Coordenada X em pixels")
    y: float = Field(default=100.0, description="Coordenada Y em pixels")

class WorkflowNode(BaseModel):
    id: str = Field(..., description="ID único do nó (ex: 'node_inicio', 'node_vendas')")
    type: str = Field(default="custom", description="Sempre 'custom'")
    position: Optional[WorkflowNodePosition] = Field(default_factory=lambda: WorkflowNodePosition(x=100, y=100))
    data: WorkflowNodeData

class WorkflowEdge(BaseModel):
    id: str = Field(..., description="ID único da conexão (ex: 'edge_inicio_triagem')")
    source: str = Field(..., description="ID do nó de origem")
    target: str = Field(..., description="ID do nó de destino")
    sourceHandle: Optional[str] = Field("s-right", description="Handle de saída: 's-right', 's-bot', 's-left', 's-top'")
    targetHandle: Optional[str] = Field("t-left", description="Handle de entrada: 't-left', 't-top', 't-bot', 't-right'")
    label: Optional[str] = Field(None, description="Rótulo condicional da conexão (ex: 'Opção 1', 'Sim', 'Não')")

class WorkflowData(BaseModel):
    nodes: List[WorkflowNode] = Field(default_factory=list, description="Lista de nós do fluxo visual")
    edges: List[WorkflowEdge] = Field(default_factory=list, description="Lista de conexões entre os nós")

class AlteracaoItem(BaseModel):
    acao: str = Field(description="Ação a ser executada: 'adicionar', 'modificar' ou 'remover'")
    aba: str = Field(description="Nome da aba na planilha onde a alteração deve ocorrer")
    coluna_1: str = Field(description="Categoria ou identificador da linha")
    valor_antigo: Optional[str] = Field(None, description="Valor anterior")
    valor_novo: str = Field(description="Novo valor sugerido")
    motivo: Optional[str] = Field(None, description="Explicação do porquê desta alteração")

class AlteracaoFormularioItem(BaseModel):
    campo: str = Field(description="Nome do campo no formulário da Persona (ex: 'ai_name', 'objective', 'restrictions', 'handoff_rules', 'extra_instructions', 'formality', 'objectivity')")
    secao: Optional[str] = Field(None, description="Seção da Aba Persona: 'Identidade', 'Tom de Voz', 'Missão', 'Regras e Restrições' ou 'Instruções Adicionais'")
    valor_antigo: Optional[Any] = Field(None, description="Valor anterior do campo")
    valor_novo: Any = Field(description="Novo valor sugerido para o campo")
    motivo: Optional[str] = Field(None, description="Motivo ou benefício da alteração")

class FeedbackAgentResponse(BaseModel):
    analise_geral: str = Field(description="Explicação detalhada das melhorias e diagnóstico proposto.")
    alteracoes_formulario: Optional[List[AlteracaoFormularioItem]] = Field(default=None, description="Melhorias recomendadas diretamente nos campos da Aba Persona (Formulário).")
    novo_persona_form: Optional[Dict[str, Any]] = Field(default=None, description="O objeto completo consolidado do formulário da Persona atualizado.")
    alteracoes_rag: Optional[List[AlteracaoItem]] = Field(default=None, description="Melhorias recomendadas na base de conhecimento RAG (produtos, FAQ, políticas).")
    novo_workflow: Optional[WorkflowData] = Field(default=None, description="O novo fluxo visual (Workflow) caso haja alterações estruturais.")
    alteracoes_planilha: Optional[List[AlteracaoItem]] = Field(default=None, description="Fallback: alterações em planilha de instruções legada caso aplicável.")

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
    GoogleModel('gemini-3.5-flash-lite'),
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
        "Sua missão é analisar as configurações da IA e propor melhorias estruturadas com base no feedback do usuário em até 3 eixos fundamentais:\n\n"
        "=== OS 3 EIXOS DE CONFIGURAÇÃO DO SISTEMA ===\n"
        "1. EIXO REGRAS E POSTURA (Aba Persona / `alteracoes_formulario` e `novo_persona_form`):\n"
        "   - Use sempre que o feedback envolver tom de voz, regras de atendimento, proibições, regras de transbordo humano, postura ou orientações gerais da IA.\n"
        "   - Preencha `alteracoes_formulario` e o objeto consolidado `novo_persona_form`.\n\n"
        "2. EIXO BASE DE CONHECIMENTO & PRODUTOS (Planilha RAG / `alteracoes_rag`):\n"
        "   - Use SEMPRE que o feedback envolver catálogo, produtos, variações, cores, acabamentos, preços, dimensões, estoque, prazos, políticas de troca, frete ou FAQs da empresa.\n"
        "   - Chame obrigatoriamente a ferramenta `obter_planilha_conhecimento_rag` para verificar as abas e linhas existentes.\n"
        "   - Preencha `alteracoes_rag` com a aba exata (`aba`), a coluna ou chave de busca (`coluna_1`), o valor anterior se houver (`valor_antigo`), a informação correta/atualizada (`valor_novo`) e a ação (`adicionar` ou `modificar`).\n\n"
        "3. EIXO ROTEIRO & ETAPAS DE CONVERSA (Workflow Visual / `novo_workflow`):\n"
        "   - Use SEMPRE que o feedback solicitar ou sugerir mudanças nas etapas do diálogo, fluxo de perguntas, triagem, roteiro de vendas, menus de decisão ou transbordo.\n"
        "   - Chame obrigatoriamente a ferramenta `obter_fluxo_visual` para carregar os nós e conexões existentes.\n"
        "   - Gere ou atualize os nós em `novo_workflow` (com `id`, `label`, `description` rica com instruções para a IA, `node_type` entre 'start', 'message', 'decision', 'action', 'end') e as devidas conexões (`edges`).\n\n"
        "--- LINGUAGEM DO DIAGNÓSTICO (`analise_geral`) ---\n"
        "O campo `analise_geral` é exibido DIRETAMENTE PARA O USUÁRIO FINAL (gestor da empresa) no modal da interface do sistema.\n"
        "1. LINGUAGEM HUMANIZADA E PROFISSIONAL: Escreva um resumo executivo claro, elegante e amigável (2 a 4 frases).\n"
        "2. PROIBIDO JARGÃO TÉCNICO INTERNO OU NOMES DE CÓDIGO: NUNCA mencione termos de código ou banco de dados como `novo_persona_form`, `restrictions`, `schema`, `payload`, `JSON`, `dicionário`, `array`, `objeto` ou nomes de colunas técnicas no diagnóstico.\n"
        "3. EXPLIQUE EM TERMOS DE NEGÓCIO E ATENDIMENTO: Explique com clareza o que foi identificado no atendimento analisado e quais diretrizes práticas, dados da base ou etapas do fluxo estão sendo aprimoradas para que as próximas conversas sejam mais naturais, assertivas e eficazes.\n\n"
        "--- DIRETRIZES PARA CRIAÇÃO DE REGRAS NO FORMULÁRIO ---\n"
        "1. VERBOS NO IMPERATIVO: Regras de restrição e transbordo devem usar verbos no imperativo (ex: 'Responda', 'Pergunte', 'Encaminhe', 'Nunca informe').\n"
        "2. SEM EXEMPLOS LITERAIS: Não inclua simulações de diálogos ou falas prontas nas regras.\n"
        "3. GENÉRICO E ESCALÁVEL: Escreva regras universais para orientar a IA em qualquer atendimento similar futuro.\n\n"
    )

    if modo == 'conversation':
        prompt += (
            "--- MODO: ANÁLISE DE CONVERSA DE ATENDIMENTO ---\n"
            "1. Chame `obter_historico_conversa` para inspecionar onde ocorreu o desvio ou insatisfação.\n"
            "2. Chame `obter_formulario_persona` para analisar as regras atuais da persona.\n"
            "3. Se houver desvio factual de catálogo/preços/informações de produtos, consulte `obter_planilha_conhecimento_rag` e preencha `alteracoes_rag`.\n"
            "4. Se houver desvio de roteiro/etapas de conversa, consulte `obter_fluxo_visual` e preencha `novo_workflow`.\n"
            "5. Proponha os ajustes necessários em `alteracoes_formulario`, `alteracoes_rag` e/ou `novo_workflow` de forma combinada e coerente.\n"
        )
    elif modo == 'knowledge':
        prompt += (
            "--- MODO: BASE DE CONHECIMENTO E REGRAS ---\n"
            "1. Chame `obter_formulario_persona` e `obter_planilha_conhecimento_rag`.\n"
            "2. Proponha melhorias claras em `alteracoes_formulario` e/ou `alteracoes_rag`.\n"
        )
    elif modo == 'flow':
        wf_str = json.dumps(ctx.deps.current_workflow, ensure_ascii=False) if ctx.deps.current_workflow else "Nenhum workflow enviado"
        prompt += (
            "--- MODO: EDITOR DE FLUXO VISUAL (WORKFLOW) ---\n"
            f"ESTADO ATUAL DO FLUXO:\n{wf_str}\n\n"
            "1. Edite nós e conexões atribuindo `node_type` correto ('start', 'message', 'decision', 'action', 'end').\n"
            "2. Preencha o campo `description` de todos os nós com orientações completas e ricas para a IA.\n"
            "3. Retorne o fluxo estruturado em `novo_workflow`.\n"
        )

    return prompt

# --- FERRAMENTAS ---

@feedback_agent.tool
async def obter_historico_conversa(ctx: RunContext[ContextoFeedback]) -> str:
    """Retorna o histórico da conversa de atendimento correspondente."""
    if not ctx.deps.atendimento_id:
        return "Nenhum atendimento associado."

    msgs_db = await crud_atendimento.get_messages_for_atendimento(
        ctx.deps.db, atendimento_id=ctx.deps.atendimento_id, company_id=ctx.deps.company_id
    )
    if not msgs_db:
        return "Nenhuma mensagem no histórico."

    if len(msgs_db) > 50:
        msgs_db = msgs_db[-50:]

    lines = []
    for msg in msgs_db:
        role = "IA" if msg.is_ai or msg.role == "assistant" else "Cliente"
        content = msg.content or msg.caption or ""
        lines.append(f"{role}: {content}")

    return "\n".join(lines)

@feedback_agent.tool
async def obter_formulario_persona(ctx: RunContext[ContextoFeedback]) -> str:
    """Retorna os dados estruturados do formulário da Aba Persona atual."""
    cfg = await crud_config.get_config(ctx.deps.db, config_id=ctx.deps.config_id, company_id=ctx.deps.company_id)
    if not cfg:
        return "Configuração não encontrada."

    form_data = cfg.persona_form or {}
    return (
        f"Nome da Configuração: {cfg.nome_config}\n"
        f"Modelo de IA: {cfg.ai_model}\n"
        f"Dados do Formulário da Persona (JSON):\n{json.dumps(form_data, ensure_ascii=False, indent=2)}\n"
        f"Prompt complementar legado (se houver):\n{cfg.prompt or 'Nenhum'}"
    )

@feedback_agent.tool
async def obter_planilha_conhecimento_rag(ctx: RunContext[ContextoFeedback]) -> str:
    """Retorna o conteúdo da planilha de RAG (Base de Conhecimento/FAQ)."""
    cfg = await crud_config.get_config(ctx.deps.db, config_id=ctx.deps.config_id, company_id=ctx.deps.company_id)
    if not cfg or not cfg.spreadsheet_rag_id:
        return "Planilha RAG não configurada."

    sheets_service = GoogleSheetsService()
    try:
        data = await sheets_service.get_sheet_as_json(cfg.spreadsheet_rag_id)
        return json.dumps(data, ensure_ascii=False, indent=2)
    except Exception as e:
        return f"Erro ao ler planilha RAG: {e}"

@feedback_agent.tool
async def obter_arquivos_drive(ctx: RunContext[ContextoFeedback]) -> str:
    """Retorna os arquivos e mídias indexados na pasta do Google Drive."""
    cfg = await crud_config.get_config(ctx.deps.db, config_id=ctx.deps.config_id, company_id=ctx.deps.company_id)
    if not cfg or not cfg.drive_id:
        return "Google Drive não configurado."

    drive_service = get_drive_service()
    try:
        drive_data = await drive_service.list_files_in_folder(cfg.drive_id)
        return json.dumps(drive_data, ensure_ascii=False, indent=2)
    except Exception as e:
        return f"Erro ao listar arquivos do drive: {e}"

@feedback_agent.tool
async def obter_fluxo_visual(ctx: RunContext[ContextoFeedback]) -> str:
    """Retorna a estrutura atual do workflow visual (nodes e edges)."""
    if ctx.deps.current_workflow:
        return json.dumps(ctx.deps.current_workflow, ensure_ascii=False, indent=2)

    cfg = await crud_config.get_config(ctx.deps.db, config_id=ctx.deps.config_id, company_id=ctx.deps.company_id)
    if not cfg:
        return "Configuração não encontrada."
    return json.dumps(cfg.workflow_json or {"nodes": [], "edges": []}, ensure_ascii=False, indent=2)

# --- FUNÇÃO DE LAYOUT TOPOLÓGICO PARA REACTFLOW ---

def organizar_layout_topologico(wf: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """
    Organiza o fluxo visual em layout harmônico de escada diagonal (ReactFlow).
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

    for e in edges:
        e_dict = dict(e) if isinstance(e, dict) else {}
        src = e_dict.get("source")
        tgt = e_dict.get("target")
        if src in node_map and tgt in node_map and src != tgt:
            adj[src].append(tgt)
            in_degree[tgt] = in_degree.get(tgt, 0) + 1

    # Início do layout
    cur_x = 100
    cur_y = 100
    for idx, (nid, node) in enumerate(node_map.items()):
        node["position"] = {"x": cur_x + (idx * 350), "y": cur_y + (idx * 160)}

    return wf

import re

def clean_rule_list(val: Any) -> List[str]:
    """Limpa listas de regras (restrictions, handoff_rules, qualities) removendo JSON residual, colchetes e aspas."""
    if val is None or val == "":
        return []
    
    if isinstance(val, list):
        cleaned = []
        for item in val:
            cleaned.extend(clean_rule_list(item))
        return [c for c in cleaned if c]
    elif isinstance(val, dict):
        cleaned = []
        for v in val.values():
            cleaned.extend(clean_rule_list(v))
        return [c for c in cleaned if c]
    
    text = str(val).strip()
    if not text:
        return []
    
    # Se for JSON stringificado, tenta parse
    if (text.startswith("[") and text.endswith("]")) or (text.startswith("{") and text.endswith("}")):
        try:
            parsed = json.loads(text)
            return clean_rule_list(parsed)
        except Exception:
            pass
            
    # Remove fragmentos de JSON residual como '],objective:', '],{campo:...', '}]'
    text = re.sub(r'\]\s*,\s*\{.*$', '', text, flags=re.DOTALL)
    text = re.sub(r'\]\s*,\s*["\']?[a-zA-Z0-9_]+["\']?\s*:.*$', '', text, flags=re.DOTALL)
    text = text.replace("\\n", "\n")
    
    lines = text.split("\n")
    cleaned_items = []
    
    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue
            
        # Ignora linhas que são só colchetes/chaves
        if re.match(r'^[\[\]\{\}\(\),;]+$', line):
            continue
            
        # Remove colchetes de abertura/fechamento
        line = re.sub(r'^[\[\(\{]\s*', '', line)
        line = re.sub(r'[\}\]\)]\s*$', '', line)
        
        # Remove aspas externas e pontuações finais residuais
        line = re.sub(r'^["\'`]\s*', '', line)
        line = re.sub(r'\s*["\'`,;]+$', '', line)
        line = re.sub(r'^[-•*]\s*', '', line)
        line = re.sub(r'^\d+[\.\)]\s*', '', line)
        line = line.strip()
        
        if line and len(line) > 1 and not re.match(r'^[\[\]\{\}]+$', line):
            if '", "' in line or '","' in line:
                sub_parts = [p.strip().strip('"\'`') for p in re.split(r'",\s*"', line) if p.strip()]
                cleaned_items.extend(sub_parts)
            else:
                cleaned_items.append(line)
                
    return cleaned_items

def sanitize_persona_form(form_data: Any) -> Dict[str, Any]:
    """Garante que todos os campos do formulário de persona estejam no formato e tipo corretos."""
    if not isinstance(form_data, dict):
        return {}
        
    cleaned = dict(form_data)
    
    # Campos que DEVEM ser List[str]
    for list_field in ["restrictions", "handoff_rules", "qualities", "tags"]:
        if list_field in cleaned:
            cleaned[list_field] = clean_rule_list(cleaned[list_field])
            
    # Campos que DEVEM ser str limpa
    for str_field in ["ai_name", "company_name", "role", "language", "objective", "extra_instructions", "nature_identity"]:
        if str_field in cleaned and cleaned[str_field] is not None:
            val = cleaned[str_field]
            if isinstance(val, (list, dict)):
                cleaned[str_field] = "\n".join(clean_rule_list(val))
            else:
                s_val = str(val).strip()
                s_val = re.sub(r'^[\[\(\{]\s*', '', s_val)
                s_val = re.sub(r'[\}\]\)]\s*$', '', s_val)
                s_val = re.sub(r'^["\'`]\s*', '', s_val)
                s_val = re.sub(r'\s*["\'`]+$', '', s_val)
                cleaned[str_field] = s_val.strip()
                
    # Campos numéricos
    for num_field in ["formality", "objectivity"]:
        if num_field in cleaned and cleaned[num_field] is not None:
            try:
                cleaned[num_field] = float(cleaned[num_field])
            except Exception:
                cleaned[num_field] = 0.5
                
    return cleaned

# --- FUNÇÃO PRINCIPAL ---

async def executar_agente_feedback(
    db: AsyncSession,
    company_id: int,
    config_id: int,
    feedback: str,
    modo: Literal['conversation', 'knowledge', 'flow'],
    user: Optional[models.User] = None,
    atendimento_id: Optional[int] = None,
    current_workflow: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Ponto de entrada para execução do Agente de Feedback.
    """
    persona = await db.get(models.Config, config_id)
    raw_model = persona.ai_model if persona and persona.ai_model else "gemini-3.5-flash-lite"
    clean_model = raw_model.replace("google:", "").replace("google-gla:", "").replace("google-vertex:", "").replace("google-cloud:", "")
    model_to_use = GoogleModel(clean_model)

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

    prompt_usuario = f"INSTRUÇÃO DO USUÁRIO:\n\"{feedback}\"\n\nAnalise o sistema e responda estruturadamente."

    try:
        result = await feedback_agent.run(
            prompt_usuario,
            deps=deps,
            model=model_to_use
        )

        resp: FeedbackAgentResponse = result.output

        # Contabilização de tokens
        try:
            usage = result.usage()
            if usage:
                in_t = usage.request_tokens or 0
                out_t = usage.response_tokens or 0
                if hasattr(usage, 'details') and isinstance(usage.details, dict):
                    out_t += usage.details.get('thinking', 0) or usage.details.get('thoughts', 0) or 0
                
                from app.services.agent_service import TABELA_PRECOS, BASE_FLASH_PRICE
                import math
                from app.crud import crud_user

                precos = TABELA_PRECOS.get(clean_model, TABELA_PRECOS.get("gemini-3.5-flash-lite", {"input_text": 0.25, "output": 1.50}))
                mult_in = precos.get("input_text", 0.25) / BASE_FLASH_PRICE
                mult_out = precos.get("output", 1.50) / BASE_FLASH_PRICE
                tokens_deduzir = math.ceil((in_t * mult_in) + (out_t * mult_out))

                if tokens_deduzir > 0:
                    comp = await db.get(models.Company, company_id)
                    if comp:
                        await crud_user.decrement_company_tokens(
                            db,
                            db_company=comp,
                            usage=tokens_deduzir,
                            atendimento_id=atendimento_id,
                            token_type="feedback_agent"
                        )
                        await db.commit()
                        logger.info(f"[Feedback Agent] Tokens deduzidos: {tokens_deduzir} (In: {in_t}, Out: {out_t}) para Empresa {company_id}")
        except Exception as token_err:
            logger.error(f"Erro ao contabilizar tokens no agente de feedback: {token_err}")

        novo_wf = None
        if resp.novo_workflow:
            if isinstance(resp.novo_workflow, BaseModel):
                novo_wf = resp.novo_workflow.model_dump()
            elif isinstance(resp.novo_workflow, dict):
                novo_wf = resp.novo_workflow

        if novo_wf:
            novo_wf = organizar_layout_topologico(novo_wf)

        # Sanitiza alteracoes_formulario e novo_persona_form
        clean_alteracoes_form = []
        if resp.alteracoes_formulario:
            for item in resp.alteracoes_formulario:
                campo_name = item.campo
                v_novo = item.valor_novo
                v_antigo = item.valor_antigo
                
                if campo_name in ["restrictions", "handoff_rules", "qualities", "tags"]:
                    v_novo_clean = clean_rule_list(v_novo)
                    v_antigo_clean = clean_rule_list(v_antigo) if v_antigo is not None else None
                else:
                    v_novo_clean = str(v_novo).strip() if v_novo is not None else ""
                    v_antigo_clean = str(v_antigo).strip() if v_antigo is not None else None
                    
                clean_alteracoes_form.append({
                    "campo": item.campo,
                    "secao": item.secao,
                    "valor_antigo": v_antigo_clean,
                    "valor_novo": v_novo_clean,
                    "motivo": item.motivo
                })
                
        clean_novo_form = sanitize_persona_form(resp.novo_persona_form) if resp.novo_persona_form else None

        return {
            "analise_geral": resp.analise_geral,
            "alteracoes_formulario": clean_alteracoes_form,
            "novo_persona_form": clean_novo_form,
            "alteracoes_rag": [item.model_dump() for item in resp.alteracoes_rag] if resp.alteracoes_rag else [],
            "novo_workflow": novo_wf,
            "alteracoes_planilha": [item.model_dump() for item in resp.alteracoes_planilha] if resp.alteracoes_planilha else []
        }

    except Exception as e:
        logger.error(f"Erro ao executar agente de feedback: {e}", exc_info=True)
        return {
            "analise_geral": f"Erro no processamento do feedback: {str(e)}",
            "alteracoes_formulario": [],
            "novo_persona_form": None,
            "alteracoes_rag": [],
            "novo_workflow": None,
            "alteracoes_planilha": []
        }
