import React, { useState, useEffect, useMemo, useRef } from 'react';
import api from '../api/axiosConfig';
import toast from 'react-hot-toast';
import { Send, FileText, Users, Upload, Loader2, Info, CheckCircle, Search, FileImage, FileVideo, File as FileIcon, LayoutGrid } from 'lucide-react';
import TemplateModal from '../components/mensagens/TemplateModal';

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
                                placeholder={`{{${varName}}}`}
                                className="mx-0.5 px-1 bg-white/40 border-b border-blue-400 text-blue-700 focus:bg-white focus:outline-none focus:border-blue-600 font-semibold placeholder:text-blue-400 transition-all rounded-sm inline-block"
                                style={{ 
                                    width: `${Math.max(((variables[varName] || match[0]).length) * 8, 40)}px`,
                                    minWidth: '30px',
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
                    <div className="mt-3 pt-2 border-t border-black/5 space-y-1">
                        {buttons.map((btn, idx) => (
                            <div key={idx} className="bg-white/80 py-1.5 text-center text-blue-600 text-xs font-semibold rounded-md border border-black/5 shadow-sm">
                                {btn.text}
                            </div>
                        ))}
                    </div>
                )}

                <span className="text-[10px] text-gray-400 float-right ml-2 mt-1">
                    {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
            </div>
        </div>
    );
};

