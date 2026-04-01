# Importações de bibliotecas padrão e de terceiros
import logging
import json
import uuid
from fastapi import APIRouter, Depends, HTTPException, Body, Response, Query
from fastapi.responses import StreamingResponse
import csv
import io
import copy
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
import mimetypes
from fastapi import (
    APIRouter, Depends, HTTPException, Body, 
    UploadFile, File, Form
)
from starlette.responses import RedirectResponse
import httpx # Para fazer requisições HTTP assíncronas

# Importações do SQLAlchemy para manipulação do banco de dados
from sqlalchemy import select, func, cast, Time, text
from sqlalchemy.orm import joinedload
from sqlalchemy.dialects.postgresql import JSONB

# Importações de módulos locais da aplicação
from app.api import dependencies
from app.core.config import settings
from app.db.database import get_db
from app.db import models, schemas
from app.crud import crud_atendimento, crud_user
from app.services.whatsapp_service import WhatsAppService, get_whatsapp_service, MessageSendError, format_whatsapp_number
from app.services.security import decrypt_token
from app.services.gemini_service import GeminiService, get_gemini_service
from app.services.google_sheets_service import GoogleSheetsService

# Configuração do logger para este módulo
logger = logging.getLogger(__name__)
# Criação do roteador da API para os endpoints de atendimentos
router = APIRouter()

# Endpoint para exportar atendimentos (Streaming)
@router.get("/export", summary="Exportar atendimentos para CSV")
async def export_atendimentos(
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user),
    search: Optional[str] = Query(None, description="Termo de busca"),
    status: Optional[List[str]] = Query(None, description="Filtro de status"),
    tags: Optional[List[str]] = Query(None, description="Filtro de tags"),
    time_start: Optional[str] = Query(None, description="Início do período"),
    time_end: Optional[str] = Query(None, description="Fim do período")
):
    """
    Gera um CSV com todos os atendimentos filtrados, usando streaming para suportar grandes volumes de dados.
    """
    # --- 1. Reconstrução da Query de Filtro (Mesma lógica do get_atendimentos) ---
    stmt_base = select(models.Atendimento).where(models.Atendimento.user_id == current_user.id)

    last_client_ts = func.get_last_user_msg_timestamp(models.Atendimento.conversa)
    sort_expression = func.coalesce(last_client_ts, models.Atendimento.updated_at)

    if status:
        stmt_base = stmt_base.where(models.Atendimento.status.in_(status))

    if tags:
        tag_pattern_obj = [{'name': tags[0]}]
        stmt_base = stmt_base.where(cast(models.Atendimento.tags, JSONB).contains(tag_pattern_obj))

    if time_start:
        try:
            local_dt_naive = datetime.fromisoformat(time_start)
            import pytz
            sao_paulo_tz = pytz.timezone('America/Sao_Paulo')
            local_dt_aware = sao_paulo_tz.localize(local_dt_naive)
            start_datetime_utc = local_dt_aware.astimezone(pytz.utc)
            stmt_base = stmt_base.where(sort_expression >= start_datetime_utc)
        except Exception: pass

    if time_end:
        try:
            local_dt_naive = datetime.fromisoformat(time_end)
            import pytz
            sao_paulo_tz = pytz.timezone('America/Sao_Paulo')
            local_dt_aware = sao_paulo_tz.localize(local_dt_naive)
            end_datetime_utc = local_dt_aware.astimezone(pytz.utc)
            stmt_base = stmt_base.where(sort_expression <= end_datetime_utc)
        except Exception: pass

    if search:
        search_term = f"%{search.lower()}%"
        stmt_base = stmt_base.where(
            (models.Atendimento.whatsapp.ilike(search_term)) |
            (models.Atendimento.status.ilike(search_term)) |
            (models.Atendimento.resumo.ilike(search_term))
        )

    # --- 2. Generator para Streaming ---
    async def stream_csv():
        yield "\uFEFF" # BOM para Excel abrir UTF-8 corretamente
        
        output = io.StringIO()
        writer = csv.writer(output, delimiter=',', quoting=csv.QUOTE_MINIMAL)
        
        # Cabeçalho
        writer.writerow(["WhatsApp", "Nome do Contato", "Situação", "Resumo", "Observações", "Tags", "Persona Ativa", "Criado em", "Última Atualização", "Conversa"])
        yield output.getvalue()
        output.seek(0)
        output.truncate(0)

        # Processamento em Lotes (Batch) para economizar memória
        batch_size = 1000
        offset = 0

        while True:
            stmt_batch = stmt_base.order_by(sort_expression.desc()).offset(offset).limit(batch_size).options(joinedload(models.Atendimento.active_persona))
            result = await db.execute(stmt_batch)
            items = result.scalars().unique().all()

            if not items: break

            for item in items:
                tags_str = "; ".join([t['name'] for t in item.tags]) if item.tags else ""
                persona_name = item.active_persona.nome_config if item.active_persona else ""
                writer.writerow([item.whatsapp, item.nome_contato or "", item.status, item.resumo or "", item.observacoes or "", tags_str, persona_name, item.created_at, item.updated_at, item.conversa or ""])
            
            yield output.getvalue()
            output.seek(0); output.truncate(0)
            offset += batch_size

    filename = f"atendimentos_{datetime.now().strftime('%Y%m%d_%H%M')}.csv"
    return StreamingResponse(stream_csv(), media_type="text/csv", headers={"Content-Disposition": f"attachment; filename={filename}"})

