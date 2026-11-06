import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CalendarPage from '../components/CalendarPage';
import apiService from '../services/api';

vi.mock('../services/api', () => ({
    default: {
        createOrGetMonth: vi.fn(),
        getPaymentCalendar: vi.fn(),
        syncPayments: vi.fn(),
        markPaid: vi.fn(),
        unmarkPaid: vi.fn(),
        linkItemPayment: vi.fn(),
        unlinkItemPayment: vi.fn(),
        setCalendarHidden: vi.fn(),
        getPersonalBalance: vi.fn(),
        getPotBalances: vi.fn(),
    },
}));

const entry = (over) => ({
    budget_item_id: 'b1', item_name: 'Broadband', owner: 'shared', expense_pot: 'bills', childcare_link: '',
    calculation_type: 'fixed', payee_match: 'SKY DIGITAL', payment_day: 12, payment_day_manual: false,
    payment_method: 'direct_debit', expected_amount: 45, scheduled_date: '2026-11-12', due_date: '2026-11-12',
    status: 'paid', payment: { id: 1, source: 'auto', date: '2026-11-12', amount: 47.5, payee: 'Sky Digital' },
    ...over,
});

const calendar = (over = {}) => ({
    month_id: '2026-11', connected: true, history_backfilled: true,
    last_synced_at: new Date().toISOString(),
    entries: [
        entry(),
        entry({ budget_item_id: 'b2', item_name: 'Netflix', payee_match: 'NETFLIX', expected_amount: 10.99,
            scheduled_date: '2026-11-05', due_date: '2026-11-05', status: 'overdue', payment: null, payment_method: 'card' }),
    ],
    unscheduled: [{ budget_item_id: 'b3', item_name: 'Council tax', owner: 'shared', expected_amount: 180, payee_match: '' }],
    hidden: [],
    ...over,
});

const NOV = new Date(2026, 10, 1);

// Node's own (flag-gated) localStorage shadows jsdom's here, so stub one.
function memoryStorage() {
    const store = new Map();
    return {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear(),
    };
}

