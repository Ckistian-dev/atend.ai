from google import genai
from google.genai import types
import logging
import json
import asyncio
import pytz
import re
import os
from typing import Optional, List, Dict, Any
from collections.abc import Set
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, inspect


from app.core.config import settings
from app.db import models
from app.crud import crud_user, crud_atendimento
from app.services.google_calendar_service import get_google_calendar_service

logger = logging.getLogger(__name__)

class SetEncoder(json.JSONEncoder):
    """Codificador JSON para lidar com objetos 'set'."""
    def default(self, obj):
        if isinstance(obj, Set):
            return list(obj)
        return super().default(obj)

class GeminiService:
    def __init__(self):
        # Agora tem apenas uma chave
        keys_str = settings.GOOGLE_API_KEYS
        # Se contiver vírgula (antigo formato), pega apenas a primeira chave
        self.api_key = keys_str.split(",")[0].strip() if keys_str else ""

        if not self.api_key:
            logger.error("🚨 ERRO CRÍTICO: Chave de API do Google não configurada em GOOGLE_API_KEYS.")
            raise ValueError("A chave GOOGLE_API_KEYS não pode estar vazia.")
            
        # Carregar tabela de preços do arquivo models.json
        self.model_pricing = {}
        try:
            current_dir = os.path.dirname(os.path.abspath(__file__))
            models_json_path = os.path.normpath(os.path.join(current_dir, "../constants/models.json"))
            
            with open(models_json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                
            models_data = data.get("LLM_MODELS", [])
            if models_data:
                # O usuário quer que use a base 0.25 por milhão
                base_flash = 0.25
                for model in models_data:
                    m_id = model["id"]
                    pricing = model.get("pricing", {})
                    
                    self.model_pricing[m_id] = {
                        "input_text": pricing.get("input_text", 0.25) / base_flash,
                        "input_audio": pricing.get("input_audio", 0.50) / base_flash,
                        "output": pricing.get("output", 1.50) / base_flash
                    }
                logger.info(f"✅ Tabela de preços carregada de models.json: {len(self.model_pricing)} modelos (base: {base_flash}).")
            else:
                raise ValueError("Array LLM_MODELS não encontrado em models.json")
        except Exception as e:
            logger.error(f"🚨 Erro ao ler tabela de preços do models.json: {e}")
            # Fallback seguro com base 0.25
            self.model_pricing = {
                "gemini-3.1-flash-lite": { "input_text": 0.25 / 0.25, "input_audio": 0.50 / 0.25, "output": 1.50 / 0.25 }
            }
        self._initialize_model()

    def _initialize_model(self):
        """Inicializa o cliente Gemini."""
        try:
            # Instanciação limpa: o SDK gerencia v1/v1beta automaticamente
            from google.genai._api_client import HttpOptions
            self.client = genai.Client(api_key=self.api_key, http_options=HttpOptions(timeout=120000))
            
            logger.info("✅ Cliente Gemini inicializado com a chave única.")
        except Exception as e:
            logger.error(f"🚨 ERRO CRÍTICO ao configurar o Gemini: {e}")
            raise

    def _parse_json_response(self, response_text: str) -> dict:
        """Limpa e parseia JSON da resposta da IA, com tratamento de erros de escape."""
        clean_response = response_text.strip().replace("```json", "").replace("```", "")
        
        try:
            return json.loads(clean_response)
        except json.JSONDecodeError:
            # Tenta corrigir backslashes soltos (comum em caminhos de arquivo ou LaTeX)
            # Regex: Backslash não seguido de escape válido -> Dobra o backslash
            try:
                fixed_response = re.sub(r'\\(?![/\"\\bfnrtu])', r'\\\\', clean_response)
                return json.loads(fixed_response)
            except json.JSONDecodeError:
                raise

    async def _generate_with_retry(
        self, 
        prompt: Any, 
        db: AsyncSession, 
        company: models.Company, 
        is_media: bool = False,
        media_type: str = "text",
        system_instruction: Optional[str] = None,
        atendimento_id: Optional[int] = None,
        persona: Optional[models.Config] = None
    ):
        """
        Executa a chamada para a API Gemini (Novo SDK), deduz token e rotaciona chaves.
        """
        
        # Busca configurações da persona ou usa defaults
        model_name = persona.ai_model if persona and persona.ai_model else "gemini-3.1-flash-lite"
        temp = persona.temperature if persona and persona.temperature is not None else 0.5
        top_p = persona.top_p if persona and persona.top_p is not None else 0.95
        top_k = persona.top_k if persona and persona.top_k is not None else 40

        config_args = {
            "temperature": temp,
            "top_p": top_p,
            "top_k": top_k,
        }

        # Configuração do processo de pensamento (Thinking Config)
        is_gemini_3_or_newer = "gemini-3" in model_name or re.search(r"\b(gemini-)[3-9]\b", model_name)
        is_gemini_2_5 = "gemini-2.5" in model_name

        if is_gemini_3_or_newer:
            thinking_level = getattr(persona, "thinking_level", "medium") if persona else "medium"
            if isinstance(thinking_level, str):
                thinking_level = thinking_level.strip("'\"").strip().lower()
            if thinking_level and thinking_level not in ("default", "none", "null", ""):
                try:
                    config_args["thinking_config"] = types.ThinkingConfig(
                        thinking_level=thinking_level.upper()
                    )
                except Exception as te:
                    logger.warning(f"Erro ao instanciar ThinkingConfig com thinking_level={thinking_level}: {te}")
        elif is_gemini_2_5:
            thinking_budget = getattr(persona, "thinking_budget", 1024) if persona else 1024
            if thinking_budget is not None:
                try:
                    config_args["thinking_config"] = types.ThinkingConfig(
                        thinking_budget=thinking_budget
                    )
                except Exception as te:
                    logger.warning(f"Erro ao instanciar ThinkingConfig com thinking_budget={thinking_budget}: {te}")

        if not is_media and isinstance(prompt, str):
            logger.debug(f"Prompt (texto) para a IA: {prompt[:500]}...")
            # No novo SDK, response_mime_type entra na config
            config_args["response_mime_type"] = "application/json"

        # Adiciona system_instruction se fornecido
        if system_instruction:
            config_args["system_instruction"] = system_instruction

        # Cria o objeto de configuração tipado
        gen_config = types.GenerateContentConfig(**config_args)


        # --- DEBUG: PRINT PROMPT ---
        try:
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            at_str = f" ATENDIMENTO {atendimento_id}" if atendimento_id else ""
            debug_msg = f"\n{'='*20} PROMPT ENVIADO PARA IA{at_str} [{timestamp}] {'='*20}\n"
            
            if system_instruction:
                debug_msg += f"--- SYSTEM INSTRUCTION ---\n{system_instruction}\n{'-'*30}\n"

            if isinstance(prompt, str):
                debug_msg += f"{prompt}\n"
            elif isinstance(prompt, list):
                for p in prompt:
                    if isinstance(p, str):
                        debug_msg += f"[TEXTO]: {p}\n"
                    else:
                        debug_msg += f"[MÍDIA/OBJETO]: {type(p)}\n"
            debug_msg += f"{'='*60}\n"
            
            # Salva o prompt em arquivo (append/log)
            with open("last_prompt.txt", "a", encoding="utf-8") as f:
                f.write(debug_msg)
        except Exception as e:
            print(f"Erro ao printar/salvar prompt: {e}")

        max_attempts = 3
        
        for attempt in range(max_attempts):
            try:
                logger.info(
                    f"Tentando gerar conteúdo (tentativa {attempt + 1}/{max_attempts})."
                )
                
                # --- MUDANÇA PRINCIPAL: Chamada Assíncrona Nativa (.aio) ---
                # Timeout de 300s via asyncio — acomoda modelos mais lentos/poderosos
                response = await asyncio.wait_for(
                    self.client.aio.models.generate_content(
                        model=model_name,
                        contents=prompt,
                        config=gen_config
                    ),
                    timeout=300.0
                )
                
                # --- DEBUG: LOG RESPONSE ---
                try:
                    timestamp_resp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    resp_msg = f"\n{'='*20} RESPOSTA DA IA [{timestamp_resp}] {'='*20}\n"
                    resp_msg += f"{response.text}\n"
                    resp_msg += f"{'='*60}\n"
                    
                    with open("last_prompt.txt", "a", encoding="utf-8") as f:
                        f.write(resp_msg)
                except Exception as e:
                    print(f"Erro ao salvar resposta no log: {e}")

                # --- LÓGICA DE TOKEN (ODÔMETRO) ---
                # Extrai o uso real de tokens da resposta do Gemini, incluindo tokens de pensamento (thinking)
                usage_metadata = response.usage_metadata
                tokens_to_deduct = 0 # Inicializa com 0

                if usage_metadata:
                    input_tokens = usage_metadata.prompt_token_count or 0
                    candidates_tokens = usage_metadata.candidates_token_count or 0
                    thoughts_tokens = getattr(usage_metadata, "thoughts_token_count", 0) or 0
                    output_tokens = candidates_tokens + thoughts_tokens
                    
                    # Recupera multiplicadores para o modelo usado
                    pricing = self.model_pricing.get(model_name, self.model_pricing.get("gemini-3.1-flash-lite", {"input_text": 1.0, "input_audio": 2.0, "output": 6.0}))
                    
                    # Determina se é áudio ou texto
                    input_multiplier = pricing.get("input_audio", pricing.get("input_text", 1.2)) if media_type == "audio" else pricing.get("input_text", 1.2)
                    output_multiplier = pricing.get("output", 6.0)
                    
                    # Calcula o custo equivalente em "tokens de input do Gemini 2.5 Flash"
                    equivalent_total_tokens = (input_tokens * input_multiplier) + (output_tokens * output_multiplier)
                    
                    # Arredonda para o inteiro mais próximo para dedução
                    tokens_to_deduct = round(equivalent_total_tokens)

                    logger.info(
                        f"Uso de tokens (Company {company.id}, Model {model_name}): "
                        f"Input={input_tokens}, Output={output_tokens} (Candidates={candidates_tokens}, Thoughts={thoughts_tokens}). "
                        f"Custo Equivalente = {tokens_to_deduct} tokens."
                    )
                else:
                    logger.warning(f"Não foi possível obter metadados de uso de tokens para a empresa {company.id}.")

                try:
                    if tokens_to_deduct > 0:
                        logger.info(f"Sucesso na chamada à API Gemini para a empresa {company.id}. Deduzindo {tokens_to_deduct} tokens.")
                        await crud_user.decrement_company_tokens(
                            db,
                            db_company=company,
                            usage=tokens_to_deduct,
                            atendimento_id=atendimento_id,
                            token_type="gemini_inference"
                        )
                        if db.in_nested_transaction():
                            await db.flush()
                        else:
                            await db.commit()
                            await db.refresh(company)
                except Exception as token_err:
                    logger.error(f"Falha ao deduzir tokens da empresa: {token_err}", exc_info=True)
                    if db.in_nested_transaction():
                        # Rolls back the savepoint only
                        await db.rollback()
                    else:
                        await db.rollback()
                
                return response

            # Captura erros
            except asyncio.TimeoutError:
                logger.error(
                    f"Timeout na chamada Gemini (tentativa {attempt + 1}/{max_attempts}). Tentando novamente..."
                )
                await asyncio.sleep(2)
            except Exception as e:
                error_str = str(e).lower()
                
                # Se for erro de parâmetro não suportado devido a thinking_config
                if ("thinking" in error_str or "parameter" in error_str or "unsupported" in error_str) and "thinking_config" in config_args:
                    logger.warning(f"O modelo {model_name} não suporta a configuração de pensamento (thinking_config). Removendo parâmetro e tentando novamente...")
                    config_args.pop("thinking_config", None)
                    gen_config = types.GenerateContentConfig(**config_args)
                    continue
                
                # Detecção de bloqueio de segurança ou prompt inválido
                if "blocked" in error_str or "invalid argument" in error_str:
                    logger.error(f"Erro não recuperável (Bloqueio/Inválido): {e}")
                    raise e
                
                # Erros genéricos de conexão/servidor/quota
                logger.error(f"Erro inesperado na API Gemini: {e}. Tentativa {attempt + 1}/{max_attempts}.")
                if attempt == max_attempts - 1:
                    raise e
                await asyncio.sleep(2)

    async def transcribe_and_analyze_media(
        self, 
        media_data: dict,  # Espera receber: {"data": bytes, "mime_type": str}
        db_history: List[dict], 
        persona: models.Config,
        db: AsyncSession,
        company: models.Company,
        atendimento_id: Optional[int] = None
    ) -> str:
        logger.info(f"Iniciando transcrição/análise para mídia do tipo {media_data.get('mime_type')}")
        
        # --- 1. PREPARAÇÃO DA MÍDIA PARA O NOVO SDK ---
        try:
            file_bytes = media_data.get("data")
            mime_type = media_data.get("mime_type")

            if not file_bytes:
                raise ValueError("Bytes do arquivo não encontrados in media_data")

            # Cria o objeto Part nativo do novo SDK
            # Isso substitui a lógica antiga de upload ou passagem de objetos complexos
            media_part = types.Part.from_bytes(
                data=file_bytes, 
                mime_type=mime_type
            )
        except Exception as e:
            logger.error(f"Erro ao preparar objeto de mídia para o Gemini: {e}")
            return "[Erro interno ao processar o arquivo de mídia]"

        # --- 2. MONTAGEM DO PROMPT (Lista de conteúdos) ---
        prompt_contents = []
        system_instruction = None
        
        # Lógica para Áudio (Transcrição)
        if 'audio' in mime_type or 'mpeg' in mime_type or 'ogg' in mime_type:
            system_instruction = "Sua única tarefa é transcrever o áudio a seguir. Retorne apenas o texto transcrito, sem adicionar nenhuma outra palavra, introdução ou formatação."
            prompt_contents = ["## TAREFA\nTranscreva o áudio.", media_part]
            
        # Lógica para Imagem/Documento (Análise Visual)
        else:
            system_instruction = (
                "Você é um especialista em análise visual e interpretação de conteúdo.\n\n"
                "## INSTRUÇÃO DE ANÁLISE\n"
                "Analise a mídia fornecida e descreva seu conteúdo de forma abrangente e detalhada. Capture todos os aspectos importantes para que a IA de conversação compreenda o contexto completo.\n\n"
                "1. *Descrição Geral:* Inicie com uma descrição global do que a mídia apresenta.\n"
                "2. *Detalhes Visuais:* Descreva elementos principais, cores, ambiente, pessoas, objetos, texto visível e detalhes pertinentes ao contexto da conversa.\n"
                "3. *Extração de Dados:* Extraia dados estruturados como nomes, endereços, datas e valores. **Caso existam tabelas ou listas de preços, utilize estritamente a sintaxe de tabela Markdown (| Categoria | Valor |).**\n"
                "4. *Contexto e Intenção:* Infira a intenção do usuário ao enviar a mídia com base no histórico.\n"
                "5. *Formato da Resposta:* Forneça um texto claro e bem estruturado. Utilize marcadores para listas. Proibido dialogar, forneça apenas a análise."
            )
            
            history_str = self._format_history_optimized(db_history, include_timestamps=True)
            prompt_text = f"## HISTÓRICO RECENTE\n{history_str}\n\n## TAREFA\nAnalise a mídia enviada."
            
            # Ordem: Prompt de texto primeiro, Mídia depois (ou vice-versa, Gemini entende ambos)
            prompt_contents = [prompt_text, media_part]

        # --- 3. CHAMADA À API ---
        media_type_arg = "audio" if ('audio' in mime_type or 'mpeg' in mime_type or 'ogg' in mime_type) else "image"
        
        try:
            # Passamos a lista (texto + mídia) para o método que criamos anteriormente
            # O _generate_with_retry já está preparado para receber 'prompt' como string OU lista
            response = await self._generate_with_retry(
                prompt_contents, db, company, is_media=True, media_type=media_type_arg, 
                system_instruction=system_instruction, atendimento_id=atendimento_id, persona=persona
            )
            
            transcription = response.text.strip()
            logger.info(f"Transcrição/Análise gerada: '{transcription[:100]}...'")
            return transcription
            
        except Exception as e:
            logger.error(f"Erro ao transcrever/analisar mídia com Gemini: {e}", exc_info=True)
            return f"[Erro ao processar mídia: {mime_type}]"

    async def generate_tts(
        self, 
        text: str, 
        db: AsyncSession, 
        company: models.Company, 
        voice_name: Optional[str] = None,
        atendimento_id: Optional[int] = None
    ) -> bytes:
        """
        Gera áudio (WAV) a partir de um texto usando Gemini 3.1 Flash TTS.
        """
        from google.genai import types
        import io
        import wave

        # Carrega dinamicamente a voz da persona/empresa se não fornecida diretamente
        if not voice_name and db and atendimento_id:
            try:
                from sqlalchemy.orm import joinedload
                result = await db.execute(
                    select(models.Atendimento)
                    .filter(models.Atendimento.id == atendimento_id)
                    .options(joinedload(models.Atendimento.active_persona))
                )
                atendimento = result.scalars().first()
                persona = None
                if atendimento:
                    persona = atendimento.active_persona
                    if not persona and company.default_persona_id:
                        persona = await db.get(models.Config, company.default_persona_id)
                if persona and persona.tts_voice:
                    voice_name = persona.tts_voice
            except Exception as e:
                logger.warning(f"Erro ao buscar voz da persona no banco de dados para atendimento {atendimento_id}: {e}")

        voice_name = voice_name or "Aoede"
        logger.info(f"Gerando áudio via Gemini (voz: {voice_name}) para o texto: {text[:100]}...")

        # Configuramos o request para saída em áudio
        config = types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name=voice_name
                    )
                )
            )
        )

        try:
            # Faz a chamada para a API do Gemini
            # Usando gemini-3.1-flash-tts-preview para geração do áudio (multimodal)
            response = await asyncio.wait_for(
                self.client.aio.models.generate_content(
                    model="gemini-3.1-flash-tts-preview",
                    contents=text,
                    config=config
                ),
                timeout=120.0
            )

            # Extrai os bytes de áudio brutos (geralmente PCM)
            part = response.candidates[0].content.parts[0]
            raw_pcm = part.inline_data.data

        except (AttributeError, IndexError, KeyError, asyncio.TimeoutError) as e:
            logger.error(f"Erro ao obter resposta ou dados de áudio do Gemini TTS: {e}")
            raise ValueError("Falha ao gerar áudio a partir do texto no Gemini.")

        # --- LÓGICA DE DEDUÇÃO DE TOKENS DO TTS ---
        usage_metadata = response.usage_metadata
        if usage_metadata:
            input_tokens = usage_metadata.prompt_token_count or 0
            candidates_tokens = usage_metadata.candidates_token_count or 0
            thoughts_tokens = getattr(usage_metadata, "thoughts_token_count", 0) or 0
            output_tokens = candidates_tokens + thoughts_tokens

            # Preço do gemini-3.1-flash-tts-preview carregado dinamicamente ou fallback seguro
            pricing = self.model_pricing.get("gemini-3.1-flash-tts-preview", {"input_text": 1.0, "input_audio": 2.0, "output": 6.0})
            input_multiplier = pricing.get("input_text", 1.0)
            output_multiplier = pricing.get("output", 6.0)

            equivalent_total_tokens = (input_tokens * input_multiplier) + (output_tokens * output_multiplier)
            tokens_to_deduct = round(equivalent_total_tokens)

            try:
                if tokens_to_deduct > 0:
                    logger.info(f"Dedução TTS (Atend: {atendimento_id}): Consumo={tokens_to_deduct} tokens.")
                    await crud_user.decrement_company_tokens(
                        db,
                        db_company=company,
                        usage=tokens_to_deduct,
                        atendimento_id=atendimento_id,
                        token_type="gemini_tts"
                    )
                    if db.in_nested_transaction():
                        await db.flush()
                    else:
                        await db.commit()
                        await db.refresh(company)
            except Exception as token_err:
                logger.error(f"Falha ao deduzir tokens de TTS da empresa: {token_err}", exc_info=True)
                await db.rollback()

        # O Gemini retorna PCM bruto (24kHz, 16-bit, mono).
        # Vamos empacotar como WAV para ser um arquivo de áudio padrão reproduzível.
        wav_io = io.BytesIO()
        with wave.open(wav_io, "wb") as wf:
            wf.setnchannels(1)       # Mono
            wf.setsampwidth(2)      # 16-bit (2 bytes)
            wf.setframerate(24000)   # 24kHz
            wf.writeframes(raw_pcm)

        return wav_io.getvalue()

    async def generate_embedding(self, text: str) -> List[float]:
        """
        Gera embedding usando o modelo gemini-embedding-001.
        Força 768 dimensões para compatibilidade e eficiência.
        """
        max_attempts = 3
        
        embed_config = types.EmbedContentConfig(
            task_type="RETRIEVAL_QUERY",
            output_dimensionality=768
        )

        for attempt in range(max_attempts):
            try:
                response = await self.client.aio.models.embed_content(
                    model="gemini-embedding-001",
                    contents=text,
                    config=embed_config
                )
                if response.embeddings:
                    return response.embeddings[0].values
                return []
            except Exception as e:
                error_str = str(e).lower()
                if "blocked" in error_str or "invalid argument" in error_str:
                    logger.error(f"Erro não recuperável na geração de embedding (bloqueio/argumento): {e}")
                    return []
                logger.error(f"Erro na geração de embedding: {e}. Tentativa {attempt + 1}/{max_attempts}.")
                if attempt == max_attempts - 1:
                    logger.error(f"Erro final não recuperável na geração de embedding: {e}")
                    return []
                await asyncio.sleep(2)

    async def generate_embeddings_batch(self, texts: List[str], batch_size: int = 100) -> List[List[float]]:
        """
        Gera embeddings em lote usando gemini-embedding-001 com 768 dimensões.
        """
        all_embeddings = []
        
        # Configuração com tipo de tarefa de documento (otimizado para RAG)
        embed_config = types.EmbedContentConfig(
            task_type="RETRIEVAL_DOCUMENT",
            output_dimensionality=768
        )

        # O novo SDK aceita listas nativamente no parâmetro 'contents'.
        # Mantemos o particionamento (batch) para evitar limites de payload muito grandes na API.
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            max_attempts = 3
            success = False
            batch_embeddings = []

            for attempt in range(max_attempts):
                try:
                    response = await self.client.aio.models.embed_content(
                        model="gemini-embedding-001",
                        contents=batch,
                        config=embed_config
                    )
                    if response.embeddings:
                        batch_embeddings = [e.values for e in response.embeddings]
                    else:
                        logger.warning(f"Batch {i} retornou sem embeddings.")
                        batch_embeddings = [[] for _ in batch]
                    success = True
                    break
                except Exception as e:
                    error_str = str(e).lower()
                    if "blocked" in error_str or "invalid argument" in error_str:
                        logger.error(f"Erro não recuperável na geração de batch embeddings (bloqueio/argumento): {e}")
                        batch_embeddings = [[] for _ in batch]
                        success = True
                        break
                    logger.error(f"Erro na geração de batch embeddings: {e}. Tentativa {attempt + 1}/{max_attempts}.")
                    if attempt == max_attempts - 1:
                        batch_embeddings = [[] for _ in batch]
                    await asyncio.sleep(2)

            all_embeddings.extend(batch_embeddings)
        
        return all_embeddings


    async def _retrieve_rag_context(
        self,
        db: AsyncSession,
        config_id: int,
        query_text: str,
        limit: int = 10,
        selected_sources: Optional[List[str]] = None
    ) -> str:
        """Busca contexto relevante na base vetorial (PGVector) usando similaridade de cosseno."""
        if not query_text: return ""
        
        # 1. Gera o embedding da pergunta do usuário
        query_embedding = await self.generate_embedding(query_text)
        
        if not query_embedding:
            logger.warning("Falha ao gerar embedding da query. Retornando vazio.")
            return ""
 
        # 2. Busca diversificada por Origem (Abas e Drive)
        # Identifica todas as origens distintas (ex: 'Preços', 'FAQ', 'drive') para este config
        stmt_origins = select(models.KnowledgeVector.origin).where(
            models.KnowledgeVector.config_id == config_id
        ).distinct()
        
        result_origins = await db.execute(stmt_origins)
        origins = result_origins.scalars().all()
        
        # Filtra por fontes selecionadas caso fornecidas
        if selected_sources:
            selected_set = {s.strip().lower() for s in selected_sources if s}
            origins = [o for o in origins if o.strip().lower() in selected_set]
            
        final_vectors = []
        
        # Para cada origem encontrada (cada aba e o drive), busca os 'limit' mais relevantes com threshold de distância
        for origin in origins:
            threshold = 0.65 if origin == "drive" else 0.70
            if origin == "drive":
                # Busca mais registros do Drive para permitir filtragem por tipo em python
                stmt_origin = select(models.KnowledgeVector).where(
                    models.KnowledgeVector.config_id == config_id,
                    models.KnowledgeVector.origin == origin,
                    models.KnowledgeVector.embedding.cosine_distance(query_embedding) < threshold
                ).order_by(
                    models.KnowledgeVector.embedding.cosine_distance(query_embedding)
                ).limit(100)
                
                result_origin = await db.execute(stmt_origin)
                vectors = result_origin.scalars().all()
                
                # Filtra limitando a no máximo 10 registros por tipo de arquivo
                by_type_counts = {}
                filtered_drive_vectors = []
                for v in vectors:
                    try:
                        from app.services.config_service import ConfigService
                        parsed = ConfigService.parse_drive_index(v.content)
                        file_type = parsed.get("TIPO", "OUTROS").strip().upper()
                    except Exception:
                        file_type = "OUTROS"
                    
                    if by_type_counts.get(file_type, 0) < 10:
                        filtered_drive_vectors.append(v)
                        by_type_counts[file_type] = by_type_counts.get(file_type, 0) + 1
                
                final_vectors.extend(filtered_drive_vectors)
            else:
                stmt_origin = select(models.KnowledgeVector).where(
                    models.KnowledgeVector.config_id == config_id,
                    models.KnowledgeVector.origin == origin,
                    models.KnowledgeVector.embedding.cosine_distance(query_embedding) < threshold
                ).order_by(
                    models.KnowledgeVector.embedding.cosine_distance(query_embedding)
                ).limit(limit)
                
                result_origin = await db.execute(stmt_origin)
                vectors = result_origin.scalars().all()
                final_vectors.extend(vectors)
        
        if not final_vectors: return ""
        
        # Extrai conteúdo e remove duplicatas
        chunks = [v.content for v in final_vectors]
        unique_chunks = list(dict.fromkeys(chunks))
        
        # Junta os chunks mantendo todas as linhas (não omitindo linhas de cabeçalho iguais entre chunks)
        formatted_text = "\n\n".join([chunk.strip() for chunk in unique_chunks])
        return formatted_text

    def _get_datetime_context(self, company: models.Company) -> str:
        """Gera o contexto de data e hora atual, incluindo dia da semana em PT-BR."""
        import pytz
        from datetime import datetime, timezone, timedelta
        now_utc = datetime.now(timezone.utc)
        
        user_timezone_str = "America/Sao_Paulo" # Default
        if company.followup_config and isinstance(company.followup_config, dict):
            user_timezone_str = company.followup_config.get("timezone", "America/Sao_Paulo")
        
        try:
            user_tz = pytz.timezone(user_timezone_str)
            now_local = now_utc.astimezone(user_tz)
        except Exception:
            try:
                user_tz = pytz.timezone("America/Sao_Paulo")
                now_local = now_utc.astimezone(user_tz)
            except Exception:
                now_local = now_utc
        
        weekdays = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado", "Domingo"]
        weekday_name = weekdays[now_local.weekday()]
        
        today_type = "Fim de semana" if now_local.weekday() in [5, 6] else "Dia útil"
        
        tomorrow_local = now_local + timedelta(days=1)
        tomorrow_weekday = weekdays[tomorrow_local.weekday()]
        tomorrow_type = "Fim de semana" if tomorrow_local.weekday() in [5, 6] else "Dia útil"
        
        day_after_local = now_local + timedelta(days=2)
        day_after_weekday = weekdays[day_after_local.weekday()]
        day_after_type = "Fim de semana" if day_after_local.weekday() in [5, 6] else "Dia útil"
        
        return (
            f"{weekday_name}, {now_local.strftime('%d/%m/%Y %H:%M:%S')} (Fuso: {user_timezone_str}) | "
            f"Hoje: {weekday_name} ({today_type}) | "
            f"Amanhã: {tomorrow_weekday} ({tomorrow_type}) | "
            f"Depois de amanhã: {day_after_weekday} ({day_after_type})"
        )

    def _format_history_optimized(self, db_history: List[dict], include_timestamps: bool = False) -> str:
        """Formata o histórico completo como texto estruturado (User/AI)."""
        formatted_lines = []
        for msg in db_history:
            role = "AI" if msg.get("role") == "assistant" else "User"
            content = msg.get("content", "").replace("\n", " ").strip()
            
            timestamp_str = ""
            if include_timestamps:
                ts = msg.get("timestamp")
                if ts:
                    try:
                        if isinstance(ts, (int, float)):
                            dt = datetime.fromtimestamp(ts, tz=timezone.utc)
                        elif isinstance(ts, str):
                            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                        else:
                            dt = None
                        if dt:
                            timestamp_str = f" [{dt.strftime('%Y-%m-%d %H:%M:%S')} UTC]"
                    except Exception:
                        pass
                        
            formatted_lines.append(f"{role}{timestamp_str}: {content}")
        return "\n".join(formatted_lines)
        
    def _format_workflow_to_markdown(self, workflow_data: Optional[Dict[str, Any]]) -> str:
        """Converte o JSON do React Flow em roteiro hierárquico ordenado por BFS, legível para a IA.

        Identifica o nó inicial (tipo 'start' ou menor in-degree), realiza BFS para
        gerar a ordem lógica do fluxo e produz um roteiro numerado com tipo, instrução
        e próximos passos explícitos para cada etapa.
        """
        if not workflow_data or not isinstance(workflow_data, dict):
            return ""

        nodes = {n['id']: n for n in workflow_data.get('nodes', [])}
        edges = workflow_data.get('edges', [])

        if not nodes:
            return ""

        # --- Mapa de adjacência e in-degree ---
        adjacency: Dict[str, list] = {nid: [] for nid in nodes}
        in_degree: Dict[str, int] = {nid: 0 for nid in nodes}
        for e in edges:
            src = e.get('source')
            tgt = e.get('target')
            if src in adjacency and tgt in nodes:
                lbl = (e.get('data', {}).get('label') or e.get('label') or '').strip()
                adjacency[src].append((lbl, tgt))
                in_degree[tgt] = in_degree.get(tgt, 0) + 1

        # --- Nó inicial: tipo 'start' > menor in-degree ---
        start_node_id = None
        for nid, node in nodes.items():
            if node.get('data', {}).get('node_type') == 'start':
                start_node_id = nid
                break
        if start_node_id is None:
            start_node_id = min(in_degree, key=lambda nid: in_degree[nid])

        # --- Ícones por tipo ---
        TYPE_LABEL = {
            'start':    'INÍCIO',
            'message':  'MENSAGEM',
            'decision': 'DECISÃO',
            'action':   'AÇÃO',
            'end':      'FIM',
        }

        # --- BFS para ordem lógica ---
        visited: set = set()
        queue = [start_node_id]
        ordered_nodes: list = []
        while queue:
            cur = queue.pop(0)
            if cur in visited:
                continue
            visited.add(cur)
            ordered_nodes.append(cur)
            for _, nxt in adjacency.get(cur, []):
                if nxt not in visited:
                    queue.append(nxt)
        for nid in nodes:
            if nid not in visited:
                ordered_nodes.append(nid)

        node_num = {nid: i + 1 for i, nid in enumerate(ordered_nodes)}

        # --- Monta o roteiro ---
        lines = [
            "## ROTEIRO DE ATENDIMENTO (FLUXO)\n"
            "Siga este roteiro em ordem. Analise o histórico para identificar em qual etapa estamos "
            "e avance somente quando a condição da etapa atual for satisfeita.\n"
        ]

        for nid in ordered_nodes:
            data = nodes[nid].get('data', {})
            num = node_num[nid]
            etapa = (data.get('label') or 'Etapa').replace('\n', ' ').strip()
            acao = (data.get('description') or 'Sem instrução específica.').replace('\n', ' ').strip()
            type_str = TYPE_LABEL.get(data.get('node_type', 'message'), '📌 ETAPA')

            nexts = adjacency.get(nid, [])
            if nexts:
                avancos = []
                for cond, tgt_id in nexts:
                    tgt_num = node_num.get(tgt_id, '?')
                    tgt_lbl = (nodes[tgt_id].get('data', {}).get('label') or '').replace('\n', ' ').strip() if tgt_id in nodes else '?'
                    if cond:
                        avancos.append(f"Se '{cond}' → Etapa {tgt_num} ({tgt_lbl})")
                    else:
                        avancos.append(f"Avançar para Etapa {tgt_num} ({tgt_lbl})")
                avanco_str = " | ".join(avancos)
            else:
                avanco_str = "Fim do fluxo — conclua ou transfira conforme necessário."

            lines.append(
                f"**Etapa {num} — {type_str}: {etapa}**\n"
                f"  Instrução: {acao}\n"
                f"  Próximo passo: {avanco_str}"
            )

        return "\n\n".join(lines) + "\n\n"

    async def generate_followup_action(
        self,
        whatsapp: models.Atendimento,
        conversation_history_db: List[dict],
        db: AsyncSession,
        company: models.Company
    ) -> dict:
        """
        Gera uma mensagem de follow-up baseada na inatividade e nas configurações da empresa.
        """
        try:
            company_id = inspect(company).identity[0]
            company = await db.get(models.Company, company_id)
            history_str = self._format_history_optimized(conversation_history_db, include_timestamps=True)
            datetime_context = self._get_datetime_context(company)

            system_instruction = (
                "Você é um assistente especialista em reengajamento. Analise o histórico e decida se deve enviar um follow-up.\n\n"
                "## REGRAS\n"
                "1. *DECISÃO DE ENVIO:* A única condição para omitir o envio é a solicitação explícita do cliente para interrupção do contato. Nos demais casos, prossiga com o follow-up.\n"
                "2. *EXECUÇÃO:* Utilize a mensagem configurada como base, ajustando-a para garantir naturalidade. Utilize formatação de negrito para destaque.\n"
                "3. *SAUDAÇÕES:* Evite cumprimentar o usuário caso já existam saudações prévias no histórico.\n"
                "4. *FORMATO:* Retorne estritamente um JSON válido contendo a ação decidida e a respectiva mensagem."
            )

            prompt_text = (
                f"## CONTEXTO TEMPORAL\n{datetime_context}\n\n"
                f"## DADOS\nNome Contato: {whatsapp.nome_contato}\n\n"
                f"## HISTÓRICO RECENTE\n{history_str}\n\n"
                f"## TAREFA\nAnalise o histórico e decida sobre o envio do follow-up."
            )
            
            response = await self._generate_with_retry(prompt_text, db, company, system_instruction=system_instruction, atendimento_id=whatsapp.id, persona=whatsapp.active_persona)
            
            return self._parse_json_response(response.text)

        except Exception as e:
            logger.error(f"Erro ao gerar ação de follow-up com Gemini: {e}", exc_info=True)
            return { "mensagem_para_enviar": None }

    def _format_analysis_json_to_markdown(self, analysis_data: Dict[str, Any]) -> str:
        """Converte o JSON de análise da IA em uma string Markdown formatada."""
        markdown_parts = []

        # Extrai a chave principal, que pode variar (ex: 'analise_de_conversao')
        if not isinstance(analysis_data, dict):
            return str(analysis_data) # Retorna como string se não for um dicionário

        data = next(iter(analysis_data.values()), {}) if len(analysis_data) == 1 and isinstance(next(iter(analysis_data.values()), None), dict) else analysis_data

        if 'diagnostico_geral' in data:
            markdown_parts.append(f"## Diagnóstico Geral\n\n{data['diagnostico_geral']}\n")

        if 'principais_pontos_de_friccao' in data and data['principais_pontos_de_friccao']:
            markdown_parts.append("## Principais Pontos de Fricção\n")
            for item in data['principais_pontos_de_friccao']:
                area = item.get('area') or item.get('ponto', 'Área não especificada')
                observacoes = item.get('observacoes') or item.get('detalhe', 'N/A')
                impacto = item.get('impacto_na_conversao')
                
                markdown_parts.append(f"### {area}")
                if impacto:
                    markdown_parts.append(f"**Impacto na Conversão:** {impacto}\n")
                markdown_parts.append(f"{observacoes}\n")

        if 'insights_acionaveis' in data and data['insights_acionaveis']:
            markdown_parts.append("## Insights Acionáveis e Sugestões\n")
            for insight in data['insights_acionaveis']:
                markdown_parts.append(f"### {insight.get('titulo', 'Sugestão')}\n")
                for sugestao in insight.get('sugestoes', []):
                    markdown_parts.append(f"- {sugestao}")
                markdown_parts.append("") # Adiciona uma linha em branco

        if 'proximos_passos_recomendados' in data:
            markdown_parts.append(f"## Próximos Passos\n\n{data['proximos_passos_recomendados']}")

        if not markdown_parts: # Fallback se a estrutura for inesperada
            return "A análise foi gerada, mas em um formato não esperado para formatação automática."

        return "\n".join(markdown_parts)

    async def analyze_data(
        self,
        question: str,
        user: models.User,
        atendimentos: List[models.Atendimento], # Lista de atendimentos do período
        db: AsyncSession,
        model_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Usa a IA para analisar dados do sistema com base em uma pergunta do usuário.
        Retorna um dicionário JSON com a análise estruturada.
        """
        logger.info(f"Iniciando análise de dados para user_id={user.id} com a pergunta: '{question[:100]}...'")

        # 1. System Instruction (Refinada para Analista Sênior)
        system_instruction = (
            "Você é um Analista de Dados Sênior e Estrategista de Operações de Atendimento.\n"
            "Sua missão é extrair insights acionáveis dos dados de atendimento fornecidos.\n\n"
            "DIRETRIZES DE ANÁLISE:\n"
            "1. RESPOSTA DIRETA: Comece sempre respondendo objetivamente à pergunta do usuário.\n"
            "2. EVIDÊNCIAS: Sempre que identificar um padrão ou problema, cite o número de WhatsApp/contato dos atendimentos como exemplo.\n"
            "3. VISÃO ESTRATÉGICA: Não apenas resuma, mas identifique gargalos de conversão, falhas de processo ou oportunidades de vendas.\n"
            "4. OBJETIVIDADE: Use uma linguagem executiva, clara e focada em resultados.\n\n"
            "FORMATO DE SAÍDA:\n"
            "Sua resposta DEVE ser estritamente um objeto JSON válido, sem blocos de código markdown (```json)."
        )

        # 2. Processamento dos dados quantitativos (Estatísticas Gerais)
        total = len(atendimentos)
        status_counts = {}
        for at in atendimentos:
            status_counts[at.status] = status_counts.get(at.status, 0) + 1
        
        stats_table = "| Métrica | Valor |\n"
        stats_table += "|---|---|\n"
        stats_table += f"| Total de Atendimentos | {total} |\n"
        for st, count in status_counts.items():
            stats_table += f"| Status {st} | {count} |\n"
        
        # 3. Formatação compacta de TODOS os atendimentos (Tabular)
        # Limitamos a 150 atendimentos por segurança de contexto
        sorted_atendimentos = sorted(atendimentos, key=lambda x: x.updated_at, reverse=True)[:150]
        
        headers = ["WhatsApp", "Criado em", "Atualizado em", "Contato", "Status", "Tags", "Resumo CRM", "Histórico (Compacto)"]
        rows = [
            "| " + " | ".join(headers) + " |",
            "| " + " | ".join(["---"] * len(headers)) + " |"
        ]
        for at in sorted_atendimentos:
            conversa_compacta = ""
            try:
                msgs = json.loads(at.conversa or "[]")
                parts = []
                for m in msgs:
                    role = "U" if m.get("role") == "user" else "A"
                    content = m.get("content", "").replace("\n", " ").replace("|", "/").strip()
                    parts.append(f"{role}: {content}")
                conversa_compacta = " / ".join(parts)
            except:
                conversa_compacta = "Erro ao ler conversa."

            tags_str = ", ".join([t['name'] for t in at.tags]) if at.tags else "Nenhuma"
            resumo_limpo = (at.resumo or "Sem resumo").replace("\n", " ").replace("|", "/")
            
            created_str = at.created_at.strftime("%H:%M %d/%m/%y") if at.created_at else "N/I"
            updated_str = at.updated_at.strftime("%H:%M %d/%m/%y") if at.updated_at else "N/I"
            
            row = f"| {at.whatsapp} | {created_str} | {updated_str} | {at.nome_contato or 'N/I'} | {at.status} | {tags_str} | {resumo_limpo} | {conversa_compacta} |"
            rows.append(row)

        atendimentos_table = "\n".join(rows)

        # 4. Montagem Final do Prompt - Sistema Modular de Componentes UI
        prompt_str = (
            f"# PERGUNTA DO USUÁRIO\n{question}\n\n"
            f"# ESTATÍSTICAS GERAIS\n{stats_table}\n\n"
            f"# ATENDIMENTOS DETALHADOS\n"
            f"Use as datas 'Criado em' e 'Atualizado em' para identificar lentidões ou padrões de tempo.\n"
            f"{atendimentos_table}\n\n"
            f"# INSTRUÇÕES DE FORMATO DE RESPOSTA\n\n"
            f"Você deve retornar um JSON com DOIS campos obrigatórios: 'resposta_direta' e 'modulos'.\n\n"
            f"## CAMPO 1: resposta_direta\n"
            f"Uma frase curta e direta respondendo à pergunta do usuário.\n\n"
            f"## CAMPO 2: modulos\n"
            f"Uma LISTA ORDENADA de componentes visuais que compõem o relatório.\n"
            f"Você decide QUAIS módulos usar e em QUE ORDEM, dependendo do que os dados revelam.\n"
            f"Use os componentes mais adequados para cada tipo de informação.\n\n"
            f"### CATÁLOGO DE COMPONENTES DISPONÍVEIS:\n\n"
            f"Cada módulo selecionado DEVE ter a propriedade 'tipo' indicando qual componente renderizar.\n\n"
            f"**1. tipo: 'hero_stat'** - Destaque para uma métrica principal de impacto. Requer valor, label, descricao e tendencia (alta/baixa/neutro).\n"
            f"**2. tipo: 'metric_grid'** - Grade para exibição de múltiplos KPIs. Requer titulo e lista de metricas com label, valor, icone e cor.\n"
            f"**3. tipo: 'pie_chart'** - Gráfico para distribuições proporcionais. Requer titulo, descricao e lista de dados com name e value.\n"
            f"**4. tipo: 'bar_chart'** - Gráfico para comparações e rankings. Requer titulo, descricao, eixo_x e lista de dados com name e value.\n"
            f"**5. tipo: 'friction_cards'** - Listagem de gargalos e pontos de atrito. Requer titulo e lista de itens com area, observacoes, impacto (OBRIGATORIAMENTE 'Alto', 'Médio' ou 'Baixo') e contatos_exemplo.\n"
            f"**6. tipo: 'insight_cards'** - Sugestões estratégicas e ações recomendadas. Requer titulo e lista de itens com titulo, descricao, prioridade e icone.\n"
            f"**7. tipo: 'text_section'** - Seção para diagnósticos narrativos e conclusões. Requer titulo, conteudo e estilo.\n"
            f"**8. tipo: 'timeline_events'** - Registro cronológico de eventos notáveis. Requer titulo e lista de eventos com id, data, descricao e tipo.\n"
            f"**9. tipo: 'line_chart'** - Gráfico de linha para evolução temporal. Requer titulo, descricao e lista de dados com name e value.\n"
            f"**10. tipo: 'area_chart'** - Gráfico de área para volume ao longo do tempo. Requer titulo, descricao e lista de dados com name e value.\n"
            f"**11. tipo: 'radar_chart'** - Gráfico de radar para múltiplas dimensões (ex: habilidades, qualidade). Requer titulo, descricao e lista de categorias com name, value e fullMark (valor máximo).\n"
            f"**12. tipo: 'progress_list'** - Lista de itens com barra de progresso. Requer titulo, descricao e lista de itens com label, progresso (0-100) e valor_texto.\n"
            f"**13. tipo: 'swot_analysis'** - Matriz SWOT. Requer titulo e listas de strings para forcas, fraquezas, oportunidades e ameacas.\n"
            f"**14. tipo: 'sentiment_meter'** - Medidor de sentimento geral. Requer titulo, porcentagens de positivo, neutro, negativo e um resumo string.\n"
            f"**15. tipo: 'action_steps'** - Passo a passo numerado para plano de ação. Requer titulo e lista de passos com numero, titulo e descricao.\n"
            f"**16. tipo: 'highlight_quotes'** - Citações destacadas de clientes. Requer titulo e lista de citacoes com autor, texto e contexto.\n"
            f"**17. tipo: 'comparative_table'** - Tabela de comparação. Requer titulo, lista de colunas (strings) e matriz de linhas (lista de listas de strings).\n"
            f"**18. tipo: 'key_value_list'** - Lista de propriedades chave/valor detalhada. Requer titulo e lista de itens com chave e valor.\n\n"
            f"### REGRAS DE USO:\n"
            f"1. Inclua obrigatoriamente componentes de destaque (hero_stat ou metric_grid) que respondam à pergunta inicial.\n"
            f"2. Utilize representações gráficas sempre que os dados permitirem cálculos de proporção ou comparação.\n"
            f"3. Priorize o uso de cartões de fricção para análises de conversão e grades de métricas para performance.\n"
            f"4. Forneça sempre sugestões estratégicas acionáveis via cartões de insight.\n"
            f"5. Finalize o relatório com uma seção de texto conclusiva.\n"
            f"6. Limite a resposta a no máximo seis componentes para garantir a objetividade.\n\n"
            f"### FORMATO FINAL DO JSON:\n"
            f'{{\n'
            f'  "resposta_direta": "Resposta objetiva à pergunta",\n'
            f'  "modulos": [\n'
            f'    {{\n'
            f'      "tipo": "nome_do_componente",\n'
            f'      "...": "campos requeridos pelo componente"\n'
            f'    }}\n'
            f'  ]\n'
            f'}}'
        )

        # Se model_name não for passado, tenta pegar do default_persona do user se existir, senão usa o padrão do serviço
        used_model = model_name or "gemini-2.5-flash"

        # Criamos um mock de persona para passar o modelo para o _generate_with_retry
        mock_persona = models.Config(ai_model=used_model)

        response = await self._generate_with_retry(
            prompt_str, 
            db, 
            user.company, 
            is_media=False, 
            system_instruction=system_instruction
        )
        return self._parse_json_response(response.text)

    async def generate_persona_prompt(
        self,
        company_description: str,
        db: AsyncSession,
        user: models.User,
        base_instruction: Optional[str] = None,
        fixed_instruction: Optional[str] = None
    ) -> str:
        """Gera um prompt de sistema (persona) com base na descrição da empresa e instruções."""
        
        if base_instruction:
            prompt_text = (
                f"{base_instruction}\n\n"
                f"--- DADOS DA EMPRESA ---\n"
                f"{company_description}\n\n"
                f"--- INSTRUÇÃO FINAL ---\n"
                f"Com base nas instruções acima e nos dados da empresa, escreva o System Prompt (Persona) final.\n"
                f"Retorne APENAS o texto do system prompt gerado, sem introduções, sem formatação markdown (```) e pronto para uso."
            )
        else:
            prompt_text = (
                f"Atue como um Especialista em Engenharia de Prompt e Estrategista de Vendas.\n"
                f"Seu objetivo é escrever um 'System Prompt' (Persona) para um assistente de WhatsApp que deve parecer 100% humano.\n\n"
                f"DIRETRIZES PARA O PROMPT GERADO:\n"
                f"1. TOM E ESTILO: Adote linguagem natural e amigável típica de aplicativos de mensagens instantâneas. Evite formalismos excessivos ou padrões de atendimento robótico. Proibido admitir a natureza de inteligência artificial.\n"
                f"2. ABERTURA OBRIGATÓRIA: Inicie a primeira interação identificando-se pelo nome e representando a empresa, solicitando em seguida o nome do contato para personalização do atendimento.\n"
                f"3. GESTÃO DE CATÁLOGO: Caso a descrição da empresa seja incompleta, infira produtos, serviços e valores pertinentes ao nicho de mercado, apresentando-os com autoridade e naturalidade.\n"
                f"4. FLUXO DE CONVERSA: Priorize a compreensão das necessidades do cliente para oferecer soluções adequadas e conduzir ao fechamento ou agendamento.\n"
                f"5. REGRAS: Mantenha a consistência da persona integralmente. Contorne solicitações fora de escopo com respostas humanas e plausíveis.\n\n"
                f"Informações para basear a criação:\n{company_description}\n\n"
                f"Retorne APENAS o texto do system prompt gerado, sem introduções, sem formatação markdown (```) e pronto para uso."
            )
        
        response = await self._generate_with_retry(prompt_text, db, user.company)
        
        if fixed_instruction:
            return response.text.strip() + "\n\n" + fixed_instruction

        # Lógica fixa de Teste Gratuito (Adicionada conforme solicitação)
        fixed_trial_prompt = (
            "\n\n"
            "--- MUDANÇA DE FASE: FIM DO TESTE ---\n"
            "1. GATILHO DE ATIVAÇÃO: Verifique o histórico. Se a contagem total de mensagens (User + AI) for maior ou igual a 16.\n"
            "Você deve encerrar a atuação da persona.\n\n"
            "2. TRANSIÇÃO E META-EXPLICAÇÃO:\n"
            "   - Explique gentilmente que o limite de interações do teste gratuito foi atingido.\n"
            "   - Informe explicitamente que o atendimento anterior foi uma simulação com dados fictícios para demonstrar a capacidade da IA de manter conversas naturais.\n"
            "   - Informe que você irá passar para um humano para dar sequência ao atendimento.\n"
        )

        return response.text.strip() + fixed_trial_prompt

    async def analyze_conversation_feedback(
        self,
        feedback: str,
        history_str: str,
        rag_context: str,
        current_instructions: str,
        db: AsyncSession,
        user: models.User,
        current_workflow: Optional[dict] = None,
        atendimento_id: Optional[int] = None
    ) -> dict:
        """
        Analisa um atendimento com base no feedback humano e sugere correções nas instruções.
        """
        system_instruction = (
            "Você é um Engenheiro de Prompt Sênior e Estrategista de IA especialista em Atendimento ao Cliente.\n"
            "Sua missão é analisar uma conversa em que a IA cometeu um erro ou teve um desempenho subótimo, "
            "com base no feedback fornecido por um supervisor humano.\n\n"
            "DIRETRIZES RÍGIDAS PARA CRIAÇÃO DAS REGRAS E FLUXOS:\n"
            "1. IMPERATIVO: Utilize verbos no imperativo para iniciar as instruções.\n"
            "2. GENÉRICO E ESCALÁVEL: Elabore regras aplicáveis a situações futuras análogas.\n"
            "3. SEM EXEMPLOS: Proibido incluir falas literais ou diálogos. Foque estritamente no comportamento e lógica.\n"
            "4. FOCO NA SOLUÇÃO: Resolva pontualmente o problema identificado no feedback.\n\n"
            "SISTEMA DE CONFIGURAÇÃO DO BOT:\n"
            "O bot opera com três pilares configuráveis:\n"
            "A) PLANILHA DE SISTEMA (INSTRUÇÕES): Organizada em abas com colunas para Categoria e Diretriz.\n"
            "B) PLANILHA DE RAG (BASE DE CONHECIMENTO): Armazena dados técnicos e informações de suporte.\n"
            "C) FLUXO VISUAL (WORKFLOW): Estrutura JSON que define estados (nodes) e transições (edges).\n\n"
            "EDIÇÃO DO FLUXO VISUAL (WORKFLOW):\n"
            "Altere o novo_workflow APENAS caso o feedback exija mudanças estruturais profundas na conversa.\n"
            "Caso contrário, retorne novo_workflow como null.\n"
            "- Nodes (Etapas): Devem possuir identificador único sem espaços.\n"
            "- Edges (Transições): Devem conectar os nodes obrigatoriamente através de sourceHandle e targetHandle.\n\n"
            "TAREFA:\n"
            "Proponha atualizações na PLANILHA DE SISTEMA, na PLANILHA DE RAG e, se necessário, no FLUXO VISUAL.\n"
            "Assegure que as novas diretrizes sejam completas e tecnicamente precisas.\n\n"
            "Retorne ESTRITAMENTE em formato JSON:\n"
            "{\n"
            '  "analise_geral": "Explicação do erro e da solução proposta",\n'
            '  "alteracoes_planilha": [ { "acao": "adicionar|modificar|remover", "aba": "Nome da Aba", "coluna_1": "Categoria", "valor_antigo": "Texto antigo (ou null)", "valor_novo": "Nova regra" } ],\n'
            '  "alteracoes_rag": [ { "acao": "adicionar|modificar|remover", "aba": "Nome da Aba", "coluna_1": "Categoria", "valor_antigo": "Texto antigo (ou null)", "valor_novo": "Novo conhecimento" } ],\n'
            '  "novo_workflow": { "nodes": [], "edges": [] } ou null\n'
            "}"
        )

        wf_str = json.dumps(current_workflow, ensure_ascii=False, indent=2) if current_workflow else "Nenhum fluxo visual mapeado atualmente."

        prompt_text = (
            f"### FEEDBACK DO SUPERVISOR HUMANO\n"
            f"{feedback}\n\n"
            f"### HISTÓRICO DA CONVERSA\n"
            f"{history_str}\n\n"
            f"### CONTEXTO DA BASE DE CONHECIMENTO (RAG) DA SESSÃO\n"
            f"{rag_context if rag_context else 'Nenhum contexto RAG acionado.'}\n\n"
            f"### INSTRUÇÕES ATUAIS\n"
            f"{current_instructions}\n\n"
            f"### FLUXO VISUAL ATUAL\n"
            f"{wf_str}\n\n"
            f"Analise o contexto e gere as atualizações necessárias ESTRITAMENTE em formato JSON perfeitamente válido. Seja objetivo para evitar latência."
        )

        try:
            response = await self._generate_with_retry(
                prompt=prompt_text,
                db=db,
                company=user.company,
                system_instruction=system_instruction,
                atendimento_id=atendimento_id
            )
            return self._parse_json_response(response.text)

        except Exception as e:
            logger.error(f"Erro ao analisar feedback com IA: {e}")
            return {
                "analise_geral": f"Falha na IA ao analisar: {str(e)}"
            }

_gemini_service_instance = None
def get_gemini_service():
    global _gemini_service_instance
    if _gemini_service_instance is None:
        _gemini_service_instance = GeminiService()
    return _gemini_service_instance