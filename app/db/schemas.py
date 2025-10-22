from pydantic import BaseModel, EmailStr
from typing import List, Optional, Dict, Any
from datetime import datetime

# --- Schemas de Contato ---
class ContactBase(BaseModel):
    whatsapp: str
    observacoes: Optional[str] = None

class ContactCreate(ContactBase):
    pass

class ContactUpdate(BaseModel):
    observacoes: Optional[str] = None

class Contact(ContactBase):
    id: int
    user_id: int
    class Config:
        from_attributes = True

# --- Schemas de Configuração ---
class ConfigBase(BaseModel):
    nome_config: str
    prompt_config: Dict[str, Any]
    contexto_json: Optional[Dict[str, Any]] = None

class ConfigCreate(ConfigBase):
    pass

class ConfigUpdate(BaseModel):
    nome_config: Optional[str] = None
    prompt_config: Optional[Dict[str, Any]] = None
    contexto_json: Optional[Dict[str, Any]] = None

class Config(ConfigBase):
    id: int
    user_id: int
    class Config:
        from_attributes = True

# --- Schemas de Atendimento ---
class AtendimentoUpdate(BaseModel):
    status: Optional[str] = None
    log: Optional[str] = None
    active_persona_id: Optional[int] = None
    conversa: Optional[str] = None
    observacoes: Optional[str] = None
    
    class Config:
        from_attributes = True

class Atendimento(BaseModel):
    id: int
    contact_id: int
    user_id: int
    status: str
    log: Optional[str] = ""
    created_at: datetime
    active_persona_id: int
    conversa: Optional[str] = "[]"
    observacoes: Optional[str] = ""
    updated_at: datetime
    contact: Contact  # Aninha o objeto de contato para a resposta da API

    class Config:
        from_attributes = True

# --- Schemas de Usuário ---
class UserBase(BaseModel):
    email: EmailStr

class UserCreate(UserBase):
    password: str

class UserUpdate(BaseModel):
    instance_name: Optional[str] = None
    instance_id: Optional[str] = None
    tokens: Optional[int] = None
    default_persona_id: Optional[int] = None
    spreadsheet_id: Optional[str] = None
    followup_interval_minutes: Optional[int] = None
    google_refresh_token: Optional[str] = None

class User(UserBase):
    id: int
    instance_name: Optional[str] = None
    instance_id: Optional[str] = None
    tokens: int
    default_persona_id: Optional[int] = None
    spreadsheet_id: Optional[str] = None
    followup_interval_minutes: int
    is_google_connected: bool = False

    class Config:
        from_attributes = True

# --- Schemas de Token ---
class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    email: Optional[str] = None

