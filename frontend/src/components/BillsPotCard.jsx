import React, { useCallback, useEffect, useMemo, useState } from 'react';
import apiService from '../services/api';
import { money } from '../utils/helpers';
import { billsLeftToPay } from '../utils/calendarGrid';
import BalanceSummary from './BalanceSummary';

// The bills pot's live Monzo balance against what's still to pay from it.
// Shown for the current month only (the balance is live). The pot is chosen
// once and shared by the household.
const BillsPotCard = ({ entries, unscheduled, showToast, syncKey = 0 }) => {
    const [pot, setPot] = useState(undefined); // undefined = loading, null = not linked
    const [choices, setChoices] = useState(null);

    const load = useCallback(async () => {
        try {
            const r = await apiService.getPotBalances();
            setPot(r.pots.bills ?? null);
            if (r.errors.length) showToast(r.errors.join(' · '), 'error');
        } catch (e) {
            showToast(e.message, 'error');
            setPot(null);
        }
    }, [showToast]);

    // Re-read the live balance on load and after every Sync.
    useEffect(() => { load(); }, [load, syncKey]);

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

    return (
        <BalanceSummary title={`${pot.name} pot`} balance={pot.balance} left={left} testId="bills-pot"
            actions={<button type="button" onClick={choose} className="text-ink-faint hover:text-ink">Change</button>} />
    );
};

export default BillsPotCard;
