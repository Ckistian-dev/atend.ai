import sys
import asyncio
from celery import Celery
from app.core.config import settings

# Cria a instância do Celery
celery_app = Celery(
    "atendai_worker",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=['app.tasks']  # Auto-descobre tarefas no módulo 'app.tasks'
)

# Configurações opcionais
celery_app.conf.update(
    task_track_started=True,
)

# No Windows, o pool 'prefork' (padrão) é problemático.
# O pool 'solo' é uma alternativa estável para desenvolvimento no Windows.
if sys.platform == 'win32': # pragma: no cover
    # Define a política de loop de eventos para Windows, crucial para
    # o funcionamento correto do asyncio em threads, como as do Celery.
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    celery_app.conf.update(worker_pool='solo')
