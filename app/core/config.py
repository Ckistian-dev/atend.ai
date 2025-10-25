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
    EVOLUTION_DATABASE_URL: str # URL do banco de dados da Evolution para buscar histórico
    WEBHOOK_URL: str # URL BASE PÚBLICA onde o AtendAI está rodando + /api/v1/webhook

    # --- Configurações da API Oficial (WhatsApp Business Platform) ---
    WBP_VERIFY_TOKEN: str # Token de verificação que VOCÊ CRIA para configurar o webhook na Meta
    WBP_WEBHOOK_URL: str # A URL COMPLETA do seu endpoint de webhook oficial (ex: https://seuapp.com/api/v1/webhook/official/webhook)

    # --- Configurações do Google OAuth & Criptografia ---
    GOOGLE_CLIENT_ID: str
    GOOGLE_CLIENT_SECRET: str
    GOOGLE_REDIRECT_URI: str # Ex: https://seuapp.com/api/v1/auth/google/callback
    ENCRYPTION_KEY: str      # Chave para criptografar tokens sensíveis (Google Refresh Token, WBP Access Token)

    # --- Configurações Adicionais ---
    FRONTEND_URL: str        # URL base do seu frontend (ex: https://app.atendai.com)
    GOOGLE_API_KEYS: str     # Chaves da API Gemini (separadas por vírgula)

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        # extra='ignore' # Para ignorar variáveis extras no .env, se necessário
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
if not settings.WEBHOOK_URL:
     raise ValueError("WEBHOOK_URL (URL base para webhooks) é obrigatória.")

