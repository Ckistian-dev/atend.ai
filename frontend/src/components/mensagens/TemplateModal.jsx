import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, Send, Loader2, AlertTriangle, Search, Upload, FileImage, FileVideo, File as FileIcon, Plus, ExternalLink, Reply } from 'lucide-react';
import api from '../../api/axiosConfig'; // Importa a configuração do Axios
import CreateTemplateModal from './CreateTemplateModal';

// --- NOVO: Componente da Barra Lateral ---
const TemplateSidebar = ({ templates, selectedTemplate, onSelect, searchTerm, setSearchTerm, onCreateClick }) => {
    const filteredTemplates = useMemo(() => {
        if (!searchTerm) return templates;
        return templates.filter(t => t.name.toLowerCase().includes(searchTerm.toLowerCase()));
    }, [templates, searchTerm]);

    return (
        <aside className="w-1/3 border-r bg-gray-50 flex flex-col min-h-0">
            {/* Barra de Busca */}
            <div className="p-3 border-b">
                <div className="flex gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                        <input
                            type="text"
                            placeholder="Buscar..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-9 pr-2 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-primary"
                        />
                    </div>
                    <button onClick={onCreateClick} className="p-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors" title="Criar novo template">
                        <Plus size={18} />
                    </button>
                </div>
            </div>

            {/* Lista de Templates */}
            <nav className="flex-1 overflow-y-auto">
                {filteredTemplates.length > 0 ? (
                    filteredTemplates.map(t => (
                        <button
                            key={t.name}
                            onClick={() => onSelect(t)}
                            className={`w-full text-left p-3 text-sm truncate transition-colors ${selectedTemplate?.name === t.name
                                ? 'bg-blue-100 text-brand-primary-active font-semibold'
                                : 'text-gray-700 hover:bg-gray-100'
                                }`}
                        >
                            {t.name}
                        </button>
                    ))
                ) : (
                    <p className="p-4 text-sm text-center text-gray-500">Nenhum template encontrado.</p>
                )}
            </nav>
        </aside>
    );
};

// --- NOVO: Componente de Preview da Mensagem ---
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
                                    width: `${Math.max(((variables[varName] || match[0]).length) * 6, 40)}px`,
                                    minWidth: '60px',
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
        return header.format; // IMAGE, VIDEO, DOCUMENT
    }, [template]);

    const buttons = useMemo(() => {
        if (!template) return [];
        return template.components.find(c => c.type === 'BUTTONS')?.buttons || [];
    }, [template]);

    if (!template) {
        return (
            <div className="flex-1 flex items-center justify-center p-6">
                <p className="text-gray-600 text-center bg-white/70 backdrop-blur-sm p-4 rounded-lg shadow">Selecione um template na lista para ver o preview e preencher as variáveis.</p>
            </div>
        );
    }

    return (
        <div className="flex justify-end">
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
                            <div key={idx} className="py-2.5 px-2 text-center text-[#00a884] text-sm font-medium border-b border-black/10 last:border-b-0 hover:bg-black/5 transition-colors cursor-pointer flex items-center justify-center gap-2">
                                {btn.type === 'QUICK_REPLY' && <Reply size={16} className="opacity-80" />}
                                {btn.type === 'URL' && <ExternalLink size={16} className="opacity-80" />}
                                <span className="truncate">{btn.text}</span>
                            </div>
                        ))}
                    </div>
                )}

                <span className="text-xs text-gray-400 float-right ml-2 mt-1">
                    {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
            </div>
        </div>
    );
};


