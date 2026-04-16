import React, { useState, useRef, useEffect } from 'react';
import { Phone, FileText, Tag, Edit, Cpu, X, Check, Plus, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/axiosConfig';
import TagEditor from './TagEditor'; // Importa o novo componente
import NameEditor from './NameEditor'; // Importa o novo componente

// --- NOVO Componente: Sidebar de Perfil do Contato ---
const ProfileSidebar = ({
    atendimento, onClose, statusOptions, getTextColorForBackground, isOpen,
    allTags, onUpdateTags, onAddNewTag, onUpdateStatus
}) => {
    const [activeSubMenu, setActiveSubMenu] = useState(null);
    const [isEditingObs, setIsEditingObs] = useState(false);
    const [obsText, setObsText] = useState(atendimento.observacoes || '');

    const textareaRef = useRef(null);
    const statusRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (statusRef.current && !statusRef.current.contains(event.target)) {
                if (activeSubMenu === 'status') setActiveSubMenu(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [activeSubMenu]);

    useEffect(() => {
        setIsEditingObs(false);
        setObsText(atendimento.observacoes || '');
        setActiveSubMenu(null);
    }, [atendimento.id]);

    useEffect(() => {
        if (!isEditingObs) setObsText(atendimento.observacoes || '');
    }, [atendimento.observacoes]);

    useEffect(() => {
        if (isEditingObs && textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
    }, [obsText, isEditingObs]);

    const getStatusStyle = (status) => {
        const situacao = statusOptions.find(opt => opt.nome === status);
        if (situacao && situacao.cor) {
            return {
                backgroundColor: situacao.cor,
                color: '#FFFFFF',
                boxShadow: `0 4px 12px ${situacao.cor}40`
            };
        }
        return { backgroundColor: '#64748b', color: '#FFFFFF' };
    };

    const handleStatusChange = (e, newStatus) => {
        e.stopPropagation();
        onUpdateStatus(atendimento.id, { status: newStatus });
        setActiveSubMenu(null);
    };

    const handleSaveName = (newName) => {
        onUpdateStatus(atendimento.id, { nome_contato: newName });
        setActiveSubMenu(null);
    };

    const handleToggleTag = (tag) => {
        const currentTags = atendimento.tags || [];
        const isSelected = currentTags.some(t => t.name === tag.name);
        let newTags = isSelected ? currentTags.filter(t => t.name !== tag.name) : [...currentTags, tag];
        onUpdateTags(atendimento.id, { tags: newTags });
    };

    const handleSaveNewTag = (newTag) => {
        onAddNewTag(newTag);
        handleToggleTag(newTag);
    };

    const handleSaveObs = async () => {
        const newObs = obsText.trim() || null;
        if (onUpdateStatus) onUpdateStatus(atendimento.id, { observacoes: newObs });
        setIsEditingObs(false);
        try {
            await api.put(`/atendimentos/${atendimento.id}`, {
                status: atendimento.status,
                active_persona_id: atendimento.active_persona_id ?? null,
                tags: atendimento.tags || [],
                nome_contato: atendimento.nome_contato ?? null,
                observacoes: newObs
            });
            toast.success('Nota salva');
        } catch (error) { toast.error('Erro ao salvar'); }
    };

    const statusStyle = getStatusStyle(atendimento.status);

    const getAtendimentoMetrics = () => {
        let tempoAtendimento = 0;
        if (atendimento.created_at && atendimento.updated_at) {
            const created = new Date(atendimento.created_at);
            const updated = new Date(atendimento.updated_at);
            tempoAtendimento = (updated - created) / 1000;
        }

        let tempoResposta = 0;
        let totalRespostas = 0;
        try {
            const conversa = typeof atendimento.conversa === 'string' ? JSON.parse(atendimento.conversa) : (atendimento.conversa || []);
            let lastUserTime = null;
            for (const msg of conversa) {
                if (msg.role === 'user') {
                    if (!lastUserTime) lastUserTime = msg.timestamp;
                } else if (msg.role === 'assistant') {
                    if (msg.is_ai) {
                        lastUserTime = null;
                        continue;
                    } else if (lastUserTime) {
                        const diff = parseFloat(msg.timestamp) - parseFloat(lastUserTime);
                        if (!isNaN(diff) && diff >= 0) {
                            tempoResposta += diff;
                            totalRespostas += 1;
                        }
                        lastUserTime = null;
                    }
                }
            }
        } catch (e) {
            console.error("Erro ao calcular tempo de resposta", e);
        }
        const mediaResposta = totalRespostas > 0 ? tempoResposta / totalRespostas : 0;
        
        return { tempoAtendimento, mediaResposta };
    };

    const formatTime = (seconds) => {
        if (seconds === 0) return '—';
        if (seconds < 60) return `${Math.floor(seconds)}s`;
        const minutes = seconds / 60;
        if (minutes < 60) return `${Math.floor(minutes)}m`;
        const hours = minutes / 60;
        if (hours < 24) return `${Math.floor(hours)}h`;
        const days = hours / 24;
        return `${Math.floor(days)}d`;
    };

    return (
        <div className="h-full flex flex-col bg-transparent overflow-hidden">
            {/* EDITORIAL HEADER */}
            <header className="px-6 py-8 flex-shrink-0">
                <div className="flex items-center justify-between mb-6">
                    <p className="editorial-label">Informações do Contato</p>
                    <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-xl bg-white/40 hover:bg-white transition-all text-slate-400">
                        <X size={16} />
                    </button>
                </div>

                <div className="flex flex-col items-center">
                    <div className="w-24 h-24 rounded-[2.5rem] bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-white shadow-xl shadow-blue-200 mb-4 executive-title text-4xl">
                        {(atendimento.nome_contato || atendimento.whatsapp || '??').substring(0, 2).toUpperCase()}
                    </div>

                    <div className="relative group text-center">
                        <h2 className="executive-title text-xl text-slate-900 group-hover:text-blue-600 transition-colors cursor-pointer" onClick={() => setActiveSubMenu(activeSubMenu === 'name' ? null : 'name')}>
                            {atendimento.nome_contato || 'Identificar Lead'}
                        </h2>
                        <p className="text-[12px] font-bold text-slate-400 mt-0.5 flex items-center justify-center gap-2">
                            <Phone size={10} className="text-blue-500" /> {atendimento.whatsapp}
                        </p>

                        {activeSubMenu === 'name' && (
                            <div className="absolute top-full mt-4 z-50 left-1/2 -translate-x-1/2 w-64">
                                <NameEditor currentName={atendimento.nome_contato || ''} onSave={handleSaveName} onClose={() => setActiveSubMenu(null)} />
                            </div>
                        )}
                    </div>

                    <div className="mt-8 relative" ref={statusRef}>
                        <button
                            onClick={() => setActiveSubMenu(activeSubMenu === 'status' ? null : 'status')}
                            className="px-6 py-2 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] transition-all hover:scale-105"
                            style={statusStyle}
                        >
                            {atendimento.status}
                        </button>

                        {activeSubMenu === 'status' && (
                            <div className="absolute top-full mt-4 left-1/2 -translate-x-1/2 w-64 bg-white border border-slate-100 rounded-3xl shadow-2xl z-50 p-2">
                                <p className="editorial-label p-3 border-b border-slate-50 mb-1">Mudar Lead Para</p>
                                <div className="max-h-60 overflow-y-auto no-scrollbar">
                                    {(statusOptions || []).map(opt => (
                                        <button key={opt.nome} onClick={(e) => handleStatusChange(e, opt.nome)} className="w-full text-left p-3 text-[12px] font-bold text-slate-600 hover:bg-slate-50 hover:text-blue-600 rounded-2xl transition-all flex items-center gap-3">
                                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: opt.cor }}></span>
                                            {opt.nome}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </header>

            {/* SCROLLABLE INSIGHTS */}
            <div className="flex-1 overflow-y-auto no-scrollbar px-6 pb-8 space-y-6">
                {/* RESUMO IA */}
                <section>
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <Cpu size={18} className="text-blue-600" />
                            <p className="editorial-label pt-1 text-slate-900">Resumo IA</p>
                        </div>
                        <div className="w-8 h-8 flex items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                            <Cpu size={14} />
                        </div>
                    </div>
                    <div className="p-5 bg-blue-50/50 rounded-3xl border border-blue-50">
                        <p className="text-[13px] leading-relaxed text-slate-600 font-bold italic">
                            {atendimento.resumo || "Aguardando análise de interação significativa..."}
                        </p>
                    </div>
                </section>

                {/* OBSERVATIONS */}
                <section>
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <FileText size={18} className="text-indigo-600" />
                            <p className="editorial-label pt-1">Notas de Campo</p>
                        </div>
                        {!isEditingObs && (
                            <button onClick={() => setIsEditingObs(true)} className="w-8 h-8 flex items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white transition-all">
                                <Edit size={14} />
                            </button>
                        )}
                    </div>

                    {isEditingObs ? (
                        <div className="space-y-3">
                            <textarea
                                ref={textareaRef}
                                value={obsText}
                                onChange={(e) => setObsText(e.target.value)}
                                className="w-full p-5 text-[13px] bg-white rounded-3xl border border-indigo-100 focus:ring-2 focus:ring-indigo-100 outline-none resize-none no-scrollbar font-medium"
                                placeholder="Insira dados críticos do lead..."
                            />
                            <div className="flex justify-end gap-2">
                                <button onClick={() => setIsEditingObs(false)} className="px-4 py-2 text-[10px] font-black uppercase text-slate-400">Cancelar</button>
                                <button onClick={handleSaveObs} className="px-5 py-2 text-[10px] font-black uppercase bg-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-100">Atualizar</button>
                            </div>
                        </div>
                    ) : (
                        <div className="p-5 bg-indigo-50/50 rounded-3xl border border-indigo-50">
                            <p className="text-[13px] text-slate-600 leading-relaxed font-bold italic">
                                {obsText || "Nenhuma nota específica foi registrada por operadores."}
                            </p>
                        </div>
                    )}
                </section>

                {/* TAGS SYSTEM */}
                <section className="relative">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <Tag size={18} className="text-blue-600" />
                            <p className="editorial-label pt-1">Tags</p>
                        </div>
                        <button onClick={() => setActiveSubMenu(activeSubMenu === 'tags' ? null : 'tags')} className="w-8 h-8 flex items-center justify-center rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white transition-all">
                            <Tag size={14} />
                        </button>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                        {(atendimento.tags && atendimento.tags.length > 0) ? (
                            atendimento.tags.map(tag => (
                                <span key={tag.name} className="px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-white rounded-lg shadow-sm" style={{ backgroundColor: tag.color }}>
                                    {tag.name}
                                </span>
                            ))
                        ) : <span className="text-[11px] font-bold text-slate-300 italic">Sem tags aplicadas.</span>}
                    </div>

                    {activeSubMenu === 'tags' && (
                        <div className="absolute right-0 bottom-full mb-4 z-50">
                            <TagEditor contactTags={atendimento.tags || []} allTags={allTags} onToggleTag={handleToggleTag} onSaveNewTag={handleSaveNewTag} onClose={() => setActiveSubMenu(null)} />
                        </div>
                    )}
                </section>

                {/* MÉTRICAS DE TEMPO */}
                <section>
                    <div className="flex items-center gap-3 mb-4 text-slate-800">
                        <Clock size={18} className="text-emerald-500" />
                        <p className="editorial-label pt-1 m-0">Métricas de Tempo</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="bg-emerald-50/50 border border-emerald-100/50 rounded-2xl p-4 flex flex-col gap-1 items-center justify-center">
                            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">T. Atendimento</span>
                            <span className="text-xl font-black text-emerald-700">{formatTime(getAtendimentoMetrics().tempoAtendimento)}</span>
                        </div>
                        <div className="bg-blue-50/50 border border-blue-100/50 rounded-2xl p-4 flex flex-col gap-1 items-center justify-center">
                            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Resposta Humana</span>
                            <span className="text-xl font-black text-blue-700">{formatTime(getAtendimentoMetrics().mediaResposta)}</span>
                        </div>
                    </div>
                </section>

                {/* CONSUMO */}
                <section className="pt-6 border-t border-white/40">
                    <div className="flex items-center justify-between">
                        <p className="editorial-label text-slate-400">Consumo de Atividades</p>
                        <p className="executive-title text-slate-900 text-lg">
                            {atendimento.token_usage ? atendimento.token_usage.toLocaleString('pt-BR') : 0} <span className="text-[10px] font-black text-slate-400">TK</span>
                        </p>
                    </div>
                </section>
            </div>
        </div>
    );
};

export default ProfileSidebar;