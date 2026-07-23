from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone

# --- Schemas de Configuração ---
class ConfigBase(BaseModel):
    nome_config: str
    spreadsheet_id: Optional[str] = None
    spreadsheet_rag_id: Optional[str] = None
    drive_id: Optional[str] = None
    prompt: Optional[str] = None
    notification_active: Optional[bool] = False
    notification_destination: Optional[str] = None
    notification_round_robin_index: Optional[int] = 0
    available_hours: Optional[Dict[str, Any]] = None
    is_calendar_active: Optional[bool] = False
    google_calendar_credentials: Optional[Dict[str, Any]] = None
    workflow_json: Optional[Dict[str, Any]] = None
    ai_model: Optional[str] = "gemini-2.5-flash"
    temperature: Optional[float] = 0.5
    top_p: Optional[float] = 0.95
    top_k: Optional[int] = 40
    thinking_budget: Optional[int] = 1024
    thinking_level: Optional[str] = "medium"
    tts_voice: Optional[str] = "Aoede"
    persona_form: Optional[Dict[str, Any]] = None

    @field_validator("thinking_level", mode="before")
    @classmethod
    def clean_thinking_level(cls, v: Any) -> Optional[str]:
        if isinstance(v, str):
            cleaned = v.strip("'\"").strip()
            if not cleaned or cleaned.lower() in ("none", "null"):
                return None
            return cleaned.lower()
        return v

    @field_validator("tts_voice", mode="before")
    @classmethod
    def clean_tts_voice(cls, v: Any) -> Optional[str]:
        if isinstance(v, str):
            cleaned = v.strip("'\"").strip()
            if not cleaned or cleaned.lower() in ("none", "null"):
                return None
            return cleaned
        return v



class ConfigCreate(ConfigBase):
    pass

class ConfigUpdate(BaseModel):
    nome_config: Optional[str] = None
    spreadsheet_id: Optional[str] = None
    spreadsheet_rag_id: Optional[str] = None
    drive_id: Optional[str] = None
    prompt: Optional[str] = None
    notification_active: Optional[bool] = None
    notification_destination: Optional[str] = None
    available_hours: Optional[Dict[str, Any]] = None
    is_calendar_active: Optional[bool] = None
    workflow_json: Optional[Dict[str, Any]] = None
    ai_model: Optional[str] = None
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    top_k: Optional[int] = None
    thinking_budget: Optional[int] = None
    thinking_level: Optional[str] = None
    tts_voice: Optional[str] = None
    persona_form: Optional[Dict[str, Any]] = None

    @field_validator("thinking_level", mode="before")
    @classmethod
    def clean_thinking_level(cls, v: Any) -> Optional[str]:
        if isinstance(v, str):
            cleaned = v.strip("'\"").strip()
            if not cleaned or cleaned.lower() in ("none", "null"):
                return None
            return cleaned.lower()
        return v

    @field_validator("tts_voice", mode="before")
    @classmethod
    def clean_tts_voice(cls, v: Any) -> Optional[str]:
        if isinstance(v, str):
            cleaned = v.strip("'\"").strip()
            if not cleaned or cleaned.lower() in ("none", "null"):
                return None
            return cleaned
        return v


class Config(ConfigBase):
    id: int
    company_id: int
    model_config = {"from_attributes": True}

# --- Schemas de Integração ---
class IntegrationBase(BaseModel):
    name: str
    integration_type: Optional[str] = "polling" # 'polling' ou 'webhook'
    url: Optional[str] = None
    method: Optional[str] = "GET"
    headers: Optional[Dict[str, Any]] = None
    body: Optional[Dict[str, Any]] = None
    items_path: Optional[str] = ""
    title_field: Optional[str] = None
    content_field: Optional[str] = None
    category: str = "integração"
    sync_interval_minutes: Optional[int] = 5
    enabled: Optional[bool] = True

class IntegrationCreate(IntegrationBase):
    config_id: int

class IntegrationUpdate(BaseModel):
    name: Optional[str] = None
    integration_type: Optional[str] = None
    url: Optional[str] = None
    method: Optional[str] = None
    headers: Optional[Dict[str, Any]] = None
    body: Optional[Dict[str, Any]] = None
    items_path: Optional[str] = None
    title_field: Optional[str] = None
    content_field: Optional[str] = None
    category: Optional[str] = None
    sync_interval_minutes: Optional[int] = None
    enabled: Optional[bool] = None

