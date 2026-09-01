import React, { useRef, useEffect, useState, useCallback } from 'react';
import { format } from 'date-fns';
import { Check, CheckCheck, AlertCircle, Clock, MessageSquare, Wand2, Loader2, Sparkles, ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';
import MessageContent from './MessageContent';

const deduplicateMessages = (msgs) => {
    if (!Array.isArray(msgs) || msgs.length === 0) return [];
    const seenIds = new Set();
    const result = [];

    for (const msg of msgs) {
        if (!msg) continue;
        const msgId = msg.message_id || msg.id;
        
        if (msgId && seenIds.has(String(msgId))) {
            continue;
        }

        // Evita duplicatas com mesmo conteúdo, role e timestamp aproximado
        const isContentDuplicate = result.some(r => 
            r.role === msg.role && 
            (r.content || '') === (msg.content || '') &&
            (r.type || 'text') === (msg.type || 'text') &&
            Math.abs(new Date(r.timestamp || 0).getTime() - new Date(msg.timestamp || 0).getTime()) < 5000
        );

        if (isContentDuplicate) {
            continue;
        }

        if (msgId) seenIds.add(String(msgId));
        result.push(msg);
    }
    return result;
};

// --- Componente: Corpo da Conversa (Mensagens) ---
const ChatBody = ({ mensagem, onViewMedia, onDownloadDocument, isDownloadingMedia }) => {
    const chatContainerRef = useRef(null);
    const messagesEndRef = useRef(null);
    const [messages, setMessages] = useState([]);
    const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false);
    const [highlightedMessageId, setHighlightedMessageId] = useState(null);

    const prevAtendimentoIdRef = useRef(null);
    const prevMessagesCountRef = useRef(0);
    const prevLastMessageKeyRef = useRef(null);
    const isUserNearBottomRef = useRef(true);
    const scrollTimeoutsRef = useRef([]);

    const clearScrollTimeouts = () => {
        scrollTimeoutsRef.current.forEach(t => clearTimeout(t));
        scrollTimeoutsRef.current = [];
    };

    const scrollToBottom = useCallback((behavior = 'auto') => {
        const el = chatContainerRef.current;
        if (el) {
            el.scrollTop = el.scrollHeight;
        }
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior, block: 'end' });
        }
    }, []);

    // Função para disparar múltiplos ticks de scroll garantindo que mesmo após
    // layout reflows, imagens e fontes carregando, o scroll fique 100% no final.
    const triggerMultiTickScroll = useCallback((behavior = 'auto') => {
        clearScrollTimeouts();
        scrollToBottom(behavior);

        if (typeof requestAnimationFrame !== 'undefined') {
            requestAnimationFrame(() => scrollToBottom(behavior));
        }

        const delays = [40, 100, 200, 350, 500];
        delays.forEach(delay => {
            const timeoutId = setTimeout(() => {
                scrollToBottom(behavior);
            }, delay);
            scrollTimeoutsRef.current.push(timeoutId);
        });
    }, [scrollToBottom]);

    // Trata scroll do usuário para detectar se está perto do fundo
    const handleScroll = useCallback(() => {
        const el = chatContainerRef.current;
        if (!el) return;
        const { scrollTop, scrollHeight, clientHeight } = el;
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
        const isNearBottom = distanceFromBottom < 100;
        isUserNearBottomRef.current = isNearBottom;
        setShowScrollBottomBtn(distanceFromBottom > 200);
    }, []);

    // Limpeza de timeouts ao desmontar
    useEffect(() => {
        return () => clearScrollTimeouts();
    }, []);

    // Extrai e atualiza mensagens quando `mensagem` muda
    useEffect(() => {
        let parsedMessages = [];
        try {
            if (mensagem) {
                if (Array.isArray(mensagem.mensagens) && mensagem.mensagens.length > 0) {
                    parsedMessages = mensagem.mensagens;
                } else if (typeof mensagem.conversa === 'string') {
                    parsedMessages = JSON.parse(mensagem.conversa || '[]');
                } else if (Array.isArray(mensagem.conversa)) {
                    parsedMessages = mensagem.conversa;
                }
            }
        } catch (e) {
            console.error("Erro ao analisar mensagens:", e);
        }

        parsedMessages = deduplicateMessages(parsedMessages);
        setMessages(parsedMessages);
    }, [mensagem]);

    // Efeito para rolar quando o atendimento muda ou chegam novas mensagens
    useEffect(() => {
        const currentAtendimentoId = mensagem?.id;
        const prevAtendimentoId = prevAtendimentoIdRef.current;
        const isChatChanged = currentAtendimentoId !== prevAtendimentoId;

        const currentCount = messages.length;
        const prevCount = prevMessagesCountRef.current;

        const lastMsg = currentCount > 0 ? messages[currentCount - 1] : null;
        const lastMsgKey = lastMsg
            ? `${lastMsg.id || lastMsg.message_id || ''}-${lastMsg.timestamp || ''}-${lastMsg.type || ''}-${lastMsg.status || ''}-${lastMsg.content || ''}`
            : null;
        const prevLastMsgKey = prevLastMessageKeyRef.current;

        const hasNewMessages = currentCount > prevCount || (lastMsgKey && lastMsgKey !== prevLastMsgKey && currentCount >= prevCount);

        if (isChatChanged) {
            // Entrou em um atendimento ou trocou de atendimento:
            // SEMPRE começar mostrando a última mensagem
            isUserNearBottomRef.current = true;
            setShowScrollBottomBtn(false);
            triggerMultiTickScroll('auto');
            prevAtendimentoIdRef.current = currentAtendimentoId;
        } else if (hasNewMessages) {
            // Chegaram novas mensagens: rola para a última mensagem
            triggerMultiTickScroll('auto');
        } else if (isUserNearBottomRef.current) {
            // Se já estava no fundo e houve atualização de estado, mantém no fundo
            scrollToBottom('auto');
        }

        prevMessagesCountRef.current = currentCount;
        prevLastMessageKeyRef.current = lastMsgKey;
    }, [messages, mensagem?.id, triggerMultiTickScroll, scrollToBottom]);

    // ResizeObserver para garantir que se o conteúdo crescer (ex: imagens renderizadas ou containers ajustados),
    // se o usuário estiver no fundo, continue mantendo o fundo visível.
    useEffect(() => {
        const el = chatContainerRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;

        const resizeObserver = new ResizeObserver(() => {
            if (isUserNearBottomRef.current) {
                el.scrollTop = el.scrollHeight;
            }
        });

        resizeObserver.observe(el);
        return () => resizeObserver.disconnect();
    }, []);

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
    };

    const handleScrollToMessage = (targetId) => {
        if (!targetId) return;
        const targetStr = String(targetId).trim();

        // 1. Tenta achar o elemento diretamente pelo ID no DOM
        let element = document.getElementById(`msg-${targetStr}`);

        // 2. Se não achar, procura nos atributos data-wamid ou data-msg-id
        if (!element) {
            element = document.querySelector(`[data-wamid="${targetStr}"]`) || document.querySelector(`[data-msg-id="${targetStr}"]`);
        }

        // 3. Se ainda não achar, procura na lista de mensagens em memória
        if (!element && Array.isArray(messages)) {
            const found = messages.find(m =>
                String(m.id) === targetStr ||
                String(m.message_id) === targetStr ||
                (m.message_id && targetStr.includes(String(m.message_id))) ||
                (m.id && targetStr.includes(String(m.id))) ||
                (m.content && m.content.includes(targetStr))
            );
            if (found) {
                element = document.getElementById(`msg-${found.id}`) ||
                    document.querySelector(`[data-wamid="${found.message_id}"]`);
                if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    setHighlightedMessageId(found.id);
                    setTimeout(() => setHighlightedMessageId(null), 2500);
                    return;
                }
            }
        }

        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setHighlightedMessageId(targetStr);
            setTimeout(() => setHighlightedMessageId(null), 2500);
        } else {
            toast.error("Mensagem original não encontrada nesta conversa.");
        }
    };

    return (
        <div className="flex-1 min-h-0 relative flex flex-col overflow-hidden">
            <div
                ref={chatContainerRef}
                onScroll={handleScroll}
                className="flex-1 p-4 md:p-6 overflow-y-auto space-y-6 custom-scrollbar bg-slate-50/20"
            >
                {messages.map((msg, index) => {
                    if (msg.type === 'search' || msg.type === 'unsupported' || msg.type === 'reaction') {
                        return null;
                    }

                    const rawContent = (msg.content || '').trim();
                    const isUnsupportedText = /^\[Mensagem tipo .* não suportada\]/i.test(rawContent);
                    const hasMedia = !!(msg.media_id || ['image', 'audio', 'video', 'document', 'location'].includes(msg.type));
                    const hasInteractive = !!(msg.buttons?.length || msg.quoted_msg);

                    if (!hasMedia && !hasInteractive && (isUnsupportedText || !rawContent)) {
                        return null;
                    }

                    if (msg.role === 'system' || msg.type === 'followup_skipped') {
                        return (
                            <div key={msg.id} className="flex justify-center my-3 animate-fade-in">
                                <div className="flex items-center gap-2 bg-amber-50/60 border border-amber-200/40 rounded-full px-4 py-1.5 shadow-sm backdrop-blur-sm">
                                    <Clock size={12} className="text-amber-500" />
                                    <span className="text-[9px] font-black uppercase tracking-wider text-amber-700">Follow-up Suspenso</span>
                                    <span className="text-slate-300">|</span>
                                    <span className="text-[11px] font-semibold text-slate-600">
                                        {msg.content ? msg.content.replace('Follow-up suspenso: ', '') : ''}
                                    </span>
                                </div>
                            </div>
                        );
                    }

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
                                data-msg-id={msg.id}
                                data-wamid={msg.message_id}
                                className={`relative max-w-[78%] md:max-w-[70%] transition-all duration-300 ${isAssistant ? 'chat-bubble-user' : 'chat-bubble-ia shadow-sm border border-white/40'
                                    } ${highlightedMessageId === msg.id || (highlightedMessageId && String(highlightedMessageId) === String(msg.message_id)) ? 'highlight-message' : ''}`}
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

                                {/* REACTION BADGE (WhatsApp Style) */}
                                {(msg.reaction || (msg.reactions && typeof msg.reactions === 'object' && Object.keys(msg.reactions).length > 0)) && (
                                    <div className={`absolute -bottom-3 ${isAssistant ? 'right-3' : 'left-3'} bg-white border border-slate-200/90 shadow-md shadow-slate-900/10 rounded-full px-2 py-0.5 flex items-center gap-1 text-xs transform hover:scale-110 transition-transform z-10 select-none cursor-default`} title="Reação">
                                        <span>{msg.reaction || Object.values(msg.reactions)[0]}</span>
                                        {msg.reactions && typeof msg.reactions === 'object' && Object.keys(msg.reactions).length > 1 && (
                                            <span className="text-[10px] font-black text-slate-500">{Object.keys(msg.reactions).length}</span>
                                        )}
                                    </div>
                                )}

                                <div className={`flex items-center gap-2 mt-3 ${isAssistant ? 'justify-end text-white/60' : 'justify-start text-slate-400'}`}>
                                    {(msg.is_ai || msg.type === 'followup') && (
                                        <span className={`text-[9px] font-black uppercase flex items-center gap-1 ${isAssistant ? 'text-white/80' : 'text-blue-500'}`}>
                                            <Wand2 size={10} /> IA
                                        </span>
                                    )}
                                    {msg.type === 'followup' && (
                                        <span className={`text-[9px] font-black uppercase flex items-center gap-1 ${isAssistant ? 'text-white/80' : 'text-blue-500'}`}>
                                            <Clock size={10} /> Follow-up
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

                <div ref={messagesEndRef} className="h-0 w-full pointer-events-none" />

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

            {/* FLOATING SCROLL TO BOTTOM BUTTON */}
            {showScrollBottomBtn && (
                <button
                    type="button"
                    onClick={() => triggerMultiTickScroll('smooth')}
                    className="absolute bottom-4 right-4 z-20 px-3.5 py-2 bg-white/95 backdrop-blur-md text-blue-600 rounded-full shadow-lg border border-slate-200/80 hover:bg-blue-600 hover:text-white hover:shadow-xl hover:scale-105 active:scale-95 transition-all flex items-center gap-1.5 text-xs font-bold animate-fade-in"
                    title="Rolar para a última mensagem"
                >
                    <ChevronDown size={16} />
                    <span className="hidden sm:inline">Última mensagem</span>
                </button>
            )}
        </div>
    );
};

export default ChatBody;