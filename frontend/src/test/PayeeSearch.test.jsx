import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PayeeSearch from '../components/PayeeSearch';
import apiService from '../services/api';

vi.mock('../services/api', () => ({ default: { searchPayees: vi.fn(), linkItemPayment: vi.fn() } }));

const sky = {
    payee_key: 'SKY DIGITAL', payee: 'Sky Digital', count: 3, last_date: '2026-11-12', last_amount: 47.5,
    amounts: [47.5, 45], payment_method: 'direct_debit', usual_day: 12, linked_item: null,
};

describe('PayeeSearch', () => {
    beforeEach(() => vi.clearAllMocks());

    it('opens on payments of the budgeted amount, then searches by another name and links', async () => {
        const user = userEvent.setup();
        apiService.searchPayees.mockResolvedValueOnce([]).mockResolvedValueOnce([sky]);
        apiService.linkItemPayment.mockResolvedValue({ payment_day: 12 });
        const onLinked = vi.fn();
        const showToast = vi.fn();
        render(<PayeeSearch itemId="b1" expectedAmount={45} onLinked={onLinked} showToast={showToast} />);
        expect(await screen.findByText(/at that amount — search by name instead/)).toBeInTheDocument();
        expect(apiService.searchPayees).toHaveBeenCalledWith('', 45, false);

        await user.type(screen.getByLabelText('Search Monzo payees'), 'sky{Enter}');
        expect(apiService.searchPayees).toHaveBeenLastCalledWith('sky', null, false);
        expect(await screen.findByText('Sky Digital')).toBeInTheDocument();
        expect(screen.getByText(/usually the 12th/)).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Use this' }));
        expect(apiService.linkItemPayment).toHaveBeenCalledWith('b1', { payee_match: 'SKY DIGITAL' });
        expect(showToast).toHaveBeenCalledWith('Linked to Sky Digital — usually the 12th');
        expect(onLinked).toHaveBeenCalled();
    });

    it('searches money in for income items and flags payees already linked', async () => {
        apiService.searchPayees.mockResolvedValue([{ ...sky, payee: 'Acme Payroll', payee_key: 'ACME PAYROLL', linked_item: 'Salary' }]);
        render(<PayeeSearch itemId="s1" expectedAmount={3000} incoming onLinked={vi.fn()} showToast={vi.fn()} />);
        expect(await screen.findByText(/Already linked to Salary/)).toBeInTheDocument();
        expect(apiService.searchPayees).toHaveBeenCalledWith('', 3000, true);
        expect(screen.getByText('Money in of £3,000.00')).toBeInTheDocument();
    });

    it('lists each recent payment, so two a month from one provider both show', async () => {
        apiService.searchPayees.mockResolvedValue([{ ...sky, payee: 'British Gas', payee_key: 'BRITISH GAS',
            recent: [{ date: '2026-11-09', amount: 42.1 }, { date: '2026-11-02', amount: 97.3 }] }]);
        render(<PayeeSearch itemId="g1" expectedAmount={40} onLinked={vi.fn()} showToast={vi.fn()} />);
        const recent = await screen.findByTestId('payee-recent');
        expect(recent).toHaveTextContent('£42.10');
        expect(recent).toHaveTextContent('£97.30');
    });
});
