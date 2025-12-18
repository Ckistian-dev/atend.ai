# app/api/configs.py

from fastapi import APIRouter, Depends, HTTPException, status, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete
from typing import List, Dict, Any
import logging

from app.db.database import get_db
from app.db import models
from app.db.schemas import Config, ConfigCreate, ConfigUpdate, UserUpdate
from app.crud import crud_config, crud_user
from app.api.dependencies import get_current_active_user
from app.services.google_sheets_service import GoogleSheetsService
from app.services.google_drive_service import get_drive_service
from app.services.gemini_service import get_gemini_service

logger = logging.getLogger(__name__)
router = APIRouter()

SITUATIONS = [
    {"cor": "#144cd1", "nome": "Mensagem Recebida"},
    {"cor": "#f0ad60", "nome": "Atendente Chamado"},
    {"cor": "#e5da61", "nome": "Aguardando Resposta"},
    {"cor": "#5fd395", "nome": "Concluído"},
    {"cor": "#d569dd", "nome": "Gerando Resposta"},
    {"cor": "#837676", "nome": "Ignorar Contato"},
]

# --- Funções Auxiliares de Engenharia de Dados ---

def format_row_dense(sheet_name: str, row: Dict[str, Any]) -> str:
    """
    Converte uma linha de dados em string densa 'Pipe & Header'.
    Regra: Ignora chaves com valores nulos/vazios para economizar tokens.
    """
    parts = []
    for key, val in row.items():
        if val is not None:
            val_str = str(val).strip()
            if val_str:
                parts.append(f"{key}: {val_str}")
    
    if not parts:
        return ""
    
    return f"[{sheet_name.upper()}] " + " | ".join(parts)

def flatten_drive_tree(node: Dict[str, Any], path: str = "") -> List[str]:
    """Recursivamente achata a árvore de arquivos em linhas de texto estruturado."""
    lines = []
    current_name = node.get("nome", "Raiz")
    
    # Constrói caminho visual (ex: Marketing > Campanhas)
    current_path = f"{path} > {current_name}" if path else current_name
    
    # Define Categoria e Subcategoria baseado na estrutura de pastas
    path_parts = current_path.split(" > ")
    categoria = path_parts[0] if len(path_parts) > 0 else "Geral"
    subcategoria = path_parts[1] if len(path_parts) > 1 else ""
    
    for f in node.get("arquivos", []):
        # Formato denso e rico para RAG
        parts = []
        parts.append(f"Categoria: {categoria}")
        if subcategoria: parts.append(f"Subcategoria: {subcategoria}")
        
        if f.get('nome'): parts.append(f"Arquivo: {f.get('nome')}")
        if f.get('tipo'): parts.append(f"Tipo: {f.get('tipo')}")
        if f.get('id'): parts.append(f"ID: {f.get('id')}") # ID é crucial para o envio
        if f.get('link'): parts.append(f"Link: {f.get('link')}")
        parts.append(f"Pasta: {current_path}")
        
        lines.append(f"[DRIVE] " + " | ".join(parts))
        
    for sub in node.get("subpastas", []):
        lines.extend(flatten_drive_tree(sub, current_path))
        
    return lines

@router.post("/", response_model=Config, status_code=status.HTTP_201_CREATED, summary="Criar uma nova Configuração")
async def create_config(config: ConfigCreate, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_active_user)):
    new_config = await crud_config.create_config(db=db, config=config, user_id=current_user.id)
    await db.commit()
    await db.refresh(new_config)
    return new_config

@router.get("/", response_model=List[Config], summary="Listar todas as Configurações")
async def read_configs(db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_active_user)):
    return await crud_config.get_configs_by_user(db=db, user_id=current_user.id)

@router.put("/{config_id}", response_model=Config, summary="Atualizar uma Configuração")
async def update_config(config_id: int, config: ConfigUpdate, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_active_user)):
    db_config = await crud_config.get_config(db=db, config_id=config_id, user_id=current_user.id)
    if db_config is None:
        raise HTTPException(status_code=404, detail="Configuração não encontrada")
    updated = await crud_config.update_config(db=db, db_config=db_config, config_in=config)
    await db.commit()
    await db.refresh(updated)
    return updated

@router.delete("/{config_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Apagar uma Configuração")
async def delete_config(config_id: int, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_active_user)):
    if current_user.default_persona_id == config_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Não é possível apagar uma configuração que está definida como padrão.")
    deleted_config = await crud_config.delete_config(db=db, config_id=config_id, user_id=current_user.id)
    if deleted_config is None:
        raise HTTPException(status_code=404, detail="Configuração não encontrada")
    await db.commit()
    return

