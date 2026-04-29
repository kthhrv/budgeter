import React, { useMemo } from 'react';
import { User, Home, TrendingUp, TrendingDown, Wallet } from 'lucide-react';

const OwnerTotals = ({ items }) => {
    const {
        keithShare, tildShare, keithProportion, tildProportion,
        keithRemaining, tildRemaining, keithIncome, tildIncome, keithDirectExpenses, tildDirectExpenses,
        billsPotTotal, sharedTotal
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
            billsPotTotal: billsTotal, sharedTotal: shared
        };
    }, [items]);

    return (
        <div className="my-4 space-y-6">
            <div className="p-6 bg-white rounded-xl shadow-md border border-gray-100">
                <h3 className="text-lg font-semibold text-gray-500 uppercase tracking-wider mb-5 text-center">Shared Expense Breakdown</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    <div className="p-5 bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl text-center border border-blue-200/50 hover:shadow-md transition-shadow">
                        <div className="flex justify-center items-center text-blue-600 mb-2"><User className="mr-2 h-5 w-5" /> <h4 className="text-sm font-semibold uppercase tracking-wide">Keith's Share</h4></div>
                        <p className="text-3xl font-extrabold text-blue-900">£{keithShare.toFixed(0)}</p>
                        <p className="text-xs text-blue-500 mt-2 font-medium">({(keithProportion * 100).toFixed(1)}% of shared total)</p>
                    </div>
                    <div className="p-5 bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl text-center border border-purple-200/50 hover:shadow-md transition-shadow">
                        <div className="flex justify-center items-center text-purple-600 mb-2"><Home className="mr-2 h-5 w-5" /> <h4 className="text-sm font-semibold uppercase tracking-wide">Joint Account</h4></div>
                        <p className="text-3xl font-extrabold text-purple-900">£{sharedTotal.toFixed(0)}</p>
                        <p className="text-xs text-purple-500 mt-2 font-medium">Bills Pot: £{billsPotTotal.toFixed(0)}</p>
                    </div>
                    <div className="p-5 bg-gradient-to-br from-pink-50 to-pink-100 rounded-xl text-center border border-pink-200/50 hover:shadow-md transition-shadow">
                        <div className="flex justify-center items-center text-pink-600 mb-2"><User className="mr-2 h-5 w-5" /> <h4 className="text-sm font-semibold uppercase tracking-wide">Tild's Share</h4></div>
                        <p className="text-3xl font-extrabold text-pink-900">£{tildShare.toFixed(0)}</p>
                        <p className="text-xs text-pink-500 mt-2 font-medium">({(tildProportion * 100).toFixed(1)}% of shared total)</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="p-5 bg-white rounded-xl shadow-md border border-gray-100 flex flex-col hover:shadow-lg transition-shadow">
                    <div className="flex items-center justify-center mb-4">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center mr-2"><User className="h-4 w-4 text-blue-600" /></div>
                        <h4 className="text-lg font-bold text-blue-800">Keith</h4>
                    </div>
                    <div className="space-y-3 text-sm flex-grow">
                        <div className="flex justify-between items-center"><span className="flex items-center text-gray-600"><TrendingUp className="mr-2 h-4 w-4 text-emerald-500" />Income</span> <span className="font-semibold text-emerald-600">+ £{keithIncome.toFixed(2)}</span></div>
                        <div className="flex justify-between items-center"><span className="flex items-center text-gray-600"><TrendingDown className="mr-2 h-4 w-4 text-red-400" />Personal Expenses</span> <span className="font-semibold text-red-500">- £{keithDirectExpenses.toFixed(2)}</span></div>
                        <div className="flex justify-between items-center"><span className="flex items-center text-gray-600"><TrendingDown className="mr-2 h-4 w-4 text-red-400" />Share of Expenses</span> <span className="font-semibold text-red-500">- £{keithShare.toFixed(2)}</span></div>
                    </div>
                    <div className={`mt-4 pt-4 border-t flex justify-between items-center rounded-lg p-3 -mx-1 ${keithRemaining >= 0 ? 'bg-blue-50' : 'bg-red-50'}`}>
                        <span className="flex items-center font-bold text-gray-700"><Wallet className="mr-2 h-5 w-5" />Remaining</span>
                        <span className={`font-extrabold text-xl ${keithRemaining >= 0 ? 'text-blue-700' : 'text-red-600'}`}>£{keithRemaining.toFixed(2)}</span>
                    </div>
                </div>
                <div className="p-5 bg-white rounded-xl shadow-md border border-gray-100 flex flex-col hover:shadow-lg transition-shadow">
                    <div className="flex items-center justify-center mb-4">
                        <div className="w-8 h-8 rounded-full bg-pink-100 flex items-center justify-center mr-2"><User className="h-4 w-4 text-pink-600" /></div>
                        <h4 className="text-lg font-bold text-pink-800">Tild</h4>
                    </div>
                    <div className="space-y-3 text-sm flex-grow">
                        <div className="flex justify-between items-center"><span className="flex items-center text-gray-600"><TrendingUp className="mr-2 h-4 w-4 text-emerald-500" />Income</span> <span className="font-semibold text-emerald-600">+ £{tildIncome.toFixed(2)}</span></div>
                        <div className="flex justify-between items-center"><span className="flex items-center text-gray-600"><TrendingDown className="mr-2 h-4 w-4 text-red-400" />Personal Expenses</span> <span className="font-semibold text-red-500">- £{tildDirectExpenses.toFixed(2)}</span></div>
                        <div className="flex justify-between items-center"><span className="flex items-center text-gray-600"><TrendingDown className="mr-2 h-4 w-4 text-red-400" />Share of Expenses</span> <span className="font-semibold text-red-500">- £{tildShare.toFixed(2)}</span></div>
                    </div>
                    <div className={`mt-4 pt-4 border-t flex justify-between items-center rounded-lg p-3 -mx-1 ${tildRemaining >= 0 ? 'bg-pink-50' : 'bg-red-50'}`}>
                        <span className="flex items-center font-bold text-gray-700"><Wallet className="mr-2 h-5 w-5" />Remaining</span>
                        <span className={`font-extrabold text-xl ${tildRemaining >= 0 ? 'text-pink-700' : 'text-red-600'}`}>£{tildRemaining.toFixed(2)}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default OwnerTotals;
