import React, { useEffect } from 'react';
import { Download, X, Film, Image as ImageIcon, Music } from 'lucide-react';

const MediaModal = ({ isOpen, onClose, mediaUrl, mediaType, filename }) => {
    
    if (!isOpen || !mediaUrl) return null;

    const handleDownload = async () => {
        try {
            const link = document.createElement('a');
            link.href = mediaUrl;
            link.download = filename || (mediaType === 'audio' ? 'audio.ogg' : mediaType === 'video' ? 'video.mp4' : 'imagem.png');
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (error) {
            console.error("[MediaModal] Erro ao tentar baixar:", error);
            alert("Não foi possível iniciar o download.");
        }
    };

    return (
        <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-[70] p-4 animate-fade-in"
            onClick={onClose}
        >
            <div
                className="bg-white/95 backdrop-blur-xl rounded-[2.5rem] p-6 w-full max-w-4xl max-h-[90vh] overflow-hidden relative border border-white shadow-2xl flex flex-col items-center animate-fade-in-up-fast"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Cabeçalho do Modal */}
                <div className="w-full flex justify-between items-center mb-6">
                    <div className="flex flex-col">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-600 mb-0.5">{mediaType}</p>
                        <h4 className="text-[14px] font-bold text-slate-800 truncate max-w-xs">{filename || `Arquivo de ${mediaType}`}</h4>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-10 h-10 flex items-center justify-center rounded-2xl bg-slate-100 text-slate-400 hover:bg-red-50 hover:text-red-500 transition-all shadow-sm"
                        title="Fechar"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Conteúdo da Mídia */}
                <div className="flex-1 w-full flex items-center justify-center overflow-auto rounded-3xl bg-slate-50/50 border border-slate-100 p-2 min-h-[300px]">
                    {mediaType === 'image' && (
                        <img
                            src={mediaUrl}
                            alt={filename || 'Imagem'}
                            className="max-w-full max-h-[60vh] object-contain rounded-xl shadow-lg"
                        />
                    )}
                    {mediaType === 'audio' && (
                        <div className="w-full max-w-md p-10 flex flex-col items-center">
                            <div className="w-24 h-24 rounded-[2.5rem] bg-indigo-50 text-indigo-600 flex items-center justify-center mb-8 shadow-inner border border-indigo-100/50">
                                <Music size={40} />
                            </div>
                            <audio
                                src={mediaUrl}
                                controls
                                className="w-full h-10"
                            />
                        </div>
                    )}
                    {mediaType === 'video' && (
                        <video
                            src={mediaUrl}
                            controls
                            className="max-w-full max-h-[60vh] object-contain rounded-xl shadow-lg"
                        />
                    )}
                </div>

                {/* Ações Inferiores */}
                <div className="w-full mt-8 flex justify-center">
                    <button
                        onClick={handleDownload}
                        className="group flex items-center justify-center gap-3 px-10 py-4 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest text-[11px] hover:bg-blue-600 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-slate-200"
                    >
                        <Download size={18} className="transition-transform group-hover:-translate-y-1" /> Baixar {mediaType}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MediaModal;