# Endpoint para listar os atendimentos com paginação e busca
@router.get("/", response_model=schemas.AtendimentoPage)
async def get_atendimentos(
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user),
    # Parâmetros de query para busca e paginação, com valores padrão e validações
    search: Optional[str] = Query(None, description="Termo de busca para contato, status ou resumo"),
    status: Optional[List[str]] = Query(None, description="Lista de status para filtrar"),
    tags: Optional[List[str]] = Query(None, description="Lista de nomes de tags para filtrar"),
    page: int = Query(1, ge=1, description="Número da página"),
    limit: int = Query(20, ge=1, le=10000, description="Itens por página"),
    time_start: Optional[str] = Query(None, description="Data e horário de início do filtro (YYYY-MM-DDTHH:MM)"),
    time_end: Optional[str] = Query(None, description="Data e horário de fim do filtro (YYYY-MM-DDTHH:MM)")
):
    """
    Lista todos os atendimentos para o usuário logado, com suporte a busca e paginação.
    - `search`: Filtra os resultados por número de WhatsApp, status ou resumo.
    - `page`: Define a página de resultados a ser retornada.
    - `tags`: Filtra por uma lista de nomes de tags.
    - `status`: Filtra por uma lista de status específicos.
    - `time_start`: Filtra atendimentos atualizados a partir deste horário.
    - `time_end`: Filtra atendimentos atualizados até este horário.
    - `limit`: Define o número máximo de itens por página.
    """
    
    # Calcula o número de registros a pular (offset) com base na página atual e no limite
    skip = (page - 1) * limit

    # Constrói a query base para selecionar atendimentos do usuário logado
    stmt_base = (
        select(models.Atendimento)
        .where(models.Atendimento.user_id == current_user.id)
    )

    # --- LÓGICA DE ORDENAÇÃO POR ÚLTIMA MENSAGEM DO CLIENTE ---
    # Define a expressão para pegar o timestamp da última mensagem do cliente via função SQL
    last_client_ts = func.get_last_user_msg_timestamp(models.Atendimento.conversa)
    # Usa updated_at como fallback caso não haja mensagem do cliente (ex: atendimento recém criado)
    sort_expression = func.coalesce(last_client_ts, models.Atendimento.updated_at)

    # --- NOVO: Adiciona filtro por status, se fornecido ---
    # A query agora pode receber uma lista de status (ex: status=Concluído&status=Atendente Chamado)
    if status:
        stmt_base = stmt_base.where(models.Atendimento.status.in_(status))

    # --- NOVO: Adiciona filtro por tags, se fornecido ---
    if tags:
        # Para cada tag na lista, verifica se ela existe no array JSON 'tags' do atendimento.
        # A sintaxe `[{'name': 'tag_name'}]` é um padrão para construir um objeto JSON
        # que será usado na verificação de contenção (`@>`).
        # A lógica foi alterada para usar o operador `?` que verifica a existência de um
        # elemento de nível superior que corresponda ao padrão.
        # CORREÇÃO: Usar o operador '@>' (contém) para buscar dentro do array de objetos JSON.
        # O operador '?' não funciona para arrays de objetos, apenas para arrays de strings ou chaves de nível superior.
        # --- CORREÇÃO DO ERRO 'jsonb @> character varying' ---
        # O erro ocorre porque o driver estava passando a string JSON como 'varchar'.
        # Ao usar json.loads() primeiro, convertemos a string em um objeto Python (lista de dicionários).
        # O driver asyncpg sabe como serializar corretamente este objeto Python para o tipo JSONB do PostgreSQL.
        tag_pattern_obj = [{'name': tags[0]}] # Apenas o primeiro tag é usado por enquanto
        stmt_base = stmt_base.where(cast(models.Atendimento.tags, JSONB).contains(tag_pattern_obj))

    # --- NOVO: Adiciona filtro por intervalo de horário ---
    if time_start:
        try:
            # 1. Parse da string 'YYYY-MM-DDTHH:MM' para um objeto datetime "naïve".
            local_dt_naive = datetime.fromisoformat(time_start)
            
            # 2. Assume que este horário é do fuso horário local (ex: São Paulo) e o torna "aware".
            #    Idealmente, o fuso horário viria do usuário, mas fixar em 'America/Sao_Paulo' é uma solução robusta para o Brasil.
            import pytz
            sao_paulo_tz = pytz.timezone('America/Sao_Paulo')
            local_dt_aware = sao_paulo_tz.localize(local_dt_naive)
            
            # 3. Converte o horário "aware" para UTC, que é como o banco armazena.
            start_datetime_utc = local_dt_aware.astimezone(pytz.utc)

            # 4. Filtra usando a coluna `updated_at`, que reflete a última atividade.
            stmt_base = stmt_base.where(sort_expression >= start_datetime_utc)
        except (ValueError, ImportError):
            logger.warning(f"Formato de time_start inválido: '{time_start}'. Ignorando filtro.")
        except Exception as e:
            logger.error(f"Erro inesperado no filtro time_start: {e}", exc_info=True)

    if time_end:
        try:
            # Lógica similar para time_end
            local_dt_naive = datetime.fromisoformat(time_end)
            
            import pytz
            sao_paulo_tz = pytz.timezone('America/Sao_Paulo')
            local_dt_aware = sao_paulo_tz.localize(local_dt_naive)
            
            end_datetime_utc = local_dt_aware.astimezone(pytz.utc)

            stmt_base = stmt_base.where(sort_expression <= end_datetime_utc)
        except (ValueError, ImportError):
            logger.warning(f"Formato de time_end inválido: '{time_end}'. Ignorando filtro.")
        except Exception as e:
            logger.error(f"Erro inesperado no filtro time_end: {e}", exc_info=True)

    # Se um termo de busca foi fornecido, adiciona a condição `WHERE` à query
    if search:
        search_term = f"%{search.lower()}%"
        stmt_base = stmt_base.where(
            (models.Atendimento.whatsapp.ilike(search_term)) |
            (models.Atendimento.status.ilike(search_term)) |
            (models.Atendimento.resumo.ilike(search_term))
        )

    # Cria uma query separada para contar o número total de registros que correspondem ao filtro
    stmt_count = select(func.count()).select_from(stmt_base.subquery())
    total_result = await db.execute(stmt_count)
    total = total_result.scalar() or 0

    # Constrói a query final para buscar os dados da página atual
    stmt_data = (
        stmt_base
        .order_by(sort_expression.desc()) # Ordena pelos mais recentes (cliente)
        .offset(skip) # Pula os registros das páginas anteriores
        .limit(limit) # Limita ao número de itens por página
        .options(
            # Eager loading: Carrega a persona ativa junto com o atendimento para evitar queries N+1
            joinedload(models.Atendimento.active_persona)
        )
    )
    
    # Executa a query e obtém os resultados
    data_result = await db.execute(stmt_data)
    # `.unique()` é usado para evitar duplicatas que podem surgir do `joinedload`
    items = data_result.scalars().unique().all()

    # Retorna o resultado no formato esperado pelo schema `AtendimentoPage`
    return {"total": total, "items": items}

