"""Notifications raised by the payments calendar, and the actions on them.

Generated after every transaction sync (payment_service.after_sync):

- amount_changed — a matched payment differs from the budgeted per-payment
  value by more than 1p. Childcare-linked items are skipped: their value is
  only known client-side. Auto-resolves once the budget matches the payment.
- missed — a linked item is overdue (see payments.occurrence_status) with no
  payment. Checked for the previous and current month only. Auto-resolves if
  the payment turns up.
- new_payee — a recurring payee, neither linked nor ignored, whose first
  payment is recent (NEW_PAYEE_DAYS). Older recurring payees are the
  Link-payees screen's job, not the bell's — otherwise the first sync after
  connecting would raise one notification per existing bill. Auto-resolves
  once an item links to it.

Each item/month or payee raises a kind once (model constraints), so a
dismissed notification stays dismissed.
"""
import calendar
import datetime
from decimal import Decimal

from django.db import transaction as db_transaction
from django.utils import timezone

from . import payment_service
from .models import BudgetItem, IgnoredPayee, ItemPayment, Month, Notification

AMOUNT_TOLERANCE = Decimal('0.01')
NEW_PAYEE_DAYS = 45


def _month_for(date):
    """Get or create the Month row containing `date`."""
    start = date.replace(day=1)
    end = start.replace(day=calendar.monthrange(start.year, start.month)[1])
    month, _ = Month.objects.get_or_create(
        month_id=start.strftime('%Y-%m'),
        defaults={'month_name': start.strftime('%B %Y'), 'start_date': start, 'end_date': end},
    )
    return month


def _resolve(notification, user=None, status='resolved'):
    notification.status = status
    notification.resolved_at = timezone.now()
    notification.resolved_by = user
    notification.save(update_fields=['status', 'resolved_at', 'resolved_by'])


def _item_notifications(month_obj, today):
    payload = payment_service.calendar_for_month(month_obj, today)
    differing, missed, fine_items, paid_items = {}, {}, set(), set()
    for e in payload['entries']:
        if not e['payee_match']:
            continue
        item_id = e['budget_item_id']
        p = e['payment']
        if p is not None:
            paid_items.add(item_id)
            if p['amount'] is None or e['childcare_link']:
                continue
            expected = Decimal(str(e['expected_amount']))
            actual = Decimal(str(p['amount']))
            if abs(actual - expected) > AMOUNT_TOLERANCE:
                differing[item_id] = (e, expected, actual)  # latest occurrence wins
            else:
                fine_items.add(item_id)
        elif e['status'] == 'overdue':
            missed.setdefault(item_id, e)

    for item_id, (e, expected, actual) in differing.items():
        data = {
            'item_name': e['item_name'],
            'incoming': e['item_type'] == 'income',
            'expected': float(expected),
            'actual': float(actual),
            'due_date': e['due_date'],
            'payment_date': e['payment']['date'],
            'payee': e['payment']['payee'],
            'calculation_type': e['calculation_type'],
        }
        n, created = Notification.objects.get_or_create(
            kind='amount_changed', budget_item_id=item_id, month=month_obj, defaults={'data': data},
        )
        if not created and n.status == 'open' and n.data != data:
            n.data = data
            n.save(update_fields=['data'])
    # The budget now matches what was paid (edited on the Budget tab, say).
    for n in Notification.objects.filter(kind='amount_changed', month=month_obj, status='open',
                                         budget_item_id__in=fine_items - set(differing)):
        _resolve(n)

    for item_id, e in missed.items():
        Notification.objects.get_or_create(
            kind='missed', budget_item_id=item_id, month=month_obj,
            defaults={'data': {
                'item_name': e['item_name'],
                'incoming': e['item_type'] == 'income',
                'expected': e['expected_amount'],
                'due_date': e['due_date'],
                'payee_match': e['payee_match'],
            }},
        )
    for n in Notification.objects.filter(kind='missed', month=month_obj, status='open',
                                         budget_item_id__in=paid_items):
        _resolve(n)


def _payee_notifications(today):
    suggestions = payment_service.payee_suggestions(today)
    open_keys = {s['payee_key'] for s in suggestions}
    cutoff = today - datetime.timedelta(days=NEW_PAYEE_DAYS)
    for s in suggestions:
        if datetime.date.fromisoformat(s['first_date']) < cutoff:
            continue
        Notification.objects.get_or_create(
            kind='new_payee', payee_key=s['payee_key'],
            defaults={'data': {
                'payee': s['payee'],
                'incoming': s['incoming'],
                'amount': s['amount'],
                'cadence': s['cadence'],
                'usual_day': s['usual_day'],
                'usual_weekday': s['usual_weekday'],
                'payment_method': s['payment_method'],
            }},
        )
    # Linked (or ignored) since: no longer a suggestion.
    for n in Notification.objects.filter(kind='new_payee', status='open').exclude(payee_key__in=open_keys):
        _resolve(n)


def generate_notifications(today):
    for month_obj in payment_service.recent_months(today):
        _item_notifications(month_obj, today)
    _payee_notifications(today)


# --- Reading ---

def available_actions(n, today):
    if n.status != 'open':
        return []
    if n.kind == 'amount_changed':
        actions = ['reconcile']
        if n.month and n.month.start_date == today.replace(day=1):
            actions.append('one_off')
        return actions + ['dismiss']
    if n.kind == 'missed':
        return ['mark_paid', 'dismiss']
    return ['link', 'dismiss']


def serialize(n, today):
    return {
        'id': n.pk,
        'kind': n.kind,
        'status': n.status,
        'budget_item_id': str(n.budget_item_id) if n.budget_item_id else None,
        'month_id': n.month_id,
        'month_name': n.month.month_name if n.month else None,
        'payee_key': n.payee_key,
        'data': n.data,
        'created_at': n.created_at.isoformat(),
        'actions': available_actions(n, today),
    }


# --- Actions ---

class ActionError(Exception):
    """An action that can't be applied; the message is safe to show."""


def apply_action(n, action, user, today, item_id=None):
    """Apply `action` to notification `n`. Raises ActionError if not allowed."""
    if action not in available_actions(n, today):
        raise ActionError(f"'{action}' isn't available for this notification.")
    from .api import _set_item_value  # lazy: api imports this module

    if action == 'dismiss':
        if n.kind == 'new_payee':
            IgnoredPayee.objects.get_or_create(payee_key=n.payee_key)
        _resolve(n, user, status='dismissed')
        return

    with db_transaction.atomic():
        if action == 'reconcile':
            # From the payment's month onward; past months stay locked, so a
            # change spotted last month is applied from this month.
            month = n.month if n.month.start_date >= today.replace(day=1) else _month_for(today)
            _set_item_value(n.budget_item, month, n.data['actual'], is_one_off=False)
        elif action == 'one_off':
            _set_item_value(n.budget_item, n.month, n.data['actual'], is_one_off=True)
        elif action == 'mark_paid':
            ItemPayment.objects.get_or_create(
                budget_item=n.budget_item, due_date=datetime.date.fromisoformat(n.data['due_date']),
                transaction=None, defaults={'month': n.month, 'source': 'manual'},
            )
        elif action == 'link':
            if not item_id:
                raise ActionError("Pick the budget item this payee pays for.")
            item = BudgetItem.objects.filter(pk=item_id).first()
            if item is None:
                raise ActionError("That budget item no longer exists.")
            payment_service.link_item(item, n.payee_key, today=today)
        _resolve(n, user)
