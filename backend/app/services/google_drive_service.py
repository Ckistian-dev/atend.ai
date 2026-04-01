import logging
import json
from google.oauth2 import service_account
from googleapiclient.discovery import build
from app.core.config import settings  # <--- Importando suas configurações

logger = logging.getLogger(__name__)

class GoogleDriveService:
    def __init__(self):
        self.service = None
        # Escopo alterado para ter permissão de criar arquivos e modificar permissões
        self.scopes = ['https://www.googleapis.com/auth/drive']
        
        try:
            # A string JSON vem direto do Pydantic settings
            json_str = settings.GOOGLE_SERVICE_ACCOUNT_JSON
            
            # Convertemos a string para dicionário
            creds_info = json.loads(json_str)
            
            logger.info("Drive: Autenticando via credenciais do Settings...")
            self.creds = service_account.Credentials.from_service_account_info(
                creds_info, scopes=self.scopes
            )

            self.service = build('drive', 'v3', credentials=self.creds)
            logger.info("Drive: Serviço inicializado com sucesso.")

        except json.JSONDecodeError as e:
            logger.error("Drive: Erro ao decodificar o JSON da variável GOOGLE_SERVICE_ACCOUNT_JSON. Verifique a formatação no .env.", exc_info=True)
            self.service = None
        except Exception as e:
            logger.error(f"Drive: Erro crítico ao iniciar serviço: {e}", exc_info=True)
            self.service = None

    def _get_readable_type(self, mime_type: str) -> str:
        """Converte MimeTypes técnicos do Google em nomes amigáveis para a IA."""
        if 'image' in mime_type: return 'Imagem'
        if 'video' in mime_type: return 'Vídeo'
        if 'audio' in mime_type: return 'Áudio'
        if 'pdf' in mime_type: return 'PDF'
        if 'word' in mime_type or 'document' in mime_type: return 'Documento Word'
        if 'sheet' in mime_type or 'excel' in mime_type: return 'Planilha'
        if 'presentation' in mime_type or 'powerpoint' in mime_type: return 'Apresentação'
        if 'folder' in mime_type: return 'Pasta'
        return 'Arquivo'

    async def list_files_in_folder(self, root_folder_id: str):
        """
        Lista arquivos recursivamente e retorna uma estrutura de árvore (Nested JSON).
        Formato:
        {
            "nome": "Raiz",
            "arquivos": [...],
            "subpastas": [
                { "nome": "Subpasta A", "arquivos": [...], "subpastas": [...] }
            ]
        }
        """
        if not self.service:
            logger.error("Drive: Tentativa de uso sem serviço inicializado.")
            return {"tree": {}, "count": 0}

        # 1. Tenta pegar o nome da pasta raiz para o objeto inicial
        try:
            root_meta = self.service.files().get(fileId=root_folder_id, fields='name').execute()
            root_name = root_meta.get('name', 'Raiz')
        except Exception:
            root_name = 'Pasta Principal'

        # Estrutura inicial da árvore
        root_structure = {
            "nome": root_name,
            "arquivos": [],
            "subpastas": []
        }

        # MAPA DE REFERÊNCIA: id_da_pasta -> objeto_da_pasta (na memória)
        # Isso permite que a gente encontre e preencha a subpasta correta durante o loop
        folder_map = {root_folder_id: root_structure}

        # Fila de processamento (apenas IDs)
        folders_to_scan = [root_folder_id]
        scanned_folders = set()
        
        MAX_FILES_LIMIT = 500
        total_files_count = 0

        try:
            while folders_to_scan and total_files_count < MAX_FILES_LIMIT:
                current_folder_id = folders_to_scan.pop(0)
                
                # Recupera a referência do objeto desta pasta no mapa
                current_folder_node = folder_map.get(current_folder_id)

                if current_folder_id in scanned_folders:
                    continue
                
                scanned_folders.add(current_folder_id)
                
                # Loop de Paginação
                page_token = None
                while True:
                    if total_files_count >= MAX_FILES_LIMIT: break

                    query = f"'{current_folder_id}' in parents and trashed = false"
                    
                    results = self.service.files().list(
                        q=query,
                        pageSize=100,
                        fields="nextPageToken, files(id, name, mimeType, webViewLink)",
                        pageToken=page_token
                    ).execute()
                    
                    items = results.get('files', [])
                    
                    for item in items:
                        if item['mimeType'] == 'application/vnd.google-apps.folder':
                            # É PASTA: 
                            # 1. Cria o objeto da nova pasta
                            new_folder_node = {
                                "nome": item['name'],
                                "arquivos": [],
                                "subpastas": []
                            }
                            # 2. Adiciona este objeto na lista de subpastas da pasta PAI (current_folder_node)
                            current_folder_node['subpastas'].append(new_folder_node)
                            
                            # 3. Registra no mapa para podermos preenchê-la quando chegar a vez dela na fila
                            folder_map[item['id']] = new_folder_node
                            folders_to_scan.append(item['id'])
                        else:
                            # É ARQUIVO: Adiciona na lista de arquivos da pasta atual
                            current_folder_node['arquivos'].append({
                                "nome": item['name'],
                                "id": item['id'],
                                "tipo": self._get_readable_type(item['mimeType']),
                                "mimeType": item.get('mimeType', ''),
                                "link": item.get('webViewLink', '')
                            })
                            total_files_count += 1
                    
                    page_token = results.get('nextPageToken')
                    if not page_token:
                        break
            
            logger.info(f"Drive: Varredura completa. {total_files_count} arquivos organizados em árvore.")
            return {"tree": root_structure, "count": total_files_count}

        except Exception as e:
            logger.error(f"Drive: Erro ao listar arquivos recursivamente: {e}")
            raise e

    def download_file_bytes(self, file_id: str):
        """Baixa o conteúdo do arquivo em memória (bytes)."""
        from googleapiclient.http import MediaIoBaseDownload
        import io

        if not self.service: return None
        
        try:
            request = self.service.files().get_media(fileId=file_id)
            file_io = io.BytesIO()
            downloader = MediaIoBaseDownload(file_io, request)
            done = False
            while done is False:
                status, done = downloader.next_chunk()
            
            return file_io.getvalue()
        except Exception as e:
            logger.error(f"Drive: Erro no download: {e}")
            return None

    async def copy_file_and_share(self, base_file_id: str, new_title: str, emails: list) -> str:
        """Copia um arquivo base e compartilha com os emails fornecidos."""
        if not self.service: raise Exception("Serviço do Google Drive não inicializado.")
        try:
            body = {'name': new_title}
            new_file = self.service.files().copy(fileId=base_file_id, body=body, supportsAllDrives=True).execute()
            new_file_id = new_file.get('id')
            
            for email in emails:
                if email and "@" in email:
                    perm = {'type': 'user', 'role': 'writer', 'emailAddress': email.strip()}
                    self.service.permissions().create(fileId=new_file_id, body=perm, sendNotificationEmail=True).execute()
            return new_file_id
        except Exception as e:
            logger.error(f"Erro ao copiar arquivo {base_file_id}: {e}")
            raise e

    async def create_folder_and_share(self, folder_name: str, emails: list) -> str:
        """Cria uma nova pasta no Drive e a compartilha."""
        if not self.service: raise Exception("Serviço do Google Drive não inicializado.")
        try:
            file_metadata = {'name': folder_name, 'mimeType': 'application/vnd.google-apps.folder'}
            folder = self.service.files().create(body=file_metadata, fields='id').execute()
            folder_id = folder.get('id')
            
            for email in emails:
                if email and "@" in email:
                    perm = {'type': 'user', 'role': 'writer', 'emailAddress': email.strip()}
                    self.service.permissions().create(fileId=folder_id, body=perm, sendNotificationEmail=True).execute()
            return folder_id
        except Exception as e:
            logger.error(f"Erro ao criar pasta: {e}")
            raise e

_drive_service = None
def get_drive_service():
    global _drive_service
    if _drive_service is None:
        _drive_service = GoogleDriveService()
    return _drive_service