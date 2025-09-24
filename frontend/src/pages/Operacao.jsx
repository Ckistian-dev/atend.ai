import React, { useState, useEffect, useCallback } from 'react';
import api from '../api/axiosConfig';
import { Play, Pause, Loader2, Zap, Save, Clock, Check, Bot } from 'lucide-react';

function Operacao() {
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
                if (minutes % 1440 === 0) { setFollowupValue(minutes / 1440); setFollowupUnit('days'); } 
                else if (minutes % 60 === 0) { setFollowupValue(minutes / 60); setFollowupUnit('hours'); } 
                else { setFollowupValue(minutes); setFollowupUnit('minutes'); }
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

    const isRunning = agentStatus === 'running';

    return (
        <div className="p-6 md:p-10 bg-gray-50 h-full flex flex-col">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-gray-800">Operação do Agente</h1>
                <p className="text-gray-500 mt-1">Controle o atendimento automático e as configurações de follow-up.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1 min-h-0">
                {/* --- ALTERAÇÃO AQUI: Usamos grid e grid-rows-2 para dividir o espaço igualmente --- */}
                <div className="lg:col-span-1 grid grid-rows-2 gap-8">
                    
                    <div className="bg-white p-6 rounded-xl shadow-md border flex flex-col text-center justify-center">
                        <div className={`w-24 h-24 rounded-full flex items-center justify-center mb-4 mx-auto ${isRunning ? 'bg-green-100' : 'bg-red-100'}`}>
                            <Zap size={48} className={isRunning ? 'text-green-500' : 'text-red-500'} />
                        </div>
                        <h2 className="text-2xl font-bold text-gray-800">
                            {isLoading ? 'A verificar...' : (isRunning ? 'Agente Ativo' : 'Agente Pausado')}
                        </h2>
                        <p className="text-gray-500 mt-2 mb-6 flex-1">
                            {isRunning ? 'A IA está a responder ativamente a novas mensagens.' : 'A IA não responderá a nenhuma mensagem até ser iniciada.'}
                        </p>
                        {isRunning ? (
                            <button onClick={handleStopAgent} disabled={isProcessing || isLoading} className="w-full flex items-center justify-center gap-2 bg-red-500 text-white font-bold py-3 rounded-lg shadow-md hover:bg-red-600 transition-all disabled:bg-gray-400">
                                {isProcessing ? <Loader2 className="animate-spin" /> : <Pause />} Parar Agente
                            </button>
                        ) : (
                            <button onClick={handleStartAgent} disabled={isProcessing || isLoading} className="w-full flex items-center justify-center gap-2 bg-green-500 text-white font-bold py-3 rounded-lg shadow-md hover:bg-green-600 transition-all disabled:bg-gray-400">
                                {isProcessing ? <Loader2 className="animate-spin" /> : <Play />} Iniciar Agente
                            </button>
                        )}
                    </div>

                    <div className="bg-white p-6 rounded-xl shadow-md border flex flex-col justify-center">
                        <h3 className="text-lg font-semibold text-gray-700 mb-4 flex items-center gap-2"><Clock size={20} /> Configuração de Follow-up</h3>
                        <div className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg border mb-4">
                            <button type="button" onClick={() => setFollowupEnabled(!followupEnabled)} className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${followupEnabled ? 'bg-green-600' : 'bg-gray-300'}`}>
                                {followupEnabled && <Check size={16} className="text-white" />}
                            </button>
                            <span className="text-gray-700">Ativar follow-up automático</span>
                        </div>
                        {followupEnabled && (
                            <div className="grid grid-cols-2 gap-4 mb-4 animate-fade-in">
                                <input type="number" value={followupValue} onChange={e => setFollowupValue(e.target.value)} min="1" className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-blue" />
                                <select value={followupUnit} onChange={e => setFollowupUnit(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-blue">
                                    <option value="minutes">Minutos</option>
                                    <option value="hours">Horas</option>
                                    <option value="days">Dias</option>
                                </select>
                            </div>
                        )}
                        <button onClick={handleSaveFollowup} className="w-full flex items-center justify-center gap-2 bg-brand-blue text-white font-bold py-2 rounded-lg shadow-md hover:bg-brand-blue-dark transition-all">
                            <Save size={18} /> Guardar Follow-up
                        </button>
                    </div>

                </div>

                <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-md border flex flex-col">
                    <h3 className="font-bold text-lg text-gray-800 mb-4">Log de Atividade Recente</h3>
                    <div className="overflow-y-auto flex-1">
                        <table className="w-full text-left">
                            <thead className="border-b-2 border-gray-200 sticky top-0 bg-white">
                                <tr>
                                    <th className="p-3 text-sm font-semibold text-gray-600">WhatsApp</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Situação</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Persona Ativa</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Observação</th>
                                </tr>
                            </thead>
                            <tbody>
                                {isActivityLoading && recentActivity.length === 0 ? (
                                    <tr><td colSpan="4" className="text-center p-8 text-gray-500">A carregar atividade...</td></tr>
                                ) : recentActivity.map((activity, index) => (
                                    <tr key={index} className="border-b border-gray-100">
                                        <td className="p-3 font-medium text-gray-700">{activity.whatsapp}</td>
                                        <td className="p-3 text-gray-600">{activity.situacao}</td>
                                        <td className="p-3 text-gray-600 font-medium">{getPersonaNameById(activity.active_persona_id)}</td>
                                        <td className="p-3 text-gray-600 whitespace-pre-wrap">{activity.observacao || '-'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {!isActivityLoading && recentActivity.length === 0 && <p className="text-center text-gray-500 py-8">Nenhuma atividade recente.</p>}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Operacao;