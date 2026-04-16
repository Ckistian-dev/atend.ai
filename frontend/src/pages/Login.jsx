// src/pages/Login.jsx

import React, { useState } from 'react';
import api from '../api/axiosConfig';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, Loader2, Zap, ArrowRight, Shield, Sparkles, Activity } from 'lucide-react';

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
    <>
      {/* Google Fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600&display=swap');

        * { box-sizing: border-box; }

        .login-root {
          min-height: 100vh;
          background: #f8f9ff;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1.5rem;
          font-family: 'Inter', sans-serif;
        }

        .login-card {
          display: grid;
          grid-template-columns: 1fr;
          width: 100%;
          max-width: 960px;
          border-radius: 1.5rem;
          overflow: hidden;
          box-shadow: 0 20px 50px -12px rgba(37, 99, 235, 0.12), 0 4px 12px -2px rgba(11, 28, 48, 0.04);
          animation: fadeInUp 0.45s cubic-bezier(0.22, 1, 0.36, 1) both;
        }

        @media (min-width: 900px) {
          .login-card {
            grid-template-columns: 5fr 7fr;
          }
        }

        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* ── LEFT PANEL ── */
        .left-panel {
          display: none;
          flex-direction: column;
          justify-content: space-between;
          padding: 2.5rem 3rem;
          background: linear-gradient(135deg, #1e40af 0%, #2563eb 100%);
          position: relative;
          overflow: hidden;
        }

        @media (min-width: 900px) {
          .left-panel { display: flex; }
        }

        /* Central Glow Atmosphere */
        .left-panel::after {
          content: '';
          position: absolute;
          width: 600px; height: 600px;
          background: radial-gradient(circle, rgba(255, 255, 255, 0.1) 0%, transparent 70%);
          top: 35%; left: 50%;
          transform: translate(-50%, -50%);
          pointer-events: none;
          z-index: 0;
        }

        .brand-logo {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          z-index: 2;
        }

        .brand-logo-icon {
          width: 32px; height: 32px;
          background: rgba(255, 255, 255, 0.2);
          backdrop-filter: blur(8px);
          border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          border: 1px solid rgba(255, 255, 255, 0.3);
        }

        .brand-name {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 1.5rem;
          font-weight: 700;
          color: #fff;
          letter-spacing: -0.02em;
        }

        /* ── CENTRAL NUCLEUS ── */
        .nucleus-container {
          position: relative;
          height: 240px;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1;
        }

        .nucleus-ring {
          position: absolute;
          border-radius: 50%;
          border: 1px solid rgba(255, 255, 255, 0.05);
          background: rgba(255, 255, 255, 0.012);
        }

        .ring-1 { width: 180px; height: 180px; animation: pulse 4s infinite; }
        .ring-2 { width: 240px; height: 240px; border: 1px solid rgba(255, 255, 255, 0.03); transform: rotate(15deg); }
        .ring-3 { width: 260px; height: 260px; border: 0.5px solid rgba(255, 255, 255, 0.02); }

        .nucleus-core {
          width: 110px; height: 110px;
          background: rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(8px);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 35px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 0 30px rgba(0, 0, 0, 0.1);
          transform: rotate(-10deg);
        }

        .zap-bright {
          filter: drop-shadow(0 0 12px rgba(255, 255, 255, 0.8));
          color: #fff;
        }

        /* Floating Badges */
        .floating-badge {
          position: absolute;
          width: 44px; height: 44px;
          background: rgba(255, 255, 255, 0.05);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          display: flex; align-items: center; justify-content: center;
          color: rgba(255, 255, 255, 0.8);
          box-shadow: 0 10px 20px rgba(0,0,0,0.2);
          z-index: 2;
        }

        .badge-shield { top: 60%; left: -10px; animation: float 5s ease-in-out infinite; }
        .badge-chart { top: 15%; right: 10px; animation: float 7s ease-in-out infinite reverse; }

        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 0.3; }
          50% { transform: scale(1.1); opacity: 0.5; }
        }

        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }

        .hero-content {
          z-index: 2;
          text-align: center;
          margin-bottom: 1.5rem;
        }

        .hero-title {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 2.25rem;
          font-weight: 800;
          line-height: 1.15;
          letter-spacing: -0.04em;
          color: #fff;
          margin: 0 0 1rem;
        }

        .hero-subtitle {
          font-size: 0.95rem;
          color: rgba(255, 255, 255, 0.5);
          line-height: 1.6;
          max-width: 40ch;
          margin: 0 auto;
        }

        /* ── RIGHT PANEL ── */
        .right-panel {
          background: #ffffff;
          padding: 2.25rem 2.5rem;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }

        .form-header {
          margin-bottom: 1.5rem;
        }

        .form-eyebrow {
          font-size: 0.7rem;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #2563eb;
          margin-bottom: 0.4rem;
        }

        .form-title {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 1.9rem;
          font-weight: 800;
          letter-spacing: -0.035em;
          color: #0b1c30;
          margin: 0 0 0.4rem;
        }

        .form-subtitle {
          font-size: 0.875rem;
          color: #434655;
          margin: 0;
          line-height: 1.5;
        }

        /* ── FIELD GROUP ── */
        .field-group {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          margin-bottom: 1.25rem;
        }

        .field-label {
          display: block;
          font-size: 0.68rem;
          font-weight: 600;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: #6b7480;
          margin-bottom: 0.45rem;
        }

        .field-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 0.45rem;
        }

        .field-forgot {
          font-size: 0.75rem;
          font-weight: 600;
          color: #2563eb;
          text-decoration: none;
          transition: opacity 0.15s;
        }
        .field-forgot:hover { opacity: 0.72; }

        .input-wrap {
          position: relative;
        }

        .input-icon {
          position: absolute;
          left: 0.9rem;
          top: 50%;
          transform: translateY(-50%);
          color: #9ca3af;
          display: flex;
          align-items: center;
          pointer-events: none;
          transition: color 0.2s;
        }

        .input-field {
          width: 100%;
          padding: 0.75rem 2.75rem 0.75rem 2.65rem;
          font-family: 'Inter', sans-serif;
          font-size: 0.875rem;
          color: #0b1c30;
          background: #eff4ff;
          border: none;
          border-radius: 0.875rem;
          outline: none;
          transition: background 0.2s, box-shadow 0.2s;
        }

        .input-field::placeholder { color: #9ca3af; }

        .input-field:focus {
          background: #ffffff;
          box-shadow: 0 0 0 2.5px rgba(9, 66, 179, 0.18), 0 4px 12px rgba(9, 66, 179, 0.06);
        }

        .input-field:focus ~ .input-icon,
        .input-wrap:focus-within .input-icon {
          color: #2563eb;
        }

        .input-action {
          position: absolute;
          right: 0.9rem;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          cursor: pointer;
          color: #9ca3af;
          display: flex;
          align-items: center;
          padding: 0.15rem;
          border-radius: 6px;
          transition: color 0.15s, background 0.15s;
        }
        .input-action:hover { color: #2563eb; background: rgba(37, 99, 235, 0.06); }

        /* ── ERROR ── */
        .error-box {
          background: #fff5f5;
          border-radius: 0.75rem;
          padding: 0.75rem 1rem;
          display: flex;
          align-items: center;
          gap: 0.6rem;
          margin-bottom: 1.15rem;
        }

        .error-dot {
          width: 7px; height: 7px;
          border-radius: 50%;
          background: #ba1a1a;
          flex-shrink: 0;
        }

        .error-text {
          font-size: 0.8rem;
          font-weight: 500;
          color: #ba1a1a;
          margin: 0;
        }

        /* ── SUBMIT BUTTON ── */
        .btn-primary {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.55rem;
          padding: 0.85rem 1.5rem;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 0.9rem;
          font-weight: 700;
          color: #ffffff;
          background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
          border: none;
          border-radius: 0.875rem;
          cursor: pointer;
          letter-spacing: -0.01em;
          transition: opacity 0.18s, transform 0.18s, box-shadow 0.18s;
          box-shadow: 0 6px 20px rgba(37, 99, 235, 0.25);
          margin-bottom: 1.5rem;
        }

        .btn-primary:hover:not(:disabled) {
          opacity: 0.93;
          transform: translateY(-1px);
          box-shadow: 0 10px 28px rgba(37, 99, 235, 0.3);
        }

        .btn-primary:active:not(:disabled) {
          transform: translateY(0);
          box-shadow: 0 4px 12px rgba(37, 99, 235, 0.2);
        }

        .btn-primary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .btn-arrow-icon {
          transition: transform 0.2s;
        }
        .btn-primary:hover:not(:disabled) .btn-arrow-icon {
          transform: translateX(3px);
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .spin { animation: spin 0.8s linear infinite; }

        /* ── FOOTER ── */
        .login-footer {
          border-top: 1px solid rgba(196,197,215,0.25);
          padding-top: 1.25rem;
          text-align: center;
        }

        .footer-dev {
          font-size: 0.72rem;
          color: #9ca3af;
          margin: 0 0 0.65rem;
        }

        .footer-dev a {
          color: #2563eb;
          font-weight: 600;
          text-decoration: none;
          transition: opacity 0.15s;
        }
        .footer-dev a:hover { opacity: 0.72; }

        .footer-links {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.65rem;
        }

        .footer-link {
          font-size: 0.7rem;
          color: #9ca3af;
          text-decoration: none;
          transition: color 0.15s;
        }
        .footer-link:hover { color: #0b1c30; }

        .footer-dot {
          width: 3px; height: 3px;
          border-radius: 50%;
          background: #c4c5d7;
        }

        /* ── SECURITY BADGE ── */
        .security-badge {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.4rem;
          font-size: 0.7rem;
          color: #9ca3af;
          margin-bottom: 1.25rem;
        }

        .security-badge svg { color: #10B981; }
      `}</style>

      <div className="login-root">
        <div className="login-card">

          {/* ── LEFT PANEL ── */}
          <div className="left-panel">
            {/* Brand */}
            <div className="brand-logo">
              <div className="brand-logo-icon">
                <Zap size={18} color="#fff" fill="#fff" />
              </div>
              <span className="brand-name">AtendAI</span>
            </div>

            {/* Nucleus Illustration */}
            <div className="nucleus-container">
              <div className="nucleus-ring ring-3" />
              <div className="nucleus-ring ring-2" />
              <div className="nucleus-ring ring-1" />
              
              <div className="nucleus-core">
                <Zap size={56} className="zap-bright" fill="#fff" />
              </div>

              {/* Floating elements */}
              <div className="floating-badge badge-shield">
                <Shield size={20} />
              </div>
              <div className="floating-badge badge-chart">
                <Activity size={20} />
              </div>
            </div>

            {/* Hero */}
            <div>
              <div className="hero-content">
                <h1 className="hero-title">
                  Potencialize seu atendimento<br />
                  com Inteligência Artificial.
                </h1>
                <p className="hero-subtitle">
                  Aumente a produtividade da sua equipe e ofereça uma experiência excepcional e automatizada aos seus clientes.
                </p>
              </div>
            </div>
          </div>

          {/* ── RIGHT PANEL ── */}
          <div className="right-panel">
            <div className="form-header">
              <p className="form-eyebrow">Acesso à plataforma</p>
              <h2 className="form-title">Bem-vindo de volta.</h2>
              <p className="form-subtitle">Insira suas credenciais para acessar sua conta corporativa.</p>
            </div>

            <form onSubmit={handleLogin}>
              <div className="field-group">
                {/* Email */}
                <div>
                  <label className="field-label" htmlFor="login-email">Email institucional</label>
                  <div className="input-wrap">
                    <span className="input-icon">
                      <Mail size={16} />
                    </span>
                    <input
                      id="login-email"
                      type="email"
                      name="email"
                      placeholder="seu@empresa.com"
                      value={formData.email}
                      onChange={handleChange}
                      required
                      className="input-field"
                    />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <div className="field-row">
                    <label className="field-label" htmlFor="login-password" style={{ margin: 0 }}>Senha</label>
                    <a href="#" className="field-forgot">Esqueceu a senha?</a>
                  </div>
                  <div className="input-wrap">
                    <span className="input-icon">
                      <Lock size={16} />
                    </span>
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      name="password"
                      placeholder="••••••••"
                      value={formData.password}
                      onChange={handleChange}
                      required
                      className="input-field"
                    />
                    <button
                      type="button"
                      className="input-action"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                    >
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="error-box">
                  <div className="error-dot" />
                  <p className="error-text">{error}</p>
                </div>
              )}

              {/* Security badge */}
              <div className="security-badge">
                <Shield size={12} />
                Conexão segura e criptografada
              </div>

              {/* Submit */}
              <button type="submit" disabled={loading} className="btn-primary" id="login-submit-btn">
                {loading ? (
                  <Loader2 size={17} className="spin" />
                ) : (
                  <>
                    Acessar Plataforma
                    <ArrowRight size={16} className="btn-arrow-icon" />
                  </>
                )}
              </button>
            </form>

            <div className="login-footer">
              <p className="footer-dev">
                Desenvolvido por{' '}
                <a href="https://digitalforme.cjssolucoes.com" target="_blank" rel="noopener noreferrer">
                  CJS Soluções
                </a>
              </p>
              <div className="footer-links">
                <Link to="/politicies" className="footer-link">Política de Privacidade</Link>
                <div className="footer-dot" />
                <Link to="/terms-of-service" className="footer-link">Termos de Serviço</Link>
              </div>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}

export default Login;