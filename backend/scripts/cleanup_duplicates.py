import asyncio
import logging
from sqlalchemy import text, select
from app.db.database import SessionLocal
from app.db import models

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def run_cleanup():
    async with SessionLocal() as db:
        logger.info("Iniciando limpeza de mensagens duplicadas...")

        # 1. Deletar mensagens duplicadas com message_id numérico inseridas pelo loop do init_db
        del_num_sql = text("""
            DELETE FROM mensagens
            WHERE message_id ~ '^[0-9]+$'
            AND EXISTS (
                SELECT 1 FROM mensagens m2
                WHERE m2.atendimento_id = mensagens.atendimento_id
                AND m2.id < mensagens.id
                AND m2.role = mensagens.role
                AND m2.content = mensagens.content
            );
        """)
        res1 = await db.execute(del_num_sql)
        logger.info(f"Mensagens duplicadas numéricas excluídas: {res1.rowcount}")

        # 2. Deletar duplicatas exatas restantes
        del_exact_sql = text("""
            DELETE FROM mensagens m1
            USING mensagens m2
            WHERE m1.id > m2.id
            AND m1.atendimento_id = m2.atendimento_id
            AND m1.role = m2.role
            AND m1.content = m2.content
            AND m1.type = m2.type
            AND ABS(EXTRACT(EPOCH FROM (m1.created_at - m2.created_at))) < 15;
        """)
        res2 = await db.execute(del_exact_sql)
        logger.info(f"Mensagens duplicadas exatas excluídas: {res2.rowcount}")

        # 3. Sincronizar campo json 'conversa' de todos os atendimentos para refletir apenas mensagens únicas
        atendimentos_res = await db.execute(select(models.Atendimento))
        atendimentos = atendimentos_res.scalars().all()
        for at in atendimentos:
            msgs_res = await db.execute(
                select(models.Message)
                .where(models.Message.atendimento_id == at.id)
                .order_by(models.Message.id.asc())
            )
            msgs = msgs_res.scalars().all()
            if msgs:
                unique_conversa = []
                for m in msgs:
                    unique_conversa.append({
                        "id": m.id,
                        "message_id": m.message_id,
                        "role": m.role,
                        "content": m.content,
                        "caption": m.caption,
                        "timestamp": m.timestamp.isoformat() if m.timestamp else None,
                        "status": m.status,
                        "type": m.type,
                        "filename": m.filename,
                        "media_id": m.media_id,
                        "mime_type": m.mime_type,
                        "is_ai": m.is_ai,
                        "is_template": m.is_template
                    })
                import json
                at.conversa = json.dumps(unique_conversa, ensure_ascii=False)
                db.add(at)

        await db.commit()
        logger.info("Limpeza e sincronização de atendimentos finalizadas com sucesso.")

if __name__ == "__main__":
    asyncio.run(run_cleanup())
