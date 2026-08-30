// FIRE (Financial Independence / Retire Early) calculations.
//
// Everything works in TODAY'S MONEY: the expected return is a real
// (after-inflation) rate, so projected values and the FI number are directly
// comparable to current spending. Phase 1 models a single blended real return
// with pension and accessible wealth tracked as separate streams; the
// two-phase pension-bridge test, tax/NI and state pension land in phase 2.

// Normal minimum pension age. 55 today, legislated to rise to 57 in April
// 2028 (Finance Act 2021 s.10); an expected rise to 58 alongside state
// pension age 68 is not yet legislated. Phase 1 shows this for context only.
export const PENSION_ACCESS_AGE = 57;

const toNumber = (v) => parseFloat(v) || 0;

// --- Earnings ---

/** The earnings version in force for `owner` on `date` (the newest one whose
 *  effective_from is on or before it), or null. Mirrors the backend's
 *  BudgetItemVersion roll-forward: a change is a new row, older rows stay. */
export const effectiveEarnings = (earningsVersions, owner, date) => {
    const dateIso = date instanceof Date ? date.toISOString().slice(0, 10) : date;
    const candidates = earningsVersions
        .filter(e => e.owner === owner && e.effective_from <= dateIso)
        .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
    return candidates[0] || null;
};

/** Combined employee + employer pension contribution per month, £. */
export const monthlyPensionContribution = (earnings) => {
    if (!earnings) return 0;
    const pct = toNumber(earnings.employee_pension_pct) + toNumber(earnings.employer_pension_pct);
    return (toNumber(earnings.gross_annual_salary) * pct / 100) / 12;
};

// --- Accounts & net worth ---

/** Latest snapshot of an account (API returns snapshots newest-first), or null. */
export const latestBalance = (account) => account.snapshots?.[0] || null;

export const ACCESSIBLE_KINDS = ['isa', 'cash', 'gia'];

const accountsForView = (accounts, view) =>
    view === 'joint' ? accounts : accounts.filter(a => a.owner === view || a.owner === 'shared');

/** Current pension / accessible / total wealth for a view ('keith'|'tild'|'joint').
 *  Shared accounts count in full for every view — both per-person views see the
 *  whole shared pot, so the two per-person totals don't sum to the joint total. */
export const currentWealth = (accounts, view) => {
    let pension = 0, accessible = 0;
    for (const account of accountsForView(accounts, view)) {
        const snap = latestBalance(account);
        if (!snap) continue;
        if (account.kind === 'pension') pension += toNumber(snap.balance);
        else accessible += toNumber(snap.balance);
    }
    return { pension, accessible, total: pension + accessible };
};

/** Month-by-month net worth history from balance snapshots, oldest first.
 *  Each account carries its most recent balance forward into months where it
 *  has no snapshot, so the total doesn't dip when only one account was
 *  updated. Months before an account's first snapshot contribute nothing.
 *  Returns [{ month: 'YYYY-MM', pension, accessible, total }]. */
export const buildNetWorthHistory = (accounts, view) => {
    const visible = accountsForView(accounts, view).filter(a => a.snapshots?.length);
    if (!visible.length) return [];

    const allDates = visible.flatMap(a => a.snapshots.map(s => s.date));
    const first = allDates.reduce((a, b) => (a < b ? a : b)).slice(0, 7);
    const last = allDates.reduce((a, b) => (a > b ? a : b)).slice(0, 7);

    const months = [];
    let [y, m] = first.split('-').map(Number);
    const [ly, lm] = last.split('-').map(Number);
    while (y < ly || (y === ly && m <= lm)) {
        months.push(`${y}-${String(m).padStart(2, '0')}`);
        m += 1;
        if (m > 12) { m = 1; y += 1; }
    }

    return months.map(month => {
        const monthEnd = `${month}-31`;
        let pension = 0, accessible = 0;
        for (const account of visible) {
            // snapshots are newest-first; take the first at or before month end
            const snap = account.snapshots.find(s => s.date <= monthEnd);
            if (!snap) continue;
            if (account.kind === 'pension') pension += toNumber(snap.balance);
            else accessible += toNumber(snap.balance);
        }
        return { month, pension, accessible, total: pension + accessible };
    });
};

// --- Spending & saving from budget data ---

/** Monthly spending for a view from one month's computeBudgetTotals output.
 *  Per-person spending = own direct expenses + salary-proportion share of the
 *  joint expenses (matching how contributions are actually split). The Extra
 *  buffer and savings are excluded — they're not consumption. */
export const monthlySpendingForView = (t, view) => {
    if (view === 'keith') return t.keithDirectExpenses + t.sharedExpenseTotal * t.keithProportion;
    if (view === 'tild') return t.tildDirectExpenses + t.sharedExpenseTotal * t.tildProportion;
    return t.sharedExpenseTotal + t.keithDirectExpenses + t.tildDirectExpenses;
};

/** Monthly contribution to accessible (non-pension) wealth for a view: the
 *  budget's savings lines, with shared savings split by salary proportion in
 *  the per-person views. */
