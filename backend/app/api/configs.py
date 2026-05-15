# app/api/configs.py

from fastapi import APIRouter, Depends, HTTPException, status, Body, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete, select
from typing import List, Dict, Any, Optional
import logging
import os
import json
import urllib.parse
import httpx
from pydantic import BaseModel, EmailStr
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from app.core.config import settings
from app.db.database import get_db, SessionLocal
from app.db import models
from app.db.schemas import Config, ConfigCreate, ConfigUpdate, UserUpdate
from app.crud import crud_config, crud_user
from app.api.dependencies import get_current_active_user
from app.services.google_sheets_service import GoogleSheetsService
from app.services.google_drive_service import get_drive_service
from app.services.gemini_service import GeminiService, get_gemini_service
from app.services.prospect_service import get_prospect_service
from app.services.google_calendar_service import get_google_calendar_service

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

# --- IDs BASE (Carregados do .env) ---
BASE_SYSTEM_SHEET_ID = os.getenv("BASE_SYSTEM_SHEET_ID", "")
BASE_RAG_SHEET_ID = os.getenv("BASE_RAG_SHEET_ID", "")

class ProvisionWithCodePayload(BaseModel):
    config_id: int
    resource_type: str
    code: str
    redirect_uri: str

# --- Funções Auxiliares de Engenharia de Dados ---

def format_sheet_to_csv_system(sheet_name: str, rows: List[Dict[str, Any]]) -> str:
    """
    Converte uma aba inteira em formato CSV para o System Prompt.
    """
    if not rows:
        return ""
    
    headers = list(rows[0].keys())
    # Adiciona cabeçalhos e a linha separadora do Markdown para garantir dados estruturados
    lines = [f"# {sheet_name}", "| " + " | ".join(headers) + " |", "| " + " | ".join(["---"] * len(headers)) + " |"]
    
    for row in rows:
        values = [str(row.get(h, "") or "").strip().replace("\n", "\\n").replace("\r", "") for h in headers]
        lines.append("| " + " | ".join(values) + " |")
        
    return "\n".join(lines)

def format_row_to_csv_rag(sheet_name: str, row: Dict[str, Any]) -> str:
    """
    Converte uma linha em formato CSV com cabeçalho para o RAG.
    """
    headers = []
    values = []
    
    for key, val in row.items():
        if val is not None:
            val_str = str(val).strip().replace("\n", "\\n").replace("\r", "")
            if val_str:
                headers.append(key)
                values.append(val_str)
    
    if not headers:
        return ""
    
    # Formata como uma tabela Markdown de uma linha para garantir leitura estruturada no RAG
    header_line = "| " + " | ".join(headers) + " |"
    separator_line = "| " + " | ".join(["---"] * len(headers)) + " |"
    value_line = "| " + " | ".join(values) + " |"
    
    return f"# {sheet_name}\n{header_line}\n{separator_line}\n{value_line}"

def flatten_drive_tree(node: Dict[str, Any], path: str = "") -> List[str]:
    """Recursivamente achata a árvore de arquivos em linhas de texto estruturado."""
    lines = []
    current_name = node.get("nome", "Raiz")
    
    # Constrói caminho visual (ex: Marketing > Campanhas)
    current_path = f"{path} > {current_name}" if path else current_name
    
    for f in node.get("arquivos", []):
        # Formato CSV estilo Sheets RAG
        row_data = {
            "Categorias": current_path,
            "Arquivo": f.get('nome'),
            "Tipo": f.get('tipo'),
            "ID": f.get('id')
        }
        
        headers = []
        values = []
        
        for key, val in row_data.items():
            if val:
                val_str = str(val).strip().replace("\n", "\\n").replace("\r", "")
                headers.append(key)
                values.append(val_str)
        
        if headers:
            header_line = "| " + " | ".join(headers) + " |"
            separator_line = "| " + " | ".join(["---"] * len(headers)) + " |"
            value_line = "| " + " | ".join(values) + " |"
            lines.append(f"# DRIVE\n{header_line}\n{separator_line}\n{value_line}")
        
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

