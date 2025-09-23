# app/api/users.py

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.db import models
from app.db.schemas import User, UserUpdate
from app.crud import crud_user
from app.api.dependencies import get_current_active_user

router = APIRouter()

@router.put("/me", response_model=User, summary="Atualizar dados do usuário logado")
async def update_user_me(
    user_in: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user)
):
    """
    Permite que o usuário atualize suas próprias informações,
    como o nome da instância ou a persona padrão.
    """
    return await crud_user.update_user(db, db_user=current_user, user_in=user_in)