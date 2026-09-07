// Pure helpers for the Childcare page (Gaspard's school clubs). Kept separate
// from nurseryCalc.js — different domain (calendar-driven clubs vs nursery
// invoice). computeChildcare's `net` feeds the "Childcare Gaspard" budget line.

// Fixed club rates (per day).
//   Breakfast:    £5/day (attending or not)
//   After-school: short = 3:15–4:30 (£12), long = 3:15–6:30 (£24),
//                 late = 4:30–6:30 (£12) — the pick-up-after-a-club slot
// Holiday clubs and term-time clubs carry their own configurable rates.
export const CHILDCARE_RATES = {
    breakfast: 5.00,
    afterSchool: { short: 12.00, long: 24.00, late: 12.00 },
};

// Default per-session rate for a new term-time club (French club, 2026/27).
export const TERM_CLUB_DEFAULT_RATE = 11.00;

export const CHILDCARE_START_DEFAULT = '2026-09';

// Non-term (school-closed) date ranges, pulled from Skinners' Kent Primary
// School's published term dates (skps.org.uk/793/term-dates). Update when the
// school publishes a new academic year.
export const SCHOOL_HOLIDAY_RANGES = [
    // 2026/2027
    ['2026-09-01', '2026-09-02'], // INSET / before pupils start (3 Sep)
    ['2026-10-19', '2026-10-30'], // autumn half-term
    ['2026-12-21', '2027-01-04'], // Christmas break (+ 4 Jan INSET)
    ['2027-02-15', '2027-02-19'], // spring half-term
    ['2027-03-26', '2027-04-11'], // Easter break
    ['2027-05-03', '2027-05-03'], // May bank holiday
    ['2027-05-31', '2027-06-07'], // summer half-term (+ 7 Jun INSET)
    ['2027-07-20', '2027-08-31'], // summer holiday
];

// The six school HALF-terms (first/last school day), same SKPS source as the
// holiday ranges above — half-terms because that's the billing cycle for
// school clubs: after-school is invoiced at the END of each half-term,
// term-time clubs are paid at the START. The backend `SchoolTerm` table
// (migration 0032) carries the same dates for generic per-term budget items —
// keep the two in step when a new academic year is published.
export const SCHOOL_TERMS = [
    { name: 'Autumn 1 2026', start: '2026-09-03', end: '2026-10-16' },
    { name: 'Autumn 2 2026', start: '2026-11-02', end: '2026-12-18' },
    { name: 'Spring 1 2027', start: '2027-01-05', end: '2027-02-12' },
    { name: 'Spring 2 2027', start: '2027-02-22', end: '2027-03-25' },
    { name: 'Summer 1 2027', start: '2027-04-12', end: '2027-05-28' },
    { name: 'Summer 2 2027', start: '2027-06-08', end: '2027-07-19' },
];

// Expand [start, end] inclusive ISO ranges into a flat list of ISO dates.
export function expandDateRanges(ranges) {
    const out = [];
    for (const [start, end] of ranges) {
        const [sy, sm, sd] = start.split('-').map(Number);
        const [ey, em, ed] = end.split('-').map(Number);
        const cur = new Date(sy, sm - 1, sd);
        const last = new Date(ey, em - 1, ed);
        while (cur <= last) {
            out.push(`${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`);
            cur.setDate(cur.getDate() + 1);
        }
    }
    return out;
}

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (y, m0, d) => `${y}-${pad(m0 + 1)}-${pad(d)}`;
const daysInMonth = (y, m0) => new Date(y, m0 + 1, 0).getDate();

