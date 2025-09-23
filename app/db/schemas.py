# app/db/schemas.py

from pydantic import BaseModel, EmailStr
from typing import List, Optional, Dict, Any
from datetime import datetime

# --- Schemas de Contato (Simplificado) ---
class ContactBase(BaseModel):
    whatsapp: str
    # nome: Optional[str] = "Novo Contato"  <-- REMOVIDO
    observacoes: Optional[str] = None

class ContactCreate(ContactBase):
    pass

class ContactUpdate(BaseModel):
    # nome: Optional[str] = None  <-- REMOVIDO
    observacoes: Optional[str] = None

class Contact(ContactBase):
    id: int
    user_id: int
    class Config:
        from_attributes = True

# --- Schemas de Configuração (Persona e Contexto) ---
class ConfigBase(BaseModel):
    nome_config: str
    prompt_config: Dict[str, Any]

class ConfigCreate(ConfigBase):
    pass

class ConfigUpdate(BaseModel):
    nome_config: Optional[str] = None
    prompt_config: Optional[Dict[str, Any]] = None
    contexto_json: Optional[Dict[str, Any]] = None # Para salvar a planilha

class Config(ConfigBase):
    id: int
    user_id: int
    contexto_json: Optional[Dict[str, Any]] = None
    class Config:
        from_attributes = True

# --- Schemas de Atendimento (Substituindo Prospect) ---
class AtendimentoBase(BaseModel):
    status: Optional[str] = "Aguardando Resposta"
    observacoes: Optional[str] = None
    active_persona_id: int

# Schema para retornar um atendimento na listagem principal
class Atendimento(AtendimentoBase):
    id: int
    user_id: int
    contact_id: int
    created_at: datetime
    updated_at: datetime
    conversa: str
    contact: Contact # Inclui os dados do contato aninhados
    
    class Config:
        from_attributes = True

# Schema para atualizar um atendimento (status, persona, etc.)
class AtendimentoUpdate(BaseModel):
    status: Optional[str] = None
    observacoes: Optional[str] = None
    active_persona_id: Optional[int] = None
    conversa: Optional[str] = None

# --- Schemas de Usuário (com Persona Padrão) ---
class UserBase(BaseModel):
    email: EmailStr

class UserCreate(UserBase):
    password: str

class UserUpdate(BaseModel):
    instance_name: Optional[str] = None
    tokens: Optional[int] = None
    default_persona_id: Optional[int] = None
    spreadsheet_id: Optional[str] = None
    followup_interval_minutes: Optional[int] = None

class User(UserBase):
    id: int
    instance_name: Optional[str] = None
    tokens: int
    default_persona_id: Optional[int] = None
    spreadsheet_id: Optional[str] = None
    class Config:
        from_attributes = True

# --- Schemas de Token (Sem alterações) ---
class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    email: Optional[str] = None