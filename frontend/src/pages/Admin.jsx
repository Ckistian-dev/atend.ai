import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axiosConfig';
import toast from 'react-hot-toast';
import { Edit, Trash2, Loader2, UserPlus, Save, CheckCircle, XCircle, Settings, MessageSquare, Phone, Clock, Plus, X, Shield, ShieldAlert, Search } from 'lucide-react';

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
    font-family: 'Inter', sans-serif;
}
.admin-form-input:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); background: #fff; }
.admin-form-select { appearance: none; }
.ds-surface { background: #ffffff; box-shadow: 0 2px 16px rgba(15,23,42,0.06); border-radius: 1.25rem; }
.ds-card { background: #f8faff; border-radius: 1rem; border: 1px solid rgba(203,213,225,0.4); padding: 1rem; }
`;

// Modal Genérico
const Modal = ({ onClose, children }) => (
    <div className="fixed inset-0 z-50 flex items-center justify-center admin-modal-overlay" style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(8px)' }} onClick={onClose}>
        <div className="bg-white w-full max-w-2xl mx-4 flex flex-col max-h-[90vh] overflow-hidden" style={{ borderRadius: '1.5rem', boxShadow: '0 24px 80px rgba(15,23,42,0.2)' }} onClick={e => e.stopPropagation()}>
            {children}
        </div>
    </div>
);

// Tab de Navegação
const TabButton = ({ isActive, label, icon: Icon, onClick }) => (
    <button
        type="button"
        onClick={onClick}
        className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-all duration-200 flex-1 justify-center ${
            isActive
                ? 'border-blue-500 text-blue-600 bg-blue-50/60'
                : 'border-transparent text-slate-400 hover:text-slate-700 hover:bg-slate-50'
        }`}
        style={{ fontFamily: 'Inter, sans-serif' }}
    >
        <Icon size={15} />
        <span className="hidden sm:inline">{label}</span>
    </button>
);

