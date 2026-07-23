from sqlalchemy import ( Column, Integer, String, ForeignKey, Text, DateTime, func, Enum as SQLEnum )
from sqlalchemy.orm import relationship, DeclarativeBase, Mapped, mapped_column
from sqlalchemy.dialects.postgresql import JSONB
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from pgvector.sqlalchemy import Vector
import enum

class Base(DeclarativeBase):
    pass

class Company(Base):
    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    wbp_phone_number_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True, comment="ID do Número de Telefone na WhatsApp Business Platform")
    wbp_business_account_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, comment="ID da Conta do WhatsApp Business na Meta")

    agent_running: Mapped[bool] = mapped_column(default=False, nullable=False, server_default="false")
    atendente_online: Mapped[bool] = mapped_column(default=False, nullable=False, server_default="false", comment="Status de disponibilidade do atendente humano")
    tokens: Mapped[int] = mapped_column(Integer, default=0)
    default_persona_id: Mapped[Optional[int]] = mapped_column(ForeignKey("configs.id", use_alter=True, name="fk_companies_default_persona"), nullable=True)
    prospect_token: Mapped[Optional[str]] = mapped_column(Text, nullable=True, comment="Token de autenticação para API do ProspectAI")

    followup_active: Mapped[bool] = mapped_column(default=False, nullable=False, server_default="false", comment="Define se o sistema de followup está ativo para esta empresa")
    followup_config: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB, nullable=True, comment="Configurações de followup (intervalos, horários, mensagens)")

    users: Mapped[List["User"]] = relationship(back_populates="company", cascade="all, delete-orphan")
    configs: Mapped[List["Config"]] = relationship(back_populates="company", foreign_keys="[Config.company_id]", cascade="all, delete-orphan")
    atendimentos: Mapped[List["Atendimento"]] = relationship(back_populates="company", cascade="all, delete-orphan")
    default_persona: Mapped[Optional["Config"]] = relationship(foreign_keys=[default_persona_id])

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(50), default="user", server_default="user", nullable=False, comment="Função do usuário no sistema (ex: admin, atendente, etc)")

    company_id: Mapped[Optional[int]] = mapped_column(ForeignKey("companies.id"), nullable=True)
    company: Mapped[Optional["Company"]] = relationship(back_populates="users")
    permissions: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB, nullable=True, comment="Permissões específicas do usuário")
    participates_distribution: Mapped[bool] = mapped_column(default=False, server_default="false", nullable=False)
    profile_color: Mapped[Optional[str]] = mapped_column(String(50), default="#3b82f6", server_default="'#3b82f6'", nullable=True)

class Config(Base):
    __tablename__ = "configs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    nome_config: Mapped[str] = mapped_column(String(100), nullable=False)
    spreadsheet_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, comment="ID da Planilha de Instruções (System)")
    spreadsheet_rag_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, comment="ID da Planilha de Conhecimento (RAG)")
    drive_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, comment="ID da pasta do Google Drive contendo mídias")
    prompt: Mapped[Optional[str]] = mapped_column(Text, nullable=True, comment="Contexto fixo gerado a partir das abas de sistema")
    notification_active: Mapped[bool] = mapped_column(default=False, nullable=False, server_default="false", comment="Ativar notificações via ProspectAI")
    notification_destination: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, comment="ID/JID do contato ou grupo para receber notificações")
    notification_round_robin_index: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    
    available_hours: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB, nullable=True, comment="Horários de disponibilidade semanal")
    google_calendar_credentials: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB, nullable=True, comment="Tokens de acesso ao Google Calendar")
    is_calendar_active: Mapped[bool] = mapped_column(default=False, nullable=False, server_default="false")
    workflow_json: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB, nullable=True, comment="Configuração visual do fluxo de conversa")

    # Novas configurações de IA
    ai_model: Mapped[str] = mapped_column(String(100), default="gemini-2.5-flash", server_default="gemini-2.5-flash")
    temperature: Mapped[float] = mapped_column(default=0.5, server_default="0.5")
    top_p: Mapped[float] = mapped_column(default=0.95, server_default="0.95")
    top_k: Mapped[int] = mapped_column(default=40, server_default="40")
    thinking_budget: Mapped[Optional[int]] = mapped_column(Integer, default=1024, server_default="1024", nullable=True)
    thinking_level: Mapped[Optional[str]] = mapped_column(String(50), default="medium", server_default="medium", nullable=True)
    tts_voice: Mapped[Optional[str]] = mapped_column(String(50), default="Aoede", server_default="Aoede", nullable=True)

    # Formulário de Persona
    persona_form: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB, nullable=True, comment="Dados estruturados do formulário de persona (Aba Persona)")


    company: Mapped["Company"] = relationship(back_populates="configs", foreign_keys=[company_id])
    vectors: Mapped[List["KnowledgeVector"]] = relationship(back_populates="config", cascade="all, delete-orphan")
    integrations: Mapped[List["Integration"]] = relationship(back_populates="config", cascade="all, delete-orphan")

