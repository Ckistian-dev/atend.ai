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
    
    # 1. Obter os dados do request, APENAS os que foram enviados (exclude_unset=True)
    update_data = user_in.model_dump(exclude_unset=True)

    # 2. Iterar sobre os campos enviados e aplicá-los ao modelo do usuário
    #    Isso garante que APENAS os campos enviados sejam atualizados.
    for field, value in update_data.items():
        if hasattr(current_user, field):
            setattr(current_user, field, value)
            
    # 3. Salvar o objeto atualizado no banco de dados
    db.add(current_user)
    await db.commit()
    await db.refresh(current_user)
    
    return current_user