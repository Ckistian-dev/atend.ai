# app/db/models.py

from sqlalchemy import ( Column, Integer, String, ForeignKey, Text, DateTime, func, ARRAY )
from sqlalchemy.orm import relationship, DeclarativeBase, Mapped, mapped_column
from sqlalchemy.dialects.postgresql import JSONB
from typing import List, Optional
from datetime import datetime

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    instance_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    tokens: Mapped[int] = mapped_column(Integer, default=0)
    
    default_persona_id: Mapped[Optional[int]] = mapped_column(ForeignKey("configs.id"), nullable=True)
    spreadsheet_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    followup_interval_minutes: Mapped[int] = mapped_column(Integer, default=0)

    configs: Mapped[List["Config"]] = relationship(back_populates="owner", foreign_keys="[Config.user_id]")
    
    atendimentos: Mapped[List["Atendimento"]] = relationship(back_populates="owner")
    contacts: Mapped[List["Contact"]] = relationship(back_populates="owner")


class Contact(Base):
    __tablename__ = "contacts"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    whatsapp: Mapped[str] = mapped_column(String(50), nullable=False, unique=True, index=True)
    observacoes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))

    owner: Mapped["User"] = relationship(back_populates="contacts")


class Config(Base):
    __tablename__ = "configs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    nome_config: Mapped[str] = mapped_column(String(100), nullable=False)
    prompt_config: Mapped[dict] = mapped_column(JSONB, nullable=False)
    contexto_json: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))

    # --- ALTERAÇÃO AQUI ---
    # Também especificamos a FK aqui para o relacionamento inverso ser claro.
    owner: Mapped["User"] = relationship(back_populates="configs", foreign_keys=[user_id])


class Atendimento(Base):
    #... sem alterações aqui
    __tablename__ = 'atendimentos'
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    contact_id: Mapped[int] = mapped_column(ForeignKey('contacts.id'))
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'))
    status: Mapped[str] = mapped_column(String, default="Aguardando Resposta")
    log: Mapped[Optional[str]] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    active_persona_id: Mapped[int] = mapped_column(ForeignKey('configs.id'))
    conversa: Mapped[Optional[str]] = mapped_column(Text, default="[]")
    observacoes: Mapped[Optional[str]] = mapped_column(Text, nullable=True, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    owner: Mapped["User"] = relationship(back_populates="atendimentos")
    contact: Mapped["Contact"] = relationship()
    active_persona: Mapped["Config"] = relationship()