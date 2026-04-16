import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import toast from 'react-hot-toast';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import api from '../api/axiosConfig';
import { Search, MessageSquare, Edit, Trash2, AlertTriangle, ChevronLeft, ChevronRight, X as XIcon, Tag, Download, Plus, MessageSquarePlus, Loader2, Send, FileImage, FileVideo, File as FileIcon, Upload, FileText, Info, Bot, Clock, Database, User, Zap, ListFilter } from 'lucide-react';
import CreateTemplateModal from '../components/mensagens/CreateTemplateModal';
import FilterPopover from '../components/mensagens/FilterPopover';

// --- DESIGN SYSTEM & MODAL GENÉRICO ---
const DS_STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800;900&family=Inter:wght@400;500;600;700&display=swap');
.atend-page { font-family: 'Inter', sans-serif; }
.atend-page h1, .atend-page h2, .atend-page h3, .atend-page h4 { font-family: 'Plus Jakarta Sans', sans-serif; }
.atend-modal-overlay { animation: fadeIn 0.2s ease; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes fadeInUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
.animate-fade-in { animation: fadeIn 0.3s ease-out; }
.animate-fade-in-up-fast { animation: fadeInUp 0.2s ease-out; }
.editorial-label {
    font-family: 'Plus Jakarta Sans', sans-serif;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    font-weight: 800;
    font-size: 0.65rem;
    color: #64748b;
}
.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
.atend-input {
    width: 100%;
    padding: 0.875rem 1.25rem;
    font-size: 0.875rem;
    border-radius: 1.25rem;
    background: #f8faff;
    border: 1px solid rgba(203,213,225,0.5);
    color: #0f172a;
    outline: none;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    font-family: 'Inter', sans-serif;
}
.atend-input:focus { border-color: #3b82f6; box-shadow: 0 0 0 4px rgba(59,130,246,0.1); background: #fff; }

/* Table Improvements */
.atend-table-row {
    transition: all 0.2s;
}
.atend-table-row:hover {
    background-color: rgba(241, 245, 249, 0.4);
}
.atend-table-row.selected {
    background-color: rgba(59, 130, 246, 0.05);
}
.table-cell-padding {
    padding: 1.25rem 1.5rem;
}
.premium-shadow {
    box-shadow: 0 10px 30px -10px rgba(15, 23, 42, 0.08);
}
.avatar-circle {
    width: 38px;
    height: 38px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 800;
    font-size: 0.75rem;
    flex-shrink: 0;
}

/* Expansion Effect */
.expand-cell {
    transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
    max-width: 180px;
    cursor: zoom-in;
    overflow: hidden;
}
.expand-cell:hover {
    max-width: 650px;
}

/* Premium Pagination */
.pagination-pill {
    background: rgba(255, 255, 255, 0.6);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.8);
    border-radius: 1.5rem;
    padding: 0.5rem 1.5rem;
    box-shadow: 0 4px 15px rgba(0,0,0,0.03);
}

.pagination-btn {
    width: 32px;
    height: 32px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    background: white;
    border: 1px solid rgba(226, 232, 240, 0.8);
    color: #64748b;
}
.pagination-btn:hover:not(:disabled) {
    background: #3b82f6;
    color: white;
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2);
}
.pagination-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
}
.atend-tab {
    position: relative;
    transition: all 0.2s;
    cursor: pointer;
}
.atend-tab.active {
    color: #3b82f6;
}
.atend-tab.active::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 0;
    width: 100%;
    height: 3px;
    background: #3b82f6;
    border-radius: 3px 3px 0 0;
}
`;

const Modal = ({ onClose, children, maxWidth = 'max-w-xl' }) => (
    <div className="fixed inset-0 z-50 flex items-center justify-center atend-modal-overlay p-4" style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(12px)' }} onClick={onClose}>
        <div className={`bg-white w-full ${maxWidth} flex flex-col max-h-[92vh] overflow-hidden shadow-[0_32px_120px_-20px_rgba(15,23,42,0.3)] transition-all duration-300 ease-out`} style={{ borderRadius: '2.5rem' }} onClick={e => e.stopPropagation()}>
            {children}
        </div>
    </div>
);

// --- COMPONENTE DE PREVIEW DO TEMPLATE ---
const TemplatePreview = ({ template, variables, headerFile, onVariableChange, onFileChange }) => {
    const fileInputRef = useRef(null);

    const renderBody = () => {
        if (!template) return '';
        const header = template.components.find(c => c.type === 'HEADER' && c.format === 'TEXT')?.text || '';
        const body = template.components.find(c => c.type === 'BODY')?.text || '';
        const combinedText = `${header}\n${body}`.trim();

        if (!combinedText) return null;

        const parts = combinedText.split(/({{\s*\w+\s*}})/g);

        return (
            <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700">
                {parts.map((part, index) => {
                    const match = part.match(/{{\s*(\w+)\s*}}/);
                    if (match) {
                        const varName = match[1];
                        return (
                            <input
                                key={index}
                                type="text"
                                value={variables[varName] || ''}
                                onChange={(e) => onVariableChange(varName, e.target.value)}
                                className="bg-white/60 border-indigo-200 text-blue-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 font-bold transition-all rounded-md px-1"
                                style={{
                                    width: `${Math.max(((variables[varName] || match[0]).length) * 8, 40)}px`,
                                    minWidth: '40px',
                                    height: '1.2rem',
                                    verticalAlign: 'baseline',
                                    border: '1px solid rgba(191,219,254,0.8)'
                                }}
                            />
                        );
                    }
                    return <span key={index}>{part}</span>;
                })}
            </div>
        );
    };

    const headerMedia = useMemo(() => template?.components.find(c => c.type === 'HEADER')?.format === 'TEXT' ? null : template?.components.find(c => c.type === 'HEADER')?.format, [template]);
    const buttons = useMemo(() => template?.components.find(c => c.type === 'BUTTONS')?.buttons || [], [template]);

    if (!template) return null;

    return (
        <div className="flex flex-col w-full items-center">
            <div className="relative max-w-[95%] p-2 rounded-2xl shadow-xl shadow-slate-200/50 break-words bg-white text-slate-800 min-w-[240px]" style={{ border: '1px solid rgba(226,232,240,0.8)' }}>
                {headerMedia && (
                    <div className="group relative mb-3 bg-slate-50 rounded-xl aspect-video flex flex-col items-center justify-center border border-dashed border-slate-200 text-slate-400 overflow-hidden cursor-pointer hover:bg-slate-100 transition-all" onClick={() => fileInputRef.current?.click()}>
                        <input type="file" ref={fileInputRef} className="hidden" onChange={(e) => onFileChange(e.target.files[0])} accept={headerMedia === 'IMAGE' ? 'image/*' : headerMedia === 'VIDEO' ? 'video/*' : '*/*'} />
                        {headerFile ? (
                            headerFile.type.startsWith('image/') ? <img src={URL.createObjectURL(headerFile)} alt="Header preview" className="w-full h-full object-cover" /> : <div className="flex flex-col items-center gap-1 p-4"><FileIcon size={32} /><span className="text-[10px] text-center truncate w-full">{headerFile.name}</span></div>
                        ) : (
                            <div className="flex flex-col items-center gap-2">
                                <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-sm">
                                    {headerMedia === 'IMAGE' && <FileImage size={20} className="text-blue-500" />}
                                    {headerMedia === 'VIDEO' && <FileVideo size={20} className="text-blue-500" />}
                                    {headerMedia === 'DOCUMENT' && <FileIcon size={20} className="text-blue-500" />}
                                </div>
                                <span className="text-[9px] uppercase font-bold tracking-widest text-slate-400">Anexar {headerMedia}</span>
                            </div>
                        )}
                        {headerFile && <div className="absolute inset-0 bg-blue-600/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><Upload size={24} className="text-white" /></div>}
                    </div>
                )}
                <div className="px-1.5">
                    {renderBody()}
                </div>
                {buttons.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-slate-50 space-y-2">
                        {buttons.map((btn, idx) => (
                            <div key={idx} className="bg-slate-50/50 py-2 text-center text-blue-600 text-[11px] font-bold rounded-xl border border-slate-100 hover:bg-blue-50 transition-colors">
                                {btn.text}
                            </div>
                        ))}
                    </div>
                )}
                <div className="flex justify-end mt-2 px-1">
                    <span className="text-[9px] font-bold text-slate-300 uppercase tracking-tighter">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
            </div>
        </div>
    );
};

// --- MODAL DE CONVERSA ---
const ConversationModal = ({ onClose, conversation, contactIdentifier }) => {
    const chatContainerRef = useRef(null);

    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [conversation]);

    let messages = [];
    try {
        messages = conversation ? JSON.parse(conversation) : [];
    } catch (e) {
        console.error("Erro ao analisar JSON da conversa:", e);
    }

    return (
        <Modal onClose={onClose} maxWidth="max-w-3xl">
            <div className="h-[85vh] flex flex-col bg-[#F0F2F5]">
                {/* Header do Chat */}
                <div className="px-8 py-5 bg-white border-b border-slate-200 flex items-center gap-4 shrink-0 shadow-sm z-10">
                    <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center text-white font-black shadow-lg shadow-blue-100">
                        {contactIdentifier?.substring(0, 1).toUpperCase() || <User size={20} />}
                    </div>
                    <div className="flex-1">
                        <h3 className="text-xl font-black text-slate-800 tracking-tight">{contactIdentifier}</h3>
                        <div className="flex items-center gap-2 mt-0.5">
                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Histórico de Interações</span>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 text-slate-300 hover:text-slate-600 transition-colors hover:bg-slate-100 rounded-xl">
                        <XIcon size={24} />
                    </button>
                </div>

                {/* Área de Mensagens */}
                <div
                    ref={chatContainerRef}
                    className="flex-1 p-6 md:p-10 overflow-y-auto space-y-6 custom-scrollbar"
                    style={{
                        backgroundImage: 'url("https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png")',
                        backgroundBlendMode: 'overlay',
                        backgroundColor: '#e5ddd5'
                    }}
                >
                    {messages.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-400">
                            <div className="w-20 h-20 rounded-full bg-white/50 backdrop-blur-md flex items-center justify-center border border-white">
                                <MessageSquarePlus size={32} />
                            </div>
                            <p className="font-bold text-xs uppercase tracking-[0.2em] bg-white/50 px-4 py-2 rounded-full backdrop-blur-sm border border-white">
                                Nenhuma interação registrada
                            </p>
                        </div>
                    ) : (
                        messages.map((msg, index) => {
                            const isAssistant = msg.role === 'assistant';
                            return (
                                <div key={index} className={`flex w-full ${isAssistant ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[85%] px-5 py-4 rounded-3xl shadow-sm border ${isAssistant
                                        ? 'bg-[#dcf8c6] border-green-100 rounded-tr-none'
                                        : 'bg-white border-white rounded-tl-none'
                                        }`}>
                                        <div className="flex items-center gap-2 mb-1">
                                            {isAssistant ? (
                                                <div className="flex items-center gap-1 text-[9px] font-black text-green-700 uppercase tracking-tighter">
                                                    <Bot size={10} /> Atendente IA
                                                </div>
                                            ) : (
                                                <div className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">
                                                    Cliente
                                                </div>
                                            )}
                                        </div>
                                        <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                                        <div className="flex justify-end mt-1 opacity-40">
                                            <span className="text-[9px] font-bold text-slate-500">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Footer do Chat */}
                <div className="p-4 bg-white border-t border-slate-100 flex justify-center shrink-0">
                    <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                        <Info size={12} /> Visualização de histórico somente leitura
                    </p>
                </div>
            </div>
        </Modal>
    );
};

// --- COMPONENTE DE PAGINAÇÃO (PREMIUM) ---
const Pagination = ({ currentPage, totalPages, onPageChange, totalItems }) => {
    if (!totalPages || totalPages <= 1) return null;

    return (
        <div className="flex flex-col sm:flex-row justify-between items-center px-8 py-6 bg-slate-50/30 border-t border-slate-100/50">
            <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600">
                    <Database size={14} />
                </div>
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">
                    Página <span className="text-blue-600">{currentPage}</span> de <span className="text-slate-600">{totalPages}</span>
                    <span className="mx-3 opacity-20">|</span>
                    Total de <span className="text-slate-600">{totalItems}</span> registros
                </p>
            </div>

            <div className="pagination-pill flex items-center gap-4">
                <button
                    onClick={() => onPageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="pagination-btn"
                    title="Página Anterior"
                >
                    <ChevronLeft size={16} />
                </button>

                <div className="h-4 w-[1px] bg-slate-200" />

                <div className="flex items-center gap-1">
                    <span className="text-[12px] font-bold text-slate-700 w-6 text-center">{currentPage}</span>
                </div>

                <div className="h-4 w-[1px] bg-slate-200" />

                <button
                    onClick={() => onPageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="pagination-btn"
                    title="Próxima Página"
                >
                    <ChevronRight size={16} />
                </button>
            </div>
        </div>
    );
};

// --- MODAL DE EDIÇÃO ---
const EditModal = ({ atendimento, personas, statusOptions, onSave, onClose, allTags, setAllTags }) => { // eslint-disable-line
    const [activeTab, setActiveTab] = useState('dados');
    const [status, setStatus] = useState(atendimento.status);
    const [personaId, setPersonaId] = useState(atendimento.active_persona_id ?? (personas?.[0]?.id ?? null));
    const [nomeContato, setNomeContato] = useState(atendimento.nome_contato || '');
    const [observacoes, setObservacoes] = useState(atendimento.observacoes || '');
    const [currentTags, setCurrentTags] = useState(atendimento.tags || []);
    const [newTagName, setNewTagName] = useState('');
    const [newTagColor, setNewTagColor] = useState('#3b82f6');

    const handleAddTag = () => {
        if (newTagName.trim() && !currentTags.some(t => t.name.toLowerCase() === newTagName.trim().toLowerCase())) {
            const newTag = { name: newTagName.trim(), color: newTagColor };
            setCurrentTags([...currentTags, newTag]);
            if (!allTags.some(t => t.name.toLowerCase() === newTag.name.toLowerCase())) {
                setAllTags([...allTags, newTag]);
            }
            setNewTagName('');
            setNewTagColor('#3b82f6');
        }
    };

    const handleToggleTag = (tag) => {
        if (currentTags.some(t => t.name === tag.name)) {
            setCurrentTags(currentTags.filter(t => t.name !== tag.name));
        } else {
            setCurrentTags([...currentTags, tag]);
        }
    };

    const handleRemoveTag = (tagName) => {
        setCurrentTags(currentTags.filter(t => t.name !== tagName));
    };

    const handleSave = () => {
        const finalPersonaId = personaId ? parseInt(personaId, 10) : null;
        onSave(atendimento.id, {
            status,
            active_persona_id: finalPersonaId,
            tags: currentTags,
            nome_contato: nomeContato.trim() || null,
            observacoes: observacoes.trim() || null
        });
        onClose();
    };

    const personaOptions = Array.isArray(personas)
        ? personas.map(p => <option key={p.id} value={p.id}>{p.nome_config}</option>)
        : [<option key="loading" value="" disabled>Carregando...</option>];

    const availableTags = allTags.filter(
        globalTag => !currentTags.some(currentTag => currentTag.name === globalTag.name)
    );

    const labelClass = "block text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2.5 ml-1 flex items-center gap-2";

    const tabs = [
        { id: 'dados', label: 'Dados Básicos', icon: User },
        { id: 'organizacao', label: 'Etiquetas & Notas', icon: Tag }
    ];

    return (
        <Modal onClose={onClose} maxWidth="max-w-2xl">
            <div className="flex flex-col h-full atend-page text-left overflow-hidden">
                {/* Header Premium */}
                <div className="px-8 py-7 bg-white flex items-center gap-5 shrink-0">
                    <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-200">
                        <Edit size={24} className="text-white" />
                    </div>
                    <div className="flex-1">
                        <h3 className="text-2xl font-black text-slate-900 tracking-tight">Editar Atendimento</h3>
                        <div className="flex items-center gap-2 text-slate-500 font-medium text-xs mt-1">
                            <MessageSquare size={14} className="text-blue-500" />
                            <span>{atendimento.whatsapp}</span>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 text-slate-300 hover:text-slate-600 transition-colors hover:bg-slate-100 rounded-xl">
                        <XIcon size={24} />
                    </button>
                </div>

                {/* Tab Navigation */}
                <div className="flex px-8 border-b border-slate-100 bg-white shrink-0 overflow-x-auto">
                    {tabs.map(tab => {
                        const Icon = tab.icon;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`atend-tab flex items-center gap-2.5 px-6 py-4 text-[13px] font-bold whitespace-nowrap ${activeTab === tab.id ? 'active' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                                <Icon size={18} />
                                {tab.label}
                            </button>
                        );
                    })}
                </div>

                <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-slate-50/10">
                    {activeTab === 'dados' && (
                        <div className="animate-fadeIn space-y-6">
                            <div>
                                <label className={labelClass}><User size={14} /> Nome do Contato</label>
                                <input
                                    type="text"
                                    value={nomeContato}
                                    onChange={e => setNomeContato(e.target.value)}
                                    placeholder="Nome do cliente"
                                    className="atend-input"
                                />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label className={labelClass}><Zap size={14} /> Situação</label>
                                    <select value={status} onChange={e => setStatus(e.target.value)} className="atend-input">
                                        {(statusOptions || []).map(opt => (
                                            <option key={opt.nome} value={opt.nome}>{opt.nome}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className={labelClass}><Bot size={14} /> Persona Ativa</label>
                                    <select value={personaId ?? ''} onChange={e => setPersonaId(e.target.value === '' ? null : parseInt(e.target.value, 10))} className="atend-input font-bold text-blue-600">
                                        <option value="">-- Nenhuma Persona --</option>
                                        {personaOptions}
                                    </select>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'organizacao' && (
                        <div className="animate-fadeIn space-y-8">
                            {/* Tags */}
                            <div className="space-y-6">
                                <label className={labelClass}><Tag size={14} /> Etiquetas do Cliente</label>
                                <div className="p-5 bg-white rounded-3xl border border-slate-100/80 shadow-sm flex flex-wrap gap-2 min-h-[64px] items-center">
                                    {currentTags.length === 0 ? (
                                        <div className="flex items-center gap-2 text-slate-300 italic text-[13px] px-2 w-full">
                                            <Info size={14} /> Nenhuma tag aplicada.
                                        </div>
                                    ) : (
                                        currentTags.map(tag => (
                                            <span key={tag.name} className="flex items-center gap-2 px-3.5 py-1.5 text-[11px] font-black text-white rounded-xl" style={{ backgroundColor: tag.color }}>
                                                {tag.name}
                                                <button onClick={() => handleRemoveTag(tag.name)} className="opacity-60 hover:opacity-100"><XIcon size={12} /></button>
                                            </span>
                                        ))
                                    )}
                                </div>
                                <div className="flex gap-3">
                                    <div className="relative flex-1">
                                        <input
                                            type="text"
                                            value={newTagName}
                                            onChange={e => setNewTagName(e.target.value)}
                                            placeholder="Nova tag..."
                                            className="atend-input pl-5 pr-14"
                                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); } }}
                                        />
                                        <div className="absolute right-3.5 top-1/2 -translate-y-1/2 p-0.5 bg-white border border-slate-200 rounded-lg">
                                            <input type="color" value={newTagColor} onChange={e => setNewTagColor(e.target.value)} className="h-7 w-7 p-0 border-none rounded-md cursor-pointer block overflow-hidden" />
                                        </div>
                                    </div>
                                    <button type="button" onClick={handleAddTag} disabled={!newTagName.trim()} className="w-14 h-14 bg-white border border-slate-200 text-slate-600 rounded-2xl flex items-center justify-center hover:bg-slate-50 transition-all active:scale-95 shadow-sm">
                                        <Plus size={24} />
                                    </button>
                                </div>

                                {availableTags.length > 0 && (
                                    <div className="mt-4">
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                                            <Tag size={12} className="text-blue-400" /> Clique para adicionar:
                                        </p>
                                        <div className="flex flex-wrap gap-2 max-h-[120px] overflow-y-auto pr-2 custom-scrollbar">
                                            {availableTags.map(tag => (
                                                <button
                                                    key={tag.name}
                                                    type="button"
                                                    onClick={() => handleToggleTag(tag)}
                                                    className="px-3 py-1.5 rounded-xl border border-slate-200 text-[11px] font-bold text-slate-500 hover:bg-white hover:border-blue-300 hover:text-blue-600 transition-all flex items-center gap-2 bg-slate-50/50"
                                                >
                                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: tag.color }} />
                                                    {tag.name}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Notas */}
                            <div className="space-y-6 pt-6 border-t border-slate-100">
                                <label className={labelClass}><FileText size={14} /> Notas Internas</label>
                                <textarea
                                    value={observacoes}
                                    onChange={e => setObservacoes(e.target.value)}
                                    rows={4}
                                    className="atend-input min-h-[120px] resize-none"
                                    placeholder="Adicione observações relevantes aqui..."
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Premium */}
                <div className="px-10 py-8 bg-white border-t border-slate-100 flex justify-end gap-5 shrink-0">
                    <button type="button" onClick={onClose} className="px-8 py-4 text-slate-400 font-bold hover:text-slate-600 transition-all text-sm uppercase tracking-widest">
                        Cancelar
                    </button>
                    <button type="button" onClick={handleSave}
                        className="px-10 py-4 text-white font-black rounded-2xl transition-all shadow-xl shadow-blue-200 hover:-translate-y-1 active:scale-95 text-xs uppercase tracking-[0.2em]"
                        style={{ background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)' }}>
                        Salvar Alterações
                    </button>
                </div>
            </div>
        </Modal>
    );
};

// --- MODAL DE CONFIRMAÇÃO PARA APAGAR ---
const DeleteConfirmationModal = ({ atendimento, onConfirm, onClose }) => (
    <Modal onClose={onClose} maxWidth="max-w-lg">
        <div className="p-12 text-center atend-page">
            <div className="mx-auto flex items-center justify-center h-24 w-24 rounded-[2rem] bg-red-50 mb-8 shadow-inner">
                <div className="h-16 w-16 rounded-2xl bg-red-500 flex items-center justify-center shadow-lg shadow-red-200 animate-bounce">
                    <Trash2 className="h-8 w-8 text-white" />
                </div>
            </div>

            <h3 className="text-3xl font-black text-slate-900 tracking-tight">Excluir Atendimento?</h3>

            <div className="mt-6 p-6 bg-slate-50 rounded-3xl border border-slate-100">
                <p className="text-sm text-slate-500 leading-relaxed">
                    Você está prestes a apagar permanentemente o histórico e as configurações de:
                </p>
                <div className="mt-3 flex items-center justify-center gap-3 bg-white py-3 px-5 rounded-2xl shadow-sm border border-slate-200">
                    <MessageSquare size={16} className="text-red-500" />
                    <strong className="text-slate-800 font-black text-lg">{atendimento?.whatsapp ?? 'Contato'}</strong>
                </div>
            </div>

            <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button
                    type="button"
                    onClick={onClose}
                    className="px-8 py-4 text-slate-400 font-bold hover:text-slate-600 transition-all text-xs uppercase tracking-widest border border-transparent hover:bg-slate-50 rounded-2xl"
                >
                    Manter Atendimento
                </button>
                <button
                    type="button"
                    onClick={() => atendimento && onConfirm(atendimento.id)}
                    className="px-8 py-4 bg-red-500 text-white font-black rounded-2xl hover:bg-red-600 transition-all shadow-xl shadow-red-200 hover:-translate-y-1 active:scale-95 text-xs uppercase tracking-widest flex items-center justify-center gap-2"
                    disabled={!atendimento}
                >
                    <Trash2 size={16} /> Confirmar Exclusão
                </button>
            </div>

            <p className="mt-6 text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] flex items-center justify-center gap-2">
                <AlertTriangle size={12} /> Esta ação não pode ser desfeita
            </p>
        </div>
    </Modal>
);

// --- NOVO: MODAL DE CRIAÇÃO ---
const CreateModal = ({ personas, statusOptions, onSave, onClose, allTags, setAllTags }) => {
    const [activeTab, setActiveTab] = useState('dados');
    const [whatsapp, setWhatsapp] = useState('');
    const [nomeContato, setNomeContato] = useState('');
    const [status, setStatus] = useState('Novo Atendimento');
    const [observacoes, setObservacoes] = useState('');
    const [personaId, setPersonaId] = useState(personas?.[0]?.id ?? '');

    const [currentTags, setCurrentTags] = useState([]);
    const [newTagName, setNewTagName] = useState('');
    const [newTagColor, setNewTagColor] = useState('#3b82f6');

    const [templates, setTemplates] = useState([]);
    const [selectedTemplateName, setSelectedTemplateName] = useState('');
    const [variables, setVariables] = useState({});
    const [headerFile, setHeaderFile] = useState(null);
    const [isSending, setIsSending] = useState(false);
    const [isCreateTemplateOpen, setIsCreateTemplateOpen] = useState(false);

    const loadTemplates = useCallback(() => {
        api.get('/atendimentos/whatsapp/templates').then(res => {
            setTemplates(res.data.filter(t => t.status === 'APPROVED' || t.status === 'ACTIVE'));
        }).catch(err => console.error("Erro ao carregar templates", err));
    }, []);

    useEffect(() => {
        loadTemplates();
    }, [loadTemplates]);

    const activeTemplate = useMemo(() => templates.find(t => t.name === selectedTemplateName), [templates, selectedTemplateName]);

    const variableNames = useMemo(() => {
        if (!activeTemplate) return [];
        const headerText = activeTemplate.components.find(c => c.type === 'HEADER' && c.format === 'TEXT')?.text || '';
        const bodyText = activeTemplate.components.find(c => c.type === 'BODY')?.text || '';
        const buttonsText = (activeTemplate.components.find(c => c.type === 'BUTTONS')?.buttons || []).map(b => b.url || '').join(' ');
        const combinedText = `${headerText} ${bodyText} ${buttonsText}`;
        const matches = combinedText.match(/{{\s*(\w+)\s*}}/g) || [];
        return [...new Set(matches.map(v => v.replace(/[{}]/g, '').trim()))];
    }, [activeTemplate]);

    const handleAddTag = () => {
        if (newTagName.trim() && !currentTags.some(t => t.name.toLowerCase() === newTagName.trim().toLowerCase())) {
            const newTag = { name: newTagName.trim(), color: newTagColor };
            setCurrentTags([...currentTags, newTag]);
            if (!allTags.some(t => t.name.toLowerCase() === newTag.name.toLowerCase())) {
                setAllTags([...allTags, newTag]);
            }
            setNewTagName('');
            setNewTagColor('#3b82f6');
        }
    };

    const handleToggleTag = (tag) => {
        if (currentTags.some(t => t.name === tag.name)) {
            setCurrentTags(currentTags.filter(t => t.name !== tag.name));
        } else {
            setCurrentTags([...currentTags, tag]);
        }
    };

    const handleRemoveTag = (tagName) => {
        setCurrentTags(currentTags.filter(t => t.name !== tagName));
    };

    const availableTags = allTags.filter(
        globalTag => !currentTags.some(currentTag => currentTag.name === globalTag.name)
    );

    useEffect(() => {
        setVariables(prev => {
            const newVars = { ...prev };
            variableNames.forEach(name => { if (newVars[name] === undefined) newVars[name] = ''; });
            Object.keys(newVars).forEach(name => { if (!variableNames.includes(name)) delete newVars[name]; });
            return newVars;
        });
    }, [variableNames]);

    const handleSave = () => {
        if (!whatsapp.trim()) {
            toast.error("O número do WhatsApp é obrigatório.");
            return;
        }

        const allVarsFilled = Object.values(variables).every(v => v.trim() !== '');
        if (activeTemplate && !allVarsFilled) {
            toast.error("Preencha todas as variáveis do template.");
            return;
        }

        const headerMedia = activeTemplate?.components.find(c => c.type === 'HEADER')?.format;
        if (headerMedia && headerMedia !== 'TEXT' && !headerFile) {
            toast.error(`O template exige um arquivo de ${headerMedia.toLowerCase()}.`);
            return;
        }

        setIsSending(true);

        const buildComponent = (type, text) => {
            const params = (text.match(/{{\s*(\w+)\s*}}/g) || []).map(match => {
                const varName = match.replace(/[{}]/g, '').trim();
                return { type: 'text', text: variables[varName] };
            });
            if (params.length === 0) return null;
            return { type, parameters: params };
        };

        let components = [];
        if (activeTemplate) {
            const headerComp = activeTemplate.components.find(c => c.type === 'HEADER' && c.format === 'TEXT');
            const bodyComp = activeTemplate.components.find(c => c.type === 'BODY');
            const btnComp = activeTemplate.components.find(c => c.type === 'BUTTONS');

            components = [
                headerComp ? buildComponent('header', headerComp.text) : null,
                bodyComp ? buildComponent('body', bodyComp.text) : null,
                ...(btnComp?.buttons || []).map((btn, idx) => {
                    if (!btn.url) return null;
                    const params = (btn.url.match(/{{\s*(\w+)\s*}}/g) || []).map(match => {
                        const varName = match.replace(/[{}]/g, '').trim();
                        return { type: 'text', text: variables[varName] };
                    });
                    if (params.length === 0) return null;
                    return { type: 'button', sub_type: 'url', index: idx, parameters: params };
                })
            ].filter(Boolean);
        }

        const basicData = {
            whatsapp: whatsapp.trim(),
            nome_contato: nomeContato.trim() || null,
            status,
            observacoes: observacoes.trim() || null,
            active_persona_id: personaId ? parseInt(personaId, 10) : null,
            tags: currentTags
        };

        const templateData = activeTemplate ? {
            template_name: activeTemplate.name,
            language_code: activeTemplate.language,
            components,
            file: headerFile
        } : null;

        onSave({ basicData, templateData }).finally(() => setIsSending(false));
    };

    if (isCreateTemplateOpen) {
        return <CreateTemplateModal isOpen={true} onClose={() => setIsCreateTemplateOpen(false)} onCreated={loadTemplates} />;
    }

    const labelClass = "block text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2.5 ml-1 flex items-center gap-2";

    const tabs = [
        { id: 'dados', label: 'Dados do Cliente', icon: User },
        { id: 'mensagem', label: 'Mensagem Inicial', icon: MessageSquare },
        { id: 'organizacao', label: 'Etiquetas & Notas', icon: Tag }
    ];

    return (
        <Modal onClose={onClose} maxWidth="max-w-4xl">
            <div className="flex flex-col h-full atend-page text-left overflow-hidden bg-white">
                {/* Header Premium */}
                <div className="px-10 py-8 border-b border-slate-100 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-5">
                        <div className="w-16 h-16 rounded-[1.5rem] bg-blue-600 flex items-center justify-center shadow-2xl shadow-blue-200">
                            <Plus size={32} className="text-white" />
                        </div>
                        <div>
                            <h3 className="text-3xl font-black text-slate-900 tracking-tight">Novo Atendimento</h3>
                            <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mt-1">Configuração inicial de contato</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-3 text-slate-300 hover:text-slate-600 transition-colors hover:bg-slate-100 rounded-2xl">
                        <XIcon size={28} />
                    </button>
                </div>

                {/* Tab Navigation */}
                <div className="flex px-10 border-b border-slate-100 bg-white shrink-0 overflow-x-auto">
                    {tabs.map(tab => {
                        const Icon = tab.icon;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`atend-tab flex items-center gap-3 px-8 py-5 text-[13px] font-bold whitespace-nowrap ${activeTab === tab.id ? 'active' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                                <Icon size={20} strokeWidth={activeTab === tab.id ? 2.5 : 2} />
                                {tab.label}
                            </button>
                        );
                    })}
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-50/10">
                    {activeTab === 'dados' && (
                        <div className="p-10 animate-fadeIn space-y-8 max-w-2xl mx-auto">
                            <div className="grid grid-cols-1 gap-8">
                                <div>
                                    <label className={labelClass}><MessageSquare size={14} /> WhatsApp do Cliente *</label>
                                    <input type="text" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="Ex: 5511999998888" className="atend-input font-bold text-lg" />
                                </div>
                                <div>
                                    <label className={labelClass}><Database size={14} /> Nome Completo (Opcional)</label>
                                    <input type="text" value={nomeContato} onChange={e => setNomeContato(e.target.value)} className="atend-input" placeholder='Nome do cliente para o CRM' />
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    <div>
                                        <label className={labelClass}><Zap size={14} /> Situação</label>
                                        <select value={status} onChange={e => setStatus(e.target.value)} className="atend-input">
                                            {(statusOptions || []).map(opt => <option key={opt.nome} value={opt.nome}>{opt.nome}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className={labelClass}><Bot size={14} /> Persona Alocada</label>
                                        <select value={personaId} onChange={e => setPersonaId(e.target.value)} className="atend-input font-bold text-blue-600">
                                            <option value="">-- Automática --</option>
                                            {(personas || []).map(p => <option key={p.id} value={p.id}>{p.nome_config}</option>)}
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'mensagem' && (
                        <div className="animate-fadeIn h-full">
                            <div className={`p-10 flex flex-col ${activeTemplate ? 'lg:flex-row' : ''} gap-12 min-h-[500px]`}>
                                <div className={`${activeTemplate ? 'lg:w-[420px]' : 'w-full max-w-2xl mx-auto'} flex flex-col gap-8`}>
                                    <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-[0_20px_50px_-20px_rgba(15,23,42,0.05)] relative overflow-hidden group">
                                        <div className="absolute top-0 right-0 w-40 h-40 bg-blue-50 rounded-full -mr-20 -mt-20 blur-3xl opacity-50 group-hover:opacity-100 transition-opacity" />

                                        <div className="flex items-center justify-between mb-8 relative z-10">
                                            <div className="flex items-center gap-4">
                                                <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-200">
                                                    <FileText size={22} className="text-white" />
                                                </div>
                                                <div>
                                                    <h4 className="text-lg font-black text-slate-900 tracking-tight">Template</h4>
                                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Mensagem Oficial</p>
                                                </div>
                                            </div>
                                            <button type="button" onClick={() => setIsCreateTemplateOpen(true)} className="p-3 text-blue-600 hover:bg-blue-50 rounded-2xl transition-all" title="Criar novo template">
                                                <Plus size={24} />
                                            </button>
                                        </div>

                                        <div className="space-y-6 relative z-10">
                                            <div className="space-y-3">
                                                <label className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">Selecionar Modelo</label>
                                                <select
                                                    value={selectedTemplateName}
                                                    onChange={e => setSelectedTemplateName(e.target.value)}
                                                    className="atend-input bg-slate-50/50 border-slate-200 focus:bg-white h-16 text-sm font-bold shadow-sm"
                                                >
                                                    <option value="">-- Sem mensagem inicial --</option>
                                                    {templates.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
                                                </select>
                                            </div>

                                            {activeTemplate && (
                                                <div className="p-6 bg-blue-50/30 rounded-[2rem] border border-blue-100/50 animate-fadeIn">
                                                    <div className="flex items-center gap-3 mb-3">
                                                        <Info size={16} className="text-blue-500" />
                                                        <span className="text-[11px] font-black text-blue-700 uppercase tracking-widest">Configuração</span>
                                                    </div>
                                                    <p className="text-[12px] text-slate-500 leading-relaxed font-medium">
                                                        Preencha os campos destacados no balão de mensagem ao lado para personalizar o envio.
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {!activeTemplate && (
                                        <div className="p-12 bg-white rounded-[3rem] border border-slate-100 shadow-[0_10px_30px_-10px_rgba(15,23,42,0.03)] flex flex-col items-center justify-center text-center gap-6">
                                            <div className="w-24 h-24 rounded-[2.5rem] bg-slate-50 flex items-center justify-center text-slate-200 shadow-inner">
                                                <Zap size={48} strokeWidth={1} />
                                            </div>
                                            <div className="max-w-xs">
                                                <h5 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-3">Envio Instantâneo</h5>
                                                <p className="text-[11px] text-slate-400 leading-relaxed font-medium">Escolha um template aprovado pela Meta para iniciar a conversa com o cliente imediatamente.</p>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {activeTemplate ? (
                                    <div className="flex-1 bg-slate-100 rounded-[4rem] p-6 shadow-inner relative overflow-hidden flex flex-col items-center justify-center min-h-[500px]"
                                        style={{
                                            backgroundImage: 'url("https://www.transparenttextures.com/patterns/cubes.png")',
                                            backgroundColor: '#f1f5f9'
                                        }}>
                                        <div className="absolute inset-0 bg-gradient-to-br from-white/40 via-transparent to-slate-200/20 pointer-events-none" />

                                        <div className="w-full max-w-md relative z-10 animate-fadeIn">
                                            <div className="bg-white rounded-[3rem] overflow-hidden shadow-[0_50px_100px_-20px_rgba(15,23,42,0.15)] border border-white">
                                                <div className="bg-slate-50/80 backdrop-blur-md px-8 py-5 border-b border-slate-100 flex items-center justify-between">
                                                    <div className="flex gap-2">
                                                        <div className="w-2.5 h-2.5 rounded-full bg-slate-200" />
                                                        <div className="w-2.5 h-2.5 rounded-full bg-slate-200" />
                                                        <div className="w-2.5 h-2.5 rounded-full bg-slate-200" />
                                                    </div>
                                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Preview WhatsApp</span>
                                                </div>
                                                <div className="p-6 bg-[#e5ddd5] min-h-[300px]" style={{ backgroundImage: 'url("https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png")', backgroundBlendMode: 'overlay' }}>
                                                    <TemplatePreview
                                                        template={activeTemplate}
                                                        variables={variables}
                                                        headerFile={headerFile}
                                                        onVariableChange={(name, val) => setVariables({ ...variables, [name]: val })}
                                                        onFileChange={setHeaderFile}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="hidden lg:flex flex-1 items-center justify-center bg-slate-50/50 rounded-[4rem] border-2 border-dashed border-slate-200">
                                        <div className="flex flex-col items-center gap-4 opacity-20">
                                            <MessageSquare size={64} strokeWidth={1} />
                                            <span className="text-[10px] font-black uppercase tracking-[0.3em]">Aguardando Seleção</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {activeTab === 'organizacao' && (
                        <div className="p-10 animate-fadeIn space-y-10 max-w-2xl mx-auto">
                            <div className="space-y-6">
                                <label className={labelClass}><Tag size={14} /> Segmentação por Etiquetas</label>
                                <div className="p-5 bg-white rounded-[2rem] border border-slate-100 shadow-sm flex flex-wrap gap-2 min-h-[64px] items-center">
                                    {currentTags.length === 0 ? (
                                        <div className="text-slate-300 italic text-[13px] px-2">Nenhuma etiqueta selecionada.</div>
                                    ) : (
                                        currentTags.map(tag => (
                                            <span key={tag.name} className="flex items-center gap-2 px-4 py-2 text-[10px] font-black text-white rounded-xl shadow-sm" style={{ backgroundColor: tag.color }}>
                                                {tag.name}
                                                <button type="button" onClick={() => handleRemoveTag(tag.name)} className="opacity-60 hover:opacity-100"><XIcon size={12} /></button>
                                            </span>
                                        ))
                                    )}
                                </div>
                                <div className="flex gap-3">
                                    <div className="relative flex-1">
                                        <input
                                            type="text"
                                            value={newTagName}
                                            onChange={e => setNewTagName(e.target.value)}
                                            placeholder="Adicionar etiqueta..."
                                            className="atend-input pl-5 pr-14"
                                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); } }}
                                        />
                                        <div className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 bg-white border border-slate-100 rounded-lg shadow-sm">
                                            <input type="color" value={newTagColor} onChange={e => setNewTagColor(e.target.value)} className="h-7 w-7 p-0 border-none rounded-md cursor-pointer block overflow-hidden" />
                                        </div>
                                    </div>
                                    <button type="button" onClick={handleAddTag} disabled={!newTagName.trim()} className="w-14 h-14 bg-white border border-slate-200 text-slate-500 rounded-2xl flex items-center justify-center hover:bg-slate-50 transition-all active:scale-95 shadow-sm">
                                        <Plus size={24} />
                                    </button>
                                </div>

                                {availableTags.length > 0 && (
                                    <div className="mt-4">
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                                            <Tag size={12} className="text-blue-400" /> Etiquetas Sugeridas (selecione):
                                        </p>
                                        <div className="flex flex-wrap gap-2 max-h-[120px] overflow-y-auto pr-2 custom-scrollbar">
                                            {availableTags.map(tag => (
                                                <button
                                                    key={tag.name}
                                                    type="button"
                                                    onClick={() => handleToggleTag(tag)}
                                                    className="px-3.5 py-2 rounded-2xl border border-slate-200 text-[11px] font-black text-slate-500 hover:bg-white hover:border-blue-400 hover:text-blue-600 transition-all flex items-center gap-2 bg-slate-50/30 shadow-sm"
                                                >
                                                    <div className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ backgroundColor: tag.color }} />
                                                    {tag.name}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="space-y-6 pt-10 border-t border-slate-100">
                                <label className={labelClass}><Info size={14} /> Observações Confidenciais</label>
                                <textarea
                                    value={observacoes}
                                    onChange={e => setObservacoes(e.target.value)}
                                    rows={5}
                                    className="atend-input min-h-[150px] bg-slate-50/50 resize-none"
                                    placeholder="Detalhes adicionais sobre o cliente ou atendimento..."
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Premium */}
                <div className="px-10 py-8 bg-white border-t border-slate-100 flex justify-end gap-5 shrink-0">
                    <button type="button" onClick={onClose} className="px-8 py-4 text-slate-400 font-bold hover:text-slate-600 transition-all text-sm uppercase tracking-widest">
                        Cancelar
                    </button>
                    <button type="button" onClick={handleSave} disabled={isSending}
                        className="px-12 py-4 text-white font-black rounded-[1.5rem] transition-all shadow-2xl shadow-blue-200 hover:shadow-blue-400 hover:-translate-y-1 active:scale-95 text-xs uppercase tracking-[0.2em] flex items-center gap-3"
                        style={{ background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)' }}>
                        {isSending ? <Loader2 className="animate-spin" size={18} /> : <Zap size={18} />}
                        {isSending ? 'Sincronizando...' : 'Iniciar Atendimento'}
                    </button>
                </div>
            </div>
        </Modal>
    );
};



// --- COMPONENTE PRINCIPAL DA PÁGINA ---
function Atendimentos() {
    const [atendimentos, setAtendimentos] = useState([]);
    const [personas, setPersonas] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    const [searchParams, setSearchParams] = useSearchParams(); // Adicionado setSearchParams
    const [searchTerm, setSearchTerm] = useState(searchParams.get('search') || '');

    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [modalData, setModalData] = useState({ type: null, data: null });

    const [statusOptions, setStatusOptions] = useState([]); // Agora é dinâmico
    const [userData, setUserData] = useState(null); // Novo
    const [allTags, setAllTags] = useState([]); // Para o modal de edição
    const navigate = useNavigate(); // Inicializa useNavigate
    const location = useLocation();

    const [selectedIds, setSelectedIds] = useState(location.state?.selectedIds || []); // Array de IDs selecionados para disparo
    const isSelectingForBulk = location.state?.isSelectingForBulk || false;

    const [currentPage, setCurrentPage] = useState(parseInt(searchParams.get('page') || '1', 10)); // Lê a página da URL
    const [totalPages, setTotalPages] = useState(0);
    const [totalAtendimentos, setTotalAtendimentos] = useState(0);

    // Novos Estados de Filtro
    const [selectedStatus, setSelectedStatus] = useState(searchParams.get('status') || '');
    const [selectedTag, setSelectedTag] = useState(searchParams.get('tag') || '');
    const [timeStart, setTimeStart] = useState(searchParams.get('time_start') || '');
    const [timeEnd, setTimeEnd] = useState(searchParams.get('time_end') || '');
    const [pageSize, setPageSize] = useState(parseInt(searchParams.get('limit') || '20', 10));
    const [isFilterOpen, setIsFilterOpen] = useState(false);

    // Ref para evitar fetch duplicado no modo Strict do React
    const initialFetchDone = useRef(false);

    const fetchData = useCallback(async (isInitialLoad = false, isMountedRef) => {
        // Evita loading piscando em polls
        if (isInitialLoad && !initialFetchDone.current) {
            setIsLoading(true);
        }
        setError(''); // Limpa erro anterior
        try {
            const params = {
                search: searchTerm,
                page: currentPage,
                limit: pageSize
            };

            // Adiciona filtros se existirem
            if (selectedStatus) params.status = selectedStatus;
            if (selectedTag) params.tags = selectedTag;
            if (timeStart) params.time_start = timeStart;
            if (timeEnd) params.time_end = timeEnd;
            const [atendimentosRes, personasRes, userRes, situationsRes, tagsRes] = await Promise.all([
                api.get('/atendimentos/', { params }),
                api.get('/configs/'),
                api.get('/auth/me'),
                api.get('/configs/situations'),
                api.get('/atendimentos/tags')
            ]);

            setAtendimentos(atendimentosRes.data.items);
            setTotalAtendimentos(atendimentosRes.data.total);
            setTotalPages(Math.ceil(atendimentosRes.data.total / pageSize));
            setAllTags(tagsRes.data);
            setPersonas(personasRes.data);
            setUserData(userRes.data);

            // Garante que 'Aguardando Envio' esteja nas opções para permitir alteração manual no modal
            let sOptions = situationsRes.data || [];
            if (!sOptions.some(opt => opt.nome === 'Aguardando Envio')) {
                sOptions = [...sOptions, { nome: 'Aguardando Envio', cor: '#9333ea' }];
            }
            setStatusOptions(sOptions);

            // CORREÇÃO: Só atualiza a URL se o componente ainda estiver montado.
            // Isso evita que uma busca de dados antiga, de uma página que já foi "deixada para trás",
            // altere a URL da nova página e cause um redirecionamento indesejado.
            // A verificação `isMountedRef.current` garante que isso não aconteça se o usuário navegar para outra página.
            if (isMountedRef?.current) setSearchParams(params, { replace: true });

        } catch (err) {
            console.error("Erro ao buscar dados:", err); // Log mais detalhado
            setError('Não foi possível carregar os dados. Verifique a sua conexão ou tente recarregar a página.');
            // Não limpa o intervalo aqui, pode ser um erro temporário
        } finally {
            if (isInitialLoad) {
                setIsLoading(false);
                initialFetchDone.current = true; // Marca que o fetch inicial foi feito
            }
        }
    }, [searchTerm, currentPage, pageSize, selectedStatus, selectedTag, timeStart, timeEnd, setSearchParams]); // isMountedRef não precisa ser dependência

    // --- CORREÇÃO DE POLLING (COM PAUSA EM SEGUNDO PLANO) ---
    useEffect(() => {
        const isMountedRef = { current: true }; // Usamos um objeto ref para que o valor seja mutável e persistente.
        let timeoutId;

        const poll = async () => {
            // Só busca dados se a página estiver VISÍVEL
            if (!document.hidden) {
                // Passa a referência do estado de montagem para a função de busca.
                await fetchData(false, isMountedRef);
            }

            if (isMountedRef.current) {
                // Agenda o próximo ciclo 5s DEPOIS que o atual terminar
                timeoutId = setTimeout(poll, 5000);
            }
        };

        // Lógica de Inicialização
        // A busca inicial também precisa saber se o componente está montado.
        if (!initialFetchDone.current) { // Garante que a carga inicial só aconteça uma vez.
            fetchData(true, isMountedRef).then(() => {
                if (isMountedRef.current) timeoutId = setTimeout(poll, 5000);
            });
        } else {
            // Se já carregou antes (ex: re-render), inicia o polling direto
            poll();
        }

        // Força atualização imediata ao voltar para a aba
        const handleVisibilityChange = () => {
            if (!document.hidden && isMountedRef.current) {
                clearTimeout(timeoutId);
                poll();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            isMountedRef.current = false; // Define como falso quando o componente é desmontado.
            clearTimeout(timeoutId);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [fetchData]);


    const getPersonaNameById = (id) => {
        // Adiciona verificação se personas é array
        if (!Array.isArray(personas)) return 'Carregando...';
        return personas.find(p => p.id === id)?.nome_config || 'Nenhuma';
    };

    const handleCloseModals = () => setModalData({ type: null, data: null });

    const handlePageChange = (newPage) => {
        // Verifica limites antes de mudar a página
        if (newPage >= 1 && (!totalPages || newPage <= totalPages)) {
            setCurrentPage(newPage);
            initialFetchDone.current = false; // Força recarregar com loading ao mudar de página
        }
    };

    const handleSelectAll = (e) => {
        if (e.target.checked) {
            const newIds = atendimentos.map(at => at.id);
            const combined = new Set([...selectedIds, ...newIds]);
            setSelectedIds(Array.from(combined));
        } else {
            const currentIds = atendimentos.map(at => at.id);
            setSelectedIds(selectedIds.filter(id => !currentIds.includes(id)));
        }
    };

    const handleSelectOne = (e, id) => {
        e.stopPropagation();
        if (e.target.checked) {
            setSelectedIds(prev => [...prev, id]);
        } else {
            setSelectedIds(prev => prev.filter(selectedId => selectedId !== id));
        }
    };

    const handleSaveEdit = async (atendimentoId, updates) => {
        const originalAtendimentos = [...atendimentos]; // Guarda estado original
        // Atualização Otimista
        setAtendimentos(prev =>
            prev.map(at => at.id === atendimentoId ? { ...at, ...updates, updated_at: new Date().toISOString() } : at)
        );
        handleCloseModals(); // Fecha modal otimistamente

        try {
            const response = await api.put(`/atendimentos/${atendimentoId}`, updates);
            // Atualiza com dados do servidor (garante consistência)
            setAtendimentos(prev =>
                prev.map(at => at.id === atendimentoId ? response.data : at)
            );
        } catch (err) {
            console.error("Erro ao salvar edição:", err);
            toast.error('Erro ao guardar as alterações. A interface será revertida.');
            setAtendimentos(originalAtendimentos); // Reverte
        }
    };

    const handleConfirmDelete = async (atendimentoId) => {
        const originalAtendimentos = [...atendimentos]; // Guarda estado original
        // Atualização otimista
        setAtendimentos(prev => prev.filter(at => at.id !== atendimentoId));
        setTotalAtendimentos(prev => prev - 1); // Atualiza contador otimista
        handleCloseModals();

        try {
            await api.delete(`/atendimentos/${atendimentoId}`);
            // Opcional: Forçar refetch para garantir consistência total se a paginação for afetada
            // fetchData(false); 
        } catch (err) {
            console.error("Erro ao apagar atendimento:", err);
            toast.error('Erro ao apagar o atendimento. A lista será recarregada.');
            setAtendimentos(originalAtendimentos); // Reverte
            setTotalAtendimentos(prev => prev + 1); // Reverte contador
            // Força refetch em caso de erro
            initialFetchDone.current = false;
            fetchData(true);
        }
    };

    const handleCreate = async ({ basicData, templateData }) => {
        let errorMessage = 'Ocorreu um erro ao criar o atendimento.';
        try {
            const response = await api.post('/atendimentos/', basicData);
            let finalAtendimento = response.data;

            // Se o usuário selecionou um template, dispara em seguida
            if (templateData) {
                try {
                    const formData = new FormData();
                    formData.append('payload_json', JSON.stringify({
                        template_name: templateData.template_name,
                        language_code: templateData.language_code,
                        components: templateData.components
                    }));

                    if (templateData.file) {
                        formData.append('file', templateData.file);
                    }

                    // Dispara a mensagem e atualiza com os dados do histórico retornado
                    const templateRes = await api.post(`/atendimentos/${finalAtendimento.id}/send_template`, formData);
                    finalAtendimento = templateRes.data;
                    toast.success('Atendimento criado e template enviado!');
                } catch (templateErr) {
                    console.error("Erro ao enviar template inicial:", templateErr);
                    toast.error('O atendimento foi criado, mas houve um erro ao enviar o template.');
                }
            } else {
                toast.success('Atendimento criado com sucesso!');
            }

            // Adiciona o novo atendimento no início da lista para feedback imediato
            setAtendimentos(prev => [finalAtendimento, ...prev]);
            setTotalAtendimentos(prev => prev + 1);
            setIsCreateModalOpen(false); // Fecha o modal
        } catch (err) {
            if (err.response?.status === 409) {
                errorMessage = 'Já existe um atendimento para este número de WhatsApp.';
            } else if (err.response?.data?.detail) {
                errorMessage = err.response.data.detail;
            }
            toast.error(errorMessage);
            // Não fecha o modal em caso de erro para o usuário corrigir
        }
    };

    // --- NOVA FUNÇÃO DE ESTILO (DINÂMICA) ---
    const getStatusStyleAndClass = (status) => {
        const baseClasses = "px-3 py-1 text-xs font-semibold rounded-full inline-block text-center min-w-[140px]";
        const situacao = statusOptions.find(opt => opt.nome === status);

        if (situacao && situacao.cor) {
            try {
                return {
                    style: { backgroundColor: situacao.cor },
                    className: `${baseClasses} text-white` // Força texto branco
                };
            } catch (e) {
                // Cor inválida, retorna estilo padrão
            }
        }
        // Fallback para status não encontrados na lista (ou cor inválida)
        return { style: {}, className: `${baseClasses} bg-gray-100 text-gray-600` };
    };

    const handleExport = async () => {
        try {
            const toastId = toast.loading('A gerar relatório...');

            // Chama o endpoint de exportação com responseType blob
            const response = await api.get('/atendimentos/export', {
                params: {
                    search: searchTerm,
                    status: selectedStatus || undefined,
                    tags: selectedTag || undefined,
                    time_start: timeStart || undefined,
                    time_end: timeEnd || undefined
                },
                responseType: 'blob' // Importante para download de arquivo binário
            });

            // Cria URL para download a partir do Blob recebido
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `atendimentos_${new Date().toISOString().split('T')[0]}.csv`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);

            toast.dismiss(toastId);
            toast.success("Download iniciado!");

        } catch (err) {
            console.error("Erro ao exportar atendimentos:", err);
            toast.error("Ocorreu um erro ao tentar exportar os dados. Tente novamente.");
        }
    };

    return (
        <div className="atend-page h-full overflow-y-auto custom-scrollbar p-6 md:p-8" style={{ background: '#f0f4ff' }}>
            <style>{DS_STYLE}</style>
            <style>{`
                .custom-scrollbar::-webkit-scrollbar { width: 8px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(203, 213, 225, 1); border-radius: 20px; border: 2px solid transparent; background-clip: padding-box; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #3b82f6; background-clip: padding-box; }
            `}</style>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-10 gap-6">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-200">
                            <MessageSquare size={22} className="text-white" />
                        </div>
                        <h1 className="text-3xl font-black text-slate-900 tracking-tight">Atendimentos</h1>
                    </div>
                    <p className="text-slate-500 font-medium text-sm flex items-center gap-2">
                        <Info size={14} className="text-blue-400" /> Visualize e gerencie todas as conversas ativas.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {selectedIds.length > 0 && (
                        <button
                            onClick={() => navigate('/disparos', { state: { selectedIds } })}
                            className="flex items-center gap-2 px-4 py-2.5 bg-white text-violet-600 rounded-xl text-sm font-bold transition-all animate-fade-in"
                            style={{ border: '1px solid rgba(139,92,246,0.3)', boxShadow: '0 4px 12px rgba(139,92,246,0.1)' }}
                        >
                            <Send size={15} />
                            Disparo em Massa ({selectedIds.length})
                        </button>
                    )}
                    <button
                        onClick={() => setIsCreateModalOpen(true)}
                        className="flex items-center gap-2 px-5 py-2.5 text-white text-sm font-semibold rounded-xl shadow-lg shadow-blue-500/25 transition-all"
                        style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}
                    >
                        <Plus size={16} />
                        Novo Atendimento
                    </button>
                    <button
                        onClick={handleExport}
                        className="flex items-center gap-2 px-4 py-2.5 bg-white text-slate-600 rounded-xl text-sm font-semibold border border-slate-200 hover:bg-slate-50 transition-all"
                    >
                        <Download size={16} />
                        Exportar
                    </button>
                </div>
            </div>

            {/* Mostra erro global se houver */}
            {error && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
                    <strong className="font-bold">Erro: </strong>
                    <span className="block sm:inline">{error}</span>
                </div>
            )}


            <div className="bg-white rounded-[2.5rem] premium-shadow border border-slate-100/50">
                <div className="p-8 border-b border-slate-50 rounded-t-[2.5rem]">
                    <div className="flex flex-col md:flex-row gap-4 items-center">
                        <div className="relative group flex-1 w-full">
                            <input
                                type="text"
                                placeholder="Pesquisar por telefone, nome, situação ou resumo..."
                                value={searchTerm}
                                onChange={(e) => {
                                    setSearchTerm(e.target.value);
                                    setCurrentPage(1);
                                }}
                                className="atend-input pl-16 bg-slate-50/50 border-slate-100 focus:bg-white"
                            />
                        </div>
                        <div className="relative w-full md:w-auto">
                            <button
                                onClick={() => setIsFilterOpen(!isFilterOpen)}
                                className={`flex items-center justify-center gap-2.5 px-6 h-14 md:h-16 w-full md:w-auto rounded-2xl font-bold transition-all border ${isFilterOpen || selectedStatus || selectedTag || timeStart || timeEnd
                                    ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-200'
                                    : 'bg-white border-slate-100 text-slate-600 hover:bg-slate-50'
                                    }`}
                            >
                                <ListFilter size={20} />
                                <span className="text-[13px] uppercase tracking-widest whitespace-nowrap">Filtros</span>
                                {(selectedStatus || selectedTag || timeStart || timeEnd) && (
                                    <div className="w-5 h-5 bg-white text-blue-600 rounded-full flex items-center justify-center text-[10px] font-black">
                                        !
                                    </div>
                                )}
                            </button>
                            <FilterPopover
                                isOpen={isFilterOpen}
                                onClose={() => setIsFilterOpen(false)}
                                statusOptions={statusOptions}
                                allTags={allTags}
                                selectedStatus={selectedStatus}
                                onStatusChange={(val) => {
                                    setSelectedStatus(val === selectedStatus ? '' : val);
                                    setCurrentPage(1);
                                }}
                                selectedTags={selectedTag}
                                onTagChange={(val) => {
                                    setSelectedTag(val === selectedTag ? '' : val);
                                    setCurrentPage(1);
                                }}
                                timeStart={timeStart}
                                onTimeStartChange={(val) => {
                                    setTimeStart(val);
                                    setCurrentPage(1);
                                }}
                                timeEnd={timeEnd}
                                onTimeEndChange={(val) => {
                                    setTimeEnd(val);
                                    setCurrentPage(1);
                                }}
                                limit={pageSize}
                                onLimitChange={(val) => {
                                    setPageSize(val);
                                    setCurrentPage(1);
                                }}
                                onClearFilters={() => {
                                    setSelectedStatus('');
                                    setSelectedTag('');
                                    setTimeStart('');
                                    setTimeEnd('');
                                    setCurrentPage(1);
                                }}
                            />
                        </div>
                    </div>
                </div>

                <div className="overflow-x-auto custom-scrollbar border-b border-slate-50">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50/50 border-b border-slate-100">
                                {isSelectingForBulk && (
                                    <th className="px-6 py-5 text-[11px] font-black text-slate-400 uppercase tracking-[0.15em] text-center w-16">
                                        <input
                                            type="checkbox"
                                            onChange={handleSelectAll}
                                            checked={atendimentos.length > 0 && atendimentos.every(at => selectedIds.includes(at.id))}
                                            className="rounded-lg border-slate-200 text-blue-600 focus:ring-blue-500/20 cursor-pointer h-5 w-5"
                                        />
                                    </th>
                                )}
                                <th className="px-6 py-5 text-[11px] font-black text-slate-400 uppercase tracking-[0.15em]">Contato</th>
                                <th className="px-6 py-5 text-[11px] font-black text-slate-400 uppercase tracking-[0.15em]">Atualização</th>
                                <th className="px-6 py-5 text-[11px] font-black text-slate-400 uppercase tracking-[0.15em] text-center">Status</th>
                                <th className="px-6 py-5 text-[11px] font-black text-slate-400 uppercase tracking-[0.15em]">Categorias</th>
                                <th className="px-6 py-5 text-[11px] font-black text-slate-400 uppercase tracking-[0.15em]">Inteligência / Resumo</th>
                                <th className="px-6 py-5 text-[11px] font-black text-slate-400 uppercase tracking-[0.15em] text-center">Agente</th>
                                <th className="px-6 py-5 text-[11px] font-black text-slate-400 uppercase tracking-[0.15em] text-center">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={isSelectingForBulk ? "8" : "7"} className="px-6 py-20 text-center">
                                        <div className="flex flex-col items-center gap-3 opacity-40">
                                            <Loader2 size={32} className="animate-spin text-blue-600" />
                                            <p className="text-[11px] font-black uppercase tracking-widest">Sincronizando Atendimentos...</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                (atendimentos || []).map((at) => {
                                    const renderProps = getStatusStyleAndClass(at.status);
                                    const initials = (at.nome_contato || at.whatsapp || '??').substring(0, 2).toUpperCase();
                                    const isSelected = selectedIds.includes(at.id);

                                    return (
                                        <tr key={at.id}
                                            className={`atend-table-row group cursor-pointer ${isSelected ? 'selected' : ''}`}
                                            onDoubleClick={() => navigate(`/mensagens?atendimentoId=${at.id}`)}
                                        >
                                            {isSelectingForBulk && (
                                                <td className="px-6 py-5 text-center" onClick={(e) => e.stopPropagation()}>
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={(e) => handleSelectOne(e, at.id)}
                                                        className="rounded-lg border-slate-200 text-blue-600 focus:ring-blue-500/20 cursor-pointer h-5 w-5"
                                                    />
                                                </td>
                                            )}
                                            <td className="px-6 py-5">
                                                <div className="flex items-center gap-4">
                                                    <div className="avatar-circle" style={{ backgroundColor: `${renderProps.style?.backgroundColor || '#3b82f6'}15`, color: renderProps.style?.backgroundColor || '#3b82f6' }}>
                                                        {initials}
                                                    </div>
                                                    <div className="flex flex-col min-w-0">
                                                        <span className="text-sm font-bold text-slate-900 truncate leading-tight">
                                                            {at.nome_contato || at.whatsapp}
                                                        </span>
                                                        {at.nome_contato && (
                                                            <span className="text-[11px] font-bold text-slate-400 mt-0.5 tracking-tight">{at.whatsapp}</span>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-5">
                                                <div className="flex flex-col">
                                                    <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700">
                                                        <Clock size={12} className="text-blue-500" />
                                                        {at.updated_at ? new Date(at.updated_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}
                                                    </div>
                                                    <span className="text-[10px] text-slate-400 font-medium mt-0.5">
                                                        {at.updated_at ? new Date(at.updated_at).toLocaleDateString('pt-BR') : ''}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-5 text-center">
                                                <span className="inline-flex items-center px-3 py-1 text-[10px] font-black uppercase tracking-widest rounded-full"
                                                    style={{ backgroundColor: `${renderProps.style?.backgroundColor}10`, color: renderProps.style?.backgroundColor, border: `1px solid ${renderProps.style?.backgroundColor}25` }}>
                                                    {at.status ?? 'N/A'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-5">
                                                <div className="flex flex-wrap gap-1.5 max-w-[150px]">
                                                    {(at.tags && atendimentos.length > 0 && at.tags.length > 0) ? (
                                                        at.tags.slice(0, 2).map(tag => (
                                                            <span key={tag.name} className="px-2 py-0.5 text-[9px] font-black uppercase tracking-tight text-white rounded-md shadow-sm" style={{ backgroundColor: tag.color }}>
                                                                {tag.name}
                                                            </span>
                                                        ))
                                                    ) : <span className="text-[10px] text-slate-300 font-bold uppercase tracking-tighter">Sem Tags</span>}
                                                    {at.tags?.length > 2 && <span className="text-[9px] font-black text-slate-400">+{at.tags.length - 2}</span>}
                                                </div>
                                            </td>
                                            <td className="px-6 py-5">
                                                <div className="expand-cell">
                                                    {at.resumo ? (
                                                        <p title={at.resumo} className="text-[13px] text-slate-600 line-clamp-2 leading-relaxed font-medium italic opacity-80 group-hover:opacity-100 transition-all">
                                                            "{at.resumo}"
                                                        </p>
                                                    ) : (
                                                        <span className="text-[11px] text-slate-300 font-bold uppercase tracking-tighter">Aguardando Análise...</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-5 text-center">
                                                <div className="inline-flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-100 shadow-sm transition-colors">
                                                    <Bot size={14} className="text-blue-600" />
                                                    <span className="text-[11px] font-black text-slate-700 tracking-tight">
                                                        {getPersonaNameById(at.active_persona_id)}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-5 text-center">
                                                <div className="flex justify-center items-center gap-1 transition-opacity">
                                                    <button onClick={(e) => { e.stopPropagation(); setModalData({ type: 'conversation', data: at }); }} className="w-9 h-9 flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-white hover:shadow-md border border-transparent hover:border-slate-100 rounded-xl transition-all" title="Ver conversa"><MessageSquare size={16} /></button>
                                                    <button onClick={(e) => { e.stopPropagation(); setModalData({ type: 'edit', data: at }); }} className="w-9 h-9 flex items-center justify-center text-slate-400 hover:text-emerald-600 hover:bg-white hover:shadow-md border border-transparent hover:border-slate-100 rounded-xl transition-all" title="Editar"><Edit size={16} /></button>
                                                    <button onClick={(e) => { e.stopPropagation(); setModalData({ type: 'delete', data: at }); }} className="w-9 h-9 flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-white hover:shadow-md border border-transparent hover:border-slate-100 rounded-xl transition-all" title="Apagar"><Trash2 size={16} /></button>
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })
                            )}
                        </tbody>
                    </table>

                    {/* Mensagem de "Não encontrado" */}
                    {!isLoading && (!atendimentos || atendimentos.length === 0) && (
                        <div className="py-20 text-center">
                            <div className="flex flex-col items-center gap-4 opacity-30">
                                <Search size={48} className="text-slate-200" strokeWidth={1} />
                                <p className="text-sm font-black uppercase tracking-[0.2em] text-slate-400">
                                    Nenhum registro encontrado {searchTerm ? 'para esta pesquisa' : ''}
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Controles de Paginação */}
                {/* Renderiza mesmo se isLoading for true para evitar CLS, mas botões ficam desabilitados pelo componente Pagination */}
                <div className="rounded-b-[2.5rem] overflow-hidden">
                    <Pagination
                        currentPage={currentPage}
                        totalPages={totalPages}
                        onPageChange={handlePageChange}
                        totalItems={totalAtendimentos}
                    />
                </div>
            </div>

            {/* Modais */}
            {modalData.type === 'conversation' && modalData.data && <ConversationModal onClose={handleCloseModals} conversation={modalData.data.conversa} contactIdentifier={modalData.data.nome_contato || modalData.data.whatsapp} />}
            {modalData.type === 'edit' && modalData.data && <EditModal onClose={handleCloseModals} atendimento={modalData.data} personas={personas} statusOptions={statusOptions} onSave={handleSaveEdit} allTags={allTags} setAllTags={setAllTags} />}
            {modalData.type === 'delete' && modalData.data && <DeleteConfirmationModal onClose={handleCloseModals} atendimento={modalData.data} onConfirm={handleConfirmDelete} />}
            {isCreateModalOpen && <CreateModal onClose={() => setIsCreateModalOpen(false)} onSave={handleCreate} personas={personas} statusOptions={statusOptions} allTags={allTags} setAllTags={setAllTags} />}
        </div>
    );
}

export default Atendimentos;