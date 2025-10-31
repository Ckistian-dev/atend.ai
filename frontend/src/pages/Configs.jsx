import React, { useState, useEffect, useCallback } from 'react';
import api from '../api/axiosConfig';
import TextareaAutosize from 'react-textarea-autosize';
import {
    Plus, Save, Trash2, FileText, ChevronRight, Loader2, X,
    User as UserIcon, Bot, Link as LinkIcon, Star, CheckCircle,
    Palette, // <-- NOVO ÍCONE
    PlusCircle // <-- NOVO ÍCONE
} from 'lucide-react';

const initialFormData = {
    nome_config: '',
    prompt_config: {
        nome_persona: '',
        empresa_persona: '',
        perfil_persona: '',
        objetivo_persona: '',
    },
    contexto_json: null
};

// --- NOVO: Componente para a Aba de Situações ---
const SituacoesTab = ({ situacoes, setSituacoes }) => {

    const handleAddSituacao = () => {
        // Adiciona um valor padrão vibrante para a cor
        const randomColor = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
        setSituacoes([...situacoes, { nome: '', cor: randomColor }]);
    };

    const handleSituacaoChange = (index, field, value) => {
        const newSituacoes = [...situacoes];
        newSituacoes[index][field] = value;
        setSituacoes(newSituacoes);
    };

    const handleRemoveSituacao = (index) => {
        const newSituacoes = situacoes.filter((_, i) => i !== index);
        setSituacoes(newSituacoes);
    };

    return (
        <div className="animate-fade-in space-y-4">
            <div className="p-4 bg-gray-50 rounded-lg border text-sm text-gray-600">
                <h4 className="font-semibold text-gray-800">Gerenciar Situações</h4>
                <p className="mt-1">
                    Crie as situações (status) que a IA poderá atribuir a um atendimento.
                    Estas situações e suas cores aparecerão nas telas de Atendimento.
                </p>
            </div>
            
            <div className="space-y-3">
                {situacoes.map((situacao, index) => (
                    <div key={index} className="flex items-center gap-3 p-3 bg-white border rounded-lg shadow-sm">
                        <input
                            type="color"
                            value={situacao.cor}
                            onChange={(e) => handleSituacaoChange(index, 'cor', e.target.value)}
                            className="w-10 h-10 border-none rounded cursor-pointer"
                            title="Escolher cor"
                        />
                        <input
                            type="text"
                            placeholder="Nome da Situação (Ex: Aguardando Pagamento)"
                            value={situacao.nome}
                            onChange={(e) => handleSituacaoChange(index, 'nome', e.target.value)}
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-blue"
                        />
                        <button
                            type="button"
                            onClick={() => handleRemoveSituacao(index)}
                            className="p-2 text-gray-400 hover:text-red-600 transition-colors"
                            title="Remover situação"
                        >
                            <Trash2 size={18} />
                        </button>
                    </div>
                ))}
            </div>

            <button
                type="button"
                onClick={handleAddSituacao}
                className="flex items-center gap-2 text-sm font-semibold text-brand-blue hover:text-brand-blue-dark transition-colors"
            >
                <PlusCircle size={18} />
                Adicionar Nova Situação
            </button>
        </div>
    );
};

