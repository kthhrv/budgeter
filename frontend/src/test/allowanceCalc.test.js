import { describe, it, expect } from 'vitest';
import { daysInMonth, expectedRemaining, dailyAllowanceSeries } from '../utils/allowanceCalc';

describe('allowanceCalc', () => {
    it('knows month lengths', () => {
        expect(daysInMonth(2026, 8)).toBe(31);
        expect(daysInMonth(2026, 2)).toBe(28);
        expect(daysInMonth(2028, 2)).toBe(29); // leap year
    });

    it('matches the £500-over-31-days example', () => {
        // ~£484 after the 1st, ~£468 after the 2nd, £0 after the last day
        expect(expectedRemaining(500, 1, 31)).toBeCloseTo(483.87, 1);
        expect(expectedRemaining(500, 2, 31)).toBeCloseTo(467.74, 1);
        expect(expectedRemaining(500, 31, 31)).toBe(0);
    });

    it('never goes negative past month end', () => {
        expect(expectedRemaining(500, 40, 31)).toBe(0);
    });

    it('builds one point per day', () => {
        const series = dailyAllowanceSeries(500, 2026, 8);
        expect(series).toHaveLength(31);
        expect(series[0]).toEqual({ day: 1, expected: expectedRemaining(500, 1, 31) });
        expect(series.at(-1).expected).toBe(0);
    });
});
