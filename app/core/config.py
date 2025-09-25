# app/core/config.py

from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List

class Settings(BaseSettings):
    """
    Configurações centralizadas da aplicação, carregadas de variáveis de ambiente.
    """
    # ... (other settings like DATABASE_URL, SECRET_KEY, etc.)
    DATABASE_URL: str
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7
    EVOLUTION_API_URL: str
    EVOLUTION_API_KEY: str
    WEBHOOK_URL: str

    # Google Gemini API - Carrega múltiplas chaves a partir de uma string separada por vírgula
    GOOGLE_API_KEYS: List[str]

    # Carrega as variáveis de um arquivo .env e habilita a conversão de strings com vírgula para listas
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_nested_delimiter='__',
        env_separator=','
    )

# Instância única das configurações para ser usada em toda a aplicação
settings = Settings()