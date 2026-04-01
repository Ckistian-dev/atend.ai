import React, { useState, useRef } from 'react';
import { X, Plus, Trash2, Save, Loader2, Info, FileImage, FileVideo, File as FileIcon, ExternalLink, Reply, Upload } from 'lucide-react';
import api from '../../api/axiosConfig';
import toast from 'react-hot-toast';

const CreateTemplateModal = ({ isOpen, onClose, onCreated }) => {
    const [isSaving, setIsSaving] = useState(false);
    
    // Estado do formulário base
    const [name, setName] = useState('');
    const [category, setCategory] = useState('MARKETING');
    const [language, setLanguage] = useState('pt_BR');
    
    // Componentes
    const [headerType, setHeaderType] = useState('NONE'); // NONE, TEXT, IMAGE, VIDEO, DOCUMENT
    const [headerText, setHeaderText] = useState('');
    const [bodyText, setBodyText] = useState('');
    const [footerText, setFooterText] = useState('');
    const [headerFile, setHeaderFile] = useState(null);
    
    // Botões
    const [buttons, setButtons] = useState([]);

    // Variáveis (Exemplos)
    const [variables, setVariables] = useState({});
    const handleVariableChange = (num, value) => {
        setVariables(prev => ({ ...prev, [num]: value }));
    };

    const fileInputRef = useRef(null);

    const handleFileChange = (e) => {
        if (e.target.files && e.target.files.length > 0) {
            setHeaderFile(e.target.files[0]);
        }
    };

    if (!isOpen) return null;

    const handleNameChange = (e) => {
        // O nome do template só pode ter letras minúsculas, números e sublinhados
        const formatted = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_');
        setName(formatted);
    };

    const handleAddButton = (type) => {
        if (buttons.length >= 3) {
            toast.error("Máximo de 3 botões permitidos.");
            return;
        }
        if (type === 'QUICK_REPLY') {
            setButtons([...buttons, { type: 'QUICK_REPLY', text: '' }]);
        } else if (type === 'URL') {
            setButtons([...buttons, { type: 'URL', text: '', url: 'https://' }]);
        }
    };

    const handleRemoveButton = (index) => {
        setButtons(buttons.filter((_, i) => i !== index));
    };

    const handleButtonChange = (index, field, value) => {
        const newButtons = [...buttons];
        newButtons[index][field] = value;
        setButtons(newButtons);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        if (!name || !bodyText) {
            toast.error("Nome e Corpo da mensagem são obrigatórios.");
            return;
        }

        if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType) && !headerFile) {
            toast.error(`Você precisa anexar um arquivo de exemplo para o cabeçalho do tipo ${headerType}.`);
            return;
        }

        // Extrator de variáveis
        const extractVars = (text) => {
            if (!text) return [];
            const matches = text.match(/{{\d+}}/g) || [];
            return [...new Set(matches.map(m => m.replace(/[{}]/g, '')))];
        };

        const headerVars = headerType === 'TEXT' ? extractVars(headerText) : [];
        const bodyVars = extractVars(bodyText);
        const allVars = [...new Set([...headerVars, ...bodyVars])];

        for (let v of allVars) {
            if (!variables[v] || variables[v].trim() === '') {
                toast.error(`Preencha o exemplo para a variável {{${v}}} na visualização da mensagem à direita.`);
                return;
            }
        }

        setIsSaving(true);

        try {
            const components = [];

            // HEADER
            if (headerType !== 'NONE') {
                if (headerType === 'TEXT' && headerText) {
                    const headerComp = { type: 'HEADER', format: 'TEXT', text: headerText };
                    if (headerVars.length > 0) {
                        const maxHeaderVar = Math.max(...headerVars.map(Number));
                        const headerExamples = [];
                        for (let i = 1; i <= maxHeaderVar; i++) {
                            headerExamples.push(variables[i.toString()] || `exemplo_${i}`);
                        }
                        headerComp.example = { header_text: headerExamples };
                    }
                    components.push(headerComp);
                } else if (headerType !== 'TEXT') {
                    components.push({ type: 'HEADER', format: headerType });
                }
            }

            // BODY
            const bodyComp = { type: 'BODY', text: bodyText };
            if (bodyVars.length > 0) {
                const maxBodyVar = Math.max(...bodyVars.map(Number));
                const bodyExamples = [];
                for (let i = 1; i <= maxBodyVar; i++) {
                    bodyExamples.push(variables[i.toString()] || `exemplo_${i}`);
                }
                bodyComp.example = { body_text: [bodyExamples] };
            }
            components.push(bodyComp);

            // FOOTER
            if (footerText) {
                components.push({ type: 'FOOTER', text: footerText });
            }

            // BUTTONS
            if (buttons.length > 0) {
                const processedButtons = buttons.map(btn => {
                    if (btn.type === 'URL' && btn.url.includes('{{1}}')) {
                        return { ...btn, example: [variables['1'] || 'exemplo'] };
                    }
                    return btn;
                });
                components.push({ type: 'BUTTONS', buttons: processedButtons });
            }

            const payload = {
                name,
                category,
                language,
                components
            };

            const formData = new FormData();
            formData.append('payload_json', JSON.stringify(payload));
            if (headerFile && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType)) {
                formData.append('file', headerFile);
            }

            await api.post('/atendimentos/whatsapp/templates', formData);
            
            toast.success("Template enviado para aprovação da Meta!");
            onCreated(); // Recarrega a lista
            onClose(); // Fecha o modal
            
            // Reseta form
            setName('');
            setBodyText('');
            setHeaderText('');
            setFooterText('');
            setButtons([]);
            setHeaderType('NONE');
            setHeaderFile(null);
            setVariables({});
            
        } catch (err) {
            console.error(err);
            const msg = err.response?.data?.detail || "Erro ao criar template. Verifique os dados.";
            toast.error(msg);
        } finally {
            setIsSaving(false);
        }
    };

    // Renderizador interativo para o Preview
    const renderTextWithVariables = (text, isHeader = false) => {
        if (!text) return null;
        const parts = text.split(/({{\d+}})/g);
        return (
            <div className={`${isHeader ? 'font-bold text-sm' : 'whitespace-pre-wrap text-sm leading-relaxed'}`}>
                {parts.map((part, index) => {
                    const match = part.match(/{{(\d+)}}/);
                    if (match) {
                        const varNum = match[1];
                        return (
                            <input
                                key={index}
                                type="text"
                                value={variables[varNum] || ''}
                                onChange={(e) => handleVariableChange(varNum, e.target.value)}
                                className={`bg-white/60 border-gray-400 text-gray-900 focus:bg-white focus:outline-none focus:border-brand-primary transition-all rounded-sm inline-block text-center ${isHeader ? 'font-bold' : ''}`}
                                style={{ 
                                    width: `${Math.max(((variables[varNum] || part).length) * 6, 30)}px`,
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

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm p-4 animate-fade-in-up-fast" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
                <div className="p-5 border-b border-gray-200 flex justify-between items-center bg-gray-50 rounded-t-xl">
                    <h3 className="text-lg font-bold text-gray-800">Criar Novo Template</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {/* Coluna Esquerda: Formulário */}
                        <form id="create-template-form" onSubmit={handleSubmit} className="space-y-6">
                            
                            {/* Configuração Básica e Cabeçalho */}
                            <div className="grid grid-cols-1 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">Nome do Template<span className="text-red-500 ml-0.5">*</span></label>
                                    <input type="text" value={name} onChange={handleNameChange} placeholder="ex: promocao_natal" required className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-brand-primary text-sm" />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">Categoria<span className="text-red-500 ml-0.5">*</span></label>
                                    <select value={category} onChange={e => setCategory(e.target.value)} className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-brand-primary text-sm">
                                        <option value="MARKETING">Marketing (Ofertas, Avisos)</option>
                                        <option value="UTILITY">Utilidade (Atualizações de Pedido)</option>
                                        <option value="AUTHENTICATION">Autenticação (Senhas/OTP)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">Cabeçalho (Opcional)</label>
                                    <select value={headerType} onChange={e => setHeaderType(e.target.value)} className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-brand-primary text-sm">
                                        <option value="NONE">Nenhum</option>
                                        <option value="TEXT">Texto</option>
                                        <option value="IMAGE">Imagem</option>
                                        <option value="VIDEO">Vídeo</option>
                                        <option value="DOCUMENT">Documento (PDF)</option>
                                    </select>
                                    {headerType === 'TEXT' && (
                                        <input type="text" value={headerText} onChange={e => setHeaderText(e.target.value)} placeholder="Texto (máx 60 carac.)" maxLength={60} className="w-full p-2 mt-2 border border-gray-300 rounded focus:ring-2 focus:ring-brand-primary text-sm" />
                                    )}
                                </div>
                            </div>

                            {/* Corpo */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Corpo da Mensagem<span className="text-red-500 ml-0.5">*</span></label>
                                <textarea value={bodyText} onChange={e => setBodyText(e.target.value)} rows={5} placeholder="Digite a mensagem aqui. Use {{1}}, {{2}} para variáveis dinâmicas." required className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary text-sm resize-y" />
                                <p className="text-xs text-gray-500 mt-1 flex items-start gap-1"><Info size={14} className="flex-shrink-0 mt-0.5" /> <span>Para criar variáveis dinâmicas, use chaves duplas numeradas sequencialmente. Ex: <strong>Olá {'{{1}}'}, seu pedido {'{{2}}'} foi confirmado.</strong></span></p>
                            </div>

                            {/* Rodapé */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Rodapé (Opcional)</label>
                                <input type="text" value={footerText} onChange={e => setFooterText(e.target.value)} placeholder="Texto cinza claro no final (ex: Responda SAIR para cancelar)" maxLength={60} className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-brand-primary text-sm" />
                            </div>

                            {/* Botões */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Botões de Ação (Opcional)</label>
                                <div className="border border-gray-300 rounded-lg overflow-hidden">
                                    <div className="bg-gray-50 p-3 flex justify-between items-center border-b border-gray-300">
                                        <span className="text-sm font-medium text-gray-600">Adicionar botões interativos</span>
                                        <div className="flex gap-2">
                                            <button type="button" onClick={() => handleAddButton('QUICK_REPLY')} className="text-xs bg-white border border-gray-300 hover:bg-gray-100 px-2 py-1.5 rounded flex items-center gap-1 font-semibold text-gray-700 shadow-sm transition-colors"><Reply size={14}/> Resposta Rápida</button>
                                            <button type="button" onClick={() => handleAddButton('URL')} className="text-xs bg-white border border-gray-300 hover:bg-gray-100 px-2 py-1.5 rounded flex items-center gap-1 font-semibold text-gray-700 shadow-sm transition-colors"><ExternalLink size={14}/> Link (URL)</button>
                                        </div>
                                    </div>

                                    <div className="p-3 space-y-3 bg-white">
                                    {buttons.map((btn, idx) => (
                                        <div key={idx} className="flex flex-col sm:flex-row gap-3 bg-gray-50 p-3 rounded-lg border border-gray-200 relative group">
                                            <div className="flex-1">
                                                <label className="text-xs font-semibold text-gray-500 mb-1 flex items-center gap-1">
                                                    {btn.type === 'QUICK_REPLY' ? <><Reply size={12}/> Resposta Rápida</> : <><ExternalLink size={12}/> Link (URL)</>}
                                                </label>
                                                <input 
                                                    type="text" 
                                                    value={btn.text} 
                                                    onChange={e => handleButtonChange(idx, 'text', e.target.value)} 
                                                    placeholder={btn.type === 'QUICK_REPLY' ? 'Ex: Quero saber mais' : 'Ex: Acessar Site'} 
                                                    className="w-full p-2.5 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-brand-primary outline-none transition-all" 
                                                    maxLength={25}
                                                    required
                                                />
                                            </div>
                                            {btn.type === 'URL' && (
                                                <div className="flex-[2]">
                                                    <label className="text-xs font-semibold text-gray-500 mb-1 block">URL de Destino</label>
                                                    <input 
                                                        type="url" 
                                                        value={btn.url} 
                                                        onChange={e => handleButtonChange(idx, 'url', e.target.value)} 
                                                        placeholder="https://..." 
                                                        className="w-full p-2.5 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-brand-primary outline-none transition-all" 
                                                        required
                                                    />
                                                </div>
                                            )}
                                            <button type="button" onClick={() => handleRemoveButton(idx)} className="absolute top-2 right-2 sm:relative sm:top-0 sm:right-0 text-red-400 hover:text-red-600 hover:bg-red-50 p-2.5 rounded-md self-end sm:self-end transition-colors" title="Remover botão">
                                                <Trash2 size={18}/>
                                            </button>
                                        </div>
                                    ))}
                                    {buttons.length === 0 && <p className="text-sm text-center text-gray-400 italic py-4">Nenhum botão adicionado. Sua mensagem será enviada apenas com o texto.</p>}
                                </div>
                                </div>
                            </div>
                        </form>

                        {/* Coluna Direita: Preview */}
                        <div className="space-y-4 flex flex-col h-full animate-fade-in">
                            <h4 className="text-sm font-bold text-gray-800 border-b pb-2 uppercase tracking-wide">
                                Visualização em Tempo Real
                            </h4>
                            <div className="flex-1 p-4 md:p-6 overflow-y-auto rounded-xl border border-gray-200 shadow-inner min-h-[400px]" style={{ backgroundImage: `linear-gradient(rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0.9)), url('https://static.vecteezy.com/system/resources/previews/021/736/713/non_2x/doodle-lines-arrows-circles-and-curves-hand-drawn-design-elements-isolated-on-white-background-for-infographic-illustration-vector.jpg')`, backgroundSize: 'cover', backgroundPosition: 'center' }}>
                                <div className="flex justify-start w-full">
                                    <div className="relative max-w-[90%] py-2 px-3 rounded-lg shadow-sm break-words bg-[#d9fdd3] text-gray-800 message-out min-w-[200px]">
                                        
                                        {headerType !== 'NONE' && (
                                            <div className="mb-2">
                                                {headerType === 'TEXT' && headerText && (
                                                    renderTextWithVariables(headerText, true)
                                                )}
                                                {['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType) && (
                                                    <div 
                                                        className="group relative bg-black/5 rounded-md aspect-video flex flex-col items-center justify-center border border-dashed border-black/10 text-gray-500 overflow-hidden cursor-pointer hover:bg-black/10 transition-all"
                                                        title="Clique para carregar mídia de exemplo"
                                                        onClick={() => fileInputRef.current?.click()}
                                                    >
                                                        <input 
                                                            type="file" 
                                                            ref={fileInputRef} 
                                                            className="hidden" 
                                                            onChange={handleFileChange}
                                                            accept={headerType === 'IMAGE' ? 'image/*' : headerType === 'VIDEO' ? 'video/*' : '*/*'}
                                                        />
                                                        {headerFile ? (
                                                            headerType === 'IMAGE' && headerFile.type.startsWith('image/') ? (
                                                                <img src={URL.createObjectURL(headerFile)} alt="Header preview" className="w-full h-full object-cover" />
                                                            ) : (
                                                                <div className="flex flex-col items-center gap-1 p-4">
                                                                    <FileIcon size={32} />
                                                                    <span className="text-[10px] text-center truncate w-full px-2">{headerFile.name}</span>
                                                                </div>
                                                            )
                                                        ) : (
                                                            <div className="flex flex-col items-center gap-1">
                                                                {headerType === 'IMAGE' && <FileImage size={24} />}
                                                                {headerType === 'VIDEO' && <FileVideo size={24} />}
                                                                {headerType === 'DOCUMENT' && <FileIcon size={24} />}
                                                                <span className="text-[10px] uppercase font-bold tracking-wider mt-1">{headerType}</span>
                                                                <span className="text-[8px] opacity-0 group-hover:opacity-100 transition-opacity">Clique para carregar exemplo</span>
                                                            </div>
                                                        )}
                                                        {headerFile && (
                                                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                                <Upload size={24} className="text-white" />
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        
                                        {bodyText ? renderTextWithVariables(bodyText, false) : (
                                            <div className="whitespace-pre-wrap text-sm leading-relaxed">
                                                <span className="text-gray-400 italic">Corpo da mensagem aparecerá aqui...</span>
                                            </div>
                                        )}

                                        {footerText && (
                                            <div className="mt-1 text-[11px] text-gray-500">
                                                {footerText}
                                            </div>
                                        )}

                                        <div className="text-[10px] text-gray-400 text-right mt-1">
                                            {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </div>

                                        {buttons.length > 0 && (
                                            <div className="mt-2 -mx-3 -mb-2 flex flex-col border-t border-black/10">
                                                {buttons.map((btn, idx) => (
                                                    <div key={idx} className="py-2.5 px-2 text-center text-[#00a884] text-sm font-medium border-b border-black/10 last:border-b-0 hover:bg-black/5 transition-colors cursor-pointer flex items-center justify-center gap-2">
                                                        {btn.type === 'QUICK_REPLY' && <Reply size={16} className="opacity-80" />}
                                                        {btn.type === 'URL' && <ExternalLink size={16} className="opacity-80" />}
                                                        <span className="truncate">{btn.text || <span className="text-gray-400 italic font-normal">Texto do botão</span>}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-3 rounded-b-xl">
                    <button type="button" onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-md font-medium text-sm transition-colors">Cancelar</button>
                    <button type="button" onClick={handleSubmit} disabled={isSaving} className="px-5 py-2 bg-brand-primary text-white rounded-md font-medium text-sm hover:bg-brand-primary-active transition-colors flex items-center gap-2 disabled:opacity-50">
                        {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                        Enviar para Meta
                    </button>
                </div>
            </div>
        </div>
    );
};
export default CreateTemplateModal;