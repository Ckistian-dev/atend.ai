from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List

from app.db.database import get_db
from app.db import models, schemas
from app.crud import crud_user
from app.api.dependencies import get_current_active_superuser
from app.services.security import get_password_hash, encrypt_token

router = APIRouter()

@router.get("/users", response_model=List[schemas.User])
async def read_users(
    db: AsyncSession = Depends(get_db),
    skip: int = 0,
    limit: int = 100,
    current_user: models.User = Depends(get_current_active_superuser)
):
    """
    Retrieve all users. Only for superusers.
    """
    users = await crud_user.get_users(db, skip=skip, limit=limit)
    return users

@router.post("/users", response_model=schemas.User, status_code=status.HTTP_201_CREATED)
async def create_user_by_admin(
    user_in: schemas.UserCreateByAdmin,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_superuser)
):
    """
    Create a new user. Only for superusers.
    """
    db_user = await crud_user.get_user_by_email(db, email=user_in.email)
    if db_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered.",
        )
    
    user_data = user_in.model_dump(exclude_unset=True)
    # Garante que não tentamos salvar is_superuser no banco
    user_data.pop("is_superuser", None) 

    hashed_password = get_password_hash(user_data.pop("password"))

    new_user = models.User(
        hashed_password=hashed_password,
        **user_data
    )
    
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    
    return new_user

@router.put("/users/{user_id}", response_model=schemas.User)
async def update_user_by_admin(
    user_id: int,
    user_in: schemas.UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_superuser)
):
    """
    Update a user by ID. Only for superusers.
    """
    user_to_update = await crud_user.get_user(db, user_id=user_id)
    if not user_to_update:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    update_data = user_in.model_dump(exclude_unset=True)

    if "email" in update_data and update_data["email"] != user_to_update.email:
        existing_user = await crud_user.get_user_by_email(db, email=update_data["email"])
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Email already registered.",
            )

    # Garante que não tentamos salvar is_superuser no banco
    update_data.pop("is_superuser", None)

    if "password" in update_data:
        password = update_data.pop("password")
        if password:
            user_to_update.hashed_password = get_password_hash(password)

    for field, value in update_data.items():
        if hasattr(user_to_update, field):
            setattr(user_to_update, field, value)

    db.add(user_to_update)
    await db.commit()
    await db.refresh(user_to_update)
    return user_to_update

@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user_by_admin(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_superuser)
):
    """
    Delete a user by ID. Only for superusers.
    """
    if current_user.id == user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admins cannot delete themselves.")

    user_to_delete = await crud_user.get_user(db, user_id=user_id)
    if not user_to_delete:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    
    await db.delete(user_to_delete)
    await db.commit()
    return

@router.get("/users/{user_id}/configs", response_model=List[schemas.Config])
async def read_user_configs_by_admin(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_superuser)
):
    """
    Retrieve all configs for a specific user. Only for superusers.
    """
    result = await db.execute(select(models.Config).where(models.Config.user_id == user_id))
    configs = result.scalars().all()
    return configs

@router.get("/configs", response_model=List[schemas.Config])
async def read_all_configs(
    db: AsyncSession = Depends(get_db),
    skip: int = 0,
    limit: int = 1000,
    current_user: models.User = Depends(get_current_active_superuser)
):
    """
    Retrieve all configs from all users. Only for superusers.
    """
    result = await db.execute(select(models.Config).offset(skip).limit(limit))
    return result.scalars().all()