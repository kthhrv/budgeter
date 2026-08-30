import { describe, it, expect } from 'vitest';
import {
    effectiveEarnings, monthlyPensionContribution,
    currentWealth, buildNetWorthHistory,
    monthlySpendingForView, monthlySavingsForView,
    fiNumber, projectWealth, findFiCrossing, coastNumber,
    savingsRate, ageAt, mortgageStats, amortiseMortgage,
} from '../utils/fireCalc';

const account = (owner, kind, snapshots) => ({
    id: `${owner}-${kind}`, name: kind, owner, kind, provider: '',
    // API returns snapshots newest-first
    snapshots: snapshots.map(([date, balance]) => ({ id: date, date, balance, source: 'manual' })),
});

describe('effectiveEarnings', () => {
    const versions = [
        { owner: 'tild', effective_from: '2026-04-01', gross_annual_salary: 60000 },
        { owner: 'tild', effective_from: '2025-04-01', gross_annual_salary: 55000 },
        { owner: 'keith', effective_from: '2025-01-01', gross_annual_salary: 50000 },
    ];

    it('picks the newest version on or before the date', () => {
        expect(effectiveEarnings(versions, 'tild', '2026-08-01').gross_annual_salary).toBe(60000);
        expect(effectiveEarnings(versions, 'tild', '2026-03-31').gross_annual_salary).toBe(55000);
    });

    it('returns null before the first version', () => {
        expect(effectiveEarnings(versions, 'tild', '2024-01-01')).toBeNull();
    });

    it('filters by owner', () => {
        expect(effectiveEarnings(versions, 'keith', '2026-08-01').gross_annual_salary).toBe(50000);
    });
});

describe('monthlyPensionContribution', () => {
    it('sums employee and employer percentages of gross', () => {
        const earnings = { gross_annual_salary: 60000, employee_pension_pct: 5, employer_pension_pct: 3 };
        expect(monthlyPensionContribution(earnings)).toBeCloseTo(60000 * 0.08 / 12);
    });

    it('is zero without earnings', () => {
        expect(monthlyPensionContribution(null)).toBe(0);
    });
});

describe('currentWealth', () => {
    const accounts = [
        account('tild', 'pension', [['2026-08-01', 40000]]),
        account('tild', 'isa', [['2026-08-01', 15000], ['2026-07-01', 14000]]),
        account('keith', 'pension', [['2026-08-01', 30000]]),
        account('shared', 'cash', [['2026-08-01', 5000]]),
    ];

    it('splits pension from accessible using latest balances', () => {
        const joint = currentWealth(accounts, 'joint');
        expect(joint.pension).toBe(70000);
        expect(joint.accessible).toBe(20000);
        expect(joint.total).toBe(90000);
    });

    it('per-person view includes own and shared accounts only', () => {
        const tild = currentWealth(accounts, 'tild');
        expect(tild.pension).toBe(40000);
        expect(tild.accessible).toBe(20000); // own ISA + shared cash
    });

    it('ignores accounts with no snapshots', () => {
        const w = currentWealth([account('tild', 'isa', [])], 'joint');
        expect(w.total).toBe(0);
    });
});

describe('buildNetWorthHistory', () => {
    it('carries balances forward into months without a snapshot', () => {
        const accounts = [
            account('tild', 'isa', [['2026-08-15', 300], ['2026-06-01', 100]]),
            account('tild', 'pension', [['2026-07-01', 1000]]),
        ];
        const history = buildNetWorthHistory(accounts, 'joint');
        expect(history.map(h => h.month)).toEqual(['2026-06', '2026-07', '2026-08']);
        // June: ISA only (pension has no snapshot yet)
        expect(history[0]).toMatchObject({ accessible: 100, pension: 0, total: 100 });
        // July: ISA carried forward + pension appears
        expect(history[1]).toMatchObject({ accessible: 100, pension: 1000, total: 1100 });
        // August: new ISA balance, pension carried forward
        expect(history[2]).toMatchObject({ accessible: 300, pension: 1000, total: 1300 });
    });

    it('returns empty for no snapshots', () => {
        expect(buildNetWorthHistory([account('tild', 'isa', [])], 'joint')).toEqual([]);
    });
});