@router.get("/google-auth-url", summary="URL de Autenticação do Google para Provisionamento")
async def get_google_auth_url(redirect_uri: str):
    client_id = settings.GOOGLE_CLIENT_ID
    scope = "email profile https://www.googleapis.com/auth/drive"
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": scope,
        "access_type": "online",
        "prompt": "select_account"
    }
    url = f"https://accounts.google.com/o/oauth2/v2/auth?{urllib.parse.urlencode(params)}"
    return {"authorization_url": url}

@router.post("/provision", summary="Provisionar nova Planilha/Pasta usando Login do Google")
async def provision_google_resource(
    payload: ProvisionWithCodePayload = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user)
):
    db_config = await crud_config.get_config(db=db, config_id=payload.config_id, user_id=current_user.id)
    if not db_config:
        raise HTTPException(status_code=404, detail="Configuração não encontrada.")
        
    # Trocar código por token para descobrir o e-mail real do usuário
    async with httpx.AsyncClient(timeout=60.0) as client:
        token_res = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "code": payload.code,
                "grant_type": "authorization_code",
                "redirect_uri": payload.redirect_uri
            }
        )
        token_data = token_res.json()
        if "access_token" not in token_data:
            raise HTTPException(status_code=400, detail="Falha ao autenticar com o Google.")

        userinfo_res = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {token_data['access_token']}"}
        )
        userinfo = userinfo_res.json()
        user_email = userinfo.get("email")
        if not user_email:
            raise HTTPException(status_code=400, detail="Não foi possível obter o e-mail da conta do Google.")

    # Cria o serviço do Google Drive autenticado como o usuário
    user_creds = Credentials(token_data['access_token'])
    user_drive_service = build('drive', 'v3', credentials=user_creds)

    drive_service = get_drive_service()
    
    service_account_email = "integracaoapi@integracaoapi-436218.iam.gserviceaccount.com"
    try:
        if settings.GOOGLE_SERVICE_ACCOUNT_JSON:
            sa_info = json.loads(settings.GOOGLE_SERVICE_ACCOUNT_JSON)
            service_account_email = sa_info.get("client_email", service_account_email)
    except:
        pass

    # E-mails que terão acesso ao arquivo criado
    emails_to_share = [
        "cris.talatto@gmail.com",
        service_account_email
    ]

    try:
        if payload.resource_type == "system":
            if not BASE_SYSTEM_SHEET_ID:
                raise ValueError("BASE_SYSTEM_SHEET_ID não está configurado no .env")
                
            try:
                perm = {'type': 'user', 'role': 'reader', 'emailAddress': user_email}
                drive_service.service.permissions().create(fileId=BASE_SYSTEM_SHEET_ID, body=perm, sendNotificationEmail=False).execute()
            except Exception as e:
                logger.warning(f"Não foi possível dar permissão de leitura prévia no template base: {e}")
                
            body = {'name': f"Instruções IA - {db_config.nome_config}"}
            new_file = user_drive_service.files().copy(fileId=BASE_SYSTEM_SHEET_ID, body=body, supportsAllDrives=True).execute()
            new_id = new_file.get('id')
            db_config.spreadsheet_id = new_id
            
        elif payload.resource_type == "rag":
            if not BASE_RAG_SHEET_ID:
                raise ValueError("BASE_RAG_SHEET_ID não está configurado no .env")
                
            try:
                perm = {'type': 'user', 'role': 'reader', 'emailAddress': user_email}
                drive_service.service.permissions().create(fileId=BASE_RAG_SHEET_ID, body=perm, sendNotificationEmail=False).execute()
            except Exception as e:
                logger.warning(f"Não foi possível dar permissão de leitura prévia no template base: {e}")
                
            body = {'name': f"Conhecimento IA - {db_config.nome_config}"}
            new_file = user_drive_service.files().copy(fileId=BASE_RAG_SHEET_ID, body=body, supportsAllDrives=True).execute()
            new_id = new_file.get('id')
            db_config.spreadsheet_rag_id = new_id
            
        elif payload.resource_type == "drive":
            file_metadata = {'name': f"Arquivos IA - {db_config.nome_config}", 'mimeType': 'application/vnd.google-apps.folder'}
            folder = user_drive_service.files().create(body=file_metadata, fields='id').execute()
            new_id = folder.get('id')
            db_config.drive_id = new_id

        for email in emails_to_share:
            if email and "@" in email:
                perm = {'type': 'user', 'role': 'writer', 'emailAddress': email.strip()}
                user_drive_service.permissions().create(fileId=new_id, body=perm, sendNotificationEmail=False).execute()

        db.add(db_config)
        await db.commit()
        return {"message": "Recurso provisionado com sucesso.", "id": new_id}
    except Exception as e:
        logger.error(f"Falha ao provisionar recurso: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro ao criar/partilhar o recurso no Google: {str(e)}")

