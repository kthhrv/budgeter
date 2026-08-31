// FIRE (Financial Independence / Retire Early) calculations.
//
// Everything works in TODAY'S MONEY: the expected return is a real
// (after-inflation) rate, so projected values and the FI number are directly
// comparable to current spending. Phase 1 models a single blended real return
// with pension and accessible wealth tracked as separate streams; the
// two-phase pension-bridge test, tax/NI and state pension land in phase 2.

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

// --- UK tax & NI (2025/26, thresholds frozen to April 2028 — gov.uk/income-tax-rates,
// gov.uk/national-insurance-rates-letters; employee class 1 main rate 8% since Jan 2024) ---

export const UK_TAX = {
    personalAllowance: 12570,
    basicBand: 37700,          // taxable income width of the 20% band
    additionalThreshold: 125140, // taxable income above this taxed at 45%
    taperThreshold: 100000,    // PA shrinks £1 per £2 of income above this
    basicRate: 0.20, higherRate: 0.40, additionalRate: 0.45,
    niLower: 12570, niUpper: 50270,
    niMainRate: 0.08, niUpperRate: 0.02,
};

/** Annual income tax on gross taxable pay (after any pension deduction). */
export const annualIncomeTax = (taxableGross) => {
    const t = UK_TAX;
    let allowance = t.personalAllowance;
    if (taxableGross > t.taperThreshold) {
        allowance = Math.max(0, allowance - (taxableGross - t.taperThreshold) / 2);
    }
    const taxable = Math.max(0, taxableGross - allowance);
    return (
        Math.min(taxable, t.basicBand) * t.basicRate +
        Math.max(0, Math.min(taxable, t.additionalThreshold) - t.basicBand) * t.higherRate +
        Math.max(0, taxable - t.additionalThreshold) * t.additionalRate
    );
};

/** Annual employee class 1 NI on NI-able gross pay. */
export const annualNI = (niableGross) => {
    const t = UK_TAX;
    return (
        Math.max(0, Math.min(niableGross, t.niUpper) - t.niLower) * t.niMainRate +
        Math.max(0, niableGross - t.niUpper) * t.niUpperRate
    );
};

/** Monthly take-home pay from an EarningsVersion. Salary sacrifice reduces
 *  both tax and NI; a non-sacrificed contribution is treated as a net-pay
 *  arrangement (reduces taxable pay but not NI). */
export const monthlyTakeHome = (earnings) => {
    if (!earnings) return 0;
    const gross = toNumber(earnings.gross_annual_salary);
    const employeeContribution = gross * toNumber(earnings.employee_pension_pct) / 100;
    const taxableGross = gross - employeeContribution;
    const niableGross = earnings.employee_pension_is_salary_sacrifice ? gross - employeeContribution : gross;
    return (gross - employeeContribution - annualIncomeTax(taxableGross) - annualNI(niableGross)) / 12;
};

// --- Retirement drawdown tax ---
// Pension withdrawals are modelled UFPLS-style: 25% of each withdrawal is
// tax-free cash, the other 75% is taxed as income on top of whatever else the
// person receives that month (state pension). No NI is due on pension income.
// Simplifications, both stated: the £268,275 lump-sum allowance cap on total
// tax-free cash is ignored, and GIA gains are treated like ISA (no CGT).

/** Income tax on one month's income, using annual bands ÷ 12. */
export const monthlyIncomeTax = (monthlyIncome) => annualIncomeTax(monthlyIncome * 12) / 12;

/** Net amount received from a gross pension withdrawal this month, given the
 *  person's other taxable income for the month. */
export const netFromPensionWithdrawal = (gross, otherTaxableMonthly = 0) =>
    gross - (monthlyIncomeTax(otherTaxableMonthly + gross * 0.75) - monthlyIncomeTax(otherTaxableMonthly));

/** Gross pension withdrawal needed to receive `netNeed` after tax. Solved by
 *  damped fixed-point iteration — the net-of-gross slope is at worst 0.55
 *  (45% band × 75% taxable, or the 60% PA-taper zone), so this converges to
 *  under a penny well within the iteration cap. */
export const grossPensionWithdrawal = (netNeed, otherTaxableMonthly = 0) => {
    if (netNeed <= 0) return 0;
    let gross = netNeed;
    for (let i = 0; i < 20; i++) {
        const shortfall = netNeed - netFromPensionWithdrawal(gross, otherTaxableMonthly);
        if (Math.abs(shortfall) < 0.005) break;
        gross += shortfall / 0.6;
    }
    return gross;
};

