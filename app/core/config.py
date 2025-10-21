from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List

class Settings(BaseSettings):
    """
    Configurações centralizadas da aplicação, carregadas de variáveis de ambiente.
    """
    # --- Configurações Principais ---
    DATABASE_URL: str
    SECRET_KEY: str # Usada para assinar os tokens JWT
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7 # 1 semana

    # --- Configurações da Evolution API ---
    EVOLUTION_API_URL: str
    EVOLUTION_API_KEY: str
    EVOLUTION_DATABASE_URL: str
    WEBHOOK_URL: str

    # --- Configurações do Google OAuth & Criptografia ---
    GOOGLE_CLIENT_ID: str
    GOOGLE_CLIENT_SECRET: str
    GOOGLE_REDIRECT_URI: str # Ex: http://localhost:8000/api/v1/auth/google/callback
    ENCRYPTION_KEY: str      # Chave para criptografar os refresh_tokens no BD
    
    # --- NOVA CONFIGURAÇÃO ---
    # URL base do seu frontend para o redirecionamento do OAuth
    FRONTEND_URL: str        # Ex: http://localhost:3000

    # Chave de API para serviços Gemini
    GOOGLE_API_KEYS: str

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8"
    )

# Instância única das configurações para ser usada em toda a aplicação
settings = Settings()

