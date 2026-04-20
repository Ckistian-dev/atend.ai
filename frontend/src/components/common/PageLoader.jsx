import React from 'react';
import { Loader2 } from 'lucide-react';

const PageLoader = ({ 
    message = "Carregando...", 
    subMessage = "Sincronizando dados em tempo real...",
    fullScreen = true
}) => {
    const content = (
        <div className="flex flex-col items-center gap-10">
            <div className="relative">
                <div className="w-20 h-20 rounded-[32px] bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-2xl shadow-blue-500/40 relative z-10">
                    <Loader2 size={32} className="text-white animate-spin" />
                </div>
                {/* Background Glow Effect */}
                <div className="absolute inset-0 rounded-[32px] bg-blue-400 blur-2xl opacity-20 scale-150 animate-pulse" />
            </div>
            
            <div className="text-center animate-page-loader-fade-in">
                <h2 className="text-slate-800 font-black text-xl tracking-tight mb-2" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                    {message}
                </h2>
                {subMessage && (
                    <p className="text-slate-400 text-sm font-bold uppercase tracking-widest animate-pulse">
                        {subMessage}
                    </p>
                )}
            </div>
            
            <style dangerouslySetInnerHTML={{ __html: `
                @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800&display=swap');
                
                @keyframes page-loader-fade-in {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                
                .animate-page-loader-fade-in {
                    animation: page-loader-fade-in 0.6s ease-out forwards;
                }
            `}} />
        </div>
    );

    if (!fullScreen) {
        return (
            <div className="flex w-full h-full items-center justify-center p-6 bg-[#f8faff]/50 backdrop-blur-sm rounded-3xl">
                {content}
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6 bg-[#f8faff] animate-page-loader-fade-in">
            {content}
        </div>
    );
};

export default PageLoader;
