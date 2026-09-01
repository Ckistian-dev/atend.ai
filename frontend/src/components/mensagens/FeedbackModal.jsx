import React, { useState, useEffect } from 'react';
import { 
    Wand2, 
    X as XIcon, 
    Loader2, 
    Sparkles, 
    Check, 
    Network, 
    CheckCircle2, 
    AlertCircle,
    ArrowRight,
    HelpCircle,
    Layers,
    FileText,
    Database,
    ShieldCheck
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/axiosConfig';
import { WorkflowPreview, WorkflowEditorModal } from '../configs/WorkflowEditor';

const getFriendlySectionName = (secao, campo) => {
    if (secao && secao.trim()) return secao;
    const map = {
        ai_name: 'Identidade',
        company_name: 'Identidade',
        role: 'Identidade',
        language: 'Identidade',
        nature_identity: 'Identidade',
        objective: 'Missão e Objetivo',
        mission: 'Missão e Objetivo',
        restrictions: 'Regras e Restrições',
        handoff_rules: 'Regras de Transbordo',
        extra_instructions: 'Instruções Adicionais',
        formality: 'Tom de Voz',
        tone: 'Tom de Voz',
        objectivity: 'Tom de Voz',
        qualities: 'Tom de Voz',
    };
    return map[campo] || 'Regras da Persona';
};

const getFriendlyFieldName = (campo) => {
    const map = {
        ai_name: 'Nome do Agente',
        company_name: 'Empresa / Marca',
        role: 'Cargo / Função',
        language: 'Idioma',
        nature_identity: 'Natureza da Identidade',
        objective: 'Objetivo Principal',
        mission: 'Missão',
        restrictions: 'Restrições e Conduta',
        handoff_rules: 'Transbordo Humano',
        extra_instructions: 'Instruções Adicionais',
        formality: 'Nível de Formalidade',
        tone: 'Tom de Voz',
        objectivity: 'Nível de Objetividade',
        qualities: 'Atributos & Qualidades',
    };
    return map[campo] || campo;
};

const renderActionBadge = (acao) => {
    const act = (acao || 'modificar').toLowerCase();
    if (act === 'adicionar') {
        return (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
                + Adicionar
            </span>
        );
    }
    if (act === 'remover') {
        return (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-200">
                ✕ Remover
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200">
            ✎ Reformular / Substituir
        </span>
    );
};

const formatSliderValue = (campo, val) => {
    if (val === null || val === undefined) return 'Não definido';
    const num = Number(val);
    if (isNaN(num)) return String(val);
    if (campo === 'formality') {
        if (num <= 0.3) return `Formal (${num.toFixed(1)})`;
        if (num >= 0.7) return `Informal (${num.toFixed(1)})`;
        return `Semi-formal (${num.toFixed(1)})`;
    }
    if (campo === 'objectivity') {
        if (num <= 0.3) return `Direto (${num.toFixed(1)})`;
        if (num >= 0.7) return `Detalhado (${num.toFixed(1)})`;
        return `Moderado (${num.toFixed(1)})`;
    }
    return num.toFixed(1);
};

// Parser robusto para limpar arrays, JSON stringificados e artefatos de IA
const parseRuleItems = (val) => {
    if (val === null || val === undefined || val === '') return [];
    
    // Se já é um Array nativo
    if (Array.isArray(val)) {
        return val
            .flatMap(item => parseRuleItems(item))
            .filter(Boolean);
    }
    
    // Se é objeto
    if (typeof val === 'object') {
        return Object.values(val)
            .flatMap(item => parseRuleItems(item))
            .filter(Boolean);
    }

    let text = String(val).trim();
    if (!text) return [];

    // Tenta fazer JSON.parse caso seja uma string JSON stringificada
    if ((text.startsWith('[') && text.endsWith(']')) || (text.startsWith('{') && text.endsWith('}'))) {
        try {
            const parsed = JSON.parse(text);
            return parseRuleItems(parsed);
        } catch (e) {
            // Se falhar o parse direto, continua limpando manualmente
        }
    }

    // Remove fragmentos residuais de JSON malformados como '],{campo:...', '}]', etc.
    text = text.replace(/\]\s*,\s*\{.*$/gs, '');
    text = text.replace(/\\n/g, '\n');

    // Divide por quebra de linha
    const lines = text.split('\n');
    const results = [];

    for (let rawLine of lines) {
        let line = rawLine.trim();
        if (!line) continue;

        // Se for linha apenas com colchete/chave de abertura ou fechamento, ignora
        if (/^[\[\]\{\}\(\),;]+$/.test(line)) continue;

        // Remove colchetes, aspas externas e vírgulas finais residuais
        line = line.replace(/^[\[\(\{]\s*/, '').replace(/[\}\]\)]\s*$/, '');
        line = line.replace(/^["'`]\s*/, '').replace(/\s*["'`,;]+$/, '');
        line = line.replace(/^[-•*]\s*/, '');
        line = line.replace(/^\d+[\.\)]\s*/, ''); // Remove numeração tipo 1. ou 1)
        line = line.trim();

        // Se após a limpeza sobrou algo válido
        if (line && line.length > 1 && !/^[\[\]\{\}]+$/.test(line)) {
            // Se dentro da linha ainda tiver múltiplos itens entre aspas tipo "item 1", "item 2"
            if (line.includes('", "') || line.includes('","')) {
                const subItems = line.split(/",\s*"/).map(s => s.replace(/^["'`]|["'`]$/g, '').trim()).filter(Boolean);
                results.push(...subItems);
            } else {
                results.push(line);
            }
        }
    }

    return results;
};

// Renderizador visual limpo para comparação de regras
const renderFormattedRule = (val, isNew = false) => {
    const items = parseRuleItems(val);

    if (items.length === 0) {
        return (
            <div className="flex items-center gap-2.5 py-4 px-4 rounded-xl bg-slate-50 border border-dashed border-slate-200 text-slate-400 text-xs italic">
                <AlertCircle size={15} className="shrink-0 text-slate-400/80" />
                <span>Nenhuma diretriz cadastrada anteriormente</span>
            </div>
        );
    }

    return (
        <div className="space-y-2.5">
            {items.map((item, idx) => (
                <div 
                    key={idx} 
                    className={`flex items-start gap-3 p-3.5 rounded-xl transition-all ${
                        isNew 
                            ? 'bg-indigo-50/60 border border-indigo-100/90 text-indigo-950 shadow-xs hover:bg-indigo-50/90' 
                            : 'bg-white border border-slate-200/80 text-slate-700 hover:border-slate-300'
                    }`}
                >
                    <span 
                        className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-black mt-0.5 select-none ${
                            isNew 
                                ? 'bg-indigo-600 text-white shadow-xs' 
                                : 'bg-slate-200 text-slate-600'
                        }`}
                    >
                        {idx + 1}
                    </span>
                    <p className={`text-[13px] leading-relaxed break-words flex-1 ${isNew ? 'text-indigo-950 font-medium' : 'text-slate-700'}`}>
                        {item}
                    </p>
                </div>
            ))}
        </div>
    );
};

const renderFormDiff = (item) => {
    const acao = (item.acao || 'modificar').toLowerCase();
    const isSlider = ['formality', 'objectivity'].includes(item.campo);
    const isRemove = acao === 'remover';
    const isAdd = acao === 'adicionar';

    if (isSlider) {
        return (
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="bg-slate-50/70 rounded-2xl p-4 border border-slate-200/70 flex flex-col">
                    <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Tom Atual</div>
                    <div className="p-3 bg-white rounded-xl border border-slate-200 text-slate-700 text-xs font-bold">
                        {formatSliderValue(item.campo, item.valor_antigo)}
                    </div>
                </div>
                <div className="bg-indigo-50/30 rounded-2xl p-4 border border-indigo-100 flex flex-col">
                    <div className="text-[10px] font-black uppercase tracking-wider text-indigo-600 mb-2 flex items-center gap-1.5">
                        <Sparkles size={12} /> Novo Tom Sugerido
                    </div>
                    <div className="p-3 bg-indigo-50/80 rounded-xl border border-indigo-200 text-indigo-950 text-xs font-bold">
                        {formatSliderValue(item.campo, item.valor_novo)}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Lado Esquerdo: Estado Atual */}
            <div className={`rounded-2xl p-4 border flex flex-col ${isRemove ? 'bg-rose-50/30 border-rose-100' : 'bg-slate-50/70 border-slate-200/70'}`}>
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-3 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${isRemove ? 'bg-rose-500' : 'bg-slate-400'}`} />
                        {isAdd ? 'Diretriz Existente' : isRemove ? 'Diretriz a ser Excluída' : 'Diretriz Atual a Substituir'}
                    </span>
                    {item.item_referencia && item.item_referencia !== item.valor_antigo && (
                        <span className="text-[9px] font-medium text-slate-400">Ref: {String(item.item_referencia).slice(0, 30)}...</span>
                    )}
                </div>
                <div className="flex-1">
                    {isAdd ? (
                        <div className="flex items-center gap-2.5 py-4 px-4 rounded-xl bg-slate-50 border border-dashed border-slate-200 text-slate-400 text-xs italic">
                            <AlertCircle size={15} className="shrink-0 text-slate-400/80" />
                            <span>Nenhuma regra substituída (Nova diretriz adicional)</span>
                        </div>
                    ) : (
                        renderFormattedRule(item.valor_antigo, false)
                    )}
                </div>
            </div>

            {/* Lado Direito: Nova Proposta */}
            <div className={`rounded-2xl p-4 border flex flex-col ${isRemove ? 'bg-slate-50/60 border-slate-200/60' : 'bg-indigo-50/30 border-indigo-100'}`}>
                <div className="text-[10px] font-black uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    {isRemove ? (
                        <span className="text-rose-600 font-bold flex items-center gap-1">
                            <XIcon size={12} /> Ação Proposta
                        </span>
                    ) : (
                        <span className="text-indigo-600 font-bold flex items-center gap-1">
                            <Sparkles size={12} /> {isAdd ? 'Nova Diretriz a Adicionar' : 'Nova Diretriz Proposta'}
                        </span>
                    )}
                </div>
                <div className="flex-1">
                    {isRemove ? (
                        <div className="flex items-center gap-2.5 py-4 px-4 rounded-xl bg-rose-50/50 border border-dashed border-rose-200 text-rose-700 text-xs font-medium">
                            <AlertCircle size={15} className="shrink-0 text-rose-500" />
                            <span>Esta diretriz será removida das regras da persona.</span>
                        </div>
                    ) : (
                        renderFormattedRule(item.valor_novo, true)
                    )}
                </div>
            </div>
        </div>
    );
};

const FeedbackModal = ({ isOpen, onClose, atendimentoId, configId, mode = 'conversation' }) => {
    const [feedbackText, setFeedbackText] = useState('');
    const [feedbackAnalysis, setFeedbackAnalysis] = useState(null);
    const [isAnalyzingFeedback, setIsAnalyzingFeedback] = useState(false);
    const [isApplyingFeedback, setIsApplyingFeedback] = useState(false);

    // Controles de seleção
    const [selectedFormulario, setSelectedFormulario] = useState([]);
    const [selectedPlanilha, setSelectedPlanilha] = useState([]);
    const [selectedRag, setSelectedRag] = useState([]);
    const [applyWorkflow, setApplyWorkflow] = useState(true);
    const [isWorkflowEditorOpen, setIsWorkflowEditorOpen] = useState(false);

    // Limpa os estados sempre que o modal é fechado ou aberto
    useEffect(() => {
        if (!isOpen) {
            setFeedbackText('');
            setFeedbackAnalysis(null);
            setIsApplyingFeedback(false);
            setSelectedFormulario([]);
            setSelectedPlanilha([]);
            setSelectedRag([]);
            setApplyWorkflow(true);
            setIsWorkflowEditorOpen(false);
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
                if (mode === 'knowledge') {
                    endpoint = `/configs/${configId}/analyze_knowledge`;
                } else {
                    endpoint = `/configs/${configId}/analyze_workflow`;
                }
            } else {
                toast.error("Referência inválida.");
                setIsAnalyzingFeedback(false);
                return;
            }

            const res = await api.post(endpoint, {
                feedback: feedbackText
            }, { timeout: 1200000 });
            setFeedbackAnalysis(res.data);
            setSelectedFormulario(res.data.alteracoes_formulario?.map((_, i) => i) || []);
            setSelectedPlanilha(res.data.alteracoes_planilha?.map((_, i) => i) || []);
            setSelectedRag(res.data.alteracoes_rag?.map((_, i) => i) || []);
            setApplyWorkflow(!!res.data.novo_workflow);
        } catch (error) {
            toast.error("Erro ao analisar o contexto.");
            console.error(error);
        } finally {
            setIsAnalyzingFeedback(false);
        }
    };

    const handleApplyFeedback = async () => {
        setIsApplyingFeedback(true);
        try {
            const finalFormulario = feedbackAnalysis.alteracoes_formulario
                ?.filter((_, i) => selectedFormulario.includes(i))
                ?.map(item => ({
                    campo: item.campo,
                    secao: item.secao,
                    acao: item.acao || 'modificar',
                    item_referencia: item.item_referencia || (item.acao !== 'adicionar' ? (typeof item.valor_antigo === 'string' ? item.valor_antigo : null) : null),
                    valor_antigo: item.valor_antigo,
                    valor_novo: item.valor_novo,
                    motivo: item.motivo
                })) || null;

            const finalPlanilha = feedbackAnalysis.alteracoes_planilha?.filter((_, i) => selectedPlanilha.includes(i)) || null;
            const finalRag = feedbackAnalysis.alteracoes_rag?.filter((_, i) => selectedRag.includes(i)) || null;
            const finalWorkflow = applyWorkflow ? feedbackAnalysis.novo_workflow : null;

            let endpoint = '';
            if (atendimentoId) {
                endpoint = `/atendimentos/${atendimentoId}/apply_feedback`;
            } else if (configId) {
                if (mode === 'knowledge') {
                    endpoint = `/configs/${configId}/apply_feedback`;
                } else {
                    endpoint = `/configs/${configId}/apply_workflow`;
                }
            } else {
                toast.error("Referência inválida.");
                setIsApplyingFeedback(false);
                return;
            }

            const res = await api.post(endpoint, {
                alteracoes_formulario: finalFormulario?.length > 0 ? finalFormulario : null,
                novo_persona_form: null,
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 backdrop-blur-md p-3 sm:p-6 animate-fade-in" onClick={onClose}>
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden border border-slate-100 animate-fade-in-up-fast" onClick={(e) => e.stopPropagation()}>

                {/* Cabeçalho Fixo */}
                <div className="px-6 py-5 sm:px-8 sm:py-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/70 backdrop-blur-sm shrink-0">
                    <div className="flex items-center gap-3.5">
                        <div className="w-11 h-11 rounded-2xl bg-indigo-600/10 text-indigo-600 flex items-center justify-center shrink-0">
                            <Wand2 size={22} className="text-indigo-600" />
                        </div>
                        <div>
                            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-slate-800">
                                {atendimentoId ? "Treinamento de IA" : mode === 'knowledge' ? "Melhoria de Conhecimento por IA" : "Edição de Fluxo por IA"}
                            </h2>
                            <p className="text-xs sm:text-sm font-medium text-slate-400 mt-0.5">
                                {atendimentoId 
                                    ? "Transforme conversas individuais em regras de inteligência universais." 
                                    : mode === 'knowledge' 
                                        ? "Explique o que deseja corrigir e a IA ajustará as bases de dados." 
                                        : "Descreva o fluxo desejado e a IA organizará as etapas automaticamente."}
                            </p>
                        </div>
                    </div>
                    <button 
                        onClick={onClose} 
                        className="w-10 h-10 flex items-center justify-center rounded-xl bg-white border border-slate-200 text-slate-400 hover:bg-slate-100 hover:text-slate-700 shadow-xs transition-all"
                    >
                        <XIcon size={20} />
                    </button>
                </div>

                {/* Corpo Rolável */}
                <div className="p-6 sm:p-8 overflow-y-auto flex-1 custom-scrollbar space-y-6">
                    {!feedbackAnalysis && (
                        <div className="animate-fade-in max-w-2xl mx-auto py-8">
                            <div className="flex flex-col items-center text-center mb-8">
                                <div className="w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center mb-4 text-indigo-600 shadow-inner">
                                    <Sparkles size={30} />
                                </div>
                                <h3 className="text-lg font-bold text-slate-800 mb-2">
                                    {atendimentoId ? "O que a IA falhou ou pode melhorar?" : mode === 'knowledge' ? "Descreva as regras ou conhecimentos que deseja ajustar" : "Descreva o novo fluxo desejado"}
                                </h3>
                                <p className="text-xs sm:text-sm text-slate-400 max-w-md">
                                    {atendimentoId 
                                        ? "Descreva com suas palavras o comportamento indesejado ou o que ela deveria ter respondido nesta conversa." 
                                        : mode === 'knowledge' 
                                            ? "Diga quais informações estão incorretas, desatualizadas ou o que precisa ser acrescentado na base."
                                            : "Diga como os blocos devem se comportar e como as conexões devem ser feitas."}
                                </p>
                            </div>

                            <textarea
                                className="w-full p-5 sm:p-6 bg-slate-50 rounded-2xl border border-slate-200/80 focus:bg-white focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/10 shadow-xs resize-none text-slate-800 text-sm font-medium placeholder:text-slate-400 transition-all outline-none leading-relaxed"
                                rows="5"
                                placeholder={atendimentoId 
                                    ? "Ex: A IA ofereceu transbordo muito cedo, antes de tirar as dúvidas básicas sobre o produto. Quero que ela atenda até o final e só transfira se o cliente pedir..." 
                                    : mode === 'knowledge'
                                        ? "Ex: Atualize o preço do produto X para R$ 150 e adicione a política de devolução de 7 dias."
                                        : "Ex: Quero um fluxo de boas-vindas que pergunte o nome e encaminhe para o setor financeiro."}
                                value={feedbackText}
                                onChange={(e) => setFeedbackText(e.target.value)}
                            ></textarea>

                            <div className="mt-8 flex justify-center">
                                <button
                                    onClick={handleAnalyzeFeedback}
                                    disabled={isAnalyzingFeedback || !feedbackText.trim()}
                                    className="flex items-center gap-3 bg-indigo-600 text-white px-8 py-4 rounded-xl font-bold uppercase tracking-wider text-xs hover:bg-indigo-700 hover:shadow-lg hover:shadow-indigo-600/20 active:scale-[0.98] transition-all disabled:opacity-50"
                                >
                                    {isAnalyzingFeedback ? (
                                        <>
                                            <Loader2 size={18} className="animate-spin" /> 
                                            <span>Analisando Contexto com IA...</span>
                                        </>
                                    ) : (
                                        <>
                                            <Sparkles size={18} /> 
                                            <span>Analisar e Gerar Regras</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    )}

                    {feedbackAnalysis && (
                        <div className="animate-fade-in space-y-6">
                            
                            {/* Bloco de Diagnóstico Hero */}
                            <div className="bg-gradient-to-r from-blue-700 via-indigo-600 to-indigo-800 rounded-2xl p-6 sm:p-7 text-white shadow-lg shadow-indigo-600/10 relative overflow-hidden">
                                <div className="absolute -right-6 -bottom-6 opacity-10 pointer-events-none">
                                    <Wand2 size={140} />
                                </div>
                                <div className="relative z-10 space-y-2.5">
                                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 backdrop-blur-md text-[11px] font-black uppercase tracking-widest text-blue-100 border border-white/10">
                                        <Sparkles size={13} className="text-amber-300" />
                                        <span>Diagnóstico & Diretrizes Propostas</span>
                                    </div>
                                    <p className="text-sm sm:text-[15px] font-medium leading-relaxed text-white/95">
                                        {feedbackAnalysis.analise_geral}
                                    </p>
                                </div>
                            </div>

                            {/* Cards de Comparação: Regras da Persona (Aba Persona) */}
                            {feedbackAnalysis.alteracoes_formulario?.length > 0 && (
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2.5">
                                            <div className="w-6 h-6 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                                                <ShieldCheck size={16} />
                                            </div>
                                            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
                                                Melhorias nas Regras da Persona
                                            </h4>
                                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-600 border border-indigo-100">
                                                {feedbackAnalysis.alteracoes_formulario.length} {feedbackAnalysis.alteracoes_formulario.length === 1 ? 'sugestão' : 'sugestões'}
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const all = feedbackAnalysis.alteracoes_formulario.map((_, i) => i);
                                                setSelectedFormulario(selectedFormulario.length === all.length ? [] : all);
                                            }}
                                            className="text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors"
                                        >
                                            {selectedFormulario.length === feedbackAnalysis.alteracoes_formulario.length ? 'Desmarcar todas' : 'Selecionar todas'}
                                        </button>
                                    </div>

                                    <div className="space-y-4">
                                        {feedbackAnalysis.alteracoes_formulario.map((item, i) => {
                                            const isSelected = selectedFormulario.includes(i);
                                            return (
                                                <div
                                                    key={i}
                                                    className={`rounded-2xl border transition-all duration-200 overflow-hidden bg-white ${
                                                        isSelected
                                                            ? 'border-indigo-200 shadow-md shadow-indigo-100/40 ring-1 ring-indigo-200/50'
                                                            : 'border-slate-200/80 opacity-60 hover:opacity-100'
                                                    }`}
                                                >
                                                    {/* Header do Card */}
                                                    <div
                                                        onClick={() => setSelectedFormulario(isSelected ? selectedFormulario.filter(idx => idx !== i) : [...selectedFormulario, i])}
                                                        className="p-4 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between cursor-pointer select-none"
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <input
                                                                type="checkbox"
                                                                checked={isSelected}
                                                                onChange={() => {}}
                                                                className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer pointer-events-none"
                                                            />
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <span className="text-xs font-bold text-slate-800">
                                                                    {getFriendlySectionName(item.secao, item.campo)}
                                                                </span>
                                                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-600 uppercase tracking-wider">
                                                                    {getFriendlyFieldName(item.campo)}
                                                                </span>
                                                                {renderActionBadge(item.acao)}
                                                            </div>
                                                        </div>

                                                        <span className={`text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-lg flex items-center gap-1.5 ${
                                                            isSelected ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-500'
                                                        }`}>
                                                            {isSelected && <Check size={12} className="stroke-[3]" />}
                                                            {isSelected ? 'Aprovada para Aplicação' : 'Descartada'}
                                                        </span>
                                                    </div>

                                                    {/* Motivo se houver */}
                                                    {item.motivo && (
                                                        <div className="px-5 py-3 bg-amber-50/60 border-b border-amber-100/60 flex items-start gap-2.5">
                                                            <Sparkles size={14} className="text-amber-600 shrink-0 mt-0.5" />
                                                            <p className="text-xs text-amber-900 font-medium leading-snug">{item.motivo}</p>
                                                        </div>
                                                    )}

                                                    {/* Comparação Antes vs Depois Inteligente */}
                                                    {renderFormDiff(item)}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Cards de Comparação: Planilha de Instruções Legada */}
                            {feedbackAnalysis.alteracoes_planilha?.length > 0 && (
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2.5">
                                            <div className="w-6 h-6 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                                                <FileText size={16} />
                                            </div>
                                            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
                                                Instruções de Sistema (Planilha)
                                            </h4>
                                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-600 border border-blue-100">
                                                {feedbackAnalysis.alteracoes_planilha.length} {feedbackAnalysis.alteracoes_planilha.length === 1 ? 'item' : 'itens'}
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const all = feedbackAnalysis.alteracoes_planilha.map((_, i) => i);
                                                setSelectedPlanilha(selectedPlanilha.length === all.length ? [] : all);
                                            }}
                                            className="text-xs font-bold text-blue-600 hover:text-blue-800 transition-colors"
                                        >
                                            {selectedPlanilha.length === feedbackAnalysis.alteracoes_planilha.length ? 'Desmarcar todas' : 'Selecionar todas'}
                                        </button>
                                    </div>

                                    <div className="space-y-4">
                                        {feedbackAnalysis.alteracoes_planilha.map((item, i) => {
                                            const isSelected = selectedPlanilha.includes(i);
                                            return (
                                                <div
                                                    key={i}
                                                    className={`rounded-2xl border transition-all duration-200 overflow-hidden bg-white ${
                                                        isSelected
                                                            ? 'border-blue-200 shadow-md shadow-blue-50/50 ring-1 ring-blue-200/50'
                                                            : 'border-slate-200/80 opacity-60 hover:opacity-100'
                                                    }`}
                                                >
                                                    <div
                                                        onClick={() => setSelectedPlanilha(isSelected ? selectedPlanilha.filter(idx => idx !== i) : [...selectedPlanilha, i])}
                                                        className="p-4 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between cursor-pointer select-none"
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <input
                                                                type="checkbox"
                                                                checked={isSelected}
                                                                onChange={() => {}}
                                                                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer pointer-events-none"
                                                            />
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-xs font-bold text-slate-800">{item.aba}</span>
                                                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-600">
                                                                    {item.coluna_1}
                                                                </span>
                                                                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-md ${
                                                                    item.acao === 'adicionar' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'
                                                                }`}>
                                                                    {item.acao}
                                                                </span>
                                                            </div>
                                                        </div>

                                                        <span className={`text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-lg ${
                                                            isSelected ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-500'
                                                        }`}>
                                                            {isSelected ? 'Aprovada' : 'Descartada'}
                                                        </span>
                                                    </div>

                                                    <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
                                                        <div className="bg-slate-50/70 rounded-2xl p-4 border border-slate-200/70 flex flex-col">
                                                            <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-3">Estado Atual</div>
                                                            {renderFormattedRule(item.valor_antigo, false)}
                                                        </div>
                                                        <div className="bg-blue-50/30 rounded-2xl p-4 border border-blue-100 flex flex-col">
                                                            <div className="text-[10px] font-black uppercase tracking-wider text-blue-600 mb-3">Nova Regra Sugerida</div>
                                                            {renderFormattedRule(item.valor_novo, true)}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Cards de Comparação: Base de Conhecimento (RAG) */}
                            {feedbackAnalysis.alteracoes_rag?.length > 0 && (
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2.5">
                                            <div className="w-6 h-6 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                                                <Database size={16} />
                                            </div>
                                            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
                                                Base de Conhecimento (RAG)
                                            </h4>
                                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-600 border border-emerald-100">
                                                {feedbackAnalysis.alteracoes_rag.length} {feedbackAnalysis.alteracoes_rag.length === 1 ? 'item' : 'itens'}
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const all = feedbackAnalysis.alteracoes_rag.map((_, i) => i);
                                                setSelectedRag(selectedRag.length === all.length ? [] : all);
                                            }}
                                            className="text-xs font-bold text-emerald-600 hover:text-emerald-800 transition-colors"
                                        >
                                            {selectedRag.length === feedbackAnalysis.alteracoes_rag.length ? 'Desmarcar todas' : 'Selecionar todas'}
                                        </button>
                                    </div>

                                    <div className="space-y-4">
                                        {feedbackAnalysis.alteracoes_rag.map((item, i) => {
                                            const isSelected = selectedRag.includes(i);
                                            return (
                                                <div
                                                    key={i}
                                                    className={`rounded-2xl border transition-all duration-200 overflow-hidden bg-white ${
                                                        isSelected
                                                            ? 'border-emerald-200 shadow-md shadow-emerald-50/50 ring-1 ring-emerald-200/50'
                                                            : 'border-slate-200/80 opacity-60 hover:opacity-100'
                                                    }`}
                                                >
                                                    <div
                                                        onClick={() => setSelectedRag(isSelected ? selectedRag.filter(idx => idx !== i) : [...selectedRag, i])}
                                                        className="p-4 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between cursor-pointer select-none"
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <input
                                                                type="checkbox"
                                                                checked={isSelected}
                                                                onChange={() => {}}
                                                                className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer pointer-events-none"
                                                            />
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-xs font-bold text-slate-800">{item.aba}</span>
                                                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-600">
                                                                    {item.coluna_1}
                                                                </span>
                                                                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-md ${
                                                                    item.acao === 'adicionar' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'
                                                                }`}>
                                                                    {item.acao}
                                                                </span>
                                                            </div>
                                                        </div>

                                                        <span className={`text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-lg ${
                                                            isSelected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'
                                                        }`}>
                                                            {isSelected ? 'Aprovada' : 'Descartada'}
                                                        </span>
                                                    </div>

                                                    <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
                                                        <div className="bg-slate-50/70 rounded-2xl p-4 border border-slate-200/70 flex flex-col">
                                                            <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-3">Estado Atual</div>
                                                            {renderFormattedRule(item.valor_antigo, false)}
                                                        </div>
                                                        <div className="bg-emerald-50/30 rounded-2xl p-4 border border-emerald-100 flex flex-col">
                                                            <div className="text-[10px] font-black uppercase tracking-wider text-emerald-600 mb-3">Nova Regra Sugerida</div>
                                                            {renderFormattedRule(item.valor_novo, true)}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Atualização de Fluxo */}
                            {feedbackAnalysis.novo_workflow && (
                                <div className={`space-y-4 transition-opacity duration-300 ${!applyWorkflow ? 'opacity-50 grayscale' : ''}`}>
                                    <div className="flex items-center gap-2.5">
                                        <div className="w-6 h-6 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                                            <Network size={16} />
                                        </div>
                                        <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
                                            Atualização no Fluxo Visual (Workflow)
                                        </h4>
                                    </div>

                                    <div className="space-y-4">
                                        <div
                                            className={`p-5 rounded-2xl border transition-colors cursor-pointer flex items-center justify-between ${applyWorkflow ? 'bg-blue-50/40 border-blue-100' : 'bg-slate-50 border-slate-200'}`}
                                            onClick={() => setApplyWorkflow(!applyWorkflow)}
                                        >
                                            <div className="flex items-center gap-4">
                                                <input
                                                    type="checkbox"
                                                    checked={applyWorkflow}
                                                    onChange={() => { }}
                                                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer pointer-events-none"
                                                />
                                                <div>
                                                    <span className={`px-2.5 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider mb-1.5 inline-block ${applyWorkflow ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-500'}`}>
                                                        {applyWorkflow ? 'Aprovar Mudança no Fluxo' : 'Descartado'}
                                                    </span>
                                                    <p className="text-xs font-bold text-slate-800">O fluxo visual será ajustado automaticamente.</p>
                                                    <p className="text-[11px] font-medium text-slate-500 mt-0.5">Foram detectadas mudanças necessárias nas etapas da conversa.</p>
                                                </div>
                                            </div>
                                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${applyWorkflow ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-400'}`}>
                                                {applyWorkflow ? <Check size={18} /> : <XIcon size={18} />}
                                            </div>
                                        </div>

                                        {/* Preview do Workflow */}
                                        <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-xs group">
                                            <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                                                <div className="flex items-center gap-2.5">
                                                    <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
                                                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Preview do Novo Fluxo</span>
                                                </div>
                                                <button
                                                    onClick={() => setIsWorkflowEditorOpen(true)}
                                                    className="flex items-center gap-2 bg-white px-3.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider text-blue-600 border border-blue-200 hover:bg-blue-600 hover:text-white transition-all shadow-xs"
                                                >
                                                    <Network size={12} />
                                                    Editar e Interagir
                                                </button>
                                            </div>

                                            <div
                                                className="relative cursor-pointer overflow-hidden"
                                                onClick={() => setIsWorkflowEditorOpen(true)}
                                            >
                                                <div className="h-[280px] w-full bg-slate-50/10 pointer-events-none">
                                                    <WorkflowPreview workflowJson={feedbackAnalysis.novo_workflow} />
                                                </div>
                                                <div className="absolute inset-0 bg-blue-600/0 group-hover:bg-blue-600/5 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                                    <div className="bg-white/95 backdrop-blur-md px-5 py-2.5 rounded-xl shadow-lg flex items-center gap-2.5 scale-95 group-hover:scale-100 transition-all duration-300">
                                                        <Sparkles size={15} className="text-blue-600" />
                                                        <span className="text-xs font-bold text-blue-600">Abrir Editor Interativo</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Modal de Editor de Fluxo Interativo */}
                            {isWorkflowEditorOpen && (
                                <WorkflowEditorModal
                                    isOpen={isWorkflowEditorOpen}
                                    onClose={() => setIsWorkflowEditorOpen(false)}
                                    initialWorkflow={feedbackAnalysis.novo_workflow}
                                    onSave={(updatedWorkflow) => {
                                        setFeedbackAnalysis({
                                            ...feedbackAnalysis,
                                            novo_workflow: updatedWorkflow
                                        });
                                        toast.success("Alterações no fluxo aplicadas à revisão!");
                                    }}
                                />
                            )}

                        </div>
                    )}
                </div>

                {/* Rodapé Fixo na Parte Inferior */}
                {feedbackAnalysis && (
                    <div className="px-6 py-4 sm:px-8 border-t border-slate-100 bg-slate-50/90 backdrop-blur-md flex flex-col sm:flex-row justify-between items-center gap-3 shrink-0">
                        <p className="text-xs text-slate-500 font-medium text-center sm:text-left">
                            Ao clicar em aplicar, as diretrizes serão salvas na inteligência da sua IA.
                        </p>
                        <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                            <button
                                onClick={() => setFeedbackAnalysis(null)}
                                className="px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-slate-500 hover:text-slate-900 transition-colors"
                            >
                                Voltar / Refazer
                            </button>
                            <button
                                onClick={handleApplyFeedback}
                                disabled={isApplyingFeedback}
                                className="flex items-center justify-center gap-2.5 bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold uppercase tracking-wider text-xs hover:bg-indigo-700 hover:shadow-lg hover:shadow-indigo-600/20 active:scale-[0.98] transition-all disabled:opacity-50"
                            >
                                {isApplyingFeedback ? (
                                    <>
                                        <Loader2 size={16} className="animate-spin" />
                                        <span>Aplicando...</span>
                                    </>
                                ) : (
                                    <>
                                        <Check size={16} className="stroke-[3]" />
                                        <span>Aplicar na Inteligência</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
};

export default FeedbackModal;