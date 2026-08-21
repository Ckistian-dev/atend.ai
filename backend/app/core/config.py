from pydantic_settings import BaseSettings, SettingsConfigDict
import os
from typing import Optional

class Settings(BaseSettings):
    """
    Configurações centralizadas da aplicação, carregadas de variáveis de ambiente.
    """
    # --- Configurações Principais ---
    DATABASE_URL: str
    SECRET_KEY: str # Usada para assinar os tokens JWT
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 31 # 1 Mês

    # --- Configurações RabbitMQ ---
    RABBITMQ_URL: str = "amqp://guest:guest@rabbitmq:5672/"
    RABBITMQ_WEBHOOK_QUEUE: str = "webhook_queue"

    # --- Configurações da API Oficial (WhatsApp Business Platform) ---
    WBP_VERIFY_TOKEN: Optional[str] = "default_verify_token"
    WBP_WEBHOOK_URL: Optional[str] = "http://localhost:8000/api/v1/webhook"
    WBP_ACCESS_TOKEN: Optional[str] = None

    ENCRYPTION_KEY: Optional[str] = None      # Chave para criptografar tokens sensíveis (Google Refresh Token, WBP Access Token)

    # --- Configurações Adicionais ---
    ENVIRONMENT: str = "production"   # 'development' ou 'production'
    FRONTEND_URL: Optional[str] = "http://localhost:5173"        # URL base do seu frontend (ex: https://app.atendai.com)
    
    GOOGLE_API_KEYS: Optional[str] = None     # Chaves da API Gemini (separadas por vírgula)
    
    GOOGLE_SERVICE_ACCOUNT_JSON: Optional[str] = None

    GOOGLE_CLIENT_ID: Optional[str] = None

    GOOGLE_CLIENT_SECRET: Optional[str] = None

    MAX_MESSAGE_AGE_SECONDS: int = 300 # Tempo (s) para ignorar webhooks antigos na fila. Padrão: 5 minutos.
    
    ADMIN_EMAIL: Optional[str] = "admin@atendai.com"
    ADMIN_PASSWORD: Optional[str] = "admin123"
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra='ignore' # Para ignorar variáveis extras no .env, se necessário
    )

# Instância única das configurações para ser usada em toda a aplicação
settings = Settings()

# Validação adicional
if not settings.ENCRYPTION_KEY or len(settings.ENCRYPTION_KEY) < 32:
    # Chave padrão de desenvolvimento se não fornecida
    settings.ENCRYPTION_KEY = settings.ENCRYPTION_KEY or "0123456789abcdef0123456789abcdef"

