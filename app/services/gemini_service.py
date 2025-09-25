import google.generativeai as genai
from google.api_core import exceptions
import time
import logging
import json
from datetime import datetime
from typing import Optional, List, Dict, Any

from app.core.config import settings
from app.db import models

logger = logging.getLogger(__name__)

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

    def _generate_with_retry(self, prompt: Any, is_media: bool = False) -> genai.types.GenerateContentResponse:
        """
        Executa a chamada para a API Gemini com lógica de retentativa e rotação de chaves.
        """
        gen_config = {"response_mime_type": "application/json"} if not is_media else None

        initial_key_index = self.current_key_index
        max_attempts_per_key = 2
        
        while True:
            for attempt in range(max_attempts_per_key):
                try:
                    return self.model.generate_content(prompt, generation_config=gen_config)
                except exceptions.ResourceExhausted as e:
                    logger.warning(f"Quota da API excedida (429) com a chave {self.current_key_index} (tentativa {attempt + 1}/{max_attempts_per_key}).")
                    if attempt == max_attempts_per_key - 1:
                        break 
                    time.sleep(5)
                except (exceptions.InvalidArgument, genai.types.BlockedPromptException) as e:
                    logger.error(f"Erro não recuperável com a API Gemini: {type(e).__name__}. Não haverá nova tentativa. Erro: {e}", exc_info=True)
                    raise e
                except Exception as e:
                    logger.error(f"Erro inesperado ({type(e).__name__}) na API Gemini com a chave {self.current_key_index}. Tentativa {attempt + 1}/{max_attempts_per_key}. Erro: {e}")
                    time.sleep(5)
            
            new_key_index = self._rotate_key()
            
            if new_key_index == initial_key_index:
                raise Exception(f"Todas as {len(self.api_keys)} chaves de API excederam a quota. Não é possível continuar.")

    # --- ALTERADO ---: A função agora recebe o histórico do banco de dados como contexto.
    def transcribe_and_analyze_media(self, media_data: dict, db_history: List[dict]) -> str:
        logger.info(f"Iniciando transcrição/análise para mídia do tipo {media_data.get('mime_type')}")
        prompt_parts = []
        
        if 'audio' in media_data['mime_type']:
            task = "Sua única tarefa é transcrever o áudio a seguir. Retorne apenas o texto transcrito, sem adicionar nenhuma outra palavra ou formatação."
            prompt_parts.extend([task, media_data])
        else:
            formatted_history = self._format_history_for_prompt(db_history)
            task = (
                "Você é um especialista em análise de documentos e imagens. Baseado no histórico de conversa a seguir, "
                "analise o arquivo enviado pelo contato e descreva seu conteúdo de forma concisa e objetiva. "
                "Sua resposta será usada como uma anotação interna no CRM."
                "\n\n"
                "HISTÓRICO DA CONVERSA:\n"
                f"{json.dumps(formatted_history, ensure_ascii=False, indent=2)}\n\n"
                "REGRAS:\n"
                "1. Foque no conteúdo do arquivo (imagem ou documento).\n"
                "2. Conecte o conteúdo do arquivo com o que foi discutido na conversa, se aplicável.\n"
                "3. Retorne APENAS o texto da análise, sem nenhuma outra palavra ou formatação."
            )
            prompt_parts.extend([task, media_data])

        try:
            response = self._generate_with_retry(prompt_parts, is_media=True)
            transcription = response.text.strip()
            logger.info(f"Transcrição/Análise gerada: '{transcription[:100]}...'")
            return transcription
        except Exception as e:
            logger.error(f"Erro ao transcrever/analisar mídia após todas as tentativas: {e}")
            return f"[Erro ao processar mídia: {media_data.get('mime_type')}]"

    def generate_conversation_action(
        self,
        config: models.Config,
        contact: models.Contact,
        conversation_history_db: List[dict],
        contexto_planilha: Optional[Dict[str, Any]]
    ) -> dict:
        try:
            formatted_history = self._format_history_for_prompt(conversation_history_db)

            master_prompt = {
                 "instrucao_geral": (
                    "Você é um assistente de IA especialista em atendimento. Siga estas regras em ordem de prioridade:\n"
                    "1. **Prioridade Máxima ao Contexto:** Sua principal fonte de verdade é o `contexto_planilha`. **Sempre** procure a resposta neste contexto primeiro.\n"
                    "2. **Conhecimento Geral como Alternativa:** Se, e **somente se**, a informação não estiver no `contexto_planilha`, você pode usar o seu conhecimento geral para formular a resposta.\n"
                    "3. **Não Invente Respostas:** Se a pergunta for muito específica e você não tiver a informação, responda educadamente que irá verificar e peça para aguardar um pouco.\n"
                    "4. **Mantenha a Persona:** Siga sempre o tom de voz e o objetivo definidos em `configuracao_persona`.\n"
                    "5. **Fluxo de Resolução e Encaminhamento:** Seu objetivo principal é resolver a dúvida do cliente. Siga este fluxo:\n"
                    "   a. **Primeira Tentativa:** Responda à pergunta do cliente da forma mais clara e completa possível, usando o contexto disponível.\n"
                    "   b. **Segunda Tentativa (Reabordagem):** Se o cliente repetir a mesma dúvida ou disser que não entendeu, explique de forma diferente, use uma analogia ou quebre em passos menores. No fim, pergunte: 'Ficou mais claro agora?'.\n"
                    "   c. **Terceira Tentativa (Exemplo Prático):** Se o cliente ainda estiver confuso, traga um exemplo prático simples e direto, relacionado ao caso dele.\n"
                    "   d. **Encaminhamento (Último Recurso):** Se, após 3 tentativas no mesmo assunto, o cliente ainda expressar dúvida, confusão ou insatisfação, você deve encaminhá-lo a um atendente humano. Nesse caso, sua resposta JSON deve conter:\n"
                    "      - `mensagem_para_enviar`: Uma orientação para o bot **pedir desculpas**, informar que vai transferir para outro atendente e solicitar que o cliente aguarde um momento. (não copie exatamente este texto, use como referência)\n"
                    "      - `nova_situacao`: 'Atendente Chamado'\n"

                 ),
                 "formato_resposta_obrigatorio": {
                     "descricao": "Sua resposta DEVE ser um único objeto JSON válido, sem nenhum texto ou formatação adicional (como ```json).",
                     "chaves": {
                         "mensagem_para_enviar": "O texto da mensagem a ser enviada ao contato. Se decidir que não deve enviar uma mensagem agora, o valor deve ser null.",
                         "nova_situacao": "Um status curto que descreva o estado atual da conversa (ex: 'Aguardando Resposta', 'Dúvida Esclarecida', 'Atendente Chamado').",
                         "observacoes": "Um resumo interno e conciso da interação para salvar no CRM."
                     }
                 },
                 "configuracao_persona": config.prompt_config,
                 "contexto_planilha": contexto_planilha or {"aviso": "Nenhum contexto de planilha foi fornecido."},
                 "dados_atuais_conversa": {
                     "tarefa_imediata": "Analisar a última mensagem do contato e formular a PRÓXIMA resposta seguindo a `instrucao_geral`.",
                     "historico_conversa": formatted_history
                 }
            }
            
            final_prompt_str = json.dumps(master_prompt, ensure_ascii=False, indent=2)
            response = self._generate_with_retry(final_prompt_str)
            
            clean_response = response.text.strip().replace("```json", "").replace("```", "")
            return json.loads(clean_response)

        except Exception as e:
            logger.error(f"Erro ao gerar ação de conversação com Gemini após todas as tentativas: {e}")
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