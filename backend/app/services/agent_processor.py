import asyncio
import json
import logging
import random
import uuid
from typing import Dict, List, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload
from sqlalchemy.future import select
from datetime import datetime, timezone

from app.db.database import SessionLocal
from app.crud import crud_atendimento, crud_config, crud_user
from app.services.whatsapp_service import get_whatsapp_service, MessageSendError
from app.services.gemini_service import get_gemini_service
from app.services.google_drive_service import get_drive_service # <--- Import do serviço de Drive
from app.api.configs import SITUATIONS
from app.db import models, schemas

logger = logging.getLogger(__name__)

async def process_single_atendimento(atendimento_id: int, user: models.User):
    """
    Processa um único atendimento de ponta a ponta.
    Esta função é o coração do agente, orquestrando a leitura do estado atual,
    a geração de resposta pela IA, o envio de mensagens/arquivos e a atualização final do banco de dados.
    É projetada para ser executada de forma assíncrona para cada atendimento.
    """
    # Log inicial para rastrear qual usuário está processando qual atendimento.
    logger.info(f"Agente (User {user.id}): Processando atendimento ID {atendimento_id}...")
    
    # Inicializa os serviços necessários para o processamento.
    whatsapp_service = get_whatsapp_service()
    gemini_service = get_gemini_service()
    drive_service = get_drive_service()
    
    # Variável para logging, armazena o número de WhatsApp do contato.
    atendimento_contato_num_log = "N/A"

    try:
        # --- ETAPA 1: BLOQUEIO E ATUALIZAÇÃO DE STATUS ---
        # Esta etapa é crucial para evitar que o mesmo atendimento seja processado por múltiplos agentes ao mesmo tempo (condição de corrida).
        # O status é alterado para "Gerando Resposta" para sinalizar que este atendimento está em processamento ativo.
        marked_generating = False
        try:
            async with SessionLocal() as db_mark_generating:
                async with db_mark_generating.begin():
                    # Bloqueia a linha do atendimento no banco de dados para escrita.
                    atendimento_to_mark = await db_mark_generating.get(models.Atendimento, atendimento_id, with_for_update=True)
                    if atendimento_to_mark:
                         atendimento_contato_num_log = atendimento_to_mark.whatsapp
                    
                    # Verifica se o atendimento está em um estado que permite o processamento.
                    if atendimento_to_mark and atendimento_to_mark.status in ["Mensagem Recebida"]:
                        atendimento_to_mark.status = "Gerando Resposta"
                        atendimento_to_mark.updated_at = datetime.now(timezone.utc)
                        marked_generating = True
                    else:
                        logger.warning(f"Agente: Atendimento {atendimento_id} pulado (status '{atendimento_to_mark.status if atendimento_to_mark else 'N/A'}' não permite processamento).")
                        return 

        except Exception as lock_err:
            logger.error(f"Agente: Falha ao marcar status: {lock_err}")
            return
        
        if not marked_generating: return

        logger.info(f"Agente: Atendimento {atendimento_id} marcado como 'Gerando Resposta'.")

        # --- ETAPA 2: COLETA DE CONTEXTO PARA A IA ---
        # Reúne todas as informações necessárias para que a IA possa gerar uma resposta coerente.
        conversation_history = []
        persona_config = None

        try:
            # Abre uma nova sessão para ler os dados do atendimento.
            async with SessionLocal() as db_read_context:
                atendimento_context = await db_read_context.get(
                    models.Atendimento,
                    atendimento_id,
                    options=[joinedload(models.Atendimento.active_persona)]
                )
                if not atendimento_context: raise ValueError("Atendimento não encontrado.")
                atendimento_contato_num_log = atendimento_context.whatsapp

                # Carrega a persona ativa específica para este atendimento.
                persona_config = atendimento_context.active_persona
                # Se não houver persona específica, usa a persona padrão do usuário.
                if not persona_config:
                    if user.default_persona_id:
                        persona_config = await crud_config.get_config(db_read_context, user.default_persona_id, user.id)
                
                # Se nenhuma persona for encontrada, o processo não pode continuar.
                if not persona_config:
                    raise ValueError("Nenhuma persona encontrada.")
                
                # Carrega o histórico da conversa a partir do campo JSON no banco de dados.
                try:
                    conversation_history = json.loads(atendimento_context.conversa or "[]")
                    conversation_history.sort(key=lambda x: x.get('timestamp') or 0) # Garante a ordem cronológica.
                except:
                    conversation_history = []
        # Se ocorrer um erro ao coletar o contexto, o status do atendimento é revertido para "Erro Contexto".
        except Exception as context_err:
            logger.error(f"Agente: Erro contexto (ID {atendimento_id}): {context_err}")
            try:
                async with SessionLocal() as db_revert:
                    async with db_revert.begin():
                        at_revert = await db_revert.get(models.Atendimento, atendimento_id)
                        if at_revert and at_revert.status == "Gerando Resposta":
                            at_revert.status = "Erro Contexto"
                            at_revert.updated_at = datetime.now(timezone.utc)
            except Exception: pass
            return 

        # --- ETAPA 3: GERAÇÃO DA RESPOSTA PELA IA ---
        # Com todo o contexto preparado, a IA (Gemini) é chamada para decidir a próxima ação.
        ia_response = None
        try:
            logger.info(f"Agente: Atendimento {atendimento_id} apto para IA. Chamando Gemini...")
            async with SessionLocal() as db_gemini_deduct:
                user_for_gemini = await db_gemini_deduct.get(models.User, user.id)
                
                # A função da IA recebe o contexto do atendimento, o histórico da conversa, o contexto da persona (planilha) e a estrutura de arquivos do Drive.
                ia_response = await gemini_service.generate_conversation_action(
                    whatsapp=atendimento_context,
                    conversation_history_db=conversation_history,
                    persona=persona_config,
                    db=db_gemini_deduct, 
                    user=user_for_gemini
                )
            if not ia_response: raise ValueError("IA retornou vazio.")

        # Se a IA falhar, o status é atualizado para "Erro IA" com detalhes do erro.
        except Exception as ia_err:
            logger.error(f"Agente: Falha GERAÇÃO IA: {ia_err}", exc_info=True)
            try:
                async with SessionLocal() as db_ia_fail:
                    async with db_ia_fail.begin():
                        at_ia_fail = await db_ia_fail.get(models.Atendimento, atendimento_id)
                        if at_ia_fail:
                            at_ia_fail.status = "Erro IA"
                            at_ia_fail.resumo = f"IA Error: {str(ia_err)[:250]}"
                            at_ia_fail.updated_at = datetime.now(timezone.utc)
            except Exception: pass
            return

        # --- ETAPA 4: EXECUÇÃO DAS AÇÕES (ENVIO DE MENSAGEM/ARQUIVO) ---
        # A resposta da IA é processada e as ações correspondentes (enviar texto, enviar arquivo) são executadas.
        message_to_send = ia_response.get("mensagem_para_enviar")
        intended_status_after_send = ia_response.get("nova_situacao", "Aguardando Resposta")
        intended_resumo = ia_response.get("resumo", "")
        contact_name_from_ia = ia_response.get("nome_contato")
        tags_sugeridas = ia_response.get("tags_sugeridas")
        
        # Extração dos dados do anexo, se a IA solicitou um.
        arquivos_anexos = ia_response.get("arquivos_anexos") # <-- Alterado para o plural
        sent_messages_info = []
        media_sent = False

        # --- LÓGICA DE ENVIO DE MENSAGEM DE TEXTO ---
        if message_to_send and isinstance(message_to_send, str) and message_to_send.strip():
            # Limpa e divide a mensagem em parágrafos para enviá-las separadamente, melhorando a legibilidade no WhatsApp.
            message_to_send_cleaned = message_to_send.strip().replace('\\n', '\n').replace('\\', '')
            message_parts = [part.strip() for part in message_to_send_cleaned.split('\n\n') if part.strip()]

            for i, part in enumerate(message_parts):
                try:
                    logger.info(f"Agente: Enviando texto {i+1}/{len(message_parts)}...")
                    # Envia cada parte da mensagem.
                    sent_info = await whatsapp_service.send_text_message(user, atendimento_contato_num_log, part)
                    
                    # Registra a mensagem enviada no histórico.
                    sent_messages_info.append({
                        "id": sent_info.get('id') or f"text_{uuid.uuid4()}",
                        "content": part,
                        "timestamp": int(datetime.now(timezone.utc).timestamp())
                    })
                    if i < len(message_parts) - 1: await asyncio.sleep(random.uniform(2, 4))
                except Exception as send_err:
                    # Em caso de falha no envio, o status é atualizado para refletir o erro.
                    logger.error(f"Agente: Erro envio texto: {send_err}")
                    intended_status_after_send = "Falha no Envio"
                    break
        
        # Se a IA decidiu não enviar nada (nem mídia, nem texto), apenas registra essa decisão.
        elif not arquivos_anexos and not message_to_send:
             logger.info(f"Agente: IA decidiu não enviar nada.")
        # --- LÓGICA DE ENVIO DE MÍDIA (ARQUIVO DO GOOGLE DRIVE) ---
        # Agora iteramos sobre uma lista de arquivos
        if arquivos_anexos and isinstance(arquivos_anexos, list):
            for i, arquivo_anexo in enumerate(arquivos_anexos):
                if not (isinstance(arquivo_anexo, dict) and arquivo_anexo.get("id_arquivo")):
                    continue

                nome_arquivo = arquivo_anexo.get("nome_exato", "arquivo")
                file_id = arquivo_anexo.get("id_arquivo")
                tipo_midia = arquivo_anexo.get("tipo_midia", "document")
                
                logger.info(f"Agente: IA solicitou envio de arquivo {i+1}/{len(arquivos_anexos)}: {nome_arquivo} (ID: {file_id})")
                
                file_bytes = None
                max_retries = 3
                for attempt in range(max_retries):
                    try:
                        # 1. Tenta baixar os bytes do arquivo do Google Drive.
                        logger.info(f"Agente: Tentando download do Drive (ID: {file_id}, Tentativa: {attempt + 1}/{max_retries})")
                        file_bytes = drive_service.download_file_bytes(file_id)
                        
                        if file_bytes:
                            logger.info(f"Agente: Download do Drive bem-sucedido para ID {file_id}.")
                            # 2. Envia o arquivo pelo WhatsApp.
                            logger.info(f"Agente: Enviando mídia {nome_arquivo} via WhatsApp...")
                            sent_info = await whatsapp_service.send_media_message(
                                user=user,
                                number=atendimento_contato_num_log,
                                media_type=tipo_midia,
                                file_bytes=file_bytes,
                                filename=nome_arquivo,
                                caption=None 
                            )
                            
                            # 3. Registra a informação da mensagem enviada para o histórico.
                            sent_messages_info.append({
                                "id": sent_info.get('id') or f"media_{uuid.uuid4()}",
                                "content": f"[Arquivo Enviado: {nome_arquivo}]",
                                "timestamp": int(datetime.now(timezone.utc).timestamp()),
                                "type": tipo_midia,
                                "media_id": sent_info.get("media_id"),
                                "filename": nome_arquivo
                            })
                            media_sent = True
                            await asyncio.sleep(random.uniform(2, 4)) # Pausa entre envios.
                            break # Sai do loop de tentativas pois o envio foi bem-sucedido.
                        
                        # Se file_bytes for None, o erro será capturado abaixo.
                        raise ValueError("Download do Drive retornou vazio.")

                    except Exception as media_err:
                        logger.warning(f"Agente: Falha na tentativa {attempt + 1} de baixar/enviar {file_id}: {media_err}")
                        if attempt < max_retries - 1:
                            await asyncio.sleep(3) # Espera 3 segundos antes de tentar novamente.
                        else:
                            logger.error(f"Agente: Falha permanente no download do Drive para ID {file_id} após {max_retries} tentativas.")
                            intended_status_after_send = "Erro Drive"
                            intended_resumo += f" | Falha permanente no download do arquivo {nome_arquivo} (ID: {file_id})."

        # --- ETAPA 5: ATUALIZAÇÃO FINAL DO ATENDIMENTO ---
        # Consolida todas as mudanças no banco de dados.
        try:
            async with SessionLocal() as db_final:
                async with db_final.begin():
                    # Bloqueia novamente a linha para garantir a consistência dos dados.
                    at_final = await db_final.get(models.Atendimento, atendimento_id, with_for_update=True)
                    if at_final:
                        current_hist = []
                        try:
                            # Carrega o histórico de conversa atual.
                            current_hist = json.loads(at_final.conversa or "[]")
                        except: pass
                        
                        # Adiciona as novas mensagens (enviadas pelo agente) ao histórico.
                        if sent_messages_info:
                            for msg in sent_messages_info:
                                current_hist.append({
                                    "id": msg['id'], "role": "assistant", 
                                    "content": msg['content'], "timestamp": msg['timestamp'],
                                    # Adiciona os campos de mídia se existirem
                                    "type": msg.get("type", "text"),
                                    "media_id": msg.get("media_id"),
                                    "filename": msg.get("filename")
                                })
                            current_hist.sort(key=lambda x: x.get('timestamp') or 0) # Reordena para garantir a cronologia.
                        
                        # Atualiza o status apenas se ele ainda for "Gerando Resposta", para evitar sobrescrever uma mudança manual.
                        if at_final.status == "Gerando Resposta":
                             at_final.status = intended_status_after_send 
                        
                        # Salva as observações da IA, o histórico de conversa atualizado e a data de atualização.
                        at_final.resumo = intended_resumo
                        at_final.conversa = json.dumps(current_hist, ensure_ascii=False)
                        
                        # Atualiza o nome do contato se a IA retornou um novo nome e o campo atual está vazio.
                        if contact_name_from_ia and not at_final.nome_contato:
                            at_final.nome_contato = contact_name_from_ia

                        # Atualiza tags se houver sugestão da IA
                        if tags_sugeridas and isinstance(tags_sugeridas, list):
                            try:
                                # Busca tags disponíveis para obter as cores corretas
                                all_user_tags = await crud_atendimento.get_all_user_tags(db_final, user.id)
                                tag_map = {t['name']: t for t in all_user_tags}
                                
                                current_tags = list(at_final.tags) if at_final.tags else []
                                current_tag_names = {t['name'] for t in current_tags}
                                
                                for tag_name in tags_sugeridas:
                                    # Só adiciona se a tag existir no mapa e ainda não estiver no atendimento
                                    if tag_name in tag_map and tag_name not in current_tag_names:
                                        current_tags.append(tag_map[tag_name])
                                
                                at_final.tags = current_tags
                            except Exception as e:
                                logger.error(f"Agente: Erro ao atualizar tags sugeridas pela IA: {e}")

                        at_final.updated_at = datetime.now(timezone.utc)
            
            logger.info(f"Agente: Atendimento {atendimento_id} finalizado com sucesso.")

        except Exception as final_err:
            logger.error(f"Agente: Erro update final: {final_err}")

    # Bloco de captura para erros inesperados e graves durante todo o processo.
    except Exception as outer_err:
        logger.error(f"Agente: ERRO CRÍTICO GERAL: {outer_err}", exc_info=True)
        # Tenta reverter o status para "Erro IA" para que o atendimento possa ser analisado manualmente.
        try:
            async with SessionLocal() as db_fail:
                async with db_fail.begin():
                    at_fail = await db_fail.get(models.Atendimento, atendimento_id)
                    if at_fail and at_fail.status == "Gerando Resposta":
                        at_fail.status = "Erro IA"
                        at_fail.resumo = f"Outer Error: {str(outer_err)[:100]}"
        except: pass


