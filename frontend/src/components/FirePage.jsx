import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { PlusCircle, Trash2, Flame, PiggyBank, Landmark, Home, TrendingUp, Settings2, RefreshCw, Link2 } from 'lucide-react';
import { API_BASE_URL } from '../utils/helpers';
import {
    AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid,
    Tooltip, Legend, ReferenceLine, ResponsiveContainer,
} from 'recharts';
import apiService from '../services/api';
import { computeBudgetTotals } from '../hooks/useBudgetTotals';
import {
    effectiveEarnings, monthlyPensionContribution, currentWealth, buildNetWorthHistory,
    monthlySpendingForView, monthlySavingsForView, average,
    fiNumber, projectWealth, findFiCrossing, coastNumber, savingsRate, ageAt,
    mortgageStats, amortiseMortgage, combineSchedules, latestBalance, monthlyTakeHome,
    monthsUntilAge, monthIndexOf, simulateLifecycle, findEarliestViableRetirement,
    STATE_PENSION_ANNUAL, STATE_PENSION_AGE, LONGEVITY_AGE,
} from '../utils/fireCalc';

// Series colors, validated for CVD separation and contrast on white
// (dataviz palette check): pension = indigo, accessible = emerald.
const COLOR_PENSION = '#4f46e5';
const COLOR_ACCESSIBLE = '#059669';
const COLOR_MORTGAGE = '#e11d48';

const OWNER_LABELS = { keith: 'Keith', tild: 'Tild', joint: 'Joint' };
const KIND_LABELS = { pension: 'Pension', isa: 'ISA', cash: 'Cash savings', gia: 'General investment' };

