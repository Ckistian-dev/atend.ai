import React, { useState, useEffect, useRef } from 'react';
import { MoreVertical, Tag, CheckCircle2, MailWarning, Edit } from 'lucide-react';
import { format } from 'date-fns';
import TagEditor from './TagEditor';
import NameEditor from './NameEditor'; // Importa o novo componente

// --- Componente: Item de Contato na Lista (MODIFICADO) ---
const ContactItem = ({
    mensagem, isSelected, onSelect, statusOptions, onUpdateStatus, getTextColorForBackground,
    // Novas props para o editor de tags
    allTags, onUpdateTags, onAddNewTag
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
                lastMessage = lastMsgObj.content || '[Mídia]';
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
            className={`flex items-center p-3 cursor-pointer transition-colors ${isSelected ? 'bg-gray-200' : 'bg-white hover:bg-gray-50'
                }`}
            onClick={() => {
                // Fecha qualquer menu que possa estar aberto
                setIsMainMenuOpen(false);

                // --- Lógica de "Marcar como Lido" ---
                // Se houver mensagens não lidas, marca todas como lidas ao clicar.
                if (hasUnreadMessages) {
                    // 3. Monta a nova conversa com status 'read'
                    const updatedConversa = conversa.map(msg =>
                        (msg.role === 'user' && msg.status === 'unread')
                            ? { ...msg, status: 'read' } // Atualiza o status
                            : msg
                    );

                    // 4. Chama a função de update genérica do pai
                    // O pai (Mensagens) fará a atualização otimista e a chamada de API
                    onUpdateStatus(mensagem.id, {
                        conversa: JSON.stringify(updatedConversa)
                    });
                }

                // Seleciona a conversa para exibição.
                // Isso é feito por último para que a UI reaja à mudança de estado.
                onSelect(mensagem);
            }}
        >
            {/* --- AVATAR COM INICIAIS --- */}
            <div className="w-12 h-12 rounded-full mr-3 flex-shrink-0 bg-gray-300 flex items-center justify-center">
                <span className="text-xl font-bold text-white">
                    {mensagem.nome_contato
                        ? (mensagem.nome_contato || '??').substring(0, 2).toUpperCase()
                        : (mensagem.whatsapp || '??').slice(-2)}
                </span>
            </div>
            {/* <img
                 className="w-12 h-12 rounded-full mr-3 flex-shrink-0"
                 src={`https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSTip18a5vyLJJXYZgGE44WTFaislpkAcvQURSqLik0tsv8DuPggkyib-NrlShXqM2mO9k&usqp=CAU`}
                 alt="Avatar" /> */}
            <div className="flex-1 min-w-0 border-gray-100"> {/* Removido pt-3 */}
                <div className="flex justify-between items-center mb-1">
                    <div className="truncate">
                        <h3 className="text-md font-semibold text-gray-800 truncate items-baseline">
                            {mensagem.nome_contato || mensagem.whatsapp}
                            {mensagem.nome_contato && (
                                <span className="text-xs text-gray-500 ml-2 font-normal">{mensagem.whatsapp}</span>
                            )}
                        </h3>
                    </div>
                    <span className="text-xs text-blue-600 font-medium ml-2 flex-shrink-0">
                        {formatTimestamp(lastMessageTime)}
                    </span>
                </div>

                {/* --- LINHA MODIFICADA: Mensagem e Status --- */}
                <div className="flex justify-between items-center">
                    <p className="text-sm text-gray-500 truncate">{lastMessage}</p>
                    {/* --- NOVO: Wrapper para os badges --- */}
                    <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                        {/* --- INÍCIO: Bolinha de Contagem (Unread) --- */}
                        {hasUnreadMessages && (
                            <span
                                className="flex-shrink-0 flex items-center justify-center h-5 min-w-[1.25rem] px-1 bg-blue-500 text-white text-xs font-bold rounded-full"
                                title={`${unreadCount} novas mensagens`}
                            >
                                {unreadCount}
                            </span>
                        )}

                        {/* --- INÍCIO: Marcadores de Tag --- */}
                        {(mensagem.tags && mensagem.tags.length > 0) && (
                            <div className="flex items-center gap-0.5">
                                {mensagem.tags.slice(0, 3).map(tag => ( // Mostra no máximo 3
                                    <span key={tag.name} title={tag.name} className="block h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }}></span>
                                ))}
                            </div>
                        )}
                        {/* --- FIM: Marcadores de Tag --- */}

                        {/* --- Badge de Status (Lógica Original) --- */}
                        <span
                            className={`flex-shrink-0 px-2 py-0.5 text-xs font-medium rounded-full ${statusInfo.colorClass}`}
                            style={statusInfo.colorHex ? {
                                backgroundColor: statusInfo.colorHex,
                                color: getTextColorForBackground(statusInfo.colorHex) // Usa a helper
                            } : {}}
                        >
                            {statusInfo.text}
                        </span>
                    </div>
                </div>
            </div>

            {/* --- NOVO: Botão de 3 pontos (Menu) --- */}
            {/* --- NOVO: ADICIONADO A REF AQUI --- */}
            <div className="relative ml-2 flex-shrink-0" ref={menuRef}>
                <button
                    type="button"
                    onClick={handleMenuClick}
                    className="p-1 rounded-full text-gray-500 hover:text-gray-800 hover:bg-gray-100"
                    title="Alterar status"
                >
                    <MoreVertical size={18} />
                </button>
                
                {/* --- MENU PRINCIPAL (NOVO) --- */}
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
                        <button
                            type="button"
                            onClick={handleMarkAsUnread}
                            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                        >
                            <MailWarning size={16} className="text-gray-500" />
                            Marcar como não lida
                        </button>
                    </div>
                )}

                {/* --- SUBMENU DE STATUS (MODIFICADO) --- */}
                {activeSubMenu === 'status' && (
                    <div
                        className="absolute right-0 top-8 mt-1 w-56 bg-white rounded-md shadow-lg z-20 overflow-hidden animate-fade-in-up-fast"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <span className="block px-4 py-2 text-sm text-gray-500 border-b">Alterar situação:</span>
                        {(statusOptions || []).map(opt => {
                            const isStatusActive = mensagem.status === opt.nome;
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

                {/* --- SUBMENU DE NOME (NOVO) --- */}
                {activeSubMenu === 'name' && (
                    <NameEditor
                        currentName={mensagem.nome_contato || ''}
                        onSave={handleSaveName}
                        onClose={() => setActiveSubMenu(null)}
                    />
                )}

                {/* --- SUBMENU DE TAGS (MODIFICADO) --- */}
                {activeSubMenu === 'tags' && (
                    <TagEditor
                        contactTags={mensagem.tags || []}
                        allTags={allTags}
                        onToggleTag={handleToggleTag}
                        onSaveNewTag={handleSaveNewTag}
                        onClose={() => setActiveSubMenu(null)} // Fecha o editor
                    />
                )}
            </div>
        </div>
    );
};

export default ContactItem;
