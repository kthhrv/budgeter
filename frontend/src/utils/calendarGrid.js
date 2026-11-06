// Month grid for the payments calendar: Monday-first weeks of ISO dates,
// padded with nulls before the 1st and after the last day.

const iso = (y, m0, d) => `${y}-${String(m0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export function monthWeeks(year, monthIdx) {
    const days = new Date(year, monthIdx + 1, 0).getDate();
    const lead = (new Date(year, monthIdx, 1).getDay() + 6) % 7; // Mon = 0
    const cells = [...Array(lead).fill(null)];
    for (let d = 1; d <= days; d++) cells.push(iso(year, monthIdx, d));
    while (cells.length % 7) cells.push(null);
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
}

export const todayIso = (now = new Date()) => iso(now.getFullYear(), now.getMonth(), now.getDate());

// Group calendar entries by the date the money actually leaves (due_date).
export function entriesByDay(entries) {
    const out = {};
    for (const e of entries) (out[e.due_date] ||= []).push(e);
    return out;
}

// Substitute client-side childcare figures, as the Budget tab does
// (applyChildcareLinks) — the backend only knows the stored value.
export function withChildcareAmounts(entries, nets) {
    if (!nets) return entries;
    return entries.map(e => (e.childcare_link && nets[e.childcare_link] != null
        ? { ...e, expected_amount: nets[e.childcare_link] }
        : e));
}

export const ordinal = (n) => {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

export const METHOD_LABELS = { direct_debit: 'Direct Debit', bacs_credit: 'Bacs payment in', standing_order: 'Standing order', card: 'Card', other: 'Transfer' };

const WEEKDAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// "usually the 12th" / "weekly on Monday" for a recurring-payee suggestion.
export const cadenceText = (s) => (s.cadence === 'weekly'
    ? `weekly on ${WEEKDAY_NAMES[s.usual_weekday] || '?'}`
    : `usually the ${ordinal(s.usual_day)}`);

// What's still to go out this month: unticked outgoing entries on the
// calendar that `include` picks, plus those with no known day yet.
export function leftToPay(entries, unscheduled, include = () => true) {
    // `items` lists what's counted, by due date (undated last).
    const isDue = (e) => e.item_type !== 'income' && include(e);
    const datedItems = entries.filter(e => isDue(e) && !e.payment);
    const undatedItems = unscheduled.filter(isDue);
    const sum = (list) => list.reduce((t, e) => t + e.expected_amount, 0);
    const undated = sum(undatedItems);
    const items = [...datedItems, ...undatedItems].map(e => ({
        key: `${e.budget_item_id}-${e.due_date || 'none'}`, name: e.item_name, amount: e.expected_amount, due: e.due_date || null,
    }));
    return { total: sum(datedItems) + undated, undated, items };
}

// What's still to leave the bills pot this month.
export function billsLeftToPay(entries, unscheduled) {
    return leftToPay(entries, unscheduled, e => e.expense_pot === 'bills');
}
