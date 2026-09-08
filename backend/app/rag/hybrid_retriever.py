import re
import logging
from typing import List, Optional, Dict, Any

from llama_index.core.schema import NodeWithScore
from app.rag.vector_store import TenantPGVectorStore
from app.services.gemini_service import get_gemini_service

logger = logging.getLogger(__name__)

class MultiTenantHybridRetriever:
    """
    Retriever Híbrido Multi-Tenant (LlamaIndex + PGVector + BM25/Keyword).
    Combina busca vetorial semântica e busca por palavras-chave com isolamento estrito por config_id/tenant_id.
    """

    def __init__(self, config_id: int):
        """
        @param config_id: Identificador da persona/configuração do tenant.
        """
        self.config_id = config_id
        self.vector_store = TenantPGVectorStore(config_id=config_id)
        self.gemini_service = get_gemini_service()

    def _extract_keywords(self, query: str) -> List[str]:
        """
        Extrai palavras-chave substantivas removendo stop words comuns.
        """
        stop_words = {
            "qual", "quais", "quanto", "custa", "valor", "preco", "preço", "tem", "voces", "vocês",
            "para", "com", "sem", "onde", "como", "quero", "saber", "gostaria", "ola", "olá", "bom",
            "dia", "tarde", "noite", "por", "favor", "que", "uma", "uns", "umas", "sobre", "mais"
        }
        tokens = re.findall(r'\b\w{2,}\b', query.lower())
        keywords = [t for t in tokens if t not in stop_words]
        return keywords[:5] if keywords else tokens[:3]

    async def retrieve(
        self,
        query: str,
        category: Optional[str] = None,
        top_k: int = 5
    ) -> List[NodeWithScore]:
        """
        Executa busca híbrida (vetorial + lexical) e funde os resultados sem duplicações.

        @param query: Texto da consulta do usuário.
        @param category: Categoria opcional para filtro estrito.
        @param top_k: Quantidade de chunks finais desejados.
        @returns: Lista de nós ranqueados pelo score consolidado.
        """
        if not query or not query.strip():
            return []

        clean_query = query.strip()
        nodes_dict: Dict[str, NodeWithScore] = {}

        # 1. Busca Semântica (Embedding)
        try:
            query_embedding = await self.gemini_service.generate_embedding(clean_query)
            if query_embedding:
                vector_nodes = await self.vector_store.query_vector(
                    query_embedding=query_embedding,
                    similarity_top_k=top_k,
                    category=category
                )
                for rank, item in enumerate(vector_nodes):
                    node_id = item.node.node_id
                    # RRF (Reciprocal Rank Fusion) score
                    rrf_score = 1.0 / (60 + rank + 1)
                    nodes_dict[node_id] = NodeWithScore(node=item.node, score=rrf_score)
        except Exception as e:
            logger.error(f"[MultiTenantHybridRetriever] Falha na busca vetorial: {e}", exc_info=True)

        # 2. Busca Lexical (Keywords)
        try:
            keywords = self._extract_keywords(clean_query)
            if keywords:
                text_nodes = await self.vector_store.query_text(
                    keywords=keywords,
                    top_k=top_k,
                    category=category
                )
                for rank, item in enumerate(text_nodes):
                    node_id = item.node.node_id
                    rrf_score = 1.0 / (60 + rank + 1)
                    if node_id in nodes_dict:
                        # Combina os scores se encontrado em ambas as buscas
                        nodes_dict[node_id].score = (nodes_dict[node_id].score or 0) + rrf_score
                    else:
                        nodes_dict[node_id] = NodeWithScore(node=item.node, score=rrf_score)
        except Exception as e:
            logger.error(f"[MultiTenantHybridRetriever] Falha na busca lexical: {e}", exc_info=True)

        # 3. Fallback: Se não encontrou nada com filtro de categoria, tenta sem filtro de categoria
        if not nodes_dict and category and category.strip().lower() != "todas":
            logger.info(f"[MultiTenantHybridRetriever] Nenhum resultado para categoria '{category}'. Executando fallback sem categoria...")
            return await self.retrieve(query=clean_query, category=None, top_k=top_k)

        # Ordena pelo score consolidado decrescente
        sorted_nodes = sorted(nodes_dict.values(), key=lambda x: x.score or 0.0, reverse=True)
        return sorted_nodes[:top_k]

    def format_context_for_prompt(self, nodes: List[NodeWithScore]) -> str:
        """
        Formata os nós recuperados em uma string Markdown estruturada para injeção no prompt do LLM.

        @param nodes: Lista de NodeWithScore recuperados.
        @returns: Texto formatado com seções e metadados.
        """
        if not nodes:
            return "Nenhuma informação relevante encontrada na base de conhecimento para esta consulta."

        blocks = []
        for idx, item in enumerate(nodes, 1):
            meta = item.node.metadata or {}
            category = meta.get("category", "Geral")
            origin = meta.get("origin", "base")

            lines = [f"### [DOCUMENTO #{idx} | Categoria: {category} | Origem: {origin}]"]

            # Destaca com prioridade a estrutura de pastas e arquivo para mídias/Google Drive
            caminho = meta.get("caminho_completo") or (meta.get("Arquivo") if origin == "drive" else None)
            subpastas = meta.get("subpastas")
            nome_arq = meta.get("nome_exato") or (meta.get("nome") if origin == "drive" else None)
            
            # id_arquivo exclusivo para arquivos do Google Drive
            id_drive = meta.get("id_arquivo")
            if not id_drive and origin == "drive":
                id_drive = meta.get("ID") or meta.get("id")

            if caminho or subpastas or id_drive or (origin == "drive" and nome_arq):
                if caminho:
                    lines.append(f"- **Estrutura de Pastas / Caminho Completo**: `{caminho}`")
                if subpastas:
                    lines.append(f"- **Linha / Subpastas do Produto**: `{subpastas}`")
                if nome_arq:
                    lines.append(f"- **Nome do Arquivo**: `{nome_arq}`")
                if id_drive:
                    lines.append(f"- **id_arquivo do Google Drive (OBRIGATÓRIO usar este ID exato em [MEDIA: id] ou media_file_ids)**: `{id_drive}`")

            # Se houver outros dados estruturados (raw_data de planilhas/drive)
            # adiciona campo a campo com alta clareza
            ignored_keys = {
                "id", "config_id", "category", "origin", 
                "caminho_completo", "subpastas", "nome_exato", "id_arquivo"
            }
            if origin == "drive":
                ignored_keys.update({"Arquivo", "ID", "nome"})
            raw_fields = {k: v for k, v in meta.items() if k not in ignored_keys and v is not None}
            if raw_fields:
                for k, v in raw_fields.items():
                    val_str = str(v).strip()
                    if val_str:
                        lines.append(f"- **{k}**: {val_str}")
            
            # Adiciona o conteúdo textual do chunk se não for redundante
            if item.node.text and item.node.text.strip():
                lines.append(f"- **Conteúdo**: {item.node.text.strip()}")

            blocks.append("\n".join(lines))

        return "\n\n".join(blocks)

