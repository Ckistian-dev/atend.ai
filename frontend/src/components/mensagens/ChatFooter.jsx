import React, { useState, useEffect, useRef } from 'react';
import {
    Paperclip, Mic, Send, Image as ImageIcon, FileText, Loader2, StopCircle, Trash2, FileVideo, MessageSquarePlus
} from 'lucide-react';

const ChatFooter = ({ onSendMessage, onSendMedia, onOpenTemplateModal }) => {
    const [text, setText] = useState('');
    const [showAttachMenu, setShowAttachMenu] = useState(false);
    const attachMenuRef = useRef(null); // Ref para o menu de anexo


    // --- Novos estados para mídia ---
    const [isRecording, setIsRecording] = useState(false);
    const [isSendingMedia, setIsSendingMedia] = useState(false); // Trava o input
    const [recordingTime, setRecordingTime] = useState(0);

    // --- Refs ---
    const mediaRecorderRef = useRef(null);
    const audioChunksRef = useRef([]);
    const recordingIntervalRef = useRef(null);
    const recordingMimeTypeRef = useRef('audio/webm'); // Guarda o tipo usado
    const didCancelRecordingRef = useRef(false);
    const textInputRef = useRef(null);

    // Refs para os inputs de arquivo
    const imageInputRef = useRef(null);
    const docInputRef = useRef(null);
    const videoInputRef = useRef(null);

    // Efeito para fechar o menu de anexo ao clicar fora
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (attachMenuRef.current && !attachMenuRef.current.contains(event.target)) {
                setShowAttachMenu(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    useEffect(() => {
        const textarea = textInputRef.current;
        if (textarea) {
            const maxHeight = 120; // Altura máxima (aprox. 5-6 linhas)

            textarea.style.height = 'auto'; // Reseta a altura
            const scrollHeight = textarea.scrollHeight;

            if (scrollHeight > maxHeight) {
                textarea.style.height = `${maxHeight}px`;
                textarea.style.overflowY = 'auto'; // Adiciona scroll se passar do max
            } else {
                textarea.style.height = `${scrollHeight}px`;
                textarea.style.overflowY = 'hidden'; // Esconde scroll
            }
        }
    }, [text]); // Executa toda vez que o texto muda

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

            recordingMimeTypeRef.current = supportedType; // Salva o tipo

            mediaRecorderRef.current = new MediaRecorder(stream, { mimeType: supportedType });
            // --- FIM DA CORREÇÃO ---

            audioChunksRef.current = []; // Limpa chunks antigos

            mediaRecorderRef.current.ondataavailable = (event) => {
                audioChunksRef.current.push(event.data);
            };

            mediaRecorderRef.current.onstop = () => {
                // 1. Limpa o timer e o estado de gravação em TODOS os casos
                clearInterval(recordingIntervalRef.current);
                setRecordingTime(0);
                setIsRecording(false);

                // 2. Limpa a stream (microfone) em TODOS os casos
                stream.getTracks().forEach(track => track.stop());

                // 3. VERIFICA A BANDEIRA DE CANCELAMENTO
                if (didCancelRecordingRef.current) {
                    didCancelRecordingRef.current = false; // Reseta a flag
                    audioChunksRef.current = []; // Descarta os dados
                    return; // Para aqui
                }

                // 4. Se NÃO foi cancelado, prossegue com o envio

                // --- INÍCIO DA CORREÇÃO (Lógica que você já tinha) ---
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


                // FORÇA o blob a ter o tipo que a WBP aceita
                const audioBlob = new Blob(audioChunksRef.current, { type: targetMimeType });
                const filename = `audio_${Date.now()}${targetExtension}`;
                // --- FIM DA CORREÇÃO ---

                // Envia o Blob
                if (audioBlob.size > 1000) { // Evita enviar blobs vazios se parar rápido
                    handleSendFile(audioBlob, 'audio', filename); // Passa o nome de arquivo .ogg ou .mp3
                } else {
                }

                // Limpa os chunks APÓS o envio/descarte
                audioChunksRef.current = [];
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
            didCancelRecordingRef.current = false; // <-- Define a flag (NÃO cancelar)
            mediaRecorderRef.current.stop();
        }
    };

    const cancelRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            didCancelRecordingRef.current = true; // <-- Define a flag (SIM, cancelar)
            mediaRecorderRef.current.stop(); // O 'onstop' vai pegar essa flag
        }
        // O resto da limpeza (timer, state, chunks) agora é feito no 'onstop'
    };

    const handleMicClick = () => {
        if (isRecording) {
            stopRecording(); // Envia ao parar
        } else {
            startRecording(); // Começa a gravar
        }
    };

    // --- Lógica de Envio de Arquivo (MODIFICADA) ---
    // (A única mudança é a remoção do bloco 'finally' que limpava os inputs)
    const handleSendFile = (file, type, customFilename = null) => {
        if (!file) return;

        try {
            // Apenas chama a prop 'onSendMedia' (que agora vai enfileirar)
            const filename = customFilename || file.name || `${type}_${Date.now()}`;
            onSendMedia(file, type, filename); // Esta chamada não é 'await'
        } catch (error) {
            // Erro síncrono (ex: falha ao gerar nome do arquivo), improvável
            console.error(`Erro síncrono ao preparar envio de ${type}:`, error);
            alert(`Falha ao preparar ${type} para envio.`);
        }
        // O 'finally' block com a limpeza dos inputs FOI REMOVIDO DAQUI
    };

    // Handler para os inputs de arquivo
    const handleFileChange = (event, type) => {
        const files = event.target.files; // Pega a FileList
        if (!files || files.length === 0) {
            return; // Sai se nada foi selecionado
        }

        // Itera sobre todos os arquivos selecionados
        for (const file of files) {
            if (file) {
                // Chama a função de enfileiramento para CADA arquivo
                handleSendFile(file, type); // O 'customFilename' é nulo
            }
        }

        // Limpa o valor dos inputs APÓS o loop (movido de 'handleSendFile' para cá)
        if (imageInputRef.current) imageInputRef.current.value = null;
        if (docInputRef.current) docInputRef.current.value = null;
        if (videoInputRef.current) videoInputRef.current.value = null;

        setShowAttachMenu(false); // Fecha o menu após enfileirar tudo
    };

    // --- Lógica de Envio de Texto (MODIFICADA) ---
    // 1. A lógica de envio foi extraída para esta função
    const submitTextLogic = () => {
        const textToSend = text.trim();
        if (!textToSend || isRecording || isSendingMedia) return;

        setText(''); // Limpa o input

        // Foca e reseta a altura do textarea
        setTimeout(() => {
            const textarea = textInputRef.current;
            if (textarea) {
                textarea.focus();
                textarea.style.height = 'auto'; // Reseta altura
                textarea.style.overflowY = 'hidden';
            }
        }, 0);

        onSendMessage(textToSend); // Envia (sem await)
    };

    // 2. O handler do <form> agora só chama a lógica
    const handleSubmitText = (e) => {
        e.preventDefault();
        submitTextLogic();
    };

    // 3. (NOVO) Handler de tecla para o textarea
    const handleKeyDown = (e) => {
        // Se for 'Enter' E NÃO for 'Shift'
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault(); // Previne a quebra de linha
            submitTextLogic();  // Envia a mensagem
        }
        // Se for 'Shift + Enter', permite o comportamento padrão (quebrar linha)
    };
    // --- FIM DAS MODIFICAÇÕES DE ENVIO DE TEXTO ---

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
                disabled={isRecording}
                multiple
            />
            <input
                type="file"
                ref={docInputRef}
                accept=".pdf,.doc,.docx,.xls,.xlsx,.txt"
                className="hidden"
                onChange={(e) => handleFileChange(e, 'document')}
                disabled={isRecording}
                multiple
            />

            {/* --- INÍCIO DA ADIÇÃO --- */}
            <input
                type="file"
                ref={videoInputRef}
                accept="video/mp4,video/3gpp"
                className="hidden"
                onChange={(e) => handleFileChange(e, 'video')}
                disabled={isRecording}
                multiple
            />
            {/* --- FIM DA ADIÇÃO --- */}

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
                    <div className="relative" ref={attachMenuRef}>
                        {/* --- NOVO: Botão para abrir modal de template --- */}
                        <button type="button" onClick={onOpenTemplateModal} className="p-2 text-gray-500 hover:text-blue-600 transition-colors rounded-full hover:bg-gray-200" title="Enviar template">
                            <MessageSquarePlus size={22} />
                        </button>

                        {showAttachMenu && (
                            <div className="absolute bottom-12 left-0 bg-white rounded-lg shadow-lg overflow-hidden w-48 animate-fade-in-up-fast">
                                <button type="button" onClick={() => imageInputRef.current?.click()} className="flex items-center gap-3 w-full px-4 py-3 text-sm text-gray-700 hover:bg-gray-100">
                                    <ImageIcon size={20} className="text-purple-500" />
                                    Imagem
                                </button>
                                <button type="button" onClick={() => videoInputRef.current?.click()} className="flex items-center gap-3 w-full px-4 py-3 text-sm text-gray-700 hover:bg-gray-100">
                                    <FileVideo size={20} className="text-red-500" />
                                    Vídeo
                                </button>
                                <button type="button" onClick={() => docInputRef.current?.click()} className="flex items-center gap-3 w-full px-4 py-3 text-sm text-gray-700 hover:bg-gray-100">
                                    <FileText size={20} className="text-blue-500" />
                                    Documento
                                </button>
                            </div>
                        )}
                        <button type="button" onClick={() => setShowAttachMenu(!showAttachMenu)} className="p-2 text-gray-500 hover:text-blue-600 transition-colors rounded-full hover:bg-gray-200">
                            <Paperclip size={22} />
                        </button>
                    </div>

                    {/* Input de Texto */}
                    <textarea
                        ref={textInputRef}
                        rows={1} // Começa com uma linha
                        placeholder="Digite uma mensagem"
                        className="flex-1 px-4 py-2 border border-gray-300 bg-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none overflow-y-hidden" // Adicionado resize-none e overflow-y-hidden
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={handleKeyDown}
                    />

                    {/* Botão Enviar ou Mic */}
                    {text.trim() ? (
                        <button
                            type="submit"
                            className="p-2 text-white bg-blue-600 rounded-full hover:bg-blue-700 transition-colors disabled:bg-gray-400"
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
                        >
                            <Mic size={22} />
                        </button>
                    )}
                </form>
            )}
        </footer >
    );
};

export default ChatFooter;