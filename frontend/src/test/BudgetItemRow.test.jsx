import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BudgetItemRow from '../components/BudgetItemRow';

const makeItem = (overrides = {}) => ({
    budget_item_id: 'abc-123',
    item_name: 'Internet',
    item_type: 'expense',
    owner: 'shared',
    effective_value: '50.00',
    expense_pot: '',
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
        render(<BudgetItemRow {...defaultProps} item={makeItem({ expense_pot: 'bills' })} />);
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

    it('shows Groceries Pot badge when expense_pot is groceries', () => {
        render(<BudgetItemRow {...defaultProps} item={makeItem({ expense_pot: 'groceries' })} />);
        expect(screen.getByText('Groceries Pot')).toBeInTheDocument();
    });

    it('shows Extra badge when item.is_extra is true', () => {
        render(<BudgetItemRow {...defaultProps} item={makeItem({ is_extra: true })} />);
        expect(screen.getByText('Extra')).toBeInTheDocument();
    });

    it('shows Tab Repayment badge when item.is_tab_repayment is true', () => {
        render(<BudgetItemRow {...defaultProps} item={makeItem({ is_tab_repayment: true, owner: 'keith' })} />);
        expect(screen.getByText('Tab Repayment')).toBeInTheDocument();
    });

    it('does not render any pot badge when expense_pot is empty', () => {
        render(<BudgetItemRow {...defaultProps} />);
        expect(screen.queryByText('Bills Pot')).not.toBeInTheDocument();
        expect(screen.queryByText('Groceries Pot')).not.toBeInTheDocument();
    });

    it('clicking the row calls onEditCategory when editable', async () => {
        const onEditCategory = vi.fn();
        const user = userEvent.setup();
        render(<BudgetItemRow {...defaultProps} onEditCategory={onEditCategory} />);
        await user.click(screen.getByText('Internet'));
        expect(onEditCategory).toHaveBeenCalledWith('abc-123');
    });

    it('clicking the row does not call onEditCategory when isEditingDisabled', async () => {
        const onEditCategory = vi.fn();
        const user = userEvent.setup();
        render(<BudgetItemRow {...defaultProps} onEditCategory={onEditCategory} isEditingDisabled={true} />);
        await user.click(screen.getByText('Internet'));
        expect(onEditCategory).not.toHaveBeenCalled();
    });

    it('clicking the row does not call onEditCategory for synthetic repayment items', async () => {
        const onEditCategory = vi.fn();
        const user = userEvent.setup();
        render(<BudgetItemRow {...defaultProps} item={makeItem({ budget_item_id: 'foo-repay-income' })} onEditCategory={onEditCategory} />);
        await user.click(screen.getByText('Internet'));
        expect(onEditCategory).not.toHaveBeenCalled();
    });
});
