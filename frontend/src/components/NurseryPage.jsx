import React, { useState, useEffect, useMemo, useRef } from 'react';
import apiService from '../services/api';
import { getInitialDate } from '../utils/helpers';
import MonthSelector from './MonthSelector';
import { computeMonthSummary } from '../utils/nurseryCalc';

// ------------------------- Persistent state -------------------------

const STORAGE_VERSION = 1;
const STORAGE_KEYS = ['ellis', 'gaspard', 'taxFree', 'fullWeekModel', 'showBreakdown', 'adhoc'];
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
        siblingDiscount: false,
        showSibling: false,
    },
    gaspard: {
        ageBracket: '3-5',
        scheme: '30hr',
        siblingDiscount: true,
        showSibling: true,
    },
};

const money = (n) => `£${n.toFixed(2)}`;

// ------------------------- UI building blocks -------------------------

function Toggle({ checked, onChange, label }) {
    return (
        <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="h-4 w-4 accent-warn" />
            <span className="text-sm text-ink">{label}</span>
        </label>
    );
}

// Attendance is fixed — full week, full days — so a child card is just the
// age bracket and (where relevant) the sibling discount.
function ChildCard({ title, accent, child, onUpdateChild }) {
    const update = (patch) => onUpdateChild(patch);

    return (
        <div className={`bg-card rounded-xl p-5 border border-line border-t-4 ${accent}`}>
            <div className="flex items-baseline justify-between mb-1">
                <h2 className="text-xl font-semibold text-ink">{title}</h2>
                <span className="text-xs text-ink-faint">Busy Bees Tunbridge Wells</span>
            </div>
            <p className="text-xs text-ink-soft mb-4">Full week · Mon–Fri, full days (8am–6pm)</p>

            <label className="text-sm block mb-4">
                <span className="block text-ink-soft mb-1">Age bracket</span>
                <select value={child.ageBracket} onChange={e => update({ ageBracket: e.target.value })}
                        className="w-full rounded-lg border border-line px-2 py-1.5 bg-card">
                    <option value="0-2">0–2 Year Olds</option>
                    <option value="2-3">2–3 Year Olds</option>
                    <option value="3-5">3–5 Year Olds</option>
                </select>
            </label>

            {child.showSibling && (
                <div className="mb-1">
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
        <div className="bg-card rounded-xl p-5 border border-line border-t-4 border-t-keith">
            <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-xl font-semibold text-ink">Gaspard</h2>
                <span className="text-xs text-ink-faint">At school</span>
            </div>
            <p className="text-sm text-ink-soft">
                Gaspard has left nursery. His breakfast, after-school and holiday-club
                costs are in the <span className="font-medium text-accent">School clubs</span> section.
            </p>
        </div>
    );
}

// ------------------------- Main page -------------------------

const NurseryPage = ({ onSettingsChange }) => {
    const [ellis, setEllis]     = useState(DEFAULTS.ellis);
    const [gaspard, setGaspard] = useState(DEFAULTS.gaspard);
    // Non-nursery blob keys (e.g. `childcare`, owned by the Childcare tab) are
    // preserved verbatim so saving the nursery settings never wipes them.
    const [otherBlob, setOtherBlob] = useState({});
    const [loaded, setLoaded]       = useState(false);
    const [currentDate, setCurrentDate] = useState(() => getInitialDate());

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

    const saveTimeout = useRef(null);

    // Load from server on mount; migrate any localStorage values found.
    useEffect(() => {
        let cancelled = false;
        const applyBlob = (blob) => {
            if (cancelled || !blob) return;
            if (blob.ellis)   setEllis(prev => ({ ...prev, ...blob.ellis }));
            if (blob.gaspard) setGaspard(prev => ({ ...prev, ...blob.gaspard }));
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
        const blob = { ...otherBlob, ellis, gaspard };
        if (onSettingsChange) onSettingsChange(blob);
        if (saveTimeout.current) clearTimeout(saveTimeout.current);
        saveTimeout.current = setTimeout(() => {
            apiService.updateNurserySettings(blob)
                .catch(err => console.error('Nursery settings save failed', err));
        }, 500);
        return () => { if (saveTimeout.current) clearTimeout(saveTimeout.current); };
    }, [loaded, otherBlob, ellis, gaspard, onSettingsChange]);

    const calc = useMemo(() => {
        const settings = { ellis, gaspard, adhoc: otherBlob.adhoc || [], childcare: otherBlob.childcare };
        return computeMonthSummary(settings, currentDate);
    }, [ellis, gaspard, otherBlob, currentDate]);

    const gaspardInNursery = calc.effective.gaspardInNursery;

    return (
        <div>
            <div className="flex justify-center mb-4">
                <MonthSelector currentDate={currentDate} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 items-stretch">
                <div className="bg-warn text-paper rounded-xl p-5 flex flex-col">
                    <div className="text-paper/80 text-lg font-semibold mb-2">Transfer to TFC</div>
                    {(() => {
                        const TFCAmount = ({ amount, saving, usedBefore, capped, periodLabel }) => {
                            const periodTotal = usedBefore + saving;
                            return (
                                <div className="relative inline-block group">
                                    <div className="text-2xl font-bold num cursor-help underline decoration-paper/40 decoration-dotted underline-offset-4">
                                        {money(amount)}
                                    </div>
                                    <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-2 z-10 hidden group-hover:block whitespace-nowrap rounded-lg bg-ink text-paper text-xs font-normal px-3 py-2 text-left">
                                        <div>£{saving.toFixed(2)} saved this month</div>
                                        <div className="text-ink-faint/70">£{periodTotal.toFixed(2)} of £{calc.tfc.quarterlyCap} used ({periodLabel})</div>
                                        {capped && <div className="text-paper/70 mt-1">cap reached</div>}
                                    </div>
                                </div>
                            );
                        };
                        return (
                            <div className={`flex-1 grid ${gaspardInNursery ? 'grid-cols-2' : 'grid-cols-1'} gap-3 items-center`}>
                                <div className="text-center">
                                    <div className="text-paper/80 text-sm">Ellis</div>
                                    <div className="text-paper/70 text-xs num" title="TFC reference">1100116981235</div>
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
                                        <div className="text-paper/80 text-sm">Gaspard</div>
                                        <div className="text-paper/70 text-xs num" title="TFC reference">1100067930356</div>
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
                <div className="bg-accent text-paper rounded-xl p-5 flex flex-col">
                    <div className="text-paper/80 text-lg font-semibold">Total bill</div>
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-3xl font-bold num">{money(calc.monthly.gross)}</div>
                    </div>
                </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4 items-start">
                <ChildCard
                    title="Ellis" accent="border-t-warn"
                    child={ellis}
                    onUpdateChild={(patch) => setEllis(prev => ({ ...prev, ...patch }))}
                />
                {gaspardInNursery ? (
                    <ChildCard
                        title="Gaspard" accent="border-t-keith"
                        child={gaspard}
                        onUpdateChild={(patch) => setGaspard(prev => ({ ...prev, ...patch }))}
                    />
                ) : (
                    <GaspardMovedCard />
                )}
            </div>
        </div>
    );
};

export default NurseryPage;
