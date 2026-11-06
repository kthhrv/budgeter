import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Circle, Clock, AlertCircle, RefreshCw, Link2 } from 'lucide-react';
import apiService from '../services/api';
import MonthSelector from './MonthSelector';
import Sheet from './Sheet';
import PayeeLinkModal from './PayeeLinkModal';
import PayeeSearch from './PayeeSearch';
import BillsPotCard from './BillsPotCard';
import { formatDate, money } from '../utils/helpers';
import {
    monthWeeks, todayIso, entriesByDay, withChildcareAmounts, ordinal, METHOD_LABELS,
} from '../utils/calendarGrid';

const AUTO_SYNC_AFTER_MS = 60 * 60 * 1000;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const STATUS = {
    paid: { Icon: Check, text: 'text-good', dot: 'bg-good', label: 'Paid' },
    upcoming: { Icon: Circle, text: 'text-ink-faint', dot: 'bg-ink-faint/50', label: 'Upcoming' },
    due: { Icon: Clock, text: 'text-accent', dot: 'bg-accent', label: 'Due' },
    overdue: { Icon: AlertCircle, text: 'text-warn', dot: 'bg-warn', label: 'Not seen yet' },
};

const OWNER_TEXT = { shared: 'Joint', keith: 'Keith', tild: 'Tild' };

const fmtDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

function StatusIcon({ status, className = 'h-3.5 w-3.5' }) {
    const { Icon, text, label } = STATUS[status] || STATUS.upcoming;
    return <Icon className={`${className} ${text} shrink-0`} aria-label={label} />;
}

function EntryRow({ entry, onOpen }) {
    const p = entry.payment;
    const differs = p?.amount != null && Math.abs(p.amount - entry.expected_amount) > 0.005;
    const incoming = entry.item_type === 'income';
    return (
        <button type="button" onClick={() => onOpen(entry)} data-testid="calendar-entry"
            className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-line/40 rounded-lg px-2 -mx-2 transition-colors">
            <StatusIcon status={entry.status} className="h-4 w-4" />
            <span className="grow min-w-0">
                <span className="block text-sm font-medium text-ink truncate">{entry.item_name}</span>
                <span className="block text-xs text-ink-faint">
                    {OWNER_TEXT[entry.owner]} · {p?.payee || (entry.payee_match ? `matches “${entry.payee_match}”` : 'not linked to a payee')}
                </span>
            </span>
            <span className="text-right">
                <span className={`num block text-sm ${incoming ? 'text-good' : 'text-ink'}`}>{incoming ? '+' : ''}{money(p?.amount ?? entry.expected_amount)}</span>
                {differs && <span className="num block text-xs text-warn">budget {money(entry.expected_amount)}</span>}
            </span>
        </button>
    );
}

