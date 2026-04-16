import React, { useState, useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import api from '../../api/axiosConfig';

const AudioPlayer = ({ atendimentoId, mediaId, transcription, isAssistant }) => {
    const [audioSrc, setAudioSrc] = useState(null);
    // --- ALTERADO: O estado de loading agora começa como 'idle' ---
    const [loadState, setLoadState] = useState('idle'); // 'idle', 'loading', 'loaded', 'error'

    const playerRef = useRef(null); // Ref para o container do player
    const audioBlobUrlRef = useRef(null);

    // Limpa a URL do blob quando o componente é desmontado para evitar vazamentos de memória
    useEffect(() => {
        return () => {
            if (audioBlobUrlRef.current) {
                URL.revokeObjectURL(audioBlobUrlRef.current);
            }
        };
    }, []);

    // --- NOVO: Efeito com IntersectionObserver para carregar o áudio quando visível ---
    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                // Pega a primeira (e única) entrada
                const entry = entries[0];
                // Se o componente estiver visível e o áudio ainda não foi carregado
                if (entry.isIntersecting && loadState === 'idle') {
                    // Inicia o carregamento
                    loadAudio();
                    // Para de observar este elemento para não carregar de novo
                    if (playerRef.current) {
                        observer.unobserve(playerRef.current);
                    }
                }
            },
            {
                rootMargin: '0px', // Inicia o carregamento assim que o elemento toca a viewport
                threshold: 0.1      // Pelo menos 10% do elemento visível
            }
        );

        // Começa a observar o elemento do player
        if (playerRef.current) {
            observer.observe(playerRef.current);
        }

        // Função de limpeza para desconectar o observer quando o componente for desmontado
        return () => {
            if (playerRef.current) {
                observer.unobserve(playerRef.current);
            }
        };
    }, [loadState]); // A dependência garante que não vamos re-observar desnecessariamente

    // --- ALTERADO: A função agora não precisa de 'autoPlay' e gerencia estados de erro ---
    const loadAudio = async () => {
        // Previne múltiplos carregamentos
        if (loadState !== 'idle') return;

        setLoadState('loading');
        try {
            const response = await api.get(`/atendimentos/${atendimentoId}/media/${mediaId}`, {
                responseType: 'blob',
            });
            const blob = response.data;
            const blobUrl = URL.createObjectURL(blob);
            audioBlobUrlRef.current = blobUrl;
            setAudioSrc(blobUrl);
            setLoadState('loaded');
        } catch (error) {
            console.error("Erro ao carregar áudio inline:", error);
            setLoadState('error');
        }
    };

    return (
        // --- ALTERADO: Adicionada a ref ao container principal e min-width para evitar colapso ---
        <div
            ref={playerRef}
            className="space-y-2 p-1 rounded-xl transition-all duration-300 min-w-[260px] md:min-w-[300px] bg-white/50 backdrop-blur-sm shadow-sm"
        >
            <div className="w-full h-11 flex items-center">
                {loadState === 'loading' || loadState === 'idle' ? (
                    <div className="flex items-center justify-center w-full h-11 rounded-xl group bg-slate-100/50 text-slate-400">
                        <Loader2 size={18} className="animate-spin mr-3 text-blue-500" />
                        <span className="text-[11px] font-black uppercase tracking-widest">Carregando...</span>
                    </div>
                ) : loadState === 'error' ? (
                    <div className="flex items-center justify-center w-full h-11 rounded-xl border border-red-100 bg-red-50 text-red-500 text-[11px] font-black uppercase tracking-widest">
                        Falha no carregamento
                    </div>
                ) : (
                    <audio
                        src={audioSrc}
                        controls
                        className="w-full h-9 audio-player-custom"
                    />
                )}
            </div>

            {transcription && (
                <div className={`pt-2 border-t ${isAssistant ? 'border-white/10' : 'border-slate-200/60'}`}>
                    <p className={`text-[13px] leading-relaxed font-medium italic ${isAssistant ? 'text-white/90' : 'text-slate-600'}`}>
                        "{transcription}"
                    </p>
                </div>
            )}
        </div>
    );
};

export default AudioPlayer;
