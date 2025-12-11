import React, { useState, useEffect, useMemo } from 'react';
import { X, Send, Loader2, AlertTriangle, Search } from 'lucide-react';
import api from '../../api/axiosConfig'; // Importa a configuração do Axios

// --- NOVO: Componente da Barra Lateral ---
const TemplateSidebar = ({ templates, selectedTemplate, onSelect, searchTerm, setSearchTerm }) => {
    const filteredTemplates = useMemo(() => {
        if (!searchTerm) return templates;
        return templates.filter(t => t.name.toLowerCase().includes(searchTerm.toLowerCase()));
    }, [templates, searchTerm]);

    return (
        <aside className="w-1/3 border-r bg-gray-50 flex flex-col min-h-0">
            {/* Barra de Busca */}
            <div className="p-3 border-b">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                    <input
                        type="text"
                        placeholder="Buscar template..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
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
                                ? 'bg-blue-100 text-blue-700 font-semibold'
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
const TemplatePreview = ({ template, variables }) => {
    const previewText = useMemo(() => {
        if (!template) return '';

        // Combina header e body para o preview
        const header = template.components.find(c => c.type === 'HEADER')?.text || '';
        const body = template.components.find(c => c.type === 'BODY')?.text || '';
        let combinedText = `${header}\n${body}`.trim();

        // Substitui as variáveis no texto
        return combinedText.replace(/{{\s*(\w+)\s*}}/g, (match, varName) => {
            const value = variables[varName];
            // Se a variável tiver um valor, usa. Senão, mostra o placeholder.
            return value ? `<strong>${value}</strong>` : `<span class="italic text-blue-600 opacity-80">${match}</span>`;
        });
    }, [template, variables]);

    if (!template) {
        return (
            <div className="flex-1 flex items-center justify-center p-6">
                <p className="text-gray-600 text-center bg-white/70 backdrop-blur-sm p-4 rounded-lg shadow">Selecione um template na lista para ver o preview e preencher as variáveis.</p>
            </div>
        );
    }

    return (
        <div className="flex justify-end">
            {/* --- ALTERAÇÃO AQUI: Removido o container cinza e o título "Preview da Mensagem" foi movido para o balão --- */}
            <div className="relative max-w-md py-2 px-3 rounded-lg shadow-sm break-words bg-[#d9fdd3] text-gray-800 message-out">
                <p className="whitespace-pre-wrap text-sm" dangerouslySetInnerHTML={{ __html: previewText.replace(/\n/g, '<br />') }} />
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
    const [searchTerm, setSearchTerm] = useState(''); // Estado para a busca
    const [isLoading, setIsLoading] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [error, setError] = useState('');

    // Efeito para buscar os templates
    useEffect(() => {
        if (isOpen) {
            setIsLoading(true);
            setError('');
            setSearchTerm(''); // Limpa a busca ao abrir
            const fetchTemplates = async () => {
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
            fetchTemplates();
        } else {
            // Limpa o estado quando o modal fecha
            setSelectedTemplate(null);
            setVariables({});
        }
    }, [isOpen]);

    // --- LÓGICA DE VARIÁVEIS ATUALIZADA ---
    // Extrai as variáveis ({{nome}} ou {{1}}) do texto do template
    const variableNames = useMemo(() => {
        if (!selectedTemplate) return [];

        const headerText = selectedTemplate.components.find(c => c.type === 'HEADER')?.text || '';
        const bodyText = selectedTemplate.components.find(c => c.type === 'BODY')?.text || '';
        const combinedText = `${headerText} ${bodyText}`;

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

        // Monta os componentes para a API
        const buildComponent = (type, text) => {
            const params = (text.match(/{{\s*(\w+)\s*}}/g) || []).map(match => {
                const varName = match.replace(/[{}]/g, '').trim();
                return { type: 'text', text: variables[varName] };
            });
            if (params.length === 0) return null;
            return { type, parameters: params };
        };

        const headerComponentData = selectedTemplate.components.find(c => c.type === 'HEADER');
        const bodyComponentData = selectedTemplate.components.find(c => c.type === 'BODY');

        const components = [
            headerComponentData ? buildComponent('header', headerComponentData.text) : null,
            bodyComponentData ? buildComponent('body', bodyComponentData.text) : null,
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
            await onSend(payload);
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
            const firstInput = document.querySelector('#template-variable-inputs input');
            firstInput?.focus();
        }, 100);
    };

    if (!isOpen) return null;

    return (
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
                                <Loader2 size={32} className="animate-spin text-blue-500" />
                            </div>
                        ) : (
                            <>
                                <TemplatePreview template={selectedTemplate} variables={variables} />

                                {variableNames.length > 0 && (
                                    // --- ALTERAÇÃO AQUI: Adicionado fundo branco e padding para os inputs ---
                                    <div id="template-variable-inputs" className="space-y-3 p-4 bg-white rounded-lg shadow-sm mt-auto">
                                        <h4 className="text-md font-semibold text-gray-800">Preencher Variáveis</h4>
                                        {variableNames.map((name, index) => (
                                            <div key={index}>
                                                <label className="block text-sm font-medium text-gray-600 mb-1">
                                                    Variável <span className="font-mono bg-gray-200 px-1 rounded">{`{{${name}}}`}</span>
                                                </label>
                                                <input
                                                    type="text"
                                                    value={variables[name] || ''}
                                                    onChange={e => {
                                                        setVariables(prev => ({ ...prev, [name]: e.target.value }));
                                                    }}
                                                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                                                />
                                            </div>
                                        ))}
                                    </div>
                                )}
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
                        <button onClick={handleSend} disabled={!selectedTemplate || isSending || isLoading} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2">
                            {isSending ? <Loader2 size={18} className="animate-spin" /> : <Send size={16} />}
                            {isSending ? 'Enviando...' : 'Enviar'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TemplateModal;
