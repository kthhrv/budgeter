import React, { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import apiService from '../services/api';
import { money } from '../utils/helpers';
import { ordinal, METHOD_LABELS } from '../utils/calendarGrid';

const fmtDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

// Find the Monzo payee for an item whose name doesn't match it ("Broadband"
// is paid to "SKY DIGITAL"). Opens with payments of the budgeted amount, then
// searches by whatever name is typed. Picking a result links the item to it.
const PayeeSearch = ({ itemId, expectedAmount, incoming = false, onLinked, showToast }) => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState(null);
    const [label, setLabel] = useState('');
    const [busy, setBusy] = useState(false);

    const run = useCallback(async (q) => {
        const byAmount = !q.trim();
        if (byAmount && !expectedAmount) { setResults(null); return; }
        setLabel(byAmount ? `${incoming ? 'Money in' : 'Payments'} of ${money(expectedAmount)}` : `Payees matching “${q.trim()}”`);
        setResults(undefined);
        try {
            setResults(await apiService.searchPayees(q.trim(), byAmount ? expectedAmount : null, incoming));
        } catch (e) {
            showToast(e.message, 'error');
            setResults([]);
        }
    }, [expectedAmount, incoming, showToast]);

    useEffect(() => { run(''); }, [run]);

    const use = async (r) => {
        setBusy(true);
        try {
            const out = await apiService.linkItemPayment(itemId, { payee_match: r.payee_key });
            showToast(out.payment_day ? `Linked to ${r.payee} — usually the ${ordinal(out.payment_day)}` : `Linked to ${r.payee}`);
            onLinked();
        } catch (e) {
            showToast(e.message, 'error');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div>
            <form className="flex gap-2 mb-2" onSubmit={(e) => { e.preventDefault(); run(query); }}>
                <label htmlFor={`payee-search-${itemId}`} className="sr-only">Search Monzo payees</label>
                <input id={`payee-search-${itemId}`} value={query} onChange={e => setQuery(e.target.value)}
                    placeholder={incoming ? 'Name as it appears in Monzo, e.g. ACME PAYROLL' : 'Name as it appears in Monzo, e.g. SKY'}
                    className="grow min-w-0 px-3 py-2 rounded-lg border border-line bg-paper text-sm focus:outline-none focus:ring-2 focus:ring-accent/40" />
                <button type="submit" className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-line text-sm text-ink-soft hover:bg-line/50">
                    <Search className="h-4 w-4" /> Search
                </button>
            </form>
            {results !== null && <p className="text-xs text-ink-faint mb-1">{label}</p>}
            {results === undefined && <p className="text-sm text-ink-faint py-2">Searching…</p>}
            {results?.length === 0 && (
                <p className="text-sm text-ink-faint py-2">No {incoming ? 'money in' : 'payments'} found in the last year{query.trim() ? ' — try part of the name, or another word from it' : ' at that amount — search by name instead'}.</p>
            )}
            {results?.length > 0 && (
                <ul className="divide-y divide-line">
                    {results.map(r => (
                        <li key={r.payee_key} className="py-2 flex items-center gap-3" data-testid="payee-result">
                            <span className="grow min-w-0">
                                <span className="block text-sm font-medium text-ink truncate">{r.payee}</span>
                                <span className="block text-xs text-ink-faint">
                                    {r.count} × · last <span className="num">{money(r.last_amount)}</span> on {fmtDay(r.last_date)}
                                    {r.usual_day ? ` · usually the ${ordinal(r.usual_day)}` : ''}
                                    {r.payment_method ? ` · ${METHOD_LABELS[r.payment_method] || ''}` : ''}
                                </span>
                                {r.linked_item && <span className="block text-xs text-warn">Already linked to {r.linked_item}</span>}
                            </span>
                            <button type="button" disabled={busy} onClick={() => use(r)}
                                className="shrink-0 px-3 py-1.5 rounded-lg bg-accent text-paper text-sm font-medium hover:bg-accent-strong active:scale-[0.98] disabled:opacity-50">
                                Use this
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default PayeeSearch;
