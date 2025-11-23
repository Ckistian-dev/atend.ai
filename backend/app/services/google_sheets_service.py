# app/services/google_sheets_service.py

import logging
import json
import pandas as pd
import numpy as np
from typing import Dict, List, Any
from google.oauth2 import service_account
from googleapiclient.discovery import build
from app.core.config import settings  # <--- Importando suas configurações

logger = logging.getLogger(__name__)

class GoogleSheetsService:
    def __init__(self):
        self.scopes = ['https://www.googleapis.com/auth/spreadsheets.readonly']
        self.service = None
        
        try:
            # 1. Pega o JSON das configurações (Variável de Ambiente)
            json_str = settings.GOOGLE_SERVICE_ACCOUNT_JSON
            
            # 2. Converte string para dicionário
            creds_info = json.loads(json_str)
            
            logger.info("Sheets: Autenticando via credenciais do Settings...")
            self.creds = service_account.Credentials.from_service_account_info(
                creds_info, scopes=self.scopes
            )
            
            # 3. Inicializa o cliente da API
            self.service = build('sheets', 'v4', credentials=self.creds)
            logger.info("Sheets: Serviço inicializado com sucesso.")

        except json.JSONDecodeError:
            logger.error("Sheets: Erro ao decodificar JSON da variável GOOGLE_SERVICE_ACCOUNT_JSON.")
            self.service = None
        except Exception as e:
            logger.error(f"Sheets: Erro crítico na inicialização: {e}", exc_info=True)
            self.service = None

    async def get_sheet_as_json(self, spreadsheet_id_or_url: str) -> Dict[str, List[Dict[str, Any]]]:
        """
        Busca os dados da planilha usando a API do Google (privada).
        Aceita o ID da planilha ou tenta extrair o ID da URL.
        """
        if not self.service:
            raise Exception("Serviço Google Sheets não está autenticado/inicializado.")

        # Lógica simples para extrair ID se o usuário mandar a URL completa
        spreadsheet_id = spreadsheet_id_or_url
        if "docs.google.com" in spreadsheet_id_or_url:
            # Tenta pegar o ID entre /d/ e /edit
            try:
                start = spreadsheet_id_or_url.find("/d/") + 3
                end = spreadsheet_id_or_url.find("/", start)
                if end == -1: # Caso não tenha barra final
                    spreadsheet_id = spreadsheet_id_or_url[start:]
                else:
                    spreadsheet_id = spreadsheet_id_or_url[start:end]
            except:
                pass # Falha silenciosa, tenta usar o original

        final_json_context = {}

        try:
            # 1. Busca metadados para saber os nomes das abas
            sheet_metadata = self.service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
            sheets = sheet_metadata.get('sheets', [])

            if not sheets:
                raise Exception("Nenhuma aba encontrada na planilha.")

            # 2. Itera sobre cada aba
            for sheet in sheets:
                title = sheet['properties']['title']
                
                # Pega todos os valores da aba
                result = self.service.spreadsheets().values().get(
                    spreadsheetId=spreadsheet_id, 
                    range=title
                ).execute()
                
                rows = result.get('values', [])

                # Se tiver menos de 2 linhas (só cabeçalho ou vazio), ignora
                if len(rows) < 2:
                    continue

                # 3. Usa Pandas para limpar e estruturar (mantendo sua lógica original)
                # A primeira linha (rows[0]) vira cabeçalho
                headers = rows[0]
                data = rows[1:]

                # Cria DataFrame. Se houver linhas com tamanhos diferentes, o pandas ajusta
                df = pd.DataFrame(data, columns=headers)

                # --- Lógica de Limpeza (igual ao seu código anterior) ---
                # Remove linhas/colunas totalmente vazias
                df.dropna(how='all', axis=0, inplace=True) 
                df.dropna(how='all', axis=1, inplace=True) # Pode dar erro se colunas não tiverem nome, mas ok

                # Substitui strings vazias e NaN por None
                df = df.replace(r'^\s*$', None, regex=True)
                df = df.replace({np.nan: None})

                # Converte para dict
                final_json_context[title] = df.to_dict(orient='records')

            if not final_json_context:
                raise Exception("Nenhum dado válido encontrado nas abas da planilha.")

            return final_json_context

        except Exception as e:
            logger.error(f"Sheets: Erro ao processar planilha ID {spreadsheet_id}: {e}", exc_info=True)
            # Dica de erro comum para ajudar no debug
            if "403" in str(e):
                raise Exception("Erro de Permissão (403). Você compartilhou a planilha com o email da Service Account?")
            if "404" in str(e):
                raise Exception("Planilha não encontrada (404). Verifique o ID.")
            raise Exception(f"Erro ao ler planilha: {str(e)}")