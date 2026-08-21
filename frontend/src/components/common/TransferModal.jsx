import React, { useState, useEffect } from 'react';
import { X, ArrowRightLeft, Users, User, Building2, FileText, Loader2, Check, Sparkles } from 'lucide-react';
import api from '../../api/axiosConfig';
import toast from 'react-hot-toast';

const TransferModal = ({
    isOpen,
    onClose,
    onConfirm,
    currentDepartment = null,
    currentUserId = null,
    atendimentoName = '',
    atendimentoWhatsapp = ''
}) => {
    const [departments, setDepartments] = useState([]);
    const [users, setUsers] = useState([]);
    const [selectedDept, setSelectedDept] = useState('');
    const [customDept, setCustomDept] = useState('');
    const [selectedUserId, setSelectedUserId] = useState('');
    const [notes, setNotes] = useState('');
    const [loadingData, setLoadingData] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (!isOpen) return;

        setSelectedDept(currentDepartment || '');
        setCustomDept('');
        setSelectedUserId(currentUserId ? String(currentUserId) : '');
        setNotes('');

        const loadResources = async () => {
            setLoadingData(true);
            try {
                const [deptsRes, usersRes] = await Promise.all([
                    api.get('/atendimentos/departments').catch(() => ({ data: [] })),
                    api.get('/users/').catch(() => ({ data: [] }))
                ]);

                const deptList = new Set(deptsRes.data || []);
                (usersRes.data || []).forEach(u => {
                    if (u.department && u.department.trim()) {
                        deptList.add(u.department.trim());
                    }
                });
                setDepartments(Array.from(deptList).sort());
                setUsers(usersRes.data || []);
            } catch (err) {
                console.error("Erro ao carregar dados para transferência:", err);
            } finally {
                setLoadingData(false);
            }
        };

        loadResources();
    }, [isOpen, currentDepartment, currentUserId]);

    if (!isOpen) return null;

    const handleConfirm = async (e) => {
        e.preventDefault();

        const finalDept = customDept.trim() || selectedDept.trim() || null;
        const finalUserId = selectedUserId ? parseInt(selectedUserId, 10) : null;

        if (!finalDept && !finalUserId) {
            toast.error('Selecione pelo menos um setor ou um atendente responsável.');
            return;
        }

        setIsSubmitting(true);
        try {
            await onConfirm({
                department: finalDept,
                user_id: finalUserId,
                notes: notes.trim() || null
            });
            onClose();
        } catch (err) {
            console.error("Erro ao executar transferência:", err);
        } finally {
            setIsSubmitting(false);
        }
    };

    // Filtra usuários se um setor foi selecionado
    const filteredUsers = selectedDept && selectedDept !== '__NEW__'
        ? users.filter(u => !u.department || u.department.toLowerCase() === selectedDept.toLowerCase())
        : users;

    return (
        <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(8px)' }}
            onClick={onClose}
        >
            <div 
                className="bg-white w-full max-w-lg rounded-[2rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-fade-in-up border border-slate-100"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-6 py-5 bg-gradient-to-r from-blue-600 to-indigo-700 text-white flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-white/15 backdrop-blur-md flex items-center justify-center text-white border border-white/20 shadow-inner">
                            <ArrowRightLeft size={20} />
                        </div>
                        <div>
                            <h3 className="text-base font-extrabold tracking-tight">Transferir Atendimento</h3>
                            <p className="text-xs text-white/80 font-medium">
                                {atendimentoName || atendimentoWhatsapp || 'Contato'}
                            </p>
                        </div>
                    </div>
                    <button 
                        onClick={onClose}
                        className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/80 hover:text-white transition-all"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Body Form */}
                <form onSubmit={handleConfirm} className="p-6 space-y-5 overflow-y-auto flex-1 custom-scrollbar">
                    {loadingData ? (
                        <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-400">
                            <Loader2 className="animate-spin text-blue-600" size={28} />
                            <span className="text-xs font-semibold">Carregando setores e atendentes...</span>
                        </div>
                    ) : (
                        <>
                            {/* Setor de Destino */}
                            <div className="space-y-2">
                                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                                    1. Setor / Equipe de Destino (ex: SAC, RH, Vendas)
                                </label>
                                
                                {/* Botões rápidos de Setores */}
                                {departments.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 mb-2">
                                        {departments.map(dep => {
                                            const isSelected = selectedDept.toLowerCase() === dep.toLowerCase();
                                            return (
                                                <button
                                                    key={dep}
                                                    type="button"
                                                    onClick={() => {
                                                        setSelectedDept(isSelected ? '' : dep);
                                                        setCustomDept('');
                                                    }}
                                                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border ${
                                                        isSelected
                                                            ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-500/20'
                                                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-blue-50/50 hover:border-blue-300'
                                                    }`}
                                                >
                                                    <Building2 size={12} className={isSelected ? 'text-white' : 'text-blue-500'} />
                                                    {dep}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}

                                {/* Digitar outro setor */}
                                <div className="relative">
                                    <input
                                        type="text"
                                        placeholder="Ou digite o nome de outro setor..."
                                        value={customDept}
                                        onChange={(e) => {
                                            setCustomDept(e.target.value);
                                            if (e.target.value) setSelectedDept('');
                                        }}
                                        className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-800 placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                                    />
                                    <Building2 size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                </div>
                            </div>

                            {/* Atendente Específico (Opcional) */}
                            <div className="space-y-2">
                                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                                    2. Atendente Responsável (Opcional)
                                </label>
                                <div className="relative">
                                    <select
                                        value={selectedUserId}
                                        onChange={(e) => setSelectedUserId(e.target.value)}
                                        className="w-full pl-10 pr-8 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-semibold text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none appearance-none transition-all cursor-pointer"
                                    >
                                        <option value="">Qualquer atendente da equipe / fila geral</option>
                                        {filteredUsers.map(u => (
                                            <option key={u.id} value={u.id}>
                                                {u.name || u.email} {u.department ? `(${u.department})` : ''} {u.role === 'admin' ? '• Admin' : ''}
                                            </option>
                                        ))}
                                    </select>
                                    <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                </div>
                            </div>

                            {/* Motivo / Anotações de Transferência */}
                            <div className="space-y-2">
                                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                                    3. Motivo da Transferência / Observação interna
                                </label>
                                <div className="relative">
                                    <textarea
                                        rows={2}
                                        placeholder="Ex: Cliente com dúvida de cancelamento após fatura..."
                                        value={notes}
                                        onChange={(e) => setNotes(e.target.value)}
                                        className="w-full p-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-800 placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all resize-none"
                                    />
                                </div>
                            </div>

                            {/* Info Banner */}
                            <div className="p-3.5 rounded-2xl bg-amber-50/70 border border-amber-200/60 text-amber-800 text-[11px] leading-relaxed flex items-start gap-2.5">
                                <Sparkles size={16} className="text-amber-600 shrink-0 mt-0.5" />
                                <div>
                                    O status do atendimento será alterado para <span className="font-bold">"Atendente Chamado"</span> e ficará visível para a equipe selecionada.
                                </div>
                            </div>
                        </>
                    )}

                    {/* Footer Actions */}
                    <div className="pt-3 flex items-center justify-end gap-2.5 border-t border-slate-100">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-all"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting || loadingData}
                            className="px-5 py-2.5 rounded-xl text-xs font-bold text-white shadow-lg shadow-blue-500/25 hover:opacity-90 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
                            style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="animate-spin" size={14} />
                                    Transferindo...
                                </>
                            ) : (
                                <>
                                    <Check size={14} />
                                    Confirmar Transferência
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default TransferModal;
