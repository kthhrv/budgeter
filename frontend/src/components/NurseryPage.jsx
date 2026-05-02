import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import apiService from '../services/api';
import { formatDate, getInitialDate } from '../utils/helpers';
import {
    STANDARD_RATES, DAYS, SESSION_OPTIONS, BANK_HOLIDAYS,
    ymd, weeklyStretched, weeklyStandard, findEffectiveOverride,
} from '../utils/nurseryCalc';

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

function OverrideToggle({ hasOverride, monthLabel }) {
    if (!hasOverride) return null;
    return (
        <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium text-xs">
            Custom for {monthLabel}
        </span>
    );
}

function ChildCard({ title, accent, child, onUpdateChild, onSetSchedule, hasMonthOverride, monthLabel }) {
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

            <div className="grid grid-cols-2 gap-3 mb-4">
                <label className="text-sm">
                    <span className="block text-gray-500 mb-1">Age bracket</span>
                    <select value={child.ageBracket} onChange={e => update({ ageBracket: e.target.value })}
                            className="w-full rounded-lg border border-gray-200 px-2 py-1.5 bg-white">
                        <option value="0-2">0–2 Year Olds</option>
                        <option value="2-3">2–3 Year Olds</option>
                        <option value="3-5">3–5 Year Olds</option>
                    </select>
                </label>
                <label className="text-sm">
                    <span className="block text-gray-500 mb-1">Funded hours</span>
                    <select value={child.scheme} onChange={e => update({ scheme: e.target.value })}
                            className="w-full rounded-lg border border-gray-200 px-2 py-1.5 bg-white">
                        <option value="30hr">30 hours stretched (22.8/wk)</option>
                        <option value="15hr">15 hours stretched (11.4/wk)</option>
                        <option value="none">No funding</option>
                    </select>
                </label>
            </div>

            <div className="space-y-2 mb-3">
                <div className="flex items-baseline justify-between">
                    <div className="text-sm font-medium text-gray-600">Attendance</div>
                    <OverrideToggle hasOverride={hasMonthOverride} monthLabel={monthLabel} />
                </div>
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
                <Toggle checked={child.siblingDiscount}
                        onChange={v => update({ siblingDiscount: v })}
                        label="Apply 10% sibling discount" />
            )}
        </div>
    );
}

const MIL_OPTIONS = [
    { value: 0,   label: 'None' },
    { value: 50,  label: 'Half day' },
    { value: 100, label: 'Full day' },
];

