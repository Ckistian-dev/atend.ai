import React, { useState, useEffect, useCallback, useMemo } from 'react';
// --- CORRIGIDO: Removido .js da importação ---
import api from '../api/axiosConfig';
// ---------------------------------------------
import QRCode from 'qrcode.react'; // Garanta que 'qrcode.react' está instalado (`npm install qrcode.react` ou `yarn add qrcode.react`)
import {
    Wifi, WifiOff, Loader2, ServerCrash, LogOut, Save, Edit,
    AlertCircle, ScanLine, RefreshCw, Link as LinkIcon, CheckCircle,
    PowerOff, Info, Settings, KeyRound, Phone, Copy, HelpCircle, Smartphone, Globe
} from 'lucide-react';

// --- Componente StatusDisplayEvolution (sem alterações) ---
const StatusDisplayEvolution = ({ statusInfo, qrCode, onConnect, onDisconnect, onRefresh, isChecking, error, disabled }) => {
    const showRefreshButton = !['loading', 'loading_qr', 'connected', 'open', 'qrcode'].includes(statusInfo?.status);

    const getContainerClasses = () => {
        const baseClasses = 'text-center p-6 border-2 border-dashed rounded-lg transition-colors duration-300 min-h-[300px] flex flex-col justify-center items-center';
        switch (statusInfo?.status) {
            case 'connected': case 'open': return `${baseClasses} bg-green-50 border-green-300`;
            case 'connecting': case 'close': case 'qrcode': return `${baseClasses} bg-blue-50 border-blue-300`;
            case 'error': case 'api_error': return `${baseClasses} bg-red-50 border-red-300`;
            case 'no_instance_name': return `${baseClasses} bg-amber-50 border-amber-300`;
            default: return `${baseClasses} bg-gray-50 border-gray-300`;
        }
    };

    const renderContent = () => {
        switch (statusInfo?.status) {
            case 'connected':
            case 'open':
                return (
                    <div>
                        <Wifi size={48} className="mx-auto text-green-500 mb-3" />
                        <h2 className="text-xl font-bold text-green-800">Conectado (Evolution API)</h2>
                        <p className="text-gray-600 mt-1 text-sm">Sua instância está online.</p>
                        <button onClick={onDisconnect} disabled={isChecking} className="mt-4 flex items-center gap-2 mx-auto bg-red-500 text-white font-semibold py-2 px-3 rounded-lg shadow-md hover:bg-red-600 transition-all text-sm disabled:opacity-50">
                            {isChecking ? <Loader2 size={16} className="animate-spin" /> : <LogOut size={16} />} Desconectar
                        </button>
                    </div>
                );
            case 'loading':
            case 'loading_qr':
                return <div><Loader2 size={48} className="mx-auto text-blue-500 animate-spin mb-3" /><p className="text-gray-600 text-sm">{statusInfo.status === 'loading_qr' ? 'Gerando QR Code...' : 'Verificando...'}</p></div>;
            case 'connecting': // Estado intermediário, mostra QR code ou loading
            case 'close':
            case 'qrcode':
                return (
                    <div>
                        <ScanLine size={32} className="mx-auto text-blue-500 mb-2" />
                        <h2 className="text-lg font-bold text-gray-800 mb-3">Leia o QR Code</h2>
                        <div className="p-3 bg-white inline-block rounded-lg shadow-inner border">
                            {qrCode ? <QRCode value={qrCode} size={180} /> : <Loader2 size={48} className="animate-spin text-blue-500" />}
                        </div>
                        <p className="text-gray-600 mt-3 text-sm">Abra o WhatsApp no seu celular e leia o código.</p>
                    </div>
                );
             case 'error':
             case 'api_error':
                 return (
                     <div>
                         <ServerCrash size={48} className="mx-auto text-red-500 mb-3" />
                         <h2 className="text-xl font-bold text-red-800">Erro na Conexão</h2>
                         <p className="text-red-600 mt-1 text-sm">{error || statusInfo.detail || 'Não foi possível conectar ou verificar o estado.'}</p>
                         <button onClick={onConnect} disabled={disabled || isChecking} className="mt-4 flex items-center gap-2 mx-auto bg-blue-500 text-white font-semibold py-2 px-3 rounded-lg shadow-md hover:bg-blue-600 transition-all text-sm disabled:bg-gray-400">
                              {isChecking ? <Loader2 size={16} className="animate-spin" /> : <LinkIcon size={16} />} Tentar Conectar
                         </button>
                     </div>
                 );
            case 'no_instance_name':
                return (
                    <div>
                        <AlertCircle size={48} className="mx-auto text-amber-500 mb-3" />
                        <h2 className="text-xl font-bold text-amber-800">Ação Necessária</h2>
                        <p className="text-amber-700 mt-1 text-sm">Defina um Nome de Instância para continuar.</p>
                    </div>
                );
            default: // disconnected, etc.
                return (
                     <div>
                         <WifiOff size={48} className="mx-auto text-gray-400 mb-3" />
                         <h2 className="text-xl font-bold text-gray-800">Desconectado</h2>
                         <p className="text-gray-600 mt-1 text-sm">Sua sessão do WhatsApp (Evolution) não está ativa.</p>
                         <button onClick={onConnect} disabled={disabled || isChecking} className="mt-4 flex items-center gap-2 mx-auto bg-blue-500 text-white font-semibold py-2 px-3 rounded-lg shadow-md hover:bg-blue-600 transition-all text-sm disabled:bg-gray-400">
                             {isChecking ? <Loader2 size={16} className="animate-spin" /> : <LinkIcon size={16} />} Conectar
                         </button>
                     </div>
                 );
        }
    };

    return (
        <div className="border border-gray-200 rounded-lg p-4">
             <div className={`${getContainerClasses()}`}>
                 {renderContent()}
             </div>
             {showRefreshButton && (
                 <div className="border-t border-gray-200 pt-3 mt-3 text-center">
                     <button onClick={onRefresh} disabled={isChecking} className="flex items-center justify-center gap-1 mx-auto text-xs text-gray-500 hover:text-blue-600 font-semibold disabled:opacity-50">
                         {isChecking ? <><Loader2 size={14} className="animate-spin" /> Verificando...</> : <><RefreshCw size={14} /> Atualizar Status</>}
                     </button>
                 </div>
             )}
        </div>
    );
};

