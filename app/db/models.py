from sqlalchemy import ( Column, Integer, String, ForeignKey, Text, DateTime, func, Enum as SQLEnum ) # Adicionado SQLEnum
from sqlalchemy.orm import relationship, DeclarativeBase, Mapped, mapped_column
from sqlalchemy.dialects.postgresql import JSONB
from typing import List, Optional
from datetime import datetime, timezone # Adicionado timezone
import enum # Adicionado enum

# --- NOVO: Enum para o tipo de API ---
class ApiType(str, enum.Enum): # Herdando de str para facilitar serialização/uso
    evolution = "evolution"
    official = "official"
# ------------------------------------

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)

    # --- CAMPOS EXISTENTES DA EVOLUTION ---
    instance_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, comment="Nome da instância na Evolution API")
    instance_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True, comment="ID único da instância na Evolution API")

    # --- NOVOS CAMPOS GERAIS E DA API OFICIAL ---
    api_type: Mapped[ApiType] = mapped_column(SQLEnum(ApiType, name="api_type_enum", create_type=False), default=ApiType.evolution, nullable=False, comment="Tipo de API WhatsApp utilizada (evolution ou official)") # Usando SQLEnum com nome explícito
    wbp_phone_number_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True, comment="ID do Número de Telefone na WhatsApp Business Platform")
    wbp_access_token: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True, comment="Token de Acesso da WBP (CR IPTOGRAFADO!)")
    # Nota: wbp_verify_token será global por enquanto (settings), não específico do usuário
    # ------------------------------------------

    tokens: Mapped[int] = mapped_column(Integer, default=0)
    default_persona_id: Mapped[Optional[int]] = mapped_column(ForeignKey("configs.id"), nullable=True)
    spreadsheet_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    followup_interval_minutes: Mapped[int] = mapped_column(Integer, default=0)

    google_refresh_token: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True, comment="Refresh token do Google (CR IPTOGRAFADO!)")

    # Relacionamentos
    configs: Mapped[List["Config"]] = relationship(back_populates="owner", foreign_keys="[Config.user_id]", cascade="all, delete-orphan")
    atendimentos: Mapped[List["Atendimento"]] = relationship(back_populates="owner", cascade="all, delete-orphan")
    contacts: Mapped[List["Contact"]] = relationship(back_populates="owner", cascade="all, delete-orphan")

    default_persona: Mapped[Optional["Config"]] = relationship(foreign_keys=[default_persona_id])


class Contact(Base):
    __tablename__ = "contacts"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    # --- ALTERADO: Permitir múltiplos contatos com o mesmo número para usuários diferentes ---
    whatsapp: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    # --- Removido unique=True de whatsapp, a unicidade será por (whatsapp, user_id) ---
    # __table_args__ = (UniqueConstraint('whatsapp', 'user_id', name='uq_contact_whatsapp_user'),) # Adicionar se necessário via Alembic

    observacoes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    owner: Mapped["User"] = relationship(back_populates="contacts")
    atendimentos: Mapped[List["Atendimento"]] = relationship(back_populates="contact", cascade="all, delete-orphan")


class Config(Base):
    __tablename__ = "configs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    nome_config: Mapped[str] = mapped_column(String(100), nullable=False)
    prompt_config: Mapped[dict] = mapped_column(JSONB, nullable=False)
    contexto_json: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))

    owner: Mapped["User"] = relationship(back_populates="configs", foreign_keys=[user_id])


class Atendimento(Base):
    __tablename__ = 'atendimentos'

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    contact_id: Mapped[int] = mapped_column(ForeignKey('contacts.id'))
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'))
    status: Mapped[str] = mapped_column(String(50), default="Aguardando Resposta", index=True) # Aumentado tamanho e adicionado index
    log: Mapped[Optional[str]] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    active_persona_id: Mapped[Optional[int]] = mapped_column(ForeignKey('configs.id'), nullable=True) # Permitir nulo temporariamente
    conversa: Mapped[Optional[str]] = mapped_column(Text, default="[]") # Armazenará JSON como string
    observacoes: Mapped[Optional[str]] = mapped_column(Text, nullable=True, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), index=True) # Adicionado index

    owner: Mapped["User"] = relationship(back_populates="atendimentos")
    contact: Mapped["Contact"] = relationship(back_populates="atendimentos") # Corrigido back_populates
    active_persona: Mapped[Optional["Config"]] = relationship() # Permitir nulo
