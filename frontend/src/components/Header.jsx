// src/components/Header.jsx

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CSSTransition, SwitchTransition } from 'react-transition-group';
import { Ticket, User as UserIcon, AlertCircle, Zap, Activity, UserCheck, UserX } from 'lucide-react';
import api from '../api/axiosConfig';

// --- Sub-componente para o Status do Agente ---
const AgentStatus = ({ status, onToggle }) => {
    const isRunning = status === 'running';
    const bgColor = isRunning ? 'bg-green-100' : 'bg-red-100';
    const textColor = isRunning ? 'text-green-600' : 'text-red-600';
    const text = isRunning ? 'Agente Ativo' : 'Agente Pausado';

    return (
        <button
            onClick={onToggle}
            className={`flex items-center gap-2 text-sm px-3 py-1 rounded-full ${bgColor} ${textColor} transition-transform transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-blue`}
            title="Clique para ativar/desativar o agente de IA"
        >
            <Zap size={16} />
            <span className="font-medium hidden sm:inline">{text}</span>
        </button>
    );
};

// --- Sub-componente para o Ticker de Atividade ---
const ActivityTicker = ({ activity }) => {
    if (!activity) {
        return (
            <div className="flex items-center gap-2 text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
                <Activity size={16} />
                <span className="font-medium hidden sm:inline">Nenhuma atividade recente</span>
            </div>
        );
    }

    return (
        <div className="flex items-center gap-2 text-sm text-gray-600 px-2 py-1" title={`Última atividade: ${activity.observacao}`}>
            <Activity size={16} className="text-brand-blue" />
            <div className="font-medium hidden sm:flex items-center gap-1.5">
                <span>{activity.whatsapp}:</span>
                <span className="font-semibold text-gray-800">{activity.situacao}</span>
            </div>
        </div>
    );
};

// --- Sub-componente para Animação de Números (Efeito Cassino) ---
const CountUp = ({ end, duration = 1500 }) => {
    const [count, setCount] = useState(0);
    const countRef = useRef(0);
    const requestRef = useRef();
    const startTimeRef = useRef();

    useEffect(() => {
        const startValue = countRef.current;
        const endValue = end;

        if (startValue === endValue) return;

        startTimeRef.current = null;

        const animate = (time) => {
            if (!startTimeRef.current) startTimeRef.current = time;
            const progress = time - startTimeRef.current;
            const percentage = Math.min(progress / duration, 1);
            
            // Easing: easeOutQuart para um efeito suave de desaceleração
            const ease = 1 - Math.pow(1 - percentage, 4);
            
            const currentCount = Math.floor(startValue + (endValue - startValue) * ease);

            setCount(currentCount);
            countRef.current = currentCount;

            if (progress < duration) {
                requestRef.current = requestAnimationFrame(animate);
            } else {
                setCount(endValue);
                countRef.current = endValue;
            }
        };

        requestRef.current = requestAnimationFrame(animate);

        return () => cancelAnimationFrame(requestRef.current);
    }, [end, duration]);

    return new Intl.NumberFormat('pt-BR').format(count);
};

