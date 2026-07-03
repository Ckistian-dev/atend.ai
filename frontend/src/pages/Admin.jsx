import React, { useState, useEffect, useCallback } from 'react';
import api from '../api/axiosConfig';
import toast from 'react-hot-toast';
import {
    Edit,
    Trash2,
    Loader2,
    UserPlus,
    Save,
    X,
    Building,
    Users,
    Search,
    Plus,
    ShieldAlert,
    Globe,
    Key,
    Smartphone,
    CheckCircle2,
    XCircle,
    Play,
    Square,
    UserCheck,
    User,
    Settings,
    ShieldCheck,
    Mail,
    Lock,
    Shield
} from 'lucide-react';
import PageLoader from '../components/common/PageLoader';

// ─── DESIGN SYSTEM ──────────────────────────────────────────────────────────
const DS_STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=Inter:wght@400;500;600&display=swap');
.admin-page { font-family: 'Inter', sans-serif; }
.admin-page h1, .admin-page h2, .admin-page h3 { font-family: 'Plus Jakarta Sans', sans-serif; }
.admin-modal-overlay { animation: fadeIn 0.2s ease; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
.admin-form-input {
    width: 100%;
    padding: 0.625rem 1rem;
    font-size: 0.875rem;
    border-radius: 0.75rem;
    background: #f8faff;
    border: 1px solid rgba(203,213,225,0.6);
    color: #0f172a;
    outline: none;
    transition: all 0.15s;
}
.admin-form-input:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); background: #fff; }
.ds-surface { background: #ffffff; box-shadow: 0 2px 16px rgba(15,23,42,0.06); border-radius: 1.25rem; }
.ds-card { background: #f8faff; border-radius: 1rem; border: 1px solid rgba(203,213,225,0.4); padding: 1rem; }

.input-icon-wrapper {
    position: relative;
    width: 100%;
}
.input-icon-wrapper input.admin-form-input,
.input-icon-wrapper select.admin-form-input {
    padding-left: 2.5rem !important;
}
.input-icon-wrapper .input-icon-left {
    position: absolute;
    left: 0.875rem;
    top: 50%;
    transform: translateY(-50%);
    color: #94a3b8;
    pointer-events: none;
    display: flex;
    align-items: center;
    justify-content: center;
}
`;

const Modal = ({ onClose, children, maxWidth = "max-w-xl" }) => (
    <div className="fixed inset-0 z-50 flex items-center justify-center admin-modal-overlay" style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(8px)' }} onClick={onClose}>
        <div className={`bg-white w-full ${maxWidth} mx-4 flex flex-col max-h-[90vh] overflow-hidden`} style={{ borderRadius: '1.5rem', boxShadow: '0 24px 80px rgba(15,23,42,0.2)' }} onClick={e => e.stopPropagation()}>
            {children}
        </div>
    </div>
);

// Modal para Criar/Editar Empresa
const CompanyModal = ({ company, onSave, onClose, isCreating = false, allConfigs = [] }) => {
    const [formData, setFormData] = useState({
        name: company?.name || '',
        tokens: company?.tokens || 0,
        wbp_phone_number_id: company?.wbp_phone_number_id || '',
        wbp_business_account_id: company?.wbp_business_account_id || '',
        agent_running: company?.agent_running ?? false,
        followup_active: company?.followup_active ?? false,
        default_persona_id: company?.default_persona_id || '',
    });
    const [isSaving, setIsSaving] = useState(false);

    // Filtra personas que pertencem a essa empresa
    const companyPersonas = allConfigs.filter(cfg => cfg.company_id === company?.id);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };

    const handleTokensChange = (e) => {
        // Remove tudo que não for dígito
        const raw = e.target.value.replace(/\D/g, '');
        setFormData(prev => ({ ...prev, tokens: raw === '' ? '' : parseInt(raw, 10) }));
    };

    const formattedTokens = formData.tokens === '' || formData.tokens === 0
        ? formData.tokens
        : Number(formData.tokens).toLocaleString('pt-BR');

    const handleSave = async () => {
        if (!formData.name) {
            toast.error('O nome da empresa é obrigatório.');
            return;
        }
        setIsSaving(true);
        try {
            const payload = {
                ...formData,
                tokens: parseInt(formData.tokens, 10) || 0,
                default_persona_id: formData.default_persona_id ? parseInt(formData.default_persona_id, 10) : null
            };
            await onSave(company?.id, payload);
            onClose();
        } catch (error) {
            // erro tratado no pai
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Modal onClose={onClose}>
            <div className="flex flex-col h-full admin-page">
                <div className="px-6 py-5" style={{ background: 'linear-gradient(135deg, #0b1c30, #1d4ed8)', borderRadius: '1.5rem 1.5rem 0 0' }}>
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <Building size={20} />
                        {isCreating ? 'Cadastrar Nova Empresa' : 'Editar Empresa'}
                    </h3>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
                    <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Nome da Empresa *</label>
                        <input type="text" name="name" value={formData.name} onChange={handleChange} required className="admin-form-input" placeholder="Minha Empresa S/A" />
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Tokens Disponíveis</label>
                        <input type="text" inputMode="numeric" name="tokens" value={formattedTokens} onChange={handleTokensChange} className="admin-form-input" placeholder="0" />
                    </div>

                    {!isCreating && (
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Persona Padrão</label>
                            {companyPersonas.length === 0 ? (
                                <p className="text-xs text-slate-400 italic px-1 py-2">Nenhuma persona cadastrada para esta empresa.</p>
                            ) : (
                                <select name="default_persona_id" value={formData.default_persona_id} onChange={handleChange} className="admin-form-input">
                                    <option value="">-- Nenhuma --</option>
                                    {companyPersonas.map(p => (
                                        <option key={p.id} value={p.id}>{p.nome_config}</option>
                                    ))}
                                </select>
                            )}
                        </div>
                    )}

                    <div className="pt-2">
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">WhatsApp Business Platform API</label>
                        <div className="space-y-3">
                            <div>
                                <input type="text" name="wbp_phone_number_id" value={formData.wbp_phone_number_id} onChange={handleChange} className="admin-form-input" placeholder="ID do Telefone (ex: 109848572859)" />
                            </div>
                            <div>
                                <input type="text" name="wbp_business_account_id" value={formData.wbp_business_account_id} onChange={handleChange} className="admin-form-input" placeholder="ID da Conta Business (ex: 857364858294)" />
                            </div>
                        </div>
                    </div>



                    <div className="pt-2 space-y-2">
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Status e Modulos</label>

                        {[
                            { name: 'agent_running', label: 'Agente de IA Responde Automaticamente', desc: 'Ativa/Desativa o robô de inteligência artificial' },
                            { name: 'followup_active', label: 'Follow-up Ativo', desc: 'Permite reengajamento automático' },
                        ].map(({ name, label, desc }) => (
                            <div key={name} className="ds-card flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-semibold text-slate-700">{label}</p>
                                    <p className="text-xs text-slate-400 mt-0.5">{desc}</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setFormData(prev => ({ ...prev, [name]: !prev[name] }))}
                                    className="relative w-11 h-6 rounded-full transition-all flex-shrink-0"
                                    style={{
                                        background: formData[name] ? 'linear-gradient(135deg, #3b82f6, #6366f1)' : '#e2e8f0',
                                    }}
                                >
                                    <span className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform" style={{ transform: formData[name] ? 'translateX(20px)' : 'translateX(0)' }} />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="p-5 flex justify-end gap-3" style={{ borderTop: '1px solid rgba(203,213,225,0.4)' }}>
                    <button type="button" onClick={onClose} className="px-5 py-2.5 text-slate-600 text-sm font-semibold rounded-xl hover:bg-slate-100 transition-all">
                        Cancelar
                    </button>
                    <button type="button" onClick={handleSave} disabled={isSaving}
                        className="px-5 py-2.5 text-white text-sm font-semibold rounded-xl flex items-center gap-2 disabled:opacity-60 transition-all shadow-lg shadow-blue-500/25"
                        style={{ background: isSaving ? '#94a3b8' : 'linear-gradient(135deg, #3b82f6, #6366f1)' }}>
                        {isSaving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                        {isSaving ? 'Salvando...' : 'Salvar Empresa'}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

// Modal para Criar/Editar Usuário (Super Admin)
const PRESET_COLORS = [
    '#3b82f6', // Azul
    '#6366f1', // Indigo
    '#8b5cf6', // Violeta
    '#ec4899', // Rosa
    '#f43f5e', // Rose
    '#ef4444', // Vermelho
    '#f97316', // Laranja
    '#f59e0b', // Amber
    '#10b981', // Esmeralda
    '#14b8a6', // Teal
    '#0ea5e9', // Sky
    '#64748b', // Slate
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

const UserModal = ({ user, onSave, onClose, isCreating = false, companies = [] }) => {
    const [activeTab, setActiveTab] = useState('basic'); // 'basic' | 'permissions'
    const [formData, setFormData] = useState({
        email: user?.email || '',
        name: user?.name || '',
        password: '',
        role: user?.role || 'user',
        company_id: user?.company_id || '',
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
        if (!formData.company_id) {
            toast.error('Vincular a uma empresa é obrigatório.');
            return;
        }

        setIsSaving(true);
        try {
            const payload = {
                email: formData.email,
                name: formData.name,
                role: formData.role,
                company_id: parseInt(formData.company_id, 10),
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
        { key: 'dashboard', label: 'Dashboard', desc: 'Acesso às estatísticas e painel principal' },
        { key: 'atendimentos', label: 'Atendimentos', desc: 'Acesso ao chat e controle de contatos' },
        { key: 'mensagens', label: 'Histórico de Mensagens', desc: 'Acesso aos logs de conversas antigas' },
        { key: 'configs', label: 'Persona & IA', desc: 'Configurações de prompts, RAG e chaves' },
        { key: 'disparos', label: 'Disparos em Massa', desc: 'Acesso ao envio de mensagens em lote' },
        { key: 'followup', label: 'Follow-up', desc: 'Configurações de fluxos de reengajamento' },
    ];

    return (
        <Modal onClose={onClose} maxWidth="max-w-2xl">
            <div className="flex flex-col h-full admin-page">
                {/* Header Premium */}
                <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white" style={{ borderRadius: '1.5rem 1.5rem 0 0' }}>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-600/10 flex items-center justify-center text-blue-600">
                            <UserCheck size={20} />
                        </div>
                        <div>
                            <h3 className="text-base font-bold text-slate-800 leading-none">
                                {isCreating ? 'Criar Usuário' : 'Editar Usuário'}
                            </h3>
                            {!isCreating && <p className="text-slate-400 text-xs mt-1.5">{user.name || user.email}</p>}
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-xl transition-all">
                        <X size={18} />
                    </button>
                </div>

                {/* Tab Navigation */}
                <div className="flex px-6 border-b border-slate-100 bg-white shrink-0">
                    <button
                        type="button"
                        onClick={() => setActiveTab('basic')}
                        className={`flex items-center gap-2 px-4 py-3 text-xs font-bold transition-all border-b-2 -mb-[2px] ${activeTab === 'basic' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
                    >
                        <User size={14} />
                        Dados Básicos
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('permissions')}
                        className={`flex items-center gap-2 px-4 py-3 text-xs font-bold transition-all border-b-2 -mb-[2px] ${activeTab === 'permissions' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
                    >
                        <Settings size={14} />
                        Configurações & Permissões
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar bg-slate-50/30">
                    {activeTab === 'basic' && (
                        <div className="space-y-4 animate-fadeIn">
                            {/* Input: Nome */}
                            <div>
                                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 ml-1">Nome do Usuário</label>
                                <div className="input-icon-wrapper">
                                    <input type="text" name="name" value={formData.name} onChange={handleChange} className="admin-form-input" placeholder="Ex: João da Silva" />
                                    <div className="input-icon-left">
                                        <User size={16} />
                                    </div>
                                </div>
                            </div>

                            {/* Input: E-mail */}
                            <div>
                                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 ml-1">E-mail *</label>
                                <div className="input-icon-wrapper">
                                    <input type="email" name="email" value={formData.email} onChange={handleChange} required className="admin-form-input" placeholder="exemplo@empresa.com" />
                                    <div className="input-icon-left">
                                        <Mail size={16} />
                                    </div>
                                </div>
                            </div>

                            {/* Input: Empresa Vinculada */}
                            <div>
                                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 ml-1">Empresa Vinculada *</label>
                                <div className="input-icon-wrapper">
                                    <select name="company_id" value={formData.company_id} onChange={handleChange} className="admin-form-input appearance-none bg-no-repeat bg-right pr-8">
                                        <option value="">-- Selecione uma Empresa --</option>
                                        {companies.map(c => (
                                            <option key={c.id} value={c.id}>{c.name}</option>
                                        ))}
                                    </select>
                                    <div className="input-icon-left">
                                        <Building size={16} />
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {/* Input: Senha */}
                                <div>
                                    <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 ml-1">
                                        {isCreating ? 'Senha *' : 'Nova Senha'}
                                    </label>
                                    <div className="input-icon-wrapper">
                                        <input type="password" name="password" value={formData.password} onChange={handleChange} required={isCreating} className="admin-form-input" placeholder={isCreating ? '••••••••' : 'Manter atual'} />
                                        <div className="input-icon-left">
                                            <Lock size={16} />
                                        </div>
                                    </div>
                                </div>
                                {/* Input: Nível de Acesso */}
                                <div>
                                    <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 ml-1">Nível de Acesso</label>
                                    <div className="input-icon-wrapper">
                                        <select name="role" value={formData.role} onChange={handleChange} className="admin-form-input appearance-none bg-no-repeat bg-right pr-8">
                                            <option value="user">Colaborador / Operador</option>
                                            <option value="admin">Administrador da Empresa</option>
                                        </select>
                                        <div className="input-icon-left">
                                            <Shield size={16} />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'permissions' && (
                        <div className="space-y-5 animate-fadeIn">
                            {/* Avatar & Color Picker */}
                            <div className="p-4 rounded-2xl bg-white border border-slate-100 shadow-sm space-y-3">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Identidade Visual</h4>
                                    {/* Preview Circle */}
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-semibold text-slate-400">Preview:</span>
                                        <div
                                            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-sm transition-all"
                                            style={{ backgroundColor: getUserColor(formData.profile_color, formData.name || formData.email) }}
                                        >
                                            {(formData.name || formData.email || '?')[0].toUpperCase()}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                    {PRESET_COLORS.map(c => (
                                        <button
                                            key={c}
                                            type="button"
                                            onClick={() => setFormData(prev => ({ ...prev, profile_color: c }))}
                                            className="w-6 h-6 rounded-full border transition-all hover:scale-110 flex-shrink-0"
                                            style={{
                                                backgroundColor: c,
                                                borderColor: formData.profile_color === c ? '#0f172a' : 'transparent',
                                                boxShadow: formData.profile_color === c ? '0 0 0 2.5px rgba(15,23,42,0.25)' : 'none',
                                            }}
                                        />
                                    ))}
                                    {/* Custom Color Input */}
                                    <div className="relative w-6 h-6 rounded-full border border-slate-200 overflow-hidden flex items-center justify-center bg-slate-50 hover:bg-slate-100 transition-colors">
                                        <input
                                            type="color"
                                            value={formData.profile_color || '#3b82f6'}
                                            onChange={(e) => setFormData(prev => ({ ...prev, profile_color: e.target.value }))}
                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                        />
                                        <span className="text-[10px] font-bold text-slate-600 pointer-events-none">+</span>
                                    </div>
                                </div>
                            </div>

                            {/* Contact Distribution card */}
                            <div className="p-4 rounded-2xl bg-white border border-slate-100 shadow-sm flex items-center justify-between">
                                <div className="min-w-0 pr-4">
                                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Distribuição de Contatos</h4>
                                    <p className="text-[11px] text-slate-400 leading-normal">
                                        Se ativado, este usuário participará do rodízio igualitário de novos contatos quando passarem para o status "Atendente Chamado".
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setFormData(prev => ({ ...prev, participates_distribution: !prev.participates_distribution }))}
                                    className="relative w-11 h-6 rounded-full transition-all flex-shrink-0"
                                    style={{
                                        background: formData.participates_distribution ? 'linear-gradient(135deg, #10b981, #059669)' : '#cbd5e1',
                                    }}
                                >
                                    <span className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform" style={{ transform: formData.participates_distribution ? 'translateX(20px)' : 'translateX(0)' }} />
                                </button>
                            </div>

                            {/* Module Permissions (if role is user) */}
                            {formData.role === 'user' ? (
                                <div className="space-y-3">
                                    <div className="flex items-center gap-1.5 ml-1">
                                        <ShieldCheck size={14} className="text-blue-500" />
                                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Permissões de Módulos</h4>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        {permLabels.map(({ key, label, desc }) => (
                                            <div key={key} className="flex items-center justify-between p-3 rounded-2xl bg-white border border-slate-100 shadow-sm hover:border-slate-200/80 transition-all">
                                                <div className="min-w-0 pr-3">
                                                    <p className="text-xs font-bold text-slate-700 truncate" title={label}>{label}</p>
                                                    <p className="text-[10px] text-slate-400 truncate mt-0.5" title={desc}>{desc}</p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => handlePermissionToggle(key)}
                                                    className="relative w-9 h-5 rounded-full transition-all flex-shrink-0"
                                                    style={{
                                                        background: permissions[key] ? 'linear-gradient(135deg, #3b82f6, #6366f1)' : '#cbd5e1',
                                                    }}
                                                >
                                                    <span className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform" style={{ transform: permissions[key] ? 'translateX(16px)' : 'translateX(0)' }} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="p-4 rounded-2xl bg-blue-50/50 border border-blue-100 text-blue-800 text-[11px] leading-relaxed flex gap-2">
                                    <Shield size={16} className="text-blue-600 flex-shrink-0 mt-0.5" />
                                    <div>
                                        <span className="font-bold">Nota:</span> Como <span className="font-bold">Administrador</span>, este usuário possui acesso completo e irrestrito a todos os recursos do sistema. As permissões de módulo individuais não se aplicam.
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer buttons */}
                <div className="px-6 py-4 flex justify-end gap-2.5 bg-white border-t border-slate-100">
                    <button type="button" onClick={onClose} className="px-5 py-2.5 text-slate-500 hover:text-slate-700 text-sm font-semibold rounded-xl hover:bg-slate-50 transition-all">
                        Cancelar
                    </button>
                    <button type="button" onClick={handleSave} disabled={isSaving}
                        className="px-5 py-2.5 text-white text-sm font-semibold rounded-xl flex items-center gap-2 disabled:opacity-60 transition-all shadow-lg shadow-blue-500/20"
                        style={{ background: isSaving ? '#94a3b8' : 'linear-gradient(135deg, #3b82f6, #6366f1)' }}>
                        {isSaving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
                        {isSaving ? 'Salvando...' : 'Salvar'}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

function Admin() {
    const [companies, setCompanies] = useState([]);
    const [users, setUsers] = useState([]);
    const [allConfigs, setAllConfigs] = useState([]);
    const [activeTab, setActiveTab] = useState('companies'); // 'companies' | 'users'
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [modalState, setModalState] = useState({ type: null, data: null }); // type: 'create_company', 'edit_company', 'create_user', 'edit_user'

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [companiesRes, usersRes, configsRes] = await Promise.all([
                api.get('/admin/companies'),
                api.get('/admin/users'),
                api.get('/admin/configs')
            ]);
            setCompanies(companiesRes.data);
            setUsers(usersRes.data);
            setAllConfigs(configsRes.data);
        } catch (err) {
            console.error("Erro ao carregar dados do painel:", err);
            toast.error('Erro ao carregar os dados administrativos.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Salvar Empresa
    const handleSaveCompany = async (companyId, companyData) => {
        const isCreating = !companyId;
        const apiCall = isCreating
            ? api.post('/admin/companies', companyData)
            : api.put(`/admin/companies/${companyId}`, companyData);

        try {
            const res = await apiCall;
            if (isCreating) {
                setCompanies(prev => [...prev, res.data]);
                toast.success('Empresa criada com sucesso!');
            } else {
                setCompanies(prev => prev.map(c => c.id === companyId ? res.data : c));
                toast.success('Empresa atualizada com sucesso!');
            }
        } catch (err) {
            const detail = err.response?.data?.detail || 'Erro ao processar requisição.';
            toast.error(detail);
            throw err;
        }
    };

    // Excluir Empresa
    const handleDeleteCompany = async (companyId) => {
        if (window.confirm('Deseja realmente excluir esta empresa? Isso apagará todos os dados, robôs, RAGs e atendimentos associados a ela!')) {
            try {
                await api.delete(`/admin/companies/${companyId}`);
                setCompanies(prev => prev.filter(c => c.id !== companyId));
                toast.success('Empresa excluída com sucesso!');
            } catch (err) {
                const detail = err.response?.data?.detail || 'Erro ao excluir.';
                toast.error(detail);
            }
        }
    };

    // Salvar Usuário
    const handleSaveUser = async (userId, userData) => {
        const isCreating = !userId;
        const apiCall = isCreating
            ? api.post('/admin/users', userData)
            : api.put(`/admin/users/${userId}`, userData);

        try {
            const res = await apiCall;
            if (isCreating) {
                setUsers(prev => [...prev, res.data]);
                toast.success('Usuário criado com sucesso!');
            } else {
                setUsers(prev => prev.map(u => u.id === userId ? res.data : u));
                toast.success('Usuário atualizado com sucesso!');
            }
        } catch (err) {
            const detail = err.response?.data?.detail || 'Erro ao processar requisição.';
            toast.error(detail);
            throw err;
        }
    };

    // Excluir Usuário
    const handleDeleteUser = async (userId) => {
        if (window.confirm('Deseja realmente excluir este usuário?')) {
            try {
                await api.delete(`/admin/users/${userId}`);
                setUsers(prev => prev.filter(u => u.id !== userId));
                toast.success('Usuário excluído com sucesso!');
            } catch (err) {
                const detail = err.response?.data?.detail || 'Erro ao excluir.';
                toast.error(detail);
            }
        }
    };

    const getCompanyName = (companyId) => {
        const comp = companies.find(c => c.id === companyId);
        return comp ? comp.name : `ID: ${companyId}`;
    };

    const getPersonaName = (companyId, personaId) => {
        if (!personaId) return '—';
        const persona = allConfigs.find(p => p.id === personaId && p.company_id === companyId);
        return persona ? persona.nome_config : `ID: ${personaId}`;
    };

    // Filtros
    const filteredCompanies = companies
        .filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()))
        .sort((a, b) => a.id - b.id);

    const filteredUsers = users.filter(u =>
        u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (u.name && u.name.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    if (isLoading) {
        return <PageLoader message="Carregando painel master..." subMessage="Buscando informações corporativas..." />;
    }

    return (
        <div className="admin-page p-6 md:p-8 min-h-full bg-[#f0f4ff]">
            <style>{DS_STYLE}</style>

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
                <div>
                    <h1 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
                        <ShieldAlert className="text-blue-600" size={28} />
                        Painel do Administrador Geral
                    </h1>
                    <p className="text-slate-400 mt-0.5 text-sm font-medium">Controle master de empresas e usuários do sistema</p>
                </div>

                <div className="flex items-center gap-3">
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="Buscar..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="admin-form-input pl-9"
                            style={{ width: '220px', borderRadius: '0.875rem' }}
                        />
                    </div>
                    {activeTab === 'companies' ? (
                        <button
                            onClick={() => setModalState({ type: 'create_company', data: null })}
                            className="flex items-center gap-2 px-4 py-2.5 text-white text-sm font-semibold rounded-xl shadow-lg shadow-blue-500/25 hover:opacity-90 transition-all"
                            style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}
                        >
                            <Building size={16} />
                            Nova Empresa
                        </button>
                    ) : (
                        <button
                            onClick={() => setModalState({ type: 'create_user', data: null })}
                            className="flex items-center gap-2 px-4 py-2.5 text-white text-sm font-semibold rounded-xl shadow-lg shadow-blue-500/25 hover:opacity-90 transition-all"
                            style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}
                        >
                            <UserPlus size={16} />
                            Novo Usuário
                        </button>
                    )}
                </div>
            </div>

            {/* Abas */}
            <div className="flex border-b border-slate-200 mb-6 gap-2">
                <button
                    onClick={() => { setActiveTab('companies'); setSearchTerm(''); }}
                    className={`flex items-center gap-2 px-6 py-3 font-bold text-sm transition-all border-b-2 ${activeTab === 'companies'
                        ? 'border-blue-600 text-blue-600 bg-white rounded-t-xl'
                        : 'border-transparent text-slate-400 hover:text-slate-600'
                        }`}
                >
                    <Building size={18} />
                    Gestão de Empresas
                </button>
                <button
                    onClick={() => { setActiveTab('users'); setSearchTerm(''); }}
                    className={`flex items-center gap-2 px-6 py-3 font-bold text-sm transition-all border-b-2 ${activeTab === 'users'
                        ? 'border-blue-600 text-blue-600 bg-white rounded-t-xl'
                        : 'border-transparent text-slate-400 hover:text-slate-600'
                        }`}
                >
                    <Users size={18} />
                    Gestão de Usuários
                </button>
            </div>

            {/* Aba de Empresas */}
            {activeTab === 'companies' && (
                <div className="ds-surface overflow-hidden">
                    <div className="overflow-x-auto custom-scrollbar">
                        <table className="w-full text-left min-w-[900px]">
                            <thead>
                                <tr style={{ borderBottom: '1px solid rgba(203,213,225,0.4)' }}>
                                    {['Nome da Empresa', 'Tokens', 'Persona Padrão', 'Status', 'WhatsApp API ID', 'Ações'].map((h, i) => (
                                        <th key={i} className="px-5 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest">
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filteredCompanies.map((company, idx) => (
                                    <tr key={company.id} className="transition-colors hover:bg-blue-50/30" style={idx < filteredCompanies.length - 1 ? { borderBottom: '1px solid rgba(203,213,225,0.3)' } : {}}>
                                        <td className="px-5 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold text-white flex-shrink-0" style={{ background: 'linear-gradient(135deg, #0f172a, #1e293b)' }}>
                                                    {company.name[0].toUpperCase()}
                                                </div>
                                                <div>
                                                    <p className="text-sm font-bold text-slate-800">{company.name}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-5 py-4">
                                            <span className="text-sm font-bold text-slate-700">{company.tokens?.toLocaleString('pt-BR') || 0}</span>
                                        </td>
                                        <td className="px-5 py-4 text-sm text-slate-500">
                                            {getPersonaName(company.id, company.default_persona_id)}
                                        </td>
                                        <td className="px-5 py-4">
                                            <div className="flex flex-wrap gap-1">
                                                <StatusPill active={company.agent_running} label="IA" />
                                                <StatusPill active={company.followup_active} label="FU" />
                                            </div>
                                        </td>
                                        <td className="px-5 py-4">
                                            <div className="flex flex-col text-xs text-slate-500">
                                                <span>P: {company.wbp_phone_number_id || '—'}</span>
                                                <span>B: {company.wbp_business_account_id || '—'}</span>
                                            </div>
                                        </td>
                                        <td className="px-5 py-4">
                                            <div className="flex items-center gap-1">
                                                <button onClick={() => setModalState({ type: 'edit_company', data: company })}
                                                    className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all" title="Editar">
                                                    <Edit size={16} />
                                                </button>
                                                <button onClick={() => handleDeleteCompany(company.id)}
                                                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all" title="Excluir">
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {filteredCompanies.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="text-center py-16 text-slate-400 text-sm italic">
                                            Nenhuma empresa encontrada.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Aba de Usuários */}
            {activeTab === 'users' && (
                <div className="ds-surface overflow-hidden">
                    <div className="overflow-x-auto custom-scrollbar">
                        <table className="w-full text-left min-w-[700px]">
                            <thead>
                                <tr style={{ borderBottom: '1px solid rgba(203,213,225,0.4)' }}>
                                    {['Nome', 'E-mail', 'Empresa Vinculada', 'Nível de Acesso', 'Ações'].map((h, i) => (
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
                                                <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0" style={{ backgroundColor: getUserColor(user.profile_color, user.name || user.email) }}>
                                                    {(user.name || user.email)[0].toUpperCase()}
                                                </div>
                                                <span className="text-sm font-bold text-slate-800">{user.name || 'Sem nome'}</span>
                                            </div>
                                        </td>
                                        <td className="px-5 py-4 text-sm text-slate-600">
                                            {user.email}
                                        </td>
                                        <td className="px-5 py-4 text-sm text-slate-600">
                                            {getCompanyName(user.company_id)}
                                        </td>
                                        <td className="px-5 py-4">
                                            <span className={`inline-block text-[10px] font-bold px-2.5 py-1 rounded-full ${user.role === 'admin' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-slate-50 text-slate-600 border border-slate-250'
                                                }`}>
                                                {user.role === 'admin' ? 'Administrador' : 'Colaborador'}
                                            </span>
                                        </td>
                                        <td className="px-5 py-4">
                                            <div className="flex items-center gap-1">
                                                <button onClick={() => setModalState({ type: 'edit_user', data: user })}
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
                                        <td colSpan={4} className="text-center py-16 text-slate-400 text-sm italic">
                                            Nenhum usuário encontrado.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Modais de Empresa */}
            {(modalState.type === 'create_company' || modalState.type === 'edit_company') && (
                <CompanyModal
                    company={modalState.data}
                    onSave={handleSaveCompany}
                    onClose={() => setModalState({ type: null, data: null })}
                    isCreating={modalState.type === 'create_company'}
                    allConfigs={allConfigs}
                />
            )}

            {/* Modais de Usuário */}
            {(modalState.type === 'create_user' || modalState.type === 'edit_user') && (
                <UserModal
                    user={modalState.data}
                    onSave={handleSaveUser}
                    onClose={() => setModalState({ type: null, data: null })}
                    isCreating={modalState.type === 'create_user'}
                    companies={companies}
                />
            )}
        </div>
    );
}

// Subcomponente de status pill (Aesthetics)
const StatusPill = ({ active, label }) => (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border transition-all ${active
        ? 'bg-emerald-50 text-emerald-700 border-emerald-250 shadow-sm shadow-emerald-500/5'
        : 'bg-slate-50 text-slate-400 border-slate-150 opacity-60'
        }`}>
        <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-slate-300'}`} />
        {label}
    </span>
);

export default Admin;