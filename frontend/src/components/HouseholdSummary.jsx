import React from 'react';
import { money } from '../utils/helpers';

const pct = (part, whole) => (whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0);

const Stat = ({ dot, label, value }) => (
    <div className="flex flex-col gap-0.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-sm ${dot}`} />{label}
        </span>
        <span className="text-2xl font-bold num text-gray-800">{money(value)}</span>
    </div>
);

const Legend = ({ dot, label, value }) => (
    <span className="inline-flex items-center gap-2">
        <span className={`inline-block h-2 w-2 rounded-sm ${dot}`} />{label}
        <b className="text-gray-700 font-semibold num">{money(value)}</b>
    </span>
);

// Household headline: money in, out, saved, and what's left over, with a single
// stacked bar showing how the month's income splits three ways.
const HouseholdSummary = ({ moneyIn, moneyOut, saved, leftOver }) => {
    const outPct = pct(moneyOut, moneyIn);
    const savedPct = pct(saved, moneyIn);
    const leftPct = Math.max(0, 100 - outPct - savedPct);
    const positive = leftOver >= 0;

    return (
        <section className="bg-white rounded-xl shadow-md border border-gray-100 p-5 md:p-6 mb-5">
            <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
                <Stat dot="bg-emerald-500" label="Money in" value={moneyIn} />
                <Stat dot="bg-red-500" label="Money out" value={moneyOut} />
                <Stat dot="bg-sky-500" label="Saved" value={saved} />
                <div className="ml-auto text-right">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Left over</span>
                    <div className={`text-3xl font-extrabold num ${positive ? 'text-indigo-600' : 'text-red-600'}`}>{money(leftOver)}</div>
                    <span className="text-xs text-gray-500 num">{leftPct.toFixed(0)}% of income</span>
                </div>
            </div>

            <div className="mt-5 flex h-3 rounded-lg overflow-hidden border border-gray-100 bg-gray-50">
                <span className="bg-red-500 h-full" style={{ width: `${outPct}%` }} />
                <span className="bg-sky-500 h-full" style={{ width: `${savedPct}%` }} />
                <span className="bg-indigo-500 h-full" style={{ width: `${leftPct}%` }} />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-500">
                <Legend dot="bg-red-500" label="Spent" value={moneyOut} />
                <Legend dot="bg-sky-500" label="Saved" value={saved} />
                <Legend dot="bg-indigo-500" label="Left over" value={leftOver} />
            </div>
        </section>
    );
};

export default HouseholdSummary;
