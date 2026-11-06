import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import apiService from '../services/api';
import { money } from '../utils/helpers';
import { billsLeftToPay } from '../utils/calendarGrid';

// The bills pot's live Monzo balance against what's still to pay from it.
// Shown for the current month only (the balance is live). The pot is chosen
// once and shared by the household.
const BillsPotCard = ({ entries, unscheduled, showToast }) => {
    const [pot, setPot] = useState(undefined); // undefined = loading, null = not linked
    const [choices, setChoices] = useState(null);
    const [loading, setLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const r = await apiService.getPotBalances();
            setPot(r.pots.bills ?? null);
            if (r.errors.length) showToast(r.errors.join(' · '), 'error');
        } catch (e) {
            showToast(e.message, 'error');
            setPot(null);
        } finally {
            setLoading(false);
        }
    }, [showToast]);

    useEffect(() => { load(); }, [load]);

    const choose = async () => {
        try {
            setChoices(await apiService.getAvailablePots());
        } catch (e) {
            showToast(e.message, 'error');
        }
    };

    const link = async (potId) => {
        try {
            await apiService.linkBudgetPot('bills', potId);
            setChoices(null);
            await load();
        } catch (e) {
            showToast(e.message, 'error');
        }
    };

    const left = useMemo(() => billsLeftToPay(entries, unscheduled), [entries, unscheduled]);

    if (pot === undefined) return null;

    if (choices) {
        return (
            <section className="mb-4 rounded-2xl border border-line bg-card px-4 py-3">
                <p className="text-sm text-ink-soft mb-2">Which Monzo pot holds the bills money?</p>
                <div className="flex flex-wrap gap-2">
                    {choices.map(p => (
                        <button key={p.id} type="button" onClick={() => link(p.id)}
                            className="px-3 py-1.5 rounded-lg border border-line text-sm hover:bg-line/50">
                            {p.name} <span className="num text-ink-faint">{money(p.balance)}</span>
                        </button>
                    ))}
                    <button type="button" onClick={() => setChoices(null)} className="px-3 py-1.5 text-sm text-ink-faint hover:text-ink">Cancel</button>
                </div>
            </section>
        );
    }

    if (pot === null) {
        return (
            <section className="mb-4 rounded-2xl border border-line bg-card px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-ink-soft">
                    Bills left to pay this month: <span className="num text-ink">{money(left.total)}</span>. Pick the Bills pot to see whether its balance covers it.
                </p>
                <button type="button" onClick={choose} className="px-3 py-1.5 rounded-lg bg-accent text-paper text-sm font-medium hover:bg-accent-strong active:scale-[0.98]">
                    Choose Bills pot
                </button>
            </section>
        );
    }

    const diff = pot.balance - left.total;
    const short = diff < -0.005;
    return (
        <section className="mb-4 rounded-2xl border border-line bg-card px-4 py-3" data-testid="bills-pot">
            <div className="flex items-center justify-between mb-2">
                <h2 className="font-serif italic text-xl text-accent-strong">{pot.name} pot</h2>
                <span className="flex items-center gap-3 text-xs">
                    <button type="button" onClick={load} disabled={loading} className="flex items-center gap-1 text-ink-faint hover:text-ink" title="Refresh balance">
                        <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
                    </button>
                    <button type="button" onClick={choose} className="text-ink-faint hover:text-ink">Change</button>
                </span>
            </div>
            <dl className="grid grid-cols-3 gap-3">
                <div>
                    <dt className="text-xs text-ink-faint">Balance</dt>
                    <dd className="num text-lg text-ink">{money(pot.balance)}</dd>
                </div>
                <div>
                    <dt className="text-xs text-ink-faint">Left to pay</dt>
                    <dd className="num text-lg text-ink">{money(left.total)}</dd>
                    {left.undated > 0 && <dd className="text-[11px] text-ink-faint">incl. {money(left.undated)} with no day</dd>}
                </div>
                <div>
                    <dt className="text-xs text-ink-faint">{short ? 'Short by' : 'Spare'}</dt>
                    <dd className={`num text-lg font-semibold ${short ? 'text-warn' : 'text-good'}`}>{money(Math.abs(diff))}</dd>
                </div>
            </dl>
        </section>
    );
};

export default BillsPotCard;
