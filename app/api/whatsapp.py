import logging
from fastapi import APIRouter, Depends, HTTPException, Body, Response
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Dict, Any

from app.api import dependencies
from app.db.database import get_db
from app.db import models
from app.db.schemas import UserUpdate
from app.crud import crud_user
from app.services.whatsapp_service import WhatsAppService, get_whatsapp_service
from app.services.security import encrypt_token, decrypt_token # encrypt_token não é mais usado aqui, mas pode ser útil em outro lugar
from app.core.config import settings # Para pegar URL base e Verify Token

router = APIRouter()
logger = logging.getLogger(__name__)


# --- ROTA UNIFICADA PARA SALVAR CONFIGURAÇÃO INICIAL (ID DO NÚMERO OU INSTANCE NAME) ---
@router.post("/connection-info", summary="Salvar tipo de API e identificador principal", response_model=Dict[str, Any])
async def save_connection_info(
    payload: Dict[str, Any] = Body(...), # Recebe api_type e (instance_name OU wbp_phone_number_id)
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """
    Salva o tipo de API escolhido pelo administrador e o identificador principal (Nome da Instância ou ID do Número).
    Limpa os campos da API *não* selecionada.
    """
    api_type_str = payload.get("api_type") # Recebe o tipo desejado (definido no BD)
    instance_name = payload.get("instance_name") # Pode vir do frontend se for Evolution
    wbp_phone_number_id = payload.get("wbp_phone_number_id") # Pode vir do frontend se for Oficial

    if not api_type_str or api_type_str not in ["evolution", "official"]:
        # Se o tipo não foi enviado ou é inválido, busca o tipo atual do usuário no BD
        api_type_str = current_user.api_type.value if current_user.api_type else None
        if not api_type_str:
            raise HTTPException(status_code=400, detail="Tipo de API não definido para o usuário e não fornecido.")

    api_type_enum = models.ApiType(api_type_str)
    update_data = {"api_type": api_type_enum}
    original_api_type = current_user.api_type

    if api_type_enum == models.ApiType.evolution:
        if not instance_name or not isinstance(instance_name, str) or len(instance_name.strip()) < 3 or ' ' in instance_name.strip():
            raise HTTPException(status_code=400, detail="Nome da Instância inválido (mín 3 caracteres, sem espaços).")
        update_data["instance_name"] = instance_name.strip()
        # Limpa campos da API Oficial SE ESTAVA usando Oficial antes E MUDOU agora para Evolution
        if original_api_type == models.ApiType.official:
            update_data["wbp_phone_number_id"] = None
            update_data["wbp_access_token"] = None
            logger.info(f"Limpando config Oficial ao mudar para Evolution para user {current_user.id}")

    elif api_type_enum == models.ApiType.official:
        if not wbp_phone_number_id or not isinstance(wbp_phone_number_id, str) or not wbp_phone_number_id.strip().isdigit():
            raise HTTPException(status_code=400, detail="ID do Número de Telefone inválido (apenas números).")
        update_data["wbp_phone_number_id"] = wbp_phone_number_id.strip()
        # Limpa campos da Evolution SE ESTAVA usando Evolution antes E MUDOU agora para Oficial
        if original_api_type == models.ApiType.evolution:
            update_data["instance_name"] = None
            update_data["instance_id"] = None
            logger.info(f"Limpando config Evolution ao mudar para Oficial para user {current_user.id}")
        # Não mexe no wbp_access_token aqui, pois ele é configurado via BD/env

    try:
        user_update_schema = UserUpdate(**update_data)
        updated_user_obj = await crud_user.update_user(db, db_user=current_user, user_in=user_update_schema)
        db.add(updated_user_obj)
        await db.commit()
        await db.refresh(updated_user_obj)
        logger.info(f"Identificador principal ({'instance_name' if api_type_enum == models.ApiType.evolution else 'wbp_phone_number_id'}) atualizado para user {current_user.id}. Tipo API: {api_type_str}")

        # Retorna os dados atualizados relevantes
        return {
            "api_type": updated_user_obj.api_type.value if updated_user_obj.api_type else None, # Trata caso api_type seja None
            "instance_name": updated_user_obj.instance_name,
            "wbp_phone_number_id": updated_user_obj.wbp_phone_number_id,
            "wbp_access_token_saved": bool(updated_user_obj.wbp_access_token) # Informa se token existe (configurado via BD)
        }
    except Exception as e:
        await db.rollback()
        logger.error(f"Erro ao salvar informações de conexão para user {current_user.id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Erro interno ao salvar configuração de conexão.")


# --- ROTA UNIFICADA DE STATUS ---
@router.get("/status", summary="Verificar status da conexão WhatsApp (Evolution ou Oficial)")
async def get_status(
    current_user: models.User = Depends(dependencies.get_current_active_user),
    whatsapp_service: WhatsAppService = Depends(get_whatsapp_service),
):
    if not current_user.api_type:
        logger.warning(f"Usuário {current_user.id} sem api_type definido.")
        return {"status": "not_configured", "detail": "Tipo de API não definido.", "api_type": None}

    if current_user.api_type == models.ApiType.evolution:
        if not current_user.instance_name:
            return {"status": "no_instance_name", "api_type": "evolution"}

        # --- CORREÇÃO: Adicionar parênteses e argumento ---
        return await whatsapp_service.get_connection_status_evolution(current_user.instance_name)
        # --- FIM DA CORREÇÃO ---

    elif current_user.api_type == models.ApiType.official:
        is_configured = bool(current_user.wbp_phone_number_id and current_user.wbp_access_token)
        return {
            "status": "configured" if is_configured else "not_configured",
            "wbp_phone_number_id": current_user.wbp_phone_number_id,
            "wbp_access_token_saved": bool(current_user.wbp_access_token),
            "api_type": "official"
        }
    else:
        logger.error(f"Tipo de API desconhecido ({current_user.api_type}) encontrado para usuário {current_user.id}")
        api_type_value = current_user.api_type.value if hasattr(current_user.api_type, 'value') else str(current_user.api_type)
        return {"status": "error", "detail": f"Tipo de API desconhecido: {api_type_value}", "api_type": api_type_value}


# --- ROTAS ESPECÍFICAS DA EVOLUTION API ---

@router.get("/connect", summary="[Evolution] Obter QR Code ou reconectar instância")
async def connect_evolution(
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user),
    whatsapp_service: WhatsAppService = Depends(get_whatsapp_service),
):
    if current_user.api_type != models.ApiType.evolution:
        raise HTTPException(status_code=400, detail="Operação apenas para Evolution API.")
    if not current_user.instance_name:
        raise HTTPException(status_code=400, detail="Nome da Instância Evolution não configurado.")

    logger.info(f"Conexão Evolution para: {current_user.email} (Inst: {current_user.instance_name})")

    # --- CORREÇÃO: Nome do método ---
    result = await whatsapp_service.create_and_connect_instance_evolution(current_user.instance_name)
    # --- FIM DA CORREÇÃO ---

    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result.get("detail", "Erro desconhecido ao conectar Evolution."))

    instance_data = result.get("instance")
    if result.get("status") == "qrcode" and instance_data:
        instance_id_from_api = instance_data.get("instanceId") or instance_data.get("id")
        if instance_id_from_api and instance_id_from_api != current_user.instance_id:
            logger.info(f"Atualizando instance_id (Evo) para user {current_user.id}: '{instance_id_from_api}'")
            try:
                update_payload = {"instance_id": instance_id_from_api}
                user_update = UserUpdate(**update_payload)
                updated_user_obj = await crud_user.update_user(db, db_user=current_user, user_in=user_update)
                db.add(updated_user_obj)
                await db.commit()
                await db.refresh(updated_user_obj)
            except Exception as e:
                await db.rollback()
                logger.error(f"Erro ao salvar instance_id (Evo) para user {current_user.id}: {e}", exc_info=True)
        elif not instance_id_from_api:
             logger.warning(f"Não foi possível encontrar 'id' ou 'instanceId' nos dados da instância para '{current_user.instance_name}'. Resposta: {instance_data}")

    return result

