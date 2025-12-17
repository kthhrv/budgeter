import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Edit2, PlusCircle, Save, XCircle, MoreVertical, Users, User, DollarSign, TrendingUp, TrendingDown, Wallet, Trash2, AlertTriangle, Home, ChevronDown, Search, X } from 'lucide-react';

// --- Configuration ---
const API_BASE_URL = `${window.location.origin}/api`;

// --- Helper Functions ---
const formatDate = (date, format = 'YYYY-MM') => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    if (format === 'YYYY-MM') {
        return `${year}-${month}`;
    }
    if (format === 'MonthYYYY') {
        return date.toLocaleString('default', { month: 'long', year: 'numeric' });
    }
    return date.toISOString().split('T')[0];
};

const isMonthInPast = (date) => {
    const currentDate = new Date();
    const currentMonthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const targetMonthStart = new Date(date.getFullYear(), date.getMonth(), 1);
    return targetMonthStart < currentMonthStart;
};

// --- API Service ---
const apiService = {
    async createOrGetMonth(date) {
        const monthId = formatDate(date, 'YYYY-MM');
        const payload = { month: monthId };
        const response = await fetch(`${API_BASE_URL}/months/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error('Failed to create or get month');
        return await response.json();
    },
    async getBudgetItemsForMonth(monthId) {
        const response = await fetch(`${API_BASE_URL}/months/${monthId}/items/`);
        if (!response.ok) throw new Error('Failed to fetch budget items');
        return await response.json();
    },
    async getAllBudgetItemCategories() {
        const response = await fetch(`${API_BASE_URL}/budgetitems/`);
        if (!response.ok) throw new Error('Failed to fetch budget item categories');
        return await response.json();
    },
    async getAllMonths() {
        const response = await fetch(`${API_BASE_URL}/months/`);
        if (!response.ok) throw new Error('Failed to fetch months');
        return await response.json();
    },
    async updateBudgetItemValue(monthId, budgetItemId, payload) {
        const response = await fetch(`${API_BASE_URL}/months/${monthId}/items/${budgetItemId}/value/`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Failed to update item value');
        }
        return await response.json();
    },
    async createBudgetItemCategory(monthId, payload) {
        const response = await fetch(`${API_BASE_URL}/months/${monthId}/budgetitems/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error('Failed to create budget item');
        return await response.json();
    },
    async updateBudgetItemCategory(budgetItemId, payload) {
        const response = await fetch(`${API_BASE_URL}/budgetitems/${budgetItemId}/`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error('Failed to update budget item category');
        return await response.json();
    },
    async deleteBudgetItemForMonth(monthId, budgetItemId) {
        const response = await fetch(`${API_BASE_URL}/months/${monthId}/items/${budgetItemId}/`, {
            method: 'DELETE',
        });
        if (!response.ok) {
             throw new Error('Failed to delete budget item');
        }
        return response;
    }
};

// --- Components ---

const Toast = ({ message, type, onDismiss }) => {
    if (!message) return null;
    const baseClasses = "fixed top-5 right-5 p-4 rounded-lg shadow-lg text-white transition-opacity duration-300 z-50";
    const typeClasses = { success: "bg-green-500", error: "bg-red-500" };
    return (
        <div className={`${baseClasses} ${typeClasses[type]}`}>
            <span>{message}</span>
            <button onClick={onDismiss} className="ml-4 font-bold">X</button>
        </div>
    );
};

const LoadingSpinner = () => (
    <div className="flex justify-center items-center p-4">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
    </div>
);

const SearchComponent = ({ searchTerm, onSearchChange, onClearSearch }) => {
    return (
        <div className="relative flex items-center bg-white rounded-lg shadow-md p-2">
            <Search className="h-5 w-5 text-gray-400 ml-2" />
            <input
                type="text"
                placeholder="Search items by name, description, or owner..."
                value={searchTerm}
                onChange={(e) => onSearchChange(e.target.value)}
                className="flex-1 px-3 py-2 text-gray-700 bg-transparent border-none outline-none placeholder-gray-400"
            />
            {searchTerm && (
                <button
                    onClick={onClearSearch}
                    className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                    title="Clear search"
                >
                    <X className="h-4 w-4" />
                </button>
            )}
        </div>
    );
};

const MonthSelector = ({ currentDate, isLoading }) => {
    const changeMonth = (offset) => {
        const newDate = new Date(currentDate);
        newDate.setMonth(currentDate.getMonth() + offset);
        window.location.hash = formatDate(newDate, 'YYYY-MM');
    };

    return (
        <div className="flex items-center justify-between p-4 bg-white shadow-md rounded-lg h-full">
            <button onClick={() => changeMonth(-1)} className="p-2 rounded-full hover:bg-gray-200 disabled:opacity-50" disabled={isLoading}>
                <ChevronLeft className="h-6 w-6" />
            </button>
            <h2 className="text-xl md:text-2xl font-bold text-gray-800">{formatDate(currentDate, 'MonthYYYY')}</h2>
            <button onClick={() => changeMonth(1)} className="p-2 rounded-full hover:bg-gray-200 disabled:opacity-50" disabled={isLoading}>
                <ChevronRight className="h-6 w-6" />
            </button>
        </div>
    );
};

const OwnerTotals = ({ items }) => {
    const { 
        keithShare, tildShare, keithProportion, tildProportion,
        keithRemaining, tildRemaining, keithIncome, tildIncome, keithDirectExpenses, tildDirectExpenses,
        billsPotTotal 
    } = useMemo(() => {
        const incomes = items.filter(item => item.item_type === 'income');
        const expenses = items.filter(item => item.item_type === 'expense');

        const keithSalary = incomes
            .filter(i => i.owner === 'keith' && i.item_name.toLowerCase() === 'salary')
            .reduce((s, i) => s + (parseFloat(i.effective_value) || 0), 0);
        const tildSalary = incomes
            .filter(i => i.owner === 'tild' && i.item_name.toLowerCase() === 'salary')
            .reduce((s, i) => s + (parseFloat(i.effective_value) || 0), 0);
        
        const totalSalaryIncome = keithSalary + tildSalary;
        let kProp = 0.5, tProp = 0.5;
        if (totalSalaryIncome > 0) {
            kProp = keithSalary / totalSalaryIncome;
            tProp = tildSalary / totalSalaryIncome;
        }

        const shared = expenses.filter(i => i.owner === 'shared').reduce((s, i) => s + (parseFloat(i.effective_value) || 0), 0);
        const kShare = shared * kProp;
        const tShare = shared * tProp;

        const kDirect = expenses.filter(i => i.owner === 'keith').reduce((s, i) => s + (parseFloat(i.effective_value) || 0), 0);
        const tDirect = expenses.filter(i => i.owner === 'tild').reduce((s, i) => s + (parseFloat(i.effective_value) || 0), 0);

        const kTotalIncome = incomes.filter(i => i.owner === 'keith').reduce((s, i) => s + (parseFloat(i.effective_value) || 0), 0);
        const tTotalIncome = incomes.filter(i => i.owner === 'tild').reduce((s, i) => s + (parseFloat(i.effective_value) || 0), 0);

        const kRemaining = kTotalIncome - kDirect - kShare;
        const tRemaining = tTotalIncome - tDirect - tShare;

        const billsTotal = items
            .filter(item => item.bills_pot)
            .reduce((sum, item) => sum + (parseFloat(item.effective_value) || 0), 0);

        return { 
            keithShare: kShare, tildShare: tShare,
            keithProportion: kProp, tildProportion: tProp,
            keithRemaining: kRemaining, tildRemaining: tRemaining,
            keithIncome: kTotalIncome, tildIncome: tTotalIncome,
            keithDirectExpenses: kDirect, tildDirectExpenses: tDirect,
            billsPotTotal: billsTotal
        };
    }, [items]);

    return (
        <div className="my-4 p-6 bg-white rounded-lg shadow-md space-y-8">
            <div>
                <h3 className="text-xl font-bold text-gray-800 mb-4 text-center">Shared Expense Breakdown</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="p-4 bg-blue-100 rounded-lg text-center">
                        <div className="flex justify-center items-center text-blue-800"><User className="mr-2"/> <h4 className="text-lg font-semibold">Keith's Share</h4></div>
                        <p className="text-2xl font-bold text-blue-900">£{keithShare.toFixed(0)}</p>
                        <p className="text-xs text-blue-700 mt-1">({(keithProportion * 100).toFixed(1)}% of shared total)</p>
                    </div>
                    <div className="p-4 bg-purple-100 rounded-lg text-center">
                        <div className="flex justify-center items-center text-purple-800"><Home className="mr-2"/> <h4 className="text-lg font-semibold">Bills Pot Total</h4></div>
                        <p className="text-2xl font-bold text-purple-900">£{billsPotTotal.toFixed(0)}</p>
                        <p className="text-xs text-purple-700 mt-1">&nbsp;</p>
                    </div>
                    <div className="p-4 bg-pink-100 rounded-lg text-center">
                        <div className="flex justify-center items-center text-pink-800"><User className="mr-2"/> <h4 className="text-lg font-semibold">Tild's Share</h4></div>
                        <p className="text-2xl font-bold text-pink-900">£{tildShare.toFixed(0)}</p>
                        <p className="text-xs text-pink-700 mt-1">({(tildProportion * 100).toFixed(1)}% of shared total)</p>
                    </div>
                </div>
            </div>

            <div className="border-t pt-6">
                 <h3 className="text-xl font-bold text-gray-800 mb-4 text-center">Remaining Balances</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="p-4 bg-blue-50 rounded-lg flex flex-col">
                        <h4 className="text-lg font-semibold text-blue-800 text-center mb-3">Keith</h4>
                        <div className="space-y-2 text-sm flex-grow">
                           <div className="flex justify-between items-center"><span className="flex items-center text-green-700"><TrendingUp className="mr-2 h-4 w-4"/>Income</span> <span>+ £{keithIncome.toFixed(2)}</span></div>
                           <div className="flex justify-between items-center"><span className="flex items-center text-red-700"><TrendingDown className="mr-2 h-4 w-4"/>Personal Expenses</span> <span>- £{keithDirectExpenses.toFixed(2)}</span></div>
                           <div className="flex justify-between items-center"><span className="flex items-center text-red-700"><TrendingDown className="mr-2 h-4 w-4"/>Share of Expenses</span> <span>- £{keithShare.toFixed(2)}</span></div>
                        </div>
                        <div className="border-t mt-3 pt-3 flex justify-between items-center">
                           <span className="flex items-center font-bold text-blue-900"><Wallet className="mr-2 h-5 w-5"/>Remaining</span>
                           <span className={`font-bold text-lg ${keithRemaining >= 0 ? 'text-blue-900' : 'text-red-700'}`}>£{keithRemaining.toFixed(2)}</span>
                        </div>
                    </div>
                    <div className="p-4 bg-pink-50 rounded-lg flex flex-col">
                        <h4 className="text-lg font-semibold text-pink-800 text-center mb-3">Tild</h4>
                        <div className="space-y-2 text-sm flex-grow">
                           <div className="flex justify-between items-center"><span className="flex items-center text-green-700"><TrendingUp className="mr-2 h-4 w-4"/>Income</span> <span>+ £{tildIncome.toFixed(2)}</span></div>
                           <div className="flex justify-between items-center"><span className="flex items-center text-red-700"><TrendingDown className="mr-2 h-4 w-4"/>Personal Expenses</span> <span>- £{tildDirectExpenses.toFixed(2)}</span></div>
                           <div className="flex justify-between items-center"><span className="flex items-center text-red-700"><TrendingDown className="mr-2 h-4 w-4"/>Share of Expenses</span> <span>- £{tildShare.toFixed(2)}</span></div>
                        </div>
                        <div className="border-t mt-3 pt-3 flex justify-between items-center">
                           <span className="flex items-center font-bold text-pink-900"><Wallet className="mr-2 h-5 w-5"/>Remaining</span>
                           <span className={`font-bold text-lg ${tildRemaining >= 0 ? 'text-pink-900' : 'text-red-700'}`}>£{tildRemaining.toFixed(2)}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const ConfirmationModal = ({ isOpen, onClose, onConfirm, title, message }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex justify-center items-center p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
                <div className="p-6">
                    <div className="flex items-start">
                        <div className="flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                           <AlertTriangle className="h-6 w-6 text-red-600" aria-hidden="true" />
                        </div>
                        <div className="ml-4 text-left">
                            <h3 className="text-lg leading-6 font-medium text-gray-900">{title}</h3>
                            <div className="mt-2">
                                <p className="text-sm text-gray-500">{message}</p>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                    <button type="button" onClick={onConfirm} className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 sm:ml-3 sm:w-auto sm:text-sm">
                        Confirm
                    </button>
                    <button type="button" onClick={onClose} className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 sm:mt-0 sm:w-auto sm:text-sm">
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
};

const BudgetItemRow = ({ item, onUpdate, onEditCategory, onDelete, isEditingDisabled = false }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [value, setValue] = useState(item.effective_value);
    const [notes, setNotes] = useState(item.notes || '');
    const [isOneOff, setIsOneOff] = useState(item.is_one_off);
    const isSynthetic = String(item.budget_item_id).includes('-repay-income');

    useEffect(() => {
        setValue(item.effective_value);
        setNotes(item.notes || '');
        setIsOneOff(item.is_one_off);
    }, [item]);

    const handleSave = () => {
        onUpdate(item.budget_item_id, { value: parseFloat(value) || 0, notes, is_one_off: isOneOff });
        setIsEditing(false);
    };
    const handleCancel = () => {
        setValue(item.effective_value);
        setNotes(item.notes || '');
        setIsOneOff(item.is_one_off);
        setIsEditing(false);
    };
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
            <div className="bg-white p-4 rounded-lg shadow-sm hover:shadow-md transition-shadow mb-3">
                <div className="flex flex-wrap items-center justify-between">
                    <div className="w-full sm:w-auto flex-grow mb-2 sm:mb-0">
                        <div className="flex items-center">
                            <span className="font-bold text-lg text-gray-800">{item.item_name}</span>
                            {item.is_one_off && <span className="ml-2 text-xs font-semibold bg-yellow-200 text-yellow-800 px-2 py-1 rounded-full">One-off</span>}
                            {item.effective_from_month_name !== formatDate(new Date(), 'MonthYYYY') && !isSynthetic &&
                              <span className="ml-2 text-xs font-semibold bg-gray-200 text-gray-700 px-2 py-1 rounded-full" title={`Value effective from ${item.effective_from_month_name}`}>Inherited</span>}
                        </div>
                         <p className="text-sm text-gray-500">{item.description}</p>
                    </div>
                    <div className="flex items-center space-x-2 sm:space-x-4">
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${ownerColors[item.owner.toLowerCase()] || 'bg-gray-100 text-gray-800'}`}>{item.owner}</span>
                        {item.bills_pot && <span className="px-2 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-800">Bills Pot</span>}
                    </div>
                </div>
                {isEditing ? (
                    <div className="mt-4 space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                                <label className="text-sm font-medium text-gray-700">Value (£)</label>
                                <input type="number" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"/>
                            </div>
                             <div>
                                <label className="text-sm font-medium text-gray-700">Notes</label>
                                <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"/>
                            </div>
                        </div>
                        <div className="flex items-center justify-between">
                            <label className="flex items-center space-x-2 cursor-pointer">
                                <input type="checkbox" checked={isOneOff} onChange={(e) => setIsOneOff(e.target.checked)} className="rounded border-gray-300 text-indigo-600 shadow-sm"/>
                                <span className="text-sm text-gray-700">Is this a one-off for this month?</span>
                            </label>
                            <div className="flex items-center space-x-2">
                                <button onClick={handleSave} className="p-2 text-green-600 hover:text-green-800"><Save className="h-5 w-5"/></button>
                                <button onClick={handleCancel} className="p-2 text-red-600 hover:text-red-800"><XCircle className="h-5 w-5"/></button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="mt-2 flex items-center justify-between">
                        <div onClick={() => !isSynthetic && !isEditingDisabled && setIsEditing(true)} className={`text-xl font-semibold p-2 rounded-md ${item.item_type === 'income' ? 'text-green-600' : 'text-red-600'} ${!isSynthetic && !isEditingDisabled && 'cursor-pointer hover:bg-gray-100'} ${isEditingDisabled && 'opacity-75'}`}>
                            £{(parseFloat(item.effective_value) || 0).toFixed(2)}
                        </div>
                        {!isSynthetic && !isEditingDisabled && (
                            <div className="flex items-center">
                                <button onClick={() => setIsEditing(true)} className="p-2 text-gray-500 hover:text-indigo-600"><Edit2 className="h-5 w-5"/></button>
                                <button onClick={() => onEditCategory(item.budget_item_id)} className="p-2 text-gray-500 hover:text-indigo-600"><MoreVertical className="h-5 w-5"/></button>
                                <button onClick={() => setShowDeleteConfirm(true)} className="p-2 text-gray-500 hover:text-red-600"><Trash2 className="h-5 w-5"/></button>
                            </div>
                        )}
                        {!isSynthetic && isEditingDisabled && (
                            <div className="flex items-center">
                                <span className="text-sm text-gray-500 px-2 py-1 bg-gray-100 rounded">Past month - editing locked</span>
                            </div>
                        )}
                    </div>
                )}
                {item.calculation_type === 'weekly_count' && <p className="text-xs text-gray-500 mt-1">Calculated weekly on day {item.weekly_payment_day}</p>}
            </div>
        </>
    );
};

const BudgetTable = ({ items, onUpdate, onDelete, onEditCategory, title, itemType, searchTerm = '', isEditingDisabled = false }) => {
    const [collapsedGroups, setCollapsedGroups] = useState({});

    const processedItems = useMemo(() => {
        let filtered = items.filter(i => i.item_type === itemType);
        
        // Apply search filter if search term exists
        if (searchTerm.trim()) {
            const searchLower = searchTerm.toLowerCase();
            filtered = filtered.filter(item => 
                item.item_name.toLowerCase().includes(searchLower) ||
                (item.description && item.description.toLowerCase().includes(searchLower)) ||
                item.owner.toLowerCase().includes(searchLower)
            );
        }

        // For income, just return a flat, sorted list.
        if (itemType === 'income') {
            return [...filtered].sort((a, b) => (parseFloat(b.effective_value) || 0) - (parseFloat(a.effective_value) || 0));
        }

        // For expenses, group and sort.
        const grouped = filtered.reduce((acc, item) => {
            const owner = item.owner || 'Unknown';
            if (!acc[owner]) acc[owner] = [];
            acc[owner].push(item);
            return acc;
        }, {});
        Object.values(grouped).forEach(arr => arr.sort((a, b) => (parseFloat(b.effective_value) || 0) - (parseFloat(a.effective_value) || 0)));
        const ownerOrder = ['shared', 'keith', 'tild'];
        return Object.entries(grouped).sort(([a], [b]) => {
            const ia = ownerOrder.indexOf(a), ib = ownerOrder.indexOf(b);
            if (ia !== -1 && ib !== -1) return ia - ib;
            if (ia !== -1) return -1;
            if (ib !== -1) return 1;
            return a.localeCompare(b);
        });
    }, [items, itemType, searchTerm]);

    useEffect(() => {
        if (itemType === 'expense') {
            const initialState = {};
            processedItems.forEach(([owner]) => {
                // If there's a search term, expand groups that have matching items
                // If no search term, keep groups collapsed by default
                initialState[owner] = searchTerm.trim() ? false : true;
            });
            setCollapsedGroups(initialState);
        }
    }, [items, itemType, processedItems, searchTerm]); // Re-calculate when items or search term change

    const toggleGroup = (owner) => {
        setCollapsedGroups(prev => ({ ...prev, [owner]: !prev[owner] }));
    };

    const allTypeItems = items.filter(i => i.item_type === itemType);
    const hasItemsOfType = allTypeItems.length > 0;
    const hasFilteredResults = itemType === 'income' ? processedItems.length > 0 : processedItems.some(([, items]) => items.length > 0);

    if (!hasItemsOfType) {
        return <div className="bg-white p-6 rounded-lg shadow-md mb-6"><h3 className="text-xl font-bold mb-2 text-gray-700">{title}</h3><p className="text-gray-500">No {itemType} items for this month.</p></div>;
    }

    if (!hasFilteredResults && searchTerm.trim()) {
        return <div className="bg-white p-6 rounded-lg shadow-md mb-6"><h3 className="text-xl font-bold mb-2 text-gray-700">{title}</h3><p className="text-gray-500">No {itemType} items match your search.</p></div>;
    }

    return (
        <div className="bg-white p-4 md:p-6 rounded-lg shadow-md mb-6">
            <h3 className="text-2xl font-bold mb-4 text-gray-800">{title}</h3>
            <div className="space-y-4">
                {itemType === 'expense' ? (
                    processedItems.map(([owner, ownerItems]) => {
                        const isCollapsed = collapsedGroups[owner];
                        return (
                            <div key={owner} className="border-b border-gray-200 last:border-b-0 pb-2 mb-2">
                                <button 
                                    onClick={() => toggleGroup(owner)} 
                                    className="w-full flex justify-between items-center text-left p-2 rounded-md hover:bg-gray-100 transition-colors"
                                >
                                    <h4 className="text-lg font-semibold text-gray-700 capitalize">{owner}</h4>
                                    <ChevronDown className={`h-6 w-6 text-gray-500 transition-transform duration-300 ${isCollapsed ? '' : 'rotate-180'}`} />
                                </button>
                                {!isCollapsed && (
                                    <div className="pl-4 pt-2 mt-2 border-l-2 border-indigo-200">
                                        {ownerItems.map(item => <BudgetItemRow key={item.budget_item_id} item={item} onUpdate={onUpdate} onDelete={onDelete} onEditCategory={onEditCategory} isEditingDisabled={isEditingDisabled}/>)}
                                    </div>
                                )}
                            </div>
                        )
                    })
                ) : (
                    processedItems.map(item => <BudgetItemRow key={item.budget_item_id} item={item} onUpdate={onUpdate} onDelete={onDelete} onEditCategory={onEditCategory} isEditingDisabled={isEditingDisabled}/>)
                )}
            </div>
        </div>
    );
};

const ItemCategoryModal = ({ item, isOpen, onClose, onSave, allMonths }) => {
    const isNew = !item?.budget_item_id;
    const [formData, setFormData] = useState({});

    useEffect(() => {
        if (isOpen) {
            if (isNew) {
                setFormData({
                    item_name: '', item_type: 'expense', description: '', owner: 'shared', bills_pot: false,
                    calculation_type: 'fixed', weekly_payment_day: '', value: '', notes: '', is_one_off: false,
                    last_payment_month_id: ''
                });
            } else {
                setFormData({
                    item_name: item.item_name || '',
                    item_type: item.item_type || 'expense',
                    description: item.description || '',
                    owner: item.owner || 'shared',
                    bills_pot: item.bills_pot || false,
                    calculation_type: item.calculation_type || 'fixed',
                    weekly_payment_day: item.weekly_payment_day || '',
                    last_payment_month_id: item.last_payment_month_id || ''
                });
            }
        }
    }, [item, isOpen, isNew]);

    if (!isOpen) return null;

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
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
    
    const OWNER_CHOICES = ['shared', 'keith', 'tild'];
    const CALCULATION_TYPE_CHOICES = { 'fixed': 'Fixed Monthly', 'weekly_count': 'Weekly Count' };
    const DAY_CHOICES = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday', 7: 'Sunday'};

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-full overflow-y-auto">
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <h2 className="text-2xl font-bold text-gray-800">{isNew ? "Create New Budget Item" : "Edit Budget Item"}</h2>
                    
                    <div>
                         <label htmlFor="item_name" className="block text-sm font-medium text-gray-700">Item Name</label>
                         <input type="text" name="item_name" value={formData.item_name} onChange={handleChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm" required />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                         <div>
                             <label htmlFor="item_type" className="block text-sm font-medium text-gray-700">Type</label>
                             <select name="item_type" value={formData.item_type} onChange={handleChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"><option value="expense">Expense</option><option value="income">Income</option></select>
                        </div>
                         <div>
                             <label htmlFor="owner" className="block text-sm font-medium text-gray-700">Owner</label>
                             <select name="owner" value={formData.owner} onChange={handleChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm">{OWNER_CHOICES.map(o => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}</select>
                        </div>
                    </div>
                    <div>
                        <label htmlFor="description" className="block text-sm font-medium text-gray-700">Description</label>
                        <textarea name="description" value={formData.description} onChange={handleChange} rows="2" className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"></textarea>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label htmlFor="calculation_type" className="block text-sm font-medium text-gray-700">Calculation</label>
                            <select name="calculation_type" value={formData.calculation_type} onChange={handleChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm">{Object.entries(CALCULATION_TYPE_CHOICES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                        </div>
                        {formData.calculation_type === 'weekly_count' && (
                            <div>
                                <label htmlFor="weekly_payment_day" className="block text-sm font-medium text-gray-700">Payment Day</label>
                                <select name="weekly_payment_day" value={formData.weekly_payment_day} onChange={handleChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm" required><option value="">Select a day...</option>{Object.entries(DAY_CHOICES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                            </div>
                        )}
                    </div>
                    <div>
                        <label htmlFor="last_payment_month_id" className="block text-sm font-medium text-gray-700">Last Payment Month</label>
                        <select name="last_payment_month_id" value={formData.last_payment_month_id} onChange={handleChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm">
                            <option value="">No Expiration</option>
                            {allMonths.map(month => (
                                <option key={month.month_id} value={month.month_id}>{month.month_name}</option>
                            ))}
                        </select>
                    </div>
                    {isNew && (
                        <div className="p-4 bg-gray-50 rounded-lg">
                             <h3 className="text-lg font-semibold text-gray-700 mb-2">Initial Value</h3>
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                 <div>
                                     <label htmlFor="value" className="block text-sm font-medium text-gray-700">Value (£)</label>
                                     <input type="number" name="value" step="0.01" value={formData.value} onChange={handleChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm" required />
                                 </div>
                                 <div>
                                     <label htmlFor="notes" className="block text-sm font-medium text-gray-700">Notes</label>
                                     <input type="text" name="notes" value={formData.notes} onChange={handleChange} placeholder="Optional notes" className="mt-1 block w-full rounded-md border-gray-300 shadow-sm" />
                                 </div>
                             </div>
                             <div className="mt-4 flex items-center space-x-2">
                                <input id="is_one_off_new" type="checkbox" name="is_one_off" checked={formData.is_one_off} onChange={handleChange} className="h-4 w-4 rounded border-gray-300 text-indigo-600"/>
                                <label htmlFor="is_one_off_new" className="text-sm text-gray-900">Is this a one-off for this month?</label>
                            </div>
                        </div>
                    )}
                    <div className="flex items-center space-x-2">
                        <input id="bills_pot" type="checkbox" name="bills_pot" checked={formData.bills_pot} onChange={handleChange} className="h-4 w-4 rounded border-gray-300 text-indigo-600"/>
                        <label htmlFor="bills_pot" className="block text-sm text-gray-900">Part of Bills Pot</label>
                    </div>
                    <div className="mt-4 flex justify-end space-x-3">
                        <button type="button" onClick={onClose} className="bg-white py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                        <button type="submit" className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700">Save Item</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// --- Main App Component ---
const getInitialDate = () => {
    const hash = window.location.hash;
    const match = hash.match(/^#(\d{4}-\d{2})$/);
    if (match && match[1]) {
        const [year, month] = match[1].split('-').map(Number);
        if (month >= 1 && month <= 12) return new Date(year, month - 1, 1);
    }
    return new Date();
};

export default function App() {
    const [currentDate, setCurrentDate] = useState(getInitialDate());
    const [budgetItems, setBudgetItems] = useState([]);
    const [allBudgetCategories, setAllBudgetCategories] = useState([]);
    const [allMonths, setAllMonths] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [toast, setToast] = useState({ message: '', type: '', key: 0 });
    const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
    const [editingCategory, setEditingCategory] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');

    const isEditingDisabled = useMemo(() => isMonthInPast(currentDate), [currentDate]);

    const showToast = (message, type = 'success') => {
        setToast({ message, type, key: new Date().getTime() });
        setTimeout(() => setToast({ ...toast, message: '' }), 3000);
    };

    const fetchData = useCallback(async (date) => {
        setIsLoading(true);
        try {
            const [, items, categories, months] = await Promise.all([
                apiService.createOrGetMonth(date),
                apiService.getBudgetItemsForMonth(formatDate(date, 'YYYY-MM')),
                apiService.getAllBudgetItemCategories(),
                apiService.getAllMonths()
            ]);
            setBudgetItems(items);
            setAllBudgetCategories(categories);
            setAllMonths(months);
        } catch (error) {
            console.error(error);
            showToast(error.message, 'error');
        } finally {
            setIsLoading(false);
        }
    }, []);

    const processedBudgetItems = useMemo(() => {
        const additionalIncomes = [];
        for (const item of budgetItems) {
            const nameLower = item.item_name.toLowerCase().trim();
            if (item.item_type === 'expense') {
                if (nameLower === 'tild repay') {
                    additionalIncomes.push({
                        ...item,
                        budget_item_id: `${item.budget_item_id}-repay-income`,
                        item_type: 'income',
                        owner: 'tild',
                        description: `Repayment from ${item.owner}`,
                    });
                } else if (nameLower === 'keith repay') {
                     additionalIncomes.push({
                        ...item,
                        budget_item_id: `${item.budget_item_id}-repay-income`,
                        item_type: 'income',
                        owner: 'keith',
                        description: `Repayment from ${item.owner}`,
                    });
                }
            }
        }
        return [...budgetItems, ...additionalIncomes];
    }, [budgetItems]);
    
    useEffect(() => {
        // This effect syncs the date state with the URL hash
        const syncDateFromHash = () => {
            const newDate = getInitialDate();
            setCurrentDate(current => {
                // Only update state if the date is actually different
                if (!current || current.getTime() !== newDate.getTime()) {
                    return newDate;
                }
                return current;
            });
        };

        window.addEventListener('hashchange', syncDateFromHash);
        syncDateFromHash(); // Sync on initial load

        return () => window.removeEventListener('hashchange', syncDateFromHash);
    }, []); // Empty dependency array ensures this runs only once to set up the listener

    useEffect(() => {
        // This effect fetches data whenever the date changes
        fetchData(currentDate);
    }, [currentDate, fetchData]);

    const handleDateChange = (newDate) => setCurrentDate(newDate);

    const handleUpdateItemValue = async (budgetItemId, payload) => {
        try {
            if(String(budgetItemId).includes('-repay-income')) return;
            await apiService.updateBudgetItemValue(formatDate(currentDate, 'YYYY-MM'), budgetItemId, payload);
            showToast('Item value updated successfully!');
            fetchData(currentDate);
        } catch (error) {
            console.error(error);
            showToast(error.message, 'error');
        }
    };

    const handleDeleteItem = async (budgetItemId) => {
        try {
            if(String(budgetItemId).includes('-repay-income')) return;
            await apiService.deleteBudgetItemForMonth(formatDate(currentDate, 'YYYY-MM'), budgetItemId);
            showToast('Item deleted successfully!');
            fetchData(currentDate);
        } catch (error) {
            console.error(error);
            showToast(error.message, 'error');
        }
    };
    
    const handleOpenNewCategoryModal = () => {
        setEditingCategory(null);
        setIsCategoryModalOpen(true);
    };
    
    const handleOpenEditCategoryModal = (budgetItemId) => {
        const itemToEdit = allBudgetCategories.find(c => c.budget_item_id === budgetItemId);
        if(itemToEdit){
            setEditingCategory(itemToEdit);
            setIsCategoryModalOpen(true);
        }
    };
    
    const handleSaveCategory = async (idOrPayload, payloadIfUpdating) => {
        const isNew = typeof idOrPayload !== 'string';
        const payload = isNew ? idOrPayload : payloadIfUpdating;

        try {
            if (isNew) {
                const monthId = formatDate(currentDate, 'YYYY-MM');
                await apiService.createBudgetItemCategory(monthId, payload);
                showToast('New item created successfully!');
            } else {
                await apiService.updateBudgetItemCategory(idOrPayload, payload);
                showToast('Item category updated!');
            }
            fetchData(currentDate);
        } catch (error) {
            console.error(error);
            showToast(error.message, 'error');
        } finally {
            setIsCategoryModalOpen(false);
        }
    };

    const handleSearchChange = (newSearchTerm) => {
        setSearchTerm(newSearchTerm);
    };

    const handleClearSearch = () => {
        setSearchTerm('');
    };

    return (
        <div className="bg-gray-50 min-h-screen font-sans">
            <header className="bg-indigo-600 text-white p-4 shadow-lg">
                <h1 className="text-2xl md:text-3xl font-bold text-center">Monthly Budget</h1>
            </header>
            <main className="container mx-auto p-4 max-w-5xl">
                <Toast key={toast.key} message={toast.message} type={toast.type} onDismiss={() => setToast({ ...toast, message: '' })} />
                <div className="space-y-4 mb-6">
                    <div className="grid md:grid-cols-2 gap-4">
                        <MonthSelector currentDate={currentDate} isLoading={isLoading} />
                        <div className="flex md:justify-end">
                            <button 
                                onClick={handleOpenNewCategoryModal} 
                                disabled={isEditingDisabled}
                                className={`w-full h-full flex items-center justify-center space-x-2 font-bold py-3 px-6 rounded-lg shadow-lg transition-colors duration-300 ${
                                    isEditingDisabled 
                                        ? 'bg-gray-400 text-gray-600 cursor-not-allowed' 
                                        : 'bg-indigo-600 text-white hover:bg-indigo-700'
                                }`}
                            >
                                <PlusCircle /><span>{isEditingDisabled ? 'Past Month - Locked' : 'Add New Item'}</span>
                            </button>
                        </div>
                    </div>
                    <SearchComponent 
                        searchTerm={searchTerm} 
                        onSearchChange={handleSearchChange} 
                        onClearSearch={handleClearSearch} 
                    />
                </div>
                {isLoading && budgetItems.length === 0 ? (
                    <LoadingSpinner />
                ) : (
                    <>
                        <OwnerTotals items={processedBudgetItems} />
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                           <BudgetTable title="Income" itemType="income" items={processedBudgetItems} onUpdate={handleUpdateItemValue} onDelete={handleDeleteItem} onEditCategory={handleOpenEditCategoryModal} searchTerm={searchTerm} isEditingDisabled={isEditingDisabled}/>
                           <BudgetTable title="Expenses" itemType="expense" items={processedBudgetItems} onUpdate={handleUpdateItemValue} onDelete={handleDeleteItem} onEditCategory={handleOpenEditCategoryModal} searchTerm={searchTerm} isEditingDisabled={isEditingDisabled}/>
                        </div>
                    </>
                )}
            </main>
            <ItemCategoryModal isOpen={isCategoryModalOpen} onClose={() => setIsCategoryModalOpen(false)} onSave={handleSaveCategory} item={editingCategory} allMonths={allMonths} />
        </div>
    );
}