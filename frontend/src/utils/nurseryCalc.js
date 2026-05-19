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

    // Stretched/full-week families pay the full-week hourly on every chargeable
    // hour, including days that happen to receive no funding allocation (e.g.
    // Thu/Fri when the 30-hour entitlement is consumed on earlier weekdays).
    // Falling back to stdPrice on zero-funded days would overcount those days.
    const funded = Math.max(0, fundedHours || 0);
    const hourly = fullWeekModel ? FULL_WEEK_HOURLY : stdPrice / hrs;
    const nonFunded = hrs - funded;
    const frac = funded / hrs;
    const base = nonFunded * hourly;
    const fcCost = (fc.food + fc.consumables) * frac;
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

// ------------------------- TFC entitlement period (£500 cap) -------------------------

// HMRC Tax-Free Childcare adds a 20% top-up capped at £500 per child per
// 3-month entitlement period. Both kids' periods reset on 1 May (payment side).
// Nursery is paid one month in advance, so the May payment buys June's
// attendance — meaning the May–Jul payment quarter maps to attendance months
// Jun–Aug. Attendance-aligned periods (used everywhere in this file) are:
//   Mar–May, Jun–Aug, Sep–Nov, Dec–Feb.
export const TFC_QUARTERLY_CAP = 500;

export function tfcPeriodMonths(monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    let startY, startM;
    if (m >= 3  && m <= 5)        { startY = y;     startM = 3;  }
    else if (m >= 6  && m <= 8)   { startY = y;     startM = 6;  }
    else if (m >= 9  && m <= 11)  { startY = y;     startM = 9;  }
    else if (m === 12)            { startY = y;     startM = 12; }
    else /* Jan, Feb */           { startY = y - 1; startM = 12; }
    const months = [];
    for (let i = 0; i < 3; i++) {
        const mm = startM + i;
        const yy = startY + Math.floor((mm - 1) / 12);
        const m2 = ((mm - 1) % 12) + 1;
        months.push(`${yy}-${String(m2).padStart(2, '0')}`);
    }
    return months;
}

// Cheap per-child invoice computation for a single month (no MIL/TFC). Used
// both inside computeMonthSummary and to walk prior months for the cap.
function rawInvoicedForMonth(settings, monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    const year = y, monthIdx = m - 1;
    const eff = effectiveForMonth(settings, monthKey);

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
    const eSib = eff.ellis.siblingDiscount   ? 0.90 : 1.00;
    const gSib = eff.gaspard.siblingDiscount ? 0.90 : 1.00;

    let ellisInvoiced = 0, gaspardInvoiced = 0;
    for (let i = 0; i < 5; i++) {
        const nFunded   = weekdayCounts.funded[i];
        const nStandard = weekdayCounts.standard[i];
        const nBankHols = weekdayCounts.bankHols[i];
        const nFundNorm = Math.max(0, nFunded - nBankHols);
        const eBase = nFundNorm * ellisStretched.dailyNoFC[i]   + nBankHols * ellisStretched.dailyNoFC[i]   + nStandard * ellisStandard.daily[i];
        const gBase = nFundNorm * gaspardStretched.dailyNoFC[i] + nBankHols * gaspardStretched.dailyNoFC[i] + nStandard * gaspardStandard.daily[i];
        const eFC   = nFundNorm * ellisStretched.dailyFC[i];
        const gFC   = nFundNorm * gaspardStretched.dailyFC[i];
        ellisInvoiced   += eBase * eSib + eFC;
        gaspardInvoiced += gBase * gSib + gFC;
    }

    for (const a of (settings.adhoc || [])) {
        if (!a.date) continue;
        const [yy, mm] = a.date.split('-').map(Number);
        if (yy !== year || mm - 1 !== monthIdx) continue;
        const rates = STANDARD_RATES[a.ageBracket];
        const cost = a.type === 'fullDay' ? rates.fullDay : rates.morning;
        if (a.child === 'ellis')   ellisInvoiced   += cost * eSib;
        if (a.child === 'gaspard') gaspardInvoiced += cost * gSib;
    }

    return { ellisInvoiced, gaspardInvoiced, taxFree: eff.taxFree };
}

