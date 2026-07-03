import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import Header from './Header.jsx'; // Você precisará criar este arquivo
import api from '../api/axiosConfig.js'; // Verifique se o caminho está correto
import Unauthorized from '../pages/Unauthorized.jsx';

const MainLayout = () => {
    const [currentUserApiType, setCurrentUserApiType] = useState(null);
    const [isSuperUser, setIsSuperUser] = useState(false);
    const [userRole, setUserRole] = useState("user");
    const [userPermissions, setUserPermissions] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        // Busca os dados do usuário ao carregar o layout
        const fetchUserData = async () => {
            try {
                // Usamos a rota /auth/me para pegar os dados do usuário logado
                const response = await api.get('/auth/me');
                // Armazenamos o tipo de API no estado
                setCurrentUserApiType(response.data.api_type);
                setIsSuperUser(response.data.is_superuser);
                setUserRole(response.data.role || "user");
                setUserPermissions(response.data.permissions || null);
            } catch (error) {
                console.error("Erro ao buscar dados do usuário:", error);
                // Se falhar (ex: token expirado), desloga o usuário
                localStorage.removeItem('accessToken');
                navigate('/login');
            } finally {
                setIsLoading(false);
            }
        };

        fetchUserData();
    }, [navigate]); // Roda apenas uma vez quando o layout é montado

    const currentPath = location.pathname.replace(/^\//, '');

    const hasPermission = (path) => {
        if (isSuperUser) return true;
        
        if (!path || path === '') return true;

        // Apenas superusuário master acessa /admin
        if (path === 'admin') return false;

        // Apenas administrador da empresa e superusuário acessam /permissoes
        if (path === 'permissoes') {
            return userRole === 'admin';
        }

        // Se for admin da empresa, tem acesso a todas as outras rotas comuns
        if (userRole === 'admin') return true;

        // Mapeamento de rotas para chaves de permissão
        const routePermissionMap = {
            'dashboard': 'dashboard',
            'atendimentos': 'atendimentos',
            'mensagens': 'mensagens',
            'configs': 'configs',
            'disparos': 'disparos',
            'followup': 'followup'
        };

        const permissionKey = routePermissionMap[path];
        if (!permissionKey) return true; // Rotas desconhecidas ou não mapeadas são liberadas

        if (!userPermissions) return true; // Se não houver configurações de permissão, libera tudo por padrão
        return userPermissions[permissionKey] !== false; // Bloqueia apenas se estiver explicitamente definido como false
    };

    // Redirecionamento automático com base em permissões
    useEffect(() => {
        if (!isLoading) {
            // Se for o superusuário master e tentar acessar a raiz '/' ou '/dashboard', redireciona para '/admin'
            if (isSuperUser) {
                if (location.pathname === '/' || location.pathname === '/dashboard') {
                    navigate('/admin', { replace: true });
                }
                return;
            }

            // Mapeamento de rotas para navegação base
            const baseNavItems = [
                { path: '/dashboard', key: 'dashboard' },
                { path: '/atendimentos', key: 'atendimentos' },
                { path: '/mensagens', key: 'mensagens' },
                { path: '/configs', key: 'configs' },
                { path: '/disparos', key: 'disparos' },
                { path: '/followup', key: 'followup' },
            ];

            // Para usuário comum ou admin de empresa, se acessar '/' ou '/dashboard' e não tiver permissão para 'dashboard'
            if (location.pathname === '/' || location.pathname === '/dashboard') {
                if (!hasPermission('dashboard')) {
                    // Encontra o primeiro item permitido
                    const firstPermitted = baseNavItems.find(item => hasPermission(item.key));
                    if (firstPermitted) {
                        navigate(firstPermitted.path, { replace: true });
                    }
                }
            }
        }
    }, [isLoading, isSuperUser, userRole, userPermissions, location.pathname, navigate]);

    // Mostra um loading enquanto busca os dados do usuário
    if (isLoading) {
        return (
            <div style={{
                display: 'flex',
                height: '100vh',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'linear-gradient(175deg, #0b1c30 0%, #0942b3 55%, #1d4ed8 100%)'
            }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                    <div style={{
                        width: '42px', height: '42px',
                        border: '3px solid rgba(255,255,255,0.15)',
                        borderTopColor: '#ffffff',
                        borderRadius: '50%',
                        animation: 'spin 0.75s linear infinite'
                    }} />
                    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                    <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '0.85rem', color: 'rgba(255,255,255,0.55)', fontWeight: 500 }}>Carregando...</span>
                </div>
            </div>
        );
    }

    const baseSegment = currentPath.split('/')[0];
    const authorized = hasPermission(baseSegment);

    // Estrutura do layout principal
    return (
        <div className="flex h-screen bg-[#f0f4ff] font-inter overflow-hidden relative">
            {/* Overlay para Mobile: fecha o menu ao clicar fora */}
            {isMobileMenuOpen && (
                <div
                    className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 lg:hidden animate-fade-in"
                    onClick={() => setIsMobileMenuOpen(false)}
                />
            )}

            {/* Sidebar: Passamos o estado mobile e permissões */}
            <Sidebar
                currentUserApiType={currentUserApiType}
                isSuperUser={isSuperUser}
                userRole={userRole}
                userPermissions={userPermissions}
                isMobileMenuOpen={isMobileMenuOpen}
                setIsMobileMenuOpen={setIsMobileMenuOpen}
            />

            <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
                {/* Header (cabeçalho superior) - agora recebe o controle do menu */}
                <Header setIsMobileMenuOpen={setIsMobileMenuOpen} />

                {/* O Outlet renderiza a página da rota atual (Dashboard, Atendimentos, etc.) */}
                <main className="flex-1 flex flex-col overflow-hidden bg-[#f8faff]">
                    <div className="flex-1 overflow-y-auto overflow-x-hidden">
                        {authorized ? (
                            <Outlet context={{ userRole, userPermissions, isSuperUser }} />
                        ) : (
                            <Unauthorized />
                        )}
                    </div>
                </main>
            </div>
        </div>
    );
};

export default MainLayout;
