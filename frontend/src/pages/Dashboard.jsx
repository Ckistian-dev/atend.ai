// src/pages/Dashboard.jsx

import React, { useState, useEffect } from 'react';
import { MessageSquareText, Zap, CheckCircle, XCircle, BarChart } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import api from '../api/axiosConfig';

// --- COMPONENTES AUXILIARES ---

// Card de estatísticas com o novo tema azul
const StatCard = ({ icon: Icon, title, value, color }) => (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
        <div className="flex items-start justify-between">
            <div className="flex flex-col">
                <p className="text-sm font-medium text-gray-500">{title}</p>
                <p className="text-3xl font-bold text-gray-800 mt-1">{value}</p>
            </div>
            <div className={`p-3 rounded-xl bg-opacity-10`} style={{ backgroundColor: `${color}20` }}>
                <Icon size={24} style={{ color }} />
            </div>
        </div>
    </div>
);

// Item para a lista de "Atividade Recente"
const RecentActivityItem = ({ whatsapp, situacao, observacao }) => {
    const statusStyles = {
        'Aguardando Resposta': 'bg-blue-100 text-blue-700',
        'Resposta Recebida': 'bg-yellow-100 text-yellow-700',
        'Concluído': 'bg-green-100 text-green-700',
        'Ignorar Contato': 'bg-gray-100 text-gray-700',
        'Vendedor Chamado': 'bg-purple-100 text-purple-700',
        'Erro IA': 'bg-red-100 text-red-700',
    };
    return (
        <div className="flex flex-col py-3 px-2 rounded-lg hover:bg-gray-50">
            <div className="flex items-center justify-between">
                <p className="font-semibold text-gray-800 text-sm">{whatsapp}</p>
                <span className={`text-xs font-medium px-3 py-1 rounded-full ${statusStyles[situacao] || 'bg-gray-100 text-gray-700'}`}>
                    {situacao}
                </span>
            </div>
            {observacao && (
                <p className="text-xs text-gray-500 mt-1 truncate" title={observacao}>
                    Obs: {observacao}
                </p>
            )}
        </div>
    );
};


// --- COMPONENTE PRINCIPAL DO DASHBOARD ---
const Dashboard = () => {
    const [data, setData] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchDashboardData = async () => {
            try {
                setIsLoading(true);
                const response = await api.get('/dashboard/');
                setData(response.data);
                setError(null);
            } catch (err) {
                console.error("Erro ao buscar dados do dashboard:", err);
                setError("Não foi possível carregar os dados do dashboard.");
            } finally {
                setIsLoading(false);
            }
        };
        fetchDashboardData();
    }, []);
    
    // Skeleton para a tela de carregamento
    if (isLoading) {
        return (
            <div className="animate-fade-in p-6 md:p-10">
                <div className="h-10 w-1/3 bg-gray-200 rounded-lg animate-pulse mb-2"></div>
                <div className="h-4 w-1/2 bg-gray-200 rounded-lg animate-pulse mb-8"></div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 animate-pulse">
                    {[...Array(4)].map((_, i) => <div key={i} className="h-32 bg-gray-200 rounded-2xl"></div>)}
                </div>
                <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6 animate-pulse">
                    <div className="lg:col-span-2 h-80 bg-gray-200 rounded-2xl"></div>
                    <div className="h-80 bg-gray-200 rounded-2xl"></div>
                </div>
            </div>
        );
    }

    if (error) {
        return <div className="p-10 text-center text-red-500"><p>{error}</p></div>
    }

    // Mapeia os dados da API para os StatCards
    const stats = [
        { icon: MessageSquareText, title: 'Total de Atendimentos', value: data.stats.totalAtendimentos, color: '#3b82f6' },
        { icon: Zap, title: 'Atendimentos Ativos', value: data.stats.ativos, color: '#f59e0b' },
        { icon: CheckCircle, title: 'Finalizados (24h)', value: data.stats.finalizadosHoje, color: '#10b981' },
        { icon: XCircle, title: 'Contatos Ignorados', value: data.stats.ignorados, color: '#ef4444' },
    ];
    
    // Simulação de dados para o gráfico, já que o backend não provê isso ainda.
    const chartData = [
        { name: 'Seg', ativos: 12, novos: 5 },
        { name: 'Ter', ativos: 15, novos: 8 },
        { name: 'Qua', ativos: 14, novos: 6 },
        { name: 'Qui', ativos: 18, novos: 10 },
        { name: 'Sex', ativos: 22, novos: 7 },
        { name: 'Sáb', ativos: 10, novos: 3 },
        { name: 'Dom', ativos: 8, novos: 2 },
    ];

    return (
        <div className="animate-fade-in p-6 md:p-10 bg-gray-50 min-h-screen">
            <h1 className="text-3xl font-bold text-gray-800 mb-2">Dashboard de Atendimento</h1>
            <p className="text-gray-500 mb-8">Bem-vindo(a) de volta! Aqui está um resumo da sua operação.</p>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                {stats.map((stat, index) => (
                    <StatCard key={index} {...stat} />
                ))}
            </div>

            <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                    <h3 className="font-bold text-lg text-gray-800 mb-4 flex items-center">
                        <BarChart size={20} className="mr-2 text-gray-500" />
                        Visão Geral da Atividade Semanal
                    </h3>
                    <div className="h-72">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorAtivos" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                                    </linearGradient>
                                    <linearGradient id="colorNovos" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                <XAxis dataKey="name" stroke="#6b7280" fontSize={12} />
                                <YAxis stroke="#6b7280" fontSize={12} />
                                <Tooltip contentStyle={{ borderRadius: "12px", borderColor: "#e5e7eb" }} />
                                <Legend />
                                <Area type="monotone" dataKey="ativos" name="Atendimentos Ativos" stroke="#3b82f6" fillOpacity={1} fill="url(#colorAtivos)" />
                                <Area type="monotone" dataKey="novos" name="Novos Atendimentos" stroke="#10b981" fillOpacity={1} fill="url(#colorNovos)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
                
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                     <h3 className="font-bold text-lg text-gray-800 mb-4">Atividade Recente</h3>
                     <div className="space-y-2">
                         {data.recentActivity && data.recentActivity.length > 0 ? (
                            data.recentActivity.map((activity, index) => (
                               <RecentActivityItem key={index} {...activity} />  
                            ))
                         ) : (
                            <p className="text-center text-sm text-gray-500 pt-8">Nenhuma atividade recente para mostrar.</p>
                         )}
                     </div>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;