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

from pydantic_ai import Agent, RunContext
from pydantic_ai.models.google import GoogleModel

# Importações do seu sistema
from app.db import models
from app.db.database import SessionLocal
from app.crud import crud_user
from app.services.gemini_service import get_gemini_service
from app.services.google_calendar_service import get_google_calendar_service

logger = logging.getLogger(__name__)

# Locks globais para garantir ordem sequencial no envio de mensagens por atendimento
_atendimento_locks: Dict[int, asyncio.Lock] = {}
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
        "gemini-3.5-flash-lite": {
            "input_text": 0.25,
            "output": 1.50,
        },
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
            logger.info(f"[Tabela Precos] Tabela de precos carregada no agent_service: {list(tabela.keys())}")
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
    resumo_crm_context: Optional[str] = None

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
    GoogleModel('gemini-3.5-flash-lite'), # Modelo padrão (pode ser sobrescrito dinamicamente)
    deps_type=ContextoSaaS,
    output_type=RespostaAgente, # <--- A MÁGICA DO JSON EXATO AQUI
    retries=2 # Se a IA errar os parâmetros da ferramenta, tenta corrigir sozinha até 2 vezes
)

@agente_atendimento.system_prompt
def construir_prompt_base(ctx: RunContext[ContextoSaaS]) -> str:
    """Monta o cérebro da IA sob demanda, isolando as regras e o contexto da empresa de forma limpa e sem duplicações."""
    deps = ctx.deps
    
    # 1. Ferramentas ativas de envio
    ferramenta_audio_txt = ", `enviar_mensagem_audio` (voz)" if deps.tts_voice else ""
    ferramenta_drive_txt = " ou `enviar_arquivo_do_drive` (mídias/documentos)" if deps.drive_ativo else ""

    # 2. Tratamento de Nome do Cliente
    nome_conhecido = bool(deps.nome_cliente and deps.nome_cliente.strip() and deps.nome_cliente.strip().lower() != "desconhecido")
    if nome_conhecido:
        pedir_nome_rule = (
            f"O nome do cliente já é conhecido no CRM: '{deps.nome_cliente}'. Trate-o por esse nome. "
            "É EXPRESSAMENTE PROIBIDO perguntar o nome do cliente ou como ele se chama (esta regra anula e substitui qualquer instrução de solicitar nome descrita na Persona)."
        )
    else:
        pedir_nome_rule = (
            "O nome do cliente ainda não consta no CRM. Se o cliente informar o nome dele voluntariamente ou durante a saudação inicial, registre-o imediatamente via `atualizar_nome_contato`.\n"
            "IMPORTANTE: Se o cliente já estiver fazendo perguntas sobre produtos, orçamentos, medidas ou outros assuntos, FOCALIZE TOTALMENTE na dúvida do cliente e NÃO fique repetindo ou insistindo na pergunta do nome. Priorize a ajuda e o atendimento ao cliente."
        )

    # 3. Seções Condicionais
    categorias_str = ", ".join(deps.categorias_conhecimento) if deps.categorias_conhecimento else "Nenhuma"
    
    resumo_crm_sec = (
        f"### 📌 SÍNTESE DO HISTÓRICO ANTERIOR (RESUMO CONSOLIDADO)\n"
        f"{deps.resumo_crm_context}\n"
        f"*Nota: O histórico de mensagens brutas abaixo contém apenas os 10 turnos mais recentes. Use a síntese acima para manter a continuidade de acordos, escolhas de produtos ou especificações passadas pelo cliente anteriormente.*\n\n"
    ) if deps.resumo_crm_context else ""

    workflow_sec = (
        f"### ROTEIRO DE ATENDIMENTO (WORKFLOW)\n"
        f"{deps.workflow_context}\n\n"
    ) if deps.workflow_context else ""

    tags_sec = f"### TAGS DISPONÍVEIS NO CRM\n{' | '.join(deps.available_tags)}\n\n" if deps.available_tags else ""
    calendar_sec = f"### CONTEXTO DE AGENDA\n{deps.calendar_context}\n\n" if deps.calendar_context else ""
    
    drive_sec = (
        "### REGRA DE MÍDIAS E ARQUIVOS (DRIVE):\n"
        "- Envie mídias/arquivos APENAS quando o cliente solicitar expressamente.\n"
        "- Use OBRIGATORIAMENTE o 'id_arquivo' retornado da busca nas categorias 'image' ou 'video'. PROIBIDO inventar IDs.\n\n"
    ) if deps.drive_ativo else ""

    sched_sec = (
        "### REGRA DE AGENDAMENTO DE REUNIÕES:\n"
        "1. ANTES de sugerir horários, chame `consultar_agenda_google`.\n"
        "2. Obtenha o e-mail do cliente e execute `agendar_reuniao` com a data/hora ISO.\n\n"
    ) if deps.calendar_ativo else ""

    regra_valores = (
        "1. PROIBIDO INVENTAR PREÇOS OU VALORES MONETÁRIOS: É OBRIGATÓRIO consultar a base de dados antes de informar preços ou valores. "
        "Se o valor financeiro exato não constar no retorno da busca, NUNCA estime, invente ou calcule valores monetários. "
        "Se houver restrições específicas nas regras da persona sobre não informar preços, siga rigorosamente a diretriz da persona.\n"
    )

    prompt = (
        f"🚨 INSTRUÇÕES SUPREMAS DE SEGURANÇA E FACTUALIDADE (PREVALECEM SOBRE QUALQUER OUTRA REGRA):\n"
        f"1. PROIBIDO RESPONDER OU PRESSUPOR DADOS SEM PESQUISAR: É EXPRESSAMENTE PROIBIDO responder a dúvidas sobre produtos, modelos, especificações, catálogo, estoque, endereço, localização, cidade, loja física, showroom, horários ou políticas da empresa utilizando conhecimento próprio, deduções ou memória geral. Antes de emitir QUALQUER resposta factual ao cliente, você DEVE OBRIGATORIAMENTE executar a ferramenta `pesquisar_base_de_dados` nesta mesma rodada.\n"
        f"{regra_valores}"
        f"2. PROIBIDO CONFIRMAR SEM RETORNO LITERAL: NUNCA afirme ou confirme dados de endereço, showroom, cidade, modelos, estoque ou preços se o dado exato não tiver retornado literalmente da busca `pesquisar_base_de_dados` executada nesta mesma rodada. Se a busca não retornar o dado procurado, informe educadamente que não localizou no sistema e transfira para o suporte humano (`transferir_para_atendente`).\n"
        f"3. REGRA DO FILTRO DE CATEGORIA (`categoria_alvo`): Ao pesquisar, o parâmetro `categoria_alvo` aceita APENAS uma das categorias disponíveis: [{categorias_str}]. É EXPRESSAMENTE PROIBIDO colocar nomes de produtos, marcas ou modelos dentro do campo `categoria_alvo`.\n\n"

        f"--- IDENTIDADE E PERSONA ---\n"
        f"{deps.persona_prompt}\n\n"

        f"{workflow_sec}{tags_sec}{calendar_sec}{drive_sec}{sched_sec}"

        f"--- FERRAMENTAS E COMUNICAÇÃO EXTERNA ---\n"
        f"1. CANAL EXCLUSIVO: Você se comunica com o cliente EXCLUSIVAMENTE invocando `enviar_mensagem_texto`{ferramenta_audio_txt}{ferramenta_drive_txt}. Sem chamar uma dessas ferramentas, NENHUMA mensagem chega ao cliente.\n"
        f"2. BALÕES INDIVIDUAIS: Envie cada frase ou ideia em chamadas separadas e individuais. PROIBIDO agrupar múltiplos assuntos em um único envio de texto ou áudio.\n"
        f"3. DATA E HORA: Chame `obter_data_hora_atual` sempre que precisar validar o momento atual do atendimento.\n"
        f"4. CÁLCULOS MATEMÁTICOS: Sempre que precisar somar medidas, calcular áreas (m²), estimar quantidade de itens/peças ou realizar contas numéricas, invoque OBRIGATORIAMENTE a ferramenta `executar_calculo_matematico` para garantir precisão exata.\n"
        f"5. LEITURA DE LINKS/URLS: Sempre que o cliente compartilhar uma URL/link no atendimento (ex: posts do Instagram, produtos, sites ou artigos), OBRIGATORIAMENTE invoque a ferramenta `consultar_conteudo_link(url)` para que a IA leia e analise o conteúdo daquele link antes de responder.\n\n"

        f"--- GESTÃO DO CRM E CONTATO ---\n"
        f"- NOME DO CONTATO: {pedir_nome_rule}\n"
        f"- RESUMO DO ATENDIMENTO: O campo 'resumo' do resultado final DEVE conter uma síntese consolidada e acumulada de TODA a conversa até o momento.\n"
        f"- TAGS: Para aplicar tags ao contato, execute `adicionar_tag_ao_cliente` com uma das tags listadas acima.\n"
        f"- TRANSBORDO HUMANO: Quando necessário, avise o cliente amigavelmente e invoque a ferramenta `transferir_para_atendente`.\n"
        f"- CONCLUSÃO: Se o atendimento for finalizado com sucesso, invoque `concluir_atendimento`.\n\n"

        f"--- DIRETRIZES DE FORMATO E HUMANIZAÇÃO ---\n"
        f"- CONTINUIDADE: Se já houver histórico trocado, NUNCA repita saudações iniciais (ex: 'Olá', 'Tudo bem?', 'Eu sou o Téo'). Responda diretamente à dúvida.\n"
        f"- TAMANHO DAS MENSAGENS: Escreva mensagens curtas e conversacionais (máximo de 1 a 2 frases por balão).\n"
        f"- FORMATO DO WHATSAPP: Use exclusivamente `*negrito*` (1 asterisco), `_itálico_` e `~tachado~`. PROIBIDO usar `**duplo asterisco**`.\n"
    )

    if deps.regras_adicionais:
        prompt += f"\n--- INSTRUÇÕES ADICIONAIS DA EMPRESA ---\n{deps.regras_adicionais}\n"

    if resumo_crm_sec:
        prompt += f"\n{resumo_crm_sec.strip()}\n"
        
    return prompt


