import React, { useRef, useEffect, useState } from 'react';
import { X, Tag, CheckCircle2, Check, ListFilter, ArrowRight, Clock, ChevronLeft, Trash2 } from 'lucide-react';

const FilterPopover = ({
    isOpen,
    onClose,
    statusOptions,
    allTags,
    selectedStatus,
    onStatusChange,
    selectedTags,
    onTagChange,
    onClearFilters,
    limit,
    onLimitChange,
    timeStart,
    onTimeStartChange,
    timeEnd,
    onTimeEndChange,
}) => {
    const popoverRef = useRef(null);
    const [view, setView] = useState('menu'); // 'menu', 'status', 'tags', 'time', 'limit'

    // Resetar view ao abrir/fechar
    useEffect(() => {
        if (!isOpen) {
            setView('menu');
        }
    }, [isOpen]);

    // Efeito para fechar ao clicar fora
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (popoverRef.current && !popoverRef.current.contains(event.target)) {
                onClose();
            }
        };
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const renderHeader = () => (
        <div className="flex justify-between items-center mb-5">
            {view === 'menu' ? (
                <p className="editorial-label text-slate-900 flex items-center gap-2">
                    <ListFilter size={14} className="text-blue-600" /> Filtros
                </p>
            ) : (
                <button 
                    onClick={() => setView('menu')}
                    className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-slate-400 hover:text-blue-600 transition-colors"
                >
                    <ChevronLeft size={14} /> Voltar
                </button>
            )}
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 transition-all">
                <X size={18} />
            </button>
        </div>
    );

    const menuOptions = [
        { id: 'status', label: 'Situação', icon: CheckCircle2, color: 'text-blue-500', active: !!selectedStatus, activeVal: selectedStatus },
        { id: 'tags', label: 'Marcação (Tag)', icon: Tag, color: 'text-purple-500', active: !!selectedTags, activeVal: selectedTags },
        { id: 'time', label: 'Intervalo de Tempo', icon: Clock, color: 'text-indigo-500', active: !!timeStart || !!timeEnd, activeVal: (timeStart || timeEnd) ? 'Ativo' : null },
        { id: 'limit', label: 'Itens por Página', icon: ArrowRight, color: 'text-slate-500', active: true, activeVal: limit + ' itens' },
    ];

    return (
        <div
            ref={popoverRef}
            className="absolute top-12 right-0 w-64 bg-white rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.2),0_0_0_1px_rgba(0,0,0,0.05)] z-[200] border border-white p-4 animate-fade-in-up-fast"
            onClick={(e) => e.stopPropagation()}
        >
            {renderHeader()}

            <div className="max-h-[60vh] overflow-y-auto no-scrollbar">
                {view === 'menu' && (
                    <div className="space-y-1.5 animate-fade-in">
                        {menuOptions.map(opt => (
                            <button
                                key={opt.id}
                                onClick={() => setView(opt.id)}
                                className={`w-full flex items-center justify-between p-3 rounded-2xl transition-all border border-transparent ${opt.active ? 'bg-slate-50 border-slate-100' : 'hover:bg-slate-50'}`}
                            >
                                <div className="flex items-center gap-2.5">
                                    <div className={`w-7 h-7 rounded-lg bg-white shadow-sm flex items-center justify-center ${opt.color}`}>
                                        <opt.icon size={14} />
                                    </div>
                                    <div className="flex flex-col items-start min-w-0">
                                        <span className="text-[11px] font-bold text-slate-700">{opt.label}</span>
                                        {opt.active && <span className="text-[8px] font-black uppercase tracking-widest text-blue-600 truncate max-w-[100px]">{opt.activeVal}</span>}
                                    </div>
                                </div>
                                <ArrowRight size={12} className="text-slate-300" />
                            </button>
                        ))}
                        
                        {(selectedStatus || selectedTags || timeStart || timeEnd) && (
                            <button
                                onClick={onClearFilters}
                                className="w-full mt-3 flex items-center justify-center gap-2 p-3 text-[10px] font-black uppercase tracking-widest text-red-500 bg-red-50/50 rounded-2xl hover:bg-red-50 transition-all"
                            >
                                <Trash2 size={12} /> Limpar Filtros
                            </button>
                        )}
                    </div>
                )}

                {view === 'status' && (
                    <div className="space-y-1 animate-fade-in">
                        <h5 className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 ml-1 flex items-center gap-1.5 px-1">
                            <CheckCircle2 size={10} className="text-blue-500" /> Situação
                        </h5>
                        {statusOptions.map(status => {
                            const isSelected = selectedStatus === status.nome;
                            return (
                                <button 
                                    key={status.nome} 
                                    onClick={() => onStatusChange(status.nome)} 
                                    className={`w-full text-left flex items-center justify-between p-1.5 rounded-xl transition-all ${isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'}`}
                                >
                                    <span className="flex items-center gap-2">
                                        <span className="h-2 w-2 rounded-full shadow-sm" style={{ backgroundColor: status.cor }}></span>
                                        <span className={`text-[11px] font-bold ${isSelected ? 'text-blue-600' : 'text-slate-600'}`}>
                                            {status.nome}
                                        </span>
                                    </span>
                                    {isSelected && <Check size={12} className="text-blue-600" />}
                                </button>
                            );
                        })}
                    </div>
                )}

                {view === 'tags' && (
                    <div className="space-y-1 animate-fade-in">
                        <h5 className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 ml-1 flex items-center gap-1.5 px-1">
                            <Tag size={10} className="text-purple-500" /> Tags
                        </h5>
                        <div className="space-y-1 max-h-52 overflow-y-auto no-scrollbar pr-1">
                            {allTags.map(tag => {
                                const isSelected = selectedTags === tag.name;
                                return (
                                    <button 
                                        key={tag.name} 
                                        onClick={() => onTagChange(tag.name)} 
                                        className={`w-full text-left flex items-center justify-between p-1.5 rounded-xl transition-all ${isSelected ? 'bg-purple-50/70' : 'hover:bg-slate-50'}`}
                                    >
                                        <span className="flex items-center gap-2">
                                            <span className="h-2 w-2 rounded-full shadow-sm" style={{ backgroundColor: tag.color }}></span>
                                            <span className={`text-[11px] font-bold ${isSelected ? 'text-purple-600' : 'text-slate-600'}`}>
                                                {tag.name}
                                            </span>
                                        </span>
                                        {isSelected && <Check size={12} className="text-purple-600" />}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {view === 'time' && (
                    <div className="space-y-3 animate-fade-in p-1">
                        <h5 className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1 flex items-center gap-1.5">
                            <Clock size={10} className="text-indigo-500" /> Intervalo
                        </h5>
                        <div className="space-y-5">
                            <div className="relative">
                                <label className="absolute -top-2 left-3 px-1.5 bg-white text-[8px] font-black uppercase tracking-widest text-slate-400 rounded">Início</label>
                                <input
                                    type="datetime-local"
                                    value={timeStart || ''}
                                    onChange={(e) => onTimeStartChange(e.target.value)}
                                    className="w-full px-3 py-3 text-[11px] bg-slate-50 rounded-xl border border-slate-100 focus:bg-white focus:border-blue-300 outline-none transition-all font-bold text-slate-700"
                                />
                            </div>
                            <div className="relative">
                                <label className="absolute -top-2 left-3 px-1.5 bg-white text-[8px] font-black uppercase tracking-widest text-slate-400 rounded">Fim</label>
                                <input
                                    type="datetime-local"
                                    value={timeEnd || ''}
                                    onChange={(e) => onTimeEndChange(e.target.value)}
                                    className="w-full px-3 py-3 text-[11px] bg-slate-50 rounded-xl border border-slate-100 focus:bg-white focus:border-blue-300 outline-none transition-all font-bold text-slate-700"
                                />
                            </div>
                        </div>
                    </div>
                )}

                {view === 'limit' && (
                    <div className="animate-fade-in">
                        <h5 className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 ml-1">Itens</h5>
                        <div className="grid grid-cols-1 gap-1.5">
                            {[20, 50, 100].map(value => {
                                const isSelected = limit === value;
                                return (
                                    <button
                                        key={value}
                                        onClick={() => onLimitChange(value)}
                                        className={`w-full flex items-center justify-between p-3 rounded-xl transition-all border ${
                                            isSelected
                                                ? 'bg-slate-900 border-slate-900 text-white shadow-lg shadow-slate-200'
                                                : 'bg-white border-slate-100 text-slate-600 hover:bg-slate-50'
                                        }`}
                                    >
                                        <span className="text-[12px] font-bold">{value} Itens</span>
                                        {isSelected && <Check size={12} />}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default FilterPopover;