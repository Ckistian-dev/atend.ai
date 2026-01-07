import React, { useState, useEffect, useCallback } from 'react';
import api from '../api/axiosConfig';
import toast from 'react-hot-toast';
import { Save, Loader2, Plus, Trash2, Clock, History, Info, CheckCircle } from 'lucide-react';

const initialConfig = {
    business_hours: {
        start: "08:00",
        end: "18:00",
        days: [1, 2, 3, 4, 5] // Seg-Sex
    },
    // O frontend agora usa {value, unit} e converte para {hours} ao salvar.
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
                // Converte do formato do backend [{hours: X}] para o formato do frontend [{value: Y, unit: Z}]
                const frontendIntervals = backendConfig.intervals.map(interval => {
                    // Heurística para decidir se o valor salvo era em minutos ou horas
                    if (interval.hours < 1) {
                        return { value: Math.round(interval.hours * 60), unit: 'minutes' };
                    }
                    return { value: interval.hours, unit: 'hours' };
                });
                setConfig({
                    ...backendConfig,
                    intervals: frontendIntervals,
                    auto_conclude_days: backendConfig.auto_conclude_days || 0
                });
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

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleSave = async () => {
        setIsSaving(true);
        setError('');

        // Converte os intervalos para o formato do backend [{hours: X}] antes de salvar
        const configToSave = {
            ...config,
            intervals: config.intervals.map(interval => {
                let hoursValue = interval.value;
                if (interval.unit === 'minutes') {
                    hoursValue = interval.value / 60; // Converte minutos para fração de hora
                }
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

            // Aplica limites máximos dependendo da unidade
            if (updatedInterval.unit === 'hours' && numValue > 168) numValue = 168; // 1 semana
            if (updatedInterval.unit === 'minutes' && numValue > 1440) numValue = 1440; // 24h

            updatedInterval.value = numValue;
        } else if (field === 'unit') {
            updatedInterval.unit = value;
            // Reseta o valor para um padrão sensível quando a unidade muda
            updatedInterval.value = value === 'minutes' ? 30 : 1;
        }

        newIntervals[index] = updatedInterval;
        setConfig(prev => ({ ...prev, intervals: newIntervals }));
    };

    const addInterval = () => {
        if (config.intervals.length >= 6) {
            toast.error("Você pode adicionar no máximo 6 intervalos de follow-up.");
            return;
        }
        const newIntervals = [...config.intervals, { value: 24, unit: 'hours' }];
        setConfig(prev => ({ ...prev, intervals: newIntervals }));
    };

    const removeInterval = (index) => {
        const newIntervals = config.intervals.filter((_, i) => i !== index);
        setConfig(prev => ({ ...prev, intervals: newIntervals }));
    };

    const handleDayToggle = (dayId) => {
        const currentDays = config.business_hours.days || [];
        const newDays = currentDays.includes(dayId)
            ? currentDays.filter(d => d !== dayId)
            : [...currentDays, dayId];
        setConfig(prev => ({
            ...prev,
            business_hours: { ...prev.business_hours, days: newDays.sort() }
        }));
    };

    const handleTimeChange = (field, value) => {
        setConfig(prev => ({
            ...prev,
            business_hours: { ...prev.business_hours, [field]: value }
        }));
    };

    if (isLoading) {
        return <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin" size={32} /></div>;
    }

    return (
        <div className="p-6 md:p-10 bg-gray-50 min-h-full">
            <div className="max-w-4xl mx-auto">
                {/* 1. Page Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-800">Configurar Follow-up</h1>
                    <p className="text-gray-500 mt-1">Automatize o contato com clientes inativos para reengajá-los.</p>
                </div>

                {error && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-6" role="alert">{error}</div>}

                {/* 2. Main Control Card */}
                <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-200 mb-8">
                    <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                        <div>
                            <h2 className="text-lg font-semibold text-gray-800">Status do Serviço</h2>
                            <p className="text-sm text-gray-500">Ative para que a IA comece a enviar follow-ups automaticamente.</p>
                        </div>
                        <div className="flex items-center gap-4">
                            <button
                                onClick={() => setIsActive(!isActive)}
                                className={`flex items-center gap-2.5 text-sm px-4 py-2 rounded-full font-semibold transition-all transform hover:scale-105 ${isActive
                                        ? 'bg-green-100 text-green-800 hover:bg-green-200'
                                        : 'bg-red-100 text-red-800 hover:bg-red-200'
                                    }`}
                            >
                                <History size={16} />
                                {isActive ? 'Follow-up Ativo' : 'Follow-up Inativo'}
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={isSaving}
                                className="flex items-center gap-2 px-6 py-2.5 bg-brand-blue text-white rounded-lg font-semibold hover:bg-brand-blue-dark transition-colors disabled:bg-gray-400"
                            >
                                {isSaving ? <Loader2 size={20} className="animate-spin" /> : <Save size={20} />}
                                Salvar
                            </button>
                        </div>
                    </div>
                </div>

                {/* 3. Configuration Grid */}
                <div className={`space-y-8 transition-opacity duration-500 ${!isActive && 'opacity-50 pointer-events-none'}`}>
                    {/* Card 1: Horário de Funcionamento */}
                    <div className="bg-white p-6 rounded-xl shadow-lg border h-full">
                        <h3 className="text-lg font-bold text-gray-800 mb-2">Horário de Envio</h3>
                        <p className="text-gray-500 mb-6 text-sm">As mensagens só serão enviadas durante os dias e horários selecionados.</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Dias da Semana</label>
                                <div className="flex flex-wrap gap-2">
                                    {weekDays.map(day => (
                                        <button
                                            key={day.id}
                                            onClick={() => handleDayToggle(day.id)}
                                            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${config.business_hours.days.includes(day.id) ? 'bg-brand-blue text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                                        >
                                            {day.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Horário</label>
                                <div className="flex items-center gap-2">
                                    <input type="time" value={config.business_hours.start} onChange={e => handleTimeChange('start', e.target.value)} className="w-full p-2 border border-gray-300 rounded-md text-sm" />
                                    <span className="text-gray-500 text-sm">até</span>
                                    <input type="time" value={config.business_hours.end} onChange={e => handleTimeChange('end', e.target.value)} className="w-full p-2 border border-gray-300 rounded-md text-sm" />
                                </div>
                            </div>
                        </div>
                    </div>



                    {/* Intervalos */}
                    <div className="bg-white p-6 rounded-xl shadow-lg border h-full flex flex-col">
                        <div className="flex justify-between items-center mb-2">
                            <h3 className="text-lg font-bold text-gray-800">Intervalos de Reengajamento</h3>
                            <button onClick={addInterval} className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-blue text-white rounded-md text-xs font-medium hover:bg-brand-blue-dark">
                                <Plus size={14} /> Adicionar
                            </button>
                        </div>
                        <p className="text-gray-500 mb-6 text-sm">Defina após quanto tempo de inatividade do cliente a IA deve tentar um novo contato.</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-grow content-start">
                            {config.intervals.map((interval, index) => (
                                <div key={index} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                                    <Clock size={18} className="text-gray-400 flex-shrink-0" />
                                    <span className="text-sm text-gray-600">Após</span>
                                    <input
                                        type="number"
                                        min="1"
                                        max={interval.unit === 'hours' ? 168 : 1440}
                                        value={interval.value}
                                        onChange={e => handleIntervalChange(index, 'value', e.target.value)}
                                        className="w-20 p-1.5 border border-gray-300 rounded-md text-center font-medium text-sm focus:ring-brand-blue focus:border-brand-blue"
                                    />
                                    <select
                                        value={interval.unit}
                                        onChange={e => handleIntervalChange(index, 'unit', e.target.value)}
                                        className="p-1.5 border border-gray-300 rounded-md text-sm bg-white focus:ring-brand-blue focus:border-brand-blue"
                                    >
                                        <option value="minutes">minuto(s)</option>
                                        <option value="hours">hora(s)</option>
                                    </select>
                                    <div className="flex-grow"></div> {/* Spacer */}
                                    <button onClick={() => removeInterval(index)} className="text-gray-400 hover:text-red-500 p-1 rounded-full hover:bg-red-100">
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            ))}
                        </div>
                        <div className="mt-auto pt-4">
                            <div className="flex items-start gap-3 p-3 bg-blue-50 text-blue-800 rounded-lg text-xs border border-blue-100">
                                <Info size={16} className="flex-shrink-0 mt-0.5" />
                                <p>A mensagem de follow-up é gerada pela IA com base no contexto da conversa e nas suas configurações de persona.</p>
                            </div>
                        </div>
                    </div>
                    {/* Card 2: Auto-conclusão */}
                    <div className="bg-white p-6 rounded-xl shadow-lg border h-full">
                        <h3 className="text-lg font-bold text-gray-800 mb-2 flex items-center gap-2">
                            <CheckCircle size={20} className="text-green-600" /> Auto-conclusão
                        </h3>
                        <p className="text-gray-500 mb-6 text-sm">Defina após quantos dias sem interação os atendimentos em "Atendente Chamado" devem ser concluídos automaticamente.</p>
                        <div className="flex items-center gap-3">
                            <span className="text-sm text-gray-600">Concluir após</span>
                            <input
                                type="number"
                                min="0"
                                max="365"
                                value={config.auto_conclude_days}
                                onChange={e => setConfig(prev => ({ ...prev, auto_conclude_days: parseInt(e.target.value, 10) || 0 }))}
                                className="w-20 p-1.5 border border-gray-300 rounded-md text-center font-medium text-sm focus:ring-brand-blue focus:border-brand-blue"
                            />
                            <span className="text-sm text-gray-600">dias (0 para desativar)</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Followup;