async def run_agent_cycle():
    """
    Executa um ciclo completo de verificação e processamento do agente.
    Esta função é o ponto de entrada principal para o loop do agente, que é executado periodicamente.
    Ela busca por usuários ativos e, para cada um, encontra atendimentos que precisam de uma resposta.
    """
    # Log de início do ciclo.
    logger.info("Agente (Ciclo Otimizado): Iniciando ciclo...")
    
    # Dicionário para garantir que cada atendimento seja processado apenas uma vez por ciclo, evitando duplicidade.
    atendimentos_para_processar: Dict[int, models.Atendimento] = {}
    all_processing_tasks = []

    async with SessionLocal() as db:
        try:
            # 1. Busca todos os usuários que estão com o agente ativado.
            active_users = await crud_user.get_users_with_agent_running(db) 
            
            if active_users:
                logger.info(f"Agente (Ciclo): Verificando atendimentos para {len(active_users)} usuários ativos...")
                
                for user in active_users:
                    # Pula usuários que não têm mais tokens de IA.
                    if user.tokens is not None and user.tokens <= 0:
                        continue

                    # 2. Busca todos os atendimentos que estão aguardando uma resposta ("Mensagem Recebida").
                    # Esta busca é otimizada para ser feita em massa.
                    atendimentos_msg_recebida = await crud_atendimento.get_atendimentos_para_processar(db)
                    
                    if atendimentos_msg_recebida:
                        logger.info(f"Agente (Ciclo): {len(atendimentos_msg_recebida)} atendimentos (Mensagem Recebida) encontrados.")
                        for at in atendimentos_msg_recebida:
                            # Adiciona o atendimento ao dicionário, garantindo que não haja duplicatas.
                            if at.id not in atendimentos_para_processar:
                                atendimentos_para_processar[at.id] = at

            # 3. Monta a lista de tarefas de processamento assíncrono.
            if atendimentos_para_processar:
                logger.info(f"Agente (Ciclo): Total de {len(atendimentos_para_processar)} atendimentos únicos para processar.")
                for at in atendimentos_para_processar.values():
                    if at.owner:
                        # Para cada atendimento, cria uma tarefa para chamar `process_single_atendimento`.
                        all_processing_tasks.append(process_single_atendimento(at.id, at.owner))
                    else:
                        logger.warning(f"Agente (Ciclo): Atendimento {at.id} sem usuário carregado.")
            
            # 4. Executa todas as tarefas de processamento em paralelo.
            if all_processing_tasks:
                logger.info(f"Agente (Ciclo): Executando {len(all_processing_tasks)} tarefas.")
                await asyncio.gather(*all_processing_tasks)
            else:
                logger.info("Agente (Ciclo): Nenhum atendimento para processar.")

        except Exception as cycle_err:
            logger.error(f"Agente (Ciclo): Erro CRÍTICO no loop principal: {cycle_err}", exc_info=True)