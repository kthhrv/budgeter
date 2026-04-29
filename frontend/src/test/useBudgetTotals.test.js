import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBudgetTotals } from '../components/OwnerTotals';

const makeItem = (overrides) => ({
    budget_item_id: crypto.randomUUID(),
    item_name: 'Test Item',
    item_type: 'expense',
    owner: 'shared',
    effective_value: '100',
    bills_pot: false,
    calculation_type: 'fixed',
    is_one_off: false,
    ...overrides,
});

describe('useBudgetTotals', () => {
    it('returns zeros for empty items', () => {
        const { result } = renderHook(() => useBudgetTotals([]));
        expect(result.current.sharedTotal).toBe(0);
        expect(result.current.keithIncome).toBe(0);
        expect(result.current.tildIncome).toBe(0);
        expect(result.current.keithRemaining).toBe(0);
        expect(result.current.tildRemaining).toBe(0);
        expect(result.current.billsPotTotal).toBe(0);
        expect(result.current.sharedIncome).toBe(0);
    });

    it('splits shared expenses by salary proportion', () => {
        const items = [
            makeItem({ item_name: 'Salary', item_type: 'income', owner: 'keith', effective_value: '3000' }),
            makeItem({ item_name: 'Salary', item_type: 'income', owner: 'tild', effective_value: '1000' }),
            makeItem({ item_type: 'expense', owner: 'shared', effective_value: '400' }),
        ];
        const { result } = renderHook(() => useBudgetTotals(items));

        expect(result.current.keithProportion).toBe(0.75);
        expect(result.current.tildProportion).toBe(0.25);
        expect(result.current.keithShare).toBe(300);
        expect(result.current.tildShare).toBe(100);
        expect(result.current.sharedTotal).toBe(400);
    });

    it('defaults to 50/50 when no salary items exist', () => {
        const items = [
            makeItem({ item_type: 'expense', owner: 'shared', effective_value: '200' }),
        ];
        const { result } = renderHook(() => useBudgetTotals(items));

        expect(result.current.keithProportion).toBe(0.5);
        expect(result.current.tildProportion).toBe(0.5);
        expect(result.current.keithShare).toBe(100);
        expect(result.current.tildShare).toBe(100);
    });

    it('calculates remaining correctly', () => {
        const items = [
            makeItem({ item_name: 'Salary', item_type: 'income', owner: 'keith', effective_value: '2000' }),
            makeItem({ item_name: 'Salary', item_type: 'income', owner: 'tild', effective_value: '2000' }),
            makeItem({ item_type: 'expense', owner: 'shared', effective_value: '1000' }),
            makeItem({ item_type: 'expense', owner: 'keith', effective_value: '300' }),
            makeItem({ item_type: 'expense', owner: 'tild', effective_value: '200' }),
        ];
        const { result } = renderHook(() => useBudgetTotals(items));

        // 50/50 split: each pays 500 shared
        expect(result.current.keithRemaining).toBe(2000 - 300 - 500);
        expect(result.current.tildRemaining).toBe(2000 - 200 - 500);
    });

    it('calculates personal income and expenses separately', () => {
        const items = [
            makeItem({ item_name: 'Salary', item_type: 'income', owner: 'keith', effective_value: '3000' }),
            makeItem({ item_name: 'Bonus', item_type: 'income', owner: 'keith', effective_value: '500' }),
            makeItem({ item_type: 'expense', owner: 'keith', effective_value: '150' }),
            makeItem({ item_type: 'expense', owner: 'keith', effective_value: '50' }),
        ];
        const { result } = renderHook(() => useBudgetTotals(items));

        expect(result.current.keithIncome).toBe(3500);
        expect(result.current.keithDirectExpenses).toBe(200);
    });

    it('calculates bills pot total from flagged items', () => {
        const items = [
            makeItem({ item_type: 'expense', owner: 'shared', effective_value: '100', bills_pot: true }),
            makeItem({ item_type: 'expense', owner: 'shared', effective_value: '200', bills_pot: true }),
            makeItem({ item_type: 'expense', owner: 'shared', effective_value: '300', bills_pot: false }),
        ];
        const { result } = renderHook(() => useBudgetTotals(items));

        expect(result.current.billsPotTotal).toBe(300);
        expect(result.current.sharedTotal).toBe(600);
    });

    it('calculates shared income', () => {
        const items = [
            makeItem({ item_type: 'income', owner: 'shared', effective_value: '50' }),
            makeItem({ item_type: 'income', owner: 'shared', effective_value: '30' }),
            makeItem({ item_type: 'income', owner: 'keith', effective_value: '1000' }),
        ];
        const { result } = renderHook(() => useBudgetTotals(items));

        expect(result.current.sharedIncome).toBe(80);
    });

    it('handles string effective_value parsing', () => {
        const items = [
            makeItem({ item_name: 'Salary', item_type: 'income', owner: 'keith', effective_value: '1500.50' }),
        ];
        const { result } = renderHook(() => useBudgetTotals(items));

        expect(result.current.keithIncome).toBeCloseTo(1500.50);
    });

    it('separates tab repayments from direct expenses', () => {
        const items = [
            makeItem({ item_name: 'Salary', item_type: 'income', owner: 'keith', effective_value: '2000' }),
            makeItem({ item_name: 'Salary', item_type: 'income', owner: 'tild', effective_value: '2000' }),
            makeItem({ item_type: 'expense', owner: 'keith', effective_value: '300' }),
            makeItem({ item_type: 'expense', owner: 'keith', effective_value: '100', is_tab_repayment: true }),
            makeItem({ item_type: 'expense', owner: 'tild', effective_value: '50', is_tab_repayment: true }),
        ];
        const { result } = renderHook(() => useBudgetTotals(items));

        expect(result.current.keithDirectExpenses).toBe(300);
        expect(result.current.keithTabRepayment).toBe(100);
        expect(result.current.tildTabRepayment).toBe(50);
        // Keith remaining: 2000 - 300 - 0 (shared) - 100 (out) + 50 (in)
        expect(result.current.keithRemaining).toBe(1650);
        // Tild remaining: 2000 - 0 - 0 (shared) - 50 (out) + 100 (in)
        expect(result.current.tildRemaining).toBe(2050);
    });
});