const Header = () => {
    const [user, setUser] = useState(null);
    const [agentStatus, setAgentStatus] = useState(null);
    const [latestActivity, setLatestActivity] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    const fetchData = useCallback(async () => {
        try {
            const [userRes, agentRes, dashboardRes] = await Promise.all([
                api.get('/auth/me'),
                api.get('/agent/status'),
                api.get('/dashboard/')
            ]);

            setUser(userRes.data);
            setAgentStatus(agentRes.data.status);

            const newActivity = dashboardRes.data.recentActivity?.[0];
            // Usando a forma funcional do setState para evitar a dependência de 'latestActivity'
            setLatestActivity(currentActivity => {
                if (newActivity && JSON.stringify(newActivity) !== JSON.stringify(currentActivity)) {
                    return newActivity;
                }
                // Se não houver nova atividade ou se for a mesma, mantém o estado atual
                return currentActivity;
            });

        } catch (err) {
            console.error("Erro ao buscar dados do header:", err);
            setError(true);
        }
    }, []); // Removida a dependência 'latestActivity'

    useEffect(() => {
        const loadInitialData = async () => {
            setLoading(true);
            await fetchData();
            setLoading(false);
        };
        loadInitialData();
        // A função fetchData agora é estável e não precisa estar no array de dependências,
        // mas adicioná-la é uma boa prática. Como o array de dependências de fetchData é [],
        // este useEffect só rodará uma vez na montagem.
    }, [fetchData]);

    // Atualiza os dados periodicamente
    useEffect(() => {
        let isMounted = true;
        let timeoutId;

        const poll = async () => {
            // Só busca dados se a página estiver VISÍVEL
            if (!document.hidden) {
                await fetchData();
            }
            
            if (isMounted) {
                // Agenda o próximo ciclo
                timeoutId = setTimeout(poll, 5000);
            }
        };

        poll(); // Inicia o ciclo

        // Opcional: Força uma atualização imediata ao voltar para a aba
        const handleVisibilityChange = () => {
            if (!document.hidden && isMounted) {
                clearTimeout(timeoutId);
                poll();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            isMounted = false;
            clearTimeout(timeoutId);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [fetchData]);

    const handleToggleAgentStatus = async () => {
        try {
            const isCurrentlyRunning = agentStatus === 'running';
            const newStatus = isCurrentlyRunning ? 'stopped' : 'running';
            const originalStatus = agentStatus;

            // Otimisticamente atualiza a UI
            setAgentStatus(newStatus);

            if (isCurrentlyRunning) {
                await api.post('/agent/stop');
            } else {
                await api.post('/agent/start');
            }
        } catch (err) {
            console.error("Erro ao alternar status do agente:", err);
            setAgentStatus(agentStatus); // Reverte em caso de erro
            setError(true);
        }
    };

    const handleToggleAttendantStatus = async () => {
        if (!user) return;

        const originalStatus = user.atendente_online;
        const newStatus = !originalStatus;

        // Atualização otimista da UI
        setUser(prevUser => ({ ...prevUser, atendente_online: newStatus }));

        try {
            await api.put('/users/me', { atendente_online: newStatus });
        } catch (err) {
            console.error("Erro ao alternar status do atendente:", err);
            // Reverte em caso de erro
            setUser(prevUser => ({ ...prevUser, atendente_online: originalStatus }));
            setError(true);
        }
    };

    const renderContent = () => {
        if (loading) {
            return <div className="h-8 bg-gray-200 rounded-full w-96 animate-pulse"></div>;
        }
        if (error) {
            return (
                <div className="flex items-center gap-2 text-sm text-red-600">
                    <AlertCircle size={18} />
                    <span>Erro ao carregar.</span>
                </div>
            );
        }

        if (user?.is_superuser) {
            return null;
        }

        return (
            <div className="w-full flex justify-between items-center">
                {/* Lado Esquerdo */}
                <div className="flex items-center gap-4 sm:gap-5">
                    {agentStatus && <AgentStatus status={agentStatus} onToggle={handleToggleAgentStatus} />}
                    
                    {/* Animação de entrada para nova atividade */}
                    <style>{`
                        .activity-ticker-wrapper {
                            position: relative;
                            height: 34px; /* Ajuste conforme a altura do seu componente ActivityTicker */
                            overflow: hidden;
                        }
                        .fade-enter {
                            opacity: 0;
                            transform: translateY(-100%);
                        }
                        .fade-enter-active {
                            opacity: 1;
                            transform: translateY(0);
                            transition: transform 500ms ease-out, opacity 500ms ease-out;
                        }
                        .fade-exit {
                            opacity: 1;
                            transform: translateY(0);
                        }
                        .fade-exit-active {
                            opacity: 0;
                            transform: translateY(100%);
                            transition: transform 500ms ease-in, opacity 500ms ease-in;
                        }
                    `}</style>
                    <SwitchTransition mode="out-in">
                        <CSSTransition
                            key={latestActivity?.id || 'no-activity'}
                            timeout={500}
                            classNames="fade"
                        >
                            <div className="activity-ticker-wrapper">
                                <ActivityTicker activity={latestActivity} />
                            </div>
                        </CSSTransition>
                    </SwitchTransition>
                </div>

                {/* Lado Direito */}
                <div className="flex items-center gap-4 sm:gap-5">
                    <div className="flex items-center gap-2 text-gray-600" title="Os seus tokens restantes">
                        <Ticket size={20} className="text-brand-blue" />
                        <span className="font-semibold text-gray-800">
                            {user?.tokens !== undefined && user?.tokens !== null
                                ? <CountUp end={user.tokens} />
                                : '...'}
                        </span>
                        <span className="text-sm hidden sm:inline">Tokens</span>
                    </div>
                    {user ? (
                        <button
                            onClick={handleToggleAttendantStatus}
                            className={`flex items-center gap-2.5 text-sm px-3 py-1.5 rounded-full transition-all transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-blue ${
                                user.atendente_online
                                    ? 'bg-green-100 text-green-800 hover:bg-green-200'
                                    : 'bg-red-100 text-red-800 hover:bg-red-200'
                            }`}
                            title={`Você está ${user.atendente_online ? 'Online' : 'Offline'}. Clique para alterar.`}
                        >
                            <span className="relative flex h-2.5 w-2.5">
                                {user.atendente_online && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>}
                                <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${user.atendente_online ? 'bg-green-500' : 'bg-red-500'}`}></span>
                            </span>
                            {user.atendente_online ? <UserCheck size={16} /> : <UserX size={16} />}
                            <span className="font-medium hidden sm:inline">{user.email}</span>
                        </button>
                    ) : (
                        <div className="flex items-center gap-2 text-sm text-gray-600 bg-gray-100 px-3 py-1 rounded-full">
                            <UserIcon size={18} />
                            <span className="font-medium">...</span>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <header className="bg-white p-4 border-b border-gray-200 flex items-center shadow-sm min-h-16">
            {renderContent()}
        </header>
    );
};

export default Header;