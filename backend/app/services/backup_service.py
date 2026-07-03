import subprocess
import os
import logging
import asyncio
from datetime import datetime, timedelta
import pytz
from app.services.google_drive_service import get_drive_service
from app.core.config import settings

logger = logging.getLogger(__name__)

# O ID da pasta do Google Drive fornecido pelo usuário
GOOGLE_DRIVE_FOLDER_ID = "1dwN1APH1MviWCyJnUFGkE2rdIIq6ujUU"

def perform_database_backup():
    """
    Executa o pg_dump do banco de dados e envia para a pasta configurada do Google Drive.
    """
    logger.info("Backup: Iniciando processo de backup do banco de dados...")
    
    # 1. Obter a URL do banco e adaptar para o pg_dump (remover driver asyncpg se houver)
    db_url = settings.DATABASE_URL
    if "postgresql+asyncpg://" in db_url:
        db_url = db_url.replace("postgresql+asyncpg://", "postgresql://", 1)
    
    # Nome do arquivo de backup com data/hora formatada no horário de São Paulo
    sp_tz = pytz.timezone("America/Sao_Paulo")
    now = datetime.now(sp_tz)
    filename = f"backup_atendai_{now.strftime('%Y%m%d_%H%M%S')}.dump"
    
    # Cria o caminho temporário no workspace ou /tmp
    temp_path = os.path.join("/tmp", filename) if os.path.exists("/tmp") else filename
    
    try:
        # Garante que o diretório temporário exista
        temp_dir = os.path.dirname(temp_path)
        if temp_dir and not os.path.exists(temp_dir):
            os.makedirs(temp_dir, exist_ok=True)
            
        logger.info(f"Backup: Executando pg_dump para {temp_path}...")
        
        # Executa o pg_dump
        # Usamos -F c (custom format) para compressão e compatibilidade com pg_restore
        result = subprocess.run(
            ["pg_dump", "--dbname=" + db_url, "-F", "c", "-f", temp_path],
            capture_output=True,
            text=True
        )
        
        if result.returncode != 0:
            logger.error(f"Backup: Erro no pg_dump: {result.stderr}")
            raise Exception(f"pg_dump falhou com código {result.returncode}: {result.stderr}")
            
        logger.info(f"Backup: pg_dump concluído com sucesso. Tamanho: {os.path.getsize(temp_path)} bytes.")
        
        # 2. Ler os bytes do arquivo gerado
        with open(temp_path, "rb") as f:
            backup_bytes = f.read()
            
        # 3. Fazer upload para o Google Drive
        drive_service = get_drive_service()
        
        logger.info(f"Backup: Enviando backup '{filename}' para a pasta do Google Drive (ID: {GOOGLE_DRIVE_FOLDER_ID})...")
        file_id = drive_service.upload_file(
            file_content_bytes=backup_bytes,
            file_name=filename,
            parent_folder_id=GOOGLE_DRIVE_FOLDER_ID,
            mime_type="application/octet-stream"
        )
        logger.info(f"Backup: Backup enviado com sucesso! Google Drive File ID: {file_id}")
        
        # 4. Excluir backups com mais de 30 dias da mesma pasta
        logger.info("Backup: Verificando backups antigos para limpeza...")
        deleted = drive_service.delete_old_backups(folder_id=GOOGLE_DRIVE_FOLDER_ID, days=30)
        if deleted:
            logger.info(f"Backup: {deleted} backup(s) com mais de 30 dias excluído(s) do Google Drive.")
        else:
            logger.info("Backup: Nenhum backup antigo encontrado para excluir.")
        
    except Exception as e:
        logger.error(f"Backup: Erro crítico durante o backup do banco de dados: {e}", exc_info=True)
    finally:
        # Remover o arquivo temporário
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
                logger.info(f"Backup: Arquivo temporário {temp_path} removido.")
            except Exception as clean_ex:
                logger.warning(f"Backup: Não foi possível remover o arquivo temporário {temp_path}: {clean_ex}")

async def backup_scheduler_loop():
    """
    Loop que calcula o tempo restante até as 3h da madrugada (horário de Brasília)
    e executa o backup diariamente.
    """
    logger.info("Backup: Iniciando loop do agendador de backup...")
    sp_tz = pytz.timezone("America/Sao_Paulo")
    
    while True:
        try:
            # 1. Obter a hora atual no fuso horário de SP
            now_local = datetime.now(sp_tz)
            
            # 2. Definir o próximo horário de execução para hoje às 3:00 AM
            target_time = now_local.replace(hour=3, minute=0, second=0, microsecond=0)
            
            # 3. Se já passou das 3:00 AM hoje, agenda para amanhã às 3:00 AM
            if now_local >= target_time:
                target_time += timedelta(days=1)
                
            # 4. Calcular os segundos de espera
            sleep_seconds = (target_time - now_local).total_seconds()
            logger.info(f"Backup: Próximo backup agendado para {target_time.strftime('%Y-%m-%d %H:%M:%S %Z')}. Aguardando {sleep_seconds:.1f} segundos...")
            
            # 5. Dormir até o horário de execução
            await asyncio.sleep(sleep_seconds)
            
            # 6. Executar o backup
            # Executamos a função síncrona de backup em um thread pool para evitar o bloqueio do loop principal do FastAPI
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, perform_database_backup)
            
        except asyncio.CancelledError:
            logger.info("Backup: Loop do agendador de backup cancelado.")
            break
        except Exception as e:
            logger.error(f"Backup: Erro no loop do agendador de backup: {e}", exc_info=True)
            # Em caso de erro inesperado, aguarda 1 minuto antes de tentar recalcular para evitar loop infinito rápido
            await asyncio.sleep(60)

backup_task = None

def start_backup_scheduler():
    """
    Inicia o agendador de backup como uma tarefa de segundo plano assíncrona.
    """
    global backup_task
    logger.info("Backup: Iniciando agendador de backup...")
    backup_task = asyncio.create_task(backup_scheduler_loop())
