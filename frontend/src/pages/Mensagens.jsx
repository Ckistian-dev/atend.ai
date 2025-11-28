import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api/axiosConfig'; // Presumindo que você tenha este arquivo de configuração do Axios
import {
    Loader2, MoreVertical
} from 'lucide-react';
import { format } from 'date-fns';
import MediaModal from '../components/mensagens/MediaModal';
import ProfileSidebar from '../components/mensagens/ProfileSidebar';
import SearchAndFilter from '../components/mensagens/SearchAndFilter';
import ContactItem from '../components/mensagens/ContactItem';
import ChatBody from '../components/mensagens/ChatBody';
import ChatFooter from '../components/mensagens/ChatFooter';
import ChatPlaceholder from '../components/mensagens/ChatPlaceholder';
import FilterPopover from '../components/mensagens/FilterPopover';
import TemplateModal from '../components/mensagens/TemplateModal';

const getTextColorForBackground = (hexColor) => {
    // Força o texto a ser branco, conforme solicitado
    return '#FFFFFF';
};

const getLastMessageTimestamp = (at) => {
    try {
        const conversa = JSON.parse(at.conversa || '[]');
        if (conversa.length === 0) {
            return new Date(at.updated_at).getTime(); // Fallback se conversa vazia
        }
        const lastMsg = conversa[conversa.length - 1];
        const ts = lastMsg.timestamp;

        if (!ts) {
            return new Date(at.updated_at).getTime(); // Fallback se msg não tiver timestamp
        }

        // Converte timestamp (seja unix/segundos ou ISO string) para ms
        return (typeof ts === 'number') ? (ts * 1000) : new Date(ts).getTime();
    } catch (e) {
        // Fallback em caso de JSON inválido ou erro
        return new Date(at.updated_at).getTime();
    }
};

