import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PayeeLinkModal from '../components/PayeeLinkModal';
import apiService from '../services/api';

vi.mock('../services/api', () => ({
    default: { getPayeeSuggestions: vi.fn(), linkItemPayment: vi.fn(), ignorePayee: vi.fn() },
}));

const suggestion = (over) => ({
    payee_key: 'SKY DIGITAL', payee: 'Sky Digital', amount: 45, cadence: 'monthly', usual_day: 12, usual_weekday: null,
    payment_method: 'direct_debit', count: 3, candidates: [{ item_id: 'b1', name: 'Broadband', amount: 45, score: 2 }],
    ambiguous: false, suggested_item_id: 'b1', ...over,
});

const items = [{ id: 'b1', name: 'Broadband' }, { id: 'b2', name: 'Music' }, { id: 'b3', name: 'Cloud' }];

describe('PayeeLinkModal', () => {
    beforeEach(() => vi.clearAllMocks());

    it('pre-selects the suggestion and links it', async () => {
        const user = userEvent.setup();
        apiService.getPayeeSuggestions.mockResolvedValue([suggestion()]);
        apiService.linkItemPayment.mockResolvedValue({});
        const onLinked = vi.fn();
        render(<PayeeLinkModal isOpen onClose={vi.fn()} items={items} onLinked={onLinked} showToast={vi.fn()} />);
        expect(await screen.findByText('usually the 12th · Direct Debit · 3 payments', { exact: false })).toBeInTheDocument();
        expect(screen.getByRole('combobox')).toHaveValue('b1');
        await user.click(screen.getByRole('button', { name: 'Link' }));
        expect(apiService.linkItemPayment).toHaveBeenCalledWith('b1', { payee_match: 'SKY DIGITAL' });
        expect(onLinked).toHaveBeenCalled();
        expect(screen.queryByTestId('payee-suggestion')).not.toBeInTheDocument();
    });

    it('leaves ambiguous matches for the person to pick', async () => {
        apiService.getPayeeSuggestions.mockResolvedValue([suggestion({
            payee_key: 'STREAMCO', payee: 'StreamCo', amount: 9.99, ambiguous: true, suggested_item_id: null,
            candidates: [{ item_id: 'b2', name: 'Music', amount: 9.99, score: 2 }, { item_id: 'b3', name: 'Cloud', amount: 9.99, score: 2 }],
        })]);
        render(<PayeeLinkModal isOpen onClose={vi.fn()} items={items} showToast={vi.fn()} />);
        expect(await screen.findByText(/several items match/)).toBeInTheDocument();
        expect(screen.getByRole('combobox')).toHaveValue('');
        expect(screen.getByRole('button', { name: 'Link' })).toBeDisabled();
    });

    it('ignores a payee that is not a budget item', async () => {
        const user = userEvent.setup();
        apiService.getPayeeSuggestions.mockResolvedValue([suggestion()]);
        apiService.ignorePayee.mockResolvedValue(null);
        render(<PayeeLinkModal isOpen onClose={vi.fn()} items={items} showToast={vi.fn()} />);
        await user.click(await screen.findByRole('button', { name: 'Not a budget item' }));
        expect(apiService.ignorePayee).toHaveBeenCalledWith('SKY DIGITAL');
    });
});
