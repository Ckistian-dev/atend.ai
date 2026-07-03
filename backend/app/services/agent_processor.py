import asyncio
import json
import logging
import random
import uuid
import re
from typing import Dict, List, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload
from sqlalchemy.future import select
from datetime import datetime, timezone, timedelta

from app.db.database import SessionLocal
from app.crud import crud_atendimento, crud_config, crud_user
from app.services.whatsapp_service import get_whatsapp_service, MessageSendError
from app.services.gemini_service import get_gemini_service
from app.services.google_calendar_service import get_google_calendar_service
from app.services.google_drive_service import get_drive_service # <--- Import do serviço de Drive
from app.api.configs import SITUATIONS
from app.db import models, schemas

logger = logging.getLogger(__name__)

async def process_single_atendimento(atendimento_id: int, company: models.Company):
    """
    Processa um único atendimento de ponta a ponta.
    Esta função é o coração do agente, orquestrando a leitura do estado atual,
    a geração de resposta pela IA, o envio de mensagens/arquivos e a atualização final do banco de dados.
    É projetada para ser executada de forma assíncrona para cada atendimento.
    """
    # Log inicial para rastrear qual usuário está processando qual atendimento.
    logger.info(f"Agente (Company {company.id}): Processando atendimento ID {atendimento_id}...")
    
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
                    if company.default_persona_id:
                        persona_config = await crud_config.get_config(db_read_context, company.default_persona_id, company.id)
                
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

        # --- ETAPA 3: GERAÇÃO DA RESPOSTA PELA IA (COM RETRIES DE ID VALIDO) ---
        # Pré-carrega os IDs do Drive válidos para esta persona para validar a resposta da IA.
        valid_drive_file_ids = set()
        downloaded_files = {}
        try:
            async with SessionLocal() as db_validate:
                stmt = select(models.KnowledgeVector.content).where(
                    models.KnowledgeVector.config_id == persona_config.id,
                    models.KnowledgeVector.origin == "drive"
                )
                res = await db_validate.execute(stmt)
                drive_records = res.scalars().all()
                for content in drive_records:
                    # Filtra linhas vazias, de título (#) ou de separador (---)
                    data_lines = [
                        l.strip() 
                        for l in content.strip().split("\n") 
                        if l.strip() and not l.strip().startswith("#") and "---" not in l
                    ]
                    if len(data_lines) >= 2:
                        try:
                            headers = [h.strip() for h in data_lines[0].split("|") if h.strip()]
                            if "ID" in headers:
                                idx = headers.index("ID")
                                for row_line in data_lines[1:]:
                                    values = [v.strip() for v in row_line.split("|") if v.strip()]
                                    if idx < len(values):
                                        valid_drive_file_ids.add(values[idx])
                        except Exception:
                            pass
        except Exception as e:
            logger.error(f"Agente: Erro ao pre-carregar IDs válidos do Drive: {e}")

        ia_response = None
        max_ia_attempts = 3
        
        try:
            for ia_attempt in range(max_ia_attempts):
                logger.info(f"Agente: Atendimento {atendimento_id} apto para IA. Chamando Gemini (Tentativa {ia_attempt + 1}/{max_ia_attempts})...")
                async with SessionLocal() as db_gemini_deduct:
                    company_for_gemini = await db_gemini_deduct.get(models.Company, company.id)
                    
                    ia_response = await gemini_service.generate_conversation_action(
                        whatsapp=atendimento_context,
                        conversation_history_db=conversation_history,
                        persona=persona_config,
                        db=db_gemini_deduct, 
                        company=company_for_gemini
                    )
                if not ia_response:
                    raise ValueError("IA retornou vazio.")

                # Validação imediata da resposta gerada
                arquivos_anexos = ia_response.get("arquivos_anexos")
                invalid_found = False
                downloaded_files.clear()
                
                if arquivos_anexos and isinstance(arquivos_anexos, list):
                    for arquivo_anexo in arquivos_anexos:
                        if not isinstance(arquivo_anexo, dict):
                            continue
                        file_id = arquivo_anexo.get("id_arquivo")
                        
                        # Verifica se é placeholder ou inválido (não cadastrado no RAG da persona)
                        is_placeholder = not file_id or "ID_DO_" in str(file_id).upper() or "ID_AQUI" in str(file_id).upper()
                        is_not_synced = valid_drive_file_ids and file_id not in valid_drive_file_ids
                        
                        if is_placeholder or is_not_synced:
                            logger.warning(
                                f"Agente: Tentativa {ia_attempt + 1} de resposta da IA continha ID de arquivo inválido/não sincronizado ({file_id})."
                            )
                            invalid_found = True
                            break
                        
                        # Pré-validação de download do arquivo físico para garantir existência
                        try:
                            logger.info(f"Agente: Pré-verificando existência e download do arquivo {file_id} no Drive...")
                            file_bytes = drive_service.download_file_bytes(file_id)
                            if not file_bytes:
                                logger.warning(f"Agente: Arquivo ID {file_id} está no banco mas falhou ao baixar do Google Drive (pode ter sido excluído).")
                                invalid_found = True
                                break
                            else:
                                downloaded_files[file_id] = file_bytes
                        except Exception as dl_err:
                            logger.warning(f"Agente: Falha ao baixar arquivo ID {file_id} durante validação: {dl_err}")
                            invalid_found = True
                            break
                
                if not invalid_found:
                    # ID válido e arquivo acessível, aceita a resposta
                    logger.info(f"Agente: Resposta da IA validada com sucesso na tentativa {ia_attempt + 1}.")
                    break
                else:
                    if ia_attempt < max_ia_attempts - 1:
                        # Pequeno delay antes de tentar novamente
                        await asyncio.sleep(1)
                    else:
                        # Última tentativa: filtra e remove apenas os anexos inválidos da resposta para não quebrar a mensagem
                        logger.warning("Agente: Limite de tentativas atingido. Removendo anexos inválidos da resposta final para evitar falhas no envio.")
                        if "arquivos_anexos" in ia_response and isinstance(arquivos_anexos, list):
                            ia_response["arquivos_anexos"] = [
                                a for a in arquivos_anexos 
                                if isinstance(a, dict) and a.get("id_arquivo") and (not valid_drive_file_ids or a.get("id_arquivo") in valid_drive_file_ids)
                            ]

        # Se a IA falhar permanentemente, o status é atualizado para "Erro IA" com detalhes do erro.
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
        mensagens_ia = ia_response.get("mensagens")
        message_to_send_fallback = ia_response.get("mensagem_para_enviar")
        
        intended_status_after_send = ia_response.get("nova_situacao", "Aguardando Resposta")
        intended_resumo = ia_response.get("resumo", "")
        contact_name_from_ia = ia_response.get("nome_contato")
        email_cliente = ia_response.get("email_cliente")
        tags_sugeridas = ia_response.get("tags_sugeridas")
        acao_agenda = ia_response.get("acao_agenda")
        data_agendamento = ia_response.get("data_agendamento")
        
        # Extração dos dados do anexo, se a IA solicitou um.
        arquivos_anexos = ia_response.get("arquivos_anexos")
        fonte_confiavel = ia_response.get("fonte_confiavel", True)
        
        sent_messages_info = []
        media_sent = False

        # --- VALIDACAO DE INTEGRIDADE (Hallucination Prevention) ---
        if not fonte_confiavel:
            logger.warning(f"Agente: IA sinalizou baixa confiança (fonte_confiavel=False) para Atendimento {atendimento_id}. Procedendo com cautela.")
            # Opcional: Poderia forçar 'Atendente Chamado' aqui se a confiança for crucial
            # intended_status_after_send = "Atendente Chamado"

        # Prepara a lista de partes a enviar
        message_parts = []
        if mensagens_ia and isinstance(mensagens_ia, list):
            message_parts = [str(m).strip() for m in mensagens_ia if m and str(m).strip()]
        elif message_to_send_fallback and isinstance(message_to_send_fallback, str):
            # Fallback para o formato antigo de string única
            cleaned = message_to_send_fallback.strip().replace('\\n', '\n').replace('\\', '')
            message_parts = [p.strip() for p in cleaned.split('\n\n') if p.strip()]

        # --- LÓGICA DE ENVIO DE MENSAGEM DE TEXTO ---
        if message_parts:

            for i, part in enumerate(message_parts):
                try:
                    # --- SAFEGUARD: Validar links/IDs alucinados no corpo do texto ---
                    # Se o texto contiver padrões de ID do Drive que não estão na lista de anexos, removemos ou alertamos
                    if "ID_DO_" in part.upper() or "ID_AQUI" in part.upper():
                        logger.warning(f"Agente: Texto contém placeholder de ID detectado. Limpando parte da mensagem.")
                        part = re.sub(r"\[?ID_DO_[^\]\s]+\]?", "", part, flags=re.IGNORECASE).strip()

                    # 2. Simulação de Digitação Variável (Humanização)
                    # Velocidade varia entre 0.10 e 0.20 segundos por caractere
                    chars_per_sec = random.uniform(0.10, 0.20)
                    typing_delay = min(max(len(part) * chars_per_sec, 2.5), 15.0)
                    
                    logger.info(f"Agente: Simulando digitação ({chars_per_sec:.3f}s/char) por {typing_delay:.1f}s para parte {i+1}/{len(message_parts)}...")
                    await asyncio.sleep(typing_delay)

                    logger.info(f"Agente: Enviando texto {i+1}/{len(message_parts)}...")
                    sent_info = await whatsapp_service.send_text_message(company, atendimento_contato_num_log, part)
                    
                    sent_messages_info.append({
                        "id": sent_info.get('id') or f"text_{uuid.uuid4()}",
                        "content": part,
                        "timestamp": int(datetime.now(timezone.utc).timestamp()),
                        "status": "sent"
                    })

                    if i < len(message_parts) - 1: 
                        await asyncio.sleep(random.uniform(2.5, 5.0))
                except Exception as send_err:
                    logger.error(f"Agente: Erro envio texto: {send_err}")
                    intended_status_after_send = "Falha no Envio"
                    break
        
        # Se a IA decidiu não enviar nada (nem mídia, nem texto), apenas registra essa decisão.
        elif not arquivos_anexos and not message_parts:
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

                # --- SAFEGUARD: Ignorar IDs placeholders alucinados pela IA ---
                if not file_id or "ID_DO_" in str(file_id).upper() or "ID_AQUI" in str(file_id).upper():
                    logger.warning(f"Agente: ID de arquivo inválido/placeholder detectado ({file_id}). Ignorando envio para evitar erro 404.")
                    continue

                # --- SAFEGUARD EXTRA: Validar se o ID realmente pertence aos arquivos sincronizados desta Persona ---
                if valid_drive_file_ids and file_id not in valid_drive_file_ids:
                    logger.warning(f"Agente: Bloqueado envio do arquivo '{nome_arquivo}' (ID: {file_id}) porque o ID não consta nos arquivos sincronizados desta persona.")
                    continue
                
                logger.info(f"Agente: IA solicitou envio de arquivo {i+1}/{len(arquivos_anexos)}: {nome_arquivo} (ID: {file_id})")
                
                # Pega os bytes do cache (já baixados e verificados na validação prévia em Etapa 3)
                file_bytes = downloaded_files.get(file_id)
                
                # Se por acaso não estiver no cache (ex: fallback), faz o download
                if not file_bytes:
                    max_retries = 3
                    for attempt in range(max_retries):
                        try:
                            logger.info(f"Agente: Cache de download vazio para ID {file_id}. Tentando baixar do Drive (Tentativa: {attempt + 1}/{max_retries})...")
                            file_bytes = drive_service.download_file_bytes(file_id)
                            if file_bytes:
                                break
                        except Exception as media_err:
                            logger.warning(f"Agente: Falha na tentativa {attempt + 1} de download: {media_err}")
                            if attempt < max_retries - 1:
                                await asyncio.sleep(3)
                            else:
                                break

                if file_bytes:
                    try:
                        logger.info(f"Agente: Enviando mídia {nome_arquivo} via WhatsApp...")
                        sent_info = await whatsapp_service.send_media_message(
                            company=company,
                            number=atendimento_contato_num_log,
                            media_type=tipo_midia,
                            file_bytes=file_bytes,
                            filename=nome_arquivo,
                            caption=None 
                        )
                        
                        sent_messages_info.append({
                            "id": sent_info.get('id') or f"media_{uuid.uuid4()}",
                            "content": f"[Arquivo Enviado: {nome_arquivo}]",
                            "timestamp": int(datetime.now(timezone.utc).timestamp()),
                            "type": tipo_midia,
                            "media_id": sent_info.get("media_id"),
                            "filename": nome_arquivo,
                            "status": "sent"
                        })
                        media_sent = True
                        await asyncio.sleep(random.uniform(2, 4))
                    except Exception as send_media_err:
                        logger.error(f"Agente: Erro ao enviar mídia pelo WhatsApp: {send_media_err}")
                        intended_status_after_send = "Erro Drive"
                        intended_resumo += f" | Falha ao enviar o arquivo {nome_arquivo} (ID: {file_id}) via WhatsApp."
                else:
                    logger.error(f"Agente: Falha permanente ao baixar o arquivo {nome_arquivo} (ID: {file_id}).")
                    intended_status_after_send = "Erro Drive"
                    intended_resumo += f" | Falha permanente no download do arquivo {nome_arquivo} (ID: {file_id})."

        # --- LÓGICA DE AGENDAMENTO NO GOOGLE CALENDAR ---
        meeting_link = None
        if acao_agenda == "agendar_reuniao" and data_agendamento:
            try:
                if persona_config and persona_config.google_calendar_credentials:
                    calendar_service = get_google_calendar_service(persona_config)
                    service = calendar_service.get_service()
                    
                    # --- Cancelar agendamentos anteriores deste contato ---
                    try:
                        now_iso = datetime.now(timezone.utc).isoformat()
                        # Busca eventos futuros que contenham o número do WhatsApp na descrição ou título
                        existing_events = service.events().list(
                            calendarId='primary',
                            timeMin=now_iso,
                            q=atendimento_context.whatsapp,
                            singleEvents=True,
                            orderBy='startTime'
                        ).execute().get('items', [])

                        for old_event in existing_events:
                            if old_event.get('description') and f"WhatsApp: {atendimento_context.whatsapp}" in old_event.get('description'):
                                logger.info(f"Agente: Cancelando evento anterior {old_event.get('id')} para reagendamento.")
                                service.events().delete(calendarId='primary', eventId=old_event.get('id'), sendUpdates='all').execute()
                    except Exception as cancel_err:
                        logger.warning(f"Agente: Erro ao cancelar agendamentos anteriores: {cancel_err}")

                    dt_start = datetime.fromisoformat(data_agendamento)
                    dt_end = dt_start + timedelta(hours=1) # Duração padrão de 1h
                    
                    event_body = {
                        'summary': f'Reunião: {atendimento_context.nome_contato or atendimento_context.whatsapp}',
                        'description': f'Agendado automaticamente pela IA AtendAI.\nWhatsApp: {atendimento_context.whatsapp}\nObservações: {atendimento_context.resumo or "Nenhuma"}',
                        'start': {'dateTime': dt_start.isoformat(), 'timeZone': 'America/Sao_Paulo'},
                        'end': {'dateTime': dt_end.isoformat(), 'timeZone': 'America/Sao_Paulo'},
                        'conferenceData': {
                            'createRequest': {
                                'requestId': f"{uuid.uuid4()}",
                                # 'conferenceSolutionKey': {'type': 'hangoutMeet'} # Removido para usar o padrão (Meet) e evitar erro 400
                            }
                        }
                    }
                    
                    # Validação de e-mail antes de adicionar
                    if email_cliente and isinstance(email_cliente, str):
                        clean_email = email_cliente.strip()
                        if re.match(r"[^@]+@[^@]+\.[^@]+", clean_email):
                            event_body['attendees'] = [{'email': clean_email}]
                        else:
                            logger.warning(f"Agente: Email do cliente inválido para convite: '{email_cliente}'. Agendando sem convite.")

                    try:
                        event = service.events().insert(calendarId='primary', body=event_body, conferenceDataVersion=1, sendUpdates='all').execute()
                        meeting_link = event.get('hangoutLink')
                        logger.info(f"Agente: Reunião agendada com sucesso! Link: {meeting_link}")
                        intended_resumo += f" | Reunião agendada para {data_agendamento}."
                    except Exception as req_err:
                        logger.error(f"Agente: Erro na requisição do Calendar com ConferenceData. Tentando sem conferência. Erro: {req_err}")
                        # Fallback: Tenta criar sem conferência se falhar (evita perder o agendamento)
                        if 'conferenceData' in event_body:
                            del event_body['conferenceData']
                        try:
                            event = service.events().insert(calendarId='primary', body=event_body, sendUpdates='all').execute()
                            logger.info(f"Agente: Reunião agendada (sem link Meet) com sucesso!")
                            intended_resumo += f" | Reunião agendada para {data_agendamento} (Sem link Meet)."
                        except Exception as fallback_err:
                            logger.error(f"Agente: Falha total no agendamento. Erro: {fallback_err}")
                else:
                    logger.warning("Agente: IA solicitou agendamento mas Google Calendar não está configurado.")
            except Exception as cal_err:
                logger.error(f"Agente: Erro ao agendar no Google Calendar: {cal_err}")

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
                                    "filename": msg.get("filename"),
                                    "status": msg.get("status", "sent"),
                                    "is_ai": True
                                })
                            current_hist.sort(key=lambda x: x.get('timestamp') or 0) # Reordena para garantir a cronologia.
                        
                        # Atualiza o status apenas se ele ainda for "Gerando Resposta", para evitar sobrescrever uma mudança manual.
                        if at_final.status == "Gerando Resposta":
                             at_final.status = intended_status_after_send 

                        if at_final.status == "Atendente Chamado":
                            await crud_atendimento.distribute_atendimento(db_final, at_final)
                        
                        # Salva as observações da IA, o histórico de conversa atualizado e a data de atualização.
                        at_final.resumo = intended_resumo
                        at_final.conversa = json.dumps(current_hist, ensure_ascii=False)
                        
                        # Atualiza o nome do contato se a IA retornou um novo nome e o campo atual está vazio.
                        if contact_name_from_ia and not at_final.nome_contato:
                            at_final.nome_contato = contact_name_from_ia
                        
                        # Salva o link da reunião nas observações
                        if meeting_link:
                            current_obs = at_final.observacoes or ""
                            at_final.observacoes = f"{current_obs}\nLink Reunião: {meeting_link}".strip()

                        # Atualiza tags se houver sugestão da IA
                        if tags_sugeridas and isinstance(tags_sugeridas, list):
                            try:
                                # Busca tags disponíveis para obter as cores corretas
                                all_user_tags = await crud_atendimento.get_all_user_tags(db_final, company_id=company.id)
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
    """
    # Log de início do ciclo.
    logger.info("Agente (Ciclo Otimizado): Iniciando ciclo...")
    
    # Dicionário para garantir que cada atendimento seja processado apenas uma vez por ciclo, evitando duplicidade.
    atendimentos_para_processar: Dict[int, models.Atendimento] = {}
    all_processing_tasks = []

    async with SessionLocal() as db:
        try:
            # 1. Busca todos os atendimentos que estão aguardando uma resposta e suas respectivas empresas
            atendimentos_msg_recebida = await crud_atendimento.get_atendimentos_para_processar(db)
            
            if atendimentos_msg_recebida:
                logger.info(f"Agente (Ciclo): {len(atendimentos_msg_recebida)} atendimentos (Mensagem Recebida) encontrados.")
                for at in atendimentos_msg_recebida:
                    # Pula empresas sem tokens
                    if at.company and at.company.tokens is not None and at.company.tokens <= 0:
                        continue

                    # Adiciona o atendimento ao dicionário, garantindo que não haja duplicatas.
                    if at.id not in atendimentos_para_processar:
                        atendimentos_para_processar[at.id] = at

            # 2. Monta a lista de tarefas de processamento assíncrono.
            if atendimentos_para_processar:
                logger.info(f"Agente (Ciclo): Total de {len(atendimentos_para_processar)} atendimentos únicos para processar.")
                for at in atendimentos_para_processar.values():
                    if at.company:
                        # Para cada atendimento, cria uma tarefa para chamar `process_single_atendimento`.
                        all_processing_tasks.append(process_single_atendimento(at.id, at.company))
                    else:
                        logger.warning(f"Agente (Ciclo): Atendimento {at.id} sem empresa carregada.")
            
            # 3. Executa todas as tarefas de processamento em paralelo.
            if all_processing_tasks:
                logger.info(f"Agente (Ciclo): Executando {len(all_processing_tasks)} tarefas.")
                await asyncio.gather(*all_processing_tasks)
            else:
                logger.info("Agente (Ciclo): Nenhum atendimento para processar.")

        except Exception as cycle_err:
            logger.error(f"Agente (Ciclo): Erro CRÍTICO no loop principal: {cycle_err}", exc_info=True)