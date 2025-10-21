# app/services/security.py

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from datetime import datetime, timedelta, timezone
from app.core.config import settings
from app.db.schemas import TokenData
from cryptography.fernet import Fernet
import logging

try:
    # Carrega a chave do .env
    encryption_key = settings.ENCRYPTION_KEY.encode()
    cipher_suite = Fernet(encryption_key)
    logger = logging.getLogger(__name__)
except Exception as e:
    logging.critical(f"ERRO CRÍTICO: ENCRYPTION_KEY não definida ou inválida. {e}")
    cipher_suite = None

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt

async def get_current_user_token_data(token: str = Depends(oauth2_scheme)) -> TokenData:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Não foi possível validar as credenciais",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
        token_data = TokenData(email=email)
    except JWTError:
        raise credentials_exception
    return token_data

def encrypt_token(token: str) -> str:
    """Criptografa um token de texto plano."""
    if not cipher_suite:
        logger.error("Tentativa de criptografar token sem cipher_suite. ENCRYPTION_KEY está faltando?")
        raise ValueError("Serviço de criptografia não inicializado.")
    
    encrypted_token = cipher_suite.encrypt(token.encode())
    return encrypted_token.decode()

def decrypt_token(encrypted_token: str) -> str:
    """Descriptografa um token."""
    if not cipher_suite:
        logger.error("Tentativa de descriptografar token sem cipher_suite. ENCRYPTION_KEY está faltando?")
        raise ValueError("Serviço de criptografia não inicializado.")
        
    decrypted_token = cipher_suite.decrypt(encrypted_token.encode())
    return decrypted_token.decode()