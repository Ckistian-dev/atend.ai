import React, { useState, useRef, useEffect } from 'react';
import { Phone, FileText, Tag, Edit, Cpu, X, Check, Plus, Clock, Bot, Headset, ArrowRightLeft, Building2, User, CheckCircle2, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/axiosConfig';
import TagEditor from './TagEditor'; // Importa o novo componente
import NameEditor from './NameEditor'; // Importa o novo componente
import TransferModal from '../common/TransferModal';

// --- NOVO Componente: Sidebar de Perfil do Contato ---
const ProfileSidebar = ({
    atendimento, onClose, statusOptions, getTextColorForBackground, isOpen,
    allTags, onUpdateTags, onAddNewTag, onUpdateStatus, onDeleteTag
}) => {
    const [activeSubMenu, setActiveSubMenu] = useState(null);
    const [isEditingObs, setIsEditingObs] = useState(false);
    const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
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

    const handleTransferConfirm = async ({ department, user_id, notes }) => {
        try {
            const res = await api.post(`/atendimentos/${atendimento.id}/transfer`, {
                department,
                user_id,
                notes
            });
            if (onUpdateStatus) {
                onUpdateStatus(atendimento.id, res.data);
            }
            toast.success(`Atendimento transferido para ${department || 'Atendente'} com sucesso!`);
        } catch (err) {
            toast.error('Erro ao transferir atendimento.');
            throw err;
        }
    };

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

                    {/* Department & Assigned User Badges */}
                    {(atendimento.assigned_department || atendimento.assigned_user) && (
                        <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
                            {atendimento.assigned_department && (
                                <span className="px-3 py-1 rounded-full text-[10px] font-extrabold bg-blue-50 text-blue-700 border border-blue-200/80 shadow-sm flex items-center gap-1">
                                    <Building2 size={11} className="text-blue-600" />
                                    Setor: {atendimento.assigned_department}
                                </span>
                            )}
                            {atendimento.assigned_user && (
                                <span className="px-3 py-1 rounded-full text-[10px] font-extrabold bg-indigo-50 text-indigo-700 border border-indigo-200/80 shadow-sm flex items-center gap-1">
                                    <User size={11} className="text-indigo-600" />
                                    {atendimento.assigned_user.name || atendimento.assigned_user.email}
                                </span>
                            )}
                        </div>
                    )}

                    <div className="mt-5 flex flex-col items-center gap-2 w-full">
                        {atendimento.status === 'Concluído' ? (
                            <>
                                <span className="px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200/80 shadow-sm flex items-center gap-1.5">
                                    <CheckCircle2 size={13} className="text-emerald-600" /> Atendimento Concluído
                                </span>
                                <div className="flex items-center gap-2 mt-1 w-full">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            onUpdateStatus(atendimento.id, { status: 'Mensagem Recebida' });
                                            toast.success('Atendimento reaberto com sucesso!');
                                        }}
                                        className="flex-1 px-3.5 py-2.5 rounded-2xl text-[11px] font-black uppercase tracking-wider bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-200 transition-all flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer"
                                    >
                                        <RotateCcw size={13} /> Reabrir
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setIsTransferModalOpen(true)}
                                        className="flex-1 px-3.5 py-2.5 rounded-2xl text-[11px] font-black uppercase tracking-wider bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer"
                                        title="Transferir para outro setor ou atendente"
                                    >
                                        <Headset size={13} /> Transferir
                                    </button>
                                </div>
                            </>
                        ) : atendimento.status === 'Atendente Chamado' ? (
                            <>
                                <span className="px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200/60 shadow-sm flex items-center gap-1.5">
                                    <Headset size={13} /> Atendente Chamado
                                </span>
                                <div className="flex flex-col gap-2 mt-1 w-full">
                                    <div className="flex items-center gap-2 w-full">
                                        <button
                                            type="button"
                                            onClick={() => setIsTransferModalOpen(true)}
                                            className="flex-1 px-3 py-2 rounded-2xl text-[11px] font-black uppercase tracking-wider bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer"
                                            title="Transferir para outro setor ou atendente"
                                        >
                                            <ArrowRightLeft size={13} /> Re-transferir
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onUpdateStatus(atendimento.id, { status: 'Mensagem Recebida' });
                                                toast.success('Atendimento devolvido para a IA');
                                            }}
                                            className="flex-1 px-3 py-2 rounded-2xl text-[11px] font-black uppercase tracking-wider bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-200 transition-all flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer"
                                        >
                                            <Bot size={14} /> Devolver IA
                                        </button>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            onUpdateStatus(atendimento.id, { status: 'Concluído' });
                                            toast.success('Atendimento concluído com sucesso!');
                                        }}
                                        className="w-full px-4 py-2.5 rounded-2xl text-[11px] font-black uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-200 transition-all flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer"
                                    >
                                        <CheckCircle2 size={15} /> Concluir Atendimento
                                    </button>
                                </div>
                            </>
                        ) : (
                            <div className="flex flex-col gap-2 mt-1 w-full">
                                <button
                                    type="button"
                                    onClick={() => {
                                        onUpdateStatus(atendimento.id, { status: 'Concluído' });
                                        toast.success('Atendimento concluído com sucesso!');
                                    }}
                                    className="w-full px-4 py-2.5 rounded-2xl text-[11px] font-black uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-200 transition-all flex items-center justify-center gap-2 active:scale-95 cursor-pointer"
                                >
                                    <CheckCircle2 size={15} /> Concluir Atendimento
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setIsTransferModalOpen(true)}
                                    className="w-full px-4 py-2.5 rounded-2xl text-[11px] font-black uppercase tracking-wider bg-amber-500 hover:bg-amber-600 text-white shadow-md shadow-amber-200 transition-all flex items-center justify-center gap-2 active:scale-95 cursor-pointer"
                                >
                                    <Headset size={15} /> Transferir para Setor/Atendente
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </header>

            {isTransferModalOpen && (
                <TransferModal
                    isOpen={isTransferModalOpen}
                    onClose={() => setIsTransferModalOpen(false)}
                    onConfirm={handleTransferConfirm}
                    currentDepartment={atendimento.assigned_department}
                    currentUserId={atendimento.assigned_user_id}
                    atendimentoName={atendimento.nome_contato}
                    atendimentoWhatsapp={atendimento.whatsapp}
                />
            )}

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
                            <p className="editorial-label pt-1">Anotações</p>
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
                                {obsText || "Nenhuma anotação específica foi registrada por operadores."}
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
                            <TagEditor contactTags={atendimento.tags || []} allTags={allTags} onToggleTag={handleToggleTag} onSaveNewTag={handleSaveNewTag} onDeleteTag={onDeleteTag} onClose={() => setActiveSubMenu(null)} />
                        </div>
                    )}
                </section>

                {/* CONSUMO */}
                <section className="pt-6 border-t border-white/40">
                    <div className="flex items-center justify-between">
                        <p className="editorial-label text-slate-400">Consumo de Tokens</p>
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