# app/api/atendimentos.py

# 1. Importações nativas/padrão do Python
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime

# 2. Importações de terceiros
from fastapi import APIRouter, Depends, HTTPException, Body, Response, Query, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

# 3. Importações locais do projeto
from app.api import dependencies
from app.db import models, schemas
from app.db.database import get_db
from app.services.whatsapp_service import WhatsAppService, get_whatsapp_service
from app.services.gemini_service import GeminiService, get_gemini_service
from app.services.config_service import ConfigService
from app.services.atendimento_service import (AtendimentoService, AtendimentoNotFoundError, AtendimentoConflictError)

# Configuração do logger
logger = logging.getLogger(__name__)

# Criação do roteador da API para os endpoints de atendimentos
router = APIRouter()


# Exporta os atendimentos da empresa para um arquivo CSV com streaming
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
    company_id = current_user.company_id or 0
    stream_generator = await AtendimentoService.export_atendimentos(
        db=db,
        company_id=company_id,
        search=search,
        status=status,
        tags=tags,
        time_start=time_start,
        time_end=time_end
    )
    
    filename = f"atendimentos_{datetime.now().strftime('%Y%m%d_%H%M')}.csv"
    return StreamingResponse(
        stream_generator,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


# Lista atendimentos paginados com filtros de busca, status, tags, data e ordenação
@router.get("/", response_model=schemas.AtendimentoPage)
async def get_atendimentos(
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user),
    search: Optional[str] = Query(None, description="Termo de busca para contato, status ou resumo"),
    status: Optional[List[str]] = Query(None, description="Lista de status para filtrar"),
    tags: Optional[List[str]] = Query(None, description="Lista de nomes de tags para filtrar"),
    page: int = Query(1, ge=1, description="Número da página"),
    limit: int = Query(20, ge=1, le=10000, description="Itens por página"),
    time_start: Optional[str] = Query(None, description="Data e horário de início do filtro (YYYY-MM-DDTHH:MM)"),
    time_end: Optional[str] = Query(None, description="Data e horário de fim do filtro (YYYY-MM-DDTHH:MM)"),
    sort_by: Optional[str] = Query(None, description="Nome da coluna para ordenação"),
    sort_order: Optional[str] = Query("desc", description="Ordem da ordenação (asc ou desc)")
):
    """
    Lista todos os atendimentos para o usuário logado, com suporte a busca e paginação.
    """
    company_id = current_user.company_id or 0
    return await AtendimentoService.get_atendimentos(
        db=db,
        company_id=company_id,
        search=search,
        status=status,
        tags=tags,
        page=page,
        limit=limit,
        time_start=time_start,
        time_end=time_end,
        sort_by=sort_by,
        sort_order=sort_order
    )


