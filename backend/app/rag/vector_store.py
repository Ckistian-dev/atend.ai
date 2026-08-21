import logging
from typing import List, Optional, Dict, Any
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from llama_index.core.schema import TextNode, NodeWithScore
from app.db import models
from app.db.database import SessionLocal

logger = logging.getLogger(__name__)

class TenantPGVectorStore:
    """
    Vector Store assíncrono Multi-Tenant integrado ao PostgreSQL / PGVector.
    Garante que NENHUMA consulta acesse dados fora do config_id / tenant_id especificado.
    """

    def __init__(self, config_id: int):
        """
        @param config_id: ID da configuração/persona (vinculada à empresa/tenant).
        """
        if not config_id:
            raise ValueError("config_id é obrigatório para garantir isolamento multi-tenant.")
        self.config_id = config_id

    async def query_vector(
        self,
        query_embedding: List[float],
        similarity_top_k: int = 5,
        category: Optional[str] = None,
        max_distance: float = 0.65
    ) -> List[NodeWithScore]:
        """
        Executa busca por similaridade vetorial com filtro estrito de tenant.

        @param query_embedding: Vetor de 768 dimensões gerado pelo modelo de embedding.
        @param similarity_top_k: Quantidade máxima de resultados a retornar.
        @param category: Categoria opcional para filtro (ex: 'Produtos', 'image', 'video').
        @param max_distance: Distância de cosseno máxima aceita (menor = mais similar).
        @returns: Lista de NodeWithScore do LlamaIndex.
        """
        if not query_embedding:
            return []

        async with SessionLocal() as db:
            query = select(models.KnowledgeVector).where(
                models.KnowledgeVector.config_id == self.config_id
            )

            if category and category.strip() and category.strip().lower() != "todas":
                query = query.where(models.KnowledgeVector.category.ilike(category.strip()))

            # Filtro de distância de cosseno do pgvector
            semantic_query = query.where(
                models.KnowledgeVector.embedding.cosine_distance(query_embedding) < max_distance
            ).order_by(
                models.KnowledgeVector.embedding.cosine_distance(query_embedding)
            ).limit(similarity_top_k)

            result = await db.execute(semantic_query)
            vectors = result.scalars().all()

            nodes_with_score = []
            for v in vectors:
                # Calcula score de similaridade (1 - distância de cosseno aproximada)
                # Monta metadados preservando raw_data e identificadores originais
                metadata = {
                    "id": v.id,
                    "config_id": v.config_id,
                    "category": v.category,
                    "origin": v.origin,
                }
                if v.raw_data and isinstance(v.raw_data, dict):
                    metadata.update(v.raw_data)

                node = TextNode(
                    text=v.content or "",
                    id_=f"node_kv_{v.id}",
                    metadata=metadata
                )
                nodes_with_score.append(NodeWithScore(node=node, score=1.0))

            logger.info(
                f"[TenantPGVectorStore] Busca vetorial (config_id={self.config_id}, cat='{category}'): "
                f"{len(nodes_with_score)} chunks recuperados."
            )
            return nodes_with_score

    async def query_text(
        self,
        keywords: List[str],
        top_k: int = 5,
        category: Optional[str] = None
    ) -> List[NodeWithScore]:
        """
        Executa busca lexical/textual por palavras-chave com filtro estrito de tenant.

        @param keywords: Lista de termos-chave para busca textual.
        @param top_k: Quantidade máxima de resultados.
        @param category: Categoria opcional.
        @returns: Lista de NodeWithScore do LlamaIndex.
        """
        if not keywords:
            return []

        async with SessionLocal() as db:
            query = select(models.KnowledgeVector).where(
                models.KnowledgeVector.config_id == self.config_id
            )

            if category and category.strip() and category.strip().lower() != "todas":
                query = query.where(models.KnowledgeVector.category.ilike(category.strip()))

            for kw in keywords:
                clean_kw = kw.strip()
                if clean_kw:
                    query = query.where(models.KnowledgeVector.content.ilike(f"%{clean_kw}%"))

            query = query.limit(top_k)
            result = await db.execute(query)
            vectors = result.scalars().all()

            nodes = []
            for v in vectors:
                metadata = {
                    "id": v.id,
                    "config_id": v.config_id,
                    "category": v.category,
                    "origin": v.origin,
                }
                if v.raw_data and isinstance(v.raw_data, dict):
                    metadata.update(v.raw_data)

                node = TextNode(
                    text=v.content or "",
                    id_=f"node_kv_{v.id}",
                    metadata=metadata
                )
                nodes.append(NodeWithScore(node=node, score=0.8))

            logger.info(
                f"[TenantPGVectorStore] Busca lexical (config_id={self.config_id}, keywords={keywords}): "
                f"{len(nodes)} chunks recuperados."
            )
            return nodes
