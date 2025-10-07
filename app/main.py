from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging

from app.db.database import engine
from app.db import models

# Importação de todos os routers
from app.api.auth import router as auth_router
from app.api.configs import router as configs_router
from app.api.whatsapp import router as whatsapp_router
from app.api.webhook import router as webhook_router
from app.api.dashboard import router as dashboard_router
from app.api.atendimentos import router as atendimentos_router
from app.api.agent import router as agent_router
from app.api.users import router as users_router

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

async def create_db_and_tables():
    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)
    logging.info("Tabelas do banco de dados verificadas/criadas.")

app = FastAPI(
    title="API AtendAI",
    version="1.0.0",
    on_startup=[create_db_and_tables]
)

# --- ALTERAÇÃO AQUI ---
# Define explicitamente quais domínios (origins) podem acessar sua API.
origins = [
    "https://atend-ai-ckistian-prog-solucoes.vercel.app", "http://localhost:5173" # Seu frontend em produção
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins, # Substituímos o "*" pela lista de origens permitidas
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# --- FIM DA ALTERAÇÃO ---


API_PREFIX = "/api/v1"

# Verifique se todas estas linhas estão presentes e corretas
app.include_router(auth_router, prefix=f"{API_PREFIX}/auth", tags=["Autenticação"])
app.include_router(configs_router, prefix=f"{API_PREFIX}/configs", tags=["Personas e Contexto"])
app.include_router(whatsapp_router, prefix=f"{API_PREFIX}/whatsapp", tags=["WhatsApp"])
app.include_router(webhook_router, prefix=f"{API_PREFIX}/webhook", tags=["Webhook"])
app.include_router(dashboard_router, prefix=f"{API_PREFIX}/dashboard", tags=["Dashboard"])
app.include_router(atendimentos_router, prefix=f"{API_PREFIX}/atendimentos", tags=["Atendimentos"])
app.include_router(agent_router, prefix=f"{API_PREFIX}/agent", tags=["Agente"])
app.include_router(users_router, prefix=f"{API_PREFIX}/users", tags=["Utilizadores"])

@app.get("/", tags=["Root"])
def read_root():
    return {"message": "Bem-vindo à API do AtendAI"}