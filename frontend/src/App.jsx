import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { PlusCircle, XCircle, Wallet, LayoutDashboard, ArrowRightLeft } from 'lucide-react';
import { formatDate, isMonthInPast, getInitialDate } from './utils/helpers';
import apiService from './services/api';
import Toast from './components/Toast';
import LoadingSkeleton from './components/LoadingSkeleton';
import SearchComponent from './components/SearchComponent';
import MonthSelector from './components/MonthSelector';
import { useBudgetTotals } from './hooks/useBudgetTotals';
import { SharedCard, PersonCard } from './components/OwnerTotals';
import BudgetTable from './components/BudgetTable';
import ItemCategoryModal from './components/ItemCategoryModal';
import TabsPage from './components/TabsPage';

const BudgetDashboard = ({ items, onUpdate, onDelete, onEditCategory, searchTerm, currentDate, isEditingDisabled }) => {
    const totals = useBudgetTotals(items);
    const tableProps = { items, onUpdate, onDelete, onEditCategory, searchTerm, currentDate, isEditingDisabled };

    return (
        <div className="animate-fadeIn">
            {/* Mobile: all breakdown cards first, then tables grouped per owner */}
            <div className="xl:hidden space-y-6">
                <div className="space-y-4">
                    <SharedCard billsPotTotal={totals.billsPotTotal} groceriesPotTotal={totals.groceriesPotTotal} sharedIncome={totals.sharedIncome} sharedExpenses={totals.sharedExpenseTotal} extraTotal={totals.extraTotal} totalContributions={totals.keithShare + totals.tildShare} />
                    <PersonCard name="Keith" color="blue" income={totals.keithIncome} directExpenses={totals.keithDirectExpenses} share={totals.keithShare} sharedTotal={totals.sharedTotal} proportion={totals.keithProportion} remaining={totals.keithRemaining} repaymentOut={totals.keithTabRepayment} repaymentIn={totals.tildTabRepayment} />
                    <PersonCard name="Tild" color="pink" income={totals.tildIncome} directExpenses={totals.tildDirectExpenses} share={totals.tildShare} sharedTotal={totals.sharedTotal} proportion={totals.tildProportion} remaining={totals.tildRemaining} repaymentOut={totals.tildTabRepayment} repaymentIn={totals.keithTabRepayment} />
                </div>
                <div className="space-y-4">
                    <BudgetTable title="Joint Income" itemType="income" ownerFilter="shared" {...tableProps} />
                    <BudgetTable title="Joint Expenses" itemType="expense" ownerFilter="shared" {...tableProps} />
                </div>
                <div className="space-y-4">
                    <BudgetTable title="Keith's Income" itemType="income" ownerFilter="keith" {...tableProps} />
                    <BudgetTable title="Keith's Expenses" itemType="expense" ownerFilter="keith" {...tableProps} />
                </div>
                <div className="space-y-4">
                    <BudgetTable title="Tild's Income" itemType="income" ownerFilter="tild" {...tableProps} />
                    <BudgetTable title="Tild's Expenses" itemType="expense" ownerFilter="tild" {...tableProps} />
                </div>
            </div>

            {/* Desktop: aligned 3-column grid */}
            <div className="hidden xl:block space-y-6">
                <div className="grid grid-cols-3 gap-6 items-stretch">
                    <SharedCard billsPotTotal={totals.billsPotTotal} groceriesPotTotal={totals.groceriesPotTotal} sharedIncome={totals.sharedIncome} sharedExpenses={totals.sharedExpenseTotal} extraTotal={totals.extraTotal} totalContributions={totals.keithShare + totals.tildShare} />
                    <PersonCard name="Keith" color="blue" income={totals.keithIncome} directExpenses={totals.keithDirectExpenses} share={totals.keithShare} sharedTotal={totals.sharedTotal} proportion={totals.keithProportion} remaining={totals.keithRemaining} repaymentOut={totals.keithTabRepayment} repaymentIn={totals.tildTabRepayment} />
                    <PersonCard name="Tild" color="pink" income={totals.tildIncome} directExpenses={totals.tildDirectExpenses} share={totals.tildShare} sharedTotal={totals.sharedTotal} proportion={totals.tildProportion} remaining={totals.tildRemaining} repaymentOut={totals.tildTabRepayment} repaymentIn={totals.keithTabRepayment} />
                </div>
                <div className="grid grid-cols-3 gap-6">
                    <div className="space-y-4">
                        <BudgetTable title="Joint Income" itemType="income" ownerFilter="shared" {...tableProps} />
                        <BudgetTable title="Joint Expenses" itemType="expense" ownerFilter="shared" {...tableProps} />
                    </div>
                    <div className="space-y-4">
                        <BudgetTable title="Keith's Income" itemType="income" ownerFilter="keith" {...tableProps} />
                        <BudgetTable title="Keith's Expenses" itemType="expense" ownerFilter="keith" {...tableProps} />
                    </div>
                    <div className="space-y-4">
                        <BudgetTable title="Tild's Income" itemType="income" ownerFilter="tild" {...tableProps} />
                        <BudgetTable title="Tild's Expenses" itemType="expense" ownerFilter="tild" {...tableProps} />
                    </div>
                </div>
            </div>
        </div>
    );
};

