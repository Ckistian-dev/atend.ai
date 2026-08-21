import os
import json
import logging
from typing import Optional, Any, Dict, List
from dataclasses import dataclass
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from pydantic_ai import Agent, RunContext
from pydantic_ai.models.google import GoogleModel
from pydantic import BaseModel, Field

from app.db import models
from app.crud import crud_atendimento
from app.core.config import settings
from app.services.gemini_service import GeminiService

logger = logging.getLogger(__name__)

# Configura a chave de API do Gemini para o Pydantic AI
if not os.environ.get("GOOGLE_API_KEY") and settings.GOOGLE_API_KEYS:
    keys = [k.strip() for k in settings.GOOGLE_API_KEYS.split(",") if k.strip()]
    if keys:
        os.environ["GOOGLE_API_KEY"] = keys[0]

# --- ESTRUTURA DE RETORNO DO AGENTE DE ANÁLISE ---
class ModuloAnalise(BaseModel):
    tipo: str = Field(description="Tipo do componente: 'hero_stat', 'metric_grid', 'pie_chart', 'bar_chart', 'friction_cards', 'insight_cards', 'text_section', 'timeline_events', 'line_chart', 'area_chart', 'radar_chart', 'progress_list', 'swot_analysis', 'sentiment_meter', 'action_steps', 'highlight_quotes', 'comparative_table', 'key_value_list'")
    titulo: Optional[str] = Field(None, description="Título do módulo")
    descricao: Optional[str] = Field(None, description="Descrição ou legenda explicativa do módulo")
    valor: Optional[str] = Field(None, description="Valor principal (ex: '85%', '120 atendimentos')")
    label: Optional[str] = Field(None, description="Rótulo da métrica principal")
    tendencia: Optional[str] = Field(None, description="'alta', 'baixa' ou 'neutro'")
    metricas: Optional[List[Dict[str, Any]]] = Field(None, description="Lista de métricas do grid. Cada item DEVE ter: 'label' (nome), 'valor' (número/porcentagem), 'cor' ('azul', 'verde', 'amarelo', 'roxo', 'vermelho', 'ciano', 'rosa') e 'icone' ('trending', 'percent', 'users', 'clock', 'activity', 'target')")
    dados: Optional[List[Dict[str, Any]]] = Field(None, description="Dados para gráficos (name: categoria, value: número)")
    eixo_x: Optional[str] = Field(None, description="Nome do eixo X")
    itens: Optional[List[Dict[str, Any]]] = Field(None, description="Lista de itens genéricos (ex: fricção, insights, progresso)")
    conteudo: Optional[str] = Field(None, description="Conteúdo textual analítico")
    estilo: Optional[str] = Field(None, description="'diagnostico', 'estrategia' ou 'conclusao'")
    eventos: Optional[List[Dict[str, Any]]] = Field(None, description="Lista de eventos da timeline (titulo, descricao, data, tipo: 'sucesso', 'alerta', 'perda', 'oportunidade', 'info')")
    categorias: Optional[List[Dict[str, Any]]] = Field(None, description="Categorias do radar chart (name, value)")
    forcas: Optional[List[str]] = Field(None, description="Forças identificadas (SWOT)")
    fraquezas: Optional[List[str]] = Field(None, description="Fraquezas identificadas (SWOT)")
    oportunidades: Optional[List[str]] = Field(None, description="Oportunidades de melhoria (SWOT)")
    ameacas: Optional[List[str]] = Field(None, description="Ameaças ou riscos operacionais (SWOT)")
    positivo: Optional[float] = Field(None, description="Percentual positivo (0-100)")
    neutro: Optional[float] = Field(None, description="Percentual neutro (0-100)")
    negativo: Optional[float] = Field(None, description="Percentual negativo (0-100)")
    resumo: Optional[str] = Field(None, description="Resumo do sentimento")
    passos: Optional[List[Dict[str, Any]]] = Field(None, description="Passos do plano de ação: 'titulo', 'descricao', 'prazo' ('Imediato', 'Curto Prazo'), 'responsavel' ('Atendimento', 'Comercial')")
    citacoes: Optional[List[Dict[str, Any]]] = Field(None, description="Citações reais (texto, autor, contexto)")
    colunas: Optional[List[str]] = Field(None, description="Colunas da tabela")
    linhas: Optional[List[List[str]]] = Field(None, description="Linhas da tabela")

