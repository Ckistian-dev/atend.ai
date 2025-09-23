// src/components/Header.jsx

import React, { useState, useEffect, useCallback } from 'react';
import { Ticket, User as UserIcon, AlertCircle } from 'lucide-react';
import api from '../api/axiosConfig';

const Header = () => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    const fetchUserData = useCallback(async () => {
        try {
            const response = await api.get('/auth/me');
            setUser(response.data);
        } catch (err) {
            console.error("Erro ao buscar dados do utilizador:", err);
            setError(true);
        }
    }, []);

    useEffect(() => {
        const loadInitialData = async () => {
            setLoading(true);
            await fetchUserData();
            setLoading(false);
        };
        loadInitialData();
    }, [fetchUserData]);

    // Atualiza os tokens a cada 10 segundos
    useEffect(() => {
        const intervalId = setInterval(fetchUserData, 10000);
        return () => clearInterval(intervalId);
    }, [fetchUserData]);

    const renderContent = () => {
        if (loading) {
            return <div className="h-6 bg-gray-200 rounded-md w-48 animate-pulse"></div>;
        }
        if (error || !user) {
            return (
                <div className="flex items-center gap-2 text-sm text-red-600">
                    <AlertCircle size={18} />
                    <span>Erro ao carregar dados.</span>
                </div>
            );
        }
        return (
            <>
                <div className="flex items-center gap-2 text-gray-600" title="Os seus tokens restantes">
                    <Ticket size={20} className="text-brand-blue" />
                    <span className="font-semibold text-gray-800">{user.tokens}</span>
                    <span className="text-sm hidden sm:inline">Tokens</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600 bg-gray-100 px-3 py-1 rounded-full">
                    <UserIcon size={18} />
                    <span className="font-medium">{user.email}</span>
                </div>
            </>
        );
    };

    return (
        <header className="bg-white p-4 border-b border-gray-200 flex justify-end items-center shadow-sm">
            <div className="flex items-center gap-4 sm:gap-6">
                {renderContent()}
            </div>
        </header>
    );
};

export default Header;