import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CSSTransition, SwitchTransition } from 'react-transition-group';
import { Ticket, User as UserIcon, AlertCircle, Zap, Activity, UserCheck, UserX, Menu } from 'lucide-react';
import api from '../api/axiosConfig';

/* ─────────────────────────────────────────
   SUB-COMPONENTS
   ───────────────────────────────────────── */

const AgentStatus = ({ status, onToggle }) => {
  const isRunning = status === 'running';
  return (
    <button
      onClick={onToggle}
      className={`
        flex items-center gap-2 px-3 py-1.5 rounded-full font-semibold text-[11px] uppercase tracking-wider transition-all duration-200 shadow-sm
        ${isRunning
          ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
          : 'bg-slate-50 text-slate-500 ring-1 ring-slate-200'}
        hover:scale-105 active:scale-95
      `}
      title="Clique para ativar/pausar o agente de IA"
      id="header-agent-toggle-btn"
    >
      <div className="relative w-2 h-2">
        {isRunning && (
          <div className="absolute inset-0 rounded-full bg-blue-500 animate-ping opacity-75" />
        )}
        <div className={`relative w-2 h-2 rounded-full ${isRunning ? 'bg-blue-600' : 'bg-slate-400'}`} />
      </div>
      <Zap size={12} className={isRunning ? 'fill-blue-600' : ''} />
      <span className="hidden sm:inline">{isRunning ? 'Agente Ativo' : 'Agente Pausado'}</span>
    </button>
  );
};

