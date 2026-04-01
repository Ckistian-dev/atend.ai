import logging
import os
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from app.core.config import settings
from app.db import models

logger = logging.getLogger(__name__)

SCOPES = ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/calendar.events']

class GoogleCalendarService:
    def __init__(self, config: Optional[models.Config] = None):
        self.config = config
        self.flow: Optional[Flow] = None

    def _create_flow(self, redirect_uri_override: Optional[str] = None) -> Flow:
        redirect_uri = redirect_uri_override or f"{settings.FRONTEND_URL}/configs"
        
        client_config = {
            "web": {
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [redirect_uri],
            }
        }
        return Flow.from_client_config(client_config, scopes=SCOPES, redirect_uri=redirect_uri)

    def get_authorization_url(self, redirect_uri: str) -> str:
        self.flow = self._create_flow(redirect_uri_override=redirect_uri)
        # Usamos o oauth2session diretamente para evitar que a biblioteca Flow 
        # adicione automaticamente os parâmetros de PKCE (code_challenge), 
        # que causam erro em fluxos stateless.
        authorization_url, _ = self.flow.oauth2session.authorization_url(
            self.flow.client_config["auth_uri"],
            access_type='offline',
            prompt='consent',
            include_granted_scopes='true'
        )
        return authorization_url

    def fetch_token(self, code: str, redirect_uri: str) -> Dict[str, Any]:
        os.environ['OAUTHLIB_RELAX_TOKEN_SCOPE'] = '1'
        self.flow = self._create_flow(redirect_uri_override=redirect_uri)
        self.flow.fetch_token(code=code)
        credentials = self.flow.credentials
        return {
            'token': credentials.token,
            'refresh_token': credentials.refresh_token,
            'token_uri': credentials.token_uri,
            'client_id': credentials.client_id,
            'client_secret': credentials.client_secret,
            'scopes': credentials.scopes
        }

    def _get_credentials(self) -> Optional[Credentials]:
        if not self.config or not self.config.google_calendar_credentials:
            return None
        return Credentials.from_authorized_user_info(self.config.google_calendar_credentials, SCOPES)

    def get_service(self):
        credentials = self._get_credentials()
        if not credentials:
            raise Exception("Configuração não autenticada com o Google Calendar.")
        return build('calendar', 'v3', credentials=credentials)

    def get_upcoming_events(self, max_results: int = 50) -> List[Dict[str, Any]]:
        """Busca os próximos eventos agendados no calendário principal."""
        service = self.get_service()
        now = datetime.now(timezone.utc).isoformat()
        events_result = service.events().list(
            calendarId='primary',
            timeMin=now,
            maxResults=max_results,
            singleEvents=True,
            orderBy='startTime'
        ).execute()
        return events_result.get('items', [])

def get_google_calendar_service(config: models.Config) -> GoogleCalendarService:
    return GoogleCalendarService(config=config)