function Configs() {
    const [configs, setConfigs] = useState([]);
    const [selectedConfig, setSelectedConfig] = useState(null);
    const [formData, setFormData] = useState(initialFormData);
    const [userData, setUserData] = useState(null);

    const [situacoes, setSituacoes] = useState([]);

    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [error, setError] = useState('');

    const [spreadsheetId, setSpreadsheetId] = useState('');
    const [activeTab, setActiveTab] = useState('persona');
    const [syncedSheets, setSyncedSheets] = useState([]);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [configsRes, userRes] = await Promise.all([
                api.get('/configs/'),
                api.get('/auth/me')
            ]);
            setConfigs(configsRes.data);
            setUserData(userRes.data);
            setSpreadsheetId(userRes.data.spreadsheet_id || '');
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
        const prompt_config = config.prompt_config || {};
        setFormData({
            nome_config: config.nome_config,
            prompt_config: {
                nome_persona: prompt_config.nome_persona || '',
                empresa_persona: prompt_config.empresa_persona || '',
                perfil_persona: prompt_config.perfil_persona || '',
                objetivo_persona: prompt_config.objetivo_persona || '',
            },
            contexto_json: config.contexto_json || null
        });
        setSyncedSheets(config.contexto_json ? Object.keys(config.contexto_json) : []);
        setSituacoes(config.situacoes_disponiveis || []);
        setActiveTab('persona');
    };

    const handleNewConfig = () => {
        setSelectedConfig(null);
        setFormData(initialFormData);
        setSyncedSheets([]);
        setSituacoes([]);
        setActiveTab('persona');
    };

    const handleFormChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, prompt_config: { ...prev.prompt_config, [name]: value } }));
    };

    const handleSave = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        setError('');
        const payload = {
            nome_config: formData.nome_config,
            prompt_config: formData.prompt_config,
            situacoes_disponiveis: situacoes
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
        if (window.confirm('Tem certeza que deseja excluir esta persona?')) {
            try {
                await api.delete(`/configs/${id}`);
                await fetchData();
                handleNewConfig();
            } catch (err) {
                setError('Erro ao excluir. Esta persona pode estar em uso como padrão.');
            }
        }
    };

    const handleSetDefault = async (configId) => {
        if (userData?.default_persona_id === configId) return;
        try {
            await api.put('/users/me', { default_persona_id: configId });
            await fetchData();
        } catch (err) {
            setError('Erro ao definir a persona padrão.');
        }
    };

    const handleSyncSheet = async () => {
        if (!selectedConfig) {
            alert("Por favor, selecione ou salve uma persona para associar o contexto.");
            return;
        }
        if (!spreadsheetId) {
            alert("Por favor, insira o link da planilha.");
            return;
        }
        setIsSyncing(true);
        setError('');
        try {
            const payload = { config_id: selectedConfig.id, spreadsheet_id: spreadsheetId };
            const response = await api.post('/configs/sync_sheet', payload);
            await fetchData();
            setSyncedSheets(response.data.sheets_found || []);
            alert(`Planilha sincronizada com sucesso! Abas encontradas: ${response.data.sheets_found.join(', ')}`);
        } catch (err) {
            setError(err.response?.data?.detail || 'Falha ao sincronizar a planilha. Verifique o link e as permissões de publicação.');
        } finally {
            setIsSyncing(false);
        }
    };

    const labelClass = "block text-sm font-semibold text-gray-700 mb-1";
    const inputClass = "w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-blue resize-none";

    return (
        <div className="p-6 md:p-10 bg-gray-50 h-full flex flex-col">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-gray-800">Persona & Contexto</h1>
                <p className="text-gray-500 mt-1">Crie as personalidades da sua IA e alimente-as com conhecimento.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1 min-h-0">
                <div className="lg:col-span-1 bg-white p-6 rounded-xl shadow-lg border flex flex-col">
                    <button onClick={handleNewConfig} className="w-full flex items-center justify-center gap-2 bg-brand-blue text-white font-bold py-3 px-4 rounded-lg shadow-md hover:bg-brand-blue-dark transition mb-6">
                        <Plus size={20} /> Nova Persona
                    </button>
                    <h2 className="text-lg font-semibold text-gray-700 mb-3 px-1">Personas Salvas</h2>
                    {isLoading ? <p className="text-center text-gray-500">A carregar...</p> : (
                        <ul className="space-y-2 overflow-y-auto">
                            {configs.map(config => (
                                <li key={config.id} className="flex items-center gap-2">
                                    <button onClick={() => handleSetDefault(config.id)} title="Definir como padrão para novos contatos">
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

                <div className="lg:col-span-2 bg-white p-6 md:p-8 rounded-xl shadow-lg border overflow-y-auto">
                    <form onSubmit={handleSave} className="flex flex-col h-full">
                        <div className="flex-grow">
                            <div className="flex items-center gap-4 mb-6">
                                <FileText className="text-brand-blue" size={32} />
                                <input type="text" placeholder="Dê um nome para esta Persona..." name="nome_config" value={formData.nome_config} onChange={e => setFormData({ ...formData, nome_config: e.target.value })} required className="w-full text-2xl font-bold text-gray-800 border-b-2 border-gray-200 focus:border-brand-blue focus:outline-none py-2 bg-transparent" />
                            </div>
                            <div className="flex border-b border-gray-200 mb-6">
                                <button type="button" onClick={() => setActiveTab('persona')} className={`flex items-center gap-2 px-4 py-3 font-semibold transition-all ${activeTab === 'persona' ? 'border-b-2 border-brand-blue text-brand-blue' : 'text-gray-500 hover:text-gray-800'}`}>
                                    <UserIcon size={18} /> Persona
                                </button>
                                <button type="button" onClick={() => setActiveTab('contexto')} className={`flex items-center gap-2 px-4 py-3 font-semibold transition-all ${activeTab === 'contexto' ? 'border-b-2 border-brand-blue text-brand-blue' : 'text-gray-500 hover:text-gray-800'}`}>
                                    <LinkIcon size={18} /> Contexto (Google Sheets)
                                </button>
                                <button type="button" onClick={() => setActiveTab('situacoes')} className={`flex items-center gap-2 px-4 py-3 font-semibold transition-all ${activeTab === 'situacoes' ? 'border-b-2 border-brand-blue text-brand-blue' : 'text-gray-500 hover:text-gray-800'}`}>
                                    <Palette size={18} /> Situações Disponíveis
                                </button>
                            </div>

                            {activeTab === 'persona' && (
                                <div className="space-y-6 animate-fade-in">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div><label htmlFor="nome_persona" className={labelClass}>Nome da Persona</label><input id="nome_persona" name="nome_persona" value={formData.prompt_config.nome_persona} onChange={handleFormChange} required className={inputClass} placeholder="Ex: Alex, especialista em vendas" /></div>
                                        <div><label htmlFor="empresa_persona" className={labelClass}>Empresa da Persona</label><input id="empresa_persona" name="empresa_persona" value={formData.prompt_config.empresa_persona} onChange={handleFormChange} required className={inputClass} placeholder="Ex: Soluções Inovadoras LTDA" /></div>
                                    </div>
                                    <div><label htmlFor="perfil_persona" className={labelClass}>Perfil e Tom de Voz</label><TextareaAutosize id="perfil_persona" name="perfil_persona" value={formData.prompt_config.perfil_persona} onChange={handleFormChange} required minRows={3} className={inputClass} placeholder="Descreva a personalidade: amigável, formal..." /></div>
                                    <div><label htmlFor="objetivo_persona" className={labelClass}>Objetivo Principal</label><TextareaAutosize id="objetivo_persona" name="objetivo_persona" value={formData.prompt_config.objetivo_persona} onChange={handleFormChange} required minRows={3} className={inputClass} placeholder="O que a IA quer alcançar? Ex: Responder dúvidas sobre produtos." /></div>
                                </div>
                            )}

                            {activeTab === 'contexto' && (
                                <div className="animate-fade-in space-y-6">
                                    <div>
                                        <label htmlFor="spreadsheetId" className={labelClass}>Link de Publicação da Planilha</label>
                                        <div className="flex items-center gap-4">
                                            <input id="spreadsheetId" name="spreadsheetId" value={spreadsheetId} onChange={(e) => setSpreadsheetId(e.target.value)} className={inputClass} placeholder="Cole aqui o link de publicação .xlsx..." />
                                            <button type="button" onClick={handleSyncSheet} disabled={isSyncing || !selectedConfig} className="flex items-center gap-2 bg-brand-blue text-white font-bold py-2 px-6 rounded-lg shadow-md hover:bg-brand-blue-dark transition-all disabled:bg-gray-400 disabled:cursor-not-allowed">
                                                {isSyncing ? <><Loader2 className="animate-spin" size={20} /> Sincronizando...</> : "Sincronizar"}
                                            </button>
                                        </div>
                                    </div>

                                    <div className="p-4 bg-gray-50 rounded-lg border text-sm text-gray-600 space-y-4">
                                        <div>
                                            <h4 className="font-semibold text-gray-800">Passo 1: Publicar a Planilha Inteira como Excel</h4>
                                            <ol className="list-decimal list-inside space-y-1 mt-1">
                                                <li>Na sua Planilha Google, vá em <strong>Ficheiro</strong> → <strong>Partilhar</strong> → <strong>Publicar na web</strong>.</li>
                                                <li>Na janela que abre, em <strong>"Link"</strong>, selecione <strong>"Documento inteiro"</strong>.</li>
                                                <li>No segundo menu, selecione o formato <strong>"Microsoft Excel (.xlsx)"</strong>.</li>
                                                <li>Clique no botão verde <strong>Publicar</strong> e confirme.</li>
                                            </ol>
                                        </div>
                                        <div>
                                            <h4 className="font-semibold text-gray-800">Passo 2: Copiar o Link Publicado</h4>
                                            <p className="mt-1">
                                                Após publicar, o Google irá gerar um link. **Copie este link completo** e cole-o no campo acima.
                                            </p>
                                        </div>
                                    </div>

                                    {syncedSheets.length > 0 && (
                                        <div className="p-4 bg-green-50 rounded-lg border border-green-200 animate-fade-in">
                                            <div className="flex items-center gap-2">
                                                <CheckCircle className="text-green-600" size={20} />
                                                <p className="font-semibold text-green-800">Contexto Sincronizado!</p>
                                            </div>
                                            <p className="text-sm text-green-700 mt-2">
                                                Esta persona agora tem acesso aos dados das seguintes abas:
                                            </p>
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

                            {activeTab === 'situacoes' && (
                                <SituacoesTab situacoes={situacoes} setSituacoes={setSituacoes} />
                            )}
                            
                        </div>

                        <div className="flex justify-end items-center gap-4 pt-6 mt-auto">
                            {selectedConfig && (<button type="button" onClick={() => handleDelete(selectedConfig.id)} className="font-semibold text-red-600 hover:text-red-800 flex items-center gap-2 mr-auto mb-6"><Trash2 size={16} /> Excluir</button>)}
                            <button type="submit" disabled={isSaving} className="flex items-center gap-2 bg-brand-blue text-white font-bold py-2 px-6 rounded-lg shadow-md hover:bg-brand-blue-dark transition-all disabled:bg-gray-400 disabled:shadow-none mb-6">
                                {isSaving ? <><Loader2 className="animate-spin" size={20} /> A guardar...</> : <><Save size={20} /> Guardar Persona</>}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}

export default Configs;