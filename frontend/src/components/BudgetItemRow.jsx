import React, { useState } from 'react';
import { Edit2, Trash2 } from 'lucide-react';
import { DAY_CHOICES } from '../utils/helpers';
import ConfirmationModal from './ConfirmationModal';

const ownerColors = { shared: 'bg-accent/10 text-accent-strong', keith: 'bg-keith-soft text-keith', tild: 'bg-tild-soft text-tild' };
const chip = 'px-2 py-0.5 text-[11px] font-medium rounded-full whitespace-nowrap';

const BudgetItemRow = ({ item, onEditCategory, onDelete, isEditingDisabled = false, hideOwnerBadge = false }) => {
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    // Synthetic repayment mirrors and computed lines (e.g. joint contributions) are derived,
    // so they can't be edited or deleted.
    const isSynthetic = String(item.budget_item_id).includes('-repay-income') || item.is_computed;
    const isClickable = !isSynthetic && !isEditingDisabled;

    const handleRowClick = () => { if (isClickable) onEditCategory(item.budget_item_id); };
    const handleRowKeyDown = (e) => {
        if (isClickable && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onEditCategory(item.budget_item_id);
        }
    };
    const stop = (e) => e.stopPropagation();

    const value = parseFloat(item.effective_value) || 0;
    const amountColor = item.item_type === 'income'
        ? 'text-good'
        : item.item_type === 'savings'
            ? 'text-keith'
            : 'text-ink';

    return (
        <>
            <ConfirmationModal
                isOpen={showDeleteConfirm}
                onClose={() => setShowDeleteConfirm(false)}
                onConfirm={() => { onDelete(item.budget_item_id); setShowDeleteConfirm(false); }}
                title="Delete Item"
                message={`Are you sure you want to delete '${item.item_name}'? This action cannot be undone.`}
            />
            <div
                data-testid={isClickable ? 'budget-row' : undefined}
                className={`group flex items-start gap-3 py-2 border-t border-dashed border-line first:border-t-0 rounded-lg transition-colors ${isClickable ? 'cursor-pointer hover:bg-paper/80' : ''} ${isSynthetic ? 'text-ink-soft' : ''}`}
                onClick={handleRowClick}
                onKeyDown={handleRowKeyDown}
                role={isClickable ? 'button' : undefined}
                tabIndex={isClickable ? 0 : undefined}
            >
                <div className="grow min-w-0">
                    <div className="flex items-center flex-wrap gap-1.5">
                        <span className="font-medium text-sm text-ink truncate">{item.item_name}</span>
                        {!hideOwnerBadge && <span className={`${chip} ${ownerColors[item.owner?.toLowerCase()] || 'bg-line/70 text-ink'}`}>{item.owner}</span>}
                        {item.expense_pot === 'groceries' && <span className={`${chip} bg-good/10 text-good`}>Groceries Pot</span>}
                        {item.is_tab_repayment && <span className={`${chip} bg-accent/10 text-accent-strong`}>Tab Repayment</span>}
                        {item.is_extra && <span className={`${chip} bg-warn-soft text-warn`}>Extra</span>}
                        {item.is_auto_extra && <span className={`${chip} bg-warn-soft text-warn`}>Monthly buffer</span>}
                        {item.childcare_link === 'ellis_nursery' && <span className={`${chip} bg-good/10 text-good`}>Linked: Ellis nursery</span>}
                        {item.childcare_link === 'gaspard_care' && <span className={`${chip} bg-good/10 text-good`}>Linked: Gaspard clubs</span>}
                        {item.childcare_link === 'gaspard_holiday' && <span className={`${chip} bg-good/10 text-good`}>Linked: Gaspard holiday</span>}
                        {item.is_one_off && <span className={`${chip} bg-warn-soft text-warn`}>One-off</span>}
                        {isEditingDisabled && !isSynthetic && <span className={`${chip} bg-line/70 text-ink-soft`}>Locked</span>}
                    </div>
                    {item.calculation_type === 'weekly_count' && (
                        <p className="text-[11px] text-ink-faint mt-0.5">
                            Weekly on {DAY_CHOICES[item.weekly_payment_day] || 'unknown day'}{item.occurrences != null ? ` · ${item.occurrences} occurrences` : ''}
                        </p>
                    )}
                </div>
                <div className="relative flex-shrink-0 flex items-center justify-end">
                    <span className={`text-sm font-semibold num text-right ${amountColor} ${isClickable ? 'transition-opacity md:group-hover:opacity-0' : ''}`}>£{value.toFixed(2)}</span>
                    {isClickable && (
                        <>
                            {/* Desktop: actions overlay the amount on hover, so the amount column stays aligned */}
                            <div className="absolute inset-y-0 right-0 hidden md:flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                    onClick={(e) => { stop(e); onEditCategory(item.budget_item_id); }}
                                    className="p-1 text-ink-faint hover:text-accent rounded hover:bg-accent/5 transition-colors"
                                    aria-label="Edit item"
                                >
                                    <Edit2 className="h-3.5 w-3.5" />
                                </button>
                                <button
                                    onClick={(e) => { stop(e); setShowDeleteConfirm(true); }}
                                    className="p-1 text-ink-faint hover:text-danger rounded hover:bg-danger-soft/60 transition-colors"
                                    aria-label="Delete item"
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                </button>
                            </div>
                            {/* Mobile (no hover): a persistent delete, since the edit sheet has no delete */}
                            <button
                                onClick={(e) => { stop(e); setShowDeleteConfirm(true); }}
                                className="md:hidden ml-1.5 p-1 text-ink-faint hover:text-danger rounded"
                                aria-label="Delete item"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </>
                    )}
                </div>
            </div>
        </>
    );
};

export default BudgetItemRow;
