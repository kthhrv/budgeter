import React, { useState, useMemo, useEffect } from 'react';
import { ChevronDown, Inbox, SearchX } from 'lucide-react';
import BudgetItemRow from './BudgetItemRow';

const BudgetTable = ({ items, onUpdate, onDelete, onEditCategory, title, itemType, ownerFilter, searchTerm = '', currentDate, isEditingDisabled = false }) => {
    const [collapsed, setCollapsed] = useState(false);
    const [collapsedGroups, setCollapsedGroups] = useState({});
    const useFlat = itemType === 'income' || ownerFilter;

    const processedItems = useMemo(() => {
        let filtered = items.filter(i => i.item_type === itemType);

        if (ownerFilter) {
            filtered = filtered.filter(i => i.owner === ownerFilter);
        }

        if (searchTerm.trim()) {
            const searchLower = searchTerm.toLowerCase();
            filtered = filtered.filter(item =>
                item.item_name.toLowerCase().includes(searchLower) ||
                item.owner.toLowerCase().includes(searchLower)
            );
        }

        if (useFlat) {
            return [...filtered].sort((a, b) => (parseFloat(b.effective_value) || 0) - (parseFloat(a.effective_value) || 0));
        }

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
    }, [items, itemType, ownerFilter, searchTerm, useFlat]);

    useEffect(() => {
        if (!useFlat) {
            const initialState = {};
            processedItems.forEach(([owner]) => {
                initialState[owner] = false;
            });
            setCollapsedGroups(initialState);
        }
    }, [items, itemType, processedItems, searchTerm, useFlat]);

    const toggleGroup = (owner) => {
        setCollapsedGroups(prev => ({ ...prev, [owner]: !prev[owner] }));
    };

    const allTypeItems = items.filter(i => i.item_type === itemType && (!ownerFilter || i.owner === ownerFilter));
    const hasItemsOfType = allTypeItems.length > 0;
    const hasFilteredResults = useFlat ? processedItems.length > 0 : processedItems.some(([, items]) => items.length > 0);

    if (!hasItemsOfType) {
        return (
            <div className="bg-white p-6 rounded-xl shadow-md border border-gray-100 mb-6">
                <h3 className="text-xl font-bold mb-4 text-gray-800">{title}</h3>
                <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                    <Inbox className="h-12 w-12 mb-3 text-gray-300" />
                    <p className="text-sm font-medium">No {itemType} items for this month</p>
                    <p className="text-xs mt-1">Add one using the button above</p>
                </div>
            </div>
        );
    }

    if (!hasFilteredResults && searchTerm.trim()) {
        return (
            <div className="bg-white p-6 rounded-xl shadow-md border border-gray-100 mb-6">
                <h3 className="text-xl font-bold mb-4 text-gray-800">{title}</h3>
                <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                    <SearchX className="h-12 w-12 mb-3 text-gray-300" />
                    <p className="text-sm font-medium">No {itemType} items match "{searchTerm}"</p>
                    <p className="text-xs mt-1">Try a different search term</p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white p-4 md:p-6 rounded-xl shadow-md border border-gray-100 mb-6">
            <button onClick={() => setCollapsed(c => !c)} className="w-full flex justify-between items-center mb-2 group">
                <h3 className="text-xl font-bold text-gray-800">{title}</h3>
                <ChevronDown className={`h-5 w-5 text-gray-400 group-hover:text-gray-600 transition-transform duration-300 ${collapsed ? '' : 'rotate-180'}`} />
            </button>
            <div className={`overflow-hidden transition-all duration-300 ease-in-out ${collapsed ? 'max-h-0 opacity-0' : 'max-h-[5000px] opacity-100'}`}>
                <div className="space-y-4 pt-2">
                {!useFlat ? (
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
                                <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isCollapsed ? 'max-h-0 opacity-0' : 'max-h-[2000px] opacity-100'}`}>
                                    <div className="pl-4 pt-2 mt-2 border-l-2 border-indigo-200">
                                        {ownerItems.map(item => <BudgetItemRow key={item.budget_item_id} item={item} onUpdate={onUpdate} onDelete={onDelete} onEditCategory={onEditCategory} currentDate={currentDate} isEditingDisabled={isEditingDisabled} />)}
                                    </div>
                                </div>
                            </div>
                        )
                    })
                ) : (
                    processedItems.map(item => <BudgetItemRow key={item.budget_item_id} item={item} onUpdate={onUpdate} onDelete={onDelete} onEditCategory={onEditCategory} currentDate={currentDate} isEditingDisabled={isEditingDisabled} hideOwnerBadge={!!ownerFilter} />)
                )}
                </div>
            </div>
        </div>
    );
};

export default BudgetTable;
