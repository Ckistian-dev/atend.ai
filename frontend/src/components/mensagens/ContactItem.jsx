import React, { useState, useEffect, useRef } from 'react';
import { MoreVertical, Tag, CheckCircle2, MailWarning, Edit, Headset } from 'lucide-react';
import { format } from 'date-fns';
import TagEditor from './TagEditor';
import NameEditor from './NameEditor'; // Importa o novo componente
import { stripWhatsAppFormatting } from '../../utils/formatters';

// --- Componente: Item de Contato na Lista (MODIFICADO) ---
const ContactItem = ({
    mensagem, isSelected, onSelect, statusOptions, onUpdateStatus, getTextColorForBackground,
    // Novas props para o editor de tags
    allTags, onUpdateTags, onAddNewTag, onSwitchToAtendimentos
}) => {
    // --- ESTADOS DO MENU (MODIFICADO) ---
    // Controla o menu principal de 2 opções ('Alterar Situação', 'Editar Tags')
    const [isMainMenuOpen, setIsMainMenuOpen] = useState(false);
    // Controla qual submenu/popup está ativo: 'status', 'tags' ou null
    const [activeSubMenu, setActiveSubMenu] = useState(null);

    // --- REFS PARA FECHAR AO CLICAR FORA ---
    const menuRef = useRef(null); // Ref para todos os menus

    const [unreadCount, setUnreadCount] = useState(0);
    const [conversa, setConversa] = useState([]);

    useEffect(() => {
        let parsedConversa = [];
        try {
            parsedConversa = JSON.parse(mensagem.conversa || '[]');
        } catch (e) {
            console.error("Erro ao parsear conversa no ContactItem (para unread):", e);
        }

        setConversa(parsedConversa);

        // Contar mensagens 'user' que estão 'unread'
        // (Assumindo que o webhook está marcando 'status: "unread"')
        const count = parsedConversa.filter(
            msg => msg.role === 'user' && msg.status === 'unread'
        ).length;
        setUnreadCount(count);

    }, [mensagem.conversa]);

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
        const conversa = JSON.parse(mensagem.conversa || '[]');
        if (conversa.length > 0) {
            const lastMsgObj = conversa[conversa.length - 1];

            const msgType = lastMsgObj.type || 'text';
            if (msgType === 'image') {
                lastMessage = lastMsgObj.content ? `[Imagem] ${lastMsgObj.content}` : '[Imagem]';
            } else if (msgType === 'audio') {
                lastMessage = '[Mensagem de áudio]';
            } else if (msgType === 'video') {
                lastMessage = '[Vídeo]';
            } else if (msgType === 'document') {
                lastMessage = `[Documento] ${lastMsgObj.filename || 'arquivo'}`;
            } else {
                lastMessage = stripWhatsAppFormatting(lastMsgObj.content) || '[Mídia]';
            }

            if (lastMsgObj.role === 'assistant') {
                lastMessage = `Você: ${lastMessage}`;
            }

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
    // Impede que o clique no botão selecione o chat
    const handleMenuClick = (e) => {
        e.stopPropagation(); // Impede a propagação do clique para o onSelect
        setIsMainMenuOpen(prev => !prev); // Abre o menu principal
        setActiveSubMenu(null); // Garante que submenus estejam fechados
    };

    // --- NOVO: Handler para selecionar um status ---
    const handleStatusChange = (e, newStatus) => {
        e.stopPropagation();
        onUpdateStatus(mensagem.id, { status: newStatus })
        setActiveSubMenu(null); // Fecha o submenu de status
    };

    // --- NOVA FUNÇÃO: Salva o nome do editor ---
    const handleSaveName = (newName) => {
        onUpdateStatus(mensagem.id, { nome_contato: newName });
        setActiveSubMenu(null); // Fecha o editor
    };

    // --- NOVAS FUNÇÕES PARA O EDITOR DE TAGS ---
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

    // --- NOVO: Handler para Puxar Atendimento ---
    const handlePuxarAtendimento = (e) => {
        e.stopPropagation();
        setIsMainMenuOpen(false); // Fecha o menu imediatamente

        // Atualiza a situação para 'Atendente Chamado'
        onUpdateStatus(mensagem.id, { status: 'Atendente Chamado' });

        // Seleciona o contato atualizado
        onSelect({ ...mensagem, status: 'Atendente Chamado' });

        // Troca para a aba de Atendimentos, se a função existir
        if (onSwitchToAtendimentos) {
            onSwitchToAtendimentos();
        }
    };

    // --- NOVO: Handler para marcar a última mensagem como não lida ---
    const handleMarkAsUnread = (e) => {
        e.stopPropagation();
        setIsMainMenuOpen(false); // Fecha o menu imediatamente

        if (conversa && conversa.length > 0) {
            // Encontra o índice da última mensagem enviada pelo usuário (cliente)
            const lastUserMessageIndex = conversa.map(msg => msg.role).lastIndexOf('user');

            // Se encontrou uma mensagem do usuário, marca ela como não lida
            if (lastUserMessageIndex !== -1) {
                const updatedConversa = [...conversa];
                updatedConversa[lastUserMessageIndex] = { ...updatedConversa[lastUserMessageIndex], status: 'unread' };

                // Chama a função de update genérica do pai
                onUpdateStatus(mensagem.id, {
                    conversa: JSON.stringify(updatedConversa)
                });
            }
        }
    };

    return (
        <div
            className={`group relative flex items-center p-3 cursor-pointer transition-all duration-300 rounded-2xl mx-1 mb-0.5 border border-transparent ${(isSelected || isMainMenuOpen || activeSubMenu)
                ? 'bg-white shadow-lg shadow-blue-100/50 border-white/60 scale-[1.01] z-[100]'
                : 'hover:bg-white/40 hover:translate-x-0.5 z-0'
                }`}
            onClick={() => {
                setIsMainMenuOpen(false);
                if (hasUnreadMessages) {
                    const updatedConversa = conversa.map(msg =>
                        (msg.role === 'user' && msg.status === 'unread')
                            ? { ...msg, status: 'read' }
                            : msg
                    );
                    onUpdateStatus(mensagem.id, { conversa: JSON.stringify(updatedConversa) });
                }
                onSelect(mensagem);
            }}
        >
            {/* AVATAR: PREMIUM INITIALS */}
            <div className={`w-11 h-11 rounded-xl mr-3 flex-shrink-0 flex items-center justify-center transition-all shadow-inner ${isSelected ? 'bg-blue-600 text-white shadow-md shadow-blue-200' : 'bg-slate-100 text-slate-400'
                }`}>
                <span className="text-base font-black executive-title">
                    {mensagem.nome_contato
                        ? (mensagem.nome_contato || '??').substring(0, 2).toUpperCase()
                        : (mensagem.whatsapp || '??').slice(-2)}
                </span>
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex justify-between items-center mb-0.5">
                    <div className="truncate pr-2 flex-1">
                        <h3 className={`text-[13px] font-black executive-title truncate ${isSelected ? 'text-slate-900' : 'text-slate-600'}`}>
                            {mensagem.nome_contato || mensagem.whatsapp}
                        </h3>
                    </div>
                    {/* STATUS PILL (NOW AT TOP) */}
                    <span
                        className="flex-shrink-0 px-2 py-0.5 text-[8px] font-black uppercase tracking-wider rounded-md shadow-sm"
                        style={statusInfo.colorHex ? {
                            backgroundColor: isSelected ? 'rgba(0,0,0,0.05)' : `${statusInfo.colorHex}15`,
                            color: statusInfo.colorHex,
                            border: isSelected ? `1px solid ${statusInfo.colorHex}30` : 'none'
                        } : {}}
                    >
                        {statusInfo.text}
                    </span>
                </div>



                <div className="flex justify-between items-center">
                    <p className={`text-[11.5px] truncate pr-3 flex-1 transition-colors ${hasUnreadMessages
                        ? 'text-slate-800 font-bold'
                        : (isSelected ? 'text-slate-600 font-semibold' : 'text-slate-500 font-medium')
                        }`}>
                        {lastMessage}
                    </p>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                        {/* TAG DOTS */}
                        {mensagem.tags && mensagem.tags.length > 0 && (
                            <div className="flex items-center mr-1.5">
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

                        {/* UNREAD COUNTER */}
                        {hasUnreadMessages && (
                            <span className="flex-shrink-0 flex items-center justify-center h-4 min-w-[1rem] px-1 bg-blue-600 text-white text-[9px] font-black rounded-full shadow-md shadow-blue-100">
                                {unreadCount}
                            </span>
                        )}

                        {/* TIMESTAMP (NOW AT BOTTOM) */}
                        <span className={`text-[9px] font-black uppercase tracking-widest flex-shrink-0 ${isSelected ? 'text-blue-600' : 'text-slate-400'}`}>
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
                        <button onClick={handlePuxarAtendimento} className="w-full text-left p-3 text-[12px] font-bold text-slate-600 hover:bg-slate-50 hover:text-blue-600 rounded-2xl flex items-center gap-3 transition-all">
                            <Headset size={16} className="text-blue-500" /> Puxar Atendimento
                        </button>
                        <button onClick={() => { setActiveSubMenu('status'); setIsMainMenuOpen(false); }} className="w-full text-left p-3 text-[12px] font-bold text-slate-600 hover:bg-slate-50 hover:text-blue-600 rounded-2xl flex items-center gap-3 transition-all">
                            <CheckCircle2 size={16} className="text-green-500" /> Alterar Situação
                        </button>
                        <button onClick={() => { setActiveSubMenu('name'); setIsMainMenuOpen(false); }} className="w-full text-left p-3 text-[12px] font-bold text-slate-600 hover:bg-slate-50 hover:text-blue-600 rounded-2xl flex items-center gap-3 transition-all">
                            <Edit size={16} className="text-amber-500" /> Alterar Nome
                        </button>
                        <button onClick={() => { setActiveSubMenu('tags'); setIsMainMenuOpen(false); }} className="w-full text-left p-3 text-[12px] font-bold text-slate-600 hover:bg-slate-50 hover:text-blue-600 rounded-2xl flex items-center gap-3 transition-all">
                            <Tag size={16} className="text-indigo-500" /> Editar Tags
                        </button>
                        <div className="my-1 border-t border-slate-50"></div>
                        <button onClick={handleMarkAsUnread} className="w-full text-left p-3 text-[12px] font-bold text-red-500 hover:bg-red-50 rounded-2xl flex items-center gap-3 transition-all">
                            <MailWarning size={16} /> Não lido
                        </button>
                    </div>
                )}

                {/* SUBMENU DE STATUS (Tonal) */}
                {activeSubMenu === 'status' && (
                    <div className="absolute right-0 top-10 mt-1 w-64 bg-white border border-slate-100 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.2),0_0_0_1px_rgba(0,0,0,0.05)] z-[200] overflow-hidden p-2">
                        <div className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-50 mb-1">Situação</div>
                        <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                            {(statusOptions || []).map(opt => {
                                const isStatusActive = mensagem.status === opt.nome;
                                return (
                                    <button
                                        key={opt.nome}
                                        onClick={(e) => handleStatusChange(e, opt.nome)}
                                        className={`w-full text-left p-3 text-[12px] font-bold transition-all rounded-2xl flex items-center gap-3 ${isStatusActive ? 'bg-slate-50 text-slate-900 shadow-inner' : 'text-slate-600 hover:bg-slate-50'}`}
                                    >
                                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: opt.cor }}></span>
                                        {opt.nome}
                                    </button>
                                );
                            })}
                        </div>
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
                            onClose={() => setActiveSubMenu(null)}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};

export default ContactItem;
