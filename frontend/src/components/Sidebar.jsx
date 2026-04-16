import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  MessageSquareText,
  Bot,
  LogOut,
  History,
  Archive,
  Send,
  Zap,
  ChevronRight,
} from 'lucide-react';

/* ─────────────────────────────────────────
   STYLES — injetadas uma única vez no <head>
   ───────────────────────────────────────── */
const SIDEBAR_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Inter:wght@400;500;600&display=swap');

  /* Sidebar root */
  .sb-root {
    position: relative;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    z-index: 30;
    transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    background: linear-gradient(175deg, #1d4ed8 0%, #0942b3 55%, #1d4ed8 100%);
    padding: 1.25rem 0.75rem;
    flex-shrink: 0;
  }

  .sb-root.collapsed { width: 72px; }
  .sb-root.expanded  { width: 228px; }

  /* Background orbs */
  .sb-orb-1 {
    pointer-events: none;
    position: absolute;
    width: 220px; height: 220px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(255,255,255,0.07) 0%, transparent 70%);
    top: -70px; right: -60px;
  }
  .sb-orb-2 {
    pointer-events: none;
    position: absolute;
    width: 180px; height: 180px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(29,78,216,0.35) 0%, transparent 70%);
    bottom: 60px; left: -50px;
  }

  /* ── BRAND ── */
  .sb-brand {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.25rem 0.4rem;
    margin-bottom: 2rem;
    flex-shrink: 0;
    overflow: hidden;
    min-height: 44px;
  }

  .sb-brand-icon {
    width: 38px; height: 38px;
    flex-shrink: 0;
    background: rgba(255,255,255,0.12);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255,255,255,0.22);
    border-radius: 11px;
    display: flex; align-items: center; justify-content: center;
    transition: transform 0.2s;
  }
  .sb-root.expanded .sb-brand-icon:hover { transform: rotate(-8deg) scale(1.08); }

  .sb-brand-name {
    font-family: 'Plus Jakarta Sans', sans-serif;
    font-size: 1.15rem;
    font-weight: 800;
    letter-spacing: -0.03em;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    opacity: 0;
    width: 0;
    transition: opacity 0.25s 0.05s, width 0.3s;
  }
  .sb-brand-name span { color: rgba(255,255,255,0.5); font-weight: 500; }
  .sb-root.expanded .sb-brand-name { opacity: 1; width: 120px; }

  /* ── SECTION LABEL ── */
  .sb-section-label {
    font-family: 'Inter', sans-serif;
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.35);
    padding: 0 0.5rem;
    margin-bottom: 0.35rem;
    white-space: nowrap;
    overflow: hidden;
    opacity: 0;
    height: 0;
    transition: opacity 0.2s, height 0.2s;
  }
  .sb-root.expanded .sb-section-label { opacity: 1; height: 1.25rem; }

  /* ── NAV ── */
  .sb-nav {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: none;
  }
  .sb-nav::-webkit-scrollbar { display: none; }

  /* Nav item base */
  .sb-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.7rem 0.8rem;
    border-radius: 0.875rem;
    cursor: pointer;
    text-decoration: none;
    color: rgba(255,255,255,0.6);
    position: relative;
    overflow: hidden;
    transition: background 0.18s, color 0.18s;
    white-space: nowrap;
  }

  .sb-item:hover {
    background: rgba(255,255,255,0.09);
    color: rgba(255,255,255,0.95);
  }

  /* Active state — glassmorphism card */
  .sb-item.active {
    background: rgba(255,255,255,0.15);
    backdrop-filter: blur(12px);
    color: #ffffff;
    box-shadow: 0 4px 16px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.2);
  }

  /* Active left accent bar */
  .sb-item.active::before {
    content: '';
    position: absolute;
    left: 0; top: 20%; height: 60%;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: #ffffff;
  }

  /* Icon wrapper */
  .sb-item-icon {
    flex-shrink: 0;
    width: 22px; height: 22px;
    display: flex; align-items: center; justify-content: center;
    transition: transform 0.2s;
  }
  .sb-item:hover .sb-item-icon { transform: scale(1.1); }
  .sb-item.active .sb-item-icon { transform: scale(1.05); }

  /* Label text */
  .sb-item-label {
    font-family: 'Inter', sans-serif;
    font-size: 0.82rem;
    font-weight: 500;
    opacity: 0;
    width: 0;
    overflow: hidden;
    transition: opacity 0.2s 0.05s, width 0.25s;
  }
  .sb-item.active .sb-item-label { font-weight: 600; }
  .sb-root.expanded .sb-item-label { opacity: 1; width: 130px; }

  /* Chevron hint on hover (expanded only) */
  .sb-item-chevron {
    margin-left: auto;
    opacity: 0;
    width: 0;
    overflow: hidden;
    transition: opacity 0.15s, width 0.2s;
    color: rgba(255,255,255,0.4);
    flex-shrink: 0;
  }
  .sb-root.expanded .sb-item:hover .sb-item-chevron { opacity: 1; width: 14px; }

  /* Tooltip (collapsed) */
  .sb-tooltip {
    pointer-events: none;
    position: absolute;
    left: calc(100% + 12px);
    top: 50%;
    transform: translateY(-50%);
    background: #0b1c30;
    color: #fff;
    font-family: 'Inter', sans-serif;
    font-size: 0.75rem;
    font-weight: 500;
    padding: 0.35rem 0.75rem;
    border-radius: 8px;
    white-space: nowrap;
    opacity: 0;
    transition: opacity 0.15s 0.1s;
    box-shadow: 0 4px 12px rgba(0,0,0,0.25);
    z-index: 100;
  }
  .sb-root.collapsed .sb-item:hover .sb-tooltip { opacity: 1; }

  /* ── DIVIDER ── */
  .sb-divider {
    height: 1px;
    background: rgba(255,255,255,0.1);
    margin: 0.75rem 0.4rem;
    border-radius: 1px;
  }

  /* ── LOGOUT ── */
  .sb-logout {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.7rem 0.6rem;
    border-radius: 0.875rem;
    cursor: pointer;
    border: none;
    background: none;
    width: 100%;
    color: rgba(255,255,255,0.45);
    position: relative;
    overflow: hidden;
    transition: background 0.18s, color 0.18s;
    white-space: nowrap;
  }

  .sb-logout:hover {
    background: rgba(186,26,26,0.18);
    color: #fca5a5;
  }

  .sb-logout-icon {
    flex-shrink: 0;
    width: 22px; height: 22px;
    display: flex; align-items: center; justify-content: center;
    transition: transform 0.2s;
  }
  .sb-logout:hover .sb-logout-icon { transform: translateX(-3px); }

  .sb-logout-label {
    font-family: 'Inter', sans-serif;
    font-size: 0.82rem;
    font-weight: 500;
    opacity: 0;
    width: 0;
    overflow: hidden;
    transition: opacity 0.2s 0.05s, width 0.25s;
  }
  .sb-root.expanded .sb-logout-label { opacity: 1; width: 80px; }

  .sb-logout .sb-tooltip { left: calc(100% + 12px); }
