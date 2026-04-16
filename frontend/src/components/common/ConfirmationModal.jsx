import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

const ConfirmationModal = ({ 
    isOpen, 
    onClose, 
    onConfirm, 
    title = 'Confirmar Ação', 
    message = 'Você tem certeza que deseja realizar esta ação?', 
    confirmText = 'Confirmar', 
    cancelText = 'Cancelar',
    variant = 'primary' // 'primary' | 'danger'
}) => {
    if (!isOpen) return null;

    const variantClasses = {
        primary: 'bg-brand-primary hover:bg-brand-primary-active text-white',
        danger: 'bg-red-600 hover:bg-red-700 text-white'
    };

    return (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-[100] p-4 animate-fade-in" onClick={onClose}>
            <div 
                className="bg-white/95 backdrop-blur-xl rounded-[2.5rem] shadow-[0_30px_80px_rgba(0,0,0,0.2)] w-full max-w-md overflow-hidden animate-fade-in-up-fast border border-white"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex justify-between items-center p-8 border-b border-slate-100 bg-slate-50/50">
                    <div className="flex items-center gap-3">
                        {variant === 'danger' && (
                            <div className="w-10 h-10 rounded-2xl bg-red-100 flex items-center justify-center text-red-600">
                                <AlertTriangle size={20} />
                            </div>
                        )}
                        <h3 className="text-xl font-black tracking-tight text-slate-800 executive-title">{title}</h3>
                    </div>
                </div>

                {/* Body */}
                <div className="p-8">
                    <p className="text-slate-600 text-sm font-medium leading-relaxed">
                        {message}
                    </p>
                </div>

                {/* Footer */}
                <div className="p-8 pt-0 flex flex-col sm:flex-row justify-end gap-3">
                    <button 
                        onClick={onClose}
                        className="px-6 py-4 text-[11px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-900 transition-all order-2 sm:order-1"
                    >
                        {cancelText}
                    </button>
                    <button 
                        onClick={() => {
                            onConfirm();
                            onClose();
                        }}
                        className={`px-8 py-4 text-[11px] font-black uppercase tracking-widest rounded-2xl transition-all shadow-xl order-1 sm:order-2 ${
                            variant === 'danger' 
                            ? 'bg-red-600 text-white hover:bg-red-700 shadow-red-200/50' 
                            : 'bg-brand-primary text-white hover:bg-brand-primary-active shadow-brand-primary/20'
                        }`}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmationModal;
