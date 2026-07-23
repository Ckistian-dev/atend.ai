# app/api/users.py

# 1. Importações nativas/padrão do Python
from typing import List

# 2. Importações de terceiros
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

# 3. Importações locais do projeto
from app.db.database import get_db
from app.db import models, schemas
from app.api.dependencies import get_current_active_user, get_current_active_admin
from app.services.user_service import UserService

router = APIRouter()


# Atualiza as informações básicas do perfil do próprio usuário autenticado
@router.put("/me", response_model=schemas.User, summary="Atualizar dados do usuário logado")
async def update_user_me(
    user_in: schemas.UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user)
):
    """
    Permite que o usuário logado atualize suas próprias informações cadastrais.
    """
    try:
        return await UserService.update_user_me(
            db=db,
            current_user=current_user,
            user_in=user_in
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# Retorna todos os usuários associados à empresa do usuário logado
@router.get("/", response_model=List[schemas.User], summary="Listar todos os usuários da empresa")
async def list_company_users(
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_admin)
):
    """
    Lista todos os usuários associados à empresa do administrador logado.
    """
    try:
        return await UserService.list_company_users(
            db=db,
            current_user=current_user
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# Cria um novo usuário vinculado à mesma empresa do administrador autenticado
@router.post("/", response_model=schemas.User, summary="Criar um novo usuário na empresa")
async def create_company_user(
    user_in: schemas.UserCreateByAdmin,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_admin)
):
    """
    Permite que um administrador crie novos usuários vinculados à sua empresa.
    """
    try:
        return await UserService.create_company_user(
            db=db,
            current_user=current_user,
            user_in=user_in
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Permite alterar dados de cadastro, nível de acesso ou permissões de outro usuário
@router.put("/{user_id}", response_model=schemas.User, summary="Atualizar um usuário da empresa")
async def update_company_user(
    user_id: int,
    user_in: schemas.UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_admin)
):
    """
    Permite que um administrador atualize credenciais e permissões de usuários sob sua gestão.
    """
    try:
        return await UserService.update_company_user(
            db=db,
            current_user=current_user,
            user_id=user_id,
            user_in=user_in
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# Exclui definitivamente um usuário da empresa do banco de dados
@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Excluir um usuário da empresa")
async def delete_company_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_admin)
):
    """
    Exclui um usuário da empresa. Impede que o administrador logado exclua a si mesmo.
    """
    try:
        await UserService.delete_company_user(
            db=db,
            current_user=current_user,
            user_id=user_id
        )
        return None
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))