// src/pages/Login.jsx

import React, { useState } from 'react';
import api from '../api/axiosConfig';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, Loader2, Zap, ArrowRight, Shield, Sparkles, Activity } from 'lucide-react';
import PageLoader from '../components/common/PageLoader';


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
        password: formData.password,
      }));

      localStorage.setItem('accessToken', response.data.access_token);

      if (response.data.is_admin) {
        navigate('/admin');
      } else {
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
    <div className="min-h-screen relative bg-[#f8f9ff] flex items-center justify-center p-4 sm:p-6 font-sans selection:bg-blue-100">
      {loading && (
        <PageLoader fullScreen message="Autenticando" subMessage="Verificando suas credenciais com segurança..." />
      )}
        <div className="grid grid-cols-1 min-[900px]:grid-cols-[5fr_7fr] w-full max-w-[1000px] bg-white rounded-[2rem] overflow-hidden shadow-[0_24px_60px_-15px_rgba(37,99,235,0.14),0_8px_16px_-4px_rgba(11,28,48,0.06)] animate-fade-in-up">

          {/* ── LEFT PANEL (Desktop Only) ── */}
          <div className="hidden min-[900px]:flex flex-col justify-between p-12 bg-gradient-to-br from-[#1e40af] via-[#2563eb] to-[#3b82f6] relative overflow-hidden">
            {/* Background Glow */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-white/[0.08] blur-[120px] rounded-full pointer-events-none" />
            
            {/* Brand */}
            <div className="flex items-center gap-3 z-10">
              <div className="w-10 h-10 bg-white/20 backdrop-blur-md rounded-xl flex items-center justify-center border border-white/30 shadow-lg">
                <Zap size={22} className="text-white fill-white" />
              </div>
              <span className="text-2xl font-extrabold text-white tracking-tight font-plus-jakarta">AtendAI</span>
            </div>

            {/* Nucleus Illustration */}
            <div className="relative h-64 flex items-center justify-center z-10">
              {/* Animated Rings */}
              <div className="absolute w-44 h-44 rounded-full border border-white/10 bg-white/5 animate-pulse" />
              <div className="absolute w-60 h-60 rounded-full border border-white/5 rotate-12" />
              <div className="absolute w-72 h-72 rounded-full border border-white/[0.03] -rotate-12" />
              
              <div className="w-28 h-28 bg-white/10 backdrop-blur-xl border border-white/20 rounded-[2.5rem] flex items-center justify-center shadow-2xl -rotate-6 transition-transform hover:rotate-0 duration-500">
                <Zap size={60} className="text-white fill-white filter drop-shadow-[0_0_15px_rgba(255,255,255,0.8)]" />
              </div>

              {/* Floating elements */}
              <div className="absolute top-[60%] -left-4 w-12 h-12 bg-white/10 backdrop-blur-md border border-white/20 rounded-xl flex items-center justify-center text-white shadow-xl animate-bounce [animation-duration:5s]">
                <Shield size={22} />
              </div>
              <div className="absolute top-6 -right-2 w-12 h-12 bg-white/10 backdrop-blur-md border border-white/20 rounded-xl flex items-center justify-center text-white shadow-xl animate-bounce [animation-duration:7s] [animation-direction:reverse]">
                <Activity size={22} />
              </div>
            </div>

            {/* Hero Content */}
            <div className="z-10 text-center">
              <h1 className="text-3xl xl:text-4xl font-extrabold text-white leading-[1.1] tracking-tight font-plus-jakarta mb-4">
                Potencialize seu atendimento com IA.
              </h1>
              <p className="text-white/60 text-sm leading-relaxed max-w-[36ch] mx-auto font-medium">
                Aumente a produtividade da sua equipe e ofereça uma experiência excepcional e automatizada aos seus clientes.
              </p>
            </div>
          </div>

          {/* ── RIGHT PANEL ── */}
          <div className="flex flex-col justify-center p-8 sm:p-12 lg:p-14 w-full bg-white">
            {/* Mobile Logo & Brand */}
            <div className="min-[900px]:hidden flex items-center gap-3 mb-10 justify-center">
              <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-200">
                <Zap size={20} className="text-white fill-white" />
              </div>
              <span className="text-2xl font-extrabold text-slate-900 tracking-tight font-plus-jakarta">AtendAI</span>
            </div>

            <div className="mb-8">
              <p className="text-[11px] font-bold tracking-[0.15em] uppercase text-blue-600 mb-2">Acesso à plataforma</p>
              <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight font-plus-jakarta mb-2">Bem-vindo de volta.</h2>
              <p className="text-slate-500 text-sm font-medium">Insira suas credenciais para acessar sua conta corporativa.</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-6">
              <div className="space-y-5">
                {/* Email */}
                <div className="space-y-2">
                  <label className="text-[11px] font-bold tracking-wider uppercase text-slate-500 block" htmlFor="login-email">
                    Email institucional
                  </label>
                  <div className="relative group">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors pointer-events-none">
                      <Mail size={18} />
                    </span>
                    <input
                      id="login-email"
                      type="email"
                      name="email"
                      placeholder="seu@empresa.com"
                      value={formData.email}
                      onChange={handleChange}
                      required
                      className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border-none rounded-2xl text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:ring-[3px] focus:ring-blue-100 transition-all outline-none"
                    />
                  </div>
                </div>

                {/* Password */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold tracking-wider uppercase text-slate-500" htmlFor="login-password">
                      Senha
                    </label>
                    <a href="#" className="text-xs font-bold text-blue-600 hover:text-blue-700 transition-colors">
                      Esqueceu a senha?
                    </a>
                  </div>
                  <div className="relative group">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors pointer-events-none">
                      <Lock size={18} />
                    </span>
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      name="password"
                      placeholder="••••••••"
                      value={formData.password}
                      onChange={handleChange}
                      required
                      className="w-full pl-12 pr-12 py-3.5 bg-slate-50 border-none rounded-2xl text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:ring-[3px] focus:ring-blue-100 transition-all outline-none"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-center gap-3 animate-shake">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                  <p className="text-xs font-semibold text-red-600">{error}</p>
                </div>
              )}

              {/* Security badge */}
              <div className="flex items-center justify-center gap-2 text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                <Shield size={14} className="text-emerald-500 fill-emerald-500/10" />
                Conexão segura SSL
              </div>

              {/* Submit */}
              <button 
                type="submit" 
                disabled={loading} 
                className="w-full flex items-center justify-center gap-3 py-4 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-2xl font-bold text-sm shadow-xl shadow-blue-200 hover:shadow-blue-300 hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                id="login-submit-btn"
              >
                {loading ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : (
                  <>
                    Acessar Plataforma
                    <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-10 pt-8 border-t border-slate-100 text-center space-y-4">
              <p className="text-xs font-medium text-slate-400">
                Desenvolvido por{' '}
                <a href="https://digitalforme.cjssolucoes.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 font-bold hover:underline underline-offset-4">
                  CJS Soluções
                </a>
              </p>
              <div className="flex items-center justify-center gap-4">
                <Link to="/politicies" className="text-[11px] font-bold text-slate-400 hover:text-slate-600 uppercase tracking-wider transition-colors">Privacidade</Link>
                <div className="w-1 h-1 rounded-full bg-slate-300" />
                <Link to="/terms-of-service" className="text-[11px] font-bold text-slate-400 hover:text-slate-600 uppercase tracking-wider transition-colors">Termos</Link>
              </div>
            </div>
          </div>

      </div>
    </div>
  );
}

export default Login;