async def run_sync_sheet(config_id: int, user_id: int, spreadsheet_id: str, sync_type: str) -> int:
    """Função síncrona para ler planilhas e gerar contexto/vetores, aguardando o término."""
    logger.info(f"Iniciando sincronização de Planilha (Config: {config_id}, User: {user_id}, Tipo: {sync_type})")
    
    async with SessionLocal() as db:
        try:
            db_config = await crud_config.get_config(db=db, config_id=config_id, user_id=user_id)
            if not db_config:
                logger.error("Configuração não encontrada para o sync da planilha.")
                raise Exception("Configuração não encontrada.")

            sheets_service = GoogleSheetsService()
            gemini_service = get_gemini_service()
            sheet_data_json = await sheets_service.get_sheet_as_json(spreadsheet_id)
            
            prompt_buffer = []
            contextos_buffer = []
            itens_processados = 0

            if sync_type == "system":
                # MODO SYSTEM: Todas as abas viram Prompt Fixo (CSV)
                for sheet_name, rows in sheet_data_json.items():
                    csv_section = format_sheet_to_csv_system(sheet_name, rows)
                    if csv_section:
                        prompt_buffer.append(csv_section)
                        itens_processados += 1
                db_config.prompt = "\n\n".join(prompt_buffer)

            elif sync_type == "rag":
                # MODO RAG: Gera embeddings
                rag_items = []
                for sheet_name, rows in sheet_data_json.items():
                    for row in rows:
                        csv_content = format_row_to_csv_rag(sheet_name, row)
                        if csv_content:
                            rag_items.append({"content": csv_content, "origin": sheet_name})
                
                if rag_items:
                    lines_to_embed = [item["content"] for item in rag_items]
                    # Gera os embeddings chamando a API do Gemini
                    embeddings = await gemini_service.generate_embeddings_batch(lines_to_embed)
                    
                    for item, embedding in zip(rag_items, embeddings):
                        if embedding:
                            contextos_buffer.append(models.KnowledgeVector(
                                config_id=db_config.id,
                                content=item["content"],
                                origin=item["origin"],
                                embedding=embedding
                            ))
                            itens_processados += 1
                
                # Limpa vetores anteriores que NÃO sejam do Drive
                await db.execute(delete(models.KnowledgeVector).where(
                    models.KnowledgeVector.config_id == db_config.id,
                    models.KnowledgeVector.origin != "drive"
                ))
                
                if contextos_buffer:
                    db.add_all(contextos_buffer)
            
            db.add(db_config)
            await db.commit()
            logger.info(f"Sincronização de Planilha ({sync_type}) finalizada com sucesso! Itens: {itens_processados}")
            return itens_processados

        except Exception as e:
            logger.error(f"Erro na sincronização da Planilha: {e}", exc_info=True)
            await db.rollback()
            raise e


