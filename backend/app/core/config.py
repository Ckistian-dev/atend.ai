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
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7 # 1 semana

    # --- Configurações RabbitMQ ---
    RABBITMQ_URL: str
    RABBITMQ_WEBHOOK_QUEUE: str

    # --- Configurações da API Oficial (WhatsApp Business Platform) ---
    WBP_VERIFY_TOKEN: str # Token de verificação que VOCÊ CRIA para configurar o webhook na Meta
    WBP_WEBHOOK_URL: str # A URL COMPLETA do seu endpoint de webhook oficial (ex: https://seuapp.com/api/v1/webhook/official/webhook)

    ENCRYPTION_KEY: str      # Chave para criptografar tokens sensíveis (Google Refresh Token, WBP Access Token)

    # --- Configurações Adicionais ---
    FRONTEND_URL: str        # URL base do seu frontend (ex: https://app.atendai.com)
    
    GOOGLE_API_KEYS: str     # Chaves da API Gemini (separadas por vírgula)
    
    GOOGLE_SERVICE_ACCOUNT_JSON: str

    MAX_MESSAGE_AGE_SECONDS: int = 300 # Tempo (s) para ignorar webhooks antigos na fila. Padrão: 5 minutos.
    
    ADMIN_EMAIL: str
    ADMIN_PASSWORD: str
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra='ignore' # Para ignorar variáveis extras no .env, se necessário
    )

# Instância única das configurações para ser usada em toda a aplicação
settings = Settings()

# Validação adicional (opcional, mas recomendada)
if not settings.ENCRYPTION_KEY or len(settings.ENCRYPTION_KEY) < 32:
     raise ValueError("ENCRYPTION_KEY é obrigatória e deve ter pelo menos 32 bytes.")
if not settings.WBP_VERIFY_TOKEN:
     raise ValueError("WBP_VERIFY_TOKEN é obrigatório para a API Oficial.")
if not settings.WBP_WEBHOOK_URL:
     raise ValueError("WBP_WEBHOOK_URL é obrigatório para a API Oficial.")
