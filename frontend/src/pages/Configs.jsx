import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import api from '../api/axiosConfig';
import toast from 'react-hot-toast';
import {
    Plus, Save, Trash2, FileText, ChevronRight, Loader2,
    Link as LinkIcon, Star, CheckCircle, Folder, Copy, Share2, Database, ExternalLink, Bell, RefreshCw, Check, 
    Calendar, Clock, X,
    Search, User, Users
} from 'lucide-react';

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
    is_calendar_active: false
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

    const handleSelectConfig = (config) => {
        setSelectedConfig(config);
        setFormData({
            nome_config: config.nome_config,
            contexto_json: config.contexto_json || null,
            arquivos_drive_json: config.arquivos_drive_json || null,
            notification_active: config.notification_active || false,
            notification_destination: config.notification_destination || '',
            is_calendar_connected: !!config.google_calendar_credentials,
            is_calendar_active: config.is_calendar_active || false
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

        setActiveTab('system');
        setError('');
    };

    const handleNewConfig = () => {
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
    };

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
            is_calendar_active: formData.is_calendar_active
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
        if (code && pendingId) {
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
        }
    }, [fetchData]);

    const handleDelete = async (id) => {
        if (window.confirm('Tem certeza que deseja excluir esta configuração?')) {
            try {
                await api.delete(`/configs/${id}`);
                await fetchData();
                handleNewConfig();
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
                timeout: 1200000 // 20 minutos para planilhas grandes
            });

            if (type === 'system') {
                // Atualiza o form data localmente para garantir integridade ao salvar depois
                setFormData(prev => ({ ...prev, contexto_json: null }));
            }

            toast.success(`Sucesso! ${response.data.sheets_found.length} abas sincronizadas (${type.toUpperCase()}).`);
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
                timeout: 1200000 // 20 minutos para pastas grandes
            });

            const filesCount = response.data.files_found || 0;

            // Atualiza o form data localmente
            setFormData(prev => ({ ...prev, arquivos_drive_json: null }));

            // Conta total de arquivos recursivamente para exibir no Toast
            const countFiles = (node) => {
                let count = node.arquivos?.length || 0;
                node.subpastas?.forEach(sub => count += countFiles(sub));
                return count;
            };

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
    const inputClass = "w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-blue resize-none";

    return (
        <div className="p-6 md:p-10 bg-gray-50 h-full flex flex-col">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-gray-800">Configurações de Contexto</h1>
                <p className="text-gray-500 mt-1">Crie e gerencie as configurações de contexto para a sua IA.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1 min-h-0">
                {/* SIDEBAR */}
                <div className="lg:col-span-1 bg-white p-6 rounded-xl shadow-lg border flex flex-col">
                    <button onClick={handleNewConfig} className="w-full flex items-center justify-center gap-2 bg-brand-blue text-white font-bold py-3 px-4 rounded-lg shadow-md hover:bg-brand-blue-dark transition mb-6">
                        <Plus size={20} /> Nova Configuração
                    </button>
                    <h2 className="text-lg font-semibold text-gray-700 mb-3 px-1">Configurações Salvas</h2>
                    {isLoading ? <p className="text-center text-gray-500">A carregar...</p> : (
                        <ul className="space-y-2 overflow-y-auto custom-scrollbar pr-1">
                            {configs.map(config => (
                                <li key={config.id} className="flex items-center gap-2">
                                    <button onClick={() => handleSetDefault(config.id)} title="Definir como padrão">
                                        <Star size={20} className={`transition-colors ${userData?.default_persona_id === config.id ? 'text-yellow-400 fill-current' : 'text-gray-300 hover:text-yellow-400'}`} />
                                    </button>
                                    <button onClick={() => handleSelectConfig(config)} className={`w-full text-left p-3 rounded-lg flex justify-between items-center transition-all duration-200 ${selectedConfig?.id === config.id ? 'bg-brand-blue text-white font-semibold shadow-sm' : 'hover:bg-gray-100 hover:pl-4'}`}>
                                        <span className="truncate pr-2">{config.nome_config}</span>
                                        <ChevronRight size={18} />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                {/* MAIN CONTENT */}
                <div className="lg:col-span-2 bg-white p-6 md:p-8 rounded-xl shadow-lg border overflow-y-auto">
                    <form onSubmit={handleSave} className="flex flex-col h-full">
                        <div className="flex-grow">
                            {/* Título */}
                            <div className="flex items-center gap-4 mb-6">
                                <FileText className="text-brand-blue" size={32} />
                                <input type="text" placeholder="Dê um nome para esta Configuração..." name="nome_config" value={formData.nome_config} onChange={handleFormChange} required className="w-full text-2xl font-bold text-gray-800 border-b-2 border-gray-200 focus:border-brand-green focus:outline-none py-2 bg-transparent" />
                            </div>

                            {/* Abas */}
                            <div className="flex border-b border-gray-200 mb-6">
                                <button type="button" onClick={() => setActiveTab('system')} className={`flex items-center gap-2 px-4 py-3 font-semibold transition-all ${activeTab === 'system' ? 'border-b-2 border-brand-green text-brand-blue' : 'text-gray-500 hover:text-gray-800'}`}>
                                    <LinkIcon size={18} /> Instruções (System)
                                </button>
                                <button type="button" onClick={() => setActiveTab('rag')} className={`flex items-center gap-2 px-4 py-3 font-semibold transition-all ${activeTab === 'rag' ? 'border-b-2 border-brand-green text-brand-blue' : 'text-gray-500 hover:text-gray-800'}`}>
                                    <Database size={18} /> Conhecimento (RAG)
                                </button>
                                <button type="button" onClick={() => setActiveTab('drive')} className={`flex items-center gap-2 px-4 py-3 font-semibold transition-all ${activeTab === 'drive' ? 'border-b-2 border-brand-green text-brand-blue' : 'text-gray-500 hover:text-gray-800'}`}>
                                    <Folder size={18} /> Arquivos (Drive)
                                </button>
                                <button type="button" onClick={() => setActiveTab('notifications')} className={`flex items-center gap-2 px-4 py-3 font-semibold transition-all ${activeTab === 'notifications' ? 'border-b-2 border-brand-green text-brand-blue' : 'text-gray-500 hover:text-gray-800'}`}>
                                    <Bell size={18} /> Notificações
                                </button>
                                <button type="button" onClick={() => setActiveTab('agenda')} className={`flex items-center gap-2 px-4 py-3 font-semibold transition-all ${activeTab === 'agenda' ? 'border-b-2 border-brand-green text-brand-blue' : 'text-gray-500 hover:text-gray-800'}`}>
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
                                    <div>
                                        <label htmlFor="spreadsheetId" className={labelClass}>Link da Planilha de Instruções</label>
                                        <div className="flex items-center gap-4">
                                            <input id="spreadsheetId" name="spreadsheetId" value={spreadsheetId} onChange={(e) => setSpreadsheetId(extractId(e.target.value))} className={inputClass} placeholder="Cole o Link da Planilha aqui..." />
                                            <button type="button" onClick={() => handleSyncSheet('system')} disabled={isSyncing || !selectedConfig} className="flex items-center gap-2 bg-brand-blue text-white font-bold py-2 px-6 rounded-lg shadow-md hover:bg-brand-blue-dark transition-all disabled:bg-gray-400 disabled:cursor-not-allowed">
                                                {isSyncing ? <Loader2 className="animate-spin" size={20} /> : "Sincronizar"}
                                            </button>
                                            <button type="button" onClick={() => openResource(spreadsheetId, 'sheet')} disabled={!spreadsheetId} className="p-2 text-gray-500 hover:text-brand-blue transition-colors disabled:opacity-50" title="Abrir no Navegador">
                                                <ExternalLink size={24} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Instruções de Compartilhamento (Sheets) */}
                                    <div className="p-4 bg-blue-50 rounded-lg border border-blue-100 text-sm text-gray-700 space-y-4">
                                        <div className="flex items-center gap-2 font-semibold text-blue-800">
                                            <Share2 size={18} />
                                            <h4>Como conectar sua planilha de Instruções</h4>
                                        </div>

                                        <ol className="list-decimal list-inside space-y-2 text-gray-600">
                                            <li>Abra sua planilha no Google Sheets.</li>
                                            <li>Clique no botão <strong>Compartilhar</strong>.</li>
                                            <li>
                                                Cole o seguinte e-mail:
                                                <button
                                                    type="button"
                                                    onClick={handleCopyEmail}
                                                    className="inline-flex items-center gap-1.5 ml-1 px-1 py-0.5 font-bold align-middle"
                                                    title="Clique para copiar"
                                                >
                                                    {BOT_EMAIL} <Copy size={14} strokeWidth={3} />
                                                </button>
                                            </li>
                                            <li>Defina ele como <strong>Leitor</strong> e salve.</li>
                                            <li>Volte para a Planilha e copie a <strong>URL</strong> do navegador e cole acima ↑</li>
                                            <li> <strong>Dica:</strong> Use esta planilha para definir Persona, Regras de Negócio e Etapas de Venda.</li>
                                        </ol>
                                    </div>
                                </div>
                            )}

                            {/* CONTEÚDO ABA: RAG (CONHECIMENTO) */}
                            {activeTab === 'rag' && (
                                <div className="animate-fade-in space-y-6">
                                    <div>
                                        <label htmlFor="spreadsheetRagId" className={labelClass}>Link da Planilha de Conhecimento</label>
                                        <div className="flex items-center gap-4">
                                            <input id="spreadsheetRagId" name="spreadsheetRagId" value={spreadsheetRagId} onChange={(e) => setSpreadsheetRagId(extractId(e.target.value))} className={inputClass} placeholder="Cole o Link da Planilha aqui..." />
                                            <button type="button" onClick={() => handleSyncSheet('rag')} disabled={isSyncing || !selectedConfig} className="flex items-center gap-2 bg-brand-blue text-white font-bold py-2 px-6 rounded-lg shadow-md hover:bg-brand-blue-dark transition-all disabled:bg-gray-400 disabled:cursor-not-allowed">
                                                {isSyncing ? <Loader2 className="animate-spin" size={20} /> : "Sincronizar"}
                                            </button>
                                            <button type="button" onClick={() => openResource(spreadsheetRagId, 'sheet')} disabled={!spreadsheetRagId} className="p-2 text-gray-500 hover:text-brand-blue transition-colors disabled:opacity-50" title="Abrir no Navegador">
                                                <ExternalLink size={24} />
                                            </button>
                                        </div>
                                    </div>

                                    <div className="p-4 bg-blue-50 rounded-lg border border-blue-100 text-sm text-gray-700 space-y-4">
                                        <div className="flex items-center gap-2 font-semibold text-brand-blue">
                                            <Database size={18} />
                                            <h4>Base de Conhecimento (RAG)</h4>
                                        </div>

                                        <ol className="list-decimal list-inside space-y-2 text-gray-600">
                                            <li>Siga o mesmo processo de compartilhamento com o email do bot.</li>
                                            <li>Use esta planilha para dados volumosos: <strong>Catálogo de Produtos, Tabela de Preços, FAQ, Lista de Serviços.</strong></li>
                                            <li>O sistema irá ler todas as abas e transformar em vetores de busca.</li>
                                            <li>Isso permite que a IA encontre informações específicas sem sobrecarregar o prompt principal.</li>
                                        </ol>
                                    </div>
                                </div>
                            )}

                            {/* CONTEÚDO ABA: DRIVE */}
                            {activeTab === 'drive' && (
                                <div className="animate-fade-in space-y-6">
                                    <div>
                                        <label htmlFor="driveFolderId" className={labelClass}>Link da Pasta do Google Drive</label>
                                        <div className="flex items-center gap-4">
                                            <input id="driveFolderId" name="driveFolderId" value={driveFolderId} onChange={(e) => setDriveFolderId(extractId(e.target.value))} className={inputClass} placeholder="Cole o Link da Pasta aqui..." />
                                            <button type="button" onClick={handleSyncDrive} disabled={isSyncing || !selectedConfig} className="flex items-center gap-2 bg-brand-blue text-white font-bold py-2 px-6 rounded-lg shadow-md hover:bg-brand-blue-dark transition-all disabled:bg-gray-400 disabled:cursor-not-allowed">
                                                {isSyncing ? <Loader2 className="animate-spin" size={20} /> : "Sincronizar"}
                                            </button>
                                            <button type="button" onClick={() => openResource(driveFolderId, 'drive')} disabled={!driveFolderId} className="p-2 text-gray-500 hover:text-brand-blue transition-colors disabled:opacity-50" title="Abrir no Navegador">
                                                <ExternalLink size={24} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Instruções de Compartilhamento (Drive) */}
                                    <div className="p-4 bg-indigo-50 rounded-lg border border-indigo-100 text-sm text-gray-700 space-y-4">
                                        <div className="flex items-center gap-2 font-semibold text-indigo-800">
                                            <Share2 size={18} />
                                            <h4>Como conectar sua pasta</h4>
                                        </div>

                                        <ol className="list-decimal list-inside space-y-2 text-gray-600">
                                            <li>Vá no Google Drive e clique com botão direito na pasta.</li>
                                            <li>Clique em <strong>Compartilhar</strong>.</li>
                                            <li>
                                                Cole o seguinte e-mail:
                                                <button
                                                    type="button"
                                                    onClick={handleCopyEmail}
                                                    className="inline-flex items-center gap-1.5 ml-1 px-1 py-0.5 font-bold align-middle"
                                                    title="Clique para copiar"
                                                >
                                                    {BOT_EMAIL} <Copy size={14} strokeWidth={3} />
                                                </button>
                                            </li>
                                            <li>Defina ele como <strong>Leitor</strong> e salve.</li>
                                            <li>Volte para a pasta e copie o <strong>Link (URL)</strong> do navegador</li>
                                            <li> Ex: https://drive.google.com/drive/folders/<strong>1BxiMVs0XRA5nFMdKVBdBNj...</strong> </li>
                                            <li> Cole o link copiado no campo acima. </li>
                                        </ol>
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
                                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-green focus:ring-offset-2 ${formData.notification_active ? 'bg-brand-blue' : 'bg-gray-200'}`}
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
                                                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${isGroup ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>
                                                                        {isGroup ? <Users size={20} /> : <User size={20} />}
                                                                    </div>
                                                                    <div className="flex-grow min-w-0">
                                                                        <p className={`text-sm font-semibold truncate ${isSelected ? 'text-blue-700' : 'text-gray-800'}`}>
                                                                            {dest.name || dest.subject || (isGroup ? "Grupo sem nome" : "Contato sem nome")}
                                                                        </p>
                                                                        <p className="text-xs text-gray-500 truncate">{dest.remoteJid}</p>
                                                                    </div>
                                                                    {isSelected && <CheckCircle size={18} className="text-blue-600 flex-shrink-0" />}
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
                                                                <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-green-100 text-green-600">
                                                                    <Plus size={20} />
                                                                </div>
                                                                <div className="flex-grow min-w-0">
                                                                    <p className="text-sm font-semibold text-gray-800">Adicionar número manualmente</p>
                                                                    <p className="text-xs text-gray-500 truncate">{manualJid}</p>
                                                                </div>
                                                                {formData.notification_destination === manualJid && <CheckCircle size={18} className="text-blue-600 flex-shrink-0" />}
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

                                    {/* Instruções */}
                                    <div className="p-4 bg-blue-50 rounded-lg border border-blue-100 text-sm text-gray-700 space-y-4">
                                        <div className="flex items-center gap-2 font-semibold text-blue-800">
                                            <Bell size={18} />
                                            <h4>Como funciona a Integração</h4>
                                        </div>
                                        <p className="text-gray-600">
                                            Ao habilitar esta opção, o sistema enviará alertas automáticos para o número ou grupo selecionado acima.
                                        </p>
                                        <ol className="list-decimal list-inside space-y-2 text-gray-600">
                                            <li>Ative a chave "Habilitar" acima.</li>
                                            <li>Escolha um destino na lista ou insira o ID manualmente.</li>
                                            <li>Clique em <strong>Guardar Configuração</strong> no final da página para aplicar.</li>
                                        </ol>
                                    </div>
                                </div>
                            )}

                            {/* CONTEÚDO ABA: AGENDA */}
                            {activeTab === 'agenda' && (
                                <div className="animate-fade-in space-y-6">
                                    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
                                        <div className="flex items-center gap-4">
                                            <Calendar className={formData.is_calendar_connected ? "text-green-600" : "text-gray-400"} size={24} />
                                            <div>
                                                <p className="text-sm font-bold text-gray-800">{formData.is_calendar_connected ? "Google Agenda Conectado" : "Google Agenda não conectado"}</p>
                                                <p className="text-xs text-gray-500">Sincronize eventos para evitar conflitos.</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <span className="text-xs font-semibold text-gray-600">Ativar na IA</span>
                                            <button type="button" onClick={() => setFormData(p => ({...p, is_calendar_active: !p.is_calendar_active}))} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formData.is_calendar_active ? 'bg-brand-blue' : 'bg-gray-200'}`}>
                                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.is_calendar_active ? 'translate-x-6' : 'translate-x-1'}`} />
                                            </button>
                                            {!formData.is_calendar_connected ? (
                                                <button type="button" onClick={handleConnectCalendar} className="px-4 py-2 bg-brand-blue text-white text-xs font-bold rounded-md hover:bg-brand-blue-dark transition">Conectar</button>
                                            ) : (
                                                <button type="button" onClick={() => api.post(`/configs/google-calendar/${selectedConfig.id}/disconnect`).then(() => fetchData())} className="px-4 py-2 bg-red-100 text-red-700 text-xs font-bold rounded-md hover:bg-red-200 transition">Desconectar</button>
                                            )}
                                        </div>
                                    </div>

                                    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                                        <div className="p-4 bg-gray-50 border-b border-gray-200">
                                            <h3 className="font-bold text-gray-700 flex items-center gap-2"><Clock size={18} className="text-brand-blue" /> Horários de Atendimento</h3>
                                        </div>
                                        <div className="p-4 space-y-2">
                                            {['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'].map(day => (
                                                <div key={day} className="flex items-start gap-3 py-2 border-b border-gray-100 last:border-0">
                                                    <div className="w-24 pt-1.5 flex-shrink-0">
                                                        <label className="flex items-center cursor-pointer">
                                                            <div className="relative">
                                                                <input type="checkbox" className="sr-only" checked={schedule[day]?.active || false} onChange={() => toggleDay(day)} />
                                                                <div className={`block w-8 h-5 rounded-full transition-colors ${schedule[day]?.active ? 'bg-brand-blue' : 'bg-gray-300'}`}></div>
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
                                                                <button type="button" onClick={() => addTimeBlock(day)} className="p-1 text-brand-blue hover:bg-blue-50 rounded transition-colors"><Plus size={18} /></button>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex justify-end items-center gap-4 pt-6 mt-auto">
                            {selectedConfig && (<button type="button" onClick={() => handleDelete(selectedConfig.id)} className="font-semibold text-red-600 hover:text-red-800 flex items-center gap-2 mr-auto mb-6"><Trash2 size={16} /> Excluir</button>)}
                            <button type="submit" disabled={isSaving} className="flex items-center gap-2 bg-brand-blue text-white font-bold py-2 px-6 rounded-lg shadow-md hover:bg-brand-blue-dark transition-all disabled:bg-gray-400 disabled:shadow-none mb-6">
                                {isSaving ? <><Loader2 className="animate-spin" size={20} /> A guardar...</> : <><Save size={20} /> Guardar Configuração</>}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}

export default Configs;