class AnalysisAgentResponse(BaseModel):
    resposta_direta: str = Field(description="Resumo executivo direto, claro e completo respondendo à pergunta.")
    modulos: List[ModuloAnalise] = Field(description="Lista de componentes visuais estruturados que compõem o relatório.")

# --- CONTEXTO DE DEPENDÊNCIA (MULTI-TENANT) ---
@dataclass
class ContextoAnalise:
    db: AsyncSession
    company_id: int
    start_date: datetime
    end_date: datetime
    user: models.User
    gemini_service: GeminiService
    model_name: str

# --- O AGENTE ---
analysis_agent = Agent(
    GoogleModel('gemini-3.5-flash-lite'),
    deps_type=ContextoAnalise,
    output_type=AnalysisAgentResponse,
    retries=2
)

# --- SYSTEM PROMPT DINÂMICO ---
@analysis_agent.system_prompt
def construir_prompt_analise(ctx: RunContext[ContextoAnalise]) -> str:
    start_date_str = ctx.deps.start_date.strftime("%d/%m/%Y %H:%M:%S")
    end_date_str = ctx.deps.end_date.strftime("%d/%m/%Y %H:%M:%S")

    prompt = (
        "Você é um Analista de Dados Sênior e Estrategista de Operações de Atendimento.\n"
        "Sua missão é gerar relatórios de inteligência de negócios extremamente ricos, detalhados, elegantes e orientados à ação.\n\n"
        f"--- CONTEXTO DA REQUISIÇÃO ---\n"
        f"- Período da Análise: {start_date_str} até {end_date_str}\n"
        f"- Usuário Solicitante: {ctx.deps.user.name} ({ctx.deps.user.email})\n\n"
        "--- FLUXO OBRIGATÓRIO DE INVESTIGAÇÃO ---\n"
        "1. COLETA MACRO: Acione `obter_estatisticas_gerais` para mapear volume total, status e métricas.\n"
        "2. PESQUISA QUALITATIVA: Acione `buscar_dados_atendimentos` pesquisando pela dúvida e termos de atrito.\n"
        "3. DETALHAMENTO: Para atendimentos críticos, chame `obter_detalhes_atendimento`.\n"
        "4. SÍNTESE VISUAL: Monte uma `resposta_direta` executiva e selecione de 3 a 6 `modulos` visuais altamente complementares.\n\n"
        "--- REGRAS MANDATÓRIAS PARA PREENCHIMENTO DOS MÓDULOS ---\n"
        "- `metric_grid`: OBRIGATÓRIO preencher tanto o 'label' quanto o 'valor' em cada item de `metricas` (ex: `{'label': 'Total de Atendimentos', 'valor': '1', 'cor': 'azul', 'icone': 'total'}`). NUNCA deixe o 'valor' em branco!\n"
        "- `pie_chart` e `bar_chart`: Use `dados` com `name` e `value` numérico não nulo.\n"
        "- `swot_analysis`: Preencha com observações ricas e assertivas em todos os 4 quadrantes (Forças, Fraquezas, Oportunidades, Ameaças).\n"
        "- `action_steps`: Preencha `passos` com ações práticas, incluindo `titulo`, `descricao`, `prazo` e `responsavel`.\n"
        "- Baseie-se exclusivamente nos dados reais retornados pelas ferramentas.\n"
    )
    return prompt

# --- FERRAMENTAS ---

@analysis_agent.tool
async def obter_estatisticas_gerais(ctx: RunContext[ContextoAnalise]) -> Dict[str, Any]:
    """Retorna estatísticas gerais de atendimentos no período da análise."""
    return await crud_atendimento.get_dashboard_data(
        db=ctx.deps.db,
        company_id=ctx.deps.company_id,
        start_date=ctx.deps.start_date,
        end_date=ctx.deps.end_date
    )