// --- Componente StatusDisplayOfficial (REMOVIDO Botão Ver Config Webhook) ---
const StatusDisplayOfficial = ({ statusInfo, onRefresh, isChecking, error, configInfo }) => {
     // REMOVIDO: const [showConfig, setShowConfig] = useState(false);

     const getContainerClasses = () => {
         const baseClasses = 'text-center p-6 border-2 border-dashed rounded-lg transition-colors duration-300 min-h-[300px] flex flex-col justify-center items-center';
         switch (statusInfo?.status) {
             case 'configured': return `${baseClasses} bg-green-50 border-green-300`;
             case 'not_configured': return `${baseClasses} bg-amber-50 border-amber-300`;
             case 'loading': return `${baseClasses} bg-gray-50 border-gray-300`;
             case 'error': case 'api_error': return `${baseClasses} bg-red-50 border-red-300`;
             default: return `${baseClasses} bg-gray-50 border-gray-300`;
         }
     };

     // REMOVIDA: Função copyToClipboard (não é mais necessária neste componente)

     const renderContent = () => {
         switch (statusInfo?.status) {
             case 'configured':
                 return (
                     <div>
                         <CheckCircle size={48} className="mx-auto text-green-500 mb-3" />
                         <h2 className="text-xl font-bold text-green-800">Configurado (API Oficial)</h2>
                         <p className="text-gray-600 mt-1 text-sm">Pronto para receber mensagens.</p>
                         <p className="text-xs text-gray-500 mt-1">ID do Número: {statusInfo.wbp_phone_number_id || 'N/A'}</p>
                          {/* REMOVIDO: Botão Ver Config. Webhook */}
                     </div>
                 );
              case 'not_configured':
                 let message = "Configuração incompleta.";
                 if (!statusInfo.wbp_phone_number_id) message = "ID do Número de Telefone não configurado.";
                 return (
                     <div>
                         <AlertCircle size={48} className="mx-auto text-amber-500 mb-3" />
                         <h2 className="text-xl font-bold text-amber-800">Configuração Incompleta</h2>
                         <p className="text-amber-700 mt-1 text-sm">{message}</p>
                         {!statusInfo.wbp_phone_number_id && (
                            <p className="text-xs text-gray-500 mt-2">Configure o ID do Número primeiro.</p>
                         )}
                         {/* REMOVIDO: Botão Ver Config Webhook aqui também */}
                     </div>
                 );
             case 'loading':
                 return <div><Loader2 size={48} className="mx-auto text-blue-500 animate-spin mb-3" /><p className="text-gray-600 text-sm">Verificando configuração...</p></div>;
             case 'error':
             case 'api_error':
                  return (
                      <div>
                          <ServerCrash size={48} className="mx-auto text-red-500 mb-3" />
                          <h2 className="text-xl font-bold text-red-800">Erro</h2>
                          <p className="text-red-600 mt-1 text-sm">{error || statusInfo.detail || 'Erro ao verificar configuração.'}</p>
                          <button onClick={onRefresh} disabled={isChecking} className="mt-4 flex items-center justify-center gap-1 mx-auto text-xs text-gray-500 hover:text-blue-600 font-semibold disabled:opacity-50">
                               {isChecking ? <><Loader2 size={14} className="animate-spin" /> Verificando...</> : <><RefreshCw size={14} /> Tentar Novamente</>}
                          </button>
                      </div>
                  );
             default:
                 return <div><HelpCircle size={48} className="mx-auto text-gray-400 mb-3" /><p className="text-gray-600 text-sm">Status desconhecido.</p></div>;
         }
     };

     return (
         <div className="border border-gray-200 rounded-lg p-4 space-y-4">
             <div className={`${getContainerClasses()}`}>
                 {renderContent()}
             </div>

             {/* REMOVIDO: Seção de Configuração do Webhook */}

              {/* Botão de Refresh (se status não for loading) */}
              {statusInfo?.status !== 'loading' && (
                  <div className="border-t border-gray-200 pt-3 text-center">
                      <button onClick={onRefresh} disabled={isChecking} className="flex items-center justify-center gap-1 mx-auto text-xs text-gray-500 hover:text-blue-600 font-semibold disabled:opacity-50">
                          {isChecking ? <><Loader2 size={14} className="animate-spin" /> Verificando...</> : <><RefreshCw size={14} /> Atualizar Status</>}
                      </button>
                  </div>
              )}
         </div>
     );
 };


