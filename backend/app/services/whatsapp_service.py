import httpx
import logging
import json
from typing import Dict, Any, Optional, List, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
import os
import uuid
import tempfile
import asyncio
from app.core.config import settings
from app.services.security import decrypt_token
from app.db import models, schemas
import subprocess
import mimetypes
import io
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

class MessageSendError(Exception):
    """Exceção customizada para falhas no envio de mensagens."""
    pass

def format_whatsapp_number(number: str) -> str:
    """
    Limpa o número, adiciona o prefixo 55 se necessário e remove o nono dígito de números brasileiros.
    """
    if not number:
        return ""
    # Remove tudo que não for dígito
    clean_number = "".join(filter(str.isdigit, str(number)))
    
    # Adiciona 55 se o número tiver 10 ou 11 dígitos (DDD + número)
    if not clean_number.startswith("55") and len(clean_number) in [10, 11]:
        clean_number = "55" + clean_number
        
    # Remove o nono dígito (55 + DD + 9 + 8 dígitos)
    if len(clean_number) == 13 and clean_number.startswith("55") and clean_number[4] == '9':
        clean_number = clean_number[:4] + clean_number[5:]
        
    return clean_number

class WhatsAppService:
    
    def __init__(self):
        # --- Configurações API Oficial (WBP) ---
        self.wbp_graph_url_base = "https://graph.facebook.com" # Base URL
        self.wbp_api_version = "v24.0" # Manter versão consistente

    def _normalize_number(self, number: str) -> str:
        """Usa a função global de formatação."""
        return format_whatsapp_number(number)

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
        text = text.replace("**", "*")
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

    def _guess_mimetype_from_bytes(self, file_bytes: bytes) -> Optional[str]:
        """Tenta adivinhar o mimetype a partir dos bytes iniciais (magic numbers)."""
        if not file_bytes:
            return None
        
        # Assinaturas comuns
        if file_bytes.startswith(b'\xff\xd8\xff'):
            return 'image/jpeg'
        if file_bytes.startswith(b'\x89PNG\r\n\x1a\n'):
            return 'image/png'
        if file_bytes.startswith(b'GIF87a') or file_bytes.startswith(b'GIF89a'):
            return 'image/gif'
        if file_bytes.startswith(b'%PDF'):
            return 'application/pdf'
        if file_bytes.startswith(b'ID3') or file_bytes.startswith(b'\xff\xfb') or file_bytes.startswith(b'\xff\xf3') or file_bytes.startswith(b'\xff\xf2'):
            return 'audio/mpeg'
        if file_bytes.startswith(b'OggS'):
            return 'audio/ogg'
        if file_bytes.startswith(b'RIFF') and len(file_bytes) > 12 and file_bytes[8:12] == b'WAVE':
            return 'audio/wav'
        if file_bytes.startswith(b'RIFF') and len(file_bytes) > 12 and file_bytes[8:12] == b'AVI ':
            return 'video/x-msvideo'
        if file_bytes.startswith(b'\x00\x00\x00\x18ftyp') or file_bytes.startswith(b'\x00\x00\x00\x20ftyp'):
            return 'video/mp4'
        
        return None

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
                # Tenta adivinhar o mimetype real se for genérico
                if mimetype in ['application/octet-stream', None]:
                    detected_mime = self._guess_mimetype_from_bytes(file_bytes)
                    if detected_mime:
                        logger.info(f"WBP: Mimetype detectado via bytes: {detected_mime}")
                        mimetype = detected_mime
                        final_mimetype = detected_mime

                with tempfile.TemporaryDirectory() as temp_dir:
                    input_ext = os.path.splitext(filename)[1]
                    if not input_ext:
                        # Se não tem extensão, usa uma baseada no mimetype detectado ou .tmp
                        if 'jpeg' in mimetype or 'jpg' in mimetype: input_ext = '.jpg'
                        elif 'png' in mimetype: input_ext = '.png'
                        else: input_ext = '.tmp'
                    
                    input_path = os.path.join(temp_dir, f"{uuid.uuid4()}{input_ext}")
                    output_path = os.path.join(temp_dir, f"{uuid.uuid4()}.jpeg")
                    
                    with open(input_path, "wb") as f:
                        f.write(file_bytes)
                    
                    # Processamento de imagem: preserva orientação e converte para JPEG
                    # Adicionado: -f image2 se for um arquivo sem extensão clara para ajudar o ffmpeg
                    command = ["ffmpeg", "-y"]
                    if input_ext == '.tmp':
                        # Se não sabemos o formato, tentamos forçar o probe
                        command.extend(["-f", "image2pipe" if mimetype == 'application/octet-stream' else "image2"])
                    
                    command.extend(["-autorotate", "-i", input_path, "-pix_fmt", "yuvj420p", "-q:v", "2", output_path])
                    
                    logger.debug(f"WBP: Rodando FFmpeg para imagem: {' '.join(command)}")
                    
                    # Removido text=True e encoding para evitar problemas com outputs binários inesperados no stderr
                    process = await asyncio.to_thread(
                        subprocess.run, 
                        command, 
                        capture_output=True, 
                        check=False # Check=False para tratar o erro manualmente
                    )
                    
                    if process.returncode != 0:
                        stderr = process.stderr.decode('utf-8', errors='ignore')
                        logger.error(f"WBP: FFmpeg falhou (code {process.returncode}). Stderr: {stderr}")
                        
                        # Se o FFmpeg falhar e não soubermos se é imagem, tentamos enviar como documento
                        if 'image' not in (mimetype or ''):
                            logger.warning("WBP: Arquivo não parece ser uma imagem válida. Alterando tipo para 'document'.")
                            return await self._upload_media_official(phone_number_id, access_token, file_bytes, mimetype or 'application/octet-stream', filename, 'document')
                        raise subprocess.CalledProcessError(process.returncode, command, output=process.stdout, stderr=process.stderr)
                    
                    with open(output_path, "rb") as f:
                        converted_bytes = f.read()
                    
                    if not converted_bytes:
                        raise ValueError("Arquivo JPEG resultante está vazio.")
                        
                    final_file_bytes = converted_bytes
                    final_mimetype = 'image/jpeg'
                    final_filename = os.path.splitext(filename)[0] + ".jpeg"
                    
                    logger.info(f"WBP: Conversão para JPEG concluída ({len(final_file_bytes)} bytes).")

            except Exception as conv_e:
                logger.error(f"WBP: Falha na conversão para JPEG: {conv_e}")
                logger.warning("WBP: Tentando enviar mídia original como backup...")
                final_file_bytes = file_bytes
                final_mimetype = mimetype or 'application/octet-stream'
                final_filename = filename
                
                # Se falhou como imagem e o mimetype é suspeito, tentamos forçar 'document' no upload real
                if media_type == 'image' and final_mimetype == 'application/octet-stream':
                     logger.warning("WBP: Forçando 'document' para o upload de fallback para evitar erro 400 da Meta.")
                     media_type = 'document'
        
        # --- INÍCIO DA LÓGICA DE COMPRESSÃO DE VÍDEO (NOVO) ---
        elif media_type == 'video' and len(file_bytes) > 14 * 1024 * 1024:
            logger.info(f"WBP: Vídeo recebido com tamanho maior que 14MB ({len(file_bytes)} bytes). Iniciando compressão...")
            try:
                with tempfile.TemporaryDirectory() as temp_dir:
                    input_ext = os.path.splitext(filename)[1] or '.mp4'
                    input_path = os.path.join(temp_dir, f"{uuid.uuid4()}{input_ext}")
                    output_path = os.path.join(temp_dir, f"{uuid.uuid4()}.mp4")
                    
                    with open(input_path, "wb") as f:
                        f.write(file_bytes)
                    
                    # Usamos FFmpeg com CRF 28 e preset fast para compressão rápida e eficiente, forçando h264 e aac
                    command = [
                        "ffmpeg", "-y",
                        "-i", input_path,
                        "-vcodec", "libx264",
                        "-profile:v", "main",
                        "-level:v", "3.0",
                        "-pix_fmt", "yuv420p",
                        "-acodec", "aac",
                        "-b:a", "128k",
                        "-crf", "28",
                        "-preset", "faster",
                        "-movflags", "faststart",
                        output_path
                    ]
                    
                    logger.info(f"WBP: Rodando compressão de vídeo: {' '.join(command)}")
                    process = await asyncio.to_thread(
                        subprocess.run, 
                        command, 
                        capture_output=True, 
                        check=False
                    )
                    
                    if process.returncode != 0:
                        stderr = process.stderr.decode('utf-8', errors='ignore')
                        logger.error(f"WBP: Compressão de vídeo falhou (code {process.returncode}). Stderr: {stderr}")
                        raise subprocess.CalledProcessError(process.returncode, command, output=process.stdout, stderr=process.stderr)
                    
                    with open(output_path, "rb") as f:
                        compressed_bytes = f.read()
                    
                    if not compressed_bytes:
                        raise ValueError("Arquivo de vídeo resultante está vazio.")
                    
                    final_file_bytes = compressed_bytes
                    final_mimetype = 'video/mp4'
                    final_filename = os.path.splitext(filename)[0] + ".mp4"
                    logger.info(f"WBP: Compressão de vídeo concluída de {len(file_bytes)} para {len(final_file_bytes)} bytes.")
                    
            except Exception as conv_e:
                logger.error(f"WBP: Falha na compressão do vídeo: {conv_e}", exc_info=True)
                logger.warning("WBP: Mantendo vídeo original...")
        # --- FIM DA LÓGICA DE CONVERSÃO ---
        
        url = f"{self.wbp_graph_url_base}/{self.wbp_api_version}/{phone_number_id}/media"
        headers = {"Authorization": f"Bearer {access_token}"}
        
        files = {
            'file': (final_filename, final_file_bytes, final_mimetype),
            'messaging_product': (None, 'whatsapp'),
            'type': (None, media_type)
        }
        
        logger.info(f"WBP: Iniciando upload de mídia ({final_filename}, {final_mimetype}, {len(final_file_bytes)} bytes)...")
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(url, headers=headers, files=files, timeout=120.0)
                if response.status_code != 200:
                    logger.error(f"WBP: Resposta de erro do upload (Status {response.status_code}): {response.text}")
                response.raise_for_status()
                response_data = response.json()
                media_id = response_data.get("id")
                
                if not media_id:
                    logger.error(f"WBP: Upload falhou. Sem ID. Resp: {response_data}")
                    return None
                    
                logger.info(f"WBP: Upload sucesso. Media ID: {media_id}")
                return media_id
                
        except httpx.HTTPStatusError as http_err:
            logger.error(f"WBP: Erro HTTP no upload. Status: {http_err.response.status_code} | Corpo: {http_err.response.text}", exc_info=True)
            return None
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
        if caption:
            caption = caption.replace("**", "*")
        
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

    async def send_text_message(self, company: models.Company, number: str, text: str) -> Dict[str, Any]:
        if not company or not number or not text:
             raise ValueError("Company, number, and text are required for sending messages.")
        try:
            if not company.wbp_phone_number_id:
                raise ValueError(f"Empresa {company.id} configurada, mas 'wbp_phone_number_id' não definido.")
            
            return await self.send_text_message_official(company.wbp_phone_number_id, settings.WBP_ACCESS_TOKEN, number, text)

        except MessageSendError as e:
            raise e
        except ValueError as e:
            logger.error(f"Erro de configuração ao tentar enviar mensagem para empresa {company.id}: {e}")
            raise MessageSendError(f"Erro de configuração: {e}") from e
        except Exception as e:
            logger.error(f"Erro inesperado no adaptador send_text_message para empresa {company.id}: {e}", exc_info=True)
            raise MessageSendError(f"Erro inesperado no envio: {e}") from e

    async def send_media_message(
        self, 
        company: models.Company, 
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
        if not all([company, number, media_type, file_bytes, filename]):
            raise ValueError("Company, number, media_type, file_bytes, e filename são obrigatórios.")

        # --- NORMALIZAÇÃO DE TIPO (FIX) ---
        # O WhatsApp aceita apenas: audio, document, image, video, sticker.
        # Se vier 'pdf', 'doc', etc. (comum em retornos de IA), forçamos 'document'.
        media_type = media_type.lower().strip()
        valid_types = ['audio', 'document', 'image', 'video', 'sticker']
        
        if media_type not in valid_types:
            if media_type in ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv']:
                media_type = 'document'
            elif media_type in ['jpg', 'jpeg', 'png']:
                media_type = 'image'
            elif media_type in ['mp3', 'ogg', 'wav']:
                media_type = 'audio'
            elif media_type in ['mp4', 'mov', 'avi']:
                media_type = 'video'
            else:
                logger.warning(f"WBP: Tipo de mídia '{media_type}' desconhecido. Forçando 'document'.")
                media_type = 'document'

        # Tenta adivinhar o mimetype se não for fornecido
        if not mimetype or mimetype == 'application/octet-stream':
            # Tenta via extensão primeiro
            guessed_mime, _ = mimetypes.guess_type(filename)
            if guessed_mime:
                mimetype = guessed_mime
            else:
                # Tenta via bytes se a extensão falhar
                mimetype = self._guess_mimetype_from_bytes(file_bytes)
                if not mimetype:
                    mimetype = 'application/octet-stream' # Fallback
                    logger.warning(f"Não foi possível adivinhar o mimetype de {filename}, usando {mimetype}.")
                else:
                    logger.info(f"Mimetype adivinhado via bytes para {filename}: {mimetype}")

        try:
            if not company.wbp_phone_number_id:
                raise ValueError(f"Empresa {company.id} configurada, mas 'wbp_phone_number_id' não definido.")
            
            return await self.send_media_message_official(
                company.wbp_phone_number_id, settings.WBP_ACCESS_TOKEN, number, media_type, 
                file_bytes, filename, mimetype, caption
            )

        except MessageSendError as e:
            raise e
        except ValueError as e:
            logger.error(f"Erro de configuração ao tentar enviar mídia para empresa {company.id}: {e}")
            raise MessageSendError(f"Erro de configuração (mídia): {e}") from e
        except Exception as e:
            logger.error(f"Erro inesperado no adaptador send_media_message para empresa {company.id}: {e}", exc_info=True)
            raise MessageSendError(f"Erro inesperado no envio de mídia: {e}") from e

    async def send_template_message(
        self,
        company: models.Company,
        number: str,
        template_name: str,
        language_code: str,
        components: Optional[List[Dict[str, Any]]],
        db: Optional[Any] = None,
        atendimento_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """Adapter para enviar mensagem de template, tratando a autenticação da empresa."""
        if not all([company, number, template_name, language_code]):
            raise ValueError("Company, number, template_name e language_code são obrigatórios.")

        try:
            if not company.wbp_phone_number_id:
                raise ValueError(f"Empresa {company.id} não tem 'wbp_phone_number_id' configurado.")

            result = await self.send_template_message_official(
                company.wbp_phone_number_id, settings.WBP_ACCESS_TOKEN, number, template_name, language_code, components
            )

            # Desconta 50000 tokens pelo envio de template
            if db is not None:
                try:
                    from app.crud import crud_user
                    logger.info(f"Deduzindo 50000 tokens de template da empresa {company.id}...")
                    await crud_user.decrement_company_tokens(
                        db=db,
                        db_company=company,
                        usage=50000,
                        atendimento_id=atendimento_id,
                        token_type="whatsapp_template"
                    )
                    await db.commit()
                    await db.refresh(company)
                except Exception as token_err:
                    logger.error(f"Falha ao deduzir tokens de template da empresa {company.id}: {token_err}", exc_info=True)
                    await db.rollback()

            return result
        except (MessageSendError, ValueError) as e:
            raise e
        except Exception as e:
            logger.error(f"Erro inesperado no adaptador send_template_message para empresa {company.id}: {e}", exc_info=True)
            raise MessageSendError(f"Erro inesperado no envio de template: {e}") from e

    async def get_templates_official(self, business_account_id: str, access_token: str) -> List[Dict[str, Any]]:
        """Busca a lista de templates de mensagem da API Oficial (WBP)."""
        if not business_account_id or not access_token:
            raise ValueError("WBP: business_account_id e access_token são obrigatórios para buscar templates.")

        url = f"{self.wbp_graph_url_base}/{self.wbp_api_version}/{business_account_id}/message_templates"
        headers = {"Authorization": f"Bearer {access_token}"}
        # Parâmetros para buscar todos os campos relevantes e aumentar o limite
        params = {
            "fields": "id,name,status,language,components",
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

    async def create_template_official(self, business_account_id: str, access_token: str, payload: dict) -> dict:
        """Cria um novo template de mensagem na API Oficial (WBP)."""
        if not business_account_id or not access_token:
            raise ValueError("WBP: business_account_id e access_token são obrigatórios para criar templates.")

        url = f"{self.wbp_graph_url_base}/{self.wbp_api_version}/{business_account_id}/message_templates"
        headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(url, headers=headers, json=payload, timeout=30.0)
                response.raise_for_status()
                return response.json()
        except httpx.HTTPStatusError as e:
            error_body = e.response.text if e.response else "N/A"
            logger.error(f"WBP: Erro HTTP {e.response.status_code} ao criar template: {error_body}")
            raise MessageSendError(f"Falha ao criar template na Meta: {error_body}") from e
        except Exception as e:
            logger.error(f"WBP: Erro inesperado ao criar template: {e}", exc_info=True)
            raise MessageSendError(f"Erro inesperado ao criar template: {e}") from e

    async def delete_template_official(self, business_account_id: str, access_token: str, template_name: str = None, template_id: str = None) -> bool:
        """
        Exclui um template de mensagem na API Oficial (WBP).
        Usa o endpoint da conta (WABA) para maior compatibilidade.
        """
        if not business_account_id or not access_token:
            raise ValueError("WBP: business_account_id e access_token são obrigatórios.")
        if not template_name:
            raise ValueError("WBP: template_name é obrigatório para exclusão via WABA.")

        url = f"{self.wbp_graph_url_base}/{self.wbp_api_version}/{business_account_id}/message_templates"
        headers = {"Authorization": f"Bearer {access_token}"}
        
        # Parâmetros obrigatórios e opcionais
        params = {"name": template_name}
        if template_id:
            params["hsm_id"] = template_id  # Algumas versões da API aceitam hsm_id para maior precisão

        try:
            async with httpx.AsyncClient() as client:
                response = await client.delete(url, headers=headers, params=params, timeout=30.0)
                response.raise_for_status()
                return True
        except httpx.HTTPStatusError as e:
            error_body = e.response.text if e.response else "N/A"
            logger.error(f"WBP: Erro HTTP {e.response.status_code} ao excluir template {template_name}: {error_body}")
            raise MessageSendError(f"Falha ao excluir template na Meta: {error_body}") from e
        except Exception as e:
            logger.error(f"WBP: Erro inesperado ao excluir template: {e}", exc_info=True)
            raise MessageSendError(f"Erro inesperado ao excluir template: {e}") from e

    async def get_app_id(self, access_token: str) -> Optional[str]:
        """Obtém o APP_ID associado ao token de acesso."""
        url = f"{self.wbp_graph_url_base}/{self.wbp_api_version}/debug_token"
        params = {
            "input_token": access_token,
            "access_token": access_token
        }
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(url, params=params, timeout=10.0)
                if response.status_code == 200:
                    return response.json().get("data", {}).get("app_id")
        except Exception as e:
            logger.error(f"Erro ao buscar app_id: {e}")
        return None

    async def upload_template_example(self, access_token: str, file_bytes: bytes, mimetype: str) -> str:
        """Faz upload de um arquivo para a API Resumable Upload da Meta e retorna o handle."""
        app_id = await self.get_app_id(access_token)
        if not app_id:
            raise Exception("Não foi possível identificar o App ID para fazer o upload do exemplo.")
            
        file_length = len(file_bytes)
        
        # 1. Cria a sessão de upload
        session_url = f"{self.wbp_graph_url_base}/{self.wbp_api_version}/{app_id}/uploads"
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json"
        }
        params = {
            "file_length": file_length,
            "file_type": mimetype
        }
        
        async with httpx.AsyncClient() as client:
            session_resp = await client.post(session_url, headers=headers, params=params, timeout=30.0)
            if session_resp.status_code != 200:
                logger.error(f"WBP: Erro ao criar sessão de upload. Resposta: {session_resp.text}")
                raise Exception(f"Falha ao criar sessão de upload na Meta. Verifique as permissões.")
                
            upload_id = session_resp.json().get("id")
            if not upload_id:
                raise Exception("Upload ID não foi retornado pela Meta.")
            
            # 2. Faz o upload do conteúdo
            upload_url = f"{self.wbp_graph_url_base}/{self.wbp_api_version}/{upload_id}"
            headers_upload = {
                "Authorization": f"OAuth {access_token}",
                "file_offset": "0"
            }
            
            upload_resp = await client.post(upload_url, headers=headers_upload, content=file_bytes, timeout=60.0)
            if upload_resp.status_code != 200:
                logger.error(f"WBP: Erro no upload do arquivo (exemplo). Resposta: {upload_resp.text}")
                raise Exception(f"Falha ao enviar arquivo de exemplo para a Meta.")
                
            handle = upload_resp.json().get("h")
            if not handle:
                raise Exception("A API da Meta não retornou um handle válido para o arquivo.")
            
            return handle

    async def get_whatsapp_templates(
        self,
        company: models.Company
    ) -> List[Dict[str, Any]]:
        """
        Lista todos os templates ativos na API Oficial da Meta para a empresa informada.

        @param company: Modelo da empresa.
        @returns: Lista de templates configurados.
        """
        wbp_business_account_id = company.wbp_business_account_id if company else None
        if not wbp_business_account_id:
            raise ValueError("ID da Conta do WhatsApp Business não está configurado para esta empresa.")

        return await self.get_templates_official(
            business_account_id=wbp_business_account_id,
            access_token=settings.WBP_ACCESS_TOKEN
        )

    async def create_whatsapp_template(
        self,
        company: models.Company,
        payload: Dict[str, Any],
        file_bytes: Optional[bytes],
        filename: Optional[str],
        mimetype: Optional[str]
    ) -> Dict[str, Any]:
        """
        Cria um template oficial na plataforma Meta vinculada à empresa.

        @param company: Modelo da empresa.
        @param payload: Dicionário de configuração do template.
        @param file_bytes: Bytes do arquivo de exemplo de mídia (opcional).
        @param filename: Nome do arquivo (opcional).
        @param mimetype: Mimetype do arquivo (opcional).
        @returns: Detalhes do template criado.
        """
        wbp_business_account_id = company.wbp_business_account_id if company else None
        if not wbp_business_account_id:
            raise ValueError("ID da Conta do WhatsApp Business não está configurado para esta empresa.")

        # Se houver um arquivo, faz upload prévio do exemplo para obter o handle de cabeçalho
        if file_bytes:
            actual_mime = mimetype or 'application/octet-stream'
            handle = await self.upload_template_example(
                access_token=settings.WBP_ACCESS_TOKEN,
                file_bytes=file_bytes,
                mimetype=actual_mime
            )
            
            for comp in payload.get('components', []):
                if comp.get('type') == 'HEADER' and comp.get('format') in ['IMAGE', 'VIDEO', 'DOCUMENT']:
                    comp['example'] = {'header_handle': [handle]}

        result = await self.create_template_official(
            business_account_id=wbp_business_account_id,
            access_token=settings.WBP_ACCESS_TOKEN,
            payload=payload
        )
        return result

    async def delete_whatsapp_template(
        self,
        company: models.Company,
        template_name: str,
        template_id: Optional[str]
    ) -> None:
        """
        Remove um template cadastrado na Meta.

        @param company: Modelo da empresa.
        @param template_name: Nome do template.
        @param template_id: ID do template (opcional).
        """
        wbp_business_account_id = company.wbp_business_account_id if company else None
        if not wbp_business_account_id:
            raise ValueError("ID da Conta do WhatsApp Business não está configurado para esta empresa.")

        await self.delete_template_official(
            business_account_id=wbp_business_account_id,
            access_token=settings.WBP_ACCESS_TOKEN,
            template_name=template_name,
            template_id=template_id
        )

    async def download_media_directly(
        self,
        db: AsyncSession,
        company_id: int,
        atendimento_id: int,
        media_id: str
    ) -> Tuple[bytes, str, str]:
        """
        Faz proxy e download seguro de uma mídia da Meta.

        @param db: Sessão do banco de dados.
        @param company_id: ID da empresa proprietária do atendimento.
        @param atendimento_id: ID do atendimento.
        @param media_id: ID do arquivo de mídia na Meta.
        @returns: Tupla contendo os bytes do arquivo, o mimetype e o nome do arquivo.
        """
        from app.crud import crud_atendimento
        from app.services.atendimento_service import AtendimentoNotFoundError

        db_atendimento = await crud_atendimento.get_atendimento(db, atendimento_id=atendimento_id, company_id=company_id)
        if not db_atendimento:
            raise AtendimentoNotFoundError("Atendimento não encontrado.")

        decrypted_token = settings.WBP_ACCESS_TOKEN
        
        logger.debug(f"Buscando URL para media_id {media_id}...")
        media_url = await self.get_media_url_official(media_id, decrypted_token)
        if not media_url:
            raise ValueError("URL da mídia não encontrada na Meta.")

        logger.info(f"Baixando mídia {media_id} diretamente da Meta...")
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
            headers = {"Authorization": f"Bearer {decrypted_token}"}
            media_response = await client.get(media_url, headers=headers)

            content_type = media_response.headers.get('content-type', '').lower()
            if media_response.status_code != 200 or 'text/html' in content_type:
                response_body_text = "[Corpo indisponível]"
                try:
                    response_body_text = (await media_response.aread(1024)).decode('utf-8', errors='ignore')
                except Exception:
                    pass
                logger.error(f"Erro ao baixar mídia {media_id}: Meta retornou status {media_response.status_code} / tipo {content_type}. Corpo: {response_body_text}")
                media_response.raise_for_status()
                raise ValueError("Falha ao baixar mídia da Meta: Resposta inesperada.")

            media_bytes = media_response.content
            
            # Recupera o nome original do arquivo gravado no histórico da conversa
            filename = "download"
            try:
                conversa_list = json.loads(db_atendimento.conversa or "[]")
                for msg in conversa_list:
                    if msg.get("media_id") == media_id:
                        filename = msg.get("filename") or "download"
                        break
            except Exception as e:
                logger.warning(f"Erro ao buscar filename para media {media_id}: {e}")

            return media_bytes, content_type, filename

    async def send_template_message_with_history(
        self,
        db: AsyncSession,
        company: models.Company,
        company_id: int,
        atendimento_id: int,
        payload: schemas.SendTemplatePayload,
        file_bytes: Optional[bytes],
        filename: Optional[str],
        mimetype: Optional[str]
    ) -> models.Atendimento:
        """
        Envia uma mensagem estruturada com base em um template homologado e a persiste no histórico.

        @param db: Sessão do banco de dados.
        @param company: Modelo da empresa.
        @param company_id: ID da empresa.
        @param atendimento_id: ID do atendimento.
        @param payload: Objeto de configuração do template enviado pelo frontend.
        @param file_bytes: Bytes da mídia de cabeçalho (opcional).
        @param filename: Nome do arquivo de mídia (opcional).
        @param mimetype: Mimetype da mídia (opcional).
        @returns: O atendimento atualizado.
        """
        from app.crud import crud_atendimento
        from app.services.atendimento_service import AtendimentoNotFoundError

        db_atendimento = await crud_atendimento.get_atendimento(db, atendimento_id=atendimento_id, company_id=company_id)
        if not db_atendimento or not db_atendimento.whatsapp:
            raise AtendimentoNotFoundError("Atendimento ou contato não encontrado")

        whatsapp_number = db_atendimento.whatsapp
        wbp_phone_number_id = company.wbp_phone_number_id if company else None
        wbp_business_account_id = company.wbp_business_account_id if company else None

        # Se houver mídia de cabeçalho, realiza o upload prévio e a insere nos componentes
        if file_bytes and wbp_phone_number_id:
            actual_mime = mimetype or (mimetypes.guess_type(filename)[0] if filename else 'application/octet-stream')
            
            media_type = 'document'
            if actual_mime.startswith('image/'):
                media_type = 'image'
            elif actual_mime.startswith('video/'):
                media_type = 'video'
            
            media_id = await self._upload_media_official(
                phone_number_id=wbp_phone_number_id,
                access_token=settings.WBP_ACCESS_TOKEN,
                file_bytes=file_bytes,
                mimetype=actual_mime,
                filename=filename or "template_media",
                media_type=media_type
            )
            
            if media_id:
                if not payload.components:
                    payload.components = []
                header_comp = next((c for c in payload.components if c['type'] == 'header'), None)
                if not header_comp:
                    header_comp = {"type": "header", "parameters": []}
                    payload.components.insert(0, header_comp)
                
                header_comp['parameters'].append({
                    "type": media_type,
                    media_type: {"id": media_id}
                })
            else:
                logger.error(f"Falha no upload de mídia para template: {filename}")
                raise ValueError("Falha ao carregar a mídia do template.")

        # Dispara o envio oficial do template
        send_result = await self.send_template_message(
            company=company,
            number=whatsapp_number,
            template_name=payload.template_name,
            language_code=payload.language_code,
            components=payload.components,
            db=db,
            atendimento_id=atendimento_id
        )

        logger.info(f"Template '{payload.template_name}' enviado para {whatsapp_number}. API Msg ID: {send_result.get('id')}")

        msg_type = 'text'
        final_media_id = None
        content_for_history = f"[Template: {payload.template_name}]\n"

        try:
            if wbp_business_account_id:
                templates = await self.get_templates_official(
                    business_account_id=wbp_business_account_id,
                    access_token=settings.WBP_ACCESS_TOKEN
                )
                
                target_template = next((t for t in templates if t['name'] == payload.template_name and t['language'] == payload.language_code), None)

                if target_template:
                    header_text = next((c.get('text', '') for c in target_template.get('components', []) if c['type'] == 'HEADER'), '')
                    body_text = next((c.get('text', '') for c in target_template.get('components', []) if c['type'] == 'BODY'), '')

                    sent_components = payload.components or []
                    header_params = next((c.get('parameters', []) for c in sent_components if c['type'] == 'header'), [])
                    body_params = next((c.get('parameters', []) for c in sent_components if c['type'] == 'body'), [])

                    for hp in header_params:
                        if 'image' in hp:
                            msg_type = 'image'
                            final_media_id = hp['image'].get('id')
                        elif 'video' in hp:
                            msg_type = 'video'
                            final_media_id = hp['video'].get('id')
                        elif 'document' in hp:
                            msg_type = 'document'
                            final_media_id = hp['document'].get('id')
                        if final_media_id:
                            break

                    for i, param in enumerate(header_params):
                        header_text = header_text.replace(f"{{{{{i+1}}}}}", param.get('text', ''))
                    
                    for i, param in enumerate(body_params):
                        body_text = body_text.replace(f"{{{{{i+1}}}}}", param.get('text', ''))
                        body_text = body_text.replace(f"{{{{{len(header_params) + i + 1}}}}}", param.get('text', ''))

                    buttons_data = next((c.get('buttons', []) for c in target_template.get('components', []) if c['type'] == 'BUTTONS'), [])
                    extracted_buttons = [b.get('text') for b in buttons_data if b.get('text')]

                    full_message = f"{header_text}\n{body_text}".strip()
                    if full_message:
                        content_for_history = full_message
            else:
                extracted_buttons = []

        except Exception as e:
            logger.warning(f"Não foi possível montar o preview do template '{payload.template_name}': {e}")
            extracted_buttons = []

        formatted_message = schemas.FormattedMessage(
            id=send_result.get('id') or f"template-{uuid.uuid4()}",
            role='assistant',
            content=content_for_history,
            timestamp=int(datetime.now(timezone.utc).timestamp()),
            type=msg_type,
            media_id=final_media_id,
            filename=filename if file_bytes else None,
            status="sent",
            is_template=True,
            buttons=extracted_buttons
        )

        atendimento_atualizado = await crud_atendimento.add_message_to_conversa(
            db=db, atendimento_id=atendimento_id, company_id=company_id, message=formatted_message
        )

        await db.refresh(atendimento_atualizado, attribute_names=['active_persona'])
        return atendimento_atualizado

# --- Singleton ---
_whatsapp_service_instance = None
def get_whatsapp_service():
    global _whatsapp_service_instance
    if _whatsapp_service_instance is None:
        _whatsapp_service_instance = WhatsAppService()
    return _whatsapp_service_instance
