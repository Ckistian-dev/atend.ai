from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.db import models
from app.db.schemas import UserCreate, UserUpdate
from app.services.security import get_password_hash, encrypt_token, decrypt_token # Importar encrypt/decrypt
import logging
from typing import Optional # Importar Optional

logger = logging.getLogger(__name__)

async def get_user(db: AsyncSession, user_id: int) -> models.User | None:
    """Busca um utilizador pelo seu ID."""
    return await db.get(models.User, user_id)

async def get_user_by_email(db: AsyncSession, email: str) -> models.User | None:
    """Busca um utilizador pelo seu endereço de e-mail."""
    result = await db.execute(select(models.User).filter(models.User.email == email))
    return result.scalars().first()

async def get_user_by_instance(db: AsyncSession, instance_name: str) -> models.User | None:
    """Busca um utilizador pelo nome da sua instância do WhatsApp (Evolution)."""
    result = await db.execute(select(models.User).where(models.User.instance_name == instance_name))
    return result.scalars().first()

# --- NOVO ---
async def get_user_by_wbp_phone_number_id(db: AsyncSession, phone_number_id: str) -> Optional[models.User]:
    """Busca um utilizador pelo ID do número de telefone da API Oficial."""
    if not phone_number_id:
        return None
    result = await db.execute(
        select(models.User).where(models.User.wbp_phone_number_id == phone_number_id)
    )
    return result.scalars().first()
# -----------

async def create_user(db: AsyncSession, user: UserCreate) -> models.User:
    """Cria um novo utilizador no banco de dados com senha hasheada."""
    hashed_password = get_password_hash(user.password)
    # A lógica para criar um utilizador foi simplificada, assumindo que não é criada pela API pública
    # --- ALTERADO: Incluir api_type default (se necessário, ou deixar o default do model) ---
    db_user = models.User(
        email=user.email,
        hashed_password=hashed_password,
        api_type=models.ApiType.evolution # Define Evolution como padrão na criação
    )
    db.add(db_user)
    # --- REMOVIDO Commit e Refresh daqui, será feito na rota ---
    # await db.commit()
    # await db.refresh(db_user)
    return db_user # Retorna o objeto antes do commit

# --- ALTERADO: update_user para criptografar tokens ---
async def update_user(db: AsyncSession, db_user: models.User, user_in: UserUpdate) -> models.User:
    """Atualiza os dados de um utilizador existente, criptografando tokens sensíveis."""
    update_data = user_in.model_dump(exclude_unset=True)

    # Criptografa tokens antes de salvar
    if "google_refresh_token" in update_data and update_data["google_refresh_token"]:
        try:
            update_data["google_refresh_token"] = encrypt_token(update_data["google_refresh_token"])
        except ValueError as e: # Captura erro se ENCRYPTION_KEY não estiver configurada
             logger.error(f"Erro ao criptografar google_refresh_token para user {db_user.id}: {e}")
             # Decide se quer lançar uma exceção ou apenas logar e não salvar o token
             del update_data["google_refresh_token"] # Não salva o token se não puder criptografar

    if "wbp_access_token" in update_data and update_data["wbp_access_token"]:
        try:
            update_data["wbp_access_token"] = encrypt_token(update_data["wbp_access_token"])
            logger.info(f"Token WBP criptografado para user {db_user.id}.")
        except ValueError as e:
             logger.error(f"Erro ao criptografar wbp_access_token para user {db_user.id}: {e}")
             del update_data["wbp_access_token"]

    for key, value in update_data.items():
        setattr(db_user, key, value)

    db.add(db_user)
    # --- REMOVIDO Commit e Refresh daqui, será feito na rota ---
    return db_user # Retorna o objeto antes do commit
# --------------------------------------------------------

async def decrement_user_tokens(db: AsyncSession, db_user: models.User, amount: int = 1):
    """Diminui os tokens de um utilizador pela quantidade especificada."""
    if db_user.tokens is not None and db_user.tokens >= amount:
        db_user.tokens -= amount
        # --- REMOVIDO Commit e Refresh daqui, será feito no final da operação maior ---
        # await db.commit()
        # await db.refresh(db_user)
        logger.info(f"DEBUG: {amount} token(s) deduzido(s) do utilizador {db_user.id}. Restantes: {db_user.tokens}")
        db.add(db_user) # Adiciona ao estado da sessão para ser commitado depois
    else:
        logger.warning(f"Utilizador {db_user.id} não possui tokens suficientes para deduzir {amount} token(s).")
