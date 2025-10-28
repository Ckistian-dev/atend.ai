import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

// Importação das páginas
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Atendimentos from './pages/Atendimentos';
import Configs from './pages/Configs';
import Whatsapp from './pages/Whatsapp';
import Operacao from './pages/Operacao';
import Mensagens from './pages/Mensagens';

// Importação dos componentes de layout
import MainLayout from './components/MainLayout';
import ProtectedRoute from './components/ProtectedRoute';

function App() {
  // A lógica de autenticação permanece a mesma
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      
      {/* Rotas protegidas dentro do layout principal */}
      {/* O MainLayout agora busca seus próprios dados (api_type) */}
      <Route path="/" element={ <ProtectedRoute> <MainLayout /> </ProtectedRoute> }>
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="atendimentos" element={<Atendimentos />} />
        <Route path="mensagens" element={<Mensagens />} />
        <Route path="configs" element={<Configs />} />
        <Route path="whatsapp" element={<Whatsapp />} />
        <Route path="operacao" element={<Operacao />} />
        
        {/* Redireciona a rota raiz para o dashboard */}
        <Route index element={<Navigate to="/dashboard" />} />
      </Route>
      
      {/* Redireciona qualquer outra rota para o login */}
      <Route path="*" element={<Navigate to="/login" />} />
    </Routes>
  );
}

export default App;
