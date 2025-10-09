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

logger = logging.getLogger(__name__)

class MessageSendError(Exception):
    """Exceção customizada para falhas no envio de mensagens."""
    pass

class WhatsAppService:
    def __init__(self):
        self.api_url = settings.EVOLUTION_API_URL
        self.api_key = settings.EVOLUTION_API_KEY
        self.headers = {"apikey": self.api_key, "Content-Type": "application/json"}
        
        # --- LÓGICA DE CONEXÃO COM BANCO DE DADOS DA EVOLUTION (DO PROSPECT AI) ---
        try:
            self.evolution_db_engine = create_async_engine(
                settings.EVOLUTION_DATABASE_URL,
                pool_size=5,
                max_overflow=10,
                pool_timeout=30
            )
            self.AsyncSessionLocal = sessionmaker(
                bind=self.evolution_db_engine, class_=AsyncSession, expire_on_commit=False
            )
            logger.info("✅ Conexão com o banco de dados da Evolution API configurada com sucesso.")
        except Exception as e:
            logger.error(f"🚨 ERRO CRÍTICO ao configurar a conexão com o banco da Evolution API: {e}")
            self.evolution_db_engine = None

    async def close_db_connection(self):
        """Fecha todas as conexões no pool do engine do banco de dados da Evolution."""
        if self.evolution_db_engine:
            logger.info("Encerrando conexões com o banco de dados da Evolution API...")
            await self.evolution_db_engine.dispose()
            logger.info("Conexões com o banco de dados da Evolution API encerradas.")

    def _normalize_number(self, number: str) -> str:
        clean_number = "".join(filter(str.isdigit, str(number)))
        if len(clean_number) == 13 and clean_number.startswith("55"):
            subscriber_part = clean_number[4:]
            if subscriber_part.startswith('9'):
                normalized = clean_number[:4] + subscriber_part[1:]
                return normalized
        return clean_number

    # --- MÉTODO ATUALIZADO (DO PROSPECT AI) ---
    async def get_connection_status(self, instance_name: str) -> dict:
        if not instance_name:
            return {"status": "no_instance_name"}
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.api_url}/instance/connectionState/{instance_name}",
                    headers={"apikey": self.api_key}
                )
                response.raise_for_status()
                data = response.json()
                
                instance_info = data.get("instance", {})
                state = instance_info.get("state")
                
                return {
                    "status": "connected" if state == "open" else state or "disconnected",
                    "instance": instance_info
                }
        except httpx.HTTPStatusError as e:
            return {"status": "disconnected"} if e.response.status_code == 404 else {"status": "api_error", "detail": e.response.text}
        except Exception as e:
            return {"status": "api_error", "detail": str(e)}

    # --- NOVO MÉTODO (DO PROSPECT AI) ---
    async def _get_qrcode_and_instance_data(self, instance_name: str) -> Optional[Dict[str, Any]]:
        async with httpx.AsyncClient(timeout=90.0) as client:
            response = await client.get(f"{self.api_url}/instance/connect/{instance_name}", headers={"apikey": self.api_key})
            response.raise_for_status()
            data = response.json()
            qr_code_string = data.get('code') or data.get('qrcode', {}).get('code')
            if not qr_code_string: raise Exception("API não retornou um QR Code válido.")
            
            instance_data = data.get("instance", {})
            instance_data['qrcode'] = qr_code_string
            
            return instance_data

    # --- MÉTODO ATUALIZADO (DO PROSPECT AI) ---
    async def _create_instance(self, instance_name: str):
        payload = {
            "instanceName": instance_name,
            "integration": "WHATSAPP-BAILEYS",
            "syncFullHistory": True,
            "qrcode": True,
            "webhook": {
                "url": settings.WEBHOOK_URL,
                "enabled": True,
                "events": [
                    "MESSAGES_UPSERT",
                    "CONNECTION_UPDATE"
                ]
            }
        }
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(f"{self.api_url}/instance/create", headers=self.headers, json=payload)
            response.raise_for_status()
            logger.info(f"Instância '{instance_name}' criada com sucesso.")
            return response.json()

    # --- MÉTODO ATUALIZADO (DO PROSPECT AI) ---
    async def create_and_connect_instance(self, instance_name: str) -> dict:
        try:
            instance_data = await self._get_qrcode_and_instance_data(instance_name)
            return {"status": "qrcode", "instance": instance_data}
        except httpx.HTTPStatusError as e:
            if e.response.status_code != 404:
                error_detail = e.response.text if hasattr(e.response, 'text') else str(e)
                logger.error(f"Erro ao conectar na instância '{instance_name}': {error_detail}")
                return {"status": "error", "detail": error_detail}

        try:
            creation_data = await self._create_instance(instance_name)
            new_instance_id = creation_data.get("instance", {}).get("instanceId")
            instance_data_with_qrcode = await self._get_qrcode_and_instance_data(instance_name)
            
            if new_instance_id:
                instance_data_with_qrcode['instanceId'] = new_instance_id
            
            return {"status": "qrcode", "instance": instance_data_with_qrcode}
        except Exception as e:
            error_detail = e.response.text if hasattr(e, 'response') else str(e)
            logger.error(f"Erro ao criar a instância '{instance_name}': {error_detail}")
            return {"status": "error", "detail": error_detail}

    async def disconnect_instance(self, instance_name: str) -> dict:
        try:
            async with httpx.AsyncClient() as client:
                response = await client.delete(f"{self.api_url}/instance/delete/{instance_name}", headers={"apikey": self.api_key})
                if response.status_code not in [200, 201, 404]: response.raise_for_status()
                return {"status": "disconnected"}
        except Exception as e:
            error_detail = e.response.text if hasattr(e, 'response') else str(e)
            return {"status": "error", "detail": error_detail}

    async def send_text_message(self, instance_name: str, number: str, text: str):
        if not all([instance_name, number, text]):
            raise ValueError("Instance name, number, and text must be provided.")
        
        normalized_number = self._normalize_number(number)
        url = f"{self.api_url}/message/sendText/{instance_name}"
        
        payload = {
            "number": normalized_number,
            "options": { "delay": 1200, "presence": "composing" },
            "text": text
        }
        
        max_retries = 3
        for attempt in range(max_retries):
            try:
                async with httpx.AsyncClient() as client:
                    response = await client.post(url, headers=self.headers, json=payload, timeout=30.0)
                    response.raise_for_status()
                    logger.info(f"DEBUG: Mensagem enviada com sucesso para {normalized_number} na tentativa {attempt + 1}.")
                    return
            except (httpx.RequestError, httpx.HTTPStatusError) as e:
                logger.warning(f"Falha ao enviar para {normalized_number} (tentativa {attempt + 1}/{max_retries}). Erro: {e}")
                if attempt < max_retries - 1:
                    wait_time = 5 * (attempt + 2)
                    logger.info(f"Aguardando {wait_time} segundos para nova tentativa...")
                    await asyncio.sleep(wait_time)
                else:
                    logger.error(f"Falha CRÍTICA ao enviar mensagem para {normalized_number} após {max_retries} tentativas.")
                    raise MessageSendError(f"Falha no envio após {max_retries} tentativas: {e}") from e
            except Exception as e:
                error_message = f"Erro inesperado ao enviar mensagem para {normalized_number} na tentativa {attempt + 1}: {e}"
                logger.error(error_message, exc_info=True)
                raise MessageSendError(error_message) from e

    async def get_media_and_convert(self, instance_name: str, message: dict) -> Optional[dict]:
        message_content = message.get("message", {})
        if not message_content: return None
        url = f"{self.api_url}/chat/getBase64FromMediaMessage/{instance_name}"
        payload = {"message": message}
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(url, json=payload, headers=self.headers, timeout=60)
                response.raise_for_status()
                media_response = response.json()
            
            base64_data = media_response.get("base64")
            if not base64_data: raise ValueError("API de mídia não retornou 'base64'.")
            media_bytes = base64.b64decode(base64_data)

            if "imageMessage" in message_content:
                return {"mime_type": "image/jpeg", "data": media_bytes}
            if "documentMessage" in message_content:
                mime_type = message_content["documentMessage"].get("mimetype", "application/octet-stream")
                return {"mime_type": mime_type, "data": media_bytes}
            if "audioMessage" in message_content:
                with tempfile.TemporaryDirectory() as temp_dir:
                    ogg_path = os.path.join(temp_dir, f"{uuid.uuid4()}.ogg")
                    mp3_path = os.path.join(temp_dir, f"{uuid.uuid4()}.mp3")
                    with open(ogg_path, "wb") as f: f.write(media_bytes)
                    command = ["ffmpeg", "-y", "-i", ogg_path, "-acodec", "libmp3lame", mp3_path]
                    subprocess.run(command, check=True, capture_output=True, text=True)
                    with open(mp3_path, "rb") as f: mp3_bytes = f.read()
                    return {"mime_type": "audio/mp3", "data": mp3_bytes}
        except subprocess.CalledProcessError as e:
            logger.error(f"Erro do FFmpeg (verifique se está instalado e no PATH): {e.stderr}")
        except Exception as e:
            logger.error(f"Falha ao processar mídia da mensagem: {e}")
        return None

    # --- LÓGICA DE BUSCA DE HISTÓRICO ATUALIZADA (DO PROSPECT AI) ---
    async def fetch_chat_history(self, instance_id: str, number: str, count: int = 32) -> List[Dict[str, Any]]:
        if not self.evolution_db_engine:
            logger.error("A conexão com o banco de dados da Evolution não foi configurada. Não é possível buscar o histórico.")
            return []
            
        if not instance_id or not number:
            return []
            
        normalized_number = self._normalize_number(number)
        jid = f"{normalized_number}@s.whatsapp.net"
        
        query = text(f"""
            SELECT key, message, "messageTimestamp"
            FROM "Message"
            WHERE 
                "instanceId" = :instance_id AND 
                (key->>'remoteJid' = :jid OR key->>'remoteJidAlt' = :jid)
            ORDER BY "messageTimestamp" DESC
            LIMIT :limit
        """)
        
        try:
            async with self.AsyncSessionLocal() as session:
                result = await session.execute(query, {"instance_id": instance_id, "jid": jid, "limit": count})
                rows = result.fetchall()
                
                messages = [{"key": row[0], "message": row[1], "messageTimestamp": row[2]} for row in rows]
                
                logger.info(f"Histórico para {jid} carregado do banco. Total de {len(messages)} mensagens encontradas.")
                return messages
        except Exception as e:
            logger.error(f"Não foi possível buscar o histórico do banco de dados para {number}. Erro: {e}", exc_info=True)
            return []

_whatsapp_service_instance = None
def get_whatsapp_service():
    global _whatsapp_service_instance
    if _whatsapp_service_instance is None:
        _whatsapp_service_instance = WhatsAppService()
    return _whatsapp_service_instance

