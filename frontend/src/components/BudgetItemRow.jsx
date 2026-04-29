import React, { useState } from 'react';
import { Edit2, Trash2 } from 'lucide-react';
import { formatDate, DAY_CHOICES } from '../utils/helpers';
import ConfirmationModal from './ConfirmationModal';

const BudgetItemRow = ({ item, onUpdate, onEditCategory, onDelete, currentDate, isEditingDisabled = false, hideOwnerBadge = false }) => {
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const isSynthetic = String(item.budget_item_id).includes('-repay-income');

    const handleDeleteConfirm = () => {
        onDelete(item.budget_item_id);
        setShowDeleteConfirm(false);
    }

    const ownerColors = { shared: 'bg-indigo-100 text-indigo-800', keith: 'bg-blue-100 text-blue-800', tild: 'bg-pink-100 text-pink-800' };

    return (
        <>
            <ConfirmationModal
                isOpen={showDeleteConfirm}
                onClose={() => setShowDeleteConfirm(false)}
                onConfirm={handleDeleteConfirm}
                title="Delete Item"
                message={`Are you sure you want to delete '${item.item_name}'? This action cannot be undone.`}
            />
            <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-all duration-200 mb-3 group">
                <div className="flex items-center justify-between">
                    <div className="grow min-w-0">
                        <div className="flex items-center flex-wrap gap-2">
                            <span className="font-bold text-base text-gray-800 truncate">{item.item_name}</span>
                            <div className="flex items-center gap-1.5 flex-wrap">
                                {!hideOwnerBadge && <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${ownerColors[item.owner.toLowerCase()] || 'bg-gray-100 text-gray-800'}`}>{item.owner}</span>}
                                {item.bills_pot && <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-purple-100 text-purple-800">Bills Pot</span>}
                                {item.groceries_pot && <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-green-100 text-green-800">Groceries Pot</span>}
                                {item.is_one_off && <span className="px-2 py-0.5 text-xs font-semibold bg-amber-100 text-amber-700 rounded-full">One-off</span>}
                            </div>
                        </div>
                        {item.calculation_type === 'weekly_count' && <p className="text-xs text-gray-400 mt-1">Weekly on {DAY_CHOICES[item.weekly_payment_day] || 'unknown day'}{item.occurrences !== undefined && item.occurrences !== null ? ` · ${item.occurrences} occurrences` : ''}</p>}
                    </div>
                    <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                        <span className={`text-lg font-bold ${
                            item.item_type === 'income'
                                ? 'text-emerald-700'
                                : 'text-red-600'
                        }`}>
                            £{(parseFloat(item.effective_value) || 0).toFixed(2)}
                        </span>
                        {!isSynthetic && !isEditingDisabled && (
                            <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => onEditCategory(item.budget_item_id)} className="p-1.5 text-gray-400 hover:text-indigo-600 rounded-md hover:bg-indigo-50 transition-colors"><Edit2 className="h-4 w-4" /></button>
                                <button onClick={() => setShowDeleteConfirm(true)} className="p-1.5 text-gray-400 hover:text-red-600 rounded-md hover:bg-red-50 transition-colors"><Trash2 className="h-4 w-4" /></button>
                            </div>
                        )}
                        {!isSynthetic && isEditingDisabled && (
                            <span className="text-xs text-gray-400 px-2 py-1 bg-gray-50 rounded-md border border-gray-200">Locked</span>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
};

export default BudgetItemRow;
