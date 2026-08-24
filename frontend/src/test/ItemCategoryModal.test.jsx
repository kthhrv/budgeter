import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ItemCategoryModal from '../components/ItemCategoryModal';

const baseItem = {
    budget_item_id: 'abc',
    item_name: 'Netflix',
    item_type: 'expense',
    owner: 'keith',
    expense_pot: '',
    is_tab_repayment: false,
    is_extra: false,
    calculation_type: 'fixed',
    weekly_payment_day: null,
    last_payment_month_id: '',
    value: '15.00',
    effective_value: 15,
    effective_from_month_name: 'January 2026',
    is_one_off: false,
};

const defaultProps = { isOpen: true, onClose: vi.fn(), onSave: vi.fn(), onDelete: vi.fn(), item: null };

const getSelect = (name) => document.querySelector(`select[name="${name}"]`);
const getCheckbox = (name) => document.querySelector(`input[type="checkbox"][name="${name}"]`);
const btn = (name) => screen.queryByRole('button', { name });
// Open the Advanced section (no-op if the target control is already present).
const openAdvanced = async (user) => {
    const b = screen.queryByRole('button', { name: /Advanced options/i });
    if (b) await user.click(b);
};

describe('ItemCategoryModal', () => {
    describe('Type', () => {
        it('offers Expense, Income, and Savings', () => {
            render(<ItemCategoryModal {...defaultProps} />);
            ['Expense', 'Income', 'Savings'].forEach(t => expect(btn(t)).toBeInTheDocument());
        });

        it('hides the Pot control when type is income', async () => {
            const user = userEvent.setup();
            render(<ItemCategoryModal {...defaultProps} />);
            await openAdvanced(user);
            expect(btn('Bills')).toBeInTheDocument();       // pot visible for expense
            await user.click(btn('Income'));
            expect(btn('Bills')).not.toBeInTheDocument();    // advanced/pot gone for income
        });

        it('shows the Pot control when type is expense', async () => {
            const user = userEvent.setup();
            render(<ItemCategoryModal {...defaultProps} />);
            await openAdvanced(user);
            expect(btn('Bills')).toBeInTheDocument();
        });
    });

    describe('Category', () => {
        it('shows the Category select for expenses and includes it in the payload', async () => {
            const onSave = vi.fn();
            const user = userEvent.setup();
            render(<ItemCategoryModal {...defaultProps} onSave={onSave} item={baseItem} />);
            await user.selectOptions(getSelect('category'), 'subscriptions');
            await user.click(btn('Save'));
            const [, payload] = onSave.mock.calls[0];
            expect(payload.category).toBe('subscriptions');
        });

        it('hides and clears the category when type is not expense', async () => {
            const onSave = vi.fn();
            const user = userEvent.setup();
            render(<ItemCategoryModal {...defaultProps} onSave={onSave} item={{ ...baseItem, category: 'house' }} />);
            expect(getSelect('category').value).toBe('house');
            await user.click(btn('Savings'));
            expect(getSelect('category')).toBeNull();
            await user.click(btn('Save'));
            const [, payload] = onSave.mock.calls[0];
            expect(payload.category).toBe('');
        });
    });

    describe('Pot ↔ Extra interaction', () => {
        it('hides and clears Extra when a pot is selected', async () => {
            const onSave = vi.fn();
            const user = userEvent.setup();
            render(<ItemCategoryModal {...defaultProps} onSave={onSave} item={{ ...baseItem, owner: 'shared' }} />);
            await openAdvanced(user);
            // Extra visible for a shared expense with no pot; turn it on.
            await user.click(getCheckbox('is_extra'));
            expect(getCheckbox('is_extra').checked).toBe(true);
            // Selecting a pot hides Extra...
            await user.click(btn('Bills'));
            expect(getCheckbox('is_extra')).toBeNull();
            // ...and clears it in the saved payload.
            await user.click(btn('Save'));
            const [, payload] = onSave.mock.calls[0];
            expect(payload.expense_pot).toBe('bills');
            expect(payload.is_extra).toBe(false);
        });
    });

    describe('Tab Repayment ↔ Owner interaction', () => {
        it('auto-assigns to Keith when tab repayment is turned on while Joint', async () => {
            const onSave = vi.fn();
            const user = userEvent.setup();
            render(<ItemCategoryModal {...defaultProps} onSave={onSave} item={{ ...baseItem, owner: 'shared' }} />);
            await openAdvanced(user);
            await user.click(getCheckbox('is_tab_repayment'));
            // Joint is removed from the owner choices once tab repayment is on.
            expect(btn('Joint')).not.toBeInTheDocument();
            await user.click(btn('Save'));
            const [, payload] = onSave.mock.calls[0];
            expect(payload.owner).toBe('keith');
            expect(payload.is_tab_repayment).toBe(true);
        });
    });

    describe('Expires', () => {
        it('reveals the date input when toggled on', async () => {
            const user = userEvent.setup();
            render(<ItemCategoryModal {...defaultProps} />);
            await openAdvanced(user);
            expect(document.querySelector('input[name="last_payment_month_id"]')).toBeNull();
            await user.click(getCheckbox('has_expiry'));
            expect(document.querySelector('input[name="last_payment_month_id"]')).not.toBeNull();
        });

        it('pre-checks Expires (and opens Advanced) when editing an item with an expiry', () => {
            render(<ItemCategoryModal {...defaultProps} item={{ ...baseItem, last_payment_month_id: '2027-06' }} />);
            expect(getCheckbox('has_expiry').checked).toBe(true);
            expect(document.querySelector('input[name="last_payment_month_id"]').value).toBe('2027-06');
        });
    });

    describe('Nursery linking', () => {
        it('shows the childcare-link select with Ellis + Gaspard targets, and reflects an existing link', () => {
            render(<ItemCategoryModal {...defaultProps} item={{ ...baseItem, childcare_link: 'gaspard_care' }} />);
            const select = getSelect('childcare_link'); // Advanced auto-opens because a link is set
            expect(select).not.toBeNull();
            expect(Array.from(select.options).map(o => o.value)).toEqual(['', 'ellis_nursery', 'gaspard_care', 'gaspard_holiday']);
            expect(select.value).toBe('gaspard_care');
        });
    });

    describe('Apply to (one-off)', () => {
        it('is hidden for new items', () => {
            render(<ItemCategoryModal {...defaultProps} />);
            expect(btn('Just this month')).not.toBeInTheDocument();
        });

        it('is shown for existing items with current-value context', () => {
            render(<ItemCategoryModal {...defaultProps} item={baseItem} />);
            expect(btn('From this month on')).toBeInTheDocument();
            expect(btn('Just this month')).toBeInTheDocument();
            expect(screen.getByText(/set January 2026/)).toBeInTheDocument();
        });
    });

    describe('Weekly preview', () => {
        it('shows a live monthly estimate for weekly items', async () => {
            const user = userEvent.setup();
            render(<ItemCategoryModal {...defaultProps} currentDate={new Date(2026, 0, 1)} />);
            await user.click(btn('Weekly'));
            await user.selectOptions(getSelect('weekly_payment_day'), '1'); // Monday
            await user.type(document.querySelector('input[name="value"]'), '10');
            expect(screen.getByText(/in January 2026/)).toBeInTheDocument();
        });
    });

    describe('Submission & validation', () => {
        it('passes formData to onSave when creating a new item', async () => {
            const onSave = vi.fn();
            const user = userEvent.setup();
            render(<ItemCategoryModal {...defaultProps} onSave={onSave} />);
            await user.type(document.querySelector('input[name="item_name"]'), 'Hosting');
            await user.type(document.querySelector('input[name="value"]'), '12.50');
            await user.click(btn('Create'));
            expect(onSave).toHaveBeenCalledTimes(1);
            const [, payload] = onSave.mock.calls[0];
            expect(payload.item_name).toBe('Hosting');
            expect(payload.value).toBe(12.5);
            expect(payload.item_type).toBe('expense');
        });

        it('blocks submit and shows an error when name or amount is missing', async () => {
            const onSave = vi.fn();
            const user = userEvent.setup();
            render(<ItemCategoryModal {...defaultProps} onSave={onSave} />);
            await user.click(btn('Create'));
            expect(onSave).not.toHaveBeenCalled();
            expect(screen.getByText('Give it a name.')).toBeInTheDocument();
            expect(screen.getByText('Enter an amount.')).toBeInTheDocument();
        });

        it('clears expense flags when type changes to non-expense', async () => {
            const onSave = vi.fn();
            const user = userEvent.setup();
            render(<ItemCategoryModal {...defaultProps} onSave={onSave} item={{ ...baseItem, owner: 'shared', is_extra: true, expense_pot: 'bills' }} />);
            await user.click(btn('Savings'));
            await user.click(btn('Save'));
            const [, payload] = onSave.mock.calls[0];
            expect(payload.item_type).toBe('savings');
            expect(payload.expense_pot).toBe('');
            expect(payload.is_extra).toBe(false);
            expect(payload.is_tab_repayment).toBe(false);
        });

        it('calls onDelete after confirming delete', async () => {
            const onDelete = vi.fn();
            const onClose = vi.fn();
            const user = userEvent.setup();
            render(<ItemCategoryModal {...defaultProps} onDelete={onDelete} onClose={onClose} item={baseItem} />);
            await user.click(screen.getByRole('button', { name: 'Delete item' }));
            await user.click(screen.getByRole('button', { name: 'Delete' })); // confirm
            expect(onDelete).toHaveBeenCalledWith('abc');
        });
    });
});
