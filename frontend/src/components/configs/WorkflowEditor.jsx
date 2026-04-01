import React, { useState, useCallback, useMemo, useEffect } from 'react';
import ReactFlow, { 
    addEdge, Background, Controls, applyNodeChanges, applyEdgeChanges, 
    Handle, Position, NodeResizer, BaseEdge, EdgeLabelRenderer, getBezierPath, useStore, MarkerType 
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Trash2, Plus, Network, Save } from 'lucide-react';
import toast from 'react-hot-toast';

// --- CUSTOM NODES & EDGES (PREVIEW) ---
const previewNodeTypes = {
    custom: ({ data }) => (
        <div className="relative min-w-[250px] pointer-events-none w-full h-full shadow-lg rounded-2xl bg-white border-2 border-transparent">
            <Handle type="target" position={Position.Top} className="opacity-0" />
            <div className="px-4 py-3 flex flex-col gap-1 h-full w-full">
                <div className="font-bold text-sm text-gray-800 pb-1">{data.label}</div>
                <div className="text-xs text-gray-600 whitespace-pre-wrap flex-1">{data.description || 'Nenhuma instrução definida'}</div>
            </div>
            <Handle type="source" position={Position.Bottom} className="opacity-0" />
        </div>
    )
};

const PreviewEdge = ({ source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd, label, data }) => {
    const isSourceSelected = useStore((s) => s.nodeInternals.get(source)?.selected);
    const isTargetSelected = useStore((s) => s.nodeInternals.get(target)?.selected);
    const isNodeSelected = isSourceSelected || isTargetSelected; // eslint-disable-line

    const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
    const edgeLabel = data?.label !== undefined ? data.label : label || ''; // eslint-disable-line
    const edgeStyle = { stroke: '#144cd1', strokeWidth: 2, ...style };
    
    const customStyle = isNodeSelected 
        ? { ...edgeStyle, strokeWidth: 3, stroke: '#1040b0' }
        : edgeStyle;

    return (
        <>
            <BaseEdge path={edgePath} markerEnd={markerEnd} style={customStyle} className="animate-pulse" />
            {edgeLabel && (
                <EdgeLabelRenderer>
                    <div
                        style={{
                            position: 'absolute',
                            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
                        }}
                        className="nodrag nopan bg-white px-3 py-1.5 rounded-md text-xs font-bold text-gray-800 border border-brand-surface shadow-sm"
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
            ...e, // eslint-disable-line
            type: 'customEdge', // eslint-disable-line
            animated: true,
            style: { stroke: '#144cd1', strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#144cd1' }
        }));
    }, [workflowJson?.edges]);

    return (
        <ReactFlow
            nodes={workflowJson?.nodes || []}
            edges={edges}
            nodeTypes={previewNodeTypes}
            edgeTypes={previewEdgeTypes}
            fitView
            panOnDrag={false} zoomOnScroll={false} nodesDraggable={false}
        />
    );
};

// --- MODAL DO EDITOR ---

