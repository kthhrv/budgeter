"""Database side of the payments calendar: Monzo sync, matching, learning.

The rules themselves are pure functions in `payments.py`; this module feeds
them model rows and writes the results back. Sync spans EVERY household
MonzoConnection (both people's personal accounts, and the joint account seen
through either), deduplicating transactions on their Monzo id.
"""
import datetime
from collections import defaultdict
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import transaction as db_transaction
from django.utils import timezone

from . import monzo, payments
from .models import (
    BankTransaction, BudgetItem, IgnoredPayee, ItemPayment, Month, MonzoConnection,
    Notification, PaymentsSettings,
)

LONDON = ZoneInfo('Europe/London')

# Monzo refuses anything older than 90 days outside the 5-minute post-approval
# window; stay a day inside it.
RECENT_HISTORY = datetime.timedelta(days=89)
FULL_HISTORY = datetime.timedelta(days=365)
# Monzo's 5-minute window starts when the user approves access in the Monzo
# app, which we can't see — only the OAuth callback (authorised_at), which
# comes just before. So keep trying the backfill for a while after it; a
# failed attempt costs one request and falls back to recent history.
BACKFILL_WINDOW = datetime.timedelta(minutes=30)
# Re-fetch a little before the newest stored transaction: pending ones settle
# with a changed amount/payee.
SYNC_OVERLAP = datetime.timedelta(days=7)


def local_date(dt):
    """The UK calendar date of a UTC datetime (a 00:30 BST payment is that day, not the one before)."""
    return dt.astimezone(LONDON).date()


def _api_helpers():
    # Imported lazily: api.py imports this module.
    from .api import _effective_version_for_month, _prefetched_budget_items, _school_terms
    return _effective_version_for_month, _prefetched_budget_items, _school_terms


def _tx_dict(tx):
    return {
        'id': tx.pk,
        'date': local_date(tx.created),
        'amount': tx.amount,
        'payee': tx.payee,
        'payee_key': tx.payee_key,
        'scheme': tx.scheme,
        'payment_method': tx.payment_method,
        'declined': tx.declined,
    }


def _is_expired(item, month_obj):
    return bool(item.last_payment_month and month_obj.start_date > item.last_payment_month.end_date)


def is_payment_item(item):
    """Items that are real payments in or out — everything but the Extra buffers."""
    return not item.is_extra and not item.is_auto_extra


def is_calendar_item(item):
    """Payment items still on the calendar (not hidden from it by hand)."""
    return is_payment_item(item) and not item.calendar_hidden


def is_incoming(item):
    """Income items are matched against money in; everything else money out."""
    return item.item_type == 'income'


# --- Sync ---

def _store(raw_transactions, account):
    new = 0
    for tx in raw_transactions:
        _, created = BankTransaction.objects.update_or_create(
            monzo_id=tx['id'],
            defaults={
                **payments.transaction_fields(tx),
                'account_id': account['id'],
                'account_type': account.get('type', ''),
            },
        )
        new += created
    return new


def _sync_connection(connection, now, seen_accounts):
    """Fetch new transactions for one connection's accounts. Returns the count stored."""
    try_backfill = (
        connection.history_backfilled_at is None
        and connection.authorised_at is not None
        and now - connection.authorised_at <= BACKFILL_WINDOW
    )
    backfilled = try_backfill
    fetched = 0
    for account in monzo.list_accounts(connection):
        if account['id'] in seen_accounts:
            continue
        seen_accounts.add(account['id'])
        raw = None
        if try_backfill:
            try:
                raw = monzo.list_transactions(connection, account['id'], now - FULL_HISTORY)
            except monzo.MonzoError:
                backfilled = False  # window missed or not approved yet — fall back to recent
        if raw is None:
            latest = (BankTransaction.objects.filter(account_id=account['id'])
                      .order_by('-created').values_list('created', flat=True).first())
            since = now - RECENT_HISTORY
            if latest is not None:
                since = max(since, latest - SYNC_OVERLAP)
            raw = monzo.list_transactions(connection, account['id'], since)
        fetched += _store(raw, account)
    connection.transactions_synced_at = now
    fields = ['transactions_synced_at', 'updated_at']
    if backfilled:
        connection.history_backfilled_at = now
        fields.append('history_backfilled_at')
    connection.save(update_fields=fields)
    return fetched


