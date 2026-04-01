import React, { useState, useEffect, useMemo, useRef } from 'react';
import api from '../api/axiosConfig';
import toast from 'react-hot-toast';
import { useLocation, useNavigate } from 'react-router-dom';
import { Send, FileText, Users, Upload, Loader2, Info, CheckCircle, Search, FileImage, FileVideo, File as FileIcon, LayoutGrid, Plus, ExternalLink, Reply } from 'lucide-react';
import TemplateModal from '../components/mensagens/TemplateModal';
import CreateTemplateModal from '../components/mensagens/CreateTemplateModal';

// --- COMPONENTE DE PREVIEW ---
const TemplatePreview = ({ template, variables, headerFile, onVariableChange, onFileChange }) => {
    const fileInputRef = useRef(null);

    const renderBody = () => {
        if (!template) return '';
        const header = template.components.find(c => c.type === 'HEADER' && c.format === 'TEXT')?.text || '';
        const body = template.components.find(c => c.type === 'BODY')?.text || '';
        const combinedText = `${header}\n${body}`.trim();

        if (!combinedText) return null;

        // Divide o texto pelas variáveis {{nome}} para torná-las editáveis
        const parts = combinedText.split(/({{\s*\w+\s*}})/g);
        
        return (
            <div className="whitespace-pre-wrap text-sm leading-relaxed">
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
                                className="bg-white/40 border-gray-400 text-gray-900 focus:bg-white focus:outline-none focus:border-gray-600 font-semibold transition-all rounded-sm inline-block"
                                style={{ 
                                    width: `${Math.max(((variables[varName] || match[0]).length) * 8, 40)}px`,
                                    minWidth: '40px',
                                    height: '1.2rem',
                                    verticalAlign: 'baseline'
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
        <div className="flex flex-col w-full gap-4">
            <div className="flex justify-start w-full">
                <div className="relative max-w-[90%] py-2 px-3 rounded-lg shadow-sm break-words bg-[#d9fdd3] text-gray-800 message-out min-w-[200px]">
                    {headerMedia && (
                        <div 
                            className="group relative mb-2 bg-black/5 rounded-md aspect-video flex flex-col items-center justify-center border border-dashed border-black/10 text-gray-500 overflow-hidden cursor-pointer hover:bg-black/10 transition-all"
                            title="Clique para carregar mídia"
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
                                        <FileIcon size={32} />
                                        <span className="text-[10px] text-center truncate w-full">{headerFile.name}</span>
                                    </div>
                                )
                            ) : (
                                <div className="flex flex-col items-center gap-1">
                                    {headerMedia === 'IMAGE' && <FileImage size={24} />}
                                    {headerMedia === 'VIDEO' && <FileVideo size={24} />}
                                    {headerMedia === 'DOCUMENT' && <FileIcon size={24} />}
                                    <span className="text-[10px] uppercase font-bold tracking-wider">{headerMedia}</span>
                                    <span className="text-[8px] opacity-0 group-hover:opacity-100 transition-opacity">Clique para carregar</span>
                                </div>
                            )}
                            {headerFile && (
                                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Upload size={24} className="text-white" />
                                </div>
                            )}
                        </div>
                    )}
                    
                    {renderBody()}
                    
                    {buttons.length > 0 && (
                        <div className="mt-2 -mx-3 -mb-2 flex flex-col border-t border-black/10">
                            {buttons.map((btn, idx) => (
                                <div key={idx} className="py-2.5 px-2 text-center text-[#00a884] text-sm font-medium border-b border-black/10 last:border-b-0 flex items-center justify-center gap-2">
                                    {btn.type === 'QUICK_REPLY' && <Reply size={16} className="opacity-80" />}
                                    {btn.type === 'URL' && <ExternalLink size={16} className="opacity-80" />}
                                    <span className="truncate">{btn.text}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    <span className="text-[10px] text-gray-400 float-right ml-2 mt-1">
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

    if (isLoading) return <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin" size={32} /></div>;

    return (
        <div className="p-6 md:p-10 bg-gray-50 min-h-full">
            <div className="max-w-5xl mx-auto">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-800 flex items-center gap-3">
                        <Send className="text-brand-primary" /> Disparos em Massa
                    </h1>
                    <p className="text-gray-500 mt-1">Envie templates para uma lista de contatos via CSV.</p>
                </div>

                <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="lg:col-span-1 bg-white p-8 rounded-xl shadow-lg border border-gray-200 space-y-6">
                        {/* Seleção de Template */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <label className="block text-sm font-semibold text-gray-700 flex items-center gap-2">
                                    <FileText size={16} /> Template da Meta (Oficial)
                                </label>
                                <button type="button" onClick={() => setIsCreateModalOpen(true)} className="text-xs text-brand-primary hover:text-blue-800 font-semibold flex items-center gap-1">
                                    <Plus size={12} /> Criar Novo
                                </button>
                            </div>
                            <div className="flex gap-2">
                                <select 
                                    value={selectedTemplate}
                                    onChange={e => setSelectedTemplate(e.target.value)}
                                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                                    required
                                >
                                    <option value="">Selecione um template aprovado...</option>
                                    {templates.map(t => (
                                        <option key={t.name} value={t.name}>{t.name} ({t.language})</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Seleção de Persona */}
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                                <Users size={16} /> Persona de Atendimento
                            </label>
                            <select 
                                value={selectedPersona}
                                onChange={e => setSelectedPersona(e.target.value)}
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                                required
                            >
                                {personas.map(p => (
                                    <option key={p.id} value={p.id}>{p.nome_config}</option>
                                ))}
                            </select>
                        </div>

                        {/* Upload CSV ou Seleção */}
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                                <Users size={16} /> Destinatários
                            </label>
                            
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {/* Opção 1: Selecionar Atendimentos */}
                                <div className={`flex flex-col items-center justify-center p-5 border-2 rounded-xl transition-all ${selectedIds.length > 0 ? 'border-brand-primary bg-blue-50/50' : 'border-gray-200 bg-gray-50 hover:border-brand-primary/50'}`}>
                                    <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-3 transition-colors ${selectedIds.length > 0 ? 'bg-brand-primary text-white shadow-md' : 'bg-gray-200 text-gray-500'}`}>
                                        <Search size={20} />
                                    </div>
                                    <h4 className="text-sm font-bold text-gray-800 mb-1">Buscar Existentes</h4>
                                    <p className="text-xs text-gray-500 text-center mb-4">Selecione contatos na plataforma</p>
                                    
                                    {selectedIds.length > 0 ? (
                                        <div className="flex flex-col w-full gap-3 animate-fade-in">
                                            <div className="flex items-center justify-center gap-2 text-sm font-bold text-brand-primary">
                                                <CheckCircle size={18} /> {selectedIds.length} selecionado(s)
                                            </div>
                                            <div className="flex gap-2 w-full">
                                                <button type="button" onClick={() => navigate('/atendimentos', { state: { isSelectingForBulk: true, selectedIds } })} className="flex-1 py-2 px-2 bg-white border border-gray-300 text-gray-700 rounded-md text-xs font-semibold hover:bg-gray-50 transition-colors shadow-sm">
                                                    Alterar
                                                </button>
                                                <button type="button" onClick={() => setSelectedIds([])} className="flex-1 py-2 px-2 bg-red-50 text-red-600 border border-red-100 rounded-md text-xs font-semibold hover:bg-red-100 transition-colors shadow-sm">
                                                    Limpar
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <button type="button" onClick={() => navigate('/atendimentos', { state: { isSelectingForBulk: true } })} className="w-full py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-semibold hover:border-brand-primary hover:text-brand-primary transition-colors shadow-sm">
                                            Selecionar Contatos
                                        </button>
                                    )}
                                </div>

                                {/* Opção 2: Carregar CSV */}
                                <div className={`flex flex-col items-center justify-center p-5 border-2 border-dashed rounded-xl transition-all ${file ? 'border-green-500 bg-green-50/50' : 'border-gray-300 bg-white hover:border-brand-primary/50'}`}>
                                    <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-3 transition-colors ${file ? 'bg-green-500 text-white shadow-md' : 'bg-gray-100 text-gray-400'}`}>
                                        <Upload size={20} />
                                    </div>
                                    <h4 className="text-sm font-bold text-gray-800 mb-1">Importar Planilha</h4>
                                    <p className="text-xs text-gray-500 text-center mb-4">Arquivo .csv ('whatsapp', 'nome')</p>

                                    {file ? (
                                        <div className="flex flex-col w-full gap-3 animate-fade-in">
                                            <div className="flex items-center justify-center gap-2 text-sm font-bold text-brand-primary truncate px-2" title={file.name}>
                                                <CheckCircle size={18} className="flex-shrink-0" /> <span className="truncate">{file.name}</span>
                                            </div>
                                            <div className="flex gap-2 w-full">
                                                <label htmlFor="csv-upload-change" className="flex-1 py-2 px-2 bg-white border border-gray-300 text-gray-700 rounded-md text-xs font-semibold hover:bg-gray-50 transition-colors text-center cursor-pointer shadow-sm">
                                                    Trocar
                                                    <input id="csv-upload-change" type="file" accept=".csv" className="sr-only" onChange={handleCsvFileChange} />
                                                </label>
                                                <button type="button" onClick={() => { setFile(null); setContactCount(0); if(document.getElementById('csv-upload')) document.getElementById('csv-upload').value = ''; if(document.getElementById('csv-upload-change')) document.getElementById('csv-upload-change').value = ''; }} className="flex-1 py-2 px-2 bg-red-50 text-red-600 border border-red-100 rounded-md text-xs font-semibold hover:bg-red-100 transition-colors shadow-sm">
                                                    Remover
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <label htmlFor="csv-upload" className="w-full py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-semibold hover:border-brand-primary hover:text-brand-primary transition-colors text-center cursor-pointer block shadow-sm">
                                            Carregar Arquivo
                                            <input id="csv-upload" type="file" accept=".csv" className="sr-only" onChange={handleCsvFileChange} />
                                        </label>
                                    )}
                                </div>
                            </div>

                            {/* Somatório Total - Simplificado */}
                            <div className="mt-3 flex justify-between items-center text-xs text-gray-500 px-1">
                                <span>Total de destinatários: <strong className="text-gray-700">{selectedIds.length + contactCount}</strong></span>
                                <span>Custo estimado: <strong className="text-gray-700">R$ {((selectedIds.length + contactCount) * 0.50).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
                            </div>
                        </div>

                        {/* Observações */}
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">Observações Internas</label>
                            <textarea 
                                value={observacoes}
                                onChange={e => setObservacoes(e.target.value)}
                                placeholder="Anotações que aparecerão nos atendimentos criados..."
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary h-16"
                            />
                        </div>
                    </div>

                    {/* Coluna de Preview */}
                    <div className="space-y-6">
                        <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden flex flex-col h-fit">
                            <h3 className="text-sm font-bold text-gray-800 p-4 border-b uppercase tracking-widest text-center bg-gray-50">Visualização e Configuração</h3>
                            {activeTemplate ? (
                                <div className="p-4 md:p-6 overflow-y-auto max-h-[550px] min-h-[550px] space-y-6 bg-brand-whatsapp-background">
                                    <TemplatePreview 
                                        template={activeTemplate} 
                                        variables={variables} 
                                        headerFile={headerFile} 
                                        onVariableChange={(name, value) => setVariables(prev => ({ ...prev, [name]: value }))}
                                        onFileChange={setHeaderFile}
                                    />
                                </div>
                            ) : (
                                <div className="max-h-[550px] min-h-[550px] flex flex-col items-center justify-center text-gray-400 border-2 border-dashed border-gray-100 rounded-xl gap-2">
                                    <FileText size={48} className="opacity-20" />
                                    <p className="text-xs text-center px-4">Selecione um template para ver como a mensagem será enviada.</p>
                                </div>
                            )}
                        </div>

                        <button
                            type="submit"
                            disabled={issubmitting}
                            className="w-full flex items-center justify-center gap-3 bg-brand-primary text-white p-4 rounded-xl font-bold text-lg hover:bg-brand-primary-dark transition-all shadow-lg disabled:bg-gray-400"
                        >
                            {issubmitting ? <Loader2 className="animate-spin" /> : <Send />}
                            {issubmitting ? 'Processando...' : 'Iniciar Disparos'}
                        </button>
                    </div>
                </form>
            </div>

            {/* Modal de Template Reutilizado */}
            <TemplateModal
                isOpen={isTemplateModalOpen}
                onClose={() => setIsTemplateModalOpen(false)}
                onSend={handleTemplateFromModal}
            />
            
            <CreateTemplateModal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} onCreated={fetchInitialData} />
        </div>
    );
}

export default BulkSender;