import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TransactionPicker from '../components/TransactionPicker';
import apiService from '../services/api';

vi.mock('../services/api', () => ({ default: { getCandidatePayments: vi.fn(), linkTransaction: vi.fn() } }));

const entry = { budget_item_id: 'm1', item_name: 'Mortgage', due_date: '2026-11-02' };

describe('TransactionPicker', () => {
    beforeEach(() => vi.clearAllMocks());

    it('lists every payment around the date and adds one to the item', async () => {
        const user = userEvent.setup();
        const onLinked = vi.fn();
        apiService.getCandidatePayments.mockResolvedValue([
            { id: 1, date: '2026-11-02', amount: 600, payee: 'Natwest Mortgage', linked_item_id: 'm1', linked_item: 'Mortgage' },
            { id: 2, date: '2026-11-02', amount: 250, payee: 'Natwest Mortgage', linked_item_id: null, linked_item: null },
            { id: 3, date: '2026-11-03', amount: 40, payee: 'British Gas', linked_item_id: 'g1', linked_item: 'Gas' },
        ]);
        apiService.linkTransaction.mockResolvedValue({ linked: 2, payment_parts: 2 });
        render(<TransactionPicker entry={entry} onLinked={onLinked} showToast={vi.fn()} />);
        const rows = await screen.findAllByTestId('candidate-payment');
        expect(apiService.getCandidatePayments).toHaveBeenCalledWith('m1', '2026-11-02', '');
        expect(within(rows[0]).getByText('Linked')).toBeInTheDocument();
        expect(within(rows[2]).getByText(/counted for Gas/)).toBeInTheDocument();
        expect(within(rows[2]).getByRole('button', { name: 'Move' })).toBeInTheDocument();
        await user.click(within(rows[1]).getByRole('button', { name: 'Add' }));
        expect(apiService.linkTransaction).toHaveBeenCalledWith('m1', '2026-11-02', 2);
        expect(onLinked).toHaveBeenCalled();
    });
});
