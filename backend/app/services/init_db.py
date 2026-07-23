import logging
from sqlalchemy import text, inspect
from sqlalchemy.schema import CreateColumn, AddConstraint
from app.db.database import engine
from app.db import models

logger = logging.getLogger(__name__)

def sync_schema(connection):
    """
    Sincroniza o schema do banco de dados com os modelos SQLAlchemy de forma segura:
    - Cria tabelas que não existem.
    - Verifica e cria colunas que não existem nas tabelas existentes.
    - Adiciona chaves estrangeiras para novas colunas se aplicável.
    - NUNCA exclui tabelas, colunas ou dados.
    """
    inspector = inspect(connection)
    existing_tables = inspector.get_table_names()
    
    # 1. Cria tabelas inexistentes primeiro de forma segura (sem deletar nenhuma tabela ou dados)
    models.Base.metadata.create_all(connection)
    
    # Atualiza a lista de tabelas existentes após a criação de novas tabelas
    inspector = inspect(connection)
    existing_tables = inspector.get_table_names()
    
    # 2. Verifica colunas para cada tabela definida nos modelos
    for table_name, table in models.Base.metadata.tables.items():
        if table_name in existing_tables:
            # Obtém colunas existentes no banco para a tabela atual (com nomes em minúsculo para comparação segura)
            db_columns = {col["name"].lower() for col in inspector.get_columns(table_name)}
            
            for column in table.columns:
                col_name_lower = column.name.lower()
                if col_name_lower not in db_columns:
                    logger.info(f"Coluna '{column.name}' não encontrada na tabela '{table_name}'. Criando...")
                    try:
                        # Compila a definição DDL da coluna específica para o dialeto do banco (PostgreSQL)
                        column_ddl = CreateColumn(column).compile(dialect=connection.dialect)
                        # Executa o ALTER TABLE para adicionar a coluna
                        alter_query = f"ALTER TABLE {table_name} ADD COLUMN {column_ddl}"
                        connection.execute(text(alter_query))
                        logger.info(f"Coluna '{column.name}' adicionada com sucesso na tabela '{table_name}'.")
                        
                        # Se a coluna tiver chaves estrangeiras associadas, tenta adicionar as restrições
                        for fk in column.foreign_keys:
                            try:
                                fk_constraint = fk.constraint
                                add_fk_query = str(AddConstraint(fk_constraint).compile(dialect=connection.dialect))
                                connection.execute(text(add_fk_query))
                                logger.info(f"Chave estrangeira para a coluna '{column.name}' adicionada com sucesso na tabela '{table_name}'.")
                            except Exception as fk_ex:
                                logger.warning(f"Aviso ao adicionar chave estrangeira para a coluna '{column.name}' na tabela '{table_name}': {fk_ex}")
                    except Exception as col_ex:
                        logger.error(f"Erro ao adicionar a coluna '{column.name}' na tabela '{table_name}': {col_ex}")

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
            # --- Altera colunas de integrações para TEXT para aceitar listas longas de campos selecionados ---
            await conn.execute(text("""
                DO $$
                BEGIN
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'integrations') THEN
                        ALTER TABLE integrations ALTER COLUMN content_field TYPE TEXT;
                        ALTER TABLE integrations ALTER COLUMN items_path TYPE TEXT;
                        ALTER TABLE integrations ALTER COLUMN title_field TYPE TEXT;
                    END IF;
                END $$;
            """))

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

            # --- Executa a migração do schema para multi-tenant (empresa & usuários) se necessário ---
            try:
                migration_sql = """
DO $$
DECLARE
    users_exists BOOLEAN;
    has_company_id BOOLEAN;
    has_old_cols BOOLEAN;
    has_followup_cols BOOLEAN;
    u RECORD;
    new_company_id INTEGER;
BEGIN
    -- Check if users table exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'users'
    ) INTO users_exists;

    IF users_exists THEN
        -- Rename column nome to name if companies table exists and has old name
        IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = 'companies' AND column_name = 'nome'
        ) AND NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = 'companies' AND column_name = 'name'
        ) THEN
            ALTER TABLE companies RENAME COLUMN nome TO name;
        END IF;

        -- Ensure companies table is created first
        CREATE TABLE IF NOT EXISTS companies (
            id SERIAL PRIMARY KEY
        );

        -- Ensure all columns exist on companies
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS name VARCHAR(255) NOT NULL DEFAULT 'Empresa';
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS wbp_phone_number_id VARCHAR(255);
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS wbp_business_account_id VARCHAR(255);
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS agent_running BOOLEAN DEFAULT FALSE NOT NULL;
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS atendente_online BOOLEAN DEFAULT FALSE NOT NULL;
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS tokens INTEGER DEFAULT 0 NOT NULL;
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS default_persona_id INTEGER;
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS prospect_token TEXT;
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS followup_active BOOLEAN DEFAULT FALSE NOT NULL;
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS followup_config JSONB;

        -- Check if users has company_id
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'company_id'
        ) INTO has_company_id;

        -- If it does not, run migration
        IF NOT has_company_id THEN
            -- Add company_id to users
            ALTER TABLE users ADD COLUMN company_id INTEGER REFERENCES companies(id);

            -- Ensure role column exists on users table before migration updates it
            ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) NOT NULL DEFAULT 'user';

            -- Check if old columns exist on users (to migrate data)
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'wbp_phone_number_id'
            ) INTO has_old_cols;

            IF has_old_cols THEN
                -- Migrate each user to a company
                FOR u IN SELECT * FROM users LOOP
                    -- Insert new company for user
                    INSERT INTO companies (
                        name, 
                        wbp_phone_number_id, 
                        wbp_business_account_id, 
                        agent_running, 
                        atendente_online, 
                        tokens, 
                        prospect_token, 
                        followup_active, 
                        followup_config
                    ) VALUES (
                        'Empresa de ' || u.email,
                        u.wbp_phone_number_id,
                        u.wbp_business_account_id,
                        u.agent_running,
                        u.atendente_online,
                        u.tokens,
                        u.prospect_token,
                        u.followup_active,
                        u.followup_config
                    ) RETURNING id INTO new_company_id;

                    -- Associate user with company and assign admin role
                    UPDATE users SET company_id = new_company_id, role = 'admin' WHERE id = u.id;
                    
                    -- Update configs to point to company_id instead of user_id
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'configs') THEN
                        -- Add company_id column if not exists to configs
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'configs' AND column_name = 'company_id') THEN
                            ALTER TABLE configs ADD COLUMN company_id INTEGER REFERENCES companies(id);
                        END IF;
                        
                        UPDATE configs SET company_id = new_company_id WHERE user_id = u.id;
                    END IF;

                    -- Update atendimentos to point to company_id instead of user_id
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'atendimentos') THEN
                        -- Add company_id column if not exists to atendimentos
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'atendimentos' AND column_name = 'company_id') THEN
                            ALTER TABLE atendimentos ADD COLUMN company_id INTEGER REFERENCES companies(id);
                        END IF;
                        
                        -- Disable triggers on atendimentos to prevent updating updated_at
                        ALTER TABLE atendimentos DISABLE TRIGGER USER;
                        
                        UPDATE atendimentos SET company_id = new_company_id WHERE user_id = u.id;
                        
                        -- Re-enable triggers on atendimentos
                        ALTER TABLE atendimentos ENABLE TRIGGER USER;
                    END IF;

                    -- Copy default persona to company
                    IF u.default_persona_id IS NOT NULL THEN
                        UPDATE companies SET default_persona_id = u.default_persona_id WHERE id = new_company_id;
                    END IF;
                END LOOP;

                -- Drop old columns from users table (with CASCADE to drop dependent constraints)
                ALTER TABLE users DROP COLUMN IF EXISTS wbp_phone_number_id CASCADE;
                ALTER TABLE users DROP COLUMN IF EXISTS wbp_business_account_id CASCADE;
                ALTER TABLE users DROP COLUMN IF EXISTS agent_running CASCADE;
                ALTER TABLE users DROP COLUMN IF EXISTS atendente_online CASCADE;
                ALTER TABLE users DROP COLUMN IF EXISTS tokens CASCADE;
                ALTER TABLE users DROP COLUMN IF EXISTS default_persona_id CASCADE;
                ALTER TABLE users DROP COLUMN IF EXISTS prospect_token CASCADE;
                ALTER TABLE users DROP COLUMN IF EXISTS followup_active CASCADE;
                ALTER TABLE users DROP COLUMN IF EXISTS followup_config CASCADE;
            ELSE
                -- If no old columns, just create a default company for any existing users
                FOR u IN SELECT * FROM users LOOP
                    INSERT INTO companies (name) VALUES ('Empresa de ' || u.email) RETURNING id INTO new_company_id;
                    UPDATE users SET company_id = new_company_id, role = 'admin' WHERE id = u.id;
                END LOOP;
            END IF;

            -- Drop user_id columns from configs and atendimentos
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'configs' AND column_name = 'user_id') THEN
                ALTER TABLE configs DROP COLUMN user_id CASCADE;
            END IF;
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'atendimentos' AND column_name = 'user_id') THEN
                ALTER TABLE atendimentos DROP COLUMN user_id CASCADE;
            END IF;
        END IF;

        -- Independent migration of followup columns if they still exist on users table
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'followup_active'
        ) INTO has_followup_cols;

        IF has_followup_cols THEN
            UPDATE companies c
            SET followup_active = u.followup_active,
                followup_config = u.followup_config
            FROM users u
            WHERE u.company_id = c.id;

            ALTER TABLE users DROP COLUMN IF EXISTS followup_active CASCADE;
            ALTER TABLE users DROP COLUMN IF EXISTS followup_config CASCADE;
        END IF;
    END IF;
END $$;
"""
                await conn.execute(text(migration_sql))
                logger.info("Migração multi-tenant executada com sucesso.")
            except Exception as ex:
                logger.exception("Erro ao executar migração multi-tenant.")

            # Executa a sincronização segura de schema de forma dinâmica e persistente
            await conn.run_sync(sync_schema)
            logger.info("Tabelas e colunas do banco de dados verificadas/sincronizadas com sucesso.")

            # --- LIMPEZA DE HIGIENIZAÇÃO DE CONFIGS (Remoção de aspas armazenadas em thinking_level e tts_voice) ---
            try:
                cleanup_sql = """
                    DO $$
                    BEGIN
                        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'configs') THEN
                            UPDATE configs 
                            SET thinking_level = TRIM(BOTH '''' FROM TRIM(BOTH '"' FROM thinking_level))
                            WHERE thinking_level LIKE '%''%' OR thinking_level LIKE '%"%';

                            UPDATE configs 
                            SET tts_voice = TRIM(BOTH '''' FROM TRIM(BOTH '"' FROM tts_voice))
                            WHERE tts_voice LIKE '%''%' OR tts_voice LIKE '%"%';
                        END IF;
                    END $$;
                """
                await conn.execute(text(cleanup_sql))
                logger.info("Higienização de 'thinking_level' e 'tts_voice' na tabela configs concluída.")
            except Exception as clean_err:
                logger.warning(f"Aviso ao higienizar colunas da tabela configs: {clean_err}")
        except Exception as e:
            logger.exception("ERRO CRÍTICO ao criar tabelas e colunas do banco de dados.") # Usa logger.exception para incluir traceback
            raise