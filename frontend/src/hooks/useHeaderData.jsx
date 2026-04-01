import { useState, useEffect, useCallback } from 'react';
import api from '.././api/axiosConfig';

/**
 * @typedef {Object} UserData
 * @property {string} email
 * @property {number} tokens
 * @property {boolean} is_superuser
 * @property {boolean} atendente_online
 */

/**
 * Hook customizado para gerenciar o estado e as requisições do Header.
 * Isola a lógica de negócios da camada de apresentação (UI).
 */
export const useHeaderData = () => {
    const [user, setUser] = useState(/** @type {UserData | null} */ (null));
    const [agentStatus, setAgentStatus] = useState(/** @type {'running' | 'stopped' | null} */ (null));
    const [latestActivity, setLatestActivity] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);

    const fetchDashboardData = useCallback(async () => {
        try {
            const [userRes, agentRes, dashboardRes] = await Promise.all([
                api.get('/auth/me'),
                api.get('/agent/status'),
                api.get('/dashboard/')
            ]);

            setUser(userRes.data);
            setAgentStatus(agentRes.data.status);

            const newActivity = dashboardRes.data.recentActivity?.[0];
            
            setLatestActivity(currentActivity => {
                // Previne re-renderizações desnecessárias se a atividade for a mesma
                if (newActivity && JSON.stringify(newActivity) !== JSON.stringify(currentActivity)) {
                    return newActivity;
                }
                return currentActivity;
            });

            // Reseta o erro caso uma requisição subsequente funcione
            setHasError(false);
        } catch (err) {
            console.error("[Header] Failed to fetch data:", err);
            setHasError(true);
        }
    }, []);

    // Ciclo de vida inicial e Polling inteligente (pausa quando a aba está inativa)
    useEffect(() => {
        let isMounted = true;
        let timeoutId;

        const pollData = async () => {
            if (!document.hidden) {
                await fetchDashboardData();
            }
            
            if (isMounted) {
                timeoutId = setTimeout(pollData, 5000);
            }
        };

        const loadInitialData = async () => {
            setIsLoading(true);
            await fetchDashboardData();
            setIsLoading(false);
            pollData();
        };

        loadInitialData();

        const handleVisibilityChange = () => {
            if (!document.hidden && isMounted) {
                clearTimeout(timeoutId);
                fetchDashboardData(); // Força fetch imediato ao voltar para a aba
                pollData(); // Reinicia o ciclo
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            isMounted = false;
            clearTimeout(timeoutId);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [fetchDashboardData]);

    const toggleAgentStatus = async () => {
        const isCurrentlyRunning = agentStatus === 'running';
        const newStatus = isCurrentlyRunning ? 'stopped' : 'running';
        
        // Atualização Otimista da UI
        setAgentStatus(newStatus);

        try {
            if (isCurrentlyRunning) {
                await api.post('/agent/stop');
            } else {
                await api.post('/agent/start');
            }
        } catch (err) {
            console.error("[Header] Failed to toggle agent status:", err);
            setAgentStatus(agentStatus); // Rollback em caso de falha
            setHasError(true);
        }
    };

    const toggleAttendantStatus = async () => {
        if (!user) return; // Early Return

        const originalStatus = user.atendente_online;
        const newStatus = !originalStatus;

        // Atualização Otimista da UI
        setUser(prev => prev ? { ...prev, atendente_online: newStatus } : null);

        try {
            await api.put('/users/me', { atendente_online: newStatus });
        } catch (err) {
            console.error("[Header] Failed to toggle attendant status:", err);
            setUser(prev => prev ? { ...prev, atendente_online: originalStatus } : null); // Rollback
            setHasError(true);
        }
    };

    return {
        user,
        agentStatus,
        latestActivity,
        isLoading,
        hasError,
        toggleAgentStatus,
        toggleAttendantStatus
    };
};