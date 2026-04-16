import React, { useState, useRef, useEffect } from 'react';
import { Save, X, User } from 'lucide-react';

const NameEditor = ({ currentName, onSave, onClose }) => {
    const [name, setName] = useState(currentName || '');
    const editorRef = useRef(null);
    const inputRef = useRef(null);

    useEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
    }, []);

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
        onClose();
    };

    return (
        <div
            ref={editorRef}
            className="w-full bg-white rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.2),0_0_0_1px_rgba(0,0,0,0.05)] z-[200] border border-white p-3 animate-fade-in-up-fast"
            onClick={(e) => e.stopPropagation()}
        >
            <form onSubmit={handleSave} className="space-y-3">
                <div className="flex justify-between items-center px-1">
                    <p className="editorial-label text-slate-900">Mudar Nome</p>
                    <button type="button" onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-50 text-slate-400 hover:bg-slate-100 transition-all">
                        <X size={14} />
                    </button>
                </div>

                <div className="relative group">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors">
                        <User size={14} />
                    </div>
                    <input
                        ref={inputRef}
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Nome..."
                        className="w-full h-8 pl-9 pr-3 text-[11px] bg-slate-50 rounded-xl border border-transparent focus:bg-white focus:border-blue-100 focus:ring-4 focus:ring-blue-50/50 outline-none transition-all font-bold text-slate-700"
                    />
                </div>

                <button
                    type="submit"
                    className="w-full py-2 bg-blue-600 text-white text-[9px] font-black uppercase tracking-[0.15em] rounded-xl shadow-lg shadow-blue-100 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                >
                    <Save size={12} /> Atualizar Lead
                </button>
            </form>
        </div>
    );
};

export default NameEditor;