const App = () => {
    const [user, setUser] = useState(null);
    const [isAuthLoading, setIsAuthLoading] = useState(true);
    const [currentDate, setCurrentDate] = useState(getInitialDate());
    const [budgetItems, setBudgetItems] = useState([]);
    const [allBudgetCategories, setAllBudgetCategories] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
    const [editingCategory, setEditingCategory] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [toast, setToast] = useState({ message: '', type: 'success', key: 0 });
    const [activePage, setActivePage] = useState('budget');

    useEffect(() => {
        const checkAuth = async () => {
            try {
                const currentUser = await apiService.getCurrentUser();
                setUser(currentUser);
            } catch (error) {
                console.error('Auth check failed:', error);
            } finally {
                setIsAuthLoading(false);
            }
        };
        checkAuth();
    }, []);

    const isEditingDisabled = useMemo(() => isMonthInPast(currentDate), [currentDate]);

    const showToast = (message, type = 'success') => {
        setToast({ message, type, key: new Date().getTime() });
    };

    const fetchData = useCallback(async (date) => {
        setIsLoading(true);
        try {
            await apiService.createOrGetMonth(date);

            const [items, categories] = await Promise.all([
                apiService.getBudgetItemsForMonth(formatDate(date, 'YYYY-MM')),
                apiService.getAllBudgetItemCategories(),
            ]);
            setBudgetItems(items);
            setAllBudgetCategories(categories);
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
        const syncDateFromHash = () => {
            const newDate = getInitialDate();
            setCurrentDate(current => {
                if (!current || current.getTime() !== newDate.getTime()) {
                    return newDate;
                }
                return current;
            });
        };

        window.addEventListener('hashchange', syncDateFromHash);
        syncDateFromHash();

        return () => window.removeEventListener('hashchange', syncDateFromHash);
    }, []);

    useEffect(() => {
        if (!isAuthLoading && user) {
            fetchData(currentDate);
        }
    }, [currentDate, fetchData, isAuthLoading, user]);

    const handleUpdateItemValue = async (budgetItemId, payload) => {
        try {
            if (String(budgetItemId).includes('-repay-income')) return;
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
            if (String(budgetItemId).includes('-repay-income')) return;
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
        let itemToEdit = budgetItems.find(i => i.budget_item_id === budgetItemId);
        if (!itemToEdit) {
            itemToEdit = allBudgetCategories.find(c => c.budget_item_id === budgetItemId);
        }
        if (itemToEdit) {
            setEditingCategory(itemToEdit);
            setIsCategoryModalOpen(true);
        }
    };

    const handleSaveCategory = async (idOrPayload, payloadIfUpdating) => {
        const isNew = typeof idOrPayload !== 'string';
        const fullPayload = isNew ? idOrPayload : payloadIfUpdating;

        try {
            if (isNew) {
                const monthId = formatDate(currentDate, 'YYYY-MM');
                await apiService.createBudgetItemCategory(monthId, fullPayload);
                showToast('New item created successfully!');
            } else {
                const categoryPayload = { ...fullPayload };
                delete categoryPayload.value;
                delete categoryPayload.is_one_off;

                await apiService.updateBudgetItemCategory(idOrPayload, categoryPayload);

                const valuePayload = {
                    value: parseFloat(fullPayload.value) || 0,
                    is_one_off: fullPayload.is_one_off
                };
                const monthId = formatDate(currentDate, 'YYYY-MM');
                await apiService.updateBudgetItemValue(monthId, idOrPayload, valuePayload);

                showToast('Item updated successfully!');
            }
            fetchData(currentDate);
        } catch (error) {
            console.error(error);
            showToast(error.message, 'error');
        } finally {
            setIsCategoryModalOpen(false);
        }
    };

    const handleGoogleLogin = () => {
        window.location.href = `${window.location.origin}/accounts/google/login/`;
    };

    const handleLogout = () => {
        window.location.href = `${window.location.origin}/accounts/logout/`;
    };

    if (isAuthLoading) {
        return (
            <div className="bg-gray-50 min-h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
        );
    }

    if (!user) {
        return (
            <div className="bg-gradient-to-br from-indigo-600 via-purple-600 to-indigo-800 min-h-screen flex items-center justify-center p-4">
                <div className="bg-white/95 backdrop-blur-sm p-8 rounded-2xl shadow-2xl w-full max-w-md text-center animate-slideUp">
                    <div className="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <Wallet className="w-10 h-10 text-indigo-600" />
                    </div>
                    <h1 className="text-3xl font-bold text-gray-900 mb-2">Budgeter</h1>
                    <p className="text-gray-600 mb-8">Please sign in to access your budget.</p>
                    <button
                        onClick={handleGoogleLogin}
                        className="w-full flex items-center justify-center space-x-3 bg-white border border-gray-300 py-3 px-4 rounded-lg font-semibold text-gray-700 hover:bg-gray-50 transition-all shadow-sm active:scale-95"
                    >
                        <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-6 h-6" />
                        <span>Sign in with Google</span>
                    </button>
                    <p className="mt-8 text-xs text-gray-400">Restricted access enabled.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-gray-50 min-h-screen font-sans">
            <header className="bg-gradient-to-r from-indigo-600 via-indigo-700 to-purple-700 text-white p-4 shadow-lg sticky top-0 z-40">
                <div className="container mx-auto flex justify-between items-center max-w-7xl">
                    <h1 className="text-2xl md:text-3xl font-bold flex items-center">
                        <Wallet className="mr-3 h-8 w-8" /> Budgeter
                    </h1>
                    <div className="flex items-center gap-1 bg-white/10 rounded-lg p-1">
                        <button onClick={() => setActivePage('budget')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${activePage === 'budget' ? 'bg-white text-indigo-700' : 'text-white/80 hover:text-white hover:bg-white/10'}`}>
                            <LayoutDashboard className="h-4 w-4" /> Budget
                        </button>
                        <button onClick={() => setActivePage('tabs')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${activePage === 'tabs' ? 'bg-white text-indigo-700' : 'text-white/80 hover:text-white hover:bg-white/10'}`}>
                            <ArrowRightLeft className="h-4 w-4" /> Tabs
                        </button>
                    </div>
                    <div className="flex items-center space-x-4">
                        <span className="hidden md:block text-indigo-100 text-sm">Signed in as {user.username}</span>
                        <button onClick={handleLogout} className="p-2 hover:bg-indigo-500 rounded-full transition-colors" title="Logout">
                            <XCircle className="h-6 w-6" />
                        </button>
                    </div>
                </div>
            </header>
            <main className="container mx-auto p-4 max-w-7xl">
                <Toast key={toast.key} message={toast.message} type={toast.type} onDismiss={() => setToast({ ...toast, message: '' })} />
                {activePage === 'budget' ? (
                    <>
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
                            <div className="hidden md:block md:w-24"></div>
                            <div className="flex justify-center">
                                <MonthSelector currentDate={currentDate} isLoading={isLoading} />
                            </div>
                            <div className="flex items-center gap-2 w-full md:w-auto">
                                <div className="flex-1 md:flex-initial min-w-0">
                                    <SearchComponent
                                        searchTerm={searchTerm}
                                        onSearchChange={setSearchTerm}
                                        onClearSearch={() => setSearchTerm('')}
                                    />
                                </div>
                                <button
                                    onClick={handleOpenNewCategoryModal}
                                    disabled={isEditingDisabled}
                                    title={isEditingDisabled ? 'Past Month - Locked' : 'Add New Item'}
                                    className={`flex-shrink-0 p-2 rounded-lg transition-all duration-300 ${isEditingDisabled
                                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                        : 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:from-indigo-700 hover:to-purple-700 active:scale-[0.98]'
                                        }`}
                                >
                                    <PlusCircle className="h-5 w-5" />
                                </button>
                            </div>
                        </div>
                        {isLoading && budgetItems.length === 0 ? (
                            <LoadingSkeleton />
                        ) : (
                            <BudgetDashboard
                                items={processedBudgetItems}
                                onUpdate={handleUpdateItemValue}
                                onDelete={handleDeleteItem}
                                onEditCategory={handleOpenEditCategoryModal}
                                searchTerm={searchTerm}
                                currentDate={currentDate}
                                isEditingDisabled={isEditingDisabled}
                            />
                        )}
                    </>
                ) : (
                    <TabsPage showToast={(msg, type = 'success') => setToast({ message: msg, type, key: Date.now() })} />
                )}
            </main>
            <ItemCategoryModal isOpen={isCategoryModalOpen} onClose={() => setIsCategoryModalOpen(false)} onSave={handleSaveCategory} item={editingCategory} />
        </div>
    );
}

export default App;
