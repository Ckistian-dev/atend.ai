import logging
from typing import Dict, Any, Literal
from langgraph.graph import StateGraph, END

from app.graph.state import AgentState
from app.graph.nodes.router import router_node
from app.graph.nodes.retriever import retriever_node
from app.graph.nodes.tools import tools_node
from app.graph.nodes.generator import generator_node
from app.graph.nodes.guardrail import guardrail_node
from app.graph.nodes.fallback import fallback_node
from app.graph.nodes.output import output_node

logger = logging.getLogger(__name__)

def route_after_router(state: AgentState) -> Literal["retriever", "tools", "generator"]:
    """
    Roteia a partir da decisão tomada pelo Router Node.
    - 'rag': busca documentos e mídias na base de conhecimento antes de gerar a resposta.
    - 'tool': executa ferramentas externas (cálculos, links, etc.) antes de gerar a resposta.
    - Todos os demais casos (incluindo direct_chat e pedidos de handoff): seguem para o Generator Node para conduzir o diálogo de forma humanizada, resiliente e contextualizada.
    """
    intent = state.get("intent_category", "rag")
    if intent == "rag":
        return "retriever"
    elif intent == "tool":
        return "tools"
    else:
        return "generator"

def route_after_guardrail(state: AgentState) -> Literal["output", "generator", "fallback"]:
    """
    Roteia a partir da validação do Juiz Guardrail.
    - Se aprovado: segue para envio (output).
    - Se reprovado e retry_count < 3: volta para generator com a crítica.
    - Se reprovado e retry_count >= 3: transbordo para time humano (fallback).
    """
    is_valid = state.get("validation_passed", False)
    retry_count = state.get("retry_count", 0)

    if is_valid:
        return "output"
    elif retry_count < 3:
        logger.info(f"[Workflow] Loop de auto-correção acionado (Tentativa {retry_count + 1}/3)...")
        return "generator"
    else:
        logger.warning(f"[Workflow] Limite de tentativas ({retry_count}) atingido. Roteando para Fallback...")
        return "fallback"

def create_agent_graph():
    """
    Monta e compila o StateGraph cíclico do Agente de Atendimento.
    """
    workflow = StateGraph(AgentState)

    # 1. Registro dos Nós
    workflow.add_node("router", router_node)
    workflow.add_node("retriever", retriever_node)
    workflow.add_node("tools", tools_node)
    workflow.add_node("generator", generator_node)
    workflow.add_node("guardrail", guardrail_node)
    workflow.add_node("fallback", fallback_node)
    workflow.add_node("output", output_node)

    # 2. Ponto de Entrada
    workflow.set_entry_point("router")

    # 3. Arestas Condicionais do Router
    workflow.add_conditional_edges(
        "router",
        route_after_router,
        {
            "retriever": "retriever",
            "tools": "tools",
            "generator": "generator"
        }
    )

    # 4. Transições para o Gerador
    workflow.add_edge("retriever", "generator")
    workflow.add_edge("tools", "generator")

    # 5. Transição Gerador -> Guardrail
    workflow.add_edge("generator", "guardrail")

    # 6. Arestas Condicionais do Guardrail (Loop Cíclico de Auto-Correção)
    workflow.add_conditional_edges(
        "guardrail",
        route_after_guardrail,
        {
            "output": "output",
            "generator": "generator",
            "fallback": "fallback"
        }
    )

    # 7. Fallback -> Output
    workflow.add_edge("fallback", "output")

    # 8. Output -> Fim
    workflow.add_edge("output", END)

    # Compilação do Grafo
    app = workflow.compile()
    logger.info("[Workflow] Grafo LangGraph do Agente compilado com sucesso.")
    return app

# Instância compilada compartilhada
agent_graph = create_agent_graph()

async def run_agent_workflow(initial_state: AgentState) -> AgentState:
    """
    Executa o grafo do agente de ponta a ponta para um atendimento.

    @param initial_state: Estado inicial contendo identificadores e entradas do cliente.
    @returns: Estado final após a execução de todos os nós.
    """
    logger.info(f"[Workflow] Iniciando execução do Grafo para Atend ID {initial_state.get('atendimento_id')}")
    final_state = await agent_graph.ainvoke(initial_state)
    return final_state
