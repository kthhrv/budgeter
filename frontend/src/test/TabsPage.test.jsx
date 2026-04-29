import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TabsPage from '../components/TabsPage';

const mockData = {
    items: [
        { id: '1', description: 'Holiday', paid_by: 'tild', total_cost: 1000, amount_owed: 500, date_added: '2025-06-01' },
        { id: '2', description: 'Dinner', paid_by: 'tild', total_cost: 200, amount_owed: 100, date_added: '2025-07-01' },
        { id: '3', description: 'Frame TV', paid_by: 'keith', total_cost: 700, amount_owed: 350, date_added: '2025-08-01' },
    ],
    repayments: [
        { id: 'r1', amount: 200, paid_by: 'keith', date: '2025-07-01', note: 'Bank transfer' },
    ],
    total_owed_to_keith: 350,
    total_owed_to_tild: 600,
    total_repaid_by_keith: 200,
    total_repaid_by_tild: 0,
    net_balance: 50,
    net_description: 'Keith owes Tild £50.00',
};

vi.mock('../services/api', () => ({
    default: {
        getTabs: vi.fn(),
        createTabItem: vi.fn(),
        deleteTabItem: vi.fn(),
        createTabRepayment: vi.fn(),
        deleteTabRepayment: vi.fn(),
    },
}));

import apiService from '../services/api';

const showToast = vi.fn();

beforeEach(() => {
    vi.clearAllMocks();
    apiService.getTabs.mockResolvedValue(mockData);
});

describe('TabsPage', () => {
    it('renders balance summary', async () => {
        render(<TabsPage showToast={showToast} />);
        await waitFor(() => {
            expect(screen.getByText('Keith owes Tild £50.00')).toBeInTheDocument();
        });
    });

    it('renders all items', async () => {
        render(<TabsPage showToast={showToast} />);
        await waitFor(() => {
            expect(screen.getByText('Holiday')).toBeInTheDocument();
            expect(screen.getByText('Dinner')).toBeInTheDocument();
            expect(screen.getByText('Frame TV')).toBeInTheDocument();
        });
    });

    it('renders repayments', async () => {
        render(<TabsPage showToast={showToast} />);
        await waitFor(() => {
            expect(screen.getByText('£200.00')).toBeInTheDocument();
            expect(screen.getByText(/Bank transfer/)).toBeInTheDocument();
        });
    });

    it('shows paid_by badges', async () => {
        render(<TabsPage showToast={showToast} />);
        await waitFor(() => {
            const tildBadges = screen.getAllByText('tild');
            expect(tildBadges.length).toBe(2); // Holiday + Dinner
            expect(screen.getAllByText('keith').length).toBeGreaterThanOrEqual(2); // Frame TV + repayment
        });
    });

    it('crosses off items covered by net balance', async () => {
        // net > 0 (Keith owes Tild): Frame TV (keith's item, £350) should be auto-crossed off
        render(<TabsPage showToast={showToast} />);
        await waitFor(() => {
            const frameTv = screen.getByText('Frame TV');
            expect(frameTv.className).toContain('line-through');
        });
    });

    it('does not cross off items not yet covered', async () => {
        render(<TabsPage showToast={showToast} />);
        await waitFor(() => {
            const dinner = screen.getByText('Dinner');
            expect(dinner.className).not.toContain('line-through');
        });
    });

    it('crosses off tild items covered by repayments oldest first', async () => {
        // Keith repaid 200 + Frame TV offset 350 = 550 pool for tild items
        // Holiday (500) should be crossed off, Dinner (100) should NOT (550 - 500 = 50 < 100)
        render(<TabsPage showToast={showToast} />);
        await waitFor(() => {
            const holiday = screen.getByText('Holiday');
            expect(holiday.className).toContain('line-through');
        });
    });

    it('shows empty states', async () => {
        apiService.getTabs.mockResolvedValue({
            ...mockData,
            items: [],
            repayments: [],
            net_balance: 0,
            net_description: 'All settled up!',
        });
        render(<TabsPage showToast={showToast} />);
        await waitFor(() => {
            expect(screen.getByText('All settled up!')).toBeInTheDocument();
            expect(screen.getByText('No expenses yet')).toBeInTheDocument();
            expect(screen.getByText('No repayments yet')).toBeInTheDocument();
        });
    });

    it('shows loading spinner initially', () => {
        apiService.getTabs.mockReturnValue(new Promise(() => {})); // never resolves
        render(<TabsPage showToast={showToast} />);
        expect(document.querySelector('.animate-spin')).toBeInTheDocument();
    });

    it('opens item form on + click', async () => {
        const user = userEvent.setup();
        render(<TabsPage showToast={showToast} />);
        await waitFor(() => screen.getByText('Expenses'));
        const buttons = screen.getAllByRole('button');
        // First + button is for Expenses
        const addItemBtn = buttons.find(b => b.closest('.bg-white')?.textContent.includes('Expenses') && b.querySelector('svg'));
        await user.click(addItemBtn);
        expect(screen.getByPlaceholderText('Description')).toBeInTheDocument();
    });

    it('all settled marks everything crossed off', async () => {
        apiService.getTabs.mockResolvedValue({
            items: [
                { id: '1', description: 'A', paid_by: 'tild', total_cost: 200, amount_owed: 100, date_added: '2025-06-01' },
                { id: '2', description: 'B', paid_by: 'keith', total_cost: 200, amount_owed: 100, date_added: '2025-06-01' },
            ],
            repayments: [],
            total_owed_to_keith: 100,
            total_owed_to_tild: 100,
            total_repaid_by_keith: 0,
            total_repaid_by_tild: 0,
            net_balance: 0,
            net_description: 'All settled up!',
        });
        render(<TabsPage showToast={showToast} />);
        await waitFor(() => {
            expect(screen.getByText('A').className).toContain('line-through');
            expect(screen.getByText('B').className).toContain('line-through');
        });
    });
});