const ActivityTicker = ({ activity }) => {
  if (!activity) {
    return (
      <div className="flex items-center gap-2 text-slate-400 text-xs font-medium" title="Nenhuma atividade recente">
        <Activity size={14} className="text-blue-600" />
        <span className="hidden md:inline">Nenhuma atividade recente</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-slate-600 text-xs font-medium w-full bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100" title={`Última: ${activity.observacao}`}>
      <Activity size={14} className="text-blue-600 shrink-0" />
      <span className="truncate">
        <span className="text-slate-400 font-normal mr-1">{activity.whatsapp}:</span>
        {activity.situacao}
      </span>
    </div>
  );
};

/* CountUp — animação de número */
const CountUp = ({ end, duration = 1200 }) => {
  const [count, setCount] = useState(end);
  const prevEnd = useRef(end);
  const rafRef = useRef();

  useEffect(() => {
    const startVal = prevEnd.current;
    if (startVal === end) return;
    prevEnd.current = end;

    let startTime = null;
    const animate = (ts) => {
      if (!startTime) startTime = ts;
      const pct = Math.min((ts - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - pct, 4);
      setCount(Math.floor(startVal + (end - startVal) * ease));
      if (pct < 1) rafRef.current = requestAnimationFrame(animate);
      else setCount(end);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [end, duration]);

  return <>{new Intl.NumberFormat('pt-BR').format(count)}</>;
};

/* ─────────────────────────────────────────
   MAIN COMPONENT
   ───────────────────────────────────────── */
const Header = ({ setIsMobileMenuOpen }) => {
  const [user, setUser] = useState(null);
  const [agentStatus, setAgentStatus] = useState(null);
  const [latestActivity, setLatestActivity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [isHeaderExpanded, setIsHeaderExpanded] = useState(false);
  const headerRef = useRef(null);

  const fetchData = useCallback(async () => {
    try {
      const [userRes, agentRes, dashboardRes] = await Promise.all([
        api.get('/auth/me'),
        api.get('/agent/status'),
        api.get('/dashboard/'),
      ]);

      setUser(userRes.data);
      setAgentStatus(agentRes.data.status);

      const newActivity = dashboardRes.data.recentActivity?.[0];
      setLatestActivity((cur) => {
        if (newActivity && JSON.stringify(newActivity) !== JSON.stringify(cur)) return newActivity;
        return cur;
      });
    } catch (err) {
      console.error('Erro ao buscar dados do header:', err);
      setError(true);
    }
  }, []);

  useEffect(() => {
    const init = async () => { setLoading(true); await fetchData(); setLoading(false); };
    init();
  }, [fetchData]);

  useEffect(() => {
    let mounted = true;
    let tid;
    const poll = async () => {
      if (!document.hidden) await fetchData();
      if (mounted) tid = setTimeout(poll, 5000);
    };
    poll();
    const onVis = () => { if (!document.hidden && mounted) { clearTimeout(tid); poll(); } };
    document.addEventListener('visibilitychange', onVis);
    return () => { mounted = false; clearTimeout(tid); document.removeEventListener('visibilitychange', onVis); };
  }, [fetchData]);

  /* Fechar ao clicar fora */
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (headerRef.current && !headerRef.current.contains(event.target)) {
        setIsHeaderExpanded(false);
      }
    };
    if (isHeaderExpanded) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isHeaderExpanded]);

  const handleToggleAgent = async () => {
    const isRunning = agentStatus === 'running';
    setAgentStatus(isRunning ? 'stopped' : 'running');
    try {
      await api.post(isRunning ? '/agent/stop' : '/agent/start');
    } catch {
      setAgentStatus(isRunning ? 'running' : 'stopped');
      setError(true);
    }
  };

  const handleToggleAttendant = async () => {
    if (!user) return;
    const orig = user.atendente_online;
    setUser((u) => ({ ...u, atendente_online: !orig }));
    try {
      await api.put('/users/me', { atendente_online: !orig });
    } catch {
      setUser((u) => ({ ...u, atendente_online: orig }));
      setError(true);
    }
  };

  /* ── Render ── */
  const renderContent = () => {
    if (loading) return (
      <div className="w-full h-8 bg-slate-100 rounded-full animate-pulse" />
    );

    if (error) return (
      <div className="flex items-center gap-2 text-red-500 text-xs font-semibold">
        <AlertCircle size={16} />
        <span>Erro de sincronização</span>
      </div>
    );

    if (user?.is_superuser) return null;

    return (
      <div className="flex flex-col w-full">
        <div className="flex items-center justify-between w-full h-16 gap-1.5 sm:gap-4">
          {/* Left Side: Mobile Menu Toggle & Agent Status & Ticker */}
          <div className="flex items-center gap-1.5 sm:gap-4 flex-1 min-w-0">
            {/* Hamburger Menu Toggle (Mobile Only) */}
            <button
              className="lg:hidden p-2 -ml-1 text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
              onClick={() => setIsMobileMenuOpen(true)}
            >
              <Menu size={20} />
            </button>

            {agentStatus && (
              <div className="shrink-0">
                <AgentStatus status={agentStatus} onToggle={handleToggleAgent} />
              </div>
            )}

            <div className="hidden md:block w-px h-5 bg-slate-200" />

            <div className="hidden sm:block min-w-0">
              <SwitchTransition mode="out-in">
                <CSSTransition
                  key={latestActivity?.id || 'no-activity'}
                  timeout={380}
                  classNames={{
                    enter: 'opacity-0 -translate-y-2',
                    enterActive: 'opacity-100 translate-y-0 transition-all duration-300',
                    exit: 'opacity-100 translate-y-0',
                    exitActive: 'opacity-0 translate-y-2 transition-all duration-200'
                  }}
                >
                  <div className="min-w-0">
                    <ActivityTicker activity={latestActivity} />
                  </div>
                </CSSTransition>
              </SwitchTransition>
            </div>

            {/* Expansion Toggle Button (Mobile Only) */}
            <button
              className="sm:hidden p-2 text-slate-400 hover:text-blue-600 transition-all"
              onClick={() => setIsHeaderExpanded(!isHeaderExpanded)}
            >
              <Activity size={16} className={isHeaderExpanded ? 'text-blue-600' : ''} />
            </button>
          </div>

          {/* Right Side: Tokens & User Status */}
          <div className="flex items-center gap-1.5 sm:gap-4 shrink-0">
            {/* Token chip */}
            <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 bg-blue-50/50 rounded-full ring-1 ring-blue-100 transition-all hover:bg-blue-50" title="Tokens restantes">
              <Ticket size={14} className="text-blue-600" />
              <span className="text-[13px] font-bold text-slate-900">
                {user?.tokens !== undefined && user?.tokens !== null
                  ? <CountUp end={user.tokens} />
                  : '—'}
              </span>
              <span className="hidden lg:inline text-[10px] uppercase font-bold text-slate-400 tracking-wider">tokens</span>
            </div>

            <div className="hidden md:block w-px h-5 bg-slate-200" />

            {/* Attendant status */}
            {user ? (
              <button
                onClick={handleToggleAttendant}
                id="header-attendant-toggle-btn"
                className={`
                  flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-full font-bold transition-all duration-200
                  ${user.atendente_online
                    ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 shadow-sm shadow-emerald-100'
                    : 'bg-slate-50 text-slate-500 ring-1 ring-slate-200'}
                  hover:scale-105 active:scale-95
                `}
                title={`Você está ${user.atendente_online ? 'Online' : 'Offline'}. Clique para alterar.`}
              >
                <div className={`w-1.5 h-1.5 rounded-full ${user.atendente_online ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                <div className="shrink-0">
                  {user.atendente_online ? <UserCheck size={14} /> : <UserX size={14} />}
                </div>
                <span className="text-xs max-w-[120px] truncate hidden md:inline">{user.email}</span>
              </button>
            ) : (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-full ring-1 ring-slate-100">
                <UserIcon size={14} className="text-slate-400" />
                <div className="w-8 h-2 bg-slate-200 rounded-full animate-pulse" />
              </div>
            )}
          </div>
        </div>

        {/* Expansion Row (Mobile Only) */}
        {isHeaderExpanded && (
          <div className="sm:hidden flex items-center justify-between py-3 border-t border-slate-50 animate-fade-in-up">
            <div className="flex-1 min-w-0 pr-4">
              <ActivityTicker activity={latestActivity} />
            </div>
            <div className="shrink-0 text-[9px] font-bold text-blue-500 uppercase tracking-tighter">
              ULTIMA ATIVIDADE
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <header ref={headerRef} className={`sticky top-0 z-40 bg-white border-b border-slate-200 shadow-sm shadow-slate-100/50 transition-all duration-300 px-2 sm:px-4 ${isHeaderExpanded ? 'h-auto' : 'h-16'}`}>
      {renderContent()}
    </header>
  );
};

export default Header;