def sync_transactions(today=None):
    """Pull new transactions from every connection, then re-learn and re-match.

    One connection failing (expired, not approved) is reported in `errors`
    and does not stop the others. Returns {fetched, matched, errors}.
    """
    now = timezone.now()
    today = today or local_date(now)
    fetched, errors, seen_accounts = 0, [], set()
    for connection in MonzoConnection.objects.select_related('user'):
        try:
            fetched += _sync_connection(connection, now, seen_accounts)
        except monzo.MonzoError as exc:
            who = connection.user.first_name or connection.user.username
            errors.append(f"{who}: {exc}")
    relearn_items()
    matched = rematch(recent_months(today))
    after_sync(today)
    return {'fetched': fetched, 'matched': matched, 'errors': errors}


def after_sync(today):
    """Hook for work that follows a sync (notifications). Kept separate so
    tests can exercise sync and notifications independently."""
    from .notifications import generate_notifications
    generate_notifications(today)


def recent_months(today):
    """The previous and current Month rows that exist."""
    first = today.replace(day=1)
    prev = (first - datetime.timedelta(days=1)).replace(day=1)
    return list(Month.objects.filter(start_date__in=[prev, first]).order_by('start_date'))


def last_synced_at():
    times = [c.transactions_synced_at for c in MonzoConnection.objects.all() if c.transactions_synced_at]
    return max(times) if times else None


# --- Learning ---

def payee_transactions(payee_match, since=None, incoming=False):
    """Non-declined transactions in one direction whose payee contains `payee_match`."""
    sign = {'amount__gt': 0} if incoming else {'amount__lt': 0}
    qs = BankTransaction.objects.filter(payee_key__contains=payee_match, declined=False, **sign)
    if since is not None:
        qs = qs.filter(created__gte=since)
    return list(qs.order_by('created'))


def per_payment_amount(item, month_obj):
    """What one payment of `item` should be in `month_obj` (its budget value
    split across payment_parts), or None when there's no value."""
    effective_version, _, _ = _api_helpers()
    version = effective_version(item, month_obj) if month_obj else None
    if version is None or not version.value:
        return None
    return version.value / max(item.payment_parts, 1)


def _sharing(items):
    """{payee_match: [items]} for payees linked to more than one item."""
    groups = defaultdict(list)
    for i in items:
        if i.payee_match:
            groups[i.payee_match].append(i)
    return {k: v for k, v in groups.items() if len(v) > 1}


def _own_transactions(item, txs, siblings, month_obj):
    """When other items share this payee, keep only the transactions nearer
    this item's amount than theirs (so gas and electricity learn their own
    days). Falls back to all of them when amounts aren't known."""
    mine = per_payment_amount(item, month_obj)
    others = [a for a in (per_payment_amount(s, month_obj) for s in siblings if s.pk != item.pk) if a is not None]
    if mine is None or not others:
        return txs
    keep = set(payments.closest_amount_only([(t.pk, t.amount) for t in txs], mine, others))
    return [t for t in txs if t.pk in keep]


def relearn_item(item, siblings=None, month_obj=None):
    """Update a linked item's payment_method (and payment_day unless manual)
    from the last year of its payee's transactions. Returns True if changed."""
    if not item.payee_match:
        return False
    if siblings is None:
        _, prefetched_items, _ = _api_helpers()
        siblings = [i for i in prefetched_items().filter(payee_match=item.payee_match) if is_calendar_item(i)]
    if month_obj is None:
        month_obj = current_month(local_date(timezone.now()))
    txs = payee_transactions(item.payee_match, since=timezone.now() - FULL_HISTORY, incoming=is_incoming(item))
    if len(siblings) > 1:
        txs = _own_transactions(item, txs, siblings, month_obj)
    if not txs:
        return False
    method = txs[-1].payment_method
    changed = []
    if method and method != item.payment_method:
        item.payment_method = method
        changed.append('payment_method')
    if item.calculation_type == 'fixed' and not item.payment_day_manual:
        day = payments.learn_payment_day([local_date(t.created) for t in txs], method)
        if day and day != item.payment_day:
            item.payment_day = day
            changed.append('payment_day')
    if changed:
        item.save(update_fields=changed)
    return bool(changed)


