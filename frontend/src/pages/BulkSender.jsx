import React, { useState, useEffect, useMemo, useRef } from 'react';
import api from '../api/axiosConfig';
import toast from 'react-hot-toast';
import { useLocation, useNavigate } from 'react-router-dom';
import { Send, FileText, Users, Upload, Loader2, Info, CheckCircle, Search, FileImage, FileVideo, File as FileIcon, LayoutGrid, Plus, ExternalLink, Reply, Zap } from 'lucide-react';
import PageLoader from '../components/common/PageLoader';

import TemplateModal from '../components/mensagens/TemplateModal';
import CreateTemplateModal from '../components/mensagens/CreateTemplateModal';

// --- DESIGN SYSTEM & COMPONENTE DE PREVIEW ---
const DS_STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800;900&family=Inter:wght@400;500;600&display=swap');
.bulk-page { font-family: 'Inter', sans-serif; }
.bulk-page h1, .bulk-page h2, .bulk-page h3, .bulk-page h4 { font-family: 'Plus Jakarta Sans', sans-serif; }
.bulk-input {
    width: 100%;
    padding: 0.75rem 1rem;
    font-size: 0.875rem;
    border-radius: 1rem;
    background: #f8faff;
    border: 1px solid rgba(203,213,225,0.6);
    color: #0f172a;
    outline: none;
    transition: all 0.2s;
}
.bulk-input:focus { border-color: #3b82f6; box-shadow: 0 0 0 4px rgba(59,130,246,0.1); background: #fff; }
.premium-tile {
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.premium-tile:hover { transform: translateY(-2px); }
`;

// --- COMPONENTE DE PREVIEW ---
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

    const headerMedia = useMemo(() => {
        if (!template) return null;
        const header = template.components.find(c => c.type === 'HEADER');
        if (!header || header.format === 'TEXT') return null;
        return header.format;
    }, [template]);

    const buttons = useMemo(() => {
        if (!template) return [];
        return template.components.find(c => c.type === 'BUTTONS')?.buttons || [];
    }, [template]);

    if (!template) return null;

    return (
        <div className="flex flex-col w-full items-center">
            <div className="relative w-full p-2.5 rounded-2xl shadow-xl shadow-slate-200/50 break-words bg-white text-slate-800" style={{ border: '1px solid rgba(226,232,240,0.8)' }}>
                {headerMedia && (
                    <div
                        className="group relative mb-3 bg-slate-50 rounded-xl aspect-video flex flex-col items-center justify-center border border-dashed border-slate-200 text-slate-400 overflow-hidden cursor-pointer hover:bg-slate-100 transition-all shadow-inner"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <input
                            type="file"
                            ref={fileInputRef}
                            className="hidden"
                            onChange={(e) => onFileChange(e.target.files[0])}
                            accept={headerMedia === 'IMAGE' ? 'image/*' : headerMedia === 'VIDEO' ? 'video/*' : '*/*'}
                        />
                        {headerFile ? (
                            headerFile.type.startsWith('image/') ? (
                                <img src={URL.createObjectURL(headerFile)} alt="Header preview" className="w-full h-full object-cover" />
                            ) : (
                                <div className="flex flex-col items-center gap-1 p-4">
                                    <FileIcon size={32} className="text-blue-500" />
                                    <span className="text-[10px] font-bold text-slate-500 truncate w-full text-center">{headerFile.name}</span>
                                </div>
                            )
                        ) : (
                            <div className="flex flex-col items-center gap-2">
                                <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-sm">
                                    {headerMedia === 'IMAGE' && <FileImage size={20} className="text-blue-500" />}
                                    {headerMedia === 'VIDEO' && <FileVideo size={20} className="text-blue-500" />}
                                    {headerMedia === 'DOCUMENT' && <FileIcon size={20} className="text-blue-500" />}
                                </div>
                                <span className="text-[9px] uppercase font-black tracking-widest text-slate-400">Anexar {headerMedia}</span>
                            </div>
                        )}
                        {headerFile && (
                            <div className="absolute inset-0 bg-blue-600/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <Upload size={24} className="text-white" />
                            </div>
                        )}
                    </div>
                )}

                <div className="px-2">
                    {renderBody()}
                </div>

                {buttons.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-slate-50 space-y-2">
                        {buttons.map((btn, idx) => (
                            <div key={idx} className="bg-slate-50/50 py-2.5 text-center text-blue-600 text-[11px] font-bold rounded-xl border border-slate-100 hover:bg-blue-50 transition-colors flex items-center justify-center gap-2">
                                {btn.type === 'QUICK_REPLY' && <Reply size={14} />}
                                {btn.type === 'URL' && <ExternalLink size={14} />}
                                <span>{btn.text}</span>
                            </div>
                        ))}
                    </div>
                )}

                <div className="flex justify-end mt-2 px-2">
                    <span className="text-[9px] font-bold text-slate-300 uppercase tracking-tighter">
                        {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                </div>
            </div>
        </div>
    );
};

function BulkSender() {
    const location = useLocation();
    const navigate = useNavigate();

    // -- INÍCIO DA LÓGICA DE PERSISTÊNCIA --
    const savedState = useMemo(() => {
        const saved = sessionStorage.getItem('bulkSenderState');
        if (saved) {
            try { return JSON.parse(saved); } catch (e) { return {}; }
        }
        return {};
    }, []);

    const [templates, setTemplates] = useState([]);
    const [personas, setPersonas] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [issubmitting, setIsSubmitting] = useState(false);

    // Form state
    const [selectedTemplate, setSelectedTemplate] = useState(savedState.selectedTemplate || '');
    const [selectedPersona, setSelectedPersona] = useState(savedState.selectedPersona || '');
    const [variables, setVariables] = useState(savedState.variables || {});
    const [observacoes, setObservacoes] = useState(savedState.observacoes || '');
    const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false); // Estado novo
    const [contactCount, setContactCount] = useState(0);
    const [file, setFile] = useState(null);
    const [headerFile, setHeaderFile] = useState(null);
    const [selectedIds, setSelectedIds] = useState(location.state?.selectedIds || savedState.selectedIds || []);

    // Efeito para salvar o estado no sessionStorage
    useEffect(() => {
        const stateToSave = {
            selectedTemplate,
            selectedPersona,
            variables,
            observacoes,
            selectedIds
        };
        sessionStorage.setItem('bulkSenderState', JSON.stringify(stateToSave));
    }, [selectedTemplate, selectedPersona, variables, observacoes, selectedIds]);
    // -- FIM DA LÓGICA DE PERSISTÊNCIA --

    const activeTemplate = useMemo(() => {
        return templates.find(t => t.name === selectedTemplate);
    }, [templates, selectedTemplate]);

    const headerMediaType = useMemo(() => {
        if (!activeTemplate) return null;
        const header = activeTemplate.components.find(c => c.type === 'HEADER');
        if (!header || header.format === 'TEXT') return null;
        return header.format; // IMAGE, VIDEO, DOCUMENT
    }, [activeTemplate]);

    const variableNames = useMemo(() => {
        if (!activeTemplate) return [];
        const headerText = activeTemplate.components.find(c => c.type === 'HEADER' && c.format === 'TEXT')?.text || '';
        const bodyText = activeTemplate.components.find(c => c.type === 'BODY')?.text || '';
        const buttons = activeTemplate.components.find(c => c.type === 'BUTTONS')?.buttons || [];
        const buttonsText = buttons.map(b => b.url || '').join(' ');
        const combinedText = `${headerText} ${bodyText} ${buttonsText}`;
        const matches = combinedText.match(/{{\s*(\w+)\s*}}/g) || [];
        return [...new Set(matches.map(v => v.replace(/[{}]/g, '').trim()))];
    }, [activeTemplate]);

    useEffect(() => {
        setVariables(prev => {
            const newVars = { ...prev };
            let hasChanges = false;

            variableNames.forEach(name => {
                if (newVars[name] === undefined) {
                    newVars[name] = '';
                    hasChanges = true;
                }
            });

            Object.keys(newVars).forEach(name => {
                if (!variableNames.includes(name)) {
                    delete newVars[name];
                    hasChanges = true;
                }
            });

            return hasChanges ? newVars : prev;
        });
    }, [variableNames]);

    const fetchInitialData = async () => {
        try {
            const [templatesRes, personasRes] = await Promise.all([
                api.get('/atendimentos/whatsapp/templates'),
                api.get('/configs/')
            ]);
            setTemplates(templatesRes.data.filter(t => t.status === 'APPROVED' || t.status === 'ACTIVE'));
            setPersonas(personasRes.data);
            if (personasRes.data.length > 0) {
                setSelectedPersona(prev => prev || personasRes.data[0].id);
            }
        } catch (error) {
            toast.error("Erro ao carregar templates ou personas.");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchInitialData();
    }, []);

    // --- Função para processar a seleção vinda do Modal ---
    const handleTemplateFromModal = async (formData) => {
        try {
            const payload = JSON.parse(formData.get('payload_json'));
            const mediaFile = formData.get('file');

            // 1. Define o template selecionado
            setSelectedTemplate(payload.template_name);

            // 2. Define o arquivo de mídia se houver
            if (mediaFile) setHeaderFile(mediaFile);

            // 3. Reconstrói o dicionário de variáveis para o formulário do Bulk
            const allParams = [];
            (payload.components || []).forEach(c => {
                if (c.parameters) {
                    c.parameters.forEach(p => {
                        if (p.type === 'text') allParams.push(p.text);
                    });
                }
            });

            const activeTemp = templates.find(t => t.name === payload.template_name);
            if (activeTemp) {
                const headerText = activeTemp.components.find(c => c.type === 'HEADER' && c.format === 'TEXT')?.text || '';
                const bodyText = activeTemp.components.find(c => c.type === 'BODY')?.text || '';
                const buttonsText = (activeTemp.components.find(c => c.type === 'BUTTONS')?.buttons || []).map(b => b.url || '').join(' ');
                const combinedText = `${headerText} ${bodyText} ${buttonsText}`;
                const matches = combinedText.match(/{{\s*(\w+)\s*}}/g) || [];
                const names = [...new Set(matches.map(v => v.replace(/[{}]/g, '').trim()))];

                const updatedVars = {};
                names.forEach((name, index) => { if (allParams[index] !== undefined) updatedVars[name] = allParams[index]; });
                setVariables(updatedVars);
            }
            toast.success("Template e variáveis importados da galeria!");
        } catch (err) { console.error("Erro ao importar do modal:", err); }
    };

    const handleCsvFileChange = (e) => {
        const selectedFile = e.target.files[0];
        setFile(selectedFile);

        if (selectedFile) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const text = event.target.result;
                // Divide por linhas e remove linhas vazias
                const rows = text.split(/\r?\n/).filter(row => row.trim().length > 0);
                // Desconta o cabeçalho (esperado: whatsapp, nome)
                const count = Math.max(0, rows.length - 1);
                setContactCount(count);
            };
            reader.readAsText(selectedFile);
        } else {
            setContactCount(0);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const allVarsFilled = Object.values(variables).every(v => v.trim() !== '');

        if ((!file && selectedIds.length === 0) || !selectedTemplate || !selectedPersona || !allVarsFilled) {
            toast.error("Forneça um arquivo CSV ou selecione os atendimentos e preencha todos os campos do template.");
            return;
        }

        if (headerMediaType && !headerFile) {
            toast.error(`O template selecionado exige um arquivo de ${headerMediaType.toLowerCase()}.`);
            return;
        }

        setIsSubmitting(true);

        const buildComponent = (type, text) => {
            const params = (text.match(/{{\s*(\w+)\s*}}/g) || []).map(match => {
                const varName = match.replace(/[{}]/g, '').trim();
                return { type: 'text', text: variables[varName] };
            });
            if (params.length === 0) return null;
            return { type, parameters: params };
        };

        const headerComp = activeTemplate.components.find(c => c.type === 'HEADER' && c.format === 'TEXT');
        const bodyComp = activeTemplate.components.find(c => c.type === 'BODY');
        const btnComp = activeTemplate.components.find(c => c.type === 'BUTTONS');

        const components = [
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

        const formData = new FormData();
        if (file) formData.append('file', file);
        if (selectedIds.length > 0) formData.append('atendimento_ids', JSON.stringify(selectedIds));
        if (headerFile) formData.append('media_file', headerFile);
        formData.append('template_name', selectedTemplate);
        formData.append('persona_id', selectedPersona);
        formData.append('template_params', JSON.stringify({ components }));
        if (observacoes) formData.append('observacoes', observacoes);

        try {
            const response = await api.post('/atendimentos/bulk', formData);
            toast.success(response.data.message || "Disparos enfileirados com sucesso!");

            const hadSelectedIds = selectedIds.length > 0;

            setFile(null);
            setHeaderFile(null);
            setObservacoes('');
            setContactCount(0);
            setSelectedIds([]);
            setSelectedTemplate('');
            setVariables({});
            sessionStorage.removeItem('bulkSenderState');

            if (hadSelectedIds) {
                // Retorna à página de atendimentos após o sucesso se veio de lá
                setTimeout(() => {
                    navigate('/atendimentos');
                }, 2000);
            }

            // Reseta o input de arquivo manualmente
            if (document.getElementById('csv-upload')) {
                document.getElementById('csv-upload').value = '';
            }
        } catch (error) {
            toast.error(error.response?.data?.detail || "Erro ao processar disparos.");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isLoading) {
        return <PageLoader message="Carregando Galeria" subMessage="Preparando templates e campanhas..." />;
    }

    return (
        <div className="p-3 sm:p-6 md:p-10 bg-[#f8faff] h-full overflow-y-auto custom-scrollbar bulk-page">
            <style>{DS_STYLE}</style>
            <style>{`
                .custom-scrollbar::-webkit-scrollbar { width: 8px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(203, 213, 225, 1); border-radius: 20px; border: 2px solid transparent; background-clip: padding-box; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #3b82f6; background-clip: padding-box; }
            `}</style>
            <div className="mx-auto max-w-7xl">
                <div className="mb-6 sm:mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-200 shrink-0">
                                <Zap size={22} className="text-white sm:hidden" />
                                <Zap size={24} className="text-white hidden sm:block" />
                            </div>
                            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-tight">
                                Disparos <span className="text-blue-600">Inteligentes</span>
                            </h1>
                        </div>
                        <p className="text-slate-500 font-medium text-xs sm:text-sm flex items-center gap-2">
                            <Info size={14} className="text-blue-400" /> Orchestre campanhas com precisão executiva.
                        </p>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-10">
                    {/* Painel de Configuração */}
                    <div className="lg:col-span-7 space-y-6 sm:space-y-8">
                        {/* Seção 1: O Que Enviar */}
                        <div className="bg-white p-5 sm:p-8 rounded-[1.5rem] sm:rounded-[2rem] shadow-sm border border-slate-100/50 relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50/50 rounded-full -mr-16 -mt-16 blur-3xl opacity-50"></div>

                            <div className="relative z-10 space-y-6 sm:space-y-8">
                                <h4 className="text-[10px] sm:text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4">01. Configurações de Envio</h4>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                    <div className="col-span-1 sm:col-span-2">
                                        <div className="flex items-center justify-between mb-3 px-1">
                                            <label className="text-[13px] font-bold text-slate-700 flex items-center gap-2">
                                                <FileText size={16} className="text-blue-500" /> Template da Meta
                                            </label>
                                            <button type="button" onClick={() => setIsCreateModalOpen(true)} className="text-[11px] text-blue-600 font-black uppercase tracking-tight hover:text-blue-800 transition-colors flex items-center gap-1.5">
                                                <Plus size={14} /> Novo Template
                                            </button>
                                        </div>
                                        <div className="relative">
                                            <select
                                                value={selectedTemplate}
                                                onChange={e => setSelectedTemplate(e.target.value)}
                                                className="bulk-input appearance-none pr-10"
                                                required
                                            >
                                                <option value="">Selecione um template aprovado...</option>
                                                {templates.map(t => (
                                                    <option key={t.name} value={t.name}>{t.name} ({t.language})</option>
                                                ))}
                                            </select>
                                            <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none text-slate-400">
                                                <LayoutGrid size={16} />
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-[13px] font-bold text-slate-700 mb-3 px-1 flex items-center gap-2">
                                            <Users size={16} className="text-blue-500" /> Persona Ativa
                                        </label>
                                        <select
                                            value={selectedPersona}
                                            onChange={e => setSelectedPersona(e.target.value)}
                                            className="bulk-input"
                                            required
                                        >
                                            {personas.map(p => (
                                                <option key={p.id} value={p.id}>{p.nome_config}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-[13px] font-bold text-slate-700 mb-3 px-1 flex items-center gap-2">
                                            <CheckCircle size={16} className="text-blue-500" /> Status do Atendimento
                                        </label>
                                        <div className="bulk-input bg-slate-50/50 flex items-center gap-2 text-slate-400">
                                            Auto-inicializado
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Seção 2: Para Quem Enviar */}
                        <div className="bg-white p-5 sm:p-8 rounded-[1.5rem] sm:rounded-[2rem] shadow-sm border border-slate-100/50">
                            <h4 className="text-[10px] sm:text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6 sm:mb-8">02. Seleção de Destinatários</h4>

                            <div className="grid grid-cols-2 gap-3 sm:gap-5">
                                {/* Opção: Buscar na Base */}
                                <div onClick={() => navigate('/atendimentos', { state: { isSelectingForBulk: true, selectedIds } })}
                                    className={`premium-tile cursor-pointer p-4 sm:p-6 rounded-2xl sm:rounded-3xl border-2 transition-all flex flex-col items-center text-center ${selectedIds.length > 0 ? 'border-blue-500 bg-blue-50/30' : 'border-slate-100 bg-slate-50/50'}`}>
                                    <div className={`w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl flex items-center justify-center mb-3 sm:mb-4 transition-all ${selectedIds.length > 0 ? 'bg-blue-600 text-white shadow-lg' : 'bg-white text-slate-400 shadow-sm'}`}>
                                        <Search size={20} className="sm:hidden" />
                                        <Search size={22} className="hidden sm:block" />
                                    </div>
                                    <h5 className="font-black text-slate-800 text-[12px] sm:text-sm mb-1 leading-tight text-center">Base Interna</h5>
                                    
                                    {selectedIds.length > 0 && (
                                        <div className="mt-2 text-blue-600 text-[9px] font-black uppercase tracking-wider">
                                            {selectedIds.length} selecionados
                                        </div>
                                    )}
                                </div>

                                {/* Opção: Planilha Externa */}
                                <label className={`premium-tile cursor-pointer p-4 sm:p-6 rounded-2xl sm:rounded-3xl border-2 transition-all flex flex-col items-center text-center ${file ? 'border-indigo-500 bg-indigo-50/30' : 'border-slate-100 bg-slate-50/50'}`}>
                                    <input type="file" accept=".csv" className="sr-only" onChange={handleCsvFileChange} />
                                    <div className={`w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl flex items-center justify-center mb-3 sm:mb-4 transition-all ${file ? 'bg-indigo-600 text-white shadow-lg' : 'bg-white text-slate-400 shadow-sm'}`}>
                                        <Upload size={20} className="sm:hidden" />
                                        <Upload size={22} className="hidden sm:block" />
                                    </div>
                                    <h5 className="font-black text-slate-800 text-[12px] sm:text-sm mb-1 leading-tight text-center">Planilha CSV</h5>
                                    
                                    {file && (
                                        <div className="mt-2 text-indigo-600 text-[9px] font-black uppercase tracking-wider truncate max-w-full">
                                            {file.name}
                                        </div>
                                    )}
                                </label>
                            </div>

                            <div className="mt-6 p-4 bg-slate-50/50 rounded-2xl flex items-center justify-between border border-slate-100">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center text-blue-600 shadow-sm">
                                        <Users size={16} />
                                    </div>
                                    <span className="text-xs font-bold text-slate-600">Total de Destinatários</span>
                                </div>
                                <span className="text-xl font-black text-slate-900 tracking-tighter">
                                    {selectedIds.length + contactCount}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Coluna de Visualização */}
                    <div className="lg:col-span-5 space-y-6">
                        <div className="bg-white rounded-[1.5rem] sm:rounded-[2rem] shadow-sm border border-slate-100/50 overflow-hidden flex flex-col h-full sm:min-h-[600px]">
                            <div className="p-5 sm:p-6 border-b border-slate-50 flex items-center justify-between bg-white">
                                <h4 className="text-[10px] sm:text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Visualização</h4>
                                <div className="flex gap-1">
                                    <div className="w-2.5 h-2.5 rounded-full bg-slate-100"></div>
                                    <div className="w-2.5 h-2.5 rounded-full bg-slate-100"></div>
                                    <div className="w-2.5 h-2.5 rounded-full bg-slate-100"></div>
                                </div>
                            </div>

                            <div className="flex-1 p-5 sm:p-8 bg-[#fdfdfd] flex flex-col items-center justify-center overflow-y-auto custom-scrollbar" style={{ background: 'linear-gradient(rgba(248, 250, 252, 0.95), rgba(248, 250, 252, 0.95)), url("https://static.vecteezy.com/system/resources/previews/021/736/713/non_2x/doodle-lines-arrows-circles-and-curves-hand-drawn-design-elements-isolated-on-white-background-for-infographic-illustration-vector.jpg")', backgroundSize: 'cover' }}>
                                {activeTemplate ? (
                                    <div className="w-full max-w-sm animate-fade-in">
                                        <TemplatePreview
                                            template={activeTemplate}
                                            variables={variables}
                                            headerFile={headerFile}
                                            onVariableChange={(name, value) => setVariables(prev => ({ ...prev, [name]: value }))}
                                            onFileChange={setHeaderFile}
                                        />

                                        <div className="mt-8 space-y-4">
                                            <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center px-4">Configuração das Variáveis</h5>
                                            {variableNames.length > 0 ? (
                                                <div className="grid grid-cols-1 gap-3 px-2">
                                                    {variableNames.map(name => (
                                                        <div key={name} className="flex flex-col gap-1">
                                                            <span className="text-[10px] font-bold text-slate-400 ml-3">{name}</span>
                                                            <input
                                                                type="text"
                                                                value={variables[name] || ''}
                                                                onChange={e => setVariables(prev => ({ ...prev, [name]: e.target.value }))}
                                                                placeholder={`Filtro ${name}...`}
                                                                className="bulk-input bg-white !rounded-xl !py-2 text-xs"
                                                            />
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p className="text-[11px] text-slate-400 text-center font-medium italic">Template sem variáveis customizáveis.</p>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center text-center max-w-[200px] gap-4">
                                        <div className="w-20 h-20 rounded-3xl bg-white flex items-center justify-center shadow-xl shadow-slate-200/50">
                                            <FileText size={40} className="text-slate-100" strokeWidth={1} />
                                        </div>
                                        <p className="text-xs text-slate-400 font-bold uppercase tracking-widest leading-loose">Selecione um template para configurar</p>
                                    </div>
                                )}
                            </div>

                            <div className="p-5 sm:p-8 border-t border-slate-50">
                                <button
                                    type="submit"
                                    disabled={issubmitting}
                                    className="w-full h-14 sm:h-16 flex items-center justify-center gap-3 sm:gap-4 text-white rounded-2xl sm:rounded-3xl font-black text-base sm:text-lg transition-all shadow-xl shadow-blue-500/20 active:scale-[0.98] disabled:opacity-50 hover:shadow-2xl hover:-translate-y-1"
                                    style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}
                                >
                                    {issubmitting ? <Loader2 className="animate-spin" /> : <Send size={18} sm:size={20} />}
                                    {issubmitting ? 'Processando...' : 'Iniciar Sequência de Disparos'}
                                </button>
                                <p className="text-[10px] text-slate-300 font-bold uppercase tracking-widest text-center mt-4">
                                    Custo estimado: R$ {((selectedIds.length + contactCount) * 0.50).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </p>
                            </div>
                        </div>
                    </div>
                </form>
            </div>

            <TemplateModal isOpen={isTemplateModalOpen} onClose={() => setIsTemplateModalOpen(false)} onSend={handleTemplateFromModal} />
            <CreateTemplateModal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} onCreated={fetchInitialData} />
            <div className="py-10"></div>
        </div>
    );
}

export default BulkSender;