import React, { useMemo } from 'react';
import { User, Home, TrendingUp, TrendingDown, Wallet } from 'lucide-react';

export const useBudgetTotals = (items) => {
    return useMemo(() => {
        const incomes = items.filter(item => item.item_type === 'income');
        const expenses = items.filter(item => item.item_type === 'expense');

        const keithSalary = incomes
            .filter(i => i.owner === 'keith' && i.item_name.toLowerCase() === 'salary')
            .reduce((s, i) => s + (parseFloat(i.effective_value) || 0), 0);
        const tildSalary = incomes
            .filter(i => i.owner === 'tild' && i.item_name.toLowerCase() === 'salary')
            .reduce((s, i) => s + (parseFloat(i.effective_value) || 0), 0);

        const totalSalaryIncome = keithSalary + tildSalary;
        let keithProportion = 0.5, tildProportion = 0.5;
        if (totalSalaryIncome > 0) {
            keithProportion = keithSalary / totalSalaryIncome;
            tildProportion = tildSalary / totalSalaryIncome;
        }

        const sharedTotal = expenses.filter(i => i.owner === 'shared').reduce((s, i) => s + (parseFloat(i.effective_value) || 0), 0);
        const keithShare = sharedTotal * keithProportion;
        const tildShare = sharedTotal * tildProportion;

        const keithDirectExpenses = expenses.filter(i => i.owner === 'keith').reduce((s, i) => s + (parseFloat(i.effective_value) || 0), 0);
        const tildDirectExpenses = expenses.filter(i => i.owner === 'tild').reduce((s, i) => s + (parseFloat(i.effective_value) || 0), 0);

        const keithIncome = incomes.filter(i => i.owner === 'keith').reduce((s, i) => s + (parseFloat(i.effective_value) || 0), 0);
        const tildIncome = incomes.filter(i => i.owner === 'tild').reduce((s, i) => s + (parseFloat(i.effective_value) || 0), 0);

        const keithRemaining = keithIncome - keithDirectExpenses - keithShare;
        const tildRemaining = tildIncome - tildDirectExpenses - tildShare;

        const billsPotTotal = items
            .filter(item => item.bills_pot)
            .reduce((sum, item) => sum + (parseFloat(item.effective_value) || 0), 0);

        const sharedIncome = incomes.filter(i => i.owner === 'shared').reduce((s, i) => s + (parseFloat(i.effective_value) || 0), 0);

        return {
            keithShare, tildShare, keithProportion, tildProportion,
            keithRemaining, tildRemaining, keithIncome, tildIncome,
            keithDirectExpenses, tildDirectExpenses,
            billsPotTotal, sharedTotal, sharedIncome
        };
    }, [items]);
};

export const SharedCard = ({ billsPotTotal, sharedIncome, sharedExpenses, totalContributions }) => {
    const remaining = sharedIncome + totalContributions - sharedExpenses;
    return (
        <div className="p-5 bg-white rounded-xl shadow-md border border-gray-100 hover:shadow-lg transition-shadow flex flex-col h-full">
            <div className="flex items-center justify-center mb-4">
                <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center mr-2"><Home className="h-4 w-4 text-purple-600" /></div>
                <h4 className="text-lg font-bold text-purple-800">Shared</h4>
            </div>
            <div className="space-y-3 text-sm grow">
                <div className="flex justify-between items-center"><span className="flex items-center text-gray-600"><TrendingUp className="mr-2 h-4 w-4 text-emerald-500" />Income</span> <span className="font-semibold text-emerald-600">+ £{sharedIncome.toFixed(2)}</span></div>
                <div className="flex justify-between items-center"><span className="flex items-center text-gray-600"><TrendingUp className="mr-2 h-4 w-4 text-emerald-500" />Contributions</span> <span className="font-semibold text-emerald-600">+ £{totalContributions.toFixed(2)}</span></div>
                <div className="flex justify-between items-center"><span className="flex items-center text-gray-600"><TrendingDown className="mr-2 h-4 w-4 text-red-400" />Expenses</span> <span className="font-semibold text-red-500">- £{sharedExpenses.toFixed(2)}</span></div>
                <div className="flex justify-between items-center"><span className="flex items-center text-gray-600"><Home className="mr-2 h-4 w-4 text-purple-500" />Bills Pot</span> <span className="font-semibold text-purple-700">£{billsPotTotal.toFixed(2)}</span></div>
            </div>
            <div className={`mt-4 pt-4 border-t flex justify-between items-center rounded-lg p-3 -mx-1 ${remaining >= 0 ? 'bg-purple-50' : 'bg-red-50'}`}>
                <span className="flex items-center font-bold text-gray-700"><Wallet className="mr-2 h-5 w-5" />Remaining</span>
                <span className={`font-extrabold text-xl ${remaining >= 0 ? 'text-purple-700' : 'text-red-600'}`}>£{remaining.toFixed(2)}</span>
            </div>
        </div>
    );
};

export const PersonCard = ({ name, color, income, directExpenses, share, sharedTotal, proportion, remaining }) => {
    const styles = {
        blue: { bg: 'bg-blue-100', icon: 'text-blue-600', title: 'text-blue-800', ok: 'text-blue-700', okBg: 'bg-blue-50' },
        pink: { bg: 'bg-pink-100', icon: 'text-pink-600', title: 'text-pink-800', ok: 'text-pink-700', okBg: 'bg-pink-50' },
    };
    const c = styles[color];

    return (
        <div className="p-5 bg-white rounded-xl shadow-md border border-gray-100 hover:shadow-lg transition-shadow flex flex-col h-full">
            <div className="flex items-center justify-center mb-4">
                <div className={`w-8 h-8 rounded-full ${c.bg} flex items-center justify-center mr-2`}><User className={`h-4 w-4 ${c.icon}`} /></div>
                <h4 className={`text-lg font-bold ${c.title}`}>{name}</h4>
            </div>
            <div className="space-y-3 text-sm grow">
                <div className="flex justify-between items-center"><span className="flex items-center text-gray-600"><TrendingUp className="mr-2 h-4 w-4 text-emerald-500" />Income</span> <span className="font-semibold text-emerald-600">+ £{income.toFixed(2)}</span></div>
                <div className="flex justify-between items-center"><span className="flex items-center text-gray-600"><TrendingDown className="mr-2 h-4 w-4 text-red-400" />Personal Expenses</span> <span className="font-semibold text-red-500">- £{directExpenses.toFixed(2)}</span></div>
                <div className="flex justify-between items-center"><span className="flex items-center text-gray-600"><TrendingDown className="mr-2 h-4 w-4 text-red-400" />Shared Expenses</span> <span className="font-semibold text-red-500">- £{share.toFixed(2)}</span></div>
                <div className="flex justify-between items-center"><span className="flex items-center text-gray-400 text-xs"><span className="mr-6">&nbsp;</span>{(proportion * 100).toFixed(1)}% of £{sharedTotal.toFixed(0)}</span></div>
            </div>
            <div className={`mt-4 pt-4 border-t flex justify-between items-center rounded-lg p-3 -mx-1 ${remaining >= 0 ? c.okBg : 'bg-red-50'}`}>
                <span className="flex items-center font-bold text-gray-700"><Wallet className="mr-2 h-5 w-5" />Remaining</span>
                <span className={`font-extrabold text-xl ${remaining >= 0 ? c.ok : 'text-red-600'}`}>£{remaining.toFixed(2)}</span>
            </div>
        </div>
    );
};
