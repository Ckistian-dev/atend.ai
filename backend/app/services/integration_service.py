# app/services/integration_service.py

import logging
import json
import hashlib
import hmac
import urllib.parse
import socket
import ipaddress
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional, Tuple

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, or_

from app.db import models
from app.services.gemini_service import get_gemini_service

logger = logging.getLogger(__name__)

# --- POLÍTICA DE SEGURANÇA CONTRA SSRF ---
BLOCKED_IP_NETWORKS = [
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("169.254.169.254/32"), # Metadata AWS/GCP
    ipaddress.ip_network("0.0.0.0/32"),
]

def validate_url_security(url: str) -> bool:
    """
    Valida se a URL é pública e segura, bloqueando SSRF (loopback, IPs privados, metadata).
    """
    if not url:
        raise ValueError("URL não pode estar vazia.")
        
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("Apenas protocolos HTTP e HTTPS são permitidos.")
        
    hostname = parsed.hostname
    if not hostname:
        raise ValueError("URL inválida ou sem hostname.")

    if hostname.lower() in ("localhost", "127.0.0.1", "::1", "0.0.0.0"):
        raise ValueError("Acesso a endereços locais não é permitido.")

    try:
        # Resolve o hostname para verificar o IP real
        ip_str = socket.gethostbyname(hostname)
        ip_obj = ipaddress.ip_address(ip_str)

        if ip_obj.is_loopback or ip_obj.is_private or ip_obj.is_link_local:
            raise ValueError(f"O endereço IP destina-se a uma rede privada ou reservada: {ip_str}")

        for network in BLOCKED_IP_NETWORKS:
            if ip_obj in network:
                raise ValueError(f"Acesso ao IP {ip_str} bloqueado por segurança.")
                
    except socket.gaierror:
        # Não foi possível resolver DNS, deixa a biblioteca HTTP tratar a falha de conexão se necessário
        pass

    return True

def verify_webhook_token_secure(provided_token: str, expected_token: str) -> bool:
    """
    Compara tokens de webhook em tempo constante para prevenir ataques de temporização (Timing Attacks).
    """
    if not provided_token or not expected_token:
        return False
    return hmac.compare_digest(provided_token.strip().encode('utf-8'), expected_token.strip().encode('utf-8'))

# --- ENGINE GENÉRICA DE INTEGRAÇÕES ---

class BaseIntegrationHandler:
    """Interface base para manipuladores de integração."""
    
    @staticmethod
    def extract_items(payload_json: Any, items_path: str = "") -> List[Dict[str, Any]]:
        """Extrai uma lista de dicionários a partir do payload JSON e do caminho indicado."""
        if payload_json is None:
            return []
            
        target = payload_json
        
        # Se um caminho como "data.products" foi definido
        if items_path and items_path.strip():
            parts = items_path.strip().split(".")
            for part in parts:
                if isinstance(target, dict) and part in target:
                    target = target[part]
                elif isinstance(target, list) and part.isdigit():
                    idx = int(part)
                    if 0 <= idx < len(target):
                        target = target[idx]
                    else:
                        return []
                else:
                    return []

        if isinstance(target, list):
            # Garante que os itens são dicionários
            return [item if isinstance(item, dict) else {"value": item} for item in target]
        elif isinstance(target, dict):
            # Se for um dicionário único, trata como uma lista de 1 elemento
            return [target]
        return []

