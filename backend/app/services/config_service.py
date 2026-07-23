# app/services/config_service.py

# 1. Importações nativas/padrão do Python
import logging
import os
import json
import uuid
import urllib.parse
from typing import List, Dict, Any, Optional

# 2. Importações de terceiros
import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete, select, or_
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

# 3. Importações locais do projeto
from app.core.config import settings
from app.db import models, schemas
from app.db.database import SessionLocal
from app.crud import crud_config, crud_user, crud_atendimento
from app.services.google_sheets_service import GoogleSheetsService
from app.services.google_drive_service import get_drive_service
from app.services.google_calendar_service import get_google_calendar_service
from app.services.gemini_service import GeminiService, get_gemini_service

logger = logging.getLogger(__name__)


class ConfigNotFoundError(Exception):
    """Exceção levantada quando uma configuração não é encontrada."""
    pass


class ConfigValidationError(Exception):
    """Exceção levantada para erros de validação nas configurações."""
    pass


# Lista padrão de situações
SITUATIONS = [
    {"cor": "#144cd1", "nome": "Mensagem Recebida"},
    {"cor": "#f0ad60", "nome": "Atendente Chamado"},
    {"cor": "#e5da61", "nome": "Aguardando Resposta"},
    {"cor": "#5fd395", "nome": "Concluído"},
    {"cor": "#d569dd", "nome": "Gerando Resposta"},
    {"cor": "#837676", "nome": "Ignorar Contato"},
]

BASE_SYSTEM_SHEET_ID = os.getenv("BASE_SYSTEM_SHEET_ID", "")
BASE_RAG_SHEET_ID = os.getenv("BASE_RAG_SHEET_ID", "")


