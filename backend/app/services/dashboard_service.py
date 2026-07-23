import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List
from sqlalchemy.ext.asyncio import AsyncSession
from app.db import models
from app.crud import crud_atendimento
from app.services.gemini_service import GeminiService

logger = logging.getLogger(__name__)

class DashboardService:
    @staticmethod
    async def get_dashboard_data(
        db: AsyncSession,
        current_user: models.User,
        start_date_str: str = None,
        end_date_str: str = None
    ) -> Dict[str, Any]:
        """
        Coleta e formata dados agregados para o dashboard da empresa do usuário logado.

        @param db: Sessão do banco de dados.
        @param current_user: Modelo do usuário logado.
        @param start_date_str: Data de início no formato ISO.
        @param end_date_str: Data de término no formato ISO.
        @returns: Dicionário com dados agregados do dashboard.
        """
        start_date = datetime.fromisoformat(start_date_str) if start_date_str else datetime.now() - timedelta(days=30)
        end_date = datetime.fromisoformat(end_date_str) if end_date_str else datetime.now()

        company_id = current_user.company_id or 0
        return await crud_atendimento.get_dashboard_data(
            db, company_id=company_id, start_date=start_date, end_date=end_date
        )

    @staticmethod
    async def analyze_data_with_ia(
        db: AsyncSession,
        current_user: models.User,
        question: str,
        model_name: str,
        start_date_str: str,
        end_date_str: str,
        gemini_service: GeminiService
    ) -> Dict[str, Any]:
        """
        Coleta os dados do período solicitado, sincroniza as mensagens para busca vetorial,
        e executa o Agente de IA de Análise para gerar um relatório estruturado.
        """
        if not question:
            raise ValueError("A pergunta é obrigatória.")

        start_date = datetime.fromisoformat(start_date_str) if start_date_str else None
        end_date = datetime.fromisoformat(end_date_str) if end_date_str else None

        company_id = current_user.company_id or 0

        # 1. Sincroniza os atendimentos da empresa no banco de busca vetorial
        from app.services.analysis_agent_service import sync_atendimentos_to_search, analysis_agent, ContextoAnalise
        await sync_atendimentos_to_search(db, company_id=company_id, gemini_service=gemini_service)

        # 2. Inicializa o contexto do agente
        contexto = ContextoAnalise(
            db=db,
            company_id=company_id,
            start_date=start_date,
            end_date=end_date,
            user=current_user,
            gemini_service=gemini_service,
            model_name=model_name or "gemini-2.5-flash"
        )

        # 3. Resolve o nome do modelo para o formato do Pydantic AI
        model_to_use = model_name or "gemini-2.5-flash"
        if not model_to_use.startswith("google:") and not model_to_use.startswith("google-cloud:"):
            model_to_use = f"google:{model_to_use}"

        # 4. Executa o agente
        try:
            logger.info(f"Executando Agente de Análise com o modelo '{model_to_use}'...")
            resultado = await analysis_agent.run(
                question,
                deps=contexto,
                model=model_to_use
            )
            analysis_data = resultado.output.model_dump()
        except Exception as e:
            logger.error(f"Erro ao executar o agente de análise: {e}", exc_info=True)
            raise e

        return {"analysis": analysis_data}

