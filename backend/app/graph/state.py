from typing import TypedDict, List, Dict, Any, Optional
from pydantic import BaseModel, Field

class RouterDecision(BaseModel):
    """Decisão estruturada do nó de roteamento."""
    intent: str = Field(
        description="A intenção identificada: 'rag' (consulta de informações/regras), 'tool' (ação em ferramenta), 'direct_chat' (diálogo simples/saudação direta), ou 'handoff' (solicitação explícita de atendente humano ou setor)."
    )
    search_query: Optional[str] = Field(
        default=None,
        description="Termos essenciais para busca RAG (1 a 3 substantivos). Usado apenas se intent == 'rag'."
    )
    target_category: Optional[str] = Field(
        default=None,
        description="Categoria alvo da base de conhecimento (ex: 'Produtos', 'Dados da Empresa', 'image', 'video')."
    )
    tool_to_call: Optional[str] = Field(
        default=None,
        description="Nome da ferramenta a invocar: 'consultar_agenda_google', 'agendar_reuniao', 'executar_calculo_matematico', 'consultar_conteudo_link', 'obter_data_hora_atual', 'enviar_arquivo_do_drive', 'adicionar_tag_ao_cliente', 'atualizar_nome_contato', 'transferir_para_atendente'."
    )
    tool_args: Optional[str] = Field(
        default=None,
        description="Argumentos para a ferramenta em formato JSON string (ex: '{\"expressao\": \"10+5\"}')."
    )
    handoff_destinatario: Optional[str] = Field(
        default=None,
        description="Nome do atendente ou cargo/setor solicitado pelo cliente caso a intenção seja 'handoff' ou transferência."
    )
    reason: Optional[str] = Field(
        default=None,
        description="Breve justificativa da decisão tomada pelo roteador."
    )


class EvaluationResult(BaseModel):
    """Resultado estruturado da validação anti-alucinação do Juiz."""
    is_valid: bool = Field(
        description="True se a resposta gerada for 100% suportada pelos fatos do contexto recuperado/ferramentas e não violar nenhuma regra. False se contiver alucinações, preços inventados ou suposições infundadas."
    )
    critique: str = Field(
        description="Se is_valid for False, detalhe exatamente qual fato/preço foi alucinado ou qual regra foi violada e instrua como corrigir. Se is_valid for True, retorne string vazia ou 'Aprovado'."
    )
    reason: Optional[str] = Field(
        default=None,
        description="Resumo do raciocínio de avaliação do Juiz."
    )