# =====================================================================
# 4. FERRAMENTAS DO AGENTE (MICRO-TOOLS)
# =====================================================================

import ast
import operator

_MATH_OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}

def _eval_expr_node(node):
    if isinstance(node, ast.Expression):
        return _eval_expr_node(node.body)
    elif isinstance(node, ast.Constant):
        if isinstance(node.value, (int, float)):
            return node.value
        raise ValueError("Constantes não numéricas não são permitidas.")
    elif isinstance(node, ast.BinOp):
        op_type = type(node.op)
        if op_type in _MATH_OPERATORS:
            left = _eval_expr_node(node.left)
            right = _eval_expr_node(node.right)
            return _MATH_OPERATORS[op_type](left, right)
        raise ValueError(f"Operador binário não suportado: {op_type}")
    elif isinstance(node, ast.UnaryOp):
        op_type = type(node.op)
        if op_type in _MATH_OPERATORS:
            operand = _eval_expr_node(node.operand)
            return _MATH_OPERATORS[op_type](operand)
        raise ValueError(f"Operador unário não suportado: {op_type}")
    else:
        raise ValueError(f"Expressão não suportada: {type(node)}")


@agente_atendimento.tool
async def executar_calculo_matematico(
    ctx: RunContext[ContextoSaaS],
    expressao: str
) -> str:
    """
    Use esta ferramenta para realizar cálculos matemáticos e aritméticos com 100% de precisão.
    Chame esta ferramenta sempre que precisar realizar somas de medidas, cálculo de áreas (m²), 
    proporções, porcentagens, divisão para quantidade de peças/unidades ou qualquer conta numérica.
    
    IMPORTANTE: Se o cálculo ou a soma de medidas já foi realizada e registrada em mensagens anteriores do histórico da conversa, 
    NÃO chame esta ferramenta novamente; utilize diretamente o valor numérico já obtido.
    
    Exemplos de `expressao`: "2.60 + 0.83 + 1.00", "4.43 / 2.70", "3.0 * 2.5", "(120 + 300) * 2".
    PROIBIDO passar caracteres não matemáticos ou texto. Passe apenas expressões numéricas válidas.
    """
    logger.info(f"[Tool Executada] executar_calculo_matematico | expressao='{expressao}'")
    try:
        expressao_clean = expressao.replace(",", ".").strip()
        parsed = ast.parse(expressao_clean, mode='eval')
        resultado_val = _eval_expr_node(parsed.body)
        
        if isinstance(resultado_val, float) and resultado_val.is_integer():
            resultado_val = int(resultado_val)
        elif isinstance(resultado_val, float):
            resultado_val = round(resultado_val, 4)

        retorno = f"Resultado do cálculo ({expressao}): {resultado_val}"
        logger.info(f"[Tool Executada] executar_calculo_matematico | {retorno}")
        return retorno
    except Exception as e:
        logger.error(f"Erro ao executar cálculo matemático para '{expressao}': {e}")
        return f"Erro ao calcular '{expressao}': certifique-se de passar uma expressão matemática válida (ex: '2.60 + 0.83 + 1.00' ou '4.43 / 2.70')."


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
async def consultar_conteudo_link(
    ctx: RunContext[ContextoSaaS],
    url: str
) -> str:
    """
    Use esta ferramenta para acessar, ler e extrair o conteúdo de qualquer URL enviada pelo cliente ou pesquisada na internet.
    Suporta links do Instagram (posts, fotos, vídeos, reels) e páginas web em geral (produtos, artigos, documentações, sites).
    
    A ferramenta efetua a extração do texto/legenda e aciona o Gemini IA para gerar uma síntese objetiva em tópicos 
    integrada ao contexto da conversa atual.
    
    Parâmetro `url`: O endereço completo do link (ex: "https://www.instagram.com/p/C_123456/", "https://site.com/produto").
    """
    logger.info(f"[Tool Executada] consultar_conteudo_link | url='{url}'")
    try:
        import json
        from app.services.web_search_service import extrair_texto_bruto_url
        from app.services.gemini_service import get_gemini_service
        
        # 1. Extração do conteúdo bruto via WebSearch
        dados_web = await extrair_texto_bruto_url(url)
        if not dados_web.get("sucesso"):
            erro_msg = dados_web.get("erro", "Não foi possível carregar a URL.")
            await _salvar_pesquisa_no_historico(ctx, f"[Leitura de Link Falhou]: {url} | Erro: {erro_msg}")
            return f"Não foi possível ler a URL {url}: {erro_msg}"
        
        texto_bruto = dados_web.get("texto_bruto", "")
        
        # 2. Carrega o histórico recente de conversa
        historico_midia = []
        if ctx.deps and ctx.deps.atendimento and ctx.deps.atendimento.conversa:
            try:
                historico_midia = json.loads(ctx.deps.atendimento.conversa or "[]")
            except Exception:
                historico_midia = []

        # 3. Sumarização via Gemini IA
        gemini_svc = get_gemini_service()
        async with SessionLocal() as db_gemini:
            resumo_link = await gemini_svc.analisar_e_sumarizar_conteudo_url(
                url=url,
                texto_bruto=texto_bruto,
                db_history=historico_midia,
                db=db_gemini,
                company=ctx.deps.empresa,
                atendimento_id=ctx.deps.atendimento_id
            )

        # 4. Salva a operação no histórico DB (oculto na UI)
        log_db = f"[Leitura de Link IA]: {url}\n{resumo_link}"
        await _salvar_pesquisa_no_historico(ctx, log_db)
        
        logger.info(f"[Tool Executada] consultar_conteudo_link | Sucesso para {url}")
        return resumo_link

    except Exception as e:
        logger.error(f"Erro ao executar consultar_conteudo_link para '{url}': {e}", exc_info=True)
        return f"Erro ao acessar e analisar o link {url}: {str(e)}"


