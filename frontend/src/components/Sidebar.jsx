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
} from 'lucide-react';

const Sidebar = ({ currentUserApiType, isSuperUser }) => {
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
        { icon: Bot, name: 'Persona & Contexto', path: '/configs' },
        { icon: Send, name: 'Disparos', path: '/disparos' },
        { icon: History, name: 'Follow-up', path: '/followup' },
    ];

    const navItems = isSuperUser ? [] : [...baseNavItems];

    return (
        <>
            <aside
                className={`relative h-screen bg-brand-background border-r border-slate-200 flex flex-col transition-all duration-300 ease-in-out shadow-sm z-20 ${isExpanded ? 'w-64' : 'w-20'
                    } p-4`}
                onMouseEnter={() => setIsExpanded(true)}
                onMouseLeave={() => setIsExpanded(false)}
            >
                {/* --- LOGO ATUALIZADO --- */}
                <div className="flex items-center mb-8 h-14 relative group cursor-pointer">

                    {/* Container do Ícone ("A") */}
                    {/* Adicionado z-10 para garantir que o 'A' fique SEMPRE na frente do texto que desliza */}
                    <div className="relative flex items-center justify-center flex-shrink-0 animate-float z-10 bg-white"> {/* Opcional: bg-white se o fundo for branco */}
                        <img
                            src="https://i.ibb.co/2YhckHCs/Gemini-Generated-Image-w69kl3w69kl3w69k.png"
                            alt="Logo A"
                            className="w-10 h-10 ml-1"
                        />
                    </div>

                    {/* Texto ("tendAI") */}
                    {/* Mantido absolute para deslizar sem afetar o layout externo */}
                    <div
                        className={`absolute flex items-center h-full transition-all duration-300 ease-in-out ${isExpanded
                                ? 'opacity-100 translate-x-12' // Posição final (ajuste o 12 conforme necessário)
                                : 'opacity-0 translate-x-4 pointer-events-none' // Começa escondido mais à esquerda
                            }`}
                    >
                        {/* CORREÇÃO: Tag mudada de <image> para <img> */}
                        <img
                            src="https://i.ibb.co/Jwnx9K77/Parte-da-Logo.png"
                            alt="Texto tendAI"
                            className="h-8 w-auto object-contain mt-2"
                        />
                    </div>

                </div>

                {/* Parte 2: Navegação Principal */}
                <nav className="flex-1 flex flex-col space-y-1 overflow-y-auto overflow-x-hidden scrollbar-hide">
                    {navItems.map((item) => (
                        <NavLink
                            key={item.name}
                            to={item.path}
                            className={({ isActive }) =>
                                `flex items-center px-3 py-2.5 rounded-md transition-all duration-200 ease-in-out group ${isActive
                                    ? 'bg-brand-surface text-brand-primary font-medium shadow-sm'
                                    : 'text-brand-foreground hover:bg-brand-surface/60 hover:text-brand-primary'
                                }`
                            }
                            title={!isExpanded ? item.name : undefined}
                        >
                            <item.icon size={20} className="flex-shrink-0 transition-transform duration-200 ease-in-out group-hover:scale-110" />
                            <span
                                className={`ml-3 text-sm whitespace-nowrap overflow-hidden transition-all duration-200 ease-in-out ${isExpanded ? 'w-auto opacity-100' : 'w-0 opacity-0 ml-0'
                                    }`}
                            >
                                {item.name}
                            </span>
                        </NavLink>
                    ))}
                </nav>

                {/* Parte 3: Rodapé e Logout */}
                <div className="mt-auto border-t border-slate-200 pt-4 pb-2">
                    <button
                        type="button"
                        onClick={handleLogout}
                        className="flex items-center w-full px-3 py-2.5 rounded-md text-brand-foreground transition-all duration-200 ease-in-out hover:bg-brand-surface/60 hover:text-brand-primary group"
                    >
                        <LogOut size={20} className="flex-shrink-0 transition-transform duration-200 ease-in-out group-hover:-translate-x-1" />
                        <span
                            className={`ml-3 text-sm font-medium whitespace-nowrap text-left overflow-hidden transition-all duration-200 ease-in-out ${isExpanded ? 'w-auto opacity-100' : 'w-0 opacity-0 ml-0'
                                }`}
                        >
                            Sair
                        </span>
                    </button>
                </div>

            </aside>
        </>
    );
};

export default Sidebar;