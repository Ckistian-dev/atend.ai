from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.responses import RedirectResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import timedelta
from typing import Annotated
from jose import JWTError

from app.db.schemas import Token, User, UserUpdate
from app.crud import crud_user
from app.services import security, google_service
from app.core.config import settings
from app.db.database import get_db
from app.db import models
from app.api.dependencies import get_current_active_user
import logging

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
    user = await crud_user.get_user_by_email(db, email=form_data.username)
    if not user or not security.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email ou senha incorretos",
            headers={"WWW-Authenticate": "Bearer"},
        )
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
    user_schema = User.from_orm(current_user)
    user_schema.is_google_connected = bool(current_user.google_refresh_token)
    return user_schema

# --- ENDPOINTS DE AUTENTICAÇÃO GOOGLE ---

@router.get("/google/login", summary="Gerar URL de autorização do Google")
async def google_login(current_user: models.User = Depends(get_current_active_user)):
    """
    Inicia o fluxo OAuth. Retorna a URL para a qual o frontend deve redirecionar o usuário.
    O 'state' é um JWT de curta duração para identificar o usuário no callback.
    """
    logger.info(f"Gerando URL de autorização Google para o usuário {current_user.id}")
    try:
        # Cria um JWT para o 'state' com o email do usuário para validação
        state_token_expires = timedelta(minutes=15)
        state_token = security.create_access_token(
            data={"sub": current_user.email}, expires_delta=state_token_expires
        )
        
        # A função em google_service precisa ser ajustada para aceitar 'state'
        auth_url = await google_service.generate_google_auth_url(state=state_token)
        return {"auth_url": auth_url}
    except Exception as e:
        logger.error(f"Erro ao gerar URL de auth do Google: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Não foi possível iniciar a autenticação com o Google.")

@router.get("/google/callback", summary="Callback do Google OAuth", include_in_schema=False)
async def google_callback(
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Endpoint para onde o Google redireciona após a autorização.
    Valida o 'state', troca o 'code' por um token, salva no usuário e redireciona de volta para o frontend.
    """
    code = request.query_params.get('code')
    state = request.query_params.get('state')
    
    # Você precisará adicionar FRONTEND_URL ao seu arquivo .env
    frontend_url = settings.FRONTEND_URL.rstrip('/')
    redirect_destination = f"{frontend_url}/Whatsapp"

    if not code or not state:
        logger.warning("Callback do Google recebido sem 'code' ou 'state'.")
        return RedirectResponse(f"{redirect_destination}?google_auth=error_missing_params")

    try:
        token_data = await security.get_current_user_token_data(state)
        user = await crud_user.get_user_by_email(db, email=token_data.email)
        
        if not user:
            logger.error(f"Usuário do token de estado não encontrado: {token_data.email}")
            return RedirectResponse(f"{redirect_destination}?google_auth=error_user_not_found")

        refresh_token = await google_service.get_refresh_token_from_code(code)
        encrypted_token = security.encrypt_token(refresh_token)
        
        user_update = UserUpdate(google_refresh_token=encrypted_token)
        await crud_user.update_user(db=db, db_user=user, user_in=user_update)
        await db.commit()
        
        logger.info(f"Token Google salvo com sucesso para o usuário {user.id}")
        return RedirectResponse(f"{redirect_destination}?google_auth=success")

    except JWTError:
        logger.error("Erro de JWT no callback do Google: state inválido ou expirado.")
        return RedirectResponse(f"{redirect_destination}?google_auth=error_invalid_state")
    except Exception as e:
        logger.error(f"Erro geral no callback do Google: {e}", exc_info=True)
        return RedirectResponse(f"{redirect_destination}?google_auth=error_generic")

@router.post("/google/disconnect", summary="Desconectar conta Google")
async def google_disconnect(
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user)
):
    """
    Remove o refresh_token do usuário, efetivamente desconectando a conta Google.
    """
    try:
        user_update = UserUpdate(google_refresh_token=None)
        await crud_user.update_user(db=db, db_user=current_user, user_in=user_update)
        await db.commit()
        
        logger.info(f"Token Google removido para o usuário {current_user.id}")
        return {"success": True, "is_google_connected": False}
        
    except Exception as e:
        logger.error(f"Erro ao desconectar Google para o usuário {current_user.id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Não foi possível desconectar a conta Google.")