@agente_atendimento.tool
async def pesquisar_base_de_dados(
    ctx: RunContext[ContextoSaaS], 
    termo_busca: str,
    tipo_busca: Literal['texto', 'semantica'],
    categoria_alvo: Optional[str] = None,
    quantidade_resultados: int = 5,
    pagina: int = 1
) -> str:
    """
    Pesquisa a base de conhecimento da empresa (planilhas e mídias do Drive).

    REGRA CRÍTICA - 'termo_busca':
    - Se tipo_busca='texto': Use APENAS de 1 a 3 palavras-chave substantivas exatas (nomes de produtos, serviços, modelos, marcas, etc.).
      É EXPRESSAMENTE PROIBIDO incluir verbos (como "custa", "quero", "saber", "tem"), preposições, artigos, pronomes ou saudações.
      Exemplos corretos: "Modelo X", "Plano Premium", "Manual Tecnico".
      Exemplos incorretos: "qual o valor do modelo x", "preco do plano", "quero saber se tem atendimento".
    - Se tipo_busca='semantica': Use para dúvidas conceituais, políticas da empresa ou perguntas completas (FAQ).
      Exemplo: "Qual a politica de entrega?"

    REGRA CRÍTICA - 'categoria_alvo':
    - Deve ser EXATAMENTE uma das categorias disponíveis informadas no prompt na seção 'CATEGORIAS DA BASE DE CONHECIMENTO' (ex: 'Produtos', 'Serviços', 'Dados da Empresa', 'image', 'video', 'document').
    - PROIBIDO passar nomes de modelos ou produtos no campo `categoria_alvo`. O modelo/produto vai no `termo_busca`.
    - Se a busca for sobre produtos/serviços, use `categoria_alvo='Produtos'` ou `'Serviços'`.
    - Se for sobre fotos/vídeos, use `categoria_alvo='image'` ou `categoria_alvo='video'`.
    - Se for sobre a empresa/horários, use `categoria_alvo='Dados da Empresa'`.
    - Se estiver em dúvida, passe `categoria_alvo=null`.

    'quantidade_resultados': número de resultados por página (entre 1 e 15).
    - Para buscas GENÉRICAS ou EXPLORATÓRIAS (ex: o cliente faz uma pergunta ampla, quer conhecer as opções, catálogo geral ou categorias):
      Solicite uma quantidade MAIOR de resultados (ex: 8 a 15) para obter uma visão ampla das opções disponíveis.
    - Para buscas ESPECÍFICAS ou DIRETAS (ex: o cliente pergunta sobre um modelo/medida específica ou dúvida pontual):
      Solicite uma quantidade MENOR e focada de resultados (ex: 2 a 5).

    'pagina': número da página a consultar (padrão: 1).
    - Use para PAGINAR e varrer os resultados da busca aos poucos quando existirem mais registros na base (informado no campo 'Total de registros encontrados').
    - Para consultar a página seguinte, invoque novamente esta ferramenta passando pagina=2, pagina=3, etc.
    """
    import math
    limite_real = min(max(quantidade_resultados, 1), 15)
    pagina_real = max(pagina, 1)
    offset_real = (pagina_real - 1) * limite_real

    logger.info(f"[Tool Executada] pesquisar_base_de_dados | termo_busca='{termo_busca}', tipo_busca='{tipo_busca}', categoria_alvo='{categoria_alvo}', quantidade_resultados={limite_real}, pagina={pagina_real}")
    config_id = ctx.deps.config_id

    from app.db.database import SessionLocal
    async with SessionLocal() as db:
        from sqlalchemy import func
        
        query = select(models.KnowledgeVector).where(models.KnowledgeVector.config_id == config_id)
        if categoria_alvo and categoria_alvo.strip():
            query = query.where(models.KnowledgeVector.category.ilike(categoria_alvo.strip()))

        total_encontrados = 0
        try:
            vetores_encontrados = []
            if tipo_busca == 'texto':
                logger.info(f"Busca TEXTUAL acionada para: '{termo_busca}' (pág {pagina_real}) na config {config_id}")
                termos = [t for t in termo_busca.replace("?", "").replace("!", "").replace(",", "").replace(".", "").split() if len(t) > 1]
                
                text_query = query
                for t in termos:
                    text_query = text_query.where(models.KnowledgeVector.content.ilike(f"%{t}%"))
                
                count_stmt = select(func.count()).select_from(text_query.subquery())
                res_count = await db.execute(count_stmt)
                total_encontrados = res_count.scalar() or 0

                paginated_query = text_query.offset(offset_real).limit(limite_real)
                result = await db.execute(paginated_query)
                vetores_encontrados = result.scalars().all()
                logger.info(f"Busca TEXTUAL para '{termo_busca}' retornou {len(vetores_encontrados)} de {total_encontrados} registros (pág {pagina_real}).")
                
                if not vetores_encontrados and pagina_real == 1:
                    logger.info(f"Busca TEXTUAL para '{termo_busca}' retornou zero resultados. Iniciando fallback automático para SEMÂNTICA...")
                    tipo_busca = 'semantica'

            if tipo_busca == 'semantica':
                logger.info(f"Busca SEMÂNTICA acionada para: '{termo_busca}' (pág {pagina_real}) na config {config_id}")
                gemini_svc = get_gemini_service()
                query_embedding = await gemini_svc.generate_embedding(termo_busca)
                
                if not query_embedding:
                    logger.error("Busca SEMÂNTICA falhou: Não foi possível gerar o vetor/embedding no Gemini.")
                    res_err = "Erro interno: Não foi possível gerar o vetor para a busca."
                    await _salvar_pesquisa_no_historico(ctx, termo_busca, tipo_busca, categoria_alvo, res_err)
                    return res_err

                semantic_base = query.where(
                    models.KnowledgeVector.embedding.cosine_distance(query_embedding) < 0.65
                )

                count_stmt = select(func.count()).select_from(semantic_base.subquery())
                res_count = await db.execute(count_stmt)
                total_encontrados = res_count.scalar() or 0

                paginated_semantic = semantic_base.order_by(
                    models.KnowledgeVector.embedding.cosine_distance(query_embedding)
                ).offset(offset_real).limit(limite_real)

                result = await db.execute(paginated_semantic)
                vetores_encontrados = result.scalars().all()
                logger.info(f"Busca SEMÂNTICA para '{termo_busca}' retornou {len(vetores_encontrados)} de {total_encontrados} registros (pág {pagina_real}).")

            # Fallback automático: se a busca com categoria_alvo retornou zero resultados na pág 1, tenta sem o filtro de categoria
            if not vetores_encontrados and categoria_alvo and pagina_real == 1:
                logger.info(f"Busca com categoria_alvo='{categoria_alvo}' retornou zero resultados. Executando fallback automático sem filtro de categoria...")
                fallback_query = select(models.KnowledgeVector).where(models.KnowledgeVector.config_id == config_id)
                
                termos = [t for t in termo_busca.replace("?", "").replace("!", "").replace(",", "").replace(".", "").split() if len(t) > 1]
                if termos:
                    fb_text = fallback_query
                    for t in termos:
                        fb_text = fb_text.where(models.KnowledgeVector.content.ilike(f"%{t}%"))
                    
                    count_fb = select(func.count()).select_from(fb_text.subquery())
                    res_fb_count = await db.execute(count_fb)
                    total_encontrados = res_fb_count.scalar() or 0

                    fb_text = fb_text.offset(offset_real).limit(limite_real)
                    res_fb = await db.execute(fb_text)
                    vetores_encontrados = res_fb.scalars().all()
                
                if not vetores_encontrados:
                    gemini_svc = get_gemini_service()
                    query_embedding_fb = await gemini_svc.generate_embedding(termo_busca)
                    if query_embedding_fb:
                        fb_semantic = fallback_query.where(
                            models.KnowledgeVector.embedding.cosine_distance(query_embedding_fb) < 0.65
                        )
                        count_fb = select(func.count()).select_from(fb_semantic.subquery())
                        res_fb_count = await db.execute(count_fb)
                        total_encontrados = res_fb_count.scalar() or 0

                        fb_semantic = fb_semantic.order_by(
                            models.KnowledgeVector.embedding.cosine_distance(query_embedding_fb)
                        ).offset(offset_real).limit(limite_real)
                        res_fb = await db.execute(fb_semantic)
                        vetores_encontrados = res_fb.scalars().all()

            if not vetores_encontrados:
                res_empty = f"Nenhum resultado encontrado para a busca '{termo_busca}' (página {pagina_real}, total na base: {total_encontrados})."
                await _salvar_pesquisa_no_historico(ctx, termo_busca, tipo_busca, categoria_alvo, res_empty)
                return res_empty

            total_paginas = max(1, math.ceil(total_encontrados / limite_real)) if total_encontrados > 0 else 1
            inicio_num = offset_real + 1
            fim_num = min(offset_real + len(vetores_encontrados), total_encontrados)

            # Cabeçalho ultracompacto e direto
            meta_header = f"📌 BUSCA: '{termo_busca}' | Categoria: '{categoria_alvo or 'Todas'}' | Total na Base: {total_encontrados} | Pág {pagina_real}/{total_paginas} (Itens {inicio_num}-{fim_num})"
            if total_paginas > pagina_real:
                meta_header += f"\n💡 Próxima página disponível ({total_encontrados - fim_num} itens restantes): chame `pesquisar_base_de_dados` com pagina={pagina_real + 1}"

            resposta_formatada = [meta_header]

            for idx, v in enumerate(vetores_encontrados, inicio_num):
                categoria_str = v.category or "Geral"
                bloco = [f"--- [REGISTRO #{idx} | Categoria: {categoria_str}] ---"]
                
                if v.raw_data and isinstance(v.raw_data, dict):
                    for chave, valor in v.raw_data.items():
                        if valor is not None:
                            val_clean = str(valor).strip()
                            if val_clean:
                                bloco.append(f"• {chave}: {val_clean}")
                elif v.content:
                    bloco.append(f"• Conteúdo: {str(v.content).strip()}")
                    
                resposta_formatada.append("\n".join(bloco))

            resultado_final = "\n\n".join(resposta_formatada)
            await _salvar_pesquisa_no_historico(ctx, termo_busca, tipo_busca, categoria_alvo, resultado_final)
            return resultado_final

        except Exception as e:
            logger.error(f"Erro na tool de busca: {e}", exc_info=True)
            res_exc = "Erro ao realizar a busca no banco de dados."
            await _salvar_pesquisa_no_historico(ctx, termo_busca, tipo_busca, categoria_alvo, res_exc)
            return res_exc