# Endpoint para buscar todas as tags únicas do usuário
@router.get("/tags", response_model=List[Dict[str, str]])
async def get_user_tags(
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Busca e retorna uma lista de todas as tags únicas (nome e cor)
    utilizadas nos atendimentos do usuário logado.
    """
    tags = await crud_atendimento.get_all_user_tags(db, user_id=current_user.id)
    return tags

# Endpoint para obter um atendimento específico
@router.get("/{atendimento_id}", response_model=schemas.Atendimento)
async def get_atendimento_by_id(
    atendimento_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Busca um atendimento específico. Útil para polling focado no chat aberto.
    """
    stmt = select(models.Atendimento).where(
        models.Atendimento.id == atendimento_id,
        models.Atendimento.user_id == current_user.id
    ).options(joinedload(models.Atendimento.active_persona))
    
    result = await db.execute(stmt)
    db_atendimento = result.scalars().first()
    
    if not db_atendimento:
        raise HTTPException(status_code=404, detail="Atendimento não encontrado")
    
    return db_atendimento

# Endpoint para atualizar um atendimento existente
@router.put("/{atendimento_id}", response_model=schemas.Atendimento)
async def update_atendimento(
    atendimento_id: int,
    atendimento_in: schemas.AtendimentoUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Atualiza um atendimento específico. Usado, por exemplo, para alterar o status
    ou a persona ativa de uma conversa a partir da interface.
    """
    # Busca o atendimento no banco de dados para garantir que ele pertence ao usuário logado
    db_atendimento = await crud_atendimento.get_atendimento(db, atendimento_id=atendimento_id, user_id=current_user.id)
    if not db_atendimento:
        raise HTTPException(status_code=404, detail="Atendimento não encontrado")
    
    # Chama a função do CRUD para aplicar as atualizações
    updated_atendimento = await crud_atendimento.update_atendimento(db, db_atendimento=db_atendimento, atendimento_in=atendimento_in)
    # Confirma a transação no banco de dados
    await db.commit()
    # Atualiza o objeto Python com os dados do banco
    await db.refresh(updated_atendimento, attribute_names=['active_persona'])
    return updated_atendimento

@router.post("/", response_model=schemas.Atendimento, status_code=201)
async def create_atendimento(
    atendimento_in: schemas.AtendimentoCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Cria um novo atendimento manualmente.
    """
    # Formata o número antes de qualquer verificação ou salvamento
    atendimento_in.whatsapp = format_whatsapp_number(atendimento_in.whatsapp)

    # Verifica se já existe um atendimento para este número
    existing_query = await db.execute(select(models.Atendimento).where(
        models.Atendimento.whatsapp == atendimento_in.whatsapp,
        models.Atendimento.user_id == current_user.id
    ))
    if existing_query.scalars().first():
        raise HTTPException(status_code=409, detail="Já existe um atendimento para este número.")

    # Cria o atendimento no banco de dados
    db_atendimento = await crud_atendimento.create_atendimento(db=db, atendimento_in=atendimento_in, user_id=current_user.id)
    await db.commit()
    await db.refresh(db_atendimento, attribute_names=['active_persona'])

    return db_atendimento


# Endpoint para apagar um atendimento
@router.delete("/{atendimento_id}", response_model=schemas.Atendimento)
async def delete_atendimento(
    atendimento_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Apaga um atendimento específico do banco de dados.
    """
    # Chama a função do CRUD para apagar o atendimento, que também verifica a posse
    deleted_atendimento = await crud_atendimento.delete_atendimento(db, atendimento_id=atendimento_id, user_id=current_user.id)
    if not deleted_atendimento:
        raise HTTPException(status_code=404, detail="Atendimento não encontrado")
    
    # Confirma a transação
    await db.commit()
    return deleted_atendimento


class SendMessagePayload(schemas.BaseModel):
    text: str

class SendTemplatePayload(schemas.BaseModel):
    template_name: str
    language_code: str = "en_US"
    # Lista flexível para componentes de header, body, buttons
    components: Optional[List[Dict[str, Any]]] = None

# Endpoint para um atendente humano enviar uma mensagem de texto
@router.post("/{atendimento_id}/send_message", response_model=schemas.Atendimento)
async def send_manual_message(
    atendimento_id: int,
    payload: SendMessagePayload = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user),
    whatsapp_service: WhatsAppService = Depends(get_whatsapp_service)
):
    """
    Envia uma mensagem de texto manual para o contato de um atendimento.
    Este endpoint é usado pela interface de "Mensagens".
    """
    # 1. Busca o atendimento no banco para obter o número do contato
    db_atendimento = await crud_atendimento.get_atendimento(db, atendimento_id=atendimento_id, user_id=current_user.id)
    if not db_atendimento or not db_atendimento.whatsapp:
        raise HTTPException(status_code=404, detail="Atendimento ou contato não encontrado")

    # Extrai os dados necessários
    whatsapp_number = db_atendimento.whatsapp
    text_to_send = payload.text

    try:
        # 2. Envia a mensagem através do serviço do WhatsApp
        # O objeto `current_user` é passado para que o serviço possa acessar tokens e configurações
        send_result = await whatsapp_service.send_text_message(
            user=current_user,
            number=whatsapp_number,
            text=text_to_send
        )
        
        # Loga o sucesso do envio
        logger.info(f"Mensagem manual enviada para {whatsapp_number} (Atendimento ID: {atendimento_id}). API Msg ID: {send_result.get('id')}")

        # 3. Prepara o objeto da mensagem para ser salvo no histórico da conversa
        # Usa o ID retornado pela API do WhatsApp ou gera um ID local como fallback
        message_id = send_result.get('id') or f"manual-{uuid.uuid4()}"
        timestamp_epoch = send_result.get('timestamp', int(datetime.now(timezone.utc).timestamp()))
        
        formatted_message = schemas.FormattedMessage(
            id=str(message_id),
            role='assistant', # 'assistant' representa o lado da empresa (atendente ou IA)
            content=text_to_send,
            timestamp=timestamp_epoch,
            status="sent"
        )

        # 4. Adiciona a mensagem formatada ao campo 'conversa' (JSON) do atendimento
        # A função do CRUD lida com a leitura, adição e reescrita do JSON
        atendimento_atualizado = await crud_atendimento.add_message_to_conversa(
            db=db,
            atendimento_id=atendimento_id,
            user_id=current_user.id,
            message=formatted_message
        )
        
        if not atendimento_atualizado:
             # Isso não deve acontecer se o get_atendimento funcionou, mas é uma segurança
            raise HTTPException(status_code=500, detail="Falha ao salvar mensagem no histórico após envio")
        
        # Atualiza o objeto para retornar os dados mais recentes, garantindo o carregamento de relacionamentos
        await db.refresh(atendimento_atualizado, attribute_names=['active_persona'])
        return atendimento_atualizado

    # Captura de erros específicos do serviço de envio
    except MessageSendError as e:
        logger.error(f"Erro ao ENVIAR mensagem manual para {whatsapp_number} (Atendimento ID: {atendimento_id}): {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=f"Falha ao enviar mensagem pela API do WhatsApp: {e}")
    # Captura de outros erros inesperados
    except Exception as e:
        await db.rollback()
        logger.error(f"Erro INESPERADO ao enviar mensagem manual (Atendimento ID: {atendimento_id}): {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro interno: {e}")

# Endpoint para um atendente humano enviar um arquivo de mídia
@router.post("/{atendimento_id}/send_media", response_model=schemas.Atendimento)
async def send_manual_media_message(
    atendimento_id: int,
    file: UploadFile = File(...),
    type: str = Form(...), # 'image', 'audio', 'document'
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user),
    whatsapp_service: WhatsAppService = Depends(get_whatsapp_service),
):
    """
    Envia um arquivo de mídia (imagem, áudio, documento, vídeo) para o contato.
    Recebe os dados do arquivo como `multipart/form-data`.
    """
    
    # 1. Busca o atendimento para obter o número do contato
    db_atendimento = await crud_atendimento.get_atendimento(db, atendimento_id=atendimento_id, user_id=current_user.id)
    if not db_atendimento or not db_atendimento.whatsapp:
        raise HTTPException(status_code=404, detail="Atendimento ou contato não encontrado")

    # Valida se o tipo de mídia é suportado
    if type not in ['image', 'audio', 'document', 'video']:
        raise HTTPException(status_code=400, detail="Tipo de mídia inválido.")

    whatsapp_number = db_atendimento.whatsapp
    
    try:
        # 2. Lê o conteúdo do arquivo enviado em memória
        file_bytes = await file.read()
        filename = file.filename or "media_file"
        mimetype = file.content_type
        
        # Tenta adivinhar o mimetype se não for fornecido
        if not mimetype:
            mimetype, _ = mimetypes.guess_type(filename)
            if not mimetype: mimetype = 'application/octet-stream'
        
        logger.info(f"Enviando mídia manual (Tipo: {type}, Nome: {filename}) para Atendimento {atendimento_id}")
        
        # Gera um texto de fallback para ser salvo no histórico da conversa
        # Este texto é o que aparece na UI antes da análise da IA (se aplicável)
        if type in ['image', 'audio', 'document', 'video']:
            fallback_type_text = "Mídia"
            if type == 'audio': fallback_type_text = "Áudio"
            elif type == 'image': fallback_type_text = "Imagem"
            elif type == 'video': fallback_type_text = "Vídeo"
            
            # Para documentos, o nome do arquivo é mais útil
            if type == 'document':
                generated_content = f"[Documento enviado: {filename}]"
            else:
                generated_content = f"[{fallback_type_text} enviado(a): {filename}]"

        # 3. Envia a mídia através do serviço do WhatsApp
        # O serviço internamente pode precisar converter o arquivo (ex: áudio para mp3)
        send_result = await whatsapp_service.send_media_message(
            user=current_user,
            number=whatsapp_number,
            media_type=type, # 'image', 'audio', etc.
            file_bytes=file_bytes,
            filename=filename,
            mimetype=mimetype,
            caption=None # O frontend não manda caption, mas o 'content' agora é a análise
        )
        
        logger.info(f"Mídia manual enviada para {whatsapp_number}. API Msg ID: {send_result.get('id')}")

        # 4. Prepara o objeto da mensagem para salvar no histórico
        message_id = send_result.get('id') or f"manual-{uuid.uuid4()}"
        timestamp_epoch = send_result.get('timestamp', int(datetime.now(timezone.utc).timestamp()))
        media_id_from_send = send_result.get("media_id") # ID da mídia na API do WhatsApp
        
        # Se o serviço converteu o áudio, o mimetype salvo deve ser o do formato final (mp3)
        # A conversão agora sempre acontece para áudio, então podemos definir diretamente.
        final_mimetype_saved = 'audio/mpeg' if type == 'audio' else mimetype

        formatted_message = schemas.FormattedMessage(
            id=str(message_id),
            role='assistant',
            content=generated_content, # Usa o texto de fallback gerado
            timestamp=timestamp_epoch,
            type=type,
            url=None, 
            filename=filename,
            media_id=media_id_from_send, # Salva o ID da mídia para referência futura
            mime_type=final_mimetype_saved, # Salva o mimetype correto
            status="sent"
        )

        # 5. Adiciona a mensagem de mídia ao histórico da conversa
        atendimento_atualizado = await crud_atendimento.add_message_to_conversa(
            db=db,
            atendimento_id=atendimento_id,
            user_id=current_user.id,
            message=formatted_message
        )
        
        if not atendimento_atualizado:
             raise HTTPException(status_code=500, detail="Falha ao salvar mídia no histórico após envio")

        # Retorna o atendimento atualizado com os relacionamentos
        await db.refresh(atendimento_atualizado, attribute_names=['active_persona'])
        return atendimento_atualizado

    # Tratamento de erros
    except MessageSendError as e:
        logger.error(f"Erro ao ENVIAR mídia manual (Atendimento ID: {atendimento_id}): {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=f"Falha ao enviar mídia: {e}")
    except Exception as e:
        await db.rollback()
        logger.error(f"Erro INESPERADO ao enviar mídia manual (Atendimento ID: {atendimento_id}): {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro interno: {e}")
    finally:
        # Garante que o arquivo temporário seja fechado
        await file.close()

# Endpoint para listar os templates de mensagem disponíveis para o usuário
@router.get("/whatsapp/templates", response_model=List[Dict[str, Any]])
async def get_whatsapp_templates(
    current_user: models.User = Depends(dependencies.get_current_active_user),
    whatsapp_service: WhatsAppService = Depends(get_whatsapp_service)
):
    """
    Busca e retorna a lista de templates de mensagem aprovados ('ACTIVE')
    da conta do WhatsApp Business associada ao usuário.
    """
    # NOTA: Requer que 'wbp_business_account_id' esteja no modelo User e preenchido.
    if not hasattr(current_user, 'wbp_business_account_id') or not current_user.wbp_business_account_id:
        logger.error(f"Usuário {current_user.id} tentou buscar templates sem 'wbp_business_account_id' configurado.")
        raise HTTPException(
            status_code=400,
            detail="ID da Conta do WhatsApp Business não está configurado para este usuário."
        )

    try:
        templates = await whatsapp_service.get_templates_official(
            business_account_id=current_user.wbp_business_account_id,
            access_token=settings.WBP_ACCESS_TOKEN
        )
        return templates
    except (MessageSendError, ValueError) as e:
        logger.error(f"Erro ao buscar templates para o usuário {current_user.id}: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=f"Falha ao buscar templates da API do WhatsApp: {e}")
        
@router.post("/whatsapp/templates", summary="Criar novo template na Meta")
async def create_whatsapp_template(
    payload_json: str = Form(...),
    file: Optional[UploadFile] = File(None),
    current_user: models.User = Depends(dependencies.get_current_active_user),
    whatsapp_service: WhatsAppService = Depends(get_whatsapp_service)
):
    """
    Cria um template diretamente na conta do WhatsApp Business vinculada ao usuário.
    """
    if not hasattr(current_user, 'wbp_business_account_id') or not current_user.wbp_business_account_id:
        raise HTTPException(
            status_code=400,
            detail="ID da Conta do WhatsApp Business não está configurado para este usuário."
        )

    try:
        payload = json.loads(payload_json)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Payload JSON inválido: {e}")

    try:
        if file:
            file_bytes = await file.read()
            mimetype = file.content_type or 'application/octet-stream'
            
            handle = await whatsapp_service.upload_template_example(
                access_token=settings.WBP_ACCESS_TOKEN,
                file_bytes=file_bytes,
                mimetype=mimetype
            )
            
            for comp in payload.get('components', []):
                if comp.get('type') == 'HEADER' and comp.get('format') in ['IMAGE', 'VIDEO', 'DOCUMENT']:
                    comp['example'] = {'header_handle': [handle]}

        result = await whatsapp_service.create_template_official(
            business_account_id=current_user.wbp_business_account_id,
            access_token=settings.WBP_ACCESS_TOKEN,
            payload=payload
        )
        return result
    except Exception as e:
        logger.error(f"Erro ao criar template: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))

# Endpoint para baixar mídias recebidas via API Oficial
@router.get("/{atendimento_id}/media/{media_id}", summary="Baixar mídia diretamente (API Oficial)")
async def download_media_directly(
    atendimento_id: int,
    media_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user),
    whatsapp_service: WhatsAppService = Depends(get_whatsapp_service)
):
    """
    Permite que o frontend baixe um arquivo de mídia (imagem, áudio, etc.)
    que foi recebido de um contato. Ele atua como um proxy seguro.
    """
    # 1. Validações de segurança e configuração
    db_atendimento = await crud_atendimento.get_atendimento(db, atendimento_id=atendimento_id, user_id=current_user.id)
    if not db_atendimento: raise HTTPException(status_code=404, detail="Atendimento não encontrado.")

    decrypted_token = settings.WBP_ACCESS_TOKEN

    # 2. Processo de download via proxy
    media_url: Optional[str] = None
    try:
        # a. Obtém a URL de download temporária da API da Meta usando o media_id
        logger.debug(f"Buscando URL para media_id {media_id}...")
        media_url = await whatsapp_service.get_media_url_official(media_id, decrypted_token)
        if not media_url:
            raise HTTPException(status_code=404, detail="URL da mídia não encontrada na Meta (inválida ou expirada?).")

        # Log para depuração
        logger.info(f"!!! [DEBUG] URL COMPLETA DA META OBTIDA: {media_url}")

        # (O log anterior que mostrava só o início foi removido/substituído por este)

        token_preview = decrypted_token[:10] + "..." + decrypted_token[-5:] if len(decrypted_token) > 15 else decrypted_token
        logger.debug(f"Tentando baixar da Meta URL com token preview: {token_preview}")

        # b. Faz o download do arquivo para o servidor da nossa API
        logger.info(f"Baixando mídia {media_id} diretamente da Meta...")
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
             headers = {"Authorization": f"Bearer {decrypted_token}"}
             media_response = await client.get(media_url, headers=headers)

             # Logs para depurar a resposta da Meta
             logger.debug(f"Resposta da Meta - Status: {media_response.status_code}")
             logger.debug(f"Resposta da Meta - Headers: {media_response.headers}")

             # Verifica se a resposta da Meta é um erro (ex: uma página HTML de login)
             # em vez de um arquivo de mídia
             content_type = media_response.headers.get('content-type', '').lower()
             if media_response.status_code != 200 or 'text/html' in content_type:
                 response_body_text = "[Não foi possível ler corpo da resposta]"
                 try:
                     response_body_text = (await media_response.aread(1024)).decode('utf-8', errors='ignore')
                 except Exception as read_err:
                     logger.warning(f"Não foi possível ler o corpo da resposta de erro da Meta: {read_err}")
                 logger.error(f"Erro ao baixar mídia {media_id}: Meta retornou status {media_response.status_code} / tipo {content_type}. Corpo (início): {response_body_text}")
                 media_response.raise_for_status()
                 raise HTTPException(status_code=502, detail="Falha ao baixar mídia da Meta: Resposta inesperada (HTML). Verifique o token/permissões.")

             # c. Extrai os bytes do arquivo da resposta
             media_bytes = media_response.content
             logger.info(f"Mídia {media_id} baixada ({len(media_bytes)} bytes, tipo: {content_type}). Retornando para o frontend.")

             # Tenta encontrar o nome do arquivo no histórico da conversa
             filename = "download"
             try:
                 conversa_list = json.loads(db_atendimento.conversa or "[]")
                 for msg in conversa_list:
                     if msg.get("media_id") == media_id:
                         filename = msg.get("filename") or "download"
                         break
             except Exception as e:
                 logger.warning(f"Erro ao buscar filename para media {media_id}: {e}")

             headers = {"Content-Disposition": f'attachment; filename="{filename}"'}

             # d. Retorna os bytes do arquivo diretamente para o navegador do usuário
             return Response(content=media_bytes, media_type=content_type, headers=headers)

    # Tratamento de erros HTTP que podem ocorrer na comunicação com a API da Meta
    except httpx.HTTPStatusError as e:
        is_download_error = media_url is not None
        log_prefix = "Erro HTTP da Meta ao BAIXAR mídia" if is_download_error else "Erro HTTP da Meta ao BUSCAR URL"
        # O log detalhado já foi feito acima se o erro foi no download
        if not is_download_error:
             logger.error(f"{log_prefix} {media_id}: Status {e.response.status_code}. Resposta: {e.response.text if e.response else 'N/A'}", exc_info=False)

        error_detail = f"Erro {e.response.status_code} na Meta."
        # Tenta extrair uma mensagem de erro mais amigável do JSON da Meta
        try: meta_error = e.response.json(); error_detail = meta_error.get("error", {}).get("message", error_detail); 
        except Exception: pass
        raise HTTPException(status_code=502, detail=f"Erro API WhatsApp: {error_detail}")

    # Tratamento de erros genéricos
    except Exception as e:
        logger.error(f"Erro inesperado ao processar mídia {media_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro interno ao processar mídia: {str(e)}")

# Endpoint para enviar uma mensagem de template
@router.post("/{atendimento_id}/send_template", response_model=schemas.Atendimento)
async def send_template_message(
    atendimento_id: int,
    payload_json: str = Form(...),
    file: Optional[UploadFile] = File(None),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user),
    whatsapp_service: WhatsAppService = Depends(get_whatsapp_service)
):
    """
    Envia uma mensagem baseada em um template pré-aprovado da Meta.
    Suporta envio de variáveis e mídia no cabeçalho.
    """
    try:
        payload_dict = json.loads(payload_json)
        payload = SendTemplatePayload(**payload_dict)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Payload JSON inválido: {e}")

    db_atendimento = await crud_atendimento.get_atendimento(db, atendimento_id=atendimento_id, user_id=current_user.id)
    if not db_atendimento or not db_atendimento.whatsapp:
        raise HTTPException(status_code=404, detail="Atendimento ou contato não encontrado")

    whatsapp_number = db_atendimento.whatsapp

    try:
        # Se houver arquivo, faz o upload para a Meta antes de enviar o template
        if file and current_user.wbp_phone_number_id:
            file_bytes = await file.read()
            mimetype = file.content_type or mimetypes.guess_type(file.filename)[0] or 'application/octet-stream'
            
            media_type = 'document'
            if mimetype.startswith('image/'): media_type = 'image'
            elif mimetype.startswith('video/'): media_type = 'video'
            
            media_id = await whatsapp_service._upload_media_official(
                phone_number_id=current_user.wbp_phone_number_id,
                access_token=settings.WBP_ACCESS_TOKEN,
                file_bytes=file_bytes,
                mimetype=mimetype,
                filename=file.filename,
                media_type=media_type
            )
            
            if media_id:
                if not payload.components: payload.components = []
                header_comp = next((c for c in payload.components if c['type'] == 'header'), None)
                if not header_comp:
                    header_comp = {"type": "header", "parameters": []}
                    payload.components.insert(0, header_comp)
                
                header_comp['parameters'].append({
                    "type": media_type,
                    media_type: {"id": media_id}
                })
            else:
                logger.error(f"Falha no upload de mídia para template: {file.filename}")
                raise HTTPException(status_code=502, detail="Falha ao carregar a mídia do template para os servidores da Meta.")

        send_result = await whatsapp_service.send_template_message(
            user=current_user,
            number=whatsapp_number,
            template_name=payload.template_name,
            language_code=payload.language_code,
            components=payload.components
        )

        logger.info(f"Template '{payload.template_name}' enviado para {whatsapp_number}. API Msg ID: {send_result.get('id')}")

        # Identifica se foi enviada mídia para salvar corretamente no histórico
        msg_type = 'text'
        final_media_id = None

        # --- INÍCIO DA LÓGICA ATUALIZADA ---
        # Monta a mensagem completa para o histórico, em vez de um resumo.
        content_for_history = f"[Template: {payload.template_name}]\n"
        try:
            # 1. Busca a definição do template para obter o texto original
            templates = await whatsapp_service.get_templates_official(
                business_account_id=current_user.wbp_business_account_id,
                access_token=settings.WBP_ACCESS_TOKEN
            )
            
            target_template = next((t for t in templates if t['name'] == payload.template_name and t['language'] == payload.language_code), None)

            if target_template:
                # 2. Pega os textos do header e body
                header_text = next((c.get('text', '') for c in target_template.get('components', []) if c['type'] == 'HEADER'), '')
                body_text = next((c.get('text', '') for c in target_template.get('components', []) if c['type'] == 'BODY'), '')

                # 3. Pega os valores das variáveis enviadas (se houver)
                sent_components = payload.components or [] # Garante que é uma lista, mesmo se for None
                header_params = next((c.get('parameters', []) for c in sent_components if c['type'] == 'header'), [])
                body_params = next((c.get('parameters', []) for c in sent_components if c['type'] == 'body'), [])

                # Captura o media_id do header para que o chat possa exibir a imagem no histórico
                for hp in header_params:
                    if 'image' in hp:
                        msg_type = 'image'; final_media_id = hp['image'].get('id')
                    elif 'video' in hp:
                        msg_type = 'video'; final_media_id = hp['video'].get('id')
                    elif 'document' in hp:
                        msg_type = 'document'; final_media_id = hp['document'].get('id')
                    if final_media_id: break

                # 4. Substitui as variáveis no texto
                for i, param in enumerate(header_params):
                    header_text = header_text.replace(f"{{{{{i+1}}}}}", param.get('text', ''))
                
                for i, param in enumerate(body_params):
                    # A contagem de variáveis do corpo pode continuar da do header, ou começar de 1.
                    # A API da Meta é um pouco inconsistente. Vamos tentar os dois.
                    # Ex: {{1}} no header, {{1}} no body.
                    body_text = body_text.replace(f"{{{{{i+1}}}}}", param.get('text', ''))
                    # Ex: {{1}} no header, {{2}} no body.
                    body_text = body_text.replace(f"{{{{{len(header_params) + i + 1}}}}}", param.get('text', ''))

                # Captura os botões do template para renderizar na interface
                buttons_data = next((c.get('buttons', []) for c in target_template.get('components', []) if c['type'] == 'BUTTONS'), [])
                extracted_buttons = [b.get('text') for b in buttons_data if b.get('text')]

                full_message = f"{header_text}\n{body_text}".strip()
                if full_message:
                    content_for_history = full_message

        except Exception as e:
            logger.warning(f"Não foi possível montar o preview completo do template '{payload.template_name}': {e}")
            # Fallback para o método antigo se a montagem falhar
            content_for_history = f"[Template enviado: {payload.template_name}]"
            extracted_buttons = []
        # --- FIM DA LÓGICA ATUALIZADA ---
        
        formatted_message = schemas.FormattedMessage(
            id=send_result.get('id') or f"template-{uuid.uuid4()}",
            role='assistant',
            content=content_for_history,
            timestamp=int(datetime.now(timezone.utc).timestamp()),
            type=msg_type,
            media_id=final_media_id,
            filename=file.filename if file else None,
            status="sent",
            is_template=True,
            buttons=extracted_buttons
        )

        atendimento_atualizado = await crud_atendimento.add_message_to_conversa(
            db=db, atendimento_id=atendimento_id, user_id=current_user.id, message=formatted_message
        )

        await db.refresh(atendimento_atualizado, attribute_names=['active_persona'])
        return atendimento_atualizado

    except (MessageSendError, ValueError) as e:
        logger.error(f"Erro ao ENVIAR template para {whatsapp_number}: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=f"Falha ao enviar template pela API: {e}")

@router.post("/bulk", summary="Importar contatos para disparo em massa")
async def create_bulk_disparos(
    file: Optional[UploadFile] = File(None),
    atendimento_ids: Optional[str] = Form(None),
    media_file: Optional[UploadFile] = File(None),
    template_name: str = Form(...),
    persona_id: int = Form(...),
    observacoes: Optional[str] = Form(None),
    template_params: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user),
    whatsapp_service: WhatsAppService = Depends(get_whatsapp_service)
):
    """
    Recebe um CSV com 'whatsapp' e opcionalmente 'nome', e/ou uma lista de IDs de atendimentos
    para disparar mensagens em massa, colocando-os na fila (Aguardando Envio).
    """
    if not file and not atendimento_ids:
        raise HTTPException(status_code=400, detail="Forneça um arquivo CSV ou uma lista de IDs.")
    
    # Parse dos parâmetros do template
    params_dict = {"components": []}
    if template_params:
        try:
            params_dict = json.loads(template_params)
        except:
            logger.warning(f"Falha ao parsear template_params no bulk: {template_params}")

    # Se houver arquivo de mídia, faz o upload para a Meta uma única vez para todos os disparos
    if media_file and current_user.wbp_phone_number_id:
        file_bytes = await media_file.read()
        mimetype = media_file.content_type or mimetypes.guess_type(media_file.filename)[0] or 'application/octet-stream'
        
        media_type = 'document'
        if mimetype.startswith('image/'): media_type = 'image'
        elif mimetype.startswith('video/'): media_type = 'video'
        
        media_id = await whatsapp_service._upload_media_official(
            phone_number_id=current_user.wbp_phone_number_id,
            access_token=settings.WBP_ACCESS_TOKEN,
            file_bytes=file_bytes,
            mimetype=mimetype,
            filename=media_file.filename,
            media_type=media_type
        )
        
        if media_id:
            components = params_dict.get("components", [])
            header_comp = next((c for c in components if c['type'] == 'header'), None)
            if not header_comp:
                header_comp = {"type": "header", "parameters": []}
                components.insert(0, header_comp)
            
            header_comp['parameters'].append({
                "type": media_type,
                media_type: {"id": media_id}
            })
            params_dict["components"] = components

    count = 0
    
    # Processa arquivo CSV
    if file:
        content = await file.read()
        decoded = content.decode('utf-8')
        reader = csv.DictReader(io.StringIO(decoded))
        
        for row in reader:
            number = format_whatsapp_number(row.get('whatsapp', ''))
            # Extrai o nome do CSV, com fallback para string vazia
            nome_csv = row.get('nome', '') or row.get('Nome', '') or row.get('NOME', '')
            if not number: continue
            
            existing = await db.execute(select(models.Atendimento).where(
                models.Atendimento.whatsapp == number,
                models.Atendimento.user_id == current_user.id
            ))
            existing_at = existing.scalars().first()
            
            if existing_at:
                nome_contato = nome_csv if nome_csv else (existing_at.nome_contato or "")
                row_params = copy.deepcopy(params_dict)
                for comp in row_params.get("components", []):
                    for param in comp.get("parameters", []):
                        if param.get("type") == "text" and isinstance(param.get("text"), str):
                            param["text"] = param["text"].replace("{nome}", nome_contato).replace("{NOME}", nome_contato)

                existing_at.status = "Aguardando Envio"
                existing_at.bulk_template_name = template_name
                existing_at.bulk_template_params = row_params
                existing_at.active_persona_id = persona_id
                if nome_csv and not existing_at.nome_contato:
                    existing_at.nome_contato = nome_csv
                if observacoes:
                    existing_at.observacoes = f"{existing_at.observacoes or ''}\n{observacoes}".strip()
                db.add(existing_at)
            else:
                row_params = copy.deepcopy(params_dict)
                for comp in row_params.get("components", []):
                    for param in comp.get("parameters", []):
                        if param.get("type") == "text" and isinstance(param.get("text"), str):
                            param["text"] = param["text"].replace("{nome}", nome_csv).replace("{NOME}", nome_csv)

                new_at = models.Atendimento(
                    whatsapp=number,
                    nome_contato=nome_csv,
                    user_id=current_user.id,
                    status="Aguardando Envio",
                    active_persona_id=persona_id,
                    bulk_template_name=template_name,
                    observacoes=observacoes,
                    bulk_template_params=row_params
                )
                db.add(new_at)
            count += 1

    # Processa IDs vindos da interface gráfica
    if atendimento_ids:
        try:
            ids_list = json.loads(atendimento_ids)
            if isinstance(ids_list, list):
                for at_id in ids_list:
                    existing = await db.execute(select(models.Atendimento).where(
                        models.Atendimento.id == int(at_id),
                        models.Atendimento.user_id == current_user.id
                    ))
                    existing_at = existing.scalars().first()
                    if existing_at:
                        nome_contato = existing_at.nome_contato or ""
                        id_params = copy.deepcopy(params_dict)
                        for comp in id_params.get("components", []):
                            for param in comp.get("parameters", []):
                                if param.get("type") == "text" and isinstance(param.get("text"), str):
                                    param["text"] = param["text"].replace("{nome}", nome_contato).replace("{NOME}", nome_contato)

                        existing_at.status = "Aguardando Envio"
                        existing_at.bulk_template_name = template_name
                        existing_at.bulk_template_params = id_params
                        existing_at.active_persona_id = persona_id
                        if observacoes:
                            existing_at.observacoes = f"{existing_at.observacoes or ''}\n{observacoes}".strip()
                        db.add(existing_at)
                        count += 1
        except Exception as e:
            logger.error(f"Erro ao processar atendimento_ids no bulk: {e}")
    
    await db.commit()
    return {"message": f"{count} atendimentos enfileirados para envio."}


class FeedbackAnalysisPayload(schemas.BaseModel):
    feedback: str

@router.post("/{atendimento_id}/analyze_feedback", summary="Analisar atendimento via IA para melhoria de prompt")
async def analyze_feedback(
    atendimento_id: int,
    payload: FeedbackAnalysisPayload = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user),
    gemini_service: GeminiService = Depends(get_gemini_service)
):
    db_atendimento = await crud_atendimento.get_atendimento(db, atendimento_id=atendimento_id, user_id=current_user.id)
    if not db_atendimento:
        raise HTTPException(status_code=404, detail="Atendimento não encontrado")

    conversa_list = []
    try:
        conversa_list = json.loads(db_atendimento.conversa or "[]")
    except: pass

    history_str = gemini_service._format_history_optimized(conversa_list, include_timestamps=False)
    
    # Extrai as últimas mensagens para tentar pegar o contexto do RAG que foi usado
    rag_query = ""
    if conversa_list:
        recent_msgs = conversa_list[-5:]
        rag_query = gemini_service._format_history_optimized(recent_msgs, include_timestamps=False)

    persona_id = db_atendimento.active_persona_id or current_user.default_persona_id
    persona = await db.get(models.Config, persona_id)
    if not persona:
        raise HTTPException(status_code=400, detail="Persona não encontrada para este atendimento.")

    rag_context = await gemini_service._retrieve_rag_context(db, persona.id, rag_query)

    analysis = await gemini_service.analyze_conversation_feedback(
        feedback=payload.feedback,
        history_str=history_str,
        rag_context=rag_context,
        current_instructions=persona.prompt or "",
        db=db,
        user=current_user
    )
    return analysis

class AlteracaoPlanilha(schemas.BaseModel):
    aba: str
    coluna_1: str
    valor_antigo: Optional[str] = None
    valor_novo: str
    acao: str
    motivo: Optional[str] = None

class ApplyFeedbackPayload(schemas.BaseModel):
    alteracoes: List[AlteracaoPlanilha]

@router.post("/{atendimento_id}/apply_feedback", summary="Aplicar sugestões no prompt da Persona")
async def apply_feedback(
    atendimento_id: int,
    payload: ApplyFeedbackPayload = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    db_atendimento = await crud_atendimento.get_atendimento(db, atendimento_id=atendimento_id, user_id=current_user.id)
    if not db_atendimento: raise HTTPException(status_code=404, detail="Atendimento não encontrado")
        
    persona_id = db_atendimento.active_persona_id or current_user.default_persona_id
    persona = await db.get(models.Config, persona_id)
    if not persona or not persona.spreadsheet_id:
        raise HTTPException(status_code=400, detail="Persona não encontrada ou sem planilha de sistema configurada.")
        
    sheets_service = GoogleSheetsService()
    try:
        alteracoes_dict = [a.model_dump() for a in payload.alteracoes]
        await sheets_service.apply_feedback_to_sheet(persona.spreadsheet_id, alteracoes_dict)
        
        # Sincroniza a planilha após aplicar o feedback
        sheet_data_json = await sheets_service.get_sheet_as_json(persona.spreadsheet_id)
        prompt_buffer = []
        for sheet_name, rows in sheet_data_json.items():
            if not rows:
                continue
            headers = list(rows[0].keys())
            lines = [f"# {sheet_name}", "|".join(headers)]
            for row in rows:
                values = [str(row.get(h, "") or "").strip().replace("\n", "\\n").replace("\r", "") for h in headers]
                lines.append("|".join(values))
            prompt_buffer.append("\n".join(lines))
        
        persona.prompt = "\n\n".join(prompt_buffer)
        db.add(persona)
        await db.commit()

        return {"message": "Planilha atualizada e sincronizada com sucesso! A IA já está usando as novas regras."}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))