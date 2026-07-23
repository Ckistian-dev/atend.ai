# app/api/admin.py

# 1. Importações nativas/padrão do Python
import logging
from typing import List

# 2. Importações de terceiros
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

# 3. Importações locais do projeto
from app.db.database import get_db
from app.db import models, schemas
from app.api.dependencies import get_current_active_superuser
from app.services.admin_service import AdminService

logger = logging.getLogger(__name__)
router = APIRouter()


# Retorna todos os usuários registrados no sistema com suporte a paginação
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
    try:
        return await AdminService.read_users(db=db, skip=skip, limit=limit)
    except Exception as e:
        logger.error(f"Erro ao ler usuários: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Erro ao obter lista de usuários.")


# Cria um novo usuário com senha criptografada sem restrição de tenant/empresa
@router.post("/users", response_model=schemas.User, status_code=status.HTTP_201_CREATED)
async def create_user_by_admin(
    user_in: schemas.UserCreateByAdmin,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_superuser)
):
    """
    Create a new user. Only for superusers.
    """
    try:
        return await AdminService.create_user_by_admin(db=db, user_in=user_in)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except Exception as e:
        logger.error(f"Erro ao criar usuário por admin: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Erro ao criar novo usuário.")


# Atualiza dados de qualquer usuário pelo ID no banco de dados
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
    try:
        return await AdminService.update_user_by_admin(db=db, user_id=user_id, user_in=user_in)
    except LookupError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except Exception as e:
        logger.error(f"Erro ao atualizar usuário {user_id} por admin: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Erro ao atualizar dados do usuário.")


# Deleta permanentemente qualquer usuário pelo ID do banco de dados
@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user_by_admin(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_superuser)
):
    """
    Delete a user by ID. Only for superusers.
    """
    try:
        await AdminService.delete_user_by_admin(db=db, user_id=user_id, current_user=current_user)
        return
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except LookupError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        logger.error(f"Erro ao excluir usuário {user_id} por admin: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Erro ao remover usuário.")


# Lista todas as personas configuradas para a empresa associada a um usuário específico
@router.get("/users/{user_id}/configs", response_model=List[schemas.Config])
async def read_user_configs_by_admin(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_superuser)
):
    """
    Retrieve all configs for a specific user. Only for superusers.
    """
    try:
        return await AdminService.read_user_configs_by_admin(db=db, user_id=user_id)
    except Exception as e:
        logger.error(f"Erro ao obter configs do usuário {user_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Erro ao recuperar configurações do usuário.")


# Lista todas as personas (Configurações) salvas no banco de dados geral
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
    try:
        return await AdminService.read_all_configs(db=db, skip=skip, limit=limit)
    except Exception as e:
        logger.error(f"Erro ao ler todas as configs: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Erro ao obter lista de configurações do sistema.")


# Lista todas as empresas (tenants) cadastradas na plataforma
@router.get("/companies", response_model=List[schemas.Company])
async def read_companies(
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_superuser)
):
    """
    List all companies. Only for superusers.
    """
    try:
        return await AdminService.read_companies(db=db)
    except Exception as e:
        logger.error(f"Erro ao listar empresas: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Erro ao recuperar lista de empresas.")


# Cria uma nova empresa (tenant) na plataforma com suas próprias credenciais e limites
@router.post("/companies", response_model=schemas.Company, status_code=status.HTTP_201_CREATED)
async def create_company(
    company_in: schemas.CompanyCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_superuser)
):
    """
    Create a new company. Only for superusers.
    """
    try:
        return await AdminService.create_company(db=db, company_in=company_in)
    except Exception as e:
        logger.error(f"Erro ao criar empresa: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Erro ao criar nova empresa.")


# Atualiza as credenciais ou configurações de uma empresa cadastrada pelo ID
@router.put("/companies/{company_id}", response_model=schemas.Company)
async def update_company(
    company_id: int,
    company_in: schemas.CompanyUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_superuser)
):
    """
    Update a company. Only for superusers.
    """
    try:
        return await AdminService.update_company(db=db, company_id=company_id, company_in=company_in)
    except LookupError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        logger.error(f"Erro ao atualizar empresa {company_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Erro ao atualizar dados da empresa.")


# Deleta permanentemente uma empresa cadastrada pelo ID no banco de dados
@router.delete("/companies/{company_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_company(
    company_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_superuser)
):
    """
    Delete a company. Only for superusers.
    """
    try:
        await AdminService.delete_company(db=db, company_id=company_id)
        return
    except LookupError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        logger.error(f"Erro ao deletar empresa {company_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Erro ao excluir empresa.")


# Lista todas as personas configuradas para uma determinada empresa identificada pelo ID
@router.get("/companies/{company_id}/configs", response_model=List[schemas.Config])
async def read_company_configs_by_admin(
    company_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_superuser)
):
    """
    List all configs for a specific company. Only for superusers.
    """
    try:
        return await AdminService.read_company_configs_by_admin(db=db, company_id=company_id)
    except Exception as e:
        logger.error(f"Erro ao listar configs da empresa {company_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Erro ao obter configurações da empresa.")