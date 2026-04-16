import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, Send, Loader2, AlertTriangle, Search, Upload, FileImage, FileVideo, File as FileIcon, Plus, ExternalLink, Reply, Trash2, Sparkles, MessageSquare } from 'lucide-react';
import api from '../../api/axiosConfig'; // Importa a configuração do Axios
import CreateTemplateModal from './CreateTemplateModal';
import ConfirmationModal from '../common/ConfirmationModal';

// --- NOVO: Componente da Barra Lateral ---
const TemplateSidebar = ({ templates, selectedTemplate, onSelect, onDelete, searchTerm, setSearchTerm, onCreateClick }) => {
    const filteredTemplates = useMemo(() => {
        if (!searchTerm) return templates;
        return templates.filter(t => t.name.toLowerCase().includes(searchTerm.toLowerCase()));
    }, [templates, searchTerm]);

    return (
        <aside className="w-80 border-r border-slate-100 bg-slate-50/50 flex flex-col min-h-0">
            {/* Barra de Busca */}
            <div className="p-4 border-b border-slate-100">
                <div className="flex gap-2">
                    <div className="relative flex-1 group">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors" size={16} />
                        <input
                            type="text"
                            placeholder="Buscar template..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-9 pr-2 py-3 text-[13px] bg-white border border-slate-100 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-50/50 focus:border-blue-200 transition-all font-medium text-slate-700 placeholder:text-slate-300"
                        />
                    </div>
                </div>
            </div>

            {/* Lista de Templates */}
            <nav className="flex-1 overflow-y-auto custom-scrollbar p-2">
                <div className="px-2 py-3 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Meus Templates</div>
                {filteredTemplates.length > 0 ? (
                    filteredTemplates.map(t => (
                        <div key={t.name} className="group relative mb-1">
                            <button
                                onClick={() => onSelect(t)}
                                className={`w-full text-left p-3.5 pl-4 pr-12 text-[13px] font-bold rounded-2xl transition-all truncate flex flex-col gap-0.5 ${selectedTemplate?.name === t.name
                                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-200 scale-[1.02] z-10'
                                    : 'text-slate-600 hover:bg-white hover:shadow-md hover:shadow-slate-200/50'
                                    }`}
                            >
                                <span className="truncate">{t.name}</span>
                                <span className={`text-[9px] uppercase tracking-wider ${selectedTemplate?.name === t.name ? 'text-white/60' : 'text-slate-400'}`}>
                                    {t.language?.replace('_', '-')} • {t.category}
                                </span>
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onDelete(t);
                                }}
                                className={`absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-xl transition-all opacity-0 group-hover:opacity-100 ${selectedTemplate?.name === t.name
                                        ? 'text-white hover:bg-white/10'
                                        : 'text-slate-300 hover:text-red-500 hover:bg-red-50'
                                    }`}
                                title="Excluir template"
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                    ))
                ) : (
                    <div className="p-8 text-center bg-white/40 rounded-3xl border border-dashed border-slate-200 m-2">
                        <Search size={24} className="mx-auto text-slate-200 mb-2" />
                        <p className="text-[11px] font-bold text-slate-400 italic">Nenhum template encontrado.</p>
                    </div>
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
            <div className="whitespace-pre-wrap text-[14px] leading-relaxed text-slate-700 font-medium">
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
                                className="bg-blue-50/50 border border-blue-100 text-blue-700 focus:bg-white focus:outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100/50 font-black transition-all rounded-lg px-2 py-0.5 inline-block mx-0.5 shadow-inner"
                                style={{
                                    width: `${((variables[varName] || match[0]).length * 9) + 10}px`,
                                    minWidth: '60px',
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
            <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-4">
                <div className="w-20 h-20 rounded-[2rem] bg-slate-100 flex items-center justify-center animate-bounce">
                    <MessageSquare size={32} className="text-slate-300" />
                </div>
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 text-center max-w-[200px]">
                    Selecione um template para configurar o envio
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center">
            <div className="mb-6 text-center">
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-[10px] font-black uppercase tracking-widest mb-2">
                    <Sparkles size={12} /> Visualização Real
                </div>
                <p className="text-[11px] font-bold text-slate-400 italic">Preencha os campos azuis dentro da mensagem</p>
            </div>

            <div className="relative max-w-[400px] w-full py-4 px-4 rounded-3xl shadow-xl break-words bg-white text-slate-800 message-out min-w-[300px] border border-slate-100 animate-fade-in-up">
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
                    <div className="mt-4 -mx-4 -mb-4 flex flex-col border-t border-slate-100 bg-slate-50/30">
                        {buttons.map((btn, idx) => (
                            <div key={idx} className="py-3.5 px-4 text-center text-[#00a884] text-[13px] font-black border-b border-slate-100 last:border-b-0 hover:bg-white transition-colors cursor-pointer flex items-center justify-center gap-2">
                                {btn.type === 'QUICK_REPLY' && <Reply size={16} className="opacity-80" />}
                                {btn.type === 'URL' && <ExternalLink size={16} className="opacity-80" />}
                                <span className="truncate">{btn.text}</span>
                            </div>
                        ))}
                    </div>
                )}

                <div className="text-[10px] font-black text-slate-300 text-right mt-3 uppercase tracking-tighter">
                    {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
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
    const [confirmDelete, setConfirmDelete] = useState({ isOpen: false, template: null });
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

    const handleDeleteTemplate = (template) => {
        setConfirmDelete({ isOpen: true, template });
    };

    const confirmDeleteTemplate = async () => {
        const template = confirmDelete.template;
        if (!template) return;

        setIsLoading(true);
        setError('');
        try {
            await api.delete(`/atendimentos/whatsapp/templates/${template.name}`, {
                params: { template_id: template.id }
            });
            if (selectedTemplate?.name === template.name) {
                setSelectedTemplate(null);
            }
            await loadTemplates();
        } catch (err) {
            console.error("Erro ao excluir template:", err);
            setError(err.response?.data?.detail || 'Não foi possível excluir o template.');
        } finally {
            setIsLoading(false);
            setConfirmDelete({ isOpen: false, template: null });
        }
    };

    if (!isOpen) return null;

    return (
        <>
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-fade-in" onClick={onClose}>
                <div className="bg-white/95 backdrop-blur-xl rounded-[3rem] shadow-[0_30px_80px_rgba(0,0,0,0.2)] w-full max-w-5xl h-[85vh] flex flex-col border border-white animate-fade-in-up-fast overflow-hidden" onClick={e => e.stopPropagation()}>
                    {/* Cabeçalho do Modal */}
                    <div className="flex-shrink-0 flex justify-between items-center p-8 border-b border-slate-100 bg-slate-50/50">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-2xl bg-blue-600/10 flex items-center justify-center text-blue-600 shadow-inner">
                                <Sparkles size={28} />
                            </div>
                            <div>
                                <h3 className="text-2xl font-black tracking-tight text-slate-800 executive-title">Enviar Template</h3>
                                <p className="text-[13px] font-medium text-slate-400">Escolha um modelo inteligente aprovado pela Meta.</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => setIsCreateModalOpen(true)}
                                className="bg-white border border-slate-200 text-slate-700 h-12 px-5 rounded-2xl text-[11px] font-black uppercase tracking-widest hover:bg-slate-50 hover:border-slate-300 transition-all flex items-center gap-2 shadow-sm"
                            >
                                <Plus size={18} className="text-blue-600" /> Novo Template
                            </button>
                            <button onClick={onClose} className="w-12 h-12 flex items-center justify-center rounded-2xl bg-slate-100/50 text-slate-400 hover:bg-white hover:text-slate-900 shadow-sm transition-all">
                                <X size={24} />
                            </button>
                        </div>
                    </div>

                    {/* Corpo do Modal (Sidebar + Conteúdo) */}
                    <div className="flex-1 flex min-h-0">
                        <TemplateSidebar
                            templates={templates}
                            selectedTemplate={selectedTemplate}
                            onSelect={handleSelectTemplate}
                            onDelete={handleDeleteTemplate}
                            searchTerm={searchTerm}
                            setSearchTerm={setSearchTerm}
                            onCreateClick={() => setIsCreateModalOpen(true)}
                        />

                        {/* --- ALTERAÇÃO AQUI: Adicionado o plano de fundo de chat --- */}
                        <main
                            className="flex-1 flex flex-col p-8 overflow-y-auto custom-scrollbar bg-slate-50/30"
                            style={{
                                backgroundImage: `
                            linear-gradient(rgba(248, 250, 252, 0.96), rgba(248, 250, 252, 0.96)),
                            url('https://static.vecteezy.com/system/resources/previews/021/736/713/non_2x/doodle-lines-arrows-circles-and-curves-hand-drawn-design-elements-isolated-on-white-background-for-infographic-illustration-vector.jpg')
                            `,
                                backgroundSize: '400px',
                                backgroundPosition: 'center',
                            }}
                        >
                            {isLoading ? (
                                <div className="flex-1 flex flex-col items-center justify-center gap-4">
                                    <div className="p-4 bg-white rounded-3xl shadow-xl shadow-blue-100/50 outline outline-8 outline-blue-50">
                                        <Loader2 size={32} className="animate-spin text-blue-600" />
                                    </div>
                                    <span className="text-[11px] font-black uppercase tracking-[0.2em] text-blue-600 animate-pulse">Sincronizando com Meta...</span>
                                </div>
                            ) : (
                                <div className="max-w-2xl mx-auto w-full">
                                    <TemplatePreview
                                        template={selectedTemplate}
                                        variables={variables}
                                        headerFile={headerFile}
                                        onVariableChange={(name, value) => setVariables(prev => ({ ...prev, [name]: value }))}
                                        onFileChange={setHeaderFile}
                                    />
                                </div>
                            )}
                        </main>
                    </div>

                    {/* Rodapé do Modal */}
                    <div className="flex-shrink-0 flex justify-between items-center p-8 border-t border-slate-100 bg-white shadow-[0_-10px_40px_rgba(0,0,0,0.02)]">
                        {error ? (
                            <div className="bg-red-50 text-red-600 px-5 py-3 rounded-2xl text-[11px] font-bold flex items-center gap-3 animate-shake">
                                <div className="w-6 h-6 rounded-lg bg-red-100 flex items-center justify-center"><AlertTriangle size={14} /></div>
                                <span>{error}</span>
                            </div>
                        ) : (
                            <p className="text-[11px] font-medium text-slate-400 italic max-w-xs">
                                Certifique-se de preencher todas as variáveis para garantir o envio correto.
                            </p>
                        )}
                        <div className="ml-auto flex items-center gap-4">
                            <button onClick={onClose} className="px-8 py-4 text-[11px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-900 transition-all">Cancelar</button>
                            <button
                                onClick={handleSend}
                                disabled={!selectedTemplate || isSending || isLoading}
                                className="flex items-center gap-4 bg-brand-primary text-white px-10 py-5 rounded-3xl font-black uppercase tracking-widest text-[11px] hover:bg-brand-primary-active hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-brand-primary/20 disabled:opacity-50 disabled:grayscale disabled:scale-100"
                            >
                                {isSending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                                {isSending ? 'Enviando...' : 'Disparar Template'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            <CreateTemplateModal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} onCreated={loadTemplates} />

            <ConfirmationModal
                isOpen={confirmDelete.isOpen}
                onClose={() => setConfirmDelete({ isOpen: false, template: null })}
                onConfirm={confirmDeleteTemplate}
                title="Excluir Template"
                message={`Tem certeza que deseja excluir o template "${confirmDelete.template?.name}"? Esta ação não pode ser desfeita e removerá o template da API da Meta.`}
                confirmText="Excluir"
                variant="danger"
            />
        </>
    );
};

export default TemplateModal;
