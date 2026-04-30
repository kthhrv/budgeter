import { useMemo } from 'react';

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

        const keithDirectExpenses = expenses.filter(i => i.owner === 'keith' && !i.is_tab_repayment).reduce((s, i) => s + (parseFloat(i.effective_value) || 0), 0);
        const tildDirectExpenses = expenses.filter(i => i.owner === 'tild' && !i.is_tab_repayment).reduce((s, i) => s + (parseFloat(i.effective_value) || 0), 0);

        const keithTabRepayment = expenses.filter(i => i.owner === 'keith' && i.is_tab_repayment).reduce((s, i) => s + (parseFloat(i.effective_value) || 0), 0);
        const tildTabRepayment = expenses.filter(i => i.owner === 'tild' && i.is_tab_repayment).reduce((s, i) => s + (parseFloat(i.effective_value) || 0), 0);

        const keithIncome = incomes.filter(i => i.owner === 'keith').reduce((s, i) => s + (parseFloat(i.effective_value) || 0), 0);
        const tildIncome = incomes.filter(i => i.owner === 'tild').reduce((s, i) => s + (parseFloat(i.effective_value) || 0), 0);

        const keithRemaining = keithIncome - keithDirectExpenses - keithShare - keithTabRepayment + tildTabRepayment;
        const tildRemaining = tildIncome - tildDirectExpenses - tildShare - tildTabRepayment + keithTabRepayment;

        const billsPotTotal = items
            .filter(item => item.bills_pot)
            .reduce((sum, item) => sum + (parseFloat(item.effective_value) || 0), 0);

        const groceriesPotTotal = items
            .filter(item => item.groceries_pot)
            .reduce((sum, item) => sum + (parseFloat(item.effective_value) || 0), 0);

        const sharedIncome = incomes.filter(i => i.owner === 'shared').reduce((s, i) => s + (parseFloat(i.effective_value) || 0), 0);

        return {
            keithShare, tildShare, keithProportion, tildProportion,
            keithRemaining, tildRemaining, keithIncome, tildIncome,
            keithDirectExpenses, tildDirectExpenses,
            keithTabRepayment, tildTabRepayment,
            billsPotTotal, groceriesPotTotal, sharedTotal, sharedIncome
        };
    }, [items]);
};