def relearn_items():
    _, prefetched_items, _ = _api_helpers()
    items = [i for i in prefetched_items().exclude(payee_match='') if is_calendar_item(i)]
    shared = _sharing(items)
    month_obj = current_month(local_date(timezone.now()))
    for item in items:
        relearn_item(item, siblings=shared.get(item.payee_match, [item]), month_obj=month_obj)


# --- Occurrences and matching ---

def occurrences_for_month(items, month_obj, terms):
    """Every scheduled payment of `items` in `month_obj`.

    Returns dicts: item, version, scheduled_date, due_date, expected_amount
    (the per-payment value: monthly for fixed, weekly for weekly_count, per
    bill for per_term). Skips expired items, items with no version yet and
    items with no known day (see `unscheduled_items`).
    """
    effective_version, _, _ = _api_helpers()
    term_dates = [(t.start_date, t.end_date) for t in terms]
    out = []
    for item in items:
        if _is_expired(item, month_obj):
            continue
        version = effective_version(item, month_obj)
        if version is None:
            continue
        for scheduled in payments.scheduled_dates(
            item.calculation_type, month_obj.start_date,
            payment_day=item.payment_day,
            weekly_payment_day=item.weekly_payment_day,
            term_timing=item.term_payment_timing,
            term_dates=term_dates,
        ):
            out.append({
                'item': item,
                'version': version,
                'scheduled_date': scheduled,
                'due_date': payments.due_date_for(scheduled, item.payment_method),
                'expected_amount': version.value,
            })
    return out


def rematch(month_objs):
    """Create `auto` ItemPayments for unpaid occurrences of linked items in
    `month_objs`. Returns the number of new matches."""
    if not month_objs:
        return 0
    _, prefetched_items, school_terms = _api_helpers()
    terms = school_terms()
    items = [i for i in prefetched_items().exclude(payee_match='') if is_calendar_item(i)]
    shared = _sharing(items)
    have = defaultdict(int)  # matched transactions per (item, due_date)
    ticked = set()           # occurrences ticked by hand: nothing more to find
    for item_id, due, tx_id in ItemPayment.objects.values_list('budget_item_id', 'due_date', 'transaction_id'):
        if tx_id is None:
            ticked.add((item_id, due))
        else:
            have[(item_id, due)] += 1
    occurrences = []
    for month_obj in month_objs:
        for occ in occurrences_for_month(items, month_obj, terms):
            item = occ['item']
            slot = (item.pk, occ['due_date'])
            if slot in ticked or have[slot] >= item.payment_parts:
                continue
            occ['month'] = month_obj
            occ['key'] = len(occurrences)
            occ['payee_match'] = item.payee_match
            occ['incoming'] = is_incoming(item)
            occ['parts'] = item.payment_parts
            occ['have'] = have[slot]
            occ['shared'] = item.payee_match in shared
            if occ['version'].value:
                occ['expected'] = occ['version'].value / max(item.payment_parts, 1)
            occurrences.append(occ)
    if not occurrences:
        return 0
    start = min(o['due_date'] for o in occurrences) - datetime.timedelta(days=payments.MATCH_DAYS_BEFORE + 1)
    end = max(o['due_date'] for o in occurrences) + datetime.timedelta(days=payments.MATCH_DAYS_AFTER + 2)
    txs = BankTransaction.objects.filter(
        created__gte=datetime.datetime.combine(start, datetime.time(), LONDON),
        created__lt=datetime.datetime.combine(end, datetime.time(), LONDON),
        declined=False,
    )
    used = ItemPayment.objects.exclude(transaction=None).values_list('transaction_id', flat=True)
    pairs = payments.match_occurrences(occurrences, [_tx_dict(t) for t in txs], used_ids=used)
    with db_transaction.atomic():
        for key, tx_id in pairs:
            occ = occurrences[key]
            ItemPayment.objects.create(
                budget_item=occ['item'], month=occ['month'], due_date=occ['due_date'],
                transaction_id=tx_id, source='auto',
            )
    return len(pairs)


