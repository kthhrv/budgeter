import React from 'react';
import { User, Home, TrendingUp, TrendingDown, Wallet } from 'lucide-react';

export const SharedCard = ({ billsPotTotal, groceriesPotTotal, sharedIncome, sharedExpenses, extraTotal = 0, totalContributions }) => {
    const remaining = sharedIncome + totalContributions - sharedExpenses;
    return (
        <div className="p-5 bg-white rounded-xl shadow-md border border-gray-100 hover:shadow-lg transition-shadow flex flex-col h-full">
            <div className="flex items-center justify-center mb-4">
                <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center mr-2"><Home className="h-4 w-4 text-purple-600" /></div>
                <h4 className="text-lg font-bold text-purple-800">Joint</h4>
            </div>
            <div className="space-y-3 text-sm grow">
                <div className="flex justify-between items-center"><span className="flex items-center text-gray-600"><TrendingUp className="mr-2 h-4 w-4 text-emerald-500" />Income</span> <span className="font-semibold text-emerald-600">+ £{sharedIncome.toFixed(2)}</span></div>
                <div className="flex justify-between items-center"><span className="flex items-center text-gray-600"><TrendingUp className="mr-2 h-4 w-4 text-emerald-500" />Joint Account</span> <span className="font-semibold text-emerald-600">+ £{totalContributions.toFixed(2)}</span></div>
                <div className="flex justify-between items-center"><span className="flex items-center text-gray-600"><TrendingDown className="mr-2 h-4 w-4 text-red-400" />Expenses</span> <span className="font-semibold text-red-500">- £{sharedExpenses.toFixed(2)}</span></div>
                <div className="ml-6 space-y-1.5 text-xs text-gray-500">
                    <div className="flex justify-between items-center"><span>Bills Pot</span> <span className="font-medium">£{billsPotTotal.toFixed(2)}</span></div>
                    <div className="flex justify-between items-center"><span>Groceries Pot</span> <span className="font-medium">£{groceriesPotTotal.toFixed(2)}</span></div>
                </div>
                {extraTotal > 0 && (
                    <div className="flex justify-between items-center"><span className="flex items-center text-gray-600"><Wallet className="mr-2 h-4 w-4 text-amber-500" />Extra</span> <span className="font-semibold text-amber-600">£{extraTotal.toFixed(2)}</span></div>
                )}
            </div>
            <div className={`mt-4 pt-4 flex justify-between items-center rounded-lg p-3 -mx-1 ${remaining >= 0 ? 'bg-purple-50' : 'bg-red-50'}`}>
                <span className="flex items-center font-bold text-gray-700"><Wallet className="mr-2 h-5 w-5" />Remaining</span>
                <span className={`font-extrabold text-xl ${remaining >= 0 ? 'text-purple-700' : 'text-red-600'}`}>£{remaining.toFixed(2)}</span>
            </div>
        </div>
    );
};

export const PersonCard = ({ name, color, income, directExpenses, share, sharedTotal, proportion, remaining, repaymentIn = 0, repaymentOut = 0 }) => {
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
                <div className="flex justify-between items-center"><span className="flex items-center text-gray-600"><TrendingUp className="mr-2 h-4 w-4 text-emerald-500" />Income</span> <span className="font-semibold text-emerald-600">+ £{(income + repaymentIn).toFixed(2)}</span></div>
                {repaymentIn > 0 && <div className="ml-6 flex justify-between items-center text-xs text-gray-500"><span>Tab Repayment In</span> <span className="font-medium">£{repaymentIn.toFixed(2)}</span></div>}
                <div className="flex justify-between items-center"><span className="flex items-center text-gray-600"><TrendingDown className="mr-2 h-4 w-4 text-red-400" />Personal Expenses</span> <span className="font-semibold text-red-500">- £{(directExpenses + repaymentOut).toFixed(2)}</span></div>
                {repaymentOut > 0 && <div className="ml-6 flex justify-between items-center text-xs text-gray-500"><span>Tab Repayment Out</span> <span className="font-medium">£{repaymentOut.toFixed(2)}</span></div>}
                <div className="flex justify-between items-center"><span className="flex items-center text-gray-600"><TrendingDown className="mr-2 h-4 w-4 text-red-400" />Joint Expenses</span> <span className="font-semibold text-red-500">- £{share.toFixed(2)}</span></div>
                <div className="flex justify-between items-center"><span className="flex items-center text-gray-400 text-xs"><span className="mr-6">&nbsp;</span>{(proportion * 100).toFixed(1)}% of £{sharedTotal.toFixed(0)}</span></div>
            </div>
            <div className={`mt-4 pt-4 flex justify-between items-center rounded-lg p-3 -mx-1 ${remaining >= 0 ? c.okBg : 'bg-red-50'}`}>
                <span className="flex items-center font-bold text-gray-700"><Wallet className="mr-2 h-5 w-5" />Remaining</span>
                <span className={`font-extrabold text-xl ${remaining >= 0 ? c.ok : 'text-red-600'}`}>£{remaining.toFixed(2)}</span>
            </div>
        </div>
    );
};
