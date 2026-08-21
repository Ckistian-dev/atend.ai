import React from 'react';

/**
 * Parses WhatsApp-style formatting (*bold*, _italic_, ~strikethrough~) and newlines.
 * Returns a React element.
 */
export const formatWhatsAppText = (text) => {
    if (!text || typeof text !== 'string') return text;

    // Split text into lines to handle <br />
    const lines = text.split('\n');

    return lines.map((line, lineIndex) => (
        <React.Fragment key={lineIndex}>
            {parseLine(line)}
            {lineIndex < lines.length - 1 && <br />}
        </React.Fragment>
    ));
};

const parseLine = (line) => {
    // Regex for bold (*), italic (_), strikethrough (~)
    // We use a non-greedy matching to find pairs
    // The regex captures the blocks including the delimiters
    const parts = line.split(/(\*.*?\*|_.*?_|~.*?~)/g);

    return parts.map((part, index) => {
        if (!part) return null;

        if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
            return <span key={index} className="font-black tracking-tight">{part.slice(1, -1)}</span>;
        }
        if (part.startsWith('_') && part.endsWith('_') && part.length > 2) {
            return <span key={index} className="italic">{part.slice(1, -1)}</span>;
        }
        if (part.startsWith('~') && part.endsWith('~') && part.length > 2) {
            return <span key={index} className="line-through opacity-70">{part.slice(1, -1)}</span>;
        }
        return part;
    });
};

/**
 * Strips WhatsApp-style formatting characters for plain text display (e.g. previews).
 */
export const stripWhatsAppFormatting = (text) => {
    if (!text || typeof text !== 'string') return text;
    return text.replace(/(\*|_|~)/g, '');
};

/**
 * Formata o preview da última mensagem de forma limpa, elegante e moderna,
 * sem expor tags de sistema como [Imagem], [Áudio Transcrito], etc.
 */
export const formatLastMessagePreview = (lastMsgObj) => {
    if (!lastMsgObj) return 'Nenhum histórico de conversa.';

    const msgType = lastMsgObj.type || 'text';
    let rawContent = (lastMsgObj.content || '').trim();
    let caption = (lastMsgObj.caption || '').trim();

    // 1. Tratamento de Quoted Message / Mensagem Referenciada
    if (rawContent.startsWith('[Mensagem Referenciada]:')) {
        const regex = /^\[Mensagem Referenciada\]:\s*"[\s\S]*?"\r?\n?([\s\S]*)/i;
        const match = rawContent.match(regex);
        if (match && match[1]) {
            rawContent = match[1].trim();
        } else {
            rawContent = rawContent.replace(/^\[Mensagem Referenciada\]:[^\n]*\n?/i, '').trim();
        }
    }

    // 2. Extrai Legenda Original se presente
    if (rawContent.includes('[Legenda Original]:')) {
        const capMatch = rawContent.match(/\[Legenda Original\]:\s*([^\n]+)/i);
        if (capMatch && capMatch[1] && !caption) {
            caption = capMatch[1].trim();
        }
    }

    let preview = '';

    // 3. Casos baseados no tipo ou em tags no conteúdo
    if (msgType === 'audio' || /^\[(Áudio|Audio)\s*Transcrito\]/i.test(rawContent)) {
        let cleanAudioText = rawContent
            .replace(/^\[(Áudio|Audio)\s*Transcrito\]:\s*/i, '')
            .replace(/\n?\[Legenda Original\]:.*$/i, '')
            .trim();
        if (cleanAudioText && !cleanAudioText.startsWith('[Mídia') && !cleanAudioText.startsWith('[Audio') && !cleanAudioText.startsWith('[Áudio')) {
            preview = '🎤 ' + cleanAudioText;
        } else {
            preview = '🎤 Mensagem de áudio';
        }
    } else if (msgType === 'image' || /^\[Imagem(\/Doc)?\s*Transcrito\]/i.test(rawContent)) {
        if (caption) {
            preview = '📷 ' + caption;
        } else {
            preview = '📷 Foto';
        }
    } else if (msgType === 'video') {
        preview = caption ? '🎥 ' + caption : '🎥 Vídeo';
    } else if (msgType === 'document') {
        const name = lastMsgObj.filename || caption;
        preview = name ? '📄 ' + name : '📄 Documento';
    } else if (/^\[Mídia recebida/i.test(rawContent)) {
        if (/audio/i.test(rawContent)) preview = '🎤 Mensagem de áudio';
        else if (/image/i.test(rawContent)) preview = '📷 Foto';
        else if (/video/i.test(rawContent)) preview = '🎥 Vídeo';
        else preview = '📎 Arquivo recebido';
    } else if (/^\[(Áudio|Audio|Imagem|Vídeo|Video|Documento)\s*Enviado\]/i.test(rawContent)) {
        if (/Áudio|Audio/i.test(rawContent)) preview = '🎤 Áudio enviado';
        else if (/Imagem/i.test(rawContent)) preview = '📷 Foto enviada';
        else if (/Vídeo|Video/i.test(rawContent)) preview = '🎥 Vídeo enviado';
        else preview = '📄 Documento enviado';
    } else if (/^\[Mensagem tipo .* não suportada\]/i.test(rawContent)) {
        preview = '';
    } else {
        // Texto normal
        let cleanText = rawContent
            .replace(/^\[[^\]]+\]:\s*/, '') // Remove qualquer prefixo tipo [Tag]:
            .replace(/(\*|_|~)/g, '')       // Remove formatação whatsapp
            .replace(/\s+/g, ' ')           // Unifica quebras de linha e espaços
            .trim();
        preview = cleanText || 'Mensagem';
    }

    if (lastMsgObj.role === 'assistant') {
        return 'Você: ' + preview;
    }
    return preview;
};
