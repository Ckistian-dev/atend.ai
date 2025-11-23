import React, { useState, useEffect, useRef } from 'react';
import { Loader2, Play, AlertCircle } from 'lucide-react';
import api from '../api/axiosConfig';

const VideoDisplayer = ({ atendimentoId, mediaId, caption }) => {
    const [videoSrc, setVideoSrc] = useState(null);
    const [loadState, setLoadState] = useState('idle'); // 'idle', 'loading', 'loaded', 'error'
    const [isModalOpen, setIsModalOpen] = useState(false);
    const videoBlobUrlRef = useRef(null);
    const displayerRef = useRef(null);

    // Limpa a URL do blob para evitar vazamentos de memória
    useEffect(() => {
        return () => {
            if (videoBlobUrlRef.current) {
                URL.revokeObjectURL(videoBlobUrlRef.current);
            }
        };
    }, []);

    // Efeito com IntersectionObserver para carregar o vídeo quando visível
    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                const entry = entries[0];
                if (entry.isIntersecting && loadState === 'idle') {
                    loadVideo();
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
    }, [loadState]);

    // Função para carregar o blob do vídeo
    const loadVideo = async () => {
        if (loadState !== 'idle') return;

        setLoadState('loading');
        try {
            const response = await api.get(`/atendimentos/${atendimentoId}/media/${mediaId}`, {
                responseType: 'blob',
            });
            const blob = new Blob([response.data], { type: response.headers['content-type'] });
            const blobUrl = URL.createObjectURL(blob);
            videoBlobUrlRef.current = blobUrl;
            setVideoSrc(blobUrl);
            setLoadState('loaded');
        } catch (error) {
            console.error("Erro ao carregar vídeo:", error);
            setLoadState('error');
        }
    };

    const openModal = () => setIsModalOpen(true);
    const closeModal = () => setIsModalOpen(false);

    return (
        <div ref={displayerRef} className="space-y-2 w-64">
            {/* Área da Miniatura */}
            <div className="relative w-64 h-48 bg-gray-200 rounded-lg overflow-hidden cursor-pointer group" onClick={openModal}>
                {(loadState === 'loading' || loadState === 'idle') && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-50 animate-pulse">
                        <Loader2 className="animate-spin text-gray-500" />
                    </div>
                )}
                {loadState === 'error' && <div className="absolute inset-0 flex items-center justify-center"><AlertCircle className="text-red-500" title="Erro ao carregar vídeo" /></div>}
                {loadState === 'loaded' && videoSrc && (
                    <>
                        {/* O vídeo da miniatura: sem som, sem controles, para mostrar o 1º frame */}
                        <video src={videoSrc} muted playsInline className="w-full h-full object-cover" />
                        {/* Overlay com ícone de Play */}
                        <div className="absolute inset-0 bg-black bg-opacity-20 flex items-center justify-center transition-opacity group-hover:bg-opacity-40">
                            <div className="bg-white/30 backdrop-blur-sm p-3 rounded-full">
                                <Play className="text-white fill-white" size={32} />
                            </div>
                        </div>
                    </>
                )}
            </div>

            {caption && <p className="whitespace-pre-wrap text-sm border-t border-gray-200 pt-2">{caption}</p>}

            {/* Modal para reprodução */}
            {isModalOpen && videoSrc && (
                <div className="fixed inset-[-10px] bg-black bg-opacity-70 flex items-center justify-center z-50" onClick={closeModal}>
                    <video src={videoSrc} controls autoPlay className="max-w-[80vw] max-h-[80vh] object-contain" onClick={(e) => e.stopPropagation()} />
                </div>
            )}
        </div>
    );
};

export default VideoDisplayer;