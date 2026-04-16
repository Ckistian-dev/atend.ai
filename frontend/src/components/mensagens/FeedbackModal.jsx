import React, { useState, useEffect } from 'react';
import { Wand2, X as XIcon, Loader2, Sparkles, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/axiosConfig';

const FeedbackModal = ({ isOpen, onClose, atendimentoId }) => {
    const [feedbackText, setFeedbackText] = useState('');
    const [feedbackAnalysis, setFeedbackAnalysis] = useState(null);
    const [isAnalyzingFeedback, setIsAnalyzingFeedback] = useState(false);
    const [isApplyingFeedback, setIsApplyingFeedback] = useState(false);

    // Limpa os estados sempre que o modal é fechado ou aberto
    useEffect(() => {
        if (!isOpen) {
            setFeedbackText('');
            setFeedbackAnalysis(null);
            setIsApplyingFeedback(false);
        }
    }, [isOpen]);

    const handleAnalyzeFeedback = async () => {
        if (!feedbackText.trim()) return toast.error("Escreva um feedback primeiro.");
        setIsAnalyzingFeedback(true);
        setFeedbackAnalysis(null);
        try {
            const res = await api.post(`/atendimentos/${atendimentoId}/analyze_feedback`, {
                feedback: feedbackText
            });
            setFeedbackAnalysis(res.data);
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
            const res = await api.post(`/atendimentos/${atendimentoId}/apply_feedback`, {
                alteracoes: feedbackAnalysis.alteracoes_planilha
            });
            toast.success(res.data.message || "Regras aplicadas na planilha com sucesso!", { duration: 6000 });
            onClose();
        } catch (error) {
            toast.error(error.response?.data?.detail || "Erro ao aplicar melhorias na planilha.");
        } finally {
            setIsApplyingFeedback(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-white/95 backdrop-blur-xl rounded-[2.5rem] shadow-[0_20px_60px_rgba(0,0,0,0.15)] w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden border border-white animate-fade-in-up-fast" onClick={(e) => e.stopPropagation()}>
                
                {/* Cabeçalho */}
                <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 rounded-2xl bg-brand-primary/10 flex items-center justify-center">
                                <Wand2 className="text-brand-primary" size={24} />
                            </div>
                            <h2 className="text-2xl font-black tracking-tight text-slate-800">Treinamento de IA</h2>
                        </div>
                        <p className="text-[13px] font-medium text-slate-400">Transforme conversas individuais em regras de inteligência universais.</p>
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
                                <h3 className="text-lg font-bold text-slate-800 mb-2">O que a IA falhou ou pode melhorar?</h3>
                                <p className="text-sm text-slate-400">Descreva o comportamento indesejado ou o que ela deveria ter respondido.</p>
                            </div>

                            <textarea
                                className="w-full p-6 bg-slate-50 rounded-[2rem] border border-transparent focus:bg-white focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 shadow-inner resize-none text-slate-700 font-medium placeholder:text-slate-300 transition-all outline-none"
                                rows="4"
                                placeholder="Ex: Ela demorou muito para falar o preço e ficou fazendo muitas perguntas seguidas..."
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

                            {/* Tabela de Revisão */}
                            <div>
                                <h4 className="editorial-label text-slate-900 mb-6 flex items-center gap-3">
                                    <Sparkles size={16} className="text-brand-primary" /> Sugestão de Melhorias
                                </h4>
                                
                                <div className="border border-slate-100 rounded-[2rem] overflow-hidden shadow-sm bg-white">
                                    <table className="min-w-full divide-y divide-slate-100 text-sm">
                                        <thead className="bg-slate-50/50">
                                            <tr>
                                                <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-slate-400 w-32">Ação</th>
                                                <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-slate-400 w-48">Localização</th>
                                                <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">Estado Atual</th>
                                                <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">Nova Regra Sugerida</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50">
                                            {feedbackAnalysis.alteracoes_planilha?.map((item, i) => (
                                                <tr key={i} className="hover:bg-slate-50/50 transition-colors">
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

                            <div className="flex justify-between items-center bg-slate-50 -mx-8 -mb-8 p-8 mt-10">
                                <p className="text-[12px] font-medium text-slate-400 max-w-sm italic">
                                    Ao clicar em aceitar, estas regras serão inseridas automaticamente na sua planilha de treinamento.
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