def get_field_values_from_json(obj: Any, field_path: str) -> List[Tuple[str, Any]]:
    """
    Busca valores de um campo ou caminho (ex: "nome_razao", "cliente.nome_razao", "itens.descricao")
    em um objeto JSON arbitrariamente profundo.
    """
    if obj is None or not field_path:
        return []

    results = []
    parts = [p.strip() for p in field_path.split('.') if p.strip()]

    def search(curr: Any, path_idx: int, current_label: str):
        if curr is None:
            return

        if isinstance(curr, list):
            for elem in curr:
                search(elem, path_idx, current_label)
            return

        if isinstance(curr, dict):
            if path_idx < len(parts):
                target_key = parts[path_idx]
                if target_key in curr:
                    next_label = f"{current_label}.{target_key}" if current_label else target_key
                    search(curr[target_key], path_idx + 1, next_label)
            else:
                for k, v in curr.items():
                    if isinstance(v, (str, int, float, bool)):
                        results.append((f"{current_label}.{k}" if current_label else k, v))
        elif path_idx >= len(parts):
            if isinstance(curr, (str, int, float, bool)):
                results.append((current_label, curr))

    search(obj, 0, "")

    if not results and len(parts) == 1:
        single_key = parts[0]
        def find_anywhere(c: Any, key: str, label_prefix: str = ""):
            if isinstance(c, dict):
                for k, v in c.items():
                    curr_lbl = f"{label_prefix}.{k}" if label_prefix else k
                    if k == key:
                        if isinstance(v, (str, int, float, bool)):
                            results.append((curr_lbl, v))
                        elif isinstance(v, list):
                            for sub in v:
                                find_anywhere(sub, key, curr_lbl)
                        elif isinstance(v, dict):
                            results.append((curr_lbl, json.dumps(v, ensure_ascii=False)))
                    else:
                        find_anywhere(v, key, curr_lbl)
            elif isinstance(c, list):
                for elem in c:
                    find_anywhere(elem, key, label_prefix)

        find_anywhere(obj, single_key, "")

    return results


class BaseIntegrationHandler:
    """Handler padrão para integrações genéricas."""
    
    @staticmethod
    def extract_items(payload_json: Any, items_path: str = "") -> List[Dict[str, Any]]:
        """Extrai uma lista de dicionários a partir do payload JSON e do caminho indicado."""
        if payload_json is None:
            return []
            
        target = payload_json
        
        # Se um caminho como "data.products" foi definido
        if items_path and items_path.strip():
            parts = items_path.strip().split(".")
            for part in parts:
                if isinstance(target, dict) and part in target:
                    target = target[part]
                elif isinstance(target, list) and part.isdigit():
                    idx = int(part)
                    if 0 <= idx < len(target):
                        target = target[idx]
                    else:
                        return []
                else:
                    return []

        if isinstance(target, list):
            return [item if isinstance(item, dict) else {"value": item} for item in target]
        elif isinstance(target, dict):
            # Se no dict houver listas internas como "pedidos", retorna a lista interna
            for k in ["pedidos", "items", "data", "products", "orders", "results"]:
                if k in target and isinstance(target[k], list):
                    return target[k]
            return [target]
        return []

    @staticmethod
    def format_item(item: Dict[str, Any], title_field: Optional[str] = None, content_field: Optional[str] = None) -> Tuple[str, str, Dict[str, Any]]:
        """
        Formata o item para indexação RAG, filtrando e mantendo apenas os campos do JSON selecionados.
        Retorna (item_id, text_content, filtered_raw_data).
        """
        raw_id = None
        if title_field and title_field in item:
            raw_id = str(item[title_field])
        elif "id" in item:
            raw_id = str(item["id"])
        elif "_id" in item:
            raw_id = str(item["_id"])
        elif "uuid" in item:
            raw_id = str(item["uuid"])

        selected_fields = []
        if content_field:
            selected_fields = [f.strip() for f in content_field.split(",") if f.strip()]

        content_parts = []
        filtered_item = {}

        if selected_fields:
            for field in selected_fields:
                extracted = get_field_values_from_json(item, field)
                if extracted:
                    for label, val in extracted:
                        val_str = str(val).strip() if val is not None else ""
                        if val_str:
                            filtered_item[label] = val
                            content_parts.append(f"{label}: {val_str}")
                elif field in item:
                    val = item[field]
                    filtered_item[field] = val
                    val_str = str(val).strip() if val is not None else ""
                    if val_str:
                        content_parts.append(f"{field}: {val_str}")
        elif content_field and content_field in item:
            val = item[content_field]
            filtered_item[content_field] = val
            content_parts.append(f"Conteúdo: {val}")
        else:
            filtered_item = dict(item)
            for k, v in item.items():
                if k != title_field and isinstance(v, (str, int, float, bool)):
                    v_str = str(v).strip()
                    if v_str:
                        content_parts.append(f"{k}: {v_str}")

        text_content = " | ".join(content_parts) if content_parts else json.dumps(filtered_item, ensure_ascii=False)

        if not raw_id:
            raw_id = hashlib.md5(text_content.encode('utf-8')).hexdigest()[:12]

        return raw_id, text_content, filtered_item if filtered_item else item

    @staticmethod
    def compute_checksum(item: Dict[str, Any]) -> str:
        """Gera hash MD5 determinístico dos dados do item."""
        serialized = json.dumps(item, sort_keys=True, ensure_ascii=False)
        return hashlib.md5(serialized.encode('utf-8')).hexdigest()

