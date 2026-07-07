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
        <div className="flex justify-between items-center px-3 py-2 border-b border-slate-50 mb-1 shrink-0">
            {view === 'menu' ? (
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <ListFilter size={14} className="text-blue-500" /> Filtros
                </span>
            ) : (
                <button 
                    onClick={() => setView('menu')}
                    className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-blue-600 transition-colors"
                >
                    <ChevronLeft size={14} /> Voltar
                </button>
            )}
            <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 transition-all">
                <X size={14} />
            </button>
        </div>
    );

    const isStatusActive = Array.isArray(selectedStatus) ? selectedStatus.length > 0 : !!selectedStatus;
    const statusActiveVal = Array.isArray(selectedStatus) 
        ? (selectedStatus.length === 1 ? selectedStatus[0] : (selectedStatus.length > 1 ? `${selectedStatus.length} itens` : null))
        : selectedStatus;

    const isTagsActive = Array.isArray(selectedTags) ? selectedTags.length > 0 : !!selectedTags;
    const tagsActiveVal = Array.isArray(selectedTags) 
        ? (selectedTags.length === 1 ? selectedTags[0] : (selectedTags.length > 1 ? `${selectedTags.length} itens` : null))
        : selectedTags;

    const menuOptions = [
        { id: 'status', label: 'Situação', icon: CheckCircle2, color: 'text-blue-500', active: isStatusActive, activeVal: statusActiveVal },
        { id: 'tags', label: 'Marcação (Tag)', icon: Tag, color: 'text-purple-500', active: isTagsActive, activeVal: tagsActiveVal },
        { id: 'time', label: 'Intervalo de Tempo', icon: Clock, color: 'text-indigo-500', active: !!timeStart || !!timeEnd, activeVal: (timeStart || timeEnd) ? 'Ativo' : null },
        { id: 'limit', label: 'Itens por Página', icon: ArrowRight, color: 'text-slate-500', active: true, activeVal: limit + ' itens' },
    ];

    return (
        <div
            ref={popoverRef}
            className="absolute top-12 right-0 mt-1 w-64 bg-white border border-slate-100 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.2),0_0_0_1px_rgba(0,0,0,0.05)] z-[200] overflow-hidden animate-fade-in p-2"
            onClick={(e) => e.stopPropagation()}
        >
            {renderHeader()}

            <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                {view === 'menu' && (
                    <div className="space-y-0.5">
                        {menuOptions.map(opt => (
                            <button
                                key={opt.id}
                                onClick={() => setView(opt.id)}
                                className={`w-full text-left p-3 text-[12px] font-bold transition-all rounded-2xl flex items-center justify-between ${opt.active ? 'bg-slate-50 text-slate-900 shadow-inner' : 'text-slate-600 hover:bg-slate-50 hover:text-blue-600'}`}
                            >
                                <div className="flex items-center gap-3">
                                    <opt.icon size={16} className={opt.color} />
                                    <div className="flex flex-col items-start min-w-0">
                                        <span className="text-[12px] font-bold">{opt.label}</span>
                                        {opt.active && <span className="text-[8px] font-black uppercase tracking-widest text-blue-600 truncate max-w-[140px] mt-0.5">{opt.activeVal}</span>}
                                    </div>
                                </div>
                                <ArrowRight size={12} className="text-slate-300" />
                            </button>
                        ))}
                        
                        {(isStatusActive || isTagsActive || timeStart || timeEnd) && (
                            <div className="p-1">
                                <button
                                    onClick={onClearFilters}
                                    className="w-full mt-2 flex items-center justify-center gap-2 p-3 text-[10px] font-black uppercase tracking-widest text-red-500 bg-red-50/50 rounded-2xl hover:bg-red-50 transition-all"
                                >
                                    <Trash2 size={12} /> Limpar Filtros
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {view === 'status' && (
                    <div className="space-y-0.5">
                        <div className="px-3 py-1 text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Situação</div>
                        {(statusOptions || []).map(status => {
                            const isSelected = Array.isArray(selectedStatus) 
                                ? selectedStatus.includes(status.nome) 
                                : selectedStatus === status.nome;
                            return (
                                <button 
                                    key={status.nome} 
                                    onClick={() => onStatusChange(status.nome)} 
                                    className={`w-full text-left p-3 text-[12px] font-bold transition-all rounded-2xl flex items-center justify-between ${isSelected ? 'bg-slate-50 text-slate-900 shadow-inner' : 'text-slate-600 hover:bg-slate-50 hover:text-blue-600'}`}
                                >
                                    <span className="flex items-center gap-3">
                                        <span className="h-2 w-2 rounded-full shadow-sm" style={{ backgroundColor: status.cor }}></span>
                                        {status.nome}
                                    </span>
                                    {isSelected && <Check size={12} className="text-blue-600" />}
                                </button>
                            );
                        })}
                    </div>
                )}

                {view === 'tags' && (
                    <div className="space-y-0.5">
                        <div className="px-3 py-1 text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Tags</div>
                        <div className="space-y-0.5 max-h-52 overflow-y-auto custom-scrollbar">
                            {(allTags || []).map(tag => {
                                const isSelected = Array.isArray(selectedTags) 
                                    ? selectedTags.includes(tag.name) 
                                    : selectedTags === tag.name;
                                return (
                                    <button 
                                        key={tag.name} 
                                        onClick={() => onTagChange(tag.name)} 
                                        className={`w-full text-left p-3 text-[12px] font-bold transition-all rounded-2xl flex items-center justify-between ${isSelected ? 'bg-slate-50 text-slate-900 shadow-inner' : 'text-slate-600 hover:bg-slate-50 hover:text-purple-600'}`}
                                    >
                                        <span className="flex items-center gap-3">
                                            <span className="h-2 w-2 rounded-full shadow-sm" style={{ backgroundColor: tag.color }}></span>
                                            {tag.name}
                                        </span>
                                        {isSelected && <Check size={12} className="text-purple-600" />}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {view === 'time' && (
                    <div className="space-y-3 p-3">
                        <div className="px-1 text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1 flex items-center gap-1.5">
                            <Clock size={12} className="text-indigo-500" /> Intervalo
                        </div>
                        <div className="space-y-5 py-1">
                            <div className="relative flex items-center">
                                <label className="absolute -top-2 left-3 px-1.5 bg-white text-[8px] font-black uppercase tracking-widest text-slate-400 rounded z-10">Início</label>
                                <input
                                    type="datetime-local"
                                    value={timeStart || ''}
                                    onChange={(e) => onTimeStartChange(e.target.value)}
                                    className="w-full pl-3 pr-8 py-3 text-[11px] bg-slate-50 rounded-xl border border-slate-100 focus:bg-white focus:border-blue-300 outline-none transition-all font-bold text-slate-700"
                                />
                                {timeStart && (
                                    <button 
                                        type="button"
                                        onClick={() => onTimeStartChange('')}
                                        className="absolute right-3 text-slate-400 hover:text-red-500 transition-colors p-1"
                                        title="Limpar início"
                                    >
                                        <X size={12} />
                                    </button>
                                )}
                            </div>
                            <div className="relative flex items-center">
                                <label className="absolute -top-2 left-3 px-1.5 bg-white text-[8px] font-black uppercase tracking-widest text-slate-400 rounded z-10">Fim</label>
                                <input
                                    type="datetime-local"
                                    value={timeEnd || ''}
                                    onChange={(e) => onTimeEndChange(e.target.value)}
                                    className="w-full pl-3 pr-8 py-3 text-[11px] bg-slate-50 rounded-xl border border-slate-100 focus:bg-white focus:border-blue-300 outline-none transition-all font-bold text-slate-700"
                                />
                                {timeEnd && (
                                    <button 
                                        type="button"
                                        onClick={() => onTimeEndChange('')}
                                        className="absolute right-3 text-slate-400 hover:text-red-500 transition-colors p-1"
                                        title="Limpar fim"
                                    >
                                        <X size={12} />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {view === 'limit' && (
                    <div className="space-y-1.5 p-1.5">
                        <div className="px-2 text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Itens</div>
                        <div className="grid grid-cols-1 gap-1">
                            {[20, 50, 100].map(value => {
                                const isSelected = limit === value;
                                return (
                                    <button
                                        key={value}
                                        onClick={() => onLimitChange(value)}
                                        className={`w-full flex items-center justify-between p-3 rounded-2xl transition-all border ${
                                            isSelected
                                                ? 'bg-slate-900 border-slate-900 text-white shadow-lg shadow-slate-200'
                                                : 'bg-white border-transparent text-slate-600 hover:bg-slate-50 hover:text-blue-600'
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