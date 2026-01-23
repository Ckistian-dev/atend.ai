from sqlalchemy import ( Column, Integer, String, ForeignKey, Text, DateTime, func, Enum as SQLEnum )
from sqlalchemy.orm import relationship, DeclarativeBase, Mapped, mapped_column
from sqlalchemy.dialects.postgresql import JSONB
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from pgvector.sqlalchemy import Vector
import enum

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)

    wbp_phone_number_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True, comment="ID do Número de Telefone na WhatsApp Business Platform")
    wbp_business_account_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, comment="ID da Conta do WhatsApp Business na Meta")

    agent_running: Mapped[bool] = mapped_column(default=False, nullable=False, server_default="false")
    atendente_online: Mapped[bool] = mapped_column(default=False, nullable=False, server_default="false", comment="Status de disponibilidade do atendente humano")
    tokens: Mapped[int] = mapped_column(Integer, default=0)
    default_persona_id: Mapped[Optional[int]] = mapped_column(ForeignKey("configs.id"), nullable=True)

    followup_active: Mapped[bool] = mapped_column(default=False, nullable=False, server_default="false", comment="Define se o sistema de followup está ativo para este usuário")
    followup_config: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB, nullable=True, comment="Configurações de followup (intervalos, horários, mensagens)")
    configs: Mapped[List["Config"]] = relationship(back_populates="owner", foreign_keys="[Config.user_id]", cascade="all, delete-orphan")
    atendimentos: Mapped[List["Atendimento"]] = relationship(back_populates="owner", cascade="all, delete-orphan")
    default_persona: Mapped[Optional["Config"]] = relationship(foreign_keys=[default_persona_id])

class Config(Base):
    __tablename__ = "configs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    nome_config: Mapped[str] = mapped_column(String(100), nullable=False)
    spreadsheet_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, comment="ID da Planilha de Instruções (System)")
    spreadsheet_rag_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, comment="ID da Planilha de Conhecimento (RAG)")
    drive_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, comment="ID da pasta do Google Drive contendo mídias")
    prompt: Mapped[Optional[str]] = mapped_column(Text, nullable=True, comment="Contexto fixo gerado a partir das abas de sistema")
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))

    owner: Mapped["User"] = relationship(back_populates="configs", foreign_keys=[user_id])
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
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'))
    status: Mapped[str] = mapped_column(String(50), default="Aguardando Resposta", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    active_persona_id: Mapped[Optional[int]] = mapped_column(ForeignKey('configs.id'), nullable=True)
    conversa: Mapped[Optional[str]] = mapped_column(Text, default="[]")
    resumo: Mapped[Optional[str]] = mapped_column(Text, nullable=True, default="")
    observacoes: Mapped[Optional[str]] = mapped_column(Text, nullable=True, default="")
    tags: Mapped[Optional[List[Dict[str, str]]]] = mapped_column(JSONB, nullable=True, default=list)
    token_usage: Mapped[int] = mapped_column(Integer, default=0, comment="Total de tokens consumidos neste atendimento")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), index=True)

    owner: Mapped["User"] = relationship(back_populates="atendimentos")
    active_persona: Mapped[Optional["Config"]] = relationship()
