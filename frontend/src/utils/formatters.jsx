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