@router.post("/disconnect", summary="[Evolution] Desconectar instância Evolution")
async def disconnect_evolution(
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(dependencies.get_current_active_user),
    whatsapp_service: WhatsAppService = Depends(get_whatsapp_service),
):
    if current_user.api_type != models.ApiType.evolution:
        raise HTTPException(status_code=400, detail="Operação apenas para Evolution API.")
    if not current_user.instance_name:
        raise HTTPException(status_code=400, detail="Nome da Instância Evolution não configurado.")

    logger.info(f"Desconexão Evolution para: {current_user.email} (Inst: {current_user.instance_name})")

    # --- CORREÇÃO: Nome do método ---
    result = await whatsapp_service.disconnect_instance_evolution(current_user.instance_name)
    # --- FIM DA CORREÇÃO ---

    if current_user.instance_id:
        logger.info(f"Limpando instance_id (Evo) para user {current_user.id}")
        try:
            update_payload = {"instance_id": None}
            user_update = UserUpdate(**update_payload)
            updated_user_obj = await crud_user.update_user(db, db_user=current_user, user_in=user_update)
            db.add(updated_user_obj)
            await db.commit()
            await db.refresh(updated_user_obj)
        except Exception as e:
            await db.rollback()
            logger.error(f"Erro ao limpar instance_id (Evo) local para user {current_user.id}: {e}", exc_info=True)

    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result.get("detail", "Erro ao desconectar instância na API Evolution."))

    return result


# --- ROTAS ESPECÍFICAS DA API OFICIAL ---

@router.get("/official/config-info", summary="[Oficial] Obter informações para configurar o webhook na Meta")
async def get_official_config_info(
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    """Retorna a URL de Callback (lida do .env) e o Token de Verificação para usar no painel da Meta."""
    callback_url = settings.WBP_WEBHOOK_URL
    if not callback_url:
        logger.error("Variável de ambiente WBP_WEBHOOK_URL não está definida!")
        raise HTTPException(status_code=500, detail="Configuração interna do servidor incompleta (WBP_WEBHOOK_URL).")

    verify_token = settings.WBP_VERIFY_TOKEN
    if not verify_token:
        logger.error("Variável de ambiente WBP_VERIFY_TOKEN não está definida!")
        raise HTTPException(status_code=500, detail="Configuração interna do servidor incompleta (WBP_VERIFY_TOKEN).")

    return {
        "wbp_webhook_url": callback_url,
        "wbp_verify_token": verify_token
    }