const TemplateModal = ({ isOpen, onClose, onSend }) => {
    const [templates, setTemplates] = useState([]);
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [variables, setVariables] = useState({}); // Estado unificado para todas as variáveis
    const [headerFile, setHeaderFile] = useState(null); // Arquivo para o header de mídia
    const [searchTerm, setSearchTerm] = useState(''); // Estado para a busca
    const [isLoading, setIsLoading] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [error, setError] = useState('');

    const loadTemplates = async () => {
        setIsLoading(true);
        setError('');
        try {
            const response = await api.get('/atendimentos/whatsapp/templates');
            setTemplates(response.data);
        } catch (err) {
            console.error("Erro ao buscar templates:", err);
            setError(err.response?.data?.detail || 'Não foi possível carregar os templates.');
        } finally {
            setIsLoading(false);
        }
    };

    // Efeito para buscar os templates
    useEffect(() => {
        if (isOpen) {
            setSearchTerm(''); // Limpa a busca ao abrir
            loadTemplates();
        } else {
            // Limpa o estado quando o modal fecha
            setSelectedTemplate(null);
            setVariables({});
            setHeaderFile(null);
        }
    }, [isOpen]);

    // --- LÓGICA DE VARIÁVEIS ATUALIZADA ---
    // Extrai as variáveis ({{nome}} ou {{1}}) do texto do template
    const variableNames = useMemo(() => {
        if (!selectedTemplate) return [];

        const headerText = selectedTemplate.components.find(c => c.type === 'HEADER' && c.format === 'TEXT')?.text || '';
        const bodyText = selectedTemplate.components.find(c => c.type === 'BODY')?.text || '';
        
        // Também busca variáveis em botões de URL dinâmicos
        const buttons = selectedTemplate.components.find(c => c.type === 'BUTTONS')?.buttons || [];
        const buttonsText = buttons.map(b => b.url || '').join(' ');

        const combinedText = `${headerText} ${bodyText} ${buttonsText}`;

        const matches = combinedText.match(/{{\s*(\w+)\s*}}/g) || [];
        // Remove duplicados e extrai apenas o nome da variável
        const uniqueVarNames = [...new Set(matches.map(v => v.replace(/[{}]/g, '').trim()))];
        return uniqueVarNames;
    }, [selectedTemplate]);

    // Inicializa o estado das variáveis quando um novo template é selecionado
    useEffect(() => {
        const initialVars = variableNames.reduce((acc, name) => {
            acc[name] = '';
            return acc;
        }, {});
        setVariables(initialVars);
    }, [variableNames]);
    // --- FIM DA LÓGICA DE VARIÁVEIS ---

    const headerMediaType = useMemo(() => {
        if (!selectedTemplate) return null;
        const header = selectedTemplate.components.find(c => c.type === 'HEADER');
        if (!header || header.format === 'TEXT') return null;
        return header.format;
    }, [selectedTemplate]);

    const handleSend = async () => {
        if (!selectedTemplate) return;

        setIsSending(true);
        setError('');

        // Validação: verifica se todas as variáveis foram preenchidas
        const allVarsFilled = Object.values(variables).every(v => v.trim() !== '');
        if (!allVarsFilled) {
            setError('Todas as variáveis devem ser preenchidas.');
            setIsSending(false);
            return;
        }

        // Validação de mídia no cabeçalho
        if (headerMediaType && !headerFile) {
            setError(`O template requer um arquivo de ${headerMediaType.toLowerCase()} no cabeçalho.`);
            setIsSending(false);
            return;
        }

        // Monta os componentes para a API
        const buildComponent = (type, text) => {
            const params = (text.match(/{{\s*(\w+)\s*}}/g) || []).map(match => {
                const varName = match.replace(/[{}]/g, '').trim();
                return { type: 'text', text: variables[varName] };
            });
            if (params.length === 0) return null;
            return { type, parameters: params };
        };

        const headerComponentData = selectedTemplate.components.find(c => c.type === 'HEADER' && c.format === 'TEXT');
        const bodyComponentData = selectedTemplate.components.find(c => c.type === 'BODY');
        const btnComponentData = selectedTemplate.components.find(c => c.type === 'BUTTONS');

        const components = [
            headerComponentData ? buildComponent('header', headerComponentData.text) : null,
            bodyComponentData ? buildComponent('body', bodyComponentData.text) : null,
            ...(btnComponentData?.buttons || []).map((btn, idx) => {
                if (!btn.url) return null;
                const params = (btn.url.match(/{{\s*(\w+)\s*}}/g) || []).map(match => {
                    const varName = match.replace(/[{}]/g, '').trim();
                    return { type: 'text', text: variables[varName] };
                });
                if (params.length === 0) return null;
                return { type: 'button', sub_type: 'url', index: idx, parameters: params };
            })
        ].filter(Boolean); // Filtra componentes nulos

        // Verifica se algum componente foi de fato criado (se havia variáveis)
        if (components.length === 0 && variableNames.length > 0) {
            setError('Falha ao montar os componentes da mensagem.');
            setIsSending(false);
            return;
        }

        try {
            const payload = {
                template_name: selectedTemplate.name,
                language_code: selectedTemplate.language,
                components: components,
            };
            // Se não houver variáveis, não envie a chave 'components'.
            if (variableNames.length === 0) {
                delete payload.components;
            }
            
            const formData = new FormData();
            formData.append('payload_json', JSON.stringify(payload));
            if (headerFile) {
                formData.append('file', headerFile);
            }

            await onSend(formData);
            onClose(); // Fecha o modal em caso de sucesso
        } catch (err) {
            console.error("Erro ao enviar template:", err);
            let errorMessage = 'Falha ao enviar a mensagem de template.';
            const detail = err.response?.data?.detail;

            if (detail) {
                if (Array.isArray(detail) && detail.length > 0 && detail[0].msg) {
                    // Erro de validação do Pydantic: ex: [{ loc: [...], msg: "...", type: "..." }]
                    const firstError = detail[0];
                    const fieldPath = firstError.loc ? ` (campo: ${firstError.loc.slice(1).join(' > ')})` : '';
                    errorMessage = `${firstError.msg}${fieldPath}`;
                } else if (typeof detail === 'string') {
                    // Erro de HTTPException com uma string simples
                    errorMessage = detail;
                }
            }
            setError(errorMessage);
        } finally {
            setIsSending(false);
        }
    };

    const handleSelectTemplate = (template) => {
        setSelectedTemplate(template);
        // Foca no primeiro input de variável, se houver
        setTimeout(() => {
            const firstInput = document.querySelector('.whitespace-pre-wrap input[type="text"]');
            firstInput?.focus();
        }, 100);
    };

    if (!isOpen) return null;

    return (
        <>
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl h-[80vh] flex flex-col animate-fade-in-up-fast" onClick={e => e.stopPropagation()}>
                {/* Cabeçalho do Modal */}
                <div className="flex-shrink-0 flex justify-between items-center p-4 border-b">
                    <h3 className="text-lg font-semibold text-gray-800">Enviar Mensagem de Template</h3>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-800"><X size={24} /></button>
                </div>

                {/* Corpo do Modal (Sidebar + Conteúdo) */}
                <div className="flex-1 flex min-h-0">
                    <TemplateSidebar
                        templates={templates}
                        selectedTemplate={selectedTemplate}
                        onSelect={handleSelectTemplate}
                        searchTerm={searchTerm}
                        setSearchTerm={setSearchTerm}
                        onCreateClick={() => setIsCreateModalOpen(true)}
                    />

                    {/* --- ALTERAÇÃO AQUI: Adicionado o plano de fundo de chat --- */}
                    <main
                        className="flex-1 flex flex-col p-4 md:p-6 space-y-4 overflow-y-auto"
                        style={{
                            backgroundImage: `
                            linear-gradient(rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0.9)),
                            url('https://static.vecteezy.com/system/resources/previews/021/736/713/non_2x/doodle-lines-arrows-circles-and-curves-hand-drawn-design-elements-isolated-on-white-background-for-infographic-illustration-vector.jpg')
                            `,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center'
                        }}
                    >
                        {isLoading ? (
                            <div className="flex-1 flex items-center justify-center">
                                <Loader2 size={32} className="animate-spin text-brand-primary" />
                            </div>
                        ) : (
                            <>
                                <TemplatePreview 
                                    template={selectedTemplate} 
                                    variables={variables} 
                                    headerFile={headerFile} 
                                    onVariableChange={(name, value) => setVariables(prev => ({ ...prev, [name]: value }))}
                                    onFileChange={setHeaderFile}
                                />
                            </>
                        )}
                    </main>
                </div>

                {/* Rodapé do Modal */}
                <div className="flex-shrink-0 flex justify-between items-center p-4 border-t bg-gray-50">
                    {error && (
                        <div className="text-red-600 text-sm flex items-center gap-2">
                            <AlertTriangle size={18} />
                            <span>{error}</span>
                        </div>
                    )}
                    <div className="ml-auto flex items-center gap-3">
                        <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">Cancelar</button>
                        <button onClick={handleSend} disabled={!selectedTemplate || isSending || isLoading} className="px-4 py-2 text-sm font-medium text-white bg-brand-primary border border-transparent rounded-md hover:bg-brand-primary-active disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2">
                            {isSending ? <Loader2 size={18} className="animate-spin" /> : <Send size={16} />}
                            {isSending ? 'Enviando...' : 'Enviar'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
        <CreateTemplateModal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} onCreated={loadTemplates} />
        </>
    );
};

export default TemplateModal;
