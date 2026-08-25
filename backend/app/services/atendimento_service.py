# app/services/atendimento_service.py

import logging
import json
import uuid
import csv
import io
import copy
import mimetypes
import asyncio
from typing import List, Dict, Any, Optional, Tuple, AsyncGenerator
from datetime import datetime, timezone, timedelta

# Importações de terceiros
import pytz
import httpx
from sqlalchemy import select, func, cast, or_
from sqlalchemy.orm import joinedload, selectinload
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession

# Importações de módulos locais
from app.core.config import settings
from app.db import models, schemas
from app.crud import crud_atendimento, crud_user
from app.services.whatsapp_service import WhatsAppService, get_whatsapp_service, MessageSendError, format_whatsapp_number
from app.services.gemini_service import GeminiService, get_gemini_service
from app.services.google_sheets_service import GoogleSheetsService

# Configuração do logger
logger = logging.getLogger(__name__)


class AtendimentoNotFoundError(Exception):
    """Exceção lançada quando um atendimento não é encontrado."""
    pass


class AtendimentoConflictError(Exception):
    """Exceção lançada quando há um conflito de dados (ex: número duplicado)."""
    pass


class AtendimentoService:
    """
    Serviço responsável por toda a lógica de negócio relacionada aos atendimentos.
    
    Esta classe encapsula manipulações de banco de dados, interações com APIs
    externas (Meta/WhatsApp, Gemini, Google Sheets) e validações multitenant.
    """

    @staticmethod
    async def export_atendimentos(
        db: AsyncSession,
        company_id: int,
        search: Optional[str] = None,
        status: Optional[List[str]] = None,
        tags: Optional[List[str]] = None,
        department: Optional[str] = None,
        assigned_user_id: Optional[int] = None,
        time_start: Optional[str] = None,
        time_end: Optional[str] = None,
        current_user: Optional[models.User] = None
    ) -> AsyncGenerator[str, None]:
        """
        Gera um fluxo de dados em formato CSV para exportação em lote de atendimentos.
        Utiliza streaming para economizar memória do servidor ao processar grandes volumes.
        Aplica regras de visibilidade e filtros de setor/usuário.
        """
        stmt_base = select(models.Atendimento).where(models.Atendimento.company_id == company_id)

        is_admin = False
        if current_user:
            is_admin = (current_user.role == "admin" or getattr(current_user, "is_superuser", False))

        # Restrição de visibilidade para usuários comuns (não-admins)
        if current_user and not is_admin:
            # 1. Usuários comuns não veem atendimentos em processamento exclusivo da IA
            ai_statuses = ["Mensagem Recebida", "Gerando Resposta", "Aguardando Resposta", "Aguardando Envio"]
            stmt_base = stmt_base.where(models.Atendimento.status.notin_(ai_statuses))

            # 2. Apenas atendimentos do setor do usuário, atribuídos a ele ou tagueados
            user_dept = (current_user.department or "").strip()
            user_name = (current_user.name or "").strip()
            user_email = (current_user.email or "").strip()

            user_filters = [models.Atendimento.assigned_user_id == current_user.id]
            if user_dept:
                user_filters.append(models.Atendimento.assigned_department == user_dept)
            if user_name:
                user_filters.append(cast(models.Atendimento.tags, JSONB).contains([{'name': user_name}]))
            if user_email:
                user_filters.append(cast(models.Atendimento.tags, JSONB).contains([{'name': user_email}]))

            stmt_base = stmt_base.where(or_(*user_filters))
        else:
            # Filtros opcionais para admin
            if department and department.strip():
                stmt_base = stmt_base.where(models.Atendimento.assigned_department == department.strip())
            if assigned_user_id:
                stmt_base = stmt_base.where(models.Atendimento.assigned_user_id == assigned_user_id)

        last_client_ts = func.get_last_user_msg_timestamp(models.Atendimento.conversa)
        sort_expression = func.coalesce(last_client_ts, models.Atendimento.updated_at)

        if status:
            stmt_base = stmt_base.where(models.Atendimento.status.in_(status))

        if tags:
            conditions = [cast(models.Atendimento.tags, JSONB).contains([{'name': tag}]) for tag in tags]
            stmt_base = stmt_base.where(or_(*conditions))

        sao_paulo_tz = pytz.timezone('America/Sao_Paulo')

        # Converte as datas locais informadas na requisição para UTC antes de buscar no banco
        if time_start:
            try:
                local_dt_naive = datetime.fromisoformat(time_start)
                local_dt_aware = sao_paulo_tz.localize(local_dt_naive)
                start_datetime_utc = local_dt_aware.astimezone(pytz.utc)
                stmt_base = stmt_base.where(sort_expression >= start_datetime_utc)
            except Exception:
                pass

        if time_end:
            try:
                local_dt_naive = datetime.fromisoformat(time_end)
                local_dt_aware = sao_paulo_tz.localize(local_dt_naive)
                end_datetime_utc = local_dt_aware.astimezone(pytz.utc)
                stmt_base = stmt_base.where(sort_expression <= end_datetime_utc)
            except Exception:
                pass

        if search:
            search_term = f"%{search.lower()}%"
            stmt_base = stmt_base.where(
                (models.Atendimento.whatsapp.ilike(search_term)) |
                (models.Atendimento.status.ilike(search_term)) |
                (models.Atendimento.resumo.ilike(search_term)) |
                (models.Atendimento.assigned_department.ilike(search_term))
            )

        async def stream_csv():
            yield "\uFEFF"  # BOM para Excel abrir UTF-8 corretamente
            
            output = io.StringIO()
            writer = csv.writer(output, delimiter=',', quoting=csv.QUOTE_MINIMAL)
            
            # Cabeçalho do arquivo
            writer.writerow(["WhatsApp", "Nome do Contato", "Situação", "Setor / Departamento", "Atendente Atribuído", "Resumo", "Observações", "Tags", "Persona Ativa", "Criado em", "Última Atualização", "Conversa"])
            yield output.getvalue()
            output.seek(0)
            output.truncate(0)

            # Processamento em lotes (batch) para economizar recursos de RAM
            batch_size = 1000
            offset = 0

            while True:
                stmt_batch = (
                    stmt_base.order_by(sort_expression.desc())
                    .offset(offset)
                    .limit(batch_size)
                    .options(
                        joinedload(models.Atendimento.active_persona),
                        joinedload(models.Atendimento.assigned_user)
                    )
                )
                result = await db.execute(stmt_batch)
                items = result.scalars().unique().all()

                if not items:
                    break

                for item in items:
                    tags_str = "; ".join([t['name'] for t in item.tags]) if item.tags else ""
                    persona_name = item.active_persona.nome_config if item.active_persona else ""
                    assigned_user_name = item.assigned_user.name if item.assigned_user else (item.assigned_user.email if item.assigned_user else "")
                    writer.writerow([
                        item.whatsapp,
                        item.nome_contato or "",
                        item.status,
                        item.assigned_department or "",
                        assigned_user_name,
                        item.resumo or "",
                        item.observacoes or "",
                        tags_str,
                        persona_name,
                        item.created_at,
                        item.updated_at,
                        item.conversa or ""
                    ])
                
                yield output.getvalue()
                output.seek(0)
                output.truncate(0)
                offset += batch_size

        return stream_csv()

    @staticmethod
    async def get_atendimentos(
        db: AsyncSession,
        company_id: int,
        search: Optional[str] = None,
        status: Optional[List[str]] = None,
        tags: Optional[List[str]] = None,
        department: Optional[str] = None,
        assigned_user_id: Optional[int] = None,
        page: int = 1,
        limit: int = 20,
        time_start: Optional[str] = None,
        time_end: Optional[str] = None,
        sort_by: Optional[str] = None,
        sort_order: Optional[str] = "desc",
        current_user: Optional[models.User] = None
    ) -> Dict[str, Any]:
        """
        Busca e pagina atendimentos com base em filtros, ordenação e permissões de visibilidade.
        """
        skip = (page - 1) * limit
        stmt_base = select(models.Atendimento).where(models.Atendimento.company_id == company_id)

        is_admin = False
        if current_user:
            is_admin = (current_user.role == "admin" or getattr(current_user, "is_superuser", False))

        # Restrição de visibilidade para usuários comuns (não-admins)
        if current_user and not is_admin:
            # 1. Usuários comuns não visualizam atendimentos que ainda estão sob controle da IA
            ai_statuses = ["Mensagem Recebida", "Gerando Resposta", "Aguardando Resposta", "Aguardando Envio"]
            stmt_base = stmt_base.where(models.Atendimento.status.notin_(ai_statuses))

            # 2. Apenas atendimentos do setor do usuário, atribuídos a ele ou tagueados com seu nome
            user_dept = (current_user.department or "").strip()
            user_name = (current_user.name or "").strip()
            user_email = (current_user.email or "").strip()

            user_filters = [models.Atendimento.assigned_user_id == current_user.id]
            if user_dept:
                user_filters.append(models.Atendimento.assigned_department == user_dept)
            if user_name:
                user_filters.append(cast(models.Atendimento.tags, JSONB).contains([{'name': user_name}]))
            if user_email:
                user_filters.append(cast(models.Atendimento.tags, JSONB).contains([{'name': user_email}]))

            stmt_base = stmt_base.where(or_(*user_filters))
        else:
            # Filtros opcionais para admin
            if department and department.strip():
                stmt_base = stmt_base.where(models.Atendimento.assigned_department == department.strip())
            if assigned_user_id:
                stmt_base = stmt_base.where(models.Atendimento.assigned_user_id == assigned_user_id)

        # Ordenação padrão pela última mensagem do cliente
        last_client_ts = func.get_last_user_msg_timestamp(models.Atendimento.conversa)
        sort_expression_default = func.coalesce(last_client_ts, models.Atendimento.updated_at)

        # Definição do campo de ordenação solicitado pelo frontend
        if sort_by == 'contato':
            sort_field = func.coalesce(models.Atendimento.nome_contato, models.Atendimento.whatsapp)
        elif sort_by == 'status':
            sort_field = models.Atendimento.status
        elif sort_by == 'agente':
            sort_field = models.Atendimento.active_persona_id
        elif sort_by == 'department' or sort_by == 'setor':
            sort_field = models.Atendimento.assigned_department
        elif sort_by == 'atualizacao':
            sort_field = sort_expression_default
        else:
            sort_field = sort_expression_default

        final_sort = sort_field.asc() if sort_order == 'asc' else sort_field.desc()

        if status:
            stmt_base = stmt_base.where(models.Atendimento.status.in_(status))

        if tags:
            conditions = [cast(models.Atendimento.tags, JSONB).contains([{'name': tag}]) for tag in tags]
            stmt_base = stmt_base.where(or_(*conditions))

        sao_paulo_tz = pytz.timezone('America/Sao_Paulo')

        if time_start:
            try:
                local_dt_naive = datetime.fromisoformat(time_start)
                local_dt_aware = sao_paulo_tz.localize(local_dt_naive)
                start_datetime_utc = local_dt_aware.astimezone(pytz.utc)
                stmt_base = stmt_base.where(sort_expression_default >= start_datetime_utc)
            except Exception as e:
                logger.warning(f"Formato de time_start inválido: '{time_start}'. Ignorando filtro. Erro: {e}")

        if time_end:
            try:
                local_dt_naive = datetime.fromisoformat(time_end)
                local_dt_aware = sao_paulo_tz.localize(local_dt_naive)
                end_datetime_utc = local_dt_aware.astimezone(pytz.utc)
                stmt_base = stmt_base.where(sort_expression_default <= end_datetime_utc)
            except Exception as e:
                logger.warning(f"Formato de time_end inválido: '{time_end}'. Ignorando filtro. Erro: {e}")

        if search:
            search_term = f"%{search.lower()}%"
            stmt_base = stmt_base.where(
                (models.Atendimento.whatsapp.ilike(search_term)) |
                (models.Atendimento.status.ilike(search_term)) |
                (models.Atendimento.resumo.ilike(search_term)) |
                (models.Atendimento.assigned_department.ilike(search_term))
            )

        # Conta o número de linhas para a resposta paginada
        stmt_count = select(func.count()).select_from(stmt_base.subquery())
        total_result = await db.execute(stmt_count)
        total = total_result.scalar() or 0

        # Monta a consulta final com offset, limit e joinedload
        stmt_data = (
            stmt_base.order_by(final_sort)
            .offset(skip)
            .limit(limit)
            .options(
                joinedload(models.Atendimento.active_persona),
                joinedload(models.Atendimento.assigned_user),
                selectinload(models.Atendimento.mensagens)
            )
        )
        data_result = await db.execute(stmt_data)
        items = data_result.scalars().unique().all()

        return {"total": total, "items": items}

    @staticmethod
    async def get_user_tags(db: AsyncSession, company_id: int) -> List[Dict[str, str]]:
        """
        Retorna todas as tags utilizadas no escopo da empresa.

        @param db: Sessão do banco de dados.
        @param company_id: ID da empresa.
        @returns: Lista de tags com nome e cor associada.
        """
        return await crud_atendimento.get_all_user_tags(db, company_id=company_id)

    @staticmethod
    async def get_company_departments(db: AsyncSession, company_id: int) -> List[str]:
        """
        Retorna a lista de setores / departamentos configurados na empresa.
        """
        return await crud_atendimento.get_company_departments(db, company_id=company_id)

    @staticmethod
    async def delete_tag_from_company(db: AsyncSession, company_id: int, tag_name: str) -> Dict[str, str]:
        """
        Deleta uma determinada tag de todos os atendimentos pertencentes à empresa.
        """
        try:
            affected_rows = await crud_atendimento.delete_tag_from_all_atendimentos(
                db, company_id=company_id, tag_name=tag_name
            )
            await db.commit()
            return {"message": f"Tag '{tag_name}' excluída de {affected_rows} atendimentos."}
        except Exception as e:
            await db.rollback()
            logger.error(f"Erro ao excluir tag {tag_name} da empresa {company_id}: {e}")
            raise e

    @staticmethod
    async def get_atendimento_by_id(
        db: AsyncSession,
        company_id: int,
        atendimento_id: int,
        current_user: Optional[models.User] = None
    ) -> models.Atendimento:
        """
        Obtém um atendimento por ID garantindo a propriedade do tenant e controle de visibilidade.
        """
        stmt = (
            select(models.Atendimento)
            .where(
                models.Atendimento.id == atendimento_id,
                models.Atendimento.company_id == company_id
            )
            .options(
                joinedload(models.Atendimento.active_persona),
                joinedload(models.Atendimento.assigned_user),
                selectinload(models.Atendimento.mensagens)
            )
        )
        result = await db.execute(stmt)
        db_atendimento = result.scalars().first()
        if not db_atendimento:
            raise AtendimentoNotFoundError("Atendimento não encontrado")

        # Validação de visibilidade para usuários não-admin
        if current_user and not (current_user.role == "admin" or getattr(current_user, "is_superuser", False)):
            ai_statuses = ["Mensagem Recebida", "Gerando Resposta", "Aguardando Resposta", "Aguardando Envio"]
            if db_atendimento.status in ai_statuses:
                raise AtendimentoNotFoundError("Atendimento em processamento pela IA.")

            user_dept = (current_user.department or "").strip()
            user_name = (current_user.name or "").strip()
            user_email = (current_user.email or "").strip()

            is_assigned = (db_atendimento.assigned_user_id == current_user.id)
            is_dept = bool(user_dept and db_atendimento.assigned_department and db_atendimento.assigned_department.strip().lower() == user_dept.lower())
            
            tags_list = db_atendimento.tags or []
            tag_names = [t.get("name", "").strip().lower() for t in tags_list if isinstance(t, dict)]
            is_tagged = bool((user_name and user_name.lower() in tag_names) or (user_email and user_email.lower() in tag_names))

            if not (is_assigned or is_dept or is_tagged):
                raise AtendimentoNotFoundError("Atendimento não atribuído ao seu setor/usuário.")

        return db_atendimento

    @staticmethod
    async def transfer_atendimento(
        db: AsyncSession,
        company_id: int,
        atendimento_id: int,
        department: Optional[str] = None,
        user_id: Optional[int] = None,
        notes: Optional[str] = None,
        current_user: Optional[models.User] = None
    ) -> models.Atendimento:
        """
        Transfere um atendimento para um setor (departamento) e/ou atendente humano específico.
        Atualiza o status para 'Atendente Chamado'.
        """
        stmt = (
            select(models.Atendimento)
            .where(
                models.Atendimento.id == atendimento_id,
                models.Atendimento.company_id == company_id
            )
            .options(
                joinedload(models.Atendimento.active_persona),
                joinedload(models.Atendimento.assigned_user),
                selectinload(models.Atendimento.mensagens)
            )
        )
        result = await db.execute(stmt)
        db_atendimento = result.scalars().first()
        if not db_atendimento:
            raise AtendimentoNotFoundError("Atendimento não encontrado")

        db_atendimento.status = "Atendente Chamado"

        if department is not None:
            db_atendimento.assigned_department = department.strip() if department.strip() else None

        if user_id is not None:
            db_atendimento.assigned_user_id = user_id if user_id > 0 else None

        if notes and notes.strip():
            clean_notes = notes.strip()
            transfer_msg = f"[Transferido para {department or 'Atendente'}]: {clean_notes}"
            db_atendimento.observacoes = f"{db_atendimento.observacoes or ''}\n{transfer_msg}".strip()

        db_atendimento.updated_at = datetime.now(timezone.utc)
        db.add(db_atendimento)
        await db.commit()
        await db.refresh(db_atendimento, attribute_names=['active_persona', 'assigned_user', 'mensagens'])
        return db_atendimento

    @staticmethod
    async def update_atendimento(
        db: AsyncSession,
        company_id: int,
        atendimento_id: int,
        atendimento_in: schemas.AtendimentoUpdate
    ) -> models.Atendimento:
        """
        Atualiza campos de um atendimento.
        """
        db_atendimento = await crud_atendimento.get_atendimento(db, atendimento_id=atendimento_id, company_id=company_id)
        if not db_atendimento:
            raise AtendimentoNotFoundError("Atendimento não encontrado")

        updated_atendimento = await crud_atendimento.update_atendimento(
            db, db_atendimento=db_atendimento, atendimento_in=atendimento_in
        )
        await db.commit()
        await db.refresh(updated_atendimento, attribute_names=['active_persona', 'assigned_user', 'mensagens'])
        return updated_atendimento

    @staticmethod
    async def mark_as_read(
        db: AsyncSession,
        company: models.Company,
        company_id: int,
        atendimento_id: int,
        whatsapp_service: WhatsAppService
    ) -> models.Atendimento:
        """
        Marca todas as mensagens do cliente no atendimento como lidas na tabela 'mensagens'
        e envia a confirmação de leitura (recibo / tiques azuis) para a API da Meta WhatsApp.
        """
        db_atendimento = await crud_atendimento.get_atendimento(db, atendimento_id=atendimento_id, company_id=company_id)
        if not db_atendimento:
            raise AtendimentoNotFoundError("Atendimento não encontrado")

        updated_atendimento, wamid_list = await crud_atendimento.mark_atendimento_messages_as_read(
            db=db,
            company_id=company_id,
            atendimento_id=atendimento_id
        )
        await db.commit()

        # Envia recibos de leitura para a Meta de forma assíncrona se houver WAMIDs
        if wamid_list and company and company.wbp_phone_number_id:
            try:
                asyncio.create_task(whatsapp_service.mark_messages_as_read_batch(company, wamid_list))
            except Exception as meta_err:
                logger.warning(f"Erro ao disparar recibos de leitura para a Meta: {meta_err}")

        await db.refresh(updated_atendimento, attribute_names=['active_persona', 'assigned_user', 'mensagens'])
        return updated_atendimento

    @staticmethod
    async def mark_as_unread(
        db: AsyncSession,
        company_id: int,
        atendimento_id: int
    ) -> models.Atendimento:
        """
        Marca a última mensagem do cliente no atendimento como não lida ('unread') na tabela 'mensagens'.
        """
        db_atendimento = await crud_atendimento.get_atendimento(db, atendimento_id=atendimento_id, company_id=company_id)
        if not db_atendimento:
            raise AtendimentoNotFoundError("Atendimento não encontrado")

        updated_atendimento = await crud_atendimento.mark_atendimento_messages_as_unread(
            db=db,
            company_id=company_id,
            atendimento_id=atendimento_id
        )
        await db.commit()
        await db.refresh(updated_atendimento, attribute_names=['active_persona', 'assigned_user', 'mensagens'])
        return updated_atendimento

    @staticmethod
    async def create_atendimento(
        db: AsyncSession,
        company_id: int,
        atendimento_in: schemas.AtendimentoCreate
    ) -> models.Atendimento:
        """
        Cria manualmente um novo atendimento para a empresa.
        """
        atendimento_in.whatsapp = format_whatsapp_number(atendimento_in.whatsapp)

        existing_query = await db.execute(select(models.Atendimento).where(
            models.Atendimento.whatsapp == atendimento_in.whatsapp,
            models.Atendimento.company_id == company_id
        ))
        if existing_query.scalars().first():
            raise AtendimentoConflictError("Já existe um atendimento para este número.")

        db_atendimento = await crud_atendimento.create_atendimento(
            db=db, atendimento_in=atendimento_in, company_id=company_id
        )
        await db.commit()
        await db.refresh(db_atendimento, attribute_names=['active_persona', 'assigned_user', 'mensagens'])
        return db_atendimento

    @staticmethod
    async def delete_atendimento(db: AsyncSession, company_id: int, atendimento_id: int) -> models.Atendimento:
        """
        Remove um atendimento do banco de dados.

        @param db: Sessão do banco de dados.
        @param company_id: ID da empresa.
        @param atendimento_id: ID do atendimento.
        @returns: O atendimento removido.
        @raises AtendimentoNotFoundError: Caso o atendimento não seja localizado.
        """
        deleted_atendimento = await crud_atendimento.delete_atendimento(
            db, atendimento_id=atendimento_id, company_id=company_id
        )
        if not deleted_atendimento:
            raise AtendimentoNotFoundError("Atendimento não encontrado")
        await db.commit()
        return deleted_atendimento

    @staticmethod
    async def send_manual_message(
        db: AsyncSession,
        company: models.Company,
        company_id: int,
        atendimento_id: int,
        text: str,
        whatsapp_service: WhatsAppService
    ) -> models.Atendimento:
        """
        Realiza o envio de uma mensagem de texto manual e a persiste no histórico.

        @param db: Sessão do banco de dados.
        @param company: Modelo da empresa (contém credenciais do WBP).
        @param company_id: ID da empresa.
        @param atendimento_id: ID do atendimento.
        @param text: Conteúdo de texto da mensagem.
        @param whatsapp_service: Instância do serviço de WhatsApp.
        @returns: O atendimento atualizado.
        """
        db_atendimento = await crud_atendimento.get_atendimento(db, atendimento_id=atendimento_id, company_id=company_id)
        if not db_atendimento or not db_atendimento.whatsapp:
            raise AtendimentoNotFoundError("Atendimento ou contato não encontrado")

        whatsapp_number = db_atendimento.whatsapp

        try:
            send_result = await whatsapp_service.send_text_message(
                company=company,
                number=whatsapp_number,
                text=text
            )
            
            logger.info(f"Mensagem manual enviada para {whatsapp_number} (Atendimento ID: {atendimento_id}). API Msg ID: {send_result.get('id')}")

            message_id = send_result.get('id') or f"manual-{uuid.uuid4()}"
            timestamp_epoch = send_result.get('timestamp', int(datetime.now(timezone.utc).timestamp()))
            
            formatted_message = schemas.FormattedMessage(
                id=str(message_id),
                role='assistant',
                content=text,
                timestamp=timestamp_epoch,
                status="sent",
                is_ai=False
            )

            atendimento_atualizado = await crud_atendimento.add_message_to_conversa(
                db=db,
                atendimento_id=atendimento_id,
                company_id=company_id,
                message=formatted_message
            )
            
            if not atendimento_atualizado:
                raise Exception("Falha ao salvar mensagem no histórico após envio")
            
            await db.refresh(atendimento_atualizado, attribute_names=['active_persona', 'mensagens'])
            return atendimento_atualizado

        except Exception as e:
            await db.rollback()
            raise e

    @staticmethod
    async def send_manual_media_message(
        db: AsyncSession,
        company: models.Company,
        company_id: int,
        atendimento_id: int,
        file_bytes: bytes,
        filename: str,
        mimetype: Optional[str],
        media_type: str,
        caption: Optional[str],
        whatsapp_service: WhatsAppService
    ) -> models.Atendimento:
        """
        Realiza o upload e envio de um arquivo de mídia e a persiste no histórico e banco de dados (media_bytes).

        @param db: Sessão do banco de dados.
        @param company: Modelo da empresa.
        @param company_id: ID da empresa.
        @param atendimento_id: ID do atendimento.
        @param file_bytes: Bytes do arquivo a ser enviado.
        @param filename: Nome do arquivo.
        @param mimetype: Mimetype do arquivo.
        @param media_type: Tipo de mídia ('image', 'audio', 'document', 'video').
        @param caption: Legenda (opcional).
        @param whatsapp_service: Serviço de envio de mensagens do WhatsApp.
        @returns: O atendimento atualizado.
        """
        db_atendimento = await crud_atendimento.get_atendimento(db, atendimento_id=atendimento_id, company_id=company_id)
        if not db_atendimento or not db_atendimento.whatsapp:
            raise AtendimentoNotFoundError("Atendimento ou contato não encontrado")

        if media_type not in ['image', 'audio', 'document', 'video']:
            raise ValueError("Tipo de mídia inválido.")

        whatsapp_number = db_atendimento.whatsapp

        try:
            if not mimetype:
                mimetype, _ = mimetypes.guess_type(filename)
                if not mimetype:
                    mimetype = 'application/octet-stream'

            logger.info(f"Enviando mídia manual (Tipo: {media_type}, Nome: {filename}) para Atendimento {atendimento_id}")

            if media_type == 'document':
                generated_content = f"[Documento enviado: {filename}]"
            elif media_type == 'audio':
                generated_content = f"[Áudio enviado: {filename}]"
                try:
                    from app.services.gemini_service import get_gemini_service
                    gemini_svc = get_gemini_service()
                    transcription = await gemini_svc.transcribe_and_analyze_media(
                        media_data={"data": file_bytes, "mime_type": mimetype or "audio/ogg"},
                        db_history=[],
                        persona=None,
                        db=db,
                        company=company,
                        atendimento_id=atendimento_id
                    )
                    if transcription and not transcription.startswith("[Erro"):
                        generated_content = f"[Áudio Transcrito]: {transcription.strip()}"
                except Exception as trans_err:
                    logger.warning(f"Aviso: Não foi possível transcrever áudio manual: {trans_err}")
            elif media_type == 'image':
                generated_content = f"[Imagem enviada: {filename}]"
            else:
                generated_content = f"[Vídeo enviado: {filename}]"

            send_result = await whatsapp_service.send_media_message(
                company=company,
                number=whatsapp_number,
                media_type=media_type,
                file_bytes=file_bytes,
                filename=filename,
                mimetype=mimetype,
                caption=caption
            )
            
            logger.info(f"Mídia manual enviada para {whatsapp_number}. API Msg ID: {send_result.get('id')}")

            message_id = send_result.get('id') or f"manual-{uuid.uuid4()}"
            timestamp_epoch = send_result.get('timestamp', int(datetime.now(timezone.utc).timestamp()))
            media_id_from_send = send_result.get("media_id")
            final_mimetype_saved = 'audio/mpeg' if media_type == 'audio' else mimetype

            formatted_message = schemas.FormattedMessage(
                id=str(message_id),
                role='assistant',
                content=generated_content,
                caption=caption,
                timestamp=timestamp_epoch,
                type=media_type,
                url=None,
                filename=filename,
                media_id=media_id_from_send,
                mime_type=final_mimetype_saved,
                status="sent",
                is_ai=False
            )

            # Persiste a mensagem E os bytes da mídia diretamente no banco de dados
            atendimento_atualizado = await crud_atendimento.add_message_to_conversa(
                db=db,
                atendimento_id=atendimento_id,
                company_id=company_id,
                message=formatted_message,
                media_bytes=file_bytes
            )
            
            if not atendimento_atualizado:
                raise Exception("Falha ao salvar mídia no histórico após envio")

            await db.refresh(atendimento_atualizado, attribute_names=['active_persona', 'mensagens'])
            return atendimento_atualizado

        except Exception as e:
            await db.rollback()
            raise e

    @staticmethod
    async def create_bulk_disparos(
        db: AsyncSession,
        company: models.Company,
        company_id: int,
        file_content: Optional[str],
        atendimento_ids_str: Optional[str],
        media_file_bytes: Optional[bytes],
        media_filename: Optional[str],
        media_mimetype: Optional[str],
        template_name: str,
        persona_id: int,
        observacoes: Optional[str],
        template_params_str: Optional[str],
        whatsapp_service: WhatsAppService
    ) -> Dict[str, Any]:
        """
        Recebe contatos e enfileira disparos em lote no banco de dados.

        @param db: Sessão do banco de dados.
        @param company: Modelo da empresa.
        @param company_id: ID da empresa.
        # ... (parâmetros do lote e arquivos)
        @returns: Dicionário contendo a quantidade de atendimentos enfileirados.
        """
        if not file_content and not atendimento_ids_str:
            raise ValueError("Forneça um arquivo CSV ou uma lista de IDs.")
        
        params_dict = {"components": []}
        if template_params_str:
            try:
                params_dict = json.loads(template_params_str)
            except Exception:
                logger.warning(f"Falha ao parsear template_params no bulk: {template_params_str}")

        wbp_phone_number_id = company.wbp_phone_number_id if company else None

        # Upload único do cabeçalho de mídia para otimização de banda da Meta
        if media_file_bytes and wbp_phone_number_id:
            actual_mime = media_mimetype or (mimetypes.guess_type(media_filename)[0] if media_filename else 'application/octet-stream')
            
            media_type = 'document'
            if actual_mime.startswith('image/'):
                media_type = 'image'
            elif actual_mime.startswith('video/'):
                media_type = 'video'
            
            media_id = await whatsapp_service._upload_media_official(
                phone_number_id=wbp_phone_number_id,
                access_token=settings.WBP_ACCESS_TOKEN,
                file_bytes=media_file_bytes,
                mimetype=actual_mime,
                filename=media_filename or "bulk_media",
                media_type=media_type
            )
            
            if media_id:
                components = params_dict.get("components", [])
                header_comp = next((c for c in components if c['type'] == 'header'), None)
                if not header_comp:
                    header_comp = {"type": "header", "parameters": []}
                    components.insert(0, header_comp)
                
                header_comp['parameters'].append({
                    "type": media_type,
                    media_type: {"id": media_id}
                })
                params_dict["components"] = components

        count = 0
        
        # Processamento a partir de arquivo CSV
        if file_content:
            reader = csv.DictReader(io.StringIO(file_content))
            for row in reader:
                number = format_whatsapp_number(row.get('whatsapp', ''))
                nome_csv = row.get('nome', '') or row.get('Nome', '') or row.get('NOME', '')
                obs_csv = (row.get('observacoes', '') or row.get('Observacoes', '') or
                           row.get('OBSERVACOES', '') or row.get('observações', '') or '').strip()
                combined_obs = '\n'.join(filter(None, [observacoes, obs_csv])).strip() or None

                if not number:
                    continue
                
                existing = await db.execute(select(models.Atendimento).where(
                    models.Atendimento.whatsapp == number,
                    models.Atendimento.company_id == company_id
                ))
                existing_at = existing.scalars().first()
                
                if existing_at:
                    nome_contato = nome_csv if nome_csv else (existing_at.nome_contato or "")
                    row_params = copy.deepcopy(params_dict)
                    for comp in row_params.get("components", []):
                        for param in comp.get("parameters", []):
                            if param.get("type") == "text" and isinstance(param.get("text"), str):
                                param["text"] = param["text"].replace("{nome}", nome_contato).replace("{NOME}", nome_contato)

                    existing_at.status = "Aguardando Envio"
                    existing_at.bulk_template_name = template_name
                    existing_at.bulk_template_params = row_params
                    existing_at.active_persona_id = persona_id
                    if nome_csv and not existing_at.nome_contato:
                        existing_at.nome_contato = nome_csv
                    if combined_obs:
                        existing_at.observacoes = f"{existing_at.observacoes or ''}\n{combined_obs}".strip()
                    db.add(existing_at)
                else:
                    row_params = copy.deepcopy(params_dict)
                    for comp in row_params.get("components", []):
                        for param in comp.get("parameters", []):
                            if param.get("type") == "text" and isinstance(param.get("text"), str):
                                param["text"] = param["text"].replace("{nome}", nome_csv).replace("{NOME}", nome_csv)

                    new_at = models.Atendimento(
                        whatsapp=number,
                        nome_contato=nome_csv,
                        company_id=company_id,
                        status="Aguardando Envio",
                        active_persona_id=persona_id,
                        bulk_template_name=template_name,
                        observacoes=combined_obs,
                        bulk_template_params=row_params
                    )
                    db.add(new_at)
                count += 1

        # Processamento via lista de IDs enviados graficamente
        if atendimento_ids_str:
            try:
                ids_list = json.loads(atendimento_ids_str)
                if isinstance(ids_list, list):
                    for at_id in ids_list:
                        existing = await db.execute(select(models.Atendimento).where(
                            models.Atendimento.id == int(at_id),
                            models.Atendimento.company_id == company_id
                        ))
                        existing_at = existing.scalars().first()
                        if existing_at:
                            nome_contato = existing_at.nome_contato or ""
                            id_params = copy.deepcopy(params_dict)
                            for comp in id_params.get("components", []):
                                for param in comp.get("parameters", []):
                                    if param.get("type") == "text" and isinstance(param.get("text"), str):
                                        param["text"] = param["text"].replace("{nome}", nome_contato).replace("{NOME}", nome_contato)

                            existing_at.status = "Aguardando Envio"
                            existing_at.bulk_template_name = template_name
                            existing_at.bulk_template_params = id_params
                            existing_at.active_persona_id = persona_id
                            if observacoes:
                                existing_at.observacoes = f"{existing_at.observacoes or ''}\n{observacoes}".strip()
                            db.add(existing_at)
                            count += 1
            except Exception as e:
                logger.error(f"Erro ao processar atendimento_ids no bulk: {e}")
        
        await db.commit()
        return {"message": f"{count} atendimentos enfileirados para envio."}
