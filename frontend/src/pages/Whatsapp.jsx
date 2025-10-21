import React, { useState, useEffect, useCallback } from 'react';
import api from '../api/axiosConfig';
import QRCode from 'qrcode.react';
import { 
    Wifi, WifiOff, Loader2, ServerCrash, LogOut, Save, Edit, 
    AlertCircle, ScanLine, RefreshCw, Link as LinkIcon, CheckCircle, 
    PowerOff, Info
} from 'lucide-react';

/**
 * Componente para exibir o estado da conexão do WhatsApp.
 */
const StatusDisplay = ({ statusInfo, qrCode, onConnect, onDisconnect, onRefresh, isChecking, error, disabled }) => {
    // (Este componente permanece sem alterações)
    const showRefreshButton = !['loading', 'loading_qr', 'connected', 'open'].includes(statusInfo.status);

    const getContainerClasses = () => {
        const baseClasses = 'text-center p-8 border-2 border-dashed rounded-lg transition-colors duration-300';
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
                        <Wifi size={64} className="mx-auto text-green-500 mb-4" />
                        <h2 className="text-2xl font-bold text-green-800">Conectado</h2>
                        <p className="text-gray-600 mt-2">A sua instância está online e pronta para operar.</p>
                        <button onClick={onDisconnect} className="mt-6 flex items-center gap-2 mx-auto bg-red-500 text-white font-semibold py-2 px-4 rounded-lg shadow-md hover:bg-red-600 transition-all">
                            <LogOut size={18} /> Desconectar
                        </button>
                    </div>
                );
            case 'loading':
            case 'loading_qr':
                return <div><Loader2 size={64} className="mx-auto text-brand-blue animate-spin mb-4" /><p className="text-gray-600">{statusInfo.status === 'loading_qr' ? 'A gerar QR Code...' : 'A verificar...'}</p></div>;
            case 'connecting':
            case 'close':
            case 'qrcode':
                return <div><ScanLine size={32} className="mx-auto text-brand-blue mb-2" /><h2 className="text-2xl font-bold text-gray-800 mb-4">Leia o QR Code para Conectar</h2><div className="p-4 bg-white inline-block rounded-lg shadow-inner">{qrCode ? <QRCode value={qrCode} size={256} /> : <Loader2 size={64} className="animate-spin text-brand-blue" />}</div><p className="text-gray-600 mt-4">Abra o WhatsApp no seu telemóvel e leia o código.</p></div>;
            case 'error':
            case 'api_error':
                return <div><ServerCrash size={64} className="mx-auto text-red-500 mb-4" /><h2 className="text-2xl font-bold text-red-800">Erro</h2><p className="text-red-700 mt-2">{error}</p></div>;
            case 'no_instance_name':
                return <div><AlertCircle size={48} className="mx-auto text-amber-500 mb-4" /><h2 className="text-2xl font-bold text-amber-800">Ação Necessária</h2><p className="text-amber-700 mt-2">Guarde um nome para a sua instância para continuar.</p></div>;
            default:
                return <div><WifiOff size={64} className="mx-auto text-gray-400 mb-4" /><h2 className="text-2xl font-bold text-gray-800">Desconectado</h2><p className="text-gray-600 mt-2">A sua sessão do WhatsApp não está ativa.</p><button onClick={onConnect} disabled={disabled} className="mt-6 flex items-center gap-2 mx-auto bg-brand-blue text-white font-semibold py-2 px-4 rounded-lg shadow-md hover:bg-brand-blue-dark transition-all disabled:bg-gray-400">Conectar</button></div>;
        }
    };

    return (
        <div>
            <div className={`min-h-[350px] flex items-center justify-center ${getContainerClasses()}`}>
                {renderContent()}
            </div>
            {showRefreshButton && (
                <div className="border-t border-gray-200 pt-4 mt-4 text-center">
                    <button onClick={onRefresh} disabled={isChecking} className="flex items-center justify-center gap-2 mx-auto text-sm text-gray-500 hover:text-brand-blue font-semibold disabled:opacity-50">
                        {isChecking ? <><Loader2 size={16} className="animate-spin" /> A verificar...</> : <><RefreshCw size={16} /> Atualizar Estado</>}
                    </button>
                </div>
            )}
        </div>
    );
};