async def _salvar_pesquisa_no_historico(
    ctx: RunContext[ContextoSaaS],
    termo_busca: str,
    tipo_busca: str = "texto",
    categoria_alvo: Optional[str] = None,
    resultado: str = ""
):
    """Grava o registro da pesquisa no histórico de mensagens na tabela 'mensagens'."""
    if not ctx.deps or not ctx.deps.atendimento_id:
        return
    try:
        from app.db.database import SessionLocal
        from datetime import datetime
        from app.crud import crud_atendimento
        import random

        msg_id = f"search_{int(datetime.now().timestamp())}_{random.randint(100, 999)}"
        lock = await get_atendimento_lock(ctx.deps.atendimento_id)
        async with lock:
            async with SessionLocal() as db_write:
                async with db_write.begin():
                    if resultado:
                        content_str = f"[Pesquisa na Base de Conhecimento]: termo='{termo_busca}' | tipo='{tipo_busca}' | categoria='{categoria_alvo or 'Todas'}'\n\n{resultado}"
                    else:
                        content_str = termo_busca

                    nova_msg = {
                        "id": msg_id,
                        "role": "assistant",
                        "content": content_str,
                        "timestamp": int(datetime.now().timestamp()),
                        "type": "search",
                        "is_ai": True,
                        "extra_data": {
                            "termo_busca": termo_busca,
                            "tipo_busca": tipo_busca,
                            "categoria_alvo": categoria_alvo or "Todas"
                        }
                    }
                    await crud_atendimento.save_message(
                        db=db_write,
                        company_id=ctx.deps.company_id,
                        atendimento_id=ctx.deps.atendimento_id,
                        message_data=nova_msg
                    )
    except Exception as save_err:
        logger.error(f"Erro ao salvar pesquisa no histórico do atendimento {ctx.deps.atendimento_id}: {save_err}")



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
            # 1. Verifica barramento local de asyncio
            curr_task = asyncio.current_task()
            if curr_task and curr_task.cancelling() > 0:
                logger.info(f"Interrupção (Barramento Memória) detectada em enviar_mensagem_texto para Atendimento {ctx.deps.atendimento_id}. Abortando envio.")
                raise asyncio.CancelledError()

            # 2. VERIFICAÇÃO DE SEGURANÇA CROSS-PROCESS (BANCO DE DADOS)
            # Se uma nova mensagem chegou enquanto a IA processava, o webhook alterou o status para 'Mensagem Recebida'.
            from app.db.database import SessionLocal
            async with SessionLocal() as db_check:
                at_check = await db_check.get(models.Atendimento, ctx.deps.atendimento_id)
                if at_check and at_check.status != "Gerando Resposta":
                    logger.info(f"[BARRAMENTO BANCO] Atendimento ID {ctx.deps.atendimento_id} teve status alterado para '{at_check.status}'. Abortando envio da IA.")
                    raise asyncio.CancelledError()

            # Simulação realista de digitação para cada balão
            import random
            chars_per_sec = random.uniform(0.05, 0.10)
            typing_delay = min(max(len(parte) * chars_per_sec, 1.5), 5.0)
            
            logger.info(f"IA simulando digitação por {typing_delay:.1f}s antes de enviar: {parte}")
            await asyncio.sleep(typing_delay)

            # 3. Re-checa o estado local e do banco de dados após o tempo de digitação
            if curr_task and curr_task.cancelling() > 0:
                logger.info(f"Interrupção (Barramento Memória) detectada durante digitação para Atendimento {ctx.deps.atendimento_id}. Abortando envio.")
                raise asyncio.CancelledError()

            async with SessionLocal() as db_check2:
                at_check2 = await db_check2.get(models.Atendimento, ctx.deps.atendimento_id)
                if at_check2 and at_check2.status != "Gerando Resposta":
                    logger.info(f"[BARRAMENTO BANCO PÓS-DIGITAÇÃO] Atendimento ID {ctx.deps.atendimento_id} teve status alterado para '{at_check2.status}'. Abortando envio da IA.")
                    raise asyncio.CancelledError()

            try:
                # Envia via WhatsApp real (fora da transação de banco)
                sent_info = await ctx.deps.whatsapp_service.send_text_message(
                    company=ctx.deps.empresa,
                    number=ctx.deps.atendimento.whatsapp,
                    text=parte
                )
                
                # Registra no histórico do banco na tabela mensagens
                from app.db.database import SessionLocal
                from datetime import datetime
                from app.crud import crud_atendimento
                
                msg_id = (sent_info.get("id") if isinstance(sent_info, dict) and sent_info.get("id") else None) or f"ai_{int(datetime.now().timestamp())}_{random.randint(100, 999)}"
                
                async with SessionLocal() as db_write:
                    async with db_write.begin():
                        await crud_atendimento.save_message(
                            db=db_write,
                            company_id=ctx.deps.company_id,
                            atendimento_id=ctx.deps.atendimento_id,
                            message_data={
                                "id": msg_id,
                                "role": "assistant",
                                "content": parte,
                                "timestamp": int(datetime.now().timestamp()),
                                "status": "sent",
                                "is_ai": True,
                                "type": "text"
                            }
                        )

            except asyncio.CancelledError:
                raise
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
            curr_task = asyncio.current_task()
            if curr_task and curr_task.cancelling() > 0:
                logger.info(f"Interrupção (Barramento) detectada em enviar_mensagem_audio para Atendimento {ctx.deps.atendimento_id}. Abortando envio.")
                raise asyncio.CancelledError()

            import random
            chars_per_sec = random.uniform(0.08, 0.15)
            recording_delay = min(max(len(parte) * chars_per_sec, 2.0), 12.0)
            
            logger.info(f"IA simulando gravação de áudio por {recording_delay:.1f}s antes de enviar...")
            await asyncio.sleep(recording_delay)

            if curr_task and curr_task.cancelling() > 0:
                logger.info(f"Interrupção (Barramento) detectada durante gravação de áudio para Atendimento {ctx.deps.atendimento_id}. Abortando envio.")
                raise asyncio.CancelledError()

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
                
                # 3. Salva no banco de dados na tabela mensagens com os bytes do áudio
                from datetime import datetime
                from app.crud import crud_atendimento
                
                async with SessionLocal() as db_write:
                    async with db_write.begin():
                        await crud_atendimento.save_message(
                            db=db_write,
                            company_id=ctx.deps.company_id,
                            atendimento_id=ctx.deps.atendimento_id,
                            message_data={
                                "id": sent_info.get("id") or f"audio_{int(datetime.now().timestamp())}_{random.randint(100, 999)}",
                                "role": "assistant",
                                "content": parte,
                                "timestamp": int(datetime.now().timestamp()),
                                "type": "audio",
                                "media_id": sent_info.get("media_id") or None,
                                "filename": "audio.wav",
                                "mime_type": "audio/wav",
                                "status": "sent",
                                "is_ai": True
                            },
                            media_bytes=audio_bytes
                        )

            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error(f"Erro ao enviar parte do áudio na tool (parte {idx}): {e}", exc_info=True)
                return f"Erro ao enviar o áudio: {str(e)}"
        
        return "Áudios enviados e salvos com sucesso."


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
            from app.crud import crud_atendimento
            
            display_path = filename
            if kv_record:
                if kv_record.raw_data:
                    sub_p = kv_record.raw_data.get("subpastas") or ""
                    full_p = kv_record.raw_data.get("caminho_completo") or ""
                    if sub_p:
                        display_path = f"{sub_p} > {filename}"
                    elif full_p:
                        display_path = full_p
                elif kv_record.content and "Arquivo: " in kv_record.content:
                    try:
                        part_file = kv_record.content.split("Arquivo: ")[1].split(" | ")[0].strip()
                        parts_path = [p.strip() for p in part_file.split(" > ") if p.strip()]
                        if len(parts_path) > 1:
                            display_path = " > ".join(parts_path[1:])
                    except Exception: pass

            transcricao_imagem = ""
            if media_type == "image" or (mimetype and "image" in mimetype):
                try:
                    from app.services.gemini_service import get_gemini_service
                    gemini_svc = get_gemini_service()
                    
                    async with SessionLocal() as db_ctx_midia:
                        msgs_db = await crud_atendimento.get_messages_for_atendimento(db_ctx_midia, ctx.deps.atendimento_id, ctx.deps.company_id)
                        historico_midia = [
                            {"role": m.role, "content": m.content or m.caption or "", "timestamp": int(m.timestamp.timestamp()) if m.timestamp else 0}
                            for m in msgs_db[-10:]
                        ]
                    
                    async with SessionLocal() as db_vision:
                        transcricao_imagem = await gemini_svc.transcribe_and_analyze_media(
                            media_data={"data": file_bytes, "mime_type": mimetype or "image/jpeg"},
                            db_history=historico_midia,
                            persona=None,
                            db=db_vision,
                            company=ctx.deps.empresa,
                            atendimento_id=ctx.deps.atendimento_id
                        )
                    if transcricao_imagem:
                        logger.info(f"[Vision IA] Imagem enviada pela IA transcrita com sucesso: {transcricao_imagem[:100]}...")
                except Exception as vision_err:
                    logger.warning(f"Erro ao transcrever imagem enviada pela IA: {vision_err}")

            msg_content = f"[Arquivo Enviado: {display_path}]"
            if transcricao_imagem and not transcricao_imagem.startswith("[Erro"):
                msg_content += f"\n\n[Transcrição da Imagem Enviada pela IA]:\n{transcricao_imagem.strip()}"

            async with SessionLocal() as db_write:
                async with db_write.begin():
                    nova_msg = {
                        "id": sent_info.get("id") or f"media_{int(datetime.now().timestamp())}",
                        "role": "assistant",
                        "content": msg_content,
                        "timestamp": int(datetime.now().timestamp()),
                        "type": media_type,
                        "media_id": sent_info.get("media_id") or id_arquivo,
                        "filename": filename,
                        "mime_type": mimetype,
                        "caption": legenda or None,
                        "status": "sent",
                        "is_ai": True
                    }
                    await crud_atendimento.save_message(
                        db=db_write,
                        company_id=ctx.deps.company_id,
                        atendimento_id=ctx.deps.atendimento_id,
                        message_data=nova_msg,
                        media_bytes=file_bytes
                    )
            
            return f"Arquivo '{display_path}' enviado com sucesso para o cliente."
    except Exception as e:
        logger.error(f"Erro ao enviar arquivo do Drive via tool: {e}", exc_info=True)
        return f"Erro ao enviar o arquivo do Drive: {str(e)}"