// --- Componente GoogleConnect (sem alterações) ---
const GoogleConnect = ({ isConnected, onConnect, onDisconnect, isLoading }) => {
    return (
        <div className="bg-gray-100 p-4 rounded-lg border border-gray-200">
            <label className="block text-sm font-medium text-gray-600 mb-2">Conexão Google Agenda</label>
            <p className="text-xs text-gray-500 mb-3">Conecte sua conta Google para salvar novos contatos automaticamente (recomendado para Evolution API).</p>
            {isLoading ? (
                <div className="flex items-center justify-center text-gray-500">
                    <Loader2 size={20} className="animate-spin mr-2" /> A processar...
                </div>
            ) : isConnected ? (
                <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-green-700 font-medium text-sm">
                        <CheckCircle size={18} /> Conectado
                    </span>
                    <button onClick={onDisconnect} title="Desconectar" className="p-1.5 bg-red-100 text-red-600 rounded-md hover:bg-red-200"><PowerOff size={18}/></button>
                </div>
            ) : (
                <button onClick={onConnect} className="w-full flex items-center justify-center gap-2 bg-blue-500 text-white font-semibold py-2 px-3 rounded-lg shadow-md hover:bg-blue-600 transition-all text-sm"><LinkIcon size={16} /> Conectar com Google</button>
            )}
        </div>
    );
};


