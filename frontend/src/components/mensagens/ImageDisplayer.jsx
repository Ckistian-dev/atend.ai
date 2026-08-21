import React, { useState, useEffect, useRef } from 'react';
import { Loader2, X, AlertCircle, Image as ImageIcon } from 'lucide-react';
import api from '../../api/axiosConfig';
import { formatWhatsAppText } from '../../utils/formatters';

const ImageDisplayer = ({ atendimentoId, mediaId, caption, filename }) => {
    const [imageSrc, setImageSrc] = useState(null);
    const [loadState, setLoadState] = useState('idle'); // 'idle', 'loading', 'loaded', 'error'
    const [isModalOpen, setIsModalOpen] = useState(false);
    const imageBlobUrlRef = useRef(null);
    const displayerRef = useRef(null);

    useEffect(() => {
        return () => {
            if (imageBlobUrlRef.current) {
                URL.revokeObjectURL(imageBlobUrlRef.current);
            }
        };
    }, []);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                const entry = entries[0];
                if (entry.isIntersecting && loadState === 'idle') {
                    loadImage();
                    if (displayerRef.current) {
                        observer.unobserve(displayerRef.current);
                    }
                }
            },
            { rootMargin: '400px' }
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

    const loadImage = async () => {
        if (!mediaId || mediaId === 'null' || mediaId === 'undefined' || !atendimentoId) {
            setLoadState('error');
            return;
        }
        if (loadState !== 'idle') return;
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
            setLoadState('error');
        }
    };

    const openModal = () => setIsModalOpen(true);
    const closeModal = () => setIsModalOpen(false);

    const MediaSkeleton = () => (
        <div className="absolute inset-0 bg-slate-200/40 overflow-hidden backdrop-blur-sm">
            <div className="w-full h-full animate-shimmer opacity-50" />
            <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center shadow-lg">
                    <Loader2 className="animate-spin text-white/80" size={24} />
                </div>
            </div>
        </div>
    );

    return (
        <div ref={displayerRef} className="w-full min-w-[240px] max-w-[320px] sm:max-w-[360px] space-y-2">
            <div 
                className="relative aspect-video bg-black/10 rounded-2xl overflow-hidden shadow-md cursor-pointer group border border-white/10"
                onClick={openModal}
            >
                {(loadState === 'loading' || loadState === 'idle') && <MediaSkeleton />}

                {loadState === 'error' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-100/20 text-red-300">
                        <AlertCircle size={24} />
                        <span className="text-[10px] font-bold uppercase mt-2 tracking-wider">Falha na imagem</span>
                    </div>
                )}

                {loadState === 'loaded' && imageSrc && (
                    <img
                        src={imageSrc}
                        alt="Imagem enviada"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                )}
            </div>

            {caption && (
                <div className="px-1 pt-1">
                    <p className="text-[13px] leading-relaxed text-inherit font-medium opacity-90">{formatWhatsAppText(caption)}</p>
                </div>
            )}

            {isModalOpen && imageSrc && (
                <div className="fixed inset-[-25px] backdrop-blur-3xl bg-white/5 flex items-center justify-center z-[9999] p-4 sm:p-8" onClick={closeModal}>
                    <button onClick={closeModal} className="absolute top-4 right-4 sm:top-8 sm:right-8 w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center rounded-2xl sm:rounded-3xl bg-white/10 text-white hover:bg-white/20 transition-all z-[10000]">
                        <X size={24} />
                    </button>
                    <div className="flex flex-col items-center gap-4 max-w-[95vw]" onClick={(e) => e.stopPropagation()}>
                        <img src={imageSrc} alt="Visualização" className="max-h-[80vh] object-contain rounded-2xl sm:rounded-3xl shadow-2xl shadow-black/50" />
                        {filename && (
                            <div className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-black/40 backdrop-blur-md border border-white/10 text-white">
                                <ImageIcon size={16} className="text-white/80" />
                                <span className="text-sm font-black tracking-wide truncate max-w-xs sm:max-w-md">{filename}</span>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ImageDisplayer;