class Integration(IntegrationBase):
    id: int
    config_id: int
    webhook_token: Optional[str] = None
    last_sync_at: Optional[datetime] = None
    last_status: Optional[str] = "pending"
    last_error: Optional[str] = None
    last_payload: Optional[Dict[str, Any]] = None
    model_config = {"from_attributes": True}

class TestEndpointPayload(BaseModel):
    url: str
    method: Optional[str] = "GET"
    headers: Optional[Dict[str, Any]] = None
    params: Optional[Dict[str, Any]] = None
    body: Optional[Any] = None


# --- Schemas de Conhecimento (KnowledgeVector) ---

class KnowledgeVectorBase(BaseModel):
    content: str = Field(..., description="Texto formatado usado para RAG e buscas textuais")
    origin: str = Field(..., description="'sheet' or 'drive'")
    category: Optional[str] = Field(None, description="Categoria do dado: 'product', 'faq', 'company'")
    raw_data: Optional[Dict[str, Any]] = Field(None, description="JSON contendo a linha exata da planilha")
    # Nota: omitimos o 'embedding' no Base para não trafegar vetores pesados desnecessariamente nas requisições normais

class KnowledgeVectorCreate(KnowledgeVectorBase):
    config_id: int
    embedding: Optional[List[float]] = None

class KnowledgeVectorUpdate(BaseModel):
    content: Optional[str] = None
    origin: Optional[str] = None
    category: Optional[str] = None
    raw_data: Optional[Dict[str, Any]] = None
    embedding: Optional[List[float]] = None

class KnowledgeVector(KnowledgeVectorBase):
    id: int
    config_id: int
    
    model_config = {"from_attributes": True}

# --- Schemas de Atendimento ---
class AtendimentoUpdate(BaseModel):
    status: Optional[str] = None
    active_persona_id: Optional[int] = None
    resumo: Optional[str] = None
    observacoes: Optional[str] = None
    notificacao_contato: Optional[str] = None
    conversa: Optional[Any] = None
    nome_contato: Optional[str] = None
    tags: Optional[List[Dict[str, str]]] = None
    model_config = {"from_attributes": True}

class AtendimentoCreate(BaseModel):
    whatsapp: str
    nome_contato: Optional[str] = None
    status: Optional[str] = "Novo Atendimento"
    active_persona_id: Optional[int] = None
    resumo: Optional[str] = None
    observacoes: Optional[str] = None
    notificacao_contato: Optional[str] = None
    tags: Optional[List[Dict[str, str]]] = Field(default_factory=list)
    # Campos opcionais para iniciar com um template
    template_name: Optional[str] = None
    template_language_code: Optional[str] = None
    template_components: Optional[List[Dict[str, Any]]] = None

    model_config = {"from_attributes": True}


class Atendimento(BaseModel):
    id: int
    company_id: int
    active_persona_id: Optional[int] = None
    status: str
    resumo: Optional[str] = None
    observacoes: Optional[str] = None
    notificacao_contato: Optional[str] = None
    conversa: Optional[str] = "[]"
    created_at: datetime
    bulk_template_name: Optional[str] = None
    bulk_template_params: Optional[Dict[str, Any]] = None
    updated_at: datetime
    whatsapp: str
    nome_contato: Optional[str] = None
    tags: Optional[List[Dict[str, str]]] = Field(default_factory=list)
    token_usage: Optional[int] = 0
    active_persona: Optional[Config] = None
    model_config = {"from_attributes": True}

class AtendimentoPage(BaseModel):
    total: int
    items: List[Atendimento]
    model_config = {"from_attributes": True}

# --- Schemas de Empresa ---
class CompanyBase(BaseModel):
    name: str
    wbp_phone_number_id: Optional[str] = None
    wbp_business_account_id: Optional[str] = None
    agent_running: Optional[bool] = False
    atendente_online: Optional[bool] = False
    tokens: Optional[int] = 0
    default_persona_id: Optional[int] = None
    prospect_token: Optional[str] = None
    followup_active: Optional[bool] = False
    followup_config: Optional[Dict[str, Any]] = None