`;

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  const style = document.createElement('style');
  style.textContent = SIDEBAR_STYLES;
  document.head.appendChild(style);
  stylesInjected = true;
}

/* ─────────────────────────────────────────
   COMPONENT
   ───────────────────────────────────────── */
const Sidebar = ({ currentUserApiType, isSuperUser }) => {
  injectStyles();

  const [isExpanded, setIsExpanded] = useState(false);
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem('accessToken');
    navigate('/login');
  };

  const baseNavItems = [
    { icon: LayoutDashboard, name: 'Dashboard', path: '/dashboard' },
    { icon: MessageSquareText, name: 'Atendimentos', path: '/atendimentos' },
    { icon: Archive, name: 'Mensagens', path: '/mensagens' },
    { icon: Bot, name: 'Persona & IA', path: '/configs' },
    { icon: Send, name: 'Disparos', path: '/disparos' },
    { icon: History, name: 'Follow-up', path: '/followup' },
  ];

  const navItems = isSuperUser ? [] : [...baseNavItems];

  return (
    <aside
      className={`sb-root ${isExpanded ? 'expanded' : 'collapsed'}`}
      onMouseEnter={() => setIsExpanded(true)}
      onMouseLeave={() => setIsExpanded(false)}
    >
      {/* Background orbs */}
      <div className="sb-orb-1" />
      <div className="sb-orb-2" />

      {/* ── Brand ── */}
      <div className="sb-brand">
        <div className="sb-brand-icon">
          <Zap size={18} color="#fff" />
        </div>
        <span className="sb-brand-name">
          Atend<span>AI</span>
        </span>
      </div>

      {/* ── Navigation ── */}
      <nav className="sb-nav">
        <div className="sb-section-label">Menu</div>

        {navItems.map((item) => (
          <NavLink
            key={item.name}
            to={item.path}
            title={undefined}
            className={({ isActive }) =>
              `sb-item${isActive ? ' active' : ''}`
            }
          >
            {({ isActive }) => (
              <>
                <span className="sb-item-icon">
                  <item.icon size={19} strokeWidth={isActive ? 2.2 : 1.8} />
                </span>
                <span className="sb-item-label">{item.name}</span>
                <ChevronRight size={13} className="sb-item-chevron" />
                {/* Tooltip for collapsed state */}
                <span className="sb-tooltip">{item.name}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* ── Footer ── */}
      <div>
        <div className="sb-divider" />
        <button
          type="button"
          onClick={handleLogout}
          className="sb-logout"
          id="sidebar-logout-btn"
        >
          <span className="sb-logout-icon">
            <LogOut size={18} strokeWidth={1.8} />
          </span>
          <span className="sb-logout-label">Sair</span>
          <span className="sb-tooltip">Sair</span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;