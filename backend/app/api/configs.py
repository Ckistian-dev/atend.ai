# app/api/configs.py

from fastapi import APIRouter, Depends, HTTPException, status, Body, BackgroundTasks, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete, select, or_
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
from app.services.google_calendar_service import get_google_calendar_service
from app.services.gemini_service import GeminiService, get_gemini_service

logger = logging.getLogger(__name__)
router = APIRouter()

def get_drive_webhook_url() -> str:
    """Retorna a URL pública de webhook para receber notificações do Google Drive/Sheets."""
    if not settings.WBP_WEBHOOK_URL:
        logger.warning("get_drive_webhook_url: WBP_WEBHOOK_URL não configurado.")
        return ""
    # Constrói a URL substituindo o endpoint do WhatsApp pelo de drive-webhook
    base_url = settings.WBP_WEBHOOK_URL.split("/api/v1/webhook")[0]
    return f"{base_url}/api/v1/configs/drive-webhook"

async def setup_drive_watch(config_id: int, resource_id: str, resource_type: str):
    """
    Tenta registrar um webhook/watch no Google Drive para o arquivo ou pasta.
    Silencia erros se falhar (por exemplo, se o domínio do webhook não estiver verificado).
    """
    webhook_url = get_drive_webhook_url()
    if not webhook_url:
        logger.warning("setup_drive_watch: Impossível obter webhook_url.")
        return
        
    try:
        drive_service = get_drive_service()
        if not drive_service or not drive_service.service:
            logger.warning("setup_drive_watch: Serviço do Google Drive não inicializado.")
            return
            
        # Formato do channel_id: atendai-watch-{config_id}-{resource_type}
        # resource_type pode ser 'system', 'rag' ou 'drive'
        channel_id = f"atendai-watch-{config_id}-{resource_type}"
        
        logger.info(f"setup_drive_watch: Registrando watch para o ID '{resource_id}' (tipo: {resource_type}) na URL: {webhook_url}")
        
        # Chama a API de watch
        drive_service.watch_file(file_id=resource_id, channel_id=channel_id, webhook_url=webhook_url)
        logger.info(f"setup_drive_watch: Watch registrado com sucesso para {resource_id} no canal {channel_id}.")
    except Exception as e:
        logger.warning(f"setup_drive_watch: Falha ao registrar watch para {resource_id} (pode requerer verificação de domínio no Google): {e}")


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
    Converte uma aba inteira em formato de lista (chave-valor) para o System Prompt.
    """
    if not rows:
        return ""
    
    headers = list(rows[0].keys())
    lines = [f"# {sheet_name}"]
    
    for row in rows:
        # Se houver exatamente 2 colunas, formata como "- Coluna1: Coluna2" para máxima economia de tokens e clareza
        if len(headers) == 2:
            k = str(row.get(headers[0], "") or "").strip().replace("\n", "\\n").replace("\r", "")
            v = str(row.get(headers[1], "") or "").strip().replace("\n", "\\n").replace("\r", "")
            if k and v and v.lower() not in ["", "-", "--", "none", "n/a", "null"]:
                lines.append(f"- {k}: {v}")
        else:
            # Para mais colunas, faz uma lista recuada de chave-valor
            kv_lines = []
            for idx, h in enumerate(headers):
                val = str(row.get(h, "") or "").strip().replace("\n", "\\n").replace("\r", "")
                if val and val.lower() not in ["", "-", "--", "none", "n/a", "null"]:
                    if idx == 0:
                        kv_lines.append(f"- {h}: {val}")
                    else:
                        kv_lines.append(f"  {h}: {val}")
            if kv_lines:
                lines.append("\n".join(kv_lines))
                
    return "\n".join(lines)

def parse_drive_index(content: str) -> dict:
    """
    Parses drive index content (either table format, key-value format, or pipe-separated single-line format).
    Returns a dict with uppercase keys like 'ID', 'ARQUIVO', 'CATEGORIAS', 'TIPO'.
    """
    data = {}
    content_clean = content.strip()
    if not content_clean:
        return data
        
    # Check for single-line pipe-separated format: "[DRIVE] Categoria: ... | Arquivo: ..."
    if "|" in content_clean and ":" in content_clean and "\n" not in content_clean:
        parts = [p.strip() for p in content_clean.split("|") if p.strip()]
        for part in parts:
            # Remove leading '[DRIVE]' if present
            if part.upper().startswith("[DRIVE]"):
                part = part[7:].strip()
            if ":" in part:
                key, val = part.split(":", 1)
                data[key.strip().upper()] = val.strip()
    else:
        lines = [l.strip() for l in content_clean.split("\n") if l.strip()]
        
        # Check if it's the new key-value format (bullet points or key-values)
        is_kv = False
        for line in lines:
            if line.startswith("- ") and ":" in line:
                is_kv = True
                break
                
        if is_kv:
            for line in lines:
                if line.startswith("- "):
                    line = line[2:]
                if ":" in line:
                    key, val = line.split(":", 1)
                    data[key.strip().upper()] = val.strip()
        else:
            # Fallback to old table format
            data_lines = [l for l in lines if not l.startswith("#") and "---" not in l]
            if len(data_lines) >= 2:
                try:
                    headers = [h.strip().upper() for h in data_lines[0].split("|") if h.strip()]
                    values = [v.strip() for v in data_lines[1].split("|") if v.strip()]
                    for h, v in zip(headers, values):
                        data[h] = v
                except Exception:
                    pass

    # Normalize keys for consistent access
    normalized_data = {}
    for k, v in data.items():
        k_upper = k.strip().upper()
        if k_upper in ["CATEGORIA", "CATEGORIAS"]:
            normalized_data["CATEGORIAS"] = v
        elif k_upper in ["TIPO", "TIPO_MIDIA", "MIDIA"]:
            normalized_data["TIPO"] = v
        elif k_upper in ["ID", "ID_ARQUIVO"]:
            normalized_data["ID"] = v
        elif k_upper in ["ARQUIVO", "NOME_ARQUIVO", "NOME"]:
            if " > " in v:
                parts = [p.strip() for p in v.split(" > ") if p.strip()]
                normalized_data["ARQUIVO"] = parts[-1]
                normalized_data["CATEGORIAS"] = " > ".join(parts[:-1])
            else:
                normalized_data["ARQUIVO"] = v
        else:
            normalized_data[k_upper] = v
            
    return normalized_data

def format_row_to_csv_rag(sheet_name: str, row: Dict[str, Any]) -> str:
    """
    Converte uma linha da planilha em formato chave-valor (lista/marcadores) para o RAG.
    """
    kv_lines = []
    
    for key, val in row.items():
        if val is not None:
            val_str = str(val).strip().replace("\n", "\\n").replace("\r", "")
            # Filtra placeholders de valores vazios/nulos comuns em planilhas para economizar tokens
            if val_str and val_str.lower() not in ["", "-", "--", "none", "n/a", "null"]:
                kv_lines.append(f"- {key}: {val_str}")
    
    if not kv_lines:
        return ""
    
    return f"# {sheet_name}\n" + "\n".join(kv_lines)

def flatten_drive_tree(node: Dict[str, Any], path: str = "") -> List[str]:
    """Recursivamente achata a árvore de arquivos em linhas de texto estruturado usando marcadores."""
    lines = []
    current_name = node.get("nome", "Raiz")
    
    # Constrói caminho visual (ex: Marketing > Campanhas)
    current_path = f"{path} > {current_name}" if path else current_name
    
    for f in node.get("arquivos", []):
        file_name = f.get('nome') or ""
        file_path = f"{current_path} > {file_name}" if current_path else file_name
        
        row_data = {
            "Arquivo": file_path,
            "Tipo": f.get('tipo'),
            "ID": f.get('id')
        }
        
        kv_lines = []
        for key, val in row_data.items():
            if val:
                val_str = str(val).strip().replace("\n", "\\n").replace("\r", "")
                if val_str and val_str.lower() not in ["", "-", "--", "none", "n/a", "null"]:
                    kv_lines.append(f"- {key}: {val_str}")
        
        if kv_lines:
            content = f"# DRIVE\n" + "\n".join(kv_lines)
            lines.append(content)
        
    for sub in node.get("subpastas", []):
        lines.extend(flatten_drive_tree(sub, current_path))
        
    return lines

@router.post("/", response_model=Config, status_code=status.HTTP_201_CREATED, summary="Criar uma nova Configuração")
async def create_config(config: ConfigCreate, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_active_user)):
    company_id = current_user.company_id or 0
    new_config = await crud_config.create_config(db=db, config=config, company_id=company_id)
    await db.commit()
    await db.refresh(new_config)
    return new_config

@router.get("/", response_model=List[Config], summary="Listar todas as Configurações")
async def read_configs(db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_active_user)):
    company_id = current_user.company_id or 0
    return await crud_config.get_configs_by_user(db=db, company_id=company_id)

@router.put("/{config_id}", response_model=Config, summary="Atualizar uma Configuração")
async def update_config(config_id: int, config: ConfigUpdate, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_active_user)):
    company_id = current_user.company_id or 0
    db_config = await crud_config.get_config(db=db, config_id=config_id, company_id=company_id)
    if db_config is None:
        raise HTTPException(status_code=404, detail="Configuração não encontrada")
    
    # Guarda os IDs antigos para verificar se mudaram
    old_sheet = db_config.spreadsheet_id
    old_rag = db_config.spreadsheet_rag_id
    old_drive = db_config.drive_id

    updated = await crud_config.update_config(db=db, db_config=db_config, config_in=config)
    await db.commit()
    await db.refresh(updated)
    
    # Tenta registrar o watch se algum ID mudou e não é nulo
    if updated.spreadsheet_id and updated.spreadsheet_id != old_sheet:
        await setup_drive_watch(updated.id, updated.spreadsheet_id, "system")
    if updated.spreadsheet_rag_id and updated.spreadsheet_rag_id != old_rag:
        await setup_drive_watch(updated.id, updated.spreadsheet_rag_id, "rag")
    if updated.drive_id and updated.drive_id != old_drive:
        await setup_drive_watch(updated.id, updated.drive_id, "drive")

    return updated

@router.delete("/{config_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Apagar uma Configuração")
async def delete_config(config_id: int, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(get_current_active_user)):
    company_id = current_user.company_id or 0
    default_persona_id = current_user.company.default_persona_id if current_user.company else None
    if default_persona_id == config_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Não é possível apagar uma configuração que está definida como padrão.")
    deleted_config = await crud_config.delete_config(db=db, config_id=config_id, company_id=company_id)
    if deleted_config is None:
        raise HTTPException(status_code=404, detail="Configuração não encontrada")
    await db.commit()
    return

@router.post("/{config_id}/set-default", summary="Definir uma configuração como persona padrão da empresa")
async def set_default_persona(
    config_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user)
):
    """
    Define a configuração indicada como a persona padrão da empresa do usuário logado.
    """
    company_id = current_user.company_id or 0

    # Verifica se a config pertence à empresa
    db_config = await crud_config.get_config(db=db, config_id=config_id, company_id=company_id)
    if db_config is None:
        raise HTTPException(status_code=404, detail="Configuração não encontrada")

    # Atualiza a empresa
    company = await db.get(models.Company, company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")

    company.default_persona_id = config_id
    db.add(company)
    await db.commit()
    await db.refresh(company)
    return {"message": "Persona padrão atualizada com sucesso", "default_persona_id": config_id}

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
    company_id = current_user.company_id or 0
    db_config = await crud_config.get_config(db=db, config_id=payload.config_id, company_id=company_id)
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

        # Tenta registrar o watch automático para o recurso recém-provisionado
        await setup_drive_watch(db_config.id, new_id, payload.resource_type)

        return {"message": "Recurso provisionado com sucesso.", "id": new_id}
    except Exception as e:
        logger.error(f"Falha ao provisionar recurso: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro ao criar/partilhar o recurso no Google: {str(e)}")

async def run_sync_sheet(config_id: int, company_id: int, spreadsheet_id: str, sync_type: str) -> int:
    """Função síncrona para ler planilhas e gerar contexto/vetores, aguardando o término."""
    logger.info(f"Iniciando sincronização de Planilha (Config: {config_id}, Empresa: {company_id}, Tipo: {sync_type})")
    
    async with SessionLocal() as db:
        try:
            db_config = await crud_config.get_config(db=db, config_id=config_id, company_id=company_id)
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

    company_id = current_user.company_id or 0
    db_config = await crud_config.get_config(db=db, config_id=config_id, company_id=company_id)
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
        company_id = current_user.company_id or 0
        itens_processados = await run_sync_sheet(config_id, company_id, final_spreadsheet_id, sync_type)
        
        # Tenta registrar o watch automático para manter a sincronização
        await setup_drive_watch(config_id, final_spreadsheet_id, sync_type)

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
    Extrai o nome do arquivo de um vetor 'drive' usando o parse_drive_index.
    """
    parsed = parse_drive_index(content)
    return parsed.get("ARQUIVO", "")


