"""Pure logic for the payments calendar: dates, payee matching, learning.

Stdlib only (no Django, no models) so every rule here is unit-testable on
plain values. The database side — syncing from Monzo, writing ItemPayment
rows, building the calendar payload — lives in `payment_service.py`.

The rules, in one place:

- Only DIRECT DEBITS roll forward over weekends and bank holidays (Bacs
  collects on working days only). Card payments and Monzo standing orders go
  out on the scheduled day, weekend or not.
- Income paid by Bacs (salary — method `bacs_credit`) rolls BACK to the
  working day before, which is how payroll pays.
- Money in only matches income items and money out only matches the rest.
- A transaction matches an item when its normalised payee contains the
  item's `payee_match` and it lands between MATCH_DAYS_BEFORE days before and
  MATCH_DAYS_AFTER days after the due date. The amount is deliberately NOT
  part of the match — a different amount is a notification, not a miss.
- An item's usual day is learned from past payment dates; for direct debits
  the dates that could have been rolled forward are ignored when any others
  exist.
"""
import calendar
import datetime
import re
from collections import Counter, defaultdict
from decimal import Decimal

# England & Wales bank holidays. Keep in step with BANK_HOLIDAYS in
# frontend/src/utils/nurseryCalc.js (same dates, same years).
BANK_HOLIDAYS = frozenset(datetime.date.fromisoformat(d) for d in (
    # 2026
    '2026-01-01', '2026-04-03', '2026-04-06',
    '2026-05-04', '2026-05-25', '2026-08-31',
    '2026-12-25', '2026-12-28',
    # 2027
    '2027-01-01', '2027-03-26', '2027-03-29',
    '2027-05-03', '2027-05-31', '2027-08-30',
    '2027-12-27', '2027-12-28',
))

MATCH_DAYS_BEFORE = 3
MATCH_DAYS_AFTER = 5
OVERDUE_WORKING_DAYS = 3

DIRECT_DEBIT = 'direct_debit'
BACS_CREDIT = 'bacs_credit'
STANDING_ORDER = 'standing_order'
CARD = 'card'
OTHER = 'other'


# --- Working days ---

def is_working_day(d):
    return d.weekday() < 5 and d not in BANK_HOLIDAYS


def next_working_day(d):
    """`d` itself if it's a working day, else the next one."""
    while not is_working_day(d):
        d += datetime.timedelta(days=1)
    return d


def previous_working_day(d):
    """`d` itself if it's a working day, else the one before."""
    while not is_working_day(d):
        d -= datetime.timedelta(days=1)
    return d


def could_be_rolled(d, payment_method=DIRECT_DEBIT):
    """True if a payment landing on `d` might have been scheduled for another
    (non-working) day: an earlier one for a direct debit (the day before `d`
    wasn't a working day), a later one for Bacs income (the day after wasn't)."""
    step = datetime.timedelta(days=1 if payment_method == BACS_CREDIT else -1)
    return not is_working_day(d + step)


def working_days_after(start, end):
    """Working days strictly after `start`, up to and including `end`."""
    count, d = 0, start
    while d < end:
        d += datetime.timedelta(days=1)
        if is_working_day(d):
            count += 1
    return count


# --- Payees and transactions ---

_NOISE_TOKENS = {'LTD', 'LIMITED', 'PLC', 'DD', 'REF', 'THE'}


def normalise_payee(text):
    """Upper-case letters only, noise words and single letters dropped.

    Both a transaction's payee and an item's payee_match go through this, so
    "Sky Digital Ltd, ref 12345" and "SKY DIGITAL" compare equal.
    """
    tokens = re.sub(r'[^A-Z]+', ' ', (text or '').upper()).split()
    return ' '.join(t for t in tokens if len(t) > 1 and t not in _NOISE_TOKENS)


def payment_method_for(scheme, metadata=None, incoming=False):
    """Map a Monzo transaction scheme (+ metadata, + direction) to a payment method."""
    if scheme == 'bacs':
        return BACS_CREDIT if incoming else DIRECT_DEBIT
    if scheme == 'mastercard':
        return CARD
    if any('standing_order' in key for key in (metadata or {})):
        return STANDING_ORDER
    return OTHER


