import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api/axiosConfig'; // Presumindo que você tenha este arquivo de configuração do Axios
import {
    Search, MessageSquareText, CheckCircle, Clock, UserCheck, Paperclip, Mic, Send, Image as ImageIcon, FileText, CircleDashed, ChevronDown,
    Play, Download, Loader2, StopCircle, Trash2, AlertTriangle, FileVideo, MoreVertical, MessageSquarePlus,
    Filter
} from 'lucide-react';
import { format } from 'date-fns';

const getTextColorForBackground = (hexColor) => {
    // Força o texto a ser branco, conforme solicitado
    return '#FFFFFF';
};

// --- NOVO Componente: Modal de Mídia ---
const MediaModal = ({ isOpen, onClose, mediaUrl, mediaType, filename }) => {
    // Log para verificar props recebidas

    // Efeito para logar quando a URL muda
    useEffect(() => {
    }, [mediaUrl]);

    if (!isOpen || !mediaUrl) {
        // Se não deve estar aberto ou não tem URL, não renderiza nada
        if (isOpen && !mediaUrl) {
            console.warn("[MediaModal] Modal is open but mediaUrl is missing!");
        }
        return null;
    }

    // Função para forçar download
    const handleDownload = async () => {
        try {
            // Usa a Blob URL diretamente para criar o link de download
            const link = document.createElement('a');
            link.href = mediaUrl; // Usa a Blob URL passada como prop
            link.download = filename || (mediaType === 'audio' ? 'audio.ogg' : 'imagem');
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            // NÃO revogue a URL aqui, pois ela ainda está sendo usada pelo src da tag img/audio
            // A revogação deve ocorrer APENAS quando o modal fechar (na função `closeModal`)
        } catch (error) {
            console.error("[MediaModal] Erro ao tentar baixar via link:", error);
            alert("Não foi possível iniciar o download do arquivo.");
        }
    };


    return (
        <div
            className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-lg p-4 max-w-3xl max-h-[80vh] overflow-auto relative"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Botão Fechar */}
                <button
                    onClick={onClose}
                    className="absolute top-2 right-2 text-gray-600 hover:text-black z-10"
                    title="Fechar"
                >
                    {/* SVG X */}
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                {/* Conteúdo da Mídia */}
                {mediaType === 'image' && (
                    <img
                        src={mediaUrl}
                        alt={filename || 'Imagem'}
                        className="max-w-full max-h-[70vh] object-contain mx-auto"
                        // Adiciona log de erro específico da imagem
                        onError={(e) => console.error("[MediaModal] Erro ao carregar tag <img>. SRC:", e.target.src)}
                    />
                )}
                {mediaType === 'audio' && (
                    <div className="flex flex-col items-center space-y-3 p-4">
                        <p className="text-sm text-gray-600">{filename || 'Áudio'}</p>
                        <audio
                            src={mediaUrl}
                            controls
                            className="w-full"
                            // Adiciona log de erro específico do áudio
                            onError={(e) => console.error("[MediaModal] Erro ao carregar tag <audio>. SRC:", e.target.src, "Error Code:", e.target.error?.code)}
                        />
                        {/* Botão de download explícito */}
                        <button
                            onClick={handleDownload}
                            className="mt-2 px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 flex items-center gap-1"
                        >
                            <Download size={16} /> Baixar Áudio
                        </button>
                    </div>
                )}

                {/* --- INÍCIO DA ADIÇÃO (VÍDEO) --- */}
                {mediaType === 'video' && (
                    <div className="flex flex-col items-center space-y-3 p-4">
                        <p className="text-sm text-gray-600">{filename || 'Vídeo'}</p>
                        <video
                            src={mediaUrl}
                            controls
                            className="w-full max-w-full max-h-[70vh] object-contain mx-auto"
                            onError={(e) => console.error("[MediaModal] Erro ao carregar tag <video>. SRC:", e.target.src, "Error Code:", e.target.error?.code)}
                        />
                        <button
                            onClick={handleDownload}
                            className="mt-2 px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 flex items-center gap-1"
                        >
                            <Download size={16} /> Baixar Vídeo
                        </button>
                    </div>
                )}
                {/* --- FIM DA ADIÇÃO --- */}

                {/* Botão de download para imagem */}
                {mediaType === 'image' && (
                    <div className="text-center mt-3">
                        <button
                            onClick={handleDownload}
                            className="px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 flex items-center gap-1 mx-auto"
                        >
                            <Download size={16} /> Baixar Imagem
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

const SearchAndFilter = ({ searchTerm, setSearchTerm, activeFilter, setActiveFilter, statusOptions, getTextColorForBackground }) => {
    // --- NOVO: Estado para controlar o popup de filtro ---
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const filterMenuRef = useRef(null);

    // --- NOVO: Efeito para fechar o popup ao clicar fora ---
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (filterMenuRef.current && !filterMenuRef.current.contains(event.target)) {
                setIsFilterOpen(false);
            }
        };
        // Adiciona o listener
        document.addEventListener('mousedown', handleClickOutside);
        // Limpa o listener ao desmontar
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []); // Array vazio garante que rode apenas na montagem/desmontagem

    // --- NOVO: Helper para estilizar o ícone de filtro ---
    const activeFilterConfig = statusOptions.find(opt => opt.nome === activeFilter);
    const activeFilterColor = activeFilterConfig ? activeFilterConfig.cor : null;

    return (
        // --- MODIFICADO: Layout agora é flex horizontal ---
        <div className="flex-shrink-0 p-3 bg-white border-b border-gray-200 flex items-center gap-2">

            {/* Barra de Busca (agora com flex-1) */}
            <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                    type="text"
                    placeholder="Pesquisar ou começar uma nova conversa"
                    className="w-full pl-10 pr-4 py-2 bg-[#f0f2f5] border border-transparent rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300 text-sm"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>

            {/* --- NOVO: Botão e Popup de Filtro --- */}
            <div className="relative" ref={filterMenuRef}>
                {/* Botão de Ícone */}
                <button
                    type="button"
                    onClick={() => setIsFilterOpen(prev => !prev)}
                    className={`p-2 rounded-lg transition-colors relative ${isFilterOpen ? 'bg-blue-100 text-blue-600' : 'text-gray-500 hover:text-blue-600 hover:bg-gray-100'
                        }`}
                    title="Filtrar por status"
                >
                    <Filter size={20} />
                    {/* Indicador visual de filtro ativo */}
                    {activeFilter !== 'todos' && (
                        <span
                            className="absolute top-1 right-1 block h-3 w-3 rounded-full border-2 border-white"
                            style={{ backgroundColor: activeFilterColor || '#3b82f6' }} // fallback azul
                        ></span>
                    )}
                </button>

                {/* Popup do Filtro */}
                {isFilterOpen && (
                    <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-md shadow-lg z-20 overflow-hidden animate-fade-in-up-fast">
                        <span className="block px-4 py-2 text-sm text-gray-500 border-b">Filtrar por:</span>

                        {/* Opção "Todos" */}
                        <button
                            key="todos"
                            onClick={() => {
                                setActiveFilter('todos');
                                setIsFilterOpen(false); // Fecha o menu
                            }}
                            className={`w-full text-left px-4 py-2 text-sm transition-colors ${activeFilter === 'todos' ? 'font-semibold text-blue-600 bg-blue-50' : 'text-gray-700 hover:bg-gray-100'
                                }`}
                        >
                            Todos
                        </button>

                        {/* Opções Dinâmicas */}
                        {(statusOptions || []).map((filter) => (
                            <button
                                key={filter.nome}
                                onClick={() => {
                                    // Lógica original: clicar no filtro ativo desativa (volta p/ 'todos')
                                    setActiveFilter(filter.nome === activeFilter ? 'todos' : filter.nome);
                                    setIsFilterOpen(false); // Fecha o menu
                                }}
                                className={`w-full text-left px-4 py-2 text-sm transition-colors ${activeFilter === filter.nome ? 'font-semibold' : 'text-gray-700 hover:bg-gray-100'
                                    }`}
                                // Estilo se estiver ativo (cor do texto + fundo leve)
                                style={activeFilter === filter.nome ? {
                                    color: filter.cor,
                                    backgroundColor: `${filter.cor}1A` // 10% de opacidade da cor
                                } : {}}
                            >
                                <span className="flex items-center gap-2">
                                    {/* Bolinha colorida */}
                                    <span
                                        className="h-3 w-3 rounded-full"
                                        style={{ backgroundColor: filter.cor }}
                                    ></span>
                                    {filter.nome}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

// --- Componente: Item de Contato na Lista (MODIFICADO) ---
const ContactItem = ({ mensagem, isSelected, onSelect, statusOptions, onUpdateStatus }) => {
    // --- NOVO: Estado para o menu de status ---
    const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false);
    // --- NOVO: Ref para o menu de status ---
    const statusMenuRef = useRef(null);

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
            // Se o menu estiver aberto e o clique NÃO for dentro do ref
            if (statusMenuRef.current && !statusMenuRef.current.contains(event.target)) {
                setIsStatusMenuOpen(false);
            }
        };
        // Adiciona o listener
        document.addEventListener('mousedown', handleClickOutside);
        // Limpa o listener ao desmontar
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []); // Array vazio, só roda na montagem/desmontagem

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
        setIsStatusMenuOpen(prev => !prev);
    };

    // --- NOVO: Handler para selecionar um status ---
    const handleStatusChange = (e, newStatus) => {
        e.stopPropagation();
        onUpdateStatus(mensagem.id, { status: newStatus })
        setIsStatusMenuOpen(false);
    };

    return (
        <div
            className={`flex items-center p-3 cursor-pointer transition-colors ${isSelected ? 'bg-gray-200' : 'bg-white hover:bg-gray-50'
                }`}
            onClick={() => {
                // 1. Seleciona o mensagem (lógica original)
                onSelect(mensagem);

                // 2. Fecha o menu (lógica original)
                setIsStatusMenuOpen(false);

                // --- INÍCIO: Lógica de "Marcar como Lido" ---
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
                // --- FIM: Lógica de "Marcar como Lido" ---
            }}
        >
            <img
                className="w-12 h-12 rounded-full mr-3 flex-shrink-0" // Removido mt-3
                src={`https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSTip18a5vyLJJXYZgGE44WTFaislpkAcvQURSqLik0tsv8DuPggkyib-NrlShXqM2mO9k&usqp=CAU`}
                alt="Avatar"
            />
            <div className="flex-1 min-w-0 border-gray-100"> {/* Removido pt-3 */}
                <div className="flex justify-between items-center mb-1">
                    <h3 className="text-md font-semibold text-gray-800 truncate">{mensagem.whatsapp}</h3>
                    <span className="text-xs text-blue-600 font-medium ml-2 flex-shrink-0">
                        {formatTimestamp(lastMessageTime)}
                    </span>
                </div>

                {/* --- LINHA MODIFICADA: Mensagem e Status --- */}
                <div className="flex justify-between items-center">
                    <p className="text-sm text-gray-500 truncate">{lastMessage}</p>
                    {/* --- NOVO: Wrapper para os badges --- */}
                    <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        {/* --- INÍCIO: Bolinha de Contagem (Unread) --- */}
                        {hasUnreadMessages && (
                            <span
                                className="flex-shrink-0 flex items-center justify-center h-5 min-w-[1.25rem] px-1 bg-blue-500 text-white text-xs font-bold rounded-full"
                                title={`${unreadCount} novas mensagens`}
                            >
                                {unreadCount}
                            </span>
                        )}

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
            <div className="relative ml-2 flex-shrink-0" ref={statusMenuRef}>
                <button
                    type="button"
                    onClick={handleMenuClick}
                    className="p-1 rounded-full text-gray-500 hover:text-gray-800 hover:bg-gray-100"
                    title="Alterar status"
                >
                    <MoreVertical size={18} />
                </button>

                {/* --- NOVO: Dropdown do Menu (Estilo MODIFICADO) --- */}
                {isStatusMenuOpen && (
                    <div
                        // MODIFICADO: Aumentei para 'w-56' e adicionei 'overflow-hidden'
                        className="absolute right-0 top-6 mt-1 w-56 bg-white rounded-md shadow-lg z-20 overflow-hidden animate-fade-in-up-fast"
                        onClick={(e) => e.stopPropagation()} // Impede que o clique DENTRO do menu o feche
                    >
                        <span className="block px-4 py-2 text-sm text-gray-500 border-b">Alterar status:</span>
                        {(statusOptions || []).map(opt => {
                            // NOVO: Verifica se este é o status ativo
                            const isStatusActive = mensagem.status === opt.nome;

                            return (
                                <button // MODIFICADO: de <a> para <button>
                                    type="button"
                                    key={opt.nome}
                                    onClick={(e) => handleStatusChange(e, opt.nome)}
                                    // MODIFICADO: classes e estilo inline
                                    className={`w-full text-left px-4 py-2 text-sm transition-colors ${isStatusActive ? 'font-semibold' : 'text-gray-700 hover:bg-gray-100'
                                        }`}
                                    style={isStatusActive ? {
                                        color: opt.cor,
                                        backgroundColor: `${opt.cor}1A` // 10% opacidade
                                    } : {}}
                                >
                                    {/* NOVO: Layout flex com bolinha colorida */}
                                    <span className="flex items-center gap-2">
                                        <span
                                            className="h-3 w-3 rounded-full"
                                            style={{ backgroundColor: opt.cor }}
                                        ></span>
                                        {opt.nome}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

// Importa o novo componente de áudio
import AudioPlayer from '../components/AudioPlayer';
import ImageDisplayer from '../components/ImageDisplayer';
import VideoDisplayer from '../components/VideoDisplayer';

const MessageContent = ({ msg, atendimentoId, onViewMedia, onDownloadDocument, isDownloading }) => {
    // Props adicionadas: onViewMedia, isDownloading

    // --- NOVA VERIFICAÇÃO DE ERRO ---
    // Verifica se a mensagem tem um status de 'failed'/'error' vindo do backend (via webhook)
    // OU se o tipo local é 'error' (para falhas de envio imediatas no frontend)
    if (msg.status === 'failed' || msg.status === 'error' || msg.type === 'error') {

        // Tenta montar uma mensagem de erro descritiva
        let errorMessage = 'Falha no envio'; // Padrão
        if (msg.error_title) {
            errorMessage = msg.error_title; // Erro do WBP (ex: 'Re-engagement message')
        } else if (msg.content) {
            errorMessage = msg.content; // Erro do frontend (ex: 'Falha ao enviar mensagem.')
        }

        const errorCode = msg.error_code ? ` (Cód: ${msg.error_code})` : '';

        return (
            <div className="flex items-center gap-2 text-red-600">
                <AlertTriangle size={16} />
                <span className="text-sm">
                    {errorMessage}{errorCode}

                    {/* Se a falha foi em uma mensagem que *tinha* conteúdo, mostra abaixo */}
                    {msg.type !== 'error' && msg.content && (
                        <p className="text-xs text-gray-500 italic mt-1">Mensagem original: "{msg.content}"</p>
                    )}
                </span>
            </div>
        );
    }
    // --- FIM DA NOVA VERIFICAÇÃO ---


    // Se não for um erro, continua a renderização normal
    const type = msg.type || 'text';
    const hasMedia = msg.media_id && ['image', 'audio', 'document', 'video'].includes(type); // <-- 1. ADICIONADO 'video'

    // Texto a ser exibido (transcrição, análise ou mensagem original)
    // Mostra um placeholder se for mídia sem conteúdo textual ainda
    const displayText = msg.content || (hasMedia ? `[${type === 'image' ? 'Imagem' : type === 'audio' ? 'Áudio' : type === 'video' ? 'Vídeo' : 'Documento'}${msg.filename ? `: ${msg.filename}` : ''}]` : ''); // <-- 2. ADICIONADO 'video'

    // --- CORREÇÃO: A sintaxe do 'if/else if' estava incorreta. ---
    // Texto do botão (agora com a sintaxe correta)
    let buttonText = type === 'image' ? 'Ver Imagem'
                   : type === 'audio' ? 'Ouvir Áudio'
                   : type === 'video' ? 'Ver Vídeo'
                   : type === 'document' ? 'Baixar Documento'
                   : '';

    // Lógica principal de renderização
    switch (type) {
        // --- NOVO CASE EXCLUSIVO PARA ÁUDIO ---
        case 'audio':
            return (
                <AudioPlayer
                    atendimentoId={atendimentoId}
                    mediaId={msg.media_id}
                    transcription={displayText}
                />
            );

        // --- NOVO CASE EXCLUSIVO PARA IMAGEM ---
        case 'image':
            return (
                <ImageDisplayer
                    atendimentoId={atendimentoId}
                    mediaId={msg.media_id}
                    caption={displayText}
                />
            );

        // --- NOVO CASE EXCLUSIVO PARA VÍDEO ---
        case 'video':
            return (
                <VideoDisplayer
                    atendimentoId={atendimentoId}
                    mediaId={msg.media_id}
                    caption={displayText}
                />
            );

        case 'document': // O case de vídeo foi separado
            return (
                <div className="space-y-1">

                    {/* Exibe o botão se tiver media_id */}
                    {hasMedia && (
                        <div className="mt-1">{type === 'document' ? (// Documento usa link direto
                                <button
                                    type="button"
                                    // <<-- O onClick chama a nova função
                                    onClick={() => onDownloadDocument(msg.media_id, msg.filename)}
                                    disabled={isDownloading} // <<-- Usa o estado de loading
                                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 ${isDownloading ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    {isDownloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                                    {buttonText}
                                </button>
                            ) : null}</div>
                    )}
                </div>
            );

        case 'sending':
            return (
                <div className="flex items-center gap-2 italic text-gray-500">
                    <Loader2 size={16} className="animate-spin" />
                    {/* Mostra preview se for imagem */}
                    {msg.localUrl && msg.filename?.match(/\.(jpeg|jpg|png|webp)$/i) && (
                        <img src={msg.localUrl} alt="preview" className="w-10 h-10 object-cover rounded mr-1" />
                    )}
                    {/* Preview para audio local */}
                    {msg.localUrl && type === 'audio' && (
                        <audio src={msg.localUrl} controls className="h-8 w-40" />
                    )}
                    {/* --- INÍCIO DA ADIÇÃO (VÍDEO PREVIEW) --- */}
                    {msg.localUrl && type === 'video' && (
                        <video src={msg.localUrl} controls muted className="h-20 w-32 rounded" />
                    )}
                    {/* --- FIM DA ADIÇÃO --- */}
                    <span>{msg.content || `Enviando ${msg.filename || 'mídia'}...`}</span>
                </div>
            );

        // O 'case: error' foi removido daqui pois agora é tratado no início do componente

        case 'text':
        default: // Inclui 'unknown' e outros tipos não tratados
            // Se tiver 'content', mostra. Se não, indica tipo desconhecido se houver media_id
            const defaultText = msg.content || (msg.media_id ? `[Mídia tipo '${type}' não suportada]` : '');
            return (
                <p className="whitespace-pre-wrap text-sm">{defaultText || '[Mensagem vazia]'}</p>
            );
    }
}

// --- Componente: Corpo da Conversa (Mensagens) ---
const ChatBody = ({ mensagem, onViewMedia, onDownloadDocument, isDownloadingMedia }) => {
    const chatContainerRef = useRef(null);
    const [messages, setMessages] = useState([]);

    // --- NOVO: Ref para guardar o ID do mensagem anterior ---
    const prevAtendimentoIdRef = useRef(null);
    // --- NOVO: Ref para saber se o usuário estava no final do scroll antes da atualização ---
    const userWasAtBottomRef = useRef(true);

    useEffect(() => {
        let parsedMessages = [];
        try {
            parsedMessages = mensagem ? JSON.parse(mensagem.conversa || '[]') : [];
        } catch (e) {
            console.error("Erro ao analisar JSON da conversa:", e);
        }

        // --- NOVO: Lógica para verificar a posição do scroll ANTES de atualizar as mensagens ---
        const chatElement = chatContainerRef.current;
        if (chatElement) {
            const { scrollTop, scrollHeight, clientHeight } = chatElement;
            // Considera "no fundo" se estiver a 50px do final.
            // Isso garante que o scroll automático funcione mesmo se houver uma pequena margem.
            userWasAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 50;
        } else {
            // Se o chatElement ainda não existe (primeira renderização),
            // assuma que queremos rolar para o final.
            userWasAtBottomRef.current = true;
        }
        // --- FIM DA NOVA LÓGICA ---

        setMessages(parsedMessages);
    }, [mensagem]); // Este hook ainda depende apenas de 'mensagem'

    // --- ALTERADO: useEffect de Scroll ---
    useEffect(() => {
        const chatElement = chatContainerRef.current;
        if (chatElement) {
            const currentAtendimentoId = mensagem?.id;
            const prevAtendimentoId = prevAtendimentoIdRef.current;

            // Condições para rolar para o final:
            // 1. O usuário mudou de chat (ID do mensagem é diferente)
            // 2. O usuário JÁ ESTAVA no final do scroll (e as mensagens mudaram)
            const shouldScroll =
                currentAtendimentoId !== prevAtendimentoId ||
                userWasAtBottomRef.current;

            if (shouldScroll) {
                chatElement.scrollTop = chatElement.scrollHeight;
            }

            // Atualiza a ref de ID para a próxima renderização
            prevAtendimentoIdRef.current = currentAtendimentoId;
        }
    }, [messages, mensagem?.id]); // Depende de 'messages' E do 'mensagem.id'

    const formatTimestamp = (timestamp) => {
        try {
            const date = (typeof timestamp === 'number') ? new Date(timestamp * 1000) : new Date(timestamp);
            const now = new Date();
            // Se a data da mensagem for o mesmo dia que hoje, mostra só a hora.
            if (format(date, 'yyyy-MM-dd') === format(now, 'yyyy-MM-dd')) {
                return format(date, 'HH:mm');
            }
            // Caso contrário, mostra data e hora.
            return format(date, 'HH:mm dd/MM/yy');
        } catch {
            return '';
        }
    }

    return (
        <div
            ref={chatContainerRef}
            className="flex-1 p-4 md:p-6 overflow-y-auto space-y-3 bg-gray-100"
            style={{
                backgroundImage: `
                linear-gradient(rgba(173, 216, 230, 0.6), rgba(173, 216, 230, 0.9)),
                url('https://static.vecteezy.com/system/resources/previews/021/736/713/non_2x/doodle-lines-arrows-circles-and-curves-hand-drawn-design-elements-isolated-on-white-background-for-infographic-illustration-vector.jpg')
                `,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundBlendMode: 'overlay'
            }}
        >
            {messages.map((msg) => {
                const isAssistant = msg.role === 'assistant';
                return (
                    <div key={msg.id} className={`flex ${isAssistant ? 'justify-end' : 'justify-start'}`}>
                        <div
                            className={`relative max-w-xs md:max-w-md py-2 px-3 rounded-lg shadow-sm break-words ${isAssistant
                                ? 'bg-[#d9fdd3] text-gray-800' // Verde WhatsApp
                                : 'bg-white text-gray-800'
                                }`}
                        >
                            <MessageContent
                                msg={msg}
                                atendimentoId={mensagem.id}
                                onViewMedia={onViewMedia}
                                onDownloadDocument={onDownloadDocument}
                                isDownloading={isDownloadingMedia} // Passa o estado de loading
                            />

                            <span className="text-xs text-gray-400 float-right ml-2 mt-1">
                                {formatTimestamp(msg.timestamp)}
                            </span>
                        </div>
                    </div>
                );
            })}
            {messages.length === 0 && (
                <div className="flex items-center justify-center h-full">
                    <p className="text-center text-gray-600 bg-white/70 backdrop-blur-sm p-3 rounded-lg italic">
                        Nenhuma mensagem neste mensagem.
                    </p>
                </div>
            )}
        </div>
    );
};

const ChatFooter = ({ onSendMessage, onSendMedia, onOpenTemplateModal }) => {
    const [text, setText] = useState('');
    const [showAttachMenu, setShowAttachMenu] = useState(false);
    const attachMenuRef = useRef(null); // Ref para o menu de anexo


    // --- Novos estados para mídia ---
    const [isRecording, setIsRecording] = useState(false);
    const [isSendingMedia, setIsSendingMedia] = useState(false); // Trava o input
    const [recordingTime, setRecordingTime] = useState(0);

    // --- Refs ---
    const mediaRecorderRef = useRef(null);
    const audioChunksRef = useRef([]);
    const recordingIntervalRef = useRef(null);
    const recordingMimeTypeRef = useRef('audio/webm'); // Guarda o tipo usado
    const didCancelRecordingRef = useRef(false);
    const textInputRef = useRef(null);

    // Refs para os inputs de arquivo
    const imageInputRef = useRef(null);
    const docInputRef = useRef(null);
    const videoInputRef = useRef(null);

    // Efeito para fechar o menu de anexo ao clicar fora
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (attachMenuRef.current && !attachMenuRef.current.contains(event.target)) {
                setShowAttachMenu(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    useEffect(() => {
        const textarea = textInputRef.current;
        if (textarea) {
            const maxHeight = 120; // Altura máxima (aprox. 5-6 linhas)

            textarea.style.height = 'auto'; // Reseta a altura
            const scrollHeight = textarea.scrollHeight;

            if (scrollHeight > maxHeight) {
                textarea.style.height = `${maxHeight}px`;
                textarea.style.overflowY = 'auto'; // Adiciona scroll se passar do max
            } else {
                textarea.style.height = `${scrollHeight}px`;
                textarea.style.overflowY = 'hidden'; // Esconde scroll
            }
        }
    }, [text]); // Executa toda vez que o texto muda

    // --- Lógica de Gravação de Áudio (MODIFICADA) ---
    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // --- INÍCIO DA CORREÇÃO ---
            // Tenta os formatos aceitos pela WBP primeiro
            const mimeTypes = [
                'audio/ogg; codecs=opus', // Ideal
                'audio/opus',             // Aceito
                'audio/ogg',              // Aceito
                'audio/mp3',              // Aceito
                'audio/webm; codecs=opus' // Fallback (não para WBP, mas para Evo)
            ];
            // Encontra o primeiro tipo que o navegador suporta
            const supportedType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type));

            if (!supportedType) {
                alert("Seu navegador não suporta a gravação de áudio em um formato compatível (OGG, Opus ou MP3).");
                console.error("Nenhum tipo de MIME suportado para gravação de áudio.");
                return;
            }

            recordingMimeTypeRef.current = supportedType; // Salva o tipo

            mediaRecorderRef.current = new MediaRecorder(stream, { mimeType: supportedType });
            // --- FIM DA CORREÇÃO ---

            audioChunksRef.current = []; // Limpa chunks antigos

            mediaRecorderRef.current.ondataavailable = (event) => {
                audioChunksRef.current.push(event.data);
            };

            mediaRecorderRef.current.onstop = () => {
                // 1. Limpa o timer e o estado de gravação em TODOS os casos
                clearInterval(recordingIntervalRef.current);
                setRecordingTime(0);
                setIsRecording(false);

                // 2. Limpa a stream (microfone) em TODOS os casos
                stream.getTracks().forEach(track => track.stop());

                // 3. VERIFICA A BANDEIRA DE CANCELAMENTO
                if (didCancelRecordingRef.current) {
                    didCancelRecordingRef.current = false; // Reseta a flag
                    audioChunksRef.current = []; // Descarta os dados
                    return; // Para aqui
                }

                // 4. Se NÃO foi cancelado, prossegue com o envio

                // --- INÍCIO DA CORREÇÃO (Lógica que você já tinha) ---
                let targetMimeType = 'audio/ogg'; // O tipo que a WBP aceita
                let targetExtension = '.ogg';

                // Pega o tipo que o navegador *realmente* gravou
                const recordedMimeType = recordingMimeTypeRef.current;

                if (recordedMimeType.includes('opus') || recordedMimeType.includes('ogg')) {
                    targetMimeType = 'audio/ogg'; // WBP aceita 'audio/ogg'
                    targetExtension = '.ogg';
                } else if (recordedMimeType.includes('mp3')) {
                    targetMimeType = 'audio/mpeg'; // Mimetype de MP3
                    targetExtension = '.mp3';
                } else {
                    // Fallback se o navegador gravou algo inesperado
                    console.warn(`Tipo gravado não otimizado: ${recordedMimeType}. Enviando como .ogg`);
                    targetMimeType = 'audio/ogg';
                    targetExtension = '.ogg';
                }


                // FORÇA o blob a ter o tipo que a WBP aceita
                const audioBlob = new Blob(audioChunksRef.current, { type: targetMimeType });
                const filename = `audio_${Date.now()}${targetExtension}`;
                // --- FIM DA CORREÇÃO ---

                // Envia o Blob
                if (audioBlob.size > 1000) { // Evita enviar blobs vazios se parar rápido
                    handleSendFile(audioBlob, 'audio', filename); // Passa o nome de arquivo .ogg ou .mp3
                } else {
                }

                // Limpa os chunks APÓS o envio/descarte
                audioChunksRef.current = [];
            };

            mediaRecorderRef.current.start();
            setIsRecording(true);

            // Inicia o timer
            setRecordingTime(0);
            recordingIntervalRef.current = setInterval(() => {
                setRecordingTime(prevTime => prevTime + 1);
            }, 1000);

        } catch (err) {
            console.error("Erro ao iniciar gravação de áudio:", err);
            alert("Não foi possível acessar o microfone. Verifique as permissões do navegador.");
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            didCancelRecordingRef.current = false; // <-- Define a flag (NÃO cancelar)
            mediaRecorderRef.current.stop();
        }
    };

    const cancelRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            didCancelRecordingRef.current = true; // <-- Define a flag (SIM, cancelar)
            mediaRecorderRef.current.stop(); // O 'onstop' vai pegar essa flag
        }
        // O resto da limpeza (timer, state, chunks) agora é feito no 'onstop'
    };

    const handleMicClick = () => {
        if (isRecording) {
            stopRecording(); // Envia ao parar
        } else {
            startRecording(); // Começa a gravar
        }
    };

    // --- Lógica de Envio de Arquivo (MODIFICADA) ---
    // (A única mudança é a remoção do bloco 'finally' que limpava os inputs)
    const handleSendFile = (file, type, customFilename = null) => {
        if (!file) return;

        try {
            // Apenas chama a prop 'onSendMedia' (que agora vai enfileirar)
            const filename = customFilename || file.name || `${type}_${Date.now()}`;
            onSendMedia(file, type, filename); // Esta chamada não é 'await'
        } catch (error) {
            // Erro síncrono (ex: falha ao gerar nome do arquivo), improvável
            console.error(`Erro síncrono ao preparar envio de ${type}:`, error);
            alert(`Falha ao preparar ${type} para envio.`);
        }
        // O 'finally' block com a limpeza dos inputs FOI REMOVIDO DAQUI
    };

    // Handler para os inputs de arquivo
    const handleFileChange = (event, type) => {
        const files = event.target.files; // Pega a FileList
        if (!files || files.length === 0) {
            return; // Sai se nada foi selecionado
        }

        // Itera sobre todos os arquivos selecionados
        for (const file of files) {
            if (file) {
                // Chama a função de enfileiramento para CADA arquivo
                handleSendFile(file, type); // O 'customFilename' é nulo
            }
        }

        // Limpa o valor dos inputs APÓS o loop (movido de 'handleSendFile' para cá)
        if (imageInputRef.current) imageInputRef.current.value = null;
        if (docInputRef.current) docInputRef.current.value = null;
        if (videoInputRef.current) videoInputRef.current.value = null;

        setShowAttachMenu(false); // Fecha o menu após enfileirar tudo
    };

    // --- Lógica de Envio de Texto (MODIFICADA) ---
    // 1. A lógica de envio foi extraída para esta função
    const submitTextLogic = () => {
        const textToSend = text.trim();
        if (!textToSend || isRecording || isSendingMedia) return;

        setText(''); // Limpa o input

        // Foca e reseta a altura do textarea
        setTimeout(() => {
            const textarea = textInputRef.current;
            if (textarea) {
                textarea.focus();
                textarea.style.height = 'auto'; // Reseta altura
                textarea.style.overflowY = 'hidden';
            }
        }, 0);

        onSendMessage(textToSend); // Envia (sem await)
    };

    // 2. O handler do <form> agora só chama a lógica
    const handleSubmitText = (e) => {
        e.preventDefault();
        submitTextLogic();
    };

    // 3. (NOVO) Handler de tecla para o textarea
    const handleKeyDown = (e) => {
        // Se for 'Enter' E NÃO for 'Shift'
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault(); // Previne a quebra de linha
            submitTextLogic();  // Envia a mensagem
        }
        // Se for 'Shift + Enter', permite o comportamento padrão (quebrar linha)
    };
    // --- FIM DAS MODIFICAÇÕES DE ENVIO DE TEXTO ---

    // Formata o tempo de gravação (ex: 00:05)
    const formatRecordingTime = (time) => {
        const minutes = Math.floor(time / 60).toString().padStart(2, '0');
        const seconds = (time % 60).toString().padStart(2, '0');
        return `${minutes}:${seconds}`;
    };

    return (
        <footer className="flex-shrink-0 p-3 bg-[#f0f2f5] border-t border-gray-200">
            {/* Inputs de arquivo ocultos */}
            <input
                type="file"
                ref={imageInputRef}
                accept="image/png, image/jpeg, image/webp"
                className="hidden"
                onChange={(e) => handleFileChange(e, 'image')}
                disabled={isRecording}
                multiple
            />
            <input
                type="file"
                ref={docInputRef}
                accept=".pdf,.doc,.docx,.xls,.xlsx,.txt"
                className="hidden"
                onChange={(e) => handleFileChange(e, 'document')}
                disabled={isRecording}
                multiple
            />

            {/* --- INÍCIO DA ADIÇÃO --- */}
            <input
                type="file"
                ref={videoInputRef}
                accept="video/mp4,video/3gpp"
                className="hidden"
                onChange={(e) => handleFileChange(e, 'video')}
                disabled={isRecording}
                multiple
            />
            {/* --- FIM DA ADIÇÃO --- */}

            {/* Se estiver gravando, mostra a UI de gravação */}
            {isRecording ? (
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={cancelRecording} // Botão de lixeira para cancelar
                        title="Cancelar Gravação"
                        className="p-2 text-gray-500 hover:text-red-600 transition-colors rounded-full hover:bg-gray-200"
                    >
                        <Trash2 size={22} />
                    </button>

                    <div className="flex-1 flex items-center justify-center gap-2 text-red-600">
                        <StopCircle size={16} className="animate-pulse" />
                        <span className="font-mono">{formatRecordingTime(recordingTime)}</span>
                    </div>

                    <button
                        type="button"
                        className="p-2 text-white bg-blue-600 rounded-full hover:bg-blue-700 transition-colors"
                        title="Parar e Enviar"
                        onClick={stopRecording} // O ícone de 'mic' agora é 'enviar'
                    >
                        <Send size={22} />
                    </button>
                </div>
            ) : (
                // UI Padrão (texto ou mic)
                <form onSubmit={handleSubmitText} className="flex items-center gap-3">
                    {/* Botão Anexar */}
                    <div className="relative" ref={attachMenuRef}>
                        {/* --- NOVO: Botão para abrir modal de template --- */}
                        <button type="button" onClick={onOpenTemplateModal} className="p-2 text-gray-500 hover:text-blue-600 transition-colors rounded-full hover:bg-gray-200" title="Enviar template">
                            <MessageSquarePlus size={22} />
                        </button>

                        {showAttachMenu && (
                            <div className="absolute bottom-12 left-0 bg-white rounded-lg shadow-lg overflow-hidden w-48 animate-fade-in-up-fast">
                                <button type="button" onClick={() => imageInputRef.current?.click()} className="flex items-center gap-3 w-full px-4 py-3 text-sm text-gray-700 hover:bg-gray-100">
                                    <ImageIcon size={20} className="text-purple-500" />
                                    Imagem
                                </button>
                                <button type="button" onClick={() => videoInputRef.current?.click()} className="flex items-center gap-3 w-full px-4 py-3 text-sm text-gray-700 hover:bg-gray-100">
                                    <FileVideo size={20} className="text-red-500" />
                                    Vídeo
                                </button>
                                <button type="button" onClick={() => docInputRef.current?.click()} className="flex items-center gap-3 w-full px-4 py-3 text-sm text-gray-700 hover:bg-gray-100">
                                    <FileText size={20} className="text-blue-500" />
                                    Documento
                                </button>
                            </div>
                        )}
                        <button type="button" onClick={() => setShowAttachMenu(!showAttachMenu)} className="p-2 text-gray-500 hover:text-blue-600 transition-colors rounded-full hover:bg-gray-200">
                            <Paperclip size={22} />
                        </button>
                    </div>

                    {/* Input de Texto */}
                    <textarea
                        ref={textInputRef}
                        rows={1} // Começa com uma linha
                        placeholder="Digite uma mensagem"
                        className="flex-1 px-4 py-2 border border-gray-300 bg-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none overflow-y-hidden" // Adicionado resize-none e overflow-y-hidden
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={handleKeyDown}
                    />

                    {/* Botão Enviar ou Mic */}
                    {text.trim() ? (
                        <button
                            type="submit"
                            className="p-2 text-white bg-blue-600 rounded-full hover:bg-blue-700 transition-colors disabled:bg-gray-400"
                            title="Enviar"
                        >
                            <Send size={22} />
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="p-2 text-gray-500 hover:text-blue-600 transition-colors rounded-full hover:bg-gray-200"
                            title="Gravar áudio"
                            onClick={handleMicClick}
                        >
                            <Mic size={22} />
                        </button>
                    )}
                </form>
            )}
        </footer >
    );
};


// --- Componente: Placeholder (Sem chat selecionado) ---
const ChatPlaceholder = () => (
    <div className="flex-1 flex flex-col items-center justify-center text-center bg-gray-100 border-l border-gray-200">
        <div className="p-8 bg-white/70 backdrop-blur-sm rounded-lg shadow">
            <MessageSquareText size={64} className="text-gray-400 mx-auto" />
            <h2 className="mt-4 text-2xl font-semibold text-gray-700">Atendimento Manual</h2>
            <p className="mt-2 text-gray-500">
                Selecione um mensagem na lista à esquerda para visualizar ou responder.
            </p>
        </div>
    </div>
);

const getLastMessageTimestamp = (at) => {
    try {
        const conversa = JSON.parse(at.conversa || '[]');
        if (conversa.length === 0) {
            return new Date(at.updated_at).getTime(); // Fallback se conversa vazia
        }
        const lastMsg = conversa[conversa.length - 1];
        const ts = lastMsg.timestamp;

        if (!ts) {
            return new Date(at.updated_at).getTime(); // Fallback se msg não tiver timestamp
        }

        // Converte timestamp (seja unix/segundos ou ISO string) para ms
        return (typeof ts === 'number') ? (ts * 1000) : new Date(ts).getTime();
    } catch (e) {
        // Fallback em caso de JSON inválido ou erro
        return new Date(at.updated_at).getTime();
    }
};

// --- NOVO: Importa o modal de template ---
import TemplateModal from '../components/TemplateModal';


// --- COMPONENTE PRINCIPAL DA PÁGINA ---
function Mensagens() {
    const [mensagens, setAtendimentos] = useState([]);
    const [filteredAtendimentos, setFilteredAtendimentos] = useState([]);
    const [currentUser, setCurrentUser] = useState(null);

    const [personas, setPersonas] = useState([]);
    const [statusOptions, setStatusOptions] = useState([]);

    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    const [searchTerm, setSearchTerm] = useState('');
    const [activeFilter, setActiveFilter] = useState('todos');
    const [selectedAtendimento, setSelectedAtendimento] = useState(null);
    const [totalAtendimentos, setTotalAtendimentos] = useState(0);
    
    // --- NOVO: Estado para controlar o limite de carregamento ---
    const [limit, setLimit] = useState(20);

    // --- NOVO: Estado para o loading do botão "Carregar Mais" ---
    const [isFetchingMore, setIsFetchingMore] = useState(false);

    const [modalMedia, setModalMedia] = useState(null); // { url: blobUrl, type: 'image'|'audio', filename: string }
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isDownloadingMedia, setIsDownloadingMedia] = useState(false); // Para feedback no botão
    const currentBlobUrl = useRef(null); // Para limpar a URL do blob anterior

    // --- NOVO: Estado para o modal de template ---
    const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);

    const intervalRef = useRef(null);

    // Armazena as filas de envio por atendimentoId
    // Ex: { 1: [item1, item2], 2: [item3] }
    const [sendingQueue, setSendingQueue] = useState({});

    // Controla qual fila está ativamente processando um item
    // Ex: { 1: true, 2: false }
    const [isProcessing, setIsProcessing] = useState({});

    // --- Fetch (User e Mensagens) ---
    const fetchData = useCallback(async (isInitialLoad = false) => {
        if (isInitialLoad) setIsLoading(true);

        // Se não for uma carga inicial, significa que pode ser um "carregar mais" ou polling.
        // Ativamos o estado de carregamento se o limite for maior que o inicial.
        if (!isInitialLoad && limit > 20) {
            setIsFetchingMore(true);
        }
        try {
            const [userRes, atendimentosRes, personasRes, situationsRes] = await Promise.all([
                api.get('/auth/me'),
                // --- CORREÇÃO: Envia o filtro para a API ---
                api.get('/atendimentos/', {
                    params: {
                        search: searchTerm, limit: limit, status: activeFilter === 'todos' ? null : activeFilter
                    }
                }),
                api.get('/configs/'),
                api.get('/configs/situations')
            ]);
            setCurrentUser(userRes.data);
            setPersonas(personasRes.data);
            setStatusOptions(situationsRes.data);

            const serverData = atendimentosRes.data;
            if (serverData && Array.isArray(serverData.items)) {
                setAtendimentos(prevAtendimentos => {
                    // Se for uma carga inicial, troca de filtro ou busca, substitui a lista.
                    // Consideramos uma "carga nova" se o limite for o padrão (20).
                    const isNewLoad = limit === 20;

                    const newItems = serverData.items;
                    let combinedItems;

                    if (isNewLoad) {
                        combinedItems = newItems;
                    } else {
                        // Se não for carga nova (é um "carregar mais"), combina os resultados.
                        const prevItemsMap = new Map(prevAtendimentos.map(item => [item.id, item]));
                        newItems.forEach(item => {
                            prevItemsMap.set(item.id, item); // Adiciona ou atualiza
                        });
                        combinedItems = Array.from(prevItemsMap.values());
                    }

                    // Lógica para manter mensagens otimistas (em envio)
                    const busyAtendimentoIds = new Set(
                        Object.keys(sendingQueue)
                            .filter(id => sendingQueue[id]?.length > 0)
                            .map(id => parseInt(id, 10))
                    );

                    return combinedItems.map(at => {
                        if (busyAtendimentoIds.has(at.id)) {
                            const localVersion = prevAtendimentos.find(local => local.id === at.id);
                            if (localVersion) {
                                // Se existe uma versão local com mensagens em envio, usa ela.
                                return localVersion;
                            }
                        }
                        return at;
                    });
                });
                setTotalAtendimentos(serverData.total);
            } else {
                setAtendimentos(Array.isArray(serverData) ? serverData : []);
                setTotalAtendimentos(0);
            }
            setError('');
        } catch (err) {
            console.error("Erro ao carregar dados:", err);
            if (isInitialLoad) setError('Não foi possível carregar os dados. Verifique a sua conexão.');
        } finally {
            if (isInitialLoad) setIsLoading(false);
            setIsFetchingMore(false); // Desativa o loading do botão em todos os casos
        }
    }, [searchTerm, sendingQueue, isProcessing, limit, activeFilter]); // <-- ADICIONA 'activeFilter' ÀS DEPENDÊNCIAS

    // --- Efeito: Polling Seguro (COM PAUSA EM SEGUNDO PLANO) ---
    useEffect(() => {
        let isMounted = true;
        let timeoutId;

        const poll = async () => {
            if (!document.hidden) {
                await fetchData(false);
            }
            if (isMounted) {
                timeoutId = setTimeout(poll, 5000);
            }
        };

        fetchData(true).then(() => {
             if (isMounted) timeoutId = setTimeout(poll, 5000);
        });

        const handleVisibilityChange = () => {
            if (!document.hidden && isMounted) {
                // --- ALTERADO: Reseta o limite para o valor inicial correto ---
                setLimit(20);
                clearTimeout(timeoutId);
                poll();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            isMounted = false;
            clearTimeout(timeoutId);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [fetchData]);

    // --- NOVO: Efeito para resetar o limite ao mudar o filtro ou a busca ---
    useEffect(() => {
        // Toda vez que o filtro ou o termo de busca mudar,
        // reseta o limite para o valor inicial.
        setLimit(20);
    }, [activeFilter, searchTerm]);

    useEffect(() => {
        if (!Array.isArray(mensagens)) {
            setFilteredAtendimentos([]);
            return;
        }

        let filtered = mensagens;

        // A filtragem agora é feita no backend. O frontend apenas ordena.
        // Ordena a lista filtrada (b - a para decrescente, mais novo primeiro)
        const sortedFiltered = filtered.sort((a, b) => {
            // Usa a função helper definida fora do componente
            const timeA = getLastMessageTimestamp(a);
            const timeB = getLastMessageTimestamp(b);
            return timeB - timeA;
        });

        // Usa a lista ORDENADA
        setFilteredAtendimentos(sortedFiltered);

        // (Modificado para usar sortedFiltered)
        // Se nada estiver selecionado (carga inicial) E a lista ORDENADA tiver itens
        if (!selectedAtendimento && sortedFiltered.length > 0) {
            setSelectedAtendimento(sortedFiltered[0]);
        }
        // --- FIM DA MODIFICAÇÃO (SELEÇÃO) ---

        // Lógica para atualizar a seleção (se ainda estiver na lista filtrada)
        // (Modificado para usar sortedFiltered)
        else if (selectedAtendimento) {
            const updatedSelected = sortedFiltered.find(at => at.id === selectedAtendimento.id);
            if (updatedSelected) {
                // Compara timestamps para evitar sobrescrever a UI com dados antigos
                const localDate = new Date(selectedAtendimento.updated_at).getTime();
                const serverDate = new Date(updatedSelected.updated_at).getTime();
                if (serverDate >= localDate) {
                    setSelectedAtendimento(updatedSelected);
                }
            } else {
                // O item selecionado não está mais no filtro, des-seleciona
                setSelectedAtendimento(null);
            }
        }
    }, [mensagens, activeFilter, selectedAtendimento]); // Dependências originais

    // --- FUNÇÃO CORRIGIDA PARA USAR AXIOS (api) ---
    const handleViewMedia = async (mediaId, type, filename) => {
        if (!selectedAtendimento || isDownloadingMedia) {
            return;
        }

        // Limpa URL de blob antiga
        if (currentBlobUrl.current) {
            URL.revokeObjectURL(currentBlobUrl.current);
            currentBlobUrl.current = null;
        }

        setIsDownloadingMedia(true);
        const backendMediaUrl = `/atendimentos/${selectedAtendimento.id}/media/${mediaId}`; // URL relativa para Axios

        try {
            // --- USA api.get com responseType: 'blob' ---
            const response = await api.get(backendMediaUrl, {
                responseType: 'blob', // <<<--- ESSENCIAL PARA BAIXAR ARQUIVO
                timeout: 60000 // Aumenta timeout para downloads (60s)
            });

            // Axios trata erros HTTP > 2xx no catch por padrão

            // O 'data' da resposta do Axios já será o Blob
            const blob = response.data;
            // Pega o content-type dos headers da resposta
            const actualContentType = response.headers['content-type'];

            if (blob.size === 0) {
                throw new Error("Download resultou em um arquivo vazio.");
            }
            // --- VERIFICA SE O TIPO É HTML (AINDA INDICA ERRO NO BACKEND/TOKEN) ---
            if (blob.type && blob.type.includes('text/html')) {
                console.error("[handleViewMedia] Recebido HTML em vez de mídia. Provável erro de token no backend.");
                // Tenta ler o HTML para dar uma dica
                try {
                    const htmlText = await blob.text();
                    console.error("[handleViewMedia] Conteúdo HTML recebido:", htmlText.substring(0, 500));
                } catch { /* Ignora se não conseguir ler */ }
                throw new Error("Falha ao baixar mídia: O servidor retornou uma página HTML inesperada. Verifique o token de acesso no backend.");
            }
            // ---------------------------------------------------------------------

            // --- Criar Blob URL e Abrir Modal ---
            const blobUrl = URL.createObjectURL(blob);
            currentBlobUrl.current = blobUrl;

            setModalMedia({ url: blobUrl, type: type, filename: filename });

            setTimeout(() => {
                setIsModalOpen(true);
            }, 0);

        } catch (error) {
            // Axios coloca erros de rede e status >= 300 aqui
            console.error("[handleViewMedia] Erro durante a requisição Axios:", error);
            let alertMessage = "Não foi possível carregar a mídia.";
            if (error.response) {
                // Tenta pegar o 'detail' do erro do FastAPI
                console.error("[handleViewMedia] Axios error response data:", error.response.data);
                console.error("[handleViewMedia] Axios error response status:", error.response.status);
                // Se a resposta for um Blob (mesmo com erro), tenta ler como texto
                if (error.response.data instanceof Blob) {
                    try {
                        const errorBlobText = await error.response.data.text();
                        console.error("[handleViewMedia] Axios error Blob content:", errorBlobText.substring(0, 500));
                        // Tenta parsear como JSON se for texto
                        try {
                            const errorJson = JSON.parse(errorBlobText);
                            alertMessage = `Erro ${error.response.status}: ${errorJson.detail || 'Erro ao carregar mídia.'}`;
                        } catch {
                            alertMessage = `Erro ${error.response.status}: Resposta inesperada do servidor.`;
                        }
                    } catch {
                        alertMessage = `Erro ${error.response.status}: Falha ao ler detalhes do erro.`;
                    }
                } else if (error.response.data?.detail) {
                    alertMessage = `Erro ${error.response.status}: ${error.response.data.detail}`;
                } else {
                    alertMessage = `Erro ${error.response.status}: Falha ao carregar mídia.`;
                }

            } else if (error.request) {
                console.error("[handleViewMedia] Axios error: No response received.");
                alertMessage = "Não foi possível conectar ao servidor para carregar a mídia.";
            } else {
                console.error("[handleViewMedia] Axios error:", error.message);
                alertMessage = `Erro ao preparar a requisição: ${error.message}`;
            }
            alert(alertMessage);

            // Garante limpeza do blobUrl em caso de erro
            if (currentBlobUrl.current) {
                URL.revokeObjectURL(currentBlobUrl.current);
                currentBlobUrl.current = null;
            }
        } finally {
            setIsDownloadingMedia(false);
        }
    };

    // --- FUNÇÃO PARA FECHAR O MODAL E LIMPAR URL (Sem alterações, mas essencial) ---
    const closeModal = () => {
        setIsModalOpen(false);
        setModalMedia(null);
        // Revoga a URL do Blob para liberar memória quando o modal fecha
        if (currentBlobUrl.current) {
            URL.revokeObjectURL(currentBlobUrl.current);
            currentBlobUrl.current = null;
        }
    };

    // --- NOVA FUNÇÃO (Adicione esta função) ---
    const handleDownloadDocument = async (mediaId, filename) => {
        if (!selectedAtendimento || isDownloadingMedia) {
            console.log("handleDownloadDocument blocked: No selection or already downloading.");
            return;
        }

        setIsDownloadingMedia(true);
        console.log(`[handleDownloadDocument] Iniciando download para mediaId: ${mediaId}`);

        // URL relativa ao baseURL do Axios (sem /api/v1)
        const backendMediaUrl = `/atendimentos/${selectedAtendimento.id}/media/${mediaId}`;

        try {
            // AQUI ESTÁ A MÁGICA:
            // Usamos 'api.get', que o seu interceptor vai adicionar o Token.
            const response = await api.get(backendMediaUrl, {
                responseType: 'blob', // Essencial para baixar o arquivo
                timeout: 60000
            });

            const blob = response.data;
            const blobUrl = URL.createObjectURL(blob);

            // Cria um link temporário em memória para forçar o download
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = filename || 'documento'; // Usa o nome do arquivo
            document.body.appendChild(link);
            link.click();

            // Limpa o link e o blobUrl da memória
            document.body.removeChild(link);
            URL.revokeObjectURL(blobUrl);

        } catch (error) {
            console.error("[handleDownloadDocument] Erro durante a requisição Axios:", error);
            // Verifica se o erro foi "Not authenticated" (embora o interceptor deva redirecionar)
            if (error.response && error.response.status === 401) {
                alert("Sua sessão expirou. Você será redirecionado para o login.");
                // O interceptor já deve ter iniciado o redirect, mas garantimos
                window.location.href = '/login';
            } else {
                alert("Não foi possível baixar o documento.");
            }
        } finally {
            setIsDownloadingMedia(false);
        }
    };

    // --- USEEFFECT DE LIMPEZA (Sem alterações, mas essencial) ---
    // Limpa a URL do blob se o componente for desmontado com o modal aberto
    useEffect(() => {
        return () => {
            if (currentBlobUrl.current) {
                URL.revokeObjectURL(currentBlobUrl.current);
            }
        };
    }, []); // Array vazio garante que rode só na montagem/desmontagem



    const addOptimisticMessage = (atendimentoId, msg) => {
        setAtendimentos(prev =>
            prev.map(at => {
                if (at.id === atendimentoId) {
                    const conversa = JSON.parse(at.conversa || '[]');
                    conversa.push(msg);
                    // Atualiza o 'updated_at' para reordenar a lista de contatos
                    const updatedAt = { ...at, conversa: JSON.stringify(conversa), updated_at: new Date().toISOString() };

                    // Se for o mensagem selecionado, atualiza a tela principal
                    if (selectedAtendimento?.id === atendimentoId) {
                        setSelectedAtendimento(updatedAt);
                    }
                    return updatedAt;
                }
                return at;
            })
        );
    };

    const updateAtendimentoState = (atendimentoId, updatedAtendimento) => {
        setAtendimentos(prev =>
            prev.map(at => (at.id === atendimentoId ? updatedAtendimento : at))
        );
        if (selectedAtendimento?.id === atendimentoId) {
            setSelectedAtendimento(updatedAtendimento);
        }
    }

    const setMessageToError = (atendimentoId, optimisticId, errorMessage) => {
        setAtendimentos(prev =>
            prev.map(at => {
                if (at.id === atendimentoId) {
                    const conversa = JSON.parse(at.conversa || '[]');
                    const updatedConversa = conversa.map(msg =>
                        msg.id === optimisticId
                            ? { ...msg, type: 'error', status: 'error', content: errorMessage } // Atualiza a mensagem 'sending' para 'error'
                            : msg
                    );
                    const revertedAt = { ...at, conversa: JSON.stringify(updatedConversa) };

                    if (selectedAtendimento?.id === atendimentoId) {
                        setSelectedAtendimento(revertedAt);
                    }
                    return revertedAt;
                }
                return at;
            })
        );
    }


    // --- ADICIONE ESTE NOVO useEffect (PROCESSADOR DA FILA) ---
    useEffect(() => {
        // Itera sobre todas as filas de mensagem
        Object.keys(sendingQueue).forEach(atendimentoId_str => {
            const atendimentoId = parseInt(atendimentoId_str, 10);
            const queue = sendingQueue[atendimentoId] || [];
            const isQueueBusy = isProcessing[atendimentoId];

            // Se esta fila tem itens e NÃO está ocupada processando
            if (queue.length > 0 && !isQueueBusy) {

                // 1. Marca a fila como "ocupada"
                setIsProcessing(prev => ({ ...prev, [atendimentoId]: true }));

                // 2. Pega o primeiro item da fila
                const itemToProcess = queue[0];

                // 3. Define a função de processamento assíncrona
                const processItem = async () => {
                    let localUrlToRevoke = null; // Guarda a URL do blob para limpar no final

                    try {
                        let responseAtendimento;

                        if (itemToProcess.type === 'text') {
                            // --- Lógica de envio de TEXTO (movida para cá) ---
                            responseAtendimento = await api.post(
                                `/atendimentos/${atendimentoId}/send_message`,
                                itemToProcess.payload // payload é { text: '...' }
                            );

                        } else if (itemToProcess.type === 'media') {
                            // --- Lógica de envio de MÍDIA (movida para cá) ---
                            const { file, mediaType, filename, localUrl } = itemToProcess.payload;
                            localUrlToRevoke = localUrl; // Marca para revogar

                            const formData = new FormData();
                            formData.append('file', file, filename);
                            formData.append('type', mediaType);

                            responseAtendimento = await api.post(
                                `/atendimentos/${atendimentoId}/send_media`,
                                formData,
                                { headers: { 'Content-Type': 'multipart/form-data' } }
                            );
                        }

                        // 4. SUCESSO: Atualiza o estado com a resposta final da API
                        // (A API retorna o 'mensagem' completo e atualizado)
                        updateAtendimentoState(atendimentoId, responseAtendimento.data);

                    } catch (error) {
                        // 5. FALHA: Atualiza a mensagem otimista para um estado de erro
                        console.error(`Falha ao enviar item da fila (ID: ${itemToProcess.id}):`, error);
                        const errorMsg = error.response?.data?.detail || `Falha ao enviar ${itemToProcess.type}.`;
                        setMessageToError(atendimentoId, itemToProcess.id, errorMsg);

                    } finally {
                        // 6. LIMPEZA: Independentemente de sucesso ou falha

                        // Revoga a URL do Blob da mídia (se houver)
                        if (localUrlToRevoke) {
                            URL.revokeObjectURL(localUrlToRevoke);
                        }

                        // Remove o item processado da fila
                        setSendingQueue(prev => {
                            const newQueue = (prev[atendimentoId] || []).slice(1);
                            return { ...prev, [atendimentoId]: newQueue };
                        });

                        // Marca a fila como "livre"
                        setIsProcessing(prev => ({ ...prev, [atendimentoId]: false }));
                    }
                };

                // 7. Executa o processamento
                processItem();
            }
        });
    }, [sendingQueue, isProcessing]); // Dependências do processador


    // --- SUBSTITUA A FUNÇÃO 'handleSendMessage' ---
    /**
     * Ação: Enfileirar Mensagem de TEXTO.
     * (Chamada pelo ChatFooter)
     */
    const handleSendMessage = (text) => {
        if (!selectedAtendimento) return;
        const atendimentoId = selectedAtendimento.id;
        const optimisticId = `local-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

        // 1. Cria a mensagem otimista (agora com tipo 'sending')
        const optimisticMessage = {
            id: optimisticId,
            role: 'assistant',
            type: 'sending', // <-- MODIFICADO
            content: text, // O texto é usado como 'content'
            timestamp: Math.floor(Date.now() / 1000)
        };

        // 2. Adiciona a mensagem otimista à UI
        addOptimisticMessage(atendimentoId, optimisticMessage);

        // 3. Adiciona o item à fila de envio
        const queueItem = {
            id: optimisticId,
            type: 'text',
            payload: { text } // Payload que a API espera
        };

        setSendingQueue(prev => ({
            ...prev,
            [atendimentoId]: [...(prev[atendimentoId] || []), queueItem]
        }));
    };


    // --- SUBSTITUA A FUNÇÃO 'handleSendMedia' ---
    // Ação: Enfileirar Mensagem de MÍDIA. (Chamada pelo ChatFooter)
    const handleSendMedia = (file, type, filename) => {
        if (!selectedAtendimento) return;
        const atendimentoId = selectedAtendimento.id;

        const optimisticId = `local-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const localUrl = URL.createObjectURL(file); // URL local para preview

        // 1. Cria a mensagem otimista (tipo 'sending')
        const optimisticMessage = {
            id: optimisticId,
            role: 'assistant',
            type: 'sending',
            content: `Enviando ${type}...`,
            localUrl: localUrl,
            filename: filename,
            timestamp: Math.floor(Date.now() / 1000)
        };

        // 2. Adiciona a mensagem otimista à UI
        addOptimisticMessage(atendimentoId, optimisticMessage);

        // 3. Adiciona o item à fila de envio
        const queueItem = {
            id: optimisticId,
            type: 'media',
            payload: { file, mediaType: type, filename, localUrl } // Payload completo
        };

        setSendingQueue(prev => ({
            ...prev,
            [atendimentoId]: [...(prev[atendimentoId] || []), queueItem]
        }));

        // NOTA: A revogação do localUrl (URL.revokeObjectURL) agora é feita
        // pelo processador da fila (useEffect) no 'finally' block.
    };


    // SUBSTITUA a função 'handleUpdateStatus' por esta:
    const handleUpdateAtendimento = async (atendimentoId, updatePayload) => {
        // updatePayload é um objeto, ex: { status: 'Concluído' } 
        // ou { conversa: '[...]' }

        const originalAtendimentos = [...mensagens];

        // Atualização Otimista
        const updateState = (prev) => prev.map(at => {
            if (at.id === atendimentoId) {
                // Mescla o estado antigo com o payload de atualização
                const updatedAt = {
                    ...at,
                    ...updatePayload,
                    updated_at: new Date().toISOString()
                };

                if (selectedAtendimento?.id === atendimentoId) {
                    setSelectedAtendimento(updatedAt);
                }
                return updatedAt;
            }
            return at;
        });

        setAtendimentos(updateState);
        // Não é necessário chamar setFilteredAtendimentos aqui, 
        // o useEffect[mensagens] cuidará disso.

        try {
            // Chama a API com o payload genérico
            const response = await api.put(`/atendimentos/${atendimentoId}`, updatePayload);

            // Atualiza com dados do servidor (garante consistência)
            const updateWithServerData = (prev) => prev.map(at => (at.id === atendimentoId ? response.data : at));
            setAtendimentos(updateWithServerData);

            if (selectedAtendimento?.id === atendimentoId) {
                setSelectedAtendimento(response.data);
            }
        } catch (err) {
            console.error("Erro ao salvar edição:", err);
            alert('Erro ao guardar as alterações. A interface será revertida.');
            setAtendimentos(originalAtendimentos); // Reverte
        }
    };

    // --- NOVA FUNÇÃO: Enviar mensagem de template ---
    const handleSendTemplate = async (templatePayload) => {
        if (!selectedAtendimento) {
            throw new Error("Nenhum atendimento selecionado.");
        }
        const atendimentoId = selectedAtendimento.id;

        // A API de template já adiciona a mensagem ao histórico no backend
        // e retorna o atendimento atualizado.
        // A chamada `updateAtendimentoState` irá atualizar a UI com a resposta.
        try {
            const response = await api.post(
                `/atendimentos/${atendimentoId}/send_template`,
                templatePayload
            );
            updateAtendimentoState(atendimentoId, response.data);
        } catch (err) {
            console.error("Erro no handleSendTemplate:", err);
            throw err; // Re-lança o erro para o modal poder exibi-lo
        }
    };

    // --- NOVO: Função para carregar mais atendimentos ---
    const handleLoadMore = () => {
        // Ativa o estado de loading imediatamente
        setIsFetchingMore(true);
        // Aumenta o limite e o useEffect de fetchData/polling vai pegar a mudança
        setLimit(prevLimit => prevLimit + 20);
    };

    if (isLoading && !currentUser) {
        return <div className="flex h-screen items-center justify-center text-gray-600">A carregar interface de mensagens...</div>;
    }

    if (error) {
        return <div className="flex h-screen items-center justify-center text-red-600 p-10">{error}</div>;
    }

    return (
        <div className="flex h-[93vh] bg-white">
            <aside className="w-full md:w-[30%] lg:w-[25%] flex flex-col border-r border-gray-200 min-h-0">
                <SearchAndFilter
                    searchTerm={searchTerm}
                    setSearchTerm={setSearchTerm}
                    activeFilter={activeFilter}
                    setActiveFilter={setActiveFilter}
                    statusOptions={statusOptions}
                    getTextColorForBackground={getTextColorForBackground}
                />
                <nav className="flex-1 overflow-y-auto">
                    {filteredAtendimentos.length > 0 ? (
                        filteredAtendimentos.map((at) => (
                            <ContactItem
                                key={at.id}
                                mensagem={at}
                                isSelected={selectedAtendimento?.id === at.id}
                                onSelect={setSelectedAtendimento}
                                statusOptions={statusOptions}
                                onUpdateStatus={handleUpdateAtendimento}
                            />
                        ))
                    ) : (
                        <p className="text-center text-gray-500 p-6">
                            Nenhum mensagem encontrado para este filtro.
                        </p>
                    )}
                    {/* --- Lógica do botão "Carregar Mais" --- */}
                    {filteredAtendimentos.length > 0 && filteredAtendimentos.length < totalAtendimentos && (
                        <div className="p-3 text-center border-t border-gray-200">
                            <button
                                onClick={handleLoadMore}
                                className="w-full px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-wait flex items-center justify-center gap-2"
                                disabled={isFetchingMore}
                            >
                                {isFetchingMore ? (
                                    <>
                                        <Loader2 size={16} className="animate-spin" />
                                        A carregar...
                                    </>
                                ) : `Carregar Mais (${filteredAtendimentos.length}/${totalAtendimentos})`
                                }
                            </button>
                        </div>
                    )}
                </nav>
            </aside>

            <main className="flex-1 flex flex-col min-h-0">
                {selectedAtendimento ? (
                    <>
                        <ChatBody
                            mensagem={selectedAtendimento}
                            onViewMedia={handleViewMedia}
                            onDownloadDocument={handleDownloadDocument}
                            isDownloadingMedia={isDownloadingMedia}
                        />
                        <ChatFooter
                            onSendMessage={handleSendMessage}
                            onSendMedia={handleSendMedia} // Passa a nova função
                            onOpenTemplateModal={() => setIsTemplateModalOpen(true)} // Passa a função para abrir o modal
                        />
                    </>
                ) : (
                    <ChatPlaceholder />
                )}
            </main>

            {/* Renderiza o Modal */}
            <MediaModal
                isOpen={isModalOpen}
                onClose={closeModal} // Usa a função de fechar que limpa a URL
                mediaUrl={modalMedia?.url}
                mediaType={modalMedia?.type}
                filename={modalMedia?.filename}
            />

            {/* --- NOVO: Renderiza o Modal de Template --- */}
            <TemplateModal
                isOpen={isTemplateModalOpen}
                onClose={() => setIsTemplateModalOpen(false)}
                onSend={handleSendTemplate}
                atendimento={selectedAtendimento}
            />

        </div>
    );
}

export default Mensagens;