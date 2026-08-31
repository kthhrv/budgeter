import React, { useState } from 'react';
import { Home, User, ChevronDown } from 'lucide-react';
import { money, BILL_CATEGORIES } from '../utils/helpers';
import BudgetItemRow from './BudgetItemRow';

const ACCENTS = {
    joint: { top: 'border-t-accent', avatar: 'bg-accent/10 text-accent', name: 'text-accent-strong', value: 'text-accent-strong', foot: 'bg-accent/5', fill: 'bg-accent', Icon: Home },
    keith: { top: 'border-t-keith',  avatar: 'bg-keith-soft text-keith', name: 'text-keith',        value: 'text-keith',         foot: 'bg-keith-soft/60', fill: 'bg-keith', Icon: User },
    tild:  { top: 'border-t-tild',   avatar: 'bg-tild-soft text-tild',   name: 'text-tild',         value: 'text-tild',          foot: 'bg-tild-soft/60',  fill: 'bg-tild',  Icon: User },
};
const TONE = { income: 'text-good', expense: 'text-danger', savings: 'text-keith' };

const sum = (rows) => rows.reduce((s, r) => s + (parseFloat(r.effective_value) || 0), 0);

// One owner's whole picture in a single card: an elevated "left over" figure, a
// commitment meter, and Income / Expenses / Savings sections with inline subtotals.
const OwnerCard = ({ config, items, searchTerm = '', currentDate, isEditingDisabled, onEditCategory, onDelete }) => {
    const { Icon, ...a } = ACCENTS[config.accent];
    const [collapsed, setCollapsed] = useState({});
    // Category groups inside Expenses start collapsed; {} means all closed.
    const [expandedCats, setExpandedCats] = useState({});

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
        <section className={`bg-card rounded-xl border border-line border-t-[3px] ${a.top} flex flex-col pb-3`}>
            <div className="flex items-start justify-between gap-3 p-4 pb-2">
                <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`h-8 w-8 rounded-lg grid place-items-center flex-shrink-0 ${a.avatar}`}><Icon className="h-4 w-4" /></span>
                    <div className="min-w-0">
                        <h3 className={`font-bold leading-tight truncate ${a.name}`}>{config.name}</h3>
                        <span className="block text-[11px] font-medium text-ink-faint truncate">{config.sub}</span>
                    </div>
                </div>
                <div className="text-right flex-shrink-0">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{config.remainingLabel}</div>
                    <div className={`text-xl font-bold num ${remPositive ? a.value : 'text-danger'}`}>{money(config.remaining)}</div>
                </div>
            </div>

            <div className="px-4">
                <div className="h-1.5 rounded-full bg-line/70 overflow-hidden"><div className={`h-full ${a.fill} rounded-full`} style={{ width: `${committedPct}%` }} /></div>
                <div className="mt-1 text-[11px] text-ink-faint flex justify-between">
                    <span>{committedPct.toFixed(0)}% committed</span>
                    <span className="num">{money(incomeTotal)} in</span>
                </div>
            </div>

            <div className="mx-4 mt-3 space-y-1.5">
                {config.transfer != null && (
                    <div className={`rounded-xl px-3 py-2.5 flex items-center justify-between text-sm ${a.foot}`}>
                        <span className="text-ink-soft">Transfer to joint</span>
                        <b className="num text-ink">{money(config.transfer)}</b>
                    </div>
                )}
                <div className={`rounded-xl px-3 py-2.5 flex items-center justify-between text-sm ${a.foot}`}>
                    <span className="text-ink-soft">Transfer to Bills pot</span>
                    <b className="num text-ink">{money(config.billsPot || 0)}</b>
                </div>
            </div>

            {sections.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-ink-faint">{q ? 'No matching items' : 'No items yet'}</p>
            ) : sections.map(s => {
                const isColl = collapsed[s.key];
                const renderRows = (rows) => rows.map(r => (
                    <BudgetItemRow
                        key={r.budget_item_id}
                        item={r}
                        onEditCategory={onEditCategory}
                        onDelete={onDelete}
                        currentDate={currentDate}
                        isEditingDisabled={isEditingDisabled}
                        hideOwnerBadge
                    />
                ));
                // Expenses are grouped into collapsible bill categories; items
                // without a category stay listed flat below the groups.
                const catGroups = s.key === 'expense'
                    ? BILL_CATEGORIES
                        .map(c => ({ ...c, rows: s.rows.filter(r => r.category === c.value) }))
                        .filter(c => c.rows.length > 0)
                    : [];
                const flatRows = s.key === 'expense'
                    ? s.rows.filter(r => !catGroups.some(c => c.value === r.category))
                    : s.rows;
                return (
                    <div key={s.key} className="px-4 py-2 mt-2 border-t border-line">
                        <button
                            onClick={() => setCollapsed(p => ({ ...p, [s.key]: !p[s.key] }))}
                            className="w-full flex items-center justify-between py-1.5"
                        >
                            <span className="text-[11px] font-bold uppercase tracking-wider text-ink-soft flex items-center gap-1.5">
                                <ChevronDown className={`h-3.5 w-3.5 text-ink-faint transition-transform ${isColl ? '-rotate-90' : ''}`} />{s.label}
                            </span>
                            <span className={`text-sm font-bold num ${TONE[s.key]}`}>{money(sum(s.rows))}</span>
                        </button>
                        {!isColl && (
                            <div>
                                {catGroups.length > 0 && (
                                    <div className="space-y-1 mb-1">
                                        {catGroups.map(c => {
                                            // Searching would hide matches inside closed
                                            // groups, so an active search opens them all.
                                            const open = !!q || expandedCats[c.value];
                                            return (
                                                <div key={c.value} className="rounded-lg bg-paper/70">
                                                    <button
                                                        onClick={() => setExpandedCats(p => ({ ...p, [c.value]: !p[c.value] }))}
                                                        className="w-full flex items-center justify-between px-2 py-2"
                                                    >
                                                        <span className="text-xs font-semibold text-ink-soft flex items-center gap-1.5">
                                                            <ChevronDown className={`h-3.5 w-3.5 text-ink-faint transition-transform ${open ? '' : '-rotate-90'}`} />
                                                            {c.label}
                                                            <span className="text-[11px] font-normal text-ink-faint">{c.rows.length}</span>
                                                        </span>
                                                        <span className="text-sm font-semibold num text-ink">{money(sum(c.rows))}</span>
                                                    </button>
                                                    {open && <div className="px-2 pb-1">{renderRows(c.rows)}</div>}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                                {renderRows(flatRows)}
                            </div>
                        )}
                    </div>
                );
            })}
        </section>
    );
};

export default OwnerCard;
