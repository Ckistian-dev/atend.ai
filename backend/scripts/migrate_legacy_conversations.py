#!/usr/bin/env python3
# scripts/migrate_legacy_conversations.py

"""
Script de migração de conversas legadas do AtendAI.
Transcreve todas as mensagens armazenadas no formato JSON no campo 'conversa'
da tabela 'atendimentos' para a tabela relacional 'mensagens'.

Uso:
    python scripts/migrate_legacy_conversations.py [--dry-run] [--company-id <id>]
    python -m scripts.migrate_legacy_conversations [--dry-run] [--company-id <id>]
"""

import sys
import os
import argparse
import asyncio
import logging
import time

# Adiciona o diretório raiz do backend ao sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from dotenv import load_dotenv
load_dotenv()

from app.db.database import SessionLocal
from app.services.conversa_migration import migrate_legacy_conversations_for_session

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("migrate_legacy_conversations")

async def run_cli():
    parser = argparse.ArgumentParser(description="Migração de conversas legadas (atendimentos.conversa -> mensagens)")
    parser.add_argument("--dry-run", action="store_true", help="Simula a migração sem realizar alterações no banco de dados.")
    parser.add_argument("--company-id", type=int, default=None, help="Filtra a migração apenas para uma empresa específica.")
    args = parser.parse_args()

    print("=" * 70)
    print("        MIGRAÇÃO DE CONVERSAS LEGADAS - ATENDAI        ")
    print("=" * 70)
    if args.dry_run:
        print("  [MODO DRY-RUN ATIVADO]: Nenhuma alteração será gravada no banco.")
    if args.company_id:
        print(f"  [FILTRO DE EMPRESA]: Processando apenas Empresa ID {args.company_id}")
    print("-" * 70)

    start_t = time.time()
    async with SessionLocal() as db:
        stats = await migrate_legacy_conversations_for_session(
            db=db,
            dry_run=args.dry_run,
            company_id=args.company_id
        )

    print("\n" + "=" * 70)
    print("                  RESUMO DA MIGRAÇÃO                  ")
    print("=" * 70)
    print(f"  Total de atendimentos analisados:     {stats['atendimentos_total']}")
    print(f"  Atendimentos com conversa legada:     {stats['atendimentos_com_conversa']}")
    print(f"  Mensagens migradas com sucesso:       {stats['mensagens_migradas']}")
    print(f"  Mensagens já existentes (puladas):    {stats['mensagens_ja_existentes']}")
    print(f"  Itens inválidos/ignorados:           {stats['mensagens_invalidas']}")
    print(f"  Erros encontrados:                    {stats['erros']}")
    print(f"  Tempo total decorrido:                {stats['elapsed_seconds']}s")
    print("=" * 70)

    if stats["mensagens_migradas"] > 0 and not args.dry_run:
        print(" -> Migração concluída e persistida com sucesso!")
    elif args.dry_run:
        print(" -> Simulação concluída. Execute sem --dry-run para aplicar.")
    else:
        print(" -> Nenhuma nova mensagem pendente de migração.")

if __name__ == "__main__":
    asyncio.run(run_cli())
