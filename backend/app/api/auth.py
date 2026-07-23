# app/api/auth.py

# 1. Importações nativas/padrão do Python
import logging
from typing import Annotated

# 2. Importações de terceiros
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession

# 3. Importações locais do projeto
from app.db.database import get_db
from app.db import models, schemas
from app.api.dependencies import get_current_active_user
from app.services.auth_service import AuthService

router = APIRouter()
logger = logging.getLogger(__name__)


# Realiza o fluxo de autenticação e retorna um token JWT para acessos subsequentes
@router.post("/token", response_model=schemas.Token)
async def login_for_access_token(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: AsyncSession = Depends(get_db)
):
    """
    Autentica o utilizador e retorna um token de acesso JWT.
    """
    try:
        return await AuthService.login_for_access_token(
            db=db,
            username=form_data.username,
            password=form_data.password
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(e),
        )
    except PermissionError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
            headers={"WWW-Authenticate": "Bearer"},
        )
    except Exception as e:
        logger.error(f"Erro inesperado no login: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Erro interno no servidor de autenticação."
        )


# Retorna as informações cadastrais e permissões do usuário logado baseado no token de autorização
@router.get("/me", response_model=schemas.User, summary="Obter dados do utilizador logado")
async def read_users_me(current_user: models.User = Depends(get_current_active_user)):
    """
    Retorna os detalhes completos do utilizador atualmente autenticado.
    """
    return schemas.User.model_validate(current_user)
