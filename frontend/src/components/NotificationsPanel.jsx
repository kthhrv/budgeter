import React, { useState } from 'react';
import { TrendingUp, AlertCircle, Sparkles } from 'lucide-react';
import apiService from '../services/api';
import Sheet from './Sheet';
import { money } from '../utils/helpers';
import { METHOD_LABELS, cadenceText } from '../utils/calendarGrid';

const fmtDay = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');

const primary = 'px-3 py-1.5 rounded-lg bg-accent text-paper text-sm font-medium hover:bg-accent-strong active:scale-[0.98] disabled:opacity-50';
const secondary = 'px-3 py-1.5 rounded-lg border border-line text-sm text-ink-soft hover:bg-line/50 disabled:opacity-50';

function Card({ n, items, onAction, busy }) {
    const d = n.data || {};
    const [itemId, setItemId] = useState('');
    const can = (a) => n.actions.includes(a);

    if (n.kind === 'amount_changed') {
        const up = d.actual > d.expected;
        return (
            <li className="py-4 border-b border-line last:border-b-0" data-testid="notification">
                <div className="flex gap-3">
                    <TrendingUp className={`h-5 w-5 shrink-0 mt-0.5 ${up ? 'text-warn' : 'text-good'} ${up ? '' : 'rotate-180'}`} />
                    <div className="grow">
                        <p className="text-sm text-ink"><span className="font-semibold">{d.item_name}</span> was <span className="num">{money(d.actual)}</span>, not <span className="num">{money(d.expected)}</span></p>
                        <p className="text-xs text-ink-faint mb-3">{d.payee} · {fmtDay(d.payment_date)} · {n.month_name}</p>
                        <div className="flex flex-wrap gap-2">
                            {can('reconcile') && (
                                <button type="button" className={primary} disabled={busy} onClick={() => onAction(n, 'reconcile')}>
                                    Reconcile budget to {money(d.actual)}
                                </button>
                            )}
                            {can('one_off') && <button type="button" className={secondary} disabled={busy} onClick={() => onAction(n, 'one_off')}>Just this month</button>}
                            {can('dismiss') && <button type="button" className={secondary} disabled={busy} onClick={() => onAction(n, 'dismiss')}>Dismiss</button>}
                        </div>
                    </div>
                </div>
            </li>
        );
    }

    if (n.kind === 'missed') {
        return (
            <li className="py-4 border-b border-line last:border-b-0" data-testid="notification">
                <div className="flex gap-3">
                    <AlertCircle className="h-5 w-5 shrink-0 mt-0.5 text-warn" />
                    <div className="grow">
                        <p className="text-sm text-ink"><span className="font-semibold">{d.item_name}</span> (<span className="num">{money(d.expected)}</span>) was due {fmtDay(d.due_date)} and {d.incoming ? "hasn't arrived" : "hasn't gone out"}</p>
                        <p className="text-xs text-ink-faint mb-3">{d.incoming ? 'Late, changed, or paid in some other way?' : 'Cancelled, failed, or paid some other way?'}</p>
                        <div className="flex flex-wrap gap-2">
                            {can('mark_paid') && <button type="button" className={primary} disabled={busy} onClick={() => onAction(n, 'mark_paid')}>{d.incoming ? 'Mark as received' : 'Mark as paid'}</button>}
                            {can('dismiss') && <button type="button" className={secondary} disabled={busy} onClick={() => onAction(n, 'dismiss')}>Dismiss</button>}
                        </div>
                    </div>
                </div>
            </li>
        );
    }

    return (
        <li className="py-4 border-b border-line last:border-b-0" data-testid="notification">
            <div className="flex gap-3">
                <Sparkles className="h-5 w-5 shrink-0 mt-0.5 text-accent" />
                <div className="grow min-w-0">
                    <p className="text-sm text-ink">New regular {d.incoming ? 'income' : 'payment'}: <span className="font-semibold">{d.payee}</span> <span className="num">{money(d.amount)}</span></p>
                    <p className="text-xs text-ink-faint mb-3">{cadenceText(d)} · {METHOD_LABELS[d.payment_method] || 'Payment'}</p>
                    <div className="flex flex-wrap gap-2 items-center">
                        <select value={itemId} onChange={e => setItemId(e.target.value)} aria-label={`Budget item for ${d.payee}`}
                            className="grow min-w-0 px-2 py-1.5 rounded-lg border border-line bg-paper text-sm">
                            <option value="">Pick a budget item…</option>
                            {items.filter(i => Boolean(i.incoming) === Boolean(d.incoming)).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                        </select>
                        <button type="button" className={primary} disabled={busy || !itemId} onClick={() => onAction(n, 'link', itemId)}>Link</button>
                        <button type="button" className={secondary} disabled={busy} onClick={() => onAction(n, 'dismiss')}>Not a budget item</button>
                    </div>
                </div>
            </div>
        </li>
    );
}

const SUCCESS = {
    reconcile: 'Budget updated',
    one_off: 'Set for this month only',
    mark_paid: 'Marked as paid',
    link: 'Linked',
    dismiss: 'Dismissed',
};

const NotificationsPanel = ({ isOpen, onClose, notifications, items, onChanged, showToast }) => {
    const [busyId, setBusyId] = useState(null);

    const onAction = async (n, action, itemId) => {
        setBusyId(n.id);
        try {
            await apiService.notificationAction(n.id, action, itemId);
            showToast(SUCCESS[action]);
            onChanged(action);
        } catch (e) {
            showToast(e.message, 'error');
        } finally {
            setBusyId(null);
        }
    };

    return (
        <Sheet isOpen={isOpen} onClose={onClose} title="Notifications" labelId="notifications-title">
            {notifications.length === 0
                ? <p className="text-sm text-ink-faint py-6 text-center">All caught up.</p>
                : <ul>{notifications.map(n => <Card key={n.id} n={n} items={items} onAction={onAction} busy={busyId === n.id} />)}</ul>}
        </Sheet>
    );
};

export default NotificationsPanel;