class Integration(Base):
    __tablename__ = "integrations"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    config_id: Mapped[int] = mapped_column(ForeignKey("configs.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    integration_type: Mapped[str] = mapped_column(String(50), default="polling", server_default="'polling'", nullable=False, comment="'polling' ou 'webhook'")
    url: Mapped[Optional[str]] = mapped_column(Text, nullable=True, comment="Endpoint de saída para polling")
    webhook_token: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True, unique=True, comment="Token secreto passado no Header X-Webhook-Token")
    method: Mapped[str] = mapped_column(String(10), default="GET", server_default="'GET'", nullable=False)
    headers: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB, nullable=True, comment="Cabeçalhos HTTP customizados")
    body: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB, nullable=True, comment="Payload JSON caso o método seja POST")
    items_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True, default="", comment="Nó no JSON para a lista de itens ex: data.products")
    title_field: Mapped[Optional[str]] = mapped_column(Text, nullable=True, comment="Campo chave para o título/ID do item")
    content_field: Mapped[Optional[str]] = mapped_column(Text, nullable=True, comment="Campo(s) para o conteúdo do item")
    category: Mapped[str] = mapped_column(String(100), default="integração", server_default="'integração'", comment="Categoria atribuída aos vetores RAG")
    sync_interval_minutes: Mapped[int] = mapped_column(Integer, default=5, server_default="5")
    enabled: Mapped[bool] = mapped_column(default=True, server_default="true")
    last_sync_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_status: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, default="pending")
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    item_checksums: Mapped[Optional[Dict[str, str]]] = mapped_column(JSONB, nullable=True, comment="Mapeamento item_id -> md5 hash para atualizações incrementais")
    last_payload: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB, nullable=True, comment="Último payload JSON recebido via webhook")

    config: Mapped["Config"] = relationship(back_populates="integrations")

class KnowledgeVector(Base):
    __tablename__ = "contextos"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    config_id: Mapped[int] = mapped_column(ForeignKey("configs.id"), index=True)
    
    # --- NOVAS COLUNAS PARA O PYDANTIC AI ---
    category: Mapped[str] = mapped_column(String(50), nullable=False, index=True, default="uncategorized", server_default="'uncategorized'", comment="Ex: 'product', 'faq', 'company'")
    raw_data: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB, nullable=True, comment="Exact JSON row from the client's spreadsheet/data source")
    
    # --- COLUNAS ORIGINAIS MANTIDAS E OTIMIZADAS ---
    content: Mapped[str] = mapped_column(Text, nullable=False, comment="Formatted text used for RAG embedding AND fast ILIKE text searches")
    origin: Mapped[str] = mapped_column(String(50), nullable=False, comment="'sheet' or 'drive'")
    embedding: Mapped[Optional[List[float]]] = mapped_column(Vector(768), nullable=True, comment="Vector embedding (Google text-embedding-004)")

    config: Mapped["Config"] = relationship(back_populates="vectors")

class Atendimento(Base):
    __tablename__ = 'atendimentos'

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    whatsapp: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    nome_contato: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    company_id: Mapped[int] = mapped_column(ForeignKey('companies.id'))
    status: Mapped[str] = mapped_column(String(50), default="Aguardando Resposta", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    active_persona_id: Mapped[Optional[int]] = mapped_column(ForeignKey('configs.id'), nullable=True)
    conversa: Mapped[Optional[str]] = mapped_column(Text, default="[]")
    resumo: Mapped[Optional[str]] = mapped_column(Text, nullable=True, default="")
    observacoes: Mapped[Optional[str]] = mapped_column(Text, nullable=True, default="")
    notificacao_contato: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, comment="Destino de notificação alocado para este atendimento via round-robin")
    bulk_template_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    bulk_template_params: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    tags: Mapped[Optional[List[Dict[str, str]]]] = mapped_column(JSONB, nullable=True, default=list)
    token_usage: Mapped[int] = mapped_column(Integer, default=0, comment="Total de tokens consumidos neste atendimento")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), index=True)

    company: Mapped["Company"] = relationship(back_populates="atendimentos")
    active_persona: Mapped[Optional["Config"]] = relationship()

class AtendimentoMessageSearch(Base):
    __tablename__ = "mensagens"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    atendimento_id: Mapped[int] = mapped_column(ForeignKey("atendimentos.id", ondelete="CASCADE"), index=True)
    message_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(50), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    message_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    atendimento_info: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    embedding: Mapped[Optional[List[float]]] = mapped_column(Vector(768), nullable=True)

    company: Mapped["Company"] = relationship()
    atendimento: Mapped["Atendimento"] = relationship()

