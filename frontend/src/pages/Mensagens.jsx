import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api/axiosConfig'; // Presumindo que você tenha este arquivo de configuração do Axios
import {
    Search, MessageSquareText, CheckCircle, Clock, UserCheck, Paperclip, Mic, Send, Image as ImageIcon, FileText, CircleDashed, ChevronDown,
    Play, Download, Loader2, StopCircle, Trash2, AlertTriangle // Ícones adicionados
} from 'lucide-react';
import { format } from 'date-fns';

// --- NOVO Componente: Modal de Mídia ---
const MediaModal = ({ isOpen, onClose, mediaUrl, mediaType, filename }) => {
    // Log para verificar props recebidas
    console.log("[MediaModal] Rendering. isOpen:", isOpen, "mediaUrl:", mediaUrl, "mediaType:", mediaType);

    // Efeito para logar quando a URL muda
    useEffect(() => {
        console.log("[MediaModal] mediaUrl prop changed:", mediaUrl);
    }, [mediaUrl]);

    if (!isOpen || !mediaUrl) {
        // Se não deve estar aberto ou não tem URL, não renderiza nada
        if (isOpen && !mediaUrl) {
            console.warn("[MediaModal] Modal is open but mediaUrl is missing!");
        }
        return null;
    }

    // Função para forçar download
    const handleDownload = async () => {
        try {
            // Usa a Blob URL diretamente para criar o link de download
            console.log("[MediaModal] handleDownload triggered for URL:", mediaUrl);
            const link = document.createElement('a');
            link.href = mediaUrl; // Usa a Blob URL passada como prop
            link.download = filename || (mediaType === 'audio' ? 'audio.ogg' : 'imagem');
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            // NÃO revogue a URL aqui, pois ela ainda está sendo usada pelo src da tag img/audio
            // A revogação deve ocorrer APENAS quando o modal fechar (na função `closeModal`)
        } catch (error) {
            console.error("[MediaModal] Erro ao tentar baixar via link:", error);
            alert("Não foi possível iniciar o download do arquivo.");
        }
    };


    return (
        <div
            className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-lg p-4 max-w-3xl max-h-[80vh] overflow-auto relative"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Botão Fechar */}
                <button
                    onClick={onClose}
                    className="absolute top-2 right-2 text-gray-600 hover:text-black z-10"
                    title="Fechar"
                >
                    {/* SVG X */}
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                {/* Conteúdo da Mídia */}
                {mediaType === 'image' && (
                    <img
                        src={mediaUrl}
                        alt={filename || 'Imagem'}
                        className="max-w-full max-h-[70vh] object-contain mx-auto"
                        // Adiciona log de erro específico da imagem
                        onError={(e) => console.error("[MediaModal] Erro ao carregar tag <img>. SRC:", e.target.src)}
                    />
                )}
                {mediaType === 'audio' && (
                    <div className="flex flex-col items-center space-y-3 p-4">
                        <p className="text-sm text-gray-600">{filename || 'Áudio'}</p>
                        <audio
                            src={mediaUrl}
                            controls
                            className="w-full"
                            // Adiciona log de erro específico do áudio
                            onError={(e) => console.error("[MediaModal] Erro ao carregar tag <audio>. SRC:", e.target.src, "Error Code:", e.target.error?.code)}
                        />
                        {/* Botão de download explícito */}
                        <button
                            onClick={handleDownload}
                            className="mt-2 px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 flex items-center gap-1"
                        >
                            <Download size={16} /> Baixar Áudio
                        </button>
                    </div>
                )}

                {/* Botão de download para imagem */}
                {mediaType === 'image' && (
                    <div className="text-center mt-3">
                        <button
                            onClick={handleDownload}
                            className="px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 flex items-center gap-1 mx-auto"
                        >
                            <Download size={16} /> Baixar Imagem
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

// --- Componente: Barra de Busca e Filtros ---
const SearchAndFilter = ({ searchTerm, setSearchTerm, activeFilter, setActiveFilter, currentUserApiType }) => (
    <div className="flex-shrink-0 p-3 bg-white border-b border-gray-200 space-y-3">
        {/* Barra de Busca */}
        <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
                type="text"
                placeholder="Pesquisar ou começar uma nova conversa"
                className="w-full pl-10 pr-4 py-2 bg-[#f0f2f5] border border-transparent rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300 text-sm"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
            />
        </div>

        {/* Filtros */}
        <div className="flex gap-2">
            {[
                { key: 'Atendente Chamado', label: 'Atendente Chamado' },
                { key: 'Concluído', label: 'Concluído' },
            ].filter(Boolean)
                .map((filter) => (
                    <button
                        key={filter.key}
                        onClick={() => setActiveFilter(filter.key === activeFilter ? 'todos' : filter.key)}
                        className={`px-3 py-1 text-sm rounded-full transition-all ${activeFilter === filter.key
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                    >
                        {filter.label}
                    </button>
                ))}
        </div>
    </div>
);

// --- Componente: Item de Contato na Lista ---
const ContactItem = ({ atendimento, isSelected, onSelect }) => {
    let lastMessage = 'Nenhum histórico de conversa.';
    let lastMessageTime = atendimento.updated_at;

    try {
        const conversa = JSON.parse(atendimento.conversa || '[]');
        if (conversa.length > 0) {
            const lastMsgObj = conversa[conversa.length - 1];

            // --- LÓGICA ATUALIZADA PARA TIPO DE MENSAGEM ---
            const msgType = lastMsgObj.type || 'text'; // 'text' é o padrão
            if (msgType === 'image') {
                lastMessage = lastMsgObj.content ? `[Imagem] ${lastMsgObj.content}` : '[Imagem]';
            } else if (msgType === 'audio') {
                lastMessage = '[Mensagem de áudio]';
            } else if (msgType === 'document') {
                lastMessage = `[Documento] ${lastMsgObj.filename || 'arquivo'}`;
            } else {
                lastMessage = lastMsgObj.content || '[Mídia]'; // Fallback
            }
            // ---------------------------------------------

            if (lastMsgObj.role === 'assistant') {
                lastMessage = `Você: ${lastMessage}`;
            }

            if (typeof lastMsgObj.timestamp === 'number') {
                lastMessageTime = new Date(lastMsgObj.timestamp * 1000);
            } else if (lastMsgObj.timestamp) {
                lastMessageTime = new Date(lastMsgObj.timestamp);
            }
        }
    } catch (e) {
        console.error("Erro ao parsear conversa no ContactItem:", e);
    }

    const formatTimestamp = (dateStr) => {
        try {
            const date = new Date(dateStr);
            const now = new Date();
            if (format(date, 'yyyy-MM-dd') === format(now, 'yyyy-MM-dd')) {
                return format(date, 'HH:mm');
            }
            return format(date, 'dd/MM/yy');
        } catch {
            return '...';
        }
    };

    return (
        <div
            className={`flex items-center p-3 cursor-pointer transition-colors ${isSelected ? 'bg-gray-200' : 'bg-white hover:bg-gray-50'
                }`}
            onClick={() => onSelect(atendimento)}
        >
            <img
                className="w-12 h-12 rounded-full mr-3 flex-shrink-0 mt-3"
                src={`https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSTip18a5vyLJJXYZgGE44WTFaislpkAcvQURSqLik0tsv8DuPggkyib-NrlShXqM2mO9k&usqp=CAU`}
                alt="Avatar"
            />
            <div className="flex-1 min-w-0 border-gray-100 pt-3">
                <div className="flex justify-between items-center mb-1">
                    <h3 className="text-md font-semibold text-gray-800 truncate">{atendimento.contact.whatsapp}</h3>
                    <span className="text-xs text-blue-600 font-medium">
                        {formatTimestamp(lastMessageTime)}
                    </span>
                </div>
                <p className="text-sm text-gray-500 truncate">{lastMessage}</p>
            </div>
        </div>
    );
};

// --- SUB-COMPONENTE: Conteúdo da Mensagem (MODIFICADO PARA BOTÕES) ---
const MessageContent = ({ msg, atendimentoId, onViewMedia, isDownloading }) => {
    // Props adicionadas: onViewMedia, isDownloading

    // --- FUNÇÃO PARA GERAR URL DE DOWNLOAD ---
    const getDownloadUrl = (mediaId) => {
        // Certifique-se que a base da URL está correta para sua API
        return `/api/v1/atendimentos/${atendimentoId}/media/${mediaId}`;
    };
    // ----------------------------------------

    // --- NOVA VERIFICAÇÃO DE ERRO ---
    // Verifica se a mensagem tem um status de 'failed'/'error' vindo do backend (via webhook)
    // OU se o tipo local é 'error' (para falhas de envio imediatas no frontend)
    if (msg.status === 'failed' || msg.status === 'error' || msg.type === 'error') {

        // Tenta montar uma mensagem de erro descritiva
        let errorMessage = 'Falha no envio'; // Padrão
        if (msg.error_title) {
            errorMessage = msg.error_title; // Erro do WBP (ex: 'Re-engagement message')
        } else if (msg.content) {
            errorMessage = msg.content; // Erro do frontend (ex: 'Falha ao enviar mensagem.')
        }

        const errorCode = msg.error_code ? ` (Cód: ${msg.error_code})` : '';

        return (
            <div className="flex items-center gap-2 text-red-600">
                <AlertTriangle size={16} />
                <span className="text-sm">
                    {errorMessage}{errorCode}

                    {/* Se a falha foi em uma mensagem que *tinha* conteúdo, mostra abaixo */}
                    {msg.type !== 'error' && msg.content && (
                        <p className="text-xs text-gray-500 italic mt-1">Mensagem original: "{msg.content}"</p>
                    )}
                </span>
            </div>
        );
    }
    // --- FIM DA NOVA VERIFICAÇÃO ---


    // Se não for um erro, continua a renderização normal
    const type = msg.type || 'text';
    const hasMedia = msg.media_id && ['image', 'audio', 'document'].includes(type);

    // Texto a ser exibido (transcrição, análise ou mensagem original)
    // Mostra um placeholder se for mídia sem conteúdo textual ainda
    const displayText = msg.content || (hasMedia ? `[${type === 'image' ? 'Imagem' : type === 'audio' ? 'Áudio' : 'Documento'}${msg.filename ? `: ${msg.filename}` : ''}]` : '');

    // Texto do botão
    let buttonText = '';
    if (type === 'image') buttonText = 'Ver Imagem';
    else if (type === 'audio') buttonText = 'Ouvir Áudio';
    else if (type === 'document') buttonText = 'Baixar Documento';

    // URL de download direto (só para documentos por enquanto)
    const directDownloadUrl = (type === 'document' && msg.media_id)
        ? getDownloadUrl(msg.media_id)
        : '#';


    // Lógica principal de renderização
    switch (type) {
        case 'image':
        case 'audio':
        case 'document':
            return (
                <div className="space-y-1">
                    {/* Sempre exibe o texto */}
                    {displayText && (
                        <p className="whitespace-pre-wrap text-sm">{displayText}</p>
                    )}

                    {/* Exibe o botão se tiver media_id */}
                    {hasMedia && (
                        <div className="mt-1">
                            {type === 'document' ? (
                                // Documento usa link direto
                                <a
                                    href={directDownloadUrl}
                                    download={msg.filename || 'documento'} // Usa o filename salvo no DB
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 ${isDownloading ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    // Desabilitado visualmente se outro download estiver ocorrendo
                                    onClick={(e) => { if (isDownloading) e.preventDefault(); }}
                                >
                                    {isDownloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                                    {buttonText}
                                </a>
                            ) : (
                                // Imagem e Áudio usam botão que chama onViewMedia (abre modal)
                                <button
                                    type="button"
                                    onClick={() => onViewMedia(msg.media_id, msg.type, msg.filename)}
                                    disabled={isDownloading}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isDownloading ? <Loader2 size={14} className="animate-spin" /> : (type === 'image' ? <ImageIcon size={14} /> : <Play size={14} />)}
                                    {buttonText}
                                </button>
                            )}
                        </div>
                    )}
                </div>
            );

        case 'sending':
            return (
                <div className="flex items-center gap-2 italic text-gray-500">
                    <Loader2 size={16} className="animate-spin" />
                    {/* Mostra preview se for imagem */}
                    {msg.localUrl && msg.filename?.match(/\.(jpeg|jpg|png|webp)$/i) && (
                        <img src={msg.localUrl} alt="preview" className="w-10 h-10 object-cover rounded mr-1" />
                    )}
                    {/* Preview para audio local */}
                    {msg.localUrl && type === 'audio' && (
                        <audio src={msg.localUrl} controls className="h-8 w-40" />
                    )}
                    <span>{msg.content || `Enviando ${msg.filename || 'mídia'}...`}</span>
                </div>
            );

        // O 'case: error' foi removido daqui pois agora é tratado no início do componente

        case 'text':
        default: // Inclui 'unknown' e outros tipos não tratados
            // Se tiver 'content', mostra. Se não, indica tipo desconhecido se houver media_id
            const defaultText = msg.content || (msg.media_id ? `[Mídia tipo '${type}' não suportada]` : '');
            return (
                <p className="whitespace-pre-wrap text-sm">{defaultText || '[Mensagem vazia]'}</p>
            );
    }
}

// --- Componente: Corpo da Conversa (Mensagens) ---
const ChatBody = ({ atendimento, onViewMedia, isDownloadingMedia }) => {
    const chatContainerRef = useRef(null);
    const [messages, setMessages] = useState([]);

    // --- NOVO: Ref para guardar o ID do atendimento anterior ---
    const prevAtendimentoIdRef = useRef(null);
    // --- NOVO: Ref para saber se o usuário estava no final do scroll antes da atualização ---
    const userWasAtBottomRef = useRef(true);

    useEffect(() => {
        let parsedMessages = [];
        try {
            parsedMessages = atendimento ? JSON.parse(atendimento.conversa || '[]') : [];
        } catch (e) {
            console.error("Erro ao analisar JSON da conversa:", e);
        }

        // --- NOVO: Lógica para verificar a posição do scroll ANTES de atualizar as mensagens ---
        const chatElement = chatContainerRef.current;
        if (chatElement) {
            const { scrollTop, scrollHeight, clientHeight } = chatElement;
            // Considera "no fundo" se estiver a 50px do final.
            // Isso garante que o scroll automático funcione mesmo se houver uma pequena margem.
            userWasAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 50;
        } else {
            // Se o chatElement ainda não existe (primeira renderização),
            // assuma que queremos rolar para o final.
            userWasAtBottomRef.current = true;
        }
        // --- FIM DA NOVA LÓGICA ---

        setMessages(parsedMessages);
    }, [atendimento]); // Este hook ainda depende apenas de 'atendimento'

    // --- ALTERADO: useEffect de Scroll ---
    useEffect(() => {
        const chatElement = chatContainerRef.current;
        if (chatElement) {
            const currentAtendimentoId = atendimento?.id;
            const prevAtendimentoId = prevAtendimentoIdRef.current;

            // Condições para rolar para o final:
            // 1. O usuário mudou de chat (ID do atendimento é diferente)
            // 2. O usuário JÁ ESTAVA no final do scroll (e as mensagens mudaram)
            const shouldScroll =
                currentAtendimentoId !== prevAtendimentoId ||
                userWasAtBottomRef.current;

            if (shouldScroll) {
                chatElement.scrollTop = chatElement.scrollHeight;
            }

            // Atualiza a ref de ID para a próxima renderização
            prevAtendimentoIdRef.current = currentAtendimentoId;
        }
    }, [messages, atendimento?.id]); // Depende de 'messages' E do 'atendimento.id'

    const formatTimestamp = (timestamp) => {
        try {
            const date = (typeof timestamp === 'number') ? new Date(timestamp * 1000) : new Date(timestamp);
            return format(date, 'HH:mm');
        } catch {
            return '';
        }
    }

    return (
        <div
            ref={chatContainerRef}
            className="flex-1 p-4 md:p-6 overflow-y-auto space-y-3 bg-gray-100"
            style={{
                backgroundImage: `
                linear-gradient(rgba(173, 216, 230, 0.6), rgba(173, 216, 230, 0.9)),
                url('https://static.vecteezy.com/system/resources/previews/021/736/713/non_2x/doodle-lines-arrows-circles-and-curves-hand-drawn-design-elements-isolated-on-white-background-for-infographic-illustration-vector.jpg')
                `,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundBlendMode: 'overlay'
            }}
        >
            {messages.map((msg) => {
                const isAssistant = msg.role === 'assistant';
                return (
                    <div key={msg.id} className={`flex ${isAssistant ? 'justify-end' : 'justify-start'}`}>
                        <div
                            className={`relative max-w-xs md:max-w-md py-2 px-3 rounded-lg shadow-sm break-words ${isAssistant
                                ? 'bg-[#d9fdd3] text-gray-800' // Verde WhatsApp
                                : 'bg-white text-gray-800'
                                }`}
                        >
                            <MessageContent
                                msg={msg}
                                atendimentoId={atendimento.id}
                                onViewMedia={onViewMedia}
                                isDownloading={isDownloadingMedia} // Passa o estado de loading
                            />

                            <span className="text-xs text-gray-400 float-right ml-2 mt-1">
                                {formatTimestamp(msg.timestamp)}
                            </span>
                        </div>
                    </div>
                );
            })}
            {messages.length === 0 && (
                <div className="flex items-center justify-center h-full">
                    <p className="text-center text-gray-600 bg-white/70 backdrop-blur-sm p-3 rounded-lg italic">
                        Nenhuma mensagem neste atendimento.
                    </p>
                </div>
            )}
        </div>
    );
};

const ChatFooter = ({ onSendMessage, onSendMedia }) => {
    const [text, setText] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [showAttachMenu, setShowAttachMenu] = useState(false);

    // --- Novos estados para mídia ---
    const [isRecording, setIsRecording] = useState(false);
    const [isSendingMedia, setIsSendingMedia] = useState(false); // Trava o input
    const [recordingTime, setRecordingTime] = useState(0);

    // --- Refs ---
    const mediaRecorderRef = useRef(null);
    const audioChunksRef = useRef([]);
    const recordingIntervalRef = useRef(null);
    const recordingMimeTypeRef = useRef('audio/webm'); // Guarda o tipo usado

    // Refs para os inputs de arquivo
    const imageInputRef = useRef(null);
    const docInputRef = useRef(null);

    // --- Lógica de Gravação de Áudio (MODIFICADA) ---
    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // --- INÍCIO DA CORREÇÃO ---
            // Tenta os formatos aceitos pela WBP primeiro
            const mimeTypes = [
                'audio/ogg; codecs=opus', // Ideal
                'audio/opus',             // Aceito
                'audio/ogg',              // Aceito
                'audio/mp3',              // Aceito
                'audio/webm; codecs=opus' // Fallback (não para WBP, mas para Evo)
            ];
            // Encontra o primeiro tipo que o navegador suporta
            const supportedType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type));

            if (!supportedType) {
                alert("Seu navegador não suporta a gravação de áudio em um formato compatível (OGG, Opus ou MP3).");
                console.error("Nenhum tipo de MIME suportado para gravação de áudio.");
                return;
            }

            console.log("Iniciando gravação com MIME Type:", supportedType);
            recordingMimeTypeRef.current = supportedType; // Salva o tipo

            mediaRecorderRef.current = new MediaRecorder(stream, { mimeType: supportedType });
            // --- FIM DA CORREÇÃO ---

            audioChunksRef.current = []; // Limpa chunks antigos

            mediaRecorderRef.current.ondataavailable = (event) => {
                audioChunksRef.current.push(event.data);
            };

            mediaRecorderRef.current.onstop = () => {
                // Para o timer
                clearInterval(recordingIntervalRef.current);
                setRecordingTime(0);

                // --- INÍCIO DA CORREÇÃO ---
                let targetMimeType = 'audio/ogg'; // O tipo que a WBP aceita
                let targetExtension = '.ogg';

                // Pega o tipo que o navegador *realmente* gravou
                const recordedMimeType = recordingMimeTypeRef.current;

                if (recordedMimeType.includes('opus') || recordedMimeType.includes('ogg')) {
                    targetMimeType = 'audio/ogg'; // WBP aceita 'audio/ogg'
                    targetExtension = '.ogg';
                } else if (recordedMimeType.includes('mp3')) {
                    targetMimeType = 'audio/mpeg'; // Mimetype de MP3
                    targetExtension = '.mp3';
                } else {
                    // Fallback se o navegador gravou algo inesperado
                    console.warn(`Tipo gravado não otimizado: ${recordedMimeType}. Enviando como .ogg`);
                    targetMimeType = 'audio/ogg';
                    targetExtension = '.ogg';
                }

                console.log(`Gravação concluída. Tipo gravado: ${recordedMimeType}. Tipo de envio (Blob): ${targetMimeType}`);

                // FORÇA o blob a ter o tipo que a WBP aceita
                const audioBlob = new Blob(audioChunksRef.current, { type: targetMimeType });
                const filename = `audio_${Date.now()}${targetExtension}`;
                // --- FIM DA CORREÇÃO ---

                // Envia o Blob
                if (audioBlob.size > 1000) { // Evita enviar blobs vazios se parar rápido
                    handleSendFile(audioBlob, 'audio', filename); // Passa o nome de arquivo .ogg ou .mp3
                } else {
                    console.log("Gravação muito curta, descartada.");
                }

                // Limpa a stream
                stream.getTracks().forEach(track => track.stop());
                setIsRecording(false);
            };

            mediaRecorderRef.current.start();
            setIsRecording(true);

            // Inicia o timer
            setRecordingTime(0);
            recordingIntervalRef.current = setInterval(() => {
                setRecordingTime(prevTime => prevTime + 1);
            }, 1000);

        } catch (err) {
            console.error("Erro ao iniciar gravação de áudio:", err);
            alert("Não foi possível acessar o microfone. Verifique as permissões do navegador.");
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            mediaRecorderRef.current.stop();
        }
    };

    const cancelRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            mediaRecorderRef.current.stop(); // Chama onstop, mas não enviamos o blob
            // Limpa os tracks
            mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
        }
        clearInterval(recordingIntervalRef.current);
        setRecordingTime(0);
        setIsRecording(false);
        audioChunksRef.current = [];
    };

    const handleMicClick = () => {
        if (isRecording) {
            stopRecording(); // Envia ao parar
        } else {
            startRecording(); // Começa a gravar
        }
    };

    // --- Lógica de Envio de Arquivo (MODIFICADA) ---
    // (Agora aceita um 'customFilename' vindo do gravador de áudio)
    const handleSendFile = async (file, type, customFilename = null) => {
        if (!file || isSendingMedia) return;

        setIsSendingMedia(true);
        try {
            // --- CORREÇÃO: Garante que o 'filename' seja passado ---
            const filename = customFilename || file.name || `${type}_${Date.now()}`;
            await onSendMedia(file, type, filename); // Passa o nome do arquivo
        } catch (error) {
            console.error(`Erro ao enviar ${type}:`, error);
            alert(`Falha ao enviar ${type}.`);
        } finally {
            setIsSendingMedia(false);
            // Limpa o valor dos inputs de arquivo
            if (imageInputRef.current) imageInputRef.current.value = null;
            if (docInputRef.current) docInputRef.current.value = null;
        }
    };

    // Handler para os inputs de arquivo
    const handleFileChange = (event, type) => {
        const file = event.target.files?.[0];
        if (file) {
            handleSendFile(file, type); // O 'customFilename' é nulo, onSendMedia usará file.name
        }
        setShowAttachMenu(false); // Fecha o menu após selecionar
    };

    // --- Lógica de Envio de Texto ---
    const handleSubmitText = async (e) => {
        e.preventDefault();
        if (!text.trim() || isSending || isRecording) return;

        setIsSending(true);
        try {
            await onSendMessage(text);
            setText('');
        } catch (error) {
            console.error("Erro ao enviar mensagem:", error);
            alert("Erro ao enviar mensagem.");
        } finally {
            setIsSending(false);
        }
    };

    // Formata o tempo de gravação (ex: 00:05)
    const formatRecordingTime = (time) => {
        const minutes = Math.floor(time / 60).toString().padStart(2, '0');
        const seconds = (time % 60).toString().padStart(2, '0');
        return `${minutes}:${seconds}`;
    };

    return (
        <footer className="flex-shrink-0 p-3 bg-[#f0f2f5] border-t border-gray-200">
            {/* Inputs de arquivo ocultos */}
            <input
                type="file"
                ref={imageInputRef}
                accept="image/png, image/jpeg, image/webp"
                className="hidden"
                onChange={(e) => handleFileChange(e, 'image')}
                disabled={isSendingMedia || isRecording}
            />
            <input
                type="file"
                ref={docInputRef}
                accept=".pdf,.doc,.docx,.xls,.xlsx,.txt"
                className="hidden"
                onChange={(e) => handleFileChange(e, 'document')}
                disabled={isSendingMedia || isRecording}
            />

            {/* Se estiver gravando, mostra a UI de gravação */}
            {isRecording ? (
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={cancelRecording} // Botão de lixeira para cancelar
                        title="Cancelar Gravação"
                        className="p-2 text-gray-500 hover:text-red-600 transition-colors rounded-full hover:bg-gray-200"
                    >
                        <Trash2 size={22} />
                    </button>

                    <div className="flex-1 flex items-center justify-center gap-2 text-red-600">
                        <StopCircle size={16} className="animate-pulse" />
                        <span className="font-mono">{formatRecordingTime(recordingTime)}</span>
                    </div>

                    <button
                        type="button"
                        className="p-2 text-white bg-blue-600 rounded-full hover:bg-blue-700 transition-colors"
                        title="Parar e Enviar"
                        onClick={stopRecording} // O ícone de 'mic' agora é 'enviar'
                    >
                        <Send size={22} />
                    </button>
                </div>
            ) : (
                // UI Padrão (texto ou mic)
                <form onSubmit={handleSubmitText} className="flex items-center gap-3">
                    {/* Botão Anexar */}
                    <div className="relative">
                        {showAttachMenu && (
                            <div className="absolute bottom-12 left-0 bg-white rounded-lg shadow-lg overflow-hidden w-48 animate-fade-in-up-fast">
                                <button type="button" onClick={() => imageInputRef.current?.click()} className="flex items-center gap-3 w-full px-4 py-3 text-sm text-gray-700 hover:bg-gray-100">
                                    <ImageIcon size={20} className="text-purple-500" />
                                    Imagem
                                </button>
                                <button type="button" onClick={() => docInputRef.current?.click()} className="flex items-center gap-3 w-full px-4 py-3 text-sm text-gray-700 hover:bg-gray-100">
                                    <FileText size={20} className="text-blue-500" />
                                    Documento
                                </button>
                            </div>
                        )}
                        <button type="button" onClick={() => setShowAttachMenu(!showAttachMenu)} className="p-2 text-gray-500 hover:text-blue-600 transition-colors rounded-full hover:bg-gray-200" disabled={isSendingMedia}>
                            <Paperclip size={22} />
                        </button>
                    </div>

                    {/* Input de Texto */}
                    <input
                        type="text"
                        placeholder="Digite uma mensagem"
                        className="flex-1 px-4 py-2 border border-gray-300 bg-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        disabled={isSending || isSendingMedia}
                    />

                    {/* Botão Enviar ou Mic */}
                    {text.trim() ? (
                        <button
                            type="submit"
                            className="p-2 text-white bg-blue-600 rounded-full hover:bg-blue-700 transition-colors disabled:bg-gray-400"
                            disabled={isSending || isSendingMedia}
                            title="Enviar"
                        >
                            <Send size={22} />
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="p-2 text-gray-500 hover:text-blue-600 transition-colors rounded-full hover:bg-gray-200"
                            title="Gravar áudio"
                            onClick={handleMicClick}
                            disabled={isSendingMedia} // Desativa se estiver enviando outra mídia
                        >
                            {/* Mostra loader se estiver enviando mídia (que não seja áudio) */}
                            {isSendingMedia ? <Loader2 size={22} className="animate-spin" /> : <Mic size={22} />}
                        </button>
                    )}
                </form>
            )}
        </footer >
    );
};


// --- Componente: Placeholder (Sem chat selecionado) ---
const ChatPlaceholder = () => (
    <div className="flex-1 flex flex-col items-center justify-center text-center bg-gray-100 border-l border-gray-200">
        <div className="p-8 bg-white/70 backdrop-blur-sm rounded-lg shadow">
            <MessageSquareText size={64} className="text-gray-400 mx-auto" />
            <h2 className="mt-4 text-2xl font-semibold text-gray-700">Atendimento Manual</h2>
            <p className="mt-2 text-gray-500">
                Selecione um atendimento na lista à esquerda para visualizar ou responder.
            </p>
        </div>
    </div>
);


// --- COMPONENTE PRINCIPAL DA PÁGINA ---
function Atendimentos() {
    const [atendimentos, setAtendimentos] = useState([]);
    const [filteredAtendimentos, setFilteredAtendimentos] = useState([]);
    const [currentUser, setCurrentUser] = useState(null);

    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    const [searchTerm, setSearchTerm] = useState('');
    const [activeFilter, setActiveFilter] = useState('ativos');
    const [selectedAtendimento, setSelectedAtendimento] = useState(null);
    const [totalAtendimentos, setTotalAtendimentos] = useState(0);

    const [modalMedia, setModalMedia] = useState(null); // { url: blobUrl, type: 'image'|'audio', filename: string }
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isDownloadingMedia, setIsDownloadingMedia] = useState(false); // Para feedback no botão
    const currentBlobUrl = useRef(null); // Para limpar a URL do blob anterior

    const intervalRef = useRef(null);

    // --- Fetch (User e Atendimentos) ---
    const fetchData = useCallback(async (isInitialLoad = false) => {
        if (isInitialLoad) setIsLoading(true);
        try {
            const [userRes, atendimentosRes] = await Promise.all([
                api.get('/auth/me'),
                // --- CORREÇÃO DA CHAMADA ---
                api.get('/atendimentos/', {
                    params: {
                        search: searchTerm, // Envia o termo de busca para o backend
                        limit: 1000 // Pede todos os resultados (para o filtro de status local)
                    }
                })
                // --- FIM DA CORREÇÃO ---
            ]);
            setCurrentUser(userRes.data);

            // --- CORREÇÃO DA LEITURA DA RESPOSTA ---
            const data = atendimentosRes.data;

            // Verifica se a resposta tem o formato { total: X, items: [...] }
            if (data && Array.isArray(data.items)) {
                setAtendimentos(data.items);
                setTotalAtendimentos(data.total);
            } else {
                // Fallback para o caso de erro ou formato antigo
                console.warn("A API /atendimentos/ não retornou o formato esperado.", data);
                setAtendimentos(Array.isArray(data) ? data : []); // Garante que seja um array
                setTotalAtendimentos(0);
            }
            // --- FIM DA CORREÇÃO ---

        } catch (err) {
            console.error("Erro ao carregar dados:", err);
            setError('Não foi possível carregar os dados. Verifique a sua conexão.');
            if (intervalRef.current) clearInterval(intervalRef.current);
        } finally {
            if (isInitialLoad) setIsLoading(false);
        }
    }, [searchTerm]); // <-- ADICIONAR 'searchTerm' COMO DEPENDÊNCIA

    // --- Efeito: Polling ---
    useEffect(() => {
        fetchData(true);
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = setInterval(() => fetchData(false), 5000);
        return () => clearInterval(intervalRef.current);
    }, [fetchData]);

    // --- Efeito: Filtragem da Lista (MODIFICADO) ---
    useEffect(() => {
        // Guarda de segurança (continua importante)
        if (!Array.isArray(atendimentos)) {
            setFilteredAtendimentos([]);
            return;
        }

        // 'atendimentos' já veio filtrado pelo search E ordenado pela API
        let filtered = atendimentos;

        // 1. O filtro de STATUS (activeFilter) ainda é feito no cliente
        if (activeFilter === 'Atendente Chamado') {
            filtered = atendimentos.filter(at => at.status === 'Atendente Chamado');
        } else if (activeFilter === 'Concluído') {
            filtered = atendimentos.filter(at => at.status === 'Concluído');
        }

        // 2. REMOVER o filtro por searchTerm (o backend já fez)
        /*         const lowercasedFilter = searchTerm.toLowerCase();
        if (lowercasedFilter) {
            filtered = filtered.filter(item =>
                ...
            );
        }
        */ // <-- ISSO NÃO É MAIS NECESSÁRIO

        // 3. REMOVER a ordenação .sort() (o backend já fez)
        // filtered.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
        // <-- ISSO NÃO É MAIS NECESSÁRIO (filter preserva a ordem)

        setFilteredAtendimentos(filtered);

        if (selectedAtendimento) {
            const updatedSelected = filtered.find(at => at.id === selectedAtendimento.id);
            if (updatedSelected) {
                // ... (lógica de atualização do 'selectedAtendimento' continua igual) ...
                const localDate = new Date(selectedAtendimento.updated_at).getTime();
                const serverDate = new Date(updatedSelected.updated_at).getTime();
                if (serverDate >= localDate) {
                    setSelectedAtendimento(updatedSelected);
                }
            } else {
                setSelectedAtendimento(null);
            }
        }
    }, [atendimentos, activeFilter]); // <-- REMOVER 'searchTerm' DAS DEPENDÊNCIAS

    // --- FUNÇÃO CORRIGIDA PARA USAR AXIOS (api) ---
    const handleViewMedia = async (mediaId, type, filename) => {
        if (!selectedAtendimento || isDownloadingMedia) {
            console.log("handleViewMedia blocked: No selection or already downloading.");
            return;
        }

        // Limpa URL de blob antiga
        if (currentBlobUrl.current) {
            console.log("Revoking previous Blob URL:", currentBlobUrl.current);
            URL.revokeObjectURL(currentBlobUrl.current);
            currentBlobUrl.current = null;
        }

        setIsDownloadingMedia(true);
        console.log(`[handleViewMedia] Iniciando download via Axios para mediaId: ${mediaId}, tipo: ${type}`);
        const backendMediaUrl = `/atendimentos/${selectedAtendimento.id}/media/${mediaId}`; // URL relativa para Axios

        try {
            // --- USA api.get com responseType: 'blob' ---
            console.log(`[handleViewMedia] Chamando api.get: ${backendMediaUrl}`);
            const response = await api.get(backendMediaUrl, {
                responseType: 'blob', // <<<--- ESSENCIAL PARA BAIXAR ARQUIVO
                timeout: 60000 // Aumenta timeout para downloads (60s)
            });
            console.log(`[handleViewMedia] Axios response status: ${response.status}`);

            // Axios trata erros HTTP > 2xx no catch por padrão

            // O 'data' da resposta do Axios já será o Blob
            const blob = response.data;
            // Pega o content-type dos headers da resposta
            const actualContentType = response.headers['content-type'];
            console.log(`[handleViewMedia] Download concluído. Blob size: ${blob.size}, Blob type: ${blob.type}, Actual Content-Type: ${actualContentType}`);

            if (blob.size === 0) {
                throw new Error("Download resultou em um arquivo vazio.");
            }
            // --- VERIFICA SE O TIPO É HTML (AINDA INDICA ERRO NO BACKEND/TOKEN) ---
            if (blob.type && blob.type.includes('text/html')) {
                console.error("[handleViewMedia] Recebido HTML em vez de mídia. Provável erro de token no backend.");
                // Tenta ler o HTML para dar uma dica
                try {
                    const htmlText = await blob.text();
                    console.error("[handleViewMedia] Conteúdo HTML recebido:", htmlText.substring(0, 500));
                } catch { /* Ignora se não conseguir ler */ }
                throw new Error("Falha ao baixar mídia: O servidor retornou uma página HTML inesperada. Verifique o token de acesso no backend.");
            }
            // ---------------------------------------------------------------------

            // --- Criar Blob URL e Abrir Modal ---
            const blobUrl = URL.createObjectURL(blob);
            currentBlobUrl.current = blobUrl;
            console.log("[handleViewMedia] Created Blob URL:", blobUrl);

            console.log("[handleViewMedia] Setting modal media state:", { url: blobUrl, type: type, filename: filename });
            setModalMedia({ url: blobUrl, type: type, filename: filename });

            console.log("[handleViewMedia] Setting modal open state to true");
            setTimeout(() => {
                setIsModalOpen(true);
                console.log("[handleViewMedia] Modal should be open now.");
            }, 0);

        } catch (error) {
            // Axios coloca erros de rede e status >= 300 aqui
            console.error("[handleViewMedia] Erro durante a requisição Axios:", error);
            let alertMessage = "Não foi possível carregar a mídia.";
            if (error.response) {
                // Tenta pegar o 'detail' do erro do FastAPI
                console.error("[handleViewMedia] Axios error response data:", error.response.data);
                console.error("[handleViewMedia] Axios error response status:", error.response.status);
                // Se a resposta for um Blob (mesmo com erro), tenta ler como texto
                if (error.response.data instanceof Blob) {
                    try {
                        const errorBlobText = await error.response.data.text();
                        console.error("[handleViewMedia] Axios error Blob content:", errorBlobText.substring(0, 500));
                        // Tenta parsear como JSON se for texto
                        try {
                            const errorJson = JSON.parse(errorBlobText);
                            alertMessage = `Erro ${error.response.status}: ${errorJson.detail || 'Erro ao carregar mídia.'}`;
                        } catch {
                            alertMessage = `Erro ${error.response.status}: Resposta inesperada do servidor.`;
                        }
                    } catch {
                        alertMessage = `Erro ${error.response.status}: Falha ao ler detalhes do erro.`;
                    }
                } else if (error.response.data?.detail) {
                    alertMessage = `Erro ${error.response.status}: ${error.response.data.detail}`;
                } else {
                    alertMessage = `Erro ${error.response.status}: Falha ao carregar mídia.`;
                }

            } else if (error.request) {
                console.error("[handleViewMedia] Axios error: No response received.");
                alertMessage = "Não foi possível conectar ao servidor para carregar a mídia.";
            } else {
                console.error("[handleViewMedia] Axios error:", error.message);
                alertMessage = `Erro ao preparar a requisição: ${error.message}`;
            }
            alert(alertMessage);

            // Garante limpeza do blobUrl em caso de erro
            if (currentBlobUrl.current) {
                console.log("[handleViewMedia] Revoking Blob URL due to error:", currentBlobUrl.current);
                URL.revokeObjectURL(currentBlobUrl.current);
                currentBlobUrl.current = null;
            }
        } finally {
            console.log("[handleViewMedia] Setting downloading state to false");
            setIsDownloadingMedia(false);
        }
    };

    // --- FUNÇÃO PARA FECHAR O MODAL E LIMPAR URL (Sem alterações, mas essencial) ---
    const closeModal = () => {
        setIsModalOpen(false);
        setModalMedia(null);
        // Revoga a URL do Blob para liberar memória quando o modal fecha
        if (currentBlobUrl.current) {
            URL.revokeObjectURL(currentBlobUrl.current);
            currentBlobUrl.current = null;
            console.log("Blob URL revogada ao fechar modal.");
        }
    };

    // --- USEEFFECT DE LIMPEZA (Sem alterações, mas essencial) ---
    // Limpa a URL do blob se o componente for desmontado com o modal aberto
    useEffect(() => {
        return () => {
            if (currentBlobUrl.current) {
                URL.revokeObjectURL(currentBlobUrl.current);
                console.log("Blob URL revogada ao desmontar componente.");
            }
        };
    }, []); // Array vazio garante que rode só na montagem/desmontagem


    // --- Ação: Enviar Mensagem de TEXTO ---
    const handleSendMessage = async (text) => {
        if (!selectedAtendimento) return;
        const atendimentoId = selectedAtendimento.id;

        // ID Otimista
        const optimisticId = `local-${Date.now()}`;

        const optimisticMessage = {
            id: optimisticId,
            role: 'assistant',
            type: 'text', // Tipo explícito
            content: text,
            timestamp: Math.floor(Date.now() / 1000)
        };

        // Atualização Otimista
        const updateOptimisticState = (atendimentoId, msg) => {
            setAtendimentos(prev =>
                prev.map(at => {
                    if (at.id === atendimentoId) {
                        const conversa = JSON.parse(at.conversa || '[]');
                        conversa.push(msg);
                        const updatedAt = { ...at, conversa: JSON.stringify(conversa), status: 'Aguardando Resposta', updated_at: new Date().toISOString() };

                        // Atualiza o estado selecionado também
                        if (selectedAtendimento?.id === atendimentoId) {
                            setSelectedAtendimento(updatedAt);
                        }
                        return updatedAt;
                    }
                    return at;
                })
            );
        };

        updateOptimisticState(atendimentoId, optimisticMessage);

        try {
            // Chama a API de texto
            const response = await api.post(`/atendimentos/${atendimentoId}/send_message`, { text });

            // Atualiza o estado com a resposta final do servidor
            setAtendimentos(prev =>
                prev.map(at => (at.id === atendimentoId ? response.data : at))
            );
            // Atualiza o selecionado com dados do server
            if (selectedAtendimento?.id === atendimentoId) {
                setSelectedAtendimento(response.data);
            }
        } catch (error) {
            console.error("Falha ao enviar mensagem de texto:", error);
            // Reverte a mensagem otimista para um estado de erro
            setAtendimentos(prev =>
                prev.map(at => {
                    if (at.id === atendimentoId) {
                        const conversa = JSON.parse(at.conversa || '[]');
                        const updatedConversa = conversa.map(msg =>
                            msg.id === optimisticId
                                ? { ...msg, type: 'error', content: 'Falha ao enviar mensagem.' }
                                : msg
                        );
                        const revertedAt = { ...at, conversa: JSON.stringify(updatedConversa) };
                        if (selectedAtendimento?.id === atendimentoId) {
                            setSelectedAtendimento(revertedAt);
                        }
                        return revertedAt;
                    }
                    return at;
                })
            );
        }
    };

    // --- NOVA AÇÃO: Enviar Mensagem de MÍDIA (MODIFICADA) ---
    // (Agora aceita 'filename' como argumento)
    const handleSendMedia = async (file, type, filename) => {
        if (!selectedAtendimento) return;
        const atendimentoId = selectedAtendimento.id;

        const optimisticId = `local-${Date.now()}`;
        let localUrl = URL.createObjectURL(file); // URL local para preview

        const optimisticMessage = {
            id: optimisticId,
            role: 'assistant',
            type: 'sending', // Tipo especial 'sending'
            content: `Enviando ${type}...`,
            localUrl: localUrl, // URL do blob para preview
            filename: filename, // <-- USA O FILENAME CORRETO (ex: audio_12345.ogg)
            timestamp: Math.floor(Date.now() / 1000)
        };

        // Atualização Otimista (mesma lógica do texto)
        setAtendimentos(prev =>
            prev.map(at => {
                if (at.id === atendimentoId) {
                    const conversa = JSON.parse(at.conversa || '[]');
                    conversa.push(optimisticMessage);
                    const updatedAt = { ...at, conversa: JSON.stringify(conversa), status: 'Aguardando Resposta', updated_at: new Date().toISOString() };
                    if (selectedAtendimento?.id === atendimentoId) {
                        setSelectedAtendimento(updatedAt);
                    }
                    return updatedAt;
                }
                return at;
            })
        );

        // Monta o FormData
        const formData = new FormData();
        // --- CORREÇÃO: Usa o 'filename' correto no FormData ---
        // O backend lerá este nome de arquivo
        formData.append('file', file, filename);
        // ----------------------------------------------------
        formData.append('type', type); // 'image', 'audio', 'document'

        try {
            // Chama a NOVA API de mídia
            const response = await api.post(`/atendimentos/${atendimentoId}/send_media`, formData, {
                headers: {
                    'Content-Type': 'multipart/form-data',
                },
            });

            // Atualiza com a resposta final (que deve conter a URL da mídia salva)
            setAtendimentos(prev =>
                prev.map(at => (at.id === atendimentoId ? response.data : at))
            );
            if (selectedAtendimento?.id === atendimentoId) {
                setSelectedAtendimento(response.data);
            }

        } catch (error) {
            console.error(`Falha ao enviar ${type}:`, error);
            // Reverte para estado de erro
            setAtendimentos(prev =>
                prev.map(at => {
                    if (at.id === atendimentoId) {
                        const conversa = JSON.parse(at.conversa || '[]');
                        const updatedConversa = conversa.map(msg =>
                            msg.id === optimisticId
                                ? { ...msg, type: 'error', content: `Falha ao enviar ${type}.` }
                                : msg
                        );
                        const revertedAt = { ...at, conversa: JSON.stringify(updatedConversa) };
                        if (selectedAtendimento?.id === atendimentoId) {
                            setSelectedAtendimento(revertedAt);
                        }
                        return revertedAt;
                    }
                    return at;
                })
            );
        } finally {
            // Limpa a URL do blob da memória após o envio (sucesso ou falha)
            if (localUrl) {
                URL.revokeObjectURL(localUrl);
            }
        }
    };


    if (isLoading && !currentUser) {
        return <div className="flex h-screen items-center justify-center text-gray-600">A carregar interface de atendimentos...</div>;
    }

    if (error) {
        return <div className="flex h-screen items-center justify-center text-red-600 p-10">{error}</div>;
    }

    return (
        <div className="flex h-[93vh] bg-white">
            <aside className="w-full md:w-[30%] lg:w-[25%] flex flex-col border-r border-gray-200 min-h-0">
                <SearchAndFilter
                    searchTerm={searchTerm}
                    setSearchTerm={setSearchTerm}
                    activeFilter={activeFilter}
                    setActiveFilter={setActiveFilter}
                    currentUserApiType={currentUser?.api_type}
                />
                <nav className="flex-1 overflow-y-auto">
                    {filteredAtendimentos.length > 0 ? (
                        filteredAtendimentos.map((at) => (
                            <ContactItem
                                key={at.id}
                                atendimento={at}
                                isSelected={selectedAtendimento?.id === at.id}
                                onSelect={setSelectedAtendimento}
                            />
                        ))
                    ) : (
                        <p className="text-center text-gray-500 p-6">
                            Nenhum atendimento encontrado para este filtro.
                        </p>
                    )}
                </nav>
            </aside>

            <main className="flex-1 flex flex-col min-h-0">
                {selectedAtendimento ? (
                    <>
                        <ChatBody
                            atendimento={selectedAtendimento}
                            onViewMedia={handleViewMedia}
                            isDownloadingMedia={isDownloadingMedia} // Passa estado de loading
                        />
                        <ChatFooter
                            onSendMessage={handleSendMessage}
                            onSendMedia={handleSendMedia} // Passa a nova função
                        />
                    </>
                ) : (
                    <ChatPlaceholder />
                )}
            </main>

            {/* Renderiza o Modal */}
            <MediaModal
                isOpen={isModalOpen}
                onClose={closeModal} // Usa a função de fechar que limpa a URL
                mediaUrl={modalMedia?.url}
                mediaType={modalMedia?.type}
                filename={modalMedia?.filename}
            />

        </div>
    );
}

export default Atendimentos;