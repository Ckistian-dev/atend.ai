from pydantic import BaseModel, EmailStr, Field
from typing import List, Optional, Dict, Any
from datetime import datetime
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


# --- Schemas de Configuração --- (Sem alterações)
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


# --- Schemas de Atendimento --- (Sem alterações)
class AtendimentoUpdate(BaseModel):
    status: Optional[str] = None
    log: Optional[str] = None
    active_persona_id: Optional[int] = None
    conversa: Optional[str] = None # Manter como string por enquanto
    observacoes: Optional[str] = None

    model_config = {
        "from_attributes": True
    }


class Atendimento(BaseModel):
    id: int
    contact_id: int
    user_id: int
    status: str
    log: Optional[str] = ""
    created_at: datetime
    active_persona_id: Optional[int] # Permitir nulo
    conversa: Optional[str] = "[]"
    observacoes: Optional[str] = ""
    updated_at: datetime
    contact: Contact  # Aninha o objeto de contato para a resposta da API
    # active_persona: Optional[Config] = None # Opcional incluir persona aqui

    model_config = {
        "from_attributes": True
    }


# --- Schemas de Usuário ---
class UserBase(BaseModel):
    email: EmailStr

class UserCreate(UserBase):
    password: str

# --- ALTERADO: UserUpdate ---
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


# --- ALTERADO: User (para resposta da API /auth/me) ---
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


# --- Schemas de Token --- (Sem alterações)
class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    email: Optional[str] = None

# --- NOVO: Schema para mensagem formatada (usado internamente) ---
class FormattedMessage(BaseModel):
    id: str # ID original da mensagem (da API Evolution ou Oficial)
    role: str # 'user' ou 'assistant'
    content: str # Conteúdo textual da mensagem (ou transcrição/análise)
    timestamp: int # Timestamp original da mensagem (Unix epoch)
