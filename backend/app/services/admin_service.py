import logging
from typing import List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db import models, schemas
from app.crud import crud_user
from app.services.security import get_password_hash

logger = logging.getLogger(__name__)

class AdminService:
    @staticmethod
    async def read_users(
        db: AsyncSession,
        skip: int = 0,
        limit: int = 100
    ) -> List[models.User]:
        """
        Retorna a lista de todos os usuários do sistema.

        @param db: Sessão do banco de dados.
        @param skip: Offset de paginação.
        @param limit: Limite da paginação.
        @returns: Lista de usuários.
        """
        return await crud_user.get_users(db, skip=skip, limit=limit)

    @staticmethod
    async def create_user_by_admin(
        db: AsyncSession,
        user_in: schemas.UserCreateByAdmin
    ) -> models.User:
        """
        Cria um novo usuário na base de dados com senha criptografada.

        @param db: Sessão do banco de dados.
        @param user_in: Dados do usuário para cadastro.
        @returns: Modelo do usuário criado.
        """
        db_user = await crud_user.get_user_by_email(db, email=user_in.email)
        if db_user:
            raise ValueError("Email already registered.")
        
        user_data = user_in.model_dump(exclude_unset=True)
        # Garante que não tentamos salvar is_superuser no banco
        user_data.pop("is_superuser", None) 

        hashed_password = get_password_hash(user_data.pop("password"))

        new_user = models.User(
            hashed_password=hashed_password,
            **user_data
        )
        
        db.add(new_user)
        await db.commit()
        await db.refresh(new_user)
        return new_user

    @staticmethod
    async def update_user_by_admin(
        db: AsyncSession,
        user_id: int,
        user_in: schemas.UserUpdate
    ) -> models.User:
        """
        Atualiza campos cadastrais e privilégios de um usuário pelo ID.

        @param db: Sessão do banco de dados.
        @param user_id: ID do usuário a ser atualizado.
        @param user_in: Dados de atualização.
        @returns: Modelo do usuário atualizado.
        """
        user_to_update = await crud_user.get_user(db, user_id=user_id)
        if not user_to_update:
            raise LookupError("User not found")

        update_data = user_in.model_dump(exclude_unset=True)

        if "email" in update_data and update_data["email"] != user_to_update.email:
            existing_user = await crud_user.get_user_by_email(db, email=update_data["email"])
            if existing_user:
                raise ValueError("Email already registered.")

        # Garante que não tentamos salvar is_superuser no banco
        update_data.pop("is_superuser", None)

        if "password" in update_data:
            password = update_data.pop("password")
            if password:
                user_to_update.hashed_password = get_password_hash(password)

        for field, value in update_data.items():
            if hasattr(user_to_update, field):
                setattr(user_to_update, field, value)

        db.add(user_to_update)
        await db.commit()
        await db.refresh(user_to_update)
        return user_to_update

    @staticmethod
    async def delete_user_by_admin(
        db: AsyncSession,
        user_id: int,
        current_user: models.User
    ) -> None:
        """
        Deleta um usuário pelo ID, impedindo a exclusão de si mesmo.

        @param db: Sessão do banco de dados.
        @param user_id: ID do usuário a ser removido.
        @param current_user: Usuário administrador logado executando a ação.
        """
        if current_user.id == user_id:
            raise PermissionError("Admins cannot delete themselves.")

        user_to_delete = await crud_user.get_user(db, user_id=user_id)
        if not user_to_delete:
            raise LookupError("User not found")
        
        await db.delete(user_to_delete)
        await db.commit()

    @staticmethod
    async def read_user_configs_by_admin(
        db: AsyncSession,
        user_id: int
    ) -> List[models.Config]:
        """
        Busca e retorna todas as configurações da empresa de um usuário específico.

        @param db: Sessão do banco de dados.
        @param user_id: ID do usuário alvo.
        @returns: Lista de configurações vinculadas ao usuário.
        """
        db_user = await crud_user.get_user(db, user_id=user_id)
        if not db_user or not db_user.company_id:
            return []
        result = await db.execute(select(models.Config).where(models.Config.company_id == db_user.company_id))
        return list(result.scalars().all())

    @staticmethod
    async def read_all_configs(
        db: AsyncSession,
        skip: int = 0,
        limit: int = 1000
    ) -> List[models.Config]:
        """
        Retorna todas as configurações salvas de todas as empresas do sistema.

        @param db: Sessão do banco de dados.
        @param skip: Offset de paginação.
        @param limit: Limite da paginação.
        @returns: Lista de configurações.
        """
        result = await db.execute(select(models.Config).offset(skip).limit(limit))
        return list(result.scalars().all())

    @staticmethod
    async def read_companies(db: AsyncSession) -> List[models.Company]:
        """
        Retorna todas as empresas cadastradas no SaaS.

        @param db: Sessão do banco de dados.
        @returns: Lista de empresas.
        """
        result = await db.execute(select(models.Company))
        return list(result.scalars().all())

    @staticmethod
    async def create_company(
        db: AsyncSession,
        company_in: schemas.CompanyCreate
    ) -> models.Company:
        """
        Cadastra uma nova empresa no banco de dados.

        @param db: Sessão do banco de dados.
        @param company_in: Dados da nova empresa.
        @returns: Modelo da empresa criada.
        """
        db_company = models.Company(**company_in.model_dump())
        db.add(db_company)
        await db.commit()
        await db.refresh(db_company)
        return db_company

    @staticmethod
    async def update_company(
        db: AsyncSession,
        company_id: int,
        company_in: schemas.CompanyUpdate
    ) -> models.Company:
        """
        Atualiza metadados e configurações globais de uma empresa.

        @param db: Sessão do banco de dados.
        @param company_id: ID da empresa a ser atualizada.
        @param company_in: Dados para modificação.
        @returns: Modelo da empresa atualizada.
        """
        db_company = await db.get(models.Company, company_id)
        if not db_company:
            raise LookupError("Company not found")
            
        update_data = company_in.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            if hasattr(db_company, field):
                setattr(db_company, field, value)
                
        db.add(db_company)
        await db.commit()
        await db.refresh(db_company)
        return db_company

    @staticmethod
    async def delete_company(
        db: AsyncSession,
        company_id: int
    ) -> None:
        """
        Remove permanentemente uma empresa cadastrada da base de dados.

        @param db: Sessão do banco de dados.
        @param company_id: ID da empresa a ser deletada.
        """
        db_company = await db.get(models.Company, company_id)
        if not db_company:
            raise LookupError("Company not found")
        await db.delete(db_company)
        await db.commit()

    @staticmethod
    async def read_company_configs_by_admin(
        db: AsyncSession,
        company_id: int
    ) -> List[models.Config]:
        """
        Lista todas as configurações pertencentes a uma empresa pelo ID.

        @param db: Sessão do banco de dados.
        @param company_id: ID da empresa alvo.
        @returns: Lista de configurações.
        """
        result = await db.execute(select(models.Config).where(models.Config.company_id == company_id))
        return list(result.scalars().all())
