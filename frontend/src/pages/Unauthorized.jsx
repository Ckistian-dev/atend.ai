import React from 'react';
import { ShieldAlert, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const Unauthorized = () => {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] p-4 bg-[#f8faff]">
      <div className="bg-white p-8 md:p-10 rounded-[2rem] shadow-xl max-w-md w-full text-center border border-slate-100 flex flex-col items-center">
        <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center text-red-500 mb-6 border border-red-100">
          <ShieldAlert size={36} />
        </div>
        <h1 className="text-2xl font-black text-slate-800 tracking-tight mb-2" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Acesso Negado</h1>
        <p className="text-slate-500 text-sm leading-relaxed mb-8">
          Você não tem permissão para acessar esta página. Entre em contato com o administrador de sua empresa se achar que isso é um erro.
        </p>
        <button
          onClick={() => navigate('/dashboard')}
          className="w-full flex items-center justify-center gap-2 py-3.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-2xl font-bold text-sm shadow-xl shadow-blue-200 hover:shadow-blue-300 transition-all hover:-translate-y-0.5 active:translate-y-0"
        >
          <ArrowLeft size={18} />
          Voltar para o Início
        </button>
      </div>
    </div>
  );
};

export default Unauthorized;
