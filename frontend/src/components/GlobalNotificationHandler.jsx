import React, { useEffect, useState, useRef } from 'react';
import api from '../api/axiosConfig';

const GlobalNotificationHandler = () => {
    const [previousIds, setPreviousIds] = useState(new Set());
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

                // Filtra para contar apenas os que têm mensagens não lidas do usuário
                const itemsWithUnread = items.filter(at => {
                    try {
                        const conversa = JSON.parse(at.conversa || '[]');
                        return conversa.some(msg => msg.role === 'user' && msg.status === 'unread');
                    } catch (e) {
                        return false;
                    }
                });

                const count = itemsWithUnread.length;

                if (isMounted) {
                    // Atualiza o Título da Aba
                    if (count > 0) {
                        document.title = `${count} Cliente(s) aguardando❗`;
                    } else {
                        document.title = 'Atend AI';
                    }

                    // Lógica de Notificação do Navegador (Toast/Push)
                    const currentIds = new Set(items.map(i => i.id));
                    
                    setPreviousIds(prev => {
                        // Só notifica se não for a primeira carga para evitar spam ao recarregar a página
                        if (!isFirstLoad.current) {
                            items.forEach(item => {
                                if (!prev.has(item.id)) {
                                    if ("Notification" in window && Notification.permission === "granted") {
                                        new Notification("Atendente Chamado!", {
                                            body: `O cliente ${item.nome_contato || item.whatsapp} solicitou um atendente.`
                                        });
                                    }
                                }
                            });
                        } else {
                            isFirstLoad.current = false;
                        }
                        return currentIds;
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