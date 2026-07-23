import logging
from typing import List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import joinedload
from app.db import models, schemas
from app.services import security
from app.crud import crud_user

logger = logging.getLogger(__name__)

class UserService:
    @staticmethod
    async def update_user_me(
        db: AsyncSession,
        current_user: models.User,
        user_in: schemas.UserUpdate
    ) -> models.User:
        """
        Permite que o usuário atualize suas próprias informações.

        @param db: Sessão do banco de dados.
        @param current_user: Modelo do usuário logado.
        @param user_in: Esquema com dados de atualização.
        @returns: Modelo do usuário atualizado.
        """
        update_data = user_in.model_dump(exclude_unset=True)

        # Não permite atualizar permissões ou role de si mesmo através desta rota
        for blocked in ("permissions", "role", "company_id", "atendente_online"):
            update_data.pop(blocked, None)

        # Update company-level followup settings if user is admin/superuser
        has_followup_updates = "followup_active" in update_data or "followup_config" in update_data
        if has_followup_updates:
            followup_active = update_data.pop("followup_active", None)
            followup_config = update_data.pop("followup_config", None)
            if current_user.company_id and (current_user.role == "admin" or getattr(current_user, "is_superuser", False)):
                company = await db.get(models.Company, current_user.company_id)
                if company:
                    if followup_active is not None:
                        company.followup_active = followup_active
                    if followup_config is not None:
                        company.followup_config = followup_config
                    db.add(company)

        if "password" in update_data and update_data["password"]:
            current_user.hashed_password = security.get_password_hash(update_data["password"])
            del update_data["password"]

        for field, value in update_data.items():
            if hasattr(current_user, field):
                setattr(current_user, field, value)
                
        db.add(current_user)
        await db.commit()
        
        # Reload user with company relationship to ensure fresh serialized data
        stmt = select(models.User).where(models.User.id == current_user.id).options(joinedload(models.User.company))
        res = await db.execute(stmt)
        updated_user = res.scalars().first()
        return updated_user or current_user

    @staticmethod
    async def list_company_users(
        db: AsyncSession,
        current_user: models.User
    ) -> List[models.User]:
        """
        Lista todos os usuários associados à empresa do administrador logado.

        @param db: Sessão do banco de dados.
        @param current_user: Modelo do administrador/superuser logado.
        @returns: Lista de usuários associados à empresa.
        """
        stmt = select(models.User)
        if not getattr(current_user, "is_superuser", False):
            stmt = stmt.where(models.User.company_id == current_user.company_id)
        
        result = await db.execute(stmt)
        return list(result.scalars().all())

    @staticmethod
    async def create_company_user(
        db: AsyncSession,
        current_user: models.User,
        user_in: schemas.UserCreateByAdmin
    ) -> models.User:
        """
        Permite que um administrador crie novos usuários vinculados à sua empresa.

        @param db: Sessão do banco de dados.
        @param current_user: Modelo do administrador/superuser logado.
        @param user_in: Esquema com dados de criação do novo usuário.
        @returns: Novo modelo de usuário criado.
        """
        existing_user = await crud_user.get_user_by_email(db, email=user_in.email)
        if existing_user:
            raise ValueError("Email já cadastrado.")

        company_id = current_user.company_id
        if getattr(current_user, "is_superuser", False) and user_in.company_id:
            company_id = user_in.company_id

        hashed_password = security.get_password_hash(user_in.password)

        db_user = models.User(
            email=user_in.email,
            name=user_in.name,
            hashed_password=hashed_password,
            role=user_in.role or "user",
            company_id=company_id,
            permissions=user_in.permissions,
            participates_distribution=user_in.participates_distribution or False,
            profile_color=user_in.profile_color or "#3b82f6"
        )
        db.add(db_user)
        await db.commit()
        await db.refresh(db_user)
        return db_user

    @staticmethod
    async def update_company_user(
        db: AsyncSession,
        current_user: models.User,
        user_id: int,
        user_in: schemas.UserUpdate
    ) -> models.User:
        """
        Permite que um administrador atualize credenciais e permissões de usuários.

        @param db: Sessão do banco de dados.
        @param current_user: Modelo do administrador/superuser logado.
        @param user_id: ID do usuário a ser atualizado.
        @param user_in: Esquema com dados de atualização.
        @returns: Modelo do usuário atualizado.
        """
        stmt = select(models.User).where(models.User.id == user_id)
        if not getattr(current_user, "is_superuser", False):
            stmt = stmt.where(models.User.company_id == current_user.company_id)
        
        result = await db.execute(stmt)
        db_user = result.scalar_one_or_none()
        if not db_user:
            raise ValueError("Usuário não encontrado.")

        # Superusers podem mudar qualquer campo, admins da empresa não podem alterar company_id
        update_data = user_in.model_dump(exclude_unset=True)
        if not getattr(current_user, "is_superuser", False) and "company_id" in update_data:
            del update_data["company_id"]

        if "password" in update_data and update_data["password"]:
            db_user.hashed_password = security.get_password_hash(update_data["password"])
            del update_data["password"]

        for field, value in update_data.items():
            if hasattr(db_user, field):
                setattr(db_user, field, value)

        db.add(db_user)
        await db.commit()
        await db.refresh(db_user)
        return db_user

    @staticmethod
    async def delete_company_user(
        db: AsyncSession,
        current_user: models.User,
        user_id: int
    ) -> None:
        """
        Exclui um usuário da empresa. Impede que o usuário logado exclua a si mesmo.

        @param db: Sessão do banco de dados.
        @param current_user: Modelo do administrador/superuser logado.
        @param user_id: ID do usuário a ser removido.
        """
        if current_user.id == user_id:
            raise ValueError("Você não pode excluir a si mesmo.")

        stmt = select(models.User).where(models.User.id == user_id)
        if not getattr(current_user, "is_superuser", False):
            stmt = stmt.where(models.User.company_id == current_user.company_id)
        
        result = await db.execute(stmt)
        db_user = result.scalar_one_or_none()
        if not db_user:
            raise ValueError("Usuário não encontrado.")

        await db.delete(db_user)
        await db.commit()
