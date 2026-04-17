import React, { useRef, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Check, CheckCheck, AlertCircle, Clock, MessageSquare, Wand2, Loader2, Sparkles, Navigation } from 'lucide-react';
import toast from 'react-hot-toast';
import MessageContent from './MessageContent';

// --- Componente: Corpo da Conversa (Mensagens) ---
const ChatBody = ({ mensagem, onViewMedia, onDownloadDocument, isDownloadingMedia }) => {
    const chatContainerRef = useRef(null);
    const [messages, setMessages] = useState([]);

    // --- NOVO: Ref para guardar o ID do mensagem anterior ---
    const prevAtendimentoIdRef = useRef(null);
    // --- NOVO: Ref para saber se o usuário estava no final do scroll antes da atualização ---
    const userWasAtBottomRef = useRef(true);
    const [highlightedMessageId, setHighlightedMessageId] = useState(null);

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

    const handleScrollToMessage = (targetId) => {
        if (!targetId) return;
        const element = document.getElementById(`msg-${targetId}`);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setHighlightedMessageId(targetId);
            setTimeout(() => setHighlightedMessageId(null), 2000);
        } else {
            toast.error("Mensagem original não encontrada nesta conversa.");
        }
    };

    return (
        <div
            ref={chatContainerRef}
            className="flex-1 p-4 md:p-6 overflow-y-auto space-y-6 custom-scrollbar bg-slate-50/20"
        >
            {messages.map((msg, index) => {
                const isAssistant = msg.role === 'assistant';
                const nextMsg = messages[index + 1];
                const isLastInGroup = !nextMsg || nextMsg.role !== msg.role;

                return (
                    <div
                        key={msg.id}
                        className={`flex flex-col transition-all duration-500 ${isAssistant ? 'items-end' : 'items-start'} ${isLastInGroup ? 'mb-4' : 'mb-1'}`}
                    >
                        <div
                            id={`msg-${msg.id}`}
                            className={`relative max-w-[85%] md:max-w-[70%] transition-all duration-300 ${isAssistant ? 'chat-bubble-user' : 'chat-bubble-ia shadow-sm border border-white/40'
                                } ${highlightedMessageId === msg.id ? 'highlight-message' : ''}`}
                        >
                            {msg.is_template && (
                                <div className={`text-[10px] font-black uppercase tracking-widest mb-3 flex items-center gap-2 pb-2 border-b ${isAssistant ? 'border-white/20 text-white/80' : 'border-slate-100 text-blue-600'}`}>
                                    <Sparkles size={12} /> Template Inteligente
                                </div>
                            )}

                            <MessageContent
                                msg={msg}
                                atendimentoId={mensagem.id}
                                onViewMedia={onViewMedia}
                                onDownloadDocument={onDownloadDocument}
                                isDownloading={isDownloadingMedia}
                                onQuotedClick={handleScrollToMessage}
                            />

                            <div className={`flex items-center gap-2 mt-3 ${isAssistant ? 'justify-end text-white/60' : 'justify-start text-slate-400'}`}>
                                {msg.is_ai && (
                                    <span className={`text-[9px] font-black uppercase flex items-center gap-1 ${isAssistant ? 'text-white/80' : 'text-blue-500'}`}>
                                        <Wand2 size={10} /> IA
                                    </span>
                                )}
                                <span className="text-[10px] font-bold uppercase tracking-tight">{formatTimestamp(msg.timestamp)}</span>
                                {isAssistant && (
                                    <div className="flex items-center">
                                        {msg.type === 'sending' && <Loader2 size={12} className="animate-spin" />}
                                        {msg.status === 'sent' && <Check size={14} />}
                                        {msg.status === 'delivered' && <CheckCheck size={14} />}
                                        {msg.status === 'read' && <CheckCheck size={16} className="text-cyan-300 drop-shadow-[0_0_2px_rgba(0,0,0,0.5)]" />}
                                        {msg.status === 'failed' && <AlertCircle size={14} className="text-red-300" title={msg.error_title || "Falha no envio"} />}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })}
            {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full opacity-40">
                    <div className="w-20 h-20 rounded-[2rem] bg-slate-100 flex items-center justify-center mb-4">
                        <MessageSquare size={32} className="text-slate-300" />
                    </div>
                    <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                        Início da Transmissão
                    </p>
                </div>
            )}
        </div>
    );
};

export default ChatBody;