@analysis_agent.tool
async def buscar_dados_atendimentos(
    ctx: RunContext[ContextoAnalise],
    query: str = "",
    tamanho_amostragem: int = 50
) -> List[Dict[str, Any]]:
    """Busca mensagens e informações dos atendimentos usando busca vetorial e textual."""
    db = ctx.deps.db
    company_id = ctx.deps.company_id
    start_date = ctx.deps.start_date
    end_date = ctx.deps.end_date
    gemini_service = ctx.deps.gemini_service

    query_embedding = None
    if query.strip():
        try:
            query_embedding = await gemini_service.generate_embedding(query)
        except Exception as e:
            logger.error(f"Erro ao gerar embedding: {e}")

    stmt = select(models.AtendimentoMessageSearch).where(
        models.AtendimentoMessageSearch.company_id == company_id,
        models.AtendimentoMessageSearch.message_date >= start_date,
        models.AtendimentoMessageSearch.message_date <= end_date
    )

    if query_embedding:
        stmt = stmt.order_by(models.AtendimentoMessageSearch.embedding.cosine_distance(query_embedding).asc())
    else:
        stmt = stmt.order_by(models.AtendimentoMessageSearch.message_date.desc())

    stmt = stmt.limit(tamanho_amostragem)
    result = await db.execute(stmt)
    records = result.scalars().all()

    output = []
    for r in records:
        output.append({
            "message_id": r.message_id,
            "role": r.role,
            "content": r.content,
            "message_date": r.message_date.isoformat() if r.message_date else None,
            "atendimento_info": r.atendimento_info
        })
    return output

@analysis_agent.tool
async def obter_detalhes_atendimento(
    ctx: RunContext[ContextoAnalise],
    atendimento_id: int
) -> Dict[str, Any]:
    """Retorna o histórico completo e detalhes de um atendimento específico."""
    atend = await crud_atendimento.get_atendimento(
        db=ctx.deps.db,
        atendimento_id=atendimento_id,
        company_id=ctx.deps.company_id
    )
    if not atend:
        return {"error": "Atendimento não encontrado"}

    msgs_db = await crud_atendimento.get_messages_for_atendimento(
        db=ctx.deps.db,
        atendimento_id=atendimento_id,
        company_id=ctx.deps.company_id
    )
    conversa = [
        {
            "id": m.message_id,
            "role": m.role,
            "content": m.content or m.caption or "",
            "timestamp": int(m.timestamp.timestamp()) if m.timestamp else 0,
            "type": m.type,
            "status": m.status,
            "reaction": m.reaction
        }
        for m in msgs_db
    ]

    return {
        "id": atend.id,
        "whatsapp": atend.whatsapp,
        "nome_contato": atend.nome_contato,
        "status": atend.status,
        "resumo": atend.resumo,
        "observacoes": atend.observacoes,
        "tags": atend.tags,
        "created_at": atend.created_at.isoformat() if atend.created_at else None,
        "updated_at": atend.updated_at.isoformat() if atend.updated_at else None,
        "conversa": conversa
    }

async def sync_atendimentos_to_search(db: AsyncSession, company_id: int, gemini_service: GeminiService):
    """
    Sincroniza mensagens da tabela 'mensagens' para busca vetorial gerando embeddings para mensagens pendentes.
    """
    logger.info(f"Sincronizando mensagens para busca vetorial. Empresa: {company_id}")

    stmt_unembedded = (
        select(models.Message)
        .where(
            models.Message.company_id == company_id,
            models.Message.embedding.is_(None),
            models.Message.content.isnot(None),
            models.Message.content != ""
        )
        .limit(500)
    )
    res_unembedded = await db.execute(stmt_unembedded)
    msgs_to_embed = res_unembedded.scalars().all()

    if not msgs_to_embed:
        logger.info("Nenhuma mensagem pendente de embedding encontrada.")
        return

    logger.info(f"Gerando embeddings para {len(msgs_to_embed)} mensagens da tabela 'mensagens'...")
    contents = [m.content for m in msgs_to_embed]
    embeddings = await gemini_service.generate_embeddings_batch(contents)

    for idx, msg in enumerate(msgs_to_embed):
        emb = embeddings[idx] if idx < len(embeddings) else None
        if emb:
            msg.embedding = emb
            db.add(msg)

    await db.commit()
    logger.info(f"Sincronização concluída: {len(msgs_to_embed)} mensagens indexadas com embeddings.")