// --- Lifecycle simulation (the two-phase pension bridge test) ---

// Full new state pension 2025/26 (£230.25/wk — gov.uk/new-state-pension).
// Treated as flat in today's money: the triple lock at least matches inflation.
export const STATE_PENSION_ANNUAL = 11973;
// State pension age 68 applies to anyone born after April 1977 under the
// current review trajectory; both owners are younger than that.
export const STATE_PENSION_AGE = 68;
// Simulate until this age — the pot must survive the whole retirement.
export const LONGEVITY_AGE = 95;

/** Month index (from startDate) of a 'YYYY-MM' date; negative if in the past. */
export const monthIndexOf = (ym, startDate = new Date()) => {
    const [y, m] = ym.split('-').map(Number);
    return (y - startDate.getFullYear()) * 12 + (m - 1 - startDate.getMonth());
};

/** Whole months from startDate until `dobIso` turns `age`; 0 if already past. */
export const monthsUntilAge = (dobIso, age, startDate = new Date()) => {
    if (!dobIso) return null;
    const dob = new Date(dobIso);
    const months = (dob.getFullYear() + age - startDate.getFullYear()) * 12
        + (dob.getMonth() - startDate.getMonth());
    return Math.max(0, months);
};

/**
 * Simulate the household month by month, in today's money: accumulate until
 * `retirementMonth`, then draw spending down. Pension pots stay locked until
 * each person's access age — before that, only accessible wealth can fund
 * spending, which is the "bridge" an early retirement must survive.
 *
 * people: [{ pensionStart, monthlyContribution, accessMonth, statePensionMonth, statePensionMonthly }]
 *   (accessMonth/statePensionMonth are month indices from now; null access = never locked)
 * mortgages: [{ monthlyPayment, payoffMonth }] — spending drops by each loan's
 *   payment from its payoff month (payoffMonth null = never pays off).
 * Returns { viable, trajectory } — trajectory has quarterly points
 *   { monthIndex, date, pension, accessible, total } through the whole horizon.
 */
export const simulateLifecycle = ({
    people, accessibleStart, monthlyAccessible, annualRealReturnPct,
    baseMonthlySpending, mortgages = [],
    retirementMonth, horizonMonths, startDate = new Date(),
    extraSampleMonths = [],
}) => {
    const monthlyRate = Math.pow(1 + annualRealReturnPct / 100, 1 / 12) - 1;
    const pensions = people.map(p => p.pensionStart);
    let accessible = accessibleStart;
    let viable = true;
    const trajectory = [];
    // Charts anchor ReferenceLines to exact data points, so always sample the
    // marker months (retirement, pension access) on top of the quarterly grid.
    const extraSamples = new Set(extraSampleMonths);
    let y = startDate.getFullYear(), m = startDate.getMonth() + 1;

    for (let i = 0; i <= horizonMonths; i++) {
        if (i % 3 === 0 || i === horizonMonths || extraSamples.has(i)) {
            trajectory.push({
                monthIndex: i,
                date: `${y}-${String(m).padStart(2, '0')}`,
                pension: Math.round(pensions.reduce((a, b) => a + b, 0)),
                accessible: Math.round(Math.max(0, accessible)),
                total: Math.round(pensions.reduce((a, b) => a + b, 0) + Math.max(0, accessible)),
            });
        }

        m += 1;
        if (m > 12) { m = 1; y += 1; }

        // grow
        for (let pi = 0; pi < pensions.length; pi++) pensions[pi] *= 1 + monthlyRate;
        accessible *= 1 + monthlyRate;

        if (i < retirementMonth) {
            for (let pi = 0; pi < pensions.length; pi++) pensions[pi] += people[pi].monthlyContribution;
            accessible += monthlyAccessible;
            continue;
        }

        // retired: meet this month's spending from net-of-tax income
        let spending = baseMonthlySpending;
        for (const loan of mortgages) {
            if (loan.payoffMonth !== null && i >= loan.payoffMonth) spending -= loan.monthlyPayment;
        }
        let need = Math.max(0, spending);

        // State pension first — taxable income (though alone it sits under the
        // personal allowance). Track each person's taxable income this month
        // so pension withdrawals stack on top of it for tax.
        const taxableSoFar = people.map(p =>
            (p.statePensionMonth !== null && i >= p.statePensionMonth) ? p.statePensionMonthly : 0);
        for (const t of taxableSoFar) {
            if (t > 0) need -= t - monthlyIncomeTax(t);
        }
        need = Math.max(0, need);

        // Accessible wealth (ISA/cash) is tax-free
        const fromAccessible = Math.min(Math.max(0, accessible), need);
        accessible -= fromAccessible;
        need -= fromAccessible;

        // Pension withdrawals, grossed up for tax. Two passes: an equal split
        // first so a couple uses both personal allowances, then spill-over to
        // whoever still has funds.
        if (need > 0.005) {
            const drawNet = (pi, netTarget) => {
                let gross = grossPensionWithdrawal(netTarget, taxableSoFar[pi]);
                if (gross > pensions[pi]) gross = pensions[pi];
                const net = netFromPensionWithdrawal(gross, taxableSoFar[pi]);
                pensions[pi] -= gross;
                taxableSoFar[pi] += gross * 0.75;
                return net;
            };
            const unlocked = () => people
                .map((_, pi) => pi)
                .filter(pi => (people[pi].accessMonth === null || i >= people[pi].accessMonth) && pensions[pi] > 0.005);
            const first = unlocked();
            const share = first.length ? need / first.length : 0;
            for (const pi of first) {
                if (need <= 0.005) break;
                need -= drawNet(pi, Math.min(share, need));
            }
            for (const pi of unlocked()) {
                if (need <= 0.005) break;
                need -= drawNet(pi, need);
            }
        }
        if (need > 0.005) viable = false; // couldn't fund the month (pensions locked or everything empty)
    }
    return { viable, trajectory };
};

