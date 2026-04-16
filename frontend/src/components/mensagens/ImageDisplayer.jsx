import React, { useState, useEffect, useRef } from 'react';
import { Loader2, X, AlertCircle } from 'lucide-react';
import api from '../../api/axiosConfig';
import { formatWhatsAppText } from '../../utils/formatters';

const ImageDisplayer = ({ atendimentoId, mediaId, caption }) => {
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

    return (
        <div ref={displayerRef} className="space-y-3 w-full max-w-[320px]">
            <div className="relative aspect-[4/3] bg-slate-100 rounded-[2rem] overflow-hidden shadow-2xl shadow-blue-900/5 group border border-black/5">
                {(loadState === 'loading' || loadState === 'idle') && (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-50 animate-pulse">
                        <Loader2 className="animate-spin text-blue-600/30" size={24} />
                    </div>
                )}
                {loadState === 'error' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-red-300">
                        <AlertCircle size={24} />
                        <span className="text-[10px] font-black uppercase mt-2">Falha Mídia</span>
                    </div>
                )}
                {loadState === 'loaded' && imageSrc && (
                    <img
                        src={imageSrc}
                        alt="Interação"
                        className="w-full h-full object-cover cursor-pointer group-hover:scale-105 transition-transform duration-700"
                        onClick={openModal}
                    />
                )}
            </div>

            {caption && (
                <div className="px-2">
                    <p className="text-[13px] leading-relaxed text-slate-600 font-bold italic opacity-80">{formatWhatsAppText(caption)}</p>
                </div>
            )}

            {isModalOpen && imageSrc && (
                <div className="fixed inset-[-25px] backdrop-blur-3xl bg-white/5 flex items-center justify-center z-[9999] p-4 md:p-10" onClick={closeModal}>
                    <button onClick={closeModal} className="absolute top-10 right-10 w-12 h-12 flex items-center justify-center rounded-3xl bg-white/10 text-white hover:bg-white/20 transition-all">
                        <X size={24} />
                    </button>
                    <img src={imageSrc} alt="Visualização" className="max-w-full max-h-full object-contain rounded-3xl shadow-2xl shadow-black/50" onClick={(e) => e.stopPropagation()} />
                </div>
            )}
        </div>
    );
};

export default ImageDisplayer;