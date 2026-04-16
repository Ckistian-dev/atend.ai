// src/components/Header.jsx

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CSSTransition, SwitchTransition } from 'react-transition-group';
import { Ticket, User as UserIcon, AlertCircle, Zap, Activity, UserCheck, UserX } from 'lucide-react';
import api from '../api/axiosConfig';

/* ─────────────────────────────────────────
   STYLES
   ───────────────────────────────────────── */
const HEADER_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=Inter:wght@400;500;600&display=swap');

  /* ── Root header ── */
  .hdr-root {
    position: relative;
    display: flex;
    align-items: center;
    min-height: 60px;
    padding: 0 1.5rem;
    background: #ffffff;
    box-shadow: 0 1px 0 rgba(196,197,215,0.3), 0 4px 16px rgba(11,28,48,0.04);
    z-index: 20;
    flex-shrink: 0;
  }

  .hdr-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    gap: 1rem;
  }

  /* ── Left cluster ── */
  .hdr-left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
  }

  /* ── Agent status pill ── */
  .hdr-agent-btn {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.35rem 0.85rem;
    border-radius: 999px;
    border: none;
    cursor: pointer;
    font-family: 'Inter', sans-serif;
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.01em;
    transition: transform 0.15s, box-shadow 0.15s, background 0.2s;
    flex-shrink: 0;
  }

  .hdr-agent-btn.running {
    background: linear-gradient(135deg, #dce1ff 0%, #e0ebff 100%);
    color: #0942b3;
    box-shadow: 0 2px 8px rgba(9,66,179,0.12);
  }

  .hdr-agent-btn.stopped {
    background: #eff4ff;
    color: #6b758a;
    box-shadow: none;
  }

  .hdr-agent-btn:hover {
    transform: scale(1.04);
    box-shadow: 0 4px 14px rgba(9,66,179,0.16);
  }

  .hdr-agent-pulse {
    position: relative;
    width: 7px; height: 7px;
    flex-shrink: 0;
  }
  .hdr-agent-pulse-ring {
    position: absolute; inset: 0;
    border-radius: 50%;
    background: #0942b3;
    opacity: 0.4;
    animation: agentPulse 1.4s ease-out infinite;
  }
  .hdr-agent-pulse-dot {
    position: absolute; inset: 1px;
    border-radius: 50%;
    background: #0942b3;
  }
  .hdr-agent-btn.stopped .hdr-agent-pulse-ring { display: none; }
  .hdr-agent-btn.stopped .hdr-agent-pulse-dot { background: #9ca3af; }

  @keyframes agentPulse {
    0%   { transform: scale(1); opacity: 0.4; }
    70%  { transform: scale(2.2); opacity: 0; }
    100% { opacity: 0; }
  }

  /* ── Activity ticker ── */
  .hdr-activity-wrap {
    position: relative;
    height: 32px;
    overflow: hidden;
    min-width: 0;
  }

  .hdr-activity {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    height: 32px;
    font-family: 'Inter', sans-serif;
    font-size: 0.8rem;
    color: #434655;
    padding: 0 0.6rem;
    border-radius: 8px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 320px;
  }

  .hdr-activity-icon { color: #0942b3; flex-shrink: 0; }
  .hdr-activity-label { color: #9ca3af; }
  .hdr-activity-value { font-weight: 600; color: #0b1c30; }

  /* Activity transition */
  .hdr-fade-enter { opacity: 0; transform: translateY(-60%); }
  .hdr-fade-enter-active { opacity: 1; transform: translateY(0); transition: opacity 380ms ease-out, transform 380ms cubic-bezier(0.22,1,0.36,1); }
  .hdr-fade-exit  { opacity: 1; transform: translateY(0); }
  .hdr-fade-exit-active { opacity: 0; transform: translateY(60%); transition: opacity 280ms ease-in, transform 280ms ease-in; }

  /* ── Right cluster ── */
  .hdr-right {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-shrink: 0;
  }

  /* ── Token chip ── */
  .hdr-token-chip {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.35rem 0.8rem;
    border-radius: 999px;
    background: #eff4ff;
    font-family: 'Inter', sans-serif;
    font-size: 0.8rem;
    color: #434655;
    cursor: default;
    flex-shrink: 0;
  }

  .hdr-token-chip .token-icon { color: #0942b3; }

  .hdr-token-value {
    font-family: 'Plus Jakarta Sans', sans-serif;
    font-size: 0.85rem;
    font-weight: 700;
    color: #0b1c30;
  }

  @keyframes tokenTick {
    0%   { transform: scale(1); }
    50%  { transform: scale(1.15); }
    100% { transform: scale(1); }
  }
  .token-tick { animation: tokenTick 0.3s ease-in-out; }

  /* ── Attendant button ── */
  .hdr-attendant-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.9rem;
    border-radius: 999px;
    border: none;
    cursor: pointer;
    font-family: 'Inter', sans-serif;
    font-size: 0.78rem;
    font-weight: 600;
    transition: transform 0.15s, box-shadow 0.15s, background 0.2s;
    flex-shrink: 0;
  }

  .hdr-attendant-btn.online {
    background: linear-gradient(135deg, #d1fae5 0%, #ecfdf5 100%);
    color: #065f46;
    box-shadow: 0 2px 8px rgba(16,185,129,0.14);
  }

  .hdr-attendant-btn.offline {
    background: #f1f5f9;
    color: #6b758a;
  }

  .hdr-attendant-btn:hover {
    transform: scale(1.04);
  }

  .hdr-attendant-btn.online:hover {
    box-shadow: 0 4px 14px rgba(16,185,129,0.22);
  }

  .hdr-status-dot {
    width: 7px; height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .hdr-attendant-btn.online .hdr-status-dot  { background: #10b981; }
  .hdr-attendant-btn.offline .hdr-status-dot { background: #94a3b8; }

  .hdr-email {
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── Skeleton ── */
  .hdr-skeleton {
    height: 32px;
    border-radius: 999px;
    width: 260px;
    background: linear-gradient(90deg, #eff4ff 25%, #e0ebff 50%, #eff4ff 75%);
    background-size: 200% 100%;
    animation: shimmer 1.4s ease-in-out infinite;
  }

  @keyframes shimmer {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  /* ── Error state ── */
  .hdr-error {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-family: 'Inter', sans-serif;
    font-size: 0.8rem;
    color: #ba1a1a;
  }

  /* ── Divider ── */
  .hdr-vdivider {
    width: 1px; height: 20px;
    background: rgba(196,197,215,0.45);
    flex-shrink: 0;
  }
`;

let headerStylesInjected = false;
function injectHeaderStyles() {
  if (headerStylesInjected) return;
  const style = document.createElement('style');
  style.textContent = HEADER_STYLES;
  document.head.appendChild(style);
  headerStylesInjected = true;
}

/* ─────────────────────────────────────────
   SUB-COMPONENTS
   ───────────────────────────────────────── */

const AgentStatus = ({ status, onToggle }) => {
  const isRunning = status === 'running';
  return (
    <button
      onClick={onToggle}
      className={`hdr-agent-btn ${isRunning ? 'running' : 'stopped'}`}
      title="Clique para ativar/pausar o agente de IA"
      id="header-agent-toggle-btn"
    >
      <span className="hdr-agent-pulse">
        <span className="hdr-agent-pulse-ring" />
        <span className="hdr-agent-pulse-dot" />
      </span>
      <Zap size={13} />
      <span className="hidden sm:inline">{isRunning ? 'Agente Ativo' : 'Agente Pausado'}</span>
    </button>
  );
};

const ActivityTicker = ({ activity }) => {
  if (!activity) {
    return (
      <div className="hdr-activity" title="Nenhuma atividade recente">
        <Activity size={14} className="hdr-activity-icon" />
        <span className="hdr-activity-label hidden sm:inline">Nenhuma atividade recente</span>
      </div>
    );
  }
  return (
    <div className="hdr-activity" title={`Última: ${activity.observacao}`}>
      <Activity size={14} className="hdr-activity-icon" />
      <span className="hdr-activity-label hidden sm:inline">{activity.whatsapp}:</span>
      <span className="hdr-activity-value hidden sm:inline">{activity.situacao}</span>
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
const Header = () => {
  injectHeaderStyles();

  const [user, setUser] = useState(null);
  const [agentStatus, setAgentStatus] = useState(null);
  const [latestActivity, setLatestActivity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

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
    if (loading) return <div className="hdr-skeleton" />;
    if (error) return (
      <div className="hdr-error">
        <AlertCircle size={16} />
        <span>Erro ao carregar dados.</span>
      </div>
    );
    if (user?.is_superuser) return null;

    return (
      <div className="hdr-inner">
        {/* Left */}
        <div className="hdr-left">
          {agentStatus && (
            <AgentStatus status={agentStatus} onToggle={handleToggleAgent} />
          )}
          <div className="hdr-vdivider" />
          <SwitchTransition mode="out-in">
            <CSSTransition
              key={latestActivity?.id || 'no-activity'}
              timeout={380}
              classNames="hdr-fade"
            >
              <div className="hdr-activity-wrap">
                <ActivityTicker activity={latestActivity} />
              </div>
            </CSSTransition>
          </SwitchTransition>
        </div>

        {/* Right */}
        <div className="hdr-right">
          {/* Token chip */}
          <div className="hdr-token-chip" title="Seus tokens restantes">
            <Ticket size={15} className="token-icon" />
            <span className="hdr-token-value">
              {user?.tokens !== undefined && user?.tokens !== null
                ? <CountUp end={user.tokens} />
                : '—'}
            </span>
            <span className="hidden sm:inline" style={{ fontSize: '0.75rem', color: '#6b758a' }}>tokens</span>
          </div>

          <div className="hdr-vdivider" />

          {/* Attendant status */}
          {user ? (
            <button
              onClick={handleToggleAttendant}
              id="header-attendant-toggle-btn"
              className={`hdr-attendant-btn ${user.atendente_online ? 'online' : 'offline'}`}
              title={`Você está ${user.atendente_online ? 'Online' : 'Offline'}. Clique para alterar.`}
            >
              <span className="hdr-status-dot" />
              {user.atendente_online ? <UserCheck size={14} /> : <UserX size={14} />}
              <span className="hdr-email hidden sm:inline">{user.email}</span>
            </button>
          ) : (
            <div className="hdr-token-chip">
              <UserIcon size={15} />
              <span>...</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <header className="hdr-root">
      {renderContent()}
    </header>
  );
};

export default Header;