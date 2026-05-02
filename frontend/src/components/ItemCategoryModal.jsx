import React, { useState, useEffect } from 'react';
import { formatDate, DAY_CHOICES } from '../utils/helpers';

const ItemCategoryModal = ({ item, isOpen, onClose, onSave }) => {
    const isNew = !item?.budget_item_id;
    const [formData, setFormData] = useState({
        item_name: '', item_type: 'expense', owner: 'shared', expense_pot: '', is_tab_repayment: false, is_extra: false,
        calculation_type: 'fixed', weekly_payment_day: '', value: '', is_one_off: false,
        last_payment_month_id: ''
    });
    const [hasExpiry, setHasExpiry] = useState(false);

    useEffect(() => {
        if (isOpen) {
            if (isNew) {
                setFormData({
                    item_name: '', item_type: 'expense', owner: 'shared', expense_pot: '', is_tab_repayment: false, is_extra: false,
                    calculation_type: 'fixed', weekly_payment_day: '', value: '', is_one_off: false,
                    last_payment_month_id: ''
                });
                setHasExpiry(false);
            } else {
                setFormData({
                    item_name: item.item_name || '',
                    item_type: item.item_type || 'expense',
                    owner: item.owner || 'shared',
                    expense_pot: item.expense_pot || '',
                    is_tab_repayment: item.is_tab_repayment || false,
                    is_extra: item.is_extra || false,
                    calculation_type: item.calculation_type || 'fixed',
                    weekly_payment_day: item.weekly_payment_day || '',
                    last_payment_month_id: item.last_payment_month_id || '',
                    value: item.value || '',
                    is_one_off: item.is_one_off || false
                });
                setHasExpiry(!!item.last_payment_month_id);
            }
        }
    }, [item, isOpen, isNew]);

    const toggleExpiry = (checked) => {
        setHasExpiry(checked);
        if (!checked) {
            setFormData(prev => ({ ...prev, last_payment_month_id: '' }));
        }
    };

    if (!isOpen) return null;

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => {
            const next = { ...prev, [name]: type === 'checkbox' ? checked : value };
            if (name === 'is_tab_repayment' && checked && prev.owner === 'shared') {
                next.owner = 'keith';
            }
            if (name === 'owner' && value === 'shared') {
                next.is_tab_repayment = false;
            }
            if (name === 'item_type' && value !== 'expense') {
                next.expense_pot = '';
                next.is_tab_repayment = false;
                next.is_extra = false;
            }
            if (name === 'expense_pot' && value !== '') {
                next.is_extra = false;
            }
            return next;
        });
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        const payload = { ...formData };
        if (isNew) {
            payload.value = parseFloat(payload.value) || 0;
        }
        if (payload.calculation_type !== 'weekly_count') {
            payload.weekly_payment_day = null;
        } else {
            payload.weekly_payment_day = parseInt(payload.weekly_payment_day, 10);
        }
        onSave(isNew ? payload : item.budget_item_id, payload);
    };

    const OWNER_CHOICES = formData.is_tab_repayment ? ['keith', 'tild'] : ['shared', 'keith', 'tild'];
    const CALCULATION_TYPE_CHOICES = { 'fixed': 'Fixed Monthly', 'weekly_count': 'Weekly Count' };

    return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex justify-center items-center p-4 animate-fadeIn" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-gray-100 animate-slideUp" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-5 rounded-t-2xl">
                    <h2 className="text-xl font-bold text-white">{isNew ? "Create New Budget Item" : "Edit Budget Item"}</h2>
                    <p className="text-indigo-200 text-sm mt-1">{isNew ? "Add a new item to your budget" : "Update the details below"}</p>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    {/* Item Name */}
                    <div>
                        <label htmlFor="item_name" className="block text-sm font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Item Name</label>
                        <input type="text" name="item_name" value={formData.item_name} onChange={handleChange} placeholder="e.g. Netflix, Groceries..." className="block w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-800 placeholder-gray-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:bg-white outline-none transition-all" required />
                    </div>

                    {/* Type & Owner */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label htmlFor="item_type" className="block text-sm font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Type</label>
                            <select name="item_type" value={formData.item_type} onChange={handleChange} className="block w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-800 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:bg-white outline-none transition-all"><option value="expense">Expense</option><option value="income">Income</option><option value="savings">Savings</option></select>
                        </div>
                        <div>
                            <label htmlFor="owner" className="block text-sm font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Owner</label>
                            <select name="owner" value={formData.owner} onChange={handleChange} className="block w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-800 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:bg-white outline-none transition-all">{OWNER_CHOICES.map(o => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}</select>
                        </div>
                    </div>

                    {/* Pot (expenses only) */}
                    {formData.item_type === 'expense' && (
                        <div>
                            <label htmlFor="expense_pot" className="block text-sm font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Pot</label>
                            <select id="expense_pot" name="expense_pot" value={formData.expense_pot} onChange={handleChange} className="block w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-800 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:bg-white outline-none transition-all">
                                <option value="">None</option>
                                <option value="bills">Bills Pot</option>
                                <option value="groceries">Groceries Pot</option>
                            </select>
                        </div>
                    )}

                    {/* Calculation & Payment Day */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label htmlFor="calculation_type" className="block text-sm font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Calculation</label>
                            <select name="calculation_type" value={formData.calculation_type} onChange={handleChange} className="block w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-800 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:bg-white outline-none transition-all">{Object.entries(CALCULATION_TYPE_CHOICES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                        </div>
                        {formData.calculation_type === 'weekly_count' && (
                            <div>
                                <label htmlFor="weekly_payment_day" className="block text-sm font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Payment Day</label>
                                <select name="weekly_payment_day" value={formData.weekly_payment_day} onChange={handleChange} className="block w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-800 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:bg-white outline-none transition-all" required><option value="">Select a day...</option>{Object.entries(DAY_CHOICES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                            </div>
                        )}
                    </div>

                    {/* Value */}
                    <div>
                        <label htmlFor="value" className="block text-sm font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Value</label>
                        <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-semibold text-lg">£</span>
                            <input id="value" type="number" name="value" step="0.01" value={formData.value} onChange={handleChange} placeholder="0.00" className="block w-full rounded-xl border border-gray-200 bg-gray-50 pl-9 pr-4 py-3 text-lg font-semibold text-gray-800 placeholder-gray-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:bg-white outline-none transition-all" required />
                        </div>
                    </div>

                    {/* Options */}
                    <div className="p-4 bg-gradient-to-br from-gray-50 to-indigo-50/30 rounded-xl border border-gray-100">
                        <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">Options</h3>

                        {/* Toggle Switches */}
                        <div className="mt-4 space-y-3">
                            <label htmlFor="is_one_off_new" className="flex items-center justify-between cursor-pointer group">
                                <span className="text-sm text-gray-700 group-hover:text-gray-900 transition-colors">One-off for this month</span>
                                <div className="relative">
                                    <input id="is_one_off_new" type="checkbox" name="is_one_off" checked={formData.is_one_off} onChange={handleChange} className="sr-only peer" />
                                    <div className="w-10 h-6 bg-gray-200 rounded-full peer-checked:bg-indigo-500 transition-colors"></div>
                                    <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow-sm peer-checked:translate-x-4 transition-transform"></div>
                                </div>
                            </label>
                            <label htmlFor="has_expiry" className="flex items-center justify-between cursor-pointer group">
                                <span className="text-sm text-gray-700 group-hover:text-gray-900 transition-colors">Expires</span>
                                <div className="relative">
                                    <input id="has_expiry" type="checkbox" checked={hasExpiry} onChange={(e) => toggleExpiry(e.target.checked)} className="sr-only peer" />
                                    <div className="w-10 h-6 bg-gray-200 rounded-full peer-checked:bg-indigo-500 transition-colors"></div>
                                    <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow-sm peer-checked:translate-x-4 transition-transform"></div>
                                </div>
                            </label>
                            {hasExpiry && (
                                <div className="pl-2">
                                    <input type="month" name="last_payment_month_id" value={formData.last_payment_month_id} onChange={handleChange} min={formatDate(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1), 'YYYY-MM')} className="block w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-800 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all" />
                                    <p className="text-xs text-gray-400 mt-1">{formData.last_payment_month_id ? `Expires after ${new Date(formData.last_payment_month_id + '-01').toLocaleString('default', { month: 'long', year: 'numeric' })}` : 'Pick the last active month'}</p>
                                </div>
                            )}
                            {formData.item_type === 'expense' && formData.owner === 'shared' && !formData.is_tab_repayment && (() => {
                                const extraDisabled = formData.expense_pot !== '';
                                return (
                                    <label htmlFor="is_extra" className={`flex items-center justify-between group ${extraDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`} title={extraDisabled ? 'Extra is not available when a pot is selected' : undefined}>
                                        <span className="text-sm text-gray-700 group-hover:text-gray-900 transition-colors">Extra (buffer in joint account, not an expense)</span>
                                        <div className="relative">
                                            <input id="is_extra" type="checkbox" name="is_extra" checked={formData.is_extra} disabled={extraDisabled} onChange={handleChange} className="sr-only peer" />
                                            <div className="w-10 h-6 bg-gray-200 rounded-full peer-checked:bg-amber-500 transition-colors"></div>
                                            <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow-sm peer-checked:translate-x-4 transition-transform"></div>
                                        </div>
                                    </label>
                                );
                            })()}
                            {formData.item_type === 'expense' && (() => {
                                const tabDisabled = formData.owner === 'shared';
                                return (
                                    <label htmlFor="is_tab_repayment" className={`flex items-center justify-between group ${tabDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`} title={tabDisabled ? 'Tab repayments must be owned by Keith or Tild' : undefined}>
                                        <span className="text-sm text-gray-700 group-hover:text-gray-900 transition-colors">Tab Repayment</span>
                                        <div className="relative">
                                            <input id="is_tab_repayment" type="checkbox" name="is_tab_repayment" checked={formData.is_tab_repayment} disabled={tabDisabled} onChange={handleChange} className="sr-only peer" />
                                            <div className="w-10 h-6 bg-gray-200 rounded-full peer-checked:bg-indigo-500 transition-colors"></div>
                                            <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow-sm peer-checked:translate-x-4 transition-transform"></div>
                                        </div>
                                    </label>
                                );
                            })()}
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 pt-2">
                        <button type="button" onClick={onClose} className="flex-1 py-3 px-4 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all active:scale-[0.98]">Cancel</button>
                        <button type="submit" className="flex-1 py-3 px-4 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 shadow-md hover:shadow-lg transition-all active:scale-[0.98]">{isNew ? 'Create Item' : 'Save Changes'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ItemCategoryModal;