// Monday (as ISO) of the week containing y-m0-d. Used to group holiday-club
// days into Mon–Fri weeks for the "full week → week rate" rule.
function mondayIso(y, m0, d) {
    const dt = new Date(y, m0, d);
    const dow = dt.getDay();               // 0 Sun .. 6 Sat
    dt.setDate(dt.getDate() + (dow === 0 ? -6 : 1 - dow));
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

const emptyChildcare = () => ({
    startMonth: CHILDCARE_START_DEFAULT,
    nonTermDays: [],
    // `schedule` is the baseline recurring weekly pattern; `overrides` are
    // per-date exceptions edited on the calendar (add an ad-hoc session, or
    // remove a day from the recurring pattern). Overrides win over the pattern.
    breakfast:   { tfc: true, schedule: [false, false, false, false, false], overrides: {} },
    afterSchool: { tfc: true, schedule: ['none', 'none', 'none', 'none', 'none'], overrides: {} },
    holidayClubs: [],
    // Term-time activity clubs (e.g. French club): per-session rate, a static
    // Mon–Fri weekly pattern plus per-date overrides. Paid up front each
    // half-term, so their budget line is the bill landing that month
    // (termClubBills), not the month's attendance cost.
    termClubs: [],
    // Month-scoped weekly patterns. `patterns[YYYY-MM] = { breakfast:[...],
    // afterSchool:[...] }` — the effective pattern for a month is the latest one
    // set at or before it (forward-fill, like the Nursery tab). Falls back to
    // the baseline `schedule` above for months before any pattern was set.
    patterns: {},
});

export function getChildcare(settings) {
    const c = settings?.childcare;
    if (!c) return emptyChildcare();
    const d = emptyChildcare();
    return {
        startMonth:   c.startMonth ?? d.startMonth,
        nonTermDays:  Array.isArray(c.nonTermDays) ? c.nonTermDays : [],
        breakfast:    { ...d.breakfast, ...(c.breakfast || {}), overrides: (c.breakfast && c.breakfast.overrides) || {} },
        afterSchool:  { ...d.afterSchool, ...(c.afterSchool || {}), overrides: (c.afterSchool && c.afterSchool.overrides) || {} },
        holidayClubs: Array.isArray(c.holidayClubs) ? c.holidayClubs : [],
        termClubs:    Array.isArray(c.termClubs) ? c.termClubs : [],
        patterns:     (c.patterns && typeof c.patterns === 'object') ? c.patterns : {},
    };
}

// The effective weekly pattern for `concept` in `monthKey`: the latest
// month-scoped pattern set at or before monthKey, else the baseline schedule.
export function effectiveSchedule(childcare, monthKey, concept) {
    const patterns = childcare.patterns || {};
    const keys = Object.keys(patterns).filter(m => m <= monthKey).sort();
    for (let i = keys.length - 1; i >= 0; i--) {
        const v = patterns[keys[i]] && patterns[keys[i]][concept];
        if (v != null) return v;
    }
    return childcare[concept].schedule;
}

// Per-date attendance map for the displayed month. Powers both the calendar
// overlay and the cost breakdown so they can never disagree.
//   { 'YYYY-MM-DD': { nonTerm, weekend, breakfast: bool,
//                     afterSchool: 'short'|'long'|'late'|null,
//                     termClubs: [{id,name}], clubs: [{id,name}] } }
export function childcareDayMarkers(settings, monthKey) {
    const c = getChildcare(settings);
    const [y, m] = monthKey.split('-').map(Number);
    const m0 = m - 1;
    const nonTerm = new Set(c.nonTermDays);
    const bOv = c.breakfast.overrides || {};
    const aOv = c.afterSchool.overrides || {};
    const bSchedule = effectiveSchedule(c, monthKey, 'breakfast');
    const aSchedule = effectiveSchedule(c, monthKey, 'afterSchool');

    const map = {};
    const dim = daysInMonth(y, m0);
    for (let d = 1; d <= dim; d++) {
        const iso = isoOf(y, m0, d);
        const dow = new Date(y, m0, d).getDay();      // 0 Sun .. 6 Sat
        const weekend = dow === 0 || dow === 6;
        const wd = dow - 1;                            // Mon0 .. Fri4 (only 0..4 valid)
        const isNonTerm = nonTerm.has(iso);
        const termWeekday = !weekend && !isNonTerm;

        // Breakfast / after-school run only on term weekdays. On non-term days
        // and weekends they never apply (only a holiday club can be assigned),
        // so per-date overrides are ignored there.
        let breakfast = false;
        let afterSchool = null;
        let overridden = false;
        const termClubsHere = [];
        if (termWeekday) {
            breakfast = iso in bOv ? !!bOv[iso] : bSchedule[wd] === true;
            const aRec = aSchedule[wd] !== 'none' ? aSchedule[wd] : 'none';
            const aEff = iso in aOv ? aOv[iso] : aRec;
            afterSchool = aEff && aEff !== 'none' ? aEff : null;
            overridden = (iso in bOv) || (iso in aOv);
            for (const club of c.termClubs) {
                const kOv = club.overrides || {};
                const attending = iso in kOv ? !!kOv[iso] : club.schedule?.[wd] === true;
                if (attending) termClubsHere.push({ id: club.id, name: club.name });
                if (iso in kOv) overridden = true;
            }
        }
        map[iso] = { nonTerm: isNonTerm, weekend, breakfast, afterSchool, overridden, termClubs: termClubsHere, clubs: [] };
    }

    // Holiday-club day assignments (only meaningful on non-term days).
    for (const club of c.holidayClubs) {
        for (const dd of (club.days || [])) {
            if (map[dd]) map[dd].clubs.push({ id: club.id, name: club.name });
        }
    }
    return map;
}

function holidayClubCost(club, monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    const inMonth = (club.days || []).filter(dd => {
        const [dy, dm] = dd.split('-').map(Number);
        return dy === y && dm === m;
    });
    // Group by Mon–Fri week; a full 5-weekday week bills the week rate.
    const byWeek = {};
    for (const dd of inMonth) {
        const [dy, dm, ddd] = dd.split('-').map(Number);
        const key = mondayIso(dy, dm - 1, ddd);
        (byWeek[key] = byWeek[key] || []).push(new Date(dy, dm - 1, ddd).getDay());
    }
    const dayRate = Number(club.dayRate) || 0;
    const weekRate = Number(club.weekRate) || 0;
    let cost = 0;
    for (const key in byWeek) {
        const dows = byWeek[key];
        const weekdays = dows.filter(x => x >= 1 && x <= 5).length;
        const weekends = dows.filter(x => x === 0 || x === 6).length;
        cost += (weekdays === 5 ? weekRate : weekdays * dayRate) + weekends * dayRate;
    }
    return cost;
}

// Monthly childcare cost breakdown. Per-concept/-club TFC knocks 20% off that
// item, no quarterly cap. `net` is what you pay for breakfast/after-school/
// holiday clubs (feeds the gaspard_care and gaspard_holiday budget links).
// Term-time clubs are reported as this month's attendance for the breakdown,
// but their budget line is termClubAccrual (paid up front each term).
export function computeChildcare(settings, monthKey) {
    const c = getChildcare(settings);
    const markers = childcareDayMarkers(settings, monthKey);

    let breakfastDays = 0;
    let afterSchoolCost = 0;
    const termClubDays = {};
    for (const iso in markers) {
        if (markers[iso].breakfast) breakfastDays++;
        const opt = markers[iso].afterSchool;
        if (opt) afterSchoolCost += CHILDCARE_RATES.afterSchool[opt] || 0;
        for (const k of markers[iso].termClubs) termClubDays[k.id] = (termClubDays[k.id] || 0) + 1;
    }
    const breakfastCost = breakfastDays * CHILDCARE_RATES.breakfast;

    const withTfc = (cost, tfc) => ({ cost, saving: tfc ? cost * 0.20 : 0 });
    const breakfast = withTfc(breakfastCost, c.breakfast.tfc);
    const afterSchool = withTfc(afterSchoolCost, c.afterSchool.tfc);
    const holidayClubs = c.holidayClubs.map(club => ({
        id: club.id,
        name: club.name,
        ...withTfc(holidayClubCost(club, monthKey), club.tfc),
    }));
    const termClubs = c.termClubs.map(club => ({
        id: club.id,
        name: club.name,
        sessions: termClubDays[club.id] || 0,
        ...withTfc((termClubDays[club.id] || 0) * (Number(club.sessionRate) || 0), club.tfc),
    }));

    const netOf = (x) => x.cost - x.saving;
    // Two budget lines: the recurring term clubs (breakfast + after-school) can
    // be merged into one, while holiday clubs feed a separate line.
    const termNet = netOf(breakfast) + netOf(afterSchool);
    const holidayNet = holidayClubs.reduce((s, h) => s + netOf(h), 0);
    const termClubMonthNet = termClubs.reduce((s, k) => s + netOf(k), 0);
    const gross = breakfast.cost + afterSchool.cost + holidayClubs.reduce((s, h) => s + h.cost, 0);
    const tfcSaving = breakfast.saving + afterSchool.saving + holidayClubs.reduce((s, h) => s + h.saving, 0);
    return { breakfast, afterSchool, holidayClubs, termClubs, termNet, holidayNet, termClubMonthNet, gross, tfcSaving, net: termNet + holidayNet };
}

// --------------------- Per-term totals & accrual ---------------------

const monthKeyOf = (isoDate) => isoDate.slice(0, 7);

// Session totals for one half-term (a SCHOOL_TERMS entry): what the
// after-school invoice (due at the END of the half-term) and each term-time
// club's bill (due at the START) will come to. Honours nonTermDays (INSETs,
// bank holidays), the month-scoped after-school patterns and per-date
// overrides.
export function termSessionTotals(settings, term) {
    const c = getChildcare(settings);
    const nonTerm = new Set(c.nonTermDays);
    const aOv = c.afterSchool.overrides || {};
    let afterSchoolGross = 0;
    let afterSchoolSessions = 0;
    const clubTotals = c.termClubs.map(k => ({
        id: k.id, name: k.name, tfc: !!k.tfc,
        rate: Number(k.sessionRate) || 0, sessions: 0, gross: 0,
    }));

    const [sy, sm, sd] = term.start.split('-').map(Number);
    const [ey, em, ed] = term.end.split('-').map(Number);
    const cur = new Date(sy, sm - 1, sd);
    const last = new Date(ey, em - 1, ed);
    while (cur <= last) {
        const iso = isoOf(cur.getFullYear(), cur.getMonth(), cur.getDate());
        const dow = cur.getDay();
        const wd = dow - 1;
        if (dow >= 1 && dow <= 5 && !nonTerm.has(iso)) {
            const aSchedule = effectiveSchedule(c, monthKeyOf(iso), 'afterSchool');
            const aEff = iso in aOv ? aOv[iso] : aSchedule[wd];
            if (aEff && aEff !== 'none') {
                afterSchoolGross += CHILDCARE_RATES.afterSchool[aEff] || 0;
                afterSchoolSessions++;
            }
            for (const t of clubTotals) {
                const club = c.termClubs.find(k => k.id === t.id);
                const kOv = club.overrides || {};
                const attending = iso in kOv ? !!kOv[iso] : club.schedule?.[wd] === true;
                if (attending) { t.sessions++; t.gross += t.rate; }
            }
        }
        cur.setDate(cur.getDate() + 1);
    }
    const netOf = (gross, tfc) => gross - (tfc ? gross * 0.20 : 0);
    return {
        afterSchool: { sessions: afterSchoolSessions, gross: afterSchoolGross, net: netOf(afterSchoolGross, c.afterSchool.tfc) },
        clubs: clubTotals.map(t => ({ id: t.id, name: t.name, sessions: t.sessions, gross: t.gross, net: netOf(t.gross, t.tfc) })),
    };
}

// Term-time club money due in `monthKey`: clubs are paid up front, so each
// half-term's bill lands whole in the month that half-term starts and every
// other month is zero — no smoothing. Mirrors the backend's per_term rule
// (calculate_per_term_bill in api.py). `next` is the bill landing this month
// if there is one, else the next one on record (null past the last term).
export function termClubBills(settings, monthKey, terms = SCHOOL_TERMS) {
    const c = getChildcare(settings);
    if (!c.termClubs.length || !terms.length) {
        return { total: 0, bills: [], next: null };
    }
    const totalFor = (term) => termSessionTotals(settings, term).clubs.reduce((s, k) => s + k.net, 0);
    const bills = terms
        .filter(t => monthKeyOf(t.start) === monthKey)
        .map(t => ({ term: t, dueMonth: monthKeyOf(t.start), total: totalFor(t) }));
    const upcoming = terms.find(t => monthKeyOf(t.start) >= monthKey);
    const next = bills[0]
        || (upcoming ? { term: upcoming, dueMonth: monthKeyOf(upcoming.start), total: totalFor(upcoming) } : null);
    return { total: bills.reduce((s, b) => s + b.total, 0), bills, next };
}
