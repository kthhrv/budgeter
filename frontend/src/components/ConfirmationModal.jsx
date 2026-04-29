import React from 'react';
import { AlertTriangle } from 'lucide-react';

const ConfirmationModal = ({ isOpen, onClose, onConfirm, title, message }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex justify-center items-center p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-100 animate-in" onClick={(e) => e.stopPropagation()}>
                <div className="p-6">
                    <div className="flex items-start gap-4">
                        <div className="flex-shrink-0 flex items-center justify-center h-11 w-11 rounded-full bg-red-100">
                            <AlertTriangle className="h-5 w-5 text-red-600" aria-hidden="true" />
                        </div>
                        <div className="text-left">
                            <h3 className="text-lg font-bold text-gray-900">{title}</h3>
                            <p className="text-sm text-gray-500 mt-1.5">{message}</p>
                        </div>
                    </div>
                </div>
                <div className="flex gap-3 px-6 pb-6">
                    <button type="button" onClick={onClose} className="flex-1 py-2.5 px-4 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all active:scale-[0.98]">
                        Cancel
                    </button>
                    <button type="button" onClick={onConfirm} className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold text-white bg-red-600 hover:bg-red-700 shadow-sm hover:shadow-md transition-all active:scale-[0.98]">
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmationModal;