const fmtMoney = (value, dp = 0) =>
    `£${Number(value).toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
const fmtCompact = (value) => {
    if (Math.abs(value) >= 1_000_000) return `£${(value / 1_000_000).toFixed(1)}m`;
    if (Math.abs(value) >= 1_000) return `£${Math.round(value / 1_000)}k`;
    return `£${Math.round(value)}`;
};
const fmtMonth = (ym) => {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleString('en-GB', { month: 'short', year: 'numeric' });
};
const today = () => new Date().toISOString().slice(0, 10);

const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-indigo-400';
const primaryBtnCls = 'py-2 px-4 text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-purple-600 rounded-lg hover:from-indigo-700 hover:to-purple-700';

const StatTile = (props) => {
    // Destructured in the body: eslint's varsIgnorePattern covers uppercase
    // variables but not function parameters, and there's no jsx-uses-vars rule.
    const { label, value, sub, Icon } = props;
    return (
    <div className="bg-white rounded-xl shadow-md border border-gray-100 p-4">
        <div className="flex items-center gap-2 text-xs font-medium text-gray-500 mb-1">
            <Icon className="h-4 w-4 text-indigo-500" /> {label}
        </div>
        <p className="text-2xl font-extrabold text-gray-800">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
    );
};

const ChartCard = ({ title, children, empty }) => (
    <div className="bg-white rounded-xl shadow-md border border-gray-100 p-5">
        <h3 className="text-lg font-bold text-gray-800 mb-3">{title}</h3>
        {empty ? <p className="text-sm text-gray-400 text-center py-10">{empty}</p> : children}
    </div>
);

const chartTooltipProps = {
    formatter: (value, name) => [fmtMoney(value), name],
    labelFormatter: fmtMonth,
    contentStyle: { fontSize: '12px', borderRadius: '8px', border: '1px solid #e5e7eb' },
};

const FirePage = ({ showToast }) => {
    const [view, setView] = useState('joint');
    const [isLoading, setIsLoading] = useState(true);
    const [accounts, setAccounts] = useState([]);
    const [earnings, setEarnings] = useState([]);
    const [properties, setProperties] = useState([]);
    const [settings, setSettings] = useState([]);
    const [monthlyItems, setMonthlyItems] = useState([]);

    const [showAccountForm, setShowAccountForm] = useState(false);
    const [accountForm, setAccountForm] = useState({ name: '', owner: 'tild', kind: 'pension', provider: '' });
    const [balanceForms, setBalanceForms] = useState({}); // accountId -> {date, balance}
    const [showEarningsForm, setShowEarningsForm] = useState(false);
    const [earningsForm, setEarningsForm] = useState({
        owner: 'tild', effective_from: today(), gross_annual_salary: '',
        employee_pension_pct: '', employee_pension_is_salary_sacrifice: true, employer_pension_pct: '', note: '',
    });
    const [showPropertyForm, setShowPropertyForm] = useState(false);
    const [propertyForm, setPropertyForm] = useState({ name: 'Home', value: '', value_date: today() });
    // null = closed, 'new' = adding, otherwise the id of the loan being edited
    const [editingLoanId, setEditingLoanId] = useState(null);
    const [loanForm, setLoanForm] = useState({
        name: 'Mortgage', balance: '', balance_date: today(), interest_rate_pct: '', monthly_payment: '',
    });
    const [settingsForms, setSettingsForms] = useState({}); // owner -> editable copy
    const [monzoStatus, setMonzoStatus] = useState(null);
    const [monzoPots, setMonzoPots] = useState(null);
    const [showPotLinks, setShowPotLinks] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);

    const fetchData = useCallback(async () => {
        try {
            const [accountsData, earningsData, propertiesData, settingsData, monthlyData, monzoStatusData] = await Promise.all([
                apiService.getFireAccounts(),
                apiService.getEarnings(),
                apiService.getProperties(),
                apiService.getFireSettings(),
                apiService.getFireMonthlyItems(12),
                apiService.getMonzoStatus().catch(() => null),
            ]);
            setMonzoStatus(monzoStatusData);
            setAccounts(accountsData);
            setEarnings(earningsData);
            setProperties(propertiesData);
            setSettings(settingsData);
            setMonthlyItems(monthlyData);
            setSettingsForms(Object.fromEntries(settingsData.map(s => [s.owner, {
                date_of_birth: s.date_of_birth || '',
                expected_real_return_pct: s.expected_real_return_pct,
                safe_withdrawal_rate_pct: s.safe_withdrawal_rate_pct,
                target_retirement_age: s.target_retirement_age ?? '',
                pension_access_age: s.pension_access_age,
                include_state_pension: s.include_state_pension,
            }])));
        } catch (err) {
            console.error('Failed to load FIRE data', err);
            showToast('Failed to load FIRE data', 'error');
        } finally {
            setIsLoading(false);
        }
    }, [showToast]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleMonzoSync = useCallback(async (silent = false) => {
        setIsSyncing(true);
        try {
            const result = await apiService.syncMonzo();
            if (!silent || result.skipped.length) {
                showToast(`Synced ${result.synced} Monzo pot balance${result.synced === 1 ? '' : 's'}${result.skipped.length ? ` · skipped: ${result.skipped.join('; ')}` : ''}`);
            }
            fetchData();
        } catch (err) {
            if (!silent) showToast(err.message, 'error');
        } finally {
            setIsSyncing(false);
        }
    }, [fetchData, showToast]);

    // One automatic sync per visit when the connection is stale (>24h since
    // the last sync) and at least one account is pot-linked.
    const autoSyncAttempted = useRef(false);
    useEffect(() => {
        if (autoSyncAttempted.current || !monzoStatus?.connected) return;
        if (!accounts.some(a => a.monzo_pot_id)) return;
        const staleMs = 24 * 60 * 60 * 1000;
        const last = monzoStatus.last_synced_at ? new Date(monzoStatus.last_synced_at).getTime() : 0;
        if (Date.now() - last < staleMs) return;
        autoSyncAttempted.current = true;
        handleMonzoSync(true);
    }, [monzoStatus, accounts, handleMonzoSync]);

    const handleTogglePotLinks = async () => {
        const opening = !showPotLinks;
        setShowPotLinks(opening);
        if (opening && monzoPots === null) {
            try {
                setMonzoPots(await apiService.getMonzoPots());
            } catch (err) {
                setShowPotLinks(false);
                showToast(err.message, 'error');
            }
        }
    };

    const handleLinkPot = async (pot, accountId) => {
        try {
            const previous = accounts.find(a => a.monzo_pot_id === pot.id);
            const payloadFor = (a, potId) => ({ name: a.name, owner: a.owner, kind: a.kind, provider: a.provider, monzo_pot_id: potId });
            if (previous && previous.id !== accountId) {
                await apiService.updateFireAccount(previous.id, payloadFor(previous, ''));
            }
            if (accountId) {
                const target = accounts.find(a => a.id === accountId);
                await apiService.updateFireAccount(accountId, payloadFor(target, pot.id));
            }
            showToast(accountId ? 'Pot linked' : 'Pot unlinked');
            fetchData();
        } catch (err) { showToast(err.message, 'error'); }
    };

    const handleMonzoDisconnect = async () => {
        try {
            await apiService.disconnectMonzo();
            setMonzoPots(null);
            setShowPotLinks(false);
            showToast('Monzo disconnected');
            fetchData();
        } catch (err) { showToast(err.message, 'error'); }
    };

    // --- Derived numbers ---

    const monthlyTotals = useMemo(() => monthlyItems
        // Months with no budget data at all (before the budget was in use)
        // would dilute the spending average toward zero — skip them.
        .filter(m => m.items.length > 0)
        .map(m => ({
            month_id: m.month_id,
            // "X repay" items are transfers between the two of you (the budget page
            // mirrors them as income on the other side) — debt repayment, not
            // consumption, so they're excluded from FIRE spending.
            totals: computeBudgetTotals(m.items.filter(i => !i.item_name.toLowerCase().trim().endsWith('repay'))),
        })), [monthlyItems]);

    const avgMonthlySpending = useMemo(
        () => average(monthlyTotals.map(m => monthlySpendingForView(m.totals, view))),
        [monthlyTotals, view]
    );
    const avgMonthlySavings = useMemo(
        () => average(monthlyTotals.map(m => monthlySavingsForView(m.totals, view))),
        [monthlyTotals, view]
    );

    const viewSettings = useMemo(() => {
        const byOwner = Object.fromEntries(settings.map(s => [s.owner, s]));
        if (view !== 'joint') return byOwner[view] || null;
        if (!settings.length) return null;
        // Joint view blends the two people's assumptions
        return {
            owner: 'joint',
            date_of_birth: null,
            expected_real_return_pct: average(settings.map(s => parseFloat(s.expected_real_return_pct))),
            safe_withdrawal_rate_pct: average(settings.map(s => parseFloat(s.safe_withdrawal_rate_pct))),
            target_retirement_age: null,
        };
    }, [settings, view]);

    const pensionOwners = view === 'joint' ? ['keith', 'tild'] : [view];
    const monthlyPension = pensionOwners.reduce(
        (sum, owner) => sum + monthlyPensionContribution(effectiveEarnings(earnings, owner, today())), 0
    );
    const settingsByOwner = useMemo(() => Object.fromEntries(settings.map(s => [s.owner, s])), [settings]);

    const wealth = useMemo(() => currentWealth(accounts, view), [accounts, view]);
    const history = useMemo(() => buildNetWorthHistory(accounts, view), [accounts, view]);

    const fiTarget = viewSettings ? fiNumber(avgMonthlySpending * 12, parseFloat(viewSettings.safe_withdrawal_rate_pct)) : null;

    const property = properties[0] || null;
    const loans = useMemo(() => property?.mortgages ?? [], [property]);
    const loanAmorts = useMemo(() => loans.map(loan => ({ loan, amort: amortiseMortgage(loan) })), [loans]);
    const combinedSchedule = useMemo(() => combineSchedules(loanAmorts.map(a => a.amort.schedule)), [loanAmorts]);

    // Per-person views carry their salary-proportion share of the (shared)
    // mortgage payment, mirroring how spending itself is split.
    const avgProportion = useMemo(() => {
        if (view === 'joint') return 1;
        const key = view === 'keith' ? 'keithProportion' : 'tildProportion';
        return average(monthlyTotals.map(m => m.totals[key]));
    }, [monthlyTotals, view]);

    // The bridge-tested plan: earliest retirement whose simulation (locked
    // pensions until access age, state pension, mortgage payoff) survives to
    // age 95. Needs a DOB for everyone in the view — otherwise `bridge` is
    // null and the page falls back to the phase-1 crossing.
    const bridge = useMemo(() => {
        if (!viewSettings || avgMonthlySpending <= 0) return null;
        const owners = view === 'joint' ? ['keith', 'tild'] : [view];
        if (owners.some(o => !settingsByOwner[o]?.date_of_birth)) return null;
        const start = new Date();
        const idxToDate = (i) => `${start.getFullYear() + Math.floor((start.getMonth() + i) / 12)}-${String(((start.getMonth() + i) % 12) + 1).padStart(2, '0')}`;
        const pensionPot = (owner) => accounts
            .filter(a => a.kind === 'pension' && a.owner === owner)
            .reduce((sum, a) => sum + (parseFloat(latestBalance(a)?.balance) || 0), 0);

        const people = owners.map(o => {
            const s = settingsByOwner[o];
            return {
                owner: o,
                pensionStart: pensionPot(o),
                monthlyContribution: monthlyPensionContribution(effectiveEarnings(earnings, o, today())),
                accessMonth: monthsUntilAge(s.date_of_birth, s.pension_access_age, start),
                statePensionMonth: s.include_state_pension ? monthsUntilAge(s.date_of_birth, STATE_PENSION_AGE, start) : null,
                statePensionMonthly: s.include_state_pension ? STATE_PENSION_ANNUAL / 12 : 0,
            };
        });
        // A shared-owner pension (unusual) counts for whoever unlocks last — the conservative choice.
        const sharedPension = pensionPot('shared');
        if (sharedPension > 0) {
            people.reduce((a, b) => (a.accessMonth >= b.accessMonth ? a : b)).pensionStart += sharedPension;
        }

        const horizonMonths = Math.max(...owners.map(o => monthsUntilAge(settingsByOwner[o].date_of_birth, LONGEVITY_AGE, start)));
        const params = {
            people,
            accessibleStart: wealth.accessible,
            monthlyAccessible: avgMonthlySavings,
            annualRealReturnPct: parseFloat(viewSettings.expected_real_return_pct),
            baseMonthlySpending: avgMonthlySpending,
            mortgages: loanAmorts.map(({ loan, amort }) => ({
                monthlyPayment: parseFloat(loan.monthly_payment) * avgProportion,
                payoffMonth: amort.payoffDate ? Math.max(0, monthIndexOf(amort.payoffDate, start)) : null,
            })),
            horizonMonths,
            startDate: start,
        };
        const retirementMonth = findEarliestViableRetirement(params);
        // With no viable month, simulate never-retiring so the chart still shows accumulation.
        const sim = simulateLifecycle({
            ...params,
            retirementMonth: retirementMonth ?? horizonMonths + 1,
            extraSampleMonths: [retirementMonth, ...people.map(p => p.accessMonth)].filter(v => v !== null),
        });
        return {
            retirementMonth,
            retireDate: retirementMonth !== null ? idxToDate(retirementMonth) : null,
            trajectory: sim.trajectory,
            accessDates: people.map(p => ({ owner: p.owner, date: idxToDate(p.accessMonth) })),
        };
    }, [viewSettings, view, settingsByOwner, accounts, earnings, wealth, avgMonthlySavings, avgMonthlySpending, loanAmorts, avgProportion]);

    // Phase-1 fallback (no bridge test) when DOBs are missing
    const projection = useMemo(() => {
        if (!viewSettings || bridge) return [];
        return projectWealth({
            pensionStart: wealth.pension,
            accessibleStart: wealth.accessible,
            monthlyPension,
            monthlyAccessible: avgMonthlySavings,
            annualRealReturnPct: parseFloat(viewSettings.expected_real_return_pct),
            years: 40,
        });
    }, [viewSettings, bridge, wealth, monthlyPension, avgMonthlySavings]);

    const fiCrossing = !bridge && fiTarget !== null && fiTarget !== Infinity ? findFiCrossing(projection, fiTarget) : null;
    const fiDate = bridge ? bridge.retireDate : (fiCrossing?.date ?? null);
    const fiAge = fiDate && viewSettings?.date_of_birth
        ? ageAt(viewSettings.date_of_birth, new Date(`${fiDate}-01`)) : null;

    const currentAge = viewSettings?.date_of_birth ? ageAt(viewSettings.date_of_birth, new Date()) : null;
    const coast = (viewSettings?.target_retirement_age && currentAge !== null && fiTarget)
        ? coastNumber(fiTarget, parseFloat(viewSettings.expected_real_return_pct), viewSettings.target_retirement_age - currentAge)
        : null;

    const grossMonthlyIncome = pensionOwners.reduce((sum, owner) => {
        const e = effectiveEarnings(earnings, owner, today());
        if (!e) return sum;
        return sum + parseFloat(e.gross_annual_salary) / 12 + parseFloat(e.gross_annual_salary) * parseFloat(e.employer_pension_pct || 0) / 100 / 12;
    }, 0);
    const rate = savingsRate(monthlyPension + avgMonthlySavings, grossMonthlyIncome);

    // Bridge trajectory is already quarterly; thin the phase-1 fallback to match
    const projectionChartData = useMemo(
        () => (bridge ? bridge.trajectory : projection.filter(p => p.monthIndex % 3 === 0)),
        [bridge, projection]
    );

    const mortgageChartData = useMemo(
        () => combinedSchedule.filter((_, i) => i % 3 === 0 || i === combinedSchedule.length - 1),
        [combinedSchedule]
    );

    // --- Handlers ---

    const submit = (action, successMsg, reset) => async (e) => {
        e.preventDefault();
        try {
            await action();
            showToast(successMsg);
            if (reset) reset();
            fetchData();
        } catch (err) { showToast(err.message, 'error'); }
    };

    const handleAddAccount = submit(
        () => apiService.createFireAccount(accountForm),
        'Account added',
        () => { setShowAccountForm(false); setAccountForm({ name: '', owner: 'tild', kind: 'pension', provider: '' }); }
    );

    const handleSetBalance = (accountId) => submit(
        () => {
            const form = balanceForms[accountId];
            return apiService.setFireAccountBalance(accountId, { date: form.date, balance: parseFloat(form.balance) });
        },
        'Balance recorded',
        () => setBalanceForms(f => ({ ...f, [accountId]: undefined }))
    );

    const handleDeleteAccount = async (id) => {
        try { await apiService.deleteFireAccount(id); showToast('Account removed'); fetchData(); }
        catch { showToast('Failed to delete account', 'error'); }
    };

    const handleAddEarnings = submit(
        () => apiService.createEarnings({
            ...earningsForm,
            gross_annual_salary: parseFloat(earningsForm.gross_annual_salary),
            employee_pension_pct: parseFloat(earningsForm.employee_pension_pct) || 0,
            employer_pension_pct: parseFloat(earningsForm.employer_pension_pct) || 0,
        }),
        'Earnings version added',
        () => setShowEarningsForm(false)
    );

    const handleDeleteEarnings = async (id) => {
        try { await apiService.deleteEarnings(id); showToast('Earnings version removed'); fetchData(); }
        catch { showToast('Failed to delete earnings version', 'error'); }
    };

    const handleSaveProperty = submit(
        () => {
            const payload = { ...propertyForm, value: parseFloat(propertyForm.value) };
            return property ? apiService.updateProperty(property.id, payload) : apiService.createProperty(payload);
        },
        'Property saved',
        () => setShowPropertyForm(false)
    );

    const handleSaveLoan = submit(
        () => {
            const payload = {
                property_id: property.id,
                name: loanForm.name,
                balance: parseFloat(loanForm.balance),
                balance_date: loanForm.balance_date,
                interest_rate_pct: parseFloat(loanForm.interest_rate_pct),
                monthly_payment: parseFloat(loanForm.monthly_payment),
            };
            return editingLoanId === 'new'
                ? apiService.createMortgage(payload)
                : apiService.updateMortgage(editingLoanId, payload);
        },
        'Loan saved',
        () => setEditingLoanId(null)
    );

    const handleDeleteLoan = async (id) => {
        try { await apiService.deleteMortgage(id); showToast('Loan removed'); fetchData(); }
        catch { showToast('Failed to delete loan', 'error'); }
    };

    const openLoanForm = (loan) => {
        if (loan) {
            setLoanForm({
                name: loan.name, balance: loan.balance, balance_date: loan.balance_date,
                interest_rate_pct: loan.interest_rate_pct, monthly_payment: loan.monthly_payment,
            });
            setEditingLoanId(loan.id);
        } else {
            setLoanForm({ name: loans.length ? 'Further advance' : 'Mortgage', balance: '', balance_date: today(), interest_rate_pct: '', monthly_payment: '' });
            setEditingLoanId('new');
        }
    };

    const handleSaveSettings = (owner) => submit(
        () => {
            const form = settingsForms[owner];
            return apiService.updateFireSettings(owner, {
                date_of_birth: form.date_of_birth || null,
                expected_real_return_pct: parseFloat(form.expected_real_return_pct),
                safe_withdrawal_rate_pct: parseFloat(form.safe_withdrawal_rate_pct),
                target_retirement_age: form.target_retirement_age === '' ? null : parseInt(form.target_retirement_age, 10),
                pension_access_age: parseInt(form.pension_access_age, 10) || 57,
                include_state_pension: form.include_state_pension,
            });
        },
        `${OWNER_LABELS[owner]}'s assumptions saved`
    );

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
        );
    }

    const accountsForList = view === 'joint' ? accounts : accounts.filter(a => a.owner === view || a.owner === 'shared');

    return (
        <div className="space-y-6">
            {/* View toggle */}
            <div className="flex justify-center">
                <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
                    {['joint', 'keith', 'tild'].map(v => (
                        <button key={v} onClick={() => setView(v)}
                            className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-all ${view === v ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                            {OWNER_LABELS[v]}
                        </button>
                    ))}
                </div>
            </div>

            {/* Summary tiles */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatTile Icon={Landmark} label="Net worth" value={fmtMoney(wealth.total)}
                    sub={`${fmtMoney(wealth.pension)} pension · ${fmtMoney(wealth.accessible)} accessible`} />
                <StatTile Icon={Flame} label="FI number"
                    value={fiTarget && fiTarget !== Infinity ? fmtMoney(fiTarget) : '—'}
                    sub={avgMonthlySpending > 0 ? `${fmtMoney(avgMonthlySpending * 12)}/yr spending at ${viewSettings ? parseFloat(viewSettings.safe_withdrawal_rate_pct).toFixed(1) : '—'}% SWR` : 'No budget history yet'} />
                <StatTile Icon={TrendingUp} label="Projected FI date"
                    value={fiDate ? fmtMonth(fiDate) : '—'}
                    sub={bridge
                        ? (bridge.retireDate
                            ? `${fiAge !== null ? `Age ${fiAge} · ` : ''}bridge-tested to ${LONGEVITY_AGE}`
                            : `No viable date within ${Math.round(480 / 12)} years`)
                        : (fiDate ? 'Set dates of birth for the bridge-tested date' : 'Not reached within 40 years')} />
                <StatTile Icon={PiggyBank} label="Savings rate"
                    value={grossMonthlyIncome > 0 ? `${(rate * 100).toFixed(0)}%` : '—'}
                    sub={`${fmtMoney(monthlyPension + avgMonthlySavings)}/mo incl. pension${coast ? ` · Coast FIRE ${fmtCompact(coast)}` : ''}`} />
            </div>

            {/* Charts */}
            <div className="grid lg:grid-cols-2 gap-6">
                <ChartCard title="Net worth history" empty={history.length < 2 ? 'Record balances over time to build this chart' : null}>
                    <ResponsiveContainer width="100%" height={280}>
                        <AreaChart data={history} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                            <XAxis dataKey="month" tickFormatter={fmtMonth} tick={{ fontSize: 11, fill: '#6b7280' }} minTickGap={40} />
                            <YAxis tickFormatter={fmtCompact} tick={{ fontSize: 11, fill: '#6b7280' }} width={52} />
                            <Tooltip {...chartTooltipProps} />
                            <Legend wrapperStyle={{ fontSize: '12px' }} />
                            <Area type="monotone" dataKey="pension" name="Pension" stackId="1"
                                stroke={COLOR_PENSION} strokeWidth={2} fill={COLOR_PENSION} fillOpacity={0.25} />
                            <Area type="monotone" dataKey="accessible" name="Accessible" stackId="1"
                                stroke={COLOR_ACCESSIBLE} strokeWidth={2} fill={COLOR_ACCESSIBLE} fillOpacity={0.25} />
                        </AreaChart>
                    </ResponsiveContainer>
                </ChartCard>

                <ChartCard title={bridge ? 'Lifecycle: accumulate, retire, draw down' : 'Projection to FI'}
                    empty={!projectionChartData.length ? 'Set assumptions and record balances to project' : null}>
                    <ResponsiveContainer width="100%" height={280}>
                        <AreaChart data={projectionChartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                            <XAxis dataKey="date" tickFormatter={(d) => d.slice(0, 4)} tick={{ fontSize: 11, fill: '#6b7280' }} minTickGap={40} />
                            <YAxis tickFormatter={fmtCompact} tick={{ fontSize: 11, fill: '#6b7280' }} width={52} />
                            <Tooltip {...chartTooltipProps} />
                            <Legend wrapperStyle={{ fontSize: '12px' }} />
                            {fiTarget && fiTarget !== Infinity && (
                                <ReferenceLine y={fiTarget} stroke="#6b7280" strokeDasharray="6 4"
                                    label={{ value: `FI ${fmtCompact(fiTarget)}`, position: 'insideTopRight', fontSize: 11, fill: '#6b7280' }} />
                            )}
                            {fiDate && (
                                <ReferenceLine x={fiDate} stroke="#6b7280" strokeDasharray="6 4"
                                    label={{ value: `Retire ${fmtMonth(fiDate)}`, position: 'insideTopLeft', fontSize: 11, fill: '#6b7280' }} />
                            )}
                            {bridge?.accessDates.map((a, idx) => (
                                <ReferenceLine key={a.owner} x={a.date} stroke="#9ca3af" strokeDasharray="2 4"
                                    label={{ value: `${OWNER_LABELS[a.owner]} pension`, position: 'insideBottomLeft', fontSize: 10, fill: '#9ca3af', dy: -idx * 14 }} />
                            ))}
                            <Area type="monotone" dataKey="pension" name="Pension" stackId="1"
                                stroke={COLOR_PENSION} strokeWidth={2} fill={COLOR_PENSION} fillOpacity={0.25} />
                            <Area type="monotone" dataKey="accessible" name="Accessible" stackId="1"
                                stroke={COLOR_ACCESSIBLE} strokeWidth={2} fill={COLOR_ACCESSIBLE} fillOpacity={0.25} />
                        </AreaChart>
                    </ResponsiveContainer>
                    <p className="text-xs text-gray-400 mt-2">
                        In today's money at {viewSettings ? parseFloat(viewSettings.expected_real_return_pct).toFixed(1) : '—'}% real return,
                        contributing {fmtMoney(monthlyPension)}/mo pension + {fmtMoney(avgMonthlySavings)}/mo savings until retirement.
                        {bridge
                            ? ` The retirement date is the earliest where accessible wealth bridges every year before pension access, and the pot lasts to age ${LONGEVITY_AGE} — including state pension from ${STATE_PENSION_AGE} and spending dropping by the mortgage payment at payoff. Assumes the mortgage payment is part of budget spending.`
                            : ' Set both dates of birth in Assumptions to enable the pension-bridge test.'}
                    </p>
                </ChartCard>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
                {/* Accounts */}
                <div className="bg-white rounded-xl shadow-md border border-gray-100 p-5">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold text-gray-800">Accounts</h3>
                        <button onClick={() => setShowAccountForm(f => !f)} className="p-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:from-indigo-700 hover:to-purple-700 active:scale-[0.98] transition-all">
                            <PlusCircle className="h-4 w-4" />
                        </button>
                    </div>

                    {showAccountForm && (
                        <form onSubmit={handleAddAccount} className="mb-4 p-4 bg-gray-50 rounded-lg space-y-3">
                            <input type="text" placeholder="Name, e.g. Royal London pension" value={accountForm.name}
                                onChange={e => setAccountForm(f => ({ ...f, name: e.target.value }))} className={inputCls} required />
                            <div className="grid grid-cols-3 gap-3">
                                <select value={accountForm.owner} onChange={e => setAccountForm(f => ({ ...f, owner: e.target.value }))} className={inputCls}>
                                    <option value="keith">Keith</option>
                                    <option value="tild">Tild</option>
                                    <option value="shared">Shared</option>
                                </select>
                                <select value={accountForm.kind} onChange={e => setAccountForm(f => ({ ...f, kind: e.target.value }))} className={inputCls}>
                                    {Object.entries(KIND_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                                </select>
                                <input type="text" placeholder="Provider" value={accountForm.provider}
                                    onChange={e => setAccountForm(f => ({ ...f, provider: e.target.value }))} className={inputCls} />
                            </div>
                            <div className="flex gap-2">
                                <button type="button" onClick={() => setShowAccountForm(false)} className="flex-1 py-2 text-sm font-semibold text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
                                <button type="submit" className={`flex-1 ${primaryBtnCls}`}>Add</button>
                            </div>
                        </form>
                    )}

                    <div className="space-y-2">
                        {accountsForList.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No accounts yet — add your pension, ISAs and savings</p>}
                        {accountsForList.map(account => {
                            const snap = account.snapshots[0];
                            const form = balanceForms[account.id];
                            return (
                                <div key={account.id} className="p-3 rounded-lg border border-gray-100 hover:shadow-sm transition-shadow group">
                                    <div className="flex items-center justify-between">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="font-semibold text-sm text-gray-800 truncate">{account.name}</span>
                                                <span className={`px-1.5 py-0.5 text-xs font-semibold rounded-full ${account.owner === 'keith' ? 'bg-blue-100 text-blue-800' : account.owner === 'tild' ? 'bg-pink-100 text-pink-800' : 'bg-purple-100 text-purple-800'}`}>{account.owner}</span>
                                                <span className="px-1.5 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600">{KIND_LABELS[account.kind]}</span>
                                                {account.monzo_pot_id && <span className="px-1.5 py-0.5 text-xs font-semibold rounded-full bg-rose-100 text-rose-700">Monzo</span>}
                                            </div>
                                            <p className="text-xs text-gray-400 mt-0.5">{snap ? `${fmtMoney(snap.balance, 2)} on ${snap.date}` : 'No balance recorded'}</p>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <button onClick={() => setBalanceForms(f => ({ ...f, [account.id]: f[account.id] ? undefined : { date: today(), balance: snap ? snap.balance : '' } }))}
                                                className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold px-2 py-1">
                                                {form ? 'Close' : 'Update balance'}
                                            </button>
                                            <button onClick={() => handleDeleteAccount(account.id)} className="p-1 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                    {form && (
                                        <form onSubmit={handleSetBalance(account.id)} className="mt-2 flex gap-2 items-center">
                                            <input type="date" value={form.date} onChange={e => setBalanceForms(f => ({ ...f, [account.id]: { ...form, date: e.target.value } }))} className={inputCls} required />
                                            <div className="relative w-full">
                                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">£</span>
                                                <input type="number" step="0.01" placeholder="0.00" value={form.balance}
                                                    onChange={e => setBalanceForms(f => ({ ...f, [account.id]: { ...form, balance: e.target.value } }))}
                                                    className={`${inputCls} pl-7`} required />
                                            </div>
                                            <button type="submit" className={primaryBtnCls}>Save</button>
                                        </form>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    <p className="text-xs text-gray-400 mt-3">Re-entering a balance for the same date corrects it; a new date supersedes older entries.</p>

                    {/* Monzo sync */}
                    {monzoStatus && (
                        <div className="mt-4 pt-4 border-t border-gray-100">
                            {!monzoStatus.configured ? (
                                <p className="text-xs text-gray-400">Monzo sync is available once <code>MONZO_CLIENT_ID</code> / <code>MONZO_CLIENT_SECRET</code> are set (see the FIRE PR for setup).</p>
                            ) : !monzoStatus.connected ? (
                                <button onClick={() => { window.location.href = `${API_BASE_URL}/fire/monzo/connect/`; }}
                                    className="w-full py-2 text-sm font-semibold text-white bg-gradient-to-r from-rose-500 to-red-500 rounded-lg hover:from-rose-600 hover:to-red-600 flex items-center justify-center gap-2">
                                    <Link2 className="h-4 w-4" /> Connect Monzo
                                </button>
                            ) : (
                                <>
                                    <div className="flex items-center justify-between gap-2 flex-wrap">
                                        <p className="text-xs text-gray-500">
                                            <span className="font-semibold text-rose-600">Monzo connected</span>
                                            {monzoStatus.last_synced_at ? ` · synced ${new Date(monzoStatus.last_synced_at).toLocaleString('en-GB')}` : ' · never synced'}
                                        </p>
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => handleMonzoSync(false)} disabled={isSyncing}
                                                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 disabled:opacity-50">
                                                <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} /> Sync now
                                            </button>
                                            <button onClick={handleTogglePotLinks} className="text-xs font-semibold text-indigo-600 hover:text-indigo-800">
                                                {showPotLinks ? 'Hide pots' : 'Link pots'}
                                            </button>
                                            <button onClick={handleMonzoDisconnect} className="text-xs text-gray-400 hover:text-red-500">Disconnect</button>
                                        </div>
                                    </div>
                                    {showPotLinks && monzoPots && (
                                        <div className="mt-3 space-y-2">
                                            {monzoPots.length === 0 && <p className="text-sm text-gray-400 text-center py-2">No open pots found</p>}
                                            {monzoPots.map(pot => {
                                                const linkedAccount = accounts.find(a => a.monzo_pot_id === pot.id);
                                                return (
                                                    <div key={pot.id} className="flex items-center justify-between gap-3 p-2 rounded-lg bg-gray-50">
                                                        <div className="min-w-0">
                                                            <span className="text-sm font-semibold text-gray-700 truncate">{pot.name}</span>
                                                            <span className="text-xs text-gray-400 ml-2">{fmtMoney(pot.balance, 2)}</span>
                                                        </div>
                                                        <select value={linkedAccount?.id || ''} onChange={e => handleLinkPot(pot, e.target.value)}
                                                            className="rounded-lg border border-gray-200 px-2 py-1 text-xs outline-none focus:border-indigo-400">
                                                            <option value="">Not linked</option>
                                                            {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.owner})</option>)}
                                                        </select>
                                                    </div>
                                                );
                                            })}
                                            <p className="text-xs text-gray-400">Each sync writes today's pot balance onto the linked account. Balances auto-sync when you open this tab if the last sync is over a day old.</p>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </div>

                {/* Earnings */}
                <div className="bg-white rounded-xl shadow-md border border-gray-100 p-5">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold text-gray-800">Earnings & pension contributions</h3>
                        <button onClick={() => setShowEarningsForm(f => !f)} className="p-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:from-indigo-700 hover:to-purple-700 active:scale-[0.98] transition-all">
                            <PlusCircle className="h-4 w-4" />
                        </button>
                    </div>

                    {showEarningsForm && (
                        <form onSubmit={handleAddEarnings} className="mb-4 p-4 bg-gray-50 rounded-lg space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-gray-500 mb-1 block">Who</label>
                                    <select value={earningsForm.owner} onChange={e => setEarningsForm(f => ({ ...f, owner: e.target.value }))} className={inputCls}>
                                        <option value="keith">Keith</option>
                                        <option value="tild">Tild</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500 mb-1 block">Effective from</label>
                                    <input type="date" value={earningsForm.effective_from} onChange={e => setEarningsForm(f => ({ ...f, effective_from: e.target.value }))} className={inputCls} required />
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="text-xs text-gray-500 mb-1 block">Gross annual</label>
                                    <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">£</span>
                                        <input type="number" step="1" placeholder="60000" value={earningsForm.gross_annual_salary}
                                            onChange={e => setEarningsForm(f => ({ ...f, gross_annual_salary: e.target.value }))} className={`${inputCls} pl-7`} required />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500 mb-1 block">Employee %</label>
                                    <input type="number" step="0.1" placeholder="5" value={earningsForm.employee_pension_pct}
                                        onChange={e => setEarningsForm(f => ({ ...f, employee_pension_pct: e.target.value }))} className={inputCls} />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500 mb-1 block">Employer %</label>
                                    <input type="number" step="0.1" placeholder="3" value={earningsForm.employer_pension_pct}
                                        onChange={e => setEarningsForm(f => ({ ...f, employer_pension_pct: e.target.value }))} className={inputCls} />
                                </div>
                            </div>
                            <label className="flex items-center gap-2 text-sm text-gray-600">
                                <input type="checkbox" checked={earningsForm.employee_pension_is_salary_sacrifice}
                                    onChange={e => setEarningsForm(f => ({ ...f, employee_pension_is_salary_sacrifice: e.target.checked }))} />
                                Employee contribution is salary sacrifice
                            </label>
                            <input type="text" placeholder="Note (optional), e.g. promotion" value={earningsForm.note}
                                onChange={e => setEarningsForm(f => ({ ...f, note: e.target.value }))} className={inputCls} />
                            <div className="flex gap-2">
                                <button type="button" onClick={() => setShowEarningsForm(false)} className="flex-1 py-2 text-sm font-semibold text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
                                <button type="submit" className={`flex-1 ${primaryBtnCls}`}>Add</button>
                            </div>
                        </form>
                    )}

                    <div className="space-y-2">
                        {earnings.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No earnings recorded — add gross salary and pension %</p>}
                        {earnings
                            .filter(e => view === 'joint' || e.owner === view)
                            .map(e => (
                                <div key={e.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:shadow-sm transition-shadow group">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="font-semibold text-sm text-gray-800">{fmtMoney(e.gross_annual_salary)}/yr</span>
                                            <span className={`px-1.5 py-0.5 text-xs font-semibold rounded-full ${e.owner === 'keith' ? 'bg-blue-100 text-blue-800' : 'bg-pink-100 text-pink-800'}`}>{e.owner}</span>
                                            {e.employee_pension_is_salary_sacrifice && <span className="px-1.5 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600">salary sacrifice</span>}
                                        </div>
                                        <p className="text-xs text-gray-400 mt-0.5">
                                            From {e.effective_from} · {parseFloat(e.employee_pension_pct)}% you + {parseFloat(e.employer_pension_pct)}% employer
                                            {` · ≈ ${fmtMoney(monthlyTakeHome(e))}/mo take-home`}
                                            {e.note ? ` · ${e.note}` : ''}
                                        </p>
                                    </div>
                                    <button onClick={() => handleDeleteEarnings(e.id)} className="p-1 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            ))}
                    </div>
                    <p className="text-xs text-gray-400 mt-3">A pay or contribution change is a new row with its effective date — history stays intact.</p>
                </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
                {/* Mortgage */}
                <div className="bg-white rounded-xl shadow-md border border-gray-100 p-5">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                            <Home className="h-5 w-5 text-indigo-500" /> {property ? property.name : 'Mortgage'}
                            {property && <span className="text-xs font-normal text-gray-400">valued {fmtMoney(property.value)} on {property.value_date}</span>}
                        </h3>
                        <button onClick={() => {
                            if (!showPropertyForm && property) {
                                setPropertyForm({ name: property.name, value: property.value, value_date: property.value_date });
                            }
                            setShowPropertyForm(f => !f);
                        }} className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold">
                            {showPropertyForm ? 'Close' : property ? 'Edit property value' : 'Add property'}
                        </button>
                    </div>

                    {showPropertyForm && (
                        <form onSubmit={handleSaveProperty} className="mb-4 p-4 bg-gray-50 rounded-lg space-y-3">
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="text-xs text-gray-500 mb-1 block">Name</label>
                                    <input type="text" value={propertyForm.name}
                                        onChange={e => setPropertyForm(f => ({ ...f, name: e.target.value }))} className={inputCls} required />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500 mb-1 block">Property value</label>
                                    <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">£</span>
                                        <input type="number" step="1000" value={propertyForm.value}
                                            onChange={e => setPropertyForm(f => ({ ...f, value: e.target.value }))} className={`${inputCls} pl-7`} required />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500 mb-1 block">Valued on</label>
                                    <input type="date" value={propertyForm.value_date}
                                        onChange={e => setPropertyForm(f => ({ ...f, value_date: e.target.value }))} className={inputCls} required />
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button type="button" onClick={() => setShowPropertyForm(false)} className="flex-1 py-2 text-sm font-semibold text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
                                <button type="submit" className={`flex-1 ${primaryBtnCls}`}>Save</button>
                            </div>
                        </form>
                    )}

                    {!property && !showPropertyForm && <p className="text-sm text-gray-400 text-center py-4">No property recorded — add the property first, then its mortgage(s)</p>}
                    {property && (() => {
                        const stats = mortgageStats(property, loans);
                        const payoffDates = loanAmorts.map(a => a.amort.payoffDate);
                        const combinedPayoff = payoffDates.length && payoffDates.every(Boolean) ? [...payoffDates].sort().at(-1) : null;
                        const interestToGo = loanAmorts.reduce((sum, a) => sum + a.amort.totalInterest, 0);
                        return (
                            <>
                                <div className="grid grid-cols-3 gap-3 mb-4 text-center">
                                    <div className="p-3 bg-gray-50 rounded-lg">
                                        <p className="text-xs text-gray-500">Equity</p>
                                        <p className="text-lg font-bold text-gray-800">{fmtMoney(stats.equity)}</p>
                                        <p className="text-xs text-gray-400">{stats.equityPct.toFixed(1)}%</p>
                                    </div>
                                    <div className="p-3 bg-gray-50 rounded-lg">
                                        <p className="text-xs text-gray-500">LTV</p>
                                        <p className="text-lg font-bold text-gray-800">{stats.ltvPct.toFixed(1)}%</p>
                                        <p className="text-xs text-gray-400">{fmtMoney(stats.totalBalance)} owed{loans.length > 1 ? ` across ${loans.length} loans` : ''}</p>
                                    </div>
                                    <div className="p-3 bg-gray-50 rounded-lg">
                                        <p className="text-xs text-gray-500">Paid off</p>
                                        <p className="text-lg font-bold text-gray-800">{combinedPayoff ? fmtMonth(combinedPayoff) : '—'}</p>
                                        <p className="text-xs text-gray-400">{loans.length === 0 ? 'No loans yet' : combinedPayoff ? `${fmtCompact(interestToGo)} interest to go` : 'A payment is below its interest'}</p>
                                    </div>
                                </div>

                                {/* Loans on this property */}
                                <div className="space-y-2 mb-3">
                                    {loanAmorts.map(({ loan, amort }) => (
                                        <div key={loan.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:shadow-sm transition-shadow group">
                                            <div className="min-w-0">
                                                <span className="font-semibold text-sm text-gray-800">{loan.name}</span>
                                                <p className="text-xs text-gray-400 mt-0.5">
                                                    {fmtMoney(loan.balance)} @ {parseFloat(loan.interest_rate_pct)}% · {fmtMoney(loan.monthly_payment)}/mo
                                                    {amort.payoffDate ? ` · paid off ${fmtMonth(amort.payoffDate)}` : ' · payment below interest'}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <button onClick={() => openLoanForm(loan)} className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold px-2 py-1">Edit</button>
                                                <button onClick={() => handleDeleteLoan(loan.id)} className="p-1 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                    {editingLoanId === null && (
                                        <button onClick={() => openLoanForm(null)} className="w-full py-2 text-xs font-semibold text-indigo-600 border border-dashed border-indigo-200 rounded-lg hover:bg-indigo-50 flex items-center justify-center gap-1">
                                            <PlusCircle className="h-3.5 w-3.5" /> Add loan (e.g. a second part or further advance)
                                        </button>
                                    )}
                                </div>

                                {editingLoanId !== null && (
                                    <form onSubmit={handleSaveLoan} className="mb-4 p-4 bg-gray-50 rounded-lg space-y-3">
                                        <input type="text" placeholder="Loan name, e.g. Part 1 (fixed to 2029)" value={loanForm.name}
                                            onChange={e => setLoanForm(f => ({ ...f, name: e.target.value }))} className={inputCls} required />
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className="text-xs text-gray-500 mb-1 block">Outstanding balance</label>
                                                <div className="relative">
                                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">£</span>
                                                    <input type="number" step="0.01" value={loanForm.balance}
                                                        onChange={e => setLoanForm(f => ({ ...f, balance: e.target.value }))} className={`${inputCls} pl-7`} required />
                                                </div>
                                            </div>
                                            <div>
                                                <label className="text-xs text-gray-500 mb-1 block">Balance correct on</label>
                                                <input type="date" value={loanForm.balance_date}
                                                    onChange={e => setLoanForm(f => ({ ...f, balance_date: e.target.value }))} className={inputCls} required />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className="text-xs text-gray-500 mb-1 block">Interest rate %</label>
                                                <input type="number" step="0.01" value={loanForm.interest_rate_pct}
                                                    onChange={e => setLoanForm(f => ({ ...f, interest_rate_pct: e.target.value }))} className={inputCls} required />
                                            </div>
                                            <div>
                                                <label className="text-xs text-gray-500 mb-1 block">Monthly payment</label>
                                                <div className="relative">
                                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">£</span>
                                                    <input type="number" step="0.01" value={loanForm.monthly_payment}
                                                        onChange={e => setLoanForm(f => ({ ...f, monthly_payment: e.target.value }))} className={`${inputCls} pl-7`} required />
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            <button type="button" onClick={() => setEditingLoanId(null)} className="flex-1 py-2 text-sm font-semibold text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
                                            <button type="submit" className={`flex-1 ${primaryBtnCls}`}>{editingLoanId === 'new' ? 'Add loan' : 'Save loan'}</button>
                                        </div>
                                    </form>
                                )}

                                {mortgageChartData.length > 1 && (
                                    <ResponsiveContainer width="100%" height={180}>
                                        <LineChart data={mortgageChartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                                            <XAxis dataKey="date" tickFormatter={(d) => d.slice(0, 4)} tick={{ fontSize: 11, fill: '#6b7280' }} minTickGap={40} />
                                            <YAxis tickFormatter={fmtCompact} tick={{ fontSize: 11, fill: '#6b7280' }} width={52} />
                                            <Tooltip {...chartTooltipProps} />
                                            <Line type="monotone" dataKey="balance" name="Combined balance" stroke={COLOR_MORTGAGE} strokeWidth={2} dot={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                )}
                            </>
                        );
                    })()}
                </div>

                {/* Assumptions */}
                <div className="bg-white rounded-xl shadow-md border border-gray-100 p-5">
                    <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2 mb-4"><Settings2 className="h-5 w-5 text-indigo-500" /> Assumptions</h3>
                    <div className="space-y-4">
                        {['keith', 'tild'].map(owner => {
                            const form = settingsForms[owner];
                            if (!form) return null;
                            return (
                                <form key={owner} onSubmit={handleSaveSettings(owner)} className="p-4 bg-gray-50 rounded-lg space-y-3">
                                    <div className="flex items-center justify-between">
                                        <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${owner === 'keith' ? 'bg-blue-100 text-blue-800' : 'bg-pink-100 text-pink-800'}`}>{OWNER_LABELS[owner]}</span>
                                        <button type="submit" className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold">Save</button>
                                    </div>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                        <div>
                                            <label className="text-xs text-gray-500 mb-1 block">Date of birth</label>
                                            <input type="date" value={form.date_of_birth}
                                                onChange={e => setSettingsForms(f => ({ ...f, [owner]: { ...form, date_of_birth: e.target.value } }))} className={inputCls} />
                                        </div>
                                        <div>
                                            <label className="text-xs text-gray-500 mb-1 block">Real return %</label>
                                            <input type="number" step="0.1" value={form.expected_real_return_pct}
                                                onChange={e => setSettingsForms(f => ({ ...f, [owner]: { ...form, expected_real_return_pct: e.target.value } }))} className={inputCls} required />
                                        </div>
                                        <div>
                                            <label className="text-xs text-gray-500 mb-1 block">SWR %</label>
                                            <input type="number" step="0.1" value={form.safe_withdrawal_rate_pct}
                                                onChange={e => setSettingsForms(f => ({ ...f, [owner]: { ...form, safe_withdrawal_rate_pct: e.target.value } }))} className={inputCls} required />
                                        </div>
                                        <div>
                                            <label className="text-xs text-gray-500 mb-1 block">Target retire age</label>
                                            <input type="number" step="1" placeholder="e.g. 55" value={form.target_retirement_age}
                                                onChange={e => setSettingsForms(f => ({ ...f, [owner]: { ...form, target_retirement_age: e.target.value } }))} className={inputCls} />
                                        </div>
                                    </div>
                                    <div className="flex items-end gap-4">
                                        <div>
                                            <label className="text-xs text-gray-500 mb-1 block">Pension access age</label>
                                            <input type="number" step="1" value={form.pension_access_age}
                                                onChange={e => setSettingsForms(f => ({ ...f, [owner]: { ...form, pension_access_age: e.target.value } }))} className={inputCls} required />
                                        </div>
                                        <label className="flex items-center gap-2 text-sm text-gray-600 pb-2">
                                            <input type="checkbox" checked={form.include_state_pension}
                                                onChange={e => setSettingsForms(f => ({ ...f, [owner]: { ...form, include_state_pension: e.target.checked } }))} />
                                            Include state pension ({fmtCompact(STATE_PENSION_ANNUAL)}/yr from {STATE_PENSION_AGE})
                                        </label>
                                    </div>
                                </form>
                            );
                        })}
                    </div>
                    <p className="text-xs text-gray-400 mt-3">
                        Return is after inflation, so all projections read in today's money. The joint view blends both people's assumptions.
                        Spending and savings averages come from the last {monthlyTotals.length || 12} months of the budget.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default FirePage;
