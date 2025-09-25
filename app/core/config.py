# app/core/config.py

from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator
from typing import List, Any

class Settings(BaseSettings):
    """
    Configurações centralizadas da aplicação, carregadas de variáveis de ambiente.
    """
    # ... (suas outras configurações como DATABASE_URL, etc.)
    DATABASE_URL: str
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7
    EVOLUTION_API_URL: str
    EVOLUTION_API_KEY: str
    WEBHOOK_URL: str

    # O campo continua sendo uma Lista de strings...
    GOOGLE_API_KEYS: List[str]

    # ...mas agora usamos um validador para processar a entrada.
    @field_validator('GOOGLE_API_KEYS', mode='before')
    @classmethod
    def split_google_api_keys(cls, v: Any) -> List[str]:
        """
        Este validador pega a string do ambiente e a converte em uma lista.
        """
        if isinstance(v, str):
            # Filtra chaves vazias caso haja vírgulas extras (ex: "key1,key2,")
            return [item.strip() for item in v.split(',') if item.strip()]
        # Se já for uma lista (em algum outro contexto), apenas a retorna.
        return v

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8"
    )

# Instância única das configurações para ser usada em toda a aplicação
settings = Settings()