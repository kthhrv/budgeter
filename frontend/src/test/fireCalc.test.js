import { describe, it, expect } from 'vitest';
import {
    effectiveEarnings, monthlyPensionContribution,
    currentWealth, buildNetWorthHistory,
    monthlySpendingForView, monthlySavingsForView,
    fiNumber, projectWealth, findFiCrossing, coastNumber,
    savingsRate, ageAt, mortgageStats, amortiseMortgage, combineSchedules, aggregateLoans,
    annualIncomeTax, annualNI, monthlyTakeHome,
    monthsUntilAge, monthIndexOf, simulateLifecycle, findEarliestViableRetirement,
    netFromPensionWithdrawal, grossPensionWithdrawal,
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
    const property = { value: 400000, value_date: '2026-01-01' };
    const mortgage = {
        balance: 250000, balance_date: '2026-08-01',
        interest_rate_pct: 4.8, monthly_payment: 2000,
    };

    it('computes equity and LTV across all loans on the property', () => {
        const secondLoan = { balance: 50000, balance_date: '2026-08-01', interest_rate_pct: 6, monthly_payment: 400 };
        const stats = mortgageStats(property, [mortgage, secondLoan]);
        expect(stats.totalBalance).toBe(300000);
        expect(stats.equity).toBe(100000);
        expect(stats.equityPct).toBeCloseTo(25);
        expect(stats.ltvPct).toBeCloseTo(75);
    });

    it('handles a single loan', () => {
        const stats = mortgageStats(property, [mortgage]);
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

describe('UK income tax and NI', () => {
    it('taxes a basic-rate salary correctly', () => {
        // £30,000: (30000-12570) × 20% = £3,486
        expect(annualIncomeTax(30000)).toBeCloseTo(3486);
    });

    it('taxes a higher-rate salary correctly', () => {
        // £60,000: 37700 × 20% + (60000-12570-37700) × 40% = 7540 + 3892
        expect(annualIncomeTax(60000)).toBeCloseTo(11432);
    });

    it('tapers the personal allowance above £100k', () => {
        // £110,000: PA = 12570 - 5000 = 7570; taxable 102430
        // 37700 × 20% + (102430-37700) × 40% = 7540 + 25892
        expect(annualIncomeTax(110000)).toBeCloseTo(33432);
    });

    it('applies the additional rate above £125,140 taxable', () => {
        // £150,000: PA fully tapered; taxable 150000
        // 7540 + (125140-37700) × 40% + (150000-125140) × 45%
        expect(annualIncomeTax(150000)).toBeCloseTo(7540 + 34976 + 11187);
    });

    it('computes employee NI', () => {
        // £60,000: (50270-12570) × 8% + (60000-50270) × 2% = 3016 + 194.6
        expect(annualNI(60000)).toBeCloseTo(3210.6);
        expect(annualNI(10000)).toBe(0);
    });

    it('salary sacrifice reduces both tax and NI', () => {
        const base = { gross_annual_salary: 60000, employee_pension_pct: 10, employer_pension_pct: 0 };
        const sacrificed = monthlyTakeHome({ ...base, employee_pension_is_salary_sacrifice: true });
        const netPay = monthlyTakeHome({ ...base, employee_pension_is_salary_sacrifice: false });
        // Same income tax (both reduce taxable pay), but sacrifice saves NI on the £6,000: 2% × 6000 = £120/yr
        expect((sacrificed - netPay) * 12).toBeCloseTo(6000 * 0.02);
        // Sanity: £54,000 taxable → tax 9032, NI (sacrificed) on 54000 → 3090.6
        expect(sacrificed * 12).toBeCloseTo(60000 - 6000 - 9032 - 3090.6);
    });
});

describe('monthsUntilAge and monthIndexOf', () => {
    const start = new Date(2026, 7, 15); // Aug 2026

    it('counts months to a future birthday', () => {
        // Born Jun 1990 → turns 57 in Jun 2047 = 22 months short of 24 years
        expect(monthsUntilAge('1990-06-15', 57, start)).toBe((2047 - 2026) * 12 + (5 - 7));
    });

    it('clamps past ages to 0 and handles null DOB', () => {
        expect(monthsUntilAge('1950-01-01', 57, start)).toBe(0);
        expect(monthsUntilAge(null, 57, start)).toBeNull();
    });

    it('converts YYYY-MM to a month index', () => {
        expect(monthIndexOf('2026-08', start)).toBe(0);
        expect(monthIndexOf('2027-02', start)).toBe(6);
        expect(monthIndexOf('2026-06', start)).toBe(-2);
    });
});

describe('simulateLifecycle — the pension bridge', () => {
    const start = new Date(2026, 7, 1);
    // A person 10 years from pension access, spending £2,000/mo in retirement
    const basePerson = { pensionStart: 500000, monthlyContribution: 0, accessMonth: 120, statePensionMonth: null, statePensionMonthly: 0 };
    const baseParams = {
        accessibleStart: 0, monthlyAccessible: 0, annualRealReturnPct: 3,
        baseMonthlySpending: 2000, horizonMonths: 360, startDate: start,
    };

    it('fails when retiring with a locked pension and no accessible bridge', () => {
        const { viable } = simulateLifecycle({ ...baseParams, people: [basePerson], retirementMonth: 0 });
        expect(viable).toBe(false);
    });

    it('succeeds with the same wealth once accessible savings cover the bridge', () => {
        const { viable } = simulateLifecycle({
            ...baseParams, people: [basePerson], accessibleStart: 300000, retirementMonth: 0,
        });
        expect(viable).toBe(true);
    });

    it('succeeds when retirement waits until pension access', () => {
        const { viable } = simulateLifecycle({ ...baseParams, people: [basePerson], retirementMonth: 120 });
        expect(viable).toBe(true);
    });

    it('state pension income makes an otherwise-failing plan viable', () => {
        // Small pot, unlocked pension, spending £1,400/mo: fails without state pension
        const person = { pensionStart: 220000, monthlyContribution: 0, accessMonth: 0, statePensionMonth: null, statePensionMonthly: 0 };
        const params = { ...baseParams, baseMonthlySpending: 1400, horizonMonths: 480 };
        expect(simulateLifecycle({ ...params, people: [person], retirementMonth: 0 }).viable).toBe(false);
        const withSP = { ...person, statePensionMonth: 60, statePensionMonthly: 11973 / 12 };
        expect(simulateLifecycle({ ...params, people: [withSP], retirementMonth: 0 }).viable).toBe(true);
    });

    it('mortgage payoff reduces spending from the payoff month', () => {
        // Spending £2,500 incl. £1,000 mortgage that ends at month 24
        const person = { pensionStart: 480000, monthlyContribution: 0, accessMonth: 0, statePensionMonth: null, statePensionMonthly: 0 };
        const fails = simulateLifecycle({
            ...baseParams, people: [person], baseMonthlySpending: 2500, retirementMonth: 0, horizonMonths: 480,
        });
        const survives = simulateLifecycle({
            ...baseParams, people: [person], baseMonthlySpending: 2500, retirementMonth: 0, horizonMonths: 480,
            mortgages: [{ monthlyPayment: 1000, payoffMonth: 24 }],
        });
        expect(fails.viable).toBe(false);
        expect(survives.viable).toBe(true);
    });

    it('trajectory covers the horizon quarterly and shows drawdown', () => {
        const { trajectory } = simulateLifecycle({ ...baseParams, people: [basePerson], accessibleStart: 300000, retirementMonth: 0 });
        expect(trajectory[0].monthIndex).toBe(0);
        expect(trajectory.at(-1).monthIndex).toBe(360);
        // Accessible is being drawn during the bridge
        expect(trajectory[10].accessible).toBeLessThan(300000 * Math.pow(1.03, 3));
    });
});

describe('findEarliestViableRetirement', () => {
    const start = new Date(2026, 7, 1);

    it('finds a month between "too early" and the pension access age', () => {
        // Contributions build an accessible bridge over time; earliest viable
        // retirement should be > 0 and ≤ pension access (120)
        const params = {
            people: [{ pensionStart: 400000, monthlyContribution: 500, accessMonth: 120, statePensionMonth: null, statePensionMonthly: 0 }],
            accessibleStart: 20000, monthlyAccessible: 1500, annualRealReturnPct: 3,
            baseMonthlySpending: 1800, horizonMonths: 480, startDate: start,
        };
        const t = findEarliestViableRetirement(params);
        expect(t).toBeGreaterThan(0);
        expect(t).toBeLessThanOrEqual(120);
        // Consistency: viable at t, not viable at t-1
        expect(simulateLifecycle({ ...params, retirementMonth: t }).viable).toBe(true);
        expect(simulateLifecycle({ ...params, retirementMonth: t - 1 }).viable).toBe(false);
    });

    it('returns null when no retirement within the search window works', () => {
        const params = {
            people: [{ pensionStart: 0, monthlyContribution: 0, accessMonth: 0, statePensionMonth: null, statePensionMonthly: 0 }],
            accessibleStart: 0, monthlyAccessible: 0, annualRealReturnPct: 3,
            baseMonthlySpending: 2000, horizonMonths: 480, startDate: start,
        };
        expect(findEarliestViableRetirement(params)).toBeNull();
    });
});

describe('simulateLifecycle trajectory dates', () => {
    it('advances month by month from the start date', () => {
        const { trajectory } = simulateLifecycle({
            people: [{ pensionStart: 1000, monthlyContribution: 0, accessMonth: 0, statePensionMonth: null, statePensionMonthly: 0 }],
            accessibleStart: 100000, monthlyAccessible: 0, annualRealReturnPct: 3,
            baseMonthlySpending: 100, retirementMonth: 0, horizonMonths: 24,
            startDate: new Date(2026, 7, 1), // Aug 2026
        });
        expect(trajectory[0].date).toBe('2026-08');
        expect(trajectory[1].date).toBe('2026-11'); // quarterly
        expect(trajectory.at(-1).date).toBe('2028-08');
    });

    it('samples extra marker months on top of the quarterly grid', () => {
        const { trajectory } = simulateLifecycle({
            people: [{ pensionStart: 1000, monthlyContribution: 0, accessMonth: 7, statePensionMonth: null, statePensionMonthly: 0 }],
            accessibleStart: 100000, monthlyAccessible: 0, annualRealReturnPct: 3,
            baseMonthlySpending: 100, retirementMonth: 0, horizonMonths: 24,
            startDate: new Date(2026, 7, 1),
            extraSampleMonths: [7], // Mar 2027 — not a quarterly sample
        });
        expect(trajectory.some(p => p.date === '2027-03')).toBe(true);
    });
});

describe('combineSchedules', () => {
    it('sums loans that start on different dates and end at different payoffs', () => {
        const partOne = [
            { date: '2026-08', balance: 300 },
            { date: '2026-09', balance: 200 },
            { date: '2026-10', balance: 100 },
            { date: '2026-11', balance: 0 },
        ];
        const advance = [
            { date: '2026-09', balance: 50 },
            { date: '2026-10', balance: 0 },
        ];
        const combined = combineSchedules([partOne, advance]);
        expect(combined).toEqual([
            { date: '2026-08', balance: 350 }, // advance not started: contributes opening balance
            { date: '2026-09', balance: 250 },
            { date: '2026-10', balance: 100 },
            { date: '2026-11', balance: 0 },   // advance ended: contributes its final 0
        ]);
    });

    it('is empty with no schedules', () => {
        expect(combineSchedules([])).toEqual([]);
        expect(combineSchedules([[]])).toEqual([]);
    });
});

describe('simulateLifecycle with two loans', () => {
    it('drops spending at each payoff independently', () => {
        const person = { pensionStart: 560000, monthlyContribution: 0, accessMonth: 0, statePensionMonth: null, statePensionMonthly: 0 };
        const base = {
            people: [person], accessibleStart: 0, monthlyAccessible: 0,
            annualRealReturnPct: 3, retirementMonth: 0, horizonMonths: 480,
            startDate: new Date(2026, 7, 1),
        };
        // £2,800/mo incl. £800 + £400 of mortgage payments ending at months 24 and 60
        const withLoans = simulateLifecycle({
            ...base, baseMonthlySpending: 2800,
            mortgages: [
                { monthlyPayment: 800, payoffMonth: 24 },
                { monthlyPayment: 400, payoffMonth: 60 },
            ],
        });
        const withoutRelief = simulateLifecycle({ ...base, baseMonthlySpending: 2800 });
        expect(withLoans.viable).toBe(true);
        expect(withoutRelief.viable).toBe(false);
    });
});

describe('retirement drawdown tax', () => {
    it('withdrawals under the personal allowance are untaxed', () => {
        // £1,000/mo gross → £750/mo taxable = £9,000/yr, below the allowance
        expect(netFromPensionWithdrawal(1000, 0)).toBeCloseTo(1000);
    });

    it('taxes the 75% taxable portion above the allowance', () => {
        // £4,000/mo gross → £36,000/yr taxable → tax £4,686/yr = £390.50/mo
        expect(netFromPensionWithdrawal(4000, 0)).toBeCloseTo(4000 - 4686 / 12);
    });

    it('stacks on top of other taxable income like the state pension', () => {
        // SP £998/mo alone is under the allowance; a £2,000/mo withdrawal adds
        // £1,500/mo taxable → total £29,976/yr → tax £3,481.20/yr
        expect(netFromPensionWithdrawal(2000, 998)).toBeCloseTo(2000 - 3481.2 / 12, 1);
    });

    it('grossPensionWithdrawal inverts netFromPensionWithdrawal', () => {
        for (const [net, other] of [[800, 0], [2500, 0], [3500, 998], [9000, 0], [12000, 1000]]) {
            const gross = grossPensionWithdrawal(net, other);
            expect(netFromPensionWithdrawal(gross, other)).toBeCloseTo(net, 1);
            expect(gross).toBeGreaterThanOrEqual(net);
        }
        expect(grossPensionWithdrawal(0, 0)).toBe(0);
    });
});

describe('simulateLifecycle drawdown tax', () => {
    // £480k funding £2,000/mo over 30 years at 3% real sits right on the
    // viability boundary — where the money lives decides the outcome.
    const base = {
        monthlyAccessible: 0, annualRealReturnPct: 3, retirementMonth: 0,
        horizonMonths: 360, startDate: new Date(2026, 7, 1), baseMonthlySpending: 2000,
    };
    const person = (pot) => ({ pensionStart: pot, monthlyContribution: 0, accessMonth: 0, statePensionMonth: null, statePensionMonthly: 0 });

    it('ISA wealth survives where a single pension fails on tax drag', () => {
        const isa = simulateLifecycle({ ...base, people: [person(0)], accessibleStart: 480000 });
        const pension = simulateLifecycle({ ...base, people: [person(480000)], accessibleStart: 0 });
        expect(isa.viable).toBe(true);
        expect(pension.viable).toBe(false);
    });

    it('a couple splitting withdrawals uses both personal allowances', () => {
        const split = simulateLifecycle({ ...base, people: [person(240000), person(240000)], accessibleStart: 0 });
        expect(split.viable).toBe(true);
    });
});

describe('aggregateLoans', () => {
    it('combines balance, payment and a balance-weighted rate', () => {
        const combined = aggregateLoans([
            { balance: 300000, monthly_payment: 1500, interest_rate_pct: 4.0, balance_date: '2026-08-01' },
            { balance: 100000, monthly_payment: 600, interest_rate_pct: 6.0, balance_date: '2026-08-15' },
        ]);
        expect(combined.balance).toBe(400000);
        expect(combined.monthly_payment).toBe(2100);
        expect(combined.interest_rate_pct).toBeCloseTo(4.5); // (300k*4 + 100k*6) / 400k
        expect(combined.balance_date).toBe('2026-08-15');
    });

    it('overpaying the aggregate shortens the payoff', () => {
        const combined = aggregateLoans([
            { balance: 200000, monthly_payment: 1200, interest_rate_pct: 4.5, balance_date: '2026-08-01' },
            { balance: 50000, monthly_payment: 400, interest_rate_pct: 6.0, balance_date: '2026-08-01' },
        ]);
        const baseline = amortiseMortgage(combined);
        const scenario = amortiseMortgage({ ...combined, monthly_payment: combined.monthly_payment + 300 });
        expect(scenario.payoffDate < baseline.payoffDate).toBe(true);
        expect(scenario.totalInterest).toBeLessThan(baseline.totalInterest);
    });
});
