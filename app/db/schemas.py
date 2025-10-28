from pydantic import BaseModel, EmailStr, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from app.db.models import ApiType # --- NOVO: Importar o Enum ---

# --- Schemas de Contato --- (Sem alterações)
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

    model_config = {
        "from_attributes": True
    }


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

    model_config = {
        "from_attributes": True
    }

# --- Schemas de Atendimento ---
class AtendimentoUpdate(BaseModel):
    status: Optional[str] = None
    active_persona_id: Optional[int] = None
    observacoes: Optional[str] = None
    conversa: Optional[Dict[str, Any]] = None
    log: Optional[str] = None

    model_config = {
        "from_attributes": True
    }

class Atendimento(BaseModel):
    id: int
    user_id: int
    contact_id: int
    active_persona_id: Optional[int] = None
    log: Optional[str] = ""
    status: str
    observacoes: Optional[str] = None
    conversa: Optional[str] = "[]" 
    created_at: datetime
    updated_at: datetime
    
    contact: Optional[Contact] = None # <-- CORRIGIDO
    active_persona: Optional[Config] = None # <-- CORRIGIDO

    # Atualizado para o estilo Pydantic v2 (igual aos seus schemas Contact e Config)
    model_config = { 
        "from_attributes": True
    }

class AtendimentoPage(BaseModel):
    total: int
    items: List[Atendimento]

    class Config:
        from_attributes = True 

# --- Schemas de Usuário ---
class UserBase(BaseModel):
    email: EmailStr

class UserCreate(UserBase):
    password: str

class UserUpdate(BaseModel):
    # Campos existentes
    instance_name: Optional[str] = Field(None, description="Nome da instância na Evolution API")
    instance_id: Optional[str] = Field(None, description="ID único da instância na Evolution API")
    tokens: Optional[int] = None
    default_persona_id: Optional[int] = None
    spreadsheet_id: Optional[str] = None
    followup_interval_minutes: Optional[int] = None
    google_refresh_token: Optional[str] = Field(None, description="Refresh token do Google (será criptografado)")

    # --- NOVOS CAMPOS ---
    api_type: Optional[ApiType] = Field(None, description="Tipo de API WhatsApp a ser usada (evolution ou official)")
    wbp_phone_number_id: Optional[str] = Field(None, description="ID do Número de Telefone na WhatsApp Business Platform")
    wbp_access_token: Optional[str] = Field(None, description="Token de Acesso da WBP (fornecer descriptografado, será criptografado)")
    # ------------------

class User(UserBase):
    id: int
    tokens: int
    default_persona_id: Optional[int] = None
    spreadsheet_id: Optional[str] = None
    followup_interval_minutes: int
    is_google_connected: bool = False

    # Campos Evolution
    instance_name: Optional[str] = None
    instance_id: Optional[str] = None # Manter para referência

    # --- NOVOS CAMPOS ---
    api_type: ApiType
    wbp_phone_number_id: Optional[str] = None
    # NÃO retornamos o wbp_access_token aqui por segurança
    # ------------------

    model_config = {
        "from_attributes": True
    }


# --- Schemas de Token ---
class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    email: Optional[str] = None

# --- Schemas da conversa---
class FormattedMessage(BaseModel):
    id: str
    role: str
    content: Optional[str] = None 
    timestamp: Optional[Any] = Field(default_factory=lambda: int(datetime.now(timezone.utc).timestamp()))
    
    type: str = "text" 
    url: Optional[str] = None 
    filename: Optional[str] = None 

    media_id: Optional[str] = None # ID da mídia na API da Meta (WBP)
    mime_type: Optional[str] = None # Tipo MIME original do arquivo

    class Config:
        from_attributes = True
