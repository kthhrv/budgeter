// Daily burn-down of the joint buffer over the PAY cycle, not the calendar
// month: the buffer refills on pay day (the 28th), so a period runs from the
// 28th of one month to the 27th of the next. The buffer is spread evenly over
// the period's days — £500 over a 31-day period burns ~£16.13/day: £484 after
// the first day, £468 after the second, £0 after the last.

export const RESET_DAY = 28; // pay day — the buffer refills on the 28th

// Calendar-day arithmetic via UTC day numbers so BST/GMT transitions can't
// make a period a day short.
const dayNumber = (d) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);

/** The pay period containing `now`: { start, end (exclusive), totalDays, dayIndex }.
 *  dayIndex is 1 on the reset day itself. */
export const currentPeriod = (now = new Date()) => {
    const startMonth = now.getDate() >= RESET_DAY ? now.getMonth() : now.getMonth() - 1;
    const start = new Date(now.getFullYear(), startMonth, RESET_DAY);
    const end = new Date(now.getFullYear(), startMonth + 1, RESET_DAY);
    return {
        start,
        end,
        totalDays: dayNumber(end) - dayNumber(start),
        dayIndex: dayNumber(now) - dayNumber(start) + 1,
    };
};

/** The budget month this period funds — pay received on the 28th covers the
 *  FOLLOWING calendar month (the month the period mostly falls in). */
export const fundedMonthDate = (period) => new Date(period.end.getFullYear(), period.end.getMonth(), 1);

/** Expected remaining buffer after day `day` (1..D) of a D-day period. */
export const expectedRemaining = (buffer, day, totalDays) =>
    buffer * Math.max(0, totalDays - day) / totalDays;

/** The whole period's burn-down, one point per day:
 *  [{ day, date, label, expected }] — `label` is the calendar date, e.g. "28 Aug". */
export const dailyAllowanceSeries = (buffer, period) =>
    Array.from({ length: period.totalDays }, (_, i) => {
        const date = new Date(period.start.getFullYear(), period.start.getMonth(), period.start.getDate() + i);
        return {
            day: i + 1,
            date,
            label: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
            expected: expectedRemaining(buffer, i + 1, period.totalDays),
        };
    });
