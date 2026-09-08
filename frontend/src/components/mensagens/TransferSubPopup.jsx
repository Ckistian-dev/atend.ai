import React, { useState, useRef, useEffect } from 'react';
import { X, Headset, Building2, User, Loader2, Check } from 'lucide-react';
import api from '../../api/axiosConfig';
import toast from 'react-hot-toast';

const TransferSubPopup = ({
    currentDepartment = null,
    currentUserId = null,
    onConfirm,
    onClose
}) => {
    const [departments, setDepartments] = useState([]);
    const [users, setUsers] = useState([]);
    const [selectedDept, setSelectedDept] = useState(currentDepartment || '');
    const [customDept, setCustomDept] = useState('');
    const [selectedUserId, setSelectedUserId] = useState(currentUserId ? String(currentUserId) : '');
    const [notes, setNotes] = useState('');
    const [loadingData, setLoadingData] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const popupRef = useRef(null);
    const inputRef = useRef(null);

    // Fechar ao clicar fora
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (popupRef.current && !popupRef.current.contains(event.target)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [onClose]);

    // Carregar setores e atendentes
    useEffect(() => {
        let isMounted = true;
        const loadResources = async () => {
            setLoadingData(true);
            try {
                const [deptsRes, usersRes] = await Promise.all([
                    api.get('/atendimentos/departments').catch(() => ({ data: [] })),
                    api.get('/users/').catch(() => ({ data: [] }))
                ]);
                if (!isMounted) return;

                const deptList = new Set(deptsRes.data || []);
                (usersRes.data || []).forEach(u => {
                    if (u.department && u.department.trim()) {
                        deptList.add(u.department.trim());
                    }
                });
                setDepartments(Array.from(deptList).sort());
                setUsers(usersRes.data || []);
            } catch (err) {
                console.error("Erro ao carregar opções de transferência:", err);
            } finally {
                if (isMounted) setLoadingData(false);
            }
        };

        loadResources();
        return () => { isMounted = false; };
    }, []);

    const handleConfirm = async (e) => {
        e.preventDefault();

        const finalDept = customDept.trim() || selectedDept.trim() || null;
        const finalUserId = selectedUserId ? parseInt(selectedUserId, 10) : null;

        if (!finalDept && !finalUserId) {
            toast.error('Informe um setor ou um atendente.');
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
            console.error("Erro ao transferir:", err);
        } finally {
            setIsSubmitting(false);
        }
    };

    const filteredUsers = selectedDept
        ? users.filter(u => !u.department || u.department.toLowerCase() === selectedDept.toLowerCase())
        : users;

    return (
        <div
            ref={popupRef}
            className="w-36 sm:w-56 bg-white rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.2),0_0_0_1px_rgba(0,0,0,0.06)] z-[200] border border-slate-100 p-3.5 animate-fade-in-up-fast"
            onClick={(e) => e.stopPropagation()}
        >
            <form onSubmit={handleConfirm} className="space-y-2.5">
                {/* Header */}
                <div className="flex justify-between items-center px-1 pb-1 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shadow-xs">
                            <Headset size={13} />
                        </div>
                        <p className="editorial-label text-slate-900 font-extrabold text-[12px]">Transferir Atendimento</p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-6 h-6 flex items-center justify-center rounded-lg bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-all cursor-pointer"
                        title="Fechar"
                    >
                        <X size={13} />
                    </button>
                </div>

                {loadingData ? (
                    <div className="py-6 flex flex-col items-center justify-center gap-2 text-slate-400">
                        <Loader2 className="animate-spin text-blue-600" size={20} />
                        <span className="text-[10px] font-semibold">Carregando setores...</span>
                    </div>
                ) : (
                    <>
                        {/* Setor: Chips Rápidos */}
                        {departments.length > 0 && (
                            <div>
                                <label className="block text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1">
                                    Setor de Destino
                                </label>
                                <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto custom-scrollbar p-0.5">
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
                                                className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 border cursor-pointer ${isSelected
                                                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                                    : 'bg-slate-50 text-slate-600 border-slate-200/80 hover:bg-blue-50/60 hover:border-blue-200'
                                                    }`}
                                            >
                                                <Building2 size={10} className={isSelected ? 'text-white' : 'text-blue-500'} />
                                                <span className="truncate max-w-[100px]">{dep}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Digitar outro setor */}
                        <div className="relative">
                            <Building2 size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            <input
                                ref={inputRef}
                                type="text"
                                placeholder={departments.length > 0 ? "Ou digite outro setor..." : "Nome do setor (ex: SAC, Vendas)..."}
                                value={customDept}
                                onChange={(e) => {
                                    setCustomDept(e.target.value);
                                    if (e.target.value) setSelectedDept('');
                                }}
                                className="w-full h-8 pl-8 pr-3 text-[11px] bg-slate-50 rounded-xl border border-transparent focus:bg-white focus:border-blue-100 focus:ring-2 focus:ring-blue-50/50 outline-none transition-all font-semibold text-slate-700 placeholder:text-slate-400"
                            />
                        </div>

                        {/* Atendente Específico */}
                        <div>
                            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1">
                                Atendente (Opcional)
                            </label>
                            <div className="relative">
                                <User size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                <select
                                    value={selectedUserId}
                                    onChange={(e) => setSelectedUserId(e.target.value)}
                                    className="w-full h-8 pl-8 pr-6 text-[11px] bg-slate-50 rounded-xl border border-transparent focus:bg-white focus:border-blue-100 focus:ring-2 focus:ring-blue-50/50 outline-none transition-all font-semibold text-slate-700 appearance-none cursor-pointer truncate"
                                >
                                    <option value="">Qualquer atendente da equipe</option>
                                    {filteredUsers.map(u => (
                                        <option key={u.id} value={u.id}>
                                            {u.name || u.email} {u.department ? `(${u.department})` : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Observação rápida */}
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Motivo / obs interna (opcional)..."
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                className="w-full h-8 px-3 text-[11px] bg-slate-50 rounded-xl border border-transparent focus:bg-white focus:border-blue-100 focus:ring-2 focus:ring-blue-50/50 outline-none transition-all font-medium text-slate-700 placeholder:text-slate-400"
                            />
                        </div>

                        {/* Botões de Ação */}
                        <div className="pt-1 flex gap-2">
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex-1 py-2 text-[10px] font-bold text-slate-500 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                disabled={isSubmitting || loadingData}
                                className="flex-1 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-[10px] font-black uppercase tracking-wider rounded-xl shadow-md shadow-blue-200/50 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer active:scale-95"
                            >
                                {isSubmitting ? (
                                    <>
                                        <Loader2 size={11} className="animate-spin" />
                                        <span>Transferindo</span>
                                    </>
                                ) : (
                                    <>
                                        <Check size={12} strokeWidth={3} />
                                        <span>Transferir</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </>
                )}
            </form>
        </div>
    );
};

export default TransferSubPopup;
