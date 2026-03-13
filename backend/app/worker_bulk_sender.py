import asyncio
import logging
import sys
import json
import uuid
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.database import SessionLocal
from app.db import models
from app.services.whatsapp_service import get_whatsapp_service
from app.core.config import settings

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s', stream=sys.stdout)
logger = logging.getLogger(__name__)

async def process_bulk_queue():
    """
    Busca atendimentos com status 'Aguardando Envio' e dispara os templates.
    """
    whatsapp_service = get_whatsapp_service()
    
    async with SessionLocal() as db:
        # Busca 10 registros por vez para processar em lotes controlados
        stmt = (
            select(models.Atendimento)
            .where(models.Atendimento.status == "Aguardando Envio")
            .order_by(models.Atendimento.created_at.asc())
            .limit(10)
        )
        
        result = await db.execute(stmt)
        items = result.scalars().all()
        
        if not items:
            return

        logger.info(f"Worker-Bulk: Processando {len(items)} envios pendentes...")

        # Cache de templates por business_account_id para este lote
        templates_cache = {}

        for at in items:
            # Carrega o dono do atendimento para usar as credenciais WBP
            owner_res = await db.execute(select(models.User).where(models.User.id == at.user_id))
            user = owner_res.scalar_one_or_none()
            
            if not user or not at.bulk_template_name:
                at.status = "Erro no Disparo"
                logger.error(f"Worker-Bulk: Atendimento {at.id} sem usuário ou template.")
                db.add(at)
                continue

            try:
                # Envio do Template via serviço oficial
                params = at.bulk_template_params or {}
                components = params.get("components")
                send_result = await whatsapp_service.send_template_message(
                    user=user,
                    number=at.whatsapp,
                    template_name=at.bulk_template_name,
                    language_code="pt_BR", # Pode ser parametrizado se necessário
                    components=components
                )
                
                # --- LOG CONVERSA: Salva a mensagem no histórico ---
                content_for_history = f"[Template: {at.bulk_template_name}]"
                try:
                    # Busca a definição do template para montar o texto real (reutiliza cache se disponível)
                    if user.wbp_business_account_id not in templates_cache:
                        templates_cache[user.wbp_business_account_id] = await whatsapp_service.get_templates_official(
                            business_account_id=user.wbp_business_account_id,
                            access_token=settings.WBP_ACCESS_TOKEN
                        )
                    
                    templates = templates_cache[user.wbp_business_account_id]
                    target_template = next((t for t in templates if t['name'] == at.bulk_template_name), None)

                    if target_template:
                        header_text = next((c.get('text', '') for c in target_template.get('components', []) if c['type'] == 'HEADER'), '')
                        body_text = next((c.get('text', '') for c in target_template.get('components', []) if c['type'] == 'BODY'), '')

                        sent_components = components or []
                        header_params = next((c.get('parameters', []) for c in sent_components if c['type'] == 'header'), [])
                        body_params = next((c.get('parameters', []) for c in sent_components if c['type'] == 'body'), [])

                        for i, param in enumerate(header_params):
                            header_text = header_text.replace(f"{{{{{i+1}}}}}", param.get('text', ''))
                        
                        for i, param in enumerate(body_params):
                            body_text = body_text.replace(f"{{{{{i+1}}}}}", param.get('text', ''))
                            body_text = body_text.replace(f"{{{{{len(header_params) + i + 1}}}}}", param.get('text', ''))

                        full_message = f"{header_text}\n{body_text}".strip()
                        if full_message:
                            content_for_history = full_message
                except Exception as template_err:
                    logger.warning(f"Worker-Bulk: Falha ao reconstruir texto do template para Atendimento {at.id}: {template_err}")

                new_message = {
                    "id": send_result.get('id') or f"bulk-{uuid.uuid4()}",
                    "role": "assistant",
                    "content": content_for_history,
                    "timestamp": int(datetime.now(timezone.utc).timestamp()),
                    "type": "text"
                }
                
                conversa_list = json.loads(at.conversa or "[]")
                conversa_list.append(new_message)
                at.conversa = json.dumps(conversa_list, ensure_ascii=False)
                # --- FIM DO LOG CONVERSA ---

                # Após envio, muda o status para que a IA assuma quando o cliente responder
                at.status = "Aguardando Resposta"
                at.updated_at = datetime.now(timezone.utc)
                logger.info(f"Worker-Bulk: Template enviado para {at.whatsapp}")
                
                # Delay de segurança entre cada mensagem (3 a 6 segundos)
                # Fundamental para não ser marcado como SPAM pela Meta
                await asyncio.sleep(5)
                
            except Exception as e:
                logger.error(f"Worker-Bulk: Falha ao enviar para {at.whatsapp}: {e}")
                at.status = "Falha no Envio"
            
            db.add(at)
            await db.commit()

async def main():
    logger.info("--- INICIANDO WORKER DE DISPAROS (BULK SENDER) ---")
    while True:
        await process_bulk_queue()
        await asyncio.sleep(15) # Verifica a fila a cada 15 segundos

if __name__ == "__main__":
    asyncio.run(main())