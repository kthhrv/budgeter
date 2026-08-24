import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { X, Trash2 } from 'lucide-react';
import { formatDate, DAY_CHOICES, BILL_CATEGORIES, money, weekdayOccurrencesInMonth } from '../utils/helpers';
import ConfirmationModal from './ConfirmationModal';

const EMPTY = {
    item_name: '', item_type: 'expense', owner: 'shared', expense_pot: '', category: '',
    is_tab_repayment: false, is_extra: false, childcare_link: '', is_auto_extra: false,
    calculation_type: 'fixed', weekly_payment_day: '', value: '', is_one_off: false,
    last_payment_month_id: '',
};

const OWNER_OPTIONS = [
    { value: 'shared', label: 'Joint', active: 'bg-white text-violet-700 shadow-sm' },
    { value: 'keith', label: 'Keith', active: 'bg-white text-blue-700 shadow-sm' },
    { value: 'tild', label: 'Tild', active: 'bg-white text-pink-700 shadow-sm' },
];

// Apply the same field interdependencies the flat form used to enforce inline.
function applyRules(next, name) {
    if (name === 'is_tab_repayment' && next.is_tab_repayment && next.owner === 'shared') next.owner = 'keith';
    if (name === 'owner' && next.owner === 'shared') next.is_tab_repayment = false;
    if (name === 'owner' && next.owner !== 'shared') next.is_auto_extra = false;
    if (name === 'item_type' && next.item_type !== 'expense') {
        next.expense_pot = ''; next.category = ''; next.is_tab_repayment = false;
        next.is_extra = false; next.childcare_link = ''; next.is_auto_extra = false;
    }
    if (name === 'expense_pot' && next.expense_pot !== '') { next.is_extra = false; next.is_auto_extra = false; }
    if (name === 'is_extra' && !next.is_extra) next.is_auto_extra = false;
    if (name === 'is_auto_extra' && next.is_auto_extra) { next.is_extra = true; next.childcare_link = ''; next.expense_pot = ''; }
    return next;
}

function Segmented({ options, value, onChange, ariaLabel }) {
    return (
        <div role="group" aria-label={ariaLabel} className="grid grid-flow-col auto-cols-fr gap-1 p-1 bg-gray-100 rounded-xl">
            {options.map(o => {
                const on = value === o.value;
                return (
                    <button key={o.value} type="button" aria-pressed={on} onClick={() => onChange(o.value)}
                        className={`px-2 py-2 rounded-lg text-sm font-semibold transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400 ${on ? (o.active || 'bg-white text-indigo-700 shadow-sm') : 'text-gray-500 hover:text-gray-700'}`}>
                        {o.label}
                    </button>
                );
            })}
        </div>
    );
}

function Toggle({ checked, onChange, label, hint, name, accent = 'peer-checked:bg-indigo-500' }) {
    return (
        <label className="flex items-center justify-between gap-3 cursor-pointer py-1">
            <span className="min-w-0">
                <span className="block text-sm text-gray-700">{label}</span>
                {hint && <span className="block text-xs text-gray-400">{hint}</span>}
            </span>
            <span className="relative shrink-0">
                <input type="checkbox" name={name} checked={checked} onChange={e => onChange(e.target.checked)} className="sr-only peer" />
                <span className={`block w-10 h-6 bg-gray-200 rounded-full transition-colors ${accent}`}></span>
                <span className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow-sm peer-checked:translate-x-4 transition-transform"></span>
            </span>
        </label>
    );
}

const fieldLabel = 'block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5';
const inputCls = 'block w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-800 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:bg-white outline-none transition-all';