def _assign_payments(occs, payments_for_item):
    """Pair an item's occurrences in a month with its ItemPayment rows, grouped
    by due date (an item paid in parts has several rows per date): an exact
    due_date first, then the nearest remaining group (the learned day may have
    moved since the payment was recorded). Returns {id(occ): [rows]}."""
    groups = defaultdict(list)
    for p in payments_for_item:
        groups[p.due_date].append(p)
    remaining = dict(groups)
    assigned = {}
    for occ in occs:
        if occ['due_date'] in remaining:
            assigned[id(occ)] = remaining.pop(occ['due_date'])
    for occ in occs:
        if id(occ) in assigned or not remaining:
            continue
        nearest = min(remaining, key=lambda d: abs((d - occ['due_date']).days))
        assigned[id(occ)] = remaining.pop(nearest)
    return assigned


def _payment_payload(rows, parts):
    """The calendar's view of the payments made towards one occurrence:
    (payment or None, partial list). `payment` is set once it counts as paid —
    a hand tick, or all `parts` transactions seen — with their total."""
    listed = []
    for p in sorted(rows, key=lambda r: (r.transaction.created if r.transaction else timezone.now())):
        tx = p.transaction
        listed.append({
            'id': p.pk,
            'source': p.source,
            'date': local_date(tx.created).isoformat() if tx else None,
            'amount': float(abs(tx.amount)) if tx else None,
            'payee': tx.payee if tx else '',
        })
    if not listed:
        return None, []
    matched = [x for x in listed if x['amount'] is not None]
    hand_ticked = len(matched) < len(listed)
    if not hand_ticked and len(matched) < parts:
        return None, listed
    first = matched[0] if matched else listed[0]
    return {
        'id': first['id'],
        'source': first['source'],
        'date': matched[-1]['date'] if matched else None,
        # A hand tick alone has no amount; with transactions, it's their total.
        'amount': round(sum(x['amount'] for x in matched), 2) if matched else None,
        'payee': first['payee'],
        'parts': listed,
    }, []


def _item_summary(item, version):
    return {
        'budget_item_id': str(item.pk),
        'item_name': item.item_name,
        'item_type': item.item_type,
        'owner': item.owner,
        'expense_pot': item.expense_pot,
        'childcare_link': item.childcare_link,
        'calculation_type': item.calculation_type,
        'payee_match': item.payee_match,
        'payment_day': item.payment_day,
        'payment_day_manual': item.payment_day_manual,
        'payment_method': item.payment_method,
        'payment_parts': item.payment_parts,
        'expected_amount': float(version.value),
    }