function MilPanel({ mil, setMil, hasMonthOverride, monthLabel }) {
    return (
        <div className="bg-white rounded-xl p-5 shadow-md border border-gray-100">
            <div className="flex items-baseline justify-between mb-1">
                <h2 className="text-lg font-semibold text-gray-800">Mother-in-law contribution</h2>
                <OverrideToggle hasOverride={hasMonthOverride} monthLabel={monthLabel} />
            </div>
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

function AdHocPanel({ adhoc, addAdHoc, removeAdHoc, monthAdhocs, monthLabel }) {
    const today = new Date();
    const defaultDate = ymd(today.getFullYear(), today.getMonth(), today.getDate());
    const [form, setForm] = useState({
        date: defaultDate,
        child: 'ellis',
        type: 'fullDay',
        ageBracket: '2-3',
    });
    const upd = (patch) => setForm({ ...form, ...patch });

    return (
        <div className="bg-white rounded-xl p-5 shadow-md border border-gray-100">
            <h2 className="text-lg font-semibold text-gray-800 mb-3">Ad-hoc days</h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
                <label className="text-xs col-span-2">
                    <span className="block text-gray-500 mb-1">Date</span>
                    <input type="date" value={form.date} onChange={e => upd({ date: e.target.value })}
                           className="w-full rounded-lg border border-gray-200 px-2 py-1.5 bg-white text-sm" />
                </label>
                <label className="text-xs">
                    <span className="block text-gray-500 mb-1">Child</span>
                    <select value={form.child} onChange={e => upd({ child: e.target.value })}
                            className="w-full rounded-lg border border-gray-200 px-2 py-1.5 bg-white text-sm">
                        <option value="ellis">Ellis</option>
                        <option value="gaspard">Gaspard</option>
                    </select>
                </label>
                <label className="text-xs">
                    <span className="block text-gray-500 mb-1">Age</span>
                    <select value={form.ageBracket} onChange={e => upd({ ageBracket: e.target.value })}
                            className="w-full rounded-lg border border-gray-200 px-2 py-1.5 bg-white text-sm">
                        <option value="0-2">0–2</option>
                        <option value="2-3">2–3</option>
                        <option value="3-5">3–5</option>
                    </select>
                </label>
                <label className="text-xs">
                    <span className="block text-gray-500 mb-1">Session</span>
                    <select value={form.type} onChange={e => upd({ type: e.target.value })}
                            className="w-full rounded-lg border border-gray-200 px-2 py-1.5 bg-white text-sm">
                        <option value="fullDay">Full Day</option>
                        <option value="morning">Morning</option>
                        <option value="afternoon">Afternoon</option>
                    </select>
                </label>
            </div>
            <button
                onClick={() => addAdHoc({ ...form, id: Date.now() + Math.random() })}
                className="w-full text-sm font-medium bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-lg px-3 py-2 mb-3 active:scale-[0.98] transition-all">
                + Add ad-hoc day
            </button>

            {adhoc.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No ad-hoc days added.</p>
            ) : (
                <div>
                    <div className="text-xs font-medium text-gray-600 mb-1">
                        All ad-hoc days ({adhoc.length}){monthAdhocs.length !== adhoc.length &&
                            <span className="text-gray-400 font-normal"> · {monthAdhocs.length} in {monthLabel}</span>}
                    </div>
                    <ul className="text-xs space-y-1 max-h-40 overflow-y-auto">
                        {adhoc.slice().sort((a, b) => a.date.localeCompare(b.date)).map(a => {
                            const cost = STANDARD_RATES[a.ageBracket][a.type === 'fullDay' ? 'fullDay' : 'morning'];
                            const inMonth = monthAdhocs.some(m => m.id === a.id);
                            return (
                                <li key={a.id}
                                    className={`flex items-center justify-between rounded-lg px-2 py-1.5 ${inMonth ? 'bg-amber-50' : 'bg-gray-50'}`}>
                                    <span className="flex-1">
                                        <span className="font-medium">{a.date}</span>
                                        <span className="text-gray-500"> · {a.child === 'ellis' ? 'Ellis' : 'Gaspard'} · {a.type === 'fullDay' ? 'Full Day' : a.type === 'morning' ? 'Morning' : 'Afternoon'} · {a.ageBracket}</span>
                                    </span>
                                    <span className="num font-medium mr-2">{money(cost)}</span>
                                    <button onClick={() => removeAdHoc(a.id)}
                                            className="text-rose-500 hover:text-rose-700 text-base leading-none">×</button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}
        </div>
    );
}

// ------------------------- Main page -------------------------

const NurseryPage = () => {
    const [ellis, setEllis]                 = useState(DEFAULTS.ellis);
    const [gaspard, setGaspard]             = useState(DEFAULTS.gaspard);
    const [mil, setMil]                     = useState(DEFAULTS.mil);
    const [taxFree, setTaxFree]             = useState(DEFAULTS.taxFree);
    const [fullWeekModel, setFullWeekModel] = useState(DEFAULTS.fullWeekModel);
    const [showBreakdown, setShowBreakdown] = useState(DEFAULTS.showBreakdown);
    const [adhoc, setAdhoc]                 = useState(DEFAULTS.adhoc);
    const [monthOverrides, setMonthOverrides] = useState({});
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

    const changeMonth = (offset) => {
        const next = new Date(currentDate);
        next.setMonth(currentDate.getMonth() + offset);
        window.location.hash = formatDate(next, 'YYYY-MM');
    };

    const today = new Date();
    const isCurrentMonth = currentDate.getFullYear() === today.getFullYear()
                        && currentDate.getMonth() === today.getMonth();
    const saveTimeout                       = useRef(null);

    const addAdHoc    = (a) => setAdhoc(prev => [...prev, a]);
    const removeAdHoc = (id) => setAdhoc(prev => prev.filter(a => a.id !== id));

    // Currently displayed month, as YYYY-MM
    const monthKey = useMemo(() => formatDate(currentDate, 'YYYY-MM'), [currentDate]);

    // "Has override" = the *currently displayed* month has its own entry for that section.
    // (Reset only clears the current month's entry, not any earlier ones.)
    const overridesAtMonth   = monthOverrides[monthKey] || {};
    const ellisHasOverride   = !!overridesAtMonth.ellis;
    const gaspardHasOverride = !!overridesAtMonth.gaspard;
    const milHasOverride     = !!overridesAtMonth.mil;
    const billingHasOverride = !!overridesAtMonth.billing;

    // Latest override at or before the displayed month — edits propagate forward.
    const effEllisOverride   = findEffectiveOverride(monthOverrides, monthKey, 'ellis');
    const effGaspardOverride = findEffectiveOverride(monthOverrides, monthKey, 'gaspard');
    const effMilOverride     = findEffectiveOverride(monthOverrides, monthKey, 'mil');
    const effBillingOverride = findEffectiveOverride(monthOverrides, monthKey, 'billing');

    const effEllisSchedule   = effEllisOverride?.schedule   ?? ellis.schedule;
    const effGaspardSchedule = effGaspardOverride?.schedule ?? gaspard.schedule;
    const effMil             = effMilOverride               ?? mil;
    const effTaxFree         = effBillingOverride?.taxFree         ?? taxFree;
    const effFullWeekModel   = effBillingOverride?.fullWeekModel   ?? fullWeekModel;

    const setOverride = (key, value) => setMonthOverrides(prev => ({
        ...prev,
        [monthKey]: { ...(prev[monthKey] || {}), [key]: value },
    }));

    // Dispatch handlers — every edit creates/updates an override at the current month
    // so the change applies from this month forward (until the next override).
    // We seed each new override with the currently *effective* values so we don't
    // accidentally drop other fields (e.g. taxFree set via an earlier override).
    const setEllisSchedule = (s) =>
        setOverride('ellis', { ...(effEllisOverride || {}), schedule: s });
    const setGaspardSchedule = (s) =>
        setOverride('gaspard', { ...(effGaspardOverride || {}), schedule: s });
    const setMilEffective = (m) =>
        setOverride('mil', m);
    const setTaxFreeEffective = (v) =>
        setOverride('billing', { taxFree: v, fullWeekModel: effFullWeekModel });
    const setFullWeekModelEffective = (v) =>
        setOverride('billing', { taxFree: effTaxFree, fullWeekModel: v });

    // Load from server on mount; migrate any localStorage values found.
    useEffect(() => {
        let cancelled = false;
        const applyBlob = (blob) => {
            if (cancelled || !blob) return;
            if (blob.ellis)         setEllis(blob.ellis);
            if (blob.gaspard)       setGaspard(blob.gaspard);
            if (Array.isArray(blob.mil))       setMil(blob.mil);
            if (typeof blob.taxFree === 'boolean')       setTaxFree(blob.taxFree);
            if (typeof blob.fullWeekModel === 'boolean') setFullWeekModel(blob.fullWeekModel);
            if (typeof blob.showBreakdown === 'boolean') setShowBreakdown(blob.showBreakdown);
            if (Array.isArray(blob.adhoc))     setAdhoc(blob.adhoc);
            if (blob.monthOverrides && typeof blob.monthOverrides === 'object') setMonthOverrides(blob.monthOverrides);
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

    // Debounced save on any change after initial load.
    useEffect(() => {
        if (!loaded) return;
        if (saveTimeout.current) clearTimeout(saveTimeout.current);
        saveTimeout.current = setTimeout(() => {
            apiService.updateNurserySettings({
                ellis, gaspard, mil, taxFree, fullWeekModel, showBreakdown, adhoc, monthOverrides,
            }).catch(err => console.error('Nursery settings save failed', err));
        }, 500);
        return () => { if (saveTimeout.current) clearTimeout(saveTimeout.current); };
    }, [loaded, ellis, gaspard, mil, taxFree, fullWeekModel, showBreakdown, adhoc, monthOverrides]);

    const calc = useMemo(() => {
        const year = currentDate.getFullYear();
        const monthIdx = currentDate.getMonth();
        const monthLabel = currentDate.toLocaleString('en-GB', { month: 'long', year: 'numeric' });

        const weekdayCounts = { funded: [0, 0, 0, 0, 0], standard: [0, 0, 0, 0, 0], bankHols: [0, 0, 0, 0, 0] };
        const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
        const bankHolDates = [];
        for (let d = 1; d <= daysInMonth; d++) {
            const dow = new Date(year, monthIdx, d).getDay();
            if (dow >= 1 && dow <= 5) {
                const wd = dow - 1;
                const iso = ymd(year, monthIdx, d);
                const isBankHol = BANK_HOLIDAYS.has(iso);
                const isStandard = (monthIdx === 3 && d <= 7)
                                || (monthIdx === 11 && d >= 25);
                if (isStandard) weekdayCounts.standard[wd]++;
                else            weekdayCounts.funded[wd]++;
                if (isBankHol) {
                    weekdayCounts.bankHols[wd]++;
                    bankHolDates.push({ date: iso, wd });
                }
            }
        }

        const ellisStretched   = weeklyStretched(effEllisSchedule,   ellis.ageBracket,   ellis.scheme,   effFullWeekModel);
        const ellisStandard    = weeklyStandard (effEllisSchedule,   ellis.ageBracket);
        const gaspardStretched = weeklyStretched(effGaspardSchedule, gaspard.ageBracket, gaspard.scheme, effFullWeekModel);
        const gaspardStandard  = weeklyStandard (effGaspardSchedule, gaspard.ageBracket);

        const eSib = ellis.siblingDiscount ? 0.90 : 1.00;
        const gSib = gaspard.siblingDiscount ? 0.90 : 1.00;
        const tfMult = effTaxFree ? 0.80 : 1.00;

        const monthlyDaily = [0, 1, 2, 3, 4].map(i => {
            const nFunded   = weekdayCounts.funded[i];
            const nStandard = weekdayCounts.standard[i];
            const nBankHols = weekdayCounts.bankHols[i];
            const nFundNorm = Math.max(0, nFunded - nBankHols);
            const occurrences = nFunded + nStandard;

            const eFunded     = ellisStretched.daily[i];
            const eFundedNoFC = ellisStretched.dailyNoFC[i];
            const gFunded     = gaspardStretched.daily[i];
            const gFundedNoFC = gaspardStretched.dailyNoFC[i];
            const eStandard   = ellisStandard.daily[i];
            const gStandard   = gaspardStandard.daily[i];

            const eMonthlyGross = nFundNorm * eFunded + nBankHols * eFundedNoFC + nStandard * eStandard;
            const gMonthlyGross = nFundNorm * gFunded + nBankHols * gFundedNoFC + nStandard * gStandard;
            const eMonthlyNet   = eMonthlyGross * eSib;
            const gMonthlyNet   = gMonthlyGross * gSib;
            const combined      = eMonthlyNet + gMonthlyNet;
            const milGrossPay   = combined * (effMil[i] / 100);
            const milPay        = milGrossPay * tfMult;
            const parentPay     = (combined - milGrossPay) * tfMult;
            return {
                eFundedType: effEllisSchedule[i],
                gFundedType: effGaspardSchedule[i],
                eFundedHrs: ellisStretched.allocated[i],
                gFundedHrs: gaspardStretched.allocated[i],
                nFunded, nStandard, nBankHols, nFundNorm, occurrences,
                eMonthlyGross, eMonthlyNet,
                gMonthlyGross, gMonthlyNet,
                combined, milGrossPay, milPay, parentPay,
            };
        });

        const monthAdhocs = adhoc.filter(a => {
            if (!a.date) return false;
            const [yy, mm] = a.date.split('-').map(Number);
            return yy === year && (mm - 1) === monthIdx;
        }).map(a => {
            const rates = STANDARD_RATES[a.ageBracket];
            const cost = a.type === 'fullDay' ? rates.fullDay : rates.morning;
            const eGross = a.child === 'ellis'   ? cost : 0;
            const gGross = a.child === 'gaspard' ? cost : 0;
            const eNet = eGross * eSib;
            const gNet = gGross * gSib;
            const combined = eNet + gNet;
            const [yy, mm, dd] = a.date.split('-').map(Number);
            const dow = new Date(yy, mm - 1, dd).getDay();
            const wd = (dow >= 1 && dow <= 5) ? dow - 1 : -1;
            const milPct = wd >= 0 ? effMil[wd] : 0;
            const milGrossPay = combined * (milPct / 100);
            const milPay = milGrossPay * tfMult;
            const parentPay = (combined - milGrossPay) * tfMult;
            return {
                ...a,
                wd, milPct, cost,
                eGross, gGross, eNet, gNet, combined,
                milGrossPay, milPay, parentPay,
            };
        });

        const adhocTotals = monthAdhocs.reduce((acc, a) => ({
            combined:     acc.combined     + a.combined,
            milGrossPay:  acc.milGrossPay  + a.milGrossPay,
            milPay:       acc.milPay       + a.milPay,
            parentPay:    acc.parentPay    + a.parentPay,
            eNet:         acc.eNet         + a.eNet,
            gNet:         acc.gNet         + a.gNet,
        }), { combined: 0, milGrossPay: 0, milPay: 0, parentPay: 0, eNet: 0, gNet: 0 });

        const sum = (fn) => monthlyDaily.reduce((a, m) => a + fn(m), 0);
        const gross    = sum(m => m.combined)    + adhocTotals.combined;
        const milGross = sum(m => m.milGrossPay) + adhocTotals.milGrossPay;
        const milTotal = sum(m => m.milPay)      + adhocTotals.milPay;
        const parentOOP = sum(m => m.parentPay)  + adhocTotals.parentPay;
        const tfSaving = taxFree ? gross * 0.20 : 0;

        const monthly = {
            gross, milGross, mil: milTotal,
            parentBeforeTF: gross - milGross,
            tfSaving, parentOOP,
        };

        return {
            monthly, monthlyDaily,
            year, monthIdx, monthLabel, weekdayCounts, daysInMonth,
            bankHolDates, monthAdhocs,
        };
    }, [ellis, gaspard, taxFree, currentDate, adhoc, effEllisSchedule, effGaspardSchedule, effMil, effTaxFree, effFullWeekModel]);

    return (
        <div>
            <header className="mb-6 flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-800">Nursery Cost Calculator</h1>
                    <p className="text-gray-500">Busy Bees Tunbridge Wells · fees effective 1 January 2026</p>
                    <p className="text-xs text-gray-400 mt-1">Your settings &amp; ad-hoc days are saved to your account.</p>
                </div>
                <button
                    onClick={() => {
                        if (window.confirm('Reset all settings and ad-hoc days to defaults?')) {
                            setEllis(DEFAULTS.ellis);
                            setGaspard(DEFAULTS.gaspard);
                            setMil(DEFAULTS.mil);
                            setTaxFree(DEFAULTS.taxFree);
                            setFullWeekModel(DEFAULTS.fullWeekModel);
                            setShowBreakdown(DEFAULTS.showBreakdown);
                            setAdhoc(DEFAULTS.adhoc);
                            clearAllStoredSettings();
                        }
                    }}
                    className="text-xs text-gray-400 hover:text-rose-500 underline">
                    Reset to defaults
                </button>
            </header>

            <div className="bg-white rounded-xl p-4 shadow-md border border-gray-100 mb-4 flex items-center justify-between gap-3">
                <button
                    onClick={() => changeMonth(-1)}
                    className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium flex items-center gap-1">
                    <ChevronLeft className="h-4 w-4" /> Previous
                </button>
                <div className="text-center flex-1">
                    <div className="text-xs uppercase tracking-wide text-gray-400">Showing</div>
                    <div className="text-xl font-semibold text-gray-800">{calc.monthLabel}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                        {DAYS.map((d, i) => {
                            const n = calc.weekdayCounts.funded[i] + calc.weekdayCounts.standard[i];
                            const bh = calc.weekdayCounts.bankHols[i];
                            return (
                                <span key={d} className="mx-1">
                                    <b className="num">{n}</b> {d.slice(0, 3)}
                                    {bh > 0 && <span className="text-rose-500" title="bank holiday"> ({bh} BH)</span>}
                                </span>
                            );
                        })}
                    </div>
                    {!isCurrentMonth && (
                        <button
                            onClick={() => { window.location.hash = formatDate(today, 'YYYY-MM'); }}
                            className="text-xs text-amber-600 hover:underline mt-1">
                            Jump to this month
                        </button>
                    )}
                </div>
                <button
                    onClick={() => changeMonth(1)}
                    className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium flex items-center gap-1">
                    Next <ChevronRight className="h-4 w-4" />
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div className="bg-gradient-to-br from-amber-400 to-amber-500 text-white rounded-xl p-5 shadow">
                    <div className="text-amber-50 text-sm mb-2">Transfer to TFC for {calc.monthLabel}</div>
                    {(() => {
                        const ellisInvoiced   = calc.monthlyDaily.reduce((a, m) => a + m.eMonthlyNet, 0) + calc.monthAdhocs.reduce((a, x) => a + x.eNet, 0);
                        const gaspardInvoiced = calc.monthlyDaily.reduce((a, m) => a + m.gMonthlyNet, 0) + calc.monthAdhocs.reduce((a, x) => a + x.gNet, 0);
                        const tfcMult = effTaxFree ? 0.80 : 1.00;
                        return (
                            <div className="space-y-1">
                                <div className="flex justify-between items-baseline">
                                    <span className="text-amber-50 text-sm">Ellis</span>
                                    <span className="text-2xl font-bold num">{money(ellisInvoiced * tfcMult)}</span>
                                </div>
                                <div className="flex justify-between items-baseline">
                                    <span className="text-amber-50 text-sm">Gaspard</span>
                                    <span className="text-2xl font-bold num">{money(gaspardInvoiced * tfcMult)}</span>
                                </div>
                            </div>
                        );
                    })()}
                </div>
                <div className="bg-gradient-to-br from-rose-400 to-rose-500 text-white rounded-xl p-5 shadow">
                    <div className="text-rose-50 text-sm">MIL transfers in {calc.monthLabel}</div>
                    <div className="text-3xl font-bold num">{money(calc.monthly.mil)}</div>
                    <div className="text-xs text-rose-50 mt-1">
                        {effTaxFree ? 'her share × 80% (tax-free)' : 'her share of the bill'}
                    </div>
                </div>
                <div className="bg-gradient-to-br from-indigo-400 to-indigo-500 text-white rounded-xl p-5 shadow">
                    <div className="text-indigo-50 text-sm">Total bill for {calc.monthLabel}</div>
                    <div className="text-3xl font-bold num">{money(calc.monthly.gross)}</div>
                    <div className="text-xs text-indigo-50 mt-1">gross, before any discounts</div>
                </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4 mb-4">
                <ChildCard
                    title="Ellis" accent="border-t-amber-400"
                    child={{ ...ellis, schedule: effEllisSchedule }}
                    onUpdateChild={(patch) => setEllis(prev => ({ ...prev, ...patch }))}
                    onSetSchedule={setEllisSchedule}
                    hasMonthOverride={ellisHasOverride}
                    monthLabel={calc.monthLabel}
                />
                <ChildCard
                    title="Gaspard" accent="border-t-sky-400"
                    child={{ ...gaspard, schedule: effGaspardSchedule }}
                    onUpdateChild={(patch) => setGaspard(prev => ({ ...prev, ...patch }))}
                    onSetSchedule={setGaspardSchedule}
                    hasMonthOverride={gaspardHasOverride}
                    monthLabel={calc.monthLabel}
                />
            </div>

            <div className="grid md:grid-cols-2 gap-4 mb-4">
                <MilPanel
                    mil={effMil}
                    setMil={setMilEffective}
                    hasMonthOverride={milHasOverride}
                    monthLabel={calc.monthLabel}
                />
                <div className="bg-white rounded-xl p-5 shadow-md border border-gray-100">
                    <div className="flex items-baseline justify-between mb-3">
                        <h2 className="text-lg font-semibold text-gray-800">Billing model & discounts</h2>
                        <OverrideToggle hasOverride={billingHasOverride} monthLabel={calc.monthLabel} />
                    </div>
                    <div className="space-y-2">
                        <Toggle checked={effFullWeekModel} onChange={setFullWeekModelEffective}
                                label="Full Week model (£356/wk → £7.12/hr on non-funded hours)" />
                        <Toggle checked={effTaxFree} onChange={setTaxFreeEffective}
                                label="Tax-free childcare (20% off the whole bill)" />
                        <Toggle checked={showBreakdown} onChange={setShowBreakdown}
                                label="Show detailed monthly breakdown" />
                    </div>
                </div>
            </div>

            <div className="grid md:grid-cols-1 gap-4 mb-4">
                <AdHocPanel
                    adhoc={adhoc}
                    addAdHoc={addAdHoc}
                    removeAdHoc={removeAdHoc}
                    monthAdhocs={calc.monthAdhocs}
                    monthLabel={calc.monthLabel} />
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
                                    <th className="py-2 pr-3 text-right">Gaspard</th>
                                    <th className="py-2 pr-3 text-right">Combined</th>
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
                                            <td className="py-2 pr-3 text-right num">
                                                {md.gMonthlyGross === 0
                                                    ? '–'
                                                    : gaspard.siblingDiscount
                                                        ? <span title={`Before 10% sibling discount: ${money(md.gMonthlyGross)}`}>{money(md.gMonthlyNet)}</span>
                                                        : money(md.gMonthlyGross)}
                                            </td>
                                            <td className="py-2 pr-3 text-right num font-medium">{md.combined === 0 ? '–' : money(md.combined)}</td>
                                            <td className="py-2 pr-3 text-right num text-rose-600">{md.milPay > 0 ? `−${money(md.milPay)}` : '–'}</td>
                                            <td className="py-2 text-right num font-medium text-amber-700">{md.parentPay > 0 ? money(md.parentPay) : '–'}</td>
                                        </tr>
                                    );
                                })}

                                {calc.monthAdhocs.length > 0 && (
                                    <tr className="bg-amber-50">
                                        <td colSpan="8" className="py-2 pr-3 text-xs font-semibold text-amber-700 uppercase tracking-wide">
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
                                        <td className="py-2 pr-3 text-right num">{a.gGross === 0 ? '–' : (gaspard.siblingDiscount ? money(a.gNet) : money(a.gGross))}</td>
                                        <td className="py-2 pr-3 text-right num font-medium">{money(a.combined)}</td>
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
                                    <td className="py-2 pr-3 text-right num">
                                        {money(
                                            calc.monthlyDaily.reduce((a, m) => a + m.gMonthlyNet, 0)
                                            + calc.monthAdhocs.reduce((a, x) => a + x.gNet, 0)
                                        )}
                                    </td>
                                    <td className="py-2 pr-3 text-right num">{money(calc.monthly.gross)}</td>
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
                                const milMult = effTaxFree ? 0.80 : 1.00;
                                // Per-child MIL coverage = sum over days of (child's net cost that day × MIL%) × tax-free factor.
                                const ellisMIL = (calc.monthlyDaily.reduce((a, m, i) => a + m.eMonthlyNet * (effMil[i] / 100), 0)
                                    + calc.monthAdhocs.reduce((a, x) => a + x.eNet * (x.milPct / 100), 0)) * milMult;
                                const gaspardMIL = (calc.monthlyDaily.reduce((a, m, i) => a + m.gMonthlyNet * (effMil[i] / 100), 0)
                                    + calc.monthAdhocs.reduce((a, x) => a + x.gNet * (x.milPct / 100), 0)) * milMult;
                                const ellisTotal   = calc.monthlyDaily.reduce((a, m) => a + m.eMonthlyNet, 0) + calc.monthAdhocs.reduce((a, x) => a + x.eNet, 0);
                                const gaspardTotal = calc.monthlyDaily.reduce((a, m) => a + m.gMonthlyNet, 0) + calc.monthAdhocs.reduce((a, x) => a + x.gNet, 0);
                                const total        = ellisTotal + gaspardTotal;
                                const totalMIL     = ellisMIL + gaspardMIL;
                                const tfc          = (n) => n * (effTaxFree ? 0.80 : 1.00);
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
                                            <tr><td className="py-1">Ellis</td><td className="text-right py-1">{money(ellisTotal)}</td><td className="text-right py-1 text-emerald-700">{money(tfc(ellisTotal))}</td><td className="text-right py-1 text-rose-600">{money(ellisMIL)}</td><td className="text-right py-1">{money(tfc(ellisTotal) - ellisMIL)}</td></tr>
                                            <tr><td className="py-1">Gaspard</td><td className="text-right py-1">{money(gaspardTotal)}</td><td className="text-right py-1 text-emerald-700">{money(tfc(gaspardTotal))}</td><td className="text-right py-1 text-rose-600">{money(gaspardMIL)}</td><td className="text-right py-1">{money(tfc(gaspardTotal) - gaspardMIL)}</td></tr>
                                        </tbody>
                                        <tfoot>
                                            <tr className="font-semibold border-t">
                                                <td className="pt-1">Total</td>
                                                <td className="text-right pt-1">{money(total)}</td>
                                                <td className="text-right pt-1 text-emerald-700">{money(tfc(total))}</td>
                                                <td className="text-right pt-1 text-rose-600">{money(totalMIL)}</td>
                                                <td className="text-right pt-1">{money(tfc(total) - totalMIL)}</td>
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
