# app/core/config.py

from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List

class Settings(BaseSettings):
    """
    Configurações centralizadas da aplicação, carregadas de variáveis de ambiente.
    """
    # Configurações do Banco de Dados
    DATABASE_URL: str = "postgresql+asyncpg://user:password@host:port/db_name"

    # Configurações de Autenticação JWT
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 dias

    # Evolution API (seu serviço de WhatsApp)
    EVOLUTION_API_URL: str
    EVOLUTION_API_KEY: str

    # Google Gemini API - Carrega múltiplas chaves a partir de uma string separada por vírgula
    GOOGLE_API_KEYS: List[str]

    # URL Base para Webhooks (o endereço público da sua API)
    WEBHOOK_URL: str

    # Carrega as variáveis de um arquivo .env
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

# Instância única das configurações para ser usada em toda a aplicação
settings = Settings()