function EntrySheet({ entry, onClose, onChanged, showToast }) {
    const [day, setDay] = useState(entry?.payment_day_manual ? String(entry.payment_day || '') : '');
    const [busy, setBusy] = useState(false);
    const [searching, setSearching] = useState(false);

    useEffect(() => {
        setDay(entry?.payment_day_manual ? String(entry.payment_day || '') : '');
        // Nothing found to tick it off? Open the payee search straight away.
        setSearching(!entry?.payee_match);
    }, [entry]);

    if (!entry) return null;
    const p = entry.payment;
    const isFixed = entry.calculation_type === 'fixed';

    const run = async (fn, message) => {
        setBusy(true);
        try {
            await fn();
            showToast(message);
            onChanged();
            onClose();
        } catch (e) {
            showToast(e.message, 'error');
        } finally {
            setBusy(false);
        }
    };

    const saveDay = () => {
        const dayNum = parseInt(day, 10);
        const payload = isNaN(dayNum)
            ? { payment_day_manual: false }
            : { payment_day: dayNum, payment_day_manual: true };
        run(() => apiService.linkItemPayment(entry.budget_item_id, payload), isNaN(dayNum) ? 'Day will be learned from payments' : `Pinned to the ${ordinal(dayNum)}`);
    };
    const incoming = entry.item_type === 'income';

    return (
        <Sheet isOpen onClose={onClose} title={entry.item_name}>
            <dl className="grid grid-cols-2 gap-y-2 text-sm mb-5">
                <dt className="text-ink-soft">Status</dt>
                <dd className="flex items-center gap-1.5"><StatusIcon status={entry.status} />{STATUS[entry.status]?.label}</dd>
                <dt className="text-ink-soft">Due</dt>
                <dd>{fmtDay(entry.due_date)}{entry.due_date !== entry.scheduled_date && <span className="text-ink-faint"> (scheduled {fmtDay(entry.scheduled_date)})</span>}</dd>
                <dt className="text-ink-soft">Budgeted</dt>
                <dd className="num">{money(entry.expected_amount)}</dd>
                {p && <>
                    <dt className="text-ink-soft">{entry.item_type === 'income' ? 'Received' : 'Paid'}</dt>
                    <dd className="num">{p.amount != null ? `${money(p.amount)} on ${fmtDay(p.date)}` : 'Marked paid by hand'}</dd>
                    {p.payee && <><dt className="text-ink-soft">Payee</dt><dd>{p.payee}</dd></>}
                </>}
                {entry.payment_method && <><dt className="text-ink-soft">Method</dt><dd>{METHOD_LABELS[entry.payment_method]}</dd></>}
            </dl>

            <div className="flex flex-wrap gap-2 mb-6">
                {!p && (
                    <button type="button" disabled={busy}
                        onClick={() => run(() => apiService.markPaid(entry.budget_item_id, entry.due_date), entry.item_type === 'income' ? 'Marked as received' : 'Marked as paid')}
                        className="px-4 py-2 rounded-xl bg-accent text-paper text-sm font-medium hover:bg-accent-strong active:scale-[0.98] disabled:opacity-50">
                        {entry.item_type === 'income' ? 'Mark as received' : 'Mark as paid'}
                    </button>
                )}
                {p && p.source !== 'auto' && (
                    <button type="button" disabled={busy}
                        onClick={() => run(() => apiService.unmarkPaid(p.id), 'Tick removed')}
                        className="px-4 py-2 rounded-xl border border-line text-sm hover:bg-line/50 disabled:opacity-50">
                        Undo tick
                    </button>
                )}
            </div>

            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-2">Matching</h3>
            {entry.payee_match ? (
                <div className="flex flex-wrap items-center gap-2 mb-3 text-sm">
                    <span className="text-ink-soft">Matches payee</span>
                    <span className="px-2 py-0.5 rounded-md bg-line/70 text-ink font-medium">{entry.payee_match}</span>
                    {!searching && (
                        <button type="button" onClick={() => setSearching(true)} className="text-accent hover:underline">Change</button>
                    )}
                    <button type="button" disabled={busy}
                        onClick={() => run(() => apiService.unlinkItemPayment(entry.budget_item_id), 'Payee unlinked')}
                        className="text-danger hover:underline disabled:opacity-50">
                        Unlink
                    </button>
                </div>
            ) : (
                <p className="text-sm text-ink-soft mb-2">
                    Not linked to a Monzo payee yet. Find {incoming ? 'where it comes from' : 'who it’s paid to'} — the name in Monzo is often different from the budget item’s.
                </p>
            )}
            {searching && (
                <div className="mb-5">
                    <PayeeSearch itemId={entry.budget_item_id} expectedAmount={entry.expected_amount} incoming={incoming}
                        onLinked={() => { onChanged(); onClose(); }} showToast={showToast} />
                </div>
            )}
            {isFixed && (
                <div className="flex flex-wrap items-end gap-2">
                    <div>
                        <label className="block text-sm text-ink-soft mb-1" htmlFor="payment-day">Day of month <span className="text-ink-faint">(blank = learn it)</span></label>
                        <input id="payment-day" type="number" min="1" max="31" inputMode="numeric" value={day} onChange={e => setDay(e.target.value)}
                            className="w-24 px-3 py-2 rounded-lg border border-line bg-paper text-sm num focus:outline-none focus:ring-2 focus:ring-accent/40" />
                    </div>
                    <button type="button" disabled={busy} onClick={saveDay}
                        className="px-4 py-2 rounded-xl border border-line text-sm hover:bg-line/50 disabled:opacity-50">
                        Save day
                    </button>
                </div>
            )}
        </Sheet>
    );
}

