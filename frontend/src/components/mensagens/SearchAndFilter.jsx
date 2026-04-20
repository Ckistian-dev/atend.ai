import React from 'react';
import { Search, Users, Bot, Filter } from 'lucide-react';

const SearchAndFilter = ({ searchTerm, setSearchTerm, activeButtonGroup, toggleFilter, onFilterIconClick, hasActiveFilters }) => {
    return (
        <div className="flex-shrink-0 p-4 pb-4 flex flex-col gap-6">
            {/* BARRA DE BUSCA PREMIUM */}
            <div className="relative group">
                <input
                    type="text"
                    placeholder="Buscar Contatos..."
                    className="w-full px-6 pr-14 py-4 bg-white/50 border border-transparent rounded-2xl focus:bg-white focus:outline-none focus:shadow-2xl focus:shadow-blue-900/5 transition-all text-[14px] font-bold text-slate-700 placeholder:text-slate-300"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />

                <button
                    onClick={onFilterIconClick}
                    className={`absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-xl transition-all ${hasActiveFilters ? 'bg-blue-600 text-white shadow-lg shadow-blue-200' : 'text-slate-400 hover:bg-slate-100 hover:text-blue-600'
                        }`}
                >
                    <Filter size={18} />
                    {hasActiveFilters && (
                        <span className="absolute -top-1 -right-1 block h-3 w-3 rounded-full bg-blue-400 ring-2 ring-white animate-pulse" />
                    )}
                </button>
            </div>

            {/* SEGMENTED CONTROL (TETHO STYLE) */}
            <div className="flex p-1.5 bg-slate-100/50 rounded-2xl gap-1">
                <button
                    onClick={() => toggleFilter('atendimentos')}
                    className={`flex-1 py-3 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${activeButtonGroup === 'atendimentos'
                        ? 'bg-white text-blue-600 shadow-xl shadow-slate-200/50'
                        : 'text-slate-400 hover:text-slate-600'
                        }`}
                >
                    <Users size={14} />
                    Atendimentos
                </button>
                <button
                    onClick={() => toggleFilter('bot_ia')}
                    className={`flex-1 py-3 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${activeButtonGroup === 'bot_ia'
                        ? 'bg-white text-blue-600 shadow-xl shadow-slate-200/50'
                        : 'text-slate-400 hover:text-slate-600'
                        }`}
                >
                    <Bot size={14} />
                    IA
                </button>
            </div>
        </div>
    );
};

export default SearchAndFilter;