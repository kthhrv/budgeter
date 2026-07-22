import { describe, it, expect } from 'vitest';
import {
    computeMonthSummary, effectiveForMonth, applyNurseryLink,
    tfcSavingForMonth, TFC_QUARTERLY_CAP,
} from '../utils/nurseryCalc';

const baseSettings = () => ({
    ellis: {
        ageBracket: '2-3',
        scheme: '30hr',
        schedule: ['fullDay', 'fullDay', 'fullDay', 'fullDay', 'fullDay'],
        siblingDiscount: false,
    },
    gaspard: {
        ageBracket: '3-5',
        scheme: '30hr',
        schedule: ['fullDay', 'fullDay', 'fullDay', 'fullDay', 'fullDay'],
        siblingDiscount: true,
    },
    mil: [0, 0, 0, 100, 50],
    taxFree: true,
    fullWeekModel: true,
    adhoc: [],
    monthOverrides: {},
});

describe('computeMonthSummary', () => {
    it('produces a TFC total = 0.80 × invoiced when tax-free is on', () => {
        const summary = computeMonthSummary(baseSettings(), new Date(2026, 5, 1));
        expect(summary.totalTFC).toBeCloseTo(summary.totalInvoiced * 0.80, 2);
    });

    it('totalTFC equals total invoiced when tax-free is off', () => {
        const s = baseSettings();
        s.taxFree = false;
        const summary = computeMonthSummary(s, new Date(2026, 5, 1));
        expect(summary.totalTFC).toBeCloseTo(summary.totalInvoiced, 2);
    });

    it('applies 10% sibling discount to Gaspard (chargeable hours only)', () => {
        const s = baseSettings();
        s.gaspard.siblingDiscount = true;
        s.ellis.siblingDiscount = false;
        const onSibling  = computeMonthSummary(s, new Date(2026, 5, 1));
        s.gaspard.siblingDiscount = false;
        const offSibling = computeMonthSummary(s, new Date(2026, 5, 1));
        // The nursery applies the 10% sibling discount to the chargeable-hours
        // line only — not food/consumables. So the saving equals 10% of the
        // pre-discount chargeable-hours portion (≈ invoice − food/cons).
        const eFood = offSibling.ellisInvoiced - onSibling.ellisInvoiced; // 0 (no discount)
        expect(eFood).toBeCloseTo(0, 6);
        // Gaspard's saving = 10% of his chargeable-hours portion. With identical
        // schedules the discount works out to ~£77.47 for June 2026.
        const saving = offSibling.gaspardInvoiced - onSibling.gaspardInvoiced;
        expect(saving).toBeGreaterThan(50);
        expect(saving).toBeLessThan(offSibling.gaspardInvoiced * 0.10); // strictly less than 10% of total
    });

    it('includes ad-hoc days that fall in the month', () => {
        const s = baseSettings();
        s.adhoc = [
            { id: 'a1', date: '2026-06-15', child: 'ellis', type: 'fullDay', ageBracket: '2-3' },
        ];
        const baseline = computeMonthSummary(baseSettings(), new Date(2026, 5, 1));
        const withAdhoc = computeMonthSummary(s, new Date(2026, 5, 1));
        // 2-3 full-day rate is £79; siblingDiscount on ellis is false in baseline.
        expect(withAdhoc.ellisInvoiced - baseline.ellisInvoiced).toBeCloseTo(79, 1);
    });

    it('skips ad-hoc days outside the month', () => {
        const s = baseSettings();
        s.adhoc = [
            { id: 'a1', date: '2026-07-15', child: 'ellis', type: 'fullDay', ageBracket: '2-3' },
        ];
        const summary = computeMonthSummary(s, new Date(2026, 5, 1));
        const baseline = computeMonthSummary(baseSettings(), new Date(2026, 5, 1));
        expect(summary.totalInvoiced).toBeCloseTo(baseline.totalInvoiced, 2);
    });
});

