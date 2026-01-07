import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
    LayoutDashboard,
    MessageSquareText, // Ícone para Atendimentos
    Bot,
    Settings,
    LogOut,
    History, // --- NOVO: Ícone para Follow-up ---
    Archive,
} from 'lucide-react';

// --- ALTERADO: Aceita a prop 'currentUserApiType' ---
const Sidebar = ({ currentUserApiType, isSuperUser }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const navigate = useNavigate();

    const handleLogout = () => {
        localStorage.removeItem('accessToken');
        navigate('/login');
    };

    // --- LÓGICA DE NAVEGAÇÃO ATUALIZADA ---
    // 1. Define os itens base
    const baseNavItems = [
        { icon: LayoutDashboard, name: 'Dashboard', path: '/dashboard' },
        { icon: MessageSquareText, name: 'Atendimentos', path: '/atendimentos' },
        { icon: Archive, name: 'Mensagens', path: '/mensagens' },
        { icon: Bot, name: 'Persona & Contexto', path: '/configs' },
        { icon: History, name: 'Follow-up', path: '/followup' },
    ];

    // 2. Cria a lista final de itens
    const navItems = isSuperUser ? [] : [...baseNavItems];

    return (
        <aside
            className={`relative h-screen bg-brand-blue-dark text-white p-4 flex flex-col transition-all duration-300 ease-in-out ${isExpanded ? 'w-64' : 'w-20'}`}
            onMouseEnter={() => setIsExpanded(true)}
            onMouseLeave={() => setIsExpanded(false)}
        >
            {/* Logo atualizado para Atend AI */}
            <div className="flex items-center mb-10" style={{ height: '40px' }}>
                <div className="bg-brand-blue-light/20 w-12 h-12 flex items-center justify-center rounded-lg flex-shrink-0">
                    <span className="font-bold text-2xl text-white">A</span>
                </div>
                <span className={`font-bold text-2xl whitespace-nowrap overflow-hidden transition-all duration-300 ${isExpanded ? 'w-auto opacity-100 ml-3' : 'w-0 opacity-0'} ml-[-0.5px]`}>
                    tend AI
                </span>
            </div>
            
            <nav className="flex-1 flex flex-col space-y-2">
                {/* O map agora usa a lista de navItems dinâmica */}
                {navItems.map(item => (
                    <NavLink
                        key={item.name}
                        to={item.path}
                        className={({ isActive }) =>
                            `flex items-center p-3 rounded-lg transition-colors duration-200 ${
                            isActive ? 'bg-brand-blue-light/30' : 'hover:bg-brand-blue-light/20'
                        }`
                        }
                    >
                        <item.icon size={24} className="flex-shrink-0" />
                        <span className={`ml-4 font-medium whitespace-nowrap overflow-hidden transition-all duration-200 ${isExpanded ? 'opacity-100 w-full' : 'opacity-0 w-0'}`}>
                            {item.name}
                        </span>
                    </NavLink>
                ))}
            </nav>

            <div className="border-t border-white/20 pt-4">
                 <button onClick={handleLogout} className="flex items-center p-3 rounded-lg w-full hover:bg-brand-blue-light/20 transition-colors duration-200">
                    <LogOut size={24} className="flex-shrink-0" />
                    <span className={`ml-4 font-medium whitespace-nowrap text-start overflow-hidden transition-all duration-200 ${isExpanded ? 'opacity-100 w-full' : 'opacity-0 w-0'}`}>
                        Sair
                    </span>
                </button>
            </div>
        </aside>
    );
};

export default Sidebar;
