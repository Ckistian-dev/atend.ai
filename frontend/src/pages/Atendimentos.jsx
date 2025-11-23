import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api/axiosConfig';
import { Search, MessageSquare, Edit, Trash2, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';

// --- MODAL GENÉRICO ---
const Modal = ({ onClose, children }) => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm animate-fade-in" onClick={onClose}>
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 animate-fade-in-up" onClick={e => e.stopPropagation()}>
            {children}
        </div>
    </div>
);

// --- MODAL DE CONVERSA ---
const ConversationModal = ({ onClose, conversation, contactIdentifier }) => {
    const chatContainerRef = useRef(null);

    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [conversation]);

    let messages = [];
    try {
        messages = conversation ? JSON.parse(conversation) : [];
    } catch (e) {
        console.error("Erro ao analisar JSON da conversa:", e);
    }

    return (
        <Modal onClose={onClose}>
            <div className="h-[80vh] flex flex-col">
                <div className="p-4 border-b bg-gray-50 rounded-t-lg">
                    <h2 className="text-lg font-semibold text-gray-800">Conversa com {contactIdentifier}</h2>
                </div>
                <div ref={chatContainerRef} className="flex-1 p-4 md:p-6 overflow-y-auto space-y-4 bg-[url('https://i.redd.it/qwd83nc4xxf41.jpg')] bg-cover bg-center">
                    {(messages || []).map((msg, index) => { // Added fallback just in case
                        const isAssistant = msg.role === 'assistant';
                        return (
                            <div key={index} className={`flex items-end gap-2 w-full ${isAssistant ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-xs md:max-w-md p-3 rounded-2xl shadow-sm break-words ${isAssistant ? 'bg-blue-600 text-white rounded-br-none' : 'bg-white text-gray-800 rounded-bl-none'}`}>
                                    <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                                </div>
                            </div>
                        );
                    })}
                    {messages.length === 0 && (
                        <div className="flex items-center justify-center h-full">
                            <p className="text-center text-gray-500 bg-white/50 backdrop-blur-sm p-3 rounded-lg italic">
                                Nenhum histórico de conversa.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    );
};

// --- COMPONENTE DE PAGINAÇÃO ---
const Pagination = ({ currentPage, totalPages, onPageChange, totalItems }) => {
    // Não renderiza se não houver páginas suficientes
    if (!totalPages || totalPages <= 1) return null;

    return (
        <div className="flex flex-col sm:flex-row justify-between items-center mt-6 gap-4">
            <p className="text-sm text-gray-600">
                Mostrando página <span className="font-semibold">{currentPage}</span> de <span className="font-semibold">{totalPages}</span> (<span className="font-semibold">{totalItems}</span> {totalItems === 1 ? 'atendimento' : 'atendimentos'})
            </p>
            <div className="flex items-center gap-2">
                <button
                    onClick={() => onPageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="px-3 py-1.5 flex items-center gap-1 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <ChevronLeft size={16} />
                    Anterior
                </button>
                <button
                    onClick={() => onPageChange(currentPage + 1)}
                    disabled={!totalPages || currentPage === totalPages} // Verifica totalPages aqui também
                    className="px-3 py-1.5 flex items-center gap-1 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Próxima
                    <ChevronRight size={16} />
                </button>
            </div>
        </div>
    );
};

// --- MODAL DE EDIÇÃO ---
const EditModal = ({ atendimento, personas, statusOptions, onSave, onClose }) => {
    const [status, setStatus] = useState(atendimento.status);
    // Garante que personaId tenha um valor padrão (null ou o primeiro ID) se o atual for inválido
    const [personaId, setPersonaId] = useState(atendimento.active_persona_id ?? (personas?.[0]?.id ?? null));

    const handleSave = () => {
        // Converte personaId para número ao salvar, tratando null/undefined
        const finalPersonaId = personaId ? parseInt(personaId, 10) : null;
        onSave(atendimento.id, { status, active_persona_id: finalPersonaId });
        onClose();
    };

    // Calcula as opções de persona com segurança
    const personaOptions = Array.isArray(personas)
        ? personas.map(p => <option key={p.id} value={p.id}>{p.nome_config}</option>)
        : [<option key="loading" value="" disabled>Carregando...</option>]; // Adiciona um fallback visual

    return (
        <Modal onClose={onClose}>
            <div className="p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Editar Atendimento</h3>
                <p className="text-sm text-gray-500 mb-6">A alterar o atendimento de: <strong className="text-gray-700">{atendimento.whatsapp}</strong></p>
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Situação</label>
                        <select value={status} onChange={e => setStatus(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm">
                            {(statusOptions || []).map(opt => (
                                <option key={opt.nome} value={opt.nome}>{opt.nome}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Persona Ativa</label>
                        {/* Garante que o valor do select seja uma string ou vazio */}
                        <select value={personaId ?? ''} onChange={e => setPersonaId(e.target.value === '' ? null : parseInt(e.target.value, 10))} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm">
                            <option value="">-- Nenhuma --</option> {/* Opção para selecionar nenhuma persona */}
                            {personaOptions}
                        </select>
                    </div>
                </div>
                <div className="mt-8 flex justify-end gap-4">
                    <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition">Cancelar</button>
                    <button type="button" onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition">Guardar Alterações</button>
                </div>
            </div>
        </Modal>
    );
};

// --- MODAL DE CONFIRMAÇÃO PARA APAGAR ---
const DeleteConfirmationModal = ({ atendimento, onConfirm, onClose }) => (
    <Modal onClose={onClose}>
        <div className="p-6 text-center">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100">
                <AlertTriangle className="h-6 w-6 text-red-600" aria-hidden="true" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-gray-900">Apagar Atendimento</h3>
            <p className="mt-2 text-sm text-gray-500">
                Tem a certeza que quer apagar o atendimento de <strong className="text-gray-700">{atendimento?.whatsapp ?? 'Contato Desconhecido'}</strong>? Esta ação não pode ser desfeita.
            </p>
            <div className="mt-6 flex justify-center gap-4">
                <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition">Cancelar</button>
                <button type="button" onClick={() => atendimento && onConfirm(atendimento.id)} className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition" disabled={!atendimento}>Sim, Apagar</button>
            </div>
        </div>
    </Modal>
);


// --- COMPONENTE PRINCIPAL DA PÁGINA ---
function Atendimentos() {
    const [atendimentos, setAtendimentos] = useState([]);
    const [personas, setPersonas] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    const [searchParams, setSearchParams] = useSearchParams(); // Adicionado setSearchParams
    const [searchTerm, setSearchTerm] = useState(searchParams.get('search') || '');

    const [modalData, setModalData] = useState({ type: null, data: null });

    const [statusOptions, setStatusOptions] = useState([]); // Agora é dinâmico
    const [userData, setUserData] = useState(null); // Novo

    const [currentPage, setCurrentPage] = useState(parseInt(searchParams.get('page') || '1', 10)); // Lê a página da URL
    const [totalPages, setTotalPages] = useState(0);
    const [totalAtendimentos, setTotalAtendimentos] = useState(0);
    const [limit] = useState(20);

    // Ref para evitar fetch duplicado no modo Strict do React
    const initialFetchDone = useRef(false);

    const fetchData = useCallback(async (isInitialLoad = false) => {
        // Evita loading piscando em polls
        if (isInitialLoad && !initialFetchDone.current) {
            setIsLoading(true);
        }
        setError(''); // Limpa erro anterior
        try {
            const params = {
                search: searchTerm,
                page: currentPage,
                limit: limit
            };
            const [atendimentosRes, personasRes, userRes, situationsRes] = await Promise.all([
                api.get('/atendimentos/', { params }),
                api.get('/configs/'),
                api.get('/auth/me'),
                api.get('/configs/situations') // <-- ADICIONADO: Busca as situações
            ]);

            setAtendimentos(atendimentosRes.data.items);
            setTotalAtendimentos(atendimentosRes.data.total);
            setTotalPages(Math.ceil(atendimentosRes.data.total / limit));
            setPersonas(personasRes.data);
            setUserData(userRes.data);
            setStatusOptions(situationsRes.data); // <-- ADICIONADO: Define o estado com os dados da API

            // Atualiza a URL com os parâmetros atuais
            setSearchParams(params, { replace: true });

        } catch (err) {
            console.error("Erro ao buscar dados:", err); // Log mais detalhado
            setError('Não foi possível carregar os dados. Verifique a sua conexão ou tente recarregar a página.');
            // Não limpa o intervalo aqui, pode ser um erro temporário
        } finally {
            if (isInitialLoad) {
                setIsLoading(false);
                initialFetchDone.current = true; // Marca que o fetch inicial foi feito
            }
        }
    }, [searchTerm, currentPage, limit, setSearchParams]); // Adiciona setSearchParams

    // --- CORREÇÃO DE POLLING (COM PAUSA EM SEGUNDO PLANO) ---
    useEffect(() => {
        let isMounted = true;
        let timeoutId;

        const poll = async () => {
            // Só busca dados se a página estiver VISÍVEL
            if (!document.hidden) {
                await fetchData(false);
            }

            if (isMounted) {
                // Agenda o próximo ciclo 5s DEPOIS que o atual terminar
                timeoutId = setTimeout(poll, 5000);
            }
        };

        // Lógica de Inicialização
        if (!initialFetchDone.current) {
            // Se é a primeira vez, faz o fetch inicial com loading
            fetchData(true).then(() => {
                if (isMounted) timeoutId = setTimeout(poll, 5000);
            });
        } else {
            // Se já carregou antes (ex: re-render), inicia o polling direto
            poll();
        }

        // Força atualização imediata ao voltar para a aba
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


    const getPersonaNameById = (id) => {
        // Adiciona verificação se personas é array
        if (!Array.isArray(personas)) return 'Carregando...';
        return personas.find(p => p.id === id)?.nome_config || 'Nenhuma';
    };

    const handleCloseModals = () => setModalData({ type: null, data: null });

    const handlePageChange = (newPage) => {
        // Verifica limites antes de mudar a página
        if (newPage >= 1 && (!totalPages || newPage <= totalPages)) {
            setCurrentPage(newPage);
            initialFetchDone.current = false; // Força recarregar com loading ao mudar de página
        }
    };

    const handleSaveEdit = async (atendimentoId, updates) => {
        const originalAtendimentos = [...atendimentos]; // Guarda estado original
        // Atualização Otimista
        setAtendimentos(prev =>
            prev.map(at => at.id === atendimentoId ? { ...at, ...updates, updated_at: new Date().toISOString() } : at)
        );
        handleCloseModals(); // Fecha modal otimistamente

        try {
            const response = await api.put(`/atendimentos/${atendimentoId}`, updates);
            // Atualiza com dados do servidor (garante consistência)
            setAtendimentos(prev =>
                prev.map(at => at.id === atendimentoId ? response.data : at)
            );
        } catch (err) {
            console.error("Erro ao salvar edição:", err);
            alert('Erro ao guardar as alterações. A interface será revertida.');
            setAtendimentos(originalAtendimentos); // Reverte
        }
    };

    const handleConfirmDelete = async (atendimentoId) => {
        const originalAtendimentos = [...atendimentos]; // Guarda estado original
        // Atualização otimista
        setAtendimentos(prev => prev.filter(at => at.id !== atendimentoId));
        setTotalAtendimentos(prev => prev - 1); // Atualiza contador otimista
        handleCloseModals();

        try {
            await api.delete(`/atendimentos/${atendimentoId}`);
            // Opcional: Forçar refetch para garantir consistência total se a paginação for afetada
            // fetchData(false); 
        } catch (err) {
            console.error("Erro ao apagar atendimento:", err);
            alert('Erro ao apagar o atendimento. A lista será recarregada.');
            setAtendimentos(originalAtendimentos); // Reverte
            setTotalAtendimentos(prev => prev + 1); // Reverte contador
            // Força refetch em caso de erro
            initialFetchDone.current = false;
            fetchData(true);
        }
    };

    // --- NOVA FUNÇÃO DE ESTILO (DINÂMICA) ---
    const getStatusStyleAndClass = (status) => {
        const baseClasses = "px-3 py-1 text-xs font-semibold rounded-full inline-block text-center min-w-[140px]";
        const situacao = statusOptions.find(opt => opt.nome === status);

        if (situacao && situacao.cor) {
            try {
                return {
                    style: { backgroundColor: situacao.cor },
                    className: `${baseClasses} text-white` // Força texto branco
                };
            } catch (e) {
                // Cor inválida, retorna estilo padrão
            }
        }
        // Fallback para status não encontrados na lista (ou cor inválida)
        return { style: {}, className: `${baseClasses} bg-gray-100 text-gray-600` };
    };

    return (
        <div className="p-6 md:p-10 bg-gray-50 min-h-screen">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-gray-800">Atendimentos</h1>
                    <p className="text-gray-500 mt-1">Visualize e gerencie todas as conversas ativas.</p>
                </div>
            </div>

            {/* Mostra erro global se houver */}
            {error && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
                    <strong className="font-bold">Erro: </strong>
                    <span className="block sm:inline">{error}</span>
                </div>
            )}


            <div className="bg-white p-6 rounded-xl shadow-md border border-gray-200">
                <div className="relative mb-4">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                    <input
                        type="text"
                        placeholder="Pesquisar por telefone, situação ou observação..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="border-b-2 border-gray-200">
                            <tr>
                                <th className="p-4 text-sm font-semibold text-gray-600">Contato (WhatsApp)</th>
                                <th className="p-4 text-sm font-semibold text-gray-600">Última Atualização</th>
                                <th className="p-4 text-sm font-semibold text-gray-600 text-center">Situação</th>
                                <th className="p-4 text-sm font-semibold text-gray-600">Observação da IA</th>
                                <th className="p-4 text-sm font-semibold text-gray-600 text-center">Persona Ativa</th>
                                <th className="p-4 text-sm font-semibold text-gray-600 text-center">Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading ? (
                                <tr><td colSpan="6" className="text-center p-8 text-gray-500">A carregar atendimentos...</td></tr>
                            ) : (
                                (atendimentos || []).map((at) => { // Fallback principal aqui
                                    const renderProps = getStatusStyleAndClass(at.status);
                                    return (
                                        <tr key={at.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                                            <td className="p-4 font-medium text-gray-800">{at.whatsapp ?? 'N/A'}</td> {/* Fallback para contato */}
                                            <td className="p-4 text-sm text-gray-600">{at.updated_at ? new Date(at.updated_at).toLocaleString('pt-BR') : 'N/A'}</td> {/* Fallback para data */}
                                            <td className="p-4 text-center">
                                                <span className={renderProps.className} style={renderProps.style}>
                                                    {at.status ?? 'N/A'}
                                                </span>
                                            </td>
                                            <td className="p-4 text-sm text-gray-600 max-w-xl truncate" title={at.observacoes}> {/* Removido truncate */}
                                                {at.observacoes ? (
                                                    <p className="line-clamp-2">{at.observacoes}</p> // Usa line-clamp se quiser limitar visualmente
                                                ) : (
                                                    <span className="text-gray-400 italic">Nenhuma</span>
                                                )}
                                            </td>
                                            <td className="p-4 text-sm text-gray-600 text-center">{getPersonaNameById(at.active_persona_id)}</td>
                                            <td className="p-4 text-center">
                                                <div className="flex justify-center items-center gap-2">
                                                    <button onClick={() => setModalData({ type: 'conversation', data: at })} className="p-2 text-gray-500 hover:text-blue-600 hover:bg-gray-100 rounded-full transition-colors" title="Ver conversa"><MessageSquare size={18} /></button>
                                                    <button onClick={() => setModalData({ type: 'edit', data: at })} className="p-2 text-gray-500 hover:text-green-600 hover:bg-gray-100 rounded-full transition-colors" title="Editar Situação/Persona"><Edit size={18} /></button>
                                                    <button onClick={() => setModalData({ type: 'delete', data: at })} className="p-2 text-gray-500 hover:text-red-600 hover:bg-gray-100 rounded-full transition-colors" title="Apagar Atendimento"><Trash2 size={18} /></button>
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })
                            )}
                        </tbody>
                    </table>

                    {/* Mensagem de "Não encontrado" */}
                    {!isLoading && (!atendimentos || atendimentos.length === 0) && (
                        <div className="text-center p-8 text-gray-500">
                            Nenhum atendimento encontrado {searchTerm ? 'para a sua pesquisa' : ''}.
                        </div>
                    )}
                </div>

                {/* Controles de Paginação */}
                {/* Renderiza mesmo se isLoading for true para evitar CLS, mas botões ficam desabilitados pelo componente Pagination */}
                <Pagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    onPageChange={handlePageChange}
                    totalItems={totalAtendimentos}
                />

            </div>

            {/* Modais */}
            {modalData.type === 'conversation' && modalData.data && <ConversationModal onClose={handleCloseModals} conversation={modalData.data.conversa} contactIdentifier={modalData.data.atendimentos?.whatsapp} />}
            {modalData.type === 'edit' && modalData.data && <EditModal onClose={handleCloseModals} atendimento={modalData.data} personas={personas} statusOptions={statusOptions} onSave={handleSaveEdit} />}
            {modalData.type === 'delete' && modalData.data && <DeleteConfirmationModal onClose={handleCloseModals} atendimento={modalData.data} onConfirm={handleConfirmDelete} />}
        </div>
    );
}

export default Atendimentos;