class CompanyCreate(CompanyBase):
    pass

class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    wbp_phone_number_id: Optional[str] = None
    wbp_business_account_id: Optional[str] = None
    agent_running: Optional[bool] = None
    atendente_online: Optional[bool] = None
    tokens: Optional[int] = None
    default_persona_id: Optional[int] = None
    prospect_token: Optional[str] = None
    followup_active: Optional[bool] = None
    followup_config: Optional[Dict[str, Any]] = None

class Company(CompanyBase):
    id: int
    model_config = {"from_attributes": True}

# --- Schemas de Usuário ---
class UserBase(BaseModel):
    email: EmailStr
    name: Optional[str] = None
    participates_distribution: Optional[bool] = False
    profile_color: Optional[str] = "#3b82f6"

class UserCreate(UserBase):
    password: str

class UserCreateByAdmin(UserCreate):
    role: Optional[str] = "user"
    company_id: Optional[int] = None
    permissions: Optional[Dict[str, Any]] = None

class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    name: Optional[str] = None
    role: Optional[str] = None
    company_id: Optional[int] = None
    password: Optional[str] = Field(None, description="Definir uma nova senha para o usuário")
    permissions: Optional[Dict[str, Any]] = None
    participates_distribution: Optional[bool] = None
    profile_color: Optional[str] = None
    followup_active: Optional[bool] = None
    followup_config: Optional[Dict[str, Any]] = None

class User(UserBase):
    id: int
    role: str
    company_id: Optional[int] = None
    is_superuser: bool = False
    company: Optional[Company] = None
    permissions: Optional[Dict[str, Any]] = None
    participates_distribution: Optional[bool] = False
    profile_color: Optional[str] = None
    model_config = {"from_attributes": True}

    @field_validator("participates_distribution", mode="before")
    @classmethod
    def default_participates_distribution(cls, v):
        if v is None:
            return False
        return v

# --- Schemas de Token ---
class Token(BaseModel):
    access_token: str
    token_type: str
    is_admin: bool = False
    is_superuser: bool = False

class TokenData(BaseModel):
    email: Optional[str] = None

# --- Schemas da conversa---
class FormattedMessage(BaseModel):
    id: str
    role: str
    content: Optional[str] = None
    caption: Optional[str] = None  # Texto original enviado pelo usuário junto com a mídia
    timestamp: Optional[Any] = Field(default_factory=lambda: int(datetime.now(timezone.utc).timestamp()))
    status: Optional[str] = None
    type: str = "text"
    url: Optional[str] = None
    filename: Optional[str] = None
    media_id: Optional[str] = None
    mime_type: Optional[str] = None
    is_template: Optional[bool] = False
    buttons: Optional[List[str]] = None
    quoted_msg: Optional[Dict[str, Any]] = None
    is_ai: Optional[bool] = False
    model_config = {"from_attributes": True}


# --- Schemas de Payload / Requests ---

class SendMessagePayload(BaseModel):
    text: str


class SendTemplatePayload(BaseModel):
    template_name: str
    language_code: str = "en_US"
    components: Optional[List[Dict[str, Any]]] = None


class FeedbackAnalysisPayload(BaseModel):
    feedback: str


class AlteracaoPlanilha(BaseModel):
    aba: str
    coluna_1: str
    valor_antigo: Optional[str] = None
    valor_novo: str
    acao: str
    motivo: Optional[str] = None


class ApplyFeedbackPayload(BaseModel):
    alteracoes_planilha: Optional[List[AlteracaoPlanilha]] = None
    alteracoes_rag: Optional[List[AlteracaoPlanilha]] = None
    novo_workflow: Optional[Dict[str, Any]] = None


class ProvisionWithCodePayload(BaseModel):
    config_id: int
    resource_type: str
    code: str
    redirect_uri: str


class WorkflowFeedbackPayload(BaseModel):
    feedback: str
    current_workflow: Optional[Dict[str, Any]] = None



class ApplyWorkflowPayload(BaseModel):
    novo_workflow: Optional[Dict[str, Any]] = None