@agente_atendimento.tool
async def transferir_para_atendente(
    ctx: RunContext[ContextoSaaS],
    destinatario: Optional[str] = None,
    departamento: Optional[str] = None,
    motivo: Optional[str] = None
) -> str:
    """
    Transfere o atendimento para um atendente humano específico (ex: "Gabi", "Carlos") ou setor (ex: "SAC", "RH", "Vendas", "Suporte", "Financeiro").

    ATENÇÃO — ORDEM OBRIGATÓRIA DE EXECUÇÃO:
    1. ANTES de chamar esta ferramenta, você DEVE ter chamado `enviar_mensagem_texto` avisando
       o cliente que ele será atendido pelo atendente ou equipe responsável. NUNCA execute esta ferramenta sem antes
       ter enviado essa mensagem de aviso.
    2. Se o cliente tiver solicitado um atendente específico (ex: Gabi, Carlos), passe no parâmetro `destinatario`.
    3. Se o cliente tiver solicitado um setor específico ou se o assunto for de um setor (ex: vendas, SAC, suporte), passe o parâmetro `departamento`.
    4. Se houver um motivo para a transferência, passe no parâmetro `motivo`.
    """
    logger.info(f"[Tool Executada] transferir_para_atendente (destinatario={destinatario}, departamento={departamento}, motivo={motivo})")
    if not ctx.deps.atendimento:
        return "Erro: Objeto de atendimento não está disponível."
        
    from app.db.database import SessionLocal
    async with SessionLocal() as db_write:
        async with db_write.begin():
            at = await db_write.get(models.Atendimento, ctx.deps.atendimento_id, with_for_update=True)
            if at:
                at.status = "Atendente Chamado"

                assigned_user_name = None
                if destinatario and str(destinatario).strip():
                    dest_clean = str(destinatario).strip()
                    users_res = await db_write.execute(
                        select(models.User).where(models.User.company_id == ctx.deps.empresa.id)
                    )
                    company_users = list(users_res.scalars().all())

                    matched_user = None
                    for u in company_users:
                        u_name = (u.name or "").strip().lower()
                        u_email = (u.email or "").strip().lower()
                        if dest_clean.lower() in u_name or dest_clean.lower() in u_email or u_name in dest_clean.lower():
                            matched_user = u
                            break

                    if matched_user:
                        at.assigned_user_id = matched_user.id
                        at.assigned_department = matched_user.department or departamento or at.assigned_department
                        assigned_user_name = matched_user.name or matched_user.email
                    else:
                        if not departamento:
                            departamento = dest_clean

                if departamento and departamento.strip():
                    at.assigned_department = departamento.strip()
                if motivo and motivo.strip():
                    at.observacoes = f"{at.observacoes or ''}\n[Transbordo IA]: {motivo.strip()}".strip()
                db_write.add(at)
                ctx.deps.atendimento.status = "Atendente Chamado"
                if at.assigned_department:
                    ctx.deps.atendimento.assigned_department = at.assigned_department
                if at.assigned_user_id:
                    ctx.deps.atendimento.assigned_user_id = at.assigned_user_id
                
    target_info = f"ao atendente '{assigned_user_name}'" if assigned_user_name else (f"ao setor '{departamento}'" if departamento else "à equipe de atendimento")
    return f"Atendimento transferido com sucesso {target_info}."


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
                ctx.deps.nome_cliente = novo_nome
                
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
    resultado_ia: Any, 
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