# Retorna todas as tags exclusivas utilizadas nos atendimentos da empresa
@router.get("/tags", response_model=List[Dict[str, str]])
async def get_user_tags(
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Busca e retorna uma lista de todas as tags únicas (nome e cor)
    utilizadas nos atendimentos da empresa do usuário logado.
    """
    company_id = current_user.company_id or 0
    return await AtendimentoService.get_user_tags(db=db, company_id=company_id)


# Remove uma tag específica de todos os atendimentos da empresa
@router.delete("/tags", summary="Excluir tag de todos os atendimentos")
async def delete_tag_from_company(
    tag_name: str = Query(..., description="Nome da tag a ser excluída"),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Exclui a tag informada de todos os atendimentos da empresa do usuário logado.
    """
    company_id = current_user.company_id or 0
    try:
        return await AtendimentoService.delete_tag_from_company(
            db=db,
            company_id=company_id,
            tag_name=tag_name
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro interno ao excluir tag: {str(e)}")


# Busca e retorna os detalhes de um atendimento específico pelo seu ID
@router.get("/{atendimento_id}", response_model=schemas.Atendimento)
async def get_atendimento_by_id(
    atendimento_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Busca um atendimento específico. Útil para polling focado no chat aberto.
    """
    company_id = current_user.company_id or 0
    try:
        return await AtendimentoService.get_atendimento_by_id(
            db=db,
            company_id=company_id,
            atendimento_id=atendimento_id
        )
    except AtendimentoNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


# Atualiza as informações de um atendimento existente
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
    company_id = current_user.company_id or 0
    try:
        return await AtendimentoService.update_atendimento(
            db=db,
            company_id=company_id,
            atendimento_id=atendimento_id,
            atendimento_in=atendimento_in
        )
    except AtendimentoNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


# Cria manualmente um novo atendimento para a empresa
@router.post("/", response_model=schemas.Atendimento, status_code=201)
async def create_atendimento(
    atendimento_in: schemas.AtendimentoCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Cria um novo atendimento manualmente.
    """
    company_id = current_user.company_id or 0
    try:
        return await AtendimentoService.create_atendimento(
            db=db,
            company_id=company_id,
            atendimento_in=atendimento_in
        )
    except AtendimentoConflictError as e:
        raise HTTPException(status_code=409, detail=str(e))


# Exclui um atendimento específico do banco de dados
@router.delete("/{atendimento_id}", response_model=schemas.Atendimento)
async def delete_atendimento(
    atendimento_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Apaga um atendimento específico do banco de dados.
    """
    company_id = current_user.company_id or 0
    try:
        return await AtendimentoService.delete_atendimento(
            db=db,
            company_id=company_id,
            atendimento_id=atendimento_id
        )
    except AtendimentoNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


# Envia uma mensagem manual de texto para o contato via WhatsApp
@router.post("/{atendimento_id}/send_message", response_model=schemas.Atendimento)
async def send_manual_message(
    atendimento_id: int,
    payload: schemas.SendMessagePayload = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user),
    whatsapp_service: WhatsAppService = Depends(get_whatsapp_service)
):
    """
    Envia uma mensagem de texto manual para o contato de um atendimento.
    Este endpoint é usado pela interface de "Mensagens".
    """
    company_id = current_user.company_id or 0
    try:
        return await AtendimentoService.send_manual_message(
            db=db,
            company=current_user.company,
            company_id=company_id,
            atendimento_id=atendimento_id,
            text=payload.text,
            whatsapp_service=whatsapp_service
        )
    except AtendimentoNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Erro ao enviar mensagem manual (Atendimento ID: {atendimento_id}): {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))


# Envia um arquivo de mídia (imagem, áudio, doc, vídeo) para o contato via WhatsApp
@router.post("/{atendimento_id}/send_media", response_model=schemas.Atendimento)
async def send_manual_media_message(
    atendimento_id: int,
    file: UploadFile = File(...),
    type: str = Form(...),  # 'image', 'audio', 'document', 'video'
    caption: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user),
    whatsapp_service: WhatsAppService = Depends(get_whatsapp_service)
):
    """
    Envia um arquivo de mídia (imagem, áudio, documento, vídeo) para o contato.
    Recebe os dados do arquivo como `multipart/form-data`.
    """
    company_id = current_user.company_id or 0
    try:
        file_bytes = await file.read()
        filename = file.filename or "media_file"
        mimetype = file.content_type
        
        return await AtendimentoService.send_manual_media_message(
            db=db,
            company=current_user.company,
            company_id=company_id,
            atendimento_id=atendimento_id,
            file_bytes=file_bytes,
            filename=filename,
            mimetype=mimetype,
            media_type=type,
            caption=caption,
            whatsapp_service=whatsapp_service
        )
    except AtendimentoNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Erro ao enviar mídia manual (Atendimento ID: {atendimento_id}): {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))
    finally:
        await file.close()


# Busca a lista de templates ativos da Meta associados à conta da empresa
@router.get("/whatsapp/templates", response_model=List[Dict[str, Any]])
async def get_whatsapp_templates(
    current_user: models.User = Depends(dependencies.get_current_active_user),
    whatsapp_service: WhatsAppService = Depends(get_whatsapp_service)
):
    """
    Busca e retorna a lista de templates de mensagem aprovados ('ACTIVE')
    da conta do WhatsApp Business associada ao usuário.
    """
    try:
        return await whatsapp_service.get_whatsapp_templates(
            company=current_user.company
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Erro ao buscar templates para empresa do usuário {current_user.id}: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))


# Cria um novo template de mensagem diretamente na plataforma da Meta
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
    try:
        payload = json.loads(payload_json)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Payload JSON inválido: {e}")

    try:
        file_bytes = None
        filename = None
        mimetype = None
        if file:
            file_bytes = await file.read()
            filename = file.filename
            mimetype = file.content_type

        return await whatsapp_service.create_whatsapp_template(
            company=current_user.company,
            payload=payload,
            file_bytes=file_bytes,
            filename=filename,
            mimetype=mimetype
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Erro ao criar template para empresa do usuário {current_user.id}: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))
    finally:
        if file:
            await file.close()


# Exclui um template de mensagem existente na plataforma da Meta
@router.delete("/whatsapp/templates/{template_name}", summary="Excluir template na Meta")
async def delete_whatsapp_template(
    template_name: str,
    template_id: Optional[str] = Query(None),
    current_user: models.User = Depends(dependencies.get_current_active_user),
    whatsapp_service: WhatsAppService = Depends(get_whatsapp_service)
):
    """
    Exclui um template diretamente na conta do WhatsApp Business vinculada ao usuário.
    Tenta excluir pelo ID (se fornecido) ou pelo nome.
    """
    try:
        await whatsapp_service.delete_whatsapp_template(
            company=current_user.company,
            template_name=template_name,
            template_id=template_id
        )
        return {"message": f"Template '{template_name}' excluído com sucesso."}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Erro ao excluir template '{template_name}': {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))


# Proxy seguro para baixar arquivos de mídia recebidos da Meta
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
    company_id = current_user.company_id or 0
    try:
        media_bytes, content_type, filename = await whatsapp_service.download_media_directly(
            db=db,
            company_id=company_id,
            atendimento_id=atendimento_id,
            media_id=media_id
        )
        
        headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
        return Response(content=media_bytes, media_type=content_type, headers=headers)
        
    except AtendimentoNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.error(f"Erro inesperado ao processar mídia {media_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro interno ao processar mídia: {str(e)}")


# Envia uma mensagem baseada em template oficial da Meta com suporte a variáveis
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
        payload = schemas.SendTemplatePayload(**payload_dict)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Payload JSON inválido: {e}")

    company_id = current_user.company_id or 0
    try:
        file_bytes = None
        filename = None
        mimetype = None
        if file:
            file_bytes = await file.read()
            filename = file.filename
            mimetype = file.content_type

        return await whatsapp_service.send_template_message_with_history(
            db=db,
            company=current_user.company,
            company_id=company_id,
            atendimento_id=atendimento_id,
            payload=payload,
            file_bytes=file_bytes,
            filename=filename,
            mimetype=mimetype
        )
    except AtendimentoNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Erro ao enviar template (Atendimento ID: {atendimento_id}): {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))
    finally:
        if file:
            await file.close()


# Cria disparos de mensagens em massa (fila) a partir de CSV ou lista de IDs
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
    company_id = current_user.company_id or 0
    try:
        file_content = None
        if file:
            content = await file.read()
            file_content = content.decode('utf-8')

        media_file_bytes = None
        media_filename = None
        media_mimetype = None
        if media_file:
            media_file_bytes = await media_file.read()
            media_filename = media_file.filename
            media_mimetype = media_file.content_type

        return await AtendimentoService.create_bulk_disparos(
            db=db,
            company=current_user.company,
            company_id=company_id,
            file_content=file_content,
            atendimento_ids_str=atendimento_ids,
            media_file_bytes=media_file_bytes,
            media_filename=media_filename,
            media_mimetype=media_mimetype,
            template_name=template_name,
            persona_id=persona_id,
            observacoes=observacoes,
            template_params_str=template_params,
            whatsapp_service=whatsapp_service
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Erro ao processar disparo em massa: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if file:
            await file.close()
        if media_file:
            await media_file.close()


# Analisa a conversa e o feedback com IA (Gemini) para sugerir melhorias
@router.post("/{atendimento_id}/analyze_feedback", summary="Analisar atendimento via IA para melhoria de prompt")
async def analyze_feedback(
    atendimento_id: int,
    payload: schemas.FeedbackAnalysisPayload = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user),
    gemini_service: GeminiService = Depends(get_gemini_service)
):
    """
    Analisa a conversa atual e o feedback fornecido para sugerir melhorias no prompt da persona.
    """
    company_id = current_user.company_id or 0
    try:
        return await ConfigService.analyze_atendimento_feedback(
            db=db,
            user=current_user,
            company_id=company_id,
            atendimento_id=atendimento_id,
            feedback=payload.feedback,
            gemini_service=gemini_service
        )
    except AtendimentoNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Erro na análise de feedback (Atendimento ID: {atendimento_id}): {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# Aplica as sugestões da IA (planilhas de sistema, RAG e fluxos) na persona
@router.post("/{atendimento_id}/apply_feedback", summary="Aplicar sugestões na Persona (Sistema, RAG e Fluxo)")
async def apply_feedback(
    atendimento_id: int,
    payload: schemas.ApplyFeedbackPayload = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Aplica as modificações sugeridas na planilha de sistema, planilha RAG ou fluxo visual.
    """
    company_id = current_user.company_id or 0
    try:
        return await ConfigService.apply_atendimento_feedback(
            db=db,
            company_id=company_id,
            atendimento_id=atendimento_id,
            payload=payload
        )
    except AtendimentoNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Erro ao aplicar feedback (Atendimento ID: {atendimento_id}): {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))