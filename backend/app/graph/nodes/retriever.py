import logging
from typing import Dict, Any

from app.graph.state import AgentState
from app.rag.hybrid_retriever import MultiTenantHybridRetriever

logger = logging.getLogger(__name__)

async def retriever_node(state: AgentState) -> Dict[str, Any]:
    """
    Nó 2: Recuperação de Conhecimento Multi-Tenant via LlamaIndex.
    Executa busca híbrida (BM25 + Similaridade Vetorial) estritamente isolada pelo config_id.

    @param state: Estado atual do grafo.
    @returns: Dicionário com 'retrieved_context' preenchido.
    """
    config_id = state.get("config_id")
    search_query = state.get("search_query") or state.get("user_input", "")
    target_category = state.get("target_category")

    if not config_id:
        logger.error("[Retriever Node] config_id ausente no estado!")
        return {"retrieved_context": "Base de conhecimento não configurada."}

    logger.info(
        f"[Retriever Node] Executando busca híbrida (config_id={config_id}, query='{search_query}', cat='{target_category}')"
    )

    try:
        retriever = MultiTenantHybridRetriever(config_id=config_id)
        nodes = await retriever.retrieve(
            query=search_query,
            category=target_category,
            top_k=7
        )

        context_str = retriever.format_context_for_prompt(nodes)
        
        audit_trail = dict(state.get("ai_audit_trail") or {})
        audit_trail["retrieval"] = {
            "search_query": search_query,
            "category": target_category,
            "nodes_retrieved_count": len(nodes),
            "context_preview": (context_str[:250] + "...") if len(context_str) > 250 else context_str
        }

        return {
            "retrieved_context": context_str,
            "ai_audit_trail": audit_trail
        }

    except Exception as e:
        logger.error(f"[Retriever Node] Erro ao recuperar contexto: {e}", exc_info=True)
        audit_trail = dict(state.get("ai_audit_trail") or {})
        audit_trail["retrieval"] = {
            "search_query": search_query,
            "category": target_category,
            "error": str(e)
        }
        return {
            "retrieved_context": "Erro temporário ao acessar a base de conhecimento.",
            "ai_audit_trail": audit_trail
        }

