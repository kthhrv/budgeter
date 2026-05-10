import { describe, it, expect } from 'vitest';
import {
    computeMonthSummary, effectiveForMonth, applyNurseryLink,
    tfcPeriodMonths, tfcSavingForMonth, TFC_QUARTERLY_CAP,
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

    it('applies 10% sibling discount to Gaspard', () => {
        const s = baseSettings();
        s.gaspard.siblingDiscount = true;
        s.ellis.siblingDiscount = false;
        const summary = computeMonthSummary(s, new Date(2026, 5, 1));
        // Both kids have identical schedules and ages 2-3 vs 3-5 (same rates),
        // so Gaspard should be ~90% of Ellis.
        expect(summary.gaspardInvoiced).toBeCloseTo(summary.ellisInvoiced * 0.9, 1);
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

describe('tfcPeriodMonths (attendance-aligned: payments are made one month ahead)', () => {
    it('groups Jun–Aug attendance into one period (May–Jul payment quarter)', () => {
        expect(tfcPeriodMonths('2026-06')).toEqual(['2026-06', '2026-07', '2026-08']);
        expect(tfcPeriodMonths('2026-08')).toEqual(['2026-06', '2026-07', '2026-08']);
    });
    it('groups Sep–Nov attendance into one period', () => {
        expect(tfcPeriodMonths('2026-10')).toEqual(['2026-09', '2026-10', '2026-11']);
    });
    it('Dec–Feb straddles the year boundary', () => {
        expect(tfcPeriodMonths('2026-12')).toEqual(['2026-12', '2027-01', '2027-02']);
        expect(tfcPeriodMonths('2027-02')).toEqual(['2026-12', '2027-01', '2027-02']);
    });
    it('groups Mar–May attendance into one period (Feb–Apr payment quarter)', () => {
        expect(tfcPeriodMonths('2026-04')).toEqual(['2026-03', '2026-04', '2026-05']);
        expect(tfcPeriodMonths('2026-05')).toEqual(['2026-03', '2026-04', '2026-05']);
    });
});

describe('TFC quarterly cap', () => {
    it('caps the per-child saving at £500 within a single 3-month period', () => {
        const jun = computeMonthSummary(baseSettings(), new Date(2026, 5, 1));
        const jul = computeMonthSummary(baseSettings(), new Date(2026, 6, 1));
        const aug = computeMonthSummary(baseSettings(), new Date(2026, 7, 1));
        const ellisSavingTotal   = jun.tfc.ellisSaving   + jul.tfc.ellisSaving   + aug.tfc.ellisSaving;
        const gaspardSavingTotal = jun.tfc.gaspardSaving + jul.tfc.gaspardSaving + aug.tfc.gaspardSaving;
        expect(ellisSavingTotal).toBeLessThanOrEqual(TFC_QUARTERLY_CAP + 1e-6);
        expect(gaspardSavingTotal).toBeLessThanOrEqual(TFC_QUARTERLY_CAP + 1e-6);
    });

    it('flags ellisCapped when the cap actually clipped the saving', () => {
        // With full default schedule, by August attendance (3rd month of the
        // Jun–Aug quarter) the cap is reached for both kids.
        const aug = computeMonthSummary(baseSettings(), new Date(2026, 7, 1));
        expect(aug.tfc.ellisCapped).toBe(true);
        expect(aug.tfc.gaspardCapped).toBe(true);
    });

    it('totalTFC equals invoice minus capped saving (more than 80% of invoice once capped)', () => {
        const aug = computeMonthSummary(baseSettings(), new Date(2026, 7, 1));
        expect(aug.totalTFC).toBeCloseTo(aug.totalInvoiced - aug.tfc.ellisSaving - aug.tfc.gaspardSaving, 2);
        // Capped: parent transfers MORE than the uncapped 80% baseline.
        expect(aug.totalTFC).toBeGreaterThan(aug.totalInvoiced * 0.80 - 1e-6);
    });

    it('resets at the start of the next period (Sep 2026 attendance starts fresh)', () => {
        const sep = computeMonthSummary(baseSettings(), new Date(2026, 8, 1));
        expect(sep.tfc.ellisUsedBefore).toBe(0);
        expect(sep.tfc.gaspardUsedBefore).toBe(0);
        expect(sep.tfc.ellisCapped).toBe(false);
    });

    it('May 2026 attendance is the LAST month of the Mar–May period (paid Apr)', () => {
        // Verifies the payment-shift: May invoice is paid in April, so it lives
        // in the Feb–Apr payment quarter / Mar–May attendance period.
        const may = tfcSavingForMonth(baseSettings(), '2026-05');
        expect(may.period).toEqual(['2026-03', '2026-04', '2026-05']);
        // Two prior months (Mar, Apr attendance) have already consumed cap.
        const mar = tfcSavingForMonth(baseSettings(), '2026-03');
        const apr = tfcSavingForMonth(baseSettings(), '2026-04');
        expect(may.ellisUsedBefore).toBeCloseTo(mar.ellisSaving + apr.ellisSaving, 2);
    });

    it('tfcSavingForMonth tracks consumed savings across the period (Jun→Jul→Aug)', () => {
        const jun = tfcSavingForMonth(baseSettings(), '2026-06');
        const jul = tfcSavingForMonth(baseSettings(), '2026-07');
        const aug = tfcSavingForMonth(baseSettings(), '2026-08');
        expect(jun.ellisUsedBefore).toBe(0);
        expect(jul.ellisUsedBefore).toBeCloseTo(jun.ellisSaving, 2);
        expect(aug.ellisUsedBefore).toBeCloseTo(jun.ellisSaving + jul.ellisSaving, 2);
    });

    it('does not consume cap from months where taxFree was off', () => {
        // Override taxFree off for June attendance only, then re-enable from July.
        const s = baseSettings();
        s.monthOverrides = {
            '2026-06': { billing: { taxFree: false, fullWeekModel: true } },
            '2026-07': { billing: { taxFree: true,  fullWeekModel: true } },
        };
        const jul = tfcSavingForMonth(s, '2026-07');
        expect(jul.ellisUsedBefore).toBe(0); // June contributed nothing.
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