def transaction_fields(tx):
    """BankTransaction field values from a raw Monzo transaction dict."""
    merchant = tx.get('merchant')
    payee = ''
    if isinstance(merchant, dict):
        payee = merchant.get('name') or ''
    if not payee:
        payee = (tx.get('counterparty') or {}).get('name') or ''
    if not payee:
        payee = tx.get('description') or ''
    created = datetime.datetime.fromisoformat(tx['created'].replace('Z', '+00:00'))
    return {
        'created': created,
        'amount': Decimal(int(tx.get('amount', 0))) / 100,
        'payee': payee[:200],
        'payee_key': normalise_payee(payee)[:200],
        'scheme': tx.get('scheme') or '',
        'payment_method': payment_method_for(tx.get('scheme'), tx.get('metadata'), incoming=int(tx.get('amount', 0)) > 0),
        'category': tx.get('category') or '',
        'declined': bool(tx.get('decline_reason')),
    }


# --- Scheduling ---

def clamp_day(year, month, day):
    return datetime.date(year, month, min(day, calendar.monthrange(year, month)[1]))


def scheduled_dates(calculation_type, month_start, *, payment_day=None,
                    weekly_payment_day=None, term_timing='', term_dates=()):
    """The dates an item is scheduled for in the month starting `month_start`,
    before any working-day roll.

    - fixed: `payment_day`, clamped to short months (none if no day known).
    - weekly_count: every `weekly_payment_day` (1=Mon … 7=Sun) in the month.
    - per_term: each term start/end date (per `term_timing`) in the month;
      `term_dates` is an iterable of (start_date, end_date).
    """
    y, m = month_start.year, month_start.month
    if calculation_type == 'weekly_count':
        if not weekly_payment_day:
            return []
        days = calendar.monthrange(y, m)[1]
        return [datetime.date(y, m, d) for d in range(1, days + 1)
                if datetime.date(y, m, d).isoweekday() == weekly_payment_day]
    if calculation_type == 'per_term':
        picked = [s if term_timing == 'start' else e for s, e in term_dates] if term_timing else []
        return sorted(d for d in picked if (d.year, d.month) == (y, m))
    if not payment_day:
        return []
    return [clamp_day(y, m, payment_day)]


def due_date_for(scheduled, payment_method):
    """When the money actually moves: direct debits roll to the next working
    day, Bacs income (salary) to the working day before."""
    if payment_method == DIRECT_DEBIT:
        return next_working_day(scheduled)
    if payment_method == BACS_CREDIT:
        return previous_working_day(scheduled)
    return scheduled


def occurrence_status(due_date, paid, today):
    """paid / upcoming / due / overdue for one occurrence."""
    if paid:
        return 'paid'
    if today < due_date:
        return 'upcoming'
    if working_days_after(due_date, today) > OVERDUE_WORKING_DAYS:
        return 'overdue'
    return 'due'


# --- Learning ---

def _mode(values):
    """Most common value; ties go to the smallest."""
    counts = Counter(values)
    best = max(counts.values())
    return min(v for v, c in counts.items() if c == best)


def _scheduled_extreme(d, payment_method):
    """Walk over the non-working days a payment may have rolled past: back to
    the earliest day for a direct debit, forward to the latest for Bacs income."""
    step = datetime.timedelta(days=1 if payment_method == BACS_CREDIT else -1)
    while could_be_rolled(d, payment_method) and (d + step).month == d.month:
        d += step
    return d.day


def learn_payment_day(dates, payment_method):
    """The usual day of the month from past payment dates (None if no dates).

    For direct debits and Bacs income, dates that might be weekend/bank-holiday
    rolls are ignored when any unambiguous date exists; if every date is
    ambiguous, the furthest day it could have been scheduled for is used.
    """
    if not dates:
        return None
    if payment_method in (DIRECT_DEBIT, BACS_CREDIT):
        firm = [d.day for d in dates if not could_be_rolled(d, payment_method)]
        if firm:
            return _mode(firm)
        return _mode([_scheduled_extreme(d, payment_method) for d in dates])
    return _mode([d.day for d in dates])


# --- Recurring payees and suggestions ---

def _is_payment(tx, incoming=False):
    """A real payment in the given direction (pot moves and declines don't count)."""
    if tx['declined'] or not tx['payee_key'] or tx['scheme'] == 'uk_retail_pot':
        return False
    return tx['amount'] > 0 if incoming else tx['amount'] < 0


