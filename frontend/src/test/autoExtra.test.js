import { describe, it, expect } from 'vitest';
import { applyAutoExtra } from '../utils/autoExtra';

const makeItem = (overrides = {}) => ({
    budget_item_id: overrides.budget_item_id || 'id',
    item_name: overrides.item_name || 'X',
    item_type: overrides.item_type || 'expense',
    owner: overrides.owner || 'shared',
    is_extra: false,
    is_auto_extra: false,
    is_one_off: false,
    effective_from_month_name: 'June 2026',
    value: '0',
    effective_value: '0',
    ...overrides,
});

describe('applyAutoExtra', () => {
    it('is a no-op when no auto-extra item exists', () => {
        const items = [makeItem({ item_name: 'Rent', effective_value: '1000' })];
        expect(applyAutoExtra(items, 'June 2026')).toEqual(items);
    });

    it('substitutes effective_value to land joint Remaining at the target', () => {
        // No shared income, no other extras → effective_value = target.
        const items = [
            makeItem({ item_name: 'Rent', effective_value: '1000' }),
            makeItem({
                item_name: 'Extra', is_extra: true, is_auto_extra: true,
                value: '500', effective_value: '0',
            }),
        ];
        const out = applyAutoExtra(items, 'June 2026');
        const auto = out.find(i => i.is_auto_extra);
        expect(auto.effective_value).toBe(500);
    });

    it('subtracts shared income from the target so joint Remaining = target', () => {
        const items = [
            makeItem({ item_name: 'Joint income', item_type: 'income', effective_value: '120' }),
            makeItem({
                item_name: 'Extra', is_extra: true, is_auto_extra: true,
                value: '500', effective_value: '0',
            }),
        ];
        const out = applyAutoExtra(items, 'June 2026');
        const auto = out.find(i => i.is_auto_extra);
        expect(auto.effective_value).toBe(380);
    });

    it('subtracts other extras from the target', () => {
        const items = [
            makeItem({ item_name: 'Holiday', is_extra: true, effective_value: '150' }),
            makeItem({
                item_name: 'Extra', is_extra: true, is_auto_extra: true,
                value: '500', effective_value: '0',
            }),
        ];
        const out = applyAutoExtra(items, 'June 2026');
        const auto = out.find(i => i.is_auto_extra);
        expect(auto.effective_value).toBe(350);
    });

    it('clamps to zero when shared income exceeds the target', () => {
        const items = [
            makeItem({ item_name: 'Joint income', item_type: 'income', effective_value: '1000' }),
            makeItem({
                item_name: 'Extra', is_extra: true, is_auto_extra: true,
                value: '500', effective_value: '0',
            }),
        ];
        const out = applyAutoExtra(items, 'June 2026');
        const auto = out.find(i => i.is_auto_extra);
        expect(auto.effective_value).toBe(0);
    });

    it('respects a one-off override pinned to the current month', () => {
        const items = [
            makeItem({
                item_name: 'Extra', is_extra: true, is_auto_extra: true,
                is_one_off: true, effective_from_month_name: 'June 2026',
                value: '500', effective_value: '999',
            }),
        ];
        const out = applyAutoExtra(items, 'June 2026');
        const auto = out.find(i => i.is_auto_extra);
        expect(auto.effective_value).toBe('999'); // untouched
    });

    it('still substitutes when a one-off is pinned to a different month', () => {
        const items = [
            makeItem({
                item_name: 'Extra', is_extra: true, is_auto_extra: true,
                is_one_off: true, effective_from_month_name: 'May 2026',
                value: '500', effective_value: '0',
            }),
        ];
        const out = applyAutoExtra(items, 'June 2026');
        const auto = out.find(i => i.is_auto_extra);
        expect(auto.effective_value).toBe(500);
    });
});
