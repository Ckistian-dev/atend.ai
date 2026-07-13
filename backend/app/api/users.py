# app/api/users.py

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import joinedload
from typing import List

from app.db.database import get_db
from app.db import models
from app.db.schemas import User, UserUpdate, UserCreateByAdmin
from app.crud import crud_user
from app.api.dependencies import get_current_active_user, get_current_active_admin
from app.services import security

router = APIRouter()

@router.put("/me", response_model=User, summary="Atualizar dados do usuário logado")
async def update_user_me(
    user_in: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user)
):
    """
    Permite que o usuário atualize suas próprias informações.
    """
    update_data = user_in.model_dump(exclude_unset=True)

    # Não permite atualizar permissões ou role de si mesmo através desta rota
    for blocked in ("permissions", "role", "company_id", "atendente_online"):
        update_data.pop(blocked, None)

    # Update company-level followup settings if user is admin/superuser
    has_followup_updates = "followup_active" in update_data or "followup_config" in update_data
    if has_followup_updates:
        followup_active = update_data.pop("followup_active", None)
        followup_config = update_data.pop("followup_config", None)
        if current_user.company_id and (current_user.role == "admin" or getattr(current_user, "is_superuser", False)):
            company = await db.get(models.Company, current_user.company_id)
            if company:
                if followup_active is not None:
                    company.followup_active = followup_active
                if followup_config is not None:
                    company.followup_config = followup_config
                db.add(company)

    if "password" in update_data and update_data["password"]:
        current_user.hashed_password = security.get_password_hash(update_data["password"])
        del update_data["password"]

    for field, value in update_data.items():
        if hasattr(current_user, field):
            setattr(current_user, field, value)
            
    db.add(current_user)
    await db.commit()
    
    # Reload user with company relationship to ensure fresh serialized data
    stmt = select(models.User).where(models.User.id == current_user.id).options(joinedload(models.User.company))
    res = await db.execute(stmt)
    current_user = res.scalars().first()
    
    return current_user

@router.get("/", response_model=List[User], summary="Listar todos os usuários da empresa")
async def list_company_users(
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_admin)
):
    """
    Lista todos os usuários associados à empresa do administrador logado.
    """
    stmt = select(models.User)
    if not getattr(current_user, "is_superuser", False):
        stmt = stmt.where(models.User.company_id == current_user.company_id)
    
    result = await db.execute(stmt)
    return result.scalars().all()

@router.post("/", response_model=User, summary="Criar um novo usuário na empresa")
async def create_company_user(
    user_in: UserCreateByAdmin,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_admin)
):
    """
    Permite que um administrador crie novos usuários vinculados à sua empresa.
    """
    # Verifica se o e-mail já existe
    existing_user = await crud_user.get_user_by_email(db, email=user_in.email)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email já cadastrado."
        )

    company_id = current_user.company_id
    if getattr(current_user, "is_superuser", False) and user_in.company_id:
        company_id = user_in.company_id

    hashed_password = security.get_password_hash(user_in.password)

    db_user = models.User(
        email=user_in.email,
        name=user_in.name,
        hashed_password=hashed_password,
        role=user_in.role or "user",
        company_id=company_id,
        permissions=user_in.permissions,
        participates_distribution=user_in.participates_distribution or False,
        profile_color=user_in.profile_color or "#3b82f6"
    )
    db.add(db_user)
    await db.commit()
    await db.refresh(db_user)
    return db_user

@router.put("/{user_id}", response_model=User, summary="Atualizar um usuário da empresa")
async def update_company_user(
    user_id: int,
    user_in: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_admin)
):
    """
    Permite que um administrador atualize credenciais e permissões de usuários.
    """
    stmt = select(models.User).where(models.User.id == user_id)
    if not getattr(current_user, "is_superuser", False):
        stmt = stmt.where(models.User.company_id == current_user.company_id)
    
    result = await db.execute(stmt)
    db_user = result.scalar_one_or_none()
    if not db_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuário não encontrado."
        )

    # Superusers podem mudar qualquer campo, admins da empresa não podem alterar company_id
    update_data = user_in.model_dump(exclude_unset=True)
    if not getattr(current_user, "is_superuser", False) and "company_id" in update_data:
        del update_data["company_id"]

    if "password" in update_data and update_data["password"]:
        db_user.hashed_password = security.get_password_hash(update_data["password"])
        del update_data["password"]

    for field, value in update_data.items():
        if hasattr(db_user, field):
            setattr(db_user, field, value)

    db.add(db_user)
    await db.commit()
    await db.refresh(db_user)
    return db_user

@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Excluir um usuário da empresa")
async def delete_company_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_admin)
):
    """
    Exclui um usuário da empresa. Impede que o usuário logado exclua a si mesmo.
    """
    if current_user.id == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Você não pode excluir a si mesmo."
        )

    stmt = select(models.User).where(models.User.id == user_id)
    if not getattr(current_user, "is_superuser", False):
        stmt = stmt.where(models.User.company_id == current_user.company_id)
    
    result = await db.execute(stmt)
    db_user = result.scalar_one_or_none()
    if not db_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuário não encontrado."
        )

    await db.delete(db_user)
    await db.commit()
    return None