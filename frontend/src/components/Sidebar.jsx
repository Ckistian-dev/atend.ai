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
  X
} from 'lucide-react';

/* ─────────────────────────────────────────
   COMPONENT
   ───────────────────────────────────────── */
const Sidebar = ({ isSuperUser, isMobileMenuOpen, setIsMobileMenuOpen }) => {
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
      className={`
        fixed inset-y-0 left-0 z-50 flex flex-col bg-gradient-to-b from-[#1d4ed8] via-[#0942b3] to-[#1d4ed8] border-r border-white/10 transition-all duration-300 ease-in-out
        lg:static lg:translate-x-0
        ${isMobileMenuOpen ? 'translate-x-0 w-64' : '-translate-x-full lg:translate-x-0'}
        ${isExpanded ? 'lg:w-[228px]' : 'lg:w-[76px]'}
      `}
      onMouseEnter={() => setIsExpanded(true)}
      onMouseLeave={() => setIsExpanded(false)}
    >
      {/* Background orbs */}
      <div className="absolute top-[-70px] right-[-60px] w-56 h-56 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.07)_0%,transparent_70%)] pointer-events-none" />
      <div className="absolute bottom-[60px] left-[-50px] w-44 h-44 rounded-full bg-[radial-gradient(circle,rgba(29,78,216,0.35)_0%,transparent_70%)] pointer-events-none" />

      {/* ── Brand ── */}
      <div className="flex items-center gap-3 p-4 lg:p-4 mb-6 mt-2 relative min-h-[64px] overflow-hidden">
        <div className="bg-white/15 backdrop-blur-md border border-white/25 rounded-xl w-10 h-10 flex items-center justify-center shrink-0 shadow-lg shadow-black/10">
          <Zap size={20} className="text-white fill-white" />
        </div>
        <span className={`
          font-bold text-xl text-white tracking-tight transition-all duration-300 overflow-hidden
          ${isExpanded || isMobileMenuOpen ? 'opacity-100 max-w-[150px]' : 'opacity-0 max-w-0'}
        `}>
          Atend<span className="text-white/50 font-medium">AI</span>
        </span>

        {/* Mobile Close Button */}
        <button
          className="lg:hidden ml-auto text-white/60 hover:text-white"
          onClick={() => setIsMobileMenuOpen(false)}
        >
          <X size={20} />
        </button>
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 px-3 space-y-1.5 overflow-y-auto no-scrollbar relative overflow-x-hidden">
        <div className={`
          text-[10px] font-bold text-white/30 uppercase tracking-[0.1em] px-3 mb-2 transition-opacity duration-200
          ${isExpanded || isMobileMenuOpen ? 'opacity-100' : 'opacity-0 h-0 p-0 overflow-hidden'}
        `}>
          Menu
        </div>

        {navItems.map((item) => (
          <NavLink
            key={item.name}
            to={item.path}
            className={({ isActive }) => `
              flex items-center gap-3 px-4 py-3 rounded-[14px] transition-all duration-200 group relative
              ${isActive
                ? 'bg-white/20 text-white shadow-xl shadow-black/5 ring-1 ring-white/20 backdrop-blur-md'
                : 'text-white/60 hover:bg-white/10 hover:text-white'}
            `}
            onClick={() => setIsMobileMenuOpen(false)}
          >
            {({ isActive }) => (
              <>
                <div className={`shrink-0 transition-transform duration-300 ${isActive ? 'scale-105' : 'group-hover:scale-110'}`}>
                  <item.icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                </div>
                <span className={`
                  text-[13.5px] font-semibold transition-all duration-300 overflow-hidden whitespace-nowrap
                  ${isExpanded || isMobileMenuOpen ? 'opacity-100 w-auto ml-1' : 'opacity-0 w-0'}
                `}>
                  {item.name}
                </span>

                {/* Active Indicator Bar */}
                {isActive && (
                  <div className="absolute left-0 top-1/4 bottom-1/4 w-1 bg-white rounded-r-full shadow-[2px_0_10px_white]" />
                )}

                {/* Collapsed Tooltip */}
                {!isExpanded && !isMobileMenuOpen && (
                  <div className="absolute left-[calc(100%+14px)] top-1/2 -translate-y-1/2 bg-slate-900 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity shadow-xl z-[100] whitespace-nowrap">
                    {item.name}
                  </div>
                )}

                {/* Chevron: only when expanded */}
                {(isExpanded || isMobileMenuOpen) && (
                  <ChevronRight size={14} className="ml-auto text-white/30 group-hover:text-white/60 transition-colors" />
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* ── Footer ── */}
      <div className="p-3">
        <div className="h-px bg-white/10 mx-2 mb-4" />
        <button
          type="button"
          onClick={handleLogout}
          className="flex items-center gap-3 w-full px-3 py-3 rounded-[14px] text-white/40 hover:bg-red-500/20 hover:text-red-200 transition-all group relative"
          id="sidebar-logout-btn"
        >
          <div className="shrink-0 transition-transform duration-300 group-hover:-translate-x-0.5">
            <LogOut size={20} strokeWidth={2} />
          </div>
          <span className={`
            text-[13.5px] font-semibold transition-all duration-300 overflow-hidden
            ${isExpanded || isMobileMenuOpen ? 'opacity-100 w-auto ml-1' : 'opacity-0 w-0'}
          `}>
            Sair
          </span>

          {/* Collapsed Tooltip */}
          {!isExpanded && !isMobileMenuOpen && (
            <div className="absolute left-[calc(100%+14px)] top-1/2 -translate-y-1/2 bg-slate-900 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity shadow-xl z-[100] whitespace-nowrap">
              Sair
            </div>
          )}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;