def find_recurring(transactions):
    """Payees paid on a regular cadence, from transaction dicts with keys
    date, amount, payee, payee_key, scheme, payment_method, declined.

    Money in and money out are grouped separately. Monthly = at least two
    payments in different months with a gap of 25-35 days between some
    consecutive pair; weekly = a 6-8 day gap with at least three payments.
    Returns a list (biggest amount first) of dicts with payee_key, payee,
    incoming, amount (positive, latest), cadence, usual_day (day of month,
    monthly only), usual_weekday (1=Mon, weekly only), payment_method,
    count, first_date, last_date.
    """
    groups = defaultdict(list)
    for tx in transactions:
        for incoming in (False, True):
            if _is_payment(tx, incoming):
                groups[(tx['payee_key'], incoming)].append(tx)
    out = []
    for (key, incoming), txs in groups.items():
        txs.sort(key=lambda t: t['date'])
        gaps = [(b['date'] - a['date']).days for a, b in zip(txs, txs[1:])]
        months = {(t['date'].year, t['date'].month) for t in txs}
        cadence = None
        if len(months) >= 2 and any(25 <= g <= 35 for g in gaps):
            cadence = 'monthly'
        elif len(txs) >= 3 and any(6 <= g <= 8 for g in gaps):
            cadence = 'weekly'
        if cadence is None:
            continue
        latest = txs[-1]
        method = latest['payment_method']
        out.append({
            'payee_key': key,
            'payee': latest['payee'],
            'incoming': incoming,
            'amount': abs(latest['amount']),
            'cadence': cadence,
            'usual_day': learn_payment_day([t['date'] for t in txs], method) if cadence == 'monthly' else None,
            'usual_weekday': _mode([t['date'].isoweekday() for t in txs]) if cadence == 'weekly' else None,
            'payment_method': method,
            'count': len(txs),
            'first_date': txs[0]['date'],
            'last_date': latest['date'],
        })
    out.sort(key=lambda r: (-r['amount'], r['payee_key']))
    return out


def _name_tokens(text):
    return {t for t in normalise_payee(text).split() if len(t) >= 3}


def suggest_links(recurring, items):
    """Rank unlinked budget items against each recurring payee.

    `items`: dicts with id, name, amount (current per-payment value) and
    incoming (True for income items — only offered for money in, and vice
    versa). Scoring: +2 for an amount within 1p, +1 per shared name word.
    A suggestion is `ambiguous` when the top two candidates score the same —
    the user then picks; otherwise `suggested_item_id` is the top candidate.
    """
    out = []
    for r in recurring:
        payee_tokens = set(r['payee_key'].split())
        candidates = []
        for item in items:
            if bool(item.get('incoming')) != bool(r.get('incoming')):
                continue
            score = 0
            if abs(Decimal(str(item['amount'])) - Decimal(str(r['amount']))) <= Decimal('0.01'):
                score += 2
            score += len(_name_tokens(item['name']) & payee_tokens)
            if score:
                candidates.append({'item_id': item['id'], 'name': item['name'], 'amount': item['amount'], 'score': score})
        candidates.sort(key=lambda c: (-c['score'], c['name']))
        ambiguous = len(candidates) >= 2 and candidates[0]['score'] == candidates[1]['score']
        out.append({
            **r,
            'candidates': candidates,
            'ambiguous': ambiguous,
            'suggested_item_id': candidates[0]['item_id'] if candidates and not ambiguous else None,
        })
    return out


# --- Matching ---

def match_occurrences(occurrences, transactions, used_ids=()):
    """Pair due occurrences with transactions.

    `occurrences`: dicts with key, payee_match, due_date and optionally
    incoming (True for income items: only money in matches them).
    `transactions`: dicts with id, date, amount, payee_key, scheme, declined.
    Each occurrence takes the closest-dated (earlier on a tie) unused outgoing
    transaction whose payee_key contains its payee_match, within the match
    window. Occurrences are handled in due-date order and a transaction is
    never used twice. Returns [(occurrence_key, transaction_id)].
    """
    used = set(used_ids)
    pairs = []
    for occ in sorted(occurrences, key=lambda o: o['due_date']):
        needle = occ['payee_match']
        if not needle:
            continue
        best = None
        for tx in transactions:
            if tx['id'] in used or not _is_payment(tx, occ.get('incoming', False)) or needle not in tx['payee_key']:
                continue
            delta = (tx['date'] - occ['due_date']).days
            if not -MATCH_DAYS_BEFORE <= delta <= MATCH_DAYS_AFTER:
                continue
            rank = (abs(delta), delta)
            if best is None or rank < best[0]:
                best = (rank, tx['id'])
        if best is not None:
            used.add(best[1])
            pairs.append((occ['key'], best[1]))
    return pairs
