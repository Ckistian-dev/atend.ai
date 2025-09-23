// src/api/axiosConfig.js

import axios from 'axios';

const api = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL, // Ex: http://localhost:8000/api/v1
});

// Interceptor para adicionar o token de autenticação a cada requisição
api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('accessToken');
        if (token) {
            config.headers['Authorization'] = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// Interceptor para lidar com tokens expirados (erro 401)
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response && error.response.status === 401) {
            console.error("Erro 401: Token inválido ou expirado. A redirecionar para o login.");
            localStorage.removeItem('accessToken');
            // Força o redirecionamento para a página de login
            window.location.href = '/login';
        }
        return Promise.reject(error);
    }
);

export default api;