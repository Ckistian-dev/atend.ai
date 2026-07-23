import os
import json
import logging
from typing import Optional, Any, Dict, List
from dataclasses import dataclass
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from pydantic_ai import Agent, RunContext
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
    tipo: str = Field(description="O tipo do componente visual. Deve ser obrigatoriamente um dos seguintes: 'hero_stat', 'metric_grid', 'pie_chart', 'bar_chart', 'friction_cards', 'insight_cards', 'text_section', 'timeline_events', 'line_chart', 'area_chart', 'radar_chart', 'progress_list', 'swot_analysis', 'sentiment_meter', 'action_steps', 'highlight_quotes', 'comparative_table', 'key_value_list'")
    titulo: Optional[str] = Field(None, description="Título do módulo")
    descricao: Optional[str] = Field(None, description="Descrição ou legenda explicativa do módulo")
    
    # Campos específicos para hero_stat
    valor: Optional[str] = Field(None, description="Valor principal (ex: '85%', '2 atendimentos', '11h 6m')")
    label: Optional[str] = Field(None, description="Rótulo do valor principal (ex: 'Tempo Médio', 'Taxa de Conversão')")
    tendencia: Optional[str] = Field(None, description="Tendência do valor: 'alta', 'baixa' ou 'neutro'")
    
    # Campos para metric_grid
    metricas: Optional[List[Dict[str, Any]]] = Field(None, description="Lista de métricas (cada uma com label, valor, icone, cor)")
    
    # Campos para gráficos (pie_chart, bar_chart, line_chart, area_chart)
    dados: Optional[List[Dict[str, Any]]] = Field(None, description="Lista de dados com name (str) e value (numeric)")
    eixo_x: Optional[str] = Field(None, description="Nome do eixo X (usado no bar_chart)")
    
    # Campos para friction_cards, insight_cards, progress_list ou key_value_list
    itens: Optional[List[Dict[str, Any]]] = Field(None, description="Lista de itens")
    
    # Campos para text_section
    conteudo: Optional[str] = Field(None, description="Conteúdo de texto")
    estilo: Optional[str] = Field(None, description="Estilo de texto: 'diagnostico', 'estrategia' ou 'conclusao'")
    
    # Campos para timeline_events
    eventos: Optional[List[Dict[str, Any]]] = Field(None, description="Lista de eventos (id, data, descricao, tipo, whatsapp)")
    
    # Campos para radar_chart
    categorias: Optional[List[Dict[str, Any]]] = Field(None, description="Lista de categorias (name, value, fullMark)")
    
    # Campos para swot_analysis
    forcas: Optional[List[str]] = Field(None, description="Lista de forças")
    fraquezas: Optional[List[str]] = Field(None, description="Lista de fraquezas")
    oportunidades: Optional[List[str]] = Field(None, description="Lista de oportunidades")
    ameacas: Optional[List[str]] = Field(None, description="Lista de ameaças")
    
    # Campos para sentiment_meter
    positivo: Optional[float] = Field(None, description="Porcentagem de sentimento positivo (0-100)")
    neutro: Optional[float] = Field(None, description="Porcentagem de sentimento neutro (0-100)")
    negativo: Optional[float] = Field(None, description="Porcentagem de sentimento negativo (0-100)")
    resumo: Optional[str] = Field(None, description="Resumo do sentimento")
    
    # Campos para action_steps
    passos: Optional[List[Dict[str, Any]]] = Field(None, description="Lista de passos do plano de ação (numero, titulo, descricao)")
    
    # Campos para highlight_quotes
    citacoes: Optional[List[Dict[str, Any]]] = Field(None, description="Lista de citações (autor, texto, contexto)")
    
    # Campos para comparative_table
    colunas: Optional[List[str]] = Field(None, description="Lista de nomes das colunas")
    linhas: Optional[List[List[str]]] = Field(None, description="Matriz de linhas de dados (lista de lista de strings)")

