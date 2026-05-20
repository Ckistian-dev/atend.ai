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
from sqlalchemy import select


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
        keys_str = settings.GOOGLE_API_KEYS
        self.api_keys = [key.strip() for key in keys_str.split(',') if key.strip()]

        if not self.api_keys:
            logger.error("🚨 ERRO CRÍTICO: Nenhuma chave de API do Google foi configurada em GOOGLE_API_KEYS.")
            raise ValueError("A lista de GOOGLE_API_KEYS não pode estar vazia.")
            
        self.current_key_index = 0
        
        # Carregar tabela de preços do arquivo models.js (Duplicado no Backend)
        self.model_pricing = {}
        try:
            current_dir = os.path.dirname(os.path.abspath(__file__))
            models_js_path = os.path.normpath(os.path.join(current_dir, "../constants/models.js"))
            
            with open(models_js_path, "r", encoding="utf-8") as f:
                content = f.read()
                
            match = re.search(r'export const LLM_MODELS = (\[.*?\]);', content, re.DOTALL)
            if match:
                models_data = json.loads(match.group(1))
                base_flash = 0.30 # Gemini 2.5 Flash Input Text
                
                for model in models_data:
                    m_id = model["id"]
                    pricing = model.get("pricing", {})
                    
                    self.model_pricing[m_id] = {
                        "input_text": pricing.get("input_text", 0.30) / base_flash,
                        "input_audio": pricing.get("input_audio", 0.30) / base_flash,
                        "output": pricing.get("output", 2.50) / base_flash
                    }
                logger.info(f"✅ Tabela de preços carregada de models.js: {len(self.model_pricing)} modelos.")
            else:
                raise ValueError("Array LLM_MODELS não encontrado em models.js")
        except Exception as e:
            logger.error(f"🚨 Erro ao ler tabela de preços do models.js: {e}")
            # Fallback seguro
            self.model_pricing = {
                "gemini-2.5-flash": { "input_text": 1.0, "input_audio": 1.0 / 0.30, "output": 2.50 / 0.30 }
            }
        self._initialize_model()

    def _initialize_model(self):
        """Inicializa o cliente Gemini."""
        try:
            current_key = self.api_keys[self.current_key_index]
            
            # Instanciação limpa: o SDK gerencia v1/v1beta automaticamente
            self.client = genai.Client(api_key=current_key, http_options=types.HttpOptions(timeout=1200000))
            
            logger.info(f"✅ Cliente Gemini inicializado (chave índice {self.current_key_index}).")
        except Exception as e:
            logger.error(f"🚨 ERRO CRÍTICO ao configurar o Gemini: {e}")
            raise

    def _rotate_key(self):
        """Muda para a próxima chave na lista."""
        self.current_key_index = (self.current_key_index + 1) % len(self.api_keys)
        logger.warning(f"Alternando para a chave de API do Google com índice {self.current_key_index}.")
        self._initialize_model()
        return self.current_key_index

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
        user: models.User, 
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
        model_name = persona.ai_model if persona and persona.ai_model else "gemini-2.5-flash"
        temp = persona.temperature if persona and persona.temperature is not None else 0.5
        top_p = persona.top_p if persona and persona.top_p is not None else 0.95
        top_k = persona.top_k if persona and persona.top_k is not None else 40

        config_args = {
            "temperature": temp,
            "top_p": top_p,
            "top_k": top_k,
        }

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

        initial_key_index = self.current_key_index
        max_attempts_per_key = 2
        
        while True:
            for attempt in range(max_attempts_per_key):
                try:
                    logger.info(
                        f"Tentando gerar conteúdo com a chave índice {self.current_key_index} "
                        f"(tentativa {attempt + 1}/{max_attempts_per_key})."
                    )
                    
                    # --- MUDANÇA PRINCIPAL: Chamada Assíncrona Nativa (.aio) ---
                    # Não precisa mais de run_in_executor
                    response = await self.client.aio.models.generate_content(
                        model=model_name,
                        contents=prompt,
                        config=gen_config
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
                    # Extrai o uso real de tokens da resposta do Gemini
                    usage_metadata = response.usage_metadata
                    tokens_to_deduct = 0 # Inicializa com 0

                    if usage_metadata:
                        input_tokens = usage_metadata.prompt_token_count
                        output_tokens = usage_metadata.candidates_token_count
                        
                        # Recupera multiplicadores para o modelo usado
                        pricing = self.model_pricing.get(model_name, self.model_pricing.get("gemini-2.5-flash", {"input_text": 1.0, "input_audio": 3.33, "output": 8.33}))
                        
                        # Determina se é áudio ou texto
                        input_multiplier = pricing.get("input_audio", pricing.get("input_text", 1.0)) if media_type == "audio" else pricing.get("input_text", 1.0)
                        output_multiplier = pricing.get("output", 8.33)
                        
                        # Calcula o custo equivalente em "tokens de input do Gemini 2.5 Flash"
                        equivalent_total_tokens = (input_tokens * input_multiplier) + (output_tokens * output_multiplier)
                        
                        # Arredonda para o inteiro mais próximo para dedução
                        tokens_to_deduct = round(equivalent_total_tokens)

                        logger.info(
                            f"Uso de tokens (User {user.id}, Model {model_name}): "
                            f"Input={input_tokens}, Output={output_tokens}. "
                            f"Custo Equivalente = {tokens_to_deduct} tokens."
                        )
                    else:
                        logger.warning(f"Não foi possível obter metadados de uso de tokens para o user {user.id}.")

                    try:
                        if tokens_to_deduct > 0:
                            logger.info(f"Sucesso na chamada à API Gemini para o utilizador {user.id}. Deduzindo {tokens_to_deduct} tokens.")
                            await crud_user.decrement_user_tokens(db, db_user=user, usage=tokens_to_deduct, atendimento_id=atendimento_id)
                            await db.commit()
                            await db.refresh(user)
                    except Exception as token_err:
                        logger.error(f"Falha ao deduzir tokens: {token_err}", exc_info=True)
                        await db.rollback()
                    
                    return response

                # Captura erros do novo SDK (geralmente ServerError ou ClientError)
                # O erro 429 (Quota) agora geralmente vem como um ClientError com status 429
                except Exception as e:
                    error_str = str(e).lower()
                    
                    # Detecção de Erro de Cota (429) ou Recurso Esgotado
                    if "429" in error_str or "resource exhausted" in error_str or "quota" in error_str:
                        logger.warning(f"Quota da API excedida (429) com a chave {self.current_key_index}. Rotacionando...")
                        break # Sai do loop 'for' para rotacionar a chave
                    
                    # Detecção de bloqueio de segurança ou prompt inválido
                    elif "blocked" in error_str or "invalid argument" in error_str:
                        logger.error(f"Erro não recuperável (Bloqueio/Inválido): {e}")
                        raise e
                        
                    else:
                        # Erros genéricos de conexão/servidor
                        logger.error(f"Erro inesperado na API Gemini: {e}. Tentativa {attempt + 1}.")
                        await asyncio.sleep(2) # Espera um pouco antes de tentar de novo na mesma chave
            
            # Se saiu do loop 'for', significa que precisa trocar de chave
            new_key_index = self._rotate_key()
            
            if new_key_index == initial_key_index:
                logger.critical(f"Todas as {len(self.api_keys)} chaves de API falharam.")
                raise Exception("Todas as chaves de API excederam a quota.")

    async def transcribe_and_analyze_media(
        self, 
        media_data: dict,  # Espera receber: {"data": bytes, "mime_type": str}
        db_history: List[dict], 
        persona: models.Config,
        db: AsyncSession,
        user: models.User,
        atendimento_id: Optional[int] = None
    ) -> str:
        logger.info(f"Iniciando transcrição/análise para mídia do tipo {media_data.get('mime_type')}")
        
        # --- 1. PREPARAÇÃO DA MÍDIA PARA O NOVO SDK ---
        try:
            file_bytes = media_data.get("data")
            mime_type = media_data.get("mime_type")

            if not file_bytes:
                raise ValueError("Bytes do arquivo não encontrados em media_data")

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
                prompt_contents, db, user, is_media=True, media_type=media_type_arg, 
                system_instruction=system_instruction, atendimento_id=atendimento_id, persona=persona
            )
            
            transcription = response.text.strip()
            logger.info(f"Transcrição/Análise gerada: '{transcription[:100]}...'")
            return transcription
            
        except Exception as e:
            logger.error(f"Erro ao transcrever/analisar mídia com Gemini: {e}", exc_info=True)
            return f"[Erro ao processar mídia: {mime_type}]"

    async def generate_embedding(self, text: str) -> List[float]:
        """
        Gera embedding usando o modelo gemini-embedding-001.
        Força 768 dimensões para compatibilidade e eficiência.
        """
        try:
            # Usando RETRIEVAL_QUERY para otimizar a busca pela pergunta
            embed_config = types.EmbedContentConfig(
                task_type="RETRIEVAL_QUERY",
                output_dimensionality=768
            )

            response = await self.client.aio.models.embed_content(
                model="gemini-embedding-001",
                contents=text,
                config=embed_config
            )
            if response.embeddings:
                return response.embeddings[0].values
            return []
        except Exception as e:
            logger.error(f"Erro ao gerar embedding: {e}")
            return []

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
            try:
                response = await self.client.aio.models.embed_content(
                    model="gemini-embedding-001",
                    contents=batch,
                    config=embed_config
                )
                
                if response.embeddings:
                    # Extrai os valores de cada embedding retornado, mantendo a ordem
                    batch_embeddings = [e.values for e in response.embeddings]
                    all_embeddings.extend(batch_embeddings)
                else:
                    logger.warning(f"Batch {i} retornou sem embeddings.")
                    all_embeddings.extend([[] for _ in batch])

            except Exception as e:
                logger.error(f"Erro ao gerar embeddings em lote (índice {i}): {e}")
                all_embeddings.extend([[] for _ in batch])
        
        return all_embeddings

    async def _retrieve_rag_context(self, db: AsyncSession, config_id: int, query_text: str, limit: int = 10) -> str:
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
        
        final_vectors = []
        
        # Para cada origem encontrada (cada aba e o drive), busca os 'limit' mais relevantes
        for origin in origins:
            stmt_origin = select(models.KnowledgeVector).where(
                models.KnowledgeVector.config_id == config_id,
                models.KnowledgeVector.origin == origin
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
        
        # Formatação inteligente: Agrupa chunks com cabeçalhos repetidos
        formatted_text = ""
        previous_lines = []

        for chunk in unique_chunks:
            current_lines = chunk.strip().split('\n')
            
            # Verifica quantas linhas iniciais são iguais ao chunk anterior
            match_count = 0
            min_len = min(len(previous_lines), len(current_lines))
            
            for i in range(min_len):
                if previous_lines[i] == current_lines[i]:
                    match_count += 1
                else:
                    break
            
            # Se houver correspondência de cabeçalho (pelo menos 1 linha), adiciona apenas o restante
            if match_count > 0:
                new_content = "\n".join(current_lines[match_count:])
                if new_content:
                    formatted_text += "\n" + new_content
            else:
                # Se não houver correspondência, adiciona o chunk inteiro
                if formatted_text:
                    formatted_text += "\n\n"
                formatted_text += chunk.strip()
            
            previous_lines = current_lines

        return formatted_text

    def _get_datetime_context(self, user: models.User) -> str:
        """Gera o contexto de data e hora atual, incluindo dia da semana em PT-BR."""
        now_utc = datetime.now(timezone.utc)
        
        datetime_context = f"Data e Hora Atuais (UTC): {now_utc.strftime('%Y-%m-%d %H:%M:%S')} UTC\n"

        user_timezone_str = "America/Sao_Paulo" # Default
        if user.followup_config and isinstance(user.followup_config, dict):
            user_timezone_str = user.followup_config.get("timezone", "America/Sao_Paulo")
        
        try:
            user_tz = pytz.timezone(user_timezone_str)
            now_local = now_utc.astimezone(user_tz)
            
            weekdays = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado", "Domingo"]
            weekday_name = weekdays[now_local.weekday()]
            
            datetime_context += f"Data e Hora Local do Usuário ({user_timezone_str}): {now_local.strftime('%Y-%m-%d %H:%M:%S')} ({weekday_name})\n"
        except pytz.UnknownTimeZoneError:
            logger.warning(f"Timezone desconhecida '{user_timezone_str}' para o usuário {user.id}. Usando apenas UTC.")
            pass 
            
        return datetime_context

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
        """Converte o JSON do React Flow em uma tabela Markdown legível para a IA."""
        if not workflow_data or not isinstance(workflow_data, dict):
            return ""
            
        nodes = {n['id']: n for n in workflow_data.get('nodes', [])}
        edges = workflow_data.get('edges', [])
        
        if not nodes:
            return ""
            
        lines = ["# Fluxo de Atendimento e Condições", "| Etapa ou Estado | Ação/Instrução Esperada | Condição para Avançar |", "|---|---|---|"]
        
        for node_id, node in nodes.items():
            etapa = node.get('data', {}).get('label', 'Etapa').replace('\n', ' ')
            acao = node.get('data', {}).get('description', 'Sem instrução específica').replace('\n', ' ')
            
            target_edges = [e for e in edges if e.get('source') == node_id]
            proximos = []
            for e in target_edges:
                target_node = nodes.get(e.get('target'))
                if target_node:
                    condicao = e.get('label', 'Avanço Direto')
                    proximos.append(f"Se '{condicao}' -> Ir para [{target_node.get('data', {}).get('label', '')}]")
            
            proximo_str = " | ".join(proximos) if proximos else "Fim do fluxo"
            lines.append(f"| {etapa} | {acao} | {proximo_str} |")
            
        return "\n".join(lines) + "\n\n"

    async def generate_conversation_action(
        self,
        whatsapp: models.Atendimento,
        conversation_history_db: List[dict],
        persona: models.Config,
        db: AsyncSession,
        user: models.User
    ) -> dict:
        max_retries = 3
        last_response = None


        for attempt in range(max_retries):
            try:
                # 1. Coleta de Contexto
                persona_prompt = persona.prompt or "Você é um assistente útil."
                
                # Busca tags disponíveis e atuais para o prompt
                available_tags = await crud_atendimento.get_all_user_tags(db, user.id)
                available_tags_names = [t['name'] for t in available_tags]
                
                current_tags_names = []
                if whatsapp.tags:
                     current_tags_names = [t['name'] for t in whatsapp.tags]

                # Gera o histórico formatado para o PROMPT
                history_str = self._format_history_optimized(conversation_history_db, include_timestamps=True)
                
                # --- RAG QUERY BUILDER (Foco Exponencial) ---
                # Prioriza drasticamente as últimas mensagens para o embedding de busca.
                rag_query = ""
                if conversation_history_db:
                    # Pega as últimas 5 mensagens (Contexto Imediato)
                    recent_msgs = conversation_history_db[-5:]
                    rag_query = self._format_history_optimized(recent_msgs, include_timestamps=False)


                # Usa a query focada para buscar contexto
                rag_context = await self._retrieve_rag_context(db, persona.id, rag_query)

                # --- Contexto de Data e Hora ---
                datetime_context = self._get_datetime_context(user)

                # --- Contexto de Agenda ---
                calendar_context = ""
                if persona.is_calendar_active and persona.available_hours:
                    booked_events_str = ""
                    if persona.google_calendar_credentials:
                        try:
                            cal_service = get_google_calendar_service(persona)
                            # Busca eventos reais para evitar conflitos (em thread para não bloquear o loop async)
                            events = await asyncio.to_thread(cal_service.get_upcoming_events)
                            if events:
                                booked_list = []
                                for event in events:
                                    start = event['start'].get('dateTime', event['start'].get('date'))
                                    booked_list.append(f"- {start}")
                                booked_events_str = "\n# HORÁRIOS JÁ OCUPADOS (NÃO AGENDAR NESTES)\n" + "\n".join(booked_list) + "\n"
                        except Exception as cal_err:
                            logger.error(f"Erro ao buscar agenda para prompt (User {user.id}): {cal_err}")

                    # Formata horários de trabalho de forma simples
                    hours_summary = []
                    if persona.available_hours:
                        for day, intervals in persona.available_hours.items():
                            if intervals:
                                intervals_str = ", ".join([f"{i.get('start')}-{i.get('end')}" for i in intervals])
                                hours_summary.append(f"{day}: {intervals_str}")
                    
                    hours_text = " | ".join(hours_summary) if hours_summary else "Não configurado"

                    calendar_context = f"\n# DISPONIBILIDADE DE AGENDA\n| Item | Descrição |\n|---|---|\n| Horários de Trabalho | {hours_text} |\n"
                    calendar_context += booked_events_str
                    calendar_context += "Se o cliente demonstrar interesse em agendar, verifique a disponibilidade real (horários de trabalho vs ocupados) e proponha um horário livre. Se confirmado, use a ação 'agendar_reuniao' no JSON.\n"

                # --- Contexto do Fluxo Visual ---
                workflow_context = self._format_workflow_to_markdown(persona.workflow_json)

                # 2. Montagem da System Instruction (Regras, Contexto e Formato)
                # --- Partes condicionais para otimização de tokens ---
                _rag_sec = f"# CONTEXTO (RAG)\n{rag_context}\n\n" if rag_context else ""
                _workflow_sec = f"{workflow_context}" if persona.workflow_json else ""
                _calendar_sec = f"{calendar_context}" if persona.is_calendar_active else ""
                
                _tags_rule = f"# TAGS DISPONÍVEIS\n{' | '.join(available_tags_names)}\n\n" if available_tags_names else ""
                _tags_json = '  "tags_sugeridas": ["Tag1"],\n' if available_tags_names else ""

                _drive_rule = "3. *ARQUIVOS:* Use apenas IDs Reais da lista do Drive. Proibido inventar.\n" if persona.drive_id else ""
                _drive_json = '  "arquivos_anexos": [{ "nome_exato": "Nome", "id_arquivo": "ID", "tipo_midia": "image|video|document" }],\n' if persona.drive_id else ""

                _sched_rule = (
                    "4. *AGENDAMENTO:* Solicite o e-mail do cliente ao confirmar um horário. "
                    "Retorne acao_agenda, data_agendamento e email_cliente no JSON apenas após obter o horário e o e-mail.\n"
                    if persona.is_calendar_active else ""
                )
                _sched_json = '  "email_cliente": "Email", "acao_agenda": "Ação", "data_agendamento": "ISO",\n' if persona.is_calendar_active else ""

                _corr_rule = "- *CORREÇÃO HUMANA:* Caso ativado, você pode ocasionalmente simular um erro de digitação em um balão e enviar a correção no balão seguinte para conferir naturalidade.\n" if persona.human_corrections else ""
                _corr_json = '  "correcao_humana": { "erro": "...", "correcao": "*" },\n' if persona.human_corrections else ""

                system_instruction = (
                    f"{persona_prompt}\n\n"
                    f"{_rag_sec}{_workflow_sec}{_tags_rule}{_calendar_sec}"
                    f"# DIRETRIZES DE HUMANIZAÇÃO (CRÍTICO)\n"
                    f"- *Ausência de Corporatiquês:* Elimine termos formais excessivos. Seja direto e objetivo.\n"
                    f"- *NÃO SE REPITA:* Analise o histórico e evite duplicidade de informações ou ações já realizadas.\n"
                    f"- *Continuidade Real:* Mantenha a fluidez de uma conversa contínua. Ignore apresentações se já houver interação prévia.\n"
                    f"- *Zero Saudações Repetidas:* Omita cumprimentos se o histórico recente já os contiver.\n"
                    f"- *Espelhamento de Estilo:* Adapte o nível de formalidade, uso de emojis e pontuação ao estilo demonstrado pelo cliente.\n"
                    f"- *Interjeições Naturais:* É encorajado o uso de interjeições curtas (ex: 'Entendi!', 'Hum...', 'Certo.') para conferir naturalidade.\n"
                    f"- *Formatação WhatsApp:* Utilize estritamente a sintaxe do WhatsApp (*negrito*, _itálico_, ~tachado~).\n"
                    f"- *Separação de Bolhas:* Divida a resposta no array 'mensagens'. Cada item é um balão separado.\n"
                    f"- *Linguagem Natural:* Priorize expressões cotidianas em vez de frases prontas.\n"
                    f"{_corr_rule}\n"
                    f"# REGRAS DE EXECUÇÃO E INTEGRIDADE (CRÍTICO)\n"
                    f"1. *ADMITIR IGNORÂNCIA:* CASO A INFORMAÇÃO SOLICITADA NÃO ESTEJA PRESENTE NO CONTEXTO (RAG) OU NO FLUXO, INFORME QUE NÃO POSSUI O DADO E OFEREÇA AJUDA COM O QUE ESTÁ DISPONÍVEL. PROIBIDO INVENTAR DADOS TÉCNICOS, PREÇOS OU CONDIÇÕES.\n"
                    f"2. *FONTE DE VERDADE:* Baseie-se prioritariamente no contexto fornecido.\n"
                    f"{_drive_rule}{_sched_rule}"
                    f"# SITUAÇÕES DO ATENDIMENTO (campo 'nova_situacao')\n"
                    f"- *Aguardando Resposta:* Use quando a conversa deve continuar e você aguarda um retorno do cliente.\n"
                    f"- *Atendente Chamado:* Use se o cliente solicitar falar com um humano ou se você não puder ajudar com as informações disponíveis.\n"
                    f"- *Concluído:* Use quando o objetivo do atendimento for alcançado ou a conversa for finalizada.\n\n"
                    f"# FORMATO DE RESPOSTA (JSON OBRIGATÓRIO)\n"
                    f"Retorne APENAS o JSON. OMITA campos vazios ou nulos para economizar tokens.\n"
                    f"{{\n"
                    f'  "mensagens": ["Balão 1", "Balão 2"],\n'
                    f"{_corr_json}{_sched_json}{_tags_json}{_drive_json}"
                    f'  "fonte_confiavel": true,\n'
                    f'  "nova_situacao": "Aguardando Resposta",\n'
                    f'  "nome_contato": "Nome",\n'
                    f'  "resumo": "Resumo curto"\n'
                    f"}}"
                )

                # --- 3. Montagem do Prompt (Histórico e Tarefa) ---
                prompt_text = (
                    f"# DATA E HORA ATUAL\n{datetime_context}\n"
                    f"# DADOS DO CLIENTE\n"
                    f"| Campo | Valor |\n"
                    f"|---|---|\n"
                    f"| Nome | {whatsapp.nome_contato or 'Não identificado'} |\n"
                    f"| Tags Atuais | {', '.join(current_tags_names) if current_tags_names else 'Nenhuma'} |\n"
                    f"| Status Atendente | {'online' if user.atendente_online else 'offline'} |\n\n"
                    f"# HISTÓRICO\n{history_str}\n\n"
                    f"# TAREFA\n"
                    f"Responda ao último 'User' seguindo estritamente as instruções do sistema."
                )
                
                response = await self._generate_with_retry(prompt_text, db, user, system_instruction=system_instruction, atendimento_id=whatsapp.id, persona=persona)
                last_response = response
                
                return self._parse_json_response(response.text)

            except json.JSONDecodeError as e:
                response_text = last_response.text if last_response else "N/A"
                logger.warning(
                    f"Falha ao decodificar JSON da IA (tentativa {attempt + 1}/{max_retries}). "
                    f"Resposta: {response_text}"
                )
                if attempt < max_retries - 1:
                    await asyncio.sleep(2)  # Aguarda antes da próxima tentativa
                else:
                    logger.error(f"Erro de decodificação JSON após {max_retries} tentativas. Resposta final: {response_text}", exc_info=True)
                    return { "mensagem_para_enviar": None, "nova_situacao": "Erro IA", "resumo": f"Falha da IA ao gerar JSON válido após {max_retries} tentativas: {str(e)}" }
            
            except Exception as e:
                logger.error(f"Erro ao gerar ação de conversação com Gemini: {e}", exc_info=True)
                return { "mensagem_para_enviar": None, "nova_situacao": "Erro IA", "resumo": f"Falha da IA: {str(e)}" }
        
        # Fallback caso o loop termine sem sucesso (não deve acontecer com a lógica acima)
        return { "mensagem_para_enviar": None, "nova_situacao": "Erro IA", "resumo": "Falha crítica no loop de geração de resposta da IA." }

    async def generate_followup_action(
        self,
        whatsapp: models.Atendimento,
        conversation_history_db: List[dict],
        db: AsyncSession,
        user: models.User
    ) -> dict:
        """
        Gera uma mensagem de follow-up baseada na inatividade e nas configurações do usuário.
        """
        try:
            history_str = self._format_history_optimized(conversation_history_db, include_timestamps=True)
            datetime_context = self._get_datetime_context(user)

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
            
            response = await self._generate_with_retry(prompt_text, db, user, system_instruction=system_instruction, atendimento_id=whatsapp.id, persona=whatsapp.active_persona)
            
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
            user, 
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
        
        response = await self._generate_with_retry(prompt_text, db, user)
        
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
            '  "analise_geral": Explicação do erro e da solução proposta,\n'
            '  "alteracoes_planilha": [ ... ],\n'
            '  "alteracoes_rag": [ ... ],\n'
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
                user=user,
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