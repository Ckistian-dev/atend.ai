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

class ConfigCreate(ConfigBase):
    pass

class ConfigUpdate(BaseModel):
    nome_config: Optional[str] = None
    prompt_config: Optional[Dict[str, Any]] = None
    contexto_json: Optional[Dict[str, Any]] = None

class Config(ConfigBase):
    id: int
    user_id: int
    contexto_json: Optional[Dict[str, Any]] = None
    class Config:
        from_attributes = True

# --- Schemas de Atendimento ---
class AtendimentoBase(BaseModel):
    status: Optional[str] = "Aguardando Resposta"
    observacoes: Optional[str] = None
    active_persona_id: int

class Atendimento(AtendimentoBase):
    id: int
    user_id: int
    contact_id: int
    created_at: datetime
    updated_at: datetime
    conversa: str
    contact: Contact
    
    class Config:
        from_attributes = True

class AtendimentoUpdate(BaseModel):
    status: Optional[str] = None
    observacoes: Optional[str] = None
    active_persona_id: Optional[int] = None
    conversa: Optional[str] = None

# --- Schemas de Usuário (ATUALIZADO) ---
class UserBase(BaseModel):
    email: EmailStr

class UserCreate(UserBase):
    password: str

class UserUpdate(BaseModel):
    instance_name: Optional[str] = None
    # --- NOVO CAMPO ADICIONADO ---
    instance_id: Optional[str] = None
    tokens: Optional[int] = None
    default_persona_id: Optional[int] = None
    spreadsheet_id: Optional[str] = None
    followup_interval_minutes: Optional[int] = None

class User(UserBase):
    id: int
    instance_name: Optional[str] = None
    # --- NOVO CAMPO ADICIONADO ---
    instance_id: Optional[str] = None
    tokens: int
    default_persona_id: Optional[int] = None
    spreadsheet_id: Optional[str] = None
    class Config:
        from_attributes = True

# --- Schemas de Token ---
class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    email: Optional[str] = None
