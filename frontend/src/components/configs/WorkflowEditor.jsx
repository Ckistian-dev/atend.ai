import React, { useState, useCallback, useMemo, useEffect } from 'react';
import ReactFlow, { 
    addEdge, Background, Controls, applyNodeChanges, applyEdgeChanges, 
    Handle, Position, NodeResizer, BaseEdge, EdgeLabelRenderer, getBezierPath, useStore, MarkerType, updateEdge
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Trash2, Plus, Network, Save, X, Sparkles, Info, Loader2, MessageCircle, GitBranch, Zap, PlayCircle, StopCircle, Wand2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/axiosConfig';

// --- AUTO LAYOUT HELPER ---
export const autoOrganizeWorkflow = (nodesList, edgesList) => {
    if (!Array.isArray(nodesList) || nodesList.length === 0) return { nodes: nodesList, edges: edgesList };

    const nodeMap = {};
    nodesList.forEach(n => {
        if (n && n.id) nodeMap[n.id] = { ...n };
    });

    const adj = {};
    const inDegree = {};
    Object.keys(nodeMap).forEach(nid => {
        adj[nid] = [];
        inDegree[nid] = 0;
    });

    const validEdges = (edgesList || []).map(e => ({ ...e }));

    validEdges.forEach(e => {
        if (e.source && e.target && nodeMap[e.source] && nodeMap[e.target] && e.source !== e.target) {
            adj[e.source].push(e.target);
            inDegree[e.target] = (inDegree[e.target] || 0) + 1;
        }
    });

    let startId = Object.keys(nodeMap).find(nid => nodeMap[nid]?.data?.node_type === 'start');
    if (!startId) {
        const zeros = Object.keys(inDegree).filter(nid => inDegree[nid] === 0);
        startId = zeros[0] || Object.keys(nodeMap)[0];
    }

    const DELTA_X = 550;
    const STAIR_STEP_Y = 140;
    const ROW_GAP_Y = 220;

    const positions = {};
    const occupiedYByX = {};

    const layoutNode = (nid, xPos, parentY) => {
        if (positions[nid]) return;

        const currentMaxY = occupiedYByX[xPos] !== undefined ? occupiedYByX[xPos] : parentY;
        const targetY = Math.max(parentY, currentMaxY);

        positions[nid] = { x: xPos, y: targetY };
        occupiedYByX[xPos] = targetY + ROW_GAP_Y;

        const children = (adj[nid] || []).filter(c => !positions[c]);
        if (children.length === 0) return;

        const childX = xPos + DELTA_X;
        const childStartY = targetY + STAIR_STEP_Y;

        children.forEach((childId, idx) => {
            const cY = idx === 0 ? childStartY : (occupiedYByX[childX] !== undefined ? occupiedYByX[childX] : childStartY);
            layoutNode(childId, childX, cY);
        });
    };

    if (startId) {
        layoutNode(startId, 80, 80);
    }

    let currentMaxX80 = occupiedYByX[80] !== undefined ? occupiedYByX[80] : 80;
    Object.keys(nodeMap).forEach(nid => {
        if (!positions[nid]) {
            positions[nid] = { x: 80, y: currentMaxX80 };
            currentMaxX80 += ROW_GAP_Y;
        }
    });

    const updatedNodes = nodesList.map(n => {
        const pos = positions[n.id] || n.position || { x: 80, y: 80 };
        return {
            ...n,
            position: { x: pos.x, y: pos.y }
        };
    });

    const updatedEdges = validEdges.map(e => ({
        ...e,
        sourceHandle: 's-right',
        targetHandle: 't-left'
    }));

    return { nodes: updatedNodes, edges: updatedEdges };
};

// --- NODE TYPE CONFIG ---
const NODE_TYPES_CONFIG = {
    start:    { label: 'Início',   icon: PlayCircle,    color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0', headerBg: '#dcfce7', hint: 'Ponto de entrada da conversa. Use apenas um por fluxo.' },
    message:  { label: 'Mensagem', icon: MessageCircle, color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', headerBg: '#dbeafe', hint: 'A IA envia uma mensagem ou aguarda resposta do cliente.' },
    decision: { label: 'Decisão',  icon: GitBranch,     color: '#d97706', bg: '#fffbeb', border: '#fde68a', headerBg: '#fef3c7', hint: 'Ramificação condicional. Conecte saídas com condições diferentes.' },
    action:   { label: 'Ação',     icon: Zap,           color: '#7c3aed', bg: '#faf5ff', border: '#ddd6fe', headerBg: '#ede9fe', hint: 'A IA executa uma ferramenta (busca, agendamento, transferência...).' },
    end:      { label: 'Fim',      icon: StopCircle,    color: '#dc2626', bg: '#fef2f2', border: '#fecaca', headerBg: '#fee2e2', hint: 'Encerra o fluxo: conclui ou transfere para atendente.' },
};

// --- DESIGN SYSTEM STYLES ---
const DS_STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800;900&family=Inter:wght@400;500;600&display=swap');
.workflow-editor { font-family: 'Inter', sans-serif; }
.workflow-editor h1, .workflow-editor h2, .workflow-editor h3, .workflow-editor h4 { font-family: 'Plus Jakarta Sans', sans-serif; }
.node-card {
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.node-card:hover { transform: translateY(-2px); }
.animate-fade-in-up-fast {
    animation: fadeInUp 0.3s ease-out;
}
@keyframes fadeInUp {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
}
.react-flow__controls {
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05) !important;
    border: none !important;
    border-radius: 12px !important;
    overflow: hidden !important;
}
.react-flow__controls-button {
    border-bottom: 1px solid #f1f5f9 !important;
    background: #ffffff !important;
}
.react-flow__controls-button:hover {
    background: #f8fafc !important;
}
`;

// --- MULTI-HANDLE STYLING ---
const connectedHandleStyle = "!w-3 !h-3 !bg-white !border-2 !border-blue-600 rounded-full shadow-sm z-20";
const unconnectedHandleStyleHorizontal = "!w-36 !h-3 !bg-transparent !border-0 rounded-full z-10";
const unconnectedHandleStyleVertical = "!w-3 !h-36 !bg-transparent !border-0 rounded-full z-10";

// --- CUSTOM NODES & EDGES (PREVIEW) ---
const previewNodeTypes = {
    custom: ({ data, id }) => {
        const edges = useStore((s) => s.edges);
        const isHandleConnected = (handleId) => {
            return edges.some(edge => (edge.source === id && edge.sourceHandle === handleId) || (edge.target === id && edge.targetHandle === handleId));
        };

        return (
            <div className="relative min-w-[240px] sm:min-w-[280px] pointer-events-none w-full shadow-xl shadow-blue-900/5 rounded-2xl sm:rounded-[2rem] bg-white/90 backdrop-blur-md border border-white/20 node-card">
                {/* 8 Handles for Preview (Visible if connected) */}
                <Handle type="target" position={Position.Top} id="t-top" className={isHandleConnected('t-top') ? connectedHandleStyle : "opacity-0"} />
                <Handle type="source" position={Position.Top} id="s-top" className={isHandleConnected('s-top') ? connectedHandleStyle : "opacity-0"} />
                <Handle type="target" position={Position.Bottom} id="t-bot" className={isHandleConnected('t-bot') ? connectedHandleStyle : "opacity-0"} />
                <Handle type="source" position={Position.Bottom} id="s-bot" className={isHandleConnected('s-bot') ? connectedHandleStyle : "opacity-0"} />
                <Handle type="target" position={Position.Left} id="t-left" className={isHandleConnected('t-left') ? connectedHandleStyle : "opacity-0"} />
                <Handle type="source" position={Position.Left} id="s-left" className={isHandleConnected('s-left') ? connectedHandleStyle : "opacity-0"} />
                <Handle type="target" position={Position.Right} id="t-right" className={isHandleConnected('t-right') ? connectedHandleStyle : "opacity-0"} />
                <Handle type="source" position={Position.Right} id="s-right" className={isHandleConnected('s-right') ? connectedHandleStyle : "opacity-0"} />

                <div className="px-4 py-4 sm:px-6 sm:py-5 flex flex-col gap-2 w-full">
                    <div className="flex items-center gap-2 mb-1">
                        <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-blue-600/10 flex items-center justify-center text-blue-600">
                            <Sparkles size={14} className="sm:hidden" />
                            <Sparkles size={16} className="hidden sm:block" />
                        </div>
                        <div className="font-black text-[12px] sm:text-[13px] text-slate-800 uppercase tracking-tight truncate">{data.label}</div>
                    </div>
                    <div className="text-[12px] sm:text-[13px] text-slate-500 font-medium leading-relaxed whitespace-pre-wrap flex-1">{data.description || 'Nenhuma instrução definida'}</div>
                </div>
            </div>
        );
    }
};

const PreviewEdge = ({ source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd }) => {
    const isSourceSelected = useStore((s) => s.nodeInternals.get(source)?.selected);
    const isTargetSelected = useStore((s) => s.nodeInternals.get(target)?.selected);
    const isNodeSelected = isSourceSelected || isTargetSelected;

    const [edgePath] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
    const edgeStyle = { stroke: '#3b82f6', strokeWidth: 2.5, ...style };

    const customStyle = isNodeSelected
        ? { ...edgeStyle, strokeWidth: 4, stroke: '#2563eb', filter: 'drop-shadow(0 0 8px rgba(37,99,235,0.3))' }
        : edgeStyle;

    return <BaseEdge path={edgePath} markerEnd={markerEnd} style={customStyle} />;
};

const previewEdgeTypes = {
    customEdge: PreviewEdge
};

export const WorkflowPreview = ({ workflowJson }) => {
    const edges = useMemo(() => {
        return (workflowJson?.edges || []).map(e => ({
            ...e,
            type: 'customEdge',
            animated: true,
            style: { stroke: '#3b82f6', strokeWidth: 2.5 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6', width: 20, height: 20 }
        }));
    }, [workflowJson?.edges]);

    return (
        <div className="w-full h-full workflow-editor">
            <style>{DS_STYLE}</style>
            <ReactFlow
                nodes={workflowJson?.nodes || []}
                edges={edges}
                nodeTypes={previewNodeTypes}
                edgeTypes={previewEdgeTypes}
                connectionRadius={90}
                fitView
                panOnDrag={false} zoomOnScroll={false} nodesDraggable={false}
            >
                <Background variant="dots" gap={20} size={1} color="#e2e8f0" />
            </ReactFlow>
        </div>
    );
};

// --- MODAL DO EDITOR ---

export const WorkflowEditorModal = ({ isOpen, onClose, initialWorkflow, configId, onSave, onSaveAndPersist }) => {
    const [nodes, setNodes] = useState([]);
    const [edges, setEdges] = useState([]);
    const [isSavingFlow, setIsSavingFlow] = useState(false);
    const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);

    // AI Copilot state
    const [isAiPanelOpen, setIsAiPanelOpen] = useState(false);
    const [aiPrompt, setAiPrompt] = useState('');
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    const handleAutoOrganize = useCallback(() => {
        setNodes(currNodes => {
            setEdges(currEdges => {
                const res = autoOrganizeWorkflow(currNodes, currEdges);
                setEdges(res.edges);
                return res.nodes;
            });
            return currNodes;
        });
        toast.success("Fluxo reorganizado em formato de escada!");
    }, []);

    const handleAiWorkflowSuggest = async () => {
        if (!configId) return toast.error("Configuração não identificada.");
        setIsAnalyzing(true);
        try {
            const res = await api.post(`/configs/${configId}/analyze_workflow`, {
                feedback: aiPrompt,
                current_workflow: { nodes, edges }
            }, { timeout: 1200000 });
            
            let nw = res.data?.novo_workflow;
            if (typeof nw === 'string') {
                try { nw = JSON.parse(nw); } catch (e) { nw = null; }
            }

            if (nw && (nw.nodes || nw.edges)) {
                let rawNodes = Array.isArray(nw.nodes) ? nw.nodes.map(n => ({
                    id: String(n.id || `node_${Date.now()}`),
                    type: 'custom',
                    position: { x: Number(n.position?.x ?? 100), y: Number(n.position?.y ?? 100) },
                    data: {
                        label: n.data?.label || 'ETAPA',
                        description: n.data?.description || '',
                        node_type: n.data?.node_type || 'message'
                    }
                })) : nodes;

                let rawEdges = Array.isArray(nw.edges) ? (nw.edges || []).map(e => ({ 
                    ...e,
                    type: 'customEdge',
                    animated: true,
                    style: { stroke: '#3b82f6', strokeWidth: 2.5 },
                    markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6', width: 20, height: 20 }
                })) : edges;

                const organized = autoOrganizeWorkflow(rawNodes, rawEdges);
                setNodes(organized.nodes);
                setEdges(organized.edges);

                toast.success("Fluxo alterado e organizado com sucesso!");
                setAiPrompt('');
                setIsAiPanelOpen(false);
            } else {
                toast.error(res.data?.analise_geral || "Nenhuma alteração de fluxo proposta.");
            }
        } catch (error) {
            console.error(error);
            toast.error(error.response?.data?.detail || "Erro ao consultar IA de fluxo.");
        } finally {
            setIsAnalyzing(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            setNodes(initialWorkflow?.nodes || []);
            setEdges((initialWorkflow?.edges || []).map(e => ({ 
                ...e,
                type: 'customEdge',
                animated: true,
                style: { stroke: '#3b82f6', strokeWidth: 2.5 },
                markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6', width: 20, height: 20 }
            })));
            setIsAiPanelOpen(false);
            setAiPrompt('');
            setIsAnalyzing(false);
        }
    }, [isOpen, initialWorkflow]);

    const onNodesChange = useCallback((changes) => setNodes((nds) => applyNodeChanges(changes, nds)), []);
    const onEdgesChange = useCallback((changes) => setEdges((eds) => applyEdgeChanges(changes, eds)), []);
    const onConnect = useCallback((params) => {
        setEdges((eds) => addEdge({ 
            ...params,
            type: 'customEdge', 
            label: '', 
            data: { label: '' },
            animated: true, 
            style: { stroke: '#3b82f6', strokeWidth: 2.5 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6', width: 20, height: 20 }
        }, eds));
    }, []);

    const onEdgeUpdate = useCallback((oldEdge, newConnection) => {
        setEdges((eds) => updateEdge(oldEdge, newConnection, eds));
    }, []);

    const handleAddNode = (nodeType = 'message') => {
        const cfg = NODE_TYPES_CONFIG[nodeType] || NODE_TYPES_CONFIG.message;
        const newNode = {
            id: `node_${Date.now()}`,
            type: 'custom',
            position: { x: Math.random() * 300 + 80, y: Math.random() * 250 + 80 },
            data: { label: cfg.label, description: 'Instruções do que a IA deve fazer nesta etapa...', node_type: nodeType },
        };
        setNodes((nds) => [...nds, newNode]);
    };

    const handleSaveWorkflow = async () => {
        setIsSavingFlow(true);
        try {
            onSave({ nodes, edges });
            if (onSaveAndPersist) {
                await onSaveAndPersist({ nodes, edges });
                toast.success("Fluxo salvo e sincronizado com a configuração!");
            } else {
                toast.success("Fluxo visual temporariamente salvo.");
            }
            onClose();
        } catch (err) {
            // Erro já tratado no onSaveAndPersist
        } finally {
            setIsSavingFlow(false);
        }
    };

    const editableNodeTypes = useMemo(() => {
        const CustomNodeWithState = ({ id, data, selected }) => {
            const edges = useStore((s) => s.edges);
            const [isEditingLabel, setIsEditingLabel] = useState(false);
            const [isEditingDesc, setIsEditingDesc] = useState(false);
            const [isTypeMenuOpen, setIsTypeMenuOpen] = useState(false);

            const nodeType = data.node_type || 'message';
            const cfg = NODE_TYPES_CONFIG[nodeType] || NODE_TYPES_CONFIG.message;
            const TypeIcon = cfg.icon;

            const isHandleConnected = (handleId) =>
                edges.some(e => (e.source === id && e.sourceHandle === handleId) || (e.target === id && e.targetHandle === handleId));

            const onChangeLabel = (evt) =>
                setNodes((nds) => nds.map((n) => n.id === id ? { ...n, data: { ...n.data, label: evt.target.value } } : n));

            const onChangeDesc = (evt) =>
                setNodes((nds) => nds.map((n) => n.id === id ? { ...n, data: { ...n.data, description: evt.target.value } } : n));

            const onChangeType = (newType) => {
                setNodes((nds) => nds.map((n) => n.id === id ? { ...n, data: { ...n.data, node_type: newType } } : n));
                setIsTypeMenuOpen(false);
            };

            const onDelete = () => {
                setNodes((nds) => nds.filter((n) => n.id !== id));
                setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
            };

            return (
                <>
                    <NodeResizer
                        color={cfg.color}
                        isVisible={selected}
                        minWidth={240}
                        minHeight={130}
                        handleStyle={{ width: 10, height: 10, borderRadius: 5, border: '2px solid white' }}
                    />
                    <div
                        className="relative group w-full min-w-[240px] sm:min-w-[280px] min-h-[130px] shadow-2xl rounded-2xl sm:rounded-[2.2rem] bg-white transition-all"
                        style={{ border: `2px solid ${selected ? cfg.color : cfg.border}`, boxShadow: selected ? `0 0 0 3px ${cfg.color}22, 0 8px 30px ${cfg.color}20` : undefined }}
                    >
                        {/* Handles */}
                        <Handle type="target" position={Position.Top} id="t-top" className={isHandleConnected('t-top') ? connectedHandleStyle : unconnectedHandleStyleHorizontal} />
                        <Handle type="source" position={Position.Top} id="s-top" className={isHandleConnected('s-top') ? connectedHandleStyle : unconnectedHandleStyleHorizontal} />
                        <Handle type="target" position={Position.Bottom} id="t-bot" className={isHandleConnected('t-bot') ? connectedHandleStyle : unconnectedHandleStyleHorizontal} />
                        <Handle type="source" position={Position.Bottom} id="s-bot" className={isHandleConnected('s-bot') ? connectedHandleStyle : unconnectedHandleStyleHorizontal} />
                        <Handle type="target" position={Position.Left} id="t-left" className={isHandleConnected('t-left') ? connectedHandleStyle : unconnectedHandleStyleVertical} />
                        <Handle type="source" position={Position.Left} id="s-left" className={isHandleConnected('s-left') ? connectedHandleStyle : unconnectedHandleStyleVertical} />
                        <Handle type="target" position={Position.Right} id="t-right" className={isHandleConnected('t-right') ? connectedHandleStyle : unconnectedHandleStyleVertical} />
                        <Handle type="source" position={Position.Right} id="s-right" className={isHandleConnected('s-right') ? connectedHandleStyle : unconnectedHandleStyleVertical} />

                        {/* Header */}
                        <div
                            className="px-4 sm:px-5 py-2 sm:py-3 border-b flex items-center justify-between rounded-t-2xl sm:rounded-t-[2.2rem]"
                            style={{ backgroundColor: cfg.headerBg, borderColor: cfg.border }}
                        >
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                {/* Type Selector Pill */}
                                <div className="relative flex-shrink-0">
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); setIsTypeMenuOpen(p => !p); }}
                                        className="nodrag flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all hover:opacity-80"
                                        style={{ backgroundColor: cfg.color + '18', color: cfg.color }}
                                        title="Alterar tipo da etapa"
                                    >
                                        <TypeIcon size={10} />
                                        {cfg.label}
                                    </button>
                                    {isTypeMenuOpen && (
                                        <div className="nodrag absolute top-full left-0 mt-1 z-50 bg-white border border-slate-100 rounded-2xl shadow-2xl p-1 w-36">
                                            {Object.entries(NODE_TYPES_CONFIG).map(([key, tc]) => {
                                                const Ic = tc.icon;
                                                return (
                                                    <button
                                                        key={key}
                                                        type="button"
                                                        onClick={(e) => { e.stopPropagation(); onChangeType(key); }}
                                                        className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-bold rounded-xl hover:bg-slate-50 transition-all text-left"
                                                        style={{ color: tc.color }}
                                                    >
                                                        <Ic size={12} /> {tc.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>

                                {/* Label */}
                                {isEditingLabel ? (
                                    <input
                                        type="text" autoFocus
                                        value={data.label || ''}
                                        onChange={onChangeLabel}
                                        onBlur={() => setIsEditingLabel(false)}
                                        onKeyDown={(e) => e.key === 'Enter' && setIsEditingLabel(false)}
                                        className="nodrag font-black text-[11px] text-slate-800 uppercase tracking-widest focus:outline-none bg-white border border-slate-200 rounded px-2 py-0.5 w-full"
                                        placeholder="NOME DA ETAPA"
                                    />
                                ) : (
                                    <div
                                        onClick={() => setIsEditingLabel(true)}
                                        className="font-black text-[11px] text-slate-800 uppercase tracking-widest px-2 py-0.5 min-h-[20px] cursor-text hover:bg-white/60 rounded transition-colors truncate flex-1"
                                    >
                                        {data.label || 'NOME DA ETAPA'}
                                    </div>
                                )}
                            </div>
                            <button
                                type="button" onClick={onDelete}
                                className="w-7 h-7 flex items-center justify-center bg-red-50 text-red-400 rounded-xl opacity-0 group-hover:opacity-100 transition-all hover:bg-red-500 hover:text-white shrink-0 ml-2"
                                title="Excluir Etapa"
                            >
                                <Trash2 size={12} />
                            </button>
                        </div>

                        {/* Body */}
                        <div className="px-4 sm:px-5 py-3 sm:py-4 rounded-b-2xl sm:rounded-b-[2.2rem]">
                            {isEditingDesc ? (
                                <textarea
                                    autoFocus
                                    value={data.description || ''}
                                    onChange={onChangeDesc}
                                    onBlur={() => setIsEditingDesc(false)}
                                    className="nodrag w-full min-h-[80px] text-[12px] sm:text-[13px] text-slate-600 font-medium leading-relaxed focus:outline-none bg-white border border-slate-100 rounded-lg p-2"
                                    placeholder="O que a IA deve fazer nesta etapa?"
                                />
                            ) : (
                                <div
                                    onClick={() => setIsEditingDesc(true)}
                                    className="text-[12px] sm:text-[13px] text-slate-500 font-medium leading-relaxed p-2 min-h-[50px] cursor-text hover:bg-slate-50/50 rounded transition-colors whitespace-pre-wrap"
                                >
                                    {data.description || 'Clique para definir as instruções desta etapa...'}
                                </div>
                            )}
                        </div>
                    </div>
                </>
            );
        };
        return { custom: CustomNodeWithState };
    }, [setNodes, setEdges]);

    const editableEdgeTypes = useMemo(() => {
        const CustomEdgeWithInput = ({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd }) => {
            const isSourceSelected = useStore((s) => s.nodeInternals.get(source)?.selected);
            const isTargetSelected = useStore((s) => s.nodeInternals.get(target)?.selected);
            const isNodeSelected = isSourceSelected || isTargetSelected;
            const [isHovered, setIsHovered] = useState(false);

            const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });

            const onDeleteEdge = () => setEdges((eds) => eds.filter((e) => e.id !== id));

            const edgeStyle = { stroke: '#3b82f6', strokeWidth: 2.5, ...style };
            const customStyle = (isNodeSelected || isHovered)
                ? { ...edgeStyle, strokeWidth: 4, stroke: '#2563eb', filter: 'drop-shadow(0 0 8px rgba(37,99,235,0.3))' }
                : edgeStyle;

            return (
                <>
                    {/* Invisible wide path for hover detection along the full edge */}
                    <path
                        d={edgePath}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={20}
                        style={{ cursor: 'pointer' }}
                        onMouseEnter={() => setIsHovered(true)}
                        onMouseLeave={() => setIsHovered(false)}
                    />
                    <BaseEdge path={edgePath} markerEnd={markerEnd} style={customStyle} />
                    <EdgeLabelRenderer>
                        <div
                            style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`, pointerEvents: 'all' }}
                            className="nodrag nopan"
                            onMouseEnter={() => setIsHovered(true)}
                            onMouseLeave={() => setIsHovered(false)}
                        >
                            <button
                                type="button"
                                onClick={onDeleteEdge}
                                className={`w-6 h-6 flex items-center justify-center bg-white text-red-400 rounded-full transition-all hover:bg-red-500 hover:text-white shadow-lg border border-slate-100 z-10 ${isHovered ? 'opacity-100 scale-100' : 'opacity-0 scale-75'}`}
                                title="Excluir ligação"
                            >
                                <Trash2 size={10} />
                            </button>
                        </div>
                    </EdgeLabelRenderer>
                </>
            );
        };
        return { customEdge: CustomEdgeWithInput };
    }, [setEdges]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-md sm:p-4 animate-fade-in workflow-editor" onClick={onClose}>
            <style>{DS_STYLE}</style>
            <div className="bg-white/95 backdrop-blur-xl w-full h-full max-w-[1400px] sm:max-h-[90vh] rounded-none sm:rounded-[3rem] shadow-[0_40px_100px_rgba(0,0,0,0.3)] flex flex-col overflow-hidden border-none sm:border border-white animate-fade-in-up-fast" onClick={e => e.stopPropagation()}>
                
                {/* Header do Modal: Intelligent Stratum Style */}
                <div className="px-6 sm:px-10 py-5 sm:py-8 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center bg-slate-50/50 gap-4">
                    <div className="flex items-center gap-4 sm:gap-5">
                        <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-xl shadow-blue-200 shrink-0">
                            <Network size={22} className="sm:hidden" />
                            <Network size={28} className="hidden sm:block" />
                        </div>
                        <div>
                            <h3 className="text-lg sm:text-2xl font-black tracking-tight text-slate-800 uppercase">Arquitetura de Fluxo</h3>
                            <p className="hidden sm:flex text-[13px] font-medium text-slate-400 items-center gap-2">
                                <Sparkles size={12} className="text-blue-500" /> Desenhe os caminhos lógicos da sua Persona.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 w-full sm:w-auto">
                        <button 
                            type="button" 
                            onClick={onClose} 
                            className="flex-1 sm:flex-none px-4 sm:px-6 py-3 text-[10px] sm:text-[11px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-900 transition-all bg-slate-100 sm:bg-transparent rounded-xl"
                        >
                            Sair
                        </button>
                        <button 
                            type="button" 
                            onClick={handleSaveWorkflow} 
                            disabled={isSavingFlow}
                            className="flex-[2] sm:flex-none bg-blue-600 hover:bg-blue-700 text-white font-black py-3 sm:py-4 px-6 sm:px-8 rounded-xl sm:rounded-2xl shadow-xl shadow-blue-200 flex items-center justify-center gap-2 sm:gap-3 transition-all text-[10px] sm:text-[11px] uppercase tracking-widest disabled:opacity-50"
                        >
                            {isSavingFlow ? (
                                <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> ...</>
                            ) : (
                                <><Save size={16} sm:size={18} /> Aplicar</>
                            )}
                        </button>
                        <button 
                            onClick={onClose} 
                            className="hidden sm:flex w-12 h-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 hover:bg-white hover:text-slate-900 shadow-sm transition-all"
                        >
                            <X size={24} />
                        </button>
                    </div>
                </div>

                <div className="flex-1 flex relative bg-[#fcfdff]">
                    {/* Floating IA Button in top right */}
                    {configId && (
                        <div className="absolute top-4 sm:top-8 right-4 sm:right-8 z-50 pointer-events-none">
                            <button 
                                type="button" 
                                onClick={() => setIsAiPanelOpen(!isAiPanelOpen)} 
                                className="flex items-center justify-center bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-md transition-all w-10 h-10 sm:w-12 sm:h-12 pointer-events-auto active:scale-95"
                            >
                                <Sparkles size={18} className="sm:hidden" />
                                <Sparkles size={22} className="hidden sm:block" />
                            </button>
                        </div>
                    )}

                    {/* Floating Controls Overlay */}
                    <div className="absolute top-4 sm:top-8 left-4 sm:left-8 z-10 flex items-center gap-3 sm:gap-4 pointer-events-none">
                        {/* Add Node Palette */}
                        <div className="relative pointer-events-auto">
                            <button
                                type="button"
                                onClick={() => setIsAddMenuOpen(p => !p)}
                                className="group flex items-center gap-3 sm:gap-4 bg-white p-1.5 sm:p-2 pr-5 sm:pr-6 rounded-full shadow-2xl border border-slate-100 active:scale-95 transition-all"
                            >
                                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-600 text-white rounded-full flex items-center justify-center shadow-lg group-hover:rotate-90 transition-transform duration-500">
                                    <Plus size={20} strokeWidth={3} />
                                </div>
                                <span className="text-[10px] sm:text-[12px] font-black uppercase tracking-widest text-slate-700">Adicionar Etapa</span>
                            </button>

                            {isAddMenuOpen && (
                                <div className="absolute top-full left-0 mt-2 bg-white border border-slate-100 rounded-3xl shadow-2xl p-2 w-72 flex flex-col gap-0.5">
                                    {Object.entries(NODE_TYPES_CONFIG).map(([key, tc]) => {
                                        const Ic = tc.icon;
                                        return (
                                            <button
                                                key={key}
                                                type="button"
                                                onClick={() => { handleAddNode(key); setIsAddMenuOpen(false); }}
                                                className="flex items-center gap-3 px-3 py-3 rounded-2xl hover:bg-slate-50 transition-all text-left group/item"
                                            >
                                                <span className="w-9 h-9 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all" style={{ backgroundColor: tc.color + '15', color: tc.color }}>
                                                    <Ic size={16} />
                                                </span>
                                                <div className="flex flex-col min-w-0">
                                                    <span className="text-[12px] font-black text-slate-800">{tc.label}</span>
                                                    <span className="text-[10px] font-medium text-slate-400 leading-tight mt-0.5">{tc.hint}</span>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Button Organizar Fluxo */}
                        <div className="pointer-events-auto">
                            <button
                                type="button"
                                onClick={handleAutoOrganize}
                                className="group flex items-center gap-3 sm:gap-4 bg-white p-1.5 sm:p-2 pr-5 sm:pr-6 rounded-full shadow-2xl border border-slate-100 active:scale-95 transition-all hover:bg-slate-50"
                                title="Reorganizar o fluxo em escada automaticamente"
                            >
                                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-amber-500 text-white rounded-full flex items-center justify-center shadow-lg group-hover:rotate-12 transition-transform duration-500">
                                    <Wand2 size={20} strokeWidth={2.5} />
                                </div>
                                <span className="text-[10px] sm:text-[12px] font-black uppercase tracking-widest text-slate-700">Organizar Fluxo</span>
                            </button>
                        </div>
                    </div>

                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        onEdgeUpdate={onEdgeUpdate}
                        nodeTypes={editableNodeTypes}
                        edgeTypes={editableEdgeTypes}
                        connectionRadius={90}
                        minZoom={0.05}
                        maxZoom={2}
                        fitView
                    >
                        <Background variant="dots" gap={20} size={1} color="#e2e8f0" />
                        <Controls className="!m-4 sm:!m-8 !shadow-2xl !border-none !rounded-2xl overflow-hidden" />
                    </ReactFlow>

                    {/* AI Copilot Panel */}
                    {isAiPanelOpen && (
                        <div className="absolute right-0 top-0 bottom-0 w-[350px] bg-white border-l border-slate-100 shadow-2xl z-[70] flex flex-col animate-fade-in-left pointer-events-auto">
                            {/* Header */}
                            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                                <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
                                        <Sparkles size={16} />
                                    </div>
                                    <h4 className="text-xs font-black uppercase tracking-widest text-slate-800">IA Copilot</h4>
                                </div>
                                <button 
                                    type="button"
                                    onClick={() => setIsAiPanelOpen(false)}
                                    className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-all"
                                >
                                    <X size={16} />
                                </button>
                            </div>
                            
                            {/* Content */}
                            <div className="p-6 flex-1 flex flex-col justify-between overflow-y-auto">
                                <div className="space-y-4">
                                    <p className="text-xs font-medium text-slate-500 leading-relaxed">
                                        Descreva as mudanças ou novas etapas que deseja no fluxo. A IA gerará e conectará os blocos visualmente para você.
                                    </p>
                                    
                                    <textarea
                                        value={aiPrompt}
                                        onChange={(e) => setAiPrompt(e.target.value)}
                                        placeholder="Ex: Crie um bloco de suporte financeiro conectado ao bloco inicial por uma transição chamada 'Financeiro'."
                                        className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-700 font-medium placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white resize-none h-[120px] transition-all outline-none"
                                    />
                                    
                                    <button
                                        type="button"
                                        disabled={isAnalyzing || !aiPrompt.trim()}
                                        onClick={handleAiWorkflowSuggest}
                                        className={`w-full text-white font-black py-3 px-4 rounded-xl shadow-lg transition-all text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 ${
                                            isAnalyzing 
                                                ? 'bg-indigo-500/80 cursor-not-allowed animate-pulse shadow-indigo-100/50' 
                                                : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-100 hover:shadow-indigo-200/50 active:scale-[0.98]'
                                        } ${!aiPrompt.trim() && !isAnalyzing ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    >
                                        {isAnalyzing ? (
                                            <>
                                                <Loader2 size={14} className="animate-spin" />
                                                Processando...
                                            </>
                                        ) : (
                                            <>
                                                <Sparkles size={12} className="animate-pulse" />
                                                Alterar Fluxo
                                            </>
                                        )}
                                    </button>
                                </div>
                                
                                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 mt-6">
                                    <p className="text-[10px] text-slate-400 font-medium leading-relaxed">
                                        💡 <strong>Dica:</strong> A IA preservará a maior parte do seu fluxo original e adicionará as lógicas solicitadas.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