class IntegrationRegistry:
    """Registro estensível de handlers de integrações."""
    _handlers: Dict[str, type] = {}

    @classmethod
    def register(cls, name: str, handler_cls: type):
        cls._handlers[name] = handler_cls

    @classmethod
    def get_handler(cls, name: str) -> type:
        return cls._handlers.get(name, BaseIntegrationHandler)

IntegrationRegistry.register("polling", BaseIntegrationHandler)
IntegrationRegistry.register("webhook", BaseIntegrationHandler)

class IntegrationService:

    @staticmethod
    async def execute_http_request(url: str, method: str, headers: Dict[str, Any], body: Any = None, params: Dict[str, Any] = None) -> Any:
        """
        Executa qualquer tipo de requisição HTTP (GET, POST) com Headers, Query Params e Body,
        aceitando payloads em JSON, Form ou texto puro.
        """
        if not url:
            raise ValueError("URL do endpoint não foi informada.")

        validate_url_security(url)

        cleaned_headers = {str(k): str(v) for k, v in headers.items()} if isinstance(headers, dict) else {}
        cleaned_headers.setdefault("User-Agent", "AtendAI-Integration-Worker/1.0")

        cleaned_params = {str(k): str(v) for k, v in params.items()} if isinstance(params, dict) else None

        http_method = (method or "GET").upper()

        kwargs: Dict[str, Any] = {}
        if cleaned_params:
            kwargs["params"] = cleaned_params

        if body is not None and http_method in ["POST", "PUT", "PATCH", "DELETE"]:
            if isinstance(body, (dict, list)):
                kwargs["json"] = body
            elif isinstance(body, str) and body.strip():
                try:
                    kwargs["json"] = json.loads(body)
                except Exception:
                    kwargs["content"] = body.encode("utf-8")
                    if "Content-Type" not in cleaned_headers:
                        cleaned_headers["Content-Type"] = "application/json"

        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            resp = await client.request(http_method, url, headers=cleaned_headers, **kwargs)

            if resp.status_code >= 400:
                raise ValueError(f"Endpoint respondeu com erro HTTP {resp.status_code}: {resp.text[:300]}")

            try:
                return resp.json()
            except Exception:
                raw_text = resp.text.strip()
                return {
                    "response_text": raw_text,
                    "items": [{"id": "1", "content": raw_text}]
                }

    @staticmethod
    async def test_endpoint(payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Executa uma requisição de teste para obter o payload real e inspecionar a estrutura JSON.
        """
        url = payload.get("url")
        method = payload.get("method") or "GET"
        headers = payload.get("headers") or {}
        params = payload.get("params") or {}
        body = payload.get("body")

        res_json = await IntegrationService.execute_http_request(url, method, headers, body, params)
        return {
            "status_code": 200,
            "data": res_json
        }

    @staticmethod
    async def run_integration_sync(db: AsyncSession, integration: models.Integration) -> int:
        """
        Executa a sincronização de uma integração por Polling (busca dados na URL) ou re-processamento.
        Atualiza o banco de dados vetorial de forma incremental.
        """
        if not integration.enabled:
            logger.info(f"Integração '{integration.name}' (ID: {integration.id}) está desativada. Ignorando...")
            return 0

        url = integration.url
        method = integration.method or "GET"
        headers = integration.headers or {}
        body = integration.body

        logger.info(f"Iniciando sincronização Polling para a integração '{integration.name}' (ID: {integration.id}) [{method} {url}]")

        try:
            res_json = await IntegrationService.execute_http_request(url, method, headers, body)
        except Exception as e:
            error_msg = str(e)
            integration.last_status = "error"
            integration.last_error = error_msg
            integration.last_sync_at = datetime.now(timezone.utc)
            db.add(integration)
            await db.commit()
            raise ValueError(error_msg)

        return await IntegrationService.process_payload_for_integration(db, integration, res_json)

    @staticmethod
    async def process_payload_for_integration(db: AsyncSession, integration: models.Integration, payload_json: Any) -> int:
        """
        Processa um payload JSON (seja de Polling ou Webhook) e realiza o upsert incremental no PGVector.
        """
        handler = IntegrationRegistry.get_handler(integration.integration_type)
        integration.last_payload = payload_json
        items = handler.extract_items(payload_json, integration.items_path or "")

        if not items:
            logger.info(f"Nenhum item encontrado no payload para a integração '{integration.name}' (ID: {integration.id}).")
            integration.last_status = "success"
            integration.last_error = None
            integration.last_sync_at = datetime.now(timezone.utc)
            db.add(integration)
            await db.commit()
            return 0

        existing_checksums: Dict[str, str] = integration.item_checksums or {}
        new_checksums: Dict[str, str] = {}

        items_to_embed = []
        origin_tag = f"integration_{integration.id}"

        for item in items:
            item_id, content_text, clean_raw = handler.format_item(item, integration.title_field, integration.content_field)
            checksum = handler.compute_checksum(clean_raw)
            new_checksums[item_id] = checksum

            # Verifica se o item mudou em relação ao salvo anteriormente
            if existing_checksums.get(item_id) != checksum:
                items_to_embed.append({
                    "item_id": item_id,
                    "content": content_text,
                    "raw_data": clean_raw,
                    "category": integration.category or "integração"
                })

        processed_count = 0

        # Se houver itens novos ou modificados, gera embeddings e atualiza no banco
        if items_to_embed:
            logger.info(f"Processando {len(items_to_embed)} itens novos/modificados para a integração '{integration.name}'...")
            gemini_service = get_gemini_service()
            
            texts_to_embed = [item["content"] for item in items_to_embed]
            embeddings = await gemini_service.generate_embeddings_batch(texts_to_embed)

            for item_data, embedding in zip(items_to_embed, embeddings):
                if embedding:
                    item_id = item_data["item_id"]
                    
                    # Remove versão anterior se existir
                    stmt_del = delete(models.KnowledgeVector).where(
                        models.KnowledgeVector.config_id == integration.config_id,
                        models.KnowledgeVector.origin == origin_tag,
                        models.KnowledgeVector.raw_data.op("->>")("integration_item_id") == item_id
                    )
                    await db.execute(stmt_del)

                    raw_data_saved = dict(item_data["raw_data"])
                    raw_data_saved["integration_item_id"] = item_id
                    raw_data_saved["integration_id"] = integration.id

                    kv = models.KnowledgeVector(
                        config_id=integration.config_id,
                        content=item_data["content"],
                        origin=origin_tag,
                        category=item_data["category"],
                        raw_data=raw_data_saved,
                        embedding=embedding
                    )
                    db.add(kv)
                    processed_count += 1

        # Limpa itens que foram removidos da origem (caso seja Polling completo)
        removed_ids = set(existing_checksums.keys()) - set(new_checksums.keys())
        if removed_ids and integration.integration_type == "polling":
            logger.info(f"Removendo {len(removed_ids)} itens obsoletos do banco vetorial para a integração '{integration.name}'...")
            for old_id in removed_ids:
                stmt_del = delete(models.KnowledgeVector).where(
                    models.KnowledgeVector.config_id == integration.config_id,
                    models.KnowledgeVector.origin == origin_tag,
                    models.KnowledgeVector.raw_data.op("->>")("integration_item_id") == old_id
                )
                await db.execute(stmt_del)

        # Atualiza metadata da integração
        integration.item_checksums = new_checksums
        integration.last_status = "success"
        integration.last_error = None
        integration.last_sync_at = datetime.now(timezone.utc)
        db.add(integration)

        await db.commit()
        logger.info(f"Sincronização concluída com sucesso para a integração '{integration.name}'. Itens atualizados/adicionados: {processed_count}")
        return processed_count
