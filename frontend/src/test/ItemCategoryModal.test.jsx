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
    is_one_off: false,
};

const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSave: vi.fn(),
    item: null,
};

const getSelect = (name) => document.querySelector(`select[name="${name}"]`);
const getCheckbox = (name) => document.querySelector(`input[type="checkbox"][name="${name}"]`);
const getCheckboxById = (id) => document.querySelector(`input[type="checkbox"]#${id}`);

describe('ItemCategoryModal', () => {
    describe('Type dropdown', () => {
        it('offers Expense, Income, and Savings', () => {
            render(<ItemCategoryModal {...defaultProps} />);
            const typeSelect = getSelect('item_type');
            const optionValues = Array.from(typeSelect.options).map(o => o.value);
            expect(optionValues).toEqual(['expense', 'income', 'savings']);
        });

        it('hides the Pot dropdown when type is income', async () => {
            render(<ItemCategoryModal {...defaultProps} />);
            const user = userEvent.setup();
            await user.selectOptions(getSelect('item_type'), 'income');
            expect(getSelect('expense_pot')).toBeNull();
        });

        it('hides the Pot dropdown when type is savings', async () => {
            render(<ItemCategoryModal {...defaultProps} />);
            const user = userEvent.setup();
            await user.selectOptions(getSelect('item_type'), 'savings');
            expect(getSelect('expense_pot')).toBeNull();
        });

        it('shows the Pot dropdown when type is expense', () => {
            render(<ItemCategoryModal {...defaultProps} />);
            expect(getSelect('expense_pot')).not.toBeNull();
        });
    });

    describe('Pot ↔ Extra interaction', () => {
        it('disables the Extra toggle when a pot is selected', async () => {
            render(<ItemCategoryModal {...defaultProps} item={{ ...baseItem, owner: 'shared' }} />);
            const user = userEvent.setup();
            // Extra toggle is visible for shared expenses with no pot
            expect(getCheckbox('is_extra')).not.toBeNull();
            expect(getCheckbox('is_extra').disabled).toBe(false);

            await user.selectOptions(getSelect('expense_pot'), 'bills');
            expect(getCheckbox('is_extra').disabled).toBe(true);
        });

        it('clears is_extra when a pot is selected', async () => {
            const onSave = vi.fn();
            render(<ItemCategoryModal {...defaultProps} onSave={onSave} item={{ ...baseItem, owner: 'shared', is_extra: true }} />);
            const user = userEvent.setup();
            expect(getCheckbox('is_extra').checked).toBe(true);
            await user.selectOptions(getSelect('expense_pot'), 'bills');
            expect(getCheckbox('is_extra').checked).toBe(false);
        });
    });

    describe('Tab Repayment ↔ Owner interaction', () => {
        it('disables the Tab Repayment toggle when owner is shared', () => {
            render(<ItemCategoryModal {...defaultProps} item={{ ...baseItem, owner: 'shared' }} />);
            expect(getCheckbox('is_tab_repayment').disabled).toBe(true);
        });

        it('enables the Tab Repayment toggle when owner is keith', () => {
            render(<ItemCategoryModal {...defaultProps} item={baseItem} />);
            expect(getCheckbox('is_tab_repayment').disabled).toBe(false);
        });

        it('removes Shared from the owner dropdown while tab repayment is checked', () => {
            render(<ItemCategoryModal {...defaultProps} item={{ ...baseItem, is_tab_repayment: true }} />);
            const ownerOptions = Array.from(getSelect('owner').options).map(o => o.value);
            expect(ownerOptions).toEqual(['keith', 'tild']);
        });

        it('auto-switches owner to keith when tab repayment is turned on while shared', async () => {
            render(<ItemCategoryModal {...defaultProps} item={{ ...baseItem, owner: 'tild' }} />);
            const user = userEvent.setup();
            // Switch to keith so we can verify auto-switch logic on the toggle
            await user.selectOptions(getSelect('owner'), 'keith');
            await user.click(getCheckbox('is_tab_repayment'));
            expect(getSelect('owner').value).toBe('keith');
            expect(getCheckbox('is_tab_repayment').checked).toBe(true);
        });
    });

    describe('Expires toggle', () => {
        it('does not show the date input by default for new items', () => {
            render(<ItemCategoryModal {...defaultProps} />);
            expect(document.querySelector('input[name="last_payment_month_id"]')).toBeNull();
        });

        it('reveals the date input when toggled on', async () => {
            render(<ItemCategoryModal {...defaultProps} />);
            const user = userEvent.setup();
            await user.click(getCheckboxById('has_expiry'));
            expect(document.querySelector('input[name="last_payment_month_id"]')).not.toBeNull();
        });

        it('hides and clears the date when toggled off', async () => {
            render(<ItemCategoryModal {...defaultProps} item={{ ...baseItem, last_payment_month_id: '2027-06' }} />);
            const user = userEvent.setup();
            // Pre-checked because item has expiry
            const toggle = getCheckboxById('has_expiry');
            expect(toggle.checked).toBe(true);
            const dateInput = document.querySelector('input[name="last_payment_month_id"]');
            expect(dateInput.value).toBe('2027-06');

            await user.click(toggle);
            expect(document.querySelector('input[name="last_payment_month_id"]')).toBeNull();
        });

        it('pre-checks Expires when editing an item with last_payment_month_id', () => {
            render(<ItemCategoryModal {...defaultProps} item={{ ...baseItem, last_payment_month_id: '2027-06' }} />);
            expect(getCheckboxById('has_expiry').checked).toBe(true);
        });
    });

    describe('Submission', () => {
        it('passes formData to onSave when creating a new item', async () => {
            const onSave = vi.fn();
            render(<ItemCategoryModal {...defaultProps} onSave={onSave} />);
            const user = userEvent.setup();
            await user.type(document.querySelector('input[name="item_name"]'), 'Hosting');
            await user.type(document.querySelector('input[name="value"]'), '12.50');
            await user.click(screen.getByRole('button', { name: /create item/i }));
            expect(onSave).toHaveBeenCalledTimes(1);
            const [, payload] = onSave.mock.calls[0];
            expect(payload.item_name).toBe('Hosting');
            expect(payload.value).toBe(12.5);
            expect(payload.item_type).toBe('expense');
        });

        it('clears flags when type changes to non-expense', async () => {
            const onSave = vi.fn();
            render(<ItemCategoryModal {...defaultProps} onSave={onSave} item={{ ...baseItem, owner: 'shared', is_extra: true, expense_pot: 'bills' }} />);
            const user = userEvent.setup();
            await user.selectOptions(getSelect('item_type'), 'savings');
            await user.click(screen.getByRole('button', { name: /save changes/i }));
            const [, payload] = onSave.mock.calls[0];
            expect(payload.item_type).toBe('savings');
            expect(payload.expense_pot).toBe('');
            expect(payload.is_extra).toBe(false);
            expect(payload.is_tab_repayment).toBe(false);
        });
    });
});