// For the given month, walk prior months in the same TFC entitlement period
// to determine how much of each child's £500 cap has already been consumed,
// then compute the cap-aware saving for the current month.
export function tfcSavingForMonth(settings, monthKey) {
    const period = tfcPeriodMonths(monthKey);
    const idx = period.indexOf(monthKey);
    let ellisUsed = 0, gaspardUsed = 0;

    for (let i = 0; i < idx; i++) {
        const raw = rawInvoicedForMonth(settings, period[i]);
        if (!raw.taxFree) continue;
        ellisUsed   += Math.max(0, Math.min(raw.ellisInvoiced   * 0.20, TFC_QUARTERLY_CAP - ellisUsed));
        gaspardUsed += Math.max(0, Math.min(raw.gaspardInvoiced * 0.20, TFC_QUARTERLY_CAP - gaspardUsed));
    }

    const current = rawInvoicedForMonth(settings, monthKey);
    const ellisSaving   = current.taxFree ? Math.max(0, Math.min(current.ellisInvoiced   * 0.20, TFC_QUARTERLY_CAP - ellisUsed))   : 0;
    const gaspardSaving = current.taxFree ? Math.max(0, Math.min(current.gaspardInvoiced * 0.20, TFC_QUARTERLY_CAP - gaspardUsed)) : 0;

    return {
        ellisSaving, gaspardSaving,
        ellisUsedBefore: ellisUsed,
        gaspardUsedBefore: gaspardUsed,
        period,
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
//     tfc: per-child saving + cap diagnostics,
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

    const eSib = eff.ellis.siblingDiscount   ? 0.90 : 1.00;
    const gSib = eff.gaspard.siblingDiscount ? 0.90 : 1.00;

    // Phase 1: per-day / per-adhoc raw amounts. The sibling discount applies
    // only to the chargeable-hours portion (matching the nursery's invoices) —
    // food and consumables are billed at full price regardless.
    const rawDaily = [0, 1, 2, 3, 4].map(i => {
        const nFunded   = weekdayCounts.funded[i];
        const nStandard = weekdayCounts.standard[i];
        const nBankHols = weekdayCounts.bankHols[i];
        const nFundNorm = Math.max(0, nFunded - nBankHols);
        const occurrences = nFunded + nStandard;
        const eBase = nFundNorm * ellisStretched.dailyNoFC[i]   + nBankHols * ellisStretched.dailyNoFC[i]   + nStandard * ellisStandard.daily[i];
        const gBase = nFundNorm * gaspardStretched.dailyNoFC[i] + nBankHols * gaspardStretched.dailyNoFC[i] + nStandard * gaspardStandard.daily[i];
        const eFC   = nFundNorm * ellisStretched.dailyFC[i];
        const gFC   = nFundNorm * gaspardStretched.dailyFC[i];
        const eMonthlyGross = eBase + eFC;
        const gMonthlyGross = gBase + gFC;
        const eMonthlyNet = eBase * eSib + eFC;
        const gMonthlyNet = gBase * gSib + gFC;
        return {
            eFundedType: eff.ellisSchedule[i],
            gFundedType: eff.gaspardSchedule[i],
            eFundedHrs: ellisStretched.allocated[i],
            gFundedHrs: gaspardStretched.allocated[i],
            nFunded, nStandard, nBankHols, nFundNorm, occurrences,
            eMonthlyGross, eMonthlyNet, gMonthlyGross, gMonthlyNet,
        };
    });

    const rawAdhocs = (settings.adhoc || []).filter(a => {
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
        const [yy, mm, dd] = a.date.split('-').map(Number);
        const dow = new Date(yy, mm - 1, dd).getDay();
        const wd = (dow >= 1 && dow <= 5) ? dow - 1 : -1;
        const milPct = wd >= 0 ? eff.mil[wd] : 0;
        return { ...a, wd, milPct, cost, eGross, gGross, eNet, gNet };
    });

    const ellisInvoiced   = rawDaily.reduce((s, m) => s + m.eMonthlyNet, 0) + rawAdhocs.reduce((s, a) => s + a.eNet, 0);
    const gaspardInvoiced = rawDaily.reduce((s, m) => s + m.gMonthlyNet, 0) + rawAdhocs.reduce((s, a) => s + a.gNet, 0);

    // Phase 2: per-child TFC factor with quarterly cap (per child, periods
    // reset on 1 May for both kids).
    const cap = tfcSavingForMonth(settings, monthKey);
    const eEffMult = ellisInvoiced   > 0 ? (ellisInvoiced   - cap.ellisSaving)   / ellisInvoiced   : 1;
    const gEffMult = gaspardInvoiced > 0 ? (gaspardInvoiced - cap.gaspardSaving) / gaspardInvoiced : 1;

    // Phase 3: complete per-day / per-adhoc rows with MIL + parent pay.
    // Per-child TFC factors apply uniformly across the month (the cap is a
    // monthly/period-level constraint, distributed proportionally per day).
    // MIL pays her percentage of the post-TFC out-of-pocket combined cost.
    const monthlyDaily = rawDaily.map((md, i) => {
        const milPct      = eff.mil[i] / 100;
        const combined    = md.eMonthlyNet + md.gMonthlyNet;
        const milGrossPay = combined * milPct;
        const eAfterTF    = md.eMonthlyNet * eEffMult;
        const gAfterTF    = md.gMonthlyNet * gEffMult;
        const milPay      = (eAfterTF + gAfterTF) * milPct;
        const parentPay   = (eAfterTF + gAfterTF) - milPay;
        return { ...md, combined, milGrossPay, milPay, parentPay };
    });

    const monthAdhocs = rawAdhocs.map(a => {
        const milPct      = a.milPct / 100;
        const combined    = a.eNet + a.gNet;
        const milGrossPay = combined * milPct;
        const eAfterTF    = a.eNet * eEffMult;
        const gAfterTF    = a.gNet * gEffMult;
        const milPay      = (eAfterTF + gAfterTF) * milPct;
        const parentPay   = (eAfterTF + gAfterTF) - milPay;
        return { ...a, combined, milGrossPay, milPay, parentPay };
    });

    const sumDaily = (key) => monthlyDaily.reduce((s, m) => s + m[key], 0);
    const sumAdhoc = (key) => monthAdhocs.reduce((s, a) => s + a[key], 0);

    const totalInvoiced = ellisInvoiced + gaspardInvoiced;
    const gross         = sumDaily('combined')    + sumAdhoc('combined');
    const milGross      = sumDaily('milGrossPay') + sumAdhoc('milGrossPay');
    const milTotal      = sumDaily('milPay')      + sumAdhoc('milPay');
    const parentOOP     = sumDaily('parentPay')   + sumAdhoc('parentPay');
    const tfSaving      = cap.ellisSaving + cap.gaspardSaving;

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
        ellisTFC:   ellisInvoiced   - cap.ellisSaving,
        gaspardTFC: gaspardInvoiced - cap.gaspardSaving,
        totalTFC:   totalInvoiced   - tfSaving,
        tfc: {
            ellisFactor:       eEffMult,
            gaspardFactor:     gEffMult,
            ellisSaving:       cap.ellisSaving,
            gaspardSaving:     cap.gaspardSaving,
            ellisUsedBefore:   cap.ellisUsedBefore,
            gaspardUsedBefore: cap.gaspardUsedBefore,
            ellisCapped:       eff.taxFree && cap.ellisSaving   < ellisInvoiced   * 0.20 - 1e-6,
            gaspardCapped:     eff.taxFree && cap.gaspardSaving < gaspardInvoiced * 0.20 - 1e-6,
            quarterlyCap:      TFC_QUARTERLY_CAP,
            periodMonths:      cap.period,
        },
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
