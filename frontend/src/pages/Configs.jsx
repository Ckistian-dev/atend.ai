import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import api from '../api/axiosConfig';
import toast from 'react-hot-toast';
import {
    Plus, Save, Trash2, FileText, ChevronRight, Loader2,
    Link as LinkIcon, Star, CheckCircle, Folder, Copy, Share2, Database, ExternalLink, Bell, RefreshCw, Check,
    Calendar, Clock, X, HelpCircle,
    Search, User, Users, Info, Network, Maximize2, Cpu, Sliders, Zap, Bot, ChevronLeft, Wand2, Brain,
    MessageSquare, Globe, Shield, ArrowRightLeft, Sparkles, GripVertical, Target
} from 'lucide-react';
import { WorkflowPreview, WorkflowEditorModal } from '../components/configs/WorkflowEditor';
import FeedbackModal from '../components/mensagens/FeedbackModal';
import { LLM_MODELS, DEFAULT_MODEL } from '../constants/models.json';
import PageLoader from '../components/common/PageLoader';


// --- DESIGN SYSTEM ---
const DS_STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800;900&family=Inter:wght@400;500;600&display=swap');
.configs-page { font-family: 'Inter', sans-serif; height: 100%; display: flex; flex-direction: column; }
.configs-page h1, .configs-page h2, .configs-page h3, .configs-page h4 { font-family: 'Plus Jakarta Sans', sans-serif; }
.persona-card {
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.persona-card:hover { transform: translateX(4px); }
.config-tab {
    position: relative;
    transition: all 0.2s;
}
.config-tab.active::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 0;
    width: 100%;
    height: 3px;
    background: #3b82f6;
    border-radius: 3px 3px 0 0;
    box-shadow: 0 -2px 10px rgba(59,130,246,0.3);
}
.config-input {
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
.config-input:focus { border-color: #3b82f6; box-shadow: 0 0 0 4px rgba(59,130,246,0.1); background: #fff; }

.custom-scrollbar::-webkit-scrollbar {
    width: 8px;
    height: 8px;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
    background: rgba(148, 163, 184, 0.4);
    border-radius: 20px;
    border: 2px solid transparent;
    background-clip: padding-box;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: #3b82f6;
    background-clip: padding-box;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: #3b82f6;
    background-clip: padding-box;
}
.animate-fade-in {
    animation: fadeIn 0.4s ease-out;
}
@keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
}
`;

// --- CONFIGURAÇÃO ---
// Substitua pelo client_email do seu JSON de credenciais
const BOT_EMAIL = "integracaoapi@integracaoapi-436218.iam.gserviceaccount.com";

// Helper para normalizar JIDs brasileiros removendo o nono dígito
const normalizeJid = (jid) => {
    if (!jid) return '';
    const parts = jid.split('@');
    let id = parts[0];
    // Se o ID começa com 55 e tem 13 dígitos (55 + DD + 9 + 8 dígitos), remove o 9 (posição 4)
    if (id.startsWith('55') && id.length === 13 && id[4] === '9') {
        id = id.slice(0, 4) + id.slice(5);
    }
    return parts.length > 1 ? `${id}@${parts[1]}` : id;
};

const initialPersonaForm = {
    ai_name: '',
    company_name: '',
    role: '',
    segment: '',
    objective: '',
    tone: 'semiformal',
    language: 'Portugu\u00eas',
    greeting: '',
    products: '',
    company_info: '',
    faq: '',
    restrictions: '',
    handoff_rules: '',
    business_hours: '',
    extra_instructions: '',
};

const initialFormData = {
    nome_config: '',
    contexto_json: null,
    arquivos_drive_json: null,
    notification_active: false,
    notification_destination: '',
    available_hours: { seg: [], ter: [], qua: [], qui: [], sex: [], sab: [], dom: [] },
    is_calendar_connected: false,
    is_calendar_active: false,
    workflow_json: { nodes: [], edges: [] },
    ai_model: DEFAULT_MODEL,
    temperature: 0.5,
    top_p: 0.95,
    top_k: 40,
    thinking_budget: 1024,
    thinking_level: 'medium',
    tts_voice: 'Aoede',
    persona_form: null,
};


// =====================================================================
// PERSONA FORM TAB - Componente de Formulário Estruturado
// =====================================================================

const PRESET_QUALITIES = [
    'Empático',
    'Paciente',
    'Persuasivo / Vendedor',
    'Técnico / Especialista',
    'Educado & Cordial',
    'Bem-humorado',
    'Proativo',
    'Solícito',
    'Consultivo',
    'Atencioso',
    'Didático',
    'Objetivo',
    'Acolhedor',
    'Profissional',
    'Entusiasta',
    'Carismático',
    'Respeitoso',
    'Eficiente',
    'Calmo & Tranquilo',
    'Focado em Solução',
    'Amigável'
];

function QualitiesSelector({ selected = [], onChange }) {
    const [inputValue, setInputValue] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef(null);

    const toggleOpen = () => {
        const nextState = !isOpen;
        setIsOpen(nextState);
        if (nextState) {
            setTimeout(() => {
                containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 50);
        }
    };

    const addQuality = (quality) => {
        const trimmed = quality.trim();
        if (trimmed && !selected.includes(trimmed)) {
            onChange([...selected, trimmed]);
        }
        setInputValue('');
        // Mantém aberto para permitir adicionar várias opções em sequência
    };

    const removeQuality = (qualityToRemove) => {
        onChange(selected.filter(q => q !== qualityToRemove));
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (inputValue) {
                addQuality(inputValue);
            }
        }
    };

    const availablePresets = PRESET_QUALITIES.filter(q =>
        !selected.includes(q) &&
        (!inputValue || q.toLowerCase().includes(inputValue.toLowerCase()))
    );

    return (
        <div ref={containerRef} className="space-y-3 pt-2">
            <PFLabel>3. Qualidades e Atributos da IA</PFLabel>

            {/* Tags selecionadas */}
            {selected.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                    {selected.map(quality => (
                        <span
                            key={quality}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 text-blue-700 font-bold text-xs border border-blue-200/60 shadow-sm animate-fade-in"
                        >
                            {quality}
                            <button
                                type="button"
                                onClick={() => removeQuality(quality)}
                                className="hover:text-blue-900 text-blue-400 p-0.5 rounded-full hover:bg-blue-100 transition-colors"
                            >
                                <X size={12} />
                            </button>
                        </span>
                    ))}
                </div>
            )}

            {/* Input + Dropdown (Restaurado) */}
            <div className="relative">
                <div className="flex gap-2">
                    <div className="relative flex-1">
                        <input
                            type="text"
                            value={inputValue}
                            onChange={(e) => {
                                setInputValue(e.target.value);
                                if (!isOpen) {
                                    setIsOpen(true);
                                    setTimeout(() => {
                                        containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                                    }, 50);
                                }
                            }}
                            onFocus={() => {
                                if (!isOpen) {
                                    setIsOpen(true);
                                    setTimeout(() => {
                                        containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                                    }, 50);
                                }
                            }}
                            onKeyDown={handleKeyDown}
                            placeholder="Selecione das opções abaixo ou digite uma nova qualidade..."
                            className="config-input bg-white pr-8 text-xs"
                        />
                        <button
                            type="button"
                            onClick={toggleOpen}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                        >
                            <ChevronRight size={16} className={`transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`} />
                        </button>
                    </div>

                    {inputValue.trim() && !selected.includes(inputValue.trim()) && (
                        <button
                            type="button"
                            onClick={() => addQuality(inputValue)}
                            className="flex items-center gap-1 bg-blue-600 text-white font-bold text-xs px-4 py-2 rounded-xl hover:bg-blue-700 transition-all shrink-0 cursor-pointer"
                        >
                            <Plus size={14} /> Adicionar
                        </button>
                    )}
                </div>

                {/* Dropdown de sugestões em colunas (permanece aberto) */}
                {isOpen && availablePresets.length > 0 && (
                    <>
                        <div className="fixed inset-0 z-30" onClick={() => setIsOpen(false)} />
                        <div className="absolute left-0 right-0 mt-2 bg-white border border-slate-200/90 rounded-2xl shadow-2xl z-40 p-4 max-h-72 overflow-y-auto custom-scrollbar animate-in fade-in zoom-in-95 duration-150">
                            <div className="px-1 pb-2 text-[10px] font-black text-slate-400 uppercase tracking-wider border-b border-slate-100 mb-3 flex items-center justify-between">
                                <span>Sugestões de Qualidades Padrão ({availablePresets.length})</span>
                                <span className="text-[10px] text-slate-400 font-bold bg-slate-100 px-2 py-0.5 rounded-full">
                                    Clique para adicionar vários
                                </span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                                {availablePresets.map(preset => (
                                    <button
                                        key={preset}
                                        type="button"
                                        onClick={() => addQuality(preset)}
                                        className="w-full text-left px-3 py-2 rounded-xl text-xs font-bold text-slate-700 bg-slate-50/80 hover:bg-blue-50 hover:text-blue-600 border border-slate-100 hover:border-blue-200/80 flex items-center justify-between transition-all group cursor-pointer"
                                    >
                                        <span className="truncate">{preset}</span>
                                        <Plus size={13} className="text-slate-400 group-hover:text-blue-600 shrink-0 ml-1" />
                                    </button>
                                ))}
                            </div>
                        </div>
                    </>
                )}
            </div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tight flex items-center gap-1.5">
                <Info size={10} className="text-blue-500" /> Escolha entre as opções pré-definidas ou digite e pressione Enter para adicionar um novo atributo.
            </p>
        </div>
    );
}

function SliderControl({ label, value, min = 0, max = 1, step = 0.1, leftLabel, rightLabel, onChange }) {
    const numericVal = typeof value === 'number' ? value : (value === 'informal' || value === 'detalhado' ? 1 : 0);

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <span className="text-[11px] font-black text-slate-400 uppercase tracking-[0.15em]">
                    {label}
                </span>
                <span className="bg-blue-50 text-blue-600 font-bold px-3 py-0.5 rounded-full text-xs min-w-[36px] text-center shadow-xs">
                    {Number.isInteger(numericVal) ? numericVal : numericVal.toFixed(1)}
                </span>
            </div>

            <div className="relative flex items-center">
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={numericVal}
                    onChange={(e) => onChange(parseFloat(e.target.value))}
                    className="w-full accent-blue-600 h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer hover:bg-slate-200 transition-colors"
                />
            </div>

            <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                <span>{leftLabel}</span>
                <span>{rightLabel}</span>
            </div>
        </div>
    );
}

const LANGUAGE_OPTIONS = [
    'Português (BR)', 'Português (PT)', 'Português', 'English', 'Español', 'Français', 'Deutsch', 'Italiano', 'Mandarin', 'Japonês'
];

const FormSection = ({ icon: Icon, title, children }) => (
    <div className="bg-slate-50/50 border border-slate-200/60 rounded-2xl relative overflow-visible shadow-2xs">
        <div className="px-5 py-3.5 bg-white/80 border-b border-slate-100 flex items-center justify-between rounded-t-2xl">
            <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2">
                <div className="p-1.5 rounded-xl bg-blue-50 text-blue-600">
                    <Icon size={15} />
                </div>
                {title}
            </h3>
        </div>
        <div className="p-4 sm:p-5 space-y-4">{children}</div>
    </div>
);

const PFLabel = ({ children, required }) => (
    <label className="block text-xs font-bold text-slate-700 mb-1.5 ml-0.5">
        {children} {required && <span className="text-blue-500">*</span>}
    </label>
);

const PFInput = ({ value, onChange, placeholder, ...props }) => (
    <input
        value={value || ''}
        onChange={onChange}
        placeholder={placeholder}
        className="config-input bg-white"
        {...props}
    />
);

const PFTextarea = ({ value, onChange, placeholder, rows = 4 }) => (
    <textarea
        value={value || ''}
        onChange={onChange}
        placeholder={placeholder}
        rows={rows}
        className="config-input bg-white font-medium resize-y leading-relaxed"
    />
);

const JsonTreeItem = ({ keyName, value, path = '', selectedFields, setSelectedFields }) => {
    const [isExpanded, setIsExpanded] = useState(true);

    const isNumericKey = !isNaN(keyName);
    const cleanKeyName = isNumericKey ? `Item #${Number(keyName) + 1}` : keyName;

    const currentSegment = isNumericKey ? '' : keyName;
    const fullPath = path
        ? (currentSegment ? `${path}.${currentSegment}` : path)
        : currentSegment;

    const isObject = value !== null && typeof value === 'object';
    const isArray = Array.isArray(value);

    const getLeafPaths = (obj, p = '') => {
        if (obj === null || obj === undefined || typeof obj !== 'object') {
            return p ? [p] : [];
        }
        if (Array.isArray(obj)) {
            return obj.flatMap((item) => getLeafPaths(item, p));
        }
        return Object.keys(obj).flatMap((k) => {
            const cleanK = !isNaN(k) ? '' : k;
            const subPath = p ? (cleanK ? `${p}.${cleanK}` : p) : cleanK;
            return [cleanK, subPath, ...getLeafPaths(obj[k], subPath)].filter(Boolean);
        });
    };

    const leafPaths = isObject ? getLeafPaths(value, fullPath) : [fullPath, keyName].filter(Boolean);
    const isChecked = leafPaths.length > 0 && leafPaths.every(f => selectedFields.includes(f));
    const isIndeterminate = !isChecked && leafPaths.some(f => selectedFields.includes(f));

    const handleToggleCheck = (e) => {
        e.stopPropagation();
        if (isChecked) {
            setSelectedFields(selectedFields.filter(f => !leafPaths.includes(f)));
        } else {
            const next = Array.from(new Set([...selectedFields, ...leafPaths]));
            setSelectedFields(next);
        }
    };

    if (isObject) {
        const keys = Object.keys(value);
        return (
            <div className="select-none font-mono text-xs">
                <div
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="flex items-center gap-2 py-1 px-2 rounded-lg hover:bg-slate-100/80 transition-all cursor-pointer group"
                >
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
                        className="p-0.5 text-slate-400 group-hover:text-slate-700 rounded transition-transform"
                    >
                        <ChevronRight size={14} className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                    </button>

                    <input
                        type="checkbox"
                        checked={isChecked}
                        ref={el => { if (el) el.indeterminate = isIndeterminate; }}
                        onChange={handleToggleCheck}
                        onClick={(e) => e.stopPropagation()}
                        className="w-3.5 h-3.5 text-blue-600 rounded focus:ring-blue-500 border-slate-300 cursor-pointer"
                    />

                    <div className="p-1 rounded-md bg-amber-50 text-amber-600">
                        <Folder size={14} />
                    </div>

                    <span className="font-bold text-slate-800">
                        {cleanKeyName}
                    </span>

                    <span className="text-[10px] text-slate-400 font-semibold ml-1">
                        {isArray ? `[${keys.length} itens]` : `{${keys.length} campos}`}
                    </span>
                </div>

                {isExpanded && (
                    <div className="ml-5 pl-2.5 border-l border-slate-200/70 space-y-0.5 my-0.5">
                        {keys.map((subKey) => (
                            <JsonTreeItem
                                key={subKey}
                                keyName={subKey}
                                value={value[subKey]}
                                path={fullPath}
                                selectedFields={selectedFields}
                                setSelectedFields={setSelectedFields}
                            />
                        ))}
                    </div>
                )}
            </div>
        );
    }

    const isLeafChecked = selectedFields.includes(fullPath) || selectedFields.includes(keyName);

    return (
        <div className="flex items-center gap-2 py-1 px-2 rounded-lg hover:bg-slate-100/80 transition-all select-none font-mono text-xs">
            <span className="w-4 shrink-0 inline-block" />

            <input
                type="checkbox"
                checked={isLeafChecked}
                onChange={(e) => {
                    e.stopPropagation();
                    if (isLeafChecked) {
                        setSelectedFields(selectedFields.filter(f => f !== fullPath && f !== keyName));
                    } else {
                        setSelectedFields(Array.from(new Set([...selectedFields, fullPath, keyName].filter(Boolean))));
                    }
                }}
                className="w-3.5 h-3.5 text-blue-600 rounded focus:ring-blue-500 border-slate-300 cursor-pointer"
            />

            <div className="p-1 rounded-md bg-blue-50 text-blue-600">
                <FileText size={14} />
            </div>

            <span className="font-bold text-slate-700">
                {cleanKeyName}:
            </span>

            <span className="text-slate-500 truncate max-w-xs sm:max-w-md">
                {typeof value === 'string' ? `"${value}"` : String(value)}
            </span>
        </div>
    );
};

