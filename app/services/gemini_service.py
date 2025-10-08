import google.generativeai as genai
from google.api_core import exceptions
import time
import logging
import json
import asyncio
from typing import Optional, List, Dict, Any
from collections.abc import Set

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db import models
from app.crud import crud_user

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
        self.model = None
        self.generation_config = {"temperature": 0.5, "top_p": 1, "top_k": 1}
        
        self._initialize_model()

    def _initialize_model(self):
        """Inicializa ou re-inicializa o cliente Gemini com a chave atual."""
        try:
            current_key = self.api_keys[self.current_key_index]
            genai.configure(api_key=current_key)
            self.model = genai.GenerativeModel(
                model_name='gemini-2.5-flash',
                generation_config=self.generation_config
            )
            logger.info(f"✅ Cliente Gemini inicializado com sucesso (chave índice {self.current_key_index}).")
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
        is_media: bool = False
    ) -> genai.types.GenerateContentResponse:
        """
        Executa a chamada para a API Gemini, deduz um token em caso de sucesso,
        e possui lógica de retentativa e rotação de chaves.
        """
        gen_config_override = self.generation_config.copy()
        if not is_media and isinstance(prompt, str):
            gen_config_override["response_mime_type"] = "application/json"

        initial_key_index = self.current_key_index
        max_attempts_per_key = 2
        
        while True:
            for attempt in range(max_attempts_per_key):
                try:
                    loop = asyncio.get_running_loop()
                    response = await loop.run_in_executor(
                        None, 
                        lambda: self.model.generate_content(prompt, generation_config=gen_config_override)
                    )
                    
                    # --- LÓGICA DE DECRÉSCIMO DE TOKEN ---
                    # Deduz 1 token após cada chamada bem-sucedida à IA.
                    try:
                        await crud_user.decrement_user_tokens(db, db_user=user)
                        await db.commit()
                        await db.refresh(user)
                        logger.info(f"Token deduzido para o utilizador {user.id}. Tokens restantes: {user.tokens}")
                    except Exception as token_err:
                        logger.error(f"Falha ao deduzir token para o utilizador {user.id} após sucesso da IA: {token_err}", exc_info=True)
                        await db.rollback() # Garante que a sessão não fique em estado inconsistente
                    
                    return response

                except exceptions.ResourceExhausted as e:
                    logger.warning(f"Quota da API excedida (429) com a chave {self.current_key_index} (tentativa {attempt + 1}/{max_attempts_per_key}).")
                    if attempt == max_attempts_per_key - 1:
                        break 
                    await asyncio.sleep(5)
                except (exceptions.InvalidArgument, genai.types.BlockedPromptException) as e:
                    logger.error(f"Erro não recuperável com a API Gemini: {type(e).__name__}. Não haverá nova tentativa. Erro: {e}", exc_info=True)
                    raise e
                except Exception as e:
                    logger.error(f"Erro inesperado ({type(e).__name__}) na API Gemini com a chave {self.current_key_index}. Tentativa {attempt + 1}/{max_attempts_per_key}. Erro: {e}")
                    await asyncio.sleep(5)
            
            new_key_index = self._rotate_key()
            
            if new_key_index == initial_key_index:
                raise Exception(f"Todas as {len(self.api_keys)} chaves de API excederam a quota. Não é possível continuar.")

    async def transcribe_and_analyze_media(
        self, 
        media_data: dict, 
        db_history: List[dict], 
        config: models.Config,
        contexto_planilha: Optional[Dict[str, Any]],
        db: AsyncSession,
        user: models.User
    ) -> str:
        logger.info(f"Iniciando transcrição/análise para mídia do tipo {media_data.get('mime_type')}")
        prompt_parts = []
        
        if 'audio' in media_data['mime_type']:
            task = "Sua única tarefa é transcrever o áudio a seguir. Retorne apenas o texto transcrito, sem adicionar nenhuma outra palavra ou formatação."
            prompt_parts.extend([task, media_data])
        else:
            formatted_history = self._format_history_for_prompt(db_history)
            media_analysis_prompt = {
                "instrucao_geral": "Você é um especialista em análise de documentos e imagens. Sua tarefa é analisar o arquivo enviado pelo contato e descrever seu conteúdo de forma concisa e objetiva para ser usado como uma anotação interna no CRM.",
                "regras": [
                    "1. Foque no conteúdo do arquivo (imagem ou documento).",
                    "2. Conecte o conteúdo do arquivo com o que foi discutido na conversa, se aplicável, usando o `historico_conversa` e o `contexto_planilha`.",
                    "3. Siga o tom de voz definido na `configuracao_persona` para formular a sua análise.",
                    "4. Sua resposta final deve ser APENAS o texto da análise, sem nenhuma outra palavra, título ou formatação."
                ],
                "configuracao_persona": config.prompt_config,
                "contexto_planilha": contexto_planilha or {"aviso": "Nenhum contexto de planilha foi fornecido para esta análise."},
                "historico_conversa": formatted_history
            }
            prompt_text = json.dumps(media_analysis_prompt, ensure_ascii=False, indent=2, cls=SetEncoder)
            prompt_parts.extend([prompt_text, media_data])

        try:
            response = await self._generate_with_retry(prompt_parts, db, user, is_media=True)
            transcription = response.text.strip()
            logger.info(f"Transcrição/Análise gerada: '{transcription[:100]}...'")
            return transcription
        except Exception as e:
            logger.error(f"Erro ao transcrever/analisar mídia após todas as tentativas: {e}", exc_info=True)
            return f"[Erro ao processar mídia: {media_data.get('mime_type')}]"

    async def generate_conversation_action(
        self,
        config: models.Config,
        contact: models.Contact,
        conversation_history_db: List[dict],
        contexto_planilha: Optional[Dict[str, Any]],
        db: AsyncSession,
        user: models.User
    ) -> dict:
        try:
            formatted_history = self._format_history_for_prompt(conversation_history_db)

            master_prompt = {
                "instrucao_geral": (
                    "Você é um assistente de IA especialista em atendimento. Siga estas regras em ordem de prioridade:\n"
                    "1. *Prioridade Máxima ao Contexto:* Sua principal fonte de verdade é o `contexto_planilha`. *Sempre* procure a resposta neste contexto primeiro.\n"
                    "2. *Uso de Imagens e Documentos:* Você tem capacidade de interpretar imagens e documentos que forem fornecidos. Se o cliente enviar um arquivo ou imagem, analise e utilize as informações extraídas para auxiliar na resposta.\n"
                    "3. *Conhecimento Geral como Alternativa:* Se a informação não estiver no `contexto_planilha`, ou se não for possível extrair totalmente da imagem/documento, utilize seu conhecimento geral para responder, mesmo que seja uma explicação mais ampla ou genérica. Só não utilize informações se for algo altamente incerto ou impossível de inferir.\n"
                    "4. *Não Desista Fácil:* Não encaminhe para um atendente logo no início. Sempre tente responder com contexto, interpretação de imagens/documentos e/ou conhecimento geral antes.\n"
                    "5. *Encaminhamento Somente em Casos Específicos:* Encaminhe ao atendente apenas se:\n"
                    "   - A dúvida do cliente for extremamente específica e impossível de responder com contexto, imagens/documentos ou conhecimento geral.\n"
                    "   - Ou se, após 3 tentativas de explicação no mesmo assunto, o cliente ainda não estiver satisfeito ou continuar em dúvida.\n"
                    "6. *Evite Repetição de Cumprimento:* Nunca cumprimente o cliente mais de uma vez. Verifique no `historico_conversa` se já houve algum cumprimento anterior (ex: 'Olá', 'Oi', 'Bom dia', 'Boa tarde', 'Boa noite'). Se houver, não envie outro cumprimento.\n"
                    "7. *Mantenha a Persona:* Siga sempre o tom de voz e o objetivo definidos em `configuracao_persona`.\n"
                    "8. *Formatação de Texto:* Quando precisar destacar palavras em negrito, utilize *texto*. Quando precisar usar itálico, utilize _texto_. Não use nenhum outro tipo de marcação.\n"
                    "9. *Fluxo de Resolução e Encaminhamento:* Seu objetivo principal é resolver a dúvida do cliente. Siga este fluxo:\n"
                    "   a. *Primeira Tentativa:* Responda à pergunta do cliente da forma mais clara e completa possível, usando o contexto disponível, imagens/documentos fornecidos ou conhecimento geral.\n"

                    "   b. *Segunda Tentativa (Reabordagem):* Se o cliente repetir a mesma dúvida ou disser que não entendeu, explique de forma diferente, use uma analogia ou quebre em passos menores. No fim, pergunte: 'Ficou mais claro agora?'.\n"
                    "   c. *Terceira Tentativa (Exemplo Prático):* Se o cliente ainda estiver confuso, traga um exemplo prático simples e direto, relacionado ao caso dele.\n"
                    "   d. *Encaminhamento (Último Recurso):* Se, após 3 tentativas no mesmo assunto, o cliente ainda expressar dúvida, confusão ou insatisfação, ou se a dúvida for extremamente específica e impossível de responder, você deve encaminhá-lo a um atendente humano. Nesse caso, sua resposta JSON deve conter:\n"
                    "       - `mensagem_para_enviar`: Uma orientação para o bot pedir desculpas, informar que vai transferir para outro atendente e solicitar que o cliente aguarde um momento. (não copie exatamente este texto, use como referência)\n"
                    "       - `nova_situacao`: 'Atendente Chamado'\n"
                ),
                "formato_resposta_obrigatorio": {
                    "descricao": "Sua resposta DEVE ser um único objeto JSON válido, sem nenhum texto ou formatação adicional (como ```json).",
                    "chaves": {
                        "mensagem_para_enviar": "O texto da mensagem a ser enviada ao contato. Se decidir que não deve enviar uma mensagem agora, o valor deve ser null.",
                        "nova_situacao": "Um status curto que descreva o estado atual da conversa (ex: 'Aguardando Resposta', 'Dúvida Esclarecida', 'Atendente Chamado').",
                        "observacoes": "Um resumo interno e conciso da interação para salvar no CRM."
                    },
                    "regras_importantes": {
                        "Sempre escape barras invertidas (\\) com outra barra (\\\\) dentro dos valores de string do JSON.",
                        "O JSON deve ser estritamente válido e pronto para ser processado por um parser."
                    }
                },
                "configuracao_persona": config.prompt_config,
                "contexto_planilha": contexto_planilha or {"aviso": "Nenhum contexto de planilha foi fornecido."},
                "dados_atuais_conversa": {
                    "tarefa_imediata": "Analisar a última mensagem do contato e formular a PRÓXIMA resposta seguindo a `instrucao_geral`.",
                    "historico_conversa": formatted_history
                }
            }
            
            final_prompt_str = json.dumps(master_prompt, ensure_ascii=False, indent=2, cls=SetEncoder)
            
            response = self._generate_with_retry(final_prompt_str)
            
            clean_response = response.text.strip().replace("```json", "").replace("```", "")
            return json.loads(clean_response)

        except Exception as e:
            logger.error(f"Erro ao gerar ação de conversação com Gemini após todas as tentativas: {e}", exc_info=True)
            return { "mensagem_para_enviar": None, "nova_situacao": "Erro IA", "observacoes": f"Falha da IA: {str(e)}" }

    def _format_history_for_prompt(self, db_history: List[dict]) -> List[Dict[str, str]]:
        history_for_ia = []
        for msg in db_history:
            role = "ia" if msg.get("role") == "assistant" else "contato"
            content = msg.get("content", "")
            history_for_ia.append({"remetente": role, "mensagem": content})
        return history_for_ia


_gemini_service_instance = None
def get_gemini_service():
    global _gemini_service_instance
    if _gemini_service_instance is None:
        _gemini_service_instance = GeminiService()
    return _gemini_service_instance
