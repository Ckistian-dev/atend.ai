import httpx
from app.core.config import settings
import logging
import json
from typing import Dict, Any, List, Optional
import base64
import os
import subprocess
import uuid
import tempfile
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text
from app.services.security import decrypt_token
from app.db import models # Importar models para type hinting
from collections import deque # Import deque
from datetime import datetime, timezone # Import datetime/timezone

logger = logging.getLogger(__name__)

class MessageSendError(Exception):
    """Exceção customizada para falhas no envio de mensagens."""
    pass

class WhatsAppService:
    def __init__(self):
        # --- Configurações Evolution API ---
        # Mantém nomes do exemplo anterior
        self.api_url = settings.EVOLUTION_API_URL
        self.api_key = settings.EVOLUTION_API_KEY
        self.headers = {"apikey": self.api_key, "Content-Type": "application/json"}

        # --- Configurações API Oficial (WBP) ---
        self.wbp_graph_url_base = "https://graph.facebook.com" # Base URL
        self.wbp_api_version = "v24.0" # Manter versão consistente

        # --- Conexão DB Evolution ---
        try:
            evo_db_url = settings.EVOLUTION_DATABASE_URL
            if evo_db_url and evo_db_url.startswith("postgresql://"):
                evo_db_url = evo_db_url.replace("postgresql://", "postgresql+asyncpg://", 1)

            if evo_db_url: # Apenas cria engine se a URL estiver definida
                self.evolution_db_engine = create_async_engine(
                    evo_db_url,
                    pool_size=5, max_overflow=10, pool_timeout=30 # pool_recycle removido para corresponder ao exemplo
                )
                # Mantém nome da factory do exemplo anterior
                self.AsyncSessionLocalEvolution = sessionmaker(
                    bind=self.evolution_db_engine, class_=AsyncSession, expire_on_commit=False
                )
                logger.info("✅ Conexão com o banco de dados da Evolution API configurada.")
            else:
                logger.warning("⚠️ EVOLUTION_DATABASE_URL não definida. Funcionalidades do DB Evolution desativadas.")
                self.evolution_db_engine = None
                self.AsyncSessionLocalEvolution = None # Garante que seja None

        except Exception as e:
            logger.error(f"🚨 ERRO CRÍTICO ao configurar DB Evolution: {e}", exc_info=True)
            self.evolution_db_engine = None
            self.AsyncSessionLocalEvolution = None

    async def close_db_connection(self):
        """Fecha pool de conexão do DB Evolution."""
        if self.evolution_db_engine:
            logger.info("Encerrando conexões DB Evolution...")
            await self.evolution_db_engine.dispose()
            logger.info("Conexões DB Evolution encerradas.")

    # --- Funções Evolution API ---

    def _normalize_number(self, number: str) -> str:
        """Limpa número (remove não dígitos) e remove o 9º dígito de números BR móveis (lógica do exemplo)."""
        clean_number = "".join(filter(str.isdigit, str(number)))
        if len(clean_number) == 13 and clean_number.startswith("55"):
            subscriber_part = clean_number[4:]
            if subscriber_part.startswith('9') and len(subscriber_part) == 9:
                normalized = clean_number[:4] + subscriber_part[1:]
                logger.debug(f"Normalizando número BR: {clean_number} -> {normalized}")
                return normalized
        return clean_number

    # --- GARANTIDO NOME CORRETO ---
    async def get_connection_status(self, instance_name: str) -> dict:
        """Verifica status da conexão Evolution."""
        if not instance_name:
            return {"status": "no_instance_name", "api_type": "evolution"} # Adiciona api_type consistentemente
        url = f"{self.api_url}/instance/connectionState/{instance_name}" # Usa self.api_url
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(url, headers={"apikey": self.api_key}) # Usa self.api_key
                response.raise_for_status()
                data = response.json()
                instance_info = data.get("instance", {})
                state = instance_info.get("state")
                return {
                    "status": "connected" if state == "open" else state or "disconnected",
                    "instance": instance_info,
                    "api_type": "evolution" # Adiciona api_type consistentemente
                }
        except httpx.HTTPStatusError as e:
            logger.warning(f"Evolution: Erro status {e.response.status_code} ao verificar {instance_name}.")
            # Lógica de erro do exemplo
            status_detail = {"status": "disconnected", "api_type": "evolution"}
            if e.response.status_code != 404:
                 status_detail = {"status": "api_error", "detail": e.response.text if e.response else str(e), "api_type": "evolution"}
            return status_detail
        except Exception as e:
            logger.error(f"Evolution: Erro inesperado ao verificar status {instance_name}: {e}", exc_info=True)
            # Lógica de erro do exemplo
            return {"status": "api_error", "detail": str(e), "api_type": "evolution"}
    # --- FIM DA GARANTIA ---

    async def _get_qrcode_and_instance_data(self, instance_name: str) -> Optional[Dict[str, Any]]:
        """Busca QR Code da Evolution, priorizando 'code'."""
        url = f"{self.api_url}/instance/connect/{instance_name}" # Usa self.api_url
        async with httpx.AsyncClient(timeout=90.0) as client:
            response = await client.get(url, headers={"apikey": self.api_key}) # Usa self.api_key
            response.raise_for_status()
            data = response.json()
            # Prioriza 'code'
            qr_code_string = data.get('code')
            if not qr_code_string:
                qr_code_string = data.get('base64') # Fallback para 'base64'
            if not qr_code_string:
                 qr_code_string = data.get('qrcode', {}).get('code') or data.get('qrcode', {}).get('base64')

            if not qr_code_string:
                logger.error(f"Evolution: API não retornou um QR Code válido ('code' ou 'base64') para '{instance_name}'. Resposta: {data}")
                raise Exception("API Evolution não retornou um QR Code válido.")

            instance_data = data.get("instance", {})
            instance_data['qrcode'] = qr_code_string
            logger.info(f"Evolution: QR Code obtido para '{instance_name}'. (Usando chave: {'code' if data.get('code') else 'base64 ou aninhado'})")
            return instance_data

    async def _create_instance(self, instance_name: str):
        """Cria instância na Evolution (lógica do exemplo)."""
        webhook_url = settings.WEBHOOK_URL
        webhook_config = {}
        if webhook_url:
            webhook_url_with_path = f"{webhook_url.rstrip('/')}/evolution/messages-upsert"
            webhook_config = {
                "webhook": {
                    "url": webhook_url_with_path,
                    "enabled": True,
                    "events": ["MESSAGES_UPSERT", "CONNECTION_UPDATE"]
                }
            }
        else:
             logger.warning("⚠️ WEBHOOK_URL não definida. Webhook da Evolution não será configurado.")

        payload = {
            "instanceName": instance_name,
            "integration": "WHATSAPP-BAILEYS",
            "syncFullHistory": True, # Do exemplo
            "qrcode": True,
            **webhook_config # Adiciona config do webhook se existir
        }
        url = f"{self.api_url}/instance/create" # Usa self.api_url
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(url, headers=self.headers, json=payload) # Usa self.headers
            response.raise_for_status()
            logger.info(f"Instância Evolution '{instance_name}' criada.")
            return response.json()

    async def create_and_connect_instance(self, instance_name: str) -> dict:
        """Conecta ou cria e conecta instância Evolution (lógica do exemplo)."""
        try:
            instance_data = await self._get_qrcode_and_instance_data(instance_name)
            return {"status": "qrcode", "instance": instance_data, "api_type": "evolution"}
        except httpx.HTTPStatusError as e:
            if e.response.status_code != 404:
                error_detail = e.response.text if hasattr(e.response, 'text') else str(e)
                logger.error(f"Erro ao conectar na instância '{instance_name}': {error_detail}")
                return {"status": "error", "detail": error_detail, "api_type": "evolution"}
            logger.info(f"Instância Evolution '{instance_name}' não encontrada (404). Tentando criar...")
        except Exception as e:
            error_detail = str(e)
            logger.error(f"Evolution: Erro ao buscar QR Code para '{instance_name}': {error_detail}", exc_info=True)
            return {"status": "error", "detail": error_detail, "api_type": "evolution"}

        try:
            creation_data = await self._create_instance(instance_name)
            # Busca QR code novamente após criar (lógica do exemplo)
            await asyncio.sleep(1) # Pequena pausa
            instance_data_with_qrcode = await self._get_qrcode_and_instance_data(instance_name)
            new_instance_id = creation_data.get("instance", {}).get("instanceId")
            if new_instance_id:
                instance_data_with_qrcode['instanceId'] = new_instance_id
            logger.info(f"Evolution: Instância '{instance_name}' criada e QR Code obtido.")
            return {"status": "qrcode", "instance": instance_data_with_qrcode, "api_type": "evolution"}
        except Exception as e:
            error_detail = e.response.text if hasattr(e, 'response') else str(e)
            logger.error(f"Erro ao criar a instância '{instance_name}': {error_detail}", exc_info=True)
            return {"status": "error", "detail": error_detail, "api_type": "evolution"}

    async def disconnect_instance(self, instance_name: str) -> dict:
        """Desconecta e remove instância Evolution (lógica do exemplo)."""
        url_delete = f"{self.api_url}/instance/delete/{instance_name}" # Usa self.api_url
        try:
            async with httpx.AsyncClient() as client:
                delete_resp = await client.delete(url_delete, headers={"apikey": self.api_key}, timeout=30.0) # Usa self.api_key
                if delete_resp.status_code not in [200, 201, 404]:
                    delete_resp.raise_for_status()
                logger.info(f"Evolution: Instância '{instance_name}' desconectada/removida (status: {delete_resp.status_code}).")
                return {"status": "disconnected", "api_type": "evolution"}
        except Exception as e:
            error_detail = e.response.text if hasattr(e, 'response') and hasattr(e.response, 'text') else str(e)
            logger.error(f"Evolution: Erro ao desconectar/remover '{instance_name}': {error_detail}", exc_info=True)
            return {"status": "error", "detail": error_detail, "api_type": "evolution"}

    async def send_text_message_evolution(self, instance_name: str, number: str, text: str) -> Dict[str, Any]:
        """Envia mensagem de texto via Evolution API e retorna dados da msg."""
        if not all([instance_name, number, text]):
            raise ValueError("Evolution: Instance name, number, and text must be provided.")
        normalized_number = self._normalize_number(number)
        jid = f"{normalized_number}@s.whatsapp.net"
        url = f"{self.api_url}/message/sendText/{instance_name}" # Usa self.api_url
        # Payload com 'text' no nível principal (corrigido anteriormente)
        payload = {
            "number": jid,
            "text": text,
            "options": { "delay": 1200, "presence": "composing", "linkPreview": False }
        }
        try:
            payload_json_for_log = json.dumps(payload)
            logger.debug(f"Evolution Send Payload to {jid}: {payload_json_for_log}")
        except Exception:
            payload_json_for_log = "{Serialization Error}"
            logger.error("Evolution: Erro ao serializar payload para log.")

        max_retries = 3
        last_exception = None
        for attempt in range(max_retries):
            try:
                async with httpx.AsyncClient() as client:
                    response = await client.post(url, headers=self.headers, json=payload, timeout=30.0) # Usa self.headers
                    if response.status_code == 400:
                        logger.error(f"Evolution: Erro 400 Bad Request ao enviar para {jid}. Payload: {payload_json_for_log}. Resposta API: {response.text}")
                    response.raise_for_status()
                    response_data = response.json()
                    logger.info(f"Evolution: Mensagem enviada para {jid} (Tentativa {attempt + 1}).")
                    msg_id = response_data.get("key", {}).get("id")
                    timestamp_raw = response_data.get("messageTimestamp", datetime.now(timezone.utc).timestamp())
                    try:
                        timestamp = int(timestamp_raw)
                    except (ValueError, TypeError):
                        logger.warning(f"Evolution: Timestamp inválido recebido no envio: {timestamp_raw}. Usando fallback.")
                        timestamp = int(datetime.now(timezone.utc).timestamp())
                    return {"id": msg_id, "timestamp": timestamp}
            except (httpx.RequestError, httpx.HTTPStatusError) as e:
                last_exception = e
                error_detail = str(e)
                if isinstance(e, httpx.HTTPStatusError) and e.response:
                    error_detail = f"{e} - Response: {e.response.text}"
                logger.warning(f"Evolution: Falha envio {jid} (Tentativa {attempt + 1}/{max_retries}). Erro: {error_detail}")
                if attempt < max_retries - 1:
                    wait_time = 5 * (attempt + 2)
                    await asyncio.sleep(wait_time)
                    continue
                else:
                    logger.error(f"Evolution: Falha CRÍTICA envio {jid} após {max_retries} tentativas.")
                    raise MessageSendError(f"Evolution: Falha envio após {max_retries} tentativas: {last_exception}") from last_exception
            except Exception as e:
                last_exception = e
                logger.error(f"Evolution: Erro inesperado envio {jid}: {e}", exc_info=True)
                raise MessageSendError(f"Evolution: Erro inesperado envio: {e}") from e
        raise MessageSendError(f"Evolution: Falha no envio para {jid} após {max_retries} tentativas. Último erro: {last_exception}")

    def _run_ffmpeg_sync(self, ogg_path: str, mp3_path: str):
        """Função síncrona para executar o ffmpeg."""
        command = ["ffmpeg", "-y", "-i", ogg_path, "-vn", "-acodec", "libmp3lame", "-q:a", "5", mp3_path]
        try:
            result = subprocess.run(command, capture_output=True, check=True, text=True, encoding='utf-8')
            if result.stdout and result.stdout.strip():
                 logger.info(f"Evolution: FFmpeg stdout:\n{result.stdout.strip()}")
            if result.stderr and result.stderr.strip():
                 common_info = ["ffmpeg version", "configuration:", "libavutil", "libavcodec", "libavformat", "built with gcc", "size=", "time=", "bitrate=", "speed=", "video:", "audio:", "subtitle:", "global headers:", "muxing overhead:"]
                 is_real_error = not any(info in result.stderr for info in common_info)
                 if is_real_error:
                      logger.error(f"Evolution: FFmpeg stderr (ERRO):\n{result.stderr.strip()}")
                 else:
                       logger.warning(f"Evolution: FFmpeg stderr (INFO):\n{result.stderr.strip()}")
        except FileNotFoundError:
            logger.error("Evolution: Comando 'ffmpeg' não encontrado. Certifique-se de que está instalado e no PATH do sistema.")
            raise
        except subprocess.CalledProcessError as e:
            stderr_output = e.stderr.strip() if e.stderr else "N/A"
            logger.error(f"Evolution: Erro do FFmpeg (código {e.returncode}) durante conversão de áudio:\n{stderr_output}")
            raise
        except Exception as e:
             logger.error(f"Evolution: Erro inesperado rodando FFmpeg sync: {e}", exc_info=True)
             raise

    async def get_media_and_convert_evolution(self, instance_name: str, message: dict) -> Optional[dict]:
        """Busca mídia da Evolution e converte áudio para MP3 usando thread separada."""
        message_content = message.get("message", {})
        if not message_content: return None
        url = f"{self.api_url}/chat/getBase64FromMediaMessage/{instance_name}" # Usa self.api_url
        payload = {"message": message}
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(url, json=payload, headers=self.headers, timeout=60) # Usa self.headers
                response.raise_for_status()
                media_response = response.json()
            base64_data = media_response.get("base64")
            if not base64_data: raise ValueError("Evolution: API mídia não retornou 'base64'.")
            media_bytes = base64.b64decode(base64_data)
            mime_type = "application/octet-stream"
            if "imageMessage" in message_content:
                mime_type = message_content["imageMessage"].get("mimetype", "image/jpeg")
                return {"mime_type": mime_type, "data": media_bytes} # Ajuste para usar mime type original
            elif "documentMessage" in message_content:
                mime_type = message_content["documentMessage"].get("mimetype", "application/octet-stream")
                return {"mime_type": mime_type, "data": media_bytes}
            elif "videoMessage" in message_content:
                 mime_type = message_content["videoMessage"].get("mimetype", "video/mp4")
                 logger.info(f"Evolution: Mídia tipo '{mime_type}' obtida ({len(media_bytes)} bytes).")
                 return {"mime_type": mime_type, "data": media_bytes}
            elif "audioMessage" in message_content:
                try:
                    with tempfile.TemporaryDirectory() as temp_dir:
                        input_filename = f"{uuid.uuid4()}.oga" # Assumindo oga/opus
                        ogg_path = os.path.join(temp_dir, input_filename)
                        mp3_path = os.path.join(temp_dir, f"{uuid.uuid4()}.mp3")
                        with open(ogg_path, "wb") as f: f.write(media_bytes)
                        await asyncio.to_thread(self._run_ffmpeg_sync, ogg_path, mp3_path)
                        with open(mp3_path, "rb") as f: mp3_bytes = f.read()
                        if not mp3_bytes:
                             raise ValueError("Arquivo MP3 resultante está vazio após conversão.")
                        logger.info(f"Evolution: Áudio OGG/Opus convertido para MP3 ({len(mp3_bytes)} bytes).")
                        return {"mime_type": "audio/mpeg", "data": mp3_bytes}
                except (FileNotFoundError, subprocess.CalledProcessError, ValueError, Exception) as conv_e:
                    logger.error(f"Evolution: Falha na conversão de áudio: {conv_e}", exc_info=(not isinstance(conv_e, FileNotFoundError)))
                    return None
            logger.info(f"Evolution: Tipo de mídia não tratado: {list(message_content.keys())}. Retornando dados brutos.")
            return {"mime_type": mime_type, "data": media_bytes}
        except httpx.HTTPStatusError as e:
             error_body = e.response.text if e.response else "N/A"
             logger.error(f"Evolution: Erro HTTP {e.response.status_code} ao obter mídia: {error_body}", exc_info=False)
             return None
        except Exception as e:
            logger.error(f"Evolution: Falha geral ao obter/processar mídia: {e}", exc_info=True)
            return None

    async def fetch_chat_history_evolution(self, instance_id: str, number: str, count: int = 32) -> List[Dict[str, Any]]:
        """Busca histórico do banco de dados da Evolution (lógica do exemplo anterior)."""
        if not self.evolution_db_engine or not self.AsyncSessionLocalEvolution:
            logger.error("Evolution DB não configurado ou falha na inicialização.")
            return []
        if not instance_id or not number: return []
        normalized_number = self._normalize_number(number) # Aplica normalização que remove 9
        jid_principal = f"{normalized_number}@s.whatsapp.net"
        # Lógica de JID alternativo (com 9) da versão anterior mantida para robustez
        jid_alternativo = None
        if len(normalized_number) == 12 and normalized_number.startswith("55") and normalized_number[4] != '9':
             jid_alternativo = f"{normalized_number[:4]}9{normalized_number[4:]}@s.whatsapp.net"

        params = {"instance_id": instance_id, "jid1": jid_principal, "limit": count}
        # Query que busca por JID principal ou alternativo (se existir)
        where_clause = """("instanceId" = :instance_id AND key->>'remoteJid' = :jid1)"""
        if jid_alternativo:
            where_clause = """("instanceId" = :instance_id AND (key->>'remoteJid' = :jid1 OR key->>'remoteJid' = :jid2))"""
            params["jid2"] = jid_alternativo

        query = text(f"""
            SELECT key, message, "messageTimestamp"
            FROM "Message"
            WHERE {where_clause}
            ORDER BY "messageTimestamp" DESC NULLS LAST
            LIMIT :limit
        """)
        try:
            async with self.AsyncSessionLocalEvolution() as session:
                logger.debug(f"Evolution DB: Buscando histórico para JID(s): {jid_principal}{' ou ' + jid_alternativo if jid_alternativo else ''}...")
                result = await session.execute(query, params)
                rows = result.fetchall()
                processed_messages = []
                for row in rows:
                    key_json, message_content, timestamp_db = row
                    timestamp_int = 0
                    if timestamp_db is not None:
                        try:
                            if isinstance(timestamp_db, (int, float)):
                                timestamp_int = int(timestamp_db)
                            elif isinstance(timestamp_db, str) and timestamp_db.isdigit():
                                timestamp_int = int(timestamp_db)
                            elif isinstance(timestamp_db, datetime):
                                timestamp_int = int(timestamp_db.replace(tzinfo=timezone.utc).timestamp())
                        except (ValueError, TypeError) as ts_err:
                            logger.warning(f"Evolution DB: Erro ao converter timestamp '{timestamp_db}' para int: {ts_err}")
                    if isinstance(message_content, dict) and "ephemeralMessage" in message_content:
                        actual_message = message_content.get("ephemeralMessage", {}).get("message")
                        if actual_message: message_content = actual_message
                    processed_messages.append({
                        "key": key_json,
                        "message": message_content,
                        "messageTimestamp": timestamp_int
                    })
                logger.debug(f"Evolution DB: Histórico carregado ({len(processed_messages)} msgs).")
                return processed_messages
        except Exception as e:
            logger.error(f"Evolution DB: Erro ao buscar histórico para {number}: {e}", exc_info=True)
            return []

    # --- Funções API Oficial (WBP) ---
    # (O código da API Oficial permanece o mesmo)

    async def get_media_url_official(self, media_id: str, access_token: str) -> Optional[str]:
        """Etapa B (Oficial): Pega a URL de download a partir do Media ID."""
        if not media_id or not access_token:
            logger.error("WBP: Media ID ou Access Token faltando para get_media_url.")
            return None
        url = f"{self.wbp_graph_url_base}/{self.wbp_api_version}/{media_id}"
        headers = {"Authorization": f"Bearer {access_token}"}
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                media_info = response.json()
                media_url = media_info.get('url')
                if not media_url:
                    logger.error(f"WBP: API não retornou 'url' para media ID {media_id}. Resposta: {media_info}")
                    return None
                return media_url
        except httpx.HTTPStatusError as e:
            error_body = e.response.text if e.response else "N/A"
            logger.error(f"WBP: Erro HTTP {e.response.status_code} ao obter URL da mídia {media_id}: {error_body}")
            return None
        except Exception as e:
            logger.error(f"WBP: Erro ao obter URL da mídia {media_id}: {e}", exc_info=True)
            return None

    async def download_media_official(self, media_url: str, access_token: str) -> Optional[bytes]:
        """Etapa C (Oficial): Baixa o arquivo binário a partir da URL."""
        if not media_url or not access_token:
            logger.error("WBP: Media URL ou Access Token faltando para download_media.")
            return None
        headers = {"Authorization": f"Bearer {access_token}"}
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.get(media_url, headers=headers, follow_redirects=True)
                response.raise_for_status()
                logger.info(f"WBP: Mídia baixada ({len(response.content)} bytes).")
                return response.content
        except httpx.HTTPStatusError as e:
            error_body = e.response.text if e.response else "N/A"
            logger.error(f"WBP: Erro HTTP {e.response.status_code} ao baixar mídia: {error_body}")
            return None
        except Exception as e:
            logger.error(f"WBP: Erro ao baixar mídia: {e}", exc_info=True)
            return None

    async def send_text_message_official(self, phone_number_id: str, access_token: str, to_number: str, text: str) -> Dict[str, Any]:
        """Envia mensagem de texto via API Oficial (WBP) e retorna o ID."""
        if not all([phone_number_id, access_token, to_number, text]):
            raise ValueError("WBP: phone_number_id, access_token, to_number, and text must be provided.")
        url = f"{self.wbp_graph_url_base}/{self.wbp_api_version}/{phone_number_id}/messages"
        headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
        # Usa _normalize_number da classe, que *não* remove o 9
        clean_to_number = self._normalize_number(to_number)
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": clean_to_number,
            "type": "text",
            "text": {"preview_url": False, "body": text}
        }
        logger.debug(f"WBP Send Payload to {clean_to_number}: {json.dumps(payload)}")

        max_retries = 3
        last_exception = None
        for attempt in range(max_retries):
            try:
                async with httpx.AsyncClient() as client:
                    response = await client.post(url, headers=headers, json=payload, timeout=30.0)
                    if response.status_code == 400:
                         logger.error(f"WBP: Erro 400 Bad Request ao enviar para {clean_to_number}. Payload: {json.dumps(payload)}. Resposta API: {response.text}")
                    response.raise_for_status()
                    response_data = response.json()
                    message_id = response_data.get("messages", [{}])[0].get("id")
                    logger.info(f"WBP: Mensagem enviada para {clean_to_number} (ID: {message_id}, Tentativa {attempt + 1}).")
                    return {"id": message_id}
            except (httpx.RequestError, httpx.HTTPStatusError) as e:
                last_exception = e
                error_detail = "Erro de conexão/requisição"
                status_code = None
                if isinstance(e, httpx.HTTPStatusError):
                    status_code = e.response.status_code
                    error_detail = e.response.text if e.response else str(e)
                    if status_code == 401 or status_code == 403:
                        logger.error(f"WBP: Erro de Autenticação ({status_code}) ao enviar para {clean_to_number}. Token inválido ou expirado? Detalhe: {error_detail}")
                        raise MessageSendError(f"WBP: Erro de Autenticação ({status_code}) ao enviar: {error_detail}") from e
                logger.warning(f"WBP: Falha envio {clean_to_number} (Tentativa {attempt + 1}/{max_retries}). Status: {status_code}. Erro: {error_detail}")
                if attempt < max_retries - 1:
                    wait_time = 5 * (attempt + 2)
                    await asyncio.sleep(wait_time)
                    continue
                else:
                    logger.error(f"WBP: Falha CRÍTICA envio {clean_to_number} após {max_retries} tentativas.")
                    raise MessageSendError(f"WBP: Falha envio após {max_retries} tentativas: {last_exception}") from last_exception
            except Exception as e:
                last_exception = e
                logger.error(f"WBP: Erro inesperado envio {clean_to_number}: {e}", exc_info=True)
                raise MessageSendError(f"WBP: Erro inesperado envio: {e}") from e
        raise MessageSendError(f"WBP: Falha no envio para {clean_to_number} após {max_retries} tentativas. Último erro: {last_exception}")

    # --- Função Adaptadora de Envio ---
    async def send_text_message(self, user: models.User, number: str, text: str) -> Dict[str, Any]:
        """
        Função centralizada para enviar mensagem de texto.
        Verifica o user.api_type e chama a função de envio correspondente.
        Retorna um dict com {"id": ..., "timestamp": ...} (ou apenas "id" se timestamp não disponível)
        """
        if not user or not number or not text:
             raise ValueError("User, number, and text are required for sending messages.")

        try:
            if user.api_type == models.ApiType.evolution:
                if not user.instance_name:
                    raise ValueError(f"Usuário {user.id} configurado para Evolution, mas 'instance_name' não definido.")
                # Chama a função específica da Evolution
                return await self.send_text_message_evolution(user.instance_name, number, text)

            elif user.api_type == models.ApiType.official:
                if not user.wbp_phone_number_id or not user.wbp_access_token:
                    raise ValueError(f"Usuário {user.id} configurado para API Oficial, mas 'wbp_phone_number_id' ou 'wbp_access_token' não definidos/criptografados.")
                try:
                    decrypted_token = decrypt_token(user.wbp_access_token)
                except Exception as decrypt_err:
                    logger.error(f"Falha ao descriptografar WBP token para user {user.id}: {decrypt_err}")
                    raise ValueError(f"Não foi possível descriptografar o token de acesso para enviar mensagem (User {user.id}).") from decrypt_err
                # Chama a função específica da API Oficial
                return await self.send_text_message_official(user.wbp_phone_number_id, decrypted_token, number, text)

            else:
                raise ValueError(f"Tipo de API desconhecido ('{user.api_type}') para usuário {user.id}.")

        except MessageSendError as e:
             raise e # Repassa a exceção específica de envio
        except ValueError as e:
             logger.error(f"Erro de configuração ao tentar enviar mensagem para user {user.id}: {e}")
             raise MessageSendError(f"Erro de configuração: {e}") from e # Converte para MessageSendError
        except Exception as e:
             logger.error(f"Erro inesperado no adaptador send_text_message para user {user.id}: {e}", exc_info=True)
             raise MessageSendError(f"Erro inesperado no envio: {e}") from e # Converte para MessageSendError

# --- Singleton ---
_whatsapp_service_instance = None
def get_whatsapp_service():
    global _whatsapp_service_instance
    if _whatsapp_service_instance is None:
        _whatsapp_service_instance = WhatsAppService()
    return _whatsapp_service_instance

