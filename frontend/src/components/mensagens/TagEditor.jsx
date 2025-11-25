import React, { useState, useRef, useEffect } from 'react';
import { Plus, X, Check } from 'lucide-react';

const TagEditor = ({
    contactTags,
    allTags,
    onToggleTag,
    onSaveNewTag,
    onClose,
}) => {
    const [isCreating, setIsCreating] = useState(false);
    const [newTagName, setNewTagName] = useState('');
    const [newTagColor, setNewTagColor] = useState('#4b5563'); // Cor cinza escuro
    const editorRef = useRef(null);

    // Fecha o pop-up se clicar fora
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
            setNewTagColor('#4b5563');
            setIsCreating(false);
        }
    };

    const contactTagNames = new Set(contactTags.map(t => t.name));

    return (
        <div
            ref={editorRef}
            className="absolute right-0 top-8 mt-1 w-64 bg-white rounded-lg shadow-2xl z-30 border border-gray-200 animate-fade-in-up-fast"
            onClick={(e) => e.stopPropagation()}
        >
            <div className="p-3">
                <div className="flex justify-between items-center mb-2">
                    <h4 className="text-sm font-semibold text-gray-800">Etiquetar Conversa</h4>
                    <button onClick={() => setIsCreating(!isCreating)} className="p-1 rounded-full hover:bg-gray-100 text-gray-500 hover:text-blue-600" title="Criar nova tag">
                        {isCreating ? <X size={16} /> : <Plus size={16} />}
                    </button>
                </div>

                <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                    {allTags.length > 0 ? allTags.map(tag => {
                        const isSelected = contactTagNames.has(tag.name);
                        return (
                            <button
                                key={tag.name}
                                type="button"
                                onClick={() => onToggleTag(tag)}
                                className={`w-full text-left flex items-center justify-between p-2 text-sm rounded-md transition-colors ${isSelected ? 'bg-blue-50' : 'hover:bg-gray-100'}`}
                            >
                                <span className="flex items-center gap-2">
                                    <span
                                        className="h-4 w-4 rounded"
                                        style={{ backgroundColor: tag.color }}
                                    ></span>
                                    <span className={`font-medium ${isSelected ? 'text-blue-800' : 'text-gray-700'}`}>
                                        {tag.name}
                                    </span>
                                </span>
                                {isSelected && <Check size={16} className="text-blue-600" />}
                            </button>
                        );
                    }) : (
                        <p className="text-xs text-center text-gray-400 p-4">
                            Nenhuma tag criada.
                        </p>
                    )}
                </div>

                {isCreating && (
                    <div className="mt-3 pt-3 border-t p-2 bg-gray-50 rounded-b-md space-y-2 animate-fade-in">
                        <div className="flex items-center gap-2">
                            <input
                                type="color"
                                value={newTagColor}
                                onChange={(e) => setNewTagColor(e.target.value)}
                                className="h-7 w-7 p-0 border-none rounded-md cursor-pointer"
                            />
                            <input
                                type="text"
                                value={newTagName}
                                onChange={(e) => setNewTagName(e.target.value)}
                                placeholder="Nome da tag..."
                                className="flex-grow block w-full text-sm rounded-md border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={handleCreateNewTag}
                            className="w-full px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-md hover:bg-blue-700 transition-colors"
                        >
                            Salvar Nova Tag
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default TagEditor;