// --- Componente Principal Whatsapp ---
function Whatsapp() {
    // --- ESTADOS ---
    const [user, setUser] = useState(null);
    const [loadingAuth, setLoadingAuth] = useState(true);
    const [error, setError] = useState('');
    const [isChecking, setIsChecking] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Estados Evolution API
    const [statusInfoEvo, setStatusInfoEvo] = useState({ status: 'loading', api_type: 'evolution' });
    const [qrCodeEvo, setQrCodeEvo] = useState('');
    const [instanceNameEvo, setInstanceNameEvo] = useState('');
    const [originalInstanceNameEvo, setOriginalInstanceNameEvo] = useState('');
    const [isEditingEvo, setIsEditingEvo] = useState(false);

    // Estados API Oficial
    const [statusInfoOfficial, setStatusInfoOfficial] = useState({ status: 'loading', api_type: 'official' });
    const [wbpPhoneNumberId, setWbpPhoneNumberId] = useState('');
    const [originalWbpPhoneNumberId, setOriginalWbpPhoneNumberId] = useState('');
    // REMOVIDO: officialConfigInfo (não é mais buscado/usado no frontend)
    const [isEditingOfficial, setIsEditingOfficial] = useState(false);

    // Estados Google
    const [isGoogleConnected, setIsGoogleConnected] = useState(false);
    const [isGoogleLoading, setIsGoogleLoading] = useState(false);

    // --- Mapeamento ---
    const apiType = useMemo(() => user?.api_type || null, [user]);
    const isEvolution = useMemo(() => apiType === 'evolution', [apiType]);
    const isOfficial = useMemo(() => apiType === 'official', [apiType]);


    // --- Tratamento do callback do Google ---
     useEffect(() => {
         const params = new URLSearchParams(window.location.search);
         const googleAuthStatus = params.get('google_auth');
         if (googleAuthStatus) {
             window.history.replaceState({}, document.title, window.location.pathname);
             if (googleAuthStatus === 'success') {
                 alert('Conta Google conectada com sucesso!');
                 setIsGoogleConnected(true);
             } else {
                 const errorMessages = {
                      error_missing_params: 'Parâmetros de autenticação em falta.',
                      error_user_not_found: 'Usuário não encontrado durante o processo.',
                      error_invalid_state: 'A sessão de autorização expirou ou é inválida. Tente novamente.',
                      error_generic: 'Ocorreu um erro inesperado. Tente novamente.',
                 };
                 alert(`Falha na conexão com o Google: ${errorMessages[googleAuthStatus] || 'Erro desconhecido.'}`);
                 setIsGoogleConnected(false);
             }
         }
     }, []);


    // --- REMOVIDO: Função fetchOfficialConfigInfo ---


    // --- Função para verificar Status ---
     const checkStatus = useCallback(async (currentApiType = apiType) => {
         if (isChecking || !currentApiType || (currentApiType === 'evolution' && isEditingEvo) || (currentApiType === 'official' && isEditingOfficial)) return;
         setIsChecking(true);
         setError('');
         try {
             const response = await api.get('/whatsapp/status');
             const data = response.data;

             if (data.api_type === 'evolution' && currentApiType === 'evolution') {
                 setStatusInfoEvo(data);
                 if (data.status === 'qrcode' && data.instance?.qrcode) {
                     setQrCodeEvo(data.instance.qrcode);
                 } else if (data.status === 'close' || data.status === 'connecting'){
                     await handleConnectEvo();
                 } else {
                     setQrCodeEvo('');
                 }
             } else if (data.api_type === 'official' && currentApiType === 'official') {
                 setStatusInfoOfficial(data);
                 // REMOVIDO: Lógica fetchOfficialConfigInfo daqui
             } else if (data.api_type !== currentApiType) {
                  console.warn(`Status retornado (${data.api_type}) diferente do tipo no estado (${currentApiType}). Recarregando dados do usuário...`);
                  fetchInitialData();
             }
         } catch (err) {
             console.error("Erro ao verificar status:", err);
             setError('Não foi possível verificar o estado da conexão.');
             if (currentApiType === 'evolution') setStatusInfoEvo({ status: 'api_error', api_type: 'evolution' });
             if (currentApiType === 'official') setStatusInfoOfficial({ status: 'api_error', api_type: 'official' });
         } finally {
             setIsChecking(false);
         }
     // eslint-disable-next-line react-hooks/exhaustive-deps
     }, [isChecking, apiType, isEditingEvo, isEditingOfficial]); // Removido fetchOfficialConfigInfo das dependências


    // --- Busca dados iniciais do usuário ---
    const fetchInitialData = useCallback(async () => {
        setLoadingAuth(true);
        setIsChecking(true);
        setError('');
        try {
            const res = await api.get('/auth/me');
            const userData = res.data;
            setUser(userData);

            const fetchedApiType = userData.api_type || 'evolution';
            setIsGoogleConnected(userData.is_google_connected || false);
            setInstanceNameEvo(userData.instance_name || '');
            setOriginalInstanceNameEvo(userData.instance_name || '');
            setWbpPhoneNumberId(userData.wbp_phone_number_id || '');
            setOriginalWbpPhoneNumberId(userData.wbp_phone_number_id || '');

            setIsEditingEvo(fetchedApiType === 'evolution' && !userData.instance_name);
            setIsEditingOfficial(fetchedApiType === 'official' && !userData.wbp_phone_number_id);

             // REMOVIDO: Chamada fetchOfficialConfigInfo daqui
             await checkStatus(fetchedApiType);

        } catch (err) {
            console.error("Erro ao buscar dados iniciais:", err);
            setError("Não foi possível carregar os dados. Tente recarregar a página ou fazer login novamente.");
            setUser(null);
        } finally {
            setIsChecking(false);
            setLoadingAuth(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // CheckStatus é chamado dentro

    // --- Busca dados iniciais ao montar ---
    useEffect(() => {
        fetchInitialData();
    }, [fetchInitialData]);

    // --- Funções Específicas da Evolution API (sem alterações) ---
    const handleConnectEvo = useCallback(async () => {
        if (isChecking || !instanceNameEvo) return;
        setIsChecking(true);
        setStatusInfoEvo(prev => ({ ...prev, status: 'loading_qr' }));
        setQrCodeEvo('');
        setError('');
        try {
            const response = await api.get('/whatsapp/connect');
            const data = response.data;
             if (data.status === 'qrcode' && data.instance?.qrcode) {
                 setQrCodeEvo(data.instance.qrcode);
                 setStatusInfoEvo({ status: 'qrcode', instance: data.instance, api_type: 'evolution' });
             } else if (data.status === 'error') {
                 setError(data.detail || 'Erro ao gerar QR Code.');
                 setStatusInfoEvo({ status: 'error', api_type: 'evolution', detail: data.detail });
             } else {
                 setStatusInfoEvo(data.instance ? { status: data.instance.state, instance: data.instance, api_type: 'evolution' } : { status: 'disconnected', api_type: 'evolution' });
             }
        } catch (err) {
            console.error("Erro handleConnectEvo:", err);
            setError(err.response?.data?.detail || 'Erro ao tentar conectar via Evolution API.');
            setStatusInfoEvo({ status: 'error', api_type: 'evolution', detail: err.response?.data?.detail });
        } finally {
            setIsChecking(false);
        }
    }, [isChecking, instanceNameEvo]);

    const handleDisconnectEvo = async () => {
        if (isChecking) return;
        if (window.confirm('Tem certeza que deseja desconectar e remover a instância Evolution?')) {
            setIsChecking(true);
            setError('');
            try {
                await api.post('/whatsapp/disconnect');
                setQrCodeEvo('');
                setStatusInfoEvo({ status: 'disconnected', api_type: 'evolution' });
            } catch (err) {
                console.error("Erro handleDisconnectEvo:", err);
                const errorMsg = err.response?.data?.detail || 'Não foi possível desconectar a instância Evolution.';
                alert(errorMsg);
                setError(errorMsg);
            } finally {
                setIsChecking(false);
            }
        }
    };

    const handleSaveInstanceName = async () => {
         if (!instanceNameEvo || instanceNameEvo.trim().length < 3 || /\s/.test(instanceNameEvo.trim())) {
             alert('O nome da instância deve ter pelo menos 3 caracteres e não conter espaços.');
             return;
         }
         if (apiType !== 'evolution') {
             alert("A API configurada não é a Evolution. Operação cancelada.");
             return;
         }
         setIsSaving(true);
         setError('');
         try {
             const payload = { instance_name: instanceNameEvo.trim(), api_type: 'evolution' }; // Envia api_type
             const response = await api.post('/whatsapp/connection-info', payload);
             setUser(prevUser => ({ ...prevUser, ...response.data }));
             setInstanceNameEvo(response.data.instance_name);
             setOriginalInstanceNameEvo(response.data.instance_name);
             setIsEditingEvo(false);
             await checkStatus('evolution');
         } catch (err) {
             console.error("Erro handleSaveInstanceName:", err);
             setError(err.response?.data?.detail || 'Não foi possível guardar o nome da instância.');
             setInstanceNameEvo(originalInstanceNameEvo);
         } finally {
             setIsSaving(false);
         }
     };

     // --- Funções Específicas da API Oficial ---
     const handleSavePhoneNumberId = async () => {
          if (!wbpPhoneNumberId || !wbpPhoneNumberId.trim().match(/^\d+$/) || wbpPhoneNumberId.trim().length < 10) {
              alert('O ID do Número de Telefone deve conter apenas números e ter um comprimento razoável.');
              return;
          }
           if (apiType !== 'official') {
               alert("A API configurada não é a Oficial. Operação cancelada.");
               return;
           }
          setIsSaving(true);
          setError('');
          try {
              const payload = { wbp_phone_number_id: wbpPhoneNumberId.trim(), api_type: 'official' }; // Envia api_type
              const response = await api.post('/whatsapp/connection-info', payload);
              setUser(prevUser => ({ ...prevUser, ...response.data }));
              setWbpPhoneNumberId(response.data.wbp_phone_number_id);
              setOriginalWbpPhoneNumberId(response.data.wbp_phone_number_id);
              setIsEditingOfficial(false);
              // REMOVIDO: fetchOfficialConfigInfo() daqui
              await checkStatus('official');
          } catch (err) {
              console.error("Erro handleSavePhoneNumberId:", err);
              setError(err.response?.data?.detail || 'Não foi possível guardar o ID do número.');
              setWbpPhoneNumberId(originalWbpPhoneNumberId);
          } finally {
              setIsSaving(false);
          }
     };

     // REMOVIDO: handleSaveAccessToken

    // --- Funções Google ---
    const handleGoogleConnect = async () => { /* ... (código idêntico) ... */
        setIsGoogleLoading(true);
        try {
            const response = await api.get('/auth/google/login');
            window.location.href = response.data.auth_url;
        } catch (err) {
            alert('Não foi possível iniciar a conexão com o Google. Verifique o console.');
            console.error(err);
            setIsGoogleLoading(false);
        }
    };
    const handleGoogleDisconnect = async () => { /* ... (código idêntico) ... */
        if (window.confirm('Tem a certeza que deseja desconectar a sua conta Google?')) {
            setIsGoogleLoading(true);
            try {
                const response = await api.post('/auth/google/disconnect');
                setIsGoogleConnected(response.data.is_google_connected);
                alert('Conta Google desconectada.');
            } catch (err) {
                alert('Não foi possível desconectar o Google.');
                console.error(err);
            } finally {
                setIsGoogleLoading(false);
            }
        }
    };


    // --- Renderização ---
    if (loadingAuth) {
        return (
             <div className="p-10 flex justify-center items-center min-h-[400px]">
                 <Loader2 size={48} className="animate-spin text-blue-500" />
             </div>
        );
    }
     if (!user && !loadingAuth) {
         return (
              <div className="p-10 text-center">
                  <ServerCrash size={48} className="mx-auto text-red-500 mb-4"/>
                  <p className='text-red-600 mb-4'>{error || "Falha ao carregar dados do usuário. Tente fazer login novamente."}</p>
              </div>
         );
     }

    return (
        <div className="p-4 md:p-8 bg-gray-50 min-h-full">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-gray-800">Conexões</h1>
                <p className="text-gray-500 mt-1 text-sm">Faça a gestão da sua conexão do WhatsApp e Google Agenda.</p>
            </div>

            {/* --- REMOVIDO: Bloco "Indicador do Tipo de API Ativo" --- */}

            {/* --- Conteúdo Condicional --- */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-7xl mx-auto">
                {/* Coluna 1: WhatsApp */}
                <div className="bg-white p-5 rounded-xl shadow-md border border-gray-200">
                     <h2 className="text-lg font-semibold text-gray-700 mb-4 flex items-center gap-2">
                        {isEvolution ? <><Settings size={20} className="text-blue-600"/> Conexão Evolution API</>
                         : isOfficial ? <><Settings size={20} className="text-green-600"/> Configuração API Oficial</>
                         : <><HelpCircle size={20}/> Conexão WhatsApp</>}
                    </h2>

                    {/* Conteúdo Evolution */}
                    {isEvolution && (
                        <div className="space-y-4">
                            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                                <label htmlFor='instanceNameInput' className="block text-xs font-medium text-gray-600 mb-1">Nome da Instância</label>
                                <div className="flex items-center gap-2">
                                    <input
                                        id='instanceNameInput'
                                        type="text" value={instanceNameEvo} onChange={(e) => setInstanceNameEvo(e.target.value)} disabled={!isEditingEvo || isSaving}
                                        className="w-full px-3 py-1.5 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm disabled:bg-gray-100 disabled:text-gray-500"
                                        placeholder="ex: meu_atendimento"
                                    />
                                    { isEditingEvo ? (
                                        <button onClick={handleSaveInstanceName} disabled={isSaving || !instanceNameEvo.trim() || instanceNameEvo.trim().length < 3 || /\s/.test(instanceNameEvo.trim())} title="Salvar Nome" className="p-1.5 bg-green-500 text-white rounded-md hover:bg-green-600 disabled:opacity-50 shrink-0">
                                            {isSaving ? <Loader2 size={18} className='animate-spin'/> : <Save size={18}/>}
                                        </button>
                                    ) : (
                                        instanceNameEvo && !['connected', 'open', 'qrcode', 'loading', 'loading_qr', 'connecting', 'close'].includes(statusInfoEvo?.status) &&
                                        <button onClick={() => setIsEditingEvo(true)} disabled={isSaving || isChecking} title="Editar Nome" className="p-1.5 bg-gray-200 text-gray-600 rounded-md hover:bg-gray-300 shrink-0"><Edit size={18}/></button>
                                    )}
                                </div>
                                {isEditingEvo && <p className="text-xs text-gray-500 mt-1">Deve ser único, min 3 caracteres, sem espaços.</p>}
                            </div>
                            <StatusDisplayEvolution
                                statusInfo={statusInfoEvo}
                                qrCode={qrCodeEvo}
                                onConnect={handleConnectEvo}
                                onDisconnect={handleDisconnectEvo}
                                onRefresh={() => checkStatus('evolution')}
                                isChecking={isChecking}
                                error={error}
                                disabled={!instanceNameEvo || isEditingEvo || isSaving}
                            />
                        </div>
                    )}

                    {/* Conteúdo Oficial */}
                     {isOfficial && (
                        <div className="space-y-4">
                            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                                <label htmlFor='wbpIdInput' className="block text-xs font-medium text-gray-600 mb-1">ID do Número de Telefone (da Meta)</label>
                                <div className="flex items-center gap-2">
                                    <input
                                        id='wbpIdInput'
                                        type="text" value={wbpPhoneNumberId} onChange={(e) => setWbpPhoneNumberId(e.target.value)} disabled={!isEditingOfficial || isSaving}
                                        className="w-full px-3 py-1.5 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm disabled:bg-gray-100 disabled:text-gray-500"
                                        placeholder="Ex: 102030405060708"
                                    />
                                    { isEditingOfficial ? (
                                        <button onClick={handleSavePhoneNumberId} disabled={isSaving || !wbpPhoneNumberId.trim() || !wbpPhoneNumberId.trim().match(/^\d+$/)} title="Salvar ID" className="p-1.5 bg-green-500 text-white rounded-md hover:bg-green-600 disabled:opacity-50 shrink-0">
                                            {isSaving ? <Loader2 size={18} className='animate-spin'/> : <Save size={18}/>}
                                        </button>
                                    ) : (
                                        wbpPhoneNumberId &&
                                        <button onClick={() => setIsEditingOfficial(true)} disabled={isSaving || isChecking} title="Editar ID" className="p-1.5 bg-gray-200 text-gray-600 rounded-md hover:bg-gray-300 shrink-0"><Edit size={18}/></button>
                                    )}
                                </div>
                                {isEditingOfficial && <p className="text-xs text-gray-500 mt-1">Encontre este ID no painel do seu app na Meta.</p>}
                            </div>
                           <StatusDisplayOfficial
                               statusInfo={statusInfoOfficial}
                               onRefresh={() => checkStatus('official')}
                               isChecking={isChecking}
                               error={error}
                               // REMOVIDO: onSaveToken e isSavingToken
                           />
                        </div>
                     )}

                     {/* Mensagem se nenhum tipo estiver definido */}
                     {!apiType && !loadingAuth && (
                         <div className="p-6 text-center text-gray-500 border-2 border-dashed border-gray-300 rounded-lg">
                              <HelpCircle size={40} className="mx-auto mb-3 text-gray-400"/>
                              Nenhum tipo de API WhatsApp configurado para este usuário.
                              <p className="text-sm mt-1">Contate o administrador para definir o modo de operação.</p>
                         </div>
                     )}

                     {/* Mensagem de erro GERAL */}
                     {error && (
                          <div className="mt-4 p-3 bg-red-100 border border-red-300 text-red-800 text-sm rounded-md">
                               {error}
                          </div>
                     )}
                </div>

                {/* Coluna 2: Google e Infos */}
                 <div className="space-y-6">
                     <div className="bg-white p-5 rounded-xl shadow-md border border-gray-200">
                          <h2 className="text-lg font-semibold text-gray-700 mb-4">Conexão Google Agenda</h2>
                         <GoogleConnect
                             isConnected={isGoogleConnected}
                             isLoading={isGoogleLoading}
                             onConnect={handleGoogleConnect}
                             onDisconnect={handleGoogleDisconnect}
                         />
                     </div>
                     <div className="bg-white p-5 rounded-xl shadow-md border border-gray-200">
                         <h3 className="flex items-center text-md font-semibold text-gray-700 mb-3">
                             <Info size={18} className="mr-2 text-blue-500 flex-shrink-0" />
                             Informações Importantes
                         </h3>
                         {/* --- Textos simplificados --- */}
                         <ul className="list-disc list-inside space-y-3 text-sm text-gray-600 pl-2">
                             <li>
                                 <strong>Tipos de Conexão:</strong> Seu AtendAI pode usar a API Oficial (paga, estável) ou a Evolution API (gratuita*, com riscos). O tipo ativo é definido pelo administrador.
                             </li>
                             {isEvolution && (
                                 <li>
                                     <strong>Google Agenda (Evolution):</strong> Conectar sua agenda ajuda a evitar bloqueios no WhatsApp ao usar a Evolution API. É muito recomendado!
                                 </li>
                             )}
                             {isOfficial && (
                                  <>
                                      <li>
                                           <strong>Configuração API Oficial:</strong> Você precisa ter uma conta de desenvolvedor na Meta (Facebook), criar um aplicativo, adicionar o WhatsApp e obter o ID do Número e um Token de Acesso (configurado pelo administrador).
                                      </li>
                                       <li>
                                            <strong>Custos API Oficial:</strong> Lembre-se que a Meta cobra por cada conversa iniciada após 24 horas. Verifique os preços no site deles.
                                       </li>
                                  </>
                             )}
                             <li>
                                 <strong>Tokens AtendAI:</strong> A Inteligência Artificial consome créditos (tokens) da sua conta AtendAI ao analisar e responder mensagens, não importa qual API do WhatsApp você usa.
                             </li>
                             <li>
                                 <strong>Conta Google:</strong> Se conectar a agenda, use a mesma conta Google do seu celular para que os contatos sejam sincronizados corretamente no seu WhatsApp.
                             </li>
                             <li>
                                {/* --- CORRIGIDO: Escapando o caractere '>' --- */}
                                 <strong>Sincronização de Contatos:</strong> Verifique nas configurações do seu celular (Contas {'>'} Google) se a sincronização de contatos está ativada.
                                {/* ---------------------------------------- */}
                             </li>
                         </ul>
                     </div>
                </div>
            </div>
        </div>
    );
}

export default Whatsapp;

