import logging
from sqlalchemy import text
from app.db.database import engine
from app.db import models

logger = logging.getLogger(__name__)

async def init_db():
    """Inicializa o banco de dados: Extensões, Funções e Tabelas."""
    # Tenta criar a extensão vector separadamente (evita falha crítica se permissões forem insuficientes)
    try:
        async with engine.begin() as conn:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    except Exception as e:
        logger.warning(f"Aviso: Não foi possível criar a extensão 'vector'. Erro: {e}")

    async with engine.begin() as conn:
        try:
            # --- NOVO: Função para obter timestamp da última mensagem do CLIENTE ---
            await conn.execute(text("""
                CREATE OR REPLACE FUNCTION get_last_user_msg_timestamp(conversa_text TEXT)
                RETURNS TIMESTAMP WITH TIME ZONE AS $$
                DECLARE
                    last_ts BIGINT;
                BEGIN
                    IF conversa_text IS NULL OR length(conversa_text) < 2 THEN
                        RETURN NULL;
                    END IF;
                    
                    BEGIN
                        SELECT (elem->>'timestamp')::bigint INTO last_ts
                        FROM jsonb_array_elements(conversa_text::jsonb) AS elem
                        WHERE elem->>'role' = 'user'
                        ORDER BY (elem->>'timestamp')::bigint DESC
                        LIMIT 1;
                        
                        IF last_ts IS NOT NULL THEN
                            RETURN TO_TIMESTAMP(last_ts) AT TIME ZONE 'UTC';
                        END IF;
                    EXCEPTION WHEN others THEN
                        RETURN NULL;
                    END;
                    RETURN NULL;
                END;
                $$ LANGUAGE plpgsql IMMUTABLE;
            """))
            logger.info("Função SQL 'get_last_user_msg_timestamp' verificada/criada.")

            # await conn.run_sync(models.Base.metadata.drop_all)
            await conn.run_sync(models.Base.metadata.create_all)
            logger.info("Tabelas do banco de dados verificadas/criadas com sucesso.")
        except Exception as e:
            logger.exception("ERRO CRÍTICO ao criar tabelas do banco de dados.") # Usa logger.exception para incluir traceback
            raise