import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BillsPotCard from '../components/BillsPotCard';
import apiService from '../services/api';
import { billsLeftToPay } from '../utils/calendarGrid';

vi.mock('../services/api', () => ({
    default: { getPotBalances: vi.fn(), getAvailablePots: vi.fn(), linkBudgetPot: vi.fn() },
}));

const entries = [
    { expense_pot: 'bills', item_type: 'expense', expected_amount: 45, payment: { amount: 45 } }, // paid
    { expense_pot: 'bills', item_type: 'expense', expected_amount: 100, payment: null },
    { expense_pot: 'groceries', item_type: 'expense', expected_amount: 400, payment: null },
    { expense_pot: '', item_type: 'income', expected_amount: 3000, payment: null },
];
const unscheduled = [{ expense_pot: 'bills', item_type: 'expense', expected_amount: 20 }];

describe('billsLeftToPay', () => {
    it('counts unticked bills-pot expenses plus undated ones', () => {
        expect(billsLeftToPay(entries, unscheduled)).toEqual({ total: 120, undated: 20 });
    });
});

describe('BillsPotCard', () => {
    beforeEach(() => vi.clearAllMocks());

    it('shows balance, left to pay and the shortfall', async () => {
        apiService.getPotBalances.mockResolvedValue({ pots: { bills: { pot_id: 'p', name: 'Bills', balance: 100 } }, errors: [] });
        render(<BillsPotCard entries={entries} unscheduled={unscheduled} showToast={vi.fn()} />);
        const card = await screen.findByTestId('bills-pot');
        expect(card).toHaveTextContent('Balance£100.00');
        expect(card).toHaveTextContent('Left to pay£120.00');
        expect(card).toHaveTextContent('incl. £20.00 with no day');
        expect(card).toHaveTextContent('Short by£20.00');
    });

    it('shows what is spare when the balance covers it', async () => {
        apiService.getPotBalances.mockResolvedValue({ pots: { bills: { pot_id: 'p', name: 'Bills', balance: 500 } }, errors: [] });
        render(<BillsPotCard entries={entries} unscheduled={[]} showToast={vi.fn()} />);
        expect(await screen.findByTestId('bills-pot')).toHaveTextContent('Spare£400.00');
    });

    it('asks which pot holds the bills money', async () => {
        const user = userEvent.setup();
        apiService.getPotBalances.mockResolvedValueOnce({ pots: {}, errors: [] })
            .mockResolvedValueOnce({ pots: { bills: { pot_id: 'p1', name: 'Bills', balance: 900 } }, errors: [] });
        apiService.getAvailablePots.mockResolvedValue([{ id: 'p1', name: 'Bills', balance: 900 }, { id: 'p2', name: 'Holiday', balance: 50 }]);
        apiService.linkBudgetPot.mockResolvedValue({});
        render(<BillsPotCard entries={entries} unscheduled={[]} showToast={vi.fn()} />);
        await user.click(await screen.findByRole('button', { name: 'Choose Bills pot' }));
        await user.click(await screen.findByRole('button', { name: /Bills/ }));
        expect(apiService.linkBudgetPot).toHaveBeenCalledWith('bills', 'p1');
        expect(await screen.findByTestId('bills-pot')).toHaveTextContent('Spare£800.00');
    });
});