def calendar_for_month(month_obj, today):
    """The Calendar tab's payload for one month."""
    effective_version, prefetched_items, school_terms = _api_helpers()
    terms = school_terms()
    items = [i for i in prefetched_items() if is_calendar_item(i)]
    by_item = defaultdict(list)
    for p in ItemPayment.objects.filter(month=month_obj).select_related('transaction'):
        by_item[p.budget_item_id].append(p)

    occs = occurrences_for_month(items, month_obj, terms)
    occs_by_item = defaultdict(list)
    for occ in occs:
        occs_by_item[occ['item'].pk].append(occ)

    entries = []
    for item_id, item_occs in occs_by_item.items():
        assigned = _assign_payments(item_occs, by_item.get(item_id, []))
        for occ in item_occs:
            payment, partial = _payment_payload(assigned.get(id(occ), []), occ['item'].payment_parts)
            entries.append({
                **_item_summary(occ['item'], occ['version']),
                'scheduled_date': occ['scheduled_date'].isoformat(),
                'due_date': occ['due_date'].isoformat(),
                'status': payments.occurrence_status(occ['due_date'], payment is not None, today),
                'payment': payment,
                'partial': partial,
            })
    entries.sort(key=lambda e: (e['due_date'], e['item_name']))

    unscheduled = []
    for item in items:
        if item.calculation_type != 'fixed' or item.payment_day or _is_expired(item, month_obj):
            continue
        version = effective_version(item, month_obj)
        # Childcare-linked items store £0: their amount is filled in client-side.
        if version is not None and (version.value or item.childcare_link):
            unscheduled.append(_item_summary(item, version))
    unscheduled.sort(key=lambda e: e['item_name'])

    hidden = [{'budget_item_id': str(i.pk), 'item_name': i.item_name, 'item_type': i.item_type, 'owner': i.owner}
              for i in prefetched_items()
              if is_payment_item(i) and i.calendar_hidden and not _is_expired(i, month_obj)]
    hidden.sort(key=lambda e: e['item_name'])

    connections = list(MonzoConnection.objects.all())
    synced = [c.transactions_synced_at for c in connections if c.transactions_synced_at]
    return {
        'month_id': month_obj.month_id,
        'connected': bool(connections),
        # Demo/local seed data counts too: linking works without a live connection.
        'has_transactions': BankTransaction.objects.exists(),
        'history_backfilled': any(c.history_backfilled_at for c in connections),
        'last_synced_at': max(synced).isoformat() if synced else None,
        'entries': entries,
        'unscheduled': unscheduled,
        'hidden': hidden,
    }


# --- Linking ---

def current_month(today):
    return Month.objects.filter(start_date=today.replace(day=1)).first()


SEARCH_LIMIT = 20


def search_payees(query='', amount=None, incoming=False):
    """Find Monzo payees for linking an item whose name doesn't match its payee.

    Searches the last year of outgoing transactions. `query` matches when
    every word of it appears in the payee (case- and punctuation-blind) or
    the raw text appears in the payee as Monzo shows it. Only money in when
    `incoming` (for income items), else only money out. With no query,
    `amount` finds payments within 1p of that value instead. Results are
    grouped by payee, most recently paid first: payee_key (what linking
    stores), payee, count, last_date, last_amount, amounts (distinct, newest
    first), payment_method, usual_day, and linked_item (the item already
    using that payee, if any).
    """
    query = (query or '').strip()
    if not query and amount is None:
        return []
    qs = BankTransaction.objects.filter(
        created__gte=timezone.now() - FULL_HISTORY, declined=False,
        **({'amount__gt': 0} if incoming else {'amount__lt': 0}),
    ).exclude(payee_key='').exclude(scheme='uk_retail_pot')
    if query:
        words = payments.normalise_payee(query).split()
        matches = [t for t in qs.order_by('-created')
                   if (words and all(w in t.payee_key for w in words)) or query.lower() in t.payee.lower()]
    else:
        target = Decimal(str(amount))
        signed = target if incoming else -target
        matches = list(qs.filter(amount__gte=signed - Decimal('0.01'), amount__lte=signed + Decimal('0.01'))
                       .order_by('-created'))

    groups = {}
    for t in matches:  # newest first
        groups.setdefault(t.payee_key, []).append(t)
    linked = {i.payee_match: i.item_name for i in BudgetItem.objects.exclude(payee_match='')}
    out = []
    for key, txs in groups.items():
        latest = txs[0]
        amounts = []
        for t in txs:
            if abs(t.amount) not in amounts:
                amounts.append(abs(t.amount))
        out.append({
            'payee_key': key,
            'payee': latest.payee,
            'count': len(txs),
            'last_date': local_date(latest.created).isoformat(),
            'last_amount': float(abs(latest.amount)),
            'amounts': [float(a) for a in amounts[:5]],
            # Each recent payment, so two a month (gas + electricity) show as two.
            'recent': [{'date': local_date(t.created).isoformat(), 'amount': float(abs(t.amount))} for t in txs[:6]],
            'payment_method': latest.payment_method,
            'usual_day': payments.learn_payment_day([local_date(t.created) for t in txs], latest.payment_method),
            'linked_item': next((name for match, name in linked.items() if match in key), None),
        })
    return out[:SEARCH_LIMIT]


