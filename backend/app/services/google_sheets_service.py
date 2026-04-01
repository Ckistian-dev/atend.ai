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
        self.scopes = ['https://www.googleapis.com/auth/spreadsheets']
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

    async def apply_feedback_to_sheet(self, spreadsheet_id_or_url: str, alteracoes: List[Dict[str, Any]]):
        """
        Aplica alterações (Substituir ou Adicionar) direto na planilha do Google Sheets.
        """
        if not self.service:
            raise Exception("Serviço Google Sheets não está autenticado/inicializado.")

        spreadsheet_id = spreadsheet_id_or_url
        if "docs.google.com" in spreadsheet_id_or_url:
            try:
                start = spreadsheet_id_or_url.find("/d/") + 3
                end = spreadsheet_id_or_url.find("/", start)
                spreadsheet_id = spreadsheet_id_or_url[start:] if end == -1 else spreadsheet_id_or_url[start:end]
            except: pass

        try:
            sheet_metadata = self.service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
            sheets = {s['properties']['title'].lower(): s['properties']['title'] for s in sheet_metadata.get('sheets', [])}
            if not sheets: raise Exception("Nenhuma aba encontrada na planilha.")
            
            for alt in alteracoes:
                # Remove hashtags enviadas pela IA e garante minúsculas
                aba_req = alt.get("aba", "").lower().replace("#", "").strip()
                
                # Tenta match exato ou parcial no nome da aba
                aba = sheets.get(aba_req)
                if not aba:
                    for k, v in sheets.items():
                        if aba_req in k or k in aba_req:
                            aba = v
                            break
                
                # Fallback: Se a IA errar a aba, pega a primeira que contenha 'persona', 'regra' ou 'fluxo'
                if not aba:
                    fallback = next((v for k, v in sheets.items() if "persona" in k or "regra" in k or "fluxo" in k), None)
                    aba = fallback if fallback else list(sheets.values())[0]

                col1 = alt.get("coluna_1", "Nova Regra")
                novo = alt.get("valor_novo", "")
                acao = str(alt.get("acao", "adicionar")).strip().lower()
                
                row_to_update = -1
                
                if acao == "substituir":
                    result = self.service.spreadsheets().values().get(spreadsheetId=spreadsheet_id, range=f"'{aba}'!A:B").execute()
                    rows = result.get('values', [])
                    for i, row in enumerate(rows):
                        if i == 0: continue # Pula cabeçalho
                        
                        row_col1 = row[0].strip().lower() if len(row) > 0 else ""
                        row_col2 = row[1].strip().lower() if len(row) > 1 else ""
                        
                        target_col1 = col1.strip().lower()
                        target_old_val = str(alt.get("valor_antigo") or "").strip().lower()
                        
                        # Considera match se a Coluna 1 bater OU se o Valor Antigo estiver na Coluna 2 da planilha (fallback caso a IA resuma o nome da Coluna 1)
                        match_col1 = (target_col1 != "" and target_col1 == row_col1)
                        
                        match_old = False
                        if target_old_val and row_col2:
                            clean_target = " ".join(target_old_val.split())
                            clean_row = " ".join(row_col2.split())
                            if clean_target in clean_row or clean_row in clean_target:
                                match_old = True
                                
                        if match_col1 or match_old:
                            row_to_update = i + 1 # Sheets usa índice base 1
                            col1 = row[0] if len(row) > 0 else col1 # Mantém o nome exato da categoria original da planilha
                            break
                
                if row_to_update != -1:
                    # Atualiza a linha existente
                    self.service.spreadsheets().values().update(
                        spreadsheetId=spreadsheet_id, range=f"'{aba}'!A{row_to_update}:B{row_to_update}",
                        valueInputOption="USER_ENTERED", body={"values": [[col1, novo]]}
                    ).execute()
                else:
                    # Adiciona nova linha (Adicionar ou se não encontrou o que substituir)
                    self.service.spreadsheets().values().append(
                        spreadsheetId=spreadsheet_id, range=f"'{aba}'!A:B",
                        valueInputOption="USER_ENTERED", insertDataOption="INSERT_ROWS",
                        body={"values": [[col1, novo]]}
                    ).execute()

            return True
        except Exception as e:
            logger.error(f"Sheets: Erro ao aplicar feedback na planilha ID {spreadsheet_id}: {e}", exc_info=True)
            if "403" in str(e): raise Exception("Erro de Permissão (403). O e-mail do bot tem permissão de EDITOR na planilha?")
            raise Exception(f"Erro ao escrever na planilha: {str(e)}")