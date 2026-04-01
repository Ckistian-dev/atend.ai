import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import api from '../api/axiosConfig';
import toast from 'react-hot-toast';
import {
    Plus, Save, Trash2, FileText, ChevronRight, Loader2,
    Link as LinkIcon, Star, CheckCircle, Folder, Copy, Share2, Database, ExternalLink, Bell, RefreshCw, Check,
    Calendar, Clock, X,
    Search, User, Users, Info, Network, Maximize2
} from 'lucide-react';
import { WorkflowPreview, WorkflowEditorModal } from '../components/configs/WorkflowEditor';

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

const initialFormData = {
    nome_config: '',
    contexto_json: null,
    arquivos_drive_json: null,
    notification_active: false,
    notification_destination: '',
    available_hours: { seg: [], ter: [], qua: [], qui: [], sex: [], sab: [], dom: [] },
    is_calendar_connected: false,
    is_calendar_active: false,
    workflow_json: { nodes: [], edges: [] }
};


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
    const [spreadsheetRagId, setSpreadsheetRagId] = useState(''); // RAG

    // Estados Drive (Novo)
    const [driveFolderId, setDriveFolderId] = useState('');

    // Estados Notificações (Novo)
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [destinations, setDestinations] = useState([]);
    const [destSearchTerm, setDestSearchTerm] = useState('');

    // Estados Agenda
    const [schedule, setSchedule] = useState({});
    const [activeTab, setActiveTab] = useState('system'); // 'system', 'rag', 'drive', 'notifications', 'agenda'

    // Estados do Workflow
    const [isWorkflowModalOpen, setIsWorkflowModalOpen] = useState(false);

    const isInitialLoad = useRef(true);

    const dayLabels = { seg: 'Segunda', ter: 'Terça', qua: 'Quarta', qui: 'Quinta', sex: 'Sexta', sab: 'Sábado', dom: 'Domingo' };

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
            }
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

        setDestSearchTerm(config.notification_destination || '');

        // Setup workflow

        setActiveTab('system');
        setError('');
    }, []);

    useEffect(() => {
        if (isInitialLoad.current && configs.length > 0) {
            handleSelectConfig(configs[0]);
            isInitialLoad.current = false;
        }
    }, [configs, handleSelectConfig]);

    const handleNewConfig = useCallback(() => {
        setSelectedConfig(null);
        setFormData(initialFormData);
        setSpreadsheetId('');
        setSpreadsheetRagId('');
        setDriveFolderId('');
        setDestSearchTerm('');
        const defaultSchedule = {};
        ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'].forEach(day => {
            defaultSchedule[day] = { active: false, blocks: [{ start: '09:00', end: '18:00' }] };
        });
        setSchedule(defaultSchedule);
        setActiveTab('system');
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

    const handleSave = async (e) => {
        e.preventDefault();
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
            workflow_json: formData.workflow_json
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
            toast.success('Configuração salva com sucesso!');
        } catch (err) {
            toast.error('Erro ao salvar. Verifique os campos.');
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
        if (userData?.default_persona_id === configId) return;
        try {
            await api.put('/users/me', { default_persona_id: configId });
            await fetchData();
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
                timeout: 3600000 // Aumentado para 60 minutos (3.600.000 ms) para comportar ~16 mil linhas
            });

            if (type === 'system') {
                // Atualiza o form data localmente para garantir integridade ao salvar depois
                setFormData(prev => ({ ...prev, contexto_json: null }));
            }

            toast.success(`Sucesso! ${response.data.sheets_found} itens sincronizados (${type.toUpperCase()}).`);
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
                timeout: 3600000 // Aumentado para 60 minutos (3.600.000 ms) para comportar grandes volumes
            });

            const filesCount = response.data.files_found || 0;

            // Atualiza o form data localmente
            setFormData(prev => ({ ...prev, arquivos_drive_json: null }));

            toast.success(`Sucesso! ${filesCount} arquivos encontrados.`);
        } catch (err) {
            setError(err.response?.data?.detail || 'Falha ao sincronizar Drive. Verifique o ID e o compartilhamento.');
        } finally {
            setIsSyncing(false);
        }
    };

    // --- Fetch Destinations (ProspectAI) ---
    const fetchDestinations = async () => {
        try {
            const response = await api.get('/configs/destinations');
            const data = response.data.destinations || response.data;
            setDestinations(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error("Erro ao buscar destinos:", err);
            toast.error("Não foi possível carregar a lista de contatos do ProspectAI.");
        }
    };

    const manualJid = useMemo(() => {
        let digits = destSearchTerm.replace(/\D/g, '');
        if (digits.length >= 10) {
            if (!digits.startsWith('55')) digits = `55${digits}`;
            // Normaliza para remover o nono dígito se necessário
            const normalized = normalizeJid(`${digits}@s.whatsapp.net`);
            return normalized;
        }
        return null;
    }, [destSearchTerm]);

    const filteredDestinations = useMemo(() => {
        const term = destSearchTerm.toLowerCase().trim();
        const termDigits = term.replace(/\D/g, '');

        // 1. Remove duplicados por remoteJid e ordena alfabeticamente
        const uniqueMap = new Map();
        destinations.forEach(d => {
            const jid = d.remoteJid || d.id;
            if (jid && !uniqueMap.has(jid)) {
                uniqueMap.set(jid, { ...d, remoteJid: jid });
            }
        });

        const uniqueList = Array.from(uniqueMap.values()).sort((a, b) => {
            const nameA = (a.name || a.subject || 'Sem nome').toLowerCase();
            const nameB = (b.name || b.subject || 'Sem nome').toLowerCase();
            return nameA.localeCompare(nameB);
        });

        if (!term) return uniqueList;

        return uniqueList.filter(dest => {
            const name = (dest.name || dest.subject || '').toLowerCase();
            const fullJid = (dest.remoteJid || '').toLowerCase();

            if (name.includes(term)) return true;

            const jidPrefix = fullJid.split('@')[0];

            // Se o termo de busca parece um número, tenta busca normalizada (sem nono dígito)
            if (termDigits.length >= 8) {
                const normalizedJid = normalizeJid(jidPrefix);
                // Se o termo tem 10 ou 11 dígitos, assumimos que é DD + número e adicionamos 55 para normalizar
                let searchVal = termDigits;
                if (termDigits.length === 10 || termDigits.length === 11) {
                    searchVal = termDigits.startsWith('55') ? termDigits : `55${termDigits}`;
                }
                const normalizedTerm = normalizeJid(searchVal);
                if (normalizedJid.includes(normalizedTerm)) return true;
            }

            return term.includes('@') ? fullJid.includes(term) : jidPrefix.includes(term);
        });
    }, [destinations, destSearchTerm]);

    const extractId = (value) => {
        if (!value) return "";
        const sheetMatch = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        if (sheetMatch) return sheetMatch[1];
        const folderMatch = value.match(/\/folders\/([a-zA-Z0-9-_]+)/);
        if (folderMatch) return folderMatch[1];
        return value;
    };

    const openResource = (id, type) => {
        if (!id) return;
        const baseUrl = type === 'drive'
            ? 'https://drive.google.com/drive/folders/'
            : 'https://docs.google.com/spreadsheets/d/';
        window.open(`${baseUrl}${id}`, '_blank');
    };

    // Carrega destinos quando a aba de notificações é aberta
    useEffect(() => {
        if (activeTab === 'notifications') {
            fetchDestinations();
        }
    }, [activeTab]);


    const labelClass = "block text-sm font-semibold text-gray-700 mb-1";
    const inputClass = "w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-primary resize-none";

    return (
        <div className="p-6 md:p-10 bg-gray-50 h-full flex flex-col">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-gray-800">Configurações de Contexto</h1>
                <p className="text-gray-500 mt-1">Crie e gerencie as configurações de contexto para a sua IA.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1 min-h-0">
                {/* SIDEBAR */}
                <div className="lg:col-span-1 bg-white p-6 rounded-xl shadow-lg border flex flex-col min-h-0">
                    <button onClick={handleNewConfig} className="flex-shrink-0 w-full flex items-center justify-center gap-2 bg-brand-primary text-white font-bold py-3 px-4 rounded-lg shadow-md hover:bg-brand-primary-dark transition mb-6">
                        <Plus size={20} /> Nova Configuração
                    </button>
                    <h2 className="flex-shrink-0 text-lg font-semibold text-gray-700 mb-3 px-1">Configurações Salvas</h2>
                    {isLoading ? <p className="text-center text-gray-500">A carregar...</p> : (
                        <ul className="space-y-2 overflow-y-auto custom-scrollbar pr-1 flex-1 min-h-0">
                            {configs.map(config => (
                                <li key={config.id} className="flex items-center gap-2">
                                    <button onClick={() => handleSetDefault(config.id)} title="Definir como padrão">
                                        <Star size={20} className={`transition-colors ${userData?.default_persona_id === config.id ? 'text-yellow-400 fill-current' : 'text-gray-300 hover:text-yellow-400'}`} />
                                    </button>
                                    <button onClick={() => handleSelectConfig(config)} className={`w-full text-left p-3 rounded-lg flex justify-between items-center transition-all duration-200 ${selectedConfig?.id === config.id ? 'bg-brand-primary text-white font-semibold shadow-sm' : 'hover:bg-gray-100 hover:pl-4'}`}>
                                        <span className="truncate pr-2">{config.nome_config}</span>
                                        <ChevronRight size={18} />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                {/* MAIN CONTENT */}
                <div className="lg:col-span-2 bg-white p-6 md:p-8 rounded-xl shadow-lg border overflow-y-auto min-h-0">
                    <form onSubmit={handleSave} className="flex flex-col h-full">
                        <div className="flex-grow">
                            {/* Título */}
                            <div className="flex items-center gap-4 mb-6">
                                <FileText className="text-brand-primary" size={32} />
                                <input type="text" placeholder="Dê um nome para esta Configuração..." name="nome_config" value={formData.nome_config} onChange={handleFormChange} required className="w-full text-2xl font-bold text-gray-800 border-b-2 border-gray-200 focus:border-brand-green focus:outline-none py-2 bg-transparent" />
                            </div>

                            {/* Abas */}
                            <div className="flex border-b border-gray-200 mb-6 overflow-x-auto custom-scrollbar">
                                <button type="button" onClick={() => setActiveTab('system')} className={`flex items-center gap-2 px-4 py-3 font-semibold transition-all ${activeTab === 'system' ? 'border-b-2 border-brand-green text-brand-primary' : 'text-gray-500 hover:text-gray-800'}`}>
                                    <LinkIcon size={18} /> Persona
                                </button>
                                <button type="button" onClick={() => setActiveTab('rag')} className={`flex items-center gap-2 px-4 py-3 font-semibold transition-all ${activeTab === 'rag' ? 'border-b-2 border-brand-green text-brand-primary' : 'text-gray-500 hover:text-gray-800'}`}>
                                    <Database size={18} /> Dados
                                </button>
                                <button type="button" onClick={() => setActiveTab('drive')} className={`flex items-center gap-2 px-4 py-3 font-semibold transition-all ${activeTab === 'drive' ? 'border-b-2 border-brand-green text-brand-primary' : 'text-gray-500 hover:text-gray-800'}`}>
                                    <Folder size={18} /> Arquivos
                                </button>
                                <button type="button" onClick={() => setActiveTab('fluxo')} className={`flex items-center gap-2 px-4 py-3 font-semibold transition-all ${activeTab === 'fluxo' ? 'border-b-2 border-brand-green text-brand-primary' : 'text-gray-500 hover:text-gray-800'}`}>
                                    <Network size={18} /> Fluxo
                                </button>
                                <button type="button" onClick={() => setActiveTab('notifications')} className={`flex items-center gap-2 px-4 py-3 font-semibold transition-all ${activeTab === 'notifications' ? 'border-b-2 border-brand-green text-brand-primary' : 'text-gray-500 hover:text-gray-800'}`}>
                                    <Bell size={18} /> Notificações
                                </button>
                                <button type="button" onClick={() => setActiveTab('agenda')} className={`flex items-center gap-2 px-4 py-3 font-semibold transition-all ${activeTab === 'agenda' ? 'border-b-2 border-brand-green text-brand-primary' : 'text-gray-500 hover:text-gray-800'}`}>
                                    <Calendar size={18} /> Agenda
                                </button>
                            </div>

                            {error && (
                                <div className="mb-4 p-3 bg-red-50 text-red-700 rounded border border-red-200 text-sm">
                                    {error}
                                </div>
                            )}

                            {/* CONTEÚDO ABA: SYSTEM (INSTRUÇÕES) */}
                            {activeTab === 'system' && (
                                <div className="animate-fade-in space-y-6">
                                    {!selectedConfig?.spreadsheet_id ? (
                                        <div className="p-6 bg-blue-50 border border-blue-100 rounded-lg shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                                            <div>
                                                <div className="flex items-center gap-2 font-semibold text-brand-primary-active mb-1">
                                                    <FileText size={20} />
                                                    <h3>Criar Planilha de Instruções</h3>
                                                </div>
                                                <p className="text-sm text-gray-700">Conecte sua conta do Google para criar a planilha automaticamente.</p>
                                            </div>
                                            <div className="flex-shrink-0">
                                                <button type="button" onClick={() => handleProvision('system')} disabled={isSyncing || !selectedConfig?.id} className="flex items-center gap-3 bg-white border border-gray-300 text-gray-700 px-6 py-2 rounded-md font-bold whitespace-nowrap hover:bg-gray-50 transition-colors disabled:opacity-50 shadow-sm">
                                                    {isSyncing ? <Loader2 className="animate-spin mx-auto" size={20} /> : (
                                                        <>
                                                            <img src="https://img.icons8.com/color/24/000000/google-logo.png" alt="Google" className="w-5 h-5" />
                                                            Conectar e Criar
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                                            <div>
                                                <h3 className="font-bold text-brand-primary flex items-center gap-2"><CheckCircle size={20} /> Planilha de Instruções Ativa</h3>
                                                <p className="text-sm text-gray-500 mt-1">A planilha já foi gerada e está conectada a esta configuração.</p>
                                            </div>
                                            <div className="flex flex-wrap gap-3">
                                                <button type="button" onClick={() => openResource(selectedConfig.spreadsheet_id, 'sheet')} className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 transition-colors font-medium text-gray-700">
                                                    <ExternalLink size={18} /> Abrir Planilha
                                                </button>
                                                <button type="button" onClick={() => handleSyncSheet('system')} disabled={isSyncing} className="flex items-center gap-2 bg-brand-primary text-white font-bold py-2 px-6 rounded shadow-md hover:bg-brand-primary-dark transition-all disabled:bg-gray-400">
                                                    {isSyncing ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />} Sincronizar
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* Instruções System */}
                                    <div className="p-4 bg-blue-50 rounded-lg border border-blue-100 text-sm text-gray-700 space-y-4 mt-6">
                                        <div className="flex items-center gap-2 font-semibold text-brand-primary-active">
                                            <Info size={18} />
                                            <h4>Como funciona a Planilha de Instruções (System Prompt)</h4>
                                        </div>
                                        <p className="text-gray-600">
                                            Esta planilha define a personalidade, as regras de negócio e o comportamento geral da sua Inteligência Artificial.
                                        </p>
                                        <ul className="list-disc list-inside space-y-2 text-gray-600">
                                            <li><strong>Persona:</strong> Defina o tom de voz, o nome do assistente e como ele deve se comportar.</li>
                                            <li><strong>Regras:</strong> Crie categorias com diretrizes claras do que a IA deve ou não fazer (ex: "Sempre ofereça um desconto à vista", "Nunca passe informações de concorrentes").</li>
                                            <li><strong>Sincronização:</strong> Sempre que alterar algo na planilha no Google Sheets, clique em <strong>Sincronizar</strong> aqui para que a IA aprenda as novas regras e passe a utilizá-las.</li>
                                        </ul>
                                    </div>
                                </div>
                            )}

                            {/* CONTEÚDO ABA: FLUXO VISUAL */}
                            {activeTab === 'fluxo' && (
                                <div className="animate-fade-in space-y-6 h-[400px] flex flex-col">
                                    <div className="flex justify-between items-end">
                                        <div>
                                            <h3 className="font-bold text-gray-800">Mapeamento de Fluxo da Conversa</h3>
                                            <p className="text-sm text-gray-500">Desenhe os passos que a IA deve seguir durante a interação com o cliente.</p>
                                        </div>
                                        <button type="button" onClick={() => setIsWorkflowModalOpen(true)} className="flex items-center gap-2 bg-brand-primary text-white font-bold py-2 px-4 rounded-md shadow-sm hover:bg-brand-primary-dark transition-all">
                                            <Maximize2 size={16} /> Editar Fluxo
                                        </button>
                                    </div>

                                    {/* Preview do Canvas */}
                                    <div className="flex-1 bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl relative overflow-hidden group">
                                        <div className="absolute inset-0 z-10 bg-black/5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer backdrop-blur-[1px]" onClick={() => setIsWorkflowModalOpen(true)}>
                                            <div className="bg-white px-6 py-3 rounded-full shadow-lg font-bold text-brand-primary flex items-center gap-2">
                                                <Network size={20} /> Clique para expandir e editar
                                            </div>
                                        </div>
                                    <WorkflowPreview workflowJson={formData.workflow_json} />
                                    </div>
                                </div>
                            )}

                            {/* CONTEÚDO ABA: RAG (CONHECIMENTO) */}
                            {activeTab === 'rag' && (
                                <div className="animate-fade-in space-y-6">
                                    {!selectedConfig?.spreadsheet_rag_id ? (
                                        <div className="p-6 bg-blue-50 border border-blue-100 rounded-lg shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                                            <div>
                                                <div className="flex items-center gap-2 font-semibold text-brand-primary mb-1">
                                                    <Database size={20} />
                                                    <h3>Criar Base de Conhecimento</h3>
                                                </div>
                                                <p className="text-sm text-gray-700">Conecte sua conta do Google para criar a base de conhecimento automaticamente.</p>
                                            </div>
                                            <div className="flex-shrink-0">
                                                <button type="button" onClick={() => handleProvision('rag')} disabled={isSyncing || !selectedConfig?.id} className="flex items-center gap-3 bg-white border border-gray-300 text-gray-700 px-6 py-2 rounded-md font-bold whitespace-nowrap hover:bg-gray-50 transition-colors disabled:opacity-50 shadow-sm">
                                                    {isSyncing ? <Loader2 className="animate-spin mx-auto" size={20} /> : (
                                                        <>
                                                            <img src="https://img.icons8.com/color/24/000000/google-logo.png" alt="Google" className="w-5 h-5" />
                                                            Conectar e Criar
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                                            <div>
                                                <h3 className="font-bold text-brand-primary flex items-center gap-2"><CheckCircle size={20} /> Base RAG Ativa</h3>
                                                <p className="text-sm text-gray-500 mt-1">Sua base de conhecimento já está conectada.</p>
                                            </div>
                                            <div className="flex flex-wrap gap-3">
                                                <button type="button" onClick={() => openResource(selectedConfig.spreadsheet_rag_id, 'sheet')} className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 transition-colors font-medium text-gray-700">
                                                    <ExternalLink size={18} /> Abrir Planilha
                                                </button>
                                                <button type="button" onClick={() => handleSyncSheet('rag')} disabled={isSyncing} className="flex items-center gap-2 bg-brand-primary text-white font-bold py-2 px-6 rounded shadow-md hover:bg-brand-primary-dark transition-all disabled:bg-gray-400">
                                                    {isSyncing ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />} Sincronizar
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* Instruções RAG */}
                                    <div className="p-4 bg-blue-50 rounded-lg border border-blue-100 text-sm text-gray-700 space-y-4 mt-6">
                                        <div className="flex items-center gap-2 font-semibold text-brand-primary-active">
                                            <Info size={18} />
                                            <h4>Como funciona a Base de Conhecimento (RAG)</h4>
                                        </div>
                                        <p className="text-gray-600">
                                            Esta planilha atua como a memória estendida da sua IA, permitindo que ela consulte informações volumosas e dados estruturados em tempo real.
                                        </p>
                                        <ul className="list-disc list-inside space-y-2 text-gray-600">
                                            <li><strong>Catálogo de Produtos:</strong> Liste seus produtos, serviços, preços, links e descrições detalhadas. A IA pesquisará nesta base antes de responder perguntas de vendas ou técnicas.</li>
                                            <li><strong>Perguntas Frequentes (FAQ):</strong> Adicione as dúvidas mais recorrentes dos seus clientes com as respostas exatas que a IA deve fornecer.</li>
                                            <li><strong>Sincronização:</strong> Toda vez que adicionar novos produtos ou alterar preços, lembre-se de clicar em <strong>Sincronizar</strong>.</li>
                                        </ul>
                                    </div>
                                </div>
                            )}

                            {/* CONTEÚDO ABA: DRIVE */}
                            {activeTab === 'drive' && (
                                <div className="animate-fade-in space-y-6">
                                    {!selectedConfig?.drive_id ? (
                                        <div className="p-6 bg-indigo-50 border border-indigo-100 rounded-lg shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                                            <div>
                                                <div className="flex items-center gap-2 font-semibold text-indigo-800 mb-1">
                                                    <Folder size={20} />
                                                    <h3>Criar Pasta no Google Drive</h3>
                                                </div>
                                                <p className="text-sm text-gray-700">Conecte sua conta do Google para criar a pasta automaticamente.</p>
                                            </div>
                                            <div className="flex-shrink-0">
                                                <button type="button" onClick={() => handleProvision('drive')} disabled={isSyncing || !selectedConfig?.id} className="flex items-center gap-3 bg-white border border-gray-300 text-gray-700 px-6 py-2 rounded-md font-bold whitespace-nowrap hover:bg-gray-50 transition-colors disabled:opacity-50 shadow-sm">
                                                    {isSyncing ? <Loader2 className="animate-spin mx-auto" size={20} /> : (
                                                        <>
                                                            <img src="https://img.icons8.com/color/24/000000/google-logo.png" alt="Google" className="w-5 h-5" />
                                                            Conectar e Criar
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                                            <div>
                                                <h3 className="font-bold text-brand-primary flex items-center gap-2"><CheckCircle size={20} /> Pasta Conectada</h3>
                                                <p className="text-sm text-gray-500 mt-1">Pasta no Drive configurada e pronta para receber ficheiros.</p>
                                            </div>
                                            <div className="flex flex-wrap gap-3">
                                                <button type="button" onClick={() => openResource(selectedConfig.drive_id, 'drive')} className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 transition-colors font-medium text-gray-700">
                                                    <ExternalLink size={18} /> Abrir Pasta
                                                </button>
                                                <button type="button" onClick={handleSyncDrive} disabled={isSyncing} className="flex items-center gap-2 bg-brand-primary text-white font-bold py-2 px-6 rounded shadow-md hover:bg-brand-primary-dark transition-all disabled:bg-gray-400">
                                                    {isSyncing ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />} Sincronizar
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* Instruções Drive */}
                                    <div className="p-4 bg-blue-50 rounded-lg border border-blue-100 text-sm text-gray-700 space-y-4 mt-6">
                                        <div className="flex items-center gap-2 font-semibold text-brand-primary-active">
                                            <Info size={18} />
                                            <h4>Como funciona a integração com o Google Drive</h4>
                                        </div>
                                        <p className="text-gray-600">
                                            Conecte uma pasta do Google Drive para que a IA consiga buscar e enviar arquivos de mídia (fotos, vídeos, PDFs) diretamente aos seus clientes durante o atendimento.
                                        </p>
                                        <ul className="list-disc list-inside space-y-2 text-gray-600">
                                            <li><strong>Organização:</strong> É recomendado criar subpastas dentro da pasta principal para categorizar seus arquivos (ex: /Tabelas de Preços, /Fotos de Produtos). A IA reconhece toda a estrutura.</li>
                                            <li><strong>Nomes Claros e Descritivos:</strong> Dê nomes explicativos aos arquivos (ex: "Foto_Painel_Ripado_Freijo.jpg" ou "Catalogo_Servicos_2025.pdf"). A IA utiliza o nome dos arquivos para entender qual conteúdo enviar quando o cliente solicitar.</li>
                                            <li><strong>Sincronização:</strong> Ao subir novos arquivos para a pasta ou renomear arquivos existentes, clique sempre no botão <strong>Sincronizar</strong> nesta tela para a IA catalogar as novidades.</li>
                                        </ul>
                                    </div>
                                </div>
                            )}

                            {/* CONTEÚDO ABA: NOTIFICAÇÕES (PROSPECT AI) */}
                            {activeTab === 'notifications' && (
                                <div className="animate-fade-in space-y-6">
                                    <div className="relative">
                                        <label className={labelClass}>Destino das Notificações (WhatsApp)</label>
                                        <div className="flex items-center gap-4">
                                            <div className="relative flex-grow" ref={dropdownRef}>
                                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                                <input
                                                    type="text"
                                                    placeholder="Pesquisar contato ou grupo..."
                                                    value={destSearchTerm}
                                                    onChange={(e) => {
                                                        setDestSearchTerm(e.target.value);
                                                        setIsDropdownOpen(true);
                                                    }}
                                                    onFocus={() => setIsDropdownOpen(true)}
                                                    className={`${inputClass} pl-10 pr-16`}
                                                />
                                                <div className="absolute inset-y-0 right-0 flex items-center pr-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => setFormData(prev => ({ ...prev, notification_active: !prev.notification_active }))}
                                                        title={formData.notification_active ? "Desativar Notificações" : "Ativar Notificações"}
                                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-green focus:ring-offset-2 ${formData.notification_active ? 'bg-brand-primary' : 'bg-gray-200'}`}
                                                    >
                                                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.notification_active ? 'translate-x-6' : 'translate-x-1'}`} />
                                                    </button>
                                                </div>

                                                {/* Dropdown de Destinos */}
                                                {isDropdownOpen && (
                                                    <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-xl max-h-60 overflow-y-auto custom-scrollbar divide-y divide-gray-100">
                                                        {filteredDestinations.map(dest => {
                                                            const isGroup = dest.remoteJid?.endsWith('@g.us');
                                                            const isSelected = normalizeJid(formData.notification_destination) === normalizeJid(dest.remoteJid);
                                                            return (
                                                                <button
                                                                    key={dest.id}
                                                                    type="button"
                                                                    onClick={() => {
                                                                        const normalized = normalizeJid(dest.remoteJid);
                                                                        setFormData(prev => ({ ...prev, notification_destination: normalized }));
                                                                        setDestSearchTerm(normalized);
                                                                        setIsDropdownOpen(false);
                                                                    }}
                                                                    className={`w-full flex items-center gap-3 p-3 text-left transition-colors hover:bg-gray-50 ${isSelected ? 'bg-blue-50' : ''}`}
                                                                >
                                                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${isGroup ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-brand-primary'}`}>
                                                                        {isGroup ? <Users size={20} /> : <User size={20} />}
                                                                    </div>
                                                                    <div className="flex-grow min-w-0">
                                                                        <p className={`text-sm font-semibold truncate ${isSelected ? 'text-brand-primary-active' : 'text-gray-800'}`}>
                                                                            {dest.name || dest.subject || (isGroup ? "Grupo sem nome" : "Contato sem nome")}
                                                                        </p>
                                                                        <p className="text-xs text-gray-500 truncate">{dest.remoteJid}</p>
                                                                    </div>
                                                                    {isSelected && <CheckCircle size={18} className="text-brand-primary flex-shrink-0" />}
                                                                </button>
                                                            );
                                                        })}

                                                        {/* Opção Manual */}
                                                        {manualJid && !filteredDestinations.some(d => normalizeJid(d.remoteJid) === manualJid) && (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setFormData(prev => ({ ...prev, notification_destination: manualJid }));
                                                                    setDestSearchTerm(manualJid);
                                                                    setIsDropdownOpen(false);
                                                                }}
                                                                className={`w-full flex items-center gap-3 p-3 text-left transition-colors hover:bg-blue-50 ${formData.notification_destination === manualJid ? 'bg-blue-50' : ''}`}
                                                            >
                                                                <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-green-100 text-brand-primary">
                                                                    <Plus size={20} />
                                                                </div>
                                                                <div className="flex-grow min-w-0">
                                                                    <p className="text-sm font-semibold text-gray-800">Adicionar número manualmente</p>
                                                                    <p className="text-xs text-gray-500 truncate">{manualJid}</p>
                                                                </div>
                                                                {formData.notification_destination === manualJid && <CheckCircle size={18} className="text-brand-primary flex-shrink-0" />}
                                                            </button>
                                                        )}

                                                        {destinations.length === 0 && !manualJid && (
                                                            <div className="p-8 text-center text-gray-500 italic text-sm">Nenhum contato carregado. Clique em atualizar.</div>
                                                        )}
                                                        {destSearchTerm && filteredDestinations.length === 0 && !manualJid && (
                                                            <div className="p-8 text-center text-gray-500 italic text-sm">Nenhum contato encontrado.</div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Instruções Notificações */}
                                    <div className="p-4 bg-blue-50 rounded-lg border border-blue-100 text-sm text-gray-700 space-y-4 mt-6">
                                        <div className="flex items-center gap-2 font-semibold text-brand-primary-active">
                                            <Info size={18} />
                                            <h4>Como funcionam as Notificações</h4>
                                        </div>
                                        <p className="text-gray-600">
                                            Ao habilitar esta opção, o sistema enviará alertas automáticos para o contato ou grupo selecionado sempre que a IA transferir um atendimento.
                                        </p>
                                        <ul className="list-disc list-inside space-y-2 text-gray-600">
                                            <li><strong>Destinos:</strong> É possível mandar as notificações tanto para um contato individual quanto para um grupo.</li>
                                            <li><strong>Contato não listado:</strong> Se não estiver aparecendo o contato desejado na busca, você pode digitar o seu número completo (com DDD) e adicionar manualmente. Lembre-se de salvar a configuração depois.</li>
                                            <li><strong>Grupo não listado:</strong> Se não estiver aparecendo o grupo, adicione o contato <strong className="cursor-pointer text-brand-primary hover:text-brand-primary-active hover:underline transition-colors" onClick={() => { navigator.clipboard.writeText("45 98622675"); toast.success("Número copiado!"); }} title="Clique para copiar">45 98622675</strong> ao grupo que deseja receber as notificações para que o sistema consiga listá-lo.</li>
                                        </ul>
                                    </div>
                                </div>
                            )}

                            {/* CONTEÚDO ABA: AGENDA */}
                            {activeTab === 'agenda' && (
                                <div className="animate-fade-in space-y-6">
                                    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
                                        <div className="flex items-center gap-4">
                                            <Calendar className={formData.is_calendar_connected ? "text-brand-primary" : "text-gray-400"} size={24} />
                                            <div>
                                                <p className="text-sm font-bold text-gray-800">{formData.is_calendar_connected ? "Google Agenda Conectado" : "Google Agenda não conectado"}</p>
                                                <p className="text-xs text-gray-500">Sincronize eventos para evitar conflitos.</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <span className="text-xs font-semibold text-gray-600">Ativar na IA</span>
                                            <button type="button" onClick={() => setFormData(p => ({ ...p, is_calendar_active: !p.is_calendar_active }))} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formData.is_calendar_active ? 'bg-brand-primary' : 'bg-gray-200'}`}>
                                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.is_calendar_active ? 'translate-x-6' : 'translate-x-1'}`} />
                                            </button>
                                            {!formData.is_calendar_connected ? (
                                                <button type="button" onClick={handleConnectCalendar} className="px-4 py-2 bg-brand-primary text-white text-xs font-bold rounded-md hover:bg-brand-primary-dark transition">Conectar</button>
                                            ) : (
                                                <button type="button" onClick={() => api.post(`/configs/google-calendar/${selectedConfig.id}/disconnect`).then(() => fetchData())} className="px-4 py-2 bg-red-100 text-red-700 text-xs font-bold rounded-md hover:bg-red-200 transition">Desconectar</button>
                                            )}
                                        </div>
                                    </div>

                                    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                                        <div className="p-4 bg-gray-50 border-b border-gray-200">
                                            <h3 className="font-bold text-gray-700 flex items-center gap-2"><Clock size={18} className="text-brand-primary" /> Horários de Atendimento</h3>
                                        </div>
                                        <div className="p-4 space-y-2">
                                            {['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'].map(day => (
                                                <div key={day} className="flex items-start gap-3 py-2 border-b border-gray-100 last:border-0">
                                                    <div className="w-24 pt-1.5 flex-shrink-0">
                                                        <label className="flex items-center cursor-pointer">
                                                            <div className="relative">
                                                                <input type="checkbox" className="sr-only" checked={schedule[day]?.active || false} onChange={() => toggleDay(day)} />
                                                                <div className={`block w-8 h-5 rounded-full transition-colors ${schedule[day]?.active ? 'bg-brand-primary' : 'bg-gray-300'}`}></div>
                                                                <div className={`dot absolute left-1 top-1 bg-white w-3 h-3 rounded-full transition-transform ${schedule[day]?.active ? 'transform translate-x-3' : ''}`}></div>
                                                            </div>
                                                            <span className="ml-2 text-sm font-medium text-gray-700">{dayLabels[day]}</span>
                                                        </label>
                                                    </div>
                                                    <div className="flex-1 flex flex-wrap gap-2 items-center">
                                                        {schedule[day]?.active && (
                                                            <>
                                                                {schedule[day].blocks.map((block, idx) => (
                                                                    <div key={idx} className="flex items-center gap-1 bg-gray-50 px-2 py-1 rounded border border-gray-200">
                                                                        <input type="time" value={block.start} onChange={(e) => updateTimeBlock(day, idx, 'start', e.target.value)} className="bg-transparent text-sm outline-none w-20 text-center" />
                                                                        <span className="text-gray-400 text-xs">-</span>
                                                                        <input type="time" value={block.end} onChange={(e) => updateTimeBlock(day, idx, 'end', e.target.value)} className="bg-transparent text-sm outline-none w-20 text-center" />
                                                                        <button type="button" onClick={() => removeTimeBlock(day, idx)} className="text-gray-400 hover:text-red-500 ml-1"><X size={14} /></button>
                                                                    </div>
                                                                ))}
                                                                <button type="button" onClick={() => addTimeBlock(day)} className="p-1 text-brand-primary hover:bg-blue-50 rounded transition-colors"><Plus size={18} /></button>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Instruções Agenda */}
                                    <div className="p-4 bg-blue-50 rounded-lg border border-blue-100 text-sm text-gray-700 space-y-4 mt-6">
                                        <div className="flex items-center gap-2 font-semibold text-brand-primary-active">
                                            <Info size={18} />
                                            <h4>Como funciona a integração com a Agenda</h4>
                                        </div>
                                        <p className="text-gray-600">
                                            Conecte sua conta do Google Agenda para que a IA possa verificar seus horários livres e realizar agendamentos com os clientes de forma 100% automática.
                                        </p>
                                        <ul className="list-disc list-inside space-y-2 text-gray-600">
                                            <li><strong>Conexão:</strong> Clique em "Conectar" para vincular sua conta do Google. A IA lerá seus eventos já existentes para evitar choques de horário.</li>
                                            <li><strong>Disponibilidade:</strong> Defina acima os blocos de horários em que você aceita receber novas reuniões (ex: Seg a Sex, das 09:00 às 18:00).</li>
                                            <li><strong>Ativação:</strong> Lembre-se de ligar a chave <strong>Ativar na IA</strong> ali em cima para liberar a funcionalidade de agendamento durante as conversas.</li>
                                        </ul>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex justify-end items-center gap-4 pt-8 mt-auto border-t border-gray-100">
                            {selectedConfig && (<button type="button" onClick={() => handleDelete(selectedConfig.id)} className="font-semibold text-red-500 hover:text-red-700 flex items-center gap-2 mr-auto px-2 py-2 transition-colors text-sm"><Trash2 size={16} /> Excluir Configuração</button>)}
                            <button type="submit" disabled={isSaving} className="flex items-center gap-2 bg-slate-800 text-white font-semibold py-2.5 px-6 rounded-xl shadow-md hover:bg-slate-900 hover:shadow-lg transition-all disabled:bg-gray-300 disabled:shadow-none text-sm">
                                {isSaving ? <><Loader2 className="animate-spin" size={18} /> Guardando...</> : <><Save size={18} /> Guardar Configuração</>}
                            </button>
                        </div>
                    </form>
                </div>

                {/* MODAL DE CONSTRUÇÃO DE FLUXO (UI ATUALIZADA) */}
                <WorkflowEditorModal
                    isOpen={isWorkflowModalOpen}
                    onClose={() => setIsWorkflowModalOpen(false)}
                    initialWorkflow={formData.workflow_json}
                    onSave={(currentWorkflow) => {
                        setFormData(prev => ({ ...prev, workflow_json: currentWorkflow }));
                    }}
                />
            </div>
        </div>
    );
}

export default Configs;