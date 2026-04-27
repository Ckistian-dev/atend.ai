import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import api from '../api/axiosConfig';
import toast from 'react-hot-toast';
import {
    Plus, Save, Trash2, FileText, ChevronRight, Loader2,
    Link as LinkIcon, Star, CheckCircle, Folder, Copy, Share2, Database, ExternalLink, Bell, RefreshCw, Check,
    Calendar, Clock, X,
    Search, User, Users, Info, Network, Maximize2, Cpu, Sliders, Zap, Bot, ChevronLeft, Wand2
} from 'lucide-react';
import { WorkflowPreview, WorkflowEditorModal } from '../components/configs/WorkflowEditor';
import FeedbackModal from '../components/mensagens/FeedbackModal';
import { LLM_MODELS, DEFAULT_MODEL } from '../constants/models';
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
    top_k: 40
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
    const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
    const [mobileView, setMobileView] = useState('list'); // 'list' ou 'form'

    const isInitialLoad = useRef(true);

    const dayLabels = { seg: 'Segunda', ter: 'Terça', qua: 'Quarta', qui: 'Quinta', sex: 'Sexta', sab: 'Sábado', dom: 'Domingo' };

    const activeTabsList = useMemo(() => [
        { id: 'ia', label: 'Modelo IA', icon: Cpu },
        { id: 'system', label: 'Instruções', icon: FileText },
        { id: 'rag', label: 'Conhecimento', icon: Database },
        { id: 'drive', label: 'Arquivos', icon: Folder },
        { id: 'fluxo', label: 'Fluxo', icon: Network },
        { id: 'notifications', label: 'Alertas', icon: Bell },
        { id: 'agenda', label: 'Agenda', icon: Calendar }
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
            ai_model: config.ai_model || DEFAULT_MODEL,
            temperature: config.temperature ?? 0.5,
            top_p: config.top_p ?? 0.95,
            top_k: config.top_k ?? 40
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

        // setDestSearchTerm('');
        setDestSearchTerm('');

        // No mobile, após selecionar, vamos para o formulário
        setMobileView('form');
        setActiveTab('ia');
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
        setMobileView('form');
        setActiveTab('ia');
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
            top_k: formData.top_k
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

            if (filesCount === 0) {
                toast.success('Nenhum arquivo novo para sincronizar. Tudo já está atualizado!');
            } else {
                toast.success(`Sincronização concluída! ${filesCount} vetores adicionados ao RAG.`);
            }
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
                                        const isDefault = userData?.default_persona_id === config.id;
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
                                                className={`config-tab flex items-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-2.5 sm:py-3.5 text-[10px] sm:text-xs font-bold transition-all whitespace-nowrap ${activeTab === tab.id ? 'active text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
                                            >
                                                <Icon size={14} className="sm:w-4 sm:h-4" strokeWidth={activeTab === tab.id ? 2.5 : 2} />
                                                {tab.label}
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

                                {/* CONTEÚDO ABA: SYSTEM (INSTRUÇÕES) */}
                                {activeTab === 'system' && (
                                    <div className="animate-fade-in space-y-8 overflow-y-scroll custom-scrollbar">
                                        {!selectedConfig?.spreadsheet_id ? (
                                            <div className="p-10 bg-blue-50/50 border border-blue-100/50 rounded-[2.5rem] shadow-sm flex flex-col items-center text-center gap-6">
                                                <div className="w-20 h-20 rounded-full bg-white flex items-center justify-center text-blue-600 shadow-xl shadow-blue-100">
                                                    <FileText size={32} />
                                                </div>
                                                <div>
                                                    <h3 className="text-xl font-black text-slate-900 tracking-tight mb-2">Configure o Cérebro da Operação</h3>
                                                    <p className="text-sm text-slate-500 max-w-md mx-auto">Conecte sua conta do Google para gerar automaticamente a planilha de diretrizes e personalidade desta persona.</p>
                                                </div>
                                                <button type="button" onClick={() => handleProvision('system')} disabled={isSyncing || !selectedConfig?.id} className="flex items-center gap-3 bg-white text-slate-700 font-bold px-8 py-4 rounded-3xl border border-slate-200 hover:border-blue-300 hover:text-blue-600 transition-all disabled:opacity-50 shadow-sm hover:shadow-xl hover:shadow-blue-100">
                                                    {isSyncing ? <Loader2 className="animate-spin" size={20} /> : (
                                                        <>
                                                            <img src="https://img.icons8.com/color/24/000000/google-logo.png" alt="Google" className="w-5 h-5" />
                                                            Gerar Matriz de Instruções
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="p-8 bg-slate-50/50 rounded-[2rem] border border-slate-100 flex flex-col md:flex-row items-center justify-between gap-6">
                                                <div className="flex items-center gap-5">
                                                    <div className="w-14 h-14 rounded-2xl bg-green-50 flex items-center justify-center text-green-600">
                                                        <CheckCircle size={28} />
                                                    </div>
                                                    <div>
                                                        <h3 className="font-black text-slate-900 leading-tight">Matriz de Instruções Ativa</h3>
                                                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Conectado via Google Sheets</p>
                                                    </div>
                                                </div>
                                                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 w-full sm:w-auto">
                                                    <button type="button" onClick={() => openResource(selectedConfig.spreadsheet_id, 'sheet')} className="w-full sm:w-auto flex items-center justify-center gap-1.5 sm:gap-2 px-6 py-3 bg-white border border-slate-200 rounded-xl sm:rounded-2xl hover:bg-slate-50 transition-all font-bold text-slate-600 text-sm">
                                                        <ExternalLink size={18} /> Ver Planilha
                                                    </button>
                                                    <button type="button" onClick={() => handleSyncSheet('system')} disabled={isSyncing} className="w-full sm:w-auto flex items-center justify-center gap-1.5 sm:gap-2 bg-blue-600 text-white font-black py-3 px-8 rounded-xl sm:rounded-2xl shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all disabled:bg-slate-300 text-sm">
                                                        {isSyncing ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />} Sincronizar
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div className="p-6 bg-white rounded-3xl border border-slate-100 shadow-sm">
                                                <h4 className="text-xs font-black text-blue-600 uppercase tracking-[0.2em] mb-4 flex items-center gap-1.5 sm:gap-2">
                                                    <Info size={14} /> Arquitetura do Sistema
                                                </h4>
                                                <p className="text-[13px] text-slate-500 leading-relaxed font-medium">
                                                    Esta planilha define a alma da sua IA. Nela você configura o tom de voz, nome, limites éticos e conhecimentos específicos que não estão em documentos.
                                                </p>
                                            </div>
                                            <div className="p-6 bg-white rounded-3xl border border-slate-100 shadow-sm">
                                                <h4 className="text-xs font-black text-amber-600 uppercase tracking-[0.2em] mb-4 flex items-center gap-1.5 sm:gap-2">
                                                    <Star size={14} /> Dica de Performance
                                                </h4>
                                                <p className="text-[13px] text-slate-500 leading-relaxed font-medium">
                                                    Sempre que alterar uma regra na planilha do Google, lembre-se de clicar em <strong>Sincronizar</strong> acima para que as mudanças tenham efeito imediato.
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* CONTEÚDO ABA: FLUXO VISUAL */}
                                {activeTab === 'fluxo' && (
                                    <div className="animate-fade-in space-y-8 flex-1 flex flex-col min-h-0 overflow-y-scroll custom-scrollbar">
                                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-slate-50 p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] border border-slate-100 gap-4">
                                            <div>
                                                <h3 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">Arquitetura de Conversação</h3>
                                                <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Mapeamento visual de fluxo</p>
                                            </div>
                                            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                                                <button type="button" onClick={() => setIsFeedbackModalOpen(true)} className="w-full sm:w-auto flex items-center justify-center gap-3 bg-blue-100 text-blue-600 font-black py-4 px-6 rounded-xl sm:rounded-2xl shadow-xl hover:bg-blue-200 transition-all text-[10px] sm:text-xs uppercase tracking-widest">
                                                    <Wand2 size={18} /> IA
                                                </button>
                                                <button type="button" onClick={() => setIsWorkflowModalOpen(true)} className="w-full sm:w-auto flex items-center justify-center gap-3 bg-slate-900 text-white font-black py-4 px-8 rounded-xl sm:rounded-2xl shadow-xl hover:bg-black transition-all text-[10px] sm:text-xs uppercase tracking-widest">
                                                    <Maximize2 size={18} /> Expandir Editor
                                                </button>
                                            </div>
                                        </div>

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

                                {/* CONTEÚDO ABA: RAG (CONHECIMENTO) */}
                                {activeTab === 'rag' && (
                                    <div className="animate-fade-in space-y-8 overflow-y-scroll custom-scrollbar">
                                        {!selectedConfig?.spreadsheet_rag_id ? (
                                            <div className="p-10 bg-indigo-50/50 border border-indigo-100/50 rounded-[2.5rem] shadow-sm flex flex-col items-center text-center gap-6">
                                                <div className="w-20 h-20 rounded-full bg-white flex items-center justify-center text-indigo-600 shadow-xl shadow-indigo-100">
                                                    <Database size={32} />
                                                </div>
                                                <div>
                                                    <h3 className="text-xl font-black text-slate-900 tracking-tight mb-2">Construa sua Base de Dados</h3>
                                                    <p className="text-sm text-slate-500 max-w-md mx-auto">Armazene catálogos, FAQs e documentos técnicos. A IA consultará estes dados em milissegundos.</p>
                                                </div>
                                                <button type="button" onClick={() => handleProvision('rag')} disabled={isSyncing || !selectedConfig?.id} className="flex items-center gap-3 bg-white text-slate-700 font-bold px-8 py-4 rounded-3xl border border-slate-200 hover:border-indigo-300 hover:text-indigo-600 transition-all disabled:opacity-50 shadow-sm hover:shadow-xl hover:shadow-indigo-100">
                                                    {isSyncing ? <Loader2 className="animate-spin" size={20} /> : (
                                                        <>
                                                            <img src="https://img.icons8.com/color/24/000000/google-logo.png" alt="Google" className="w-5 h-5" />
                                                            Gerar Base de Conhecimento
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="p-8 bg-slate-50/50 rounded-[2rem] border border-slate-100 flex flex-col md:flex-row items-center justify-between gap-6">
                                                <div className="flex items-center gap-5">
                                                    <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600">
                                                        <CheckCircle size={28} />
                                                    </div>
                                                    <div>
                                                        <h3 className="font-black text-slate-900 leading-tight">Base de Conhecimento Ativa</h3>
                                                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Conectado ao Google Sheets</p>
                                                    </div>
                                                </div>
                                                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 w-full sm:w-auto">
                                                    <button type="button" onClick={() => openResource(selectedConfig.spreadsheet_rag_id, 'sheet')} className="w-full sm:w-auto flex items-center justify-center gap-1.5 sm:gap-2 px-6 py-3 bg-white border border-slate-200 rounded-xl sm:rounded-2xl hover:bg-slate-50 transition-all font-bold text-slate-600 text-sm">
                                                        <ExternalLink size={18} /> Ver Planilha
                                                    </button>
                                                    <button type="button" onClick={() => handleSyncSheet('rag')} disabled={isSyncing} className="w-full sm:w-auto flex items-center justify-center gap-1.5 sm:gap-2 bg-indigo-600 text-white font-black py-3 px-8 rounded-xl sm:rounded-2xl shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all disabled:bg-slate-300 text-sm">
                                                        {isSyncing ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />} Sincronizar
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        <div className="p-8 bg-blue-50/50 rounded-[2rem] border border-blue-100/50">
                                            <h4 className="text-xs font-black text-blue-600 uppercase tracking-[0.2em] mb-4 flex items-center gap-1.5 sm:gap-2">
                                                <Zap size={14} /> Memória de Longo Prazo (RAG)
                                            </h4>
                                            <p className="text-[13px] text-slate-600 font-medium leading-relaxed">
                                                O RAG (Retrieval-Augmented Generation) permite que a IA acesse milhares de linhas de dados sem alucinar. Ideal para:<br />
                                                <span className="inline-block mt-2 font-bold text-slate-900">• Tabelas de Preços e Estoque</span><br />
                                                <span className="inline-block mt-1 font-bold text-slate-900">• Políticas de Reembolso e Garantia</span><br />
                                                <span className="inline-block mt-1 font-bold text-slate-900">• Manuais Técnicos de Produtos</span>
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {/* CONTEÚDO ABA: DRIVE */}
                                {activeTab === 'drive' && (
                                    <div className="animate-fade-in space-y-8 overflow-y-scroll custom-scrollbar">
                                        {!selectedConfig?.drive_id ? (
                                            <div className="p-10 bg-indigo-50/50 border border-indigo-100/50 rounded-[2.5rem] shadow-sm flex flex-col items-center text-center gap-6">
                                                <div className="w-20 h-20 rounded-full bg-white flex items-center justify-center text-indigo-600 shadow-xl shadow-indigo-100">
                                                    <Folder size={32} />
                                                </div>
                                                <div>
                                                    <h3 className="text-xl font-black text-slate-900 tracking-tight mb-2">Repositório de Mídia</h3>
                                                    <p className="text-sm text-slate-500 max-w-md mx-auto">Conecte uma pasta do Google Drive para que a IA envie fotos, vídeos e PDFs automaticamente.</p>
                                                </div>
                                                <button type="button" onClick={() => handleProvision('drive')} disabled={isSyncing || !selectedConfig?.id} className="flex items-center gap-3 bg-white text-slate-700 font-bold px-8 py-4 rounded-3xl border border-slate-200 hover:border-indigo-300 hover:text-indigo-600 transition-all disabled:opacity-50 shadow-sm hover:shadow-xl hover:shadow-indigo-100">
                                                    {isSyncing ? <Loader2 className="animate-spin" size={20} /> : (
                                                        <>
                                                            <img src="https://img.icons8.com/color/24/000000/google-logo.png" alt="Google" className="w-5 h-5" />
                                                            Gerar Pasta no Drive
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="p-8 bg-slate-50/50 rounded-[2rem] border border-slate-100 flex flex-col md:flex-row items-center justify-between gap-6">
                                                <div className="flex items-center gap-5">
                                                    <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600">
                                                        <CheckCircle size={28} />
                                                    </div>
                                                    <div>
                                                        <h3 className="font-black text-slate-900 leading-tight">Google Drive Conectado</h3>
                                                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Armazenamento Ativo</p>
                                                    </div>
                                                </div>
                                                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 w-full sm:w-auto">
                                                    <button type="button" onClick={() => openResource(selectedConfig.drive_id, 'drive')} className="w-full sm:w-auto flex items-center justify-center gap-1.5 sm:gap-2 px-6 py-3 bg-white border border-slate-200 rounded-xl sm:rounded-2xl hover:bg-slate-50 transition-all font-bold text-slate-600 text-sm">
                                                        <ExternalLink size={18} /> Abrir Pasta
                                                    </button>
                                                    <button type="button" onClick={handleSyncDrive} disabled={isSyncing} className="w-full sm:w-auto flex items-center justify-center gap-1.5 sm:gap-2 bg-indigo-600 text-white font-black py-3 px-8 rounded-xl sm:rounded-2xl shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all disabled:bg-slate-300 text-sm">
                                                        {isSyncing ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />} Sincronizar
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div className="p-8 bg-white rounded-[2.5rem] border border-slate-100 shadow-sm">
                                                <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-1.5 sm:gap-2">
                                                    <Info size={14} className="text-blue-600" /> Organização e Nomenclatura
                                                </h4>
                                                <p className="text-[13px] text-slate-500 font-medium leading-relaxed">
                                                    A IA utiliza o <strong>nome do arquivo</strong> para decidir o que enviar. Evite nomes genéricos como "doc1.pdf". Use nomes como "Catalogo_Verao_2025.pdf".
                                                </p>
                                            </div>
                                            <div className="p-8 bg-white rounded-[2.5rem] border border-slate-100 shadow-sm">
                                                <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-1.5 sm:gap-2">
                                                    <Zap size={14} className="text-amber-500" /> Automação de Mídia
                                                </h4>
                                                <p className="text-[13px] text-slate-500 font-medium leading-relaxed">
                                                    Sempre que o cliente pedir uma foto ou manual, a IA fará o upload direto da sua pasta conectada para o WhatsApp dele, sem intervenção humana.
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* CONTEÚDO ABA: NOTIFICAÇÕES (PROSPECT AI) */}
                                {activeTab === 'notifications' && (
                                    <div className="animate-fade-in space-y-8 overflow-y-scroll custom-scrollbar">
                                        <div className="bg-slate-50 p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] border border-slate-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 shadow-sm">
                                            <div className="max-w-md">
                                                <h3 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight mb-2 text-left">Monitoramento de Alertas</h3>
                                                <p className="text-xs sm:text-sm text-slate-500 font-medium text-left">Defina para qual WhatsApp a IA deve enviar alertas</p>
                                            </div>
                                            <div className="flex items-center gap-3 bg-white p-2 rounded-xl sm:rounded-2xl border border-slate-100 shadow-sm w-full sm:w-auto justify-between sm:justify-start">
                                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-3">Status Global</span>
                                                <button type="button" onClick={() => setFormData(prev => ({ ...prev, notification_active: !prev.notification_active }))} className={`relative inline-flex h-8 w-14 items-center rounded-full transition-all ${formData.notification_active ? 'bg-green-500' : 'bg-slate-200'}`}>
                                                    <span className={`inline-block h-6 w-6 transform rounded-full bg-white shadow-md transition-transform ${formData.notification_active ? 'translate-x-7' : 'translate-x-1'}`} />
                                                </button>
                                            </div>
                                        </div>

                                        <div className="relative">
                                            <label className={labelClass}>Canal de Destino (Contato ou Grupo)</label>
                                            <div className="relative" ref={dropdownRef}>
                                                <div className="flex flex-wrap gap-1.5 sm:gap-2 mb-3">
                                                    {(formData.notification_destination || '').split(',').map(d => d.trim()).filter(Boolean).map(destId => (
                                                        <div key={destId} className="flex items-center gap-1.5 sm:gap-2 bg-blue-100 text-blue-700 px-3 py-1.5 rounded-full text-xs font-bold shadow-sm">
                                                            {destId}
                                                            <button type="button" onClick={() => {
                                                                setFormData(prev => {
                                                                    const current = (prev.notification_destination || '').split(',').map(s => s.trim()).filter(Boolean);
                                                                    return { ...prev, notification_destination: current.filter(id => id !== destId).join(', ') };
                                                                });
                                                            }} className="text-blue-400 hover:text-blue-700 transition">
                                                                <X size={14} />
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>

                                                <input
                                                    type="text"
                                                    placeholder="Pesquisar contatos para adicionar à fila..."
                                                    value={destSearchTerm}
                                                    onChange={(e) => {
                                                        setDestSearchTerm(e.target.value);
                                                        setIsDropdownOpen(true);
                                                    }}
                                                    onFocus={() => setIsDropdownOpen(true)}
                                                    className={`${inputClass} pl-12 h-16 text-lg`}
                                                />

                                                {/* Dropdown de Destinos (Premium Style) */}
                                                {isDropdownOpen && (
                                                    <div className="absolute z-20 mt-3 w-full bg-white border border-slate-100 rounded-[2rem] shadow-2xl max-h-[400px] overflow-y-auto custom-scrollbar p-3">
                                                        {/* OPÇÃO DE ADICIONAR MANUALMENTE */}
                                                        {manualJid && !filteredDestinations.some(d => normalizeJid(d.remoteJid) === manualJid) && (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setFormData(prev => {
                                                                        let current = (prev.notification_destination || '').split(',').map(s => s.trim()).filter(Boolean);
                                                                        if (!current.includes(manualJid)) {
                                                                            current.push(manualJid);
                                                                        }
                                                                        return { ...prev, notification_destination: current.join(', ') };
                                                                    });
                                                                    setDestSearchTerm('');
                                                                }}
                                                                className="w-full flex items-center gap-4 p-4 rounded-2xl transition-all bg-blue-600 text-white hover:bg-blue-700 mb-3 shadow-lg shadow-blue-100"
                                                            >
                                                                <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
                                                                    <Plus size={24} />
                                                                </div>
                                                                <div className="flex-grow text-left">
                                                                    <p className="text-[13px] font-black uppercase tracking-tight">Adicionar Número Manual</p>
                                                                    <p className="text-[10px] font-bold opacity-80">{manualJid}</p>
                                                                </div>
                                                                <ChevronRight size={20} />
                                                            </button>
                                                        )}

                                                        {filteredDestinations.map(dest => {
                                                            const isGroup = dest.remoteJid?.endsWith('@g.us');
                                                            const normalizedDest = normalizeJid(dest.remoteJid);
                                                            const currentDests = (formData.notification_destination || '').split(',').map(s => s.trim()).filter(Boolean);
                                                            const isSelected = currentDests.includes(normalizedDest);

                                                            return (
                                                                <button
                                                                    key={dest.id}
                                                                    type="button"
                                                                    onClick={() => {
                                                                        const normalized = normalizeJid(dest.remoteJid);
                                                                        setFormData(prev => {
                                                                            let current = (prev.notification_destination || '').split(',').map(s => s.trim()).filter(Boolean);
                                                                            if (current.includes(normalized)) {
                                                                                current = current.filter(id => id !== normalized);
                                                                            } else {
                                                                                current.push(normalized);
                                                                            }
                                                                            return { ...prev, notification_destination: current.join(', ') };
                                                                        });
                                                                        setDestSearchTerm('');
                                                                    }}
                                                                    className={`w-full flex items-center gap-4 p-4 rounded-2xl transition-all hover:bg-slate-50 mb-1 ${isSelected ? 'bg-blue-50/50 border border-blue-100' : 'border border-transparent'}`}
                                                                >
                                                                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm ${isGroup ? 'bg-amber-100 text-amber-600' : 'bg-blue-100 text-blue-600'}`}>
                                                                        {isGroup ? <Users size={24} /> : <User size={24} />}
                                                                    </div>
                                                                    <div className="flex-grow min-w-0 text-left">
                                                                        <p className={`text-[13px] font-black truncate uppercase tracking-tight ${isSelected ? 'text-blue-700' : 'text-slate-800'}`}>
                                                                            {dest.name || dest.subject || (isGroup ? "Canal Sombra" : "Operador Oculto")}
                                                                        </p>
                                                                        <p className="text-[10px] font-bold text-slate-400 truncate tracking-widest">{dest.remoteJid}</p>
                                                                    </div>
                                                                    {isSelected && <CheckCircle size={20} className="text-blue-600 flex-shrink-0" />}
                                                                </button>
                                                            );
                                                        })}

                                                        {filteredDestinations.length === 0 && !manualJid && (
                                                            <div className="p-8 text-center text-slate-400">
                                                                <Search size={32} className="mx-auto mb-3 opacity-20" />
                                                                <p className="text-xs font-bold uppercase tracking-widest">Nenhum destino encontrado</p>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="p-8 bg-blue-50/50 rounded-[2rem] border border-blue-100/50">
                                            <h4 className="text-xs font-black text-blue-600 uppercase tracking-widest mb-4 flex items-center gap-1.5 sm:gap-2">
                                                <Info size={14} /> Inteligência de Notificações
                                            </h4>
                                            <p className="text-[13px] text-slate-500 font-medium leading-relaxed">
                                                A Prospect AI notificará você instantaneamente quando: <br />
                                                <span className="inline-block mt-2 font-bold text-slate-900">• Um cliente demonstrar interesse crítico de compra</span><br />
                                                <span className="inline-block mt-1 font-bold text-slate-900">• Houver uma pergunta técnica que a IA não conseguiu resolver</span><br />
                                                <span className="inline-block mt-1 font-bold text-slate-900">• O atendimento for transferido para um consultor humano</span>
                                            </p>
                                        </div>
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
                                    <div className="animate-fade-in space-y-10">
                                        <div className="bg-slate-50/50 border border-slate-100 rounded-[2.5rem] overflow-hidden">
                                            <div className="px-8 py-6 bg-white/40 border-b border-white flex items-center justify-between">
                                                <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-1.5 sm:gap-2">
                                                    <Cpu size={16} className="text-blue-600" /> Parâmetros de Processamento
                                                </h3>
                                            </div>
                                            <div className="p-4 sm:p-8 space-y-6 sm:space-y-8">
                                                <div className="max-w-md">
                                                    <label className={labelClass}>Modelo de Inteligência</label>
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
                                                        <Zap size={10} className="text-amber-400" /> Recomendado para automações em massa
                                                    </p>
                                                </div>

                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-10">
                                                    <div>
                                                        <div className="flex justify-between items-center mb-4">
                                                            <label className={labelClass}>Criatividade</label>
                                                            <span className="text-xs font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">{formData.temperature}</span>
                                                        </div>
                                                        <input
                                                            type="range"
                                                            name="temperature"
                                                            min="0"
                                                            max="2"
                                                            step="0.1"
                                                            value={formData.temperature}
                                                            onChange={handleFormChange}
                                                            className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                                                        />
                                                        <div className="flex justify-between text-[10px] font-bold text-slate-400 mt-2 uppercase">
                                                            <span>Factual</span>
                                                            <span>Criativo</span>
                                                        </div>
                                                    </div>

                                                    <div>
                                                        <div className="flex justify-between items-center mb-4">
                                                            <label className={labelClass}>Diversidade (Top P)</label>
                                                            <span className="text-xs font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">{formData.top_p}</span>
                                                        </div>
                                                        <input
                                                            type="range"
                                                            name="top_p"
                                                            min="0"
                                                            max="1"
                                                            step="0.05"
                                                            value={formData.top_p}
                                                            onChange={handleFormChange}
                                                            className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                                                        />
                                                        <div className="flex justify-between text-[10px] font-bold text-slate-400 mt-2 uppercase">
                                                            <span>Focado</span>
                                                            <span>Amplo</span>
                                                        </div>
                                                    </div>

                                                    <div>
                                                        <label className={labelClass}>Top K</label>
                                                        <input
                                                            type="number"
                                                            name="top_k"
                                                            min="1"
                                                            max="50"
                                                            value={formData.top_k}
                                                            onChange={handleFormChange}
                                                            className={inputClass}
                                                        />
                                                        <p className="mt-2 text-[10px] font-bold text-slate-400 uppercase">Limita vocabulário (Padrão: 40)</p>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

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
                />
            )}
        </div>
    );
}

export default Configs;