describe('spending and savings per view', () => {
    // Minimal computeBudgetTotals-shaped input
    const t = {
        sharedExpenseTotal: 2000,
        keithDirectExpenses: 300, tildDirectExpenses: 200,
        keithProportion: 0.6, tildProportion: 0.4,
        keithSavings: 100, tildSavings: 150, sharedSavings: 500,
    };

    it('joint spending is shared plus both direct', () => {
        expect(monthlySpendingForView(t, 'joint')).toBe(2500);
    });

    it('per-person spending shares joint costs by salary proportion', () => {
        expect(monthlySpendingForView(t, 'keith')).toBeCloseTo(300 + 1200);
        expect(monthlySpendingForView(t, 'tild')).toBeCloseTo(200 + 800);
    });

    it('savings split shared by proportion in per-person views', () => {
        expect(monthlySavingsForView(t, 'joint')).toBe(750);
        expect(monthlySavingsForView(t, 'keith')).toBeCloseTo(100 + 300);
        expect(monthlySavingsForView(t, 'tild')).toBeCloseTo(150 + 200);
    });
});

describe('fiNumber', () => {
    it('is 25x annual spending at a 4% SWR', () => {
        expect(fiNumber(30000, 4)).toBe(750000);
    });

    it('is Infinity at a zero SWR', () => {
        expect(fiNumber(30000, 0)).toBe(Infinity);
    });
});

describe('projectWealth', () => {
    it('compounds monthly and adds contributions', () => {
        const series = projectWealth({
            pensionStart: 10000, accessibleStart: 5000,
            monthlyPension: 100, monthlyAccessible: 50,
            annualRealReturnPct: 12, years: 1, startDate: new Date(2026, 7, 15),
        });
        expect(series).toHaveLength(13);
        expect(series[0]).toMatchObject({ date: '2026-08', pension: 10000, accessible: 5000, total: 15000 });
        // One month at (1.12)^(1/12)-1 ≈ 0.9489% plus the contribution
        const monthlyRate = Math.pow(1.12, 1 / 12) - 1;
        expect(series[1].pension).toBe(Math.round(10000 * (1 + monthlyRate) + 100));
        expect(series[1].date).toBe('2026-09');
        expect(series[12].date).toBe('2027-08');
    });

    it('grows to roughly the analytic future value over 10 years', () => {
        const series = projectWealth({
            pensionStart: 0, accessibleStart: 100000,
            monthlyPension: 0, monthlyAccessible: 0,
            annualRealReturnPct: 5, years: 10,
        });
        expect(series.at(-1).total).toBeCloseTo(100000 * Math.pow(1.05, 10), -1);
    });
});

describe('findFiCrossing', () => {
    it('finds the first point at or over the target', () => {
        const series = [{ total: 10 }, { total: 20 }, { total: 30 }];
        expect(findFiCrossing(series, 20)).toBe(series[1]);
    });

    it('returns null when never reached', () => {
        expect(findFiCrossing([{ total: 10 }], 50)).toBeNull();
    });
});

describe('coastNumber', () => {
    it('discounts the FI number back by the growth over remaining years', () => {
        expect(coastNumber(750000, 5, 10)).toBeCloseTo(750000 / Math.pow(1.05, 10));
    });

    it('equals the FI number with no years left', () => {
        expect(coastNumber(750000, 5, 0)).toBe(750000);
    });
});

describe('savingsRate and ageAt', () => {
    it('computes savings rate', () => {
        expect(savingsRate(1000, 4000)).toBe(0.25);
        expect(savingsRate(1000, 0)).toBe(0);
    });

    it('computes age respecting the birthday', () => {
        expect(ageAt('1990-05-10', new Date(2026, 4, 9))).toBe(35);  // day before 36th birthday
        expect(ageAt('1990-05-10', new Date(2026, 4, 10))).toBe(36); // on the birthday
        expect(ageAt(null, new Date())).toBeNull();
    });
});

describe('mortgage', () => {
    const mortgage = {
        property_value: 400000, balance: 250000, balance_date: '2026-08-01',
        interest_rate_pct: 4.8, monthly_payment: 2000,
    };

    it('computes equity and LTV', () => {
        const stats = mortgageStats(mortgage);
        expect(stats.equity).toBe(150000);
        expect(stats.equityPct).toBeCloseTo(37.5);
        expect(stats.ltvPct).toBeCloseTo(62.5);
    });

    it('amortises to a payoff date', () => {
        const { schedule, payoffDate } = amortiseMortgage(mortgage);
        expect(schedule[0]).toEqual({ date: '2026-08', balance: 250000 });
        // 250k at 4.8% with £2000/mo pays off in roughly 16-17 years
        expect(payoffDate).not.toBeNull();
        const years = parseInt(payoffDate.slice(0, 4)) - 2026;
        expect(years).toBeGreaterThan(14);
        expect(years).toBeLessThan(19);
        expect(schedule.at(-1).balance).toBe(0);
    });

    it('gives no payoff date when the payment does not cover interest', () => {
        const { payoffDate } = amortiseMortgage({ ...mortgage, monthly_payment: 100 });
        expect(payoffDate).toBeNull();
    });
});
