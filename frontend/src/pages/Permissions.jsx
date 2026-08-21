import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../api/axiosConfig';
import toast from 'react-hot-toast';
import {
    Edit,
    Trash2,
    Loader2,
    UserPlus,
    Save,
    X,
    Search,
    Shield,
    ShieldCheck,
    Lock,
    Mail,
    UserCheck,
    User,
    Settings,
    Building2,
    ChevronDown,
    Check,
    Plus,
    Palette
} from 'lucide-react';
import PageLoader from '../components/common/PageLoader';

// ─── DESIGN SYSTEM ──────────────────────────────────────────────────────────
const DS_STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=Inter:wght@400;500;600&display=swap');
.perm-page { font-family: 'Inter', sans-serif; }
.perm-page h1, .perm-page h2, .perm-page h3 { font-family: 'Plus Jakarta Sans', sans-serif; }
.perm-modal-overlay { animation: fadeIn 0.2s ease; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
.perm-form-input {
    width: 100%;
    padding: 0.55rem 0.85rem;
    font-size: 0.875rem;
    border-radius: 0.75rem;
    background: #f8faff;
    border: 1px solid rgba(203,213,225,0.7);
    color: #0f172a;
    outline: none;
    transition: all 0.15s;
}
.perm-form-input:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.12); background: #fff; }
.ds-surface { background: #ffffff; box-shadow: 0 2px 16px rgba(15,23,42,0.06); border-radius: 1.25rem; }
.ds-card { background: #f8faff; border-radius: 1rem; border: 1px solid rgba(203,213,225,0.4); padding: 1rem; }
`;

const isDeptAdmin = (val) => {
    if (!val) return false;
    const v = val.trim().toLowerCase();
    return v === 'admin' || v === 'administrador';
};

const Modal = ({ onClose, children, maxWidth = "max-w-2xl" }) => (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 perm-modal-overlay" style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(8px)' }} onClick={onClose}>
        <div className={`bg-white w-full ${maxWidth} flex flex-col rounded-3xl relative shadow-2xl`} style={{ boxShadow: '0 24px 80px rgba(15,23,42,0.25)' }} onClick={e => e.stopPropagation()}>
            {children}
        </div>
    </div>
);

const PRESET_COLORS = [
    '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
    '#ef4444', '#f97316', '#f59e0b', '#10b981', '#14b8a6',
    '#0ea5e9', '#64748b',
];

const getUserColor = (profileColor, nameOrEmail) => {
    if (profileColor && profileColor.trim() !== '') return profileColor;
    if (!nameOrEmail) return '#3b82f6';
    const colors = [
        '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
        '#ef4444', '#f97316', '#f59e0b', '#10b981', '#14b8a6',
        '#0ea5e9', '#64748b'
    ];
    let hash = 0;
    for (let i = 0; i < nameOrEmail.length; i++) {
        hash = nameOrEmail.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % colors.length;
    return colors[index];
};

// ─── DROPDOWN BONITO DE FUNÇÃO / SETOR ─────────────────────────────────────
const DepartmentDropdown = ({ value, onChange, existingDepartments = [] }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [isCustomMode, setIsCustomMode] = useState(false);
    const [customValue, setCustomValue] = useState('');
    const dropdownRef = useRef(null);

    const standardOptions = ['Admin', 'SAC', 'Vendas', 'Suporte', 'RH', 'Financeiro'];
    const allOptions = Array.from(new Set([...standardOptions, ...existingDepartments.filter(d => !isDeptAdmin(d))]));
    const isCurrentAdmin = isDeptAdmin(value);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setIsOpen(false);
                setIsCustomMode(false);
            }
        };
        if (isOpen) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    const handleSelect = (dept) => {
        onChange(dept);
        setIsOpen(false);
        setIsCustomMode(false);
    };

    const handleCustomSubmit = (e) => {
        if (e) e.preventDefault();
        if (customValue.trim()) {
            onChange(customValue.trim());
            setCustomValue('');
            setIsCustomMode(false);
            setIsOpen(false);
        }
    };

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                type="button"
                onClick={() => setIsOpen(prev => !prev)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border transition-all text-left shadow-sm ${isOpen
                    ? 'border-blue-500 ring-2 ring-blue-500/10 bg-white'
                    : 'border-slate-200/80 hover:border-blue-300 bg-[#f8faff]'
                    }`}
            >
                <div className="flex items-center gap-2.5 min-w-0">
                    {isCurrentAdmin ? (
                        <div className="w-6 h-6 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                            <Shield size={13} />
                        </div>
                    ) : value ? (
                        <div className="w-6 h-6 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                            <Building2 size={13} />
                        </div>
                    ) : (
                        <div className="w-6 h-6 rounded-lg bg-slate-100 text-slate-400 flex items-center justify-center shrink-0">
                            <Building2 size={13} />
                        </div>
                    )}
                    <span className={`text-sm font-semibold truncate ${value ? (isCurrentAdmin ? 'text-indigo-900 font-bold' : 'text-slate-800') : 'text-slate-400'}`}>
                        {isCurrentAdmin ? 'Admin (Administrador)' : (value || 'Selecione uma função ou setor...')}
                    </span>
                </div>
                <ChevronDown size={16} className={`text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180 text-blue-600' : ''}`} />
            </button>

            {isOpen && (
                <div
                    className="absolute top-full left-0 right-0 mt-1.5 bg-white rounded-2xl border border-slate-200/90 p-2 space-y-1 animate-fadeIn max-h-48 overflow-y-auto custom-scrollbar"
                    style={{
                        zIndex: 9999,
                        boxShadow: '0 20px 45px -8px rgba(15,23,42,0.3), 0 0 0 1px rgba(15,23,42,0.06)'
                    }}
                >
                    {/* Admin */}
                    <button
                        type="button"
                        onClick={() => handleSelect('Admin')}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-all ${isCurrentAdmin
                            ? 'bg-indigo-50 text-indigo-700 font-bold'
                            : 'hover:bg-slate-50 text-slate-700 font-medium'
                            }`}
                    >
                        <div className="flex items-center gap-2.5">
                            <div className="w-6 h-6 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                                <Shield size={13} />
                            </div>
                            <div className="text-left">
                                <p className="font-bold text-slate-800 text-xs leading-none">Admin</p>
                                <p className="text-[10px] text-slate-400 font-normal mt-0.5">Acesso total ao sistema e IA</p>
                            </div>
                        </div>
                        {isCurrentAdmin && <Check size={16} className="text-indigo-600 shrink-0" />}
                    </button>

                    <div className="h-px bg-slate-100 my-1" />
                    <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Setores
                    </div>

                    {/* Setores */}
                    {allOptions.filter(d => !isDeptAdmin(d)).map(dept => {
                        const isSelected = !isCurrentAdmin && value?.toLowerCase() === dept.toLowerCase();
                        return (
                            <button
                                key={dept}
                                type="button"
                                onClick={() => handleSelect(dept)}
                                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-all ${isSelected
                                    ? 'bg-blue-50 text-blue-700 font-bold'
                                    : 'hover:bg-slate-50 text-slate-700 font-medium'
                                    }`}
                            >
                                <div className="flex items-center gap-2.5">
                                    <div className="w-6 h-6 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                                        <Building2 size={12} />
                                    </div>
                                    <span>{dept}</span>
                                </div>
                                {isSelected && <Check size={15} className="text-blue-600 shrink-0" />}
                            </button>
                        );
                    })}

                    <div className="h-px bg-slate-100 my-1" />

                    {/* Outro setor */}
                    {!isCustomMode ? (
                        <button
                            type="button"
                            onClick={() => setIsCustomMode(true)}
                            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-blue-600 hover:bg-blue-50 transition-all"
                        >
                            <Plus size={14} />
                            <span>Outro setor / Digitar personalizado...</span>
                        </button>
                    ) : (
                        <div className="p-2 bg-slate-50 rounded-xl space-y-2 border border-slate-100">
                            <input
                                type="text"
                                autoFocus
                                value={customValue}
                                onChange={(e) => setCustomValue(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleCustomSubmit(e); }}
                                placeholder="Digite o nome do setor..."
                                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-white text-slate-800 outline-none focus:border-blue-500"
                            />
                            <div className="flex justify-end gap-1.5">
                                <button
                                    type="button"
                                    onClick={() => setIsCustomMode(false)}
                                    className="px-2.5 py-1 text-[10px] font-semibold text-slate-500 hover:bg-slate-200 rounded-lg transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="button"
                                    onClick={handleCustomSubmit}
                                    className="px-3 py-1 text-[10px] font-bold bg-blue-600 text-white rounded-lg shadow-sm hover:bg-blue-700 transition-colors"
                                >
                                    Adicionar
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const UserPermissionModal = ({ user, onSave, onClose, isCreating = false, existingDepartments = [] }) => {
    const [activeTab, setActiveTab] = useState('basic');
    const initialDept = user ? (user.role === 'admin' ? (user.department || 'Admin') : (user.department || '')) : '';
    const [formData, setFormData] = useState({
        email: user?.email || '',
        name: user?.name || '',
        department: initialDept,
        password: '',
        participates_distribution: user?.participates_distribution || false,
        profile_color: user?.profile_color || '#3b82f6',
    });

    const [permissions, setPermissions] = useState(() => {
        const defaultPerms = {
            dashboard: true,
            atendimentos: true,
            mensagens: true,
            configs: true,
            disparos: true,
            followup: true
        };
        if (user?.permissions) {
            return { ...defaultPerms, ...user.permissions };
        }
        return defaultPerms;
    });

    const [isSaving, setIsSaving] = useState(false);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleDepartmentChange = (newDept) => {
        setFormData(prev => ({ ...prev, department: newDept }));
    };

    const handlePermissionToggle = (key) => {
        setPermissions(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const handleSave = async () => {
        if (!formData.email) {
            toast.error('O e-mail é obrigatório.');
            return;
        }
        if (isCreating && !formData.password) {
            toast.error('A senha é obrigatória para novos usuários.');
            return;
        }

        setIsSaving(true);
        try {
            const isAdmin = isDeptAdmin(formData.department);
            const payload = {
                email: formData.email,
                name: formData.name,
                department: formData.department ? formData.department.trim() : (isAdmin ? 'Admin' : null),
                role: isAdmin ? 'admin' : 'user',
                permissions: permissions,
                participates_distribution: formData.participates_distribution,
                profile_color: formData.profile_color,
            };
            if (formData.password) {
                payload.password = formData.password;
            }
            await onSave(user?.id, payload);
            onClose();
        } catch (error) {
            // erro tratado no pai
        } finally {
            setIsSaving(false);
        }
    };

    const permLabels = [
        { key: 'dashboard', label: 'Dashboard', desc: 'Estatísticas e painel geral' },
        { key: 'atendimentos', label: 'Atendimentos', desc: 'Chat e controle de conversas' },
        { key: 'mensagens', label: 'Histórico de Mensagens', desc: 'Logs de conversas passadas' },
        { key: 'configs', label: 'Persona & IA', desc: 'Configurações de prompts e IA' },
        { key: 'disparos', label: 'Disparos em Massa', desc: 'Envio de mensagens em lote' },
        { key: 'followup', label: 'Follow-up', desc: 'Fluxos automáticos de reengajamento' },
    ];

    const isCurrentAdmin = isDeptAdmin(formData.department);

    return (
        <Modal onClose={onClose} maxWidth="max-w-2xl">
            <div className="flex flex-col h-full perm-page">
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white" style={{ borderRadius: '1.5rem 1.5rem 0 0' }}>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                            <UserCheck size={20} />
                        </div>
                        <div>
                            <h3 className="text-base font-bold text-slate-800 leading-none">
                                {isCreating ? 'Novo Usuário' : 'Editar Usuário'}
                            </h3>
                            {!isCreating && <p className="text-slate-400 text-xs mt-1">{user.name || user.email}</p>}
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-xl transition-all">
                        <X size={18} />
                    </button>
                </div>

                {/* Abas de Navegação */}
                <div className="flex px-6 border-b border-slate-100 bg-white shrink-0">
                    <button
                        type="button"
                        onClick={() => setActiveTab('basic')}
                        className={`flex items-center gap-2 px-4 py-3 text-xs font-bold transition-all border-b-2 -mb-[2px] ${activeTab === 'basic'
                            ? 'border-blue-600 text-blue-600'
                            : 'border-transparent text-slate-400 hover:text-slate-600'
                            }`}
                    >
                        <User size={14} />
                        Dados Básicos
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('permissions')}
                        className={`flex items-center gap-2 px-4 py-3 text-xs font-bold transition-all border-b-2 -mb-[2px] ${activeTab === 'permissions'
                            ? 'border-blue-600 text-blue-600'
                            : 'border-transparent text-slate-400 hover:text-slate-600'
                            }`}
                    >
                        <Settings size={14} />
                        Configurações & Permissões
                    </button>
                </div>

                {/* Content */}
                <div className={`flex-1 p-6 space-y-6 ${activeTab === 'basic' ? 'overflow-visible min-h-[310px] bg-slate-50/40' : 'overflow-y-auto custom-scrollbar bg-slate-50/40'}`}>
                    {/* ABA 1: DADOS BÁSICOS */}
                    {activeTab === 'basic' && (
                        <div className="space-y-4 animate-fadeIn">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 mb-1.5">Nome do Usuário</label>
                                    <input
                                        type="text"
                                        name="name"
                                        value={formData.name}
                                        onChange={handleChange}
                                        className="perm-form-input"
                                        placeholder="Ex: João da Silva"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 mb-1.5">E-mail *</label>
                                    <input
                                        type="email"
                                        name="email"
                                        value={formData.email}
                                        onChange={handleChange}
                                        required
                                        className="perm-form-input"
                                        placeholder="exemplo@empresa.com"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="relative">
                                    <label className="block text-xs font-bold text-slate-600 mb-1.5">
                                        Função / Setor
                                    </label>
                                    <DepartmentDropdown
                                        value={formData.department}
                                        onChange={handleDepartmentChange}
                                        existingDepartments={existingDepartments}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 mb-1.5">
                                        {isCreating ? 'Senha *' : 'Nova Senha'}
                                    </label>
                                    <input
                                        type="password"
                                        name="password"
                                        value={formData.password}
                                        onChange={handleChange}
                                        required={isCreating}
                                        className="perm-form-input"
                                        placeholder={isCreating ? '••••••••' : 'Manter senha atual'}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ABA 2: CONFIGURAÇÕES & PERMISSÕES */}
                    {activeTab === 'permissions' && (
                        <div className="space-y-6 animate-fadeIn">
                            <div className="pt-2">
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                        <ShieldCheck size={16} className="text-blue-600" />
                                        <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                                            Permissões de Módulos
                                        </h4>
                                    </div>
                                    {isCurrentAdmin && (
                                        <span className="text-[11px] font-bold text-indigo-600 bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-100">
                                            Acesso Total (Admin)
                                        </span>
                                    )}
                                </div>

                                {isCurrentAdmin ? (
                                    <div className="p-3.5 rounded-2xl bg-indigo-50/60 border border-indigo-100 text-indigo-900 text-xs flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                                            <Shield size={16} />
                                        </div>
                                        <p className="leading-snug">
                                            <strong>Administrador:</strong> Este usuário tem acesso completo a todos os módulos, atendimentos de todos os setores e configurações gerais.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                        {permLabels.map(({ key, label, desc }) => (
                                            <div
                                                key={key}
                                                onClick={() => handlePermissionToggle(key)}
                                                className="flex items-center justify-between p-3 rounded-2xl bg-white border border-slate-200/70 hover:border-blue-300 shadow-sm cursor-pointer transition-all"
                                            >
                                                <div className="min-w-0 pr-3">
                                                    <p className="text-xs font-bold text-slate-800 truncate">{label}</p>
                                                    <p className="text-[10px] text-slate-400 truncate mt-0.5">{desc}</p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.stopPropagation(); handlePermissionToggle(key); }}
                                                    className="relative w-9 h-5 rounded-full transition-all flex-shrink-0"
                                                    style={{
                                                        background: permissions[key] ? 'linear-gradient(135deg, #3b82f6, #6366f1)' : '#cbd5e1',
                                                    }}
                                                >
                                                    <span
                                                        className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform"
                                                        style={{ transform: permissions[key] ? 'translateX(16px)' : 'translateX(0)' }}
                                                    />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="pt-2 border-t border-slate-200/60 space-y-3">
                                <div className="p-3.5 rounded-2xl bg-white border border-slate-200/70 shadow-sm flex items-center justify-between">
                                    <div className="min-w-0 pr-4">
                                        <h5 className="text-xs font-bold text-slate-700">Rodízio de Contatos</h5>
                                        <p className="text-[11px] text-slate-400 mt-0.5">
                                            Participar da distribuição automática de novos atendimentos transferidos para a equipe.
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setFormData(prev => ({ ...prev, participates_distribution: !prev.participates_distribution }))}
                                        className="relative w-10 h-5 rounded-full transition-all flex-shrink-0"
                                        style={{
                                            background: formData.participates_distribution ? 'linear-gradient(135deg, #10b981, #059669)' : '#cbd5e1',
                                        }}
                                    >
                                        <span
                                            className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform"
                                            style={{ transform: formData.participates_distribution ? 'translateX(20px)' : 'translateX(0)' }}
                                        />
                                    </button>
                                </div>

                                {/* Identidade Visual com Paleta de Cores Completa */}
                                <div className="p-4 rounded-2xl bg-white border border-slate-200/70 shadow-sm space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h5 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                                                <Palette size={15} className="text-blue-600" />
                                                Cor do Perfil
                                            </h5>
                                            <p className="text-[11px] text-slate-400 mt-0.5">Identificação visual do usuário no chat e atendimentos</p>
                                        </div>
                                        {/* Preview com iniciais */}
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] font-bold text-slate-400">Preview:</span>
                                            <div
                                                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black text-white shadow-sm transition-all"
                                                style={{ backgroundColor: getUserColor(formData.profile_color, formData.name || formData.email) }}
                                            >
                                                {(formData.name || formData.email || '?')[0].toUpperCase()}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2 pt-1">
                                        {/* Cores predefinidas */}
                                        {PRESET_COLORS.map(c => (
                                            <button
                                                key={c}
                                                type="button"
                                                onClick={() => setFormData(prev => ({ ...prev, profile_color: c }))}
                                                className="w-6 h-6 rounded-full border transition-all hover:scale-110 flex-shrink-0"
                                                style={{
                                                    backgroundColor: c,
                                                    borderColor: formData.profile_color === c ? '#0f172a' : 'transparent',
                                                    boxShadow: formData.profile_color === c ? '0 0 0 2.5px rgba(15,23,42,0.3)' : 'none',
                                                }}
                                            />
                                        ))}

                                        <div className="h-4 w-px bg-slate-200 mx-1" />

                                        {/* Botão de Paleta de Cores Customizada */}
                                        <label className="relative flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer border border-slate-200/80 transition-colors">
                                            <Palette size={14} className="text-slate-600" />
                                            <span>Paleta</span>
                                            <input
                                                type="color"
                                                value={formData.profile_color || '#3b82f6'}
                                                onChange={(e) => setFormData(prev => ({ ...prev, profile_color: e.target.value }))}
                                                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                                            />
                                        </label>

                                        {/* Input HEX manual */}
                                        <div className="flex items-center gap-1 bg-[#f8faff] border border-slate-200 rounded-lg px-2 py-0.5 text-xs text-slate-600 font-mono">
                                            <span className="text-slate-400">HEX:</span>
                                            <input
                                                type="text"
                                                value={formData.profile_color || '#3b82f6'}
                                                onChange={(e) => setFormData(prev => ({ ...prev, profile_color: e.target.value }))}
                                                className="w-16 bg-transparent outline-none uppercase font-bold text-slate-800"
                                                maxLength={7}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 flex justify-end gap-2.5 bg-white border-t border-slate-100" style={{ borderRadius: '0 0 1.5rem 1.5rem' }}>
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-5 py-2 text-slate-500 hover:text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-50 transition-all"
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={isSaving}
                        className="flex items-center gap-2 px-6 py-2 text-white text-xs font-bold rounded-xl shadow-lg shadow-blue-500/25 hover:opacity-90 transition-all disabled:opacity-50"
                        style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}
                    >
                        {isSaving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
                        {isSaving ? 'Salvando...' : 'Salvar'}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

function Permissions() {
    const [users, setUsers] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [selectedDept, setSelectedDept] = useState('ALL');
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [modalState, setModalState] = useState({ type: null, data: null });

    const fetchUsersAndDepts = useCallback(async () => {
        setIsLoading(true);
        try {
            const [usersRes, deptsRes] = await Promise.all([
                api.get('/users/'),
                api.get('/users/departments').catch(() => ({ data: [] }))
            ]);
            setUsers(usersRes.data);

            // Unir setores da API com setores dos usuários locais
            const deptSet = new Set(deptsRes.data || []);
            usersRes.data.forEach(u => {
                if (u.department && u.department.trim()) {
                    deptSet.add(u.department.trim());
                }
            });
            setDepartments(Array.from(deptSet).sort());
        } catch (err) {
            console.error("Erro ao buscar usuários:", err);
            toast.error('Erro ao carregar usuários de sua empresa.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchUsersAndDepts();
    }, [fetchUsersAndDepts]);

    const handleSaveUser = async (userId, userData) => {
        const isCreating = !userId;
        const apiCall = isCreating
            ? api.post('/users/', userData)
            : api.put(`/users/${userId}`, userData);

        try {
            const res = await apiCall;
            if (isCreating) {
                setUsers(prev => [...prev, res.data]);
                if (res.data.department && !departments.includes(res.data.department)) {
                    setDepartments(prev => [...prev, res.data.department].sort());
                }
                toast.success('Usuário criado com sucesso!');
            } else {
                setUsers(prev => prev.map(u => u.id === userId ? res.data : u));
                if (res.data.department && !departments.includes(res.data.department)) {
                    setDepartments(prev => [...prev, res.data.department].sort());
                }
                toast.success('Usuário atualizado com sucesso!');
            }
        } catch (err) {
            const raw = err.response?.data?.detail;
            const detail = Array.isArray(raw)
                ? raw.map(e => e.msg || JSON.stringify(e)).join('; ')
                : (typeof raw === 'string' ? raw : 'Erro ao processar requisição.');
            toast.error(detail);
            throw err;
        }
    };

    const handleDeleteUser = async (userId) => {
        if (window.confirm('Deseja realmente excluir este usuário?')) {
            try {
                await api.delete(`/users/${userId}`);
                setUsers(prev => prev.filter(u => u.id !== userId));
                toast.success('Usuário excluído com sucesso!');
            } catch (err) {
                const raw = err.response?.data?.detail;
                const detail = Array.isArray(raw)
                    ? raw.map(e => e.msg || JSON.stringify(e)).join('; ')
                    : (typeof raw === 'string' ? raw : 'Erro ao excluir.');
                toast.error(detail);
            }
        }
    };

    const filteredUsers = users.filter(user => {
        const matchesSearch = user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (user.name && user.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
            (user.department && user.department.toLowerCase().includes(searchTerm.toLowerCase())) ||
            (user.role === 'admin' && 'admin'.includes(searchTerm.toLowerCase()));

        if (!matchesSearch) return false;

        if (selectedDept !== 'ALL') {
            if (selectedDept === 'ADMIN') {
                return user.role === 'admin' || isDeptAdmin(user.department);
            }
            if (selectedDept === 'NONE') {
                return (!user.department || user.department.trim() === '') && user.role !== 'admin';
            }
            return user.department?.toLowerCase() === selectedDept.toLowerCase();
        }

        return true;
    });

    if (isLoading) {
        return <PageLoader message="Carregando usuários..." subMessage="Buscando permissões corporativas..." />;
    }

    return (
        <div className="perm-page p-6 md:p-8 min-h-full" style={{ background: '#f0f4ff' }}>
            <style>{DS_STYLE}</style>

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
                <div>
                    <h1 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
                        <ShieldCheck className="text-blue-600" size={28} />
                        Gerenciamento de Acesso
                    </h1>
                    <p className="text-slate-400 mt-0.5 text-sm font-medium">Controle de permissões, setores e usuários da sua empresa</p>
                </div>
                <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                    <div className="relative flex-1 sm:flex-initial">
                        <input
                            type="text"
                            placeholder="Buscar por nome, e-mail ou setor..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="perm-form-input pl-9 text-xs"
                            style={{ width: '300px', height: '40px', borderRadius: '0.875rem' }}
                        />
                    </div>

                    <button
                        onClick={() => setModalState({ type: 'create', data: null })}
                        className="flex items-center gap-2 px-4 py-2.5 text-white text-sm font-semibold rounded-xl shadow-lg shadow-blue-500/25 hover:opacity-90 transition-all shrink-0"
                        style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)', height: '40px' }}
                    >
                        <UserPlus size={16} />
                        Novo Usuário
                    </button>
                </div>
            </div>

            <div className="ds-surface overflow-hidden">
                <div className="overflow-x-auto custom-scrollbar">
                    <table className="w-full text-left min-w-[850px]">
                        <thead>
                            <tr style={{ borderBottom: '1px solid rgba(203,213,225,0.4)' }}>
                                {['Nome', 'E-mail', 'Função / Setor', 'Permissões Ativas', 'Ações'].map((h, i) => (
                                    <th key={i} className="px-5 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest">
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filteredUsers.map((user, idx) => (
                                <tr key={user.id} className="transition-colors hover:bg-blue-50/30" style={idx < filteredUsers.length - 1 ? { borderBottom: '1px solid rgba(203,213,225,0.3)' } : {}}>
                                    <td className="px-5 py-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0" style={{ backgroundColor: getUserColor(user.profile_color, user.name || user.email) }}>
                                                {(user.name || user.email)[0].toUpperCase()}
                                            </div>
                                            <span className="text-sm font-bold text-slate-800">{user.name || 'Sem nome'}</span>
                                        </div>
                                    </td>
                                    <td className="px-5 py-4 text-sm text-slate-600">
                                        {user.email}
                                    </td>
                                    <td className="px-5 py-4">
                                        {user.role === 'admin' || isDeptAdmin(user.department) ? (
                                            <span className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-xl bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-sm">
                                                <Shield size={13} className="text-indigo-600" />
                                                Admin
                                            </span>
                                        ) : user.department ? (
                                            <span className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-xl bg-blue-50 text-blue-700 border border-blue-200/80 shadow-sm">
                                                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                                {user.department}
                                            </span>
                                        ) : (
                                            <span className="text-xs text-slate-400 italic">
                                                Geral
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-5 py-4">
                                        <div className="flex flex-wrap gap-1.5 max-w-[500px]">
                                            {['dashboard', 'atendimentos', 'mensagens', 'configs', 'disparos', 'followup'].map(key => {
                                                const hasPerm = !user.permissions || user.permissions[key] !== false;
                                                return (
                                                    <span key={key} className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${hasPerm ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-600 border border-rose-150 opacity-50'
                                                        }`}>
                                                        {key.toUpperCase()}
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    </td>
                                    <td className="px-5 py-4">
                                        <div className="flex items-center gap-1">
                                            <button onClick={() => setModalState({ type: 'edit', data: user })}
                                                className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all" title="Editar">
                                                <Edit size={16} />
                                            </button>
                                            <button onClick={() => handleDeleteUser(user.id)}
                                                className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all" title="Excluir">
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {filteredUsers.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="text-center py-16 text-slate-400 text-sm italic">
                                        Nenhum usuário encontrado.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {(modalState.type === 'edit' || modalState.type === 'create') && (
                <UserPermissionModal
                    user={modalState.data}
                    existingDepartments={departments}
                    onSave={handleSaveUser}
                    onClose={() => setModalState({ type: null, data: null })}
                    isCreating={modalState.type === 'create'}
                />
            )}
        </div>
    );
}

export default Permissions;