describe('applyNurseryLink', () => {
    const baseItem = (overrides = {}) => ({
        budget_item_id: 'a',
        item_name: 'Nursery',
        item_type: 'expense',
        owner: 'shared',
        effective_value: 999,
        is_nursery_linked: false,
        is_one_off: false,
        effective_from_month_name: 'June 2026',
        ...overrides,
    });

    it('does not modify items that are not nursery-linked', () => {
        const items = [baseItem({ is_nursery_linked: false, effective_value: 50 })];
        const out = applyNurseryLink(items, 200, 'June 2026');
        expect(out[0].effective_value).toBe(50);
    });

    it('substitutes effective_value with the auto TFC for linked items', () => {
        const items = [baseItem({ is_nursery_linked: true, effective_value: 999 })];
        const out = applyNurseryLink(items, 250.50, 'June 2026');
        expect(out[0].effective_value).toBe(250.50);
    });

    it('preserves a per-month one-off override (linked, is_one_off, month matches)', () => {
        const items = [baseItem({
            is_nursery_linked: true,
            is_one_off: true,
            effective_from_month_name: 'June 2026',
            effective_value: 100,
        })];
        const out = applyNurseryLink(items, 250, 'June 2026');
        expect(out[0].effective_value).toBe(100);
    });

    it('still substitutes when is_one_off=true but month does not match (override is for a different month)', () => {
        const items = [baseItem({
            is_nursery_linked: true,
            is_one_off: true,
            effective_from_month_name: 'May 2026',
            effective_value: 100,
        })];
        const out = applyNurseryLink(items, 250, 'June 2026');
        expect(out[0].effective_value).toBe(250);
    });

    it('returns items unchanged when totalTFC is null (settings not yet loaded)', () => {
        const items = [baseItem({ is_nursery_linked: true, effective_value: 999 })];
        const out = applyNurseryLink(items, null, 'June 2026');
        expect(out[0].effective_value).toBe(999);
    });
});

describe('TFC entitlement periods (per-child, payment-date based)', () => {
    // Payment is made the month before attendance. Periods are 3 consecutive
    // payment months anchored per child:
    //   Gaspard (20th, phase May): payment May/Aug/Nov/Feb → attendance
    //     periods Jun–Aug, Sep–Nov, Dec–Feb, Mar–May.
    //   Ellis (31st, phase Jan): payment Jan/Apr/Jul/Oct → attendance periods
    //     Aug–Oct, Nov–Jan, Feb–Apr, May–Jul.
    it("Gaspard's Jun–Aug attendance share one period; August is the 3rd month", () => {
        const aug = tfcSavingForMonth(baseSettings(), '2026-08');
        expect(aug.gaspardPeriodMonths).toEqual(['2026-06', '2026-07', '2026-08']);
    });

    it("Ellis's August payment (30 Jul) opens a fresh period — August is the 1st month", () => {
        const aug = tfcSavingForMonth(baseSettings(), '2026-08');
        expect(aug.ellisPeriodMonths).toEqual(['2026-08']);
        expect(aug.ellisUsedBefore).toBe(0);
    });

    it("Ellis's May–Jul attendance share the prior period", () => {
        const jul = tfcSavingForMonth(baseSettings(), '2026-07');
        expect(jul.ellisPeriodMonths).toEqual(['2026-05', '2026-06', '2026-07']);
    });

    it('the two children can sit in different periods in the same calendar month', () => {
        const aug = tfcSavingForMonth(baseSettings(), '2026-08');
        // Gaspard mid/late in his period, Ellis fresh at the start of hers.
        expect(aug.gaspardPeriodMonths.length).toBe(3);
        expect(aug.ellisPeriodMonths.length).toBe(1);
    });
});