# --- ESTRUTURA DE RETORNO DO AGENTE DE ANÁLISE ---
class AnalysisAgentResponse(BaseModel):
    resposta_direta: str = Field(description="Uma frase curta e direta respondendo à pergunta do usuário.")
    modulos: List[ModuloAnalise] = Field(description="Uma lista ordenada de componentes visuais estruturados que compõem o relatório.")

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
    'google:gemini-2.5-flash',  # Usamos o 2.5 flash como modelo padrão para análises estruturadas rápidas
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
        "Sua missão é gerar relatórios de análise de dados extremamente detalhados, precisos, estruturados e acionáveis.\n\n"
        f"--- CONTEXTO DA REQUISIÇÃO ---\n"
        f"- Período da Análise: {start_date_str} até {end_date_str}\n"
        f"- Usuário Solicitante: {ctx.deps.user.name} ({ctx.deps.user.email})\n\n"
        "--- FLUXO OBRIGATÓRIO DE INVESTIGAÇÃO (SEQUENCIAL) ---\n"
        "1. COLETA MACRO QUANTITATIVA: Acione `obter_estatisticas_gerais` para mapear volume total, status, taxa de conversão e tempos médios.\n"
        "2. PESQUISA QUALITATIVA VETORIAL: Acione `buscar_dados_atendimentos` pesquisando pela dúvida do usuário e por termos chave de atrito "
        "(ex: 'atraso', 'problema', 'preço', 'dúvida', 'não respondeu', 'demora', 'reclamação'). Use tamanho_amostragem de 30 a 50 para ampla cobertura.\n"
        "3. DEEP DIVE EM CASOS CRÍTICOS: Para atendimentos identificados com gargalos, reclamações ou status pendentes, chame `obter_detalhes_atendimento` "
        "com o `atendimento_id` para ler as mensagens completas e identificar a causa raiz.\n"
        "4. SÍNTESE E ESTRUTURAÇÃO: Monte o relatório com `resposta_direta` (1 a 3 parágrafos executivos) e `modulos` (3 a 6 componentes visuais pertinentes).\n\n"
        "--- DIRETRIZES DE QUALIDADE E INTEGRIDADE ---\n"
        "- DADOS REAIS E EVIDÊNCIAS: Proibido inventar dados ou métricas. Cite nomes de contatos e números de WhatsApp reais das ferramentas.\n"
        "- RECOMENDAÇÕES PRÁTICAS: Todo ponto de atrito deve ter um plano de ação equivalente (`action_steps` ou `insight_cards`).\n"
        "- BAIXO VOLUME DE DADOS: Se houver poucas conversas no período, detalhe individualmente cada atendimento e o motivo do seu status atual.\n\n"
        "--- CATÁLOGO DE MÓDULOS VISUAIS DISPONÍVEIS ---\n"
        "Cada objeto na lista 'modulos' DEVE definir obrigatoriamente a propriedade 'tipo' correspondente:\n\n"
        "📊 GRUPO 1: KPIs E MÉTRICAS PRINCIPAIS\n"
        "- `hero_stat`: Métrica destaque individual. Requer: tipo='hero_stat', valor (ex: '85%'), label (ex: 'Conversão'), descricao, tendencia ('alta'|'baixa'|'neutro').\n"
        "- `metric_grid`: Grade de múltiplos KPIs. Requer: tipo='metric_grid', titulo, metricas (lista de dicts com label, valor, icone ('trending'|'alert'|'clock'|'percent'|'users'), cor ('verde'|'vermelho'|'amarelo'|'azul'|'roxo')).\n"
        "- `sentiment_meter`: Termômetro de satisfação/sentimento. Requer: tipo='sentiment_meter', titulo, positivo (float 0-100), neutro (float 0-100), negativo (float 0-100), resumo.\n\n"
        "📈 GRUPO 2: GRÁFICOS E DISTRIBUIÇÕES\n"
        "- `pie_chart`: Gráfico de pizza/proporção. Requer: tipo='pie_chart', titulo, descricao, dados (lista de dicts com name, value).\n"
        "- `bar_chart`: Gráfico de barras. Requer: tipo='bar_chart', titulo, descricao, eixo_x, dados (lista de dicts com name, value).\n"
        "- `line_chart` / `area_chart`: Tendências temporais. Requer: tipo='line_chart' ou 'area_chart', titulo, descricao, dados (lista de dicts com name, value).\n"
        "- `radar_chart`: Análise multidimensional. Requer: tipo='radar_chart', titulo, categorias (lista de dicts com name, value, fullMark).\n\n"
        "⚠️ GRUPO 3: ATRITOS, QUALITATIVOS E LINHA DO TEMPO\n"
        "- `friction_cards`: Pontos de atrito ou gargalos operacionais. Requer: tipo='friction_cards', titulo, itens (lista de dicts com area, observacoes, impacto ('Alto'|'Médio'|'Baixo'), contatos_exemplo (lista de str)).\n"
        "- `insight_cards`: Insights e recomendações estratégicas. Requer: tipo='insight_cards', titulo, itens (lista de dicts com titulo, descricao, prioridade ('alta'|'media'|'baixa'), icone ('lightbulb'|'zap'|'target'|'star')).\n"
        "- `timeline_events`: Marcos ou eventos cronológicos. Requer: tipo='timeline_events', titulo, eventos (lista de dicts com id, data, descricao, tipo ('sucesso'|'alerta'|'perda'|'oportunidade'|'info'), whatsapp).\n"
        "- `highlight_quotes`: Citações reais marcantes extraídas das conversas. Requer: tipo='highlight_quotes', titulo, citacoes (lista de dicts com autor, texto, contexto).\n\n"
        "🎯 GRUPO 4: ESTRATÉGIA, TABELAS E AÇÕES\n"
        "- `swot_analysis`: Análise de Forças, Fraquezas, Oportunidades e Ameaças. Requer: tipo='swot_analysis', titulo, forcas, fraquezas, oportunidades, ameacas.\n"
        "- `action_steps`: Plano de ação detalhado passo a passo. Requer: tipo='action_steps', titulo, passos (lista de dicts com numero, titulo, descricao).\n"
        "- `comparative_table`: Tabela comparativa. Requer: tipo='comparative_table', titulo, colunas (lista de str), linhas (lista de listas de str).\n"
        "- `progress_list`: Lista com barra de progresso. Requer: tipo='progress_list', titulo, descricao, itens (lista de dicts com label, progresso (0-100), valor_texto).\n"
        "- `key_value_list`: Lista chave-valor de metadados. Requer: tipo='key_value_list', titulo, itens (lista de dicts com chave, valor).\n"
        "- `text_section`: Conclusões textuais detalhadas. Requer: tipo='text_section', titulo, conteudo, estilo ('diagnostico'|'estrategia'|'conclusao').\n"
    )
    return prompt