function RulesListInput({ label, items, placeholder, onChange }) {
    const [inputValue, setInputValue] = useState('');

    const currentList = Array.isArray(items)
        ? items
        : (typeof items === 'string' && items.trim()
            ? items.split('\n').map(s => s.replace(/^-\s*/, '').trim()).filter(Boolean)
            : []);

    const addItem = () => {
        const trimmed = inputValue.trim();
        if (trimmed && !currentList.includes(trimmed)) {
            onChange([...currentList, trimmed]);
            setInputValue('');
        }
    };

    const removeItem = (index) => {
        const updated = currentList.filter((_, i) => i !== index);
        onChange(updated);
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addItem();
        }
    };

    return (
        <div className="space-y-2.5">
            {label && <PFLabel>{label}</PFLabel>}

            {/* Lista de Regras Adicionadas (Durações longas expandem para col-span-2) */}
            {currentList.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pb-1">
                    {currentList.map((item, idx) => {
                        const isLong = item.length > 55;
                        return (
                            <div
                                key={idx}
                                className={`flex items-center justify-between gap-3 p-3 bg-white border border-slate-200/90 rounded-2xl shadow-2xs group hover:border-blue-300 hover:shadow-xs transition-all animate-fade-in ${isLong ? 'md:col-span-2' : 'md:col-span-1'
                                    }`}
                            >
                                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                    <span className="w-6 h-6 rounded-lg bg-blue-50 text-blue-600 font-bold text-[10px] flex items-center justify-center shrink-0">
                                        {idx + 1}
                                    </span>
                                    <span className="text-xs font-semibold text-slate-700 break-words flex-1">
                                        {item}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => removeItem(idx)}
                                    className="text-slate-300 hover:text-red-500 p-1.5 rounded-xl hover:bg-red-50 transition-colors shrink-0 cursor-pointer"
                                    title="Remover regra"
                                >
                                    <Trash2 size={15} />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Input + Botão Adicionar */}
            <div className="flex gap-2">
                <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder || "Digite uma nova regra e pressione Enter para adicionar..."}
                    className="config-input bg-white text-xs flex-1"
                />
                <button
                    type="button"
                    onClick={addItem}
                    disabled={!inputValue.trim()}
                    className="flex items-center gap-1.5 bg-blue-600 text-white font-bold text-xs px-4 py-2.5 rounded-xl hover:bg-blue-700 transition-all disabled:opacity-40 shrink-0 cursor-pointer shadow-xs"
                >
                    <Plus size={14} /> Adicionar
                </button>
            </div>
        </div>
    );
}

function PersonaFormTab({ personaForm, onChange, hasSpreadsheet }) {
    const form = personaForm || {};

    const update = (key, value) => onChange({ ...form, [key]: value });

    return (
        <div className="animate-fade-in space-y-5 sm:space-y-6">

            {/* SEÇÃO 1: Identidade */}
            <FormSection icon={User} title="Identidade da IA">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <PFLabel required>Nome da IA</PFLabel>
                        <PFInput
                            value={form.ai_name}
                            onChange={e => update('ai_name', e.target.value)}
                            placeholder="Ex: Sofia, Max, AtendBot..."
                        />
                        <p className="mt-2 text-[10px] font-bold text-slate-400 uppercase tracking-tight flex items-center gap-1.5">
                            <Info size={10} className="text-blue-500" /> Como a IA se apresenta aos clientes
                        </p>
                    </div>
                    <div>
                        <PFLabel>Empresa / Marca</PFLabel>
                        <PFInput
                            value={form.company_name}
                            onChange={e => update('company_name', e.target.value)}
                            placeholder="Ex: Loja das Flores, TechSolve..."
                        />
                    </div>
                    <div>
                        <PFLabel>Função / Cargo</PFLabel>
                        <PFInput
                            value={form.role}
                            onChange={e => update('role', e.target.value)}
                            placeholder="Ex: Assistente de Vendas, Suporte Técnico..."
                        />
                    </div>
                    <div>
                        <PFLabel>Idioma Principal</PFLabel>
                        <select
                            value={form.language || 'Português (BR)'}
                            onChange={e => update('language', e.target.value)}
                            className="config-input appearance-none cursor-pointer bg-white"
                        >
                            {LANGUAGE_OPTIONS.map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                        <p className="mt-2 text-[10px] font-bold text-slate-400 uppercase tracking-tight flex items-center gap-1.5">
                            <Info size={10} className="text-blue-500" /> Idioma padrão das respostas e atendimento da IA
                        </p>
                    </div>

                    {/* Seletor de Natureza da Identidade */}
                    <div className="md:col-span-2 space-y-2 pt-2">
                        <PFLabel>Natureza da Identidade (Se perguntado se é IA)</PFLabel>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <button
                                type="button"
                                onClick={() => update('nature_identity', 'ai')}
                                className={`p-4 rounded-2xl border text-left transition-all flex flex-col justify-between cursor-pointer ${(form.nature_identity === 'ai')
                                    ? 'bg-blue-50/80 border-blue-500 text-blue-900 shadow-xs ring-2 ring-blue-500/20'
                                    : 'bg-white border-slate-200 hover:border-slate-300 text-slate-700'
                                    }`}
                            >
                                <div className="flex items-center justify-between mb-1.5">
                                    <span className="text-xs font-black uppercase tracking-wider">IA (Transparente)</span>
                                    <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${form.nature_identity === 'ai' ? 'border-blue-600 bg-blue-600' : 'border-slate-300'}`}>
                                        {form.nature_identity === 'ai' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                    </div>
                                </div>
                                <p className="text-[11px] font-medium text-slate-500 leading-relaxed">
                                    Confirma abertamente ser uma inteligência artificial assistente.
                                </p>
                            </button>

                            <button
                                type="button"
                                onClick={() => update('nature_identity', 'human')}
                                className={`p-4 rounded-2xl border text-left transition-all flex flex-col justify-between cursor-pointer ${(form.nature_identity === 'human' || !form.nature_identity)
                                    ? 'bg-blue-50/80 border-blue-500 text-blue-900 shadow-xs ring-2 ring-blue-500/20'
                                    : 'bg-white border-slate-200 hover:border-slate-300 text-slate-700'
                                    }`}
                            >
                                <div className="flex items-center justify-between mb-1.5">
                                    <span className="text-xs font-black uppercase tracking-wider">Humana</span>
                                    <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${(form.nature_identity === 'human' || !form.nature_identity) ? 'border-blue-600 bg-blue-600' : 'border-slate-300'}`}>
                                        {(form.nature_identity === 'human' || !form.nature_identity) && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                    </div>
                                </div>
                                <p className="text-[11px] font-medium text-slate-500 leading-relaxed">
                                    Oculta a natureza artificial e afirma ser um atendente humano.
                                </p>
                            </button>

                            <button
                                type="button"
                                onClick={() => update('nature_identity', 'ignore')}
                                className={`p-4 rounded-2xl border text-left transition-all flex flex-col justify-between cursor-pointer ${(form.nature_identity === 'ignore')
                                    ? 'bg-blue-50/80 border-blue-500 text-blue-900 shadow-xs ring-2 ring-blue-500/20'
                                    : 'bg-white border-slate-200 hover:border-slate-300 text-slate-700'
                                    }`}
                            >
                                <div className="flex items-center justify-between mb-1.5">
                                    <span className="text-xs font-black uppercase tracking-wider">Ignorar / Evasiva</span>
                                    <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${form.nature_identity === 'ignore' ? 'border-blue-600 bg-blue-600' : 'border-slate-300'}`}>
                                        {form.nature_identity === 'ignore' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                    </div>
                                </div>
                                <p className="text-[11px] font-medium text-slate-500 leading-relaxed">
                                    Desvia do assunto de forma evasiva sem confirmar nem negar.
                                </p>
                            </button>
                        </div>
                    </div>
                </div>

            </FormSection>

            {/* SEÇÃO 2: Tom de Voz e Estilo de Comunicação */}
            <FormSection icon={MessageSquare} title="Tom de Voz e Estilo de Comunicação">
                <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pb-2">
                        <SliderControl
                            label="FORMALIDADE"
                            value={form.formality ?? 0}
                            min={0}
                            max={1}
                            step={0.1}
                            leftLabel="FORMAL"
                            rightLabel="INFORMAL"
                            onChange={newVal => update('formality', newVal)}
                        />
                        <SliderControl
                            label="OBJETIVIDADE"
                            value={form.objectivity ?? 0}
                            min={0}
                            max={1}
                            step={0.1}
                            leftLabel="DIRETO"
                            rightLabel="DETALHADO"
                            onChange={newVal => update('objectivity', newVal)}
                        />
                    </div>

                    {/* Sub-seção 3: Qualidades da IA */}
                    <QualitiesSelector
                        selected={form.qualities || []}
                        onChange={newQualities => update('qualities', newQualities)}
                    />
                </div>
            </FormSection>

            {/* SEÇÃO 3: Missão e Objetivo */}
            <FormSection icon={Target} title="Missão e Objetivo">
                <div>
                    <PFLabel>Missão / Objetivo Principal</PFLabel>
                    <PFTextarea
                        value={form.objective}
                        onChange={e => update('objective', e.target.value)}
                        placeholder="Ex: Qualificar leads, responder dúvidas sobre produtos, agendar demonstrações e transferir para vendas quando o cliente demonstrar intenção de compra."
                        rows={3}
                    />
                </div>
            </FormSection>

            {/* SEÇÃO 5: Regras e Restrições */}
            <FormSection icon={Shield} title="Regras e Restrições">
                <RulesListInput
                    label="Regras de Comportamento e Restrições"
                    items={form.restrictions}
                    placeholder="Ex: NUNCA mencione concorrentes / Não ofereça descontos sem aprovação..."
                    onChange={updatedRestrictions => update('restrictions', updatedRestrictions)}
                />
                <RulesListInput
                    label="Regras de Transbordo"
                    items={form.handoff_rules}
                    placeholder="Ex: Transfira se o cliente pedir atendente humano..."
                    onChange={updatedHandoff => update('handoff_rules', updatedHandoff)}
                />
            </FormSection>

            {/* SEÇÃO 6: Instruções Adicionais */}
            <FormSection icon={Wand2} title="Instruções Adicionais">
                <div>
                    <PFLabel>Outras Diretrizes</PFLabel>
                    <PFTextarea
                        value={form.extra_instructions}
                        onChange={e => update('extra_instructions', e.target.value)}
                        placeholder="Qualquer outra instrução importante que não se encaixa nas categorias acima..."
                        rows={4}
                    />
                </div>
            </FormSection>

            <div className="h-4" />
        </div>
    );
}


function Configs() {
    const [configs, setConfigs] = useState([]);
    const [selectedConfig, setSelectedConfig] = useState(null);
    const [formData, setFormData] = useState(initialFormData);
    const [userData, setUserData] = useState(null);

    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [error, setError] = useState('');

    // Estados Sheets
    const [spreadsheetId, setSpreadsheetId] = useState(''); // System
    const [showSystemHelp, setShowSystemHelp] = useState(false);
    const [showRagHelp, setShowRagHelp] = useState(false);
    const [showDriveHelp, setShowDriveHelp] = useState(false); // System
    const [spreadsheetRagId, setSpreadsheetRagId] = useState(''); // RAG

    // Estados Drive (Novo)
    const [driveFolderId, setDriveFolderId] = useState('');

    // Estados Agenda
    const [schedule, setSchedule] = useState({});
    const [activeTab, setActiveTab] = useState('system'); // 'system', 'rag', 'drive', 'notifications', 'agenda'

    // Estados do Workflow
    const [isWorkflowModalOpen, setIsWorkflowModalOpen] = useState(false);
    const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
    const [feedbackMode, setFeedbackMode] = useState('knowledge');
    const [mobileView, setMobileView] = useState('list'); // 'list' ou 'form'

    const isInitialLoad = useRef(true);

    const dayLabels = { seg: 'Segunda', ter: 'Terça', qua: 'Quarta', qui: 'Quinta', sex: 'Sexta', sab: 'Sábado', dom: 'Domingo' };

    const activeTabsList = useMemo(() => [
        { id: 'ia', label: 'Modelo IA', icon: Cpu },
        { id: 'persona', label: 'Persona', icon: Sparkles },
        { id: 'system', label: 'Instruções', icon: FileText },
        { id: 'rag', label: 'Conhecimento', icon: Database },
        { id: 'drive', label: 'Arquivos', icon: Folder },
        { id: 'fluxo', label: 'Fluxo', icon: Network },
        { id: 'agenda', label: 'Agenda', icon: Calendar }
        // { id: 'integracoes', label: 'Integrações', icon: LinkIcon } // Desativado momentaneamente
    ], []);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [configsRes, userRes] = await Promise.all([
                api.get('/configs/'),
                api.get('/auth/me')
            ]);
            setConfigs(configsRes.data);
            setUserData(userRes.data);
        } catch (err) {
            setError('Não foi possível carregar os dados.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Ref e Efeito para fechar dropdown ao clicar fora
    const dropdownRef = useRef(null);

    useEffect(() => {
        function handleClickOutside(event) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsDropdownOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleSelectConfig = useCallback((config) => {
        setSelectedConfig(config);
        setFormData({
            nome_config: config.nome_config,
            contexto_json: config.contexto_json || null,
            arquivos_drive_json: config.arquivos_drive_json || null,
            notification_active: config.notification_active || false,
            notification_destination: config.notification_destination || '',
            is_calendar_connected: !!config.google_calendar_credentials,
            is_calendar_active: config.is_calendar_active || false,
            workflow_json: {
                nodes: config.workflow_json?.nodes || [],
                edges: (config.workflow_json?.edges || []).map(e => ({ ...e, type: 'customEdge' }))
            },
            persona_form: config.persona_form || null,
            ai_model: config.ai_model || DEFAULT_MODEL,
            temperature: config.temperature ?? 0.5,
            top_p: config.top_p ?? 0.95,
            top_k: config.top_k ?? 40,
            thinking_budget: config.thinking_budget ?? 1024,
            thinking_level: config.thinking_level ? String(config.thinking_level).replace(/['"]/g, '').trim().toLowerCase() : 'medium',
            tts_voice: config.tts_voice ? String(config.tts_voice).replace(/['"]/g, '').trim() : 'Aoede'
        });

        // Parse Schedule
        const parsedSchedule = {};
        ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'].forEach(day => {
            const dayHours = config.available_hours?.[day] || [];
            parsedSchedule[day] = {
                active: dayHours.length > 0,
                blocks: dayHours.length > 0
                    ? dayHours.map(h => {
                        const [start, end] = h.split('-');
                        return { start: start?.trim(), end: end?.trim() };
                    })
                    : [{ start: '09:00', end: '18:00' }]
            };
        });
        setSchedule(parsedSchedule);

        // Sheets
        setSpreadsheetId(config.spreadsheet_id || '');
        setSpreadsheetRagId(config.spreadsheet_rag_id || '');

        // Drive
        setDriveFolderId(config.drive_id || '');

        // Verifica se o destino salvo está na lista (se não estiver e tiver valor, ativa modo manual)
        // Isso será feito após carregar os destinos, ou assumimos manual se não for vazio

        // No mobile, após selecionar, vamos para o formulário
        setMobileView('form');
        setActiveTab('ia');
        setError('');
    }, []);

    useEffect(() => {
        if (isInitialLoad.current && configs.length > 0 && userData !== null) {
            const activePersonaId = userData?.company?.default_persona_id;
            const activeConfig = activePersonaId
                ? configs.find(c => c.id === activePersonaId)
                : null;
            handleSelectConfig(activeConfig || configs[0]);
            isInitialLoad.current = false;
        }
    }, [configs, userData, handleSelectConfig]);

    const handleNewConfig = useCallback(() => {
        setSelectedConfig(null);
        setFormData(initialFormData);
        setSpreadsheetId('');
        setSpreadsheetRagId('');
        setDriveFolderId('');
        const defaultSchedule = {};
        ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'].forEach(day => {
            defaultSchedule[day] = { active: false, blocks: [{ start: '09:00', end: '18:00' }] };
        });
        setSchedule(defaultSchedule);
        setMobileView('form');
        setActiveTab('persona');
        setError('');
    }, []);

    const handleFormChange = (e) => {
        const { name, value, type, checked } = e.target;
        const val = type === 'checkbox' ? checked : value;
        setFormData(prev => ({ ...prev, [name]: val }));
    };

    // Handlers Agenda
    const toggleDay = (day) => setSchedule(prev => ({ ...prev, [day]: { ...prev[day], active: !prev[day].active } }));
    const addTimeBlock = (day) => setSchedule(prev => ({ ...prev, [day]: { ...prev[day], blocks: [...prev[day].blocks, { start: '09:00', end: '18:00' }] } }));
    const removeTimeBlock = (day, index) => setSchedule(prev => {
        const newBlocks = [...prev[day].blocks];
        newBlocks.splice(index, 1);
        return { ...prev, [day]: { ...prev[day], blocks: newBlocks } };
    });
    const updateTimeBlock = (day, index, field, value) => setSchedule(prev => {
        const newBlocks = [...prev[day].blocks];
        newBlocks[index] = { ...newBlocks[index], [field]: value };
        return { ...prev, [day]: { ...prev[day], blocks: newBlocks } };
    });

    const handleConnectCalendar = async () => {
        if (!selectedConfig?.id) return toast.error("Salve a configuração antes de conectar.");
        try {
            localStorage.setItem('pendingCalendarConfigId', selectedConfig.id);
            const redirectUri = window.location.origin + window.location.pathname;
            const response = await api.get(`/configs/google-calendar/auth-url?redirect_uri=${encodeURIComponent(redirectUri)}`);
            if (response.data.authorization_url) window.location.href = response.data.authorization_url;
        } catch (err) { toast.error("Erro ao iniciar conexão."); }
    };

    const handleSave = async (e, workflowOverride = null) => {
        if (e) e.preventDefault();
        setIsSaving(true);
        setError('');

        const serializedHours = {};
        Object.keys(schedule).forEach(day => {
            if (schedule[day]?.active) {
                serializedHours[day] = schedule[day].blocks
                    .filter(b => b.start && b.end)
                    .map(b => `${b.start}-${b.end}`);
            } else {
                serializedHours[day] = [];
            }
        });

        const payload = {
            nome_config: formData.nome_config,
            contexto_json: formData.contexto_json,
            arquivos_drive_json: formData.arquivos_drive_json,
            spreadsheet_id: spreadsheetId,
            spreadsheet_rag_id: spreadsheetRagId,
            drive_id: driveFolderId,
            notification_active: formData.notification_active,
            notification_destination: formData.notification_destination,
            available_hours: serializedHours,
            is_calendar_active: formData.is_calendar_active,
            workflow_json: workflowOverride || formData.workflow_json,
            ai_model: formData.ai_model,
            temperature: formData.temperature,
            top_p: formData.top_p,
            top_k: formData.top_k,
            thinking_budget: formData.thinking_budget,
            thinking_level: formData.thinking_level,
            tts_voice: formData.tts_voice,
            persona_form: formData.persona_form,
        };
        try {
            let updatedConfig;
            if (selectedConfig?.id) {
                const response = await api.put(`/configs/${selectedConfig.id}`, payload);
                updatedConfig = response.data;
            } else {
                const response = await api.post('/configs/', payload);
                updatedConfig = response.data;
            }
            await fetchData();
            handleSelectConfig(updatedConfig);
            if (!workflowOverride) toast.success('Configuração salva com sucesso!');
        } catch (err) {
            toast.error('Erro ao salvar. Verifique os campos.');
            throw err;
        } finally {
            setIsSaving(false);
        }
    };

    // Efeito para capturar o retorno do OAuth
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        const pendingId = localStorage.getItem('pendingCalendarConfigId');
        const pendingProvisionId = localStorage.getItem('pendingProvisionConfigId');
        const pendingProvisionType = localStorage.getItem('pendingProvisionType');

        if (code) {
            if (pendingId) {
                window.history.replaceState({}, document.title, window.location.pathname);
                const handleCallback = async () => {
                    setIsLoading(true);
                    try {
                        await api.post('/configs/google-calendar/callback', {
                            code,
                            config_id: pendingId,
                            redirect_uri: window.location.origin + window.location.pathname
                        });
                        toast.success('Google Agenda conectado!');
                        localStorage.removeItem('pendingCalendarConfigId');
                        fetchData();
                    } catch (err) { toast.error('Falha na conexão.'); }
                    finally { setIsLoading(false); }
                };
                handleCallback();
            } else if (pendingProvisionId && pendingProvisionType) {
                window.history.replaceState({}, document.title, window.location.pathname);
                const handleProvisionCallback = async () => {
                    setIsSyncing(true);
                    try {
                        const response = await api.post('/configs/provision', {
                            config_id: parseInt(pendingProvisionId),
                            resource_type: pendingProvisionType,
                            code: code,
                            redirect_uri: window.location.origin + window.location.pathname
                        });
                        toast.success("Recurso criado e compartilhado com sucesso!");

                        // Atualiza o estado local imediatamente com o novo ID recebido
                        const newId = response.data?.id;
                        if (newId) {
                            setSelectedConfig(prev => {
                                if (!prev) return prev;
                                const updated = { ...prev };
                                if (pendingProvisionType === 'system') updated.spreadsheet_id = newId;
                                if (pendingProvisionType === 'rag') updated.spreadsheet_rag_id = newId;
                                if (pendingProvisionType === 'drive') updated.drive_id = newId;
                                return updated;
                            });
                            if (pendingProvisionType === 'system') setSpreadsheetId(newId);
                            if (pendingProvisionType === 'rag') setSpreadsheetRagId(newId);
                            if (pendingProvisionType === 'drive') setDriveFolderId(newId);
                        }

                        localStorage.removeItem('pendingProvisionConfigId');
                        localStorage.removeItem('pendingProvisionType');
                        fetchData();
                    } catch (err) {
                        toast.error(err.response?.data?.detail || 'Falha ao criar o recurso no Google.');
                    } finally {
                        setIsSyncing(false);
                    }
                };
                handleProvisionCallback();
            }
        }
    }, [fetchData]);

    const handleDelete = async (id) => {
        if (window.confirm('Tem certeza que deseja excluir esta configuração?')) {
            try {
                await api.delete(`/configs/${id}`);

                const newConfigs = configs.filter(c => c.id !== id);
                setConfigs(newConfigs);
                if (newConfigs.length > 0) {
                    handleSelectConfig(newConfigs[0]);
                } else {
                    handleNewConfig();
                }
                toast.success('Configuração excluída com sucesso!');
            } catch (err) {
                toast.error('Erro ao excluir. Esta configuração pode estar em uso como padrão.');
            }
        }
    };

    const handleSetDefault = async (configId) => {
        const currentDefault = userData?.company?.default_persona_id;
        if (currentDefault === configId) return;
        try {
            await api.post(`/configs/${configId}/set-default`);
            // Atualiza o estado local imediatamente para a estrela refletir sem precisar recarregar
            setUserData(prev => prev ? {
                ...prev,
                company: prev.company ? { ...prev.company, default_persona_id: configId } : prev.company
            } : prev);
        } catch (err) {
            setError('Erro ao definir a configuração padrão.');
        }
    };

    const handleCopyEmail = () => {
        navigator.clipboard.writeText(BOT_EMAIL);
        toast.success("Email copiado para a área de transferência!");
    };

    // --- Criar Recursos Automaticamente (Provision) ---
    const handleProvision = async (type) => {
        if (!selectedConfig?.id) return toast.error("Salve a configuração antes de criar os recursos.");

        try {
            localStorage.setItem('pendingProvisionConfigId', selectedConfig.id);
            localStorage.setItem('pendingProvisionType', type);
            const redirectUri = window.location.origin + window.location.pathname;
            const response = await api.get(`/configs/google-auth-url?redirect_uri=${encodeURIComponent(redirectUri)}`);
            if (response.data.authorization_url) {
                window.location.href = response.data.authorization_url;
            }
        } catch (err) {
            toast.error('Erro ao iniciar login com o Google.');
        }
    };

    // --- Sync Sheets (Genérico) ---
    const handleSyncSheet = async (type) => {
        if (!selectedConfig) return toast.error("Salve a configuração antes de sincronizar.");

        const targetId = type === 'rag' ? spreadsheetRagId : spreadsheetId;
        if (!targetId) return toast.error("Insira o ID ou Link da planilha.");

        setIsSyncing(true);
        setError('');
        try {
            const payload = { config_id: selectedConfig.id, spreadsheet_id: targetId, type: type };
            const response = await api.post('/configs/sync_sheet', payload, {
                timeout: 7200000 // 120 minutos para comportar grandes volumes
            });

            if (type === 'system') {
                // Atualiza o form data localmente para garantir integridade ao salvar depois
                setFormData(prev => ({ ...prev, contexto_json: null }));
            }

            toast.success(`Sucesso! ${response.data.sheets_found} bases sincronizadas (${type.toUpperCase()}).`);
        } catch (err) {
            setError(err.response?.data?.detail || 'Falha ao sincronizar. Verifique se compartilhou a planilha com o e-mail do robô.');
        } finally {
            setIsSyncing(false);
        }
    };

    // --- Sync Drive ---
    const handleSyncDrive = async () => {
        if (!selectedConfig) return toast.error("Salve a configuração antes de sincronizar.");
        if (!driveFolderId) return toast.error("Insira o ID da pasta do Drive.");

        setIsSyncing(true);
        setError('');
        try {
            const payload = { config_id: selectedConfig.id, drive_id: driveFolderId };
            const response = await api.post('/configs/sync_drive', payload, {
                timeout: 7200000 // 120 minutos para comportar grandes volumes de arquivos
            });

            const filesCount = response.data.files_found || 0;

            // Atualiza o form data localmente
            setFormData(prev => ({ ...prev, arquivos_drive_json: null }));

            toast.success(`Sincronização concluída! ${filesCount} dados atualizados.`);
        } catch (err) {
            setError(err.response?.data?.detail || 'Falha ao sincronizar Drive. Verifique o ID e o compartilhamento.');
        } finally {
            setIsSyncing(false);
        }
    };

    const extractId = (value) => {
        if (!value) return "";
        const sheetMatch = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        if (sheetMatch) return sheetMatch[1];
        const folderMatch = value.match(/\/folders\/([a-zA-Z0-9-_]+)/);
        if (folderMatch) return folderMatch[1];
        return value;
    };

    const handleSpreadsheetIdChange = (e) => {
        const val = extractId(e.target.value);
        setSpreadsheetId(val);
    };

    const handleSpreadsheetRagIdChange = (e) => {
        const val = extractId(e.target.value);
        setSpreadsheetRagId(val);
    };

    const handleDriveFolderIdChange = (e) => {
        const val = extractId(e.target.value);
        setDriveFolderId(val);
    };

    const openResource = (id, type) => {
        if (!id) return;
        const baseUrl = type === 'drive'
            ? 'https://drive.google.com/drive/folders/'
            : 'https://docs.google.com/spreadsheets/d/';
        window.open(`${baseUrl}${id}`, '_blank');
    };


    const labelClass = "block text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3 ml-1";
    const inputClass = "config-input";

    if (isLoading && configs.length === 0) {
        return <PageLoader message="Configurações da Persona" subMessage="Carregando modelos e diretrizes..." />;
    }

    return (
        <div className="p-0 sm:p-4 md:p-5 bg-[#f0f4ff] flex-1 flex flex-col configs-page h-full sm:h-[93vh]">
            <style>{DS_STYLE}</style>

            <div className="mx-auto w-full flex-1 flex flex-col min-h-0">
                <div className={`${mobileView === 'form' ? 'hidden sm:block' : 'block'} mb-6 p-4 sm:p-0`}>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-200">
                            <Bot size={22} className="text-white" />
                        </div>
                        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
                            Persona <span className="text-blue-600 font-black">IA</span>
                        </h1>
                    </div>
                    <p className="text-slate-500 font-medium text-xs sm:text-sm flex items-center gap-2">
                        <Info size={14} className="text-blue-400" /> Gerencie identidades e comportamentos da sua inteligência artificial.
                    </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1 min-h-0 sm:h-full overflow-hidden">
                    {/* SIDEBAR: SELEÇÃO DE PERSONA */}
                    <div className={`${mobileView === 'form' ? 'hidden sm:flex' : 'flex'} lg:col-span-3 space-y-4 sm:space-y-8 flex flex-col h-full sm:h-[78vh] p-4 sm:p-0`}>
                        <button onClick={handleNewConfig} className="w-full h-14 sm:h-16 flex items-center justify-center gap-3 bg-blue-600 text-white font-black text-sm uppercase tracking-widest rounded-[1.5rem] sm:rounded-3xl shadow-xl shadow-blue-200 hover:bg-blue-700 hover:-translate-y-1 transition-all active:scale-[0.98] shrink-0">
                            <Plus size={20} /> Nova Persona
                        </button>

                        <div className="bg-white p-4 sm:p-5 rounded-[2rem] shadow-sm border border-slate-100 flex flex-col flex-1 min-h-0 overflow-hidden">
                            <h2 className="text-[10px] sm:text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 sm:mb-6 px-2">Identidades Ativas</h2>

                            {isLoading ? (
                                <PageLoader fullScreen={false} message="Sincronizando Identidades" subMessage="" />
                            ) : (
                                <ul className="space-y-2 sm:space-y-3 overflow-y-auto custom-scrollbar flex-1 pr-1">
                                    {configs.map(config => {
                                        const isDefault = userData?.company?.default_persona_id === config.id;
                                        const isSelected = selectedConfig?.id === config.id;
                                        return (
                                            <li key={config.id} className="persona-card group">
                                                <div className={`p-3 sm:p-4 rounded-2xl sm:rounded-3xl flex items-center gap-3 sm:gap-4 transition-all ${isSelected ? 'bg-blue-50/50 shadow-sm' : 'hover:bg-slate-50'}`}>
                                                    <button onClick={() => handleSetDefault(config.id)} title="Definir como padrão" className="relative shrink-0">
                                                        <div className={`w-10 h-10 rounded-xl sm:rounded-2xl flex items-center justify-center transition-all ${isDefault ? 'bg-amber-100 text-amber-500 shadow-sm' : 'bg-slate-50 text-slate-300 hover:text-amber-400'}`}>
                                                            <Star size={18} className={isDefault ? 'fill-current' : ''} />
                                                        </div>
                                                        {isDefault && <div className="absolute -top-1 -right-1 w-3 h-3 bg-amber-400 border-2 border-white rounded-full"></div>}
                                                    </button>

                                                    <button onClick={() => handleSelectConfig(config)} className="flex-1 text-left min-w-0">
                                                        <h3 className={`text-sm font-bold truncate ${isSelected ? 'text-blue-600' : 'text-slate-700'}`}>
                                                            {config.nome_config}
                                                        </h3>
                                                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">Ativo</p>
                                                    </button>

                                                    <ChevronRight size={16} className={`text-slate-300 transition-all ${isSelected ? 'text-blue-600' : 'opacity-0 sm:group-hover:opacity-100'}`} />
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>
                    </div>

                    {/* MAIN CONTENT Area */}
                    <div className={`${mobileView === 'list' ? 'hidden sm:flex' : 'flex'} lg:col-span-9 bg-white rounded-0 sm:rounded-[2.5rem] shadow-sm border-none sm:border border-slate-100 flex flex-col h-full sm:h-[78vh] min-h-0`}>
                        <form onSubmit={handleSave} className="flex-1 flex flex-col min-h-0 overflow-hidden">
                            {/* Header & Tabs - Fixo no topo */}
                            <div className="px-4 pt-4 sm:px-6 sm:pt-6 md:px-8 md:pt-8 bg-white/80 backdrop-blur-md sticky top-0 z-20 shrink-0 border-b border-slate-50">
                                {/* Header da Config */}
                                <div className="flex flex-col md:flex-row md:items-center gap-4 sm:gap-6 mb-6 sm:mb-10">
                                    <div className="flex items-center gap-3 sm:gap-5 flex-1 min-w-0">
                                        <button
                                            type="button"
                                            onClick={() => setMobileView('list')}
                                            className="sm:hidden w-10 h-10 flex items-center justify-center rounded-xl bg-white border border-slate-100 text-slate-400 shadow-sm shrink-0 active:scale-95 transition-all"
                                        >
                                            <ChevronLeft size={20} />
                                        </button>

                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-3">
                                                <div className="hidden sm:flex w-12 h-12 rounded-2xl bg-blue-50 items-center justify-center text-blue-600 shadow-inner shrink-0">
                                                    <FileText size={24} />
                                                </div>
                                                <input
                                                    type="text"
                                                    placeholder="Nome da Persona"
                                                    name="nome_config"
                                                    value={formData.nome_config}
                                                    onChange={handleFormChange}
                                                    required
                                                    className="w-full text-2xl sm:text-3xl font-black text-slate-900 bg-transparent border-none focus:ring-0 placeholder:text-slate-200 tracking-tight p-0"
                                                />
                                            </div>
                                            <p className="text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] mt-1 sm:mt-2 ml-0 sm:ml-12">Configurações da Persona</p>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 sm:gap-3">
                                        {selectedConfig && (
                                            <button
                                                type="button"
                                                onClick={() => handleDelete(selectedConfig.id)}
                                                className="w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center rounded-xl sm:rounded-2xl bg-red-50 text-red-500 hover:bg-red-100 transition-all shrink-0"
                                                title="Excluir Persona"
                                            >
                                                <Trash2 size={18} sm:size={20} />
                                            </button>
                                        )}
                                        <button
                                            type="submit"
                                            disabled={isSaving}
                                            className="flex-1 sm:flex-none flex items-center justify-center gap-2 sm:gap-3 bg-blue-600 text-white font-black text-[10px] sm:text-xs uppercase tracking-widest py-3 sm:py-3.5 px-4 sm:px-8 rounded-xl sm:rounded-2xl shadow-xl shadow-blue-200 hover:bg-blue-700 transition-all disabled:bg-slate-300"
                                        >
                                            {isSaving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                                            <span className="hidden sm:inline">Guardar Persona</span>
                                            <span className="sm:hidden">Salvar</span>
                                        </button>
                                    </div>
                                </div>

                                {/* Abas de Configuração */}
                                <div className="flex gap-1 border-b border-slate-100 overflow-x-auto custom-scrollbar overflow-y-hidden mb-0">
                                    {activeTabsList.map(tab => {
                                        const Icon = tab.icon;
                                        return (
                                            <button
                                                key={tab.id}
                                                type="button"
                                                onClick={() => setActiveTab(tab.id)}
                                                className={`config-tab relative flex items-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-2.5 sm:py-3.5 text-[10px] sm:text-xs font-bold transition-all whitespace-nowrap ${activeTab === tab.id ? 'active text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
                                            >
                                                <Icon size={14} className="sm:w-4 sm:h-4" strokeWidth={activeTab === tab.id ? 2.5 : 2} />
                                                {tab.label}
                                                {tab.isNew && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-blue-500 rounded-full"></span>}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Área de Conteúdo - Rolável */}
                            <div className="flex-1 flex flex-col overflow-y-auto custom-scrollbar p-4 sm:p-6 md:p-8 min-h-0">
                                {error && (

                                    <div className="mb-4 p-3 bg-red-50 text-red-700 rounded border border-red-200 text-sm">
                                        {error}
                                    </div>
                                )}

                                {/* CONTEÚDO ABA: PERSONA FORM (NOVO) */}
                                {activeTab === 'persona' && (
                                    <PersonaFormTab
                                        personaForm={formData.persona_form || {}}
                                        onChange={(updatedForm) => setFormData(prev => ({ ...prev, persona_form: updatedForm }))}
                                        hasSpreadsheet={!!selectedConfig?.spreadsheet_id}
                                    />
                                )}

                                {/* CONTEÚDO ABA: INTEGRAÇÕES */}
                                {activeTab === 'integracoes' && (
                                    <IntegrationsTab selectedConfig={selectedConfig} />
                                )}

                                {/* CONTEÚDO ABA: SYSTEM (INSTRUÇÕES) */}
                                {activeTab === 'system' && (
                                    <div className="animate-fade-in space-y-8">
                                        {/* Status / Configuração da Planilha */}
                                        <div className="bg-white p-6 sm:p-8 rounded-[2rem] border border-slate-100 shadow-sm space-y-6">
                                            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
                                                <div className="flex items-center gap-4">
                                                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${spreadsheetId ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'}`}>
                                                        <FileText size={24} />
                                                    </div>
                                                    <div>
                                                        <h3 className="font-black text-slate-900 leading-tight">
                                                            {spreadsheetId ? 'Matriz de Instruções Ativa' : 'Matriz de Instruções'}
                                                        </h3>
                                                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
                                                            {spreadsheetId ? 'Conectado via Google Sheets' : 'Não configurada'}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
                                                    {/* Input ID da planilha (Mais Largo) */}
                                                    <input
                                                        type="text"
                                                        value={spreadsheetId}
                                                        onChange={handleSpreadsheetIdChange}
                                                        placeholder="Cole o link ou ID da planilha..."
                                                        className="px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:bg-white transition-all text-xs h-[38px] flex-grow sm:flex-initial sm:w-[360px]"
                                                    />

                                                    {/* Botão de ajuda "?" */}
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowSystemHelp(!showSystemHelp)}
                                                        className={`rounded-xl border transition-all text-xs font-black flex items-center justify-center h-[38px] w-[38px] shrink-0 ${showSystemHelp ? 'bg-blue-600 border-blue-600 text-white shadow-md' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                                                        title="Ajuda para compartilhar"
                                                    >
                                                        <HelpCircle size={18} />
                                                    </button>

                                                    {spreadsheetId && (
                                                        <>
                                                            {/* Botão Ver Planilha */}
                                                            <button
                                                                type="button"
                                                                onClick={() => openResource(spreadsheetId, 'sheet')}
                                                                className="flex items-center justify-center gap-1.5 px-4 py-2 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all font-bold text-slate-600 text-xs h-[38px]"
                                                            >
                                                                <ExternalLink size={15} /> Ver Planilha
                                                            </button>

                                                            {/* Botão IA */}
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setFeedbackMode('knowledge');
                                                                    setIsFeedbackModalOpen(true);
                                                                }}
                                                                className="flex items-center justify-center gap-1.5 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-black py-2 px-4 rounded-xl shadow-md transition-all text-xs h-[38px]"
                                                            >
                                                                <Sparkles size={15} /> IA
                                                            </button>

                                                            {/* Botão Sincronizar */}
                                                            <button
                                                                type="button"
                                                                disabled={isSyncing}
                                                                onClick={() => handleSyncSheet('system')}
                                                                className="flex items-center justify-center gap-1.5 bg-blue-600 text-white font-black py-2 px-5 rounded-xl shadow-md hover:bg-blue-700 transition-all disabled:bg-slate-300 disabled:opacity-50 text-xs h-[38px]"
                                                            >
                                                                {isSyncing ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />} Sincronizar
                                                            </button>
                                                        </>
                                                    )}

                                                    {/* Botão Gerar Automático (caso não exista ID configurado) */}
                                                    {!spreadsheetId && (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleProvision('system')}
                                                            disabled={isSyncing || !selectedConfig?.id}
                                                            className="flex items-center justify-center gap-2 bg-white text-slate-700 font-bold px-4 py-2 rounded-xl border border-slate-200 hover:border-blue-300 hover:text-blue-600 transition-all disabled:opacity-50 shadow-sm text-xs h-[38px]"
                                                        >
                                                            {isSyncing ? <Loader2 className="animate-spin" size={15} /> : (
                                                                <>
                                                                    <img src="https://img.icons8.com/color/24/000000/google-logo.png" alt="Google" className="w-4 h-4" />
                                                                    Gerar
                                                                </>
                                                            )}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Ajuda para anexar a planilha (Colapsável) */}
                                            {showSystemHelp && (
                                                <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100 space-y-3.5 animate-fade-in">
                                                    <h4 className="text-[11px] font-black text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                                                        <Info size={14} className="text-blue-500" /> Como Compartilhar a Planilha de Instruções com a IA?
                                                    </h4>
                                                    <ol className="text-xs text-slate-600 space-y-2 list-decimal list-inside font-medium leading-relaxed">
                                                        <li>
                                                            Copie o e-mail do robô integrador:
                                                            <div className="mt-1.5 flex items-center gap-2 max-w-md">
                                                                <code className="bg-white px-2.5 py-1 rounded-lg border border-slate-200 text-[10px] select-all font-mono break-all flex-1">
                                                                    {BOT_EMAIL}
                                                                </code>
                                                                <button type="button" onClick={handleCopyEmail} className="p-1.5 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-500 transition-colors shrink-0" title="Copiar e-mail">
                                                                    <Copy size={13} />
                                                                </button>
                                                            </div>
                                                        </li>
                                                        <li>Abra o documento no Google Sheets.</li>
                                                        <li>Clique no botão <strong>Compartilhar</strong> no canto superior direito.</li>
                                                        <li>Adicione o e-mail copiado acima e defina a permissão como <strong>Editor</strong>.</li>
                                                        <li>Clique em <strong>Enviar</strong> para concluir.</li>
                                                    </ol>
                                                </div>
                                            )}
                                        </div>

                                        {spreadsheetId && (
                                            <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-4 sm:p-6 overflow-hidden">
                                                <div className="flex items-center justify-between mb-4 px-2">
                                                    <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                                        <FileText size={14} className="text-green-500" /> Pré-visualização da Planilha de Instruções
                                                    </h4>
                                                    <span className="text-[10px] text-slate-400 font-bold bg-green-50 text-green-700 px-2.5 py-1 rounded-full">Google Sheets</span>
                                                </div>
                                                <div className="w-full h-[450px] rounded-2xl overflow-hidden border border-slate-100 bg-slate-50 relative">
                                                    <iframe
                                                        src={`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?usp=drivesdk&rm=minimal`}
                                                        className="w-full h-full border-none"
                                                        allowFullScreen
                                                        title="Planilha de Instruções"
                                                    />
                                                </div>
                                                <p className="text-[11px] text-slate-400 font-medium mt-2 px-2">
                                                    *Caso a planilha não apareça, certifique-se de estar conectado à sua conta Google com acesso ao documento.
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* CONTEÚDO ABA: FLUXO VISUAL */}
                                {activeTab === 'fluxo' && (
                                    <div className="animate-fade-in space-y-8 flex-1 flex flex-col min-h-0 overflow-y-scroll custom-scrollbar">
                                        {/* Preview do Canvas */}
                                        <div className="flex-1 bg-slate-50 border border-slate-100 rounded-[2.5rem] relative overflow-hidden group shadow-inner min-h-[550px]">
                                            <div className="absolute inset-0 z-10 bg-slate-900/5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer backdrop-blur-[2px]" onClick={() => setIsWorkflowModalOpen(true)}>
                                                <div className="bg-white px-8 py-4 rounded-3xl shadow-2xl font-black text-slate-900 flex items-center gap-3 text-sm uppercase tracking-widest border border-slate-100">
                                                    <Network size={22} className="text-blue-600" /> Editar Fluxograma
                                                </div>
                                            </div>
                                            <WorkflowPreview workflowJson={formData.workflow_json} />
                                        </div>
                                    </div>
                                )}

                                {/* CONTEÚDO ABA: (CONHECIMENTO) */}
                                {activeTab === 'rag' && (
                                    <div className="animate-fade-in space-y-8">
                                        {/* Status / Configuração da Planilha */}
                                        <div className="bg-white p-6 sm:p-8 rounded-[2rem] border border-slate-100 shadow-sm space-y-6">
                                            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
                                                <div className="flex items-center gap-4">
                                                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${spreadsheetRagId ? 'bg-indigo-50 text-indigo-600' : 'bg-blue-50 text-blue-600'}`}>
                                                        <Database size={24} />
                                                    </div>
                                                    <div>
                                                        <h3 className="font-black text-slate-900 leading-tight">
                                                            {spreadsheetRagId ? 'Base de Conhecimento Ativa' : 'Base de Conhecimento'}
                                                        </h3>
                                                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
                                                            {spreadsheetRagId ? 'Conectado via Google Sheets' : 'Não configurada'}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
                                                    {/* Input ID da planilha (Mais Largo) */}
                                                    <input
                                                        type="text"
                                                        value={spreadsheetRagId}
                                                        onChange={handleSpreadsheetRagIdChange}
                                                        placeholder="Cole o link ou ID da planilha..."
                                                        className="px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white transition-all text-xs h-[38px] flex-grow sm:flex-initial sm:w-[360px]"
                                                    />

                                                    {/* Botão de ajuda "?" */}
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowRagHelp(!showRagHelp)}
                                                        className={`rounded-xl border transition-all text-xs font-black flex items-center justify-center h-[38px] w-[38px] shrink-0 ${showRagHelp ? 'bg-indigo-600 border-indigo-600 text-white shadow-md' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                                                        title="Ajuda para compartilhar"
                                                    >
                                                        <HelpCircle size={18} />
                                                    </button>

                                                    {spreadsheetRagId && (
                                                        <>
                                                            {/* Botão Ver Planilha */}
                                                            <button
                                                                type="button"
                                                                onClick={() => openResource(spreadsheetRagId, 'sheet')}
                                                                className="flex items-center justify-center gap-1.5 px-4 py-2 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all font-bold text-slate-600 text-xs h-[38px]"
                                                            >
                                                                <ExternalLink size={15} /> Ver Planilha
                                                            </button>

                                                            {/* Botão IA */}
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setFeedbackMode('knowledge');
                                                                    setIsFeedbackModalOpen(true);
                                                                }}
                                                                className="flex items-center justify-center gap-1.5 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-black py-2 px-4 rounded-xl shadow-md transition-all text-xs h-[38px]"
                                                            >
                                                                <Sparkles size={15} /> IA
                                                            </button>

                                                            {/* Botão Sincronizar */}
                                                            <button
                                                                type="button"
                                                                disabled={isSyncing}
                                                                onClick={() => handleSyncSheet('rag')}
                                                                className="flex items-center justify-center gap-1.5 bg-indigo-600 text-white font-black py-2 px-5 rounded-xl shadow-md hover:bg-indigo-700 transition-all disabled:bg-slate-300 disabled:opacity-50 text-xs h-[38px]"
                                                            >
                                                                {isSyncing ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />} Sincronizar
                                                            </button>
                                                        </>
                                                    )}

                                                    {/* Botão Gerar Automático (caso não exista ID configurado) */}
                                                    {!spreadsheetRagId && (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleProvision('rag')}
                                                            disabled={isSyncing || !selectedConfig?.id}
                                                            className="flex items-center justify-center gap-2 bg-white text-slate-700 font-bold px-4 py-2 rounded-xl border border-slate-200 hover:border-indigo-300 hover:text-indigo-600 transition-all disabled:opacity-50 shadow-sm text-xs h-[38px]"
                                                        >
                                                            {isSyncing ? <Loader2 className="animate-spin" size={15} /> : (
                                                                <>
                                                                    <img src="https://img.icons8.com/color/24/000000/google-logo.png" alt="Google" className="w-4 h-4" />
                                                                    Gerar
                                                                </>
                                                            )}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Ajuda para anexar a planilha (Colapsável) */}
                                            {showRagHelp && (
                                                <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100 space-y-3.5 animate-fade-in">
                                                    <h4 className="text-[11px] font-black text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                                                        <Info size={14} className="text-indigo-500" /> Como Compartilhar a Planilha de Conhecimento com a IA?
                                                    </h4>
                                                    <ol className="text-xs text-slate-600 space-y-2 list-decimal list-inside font-medium leading-relaxed">
                                                        <li>
                                                            Copie o e-mail do robô integrador:
                                                            <div className="mt-1.5 flex items-center gap-2 max-w-md">
                                                                <code className="bg-white px-2.5 py-1 rounded-lg border border-slate-200 text-[10px] select-all font-mono break-all flex-1">
                                                                    {BOT_EMAIL}
                                                                </code>
                                                                <button type="button" onClick={handleCopyEmail} className="p-1.5 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-500 transition-colors shrink-0" title="Copiar e-mail">
                                                                    <Copy size={13} />
                                                                </button>
                                                            </div>
                                                        </li>
                                                        <li>Abra o documento no Google Sheets.</li>
                                                        <li>Clique no botão <strong>Compartilhar</strong> no canto superior direito.</li>
                                                        <li>Adicione o e-mail copiado acima e defina a permissão como <strong>Editor</strong>.</li>
                                                        <li>Clique em <strong>Enviar</strong> para concluir.</li>
                                                    </ol>
                                                </div>
                                            )}
                                        </div>

                                        {spreadsheetRagId && (
                                            <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-4 sm:p-6 overflow-hidden">
                                                <div className="flex items-center justify-between mb-4 px-2">
                                                    <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                                        <Database size={14} className="text-indigo-500" /> Pré-visualização da Planilha de Conhecimento
                                                    </h4>
                                                    <span className="text-[10px] text-slate-400 font-bold bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full">Google Sheets</span>
                                                </div>
                                                <div className="w-full h-[450px] rounded-2xl overflow-hidden border border-slate-100 bg-slate-50 relative">
                                                    <iframe
                                                        src={`https://docs.google.com/spreadsheets/d/${spreadsheetRagId}/edit?usp=drivesdk&rm=minimal`}
                                                        className="w-full h-full border-none"
                                                        allowFullScreen
                                                        title="Planilha de Conhecimento"
                                                    />
                                                </div>
                                                <p className="text-[11px] text-slate-400 font-medium mt-2 px-2">
                                                    *Caso a planilha não apareça, certifique-se de estar conectado à sua conta Google com acesso ao documento.
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* CONTEÚDO ABA: DRIVE */}
                                {activeTab === 'drive' && (
                                    <div className="animate-fade-in space-y-8 overflow-y-scroll custom-scrollbar">
                                        {/* Status / Configuração do Drive */}
                                        <div className="bg-white p-6 sm:p-8 rounded-[2rem] border border-slate-100 shadow-sm space-y-6">
                                            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
                                                <div className="flex items-center gap-4">
                                                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${driveFolderId ? 'bg-blue-50 text-blue-600' : 'bg-slate-50 text-slate-400'}`}>
                                                        <Folder size={24} />
                                                    </div>
                                                    <div>
                                                        <h3 className="font-black text-slate-900 leading-tight">
                                                            {driveFolderId ? 'Google Drive Conectado' : 'Google Drive'}
                                                        </h3>
                                                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
                                                            {driveFolderId ? 'Armazenamento Ativo' : 'Não configurado'}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
                                                    {/* Input ID da pasta (Mais Largo) */}
                                                    <input
                                                        type="text"
                                                        value={driveFolderId}
                                                        onChange={handleDriveFolderIdChange}
                                                        placeholder="Cole o link ou ID da pasta..."
                                                        className="px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white transition-all text-xs h-[38px] flex-grow sm:flex-initial sm:w-[360px]"
                                                    />

                                                    {/* Botão de ajuda "?" */}
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowDriveHelp(!showDriveHelp)}
                                                        className={`rounded-xl border transition-all text-xs font-black flex items-center justify-center h-[38px] w-[38px] shrink-0 ${showDriveHelp ? 'bg-indigo-600 border-indigo-600 text-white shadow-md' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                                                        title="Ajuda para compartilhar"
                                                    >
                                                        <HelpCircle size={18} />
                                                    </button>

                                                    {driveFolderId && (
                                                        <>
                                                            {/* Botão Abrir Pasta */}
                                                            <button
                                                                type="button"
                                                                onClick={() => openResource(driveFolderId, 'drive')}
                                                                className="flex items-center justify-center gap-1.5 px-4 py-2 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all font-bold text-slate-600 text-xs h-[38px]"
                                                            >
                                                                <ExternalLink size={15} /> Abrir Pasta
                                                            </button>

                                                            {/* Botão Sincronizar */}
                                                            <button
                                                                type="button"
                                                                disabled={isSyncing}
                                                                onClick={handleSyncDrive}
                                                                className="flex items-center justify-center gap-1.5 bg-indigo-600 text-white font-black py-2 px-5 rounded-xl shadow-md hover:bg-indigo-700 transition-all disabled:bg-slate-300 disabled:opacity-50 text-xs h-[38px]"
                                                            >
                                                                {isSyncing ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />} Sincronizar
                                                            </button>
                                                        </>
                                                    )}

                                                    {/* Botão Gerar Automático (caso não exista ID configurado) */}
                                                    {!driveFolderId && (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleProvision('drive')}
                                                            disabled={isSyncing || !selectedConfig?.id}
                                                            className="flex items-center justify-center gap-2 bg-white text-slate-700 font-bold px-4 py-2 rounded-xl border border-slate-200 hover:border-indigo-300 hover:text-indigo-600 transition-all disabled:opacity-50 shadow-sm text-xs h-[38px]"
                                                        >
                                                            {isSyncing ? <Loader2 className="animate-spin" size={15} /> : (
                                                                <>
                                                                    <img src="https://img.icons8.com/color/24/000000/google-logo.png" alt="Google" className="w-4 h-4" />
                                                                    Gerar
                                                                </>
                                                            )}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Ajuda para anexar a pasta (Colapsável) */}
                                            {showDriveHelp && (
                                                <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100 space-y-3.5 animate-fade-in">
                                                    <h4 className="text-[11px] font-black text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                                                        <Info size={14} className="text-indigo-500" /> Como Compartilhar a Pasta do Google Drive com a IA?
                                                    </h4>
                                                    <ol className="text-xs text-slate-600 space-y-2 list-decimal list-inside font-medium leading-relaxed">
                                                        <li>
                                                            Copie o e-mail do robô integrador:
                                                            <div className="mt-1.5 flex items-center gap-2 max-w-md">
                                                                <code className="bg-white px-2.5 py-1 rounded-lg border border-slate-200 text-[10px] select-all font-mono break-all flex-1">
                                                                    {BOT_EMAIL}
                                                                </code>
                                                                <button type="button" onClick={handleCopyEmail} className="p-1.5 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-500 transition-colors shrink-0" title="Copiar e-mail">
                                                                    <Copy size={13} />
                                                                </button>
                                                            </div>
                                                        </li>
                                                        <li>Abra a pasta no Google Drive.</li>
                                                        <li>Clique no botão <strong>Compartilhar</strong> no canto superior direito.</li>
                                                        <li>Adicione o e-mail copiado acima e defina a permissão como <strong>Leitor</strong> (ou <strong>Editor</strong>).</li>
                                                        <li>Clique em <strong>Enviar</strong> para concluir.</li>
                                                    </ol>
                                                </div>
                                            )}
                                        </div>

                                        {driveFolderId && (
                                            <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-4 sm:p-6 overflow-hidden">
                                                <div className="flex items-center justify-between mb-4 px-2">
                                                    <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                                        <Folder size={14} className="text-blue-500" /> Visualizador do Google Drive
                                                    </h4>
                                                    <span className="text-[10px] text-slate-400 font-bold bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full">Google Drive</span>
                                                </div>
                                                <div className="w-full h-[450px] rounded-2xl overflow-hidden border border-slate-100 bg-slate-50 relative">
                                                    <iframe
                                                        src={`https://drive.google.com/embeddedfolderview?id=${driveFolderId}#grid`}
                                                        className="w-full h-full border-none"
                                                        allowFullScreen
                                                        title="Pasta de Arquivos no Drive"
                                                    />
                                                </div>
                                                <p className="text-[11px] text-slate-400 font-medium mt-2 px-2">
                                                    *Caso a pasta não apareça, certifique-se de estar conectado à sua conta Google com acesso ao diretório.
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* CONTEÚDO ABA: AGENDA */}
                                {activeTab === 'agenda' && (
                                    <div className="animate-fade-in space-y-8 overflow-y-scroll custom-scrollbar">
                                        <div className="p-4 sm:p-6 bg-slate-50 border border-slate-100 rounded-2xl sm:rounded-3xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
                                            <div className="flex items-center gap-4">
                                                <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl flex items-center justify-center transition-colors ${formData.is_calendar_connected ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-400'}`}>
                                                    <Calendar size={20} sm:size={24} />
                                                </div>
                                                <div>
                                                    <p className="text-sm font-black text-slate-900 leading-tight">{formData.is_calendar_connected ? "Google Agenda" : "Agenda Pendente"}</p>
                                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tight mt-0.5">Gestão Automática</p>
                                                </div>
                                            </div>
                                            <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
                                                <div className="flex items-center justify-between sm:justify-start w-full sm:w-auto gap-4 bg-white/50 p-2 px-4 rounded-xl border border-slate-100 sm:border-none">
                                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Status IA</span>
                                                    <button type="button" onClick={() => setFormData(p => ({ ...p, is_calendar_active: !p.is_calendar_active }))} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formData.is_calendar_active ? 'bg-blue-600' : 'bg-slate-200'}`}>
                                                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${formData.is_calendar_active ? 'translate-x-6' : 'translate-x-1'}`} />
                                                    </button>
                                                </div>
                                                {!formData.is_calendar_connected ? (
                                                    <button type="button" onClick={handleConnectCalendar} className="w-full sm:w-auto px-6 py-2.5 bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-blue-700 transition shadow-lg shadow-blue-100">Conectar</button>
                                                ) : (
                                                    <button type="button" onClick={() => api.post(`/configs/google-calendar/${selectedConfig.id}/disconnect`).then(() => fetchData())} className="w-full sm:w-auto px-6 py-2.5 bg-red-50 text-red-500 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-red-100 transition">Desvincular</button>
                                                )}
                                            </div>
                                        </div>

                                        <div className="bg-white border border-slate-100 rounded-[2rem] overflow-hidden shadow-sm">
                                            <div className="p-6 bg-slate-50/50 border-b border-slate-50">
                                                <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-1.5 sm:gap-2">
                                                    <Clock size={16} className="text-blue-600" /> Janelas de Disponibilidade
                                                </h3>
                                            </div>
                                            <div className="p-6 space-y-4">
                                                {['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'].map(day => (
                                                    <div key={day} className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6 p-3 sm:p-4 rounded-xl sm:rounded-2xl hover:bg-slate-50/50 transition-colors border border-transparent sm:border-none">
                                                        <div className="w-full sm:w-28 flex-shrink-0 flex items-center justify-between sm:block">
                                                            <label className="flex items-center cursor-pointer group">
                                                                <div className="relative">
                                                                    <input type="checkbox" className="sr-only" checked={schedule[day]?.active || false} onChange={() => toggleDay(day)} />
                                                                    <div className={`block w-9 h-5 rounded-full transition-colors ${schedule[day]?.active ? 'bg-blue-600' : 'bg-slate-200'}`}></div>
                                                                    <div className={`absolute left-0.5 top-0.5 bg-white w-4 h-4 rounded-full transition-transform ${schedule[day]?.active ? 'transform translate-x-4' : ''}`}></div>
                                                                </div>
                                                                <span className={`ml-3 text-xs font-black uppercase tracking-widest transition-colors ${schedule[day]?.active ? 'text-blue-600' : 'text-slate-400'}`}>{dayLabels[day]}</span>
                                                            </label>
                                                        </div>
                                                        <div className="flex-1 flex flex-wrap gap-1.5 sm:gap-2 items-center w-full">
                                                            {schedule[day]?.active ? (
                                                                <>
                                                                    {schedule[day].blocks.map((block, idx) => (
                                                                        <div key={idx} className="flex items-center gap-1.5 sm:gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-100 shadow-sm animate-fade-in">
                                                                            <input type="time" value={block.start} onChange={(e) => updateTimeBlock(day, idx, 'start', e.target.value)} className="bg-transparent text-xs font-bold text-slate-700 outline-none w-16 text-center" />
                                                                            <span className="text-slate-300 font-black">/</span>
                                                                            <input type="time" value={block.end} onChange={(e) => updateTimeBlock(day, idx, 'end', e.target.value)} className="bg-transparent text-xs font-bold text-slate-700 outline-none w-16 text-center" />
                                                                            <button type="button" onClick={() => removeTimeBlock(day, idx)} className="text-slate-300 hover:text-red-500 ml-1 transition-colors"><X size={14} /></button>
                                                                        </div>
                                                                    ))}
                                                                    <button type="button" onClick={() => addTimeBlock(day)} className="w-8 h-8 flex items-center justify-center bg-blue-50 text-blue-600 rounded-full hover:bg-blue-100 transition-all"><Plus size={16} /></button>
                                                                </>
                                                            ) : (
                                                                <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest italic">Indisponível para novos agendamentos</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* CONTEÚDO ABA: IA (MODELO) */}
                                {activeTab === 'ia' && (
                                    <div className="animate-fade-in space-y-5 sm:space-y-6">
                                        {/* SEÇÃO 1: Modelo & Voz */}
                                        <FormSection icon={Cpu} title="Modelo de IA & Síntese de Voz">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                                <div>
                                                    <PFLabel>Modelo de Inteligência</PFLabel>
                                                    <select
                                                        name="ai_model"
                                                        value={formData.ai_model}
                                                        onChange={handleFormChange}
                                                        className={`${inputClass} appearance-none cursor-pointer bg-white`}
                                                    >
                                                        {LLM_MODELS.map(model => (
                                                            <option key={model.id} value={model.id}>{model.name}</option>
                                                        ))}
                                                    </select>
                                                    <p className="mt-2 text-[10px] font-bold text-slate-400 uppercase tracking-tight flex items-center gap-1.5">
                                                        <Zap size={11} className="text-amber-500" /> Modelo recomendado para automação de mensagens em massa
                                                    </p>
                                                </div>

                                                <div>
                                                    <PFLabel>Voz para Áudio no WhatsApp (TTS)</PFLabel>
                                                    <select
                                                        name="tts_voice"
                                                        value={formData.tts_voice || 'Aoede'}
                                                        onChange={handleFormChange}
                                                        className={`${inputClass} appearance-none cursor-pointer bg-white`}
                                                    >
                                                        <option value="Aoede">Aoede (Feminina / Expressiva e Natural)</option>
                                                        <option value="Charon">Charon (Masculina / Grave e Profissional)</option>
                                                        <option value="Fenrir">Fenrir (Masculina / Forte e Confiante)</option>
                                                        <option value="Kore">Kore (Feminina / Suave e Acolhedora)</option>
                                                        <option value="Puck">Puck (Masculina / Amigável e Descontraída)</option>
                                                    </select>
                                                    <p className="mt-2 text-[10px] font-bold text-slate-400 uppercase tracking-tight flex items-center gap-1.5">
                                                        <Bot size={11} className="text-blue-500" /> Voz utilizada quando a IA gera áudios de resposta
                                                    </p>
                                                </div>
                                            </div>
                                        </FormSection>

                                        {/* SEÇÃO 2: Raciocínio e Criatividade */}
                                        <FormSection icon={Brain} title="Raciocínio & Temperatura">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                <div>
                                                    <PFLabel>Nível de Raciocínio (Thinking)</PFLabel>
                                                    <select
                                                        name="thinking_level"
                                                        value={formData.thinking_level || 'medium'}
                                                        onChange={handleFormChange}
                                                        className={`${inputClass} appearance-none cursor-pointer bg-white`}
                                                    >
                                                        <option value="default">Padrão do Modelo</option>
                                                        <option value="minimal">Mínimo (Mais Rápido)</option>
                                                        <option value="low">Baixo (Equilibrado Rápido)</option>
                                                        <option value="medium">Médio (Recomendado)</option>
                                                        <option value="high">Máximo (Análise Profunda)</option>
                                                    </select>
                                                    <p className="mt-2 text-[10px] font-bold text-slate-400 uppercase tracking-tight flex items-center gap-1.5">
                                                        <Sparkles size={11} className="text-indigo-500" /> Esforço cognitivo interno da IA antes de formular a resposta
                                                    </p>
                                                </div>

                                                <div>
                                                    <div className="flex justify-between items-center mb-1.5">
                                                        <PFLabel>Criatividade (Temperature)</PFLabel>
                                                        <span className="text-xs font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-100">{formData.temperature}</span>
                                                    </div>
                                                    <input
                                                        type="range"
                                                        name="temperature"
                                                        min="0"
                                                        max="2"
                                                        step="0.1"
                                                        value={formData.temperature}
                                                        onChange={handleFormChange}
                                                        className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600 my-2"
                                                    />
                                                    <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                                        <span>0.0 (Factual / Estrito)</span>
                                                        <span>2.0 (Muito Criativo)</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </FormSection>

                                        {/* SEÇÃO 3: Ajustes Finos de Amostragem (Avançado) */}
                                        <FormSection icon={Sliders} title="Ajustes Finos de Amostragem (Avançado)">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                                                <div>
                                                    <PFLabel>Corte de Vocabulário (Top K)</PFLabel>
                                                    <input
                                                        type="number"
                                                        name="top_k"
                                                        min="1"
                                                        max="50"
                                                        value={formData.top_k}
                                                        onChange={handleFormChange}
                                                        className={`${inputClass} bg-white`}
                                                    />
                                                    <p className="mt-2 text-[10px] font-bold text-slate-400 uppercase tracking-tight">
                                                        Limita a seleção aos K tokens mais prováveis (Padrão: 40)
                                                    </p>
                                                </div>

                                                <div>
                                                    <div className="flex justify-between items-center mb-1.5">
                                                        <PFLabel>Diversidade de Resposta (Top P)</PFLabel>
                                                        <span className="text-xs font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-100">{formData.top_p}</span>
                                                    </div>
                                                    <input
                                                        type="range"
                                                        name="top_p"
                                                        min="0"
                                                        max="1"
                                                        step="0.05"
                                                        value={formData.top_p}
                                                        onChange={handleFormChange}
                                                        className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600 my-2"
                                                    />
                                                    <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                                        <span>0.0 (Mais Focado)</span>
                                                        <span>1.0 (Mais Amplo)</span>
                                                    </div>
                                                </div>

                                            </div>
                                        </FormSection>
                                    </div>
                                )}
                            </div>

                        </form>
                    </div>
                </div>
            </div>

            {/* MODAL DE CONSTRUÇÃO DE FLUXO (UI ATUALIZADA) */}
            <WorkflowEditorModal
                isOpen={isWorkflowModalOpen}
                onClose={() => setIsWorkflowModalOpen(false)}
                initialWorkflow={formData.workflow_json}
                configId={selectedConfig?.id}
                onSave={(currentWorkflow) => {
                    setFormData(prev => ({ ...prev, workflow_json: currentWorkflow }));
                }}
                onSaveAndPersist={async (currentWorkflow) => {
                    await handleSave(null, currentWorkflow);
                }}
            />

            {isFeedbackModalOpen && (
                <FeedbackModal
                    isOpen={isFeedbackModalOpen}
                    onClose={() => {
                        setIsFeedbackModalOpen(false);
                        fetchData(); // para atualizar caso o fluxo mude
                    }}
                    configId={selectedConfig?.id}
                    mode={feedbackMode}
                />
            )}
        </div>
    );
}

// =====================================================================
// TAB DE INTEGRAÇÕES (POLLING 5 MIN & WEBHOOKS NO HEADER)
// =====================================================================
function IntegrationsTab({ selectedConfig }) {
    const [integrations, setIntegrations] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingIntegration, setEditingIntegration] = useState(null);
    const [isSyncingId, setIsSyncingId] = useState(null);

    const [formData, setFormData] = useState({
        name: '',
        integration_type: 'polling',
        url: '',
        method: 'GET',
        headers: '',
        body: '',
        items_path: '',
        title_field: '',
        content_field: '',
        category: 'integração',
        sync_interval_minutes: 5,
        enabled: true
    });

    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState(null);
    const [candidatePaths, setCandidatePaths] = useState([]);
    const [detectedFields, setDetectedFields] = useState([]);
    const [headerList, setHeaderList] = useState([{ key: '', value: '' }]);

    const parseHeadersToList = (headersObj) => {
        if (!headersObj) return [{ key: '', value: '' }];
        let obj = headersObj;
        if (typeof headersObj === 'string') {
            try { obj = JSON.parse(headersObj); } catch (e) { return [{ key: '', value: '' }]; }
        }
        if (obj && typeof obj === 'object') {
            const list = Object.entries(obj).map(([k, v]) => ({ key: k, value: String(v) }));
            return list.length > 0 ? list : [{ key: '', value: '' }];
        }
        return [{ key: '', value: '' }];
    };

    const buildHeadersObject = (list) => {
        const result = {};
        if (Array.isArray(list)) {
            list.forEach(item => {
                if (item.key && item.key.trim()) {
                    result[item.key.trim()] = item.value || '';
                }
            });
        }
        return Object.keys(result).length > 0 ? result : null;
    };

    const handleAddHeaderRow = () => {
        setHeaderList(prev => [...prev, { key: '', value: '' }]);
    };

    const handleRemoveHeaderRow = (index) => {
        setHeaderList(prev => {
            const updated = prev.filter((_, i) => i !== index);
            return updated.length > 0 ? updated : [{ key: '', value: '' }];
        });
    };

    const handleHeaderChange = (index, field, val) => {
        setHeaderList(prev => {
            const updated = [...prev];
            updated[index] = { ...updated[index], [field]: val };
            return updated;
        });
    };
    const [postmanTab, setPostmanTab] = useState('params');
    const [paramList, setParamList] = useState([{ key: '', value: '' }]);
    const [authData, setAuthData] = useState({
        type: 'none',
        token: '',
        apiKeyName: 'X-API-Key',
        apiKeyValue: '',
        username: '',
        password: ''
    });
    const [bodyType, setBodyType] = useState('json');
    const [formUrlEncodedList, setFormUrlEncodedList] = useState([{ key: '', value: '' }]);
    const [selectedItemIndices, setSelectedItemIndices] = useState([]);
    const [selectedFields, setSelectedFields] = useState([]);
    const lastPayloadHashRef = useRef(null);

    const extractAllJsonFields = (data) => {
        if (!data) return [];
        const fields = new Set();
        const walk = (item) => {
            if (!item || typeof item !== 'object') return;
            if (Array.isArray(item)) {
                item.forEach(elem => walk(elem));
            } else {
                Object.keys(item).forEach(key => {
                    fields.add(key);
                });
            }
        };
        walk(data);
        return Array.from(fields);
    };

    const getExtractedItems = (data, path) => {
        if (!data) return [];
        let target = data;
        if (path) {
            const parts = path.split('.');
            for (const p of parts) {
                if (target && typeof target === 'object' && p in target) {
                    target = target[p];
                }
            }
        }
        if (Array.isArray(target)) return target;
        if (target && typeof target === 'object') return [target];
        return [];
    };

    const buildParamsObject = (list) => {
        const result = {};
        if (Array.isArray(list)) {
            list.forEach(item => {
                if (item.key && item.key.trim()) {
                    result[item.key.trim()] = item.value || '';
                }
            });
        }
        return Object.keys(result).length > 0 ? result : null;
    };

    const buildAuthHeaders = (auth) => {
        const headers = {};
        if (auth.type === 'bearer' && auth.token?.trim()) {
            headers['Authorization'] = `Bearer ${auth.token.trim()}`;
        } else if (auth.type === 'apikey' && auth.apiKeyName?.trim() && auth.apiKeyValue?.trim()) {
            headers[auth.apiKeyName.trim()] = auth.apiKeyValue.trim();
        } else if (auth.type === 'basic' && (auth.username || auth.password)) {
            try {
                const credentials = btoa(`${auth.username || ''}:${auth.password || ''}`);
                headers['Authorization'] = `Basic ${credentials}`;
            } catch (e) { }
        }
        return headers;
    };

    const buildFinalHeaders = (customHeadersList, auth) => {
        const customObj = buildHeadersObject(customHeadersList) || {};
        const authObj = buildAuthHeaders(auth);
        const merged = { ...customObj, ...authObj };
        return Object.keys(merged).length > 0 ? merged : null;
    };

    const buildFinalBody = (type, rawText, formList) => {
        if (type === 'json') {
            if (!rawText) return null;
            try { return JSON.parse(rawText); }
            catch (e) { return rawText; }
        } else if (type === 'form') {
            return buildHeadersObject(formList);
        } else if (type === 'graphql') {
            return { query: rawText };
        } else {
            return rawText || null;
        }
    };

    const handleAddParamRow = () => setParamList(prev => [...prev, { key: '', value: '' }]);
    const handleRemoveParamRow = (idx) => setParamList(prev => {
        const updated = prev.filter((_, i) => i !== idx);
        return updated.length > 0 ? updated : [{ key: '', value: '' }];
    });
    const handleParamChange = (idx, field, val) => setParamList(prev => {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], [field]: val };
        return updated;
    });

    const fetchIntegrations = useCallback(async () => {
        if (!selectedConfig?.id) return;
        setIsLoading(true);
        try {
            const res = await api.get(`/configs/${selectedConfig.id}/integrations`);
            setIntegrations(res.data);
        } catch (err) {
            toast.error('Erro ao carregar integrações.');
        } finally {
            setIsLoading(false);
        }
    }, [selectedConfig?.id]);

    useEffect(() => {
        fetchIntegrations();
    }, [fetchIntegrations]);

    // Efeito para escutar requisições de Webhook recebidas ao vivo quando o modal estiver aberto
    useEffect(() => {
        if (!isModalOpen || formData.integration_type !== 'webhook' || !editingIntegration?.id) {
            return;
        }

        let isMounted = true;
        const intervalId = setInterval(async () => {
            try {
                const res = await api.get(`/configs/integrations/${editingIntegration.id}/last-payload`);
                if (isMounted && res.data?.has_payload && res.data?.data) {
                    const receivedJson = res.data.data;
                    const jsonStr = JSON.stringify(receivedJson);

                    // Atualiza SOMENTE se o payload for NOVO / DIFERENTE
                    if (lastPayloadHashRef.current !== jsonStr) {
                        lastPayloadHashRef.current = jsonStr;
                        setTestResult({ data: receivedJson });

                        const newFields = extractAllJsonFields(receivedJson);
                        setDetectedFields(newFields);
                        setSelectedFields(prev => (prev && prev.length > 0 ? prev : newFields));
                    }
                }
            } catch (err) {
                // Silencioso se falhar poll individual
            }
        }, 3000);

        return () => {
            isMounted = false;
            clearInterval(intervalId);
        };
    }, [isModalOpen, formData.integration_type, editingIntegration?.id]);

    const handleOpenModal = (integration = null) => {
        lastPayloadHashRef.current = null;
        setEditingIntegration(integration);
        setTestResult(null);
        setCandidatePaths([]);
        setDetectedFields([]);
        setPostmanTab('params');
        setParamList([{ key: '', value: '' }]);
        setAuthData({ type: 'none', token: '', apiKeyName: 'X-API-Key', apiKeyValue: '', username: '', password: '' });
        setBodyType('json');
        setHeaderList(parseHeadersToList(integration?.headers));

        if (integration) {
            setFormData({
                name: integration.name || '',
                integration_type: integration.integration_type || 'polling',
                url: integration.url || '',
                method: integration.method || 'GET',
                headers: '',
                body: integration.body ? (typeof integration.body === 'string' ? integration.body : JSON.stringify(integration.body, null, 2)) : '',
                items_path: integration.items_path || '',
                title_field: integration.title_field || '',
                content_field: integration.content_field || '',
                category: integration.category || 'integração',
                sync_interval_minutes: integration.sync_interval_minutes || 5,
                enabled: integration.enabled ?? true
            });

            if (integration.last_payload) {
                setTestResult({ data: integration.last_payload });
                lastPayloadHashRef.current = JSON.stringify(integration.last_payload);
                analyzeJsonResponse(integration.last_payload);
            }
        } else {
            setFormData({
                name: '',
                integration_type: 'polling',
                url: '',
                method: 'GET',
                headers: '',
                body: '',
                items_path: '',
                title_field: '',
                content_field: '',
                category: 'integração',
                sync_interval_minutes: 5,
                enabled: true
            });
        }
        setIsModalOpen(true);
    };

    const handleTestEndpoint = async () => {
        if (!formData.url) return toast.error('Insira a URL do endpoint.');
        setIsTesting(true);
        setTestResult(null);
        setCandidatePaths([]);
        setDetectedFields([]);

        const parsedHeaders = buildFinalHeaders(headerList, authData);
        const parsedParams = buildParamsObject(paramList);
        const parsedBody = formData.method === 'POST' ? buildFinalBody(bodyType, formData.body, formUrlEncodedList) : null;

        try {
            const res = await api.post('/configs/integrations/test-endpoint', {
                url: formData.url,
                method: formData.method,
                headers: parsedHeaders,
                params: parsedParams,
                body: parsedBody
            });

            setTestResult(res.data);
            toast.success('Endpoint testado com sucesso!');
            analyzeJsonResponse(res.data.data);
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Falha ao testar endpoint.');
        } finally {
            setIsTesting(false);
        }
    };

    const analyzeJsonResponse = (data) => {
        if (!data) return;
        const paths = [];
        const findArrays = (obj, path) => {
            if (Array.isArray(obj)) {
                paths.push({ path: path, count: obj.length });
            } else if (obj && typeof obj === 'object') {
                Object.keys(obj).forEach(key => {
                    const nextPath = path ? `${path}.${key}` : key;
                    findArrays(obj[key], nextPath);
                });
            }
        };

        if (Array.isArray(data)) {
            paths.push({ path: '', count: data.length });
        } else if (typeof data === 'object') {
            findArrays(data, '');
        }

        setCandidatePaths(paths);
        const initialPath = formData.items_path || (paths.length > 0 ? paths[0].path : '');
        extractFieldsFromPath(data, initialPath);
    };

    const extractFieldsFromPath = (data, path) => {
        if (!data) return;
        const allKeys = extractAllJsonFields(data);
        setDetectedFields(allKeys);

        const savedFieldsStr = formData.content_field || editingIntegration?.content_field || '';
        if (savedFieldsStr.trim()) {
            const savedList = savedFieldsStr.split(',').map(s => s.trim()).filter(Boolean);
            setSelectedFields(prev => {
                const combined = new Set([...(prev || []), ...savedList]);
                return Array.from(combined);
            });
        } else {
            setSelectedFields(prev => (prev && prev.length > 0 ? prev : allKeys));
        }
        const items = getExtractedItems(data, path);
        if (items.length > 0) {
            setSelectedItemIndices(items.map((_, i) => i));
        }
    };

    const handleSaveIntegration = async (e) => {
        if (e && e.preventDefault) e.preventDefault();
        if (!selectedConfig?.id) return toast.error('Selecione uma persona.');
        if (!formData.name || !formData.name.trim()) return toast.error('Informe o nome da integração.');
        if (formData.integration_type === 'polling' && (!formData.url || !formData.url.trim())) {
            return toast.error('Informe a URL do endpoint para Polling.');
        }

        const parsedHeaders = buildFinalHeaders(headerList, authData);
        const parsedParams = buildParamsObject(paramList);
        const parsedBody = formData.method === 'POST' ? buildFinalBody(bodyType, formData.body, formUrlEncodedList) : null;

        let finalUrl = formData.url ? formData.url.trim() : null;
        const finalContentField = selectedFields.length > 0 ? selectedFields.join(',') : formData.content_field;

        const payload = {
            config_id: selectedConfig.id,
            name: formData.name.trim(),
            integration_type: formData.integration_type,
            url: finalUrl,
            method: formData.method,
            headers: parsedHeaders,
            body: parsedBody,
            items_path: formData.items_path,
            title_field: formData.title_field,
            content_field: finalContentField,
            category: formData.category ? formData.category.trim() : 'integração',
            sync_interval_minutes: parseInt(formData.sync_interval_minutes) || 5,
            enabled: formData.enabled
        };

        try {
            if (editingIntegration?.id) {
                await api.put(`/configs/integrations/${editingIntegration.id}`, payload);
                toast.success('Integração atualizada com sucesso!');
            } else {
                await api.post(`/configs/${selectedConfig.id}/integrations`, payload);
                toast.success('Integração criada com sucesso!');
            }
            setIsModalOpen(false);
            fetchIntegrations();
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Erro ao salvar integração.');
        }
    };

    const handleDeleteIntegration = async (id) => {
        if (!window.confirm('Tem certeza que deseja excluir esta integração? Todos os vetores associados serão removidos.')) return;
        try {
            await api.delete(`/configs/integrations/${id}`);
            toast.success('Integração excluída com sucesso.');
            fetchIntegrations();
        } catch (err) {
            toast.error('Erro ao excluir integração.');
        }
    };

    const handleSyncNow = async (id) => {
        setIsSyncingId(id);
        try {
            const res = await api.post(`/configs/integrations/${id}/sync`);
            toast.success(res.data.message || 'Sincronização concluída!');
            fetchIntegrations();
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Falha na sincronização.');
        } finally {
            setIsSyncingId(null);
        }
    };

    const copyToClipboard = (text, label) => {
        navigator.clipboard.writeText(text);
        toast.success(`${label} copiado!`);
    };

    const getWebhookPublicUrl = () => {
        let baseUrl = api.defaults.baseURL || import.meta.env.VITE_API_BASE_URL || '/api/v1';
        if (baseUrl.startsWith('/')) {
            baseUrl = window.location.origin + baseUrl;
        }
        baseUrl = baseUrl.replace(/\/+$/, '');
        return `${baseUrl}/integrations/webhook`;
    };
    const webhookPublicUrl = getWebhookPublicUrl();

    return (
        <div className="animate-fade-in space-y-6">
            {/* Lista de Integrações */}
            {isLoading ? (
                <PageLoader fullScreen={false} message="Carregando Integrações" subMessage="Buscando dados..." />
            ) : integrations.length === 0 ? (
                <div className="bg-white p-12 rounded-[2rem] border border-slate-100 shadow-sm text-center space-y-4">
                    <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-500 flex items-center justify-center mx-auto">
                        <LinkIcon size={32} />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800">Nenhuma integração configurada</h3>
                    <p className="text-slate-400 text-xs max-w-md mx-auto">
                        Crie integrações do tipo Polling (verificação automática a cada 5 min) ou Webhook (recebimento em tempo real via Header) para abastecer a base de dados.
                    </p>
                    <button
                        type="button"
                        onClick={() => handleOpenModal(null)}
                        className="inline-flex items-center gap-2 bg-blue-600 text-white font-bold text-xs uppercase tracking-wider py-3 px-6 rounded-xl shadow-md hover:bg-blue-700 transition-all"
                    >
                        <Plus size={16} /> Criar Primeira Integração
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {integrations.map(item => {
                        const isPolling = item.integration_type === 'polling';
                        const isSuccess = item.last_status === 'success';
                        const isError = item.last_status === 'error';

                        return (
                            <div key={item.id} className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between space-y-4">
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className={`px-2.5 py-0.5 rounded-lg text-xs font-semibold ${isPolling ? 'bg-blue-50 text-blue-700 border border-blue-100' : 'bg-purple-50 text-purple-700 border border-purple-100'}`}>
                                            {isPolling ? `Polling (${item.sync_interval_minutes || 5} min)` : 'Webhook'}
                                        </span>

                                        <span className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-xs font-medium ${isSuccess ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : isError ? 'bg-rose-50 text-rose-700 border border-rose-100' : 'bg-slate-100 text-slate-600'}`}>
                                            <div className={`w-1.5 h-1.5 rounded-full ${isSuccess ? 'bg-emerald-500' : isError ? 'bg-rose-500' : 'bg-slate-400'}`}></div>
                                            {isSuccess ? 'Sucesso' : isError ? 'Erro' : 'Pendente'}
                                        </span>
                                    </div>

                                    <div>
                                        <h3 className="text-base font-bold text-slate-800">{item.name}</h3>
                                    </div>

                                    {/* EXIBIÇÃO DA CATEGORIA (SEM URL E SEM TOKEN) */}
                                    <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-200/60 flex items-center justify-between gap-2 text-xs">
                                        <span className="font-medium text-slate-500">Categoria do Banco de Dados:</span>
                                        <span className="font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-100">
                                            {item.category || 'integração'}
                                        </span>
                                    </div>

                                    {item.last_error && (
                                        <div className="p-2.5 bg-rose-50 rounded-xl border border-rose-100 text-xs text-rose-700 font-medium">
                                            {item.last_error}
                                        </div>
                                    )}
                                </div>

                                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-xs text-slate-400 font-medium">
                                    <span>
                                        {item.last_sync_at ? `Última sincronização: ${new Date(item.last_sync_at).toLocaleString()}` : 'Nenhuma execução'}
                                    </span>

                                    <div className="flex items-center gap-1.5">
                                        {isPolling && (
                                            <button
                                                type="button"
                                                disabled={isSyncingId === item.id}
                                                onClick={() => handleSyncNow(item.id)}
                                                className="p-2 rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-100 transition-all font-semibold cursor-pointer"
                                                title="Sincronizar Agora"
                                            >
                                                {isSyncingId === item.id ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => handleOpenModal(item)}
                                            className="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 transition-all font-medium text-xs cursor-pointer"
                                        >
                                            Editar
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleDeleteIntegration(item.id)}
                                            className="p-2 rounded-xl bg-rose-50 text-rose-500 hover:bg-rose-100 transition-all cursor-pointer"
                                            title="Excluir Integração"
                                        >
                                            <Trash2 size={15} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* MODAL DE CRIAÇÃO / EDIÇÃO */}
            {isModalOpen && createPortal(
                <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto custom-scrollbar">
                    <div className="bg-white w-full max-w-3xl rounded-3xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[90vh] animate-fade-in">
                        <div className="p-5 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between gap-4">
                            <div>
                                <h3 className="text-base font-bold text-slate-800">
                                    {editingIntegration ? 'Editar Integração' : 'Nova Integração'}
                                </h3>
                                <p className="text-xs text-slate-500 font-medium">Configure endpoints REST ou webhooks para sincronização de dados.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsModalOpen(false)}
                                className="w-8 h-8 rounded-xl bg-white border border-slate-200 text-slate-400 hover:text-slate-700 flex items-center justify-center transition-all cursor-pointer"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="p-5 space-y-5 overflow-y-auto custom-scrollbar flex-1">
                            {/* FORMSECTION 1: DADOS BÁSICOS DA INTEGRAÇÃO */}
                            <FormSection icon={Database} title="Informações da Integração">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <PFLabel required>Nome da Integração</PFLabel>
                                        <PFInput
                                            value={formData.name}
                                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                            placeholder="Ex: Catálogo de Produtos da Loja"
                                            required
                                        />
                                    </div>

                                    <div>
                                        <PFLabel required>Categoria no Banco de Dados</PFLabel>
                                        <PFInput
                                            value={formData.category}
                                            onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                            placeholder="Ex: produtos, faq, suporte"
                                            required
                                        />
                                    </div>
                                </div>

                                <div>
                                    <PFLabel>Modalidade de Comunicação</PFLabel>
                                    <div className="grid grid-cols-2 gap-3 p-1.5 bg-slate-100/70 rounded-2xl border border-slate-200/60">
                                        <button
                                            type="button"
                                            onClick={() => setFormData({ ...formData, integration_type: 'polling' })}
                                            className={`py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${formData.integration_type === 'polling' ? 'bg-white text-blue-600 shadow-xs border border-slate-200/80' : 'text-slate-500 hover:text-slate-800'}`}
                                        >
                                            <RefreshCw size={14} className={formData.integration_type === 'polling' ? 'text-blue-600' : 'text-slate-400'} />
                                            Polling Periódico
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => setFormData({ ...formData, integration_type: 'webhook' })}
                                            className={`py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${formData.integration_type === 'webhook' ? 'bg-white text-purple-600 shadow-xs border border-slate-200/80' : 'text-slate-500 hover:text-slate-800'}`}
                                        >
                                            <Globe size={14} className={formData.integration_type === 'webhook' ? 'text-purple-600' : 'text-slate-400'} />
                                            Webhook de Entrada
                                        </button>
                                    </div>
                                </div>
                            </FormSection>

                            {/* FORMSECTION 2: CONSOLE HTTP OU WEBHOOK */}
                            {formData.integration_type === 'polling' ? (
                                <FormSection icon={Network} title="Configuração do Endpoint HTTP">
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between">
                                            <PFLabel>Endpoint & Método</PFLabel>
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-medium text-slate-500">Intervalo:</span>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    max="1440"
                                                    value={formData.sync_interval_minutes}
                                                    onChange={(e) => setFormData({ ...formData, sync_interval_minutes: e.target.value })}
                                                    className="w-16 px-2 py-1 text-center font-bold text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 bg-white"
                                                />
                                                <span className="text-xs font-medium text-slate-500">min</span>
                                            </div>
                                        </div>

                                        {/* BARRA UNIFICADA ESTILO POSTMAN */}
                                        <div className="flex items-center bg-slate-900 p-2 rounded-2xl shadow-inner gap-2 border border-slate-800">
                                            <select
                                                value={formData.method}
                                                onChange={(e) => setFormData({ ...formData, method: e.target.value })}
                                                className={`px-3 py-1.5 rounded-xl font-bold text-xs appearance-none cursor-pointer focus:outline-none ${formData.method === 'GET' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'}`}
                                            >
                                                <option value="GET" className="bg-slate-900 text-emerald-400 font-bold">GET</option>
                                                <option value="POST" className="bg-slate-900 text-amber-400 font-bold">POST</option>
                                            </select>

                                            <input
                                                type="url"
                                                value={formData.url}
                                                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                                                placeholder="https://api.suaempresa.com/v1/produtos"
                                                required={formData.integration_type === 'polling'}
                                                className="bg-transparent text-slate-100 placeholder:text-slate-500 font-mono text-xs flex-1 px-2 focus:outline-none"
                                            />

                                            <button
                                                type="button"
                                                disabled={isTesting || !formData.url}
                                                onClick={handleTestEndpoint}
                                                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-all shadow-md flex items-center gap-1.5 shrink-0 disabled:opacity-40 cursor-pointer"
                                            >
                                                {isTesting ? <Loader2 className="animate-spin" size={14} /> : <Zap size={14} className="text-amber-300 fill-amber-300" />}
                                                Testar Endpoint
                                            </button>
                                        </div>

                                        {/* ABAS POSTMAN */}
                                        <div className="border border-slate-200/80 rounded-2xl overflow-hidden bg-white shadow-2xs">
                                            <div className="flex items-center border-b border-slate-100 bg-slate-50/70 px-2 overflow-x-auto custom-scrollbar">
                                                <button
                                                    type="button"
                                                    onClick={() => setPostmanTab('params')}
                                                    className={`px-4 py-2 text-xs font-bold transition-all border-b-2 flex items-center gap-1.5 shrink-0 cursor-pointer ${postmanTab === 'params' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                                                >
                                                    <Sliders size={13} /> Params
                                                    {paramList.filter(p => p.key.trim()).length > 0 && (
                                                        <span className="w-4 h-4 rounded-full bg-blue-100 text-blue-700 text-[10px] flex items-center justify-center font-bold">
                                                            {paramList.filter(p => p.key.trim()).length}
                                                        </span>
                                                    )}
                                                </button>

                                                <button
                                                    type="button"
                                                    onClick={() => setPostmanTab('auth')}
                                                    className={`px-4 py-2 text-xs font-bold transition-all border-b-2 flex items-center gap-1.5 shrink-0 cursor-pointer ${postmanTab === 'auth' ? 'border-purple-600 text-purple-600 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                                                >
                                                    <Shield size={13} /> Authorization
                                                    {authData.type !== 'none' && (
                                                        <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                                                    )}
                                                </button>

                                                <button
                                                    type="button"
                                                    onClick={() => setPostmanTab('headers')}
                                                    className={`px-4 py-2 text-xs font-bold transition-all border-b-2 flex items-center gap-1.5 shrink-0 cursor-pointer ${postmanTab === 'headers' ? 'border-indigo-600 text-indigo-600 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                                                >
                                                    <LinkIcon size={13} /> Headers
                                                    {headerList.filter(h => h.key.trim()).length > 0 && (
                                                        <span className="w-4 h-4 rounded-full bg-indigo-100 text-indigo-700 text-[10px] flex items-center justify-center font-bold">
                                                            {headerList.filter(h => h.key.trim()).length}
                                                        </span>
                                                    )}
                                                </button>

                                                {formData.method === 'POST' && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setPostmanTab('body')}
                                                        className={`px-4 py-2 text-xs font-bold transition-all border-b-2 flex items-center gap-1.5 shrink-0 cursor-pointer ${postmanTab === 'body' ? 'border-amber-600 text-amber-600 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                                                    >
                                                        <FileText size={13} /> Body
                                                        {formData.body?.trim() && (
                                                            <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                                                        )}
                                                    </button>
                                                )}
                                            </div>

                                            <div className="p-4 bg-white min-h-[130px]">
                                                {/* PARAMS */}
                                                {postmanTab === 'params' && (
                                                    <div className="space-y-3">
                                                        <div className="flex items-center justify-between">
                                                            <PFLabel>Query Parameters (URL)</PFLabel>
                                                            <button
                                                                type="button"
                                                                onClick={handleAddParamRow}
                                                                className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1 bg-blue-50 px-2.5 py-1 rounded-xl border border-blue-200/60 cursor-pointer"
                                                            >
                                                                <Plus size={12} /> Adicionar Param
                                                            </button>
                                                        </div>

                                                        <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
                                                            {paramList.map((param, idx) => (
                                                                <div key={idx} className="flex items-center gap-2">
                                                                    <PFInput
                                                                        placeholder="Param Key (ex: limit)"
                                                                        value={param.key}
                                                                        onChange={(e) => handleParamChange(idx, 'key', e.target.value)}
                                                                        className="config-input bg-white font-mono text-xs flex-1 py-1.5"
                                                                    />
                                                                    <span className="text-slate-300 font-bold text-xs">=</span>
                                                                    <PFInput
                                                                        placeholder="Value (ex: 50)"
                                                                        value={param.value}
                                                                        onChange={(e) => handleParamChange(idx, 'value', e.target.value)}
                                                                        className="config-input bg-white font-mono text-xs flex-1 py-1.5"
                                                                    />
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleRemoveParamRow(idx)}
                                                                        className="p-1.5 text-slate-300 hover:text-rose-500 transition-colors cursor-pointer"
                                                                    >
                                                                        <Trash2 size={14} />
                                                                    </button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* AUTH */}
                                                {postmanTab === 'auth' && (
                                                    <div className="space-y-3">
                                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                                            <div className="sm:col-span-1">
                                                                <PFLabel>Tipo de Autenticação</PFLabel>
                                                                <select
                                                                    value={authData.type}
                                                                    onChange={(e) => setAuthData({ ...authData, type: e.target.value })}
                                                                    className="config-input bg-white font-medium text-xs py-2"
                                                                >
                                                                    <option value="none">No Auth</option>
                                                                    <option value="bearer">Bearer Token</option>
                                                                    <option value="apikey">API Key</option>
                                                                    <option value="basic">Basic Auth</option>
                                                                </select>
                                                            </div>

                                                            <div className="sm:col-span-2">
                                                                {authData.type === 'bearer' && (
                                                                    <div>
                                                                        <PFLabel>Token Bearer</PFLabel>
                                                                        <PFInput
                                                                            value={authData.token}
                                                                            onChange={(e) => setAuthData({ ...authData, token: e.target.value })}
                                                                            placeholder="Token de acesso (ex: eyJhbG...)"
                                                                            className="config-input bg-white font-mono text-xs py-2"
                                                                        />
                                                                    </div>
                                                                )}

                                                                {authData.type === 'apikey' && (
                                                                    <div className="grid grid-cols-2 gap-2">
                                                                        <PFInput
                                                                            value={authData.apiKeyName}
                                                                            onChange={(e) => setAuthData({ ...authData, apiKeyName: e.target.value })}
                                                                            placeholder="Nome (ex: X-API-Key)"
                                                                            className="config-input bg-white font-mono text-xs py-2"
                                                                        />
                                                                        <PFInput
                                                                            value={authData.apiKeyValue}
                                                                            onChange={(e) => setAuthData({ ...authData, apiKeyValue: e.target.value })}
                                                                            placeholder="Valor do Token"
                                                                            className="config-input bg-white font-mono text-xs py-2"
                                                                        />
                                                                    </div>
                                                                )}

                                                                {authData.type === 'basic' && (
                                                                    <div className="grid grid-cols-2 gap-2">
                                                                        <PFInput
                                                                            value={authData.username}
                                                                            onChange={(e) => setAuthData({ ...authData, username: e.target.value })}
                                                                            placeholder="Usuário"
                                                                            className="config-input bg-white text-xs py-2"
                                                                        />
                                                                        <input
                                                                            type="password"
                                                                            value={authData.password}
                                                                            onChange={(e) => setAuthData({ ...authData, password: e.target.value })}
                                                                            placeholder="Senha"
                                                                            className="config-input bg-white text-xs py-2"
                                                                        />
                                                                    </div>
                                                                )}

                                                                {authData.type === 'none' && (
                                                                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-slate-400 text-xs font-normal">
                                                                        Nenhum cabeçalho de autorização adicional será anexado.
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* HEADERS */}
                                                {postmanTab === 'headers' && (
                                                    <div className="space-y-3">
                                                        <div className="flex items-center justify-between">
                                                            <PFLabel>Headers HTTP Customizados</PFLabel>
                                                            <button
                                                                type="button"
                                                                onClick={handleAddHeaderRow}
                                                                className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 bg-indigo-50 px-2.5 py-1 rounded-xl border border-indigo-200/60 cursor-pointer"
                                                            >
                                                                <Plus size={12} /> Adicionar Header
                                                            </button>
                                                        </div>

                                                        <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
                                                            {headerList.map((header, idx) => (
                                                                <div key={idx} className="flex items-center gap-2">
                                                                    <PFInput
                                                                        placeholder="Header (ex: Accept)"
                                                                        value={header.key}
                                                                        onChange={(e) => handleHeaderChange(idx, 'key', e.target.value)}
                                                                        className="config-input bg-white font-mono text-xs flex-1 py-1.5"
                                                                    />
                                                                    <span className="text-slate-300 font-bold text-xs">:</span>
                                                                    <PFInput
                                                                        placeholder="Valor (ex: application/json)"
                                                                        value={header.value}
                                                                        onChange={(e) => handleHeaderChange(idx, 'value', e.target.value)}
                                                                        className="config-input bg-white font-mono text-xs flex-1 py-1.5"
                                                                    />
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleRemoveHeaderRow(idx)}
                                                                        className="p-1.5 text-slate-300 hover:text-rose-500 transition-colors cursor-pointer"
                                                                    >
                                                                        <Trash2 size={14} />
                                                                    </button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* BODY */}
                                                {postmanTab === 'body' && formData.method === 'POST' && (
                                                    <div className="space-y-3">
                                                        <div className="flex items-center justify-between">
                                                            <PFLabel>Tipo do Payload</PFLabel>
                                                            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                                                                {['json', 'form', 'text', 'graphql'].map(t => (
                                                                    <button
                                                                        key={t}
                                                                        type="button"
                                                                        onClick={() => setBodyType(t)}
                                                                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${bodyType === t ? 'bg-white text-amber-700 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                                                                    >
                                                                        {t}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>

                                                        {bodyType === 'json' && (
                                                            <textarea
                                                                value={formData.body}
                                                                onChange={(e) => setFormData({ ...formData, body: e.target.value })}
                                                                placeholder={'{\n  "query": "search",\n  "page": 1\n}'}
                                                                rows={4}
                                                                className="config-input bg-slate-900 text-emerald-400 font-mono text-xs p-3 rounded-xl focus:ring-1 focus:ring-emerald-500 border-none"
                                                            />
                                                        )}

                                                        {bodyType === 'graphql' && (
                                                            <textarea
                                                                value={formData.body}
                                                                onChange={(e) => setFormData({ ...formData, body: e.target.value })}
                                                                placeholder={'query {\n  products {\n    id\n    title\n  }\n}'}
                                                                rows={4}
                                                                className="config-input bg-slate-900 text-purple-300 font-mono text-xs p-3 rounded-xl focus:ring-1 focus:ring-purple-500 border-none"
                                                            />
                                                        )}

                                                        {bodyType === 'text' && (
                                                            <textarea
                                                                value={formData.body}
                                                                onChange={(e) => setFormData({ ...formData, body: e.target.value })}
                                                                placeholder="Texto bruto..."
                                                                rows={4}
                                                                className="config-input bg-slate-900 text-slate-200 font-mono text-xs p-3 rounded-xl focus:ring-1 focus:ring-slate-500 border-none"
                                                            />
                                                        )}

                                                        {bodyType === 'form' && (
                                                            <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
                                                                {formUrlEncodedList.map((item, idx) => (
                                                                    <div key={idx} className="flex items-center gap-2">
                                                                        <PFInput
                                                                            placeholder="Key"
                                                                            value={item.key}
                                                                            onChange={(e) => {
                                                                                const copy = [...formUrlEncodedList];
                                                                                copy[idx].key = e.target.value;
                                                                                setFormUrlEncodedList(copy);
                                                                            }}
                                                                            className="config-input bg-white font-mono text-xs flex-1 py-1.5"
                                                                        />
                                                                        <span className="text-slate-300 font-bold text-xs">=</span>
                                                                        <PFInput
                                                                            placeholder="Value"
                                                                            value={item.value}
                                                                            onChange={(e) => {
                                                                                const copy = [...formUrlEncodedList];
                                                                                copy[idx].value = e.target.value;
                                                                                setFormUrlEncodedList(copy);
                                                                            }}
                                                                            className="config-input bg-white font-mono text-xs flex-1 py-1.5"
                                                                        />
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                const copy = formUrlEncodedList.filter((_, i) => i !== idx);
                                                                                setFormUrlEncodedList(copy.length > 0 ? copy : [{ key: '', value: '' }]);
                                                                            }}
                                                                            className="p-1.5 text-slate-300 hover:text-rose-500 transition-colors cursor-pointer"
                                                                        >
                                                                            <Trash2 size={14} />
                                                                        </button>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </FormSection>
                            ) : (
                                <FormSection icon={Shield} title="Configurações do Webhook de Entrada">
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between">
                                            <PFLabel>Status da Conexão Ao Vivo</PFLabel>
                                            <div className="flex items-center gap-2 px-3 py-1 bg-purple-50 rounded-full border border-purple-200">
                                                <span className="relative flex h-2 w-2">
                                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                                </span>
                                                <span className="text-xs font-semibold text-purple-900">
                                                    Escutando ao vivo...
                                                </span>
                                            </div>
                                        </div>

                                        <div>
                                            <PFLabel>URL do Endpoint para envio (HTTP POST)</PFLabel>
                                            <div className="p-2.5 bg-white rounded-xl border border-slate-200 text-xs font-mono text-slate-700 flex items-center justify-between gap-2 shadow-2xs">
                                                <span className="truncate">{webhookPublicUrl}</span>
                                                <button type="button" onClick={() => copyToClipboard(webhookPublicUrl, 'URL')} className="text-purple-600 hover:text-purple-800 font-bold shrink-0 cursor-pointer">
                                                    <Copy size={14} />
                                                </button>
                                            </div>
                                        </div>

                                        {editingIntegration?.webhook_token && (
                                            <div>
                                                <PFLabel>Token de Segurança (Header X-Webhook-Token)</PFLabel>
                                                <div className="p-2.5 bg-purple-50/60 rounded-xl border border-purple-100 text-xs font-mono text-purple-800 flex items-center justify-between gap-2">
                                                    <span className="truncate font-semibold">X-Webhook-Token: {editingIntegration.webhook_token}</span>
                                                    <button type="button" onClick={() => copyToClipboard(editingIntegration.webhook_token, 'Token')} className="text-purple-600 hover:text-purple-800 font-bold shrink-0 cursor-pointer">
                                                        <Copy size={14} />
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </FormSection>
                            )}

                            {/* CARD SIMPLES DA RESPOSTA COM ÁRVORE EXPANSÍVEL DE PASTAS E ARQUIVOS */}
                            {(testResult?.data || detectedFields.length > 0) && (() => {
                                const allJsonFields = detectedFields.length > 0 ? detectedFields : extractAllJsonFields(testResult?.data);

                                return (
                                    <div className="pt-4 border-t border-slate-100 animate-fade-in space-y-3">
                                        <div className="border border-slate-200/80 rounded-2xl bg-white overflow-hidden shadow-2xs">
                                            {/* Cabeçalho Limpo */}
                                            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200/80 flex items-center justify-between gap-3">
                                                <div className="flex items-center gap-2">
                                                    <div className="p-1.5 bg-blue-100/70 text-blue-600 rounded-lg">
                                                        <Folder size={15} />
                                                    </div>
                                                    <span className="text-xs font-bold text-slate-800">
                                                        Resposta Recebida (JSON)
                                                    </span>
                                                </div>

                                                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700 bg-white px-3 py-1 rounded-xl border border-slate-200 shadow-2xs hover:bg-slate-50 transition-all">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedFields.length > 0 && selectedFields.length >= allJsonFields.length}
                                                        onChange={(e) => {
                                                            if (e.target.checked) {
                                                                setSelectedFields([...allJsonFields]);
                                                            } else {
                                                                setSelectedFields([]);
                                                            }
                                                        }}
                                                        className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 border-slate-300 cursor-pointer"
                                                    />
                                                    Selecionar Todos
                                                </label>
                                            </div>

                                            {/* Estrutura Vertical de Pastas e Arquivos (Expansível / Retrátil) */}
                                            <div className="p-3.5 max-h-80 overflow-y-auto custom-scrollbar bg-slate-50/20">
                                                {testResult?.data && typeof testResult.data === 'object' ? (
                                                    Object.keys(testResult.data).map((key) => (
                                                        <JsonTreeItem
                                                            key={key}
                                                            keyName={key}
                                                            value={testResult.data[key]}
                                                            path=""
                                                            selectedFields={selectedFields}
                                                            setSelectedFields={setSelectedFields}
                                                        />
                                                    ))
                                                ) : (
                                                    <div className="p-4 font-mono text-xs text-slate-600">
                                                        {testResult?.data ? String(testResult.data) : 'Nenhum dado recebido ainda.'}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}

                            <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setIsModalOpen(false)}
                                    className="px-6 py-3 rounded-2xl border border-slate-200 text-slate-600 font-bold text-xs hover:bg-slate-50 transition-all"
                                >
                                    Cancelar
                                </button>

                                <button
                                    type="button"
                                    onClick={handleSaveIntegration}
                                    className="px-8 py-3.5 rounded-2xl bg-blue-600 text-white font-black text-xs uppercase tracking-widest shadow-xl shadow-blue-200 hover:bg-blue-700 transition-all flex items-center gap-2 active:scale-95"
                                >
                                    <Save size={16} /> Salvar Integração
                                </button>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}

export default Configs;