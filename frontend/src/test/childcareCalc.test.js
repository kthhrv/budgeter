import { describe, it, expect } from 'vitest';
import { computeChildcare, childcareDayMarkers, termSessionTotals, termClubBills, CHILDCARE_RATES } from '../utils/childcareCalc';

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

describe('computeChildcare — late after-school slot (4:30–6:30)', () => {
    it('late is £12/day; Wednesdays only = 5 × £12 in Sep 2026', () => {
        const c = computeChildcare(cc({ afterSchool: { tfc: false, schedule: ['none', 'none', 'late', 'none', 'none'], overrides: {} } }), MONTH);
        expect(c.afterSchool.cost).toBeCloseTo(5 * CHILDCARE_RATES.afterSchool.late, 2); // £60
    });

    it('a late override on a none day adds one £12 session', () => {
        const c = computeChildcare(cc({ afterSchool: { tfc: false, schedule: ALL('none'), overrides: { '2026-09-03': 'late' } } }), MONTH);
        expect(c.afterSchool.cost).toBeCloseTo(12, 2);
    });
});

// French club: Tuesdays, £11/session, no TFC. Term-time Tuesdays (no
// nonTermDays loaded): autumn 15, spring 12, summer 14.
const FRENCH = { id: 'fr', name: 'French club', sessionRate: 11, tfc: false, schedule: [false, true, false, false, false], overrides: {} };

describe('computeChildcare — term-time clubs (monthly attendance)', () => {
    it('bills scheduled term weekdays at the session rate (4 Tuesdays in term-time Sep 2026)', () => {
        const c = computeChildcare(cc({ termClubs: [{ ...FRENCH }], nonTermDays: ['2026-09-01', '2026-09-02'] }), MONTH);
        expect(c.termClubs[0].sessions).toBe(4); // Sep 1 is a Tuesday but pre-term
        expect(c.termClubs[0].cost).toBeCloseTo(44, 2);
        expect(c.termClubs[0].saving).toBe(0); // no TFC
        expect(c.termClubMonthNet).toBeCloseTo(44, 2);
    });

    it('stays out of the gaspard_care/holiday nets', () => {
        const c = computeChildcare(cc({ termClubs: [{ ...FRENCH }] }), MONTH);
        expect(c.net).toBe(0);
        expect(c.termNet).toBe(0);
    });

    it('overrides add and remove sessions', () => {
        const c = computeChildcare(cc({
            termClubs: [{ ...FRENCH, overrides: { '2026-09-08': false, '2026-09-03': true } }],
        }), MONTH);
        // 5 scheduled Tuesdays − 1 skipped + 1 ad-hoc Thursday
        expect(c.termClubs[0].sessions).toBe(5);
    });

    it('marks attendance on the calendar, never on weekends or non-term days', () => {
        const markers = childcareDayMarkers(cc({ termClubs: [{ ...FRENCH }], nonTermDays: ['2026-09-08'] }), MONTH);
        expect(markers['2026-09-15'].termClubs).toEqual([{ id: 'fr', name: 'French club' }]);
        expect(markers['2026-09-08'].termClubs).toEqual([]); // non-term Tuesday
        expect(markers['2026-09-05'].termClubs).toEqual([]); // Saturday
    });
});

describe('termSessionTotals — whole-term invoice totals', () => {
    const AUTUMN = { name: 'Autumn 2026', start: '2026-09-03', end: '2026-12-18' };

    it('sums a term-time club across the term (15 Tuesdays in autumn 2026)', () => {
        const t = termSessionTotals(cc({ termClubs: [{ ...FRENCH }] }), AUTUMN);
        expect(t.clubs[0].sessions).toBe(15);
        expect(t.clubs[0].net).toBeCloseTo(165, 2);
    });

    it('excludes nonTermDays (half-term) from the term total', () => {
        const t = termSessionTotals(cc({ termClubs: [{ ...FRENCH }], nonTermDays: ['2026-10-20', '2026-10-27'] }), AUTUMN);
        expect(t.clubs[0].sessions).toBe(13);
    });

    it('totals the after-school invoice net of TFC', () => {
        const t = termSessionTotals(cc({ afterSchool: { tfc: true, schedule: ['none', 'long', 'none', 'none', 'none'], overrides: {} } }), AUTUMN);
        expect(t.afterSchool.sessions).toBe(15);
        expect(t.afterSchool.gross).toBeCloseTo(15 * 24, 2);
        expect(t.afterSchool.net).toBeCloseTo(15 * 24 * 0.8, 2);
    });
});

describe('termClubBills — the bill lands whole in the half-term start month', () => {
    // French club Tuesdays across the 2026/27 half-terms:
    // A1 6 (£66), A2 7 (£77), S1 6 (£66), S2 5 (£55), Sm1 7 (£77), Sm2 6 (£66).
    const settings = cc({ termClubs: [{ ...FRENCH }] });

    it('September carries the Autumn 1 bill', () => {
        const b = termClubBills(settings, '2026-09');
        expect(b.total).toBeCloseTo(66, 2);
        expect(b.bills[0].term.name).toBe('Autumn 1 2026');
        expect(b.next.dueMonth).toBe('2026-09');
    });

    it('October is zero, pointing at the Autumn 2 bill due in November', () => {
        const b = termClubBills(settings, '2026-10');
        expect(b.total).toBe(0);
        expect(b.bills).toEqual([]);
        expect(b.next.term.name).toBe('Autumn 2 2026');
        expect(b.next.total).toBeCloseTo(77, 2);
        expect(b.next.dueMonth).toBe('2026-11');
    });

    it('November carries the Autumn 2 bill and February the Spring 2 bill', () => {
        expect(termClubBills(settings, '2026-11').total).toBeCloseTo(77, 2);
        expect(termClubBills(settings, '2027-02').total).toBeCloseTo(55, 2);
    });

    it('past the last recorded half-term there is no bill and no next', () => {
        const b = termClubBills(settings, '2027-08');
        expect(b.total).toBe(0);
        expect(b.next).toBeNull();
    });

    it('is empty with no term clubs', () => {
        expect(termClubBills(cc(), '2026-09')).toEqual({ total: 0, bills: [], next: null });
    });
});
