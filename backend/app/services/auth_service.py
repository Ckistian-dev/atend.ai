import logging
from datetime import timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.services import security
from app.crud import crud_user

logger = logging.getLogger(__name__)

class AuthService:
    @staticmethod
    async def login_for_access_token(
        db: AsyncSession,
        username: str,
        password: str
    ) -> dict:
        """
        Autentica o utilizador (seja como admin estático ou via banco de dados) e retorna
        um token de acesso JWT bearer caso as credenciais estejam corretas.

        @param db: Sessão do banco de dados.
        @param username: Nome de usuário / Email digitado.
        @param password: Senha em texto plano digitada.
        @returns: Dicionário contendo o token de acesso e metadados de privilégios.
        """
        if len(password.encode('utf-8')) > 72:
            raise ValueError("A senha não pode ter mais de 72 caracteres.")

        # --- ETAPA 1: TENTAR AUTENTICAÇÃO COMO SUPERUSUÁRIO ---
        admin_email = settings.ADMIN_EMAIL
        admin_pass = settings.ADMIN_PASSWORD

        # Verifica se as credenciais correspondem ao superusuário definido no .env
        is_admin_login_attempt = admin_email and username == admin_email
        
        if is_admin_login_attempt:
            is_correct = False
            try:
                # Tenta verificar como hash (padrão do passlib)
                if admin_pass and security.verify_password(password, admin_pass):
                    is_correct = True
            except (ValueError, TypeError):
                # Se falhar (ex: admin_pass é texto plano no .env), faz comparação direta
                if admin_pass and password == admin_pass:
                    is_correct = True

            if is_correct:
                # SUCESSO: Credenciais de admin corretas. Gera token de admin.
                logger.info(f"Autenticação bem-sucedida para o superusuário: {admin_email}")
                access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
                access_token = security.create_access_token(
                    data={"sub": admin_email}, expires_delta=access_token_expires
                )
                return {"access_token": access_token, "token_type": "bearer", "is_admin": True, "is_superuser": True}
            else:
                # FALHA: Email de admin, mas senha incorreta.
                logger.warning(f"Tentativa de login falhou para o superusuário {admin_email} (senha incorreta).")
                raise PermissionError("Email ou senha incorretos")

        # --- ETAPA 2: SE NÃO FOR ADMIN, TENTAR AUTENTICAÇÃO NORMAL (BANCO DE DADOS) ---
        logger.info(f"Tentativa de login para o usuário normal: {username}")
        user = await crud_user.get_user_by_email(db, email=username)
        
        # Verifica se o usuário existe e se a senha (hasheada) está correta
        if not user or not security.verify_password(password, user.hashed_password):
            logger.warning(f"Autenticação falhou para o usuário: {username}")
            raise PermissionError("Email ou senha incorretos")
        
        # SUCESSO: Credenciais de usuário normal corretas. Gera token normal.
        logger.info(f"Autenticação bem-sucedida para o usuário: {user.email}")
        access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        access_token = security.create_access_token(
            data={"sub": user.email}, expires_delta=access_token_expires
        )
        return {
            "access_token": access_token,
            "token_type": "bearer",
            "is_admin": user.role == "admin",
            "is_superuser": False
        }
