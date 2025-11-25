import React, { useState, useEffect, useRef } from 'react';
import { Loader2, X, AlertCircle } from 'lucide-react';
import api from '../../api/axiosConfig';

const ImageDisplayer = ({ atendimentoId, mediaId, caption }) => {
    const [imageSrc, setImageSrc] = useState(null);
    // --- ALTERADO: Estado inicial agora é 'idle' para aguardar visibilidade ---
    const [loadState, setLoadState] = useState('idle'); // 'idle', 'loading', 'loaded', 'error'
    const [isModalOpen, setIsModalOpen] = useState(false);
    const imageBlobUrlRef = useRef(null);
    const displayerRef = useRef(null); // Ref para o container do componente

    // Limpa a URL do blob quando o componente é desmontado para evitar vazamentos de memória
    useEffect(() => {
        return () => {
            if (imageBlobUrlRef.current) {
                URL.revokeObjectURL(imageBlobUrlRef.current);
            }
        };
    }, []);

    // --- NOVO: Efeito com IntersectionObserver para carregar a imagem quando visível ---
    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                const entry = entries[0];
                // Se o componente estiver visível e a imagem ainda não foi carregada
                if (entry.isIntersecting && loadState === 'idle') {
                    loadImage();
                    // Para de observar para não recarregar
                    if (displayerRef.current) {
                        observer.unobserve(displayerRef.current);
                    }
                }
            },
            { rootMargin: '200px' } // Começa a carregar 200px antes de entrar na tela
        );

        if (displayerRef.current) {
            observer.observe(displayerRef.current);
        }

        return () => {
            if (displayerRef.current) {
                observer.unobserve(displayerRef.current);
            }
        };
    }, [loadState]); // Depende do loadState para não re-observar desnecessariamente

    // --- ALTERADO: Função agora é chamada pelo IntersectionObserver ---
    const loadImage = async () => {
        if (loadState !== 'idle') return; // Previne múltiplos carregamentos

        setLoadState('loading');
        try {
            const response = await api.get(`/atendimentos/${atendimentoId}/media/${mediaId}`, {
                responseType: 'blob',
            });
            const blob = new Blob([response.data], { type: response.headers['content-type'] });
            const blobUrl = URL.createObjectURL(blob);
            imageBlobUrlRef.current = blobUrl;
            setImageSrc(blobUrl);
            setLoadState('loaded');
        } catch (error) {
            console.error("Erro ao carregar imagem:", error);
            setLoadState('error');
        }
    };

    const openModal = () => setIsModalOpen(true);
    const closeModal = () => setIsModalOpen(false);

    return (
        <div ref={displayerRef} className="space-y-2 w-64">
            {/* Área da Miniatura */}
            <div className="relative w-64 h-48 bg-gray-200 rounded-lg overflow-hidden">
                {/* --- ALTERADO: Mostra o loader para os estados 'idle' e 'loading' --- */}
                {(loadState === 'loading' || loadState === 'idle') && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-50 animate-pulse">
                        <Loader2 className="animate-spin text-gray-500" />
                    </div>
                )}
                {loadState === 'error' && <div className="absolute inset-0 flex items-center justify-center"><AlertCircle className="text-red-500" title="Erro ao carregar imagem" /></div>}
                {loadState === 'loaded' && imageSrc && (
                    <img
                        src={imageSrc}
                        alt="Miniatura"
                        className="w-full h-full object-cover cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={openModal}
                        title="Clique para ampliar"
                    />
                )}
            </div>

            {/* Legenda da imagem */}
            {caption && (
                <p className="whitespace-pre-wrap text-sm border-t border-gray-200 pt-2">{caption}</p>
            )}

            {/* Modal para exibir a imagem em tela cheia */}
            {isModalOpen && imageSrc && (
                <div className="fixed inset-[-10px] bg-black bg-opacity-60 flex items-center justify-center z-50" onClick={closeModal}>
                    <img src={imageSrc} alt="Visualização" className="max-w-[80vw] max-h-[80vh] object-contain" onClick={(e) => e.stopPropagation()} />
                </div>
            )}
        </div>
    );
};

export default ImageDisplayer;