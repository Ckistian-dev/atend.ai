# app/core/config.py

from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List

class Settings(BaseSettings):
    """
    Configurações centralizadas da aplicação, carregadas de variáveis de ambiente.
    """
    DATABASE_URL: str
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7
    EVOLUTION_API_URL: str
    EVOLUTION_API_KEY: str
    EVOLUTION_DATABASE_URL: str
    WEBHOOK_URL: str

    # Alterado de List[str] para simplesmente str
    GOOGLE_API_KEYS: str

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8"
    )

# Instância única das configurações para ser usada em toda a aplicação
settings = Settings()