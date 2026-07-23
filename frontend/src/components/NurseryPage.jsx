import React, { useState, useEffect, useMemo, useRef } from 'react';
import apiService from '../services/api';
import { formatDate, getInitialDate } from '../utils/helpers';
import MonthSelector from './MonthSelector';
import { DAYS, SESSION_OPTIONS, computeMonthSummary, findEffectiveOverride } from '../utils/nurseryCalc';

// ------------------------- Persistent state -------------------------

const STORAGE_VERSION = 1;
const STORAGE_KEYS = ['ellis', 'gaspard', 'mil', 'taxFree', 'fullWeekModel', 'showBreakdown', 'adhoc'];
const storageKey = (k) => `nursery-calc-v${STORAGE_VERSION}:${k}`;

function readLocalStorageBlob() {
    const blob = {};
    for (const k of STORAGE_KEYS) {
        try {
            const stored = localStorage.getItem(storageKey(k));
            if (stored !== null) blob[k] = JSON.parse(stored);
        } catch { /* ignore parse errors */ }
    }
    return Object.keys(blob).length ? blob : null;
}

function clearAllStoredSettings() {
    try {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('nursery-calc-')) keys.push(k);
        }
        keys.forEach(k => localStorage.removeItem(k));
    } catch { /* ignore */ }
}

const DEFAULTS = {
    ellis: {
        ageBracket: '2-3',
        scheme: '30hr',
        schedule: ['fullDay', 'fullDay', 'fullDay', 'fullDay', 'fullDay'],
        siblingDiscount: false,
        showSibling: false,
    },
    gaspard: {
        ageBracket: '3-5',
        scheme: '30hr',
        schedule: ['fullDay', 'fullDay', 'fullDay', 'fullDay', 'fullDay'],
        siblingDiscount: true,
        showSibling: true,
    },
    mil: [0, 0, 0, 100, 50],
    taxFree: true,
    fullWeekModel: true,
    showBreakdown: true,
    adhoc: [],
};

const money = (n) => `£${n.toFixed(2)}`;

// ------------------------- UI building blocks -------------------------

function Toggle({ checked, onChange, label }) {
    return (
        <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="h-4 w-4 accent-amber-500" />
            <span className="text-sm text-gray-700">{label}</span>
        </label>
    );
}

