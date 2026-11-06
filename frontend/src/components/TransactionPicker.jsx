import React, { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import apiService from '../services/api';
import { money } from '../utils/helpers';

const fmtDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

// Pick the Monzo payment(s) that paid this occurrence — every payment around
// its date is listed separately, so a second mortgage part or one of two
// British Gas bills can be added by hand. Opens on the item's own payee.
const TransactionPicker = ({ entry, onLinked, showToast }) => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState(undefined);
    const [busy, setBusy] = useState(false);

    const run = useCallback(async (q) => {
        setResults(undefined);
        try {
            setResults(await apiService.getCandidatePayments(entry.budget_item_id, entry.due_date, q.trim()));
        } catch (e) {
            showToast(e.message, 'error');
            setResults([]);
        }
    }, [entry.budget_item_id, entry.due_date, showToast]);

    useEffect(() => { run(''); }, [run]);

    const add = async (tx) => {
        setBusy(true);
        try {
            const r = await apiService.linkTransaction(entry.budget_item_id, entry.due_date, tx.id);
            showToast(r.linked > 1 ? `Linked — ${r.linked} payments now count towards ${entry.item_name}` : `Linked to ${entry.item_name}`);
            onLinked();
        } catch (e) {
            showToast(e.message, 'error');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div data-testid="transaction-picker">
            <form className="flex gap-2 mb-2" onSubmit={(e) => { e.preventDefault(); run(query); }}>
                <label htmlFor={`tx-search-${entry.budget_item_id}`} className="sr-only">Search Monzo payments</label>
                <input id={`tx-search-${entry.budget_item_id}`} value={query} onChange={e => setQuery(e.target.value)}
                    placeholder="Payee name, if it's not the linked one"
                    className="grow min-w-0 px-3 py-2 rounded-lg border border-line bg-paper text-sm focus:outline-none focus:ring-2 focus:ring-accent/40" />
                <button type="submit" className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-line text-sm text-ink-soft hover:bg-line/50">
                    <Search className="h-4 w-4" /> Search
                </button>
            </form>
            <p className="text-xs text-ink-faint mb-1">Payments within 10 days of {fmtDay(entry.due_date)}</p>
            {results === undefined && <p className="text-sm text-ink-faint py-2">Loading…</p>}
            {results?.length === 0 && <p className="text-sm text-ink-faint py-2">None found{query.trim() ? '' : ' for the linked payee — search by name'}.</p>}
            {results?.length > 0 && (
                <ul className="divide-y divide-line">
                    {results.map(t => {
                        const here = t.linked_item_id === entry.budget_item_id;
                        return (
                            <li key={t.id} className="py-2 flex items-center gap-3" data-testid="candidate-payment">
                                <span className="grow min-w-0">
                                    <span className="block text-sm text-ink truncate">{t.payee}</span>
                                    <span className="block text-xs text-ink-faint">
                                        {fmtDay(t.date)}
                                        {t.linked_item && !here && <span className="text-warn"> · counted for {t.linked_item}</span>}
                                    </span>
                                </span>
                                <span className="num text-sm text-ink">{money(t.amount)}</span>
                                {here
                                    ? <span className="shrink-0 w-20 text-right text-xs text-good">Linked</span>
                                    : (
                                        <button type="button" disabled={busy} onClick={() => add(t)}
                                            className="shrink-0 w-20 px-3 py-1.5 rounded-lg bg-accent text-paper text-sm font-medium hover:bg-accent-strong active:scale-[0.98] disabled:opacity-50">
                                            {t.linked_item ? 'Move' : 'Add'}
                                        </button>
                                    )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
};

export default TransactionPicker;
