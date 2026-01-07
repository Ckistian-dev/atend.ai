from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import timedelta
from typing import Annotated

from app.db.schemas import Token, User
from app.services import security
from app.core.config import settings
from app.db.database import get_db
from app.db import models
from app.crud import crud_user
from app.api.dependencies import get_current_active_user
import logging
import os

router = APIRouter()
logger = logging.getLogger(__name__)

@router.post("/token", response_model=Token)
async def login_for_access_token(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: AsyncSession = Depends(get_db)
):
    """
    Autentica o utilizador e retorna um token de acesso JWT.
    """
    if len(form_data.password.encode('utf-8')) > 72:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="A senha não pode ter mais de 72 caracteres.",
        )

    # --- ETAPA 1: TENTAR AUTENTICAÇÃO COMO SUPERUSUÁRIO ---
    admin_email = settings.ADMIN_EMAIL
    admin_pass = settings.ADMIN_PASSWORD

    # Verifica se as credenciais correspondem ao superusuário definido no .env
    is_admin_login_attempt = admin_email and form_data.username == admin_email
    
    if is_admin_login_attempt:
        is_correct = False
        try:
            # Tenta verificar como hash (padrão do passlib)
            if admin_pass and security.verify_password(form_data.password, admin_pass):
                is_correct = True
        except (ValueError, TypeError):
            # Se falhar (ex: admin_pass é texto plano no .env), faz comparação direta
            if admin_pass and form_data.password == admin_pass:
                is_correct = True

        if is_correct:
            # SUCESSO: Credenciais de admin corretas. Gera token de admin.
            logger.info(f"Autenticação bem-sucedida para o superusuário: {admin_email}")
            access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
            access_token = security.create_access_token(
                data={"sub": admin_email}, expires_delta=access_token_expires
            )
            return {"access_token": access_token, "token_type": "bearer", "is_admin": True}
        else:
            # FALHA: Email de admin, mas senha incorreta.
            # Levanta exceção imediatamente para não tentar buscar no banco de dados.
            logger.warning(f"Tentativa de login falhou para o superusuário {admin_email} (senha incorreta).")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Email ou senha incorretos",
                headers={"WWW-Authenticate": "Bearer"},
            )

    # --- ETAPA 2: SE NÃO FOR ADMIN, TENTAR AUTENTICAÇÃO NORMAL (BANCO DE DADOS) ---
    logger.info(f"Tentativa de login para o usuário normal: {form_data.username}")
    user = await crud_user.get_user_by_email(db, email=form_data.username)
    
    # Verifica se o usuário existe e se a senha (hasheada) está correta
    if not user or not security.verify_password(form_data.password, user.hashed_password):
        logger.warning(f"Autenticação falhou para o usuário: {form_data.username}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email ou senha incorretos",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # SUCESSO: Credenciais de usuário normal corretas. Gera token normal.
    logger.info(f"Autenticação bem-sucedida para o usuário: {user.email}")
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = security.create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@router.get("/me", response_model=User, summary="Obter dados do utilizador logado")
async def read_users_me(current_user: models.User = Depends(get_current_active_user)):
    """
    Retorna os detalhes completos do utilizador atualmente autenticado,
    indicando se o Google está conectado.
    """
    # Define valores padrão para campos obrigatórios que podem estar nulos no banco
    if getattr(current_user, "tokens", None) is None:
        current_user.tokens = 0
    if getattr(current_user, "agent_running", None) is None:
        current_user.agent_running = False
    if getattr(current_user, "atendente_online", None) is None:
        current_user.atendente_online = False
    if getattr(current_user, "followup_active", None) is None:
        current_user.followup_active = False

    user_schema = User.from_orm(current_user)
    return user_schema
