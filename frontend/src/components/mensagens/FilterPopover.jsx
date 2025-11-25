import React, { useRef, useEffect } from 'react';
import { X, Tag, CheckCircle2 } from 'lucide-react';

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
            className="absolute top-12 right-0 w-72 bg-white rounded-lg shadow-2xl z-30 border border-gray-200 animate-fade-in-up-fast"
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
                            {statusOptions.map(status => (
                                <label key={status.nome} className="flex items-center gap-2 p-1.5 rounded-md hover:bg-gray-50 cursor-pointer">
                                    <input type="checkbox" checked={selectedStatus.includes(status.nome)} onChange={() => onStatusChange(status.nome)} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                                    <span className="flex items-center gap-2 text-sm text-gray-700">
                                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: status.cor }}></span>
                                        {status.nome}
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Filtro por Tags */}
                    <div>
                        <h5 className="text-xs font-bold text-gray-500 mb-2 flex items-center gap-1.5"><Tag size={14} /> POR TAG</h5>
                        <div className="space-y-1">
                            {allTags.map(tag => (
                                <label key={tag.name} className="flex items-center gap-2 p-1.5 rounded-md hover:bg-gray-50 cursor-pointer">
                                    <input type="checkbox" checked={selectedTags.includes(tag.name)} onChange={() => onTagChange(tag.name)} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                                    <span className="flex items-center gap-2 text-sm text-gray-700">
                                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: tag.color }}></span>
                                        {tag.name}
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="mt-3 pt-3 border-t">
                    <button onClick={handleClear} className="w-full text-center text-sm text-blue-600 hover:underline font-medium">
                        Limpar todos os filtros
                    </button>
                </div>
            </div>
        </div>
    );
};

export default FilterPopover;