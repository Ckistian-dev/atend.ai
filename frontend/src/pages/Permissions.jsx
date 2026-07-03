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
    Search,
    Shield,
    ShieldCheck,
    Lock,
    Mail,
    UserCheck,
    User,
    Settings
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
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    border-radius: 0.75rem;
    background: #f8faff;
    border: 1px solid rgba(203,213,225,0.6);
    color: #0f172a;
    outline: none;
    transition: all 0.15s;
}
.perm-form-input:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); background: #fff; }
.ds-surface { background: #ffffff; box-shadow: 0 2px 16px rgba(15,23,42,0.06); border-radius: 1.25rem; }
.ds-card { background: #f8faff; border-radius: 1rem; border: 1px solid rgba(203,213,225,0.4); padding: 1rem; }

.input-icon-wrapper {
    position: relative;
    width: 100%;
}
.input-icon-wrapper input.perm-form-input,
.input-icon-wrapper select.perm-form-input {
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

const Modal = ({ onClose, children, maxWidth = "max-w-lg" }) => (
    <div className="fixed inset-0 z-50 flex items-center justify-center perm-modal-overlay" style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(8px)' }} onClick={onClose}>
        <div className={`bg-white w-full ${maxWidth} mx-4 flex flex-col max-h-[90vh] overflow-hidden`} style={{ borderRadius: '1.5rem', boxShadow: '0 24px 80px rgba(15,23,42,0.2)' }} onClick={e => e.stopPropagation()}>
            {children}
        </div>
    </div>
);

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

const UserPermissionModal = ({ user, onSave, onClose, isCreating = false }) => {
    const [activeTab, setActiveTab] = useState('basic'); // 'basic' | 'permissions'
    const [formData, setFormData] = useState({
        email: user?.email || '',
        name: user?.name || '',
        password: '',
        role: user?.role || 'user',
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

        setIsSaving(true);
        try {
            const payload = {
                email: formData.email,
                name: formData.name,
                role: formData.role,
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
            <div className="flex flex-col h-full perm-page">
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
                                    <input type="text" name="name" value={formData.name} onChange={handleChange} className="perm-form-input" placeholder="Ex: João da Silva" />
                                    <div className="input-icon-left">
                                        <User size={16} />
                                    </div>
                                </div>
                            </div>

                            {/* Input: E-mail */}
                            <div>
                                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 ml-1">E-mail *</label>
                                <div className="input-icon-wrapper">
                                    <input type="email" name="email" value={formData.email} onChange={handleChange} required className="perm-form-input" placeholder="exemplo@empresa.com" />
                                    <div className="input-icon-left">
                                        <Mail size={16} />
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
                                        <input type="password" name="password" value={formData.password} onChange={handleChange} required={isCreating} className="perm-form-input" placeholder={isCreating ? '••••••••' : 'Manter atual'} />
                                        <div className="input-icon-left">
                                            <Lock size={16} />
                                        </div>
                                    </div>
                                </div>
                                {/* Input: Nível de Acesso */}
                                <div>
                                    <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 ml-1">Nível de Acesso</label>
                                    <div className="input-icon-wrapper">
                                        <select name="role" value={formData.role} onChange={handleChange} className="perm-form-input appearance-none bg-no-repeat bg-right pr-8">
                                            <option value="user">Colaborador / Operador</option>
                                            <option value="admin">Administrador</option>
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

function Permissions() {
    const [users, setUsers] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [modalState, setModalState] = useState({ type: null, data: null });

    const fetchUsers = useCallback(async () => {
        setIsLoading(true);
        try {
            const response = await api.get('/users/');
            setUsers(response.data);
        } catch (err) {
            console.error("Erro ao buscar usuários:", err);
            toast.error('Erro ao carregar usuários de sua empresa.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);

    const handleSaveUser = async (userId, userData) => {
        const isCreating = !userId;
        const apiCall = isCreating
            ? api.post('/users/', userData)
            : api.put(`/users/${userId}`, userData);

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

    const filteredUsers = users.filter(user =>
        user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (user.name && user.name.toLowerCase().includes(searchTerm.toLowerCase()))
    );

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
                    <p className="text-slate-400 mt-0.5 text-sm font-medium">Controle de permissões e usuários da sua empresa</p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="Buscar por nome ou e-mail..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="perm-form-input pl-9"
                            style={{ width: '240px', borderRadius: '0.875rem' }}
                        />
                    </div>
                    <button
                        onClick={() => setModalState({ type: 'create', data: null })}
                        className="flex items-center gap-2 px-4 py-2.5 text-white text-sm font-semibold rounded-xl shadow-lg shadow-blue-500/25 hover:opacity-90 transition-all"
                        style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}
                    >
                        <UserPlus size={16} />
                        Novo Usuário
                    </button>
                </div>
            </div>

            <div className="ds-surface overflow-hidden">
                <div className="overflow-x-auto custom-scrollbar">
                    <table className="w-full text-left min-w-[800px]">
                        <thead>
                            <tr style={{ borderBottom: '1px solid rgba(203,213,225,0.4)' }}>
                                {['Nome', 'E-mail', 'Nível de Acesso', 'Permissões Ativas', 'Ações'].map((h, i) => (
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
                                        <span className={`inline-block text-[10px] font-bold px-2.5 py-1 rounded-full ${user.role === 'admin' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-slate-50 text-slate-600 border border-slate-200'
                                            }`}>
                                            {user.role === 'admin' ? 'Administrador' : 'Colaborador'}
                                        </span>
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
                                    <td colSpan={3} className="text-center py-16 text-slate-400 text-sm italic">
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
                    onSave={handleSaveUser}
                    onClose={() => setModalState({ type: null, data: null })}
                    isCreating={modalState.type === 'create'}
                />
            )}
        </div>
    );
}

export default Permissions;
