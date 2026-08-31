import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { PlusCircle, XCircle, Wallet, LayoutDashboard, ArrowRightLeft, Baby, CalendarDays, Flame, Coins, Home, Menu } from 'lucide-react';
import { formatDate, isMonthInPast, getInitialDate } from './utils/helpers';
import { computeMonthSummary, applyChildcareLinks } from './utils/nurseryCalc';
import apiService from './services/api';
import Toast from './components/Toast';
import LoadingSkeleton from './components/LoadingSkeleton';
import SearchComponent from './components/SearchComponent';
import MonthSelector from './components/MonthSelector';
import { useBudgetTotals } from './hooks/useBudgetTotals';
import OwnerCard from './components/OwnerCard';
import ItemCategoryModal from './components/ItemCategoryModal';
import TabsPage from './components/TabsPage';
import NurseryPage from './components/NurseryPage';
import ChildcarePage from './components/ChildcarePage';
import FirePage from './components/FirePage';
import ReportsPage from './components/ReportsPage';
import MortgagePage from './components/MortgagePage';

const BudgetDashboard = ({ items, onUpdate, onDelete, onEditCategory, searchTerm, currentDate, isEditingDisabled }) => {
    const t = useBudgetTotals(items);

    // Personal contributions fund the joint pot; they net out so the joint card
    // "left over" and the three cards' left-overs sum to the household total.
    const contributions = t.keithShare + t.tildShare;
    const sharedRemaining = t.sharedIncome + contributions - t.sharedExpenseTotal - t.sharedSavings;

    // How much each person moves into their Bills Pot this month (a labelled subtotal
    // of expenses already counted under that owner).
    const billsPot = { shared: 0, keith: 0, tild: 0 };
    for (const i of items) {
        if (i.item_type === 'expense' && i.expense_pot === 'bills' && billsPot[i.owner] !== undefined) {
            billsPot[i.owner] += parseFloat(i.effective_value) || 0;
        }
    }

    const owners = [
        { key: 'shared', name: 'Joint', accent: 'joint', sub: 'Shared account', remainingLabel: 'Left over', remaining: sharedRemaining, contributions, billsPot: billsPot.shared },
        { key: 'keith', name: 'Keith', accent: 'keith', sub: `${(t.keithProportion * 100).toFixed(0)}% of shared costs`, remainingLabel: 'Left over', remaining: t.keithRemaining, transfer: t.keithShare, billsPot: billsPot.keith },
        { key: 'tild', name: 'Tild', accent: 'tild', sub: `${(t.tildProportion * 100).toFixed(0)}% of shared costs`, remainingLabel: 'Left over', remaining: t.tildRemaining, transfer: t.tildShare, billsPot: billsPot.tild },
    ];

    const cardProps = { items, onUpdate, onDelete, onEditCategory, searchTerm, currentDate, isEditingDisabled };

    return (
        <div className="animate-fadeIn">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
                {owners.map(o => <OwnerCard key={o.key} config={o} {...cardProps} />)}
            </div>
        </div>
    );
};