async def run_sync_drive(config_id: int, company_id: int, folder_id: str) -> int:
    """
    Sincronização simplificada do Drive:
    - Lista arquivos e pastas.
    - Gera vetores de índice (nome/id) para o RAG.
    - Sem análise de conteúdo via IA (apenas metadados).
    """
    logger.info(f"Iniciando sincronização simplificada de Drive (Config: {config_id}, Empresa: {company_id})")
    
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

            # 3. Hard reset: limpa TODOS os vetores anteriores do Drive e salva os novos
            logger.info(f"Drive sync: deletando vetores anteriores (origin='drive' e 'drive_content') para config_id={config_id}...")
            await db.execute(delete(models.KnowledgeVector).where(
                models.KnowledgeVector.config_id == config_id,
                models.KnowledgeVector.origin.in_(["drive", "drive_content"])
            ))
            
            if contextos_buffer:
                db.add_all(contextos_buffer)
            
            await db.commit()
            logger.info(f"Drive sync (hard reset) concluída! {len(contextos_buffer)} vetores novos indexados.")
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

    company_id = current_user.company_id or 0
    db_config = await crud_config.get_config(db=db, config_id=config_id, company_id=company_id)
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
        company_id = current_user.company_id or 0
        itens_processados = await run_sync_drive(config_id, company_id, final_folder_id)

        # Tenta registrar o watch automático para manter a sincronização
        await setup_drive_watch(config_id, final_folder_id, "drive")

        return {
            "message": "Sincronização do Google Drive concluída com sucesso!",
            "files_found": itens_processados,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Falha ao processar o Drive: {str(e)}")

@router.post("/drive-webhook", summary="Webhook para receber notificações de alteração do Google Drive/Sheets")
async def drive_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    channel_id = request.headers.get("x-goog-channel-id")
    resource_state = request.headers.get("x-goog-resource-state")
    
    logger.info(f"Drive Webhook recebido - Channel: {channel_id}, State: {resource_state}")
    
    if resource_state == "sync":
        logger.info("Drive Webhook: Confirmação de registro (sync) recebida.")
        return {"status": "ok"}
        
    if channel_id and channel_id.startswith("atendai-watch-"):
        # Formato: atendai-watch-{config_id}-{resource_type}
        parts = channel_id.replace("atendai-watch-", "").split("-")
        if len(parts) >= 2:
            try:
                config_id = int(parts[0])
                resource_type = parts[1] # 'system', 'rag' ou 'drive'
                
                db_config = await db.get(models.Config, config_id)
                if db_config:
                    company_id = db_config.company_id
                    if resource_type == "system" and db_config.spreadsheet_id:
                        background_tasks.add_task(
                            run_sync_sheet, config_id, company_id, db_config.spreadsheet_id, "system"
                        )
                    elif resource_type == "rag" and db_config.spreadsheet_rag_id:
                        background_tasks.add_task(
                            run_sync_sheet, config_id, company_id, db_config.spreadsheet_rag_id, "rag"
                        )
                    elif resource_type == "drive" and db_config.drive_id:
                        background_tasks.add_task(
                            run_sync_drive, config_id, company_id, db_config.drive_id
                        )
                    logger.info(f"Drive Webhook: Sincronização em background iniciada para Config: {config_id}, Tipo: {resource_type}")
                    return {"status": "sync_started"}
            except Exception as e:
                logger.error(f"Erro ao processar webhook do Drive: {e}", exc_info=True)

    # Lógica de fallback para Google Apps Script ou requisições diretas por Query Params ou JSON Body
    config_id_param = request.query_params.get("config_id")
    type_param = request.query_params.get("type") # 'system', 'rag' ou 'drive'
    spreadsheet_id_param = request.query_params.get("spreadsheet_id")
    
    if not config_id_param or not type_param or not spreadsheet_id_param:
        try:
            body = await request.json()
            if body:
                if not config_id_param:
                    config_id_param = body.get("config_id")
                if not type_param:
                    type_param = body.get("type")
                if not spreadsheet_id_param:
                    spreadsheet_id_param = body.get("spreadsheet_id")
        except Exception:
            pass

    # Se recebeu spreadsheet_id_param diretamente (ex: Apps Script)
    if spreadsheet_id_param:
        try:
            # Busca todas as configs que usam essa planilha (system ou rag)
            query = select(models.Config).where(
                or_(
                    models.Config.spreadsheet_id == spreadsheet_id_param,
                    models.Config.spreadsheet_rag_id == spreadsheet_id_param
                )
            )
            result = await db.execute(query)
            configs = result.scalars().all()
            if configs:
                for db_config in configs:
                    company_id = db_config.company_id
                    if db_config.spreadsheet_id == spreadsheet_id_param:
                        background_tasks.add_task(
                            run_sync_sheet, db_config.id, company_id, spreadsheet_id_param, "system"
                        )
                    if db_config.spreadsheet_rag_id == spreadsheet_id_param:
                        background_tasks.add_task(
                            run_sync_sheet, db_config.id, company_id, spreadsheet_id_param, "rag"
                        )
                logger.info(f"Webhook por Spreadsheet ID: Sincronização em background iniciada para Planilha {spreadsheet_id_param}")
                return {"status": "sync_started"}
        except Exception as e:
            logger.error(f"Erro ao processar webhook por ID de planilha: {e}", exc_info=True)

    # Se recebeu config_id e type_param
    if config_id_param and type_param:
        try:
            config_id = int(config_id_param)
            db_config = await db.get(models.Config, config_id)
            if db_config:
                company_id = db_config.company_id
                if type_param == "system" and db_config.spreadsheet_id:
                    background_tasks.add_task(
                        run_sync_sheet, config_id, company_id, db_config.spreadsheet_id, "system"
                    )
                elif type_param == "rag" and db_config.spreadsheet_rag_id:
                    background_tasks.add_task(
                        run_sync_sheet, config_id, company_id, db_config.spreadsheet_rag_id, "rag"
                    )
                elif type_param == "drive" and db_config.drive_id:
                    background_tasks.add_task(
                        run_sync_drive, config_id, company_id, db_config.drive_id
                    )
                logger.info(f"Webhook Direto: Sincronização em background iniciada para Config: {config_id}, Tipo: {type_param}")
                return {"status": "sync_started"}
        except Exception as e:
            logger.error(f"Erro ao processar webhook direto: {e}", exc_info=True)
            
    return {"status": "ignored"}

@router.get("/situations", response_model=List[Dict[str, str]], summary="Listar situações padrão")
async def get_situations():
    """
    Retorna a lista padrão de situações de atendimento.
    """
    return SITUATIONS

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

    company_id = current_user.company_id or 0
    db_config = await crud_config.get_config(db=db, config_id=config_id, company_id=company_id)
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
    company_id = current_user.company_id or 0
    db_config = await crud_config.get_config(db=db, config_id=config_id, company_id=company_id)
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
    company_id = current_user.company_id or 0
    persona = await crud_config.get_config(db=db, config_id=config_id, company_id=company_id)
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
    company_id = current_user.company_id or 0
    persona = await crud_config.get_config(db=db, config_id=config_id, company_id=company_id)
    if not persona:
        raise HTTPException(status_code=404, detail="Configuração não encontrada")

    if payload.novo_workflow:
        persona.workflow_json = payload.novo_workflow
        db.add(persona)
        await db.commit()
        return {"message": "Novo fluxo visual salvo com sucesso."}
    
    return {"message": "Nenhuma alteração foi solicitada no fluxo."}