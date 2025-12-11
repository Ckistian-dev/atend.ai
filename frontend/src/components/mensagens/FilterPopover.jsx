import React, { useRef, useEffect } from 'react';
import { X, Tag, CheckCircle2, Check, ListFilter, ArrowRight, Clock } from 'lucide-react';

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

    const handleClear = (e) => {
        e.stopPropagation();
        onClearFilters();
    };

    return (
        <div
            ref={popoverRef}
            className="absolute top-12 right-0 w-auto bg-white rounded-lg shadow-2xl z-30 border border-gray-200 animate-fade-in-up-fast"
            onClick={(e) => e.stopPropagation()}
        >
            <div className="p-3">
                <div className="flex justify-between items-center mb-3">
                    <h4 className="text-sm font-semibold text-gray-800">Filtrar Conversas</h4>
                    <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-100 text-gray-500">
                        <X size={16} />
                    </button>
                </div>

                <div className="space-y-4 max-h-80 overflow-y-auto pr-2">
                    {/* Filtro por Status */}
                    <div>
                        <h5 className="text-xs font-bold text-gray-500 mb-2 flex items-center gap-1.5"><CheckCircle2 size={14} /> POR SITUAÇÃO</h5>
                        <div className="space-y-1">
                            {statusOptions.map(status => {
                                const isSelected = selectedStatus === status.nome;
                                return (
                                    <button key={status.nome} onClick={() => onStatusChange(status.nome)} className={`w-full text-left flex items-center justify-between p-2 text-sm rounded-md transition-colors ${isSelected ? 'bg-blue-50 font-semibold text-blue-800' : 'text-gray-700 hover:bg-gray-100'}`}>
                                        <span className="flex items-center gap-2">
                                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: status.cor }}></span>
                                        {status.nome}
                                    </span>
                                        {isSelected && <Check size={16} className="text-blue-600" />}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Filtro por Tags */}
                    <div>
                        <h5 className="text-xs font-bold text-gray-500 mb-2 flex items-center gap-1.5"><Tag size={14} /> POR TAG</h5>
                        <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                            {allTags.map(tag => {
                                const isSelected = selectedTags === tag.name;
                                return (
                                    <button key={tag.name} onClick={() => onTagChange(tag.name)} className={`w-full text-left flex items-center justify-between p-2 text-sm rounded-md transition-colors ${isSelected ? 'bg-blue-50 font-semibold text-blue-800' : 'text-gray-700 hover:bg-gray-100'}`}>
                                        <span className="flex items-center gap-2">
                                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: tag.color }}></span>
                                        {tag.name}
                                    </span>
                                        {isSelected && <Check size={16} className="text-blue-600" />}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* NOVO: Filtro por Limite */}
                    <div>
                        <h5 className="text-xs font-bold text-gray-500 mb-2 flex items-center gap-1.5"><ListFilter size={14} /> ITENS POR PÁGINA</h5>
                        <div className="flex items-center gap-2">
                            {[20, 50, 100].map(value => {
                                const isSelected = limit === value;
                                return (
                                    <button
                                        key={value}
                                        onClick={() => onLimitChange(value)}
                                        className={`px-3 py-1 text-sm rounded-full transition-colors ${
                                            isSelected
                                                ? 'bg-blue-600 text-white font-semibold'
                                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                        }`}
                                    >
                                        {value}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* ALTERADO: Filtro por Horário Personalizado */}
                    <div>
                        <h5 className="text-xs font-bold text-gray-500 mb-2 flex items-center gap-1.5"><Clock size={14} /> INTERVALO DE HORÁRIO</h5>
                        <div className="space-y-2">
                            <div>
                                <label className="text-xs text-gray-600 ml-1">De:</label>
                                <input
                                    type="datetime-local"
                                    title="Data e horário de início"
                                    value={timeStart || ''}
                                    onChange={(e) => onTimeStartChange(e.target.value)}
                                    className="w-full px-2 py-1.5 text-sm rounded-md border border-gray-300 focus:ring-blue-500 focus:border-blue-500"
                                />
                            </div>
                            <div>
                                <label className="text-xs text-gray-600 ml-1">Até:</label>
                                <input
                                    type="datetime-local"
                                    title="Data e horário de fim"
                                    value={timeEnd || ''}
                                    onChange={(e) => onTimeEndChange(e.target.value)}
                                    className="w-full px-2 py-1.5 text-sm rounded-md border border-gray-300 focus:ring-blue-500 focus:border-blue-500"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mt-4 pt-3 border-t">
                    <button onClick={handleClear} className="w-full text-center text-sm text-blue-600 hover:underline font-medium">
                        Limpar todos os filtros
                    </button>
                </div>
            </div>
        </div>
    );
};

export default FilterPopover;