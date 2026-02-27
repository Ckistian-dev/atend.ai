from google import genai
from google.genai import types
import logging
import json
import asyncio
import pytz
import re
from typing import Optional, List, Dict, Any
from collections.abc import Set
import numpy as np
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select


from app.core.config import settings
from app.db import models
from app.crud import crud_user, crud_atendimento

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
        self.generation_config = {
            "temperature": 0.5,        # Aumentei: Deixa a fala menos "dura" e mais coloquial.
            "top_p": 0.95,             # Ajuste fino: Mantém a coerência mas corta alucinações absurdas.
            "top_k": 40,               # O PULO DO GATO: De 1 para 40. Permite variar o vocabulário.
            "frequency_penalty": 0.6,  # CRÍTICO: Penaliza palavras que ele já falou muito (evita o "Ótimo!" repetido).
            "presence_penalty": 0.4    # Ajuda a não ficar repetindo o que o usuário acabou de dizer.
        }
        # NOVO: Multiplicador para o custo de tokens de output, para normalizar pelo custo de input.
        # Baseado no custo informado: Input $0,30, Output $2,50 por milhão de tokens.
        self.output_token_multiplier = 2.5 / 0.3
        
        self._initialize_model()

    def _initialize_model(self):
        """Inicializa o cliente Gemini."""
        try:
            current_key = self.api_keys[self.current_key_index]
            
            # Instanciação padrão (o SDK escolhe a versão correta para o modelo estável)
            self.client = genai.Client(api_key=current_key)
            
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
        system_instruction: Optional[str] = None,
        atendimento_id: Optional[int] = None
    ):  # Removido o tipo de retorno estrito para evitar erros de importação cruzada por enquanto
        """
        Executa a chamada para a API Gemini (Novo SDK), deduz token e rotaciona chaves.
        """
        
        # Configuração do novo SDK
        # Adaptamos o dicionário antigo para o novo objeto de configuração
        config_args = {
            "temperature": self.generation_config.get("temperature", 0.5),
            "top_p": self.generation_config.get("top_p", 1),
            "top_k": self.generation_config.get("top_k", 1),
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
            debug_msg = f"\n{'='*20} PROMPT ENVIADO PARA IA [{timestamp}] {'='*20}\n"
            
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
                        model='gemini-2.5-flash', # Modelo corrigido para versão estável e mais recente
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
                        
                        # Calcula o custo equivalente em "tokens de input"
                        equivalent_total_tokens = input_tokens + (output_tokens * self.output_token_multiplier)
                        
                        # Arredonda para o inteiro mais próximo para dedução
                        tokens_to_deduct = round(equivalent_total_tokens)

                        logger.info(
                            f"Uso de tokens (User {user.id}): "
                            f"Input={input_tokens}, Output={output_tokens}. "
                            f"Custo Equivalente (x{self.output_token_multiplier:.2f}) = {tokens_to_deduct} tokens."
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
            task_text = "Sua única tarefa é transcrever o áudio a seguir. Retorne apenas o texto transcrito, sem adicionar nenhuma outra palavra, introdução ou formatação."
            prompt_contents = [task_text, media_part]
            
        # Lógica para Imagem/Documento (Análise Visual)
        else:
            system_instruction = "Você é um especialista em análise visual e interpretação de conteúdo."
            
            history_str = self._format_history_optimized(db_history)
            
            prompt_text = (
                f"## HISTÓRICO RECENTE\n{history_str}\n\n"
                "## INSTRUÇÃO DE ANÁLISE\n"
                "Analise a mídia fornecida (imagem, documento ou vídeo) e descreva seu conteúdo de forma abrangente e detalhada. O objetivo é fornecer um resumo completo que capture todos os aspectos importantes para que a IA de conversação possa entender o contexto sem precisar 'ver' a mídia.\n\n"
                "1. **Descrição Geral:** Comece com uma descrição geral do que a mídia mostra (ex: 'Foto de uma piscina em um jardim', 'Documento de orçamento', 'Vídeo curto mostrando o funcionamento de um produto').\n"
                "2. **Detalhes Visuais (para imagens/vídeos):** Descreva os elementos principais, cores, ambiente, pessoas, objetos, texto visível, e qualquer detalhe que pareça relevante para a conversa.\n"
                "3. **Extração de Dados (se aplicável):** Se a mídia contiver dados estruturados (como tabelas, listas, preços, nomes, endereços, datas, valores em um comprovante), extraia-os de forma clara.\n"
                "4. **Contexto e Intenção:** Com base no histórico da conversa, tente inferir a intenção do usuário ao enviar a mídia. O que ele quer mostrar ou perguntar?\n"
                "5. **Formato da Resposta:** Retorne um texto claro e bem estruturado. Use bullet points (*) para listas, se ajudar na clareza. Não converse, apenas forneça a análise."
            )
            
            # Ordem: Prompt de texto primeiro, Mídia depois (ou vice-versa, Gemini entende ambos)
            prompt_contents = [prompt_text, media_part]

        # --- 3. CHAMADA À API ---
        try:
            # Passamos a lista (texto + mídia) para o método que criamos anteriormente
            # O _generate_with_retry já está preparado para receber 'prompt' como string OU lista
            response = await self._generate_with_retry(prompt_contents, db, user, is_media=True, system_instruction=system_instruction, atendimento_id=atendimento_id)
            
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
            # Configuração para reduzir de 3072 para 768 dimensões (Matryoshka)
            # Isso economiza 4x de espaço no banco e mantém a performance.
            embed_config = types.EmbedContentConfig(
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
        
        # Configuração para 768 dimensões
        embed_config = types.EmbedContentConfig(
            output_dimensionality=768
        )

        # Divide a lista total em pedaços menores (chunks) para respeitar limites da API
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

    async def _retrieve_rag_context(self, db: AsyncSession, config_id: int, query_text: str) -> str:
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
        
        # Para cada origem encontrada (cada aba e o drive), busca os 10 mais relevantes
        for origin in origins:
            stmt_origin = select(models.KnowledgeVector).where(
                models.KnowledgeVector.config_id == config_id,
                models.KnowledgeVector.origin == origin
            ).order_by(
                models.KnowledgeVector.embedding.cosine_distance(query_embedding)
            ).limit(10)
            
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

    def _format_history_optimized(self, db_history: List[dict]) -> str:
        """Formata o histórico completo como texto estruturado (User/AI)."""
        formatted_lines = []
        for msg in db_history:
            role = "AI" if msg.get("role") == "assistant" else "User"
            content = msg.get("content", "").replace("\n", " ").strip()
            formatted_lines.append(f"{role}: {content}")
        return "\n".join(formatted_lines)

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
                system_instruction = persona.prompt or "Você é um assistente útil."
                
                # Busca tags disponíveis e atuais para o prompt
                available_tags = await crud_atendimento.get_all_user_tags(db, user.id)
                available_tags_names = [t['name'] for t in available_tags]
                
                current_tags_names = []
                if whatsapp.tags:
                     current_tags_names = [t['name'] for t in whatsapp.tags]

                # Gera o histórico formatado para o PROMPT
                history_str = self._format_history_optimized(conversation_history_db)
                
                # --- RAG QUERY BUILDER (Foco Exponencial) ---
                # Prioriza drasticamente as últimas mensagens para o embedding de busca.
                rag_query = ""
                if conversation_history_db:
                    # Pega as últimas 5 mensagens (Contexto Imediato)
                    recent_msgs = conversation_history_db[-5:]
                    rag_query = self._format_history_optimized(recent_msgs)


                # Usa a query focada para buscar contexto
                rag_context = await self._retrieve_rag_context(db, persona.id, rag_query)

                # --- Contexto de Data e Hora ---
                datetime_context = self._get_datetime_context(user)

                # --- Contexto de Agenda ---
                calendar_context = ""
                if persona.is_calendar_active and persona.available_hours:
                    calendar_context = f"\n# DISPONIBILIDADE DE AGENDA\nOs horários disponíveis para agendamento são: {json.dumps(persona.available_hours, ensure_ascii=False)}.\n"
                    calendar_context += "Se o cliente demonstrar interesse em agendar, verifique a disponibilidade e proponha um horário. Se confirmado, use a ação 'agendar_reuniao' no JSON.\n"

                # 2. Montagem do Prompt (Texto Estruturado)
                prompt_text = (
                    f"# CONTEXTO (RAG)\n{rag_context}\n\n"
                    f"# DATA E HORA ATUAL\n{datetime_context}\n"
                    f"# HISTÓRICO\n{history_str}\n\n"
                    f"# DADOS DO CLIENTE\n"
                    f"Nome: {whatsapp.nome_contato or 'Não identificado'}\n"
                    f"{calendar_context}"
                    f"Tags Atuais: {json.dumps(current_tags_names, ensure_ascii=False)}\n"
                    f"Status Atendente: {'online' if user.atendente_online else 'offline'}\n\n"
                    f"# TAGS DISPONÍVEIS\n"
                    f"{json.dumps(available_tags_names, ensure_ascii=False)}\n\n"
                    f"# DIRETRIZES DE HUMANIZAÇÃO (CRÍTICO)\n"
                    f"- **Zero 'Corporatiquês':** PROIBIDO começar frases com 'Ótimo', 'Excelente', 'Perfeito', 'Entendido', 'Compreendo'. Isso denuncia que você é um robô. Vá direto ao ponto.\n"
                    f"- **NÃO SE REPITA (REGRA CRÍTICA):** Analise o histórico. É PROIBIDO repetir informações, perguntas, ações ou parafrasear o que o usuário disse. Se você já deu uma informação, não a dê novamente. Se o cliente aponta um erro seu, corrija o erro diretamente, sem reiniciar o fluxo de recomendação.\n"
                    f"- **Continuidade Real:** Trate o histórico como uma conversa contínua de WhatsApp. Se já houver mensagens anteriores, JAMAIS use 'Olá' ou apresentações novamente. Aja como se tivesse respondido há 1 minuto.\n"
                    f"- **Zero Saudações Repetidas:** Se já houve um cumprimento no histórico recente, NÃO inicie a resposta com 'Olá', 'Oi', 'Bom dia', etc. Continue a conversa diretamente.\n"
                    f"- **Conexão Lógica:** Use conectivos de conversa real ('Então...', 'Nesse caso...', 'Ah, sobre isso...'). Evite listas com bullets se puder responder em uma frase corrida.\n"
                    f"- **Espelhamento de Tom:** Se a mensagem do cliente for curta (ex: 'qual o preço?'), seja direto ('Custa R$ 50,00'). Se ele for detalhista, explique mais. Não escreva um 'textão' para quem perguntou 'sim ou não'.\n"
                    f"- **Formatação de Chat:** Evite listas com marcadores (bullets) ou negrito excessivo a menos que seja estritamente necessário (como uma lista de itens). No WhatsApp, pessoas usam parágrafos curtos, não tópicos de Powerpoint.\n"
                    f"- **Banalidade Controlada:** Em vez de 'Sinto muito pelo inconveniente causado', use algo mais leve como 'Poxa, entendo o problema' ou 'Que chato isso, vamos resolver'. Evite desculpas exageradas e submissas.\n"
                    f"- **Proibido Repetir Nomes:** Use o nome do cliente APENAS na primeira saudação do dia. Nas mensagens seguintes, JAMAIS comece com 'Ah, {whatsapp.nome_contato}', 'Olá {whatsapp.nome_contato}' ou similares. Fale direto.\n"
                    f"- **Zero Interjeições Artificiais:** Não comece frases com 'Ah, entendo!', 'Compreendo perfeitamente', 'Excelente pergunta'. Isso soa falso. Vá direto para a resposta técnica/comercial.\n"
                    f"- **Parágrafos Únicos:** Tente responder tudo em UM ou TRES parágrafos no máximo. Evite quebrar a resposta em várias linhas curtas para não gerar spam de notificações.\n\n"
                    f"# TAREFA\n"
                    f"Responda ao último 'User' agindo estritamente como a persona definida.\n\n"
                    f"# REGRAS DE EXECUÇÃO\n"
                    f"1. **Fonte de Verdade:** Use prioritariamente o CONTEXTO (RAG). Se não encontrar, use conhecimento geral sensato, mas evite alucinar dados técnicos.\n"
                    f"2. **Arquivos:** Se o cliente pedir mídia, VERIFIQUE a lista '# DRIVE'. Se o arquivo estiver lá, use o ID EXATO. Se NÃO estiver, NÃO invente um ID e NÃO envie o arquivo. **PROIBIDO** usar IDs fictícios ou placeholders.\n"
                    f"3. **Encaminhamento:** Tente resolver ao máximo. Insista na resolução antes de sugerir um humano. Antes de encaminhar, SEMPRE pergunte se o cliente deseja falar com um atendente. Só mude `nova_situacao` para 'Atendente Chamado' após a confirmação explícita do cliente.\n"
                    f"4. **Comunicação:** Seja direto e use *negrito* para destaques. A regra de NÃO REPETIR é a mais importante de todas.\n"
                    f"5. **Fluxo:** O sistema envia o texto PRIMEIRO e os arquivos DEPOIS. Considere isso na sua resposta.\n"
                    f"6. **Tags:** Analise a conversa e veja se alguma tag disponível se aplica. Retorne apenas o nome das tags em `tags_sugeridas` para adicionar (ou null).\n"
                    f"7. **Capacidade de Visão:** Você TEM a capacidade de ver e analisar imagens, vídeos, áudios e documentos (PDFs) enviados pelo usuário. Se o histórico mostrar '[Imagem/Doc Transcrito]', trate como se tivesse visto o arquivo original.\n"
                    f"8. **Solicitar Nome:** Se o nome do cliente estiver 'Não identificado', pergunte o nome dele logo no início da interação.\n\n"
                    f"9. **Agendamento:** Se o cliente confirmar um horário, retorne 'agendar_reuniao' em `acao_agenda` e a data/hora ISO em `data_agendamento`.\n\n"
                    f"# FORMATO DE RESPOSTA (JSON OBRIGATÓRIO)\n"
                    f"Retorne APENAS um JSON válido, sem blocos de código (```json).\n"
                    f"{{\n"
                    f'  "mensagem_para_enviar": "Texto da resposta aqui (ou null)",\n'
                    f'  "nova_situacao": "Aguardando Resposta" | "Atendente Chamado" | "Concluído",\n'
                    f'  "nome_contato": "Nome extraído ou null",\n'
                    f'  "tags_sugeridas": ["Tag1", "Tag2"] | null,\n'
                    f'  "acao_agenda": "agendar_reuniao" | null,\n'
                    f'  "data_agendamento": "YYYY-MM-DDTHH:MM:SS" | null,\n'
                    f'  "resumo": "Resumo curto da conversa inteira para CRM",\n'
                    f'  "arquivos_anexos": [\n'
                    f'    {{ "nome_exato": "nome.pdf", "id_arquivo": "COPIAR_ID_DA_TABELA_DRIVE", "tipo_midia": "image" }}\n'
                    f'  ]\n'
                    f"}}"
                )
                
                response = await self._generate_with_retry(prompt_text, db, user, system_instruction=system_instruction, atendimento_id=whatsapp.id)
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
            history_str = self._format_history_optimized(conversation_history_db)
            datetime_context = self._get_datetime_context(user)

            prompt_text = (
                f"## TAREFA: FOLLOW-UP\n"
                f"Você é um assistente especialista em reengajamento. Analise o histórico e decida se deve enviar um follow-up.\n\n"
                f"## CONTEXTO TEMPORAL\n{datetime_context}\n\n"
                f"## DADOS\nNome Contato: {whatsapp.nome_contato}\n\n"
                f"## HISTÓRICO RECENTE\n{history_str}\n\n"
                f"## REGRAS\n"
                f"1. DECISÃO DE ENVIO: A única condição para NÃO enviar mensagem é se o cliente pediu explicitamente para parar ou não ser mais contatado. Em todos os outros casos, você DEVE enviar o follow-up.\n"
                f"2. Se decidir enviar: Use a mensagem da configuração como base, adaptando levemente para naturalidade. Seja curto, amigável e não insistente.\n"
                f"3. Não cumprimente novamente se já houver cumprimento no histórico.\n"
                f"4. Retorne APENAS um JSON válido. Exemplo de formatos:\n"
                f"   - Para enviar: {{ \"action\": \"send\", \"mensagem_para_enviar\": \"texto...\" }}\n"
                f"   - Para não enviar: {{ \"action\": \"skip\", \"mensagem_para_enviar\": null }}\n"
            )
            
            response = await self._generate_with_retry(prompt_text, db, user, atendimento_id=whatsapp.id)
            
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
        persona: Optional[models.Config],       # A persona padrão
        db: AsyncSession,
    ) -> Dict[str, Any]:
        """
        Usa a IA para analisar dados do sistema com base em uma pergunta do usuário.
        Retorna um dicionário JSON com a análise estruturada.
        """
        logger.info(f"Iniciando análise de dados para user_id={user.id} com a pergunta: '{question[:100]}...'")

        # 1. System Instruction
        system_instruction = (
            "Você é um analista de dados sênior especialista em atendimento ao cliente.\n"
            "Sua tarefa é analisar os dados fornecidos e responder à pergunta do usuário.\n"
            "Sua resposta DEVE ser estritamente um objeto JSON válido, sem markdown de código.\n"
            "Siga a estrutura sugerida para organizar sua análise."
        )

        # 2. Processamento dos dados quantitativos (Estatísticas Gerais)
        total = len(atendimentos)
        status_counts = {}
        for at in atendimentos:
            status_counts[at.status] = status_counts.get(at.status, 0) + 1
        
        stats_summary = {
            "total_atendimentos": total,
            "distribuicao_status": status_counts,
            "periodo_analisado": "Verificar datas nos filtros"
        }

        # 3. RAG em Memória para dados qualitativos (Conversas/Observações)
        # Prepara textos para embedding (Limitado aos 100 mais recentes para performance)
        docs_for_embedding = []
        atendimentos_map = {} 
        
        # Ordena por data de atualização (mais recentes primeiro) se ainda não estiver
        sorted_atendimentos = sorted(atendimentos, key=lambda x: x.updated_at, reverse=True)[:100]

        for idx, at in enumerate(sorted_atendimentos):
            conversa_text = ""
            try:
                msgs = json.loads(at.conversa or "[]")
                # Pega as últimas 5 mensagens para contexto
                last_msgs = msgs[-5:]
                conversa_text = " | ".join([f"{m.get('role')}: {m.get('content')}" for m in last_msgs])
            except:
                conversa_text = "Sem histórico legível."

            doc_text = (
                f"Status: {at.status}. "
                f"Resumo: {at.resumo or ''}. "
                f"Conversa recente: {conversa_text}"
            )
            docs_for_embedding.append(doc_text)
            atendimentos_map[idx] = at

        relevant_atendimentos_data = []
        
        if docs_for_embedding and question:
            try:
                q_embedding = await self.generate_embedding(question)
                if q_embedding:
                    doc_embeddings = await self.generate_embeddings_batch(docs_for_embedding)
                    
                    scores = []
                    q_vec = np.array(q_embedding)
                    norm_q = np.linalg.norm(q_vec)

                    for d_vec in doc_embeddings:
                        if not d_vec:
                            scores.append(-1)
                            continue
                        d_vec_np = np.array(d_vec)
                        norm_d = np.linalg.norm(d_vec_np)
                        if norm_q == 0 or norm_d == 0:
                            scores.append(0)
                        else:
                            scores.append(np.dot(q_vec, d_vec_np) / (norm_q * norm_d))
                    
                    # Seleciona Top 15 mais relevantes
                    top_indices = np.argsort(scores)[::-1][:15]
                    
                    for idx in top_indices:
                        if scores[idx] > 0.25: # Threshold de relevância
                            at = atendimentos_map[idx]
                            relevant_atendimentos_data.append({
                                "id": at.id,
                                "nome": at.nome_contato,
                                "status": at.status,
                                "resumo": at.resumo,
                                "trecho_conversa": docs_for_embedding[idx]
                            })
            except Exception as e:
                logger.error(f"Erro no RAG do Dashboard: {e}")

        persona_context = None
        if persona:
            persona_context = {"nome_persona": persona.nome_config, "contexto": persona.prompt}

        analysis_prompt = {
            "pergunta_usuario": question,
            "dados_estatisticos": stats_summary,
            "dados_qualitativos_relevantes": relevant_atendimentos_data,
            "contexto_adicional": {
                "resumo_usuario": {"id": user.id, "email": user.email, "tokens_restantes": user.tokens},
                "contexto_persona_ia": persona_context or "N/A",
            },
            "instrucoes_formato": {
                "analise_de_conversao": {
                    "diagnostico_geral": "Um parágrafo resumindo a situação.",
                    "principais_pontos_de_friccao": [
                        {"area": "Nome da Área (ex: Preços)", "observacoes": "Detalhes observados em texto simples.", "impacto_na_conversao": "Alto/Médio/Baixo"}
                    ],
                    "insights_acionaveis": [
                        {"titulo": "Título da Sugestão", "sugestoes": ["Sugestão 1 em texto simples.", "Sugestão 2 em texto simples."]}
                    ],
                    "proximos_passos_recomendados": "Recomendação final."
                }
            }
        }

        prompt_str = json.dumps(analysis_prompt, ensure_ascii=False, indent=2)

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
        user: models.User
    ) -> str:
        """Gera um prompt de sistema (persona) com base na descrição da empresa e instruções."""
        prompt_text = (
            f"Atue como um Especialista em Engenharia de Prompt e Estrategista de Vendas.\n"
            f"Seu objetivo é escrever um 'System Prompt' (Persona) para um assistente de WhatsApp que deve parecer 100% humano.\n\n"
            f"DIRETRIZES PARA O PROMPT GERADO:\n"
            f"1. TOM E ESTILO: A linguagem deve ser natural, amigável e típica de WhatsApp (mensagens curtas, uso de emojis, sem formalismo excessivo). Proibido usar frases como 'em que posso ajudar hoje?' ou termos robóticos. Proibido admitir que é uma IA.\n"
            f"2. ABERTURA OBRIGATÓRIA: O assistente deve sempre iniciar a primeira interação dizendo: 'Olá! Sou o [Nome] da [Nome da Empresa]. Com quem eu falo?' para obter o nome do cliente.\n"
            f"3. CRIATIVIDADE EM PRODUTOS/PREÇOS: Se a descrição da empresa não fornecer uma lista detalhada, a IA deve inventar produtos, serviços e preços condizentes com o nicho, apresentando-os com total naturalidade e autoridade, como se fizessem parte do catálogo oficial.\n"
            f"4. FLUXO DE CONVERSA: O atendimento deve ser focado em entender a necessidade do cliente, oferecer as opções geradas e conduzir para o fechamento ou agendamento, dependendo do nicho.\n"
            f"5. REGRAS: Nunca quebrar o personagem. Se o cliente perguntar algo muito fora do escopo, o assistente deve contornar de forma humana (ex: 'vou confirmar essa informação com o financeiro').\n\n"
            f"Informações para basear a criação:\n{company_description}\n\n"
            f"Retorne APENAS o texto do system prompt gerado, sem introduções, sem formatação markdown (```) e pronto para uso."
        )
        
        response = await self._generate_with_retry(prompt_text, db, user)
        
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

_gemini_service_instance = None
def get_gemini_service():
    global _gemini_service_instance
    if _gemini_service_instance is None:
        _gemini_service_instance = GeminiService()
    return _gemini_service_instance