@router.post("/sync_sheet", summary="Sincronizar planilha do Google Sheets com uma Configuração")
async def sync_google_sheet(
    payload: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user)
):
    config_id = payload.get("config_id")
    spreadsheet_id = payload.get("spreadsheet_id") # Opcional
    sync_type = payload.get("type", "system") # 'system' ou 'rag'

    if not config_id:
        raise HTTPException(status_code=400, detail="config_id é obrigatório.")

    db_config = await crud_config.get_config(db=db, config_id=config_id, user_id=current_user.id)
    if not db_config:
        raise HTTPException(status_code=404, detail="Configuração não encontrada.")
    
    # Se um novo spreadsheet_id foi enviado, atualiza a configuração primeiro
    if spreadsheet_id:
        if sync_type == "rag":
            db_config.spreadsheet_rag_id = spreadsheet_id
        else:
            db_config.spreadsheet_id = spreadsheet_id
        db.add(db_config)
        # O commit será feito junto com a atualização do contexto
    
    # Após a possível atualização, verifica se há um spreadsheet_id para usar
    final_spreadsheet_id = db_config.spreadsheet_rag_id if sync_type == "rag" else db_config.spreadsheet_id
    
    if not final_spreadsheet_id:
        raise HTTPException(status_code=400, detail=f"Nenhum link de planilha ({sync_type}) associado. Salve o link primeiro.")

    try:
        sheets_service = GoogleSheetsService()
        gemini_service = get_gemini_service()
        sheet_data_json = await sheets_service.get_sheet_as_json(final_spreadsheet_id)
        
        prompt_buffer = []
        contextos_buffer = []
        all_rag_lines = [] # Lista temporária para acumular linhas para embedding em lote

        # --- Lógica Separada por Tipo ---
        if sync_type == "system":
            # MODO SYSTEM: Todas as abas viram Prompt Fixo
            for sheet_name, rows in sheet_data_json.items():
                formatted_lines = [line for row in rows if (line := format_row_dense(sheet_name, row))]
                if formatted_lines:
                    section = f"## {sheet_name}\n" + "\n".join(formatted_lines)
                    prompt_buffer.append(section)
            
            # Atualiza System Prompt e JSON de visualização
            db_config.prompt = "\n\n".join(prompt_buffer)

        elif sync_type == "rag":
            # MODO RAG: Todas as abas viram Vetores
            for sheet_name, rows in sheet_data_json.items():
                formatted_lines = [line for row in rows if (line := format_row_dense(sheet_name, row))]
                if formatted_lines:
                    all_rag_lines.extend(formatted_lines)
            
            # Processamento em Lote dos Embeddings
            if all_rag_lines:
                embeddings = await gemini_service.generate_embeddings_batch(all_rag_lines)
                for line, embedding in zip(all_rag_lines, embeddings):
                    if embedding:
                        contextos_buffer.append(models.KnowledgeVector(
                            config_id=db_config.id,
                            content=line,
                            origin="sheet", # Mantemos 'sheet' para identificar origem planilha
                            embedding=embedding
                        ))
            
            # Limpa vetores anteriores desta origem e insere novos
            await db.execute(delete(models.KnowledgeVector).where(
                models.KnowledgeVector.config_id == db_config.id,
                models.KnowledgeVector.origin == "sheet"
            ))
            if contextos_buffer:
                db.add_all(contextos_buffer)
        
        await db.commit()
        await db.refresh(db_config)

        return {
            "message": f"Sincronização ({sync_type.upper()}) Concluída", 
            "sheets_found": list(sheet_data_json.keys()),
            "prompt_size": len(db_config.prompt or "") if sync_type == "system" else 0,
            "vectors_created": len(contextos_buffer) if sync_type == "rag" else 0
        }
    
    except Exception as e:
        logger.error(f"Falha na rota sync_sheet: {e}", exc_info=True)
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Falha ao sincronizar planilha: {str(e)}")

@router.post("/sync_drive", summary="Sincronizar pasta do Google Drive")
async def sync_google_drive(
    payload: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user)
):
    config_id = payload.get("config_id")
    folder_id = payload.get("drive_id")

    if not config_id:
        raise HTTPException(status_code=400, detail="config_id é obrigatório.")

    db_config = await crud_config.get_config(db=db, config_id=config_id, user_id=current_user.id)
    if not db_config:
        raise HTTPException(status_code=404, detail="Configuração não encontrada.")
    
    # Atualiza o ID da pasta se foi enviado
    if folder_id:
        db_config.drive_id = folder_id
        # Não faz commit ainda, espera o sync
    
    final_folder_id = db_config.drive_id
    if not final_folder_id:
        raise HTTPException(status_code=400, detail="Nenhum ID de pasta associado. Insira o ID da pasta do Google Drive.")

    try:
        drive_service = get_drive_service()
        gemini_service = get_gemini_service()
        # Chama o serviço (que pode ser síncrono, mas rodamos no endpoint async)
        # Se a lib do google for síncrona, o ideal é usar run_in_executor, mas para simplicidade aqui:
        drive_data = await drive_service.list_files_in_folder(final_folder_id)
        
        # O serviço retorna um dicionário com a estrutura da árvore e a contagem
        files_tree = drive_data.get("tree", {})
        files_count = drive_data.get("count", 0)

        # --- Lógica de Processamento de Dados (Refatorada) ---
        # 1. Achata a árvore para lista de strings densas
        drive_lines = flatten_drive_tree(files_tree)
        
        # 2. Prepara vetores para RAG (Grupo B)
        # Usando processamento em lote
        contextos_buffer = []
        if drive_lines:
            embeddings = await gemini_service.generate_embeddings_batch(drive_lines)
            for line, embedding in zip(drive_lines, embeddings):
                if embedding:
                    contextos_buffer.append(models.KnowledgeVector(
                        config_id=db_config.id, 
                        content=line, 
                        origin="drive", 
                        embedding=embedding
                    ))

        # 3. Atualiza Vetores (Limpa anteriores da origem 'drive' e insere novos)
        await db.execute(delete(models.KnowledgeVector).where(
            models.KnowledgeVector.config_id == db_config.id,
            models.KnowledgeVector.origin == "drive"
        ))
        if contextos_buffer:
            db.add_all(contextos_buffer)

        await db.commit()
        await db.refresh(db_config)

        return {
            "message": "Drive sincronizado com Knowledge Base", 
            "files_found": files_count,
            "vectors_created": len(contextos_buffer),
        }
    
    except Exception as e:
        logger.error(f"Falha na rota sync_drive: {e}", exc_info=True)
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Falha ao sincronizar Drive: {str(e)}")

@router.get("/situations", response_model=List[Dict[str, str]], summary="Listar situações padrão")
async def get_situations():
    """
    Retorna a lista padrão de situações de atendimento.
    """
    return SITUATIONS