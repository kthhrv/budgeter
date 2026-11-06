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


def relearn_item(item):
    """Update a linked item's payment_method (and payment_day unless manual)
    from the last year of its payee's transactions. Returns True if changed."""
    if not item.payee_match:
        return False
    txs = payee_transactions(item.payee_match, since=timezone.now() - FULL_HISTORY, incoming=is_incoming(item))
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
    for item in BudgetItem.objects.exclude(payee_match=''):
        relearn_item(item)


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
    paid = set(ItemPayment.objects.values_list('budget_item_id', 'due_date'))
    occurrences = []
    for month_obj in month_objs:
        for occ in occurrences_for_month(items, month_obj, terms):
            if (occ['item'].pk, occ['due_date']) in paid:
                continue
            occ['month'] = month_obj
            occ['key'] = len(occurrences)
            occ['payee_match'] = occ['item'].payee_match
            occ['incoming'] = is_incoming(occ['item'])
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
    """Pair an item's occurrences in a month with its ItemPayment rows: an
    exact due_date first, then the nearest remaining one (the learned day may
    have moved since the payment was recorded)."""
    remaining = list(payments_for_item)
    assigned = {}
    for occ in occs:
        exact = next((p for p in remaining if p.due_date == occ['due_date']), None)
        if exact:
            assigned[id(occ)] = exact
            remaining.remove(exact)
    for occ in occs:
        if id(occ) in assigned or not remaining:
            continue
        nearest = min(remaining, key=lambda p: abs((p.due_date - occ['due_date']).days))
        assigned[id(occ)] = nearest
        remaining.remove(nearest)
    return assigned


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
            p = assigned.get(id(occ))
            payment = None
            if p is not None:
                tx = p.transaction
                payment = {
                    'id': p.pk,
                    'source': p.source,
                    'date': local_date(tx.created).isoformat() if tx else None,
                    'amount': float(abs(tx.amount)) if tx else None,
                    'payee': tx.payee if tx else '',
                }
            entries.append({
                **_item_summary(occ['item'], occ['version']),
                'scheduled_date': occ['scheduled_date'].isoformat(),
                'due_date': occ['due_date'].isoformat(),
                'status': payments.occurrence_status(occ['due_date'], p is not None, today),
                'payment': payment,
            })
    entries.sort(key=lambda e: (e['due_date'], e['item_name']))

    unscheduled = []
    for item in items:
        if item.calculation_type != 'fixed' or item.payment_day or _is_expired(item, month_obj):
            continue
        version = effective_version(item, month_obj)
        if version is not None and version.value:
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
    relearn_item(item)
    today = today or local_date(timezone.now())
    rematch(recent_months(today))
    return item


def unlink_item(item):
    """Forget the payee link and any automatic matches (manual ticks stay)."""
    item.payee_match = ''
    item.payment_method = ''
    if not item.payment_day_manual:
        item.payment_day = None
    item.save()
    ItemPayment.objects.filter(budget_item=item).exclude(source='manual').delete()


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