const CalendarPage = ({ currentDate, childcareNets, showToast, onNotificationsChanged, refreshKey = 0 }) => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [selectedDay, setSelectedDay] = useState(null);
    const [openEntry, setOpenEntry] = useState(null);
    const [linkOpen, setLinkOpen] = useState(false);
    const autoSynced = useRef(false);
    const monthId = formatDate(currentDate, 'YYYY-MM');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            await apiService.createOrGetMonth(currentDate);
            const cal = await apiService.getPaymentCalendar(monthId);
            setData(cal);
            return cal;
        } catch (e) {
            showToast(e.message, 'error');
            return null;
        } finally {
            setLoading(false);
        }
    }, [currentDate, monthId, showToast]);

    const sync = useCallback(async (silent = false) => {
        setSyncing(true);
        try {
            const r = await apiService.syncPayments();
            if (r.errors.length) showToast(r.errors.join(' · '), 'error');
            else if (!silent) showToast(r.matched ? `Synced — ${r.matched} new payment${r.matched === 1 ? '' : 's'} ticked off` : 'Synced — nothing new');
            await load();
            onNotificationsChanged?.();
        } catch (e) {
            if (!silent) showToast(e.message, 'error');
        } finally {
            setSyncing(false);
        }
    }, [load, onNotificationsChanged, showToast]);

    useEffect(() => {
        load().then(cal => {
            if (!cal || autoSynced.current || !cal.connected) return;
            autoSynced.current = true;
            const last = cal.last_synced_at ? new Date(cal.last_synced_at).getTime() : 0;
            if (Date.now() - last > AUTO_SYNC_AFTER_MS) sync(true);
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [monthId]);

    // A notification action (reconcile, mark paid, link) changed what's shown.
    const firstRefresh = useRef(true);
    useEffect(() => {
        if (firstRefresh.current) { firstRefresh.current = false; return; }
        load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshKey]);

    const entries = useMemo(() => withChildcareAmounts(data?.entries || [], childcareNets), [data, childcareNets]);
    const unscheduled = useMemo(() => withChildcareAmounts(data?.unscheduled || [], childcareNets), [data, childcareNets]);
    const byDay = useMemo(() => entriesByDay(entries), [entries]);
    const weeks = useMemo(() => monthWeeks(currentDate.getFullYear(), currentDate.getMonth()), [currentDate]);
    const today = todayIso();

    useEffect(() => {
        // Default the day list to today in the current month, else the first day with payments.
        const inMonth = today.startsWith(monthId);
        setSelectedDay(inMonth ? today : (entries[0]?.due_date || null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [monthId, data]);

    const totals = useMemo(() => {
        const t = { expected: 0, paid: 0, incomeExpected: 0, received: 0, overdue: 0 };
        for (const e of entries) {
            const done = e.payment ? (e.payment.amount ?? e.expected_amount) : 0;
            if (e.item_type === 'income') { t.incomeExpected += e.expected_amount; t.received += done; } else { t.expected += e.expected_amount; t.paid += done; }
            if (e.status === 'overdue') t.overdue += 1;
        }
        return t;
    }, [entries]);

    const linkableItems = useMemo(() => {
        const seen = new Map();
        for (const e of [...(data?.entries || []), ...(data?.unscheduled || [])]) {
            if (!e.payee_match && !seen.has(e.budget_item_id)) seen.set(e.budget_item_id, { id: e.budget_item_id, name: e.item_name, incoming: e.item_type === 'income' });
        }
        return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
    }, [data]);

    const dayEntries = selectedDay ? (byDay[selectedDay] || []) : [];
    const lastSynced = data?.last_synced_at
        ? new Date(data.last_synced_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
        : null;

    return (
        <div className="animate-fadeIn">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] md:items-center gap-3 mb-5">
                <div className="hidden md:block" />
                <div className="flex justify-center"><MonthSelector currentDate={currentDate} isLoading={loading} /></div>
                <div className="flex items-center gap-2 md:justify-end">
                    {data?.connected && (
                        <button type="button" onClick={() => sync(false)} disabled={syncing}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-line bg-card text-sm text-ink-soft hover:bg-line/50 disabled:opacity-60"
                            title={lastSynced ? `Last synced ${lastSynced}` : 'Never synced'}>
                            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} /> Sync
                        </button>
                    )}
                    <button type="button" onClick={() => setLinkOpen(true)} disabled={!data?.connected && !data?.has_transactions}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-paper text-sm font-medium hover:bg-accent-strong active:scale-[0.98] disabled:opacity-50">
                        <Link2 className="h-4 w-4" /> Link payees
                    </button>
                </div>
            </div>

            {data && !data.connected && !data.has_transactions && (
                <p className="mb-4 rounded-xl border border-line bg-card px-4 py-3 text-sm text-ink-soft">
                    Connect Monzo from the FIRE tab and payments will tick themselves off here. Until then you can still set a day on an item and tick it by hand.
                </p>
            )}
            {data?.connected && !data.history_backfilled && (
                <p className="mb-4 rounded-xl border border-line bg-warn-soft px-4 py-3 text-sm text-ink-soft">
                    Only the last 90 days of payments are loaded. For a year of history (better suggestions), disconnect and reconnect Monzo on the FIRE tab, approve in the Monzo app, then open this tab within a few minutes.
                </p>
            )}

            {data?.connected && today.startsWith(monthId) && (
                <BillsPotCard entries={entries} unscheduled={unscheduled} showToast={showToast} />
            )}

            <div className="flex flex-wrap gap-x-6 gap-y-1 mb-3 text-sm text-ink-soft">
                <span>Paid <span className="num text-ink">{money(totals.paid)}</span> of <span className="num text-ink">{money(totals.expected)}</span></span>
                {totals.incomeExpected > 0 && <span>Received <span className="num text-good">{money(totals.received)}</span> of <span className="num text-ink">{money(totals.incomeExpected)}</span></span>}
                {totals.overdue > 0 && <span className="text-warn">{totals.overdue} not seen yet</span>}
                {lastSynced && <span className="text-ink-faint">Synced {lastSynced}</span>}
            </div>

            <div className="grid lg:grid-cols-[1fr_20rem] gap-5 items-start">
                <div className="bg-card border border-line rounded-2xl overflow-hidden">
                    <div className="grid grid-cols-7 border-b border-line text-xs text-ink-faint">
                        {WEEKDAYS.map(d => <div key={d} className="px-2 py-2 text-center sm:text-left">{d}</div>)}
                    </div>
                    {weeks.map((week, wi) => (
                        <div key={wi} className="grid grid-cols-7 border-b border-line last:border-b-0">
                            {week.map((day, di) => {
                                if (!day) return <div key={di} className="min-h-14 sm:min-h-24 bg-paper/60 border-r border-line last:border-r-0" />;
                                const list = byDay[day] || [];
                                const isToday = day === today;
                                const isSelected = day === selectedDay;
                                return (
                                    <button key={di} type="button" onClick={() => setSelectedDay(day)} data-testid={`day-${day}`}
                                        aria-label={`${fmtDay(day)}: ${list.length} payment${list.length === 1 ? '' : 's'}`}
                                        className={`min-h-14 sm:min-h-24 p-1.5 flex flex-col items-start justify-start text-left border-r border-line last:border-r-0 transition-colors ${isSelected ? 'bg-accent/10' : 'hover:bg-line/40'}`}>
                                        <span className={`num inline-flex items-center justify-center h-6 w-6 rounded-full text-xs ${isToday ? 'bg-accent text-paper font-semibold' : 'text-ink-soft'}`}>
                                            {Number(day.slice(8))}
                                        </span>
                                        {/* Phones: one dot per payment. */}
                                        <span className="flex flex-wrap gap-1 mt-1 sm:hidden">
                                            {list.map((e, i) => <span key={i} className={`h-1.5 w-1.5 rounded-full ${STATUS[e.status].dot}`} />)}
                                        </span>
                                        {/* Wider: named chips. */}
                                        <span className="hidden sm:flex flex-col gap-0.5 mt-1 w-full min-w-0">
                                            {list.slice(0, 3).map((e, i) => (
                                                <span key={i} className="flex items-center gap-1 text-[11px] leading-tight text-ink truncate">
                                                    <StatusIcon status={e.status} className="h-3 w-3" />
                                                    <span className="truncate">{e.item_name}</span>
                                                </span>
                                            ))}
                                            {list.length > 3 && <span className="text-[11px] text-ink-faint">+{list.length - 3} more</span>}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                </div>

                <div className="flex flex-col gap-5">
                    <section className="bg-card border border-line rounded-2xl px-4 py-3">
                        <h2 className="font-serif italic text-xl text-accent-strong mb-1">{selectedDay ? fmtDay(selectedDay) : 'Pick a day'}</h2>
                        {dayEntries.length === 0
                            ? <p className="text-sm text-ink-faint py-2">Nothing due.</p>
                            : dayEntries.map((e, i) => <EntryRow key={i} entry={e} onOpen={setOpenEntry} />)}
                    </section>

                    {unscheduled.length > 0 && (
                        <section className="bg-card border border-line rounded-2xl px-4 py-3">
                            <h2 className="font-serif italic text-xl text-accent-strong">Unscheduled</h2>
                            <p className="text-xs text-ink-faint mb-1">No day known yet — link a payee or set a day.</p>
                            {unscheduled.map(u => (
                                <button key={u.budget_item_id} type="button" data-testid="unscheduled-item"
                                    onClick={() => setOpenEntry({ ...u, status: 'upcoming', due_date: null, scheduled_date: null, payment: null, unscheduled: true })}
                                    className="w-full flex justify-between py-2 text-sm text-left hover:bg-line/40 rounded-lg px-2 -mx-2">
                                    <span className="truncate">{u.item_name}</span>
                                    <span className="num text-ink-soft">{money(u.expected_amount)}</span>
                                </button>
                            ))}
                        </section>
                    )}
                </div>
            </div>

            {openEntry && !openEntry.unscheduled && (
                <EntrySheet entry={openEntry} onClose={() => setOpenEntry(null)} onChanged={load} showToast={showToast} />
            )}
            {openEntry?.unscheduled && (
                <UnscheduledSheet item={openEntry} onClose={() => setOpenEntry(null)} onChanged={load} showToast={showToast} />
            )}
            <PayeeLinkModal isOpen={linkOpen} onClose={() => setLinkOpen(false)} items={linkableItems}
                onLinked={() => { load(); onNotificationsChanged?.(); }} showToast={showToast} />
        </div>
    );
};

function UnscheduledSheet({ item, onClose, onChanged, showToast }) {
    const [day, setDay] = useState('');
    const [busy, setBusy] = useState(false);
    const incoming = item.item_type === 'income';
    const saveDay = async () => {
        const dayNum = parseInt(day, 10);
        setBusy(true);
        try {
            await apiService.linkItemPayment(item.budget_item_id, { payment_day: dayNum, payment_day_manual: true });
            showToast(`Scheduled for the ${ordinal(dayNum)}`);
            onChanged();
            onClose();
        } catch (e) {
            showToast(e.message, 'error');
        } finally {
            setBusy(false);
        }
    };
    return (
        <Sheet isOpen onClose={onClose} title={item.item_name}>
            <p className="text-sm text-ink-soft mb-3">
                Budgeted <span className="num">{money(item.expected_amount)}</span> a month. Find it in your Monzo {incoming ? 'income' : 'payments'} and the day is learned from them — the name in Monzo is often different from the budget item’s.
            </p>
            <div className="mb-5">
                <PayeeSearch itemId={item.budget_item_id} expectedAmount={item.expected_amount} incoming={incoming}
                    onLinked={() => { onChanged(); onClose(); }} showToast={showToast} />
            </div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-2">Or set the day yourself</h3>
            <div className="flex flex-wrap items-end gap-2">
                <div>
                    <label className="block text-sm text-ink-soft mb-1" htmlFor="u-day">Day of month</label>
                    <input id="u-day" type="number" min="1" max="31" inputMode="numeric" value={day} onChange={e => setDay(e.target.value)}
                        className="w-24 px-3 py-2 rounded-lg border border-line bg-paper text-sm num focus:outline-none focus:ring-2 focus:ring-accent/40" />
                </div>
                <button type="button" onClick={saveDay} disabled={busy || !day}
                    className="px-4 py-2 rounded-xl border border-line text-sm hover:bg-line/50 disabled:opacity-50">
                    Save day
                </button>
            </div>
        </Sheet>
    );
}

export default CalendarPage;
