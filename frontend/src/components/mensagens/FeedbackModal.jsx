import React, { useState, useEffect } from 'react';
import { Wand2, X as XIcon, Loader2, Sparkles, Check, Network, Maximize2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/axiosConfig';
import { WorkflowPreview } from '../configs/WorkflowEditor';

const FeedbackModal = ({ isOpen, onClose, atendimentoId, configId }) => {
    const [feedbackText, setFeedbackText] = useState('');
    const [feedbackAnalysis, setFeedbackAnalysis] = useState(null);
    const [isAnalyzingFeedback, setIsAnalyzingFeedback] = useState(false);
    const [isApplyingFeedback, setIsApplyingFeedback] = useState(false);

    // Controles de seleção
    const [selectedPlanilha, setSelectedPlanilha] = useState([]);
    const [selectedRag, setSelectedRag] = useState([]);
    const [applyWorkflow, setApplyWorkflow] = useState(true);
    const [showWorkflowPreview, setShowWorkflowPreview] = useState(true);
    const [isFullScreenPreviewOpen, setIsFullScreenPreviewOpen] = useState(false);

    // Limpa os estados sempre que o modal é fechado ou aberto
    useEffect(() => {
        if (!isOpen) {
            setFeedbackText('');
            setFeedbackAnalysis(null);
            setIsApplyingFeedback(false);
            setSelectedPlanilha([]);
            setSelectedRag([]);
            setApplyWorkflow(true);
            setShowWorkflowPreview(true);
            setIsFullScreenPreviewOpen(false);
        }
    }, [isOpen]);

    const handleAnalyzeFeedback = async () => {
        if (!feedbackText.trim()) return toast.error("Escreva um feedback primeiro.");
        setIsAnalyzingFeedback(true);
        setFeedbackAnalysis(null);
        try {
            let endpoint = '';
            if (atendimentoId) {
                endpoint = `/atendimentos/${atendimentoId}/analyze_feedback`;
            } else if (configId) {
                endpoint = `/configs/${configId}/analyze_workflow`;
            } else {
                toast.error("Referência inválida.");
                setIsAnalyzingFeedback(false);
                return;
            }

            const res = await api.post(endpoint, {
                feedback: feedbackText
            }, { timeout: 600000 });
            setFeedbackAnalysis(res.data);
            setSelectedPlanilha(res.data.alteracoes_planilha?.map((_, i) => i) || []);
            setSelectedRag(res.data.alteracoes_rag?.map((_, i) => i) || []);
            setApplyWorkflow(!!res.data.novo_workflow);
        } catch (error) {
            toast.error("Erro ao analisar a conversa.");
            console.error(error);
        } finally {
            setIsAnalyzingFeedback(false);
        }
    };

    const handleApplyFeedback = async () => {
        setIsApplyingFeedback(true);
        try {
            const finalPlanilha = feedbackAnalysis.alteracoes_planilha?.filter((_, i) => selectedPlanilha.includes(i)) || null;
            const finalRag = feedbackAnalysis.alteracoes_rag?.filter((_, i) => selectedRag.includes(i)) || null;
            const finalWorkflow = applyWorkflow ? feedbackAnalysis.novo_workflow : null;

            let endpoint = '';
            if (atendimentoId) {
                endpoint = `/atendimentos/${atendimentoId}/apply_feedback`;
            } else if (configId) {
                endpoint = `/configs/${configId}/apply_workflow`;
            } else {
                toast.error("Referência inválida.");
                setIsApplyingFeedback(false);
                return;
            }

            const res = await api.post(endpoint, {
                alteracoes_planilha: finalPlanilha?.length > 0 ? finalPlanilha : null,
                alteracoes_rag: finalRag?.length > 0 ? finalRag : null,
                novo_workflow: finalWorkflow
            });
            toast.success(res.data.message || "Regras aplicadas com sucesso!", { duration: 6000 });
            onClose();
        } catch (error) {
            toast.error(error.response?.data?.detail || "Erro ao aplicar melhorias na inteligência.");
        } finally {
            setIsApplyingFeedback(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-white/95 backdrop-blur-xl rounded-[2.5rem] shadow-[0_20px_60px_rgba(0,0,0,0.15)] w-full max-w-7xl max-h-[90vh] flex flex-col overflow-hidden border border-white animate-fade-in-up-fast" onClick={(e) => e.stopPropagation()}>

                {/* Cabeçalho */}
                <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 rounded-2xl bg-brand-primary/10 flex items-center justify-center">
                                <Wand2 className="text-brand-primary" size={24} />
                            </div>
                            <h2 className="text-2xl font-black tracking-tight text-slate-800">
                                {atendimentoId ? "Treinamento de IA" : "Edição de Fluxo por IA"}
                            </h2>
                        </div>
                        <p className="text-[13px] font-medium text-slate-400">
                            {atendimentoId ? "Transforme conversas individuais em regras de inteligência universais." : "Explique como quer o fluxo e a IA fará o trabalho duro visual por você."}
                        </p>
                    </div>
                    <button onClick={onClose} className="w-12 h-12 flex items-center justify-center rounded-2xl bg-slate-100 text-slate-400 hover:bg-white hover:text-slate-900 shadow-sm transition-all"><XIcon size={24} /></button>
                </div>

                <div className="p-8 overflow-y-auto flex-1 custom-scrollbar">
                    {!feedbackAnalysis && (
                        <div className="animate-fade-in max-w-2xl mx-auto py-10">
                            <div className="flex flex-col items-center text-center mb-8">
                                <div className="w-16 h-16 rounded-[1.5rem] bg-indigo-50 flex items-center justify-center mb-4">
                                    <Sparkles className="text-indigo-600" size={32} />
                                </div>
                                <h3 className="text-lg font-bold text-slate-800 mb-2">
                                    {atendimentoId ? "O que a IA falhou ou pode melhorar?" : "Descreva o novo fluxo desejado"}
                                </h3>
                                <p className="text-sm text-slate-400">
                                    {atendimentoId 
                                        ? "Descreva o comportamento indesejado ou o que ela deveria ter respondido." 
                                        : "Diga como os blocos devem se comportar e como as conexões devem ser feitas."}
                                </p>
                            </div>

                            <textarea
                                className="w-full p-6 bg-slate-50 rounded-[2rem] border border-transparent focus:bg-white focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 shadow-inner resize-none text-slate-700 font-medium placeholder:text-slate-300 transition-all outline-none"
                                rows="4"
                                placeholder={atendimentoId ? "Ex: Ela demorou muito para falar o preço e ficou fazendo muitas perguntas seguidas..." : "Ex: Quero um fluxo de boas-vindas que pergunte o nome e encaminhe para o setor financeiro."}
                                value={feedbackText}
                                onChange={(e) => setFeedbackText(e.target.value)}
                            ></textarea>

                            <div className="mt-8 flex justify-center">
                                <button
                                    onClick={handleAnalyzeFeedback}
                                    disabled={isAnalyzingFeedback || !feedbackText}
                                    className="group flex items-center gap-4 bg-brand-primary text-white px-10 py-5 rounded-2xl font-black uppercase tracking-widest text-[11px] hover:bg-brand-primary-active hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-brand-primary/20 disabled:opacity-50"
                                >
                                    {isAnalyzingFeedback ? <><Loader2 size={18} className="animate-spin" /> Analisando Contexto...</> : <><Sparkles size={18} /> Analisar e Gerar Regras</>}
                                </button>
                            </div>
                        </div>
                    )}

                    {feedbackAnalysis && (
                        <div className="animate-fade-in space-y-8 pb-4">
                            {/* Bloco de Diagnóstico */}
                            <div className="bg-blue-600 rounded-[2rem] p-8 text-white shadow-2xl shadow-blue-200 relative overflow-hidden group">
                                <div className="absolute top-0 right-0 p-10 opacity-10 group-hover:scale-125 transition-transform duration-1000">
                                    <Wand2 size={120} />
                                </div>
                                <div className="relative z-10">
                                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-100 mb-3 opacity-60">Diagnóstico da IA</div>
                                    <p className="text-[16px] font-bold leading-relaxed">{feedbackAnalysis.analise_geral}</p>
                                </div>
                            </div>

                            {/* Tabela de Revisão do Sistema */}
                            {feedbackAnalysis.alteracoes_planilha?.length > 0 && atendimentoId && (
                                <div>
                                    <h4 className="editorial-label text-slate-900 mb-6 flex items-center gap-3">
                                        <Sparkles size={16} className="text-brand-primary" /> Melhorias (Instruções de Sistema)
                                    </h4>
                                    <div className="border border-slate-100 rounded-[2rem] overflow-hidden shadow-sm bg-white">
                                        <table className="min-w-full divide-y divide-slate-100 text-sm">
                                            <thead className="bg-slate-50/50">
                                                <tr>
                                                    <th className="px-6 py-4 text-left w-16">
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedPlanilha.length === feedbackAnalysis.alteracoes_planilha.length}
                                                            onChange={(e) => setSelectedPlanilha(e.target.checked ? feedbackAnalysis.alteracoes_planilha.map((_, i) => i) : [])}
                                                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                                        />
                                                    </th>
                                                    <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-slate-400 w-32">Ação</th>
                                                    <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-slate-400 w-48">Localização</th>
                                                    <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">Estado Atual</th>
                                                    <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">Nova Regra Sugerida</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-50">
                                                {feedbackAnalysis.alteracoes_planilha.map((item, i) => (
                                                    <tr key={i} className={`transition-all duration-300 ${selectedPlanilha.includes(i) ? 'hover:bg-slate-50/50 bg-white' : 'opacity-50 grayscale hover:bg-slate-50/20 bg-slate-50/30'}`}>
                                                        <td className="px-6 py-5 align-top">
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedPlanilha.includes(i)}
                                                                onChange={(e) => setSelectedPlanilha(e.target.checked ? [...selectedPlanilha, i] : selectedPlanilha.filter(idx => idx !== i))}
                                                                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 mt-1 cursor-pointer"
                                                            />
                                                        </td>
                                                        <td className="px-6 py-5 align-top">
                                                            <span className={`inline-flex px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${item.acao === 'adicionar' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}>
                                                                {item.acao}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-5 align-top">
                                                            <div className="text-[12px] font-bold text-slate-800 mb-1">{item.aba}</div>
                                                            <div className="text-[10px] font-medium text-slate-400">{item.coluna_1}</div>
                                                        </td>
                                                        <td className="px-6 py-5 align-top">
                                                            <p className="text-[12px] text-slate-400 italic leading-relaxed break-words line-clamp-3">{item.valor_antigo || '---'}</p>
                                                        </td>
                                                        <td className="px-6 py-5 align-top">
                                                            <div className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100/50">
                                                                <p className="text-[12px] text-indigo-900 font-bold leading-relaxed break-words">{item.valor_novo}</p>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* Tabela de Revisão do RAG */}
                            {feedbackAnalysis.alteracoes_rag?.length > 0 && atendimentoId && (
                                <div className="mt-8">
                                    <h4 className="editorial-label text-slate-900 mb-6 flex items-center gap-3">
                                        <Sparkles size={16} className="text-brand-primary" /> Melhorias (Base de Conhecimento / RAG)
                                    </h4>
                                    <div className="border border-slate-100 rounded-[2rem] overflow-hidden shadow-sm bg-white">
                                        <table className="min-w-full divide-y divide-slate-100 text-sm">
                                            <thead className="bg-slate-50/50">
                                                <tr>
                                                    <th className="px-6 py-4 text-left w-16">
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedRag.length === feedbackAnalysis.alteracoes_rag.length}
                                                            onChange={(e) => setSelectedRag(e.target.checked ? feedbackAnalysis.alteracoes_rag.map((_, i) => i) : [])}
                                                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                                        />
                                                    </th>
                                                    <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-slate-400 w-32">Ação</th>
                                                    <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-slate-400 w-48">Localização</th>
                                                    <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">Estado Atual</th>
                                                    <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">Nova Regra Sugerida</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-50">
                                                {feedbackAnalysis.alteracoes_rag.map((item, i) => (
                                                    <tr key={i} className={`transition-all duration-300 ${selectedRag.includes(i) ? 'hover:bg-slate-50/50 bg-white' : 'opacity-50 grayscale hover:bg-slate-50/20 bg-slate-50/30'}`}>
                                                        <td className="px-6 py-5 align-top">
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedRag.includes(i)}
                                                                onChange={(e) => setSelectedRag(e.target.checked ? [...selectedRag, i] : selectedRag.filter(idx => idx !== i))}
                                                                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 mt-1 cursor-pointer"
                                                            />
                                                        </td>
                                                        <td className="px-6 py-5 align-top">
                                                            <span className={`inline-flex px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${item.acao === 'adicionar' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}>
                                                                {item.acao}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-5 align-top">
                                                            <div className="text-[12px] font-bold text-slate-800 mb-1">{item.aba}</div>
                                                            <div className="text-[10px] font-medium text-slate-400">{item.coluna_1}</div>
                                                        </td>
                                                        <td className="px-6 py-5 align-top">
                                                            <p className="text-[12px] text-slate-400 italic leading-relaxed break-words line-clamp-3">{item.valor_antigo || '---'}</p>
                                                        </td>
                                                        <td className="px-6 py-5 align-top">
                                                            <div className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100/50">
                                                                <p className="text-[12px] text-indigo-900 font-bold leading-relaxed break-words">{item.valor_novo}</p>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* Atualização de Fluxo */}
                            {feedbackAnalysis.novo_workflow && (
                                <div className={`mt-8 transition-opacity duration-300 ${!applyWorkflow ? 'opacity-50 grayscale' : ''}`}>
                                    <h4 className="editorial-label text-slate-900 mb-6 flex items-center gap-3">
                                        <Network size={16} className="text-brand-primary" /> Atualização no Fluxo Visual (Workflow)
                                    </h4>

                                    <div className="space-y-4">
                                        <div
                                            className={`p-6 rounded-[2rem] border transition-colors cursor-pointer flex items-center justify-between ${applyWorkflow ? 'bg-slate-50/50 border-slate-100' : 'bg-slate-50/30 border-slate-200'}`}
                                            onClick={() => setApplyWorkflow(!applyWorkflow)}
                                        >
                                            <div className="flex items-center gap-5">
                                                <input
                                                    type="checkbox"
                                                    checked={applyWorkflow}
                                                    onChange={() => { }} // Controlled por onClick do wrapper
                                                    className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer pointer-events-none"
                                                />
                                                <div>
                                                    <span className={`px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-[0.15em] mb-2 inline-block ${applyWorkflow ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-500'}`}>
                                                        {applyWorkflow ? 'Aprovar Mudança' : 'Descartado'}
                                                    </span>
                                                    <p className="text-[13px] font-bold text-slate-800">O fluxo visual será ajustado automaticamente.</p>
                                                    <p className="text-[11px] font-medium text-slate-500 mt-1">Foram detectadas mudanças necessárias nos caminhos ou etapas da conversa.</p>
                                                </div>
                                            </div>
                                            <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${applyWorkflow ? 'bg-blue-100 text-blue-600' : 'bg-slate-200 text-slate-400'}`}>
                                                {applyWorkflow ? <Check size={20} /> : <XIcon size={20} />}
                                            </div>
                                        </div>

                                        {/* Preview do Workflow */}
                                        <div className="bg-white border border-slate-100 rounded-[2.5rem] overflow-hidden shadow-sm group">
                                            <div className="px-6 py-4 border-b border-slate-50 bg-slate-50/30 flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
                                                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Preview do Novo Fluxo</span>
                                                </div>
                                                <button
                                                    onClick={() => setIsFullScreenPreviewOpen(true)}
                                                    className="flex items-center gap-2 bg-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-blue-600 border border-blue-100 hover:bg-blue-600 hover:text-white transition-all shadow-sm"
                                                >
                                                    <Maximize2 size={12} />
                                                    Ver Detalhes
                                                </button>
                                            </div>

                                            <div
                                                className="relative cursor-pointer overflow-hidden"
                                                onClick={() => setIsFullScreenPreviewOpen(true)}
                                            >
                                                <div className="h-[300px] w-full bg-slate-50/10 pointer-events-none">
                                                    <WorkflowPreview workflowJson={feedbackAnalysis.novo_workflow} />
                                                </div>
                                                {/* Overlay de Hover */}
                                                <div className="absolute inset-0 bg-blue-600/0 group-hover:bg-blue-600/5 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                                    <div className="bg-white/90 backdrop-blur-md px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 scale-95 group-hover:scale-100 transition-all duration-300">
                                                        <Maximize2 size={16} className="text-blue-600" />
                                                        <span className="text-[11px] font-black uppercase tracking-widest text-blue-600">Clique para ampliar</span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="p-3 bg-blue-50/30 border-t border-slate-50">
                                                <p className="text-[10px] font-medium text-blue-600/60 text-center">
                                                    Exibição simplificada. Clique na imagem para abrir em tela cheia.
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Modal de Preview em Tela Cheia */}
                            {isFullScreenPreviewOpen && (
                                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/90 backdrop-blur-xl p-4 sm:p-10 animate-fade-in" onClick={() => setIsFullScreenPreviewOpen(false)}>
                                    <div className="bg-white w-full h-full rounded-[3rem] shadow-[0_40px_100px_rgba(0,0,0,0.5)] flex flex-col overflow-hidden border border-white/20 animate-fade-in-up-fast" onClick={e => e.stopPropagation()}>
                                        <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                                            <div className="flex items-center gap-4">
                                                <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-xl shadow-blue-200">
                                                    <Network size={24} />
                                                </div>
                                                <div>
                                                    <h3 className="text-xl font-black tracking-tight text-slate-800 uppercase">Arquitetura Proposta</h3>
                                                    <p className="text-[13px] font-medium text-slate-400">Analise detalhadamente o novo funil lógico gerado pela IA.</p>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => setIsFullScreenPreviewOpen(false)}
                                                className="w-14 h-14 flex items-center justify-center rounded-2xl bg-white text-slate-400 hover:bg-slate-900 hover:text-white shadow-sm border border-slate-100 transition-all"
                                            >
                                                <XIcon size={28} />
                                            </button>
                                        </div>
                                        <div className="flex-1 relative bg-slate-50/30">
                                            <WorkflowPreview workflowJson={feedbackAnalysis.novo_workflow} />
                                        </div>
                                        <div className="p-6 bg-slate-900 text-center">
                                            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
                                                Toque fora da área branca ou no botão X para retornar à análise
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="flex justify-between items-center bg-slate-50 -mx-8 -mb-8 p-8 mt-10">
                                <p className="text-[12px] font-medium text-slate-400 max-w-sm italic">
                                    {atendimentoId 
                                        ? "Ao clicar em aceitar, estas regras serão inseridas automaticamente na sua planilha de treinamento."
                                        : "Ao clicar em aceitar, as regras serão salvas imediatamente no fluxo da persona."}
                                </p>
                                <div className="flex gap-4">
                                    <button
                                        onClick={() => setFeedbackAnalysis(null)}
                                        className="px-6 py-4 text-[11px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-900 transition-colors"
                                    >
                                        Revisar
                                    </button>
                                    <button
                                        onClick={handleApplyFeedback}
                                        disabled={isApplyingFeedback}
                                        className="flex items-center gap-3 bg-brand-primary text-white px-8 py-4 rounded-2xl font-black uppercase tracking-widest text-[11px] hover:bg-brand-primary-active hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-brand-primary/20"
                                    >
                                        {isApplyingFeedback ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                                        Aplicar na Inteligência
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FeedbackModal;