# app/services/google_sheets_service.py

import httpx
import pandas as pd
import io
import logging
from typing import Dict, List, Any
import numpy as np

logger = logging.getLogger(__name__)

class GoogleSheetsService:
    async def get_sheet_as_json(self, spreadsheet_url: str) -> Dict[str, List[Dict[str, Any]]]:
        """
        Busca um ficheiro .xlsx publicado do Google Sheets, lê todas as abas
        e converte para um dicionário JSON, tratando células vazias corretamente.
        """
        if "pub?output=xlsx" not in spreadsheet_url:
            raise Exception("URL inválida. Por favor, use o link de publicação 'Microsoft Excel (.xlsx)'.")

        final_json_context = {}
        
        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(spreadsheet_url, follow_redirects=True, timeout=30.0)
                response.raise_for_status()

                excel_data = io.BytesIO(response.content)

                all_sheets_df = pd.read_excel(excel_data, sheet_name=None, engine='openpyxl', header=None)

                for sheet_name, df in all_sheets_df.items():
                    try:
                        df.dropna(how='all', axis=0, inplace=True)
                        df.dropna(how='all', axis=1, inplace=True)

                        if df.shape[0] < 2:
                            continue

                        df.columns = df.iloc[0]
                        df = df[1:].reset_index(drop=True)

                        # Substitui todos os valores NaN por None (que se torna null em JSON)
                        df = df.replace({np.nan: None})

                        final_json_context[sheet_name] = df.to_dict(orient='records')
                    
                    except Exception as e_inner:
                        logger.error(f"Falha ao processar a aba '{sheet_name}'. Erro: {e_inner}", exc_info=False)
                        continue

                if not final_json_context:
                    raise Exception("Nenhuma aba com dados válidos foi encontrada no ficheiro Excel.")

                return final_json_context

            except Exception as e:
                logger.error(f"Erro geral no serviço Google Sheets: {e}", exc_info=True)
                raise Exception(f"Erro ao processar o ficheiro da planilha: {str(e)}")