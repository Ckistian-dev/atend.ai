import React, { useEffect, useState, useRef } from 'react';
import api from '../api/axiosConfig';

const GlobalNotificationHandler = () => {
    const [previousData, setPreviousData] = useState({});
    const isFirstLoad = useRef(true);

    useEffect(() => {
        if ("Notification" in window && Notification.permission === "default") {
            Notification.requestPermission();
        }
    }, []);

    useEffect(() => {
        let isMounted = true;
        let timeoutId;

        const checkNotifications = async () => {
            try {
                // Busca atendimentos com status 'Atendente Chamado'
                // Limitamos a 100 para não sobrecarregar, assumindo que não haverá mais que isso pendente simultaneamente
                const params = {
                    status: 'Atendente Chamado',
                    limit: 100
                };
                
                const response = await api.get('/atendimentos/', { params });
                const items = response.data.items || [];

                // Helper para contar mensagens não lidas do usuário
                const getUnreadCount = (item) => {
                    try {
                        const conversa = typeof item.conversa === 'string' ? JSON.parse(item.conversa || '[]') : (item.conversa || []);
                        if (Array.isArray(conversa)) {
                            return conversa.filter(msg => msg.role === 'user' && msg.status === 'unread').length;
                        }
                        return 0;
                    } catch (e) {
                        return 0;
                    }
                };

                // Constrói o estado atual: { id: unreadCount }
                const currentData = {};
                let chatsWithUnread = 0;

                items.forEach(item => {
                    const unread = getUnreadCount(item);
                    currentData[item.id] = unread;
                    if (unread > 0) chatsWithUnread++;
                });

                if (isMounted) {
                    // Atualiza o Título da Aba
                    if (chatsWithUnread > 0) {
                        document.title = `(${chatsWithUnread}) Atendimentos - Ação Necessária!`;
                    } else if (items.length > 0) {
                        document.title = `(${items.length}) Atendente Chamado`;
                    } else {
                        document.title = 'Atend AI';
                    }

                    // Lógica de Notificação do Navegador (Toast/Push)
                    setPreviousData(prev => {
                        // Só notifica se não for a primeira carga para evitar spam ao recarregar a página
                        if (!isFirstLoad.current) {
                            items.forEach(item => {
                                const id = item.id;
                                const currentUnread = currentData[id];
                                const previousUnread = prev[id];

                                // 1. Novo atendimento na lista (mudou status para Atendente Chamado)
                                const isNewInList = previousUnread === undefined;

                                // 2. Recebeu nova mensagem (contagem de não lidas aumentou)
                                const hasNewMessage = previousUnread !== undefined && currentUnread > previousUnread;

                                if (isNewInList || hasNewMessage) {
                                    if ("Notification" in window && Notification.permission === "granted") {
                                        const title = isNewInList ? "Novo Chamado!" : "Nova Mensagem!";
                                        const body = `Cliente: ${item.nome_contato || item.whatsapp}\n${currentUnread > 0 ? `${currentUnread} mensagem(ns) não lida(s).` : 'Solicitou atendimento.'}`;
                                        
                                        const notification = new Notification(title, {
                                            body: body,
                                            requireInteraction: true, // Torna a notificação persistente no OS
                                            tag: `atendai-notification-${id}`, // Agrupa por chat para não floodar, mas atualiza
                                            renotify: true // Garante que toque o som/vibre novamente mesmo com a mesma tag
                                        });
                                        
                                        notification.onclick = () => {
                                            window.focus();
                                        };
                                    }
                                }
                            });
                        } else {
                            isFirstLoad.current = false;
                        }
                        return currentData;
                    });
                }

            } catch (error) {
                console.error("Erro no polling global de notificações:", error);
            }

            if (isMounted) {
                timeoutId = setTimeout(checkNotifications, 5000); // Polling a cada 5 segundos
            }
        };

        checkNotifications();

        return () => {
            isMounted = false;
            clearTimeout(timeoutId);
            document.title = 'Atend AI';
        };
    }, []);

    return null;
};

export default GlobalNotificationHandler;