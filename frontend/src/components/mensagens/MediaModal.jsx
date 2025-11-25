import React, { useEffect } from 'react';
import { Download } from 'lucide-react';

// --- NOVO Componente: Modal de Mídia ---
const MediaModal = ({ isOpen, onClose, mediaUrl, mediaType, filename }) => {
    // Log para verificar props recebidas

    // Efeito para logar quando a URL muda
    useEffect(() => {
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

                {/* --- INÍCIO DA ADIÇÃO (VÍDEO) --- */}
                {mediaType === 'video' && (
                    <div className="flex flex-col items-center space-y-3 p-4">
                        <p className="text-sm text-gray-600">{filename || 'Vídeo'}</p>
                        <video
                            src={mediaUrl}
                            controls
                            className="w-full max-w-full max-h-[70vh] object-contain mx-auto"
                            onError={(e) => console.error("[MediaModal] Erro ao carregar tag <video>. SRC:", e.target.src, "Error Code:", e.target.error?.code)}
                        />
                        <button
                            onClick={handleDownload}
                            className="mt-2 px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 flex items-center gap-1"
                        >
                            <Download size={16} /> Baixar Vídeo
                        </button>
                    </div>
                )}
                {/* --- FIM DA ADIÇÃO --- */}

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

export default MediaModal;