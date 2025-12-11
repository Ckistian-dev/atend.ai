import httpx
import logging
import json
from typing import Dict, Any, Optional, List
import os
import uuid
import tempfile
import asyncio
from app.services.security import decrypt_token
from app.db import models
import subprocess
import mimetypes

logger = logging.getLogger(__name__)

class MessageSendError(Exception):
    """Exceção customizada para falhas no envio de mensagens."""
    pass

class WhatsAppService:
    
    def __init__(self):
        # --- Configurações API Oficial (WBP) ---
        self.wbp_graph_url_base = "https://graph.facebook.com" # Base URL
        self.wbp_api_version = "v24.0" # Manter versão consistente

    def _normalize_number(self, number: str) -> str:
        """Limpa número (remove não dígitos) e remove o 9º dígito de números BR móveis (lógica do exemplo)."""
        clean_number = "".join(filter(str.isdigit, str(number)))
        if len(clean_number) == 13 and clean_number.startswith("55"):
            subscriber_part = clean_number[4:]
            if subscriber_part.startswith('9') and len(subscriber_part) == 9:
                normalized = clean_number[:4] + subscriber_part[1:]
                logger.info(f"Normalizando número BR: {clean_number} -> {normalized}")
                return normalized
        return clean_number

    def _run_ffmpeg_sync(self, input_path: str, output_path: str):
        """
        Função síncrona para executar o ffmpeg.
        ALTERADO: Converte para MP3 para máxima compatibilidade, especialmente com iPhones.
        O áudio não será mais enviado como PTT (mensagem de voz), mas como um arquivo de áudio reproduzível.
        """
        command = [
            "ffmpeg",
            "-y",
            "-i", input_path,
            "-c:a", "libmp3lame", # Codec MP3
            "-q:a", "4",          # Qualidade de áudio (0=melhor, 9=pior)
            "-ar", "44100",       # Sample rate padrão
            output_path          # O output_path já terá a extensão .mp3
        ]
        
        try:
            result = subprocess.run(command, capture_output=True, check=True, text=True, encoding='utf-8')
            if result.stdout and result.stdout.strip():
                    logger.info(f"FFmpeg stdout:\n{result.stdout.strip()}")
            if result.stderr and result.stderr.strip():
                    common_info = ["ffmpeg version", "configuration:", "libavutil", "libavcodec", "libavformat", "built with gcc", "size=", "time=", "bitrate=", "speed=", "video:", "audio:", "subtitle:", "global headers:", "muxing overhead:"]
                    is_real_error = not any(info in result.stderr for info in common_info)
                    if is_real_error:
                        logger.error(f"FFmpeg stderr (ERRO):\n{result.stderr.strip()}")
                    else:
                        logger.warning(f"FFmpeg stderr (INFO): Convertendo...")
        except FileNotFoundError:
            logger.error("Comando 'ffmpeg' não encontrado.")
            raise
        except subprocess.CalledProcessError as e:
            stderr_output = e.stderr.strip() if e.stderr else "N/A"
            logger.error(f"Erro do FFmpeg (código {e.returncode}):\n{stderr_output}")
            raise
        except Exception as e:
                logger.error(f"Erro inesperado rodando FFmpeg sync: {e}", exc_info=True)
                raise

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

    async def _upload_media_official(
        self, 
        phone_number_id: str, 
        access_token: str, 
        file_bytes: bytes, 
        mimetype: str, 
        filename: str,
        media_type: str
    ) -> Optional[str]:
        """Etapa 1 (Oficial): Faz upload da mídia, convertendo áudio para OGG OPUS."""
        
        # --- INÍCIO DA LÓGICA DE CONVERSÃO (ALTERADO) ---
        final_file_bytes = file_bytes
        final_mimetype = mimetype
        final_filename = filename

        # --- LÓGICA DE CONVERSÃO DE ÁUDIO PARA MP3 (ALTERADO) ---
        # Converte qualquer áudio para MP3 para garantir compatibilidade com todos os dispositivos, incluindo iPhone.
        # Isso corrige o erro 'Media upload error' (131053) da API da Meta.
        if media_type == 'audio':
            logger.info(f"WBP: Áudio ({mimetype}) recebido. Convertendo para MP3 para garantir compatibilidade.")
            try:
                with tempfile.TemporaryDirectory() as temp_dir:
                    input_ext = os.path.splitext(filename)[1] or '.bin'
                    input_path = os.path.join(temp_dir, f"{uuid.uuid4()}{input_ext}")
                    
                    output_path = os.path.join(temp_dir, f"{uuid.uuid4()}.mp3") # Saída agora é .mp3
                    
                    with open(input_path, "wb") as f:
                        f.write(file_bytes)
                    
                    # Chama a função síncrona do ffmpeg (que agora converte para MP3)
                    await asyncio.to_thread(self._run_ffmpeg_sync, input_path, output_path)
                    
                    with open(output_path, "rb") as f:
                        converted_bytes = f.read()
                    
                    if not converted_bytes:
                        raise ValueError("Arquivo MP3 resultante está vazio.")
                        
                    final_file_bytes = converted_bytes
                    final_mimetype = 'audio/mpeg' # Mimetype para MP3
                    final_filename = os.path.splitext(filename)[0] + ".mp3"
                    
                    logger.info(f"WBP: Conversão de áudio para MP3 concluída ({len(final_file_bytes)} bytes).")

            except Exception as conv_e:
                logger.error(f"WBP: Falha CRÍTICA na conversão de áudio para MP3: {conv_e}", exc_info=True)
                logger.warning("WBP: Tentando enviar áudio original (pode falhar ou não sair como PTT)...")
                # Se a conversão falhar, ele tentará enviar o original.
        
        # --- INÍCIO DA LÓGICA DE CONVERSÃO DE IMAGEM (NOVO) ---
        # Processa TODAS as imagens para garantir a orientação correta e compatibilidade.
        elif media_type == 'image':
            logger.info(f"WBP: Processando imagem ({filename}, {mimetype}) para garantir orientação e compatibilidade.")
            try:
                with tempfile.TemporaryDirectory() as temp_dir:
                    input_ext = os.path.splitext(filename)[1] or '.bin'
                    input_path = os.path.join(temp_dir, f"{uuid.uuid4()}{input_ext}")
                    
                    # Saída agora é .jpeg
                    output_path = os.path.join(temp_dir, f"{uuid.uuid4()}.jpeg")
                    
                    with open(input_path, "wb") as f:
                        f.write(file_bytes)
                    
                    # Comando ffmpeg para converter para JPEG, preservando a orientação (autorotate)
                    command = ["ffmpeg", "-y", "-autorotate", "-i", input_path, "-pix_fmt", "yuvj420p", "-q:v", "2", output_path]
                    result = subprocess.run(command, capture_output=True, check=True, text=True, encoding='utf-8')
                    
                    with open(output_path, "rb") as f:
                        converted_bytes = f.read()
                    
                    if not converted_bytes:
                        raise ValueError("Arquivo JPEG resultante está vazio.")
                        
                    final_file_bytes = converted_bytes
                    final_mimetype = 'image/jpeg'
                    final_filename = os.path.splitext(filename)[0] + ".jpeg"
                    
                    logger.info(f"WBP: Conversão para JPEG concluída ({len(final_file_bytes)} bytes).")

            except Exception as conv_e:
                logger.error(f"WBP: Falha CRÍTICA na conversão para JPEG: {conv_e}", exc_info=True)
                logger.warning("WBP: Tentando enviar imagem original (pode falhar)...")
                final_file_bytes = file_bytes
                final_mimetype = mimetype
                final_filename = filename
        # --- FIM DA LÓGICA DE CONVERSÃO ---
        
        url = f"{self.wbp_graph_url_base}/{self.wbp_api_version}/{phone_number_id}/media"
        headers = {"Authorization": f"Bearer {access_token}"}
        
        files = {
            'file': (final_filename, final_file_bytes, final_mimetype),
            'messaging_product': (None, 'whatsapp'),
            'type': (None, final_mimetype)
        }
        
        logger.info(f"WBP: Iniciando upload de mídia ({final_filename}, {final_mimetype}, {len(final_file_bytes)} bytes)...")
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(url, headers=headers, files=files, timeout=120.0)
                response.raise_for_status()
                response_data = response.json()
                media_id = response_data.get("id")
                
                if not media_id:
                    logger.error(f"WBP: Upload falhou. Sem ID. Resp: {response_data}")
                    return None
                    
                logger.info(f"WBP: Upload sucesso. Media ID: {media_id}")
                return media_id
                
        except Exception as e:
            logger.error(f"WBP: Erro no upload: {e}", exc_info=True)
            return None

    async def send_media_message_official(
        self, 
        phone_number_id: str, 
        access_token: str, 
        to_number: str, 
        media_type: str, # 'image', 'audio', 'document'
        file_bytes: bytes, 
        filename: str, 
        mimetype: str,
        caption: Optional[str] = None
    ) -> Dict[str, Any]:
        """Etapa 2 (Oficial): Envia a mídia usando o Media ID."""
        
        # Etapa 1: Upload
        # --- ALTERAÇÃO AQUI ---
        media_id = await self._upload_media_official(
            phone_number_id, access_token, file_bytes, 
            mimetype, filename, media_type # Passa o media_type
        )
        # --- FIM DA ALTERAÇÃO ---

        if not media_id:
            raise MessageSendError(f"WBP: Falha ao fazer upload da mídia ({filename}) antes do envio.")

        # Etapa 2: Envio (Código restante sem alterações)
        url = f"{self.wbp_graph_url_base}/{self.wbp_api_version}/{phone_number_id}/messages"
        headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
        clean_to_number = self._normalize_number(to_number)
        
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": clean_to_number,
            "type": media_type,
        }
        
        media_payload = {"id": media_id}
        if media_type == 'document':
            media_payload["filename"] = filename
        if caption and media_type != 'audio': # Áudio não suporta legenda
             media_payload["caption"] = caption
             
        payload[media_type] = media_payload

        logger.debug(f"WBP Send Media Payload to {clean_to_number}: {json.dumps(payload)}")
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(url, headers=headers, json=payload, timeout=30.0)
                response.raise_for_status()
                response_data = response.json()
                message_id = response_data.get("messages", [{}])[0].get("id")
                
                logger.info(f"WBP: Mídia ({media_type}) enviada para {clean_to_number} (ID: {message_id}).")
                return {"id": message_id, "media_id": media_id}
                
        except (httpx.RequestError, httpx.HTTPStatusError) as e:
            error_detail = str(e)
            if isinstance(e, httpx.HTTPStatusError) and e.response:
                error_detail = f"{e} - Response: {e.response.text}"
            logger.error(f"WBP: Falha ao enviar mídia ({media_type}) para {clean_to_number}. Erro: {error_detail}", exc_info=True)
            raise MessageSendError(f"WBP: Falha ao enviar mídia: {error_detail}") from e
        except Exception as e:
            logger.error(f"WBP: Erro inesperado ao enviar mídia ({media_type}) para {clean_to_number}: {e}", exc_info=True)
            raise MessageSendError(f"WBP: Erro inesperado no envio de mídia: {e}") from e

    async def send_template_message_official(
        self,
        phone_number_id: str,
        access_token: str,
        to_number: str,
        template_name: str,
        language_code: str,
        components: Optional[List[Dict[str, Any]]]
    ) -> Dict[str, Any]:
        """Envia uma mensagem de template via API Oficial (WBP)."""
        if not all([phone_number_id, access_token, to_number, template_name, language_code]):
            raise ValueError("WBP: phone_number_id, access_token, to_number, template_name e language_code são obrigatórios.")

        url = f"{self.wbp_graph_url_base}/{self.wbp_api_version}/{phone_number_id}/messages"
        headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
        clean_to_number = self._normalize_number(to_number)

        template_payload = {
            "name": template_name,
            "language": {
                "code": language_code
            }
        }
        # Adiciona a chave 'components' apenas se ela for fornecida e não for vazia.
        if components:
            template_payload["components"] = components

        payload = {
            "messaging_product": "whatsapp",
            "to": clean_to_number,
            "type": "template",
            "template": template_payload
        }

        logger.debug(f"WBP Send Template Payload to {clean_to_number}: {json.dumps(payload)}")

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(url, headers=headers, json=payload, timeout=30.0)
                response.raise_for_status()
                response_data = response.json()
                message_id = response_data.get("messages", [{}])[0].get("id")
                logger.info(f"WBP: Mensagem de template '{template_name}' enviada para {clean_to_number} (ID: {message_id}).")
                return {"id": message_id}
        except httpx.HTTPStatusError as e:
            error_body = e.response.text if e.response else "N/A"
            logger.error(f"WBP: Erro HTTP {e.response.status_code} ao enviar template '{template_name}' para {clean_to_number}: {error_body}")
            raise MessageSendError(f"WBP: Falha ao enviar template: {error_body}") from e
        except Exception as e:
            logger.error(f"WBP: Erro inesperado ao enviar template para {clean_to_number}: {e}", exc_info=True)
            raise MessageSendError(f"WBP: Erro inesperado no envio de template: {e}") from e

    async def send_text_message(self, user: models.User, number: str, text: str) -> Dict[str, Any]:
        # (Função existente sem alterações)
        if not user or not number or not text:
             raise ValueError("User, number, and text are required for sending messages.")
        try:
            if not user.wbp_phone_number_id or not user.wbp_access_token:
                raise ValueError(f"Usuário {user.id} configurado, mas 'wbp_phone_number_id' ou 'wbp_access_token' não definidos/criptografados.")
            try:
                decrypted_token = decrypt_token(user.wbp_access_token)
            except Exception as decrypt_err:
                logger.error(f"Falha ao descriptografar WBP token para user {user.id}: {decrypt_err}")
                raise ValueError(f"Não foi possível descriptografar o token de acesso para enviar mensagem (User {user.id}).") from decrypt_err
            return await self.send_text_message_official(user.wbp_phone_number_id, decrypted_token, number, text)


        except MessageSendError as e:
            raise e
        except ValueError as e:
            logger.error(f"Erro de configuração ao tentar enviar mensagem para user {user.id}: {e}")
            raise MessageSendError(f"Erro de configuração: {e}") from e
        except Exception as e:
            logger.error(f"Erro inesperado no adaptador send_text_message para user {user.id}: {e}", exc_info=True)
            raise MessageSendError(f"Erro inesperado no envio: {e}") from e

    async def send_media_message(
        self, 
        user: models.User, 
        number: str, 
        media_type: str, 
        file_bytes: bytes, 
        filename: str, 
        mimetype: Optional[str] = None,
        caption: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Função centralizada para enviar MÍDIA.
        Retorna um dict com {"id": ..., "timestamp": ...} (ou "media_id")
        """
        if not all([user, number, media_type, file_bytes, filename]):
            raise ValueError("User, number, media_type, file_bytes, e filename são obrigatórios.")

        # Tenta adivinhar o mimetype se não for fornecido
        if not mimetype:
            mimetype, _ = mimetypes.guess_type(filename)
            if not mimetype:
                mimetype = 'application/octet-stream' # Fallback
                logger.warning(f"Não foi possível adivinhar o mimetype de {filename}, usando {mimetype}.")

        try:
            if not user.wbp_phone_number_id or not user.wbp_access_token:
                raise ValueError(f"Usuário {user.id} configurado, mas 'wbp_phone_number_id' ou 'wbp_access_token' não definidos.")
            
            try:
                decrypted_token = decrypt_token(user.wbp_access_token)
            except Exception as decrypt_err:
                logger.error(f"Falha ao descriptografar WBP token (envio de mídia) para user {user.id}: {decrypt_err}")
                raise ValueError(f"Não foi possível descriptografar o token de acesso (User {user.id}).") from decrypt_err
            
            return await self.send_media_message_official(
                user.wbp_phone_number_id, decrypted_token, number, media_type, 
                file_bytes, filename, mimetype, caption
            )

        except MessageSendError as e:
            raise e
        except ValueError as e:
            logger.error(f"Erro de configuração ao tentar enviar mídia para user {user.id}: {e}")
            raise MessageSendError(f"Erro de configuração (mídia): {e}") from e
        except Exception as e:
            logger.error(f"Erro inesperado no adaptador send_media_message para user {user.id}: {e}", exc_info=True)
            raise MessageSendError(f"Erro inesperado no envio de mídia: {e}") from e

    async def send_template_message(
        self,
        user: models.User,
        number: str,
        template_name: str,
        language_code: str,
        components: Optional[List[Dict[str, Any]]]
    ) -> Dict[str, Any]:
        """Adapter para enviar mensagem de template, tratando a autenticação do usuário."""
        if not all([user, number, template_name, language_code]):
            raise ValueError("User, number, template_name e language_code são obrigatórios.")

        try:
            if not user.wbp_phone_number_id or not user.wbp_access_token:
                raise ValueError(f"Usuário {user.id} não tem 'wbp_phone_number_id' ou 'wbp_access_token' configurados.")

            try:
                decrypted_token = decrypt_token(user.wbp_access_token)
            except Exception as decrypt_err:
                logger.error(f"Falha ao descriptografar WBP token (template) para user {user.id}: {decrypt_err}")
                raise ValueError(f"Não foi possível descriptografar o token de acesso (User {user.id}).") from decrypt_err

            return await self.send_template_message_official(
                user.wbp_phone_number_id, decrypted_token, number, template_name, language_code, components
            )
        except (MessageSendError, ValueError) as e:
            raise e
        except Exception as e:
            logger.error(f"Erro inesperado no adaptador send_template_message para user {user.id}: {e}", exc_info=True)
            raise MessageSendError(f"Erro inesperado no envio de template: {e}") from e

    async def get_templates_official(self, business_account_id: str, access_token: str) -> List[Dict[str, Any]]:
        """Busca a lista de templates de mensagem da API Oficial (WBP)."""
        if not business_account_id or not access_token:
            raise ValueError("WBP: business_account_id e access_token são obrigatórios para buscar templates.")

        url = f"{self.wbp_graph_url_base}/{self.wbp_api_version}/{business_account_id}/message_templates"
        headers = {"Authorization": f"Bearer {access_token}"}
        # Parâmetros para buscar todos os campos relevantes e aumentar o limite
        params = {
            "fields": "name,status,language,components",
            "limit": 200  # Aumenta o limite para buscar mais templates de uma vez
        }

        logger.info(f"WBP: Buscando templates para a conta {business_account_id}...")

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(url, headers=headers, params=params, timeout=30.0)
                response.raise_for_status()
                response_data = response.json()

                all_templates = response_data.get("data", [])
                logger.info(f"WBP: Encontrados {len(all_templates)} templates no total (todos os status).")
                return all_templates
        except httpx.HTTPStatusError as e:
            error_body = e.response.text if e.response else "N/A"
            logger.error(f"WBP: Erro HTTP {e.response.status_code} ao buscar templates: {error_body}")
            raise MessageSendError(f"WBP: Falha ao buscar templates: {error_body}") from e
        except Exception as e:
            logger.error(f"WBP: Erro inesperado ao buscar templates: {e}", exc_info=True)
            raise MessageSendError(f"WBP: Erro inesperado ao buscar templates: {e}") from e
# --- Singleton ---
_whatsapp_service_instance = None
def get_whatsapp_service():
    global _whatsapp_service_instance
    if _whatsapp_service_instance is None:
        _whatsapp_service_instance = WhatsAppService()
    return _whatsapp_service_instance