# --- FERRAMENTAS ---

@analysis_agent.tool
async def obter_estatisticas_gerais(ctx: RunContext[ContextoAnalise]) -> Dict[str, Any]:
    """
    Retorna estatísticas gerais de atendimentos consolidadas no período de tempo da análise.
    Inclui total de atendimentos, contagem por status, taxa de conversão, consumo de tokens e tempos médios.
    """
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
    """
    Busca mensagens e informações dos atendimentos no banco de dados usando busca vetorial e textual.
    A busca respeita o filtro de tempo configurado para a análise.
    
    Args:
        query: Termo de pesquisa ou pergunta para buscar mensagens e atendimentos semanticamente semelhantes.
        tamanho_amostragem: O número máximo de resultados (mensagens/atendimentos) a retornar (tamanho da amostragem).
    """
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
            logger.error(f"Erro ao gerar embedding para a busca: {e}")

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
            "message_date": r.message_date.isoformat(),
            "atendimento_info": r.atendimento_info
        })

    return output

@analysis_agent.tool
async def obter_detalhes_atendimento(
    ctx: RunContext[ContextoAnalise],
    atendimento_id: int
) -> Dict[str, Any]:
    """
    Retorna o histórico completo e todos os detalhes de um atendimento específico pelo seu ID.
    """
    atend = await crud_atendimento.get_atendimento(
        db=ctx.deps.db,
        atendimento_id=atendimento_id,
        company_id=ctx.deps.company_id
    )
    if not atend:
        return {"error": "Atendimento não encontrado"}
    
    try:
        conversa = json.loads(atend.conversa or "[]")
    except:
        conversa = []

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

