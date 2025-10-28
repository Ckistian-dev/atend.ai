import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import Header from './Header.jsx'; // Você precisará criar este arquivo
import api from '../api/axiosConfig.js'; // Verifique se o caminho está correto

const MainLayout = () => {
    const [currentUserApiType, setCurrentUserApiType] = useState(null);
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
            <div className="flex h-screen items-center justify-center bg-gray-100">
                <div className="text-lg font-medium text-gray-700">Carregando...</div>
            </div>
        );
    }

    // Estrutura do layout principal
    return (
        <div className="flex h-screen bg-gray-100">
            {/* Passamos o api_type para a Sidebar.
              A Sidebar usará isso para decidir se mostra o link "Finalizados".
            */}
            <Sidebar currentUserApiType={currentUserApiType} />
            
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Seu Header (cabeçalho superior) */}
                <Header /> 
                
                {/* O Outlet renderiza a página da rota atual (Dashboard, Atendimentos, etc.) */}
                <main className="flex-1 overflow-y-auto">
                    <Outlet />
                </main>
            </div>
        </div>
    );
};

export default MainLayout;

