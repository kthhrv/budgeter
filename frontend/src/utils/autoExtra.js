// Substitute effective_value on the auto-balance Extra item so the joint
// Remaining stays at the item's stored target (its `value`).
// Mirrors the applyNurseryLink convention: a one-off pinned to the displayed
// month is treated as a manual override and skipped.
//
// Joint Remaining = sharedIncome + extraTotal (extras are funded by
// contributions but excluded from the Joint Expenses total). So to land
// at `target`, the auto-extra item must equal: target − sharedIncome − other_extras.
// Clamped at 0 so the buffer never goes negative.
export function applyAutoExtra(items, currentMonthName) {
    const autoIdx = items.findIndex(i => i.is_auto_extra);
    if (autoIdx === -1) return items;
    const auto = items[autoIdx];
    const overriddenForMonth = auto.is_one_off === true
        && auto.effective_from_month_name === currentMonthName;
    if (overriddenForMonth) return items;

    const target = parseFloat(auto.value) || 0;
    const num = (v) => parseFloat(v) || 0;
    const sharedIncome = items
        .filter(i => i.item_type === 'income' && i.owner === 'shared')
        .reduce((s, i) => s + num(i.effective_value), 0);
    const otherExtras = items
        .filter(i => i.is_extra && !i.is_auto_extra)
        .reduce((s, i) => s + num(i.effective_value), 0);

    const computed = Math.max(0, target - sharedIncome - otherExtras);
    return items.map((i, idx) => idx === autoIdx ? { ...i, effective_value: computed } : i);
}
