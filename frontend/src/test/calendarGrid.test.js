import { describe, it, expect } from 'vitest';
import { monthWeeks, entriesByDay, withChildcareAmounts, ordinal, cadenceText } from '../utils/calendarGrid';

describe('monthWeeks', () => {
    it('starts on Monday and pads both ends', () => {
        // November 2026 starts on a Sunday and ends on a Monday.
        const weeks = monthWeeks(2026, 10);
        expect(weeks[0]).toEqual([null, null, null, null, null, null, '2026-11-01']);
        expect(weeks.at(-1)[0]).toBe('2026-11-30');
        expect(weeks.at(-1).slice(1).every(d => d === null)).toBe(true);
        expect(weeks.flat().filter(Boolean)).toHaveLength(30);
    });
});

describe('helpers', () => {
    it('groups entries by due date', () => {
        const out = entriesByDay([{ due_date: '2026-11-12', n: 1 }, { due_date: '2026-11-12', n: 2 }, { due_date: '2026-11-05', n: 3 }]);
        expect(out['2026-11-12']).toHaveLength(2);
        expect(out['2026-11-05'][0].n).toBe(3);
    });

    it('substitutes childcare figures only for linked entries', () => {
        const entries = [{ childcare_link: 'ellis_nursery', expected_amount: 1 }, { childcare_link: '', expected_amount: 5 }];
        expect(withChildcareAmounts(entries, { ellis_nursery: 812.5 }).map(e => e.expected_amount)).toEqual([812.5, 5]);
        expect(withChildcareAmounts(entries, null)).toBe(entries);
    });

    it('formats ordinals and cadences', () => {
        expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 31].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '31st']);
        expect(cadenceText({ cadence: 'monthly', usual_day: 12 })).toBe('usually the 12th');
        expect(cadenceText({ cadence: 'weekly', usual_weekday: 1 })).toBe('weekly on Monday');
    });
});
