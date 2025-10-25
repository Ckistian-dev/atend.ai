from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging

from app.db.database import engine
from app.db import models
from app.core.config import settings # Importar settings para usar a lista de origins

# Importação de todos os routers
from app.api.auth import router as auth_router
from app.api.configs import router as configs_router
from app.api.whatsapp import router as whatsapp_router
from app.api.webhook import router as webhook_router # Este router agora contém os dois webhooks
from app.api.dashboard import router as dashboard_router
from app.api.atendimentos import router as atendimentos_router
from app.api.agent import router as agent_router
from app.api.users import router as users_router
from app.services.whatsapp_service import get_whatsapp_service # Para fechar conexão no shutdown

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__) # Logger para o main

async def create_db_and_tables():
    async with engine.begin() as conn:
        # --- ALTERADO: Usar try-except para logar erro se a criação falhar ---
        try:
            # await conn.run_sync(models.Base.metadata.drop_all) # Descomentar para resetar DB em dev
            await conn.run_sync(models.Base.metadata.create_all)
            logger.info("Tabelas do banco de dados verificadas/criadas com sucesso.")
        except Exception as e:
            logger.error(f"ERRO CRÍTICO ao criar tabelas do banco de dados: {e}", exc_info=True)
            # Considerar parar a aplicação aqui se o DB for essencial para o startup
            raise # Re-lança a exceção para parar o FastAPI

# --- NOVO: Função para fechar conexão do DB Evolution no shutdown ---
async def close_evolution_db():
    whatsapp_service = get_whatsapp_service()
    await whatsapp_service.close_db_connection()
# -------------------------------------------------------------

app = FastAPI(
    title="API AtendAI",
    version="1.0.0",
    # --- ALTERADO: Adicionar evento de shutdown ---
    on_startup=[create_db_and_tables],
    on_shutdown=[close_evolution_db] # Garante que as conexões sejam fechadas
)

# Configuração CORS (usando settings)
# --- ALTERADO: Ler origins da config, split por vírgula ---
origins = [origin.strip() for origin in settings.FRONTEND_URL.split(',') if origin.strip()]
# Adicionar outras origens se necessário, como localhost para desenvolvimento
if "localhost" not in settings.FRONTEND_URL:
     # Permitir localhost:5173 (Vite default) e localhost:3000 (React default) se não estiverem na config
     origins.append("http://localhost:5173")
     origins.append("http://localhost:3000")

logger.info(f"Configurando CORS para as origens: {origins}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# --------------------------------------------------------


API_PREFIX = "/api/v1"

# Incluir todos os routers
app.include_router(auth_router, prefix=f"{API_PREFIX}/auth", tags=["Autenticação"])
app.include_router(configs_router, prefix=f"{API_PREFIX}/configs", tags=["Personas e Contexto"])
app.include_router(whatsapp_router, prefix=f"{API_PREFIX}/whatsapp", tags=["WhatsApp (Conexão e Config)"]) # Tag ajustada
# --- ALTERADO: O webhook_router agora serve ambos os webhooks ---
app.include_router(webhook_router, prefix=f"{API_PREFIX}/webhook", tags=["Webhook (Evolution & Oficial)"])
# -------------------------------------------------------------
app.include_router(dashboard_router, prefix=f"{API_PREFIX}/dashboard", tags=["Dashboard"])
app.include_router(atendimentos_router, prefix=f"{API_PREFIX}/atendimentos", tags=["Atendimentos"])
app.include_router(agent_router, prefix=f"{API_PREFIX}/agent", tags=["Agente"])
app.include_router(users_router, prefix=f"{API_PREFIX}/users", tags=["Utilizadores"]) # Manter se tiver rotas de usuário

@app.get("/", tags=["Root"])
def read_root():
    return {"message": "Bem-vindo à API do AtendAI"}

# --- Opcional: Adicionar um health check endpoint ---
@app.get("/health", tags=["Health Check"])
def health_check():
    return {"status": "ok"}
# ----------------------------------------------------
