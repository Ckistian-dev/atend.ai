import React, { useState, useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import api from '../../api/axiosConfig';

const AudioPlayer = ({ atendimentoId, mediaId, transcription }) => {
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
        // --- ALTERADO: Adicionada a ref ao container principal ---
        <div ref={playerRef} className="space-y-2">
            {/* --- ALTERADO: Lógica de renderização simplificada --- */}
            <div className="w-full h-10">
                {loadState === 'loading' || loadState === 'idle' ? (
                    // Mostra um placeholder de loading enquanto não estiver carregado
                    <div className="flex items-center justify-center h-10 bg-gray-100 rounded-full text-gray-500">
                        <Loader2 size={18} className="animate-spin mr-2" />
                        <span className="text-sm">A carregar áudio...</span>
                    </div>
                ) : loadState === 'error' ? (
                    // Mostra uma mensagem de erro se falhar
                    <div className="flex items-center justify-center h-10 bg-red-100 text-red-600 rounded-full text-sm">Erro ao carregar</div>
                ) : (
                    // Mostra o player de áudio quando estiver pronto
                    <audio src={audioSrc} controls className="w-full h-10" />
                )}
            </div>

            {/* Área da Transcrição */}
            {transcription && (
                <p className="whitespace-pre-wrap text-sm border-t border-gray-200 pt-2">{transcription}</p>
            )}
        </div>
    );
};

export default AudioPlayer;
