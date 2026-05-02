import { useMemo } from 'react';

export const useBudgetTotals = (items) => {
    return useMemo(() => {
        const incomes = items.filter(item => item.item_type === 'income');
        const expenses = items.filter(item => item.item_type === 'expense');
        const savingsItems = items.filter(item => item.item_type === 'savings');

        const sumValues = (list) => list.reduce((s, i) => s + (parseFloat(i.effective_value) || 0), 0);

        const keithSalary = sumValues(incomes.filter(i => i.owner === 'keith' && i.item_name.toLowerCase() === 'salary'));
        const tildSalary = sumValues(incomes.filter(i => i.owner === 'tild' && i.item_name.toLowerCase() === 'salary'));

        const totalSalaryIncome = keithSalary + tildSalary;
        let keithProportion = 0.5, tildProportion = 0.5;
        if (totalSalaryIncome > 0) {
            keithProportion = keithSalary / totalSalaryIncome;
            tildProportion = tildSalary / totalSalaryIncome;
        }

        const sharedExpenseItems = expenses.filter(i => i.owner === 'shared');
        const sharedTotal = sumValues(sharedExpenseItems);
        const extraTotal = sumValues(sharedExpenseItems.filter(i => i.is_extra));
        const sharedExpenseTotal = sharedTotal - extraTotal;

        const sharedSavings = sumValues(savingsItems.filter(i => i.owner === 'shared'));

        // Contributions cover all shared outgoings: regular expenses, extras (buffer), and savings.
        const sharedFundedTotal = sharedTotal + sharedSavings;
        const keithShare = sharedFundedTotal * keithProportion;
        const tildShare = sharedFundedTotal * tildProportion;

        const keithDirectExpenses = sumValues(expenses.filter(i => i.owner === 'keith' && !i.is_tab_repayment));
        const tildDirectExpenses = sumValues(expenses.filter(i => i.owner === 'tild' && !i.is_tab_repayment));

        const keithSavings = sumValues(savingsItems.filter(i => i.owner === 'keith'));
        const tildSavings = sumValues(savingsItems.filter(i => i.owner === 'tild'));

        const keithTabRepayment = sumValues(expenses.filter(i => i.owner === 'keith' && i.is_tab_repayment));
        const tildTabRepayment = sumValues(expenses.filter(i => i.owner === 'tild' && i.is_tab_repayment));

        const isSyntheticRepayment = (i) => String(i.budget_item_id).includes('-repay-income');
        const keithIncome = sumValues(incomes.filter(i => i.owner === 'keith' && !isSyntheticRepayment(i)));
        const tildIncome = sumValues(incomes.filter(i => i.owner === 'tild' && !isSyntheticRepayment(i)));

        const keithRemaining = keithIncome - keithDirectExpenses - keithSavings - keithShare - keithTabRepayment + tildTabRepayment;
        const tildRemaining = tildIncome - tildDirectExpenses - tildSavings - tildShare - tildTabRepayment + keithTabRepayment;

        const billsPotTotal = sumValues(items.filter(item => item.expense_pot === 'bills'));
        const groceriesPotTotal = sumValues(items.filter(item => item.expense_pot === 'groceries'));

        const sharedIncome = sumValues(incomes.filter(i => i.owner === 'shared'));

        return {
            keithShare, tildShare, keithProportion, tildProportion,
            keithRemaining, tildRemaining, keithIncome, tildIncome,
            keithDirectExpenses, tildDirectExpenses,
            keithSavings, tildSavings, sharedSavings,
            keithTabRepayment, tildTabRepayment,
            billsPotTotal, groceriesPotTotal,
            sharedTotal, sharedExpenseTotal, sharedFundedTotal,
            extraTotal, sharedIncome,
        };
    }, [items]);
};
