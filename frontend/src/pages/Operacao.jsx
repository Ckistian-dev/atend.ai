import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axiosConfig';
import { Play, Pause, Loader2, Zap, Save, Clock, Activity } from 'lucide-react';

// --- SUB-COMPONENTE: Card de Controle do Agente ---
const AgentStatusCard = ({ isRunning, isLoading, isProcessing, onStart, onStop }) => (
    <div className="bg-white p-6 rounded-2xl shadow-md border flex flex-col justify-between">
        <div>
            <div className="flex items-center gap-3 mb-4">
                <div className={`p-2 rounded-lg ${isRunning ? 'bg-green-100' : 'bg-red-100'}`}>
                    <Zap size={24} className={isRunning ? 'text-green-600' : 'text-red-600'} />
                </div>
                <h3 className="text-lg font-bold text-gray-800">Status do Agente</h3>
            </div>
            <div className="text-center py-4">
                <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-4 mx-auto transition-colors ${isRunning ? 'bg-green-100' : 'bg-red-100'}`}>
                    {isRunning ? (
                        <Zap size={40} className="text-green-500" />
                    ) : (
                        <Pause size={40} className="text-red-500" />
                    )}
                </div>
                <h2 className="text-2xl font-bold text-gray-800">
                    {isLoading ? 'A verificar...' : (isRunning ? 'Agente Ativo' : 'Agente Pausado')}
                </h2>
                <p className="text-gray-500 text-sm mt-2 min-h-[40px]">
                    {isRunning ? 'A IA está a responder ativamente às conversas.' : 'A IA não responderá a nenhuma mensagem até ser iniciada.'}
                </p>
            </div>
        </div>
        {isRunning ? (
            <button onClick={onStop} disabled={isProcessing || isLoading} className="w-full flex items-center justify-center gap-2 bg-red-600 text-white font-bold py-3 rounded-lg shadow-md hover:bg-red-700 transition-all disabled:bg-gray-400 disabled:cursor-not-allowed">
                {isProcessing ? <Loader2 className="animate-spin" /> : <Pause />} Parar Agente
            </button>
        ) : (
            <button onClick={onStart} disabled={isProcessing || isLoading} className="w-full flex items-center justify-center gap-2 bg-green-600 text-white font-bold py-3 rounded-lg shadow-md hover:bg-green-700 transition-all disabled:bg-gray-400 disabled:cursor-not-allowed">
                {isProcessing ? <Loader2 className="animate-spin" /> : <Play />} Iniciar Agente
            </button>
        )}
    </div>
);

// --- SUB-COMPONENTE: Card de Configuração de Follow-up ---
const FollowUpCard = ({ enabled, setEnabled, value, setValue, unit, setUnit, onSave }) => (
    <div className="bg-white p-6 rounded-2xl shadow-md border flex flex-col justify-between">
        <div>
            <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-blue-100">
                    <Clock size={24} className="text-blue-600" />
                </div>
                <h3 className="text-lg font-bold text-gray-800">Configuração de Follow-up</h3>
            </div>
            <p className="text-sm text-gray-500 mb-4">
                Envie uma mensagem automática se o contato não responder após um certo tempo.
            </p>
            <div className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg border mb-4 cursor-pointer" onClick={() => setEnabled(!enabled)}>
                <div className={`w-10 h-6 flex items-center rounded-full transition-colors ${enabled ? 'bg-blue-600' : 'bg-gray-300'}`}>
                    <span className={`w-4 h-4 bg-white rounded-full transition-transform transform ${enabled ? 'translate-x-5' : 'translate-x-1'}`} />
                </div>
                <span className="text-gray-700 font-medium select-none">Ativar follow-up automático</span>
            </div>
            {enabled && (
                <div className="grid grid-cols-2 gap-4 mb-4 animate-fade-in">
                    <input type="number" value={value} onChange={e => setValue(e.target.value)} min="1" className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <select value={unit} onChange={e => setUnit(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="minutes">Minutos</option>
                        <option value="hours">Horas</option>
                        <option value="days">Dias</option>
                    </select>
                </div>
            )}
        </div>
        <button onClick={onSave} className="w-full mt-4 flex items-center justify-center gap-2 bg-blue-600 text-white font-bold py-3 rounded-lg shadow-md hover:bg-blue-700 transition-all">
            <Save size={18} /> Guardar Configuração
        </button>
    </div>
);

// --- SUB-COMPONENTE: Log de Atividade Recente ---
const ActivityLog = ({ activities, isLoading, getPersonaName, getStatusClass, onRowClick }) => (
    <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-md border flex flex-col">
        <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-purple-100">
                <Activity size={24} className="text-purple-600" />
            </div>
            <h3 className="font-bold text-lg text-gray-800">Log de Atividade Recente</h3>
        </div>
        <div className="overflow-x-auto -mx-6 flex-1 overflow-y-scroll">
            <table className="w-full text-left">
                <thead className="border-b-2 border-gray-200 sticky top-0 bg-white z-10">
                    <tr>
                        <th className="p-4 text-sm font-semibold text-gray-600">Contato</th>
                        <th className="p-4 text-sm font-semibold text-gray-600">Situação</th>
                        <th className="p-4 text-sm font-semibold text-gray-600">Observação</th>
                        <th className="p-4 text-sm font-semibold text-gray-600">Persona</th>
                    </tr>
                </thead>
                <tbody>
                    {isLoading && activities.length === 0 ? (
                        <tr><td colSpan="4" className="text-center p-8 text-gray-500"><Loader2 className="animate-spin inline-block mr-2" />A carregar atividade...</td></tr>
                    ) : activities.map((activity, index) => (
                        <tr 
                            key={index} 
                            className="border-b border-gray-100 hover:bg-blue-50 transition-colors cursor-pointer"
                            onClick={() => onRowClick(activity.whatsapp)}
                        >
                            <td className="p-4 font-medium text-gray-800 text-sm">{activity.whatsapp}</td>
                            <td className="p-4"><span className={getStatusClass(activity.situacao)}>{activity.situacao}</span></td>
                            <td className="p-4 text-sm text-gray-600 max-w-lg">
                                <p title={activity.observacao}>{activity.observacao}</p>
                            </td>
                            <td className="p-4 text-sm text-gray-600 font-medium">{getPersonaName(activity.active_persona_id)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {!isLoading && activities.length === 0 && <p className="text-center text-gray-500 py-8">Nenhuma atividade recente para mostrar.</p>}
        </div>
    </div>
);


function Operacao() {
    const navigate = useNavigate();
    const [agentStatus, setAgentStatus] = useState('stopped');
    const [isLoading, setIsLoading] = useState(true);
    const [isProcessing, setIsProcessing] = useState(false);
    const [recentActivity, setRecentActivity] = useState([]);
    const [isActivityLoading, setIsActivityLoading] = useState(true);
    const [followupEnabled, setFollowupEnabled] = useState(true);
    const [followupValue, setFollowupValue] = useState(24);
    const [followupUnit, setFollowupUnit] = useState('hours');
    const [personas, setPersonas] = useState([]);

    const fetchInitialData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [agentRes, dashboardRes, userRes, personasRes] = await Promise.all([
                api.get('/agent/status'),
                api.get('/dashboard/'),
                api.get('/auth/me'),
                api.get('/configs/')
            ]);
            
            setAgentStatus(agentRes.data.status);
            setRecentActivity(dashboardRes.data.recentActivity || []);
            setPersonas(personasRes.data);

            const userData = userRes.data;
            const minutes = userData.followup_interval_minutes || 0;
            setFollowupEnabled(minutes > 0);
            if (minutes > 0) {
                if (minutes >= 1440 && minutes % 1440 === 0) { setFollowupValue(minutes / 1440); setFollowupUnit('days'); } 
                else if (minutes >= 60 && minutes % 60 === 0) { setFollowupValue(minutes / 60); setFollowupUnit('hours'); } 
                else { setFollowupValue(minutes); setFollowupUnit('minutes'); }
            } else {
                setFollowupValue(24);
                setFollowupUnit('hours');
            }
        } catch (error) {
            console.error("Erro ao carregar dados da página:", error);
        } finally {
            setIsLoading(false);
            setIsActivityLoading(false);
        }
    }, []);

    const fetchActivityData = useCallback(async () => {
        try {
            const response = await api.get('/dashboard/');
            setRecentActivity(response.data.recentActivity || []);
        } catch (error) {
            console.error("Erro ao buscar dados do dashboard:", error);
        }
    }, []);

    useEffect(() => {
        fetchInitialData();
        const interval = setInterval(fetchActivityData, 5000);
        return () => clearInterval(interval);
    }, [fetchInitialData, fetchActivityData]);
    
    const getPersonaNameById = (id) => {
        const persona = personas.find(p => p.id === id);
        return persona ? persona.nome_config : 'N/D';
    };
    
    const getStatusClass = (status) => {
        const baseClasses = "px-3 py-1 text-xs font-semibold rounded-full inline-block text-center min-w-[140px]";
        switch (status) {
            case 'Mensagem Recebida': return `${baseClasses} bg-blue-100 text-blue-800`;
            case 'Concluído': return `${baseClasses} bg-green-100 text-green-800`;
            case 'Aguardando Resposta': return `${baseClasses} bg-yellow-100 text-yellow-800`;
            case 'Atendente Chamado': return `${baseClasses} bg-orange-100 text-orange-800`;
            case 'Erro IA': return `${baseClasses} bg-red-200 text-red-800`;
            case 'Ignorar Contato': return `${baseClasses} bg-gray-200 text-gray-700`;
            default: return `${baseClasses} bg-gray-100 text-gray-600`;
        }
    };

    const handleStartAgent = async () => {
        setIsProcessing(true);
        try {
            await api.post('/agent/start');
            setAgentStatus('running');
        } catch (error) {
            alert('Não foi possível iniciar o agente.');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleStopAgent = async () => {
        setIsProcessing(true);
        try {
            await api.post('/agent/stop');
            setAgentStatus('stopped');
        } catch (error) {
            alert('Não foi possível parar o agente.');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleSaveFollowup = async () => {
        let minutes = 0;
        if (followupEnabled) {
            const value = parseInt(followupValue, 10);
            if (value > 0) {
                if (followupUnit === 'days') minutes = value * 1440;
                else if (followupUnit === 'hours') minutes = value * 60;
                else minutes = value;
            }
        }
        try {
            await api.put('/users/me', { followup_interval_minutes: minutes });
            alert('Configuração de follow-up guardada com sucesso!');
        } catch (error) {
            alert('Erro ao guardar a configuração de follow-up.');
        }
    };

    const handleActivityClick = (whatsappNumber) => {
        navigate(`/atendimentos?search=${whatsappNumber}`);
    };

    return (
        <div className="p-6 md:p-10 bg-gray-50 min-h-screen">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-gray-800">Operação do Agente</h1>
                <p className="text-gray-500 mt-1">Controle o atendimento automático e as configurações de follow-up.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-1 flex flex-col gap-8">
                    <AgentStatusCard
                        isRunning={agentStatus === 'running'}
                        isLoading={isLoading}
                        isProcessing={isProcessing}
                        onStart={handleStartAgent}
                        onStop={handleStopAgent}
                    />
                    <FollowUpCard
                        enabled={followupEnabled}
                        setEnabled={setFollowupEnabled}
                        value={followupValue}
                        setValue={setFollowupValue}
                        unit={followupUnit}
                        setUnit={setFollowupUnit}
                        onSave={handleSaveFollowup}
                    />
                </div>

                <ActivityLog
                    activities={recentActivity}
                    isLoading={isActivityLoading}
                    getPersonaName={getPersonaNameById}
                    getStatusClass={getStatusClass}
                    onRowClick={handleActivityClick}
                />
            </div>
        </div>
    );
}

export default Operacao;