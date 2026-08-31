import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Coins, Wallet, TrendingDown, Scale } from 'lucide-react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
    ReferenceLine, ReferenceDot, ResponsiveContainer,
} from 'recharts';
import apiService from '../services/api';
import { formatDate } from '../utils/helpers';
import { currentPeriod, fundedMonthDate, dailyAllowanceSeries, expectedRemaining, RESET_DAY } from '../utils/allowanceCalc';

const COLOR_EXPECTED = '#4f46e5';
const COLOR_ACTUAL = '#059669';
const COLOR_BEHIND = '#e11d48';

const fmtMoney = (value, dp = 0) =>
    `£${Number(value).toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

const StatTile = (props) => {
    // Destructured in the body: eslint's varsIgnorePattern covers uppercase
    // variables but not function parameters, and there's no jsx-uses-vars rule.
    const { label, value, sub, Icon, accent } = props;
    return (
        <div className="bg-white rounded-xl shadow-md border border-gray-100 p-4">
            <div className="flex items-center gap-2 text-xs font-medium text-gray-500 mb-1">
                <Icon className="h-4 w-4 text-indigo-500" /> {label}
            </div>
            <p className={`text-2xl font-extrabold ${accent || 'text-gray-800'}`}>{value}</p>
            {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
        </div>
    );
};

const AllowancePage = ({ showToast }) => {
    const [isLoading, setIsLoading] = useState(true);
    const [buffer, setBuffer] = useState(null);
    const [jointBalance, setJointBalance] = useState(null); // {balance, description}
    const [balanceError, setBalanceError] = useState(null);

    // The buffer runs pay day to pay day (28th → 27th), not calendar months.
    const period = currentPeriod(new Date());

    const fetchData = useCallback(async () => {
        try {
            // Pay on the 28th funds the FOLLOWING month's budget — read the
            // buffer from that month.
            const funded = fundedMonthDate(currentPeriod(new Date()));
            await apiService.createOrGetMonth(funded);
            const items = await apiService.getBudgetItemsForMonth(formatDate(funded, 'YYYY-MM'));
            // The buffer is the auto-balance Extra (the joint Remaining target);
            // fall back to the sum of any manual Extra lines.
            const autoExtra = items.find(i => i.is_auto_extra);
            const extras = items.filter(i => i.is_extra);
            setBuffer(autoExtra
                ? parseFloat(autoExtra.effective_value)
                : extras.reduce((sum, i) => sum + (parseFloat(i.effective_value) || 0), 0));
        } catch (err) {
            console.error('Failed to load budget buffer', err);
            showToast('Failed to load the budget buffer', 'error');
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

    const series = useMemo(
        () => (buffer ? dailyAllowanceSeries(buffer, period) : []),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- period is derived from the clock, stable within a render
        [buffer, period.start.getTime()]
    );

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
        );
    }

    if (!buffer) {
        return (
            <p className="text-sm text-gray-400 text-center py-16">
                No buffer found for this month — the Allowance breakdown needs the budget's auto-balance Extra item.
            </p>
        );
    }

    const expectedToday = expectedRemaining(buffer, period.dayIndex, period.totalDays);
    const actual = jointBalance?.balance ?? null;
    const delta = actual !== null ? actual - expectedToday : null;
    const dailyRate = buffer / period.totalDays;
    const daysLeft = period.totalDays - period.dayIndex;

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatTile Icon={Coins} label="Buffer this period" value={fmtMoney(buffer)}
                    sub={`≈ ${fmtMoney(dailyRate, 2)}/day over ${period.totalDays} days · resets on the ${RESET_DAY}th`} />
                <StatTile Icon={TrendingDown} label={`Should have left (day ${period.dayIndex} of ${period.totalDays})`} value={fmtMoney(expectedToday)}
                    sub={`${daysLeft} day${daysLeft === 1 ? '' : 's'} until pay day`} />
                <StatTile Icon={Wallet} label="Joint account balance"
                    value={actual !== null ? fmtMoney(actual, 2) : '—'}
                    sub={actual !== null ? jointBalance.description : balanceError || 'Connect Monzo on the FIRE tab'} />
                <StatTile Icon={Scale} label={delta === null ? 'Ahead / behind' : delta >= 0 ? 'Ahead by' : 'Behind by'}
                    value={delta !== null ? fmtMoney(Math.abs(delta), 2) : '—'}
                    accent={delta === null ? undefined : delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}
                    sub={delta !== null
                        ? (delta >= 0 ? 'Spending slower than the buffer plan' : 'Spending faster than the buffer plan')
                        : 'Needs the Monzo joint balance'} />
            </div>

            <div className="bg-white rounded-xl shadow-md border border-gray-100 p-5">
                <h3 className="text-lg font-bold text-gray-800 mb-3">
                    Buffer burn-down · {series[0].label} – {series.at(-1).label} {period.end.getFullYear()}
                </h3>
                <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={series} margin={{ top: 5, right: 12, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                        <XAxis dataKey="day" type="number" domain={[1, period.totalDays]} tickCount={11}
                            tickFormatter={(d) => series[Math.round(d) - 1]?.label ?? ''}
                            tick={{ fontSize: 11, fill: '#6b7280' }} />
                        <YAxis tickFormatter={(v) => fmtMoney(v)} tick={{ fontSize: 11, fill: '#6b7280' }} width={56} />
                        <Tooltip
                            formatter={(value) => [fmtMoney(value, 2), 'Should have left']}
                            labelFormatter={(day) => series[day - 1]?.label ?? `Day ${day}`}
                            contentStyle={{ fontSize: '12px', borderRadius: '8px', border: '1px solid #e5e7eb' }} />
                        <ReferenceLine x={period.dayIndex} stroke="#9ca3af" strokeDasharray="4 4"
                            label={{ value: 'Today', position: 'insideTopRight', fontSize: 11, fill: '#6b7280' }} />
                        <Line type="linear" dataKey="expected" name="Should have left"
                            stroke={COLOR_EXPECTED} strokeWidth={2} dot={false} />
                        {actual !== null && (
                            <ReferenceDot x={period.dayIndex} y={Math.min(actual, buffer)} r={5}
                                fill={delta >= 0 ? COLOR_ACTUAL : COLOR_BEHIND} stroke="#fff" strokeWidth={2}
                                label={{ value: `Actual ${fmtMoney(actual)}`, position: delta >= 0 ? 'top' : 'bottom', fontSize: 11, fill: delta >= 0 ? COLOR_ACTUAL : COLOR_BEHIND }} />
                        )}
                    </LineChart>
                </ResponsiveContainer>
                <p className="text-xs text-gray-400 mt-2">
                    The line spreads the buffer evenly from pay day to pay day (the {RESET_DAY}th). The dot is the live Monzo
                    joint-account balance (pot money excluded) — above the line means you're spending slower than plan.
                </p>
            </div>

            <div className="bg-white rounded-xl shadow-md border border-gray-100 p-5">
                <h3 className="text-lg font-bold text-gray-800 mb-3">Day by day</h3>
                <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-1.5">
                    {series.map(({ day, label, expected }) => (
                        <div key={day}
                            className={`px-2 py-1.5 rounded-lg text-center text-xs ${day === period.dayIndex ? 'bg-indigo-600 text-white font-semibold' : day < period.dayIndex ? 'bg-gray-50 text-gray-400' : 'bg-gray-50 text-gray-600'}`}>
                            <span className="block text-[10px] opacity-70">{label}</span>
                            {fmtMoney(expected)}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default AllowancePage;
