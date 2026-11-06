import React from 'react';
import { RefreshCw } from 'lucide-react';
import { money } from '../utils/helpers';

const fmtDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

// Balance / Left to pay / Spare-or-short, shared by the Calendar's balance
// cards (the bills pot in the Joint view, a personal account otherwise).
const BalanceSummary = ({ title, balance, left, loading, onRefresh, actions = null, testId }) => {
    const diff = balance - left.total;
    const short = diff < -0.005;
    return (
        <section className="mb-4 rounded-2xl border border-line bg-card px-4 py-3" data-testid={testId}>
            <div className="flex items-center justify-between mb-2">
                <h2 className="font-serif italic text-xl text-accent-strong">{title}</h2>
                <span className="flex items-center gap-3 text-xs">
                    <button type="button" onClick={onRefresh} disabled={loading} className="flex items-center gap-1 text-ink-faint hover:text-ink" title="Refresh balance">
                        <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
                    </button>
                    {actions}
                </span>
            </div>
            <dl className="grid grid-cols-3 gap-3">
                <div>
                    <dt className="text-xs text-ink-faint">Balance</dt>
                    <dd className="num text-lg text-ink">{money(balance)}</dd>
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
            {left.items?.length > 0 && (
                <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-ink-faint hover:text-ink">What’s left to pay ({left.items.length})</summary>
                    <ul className="mt-1 divide-y divide-line">
                        {left.items.map(i => (
                            <li key={i.key} className="flex justify-between gap-3 py-1 text-sm">
                                <span className="truncate">{i.name} <span className="text-xs text-ink-faint">{i.due ? fmtDay(i.due) : 'no day'}</span></span>
                                <span className="num text-ink-soft">{money(i.amount)}</span>
                            </li>
                        ))}
                    </ul>
                </details>
            )}
        </section>
    );
};

export default BalanceSummary;
