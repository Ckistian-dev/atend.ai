import React, { useState, useEffect, useCallback } from 'react';
import api from '../api/axiosConfig';
import toast from 'react-hot-toast';
import { Save, Loader2, Plus, Trash2, Clock, History, Info, CheckCircle } from 'lucide-react';
import PageLoader from '../components/common/PageLoader';


const DS = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800;900&family=Inter:wght@400;500;600&display=swap');
.followup-page { font-family: 'Inter', sans-serif; }
.followup-page h1, .followup-page h2, .followup-page h3, .followup-page h4 { font-family: 'Plus Jakarta Sans', sans-serif; }
.followup-input {
    width: 100%;
    padding: 0.75rem 1rem;
    font-size: 0.875rem;
    border-radius: 1rem;
    background: #f8faff;
    border: 1px solid rgba(203,213,225,0.6);
    color: #0f172a;
    outline: none;
    transition: all 0.2s;
}
.followup-input:focus { border-color: #3b82f6; box-shadow: 0 0 0 4px rgba(59,130,246,0.1); background: #fff; }
.premium-tile {
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.premium-tile:hover { transform: translateY(-2px); }
`;

const initialConfig = {
    business_hours: { start: "08:00", end: "18:00", days: [1, 2, 3, 4, 5] },
    intervals: [{ value: 2, unit: 'hours' }, { value: 8, unit: 'hours' }],
    auto_conclude_days: 0
};

function Followup() {
    const [isActive, setIsActive] = useState(false);
    const [config, setConfig] = useState(initialConfig);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');

    const weekDays = [
        { id: 1, label: 'Seg' }, { id: 2, label: 'Ter' }, { id: 3, label: 'Qua' },
        { id: 4, label: 'Qui' }, { id: 5, label: 'Sex' }, { id: 6, label: 'Sáb' }, { id: 0, label: 'Dom' }
    ];

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            const { data } = await api.get('/auth/me');
            setIsActive(data.followup_active || false);
            const backendConfig = data.followup_config;
            if (backendConfig && backendConfig.intervals) {
                const frontendIntervals = backendConfig.intervals.map(interval => {
                    if (interval.hours < 1) return { value: Math.round(interval.hours * 60), unit: 'minutes' };
                    return { value: interval.hours, unit: 'hours' };
                });
                setConfig({ ...backendConfig, intervals: frontendIntervals, auto_conclude_days: backendConfig.auto_conclude_days || 0 });
            } else {
                setConfig(initialConfig);
            }
        } catch (err) {
            setError('Não foi possível carregar as configurações de follow-up.');
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleSave = async () => {
        setIsSaving(true);
        setError('');
        const configToSave = {
            ...config,
            intervals: config.intervals.map(interval => {
                let hoursValue = interval.value;
                if (interval.unit === 'minutes') hoursValue = interval.value / 60;
                return { hours: hoursValue };
            }),
            auto_conclude_days: parseInt(config.auto_conclude_days, 10) || 0
        };
        try {
            await api.put('/users/me', { followup_active: isActive, followup_config: configToSave });
            toast.success('Configurações salvas com sucesso!');
        } catch (err) {
            setError('Erro ao salvar as configurações.');
            console.error(err);
        } finally {
            setIsSaving(false);
        }
    };

    const handleIntervalChange = (index, field, value) => {
        const newIntervals = [...config.intervals];
        const updatedInterval = { ...newIntervals[index] };
        if (field === 'value') {
            let numValue = parseInt(value, 10);
            if (isNaN(numValue) || numValue < 1) numValue = 1;
            if (updatedInterval.unit === 'hours' && numValue > 168) numValue = 168;
            if (updatedInterval.unit === 'minutes' && numValue > 1440) numValue = 1440;
            updatedInterval.value = numValue;
        } else if (field === 'unit') {
            updatedInterval.unit = value;
            updatedInterval.value = value === 'minutes' ? 30 : 1;
        }
        newIntervals[index] = updatedInterval;
        setConfig(prev => ({ ...prev, intervals: newIntervals }));
    };

    const addInterval = () => {
        if (config.intervals.length >= 6) { toast.error("Máximo de 6 intervalos."); return; }
        setConfig(prev => ({ ...prev, intervals: [...prev.intervals, { value: 24, unit: 'hours' }] }));
    };

    const removeInterval = (index) => setConfig(prev => ({ ...prev, intervals: prev.intervals.filter((_, i) => i !== index) }));

    const handleDayToggle = (dayId) => {
        const currentDays = config.business_hours.days || [];
        const newDays = currentDays.includes(dayId) ? currentDays.filter(d => d !== dayId) : [...currentDays, dayId];
        setConfig(prev => ({ ...prev, business_hours: { ...prev.business_hours, days: newDays.sort() } }));
    };

    const handleTimeChange = (field, value) => {
        setConfig(prev => ({ ...prev, business_hours: { ...prev.business_hours, [field]: value } }));
    };

    if (isLoading) {
        return <PageLoader message="Regras de Reengajamento" subMessage="Sincronizando configurações de follow-up..." />;
    }

    return (
        <div className="followup-page h-full overflow-y-auto custom-scrollbar p-3 sm:p-6 md:p-8" style={{ background: '#f8faff' }}>
            <style>{DS}</style>
            <style>{`
                .custom-scrollbar::-webkit-scrollbar { width: 8px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(203, 213, 225, 1); border-radius: 20px; border: 2px solid transparent; background-clip: padding-box; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #3b82f6; background-clip: padding-box; }
            `}</style>
            <div className="mx-auto max-w-6xl">
                {/* Header */}
                <div className="mb-6 sm:mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-200 shrink-0">
                                <History size={22} className="text-white sm:hidden" />
                                <History size={24} className="text-white hidden sm:block" />
                            </div>
                            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-tight">
                                Follow-up <span className="text-blue-600">Automático</span>
                            </h1>
                        </div>
                        <p className="text-slate-500 font-medium text-xs sm:text-sm flex items-center gap-2">
                            <Info size={14} className="text-blue-400" /> Reengaje contatos inativos com precisão.
                        </p>
                    </div>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="w-full sm:w-auto flex items-center justify-center gap-3 px-6 sm:px-8 py-4 text-white text-[11px] sm:text-xs font-black uppercase tracking-widest rounded-2xl sm:rounded-3xl disabled:opacity-60 transition-all shadow-xl shadow-blue-500/20 active:scale-[0.98]"
                        style={{ background: isSaving ? '#94a3b8' : 'linear-gradient(135deg, #3b82f6, #6366f1)' }}
                    >
                        {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                        {isSaving ? 'Salvando...' : 'Salvar Alterações'}
                    </button>
                </div>

                {error && (
                    <div className="mb-6 p-4 rounded-2xl flex items-center gap-3 text-red-700 text-sm" style={{ background: 'rgba(254,226,226,0.6)', border: '1px solid rgba(252,165,165,0.4)' }}>
                        <Info size={16} className="flex-shrink-0" /> {error}
                    </div>
                )}

                {/* Status Card */}
                <div className="bg-white p-5 sm:p-8 rounded-[1.5rem] sm:rounded-[2rem] shadow-sm border border-slate-100/50 relative overflow-hidden mb-6 sm:mb-8">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50/50 rounded-full -mr-16 -mt-16 blur-3xl opacity-50"></div>
                    <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
                        <div className="flex items-center gap-4 sm:gap-5">
                            <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl flex items-center justify-center transition-all shadow-lg shrink-0 ${isActive ? 'bg-emerald-600 text-white shadow-emerald-200' : 'bg-slate-100 text-slate-400'}`}>
                                <History size={22} sm:size={24} />
                            </div>
                            <div>
                                <h2 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">Status do Serviço</h2>
                                <p className="text-[11px] sm:text-sm text-slate-500 font-medium leading-tight mt-0.5">
                                    {isActive ? 'A IA está monitorando e enviando follow-ups.' : 'O serviço está pausado. Ative para começar.'}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center justify-between w-full sm:w-auto gap-4 bg-slate-50 p-2 px-4 rounded-2xl border border-slate-100 sm:border-none">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{isActive ? 'Ativo' : 'Inativo'}</span>
                            <button
                                onClick={() => setIsActive(!isActive)}
                                className="relative w-14 h-7 rounded-full transition-all flex-shrink-0"
                                style={{ background: isActive ? 'linear-gradient(135deg, #10b981, #059669)' : '#e2e8f0' }}
                            >
                                <span className="absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-transform" style={{ transform: isActive ? 'translateX(28px)' : 'translateX(0)' }} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Config sections */}
                <div className={`space-y-8 transition-opacity duration-500 ${!isActive && 'opacity-40 pointer-events-none'}`}>
                    {/* Horário de Envio */}
                    <div className="bg-white p-5 sm:p-8 rounded-[1.5rem] sm:rounded-[2rem] shadow-sm border border-slate-100/50">
                        <h4 className="text-[10px] sm:text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6 sm:mb-8">01. Disponibilidade de Envio</h4>
                        <div className="flex flex-col lg:flex-row gap-8 lg:gap-10">
                            <div className="flex-1">
                                <label className="block text-[13px] font-bold text-slate-700 mb-4 px-1">Dias da Semana</label>
                                <div className="grid grid-cols-4 sm:flex sm:flex-wrap gap-2">
                                    {weekDays.map(day => {
                                        const active = config.business_hours.days.includes(day.id);
                                        return (
                                            <button key={day.id} onClick={() => handleDayToggle(day.id)}
                                                className={`px-2 sm:px-4 py-2.5 text-[10px] sm:text-xs font-black uppercase tracking-wider rounded-xl transition-all border shadow-sm ${active ? 'bg-blue-600 text-white border-transparent' : 'bg-slate-50 text-slate-400 border-slate-100'}`}
                                            >
                                                {day.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                            <div className="flex-1 lg:max-w-md">
                                <label className="block text-[13px] font-bold text-slate-700 mb-4 px-1">Janela Diária</label>
                                <div className="flex items-center gap-3">
                                    <div className="flex-1">
                                        <input type="time" value={config.business_hours.start} onChange={e => handleTimeChange('start', e.target.value)} className="followup-input text-center font-bold !bg-slate-50" />
                                    </div>
                                    <span className="text-[10px] text-slate-300 font-bold uppercase tracking-tighter shrink-0">Até</span>
                                    <div className="flex-1">
                                        <input type="time" value={config.business_hours.end} onChange={e => handleTimeChange('end', e.target.value)} className="followup-input text-center font-bold !bg-slate-50" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Intervalos */}
                    <div className="bg-white p-5 sm:p-8 rounded-[1.5rem] sm:rounded-[2rem] shadow-sm border border-slate-100/50">
                        <div className="flex justify-between items-center mb-6 sm:mb-8">
                            <h4 className="text-[10px] sm:text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">02. Intervalos de Reengajamento</h4>
                            <button onClick={addInterval}
                                className="flex items-center gap-1.5 px-3 sm:px-4 py-2 text-[10px] sm:text-[11px] font-black uppercase tracking-widest text-blue-600 rounded-xl hover:bg-blue-50 transition-all border border-blue-100/50">
                                <Plus size={14} /> <span className="hidden sm:inline">Adicionar</span>
                            </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
                            {config.intervals.map((interval, index) => (
                                <div key={index} className="premium-tile flex items-center gap-3 p-3 sm:p-4 rounded-2xl sm:rounded-3xl bg-slate-50/50 border border-slate-100">
                                    <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-white flex items-center justify-center text-blue-500 shadow-sm shrink-0">
                                        <Clock size={16} sm:size={18} />
                                    </div>
                                    <div className="flex-1 flex items-center gap-2 min-w-0">
                                        <input type="number" min="1" max={interval.unit === 'hours' ? 168 : 1440}
                                            value={interval.value}
                                            onChange={e => handleIntervalChange(index, 'value', e.target.value)}
                                            className="followup-input !w-14 !py-1 text-center font-bold !bg-white text-xs" />
                                        <select value={interval.unit} onChange={e => handleIntervalChange(index, 'unit', e.target.value)} className="followup-input !flex-1 !py-1 !text-[10px] !font-black uppercase tracking-tighter !bg-white truncate">
                                            <option value="minutes">Min</option>
                                            <option value="hours">Horas</option>
                                        </select>
                                    </div>
                                    <button onClick={() => removeInterval(index)} className="w-8 h-8 flex items-center justify-center text-slate-300 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50 shrink-0">
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            ))}
                            {config.intervals.length === 0 && (
                                <div className="col-span-full py-8 text-center border-2 border-dashed border-slate-100 rounded-[1.5rem] sm:rounded-[2rem]">
                                    <p className="text-[10px] sm:text-xs text-slate-400 font-bold uppercase tracking-widest">Nenhum intervalo definido.</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Auto-conclusão */}
                    <div className="bg-white p-5 sm:p-8 rounded-[1.5rem] sm:rounded-[2rem] shadow-sm border border-slate-100/50">
                        <h4 className="text-[10px] sm:text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6">03. Auto-conclusão</h4>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-6 p-5 sm:p-6 bg-slate-50/50 rounded-2xl sm:rounded-3xl border border-slate-100">
                            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-white flex items-center justify-center text-emerald-500 shadow-sm shrink-0">
                                <CheckCircle size={24} sm:size={28} />
                            </div>
                            <div className="flex-1">
                                <p className="text-[12px] sm:text-[13px] text-slate-600 font-medium leading-relaxed">
                                    Conclua automaticamente atendimentos parados em <span className="font-bold text-slate-900 line-clamp-1 sm:line-clamp-none">"Atendente Chamado"</span>.
                                </p>
                            </div>
                            <div className="flex items-center justify-between sm:justify-start gap-3 bg-white p-2 rounded-xl sm:rounded-2xl border border-slate-100 shadow-sm w-full sm:w-auto">
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-tighter ml-2">Em</span>
                                <input
                                    type="number" min="0" max="365"
                                    value={config.auto_conclude_days}
                                    onChange={e => setConfig(prev => ({ ...prev, auto_conclude_days: parseInt(e.target.value, 10) || 0 }))}
                                    className="followup-input !w-16 !py-1.5 text-center font-bold !border-none !bg-slate-50 text-xs"
                                />
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-tighter mr-2 sm:mr-4">dias</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Followup;