@router.post("/sync_sheet", summary="Sincronizar planilha do Google Sheets com uma Configuração")
async def sync_google_sheet(
    payload: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user)
):
    try:
        config_id = int(payload.get("config_id"))
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="config_id é obrigatório e deve ser um número inteiro.")

    spreadsheet_id = payload.get("spreadsheet_id") # Opcional
    sync_type = payload.get("type", "system") # 'system' ou 'rag'

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
        await db.commit()
    
    # Após a possível atualização, verifica se há um spreadsheet_id para usar
    final_spreadsheet_id = db_config.spreadsheet_rag_id if sync_type == "rag" else db_config.spreadsheet_id
    
    if not final_spreadsheet_id:
        raise HTTPException(status_code=400, detail=f"Nenhum link de planilha ({sync_type}) associado. Salve o link primeiro.")

    try:
        # Executa de forma síncrona aguardando a finalização
        itens_processados = await run_sync_sheet(config_id, current_user.id, final_spreadsheet_id, sync_type)
        
        return {
            "message": f"Sincronização ({sync_type.upper()}) concluída com sucesso!", 
            "sheets_found": itens_processados,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Falha ao processar a planilha: {str(e)}")

def _extract_file_name_from_drive_content(content: str) -> str:
    """Extrai o nome do arquivo de um conteúdo 'drive_content' (ex: '# CONTEÚDO DO ARQUIVO: nome.pdf\n...')."""
    if content.startswith("# CONTEÚDO DO ARQUIVO:"):
        first_line = content.split("\n", 1)[0]
        return first_line.replace("# CONTEÚDO DO ARQUIVO:", "").strip()
    return ""


def _extract_file_name_from_drive_index(content: str) -> str:
    """
    Extrai o nome do arquivo de um vetor 'drive'.
    Formato esperado:
        # DRIVE
        Categorias|Arquivo|Tipo|ID
        Pasta A > Sub|nome.pdf|PDF|1abc...
    """
    lines = [l.strip() for l in content.strip().split("\n") if l.strip()]
    # As linhas são: [0] '# DRIVE', [1] cabeçalhos, [2] valores
    if len(lines) < 3:
        return ""
    try:
        headers = lines[1].split("|")
        values = lines[2].split("|")
        if "Arquivo" in headers:
            idx = headers.index("Arquivo")
            if idx < len(values):
                return values[idx].strip()
    except Exception:
        pass
    return ""


async def run_sync_drive(config_id: int, user_id: int, folder_id: str) -> int:
    """
    Sincronização simplificada do Drive:
    - Lista arquivos e pastas.
    - Gera vetores de índice (nome/id) para o RAG.
    - Sem análise de conteúdo via IA (apenas metadados).
    """
    logger.info(f"Iniciando sincronização simplificada de Drive (Config: {config_id}, User: {user_id})")
    
    async with SessionLocal() as db:
        try:
            drive_service = get_drive_service()
            gemini_service = get_gemini_service()
            
            # 1. Lista arquivos atuais do Drive
            drive_data = await drive_service.list_files_in_folder(folder_id)
            files_tree = drive_data.get("tree", {})
            
            # 2. Gera as linhas de índice usando a função auxiliar flatten_drive_tree
            index_lines = flatten_drive_tree(files_tree)
            
            contextos_buffer = []
            if index_lines:
                # Gera os embeddings chamando a API do Gemini
                embeddings = await gemini_service.generate_embeddings_batch(index_lines)
                
                for line, embedding in zip(index_lines, embeddings):
                    if embedding:
                        contextos_buffer.append(models.KnowledgeVector(
                            config_id=config_id,
                            content=line,
                            origin="drive",
                            embedding=embedding
                        ))

            # 3. Limpa vetores anteriores do Drive e salva os novos
            async with db.begin():
                await db.execute(delete(models.KnowledgeVector).where(
                    models.KnowledgeVector.config_id == config_id,
                    models.KnowledgeVector.origin.in_(["drive", "drive_content"])
                ))
                
                if contextos_buffer:
                    db.add_all(contextos_buffer)
            
            await db.commit()
            logger.info(f"Sincronização simplificada do Drive concluída! {len(contextos_buffer)} arquivos indexados.")
            return len(contextos_buffer)

        except Exception as e:
            logger.error(f"Erro na sincronização do Drive: {e}", exc_info=True)
            await db.rollback()
            raise e


@router.post("/sync_drive", summary="Sincronizar pasta do Google Drive")
async def sync_google_drive(
    payload: Dict[str, Any] = Body(...), 
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user)
):
    try:
        config_id = int(payload.get("config_id"))
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="config_id é obrigatório e deve ser um número inteiro.")

    folder_id = payload.get("drive_id")

    db_config = await crud_config.get_config(db=db, config_id=config_id, user_id=current_user.id)
    if not db_config:
        raise HTTPException(status_code=404, detail="Configuração não encontrada.")
    
    # Atualiza o ID da pasta se foi enviado
    if folder_id:
        db_config.drive_id = folder_id
        db.add(db_config)
        await db.commit()
    
    final_folder_id = db_config.drive_id
    if not final_folder_id:
        raise HTTPException(status_code=400, detail="Nenhum ID de pasta associado. Insira o ID da pasta do Google Drive.")

    try:
        # Executa de forma síncrona aguardando a finalização
        itens_processados = await run_sync_drive(config_id, current_user.id, final_folder_id)

        return {
            "message": "Sincronização do Google Drive concluída com sucesso!",
            "files_found": itens_processados,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Falha ao processar o Drive: {str(e)}")

@router.get("/situations", response_model=List[Dict[str, str]], summary="Listar situações padrão")
async def get_situations():
    """
    Retorna a lista padrão de situações de atendimento.
    """
    return SITUATIONS

@router.get("/destinations", summary="Listar destinos para notificação (ProspectAI)")
async def get_notification_destinations(
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user)
):
    """
    Busca a lista de contatos e grupos disponíveis na API do ProspectAI.
    """
    service = get_prospect_service()
    destinations = await service.list_destinations(db, current_user)
    return destinations

