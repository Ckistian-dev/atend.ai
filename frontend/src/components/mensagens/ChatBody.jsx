import React, { useRef, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Check, CheckCheck, AlertCircle, Clock, MessageSquare } from 'lucide-react';
import MessageContent from './MessageContent';

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
            className="flex-1 p-4 md:p-6 overflow-y-auto space-y-3 bg-brand-whatsapp-background"
        >
            {messages.map((msg) => {
                const isAssistant = msg.role === 'assistant';
                return (
                    <div key={msg.id} className={`flex ${isAssistant ? 'justify-end' : 'justify-start'}`}>
                        <div
                            className={`relative max-w-xs md:max-w-md py-2 px-3 rounded-lg shadow-sm break-words flex flex-col ${isAssistant
                                ? (msg.is_template ? 'bg-[#d1f4cc] text-gray-800 border border-green-300' : 'bg-[#d9fdd3] text-gray-800') // Verde WhatsApp
                                : 'bg-white text-gray-800'
                                }`}
                        >
                            {msg.is_template && (
                                <div className="text-[10px] font-bold text-green-700 uppercase mb-1 flex items-center gap-1 border-b border-green-300/50 pb-1">
                                    <MessageSquare size={12} />
                                    Template de Mensagem
                                </div>
                            )}
                            <MessageContent
                                msg={msg}
                                atendimentoId={mensagem.id}
                                onViewMedia={onViewMedia}
                                onDownloadDocument={onDownloadDocument}
                                isDownloading={isDownloadingMedia} // Passa o estado de loading
                            />

                            <div className="text-xs text-gray-400 self-end mt-2 flex items-center gap-1">
                                <span>{formatTimestamp(msg.timestamp)}</span>
                                {isAssistant && (
                                    <span className="flex items-center">
                                        {msg.type === 'sending' && <Clock size={14} className="text-gray-400" />}
                                        {msg.status === 'sent' && <Check size={14} className="text-gray-400" />}
                                        {msg.status === 'delivered' && <CheckCheck size={14} className="text-gray-400" />}
                                        {msg.status === 'read' && <CheckCheck size={14} className="text-brand-primary" />}
                                        {msg.status === 'failed' && <AlertCircle size={14} className="text-red-500" title={msg.error_title || "Falha no envio"} />}
                                    </span>
                                )}
                            </div>
                            <div className="clear-both"></div>
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

export default ChatBody;