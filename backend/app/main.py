import logging
import logging.config # <<< NOVO IMPORT
import sys # <<< NOVO IMPORT (para direcionar handler)
from dotenv import load_dotenv

load_dotenv() # Carrega variáveis do arquivo .env para o ambiente

from fastapi import FastAPI, BackgroundTasks, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import engine, SessionLocal
from app.db import models
from app.core.config import settings

# Importação de todos os routers
from app.api.auth import router as auth_router
from app.api.configs import router as configs_router
from app.api.webhook import router as webhook_router
from app.api.dashboard import router as dashboard_router
from app.api.atendimentos import router as atendimentos_router
from app.api.agent import router as agent_router
from app.api.users import router as users_router
from app.api.admin import router as admin_router
from app.api.landingpage import router as landingpage_router

# --- CONFIGURAÇÃO DETALHADA DE LOGGING ---
LOGGING_CONFIG = {
    "version": 1,
    "disable_existing_loggers": False, # Importante para não silenciar libs
    "formatters": {
        "default": {
            "()": "uvicorn.logging.DefaultFormatter",
            "fmt": "%(levelprefix)s %(asctime)s [%(name)s] %(message)s",
            "datefmt": "%Y-%m-%d %H:%M:%S",
            "use_colors": True, # Cores no terminal
        },
        "access": {
            "()": "uvicorn.logging.AccessFormatter",
            "fmt": '%(levelprefix)s %(asctime)s [%(name)s] %(client_addr)s - "%(request_line)s" %(status_code)s',
            "datefmt": "%Y-%m-%d %H:%M:%S",
            "use_colors": True,
        },
        "file_default": { # Formato sem cores para arquivo
            "format": "%(levelname)s %(asctime)s [%(name)s:%(lineno)d] %(message)s",
            "datefmt": "%Y-%m-%d %H:%M:%S",
        },
    },
    "handlers": {
        "console": { # Handler para o terminal
            "formatter": "default",
            "class": "logging.StreamHandler",
            "stream": sys.stdout, # Envia para a saída padrão
        },
        "access_console": { # Handler específico para logs de acesso no terminal
             "formatter": "access",
             "class": "logging.StreamHandler",
             "stream": sys.stdout,
        },
        "file": { # Handler para arquivo rotativo
            "formatter": "file_default",
            "class": "logging.handlers.RotatingFileHandler",
            "filename": "app.log", # Nome do arquivo
            "maxBytes": 10 * 1024 * 1024,  # 10 MB
            "backupCount": 5, # Mantém 5 arquivos antigos
            "encoding": "utf-8",
        },
    },
    "loggers": {
        # Logger raiz: Pega tudo por padrão se não for especificado
        "": {
            "handlers": ["console", "file"],
            "level": "INFO", # Nível mais baixo para capturar tudo
        },
        # Logger da sua aplicação (todos os arquivos dentro de 'app')
        "app": {
            "handlers": ["console", "file"],
            "level": "INFO", # Mostra logs INFO ou superior da sua aplicação
            "propagate": False, # Não passa para o logger raiz (evita duplicar)
        },
        # Loggers do Uvicorn
        "uvicorn": {
            "handlers": ["console", "file"],
            "level": "INFO", # Nível padrão do Uvicorn
            "propagate": False,
        },
        "uvicorn.error": {
            "handlers": ["console", "file"],
            "level": "INFO",
            "propagate": False,
        },
        "uvicorn.access": {
            "handlers": ["access_console", "file"], # Usa handler/formatter específico p/ console
            "level": "INFO",
            "propagate": False, # ESSENCIAL: Não propagar para não usar o formatter default
        },
        # Logger do SQLAlchemy (mostra queries SQL)
        "sqlalchemy.engine": {
            "handlers": ["console", "file"],
            "level": "WARNING", # Mude para INFO para ver queries, DEBUG para muito detalhe
            "propagate": False,
        },
        # Logger do HTTPX (pode ser barulhento em DEBUG)
        "httpx": {
             "handlers": ["console", "file"],
             "level": "INFO", # Mude para DEBUG se precisar ver detalhes das requests HTTP
             "propagate": False,
        },
         # Logger específico para um módulo (exemplo, se precisar)
         "app.api.atendimentos": {
             "handlers": ["console", "file"],
             "level": "INFO", # Garante que INFO de atendimentos apareça
             "propagate": False,
         },
         "app.services.whatsapp_service": {
             "handlers": ["console", "file"],
             "level": "INFO", # Garante que INFO do service apareça
             "propagate": False,
         }
    },
}

# --- APLICA A CONFIGURAÇÃO DE LOGGING ---
logging.config.dictConfig(LOGGING_CONFIG)
# ----------------------------------------

# Obtém o logger para ESTE arquivo (main.py) APÓS a configuração
logger = logging.getLogger(__name__)

async def init_db():
    """
    Inicializa o banco de dados criando as tabelas definidas no SQLAlchemy
    caso elas ainda não existam.
    """
    try:
        async with engine.begin() as conn:
            await conn.run_sync(models.Base.metadata.create_all)
        logger.info("Inicialização do banco de dados concluída (tabelas verificadas/criadas).")
    except Exception as e:
        logger.error(f"Erro ao inicializar o banco de dados: {e}")
        raise e

app = FastAPI(
    title="API AtendAI",
    version="1.0.0",
    on_startup=[init_db],
)

# --- CONFIGURAÇÃO DE CORS MELHORADA ---
# Pega as URLs do frontend a partir das configurações, limpando espaços e removendo entradas vazias.
frontend_urls = {origin.strip() for origin in settings.FRONTEND_URL.split(',') if origin.strip()}

# Adiciona origens de desenvolvimento comuns para garantir que funcionem localmente.
dev_urls = {"http://localhost:5173", "http://localhost:3000"}

# Combina todas as URLs em uma lista final, sem duplicatas.
origins = list(frontend_urls.union(dev_urls))

logger.info(f"Configurando CORS para as origens: {origins}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- HANDLER GLOBAL DE ERROS ---
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Erro não tratado: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"message": "Erro interno do servidor", "detail": str(exc)},
    )

API_PREFIX = "/api/v1"

# Incluir todos os routers (igual)
app.include_router(auth_router, prefix=f"{API_PREFIX}/auth", tags=["Autenticação"])
app.include_router(configs_router, prefix=f"{API_PREFIX}/configs", tags=["Personas e Contexto"])
app.include_router(webhook_router, prefix=f"{API_PREFIX}/webhook", tags=["Webhook"])
app.include_router(dashboard_router, prefix=f"{API_PREFIX}/dashboard", tags=["Dashboard"])
app.include_router(atendimentos_router, prefix=f"{API_PREFIX}/atendimentos", tags=["Atendimentos"])
app.include_router(agent_router, prefix=f"{API_PREFIX}/agent", tags=["Agente"])
app.include_router(admin_router, prefix=f"{API_PREFIX}/admin", tags=["Admin"])
app.include_router(users_router, prefix=f"{API_PREFIX}/users", tags=["Utilizadores"])
app.include_router(landingpage_router, prefix=f"{API_PREFIX}/landingpage", tags=["Landing Page"])


@app.get("/", tags=["Root"])
def read_root():
    return {"message": "Bem-vindo à API do AtendAI"}

@app.get("/health", tags=["Health Check"])
def health_check():
    return {"status": "ok"}