import React, { useState, useEffect, useRef } from 'react';
import { Loader2, Play, AlertCircle, X } from 'lucide-react';
import api from '../../api/axiosConfig';
import { formatWhatsAppText } from '../../utils/formatters';

const VideoDisplayer = ({ atendimentoId, mediaId, caption }) => {
    const [videoSrc, setVideoSrc] = useState(null);
    const [loadState, setLoadState] = useState('idle'); // 'idle', 'loading', 'loaded', 'error'
    const [isModalOpen, setIsModalOpen] = useState(false);
    const videoBlobUrlRef = useRef(null);
    const displayerRef = useRef(null);

    useEffect(() => {
        return () => {
            if (videoBlobUrlRef.current) {
                URL.revokeObjectURL(videoBlobUrlRef.current);
            }
        };
    }, []);

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
        <div ref={displayerRef} className="space-y-3 w-[280px] sm:w-[320px] md:w-[360px]">
            <div className="relative aspect-[4/3] bg-black/5 rounded-[1.5rem] overflow-hidden shadow-2xl shadow-blue-900/5 cursor-pointer group border border-white/10" onClick={openModal}>
                {(loadState === 'loading' || loadState === 'idle') && <MediaSkeleton />}
                
                {loadState === 'error' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50 text-red-300">
                        <AlertCircle size={24} />
                        <span className="text-[10px] font-black uppercase mt-2">Falha no carregamento</span>
                    </div>
                )}
                
                {loadState === 'loaded' && videoSrc && (
                    <>
                        <video src={videoSrc} muted playsInline className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-blue-900/20 flex items-center justify-center transition-all group-hover:bg-blue-900/40">
                            <div className="w-16 h-16 bg-white/30 backdrop-blur-xl rounded-full flex items-center justify-center shadow-2xl scale-90 group-hover:scale-100 transition-transform duration-500">
                                <Play className="text-white fill-white ml-1" size={28} />
                            </div>
                        </div>
                    </>
                )}
            </div>


            {caption && (
                <div className="px-2">
                    <p className="text-[13px] leading-relaxed text-slate-600 font-bold italic opacity-80">{formatWhatsAppText(caption)}</p>
                </div>
            )}

            {isModalOpen && videoSrc && (
                <div className="fixed inset-0 bg-slate-900/95 backdrop-blur-2xl flex items-center justify-center z-[9999] p-4 md:p-10" onClick={closeModal}>
                    <button onClick={closeModal} className="absolute top-10 right-10 w-12 h-12 flex items-center justify-center rounded-3xl bg-white/10 text-white hover:bg-white/20 transition-all">
                        <X size={24} />
                    </button>
                    <video src={videoSrc} controls autoPlay className="max-w-full max-h-full rounded-3xl shadow-2xl shadow-black/50" onClick={(e) => e.stopPropagation()} />
                </div>
            )}
        </div>
    );
};

export default VideoDisplayer;