def payee_suggestions(today):
    """Recurring payees not yet linked or ignored, with ranked candidate items."""
    effective_version, prefetched_items, _ = _api_helpers()
    txs = [_tx_dict(t) for t in BankTransaction.objects.filter(
        created__gte=timezone.now() - FULL_HISTORY, declined=False,
    )]
    recurring = payments.find_recurring(txs)
    all_items = [i for i in prefetched_items() if is_payment_item(i)]
    # A hidden item's payee is still spoken for: don't re-suggest it.
    links = [i.payee_match for i in all_items if i.payee_match]
    items = [i for i in all_items if not i.calendar_hidden]
    ignored = set(IgnoredPayee.objects.values_list('payee_key', flat=True))
    recurring = [r for r in recurring
                 if r['payee_key'] not in ignored and not any(m in r['payee_key'] for m in links)]

    month_obj = current_month(today)
    candidates = []
    for item in items:
        if item.payee_match or (month_obj and _is_expired(item, month_obj)):
            continue
        version = effective_version(item, month_obj) if month_obj else None
        candidates.append({
            'id': str(item.pk),
            'name': item.item_name,
            'amount': float(version.value) if version else 0.0,
            'incoming': is_incoming(item),
        })
    out = payments.suggest_links(recurring, candidates)
    for s in out:
        s['amount'] = float(s['amount'])
        s['first_date'] = s['first_date'].isoformat()
        s['last_date'] = s['last_date'].isoformat()
    return out


def link_item(item, payee_match, payment_day=None, payment_day_manual=None, today=None):
    """Set an item's payee (and optionally a manual day), learn, and backfill matches."""
    item.payee_match = payments.normalise_payee(payee_match)
    if payment_day_manual is not None:
        item.payment_day_manual = payment_day_manual
    if payment_day is not None:
        item.payment_day = payment_day
    item.save()
    # Every item on this payee: a newcomer changes which payments are whose.
    _, prefetched_items, _ = _api_helpers()
    siblings = [i for i in prefetched_items().filter(payee_match=item.payee_match) if is_calendar_item(i)] or [item]
    for sibling in siblings:
        relearn_item(sibling, siblings=siblings)
    today = today or local_date(timezone.now())
    months = recent_months(today)
    if len(siblings) > 1:
        # Payments matched before this item joined may be its own: redo the
        # automatic matches on this payee (hand-picked ones stay).
        ItemPayment.objects.filter(budget_item__in=siblings, month__in=months, source='auto').delete()
    rematch(months)
    item.refresh_from_db()
    return item


def unlink_item(item):
    """Forget the payee link and any automatic matches (manual ticks stay)."""
    item.payee_match = ''
    item.payment_method = ''
    if not item.payment_day_manual:
        item.payment_day = None
    item.save()
    ItemPayment.objects.filter(budget_item=item).exclude(source='manual').delete()


CANDIDATE_DAYS = 10


def candidate_transactions(item, due_date, query=''):
    """Transactions that could pay `item`'s occurrence due on `due_date`, for
    linking one by hand: those of its payee (or matching `query`) within
    CANDIDATE_DAYS of the date, closest first. Each says which item, if any,
    it already pays."""
    start = datetime.datetime.combine(due_date - datetime.timedelta(days=CANDIDATE_DAYS), datetime.time(), LONDON)
    end = datetime.datetime.combine(due_date + datetime.timedelta(days=CANDIDATE_DAYS + 1), datetime.time(), LONDON)
    qs = (BankTransaction.objects.filter(created__gte=start, created__lt=end, declined=False,
                                         **({'amount__gt': 0} if is_incoming(item) else {'amount__lt': 0}))
          .exclude(scheme='uk_retail_pot').select_related('item_payment__budget_item'))
    query = (query or '').strip()
    if query:
        words = payments.normalise_payee(query).split()
        txs = [t for t in qs if (words and all(w in t.payee_key for w in words)) or query.lower() in t.payee.lower()]
    elif item.payee_match:
        txs = list(qs.filter(payee_key__contains=item.payee_match))
    else:
        txs = []
    txs.sort(key=lambda t: (abs((local_date(t.created) - due_date).days), t.created))
    out = []
    for t in txs[:SEARCH_LIMIT]:
        linked = getattr(t, 'item_payment', None)
        out.append({
            'id': t.pk,
            'date': local_date(t.created).isoformat(),
            'amount': float(abs(t.amount)),
            'payee': t.payee,
            'payee_key': t.payee_key,
            'linked_item_id': str(linked.budget_item_id) if linked else None,
            'linked_item': linked.budget_item.item_name if linked else None,
        })
    return out


