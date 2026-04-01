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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm p-4 animate-fade-in-up-fast" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-fade-in-up" onClick={(e) => e.stopPropagation()}>
                <div className="p-6 border-b flex justify-between items-center bg-gray-50">
                    <div>
                        <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2"><Wand2 className="text-brand-primary" /> Treinamento de IA (Engenharia de Prompt)</h2>
                        <p className="text-sm text-gray-500">Avalie esta conversa e deixe a IA sugerir regras universais para sua planilha.</p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><XIcon size={24} /></button>
                </div>

                <div className="p-6 overflow-y-auto flex-1">
                    {!feedbackAnalysis && (
                        <>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">O que a IA fez de errado ou poderia melhorar neste atendimento?</label>
                            <textarea
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-purple-500 focus:border-purple-500 resize-y"
                                rows="3"
                                placeholder="Ex: Ela demorou muito para falar o preço e ficou fazendo muitas perguntas seguidas..."
                                value={feedbackText}
                                onChange={(e) => setFeedbackText(e.target.value)}
                            ></textarea>

                            <div className="mt-4 flex justify-end">
                                <button
                                    onClick={handleAnalyzeFeedback}
                                    disabled={isAnalyzingFeedback || !feedbackText}
                                    className="bg-brand-primary text-white px-4 py-2 rounded-lg font-medium hover:bg-brand-primary-active transition disabled:opacity-50 flex items-center gap-2"
                                >
                                    {isAnalyzingFeedback ? <><Loader2 size={16} className="animate-spin" /> Analisando Contexto...</> : <><Sparkles size={16} /> Gerar Sugestões</>}
                                </button>
                            </div>
                        </>
                    )}

                    {feedbackAnalysis && (
                        <div className="animate-fade-in">
                            <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 mb-6">
                                <h4 className="font-bold text-blue-800 mb-1">Diagnóstico da IA:</h4>
                                <p className="text-sm text-blue-900">{feedbackAnalysis.analise_geral}</p>
                            </div>

                            {/* Tabela de Revisão */}
                            <h4 className="font-bold text-gray-800 mb-3 flex items-center gap-2">Revisão na Planilha:</h4>
                            <div className="overflow-x-auto border border-gray-200 rounded-lg">
                                <table className="min-w-full divide-y divide-gray-200 text-sm">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-4 py-3 text-left font-semibold text-gray-600 w-1/6">Ação</th>
                                            <th className="px-4 py-3 text-left font-semibold text-gray-600 w-1/6">Local</th>
                                            <th className="px-4 py-3 text-left font-semibold text-gray-600 w-1/3">Como está hoje</th>
                                            <th className="px-4 py-3 text-left font-semibold text-gray-700 w-1/3">Como vai ficar</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {feedbackAnalysis.alteracoes_planilha?.map((item, i) => (
                                            <tr key={i} className="hover:bg-gray-50">
                                                <td className="px-4 py-3">
                                                    <span className={`px-2 py-1 rounded text-xs font-bold ${item.acao === 'adicionar' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-brand-primary-active'}`}>{item.acao.toUpperCase()}</span>
                                                </td>
                                                <td className="px-4 py-3 text-gray-700 text-xs">
                                                    <b>{item.aba}</b><br /><span className="text-gray-500 mt-0.5 block">{item.coluna_1}</span>
                                                </td>
                                                <td className="px-4 py-3 text-gray-500 italic text-xs break-words whitespace-pre-wrap">{item.valor_antigo || '---'}</td>
                                                <td className="px-4 py-3 text-gray-900 font-medium text-xs break-words whitespace-pre-wrap">{item.valor_novo}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <div className="mt-6 flex justify-end gap-3">
                                <button 
                                    onClick={handleApplyFeedback} 
                                    disabled={isApplyingFeedback}
                                    className="bg-brand-primary text-white px-5 py-2.5 rounded-lg font-bold hover:bg-brand-primary-active transition flex items-center gap-2 disabled:opacity-50"
                                >
                                    {isApplyingFeedback ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />} 
                                    {isApplyingFeedback ? 'Aplicando...' : 'Aceitar e Aplicar'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FeedbackModal;