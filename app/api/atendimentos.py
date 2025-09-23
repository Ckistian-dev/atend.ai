# app/api/atendimentos.py

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

from app.db.database import get_db
from app.db import models
from app.db.schemas import Atendimento, AtendimentoUpdate
from app.crud import crud_atendimento
from app.api.dependencies import get_current_active_user

router = APIRouter()

@router.get("/", response_model=List[Atendimento], summary="Listar todos os atendimentos")
async def read_atendimentos(
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    """Obtém uma lista de todos os atendimentos do usuário logado, dos mais recentes para os mais antigos."""
    return await crud_atendimento.get_atendimentos_by_user(db, user_id=current_user.id)

@router.put("/{atendimento_id}", response_model=Atendimento, summary="Atualizar um atendimento")
async def update_atendimento(
    atendimento_id: int,
    atendimento_in: AtendimentoUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    """
    Atualiza manualmente a situação ou a persona de um atendimento.
    Ex: Mudar situação para "Ignorar Contato" ou "Vendedor Chamado".
    """
    db_atendimento = await crud_atendimento.get_atendimento(db, atendimento_id=atendimento_id, user_id=current_user.id)
    if not db_atendimento:
        raise HTTPException(status_code=404, detail="Atendimento não encontrado")
    
    return await crud_atendimento.update_atendimento(db=db, db_atendimento=db_atendimento, atendimento_in=atendimento_in)

@router.delete("/{atendimento_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Apagar um atendimento")
async def delete_atendimento(
    atendimento_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    """Apaga um atendimento e todo o seu histórico de conversa."""
    deleted_atendimento = await crud_atendimento.delete_atendimento(db, atendimento_id=atendimento_id, user_id=current_user.id)
    if not deleted_atendimento:
        raise HTTPException(status_code=404, detail="Atendimento não encontrado")
    
    await db.commit()
    return