from google import genai
from google.genai import types
import logging
import json
import asyncio
import re
from typing import Optional, List, Dict, Any
from collections.abc import Set
import numpy as np
from datetime import datetime

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
            "temperature": 0.7,        # Aumentei: Deixa a fala menos "dura" e mais coloquial.
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
        """Inicializa o cliente Gemini com a chave atual usando o novo SDK."""
        try:
            current_key = self.api_keys[self.current_key_index]
            
            # NOVO SDK: Instancia o Client
            # http_options={'api_version': 'v1alpha'} pode ser usado se precisar de recursos beta
            self.client = genai.Client(api_key=current_key)
            
            logger.info(f"✅ Cliente Gemini (New SDK) inicializado com sucesso (chave índice {self.current_key_index}).")
        except Exception as e:
            logger.error(f"🚨 ERRO CRÍTICO ao configurar o Gemini com a chave índice {self.current_key_index}: {e}", exc_info=True)
            raise

    def _rotate_key(self):
        """Muda para a próxima chave na lista."""
        self.current_key_index = (self.current_key_index + 1) % len(self.api_keys)
        logger.warning(f"Alternando para a chave de API do Google com índice {self.current_key_index}.")
        self._initialize_model()
        return self.current_key_index

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
            system_instruction = persona.prompt or "Você é um especialista em extração de dados."
            
            last_user_msg = next((m.get('content', '') for m in reversed(db_history) if m.get('role') == 'user'), "")
            rag_context = await self._retrieve_rag_context(db, persona.id, last_user_msg)
            
            history_str = self._format_history_optimized(db_history)
            
            prompt_text = (
                f"## CONTEXTO (RAG)\n{rag_context}\n\n"
                f"## HISTÓRICO RECENTE\n{history_str}\n\n"
                "## INSTRUÇÃO DE ANÁLISE\n"
                "Você é um especialista em extração de dados. Analise o arquivo fornecido.\n"
                "1. Extraia todos os dados visíveis e relevantes (preços, produtos, nomes, endereços).\n"
                "2. Se for um comprovante, extraia valor, data e beneficiário.\n"
                "3. Não converse. Apenas retorne os dados extraídos em texto claro.\n"
                "4. Use o contexto e histórico acima para entender o que buscar."
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
        """Gera embedding para um texto usando o modelo do Google (text-embedding-004)."""
        try:
            # O novo SDK usa client.aio.models.embed_content
            response = await self.client.aio.models.embed_content(
                model="text-embedding-004",
                contents=text
            )
            if response.embeddings:
                return response.embeddings[0].values
            return []
        except Exception as e:
            logger.error(f"Erro ao gerar embedding: {e}")
            return []

    async def generate_embeddings_batch(self, texts: List[str], batch_size: int = 100) -> List[List[float]]:
        """Gera embeddings para uma lista de textos em lotes (batching)."""
        all_embeddings = []
        
        # Divide a lista total em pedaços menores (chunks) para respeitar limites da API
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            try:
                # O novo SDK suporta lista de strings em 'contents' para processamento em lote
                response = await self.client.aio.models.embed_content(
                    model="text-embedding-004",
                    contents=batch
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
                # Adiciona listas vazias para não quebrar o alinhamento dos índices com os textos originais
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
        
        # Para cada origem encontrada (cada aba e o drive), busca os 5 mais relevantes
        for origin in origins:
            stmt_origin = select(models.KnowledgeVector).where(
                models.KnowledgeVector.config_id == config_id,
                models.KnowledgeVector.origin == origin
            ).order_by(
                models.KnowledgeVector.embedding.cosine_distance(query_embedding)
            ).limit(5)
            
            result_origin = await db.execute(stmt_origin)
            vectors = result_origin.scalars().all()
            final_vectors.extend(vectors)
        
        if not final_vectors: return ""
        
        # Extrai conteúdo e remove duplicatas
        chunks = [v.content for v in final_vectors]
        unique_chunks = list(dict.fromkeys(chunks))
        
        return "\n".join(unique_chunks)

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
                    # Pega as últimas 3 mensagens (Contexto Imediato)
                    recent_msgs = conversation_history_db[-5:]
                    rag_query = self._format_history_optimized(recent_msgs)


                # Usa a query focada para buscar contexto
                rag_context = await self._retrieve_rag_context(db, persona.id, rag_query)

                # 2. Montagem do Prompt (Texto Estruturado)
                prompt_text = (
                    f"# CONTEXTO (RAG)\n{rag_context}\n\n"
                    f"# HISTÓRICO\n{history_str}\n\n"
                    f"# DADOS DO CLIENTE\n"
                    f"Nome: {whatsapp.nome_contato or 'Não identificado'}\n"
                    f"Tags Atuais: {json.dumps(current_tags_names, ensure_ascii=False)}\n"
                    f"Status Atendente: {'online' if user.atendente_online else 'offline'}\n\n"
                    f"# TAGS DISPONÍVEIS\n"
                    f"{json.dumps(available_tags_names, ensure_ascii=False)}\n\n"
                    f"# DIRETRIZES DE HUMANIZAÇÃO (CRÍTICO)\n"
                    f"- **Zero 'Corporatiquês':** PROIBIDO começar frases com 'Ótimo', 'Excelente', 'Perfeito', 'Entendido', 'Compreendo'. Isso denuncia que você é um robô. Vá direto ao ponto.\n"
                    f"- **Não seja Papagaio:** NUNCA repita ou parafraseie o que o usuário acabou de dizer (ex: 'Entendi que você quer saber o preço...'). Apenas dê a resposta.\n"
                    f"- **Continuidade Real:** Trate o histórico como uma conversa contínua de WhatsApp. Se já houver mensagens anteriores, JAMAIS use 'Olá' ou apresentações novamente. Aja como se tivesse respondido há 1 minuto.\n"
                    f"- **Conexão Lógica:** Use conectivos de conversa real ('Então...', 'Nesse caso...', 'Ah, sobre isso...'). Evite listas com bullets se puder responder em uma frase corrida.\n"
                    f"- **Espelhamento de Tom:** Se a mensagem do cliente for curta (ex: 'qual o preço?'), seja direto ('Custa R$ 50,00'). Se ele for detalhista, explique mais. Não escreva um 'textão' para quem perguntou 'sim ou não'.\n"
                    f"- **Formatação de Chat:** Evite listas com marcadores (bullets) ou negrito excessivo a menos que seja estritamente necessário (como uma lista de itens). No WhatsApp, pessoas usam parágrafos curtos, não tópicos de Powerpoint.\n"
                    f"- **Banalidade Controlada:** Em vez de 'Sinto muito pelo inconveniente causado', use algo mais leve como 'Poxa, entendo o problema' ou 'Que chato isso, vamos resolver'. Evite desculpas exageradas e submissas.\n"
                    f"- **Proibido 'Posso ajudar em algo mais?':** NUNCA termine a frase com essa pergunta clichê a cada resposta. Só pergunte isso se o assunto estiver claramente encerrado. Deixe a conversa fluir naturalmente.\n"
                    f"# TAREFA\n"
                    f"Responda ao último 'User' agindo estritamente como a persona definida.\n\n"
                    f"# REGRAS DE EXECUÇÃO\n"
                    f"1. **Fonte de Verdade:** Use prioritariamente o CONTEXTO (RAG). Se não encontrar, use conhecimento geral sensato, mas evite alucinar dados técnicos.\n"
                    f"2. **Arquivos:** Se o cliente pedir foto/catálogo e o arquivo estiver listado no RAG, inclua-o em `arquivos_anexos` usando o ID exato. No texto, avise que está enviando.\n"
                    f"3. **Encaminhamento:** Tente resolver. Só mude `nova_situacao` para 'Atendente Chamado' se for um caso complexo fora da base ou após persistência do erro.\n"
                    f"4. **Comunicação:** Não repita saudações (Oi/Olá) se já houver no histórico. Seja direto e use *negrito* para destaques. Não repita o que o cliente já disse.\n"
                    f"5. **Fluxo:** O sistema envia o texto PRIMEIRO e os arquivos DEPOIS. Considere isso na sua resposta.\n"
                    f"6. **Tags:** Analise a conversa e veja se alguma tag disponível se aplica. Retorne apenas o nome das tags em `tags_sugeridas` para adicionar (ou null).\n\n"
                    f"# FORMATO DE RESPOSTA (JSON OBRIGATÓRIO)\n"
                    f"Retorne APENAS um JSON válido, sem blocos de código (```json).\n"
                    f"{{\n"
                    f'  "mensagem_para_enviar": "Texto da resposta aqui (ou null)",\n'
                    f'  "nova_situacao": "Aguardando Resposta" | "Atendente Chamado" | "Concluído",\n'
                    f'  "nome_contato": "Nome extraído ou null",\n'
                    f'  "tags_sugeridas": ["Tag1", "Tag2"] | null,\n'
                    f'  "resumo": "Resumo curto da conversa inteira para CRM",\n'
                    f'  "arquivos_anexos": [\n'
                    f'    {{ "nome_exato": "nome.pdf", "id_arquivo": "ID_DO_RAG", "tipo_midia": "image" }}\n'
                    f'  ]\n'
                    f"}}"
                )
                
                response = await self._generate_with_retry(prompt_text, db, user, system_instruction=system_instruction, atendimento_id=whatsapp.id)
                last_response = response
                
                clean_response = response.text.strip().replace("```json", "").replace("```", "")
                
                return json.loads(clean_response)

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

            prompt_text = (
                f"## TAREFA: FOLLOW-UP\n"
                f"Você é um assistente especialista em reengajamento. Gere uma mensagem de follow-up.\n\n"
                f"## DADOS\nNome Contato: {whatsapp.nome_contato}\n\n"
                f"## HISTÓRICO RECENTE\n{history_str}\n\n"
                f"## REGRAS\n"
                f"1. Use a mensagem da configuração como base, adaptando levemente para naturalidade.\n"
                f"2. Seja curto, amigável e não insistente.\n"
                f"3. Não cumprimente novamente se já houver cumprimento no histórico.\n"
                f"4. Retorne APENAS um JSON válido: {{ \"mensagem_para_enviar\": \"texto...\" }}\n"
            )
            
            response = await self._generate_with_retry(prompt_text, db, user, atendimento_id=whatsapp.id)
            
            clean_response = response.text.strip().replace("```json", "").replace("```", "")
            
            return json.loads(clean_response)

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
        analysis_json = json.loads(response.text)
        return analysis_json


_gemini_service_instance = None
def get_gemini_service():
    global _gemini_service_instance
    if _gemini_service_instance is None:
        _gemini_service_instance = GeminiService()
    return _gemini_service_instance