export const WorkflowEditorModal = ({ isOpen, onClose, initialWorkflow, onSave }) => {
    const [nodes, setNodes] = useState([]);
    const [edges, setEdges] = useState([]);

    useEffect(() => {
        if (isOpen) {
            setNodes(initialWorkflow?.nodes || []);
            setEdges((initialWorkflow?.edges || []).map(e => ({ 
                ...e, // eslint-disable-line
                type: 'customEdge',
                animated: true,
                style: { stroke: '#144cd1', strokeWidth: 2 },
                markerEnd: { type: MarkerType.ArrowClosed, color: '#144cd1' }
            })));
        }
    }, [isOpen, initialWorkflow]);

    const onNodesChange = useCallback((changes) => setNodes((nds) => applyNodeChanges(changes, nds)), []);
    const onEdgesChange = useCallback((changes) => setEdges((eds) => applyEdgeChanges(changes, eds)), []);
    const onConnect = useCallback((params) => {
        setEdges((eds) => addEdge({ 
            ...params, // eslint-disable-line
            type: 'customEdge', 
            label: '', 
            data: { label: '' }, // eslint-disable-line
            animated: true, 
            style: { stroke: '#144cd1', strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#144cd1' }
        }, eds));
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

    const handleSaveWorkflow = () => {
        onSave({ nodes, edges });
        toast.success("Fluxo visual temporariamente salvo. Clique em 'Guardar Configuração' para aplicar no banco de dados.");
        onClose();
    };

    const editableNodeTypes = useMemo(() => {
        const CustomNodeWithState = ({ id, data, selected }) => {
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
                        color="#144cd1" 
                        isVisible={selected} 
                        minWidth={250} 
                        minHeight={80} 
                    />
                    <div className={`relative group w-full h-full min-w-[250px] min-h-[80px] shadow-lg rounded-2xl bg-white border-2 transition-all ${selected ? 'border-brand-primary-hover' : 'border-transparent'}`}>
                        <button 
                            type="button"
                            onClick={onDelete}
                            className="absolute -top-3 -right-3 bg-red-100 text-red-600 rounded-full p-1.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-200 shadow-sm z-10"
                            title="Excluir Etapa"
                        >
                            <Trash2 size={14} />
                        </button>
                        <Handle type="target" position={Position.Top} className="opacity-0" />
                        <div className="px-4 py-3 flex flex-col gap-1 w-full h-full">
                            <input 
                                type="text" 
                                value={data.label || ''} 
                                onChange={onChangeLabel} 
                                className="nodrag font-bold text-sm text-gray-800 focus:outline-none bg-transparent w-full transition-colors flex-shrink-0"
                                placeholder="Nome da Etapa"
                            />
                            <textarea 
                                value={data.description || ''} 
                                onChange={onChangeDesc} 
                                className="nodrag text-xs text-gray-600 whitespace-pre-wrap resize-none focus:outline-none bg-transparent border border-transparent hover:border-gray-200 rounded p-1 w-full h-full flex-1 transition-colors"
                                placeholder="Nenhuma instrução definida"
                            />
                        </div>
                        <Handle type="source" position={Position.Bottom} className="opacity-0" />
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
            const edgeStyle = { stroke: '#144cd1', strokeWidth: 2, ...style };

            const customStyle = isNodeSelected 
                ? { ...edgeStyle, strokeWidth: 3, stroke: '#144cd1' }
                : edgeStyle;

            return (
                <>
                    <BaseEdge path={edgePath} markerEnd={markerEnd} style={customStyle} className="animate-pulse" />
                    <EdgeLabelRenderer>
                        <div style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`, pointerEvents: 'all' }} className="nodrag nopan relative group flex items-center justify-center">
                            <input
                                value={edgeLabel}
                                onChange={onLabelChange}
                                placeholder="Condição..."
                                className="bg-gray-50 text-gray-800 rounded-md px-3 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-brand-primary text-center w-28 placeholder-gray-300 shadow-sm transition-all"
                            />
                            <button 
                                type="button"
                                onClick={onDeleteEdge}
                                className="absolute -top-3 -right-3 bg-red-100 text-red-600 rounded-full p-1.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-200 shadow-sm z-10"
                                title="Excluir Condição"
                            >
                                <Trash2 size={14} />
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm transition-opacity">
            <div className="bg-[#f8fafc] w-full h-full max-w-[1400px] max-h-[95vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden ring-1 ring-white/20">
                {/* Header do Modal Limpo e Moderno */}
                <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-white shadow-sm z-10">
                    <div className="flex items-center gap-3 text-slate-800 font-bold text-lg">
                        <Network size={22} className="text-slate-600" /> Editor de Fluxo de Atendimento
                    </div>
                    <div className="flex items-center gap-4">
                        <button type="button" onClick={onClose} className="underline font-bold text-slate-600 hover:text-slate-800 px-3 py-2 transition-colors text-sm">Descartar</button>
                        <button type="button" onClick={handleSaveWorkflow} className="bg-brand-primary hover:bg-brand-primary-active text-white font-semibold py-2 px-5 rounded-lg shadow-sm flex items-center gap-2 transition-all hover:shadow-md text-sm">
                            <Save size={16} strokeWidth={2.5}/> Salvar Fluxo
                        </button>
                    </div>
                </div>

                <div className="flex-1 flex relative bg-[#fafafa]">
                    {/* Botão Flutuante */}
                    <div className="absolute top-6 left-6 z-10">
                        <button type="button" onClick={handleAddNode} className="flex items-center gap-3 text-sm font-semibold text-slate-800 bg-transparent hover:opacity-80 transition-opacity">
                            <div className="w-12 h-12 bg-brand-primary text-white rounded-full flex items-center justify-center shadow-md">
                                <Plus size={20} strokeWidth={3} />
                            </div>
                            Adicionar Etapa
                        </button>
                    </div>

                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        nodeTypes={editableNodeTypes}
                        edgeTypes={editableEdgeTypes}
                        fitView
                    >
                        <Background variant="dots" gap={16} size={1.5} color="#cbd5e1" />
                        <Controls className="!bg-white !border-gray-200 !shadow-md !rounded-xl overflow-hidden" />
                    </ReactFlow>
                </div>
            </div>
        </div>
    );
};