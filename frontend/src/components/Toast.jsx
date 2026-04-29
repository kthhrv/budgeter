import React, { useState, useEffect } from 'react';
import { CheckCircle, XCircle, X } from 'lucide-react';

const Toast = ({ message, type, onDismiss }) => {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        if (message) {
            setIsVisible(true);
            const timer = setTimeout(() => {
                setIsVisible(false);
                setTimeout(onDismiss, 300);
            }, 3000);
            return () => clearTimeout(timer);
        }
    }, [message, onDismiss]);

    if (!message) return null;

    const typeConfig = {
        success: {
            bg: 'bg-emerald-600',
            icon: <CheckCircle className="h-5 w-5" />,
        },
        error: {
            bg: 'bg-red-600',
            icon: <XCircle className="h-5 w-5" />,
        },
    };

    const config = typeConfig[type] || typeConfig.success;

    return (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
            <div
                className={`pointer-events-auto flex items-center gap-3 px-5 py-3 rounded-xl shadow-2xl text-white ${config.bg} transition-all duration-300 ${
                    isVisible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
                }`}
            >
                {config.icon}
                <span className="text-sm font-medium">{message}</span>
                <button onClick={() => { setIsVisible(false); setTimeout(onDismiss, 300); }} className="ml-2 p-0.5 hover:bg-white/20 rounded-md transition-colors">
                    <X className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
};

export default Toast;
