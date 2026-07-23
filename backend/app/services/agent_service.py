import os
import logging
import math
import asyncio
import weakref
from typing import Optional, Literal, Any, Dict, List
from dataclasses import dataclass
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.config import settings

# Garante que GOOGLE_API_KEY esteja configurada para a inicialização do Pydantic AI
if not os.environ.get("GOOGLE_API_KEY") and settings.GOOGLE_API_KEYS:
    keys = [k.strip() for k in settings.GOOGLE_API_KEYS.split(",") if k.strip()]
    if keys:
        os.environ["GOOGLE_API_KEY"] = keys[0]

from pydantic_ai import Agent, RunContext, AgentRunResult

# Importações do seu sistema
from app.db import models
from app.crud import crud_user
from app.services.gemini_service import get_gemini_service
from app.services.google_calendar_service import get_google_calendar_service

logger = logging.getLogger(__name__)

# Locks globais para garantir ordem sequencial no envio de mensagens por atendimento
_atendimento_locks = weakref.WeakValueDictionary()
_locks_lock = asyncio.Lock()

async def get_atendimento_lock(atendimento_id: int) -> asyncio.Lock:
    async with _locks_lock:
        lock = _atendimento_locks.get(atendimento_id)
        if lock is None:
            lock = asyncio.Lock()
            _atendimento_locks[atendimento_id] = lock
        return lock

# =====================================================================
# 1. TABELA DE PREÇOS E CONFIGURAÇÃO FINANCEIRA
# =====================================================================
# A base do sistema é 0.25. 
BASE_FLASH_PRICE = 0.25

