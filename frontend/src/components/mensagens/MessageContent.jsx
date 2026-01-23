import React from 'react';
import { AlertTriangle, Download, Loader2, FileText } from 'lucide-react';

// Importa o novo componente de áudio
import AudioPlayer from './AudioPlayer';
import ImageDisplayer from './ImageDisplayer';
import VideoDisplayer from './VideoDisplayer';

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
    let displayText = msg.content || (hasMedia ? `[${type === 'image' ? 'Imagem' : type === 'audio' ? 'Áudio' : type === 'video' ? 'Vídeo' : 'Documento'}${msg.filename ? `: ${msg.filename}` : ''}]` : ''); // <-- 2. ADICIONADO 'video'

    if (['image', 'video'].includes(type)) {
        displayText = null;
    }

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
                <div className="space-y-2">
                    {/* Card do Documento */}
                    <div className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-lg max-w-sm hover:bg-gray-100 transition-colors">
                        <div className="bg-blue-100 p-2 rounded-full text-blue-600 flex-shrink-0">
                            <FileText size={20} />
                        </div>
                        <div className="flex-1 min-w-0 overflow-hidden">
                            <p className="text-sm font-medium text-gray-900 truncate" title={msg.filename}>
                                {msg.filename || 'Documento'}
                            </p>
                            <p className="text-xs text-gray-500 uppercase">
                                {msg.mime_type ? msg.mime_type.split('/')[1] : 'ARQUIVO'}
                            </p>
                        </div>
                        
                        {hasMedia && (
                            <button
                                type="button"
                                onClick={() => onDownloadDocument(msg.media_id, msg.filename)}
                                disabled={isDownloading}
                                className={`p-2 rounded-full text-gray-500 hover:text-blue-600 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 ${isDownloading ? 'opacity-50 cursor-not-allowed' : ''}`}
                                title="Baixar Documento"
                            >
                                {isDownloading ? <Loader2 size={20} className="animate-spin" /> : <Download size={20} />}
                            </button>
                        )}
                    </div>
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

export default MessageContent;