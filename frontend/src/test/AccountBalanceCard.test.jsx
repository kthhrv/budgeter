import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import AccountBalanceCard from '../components/AccountBalanceCard';
import apiService from '../services/api';
import { leftToPay } from '../utils/calendarGrid';

vi.mock('../services/api', () => ({
    default: { getPersonalBalance: vi.fn() },
}));

const entries = [
    { item_type: 'expense', expected_amount: 30, payment: null },
    { item_type: 'expense', expected_amount: 99, payment: { id: 1 } },
    { item_type: 'income', expected_amount: 2000, payment: null },
];
const unscheduled = [{ item_type: 'expense', expected_amount: 20 }];

describe('leftToPay', () => {
    it('sums unticked outgoing items, dated and undated', () => {
        expect(leftToPay(entries, unscheduled)).toMatchObject({ total: 50, undated: 20 });
    });
});

describe('AccountBalanceCard', () => {
    beforeEach(() => vi.clearAllMocks());

    it('weighs the person’s own account against their left to pay', async () => {
        apiService.getPersonalBalance.mockResolvedValue({ account: { name: 'Current account', balance: 40 }, error: null });
        render(<AccountBalanceCard owner="tild" entries={entries} unscheduled={unscheduled} showToast={vi.fn()} />);
        expect(await screen.findByText('Tild’s account')).toBeInTheDocument();
        expect(apiService.getPersonalBalance).toHaveBeenCalledWith('tild');
        expect(screen.getByText('Short by')).toBeInTheDocument();
        expect(screen.getByText('£10.00')).toBeInTheDocument();
    });

    it('explains when that person has not connected Monzo', async () => {
        apiService.getPersonalBalance.mockResolvedValue({ account: null, error: null });
        render(<AccountBalanceCard owner="keith" entries={entries} unscheduled={unscheduled} showToast={vi.fn()} />);
        expect(await screen.findByText(/once Keith connects Monzo/)).toBeInTheDocument();
    });
});