describe('CalendarPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('localStorage', memoryStorage());
        apiService.getPotBalances.mockResolvedValue({ pots: {}, errors: [] });
        apiService.getPersonalBalance.mockResolvedValue({ account: { name: 'Current account', balance: 500 }, error: null });
        apiService.setCalendarHidden.mockResolvedValue(null);
        apiService.createOrGetMonth.mockResolvedValue({});
        apiService.getPaymentCalendar.mockResolvedValue(calendar());
        apiService.syncPayments.mockResolvedValue({ fetched: 0, matched: 0, errors: [] });
    });

    it('puts payments on their day with status and totals', async () => {
        render(<CalendarPage currentDate={NOV} showToast={vi.fn()} />);
        const day12 = await screen.findByTestId('day-2026-11-12');
        expect(within(day12).getAllByText('Broadband').length).toBeGreaterThan(0);
        expect(within(screen.getByTestId('day-2026-11-05')).getAllByText('Netflix').length).toBeGreaterThan(0);
        expect(screen.getByText('1 not seen yet')).toBeInTheDocument();
        expect(screen.getByText('Council tax')).toBeInTheDocument();
        expect(apiService.getPaymentCalendar).toHaveBeenCalledWith('2026-11');
    });

    it('shows the budgeted amount beside a different actual payment', async () => {
        const user = userEvent.setup();
        render(<CalendarPage currentDate={NOV} showToast={vi.fn()} />);
        await user.click(await screen.findByTestId('day-2026-11-12'));
        const row = screen.getByTestId('calendar-entry');
        expect(within(row).getByText('£47.50')).toBeInTheDocument();
        expect(within(row).getByText('budget £45.00')).toBeInTheDocument();
    });

    it('marks an overdue payment as paid by hand', async () => {
        const user = userEvent.setup();
        apiService.markPaid.mockResolvedValue({ id: 9, source: 'manual' });
        render(<CalendarPage currentDate={NOV} showToast={vi.fn()} />);
        await user.click(await screen.findByTestId('day-2026-11-05'));
        await user.click(screen.getByTestId('calendar-entry'));
        await user.click(screen.getByRole('button', { name: 'Mark as paid' }));
        expect(apiService.markPaid).toHaveBeenCalledWith('b2', '2026-11-05');
    });

    it('syncs on every visit, even straight after a sync', async () => {
        render(<CalendarPage currentDate={NOV} showToast={vi.fn()} onNotificationsChanged={vi.fn()} />);
        await waitFor(() => expect(apiService.syncPayments).toHaveBeenCalledTimes(1));
    });

    it('syncs again after an item is changed', async () => {
        const user = userEvent.setup();
        apiService.markPaid.mockResolvedValue({ id: 9, source: 'manual' });
        render(<CalendarPage currentDate={NOV} showToast={vi.fn()} />);
        await waitFor(() => expect(apiService.syncPayments).toHaveBeenCalledTimes(1));
        await user.click(await screen.findByTestId('day-2026-11-05'));
        await user.click(screen.getByTestId('calendar-entry'));
        await user.click(screen.getByRole('button', { name: 'Mark as paid' }));
        await waitFor(() => expect(apiService.syncPayments).toHaveBeenCalledTimes(2));
    });

    it('does not sync when nobody has connected Monzo', async () => {
        apiService.getPaymentCalendar.mockResolvedValue(calendar({ connected: false, last_synced_at: null }));
        render(<CalendarPage currentDate={NOV} showToast={vi.fn()} />);
        expect(await screen.findByText(/Connect Monzo from the FIRE tab/)).toBeInTheDocument();
        expect(apiService.syncPayments).not.toHaveBeenCalled();
    });

    it('substitutes childcare-linked amounts', async () => {
        apiService.getPaymentCalendar.mockResolvedValue(calendar({
            entries: [entry({ item_name: 'Ellis nursery', childcare_link: 'ellis_nursery', payment: null, status: 'upcoming', expected_amount: 0 })],
        }));
        render(<CalendarPage currentDate={NOV} childcareNets={{ ellis_nursery: 812.5 }} showToast={vi.fn()} />);
        expect(await screen.findByText('£812.50', { exact: false })).toBeInTheDocument();
    });

    it('switches between Joint, Tild and Keith and remembers the choice', async () => {
        const user = userEvent.setup();
        apiService.getPaymentCalendar.mockResolvedValue(calendar({
            entries: [entry(), entry({ budget_item_id: 'b9', item_name: 'Gym', owner: 'tild', scheduled_date: '2026-11-03', due_date: '2026-11-03', payment: null, status: 'upcoming' })],
        }));
        render(<CalendarPage currentDate={NOV} showToast={vi.fn()} />);
        await screen.findByTestId('day-2026-11-12');
        expect(within(screen.getByTestId('day-2026-11-12')).getAllByText('Broadband').length).toBeGreaterThan(0);
        expect(within(screen.getByTestId('day-2026-11-03')).queryAllByText('Gym')).toHaveLength(0);

        await user.click(screen.getByRole('tab', { name: 'Tild' }));
        expect(within(screen.getByTestId('day-2026-11-03')).getAllByText('Gym').length).toBeGreaterThan(0);
        expect(within(screen.getByTestId('day-2026-11-12')).queryAllByText('Broadband')).toHaveLength(0);
        expect(screen.queryByText('Council tax')).not.toBeInTheDocument();
        expect(localStorage.getItem('calendar-view')).toBe('tild');
    });

    it('removes an item from the calendar and brings it back', async () => {
        const user = userEvent.setup();
        render(<CalendarPage currentDate={NOV} showToast={vi.fn()} />);
        await user.click(await screen.findByTestId('day-2026-11-05'));
        await user.click(screen.getByTestId('calendar-entry'));
        apiService.getPaymentCalendar.mockResolvedValue(calendar({
            hidden: [{ budget_item_id: 'b2', item_name: 'Netflix', item_type: 'expense', owner: 'shared' }],
        }));
        await user.click(screen.getByRole('button', { name: /Remove from calendar/ }));
        expect(apiService.setCalendarHidden).toHaveBeenCalledWith('b2', true);
        await waitFor(() => expect(screen.getByTestId('hidden-items')).toBeInTheDocument());
        await user.click(screen.getByText(/Removed from the calendar \(1\)/));
        await user.click(screen.getByRole('button', { name: 'Show again' }));
        expect(apiService.setCalendarHidden).toHaveBeenCalledWith('b2', false);
    });

    it('lists a childcare line with no day at its calculator amount, and drops it at £0', async () => {
        const nursery = { budget_item_id: 'c1', item_name: 'Ellis nursery', owner: 'shared', childcare_link: 'ellis_nursery', expected_amount: 0, payee_match: '' };
        const gaspard = { budget_item_id: 'c2', item_name: 'Gaspard childcare', owner: 'shared', childcare_link: 'gaspard_childcare', expected_amount: 0, payee_match: '' };
        apiService.getPaymentCalendar.mockResolvedValue(calendar({ unscheduled: [nursery, gaspard] }));
        render(<CalendarPage currentDate={NOV} childcareNets={{ ellis_nursery: 812.5, gaspard_childcare: 0 }} showToast={vi.fn()} />);
        const row = await screen.findByText('Ellis nursery');
        expect(within(row.closest('button')).getByText('£812.50')).toBeInTheDocument();
        expect(screen.queryByText('Gaspard childcare')).not.toBeInTheDocument();
    });
});
