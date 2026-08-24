import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OwnerCard from '../components/OwnerCard';

const makeItem = (overrides = {}) => ({
    budget_item_id: `id-${Math.random()}`,
    item_name: 'Item',
    item_type: 'expense',
    owner: 'shared',
    effective_value: '10.00',
    expense_pot: '',
    category: '',
    is_one_off: false,
    calculation_type: 'fixed',
    effective_from_month_name: 'January 2026',
    ...overrides,
});

const config = {
    key: 'shared', name: 'Joint', accent: 'joint', sub: 'Shared account',
    remainingLabel: 'Left over', remaining: 100, contributions: 0, billsPot: 0,
};

const defaultProps = {
    config,
    onEditCategory: vi.fn(),
    onDelete: vi.fn(),
    currentDate: new Date(2026, 0, 1),
};

const items = [
    makeItem({ budget_item_id: 'mortgage', item_name: 'Mortgage', category: 'house', effective_value: '900.00' }),
    makeItem({ budget_item_id: 'water', item_name: 'Water', category: 'house', effective_value: '40.00' }),
    makeItem({ budget_item_id: 'netflix', item_name: 'Netflix', category: 'subscriptions', effective_value: '15.00' }),
    makeItem({ budget_item_id: 'misc', item_name: 'Miscellaneous', effective_value: '25.00' }),
];

describe('OwnerCard category grouping', () => {
    it('renders category groups collapsed by default, with items hidden', () => {
        render(<OwnerCard {...defaultProps} items={items} />);
        expect(screen.getByText('House')).toBeInTheDocument();
        expect(screen.getByText('Subscriptions')).toBeInTheDocument();
        expect(screen.queryByText('Mortgage')).not.toBeInTheDocument();
        expect(screen.queryByText('Netflix')).not.toBeInTheDocument();
    });

    it('omits categories with no items', () => {
        render(<OwnerCard {...defaultProps} items={items} />);
        expect(screen.queryByText('Car')).not.toBeInTheDocument();
        expect(screen.queryByText('Groceries')).not.toBeInTheDocument();
    });

    it('shows the category subtotal on the collapsed header', () => {
        render(<OwnerCard {...defaultProps} items={items} />);
        // House = 900 + 40
        expect(screen.getByText('£940.00')).toBeInTheDocument();
    });

    it('expands a group on click to reveal its items, and collapses it again', async () => {
        const user = userEvent.setup();
        render(<OwnerCard {...defaultProps} items={items} />);
        await user.click(screen.getByText('House'));
        expect(screen.getByText('Mortgage')).toBeInTheDocument();
        expect(screen.getByText('Water')).toBeInTheDocument();
        expect(screen.queryByText('Netflix')).not.toBeInTheDocument();
        await user.click(screen.getByText('House'));
        expect(screen.queryByText('Mortgage')).not.toBeInTheDocument();
    });

    it('lists uncategorised expenses flat below the groups', () => {
        render(<OwnerCard {...defaultProps} items={items} />);
        expect(screen.getByText('Miscellaneous')).toBeInTheDocument();
    });

    it('opens all groups while searching so matches are visible', () => {
        render(<OwnerCard {...defaultProps} items={items} searchTerm="mortgage" />);
        expect(screen.getByText('Mortgage')).toBeInTheDocument();
    });

    it('does not group income or savings items', () => {
        const mixed = [
            makeItem({ budget_item_id: 'salary', item_name: 'Salary', item_type: 'income', category: 'house', effective_value: '2000.00' }),
        ];
        render(<OwnerCard {...defaultProps} items={mixed} />);
        // Income renders flat even if a category is somehow set.
        expect(screen.getByText('Salary')).toBeInTheDocument();
    });
});
