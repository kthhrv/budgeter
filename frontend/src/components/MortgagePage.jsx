import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { PlusCircle, Trash2, Home, Zap } from 'lucide-react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import apiService from '../services/api';
import { mortgageStats, amortiseMortgage, aggregateLoans, combineSchedules } from '../utils/fireCalc';

const COLOR_BASELINE = '#3b82c4';
const COLOR_OVERPAY = '#25835c';

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

const inputCls = 'w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-accent';
const primaryBtnCls = 'py-2 px-4 text-sm font-semibold text-paper bg-accent rounded-lg hover:bg-accent-strong';

const chartTooltipProps = {
    formatter: (value, name) => [fmtMoney(value), name],
    labelFormatter: fmtMonth,
    contentStyle: { fontSize: '12px', borderRadius: '8px', border: '1px solid #e2ddcd', backgroundColor: '#fcfbf5' },
};

const monthsBetween = (fromYm, toYm) => {
    const [fy, fm] = fromYm.split('-').map(Number);
    const [ty, tm] = toYm.split('-').map(Number);
    return (ty - fy) * 12 + (tm - fm);
};

const MortgagePage = ({ showToast }) => {
    const [isLoading, setIsLoading] = useState(true);
    const [properties, setProperties] = useState([]);
    const [showPropertyForm, setShowPropertyForm] = useState(false);
    const [propertyForm, setPropertyForm] = useState({ name: 'Home', value: '', value_date: today() });
    // null = closed, 'new' = adding, otherwise the id of the loan being edited
    const [editingLoanId, setEditingLoanId] = useState(null);
    const [loanForm, setLoanForm] = useState({
        name: 'Mortgage', balance: '', balance_date: today(), interest_rate_pct: '', monthly_payment: '',
    });
    const [overpayment, setOverpayment] = useState(200);

    const fetchData = useCallback(async () => {
        try {
            setProperties(await apiService.getProperties());
        } catch (err) {
            console.error('Failed to load mortgage data', err);
            showToast('Failed to load mortgage data', 'error');
        } finally {
            setIsLoading(false);
        }
    }, [showToast]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const property = properties[0] || null;
    const loans = useMemo(() => property?.mortgages ?? [], [property]);
    const loanAmorts = useMemo(() => loans.map(loan => ({ loan, amort: amortiseMortgage(loan) })), [loans]);
    const combinedSchedule = useMemo(() => combineSchedules(loanAmorts.map(a => a.amort.schedule)), [loanAmorts]);
    const chartData = useMemo(
        () => combinedSchedule.filter((_, i) => i % 3 === 0 || i === combinedSchedule.length - 1),
        [combinedSchedule]
    );

    // Overpayment scenario: both loans treated as ONE combined loan (one
    // household payment) at a balance-weighted rate.
    const overpay = useMemo(() => {
        if (!loans.length) return null;
        const combined = aggregateLoans(loans);
        const baseline = amortiseMortgage(combined);
        const extra = Math.max(0, parseFloat(overpayment) || 0);
        const scenario = amortiseMortgage({ ...combined, monthly_payment: combined.monthly_payment + extra });
        const byDate = new Map(scenario.schedule.map(p => [p.date, p.balance]));
        const chart = baseline.schedule
            .map(p => ({ date: p.date, baseline: p.balance, overpay: byDate.get(p.date) ?? 0 }))
            .filter((_, i) => i % 3 === 0);
        return {
            combined, baseline, scenario, extra, chart,
            monthsSaved: baseline.payoffDate && scenario.payoffDate ? monthsBetween(scenario.payoffDate, baseline.payoffDate) : null,
            interestSaved: baseline.totalInterest - scenario.totalInterest,
        };
    }, [loans, overpayment]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
            </div>
        );
    }

    const stats = property ? mortgageStats(property, loans) : null;
    const payoffDates = loanAmorts.map(a => a.amort.payoffDate);
    const combinedPayoff = payoffDates.length && payoffDates.every(Boolean) ? [...payoffDates].sort().at(-1) : null;
    const interestToGo = loanAmorts.reduce((sum, a) => sum + a.amort.totalInterest, 0);

    return (
        <div className="space-y-6 animate-fadeIn">
            {/* Property header + stats */}
            <div className="bg-card rounded-xl border border-line p-5">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-ink flex items-center gap-2">
                        <Home className="h-5 w-5 text-accent" /> {property ? property.name : 'Mortgage'}
                        {property && <span className="text-xs font-normal text-ink-faint">valued {fmtMoney(property.value)} on {property.value_date}</span>}
                    </h3>
                    <button onClick={() => {
                        if (!showPropertyForm && property) {
                            setPropertyForm({ name: property.name, value: property.value, value_date: property.value_date });
                        }
                        setShowPropertyForm(f => !f);
                    }} className="text-xs text-accent hover:text-accent-strong font-semibold">
                        {showPropertyForm ? 'Close' : property ? 'Edit property value' : 'Add property'}
                    </button>
                </div>

                {showPropertyForm && (
                    <form onSubmit={async (e) => {
                        e.preventDefault();
                        try {
                            const payload = { ...propertyForm, value: parseFloat(propertyForm.value) };
                            await (property ? apiService.updateProperty(property.id, payload) : apiService.createProperty(payload));
                            showToast('Property saved');
                            setShowPropertyForm(false);
                            fetchData();
                        } catch (err) { showToast(err.message, 'error'); }
                    }} className="mb-4 p-4 bg-paper rounded-lg space-y-3">
                        <div className="grid grid-cols-3 gap-3">
                            <div>
                                <label className="text-xs text-ink-soft mb-1 block">Name</label>
                                <input type="text" value={propertyForm.name}
                                    onChange={e => setPropertyForm(f => ({ ...f, name: e.target.value }))} className={inputCls} required />
                            </div>
                            <div>
                                <label className="text-xs text-ink-soft mb-1 block">Property value</label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint text-sm">£</span>
                                    <input type="number" step="1000" value={propertyForm.value}
                                        onChange={e => setPropertyForm(f => ({ ...f, value: e.target.value }))} className={`${inputCls} pl-7`} required />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs text-ink-soft mb-1 block">Valued on</label>
                                <input type="date" value={propertyForm.value_date}
                                    onChange={e => setPropertyForm(f => ({ ...f, value_date: e.target.value }))} className={inputCls} required />
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button type="button" onClick={() => setShowPropertyForm(false)} className="flex-1 py-2 text-sm font-semibold text-ink-soft border border-line rounded-lg hover:bg-paper">Cancel</button>
                            <button type="submit" className={`flex-1 ${primaryBtnCls}`}>Save</button>
                        </div>
                    </form>
                )}

                {!property && !showPropertyForm && <p className="text-sm text-ink-faint text-center py-4">No property recorded — add the property first, then its mortgage(s)</p>}

                {property && (
                    <div className="grid grid-cols-3 gap-3 text-center">
                        <div className="p-3 bg-paper rounded-lg">
                            <p className="text-xs text-ink-soft">Equity</p>
                            <p className="text-lg font-bold text-ink">{fmtMoney(stats.equity)}</p>
                            <p className="text-xs text-ink-faint">{stats.equityPct.toFixed(1)}%</p>
                        </div>
                        <div className="p-3 bg-paper rounded-lg">
                            <p className="text-xs text-ink-soft">LTV</p>
                            <p className="text-lg font-bold text-ink">{stats.ltvPct.toFixed(1)}%</p>
                            <p className="text-xs text-ink-faint">{fmtMoney(stats.totalBalance)} owed{loans.length > 1 ? ` across ${loans.length} loans` : ''}</p>
                        </div>
                        <div className="p-3 bg-paper rounded-lg">
                            <p className="text-xs text-ink-soft">Paid off</p>
                            <p className="text-lg font-bold text-ink">{combinedPayoff ? fmtMonth(combinedPayoff) : '—'}</p>
                            <p className="text-xs text-ink-faint">{loans.length === 0 ? 'No loans yet' : combinedPayoff ? `${fmtCompact(interestToGo)} interest to go` : 'A payment is below its interest'}</p>
                        </div>
                    </div>
                )}
            </div>

            {property && (
                <div className="grid lg:grid-cols-2 gap-6 items-start">
                    {/* Loans */}
                    <div className="bg-card rounded-xl border border-line p-5">
                        <h3 className="text-lg font-bold text-ink mb-3">Loans on {property.name}</h3>
                        <div className="space-y-2 mb-3">
                            {loanAmorts.map(({ loan, amort }) => (
                                <div key={loan.id} className="flex items-center justify-between p-3 rounded-lg border border-line hover:shadow-sm transition-shadow group">
                                    <div className="min-w-0">
                                        <span className="font-semibold text-sm text-ink">{loan.name}</span>
                                        <p className="text-xs text-ink-faint mt-0.5">
                                            {fmtMoney(loan.balance)} @ {parseFloat(loan.interest_rate_pct)}% · {fmtMoney(loan.monthly_payment)}/mo
                                            {amort.payoffDate ? ` · paid off ${fmtMonth(amort.payoffDate)}` : ' · payment below interest'}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button onClick={() => {
                                            setLoanForm({
                                                name: loan.name, balance: loan.balance, balance_date: loan.balance_date,
                                                interest_rate_pct: loan.interest_rate_pct, monthly_payment: loan.monthly_payment,
                                            });
                                            setEditingLoanId(loan.id);
                                        }} className="text-xs text-accent hover:text-accent-strong font-semibold px-2 py-1">Edit</button>
                                        <button onClick={async () => {
                                            try { await apiService.deleteMortgage(loan.id); showToast('Loan removed'); fetchData(); }
                                            catch { showToast('Failed to delete loan', 'error'); }
                                        }} className="p-1 text-ink-faint/70 hover:text-danger opacity-0 group-hover:opacity-100 transition-all">
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                            {editingLoanId === null && (
                                <button onClick={() => {
                                    setLoanForm({ name: loans.length ? 'Further advance' : 'Mortgage', balance: '', balance_date: today(), interest_rate_pct: '', monthly_payment: '' });
                                    setEditingLoanId('new');
                                }} className="w-full py-2 text-xs font-semibold text-accent border border-dashed border-accent/30 rounded-lg hover:bg-accent/5 flex items-center justify-center gap-1">
                                    <PlusCircle className="h-3.5 w-3.5" /> Add loan (e.g. a second part or further advance)
                                </button>
                            )}
                        </div>

                        {editingLoanId !== null && (
                            <form onSubmit={async (e) => {
                                e.preventDefault();
                                try {
                                    const payload = {
                                        property_id: property.id,
                                        name: loanForm.name,
                                        balance: parseFloat(loanForm.balance),
                                        balance_date: loanForm.balance_date,
                                        interest_rate_pct: parseFloat(loanForm.interest_rate_pct),
                                        monthly_payment: parseFloat(loanForm.monthly_payment),
                                    };
                                    await (editingLoanId === 'new'
                                        ? apiService.createMortgage(payload)
                                        : apiService.updateMortgage(editingLoanId, payload));
                                    showToast('Loan saved');
                                    setEditingLoanId(null);
                                    fetchData();
                                } catch (err) { showToast(err.message, 'error'); }
                            }} className="mb-4 p-4 bg-paper rounded-lg space-y-3">
                                <input type="text" placeholder="Loan name, e.g. Part 1 (fixed to 2029)" value={loanForm.name}
                                    onChange={e => setLoanForm(f => ({ ...f, name: e.target.value }))} className={inputCls} required />
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs text-ink-soft mb-1 block">Outstanding balance</label>
                                        <div className="relative">
                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint text-sm">£</span>
                                            <input type="number" step="0.01" value={loanForm.balance}
                                                onChange={e => setLoanForm(f => ({ ...f, balance: e.target.value }))} className={`${inputCls} pl-7`} required />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-xs text-ink-soft mb-1 block">Balance correct on</label>
                                        <input type="date" value={loanForm.balance_date}
                                            onChange={e => setLoanForm(f => ({ ...f, balance_date: e.target.value }))} className={inputCls} required />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs text-ink-soft mb-1 block">Interest rate %</label>
                                        <input type="number" step="0.01" value={loanForm.interest_rate_pct}
                                            onChange={e => setLoanForm(f => ({ ...f, interest_rate_pct: e.target.value }))} className={inputCls} required />
                                    </div>
                                    <div>
                                        <label className="text-xs text-ink-soft mb-1 block">Monthly payment</label>
                                        <div className="relative">
                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint text-sm">£</span>
                                            <input type="number" step="0.01" value={loanForm.monthly_payment}
                                                onChange={e => setLoanForm(f => ({ ...f, monthly_payment: e.target.value }))} className={`${inputCls} pl-7`} required />
                                        </div>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <button type="button" onClick={() => setEditingLoanId(null)} className="flex-1 py-2 text-sm font-semibold text-ink-soft border border-line rounded-lg hover:bg-paper">Cancel</button>
                                    <button type="submit" className={`flex-1 ${primaryBtnCls}`}>{editingLoanId === 'new' ? 'Add loan' : 'Save loan'}</button>
                                </div>
                            </form>
                        )}

                        {chartData.length > 1 && (
                            <ResponsiveContainer width="100%" height={180}>
                                <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#eae5d6" vertical={false} />
                                    <XAxis dataKey="date" tickFormatter={(d) => d.slice(0, 4)} tick={{ fontSize: 11, fill: '#6e6a5b' }} minTickGap={40} />
                                    <YAxis tickFormatter={fmtCompact} tick={{ fontSize: 11, fill: '#6e6a5b' }} width={52} />
                                    <Tooltip {...chartTooltipProps} />
                                    <Line type="monotone" dataKey="balance" name="Combined balance" stroke={COLOR_BASELINE} strokeWidth={2} dot={false} />
                                </LineChart>
                            </ResponsiveContainer>
                        )}
                    </div>

                    {/* Overpayment calculator */}
                    <div className="bg-card rounded-xl border border-line p-5">
                        <h3 className="text-lg font-bold text-ink flex items-center gap-2 mb-3">
                            <Zap className="h-5 w-5 text-accent" /> Overpayment calculator
                        </h3>
                        {!overpay ? (
                            <p className="text-sm text-ink-faint text-center py-10">Add a loan to model overpayments</p>
                        ) : (
                            <>
                                <div className="flex items-end gap-3 mb-4 flex-wrap">
                                    <div>
                                        <label className="text-xs text-ink-soft mb-1 block">Extra per month</label>
                                        <div className="relative">
                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint text-sm">£</span>
                                            <input type="number" step="25" min="0" value={overpayment}
                                                onChange={e => setOverpayment(e.target.value)} className={`${inputCls} pl-7 w-32`} />
                                        </div>
                                    </div>
                                    <div className="flex gap-1.5">
                                        {[100, 200, 500].map(v => (
                                            <button key={v} onClick={() => setOverpayment(v)}
                                                className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg border ${Number(overpayment) === v ? 'bg-accent text-paper border-accent' : 'border-line text-ink-soft hover:bg-paper'}`}>
                                                £{v}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="grid grid-cols-3 gap-3 mb-4 text-center">
                                    <div className="p-3 bg-paper rounded-lg">
                                        <p className="text-xs text-ink-soft">Paid off</p>
                                        <p className="text-lg font-bold text-ink">{overpay.scenario.payoffDate ? fmtMonth(overpay.scenario.payoffDate) : '—'}</p>
                                        <p className="text-xs text-ink-faint">{overpay.baseline.payoffDate ? `was ${fmtMonth(overpay.baseline.payoffDate)}` : ''}</p>
                                    </div>
                                    <div className="p-3 bg-paper rounded-lg">
                                        <p className="text-xs text-ink-soft">Sooner by</p>
                                        <p className="text-lg font-bold text-good">
                                            {overpay.monthsSaved !== null ? `${Math.floor(overpay.monthsSaved / 12)}y ${overpay.monthsSaved % 12}m` : '—'}
                                        </p>
                                        <p className="text-xs text-ink-faint">at +{fmtMoney(overpay.extra)}/mo</p>
                                    </div>
                                    <div className="p-3 bg-paper rounded-lg">
                                        <p className="text-xs text-ink-soft">Interest saved</p>
                                        <p className="text-lg font-bold text-good">{fmtCompact(overpay.interestSaved)}</p>
                                        <p className="text-xs text-ink-faint">{fmtCompact(overpay.scenario.totalInterest)} still to pay</p>
                                    </div>
                                </div>

                                <ResponsiveContainer width="100%" height={200}>
                                    <LineChart data={overpay.chart} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#eae5d6" vertical={false} />
                                        <XAxis dataKey="date" tickFormatter={(d) => d.slice(0, 4)} tick={{ fontSize: 11, fill: '#6e6a5b' }} minTickGap={40} />
                                        <YAxis tickFormatter={fmtCompact} tick={{ fontSize: 11, fill: '#6e6a5b' }} width={52} />
                                        <Tooltip {...chartTooltipProps} />
                                        <Legend wrapperStyle={{ fontSize: '12px' }} />
                                        <Line type="monotone" dataKey="baseline" name="Current payments" stroke={COLOR_BASELINE} strokeWidth={2} dot={false} />
                                        <Line type="monotone" dataKey="overpay" name={`+${fmtMoney(overpay.extra)}/mo`} stroke={COLOR_OVERPAY} strokeWidth={2} dot={false} />
                                    </LineChart>
                                </ResponsiveContainer>
                                <p className="text-xs text-ink-faint mt-2">
                                    Both loans are treated as one combined balance and payment at a balance-weighted rate
                                    ({overpay.combined.interest_rate_pct.toFixed(2)}%). Check your deal's annual overpayment
                                    allowance (typically 10%) before committing.
                                </p>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default MortgagePage;