// Modal de Edição/Criação de Usuário
const UserModal = ({ user, onSave, onClose, isCreating = false }) => {
    const [activeTab, setActiveTab] = useState('general');
    const [formData, setFormData] = useState({
        email: user?.email || '',
        password: '',
        tokens: user?.tokens ?? 0,
        agent_running: user?.agent_running ?? false,
        atendente_online: user?.atendente_online ?? false,
        followup_active: user?.followup_active ?? false,
        default_persona_id: user?.default_persona_id || '',
        wbp_phone_number_id: user?.wbp_phone_number_id || '',
        wbp_business_account_id: user?.wbp_business_account_id || '',
    });
    
    const [followupConfig, setFollowupConfig] = useState(() => {
        const config = user?.followup_config ? JSON.parse(JSON.stringify(user.followup_config)) : {
            business_hours: { start: "08:00", end: "18:00", days: [1, 2, 3, 4, 5] },
            intervals: []
        };
        if (config.intervals) {
            config.intervals = config.intervals.map(interval => {
                if (interval.hours < 1) {
                    return { value: Math.round(interval.hours * 60), unit: 'minutes' };
                }
                return { value: interval.hours, unit: 'hours' };
            });
        }
        return config;
    });

    const [userPersonas, setUserPersonas] = useState([]);
    const [isSaving, setIsSaving] = useState(false);

    const weekDays = [
        { id: 1, label: 'Seg' }, { id: 2, label: 'Ter' }, { id: 3, label: 'Qua' },
        { id: 4, label: 'Qui' }, { id: 5, label: 'Sex' }, { id: 6, label: 'Sáb' }, { id: 0, label: 'Dom' }
    ];

    useEffect(() => {
        const fetchPersonas = async () => {
            if (user?.id && !isCreating) {
                try {
                    const response = await api.get(`/admin/users/${user.id}/configs`);
                    setUserPersonas(response.data);
                } catch (error) {
                    console.error("Erro ao buscar personas do usuário:", error);
                }
            }
        };
        fetchPersonas();
    }, [user, isCreating]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };

    const handleDayToggle = (dayId) => {
        const currentDays = followupConfig.business_hours?.days || [];
        const newDays = currentDays.includes(dayId)
            ? currentDays.filter(d => d !== dayId)
            : [...currentDays, dayId];
        setFollowupConfig(prev => ({ ...prev, business_hours: { ...prev.business_hours, days: newDays.sort() } }));
    };

    const handleTimeChange = (field, value) => {
        setFollowupConfig(prev => ({ ...prev, business_hours: { ...prev.business_hours, [field]: value } }));
    };

    const handleIntervalChange = (index, field, value) => {
        const newIntervals = [...(followupConfig.intervals || [])];
        const updatedInterval = { ...newIntervals[index] };
        if (field === 'value') {
            let numValue = parseInt(value, 10);
            if (isNaN(numValue) || numValue < 1) numValue = 1;
            if (updatedInterval.unit === 'hours' && numValue > 168) numValue = 168;
            if (updatedInterval.unit === 'minutes' && numValue > 1440) numValue = 1440;
            updatedInterval.value = numValue;
        } else if (field === 'unit') {
            updatedInterval.unit = value;
            updatedInterval.value = value === 'minutes' ? 30 : 1;
        }
        newIntervals[index] = updatedInterval;
        setFollowupConfig(prev => ({ ...prev, intervals: newIntervals }));
    };

    const addInterval = () => setFollowupConfig(prev => ({ ...prev, intervals: [...(prev.intervals || []), { value: 24, unit: 'hours' }] }));
    const removeInterval = (index) => setFollowupConfig(prev => ({ ...prev, intervals: prev.intervals.filter((_, i) => i !== index) }));

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const payload = { ...formData, tokens: parseInt(formData.tokens, 10) || 0 };
            payload.default_persona_id = formData.default_persona_id ? parseInt(formData.default_persona_id, 10) : null;
            const configToSave = {
                ...followupConfig,
                intervals: (followupConfig.intervals || []).map(interval => {
                    let hoursValue = interval.value;
                    if (interval.unit === 'minutes') hoursValue = interval.value / 60;
                    return { hours: hoursValue };
                })
            };
            payload.followup_config = configToSave;
            if (!isCreating && !payload.password) { delete payload.password; }
            await onSave(user?.id, payload);
            onClose();
        } catch (error) {
            // erro tratado no onSave
        } finally {
            setIsSaving(false);
        }
    };

    const toggleStyle = (checked) => ({
        background: checked ? 'linear-gradient(135deg, #3b82f6, #6366f1)' : '#e2e8f0',
    });

    return (
        <Modal onClose={onClose}>
            <div className="flex flex-col h-full admin-page">
                <div className="px-6 py-5" style={{ background: 'linear-gradient(135deg, #0b1c30, #1d4ed8)', borderRadius: '1.5rem 1.5rem 0 0' }}>
                    <h3 className="text-lg font-bold text-white" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                        {isCreating ? 'Criar Novo Usuário' : 'Editar Usuário'}
                    </h3>
                    {!isCreating && <p className="text-blue-200 text-xs mt-0.5">{user.email}</p>}
                </div>
                
                {/* Tabs */}
                <div className="flex border-b border-slate-100">
                    <TabButton isActive={activeTab === 'general'} onClick={() => setActiveTab('general')} label="Geral" icon={Settings} />
                    <TabButton isActive={activeTab === 'status'} onClick={() => setActiveTab('status')} label="Status" icon={CheckCircle} />
                    <TabButton isActive={activeTab === 'wbp'} onClick={() => setActiveTab('wbp')} label="WhatsApp API" icon={Phone} />
                    <TabButton isActive={activeTab === 'followup'} onClick={() => setActiveTab('followup')} label="Follow-up" icon={Clock} />
                </div>

                <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                    {/* TAB: GERAL */}
                    {activeTab === 'general' && (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Email *</label>
                                <input type="email" name="email" value={formData.email} onChange={handleChange} required className="admin-form-input" />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                                    {isCreating ? 'Senha *' : 'Nova Senha (opcional)'}
                                </label>
                                <input type="password" name="password" value={formData.password} onChange={handleChange} required={isCreating} placeholder={isCreating ? "Defina uma senha" : "Deixe em branco para manter a atual"} className="admin-form-input" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Tokens</label>
                                    <input type="number" name="tokens" value={formData.tokens} onChange={handleChange} className="admin-form-input" />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Persona Padrão</label>
                                    <select name="default_persona_id" value={formData.default_persona_id} onChange={handleChange} className="admin-form-input admin-form-select" disabled={isCreating}>
                                        <option value="">-- Nenhuma --</option>
                                        {userPersonas.map(p => <option key={p.id} value={p.id}>{p.nome_config}</option>)}
                                    </select>
                                    {isCreating && <p className="text-xs text-slate-400 mt-1">Salve o usuário antes de definir uma persona.</p>}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* TAB: STATUS */}
                    {activeTab === 'status' && (
                        <div className="space-y-3">
                            {[
                                { name: 'agent_running', label: 'Agente de IA Ativo', desc: 'Se desmarcado, a IA não responderá automaticamente.' },
                                { name: 'atendente_online', label: 'Atendente Online', desc: 'Indica se há um humano disponível para transbordo.' },
                                { name: 'followup_active', label: 'Follow-up Ativo', desc: 'Habilita o envio de mensagens de reengajamento.' },
                            ].map(({ name, label, desc }) => (
                                <div key={name} className="ds-card flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-semibold text-slate-700" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>{label}</p>
                                        <p className="text-xs text-slate-400 mt-0.5">{desc}</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setFormData(prev => ({ ...prev, [name]: !prev[name] }))}
                                        className="relative w-11 h-6 rounded-full transition-all flex-shrink-0"
                                        style={toggleStyle(formData[name])}
                                    >
                                        <span className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform" style={{ transform: formData[name] ? 'translateX(20px)' : 'translateX(0)' }} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* TAB: WBP */}
                    {activeTab === 'wbp' && (
                        <div className="space-y-4">
                            <div className="p-4 rounded-xl text-sm text-blue-700" style={{ background: 'rgba(219,234,254,0.5)', border: '1px solid rgba(147,197,253,0.4)' }}>
                                Credenciais da API do WhatsApp Business (Meta). Configure os IDs corretos para que o agente funcione corretamente.
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">ID do Número de Telefone (WBP)</label>
                                <input type="text" name="wbp_phone_number_id" value={formData.wbp_phone_number_id} onChange={handleChange} className="admin-form-input" />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">ID da Conta Business (WBP)</label>
                                <input type="text" name="wbp_business_account_id" value={formData.wbp_business_account_id} onChange={handleChange} className="admin-form-input" />
                            </div>
                        </div>
                    )}

                    {/* TAB: FOLLOW-UP */}
                    {activeTab === 'followup' && (
                        <div className="space-y-4">
                            <div className="ds-card">
                                <h4 className="text-sm font-bold text-slate-700 mb-3" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Horário de Envio</h4>
                                <div className="flex flex-wrap gap-2 mb-4">
                                    {weekDays.map(day => (
                                        <button key={day.id} type="button" onClick={() => handleDayToggle(day.id)}
                                            className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-all ${
                                                followupConfig.business_hours?.days?.includes(day.id)
                                                    ? 'text-white shadow-md shadow-blue-500/20'
                                                    : 'bg-white text-slate-500 hover:bg-slate-100'
                                            }`}
                                            style={followupConfig.business_hours?.days?.includes(day.id) ? { background: 'linear-gradient(135deg, #3b82f6, #6366f1)', border: 'none' } : { border: '1px solid rgba(203,213,225,0.5)' }}
                                        >
                                            {day.label}
                                        </button>
                                    ))}
                                </div>
                                <div className="flex items-center gap-3">
                                    <input type="time" value={followupConfig.business_hours?.start || "08:00"} onChange={e => handleTimeChange('start', e.target.value)} className="admin-form-input" style={{ width: 'auto' }} />
                                    <span className="text-slate-400 text-sm">até</span>
                                    <input type="time" value={followupConfig.business_hours?.end || "18:00"} onChange={e => handleTimeChange('end', e.target.value)} className="admin-form-input" style={{ width: 'auto' }} />
                                </div>
                            </div>

                            <div className="ds-card">
                                <div className="flex justify-between items-center mb-3">
                                    <h4 className="text-sm font-bold text-slate-700" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Intervalos</h4>
                                    <button type="button" onClick={addInterval} className="text-xs flex items-center gap-1 text-blue-600 hover:text-blue-800 font-semibold">
                                        <Plus size={13} /> Adicionar
                                    </button>
                                </div>
                                <div className="space-y-2">
                                    {(followupConfig.intervals || []).map((interval, index) => (
                                        <div key={index} className="flex items-center gap-2">
                                            <span className="text-sm text-slate-500 w-12">Após</span>
                                            <input type="number" min="1" max={interval.unit === 'hours' ? 168 : 1440} value={interval.value}
                                                onChange={e => handleIntervalChange(index, 'value', e.target.value)}
                                                className="admin-form-input w-20" />
                                            <select value={interval.unit} onChange={e => handleIntervalChange(index, 'unit', e.target.value)} className="admin-form-input admin-form-select" style={{ width: 'auto' }}>
                                                <option value="minutes">minuto(s)</option>
                                                <option value="hours">hora(s)</option>
                                            </select>
                                            <button type="button" onClick={() => removeInterval(index)} className="ml-auto text-red-400 hover:text-red-600 p-1 transition-colors">
                                                <X size={14} />
                                            </button>
                                        </div>
                                    ))}
                                    {(!followupConfig.intervals || followupConfig.intervals.length === 0) && (
                                        <p className="text-xs text-slate-400 italic">Nenhum intervalo definido.</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-5 flex justify-end gap-3" style={{ borderTop: '1px solid rgba(203,213,225,0.4)' }}>
                    <button type="button" onClick={onClose} className="px-5 py-2.5 text-slate-600 text-sm font-semibold rounded-xl hover:bg-slate-100 transition-all">
                        Cancelar
                    </button>
                    <button type="button" onClick={handleSave} disabled={isSaving}
                        className="px-5 py-2.5 text-white text-sm font-semibold rounded-xl flex items-center gap-2 disabled:opacity-60 transition-all shadow-lg shadow-blue-500/25"
                        style={{ background: isSaving ? '#94a3b8' : 'linear-gradient(135deg, #3b82f6, #6366f1)' }}>
                        {isSaving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                        {isSaving ? 'Salvando...' : 'Salvar Alterações'}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

function Admin() {
    const [users, setUsers] = useState([]);
    const [allPersonas, setAllPersonas] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [modalState, setModalState] = useState({ type: null, data: null });
    const [searchTerm, setSearchTerm] = useState('');
    const navigate = useNavigate();

    const fetchUsers = useCallback(async () => {
        setIsLoading(true);
        try {
            const [usersRes, personasRes] = await Promise.all([
                api.get('/admin/users'),
                api.get('/admin/configs')
            ]);
            setUsers(usersRes.data);
            setAllPersonas(personasRes.data);
            setError('');
        } catch (err) {
            console.error("Erro ao carregar usuários:", err);
            setError('Falha ao carregar usuários. Você pode não ter privilégios de administrador.');
            toast.error('Falha ao carregar usuários.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => { fetchUsers(); }, [fetchUsers]);

    const handleSaveUser = async (userId, userData) => {
        const isCreating = !userId;
        const apiCall = isCreating ? api.post('/admin/users', userData) : api.put(`/admin/users/${userId}`, userData);
        const successMsg = isCreating ? 'Usuário criado com sucesso!' : 'Usuário atualizado com sucesso!';
        const errorMsg = isCreating ? 'Falha ao criar usuário.' : 'Falha ao atualizar usuário.';
        try {
            const response = await apiCall;
            if (isCreating) {
                setUsers(prev => [...prev, response.data].sort((a, b) => a.id - b.id));
            } else {
                setUsers(prev => prev.map(u => u.id === userId ? response.data : u));
            }
            toast.success(successMsg);
        } catch (err) {
            const detail = err.response?.data?.detail || 'Verifique os campos e tente novamente.';
            toast.error(`${errorMsg} ${detail}`);
            throw err;
        }
    };

    const handleDeleteUser = async (userId) => {
        if (window.confirm('Tem certeza que deseja apagar este usuário? Esta ação não pode ser desfeita.')) {
            try {
                await api.delete(`/admin/users/${userId}`);
                setUsers(prev => prev.filter(u => u.id !== userId));
                toast.success('Usuário apagado com sucesso!');
            } catch (err) {
                const detail = err.response?.data?.detail || '';
                toast.error(`Falha ao apagar usuário. ${detail}`);
            }
        }
    };

    const getPersonaName = (personaId) => {
        if (!personaId) return '—';
        const persona = allPersonas.find(p => p.id === personaId);
        return persona ? persona.nome_config : `ID: ${personaId}`;
    };

    const filteredUsers = users.filter(user =>
        user.email.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (isLoading) {
        return (
            <div className="flex h-full items-center justify-center" style={{ background: '#f0f4ff' }}>
                <div className="flex flex-col items-center gap-3">
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0b1c30, #1d4ed8)', boxShadow: '0 8px 24px rgba(29,78,216,0.3)' }}>
                        <Loader2 size={28} className="text-white animate-spin" />
                    </div>
                    <p className="text-slate-400 text-sm">Carregando painel...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-10 m-10 text-center rounded-2xl" style={{ background: 'rgba(254,226,226,0.5)', border: '1px solid rgba(252,165,165,0.4)' }}>
                <p className="text-red-700 font-semibold">{error}</p>
            </div>
        );
    }

    return (
        <div className="admin-page p-6 md:p-8 min-h-full" style={{ background: '#f0f4ff' }}>
            <style>{DS_STYLE}</style>
            
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
                <div>
                    <h1 className="text-2xl font-black text-slate-800 tracking-tight">Painel do Administrador</h1>
                    <p className="text-slate-400 mt-0.5 text-sm">Gerenciamento de usuários do sistema</p>
                </div>
                <div className="flex items-center gap-3">
                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input
                            type="text"
                            placeholder="Pesquisar por email..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="admin-form-input pl-9"
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

            {/* Table */}
            <div className="ds-surface overflow-hidden">
                <div className="overflow-x-auto custom-scrollbar">
                    <table className="w-full text-left min-w-[1000px]">
                        <thead>
                            <tr style={{ borderBottom: '1px solid rgba(203,213,225,0.4)' }}>
                                {['Email', 'Tokens', 'Persona Padrão', 'Status', 'WBP (Phone / Biz)', 'Ações'].map((h, i) => (
                                    <th key={i} className="px-5 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest">
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filteredUsers.map((user, rowIdx) => (
                                <tr key={user.id} className="transition-colors hover:bg-blue-50/30" style={rowIdx < filteredUsers.length - 1 ? { borderBottom: '1px solid rgba(203,213,225,0.3)' } : {}}>
                                    <td className="px-5 py-4">
                                        <div className="flex items-center gap-2">
                                            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0" style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}>
                                                {user.email[0].toUpperCase()}
                                            </div>
                                            <div>
                                                <p className="text-sm font-semibold text-slate-800 flex items-center gap-1">
                                                    {user.email}
                                                    {user.is_superuser && <Shield size={12} className="text-violet-500" title="Superusuário" />}
                                                </p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-5 py-4">
                                        <span className="text-sm font-semibold text-slate-700">{user.tokens.toLocaleString('pt-BR')}</span>
                                    </td>
                                    <td className="px-5 py-4">
                                        <span className="text-sm text-slate-500">{getPersonaName(user.default_persona_id)}</span>
                                    </td>
                                    <td className="px-5 py-4">
                                        <div className="flex items-center gap-2">
                                            <StatusPill active={user.agent_running} label="IA" />
                                            <StatusPill active={user.atendente_online} label="Aten." />
                                            <StatusPill active={user.followup_active} label="FU" />
                                        </div>
                                    </td>
                                    <td className="px-5 py-4 text-sm">
                                        <div className="flex flex-col gap-0.5 max-w-[160px]">
                                            <span className="truncate text-xs text-slate-500" title={`Phone ID: ${user.wbp_phone_number_id}`}>P: {user.wbp_phone_number_id || '—'}</span>
                                            <span className="truncate text-xs text-slate-400" title={`Biz ID: ${user.wbp_business_account_id}`}>B: {user.wbp_business_account_id || '—'}</span>
                                        </div>
                                    </td>
                                    <td className="px-5 py-4">
                                        <div className="flex items-center gap-1">
                                            <button onClick={() => setModalState({ type: 'edit', data: user })}
                                                className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all" title="Editar">
                                                <Edit size={16} />
                                            </button>
                                            <button onClick={() => handleDeleteUser(user.id)}
                                                className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all" title="Apagar">
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {filteredUsers.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="text-center py-16 text-slate-400 text-sm">
                                        {searchTerm ? 'Nenhum usuário encontrado para essa busca.' : 'Nenhum usuário cadastrado.'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {(modalState.type === 'edit' || modalState.type === 'create') && (
                <UserModal
                    user={modalState.data}
                    onSave={handleSaveUser}
                    onClose={() => setModalState({ type: null, data: null })}
                    isCreating={modalState.type === 'create'}
                />
            )}
        </div>
    );
}

// Status pill sub-component
const StatusPill = ({ active, label }) => (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
        active ? 'text-emerald-700' : 'text-slate-400'
    }`} style={{ background: active ? 'rgba(16,185,129,0.1)' : 'rgba(148,163,184,0.1)' }}>
        <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-slate-300'}`} />
        {label}
    </span>
);

export default Admin;