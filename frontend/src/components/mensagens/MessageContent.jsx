import React from 'react';
import { AlertTriangle, Download, Loader2, FileText, AlertCircle } from 'lucide-react';

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
    const effectiveMediaId = msg.media_id || msg.message_id || msg.id;
    const hasMedia = !!effectiveMediaId && ['image', 'audio', 'document', 'video'].includes(type);
    let displayText = msg.content;

    // Extrai especificamente a transcrição se for mensagem de áudio
    let audioTranscription = null;
    if (type === 'audio' && msg.content) {
        let rawAudio = (msg.content || '').trim();
        // Remove qualquer prefixo de Mensagem Referenciada antes de procurar a transcrição
        if (rawAudio.includes('[Mensagem Referenciada]:')) {
            rawAudio = rawAudio.replace(/^\[Mensagem Referenciada\]:\s*"[\s\S]*?"\r?\n?/, '').trim();
        }

        const audioMatch = rawAudio.match(/\[(?:Áudio|Audio)\s+Transcrito\]:\s*([\s\S]*)$/i);
        if (audioMatch) {
            audioTranscription = audioMatch[1].trim();
        } else if (
            !rawAudio.startsWith('[') &&
            !rawAudio.toLowerCase().startsWith('áudio') &&
            !rawAudio.toLowerCase().startsWith('audio') &&
            rawAudio !== (msg.filename || '') &&
            !rawAudio.toLowerCase().includes('falha na análise')
        ) {
            audioTranscription = rawAudio;
        }
    }

    if (hasMedia && !msg.is_template) {
        const raw = (displayText || '').trim();
        const fname = (msg.filename || '').trim();
        const cap = (msg.caption || '').trim();

        if (
            !raw ||
            raw === fname ||
            raw === cap ||
            raw.startsWith('[') ||
            raw.toLowerCase().includes('enviado:') ||
            raw.toLowerCase().includes('enviado') ||
            (fname && raw.toLowerCase() === fname.toLowerCase())
        ) {
            displayText = null;
        }
    }

    // Oculta descrições geradas pela IA e mensagens de tipos não suportados
    if (displayText && (
        displayText.startsWith('[Imagem/Doc Transcrito]:') ||
        displayText.startsWith('[Transcrição da Imagem Enviada pela IA]:') ||
        /^\[(?:Imagem|Doc|Documento|Vídeo|Video|Mídia|Midia).+Transcrito\]/i.test(displayText) ||
        /^\[Mensagem tipo .* não suportada\]/i.test(displayText)
    )) {
        displayText = null;
    }

    const renderQuotedMsg = () => {
        let quoted = msg.quoted_msg;
        let content = msg.content || '';

        // SEMPRE tenta extrair do texto caso o objeto estruturado não exista ou para limpar
        if (content.includes('[Mensagem Referenciada]:')) {
            const regex = /\[Mensagem Referenciada\]:\s*"([\s\S]*?)"\r?\n?([\s\S]*)/;
            const match = content.match(regex);
            if (match) {
                if (!quoted) {
                    quoted = { content: match[1], id: msg.quoted_msg_id };
                }
                if (type !== 'audio') {
                    displayText = match[2].trim();
                }
            }
        }

        if (!quoted) return null;

        const isQuotedAssistant = quoted.role === 'assistant';
        const senderName = isQuotedAssistant ? 'Você' : 'Cliente';
        const targetId = quoted.id || quoted.message_id || msg.quoted_msg_id;

        return (
            <div
                onClick={() => onQuotedClick && targetId && onQuotedClick(targetId)}
                className={`mb-3 p-3 rounded-xl border-l-4 flex flex-col gap-1 overflow-hidden select-none transition-all ${targetId ? 'cursor-pointer hover:brightness-110 active:scale-[0.98]' : ''
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
                    {formatWhatsAppText(quoted.content || quoted.caption || (quoted.filename ? `[Arquivo: ${quoted.filename}]` : '[Mensagem referenciada]'))}
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
                            mediaId={effectiveMediaId}
                            transcription={audioTranscription}
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
                            mediaId={effectiveMediaId}
                            caption={msg.caption || null}
                            filename={msg.filename || null}
                        />
                        {displayText && (
                            <p className={`text-[13px] leading-relaxed font-medium mt-2 ${isAssistant ? 'text-white' : 'text-slate-700'}`}>
                                {formatWhatsAppText(displayText)}
                            </p>
                        )}
                    </div>
                );

            case 'video':
                return (
                    <div className="flex flex-col">
                        {quotedView}
                        <VideoDisplayer
                            atendimentoId={atendimentoId}
                            mediaId={effectiveMediaId}
                            caption={msg.caption || null}
                            filename={msg.filename || null}
                        />
                        {displayText && (
                            <p className={`text-[13px] leading-relaxed font-medium mt-2 ${isAssistant ? 'text-white' : 'text-slate-700'}`}>
                                {formatWhatsAppText(displayText)}
                            </p>
                        )}
                    </div>
                );

            case 'document':
                return (
                    <div className="flex flex-col space-y-2">
                        {quotedView}
                        <div className={`flex items-center gap-3.5 p-3 rounded-2xl transition-all border min-w-[220px] max-w-[320px] ${isAssistant
                            ? 'bg-white/15 border-white/20 hover:bg-white/20'
                            : 'bg-slate-50 border-slate-200/80 hover:bg-white hover:shadow-sm'
                            }`}>
                            <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${isAssistant ? 'bg-white/20 text-white' : 'bg-blue-600 text-white shadow-sm'
                                }`}>
                                <FileText size={22} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className={`text-[13px] font-bold truncate mb-0.5 ${isAssistant ? 'text-white' : 'text-slate-800'}`} title={msg.filename}>
                                    {msg.filename || 'Documento'}
                                </p>
                                <p className={`text-[10px] font-semibold uppercase tracking-wider ${isAssistant ? 'text-white/70' : 'text-slate-400'}`}>
                                    {msg.mime_type ? msg.mime_type.split('/')[1]?.toUpperCase() : 'ARQUIVO'}
                                </p>
                            </div>

                            {hasMedia && (
                                <button
                                    type="button"
                                    onClick={() => onDownloadDocument(effectiveMediaId, msg.filename)}
                                    disabled={isDownloading}
                                    className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${isAssistant
                                        ? 'bg-white/20 text-white hover:bg-white/30'
                                        : 'bg-white text-slate-500 hover:text-blue-600 shadow-sm border border-slate-200'
                                        } ${isDownloading ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    title="Baixar arquivo"
                                >
                                    {isDownloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                                </button>
                            )}
                        </div>
                        {msg.caption && (
                            <p className={`text-[13px] leading-relaxed font-medium mt-1 ${isAssistant ? 'text-white' : 'text-slate-700'}`}>
                                {formatWhatsAppText(msg.caption)}
                            </p>
                        )}
                        {displayText && (
                            <p className={`text-[13px] leading-relaxed font-medium mt-1 ${isAssistant ? 'text-white' : 'text-slate-700'}`}>
                                {formatWhatsAppText(displayText)}
                            </p>
                        )}
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
                const hasContent = !!defaultText && defaultText.trim().length > 0;
                if (!hasContent && !quotedView) return null;
                return (
                    <div className="flex flex-col">
                        {quotedView}
                        {hasContent && (
                            <p className={`text-[15px] leading-relaxed font-medium ${isAssistant ? 'text-white' : 'text-slate-700'}`}>
                                {formatWhatsAppText(defaultText)}
                            </p>
                        )}
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