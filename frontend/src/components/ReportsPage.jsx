import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Coins, Wallet, TrendingDown, Scale, ShoppingCart } from 'lucide-react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
    ReferenceLine, ReferenceDot, ResponsiveContainer,
} from 'recharts';
import apiService from '../services/api';
import { formatDate } from '../utils/helpers';
import {
    currentPeriod, calendarMonthPeriod, fundedMonthDate, dailyAllowanceSeries, weeklyBurndownSeries,
    expectedRemaining, RESET_DAY,
} from '../utils/allowanceCalc';

const COLOR_EXPECTED = '#3b82c4';
const COLOR_ACTUAL = '#25835c';
const COLOR_BEHIND = '#a54334';

const fmtMoney = (value, dp = 0) =>
    `£${Number(value).toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

const StatTile = (props) => {
    // Destructured in the body: eslint's varsIgnorePattern covers uppercase
    // variables but not function parameters, and there's no jsx-uses-vars rule.
    const { label, value, sub, Icon, accent } = props;
    return (
        <div className="bg-card rounded-xl border border-line p-4">
            <div className="flex items-center gap-2 text-xs font-medium text-ink-soft mb-1">
                <Icon className="h-4 w-4 text-accent" /> {label}
            </div>
            <p className={`text-2xl font-extrabold ${accent || 'text-ink'}`}>{value}</p>
            {sub && <p className="text-xs text-ink-faint mt-1">{sub}</p>}
        </div>
    );
};

/** Shared burn-down chart: `stepped` renders the weekly staircase. */
const BurndownChart = ({ title, footnote, series, period, actual, delta, ceiling, stepped }) => (
    <div className="bg-card rounded-xl border border-line p-5">
        <h3 className="text-lg font-bold text-ink mb-3">{title}</h3>
        <ResponsiveContainer width="100%" height={300}>
            <LineChart data={series} margin={{ top: 5, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eae5d6" vertical={false} />
                <XAxis dataKey="day" type="number" domain={[1, period.totalDays]} tickCount={11}
                    tickFormatter={(d) => series[Math.round(d) - 1]?.label ?? ''}
                    tick={{ fontSize: 11, fill: '#6e6a5b' }} />
                <YAxis tickFormatter={(v) => fmtMoney(v)} tick={{ fontSize: 11, fill: '#6e6a5b' }} width={56} />
                <Tooltip
                    formatter={(value) => [fmtMoney(value, 2), 'Should have left']}
                    labelFormatter={(day) => series[day - 1]?.label ?? `Day ${day}`}
                    contentStyle={{ fontSize: '12px', borderRadius: '8px', border: '1px solid #e2ddcd', backgroundColor: '#fcfbf5' }} />
                <ReferenceLine x={period.dayIndex} stroke="#a39e8c" strokeDasharray="4 4"
                    label={{ value: 'Today', position: 'insideTopRight', fontSize: 11, fill: '#6e6a5b' }} />
                <Line type={stepped ? 'stepAfter' : 'linear'} dataKey="expected" name="Should have left"
                    stroke={COLOR_EXPECTED} strokeWidth={2} dot={false} />
                {actual !== null && (
                    <ReferenceDot x={period.dayIndex} y={Math.min(actual, ceiling)} r={5}
                        fill={delta >= 0 ? COLOR_ACTUAL : COLOR_BEHIND} stroke="#fcfbf5" strokeWidth={2}
                        label={{ value: `Actual ${fmtMoney(actual)}`, position: delta >= 0 ? 'top' : 'bottom', fontSize: 11, fill: delta >= 0 ? COLOR_ACTUAL : COLOR_BEHIND }} />
                )}
            </LineChart>
        </ResponsiveContainer>
        <p className="text-xs text-ink-faint mt-2">{footnote}</p>
    </div>
);

const ReportsPage = ({ showToast }) => {
    const [source, setSource] = useState('joint');
    const [isLoading, setIsLoading] = useState(true);
    const [buffer, setBuffer] = useState(null);
    const [groceries, setGroceries] = useState(null); // {total, shopDay}
    const [jointBalance, setJointBalance] = useState(null); // {balance, description}
    const [balanceError, setBalanceError] = useState(null);
    const [groceriesPot, setGroceriesPot] = useState(null); // {balance, name}
    const [potError, setPotError] = useState(null);
    const [potsRequested, setPotsRequested] = useState(false);

    // The buffer runs pay day to pay day (28th → 27th); the groceries pot
    // refills on the 1st, so its report runs on calendar months.
    const period = currentPeriod(new Date());
    const gPeriod = calendarMonthPeriod(new Date());

    const fetchData = useCallback(async () => {
        try {
            // Pay on the 28th funds the FOLLOWING month's budget — the buffer
            // comes from that month. Groceries reset on the 1st, so their
            // budget is the CURRENT calendar month's (a different month only
            // between the 28th and month end).
            const funded = fundedMonthDate(currentPeriod(new Date()));
            await apiService.createOrGetMonth(funded);
            const fundedItems = await apiService.getBudgetItemsForMonth(formatDate(funded, 'YYYY-MM'));
            const current = new Date();
            let currentItems = fundedItems;
            if (formatDate(current, 'YYYY-MM') !== formatDate(funded, 'YYYY-MM')) {
                await apiService.createOrGetMonth(current);
                currentItems = await apiService.getBudgetItemsForMonth(formatDate(current, 'YYYY-MM'));
            }

            const autoExtra = fundedItems.find(i => i.is_auto_extra);
            const extras = fundedItems.filter(i => i.is_extra);
            setBuffer(autoExtra
                ? parseFloat(autoExtra.effective_value)
                : extras.reduce((sum, i) => sum + (parseFloat(i.effective_value) || 0), 0));

            const groceryItems = currentItems.filter(i => i.expense_pot === 'groceries');
            const weeklyItem = groceryItems.find(i => i.calculation_type === 'weekly_count' && i.weekly_payment_day);
            setGroceries({
                total: groceryItems.reduce((sum, i) => sum + (parseFloat(i.effective_value) || 0), 0),
                shopDay: weeklyItem ? weeklyItem.weekly_payment_day : null,
            });
        } catch (err) {
            console.error('Failed to load budget data', err);
            showToast('Failed to load budget data', 'error');
        } finally {
            setIsLoading(false);
        }
        try {
            setJointBalance(await apiService.getMonzoJointBalance());
            setBalanceError(null);
        } catch (err) {
            setJointBalance(null);
            setBalanceError(err.message);
        }
    }, [showToast]);

    useEffect(() => { fetchData(); }, [fetchData]);

    // The groceries pot balance comes from the pots listing — fetched once,
    // on first switch to the groceries report.
    useEffect(() => {
        if (source !== 'groceries' || potsRequested) return;
        setPotsRequested(true);
        apiService.getMonzoPots()
            .then(pots => {
                const pot = pots.find(p => p.name.toLowerCase().includes('grocer'));
                if (pot) { setGroceriesPot(pot); setPotError(null); }
                else setPotError('No Monzo pot with "groceries" in its name');
            })
            .catch(err => setPotError(err.message));
    }, [source, potsRequested]);

    const dailySeries = useMemo(
        () => (buffer ? dailyAllowanceSeries(buffer, period) : []),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- period is derived from the clock, stable within a render
        [buffer, period.start.getTime()]
    );
    const weekly = useMemo(
        () => (groceries?.total
            // Without a weekly_count groceries item, assume shopping on the
            // 1st's weekday so the staircase still renders.
            ? weeklyBurndownSeries(groceries.total, gPeriod, groceries.shopDay ?? ((gPeriod.start.getDay() + 6) % 7) + 1)
            : null),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- period is derived from the clock, stable within a render
        [groceries, gPeriod.start.getTime()]
    );

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
            </div>
        );
    }

    const sourceToggle = (
        <div className="flex justify-center">
            <div className="inline-flex rounded-lg border border-line bg-card p-1 shadow-sm">
                {[['joint', 'Joint account'], ['groceries', 'Groceries pot']].map(([key, label]) => (
                    <button key={key} onClick={() => setSource(key)}
                        className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-all ${source === key ? 'bg-accent text-paper' : 'text-ink-soft hover:bg-paper'}`}>
                        {label}
                    </button>
                ))}
            </div>
        </div>
    );

    // --- Joint account report ---
    if (source === 'joint') {
        if (!buffer) {
            return (
                <div className="space-y-6 animate-fadeIn">
                    {sourceToggle}
                    <p className="text-sm text-ink-faint text-center py-16">
                        No buffer found for this period — this report needs the budget's auto-balance Extra item.
                    </p>
                </div>
            );
        }
        const expectedToday = expectedRemaining(buffer, period.dayIndex, period.totalDays);
        const actual = jointBalance?.balance ?? null;
        const delta = actual !== null ? actual - expectedToday : null;
        const daysLeft = period.totalDays - period.dayIndex;

        return (
            <div className="space-y-6 animate-fadeIn">
                {sourceToggle}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatTile Icon={Coins} label="Buffer this period" value={fmtMoney(buffer)}
                        sub={`≈ ${fmtMoney(buffer / period.totalDays, 2)}/day over ${period.totalDays} days · resets on the ${RESET_DAY}th`} />
                    <StatTile Icon={TrendingDown} label={`Should have left (day ${period.dayIndex} of ${period.totalDays})`} value={fmtMoney(expectedToday)}
                        sub={`${daysLeft} day${daysLeft === 1 ? '' : 's'} until pay day`} />
                    <StatTile Icon={Wallet} label="Joint account balance"
                        value={actual !== null ? fmtMoney(actual, 2) : '—'}
                        sub={actual !== null ? jointBalance.description : balanceError || 'Connect Monzo on the FIRE tab'} />
                    <StatTile Icon={Scale} label={delta === null ? 'Ahead / behind' : delta >= 0 ? 'Ahead by' : 'Behind by'}
                        value={delta !== null ? fmtMoney(Math.abs(delta), 2) : '—'}
                        accent={delta === null ? undefined : delta >= 0 ? 'text-good' : 'text-danger'}
                        sub={delta !== null
                            ? (delta >= 0 ? 'Spending slower than the buffer plan' : 'Spending faster than the buffer plan')
                            : 'Needs the Monzo joint balance'} />
                </div>

                <BurndownChart
                    title={`Buffer burn-down · ${dailySeries[0].label} – ${dailySeries.at(-1).label} ${period.end.getFullYear()}`}
                    footnote={`The line spreads the buffer evenly from pay day to pay day (the ${RESET_DAY}th). The dot is the live Monzo joint-account balance (pot money excluded) — above the line means you're spending slower than plan.`}
                    series={dailySeries} period={period} actual={actual} delta={delta} ceiling={buffer} stepped={false} />

                <div className="bg-card rounded-xl border border-line p-5">
                    <h3 className="text-lg font-bold text-ink mb-3">Day by day</h3>
                    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-1.5">
                        {dailySeries.map(({ day, label, expected }) => (
                            <div key={day}
                                className={`px-2 py-1.5 rounded-lg text-center text-xs ${day === period.dayIndex ? 'bg-accent text-paper font-semibold' : day < period.dayIndex ? 'bg-paper text-ink-faint' : 'bg-paper text-ink-soft'}`}>
                                <span className="block text-[10px] opacity-70">{label}</span>
                                {fmtMoney(expected)}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    // --- Groceries pot report ---
    if (!weekly) {
        return (
            <div className="space-y-6 animate-fadeIn">
                {sourceToggle}
                <p className="text-sm text-ink-faint text-center py-16">
                    No groceries budget found — this report needs budget items in the groceries pot.
                </p>
            </div>
        );
    }
    const { series, totalShops, shopsDone } = weekly;
    const expectedToday = series[gPeriod.dayIndex - 1]?.expected ?? 0;
    const actual = groceriesPot?.balance ?? null;
    const delta = actual !== null ? actual - expectedToday : null;
    const shopValue = groceries.total / totalShops;

    return (
        <div className="space-y-6 animate-fadeIn">
            {sourceToggle}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatTile Icon={ShoppingCart} label="Groceries this month" value={fmtMoney(groceries.total)}
                    sub={`${totalShops} shops of ≈ ${fmtMoney(shopValue, 2)} · resets on the 1st`} />
                <StatTile Icon={TrendingDown} label={`Should have left (${shopsDone} of ${totalShops} shops done)`} value={fmtMoney(expectedToday)}
                    sub={`${totalShops - shopsDone} shop${totalShops - shopsDone === 1 ? '' : 's'} left this month`} />
                <StatTile Icon={Wallet} label="Groceries pot balance"
                    value={actual !== null ? fmtMoney(actual, 2) : '—'}
                    sub={actual !== null ? groceriesPot.name : potError || 'Connect Monzo on the FIRE tab'} />
                <StatTile Icon={Scale} label={delta === null ? 'Ahead / behind' : delta >= 0 ? 'Ahead by' : 'Behind by'}
                    value={delta !== null ? fmtMoney(Math.abs(delta), 2) : '—'}
                    accent={delta === null ? undefined : delta >= 0 ? 'text-good' : 'text-danger'}
                    sub={delta !== null
                        ? (delta >= 0 ? 'Shops costing less than budgeted' : 'Shops costing more than budgeted')
                        : 'Needs the Monzo groceries pot'} />
            </div>

            <BurndownChart
                title={`Groceries burn-down · ${gPeriod.start.toLocaleString('en-GB', { month: 'long', year: 'numeric' })}`}
                footnote={`One step per weekly shop (${totalShops} this month; the pot refills on the 1st). The dot is the live Monzo groceries pot balance — above the staircase means the shops are coming in under budget.`}
                series={series} period={gPeriod} actual={actual} delta={delta} ceiling={groceries.total} stepped={true} />

            <div className="bg-card rounded-xl border border-line p-5">
                <h3 className="text-lg font-bold text-ink mb-3">Shop by shop</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-1.5">
                    {series.filter(d => d.isShopDay).map((d, idx) => (
                        <div key={d.day}
                            className={`px-2 py-1.5 rounded-lg text-center text-xs ${idx + 1 === shopsDone ? 'bg-accent text-paper font-semibold' : idx + 1 < shopsDone ? 'bg-paper text-ink-faint' : 'bg-paper text-ink-soft'}`}>
                            <span className="block text-[10px] opacity-70">Shop {idx + 1} · {d.label}</span>
                            {fmtMoney(d.expected)} left after
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default ReportsPage;
