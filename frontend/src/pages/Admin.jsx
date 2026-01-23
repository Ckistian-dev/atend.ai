import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axiosConfig';
import toast from 'react-hot-toast';
import { Edit, Trash2, Loader2, UserPlus, Save, CheckCircle, XCircle, Settings, MessageSquare, Phone, Clock, Plus, X, Shield, ShieldAlert, Search } from 'lucide-react';

// Modal Genérico
const Modal = ({ onClose, children }) => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm animate-fade-in-up-fast" onClick={onClose}>
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 animate-fade-in-up flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
            {children}
        </div>
    </div>
);

// Modal de Edição/Criação de Usuário
const UserModal = ({ user, onSave, onClose, isCreating = false }) => {
    const [activeTab, setActiveTab] = useState('general'); // general, status, wbp, followup
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
    
    // Estado estruturado para Follow-up
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
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    // Handlers para Follow-up
    const handleDayToggle = (dayId) => {
        const currentDays = followupConfig.business_hours?.days || [];
        const newDays = currentDays.includes(dayId)
            ? currentDays.filter(d => d !== dayId)
            : [...currentDays, dayId];
        setFollowupConfig(prev => ({
            ...prev,
            business_hours: { ...prev.business_hours, days: newDays.sort() }
        }));
    };

    const handleTimeChange = (field, value) => {
        setFollowupConfig(prev => ({
            ...prev,
            business_hours: { ...prev.business_hours, [field]: value }
        }));
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

            // Trata campos que podem ser nulos
            payload.default_persona_id = formData.default_persona_id ? parseInt(formData.default_persona_id, 10) : null;
            
            // Anexa a configuração de follow-up estruturada
            const configToSave = {
                ...followupConfig,
                intervals: (followupConfig.intervals || []).map(interval => {
                    let hoursValue = interval.value;
                    if (interval.unit === 'minutes') hoursValue = interval.value / 60;
                    return { hours: hoursValue };
                })
            };
            payload.followup_config = configToSave;

            if (!isCreating && !payload.password) {
                delete payload.password; // Não envia senha em branco na atualização
            }
            await onSave(user?.id, payload);
            onClose();
        } catch (error) {
            // O erro já é tratado na função onSave, que mantém o modal aberto
        } finally {
            setIsSaving(false);
        }
    };

    const TabButton = ({ id, label, icon: Icon }) => (
        <button
            type="button"
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors flex-1 justify-center ${
                activeTab === id
                    ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
        >
            <Icon size={16} />
            <span className="hidden sm:inline">{label}</span>
        </button>
    );

    return (
        <Modal onClose={onClose}>
            <div className="flex flex-col h-full">
                <div className="p-6 border-b border-gray-200">
                    <h3 className="text-xl font-bold text-gray-900">{isCreating ? 'Criar Novo Usuário' : `Editar Usuário`}</h3>
                    {!isCreating && <p className="text-sm text-gray-500 mt-1">{user.email}</p>}
                </div>
                
                {/* Tabs */}
                <div className="flex border-b border-gray-200">
                    <TabButton id="general" label="Geral" icon={Settings} />
                    <TabButton id="status" label="Status" icon={CheckCircle} />
                    <TabButton id="wbp" label="WhatsApp API" icon={Phone} />
                    <TabButton id="followup" label="Follow-up" icon={Clock} />
                </div>

                <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                    {/* TAB: GERAL */}
                    {activeTab === 'general' && (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Email*</label>
                                <input type="email" name="email" value={formData.email} onChange={handleChange} required className="block w-full px-4 py-2.5 text-sm rounded-lg border border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {isCreating ? 'Senha*' : 'Nova Senha (opcional)'}
                                </label>
                                <input type="password" name="password" value={formData.password} onChange={handleChange} required={isCreating} placeholder={isCreating ? "Defina uma senha" : "Deixe em branco para manter a atual"} className="block w-full px-4 py-2.5 text-sm rounded-lg border border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Tokens</label>
                                    <input type="number" name="tokens" value={formData.tokens} onChange={handleChange} className="block w-full px-4 py-2.5 text-sm rounded-lg border border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Persona Padrão</label>
                                    <select
                                        name="default_persona_id"
                                        value={formData.default_persona_id}
                                        onChange={handleChange}
                                        className="block w-full px-4 py-2.5 text-sm rounded-lg border border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                                        disabled={isCreating}
                                    >
                                        <option value="">-- Nenhuma --</option>
                                        {userPersonas.map(p => <option key={p.id} value={p.id}>{p.nome_config}</option>)}
                                    </select>
                                    {isCreating && <p className="text-xs text-gray-500 mt-1">Salve o usuário antes de definir uma persona.</p>}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* TAB: STATUS */}
                    {activeTab === 'status' && (
                        <div className="space-y-6">
                            <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                                <label className="flex items-center gap-3 cursor-pointer">
                                    <input type="checkbox" name="agent_running" checked={formData.agent_running} onChange={handleChange} className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                                    <div>
                                        <span className="block text-sm font-bold text-gray-800">Agente de IA Ativo</span>
                                        <span className="text-xs text-gray-500">Se desmarcado, a IA não responderá automaticamente.</span>
                                    </div>
                                </label>
                            </div>
                            <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                                <label className="flex items-center gap-3 cursor-pointer">
                                    <input type="checkbox" name="atendente_online" checked={formData.atendente_online} onChange={handleChange} className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                                    <div>
                                        <span className="block text-sm font-bold text-gray-800">Atendente Online</span>
                                        <span className="text-xs text-gray-500">Indica se há um humano disponível para transbordo.</span>
                                    </div>
                                </label>
                            </div>
                            <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                                <label className="flex items-center gap-3 cursor-pointer">
                                    <input type="checkbox" name="followup_active" checked={formData.followup_active} onChange={handleChange} className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                                    <div>
                                        <span className="block text-sm font-bold text-gray-800">Follow-up Ativo</span>
                                        <span className="text-xs text-gray-500">Habilita o envio de mensagens de reengajamento.</span>
                                    </div>
                                </label>
                            </div>
                        </div>
                    )}

                    {/* TAB: WBP */}
                    {activeTab === 'wbp' && (
                        <div className="space-y-4">
                            <div className="bg-blue-50 p-4 rounded-lg text-sm text-blue-800 mb-4">
                                <p>Credenciais da API do WhatsApp Business (Meta).</p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">ID do Número de Telefone (WBP)</label>
                                <input type="text" name="wbp_phone_number_id" value={formData.wbp_phone_number_id} onChange={handleChange} className="block w-full px-4 py-2.5 text-sm rounded-lg border border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">ID da Conta Business (WBP)</label>
                                <input type="text" name="wbp_business_account_id" value={formData.wbp_business_account_id} onChange={handleChange} className="block w-full px-4 py-2.5 text-sm rounded-lg border border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" />
                            </div>
                        </div>
                    )}

                    {/* TAB: FOLLOW-UP */}
                    {activeTab === 'followup' && (
                        <div className="space-y-6">
                            {/* Horário */}
                            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                                <h4 className="text-sm font-bold text-gray-800 mb-3">Horário de Envio</h4>
                                <div className="flex flex-wrap gap-2 mb-4">
                                    {weekDays.map(day => (
                                        <button
                                            key={day.id}
                                            type="button"
                                            onClick={() => handleDayToggle(day.id)}
                                            className={`px-2 py-1 text-xs font-medium rounded border transition-colors ${
                                                followupConfig.business_hours?.days?.includes(day.id)
                                                    ? 'bg-blue-600 text-white border-blue-600'
                                                    : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'
                                            }`}
                                        >
                                            {day.label}
                                        </button>
                                    ))}
                                </div>
                                <div className="flex items-center gap-2">
                                    <input type="time" value={followupConfig.business_hours?.start || "08:00"} onChange={e => handleTimeChange('start', e.target.value)} className="p-2 border border-gray-300 rounded text-sm" />
                                    <span className="text-gray-500 text-sm">até</span>
                                    <input type="time" value={followupConfig.business_hours?.end || "18:00"} onChange={e => handleTimeChange('end', e.target.value)} className="p-2 border border-gray-300 rounded text-sm" />
                                </div>
                            </div>

                            {/* Intervalos */}
                            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                                <div className="flex justify-between items-center mb-3">
                                    <h4 className="text-sm font-bold text-gray-800">Intervalos (Horas)</h4>
                                    <button type="button" onClick={addInterval} className="text-xs flex items-center gap-1 text-blue-600 hover:text-blue-800 font-medium"><Plus size={14} /> Adicionar</button>
                                </div>
                                <div className="space-y-2">
                                    {(followupConfig.intervals || []).map((interval, index) => (
                                        <div key={index} className="flex items-center gap-2">
                                            <span className="text-sm text-gray-600 w-16">Após</span>
                                            <input 
                                                type="number" 
                                                min="1" 
                                                max={interval.unit === 'hours' ? 168 : 1440}
                                                value={interval.value} 
                                                onChange={e => handleIntervalChange(index, 'value', e.target.value)} 
                                                className="w-20 p-1.5 border border-gray-300 rounded text-sm" 
                                            />
                                            <select value={interval.unit} onChange={e => handleIntervalChange(index, 'unit', e.target.value)} className="p-1.5 border border-gray-300 rounded text-sm bg-white">
                                                <option value="minutes">minuto(s)</option>
                                                <option value="hours">hora(s)</option>
                                            </select>
                                            <button type="button" onClick={() => removeInterval(index)} className="ml-auto text-red-500 hover:text-red-700 p-1"><Trash2 size={14} /></button>
                                        </div>
                                    ))}
                                    {(!followupConfig.intervals || followupConfig.intervals.length === 0) && <p className="text-xs text-gray-400 italic">Nenhum intervalo definido.</p>}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-6 border-t border-gray-200 flex justify-end gap-4 bg-gray-50 rounded-b-xl">
                    <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition">Cancelar</button>
                    <button type="button" onClick={handleSave} disabled={isSaving} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition flex items-center gap-2 disabled:bg-gray-400">
                        {isSaving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                        {isSaving ? 'Salvando...' : 'Salvar'}
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

    const handleLogout = () => {
        localStorage.removeItem('accessToken');
        toast.success('Logout realizado com sucesso!');
        navigate('/login');
    };

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

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);

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
            throw err; // Re-lança para manter o modal aberto
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
        if (!personaId) return '-';
        const persona = allPersonas.find(p => p.id === personaId);
        return persona ? persona.nome_config : `ID: ${personaId}`;
    };

    const filteredUsers = users.filter(user => 
        user.email.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (isLoading) {
        return <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-blue-600" size={32} /></div>;
    }

    if (error) {
        return <div className="p-10 text-center text-red-600 bg-red-50 rounded-lg m-10">{error}</div>;
    }

    return (
        <div className="p-6 md:p-10 bg-gray-50 min-h-screen">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-gray-800">Painel do Administrador</h1>
                    <p className="text-gray-500 mt-1">Gerenciamento de usuários do sistema.</p>
                </div>
                <div className="flex items-center gap-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                        <input
                            type="text"
                            placeholder="Pesquisar por email..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-64 pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <button
                        onClick={() => setModalState({ type: 'create', data: null })}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg shadow-md text-sm font-medium hover:bg-blue-700 transition-colors"
                    >
                        <UserPlus size={16} />
                        Novo Usuário
                    </button>
                </div>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-md border border-gray-200">
                <div className="overflow-x-auto custom-scrollbar pb-2">
                    <table className="w-full text-left min-w-[1000px]">
                        <thead className="border-b-2 border-gray-200">
                            <tr>
                                <th className="p-4 text-sm font-semibold text-gray-600">Email</th>
                                <th className="p-4 text-sm font-semibold text-gray-600">Tokens</th>
                                <th className="p-4 text-sm font-semibold text-gray-600 text-center">Persona Padrão</th>
                                <th className="p-4 text-sm font-semibold text-gray-600 text-center">Status</th>
                                <th className="p-4 text-sm font-semibold text-gray-600">WBP (Phone / Biz)</th>
                                <th className="p-4 text-sm font-semibold text-gray-600 text-center">Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredUsers.map(user => (
                                <tr key={user.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                                    <td className="p-4 font-semibold text-gray-800">
                                        {user.email}
                                        {user.is_superuser && (
                                            <Shield size={14} className="inline-block ml-1 text-purple-600" title="Superusuário" />
                                        )}
                                    </td>
                                    <td className="p-4 text-gray-600">{user.tokens.toLocaleString('pt-BR')}</td>
                                    <td className="p-4 text-sm text-center text-gray-600">{getPersonaName(user.default_persona_id)}</td>
                                    <td className="p-4 text-sm">
                                        <div className="flex items-center justify-center gap-3">
                                            <span title={`Agente ${user.agent_running ? 'Ativo' : 'Inativo'}`}>{user.agent_running ? <CheckCircle size={18} className="text-green-500" /> : <XCircle size={18} className="text-gray-400" />}</span>
                                            <span title={`Atendente ${user.atendente_online ? 'Online' : 'Offline'}`}>{user.atendente_online ? <CheckCircle size={18} className="text-green-500" /> : <XCircle size={18} className="text-gray-400" />}</span>
                                            <span title={`Follow-up ${user.followup_active ? 'Ativo' : 'Inativo'}`}>{user.followup_active ? <CheckCircle size={18} className="text-green-500" /> : <XCircle size={18} className="text-gray-400" />}</span>
                                        </div>
                                    </td>
                                    <td className="p-4 text-sm text-gray-600">
                                        <div className="flex flex-col max-w-[150px]">
                                            <span className="truncate text-xs" title={`Phone ID: ${user.wbp_phone_number_id}`}>P: {user.wbp_phone_number_id || '-'}</span>
                                            <span className="truncate text-xs text-gray-400" title={`Biz ID: ${user.wbp_business_account_id}`}>B: {user.wbp_business_account_id || '-'}</span>
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <div className="flex justify-center items-center gap-2">
                                            <button onClick={() => setModalState({ type: 'edit', data: user })} className="p-2 text-gray-500 hover:text-blue-600 hover:bg-gray-100 rounded-full transition-colors" title="Editar Usuário"><Edit size={18} /></button>
                                            <button onClick={() => handleDeleteUser(user.id)} className="p-2 text-gray-500 hover:text-red-600 hover:bg-gray-100 rounded-full transition-colors" title="Apagar Usuário"><Trash2 size={18} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
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

export default Admin;