def carregar_tabela_precos() -> Dict[str, Dict[str, float]]:
    import json
    tabela = {
        "gemini-3.1-flash-lite": {
            "input_text": 0.25,
            "output": 1.50,
        }
    }
    try:
        current_dir = os.path.dirname(os.path.abspath(__file__))
        models_json_path = os.path.normpath(os.path.join(current_dir, "../constants/models.json"))
        if os.path.exists(models_json_path):
            with open(models_json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            models_data = data.get("LLM_MODELS", [])
            for model in models_data:
                m_id = model["id"]
                pricing = model.get("pricing", {})
                tabela[m_id] = {
                    "input_text": pricing.get("input_text", 0.25),
                    "output": pricing.get("output", 1.50)
                }
            logger.info(f"✅ Tabela de preços carregada no agent_service: {list(tabela.keys())}")
    except Exception as e:
        logger.error(f"Erro ao carregar models.json em agent_service.py: {e}")
    return tabela

TABELA_PRECOS = carregar_tabela_precos()

# =====================================================================
# 2. CONTEXTO SEGURO (MULTI-TENANT)
# =====================================================================
@dataclass
class ContextoSaaS:
    """
    Carrega os dados da requisição atual.
    Garante que a IA e as ferramentas só acessem os dados desta empresa específica.
    """
    db: Optional[AsyncSession]
    company_id: int
    config_id: int
    atendimento_id: int
    nome_cliente: str
    data_hora_atual: str
    persona_prompt: str
    regras_adicionais: Optional[str] = None
    model_name: str = "gemini-3.1-flash-lite"
    rag_context: Optional[str] = None
    workflow_context: Optional[str] = None
    calendar_context: Optional[str] = None
    available_tags: Optional[List[str]] = None
    drive_ativo: bool = False
    calendar_ativo: bool = False
    categorias_conhecimento: Optional[List[str]] = None

    # --- CAMPOS DE CONFIGURAÇÃO DE INFERÊNCIA (vindos do persona_config do cliente) ---
    temperature: float = 0.1
    top_p: float = 0.95
    top_k: int = 40
    thinking_budget: Optional[int] = None
    thinking_level: Optional[str] = "medium"
    tts_voice: str = "Aoede"

    # --- CAMPOS PARA MICRO-TOOLS ---
    empresa: Optional[models.Company] = None
    atendimento: Optional[models.Atendimento] = None
    whatsapp_service: Optional[Any] = None


from pydantic import BaseModel, Field

class RespostaAgente(BaseModel):
    resumo: str = Field(
        description="Resumo completo, consolidado e atualizado de TODA a conversa com o cliente até o momento, cobrindo o histórico completo, dúvidas apresentadas, produtos/serviços pesquisados e o status/desfecho atual."
    )

# =====================================================================
# 3. O AGENTE (MAESTRO)
# =====================================================================
agente_atendimento = Agent(
    'google:gemini-3.1-flash-lite', # Modelo padrão (pode ser sobrescrito dinamicamente)
    deps_type=ContextoSaaS,
    output_type=RespostaAgente, # <--- A MÁGICA DO JSON EXATO AQUI
    retries=2 # Se a IA errar os parâmetros da ferramenta, tenta corrigir sozinha até 2 vezes
)

@agente_atendimento.system_prompt
def construir_prompt_base(ctx: RunContext[ContextoSaaS]) -> str:
    """Monta o cérebro da IA sob demanda, isolando as regras e o contexto da empresa."""
    deps = ctx.deps
    
    # 1. Workflow
    workflow_sec = (
        f"### FLUXO DE ATENDIMENTO (ROTEIRO OBRIGATÓRIO)\n"
        f"Você DEVE seguir o roteiro abaixo como um script de conversa:\n"
        f"1. Analise o histórico recente da conversa e identifique a etapa numerada atual.\n"
        f"2. Execute a instrução da etapa atual antes de avançar.\n"
        f"3. Avance para a próxima etapa SOMENTE quando a condição em 'Próximo passo' for plenamente satisfeita.\n"
        f"4. NUNCA pule etapas nem retorne a etapas já concluídas.\n"
        f"5. Caso o cliente faça uma pergunta fora do roteiro, responda com base no RAG e retome o fluxo em seguida.\n\n"
        f"{deps.workflow_context}\n\n"
    ) if deps.workflow_context else ""

    # 2. Tags disponíveis no CRM
    tags_rule = f"### TAGS DISPONÍVEIS NO CRM\n{' | '.join(deps.available_tags)}\n\n" if deps.available_tags else ""
    
    # 3. Contexto da Agenda
    calendar_sec = f"{deps.calendar_context}\n\n" if deps.calendar_context else ""
    
    # 4. Drive (somente se ativo)
    drive_rule = (
        "### DRIVE - ENVIO DE MÍDIAS E ARQUIVOS:\n"
        "- Envie arquivos APENAS quando o cliente solicitar expressamente.\n"
        "- Use SOMENTE IDs de arquivos que existam no retorno literal de `pesquisar_base_de_dados` pesquisando nas categorias `image` e `video`. PROIBIDO inventar IDs.\n\n"
    ) if deps.drive_ativo else ""

    # 5. Agendamento (somente se ativo)
    sched_rule = (
        "### REGRAS DE AGENDAMENTO:\n"
        "1. ANTES de sugerir ou propor qualquer horário, chame obrigatoriamente `consultar_agenda_google`.\n"
        "2. Ao confirmar um horário desejado pelo cliente, solicite o e-mail dele para o convite.\n"
        "3. Com o horário ISO e o e-mail em mãos, execute imediatamente a ferramenta `agendar_reuniao`.\n\n"
    ) if deps.calendar_ativo else ""

    # 6. Categorias do RAG
    categorias_sec = (
        f"### CATEGORIAS DA BASE DE CONHECIMENTO\n"
        f"Ao utilizar a ferramenta `pesquisar_base_de_dados`, você DEVE utilizar o parâmetro 'categoria_alvo' especificando a categoria mais relevante da busca sempre que aplicável. Categorias disponíveis: {', '.join(deps.categorias_conhecimento)}\n\n"
    ) if deps.categorias_conhecimento else ""

    # 7. Regra de áudio
    audio_rule = (
        "- ÁUDIOS: Use `enviar_mensagem_audio` preferencialmente se o cliente solicitou ou esteja na instrução inicial.\n"
    ) if deps.tts_voice else ""

    # 8. Ferramentas de envio disponíveis
    ferramenta_audio_txt = ", `enviar_mensagem_audio` (voz)" if deps.tts_voice else ""
    ferramenta_drive_txt = " ou `enviar_arquivo_do_drive` (mídias/documentos)" if deps.drive_ativo else ""

    # 9. Diretriz de Nome do Cliente (CRM)
    if deps.nome_cliente and deps.nome_cliente != "Desconhecido":
        pedir_nome_permitido = (
            f"O nome do cliente já está cadastrado no CRM: '{deps.nome_cliente}'. "
            f"Trate-o naturalmente por esse nome e NUNCA pergunte o nome novamente."
        )
    else:
        pedir_nome_permitido = (
            "O nome do cliente é desconhecido. Pergunte gentilmente como ele se chama "
            "para salvá-lo no CRM via `atualizar_nome_contato`.\n"
            "LIMITAÇÃO DE SEGURANÇA: Limite-se a no máximo 2 tentativas de obter o nome ao longo de todo o histórico da conversa. "
            "Se o cliente ignorou, mudou de assunto ou preferiu não informar, NÃO pergunte novamente sob hipótese alguma e prossiga o atendimento normalmente."
        )

    prompt = (
        f"--- IDENTIDADE E PERSONA DA EMPRESA ---\n"
        f"{deps.persona_prompt}\n\n"
        f"{workflow_sec}{tags_rule}{categorias_sec}{calendar_sec}{drive_rule}{sched_rule}"
        f"--- REGRAS DE USO DAS FERRAMENTAS ---\n"
        f"1. COMUNICAÇÃO EXTERNA: Você se comunica com o cliente EXCLUSIVAMENTE invocando as ferramentas "
        f"`enviar_mensagem_texto` (texto){ferramenta_audio_txt}{ferramenta_drive_txt}. "
        f"Sem chamar uma dessas ferramentas, nenhuma mensagem é entregue ao cliente.\n"
        f"2. BALÕES INDIVIDUAIS: Envie cada frase ou ideia em chamadas separadas e individuais de "
        f"`enviar_mensagem_texto`{', `enviar_mensagem_audio`' if deps.tts_voice else ''}. "
        f"PROIBIDO agrupar múltiplos assuntos em um único envio.\n"
        f"3. AVISO PRÉVIO DE CONSULTA: Antes de pesquisar no banco de dados ou checar a agenda, avise brevemente o cliente "
        f"enviando um balão rápido via `enviar_mensagem_texto` antes de chamar a busca.\n"
        f"4. DATA E HORA LOCAL: Para consultar a data, a hora exata e o dia da semana atual no horário local, chame a ferramenta `obter_data_hora_atual`.\n"
        f"{audio_rule}\n"
        f"--- CRM E GESTÃO DE ATENDIMENTO ---\n"
        f"- NOME DO CLIENTE: {pedir_nome_permitido}\n"
        f"são atualizados automaticamente pelas ferramentas do backend. NUNCA envie o texto desses status como mensagem para o cliente.\n"
        f"- RESUMO CONSOLIDADO: O campo 'resumo' do resultado final da IA DEVE conter uma síntese acumulada de TODA a conversa "
        f"realizada com o cliente até o momento (histórico completo + nova interação), destacando os assuntos tratados, dúvidas, produtos de interesse e o status atual. "
        f"NUNCA limite o resumo apenas à última mensagem trocada.\n"
        f"- GESTÃO DE TAGS: As tags disponíveis no CRM estão listadas na seção 'TAGS DISPONÍVEIS NO CRM' deste prompt. Para aplicar uma tag ao cliente, acione diretamente a ferramenta `adicionar_tag_ao_cliente(nome_da_tag)`.\n"
        f"- PROTOCOLO DE TRANSBORDO DO ATENDIMENTO:\n"
        f"  1. Verifique regras de transferência nas INSTRUÇÕES ADICIONAIS e respeite todas as condições.\n"
        f"  2. Envie um aviso amigável via `enviar_mensagem_texto`{' ou `enviar_mensagem_audio`' if deps.tts_voice else ''}.\n"
        f"  3. Execute a ferramenta `transferir_para_atendente`.\n"
        f"- CONCLUSÃO: Quando a solicitação for finalizada com sucesso -> execute `concluir_atendimento`.\n\n"
        f"--- DIRETRIZES DE HUMANIZAÇÃO E FORMATO ---\n"
        f"- BALÕES CURTOS E DIRETOS: Escreva frases curtas, objetivas e conversacionais (máximo de 1 a 2 frases por balão). "
        f"EVITE parágrafos longos, explicações prolixas ou blocos massivos de texto.\n"
        f"- TOM NATURAL E ADEQUADO: Espelhe a formalidade e pontuação do cliente. Evite jargões corporativos e saudações repetitivas.\n"
        f"- FORMATO WHATSAPP: Use exclusivamente `*negrito*` (1 asterisco), `_itálico_` e `~tachado~`. "
        f"PROIBIDO usar `**duplo asterisco**` (marcação Markdown padrão não funciona no WhatsApp).\n\n"
        f"--- PESQUISA E CONSTRUÇÃO DO TERMO DE BUSCA (RAG) ---\n"
        f"1. BUSCA POR TEXTO ('texto'): Extraia APENAS de 1 a 3 palavras-chave substantivas exatas (nomes de produtos, modelos, materiais, cores).\n"
        f"   - PROIBIDO incluir verbos (como 'custa', 'quero', 'tem', 'saber'), artigos, preposições ou saudações.\n"
        f"2. BUSCA SEMÂNTICA ('semantica'): Utilize para dúvidas conceituais, termos explicativos, políticas da empresa ou perguntas completas.\n"
        f"3. FILTRO DE CATEGORIA ('categoria_alvo'): Sempre que houver categorias disponíveis na base de conhecimento ({', '.join(deps.categorias_conhecimento) if deps.categorias_conhecimento else 'nenhuma'}), preencha OBRIGATORIAMENTE o parâmetro `categoria_alvo` com a categoria mais adequada para refinar e direcionar a pesquisa.\n"
        f"4. BUSCA ECONÔMICA E SELETIVA: Na ferramenta `pesquisar_base_de_dados`, você pode definir `quantidade_resultados` (entre 1 e 5). "
        f"Solicite apenas a quantidade estritamente necessária (ex: 2 a 3 resultados) para responder ao cliente de forma eficiente.\n\n"
        f"--- PROTOCOLO ANTI-ALUCINAÇÃO (PRIORIDADE MÁXIMA) ---\n"
        f"1. DADOS FACTUAIS REAIS: Preços, estoques, especificações técnicas, prazos, mídias e horários DEVEM vir do retorno literal de "
        f"`pesquisar_base_de_dados` ou `consultar_agenda_google`. PROIBIDO inventar ou inferir dados inexistentes.\n"
        f"2. OBRIGATORIEDADE DE PESQUISA: Antes de responder a qualquer dúvida sobre produtos ou serviços, chame `pesquisar_base_de_dados`.\n"
        f"3. ADMISSÃO DE IGNORÂNCIA E ESCALAÇÃO: Se após ambas as buscas os dados não forem encontrados, admita honestamente que não possui a informação, verifique se precisa de mais algo ou então realize o protocolo de TRANSBORDO.\n"
        f"   - PROIBIDO usar termos de incerteza como: 'acredito que', 'provavelmente', 'deve ser cerca de'.\n"
        f"4. VALORES E PREÇOS EXATOS: Informe sempre o valor exato retornado da base de dados. Calcule passo a passo qualquer valor solicitado pelo cliente .\n"
    )

    if deps.regras_adicionais:
        prompt += f"\n--- INSTRUÇÕES ADICIONAIS DA EMPRESA ---\n{deps.regras_adicionais}\n"
        
    return prompt


# =====================================================================
# 4. FERRAMENTAS DO AGENTE (MICRO-TOOLS)
# =====================================================================

@agente_atendimento.tool
async def obter_data_hora_atual(ctx: RunContext[ContextoSaaS]) -> str:
    """
    Use esta ferramenta para consultar a data, a hora exata e o dia da semana atual no horário local (Horário de Brasília).
    Chame esta ferramenta sempre que precisar saber o momento exato em que o atendimento está ocorrendo, 
    qual dia da semana é hoje ou responder dúvidas do cliente sobre data e hora.
    """
    import pytz
    from datetime import datetime

    tz = pytz.timezone("America/Sao_Paulo")
    now = datetime.now(tz)

    dias_semana = [
        "Segunda-feira",
        "Terça-feira",
        "Quarta-feira",
        "Quinta-feira",
        "Sexta-feira",
        "Sábado",
        "Domingo"
    ]
    dia_semana_str = dias_semana[now.weekday()]
    data_formatada = now.strftime("%d/%m/%Y")
    hora_formatada = now.strftime("%H:%M:%S")

    resultado = f"Data e Hora Atual: {dia_semana_str}, {data_formatada} às {hora_formatada} (Horário de Brasília)."
    logger.info(f"[Tool Executada] obter_data_hora_atual | Retorno: '{resultado}'")
    return resultado


@agente_atendimento.tool
async def pesquisar_base_de_dados(
    ctx: RunContext[ContextoSaaS], 
    termo_busca: str,
    tipo_busca: Literal['texto', 'semantica'],
    categoria_alvo: Optional[str] = None,
    quantidade_resultados: int = 3
) -> str:
    """
    Pesquisa a base de conhecimento da empresa (planilhas e mídias do Drive).

    REGRA CRÍTICA - 'termo_busca':
    - Se tipo_busca='texto': Use APENAS de 1 a 3 palavras-chave substantivas exatas (nomes de produtos, marcas, cores, etc.).
      É EXPRESSAMENTE PROIBIDO incluir verbos (como "custa", "quero", "saber", "tem"), preposições, artigos, pronomes ou saudações.
      Exemplos corretos: "Ripado Freijo", "Dobradica 35mm", "Fechadura Cromada".
      Exemplos incorretos: "qual o valor do ripado freijo", "preco da dobradica", "quero saber se tem fechadura".
    - Se tipo_busca='semantica': Use para dúvidas conceituais, políticas da empresa ou perguntas completas (FAQ).
      Exemplo: "Qual a politica de entrega?"

    REGRA CRÍTICA - 'categoria_alvo':
    - Nome exato de uma categoria disponível listada no prompt.
    - SEMPRE que a pesquisa pertencer a uma categoria específica, você DEVE informar este parâmetro para refinar e filtrar a busca.
    - Se não houver categoria adequada ou para pesquisar em toda a base, passe null.
    - Para pesquisar mídias, use as categorias `image` e `video`.

    'quantidade_resultados': número de resultados a retornar (entre 1 e 5). SEJA ECONÔMICO: peça apenas a quantidade estritamente necessária.
    """
    limite_real = min(max(quantidade_resultados, 1), 5)
    logger.info(f"[Tool Executada] pesquisar_base_de_dados | termo_busca='{termo_busca}', tipo_busca='{tipo_busca}', categoria_alvo='{categoria_alvo}', quantidade_resultados={limite_real}")
    config_id = ctx.deps.config_id

    from app.db.database import SessionLocal
    async with SessionLocal() as db:
        from sqlalchemy import func
        # LOG DE DIAGNÓSTICO: Verifica se existem registros de KnowledgeVector para esta persona
        try:
            count_stmt = select(func.count(models.KnowledgeVector.id)).where(models.KnowledgeVector.config_id == config_id)
            res_count = await db.execute(count_stmt)
            total_records = res_count.scalar() or 0
            logger.info(f"[Diagnóstico Busca] Total de vetores de conhecimento cadastrados para a config_id {config_id}: {total_records}")
            
            if total_records > 0 and categoria_alvo:
                count_cat_stmt = select(func.count(models.KnowledgeVector.id)).where(
                    models.KnowledgeVector.config_id == config_id,
                    models.KnowledgeVector.category.ilike(categoria_alvo.strip())
                )
                res_cat_count = await db.execute(count_cat_stmt)
                total_cat_records = res_cat_count.scalar() or 0
                logger.info(f"[Diagnóstico Busca] Total de vetores mapeados em '{categoria_alvo}' para a config_id {config_id}: {total_cat_records}")
        except Exception as diag_err:
            logger.error(f"[Diagnóstico Busca] Erro ao contar vetores de conhecimento: {diag_err}")

        # Inicia a query filtrando estritamente pela persona atual
        query = select(models.KnowledgeVector).where(models.KnowledgeVector.config_id == config_id)
        if categoria_alvo and categoria_alvo.strip():
            query = query.where(models.KnowledgeVector.category.ilike(categoria_alvo.strip()))

        try:
            vetores_encontrados = []
            if tipo_busca == 'texto':
                logger.info(f"Busca TEXTUAL acionada para: '{termo_busca}' na config {config_id}")
                
                # Divisão simples por palavras sem stopwords hardcoded na aplicação
                termos = [t for t in termo_busca.replace("?", "").replace("!", "").replace(",", "").replace(".", "").split() if len(t) > 1]
                
                text_query = query
                for t in termos:
                    text_query = text_query.where(models.KnowledgeVector.content.ilike(f"%{t}%"))
                text_query = text_query.limit(limite_real)
                
                result = await db.execute(text_query)
                vetores_encontrados = result.scalars().all()
                logger.info(f"Busca TEXTUAL para '{termo_busca}' (categoria: '{categoria_alvo}') retornou {len(vetores_encontrados)} registros.")
                
                if not vetores_encontrados:
                    logger.info(f"Busca TEXTUAL para '{termo_busca}' retornou zero resultados. Iniciando fallback automático para SEMÂNTICA...")
                    tipo_busca = 'semantica'

            if tipo_busca == 'semantica':
                logger.info(f"Busca SEMÂNTICA acionada para: '{termo_busca}' na config {config_id}")
                gemini_svc = get_gemini_service()
                query_embedding = await gemini_svc.generate_embedding(termo_busca)
                
                if not query_embedding:
                    logger.error("Busca SEMÂNTICA falhou: Não foi possível gerar o vetor/embedding no Gemini.")
                    return "Erro interno: Não foi possível gerar o vetor para a busca."

                # Para diagnóstico, vamos pesquisar os mais próximos sem threshold de corte primeiro para logar a distância
                diag_query = select(
                    models.KnowledgeVector,
                    models.KnowledgeVector.embedding.cosine_distance(query_embedding).label("distancia")
                ).where(
                    models.KnowledgeVector.config_id == config_id
                )
                if categoria_alvo and categoria_alvo.strip():
                    diag_query = diag_query.where(models.KnowledgeVector.category.ilike(categoria_alvo.strip()))
                
                diag_query = diag_query.order_by("distancia").limit(3)
                diag_res = await db.execute(diag_query)
                proximos = diag_res.all()
                
                if proximos:
                    logger.info(f"Busca SEMÂNTICA - Top 3 distâncias de cosseno para '{termo_busca}':")
                    for idx, row in enumerate(proximos):
                        v_item, dist = row
                        logger.info(f"  {idx+1}. ID: {v_item.id} | Distância: {dist:.4f} | Conteúdo preliminar: {v_item.content[:80]}...")
                
                # Busca pgvector real com threshold de similaridade de cosseno < 0.65 e limite_real definido
                semantic_query = query.where(
                    models.KnowledgeVector.embedding.cosine_distance(query_embedding) < 0.65
                ).order_by(
                    models.KnowledgeVector.embedding.cosine_distance(query_embedding)
                ).limit(limite_real)

                result = await db.execute(semantic_query)
                vetores_encontrados = result.scalars().all()
                logger.info(f"Busca SEMÂNTICA com threshold < 0.65 para '{termo_busca}' (categoria: '{categoria_alvo}') retornou {len(vetores_encontrados)} registros.")

            # Fallback automático: se a busca com categoria_alvo retornou zero resultados, tenta sem o filtro de categoria
            if not vetores_encontrados and categoria_alvo:
                logger.info(f"Busca com categoria_alvo='{categoria_alvo}' retornou zero resultados. Executando fallback automático sem filtro de categoria...")
                fallback_query = select(models.KnowledgeVector).where(models.KnowledgeVector.config_id == config_id)
                
                termos = [t for t in termo_busca.replace("?", "").replace("!", "").replace(",", "").replace(".", "").split() if len(t) > 1]
                if termos:
                    fb_text = fallback_query
                    for t in termos:
                        fb_text = fb_text.where(models.KnowledgeVector.content.ilike(f"%{t}%"))
                    fb_text = fb_text.limit(limite_real)
                    res_fb = await db.execute(fb_text)
                    vetores_encontrados = res_fb.scalars().all()
                
                if not vetores_encontrados:
                    gemini_svc = get_gemini_service()
                    query_embedding_fb = await gemini_svc.generate_embedding(termo_busca)
                    if query_embedding_fb:
                        fb_semantic = fallback_query.where(
                            models.KnowledgeVector.embedding.cosine_distance(query_embedding_fb) < 0.65
                        ).order_by(
                            models.KnowledgeVector.embedding.cosine_distance(query_embedding_fb)
                        ).limit(limite_real)
                        res_fb = await db.execute(fb_semantic)
                        vetores_encontrados = res_fb.scalars().all()
                        logger.info(f"Fallback semântico sem categoria retornou {len(vetores_encontrados)} registros.")

            if not vetores_encontrados:
                return "Nenhum resultado encontrado para esta busca na base de dados."

            # Prepara a resposta para a IA de forma bem estruturada e limpa (Markdown)
            resposta_formatada = []
            for idx, v in enumerate(vetores_encontrados, 1):
                origem_str = (v.origin or "Base").lower()
                categoria_str = v.category or "Geral"
                
                bloco = []
                bloco.append(f"### REGISTRO {idx} (Origem: {origem_str} | Categoria: {categoria_str})")
                
                if v.raw_data and isinstance(v.raw_data, dict):
                    bloco.append("Dados:")
                    for chave, valor in v.raw_data.items():
                        if valor is not None:
                            val_clean = str(valor).strip()
                            if val_clean:
                                bloco.append(f"  - {chave}: {val_clean}")
                elif v.content:
                    bloco.append("Conteúdo:")
                    bloco.append(f"  {str(v.content).strip()}")
                    
                resposta_formatada.append("\n".join(bloco))

            return "\n\n---\n\n".join(resposta_formatada)

        except Exception as e:
            logger.error(f"Erro na tool de busca: {e}", exc_info=True)
            return "Erro ao realizar a busca no banco de dados."


async def verificar_agenda_ativa(ctx: RunContext[ContextoSaaS], tool_def):
    """Remove ferramentas de agendamento se a funcionalidade estiver desativada."""
    return tool_def if ctx.deps.calendar_ativo else None


@agente_atendimento.tool(prepare=verificar_agenda_ativa)
async def consultar_agenda_google(ctx: RunContext[ContextoSaaS], data_desejada: str = "hoje") -> str:
    """
    Use esta ferramenta SEMPRE que o cliente perguntar sobre horários disponíveis, 
    ou demonstrar intenção de agendar uma visita/reunião.
    
    Parâmetros:
    - data_desejada: A data que o cliente quer (ex: "amanhã", "17/07/2026", "próxima segunda").
    """
    logger.info(f"[Tool Executada] consultar_agenda_google | data_desejada='{data_desejada}'")
    if not ctx.deps.calendar_ativo:
        return "Erro: O sistema de agendamento está desativado para esta empresa. Avise o cliente."

    try:
        from app.db.database import SessionLocal
        async with SessionLocal() as db:
            stmt = select(models.Config).where(models.Config.id == ctx.deps.config_id)
            result = await db.execute(stmt)
            persona_config = result.scalar_one()

        if not persona_config.google_calendar_credentials:
            return "Erro: Credenciais do Google Calendar não configuradas."

        # Parsear data_desejada para obter o range
        import re
        from datetime import datetime, time, timedelta
        import pytz
        
        tz = pytz.timezone("America/Sao_Paulo")
        now_local = datetime.now(tz)
        data_str_clean = data_desejada.strip().lower()
        target_date = now_local.date()
        
        if "amanhã" in data_str_clean or "amanha" in data_str_clean:
            target_date = now_local.date() + timedelta(days=1)
        elif "hoje" in data_str_clean:
            target_date = now_local.date()
        elif "segunda" in data_str_clean:
            days_ahead = (0 - now_local.weekday() + 7) % 7
            if days_ahead == 0: days_ahead = 7
            target_date = now_local.date() + timedelta(days=days_ahead)
        elif "terça" in data_str_clean or "terca" in data_str_clean:
            days_ahead = (1 - now_local.weekday() + 7) % 7
            if days_ahead == 0: days_ahead = 7
            target_date = now_local.date() + timedelta(days=days_ahead)
        elif "quarta" in data_str_clean:
            days_ahead = (2 - now_local.weekday() + 7) % 7
            if days_ahead == 0: days_ahead = 7
            target_date = now_local.date() + timedelta(days=days_ahead)
        elif "quinta" in data_str_clean:
            days_ahead = (3 - now_local.weekday() + 7) % 7
            if days_ahead == 0: days_ahead = 7
            target_date = now_local.date() + timedelta(days=days_ahead)
        elif "sexta" in data_str_clean:
            days_ahead = (4 - now_local.weekday() + 7) % 7
            if days_ahead == 0: days_ahead = 7
            target_date = now_local.date() + timedelta(days=days_ahead)
        elif "sábado" in data_str_clean or "sabado" in data_str_clean:
            days_ahead = (5 - now_local.weekday() + 7) % 7
            if days_ahead == 0: days_ahead = 7
            target_date = now_local.date() + timedelta(days=days_ahead)
        elif "domingo" in data_str_clean:
            days_ahead = (6 - now_local.weekday() + 7) % 7
            if days_ahead == 0: days_ahead = 7
            target_date = now_local.date() + timedelta(days=days_ahead)
        else:
            match = re.search(r'(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?', data_str_clean)
            if match:
                day = int(match.group(1))
                month = int(match.group(2))
                year = int(match.group(3)) if match.group(3) else now_local.year
                if year < 100: year += 2000
                try:
                    target_date = datetime(year, month, day).date()
                except ValueError:
                    pass
        
        start_dt = tz.localize(datetime.combine(target_date, time.min))
        end_dt = tz.localize(datetime.combine(target_date, time.max))

        cal_service = get_google_calendar_service(persona_config)
        
        events = await asyncio.to_thread(
            cal_service.get_upcoming_events, 
            max_results=50, 
            time_min=start_dt.isoformat(), 
            time_max=end_dt.isoformat()
        )
        
        horarios_ocupados = []
        if events:
            for event in events:
                start = event['start'].get('dateTime', event['start'].get('date'))
                horarios_ocupados.append(start)
        
        horario_trabalho = persona_config.available_hours or "Não configurado especificamente (assuma horário comercial)."

        resposta_para_ia = (
            f"INFORMAÇÕES DA AGENDA PARA {target_date.strftime('%d/%m/%Y')} ({data_desejada}):\n"
            f"- Horário de Expediente: {horario_trabalho}\n"
            f"- Eventos/Horários JÁ OCUPADOS no momento para este dia:\n"
            f"{chr(10).join(horarios_ocupados) if horarios_ocupados else 'Nenhum horário ocupado encontrado.'}\n\n"
            f"INSTRUÇÃO PARA VOCÊ (IA): Cruze a data desejada ({data_desejada}) com os horários ocupados e o expediente. "
            f"Ofereça ao cliente 2 opções de horários livres de forma amigável."
        )
        
        return resposta_para_ia

    except Exception as e:
        logger.error(f"Erro ao consultar agenda: {e}", exc_info=True)
        return "Não foi possível acessar a agenda no momento por uma falha de conexão."


@agente_atendimento.tool(prepare=verificar_agenda_ativa)
async def agendar_reuniao(
    ctx: RunContext[ContextoSaaS], 
    data_hora_iso: str, 
    email_cliente: str
) -> str:
    """
    Use esta ferramenta para agendar uma reunião ou visita no Google Calendar do cliente.
    
    Parâmetros:
    - data_hora_iso: A data e hora desejada em formato ISO 8601 (ex: "2026-07-17T15:00:00").
    - email_cliente: O e-mail do cliente (necessário para enviar o convite).
    """
    if not ctx.deps.calendar_ativo:
        return "Erro: O sistema de agendamento está desativado para esta empresa."

    import re
    import uuid
    from datetime import datetime, timedelta, timezone
    from app.services.google_calendar_service import get_google_calendar_service
    from app.db.database import SessionLocal

    # 1. Busca a Configuração completa no banco para pegar as credenciais e horários de trabalho
    async with SessionLocal() as db:
        stmt = select(models.Config).where(models.Config.id == ctx.deps.config_id)
        result = await db.execute(stmt)
        persona_config = result.scalar_one()

    if not persona_config.google_calendar_credentials:
        return "Erro: Credenciais do Google Calendar não configuradas."

    logger.info(f"[Tool Executada] agendar_reuniao | data_hora_iso='{data_hora_iso}', email_cliente='{email_cliente}'")
    atendimento = ctx.deps.atendimento
    if not atendimento:
        return "Erro: Objeto de atendimento não está disponível."

    try:
        calendar_service = get_google_calendar_service(persona_config)
        service = calendar_service.get_service()
        
        # --- Cancelar agendamentos anteriores deste contato ---
        try:
            now_iso = datetime.now(timezone.utc).isoformat()
            existing_events = await asyncio.to_thread(
                lambda: service.events().list(
                    calendarId='primary',
                    timeMin=now_iso,
                    q=atendimento.whatsapp,
                    singleEvents=True,
                    orderBy='startTime'
                ).execute().get('items', [])
            )

            for old_event in existing_events:
                if old_event.get('description') and f"WhatsApp: {atendimento.whatsapp}" in old_event.get('description'):
                    logger.info(f"Agente: Cancelando evento anterior {old_event.get('id')} para reagendamento.")
                    await asyncio.to_thread(
                        lambda: service.events().delete(
                            calendarId='primary', 
                            eventId=old_event.get('id'), 
                            sendUpdates='all'
                        ).execute()
                    )
        except Exception as cancel_err:
            logger.warning(f"Agente: Erro ao cancelar agendamentos anteriores: {cancel_err}")

        dt_start = datetime.fromisoformat(data_hora_iso)
        dt_end = dt_start + timedelta(hours=1)
        
        event_body = {
            'summary': f'Reunião: {atendimento.nome_contato or atendimento.whatsapp}',
            'description': f'Agendado automaticamente pela IA AtendAI.\nWhatsApp: {atendimento.whatsapp}\nObservações: {atendimento.resumo or "Nenhuma"}',
            'start': {'dateTime': dt_start.isoformat(), 'timeZone': 'America/Sao_Paulo'},
            'end': {'dateTime': dt_end.isoformat(), 'timeZone': 'America/Sao_Paulo'},
            'conferenceData': {
                'createRequest': {
                    'requestId': f"{uuid.uuid4()}",
                }
            }
        }
        
        clean_email = email_cliente.strip()
        if re.match(r"[^@]+@[^@]+\.[^@]+", clean_email):
            event_body['attendees'] = [{'email': clean_email}]
        else:
            return f"Erro: E-mail '{email_cliente}' fornecido é inválido."

        meeting_link = None
        try:
            event = await asyncio.to_thread(
                lambda: service.events().insert(
                    calendarId='primary', 
                    body=event_body, 
                    conferenceDataVersion=1, 
                    sendUpdates='all'
                ).execute()
            )
            meeting_link = event.get('hangoutLink')
            logger.info(f"Agente: Reunião agendada com sucesso! Link: {meeting_link}")
        except Exception as req_err:
            logger.error(f"Agente: Erro na requisição do Calendar com ConferenceData. Tentando sem conferência. Erro: {req_err}")
            if 'conferenceData' in event_body:
                del event_body['conferenceData']
            try:
                event = await asyncio.to_thread(
                    lambda: service.events().insert(
                        calendarId='primary', 
                        body=event_body, 
                        sendUpdates='all'
                    ).execute()
                )
                logger.info(f"Agente: Reunião agendada (sem link Meet) com sucesso!")
            except Exception as fallback_err:
                logger.error(f"Agente: Falha total no agendamento. Erro: {fallback_err}")
                return f"Erro ao inserir o evento na agenda do Google: {str(fallback_err)}"

        resumo_adicional = f" | Reunião agendada para {data_hora_iso}."
        if meeting_link:
            resumo_adicional += f" Link do Meet: {meeting_link}"
            
        async with SessionLocal() as db_write:
            async with db_write.begin():
                at = await db_write.get(models.Atendimento, ctx.deps.atendimento_id, with_for_update=True)
                if at:
                    at.resumo = (at.resumo or "") + resumo_adicional
                    db_write.add(at)
                    ctx.deps.atendimento.resumo = at.resumo
        
        ret_msg = f"Reunião agendada com sucesso para {data_hora_iso}."
        if meeting_link:
            ret_msg += f" Link da videochamada: {meeting_link}"
        return ret_msg

    except Exception as cal_err:
        logger.error(f"Agente: Erro no processo de agendamento: {cal_err}", exc_info=True)
        return f"Erro ao realizar o agendamento: {str(cal_err)}"


@agente_atendimento.tool
async def enviar_mensagem_texto(ctx: RunContext[ContextoSaaS], texto: str) -> str:
    """
    Use esta ferramenta para enviar uma mensagem de texto curta para o cliente no WhatsApp.
    O texto enviado deve ser EXTREMAMENTE CURTO e direto (máximo de 1 a 2 frases curtas).
    Você DEVE chamar esta ferramenta múltiplas vezes seguidas se quiser enviar frases/ideias separadas.
    NUNCA envie parágrafos longos ou junte ideias diferentes no mesmo texto.
    """
    logger.info(f"[Tool Executada] enviar_mensagem_texto | texto='{texto[:150]}...'")
    if not ctx.deps.whatsapp_service or not ctx.deps.atendimento or not ctx.deps.empresa:
        return "Erro: O serviço de mensagens não está disponível neste contexto."

    # Validação contra envio acidental de meta-status
    import re
    texto_limpo = re.sub(r'[^\w\s]', '', texto).strip().lower()
    if texto_limpo in ["aguardando resposta", "concluido", "concluído", "atendente chamado", "gerando resposta", "erro ia"]:
        logger.warning(f"IA tentou enviar mensagem de status proibida: '{texto}'")
        return "Erro: O status do sistema é alterado automaticamente pelo backend. Não envie o nome do status ou comandos de status via mensagem para o cliente. Se você não tem mais mensagens para o cliente, encerre o processamento retornando o resultado final (final_result)."

    partes = [p.strip() for p in texto.split("\n") if p.strip()]
    if not partes:
        return "Erro: O texto da mensagem está vazio."

    lock = await get_atendimento_lock(ctx.deps.atendimento_id)
    async with lock:
        for idx, parte in enumerate(partes):
            # Simulação realista de digitação para cada balão
            import random
            import asyncio
            chars_per_sec = random.uniform(0.10, 0.20)
            typing_delay = min(max(len(parte) * chars_per_sec, 2.5), 15.0)
            
            logger.info(f"IA simulando digitação por {typing_delay:.1f}s antes de enviar: {parte}")
            await asyncio.sleep(typing_delay)

            try:
                # Envia via WhatsApp real (fora da transação de banco)
                await ctx.deps.whatsapp_service.send_text_message(
                    company=ctx.deps.empresa,
                    number=ctx.deps.atendimento.whatsapp,
                    text=parte
                )
                
                # Registra no histórico do banco instantaneamente em transação curta
                from app.db.database import SessionLocal
                from datetime import datetime
                import json
                
                async with SessionLocal() as db_write:
                    async with db_write.begin():
                        at = await db_write.get(models.Atendimento, ctx.deps.atendimento_id, with_for_update=True)
                        if at:
                            historico_db = json.loads(at.conversa or "[]")
                            nova_msg = {
                                "id": f"ai_{int(datetime.now().timestamp())}_{random.randint(100, 999)}",
                                "role": "assistant",
                                "content": parte,
                                "timestamp": int(datetime.now().timestamp()),
                                "is_ai": True
                            }
                            historico_db.append(nova_msg)
                            at.conversa = json.dumps(historico_db, ensure_ascii=False)
                            db_write.add(at)
                            
                            # Atualiza em memória
                            ctx.deps.atendimento.conversa = at.conversa

            except Exception as e:
                logger.error(f"Erro ao enviar parte da mensagem na tool (parte {idx}): {e}", exc_info=True)
                return f"Erro ao enviar a mensagem: {str(e)}"
        
        return "Mensagens enviadas e salvas com sucesso."


@agente_atendimento.tool
async def enviar_mensagem_audio(ctx: RunContext[ContextoSaaS], texto: str) -> str:
    """
    Use esta ferramenta para enviar uma mensagem de voz/áudio gravada para o cliente no WhatsApp.
    O texto a ser falado deve ser EXTREMAMENTE CURTO (máximo de 1 a 2 frases curtas).
    Você informa o texto que deseja falar, a ferramenta converte esse texto em áudio usando Text-to-Speech do Gemini e envia o áudio diretamente ao cliente.
    Balões separados também se aplicam a esta ferramenta se o texto contiver múltiplas ideias/parágrafos separados por quebra de linha.
    """
    logger.info(f"[Tool Executada] enviar_mensagem_audio | texto='{texto[:150]}...'")
    if not ctx.deps.whatsapp_service or not ctx.deps.atendimento or not ctx.deps.empresa:
        return "Erro: O serviço de mensagens não está disponível neste contexto."

    # Validação contra envio acidental de meta-status
    import re
    texto_limpo = re.sub(r'[^\w\s]', '', texto).strip().lower()
    if texto_limpo in ["aguardando resposta", "concluido", "concluído", "atendente chamado", "gerando resposta", "erro ia"]:
        logger.warning(f"IA tentou enviar áudio de status proibida: '{texto}'")
        return "Erro: O status do sistema é alterado automaticamente pelo backend. Não envie o nome do status ou comandos de status via áudio para o cliente. Se você não tem mais mensagens para o cliente, encerre o processamento retornando o resultado final (final_result)."

    partes = [p.strip() for p in texto.split("\n") if p.strip()]
    if not partes:
        return "Erro: O texto da mensagem está vazio."

    lock = await get_atendimento_lock(ctx.deps.atendimento_id)
    async with lock:
        gemini_svc = get_gemini_service()
        for idx, parte in enumerate(partes):
            import random
            import asyncio
            chars_per_sec = random.uniform(0.08, 0.15)
            recording_delay = min(max(len(parte) * chars_per_sec, 2.0), 12.0)
            
            logger.info(f"IA simulando gravação de áudio por {recording_delay:.1f}s antes de enviar...")
            await asyncio.sleep(recording_delay)

            try:
                # 1. Gera áudio via Gemini TTS em transação isolada
                from app.db.database import SessionLocal
                async with SessionLocal() as db_tts:
                    audio_bytes = await gemini_svc.generate_tts(
                        text=parte,
                        db=db_tts,
                        company=ctx.deps.empresa,
                        atendimento_id=ctx.deps.atendimento_id
                    )

                # 2. Envia via WhatsApp (Rede externa)
                sent_info = await ctx.deps.whatsapp_service.send_media_message(
                    company=ctx.deps.empresa,
                    number=ctx.deps.atendimento.whatsapp,
                    media_type="audio",
                    file_bytes=audio_bytes,
                    filename="audio.wav",
                    mimetype="audio/wav"
                )
                
                # 3. Salva no banco de dados na transação curta
                from datetime import datetime
                import json
                
                async with SessionLocal() as db_write:
                    async with db_write.begin():
                        at = await db_write.get(models.Atendimento, ctx.deps.atendimento_id, with_for_update=True)
                        if at:
                            historico_db = json.loads(at.conversa or "[]")
                            nova_msg = {
                                "id": sent_info.get("id") or f"audio_{int(datetime.now().timestamp())}_{random.randint(100, 999)}",
                                "role": "assistant",
                                "content": parte,
                                "timestamp": int(datetime.now().timestamp()),
                                "type": "audio",
                                "media_id": sent_info.get("media_id") or None,
                                "filename": "audio.wav",
                                "is_ai": True
                            }
                            historico_db.append(nova_msg)
                            at.conversa = json.dumps(historico_db, ensure_ascii=False)
                            db_write.add(at)
                            
                            ctx.deps.atendimento.conversa = at.conversa
                            
            except Exception as e:
                logger.error(f"Erro ao enviar parte do áudio na tool (parte {idx}): {e}", exc_info=True)
                return f"Erro ao enviar o áudio: {str(e)}"
        
        return "Áudios gerados, enviados e salvos com sucesso."


@agente_atendimento.tool
async def enviar_arquivo_do_drive(
    ctx: RunContext[ContextoSaaS], 
    id_arquivo: str, 
    legenda: Optional[str] = None
) -> str:
    """
    Use esta ferramenta para enviar uma imagem, vídeo, áudio ou documento do Google Drive direto para o WhatsApp do cliente.
    
    Parâmetros:
    - id_arquivo: O ID único do arquivo do Google Drive (obtido ao fazer a busca com 'pesquisar_base_de_dados').
    - legenda: Texto opcional para acompanhar a imagem ou vídeo (não suportado em áudio e documentos).
    """
    if not ctx.deps.whatsapp_service or not ctx.deps.atendimento or not ctx.deps.empresa:
        return "Erro: O serviço de mensagens ou dados da empresa não está disponível neste contexto."

    from app.services.google_drive_service import get_drive_service
    import asyncio
    
    from app.core.config import settings
    if not settings.GOOGLE_SERVICE_ACCOUNT_JSON:
        return "Erro: Google Drive não está configurado ou autenticado no servidor."

    logger.info(f"[Tool Executada] enviar_arquivo_do_drive | id_arquivo='{id_arquivo}', legenda='{legenda}'")

    try:
        drive_service = get_drive_service()
        
        file_bytes = await asyncio.to_thread(drive_service.download_file_bytes, id_arquivo)
        if not file_bytes:
            return f"Erro: Não foi possível obter os bytes do arquivo '{id_arquivo}' no Google Drive."
            
        filename = "arquivo"
        media_type = "document"
        mimetype = "application/octet-stream"
        
        from app.db.database import SessionLocal
        async with SessionLocal() as db_read:
            stmt_kv = select(models.KnowledgeVector).where(
                models.KnowledgeVector.config_id == ctx.deps.config_id,
                models.KnowledgeVector.raw_data.op("->>")("id_arquivo") == id_arquivo
            )
            res_kv = await db_read.execute(stmt_kv)
            kv_record = res_kv.scalar_one_or_none()
            
            if kv_record and kv_record.raw_data:
                filename = kv_record.raw_data.get("nome_exato") or "arquivo"
                raw_category = (kv_record.category or "document").lower().strip()
                mimetype = kv_record.raw_data.get("mime_type") or "application/octet-stream"

                CATEGORY_TO_MEDIA_TYPE = {
                    "fotos": "image", "foto": "image", "imagens": "image", "imagem": "image", "image": "image",
                    "videos": "video", "video": "video", "vídeos": "video", "vídeo": "video",
                    "audios": "audio", "audio": "audio", "áudios": "audio", "áudio": "audio",
                }
                media_type = CATEGORY_TO_MEDIA_TYPE.get(raw_category, "document")
                
                if media_type == "document" and mimetype != "application/octet-stream":
                    if "image" in mimetype:
                        media_type = "image"
                    elif "video" in mimetype:
                        media_type = "video"
                    elif "audio" in mimetype:
                        media_type = "audio"

        logger.info(f"[enviar_arquivo_do_drive] Arquivo: '{filename}' | Categoria Banco: '{kv_record.category if kv_record else 'N/A'}' | media_type resolvido: '{media_type}' | mimetype: '{mimetype}' | legenda: '{str(legenda)[:80]}'")

        lock = await get_atendimento_lock(ctx.deps.atendimento_id)
        async with lock:
            sent_info = await ctx.deps.whatsapp_service.send_media_message(
                company=ctx.deps.empresa,
                number=ctx.deps.atendimento.whatsapp,
                media_type=media_type,
                file_bytes=file_bytes,
                filename=filename,
                mimetype=mimetype,
                caption=legenda
            )
            
            from datetime import datetime
            import json
            
            async with SessionLocal() as db_write:
                async with db_write.begin():
                    at = await db_write.get(models.Atendimento, ctx.deps.atendimento_id, with_for_update=True)
                    if at:
                        historico_db = json.loads(at.conversa or "[]")
                        nova_msg = {
                            "id": sent_info.get("id") or f"media_{int(datetime.now().timestamp())}",
                            "role": "assistant",
                            "content": f"[Arquivo Enviado: {filename}]",
                            "timestamp": int(datetime.now().timestamp()),
                            "type": media_type,
                            "media_id": sent_info.get("media_id") or id_arquivo,
                            "filename": filename,
                            "caption": legenda or None,
                            "is_ai": True
                        }
                        historico_db.append(nova_msg)
                        at.conversa = json.dumps(historico_db, ensure_ascii=False)
                        db_write.add(at)
                        
                        ctx.deps.atendimento.conversa = at.conversa
            
            return f"Arquivo '{filename}' enviado com sucesso para o cliente."
    except Exception as e:
        logger.error(f"Erro ao enviar arquivo do Drive via tool: {e}", exc_info=True)
        return f"Erro ao enviar o arquivo do Drive: {str(e)}"


@agente_atendimento.tool
async def transferir_para_atendente(ctx: RunContext[ContextoSaaS]) -> str:
    """
    Transfere o atendimento para um atendente humano.

    ATENÇÃO — ORDEM OBRIGATÓRIA DE EXECUÇÃO:
    1. ANTES de chamar esta ferramenta, você DEVE ter chamado `enviar_mensagem_texto` avisando
       o cliente que ele será atendido por um humano. NUNCA execute esta ferramenta sem antes
       ter enviado essa mensagem de aviso.
    2. Se existirem regras específicas de transferência nas INSTRUÇÕES ADICIONAIS (horário,
       condições, equipe, etc.), respeite-as antes de acionar a transferência.
    3. Use esta ferramenta quando: o cliente solicitar atendente humano, ou você não souber
       responder após realizar as duas tentativas de busca na base de dados.
    """
    logger.info(f"[Tool Executada] transferir_para_atendente")
    if not ctx.deps.atendimento:
        return "Erro: Objeto de atendimento não está disponível."
        
    from app.db.database import SessionLocal
    async with SessionLocal() as db_write:
        async with db_write.begin():
            at = await db_write.get(models.Atendimento, ctx.deps.atendimento_id, with_for_update=True)
            if at:
                at.status = "Atendente Chamado"
                db_write.add(at)
                ctx.deps.atendimento.status = "Atendente Chamado"
                
    return "Atendimento transferido com sucesso para a equipe de atendentes humanos."


@agente_atendimento.tool
async def concluir_atendimento(ctx: RunContext[ContextoSaaS]) -> str:
    """
    Use esta ferramenta quando a conversa tiver terminado com sucesso e o objetivo
    do cliente tiver sido alcançado.
    """
    logger.info(f"[Tool Executada] concluir_atendimento")
    if not ctx.deps.atendimento:
        return "Erro: Objeto de atendimento não está disponível."
        
    from app.db.database import SessionLocal
    async with SessionLocal() as db_write:
        async with db_write.begin():
            at = await db_write.get(models.Atendimento, ctx.deps.atendimento_id, with_for_update=True)
            if at:
                at.status = "Concluído"
                db_write.add(at)
                ctx.deps.atendimento.status = "Concluído"
                
    return "Atendimento concluído com sucesso."


@agente_atendimento.tool
async def atualizar_nome_contato(ctx: RunContext[ContextoSaaS], novo_nome: str) -> str:
    """Use assim que o cliente informar como se chama para atualizar o CRM."""
    logger.info(f"[Tool Executada] atualizar_nome_contato | novo_nome='{novo_nome}'")
    if not ctx.deps.atendimento:
        return "Erro: Objeto de atendimento não está disponível."
        
    from app.db.database import SessionLocal
    async with SessionLocal() as db_write:
        async with db_write.begin():
            at = await db_write.get(models.Atendimento, ctx.deps.atendimento_id, with_for_update=True)
            if at:
                at.nome_contato = novo_nome
                db_write.add(at)
                ctx.deps.atendimento.nome_contato = novo_nome
                
    return f"Nome atualizado no CRM para '{novo_nome}'."


@agente_atendimento.tool
async def adicionar_tag_ao_cliente(ctx: RunContext[ContextoSaaS], nome_da_tag: str) -> str:
    """
    Adiciona uma tag ao cliente no CRM.
    O 'nome_da_tag' deve ser obrigatoriamente uma das tags listadas na seção 'TAGS DISPONÍVEIS NO CRM' do prompt do sistema.
    """
    logger.info(f"[Tool Executada] adicionar_tag_ao_cliente | nome_da_tag='{nome_da_tag}'")
    if not ctx.deps.atendimento or not ctx.deps.empresa:
        return "Erro: Contexto de atendimento ou empresa indisponível."
        
    import json
    from app.crud import crud_atendimento
    from app.db.database import SessionLocal
    
    async with SessionLocal() as db:
        tags_disponiveis = await crud_atendimento.get_all_user_tags(db, company_id=ctx.deps.empresa.id)
        tag_config = next((t for t in tags_disponiveis if t['name'].lower() == nome_da_tag.lower()), None)
        if not tag_config:
            return f"Erro: A tag '{nome_da_tag}' não está cadastrada no CRM desta empresa. Cadastre-a ou use uma das tags disponíveis."
        color = tag_config.get('color', '#3b82f6')
        
    async with SessionLocal() as db_write:
        async with db_write.begin():
            at = await db_write.get(models.Atendimento, ctx.deps.atendimento_id, with_for_update=True)
            if at:
                current_tags = at.tags or []
                if not isinstance(current_tags, list):
                    try:
                        current_tags = json.loads(current_tags) if isinstance(current_tags, str) else list(current_tags)
                    except Exception:
                        current_tags = []
                
                if any(t.get("name", "").lower() == nome_da_tag.lower() for t in current_tags):
                    return f"Cliente já possui a tag '{nome_da_tag}'."
                
                current_tags.append({"name": tag_config['name'], "color": color})
                at.tags = current_tags
                db_write.add(at)
                ctx.deps.atendimento.tags = current_tags
                
    return f"A tag '{tag_config['name']}' foi adicionada com sucesso ao cliente."


# =====================================================================
# 5. BILHETAGEM E CONTROLE DE TOKENS
# =====================================================================
async def contabilizar_tokens_pydantic(
    resultado_ia: AgentRunResult, 
    ctx: ContextoSaaS, 
    empresa_model: models.Company
):
    """
    Extrai os tokens usados pelo PydanticAI (incluindo chamadas de ferramentas),
    aplica os multiplicadores baseados no modelo e deduz da empresa.
    """
    usage_obj = getattr(resultado_ia, "usage", None)
    if usage_obj is None:
        logger.warning(f"Objeto resultado_ia não possui atributo ou método 'usage' para o atendimento {ctx.atendimento_id}.")
        return
        
    if callable(usage_obj):
        try:
            uso = usage_obj()
        except TypeError:
            uso = usage_obj
    else:
        uso = usage_obj
        
    input_tokens = getattr(uso, "input_tokens", getattr(uso, "request_tokens", 0)) or 0
    output_tokens = getattr(uso, "output_tokens", getattr(uso, "response_tokens", 0)) or 0 
    
    if input_tokens == 0 and output_tokens == 0:
        logger.warning(f"Uso de tokens retornou zero para o atendimento {ctx.atendimento_id}.")
        return

    nome_modelo_limpo = ctx.model_name.replace("google:", "").replace("google-cloud:", "") if ctx.model_name else "gemini-3.1-flash-lite"
    precos = TABELA_PRECOS.get(nome_modelo_limpo, TABELA_PRECOS["gemini-3.1-flash-lite"])
    
    multiplicador_input = precos["input_text"] / BASE_FLASH_PRICE
    multiplicador_output = precos["output"] / BASE_FLASH_PRICE

    tokens_input_equivalentes = input_tokens * multiplicador_input
    tokens_output_equivalentes = output_tokens * multiplicador_output
    
    total_equivalente = tokens_input_equivalentes + tokens_output_equivalentes
    tokens_para_deduzir = math.ceil(total_equivalente)

    logger.info(
        f"Bilhetagem (Atend: {ctx.atendimento_id} | Model: {ctx.model_name}): "
        f"In={input_tokens} Out={output_tokens} | "
        f"Multiplicadores (In={multiplicador_input}x, Out={multiplicador_output}x) | "
        f"Total Deduzido = {tokens_para_deduzir} tokens."
    )

    try:
        if tokens_para_deduzir > 0:
            from app.db.database import SessionLocal
            async with SessionLocal() as db_write:
                async with db_write.begin():
                    comp = await db_write.get(models.Company, empresa_model.id)
                    if comp:
                        await crud_user.decrement_company_tokens(
                            db_write,
                            db_company=comp,
                            usage=tokens_para_deduzir,
                            atendimento_id=ctx.atendimento_id,
                            token_type="gemini_inference"
                        )
    except Exception as e:
        logger.error(f"Falha ao deduzir tokens da empresa {ctx.company_id}: {e}", exc_info=True)


class AgentService:
    @staticmethod
    async def start_agent(db: AsyncSession, current_user: models.User) -> None:
        """
        Inicia o agente de atendimento para a empresa do usuário logado.

        @param db: Sessão do banco de dados.
        @param current_user: Modelo do usuário logado.
        """
        if not current_user.company:
            raise ValueError("Usuário não possui uma empresa associada.")
            
        if current_user.company.agent_running:
            raise ValueError("O agente já está em execução.")

        current_user.company.agent_running = True
        db.add(current_user.company)
        await db.commit()

    @staticmethod
    async def stop_agent(db: AsyncSession, current_user: models.User) -> None:
        """
        Para o agente de atendimento para a empresa do usuário logado.

        @param db: Sessão do banco de dados.
        @param current_user: Modelo do usuário logado.
        """
        if not current_user.company:
            raise ValueError("Usuário não possui uma empresa associada.")
            
        current_user.company.agent_running = False
        db.add(current_user.company)
        await db.commit()

    @staticmethod
    def get_agent_status(current_user: models.User) -> str:
        """
        Retorna o status desejado ( running / stopped ) do agente da empresa.

        @param current_user: Modelo do usuário logado.
        @returns: Status do agente ("running" ou "stopped").
        """
        if not current_user.company:
            return "stopped"
        return "running" if current_user.company.agent_running else "stopped"

