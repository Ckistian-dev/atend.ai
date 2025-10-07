import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api/axiosConfig'; 
import { Search, MessageSquare, Edit, Trash2, XCircle, AlertTriangle, Info } from 'lucide-react';

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
        messages = JSON.parse(conversation);
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
                    {messages.map((msg, index) => {
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

// --- MODAL DE EDIÇÃO ---
const EditModal = ({ atendimento, personas, statusOptions, onSave, onClose }) => {
    const [status, setStatus] = useState(atendimento.status);
    const [personaId, setPersonaId] = useState(atendimento.active_persona_id);

    const handleSave = () => {
        onSave(atendimento.id, { status, active_persona_id: personaId });
        onClose();
    };

    return (
        <Modal onClose={onClose}>
            <div className="p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Editar Atendimento</h3>
                <p className="text-sm text-gray-500 mb-6">A alterar o atendimento de: <strong className="text-gray-700">{atendimento.contact.whatsapp}</strong></p>
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Situação</label>
                        <select value={status} onChange={e => setStatus(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm">
                            {statusOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Persona Ativa</label>
                        <select value={personaId} onChange={e => setPersonaId(parseInt(e.target.value))} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm">
                            {personas.map(p => <option key={p.id} value={p.id}>{p.nome_config}</option>)}
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
                Tem a certeza que quer apagar o atendimento de <strong className="text-gray-700">{atendimento?.contact?.whatsapp}</strong>? Esta ação não pode ser desfeita.
            </p>
            <div className="mt-6 flex justify-center gap-4">
                <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition">Cancelar</button>
                <button type="button" onClick={() => onConfirm(atendimento.id)} className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition">Sim, Apagar</button>
            </div>
        </div>
    </Modal>
);


// --- COMPONENTE PRINCIPAL DA PÁGINA ---
function Atendimentos() {
    const [atendimentos, setAtendimentos] = useState([]);
    const [filteredAtendimentos, setFilteredAtendimentos] = useState([]);
    const [personas, setPersonas] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    
    const [searchParams] = useSearchParams();
    const [searchTerm, setSearchTerm] = useState(searchParams.get('search') || '');

    const [modalData, setModalData] = useState({ type: null, data: null });

    const statusOptions = ["Aguardando Resposta", "Mensagem Recebida", "Ignorar Contato", "Atendente Chamado", "Concluído"];

    const fetchData = useCallback(async () => {
        try {
            const [atendimentosRes, personasRes] = await Promise.all([api.get('/atendimentos/'), api.get('/configs/')]);
            setAtendimentos(atendimentosRes.data);
            setPersonas(personasRes.data);
        } catch (err) {
            setError('Não foi possível carregar os atendimentos.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 5000);
        return () => clearInterval(interval);
    }, [fetchData]);

    useEffect(() => {
        const lowercasedFilter = searchTerm.toLowerCase();
        const filtered = atendimentos.filter(item =>
            item.contact.whatsapp.toLowerCase().includes(lowercasedFilter) ||
            item.status.toLowerCase().includes(lowercasedFilter) ||
            (item.observacoes && item.observacoes.toLowerCase().includes(lowercasedFilter))
        );
        setFilteredAtendimentos(filtered);
    }, [searchTerm, atendimentos]);

    const getPersonaNameById = (id) => personas.find(p => p.id === id)?.nome_config || 'N/A';
    const handleCloseModals = () => setModalData({ type: null, data: null });

    const handleSaveEdit = async (atendimentoId, updates) => {
        try {
            await api.put(`/atendimentos/${atendimentoId}`, updates);
            fetchData();
        } catch (err) {
            alert('Erro ao guardar as alterações.');
        }
    };

    const handleConfirmDelete = async (atendimentoId) => {
        try {
            await api.delete(`/atendimentos/${atendimentoId}`);
            fetchData();
            handleCloseModals();
        } catch (err) {
            alert('Erro ao apagar o atendimento.');
        }
    };

    const getStatusClass = (status) => {
        const baseClasses = "px-3 py-1 text-xs font-semibold rounded-full inline-block text-center min-w-[140px]";
        switch (status) {
            case 'Mensagem Recebida':
                return `${baseClasses} bg-blue-100 text-blue-800`;
            case 'Concluído':
                return `${baseClasses} bg-green-100 text-green-800`;
            case 'Aguardando Resposta':
                return `${baseClasses} bg-yellow-100 text-yellow-800`;
            case 'Atendente Chamado':
                return `${baseClasses} bg-orange-100 text-orange-800`;
            case 'Erro IA':
                return `${baseClasses} bg-red-200 text-red-800`;
            case 'Ignorar Contato':
                return `${baseClasses} bg-gray-200 text-gray-700`;
            default:
                return `${baseClasses} bg-gray-100 text-gray-600`;
        }
    };

    return (
        <div className="p-6 md:p-10 bg-gray-50 min-h-screen">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-gray-800">Atendimentos</h1>
                    <p className="text-gray-500 mt-1">Visualize e gerencie todas as conversas ativas.</p>
                </div>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-md border border-gray-200">
                <div className="relative mb-4">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                    <input type="text" placeholder="Pesquisar por telefone, situação ou observação..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="border-b-2 border-gray-200">
                            <tr>
                                <th className="p-4 text-sm font-semibold text-gray-600">Contato (WhatsApp)</th>
                                <th className="p-4 text-sm font-semibold text-gray-600">Última Atualização</th>
                                <th className="p-4 text-sm font-semibold text-gray-600">Situação</th>
                                <th className="p-4 text-sm font-semibold text-gray-600">Observação da IA</th>
                                <th className="p-4 text-sm font-semibold text-gray-600">Persona Ativa</th>
                                <th className="p-4 text-sm font-semibold text-gray-600 text-center">Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading ? (
                                <tr><td colSpan="6" className="text-center p-8 text-gray-500">A carregar atendimentos...</td></tr>
                            ) : filteredAtendimentos.map((at) => (
                                <tr key={at.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                                    <td className="p-4 font-medium text-gray-800">{at.contact.whatsapp}</td>
                                    <td className="p-4 text-sm text-gray-600">{new Date(at.updated_at).toLocaleString('pt-BR')}</td>
                                    <td className="p-4">
                                        <span className={getStatusClass(at.status)}>
                                            {at.status}
                                        </span>
                                    </td>
                                    <td className="p-4 text-sm text-gray-600 max-w-xl">
                                        {at.observacoes ? (
                                            <p className="flex items-center gap-2" title={at.observacoes}>
                                                {at.observacoes}
                                            </p>
                                        ) : (
                                            <span className="text-gray-400 italic">Nenhuma</span>
                                        )}
                                    </td>
                                    <td className="p-4 text-sm text-gray-600">{getPersonaNameById(at.active_persona_id)}</td>
                                    <td className="p-4 text-center">
                                        <div className="flex justify-center items-center gap-2">
                                            <button onClick={() => setModalData({ type: 'conversation', data: at })} className="p-2 text-gray-500 hover:text-blue-600 hover:bg-gray-100 rounded-full transition-colors" title="Ver conversa"><MessageSquare size={18} /></button>
                                            <button onClick={() => setModalData({ type: 'edit', data: at })} className="p-2 text-gray-500 hover:text-green-600 hover:bg-gray-100 rounded-full transition-colors" title="Editar Situação/Persona"><Edit size={18} /></button>
                                            <button onClick={() => setModalData({ type: 'delete', data: at })} className="p-2 text-gray-500 hover:text-red-600 hover:bg-gray-100 rounded-full transition-colors" title="Apagar Atendimento"><Trash2 size={18} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {modalData.type === 'conversation' && <ConversationModal onClose={handleCloseModals} conversation={modalData.data.conversa} contactIdentifier={modalData.data.contact.whatsapp} />}
            {modalData.type === 'edit' && <EditModal onClose={handleCloseModals} atendimento={modalData.data} personas={personas} statusOptions={statusOptions} onSave={handleSaveEdit} />}
            {modalData.type === 'delete' && <DeleteConfirmationModal onClose={handleCloseModals} atendimento={modalData.data} onConfirm={handleConfirmDelete} />}
        </div>
    );
}

export default Atendimentos;