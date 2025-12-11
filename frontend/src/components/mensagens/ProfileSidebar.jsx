import React, { useState, useRef, useEffect } from 'react';
import { Phone, FileText, Tag, MoreVertical, CheckCircle2, Edit } from 'lucide-react';
import TagEditor from './TagEditor'; // Importa o novo componente
import NameEditor from './NameEditor'; // Importa o novo componente

// --- NOVO Componente: Sidebar de Perfil do Contato ---
const ProfileSidebar = ({
    atendimento, onClose, statusOptions, getTextColorForBackground, isOpen,
    // Novas props para o editor de tags
    allTags, onUpdateTags, onAddNewTag, onUpdateStatus
}) => {
    // --- ESTADOS DO MENU (NOVO E INDEPENDENTE) ---
    const [isMainMenuOpen, setIsMainMenuOpen] = useState(false);
    const [activeSubMenu, setActiveSubMenu] = useState(null);
    const menuRef = useRef(null);

    // Efeito para fechar o menu ao clicar fora
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                setIsMainMenuOpen(false);
                setActiveSubMenu(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

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

    // --- FUNÇÕES DE MANIPULAÇÃO DO MENU (NOVAS) ---
    const handleMenuClick = (e) => {
        e.stopPropagation();
        setIsMainMenuOpen(prev => !prev);
        setActiveSubMenu(null);
    };

    const handleStatusChange = (e, newStatus) => {
        e.stopPropagation();
        onUpdateStatus(atendimento.id, { status: newStatus });
        setActiveSubMenu(null);
    };

    // --- NOVA FUNÇÃO: Salva o nome do editor ---
    const handleSaveName = (newName) => {
        onUpdateTags(atendimento.id, { nome_contato: newName });
        setActiveSubMenu(null); // Fecha o editor
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
                    {/* --- MENU DE 3 PONTOS NO HEADER --- */}
                    <div className="relative" ref={menuRef}>
                        <button onClick={handleMenuClick} className="p-1 rounded-full text-gray-500 hover:text-gray-800 hover:bg-gray-100" title="Mais opções">
                            <MoreVertical size={22} />
                        </button>

                        {/* --- MENU PRINCIPAL --- */}
                        {isMainMenuOpen && (
                            <div
                                className="absolute right-0 top-8 mt-1 w-48 bg-white rounded-md shadow-lg z-20 overflow-hidden animate-fade-in-up-fast"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <button
                                    type="button"
                                    onClick={() => { setActiveSubMenu('status'); setIsMainMenuOpen(false); }}
                                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                                >
                                    <CheckCircle2 size={16} className="text-gray-500" />
                                    Alterar Situação
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { setActiveSubMenu('name'); setIsMainMenuOpen(false); }}
                                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                                >
                                    <Edit size={16} className="text-gray-500" />
                                    Alterar Nome
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { setActiveSubMenu('tags'); setIsMainMenuOpen(false); }}
                                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                                >
                                    <Tag size={16} className="text-gray-500" />
                                    Editar Tags
                                </button>
                            </div>
                        )}

                        {/* --- SUBMENU DE TAGS (USA O COMPONENTE TAGEDITOR) --- */}
                        {activeSubMenu === 'tags' && (
                            <TagEditor
                                contactTags={atendimento.tags || []}
                                allTags={allTags}
                                onToggleTag={handleToggleTag}
                                onSaveNewTag={handleSaveNewTag}
                                onClose={() => setActiveSubMenu(null)}
                            />
                        )}

                        {/* --- SUBMENU DE NOME (NOVO) --- */}
                        {activeSubMenu === 'name' && (
                            <NameEditor
                                currentName={atendimento.nome_contato || ''}
                                onSave={handleSaveName}
                                onClose={() => setActiveSubMenu(null)}
                            />
                        )}
                    </div>
                </header>

                {/* Body */}
                <div className="flex-1 p-6 overflow-y-auto space-y-6">
                    <div className="text-center">
                        <div className="w-24 h-24 rounded-full mx-auto bg-gradient-to-br from-gray-300 to-gray-400 flex items-center justify-center mb-4 shadow-md">
                            <span className="text-4xl font-bold text-white">
                                {atendimento.nome_contato ? (atendimento.nome_contato || '??').substring(0, 2).toUpperCase() : (atendimento.whatsapp || '??').slice(-2)}
                            </span>
                        </div>
                        <h2 className="text-xl font-bold text-gray-900 truncate">{atendimento.nome_contato || 'Contato sem nome'}</h2>
                        <p className="text-md text-gray-500 flex items-center justify-center gap-2 mt-1 truncate"><Phone size={14} /> {atendimento.whatsapp}</p>
                        <span className="mt-4 inline-block px-3 py-1 text-sm font-semibold rounded-full shadow-sm truncate" style={statusStyle}>{atendimento.status}</span>
                    </div>

                    {/* --- SUBMENU DE STATUS (agora posicionado corretamente) --- */}
                    {activeSubMenu === 'status' && (
                        <div
                            className="absolute right-4 top-16 mt-1 w-56 bg-white rounded-md shadow-lg z-20 overflow-hidden animate-fade-in-up-fast"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <span className="block px-4 py-2 text-sm text-gray-500 border-b">Alterar situação:</span>
                            {(statusOptions || []).map(opt => {
                                const isStatusActive = atendimento.status === opt.nome;
                                return (
                                    <button
                                        type="button"
                                        key={opt.nome}
                                        onClick={(e) => handleStatusChange(e, opt.nome)}
                                        className={`w-full text-left px-4 py-2 text-sm transition-colors ${isStatusActive ? 'font-semibold' : 'text-gray-700 hover:bg-gray-100'}`}
                                        style={isStatusActive ? { color: opt.cor, backgroundColor: `${opt.cor}1A` } : {}}
                                    >
                                        <span className="flex items-center gap-2">
                                            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: opt.cor }}></span>
                                            {opt.nome}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {/* Seção de Resumo (sem balão) */}
                    <div>
                        <h4 className="font-semibold text-gray-800 mb-3 flex items-center gap-2 truncate"><FileText size={16} className="text-gray-400" /> Resumo da Conversa</h4>
                        <p className="text-sm text-gray-600 whitespace-pre-wrap">{atendimento.observacoes || <span className="italic text-gray-400">Nenhum resumo disponível.</span>}</p>
                    </div>

                    {/* Seção de Tags (sem balão) */}
                    <div>
                        <h4 className="font-semibold text-gray-800 mb-3 flex items-center gap-2 truncate"><Tag size={16} className="text-gray-400" /> Tags</h4>
                        <div className="flex flex-wrap gap-2">
                            {(atendimento.tags && atendimento.tags.length > 0) ? (
                                atendimento.tags.map(tag => (
                                    <span key={tag.name} className="px-2 py-1 text-xs font-medium text-white rounded-full" style={{ backgroundColor: tag.color }}>
                                        {tag.name}
                                    </span>
                                ))
                            ) : <span className="italic text-sm text-gray-400">Nenhuma tag.</span>}
                        </div>
                    </div>
                </div>

            </div>
        </>
    );
};

export default ProfileSidebar;