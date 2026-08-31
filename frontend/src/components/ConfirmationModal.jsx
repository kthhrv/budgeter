import React from 'react';
import { AlertTriangle } from 'lucide-react';

const ConfirmationModal = ({ isOpen, onClose, onConfirm, title, message, confirmText = 'Delete' }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-ink/40 backdrop-blur-sm z-50 flex justify-center items-center p-4" onClick={onClose}>
            <div className="bg-card rounded-2xl border border-line shadow-sm w-full max-w-md overflow-hidden border border-line animate-in" onClick={(e) => e.stopPropagation()}>
                <div className="p-6">
                    <div className="flex items-start gap-4">
                        <div className="flex-shrink-0 flex items-center justify-center h-11 w-11 rounded-full bg-danger-soft">
                            <AlertTriangle className="h-5 w-5 text-danger" aria-hidden="true" />
                        </div>
                        <div className="text-left">
                            <h3 className="text-lg font-bold text-ink">{title}</h3>
                            <p className="text-sm text-ink-soft mt-1.5">{message}</p>
                        </div>
                    </div>
                </div>
                <div className="flex gap-3 px-6 pb-6">
                    <button type="button" onClick={onClose} className="flex-1 py-2.5 px-4 border border-line rounded-xl text-sm font-semibold text-ink-soft hover:bg-paper hover:border-ink-faint transition-all active:scale-[0.98]">
                        Cancel
                    </button>
                    <button type="button" onClick={onConfirm} className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold text-paper bg-danger hover:bg-danger/90 shadow-sm hover:shadow-md transition-all active:scale-[0.98]">
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmationModal;
