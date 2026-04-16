import React, { useState, useRef, useEffect } from 'react';
import { Plus, X, Check, Tag } from 'lucide-react';

const TagEditor = ({
    contactTags,
    allTags,
    onToggleTag,
    onSaveNewTag,
    onClose,
}) => {
    const [isCreating, setIsCreating] = useState(false);
    const [newTagName, setNewTagName] = useState('');
    const [newTagColor, setNewTagColor] = useState('#2563eb');
    const editorRef = useRef(null);

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

    const handleCreateNewTag = () => {
        if (newTagName.trim()) {
            onSaveNewTag({ name: newTagName.trim(), color: newTagColor });
            setNewTagName('');
            setNewTagColor('#2563eb');
            setIsCreating(false);
        }
    };

    const contactTagNames = new Set(contactTags.map(t => t.name));

    return (
        <div
            ref={editorRef}
            className="w-64 bg-white rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.2),0_0_0_1px_rgba(0,0,0,0.05)] z-[200] border border-white p-3 animate-fade-in-up-fast"
            onClick={(e) => e.stopPropagation()}
        >
            <div className="flex justify-between items-center mb-3 px-1">
                <p className="editorial-label text-slate-900">Tags</p>
                <button
                    onClick={() => setIsCreating(!isCreating)}
                    className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all ${isCreating ? 'bg-slate-100 text-slate-400' : 'bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white'}`}
                >
                    {isCreating ? <X size={14} /> : <Plus size={14} />}
                </button>
            </div>

            <div className="max-h-52 overflow-y-auto no-scrollbar space-y-0.5 -mx-1 px-1">
                {allTags.length > 0 ? allTags.map(tag => {
                    const isSelected = contactTagNames.has(tag.name);
                    return (
                        <button
                            key={tag.name}
                            type="button"
                            onClick={() => onToggleTag(tag)}
                            className={`w-full text-left flex items-center justify-between p-1.5 rounded-xl transition-all ${isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'}`}
                        >
                            <span className="flex items-center gap-2">
                                <span
                                    className="h-2 w-2 rounded-full shadow-sm"
                                    style={{ backgroundColor: tag.color }}
                                ></span>
                                <span className={`text-[11px] font-bold ${isSelected ? 'text-blue-600' : 'text-slate-600'}`}>
                                    {tag.name}
                                </span>
                            </span>
                            {isSelected && (
                                <div className="w-3.5 h-3.5 flex items-center justify-center bg-blue-600 text-white rounded-md">
                                    <Check size={9} strokeWidth={4} />
                                </div>
                            )}
                        </button>
                    );
                }) : (
                    <div className="py-6 text-center bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                        <Tag size={20} className="mx-auto text-slate-300 mb-1.5" />
                        <p className="text-[11px] font-bold text-slate-400 italic">Nenhuma tag.</p>
                    </div>
                )}
            </div>

            {isCreating && (
                <div className="mt-3 pt-3 border-t border-slate-100 animate-fade-in">
                    <div className="space-y-2">
                        <div className="flex items-center">
                            <div className="relative h-8 w-8 pr-3 rounded-lg overflow-hidden border border-slate-200 cursor-pointer shadow-sm">
                                <input
                                    type="color"
                                    value={newTagColor}
                                    onChange={(e) => setNewTagColor(e.target.value)}
                                    className="absolute -inset-2 w-12 h-12 cursor-pointer"
                                />
                            </div>
                            <input
                                type="text"
                                value={newTagName}
                                onChange={(e) => setNewTagName(e.target.value)}
                                placeholder="Nova tag..."
                                className="flex-1 h-8 px-3 text-[11px] bg-slate-50 rounded-lg border border-transparent focus:bg-white focus:border-blue-100 focus:ring-4 focus:ring-blue-50/50 outline-none transition-all font-medium"
                                onKeyPress={(e) => e.key === 'Enter' && handleCreateNewTag()}
                            />
                        </div>
                        <button
                            type="button"
                            onClick={handleCreateNewTag}
                            disabled={!newTagName.trim()}
                            className="w-full py-2 bg-blue-600 text-white text-[9px] font-black uppercase tracking-[0.15em] rounded-xl shadow-lg shadow-blue-100 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:scale-100 disabled:shadow-none"
                        >
                            Criar Tag
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TagEditor;