const GoogleConnect = ({ isConnected, onConnect, onDisconnect, isLoading }) => {
    // (Este componente permanece sem alterações)
    return (
        <div className="bg-gray-100 p-4 rounded-lg border border-gray-200">
            <label className="block text-sm font-medium text-gray-600 mb-2">Conexão Google Agenda</label>
            <p className="text-xs text-gray-500 mb-3">Conecte sua conta Google para salvar novos contatos automaticamente.</p>
            {isLoading ? (
                <div className="flex items-center justify-center text-gray-500">
                    <Loader2 size={20} className="animate-spin mr-2" />
                    A processar...
                </div>
            ) : isConnected ? (
                <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-green-700 font-medium">
                        <CheckCircle size={20} /> Conectado
                    </span>
                    <button onClick={onDisconnect} title="Desconectar" className="p-2 bg-red-100 text-red-600 rounded-md hover:bg-red-200"><PowerOff size={20}/></button>
                </div>
            ) : (
                <button onClick={onConnect} className="w-full flex items-center justify-center gap-2 bg-blue-500 text-white font-semibold py-2 px-4 rounded-lg shadow-md hover:bg-blue-600 transition-all"><LinkIcon size={18} /> Conectar com Google</button>
            )}
        </div>
    );
};


function Whatsapp() {
    const [statusInfo, setStatusInfo] = useState({ status: 'loading' });
    const [qrCode, setQrCode] = useState('');
    const [error, setError] = useState('');
    const [instanceName, setInstanceName] = useState('');
    const [isEditing, setIsEditing] = useState(false);
    const [isChecking, setIsChecking] = useState(false);
    const [isGoogleConnected, setIsGoogleConnected] = useState(false);
    const [isGoogleLoading, setIsGoogleLoading] = useState(false);
    
    // --- LÓGICA DE CALLBACK DO GOOGLE ATUALIZADA ---
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const googleAuthStatus = params.get('google_auth');

        if (googleAuthStatus) {
            // Limpa a URL para evitar que o alerta apareça novamente ao recarregar
            window.history.replaceState({}, document.title, window.location.pathname); 

            if (googleAuthStatus === 'success') {
                alert('Conta Google conectada com sucesso!');
                setIsGoogleConnected(true); // Atualiza o estado visual imediatamente
            } else {
                // Mapeia os erros para mensagens amigáveis
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

    const checkStatus = useCallback(async () => {
        // (sem alterações)
        if (!instanceName || isChecking) return;
        setIsChecking(true);
        setError('');
        try {
            const response = await api.get('/whatsapp/status');
            const newStatus = response.data.status;
            if (['close', 'connecting'].includes(newStatus)) {
                await handleConnect();
            } else {
                setStatusInfo(response.data);
                setQrCode('');
            }
        } catch {
            setStatusInfo({ status: 'error' });
            setError('Não foi possível verificar o estado.');
        } finally {
            setIsChecking(false);
        }
    }, [instanceName, isChecking]);
    
    useEffect(() => {
        const init = async () => {
            try {
                const res = await api.get('/auth/me');
                const userData = res.data;
                setInstanceName(userData.instance_name || '');
                setIsGoogleConnected(userData.is_google_connected);
                if (!userData.instance_name) {
                    setIsEditing(true);
                    setStatusInfo({ status: 'no_instance_name' });
                }
            } catch {
                setError("Não foi possível procurar as configurações.");
                setStatusInfo({ status: 'error' });
            }
        };
        init();
    }, []);
    
    useEffect(() => {
        if (instanceName && !isEditing) {
            checkStatus();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [instanceName, isEditing]);
    
    const handleConnect = useCallback(async () => {
        // (sem alterações)
        if (isChecking) return;
        setIsChecking(true);
        setStatusInfo({ status: 'loading_qr' });
        try {
            const response = await api.get('/whatsapp/connect');
            const instanceData = response.data.instance;
            if (response.data.status === 'qrcode' && instanceData && instanceData.qrcode) {
                setQrCode(instanceData.qrcode);
                setStatusInfo({ status: 'qrcode' });
            } else {
                setStatusInfo(response.data.instance ? { status: response.data.instance.state } : { status: 'disconnected' });
            }
        } catch (err) {
            setError('Erro ao tentar conectar.');
            setStatusInfo({ status: 'error' });
        } finally {
            setIsChecking(false);
        }
    }, [isChecking]);

    const handleDisconnect = async () => {
        // (sem alterações)
        if (window.confirm('Tem a certeza que deseja desconectar e apagar a instância?')) {
            setIsChecking(true);
            try {
                await api.post('/whatsapp/disconnect');
                setQrCode('');
                await checkStatus();
            } catch (err) {
                alert('Não foi possível desconectar a instância.');
            } finally {
                setIsChecking(false);
            }
        }
    };
        
    const handleSaveInstanceName = async () => {
        // (sem alterações)
        if (!instanceName || instanceName.trim().length < 3) {
            alert('O nome da instância deve ter pelo menos 3 caracteres.');
            return;
        }
        setIsChecking(true);
        try {
            await api.post('/whatsapp/instance', { instance_name: instanceName });
            setIsEditing(false);
        } catch (err) {
            setError('Não foi possível guardar o nome da instância.');
        } finally {
            setIsChecking(false);
        }
    };

    const handleGoogleConnect = async () => {
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

    const handleGoogleDisconnect = async () => {
        if (window.confirm('Tem a certeza que deseja desconectar a sua conta Google?')) {
            setIsGoogleLoading(true);
            try {
                const response = await api.post('/auth/google/disconnect');
                setIsGoogleConnected(response.data.is_google_connected);
                alert('Conta Google desconectada.');
            } catch (err) {
                alert('Não foi possível desconectar o Google.');
            } finally {
                setIsGoogleLoading(false);
            }
        }
    };
    
    return (
        <div className="p-6 md:p-10 bg-gray-50 min-h-full">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-gray-800">Conexões</h1>
                <p className="text-gray-500 mt-1">Faça a gestão das suas conexões do WhatsApp e Google.</p>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-7xl mx-auto">
                {/* --- Coluna 1: Conexão WhatsApp --- */}
                <div className="bg-white p-6 rounded-xl shadow-md border border-gray-200">
                    <h2 className="text-xl font-semibold text-gray-700 mb-4">Conexão WhatsApp</h2>
                    <div className="mb-6 p-4 bg-gray-100 rounded-lg border border-gray-200">
                        <label className="block text-sm font-medium text-gray-600 mb-2">Nome da Instância</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="text" value={instanceName} onChange={(e) => setInstanceName(e.target.value)} disabled={!isEditing}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-blue disabled:bg-gray-200 disabled:text-gray-500"
                                placeholder="ex: meu-atendimento"
                            />
                            {statusInfo.status !== 'connected' && statusInfo.status !== 'open' && (
                                isEditing ? (
                                    <button onClick={handleSaveInstanceName} title="Salvar" className="p-2 bg-green-500 text-white rounded-md hover:bg-green-600"><Save size={20}/></button>
                                ) : (
                                    <button onClick={() => setIsEditing(true)} title="Editar" className="p-2 bg-gray-200 text-gray-600 rounded-md hover:bg-gray-300"><Edit size={20}/></button>
                                )
                            )}
                        </div>
                        {isEditing && <p className="text-xs text-gray-500 mt-1">O nome deve ser único e sem espaços.</p>}
                    </div>
                    <StatusDisplay 
                        statusInfo={statusInfo} 
                        qrCode={qrCode} 
                        onConnect={handleConnect} 
                        onDisconnect={handleDisconnect} 
                        onRefresh={checkStatus}
                        isChecking={isChecking}
                        error={error} 
                        disabled={!instanceName || isEditing}
                    />
                </div>

                {/* --- Coluna 2: Conexão Google --- */}
                <div className="bg-white p-6 rounded-xl shadow-md border border-gray-200">
                    <h2 className="text-xl font-semibold text-gray-700 mb-4">Conexão Google Agenda</h2>
                    <GoogleConnect
                        isConnected={isGoogleConnected}
                        isLoading={isGoogleLoading}
                        onConnect={handleGoogleConnect}
                        onDisconnect={handleGoogleDisconnect}
                    />
                    <div className="mt-6 border-t border-gray-200 pt-4">
                        <h3 className="flex items-center text-md font-semibold text-gray-700 mb-3">
                            <Info size={18} className="mr-2 text-blue-500 flex-shrink-0" />
                            Informações Importantes
                        </h3>
                        <ul className="list-disc list-inside space-y-3 text-sm text-gray-600 pl-2">
                            <li>
                                <strong>Evite Bloqueios:</strong> Salvar novos contatos na sua agenda antes de interagir ajuda a sinalizar ao WhatsApp que a conversa é legítima, diminuindo riscos.
                            </li>
                            <li>
                                <strong>Conta Correta:</strong> Utilize a mesma conta Google que está configurada no seu telemóvel para sincronizar os contatos que aparecem no seu WhatsApp.
                            </li>
                            <li>
                                <strong>Sincronização Ativa:</strong> No seu Celular, vá em Definições &gt; Contas &gt; Google e garanta que a opção "Sincronizar Contatos Automaticamente" está ativada para que os novos contatos apareçam.
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Whatsapp;

