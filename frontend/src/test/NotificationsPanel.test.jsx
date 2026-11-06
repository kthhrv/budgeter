import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotificationsPanel from '../components/NotificationsPanel';
import apiService from '../services/api';

vi.mock('../services/api', () => ({ default: { notificationAction: vi.fn() } }));

const amountChanged = {
    id: 1, kind: 'amount_changed', status: 'open', month_name: 'November 2026', actions: ['reconcile', 'one_off', 'dismiss'],
    data: { item_name: 'Broadband', expected: 45, actual: 47.5, payee: 'Sky Digital', payment_date: '2026-11-12' },
};
const missed = {
    id: 2, kind: 'missed', status: 'open', actions: ['mark_paid', 'dismiss'],
    data: { item_name: 'Netflix', expected: 10.99, due_date: '2026-11-05' },
};
const newPayee = {
    id: 3, kind: 'new_payee', status: 'open', actions: ['link', 'dismiss'],
    data: { payee: 'Spotify', amount: 9.99, cadence: 'monthly', usual_day: 15, payment_method: 'card' },
};

const setup = (notifications, onChanged = vi.fn()) => render(
    <NotificationsPanel isOpen onClose={vi.fn()} notifications={notifications}
        items={[{ id: 'b9', name: 'Music' }]} onChanged={onChanged} showToast={vi.fn()} />,
);

describe('NotificationsPanel', () => {
    beforeEach(() => { vi.clearAllMocks(); apiService.notificationAction.mockResolvedValue({}); });

    it('offers to reconcile a changed amount first', async () => {
        const user = userEvent.setup();
        const onChanged = vi.fn();
        setup([amountChanged], onChanged);
        expect(screen.getByText(/was/)).toHaveTextContent('Broadband was £47.50, not £45.00');
        const buttons = screen.getAllByRole('button').filter(b => b.getAttribute('aria-label') !== 'Close');
        expect(buttons[0]).toHaveTextContent('Reconcile budget to £47.50');
        await user.click(buttons[0]);
        expect(apiService.notificationAction).toHaveBeenCalledWith(1, 'reconcile', undefined);
        expect(onChanged).toHaveBeenCalledWith('reconcile');
    });

    it('hides one-off when the server does not offer it', () => {
        setup([{ ...amountChanged, actions: ['reconcile', 'dismiss'] }]);
        expect(screen.queryByRole('button', { name: 'Just this month' })).not.toBeInTheDocument();
    });

    it('marks a missed payment as paid', async () => {
        const user = userEvent.setup();
        setup([missed]);
        await user.click(screen.getByRole('button', { name: 'Mark as paid' }));
        expect(apiService.notificationAction).toHaveBeenCalledWith(2, 'mark_paid', undefined);
    });

    it('links a new payee to the chosen item', async () => {
        const user = userEvent.setup();
        setup([newPayee]);
        expect(screen.getByRole('button', { name: 'Link' })).toBeDisabled();
        await user.selectOptions(screen.getByRole('combobox'), 'b9');
        await user.click(screen.getByRole('button', { name: 'Link' }));
        expect(apiService.notificationAction).toHaveBeenCalledWith(3, 'link', 'b9');
    });

    it('shows an empty state', () => {
        setup([]);
        expect(screen.getByText('All caught up.')).toBeInTheDocument();
    });
});
