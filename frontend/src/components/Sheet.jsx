import React, { useEffect } from 'react';
import { X } from 'lucide-react';

// Bottom sheet on phones, centred dialog from `sm` up — the same shell as
// ItemCategoryModal. Escape and a backdrop click close it.
const Sheet = ({ isOpen, onClose, title, children, wide = false, labelId = 'sheet-title' }) => {
    useEffect(() => {
        if (!isOpen) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, onClose]);

    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-ink/40 backdrop-blur-sm z-50 flex justify-center items-end sm:items-center p-0 sm:p-4 animate-fadeIn" onClick={onClose}>
            <div role="dialog" aria-modal="true" aria-labelledby={labelId}
                className={`bg-card rounded-t-2xl sm:rounded-2xl border border-line shadow-sm w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[92vh] flex flex-col animate-slideUp`}
                onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-line shrink-0">
                    <h2 id={labelId} className="text-lg font-bold text-ink">{title}</h2>
                    <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-line/70 transition-colors">
                        <X className="h-5 w-5" />
                    </button>
                </div>
                <div className="overflow-y-auto px-5 py-4">{children}</div>
            </div>
        </div>
    );
};

export default Sheet;
