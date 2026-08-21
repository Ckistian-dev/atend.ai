"""
Módulo de RAG (Retrieval-Augmented Generation) Multi-Tenant com LlamaIndex.
Garante isolamento absoluto por tenant (config_id/company_id) e busca híbrida.
"""

from app.rag.vector_store import TenantPGVectorStore
from app.rag.hybrid_retriever import MultiTenantHybridRetriever

__all__ = ["TenantPGVectorStore", "MultiTenantHybridRetriever"]