class ConfigService:

    @staticmethod
    def get_drive_webhook_url() -> str:
        """
        Retorna a URL pública de webhook para receber notificações do Google Drive/Sheets.
        
        @returns: URL em formato string ou vazio se não configurado.
        """
        if not settings.WBP_WEBHOOK_URL:
            logger.warning("get_drive_webhook_url: WBP_WEBHOOK_URL não configurado.")
            return ""
        base_url = settings.WBP_WEBHOOK_URL.split("/api/v1/webhook")[0]
        return f"{base_url}/api/v1/configs/drive-webhook"

    @staticmethod
    async def setup_drive_watch(config_id: int, resource_id: str, resource_type: str) -> None:
        """
        Tenta registrar um webhook/watch no Google Drive para o arquivo ou pasta.
        Silencia erros se falhar.

        @param config_id: ID da configuração.
        @param resource_id: ID do recurso no Drive.
        @param resource_type: Tipo do recurso ('system', 'rag', 'drive').
        """
        webhook_url = ConfigService.get_drive_webhook_url()
        if not webhook_url:
            logger.warning("setup_drive_watch: Impossível obter webhook_url.")
            return
            
        try:
            drive_service = get_drive_service()
            if not drive_service or not drive_service.service:
                logger.warning("setup_drive_watch: Serviço do Google Drive não inicializado.")
                return
                
            channel_id = f"atendai-watch-{uuid.uuid4()}"
            token = f"config_id={config_id}&resource_type={resource_type}"
            
            logger.info(f"setup_drive_watch: Registrando watch para o ID '{resource_id}' (tipo: {resource_type}) na URL: {webhook_url}")
            
            drive_service.watch_file(
                file_id=resource_id, 
                channel_id=channel_id, 
                webhook_url=webhook_url,
                token=token
            )
            logger.info(f"setup_drive_watch: Watch registrado com sucesso para {resource_id} no canal {channel_id}.")
        except Exception as e:
            logger.warning(f"setup_drive_watch: Falha ao registrar watch para {resource_id}: {e}")

    @staticmethod
    def format_sheet_to_csv_system(sheet_name: str, rows: List[Dict[str, Any]]) -> str:
        """
        Converte uma aba inteira em formato de lista (chave-valor) para o System Prompt.
        
        @param sheet_name: Nome da aba da planilha.
        @param rows: Linhas de dados da planilha.
        @returns: String formatada representando a aba.
        """
        if not rows:
            return ""
        
        headers = list(rows[0].keys())
        lines = [f"# {sheet_name}"]
        
        for row in rows:
            if len(headers) == 2:
                k = str(row.get(headers[0], "") or "").strip().replace("\n", "\\n").replace("\r", "")
                v = str(row.get(headers[1], "") or "").strip().replace("\n", "\\n").replace("\r", "")
                if k and v and v.lower() not in ["", "-", "--", "none", "n/a", "null"]:
                    lines.append(f"- {k}: {v}")
            else:
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

    @staticmethod
    def parse_drive_index(content: str) -> dict:
        """
        Analisa o conteúdo do índice do Drive retornando metadados normalizados.

        @param content: Conteúdo string do arquivo.
        @returns: Dicionário contendo as chaves normalizadas.
        """
        data = {}
        content_clean = content.strip()
        if not content_clean:
            return data
            
        if "|" in content_clean and ":" in content_clean and "\n" not in content_clean:
            parts = [p.strip() for p in content_clean.split("|") if p.strip()]
            for part in parts:
                if part.upper().startswith("[DRIVE]"):
                    part = part[7:].strip()
                if ":" in part:
                    key, val = part.split(":", 1)
                    data[key.strip().upper()] = val.strip()
        else:
            lines = [l.strip() for l in content_clean.split("\n") if l.strip()]
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
                data_lines = [l for l in lines if not l.startswith("#") and "---" not in l]
                if len(data_lines) >= 2:
                    try:
                        headers = [h.strip().upper() for h in data_lines[0].split("|") if h.strip()]
                        values = [v.strip() for v in data_lines[1].split("|") if v.strip()]
                        for h, v in zip(headers, values):
                            data[h] = v
                    except Exception:
                        pass

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

    @staticmethod
    def format_row_to_csv_rag(sheet_name: str, row: Dict[str, Any]) -> str:
        """
        Converte uma linha de RAG para o prompt contextual.
        
        @param sheet_name: Nome do recurso ou aba.
        @param row: Dicionário correspondendo à linha.
        @returns: String formatada.
        """
        kv_lines = []
        for key, val in row.items():
            if val is not None:
                val_str = str(val).strip().replace("\n", "\\n").replace("\r", "")
                if val_str and val_str.lower() not in ["", "-", "--", "none", "n/a", "null"]:
                    kv_lines.append(f"- {key}: {val_str}")
        
        if not kv_lines:
            return ""
        return f"# {sheet_name}\n" + "\n".join(kv_lines)

    @staticmethod
    def flatten_drive_tree(node: Dict[str, Any], path: str = "") -> List[Dict[str, Any]]:
        """
        Achatamento recursivo da árvore de arquivos do Google Drive.

        @param node: Nó atual da árvore do Drive.
        @param path: Caminho das pastas anteriores.
        @returns: Lista de dicionários representando os metadados dos arquivos.
        """
        results = []
        current_name = node.get("nome", "Raiz")
        current_path = f"{path} > {current_name}" if path else current_name
        
        for f in node.get("arquivos", []):
            file_name = f.get('nome') or ""
            file_path = f"{current_path} > {file_name}" if current_path else file_name
            
            row_data = {
                "Arquivo": file_path,
                "Tipo": f.get('tipo'),
                "ID": f.get('id')
            }
            
            clean_row = {str(k).strip(): v for k, v in row_data.items() if v is not None and str(v).strip() != ""}
            if clean_row:
                content_parts = [f"{key}: {val}" for key, val in clean_row.items()]
                content = " | ".join(content_parts)
                
                tipo = (f.get('tipo') or '').lower()
                if 'imagem' in tipo:
                    category = 'image'
                elif 'vídeo' in tipo or 'video' in tipo:
                    category = 'video'
                elif 'áudio' in tipo or 'audio' in tipo:
                    category = 'audio'
                else:
                    category = 'document'
                    
                raw_data = {
                    "id_arquivo": f.get('id'),
                    "nome_exato": file_name,
                    "mime_type": f.get('mimeType'),
                    "tipo": f.get('tipo')
                }
                
                results.append({
                    "content": content,
                    "category": category,
                    "raw_data": raw_data
                })
            
        for sub in node.get("subpastas", []):
            results.extend(ConfigService.flatten_drive_tree(sub, current_path))
            
        return results

    @staticmethod
    async def create_config(
        db: AsyncSession,
        config: schemas.ConfigCreate,
        company_id: int
    ) -> models.Config:
        """
        Cria uma nova configuração de persona no banco de dados.

        @param db: Sessão do banco de dados.
        @param config: Schema de criação da configuração.
        @param company_id: ID da empresa associada.
        @returns: O objeto de configuração criado.
        """
        new_config = await crud_config.create_config(db=db, config=config, company_id=company_id)
        await db.commit()
        await db.refresh(new_config)
        return new_config

    @staticmethod
    async def get_configs_by_user(
        db: AsyncSession,
        company_id: int
    ) -> List[models.Config]:
        """
        Busca todas as configurações ativas da empresa.

        @param db: Sessão do banco de dados.
        @param company_id: ID da empresa.
        @returns: Lista de configurações encontradas.
        """
        return await crud_config.get_configs_by_user(db=db, company_id=company_id)

    @staticmethod
    async def update_config(
        db: AsyncSession,
        company_id: int,
        config_id: int,
        config_in: schemas.ConfigUpdate
    ) -> models.Config:
        """
        Atualiza uma configuração existente e atualiza o watch no Google Drive se necessário.

        @param db: Sessão do banco de dados.
        @param company_id: ID da empresa.
        @param config_id: ID da configuração a atualizar.
        @param config_in: Schema de atualização da configuração.
        @returns: A configuração atualizada.
        """
        db_config = await crud_config.get_config(db=db, config_id=config_id, company_id=company_id)
        if db_config is None:
            raise ConfigNotFoundError("Configuração não encontrada")
        
        old_sheet = db_config.spreadsheet_id
        old_rag = db_config.spreadsheet_rag_id
        old_drive = db_config.drive_id

        updated = await crud_config.update_config(db=db, db_config=db_config, config_in=config_in)
        await db.commit()
        if not updated.spreadsheet_id or not str(updated.spreadsheet_id).strip():
            updated.prompt = None
            db.add(updated)
            await db.commit()
            await db.refresh(updated)
            
        if updated.spreadsheet_id and updated.spreadsheet_id != old_sheet:
            await ConfigService.setup_drive_watch(updated.id, updated.spreadsheet_id, "system")
        if updated.spreadsheet_rag_id and updated.spreadsheet_rag_id != old_rag:
            await ConfigService.setup_drive_watch(updated.id, updated.spreadsheet_rag_id, "rag")
        if updated.drive_id and updated.drive_id != old_drive:
            await ConfigService.setup_drive_watch(updated.id, updated.drive_id, "drive")

        return updated

    @staticmethod
    async def delete_config(
        db: AsyncSession,
        company: models.Company,
        company_id: int,
        config_id: int
    ) -> None:
        """
        Apaga uma configuração que não esteja definida como persona padrão.

        @param db: Sessão do banco de dados.
        @param company: O modelo da empresa logada.
        @param company_id: ID da empresa.
        @param config_id: ID da configuração a apagar.
        """
        default_persona_id = company.default_persona_id if company else None
        if default_persona_id == config_id:
            raise ConfigValidationError("Não é possível apagar uma configuração que está definida como padrão.")
            
        deleted_config = await crud_config.delete_config(db=db, config_id=config_id, company_id=company_id)
        if deleted_config is None:
            raise ConfigNotFoundError("Configuração não encontrada")
        await db.commit()

    @staticmethod
    async def set_default_persona(
        db: AsyncSession,
        company_id: int,
        config_id: int
    ) -> Dict[str, Any]:
        """
        Define a configuração como a persona padrão da empresa.

        @param db: Sessão do banco de dados.
        @param company_id: ID da empresa.
        @param config_id: ID da configuração.
        @returns: Resposta de sucesso contendo o novo default_persona_id.
        """
        db_config = await crud_config.get_config(db=db, config_id=config_id, company_id=company_id)
        if db_config is None:
            raise ConfigNotFoundError("Configuração não encontrada")

        company = await db.get(models.Company, company_id)
        if not company:
            raise ConfigNotFoundError("Empresa não encontrada")

        company.default_persona_id = config_id
        db.add(company)
        await db.commit()
        await db.refresh(company)
        return {"message": "Persona padrão atualizada com sucesso", "default_persona_id": config_id}

    @staticmethod
    async def get_google_auth_url(redirect_uri: str) -> str:
        """
        Gera a URL de redirecionamento de OAuth do Google para provisionar recursos.

        @param redirect_uri: URI de retorno cadastrada.
        @returns: A URL de autorização string.
        """
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
        return f"https://accounts.google.com/o/oauth2/v2/auth?{urllib.parse.urlencode(params)}"

    @staticmethod
    async def provision_google_resource(
        db: AsyncSession,
        company_id: int,
        payload: schemas.ProvisionWithCodePayload
    ) -> Dict[str, Any]:
        """
        Faz a autenticação temporária de fluxo OAuth e provisiona a planilha ou pasta no Google Drive.

        @param db: Sessão do banco de dados.
        @param company_id: ID da empresa do usuário.
        @param payload: Objeto contendo o código e o tipo de recurso a provisionar.
        @returns: O ID do recurso provisionado e mensagem explicativa.
        """
        db_config = await crud_config.get_config(db=db, config_id=payload.config_id, company_id=company_id)
        if not db_config:
            raise ConfigNotFoundError("Configuração não encontrada.")
            
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
                raise ValueError("Falha ao autenticar com o Google.")

            userinfo_res = await client.get(
                "https://www.googleapis.com/oauth2/v2/userinfo",
                headers={"Authorization": f"Bearer {token_data['access_token']}"}
            )
            userinfo = userinfo_res.json()
            user_email = userinfo.get("email")
            if not user_email:
                raise ValueError("Não foi possível obter o e-mail da conta do Google.")

        user_creds = Credentials(token_data['access_token'])
        user_drive_service = build('drive', 'v3', credentials=user_creds)
        drive_service = get_drive_service()
        
        service_account_email = "integracaoapi@integracaoapi-436218.iam.gserviceaccount.com"
        try:
            if settings.GOOGLE_SERVICE_ACCOUNT_JSON:
                sa_info = json.loads(settings.GOOGLE_SERVICE_ACCOUNT_JSON)
                service_account_email = sa_info.get("client_email", service_account_email)
        except Exception:
            pass

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
            else:
                raise ValueError("Tipo de recurso inválido.")

            for email in emails_to_share:
                if email and "@" in email:
                    perm = {'type': 'user', 'role': 'writer', 'emailAddress': email.strip()}
                    user_drive_service.permissions().create(fileId=new_id, body=perm, sendNotificationEmail=False).execute()

            db.add(db_config)
            await db.commit()

            await ConfigService.setup_drive_watch(db_config.id, new_id, payload.resource_type)
            return {"message": "Recurso provisionado com sucesso.", "id": new_id}

        except Exception as e:
            logger.error(f"Falha ao provisionar recurso: {e}", exc_info=True)
            raise e

    @staticmethod
    async def run_sync_sheet(config_id: int, company_id: int, spreadsheet_id: str, sync_type: str) -> int:
        """
        Lê planilhas e gera contexto/vetores no banco de dados.

        @param config_id: ID da configuração.
        @param company_id: ID da empresa associada.
        @param spreadsheet_id: ID da planilha no Google.
        @param sync_type: Tipo de sincronização ('system' ou 'rag').
        @returns: O número total de itens processados.
        """
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
                    for sheet_name, rows in sheet_data_json.items():
                        csv_section = ConfigService.format_sheet_to_csv_system(sheet_name, rows)
                        if csv_section:
                            prompt_buffer.append(csv_section)
                            itens_processados += 1
                    db_config.prompt = "\n\n".join(prompt_buffer)

                elif sync_type == "rag":
                    rag_items = []
                    for sheet_name, rows in sheet_data_json.items():
                        for row in rows:
                            clean_row = {str(k).strip(): v for k, v in row.items() if v is not None and str(v).strip() != ""}
                            if not clean_row:
                                continue
                            
                            content_parts = [f"{key}: {val}" for key, val in clean_row.items()]
                            content_str = " | ".join(content_parts)
                            
                            if content_str:
                                rag_items.append({
                                    "content": content_str,
                                    "category": sheet_name,
                                    "raw_data": clean_row
                                })
                    
                    if rag_items:
                        lines_to_embed = [item["content"] for item in rag_items]
                        embeddings = await gemini_service.generate_embeddings_batch(lines_to_embed)
                        
                        for item, embedding in zip(rag_items, embeddings):
                            if embedding:
                                contextos_buffer.append(models.KnowledgeVector(
                                    config_id=db_config.id,
                                    content=item["content"],
                                    origin="sheet",
                                    category=item["category"],
                                    raw_data=item["raw_data"],
                                    embedding=embedding
                                ))
                                contexts_buffer = contextos_buffer # placeholder
                                itens_processados += 1
                    
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

    @staticmethod
    async def sync_google_sheet(
        db: AsyncSession,
        company_id: int,
        config_id: int,
        spreadsheet_id: Optional[str],
        sync_type: str
    ) -> int:
        """
        Salva o link da planilha (se fornecido) e executa o processo de sincronização.

        @param db: Sessão do banco de dados.
        @param company_id: ID da empresa.
        @param config_id: ID da configuração.
        @param spreadsheet_id: ID da planilha (opcional).
        @param sync_type: Tipo de sincronização ('system' ou 'rag').
        @returns: O número de itens processados.
        """
        db_config = await crud_config.get_config(db=db, config_id=config_id, company_id=company_id)
        if not db_config:
            raise ConfigNotFoundError("Configuração não encontrada.")
        
        if spreadsheet_id:
            if sync_type == "rag":
                db_config.spreadsheet_rag_id = spreadsheet_id
            else:
                db_config.spreadsheet_id = spreadsheet_id
            db.add(db_config)
            await db.commit()
        
        final_spreadsheet_id = db_config.spreadsheet_rag_id if sync_type == "rag" else db_config.spreadsheet_id
        if not final_spreadsheet_id:
            raise ConfigValidationError(f"Nenhum link de planilha ({sync_type}) associado. Salve o link primeiro.")

        itens_processados = await ConfigService.run_sync_sheet(config_id, company_id, final_spreadsheet_id, sync_type)
        await ConfigService.setup_drive_watch(config_id, final_spreadsheet_id, sync_type)
        return itens_processados

    @staticmethod
    async def run_sync_drive(config_id: int, company_id: int, folder_id: str) -> int:
        """
        Lê os metadados do Google Drive e gera embeddings correspondentes.

        @param config_id: ID da configuração.
        @param company_id: ID da empresa.
        @param folder_id: ID da pasta no Drive.
        @returns: O número total de vetores indexados.
        """
        logger.info(f"Iniciando sincronização simplificada de Drive (Config: {config_id}, Empresa: {company_id})")
        
        async with SessionLocal() as db:
            try:
                drive_service = get_drive_service()
                gemini_service = get_gemini_service()
                
                drive_data = await drive_service.list_files_in_folder(folder_id)
                files_tree = drive_data.get("tree", {})
                
                drive_items = ConfigService.flatten_drive_tree(files_tree)
                
                contextos_buffer = []
                if drive_items:
                    lines_to_embed = [item["content"] for item in drive_items]
                    embeddings = await gemini_service.generate_embeddings_batch(lines_to_embed)
                    
                    for item, embedding in zip(drive_items, embeddings):
                        if embedding:
                            contextos_buffer.append(models.KnowledgeVector(
                                config_id=config_id,
                                content=item["content"],
                                origin="drive",
                                category=item["category"],
                                raw_data=item["raw_data"],
                                embedding=embedding
                            ))

                logger.info(f"Drive sync: deletando vetores anteriores para config_id={config_id}...")
                await db.execute(delete(models.KnowledgeVector).where(
                    models.KnowledgeVector.config_id == config_id,
                    models.KnowledgeVector.origin.in_(["drive", "drive_content"])
                ))
                
                if contextos_buffer:
                    db.add_all(contextos_buffer)
                
                await db.commit()
                logger.info(f"Drive sync concluída! {len(contextos_buffer)} vetores novos indexados.")
                return len(contextos_buffer)

            except Exception as e:
                logger.error(f"Erro na sincronização do Drive: {e}", exc_info=True)
                await db.rollback()
                raise e

    @staticmethod
    async def sync_google_drive(
        db: AsyncSession,
        company_id: int,
        config_id: int,
        folder_id: Optional[str]
    ) -> int:
        """
        Salva o ID da pasta do Drive (se fornecido) e executa o processo de sincronização de metadados.

        @param db: Sessão do banco de dados.
        @param company_id: ID da empresa.
        @param config_id: ID da configuração.
        @param folder_id: ID da pasta no Drive (opcional).
        @returns: O número total de vetores gerados.
        """
        db_config = await crud_config.get_config(db=db, config_id=config_id, company_id=company_id)
        if not db_config:
            raise ConfigNotFoundError("Configuração não encontrada.")
        
        if folder_id:
            db_config.drive_id = folder_id
            db.add(db_config)
            await db.commit()
        
        final_folder_id = db_config.drive_id
        if not final_folder_id:
            raise ConfigValidationError("Nenhum ID de pasta associado. Insira o ID da pasta do Google Drive.")

        itens_processados = await ConfigService.run_sync_drive(config_id, company_id, final_folder_id)
        await ConfigService.setup_drive_watch(config_id, final_folder_id, "drive")
        return itens_processados

    @staticmethod
    async def process_drive_webhook(
        db: AsyncSession,
        channel_id: Optional[str],
        resource_state: Optional[str],
        channel_token: Optional[str],
        background_tasks: Any,
        query_params: Dict[str, Any],
        body_json: Optional[Dict[str, Any]]
    ) -> Dict[str, str]:
        """
        Processa as requisições de webhook do Google Drive agendando sincronizações em background.

        @param db: Sessão do banco de dados.
        @param channel_id: ID do canal de watch.
        @param resource_state: Estado da notificação ('sync', 'update', etc.).
        @param channel_token: Token do canal contendo parâmetros codificados.
        @param background_tasks: Instância de background tasks do FastAPI.
        @param query_params: Parâmetros de consulta da URL do request.
        @param body_json: Payload JSON decodificado.
        @returns: Mensagem e status da requisição do webhook.
        """
        logger.info(f"Drive Webhook recebido - Channel: {channel_id}, State: {resource_state}, Token: {channel_token}")
        
        if resource_state == "sync":
            logger.info("Drive Webhook: Confirmação de registro (sync) recebida.")
            return {"status": "ok"}
            
        config_id = None
        resource_type = None

        if channel_token:
            try:
                params = dict(urllib.parse.parse_qsl(channel_token))
                if "config_id" in params and "resource_type" in params:
                    config_id = int(params["config_id"])
                    resource_type = params["resource_type"]
            except Exception as e:
                logger.warning(f"Erro ao parsear channel_token do drive: {e}")

        if (config_id is None or resource_type is None) and channel_id and channel_id.startswith("atendai-watch-"):
            parts = channel_id.replace("atendai-watch-", "").split("-")
            if len(parts) >= 2:
                try:
                    config_id = int(parts[0])
                    resource_type = parts[1]
                except Exception:
                    pass

        if config_id is not None and resource_type is not None:
            db_config = await db.get(models.Config, config_id)
            if db_config:
                company_id = db_config.company_id
                
                if settings.ENVIRONMENT == "development":
                    from sqlalchemy.orm import joinedload
                    stmt = select(models.Company).where(models.Company.id == company_id).options(joinedload(models.Company.users))
                    res_comp = await db.execute(stmt)
                    company = res_comp.scalars().first()
                    if not company or "cjstestes@gmail.com" not in [u.email for u in company.users]:
                        logger.info(f"Drive Webhook [DEV]: Ignorando webhook da config {config_id}. Permitido apenas para cjstestes@gmail.com.")
                        return {"status": "ignored_dev"}

                if resource_type == "system" and db_config.spreadsheet_id:
                    background_tasks.add_task(
                        ConfigService.run_sync_sheet, config_id, company_id, db_config.spreadsheet_id, "system"
                    )
                elif resource_type == "rag" and db_config.spreadsheet_rag_id:
                    background_tasks.add_task(
                        ConfigService.run_sync_sheet, config_id, company_id, db_config.spreadsheet_rag_id, "rag"
                    )
                elif resource_type == "drive" and db_config.drive_id:
                    background_tasks.add_task(
                        ConfigService.run_sync_drive, config_id, company_id, db_config.drive_id
                    )
                logger.info(f"Drive Webhook: Sincronização em background iniciada para Config: {config_id}, Tipo: {resource_type}")
                return {"status": "sync_started"}

        config_id_param = query_params.get("config_id")
        type_param = query_params.get("type")
        spreadsheet_id_param = query_params.get("spreadsheet_id")
        
        if body_json:
            if not config_id_param:
                config_id_param = body_json.get("config_id")
            if not type_param:
                type_param = body_json.get("type")
            if not spreadsheet_id_param:
                spreadsheet_id_param = body_json.get("spreadsheet_id")

        if spreadsheet_id_param:
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
                            ConfigService.run_sync_sheet, db_config.id, company_id, spreadsheet_id_param, "system"
                        )
                    if db_config.spreadsheet_rag_id == spreadsheet_id_param:
                        background_tasks.add_task(
                            ConfigService.run_sync_sheet, db_config.id, company_id, spreadsheet_id_param, "rag"
                        )
                logger.info(f"Webhook por Spreadsheet ID: Sincronização em background iniciada para Planilha {spreadsheet_id_param}")
                return {"status": "sync_started"}

        if config_id_param and type_param:
            config_id = int(config_id_param)
            db_config = await db.get(models.Config, config_id)
            if db_config:
                company_id = db_config.company_id
                if type_param == "system" and db_config.spreadsheet_id:
                    background_tasks.add_task(
                        ConfigService.run_sync_sheet, config_id, company_id, db_config.spreadsheet_id, "system"
                    )
                elif type_param == "rag" and db_config.spreadsheet_rag_id:
                    background_tasks.add_task(
                        ConfigService.run_sync_sheet, config_id, company_id, db_config.spreadsheet_rag_id, "rag"
                    )
                elif type_param == "drive" and db_config.drive_id:
                    background_tasks.add_task(
                        ConfigService.run_sync_drive, config_id, company_id, db_config.drive_id
                    )
                logger.info(f"Webhook Direto: Sincronização em background iniciada para Config: {config_id}, Tipo: {type_param}")
                return {"status": "sync_started"}
                
        return {"status": "ignored"}

    @staticmethod
    async def get_calendar_auth_url(redirect_uri: str) -> str:
        """
        Retorna a URL de redirecionamento de OAuth do Google Calendar.

        @param redirect_uri: URI de retorno cadastrada.
        @returns: A URL de autorização string.
        """
        service = get_google_calendar_service(None)
        return service.get_authorization_url(redirect_uri)

    @staticmethod
    async def calendar_callback(
        db: AsyncSession,
        company_id: int,
        config_id: int,
        code: str,
        redirect_uri: str
    ) -> None:
        """
        Lida com o callback do Google Calendar salvando as credenciais na Configuração correspondente.

        @param db: Sessão do banco de dados.
        @param company_id: ID da empresa do usuário.
        @param config_id: ID da configuração.
        @param code: Código de autorização recebido.
        @param redirect_uri: URI de retorno cadastrada.
        """
        db_config = await crud_config.get_config(db=db, config_id=config_id, company_id=company_id)
        if not db_config:
            raise ConfigNotFoundError("Configuração não encontrada.")
            
        service = get_google_calendar_service(db_config)
        credentials = service.fetch_token(code, redirect_uri)
        
        db_config.google_calendar_credentials = credentials
        db.add(db_config)
        await db.commit()

    @staticmethod
    async def disconnect_calendar(
        db: AsyncSession,
        company_id: int,
        config_id: int
    ) -> None:
        """
        Remove as credenciais do Google Calendar associadas à configuração.

        @param db: Sessão do banco de dados.
        @param company_id: ID da empresa.
        @param config_id: ID da configuração.
        """
        db_config = await crud_config.get_config(db=db, config_id=config_id, company_id=company_id)
        if db_config:
            db_config.google_calendar_credentials = None
            db_config.is_calendar_active = False
            await db.commit()

    @staticmethod
    async def analyze_workflow_feedback(
        db: AsyncSession,
        company_id: int,
        config_id: int,
        feedback: str,
        user: models.User,
        gemini_service: GeminiService,
        current_workflow: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Usa o Gemini para analisar e propor sugestões sobre o fluxo do assistente visual.
        """
        from app.services.feedback_agent_service import executar_agente_feedback
        return await executar_agente_feedback(
            db=db,
            company_id=company_id,
            config_id=config_id,
            feedback=feedback,
            modo='flow',
            user=user,
            current_workflow=current_workflow
        )

    @staticmethod
    async def apply_workflow_feedback(
        db: AsyncSession,
        company_id: int,
        config_id: int,
        novo_workflow: Optional[Dict[str, Any]]
    ) -> Dict[str, str]:
        """
        Salva o novo workflow visual na configuração indicada se fornecido.

        @param db: Sessão do banco de dados.
        @param company_id: ID da empresa.
        @param config_id: ID da configuração.
        @param novo_workflow: Novo objeto JSON representativo do fluxo.
        @returns: Resposta contendo o status da alteração.
        """
        persona = await crud_config.get_config(db=db, config_id=config_id, company_id=company_id)
        if not persona:
            raise ConfigNotFoundError("Configuração não encontrada")

        if novo_workflow:
            persona.workflow_json = novo_workflow
            db.add(persona)
            await db.commit()
            return {"message": "Novo fluxo visual salvo com sucesso."}
        
        return {"message": "Nenhuma alteração foi solicitada no fluxo."}

    @staticmethod
    async def analyze_atendimento_feedback(
        db: AsyncSession,
        user: models.User,
        company_id: int,
        atendimento_id: int,
        feedback: str,
        gemini_service: GeminiService
    ) -> Dict[str, Any]:
        """
        Interage com a IA do Gemini para gerar sugestões de melhoria com base no feedback humano.
        """
        from app.services.atendimento_service import AtendimentoNotFoundError

        db_atendimento = await crud_atendimento.get_atendimento(db, atendimento_id=atendimento_id, company_id=company_id)
        if not db_atendimento:
            raise AtendimentoNotFoundError("Atendimento não encontrado")

        default_persona_id = user.company.default_persona_id if user.company else None
        persona_id = db_atendimento.active_persona_id or default_persona_id
        if not persona_id:
            raise ValueError("Persona não encontrada para este atendimento.")

        from app.services.feedback_agent_service import executar_agente_feedback
        return await executar_agente_feedback(
            db=db,
            company_id=company_id,
            config_id=persona_id,
            feedback=feedback,
            modo='conversation',
            user=user,
            atendimento_id=atendimento_id
        )

    @staticmethod
    async def apply_atendimento_feedback(
        db: AsyncSession,
        company_id: int,
        atendimento_id: int,
        payload: schemas.AtendimentoUpdate  # Usando o payload do endpoint (ApplyFeedbackPayload)
    ) -> Dict[str, str]:
        """
        Aplica as atualizações propostas pela IA de feedback na planilha e nas configurações.

        @param db: Sessão do banco de dados.
        @param company_id: ID da empresa.
        @param atendimento_id: ID do atendimento relacionado.
        @param payload: Objeto contendo as modificações para planilhas e RAG.
        @returns: Relatório de status da aplicação.
        """
        from app.services.atendimento_service import AtendimentoNotFoundError

        db_atendimento = await crud_atendimento.get_atendimento(db, atendimento_id=atendimento_id, company_id=company_id)
        if not db_atendimento:
            raise AtendimentoNotFoundError("Atendimento não encontrado")
            
        default_persona_id = db_atendimento.company.default_persona_id if db_atendimento.company else None
        persona_id = db_atendimento.active_persona_id or default_persona_id
        persona = await db.get(models.Config, persona_id)
        if not persona:
            raise ValueError("Persona não encontrada.")
            
        sheets_service = GoogleSheetsService()
        mensagens_sucesso = []

        # 1. Aplicar alterações na Planilha de Sistema
        if payload.alteracoes_planilha and persona.spreadsheet_id:
            alteracoes_dict = [a.model_dump() for a in payload.alteracoes_planilha]
            await sheets_service.apply_feedback_to_sheet(persona.spreadsheet_id, alteracoes_dict)
            
            sheet_data_json = await sheets_service.get_sheet_as_json(persona.spreadsheet_id)
            prompt_buffer = []
            for sheet_name, rows in sheet_data_json.items():
                if not rows:
                    continue
                headers = list(rows[0].keys())
                lines = [f"# {sheet_name}", "|".join(headers)]
                for row in rows:
                    values = [str(row.get(h, "") or "").strip().replace("\n", "\\n").replace("\r", "") for h in headers]
                    lines.append("|".join(values))
                prompt_buffer.append("\n".join(lines))
            
            persona.prompt = "\n\n".join(prompt_buffer)
            mensagens_sucesso.append("Planilha de sistema atualizada.")

        # 2. Aplicar alterações na Planilha RAG e ressincronizar embeddings
        if payload.alteracoes_rag and persona.spreadsheet_rag_id:
            alteracoes_rag_dict = [a.model_dump() for a in payload.alteracoes_rag]
            await sheets_service.apply_feedback_to_sheet(persona.spreadsheet_rag_id, alteracoes_rag_dict)
            
            await ConfigService.run_sync_sheet(persona.id, company_id, persona.spreadsheet_rag_id, "rag")
            mensagens_sucesso.append("Planilha RAG atualizada e embeddings regerados.")

        # 3. Substituir o JSON do fluxo
        if payload.novo_workflow:
            persona.workflow_json = payload.novo_workflow
            mensagens_sucesso.append("Novo fluxo visual fluxo visual salvo com sucesso.")

        db.add(persona)
        await db.commit()

        if not mensagens_sucesso:
            return {"message": "Nenhuma alteração foi solicitada ou aplicável."}

        return {"message": " ".join(mensagens_sucesso)}

    @staticmethod
    async def analyze_knowledge_feedback(
        db: AsyncSession,
        company_id: int,
        config_id: int,
        feedback: str,
        user: models.User
    ) -> Dict[str, Any]:
        """
        Usa o Pydantic AI para analisar e propor sugestões sobre a base de conhecimento.
        """
        from app.services.feedback_agent_service import executar_agente_feedback
        return await executar_agente_feedback(
            db=db,
            company_id=company_id,
            config_id=config_id,
            feedback=feedback,
            modo='knowledge',
            user=user
        )

    @staticmethod
    async def apply_config_feedback(
        db: AsyncSession,
        company_id: int,
        config_id: int,
        payload: schemas.ApplyFeedbackPayload
    ) -> Dict[str, str]:
        """
        Aplica as atualizações propostas pela IA de feedback diretamente em uma configuração (persona).
        """
        persona = await db.get(models.Config, config_id)
        if not persona or persona.company_id != company_id:
            raise ConfigNotFoundError("Persona não encontrada.")
            
        sheets_service = GoogleSheetsService()
        mensagens_sucesso = []

        # 1. Aplicar alterações na Planilha de Sistema
        if payload.alteracoes_planilha and persona.spreadsheet_id:
            alteracoes_dict = [a.model_dump() for a in payload.alteracoes_planilha]
            await sheets_service.apply_feedback_to_sheet(persona.spreadsheet_id, alteracoes_dict)
            
            sheet_data_json = await sheets_service.get_sheet_as_json(persona.spreadsheet_id)
            prompt_buffer = []
            for sheet_name, rows in sheet_data_json.items():
                if not rows:
                    continue
                headers = list(rows[0].keys())
                lines = [f"# {sheet_name}", "|".join(headers)]
                for row in rows:
                    values = [str(row.get(h, "") or "").strip().replace("\n", "\\n").replace("\r", "") for h in headers]
                    lines.append("|".join(values))
                prompt_buffer.append("\n".join(lines))
            
            persona.prompt = "\n\n".join(prompt_buffer)
            mensagens_sucesso.append("Planilha de sistema atualizada.")

        # 2. Aplicar alterações na Planilha RAG e ressincronizar embeddings
        if payload.alteracoes_rag and persona.spreadsheet_rag_id:
            alteracoes_rag_dict = [a.model_dump() for a in payload.alteracoes_rag]
            await sheets_service.apply_feedback_to_sheet(persona.spreadsheet_rag_id, alteracoes_rag_dict)
            
            await ConfigService.run_sync_sheet(persona.id, company_id, persona.spreadsheet_rag_id, "rag")
            mensagens_sucesso.append("Planilha RAG atualizada e embeddings regerados.")

        # 3. Substituir o JSON do fluxo
        if payload.novo_workflow:
            persona.workflow_json = payload.novo_workflow
            mensagens_sucesso.append("Fluxo visual salvo com sucesso.")

        db.add(persona)
        await db.commit()

        if not mensagens_sucesso:
            return {"message": "Nenhuma alteração foi solicitada ou aplicável."}

        return {"message": " ".join(mensagens_sucesso)}
