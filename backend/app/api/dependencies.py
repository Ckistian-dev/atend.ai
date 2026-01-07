from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.db import models
from app.crud import crud_user
from app.core.config import settings
from app.services.security import get_current_user_token_data
from app.db.schemas import TokenData

async def get_current_user(
    token_data: TokenData = Depends(get_current_user_token_data),
    db: AsyncSession = Depends(get_db),
) -> models.User:
    # Verifica se é o superusuário do .env
    admin_email = settings.ADMIN_EMAIL
    if admin_email and token_data.email == admin_email:
        # Cria um usuário virtual em memória (não salvo no DB)
        user = models.User(id=0, email=admin_email, hashed_password="")
        # Atribui a flag de superusuário dinamicamente
        user.is_superuser = True
        return user

    user = await crud_user.get_user_by_email(db, email=token_data.email)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    return user

def get_current_active_user(
    current_user: models.User = Depends(get_current_user),
) -> models.User:
    # Placeholder for is_active check if you add it later
    return current_user

def get_current_active_superuser(
    current_user: models.User = Depends(get_current_active_user),
) -> models.User:
    """
    Dependency to get the current active user and check if they are a superuser.
    """
    # Usa getattr para evitar erro caso o atributo não exista no modelo do DB
    if not getattr(current_user, "is_superuser", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The user doesn't have enough privileges",
        )
    return current_user