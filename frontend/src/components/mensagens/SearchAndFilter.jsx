import React from 'react';
import { Search, Users, Bot } from 'lucide-react';

const SearchAndFilter = ({ searchTerm, setSearchTerm, activeButtonGroup, toggleFilter }) => {
    const baseButtonClass = "px-3 py-1.5 text-sm font-medium rounded-lg transition-colors";
    const activeButtonClass = "bg-blue-600 text-white shadow-sm";
    const inactiveButtonClass = "bg-gray-100 text-gray-600 hover:bg-gray-200"; // Mantido para consistência

    return (
        <div className="flex-shrink-0 p-3 bg-white border-b border-gray-200 flex flex-col gap-3">
            {/* Barra de Busca */}
            <div className="relative w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                    type="text"
                    placeholder="Pesquisar ou começar uma nova conversa"
                    className="w-full pl-10 pr-4 py-2 bg-[#f0f2f5] border border-transparent rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300 text-sm"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>

            {/* Botões de Filtro */}
            <div className="flex items-center justify-center gap-2 w-full">
                <button
                    onClick={() => toggleFilter('atendimentos')}
                    className={`${baseButtonClass} flex-1 flex items-center justify-center gap-2 ${activeButtonGroup === 'atendimentos' ? activeButtonClass : inactiveButtonClass}`}
                >
                    <Users size={16} />
                    Atendimentos
                </button>
                <button
                    onClick={() => toggleFilter('bot_ia')}
                    className={`${baseButtonClass} flex-1 flex items-center justify-center gap-2 ${activeButtonGroup === 'bot_ia' ? activeButtonClass : inactiveButtonClass}`}
                >
                    <Bot size={16} />
                    Bot IA
                </button>
            </div>
        </div>
    );
};

export default SearchAndFilter;