import httpx
import logging
import os
from typing import List, Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from app.db import models

logger = logging.getLogger(__name__)

class ProspectService:
    def __init__(self):
        # Carrega configurações do .env
        self.base_url = os.getenv("PROSPECT_API_URL", "http://localhost:8000") # Ajuste a porta conforme necessário
        self.email = os.getenv("PROSPECT_EMAIL")
        self.password = os.getenv("PROSPECT_PASSWORD")
        
        if not self.email or not self.password:
            logger.warning("ProspectService: PROSPECT_EMAIL ou PROSPECT_PASSWORD não configurados no .env")

    async def _login(self) -> Optional[str]:
        """Realiza login na API do ProspectAI e retorna o token."""
        if not self.email or not self.password:
            raise ValueError("Credenciais do ProspectAI não configuradas.")

        url = f"{self.base_url}/api/v1/auth/token" # Assumindo endpoint padrão FastAPI OAuth2
        # Se o endpoint for diferente (ex: /auth/login), ajustar aqui
        
        logger.info(f"ProspectService: Tentando login em {url}...")
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    url, 
                    data={"username": self.email, "password": self.password},
                    timeout=10.0
                )
                
                if response.status_code != 200:
                    try:
                        error_detail = response.json()
                        logger.error(f"ProspectService: Falha no login (Status {response.status_code}). Resposta: {error_detail}")
                    except Exception:
                        logger.error(f"ProspectService: Falha no login (Status {response.status_code}). Corpo: {response.text}")
                
                response.raise_for_status()
                data = response.json()
                return data.get("access_token")
        except Exception as e:
            logger.error(f"ProspectService: Erro ao realizar login: {e}")
            raise

    async def get_token(self, db: AsyncSession, user: models.User) -> str:
        """
        Obtém o token válido. 
        Se não existir no banco, faz login e salva.
        """
        if user.prospect_token:
            return user.prospect_token
        
        # Se não tem token, faz login
        logger.info(f"ProspectService: Obtendo novo token para usuário {user.id}...")
        new_token = await self._login()
        
        if new_token:
            user.prospect_token = new_token
            db.add(user)
            await db.commit()
            await db.refresh(user)
            return new_token
        
        raise ValueError("Falha ao obter token do ProspectAI.")

    async def _make_request(self, method: str, endpoint: str, db: AsyncSession, user: models.User, json_data: Any = None) -> Any:
        """Wrapper genérico para requisições com retry automático em caso de 401 (Token Expirado)."""
        token = await self.get_token(db, user)
        url = f"{self.base_url}{endpoint}"
        headers = {"Authorization": f"Bearer {token}"}
        logger.info(f"ProspectService: Fazendo requisição {method} para {url}...")

        async with httpx.AsyncClient() as client:
            try:
                response = await client.request(method, url, headers=headers, json=json_data, timeout=15.0)
                
                # Verifica se o erro é 401 ou 404 "Usuário não encontrado"
                should_retry = response.status_code == 401
                if response.status_code == 404:
                    try:
                        error_data = response.json()
                        if error_data.get("detail") == "Usuário não encontrado":
                            should_retry = True
                            logger.warning("ProspectService: Usuário não encontrado no ProspectAI (404). Forçando novo login...")
                    except Exception:
                        pass

                # Se der erro de autenticação ou usuário não encontrado, tenta renovar o token uma vez
                if should_retry:
                    if response.status_code == 401:
                        logger.warning("ProspectService: Token expirado (401). Renovando...")
                    
                    new_token = await self._login()
                    if new_token:
                        # Atualiza no banco
                        user.prospect_token = new_token
                        db.add(user)
                        await db.commit()
                        
                        # Tenta novamente com novo token
                        headers["Authorization"] = f"Bearer {new_token}"
                        response = await client.request(method, url, headers=headers, json=json_data, timeout=15.0)
                
                response.raise_for_status()
                return response.json()
                
            except httpx.HTTPStatusError as e:
                logger.error(f"ProspectService: Erro HTTP {e.response.status_code} em {endpoint}: {e.response.text}")
                raise
            except Exception as e:
                logger.error(f"ProspectService: Erro de conexão em {endpoint}: {e}")
                raise

    async def list_destinations(self, db: AsyncSession, user: models.User) -> List[Dict[str, Any]]:
        """Lista contatos e grupos disponíveis no ProspectAI."""
        try:
            data = await self._make_request("GET", "/api/v1/integracao-atendai/destinations", db, user)
            if isinstance(data, list):
                return data
            if isinstance(data, dict):
                return data.get("destinations", [])
            return []
        except Exception:
            return [] # Retorna lista vazia em caso de erro para não quebrar o front

    async def send_notification(self, db: AsyncSession, user: models.User, destination_jid: str, message: str):
        """Envia uma notificação via ProspectAI."""
        payload = {
            "remoteJid": destination_jid,
            "text": message
        }
        return await self._make_request("POST", "/api/v1/integracao-atendai/send", db, user, json_data=payload)

    async def notify_atendente_if_needed(self, db: AsyncSession, user: models.User, atendimento: models.Atendimento, persona: models.Config, is_new_status: bool = False):
        """
        Verifica se a persona tem notificações ativas e envia via ProspectAI.
        """
        logger.info(f"ProspectService: Verificando necessidade de notificação para Atendimento {atendimento.id} (Persona: {persona.nome_config if persona else 'N/A'})")

        if not persona:
            logger.warning(f"ProspectService: Notificação pulada para Atendimento {atendimento.id} - Persona não fornecida.")
            return

        if not persona.notification_active:
            logger.info(f"ProspectService: Notificação desativada para a persona '{persona.nome_config}' (Atendimento {atendimento.id}).")
            return

        if not persona.notification_destination:
            logger.warning(f"ProspectService: Notificação ativa mas sem destino configurado para a persona '{persona.nome_config}' (Atendimento {atendimento.id}).")
            return

        title = "🚀 *Novo Chamado!*" if is_new_status else "📩 *Nova Mensagem (Pendente)*"
        message = f"{title}\n\n*Cliente:* {atendimento.nome_contato or atendimento.whatsapp}\n*WhatsApp:* {atendimento.whatsapp}\n"
        if atendimento.resumo:
            message += f"*Resumo:* {atendimento.resumo}\n"
        
        try:
            logger.info(f"ProspectService: Enviando notificação para {persona.notification_destination}...")
            await self.send_notification(db, user, persona.notification_destination, message)
            logger.info(f"ProspectAI: Notificação enviada com sucesso para {persona.notification_destination} (Atendimento {atendimento.id})")
        except Exception as e:
            logger.error(f"ProspectAI: Erro ao enviar notificação para {persona.notification_destination}: {e}")

_prospect_service = None
def get_prospect_service():
    global _prospect_service
    if _prospect_service is None:
        _prospect_service = ProspectService()
    return _prospect_service