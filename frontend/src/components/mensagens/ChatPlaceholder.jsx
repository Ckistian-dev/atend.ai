import React from 'react';
import { MessageSquareText } from 'lucide-react';

// --- Componente: Placeholder (Sem chat selecionado) ---
const ChatPlaceholder = () => (
    <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[#f8fafc]/50 backdrop-blur-sm border-l border-white/40">
        <div className="max-w-md w-full p-12 bg-white/40 backdrop-blur-xl rounded-[3rem] shadow-2xl shadow-blue-900/5 border border-white flex flex-col items-center group transition-all duration-500 hover:scale-[1.02]">
            <div className="w-24 h-24 rounded-[2.5rem] bg-indigo-50/50 flex items-center justify-center mb-8 shadow-inner border border-indigo-100/50 group-hover:scale-110 transition-all duration-500">
                <MessageSquareText size={42} className="text-indigo-600 drop-shadow-sm" />
            </div>

            <h2 className="text-[22px] font-black tracking-tight text-slate-800 leading-tight mb-4">
                Redesenhando o<br />Atendimento Manual
            </h2>

            <div className="w-12 h-1 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-full mb-6 opacity-40 group-hover:w-20 transition-all duration-500"></div>

            <p className="text-[14px] font-medium text-slate-400 leading-relaxed text-center px-4">
                Inicie uma conversa ou selecione um atendimento na barra lateral para acessar o painel de produtividade inteligente.
            </p>
        </div>
    </div>
);

export default ChatPlaceholder;