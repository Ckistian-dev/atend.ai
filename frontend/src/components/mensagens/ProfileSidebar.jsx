import React, { useState, useRef, useEffect } from 'react';
import { Phone, FileText, Tag, Edit, Cpu, X, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/axiosConfig';
import TagEditor from './TagEditor'; // Importa o novo componente
import NameEditor from './NameEditor'; // Importa o novo componente

// --- NOVO Componente: Sidebar de Perfil do Contato ---
const ProfileSidebar = ({
    atendimento, onClose, statusOptions, getTextColorForBackground, isOpen,
    // Novas props para o editor de tags
    allTags, onUpdateTags, onAddNewTag, onUpdateStatus
}) => {
    // --- ESTADOS DE EDIÇÃO ---
    const [activeSubMenu, setActiveSubMenu] = useState(null);
    
    // --- ESTADOS PARA EDIÇÃO DE OBSERVAÇÕES ---
    const [isEditingObs, setIsEditingObs] = useState(false);
    const [obsText, setObsText] = useState(atendimento.observacoes || '');
    
    // Refs
    const textareaRef = useRef(null);
    const statusRef = useRef(null);

    // Efeito para fechar o menu ao clicar fora
    useEffect(() => {
        const handleClickOutside = (event) => {
            // Fecha o dropdown de status se clicar fora
            if (statusRef.current && !statusRef.current.contains(event.target)) {
                if (activeSubMenu === 'status') setActiveSubMenu(null);
            }
            // Nota: TagEditor lida com seu próprio clique fora
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [activeSubMenu]);

    // Reset ao mudar de atendimento
    useEffect(() => {
        setIsEditingObs(false);
        setObsText(atendimento.observacoes || '');
        
        setActiveSubMenu(null);
    }, [atendimento.id]);

    // Sincroniza observações quando atualizadas externamente (se não estiver editando)
    useEffect(() => {
        if (!isEditingObs) setObsText(atendimento.observacoes || '');
    }, [atendimento.observacoes]);

    // Auto-resize do textarea de observações
    useEffect(() => {
        if (isEditingObs && textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
    }, [obsText, isEditingObs]);

    // Foca no textarea ao abrir a edição e move cursor para o final
    useEffect(() => {
        if (isEditingObs && textareaRef.current) {
            textareaRef.current.focus();
            textareaRef.current.setSelectionRange(textareaRef.current.value.length, textareaRef.current.value.length);
        }
    }, [isEditingObs]);

    const getStatusStyle = (status) => {
        const situacao = statusOptions.find(opt => opt.nome === status);
        if (situacao && situacao.cor) {
            return {
                backgroundColor: situacao.cor,
                color: getTextColorForBackground(situacao.cor),
            };
        }
        return { backgroundColor: '#6b7280', color: '#FFFFFF' }; // Fallback cinza
    };

    const handleStatusChange = (e, newStatus) => {
        e.stopPropagation();
        onUpdateStatus(atendimento.id, { status: newStatus });
        setActiveSubMenu(null);
    };

    // --- NOVA FUNÇÃO: Salva o nome via Popup ---
    const handleSaveName = (newName) => {
        onUpdateStatus(atendimento.id, { nome_contato: newName });
        setActiveSubMenu(null);
    };

    const handleToggleTag = (tag) => {
        const currentTags = atendimento.tags || [];
        const isSelected = currentTags.some(t => t.name === tag.name);
        let newTags;
        if (isSelected) {
            newTags = currentTags.filter(t => t.name !== tag.name);
        } else {
            newTags = [...currentTags, tag];
        }
        onUpdateTags(atendimento.id, { tags: newTags });
    };

    const handleSaveNewTag = (newTag) => {
        onAddNewTag(newTag); // Adiciona na lista global
        handleToggleTag(newTag); // Adiciona ao contato atual
    };

    const handleSaveObs = async () => {
        const newObs = obsText.trim() || null;

        if (onUpdateStatus) {
            onUpdateStatus(atendimento.id, { observacoes: newObs });
        }
        setIsEditingObs(false);

        try {
            await api.put(`/atendimentos/${atendimento.id}`, {
                status: atendimento.status,
                active_persona_id: atendimento.active_persona_id ?? null,
                tags: atendimento.tags || [],
                nome_contato: atendimento.nome_contato ?? null,
                observacoes: newObs
            });
            toast.success('Observações atualizadas!');
        } catch (error) {
            console.error("Erro ao salvar observações:", error);
            toast.error('Erro ao salvar observações.');
        }
    };

    const statusStyle = getStatusStyle(atendimento.status);

    return (
        <>
            {/* Fundo com Overlay (visível apenas em telas menores) */}
            <div
                className={`fixed inset-0 bg-black bg-opacity-30 z-30 transition-opacity duration-300 md:hidden ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                onClick={onClose}
            ></div>

            {/* Conteúdo da Sidebar */}
            <div className={`h-full bg-gray-50 border-l border-gray-200 flex flex-col shadow-2xl z-40`}>
                {/* Header */}
                <header className="flex-shrink-0 flex items-center justify-between p-3 bg-white border-b border-gray-200 h-16">
                    <h3 className="text-lg font-semibold text-gray-800 truncate whitespace-nowrap">Dados do Contato</h3>
                    <button onClick={onClose} className="md:hidden p-1 rounded-full text-gray-500 hover:bg-gray-100">
                        <X size={20} />
                    </button>
                </header>

                {/* Body */}
                <div className="flex-1 p-6 overflow-y-auto space-y-6">
                    <div className="text-center">
                        {/* Avatar */}
                        <div className="w-24 h-24 rounded-full mx-auto bg-gradient-to-br from-gray-300 to-gray-400 flex items-center justify-center mb-4 shadow-md">
                            <span className="text-4xl font-bold text-white">
                                {atendimento.nome_contato ? (atendimento.nome_contato || '??').substring(0, 2).toUpperCase() : (atendimento.whatsapp || '??').slice(-2)}
                            </span>
                        </div>
                        
                        {/* Nome com Edição Popup */}
                        <div className="flex items-center justify-center gap-2 mb-1 min-h-[32px] relative">
                            <h2 className="text-xl font-bold text-gray-900 truncate max-w-[220px]">{atendimento.nome_contato || 'Contato sem nome'}</h2>
                            <button onClick={() => setActiveSubMenu(activeSubMenu === 'name' ? null : 'name')} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-gray-100 rounded-full transition-colors" title="Editar nome">
                                <Edit size={14} />
                            </button>

                            {/* Popup NameEditor */}
                            {activeSubMenu === 'name' && (
                                <div className="absolute top-full mt-2 z-30 left-1/2 transform -translate-x-1/2 w-64">
                                    <NameEditor
                                        currentName={atendimento.nome_contato || ''}
                                        onSave={handleSaveName}
                                        onClose={() => setActiveSubMenu(null)}
                                    />
                                </div>
                            )}
                        </div>

                        <p className="text-md text-gray-500 flex items-center justify-center gap-2 mt-1 truncate"><Phone size={14} /> {atendimento.whatsapp}</p>
                        
                        {/* Status com Edição */}
                        <div className="mt-4 flex justify-center relative" ref={statusRef}>
                            <div className="flex items-center gap-2">
                                <span className="inline-block px-3 py-1 text-sm font-semibold rounded-full shadow-sm truncate" style={statusStyle}>{atendimento.status}</span>
                                <button onClick={() => setActiveSubMenu(activeSubMenu === 'status' ? null : 'status')} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-gray-100 rounded-full transition-colors" title="Alterar situação">
                                    <Edit size={14} />
                                </button>
                            </div>
                            
                            {/* Dropdown de Status */}
                            {activeSubMenu === 'status' && (
                                <div className="absolute top-full mt-2 w-56 bg-white rounded-md shadow-lg z-20 overflow-hidden animate-fade-in-up-fast border border-gray-100 left-1/2 transform -translate-x-1/2">
                                    <span className="block px-4 py-2 text-xs font-semibold text-gray-500 border-b bg-gray-50">SELECIONE A SITUAÇÃO</span>
                                    <div className="max-h-60 overflow-y-auto">
                                        {(statusOptions || []).map(opt => {
                                            const isStatusActive = atendimento.status === opt.nome;
                                            return (
                                                <button
                                                    type="button"
                                                    key={opt.nome}
                                                    onClick={(e) => handleStatusChange(e, opt.nome)}
                                                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors border-b border-gray-50 last:border-0 ${isStatusActive ? 'font-semibold bg-blue-50' : 'text-gray-700 hover:bg-gray-100'}`}
                                                >
                                                    <span className="flex items-center gap-2">
                                                        <span className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: opt.cor }}></span>
                                                        {opt.nome}
                                                        {isStatusActive && <Check size={14} className="ml-auto text-blue-600" />}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Seção de Resumo (sem balão) */}
                    <div>
                        <h4 className="font-semibold text-gray-800 mb-3 flex items-center gap-2 truncate"><FileText size={16} className="text-gray-400" /> Resumo da Conversa</h4>
                        <p className="text-sm text-gray-600 whitespace-pre-wrap">{atendimento.resumo || <span className="italic text-gray-400">Nenhum resumo disponível.</span>}</p>
                    </div>

                    {/* Seção de Observações (NOVO) */}
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <h4 className="font-semibold text-gray-800 flex items-center gap-2 truncate">
                                <FileText size={16} className="text-gray-400" /> Observações
                            </h4>
                            {!isEditingObs && (
                                <button onClick={() => setIsEditingObs(true)} className="p-1 text-gray-500 hover:text-blue-600 rounded-full hover:bg-gray-100 transition-colors" title="Editar observações">
                                    <Edit size={16} />
                                </button>
                            )}
                        </div>
                        
                        {isEditingObs ? (
                            <div className="space-y-2 animate-fade-in">
                                <textarea
                                    ref={textareaRef}
                                    value={obsText}
                                    onChange={(e) => setObsText(e.target.value)}
                                    className="w-full p-2 text-sm border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 min-h-[100px] resize-none overflow-hidden"
                                    placeholder="Adicione observações..."
                                />
                                <div className="flex justify-end gap-2">
                                    <button onClick={() => { setIsEditingObs(false); setObsText(atendimento.observacoes || ''); }} className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200">Cancelar</button>
                                    <button onClick={handleSaveObs} className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700">Salvar</button>
                                </div>
                            </div>
                        ) : (
                            <p className="text-sm text-gray-600 whitespace-pre-wrap">{obsText || <span className="italic text-gray-400">Nenhuma observação.</span>}</p>
                        )}
                    </div>

                    {/* Seção de Tags (sem balão) */}
                    <div className="relative">
                        <div className="flex items-center justify-between mb-3">
                            <h4 className="font-semibold text-gray-800 flex items-center gap-2 truncate"><Tag size={16} className="text-gray-400" /> Tags</h4>
                            <button onClick={() => setActiveSubMenu(activeSubMenu === 'tags' ? null : 'tags')} className="p-1 text-gray-500 hover:text-blue-600 rounded-full hover:bg-gray-100 transition-colors" title="Editar tags">
                                <Edit size={16} />
                            </button>
                        </div>
                        
                        <div className="flex flex-wrap gap-2">
                            {(atendimento.tags && atendimento.tags.length > 0) ? (
                                atendimento.tags.map(tag => (
                                    <span key={tag.name} className="px-2 py-1 text-xs font-medium text-white rounded-full" style={{ backgroundColor: tag.color }}>
                                        {tag.name}
                                    </span>
                                ))
                            ) : <span className="italic text-sm text-gray-400">Nenhuma tag.</span>}
                        </div>

                        {/* Tag Editor Popup */}
                        {activeSubMenu === 'tags' && (
                            <div className="absolute right-0 top-8 z-20">
                                <TagEditor
                                    contactTags={atendimento.tags || []}
                                    allTags={allTags}
                                    onToggleTag={handleToggleTag}
                                    onSaveNewTag={handleSaveNewTag}
                                    onClose={() => setActiveSubMenu(null)}
                                />
                            </div>
                        )}
                    </div>

                    {/* Seção de Tokens */}
                    <div>
                        <h4 className="font-semibold text-gray-800 mb-3 flex items-center gap-2 truncate"><Cpu size={16} className="text-gray-400" /> Consumo de Tokens</h4>
                        <p className="text-sm text-gray-600 font-medium">
                            {atendimento.token_usage ? atendimento.token_usage.toLocaleString('pt-BR') : 0} tokens
                        </p>
                    </div>
                </div>

            </div>
        </>
    );
};

export default ProfileSidebar;