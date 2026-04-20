import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Plus, Trash2, Save, Loader2, Info, FileImage, FileVideo, File as FileIcon, ExternalLink, Reply, Upload, MessageSquarePlus, Sparkles } from 'lucide-react';
import api from '../../api/axiosConfig';
import toast from 'react-hot-toast';

const CreateTemplateModal = ({ isOpen, onClose, onCreated }) => {
    const [isSaving, setIsSaving] = useState(false);

    // Estado do formulário base
    const [name, setName] = useState('');
    const [category, setCategory] = useState('MARKETING');
    const [language, setLanguage] = useState('pt_BR');

    const [headerType, setHeaderType] = useState('NONE');
    const [headerText, setHeaderText] = useState('');
    const [bodyText, setBodyText] = useState('');
    const [footerText, setFooterText] = useState('');
    const [headerFile, setHeaderFile] = useState(null);
    const [headerPreviewUrl, setHeaderPreviewUrl] = useState(null);

    useEffect(() => {
        if (!headerFile) {
            setHeaderPreviewUrl(null);
            return;
        }
        const url = URL.createObjectURL(headerFile);
        setHeaderPreviewUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [headerFile]);

    const [buttons, setButtons] = useState([]);
    const [variables, setVariables] = useState({});

    const handleVariableChange = useCallback((num, value) => {
        setVariables(prev => ({ ...prev, [num]: value }));
    }, []);

    const fileInputRef = useRef(null);

    const handleFileChange = (e) => {
        if (e.target.files && e.target.files.length > 0) {
            setHeaderFile(e.target.files[0]);
        }
    };

    const handleNameChange = (e) => {
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

            if (footerText) {
                components.push({ type: 'FOOTER', text: footerText });
            }

            if (buttons.length > 0) {
                const processedButtons = buttons.map(btn => {
                    if (btn.type === 'URL' && btn.url.includes('{{1}}')) {
                        return { ...btn, example: [variables['1'] || 'exemplo'] };
                    }
                    return btn;
                });
                components.push({ type: 'BUTTONS', buttons: processedButtons });
            }

            const payload = { name, category, language, components };
            const formData = new FormData();
            formData.append('payload_json', JSON.stringify(payload));
            if (headerFile && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType)) {
                formData.append('file', headerFile);
            }

            await api.post('/atendimentos/whatsapp/templates', formData);

            toast.success("Template enviado para aprovação da Meta!");
            onCreated();
            onClose();

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

    const renderTextWithVariables = useCallback((text, isHeader = false) => {
        if (!text) return null;
        const parts = text.split(/({{\d+}})/g);
        return (
            <div className={`${isHeader ? 'font-black text-[14px] text-slate-800' : 'whitespace-pre-wrap text-[14px] leading-relaxed text-slate-700 font-medium'}`}>
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
                                className="bg-blue-50/50 border border-blue-100 text-blue-700 focus:bg-white focus:outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100/50 font-black transition-all rounded-lg px-2 py-0.5 inline-block mx-0.5 shadow-inner text-center"
                                style={{
                                    width: `${((variables[varNum] || part).length * 9) + 10}px`,
                                    minWidth: '30px',
                                    verticalAlign: 'baseline'
                                }}
                            />
                        );
                    }
                    return <span key={index}>{part}</span>;
                })}
            </div>
        );
    }, [variables, handleVariableChange]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-md sm:p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-white rounded-0 sm:rounded-[2.5rem] shadow-[0_30px_80px_rgba(0,0,0,0.2)] w-full max-w-none sm:max-w-6xl flex flex-col h-full sm:max-h-[95vh] border-none sm:border border-white animate-fade-in-up-fast overflow-hidden" onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className="p-4 sm:p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-blue-600/10 flex items-center justify-center text-blue-600 shrink-0 shadow-inner">
                            <MessageSquarePlus size={24} className="sm:hidden" />
                            <MessageSquarePlus size={28} className="hidden sm:block" />
                        </div>
                        <div className="min-w-0">
                            <h3 className="text-lg sm:text-2xl font-black tracking-tight text-slate-800 executive-title truncate">Novo Template</h3>
                            <p className="text-[11px] sm:text-[13px] font-medium text-slate-400 truncate">Mensagens automáticas Meta.</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center rounded-xl sm:rounded-2xl bg-slate-100 text-slate-400 hover:bg-white hover:text-slate-900 shadow-sm transition-all shrink-0">
                        <X size={20} className="sm:hidden" />
                        <X size={24} className="hidden sm:block" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    <div className="grid grid-cols-1 lg:grid-cols-2 min-h-full">
                        {/* Coluna Esquerda: Formulário */}
                        <div className="p-4 sm:p-8 lg:border-r border-slate-100 space-y-8">
                            <section className="space-y-6">
                                <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-600">Configurações Básicas</h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="col-span-1 md:col-span-2">
                                        <label className="block text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2 ml-1">Identificador do Template</label>
                                        <input
                                            type="text"
                                            value={name}
                                            onChange={handleNameChange}
                                            placeholder="ex: promocao_exclusiva_v1"
                                            className="w-full px-5 py-4 bg-slate-100 rounded-2xl border border-slate-100 focus:bg-white focus:border-blue-200 focus:ring-4 focus:ring-blue-50/50 outline-none transition-all font-bold text-slate-700 placeholder:text-slate-300 shadow-inner"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2 ml-1">Categoria Meta</label>
                                        <select
                                            value={category}
                                            onChange={e => setCategory(e.target.value)}
                                            className="w-full px-5 py-4 bg-slate-100 rounded-2xl border border-slate-100 focus:bg-white focus:border-blue-200 focus:ring-4 focus:ring-blue-50/50 outline-none transition-all font-bold text-slate-700 appearance-none shadow-inner"
                                        >
                                            <option value="MARKETING">Marketing</option>
                                            <option value="UTILITY">Utilidade</option>
                                            <option value="AUTHENTICATION">Autenticação</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2 ml-1">Cabeçalho Interativo</label>
                                        <select
                                            value={headerType}
                                            onChange={e => setHeaderType(e.target.value)}
                                            className="w-full px-5 py-4 bg-slate-100 rounded-2xl border border-slate-100 focus:bg-white focus:border-blue-200 focus:ring-4 focus:ring-blue-50/50 outline-none transition-all font-bold text-slate-700 appearance-none shadow-inner"
                                        >
                                            <option value="NONE">Sem Cabeçalho</option>
                                            <option value="TEXT">Texto Estático</option>
                                            <option value="IMAGE">Imagem Estilizada</option>
                                            <option value="VIDEO">Vídeo Demonstrativo</option>
                                            <option value="DOCUMENT">Documento PDF</option>
                                        </select>
                                    </div>
                                </div>

                                {headerType === 'TEXT' && (
                                    <div className="animate-fade-in">
                                        <label className="block text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2 ml-1">Conteúdo do Cabeçalho</label>
                                        <input
                                            type="text"
                                            value={headerText}
                                            onChange={e => setHeaderText(e.target.value)}
                                            placeholder="Olá {{1}}, bem-vindo!"
                                            maxLength={60}
                                            className="w-full px-5 py-4 bg-blue-50 rounded-2xl border border-blue-100 focus:bg-white focus:border-blue-400 focus:ring-4 focus:ring-blue-50/50 outline-none transition-all font-black text-slate-800 shadow-inner"
                                        />
                                    </div>
                                )}
                            </section>

                            <section className="space-y-4">
                                <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-600">Conteúdo Principal</h4>
                                <div>
                                    <div className="flex justify-between items-center mb-2 px-1">
                                        <label className="text-[11px] font-black uppercase tracking-widest text-slate-400">Corpo da Mensagem</label>
                                        <span className="text-[10px] font-bold text-indigo-500 bg-indigo-50 px-2 py-1 rounded-lg flex items-center gap-1"><Info size={10} /> Use {'{{n}}'} para variáveis</span>
                                    </div>
                                    <textarea
                                        value={bodyText}
                                        onChange={e => setBodyText(e.target.value)}
                                        rows={5}
                                        placeholder="Olá {{1}}, sua encomenda número {{2}} saiu para entrega!"
                                        className="w-full p-6 bg-slate-100 rounded-[2rem] border border-slate-200/20 focus:bg-white focus:border-blue-200 focus:ring-4 focus:ring-blue-50/50 outline-none transition-all font-medium text-slate-700 resize-none shadow-inner"
                                    />
                                </div>
                                <div className="pt-2">
                                    <label className="block text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2 ml-1">Rodapé de Apoio (Opcional)</label>
                                    <input
                                        type="text"
                                        value={footerText}
                                        onChange={e => setFooterText(e.target.value)}
                                        placeholder="Ex: Responda SAIR para não receber mais mensagens."
                                        maxLength={60}
                                        className="w-full px-5 py-4 bg-slate-100 rounded-2xl border border-slate-200/20 focus:bg-white focus:border-blue-200 outline-none transition-all text-sm font-medium text-slate-500 shadow-inner"
                                    />
                                </div>
                            </section>

                            <section className="space-y-6">
                                <div className="flex justify-between items-center">
                                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-600">Botões de Chamada (Action Icons)</h4>
                                    <div className="flex gap-2">
                                        <button type="button" onClick={() => handleAddButton('QUICK_REPLY')} className="px-3 py-2 bg-slate-100 hover:bg-blue-600 hover:text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-sm">Rápida</button>
                                        <button type="button" onClick={() => handleAddButton('URL')} className="px-3 py-2 bg-slate-100 hover:bg-blue-600 hover:text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-sm">Link</button>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    {buttons.map((btn, idx) => (
                                        <div key={idx} className="group relative p-6 bg-white rounded-3xl border border-slate-100 shadow-sm hover:shadow-md transition-all animate-fade-in-up-fast">
                                            <div className="flex flex-col sm:flex-row gap-4 items-end">
                                                <div className="flex-1 w-full">
                                                    <div className="flex items-center gap-2 mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                                                        {btn.type === 'QUICK_REPLY' ? <Reply size={12} /> : <ExternalLink size={12} />}
                                                        {btn.type === 'QUICK_REPLY' ? 'Resposta Rápida' : 'Link Externo'}
                                                    </div>
                                                    <input
                                                        type="text"
                                                        value={btn.text}
                                                        onChange={e => handleButtonChange(idx, 'text', e.target.value)}
                                                        placeholder="Texto do Botão"
                                                        className="w-full px-4 py-3 bg-slate-100 rounded-xl border border-slate-100 focus:bg-white focus:border-blue-100 transition-all font-bold text-slate-700 outline-none shadow-inner"
                                                        maxLength={25}
                                                        required
                                                    />
                                                </div>
                                                {btn.type === 'URL' && (
                                                    <div className="flex-[2] w-full">
                                                        <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">URL de Destino</div>
                                                        <input
                                                            type="url"
                                                            value={btn.url}
                                                            onChange={e => handleButtonChange(idx, 'url', e.target.value)}
                                                            placeholder="https://sua-empresa.com"
                                                            className="w-full px-4 py-3 bg-slate-100 rounded-xl border border-slate-100 focus:bg-white focus:border-blue-100 transition-all font-black text-blue-600 outline-none shadow-inner"
                                                            required
                                                        />
                                                    </div>
                                                )}
                                                <button type="button" onClick={() => handleRemoveButton(idx)} className="w-12 h-12 flex items-center justify-center rounded-xl bg-red-50 text-red-400 hover:bg-red-500 hover:text-white transition-all">
                                                    <Trash2 size={20} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                    {buttons.length === 0 && (
                                        <div className="py-10 border-2 border-dashed border-slate-100 rounded-[2rem] flex flex-col items-center justify-center text-slate-300 group hover:border-blue-100 transition-all">
                                            <Reply size={32} className="mb-3 opacity-20 group-hover:scale-110 transition-transform" />
                                            <p className="text-[12px] font-bold italic">Nenhum botão configurado.</p>
                                        </div>
                                    )}
                                </div>
                            </section>
                        </div>

                        {/* Coluna Direita: Preview Visual (Escondida no Mobile na criação) */}
                        <div
                            className="hidden lg:flex p-8 flex-col items-center min-h-[600px] border-l border-slate-100"
                            style={{
                                backgroundImage: `
                                linear-gradient(rgba(248, 250, 252, 0.96), rgba(248, 250, 252, 0.96)),
                                url('https://static.vecteezy.com/system/resources/previews/021/736/713/non_2x/doodle-lines-arrows-circles-and-curves-hand-drawn-design-elements-isolated-on-white-background-for-infographic-illustration-vector.jpg')
                                `,
                                backgroundSize: '400px',
                                backgroundPosition: 'center',
                            }}
                        >
                            <div className="w-full max-w-[420px] animate-fade-in">
                                <div className="mb-8 text-center">
                                    <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-blue-50 text-blue-600 rounded-full text-[11px] font-black uppercase tracking-widest mb-3 shadow-sm border border-blue-100/50">
                                        <Sparkles size={14} /> Visualização em Tempo Real
                                    </div>
                                    <p className="text-[12px] font-bold text-slate-400 italic">Preencha os campos azuis para testar variáveis</p>
                                </div>

                                <div className="relative w-full py-6 px-6 rounded-[2.5rem] shadow-[0_20px_60px_rgba(0,0,0,0.08)] break-words bg-white text-slate-800 border border-slate-100 animate-fade-in-up">
                                    {/* Meta Header Preview */}
                                    {headerType !== 'NONE' && (
                                        <div className="mb-4 rounded-2xl overflow-hidden bg-slate-50 border border-slate-100">
                                            {headerType === 'TEXT' && headerText && (
                                                <div className="p-4 text-[15px] font-black text-slate-800 bg-slate-50/50">
                                                    {renderTextWithVariables(headerText, true)}
                                                </div>
                                            )}
                                            {['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType) && (
                                                <div
                                                    className="relative aspect-video flex flex-col items-center justify-center bg-slate-100 text-slate-400 group cursor-pointer hover:bg-slate-200 transition-all"
                                                    onClick={() => fileInputRef.current?.click()}
                                                >
                                                    {headerFile ? (
                                                        headerFile.type.startsWith('image/') ? (
                                                            <img src={headerPreviewUrl} alt="Preview" className="w-full h-full object-cover" />
                                                        ) : (
                                                            <div className="flex flex-col items-center gap-2 p-4">
                                                                <FileIcon size={32} />
                                                                <span className="text-[10px] font-black uppercase text-center px-4 truncate w-full">{headerFile.name}</span>
                                                            </div>
                                                        )
                                                    ) : (
                                                        <div className="flex flex-col items-center gap-2">
                                                            {headerType === 'IMAGE' && <FileImage size={28} />}
                                                            {headerType === 'VIDEO' && <FileVideo size={28} />}
                                                            {headerType === 'DOCUMENT' && <FileIcon size={28} />}
                                                            <span className="text-[10px] font-black uppercase tracking-widest">{headerType}</span>
                                                        </div>
                                                    )}
                                                    <div className="absolute inset-0 bg-blue-600/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <Upload size={24} className="text-white" />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Body Preview */}
                                    <div className="space-y-3">
                                        {bodyText ? (
                                            <div className="text-[14px] leading-relaxed text-slate-700">
                                                {renderTextWithVariables(bodyText, false)}
                                            </div>
                                        ) : (
                                            <div className="text-[14px] italic text-slate-300 font-medium">
                                                O corpo da sua mensagem aparecerá aqui...
                                            </div>
                                        )}

                                        {footerText && (
                                            <div className="mt-3 pt-3 border-t border-slate-50 text-[12px] font-medium text-slate-400 italic">
                                                {footerText}
                                            </div>
                                        )}

                                        <div className="text-[10px] font-black text-slate-300 text-right mt-4 uppercase tracking-tighter">
                                            {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                                        </div>
                                    </div>

                                    {/* Buttons Preview */}
                                    {buttons.length > 0 && (
                                        <div className="mt-6 flex flex-col border-t border-slate-100 -mx-6 -mb-6 bg-slate-50/30 rounded-b-[2.5rem] overflow-hidden">
                                            {buttons.map((btn, idx) => (
                                                <div key={idx} className="py-4 px-4 text-center text-[#00a884] text-[14px] font-black border-b border-slate-100 last:border-b-0 hover:bg-white transition-colors flex items-center justify-center gap-2 cursor-default">
                                                    {btn.type === 'QUICK_REPLY' && <Reply size={16} className="opacity-60" />}
                                                    {btn.type === 'URL' && <ExternalLink size={16} className="opacity-60" />}
                                                    <span className="truncate">{btn.text || "Botão"}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Sticky Footer Actions */}
                <div className="mt-auto p-4 sm:p-8 border-t border-slate-100 bg-white flex flex-col sm:flex-row justify-between items-center gap-4">
                    <p className="hidden lg:block text-[11px] font-black uppercase tracking-widest text-slate-400 italic max-w-sm">
                        Ao enviar, seu template passará pela revisão automatizada da Meta (Facebook).
                    </p>
                    <div className="w-full sm:w-auto flex flex-col sm:flex-row gap-4">
                        <button type="button" onClick={onClose} className="w-full sm:w-auto px-8 py-4 text-[11px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-900 transition-all border border-slate-100 sm:border-none rounded-2xl">Cancelar</button>
                        <button
                            type="button"
                            onClick={handleSubmit}
                            disabled={isSaving}
                            className="w-full sm:w-auto flex items-center justify-center gap-4 bg-brand-primary text-white px-10 py-5 rounded-2xl sm:rounded-3xl font-black uppercase tracking-widest text-[11px] hover:bg-brand-primary-active hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-brand-primary/20 disabled:opacity-50"
                        >
                            {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                            Submeter para Meta
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
export default CreateTemplateModal;