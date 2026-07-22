import { describe, it, expect } from 'vitest';
import { computeChildcare, childcareDayMarkers, CHILDCARE_RATES } from '../utils/childcareCalc';

// September 2026 has 22 weekdays: Mon×4, Tue×5, Wed×5, Thu×4, Fri×4.
const MONTH = '2026-09';
const ALL = (v) => [v, v, v, v, v];

const cc = (over = {}) => ({
    childcare: {
        startMonth: '2026-09',
        nonTermDays: [],
        breakfast:   { tfc: true, schedule: ALL(false), overrides: {} },
        afterSchool: { tfc: true, schedule: ALL('none'), overrides: {} },
        holidayClubs: [],
        ...over,
    },
});

describe('computeChildcare — breakfast', () => {
    it('costs each term weekday at £5 (22 weekdays in Sep 2026)', () => {
        const c = computeChildcare(cc({ breakfast: { tfc: false, schedule: ALL(true), adhoc: [] } }), MONTH);
        expect(c.breakfast.cost).toBeCloseTo(22 * CHILDCARE_RATES.breakfast, 2); // £110
        expect(c.breakfast.saving).toBe(0);
    });

    it('applies 20% TFC when enabled', () => {
        const c = computeChildcare(cc({ breakfast: { tfc: true, schedule: ALL(true), overrides: {} } }), MONTH);
        expect(c.breakfast.saving).toBeCloseTo(c.breakfast.cost * 0.20, 2);
    });

    it('an override to attend on a non-scheduled weekday adds one day', () => {
        const c = computeChildcare(cc({ breakfast: { tfc: false, schedule: ALL(false), overrides: { '2026-09-03': true } } }), MONTH);
        expect(c.breakfast.cost).toBeCloseTo(5, 2);
    });

    it('an override to skip a recurring day removes it', () => {
        const c = computeChildcare(cc({ breakfast: { tfc: false, schedule: ALL(true), overrides: { '2026-09-03': false } } }), MONTH);
        expect(c.breakfast.cost).toBeCloseTo(21 * 5, 2); // one Thursday removed
    });
});

describe('computeChildcare — month-scoped weekly pattern (forward-fill)', () => {
    it('a pattern set for a later month applies from that month, not before', () => {
        const s = cc({
            breakfast: { tfc: false, schedule: ALL(true), overrides: {} }, // baseline: every weekday
            patterns: { '2026-10': { breakfast: ALL(false) } },            // October onward: none
        });
        expect(computeChildcare(s, '2026-09').breakfast.cost).toBeGreaterThan(0); // baseline still applies in Sep
        expect(computeChildcare(s, '2026-10').breakfast.cost).toBe(0);            // October uses its own pattern
        expect(computeChildcare(s, '2026-11').breakfast.cost).toBe(0);            // and forward-fills to Nov
    });
});

describe('computeChildcare — after-school', () => {
    it('long (3:15–6:30) is £24/day; Tuesdays only = 5 × £24', () => {
        const c = computeChildcare(cc({ afterSchool: { tfc: false, schedule: ['none', 'long', 'none', 'none', 'none'], adhoc: [] } }), MONTH);
        expect(c.afterSchool.cost).toBeCloseTo(5 * 24, 2);
    });

    it('short (3:15–4:30) is £12/day', () => {
        const c = computeChildcare(cc({ afterSchool: { tfc: false, schedule: ['short', 'none', 'none', 'none', 'none'], adhoc: [] } }), MONTH);
        expect(c.afterSchool.cost).toBeCloseTo(4 * 12, 2); // 4 Mondays
    });
});

describe('computeChildcare — non-term exclusion', () => {
    it('marking the whole month non-term drops recurring breakfast to £0', () => {
        const nonTerm = Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
        const c = computeChildcare(cc({ nonTermDays: nonTerm, breakfast: { tfc: false, schedule: ALL(true), overrides: {} } }), MONTH);
        expect(c.breakfast.cost).toBe(0);
    });

    it('ignores a breakfast override placed on a non-term day', () => {
        const c = computeChildcare(cc({
            nonTermDays: ['2026-09-03'],
            breakfast: { tfc: false, schedule: ALL(false), overrides: { '2026-09-03': true } },
        }), MONTH);
        expect(c.breakfast.cost).toBe(0);
    });
});

describe('computeChildcare — holiday clubs (auto week rate)', () => {
    const club = (over) => ({ id: 1, name: 'Camp', dayRate: 40, weekRate: 150, tfc: false, days: [], ...over });

    it('a full Mon–Fri week bills the week rate', () => {
        const days = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']; // Mon–Fri
        const c = computeChildcare(cc({ holidayClubs: [club({ days })] }), MONTH);
        expect(c.holidayClubs[0].cost).toBeCloseTo(150, 2);
    });

    it('a partial week bills the day rate × days', () => {
        const c = computeChildcare(cc({ holidayClubs: [club({ days: ['2026-09-07', '2026-09-08'] })] }), MONTH);
        expect(c.holidayClubs[0].cost).toBeCloseTo(2 * 40, 2);
    });

    it('full week + 2 extra days in another week = week rate + 2 × day rate', () => {
        const days = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-14', '2026-09-15'];
        const c = computeChildcare(cc({ holidayClubs: [club({ days })] }), MONTH);
        expect(c.holidayClubs[0].cost).toBeCloseTo(150 + 2 * 40, 2);
    });

    it('per-club TFC knocks 20% off only that club', () => {
        const c = computeChildcare(cc({
            holidayClubs: [club({ tfc: true, days: ['2026-09-07', '2026-09-08'] })],
        }), MONTH);
        expect(c.holidayClubs[0].saving).toBeCloseTo(80 * 0.20, 2);
    });
});

describe('computeChildcare — nets split into two budget lines', () => {
    it('termNet = breakfast + after-school; holidayNet separate; net = sum', () => {
        const c = computeChildcare(cc({
            breakfast:   { tfc: false, schedule: ALL(true), adhoc: [] },
            afterSchool: { tfc: false, schedule: ['long', 'none', 'none', 'none', 'none'], adhoc: [] },
            holidayClubs: [{ id: 1, name: 'Camp', dayRate: 40, weekRate: 150, tfc: false, days: ['2026-09-07', '2026-09-08'] }],
        }), MONTH);
        expect(c.termNet).toBeCloseTo(c.breakfast.cost + c.afterSchool.cost, 2);
        expect(c.holidayNet).toBeCloseTo(80, 2);
        expect(c.net).toBeCloseTo(c.termNet + c.holidayNet, 2);
    });
});

describe('childcareDayMarkers', () => {
    it('flags non-term days, breakfast, after-school option and club assignments', () => {
        const m = childcareDayMarkers(cc({
            nonTermDays: ['2026-09-07'],
            breakfast: { tfc: false, schedule: [false, true, false, false, false], adhoc: [] }, // Tue
            afterSchool: { tfc: false, schedule: ['none', 'none', 'long', 'none', 'none'], adhoc: [] }, // Wed
            holidayClubs: [{ id: 9, name: 'Camp', dayRate: 0, weekRate: 0, tfc: false, days: ['2026-09-07'] }],
        }), MONTH);
        expect(m['2026-09-07'].nonTerm).toBe(true);
        expect(m['2026-09-07'].clubs.map(c => c.id)).toContain(9);
        expect(m['2026-09-08'].breakfast).toBe(true);   // a Tuesday
        expect(m['2026-09-02'].afterSchool).toBe('long'); // a Wednesday
    });
});