# --- FUNÇÃO DE SINCRONIZAÇÃO DE MENSAGENS E EMBEDDINGS ---
async def sync_atendimentos_to_search(db: AsyncSession, company_id: int, gemini_service: GeminiService):
    """
    Sincroniza todas as conversas/mensagens dos atendimentos da empresa para a tabela de busca vetorial.
    Busca apenas mensagens que ainda não foram indexadas.
    """
    logger.info(f"Iniciando sincronização de atendimentos para busca vetorial. Empresa: {company_id}")
    
    # 1. Obter todos os atendimentos da empresa
    stmt_atendimentos = select(models.Atendimento).where(models.Atendimento.company_id == company_id)
    res_atendimentos = await db.execute(stmt_atendimentos)
    atendimentos = res_atendimentos.scalars().all()
    
    if not atendimentos:
        logger.info(f"Nenhum atendimento encontrado para sincronização. Empresa: {company_id}")
        return

    # 2. Obter todos os message_ids já indexados para a empresa
    stmt_existing = select(models.AtendimentoMessageSearch.message_id).where(
        models.AtendimentoMessageSearch.company_id == company_id
    )
    res_existing = await db.execute(stmt_existing)
    existing_msg_ids = set(res_existing.scalars().all())

    new_messages_to_index = []
    
    # 3. Iterar nos atendimentos e extrair mensagens não indexadas
    for atend in atendimentos:
        try:
            conversa_list = json.loads(atend.conversa or "[]")
        except Exception as e:
            logger.warning(f"Erro ao decodificar conversa do atendimento {atend.id}: {e}")
            continue
            
        atendimento_info = {
            "whatsapp": atend.whatsapp,
            "nome_contato": atend.nome_contato,
            "status": atend.status,
            "resumo": atend.resumo,
            "tags": [t.get("name") for t in atend.tags] if atend.tags else [],
            "created_at": atend.created_at.isoformat() if atend.created_at else None,
            "updated_at": atend.updated_at.isoformat() if atend.updated_at else None
        }

        for idx, msg in enumerate(conversa_list):
            msg_id = msg.get("id") or f"{atend.id}-{idx}"
            
            if msg_id in existing_msg_ids:
                continue

            content = msg.get("content") or msg.get("caption") or ""
            if not content.strip():
                continue

            # Parse message timestamp safely
            ts = msg.get("timestamp")
            msg_date = None
            if isinstance(ts, (int, float)):
                msg_date = datetime.fromtimestamp(ts, tz=timezone.utc)
            elif isinstance(ts, str):
                try:
                    msg_date = datetime.fromisoformat(ts)
                except ValueError:
                    try:
                        msg_date = datetime.fromtimestamp(float(ts), tz=timezone.utc)
                    except:
                        msg_date = datetime.now(timezone.utc)
            else:
                msg_date = datetime.now(timezone.utc)

            new_messages_to_index.append({
                "atendimento_id": atend.id,
                "message_id": msg_id,
                "role": msg.get("role") or "user",
                "content": content,
                "message_date": msg_date,
                "atendimento_info": atendimento_info
            })

    if not new_messages_to_index:
        logger.info(f"Todos os atendimentos já estão sincronizados para a empresa: {company_id}")
        return

    logger.info(f"Total de {len(new_messages_to_index)} novas mensagens para gerar embedding e indexar.")

    # 4. Gerar embeddings em lotes para performance
    contents = [m["content"] for m in new_messages_to_index]
    embeddings = await gemini_service.generate_embeddings_batch(contents)

    # 5. Salvar no banco de dados
    for idx, msg_data in enumerate(new_messages_to_index):
        emb = embeddings[idx] if idx < len(embeddings) else None
        if not emb:
            continue
            
        db_search = models.AtendimentoMessageSearch(
            company_id=company_id,
            atendimento_id=msg_data["atendimento_id"],
            message_id=msg_data["message_id"],
            role=msg_data["role"],
            content=msg_data["content"],
            message_date=msg_data["message_date"],
            atendimento_info=msg_data["atendimento_info"],
            embedding=emb
        )
        db.add(db_search)

    await db.commit()
    logger.info(f"Sincronização concluída com sucesso. {len(new_messages_to_index)} mensagens indexadas.")
