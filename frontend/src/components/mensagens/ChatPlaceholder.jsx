import React from 'react';
import { MessageSquareText } from 'lucide-react';

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

export default ChatPlaceholder;