const App = () => {
    const [user, setUser] = useState(null);
    const [isAuthLoading, setIsAuthLoading] = useState(true);
    const [currentDate, setCurrentDate] = useState(getInitialDate());
    const [budgetItems, setBudgetItems] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
    const [editingCategory, setEditingCategory] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [toast, setToast] = useState({ message: '', type: 'success', key: 0 });
    const [activePage, setActivePage] = useState('budget');
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [nurserySettings, setNurserySettings] = useState(null);

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

            const items = await apiService.getBudgetItemsForMonth(formatDate(date, 'YYYY-MM'));
            setBudgetItems(items);
        } catch (error) {
            console.error(error);
            showToast(error.message, 'error');
        } finally {
            setIsLoading(false);
        }
    }, []);

    const childcareNets = useMemo(() => {
        // Settings can be `{}` for users who've never opened the Nursery tab —
        // computeMonthSummary needs ellis/gaspard, so skip the sync until they exist.
        if (!nurserySettings?.ellis || !nurserySettings?.gaspard) return null;
        const summary = computeMonthSummary(nurserySettings, currentDate);
        return {
            ellis_nursery: summary.ellisNurseryNet,
            gaspard_care: summary.gaspardCareNet,
            gaspard_holiday: summary.gaspardHolidayNet,
        };
    }, [nurserySettings, currentDate]);

    const processedBudgetItems = useMemo(() => {
        const currentMonthName = currentDate.toLocaleString('en-GB', { month: 'long', year: 'numeric' });
        const itemsWithNurserySub = applyChildcareLinks(budgetItems, childcareNets, currentMonthName);

        const additionalIncomes = [];
        for (const item of itemsWithNurserySub) {
            const nameLower = item.item_name.toLowerCase().trim();
            if (item.item_type === 'expense') {
                if (nameLower === 'tild repay') {
                    additionalIncomes.push({
                        ...item,
                        budget_item_id: `${item.budget_item_id}-repay-income`,
                        item_type: 'income',
                        owner: 'tild',
                    });
                } else if (nameLower === 'keith repay') {
                    additionalIncomes.push({
                        ...item,
                        budget_item_id: `${item.budget_item_id}-repay-income`,
                        item_type: 'income',
                        owner: 'keith',
                    });
                }
            }
        }
        return [...itemsWithNurserySub, ...additionalIncomes];
    }, [budgetItems, childcareNets, currentDate]);

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

    useEffect(() => {
        if (!isAuthLoading && user) {
            apiService.getNurserySettings()
                .then(setNurserySettings)
                .catch(err => console.error('Failed to load nursery settings', err));
        }
    }, [isAuthLoading, user]);

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
        const itemToEdit = budgetItems.find(i => i.budget_item_id === budgetItemId);
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
            <div className="bg-paper min-h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
            </div>
        );
    }

    if (!user) {
        return (
            <div className="bg-paper min-h-screen flex items-center justify-center p-4">
                <div className="bg-card/95 backdrop-blur-sm p-8 rounded-2xl border border-line shadow-sm w-full max-w-md text-center animate-slideUp">
                    <div className="w-20 h-20 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-6">
                        <Wallet className="w-10 h-10 text-accent" />
                    </div>
                    <h1 className="font-serif italic text-4xl text-accent-strong mb-2">Budgeter</h1>
                    <p className="text-ink-soft mb-8">Please sign in to access your budget.</p>
                    <button
                        onClick={handleGoogleLogin}
                        className="w-full flex items-center justify-center space-x-3 bg-card border border-line py-3 px-4 rounded-lg font-semibold text-ink hover:bg-paper transition-all shadow-sm active:scale-95"
                    >
                        <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-6 h-6" />
                        <span>Sign in with Google</span>
                    </button>
                    <p className="mt-8 text-xs text-ink-faint">Restricted access enabled.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-paper min-h-screen font-sans">
            <header className="bg-card border-b border-line text-ink p-4 sticky top-0 z-40">
                <div className="container mx-auto flex justify-between items-center max-w-7xl gap-3">
                    <button
                        type="button"
                        onClick={() => setMobileMenuOpen(o => !o)}
                        className="p-2 hover:bg-line/60 rounded-md transition-colors"
                        aria-label="Toggle navigation"
                        aria-expanded={mobileMenuOpen}
                    >
                        <Menu className="h-6 w-6" />
                    </button>
                    <h1 className="font-serif italic text-2xl md:text-3xl leading-none text-accent-strong grow">
                        {{ budget: 'Budget', tabs: 'Tabs', nursery: 'Cost calculator', childcare: 'Childcare', fire: 'FIRE', reports: 'Reports', mortgage: 'Mortgage' }[activePage] || 'Budget'}
                    </h1>
                    <div className="flex items-center space-x-4">
                        <span className="hidden md:block text-ink-soft text-sm">Signed in as {user.username}</span>
                        <button onClick={handleLogout} className="p-2 hover:bg-line/60 rounded-full transition-colors" title="Logout">
                            <XCircle className="h-6 w-6" />
                        </button>
                    </div>
                </div>
                {mobileMenuOpen && (
                    <div className="mt-3 -mx-4 px-4 pt-3 border-t border-line flex flex-col gap-1">
                        {[
                            { id: 'budget',  label: 'Budget',  Icon: LayoutDashboard },
                            { id: 'tabs',    label: 'Tabs',    Icon: ArrowRightLeft },
                            { id: 'nursery', label: 'Nursery', Icon: Baby },
                            { id: 'childcare', label: 'Childcare', Icon: CalendarDays },
                            { id: 'fire',    label: 'FIRE',    Icon: Flame },
                            { id: 'reports', label: 'Reports', Icon: Coins },
                            { id: 'mortgage', label: 'Mortgage', Icon: Home },
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => { setActivePage(tab.id); setMobileMenuOpen(false); }}
                                className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all ${activePage === tab.id ? 'bg-accent text-paper' : 'text-ink-soft hover:bg-line/50'}`}
                            >
                                <tab.Icon className="h-4 w-4" /> {tab.label}
                            </button>
                        ))}
                    </div>
                )}
            </header>
            <main className="container mx-auto p-4 max-w-7xl">
                <Toast key={toast.key} message={toast.message} type={toast.type} onDismiss={() => setToast({ ...toast, message: '' })} />
                {activePage === 'reports' ? (
                    <ReportsPage showToast={(msg, type = 'success') => setToast({ message: msg, type, key: Date.now() })} />
                ) : activePage === 'mortgage' ? (
                    <MortgagePage showToast={(msg, type = 'success') => setToast({ message: msg, type, key: Date.now() })} />
                ) : activePage === 'fire' ? (
                    <FirePage showToast={(msg, type = 'success') => setToast({ message: msg, type, key: Date.now() })} />
                ) : activePage === 'childcare' ? (
                    <ChildcarePage onSettingsChange={setNurserySettings} />
                ) : activePage === 'nursery' ? (
                    <NurseryPage onSettingsChange={setNurserySettings} />
                ) : activePage === 'budget' ? (
                    <>
                        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] md:items-center gap-3 mb-6">
                            <div className="hidden md:block"></div>
                            <div className="flex justify-center">
                                <MonthSelector currentDate={currentDate} isLoading={isLoading} />
                            </div>
                            <div className="flex items-center gap-2 w-full md:w-auto md:justify-end">
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
                                        ? 'bg-line text-ink-soft cursor-not-allowed'
                                        : 'bg-accent text-paper hover:bg-accent-strong active:scale-[0.98]'
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
            <ItemCategoryModal isOpen={isCategoryModalOpen} onClose={() => setIsCategoryModalOpen(false)} onSave={handleSaveCategory} onDelete={handleDeleteItem} item={editingCategory} currentDate={currentDate} />
        </div>
    );
}

export default App;
