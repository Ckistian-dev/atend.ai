// src/pages/Login.jsx

import React, { useState } from 'react';
import api from '../api/axiosConfig';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, Loader2 } from 'lucide-react';

// O setIsAuthenticated não é mais necessário aqui, o ProtectedRoute cuida disso.
function Login() { 
    const [formData, setFormData] = useState({ email: '', password: '' });
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            const response = await api.post('/auth/token', new URLSearchParams({
                username: formData.email,
                password: formData.password
            }));
            
            localStorage.setItem('accessToken', response.data.access_token);
            
            // Se o login for de admin, redireciona direto para /admin
            if (response.data.is_admin) {
                navigate('/admin');
            } else {
                // Para usuários normais, mantém o redirecionamento padrão
                const redirectPath = location.state?.from?.pathname || '/mensagens';
                navigate(redirectPath);
            }

        } catch (err) {
            setError('Email ou senha inválidos. Tente novamente.');
            console.error('Erro de login:', err);
        } finally {
            setLoading(false);
        }
    };
    
    return (
        <div className="min-h-screen bg-brand-surface flex items-center justify-center p-4 sm:p-8 transition-all duration-200 ease-in-out">
            <div className="grid grid-cols-1 lg:grid-cols-2 max-w-5xl w-full bg-brand-background shadow-md border border-slate-200 rounded-2xl overflow-hidden animate-fade-in-up">
                
                {/* Bloco 1: Painel Esquerdo (Visual Institucional) */}
                <div className="hidden lg:flex flex-col items-center justify-center p-12 bg-brand-primary text-white relative overflow-hidden">
                    <div className="absolute -top-16 -left-16 w-48 h-48 bg-white/10 rounded-full mix-blend-overlay animate-pulse"></div>
                    <div className="absolute -bottom-24 -right-10 w-64 h-64 bg-white/10 rounded-full mix-blend-overlay animate-pulse delay-500"></div>
                    
                    <div className="w-24 h-24 bg-white backdrop-blur-sm border border-white/20 rounded-2xl shadow-sm flex items-center justify-center mb-6 transition-all duration-200 hover:scale-105 hover:bg-white/30">
                        <img src="https://i.ibb.co/2YhckHCs/Gemini-Generated-Image-w69kl3w69kl3w69k.png" alt="Logo" className="w-12 h-12" />
                    </div>
                    <h1 className="text-4xl font-semibold tracking-tight text-white mb-2">Atend<span className="font-medium text-[36px] text-brand-surface">AI</span></h1>
                    <p className="text-sm text-center text-white/90 leading-relaxed max-w-xs">Acesse sua conta corporativa para gerenciar seus fluxos de atendimento.</p>
                </div>

                {/* Bloco 2: Painel Direito (Formulário e Cabeçalho) */}
                <div className="p-8 md:p-12 flex flex-col justify-center">
                    <div className="text-center mb-8">
                        <h2 className="text-2xl font-semibold tracking-tight text-brand-foreground">Bem-vindo de volta</h2>
                        <p className="text-sm text-slate-500 mt-1.5">Insira suas credenciais para acessar a plataforma.</p>
                    </div>

                    <form onSubmit={handleLogin} className="space-y-6">
                        {/* Campo de Email */}
                        <div className="relative">
                            <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input
                                type="email"
                                name="email"
                                placeholder="Ex: joao@empresa.com.br"
                                value={formData.email}
                                onChange={handleChange}
                                required
                                className="w-full pl-10 pr-4 py-2.5 text-sm bg-brand-background border border-slate-300 rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary transition-all placeholder:text-slate-400"
                            />
                        </div>
                        {/* Campo de Senha */}
                        <div className="relative">
                            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input
                                type={showPassword ? 'text' : 'password'}
                                name="password"
                                placeholder="Sua senha de acesso"
                                value={formData.password}
                                onChange={handleChange}
                                required
                                className="w-full pl-10 pr-10 py-2.5 text-sm bg-brand-background border border-slate-300 rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary transition-all placeholder:text-slate-400"
                            />
                            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-brand-primary transition-colors">
                                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>

                        {error && (
                            <div className="p-3 bg-red-50 border border-red-100 rounded-lg flex items-center justify-center">
                                <p className="text-sm font-medium text-red-600">{error}</p>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-brand-primary text-white font-medium text-sm py-2.5 px-4 rounded-lg hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-brand-primary transition-all duration-200 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {loading ? <Loader2 className="animate-spin" size={18} /> : 'Acessar Plataforma'}
                        </button>
                    </form>
                    
                    {/* Bloco 3: Rodapé Institucional */}
                    <div className="text-center mt-8 pt-6 border-t border-slate-100">
                        <p className="text-xs text-slate-500">
                            Desenvolvido por <a href="https://digitalforme.cjssolucoes.com" target="_blank" rel="noopener noreferrer" className="font-medium text-brand-foreground hover:text-brand-primary transition-colors">CJS Soluções</a>
                        </p>
                        <div className="text-xs text-slate-400 mt-3 flex items-center justify-center gap-3">
                            <Link to="/politicies" className="hover:text-brand-foreground transition-colors">Política de Privacidade</Link>
                            <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                            <Link to="/terms-of-service" className="hover:text-brand-foreground transition-colors">Termos de Serviço</Link>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Login;