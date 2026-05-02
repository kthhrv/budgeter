// Pure helpers for the nursery cost calculator. Used by NurseryPage and by the
// budget tab's "Sync from Nursery" button on linked items.

// ------------------------- Fee data (Effective 1 Jan 2026) -------------------------

export const STANDARD_RATES = {
    '0-2': { fullDay: 91.50, morning: 47.50, afternoon: 47.50, fullWeek: 356.00 },
    '2-3': { fullDay: 79.00, morning: 45.50, afternoon: 45.50, fullWeek: 356.00 },
    '3-5': { fullDay: 79.00, morning: 45.50, afternoon: 45.50, fullWeek: 356.00 },
};

export const FULL_WEEK_HOURLY = 356 / 50; // £7.12 /hr

export const FOOD_CONSUMABLES = {
    fullDay:   { food: 10.50, consumables: 1.50 },
    morning:   { food:  6.80, consumables: 0.75 },
    afternoon: { food:  3.70, consumables: 0.75 },
};

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

export const SESSION_OPTIONS = [
    { value: 'none',      label: 'Not attending' },
    { value: 'morning',   label: 'Morning (8am–1pm)' },
    { value: 'afternoon', label: 'Afternoon (1pm–6pm)' },
    { value: 'fullDay',   label: 'Full Day (8am–6pm)' },
];

export const BANK_HOLIDAYS = new Set([
    // 2026
    '2026-01-01', '2026-04-03', '2026-04-06',
    '2026-05-04', '2026-05-25', '2026-08-31',
    '2026-12-25', '2026-12-28',
    // 2027
    '2027-01-01', '2027-03-26', '2027-03-29',
    '2027-05-03', '2027-05-31', '2027-08-30',
    '2027-12-27', '2027-12-28',
]);

