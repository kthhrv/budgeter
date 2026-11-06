import React, { useEffect, useState } from 'react';
import apiService from '../services/api';
import Sheet from './Sheet';
import { money } from '../utils/helpers';
import { cadenceText, METHOD_LABELS } from '../utils/calendarGrid';


// One row per recurring Monzo payee that isn't linked yet. The dropdown starts
// on the suggested item; when two items fit equally (same amount, no name
// match) it starts empty so the person picks.
function SuggestionRow({ s, items, onDone, showToast }) {
    const [itemId, setItemId] = useState(s.suggested_item_id || '');
    const [busy, setBusy] = useState(false);
    const candidateIds = new Set(s.candidates.map(c => c.item_id));
    const ordered = [
        ...s.candidates.map(c => ({ id: c.item_id, name: `${c.name} (${money(c.amount)})` })),
        ...items.filter(i => !candidateIds.has(i.id) && Boolean(i.incoming) === Boolean(s.incoming)),
    ];

    const act = async (fn, msg) => {
        setBusy(true);
        try {
            await fn();
            showToast(msg);
            onDone(s.payee_key);
        } catch (e) {
            showToast(e.message, 'error');
            setBusy(false);
        }
    };

    return (
        <li className="py-3 border-b border-line last:border-b-0" data-testid="payee-suggestion">
            <div className="flex justify-between gap-3">
                <span className="font-medium text-ink truncate">{s.payee}{s.incoming && <span className="ml-2 text-xs font-normal text-good">money in</span>}</span>
                <span className={`num ${s.incoming ? 'text-good' : 'text-ink'}`}>{s.incoming ? '+' : ''}{money(s.amount)}</span>
            </div>
            <p className="text-xs text-ink-faint mb-2">
                {cadenceText(s)} · {METHOD_LABELS[s.payment_method] || 'Payment'} · {s.count} payments
                {s.ambiguous && <span className="text-warn"> · several items match — pick one</span>}
            </p>
            <div className="flex flex-wrap gap-2 items-center">
                <select value={itemId} onChange={e => setItemId(e.target.value)} aria-label={`Budget item for ${s.payee}`}
                    className="grow min-w-0 px-2 py-1.5 rounded-lg border border-line bg-paper text-sm">
                    <option value="">Pick a budget item…</option>
                    {ordered.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
                <button type="button" disabled={busy || !itemId}
                    onClick={() => act(() => apiService.linkItemPayment(itemId, { payee_match: s.payee_key }), `Linked ${s.payee}`)}
                    className="px-3 py-1.5 rounded-lg bg-accent text-paper text-sm font-medium hover:bg-accent-strong active:scale-[0.98] disabled:opacity-50">
                    Link
                </button>
                <button type="button" disabled={busy}
                    onClick={() => act(() => apiService.ignorePayee(s.payee_key), `${s.payee} won't be suggested again`)}
                    className="px-3 py-1.5 rounded-lg border border-line text-sm text-ink-soft hover:bg-line/50 disabled:opacity-50">
                    Not a budget item
                </button>
            </div>
        </li>
    );
}

const PayeeLinkModal = ({ isOpen, onClose, items, onLinked, showToast }) => {
    const [suggestions, setSuggestions] = useState(null);

    useEffect(() => {
        if (!isOpen) return;
        setSuggestions(null);
        apiService.getPayeeSuggestions()
            .then(setSuggestions)
            .catch(e => { showToast(e.message, 'error'); setSuggestions([]); });
    }, [isOpen, showToast]);

    const done = (key) => {
        setSuggestions(list => list.filter(s => s.payee_key !== key));
        onLinked?.();
    };

    return (
        <Sheet isOpen={isOpen} onClose={onClose} title="Link payees" wide labelId="link-payees-title">
            <p className="text-sm text-ink-soft mb-2">
                Regular payments from your Monzo history. Linking one ticks it off the calendar from now on and learns the day it goes out.
            </p>
            {suggestions === null && <p className="text-sm text-ink-faint py-4">Looking through payments…</p>}
            {suggestions?.length === 0 && <p className="text-sm text-ink-faint py-4">Nothing left to link.</p>}
            {suggestions?.length > 0 && (
                <ul>{suggestions.map(s => <SuggestionRow key={s.payee_key} s={s} items={items} onDone={done} showToast={showToast} />)}</ul>
            )}
        </Sheet>
    );
};

export default PayeeLinkModal;
