import React, { useState, useEffect, useRef } from 'react';
import { MoreVertical, Tag, CheckCircle2, MailWarning, Edit, Headset, Bot, RotateCcw, Check } from 'lucide-react';
import { format } from 'date-fns';
import TagEditor from './TagEditor';
import NameEditor from './NameEditor';
import TransferModal from '../common/TransferModal';
import api from '../../api/axiosConfig';
import toast from 'react-hot-toast';
import { formatLastMessagePreview } from '../../utils/formatters';

// --- Componente: Item de Contato na Lista (MODIFICADO) ---
const ContactItem = ({
    mensagem, isSelected, onSelect, statusOptions, onUpdateStatus, getTextColorForBackground,
    allTags, onUpdateTags, onAddNewTag, onDeleteTag, onSwitchToAtendimentos,
    onMarkAsRead, onMarkAsUnread
}) => {
    // --- ESTADOS DO MENU (MODIFICADO) ---
    // Controla o menu principal de 2 opções ('Alterar Situação', 'Editar Tags')
    const [isMainMenuOpen, setIsMainMenuOpen] = useState(false);
    // Controla qual submenu/popup está ativo: 'status', 'tags' ou null
    const [activeSubMenu, setActiveSubMenu] = useState(null);
    const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);

    // --- REFS PARA FECHAR AO CLICAR FORA ---
    const menuRef = useRef(null); // Ref para todos os menus

    const [unreadCount, setUnreadCount] = useState(0);
    const [conversa, setConversa] = useState([]);

    const isConcluido = mensagem.status === 'Concluído';
    const isAtendente = mensagem.status === 'Atendente Chamado';

    useEffect(() => {
        let parsedConversa = [];
        try {
            if (Array.isArray(mensagem.mensagens) && mensagem.mensagens.length > 0) {
                parsedConversa = mensagem.mensagens;
            } else if (typeof mensagem.conversa === 'string' && mensagem.conversa !== '[]') {
                parsedConversa = JSON.parse(mensagem.conversa || '[]');
            } else if (Array.isArray(mensagem.conversa)) {
                parsedConversa = mensagem.conversa;
            }
        } catch (e) {
            console.error("Erro ao parsear conversa no ContactItem (para unread):", e);
        }

        setConversa(parsedConversa);

        // Contar mensagens que estão com status 'unread'
        const count = parsedConversa.filter(
            msg => msg && msg.status === 'unread'
        ).length;
        setUnreadCount(count);

    }, [mensagem.mensagens, mensagem.conversa]);

    const hasUnreadMessages = unreadCount > 0;

    // --- NOVO: Efeito para fechar o popup ao clicar fora ---
    useEffect(() => {
        const handleClickOutside = (event) => {
            // Se algum menu estiver aberto e o clique for fora do container do menu
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                setIsMainMenuOpen(false);
                setActiveSubMenu(null);
            }
        };
        // Adiciona o listener
        document.addEventListener('mousedown', handleClickOutside);
        // Limpa o listener ao desmontar
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
        // Roda apenas uma vez
    }, []);

    let lastMessage = 'Nenhum histórico de conversa.';
    let lastMessageTime = mensagem.updated_at;

    try {
        let conv = [];
        if (Array.isArray(mensagem.mensagens) && mensagem.mensagens.length > 0) {
            conv = mensagem.mensagens;
        } else if (typeof mensagem.conversa === 'string') {
            conv = JSON.parse(mensagem.conversa || '[]');
        } else if (Array.isArray(mensagem.conversa)) {
            conv = mensagem.conversa;
        }

        if (conv.length > 0) {
            const lastMsgObj = conv[conv.length - 1];
            lastMessage = formatLastMessagePreview(lastMsgObj);

            if (lastMsgObj.timestamp) {
                const ts = lastMsgObj.timestamp;
                // Converte de segundos (Unix) ou ISO string para um Date object
                const dateObj = (typeof ts === 'number') ? new Date(ts * 1000) : new Date(ts);
                lastMessageTime = dateObj.toISOString(); // Passa ISO string para a formatTimestamp
            }
        }
    } catch (e) {
        console.error("Erro ao parsear conversa no ContactItem:", e);
    }

    // --- NOVO: Helper para cor e texto do status ---
    const getStatusStyles = (status) => {
        // Tenta encontrar na config dinâmica
        const situacao = statusOptions.find(opt => opt.nome === status);
        if (situacao && situacao.cor) {
            return {
                text: situacao.nome,
                colorClass: '', // Remove a classe de cor tailwind
                colorHex: situacao.cor // Adiciona a cor hex
            };
        }

        // Fallback para o sistema antigo
        switch (status) {
            case 'Atendente Chamado':
                return { text: 'Atendente Chamado', colorClass: 'bg-orange-100', colorHex: null };
            case 'Concluído':
                return { text: 'Concluído', colorClass: 'bg-green-100', colorHex: null };
            case 'Aguardando Resposta':
                return { text: 'Aguardando Resposta', colorClass: 'bg-yellow-100', colorHex: null };
            case 'Mensagem Recebida':
                return { text: 'Mensagem Recebida', colorClass: 'bg-blue-100', colorHex: null };
            case 'Aguardando Envio':
                return { text: 'Aguardando Envio', colorClass: 'bg-purple-100', colorHex: null };
            default:
                return { text: status || 'Novo', colorClass: 'bg-gray-400', colorHex: null };
        }
    };

    const statusInfo = getStatusStyles(mensagem.status);

    const formatTimestamp = (dateStr) => {
        try {
            const date = new Date(dateStr);
            const now = new Date();
            if (format(date, 'yyyy-MM-dd') === format(now, 'yyyy-MM-dd')) {
                return format(date, 'HH:mm');
            }
            return format(date, 'dd/MM/yy');
        } catch {
            return '...';
        }
    };

    // --- NOVO: Handler para o clique nos 3 pontos ---
    const handleMenuClick = (e) => {
        e.stopPropagation(); // Impede a propagação do clique para o onSelect
        setIsMainMenuOpen(prev => !prev); // Abre o menu principal
        setActiveSubMenu(null); // Garante que submenus estejam fechados
    };

    // --- Handler para Concluir Atendimento ---
    const handleConcluirAtendimento = (e) => {
        e.stopPropagation();
        setIsMainMenuOpen(false);
        onUpdateStatus(mensagem.id, { status: 'Concluído' });
        toast.success("Atendimento concluído!");
    };

    // --- Handler para Reabrir Atendimento ---
    const handleReabrirAtendimento = (e) => {
        e.stopPropagation();
        setIsMainMenuOpen(false);
        onUpdateStatus(mensagem.id, { status: 'Mensagem Recebida' });
        toast.success("Atendimento reaberto!");
    };

    // --- Salva o nome do editor ---
    const handleSaveName = (newName) => {
        onUpdateStatus(mensagem.id, { nome_contato: newName });
        setActiveSubMenu(null); // Fecha o editor
    };

    // --- FUNÇÕES PARA O EDITOR DE TAGS ---
    const handleToggleTag = (tag) => {
        const currentTags = mensagem.tags || [];
        const isSelected = currentTags.some(t => t.name === tag.name);
        let newTags;
        if (isSelected) {
            newTags = currentTags.filter(t => t.name !== tag.name);
        } else {
            newTags = [...currentTags, tag];
        }
        onUpdateTags(mensagem.id, { tags: newTags });
    };

    const handleSaveNewTag = (newTag) => {
        onAddNewTag(newTag); // Adiciona na lista global
        handleToggleTag(newTag); // Adiciona ao contato atual
    };

    // --- Handler para marcar como lido manualmente ---
    const handleMarkAsRead = (e) => {
        if (e) e.stopPropagation();
        setIsMainMenuOpen(false); // Fecha o menu imediatamente

        setUnreadCount(0);
        if (onMarkAsRead) {
            onMarkAsRead(mensagem.id);
        } else {
            api.post(`/atendimentos/${mensagem.id}/mark_read`).catch(err => {
                console.error("Erro ao marcar como lido:", err);
            });
        }
    };

    // --- Handler para marcar a última mensagem como não lida ---
    const handleMarkAsUnread = (e) => {
        if (e) e.stopPropagation();
        setIsMainMenuOpen(false); // Fecha o menu imediatamente

        setUnreadCount(prev => Math.max(prev, 1));
        if (onMarkAsUnread) {
            onMarkAsUnread(mensagem.id);
        } else {
            api.post(`/atendimentos/${mensagem.id}/mark_unread`).catch(err => {
                console.error("Erro ao marcar como não lido:", err);
            });
        }
    };

    // Determina classes de estilo do card baseado em estado e conclusão
    let cardContainerClasses = 'hover:bg-white/40 hover:translate-x-0.5 z-0';
    if (isSelected || isMainMenuOpen || activeSubMenu) {
        if (isConcluido) {
            cardContainerClasses = 'bg-white shadow-lg shadow-emerald-100/60 border-emerald-300 scale-[1.01] z-[100]';
        } else {
            cardContainerClasses = 'bg-white shadow-lg shadow-blue-100/50 border-white/60 scale-[1.01] z-[100]';
        }
    } else if (isConcluido) {
        cardContainerClasses = 'bg-emerald-50/30 border-emerald-100/80 hover:bg-emerald-50/60 hover:translate-x-0.5 z-0';
    }

    let avatarClasses = 'bg-slate-100 text-slate-400';
    if (isSelected) {
        avatarClasses = isConcluido
            ? 'bg-emerald-600 text-white shadow-md shadow-emerald-200'
            : 'bg-blue-600 text-white shadow-md shadow-blue-200';
    } else if (isConcluido) {
        avatarClasses = 'bg-emerald-100 text-emerald-700 border border-emerald-200/60';
    }

    return (
        <div
            className={`group relative flex items-center p-3 cursor-pointer transition-all duration-300 rounded-2xl mx-1 mb-0.5 border border-transparent ${cardContainerClasses}`}
            onClick={() => {
                setIsMainMenuOpen(false);
                if (hasUnreadMessages) {
                    setUnreadCount(0);
                    if (onMarkAsRead) {
                        onMarkAsRead(mensagem.id);
                    } else {
                        api.post(`/atendimentos/${mensagem.id}/mark_read`).catch(err => {
                            console.error("Erro ao marcar como lido:", err);
                        });
                    }
                }
                onSelect(mensagem);
            }}
        >
            {/* AVATAR: PREMIUM INITIALS */}
            <div className={`w-11 h-11 rounded-xl mr-3 flex-shrink-0 flex items-center justify-center transition-all shadow-inner relative ${avatarClasses}`}>
                <span className="text-base font-black executive-title">
                    {mensagem.nome_contato
                        ? (mensagem.nome_contato || '??').substring(0, 2).toUpperCase()
                        : (mensagem.whatsapp || '??').slice(-2)}
                </span>
                {isConcluido && (
                    <span className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 text-white rounded-full flex items-center justify-center shadow-sm border border-white" title="Concluído">
                        <Check size={10} strokeWidth={3} />
                    </span>
                )}
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex justify-between items-center mb-0.5 gap-2">
                    <div className="truncate pr-1 min-w-0 flex-1 flex items-center gap-1.5">
                        <h3 className={`text-[13px] font-black executive-title truncate ${isSelected ? (isConcluido ? 'text-emerald-950' : 'text-slate-900') : 'text-slate-700'}`}>
                            {mensagem.nome_contato || mensagem.whatsapp}
                        </h3>

                        {mensagem.assigned_department && (
                            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-md bg-blue-50 text-blue-700 border border-blue-200/80 shrink-0">
                                {mensagem.assigned_department}
                            </span>
                        )}
                    </div>

                    {/* RIGHT SIDE: STATUS BADGE & TAG DOTS */}
                    <div className="flex items-center gap-1.5 shrink-0">

                        {/* TAG DOTS */}
                        {mensagem.tags && mensagem.tags.length > 0 && (
                            <div className="flex items-center">
                                {mensagem.tags.map((tag, idx) => (
                                    <div
                                        key={idx}
                                        className={`w-2.5 h-2.5 rounded-full border border-white shadow-sm ${idx > 0 ? '-ml-1.5' : ''}`}
                                        style={{ backgroundColor: tag.color || '#cbd5e1', zIndex: 10 - idx }}
                                        title={tag.name}
                                    />
                                ))}
                            </div>
                        )}

                        {/* STATUS BADGE */}
                        {isConcluido ? (
                            <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-md bg-emerald-100/90 text-emerald-800 border border-emerald-300/80 shrink-0 flex items-center gap-0.5 shadow-sm">
                                <CheckCircle2 size={10} className="text-emerald-600" /> Concluído
                            </span>
                        ) : isAtendente ? (
                            <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-md bg-amber-100/90 text-amber-800 border border-amber-300/80 shrink-0 flex items-center gap-0.5 shadow-sm">
                                <Headset size={10} className="text-amber-600" /> Atendente
                            </span>
                        ) : (
                            <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200/80 shrink-0 flex items-center gap-0.5 shadow-sm">
                                <Bot size={10} className="text-blue-600" /> IA
                            </span>
                        )}

                    </div>
                </div>

                <div className="flex justify-between items-center">
                    <p className={`text-[11.5px] truncate pr-3 flex-1 transition-colors ${hasUnreadMessages
                        ? 'text-slate-800 font-bold'
                        : (isSelected ? (isConcluido ? 'text-emerald-800 font-semibold' : 'text-slate-600 font-semibold') : 'text-slate-500 font-medium')
                        }`}>
                        {lastMessage}
                    </p>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                        {/* UNREAD COUNTER */}
                        {hasUnreadMessages && (
                            <span className="flex-shrink-0 flex items-center justify-center h-4 min-w-[1rem] px-1 bg-blue-600 text-white text-[9px] font-black rounded-full shadow-md shadow-blue-100">
                                {unreadCount}
                            </span>
                        )}

                        {/* TIMESTAMP */}
                        <span className={`text-[9px] font-black uppercase tracking-widest flex-shrink-0 ${isSelected ? (isConcluido ? 'text-emerald-600' : 'text-blue-600') : 'text-slate-400'}`}>
                            {formatTimestamp(lastMessageTime)}
                        </span>
                    </div>
                </div>
            </div>

            {/* ACTION MENU (FLOATING) */}
            <div className="relative flex-shrink-0 ml-2" ref={menuRef}>
                <button
                    type="button"
                    onClick={handleMenuClick}
                    className={`w-8 h-8 flex items-center justify-center rounded-xl transition-all ${isSelected ? 'text-slate-400 hover:bg-slate-50 hover:text-blue-600' : 'text-slate-300 opacity-0 group-hover:opacity-100 hover:text-slate-600'
                        }`}
                >
                    <MoreVertical size={16} />
                </button>

                {/* MENU PRINCIPAL (Tonal Style) */}
                {isMainMenuOpen && (
                    <div className="absolute right-0 top-10 mt-1 w-56 bg-white border border-slate-100 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.2),0_0_0_1px_rgba(0,0,0,0.05)] z-[200] overflow-hidden animate-fade-in custom-scrollbar p-2">
                        {/* BOTAO CONCLUIR / REABRIR */}
                        {isConcluido ? (
                            <button
                                onClick={handleReabrirAtendimento}
                                className="w-full text-left p-3 text-[12px] font-bold text-slate-600 hover:bg-blue-50 hover:text-blue-600 rounded-2xl flex items-center gap-3 transition-all"
                            >
                                <RotateCcw size={16} className="text-blue-500" /> Reabrir Atendimento
                            </button>
                        ) : (
                            <button
                                onClick={handleConcluirAtendimento}
                                className="w-full text-left p-3 text-[12px] font-bold text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 rounded-2xl flex items-center gap-3 transition-all"
                            >
                                <CheckCircle2 size={16} className="text-emerald-600" /> Concluir Atendimento
                            </button>
                        )}

                        {/* BOTAO TRANSFERIR / DEVOLVER */}
                        {isAtendente ? (
                            <>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setIsMainMenuOpen(false);
                                        setIsTransferModalOpen(true);
                                    }}
                                    className="w-full text-left p-3 text-[12px] font-bold text-slate-600 hover:bg-amber-50 hover:text-amber-600 rounded-2xl flex items-center gap-3 transition-all"
                                >
                                    <Headset size={16} className="text-amber-500" /> Re-transferir
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setIsMainMenuOpen(false);
                                        onUpdateStatus(mensagem.id, { status: 'Mensagem Recebida' });
                                    }}
                                    className="w-full text-left p-3 text-[12px] font-bold text-slate-600 hover:bg-blue-50 hover:text-blue-600 rounded-2xl flex items-center gap-3 transition-all"
                                >
                                    <Bot size={16} className="text-blue-500" /> Devolver para IA
                                </button>
                            </>
                        ) : (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsMainMenuOpen(false);
                                    setIsTransferModalOpen(true);
                                }}
                                className="w-full text-left p-3 text-[12px] font-bold text-slate-600 hover:bg-amber-50 hover:text-amber-600 rounded-2xl flex items-center gap-3 transition-all"
                            >
                                <Headset size={16} className="text-amber-500" /> Transferir Atendimento
                            </button>
                        )}

                        <button onClick={() => { setActiveSubMenu('name'); setIsMainMenuOpen(false); }} className="w-full text-left p-3 text-[12px] font-bold text-slate-600 hover:bg-slate-50 hover:text-blue-600 rounded-2xl flex items-center gap-3 transition-all">
                            <Edit size={16} className="text-amber-500" /> Alterar Nome
                        </button>
                        <button onClick={() => { setActiveSubMenu('tags'); setIsMainMenuOpen(false); }} className="w-full text-left p-3 text-[12px] font-bold text-slate-600 hover:bg-slate-50 hover:text-blue-600 rounded-2xl flex items-center gap-3 transition-all">
                            <Tag size={16} className="text-indigo-500" /> Editar Tags
                        </button>
                        {hasUnreadMessages ? (
                            <button
                                type="button"
                                onClick={handleMarkAsRead}
                                className="w-full text-left p-3 text-[12px] font-bold text-emerald-600 hover:bg-emerald-50 rounded-2xl flex items-center gap-3 transition-all"
                            >
                                <CheckCircle2 size={16} className="text-emerald-500" /> Marcar como lido
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={handleMarkAsUnread}
                                className="w-full text-left p-3 text-[12px] font-bold text-red-500 hover:bg-red-50 rounded-2xl flex items-center gap-3 transition-all"
                            >
                                <MailWarning size={16} /> Marcar como não lido
                            </button>
                        )}
                    </div>
                )}

                {/* SUBMENU DE NOME */}
                {activeSubMenu === 'name' && (
                    <div className="absolute right-0 top-10 z-[100] w-64 animate-fade-in-up-fast">
                        <NameEditor
                            currentName={mensagem.nome_contato || ''}
                            onSave={handleSaveName}
                            onClose={() => setActiveSubMenu(null)}
                        />
                    </div>
                )}

                {/* SUBMENU DE TAGS */}
                {activeSubMenu === 'tags' && (
                    <div className="absolute right-0 top-10 z-[100] animate-fade-in-up-fast">
                        <TagEditor
                            contactTags={mensagem.tags || []}
                            allTags={allTags}
                            onToggleTag={handleToggleTag}
                            onSaveNewTag={handleSaveNewTag}
                            onDeleteTag={onDeleteTag}
                            onClose={() => setActiveSubMenu(null)}
                        />
                    </div>
                )}
            </div>

            {isTransferModalOpen && (
                <TransferModal
                    isOpen={isTransferModalOpen}
                    onClose={() => setIsTransferModalOpen(false)}
                    onConfirm={async ({ department, user_id, notes }) => {
                        try {
                            const res = await api.post(`/atendimentos/${mensagem.id}/transfer`, {
                                department,
                                user_id,
                                notes
                            });
                            onUpdateStatus(mensagem.id, res.data);
                            toast.success(`Atendimento transferido para ${department || 'Atendente'} com sucesso!`);
                        } catch (err) {
                            toast.error('Erro ao transferir atendimento.');
                            throw err;
                        }
                    }}
                    currentDepartment={mensagem.assigned_department}
                    currentUserId={mensagem.assigned_user_id}
                    atendimentoName={mensagem.nome_contato}
                    atendimentoWhatsapp={mensagem.whatsapp}
                />
            )}
        </div>
    );
};

export default ContactItem;
