# app/db/database.py

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from app.core.config import settings
from urllib.parse import urlparse, quote, urlunparse

# 1. Pega a URL original do ambiente
database_url = settings.DATABASE_URL

# 3. Verifica se a URL é de postgres e ainda não tem o driver asyncpg
if database_url and database_url.startswith("postgresql://"):
    # 4. Substitui o protocolo para incluir o driver assíncrono
    database_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)

engine = create_async_engine(
    database_url, # Usa a URL modificada
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

async def get_db():
    """
    Dependência do FastAPI que cria e fecha uma sessão de banco de dados
    para cada requisição.
    """
    async with SessionLocal() as session:
        yield session