import { describe, it, expect } from 'vitest';
import {
    computeMonthSummary, effectiveForMonth, applyChildcareLinks,
    tfcSavingForMonth, TFC_QUARTERLY_CAP, ageBracketFor, ELLIS_DOB,
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

    it('always applies tax-free childcare, ignoring any stored taxFree=false flag', () => {
        // The billing toggle was removed: tax-free is now always on regardless
        // of what a legacy saved blob carries.
        const s = baseSettings();
        s.taxFree = false;
        const summary = computeMonthSummary(s, new Date(2026, 5, 1));
        expect(summary.totalTFC).toBeCloseTo(summary.totalInvoiced * 0.80, 2);
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

describe('applyChildcareLinks', () => {
    const NETS = { ellis_nursery: 250.50, gaspard_care: 111.11 };
    const baseItem = (overrides = {}) => ({
        budget_item_id: 'a',
        item_name: 'Nursery',
        item_type: 'expense',
        owner: 'shared',
        effective_value: 999,
        childcare_link: '',
        is_one_off: false,
        effective_from_month_name: 'June 2026',
        ...overrides,
    });

    it('does not modify items that are not linked', () => {
        const items = [baseItem({ childcare_link: '', effective_value: 50 })];
        const out = applyChildcareLinks(items, NETS, 'June 2026');
        expect(out[0].effective_value).toBe(50);
    });

    it('routes ellis_nursery items to the Ellis net', () => {
        const items = [baseItem({ childcare_link: 'ellis_nursery', effective_value: 999 })];
        const out = applyChildcareLinks(items, NETS, 'June 2026');
        expect(out[0].effective_value).toBe(250.50);
    });

    it('routes gaspard_care items to the Gaspard-care net', () => {
        const items = [baseItem({ childcare_link: 'gaspard_care', effective_value: 999 })];
        const out = applyChildcareLinks(items, NETS, 'June 2026');
        expect(out[0].effective_value).toBe(111.11);
    });

    it('preserves a per-month one-off override (linked, is_one_off, month matches)', () => {
        const items = [baseItem({
            childcare_link: 'ellis_nursery',
            is_one_off: true,
            effective_from_month_name: 'June 2026',
            effective_value: 100,
        })];
        const out = applyChildcareLinks(items, NETS, 'June 2026');
        expect(out[0].effective_value).toBe(100);
    });

    it('still substitutes when is_one_off=true but month does not match', () => {
        const items = [baseItem({
            childcare_link: 'ellis_nursery',
            is_one_off: true,
            effective_from_month_name: 'May 2026',
            effective_value: 100,
        })];
        const out = applyChildcareLinks(items, NETS, 'June 2026');
        expect(out[0].effective_value).toBe(250.50);
    });

    it('returns items unchanged when nets is null (settings not yet loaded)', () => {
        const items = [baseItem({ childcare_link: 'ellis_nursery', effective_value: 999 })];
        const out = applyChildcareLinks(items, null, 'June 2026');
        expect(out[0].effective_value).toBe(999);
    });
});

describe('TFC entitlement periods (per-child, payment-date based)', () => {
    // Payment is made on the 28th of the month before attendance. Periods are
    // 3 consecutive payment months anchored per child:
    //   Gaspard (20th, phase May): the 28th falls AFTER his reset, so payment
    //     buckets start in his anchor months — May/Aug/Nov/Feb → attendance
    //     periods Jun–Aug, Sep–Nov, Dec–Feb, Mar–May.
    //   Ellis (31st, phase Jan): the 28th falls BEFORE his reset, so an
    //     anchor-month payment still draws on the outgoing period — payment
    //     buckets Feb–Apr, May–Jul, Aug–Oct, Nov–Jan → attendance periods
    //     Mar–May, Jun–Aug, Sep–Nov, Dec–Feb.
    it("Gaspard's Jun–Aug attendance share one period; August is the 3rd month", () => {
        const aug = tfcSavingForMonth(baseSettings(), '2026-08');
        expect(aug.gaspardPeriodMonths).toEqual(['2026-06', '2026-07', '2026-08']);
    });

    it("Ellis's August payment (28 Jul) precedes the 31 Jul reset — August closes its period", () => {
        const aug = tfcSavingForMonth(baseSettings(), '2026-08');
        expect(aug.ellisPeriodMonths).toEqual(['2026-06', '2026-07', '2026-08']);
    });

    it("Ellis's September payment (28 Aug) opens a fresh period", () => {
        const sep = tfcSavingForMonth(baseSettings(), '2026-09');
        expect(sep.ellisPeriodMonths).toEqual(['2026-09']);
        expect(sep.ellisUsedBefore).toBe(0);
    });

    it("Ellis's Mar–May attendance share the prior period", () => {
        const may = tfcSavingForMonth(baseSettings(), '2026-05');
        expect(may.ellisPeriodMonths).toEqual(['2026-03', '2026-04', '2026-05']);
        const jul = tfcSavingForMonth(baseSettings(), '2026-07');
        expect(jul.ellisPeriodMonths).toEqual(['2026-06', '2026-07']);
    });

    it('the children share attendance buckets but sit in different HMRC windows', () => {
        const aug = tfcSavingForMonth(baseSettings(), '2026-08');
        expect(aug.ellisPeriodLabel).not.toBe(aug.gaspardPeriodLabel);
    });

    it("Ellis's HMRC window for Sep–Nov attendance is 31 Jul – 30 Oct", () => {
        const sep = tfcSavingForMonth(baseSettings(), '2026-09');
        expect(sep.ellisPeriodLabel).toBe('31 Jul – 30 Oct 2026');
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
        // Both children's next period starts at Sep attendance (Gaspard's
        // 28 Aug payment follows his 20 Aug reset; Ellis's follows his 31 Jul one).
        const sep = tfcSavingForMonth(baseSettings(), '2026-09');
        expect(sep.gaspardUsedBefore).toBe(0);
        expect(sep.ellisUsedBefore).toBe(0);
    });

    it('Ellis: Sep–Nov 2026 accumulates and clips November (the reported shortfall)', () => {
        const s = baseSettings();
        const sep = tfcSavingForMonth(s, '2026-09');
        const oct = tfcSavingForMonth(s, '2026-10');
        const nov = tfcSavingForMonth(s, '2026-11');
        expect(sep.ellisUsedBefore).toBe(0);
        expect(oct.ellisUsedBefore).toBeCloseTo(sep.ellisSaving, 2);
        expect(nov.ellisUsedBefore).toBeCloseTo(sep.ellisSaving + oct.ellisSaving, 2);
        // November's payment (28 Oct) is the 3rd in the 31 Jul – 30 Oct window,
        // so its saving is clipped to whatever is left of the £500 cap.
        const novInvoiced = computeMonthSummary(s, new Date(2026, 10, 1)).ellisInvoiced;
        expect(nov.ellisSaving).toBeLessThan(novInvoiced * 0.20);
        expect(nov.ellisSaving).toBeCloseTo(TFC_QUARTERLY_CAP - nov.ellisUsedBefore, 2);
        // December's payment (28 Nov) lands after the 31 Oct reset — fresh £500.
        const dec = tfcSavingForMonth(s, '2026-12');
        expect(dec.ellisUsedBefore).toBe(0);
        expect(dec.ellisPeriodMonths).toEqual(['2026-12']);
    });

    it('tfcSavingForMonth accumulates consumed savings across a period (Gaspard Jun→Jul→Aug)', () => {
        const jun = tfcSavingForMonth(baseSettings(), '2026-06');
        const jul = tfcSavingForMonth(baseSettings(), '2026-07');
        const aug = tfcSavingForMonth(baseSettings(), '2026-08');
        expect(jun.gaspardUsedBefore).toBe(0);
        expect(jul.gaspardUsedBefore).toBeCloseTo(jun.gaspardSaving, 2);
        expect(aug.gaspardUsedBefore).toBeCloseTo(jun.gaspardSaving + jul.gaspardSaving, 2);
    });

    it('ignores legacy billing overrides — tax-free is always applied', () => {
        // A stale `billing` override that tried to turn taxFree off for June is
        // now inert, so June still consumes part of the cap.
        const s = baseSettings();
        s.monthOverrides = {
            '2026-06': { billing: { taxFree: false, fullWeekModel: true } },
        };
        const jun = tfcSavingForMonth(s, '2026-06');
        const jul = tfcSavingForMonth(s, '2026-07');
        expect(jun.gaspardSaving).toBeGreaterThan(0);
        expect(jul.gaspardUsedBefore).toBeCloseTo(jun.gaspardSaving, 2);
    });
});

describe('effectiveForMonth', () => {
    it('pins full-week attendance and the fixed billing model', () => {
        const s = baseSettings();
        const eff = effectiveForMonth(s, '2026-06');
        expect(eff.ellisSchedule).toEqual(['fullDay', 'fullDay', 'fullDay', 'fullDay', 'fullDay']);
        expect(eff.taxFree).toBe(true);
        expect(eff.fullWeekModel).toBe(true);
    });

    it('ignores stored schedule overrides — attendance is always full week', () => {
        const s = baseSettings();
        s.monthOverrides = {
            '2026-06': { ellis: { schedule: ['none', 'none', 'none', 'none', 'none'] } },
        };
        const june = effectiveForMonth(s, '2026-06');
        expect(june.ellisSchedule).toEqual(['fullDay', 'fullDay', 'fullDay', 'fullDay', 'fullDay']);
    });
});

describe('nursery → childcare switchover at startMonth', () => {
    // Full-time breakfast recurring so the childcare net is clearly non-zero.
    const s = () => ({
        ...baseSettings(),
        childcare: {
            startMonth: '2026-09',
            nonTermDays: [],
            breakfast:   { tfc: true, schedule: [true, true, true, true, true], adhoc: [] },
            afterSchool: { tfc: true, schedule: ['none', 'none', 'none', 'none', 'none'], adhoc: [] },
            holidayClubs: [{ id: 1, name: 'Camp', dayRate: 40, weekRate: 150, tfc: false, days: ['2026-09-05'] }],
        },
    });

    it('Gaspard bills nursery in Aug 2026 but not from Sep 2026', () => {
        const aug = computeMonthSummary(s(), new Date(2026, 7, 1));
        const sep = computeMonthSummary(s(), new Date(2026, 8, 1));
        expect(aug.gaspardInvoiced).toBeGreaterThan(0);
        expect(sep.gaspardInvoiced).toBe(0);
        // totalTFC (nursery) is Ellis-only from Sep.
        expect(sep.totalTFC).toBeCloseTo(sep.ellisNurseryNet, 2);
    });

    it('routes the two childcare budget lines: nursery→care pre-Sep, split post-Sep', () => {
        const aug = computeMonthSummary(s(), new Date(2026, 7, 1));
        const sep = computeMonthSummary(s(), new Date(2026, 8, 1));
        // Pre-switch: care line tracks his nursery net; holiday line is 0.
        expect(aug.gaspardCareNet).toBeCloseTo(aug.gaspardTFC, 2);
        expect(aug.gaspardHolidayNet).toBe(0);
        // Post-switch: care line = breakfast/after-school net; holiday line separate.
        expect(sep.gaspardCareNet).toBeGreaterThan(0);
        expect(sep.gaspardHolidayNet).toBeGreaterThan(0); // one non-term Sat day @ £40
    });
});

describe('ageBracketFor (Ellis, born 23 May 2024)', () => {
    it('moves brackets the month after each birthday', () => {
        expect(ageBracketFor(ELLIS_DOB, '2026-04')).toBe('0-2'); // still 1 on 1 Apr 2026
        expect(ageBracketFor(ELLIS_DOB, '2026-05')).toBe('0-2'); // turns 2 on the 23rd — 1 on the 1st
        expect(ageBracketFor(ELLIS_DOB, '2026-06')).toBe('2-3');
        expect(ageBracketFor(ELLIS_DOB, '2027-05')).toBe('2-3'); // turns 3 on the 23rd
        expect(ageBracketFor(ELLIS_DOB, '2027-06')).toBe('3-5');
        expect(ageBracketFor(ELLIS_DOB, '2028-01')).toBe('3-5');
    });

    it('drives the effective settings regardless of the stored bracket', () => {
        const s = baseSettings();
        s.ellis.ageBracket = '0-2'; // stale stored value
        expect(effectiveForMonth(s, '2026-06').ellis.ageBracket).toBe('2-3');
        expect(effectiveForMonth(s, '2027-07').ellis.ageBracket).toBe('3-5');
    });
});
