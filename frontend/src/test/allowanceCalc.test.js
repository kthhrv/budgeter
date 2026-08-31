import { describe, it, expect } from 'vitest';
import { RESET_DAY, currentPeriod, fundedMonthDate, expectedRemaining, dailyAllowanceSeries, weeklyBurndownSeries } from '../utils/allowanceCalc';

describe('currentPeriod', () => {
    it('starts on the 28th of the current month once pay day has passed', () => {
        const p = currentPeriod(new Date(2026, 7, 31)); // 31 Aug
        expect(p.start).toEqual(new Date(2026, 7, RESET_DAY));
        expect(p.end).toEqual(new Date(2026, 8, RESET_DAY));
        expect(p.totalDays).toBe(31); // 28 Aug → 27 Sep inclusive
        expect(p.dayIndex).toBe(4);   // 28th=1, 29th=2, 30th=3, 31st=4
    });

    it('starts on the previous month\'s 28th before pay day', () => {
        const p = currentPeriod(new Date(2026, 8, 27)); // 27 Sep — last day of the period
        expect(p.start).toEqual(new Date(2026, 7, RESET_DAY));
        expect(p.dayIndex).toBe(p.totalDays);
    });

    it('is 1 on the reset day itself', () => {
        expect(currentPeriod(new Date(2026, 8, 28)).dayIndex).toBe(1);
    });

    it('handles February and year boundaries', () => {
        const feb = currentPeriod(new Date(2027, 1, 10)); // 10 Feb 2027 → 28 Jan–27 Feb
        expect(feb.start).toEqual(new Date(2027, 0, 28));
        expect(feb.totalDays).toBe(31);
        const dec = currentPeriod(new Date(2026, 11, 30)); // 30 Dec → 28 Dec–27 Jan
        expect(dec.end).toEqual(new Date(2027, 0, 28));
        expect(dec.totalDays).toBe(31);
        const mar = currentPeriod(new Date(2027, 2, 1)); // 1 Mar → 28 Feb–27 Mar
        expect(mar.start).toEqual(new Date(2027, 1, 28));
        expect(mar.totalDays).toBe(28);
    });

    it('pay on the 28th funds the following calendar month', () => {
        const p = currentPeriod(new Date(2026, 7, 31)); // 28 Aug–27 Sep
        expect(fundedMonthDate(p)).toEqual(new Date(2026, 8, 1)); // September
    });
});

describe('expectedRemaining', () => {
    it('matches the £500-over-31-days example', () => {
        // ~£484 after day 1, ~£468 after day 2, £0 after the last day
        expect(expectedRemaining(500, 1, 31)).toBeCloseTo(483.87, 1);
        expect(expectedRemaining(500, 2, 31)).toBeCloseTo(467.74, 1);
        expect(expectedRemaining(500, 31, 31)).toBe(0);
    });

    it('never goes negative past the period end', () => {
        expect(expectedRemaining(500, 40, 31)).toBe(0);
    });
});

describe('dailyAllowanceSeries', () => {
    it('builds one point per period day with calendar labels', () => {
        const period = currentPeriod(new Date(2026, 7, 31)); // 28 Aug–27 Sep
        const series = dailyAllowanceSeries(500, period);
        expect(series).toHaveLength(31);
        expect(series[0].label).toBe('28 Aug');
        expect(series[0].expected).toBeCloseTo(483.87, 1);
        expect(series[4].label).toBe('1 Sept'); // en-GB short month for September
        expect(series.at(-1).label).toBe('27 Sept');
        expect(series.at(-1).expected).toBe(0);
    });
});

describe('weeklyBurndownSeries', () => {
    // Period 28 Aug – 27 Sep 2026: 28 Aug is a Friday. Fridays in the period:
    // 28 Aug, 4, 11, 18, 25 Sep = 5 shops.
    const period = currentPeriod(new Date(2026, 7, 31)); // day 4 of 31

    it('steps down one shop at a time on the shop weekday', () => {
        const { series, totalShops, shopsDone } = weeklyBurndownSeries(500, period, 5); // Friday
        expect(totalShops).toBe(5);
        expect(shopsDone).toBe(1); // only the 28 Aug shop has happened by the 31st
        expect(series[0]).toMatchObject({ label: '28 Aug', isShopDay: true, expected: 400 });
        // flat between shops
        expect(series[1].expected).toBe(400);
        expect(series[6].expected).toBe(400);
        // next Friday (4 Sep, day 8) drops another fifth
        expect(series[7]).toMatchObject({ isShopDay: true, expected: 300 });
        // last shop empties the pot
        expect(series.at(-1).expected).toBe(0);
    });

    it('converts the budget weekday convention (7=Sunday)', () => {
        const { series } = weeklyBurndownSeries(400, period, 7);
        const firstShop = series.find(d => d.isShopDay);
        expect(firstShop.date.getDay()).toBe(0); // JS Sunday
        expect(firstShop.label).toBe('30 Aug');
    });
});
