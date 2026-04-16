// src/pages/Dashboard.jsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import api from '../api/axiosConfig';
import {
    BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
    Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';
import { subDays, startOfMonth, endOfMonth, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import DatePicker, { registerLocale } from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { LLM_MODELS, DEFAULT_MODEL } from '../constants/models';
import {
    Loader2, TrendingUp, CheckCircle, Percent, Cpu, Send, AlertCircle,
    Calendar as CalendarIcon, Lightbulb, Zap, ArrowRight, BarChart3,
    AlertTriangle, FileDown, Target, Activity, Clock, Users, Star,
    TrendingDown, CheckCircle2, XCircle, Sparkles, LayoutGrid, Radio,
    PieChart as PieIcon, BarChart2, Brain, ChevronUp, ChevronDown, Minus, Info
} from 'lucide-react';
registerLocale('pt-BR', ptBR);

// ─── PALETA ───────────────────────────────────────────────────────────────────
const STATUS_COLORS = {
    "Atendente Chamado": "#f59e0b",
    "Total": "#3b82f6",
    "Aguardando Resposta": "#a855f7",
    "Mensagem Recebida": "#06b6d4",
    "Concluído": "#10b981",
    "Tokens": "#8b5cf6",
};

const CHART_PALETTE = [
    '#3b82f6', '#10b981', '#f59e0b', '#a855f7', '#06b6d4',
    '#ef4444', '#84cc16', '#f97316', '#14b8a6', '#6366f1'
];

// Configurações de cor para cada tipo de dado da IA
const COR_MAP = {
    verde: { pill: 'bg-emerald-100 text-emerald-700', icon: 'bg-emerald-500', ring: 'ring-emerald-200' },
    vermelho: { pill: 'bg-red-100 text-red-700', icon: 'bg-red-500', ring: 'ring-red-200' },
    amarelo: { pill: 'bg-amber-100 text-amber-700', icon: 'bg-amber-500', ring: 'ring-amber-200' },
    azul: { pill: 'bg-blue-100 text-blue-700', icon: 'bg-blue-500', ring: 'ring-blue-200' },
    roxo: { pill: 'bg-violet-100 text-violet-700', icon: 'bg-violet-500', ring: 'ring-violet-200' },
};

const ICON_MAP = {
    trending: <TrendingUp size={16} />,
    alert: <AlertTriangle size={16} />,
    lightbulb: <Lightbulb size={16} />,
    target: <Target size={16} />,
    zap: <Zap size={16} />,
    percent: <Percent size={16} />,
    users: <Users size={16} />,
    clock: <Clock size={16} />,
    star: <Star size={16} />,
    activity: <Activity size={16} />,
};

const PRIORIDADE_CONFIG = {
    alta: { label: 'Alta', border: 'border-l-red-500', bg: 'bg-red-50', badge: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
    media: { label: 'Média', border: 'border-l-amber-500', bg: 'bg-amber-50', badge: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
    baixa: { label: 'Baixa', border: 'border-l-blue-400', bg: 'bg-blue-50', badge: 'bg-blue-100 text-blue-700', dot: 'bg-blue-400' },
};

const IMPACTO_CONFIG = {
    Alto: { pill: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
    Médio: { pill: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
    Baixo: { pill: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
};

const TIMELINE_CONFIG = {
    oportunidade: { icon: <Star size={12} />, bg: 'bg-emerald-500', ring: 'ring-emerald-200' },
    sucesso: { icon: <CheckCircle2 size={12} />, bg: 'bg-blue-500', ring: 'ring-blue-200' },
    alerta: { icon: <AlertTriangle size={12} />, bg: 'bg-amber-500', ring: 'ring-amber-200' },
    perda: { icon: <XCircle size={12} />, bg: 'bg-red-500', ring: 'ring-red-200' },
};

const ESTILO_CONFIG = {
    diagnostico: { icon: <Brain size={16} />, border: 'border-l-blue-500', bg: 'bg-blue-50', label: 'Diagnóstico', text: 'text-blue-600' },
    estrategia: { icon: <Target size={16} />, border: 'border-l-violet-500', bg: 'bg-violet-50', label: 'Estratégia', text: 'text-violet-600' },
    conclusao: { icon: <CheckCircle2 size={16} />, border: 'border-l-emerald-500', bg: 'bg-emerald-50', label: 'Conclusão', text: 'text-emerald-600' },
};

// ─── CUSTOM TOOLTIP ───────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-white/95 backdrop-blur-md rounded-2xl px-4 py-3 shadow-xl shadow-slate-200/60 text-sm" style={{ border: '1px solid rgba(203,213,225,0.4)' }}>
            {label && <p className="text-slate-500 text-xs mb-2 font-semibold">{label}</p>}
            {payload.map((entry, i) => (
                <div key={i} className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: entry.color || entry.fill }} />
                    <span className="text-slate-800 font-bold">{entry.value?.toLocaleString('pt-BR')}</span>
                    <span className="text-slate-400">{entry.name}</span>
                </div>
            ))}
        </div>
    );
};

// ─── MÓDULOS DA IA ────────────────────────────────────────────────────────────

// 1. Hero Stat
const HeroStatModule = ({ modulo }) => {
    const trendMap = {
        alta: { icon: <ChevronUp size={18} />, class: 'text-emerald-600 bg-emerald-100', label: 'Em alta' },
        baixa: { icon: <ChevronDown size={18} />, class: 'text-red-600 bg-red-100', label: 'Em queda' },
        neutro: { icon: <Minus size={18} />, class: 'text-gray-500 bg-gray-100', label: 'Estável' },
    };
    const trend = trendMap[modulo.tendencia] || trendMap.neutro;
    return (
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 p-8 shadow-xl">
            <div className="absolute -top-10 -right-10 w-48 h-48 rounded-full bg-white/10" />
            <div className="absolute -bottom-12 -left-8 w-40 h-40 rounded-full bg-white/5" />
            <div className="relative z-10 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
                <div>
                    <p className="text-blue-200 text-xs font-semibold uppercase tracking-widest mb-3">Resposta Principal</p>
                    <p className="text-white text-7xl font-black tracking-tighter leading-none">{modulo.valor}</p>
                    <p className="text-blue-100 text-xl font-semibold mt-3">{modulo.label}</p>
                </div>
                <div className="flex flex-col gap-3 items-start md:items-end">
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold ${trend.class}`}>
                        {trend.icon}{trend.label}
                    </span>
                    {modulo.descricao && (
                        <p className="text-blue-200 text-sm max-w-xs text-right leading-relaxed">{modulo.descricao}</p>
                    )}
                </div>
            </div>
        </div>
    );
};

// 2. Metric Grid
const MetricGridModule = ({ modulo }) => (
    <div className="rounded-2xl bg-white p-6 shadow-sm" style={{ boxShadow: '0 2px 16px rgba(15,23,42,0.06)' }}>
        {modulo.titulo && (
            <div className="flex items-center gap-2 mb-5">
                <LayoutGrid size={17} className="text-blue-400" />
                <h3 className="text-slate-700 font-semibold" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>{modulo.titulo}</h3>
            </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {(modulo.metricas || []).map((m, i) => {
                const cor = COR_MAP[m.cor] || COR_MAP.azul;
                return (
                    <div key={i} className={`rounded-2xl p-4 bg-slate-50/80 hover:bg-white transition-all`} style={{ boxShadow: '0 1px 8px rgba(15,23,42,0.05)' }}>
                        <div className={`w-9 h-9 rounded-xl ${cor.icon} text-white flex items-center justify-center mb-3 shadow`}>
                            {ICON_MAP[m.icone] || <Activity size={16} />}
                        </div>
                        <p className="text-2xl font-black text-slate-800 leading-none mb-1">{m.valor}</p>
                        <p className="text-slate-500 text-xs font-medium leading-snug">{m.label}</p>
                    </div>
                );
            })}
        </div>
    </div>
);

// 3. Pie Chart
const PieChartModule = ({ modulo }) => {
    if (!modulo.dados?.length) return null;
    const total = modulo.dados.reduce((s, d) => s + (d.value || 0), 0);
    return (
        <div className="rounded-2xl bg-white p-6" style={{ boxShadow: '0 2px 16px rgba(15,23,42,0.06)' }}>
            <div className="flex items-center gap-2 mb-1">
                <PieIcon size={17} className="text-violet-400" />
                <h3 className="text-slate-700 font-semibold" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>{modulo.titulo}</h3>
            </div>
            {modulo.descricao && <p className="text-slate-400 text-sm mb-5 pl-7">{modulo.descricao}</p>}
            <div className="flex flex-col md:flex-row items-center gap-6 mt-4">
                <div className="w-52 h-52 flex-shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie data={modulo.dados} dataKey="value" cx="50%" cy="50%"
                                innerRadius={55} outerRadius={90} paddingAngle={3} strokeWidth={2} stroke="#fff">
                                {modulo.dados.map((_, idx) => (
                                    <Cell key={idx} fill={CHART_PALETTE[idx % CHART_PALETTE.length]} />
                                ))}
                            </Pie>
                            <Tooltip content={<CustomTooltip />} />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
                <div className="flex-1 w-full">
                    <div className="text-center mb-4 pb-4 border-b border-gray-100">
                        <span className="text-3xl font-black text-gray-800">{total.toLocaleString('pt-BR')}</span>
                        <span className="text-gray-400 text-sm ml-2">total</span>
                    </div>
                    <div className="flex flex-col gap-2.5">
                        {modulo.dados.map((entry, i) => (
                            <div key={i} className="flex items-center gap-2.5 text-sm">
                                <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }} />
                                <span className="text-gray-600 flex-1 truncate">{entry.name}</span>
                                <span className="text-gray-800 font-bold">{entry.value}</span>
                                <span className="text-gray-400 text-xs w-10 text-right">
                                    {total > 0 ? Math.round(entry.value / total * 100) : 0}%
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

// 4. Bar Chart
const BarChartModule = ({ modulo }) => {
    if (!modulo.dados?.length) return null;
    return (
        <div className="rounded-2xl bg-white p-6" style={{ boxShadow: '0 2px 16px rgba(15,23,42,0.06)' }}>
            <div className="flex items-center gap-2 mb-1">
                <BarChart2 size={17} className="text-blue-400" />
                <h3 className="text-slate-700 font-semibold" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>{modulo.titulo}</h3>
            </div>
            {modulo.descricao && <p className="text-slate-400 text-sm mb-5 pl-7">{modulo.descricao}</p>}
            <div className="h-64 mt-4">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={modulo.dados} margin={{ top: 5, right: 10, left: -20, bottom: 10 }} barSize={28}>
                        <CartesianGrid strokeDasharray="2 4" stroke="#f0f0f0" vertical={false} />
                        <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false}
                            interval={0} angle={modulo.dados.length > 5 ? -30 : 0}
                            textAnchor={modulo.dados.length > 5 ? 'end' : 'middle'}
                            height={modulo.dados.length > 5 ? 60 : 30} />
                        <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f9fafb' }} />
                        <Bar dataKey="value" name={modulo.eixo_x || 'Valor'} radius={[6, 6, 0, 0]}>
                            {modulo.dados.map((_, idx) => (
                                <Cell key={idx} fill={CHART_PALETTE[idx % CHART_PALETTE.length]} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

// 5. Friction Cards
const FrictionCardsModule = ({ modulo }) => (
    <div className="rounded-2xl bg-white p-6" style={{ boxShadow: '0 2px 16px rgba(15,23,42,0.06)' }}>
        <div className="flex items-center gap-2 mb-5">
            <AlertTriangle size={17} className="text-red-500" />
            <h3 className="text-slate-700 font-semibold" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>{modulo.titulo || 'Pontos de Fricção'}</h3>
        </div>
        <div className="flex flex-col gap-3">
            {(modulo.itens || []).map((item, i) => {
                const cfg = IMPACTO_CONFIG[item.impacto] || IMPACTO_CONFIG['Baixo'];
                return (
                    <div key={i} className="rounded-2xl p-4 bg-slate-50/80 hover:bg-white hover:shadow-md transition-all" style={{ border: '1px solid rgba(203,213,225,0.4)' }}>
                        <div className="flex items-start justify-between gap-3 mb-2">
                            <h4 className="text-slate-800 font-semibold text-sm">{item.area}</h4>
                            <span className={`flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.pill}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                                {item.impacto}
                            </span>
                        </div>
                        <p className="text-gray-500 text-sm leading-relaxed">{item.observacoes}</p>
                        {(item.contatos_exemplo?.length > 0 || item.ids_exemplo?.length > 0) && (
                            <div className="flex flex-wrap gap-1.5 mt-3">
                                <span className="text-gray-400 text-xs mr-1">Contatos:</span>
                                {(item.contatos_exemplo || item.ids_exemplo || []).map((contato, idx) => (
                                    <span key={idx} className="text-xs font-mono px-2 py-0.5 bg-gray-100 border border-gray-200 rounded-md text-gray-600">
                                        {contato}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    </div>
);

// 6. Insight Cards
const InsightCardsModule = ({ modulo }) => (
    <div className="rounded-2xl bg-white p-6" style={{ boxShadow: '0 2px 16px rgba(15,23,42,0.06)' }}>
        <div className="flex items-center gap-2 mb-5">
            <Sparkles size={17} className="text-amber-500" />
            <h3 className="text-slate-700 font-semibold" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>{modulo.titulo || 'Insights Estratégicos'}</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(modulo.itens || []).map((item, i) => {
                const pri = PRIORIDADE_CONFIG[item.prioridade] || PRIORIDADE_CONFIG.baixa;
                return (
                    <div key={i} className={`rounded-xl p-4 border-l-4 border border-gray-200 ${pri.border} ${pri.bg} hover:shadow-sm transition-all`}>
                        <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex-shrink-0 flex items-center justify-center text-gray-500 shadow-sm">
                                {ICON_MAP[item.icone] || <Lightbulb size={14} />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                    <h4 className="text-gray-800 font-semibold text-sm">{item.titulo}</h4>
                                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${pri.badge}`}>
                                        {pri.label}
                                    </span>
                                </div>
                                <p className="text-gray-500 text-xs leading-relaxed">{item.descricao}</p>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    </div>
);

// 7. Text Section
const TextSectionModule = ({ modulo }) => {
    const cfg = ESTILO_CONFIG[modulo.estilo] || ESTILO_CONFIG.diagnostico;
    return (
        <div className={`rounded-2xl border-l-4 border border-gray-200 ${cfg.border} ${cfg.bg} p-6`}>
            <div className="flex items-center gap-2 mb-3">
                <span className={cfg.text}>{cfg.icon}</span>
                <span className={`text-xs font-bold uppercase tracking-widest ${cfg.text}`}>{cfg.label}</span>
                {modulo.titulo && <span className="text-gray-700 font-semibold text-sm ml-1">— {modulo.titulo}</span>}
            </div>
            <p className="text-gray-600 leading-relaxed text-sm">{modulo.conteudo}</p>
        </div>
    );
};

// 8. Timeline Events
const TimelineEventsModule = ({ modulo }) => (
    <div className="rounded-2xl bg-white p-6" style={{ boxShadow: '0 2px 16px rgba(15,23,42,0.06)' }}>
        <div className="flex items-center gap-2 mb-6">
            <Radio size={17} className="text-teal-500" />
            <h3 className="text-slate-700 font-semibold" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>{modulo.titulo || 'Destaque do Período'}</h3>
        </div>
        <div className="relative pl-6">
            <div className="absolute left-2 top-0 bottom-0 w-px bg-gray-200" />
            <div className="flex flex-col gap-4">
                {(modulo.eventos || []).map((ev, i) => {
                    const cfg = TIMELINE_CONFIG[ev.tipo] || TIMELINE_CONFIG.alerta;
                    return (
                        <div key={i} className="relative group">
                            <div className={`absolute -left-[19px] top-1.5 w-4 h-4 rounded-full ${cfg.bg} ring-2 ring-white ring-offset-1 ${cfg.ring} flex items-center justify-center text-white transition-transform group-hover:scale-110`}>
                                {cfg.icon}
                            </div>
                            <div className="bg-gray-50 rounded-xl border border-gray-200 p-3.5 hover:border-gray-300 hover:shadow-sm transition-all ml-2">
                                <div className="flex items-start justify-between gap-2 mb-1">
                                    <h4 className="text-gray-800 font-semibold text-sm">{ev.titulo}</h4>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                        {ev.data && <span className="text-gray-400 text-xs">{ev.data}</span>}
                                        {(ev.whatsapp || ev.id) && (
                                            <span className="text-xs font-mono px-1.5 py-0.5 bg-white border border-gray-200 rounded text-gray-500">
                                                {ev.whatsapp || `#${ev.id}`}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <p className="text-gray-500 text-xs leading-relaxed">{ev.descricao}</p>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    </div>
);

// ─── RENDERIZADOR DINÂMICO ────────────────────────────────────────────────────
const ModuleRenderer = ({ modulo, index }) => {
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        const t = setTimeout(() => setVisible(true), index * 70);
        return () => clearTimeout(t);
    }, [index]);

    const style = {
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(16px)',
        transition: `opacity 0.35s ease ${index * 0.07}s, transform 0.35s ease ${index * 0.07}s`,
    };

    const node = (() => {
        switch (modulo.tipo) {
            case 'hero_stat': return <HeroStatModule modulo={modulo} />;
            case 'metric_grid': return <MetricGridModule modulo={modulo} />;
            case 'pie_chart': return <PieChartModule modulo={modulo} />;
            case 'bar_chart': return <BarChartModule modulo={modulo} />;
            case 'friction_cards': return <FrictionCardsModule modulo={modulo} />;
            case 'insight_cards': return <InsightCardsModule modulo={modulo} />;
            case 'text_section': return <TextSectionModule modulo={modulo} />;
            case 'timeline_events': return <TimelineEventsModule modulo={modulo} />;
            default:
                return (
                    <div className="rounded-2xl p-4" style={{ background: 'rgba(248,250,255,0.8)' }}>
                        <p className="text-slate-400 text-sm font-mono">Módulo desconhecido: {modulo.tipo}</p>
                    </div>
                );
        }
    })();

    return <div style={style}>{node}</div>;
};

// ─── ANÁLISE IA - RELATÓRIO ───────────────────────────────────────────────────
const AnalysisReport = ({ analysisData }) => {
    const reportRef = useRef(null);
    const [isDownloading, setIsDownloading] = useState(false);

    const resposta_direta = analysisData?.resposta_direta || '';
    const modulos = analysisData?.modulos || [];

    // Compatibilidade com formato antigo
    const normalizedModulos = useMemo(() => {
        if (modulos.length > 0) return modulos;
        const ac = analysisData?.analise_de_conversao;
        if (!ac) return [];
        const fallback = [];
        if (ac.diagnostico_geral) fallback.push({ tipo: 'text_section', titulo: 'Diagnóstico', conteudo: ac.diagnostico_geral, estilo: 'diagnostico' });
        if (ac.principais_pontos_de_friccao?.length) fallback.push({
            tipo: 'friction_cards', titulo: 'Pontos de Fricção',
            itens: ac.principais_pontos_de_friccao.map(p => ({ area: p.area, observacoes: p.observacoes, impacto: p.impacto_na_conversao }))
        });
        if (ac.insights_acionaveis?.length) fallback.push({
            tipo: 'insight_cards', titulo: 'Insights',
            itens: ac.insights_acionaveis.map(ins => ({ titulo: ins.titulo, descricao: (ins.sugestoes || []).join(' '), prioridade: 'media', icone: 'lightbulb' }))
        });
        if (ac.proximos_passos_recomendados) fallback.push({ tipo: 'text_section', titulo: 'Próximos Passos', conteudo: ac.proximos_passos_recomendados, estilo: 'conclusao' });
        return fallback;
    }, [modulos, analysisData]);

    const handleDownloadPdf = async () => {
        if (!reportRef.current) return;
        setIsDownloading(true);
        try {
            const canvas = await html2canvas(reportRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
            const pdfW = pdf.internal.pageSize.getWidth();
            const pdfH = pdf.internal.pageSize.getHeight();
            const imgW = pdfW - 20;
            let imgH = imgW / (canvas.width / canvas.height);
            let heightLeft = imgH;
            let pos = 10;
            pdf.addImage(imgData, 'PNG', 10, pos, imgW, imgH);
            heightLeft -= (pdfH - 20);
            while (heightLeft > 0) {
                pdf.addPage();
                pos = heightLeft - imgH + 10;
                pdf.addImage(imgData, 'PNG', 10, pos, imgW, imgH);
                heightLeft -= (pdfH - 20);
            }
            pdf.save(`relatorio-ia-${format(new Date(), 'dd-MM-yyyy')}.pdf`);
        } catch { alert("Erro ao gerar PDF."); }
        finally { setIsDownloading(false); }
    };

    return (
        <div className="mt-6 animate-fade-in-up">
            {/* Header do relatório */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow">
                        <Brain size={17} className="text-white" />
                    </div>
                    <div>
                        <h2 className="text-slate-800 font-bold text-base leading-tight" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Relatório de Análise IA</h2>
                        <p className="text-slate-400 text-xs">{format(new Date(), "d MMM yyyy 'às' HH:mm", { locale: ptBR })}</p>
                    </div>
                </div>
                <button
                    onClick={handleDownloadPdf}
                    disabled={isDownloading}
                    className="flex items-center gap-2 px-4 py-2 bg-white text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition-all disabled:opacity-50"
                    style={{ boxShadow: '0 1px 8px rgba(15,23,42,0.08)', border: '1px solid rgba(203,213,225,0.5)' }}
                >
                    {isDownloading ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
                    {isDownloading ? 'Gerando...' : 'Exportar PDF'}
                </button>
            </div>

            {/* Resposta Direta */}
            {resposta_direta && (
                <div className="mb-5 p-4 rounded-2xl bg-gradient-to-r from-blue-50 to-indigo-50 flex items-start gap-3" style={{ border: '1px solid rgba(147,197,253,0.4)' }}>
                    <Sparkles size={16} className="text-blue-500 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="text-blue-600 text-xs font-bold uppercase tracking-widest mb-1">Resposta Direta</p>
                        <p className="text-slate-800 font-semibold text-sm leading-relaxed">{resposta_direta}</p>
                    </div>
                </div>
            )}

            {/* Módulos */}
            <div ref={reportRef} className="flex flex-col gap-4 rounded-2xl p-5" style={{ background: 'rgba(248,250,255,0.8)', border: '1px solid rgba(203,213,225,0.3)' }}>
                {normalizedModulos.length === 0 ? (
                    <div className="text-center py-10 text-slate-400">
                        <Info size={28} className="mx-auto mb-3 opacity-50" />
                        <p className="text-sm">A IA não retornou módulos nesta resposta.</p>
                    </div>
                ) : (
                    normalizedModulos.map((modulo, i) => (
                        <ModuleRenderer key={i} modulo={modulo} index={i} />
                    ))
                )}
            </div>
        </div>
    );
};

// ─── AI ANALYZER PANEL ────────────────────────────────────────────────────────
const AIAnalyzer = ({ onAnalyze, isLoading, analysis, error }) => {
    const [question, setQuestion] = useState('');
    const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);

    const models = LLM_MODELS;

    const predefined = [
        { q: "Quantos contatos tivemos e qual a distribuição por status?", icon: <Users size={13} /> },
        { q: "Quais são os principais motivos de perda de conversão?", icon: <AlertTriangle size={13} /> },
        { q: "Analise o tempo de resposta e identifique gargalos operacionais.", icon: <Clock size={13} /> },
        { q: "Sugira ações concretas para aumentar nossa taxa de conversão.", icon: <TrendingUp size={13} /> },
        { q: "Quais regiões geográficas foram mais frequentes nos contatos?", icon: <Target size={13} /> },
    ];

    const handleSubmit = (e) => {
        e.preventDefault();
        if (question.trim()) onAnalyze(question, selectedModel);
    };

    return (
        <div className="bg-white rounded-2xl p-6 mt-8" style={{ boxShadow: '0 4px 24px rgba(15,23,42,0.07)' }}>
            {/* Header */}
            <div className="flex items-start gap-4 mb-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 via-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-200">
                    <Brain size={22} className="text-white" />
                </div>
                <div className="flex-1">
                    <div className="flex items-center gap-2">
                        <h3 className="text-slate-800 font-black text-lg tracking-tight" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Análise Inteligente</h3>
                        <span className="px-1.5 rounded-md bg-blue-50 text-blue-600 text-[9px] font-black uppercase tracking-widest border border-blue-100">AI PRO</span>
                    </div>
                    <p className="text-slate-400 text-[13px] truncate">Utilize nossa IA para extrair insights estratégicos, identificar gargalos e otimizar sua conversão de forma automática.</p>
                </div>
            </div>

            {/* Divisor */}
            <div className="h-px mb-5" style={{ background: 'rgba(203,213,225,0.5)' }} />

            {/* Command Bar Area */}
            <div className="flex flex-col lg:flex-row items-end gap-3 mb-5">
                {/* Seleção de modelo */}
                <div className="w-full lg:w-72">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-[0.12em] mb-1.5 ml-1">Modelo de IA</label>
                    <div className="relative group">
                        <Cpu size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors pointer-events-none" />
                        <select
                            value={selectedModel}
                            onChange={e => setSelectedModel(e.target.value)}
                            className="w-full bg-slate-50/50 hover:bg-slate-100/80 text-slate-700 text-sm rounded-xl pl-10 pr-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all appearance-none cursor-pointer"
                            style={{ border: '1px solid rgba(203,213,225,0.6)' }}
                        >
                            {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                        <ChevronDown size={14} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    </div>
                </div>

                {/* Input de pergunta */}
                <form onSubmit={handleSubmit} className="flex-1 flex gap-2 w-full">
                    <div className="relative flex-1 group">
                        <Sparkles size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500/60 group-focus-within:text-blue-500 transition-colors" />
                        <input
                            type="text"
                            value={question}
                            onChange={e => setQuestion(e.target.value)}
                            placeholder="Faça uma pergunta para a IA sobre estes dados..."
                            className="w-full bg-slate-50/50 hover:bg-slate-100/80 text-slate-800 placeholder-slate-400 text-sm rounded-xl pl-11 pr-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                            style={{ border: '1px solid rgba(203,213,225,0.6)' }}
                            disabled={isLoading}
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={isLoading || !question.trim()}
                        className="px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl font-bold text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-500/10 active:scale-95"
                    >
                        {isLoading ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
                        <span className="hidden sm:inline">{isLoading ? 'Analisando...' : 'Analisar'}</span>
                    </button>
                </form>
            </div>

            {/* Sugestões de Perguntas */}
            <div className="mb-2">
                <div className="mt-2 flex flex-nowrap gap-2 overflow-x-auto pb-2 no-scrollbar">
                    {predefined.map(({ q, icon }, i) => (
                        <button
                            key={i}
                            onClick={() => setQuestion(q)}
                            disabled={isLoading}
                            className="flex-shrink-0 flex items-center gap-2 text-[11px] font-medium px-3.5 py-2 rounded-full bg-white text-slate-600 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 transition-all disabled:opacity-50 shadow-sm whitespace-nowrap"
                            style={{ border: '1px solid rgba(203,213,225,0.5)' }}
                        >
                            <span className="text-blue-500 opacity-80">{icon}</span>
                            {q}
                        </button>
                    ))}
                </div>
            </div>

            {/* Loading */}
            {isLoading && (
                <div className="mt-6 flex flex-col items-center justify-center py-12 gap-4">
                    <div className="relative w-14 h-14">
                        <div className="absolute inset-0 rounded-full border-2 border-blue-200 animate-ping opacity-50" />
                        <div className="w-14 h-14 rounded-full border-2 border-blue-200 border-t-blue-600 animate-spin" />
                        <Brain size={20} className="absolute inset-0 m-auto text-blue-600" />
                    </div>
                    <div className="text-center">
                        <p className="text-slate-700 font-semibold">Analisando dados...</p>
                        <p className="text-slate-400 text-sm mt-1">A IA está escolhendo as melhores visualizações</p>
                    </div>
                </div>
            )}

            {/* Erro */}
            {error && !isLoading && (
                <div className="mt-5 p-4 bg-red-50 rounded-2xl flex items-start gap-3" style={{ border: '1px solid rgba(252,165,165,0.4)' }}>
                    <AlertCircle size={17} className="text-red-500 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="text-red-700 font-semibold text-sm">Erro na análise</p>
                        <p className="text-red-400 text-sm mt-0.5">{error}</p>
                    </div>
                </div>
            )}

            {/* Relatório */}
            {analysis && !isLoading && <AnalysisReport analysisData={analysis} />}
        </div>
    );
};

// ─── STAT CARD ────────────────────────────────────────────────────────────────
const StatCard = ({ icon, label, value, gradient }) => {
    const renderedValue = useMemo(() => {
        if (value === undefined || value === null) return "—";
        const strVal = String(value);

        // Caso 1: Formato Composto (ex: 1m 10s, 1d 2h)
        const compositeMatch = strVal.match(/^(\d+)([a-z])\s+(\d+)([a-z])$/);
        if (compositeMatch) {
            return (
                <span className="flex items-baseline gap-0.5">
                    <span>{compositeMatch[1]}</span>
                    <span className="text-[13px] font-bold text-slate-400 mr-1.5">{compositeMatch[2]}</span>
                    <span>{compositeMatch[3]}</span>
                    <span className="text-[13px] font-bold text-slate-400">{compositeMatch[4]}</span>
                </span>
            );
        }

        // Caso 2: Formato Simples (ex: 85%, 1.5m, 10s)
        const simpleMatch = strVal.match(/^([\d.,]+)\s*([a-zA-Z%]*)$/);
        if (simpleMatch) {
            let n = parseFloat(simpleMatch[1].replace(',', '.'));
            let numStr = isNaN(n) ? simpleMatch[1] : n.toLocaleString('pt-BR');
            return (
                <span className="flex items-baseline gap-1">
                    <span>{numStr}</span>
                    {simpleMatch[2] && <span className="text-[13px] font-bold text-slate-400">{simpleMatch[2]}</span>}
                </span>
            );
        }

        return strVal;
    }, [value]);

    return (
        <div className="relative overflow-hidden bg-white rounded-2xl p-5 hover:shadow-lg transition-all group cursor-default" style={{ boxShadow: '0 2px 16px rgba(15,23,42,0.06)' }}>
            <div className={`absolute -top-6 -right-6 w-24 h-24 rounded-full bg-gradient-to-br ${gradient} opacity-[0.07] group-hover:opacity-[0.13] transition-opacity`} />
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} text-white flex items-center justify-center mb-4 shadow`}>
                {icon}
            </div>
            <div className="text-2xl font-black text-slate-800 tracking-tight leading-none" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                {renderedValue}
            </div>
            <p className="text-slate-400 text-xs font-medium mt-1.5 leading-snug">{label}</p>
        </div>
    );
};

// ─── DATE RANGE FILTER ────────────────────────────────────────────────────────
const DateRangeFilter = ({ onDateChange }) => {
    const [active, setActive] = useState('30d');
    const [customRange, setCustomRange] = useState([subDays(new Date(), 30), new Date()]);
    const [showPicker, setShowPicker] = useState(false);

    const ranges = {
        '7d': { label: 'Últimos 7 dias' },
        '30d': { label: 'Últimos 30 dias' },
        'this_month': { label: 'Este Mês' },
        'custom': { label: 'Personalizado' },
    };

    const handleSelect = (key) => {
        setActive(key);
        let start, end = new Date();
        if (key === 'this_month') {
            start = startOfMonth(end); end = endOfMonth(end);
            setShowPicker(false);
        } else if (key === 'custom') {
            setShowPicker(s => !s); return;
        } else {
            const days = { '7d': 7, '30d': 30 };
            start = subDays(end, days[key]); setShowPicker(false);
        }
        onDateChange(start, end);
    };

    return (
        <div className="relative">
            <div className="flex items-center gap-1 bg-slate-100/80 p-1 rounded-xl" style={{ border: '1px solid rgba(203,213,225,0.4)' }}>
                {Object.entries(ranges).map(([key, { label }]) => (
                    <button key={key} onClick={() => handleSelect(key)}
                        className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5
                            ${active === key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        {key === 'custom' && <CalendarIcon size={12} />}
                        {label}
                    </button>
                ))}
            </div>
            {showPicker && (
                <div className="absolute top-full right-0 mt-2 bg-white p-4 rounded-2xl z-20" style={{ boxShadow: '0 8px 40px rgba(15,23,42,0.12)', border: '1px solid rgba(203,213,225,0.4)' }}>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Período personalizado</p>
                    <DatePicker selectsRange inline locale="pt-BR" dateFormat="dd/MM/yyyy" maxDate={new Date()}
                        startDate={customRange[0]} endDate={customRange[1]}
                        onChange={update => setCustomRange(update)} />
                    <div className="flex justify-end gap-2 mt-3">
                        <button onClick={() => setShowPicker(false)} className="px-3 py-1.5 text-xs text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">Cancelar</button>
                        <button
                            onClick={() => { if (customRange[0] && customRange[1]) { onDateChange(customRange[0], customRange[1]); setShowPicker(false); } }}
                            disabled={!customRange[0] || !customRange[1]}
                            className="px-3 py-1.5 text-xs text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40"
                        >Aplicar</button>
                    </div>
                </div>
            )}
        </div>
    );
};

// ─── DASHBOARD PRINCIPAL ──────────────────────────────────────────────────────
const Dashboard = () => {
    const [data, setData] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [dateRange, setDateRange] = useState({ startDate: subDays(new Date(), 30), endDate: new Date() });
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisResult, setAnalysisResult] = useState(null);
    const [analysisError, setAnalysisError] = useState('');

    const fetchData = useCallback(async (startDate, endDate) => {
        setIsLoading(true); setError('');
        try {
            const response = await api.get('/dashboard/', {
                params: {
                    start_date_str: format(startDate, "yyyy-MM-dd'T'HH:mm:ssXXX"),
                    end_date_str: format(endDate, "yyyy-MM-dd'T'HH:mm:ssXXX"),
                }
            });
            setData(response.data);
        } catch (err) {
            console.error(err);
            setError('Não foi possível carregar os dados do dashboard.');
        } finally { setIsLoading(false); }
    }, []);

    useEffect(() => { fetchData(subDays(new Date(), 29), new Date()); }, [fetchData]);

    const handleDateChange = (startDate, endDate) => {
        setDateRange({ startDate, endDate }); fetchData(startDate, endDate);
    };

    const handleAIAnalysis = async (question, model) => {
        setIsAnalyzing(true); setAnalysisResult(null); setAnalysisError('');
        try {
            const response = await api.post('/dashboard/analyze', {
                question, model,
                start_date_str: format(dateRange.startDate, "yyyy-MM-dd'T'HH:mm:ssXXX"),
                end_date_str: format(dateRange.endDate, "yyyy-MM-dd'T'HH:mm:ssXXX"),
            });
            setAnalysisResult(response.data.analysis);
        } catch (err) {
            setAnalysisError(err.response?.data?.detail || 'Falha ao comunicar com o serviço de análise.');
        } finally { setIsAnalyzing(false); }
    };

    const formatTokenAxis = tick => {
        if (tick >= 1000000) return `${(tick / 1000000).toFixed(1)}M`;
        if (tick >= 1000) return `${(tick / 1000).toFixed(0)}k`;
        return tick;
    };

    if (isLoading && !data) {
        return (
            <div className="flex h-full items-center justify-center" style={{ background: '#f0f4ff' }}>
                <div className="flex flex-col items-center gap-3">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/25">
                        <Loader2 size={26} className="text-white animate-spin" />
                    </div>
                    <p className="text-slate-400 text-sm font-medium">Carregando dashboard...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex h-full items-center justify-center" style={{ background: '#f0f4ff' }}>
                <div className="flex flex-col items-center gap-3 p-10 text-center">
                    <AlertCircle size={36} className="text-red-400" />
                    <p className="text-slate-700 font-semibold">{error}</p>
                </div>
            </div>
        );
    }

    const hasChartData = data?.charts?.contatosPorDia && data?.charts?.atendimentosPorSituacao;

    return (
        <div className="h-full overflow-y-auto custom-scrollbar p-6 md:p-8" style={{ background: '#f0f4ff', fontFamily: 'Inter, sans-serif' }}>
            <style>{`
                .custom-scrollbar::-webkit-scrollbar { width: 8px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(203, 213, 225, 1); border-radius: 20px; border: 2px solid transparent; background-clip: padding-box; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #3b82f6; background-clip: padding-box; }
                @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800;900&family=Inter:wght@400;500;600&display=swap');
                .no-scrollbar::-webkit-scrollbar { display: none; }
                .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
            `}</style>
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
                <div>
                    <h1 className="text-2xl font-black text-slate-800 tracking-tight" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Dashboard</h1>
                    <p className="text-slate-400 mt-0.5 text-sm">Visão geral dos atendimentos e análise com IA</p>
                </div>
                <DateRangeFilter onDateChange={handleDateChange} />
            </div>

            {/* Spinner de atualização */}
            {isLoading && (
                <div className="fixed inset-0 bg-white/60 backdrop-blur-sm flex items-center justify-center z-50">
                    <Loader2 size={30} className="text-blue-600 animate-spin" />
                </div>
            )}

            {data && hasChartData && (
                <div className="space-y-6">
                    {/* Stat Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                        <StatCard icon={<TrendingUp size={19} />} label={data.stats?.totalAtendimentos?.label} value={data.stats?.totalAtendimentos?.value} gradient="from-blue-600 to-indigo-600" />
                        <StatCard icon={<CheckCircle size={19} />} label={data.stats?.totalConcluidos?.label} value={data.stats?.totalConcluidos?.value} gradient="from-emerald-500 to-teal-500" />
                        <StatCard icon={<Percent size={19} />} label={data.stats?.taxaConversao?.label} value={data.stats?.taxaConversao?.value} gradient="from-amber-400 to-orange-500" />
                        <StatCard icon={<Clock size={19} />} label={data.stats?.tempoMedioAtendimento?.label || "Tempo T. Médio"} value={data.stats?.tempoMedioAtendimento?.value} gradient="from-cyan-500 to-blue-500" />
                        <StatCard icon={<Activity size={19} />} label={data.stats?.tempoMedioResposta?.label || "Resposta Média"} value={data.stats?.tempoMedioResposta?.value} gradient="from-pink-500 to-rose-500" />
                        <StatCard icon={<Cpu size={19} />} label={data.stats?.consumoMedioTokens?.label} value={data.stats?.consumoMedioTokens?.value} gradient="from-violet-500 to-purple-600" />
                    </div>

                    {/* Gráficos */}
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                        {/* Line Chart */}
                        <div className="lg:col-span-3 bg-white rounded-2xl p-6" style={{ boxShadow: '0 2px 16px rgba(15,23,42,0.06)' }}>
                            <div className="flex items-center gap-2 mb-5">
                                <Activity size={17} className="text-blue-500" />
                                <h3 className="text-slate-700 font-semibold" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Volume de Atendimentos por Dia</h3>
                            </div>
                            <ResponsiveContainer width="100%" height={360}>
                                <LineChart data={data.charts.contatosPorDia} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="2 4" stroke="#f3f4f6" vertical={false} />
                                    <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} />
                                    <YAxis yAxisId="left" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} />
                                    <YAxis yAxisId="right" orientation="right" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={formatTokenAxis} />
                                    <Tooltip content={<CustomTooltip />} />
                                    <Legend wrapperStyle={{ fontSize: 12, color: '#6b7280', paddingTop: 12 }} />
                                    <Line yAxisId="left" type="monotone" dataKey="total" stroke={STATUS_COLORS['Total']} strokeWidth={2.5} name="Total" dot={false} />
                                    <Line yAxisId="right" type="monotone" dataKey="tokens" stroke={STATUS_COLORS['Tokens']} strokeWidth={1.5} name="Tokens" dot={false} strokeDasharray="4 3" />
                                    {Object.entries(STATUS_COLORS)
                                        .filter(([k]) => k !== 'Total' && k !== 'Tokens')
                                        .map(([status, color]) => (
                                            <Line key={status} yAxisId="left" type="monotone" dataKey={status} stroke={color} strokeWidth={1.5} name={status} dot={false} />
                                        ))}
                                </LineChart>
                            </ResponsiveContainer>
                        </div>

                        {/* Pie Chart */}
                        <div className="bg-white rounded-2xl p-6" style={{ boxShadow: '0 2px 16px rgba(15,23,42,0.06)' }}>
                            <div className="flex items-center gap-2 mb-5">
                                <PieIcon size={17} className="text-violet-500" />
                                <h3 className="text-slate-700 font-semibold" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Por Situação</h3>
                            </div>
                            <ResponsiveContainer width="100%" height={260}>
                                <PieChart>
                                    <Pie data={data.charts.atendimentosPorSituacao} dataKey="value" nameKey="name"
                                        cx="50%" cy="50%" innerRadius={50} outerRadius={80}
                                        paddingAngle={3} strokeWidth={2} stroke="#f9fafb">
                                        {data.charts.atendimentosPorSituacao.map((entry, i) => (
                                            <Cell key={i} fill={STATUS_COLORS[entry.name] || CHART_PALETTE[i % CHART_PALETTE.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip content={<CustomTooltip />} />
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="mt-3 flex flex-col gap-2">
                                {data.charts.atendimentosPorSituacao.map((entry, i) => (
                                    <div key={i} className="flex items-center gap-2.5 text-xs">
                                        <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: STATUS_COLORS[entry.name] || CHART_PALETTE[i % CHART_PALETTE.length] }} />
                                        <span className="text-gray-500 flex-1 truncate">{entry.name}</span>
                                        <span className="text-gray-700 font-bold">{entry.value}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* AI Analyzer */}
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