describe('TFC quarterly cap', () => {
    it('caps the per-child saving at £500 within a single 3-month period', () => {
        // Gaspard's period is Jun–Aug attendance.
        const jun = computeMonthSummary(baseSettings(), new Date(2026, 5, 1));
        const jul = computeMonthSummary(baseSettings(), new Date(2026, 6, 1));
        const aug = computeMonthSummary(baseSettings(), new Date(2026, 7, 1));
        const gaspardSavingTotal = jun.tfc.gaspardSaving + jul.tfc.gaspardSaving + aug.tfc.gaspardSaving;
        expect(gaspardSavingTotal).toBeLessThanOrEqual(TFC_QUARTERLY_CAP + 1e-6);
    });

    it('totalTFC equals invoice minus (capped) saving', () => {
        const aug = computeMonthSummary(baseSettings(), new Date(2026, 7, 1));
        expect(aug.totalTFC).toBeCloseTo(aug.totalInvoiced - aug.tfc.ellisSaving - aug.tfc.gaspardSaving, 2);
        expect(aug.totalTFC).toBeGreaterThan(aug.totalInvoiced * 0.80 - 1e-6);
    });

    it('resets at the start of the next period (fresh usedBefore)', () => {
        // Gaspard's next period starts at Sep attendance; Ellis's at Aug.
        const sep = tfcSavingForMonth(baseSettings(), '2026-09');
        expect(sep.gaspardUsedBefore).toBe(0);
        const aug = tfcSavingForMonth(baseSettings(), '2026-08');
        expect(aug.ellisUsedBefore).toBe(0);
    });

    it('tfcSavingForMonth accumulates consumed savings across a period (Gaspard Jun→Jul→Aug)', () => {
        const jun = tfcSavingForMonth(baseSettings(), '2026-06');
        const jul = tfcSavingForMonth(baseSettings(), '2026-07');
        const aug = tfcSavingForMonth(baseSettings(), '2026-08');
        expect(jun.gaspardUsedBefore).toBe(0);
        expect(jul.gaspardUsedBefore).toBeCloseTo(jun.gaspardSaving, 2);
        expect(aug.gaspardUsedBefore).toBeCloseTo(jun.gaspardSaving + jul.gaspardSaving, 2);
    });

    it('does not consume cap from months where taxFree was off', () => {
        // Gaspard's Jun–Aug period: turn taxFree off for June only.
        const s = baseSettings();
        s.monthOverrides = {
            '2026-06': { billing: { taxFree: false, fullWeekModel: true } },
            '2026-07': { billing: { taxFree: true,  fullWeekModel: true } },
        };
        const jul = tfcSavingForMonth(s, '2026-07');
        expect(jul.gaspardUsedBefore).toBe(0); // June contributed nothing.
    });
});

describe('effectiveForMonth', () => {
    it('falls through to defaults when no override applies', () => {
        const s = baseSettings();
        const eff = effectiveForMonth(s, '2026-06');
        expect(eff.ellisSchedule).toEqual(s.ellis.schedule);
        expect(eff.taxFree).toBe(true);
        expect(eff.mil).toEqual([0, 0, 0, 100, 50]);
    });

    it('propagates an override forward to later months', () => {
        const s = baseSettings();
        s.monthOverrides = {
            '2026-06': { mil: [0, 0, 0, 50, 50] },
        };
        const may = effectiveForMonth(s, '2026-05');
        const june = effectiveForMonth(s, '2026-06');
        const aug = effectiveForMonth(s, '2026-08');
        expect(may.mil).toEqual([0, 0, 0, 100, 50]);   // before override → default
        expect(june.mil).toEqual([0, 0, 0, 50, 50]);   // override applies
        expect(aug.mil).toEqual([0, 0, 0, 50, 50]);    // and propagates forward
    });

    it('a later override supersedes an earlier one from its month onwards', () => {
        const s = baseSettings();
        s.monthOverrides = {
            '2026-06': { mil: [0, 0, 0, 50, 50] },
            '2026-08': { mil: [0, 0, 0, 100, 100] },
        };
        const july = effectiveForMonth(s, '2026-07');
        const aug  = effectiveForMonth(s, '2026-08');
        expect(july.mil).toEqual([0, 0, 0, 50, 50]);
        expect(aug.mil).toEqual([0, 0, 0, 100, 100]);
    });
});
