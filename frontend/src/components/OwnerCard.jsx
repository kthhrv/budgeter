import React, { useState } from 'react';
import { Home, User, ChevronDown } from 'lucide-react';
import { money } from '../utils/helpers';
import BudgetItemRow from './BudgetItemRow';

const ACCENTS = {
    joint: { top: 'border-t-violet-400', avatar: 'bg-violet-100 text-violet-600', name: 'text-violet-700', value: 'text-violet-700', foot: 'bg-violet-50', fill: 'bg-violet-400', Icon: Home },
    keith: { top: 'border-t-blue-400',   avatar: 'bg-blue-100 text-blue-600',     name: 'text-blue-700',   value: 'text-blue-700',   foot: 'bg-blue-50',   fill: 'bg-blue-400',   Icon: User },
    tild:  { top: 'border-t-pink-400',   avatar: 'bg-pink-100 text-pink-600',     name: 'text-pink-700',   value: 'text-pink-700',   foot: 'bg-pink-50',   fill: 'bg-pink-400',   Icon: User },
};
const TONE = { income: 'text-emerald-600', expense: 'text-red-500', savings: 'text-sky-600' };

const sum = (rows) => rows.reduce((s, r) => s + (parseFloat(r.effective_value) || 0), 0);

// One owner's whole picture in a single card: an elevated "left over" figure, a
// commitment meter, and Income / Expenses / Savings sections with inline subtotals.
const OwnerCard = ({ config, items, searchTerm = '', currentDate, isEditingDisabled, onEditCategory, onDelete }) => {
    const { Icon, ...a } = ACCENTS[config.accent];
    const [collapsed, setCollapsed] = useState({});

    const q = searchTerm.trim().toLowerCase();
    const matches = (i) => !q || i.item_name.toLowerCase().includes(q) || (i.owner || '').toLowerCase().includes(q);

    const pick = (type) => items
        .filter(i => i.item_type === type && i.owner === config.key)
        .sort((x, y) => (parseFloat(y.effective_value) || 0) - (parseFloat(x.effective_value) || 0));

    let income = pick('income');
    if (config.key === 'shared' && config.contributions > 0) {
        income = [{
            budget_item_id: 'joint-contributions', item_name: 'From Keith & Tild',
            item_type: 'income', owner: 'shared', effective_value: config.contributions,
            calculation_type: 'fixed', is_computed: true,
        }, ...income];
    }

    const sections = [
        { key: 'income', label: 'Income', rows: income },
        { key: 'expense', label: 'Expenses', rows: pick('expense') },
        { key: 'savings', label: 'Savings', rows: pick('savings') },
    ].map(s => ({ ...s, rows: s.rows.filter(matches) })).filter(s => s.rows.length > 0);

    const incomeTotal = sum(income);
    const committedPct = incomeTotal > 0
        ? Math.max(0, Math.min(100, ((incomeTotal - config.remaining) / incomeTotal) * 100))
        : 0;
    const remPositive = config.remaining >= 0;

    return (
        <section className={`bg-white rounded-xl shadow-md border border-gray-100 border-t-[3px] ${a.top} flex flex-col pb-3`}>
            <div className="flex items-start justify-between gap-3 p-4 pb-2">
                <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`h-8 w-8 rounded-lg grid place-items-center flex-shrink-0 ${a.avatar}`}><Icon className="h-4 w-4" /></span>
                    <div className="min-w-0">
                        <h3 className={`font-bold leading-tight truncate ${a.name}`}>{config.name}</h3>
                        <span className="block text-[11px] font-medium text-gray-400 truncate">{config.sub}</span>
                    </div>
                </div>
                <div className="text-right flex-shrink-0">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{config.remainingLabel}</div>
                    <div className={`text-xl font-bold num ${remPositive ? a.value : 'text-red-600'}`}>{money(config.remaining)}</div>
                </div>
            </div>

            <div className="px-4">
                <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${a.fill} rounded-full`} style={{ width: `${committedPct}%` }} /></div>
                <div className="mt-1 text-[11px] text-gray-400 flex justify-between">
                    <span>{committedPct.toFixed(0)}% committed</span>
                    <span className="num">{money(incomeTotal)} in</span>
                </div>
            </div>

            {config.transfer != null && (
                <div className={`mx-4 mt-3 rounded-xl px-3 py-2.5 flex items-center justify-between text-sm ${a.foot}`}>
                    <span className="text-gray-500">Transfer to joint</span>
                    <b className="num text-gray-700">{money(config.transfer)}</b>
                </div>
            )}

            {sections.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-gray-400">{q ? 'No matching items' : 'No items yet'}</p>
            ) : sections.map(s => {
                const isColl = collapsed[s.key];
                return (
                    <div key={s.key} className="px-4 py-2 mt-2 border-t border-gray-100">
                        <button
                            onClick={() => setCollapsed(p => ({ ...p, [s.key]: !p[s.key] }))}
                            className="w-full flex items-center justify-between py-1.5"
                        >
                            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
                                <ChevronDown className={`h-3.5 w-3.5 text-gray-400 transition-transform ${isColl ? '-rotate-90' : ''}`} />{s.label}
                            </span>
                            <span className={`text-sm font-bold num ${TONE[s.key]}`}>{money(sum(s.rows))}</span>
                        </button>
                        {!isColl && (
                            <div>
                                {s.rows.map(r => (
                                    <BudgetItemRow
                                        key={r.budget_item_id}
                                        item={r}
                                        onEditCategory={onEditCategory}
                                        onDelete={onDelete}
                                        currentDate={currentDate}
                                        isEditingDisabled={isEditingDisabled}
                                        hideOwnerBadge
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
        </section>
    );
};

export default OwnerCard;
