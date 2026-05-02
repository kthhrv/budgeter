import { describe, it, expect } from 'vitest';
import { computeMonthSummary, effectiveForMonth } from '../utils/nurseryCalc';

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
