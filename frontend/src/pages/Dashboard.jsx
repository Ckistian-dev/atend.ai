// src/pages/Dashboard.jsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import api from '../api/axiosConfig';
import PageLoader from '../components/common/PageLoader';

import {
    BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
    Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell,
    AreaChart, Area, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis
} from 'recharts';
import { subDays, startOfMonth, endOfMonth, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import DatePicker, { registerLocale } from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { LLM_MODELS, DEFAULT_MODEL } from '../constants/models.json';
import {
    Loader2, TrendingUp, CheckCircle, Percent, Cpu, Send, AlertCircle,
    Calendar as CalendarIcon, Lightbulb, Zap, ArrowRight, BarChart3,
    AlertTriangle, FileDown, Target, Activity, Clock, Users, Star,
    TrendingDown, CheckCircle2, XCircle, Sparkles, LayoutGrid, Radio,
    PieChart as PieIcon, BarChart2, Brain, ChevronUp, ChevronDown, Minus, Info, Bell
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
    oportunidade: { icon: <Star size={14} />, bg: 'bg-emerald-500', ring: 'ring-emerald-200' },
    sucesso: { icon: <CheckCircle2 size={14} />, bg: 'bg-blue-500', ring: 'ring-blue-200' },
    alerta: { icon: <AlertTriangle size={14} />, bg: 'bg-amber-500', ring: 'ring-amber-200' },
    perda: { icon: <XCircle size={14} />, bg: 'bg-red-500', ring: 'ring-red-200' },
    info: { icon: <Info size={14} />, bg: 'bg-indigo-500', ring: 'ring-indigo-200' },
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
        alta: { icon: <ChevronUp size={18} />, class: 'text-emerald-300 bg-white/10', border: 'border-emerald-400/30', label: 'Em alta' },
        baixa: { icon: <ChevronDown size={18} />, class: 'text-rose-300 bg-white/10', border: 'border-rose-400/30', label: 'Em queda' },
        neutro: { icon: <Minus size={18} />, class: 'text-blue-100 bg-white/10', border: 'border-white/10', label: 'Estável' },
    };
    const trend = trendMap[modulo.tendencia] || trendMap.neutro;
    return (
        <div className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-[#1d4ed8] via-[#2563eb] to-[#3b82f6] p-6 sm:p-10 shadow-2xl">
            {/* Glossy effects */}
            <div className="absolute top-[-40px] right-[-40px] w-64 h-64 rounded-full bg-white/10 blur-3xl" />
            <div className="absolute bottom-[-60px] left-[-40px] w-56 h-56 rounded-full bg-indigo-400/20 blur-3xl" />

            <div className="relative z-10 flex flex-col md:flex-row md:items-end md:justify-between gap-8">
                <div className="space-y-2">
                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/10 rounded-full border border-white/10">
                        <Sparkles size={12} className="text-blue-200" />
                        <p className="text-blue-100 text-[10px] font-bold uppercase tracking-[0.15em]">Resposta Principal</p>
                    </div>
                    <div className="flex flex-col">
                        <p className="text-white text-6xl sm:text-7xl font-black tracking-tighter leading-none">{modulo.valor}</p>
                        <p className="text-blue-50 text-xl sm:text-2xl font-bold mt-2">{modulo.label}</p>
                    </div>
                </div>
                <div className="flex flex-col gap-4 items-start md:items-end">
                    <span className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold border ${trend.border} ${trend.class} backdrop-blur-md shadow-lg`}>
                        {trend.icon}{trend.label}
                    </span>
                    {modulo.descricao && (
                        <p className="text-blue-100/80 text-sm max-w-xs md:text-right leading-relaxed font-medium">{modulo.descricao}</p>
                    )}
                </div>
            </div>
        </div>
    );
};

// 2. Metric Grid
const MetricGridModule = ({ modulo }) => (
    <div className="rounded-[24px] bg-white p-6 shadow-xl shadow-slate-100 border border-slate-100/50">
        {modulo.titulo && (
            <div className="flex items-center gap-2 mb-6">
                <div className="p-2 bg-blue-50 rounded-lg">
                    <LayoutGrid size={18} className="text-blue-600" />
                </div>
                <h3 className="text-slate-800 font-bold text-base tracking-tight" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>{modulo.titulo}</h3>
            </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {(modulo.metricas || []).map((m, i) => {
                const cor = COR_MAP[m.cor] || COR_MAP.azul;
                return (
                    <div key={i} className="group rounded-[20px] p-5 bg-slate-50/50 hover:bg-white hover:shadow-xl hover:shadow-slate-200/50 transition-all duration-300 border border-transparent hover:border-slate-100 ring-1 ring-slate-200/20">
                        <div className={`w-10 h-10 rounded-xl ${cor.icon} text-white flex items-center justify-center mb-4 shadow-lg shadow-blue-500/10 group-hover:scale-110 transition-transform`}>
                            {ICON_MAP[m.icone] || <Activity size={18} />}
                        </div>
                        <p className="text-3xl font-black text-slate-900 tracking-tighter leading-none mb-1.5">{m.valor}</p>
                        <p className="text-slate-500 text-xs font-bold uppercase tracking-wider leading-snug">{m.label}</p>
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
        <div className="rounded-[24px] bg-white p-6 shadow-xl shadow-slate-100 border border-slate-100/50">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-violet-50 rounded-lg">
                        <PieIcon size={18} className="text-violet-600" />
                    </div>
                    <div>
                        <h3 className="text-slate-800 font-bold text-base tracking-tight" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>{modulo.titulo}</h3>
                        {modulo.descricao && <p className="text-slate-400 text-xs mt-0.5">{modulo.descricao}</p>}
                    </div>
                </div>
                <div className="hidden sm:flex flex-col items-end">
                    <span className="text-2xl font-black text-slate-900 tracking-tighter leading-none">{total.toLocaleString('pt-BR')}</span>
                    <span className="text-slate-400 text-[10px] font-bold uppercase tracking-widest leading-none mt-1">Total Geral</span>
                </div>
            </div>

            <div className="flex flex-col lg:flex-row items-center gap-8">
                <div className="w-full max-w-[240px] aspect-square flex-shrink-0 relative">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie data={modulo.dados} dataKey="value" cx="50%" cy="50%"
                                innerRadius="60%" outerRadius="90%" paddingAngle={4} strokeWidth={0} stroke="#fff">
                                {modulo.dados.map((_, idx) => (
                                    <Cell key={idx} fill={CHART_PALETTE[idx % CHART_PALETTE.length]} className="focus:outline-none transition-all" />
                                ))}
                            </Pie>
                            <Tooltip content={<CustomTooltip />} />
                        </PieChart>
                    </ResponsiveContainer>
                    {/* Inner label for mobile center or just visual */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none sm:hidden">
                        <span className="text-2xl font-black text-slate-800 leading-none">{total}</span>
                        <span className="text-slate-400 text-[10px] uppercase font-bold tracking-widest mt-1">Total</span>
                    </div>
                </div>

                <div className="w-full flex-1">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                        {modulo.dados.map((entry, i) => (
                            <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100/50 hover:bg-slate-100/80 transition-colors">
                                <div className="flex items-center gap-3 min-w-0">
                                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }} />
                                    <span className="text-slate-600 font-semibold text-xs truncate">{entry.name}</span>
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                    <span className="text-slate-900 font-bold text-sm tracking-tight">{entry.value}</span>
                                    <span className="text-blue-600 text-[10px] font-black w-8 text-right px-1 bg-blue-50 rounded">
                                        {total > 0 ? Math.round(entry.value / total * 100) : 0}%
                                    </span>
                                </div>
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
        <div className="rounded-[24px] bg-white p-6 shadow-xl shadow-slate-100 border border-slate-100/50">
            <div className="flex items-center gap-2.5 mb-6">
                <div className="p-2 bg-blue-50 rounded-lg">
                    <BarChart2 size={18} className="text-blue-600" />
                </div>
                <div>
                    <h3 className="text-slate-800 font-bold text-base tracking-tight" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>{modulo.titulo}</h3>
                    {modulo.descricao && <p className="text-slate-400 text-xs mt-0.5">{modulo.descricao}</p>}
                </div>
            </div>

            <div className="h-64 sm:h-72 mt-4 -ml-6 sm:ml-0">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={modulo.dados} margin={{ top: 5, right: 10, left: 10, bottom: 20 }} barSize={32}>
                        <defs>
                            <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#3b82f6" stopOpacity={1} />
                                <stop offset="100%" stopColor="#2563eb" stopOpacity={0.8} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }} axisLine={false} tickLine={false}
                            interval={0} angle={modulo.dados.length > 5 ? -35 : 0}
                            textAnchor={modulo.dados.length > 5 ? 'end' : 'middle'} />
                        <YAxis tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }} axisLine={false} tickLine={false} />
                        <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f8fafc', radius: 8 }} />
                        <Bar dataKey="value" name={modulo.eixo_x || 'Valor'} radius={[8, 8, 0, 0]} fill="url(#barGradient)">
                            {modulo.dados.map((_, idx) => (
                                <Cell key={idx} className="hover:opacity-80 transition-opacity cursor-pointer" />
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
    <div className="rounded-[24px] bg-white p-6 shadow-xl shadow-slate-100 border border-slate-100/50">
        <div className="flex items-center gap-2.5 mb-6">
            <div className="p-2 bg-rose-50 rounded-lg">
                <AlertTriangle size={18} className="text-rose-600" />
            </div>
            <h3 className="text-slate-800 font-bold text-base tracking-tight" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>{modulo.titulo || 'Pontos de Fricção'}</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(modulo.itens || []).map((item, i) => {
                const isShortImpact = item.impacto && (item.impacto === 'Alto' || item.impacto === 'Médio' || item.impacto === 'Baixo');
                const cfg = IMPACTO_CONFIG[item.impacto] || IMPACTO_CONFIG['Baixo'];
                const rawExemplos = item.contatos_exemplo || item.ids_exemplo;
                const exemplosArray = Array.isArray(rawExemplos) ? rawExemplos : (rawExemplos ? [rawExemplos] : []);

                return (
                    <div key={i} className="group rounded-[20px] p-5 bg-slate-50 border border-slate-100 hover:bg-white hover:shadow-xl hover:shadow-slate-200/40 transition-all duration-300">
                        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                            <h4 className="text-slate-800 font-bold text-sm leading-tight flex-1 min-w-[60%]">{item.area}</h4>
                            <span className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${cfg.pill} shadow-sm max-w-full`}>
                                <span className={`w-1.5 h-1.5 flex-shrink-0 rounded-full ${cfg.dot} animate-pulse`} />
                                <span className="truncate">{isShortImpact ? item.impacto : 'Atenção'}</span>
                            </span>
                        </div>
                        <p className="text-slate-500 text-xs leading-relaxed font-medium mb-3">{item.observacoes}</p>
                        {!isShortImpact && item.impacto && (
                            <div className="text-slate-600 text-xs leading-relaxed font-medium mb-3 bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                                <span className="font-bold text-slate-700 block mb-1">Impacto Esperado:</span>
                                {item.impacto}
                            </div>
                        )}
                        {exemplosArray.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pt-3 border-t border-slate-200/50">
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mr-1 mt-0.5">Exemplos:</span>
                                {exemplosArray.map((contato, idx) => (
                                    <span key={idx} className="text-[10px] font-bold px-2 py-0.5 bg-white border border-slate-200 rounded-lg text-slate-600 shadow-sm">
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
    <div className="rounded-[24px] bg-white p-6 shadow-xl shadow-slate-100 border border-slate-100/50">
        <div className="flex items-center gap-2.5 mb-6">
            <div className="p-2 bg-amber-50 rounded-lg">
                <Sparkles size={18} className="text-amber-600" />
            </div>
            <h3 className="text-slate-800 font-bold text-base tracking-tight" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>{modulo.titulo || 'Insights Estratégicos'}</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(modulo.itens || []).map((item, i) => {
                const pri = PRIORIDADE_CONFIG[item.prioridade] || PRIORIDADE_CONFIG.baixa;
                return (
                    <div key={i} className={`group relative rounded-[20px] p-5 border-l-4 ${pri.border} ${pri.bg} border-t border-r border-b border-transparent hover:shadow-xl hover:shadow-slate-200/40 transition-all duration-300`}>
                        <div className="flex items-start gap-4">
                            <div className="w-10 h-10 rounded-xl bg-white flex-shrink-0 flex items-center justify-center text-slate-500 shadow-md group-hover:scale-110 group-hover:rotate-3 transition-transform">
                                {ICON_MAP[item.icone] || <Lightbulb size={18} />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-2 flex-wrap">
                                    <h4 className="text-slate-800 font-bold text-sm tracking-tight">{item.titulo}</h4>
                                    <span className={`text-[9px] px-2 py-0.5 rounded-full font-black uppercase tracking-widest ${pri.badge} shadow-sm border border-black/5`}>
                                        {pri.label}
                                    </span>
                                </div>
                                <p className="text-slate-600 text-xs leading-relaxed font-medium">{item.descricao}</p>
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
    <div className="rounded-[24px] bg-white p-6 sm:p-8 shadow-xl shadow-slate-100 border border-slate-100/50">
        <div className="flex items-center gap-2.5 mb-8">
            <div className="p-2 bg-indigo-50 rounded-lg">
                <Radio size={18} className="text-indigo-600" />
            </div>
            <h3 className="text-slate-800 font-bold text-base tracking-tight" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                {modulo.titulo || 'Destaque do Período'}
            </h3>
        </div>
        <div className="relative pl-4 sm:pl-8">
            <div className="absolute left-[7px] sm:left-[15px] top-2 bottom-2 w-[2px] bg-gradient-to-b from-indigo-100 via-slate-200 to-transparent rounded-full" />
            <div className="flex flex-col gap-6">
                {(modulo.eventos || []).map((ev, i) => {
                    let tipo = ev.tipo;
                    if (!tipo || !TIMELINE_CONFIG[tipo]) {
                        const str = ((ev.titulo || '') + ' ' + (ev.descricao || '')).toLowerCase();
                        if (str.includes('sucesso') || str.includes('concluído')) tipo = 'sucesso';
                        else if (str.includes('perda') || str.includes('falha')) tipo = 'perda';
                        else if (str.includes('oportunidade')) tipo = 'oportunidade';
                        else tipo = 'info';
                    }
                    const cfg = TIMELINE_CONFIG[tipo];
                    return (
                        <div key={i} className="relative group">
                            <div className={`absolute -left-[25px] sm:-left-[33px] top-1 w-7 h-7 rounded-full ${cfg.bg} ring-4 ring-white shadow-md flex items-center justify-center text-white transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6 z-10`}>
                                {cfg.icon}
                            </div>
                            <div className="bg-white rounded-[20px] p-5 border border-slate-100 shadow-sm hover:shadow-xl hover:shadow-slate-200/50 hover:border-slate-200 transition-all duration-300 ml-2 sm:ml-4">
                                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-2">
                                    <div className="flex-1">
                                        {ev.titulo && <h4 className="text-slate-800 font-bold text-sm tracking-tight mb-1.5 leading-tight">{ev.titulo}</h4>}
                                        {ev.descricao && <p className="text-slate-600 text-xs leading-relaxed font-medium">{ev.descricao}</p>}
                                        {!ev.titulo && !ev.descricao && <p className="text-slate-400 text-xs italic">Evento sem descrição</p>}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                                        {ev.data && (
                                            <span className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 bg-slate-50 px-2.5 py-1.5 rounded-xl border border-slate-100">
                                                <Clock size={12} className="text-slate-400" />
                                                {ev.data}
                                            </span>
                                        )}
                                        {(ev.whatsapp || ev.id) && (
                                            <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-2.5 py-1.5 rounded-xl border border-indigo-100/50 uppercase tracking-widest shadow-sm">
                                                {ev.whatsapp ? `WA: ${ev.whatsapp}` : `#${ev.id}`}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    </div>
);

// 9. Line Chart
const LineChartModule = ({ modulo }) => {
    if (!modulo.dados?.length) return null;
    return (
        <div className="rounded-[24px] bg-white p-6 shadow-xl shadow-slate-100 border border-slate-100/50">
            <div className="flex items-center gap-2.5 mb-6">
                <div className="p-2 bg-blue-50 rounded-lg">
                    <TrendingUp size={18} className="text-blue-600" />
                </div>
                <div>
                    <h3 className="text-slate-800 font-bold text-base tracking-tight" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>{modulo.titulo}</h3>
                    {modulo.descricao && <p className="text-slate-400 text-xs mt-0.5">{modulo.descricao}</p>}
                </div>
            </div>
            <div className="h-64 sm:h-72 mt-4 -ml-6 sm:ml-0">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={modulo.dados} margin={{ top: 5, right: 10, left: 10, bottom: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }} axisLine={false} tickLine={false} />
                        <Tooltip content={<CustomTooltip />} />
                        <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={3} dot={{ r: 4, fill: '#fff', strokeWidth: 2 }} activeDot={{ r: 6 }} />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

// 10. Area Chart
const AreaChartModule = ({ modulo }) => {
    if (!modulo.dados?.length) return null;
    return (
        <div className="rounded-[24px] bg-white p-6 shadow-xl shadow-slate-100 border border-slate-100/50">
            <div className="flex items-center gap-2.5 mb-6">
                <div className="p-2 bg-indigo-50 rounded-lg">
                    <Activity size={18} className="text-indigo-600" />
                </div>
                <div>
                    <h3 className="text-slate-800 font-bold text-base tracking-tight" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>{modulo.titulo}</h3>
                    {modulo.descricao && <p className="text-slate-400 text-xs mt-0.5">{modulo.descricao}</p>}
                </div>
            </div>
            <div className="h-64 sm:h-72 mt-4 -ml-6 sm:ml-0">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={modulo.dados} margin={{ top: 5, right: 10, left: 10, bottom: 20 }}>
                        <defs>
                            <linearGradient id="areaColor" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }} axisLine={false} tickLine={false} />
                        <Tooltip content={<CustomTooltip />} />
                        <Area type="monotone" dataKey="value" stroke="#6366f1" fillOpacity={1} fill="url(#areaColor)" strokeWidth={3} />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

// 11. Radar Chart
const RadarChartModule = ({ modulo }) => {
    if (!modulo.categorias?.length) return null;
    return (
        <div className="rounded-[24px] bg-white p-6 shadow-xl shadow-slate-100 border border-slate-100/50">
            <div className="flex items-center gap-2.5 mb-6">
                <div className="p-2 bg-teal-50 rounded-lg">
                    <Target size={18} className="text-teal-600" />
                </div>
                <div>
                    <h3 className="text-slate-800 font-bold text-base tracking-tight" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>{modulo.titulo}</h3>
                    {modulo.descricao && <p className="text-slate-400 text-xs mt-0.5">{modulo.descricao}</p>}
                </div>
            </div>
            <div className="h-64 sm:h-80 w-full flex justify-center">
                <ResponsiveContainer width="100%" height="100%">
                    <RadarChart cx="50%" cy="50%" outerRadius="70%" data={modulo.categorias}>
                        <PolarGrid stroke="#f1f5f9" />
                        <PolarAngleAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }} />
                        <PolarRadiusAxis angle={30} domain={[0, modulo.categorias[0]?.fullMark || 100]} tick={false} axisLine={false} />
                        <Radar name={modulo.titulo} dataKey="value" stroke="#14b8a6" fill="#14b8a6" fillOpacity={0.4} strokeWidth={2} />
                        <Tooltip />
                    </RadarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

// 12. Progress List
const ProgressListModule = ({ modulo }) => {
    if (!modulo.itens?.length) return null;
    return (
        <div className="rounded-[24px] bg-white p-6 shadow-xl shadow-slate-100 border border-slate-100/50">
            <div className="flex items-center gap-2.5 mb-6">
                <div className="p-2 bg-cyan-50 rounded-lg">
                    <BarChart3 size={18} className="text-cyan-600" />
                </div>
                <div>
                    <h3 className="text-slate-800 font-bold text-base tracking-tight" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>{modulo.titulo}</h3>
                    {modulo.descricao && <p className="text-slate-400 text-xs mt-0.5">{modulo.descricao}</p>}
                </div>
            </div>
            <div className="flex flex-col gap-4">
                {modulo.itens.map((item, i) => (
                    <div key={i} className="flex flex-col gap-1.5">
                        <div className="flex justify-between items-center text-sm font-semibold text-slate-700">
                            <span>{item.label}</span>
                            <span>{item.valor_texto || `${item.progresso}%`}</span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                            <div className="bg-cyan-500 h-2.5 rounded-full transition-all duration-1000" style={{ width: `${item.progresso}%` }}></div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// 13. SWOT Analysis
const SwotAnalysisModule = ({ modulo }) => {
    return (
        <div className="rounded-[24px] bg-white p-6 shadow-xl shadow-slate-100 border border-slate-100/50">
            <div className="flex items-center gap-2.5 mb-6">
                <div className="p-2 bg-slate-100 rounded-lg">
                    <LayoutGrid size={18} className="text-slate-700" />
                </div>
                <h3 className="text-slate-800 font-bold text-base tracking-tight" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>{modulo.titulo || "Análise SWOT"}</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-100">
                    <h4 className="text-emerald-800 font-black text-sm uppercase tracking-wider mb-3 flex items-center gap-2"><CheckCircle2 size={16} /> Forças</h4>
                    <ul className="list-disc pl-5 space-y-1 text-emerald-700 text-sm font-medium">
                        {(modulo.forcas || []).map((f, i) => <li key={i}>{f}</li>)}
                    </ul>
                </div>
                <div className="p-4 rounded-xl bg-rose-50 border border-rose-100">
                    <h4 className="text-rose-800 font-black text-sm uppercase tracking-wider mb-3 flex items-center gap-2"><AlertTriangle size={16} /> Fraquezas</h4>
                    <ul className="list-disc pl-5 space-y-1 text-rose-700 text-sm font-medium">
                        {(modulo.fraquezas || []).map((f, i) => <li key={i}>{f}</li>)}
                    </ul>
                </div>
                <div className="p-4 rounded-xl bg-blue-50 border border-blue-100">
                    <h4 className="text-blue-800 font-black text-sm uppercase tracking-wider mb-3 flex items-center gap-2"><Lightbulb size={16} /> Oportunidades</h4>
                    <ul className="list-disc pl-5 space-y-1 text-blue-700 text-sm font-medium">
                        {(modulo.oportunidades || []).map((f, i) => <li key={i}>{f}</li>)}
                    </ul>
                </div>
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-100">
                    <h4 className="text-amber-800 font-black text-sm uppercase tracking-wider mb-3 flex items-center gap-2"><Zap size={16} /> Ameaças</h4>
                    <ul className="list-disc pl-5 space-y-1 text-amber-700 text-sm font-medium">
                        {(modulo.ameacas || []).map((f, i) => <li key={i}>{f}</li>)}
                    </ul>
                </div>
            </div>
        </div>
    );
};

// 14. Sentiment Meter
const SentimentMeterModule = ({ modulo }) => {
    return (
        <div className="rounded-[24px] bg-white p-6 shadow-xl shadow-slate-100 border border-slate-100/50">
            <div className="flex items-center gap-2.5 mb-6">
                <div className="p-2 bg-pink-50 rounded-lg">
                    <Star size={18} className="text-pink-600" />
                </div>
                <h3 className="text-slate-800 font-bold text-base tracking-tight" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>{modulo.titulo || "Análise de Sentimento"}</h3>
            </div>
            <div className="flex items-center justify-between gap-2 mb-2 text-xs font-bold uppercase tracking-widest">
                <span className="text-emerald-500">Positivo {modulo.positivo}%</span>
                <span className="text-slate-400">Neutro {modulo.neutro}%</span>
                <span className="text-rose-500">Negativo {modulo.negativo}%</span>
            </div>
            <div className="w-full h-4 flex rounded-full overflow-hidden mb-4 bg-slate-100">
                <div className="bg-emerald-500 h-full transition-all" style={{ width: `${modulo.positivo}%` }}></div>
                <div className="bg-slate-300 h-full transition-all" style={{ width: `${modulo.neutro}%` }}></div>
                <div className="bg-rose-500 h-full transition-all" style={{ width: `${modulo.negativo}%` }}></div>
            </div>
            {modulo.resumo && <p className="text-slate-600 text-sm text-center font-medium bg-slate-50 p-3 rounded-xl border border-slate-100">{modulo.resumo}</p>}
        </div>
    );
};

// 15. Action Steps
const ActionStepsModule = ({ modulo }) => {
    return (
        <div className="rounded-[24px] bg-white p-6 shadow-xl shadow-slate-100 border border-slate-100/50">
            <div className="flex items-center gap-2.5 mb-6">
                <div className="p-2 bg-orange-50 rounded-lg">
                    <ArrowRight size={18} className="text-orange-600" />
                </div>
                <h3 className="text-slate-800 font-bold text-base tracking-tight" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>{modulo.titulo || "Plano de Ação"}</h3>
            </div>
            <div className="flex flex-col gap-4">
                {(modulo.passos || []).map((passo, i) => (
                    <div key={i} className="flex gap-4">
                        <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex-shrink-0 flex items-center justify-center font-black text-sm shadow-md">
                            {passo.numero || (i + 1)}
                        </div>
                        <div className="flex-1 bg-slate-50 p-4 rounded-xl border border-slate-100">
                            <h4 className="text-slate-800 font-bold text-sm mb-1">{passo.titulo}</h4>
                            <p className="text-slate-600 text-xs font-medium leading-relaxed">{passo.descricao}</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// 16. Highlight Quotes
const HighlightQuotesModule = ({ modulo }) => {
    return (
        <div className="rounded-[24px] bg-white p-6 shadow-xl shadow-slate-100 border border-slate-100/50">
            <div className="flex items-center gap-2.5 mb-6">
                <div className="p-2 bg-fuchsia-50 rounded-lg">
                    <Star size={18} className="text-fuchsia-600" />
                </div>
                <h3 className="text-slate-800 font-bold text-base tracking-tight" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>{modulo.titulo || "Citações Destacadas"}</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(modulo.citacoes || []).map((cita, i) => (
                    <div key={i} className="p-5 bg-white border border-fuchsia-100 rounded-[20px] shadow-sm relative">
                        <div className="text-fuchsia-200 text-4xl font-serif absolute top-3 left-3 opacity-50">"</div>
                        <p className="text-slate-700 italic font-medium text-sm mb-3 relative z-10 pl-4">"{cita.texto}"</p>
                        <div className="flex justify-between items-end">
                            <span className="text-slate-900 font-bold text-xs">— {cita.autor}</span>
                            {cita.contexto && <span className="text-[10px] text-fuchsia-600 bg-fuchsia-50 px-2 py-1 rounded-md">{cita.contexto}</span>}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// 17. Comparative Table
const ComparativeTableModule = ({ modulo }) => {
    return (
        <div className="rounded-[24px] bg-white p-6 shadow-xl shadow-slate-100 border border-slate-100/50 overflow-x-auto">
            <div className="flex items-center gap-2.5 mb-6">
                <div className="p-2 bg-indigo-50 rounded-lg">
                    <LayoutGrid size={18} className="text-indigo-600" />
                </div>
                <h3 className="text-slate-800 font-bold text-base tracking-tight" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>{modulo.titulo || "Comparativo"}</h3>
            </div>
            <div className="w-full overflow-x-auto">
                <table className="w-full min-w-[500px] text-left border-collapse">
                    <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold text-xs uppercase tracking-wider">
                            {(modulo.colunas || []).map((col, i) => <th key={i} className="p-3 whitespace-nowrap">{col}</th>)}
                        </tr>
                    </thead>
                    <tbody className="text-sm font-medium text-slate-700">
                        {(modulo.linhas || []).map((linha, i) => (
                            <tr key={i} className="border-b border-slate-100 hover:bg-slate-50/50">
                                {linha.map((celula, j) => <td key={j} className="p-3">{celula}</td>)}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

// 18. Key Value List
const KeyValueListModule = ({ modulo }) => {
    return (
        <div className="rounded-[24px] bg-white p-6 shadow-xl shadow-slate-100 border border-slate-100/50">
            <div className="flex items-center gap-2.5 mb-6">
                <div className="p-2 bg-emerald-50 rounded-lg">
                    <Info size={18} className="text-emerald-600" />
                </div>
                <h3 className="text-slate-800 font-bold text-base tracking-tight" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>{modulo.titulo || "Detalhes"}</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {(modulo.itens || []).map((item, i) => (
                    <div key={i} className="flex justify-between items-center p-4 rounded-xl bg-slate-50 border border-slate-100">
                        <span className="text-slate-500 text-xs font-bold uppercase tracking-wider">{item.chave}</span>
                        <span className="text-slate-900 font-black text-sm bg-white px-3 py-1 rounded-lg shadow-sm border border-slate-200">{item.valor}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};


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
            case 'line_chart': return <LineChartModule modulo={modulo} />;
            case 'area_chart': return <AreaChartModule modulo={modulo} />;
            case 'radar_chart': return <RadarChartModule modulo={modulo} />;
            case 'progress_list': return <ProgressListModule modulo={modulo} />;
            case 'swot_analysis': return <SwotAnalysisModule modulo={modulo} />;
            case 'sentiment_meter': return <SentimentMeterModule modulo={modulo} />;
            case 'action_steps': return <ActionStepsModule modulo={modulo} />;
            case 'highlight_quotes': return <HighlightQuotesModule modulo={modulo} />;
            case 'comparative_table': return <ComparativeTableModule modulo={modulo} />;
            case 'key_value_list': return <KeyValueListModule modulo={modulo} />;
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
        { q: "Resumo dos atendimentos e status?", icon: <Users size={13} /> },
        { q: "Por que perdemos conversão?", icon: <AlertTriangle size={13} /> },
        { q: "Identifique gargalos operacionais.", icon: <Clock size={13} /> },
        { q: "Sugira ações para converter mais.", icon: <TrendingUp size={13} /> },
    ];

    const handleSubmit = (e) => {
        e.preventDefault();
        if (question.trim()) onAnalyze(question, selectedModel);
    };

    return (
        <div className="bg-white rounded-[32px] p-5 sm:p-8 mt-8 border border-slate-100 shadow-2xl shadow-slate-200/50">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 mb-8 text-center sm:text-left">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-600 via-blue-500 to-indigo-600 flex items-center justify-center shadow-xl shadow-blue-200 shrink-0">
                    <Brain size={28} className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-center sm:justify-start gap-2 mb-1">
                        <h3 className="text-slate-900 font-black text-xl tracking-tight" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Análise Inteligente</h3>
                        <span className="px-2 py-0.5 rounded-lg bg-blue-50 text-blue-600 text-[10px] font-black uppercase tracking-widest border border-blue-100">PRO</span>
                    </div>
                    <p className="text-slate-400 text-sm leading-relaxed max-w-2xl px-2 sm:px-0">Gere insights estratégicos, identifique gargalos e otimize sua conversão automaticamente.</p>
                </div>
            </div>

            {/* Command Bar Area */}
            <div className="flex flex-col gap-5 mb-8">
                <div className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-end">
                    {/* Seleção de modelo */}
                    <div className="w-full lg:w-64 space-y-1.5">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] ml-1">Modelo de IA</label>
                        <div className="relative">
                            <select
                                value={selectedModel}
                                onChange={e => setSelectedModel(e.target.value)}
                                className="w-full bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-2xl pl-4 pr-10 py-3.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all appearance-none cursor-pointer font-bold"
                            >
                                {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                            </select>
                            <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        </div>
                    </div>

                    {/* Input de pergunta */}
                    <form onSubmit={handleSubmit} className="flex-1 flex flex-col sm:flex-row gap-3">
                        <div className="flex-1 relative group">
                            <Sparkles size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500/50 group-focus-within:text-blue-600 transition-colors" />
                            <input
                                type="text"
                                value={question}
                                onChange={e => setQuestion(e.target.value)}
                                placeholder="O que você quer analisar hoje?"
                                className="w-full bg-slate-50 border border-slate-200 text-slate-800 placeholder-slate-400 text-sm font-medium rounded-2xl pl-12 pr-4 py-3.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                disabled={isLoading}
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={isLoading || !question.trim()}
                            className="w-full sm:w-auto px-8 py-3.5 bg-slate-900 border border-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-black transition-all shadow-xl shadow-slate-200 active:scale-95 disabled:opacity-50"
                        >
                            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                            <span>{isLoading ? 'Analisando' : 'Analisar'}</span>
                        </button>
                    </form>
                </div>

                {/* Sugestões de Perguntas */}
                <div className="flex items-center gap-2 overflow-x-auto pb-2 no-scrollbar -mx-2 px-2">
                    {predefined.map(({ q, icon }, i) => (
                        <button
                            key={i}
                            onClick={() => setQuestion(q)}
                            disabled={isLoading}
                            className="flex-shrink-0 flex items-center gap-2 text-[10px] font-black uppercase tracking-wider px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-blue-600 hover:border-blue-200 hover:bg-blue-50 transition-all disabled:opacity-50 shadow-sm whitespace-nowrap"
                        >
                            {icon}{q}
                        </button>
                    ))}
                </div>
            </div>

            {/* Error handling */}
            {error && !isLoading && (
                <div className="mb-8 p-4 bg-rose-50 border border-rose-100 rounded-2xl flex items-start gap-3">
                    <AlertCircle size={18} className="text-rose-500 shrink-0 mt-0.5" />
                    <p className="text-rose-700 text-sm font-bold">{error}</p>
                </div>
            )}

            {/* Loading placeholder */}
            {isLoading && (
                <div className="py-16 flex flex-col items-center justify-center gap-6 animate-pulse h-[600px]">
                    <div className="relative">
                        <div className="w-16 h-16 rounded-3xl bg-blue-50 flex items-center justify-center">
                            <Brain size={32} className="text-blue-600" />
                        </div>
                        <div className="absolute top-0 right-0 w-4 h-4 bg-blue-500 rounded-full border-2 border-white animate-bounce" />
                    </div>
                    <div className="text-center">
                        <p className="text-slate-800 font-black text-lg">Processando Insights...</p>
                        <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">Isso pode levar alguns segundos</p>
                    </div>
                </div>
            )}

            {/* Relatório Final */}
            {analysis && !isLoading && <AnalysisReport analysisData={analysis} />}
        </div>
    );
};

// ─── STAT CARD ────────────────────────────────────────────────────────────────
const StatCard = ({ icon, label, value, gradient, delay = 0 }) => {
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
        <div
            className="group relative overflow-hidden bg-white rounded-[24px] p-6 hover:shadow-2xl hover:shadow-slate-200 transition-all duration-500 border border-slate-100/50 hover:border-blue-100 hover:-translate-y-1.5 cursor-default"
            style={{ animation: `fade-in-up 0.5s ease backwards ${delay}s` }}
        >
            <div className={`absolute -top-12 -right-12 w-32 h-32 rounded-full bg-gradient-to-br ${gradient} opacity-0 group-hover:opacity-[0.08] blur-2xl transition-opacity duration-700`} />
            <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${gradient} text-white flex items-center justify-center mb-5 shadow-lg group-hover:scale-110 group-hover:rotate-6 transition-transform duration-500`}>
                {icon}
            </div>
            <div className="text-3xl font-black text-slate-900 tracking-tighter leading-none mb-2" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                {renderedValue}
            </div>
            <p className="text-slate-400 text-[11px] font-bold uppercase tracking-wider leading-snug group-hover:text-slate-600 transition-colors">{label}</p>

            {/* Corner decorator */}
            <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <Sparkles size={12} className="text-slate-200" />
            </div>
        </div>
    );
};

// ─── DATE RANGE FILTER ────────────────────────────────────────────────────────
const DateRangeFilter = ({ onDateChange }) => {
    const [active, setActive] = useState('7d');
    const [customRange, setCustomRange] = useState([subDays(new Date(), 30), new Date()]);
    const [showPicker, setShowPicker] = useState(false);

    const ranges = {
        '7d': { label: '7 D' },
        '30d': { label: '30 D' },
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
        <div className="relative w-full sm:w-auto">
            <div className="flex items-center gap-1 bg-slate-200/50 p-1.5 rounded-2xl border border-slate-300/30 overflow-x-auto no-scrollbar max-w-full shadow-inner shadow-black/5">
                {Object.entries(ranges).map(([key, { label }]) => (
                    <button key={key} onClick={() => handleSelect(key)}
                        className={`px-4 py-2 text-xs font-black rounded-xl transition-all flex items-center gap-2 whitespace-nowrap uppercase tracking-tighter
                            ${active === key
                                ? 'bg-white text-blue-700 shadow-xl shadow-blue-500/10 ring-1 ring-blue-500/10'
                                : 'text-slate-500 hover:text-slate-900 hovr:bg-white/50'}`}
                    >
                        {key === 'custom' && <CalendarIcon size={14} className={active === key ? 'text-blue-500' : 'text-slate-400'} />}
                        {label}
                    </button>
                ))}
            </div>
            {showPicker && (
                <div className="absolute top-full right-0 mt-3 bg-white p-5 rounded-[28px] z-[60] shadow-2xl shadow-blue-900/10 border border-slate-200 animate-fade-in-up">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 text-center">Filtro Customizado</p>
                    <DatePicker selectsRange inline locale="pt-BR" dateFormat="dd/MM/yyyy" maxDate={new Date()}
                        startDate={customRange[0]} endDate={customRange[1]}
                        onChange={update => setCustomRange(update)} />
                    <div className="flex gap-2 mt-4">
                        <button onClick={() => setShowPicker(false)} className="flex-1 py-2.5 text-xs font-bold text-slate-500 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors">Cancelar</button>
                        <button
                            onClick={() => { if (customRange[0] && customRange[1]) { onDateChange(customRange[0], customRange[1]); setShowPicker(false); } }}
                            disabled={!customRange[0] || !customRange[1]}
                            className="flex-1 py-2.5 text-xs font-black text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-40 shadow-lg shadow-blue-600/20 transition-all"
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
    const [dateRange, setDateRange] = useState({ startDate: subDays(new Date(), 7), endDate: new Date() });
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

    useEffect(() => { fetchData(subDays(new Date(), 7), new Date()); }, [fetchData]);

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
            }, { timeout: 600000 });
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
        return <PageLoader message="Construindo Visão Geral" subMessage="Sincronizando dados em tempo real..." />;
    }

    if (error) {
        return (
            <div className="flex h-full items-center justify-center p-6">
                <div className="max-w-md w-full bg-white rounded-[32px] p-10 text-center shadow-2xl shadow-slate-200 border border-slate-100">
                    <div className="w-16 h-16 bg-rose-50 rounded-2xl flex items-center justify-center mx-auto mb-6 text-rose-500">
                        <AlertCircle size={32} />
                    </div>
                    <h3 className="text-xl font-black text-slate-800 mb-2">Opa, algo deu errado</h3>
                    <p className="text-slate-500 font-medium leading-relaxed mb-8">{error}</p>
                    <button onClick={() => window.location.reload()} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-black transition-all">
                        Tentar Novamente
                    </button>
                </div>
            </div>
        );
    }

    const hasChartData = data?.charts?.contatosPorDia && data?.charts?.atendimentosPorSituacao;

    return (
        <div className="min-h-full pb-10 p-4 lg:p-8">
            {/* Header Area */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-10 gap-6">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-200">
                            <TrendingUp size={22} className="text-white" />
                        </div>
                        <h1 className="text-3xl font-black text-slate-900 tracking-tight" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Dashboard</h1>
                    </div>
                    <p className="text-slate-500 font-medium text-sm flex items-center gap-2">
                        <Info size={14} className="text-blue-400" /> Analise o desempenho em tempo real e insights estratégicos.
                    </p>
                </div>
                <DateRangeFilter onDateChange={handleDateChange} />
            </div>

            {/* Spinner Global de atualização */}
            {isLoading && (
                <PageLoader fullScreen message="Sincronizando..." subMessage="Atualizando métricas em tempo real" />
            )}

            {data && hasChartData && (
                <div className="space-y-8 lg:space-y-12">
                    {/* Stat Cards Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-6">
                        <StatCard icon={<TrendingUp size={20} />} label={data.stats?.totalAtendimentos?.label} value={data.stats?.totalAtendimentos?.value} gradient="from-blue-600 to-indigo-600" delay={0.1} />
                        <StatCard icon={<CheckCircle size={20} />} label={data.stats?.totalConcluidos?.label} value={data.stats?.totalConcluidos?.value} gradient="from-emerald-500 to-teal-500" delay={0.15} />
                        <StatCard icon={<Percent size={20} />} label={data.stats?.taxaConversao?.label} value={data.stats?.taxaConversao?.value} gradient="from-amber-400 to-orange-500" delay={0.2} />
                        <StatCard icon={<Clock size={20} />} label={data.stats?.tempoMedioAtendimento?.label || "Tempo T. Médio"} value={data.stats?.tempoMedioAtendimento?.value} gradient="from-cyan-500 to-blue-500" delay={0.25} />
                        <StatCard icon={<Activity size={20} />} label={data.stats?.tempoMedioResposta?.label || "Resposta Média"} value={data.stats?.tempoMedioResposta?.value} gradient="from-pink-500 to-rose-500" delay={0.3} />
                        <StatCard icon={<Cpu size={20} />} label={data.stats?.consumoMedioTokens?.label} value={data.stats?.consumoMedioTokens?.value} gradient="from-violet-500 to-purple-600" delay={0.35} />
                    </div>

                    {/* Gráficos Principais */}
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                        {/* Line Chart */}
                        <div className="lg:col-span-3 bg-white rounded-[32px] p-6 sm:p-8 shadow-xl shadow-slate-100 border border-slate-100/50" style={{ animation: 'fade-in-up 0.6s ease backwards 0.4s' }}>
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-10">
                                <div className="flex items-center gap-3">
                                    <div className="p-2.5 bg-blue-50 rounded-2xl">
                                        <Activity size={18} className="text-blue-600" />
                                    </div>
                                    <div>
                                        <h3 className="text-slate-800 font-bold text-lg tracking-tight" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Atendimentos & Tokens</h3>
                                        <p className="text-slate-400 text-xs mt-0.5">Evolução temporal do volume de conversas</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4">
                                    <div className="flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                        <span className="text-[10px] font-black text-slate-500 uppercase">Volume</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                                        <span className="text-[10px] font-black text-slate-500 uppercase">Tokens</span>
                                    </div>
                                </div>
                            </div>

                            <div className="h-[280px] sm:h-[380px] -ml-4 sm:ml-0 overflow-visible">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={data.charts.contatosPorDia} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="totalGradient" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor={STATUS_COLORS['Total']} stopOpacity={0.1} />
                                                <stop offset="95%" stopColor={STATUS_COLORS['Total']} stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                        <XAxis
                                            dataKey="date"
                                            tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }}
                                            axisLine={false}
                                            tickLine={false}
                                            interval={window.innerWidth < 640 ? Math.floor(data.charts.contatosPorDia.length / 5) : 'preserveStartEnd'}
                                            tickFormatter={(val) => {
                                                try {
                                                    const [d, m] = val.split('/');
                                                    return `${d}/${m}`;
                                                } catch { return val; }
                                            }}
                                        />
                                        <YAxis yAxisId="left" tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }} axisLine={false} tickLine={false} />
                                        <YAxis yAxisId="right" orientation="right" tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }} axisLine={false} tickLine={false} tickFormatter={formatTokenAxis} />
                                        <Tooltip content={<CustomTooltip />} />
                                        <Line yAxisId="left" type="monotone" dataKey="total" stroke={STATUS_COLORS['Total']} strokeWidth={window.innerWidth < 640 ? 3 : 4} name="Total" dot={window.innerWidth < 640 ? false : { r: 4, fill: '#fff', strokeWidth: 3, stroke: STATUS_COLORS['Total'] }} activeDot={{ r: 6, strokeWidth: 0 }} />
                                        <Line yAxisId="right" type="monotone" dataKey="tokens" stroke={STATUS_COLORS['Tokens']} strokeWidth={1.5} name="Tokens" dot={false} strokeDasharray="5 5" opacity={0.6} />
                                        {Object.entries(STATUS_COLORS)
                                            .filter(([k]) => k !== 'Total' && k !== 'Tokens')
                                            .map(([status, color]) => (
                                                <Line key={status} yAxisId="left" type="monotone" dataKey={status} stroke={color} strokeWidth={1.5} name={status} dot={false} opacity={0.7} />
                                            ))}
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* Pie Chart Card */}
                        <div className="bg-white rounded-[32px] p-8 shadow-xl shadow-slate-100 border border-slate-100/50" style={{ animation: 'fade-in-up 0.6s ease backwards 0.5s' }}>
                            <div className="flex items-center gap-3 mb-8">
                                <div className="p-2.5 bg-violet-50 rounded-2xl">
                                    <PieIcon size={18} className="text-violet-600" />
                                </div>
                                <div>
                                    <h3 className="text-slate-800 font-bold text-lg tracking-tight" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Mix de Conversão</h3>
                                    <p className="text-slate-400 text-xs mt-0.5">Distribuição por situação</p>
                                </div>
                            </div>
                            <div className="h-[260px] relative">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie data={data.charts.atendimentosPorSituacao} dataKey="value" nameKey="name"
                                            cx="50%" cy="50%" innerRadius="55%" outerRadius="90%"
                                            paddingAngle={4} strokeWidth={0} stroke="#f9fafb">
                                            {data.charts.atendimentosPorSituacao.map((entry, i) => (
                                                <Cell key={i} fill={STATUS_COLORS[entry.name] || CHART_PALETTE[i % CHART_PALETTE.length]} className="focus:outline-none" />
                                            ))}
                                        </Pie>
                                        <Tooltip content={<CustomTooltip />} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="mt-8 flex flex-col gap-3">
                                {data.charts.atendimentosPorSituacao.map((entry, i) => (
                                    <div key={i} className="flex items-center justify-between group p-2 rounded-xl hover:bg-slate-50 transition-colors">
                                        <div className="flex items-center gap-3">
                                            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: STATUS_COLORS[entry.name] || CHART_PALETTE[i % CHART_PALETTE.length] }} />
                                            <span className="text-slate-500 font-semibold text-xs">{entry.name}</span>
                                        </div>
                                        <span className="text-slate-900 font-black text-sm tracking-tight">{entry.value}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                    {/* AI Analyzer Area */}
                    <div style={{ animation: 'fade-in-up 0.7s ease backwards 0.6s' }}>
                        <AIAnalyzer
                            onAnalyze={handleAIAnalysis}
                            isLoading={isAnalyzing}
                            analysis={analysisResult}
                            error={analysisError}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};

export default Dashboard;