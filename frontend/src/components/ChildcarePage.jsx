import React, { useState, useEffect, useMemo, useRef } from 'react';
import apiService from '../services/api';
import { formatDate, getInitialDate } from '../utils/helpers';
import MonthSelector from './MonthSelector';
import { computeChildcare, childcareDayMarkers, getChildcare, effectiveSchedule, CHILDCARE_RATES, SCHOOL_HOLIDAY_RANGES, expandDateRanges } from '../utils/childcareCalc';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const WEEK_HEAD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const money = (n) => `£${n.toFixed(2)}`;
const pad = (n) => String(n).padStart(2, '0');
const isoOf = (y, m0, d) => `${y}-${pad(m0 + 1)}-${pad(d)}`;
const newId = () => Date.now() + Math.random();

const AFTER_SCHOOL_LABEL = { none: 'Not attending', short: '3:15–4:30 (£12)', long: '3:15–6:30 (£24)' };
const ICON = { breakfast: '🥐', short: '🛝', long: '🍽️', holiday: '🏖️' };

// ------------------------- Month calendar -------------------------

function MonthCalendar({ currentDate, markers, mode, onToggleDay, onSelectDay, selectedDay }) {
    const year = currentDate.getFullYear();
    const m0 = currentDate.getMonth();
    const dim = new Date(year, m0 + 1, 0).getDate();
    const firstDow = (new Date(year, m0, 1).getDay() + 6) % 7; // Monday-based
    const dragging = useRef({ active: false, value: null });

    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= dim; d++) cells.push(d);

    const apply = (d, value) => {
        if (d == null) return;
        onToggleDay(isoOf(year, m0, d), value);
    };
    const startDrag = (d) => {
        if (d == null) return;
        const iso = isoOf(year, m0, d);
        const mk = markers[iso] || {};
        const value = mode.type === 'nonTerm' ? !mk.nonTerm : !(mk.clubs || []).some(c => c.id === mode.clubId);
        dragging.current = { active: true, value };
        apply(d, value);
    };
    const overDrag = (d) => { if (dragging.current.active) apply(d, dragging.current.value); };
    const endDrag = () => { dragging.current = { active: false, value: null }; };

    useEffect(() => {
        window.addEventListener('pointerup', endDrag);
        return () => window.removeEventListener('pointerup', endDrag);
    }, []);

    const onDown = (d) => {
        if (d == null) return;
        if (mode.type === 'sessions') { onSelectDay(isoOf(year, m0, d)); return; }
        const iso = isoOf(year, m0, d);
        const assignable = mode.type !== 'assign' || (markers[iso] || {}).nonTerm;
        if (assignable) startDrag(d);
    };

    return (
        <div className="select-none w-full" onPointerLeave={endDrag}>
            <div className="grid grid-cols-7 gap-0.5 mb-0.5 text-center text-[10px] font-medium text-ink-faint">
                {WEEK_HEAD.map(w => <div key={w}>{w}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
                {cells.map((d, idx) => {
                    if (d == null) return <div key={`b${idx}`} />;
                    const iso = isoOf(year, m0, d);
                    const mk = markers[iso] || {};
                    const assignHere = mode.type === 'assign' && (mk.clubs || []).some(c => c.id === mode.clubId);
                    const disabled = mode.type === 'assign' && !mk.nonTerm;
                    const selected = mode.type === 'sessions' && selectedDay === iso;
                    return (
                        <button
                            type="button"
                            key={iso}
                            onPointerDown={() => onDown(d)}
                            onPointerEnter={() => mode.type !== 'sessions' && !disabled && overDrag(d)}
                            className={[
                                'h-16 rounded-md border p-1 text-left flex flex-col transition-colors',
                                mk.nonTerm ? 'bg-keith-soft border-keith/30' : 'bg-card border-line',
                                assignHere || selected ? 'ring-2 ring-accent' : '',
                                mk.overridden ? 'border-dashed border-warn' : '',
                                disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:border-accent/40',
                            ].join(' ')}
                            title={mk.nonTerm ? 'Non-term day' : 'Term day'}
                        >
                            <span className={`text-[10px] leading-none font-semibold ${mk.nonTerm ? 'text-keith' : 'text-ink-soft'}`}>{d}</span>
                            <span className="mt-auto flex flex-wrap gap-px justify-center text-[11px] leading-none">
                                {mk.breakfast && <span title="Breakfast club">{ICON.breakfast}</span>}
                                {mk.afterSchool && <span title={`After-school · ${AFTER_SCHOOL_LABEL[mk.afterSchool]}`}>{ICON[mk.afterSchool]}</span>}
                                {(mk.clubs || []).map(c => <span key={c.id} title={c.name || 'Holiday club'}>{ICON.holiday}</span>)}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

// ------------------------- Panels -------------------------

function ConceptTfc({ checked, onChange }) {
    return (
        <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs text-ink-soft">
            <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="h-4 w-4 accent-good" />
            TFC (−20%)
        </label>
    );
}

// Editor for a single day's sessions, shown when a day is picked in Sessions
// mode. Sets per-date overrides (add an ad-hoc session or remove a recurring
// one); "Weekly default" clears the override.
function DaySessionEditor({ iso, marker, bOverridden, aOverridden, weeklyBreakfast, weeklyAfterSchool, holidayClubs, onToggleClubDay, onSetBreakfast, onSetAfterSchool, onClose }) {
    const Btn = ({ active, onClick, children }) => (
        <button type="button" onClick={onClick}
                className={`px-2 py-1 rounded-lg text-xs font-medium border transition-colors ${active ? 'bg-accent text-paper border-accent' : 'bg-card text-ink border-line hover:border-accent/40'}`}>
            {children}
        </button>
    );
    const sessionsAllowed = !marker.nonTerm && !marker.weekend;
    return (
        <div className="mt-3 border-t border-line pt-3">
            <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-semibold text-ink">{iso} <span className="text-xs font-normal text-ink-faint">{marker.nonTerm ? '· non-term' : marker.weekend ? '· weekend' : ''}</span></div>
                <button type="button" onClick={onClose} className="text-ink-faint hover:text-ink text-sm">Close</button>
            </div>
            {sessionsAllowed ? (
                <div className="space-y-2">
                    <div>
                        <div className="text-xs text-ink-soft mb-1">Breakfast {ICON.breakfast} {!bOverridden && <span className="text-ink-faint/70">(weekly: {weeklyBreakfast ? 'yes' : 'no'})</span>}</div>
                        <div className="flex gap-1.5">
                            <Btn active={!bOverridden} onClick={() => onSetBreakfast(undefined)}>Weekly default</Btn>
                            <Btn active={bOverridden && marker.breakfast} onClick={() => onSetBreakfast(true)}>Attending</Btn>
                            <Btn active={bOverridden && !marker.breakfast} onClick={() => onSetBreakfast(false)}>Not</Btn>
                        </div>
                    </div>
                    <div>
                        <div className="text-xs text-ink-soft mb-1">After-school {!aOverridden && <span className="text-ink-faint/70">(weekly: {AFTER_SCHOOL_LABEL[weeklyAfterSchool]})</span>}</div>
                        <div className="flex gap-1.5 flex-wrap">
                            <Btn active={!aOverridden} onClick={() => onSetAfterSchool(undefined)}>Weekly default</Btn>
                            <Btn active={aOverridden && (marker.afterSchool == null)} onClick={() => onSetAfterSchool('none')}>None</Btn>
                            <Btn active={marker.afterSchool === 'short'} onClick={() => onSetAfterSchool('short')}>{ICON.short} 4:30</Btn>
                            <Btn active={marker.afterSchool === 'long'} onClick={() => onSetAfterSchool('long')}>{ICON.long} 6:30</Btn>
                        </div>
                    </div>
                </div>
            ) : marker.nonTerm ? (
                <div>
                    <div className="text-xs text-ink-soft mb-1">Holiday club {ICON.holiday}</div>
                    {holidayClubs.length === 0 ? (
                        <p className="text-xs text-ink-faint">No holiday clubs yet — add one in the Holiday Club panel.</p>
                    ) : (
                        <div className="flex gap-1.5 flex-wrap">
                            {holidayClubs.map(club => (
                                <Btn key={club.id} active={(marker.clubs || []).some(c => c.id === club.id)} onClick={() => onToggleClubDay(club.id, iso)}>
                                    {club.name || 'Club'}
                                </Btn>
                            ))}
                        </div>
                    )}
                    <p className="text-[11px] text-ink-faint mt-1.5">Breakfast/after-school don’t run on non-term days.</p>
                </div>
            ) : (
                <p className="text-xs text-ink-soft">Weekend — no sessions.</p>
            )}
        </div>
    );
}

// ------------------------- Page -------------------------

const ChildcarePage = ({ onSettingsChange }) => {
    const [childcare, setChildcare] = useState(() => getChildcare(null));
    const [otherBlob, setOtherBlob] = useState({});
    const [loaded, setLoaded] = useState(false);
    const [currentDate, setCurrentDate] = useState(() => getInitialDate());
    const [mode, setMode] = useState({ type: 'nonTerm' });
    const saveTimeout = useRef(null);

    useEffect(() => {
        const sync = () => setCurrentDate(prev => {
            const next = getInitialDate();
            return prev.getTime() === next.getTime() ? prev : next;
        });
        window.addEventListener('hashchange', sync);
        return () => window.removeEventListener('hashchange', sync);
    }, []);

    const monthKey = useMemo(() => formatDate(currentDate, 'YYYY-MM'), [currentDate]);

    // Load the shared nursery-settings blob; own only the `childcare` subtree.
    useEffect(() => {
        let cancelled = false;
        apiService.getNurserySettings().then(serverData => {
            if (cancelled) return;
            const blob = serverData && typeof serverData === 'object' ? serverData : {};
            setChildcare(getChildcare(blob));
            setOtherBlob(blob);
            setLoaded(true);
        }).catch(err => {
            console.error('Childcare settings load failed', err);
            setLoaded(true);
        });
        return () => { cancelled = true; };
    }, []);

    // Debounced save, preserving every key we don't own.
    useEffect(() => {
        if (!loaded) return;
        const blob = { ...otherBlob, childcare };
        if (onSettingsChange) onSettingsChange(blob);
        if (saveTimeout.current) clearTimeout(saveTimeout.current);
        saveTimeout.current = setTimeout(() => {
            apiService.updateNurserySettings(blob)
                .catch(err => console.error('Childcare settings save failed', err));
        }, 500);
        return () => { if (saveTimeout.current) clearTimeout(saveTimeout.current); };
    }, [loaded, otherBlob, childcare, onSettingsChange]);

    const markers = useMemo(() => childcareDayMarkers({ childcare }, monthKey), [childcare, monthKey]);
    const calc = useMemo(() => computeChildcare({ childcare }, monthKey), [childcare, monthKey]);

    // Weekly pattern effective for the displayed month (forward-filled).
    const effBreakfast = effectiveSchedule(childcare, monthKey, 'breakfast');
    const effAfterSchool = effectiveSchedule(childcare, monthKey, 'afterSchool');

    // ---- mutators ----
    const patchConcept = (concept, p) => setChildcare(c => ({ ...c, [concept]: { ...c[concept], ...p } }));

    const toggleDay = (iso, value) => {
        if (mode.type === 'nonTerm') {
            setChildcare(c => {
                const set = new Set(c.nonTermDays);
                if (value) set.add(iso); else set.delete(iso);
                return { ...c, nonTermDays: [...set] };
            });
        } else {
            setChildcare(c => ({
                ...c,
                holidayClubs: c.holidayClubs.map(club => {
                    if (club.id !== mode.clubId) return club;
                    const set = new Set(club.days || []);
                    if (value) set.add(iso); else set.delete(iso);
                    return { ...club, days: [...set] };
                }),
            }));
        }
    };

    // Editing the weekly pattern writes a month-scoped pattern (seeded from the
    // currently effective one) so it applies from this month forward until the
    // next change — never backwards or onto an already-diverged later month.
    const setPatternDay = (concept, i, value) => setChildcare(c => {
        const s = [...effectiveSchedule(c, monthKey, concept)]; s[i] = value;
        return { ...c, patterns: { ...c.patterns, [monthKey]: { ...(c.patterns?.[monthKey] || {}), [concept]: s } } };
    });
    const setBreakfastDay = (i, on) => setPatternDay('breakfast', i, on);
    const setAfterSchoolDay = (i, opt) => setPatternDay('afterSchool', i, opt);

    // Per-date session overrides (edited on the calendar). Passing `undefined`
    // clears the override so the day reverts to the weekly pattern.
    const setOverride = (concept, iso, value) => setChildcare(c => {
        const overrides = { ...(c[concept].overrides || {}) };
        if (value === undefined) delete overrides[iso]; else overrides[iso] = value;
        return { ...c, [concept]: { ...c[concept], overrides } };
    });

    const addClub = () => setChildcare(c => ({
        ...c, holidayClubs: [...c.holidayClubs, { id: newId(), name: 'New club', dayRate: 0, weekRate: 0, tfc: false, days: [] }],
    }));
    const updateClub = (id, p) => setChildcare(c => ({ ...c, holidayClubs: c.holidayClubs.map(k => k.id === id ? { ...k, ...p } : k) }));
    const loadSchoolHolidays = () => setChildcare(c => ({
        ...c, nonTermDays: [...new Set([...(c.nonTermDays || []), ...expandDateRanges(SCHOOL_HOLIDAY_RANGES)])],
    }));
    const toggleClubDay = (clubId, iso) => setChildcare(c => ({
        ...c,
        holidayClubs: c.holidayClubs.map(club => {
            if (club.id !== clubId) return club;
            const set = new Set(club.days || []);
            if (set.has(iso)) set.delete(iso); else set.add(iso);
            return { ...club, days: [...set] };
        }),
    }));
    const removeClub = (id) => {
        setChildcare(c => ({ ...c, holidayClubs: c.holidayClubs.filter(k => k.id !== id) }));
        setMode(m => (m.type === 'assign' && m.clubId === id ? { type: 'nonTerm' } : m));
    };

    // Day selected for session editing on the calendar (Sessions mode).
    const [selectedDay, setSelectedDay] = useState(null);
    useEffect(() => { setSelectedDay(null); }, [monthKey]);

    const breakfastDays = Math.round(calc.breakfast.cost / CHILDCARE_RATES.breakfast);

    return (
        <div className="space-y-4">
            <div className="flex justify-center">
                <MonthSelector currentDate={currentDate} />
            </div>

            {/* Calendar + cost breakdown, side by side on wide screens */}
            <div className="grid lg:grid-cols-[minmax(0,1fr)_400px] gap-4 items-start">
            {/* Calendar */}
            <div className="bg-card rounded-xl p-5 border border-line">
                <div className="flex items-center justify-between mb-3 gap-2">
                    <h2 className="text-lg font-semibold text-ink">{formatDate(currentDate, 'MonthYYYY')}</h2>
                    {mode.type === 'assign' && (
                        <button type="button" onClick={() => setMode({ type: 'nonTerm' })} className="px-3 py-1 rounded-lg bg-accent text-paper text-xs font-medium">Done assigning</button>
                    )}
                </div>
                {mode.type !== 'assign' && (
                    <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                        <div className="inline-flex rounded-lg border border-line overflow-hidden text-xs">
                            {[['nonTerm', 'Non-term'], ['sessions', 'Sessions']].map(([t, label]) => (
                                <button key={t} type="button" onClick={() => { setMode({ type: t }); setSelectedDay(null); }}
                                        className={`px-3 py-1 font-medium ${mode.type === t ? 'bg-accent text-paper' : 'bg-card text-ink-soft hover:bg-paper'}`}>{label}</button>
                            ))}
                        </div>
                        <button type="button" onClick={loadSchoolHolidays}
                                title="Fill non-term days from Skinners' Kent Primary School term dates (2026/27)"
                                className="text-xs font-medium text-keith hover:text-keith hover:underline">
                            Load school holidays
                        </button>
                    </div>
                )}
                <p className="text-xs text-ink-faint mb-2">
                    {mode.type === 'assign'
                        ? <>Assigning days to “{childcare.holidayClubs.find(k => k.id === mode.clubId)?.name}” — click non-term days</>
                        : mode.type === 'sessions'
                            ? 'Click a day to add/remove a breakfast or after-school session'
                            : <>Click or drag days to mark <span className="text-keith font-medium">non-term</span> time</>}
                </p>
                <MonthCalendar currentDate={currentDate} markers={markers} mode={mode} onToggleDay={toggleDay} onSelectDay={setSelectedDay} selectedDay={selectedDay} />
                <div className="flex gap-3 mt-3 text-xs text-ink-soft flex-wrap">
                    <span><span className="inline-block w-3 h-3 rounded bg-keith-soft border border-keith/30 align-middle" /> non-term</span>
                    <span>{ICON.breakfast} breakfast</span>
                    <span>{ICON.short} finishes 4:30</span>
                    <span>{ICON.long} finishes 6:30 (tea)</span>
                    <span>{ICON.holiday} holiday club</span>
                </div>
                {mode.type === 'sessions' && selectedDay && (() => {
                    const mk = markers[selectedDay] || {};
                    const wd = (new Date(selectedDay + 'T00:00:00').getDay() + 6) % 7;
                    return (
                        <DaySessionEditor
                            iso={selectedDay}
                            marker={mk}
                            bOverridden={selectedDay in (childcare.breakfast.overrides || {})}
                            aOverridden={selectedDay in (childcare.afterSchool.overrides || {})}
                            weeklyBreakfast={wd <= 4 && effBreakfast[wd] === true}
                            weeklyAfterSchool={wd <= 4 ? effAfterSchool[wd] : 'none'}
                            holidayClubs={childcare.holidayClubs}
                            onToggleClubDay={toggleClubDay}
                            onSetBreakfast={(v) => setOverride('breakfast', selectedDay, v)}
                            onSetAfterSchool={(v) => setOverride('afterSchool', selectedDay, v)}
                            onClose={() => setSelectedDay(null)}
                        />
                    );
                })()}
            </div>

            {/* Cost breakdown */}
            <div className="bg-card rounded-xl p-5 border border-line">
                <h2 className="text-lg font-semibold text-ink mb-3">Cost breakdown</h2>
                <div>
                    <table className="w-full text-sm num [&_td:not(:first-child)]:whitespace-nowrap [&_th]:whitespace-nowrap">
                        <thead>
                            <tr className="text-ink-soft text-xs text-right">
                                <th className="text-left font-medium pb-1">Activity</th>
                                <th className="font-medium pb-1">Gross</th>
                                <th className="font-medium pb-1">TFC saving</th>
                                <th className="font-medium pb-1">You pay</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td className="py-1">Breakfast <span className="text-ink-faint">({breakfastDays} {breakfastDays === 1 ? 'day' : 'days'})</span></td>
                                <td className="text-right">{money(calc.breakfast.cost)}</td>
                                <td className="text-right text-good">−{money(calc.breakfast.saving)}</td>
                                <td className="text-right">{money(calc.breakfast.cost - calc.breakfast.saving)}</td>
                            </tr>
                            <tr>
                                <td className="py-1">After-school</td>
                                <td className="text-right">{money(calc.afterSchool.cost)}</td>
                                <td className="text-right text-good">−{money(calc.afterSchool.saving)}</td>
                                <td className="text-right">{money(calc.afterSchool.cost - calc.afterSchool.saving)}</td>
                            </tr>
                            {calc.holidayClubs.map(h => (
                                <tr key={h.id}>
                                    <td className="py-1">{h.name || 'Holiday club'}</td>
                                    <td className="text-right">{money(h.cost)}</td>
                                    <td className="text-right text-good">−{money(h.saving)}</td>
                                    <td className="text-right">{money(h.cost - h.saving)}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="font-semibold border-t">
                                <td className="pt-2">Term clubs</td>
                                <td colSpan="2"></td>
                                <td className="text-right pt-2">{money(calc.termNet)}</td>
                            </tr>
                            <tr className="font-semibold">
                                <td>Holiday clubs</td>
                                <td colSpan="2"></td>
                                <td className="text-right">{money(calc.holidayNet)}</td>
                            </tr>
                            <tr className="font-bold border-t">
                                <td className="pt-1">Total you pay</td>
                                <td colSpan="2"></td>
                                <td className="text-right pt-1">{money(calc.net)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
            </div>

            <div className="grid md:grid-cols-3 gap-4">
                {/* Breakfast */}
                <div className="bg-card rounded-xl p-5 border border-line border-t-4 border-t-warn">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-lg font-semibold text-ink">Breakfast Club</h3>
                        <ConceptTfc checked={childcare.breakfast.tfc} onChange={v => patchConcept('breakfast', { tfc: v })} />
                    </div>
                    <p className="text-xs text-ink-faint mb-2">£{CHILDCARE_RATES.breakfast.toFixed(2)}/day · term-time</p>
                    <div className="space-y-1.5 mb-3">
                        {DAYS.map((d, i) => (
                            <label key={d} className="flex items-center justify-between text-sm">
                                <span className="text-ink-soft">{d}</span>
                                <select value={effBreakfast[i] ? 'yes' : 'no'} onChange={e => setBreakfastDay(i, e.target.value === 'yes')}
                                        className="rounded-lg border border-line px-2 py-1 bg-card text-sm">
                    <option value="no">Not attending</option>
                                    <option value="yes">Attending</option>
                                </select>
                            </label>
                        ))}
                    </div>
                    <p className="text-[11px] text-ink-faint border-t border-line pt-2">One-off changes? Use the calendar’s <span className="font-medium">Sessions</span> mode.</p>
                </div>

                {/* After-school */}
                <div className="bg-card rounded-xl p-5 border border-line border-t-4 border-t-accent">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-lg font-semibold text-ink">After-School Club</h3>
                        <ConceptTfc checked={childcare.afterSchool.tfc} onChange={v => patchConcept('afterSchool', { tfc: v })} />
                    </div>
                    <p className="text-xs text-ink-faint mb-2">£{CHILDCARE_RATES.afterSchool.short}/£{CHILDCARE_RATES.afterSchool.long} per day · term-time</p>
                    <div className="space-y-1.5 mb-3">
                        {DAYS.map((d, i) => (
                            <label key={d} className="flex items-center justify-between text-sm gap-2">
                                <span className="text-ink-soft">{d}</span>
                                <select value={effAfterSchool[i]} onChange={e => setAfterSchoolDay(i, e.target.value)}
                                        className="rounded-lg border border-line px-2 py-1 bg-card text-sm">
                    <option value="none">Not attending</option>
                                    <option value="short">3:15–4:30 (£12)</option>
                                    <option value="long">3:15–6:30 (£24)</option>
                                </select>
                            </label>
                        ))}
                    </div>
                    <p className="text-[11px] text-ink-faint border-t border-line pt-2">One-off changes? Use the calendar’s <span className="font-medium">Sessions</span> mode.</p>
                </div>

                {/* Holiday clubs */}
                <div className="bg-card rounded-xl p-5 border border-line border-t-4 border-t-emerald-400">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-lg font-semibold text-ink">Holiday Club</h3>
                        <button type="button" onClick={addClub} className="text-sm font-medium bg-good hover:bg-accent-strong text-paper rounded-lg px-3 py-1">+ Club</button>
                    </div>
                    <p className="text-xs text-ink-faint mb-2">Assign non-term days; a full Mon–Fri week bills the week rate.</p>
                    {childcare.holidayClubs.length === 0 && <p className="text-sm text-ink-faint">No holiday clubs yet.</p>}
                    <div className="space-y-3">
                        {childcare.holidayClubs.map(club => {
                            const assignedThisMonth = (club.days || []).filter(d => d.startsWith(monthKey));
                            const assigning = mode.type === 'assign' && mode.clubId === club.id;
                            return (
                                <div key={club.id} className="border border-line rounded-lg p-3">
                                    <div className="flex items-center gap-2 mb-2">
                                        <input value={club.name} onChange={e => updateClub(club.id, { name: e.target.value })}
                                               className="flex-1 rounded-lg border border-line px-2 py-1 bg-card text-sm font-medium" />
                                        <button type="button" onClick={() => removeClub(club.id)} className="text-danger hover:text-danger text-base leading-none">×</button>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 mb-2">
                                        <label className="text-xs"><span className="block text-ink-soft mb-0.5">Day rate (£)</span>
                                            <input type="number" min="0" step="0.01" value={club.dayRate} onChange={e => updateClub(club.id, { dayRate: Number(e.target.value) || 0 })} className="w-full rounded-lg border border-line px-2 py-1 bg-card text-sm num" /></label>
                                        <label className="text-xs"><span className="block text-ink-soft mb-0.5">Week rate (£)</span>
                                            <input type="number" min="0" step="0.01" value={club.weekRate} onChange={e => updateClub(club.id, { weekRate: Number(e.target.value) || 0 })} className="w-full rounded-lg border border-line px-2 py-1 bg-card text-sm num" /></label>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <ConceptTfc checked={club.tfc} onChange={v => updateClub(club.id, { tfc: v })} />
                                        <button type="button" onClick={() => setMode(assigning ? { type: 'nonTerm' } : { type: 'assign', clubId: club.id })}
                                                className={`text-xs font-medium rounded-lg px-3 py-1 ${assigning ? 'bg-accent text-paper' : 'bg-line/70 text-ink hover:bg-line'}`}>
                                            {assigning ? 'Done assigning' : 'Assign days'}
                                        </button>
                                    </div>
                                    {assignedThisMonth.length > 0 && (
                                        <div className="mt-2 flex flex-wrap gap-1">
                                            {assignedThisMonth.slice().sort().map(d => (
                                                <span key={d} className="text-[10px] px-1.5 py-0.5 rounded bg-good/10 text-good">{d.slice(8)}</span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ChildcarePage;
