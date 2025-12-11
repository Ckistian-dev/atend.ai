from pydantic import BaseModel, EmailStr, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone

# --- Schemas de Configuração ---
class ConfigBase(BaseModel):
    nome_config: str
    contexto_json: Optional[Dict[str, Any]] = None
    spreadsheet_id: Optional[str] = None
    drive_id: Optional[str] = None
    arquivos_drive_json: Optional[Dict[str, Any]] = None

class ConfigCreate(ConfigBase):
    pass

class ConfigUpdate(BaseModel):
    nome_config: Optional[str] = None
    contexto_json: Optional[Dict[str, Any]] = None
    spreadsheet_id: Optional[str] = None
    drive_id: Optional[str] = None
    arquivos_drive_json: Optional[Dict[str, Any]] = None

class Config(ConfigBase):
    id: int
    user_id: int
    model_config = {"from_attributes": True}

# --- Schemas de Atendimento ---
class AtendimentoUpdate(BaseModel):
    status: Optional[str] = None
    active_persona_id: Optional[int] = None
    observacoes: Optional[str] = None
    conversa: Optional[Any] = None
    nome_contato: Optional[str] = None
    tags: Optional[List[Dict[str, str]]] = None
    model_config = {"from_attributes": True}

class AtendimentoCreate(BaseModel):
    whatsapp: str
    nome_contato: Optional[str] = None
    status: Optional[str] = "Novo Atendimento"
    active_persona_id: Optional[int] = None
    observacoes: Optional[str] = None
    tags: Optional[List[Dict[str, str]]] = Field(default_factory=list)
    # Campos opcionais para iniciar com um template
    template_name: Optional[str] = None
    template_language_code: Optional[str] = None
    template_components: Optional[List[Dict[str, Any]]] = None

    model_config = {"from_attributes": True}


class Atendimento(BaseModel):
    id: int
    user_id: int
    active_persona_id: Optional[int] = None
    status: str
    observacoes: Optional[str] = None
    conversa: Optional[str] = "[]"
    created_at: datetime
    updated_at: datetime
    whatsapp: str
    nome_contato: Optional[str] = None
    tags: Optional[List[Dict[str, str]]] = Field(default_factory=list)
    active_persona: Optional[Config] = None
    model_config = {"from_attributes": True}

class AtendimentoPage(BaseModel):
    total: int
    items: List[Atendimento]
    model_config = {"from_attributes": True}

# --- Schemas de Usuário ---
class UserBase(BaseModel):
    email: EmailStr

class UserCreate(UserBase):
    password: str

class UserUpdate(BaseModel):
    tokens: Optional[int] = None
    default_persona_id: Optional[int] = None
    agent_running: Optional[bool] = None
    atendente_online: Optional[bool] = None
    followup_active: Optional[bool] = None
    followup_config: Optional[Dict[str, Any]] = None
    wbp_phone_number_id: Optional[str] = Field(None, description="ID do Número de Telefone na WhatsApp Business Platform")
    wbp_access_token: Optional[str] = Field(None, description="Token de Acesso da WBP (fornecer descriptografado, será criptografado)")
    wbp_business_account_id: Optional[str] = Field(None, description="ID da Conta do WhatsApp Business na Meta")

class User(UserBase):
    id: int
    tokens: int
    agent_running: bool
    atendente_online: bool
    default_persona_id: Optional[int] = None
    followup_active: bool
    followup_config: Optional[Dict[str, Any]] = None
    wbp_phone_number_id: Optional[str] = None
    wbp_business_account_id: Optional[str] = None
    model_config = {"from_attributes": True}

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
    status: Optional[str] = None
    type: str = "text"
    url: Optional[str] = None
    filename: Optional[str] = None
    media_id: Optional[str] = None
    mime_type: Optional[str] = None
    model_config = {"from_attributes": True}
