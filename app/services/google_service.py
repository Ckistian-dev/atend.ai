import logging
import asyncio
from typing import Optional

from googleapiclient.discovery import build, Resource
from googleapiclient.errors import HttpError
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from google.auth.transport.requests import Request

from app.db import models
from app.core.config import settings
from app.services.security import decrypt_token

logger = logging.getLogger(__name__)

# Escopos de permissão: Vamos apenas gerenciar contatos.
SCOPES = ['https://www.googleapis.com/auth/contacts']

def _get_google_flow() -> Flow:
    """Função interna síncrona para criar uma instância do fluxo OAuth do Google."""
    return Flow.from_client_config(
        client_config={
            "web": {
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [settings.GOOGLE_REDIRECT_URI],
            }
        },
        scopes=SCOPES,
        redirect_uri=settings.GOOGLE_REDIRECT_URI
    )

async def generate_google_auth_url(state: str) -> str:
    """
    (Async) Gera a URL para onde o usuário será redirecionado para autorizar.
    """
    def _sync_generate_url():
        flow = _get_google_flow()
        # --- CORREÇÃO AQUI: Passamos o 'state' para o Google ---
        auth_url, _ = flow.authorization_url(
            access_type='offline',
            prompt='consent',
            state=state  # Garante que o Google nos devolva o estado
        )
        return auth_url
    
    return await asyncio.to_thread(_sync_generate_url)

async def get_refresh_token_from_code(code: str) -> str:
    """
    (Async) Troca o código de autorização por um refresh_token.
    """
    def _sync_fetch_token():
        try:
            flow = _get_google_flow()
            flow.fetch_token(code=code)
            
            credentials = flow.credentials
            if not credentials or not credentials.refresh_token:
                logger.warning("Google não retornou um refresh_token. O usuário já pode ter autorizado este app anteriormente.")
                raise ValueError("Não foi possível obter o refresh_token do Google. Tente remover o acesso do app na sua conta Google e conectar novamente.")
                
            return credentials.refresh_token
        except Exception as e:
            logger.error(f"Erro ao trocar código por refresh token (sync): {e}", exc_info=True)
            raise
    
    return await asyncio.to_thread(_sync_fetch_token)

async def get_google_service_from_user(user: models.User) -> Optional[Resource]:
    """
    (Async) Cria um 'service' da API do Google autenticado para um usuário.
    """
    if not user.google_refresh_token:
        logger.warning(f"Usuário {user.id} tentou usar o serviço Google sem um refresh_token.")
        return None
        
    def _sync_build_service():
        try:
            refresh_token = decrypt_token(user.google_refresh_token)
            
            credentials = Credentials(
                token=None,
                refresh_token=refresh_token,
                token_uri="https://oauth2.googleapis.com/token",
                client_id=settings.GOOGLE_CLIENT_ID,
                client_secret=settings.GOOGLE_CLIENT_SECRET,
                scopes=SCOPES
            )
            
            if credentials.expired and credentials.refresh_token:
                credentials.refresh(Request())
            
            return build('people', 'v1', credentials=credentials, static_discovery=False)
            
        except Exception as e:
            logger.error(f"Erro ao construir serviço Google para usuário {user.id} (sync): {e}", exc_info=True)
            return None

    return await asyncio.to_thread(_sync_build_service)

async def create_google_contact(service: Resource, number: str, name: str) -> bool:
    """
    (Async) Cria um contato na conta Google do usuário.
    """
    def _sync_create_contact():
        if not number.startswith('+'):
            formatted_number = f"+{number}"
        else:
            formatted_number = number

        partes_nome = name.split(' ', 1)
        primeiro_nome = partes_nome[0]
        sobrenome = partes_nome[1] if len(partes_nome) > 1 else ""

        contact_body = {
            'names': [{'givenName': primeiro_nome, 'familyName': sobrenome}],
            'phoneNumbers': [{'value': formatted_number, 'type': 'mobile'}]
        }
        
        try:
            service.people().createContact(body=contact_body).execute()
            logger.info(f"Contato '{name}' ({formatted_number}) criado com sucesso no Google.")
            return True
        except HttpError as e:
            logger.error(f"Erro da API do Google ao criar contato '{name}': {e.status_code} - {e.reason}")
            return False
        except Exception as e:
            logger.error(f"Erro inesperado ao criar contato Google '{name}' (sync): {e}", exc_info=True)
            return False
            
    return await asyncio.to_thread(_sync_create_contact)

