// Daily burn-down of the joint buffer: the buffer is spread evenly over the
// days of the month, so "should have left" after day d of a D-day month is
// buffer × (D − d) / D — e.g. £500 over 31 days burns ~£16.13/day: £484 after
// the 1st, £468 after the 2nd, £0 after the last day.

/** Days in a calendar month (month is 1-12). */
export const daysInMonth = (year, month) => new Date(year, month, 0).getDate();

/** Expected remaining buffer after day `day` (1..D) of the month. */
export const expectedRemaining = (buffer, day, totalDays) =>
    buffer * Math.max(0, totalDays - day) / totalDays;

/** The whole month's burn-down, one point per day: [{ day, expected }]. */
export const dailyAllowanceSeries = (buffer, year, month) => {
    const totalDays = daysInMonth(year, month);
    return Array.from({ length: totalDays }, (_, i) => ({
        day: i + 1,
        expected: expectedRemaining(buffer, i + 1, totalDays),
    }));
};