def link_transaction(item, due_date, tx, month_obj, today):
    """Count `tx` towards `item`'s occurrence on `due_date` (taking it off any
    other item). If that makes more payments than the item expects, it now
    expects that many each time; an item with no payee picks up this one's."""
    with db_transaction.atomic():
        ItemPayment.objects.filter(transaction=tx).delete()
        ItemPayment.objects.create(budget_item=item, month=month_obj, due_date=due_date,
                                   transaction=tx, source='confirmed')
        count = ItemPayment.objects.filter(budget_item=item, due_date=due_date).exclude(transaction=None).count()
        if count > item.payment_parts:
            item.payment_parts = count
            item.save(update_fields=['payment_parts'])
    if not item.payee_match:
        link_item(item, tx.payee_key, today=today)
    return count


def set_hidden(item, hidden, user=None):
    """Take an item off the calendar (or put it back). Hiding closes its open
    notifications; its past ticks stay, so showing it again loses nothing."""
    item.calendar_hidden = hidden
    item.save(update_fields=['calendar_hidden'])
    if hidden:
        Notification.objects.filter(budget_item=item, status='open').update(
            status='dismissed', resolved_at=timezone.now(), resolved_by=user,
        )


# --- Balances ---

def owner_for_user(user):
    """'keith' / 'tild' for a household login, from settings.OWNER_BY_EMAIL."""
    return settings.OWNER_BY_EMAIL.get((user.email or '').lower())


def personal_account_balance(owner):
    """Live balance of `owner`'s own Monzo current account (pots excluded).

    Returns ({name, balance} or None, error or None). None with no error
    means that person hasn't connected Monzo.
    """
    for connection in MonzoConnection.objects.select_related('user'):
        if owner_for_user(connection.user) != owner:
            continue
        try:
            account = next((a for a in monzo.list_accounts(connection) if a.get('type') == 'uk_retail'), None)
            if account is None:
                return None, "No personal Monzo account on that connection."
            return {'name': 'Current account', 'balance': monzo.get_balance(connection, account['id'])}, None
        except monzo.MonzoError as exc:
            return None, str(exc)
    return None, None


# --- Pot balances ---

def household_pots():
    """Every Monzo pot visible through any household connection, deduped
    (a joint-account pot is visible to both). Returns (pots, errors)."""
    pots, seen, errors = [], set(), []
    for connection in MonzoConnection.objects.select_related('user'):
        try:
            for pot in monzo.list_pots(connection):
                if pot['id'] not in seen:
                    seen.add(pot['id'])
                    pots.append(pot)
        except monzo.MonzoError as exc:
            errors.append(f"{connection.user.first_name or connection.user.username}: {exc}")
    return pots, errors


def linked_pot_balances():
    """{pot_key: {pot_id, name, balance} or None} for each linked budget pot,
    with live balances; plus any connection errors."""
    pot_settings = PaymentsSettings.get_solo()
    if not pot_settings.pot_ids:
        return {}, []
    pots, errors = household_pots()
    by_id = {p['id']: p for p in pots}
    out = {}
    for key, pot_id in pot_settings.pot_ids.items():
        pot = by_id.get(pot_id)
        out[key] = {'pot_id': pot_id, 'name': pot['name'], 'balance': pot['balance']} if pot else None
    return out, errors
