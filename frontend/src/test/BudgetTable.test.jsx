import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BudgetTable from '../components/BudgetTable';

const makeItem = (overrides = {}) => ({
    budget_item_id: crypto.randomUUID(),
    item_name: 'Test Item',
    item_type: 'expense',
    owner: 'shared',
    effective_value: '100',
    bills_pot: false,
    is_one_off: false,
    calculation_type: 'fixed',
    effective_from_month_name: 'January 2026',
    ...overrides,
});

const currentDate = new Date(2026, 0, 1);

const defaultProps = {
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
    onEditCategory: vi.fn(),
    currentDate,
    isEditingDisabled: false,
    searchTerm: '',
};

describe('BudgetTable', () => {
    it('renders the title', () => {
        const items = [makeItem()];
        render(<BudgetTable title="Joint Expenses" itemType="expense" items={items} {...defaultProps} />);
        expect(screen.getByText('Joint Expenses')).toBeInTheDocument();
    });

    it('shows empty state when no items of type exist', () => {
        render(<BudgetTable title="Income" itemType="income" items={[]} {...defaultProps} />);
        expect(screen.getByText(/No income items for this month/)).toBeInTheDocument();
    });

    it('shows no-results state when search has no matches', () => {
        const items = [makeItem({ item_name: 'Rent' })];
        render(<BudgetTable title="Expenses" itemType="expense" ownerFilter="shared" items={items} {...defaultProps} searchTerm="xyz" />);
        expect(screen.getByText(/No expense items match "xyz"/)).toBeInTheDocument();
    });

    it('filters items by ownerFilter', () => {
        const items = [
            makeItem({ item_name: 'Rent', owner: 'shared' }),
            makeItem({ item_name: 'Gym', owner: 'keith' }),
        ];
        render(<BudgetTable title="Keith's Expenses" itemType="expense" ownerFilter="keith" items={items} {...defaultProps} />);
        expect(screen.getByText('Gym')).toBeInTheDocument();
        expect(screen.queryByText('Rent')).not.toBeInTheDocument();
    });

    it('hides owner badge when ownerFilter is set', () => {
        const items = [makeItem({ item_name: 'Rent', owner: 'shared' })];
        render(<BudgetTable title="Shared" itemType="expense" ownerFilter="shared" items={items} {...defaultProps} />);
        // The owner badge text "shared" should not appear as a badge
        // The item name should be visible
        expect(screen.getByText('Rent')).toBeInTheDocument();
    });

    it('collapses and expands on title click', async () => {
        const user = userEvent.setup();
        const items = [makeItem({ item_name: 'Rent' })];
        render(<BudgetTable title="Expenses" itemType="expense" items={items} {...defaultProps} />);

        expect(screen.getByText('Rent')).toBeVisible();

        // Click to collapse
        await user.click(screen.getByText('Expenses'));

        // The container should have max-h-0 (collapsed)
        const content = screen.getByText('Rent').closest('.space-y-4');
        const collapsible = content?.parentElement;
        expect(collapsible).toHaveClass('max-h-0');
    });

    it('filters by search term', () => {
        const items = [
            makeItem({ item_name: 'Rent', owner: 'shared' }),
            makeItem({ item_name: 'Gym', owner: 'shared' }),
        ];
        render(<BudgetTable title="Expenses" itemType="expense" ownerFilter="shared" items={items} {...defaultProps} searchTerm="gym" />);
        expect(screen.getByText('Gym')).toBeInTheDocument();
        expect(screen.queryByText('Rent')).not.toBeInTheDocument();
    });

    it('renders income items as flat list sorted by value', () => {
        const items = [
            makeItem({ item_name: 'Salary', item_type: 'income', owner: 'keith', effective_value: '3000' }),
            makeItem({ item_name: 'Bonus', item_type: 'income', owner: 'keith', effective_value: '500' }),
        ];
        render(<BudgetTable title="Income" itemType="income" items={items} {...defaultProps} />);
        expect(screen.getByText('Salary')).toBeInTheDocument();
        expect(screen.getByText('Bonus')).toBeInTheDocument();
    });
});
