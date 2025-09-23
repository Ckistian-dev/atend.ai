# app/services/gemini_service.py

import google.generativeai as genai
from google.api_core import exceptions
import time
import logging
import json
import re
from datetime import datetime
from typing import Optional, List, Dict, Any

from app.core.config import settings
from app.db import models

logger = logging.getLogger(__name__)

class GeminiService:
    def __init__(self):
        try:
            genai.configure(api_key=settings.GOOGLE_API_KEY)
            self.generation_config = {"temperature": 0.5, "top_p": 1, "top_k": 1}
            self.model = genai.GenerativeModel(
                model_name='gemini-1.5-flash',
                generation_config=self.generation_config
            )
            logger.info("✅ Cliente Gemini inicializado com sucesso (gemini-1.5-flash).")
        except Exception as e:
            logger.error(f"🚨 ERRO CRÍTICO ao configurar o Gemini: {e}")
            raise

    def _generate_with_retry(self, prompt: Any) -> genai.types.GenerateContentResponse:
        """Executa a chamada para a API Gemini com lógica de retentativa."""
        max_retries = 3
        attempt = 0
        while attempt < max_retries:
            try:
                return self.model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
            except exceptions.ResourceExhausted as e:
                attempt += 1
                logger.warning(f"Quota da API excedida (429). Tentativa {attempt}/{max_retries}.")
                wait_time = (2 ** attempt) * 5
                logger.info(f"Aguardando {wait_time} segundos para nova tentativa...")
                time.sleep(wait_time)
            except Exception as e:
                logger.error(f"Erro inesperado ao gerar conteúdo com Gemini: {e}")
                raise e
        raise Exception(f"Não foi possível obter uma resposta da API Gemini após {max_retries} tentativas.")

    def _replace_variables_in_dict(self, config_dict: Dict[str, Any], contact_data: models.Contact) -> Dict[str, Any]:
        """Substitui variáveis dinâmicas em toda a estrutura do dicionário de configuração."""
        config_str = json.dumps(config_dict)
        now = datetime.now()
        days_in_portuguese = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado", "Domingo"]
        
        replacements = {
            "{{data_atual}}": now.strftime("%d/%m/%Y"),
            "{{dia_semana}}": days_in_portuguese[now.weekday()],
            "{{observacoes_contato}}": contact_data.observacoes or ""
        }
        
        for var, value in replacements.items():
            config_str = config_str.replace(var, value)
        
        return json.loads(config_str)

    def _format_history_for_prompt(self, db_history: List[dict]) -> List[Dict[str, str]]:
        """Formata o histórico do banco de dados para um formato simples de JSON."""
        history_for_ia = []
        for msg in db_history:
            role = "ia" if msg.get("role") == "assistant" else "contato"
            content = msg.get("content", "")
            history_for_ia.append({"remetente": role, "mensagem": content})
        return history_for_ia
        
    def transcribe_and_analyze_media(self, media_data: dict, db_history: List[dict]) -> str:
        """Transcreve áudio ou analisa imagem/documento no contexto da conversa."""
        logger.info(f"Iniciando transcrição/análise para mídia do tipo {media_data.get('mime_type')}")
        prompt_parts = []
        
        if 'audio' in media_data['mime_type']:
            task = "Sua única tarefa é transcrever o áudio a seguir. Retorne apenas o texto transcrito, sem adicionar nenhuma outra palavra ou formatação."
            prompt_parts.append(task)
            prompt_parts.append(media_data)
        else:
            task = "Você recebeu um arquivo (imagem ou documento) do contato. Analise o conteúdo do arquivo e retorne um resumo conciso do que ele representa, como se fosse uma anotação para o CRM. Retorne APENAS o texto do resumo."
            prompt_parts.append(task)
            prompt_parts.append(media_data)

        try:
            response = self.model.generate_content(prompt_parts)
            transcription = response.text.strip()
            logger.info(f"Transcrição/Análise gerada: '{transcription[:100]}...'")
            return transcription
        except Exception as e:
            logger.error(f"Erro ao transcrever/analisar mídia: {e}")
            return f"[Erro ao processar mídia: {media_data.get('mime_type')}]"

    def generate_conversation_action(
        self,
        config: models.Config,
        contact: models.Contact,
        conversation_history_db: List[dict],
        contexto_planilha: Optional[Dict[str, Any]]
    ) -> dict:
        """
        Constrói um ÚNICO prompt JSON com persona, histórico e o CONTEXTO da planilha.
        """
        try:
            campaign_config = self._replace_variables_in_dict(config.prompt_config, contact)
            formatted_history = self._format_history_for_prompt(conversation_history_db)

            master_prompt = {
                "instrucao_geral": (
                    "Você é um assistente de IA especialista em atendimento. Siga estas regras em ordem de prioridade:\n"
                    "1. **Prioridade Máxima ao Contexto:** Sua principal fonte de verdade é o `contexto_planilha`. **Sempre** procure a resposta neste contexto primeiro.\n"
                    "2. **Conhecimento Geral como Alternativa:** Se, e **somente se**, a informação não estiver no `contexto_planilha`, você pode usar o seu conhecimento geral para formular a resposta.\n"
                    "3. **Não Invente Respostas:** Se a pergunta for muito específica e você não tiver a informação (nem no contexto, nem no seu conhecimento), responda educadamente que irá verificar e peça para aguardar um pouco.\n"
                    "4. **Mantenha a Persona:** Siga sempre o tom de voz e o objetivo definidos em `configuracao_persona`."
                ),
                "formato_resposta_obrigatorio": {
                    "descricao": "Sua resposta DEVE ser um único objeto JSON válido, sem nenhum texto ou formatação adicional (como ```json).",
                    "chaves": {
                        "mensagem_para_enviar": "O texto da mensagem a ser enviada ao contato. Se decidir que não deve enviar uma mensagem agora, o valor deve ser null.",
                        "nova_situacao": "Um status curto que descreva o estado atual da conversa (ex: 'Aguardando Resposta', 'Dúvida Respondida').",
                        "observacoes": "Um resumo interno e conciso da interação para salvar no CRM."
                    }
                },
                "configuracao_persona": campaign_config,
                "contexto_planilha": contexto_planilha or {"aviso": "Nenhum contexto de planilha foi fornecido."},
                "dados_atuais_conversa": {
                    "contato_identificador": contact.whatsapp,
                    "tarefa_imediata": "Analisar a última mensagem do contato e formular a PRÓXIMA resposta seguindo a `instrucao_geral`.",
                    "historico_conversa": formatted_history
                }
            }

            final_prompt_str = json.dumps(master_prompt, ensure_ascii=False, indent=2)
            response = self._generate_with_retry(final_prompt_str)
            
            clean_response = response.text.strip().replace("```json", "").replace("```", "")
            return json.loads(clean_response)

        except Exception as e:
            logger.error(f"Erro ao gerar ação de conversação com Gemini: {e}")
            # --- ALTERAÇÃO AQUI ---
            # Em caso de erro, não enviamos nenhuma mensagem ao cliente.
            # Apenas registamos o erro internamente.
            return {
                "mensagem_para_enviar": None,
                "nova_situacao": "Erro IA",
                "observacoes": f"Falha da IA: {str(e)}"
            }

_gemini_service_instance = None
def get_gemini_service():
    global _gemini_service_instance
    if _gemini_service_instance is None:
        _gemini_service_instance = GeminiService()
    return _gemini_service_instance