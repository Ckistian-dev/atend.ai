// src/pages/Dashboard.jsx

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import api from '../api/axiosConfig';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { subDays, startOfMonth, endOfMonth, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import DatePicker, { registerLocale } from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

import {
    Loader2, TrendingUp, CheckCircle, Percent, Cpu, Send, AlertCircle,
    Calendar as CalendarIcon, Lightbulb, Zap, ArrowRight, BarChart3,
    AlertTriangle, FileDown
} from 'lucide-react';
registerLocale('pt-BR', ptBR);

// Mapeamento centralizado de cores para consistência
const STATUS_COLORS = {
    "Atendente Chamado": "#f0ad60",
    "Total": "#144cd1", // Cor para a nova linha de total
    "Aguardando Resposta": "#e5da61",
    "Concluído": "#5fd395",
};

// --- NOVO: Componente para renderizar o relatório de análise da IA ---
const AnalysisReport = ({ analysisData }) => {
    const reportRef = useRef(null);
    const [isDownloading, setIsDownloading] = useState(false);

    const handleDownloadPdf = () => {
        const input = reportRef.current;
        if (!input) return;

        setIsDownloading(true);

        html2canvas(input, {
            scale: 2, // Aumenta a resolução para melhor qualidade
            useCORS: true,
            backgroundColor: '#f9fafb' // Cor de fundo do container
        }).then(canvas => {
            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: 'a4'
            });

            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = pdf.internal.pageSize.getHeight();
            const canvasWidth = canvas.width;
            const canvasHeight = canvas.height;
            const ratio = canvasWidth / canvasHeight;

            const imgWidth = pdfWidth - 20; // Margem de 10mm de cada lado
            let imgHeight = imgWidth / ratio;
            let heightLeft = imgHeight;
            let position = 10; // Margem superior

            pdf.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight);
            heightLeft -= (pdfHeight - 20);

            while (heightLeft > 0) {
                pdf.addPage();
                position = heightLeft - imgHeight + 10;
                pdf.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight);
                heightLeft -= (pdfHeight - 20);
            }

            pdf.save(`relatorio-ia-${new Date().toISOString().split('T')[0]}.pdf`);
            setIsDownloading(false);
        }).catch(() => {
            setIsDownloading(false);
            alert("Ocorreu um erro ao gerar o PDF.");
        });
    };

    // CORREÇÃO: A resposta da IA pode vir aninhada ou não.
    // Esta lógica verifica se há uma única chave principal (como 'analise_de_conversao')
    // e usa o objeto interno. Se não, usa o objeto de dados diretamente.
    const isNested = Object.keys(analysisData).length === 1 && typeof analysisData[Object.keys(analysisData)[0]] === 'object';
    const report = isNested ? analysisData[Object.keys(analysisData)[0]] : analysisData;

    const impactColors = {
        'Alto': 'bg-red-100 text-red-800',
        'Médio': 'bg-yellow-100 text-yellow-800',
        'Baixo': 'bg-blue-100 text-blue-800',
    };

    const Section = ({ icon, title, children }) => (
        <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                    {icon}
                </div>
                <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
            </div>
            <div className="pl-11 space-y-4">{children}</div>
        </div>
    );

    return (
        <div ref={reportRef} className="mt-6 p-6 bg-gray-50 border border-gray-200 rounded-lg">
            <div className="flex justify-between items-start mb-8">
                <div>
                    <h2 className="text-xl font-bold text-gray-900 mb-2">Relatório de Análise da IA</h2>
                    <p className="text-sm text-gray-500">Aqui está a análise gerada com base nos dados e na sua pergunta.</p>
                </div>
                <button
                    onClick={handleDownloadPdf}
                    disabled={isDownloading}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg shadow-sm text-sm font-medium hover:bg-gray-700 transition-colors disabled:bg-gray-400 disabled:cursor-wait"
                >
                    {isDownloading ? <Loader2 size={16} className="animate-spin" /> : <FileDown size={16} />}
                    {isDownloading ? 'A gerar...' : 'Baixar PDF'}
                </button>
            </div>

            {report.diagnostico_geral && (
                <Section icon={<BarChart3 size={16} />} title="Diagnóstico Geral">
                    <p className="text-gray-600 text-sm leading-relaxed">{report.diagnostico_geral}</p>
                </Section>
            )}

            {report.principais_pontos_de_friccao?.length > 0 && (
                <Section icon={<AlertTriangle size={16} />} title="Principais Pontos de Fricção">
                    <div className="space-y-4">
                        {report.principais_pontos_de_friccao.map((item, index) => (
                            <div key={index} className="p-4 bg-white border border-gray-200 rounded-lg">
                                <div className="flex justify-between items-start">
                                    <h4 className="font-semibold text-gray-700">{item.area}</h4>
                                    {item.impacto_na_conversao && (
                                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${impactColors[item.impacto_na_conversao] || 'bg-gray-100 text-gray-800'}`}>
                                            Impacto: {item.impacto_na_conversao}
                                        </span>
                                    )}
                                </div>
                                <p className="text-sm text-gray-600 mt-2">{item.observacoes}</p>
                            </div>
                        ))}
                    </div>
                </Section>
            )}

            {report.insights_acionaveis?.length > 0 && (
                <Section icon={<Lightbulb size={16} />} title="Insights e Sugestões">
                    <div className="space-y-4">
                        {report.insights_acionaveis.map((insight, index) => (
                            <div key={index} className="p-4 bg-white border border-gray-200 rounded-lg">
                                <h4 className="font-semibold text-gray-700 mb-2">{insight.titulo}</h4>
                                <ul className="list-disc list-inside space-y-1">
                                    {insight.sugestoes.map((sugestao, sIndex) => (
                                        <li key={sIndex} className="text-sm text-gray-600">{sugestao}</li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </Section>
            )}

            {report.proximos_passos_recomendados && (
                <Section icon={<Zap size={16} />} title="Próximos Passos Recomendados">
                    <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-100 rounded-lg">
                        <ArrowRight size={20} className="text-blue-500 mt-0.5 flex-shrink-0" />
                        <p className="text-sm text-blue-800">{report.proximos_passos_recomendados}</p>
                    </div>
                </Section>
            )}
        </div>
    );
};

// --- COMPONENTES DO DASHBOARD ---

const StatCard = ({ icon, label, value, color }) => {
    const formattedValue = useMemo(() => {
        if (value === undefined || value === null) return '...';

        if (typeof value === 'number') {
            return value.toLocaleString('pt-BR');
        }

        if (typeof value === 'string' && !value.includes('%')) {
            const parsed = parseFloat(value);
            if (!isNaN(parsed)) {
                return parsed.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            }
        }
        return value;
    }, [value]);

    return (
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex items-center gap-4">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${color}`}>
                {icon}
            </div>
            <div>
                <p className="text-2xl font-bold text-gray-800">{formattedValue}</p>
                <p className="text-xs text-gray-500">{label}</p>
            </div>
        </div>
    );
};

const DateRangeFilter = ({ onDateChange }) => {
    const [active, setActive] = useState('30d'); // '7d', '30d', 'this_month', 'custom'
    const [customRange, setCustomRange] = useState([subDays(new Date(), 30), new Date()]);
    const [showCustomPicker, setShowCustomPicker] = useState(false);

    const ranges = {
        '7d': { label: 'Últimos 7 dias', days: 7 },
        '30d': { label: 'Últimos 30 dias', days: 30 },
        'this_month': { label: 'Este Mês' },
        'custom': { label: 'Personalizado' }
    };

    const handleSelect = (key) => {
        setActive(key);
        let start, end = new Date();

        if (key === 'this_month') {
            setShowCustomPicker(false);
            start = startOfMonth(end);
            end = endOfMonth(end);
        } else if (key === 'custom') {
            setShowCustomPicker(!showCustomPicker);
            return; // Não chama onDateChange ainda
        } else {
            setShowCustomPicker(false);
            start = subDays(end, ranges[key].days);
        }
        onDateChange(start, end);
    };

    return (
        <div className="relative">
            <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-lg">
                {Object.entries(ranges).map(([key, { label }]) => (
                    <button
                        key={key}
                        onClick={() => handleSelect(key)}
                        className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-2 ${active === key ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:bg-gray-200'}`}
                    >
                        {key === 'custom' && <CalendarIcon size={14} />}
                        {label}
                    </button>
                ))}
            </div>
            {showCustomPicker && (
                <div className="absolute top-full right-0 mt-2 bg-white p-4 rounded-xl shadow-lg border border-gray-200 z-20 w-80">
                    <p className="text-sm font-semibold text-gray-700 mb-3">Selecione um período</p>
                    <DatePicker
                        selectsRange={true}
                        startDate={customRange[0]}
                        endDate={customRange[1]}
                        onChange={(update) => {
                            setCustomRange(update);
                        }}
                        inline
                        locale="pt-BR"
                        dateFormat="dd/MM/yyyy"
                        maxDate={new Date()}
                    />
                    <div className="flex justify-end gap-2 mt-3">
                        <button onClick={() => setShowCustomPicker(false)} className="px-3 py-1.5 text-sm text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200">
                            Cancelar
                        </button>
                        <button
                            onClick={() => {
                                if (customRange[0] && customRange[1]) {
                                    onDateChange(customRange[0], customRange[1]);
                                    setShowCustomPicker(false);
                                }
                            }}
                            className="px-3 py-1.5 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-blue-300"
                            disabled={!customRange[0] || !customRange[1]}>
                            Aplicar
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

const AIAnalyzer = ({ onAnalyze, isLoading, analysis, error }) => {
    const [question, setQuestion] = useState('');
    const [selectedContexts, setSelectedContexts] = useState(['atendimentos', 'persona']);

    const handleContextChange = (context) => {
        setSelectedContexts(prev =>
            prev.includes(context)
                ? prev.filter(c => c !== context)
                : [...prev, context]
        );
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (question.trim()) {
            onAnalyze(question, selectedContexts);
        }
    };

    const predefinedQuestions = [
        "Qual o principal motivo de contato dos clientes?",
        "Quais são os pontos de maior atrito nas conversas?",
        "Sugira 3 melhorias para o meu processo de atendimento com base nos dados.",
    ];

    const handlePredefinedQuestionClick = (q) => {
        setQuestion(q);
    };


    return (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 mt-8">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Análise com IA</h3>
            <p className="text-gray-500 mb-6">
                Faça uma pergunta e selecione os contextos que a IA deve usar para responder.
                A análise dos atendimentos <strong className="font-semibold text-gray-700">respeitará o filtro de período</strong> selecionado acima.
            </p>

            <div className="mb-4 flex items-center gap-6">
                <p className="text-sm font-semibold text-gray-700">Incluir na análise:</p>
                <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-600">
                        <input type="checkbox" checked={selectedContexts.includes('atendimentos')} onChange={() => handleContextChange('atendimentos')} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                        Atendimentos no Período
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-600">
                        <input type="checkbox" checked={selectedContexts.includes('persona')} onChange={() => handleContextChange('persona')} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                        Contexto da IA (Persona)
                    </label>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
                <input
                    type="text"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="Ex: Como posso melhorar minha taxa de conversão?"
                    className="flex-grow px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={isLoading}
                />
                <button type="submit" className="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors flex items-center gap-2 disabled:bg-blue-300" disabled={isLoading}>
                    {isLoading ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                    Analisar
                </button>
            </form>

            <div className="mt-4">
                <div className="flex flex-wrap gap-2">
                    {predefinedQuestions.map((q, index) => (
                        <button
                            key={index}
                            type="button"
                            onClick={() => handlePredefinedQuestionClick(q)}
                            className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 px-3 py-1.5 rounded-full hover:bg-blue-100 hover:text-blue-800 transition-colors"
                        >
                            <Lightbulb size={14} />
                            <span>{q}</span>
                        </button>
                    ))}
                </div>
            </div>

            {isLoading && (
                <div className="mt-6 flex items-center justify-center text-gray-500">
                    <Loader2 size={24} className="animate-spin mr-3" />
                    <span>A IA está pensando... Isso pode levar alguns segundos.</span>
                </div>
            )}
            {error && (
                <div className="mt-6 p-4 bg-red-50 text-red-700 border border-red-200 rounded-lg flex items-center gap-3">
                    <AlertCircle size={20} />
                    <div>
                        <p className="font-semibold">Ocorreu um erro</p>
                        <p className="text-sm">{error}</p>
                    </div>
                </div>
            )}
            {analysis && !isLoading && (
                <AnalysisReport analysisData={analysis} />
            )}
        </div>
    );
};

// --- COMPONENTE PRINCIPAL DO DASHBOARD ---
const Dashboard = () => {
    const [data, setData] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    const [dateRange, setDateRange] = useState({ startDate: subDays(new Date(), 30), endDate: new Date() });
    // Estados para o analisador de IA
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisResult, setAnalysisResult] = useState('');
    const [analysisError, setAnalysisError] = useState('');

    const fetchData = useCallback(async (startDate, endDate) => {
        setIsLoading(true);
        setError('');
        try {
            const params = {
                start_date_str: startDate.toISOString(),
                end_date_str: endDate.toISOString(),
            };
            const response = await api.get('/dashboard/', { params });
            setData(response.data);
        } catch (err) {
            console.error("Erro ao carregar dados do dashboard:", err);
            setError('Não foi possível carregar os dados do dashboard. Tente novamente mais tarde.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        // Carga inicial com os últimos 30 dias
        const endDate = new Date();
        const startDate = subDays(endDate, 29); // Ajuste para incluir 30 dias completos
        fetchData(startDate, endDate);
    }, [fetchData]);

    const handleDateChange = (startDate, endDate) => {
        setDateRange({ startDate, endDate });
        fetchData(startDate, endDate);
    };

    const handleAIAnalysis = async (question, contexts) => {
        setIsAnalyzing(true);
        setAnalysisResult('');
        setAnalysisError('');
        try {
            const response = await api.post('/dashboard/analyze', {
                question,
                contexts,
                start_date_str: dateRange.startDate.toISOString(),
                end_date_str: dateRange.endDate.toISOString(),
            });
            setAnalysisResult(response.data.analysis); // CORREÇÃO: Extrai o objeto de dentro da chave 'analysis'
        } catch (err) {
            console.error("Erro na análise da IA:", err);
            setAnalysisError(err.response?.data?.detail || 'Falha ao se comunicar com o serviço de análise.');
        } finally {
            setIsAnalyzing(false);
        }
    };

    if (isLoading && !data) {
        return (
            <div className="flex h-full items-center justify-center bg-gray-50">
                <Loader2 size={40} className="animate-spin text-blue-600" />
            </div>
        );
    }

    if (error) {
        return <div className="flex h-full items-center justify-center text-red-600 p-10">{error}</div>;
    }

    // Verifica se os dados essenciais para os gráficos existem após o carregamento
    const hasChartData = data && data.charts && data.charts.contatosPorDia && data.charts.atendimentosPorSituacao;

    if (!isLoading && !error && !hasChartData) {
        return (
            <div className="flex h-full items-center justify-center bg-gray-50 p-10">
                <AlertCircle size={24} className="text-amber-500 mr-3" />
                <p className="text-xl text-gray-600">Página em desenvolvimento. Dados para os gráficos não encontrados.</p>
            </div>
        );
    }

    return (
        <div className="p-6 md:p-8 bg-gray-50 min-h-full">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-800">Dashboard de Análise</h1>
                    <p className="text-gray-500 mt-1">Visão geral do desempenho dos seus atendimentos.</p>
                </div>
                <DateRangeFilter onDateChange={handleDateChange} />
            </div>

            {isLoading && <div className="absolute inset-0 bg-white/50 flex items-center justify-center z-10"><Loader2 size={32} className="animate-spin text-blue-500" /></div>}

            {data && (
                <div className="space-y-8">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch">
                        {/* Coluna Esquerda: Cards e Gráfico de Linhas */}
                        <div className="lg:col-span-2 space-y-8 flex flex-col">
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                                <StatCard icon={<TrendingUp size={28} className="text-blue-500" />} label={data.stats?.totalAtendimentos?.label} value={data.stats?.totalAtendimentos?.value} color="bg-blue-100" />
                                <StatCard icon={<CheckCircle size={28} className="text-green-500" />} label={data.stats?.totalConcluidos?.label} value={data.stats?.totalConcluidos?.value} color="bg-green-100" />
                                <StatCard icon={<Percent size={28} className="text-amber-500" />} label={data.stats?.taxaConversao?.label} value={data.stats?.taxaConversao?.value} color="bg-amber-100" />
                                <StatCard icon={<Cpu size={28} className="text-violet-500" />} label={data.stats?.consumoMedioTokens?.label} value={data.stats?.consumoMedioTokens?.value} color="bg-violet-100" />
                            </div>
                            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex-grow flex flex-col">
                                <h3 className="text-lg font-semibold text-gray-800 mb-4">Volume de Atendimentos por Dia</h3>
                                <ResponsiveContainer width="100%" minHeight={400}>
                                    <LineChart data={data?.charts?.contatosPorDia || []} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                                        <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                                        <YAxis tick={{ fontSize: 12 }} />
                                        <Tooltip />
                                        <Legend wrapperStyle={{ fontSize: "14px" }} />
                                        <Line type="monotone" dataKey="total" stroke={STATUS_COLORS['Total']} strokeWidth={3} name="Total" dot={false} />
                                        {Object.entries(STATUS_COLORS)
                                            .filter(([status]) => status !== 'Total') // <-- Adicionado filtro para não duplicar
                                            .map(([status, color]) => (
                                                <Line key={status} type="monotone" dataKey={status} stroke={color} strokeWidth={2} name={status} dot={false} />
                                            ))}
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* Coluna Direita: Gráfico de Rosca */}
                        <div className="lg:col-span-1 bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex flex-col">
                            <h3 className="text-lg font-semibold text-gray-800 mb-4">Distribuição por Situação</h3>
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                                    <Pie
                                        data={data?.charts?.atendimentosPorSituacao || []}
                                        dataKey="value"
                                        nameKey="name"
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60} // <-- Transforma em gráfico de rosca
                                        outerRadius={100}
                                        paddingAngle={3}
                                        label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`}
                                    >
                                        {(data?.charts?.atendimentosPorSituacao || []).map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={STATUS_COLORS[entry.name] || '#808080'} />
                                        ))}
                                    </Pie>
                                    <Tooltip formatter={(value, name) => [value, name]} />
                                    <Legend iconType="circle" />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Analisador de IA */}
                    <AIAnalyzer
                        onAnalyze={handleAIAnalysis}
                        isLoading={isAnalyzing}
                        analysis={analysisResult}
                        error={analysisError}
                    />
                </div>
            )}
        </div>
    );
};

export default Dashboard;