function BulkSender() {
    const [templates, setTemplates] = useState([]);
    const [personas, setPersonas] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [issubmitting, setIsSubmitting] = useState(false);

    // Form state
    const [selectedTemplate, setSelectedTemplate] = useState('');
    const [selectedPersona, setSelectedPersona] = useState('');
    const [variables, setVariables] = useState({});
    const [observacoes, setObservacoes] = useState('');
    const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
    const [contactCount, setContactCount] = useState(0);
    const [file, setFile] = useState(null);
    const [headerFile, setHeaderFile] = useState(null);

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
        const initialVars = variableNames.reduce((acc, name) => {
            acc[name] = '';
            return acc;
        }, {});
        setVariables(initialVars);
    }, [variableNames]);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [templatesRes, personasRes] = await Promise.all([
                    api.get('/atendimentos/whatsapp/templates'),
                    api.get('/configs/')
                ]);
                setTemplates(templatesRes.data.filter(t => t.status === 'APPROVED' || t.status === 'ACTIVE'));
                setPersonas(personasRes.data);
                if (personasRes.data.length > 0) setSelectedPersona(personasRes.data[0].id);
            } catch (error) {
                toast.error("Erro ao carregar templates ou personas.");
            } finally {
                setIsLoading(false);
            }
        };
        fetchData();
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
        
        if (!file || !selectedTemplate || !selectedPersona || !allVarsFilled) {
            toast.error("Preencha todos os campos obrigatórios.");
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
        formData.append('file', file);
        if (headerFile) formData.append('media_file', headerFile);
        formData.append('template_name', selectedTemplate);
        formData.append('persona_id', selectedPersona);
        formData.append('template_params', JSON.stringify({ components }));
        if (observacoes) formData.append('observacoes', observacoes);

        try {
            const response = await api.post('/atendimentos/bulk', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            toast.success(response.data.message);
            setFile(null);
            setHeaderFile(null);
            setObservacoes('');
            setContactCount(0);
            // Reseta o input de arquivo manualmente
            document.getElementById('csv-upload').value = '';
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
                        <Send className="text-brand-blue" /> Disparos em Massa
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
                            </div>
                            <select 
                                value={selectedTemplate}
                                onChange={e => setSelectedTemplate(e.target.value)}
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-blue focus:border-transparent"
                                required
                            >
                                <option value="">Selecione um template aprovado...</option>
                                {templates.map(t => (
                                    <option key={t.name} value={t.name}>{t.name} ({t.language})</option>
                                ))}
                            </select>
                        </div>

                        {/* Seleção de Persona */}
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                                <Users size={16} /> Persona de Atendimento
                            </label>
                            <select 
                                value={selectedPersona}
                                onChange={e => setSelectedPersona(e.target.value)}
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-blue focus:border-transparent"
                                required
                            >
                                {personas.map(p => (
                                    <option key={p.id} value={p.id}>{p.nome_config}</option>
                                ))}
                            </select>
                        </div>

                        {/* Upload CSV */}
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                                <Upload size={16} /> Importar Contatos (CSV)
                            </label>
                            <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-lg hover:border-brand-blue transition-colors">
                                <div className="space-y-1 text-center">
                                    <Upload className="mx-auto h-12 w-12 text-gray-400" />
                                    <div className="flex justify-center text-sm text-gray-600">
                                        <label htmlFor="csv-upload" className="relative cursor-pointer bg-white rounded-md font-medium text-brand-blue hover:text-brand-blue-dark">
                                            <span>Carregue um arquivo</span>
                                            <input 
                                                id="csv-upload" 
                                                name="csv-upload" 
                                                type="file" 
                                                accept=".csv" 
                                                className="sr-only" 
                                                onChange={handleCsvFileChange}
                                            />
                                        </label>
                                    </div>
                                    <p className="text-xs text-gray-500">CSV com colunas 'whatsapp' e 'nome'</p>
                                    {file && <p className="text-sm font-bold text-green-600 flex items-center justify-center gap-1 mt-2">
                                        <CheckCircle size={14} /> {file.name}
                                    </p>}

                                    {file && contactCount > 0 && (
                                        <div className="text-gray-500 text-xs flex justify-between px-4 animate-fade-in">
                                            <span>Contatos: <strong>{contactCount}</strong></span>
                                            <span>Custo aproximado: <strong>R$ {(contactCount * 0.50).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Observações */}
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">Observações Internas</label>
                            <textarea 
                                value={observacoes}
                                onChange={e => setObservacoes(e.target.value)}
                                placeholder="Anotações que aparecerão nos atendimentos criados..."
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-blue h-24"
                            />
                        </div>
                    </div>

                    {/* Coluna de Preview */}
                    <div className="space-y-6">
                        <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden flex flex-col h-fit">
                            <h3 className="text-sm font-bold text-gray-800 p-4 border-b uppercase tracking-widest text-center bg-gray-50">Visualização e Configuração</h3>
                            {activeTemplate ? (
                                <div
                                    className="p-4 md:p-6 overflow-y-auto max-h-[500px] min-h-[500px] space-y-6"
                                    style={{
                                        backgroundImage: `
                                        linear-gradient(rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0.9)),
                                        url('https://static.vecteezy.com/system/resources/previews/021/736/713/non_2x/doodle-lines-arrows-circles-and-curves-hand-drawn-design-elements-isolated-on-white-background-for-infographic-illustration-vector.jpg')
                                        `,
                                        backgroundSize: 'cover',
                                        backgroundPosition: 'center'
                                    }}
                                >
                                    <TemplatePreview 
                                        template={activeTemplate} 
                                        variables={variables} 
                                        headerFile={headerFile} 
                                        onVariableChange={(name, value) => setVariables(prev => ({ ...prev, [name]: value }))}
                                        onFileChange={setHeaderFile}
                                    />
                                </div>
                            ) : (
                                <div className="max-h-[500px] min-h-[500px] flex flex-col items-center justify-center text-gray-400 border-2 border-dashed border-gray-100 rounded-xl gap-2">
                                    <FileText size={48} className="opacity-20" />
                                    <p className="text-xs text-center px-4">Selecione um template para ver como a mensagem será enviada.</p>
                                </div>
                            )}
                        </div>

                        <button
                            type="submit"
                            disabled={issubmitting}
                            className="w-full flex items-center justify-center gap-3 bg-brand-blue text-white p-4 rounded-xl font-bold text-lg hover:bg-brand-blue-dark transition-all shadow-lg disabled:bg-gray-400"
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
        </div>
    );
}

export default BulkSender;