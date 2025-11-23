import React, { useState, useEffect, useCallback } from 'react';
import api from '../api/axiosConfig';
import {
    Plus, Save, Trash2, FileText, ChevronRight, Loader2,
    Link as LinkIcon, Star, CheckCircle, Folder, Copy, Share2
} from 'lucide-react';

// --- CONFIGURAÇÃO ---
// Substitua pelo client_email do seu JSON de credenciais
const BOT_EMAIL = "integracaoapi@integracaoapi-436218.iam.gserviceaccount.com";

const initialFormData = {
    nome_config: '',
    contexto_json: null,
    arquivos_drive_json: null
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
    const [spreadsheetId, setSpreadsheetId] = useState('');
    const [syncedSheets, setSyncedSheets] = useState([]);

    // Estados Drive (Novo)
    const [driveFolderId, setDriveFolderId] = useState('');
    const [syncedFiles, setSyncedFiles] = useState([]);

    const [activeTab, setActiveTab] = useState('contexto'); // 'contexto' ou 'drive'

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

    const handleSelectConfig = (config) => {
        setSelectedConfig(config);
        setFormData({
            nome_config: config.nome_config,
            contexto_json: config.contexto_json || null,
            arquivos_drive_json: config.arquivos_drive_json || null
        });

        // Sheets
        setSpreadsheetId(config.spreadsheet_id || '');
        setSyncedSheets(config.contexto_json ? Object.keys(config.contexto_json) : []);

        // Drive
        setDriveFolderId(config.drive_id || '');
        setSyncedFiles(config.arquivos_drive_json || []);

        setActiveTab('contexto');
        setError('');
    };

    const handleNewConfig = () => {
        setSelectedConfig(null);
        setFormData(initialFormData);
        setSpreadsheetId('');
        setSyncedSheets([]);
        setDriveFolderId('');
        setSyncedFiles([]);
        setActiveTab('contexto');
        setError('');
    };

    const handleFormChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSave = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        setError('');
        const payload = {
            nome_config: formData.nome_config,
            contexto_json: formData.contexto_json,
            arquivos_drive_json: formData.arquivos_drive_json,
            spreadsheet_id: spreadsheetId,
            drive_id: driveFolderId
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
        } catch (err) {
            setError('Erro ao salvar. Verifique os campos.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (id) => {
        if (window.confirm('Tem certeza que deseja excluir esta configuração?')) {
            try {
                await api.delete(`/configs/${id}`);
                await fetchData();
                handleNewConfig();
            } catch (err) {
                setError('Erro ao excluir. Esta configuração pode estar em uso como padrão.');
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
    };

    // --- Sync Sheets ---
    const handleSyncSheet = async () => {
        if (!selectedConfig) return alert("Salve a configuração antes de sincronizar.");
        if (!spreadsheetId) return alert("Insira o ID ou Link da planilha.");

        setIsSyncing(true);
        setError('');
        try {
            const payload = { config_id: selectedConfig.id, spreadsheet_id: spreadsheetId };
            const response = await api.post('/configs/sync_sheet', payload);

            setSyncedSheets(Object.keys(response.data.contexto_json) || []);
            // Atualiza o form data localmente para garantir integridade ao salvar depois
            setFormData(prev => ({ ...prev, contexto_json: response.data.contexto_json }));

            alert(`Sucesso! ${response.data.sheets_found.length} abas encontradas.`);
        } catch (err) {
            setError(err.response?.data?.detail || 'Falha ao sincronizar. Verifique se compartilhou a planilha com o e-mail do robô.');
        } finally {
            setIsSyncing(false);
        }
    };

    // --- Sync Drive ---
    const handleSyncDrive = async () => {
        if (!selectedConfig) return alert("Salve a configuração antes de sincronizar.");
        if (!driveFolderId) return alert("Insira o ID da pasta do Drive.");

        setIsSyncing(true);
        setError('');
        try {
            const payload = { config_id: selectedConfig.id, drive_id: driveFolderId };
            const response = await api.post('/configs/sync_drive', payload);

            // A resposta agora é um objeto com a árvore de arquivos
            const driveData = response.data.arquivos_drive_json || {};

            // A função de renderização espera uma lista simples de arquivos,
            // então vamos extrair os arquivos da raiz para exibição.
            // A estrutura completa (com subpastas) é salva no `formData`.
            const rootFiles = driveData.arquivos || [];
            setSyncedFiles(rootFiles);

            // Atualiza o form data localmente
            setFormData(prev => ({ ...prev, arquivos_drive_json: driveData }));

            alert(`Sucesso! ${response.data.files_count} arquivos encontrados.`);
        } catch (err) {
            setError(err.response?.data?.detail || 'Falha ao sincronizar Drive. Verifique o ID e o compartilhamento.');
        } finally {
            setIsSyncing(false);
        }
    };

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
                                <input type="text" placeholder="Dê um nome para esta Configuração..." name="nome_config" value={formData.nome_config} onChange={handleFormChange} required className="w-full text-2xl font-bold text-gray-800 border-b-2 border-gray-200 focus:border-brand-blue focus:outline-none py-2 bg-transparent" />
                            </div>

                            {/* Abas */}
                            <div className="flex border-b border-gray-200 mb-6">
                                <button type="button" onClick={() => setActiveTab('contexto')} className={`flex items-center gap-2 px-4 py-3 font-semibold transition-all ${activeTab === 'contexto' ? 'border-b-2 border-brand-blue text-brand-blue' : 'text-gray-500 hover:text-gray-800'}`}>
                                    <LinkIcon size={18} /> Contexto (Sheets)
                                </button>
                                <button type="button" onClick={() => setActiveTab('drive')} className={`flex items-center gap-2 px-4 py-3 font-semibold transition-all ${activeTab === 'drive' ? 'border-b-2 border-brand-blue text-brand-blue' : 'text-gray-500 hover:text-gray-800'}`}>
                                    <Folder size={18} /> Arquivos (Drive)
                                </button>
                            </div>

                            {error && (
                                <div className="mb-4 p-3 bg-red-50 text-red-700 rounded border border-red-200 text-sm">
                                    {error}
                                </div>
                            )}

                            {/* CONTEÚDO ABA: SHEETS */}
                            {activeTab === 'contexto' && (
                                <div className="animate-fade-in space-y-6">
                                    <div>
                                        <label htmlFor="spreadsheetId" className={labelClass}>Link ou ID da Planilha</label>
                                        <div className="flex items-center gap-4">
                                            <input id="spreadsheetId" name="spreadsheetId" value={spreadsheetId} onChange={(e) => setSpreadsheetId(e.target.value)} className={inputClass} placeholder="https://docs.google.com/spreadsheets/d/..." />
                                            <button type="button" onClick={handleSyncSheet} disabled={isSyncing || !selectedConfig} className="flex items-center gap-2 bg-brand-blue text-white font-bold py-2 px-6 rounded-lg shadow-md hover:bg-brand-blue-dark transition-all disabled:bg-gray-400 disabled:cursor-not-allowed">
                                                {isSyncing ? <Loader2 className="animate-spin" size={20} /> : "Sincronizar"}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Instruções de Compartilhamento (Sheets) */}
                                    <div className="p-4 bg-blue-50 rounded-lg border border-blue-100 text-sm text-gray-700 space-y-4">
                                        <div className="flex items-center gap-2 font-semibold text-blue-800">
                                            <Share2 size={18} />
                                            <h4>Como conectar sua planilha</h4>
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
                                            <li>Volte para a Planilha e copie o <strong>ID da URL:</strong></li>
                                            <li> Ex: /spreadsheets/d/<strong>1BxiMVs0XRA5nFMdKVBdBNj...</strong>/edit</li>
                                            <li> Cole o link copiado no campo acima. </li>
                                        </ol>
                                    </div>

                                    {syncedSheets.length > 0 && (
                                        <div className="p-4 bg-green-50 rounded-lg border border-green-200 animate-fade-in">
                                            <div className="flex items-center gap-2">
                                                <CheckCircle className="text-green-600" size={20} />
                                                <p className="font-semibold text-green-800">Contexto Sincronizado!</p>
                                            </div>
                                            <div className="flex flex-wrap gap-2 mt-3">
                                                {syncedSheets.map(sheetName => (
                                                    <span key={sheetName} className="px-3 py-1 bg-green-200 text-green-900 text-xs font-medium rounded-full">
                                                        {sheetName}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* CONTEÚDO ABA: DRIVE */}
                            {activeTab === 'drive' && (
                                <div className="animate-fade-in space-y-6">
                                    <div>
                                        <label htmlFor="driveFolderId" className={labelClass}>ID da Pasta do Google Drive</label>
                                        <div className="flex items-center gap-4">
                                            <input id="driveFolderId" name="driveFolderId" value={driveFolderId} onChange={(e) => setDriveFolderId(e.target.value)} className={inputClass} placeholder="Ex: 1BxiMVs0XRA5nFMdKVBdBNj..." />
                                            <button type="button" onClick={handleSyncDrive} disabled={isSyncing || !selectedConfig} className="flex items-center gap-2 bg-brand-blue text-white font-bold py-2 px-6 rounded-lg shadow-md hover:bg-brand-blue-dark transition-all disabled:bg-gray-400 disabled:cursor-not-allowed">
                                                {isSyncing ? <Loader2 className="animate-spin" size={20} /> : "Sincronizar"}
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
                                            <li>Volte para a pasta e copie o <strong>ID final da URL</strong></li>
                                            <li> Ex: /drive/folders/<strong>1BxiMVs0XRA5nFMdKVBdBNj...</strong> </li>
                                            <li> Cole o link copiado no campo acima. </li>
                                        </ol>
                                    </div>

                                    {/* --- CORREÇÃO AQUI --- */}
                                    {/* Verifica se o objeto da árvore existe e se tem arquivos ou subpastas */}
                                    {formData.arquivos_drive_json && (formData.arquivos_drive_json.arquivos?.length > 0 || formData.arquivos_drive_json.subpastas?.length > 0) ? (
                                        <div className="p-4 bg-green-50 rounded-lg border border-gray-200 animate-fade-in">
                                            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-100">
                                                <CheckCircle className="text-green-600" size={20} />
                                                <p className="font-semibold text-gray-700">Arquivos Sincronizados</p>
                                            </div>
                                            {/* A função recursiva para renderizar a árvore */}
                                            <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar pr-2 text-sm">
                                                <RenderDriveTree node={formData.arquivos_drive_json} />
                                            </div>
                                        </div>
                                    ) : (
                                        driveFolderId && !isSyncing && (
                                            <div className="text-center py-6 text-gray-400 border-2 border-dashed border-gray-200 rounded-lg">
                                                <Folder size={32} className="mx-auto mb-2 opacity-20" />
                                                <p className="text-sm">Nenhum arquivo sincronizado ainda.</p>
                                            </div>
                                        )
                                    )}
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

// --- NOVO COMPONENTE AUXILIAR ---
// Componente recursivo para renderizar a árvore de arquivos do Drive
const RenderDriveTree = ({ node }) => {
    if (!node || (!node.arquivos?.length && !node.subpastas?.length)) {
        return null;
    }

    return (
        <div className="pl-4 border-l border-gray-200">
            {/* Renderiza arquivos na pasta atual */}
            {node.arquivos?.map(file => (
                <div key={file.id} className="flex items-center gap-2 py-1">
                    <FileText size={14} className="text-gray-400 flex-shrink-0" />
                    <span className="text-gray-700">{file.nome}</span>
                </div>
            ))}

            {/* Renderiza subpastas recursivamente */}
            {node.subpastas?.map(subfolder => (
                <div key={subfolder.nome} className="mt-2">
                    <div className="flex items-center gap-2 font-semibold text-gray-800">
                        <Folder size={16} className="text-gray-800" />
                        {subfolder.nome}
                    </div>
                    {/* Chamada recursiva */}
                    <RenderDriveTree node={subfolder} />
                </div>
            ))}
        </div>
    );
};

export default Configs;