class GeneratorOutput(BaseModel):
    """Saída estruturada da geração de resposta do Agente."""
    response_text: str = Field(
        description="Mensagem completa a ser enviada ao cliente (será dividida em múltiplos balões conversacionais no envio, ou convertida em áudio se send_as_audio for True). Você pode intercalar imagens, fotos e arquivos entre balões de texto inserindo a tag [MEDIA: id_do_arquivo] no ponto exato onde a mídia deve ser entregue."
    )
    send_as_audio: bool = Field(
        default=False,
        description="True se a resposta deve ser sintetizada em voz/áudio via Gemini TTS e enviada como áudio gravado no WhatsApp (use quando o cliente enviou áudio, pediu resposta por voz/áudio ou quando a persona instruir o envio por voz). False para enviar mensagem de texto normal."
    )
    resumo_atualizado: str = Field(
        description="Resumo textual denso e coeso (em formato de texto contínuo, sem tópicos ou bullets) focado em palavras-chave essenciais: produtos/modelos de interesse, ambiente/medidas, dúvidas técnicas/materiais solicitados e status/próximo passo da negociação."
    )
    intent_conclude: bool = Field(
        default=False,
        description="True se o atendimento foi concluído com sucesso."
    )
    intent_handoff: bool = Field(
        default=False,
        description="True se o atendimento deve ser transferido para um atendente humano ou setor específico cadastrado na empresa."
    )
    handoff_destinatario: Optional[str] = Field(
        default=None,
        description="Nome do atendente cadastrado ou cargo/setor cadastrado EXCLUSIVAMENTE dentre os disponíveis na lista de equipe cadastrada da empresa. NUNCA invente cargos ou setores não cadastrados."
    )
    handoff_motivo: Optional[str] = Field(
        default=None,
        description="Breve motivo da transferência para o atendente/cargo cadastrado (ex: 'Solicitação direta do cliente por atendente')."
    )
    media_file_ids: Optional[List[str]] = Field(
        default=None,
        description="Lista de IDs de arquivos do Google Drive (campo 'id_arquivo' dos documentos recuperados da base de conhecimento) que devem ser enviados como anexo de mídia (vídeo, foto/imagem, catálogo PDF, etc.) junto com a resposta."
    )
    novo_nome_cliente: Optional[str] = Field(
        default=None,
        description="Nome próprio do cliente identificado ou informado por ele durante a conversa (ex: 'Carlos', 'Mariana', 'Lucas'). Se o cliente não informou ou se o nome já estiver cadastrado corretamente, deixe null."
    )
    tags_para_adicionar: Optional[List[str]] = Field(
        default=None,
        description="Lista de nomes de tags a serem aplicadas a este atendimento, selecionadas EXCLUSIVAMENTE a partir da lista de tags disponíveis da empresa de acordo com o que o CLIENTE disse ou pediu (ex: ambiente, produto de interesse, intenção de compra). Não adicione tags de itens não pedidos pelo cliente."
    )


class AgentState(TypedDict, total=False):
    """
    Estado global do Grafo LangGraph (StateGraph).
    Trafega entre todos os nós garantindo isolamento de tenant e consistência transacional.
    """
    # Identificadores de Isolamento Multi-Tenant
    tenant_id: int
    config_id: int
    atendimento_id: int

    # Dados da Entrada do Usuário
    user_input: str
    conversation_history: List[Dict[str, Any]]
    nome_cliente: Optional[str]
    current_tags: Optional[List[str]]

    # Roteamento e Intenção
    intent_category: Optional[str]  # 'rag', 'tool', 'direct_chat', 'handoff'
    search_query: Optional[str]
    target_category: Optional[str]
    tool_to_call: Optional[str]
    tool_args: Optional[Dict[str, Any]]
    intent_handoff: Optional[bool]
    handoff_destinatario: Optional[str]
    handoff_department: Optional[str]
    handoff_user_id: Optional[int]
    handoff_user_name: Optional[str]
    handoff_motivo: Optional[str]

    # Contexto Recuperado e Ferramentas
    retrieved_context: Optional[str]
    tool_results: Optional[List[Dict[str, Any]]]

    # Geração, Crítica e Auto-Correção
    draft_response: Optional[str]
    send_as_audio: bool
    critique: Optional[str]
    validation_passed: bool
    retry_count: int

    # Saída Final e CRM
    final_response: Optional[str]
    resumo_crm: Optional[str]
    status_final: Optional[str]
    media_file_ids: Optional[List[str]]
    novo_nome_cliente: Optional[str]
    tags_para_adicionar: Optional[List[str]]
    last_processed_msg_id: Optional[int]

    # Configurações do Tenant / Persona
    ai_model: str
    persona_prompt: str
    nature_identity: Optional[str]
    workflow_context: Optional[str]
    calendar_context: Optional[str]
    available_tags: Optional[List[str]]
    team_members: Optional[List[Dict[str, Any]]]
    company_team_info: Optional[str]
    drive_ativo: bool
    calendar_ativo: bool
    tts_voice: Optional[str]
    data_hora_atual: Optional[str]
    temperature: Optional[float]
    top_p: Optional[float]
    top_k: Optional[int]
    thinking_budget: Optional[int]
    thinking_level: Optional[str]

    # Mapeamento de Consumo de Tokens
    input_tokens: int
    output_tokens: int
