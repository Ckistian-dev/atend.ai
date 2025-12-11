import React, { useState, useRef, useEffect } from 'react';
import { Save, X } from 'lucide-react';

const NameEditor = ({ currentName, onSave, onClose }) => {
    const [name, setName] = useState(currentName || '');
    const editorRef = useRef(null);
    const inputRef = useRef(null);

    // Foca no input ao montar
    useEffect(() => {
        inputRef.current?.focus();
        // Seleciona o texto existente
        inputRef.current?.select();
    }, []);

    // Fecha ao clicar fora
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (editorRef.current && !editorRef.current.contains(event.target)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [onClose]);

    const handleSave = (e) => {
        e.preventDefault();
        if (name.trim() && name.trim() !== currentName) {
            onSave(name.trim());
        }
        onClose(); // Fecha mesmo se não houver alteração
    };

    return (
        <div
            ref={editorRef}
            className="absolute right-0 top-8 mt-1 w-64 bg-white rounded-lg shadow-2xl z-30 border border-gray-200 animate-fade-in-up-fast"
            onClick={(e) => e.stopPropagation()}
        >
            <form onSubmit={handleSave} className="p-3 space-y-2">
                <div className="flex justify-between items-center">
                    <h4 className="text-sm font-semibold text-gray-800">Alterar Nome</h4>
                    <button type="button" onClick={onClose} className="p-1 rounded-full hover:bg-gray-100 text-gray-500"><X size={16} /></button>
                </div>
                <input ref={inputRef} type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do contato" className="w-full px-3 py-2 text-sm rounded-md border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                <button type="submit" className="w-full px-3 py-1.5 bg-blue-600 text-white text-sm font-semibold rounded-md hover:bg-blue-700 transition-colors flex items-center justify-center gap-2">
                    <Save size={14} /> Salvar
                </button>
            </form>
        </div>
    );
};

export default NameEditor;