// --- COMPONENTE PRINCIPAL DA PÁGINA ---
function Mensagens() {
    const [mensagens, setAtendimentos] = useState([]);
    const [filteredAtendimentos, setFilteredAtendimentos] = useState([]);
    const [currentUser, setCurrentUser] = useState(null);

    const [personas, setPersonas] = useState([]);
    const [statusOptions, setStatusOptions] = useState([]);

    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    const [searchTerm, setSearchTerm] = useState('');
    // --- ALTERADO: activeFilters agora guarda os status, activeButtonGroup guarda o botão ativo ---
    const [activeFilters, setActiveFilters] = useState(['Atendente Chamado']);
    const [activeButtonGroup, setActiveButtonGroup] = useState('atendimentos'); // 'atendimentos' ou 'bot_ia'

    // --- NOVO: Estado para o termo de busca com debounce ---
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState(searchTerm);

    // --- NOVOS ESTADOS PARA FILTRO DETALHADO ---
    const [isFilterPopoverOpen, setIsFilterPopoverOpen] = useState(false);
    const [statusFilters, setStatusFilters] = useState(null); // ALTERADO: Agora é string ou null
    const [tagFilters, setTagFilters] = useState(null); // ALTERADO: Agora é string ou null

    // --- NOVOS ESTADOS PARA FILTRO DE HORÁRIO ---
    const [timeStart, setTimeStart] = useState('');
    const [timeEnd, setTimeEnd] = useState('');


    const [selectedAtendimento, setSelectedAtendimento] = useState(null);
    const [totalAtendimentos, setTotalAtendimentos] = useState(0);
    
    // --- ALTERADO: Estado para controlar o limite de carregamento, com persistência no localStorage ---
    const [limit, setLimit] = useState(() => {
        const savedLimit = localStorage.getItem('atendimentosLimit');
        const initialLimit = parseInt(savedLimit, 10);
        // Retorna o valor salvo se for um número válido, senão, o padrão 20.
        return !isNaN(initialLimit) && initialLimit > 0 ? initialLimit : 20;
    });

    // --- NOVO: Estado para o loading do botão "Carregar Mais" ---
    const [isFetchingMore, setIsFetchingMore] = useState(false);

    const [modalMedia, setModalMedia] = useState(null); // { url: blobUrl, type: 'image'|'audio', filename: string }
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isDownloadingMedia, setIsDownloadingMedia] = useState(false); // Para feedback no botão
    const currentBlobUrl = useRef(null); // Para limpar a URL do blob anterior

    // --- NOVO: Estado para o modal de template ---
    const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);

    // --- NOVO: Estado para a sidebar de perfil ---
    const [isProfileSidebarOpen, setIsProfileSidebarOpen] = useState(false);

    // --- ALTERADO: Controla qual editor de tag está aberto pelo ID do atendimento ---
    const [openTagEditorId, setOpenTagEditorId] = useState(null);
    const [allTags, setAllTags] = useState([]);

    const intervalRef = useRef(null);

    // Armazena as filas de envio por atendimentoId
    // Ex: { 1: [item1, item2], 2: [item3] }
    const [sendingQueue, setSendingQueue] = useState({});

    // Controla qual fila está ativamente processando um item
    // Ex: { 1: true, 2: false }
    const [isProcessing, setIsProcessing] = useState({});

    // --- Fetch (User e Mensagens) ---
    const fetchData = useCallback(async (isInitialLoad = false) => {
        if (isInitialLoad) setIsLoading(true);

        // Se não for uma carga inicial, significa que pode ser um "carregar mais" ou polling.
        // Ativamos o estado de carregamento se o limite for maior que o inicial.
        if (!isInitialLoad && limit > 20) {
            setIsFetchingMore(true);
        } 

        try {
            // ALTERADO: Removemos todos os parâmetros de filtro da requisição.
            // A API agora buscará todos os atendimentos.
            // A filtragem será feita 100% no frontend.
            const params = new URLSearchParams();
            // Conforme solicitado, definimos um limite alto para buscar todos os dados.
            params.append('limit', 999);
            const [userRes, atendimentosRes, personasRes, situationsRes, tagsRes] = await Promise.all([
                api.get('/auth/me'),
                api.get('/atendimentos/', { params }), // Envia os parâmetros formatados
                api.get('/configs/'),
                api.get('/configs/situations'),
                api.get('/atendimentos/tags') // Busca todas as tags
            ]);
            setCurrentUser(userRes.data);
            setPersonas(personasRes.data);
            setStatusOptions(situationsRes.data);
            setAllTags(tagsRes.data);

            const serverData = atendimentosRes.data;
            if (serverData && Array.isArray(serverData.items)) {
                // ALTERADO: Simplesmente define os atendimentos com o que veio do servidor.
                // A lógica de "carregar mais" não é mais necessária.
                setAtendimentos(serverData.items);
                setTotalAtendimentos(serverData.total);
            } else {
                setAtendimentos(Array.isArray(serverData) ? serverData : []);
                setTotalAtendimentos(0);
            }
            setError('');
        } catch (err) {
            console.error("Erro ao carregar dados:", err);
            if (isInitialLoad) setError('Não foi possível carregar os dados. Verifique a sua conexão.');
        } finally {
            if (isInitialLoad) setIsLoading(false);
            setIsFetchingMore(false);
        }
    }, [sendingQueue, isProcessing]); // ALTERADO: Removidas dependências de filtro

    // --- Efeito: Polling Seguro (COM PAUSA EM SEGUNDO PLANO) ---
    useEffect(() => {
        let isMounted = true;
        let timeoutId;

        const poll = async () => {
            if (!document.hidden) {
                await fetchData(false);
            }
            if (isMounted) {
                timeoutId = setTimeout(poll, 5000);
            }
        };

        fetchData(true).then(() => {
             if (isMounted) timeoutId = setTimeout(poll, 5000);
        });

        const handleVisibilityChange = () => {
            if (!document.hidden && isMounted) {
                // --- ALTERADO: Reseta o limite para o valor inicial correto ---
                setLimit(20);
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

    // --- NOVO: Efeito para aplicar debounce na busca ---
    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedSearchTerm(searchTerm);
        }, 500); // 500ms de delay

        // Limpa o timeout se o usuário continuar digitando
        return () => {
            clearTimeout(handler);
        };
    }, [searchTerm]); // Roda toda vez que o searchTerm "real" muda

    // --- NOVO: Efeito para salvar o limite no localStorage sempre que ele mudar ---
    useEffect(() => {
        localStorage.setItem('atendimentosLimit', limit);
    }, [limit]);

    // --- NOVO: Efeito para resetar o limite ao mudar o filtro ou a busca ---
    useEffect(() => {
        // Toda vez que o filtro ou o termo de busca mudar,
        // reseta o limite para 20. Isso força o `fetchData` a fazer uma nova
        // carga (isNewLoad = true), substituindo a lista em vez de adicionar a ela.
        // É crucial para que os filtros funcionem corretamente.
        // Se os filtros do popover (status/tag/horário) estiverem ativos, o limite é 20.
        setLimit(20);
    }, [activeButtonGroup, debouncedSearchTerm, statusFilters, tagFilters, timeStart, timeEnd]);

    useEffect(() => {
        if (!Array.isArray(mensagens)) {
            setFilteredAtendimentos([]);
            return;
        }
        
        // ALTERADO: Toda a lógica de filtragem agora acontece no frontend.
        let filtered = mensagens;

        // 1. Filtro por Status (botões principais ou popover)
        const activeStatusFilter = statusFilters || (activeFilters.length > 0 ? activeFilters : null);
        if (activeStatusFilter) {
            const filterSet = new Set(Array.isArray(activeStatusFilter) ? activeStatusFilter : [activeStatusFilter]);
            filtered = filtered.filter(at => filterSet.has(at.status));
        }

        // 2. Filtro por Tag
        if (tagFilters) {
            filtered = filtered.filter(at => {
                const atendimentoTags = at.tags || []; // Garante que `tags` seja um array
                return atendimentoTags.some(tag => tag.name === tagFilters);
            });
        }

        // 3. Filtro por Termo de Busca (debounced)
        if (debouncedSearchTerm) {
            const lowercasedTerm = debouncedSearchTerm.toLowerCase();
            filtered = filtered.filter(at =>
                (at.nome_contato && at.nome_contato.toLowerCase().includes(lowercasedTerm)) ||
                (at.whatsapp && at.whatsapp.includes(lowercasedTerm))
            );
        }

        // 4. Filtro por Horário
        if (timeStart || timeEnd) {
            filtered = filtered.filter(at => {
                const lastMessageTs = getLastMessageTimestamp(at);
                if (!lastMessageTs) return false; // Ignora se não houver timestamp

                const messageTime = new Date(lastMessageTs);
                const messageHour = messageTime.getHours();
                const messageMinute = messageTime.getMinutes();

                // Converte HH:mm para minutos totais do dia
                const toMinutes = (timeStr) => {
                    if (!timeStr || !timeStr.includes(':')) return 0;
                    const [h, m] = timeStr.split(':').map(Number);
                    return h * 60 + m;
                };

                const messageTotalMinutes = messageHour * 60 + messageMinute;
                const startTotalMinutes = timeStart ? toMinutes(timeStart) : 0; // Início do dia
                const endTotalMinutes = timeEnd ? toMinutes(timeEnd) : 1439; // Fim do dia (23:59)

                // Verifica se o horário da mensagem está dentro do intervalo
                return messageTotalMinutes >= startTotalMinutes && messageTotalMinutes <= endTotalMinutes;
            });
        }

        // Ordena a lista filtrada (b - a para decrescente, mais novo primeiro)
        const sortedFiltered = [...filtered].sort((a, b) => {
            // Usa a função helper definida fora do componente
            const timeA = getLastMessageTimestamp(a);
            const timeB = getLastMessageTimestamp(b);
            return timeB - timeA;
        });

        // Usa a lista ORDENADA
        setFilteredAtendimentos(sortedFiltered);

        // (Modificado para usar sortedFiltered)
        // Se nada estiver selecionado (carga inicial) E a lista ORDENADA tiver itens
        if (!selectedAtendimento && sortedFiltered.length > 0) {
            setSelectedAtendimento(sortedFiltered[0]);
        }
        // --- FIM DA MODIFICAÇÃO (SELEÇÃO) ---

        // Lógica para atualizar a seleção (se ainda estiver na lista filtrada)
        // (Modificado para usar sortedFiltered)
        else if (selectedAtendimento) {
            const updatedSelected = sortedFiltered.find(at => at.id === selectedAtendimento.id);
            if (updatedSelected) {
                // Compara timestamps para evitar sobrescrever a UI com dados antigos
                const localDate = new Date(selectedAtendimento.updated_at).getTime();
                const serverDate = new Date(updatedSelected.updated_at).getTime();
                if (serverDate >= localDate) {
                    setSelectedAtendimento(updatedSelected);
                }
            } else {
                // O item selecionado não está mais no filtro, des-seleciona
                setSelectedAtendimento(null);
            }
        }
    }, [mensagens, selectedAtendimento, timeStart, timeEnd, debouncedSearchTerm, statusFilters, tagFilters, activeFilters]); // ALTERADO: Adicionadas todas as dependências de filtro

    // --- FUNÇÃO CORRIGIDA PARA USAR AXIOS (api) ---
    const handleViewMedia = async (mediaId, type, filename) => {
        if (!selectedAtendimento || isDownloadingMedia) {
            return;
        }

        // Limpa URL de blob antiga
        if (currentBlobUrl.current) {
            URL.revokeObjectURL(currentBlobUrl.current);
            currentBlobUrl.current = null;
        }

        setIsDownloadingMedia(true);
        const backendMediaUrl = `/atendimentos/${selectedAtendimento.id}/media/${mediaId}`; // URL relativa para Axios

        try {
            // --- USA api.get com responseType: 'blob' ---
            const response = await api.get(backendMediaUrl, {
                responseType: 'blob', // <<<--- ESSENCIAL PARA BAIXAR ARQUIVO
                timeout: 60000 // Aumenta timeout para downloads (60s)
            });

            // Axios trata erros HTTP > 2xx no catch por padrão

            // O 'data' da resposta do Axios já será o Blob
            const blob = response.data;
            // Pega o content-type dos headers da resposta
            const actualContentType = response.headers['content-type'];

            if (blob.size === 0) {
                throw new Error("Download resultou em um arquivo vazio.");
            }
            // --- VERIFICA SE O TIPO É HTML (AINDA INDICA ERRO NO BACKEND/TOKEN) ---
            if (blob.type && blob.type.includes('text/html')) {
                console.error("[handleViewMedia] Recebido HTML em vez de mídia. Provável erro de token no backend.");
                // Tenta ler o HTML para dar uma dica
                try {
                    const htmlText = await blob.text();
                    console.error("[handleViewMedia] Conteúdo HTML recebido:", htmlText.substring(0, 500));
                } catch { /* Ignora se não conseguir ler */ }
                throw new Error("Falha ao baixar mídia: O servidor retornou uma página HTML inesperada. Verifique o token de acesso no backend.");
            }
            // ---------------------------------------------------------------------

            // --- Criar Blob URL e Abrir Modal ---
            const blobUrl = URL.createObjectURL(blob);
            currentBlobUrl.current = blobUrl;

            setModalMedia({ url: blobUrl, type: type, filename: filename });

            setTimeout(() => {
                setIsModalOpen(true);
            }, 0);

        } catch (error) {
            // Axios coloca erros de rede e status >= 300 aqui
            console.error("[handleViewMedia] Erro durante a requisição Axios:", error);
            let alertMessage = "Não foi possível carregar a mídia.";
            if (error.response) {
                // Tenta pegar o 'detail' do erro do FastAPI
                console.error("[handleViewMedia] Axios error response data:", error.response.data);
                console.error("[handleViewMedia] Axios error response status:", error.response.status);
                // Se a resposta for um Blob (mesmo com erro), tenta ler como texto
                if (error.response.data instanceof Blob) {
                    try {
                        const errorBlobText = await error.response.data.text();
                        console.error("[handleViewMedia] Axios error Blob content:", errorBlobText.substring(0, 500));
                        // Tenta parsear como JSON se for texto
                        try {
                            const errorJson = JSON.parse(errorBlobText);
                            alertMessage = `Erro ${error.response.status}: ${errorJson.detail || 'Erro ao carregar mídia.'}`;
                        } catch {
                            alertMessage = `Erro ${error.response.status}: Resposta inesperada do servidor.`;
                        }
                    } catch {
                        alertMessage = `Erro ${error.response.status}: Falha ao ler detalhes do erro.`;
                    }
                } else if (error.response.data?.detail) {
                    alertMessage = `Erro ${error.response.status}: ${error.response.data.detail}`;
                } else {
                    alertMessage = `Erro ${error.response.status}: Falha ao carregar mídia.`;
                }

            } else if (error.request) {
                console.error("[handleViewMedia] Axios error: No response received.");
                alertMessage = "Não foi possível conectar ao servidor para carregar a mídia.";
            } else {
                console.error("[handleViewMedia] Axios error:", error.message);
                alertMessage = `Erro ao preparar a requisição: ${error.message}`;
            }
            alert(alertMessage);

            // Garante limpeza do blobUrl em caso de erro
            if (currentBlobUrl.current) {
                URL.revokeObjectURL(currentBlobUrl.current);
                currentBlobUrl.current = null;
            }
        } finally {
            setIsDownloadingMedia(false);
        }
    };

    // --- FUNÇÃO PARA FECHAR O MODAL E LIMPAR URL (Sem alterações, mas essencial) ---
    const closeModal = () => {
        setIsModalOpen(false);
        setModalMedia(null);
        // Revoga a URL do Blob para liberar memória quando o modal fecha
        if (currentBlobUrl.current) {
            URL.revokeObjectURL(currentBlobUrl.current);
            currentBlobUrl.current = null;
        }
    };

    // --- NOVA FUNÇÃO (Adicione esta função) ---
    const handleDownloadDocument = async (mediaId, filename) => {
        if (!selectedAtendimento || isDownloadingMedia) {
            console.log("handleDownloadDocument blocked: No selection or already downloading.");
            return;
        }

        setIsDownloadingMedia(true);
        console.log(`[handleDownloadDocument] Iniciando download para mediaId: ${mediaId}`);

        // URL relativa ao baseURL do Axios (sem /api/v1)
        const backendMediaUrl = `/atendimentos/${selectedAtendimento.id}/media/${mediaId}`;

        try {
            // AQUI ESTÁ A MÁGICA:
            // Usamos 'api.get', que o seu interceptor vai adicionar o Token.
            const response = await api.get(backendMediaUrl, {
                responseType: 'blob', // Essencial para baixar o arquivo
                timeout: 60000
            });

            const blob = response.data;
            const blobUrl = URL.createObjectURL(blob);

            // Cria um link temporário em memória para forçar o download
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = filename || 'documento'; // Usa o nome do arquivo
            document.body.appendChild(link);
            link.click();

            // Limpa o link e o blobUrl da memória
            document.body.removeChild(link);
            URL.revokeObjectURL(blobUrl);

        } catch (error) {
            console.error("[handleDownloadDocument] Erro durante a requisição Axios:", error);
            // Verifica se o erro foi "Not authenticated" (embora o interceptor deva redirecionar)
            if (error.response && error.response.status === 401) {
                alert("Sua sessão expirou. Você será redirecionado para o login.");
                // O interceptor já deve ter iniciado o redirect, mas garantimos
                window.location.href = '/login';
            } else {
                alert("Não foi possível baixar o documento.");
            }
        } finally {
            setIsDownloadingMedia(false);
        }
    };

    // --- USEEFFECT DE LIMPEZA (Sem alterações, mas essencial) ---
    // Limpa a URL do blob se o componente for desmontado com o modal aberto
    useEffect(() => {
        return () => {
            if (currentBlobUrl.current) {
                URL.revokeObjectURL(currentBlobUrl.current);
            }
        };
    }, []); // Array vazio garante que rode só na montagem/desmontagem



    const addOptimisticMessage = (atendimentoId, msg) => {
        setAtendimentos(prev =>
            prev.map(at => {
                if (at.id === atendimentoId) {
                    const conversa = JSON.parse(at.conversa || '[]');
                    conversa.push(msg);
                    // ALTERADO: Não atualizamos mais o 'updated_at' otimisticamente para evitar que a lista reordene imediatamente.
                    const updatedAt = { ...at, conversa: JSON.stringify(conversa) };

                    // Se for o mensagem selecionado, atualiza a tela principal
                    if (selectedAtendimento?.id === atendimentoId) {
                        setSelectedAtendimento(prev => ({ ...prev, conversa: JSON.stringify(conversa) }));
                    }
                    return updatedAt;
                }
                return at;
            })
        );
    };

    const updateAtendimentoState = (atendimentoId, updatedAtendimento) => {
        setAtendimentos(prev =>
            prev.map(at => (at.id === atendimentoId ? updatedAtendimento : at))
        );
        if (selectedAtendimento?.id === atendimentoId) {
            setSelectedAtendimento(updatedAtendimento);
        }
    }

    const setMessageToError = (atendimentoId, optimisticId, errorMessage) => {
        setAtendimentos(prev =>
            prev.map(at => {
                if (at.id === atendimentoId) {
                    const conversa = JSON.parse(at.conversa || '[]');
                    const updatedConversa = conversa.map(msg =>
                        msg.id === optimisticId
                            ? { ...msg, type: 'error', status: 'error', content: errorMessage } // Atualiza a mensagem 'sending' para 'error'
                            : msg
                    );
                    const revertedAt = { ...at, conversa: JSON.stringify(updatedConversa) };

                    if (selectedAtendimento?.id === atendimentoId) {
                        setSelectedAtendimento(revertedAt);
                    }
                    return revertedAt;
                }
                return at;
            })
        );
    }


    // --- ADICIONE ESTE NOVO useEffect (PROCESSADOR DA FILA) ---
    useEffect(() => {
        // Itera sobre todas as filas de mensagem
        Object.keys(sendingQueue).forEach(atendimentoId_str => {
            const atendimentoId = parseInt(atendimentoId_str, 10);
            const queue = sendingQueue[atendimentoId] || [];
            const isQueueBusy = isProcessing[atendimentoId];

            // Se esta fila tem itens e NÃO está ocupada processando
            if (queue.length > 0 && !isQueueBusy) {

                // 1. Marca a fila como "ocupada"
                setIsProcessing(prev => ({ ...prev, [atendimentoId]: true }));

                // 2. Pega o primeiro item da fila
                const itemToProcess = queue[0];

                // 3. Define a função de processamento assíncrona
                const processItem = async () => {
                    let localUrlToRevoke = null; // Guarda a URL do blob para limpar no final

                    try {
                        let responseAtendimento;

                        if (itemToProcess.type === 'text') {
                            // --- Lógica de envio de TEXTO (movida para cá) ---
                            responseAtendimento = await api.post(
                                `/atendimentos/${atendimentoId}/send_message`,
                                itemToProcess.payload // payload é { text: '...' }
                            );

                        } else if (itemToProcess.type === 'media') {
                            // --- Lógica de envio de MÍDIA (movida para cá) ---
                            const { file, mediaType, filename, localUrl } = itemToProcess.payload;
                            localUrlToRevoke = localUrl; // Marca para revogar

                            const formData = new FormData();
                            formData.append('file', file, filename);
                            formData.append('type', mediaType);

                            responseAtendimento = await api.post(
                                `/atendimentos/${atendimentoId}/send_media`,
                                formData,
                                { headers: { 'Content-Type': 'multipart/form-data' } }
                            );
                        }

                        // 4. SUCESSO: Atualiza o estado com a resposta final da API
                        // (A API retorna o 'mensagem' completo e atualizado)
                        updateAtendimentoState(atendimentoId, responseAtendimento.data);

                    } catch (error) {
                        // 5. FALHA: Atualiza a mensagem otimista para um estado de erro
                        console.error(`Falha ao enviar item da fila (ID: ${itemToProcess.id}):`, error);
                        const errorMsg = error.response?.data?.detail || `Falha ao enviar ${itemToProcess.type}.`;
                        setMessageToError(atendimentoId, itemToProcess.id, errorMsg);

                    } finally {
                        // 6. LIMPEZA: Independentemente de sucesso ou falha

                        // Revoga a URL do Blob da mídia (se houver)
                        if (localUrlToRevoke) {
                            URL.revokeObjectURL(localUrlToRevoke);
                        }

                        // Remove o item processado da fila
                        setSendingQueue(prev => {
                            const newQueue = (prev[atendimentoId] || []).slice(1);
                            return { ...prev, [atendimentoId]: newQueue };
                        });

                        // Marca a fila como "livre"
                        setIsProcessing(prev => ({ ...prev, [atendimentoId]: false }));
                    }
                };

                // 7. Executa o processamento
                processItem();
            }
        });
    }, [sendingQueue, isProcessing]); // Dependências do processador


    // --- SUBSTITUA A FUNÇÃO 'handleSendMessage' ---
    /**
     * Ação: Enfileirar Mensagem de TEXTO.
     * (Chamada pelo ChatFooter)
     */
    const handleSendMessage = (text) => {
        if (!selectedAtendimento) return;
        const atendimentoId = selectedAtendimento.id;
        const optimisticId = `local-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

        // 1. Cria a mensagem otimista (agora com tipo 'sending')
        const optimisticMessage = {
            id: optimisticId,
            role: 'assistant',
            type: 'sending', // <-- MODIFICADO
            content: text, // O texto é usado como 'content'
            timestamp: Math.floor(Date.now() / 1000)
        };

        // 2. Adiciona a mensagem otimista à UI
        addOptimisticMessage(atendimentoId, optimisticMessage);

        // 3. Adiciona o item à fila de envio
        const queueItem = {
            id: optimisticId,
            type: 'text',
            payload: { text } // Payload que a API espera
        };

        setSendingQueue(prev => ({
            ...prev,
            [atendimentoId]: [...(prev[atendimentoId] || []), queueItem]
        }));
    };


    // --- SUBSTITUA A FUNÇÃO 'handleSendMedia' ---
    // Ação: Enfileirar Mensagem de MÍDIA. (Chamada pelo ChatFooter)
    const handleSendMedia = (file, type, filename) => {
        if (!selectedAtendimento) return;
        const atendimentoId = selectedAtendimento.id;

        const optimisticId = `local-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const localUrl = URL.createObjectURL(file); // URL local para preview

        // 1. Cria a mensagem otimista (tipo 'sending')
        const optimisticMessage = {
            id: optimisticId,
            role: 'assistant',
            type: 'sending',
            content: `Enviando ${type}...`,
            localUrl: localUrl,
            filename: filename,
            timestamp: Math.floor(Date.now() / 1000)
        };

        // 2. Adiciona a mensagem otimista à UI
        addOptimisticMessage(atendimentoId, optimisticMessage);

        // 3. Adiciona o item à fila de envio
        const queueItem = {
            id: optimisticId,
            type: 'media',
            payload: { file, mediaType: type, filename, localUrl } // Payload completo
        };

        setSendingQueue(prev => ({
            ...prev,
            [atendimentoId]: [...(prev[atendimentoId] || []), queueItem]
        }));

        // NOTA: A revogação do localUrl (URL.revokeObjectURL) agora é feita
        // pelo processador da fila (useEffect) no 'finally' block.
    };


    // SUBSTITUA a função 'handleUpdateStatus' por esta:
    const handleUpdateAtendimento = async (atendimentoId, updatePayload) => {
        // updatePayload é um objeto, ex: { status: 'Concluído' } 
        // ou { conversa: '[...]' }

        const originalAtendimentos = [...mensagens];

        // Atualização Otimista
        const updateState = (prev) => prev.map(at => {
            if (at.id === atendimentoId) {
                // Mescla o estado antigo com o payload de atualização
                const updatedAt = {
                    ...at,
                    ...updatePayload,
                    updated_at: new Date().toISOString()
                };

                if (selectedAtendimento?.id === atendimentoId) {
                    setSelectedAtendimento(updatedAt);
                }
                return updatedAt;
            }
            return at;
        });

        setAtendimentos(updateState);
        // Não é necessário chamar setFilteredAtendimentos aqui, 
        // o useEffect[mensagens] cuidará disso.

        try {
            // Chama a API com o payload genérico
            const response = await api.put(`/atendimentos/${atendimentoId}`, updatePayload);

            // Atualiza com dados do servidor (garante consistência)
            const updateWithServerData = (prev) => prev.map(at => (at.id === atendimentoId ? response.data : at));
            setAtendimentos(updateWithServerData);

            if (selectedAtendimento?.id === atendimentoId) {
                setSelectedAtendimento(response.data);
            }
        } catch (err) {
            console.error("Erro ao salvar edição:", err);
            alert('Erro ao guardar as alterações. A interface será revertida.');
            setAtendimentos(originalAtendimentos); // Reverte
        }
    };

    // --- NOVA FUNÇÃO: Enviar mensagem de template ---
    const handleSendTemplate = async (templatePayload) => {
        if (!selectedAtendimento) {
            throw new Error("Nenhum atendimento selecionado."); //
        }
        const atendimentoId = selectedAtendimento.id;
        const optimisticId = `local-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

        // Adiciona uma mensagem otimista de "enviando template"
        addOptimisticMessage(atendimentoId, { id: optimisticId, role: 'assistant', type: 'sending', content: `Enviando template: ${templatePayload.template_name}...`, timestamp: Math.floor(Date.now() / 1000) });

        // A API de template já adiciona a mensagem ao histórico no backend
        // e retorna o atendimento atualizado.
        // A chamada `updateAtendimentoState` irá atualizar a UI com a resposta.
        try {
            const response = await api.post(
                `/atendimentos/${atendimentoId}/send_template`,
                templatePayload
            );
            updateAtendimentoState(atendimentoId, response.data);
        } catch (err) {
            // Em caso de erro, atualiza a mensagem otimista para um estado de erro
            const errorMsg = err.response?.data?.detail || `Falha ao enviar o template.`;
            setMessageToError(atendimentoId, optimisticId, errorMsg);
            console.error("Erro no handleSendTemplate:", err);
            throw err; // Re-lança o erro para o modal poder exibi-lo
        }
    };

    // --- NOVO: Função para carregar mais atendimentos ---
    const handleLoadMore = () => {
        // Ativa o estado de loading imediatamente
        setIsFetchingMore(true);
        // Pega o tamanho de página salvo pelo usuário ou usa o padrão 20.
        const pageSize = parseInt(localStorage.getItem('atendimentosLimit'), 10) || 20;

        // Aumenta o limite e o useEffect de fetchData/polling vai pegar a mudança
        // Adiciona o tamanho da página ao limite atual.
        setLimit(prevLimit => prevLimit + pageSize);
    };

    // --- NOVA FUNÇÃO: Alterna um filtro na lista de filtros ativos ---
    const toggleFilter = (groupName) => {
        const filterGroups = {
            atendimentos: ['Atendente Chamado'],
            bot_ia: ['Mensagem Recebida', 'Aguardando Resposta', 'Gerando Resposta'],
        };

        // Se o botão clicado já está ativo, desativa tudo
        if (activeButtonGroup === groupName) {
            setActiveButtonGroup(null);
            setActiveFilters([]);
        } else {
            // Se outro botão está ativo ou nenhum está, ativa o novo
            setActiveButtonGroup(groupName);
            setActiveFilters(filterGroups[groupName]);
        }
    };

    // --- NOVAS FUNÇÕES PARA O POPOVER DE FILTRO ---
    const handleStatusFilterChange = (statusName) => {
        // Se o status clicado já for o ativo, desativa. Senão, ativa.
        setStatusFilters(prev => (prev === statusName ? null : statusName));
        // Limpa o filtro de tag para garantir exclusividade
        setTagFilters(null);
        // Desativa o grupo de botões principal para evitar conflito
        setActiveButtonGroup(null);
        setActiveFilters([]);
    };

    const handleTagFilterChange = (tagName) => {
        // Se a tag clicada já for a ativa, desativa. Senão, ativa.
        setTagFilters(prev => (prev === tagName ? null : tagName));
        // Limpa o filtro de status para garantir exclusividade
        setStatusFilters(null);
        // Desativa o grupo de botões principal para evitar conflito
        setActiveButtonGroup(null);
        setActiveFilters([]);
    };

    const handleClearAllFilters = () => {
        setStatusFilters(null);
        setTagFilters(null);
        setTimeStart('');
        setTimeEnd('');
    };

    // --- NOVAS FUNÇÕES PARA O EDITOR DE TAGS ---
    const handleToggleTagEditor = (atendimentoId) => {
        setOpenTagEditorId(prevId => (prevId === atendimentoId ? null : atendimentoId));
    };

    const handleAddNewTag = (newTag) => {
        // Adiciona otimisticamente à lista global de tags
        if (!allTags.some(t => t.name.toLowerCase() === newTag.name.toLowerCase())) {
            const updatedAllTags = [...allTags, newTag];
            setAllTags(updatedAllTags);
            // A persistência no backend ocorreria na próxima chamada de `handleUpdateAtendimento`
            // que salva o atendimento com a nova tag. O backend pode criar a tag se não existir.
        }
    };

    if (isLoading && !currentUser) {
        return <div className="flex h-screen items-center justify-center text-gray-600">A carregar interface de mensagens...</div>;
    }

    if (error) {
        return <div className="flex h-screen items-center justify-center text-red-600 p-10">{error}</div>;
    }

    return (
        <div className="flex h-[93vh] bg-white">
            <aside className="w-full md:w-[30%] lg:w-[25%] flex flex-col border-r border-gray-200 min-h-0 relative">
                <div className="relative">
                    <SearchAndFilter
                        searchTerm={searchTerm}
                        setSearchTerm={setSearchTerm}
                        activeButtonGroup={activeButtonGroup}
                        toggleFilter={toggleFilter}
                        onFilterIconClick={() => setIsFilterPopoverOpen(prev => !prev)} // ALTERADO: Verifica se os filtros não são nulos
                        hasActiveFilters={!!statusFilters || !!tagFilters}
                    />
                    <FilterPopover
                        isOpen={isFilterPopoverOpen}
                        onClose={() => setIsFilterPopoverOpen(false)}
                        statusOptions={statusOptions}
                        allTags={allTags}
                        selectedStatus={statusFilters}
                        onStatusChange={handleStatusFilterChange}
                        selectedTags={tagFilters}
                        onTagChange={handleTagFilterChange}
                        onClearFilters={handleClearAllFilters}
                        limit={limit}
                        onLimitChange={setLimit}
                        timeStart={timeStart}
                        onTimeStartChange={setTimeStart}
                        timeEnd={timeEnd}
                        onTimeEndChange={setTimeEnd}
                    />
                </div>
                <div className="flex-1 overflow-y-auto">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-500">
                            <Loader2 size={32} className="animate-spin mb-4" />
                            <p className="text-sm">Carregando atendimentos...</p>
                        </div>
                    ) : (
                        <>
                            {filteredAtendimentos.length > 0 ? (
                                filteredAtendimentos.map((at) => (
                                    <ContactItem
                                        key={at.id}
                                        mensagem={at}
                                        isSelected={selectedAtendimento?.id === at.id}
                                        onSelect={setSelectedAtendimento}
                                        statusOptions={statusOptions}
                                        onUpdateStatus={handleUpdateAtendimento}
                                        getTextColorForBackground={getTextColorForBackground}
                                        // As props de controle de tag foram removidas do ContactItem na etapa anterior, então aqui está correto.
                                        allTags={allTags}
                                        onUpdateTags={handleUpdateAtendimento} // Reutilizado para tags
                                        onAddNewTag={handleAddNewTag}
                                    />
                                ))
                            ) : (
                                <p className="text-center text-gray-500 p-6">
                                    Nenhum atendimento encontrado para este filtro.
                                </p>
                            )}
                            {/* REMOVIDO: O botão "Carregar Mais" não é mais necessário com a filtragem no frontend */}
                        </>
                    )}
                </div>
            </aside>

            {/* --- MODIFICADO: Layout principal agora é flex horizontal --- */}
            <main className="flex-1 flex min-h-0">
                {selectedAtendimento ? (
                    <>
                        {/* Coluna da Conversa (ocupa o espaço restante) */}
                        <div className="flex-1 flex flex-col min-h-0">
                            <header className="flex-shrink-0 flex items-center p-3 bg-white border-b border-gray-200">
                                <div className="w-10 h-10 rounded-full mr-3 flex-shrink-0 bg-gray-300 flex items-center justify-center">
                                    <span className="text-lg font-bold text-white">
                                        {selectedAtendimento.nome_contato
                                            ? (selectedAtendimento.nome_contato || '??').substring(0, 2).toUpperCase()
                                            : (selectedAtendimento.whatsapp || '??').slice(-2)}
                                    </span>
                                </div>
                                <div className="flex-1">
                                    <h2 className="text-md font-semibold text-gray-800">{selectedAtendimento.nome_contato || selectedAtendimento.whatsapp}</h2>
                                </div>
                                <div className="ml-auto">
                                    {/* --- ALTERADO: O botão agora some quando a sidebar está aberta --- */}
                                    <button
                                        onClick={() => setIsProfileSidebarOpen(prev => !prev)}
                                        className={`p-2 rounded-full text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-opacity ${isProfileSidebarOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
                                        title="Ver dados do contato"
                                    >
                                        <MoreVertical size={20} />
                                    </button>
                                </div>
                            </header>
                            <ChatBody
                                mensagem={selectedAtendimento}
                                onViewMedia={handleViewMedia}
                                onDownloadDocument={handleDownloadDocument}
                                isDownloadingMedia={isDownloadingMedia}
                                isLoading={isLoading} // --- ADICIONADO: Passa o estado de loading
                            />
                            <ChatFooter
                                onSendMessage={handleSendMessage}
                                onSendMedia={handleSendMedia}
                                onOpenTemplateModal={() => setIsTemplateModalOpen(true)}
                            />
                        </div>
                        {/* --- MODIFICADO: Animação do Perfil --- */}
                        {/* A sidebar agora é posicionada de forma absoluta em telas menores para deslizar sobre o conteúdo */}
                        {/* Em telas maiores (md), a largura é animada para um efeito de "encolher". A largura máxima é definida no contêiner pai para evitar que ele "salte" durante a animação. */}
                        <div 
                            onMouseLeave={() => setIsProfileSidebarOpen(false)} // --- ADICIONADO: Fecha ao tirar o mouse de cima
                            className={`
                            absolute md:relative top-0 right-0 h-full md:max-w-sm flex-shrink-0
                            transition-all duration-300 ease-in-out
                            ${isProfileSidebarOpen
                                ? 'w-full translate-x-0' // Aberto: largura total no mobile, largura do max-w-sm no desktop
                                : 'w-0 translate-x-full md:translate-x-0' // Fechado: largura 0 e fora da tela no mobile/desktop
                            }
                        `}>
                            {/* O conteúdo só é renderizado se o atendimento existir, e é ocultado quando a sidebar está fechada */}
                            {/* O contêiner interno sempre tem a largura total do pai, garantindo que o conteúdo não quebre o layout. */}
                            <div className={`h-full w-full bg-gray-50 ${!isProfileSidebarOpen && 'overflow-hidden'}`}>
                                <ProfileSidebar
                                    atendimento={selectedAtendimento}
                                    onClose={() => setIsProfileSidebarOpen(false)}
                                    statusOptions={statusOptions}
                                    getTextColorForBackground={getTextColorForBackground}
                                    isOpen={isProfileSidebarOpen}
                                    isTagEditorOpen={openTagEditorId === selectedAtendimento.id}
                                    onToggleTagEditor={handleToggleTagEditor}
                                    allTags={allTags}
                                    onUpdateTags={handleUpdateAtendimento}
                                    onAddNewTag={handleAddNewTag}
                                />
                            </div>
                        </div>
                    </>
                ) : (
                    // --- MODIFICADO: Mostra placeholder de carregamento se a lista principal estiver carregando ---
                    isLoading ? (
                        <div className="flex flex-col items-center justify-center w-full h-full bg-gray-50 text-gray-500">
                            <Loader2 size={32} className="animate-spin mb-4" />
                            <p className="text-sm">A carregar...</p>
                        </div>
                    ) : (
                        <ChatPlaceholder />
                    )
                )}
            </main>

            {/* Renderiza o Modal */}
            <MediaModal
                isOpen={isModalOpen}
                onClose={closeModal} // Usa a função de fechar que limpa a URL
                mediaUrl={modalMedia?.url}
                mediaType={modalMedia?.type}
                filename={modalMedia?.filename}
            />

            {/* --- NOVO: Renderiza o Modal de Template --- */}
            <TemplateModal
                isOpen={isTemplateModalOpen}
                onClose={() => setIsTemplateModalOpen(false)}
                onSend={handleSendTemplate}
                atendimento={selectedAtendimento}
            />

        </div>
    );
}

export default Mensagens;