const ItemCategoryModal = ({ item, isOpen, onClose, onSave, onDelete, currentDate }) => {
    const isNew = !item?.budget_item_id;
    const [formData, setFormData] = useState(EMPTY);
    const [hasExpiry, setHasExpiry] = useState(false);
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [errors, setErrors] = useState({});
    const [confirm, setConfirm] = useState(null); // 'delete' | 'discard' | null
    const initialRef = useRef('');
    const dialogRef = useRef(null);
    const now = currentDate || new Date();

    useEffect(() => {
        if (!isOpen) return;
        const data = isNew ? { ...EMPTY } : {
            item_name: item.item_name || '', item_type: item.item_type || 'expense',
            owner: item.owner || 'shared', expense_pot: item.expense_pot || '',
            category: item.category || '',
            is_tab_repayment: item.is_tab_repayment || false, is_extra: item.is_extra || false,
            childcare_link: item.childcare_link || '', is_auto_extra: item.is_auto_extra || false,
            calculation_type: item.calculation_type || 'fixed', weekly_payment_day: item.weekly_payment_day || '',
            last_payment_month_id: item.last_payment_month_id || '', value: item.value ?? '',
            is_one_off: item.is_one_off || false,
        };
        const expiry = !isNew && !!item.last_payment_month_id;
        setFormData(data);
        setHasExpiry(expiry);
        setErrors({});
        setConfirm(null);
        // Auto-open Advanced when the item already uses any advanced field.
        setAdvancedOpen(!!(data.expense_pot || data.is_extra || data.is_tab_repayment || data.childcare_link || expiry));
        initialRef.current = JSON.stringify({ ...data, hasExpiry: expiry });
    }, [item, isOpen, isNew]);

    const update = useCallback((name, value) => {
        setFormData(prev => applyRules({ ...prev, [name]: value }, name));
    }, []);

    const dirty = JSON.stringify({ ...formData, hasExpiry }) !== initialRef.current;

    const requestClose = useCallback(() => {
        if (dirty) setConfirm('discard');
        else onClose();
    }, [dirty, onClose]);

    // Esc to close.
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e) => { if (e.key === 'Escape' && !confirm) { e.preventDefault(); requestClose(); } };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [isOpen, confirm, requestClose]);

    // Focus the name field once when the modal opens. Deliberately depends on
    // [isOpen] only — requestClose is recreated on every keystroke (it closes
    // over `dirty`), and including it here used to reschedule the old focus
    // timer on each keystroke, stealing focus back to Name mid-type. useLayoutEffect
    // runs synchronously after the DOM is committed but before the browser
    // paints, so focus() fires deterministically pre-paint here rather than
    // after an arbitrary delay — a delay of any length is itself racy against
    // fast typing (real or simulated).
    useLayoutEffect(() => {
        if (!isOpen) return;
        dialogRef.current?.querySelector('#item_name')?.focus();
    }, [isOpen]);

    // Minimal focus trap within the dialog.
    const onDialogKeyDown = (e) => {
        if (e.key !== 'Tab') return;
        const f = dialogRef.current?.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!f || !f.length) return;
        const list = Array.from(f).filter(el => !el.disabled && el.offsetParent !== null);
        if (!list.length) return;
        const first = list[0], last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    if (!isOpen) return null;

    const toggleExpiry = (checked) => {
        setHasExpiry(checked);
        if (!checked) update('last_payment_month_id', '');
    };

    const isExpense = formData.item_type === 'expense';
    const parsedValue = parseFloat(formData.value);
    const occurrences = (formData.calculation_type === 'weekly_count' && formData.weekly_payment_day)
        ? weekdayOccurrencesInMonth(now.getFullYear(), now.getMonth(), parseInt(formData.weekly_payment_day, 10))
        : null;
    const weeklyMonthly = occurrences != null && !isNaN(parsedValue) ? occurrences * parsedValue : null;

    const validate = () => {
        const e = {};
        if (!formData.item_name.trim()) e.item_name = 'Give it a name.';
        if (formData.value === '' || isNaN(parsedValue)) e.value = 'Enter an amount.';
        else if (parsedValue < 0) e.value = 'Amount can’t be negative.';
        if (formData.calculation_type === 'weekly_count' && !formData.weekly_payment_day) e.weekly_payment_day = 'Pick a day.';
        setErrors(e);
        return Object.keys(e).length === 0;
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!validate()) return;
        const payload = { ...formData };
        payload.value = parsedValue || 0;
        payload.weekly_payment_day = formData.calculation_type === 'weekly_count' ? parseInt(formData.weekly_payment_day, 10) : null;
        onSave(isNew ? payload : item.budget_item_id, payload);
    };

    const monthName = now.toLocaleString('en-GB', { month: 'long', year: 'numeric' });

    return (
        <>
            <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex justify-center items-end sm:items-center p-0 sm:p-4 animate-fadeIn" onClick={requestClose}>
                <div ref={dialogRef} onKeyDown={onDialogKeyDown} role="dialog" aria-modal="true" aria-labelledby="modal-title"
                    className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col border border-gray-100 animate-slideUp"
                    onClick={(e) => e.stopPropagation()}>

                    {/* Header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
                        <h2 id="modal-title" className="text-lg font-bold text-gray-800">{isNew ? 'New item' : 'Edit item'}</h2>
                        <button type="button" onClick={requestClose} aria-label="Close" className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
                            <X className="h-5 w-5" />
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
                        <div className="overflow-y-auto px-6 py-5 space-y-5">
                            {/* Name */}
                            <div>
                                <label htmlFor="item_name" className={fieldLabel}>Name</label>
                                <input id="item_name" name="item_name" type="text" value={formData.item_name} onChange={e => update('item_name', e.target.value)}
                                    placeholder="e.g. Netflix, Groceries…" className={inputCls} />
                                {errors.item_name && <p className="text-xs text-red-500 mt-1">{errors.item_name}</p>}
                            </div>

                            {/* Type */}
                            <div>
                                <span className={fieldLabel}>Type</span>
                                <Segmented ariaLabel="Type" value={formData.item_type} onChange={v => update('item_type', v)}
                                    options={[{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }, { value: 'savings', label: 'Savings' }]} />
                            </div>

                            {/* Owner */}
                            <div>
                                <span className={fieldLabel}>Owner</span>
                                <Segmented ariaLabel="Owner" value={formData.owner} onChange={v => update('owner', v)}
                                    options={OWNER_OPTIONS.filter(o => !(formData.is_tab_repayment && o.value === 'shared'))} />
                            </div>

                            {/* Category */}
                            {isExpense && (
                                <div>
                                    <label htmlFor="category" className={fieldLabel}>Category</label>
                                    <select id="category" name="category" value={formData.category} onChange={e => update('category', e.target.value)} className={inputCls}>
                                        <option value="">No category</option>
                                        {BILL_CATEGORIES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                    </select>
                                </div>
                            )}

                            {/* Frequency */}
                            <div>
                                <span className={fieldLabel}>Frequency</span>
                                <Segmented ariaLabel="Frequency" value={formData.calculation_type} onChange={v => update('calculation_type', v)}
                                    options={[{ value: 'fixed', label: 'Monthly' }, { value: 'weekly_count', label: 'Weekly' }]} />
                                {formData.calculation_type === 'weekly_count' && (
                                    <div className="mt-2">
                                        <select name="weekly_payment_day" value={formData.weekly_payment_day} onChange={e => update('weekly_payment_day', e.target.value)} className={inputCls}>
                                            <option value="">Which day?</option>
                                            {Object.entries(DAY_CHOICES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                        </select>
                                        {errors.weekly_payment_day && <p className="text-xs text-red-500 mt-1">{errors.weekly_payment_day}</p>}
                                    </div>
                                )}
                            </div>

                            {/* Value */}
                            <div>
                                <label htmlFor="value" className={fieldLabel}>
                                    {formData.is_auto_extra ? 'Buffer amount' : formData.calculation_type === 'weekly_count' ? 'Amount per week' : 'Amount'}
                                </label>
                                <div className="relative">
                                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-semibold text-lg">£</span>
                                    <input id="value" type="number" name="value" step="0.01" inputMode="decimal" value={formData.value}
                                        onChange={e => update('value', e.target.value)}
                                        onFocus={e => e.target.select()}
                                        onWheel={e => e.target.blur()}
                                        placeholder="0.00"
                                        className="block w-full rounded-xl border border-gray-200 bg-gray-50 pl-9 pr-4 py-3 text-lg font-semibold text-gray-800 placeholder-gray-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:bg-white outline-none transition-all" />
                                </div>
                                {errors.value && <p className="text-xs text-red-500 mt-1">{errors.value}</p>}
                                {weeklyMonthly != null && (
                                    <p className="text-xs text-gray-500 mt-1.5">≈ <span className="num font-semibold text-gray-700">{money(weeklyMonthly)}</span> in {monthName} ({occurrences} × {money(parsedValue || 0)})</p>
                                )}
                                {formData.is_auto_extra && (
                                    <p className="text-xs text-gray-500 mt-1.5">Joint income covers the bills first, so the joint Remaining holds at this buffer each month.</p>
                                )}
                            </div>

                            {/* Apply to (edit only) */}
                            {!isNew && (
                                <div>
                                    <span className={fieldLabel}>Apply to</span>
                                    <Segmented ariaLabel="Apply to" value={formData.is_one_off ? 'once' : 'ongoing'}
                                        onChange={v => update('is_one_off', v === 'once')}
                                        options={[{ value: 'ongoing', label: 'From this month on' }, { value: 'once', label: 'Just this month' }]} />
                                    {item?.effective_value != null && (
                                        <p className="text-xs text-gray-400 mt-1.5">
                                            Currently <span className="num">{money(item.effective_value)}</span>
                                            {item.effective_from_month_name ? ` · set ${item.effective_from_month_name}` : ''}
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Advanced */}
                            {(isExpense || hasExpiry) && (
                                <div className="rounded-xl border border-gray-100">
                                    <button type="button" onClick={() => setAdvancedOpen(o => !o)}
                                        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-600">
                                        <span>Advanced options</span>
                                        <span className={`text-gray-400 transition-transform ${advancedOpen ? 'rotate-180' : ''}`}>▾</span>
                                    </button>
                                    {advancedOpen && (
                                        <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
                                            {isExpense && (
                                                <div>
                                                    <span className={fieldLabel}>Pot</span>
                                                    <Segmented ariaLabel="Pot" value={formData.expense_pot || 'none'}
                                                        onChange={v => update('expense_pot', v === 'none' ? '' : v)}
                                                        options={[{ value: 'none', label: 'None' }, { value: 'bills', label: 'Bills' }, { value: 'groceries', label: 'Groceries' }]} />
                                                </div>
                                            )}

                                            {isExpense && formData.owner === 'shared' && !formData.is_tab_repayment && formData.expense_pot === '' && (
                                                <Toggle name="is_extra" checked={formData.is_extra} onChange={v => update('is_extra', v)}
                                                    accent="peer-checked:bg-amber-500"
                                                    label="Extra (buffer in joint, not an expense)" />
                                            )}
                                            {isExpense && formData.owner === 'shared' && !formData.is_tab_repayment && formData.expense_pot === '' && formData.is_extra && (
                                                <Toggle name="is_auto_extra" checked={formData.is_auto_extra} onChange={v => update('is_auto_extra', v)}
                                                    accent="peer-checked:bg-amber-600"
                                                    label="Auto-add this fixed buffer each month" />
                                            )}

                                            {isExpense && (
                                                <Toggle name="is_tab_repayment" checked={formData.is_tab_repayment} onChange={v => update('is_tab_repayment', v)}
                                                    label="Tab repayment"
                                                    hint={formData.owner === 'shared' ? 'Turning this on assigns it to Keith' : undefined} />
                                            )}

                                            {isExpense && !formData.is_auto_extra && (
                                                <div>
                                                    <span className={fieldLabel}>Sync from other tab</span>
                                                    <select name="childcare_link" value={formData.childcare_link} onChange={e => update('childcare_link', e.target.value)} className={inputCls}>
                                                        <option value="">Not linked</option>
                                                        <option value="ellis_nursery">Ellis nursery</option>
                                                        <option value="gaspard_care">Gaspard breakfast/after-school</option>
                                                        <option value="gaspard_holiday">Gaspard holiday club</option>
                                                    </select>
                                                </div>
                                            )}

                                            <Toggle name="has_expiry" checked={hasExpiry} onChange={toggleExpiry} label="Expires" />
                                            {hasExpiry && (
                                                <div>
                                                    <input type="month" name="last_payment_month_id" value={formData.last_payment_month_id}
                                                        onChange={e => update('last_payment_month_id', e.target.value)}
                                                        min={formatDate(new Date(now.getFullYear(), now.getMonth() + 1, 1), 'YYYY-MM')}
                                                        className="block w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-800 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all" />
                                                    <p className="text-xs text-gray-400 mt-1">{formData.last_payment_month_id ? `Last active month: ${new Date(formData.last_payment_month_id + '-01').toLocaleString('default', { month: 'long', year: 'numeric' })}` : 'Pick the last active month'}</p>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="flex items-center gap-3 px-6 py-4 border-t border-gray-100 shrink-0 bg-white rounded-b-2xl">
                            {!isNew && (
                                <button type="button" onClick={() => setConfirm('delete')}
                                    className="p-2.5 rounded-xl text-red-500 hover:bg-red-50 transition-colors" aria-label="Delete item">
                                    <Trash2 className="h-5 w-5" />
                                </button>
                            )}
                            <button type="button" onClick={requestClose} className="flex-1 py-3 px-4 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-all">Cancel</button>
                            <button type="submit" className="flex-1 py-3 px-4 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 shadow-md transition-all">{isNew ? 'Create' : 'Save'}</button>
                        </div>
                    </form>
                </div>
            </div>

            <ConfirmationModal
                isOpen={confirm === 'delete'}
                onClose={() => setConfirm(null)}
                onConfirm={() => { setConfirm(null); onDelete?.(item.budget_item_id); onClose(); }}
                title="Delete item"
                message={`Delete '${formData.item_name || 'this item'}'? This can't be undone.`}
            />
            <ConfirmationModal
                isOpen={confirm === 'discard'}
                onClose={() => setConfirm(null)}
                onConfirm={() => { setConfirm(null); onClose(); }}
                title="Discard changes?"
                message="You have unsaved changes. Close without saving?"
                confirmText="Discard"
            />
        </>
    );
};

export default ItemCategoryModal;
