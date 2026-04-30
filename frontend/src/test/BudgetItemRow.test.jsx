import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import BudgetItemRow from '../components/BudgetItemRow';

const makeItem = (overrides = {}) => ({
    budget_item_id: 'abc-123',
    item_name: 'Internet',
    item_type: 'expense',
    owner: 'shared',
    effective_value: '50.00',
    bills_pot: false,
    is_one_off: false,
    calculation_type: 'fixed',
    effective_from_month_name: 'January 2026',
    ...overrides,
});

const currentDate = new Date(2026, 0, 1); // January 2026

describe('BudgetItemRow', () => {
    const defaultProps = {
        item: makeItem(),
        onUpdate: vi.fn(),
        onEditCategory: vi.fn(),
        onDelete: vi.fn(),
        currentDate,
    };

    it('renders item name and value', () => {
        render(<BudgetItemRow {...defaultProps} />);
        expect(screen.getByText('Internet')).toBeInTheDocument();
        expect(screen.getByText('£50.00')).toBeInTheDocument();
    });

    it('shows owner badge by default', () => {
        render(<BudgetItemRow {...defaultProps} />);
        expect(screen.getByText('shared')).toBeInTheDocument();
    });

    it('hides owner badge when hideOwnerBadge is true', () => {
        render(<BudgetItemRow {...defaultProps} hideOwnerBadge={true} />);
        expect(screen.queryByText('shared')).not.toBeInTheDocument();
    });

    it('shows Bills Pot badge when flagged', () => {
        render(<BudgetItemRow {...defaultProps} item={makeItem({ bills_pot: true })} />);
        expect(screen.getByText('Bills Pot')).toBeInTheDocument();
    });

    it('shows One-off badge when flagged', () => {
        render(<BudgetItemRow {...defaultProps} item={makeItem({ is_one_off: true })} />);
        expect(screen.getByText('One-off')).toBeInTheDocument();
    });

    it('does not show Inherited badge (removed)', () => {
        render(<BudgetItemRow {...defaultProps} item={makeItem({ effective_from_month_name: 'December 2025' })} />);
        expect(screen.queryByText('Inherited')).not.toBeInTheDocument();
    });

    it('does not show Inherited badge when month matches', () => {
        render(<BudgetItemRow {...defaultProps} item={makeItem({ effective_from_month_name: 'January 2026' })} />);
        expect(screen.queryByText('Inherited')).not.toBeInTheDocument();
    });

    it('shows Locked label when editing is disabled', () => {
        render(<BudgetItemRow {...defaultProps} isEditingDisabled={true} />);
        expect(screen.getByText('Locked')).toBeInTheDocument();
    });

    it('shows weekly info for weekly_count items', () => {
        render(<BudgetItemRow {...defaultProps} item={makeItem({ calculation_type: 'weekly_count', weekly_payment_day: 1, occurrences: 4 })} />);
        expect(screen.getByText(/Weekly on Monday/)).toBeInTheDocument();
        expect(screen.getByText(/4 occurrences/)).toBeInTheDocument();
    });
});
