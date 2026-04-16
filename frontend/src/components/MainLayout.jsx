import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import Header from './Header.jsx'; // Você precisará criar este arquivo
import api from '../api/axiosConfig.js'; // Verifique se o caminho está correto

const MainLayout = () => {
    const [currentUserApiType, setCurrentUserApiType] = useState(null);
    const [isSuperUser, setIsSuperUser] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        // Busca os dados do usuário ao carregar o layout
        const fetchUserData = async () => {
            try {
                // Usamos a rota /auth/me para pegar os dados do usuário logado
                const response = await api.get('/auth/me');
                // Armazenamos o tipo de API no estado
                setCurrentUserApiType(response.data.api_type);
                setIsSuperUser(response.data.is_superuser);
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

    // Estrutura do layout principal
    return (
        <div className="flex h-screen" style={{ background: '#f0f4ff' }}>
            {/* Passamos o api_type para a Sidebar.
              A Sidebar usará isso para decidir se mostra o link "Finalizados".
            */}
            <Sidebar currentUserApiType={currentUserApiType} isSuperUser={isSuperUser} />
            
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Seu Header (cabeçalho superior) */}
                <Header /> 
                
                {/* O Outlet renderiza a página da rota atual (Dashboard, Atendimentos, etc.) */}
                <main className="flex-1 flex flex-col overflow-hidden min-h-0">
                    <Outlet />
                </main>
            </div>
        </div>
    );
};

export default MainLayout;
