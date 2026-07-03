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

    company: Mapped["Company"] = relationship(back_populates="configs", foreign_keys=[company_id])
    vectors: Mapped[List["KnowledgeVector"]] = relationship(back_populates="config", cascade="all, delete-orphan")

class KnowledgeVector(Base):
    __tablename__ = "contextos"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    config_id: Mapped[int] = mapped_column(ForeignKey("configs.id"), index=True)
    content: Mapped[str] = mapped_column(Text, nullable=False, comment="Conteúdo textual formatado para RAG")
    origin: Mapped[str] = mapped_column(String(50), nullable=False, comment="'sheet' ou 'drive'")
    embedding: Mapped[Optional[List[float]]] = mapped_column(Vector(768), nullable=True, comment="Vetor de embedding (Google text-embedding-004)")

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