export const monthlySavingsForView = (t, view) => {
    if (view === 'keith') return t.keithSavings + t.sharedSavings * t.keithProportion;
    if (view === 'tild') return t.tildSavings + t.sharedSavings * t.tildProportion;
    return t.keithSavings + t.tildSavings + t.sharedSavings;
};

export const average = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

// --- FIRE maths ---

/** The portfolio needed to fund `annualSpending` at a withdrawal rate:
 *  spending ÷ SWR (4% → 25× spending). */
export const fiNumber = (annualSpending, swrPct) =>
    swrPct > 0 ? annualSpending / (swrPct / 100) : Infinity;

/** Project pension + accessible wealth forward with monthly compounding.
 *  Returns monthly points: [{ monthIndex, date: 'YYYY-MM', pension, accessible, total }].
 *  Point 0 is the starting position (startDate, no growth applied). */
export const projectWealth = ({
    pensionStart, accessibleStart, monthlyPension, monthlyAccessible,
    annualRealReturnPct, years = 40, startDate = new Date(),
}) => {
    const monthlyRate = Math.pow(1 + annualRealReturnPct / 100, 1 / 12) - 1;
    const series = [];
    let pension = pensionStart, accessible = accessibleStart;
    let y = startDate.getFullYear(), m = startDate.getMonth() + 1;
    for (let i = 0; i <= years * 12; i++) {
        series.push({
            monthIndex: i,
            date: `${y}-${String(m).padStart(2, '0')}`,
            pension: Math.round(pension),
            accessible: Math.round(accessible),
            total: Math.round(pension + accessible),
        });
        pension = pension * (1 + monthlyRate) + monthlyPension;
        accessible = accessible * (1 + monthlyRate) + monthlyAccessible;
        m += 1;
        if (m > 12) { m = 1; y += 1; }
    }
    return series;
};

/** First projection point whose total reaches the FI number, or null if it
 *  never does within the projected horizon. */
export const findFiCrossing = (series, fiTarget) =>
    series.find(p => p.total >= fiTarget) || null;

/** Coast FIRE: the pot which, with NO further contributions, grows to the FI
 *  number by `yearsUntilTarget` (the FI number discounted back). */
export const coastNumber = (fiTarget, annualRealReturnPct, yearsUntilTarget) =>
    yearsUntilTarget > 0 ? fiTarget / Math.pow(1 + annualRealReturnPct / 100, yearsUntilTarget) : fiTarget;

/** Share of income being put away (pension + savings vs gross income + employer top-up). */
export const savingsRate = (monthlyContributions, monthlyIncome) =>
    monthlyIncome > 0 ? monthlyContributions / monthlyIncome : 0;

/** Age in whole years on a date, from an ISO date of birth; null without one. */
export const ageAt = (dateOfBirthIso, date) => {
    if (!dateOfBirthIso) return null;
    const dob = new Date(dateOfBirthIso);
    let age = date.getFullYear() - dob.getFullYear();
    const beforeBirthday =
        date.getMonth() < dob.getMonth() ||
        (date.getMonth() === dob.getMonth() && date.getDate() < dob.getDate());
    if (beforeBirthday) age -= 1;
    return age;
};

// --- Mortgage ---

/** Equity and loan-to-value from the stated property value and balance. */
export const mortgageStats = (mortgage) => {
    const value = toNumber(mortgage.property_value);
    const balance = toNumber(mortgage.balance);
    const equity = value - balance;
    return {
        equity,
        equityPct: value > 0 ? (equity / value) * 100 : 0,
        ltvPct: value > 0 ? (balance / value) * 100 : 0,
    };
};

/** Amortise the mortgage forward from its stated balance/date.
 *  Returns { schedule: [{ date: 'YYYY-MM', balance }], payoffDate, totalInterest }.
 *  payoffDate is null when the payment doesn't cover the interest (balance
 *  grows — the schedule stops at maxYears so the chart still renders). */
export const amortiseMortgage = (mortgage, maxYears = 40) => {
    const monthlyRate = toNumber(mortgage.interest_rate_pct) / 100 / 12;
    const payment = toNumber(mortgage.monthly_payment);
    let balance = toNumber(mortgage.balance);
    let [y, m] = mortgage.balance_date.slice(0, 7).split('-').map(Number);

    const schedule = [{ date: `${y}-${String(m).padStart(2, '0')}`, balance: Math.round(balance) }];
    let payoffDate = null;
    let totalInterest = 0;
    for (let i = 0; i < maxYears * 12 && balance > 0; i++) {
        const interest = balance * monthlyRate;
        totalInterest += interest;
        balance = balance + interest - payment;
        m += 1;
        if (m > 12) { m = 1; y += 1; }
        const date = `${y}-${String(m).padStart(2, '0')}`;
        if (balance <= 0) {
            balance = 0;
            payoffDate = date;
        }
        schedule.push({ date, balance: Math.round(balance) });
        if (payment <= interest && i > 0) break; // payment doesn't cover interest: bail out early
    }
    return { schedule, payoffDate, totalInterest: Math.round(totalInterest) };
};