/** Earliest retirement month (index from now) whose lifecycle simulation
 *  survives to the horizon, found by coarse scan + refinement. Returns null
 *  when no month within `searchMonths` is viable. */
export const findEarliestViableRetirement = (params, searchMonths = 480) => {
    const viableAt = (t) => simulateLifecycle({ ...params, retirementMonth: t }).viable;
    let coarse = null;
    for (let t = 0; t <= searchMonths; t += 6) {
        if (viableAt(t)) { coarse = t; break; }
    }
    if (coarse === null) return null;
    for (let t = Math.max(0, coarse - 5); t < coarse; t++) {
        if (viableAt(t)) return t;
    }
    return coarse;
};

// --- Mortgage ---

/** Equity and loan-to-value from the property value and the combined balance
 *  of every loan secured on it. */
export const mortgageStats = (property, mortgages) => {
    const value = toNumber(property.value);
    const totalBalance = mortgages.reduce((sum, m) => sum + toNumber(m.balance), 0);
    const equity = value - totalBalance;
    return {
        equity,
        totalBalance,
        equityPct: value > 0 ? (equity / value) * 100 : 0,
        ltvPct: value > 0 ? (totalBalance / value) * 100 : 0,
    };
};

/** Treat several loans on one property as a single loan: combined balance and
 *  payment, balance-weighted average rate, and the latest stated balance date.
 *  Used by the overpayment calculator, where the household makes one combined
 *  payment rather than reasoning per part. */
export const aggregateLoans = (loans) => {
    const balance = loans.reduce((sum, m) => sum + toNumber(m.balance), 0);
    return {
        balance,
        monthly_payment: loans.reduce((sum, m) => sum + toNumber(m.monthly_payment), 0),
        interest_rate_pct: balance > 0
            ? loans.reduce((sum, m) => sum + toNumber(m.balance) * toNumber(m.interest_rate_pct), 0) / balance
            : 0,
        balance_date: loans.map(m => m.balance_date).sort().at(-1) ?? null,
    };
};

/** Sum several amortisation schedules into one combined-balance series.
 *  Loans start on different dates: before a loan's schedule begins it
 *  contributes its opening balance; after it ends, its final balance
 *  (0 when paid off). */
export const combineSchedules = (schedules) => {
    const nonEmpty = schedules.filter(s => s.length);
    if (!nonEmpty.length) return [];
    const withLookup = nonEmpty.map(s => ({
        first: s[0], last: s[s.length - 1],
        byDate: new Map(s.map(p => [p.date, p.balance])),
    }));
    const allMonths = [...new Set(nonEmpty.flatMap(s => s.map(p => p.date)))].sort();
    return allMonths.map(date => ({
        date,
        balance: withLookup.reduce((sum, s) => {
            if (s.byDate.has(date)) return sum + s.byDate.get(date);
            return sum + (date < s.first.date ? s.first.balance : s.last.balance);
        }, 0),
    }));
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
