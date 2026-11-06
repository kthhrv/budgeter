import React from 'react';
import { RefreshCw } from 'lucide-react';
import { money } from '../utils/helpers';

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
        </section>
    );
};

export default BalanceSummary;