export const ymd = (y, m, d) =>
    `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// ------------------------- Helpers -------------------------

export const sessionHours = (t) => t === 'fullDay' ? 10 : (t === 'morning' || t === 'afternoon') ? 5 : 0;

export function sessionCost(type, ageBracket, fundedHours, fullWeekModel) {
    if (type === 'none') return { base: 0, fc: 0, total: 0 };
    const rates = STANDARD_RATES[ageBracket];
    const fc = FOOD_CONSUMABLES[type];
    const hrs = sessionHours(type);
    const stdPrice = rates[type];

    if (!fundedHours || fundedHours <= 0) {
        return { base: stdPrice, fc: 0, total: stdPrice };
    }

    const hourly = fullWeekModel ? FULL_WEEK_HOURLY : stdPrice / hrs;
    const nonFunded = hrs - fundedHours;
    const frac = fundedHours / hrs;
    const base = nonFunded * hourly;
    const fcCost = fc.food * frac + fc.consumables * frac;
    return { base, fc: fcCost, total: base + fcCost };
}

export function allocateFunding(schedule, totalFunded) {
    const allocated = [0, 0, 0, 0, 0];
    if (!totalFunded) return allocated;

    const priority = { afternoon: 3, morning: 2, fullDay: 1 };
    const indexed = schedule
        .map((t, i) => ({ t, i }))
        .filter(x => x.t !== 'none')
        .sort((a, b) => priority[b.t] - priority[a.t]);

    let remaining = totalFunded;

    for (const s of indexed) {
        const need = sessionHours(s.t);
        if (remaining + 1e-9 >= need) {
            allocated[s.i] = need;
            remaining -= need;
        }
    }

    if (remaining > 1e-9) {
        for (const s of indexed) {
            if (allocated[s.i] === 0) {
                const apply = Math.min(remaining, sessionHours(s.t));
                allocated[s.i] = apply;
                remaining -= apply;
                if (remaining <= 1e-9) break;
            }
        }
    }

    return allocated;
}

export function weeklyStretched(schedule, ageBracket, scheme, fullWeekModel) {
    const totalFunded = scheme === '30hr' ? 22.8 : scheme === '15hr' ? 11.4 : 0;
    const allocated = allocateFunding(schedule, totalFunded);
    const parts = schedule.map((t, i) => sessionCost(t, ageBracket, allocated[i], fullWeekModel));
    return {
        daily:     parts.map(p => p.total),
        dailyNoFC: parts.map(p => p.base),
        dailyFC:   parts.map(p => p.fc),
        allocated,
        total:     parts.reduce((a, p) => a + p.total, 0),
    };
}

export function weeklyStandard(schedule, ageBracket) {
    const rates = STANDARD_RATES[ageBracket];
    const daily = schedule.map(s => s === 'none' ? 0 : (s === 'fullDay' ? rates.fullDay : rates.morning));
    return { daily, total: daily.reduce((a, b) => a + b, 0) };
}

// ------------------------- Per-month effective settings -------------------------

// Find the latest override at or before monthKey for a given section. Edits propagate
// forward: a change in June carries through to July, August, ... until the next edit.
export function findEffectiveOverride(monthOverrides, monthKey, section) {
    if (!monthOverrides) return null;
    const keys = Object.keys(monthOverrides).filter(m => m <= monthKey).sort();
    for (let i = keys.length - 1; i >= 0; i--) {
        const v = monthOverrides[keys[i]]?.[section];
        if (v != null) return v;
    }
    return null;
}

// Given the saved nursery settings blob and a month key (YYYY-MM), produce the
// effective per-section values for that month (defaults overlaid by the latest
// applicable override).
export function effectiveForMonth(settings, monthKey) {
    const overrides = settings.monthOverrides || {};
    const ellisOverride   = findEffectiveOverride(overrides, monthKey, 'ellis');
    const gaspardOverride = findEffectiveOverride(overrides, monthKey, 'gaspard');
    const milOverride     = findEffectiveOverride(overrides, monthKey, 'mil');
    const billingOverride = findEffectiveOverride(overrides, monthKey, 'billing');
    return {
        ellis:           settings.ellis,
        gaspard:         settings.gaspard,
        ellisSchedule:   ellisOverride?.schedule   ?? settings.ellis.schedule,
        gaspardSchedule: gaspardOverride?.schedule ?? settings.gaspard.schedule,
        mil:             milOverride               ?? settings.mil,
        taxFree:         billingOverride?.taxFree         ?? settings.taxFree,
        fullWeekModel:   billingOverride?.fullWeekModel   ?? settings.fullWeekModel,
    };
}

// ------------------------- Headline computation -------------------------

// Compute the full month breakdown for the nursery calculator: per-weekday
// rows, ad-hoc rows, totals, and the headline TFC figures. Used by both the
// Nursery tab (for the breakdown table + headline cards) and the Budget tab
// (for the auto-sync via `totalTFC`).
//
// Returns:
//   { year, monthIdx, monthLabel, daysInMonth, weekdayCounts,
//     ellis: {...effective}, gaspard: {...effective},
//     monthlyDaily: per-weekday breakdown,
//     monthAdhocs:  per-ad-hoc rows,
//     monthly:      { gross, milGross, mil, parentBeforeTF, tfSaving, parentOOP },
//     ellisInvoiced, gaspardInvoiced, totalInvoiced,
//     ellisTFC, gaspardTFC, totalTFC,
//     effective: full effective settings for the month }
export function computeMonthSummary(settings, date) {
    const year = date.getFullYear();
    const monthIdx = date.getMonth();
    const monthLabel = date.toLocaleString('en-GB', { month: 'long', year: 'numeric' });
    const monthKey = `${year}-${String(monthIdx + 1).padStart(2, '0')}`;
    const eff = effectiveForMonth(settings, monthKey);

    // Weekday occurrences (split into funded weeks, "standard" weeks Apr 1-7 and
    // Dec 25-31, and bank holidays) for the month.
    const weekdayCounts = { funded: [0, 0, 0, 0, 0], standard: [0, 0, 0, 0, 0], bankHols: [0, 0, 0, 0, 0] };
    const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
        const dow = new Date(year, monthIdx, d).getDay();
        if (dow >= 1 && dow <= 5) {
            const wd = dow - 1;
            const iso = ymd(year, monthIdx, d);
            const isBankHol = BANK_HOLIDAYS.has(iso);
            const isStandard = (monthIdx === 3 && d <= 7) || (monthIdx === 11 && d >= 25);
            if (isStandard) weekdayCounts.standard[wd]++;
            else            weekdayCounts.funded[wd]++;
            if (isBankHol)  weekdayCounts.bankHols[wd]++;
        }
    }

    const ellisStretched   = weeklyStretched(eff.ellisSchedule,   eff.ellis.ageBracket,   eff.ellis.scheme,   eff.fullWeekModel);
    const ellisStandard    = weeklyStandard (eff.ellisSchedule,   eff.ellis.ageBracket);
    const gaspardStretched = weeklyStretched(eff.gaspardSchedule, eff.gaspard.ageBracket, eff.gaspard.scheme, eff.fullWeekModel);
    const gaspardStandard  = weeklyStandard (eff.gaspardSchedule, eff.gaspard.ageBracket);

    const eSib   = eff.ellis.siblingDiscount   ? 0.90 : 1.00;
    const gSib   = eff.gaspard.siblingDiscount ? 0.90 : 1.00;
    const tfMult = eff.taxFree ? 0.80 : 1.00;

    const monthlyDaily = [0, 1, 2, 3, 4].map(i => {
        const nFunded   = weekdayCounts.funded[i];
        const nStandard = weekdayCounts.standard[i];
        const nBankHols = weekdayCounts.bankHols[i];
        const nFundNorm = Math.max(0, nFunded - nBankHols);
        const occurrences = nFunded + nStandard;

        const eMonthlyGross = nFundNorm * ellisStretched.daily[i]   + nBankHols * ellisStretched.dailyNoFC[i]   + nStandard * ellisStandard.daily[i];
        const gMonthlyGross = nFundNorm * gaspardStretched.daily[i] + nBankHols * gaspardStretched.dailyNoFC[i] + nStandard * gaspardStandard.daily[i];
        const eMonthlyNet = eMonthlyGross * eSib;
        const gMonthlyNet = gMonthlyGross * gSib;
        const combined    = eMonthlyNet + gMonthlyNet;
        const milGrossPay = combined * (eff.mil[i] / 100);
        const milPay      = milGrossPay * tfMult;
        const parentPay   = (combined - milGrossPay) * tfMult;
        return {
            eFundedType: eff.ellisSchedule[i],
            gFundedType: eff.gaspardSchedule[i],
            eFundedHrs: ellisStretched.allocated[i],
            gFundedHrs: gaspardStretched.allocated[i],
            nFunded, nStandard, nBankHols, nFundNorm, occurrences,
            eMonthlyGross, eMonthlyNet,
            gMonthlyGross, gMonthlyNet,
            combined, milGrossPay, milPay, parentPay,
        };
    });

    const monthAdhocs = (settings.adhoc || []).filter(a => {
        if (!a.date) return false;
        const [yy, mm] = a.date.split('-').map(Number);
        return yy === year && (mm - 1) === monthIdx;
    }).map(a => {
        const rates = STANDARD_RATES[a.ageBracket];
        const cost = a.type === 'fullDay' ? rates.fullDay : rates.morning;
        const eGross = a.child === 'ellis'   ? cost : 0;
        const gGross = a.child === 'gaspard' ? cost : 0;
        const eNet = eGross * eSib;
        const gNet = gGross * gSib;
        const combined = eNet + gNet;
        const [yy, mm, dd] = a.date.split('-').map(Number);
        const dow = new Date(yy, mm - 1, dd).getDay();
        const wd = (dow >= 1 && dow <= 5) ? dow - 1 : -1;
        const milPct = wd >= 0 ? eff.mil[wd] : 0;
        const milGrossPay = combined * (milPct / 100);
        const milPay = milGrossPay * tfMult;
        const parentPay = (combined - milGrossPay) * tfMult;
        return { ...a, wd, milPct, cost, eGross, gGross, eNet, gNet, combined, milGrossPay, milPay, parentPay };
    });

    const sumDaily = (key) => monthlyDaily.reduce((s, m) => s + m[key], 0);
    const sumAdhoc = (key) => monthAdhocs.reduce((s, a) => s + a[key], 0);

    const ellisInvoiced   = sumDaily('eMonthlyNet') + sumAdhoc('eNet');
    const gaspardInvoiced = sumDaily('gMonthlyNet') + sumAdhoc('gNet');
    const totalInvoiced   = ellisInvoiced + gaspardInvoiced;
    const gross           = sumDaily('combined')    + sumAdhoc('combined');
    const milGross        = sumDaily('milGrossPay') + sumAdhoc('milGrossPay');
    const milTotal        = sumDaily('milPay')      + sumAdhoc('milPay');
    const parentOOP       = sumDaily('parentPay')   + sumAdhoc('parentPay');
    const tfSaving        = eff.taxFree ? gross * 0.20 : 0;

    return {
        year, monthIdx, monthLabel, daysInMonth, weekdayCounts,
        effective: eff,
        monthlyDaily, monthAdhocs,
        monthly: {
            gross, milGross,
            mil: milTotal,
            parentBeforeTF: gross - milGross,
            tfSaving, parentOOP,
        },
        ellisInvoiced, gaspardInvoiced, totalInvoiced,
        ellisTFC:   ellisInvoiced   * tfMult,
        gaspardTFC: gaspardInvoiced * tfMult,
        totalTFC:   totalInvoiced   * tfMult,
    };
}

// Substitute effective_value with the auto-computed Transfer-to-TFC for any
// item flagged is_nursery_linked, unless that item has an explicit one-off
// override pinned to the displayed month. Used by the budget tab to keep
// linked items in sync with the Nursery calculator without a button press.
export function applyNurseryLink(items, totalTFC, currentMonthName) {
    if (totalTFC == null) return items;
    return items.map(item => {
        if (!item.is_nursery_linked) return item;
        const overriddenForMonth = item.is_one_off === true
            && item.effective_from_month_name === currentMonthName;
        if (overriddenForMonth) return item;
        return { ...item, effective_value: totalTFC };
    });
}