@router.get("/google-calendar/auth-url")
async def get_calendar_auth_url(
    redirect_uri: str,
    current_user: models.User = Depends(get_current_active_user)
):
    service = get_google_calendar_service(None)
    return {"authorization_url": service.get_authorization_url(redirect_uri)}

@router.post("/google-calendar/callback")
async def calendar_callback(
    payload: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user)
):
    code = payload.get("code")
    redirect_uri = payload.get("redirect_uri")
    config_id_raw = payload.get("config_id")
    
    if not all([code, redirect_uri, config_id_raw]):
        raise HTTPException(status_code=400, detail="Parâmetros ausentes.")

    try:
        config_id = int(config_id_raw)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="config_id deve ser um número inteiro.")

    db_config = await crud_config.get_config(db=db, config_id=config_id, user_id=current_user.id)
    if not db_config:
        raise HTTPException(status_code=404, detail="Configuração não encontrada.")
        
    service = get_google_calendar_service(db_config)
    credentials = service.fetch_token(code, redirect_uri)
    
    db_config.google_calendar_credentials = credentials
    db.add(db_config)
    await db.commit()
    return {"message": "Agenda conectada com sucesso."}

@router.post("/google-calendar/{config_id}/disconnect")
async def disconnect_calendar(
    config_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user)
):
    db_config = await crud_config.get_config(db=db, config_id=config_id, user_id=current_user.id)
    if db_config:
        db_config.google_calendar_credentials = None
        db_config.is_calendar_active = False
        await db.commit()
    return {"message": "Agenda desconectada."}

class WorkflowFeedbackPayload(BaseModel):
    feedback: str

@router.post("/{config_id}/analyze_workflow", summary="Analisar fluxo via IA para melhoria (Modo Edição Direta)")
async def analyze_workflow_feedback(
    config_id: int,
    payload: WorkflowFeedbackPayload = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
    gemini_service: GeminiService = Depends(get_gemini_service)
):
    persona = await crud_config.get_config(db=db, config_id=config_id, user_id=current_user.id)
    if not persona:
        raise HTTPException(status_code=404, detail="Configuração não encontrada")

    # In a pure workflow editing mode, there is no conversation history or rag context.
    analysis = await gemini_service.analyze_conversation_feedback(
        feedback=payload.feedback,
        history_str="[Nenhuma conversa associada. Apenas edição direta do fluxo pelo usuário na área de configurações.]",
        rag_context="",
        current_instructions=persona.prompt or "",
        current_workflow=persona.workflow_json,
        db=db,
        user=current_user
    )
    return analysis

class ApplyWorkflowPayload(BaseModel):
    novo_workflow: Optional[Dict[str, Any]] = None

@router.post("/{config_id}/apply_workflow", summary="Aplicar novo fluxo na Persona (Modo Edição Direta)")
async def apply_workflow_feedback(
    config_id: int,
    payload: ApplyWorkflowPayload = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user)
):
    persona = await crud_config.get_config(db=db, config_id=config_id, user_id=current_user.id)
    if not persona:
        raise HTTPException(status_code=404, detail="Configuração não encontrada")

    if payload.novo_workflow:
        persona.workflow_json = payload.novo_workflow
        db.add(persona)
        await db.commit()
        return {"message": "Novo fluxo visual salvo com sucesso."}
    
    return {"message": "Nenhuma alteração foi solicitada no fluxo."}