function ChildCard({ title, accent, child, onUpdateChild, onSetSchedule }) {
    const update = (patch) => onUpdateChild(patch);
    const setDay = (i, v) => {
        const s = [...child.schedule]; s[i] = v;
        onSetSchedule(s);
    };

    return (
        <div className={`bg-white rounded-xl p-5 shadow-md border border-gray-100 border-t-4 ${accent}`}>
            <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-xl font-semibold text-gray-800">{title}</h2>
                <span className="text-xs text-gray-400">Busy Bees Tunbridge Wells</span>
            </div>

            <label className="text-sm block mb-4">
                <span className="block text-gray-500 mb-1">Age bracket</span>
                <select value={child.ageBracket} onChange={e => update({ ageBracket: e.target.value })}
                        className="w-full rounded-lg border border-gray-200 px-2 py-1.5 bg-white">
                    <option value="0-2">0–2 Year Olds</option>
                    <option value="2-3">2–3 Year Olds</option>
                    <option value="3-5">3–5 Year Olds</option>
                </select>
            </label>

            <div className="space-y-2 mb-3">
                <div className="text-sm font-medium text-gray-600">Attendance</div>
                {DAYS.map((d, i) => (
                    <div key={d} className="flex items-center gap-2">
                        <div className="w-24 text-sm text-gray-600">{d}</div>
                        <select value={child.schedule[i]} onChange={e => setDay(i, e.target.value)}
                                className="flex-1 rounded-lg border border-gray-200 px-2 py-1.5 bg-white text-sm">
                            {SESSION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    </div>
                ))}
            </div>

            {child.showSibling && (
                <div className="mb-3">
                    <Toggle checked={child.siblingDiscount}
                            onChange={v => update({ siblingDiscount: v })}
                            label="Apply 10% sibling discount" />
                </div>
            )}
        </div>
    );
}

// Placeholder shown in Gaspard's slot once he's left nursery for school.
function GaspardMovedCard() {
    return (
        <div className="bg-white rounded-xl p-5 shadow-md border border-gray-100 border-t-4 border-t-sky-400">
            <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-xl font-semibold text-gray-800">Gaspard</h2>
                <span className="text-xs text-gray-400">At school</span>
            </div>
            <p className="text-sm text-gray-500">
                Gaspard has left nursery. His breakfast, after-school and holiday-club
                costs are now on the <span className="font-medium text-indigo-600">Childcare</span> tab.
            </p>
        </div>
    );
}

const MIL_OPTIONS = [
    { value: 0,   label: 'None' },
    { value: 50,  label: 'Half day' },
    { value: 100, label: 'Full day' },
];

function MilPanel({ mil, setMil }) {
    return (
        <div className="bg-white rounded-xl p-5 shadow-md border border-gray-100">
            <h2 className="text-lg font-semibold text-gray-800 mb-1">Mother-in-law contribution</h2>
            <div className="grid grid-cols-5 gap-2 mt-3">
                {DAYS.map((d, i) => (
                    <label key={d} className="text-center">
                        <span className="block text-xs text-gray-500 mb-1">{d.slice(0, 3)}</span>
                        <select value={mil[i]}
                                onChange={e => {
                                    const n = [...mil]; n[i] = Number(e.target.value); setMil(n);
                                }}
                                className="w-full rounded-lg border border-gray-200 px-2 py-1.5 bg-white text-sm">
                            {MIL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    </label>
                ))}
            </div>
        </div>
    );
}

// ------------------------- Main page -------------------------

const NurseryPage = ({ onSettingsChange }) => {
    const [ellis, setEllis]                 = useState(DEFAULTS.ellis);
    const [gaspard, setGaspard]             = useState(DEFAULTS.gaspard);
    const [mil, setMil]                     = useState(DEFAULTS.mil);
    const [adhoc, setAdhoc]                 = useState(DEFAULTS.adhoc);
    // Billing model is fixed: always full-week model + tax-free childcare, and
    // the detailed monthly breakdown is always shown (the toggle panel was removed).
    const taxFree = true;
    const fullWeekModel = true;
    const showBreakdown = true;
    const [monthOverrides, setMonthOverrides] = useState({});
    // Non-nursery blob keys (e.g. `childcare`, owned by the Childcare tab) are
    // preserved verbatim so saving the nursery settings never wipes them.
    const [otherBlob, setOtherBlob]         = useState({});
    const [loaded, setLoaded]               = useState(false);
    const [currentDate, setCurrentDate]     = useState(() => getInitialDate());

    // Stay in sync with the URL hash so the Budget tab and Nursery tab
    // always show the same month.
    useEffect(() => {
        const sync = () => setCurrentDate(prev => {
            const next = getInitialDate();
            return prev.getTime() === next.getTime() ? prev : next;
        });
        window.addEventListener('hashchange', sync);
        return () => window.removeEventListener('hashchange', sync);
    }, []);

    const saveTimeout                       = useRef(null);

    // Currently displayed month, as YYYY-MM
    const monthKey = useMemo(() => formatDate(currentDate, 'YYYY-MM'), [currentDate]);

    // Latest override at or before the displayed month — edits propagate forward.
    const effEllisOverride   = findEffectiveOverride(monthOverrides, monthKey, 'ellis');
    const effGaspardOverride = findEffectiveOverride(monthOverrides, monthKey, 'gaspard');
    const effMilOverride     = findEffectiveOverride(monthOverrides, monthKey, 'mil');

    const effEllisSchedule   = effEllisOverride?.schedule   ?? ellis.schedule;
    const effGaspardSchedule = effGaspardOverride?.schedule ?? gaspard.schedule;
    const effMil             = effMilOverride               ?? mil;

    const setOverride = (key, value) => setMonthOverrides(prev => ({
        ...prev,
        [monthKey]: { ...(prev[monthKey] || {}), [key]: value },
    }));

    // Dispatch handlers — every edit creates/updates an override at the current month
    // so the change applies from this month forward (until the next override).
    const setEllisSchedule = (s) =>
        setOverride('ellis', { ...(effEllisOverride || {}), schedule: s });
    const setGaspardSchedule = (s) =>
        setOverride('gaspard', { ...(effGaspardOverride || {}), schedule: s });
    const setMilEffective = (m) =>
        setOverride('mil', m);

    // Load from server on mount; migrate any localStorage values found.
    useEffect(() => {
        let cancelled = false;
        const applyBlob = (blob) => {
            if (cancelled || !blob) return;
            if (blob.ellis)         setEllis(blob.ellis);
            if (blob.gaspard)       setGaspard(blob.gaspard);
            if (Array.isArray(blob.mil))       setMil(blob.mil);
            if (Array.isArray(blob.adhoc))     setAdhoc(blob.adhoc);
            if (blob.monthOverrides && typeof blob.monthOverrides === 'object') setMonthOverrides(blob.monthOverrides);
            setOtherBlob(blob); // keep the whole blob so we don't drop other tabs' keys
        };

        apiService.getNurserySettings().then(serverData => {
            if (cancelled) return;
            const hasServerData = serverData && Object.keys(serverData).length > 0;
            if (hasServerData) {
                applyBlob(serverData);
            } else {
                const local = readLocalStorageBlob();
                if (local) {
                    applyBlob(local);
                    apiService.updateNurserySettings(local).then(() => clearAllStoredSettings()).catch(() => {});
                }
            }
            setLoaded(true);
        }).catch(err => {
            console.error('Nursery settings load failed', err);
            setLoaded(true);
        });

        return () => { cancelled = true; };
    }, []);

    // Debounced save to the API + immediate notify of any parent (e.g. App.jsx)
    // that needs the latest settings in memory (so childcare-linked budget items
    // stay in sync without a round-trip through the API). Spread otherBlob first
    // so keys owned by other tabs (childcare) survive the save.
    useEffect(() => {
        if (!loaded) return;
        const blob = { ...otherBlob, ellis, gaspard, mil, taxFree, fullWeekModel, showBreakdown, adhoc, monthOverrides };
        if (onSettingsChange) onSettingsChange(blob);
        if (saveTimeout.current) clearTimeout(saveTimeout.current);
        saveTimeout.current = setTimeout(() => {
            apiService.updateNurserySettings(blob)
                .catch(err => console.error('Nursery settings save failed', err));
        }, 500);
        return () => { if (saveTimeout.current) clearTimeout(saveTimeout.current); };
    }, [loaded, otherBlob, ellis, gaspard, mil, taxFree, fullWeekModel, showBreakdown, adhoc, monthOverrides, onSettingsChange]);

    const calc = useMemo(() => {
        const settings = { ellis, gaspard, mil, taxFree, fullWeekModel, adhoc, monthOverrides, childcare: otherBlob.childcare };
        return computeMonthSummary(settings, currentDate);
    }, [ellis, gaspard, mil, taxFree, fullWeekModel, adhoc, monthOverrides, otherBlob, currentDate]);

    const gaspardInNursery = calc.effective.gaspardInNursery;

    return (
        <div>
            <div className="flex justify-center mb-4">
                <MonthSelector currentDate={currentDate} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 items-stretch">
                <div className="bg-gradient-to-br from-amber-400 to-amber-500 text-white rounded-xl p-5 shadow flex flex-col">
                    <div className="text-amber-50 text-lg font-semibold mb-2">Transfer to TFC</div>
                    {(() => {
                        const TFCAmount = ({ amount, saving, usedBefore, capped, periodLabel }) => {
                            const periodTotal = usedBefore + saving;
                            return (
                                <div className="relative inline-block group">
                                    <div className="text-2xl font-bold num cursor-help underline decoration-amber-50/40 decoration-dotted underline-offset-4">
                                        {money(amount)}
                                    </div>
                                    <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-2 z-10 hidden group-hover:block whitespace-nowrap rounded-lg bg-gray-900 text-white text-xs font-normal px-3 py-2 shadow-lg text-left">
                                        <div>£{saving.toFixed(2)} saved this month</div>
                                        <div className="text-gray-300">£{periodTotal.toFixed(2)} of £{calc.tfc.quarterlyCap} used ({periodLabel})</div>
                                        {capped && <div className="text-amber-300 mt-1">cap reached</div>}
                                    </div>
                                </div>
                            );
                        };
                        return (
                            <div className={`flex-1 grid ${gaspardInNursery ? 'grid-cols-2' : 'grid-cols-1'} gap-3 items-center`}>
                                <div className="text-center">
                                    <div className="text-amber-50 text-sm">Ellis</div>
                                    <div className="text-amber-50/80 text-xs num" title="TFC reference">1100116981235</div>
                                    <div className="mt-1">
                                        <TFCAmount amount={calc.ellisTFC}
                                                   saving={calc.tfc.ellisSaving}
                                                   usedBefore={calc.tfc.ellisUsedBefore}
                                                   capped={calc.tfc.ellisCapped}
                                                   periodLabel={calc.tfc.ellisPeriodLabel} />
                                    </div>
                                </div>
                                {gaspardInNursery && (
                                    <div className="text-center">
                                        <div className="text-amber-50 text-sm">Gaspard</div>
                                        <div className="text-amber-50/80 text-xs num" title="TFC reference">1100067930356</div>
                                        <div className="mt-1">
                                            <TFCAmount amount={calc.gaspardTFC}
                                                       saving={calc.tfc.gaspardSaving}
                                                       usedBefore={calc.tfc.gaspardUsedBefore}
                                                       capped={calc.tfc.gaspardCapped}
                                                       periodLabel={calc.tfc.gaspardPeriodLabel} />
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })()}
                </div>
                <div className="bg-gradient-to-br from-rose-400 to-rose-500 text-white rounded-xl p-5 shadow flex flex-col">
                    <div className="text-rose-50 text-lg font-semibold">MIL transfers</div>
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-3xl font-bold num">{money(calc.monthly.mil)}</div>
                    </div>
                </div>
                <div className="bg-gradient-to-br from-indigo-400 to-indigo-500 text-white rounded-xl p-5 shadow flex flex-col">
                    <div className="text-indigo-50 text-lg font-semibold">Total bill</div>
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-3xl font-bold num">{money(calc.monthly.gross)}</div>
                    </div>
                </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4 mb-4 items-start">
                <ChildCard
                    title="Ellis" accent="border-t-amber-400"
                    child={{ ...ellis, schedule: effEllisSchedule }}
                    onUpdateChild={(patch) => setEllis(prev => ({ ...prev, ...patch }))}
                    onSetSchedule={setEllisSchedule}
                />
                {gaspardInNursery ? (
                    <ChildCard
                        title="Gaspard" accent="border-t-sky-400"
                        child={{ ...gaspard, schedule: effGaspardSchedule }}
                        onUpdateChild={(patch) => setGaspard(prev => ({ ...prev, ...patch }))}
                        onSetSchedule={setGaspardSchedule}
                    />
                ) : (
                    <GaspardMovedCard />
                )}
            </div>

            <div className="mb-4">
                <MilPanel mil={effMil} setMil={setMilEffective} />
            </div>

            {showBreakdown && (
                <div className="bg-white rounded-xl p-5 shadow-md border border-gray-100 mb-4">
                    <h2 className="text-lg font-semibold text-gray-800 mb-3">Breakdown for {calc.monthLabel}</h2>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-gray-500 border-b">
                                    <th className="py-2 pr-3">Day</th>
                                    <th className="py-2 pr-3 text-right">× count</th>
                                    <th className="py-2 pr-3">Sessions</th>
                                    <th className="py-2 pr-3 text-right">Ellis</th>
                                    {gaspardInNursery && <th className="py-2 pr-3 text-right">Gaspard</th>}
                                    {gaspardInNursery && <th className="py-2 pr-3 text-right">Combined</th>}
                                    <th className="py-2 pr-3 text-right">MIL transfers</th>
                                    <th className="py-2 text-right">You pay</th>
                                </tr>
                            </thead>
                            <tbody>
                                {DAYS.map((d, i) => {
                                    const md = calc.monthlyDaily[i];
                                    const eType = md.eFundedType;
                                    const gType = md.gFundedType;
                                    const eFunded = md.eFundedHrs;
                                    const gFunded = md.gFundedHrs;
                                    const labelFor = (type, hrs, who) => {
                                        if (type === 'none') return null;
                                        const short = type === 'fullDay' ? 'Full day' : type === 'morning' ? 'Morning' : 'Afternoon';
                                        const hrsLabel = hrs ? ` · ${(+hrs.toFixed(2)).toString()}h funded` : '';
                                        return `${who}: ${short}${hrsLabel}`;
                                    };
                                    const eSession = labelFor(eType, eFunded, 'E');
                                    const gSession = labelFor(gType, gFunded, 'G');
                                    const totalCount = md.nFunded + md.nStandard;
                                    const countLabel = (md.nStandard > 0 || md.nBankHols > 0)
                                        ? <span>
                                            {totalCount}
                                            {(md.nStandard > 0 || md.nBankHols > 0) &&
                                                <span className="text-gray-400 text-xs"
                                                      title={`${md.nFundNorm} funded normal + ${md.nBankHols} bank hol + ${md.nStandard} standard (1–7 Apr / 25–31 Dec)`}>
                                                    {' '}({md.nFundNorm}
                                                    {md.nBankHols > 0 && <span className="text-rose-500">+{md.nBankHols}BH</span>}
                                                    {md.nStandard > 0 && <span>+<i>{md.nStandard}</i></span>}
                                                    )
                                                </span>}
                                        </span>
                                        : <span>{md.nFunded}</span>;
                                    return (
                                        <tr key={d} className="border-b last:border-none align-top">
                                            <td className="py-2 pr-3 font-medium">{d}</td>
                                            <td className="py-2 pr-3 text-right num text-gray-700">{countLabel}</td>
                                            <td className="py-2 pr-3 text-gray-600 text-xs leading-tight">
                                                {eSession && <div>{eSession}</div>}
                                                {gSession && <div>{gSession}</div>}
                                                {!eSession && !gSession && <div className="text-gray-400">–</div>}
                                            </td>
                                            <td className="py-2 pr-3 text-right num">
                                                {md.eMonthlyGross === 0
                                                    ? '–'
                                                    : ellis.siblingDiscount
                                                        ? <span title={`Before 10% sibling discount: ${money(md.eMonthlyGross)}`}>{money(md.eMonthlyNet)}</span>
                                                        : money(md.eMonthlyGross)}
                                            </td>
                                            {gaspardInNursery && (
                                                <td className="py-2 pr-3 text-right num">
                                                    {md.gMonthlyGross === 0
                                                        ? '–'
                                                        : gaspard.siblingDiscount
                                                            ? <span title={`Before 10% sibling discount: ${money(md.gMonthlyGross)}`}>{money(md.gMonthlyNet)}</span>
                                                            : money(md.gMonthlyGross)}
                                                </td>
                                            )}
                                            {gaspardInNursery && (
                                                <td className="py-2 pr-3 text-right num font-medium">{md.combined === 0 ? '–' : money(md.combined)}</td>
                                            )}
                                            <td className="py-2 pr-3 text-right num text-rose-600">{md.milPay > 0 ? `−${money(md.milPay)}` : '–'}</td>
                                            <td className="py-2 text-right num font-medium text-amber-700">{md.parentPay > 0 ? money(md.parentPay) : '–'}</td>
                                        </tr>
                                    );
                                })}

                                {calc.monthAdhocs.length > 0 && (
                                    <tr className="bg-amber-50">
                                        <td colSpan={gaspardInNursery ? 8 : 6} className="py-2 pr-3 text-xs font-semibold text-amber-700 uppercase tracking-wide">
                                            Ad-hoc days
                                        </td>
                                    </tr>
                                )}
                                {calc.monthAdhocs.map(a => (
                                    <tr key={a.id} className="border-b last:border-none bg-amber-50/50 align-top">
                                        <td className="py-2 pr-3 font-medium">{a.date}</td>
                                        <td className="py-2 pr-3 text-right num text-gray-700">1</td>
                                        <td className="py-2 pr-3 text-gray-600 text-xs leading-tight">
                                            {a.child === 'ellis' ? 'E' : 'G'}: {a.type === 'fullDay' ? 'Full day' : a.type === 'morning' ? 'Morning' : 'Afternoon'} · ad-hoc · {a.ageBracket}
                                        </td>
                                        <td className="py-2 pr-3 text-right num">{a.eGross === 0 ? '–' : (ellis.siblingDiscount ? money(a.eNet) : money(a.eGross))}</td>
                                        {gaspardInNursery && (
                                            <td className="py-2 pr-3 text-right num">{a.gGross === 0 ? '–' : (gaspard.siblingDiscount ? money(a.gNet) : money(a.gGross))}</td>
                                        )}
                                        {gaspardInNursery && (
                                            <td className="py-2 pr-3 text-right num font-medium">{money(a.combined)}</td>
                                        )}
                                        <td className="py-2 pr-3 text-right num text-rose-600">{a.milPay > 0 ? `−${money(a.milPay)}` : '–'}</td>
                                        <td className="py-2 text-right num font-medium text-amber-700">{a.parentPay > 0 ? money(a.parentPay) : '–'}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="font-semibold border-t-2">
                                    <td className="py-2 pr-3" colSpan="3">{calc.monthLabel} total</td>
                                    <td className="py-2 pr-3 text-right num">
                                        {money(
                                            calc.monthlyDaily.reduce((a, m) => a + m.eMonthlyNet, 0)
                                            + calc.monthAdhocs.reduce((a, x) => a + x.eNet, 0)
                                        )}
                                    </td>
                                    {gaspardInNursery && (
                                        <td className="py-2 pr-3 text-right num">
                                            {money(
                                                calc.monthlyDaily.reduce((a, m) => a + m.gMonthlyNet, 0)
                                                + calc.monthAdhocs.reduce((a, x) => a + x.gNet, 0)
                                            )}
                                        </td>
                                    )}
                                    {gaspardInNursery && (
                                        <td className="py-2 pr-3 text-right num">{money(calc.monthly.gross)}</td>
                                    )}
                                    <td className="py-2 pr-3 text-right num text-rose-600">−{money(calc.monthly.mil)}</td>
                                    <td className="py-2 text-right num text-amber-700">{money(calc.monthly.parentOOP)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    <div className="mt-5">
                        <div className="bg-white border border-gray-200 rounded-xl p-4">
                            <div className="text-sm font-semibold text-gray-700 mb-3">Invoice from nursery</div>
                            {(() => {
                                const eFactor = calc.tfc.ellisFactor;
                                const gFactor = calc.tfc.gaspardFactor;
                                const ellisMIL = calc.monthlyDaily.reduce((a, m, i) => a + m.eMonthlyNet * (effMil[i] / 100), 0) * eFactor
                                    + calc.monthAdhocs.reduce((a, x) => a + x.eNet * (x.milPct / 100), 0) * eFactor;
                                const gaspardMIL = calc.monthlyDaily.reduce((a, m, i) => a + m.gMonthlyNet * (effMil[i] / 100), 0) * gFactor
                                    + calc.monthAdhocs.reduce((a, x) => a + x.gNet * (x.milPct / 100), 0) * gFactor;
                                const ellisTotal   = calc.ellisInvoiced;
                                const gaspardTotal = calc.gaspardInvoiced;
                                const total        = calc.totalInvoiced;
                                const totalMIL     = ellisMIL + gaspardMIL;
                                return (
                                    <table className="w-full text-sm num">
                                        <thead>
                                            <tr className="text-gray-500 text-xs">
                                                <th className="text-left font-medium pb-1">Child</th>
                                                <th className="text-right font-medium pb-1">Invoiced</th>
                                                <th className="text-right font-medium pb-1">Transfer to TFC</th>
                                                <th className="text-right font-medium pb-1">MIL covers</th>
                                                <th className="text-right font-medium pb-1">Actual total</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr><td className="py-1">Ellis{calc.tfc.ellisCapped && <span className="ml-1 text-[10px] text-amber-700" title={`TFC cap hit (£${calc.tfc.quarterlyCap} max saving for ${calc.tfc.ellisPeriodLabel})`}>· capped</span>}</td><td className="text-right py-1">{money(ellisTotal)}</td><td className="text-right py-1 text-emerald-700">{money(calc.ellisTFC)}</td><td className="text-right py-1 text-rose-600">{money(ellisMIL)}</td><td className="text-right py-1">{money(calc.ellisTFC - ellisMIL)}</td></tr>
                                            {gaspardInNursery && (
                                                <tr><td className="py-1">Gaspard{calc.tfc.gaspardCapped && <span className="ml-1 text-[10px] text-amber-700" title={`TFC cap hit (£${calc.tfc.quarterlyCap} max saving for ${calc.tfc.gaspardPeriodLabel})`}>· capped</span>}</td><td className="text-right py-1">{money(gaspardTotal)}</td><td className="text-right py-1 text-emerald-700">{money(calc.gaspardTFC)}</td><td className="text-right py-1 text-rose-600">{money(gaspardMIL)}</td><td className="text-right py-1">{money(calc.gaspardTFC - gaspardMIL)}</td></tr>
                                            )}
                                        </tbody>
                                        <tfoot>
                                            <tr className="font-semibold border-t">
                                                <td className="pt-1">Total</td>
                                                <td className="text-right pt-1">{money(total)}</td>
                                                <td className="text-right pt-1 text-emerald-700">{money(calc.totalTFC)}</td>
                                                <td className="text-right pt-1 text-rose-600">{money(totalMIL)}</td>
                                                <td className="text-right pt-1">{money(calc.totalTFC - totalMIL)}</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                );
                            })()}
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};

export default NurseryPage;
