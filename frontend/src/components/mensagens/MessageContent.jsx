import React from 'react';
import { AlertTriangle, Download, Loader2, FileText } from 'lucide-react';

// Importa o novo componente de áudio
import AudioPlayer from './AudioPlayer';
import ImageDisplayer from './ImageDisplayer';
import VideoDisplayer from './VideoDisplayer';
import { formatWhatsAppText } from '../../utils/formatters';

const MessageContent = ({ msg, atendimentoId, onViewMedia, onDownloadDocument, isDownloading, onQuotedClick }) => {
    const isAssistant = msg.role === 'assistant';

    if (msg.status === 'failed' || msg.status === 'error' || msg.type === 'error') {
        let errorMessage = 'Falha no envio';
        if (msg.error_title) {
            errorMessage = msg.error_title;
        } else if (msg.content) {
            errorMessage = msg.content;
        }

        const errorCode = msg.error_code ? ` (Cód: ${msg.error_code})` : '';

        return (
            <div className={`flex items-start gap-3 p-4 rounded-2xl ${isAssistant ? 'bg-red-500/10 text-red-200' : 'bg-red-50 text-red-600'}`}>
                <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
                <div className="flex flex-col">
                    <span className="text-[13px] font-bold executive-title uppercase tracking-wider">
                        {errorMessage}{errorCode}
                    </span>
                    {msg.type !== 'error' && msg.content && (
                        <p className={`text-[11px] mt-1 opacity-80 italic`}>"{msg.content}"</p>
                    )}
                </div>
            </div>
        );
    }

    const type = msg.type || 'text';
    const hasMedia = msg.media_id && ['image', 'audio', 'document', 'video'].includes(type);
    let displayText = msg.content;

    if (hasMedia && !msg.is_template) {
        if (!displayText || (displayText.startsWith('[') && displayText.toLowerCase().includes('enviado'))) {
            displayText = null;
        }
    }

    const renderQuotedMsg = () => {
        let quoted = msg.quoted_msg;
        let content = msg.content || '';

        // SEMPRE tenta limpar o prefixo do displayText para evitar exibição duplicada
        if (content.startsWith('[Mensagem Referenciada]:')) {
            const regex = /\[Mensagem Referenciada\]: "(.*)"\n?([\s\S]*)/;
            const match = content.match(regex);
            if (match) {
                // Se não tínhamos o objeto estruturado, usamos o que extraímos do texto
                if (!quoted) {
                    quoted = { content: match[1] };
                }
                // Atualiza o texto principal para remover o prefixo em qualquer caso
                displayText = match[2].trim();
            }
        }

        if (!quoted) return null;

        const isQuotedAssistant = quoted.role === 'assistant';
        const senderName = isQuotedAssistant ? 'Você' : 'Cliente';

        return (
            <div 
                onClick={() => onQuotedClick && quoted.id && onQuotedClick(quoted.id)}
                className={`mb-3 p-3 rounded-xl border-l-4 flex flex-col gap-1 overflow-hidden select-none transition-all ${
                    quoted.id ? 'cursor-pointer hover:brightness-110 active:scale-[0.98]' : ''
                } ${isAssistant
                ? 'bg-black/20 border-white/40'
                : 'bg-slate-100/80 border-blue-500'
                }`}
            >
                <span className={`text-[11px] font-black uppercase tracking-wider ${isAssistant ? 'text-white/90' : 'text-blue-600'
                    }`}>
                    {senderName}
                </span>
                <p className={`text-[12px] line-clamp-2 leading-snug italic opacity-80 ${isAssistant ? 'text-white' : 'text-slate-600'
                    }`}>
                    {formatWhatsAppText(quoted.content)}
                </p>
            </div>
        );
    };

    const renderMediaOrText = () => {
        // Renderizamos a citação no topo de qualquer tipo de mensagem
        const quotedView = renderQuotedMsg();

        switch (type) {
            case 'audio':
                return (
                    <div className="flex flex-col">
                        {quotedView}
                        <AudioPlayer
                            atendimentoId={atendimentoId}
                            mediaId={msg.media_id}
                            transcription={displayText}
                            isAssistant={isAssistant}
                        />
                    </div>
                );

            case 'image':
                return (
                    <div className="flex flex-col">
                        {quotedView}
                        <ImageDisplayer
                            atendimentoId={atendimentoId}
                            mediaId={msg.media_id}
                            caption={msg.caption || null}
                        />
                    </div>
                );

            case 'video':
                return (
                    <div className="flex flex-col">
                        {quotedView}
                        <VideoDisplayer
                            atendimentoId={atendimentoId}
                            mediaId={msg.media_id}
                            caption={msg.caption || null}
                        />
                    </div>
                );

            case 'document':
                return (
                    <div className="flex flex-col space-y-3">
                        {quotedView}
                        <div className={`flex items-center gap-4 p-4 rounded-2xl transition-all border ${isAssistant
                            ? 'bg-white/10 border-white/20 hover:bg-white/20'
                            : 'bg-slate-50 border-slate-100 hover:bg-white hover:shadow-lg hover:shadow-slate-200/50'
                            }`}>
                            <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${isAssistant ? 'bg-white/20 text-white' : 'bg-blue-600 text-white shadow-lg shadow-blue-100'
                                }`}>
                                <FileText size={24} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className={`text-[13px] font-black executive-title truncate mb-0.5 ${isAssistant ? 'text-white' : 'text-slate-900'}`} title={msg.filename}>
                                    {msg.filename || 'Documento Central'}
                                </p>
                                <p className={`text-[10px] font-bold uppercase tracking-widest ${isAssistant ? 'text-white/60' : 'text-slate-400'}`}>
                                    {msg.mime_type ? msg.mime_type.split('/')[1] : 'ARQUIVO'}
                                </p>
                            </div>

                            {hasMedia && (
                                <button
                                    type="button"
                                    onClick={() => onDownloadDocument(msg.media_id, msg.filename)}
                                    disabled={isDownloading}
                                    className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${isAssistant
                                        ? 'bg-white/20 text-white hover:bg-white'
                                        : 'bg-white text-slate-400 hover:text-blue-600 shadow-sm border border-slate-100'
                                        } ${isDownloading ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    {isDownloading ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                                </button>
                            )}
                        </div>
                    </div>
                );

            case 'sending':
                return (
                    <div className="flex flex-col">
                        {quotedView}
                        <div className="flex items-center gap-3 py-2">
                            <Loader2 size={16} className="animate-spin text-white/60" />
                            <span className="text-[12px] font-bold uppercase tracking-widest text-white/50">Enviando...</span>
                        </div>
                    </div>
                );

            case 'text':
            default:
                const defaultText = displayText || (msg.media_id ? `[Mídia não suportada: ${type}]` : '');
                return (
                    <div className="flex flex-col">
                        {quotedView}
                        <p className={`text-[15px] leading-relaxed font-medium ${isAssistant ? 'text-white' : 'text-slate-700'}`}>
                            {formatWhatsAppText(defaultText) || '[Vazio]'}
                        </p>
                    </div>
                );
        }
    };

    return (
        <div className="flex flex-col w-full">
            {renderMediaOrText()}

            {msg.buttons && msg.buttons.length > 0 && (
                <div className={`mt-5 flex flex-col gap-2`}>
                    {msg.buttons.map((btnText, idx) => (
                        <div key={idx} className={`w-full p-4 text-[11px] font-black uppercase tracking-widest text-center rounded-2xl border transition-all cursor-pointer ${isAssistant
                            ? 'bg-white/10 border-white/20 text-white hover:bg-white/20'
                            : 'bg-slate-50 border-slate-100 text-slate-600 hover:bg-white hover:shadow-lg hover:text-blue-600'
                            }`}>
                            {btnText}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default MessageContent;