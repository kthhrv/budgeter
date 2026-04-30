import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { PlusCircle, Trash2, Wallet, ArrowRightLeft } from 'lucide-react';
import apiService from '../services/api';

const TabsPage = ({ showToast }) => {
    const [data, setData] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [showItemForm, setShowItemForm] = useState(false);
    const [showRepaymentForm, setShowRepaymentForm] = useState(false);
    const [itemForm, setItemForm] = useState({ description: '', paid_by: 'tild', total_cost: '', amount_owed: '', date_added: new Date().toISOString().slice(0, 10) });
    const [repaymentForm, setRepaymentForm] = useState({ amount: '', paid_by: 'keith', date: new Date().toISOString().slice(0, 10), note: '' });

    const fetchData = useCallback(async () => {
        try {
            const result = await apiService.getTabs();
            setData(result);
        } catch (err) {
            console.error('Failed to load tabs', err);
            showToast('Failed to load tabs', 'error');
        } finally {
            setIsLoading(false);
        }
    }, [showToast]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleCostChange = (value) => {
        setItemForm(prev => ({
            ...prev,
            total_cost: value,
            amount_owed: value ? (parseFloat(value) / 2).toFixed(2) : ''
        }));
    };

    const handleAddItem = async (e) => {
        e.preventDefault();
        try {
            await apiService.createTabItem({
                ...itemForm,
                total_cost: parseFloat(itemForm.total_cost),
                amount_owed: parseFloat(itemForm.amount_owed),
            });
            setShowItemForm(false);
            setItemForm({ description: '', paid_by: 'tild', total_cost: '', amount_owed: '', date_added: new Date().toISOString().slice(0, 10) });
            showToast('Item added');
            fetchData();
        } catch { showToast('Failed to add item', 'error'); }
    };

    const handleAddRepayment = async (e) => {
        e.preventDefault();
        try {
            await apiService.createTabRepayment({
                ...repaymentForm,
                amount: parseFloat(repaymentForm.amount),
            });
            setShowRepaymentForm(false);
            setRepaymentForm({ amount: '', paid_by: 'keith', date: new Date().toISOString().slice(0, 10), note: '' });
            showToast('Repayment logged');
            fetchData();
        } catch { showToast('Failed to log repayment', 'error'); }
    };

    const handleDeleteItem = async (id) => {
        try {
            await apiService.deleteTabItem(id);
            showToast('Item removed');
            fetchData();
        } catch { showToast('Failed to delete item', 'error'); }
    };

    const handleDeleteRepayment = async (id) => {
        try {
            await apiService.deleteTabRepayment(id);
            showToast('Repayment removed');
            fetchData();
        } catch { showToast('Failed to delete repayment', 'error'); }
    };

    // Compute which items are fully paid off using net balance logic
    // Items from the side that is a net debtor are auto-crossed off,
    // items from the creditor side are crossed off oldest-first using repayments + cross-offsets
    const paidOffIds = useMemo(() => {
        if (!data) return new Set();
        const ids = new Set();

        const { total_owed_to_keith, total_owed_to_tild, total_repaid_by_keith, total_repaid_by_tild } = data;
        // Positive = Keith owes Tild
        const net = total_owed_to_tild - total_owed_to_keith - total_repaid_by_keith + total_repaid_by_tild;

        const tildItems = [...data.items].filter(i => i.paid_by === 'tild').sort((a, b) => a.date_added.localeCompare(b.date_added));
        const keithItems = [...data.items].filter(i => i.paid_by === 'keith').sort((a, b) => a.date_added.localeCompare(b.date_added));

        if (net > 0) {
            // Keith owes Tild → all Keith items are fully offset
            keithItems.forEach(i => ids.add(i.id));
            // Tild items covered by: keith repayments + keith items (cross-offset) - tild repayments
            let pool = total_repaid_by_keith + total_owed_to_keith - total_repaid_by_tild;
            for (const item of tildItems) {
                const owed = parseFloat(item.amount_owed);
                if (pool >= owed) { ids.add(item.id); pool -= owed; } else break;
            }
        } else if (net < 0) {
            // Tild owes Keith → all Tild items are fully offset
            tildItems.forEach(i => ids.add(i.id));
            // Keith items covered by: tild repayments + tild items (cross-offset) - keith repayments
            let pool = total_repaid_by_tild + total_owed_to_tild - total_repaid_by_keith;
            for (const item of keithItems) {
                const owed = parseFloat(item.amount_owed);
                if (pool >= owed) { ids.add(item.id); pool -= owed; } else break;
            }
        } else {
            // Exactly settled
            data.items.forEach(i => ids.add(i.id));
        }

        return ids;
    }, [data]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
        );
    }

    if (!data) return null;

    const balanceColor = data.net_balance > 0 ? 'text-blue-700' : data.net_balance < 0 ? 'text-pink-700' : 'text-emerald-700';
    const balanceBg = data.net_balance > 0 ? 'bg-blue-50 border-blue-200' : data.net_balance < 0 ? 'bg-pink-50 border-pink-200' : 'bg-emerald-50 border-emerald-200';

    return (
        <div className="space-y-6">
            {/* Balance Summary */}
            <div className={`p-6 rounded-xl border-2 ${balanceBg} text-center`}>
                <div className="flex items-center justify-center gap-2 mb-1">
                    <ArrowRightLeft className={`h-5 w-5 ${balanceColor}`} />
                    <span className="text-sm font-medium text-gray-500">Net Balance</span>
                </div>
                <p className={`text-2xl font-extrabold ${balanceColor}`}>{data.net_description}</p>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
                {/* Tab Items */}
                <div className="bg-white rounded-xl shadow-md border border-gray-100 p-5">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold text-gray-800">Expenses</h3>
                        <button onClick={() => setShowItemForm(f => !f)} className="p-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:from-indigo-700 hover:to-purple-700 active:scale-[0.98] transition-all">
                            <PlusCircle className="h-4 w-4" />
                        </button>
                    </div>

                    {showItemForm && (
                        <form onSubmit={handleAddItem} className="mb-4 p-4 bg-gray-50 rounded-lg space-y-3">
                            <input type="text" placeholder="Description" value={itemForm.description} onChange={e => setItemForm(f => ({ ...f, description: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-indigo-400" required />
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-gray-500 mb-1 block">Total cost</label>
                                    <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">£</span>
                                        <input type="number" step="0.01" placeholder="0.00" value={itemForm.total_cost} onChange={e => handleCostChange(e.target.value)} className="w-full rounded-lg border border-gray-200 pl-7 pr-3 py-2 text-sm outline-none focus:border-indigo-400" required />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500 mb-1 block">Amount owed</label>
                                    <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">£</span>
                                        <input type="number" step="0.01" placeholder="0.00" value={itemForm.amount_owed} onChange={e => setItemForm(f => ({ ...f, amount_owed: e.target.value }))} className="w-full rounded-lg border border-gray-200 pl-7 pr-3 py-2 text-sm outline-none focus:border-indigo-400" required />
                                    </div>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-gray-500 mb-1 block">Paid by</label>
                                    <select value={itemForm.paid_by} onChange={e => setItemForm(f => ({ ...f, paid_by: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-indigo-400">
                                        <option value="keith">Keith</option>
                                        <option value="tild">Tild</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500 mb-1 block">Date</label>
                                    <input type="date" value={itemForm.date_added} onChange={e => setItemForm(f => ({ ...f, date_added: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-indigo-400" required />
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button type="button" onClick={() => setShowItemForm(false)} className="flex-1 py-2 text-sm font-semibold text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
                                <button type="submit" className="flex-1 py-2 text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-purple-600 rounded-lg hover:from-indigo-700 hover:to-purple-700">Add</button>
                            </div>
                        </form>
                    )}

                    <div className="space-y-2">
                        {data.items.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No expenses yet</p>}
                        {data.items.map(item => {
                            const isPaidOff = paidOffIds.has(item.id);
                            return (
                            <div key={item.id} className={`flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:shadow-sm transition-shadow group ${isPaidOff ? 'opacity-50' : ''}`}>
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className={`font-semibold text-sm truncate ${isPaidOff ? 'line-through text-gray-400' : 'text-gray-800'}`}>{item.description}</span>
                                        <span className={`px-1.5 py-0.5 text-xs font-semibold rounded-full ${item.paid_by === 'keith' ? 'bg-blue-100 text-blue-800' : 'bg-pink-100 text-pink-800'}`}>{item.paid_by}</span>
                                    </div>
                                    <p className="text-xs text-gray-400 mt-0.5">{item.date_added} · Total: £{parseFloat(item.total_cost).toFixed(2)}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={`text-sm font-bold ${isPaidOff ? 'line-through text-gray-400' : 'text-red-600'}`}>£{parseFloat(item.amount_owed).toFixed(2)}</span>
                                    <button onClick={() => handleDeleteItem(item.id)} className="p-1 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            </div>
                            );
                        })}
                    </div>
                </div>

                {/* Repayments */}
                <div className="bg-white rounded-xl shadow-md border border-gray-100 p-5">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold text-gray-800">Repayments</h3>
                        <button onClick={() => setShowRepaymentForm(f => !f)} className="p-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:from-indigo-700 hover:to-purple-700 active:scale-[0.98] transition-all">
                            <PlusCircle className="h-4 w-4" />
                        </button>
                    </div>

                    {showRepaymentForm && (
                        <form onSubmit={handleAddRepayment} className="mb-4 p-4 bg-gray-50 rounded-lg space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-gray-500 mb-1 block">Amount</label>
                                    <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">£</span>
                                        <input type="number" step="0.01" placeholder="0.00" value={repaymentForm.amount} onChange={e => setRepaymentForm(f => ({ ...f, amount: e.target.value }))} className="w-full rounded-lg border border-gray-200 pl-7 pr-3 py-2 text-sm outline-none focus:border-indigo-400" required />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500 mb-1 block">Paid by</label>
                                    <select value={repaymentForm.paid_by} onChange={e => setRepaymentForm(f => ({ ...f, paid_by: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-indigo-400">
                                        <option value="keith">Keith</option>
                                        <option value="tild">Tild</option>
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-gray-500 mb-1 block">Date</label>
                                    <input type="date" value={repaymentForm.date} onChange={e => setRepaymentForm(f => ({ ...f, date: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-indigo-400" required />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500 mb-1 block">Note (optional)</label>
                                    <input type="text" placeholder="e.g. Bank transfer" value={repaymentForm.note} onChange={e => setRepaymentForm(f => ({ ...f, note: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-indigo-400" />
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button type="button" onClick={() => setShowRepaymentForm(false)} className="flex-1 py-2 text-sm font-semibold text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
                                <button type="submit" className="flex-1 py-2 text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-purple-600 rounded-lg hover:from-indigo-700 hover:to-purple-700">Add</button>
                            </div>
                        </form>
                    )}

                    <div className="space-y-2">
                        {data.repayments.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No repayments yet</p>}
                        {data.repayments.map(r => (
                            <div key={r.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:shadow-sm transition-shadow group">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="font-semibold text-sm text-emerald-700">£{parseFloat(r.amount).toFixed(2)}</span>
                                        <span className={`px-1.5 py-0.5 text-xs font-semibold rounded-full ${r.paid_by === 'keith' ? 'bg-blue-100 text-blue-800' : 'bg-pink-100 text-pink-800'}`}>{r.paid_by}</span>
                                        {r.is_auto && <span className="px-1.5 py-0.5 text-xs font-semibold rounded-full bg-indigo-100 text-indigo-800">Auto</span>}
                                    </div>
                                    <p className="text-xs text-gray-400 mt-0.5">{r.date}{r.note ? ` · ${r.note}` : ''}</p>
                                </div>
                                {!r.is_auto && <button onClick={() => handleDeleteRepayment(r.id)} className="p-1 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                                    <Trash2 className="h-3.5 w-3.5" />
                                </button>}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TabsPage;
