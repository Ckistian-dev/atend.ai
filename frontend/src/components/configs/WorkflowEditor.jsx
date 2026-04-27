import React, { useState, useCallback, useMemo, useEffect } from 'react';
import ReactFlow, { 
    addEdge, Background, Controls, applyNodeChanges, applyEdgeChanges, 
    Handle, Position, NodeResizer, BaseEdge, EdgeLabelRenderer, getBezierPath, useStore, MarkerType, updateEdge
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Trash2, Plus, Network, Save, X, Sparkles, AlertCircle, Info, Move, MousePointer2 } from 'lucide-react';
import toast from 'react-hot-toast';

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

const PreviewEdge = ({ source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd, label, data }) => {
    const isSourceSelected = useStore((s) => s.nodeInternals.get(source)?.selected);
    const isTargetSelected = useStore((s) => s.nodeInternals.get(target)?.selected);
    const isNodeSelected = isSourceSelected || isTargetSelected;

    const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
    const edgeLabel = data?.label !== undefined ? data.label : label || '';
    const edgeStyle = { stroke: '#3b82f6', strokeWidth: 2.5, ...style };
    
    const customStyle = isNodeSelected 
        ? { ...edgeStyle, strokeWidth: 4, stroke: '#2563eb', filter: 'drop-shadow(0 0 8px rgba(37,99,235,0.3))' }
        : edgeStyle;

    return (
        <>
            <BaseEdge path={edgePath} markerEnd={markerEnd} style={customStyle} />
            {edgeLabel && (
                <EdgeLabelRenderer>
                    <div
                        style={{
                            position: 'absolute',
                            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
                        }}
                        className="nodrag nopan bg-white/90 backdrop-blur-md px-4 py-2 rounded-2xl text-[11px] font-black text-blue-600 border border-blue-50 shadow-xl shadow-blue-900/5 uppercase tracking-wider"
                    >
                        {edgeLabel}
                    </div>
                </EdgeLabelRenderer>
            )}
        </>
    );
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

export const WorkflowEditorModal = ({ isOpen, onClose, initialWorkflow, onSave, onSaveAndPersist }) => {
    const [nodes, setNodes] = useState([]);
    const [edges, setEdges] = useState([]);
    const [isSavingFlow, setIsSavingFlow] = useState(false);

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

    const handleAddNode = () => {
        const newNode = {
            id: `node_${Date.now()}`,
            type: 'custom',
            position: { x: Math.random() * 200 + 100, y: Math.random() * 200 + 100 },
            data: { label: 'Nova Etapa', description: 'Instruções do que a IA deve fazer aqui...' },
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

            const isHandleConnected = (handleId) => {
                return edges.some(edge => (edge.source === id && edge.sourceHandle === handleId) || (edge.target === id && edge.targetHandle === handleId));
            };

            const onChangeLabel = (evt) => {
                const newLabel = evt.target.value;
                setNodes((nds) => nds.map((node) => node.id === id ? { ...node, data: { ...node.data, label: newLabel } } : node));
            };

            const onChangeDesc = (evt) => {
                const newDesc = evt.target.value;
                setNodes((nds) => nds.map((node) => node.id === id ? { ...node, data: { ...node.data, description: newDesc } } : node));
            };

            const onDelete = () => {
                setNodes((nds) => nds.filter((n) => n.id !== id));
                setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
            };

            return (
                <>
                    <NodeResizer 
                        color="#3b82f6" 
                        isVisible={selected} 
                        minWidth={240} 
                        minHeight={120} 
                        handleStyle={{ width: 10, height: 10, borderRadius: 5, border: '2px solid white' }}
                    />
                    <div className={`relative group w-full min-w-[240px] sm:min-w-[280px] min-h-[120px] shadow-2xl rounded-2xl sm:rounded-[2.2rem] bg-white border-2 transition-all ${selected ? 'border-blue-600 scale-[1.02] shadow-blue-200/50' : 'border-slate-50 shadow-slate-200/50'}`}>
                        {/* Multiple Handles */}
                        <Handle type="target" position={Position.Top} id="t-top" className={isHandleConnected('t-top') ? connectedHandleStyle : unconnectedHandleStyleHorizontal} />
                        <Handle type="source" position={Position.Top} id="s-top" className={isHandleConnected('s-top') ? connectedHandleStyle : unconnectedHandleStyleHorizontal} />
                        <Handle type="target" position={Position.Bottom} id="t-bot" className={isHandleConnected('t-bot') ? connectedHandleStyle : unconnectedHandleStyleHorizontal} />
                        <Handle type="source" position={Position.Bottom} id="s-bot" className={isHandleConnected('s-bot') ? connectedHandleStyle : unconnectedHandleStyleHorizontal} />
                        <Handle type="target" position={Position.Left} id="t-left" className={isHandleConnected('t-left') ? connectedHandleStyle : unconnectedHandleStyleVertical} />
                        <Handle type="source" position={Position.Left} id="s-left" className={isHandleConnected('s-left') ? connectedHandleStyle : unconnectedHandleStyleVertical} />
                        <Handle type="target" position={Position.Right} id="t-right" className={isHandleConnected('t-right') ? connectedHandleStyle : unconnectedHandleStyleVertical} />
                        <Handle type="source" position={Position.Right} id="s-right" className={isHandleConnected('s-right') ? connectedHandleStyle : unconnectedHandleStyleVertical} />

                        {/* Header do Node */}
                        <div className={`px-4 sm:px-5 py-2 sm:py-3 border-b flex items-center justify-between rounded-t-2xl sm:rounded-t-[2.2rem] transition-colors ${selected ? 'bg-blue-50/50 border-blue-100' : 'bg-slate-50/50 border-slate-100'}`}>
                            <div className="flex items-center gap-2 flex-1">
                                {isEditingLabel ? (
                                    <input 
                                        type="text" 
                                        autoFocus
                                        value={data.label || ''} 
                                        onChange={onChangeLabel} 
                                        onBlur={() => setIsEditingLabel(false)}
                                        onKeyDown={(e) => e.key === 'Enter' && setIsEditingLabel(false)}
                                        className="nodrag font-black text-[11px] text-slate-800 uppercase tracking-widest focus:outline-none bg-white border border-blue-200 rounded px-2 py-0.5 w-full"
                                        placeholder="NOME DA ETAPA"
                                    />
                                ) : (
                                    <div 
                                        onClick={() => setIsEditingLabel(true)}
                                        className="font-black text-[11px] text-slate-800 uppercase tracking-widest px-2 py-0.5 min-h-[20px] cursor-text hover:bg-slate-50 rounded transition-colors truncate flex-1"
                                    >
                                        {data.label || 'NOME DA ETAPA'}
                                    </div>
                                )}
                            </div>
                            <button 
                                type="button"
                                onClick={onDelete}
                                className="w-8 h-8 flex items-center justify-center bg-red-50 text-red-500 rounded-xl opacity-0 group-hover:opacity-100 transition-all hover:bg-red-500 hover:text-white shrink-0 ml-2"
                                title="Excluir Etapa"
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>
                        
                        <div className="px-4 sm:px-5 py-3 sm:py-4 flex-1 rounded-b-2xl sm:rounded-b-[2.2rem]">
                            {isEditingDesc ? (
                                <textarea 
                                    autoFocus
                                    value={data.description || ''} 
                                    onChange={onChangeDesc} 
                                    onBlur={() => setIsEditingDesc(false)}
                                    className="nodrag w-full min-h-[100px] text-[12px] sm:text-[13px] text-slate-600 font-medium leading-relaxed focus:outline-none bg-white border border-blue-100 rounded-lg p-2"
                                    placeholder="Descreva aqui o que a IA deve fazer..."
                                />
                            ) : (
                                <div 
                                    onClick={() => setIsEditingDesc(true)}
                                    className="text-[12px] sm:text-[13px] text-slate-600 font-medium leading-relaxed p-2 min-h-[60px] cursor-text hover:bg-slate-50/50 rounded transition-colors whitespace-pre-wrap"
                                >
                                    {data.description || 'Toque para definir as instruções desta etapa...'}
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
        const CustomEdgeWithInput = ({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd, data, label }) => {
            const isSourceSelected = useStore((s) => s.nodeInternals.get(source)?.selected);
            const isTargetSelected = useStore((s) => s.nodeInternals.get(target)?.selected);
            const isNodeSelected = isSourceSelected || isTargetSelected;

            const [isEditing, setIsEditing] = useState(false);
            const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });

            const onLabelChange = (evt) => {
                const newLabel = evt.target.value;
                setEdges((eds) => eds.map((edge) => {
                    if (edge.id === id) {
                        return { ...edge, data: { ...edge.data, label: newLabel }, label: newLabel };
                    }
                    return edge;
                }));
            };

            const onDeleteEdge = () => {
                setEdges((eds) => eds.filter((e) => e.id !== id));
            };

            const edgeLabel = data?.label !== undefined ? data.label : label || '';
            const edgeStyle = { stroke: '#3b82f6', strokeWidth: 2.5, ...style };

            const customStyle = isNodeSelected 
                ? { ...edgeStyle, strokeWidth: 4, stroke: '#2563eb', filter: 'drop-shadow(0 0 8px rgba(37,99,235,0.3))' }
                : edgeStyle;

            return (
                <>
                    <BaseEdge path={edgePath} markerEnd={markerEnd} style={customStyle} />
                    <EdgeLabelRenderer>
                        <div style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`, pointerEvents: 'all' }} className="nodrag nopan relative group flex items-center justify-center">
                            
                            {isEditing ? (
                                <input
                                    value={edgeLabel}
                                    autoFocus
                                    onChange={onLabelChange}
                                    onBlur={() => setIsEditing(false)}
                                    onKeyDown={(e) => e.key === 'Enter' && setIsEditing(false)}
                                    placeholder="Condição..."
                                    className="bg-white text-blue-700 rounded-2xl px-4 py-2 text-[10px] font-black uppercase tracking-widest focus:outline-none focus:ring-4 focus:ring-blue-100 transition-all text-center w-36 placeholder-blue-200 shadow-xl border border-blue-200"
                                />
                            ) : (
                                <div 
                                    onClick={() => setIsEditing(true)}
                                    className="bg-white/95 backdrop-blur-md text-blue-700 rounded-2xl px-4 py-2 text-[10px] font-black uppercase tracking-widest text-center min-w-[6rem] shadow-xl border border-blue-50 cursor-text hover:border-blue-200 transition-all"
                                >
                                    {edgeLabel || 'Condição...'}
                                </div>
                            )}

                            <button 
                                type="button"
                                onClick={onDeleteEdge}
                                className="absolute -top-3 -right-3 w-7 h-7 flex items-center justify-center bg-red-50 text-red-500 rounded-full opacity-0 group-hover:opacity-100 transition-all hover:bg-red-500 hover:text-white shadow-lg border border-white z-10"
                                title="Excluir Condição"
                            >
                                <Trash2 size={12} />
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
                    {/* Floating Controls Overlay */}
                    <div className="absolute top-4 sm:top-8 left-4 sm:left-8 z-10 flex flex-col gap-3 sm:gap-4 pointer-events-none">
                        <button 
                            type="button" 
                            onClick={handleAddNode} 
                            className="group flex items-center gap-3 sm:gap-4 bg-white p-1.5 sm:p-2 pr-5 sm:pr-6 rounded-full shadow-2xl border border-slate-100 pointer-events-auto active:scale-95 transition-all"
                        >
                            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-600 text-white rounded-full flex items-center justify-center shadow-lg group-hover:rotate-90 transition-transform duration-500">
                                <Plus size={20} sm:size={24} strokeWidth={3} />
                            </div>
                            <span className="text-[10px] sm:text-[12px] font-black uppercase tracking-widest text-slate-700">Adicionar</span>
                        </button>

                        <div className="hidden sm:block bg-white/80 backdrop-blur-md p-4 rounded-[2rem] border border-slate-100 shadow-xl shadow-blue-900/5 max-w-[200px]">
                            <h4 className="flex items-center gap-2 text-[10px] font-black text-blue-600 uppercase tracking-widest mb-3">
                                <Info size={12} /> Dicas Rápidas
                            </h4>
                            <p className="text-[11px] text-slate-500 font-medium leading-relaxed">
                                Arraste de um ponto azul para outro para configurar conexões. <span className="font-bold text-blue-600">Clique duas vezes</span> em qualquer texto para editá-lo.
                            </p>
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
                        fitView
                    >
                        <Background variant="dots" gap={20} size={1} color="#e2e8f0" />
                        <Controls className="!m-4 sm:!m-8 !shadow-2xl !border-none !rounded-2xl overflow-hidden" />
                    </ReactFlow>
                </div>
            </div>
        </div>
    );
};
