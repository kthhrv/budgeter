"""Payments calendar: pure rules (payments.py), sync/matching
(payment_service.py), notifications and their endpoints."""
import datetime
import os
from decimal import Decimal
from unittest import mock

from django.contrib.auth.models import User
from django.test import Client, SimpleTestCase, TestCase

from . import payments as p
from .models import (
    BankTransaction, BudgetItem, BudgetItemVersion, IgnoredPayee, ItemPayment, Month,
    MonzoConnection, Notification,
)
from .tests_monzo import MONZO_ENV, _fake_response

D = datetime.date


class WorkingDayTests(SimpleTestCase):
    def test_weekend_rolls_to_monday(self):
        self.assertEqual(p.next_working_day(D(2026, 11, 14)), D(2026, 11, 16))

    def test_rolls_across_christmas_bank_holidays(self):
        # Fri 25 Dec (BH), weekend, Mon 28 Dec (BH) → Tue 29 Dec.
        self.assertEqual(p.next_working_day(D(2026, 12, 25)), D(2026, 12, 29))

    def test_could_be_rolled(self):
        self.assertTrue(p.could_be_rolled(D(2026, 11, 16)))   # Monday
        self.assertFalse(p.could_be_rolled(D(2026, 11, 17)))  # Tuesday
        self.assertTrue(p.could_be_rolled(D(2026, 12, 29)))   # after BH

    def test_status(self):
        due = D(2026, 11, 2)
        self.assertEqual(p.occurrence_status(due, False, D(2026, 11, 1)), 'upcoming')
        self.assertEqual(p.occurrence_status(due, False, D(2026, 11, 4)), 'due')
        self.assertEqual(p.occurrence_status(due, False, D(2026, 11, 10)), 'overdue')
        self.assertEqual(p.occurrence_status(due, True, D(2026, 11, 10)), 'paid')


class LearningTests(SimpleTestCase):
    def test_direct_debit_ignores_weekend_rolled_dates(self):
        # Scheduled 12th: Sat 12 Sep → Mon 14; Mon 12 Oct (ambiguous); Thu 12 Nov.
        dates = [D(2026, 9, 14), D(2026, 10, 12), D(2026, 11, 12)]
        self.assertEqual(p.learn_payment_day(dates, p.DIRECT_DEBIT), 12)

    def test_direct_debit_all_ambiguous_takes_earliest_possible(self):
        self.assertEqual(p.learn_payment_day([D(2026, 9, 14)], p.DIRECT_DEBIT), 12)

    def test_card_uses_most_common_day(self):
        dates = [D(2026, 9, 5), D(2026, 10, 5), D(2026, 11, 6)]
        self.assertEqual(p.learn_payment_day(dates, p.CARD), 5)

    def test_bacs_income_ignores_dates_pulled_back_before_a_weekend(self):
        # Salary on the 25th: Fri 25 Sep; Sun 25 Oct → paid Fri 23 Oct (ambiguous); Wed 25 Nov.
        dates = [D(2026, 9, 25), D(2026, 10, 23), D(2026, 11, 25)]
        self.assertEqual(p.learn_payment_day(dates, p.BACS_CREDIT), 25)

    def test_bacs_income_all_ambiguous_takes_latest_possible(self):
        self.assertEqual(p.learn_payment_day([D(2026, 10, 23)], p.BACS_CREDIT), 25)

    def test_no_dates(self):
        self.assertIsNone(p.learn_payment_day([], p.CARD))


class SchedulingTests(SimpleTestCase):
    def test_fixed_clamps_to_short_month(self):
        self.assertEqual(p.scheduled_dates('fixed', D(2026, 11, 1), payment_day=31), [D(2026, 11, 30)])

    def test_fixed_without_day_is_unscheduled(self):
        self.assertEqual(p.scheduled_dates('fixed', D(2026, 11, 1)), [])

    def test_weekly_lists_every_occurrence(self):
        mondays = p.scheduled_dates('weekly_count', D(2026, 11, 1), weekly_payment_day=1)
        self.assertEqual([d.day for d in mondays], [2, 9, 16, 23, 30])

    def test_per_term_uses_term_dates_in_month(self):
        terms = [(D(2026, 9, 2), D(2026, 10, 23)), (D(2026, 11, 2), D(2026, 12, 18))]
        self.assertEqual(p.scheduled_dates('per_term', D(2026, 11, 1), term_timing='start', term_dates=terms),
                         [D(2026, 11, 2)])
        self.assertEqual(p.scheduled_dates('per_term', D(2026, 10, 1), term_timing='end', term_dates=terms),
                         [D(2026, 10, 23)])

    def test_bacs_income_rolls_back(self):
        self.assertEqual(p.due_date_for(D(2026, 10, 25), p.BACS_CREDIT), D(2026, 10, 23))
        self.assertEqual(p.due_date_for(D(2026, 12, 28), p.BACS_CREDIT), D(2026, 12, 24))

    def test_only_direct_debits_roll(self):
        sat = D(2026, 11, 14)
        self.assertEqual(p.due_date_for(sat, p.DIRECT_DEBIT), D(2026, 11, 16))
        self.assertEqual(p.due_date_for(sat, p.CARD), sat)
        self.assertEqual(p.due_date_for(sat, p.STANDING_ORDER), sat)


class TransactionParsingTests(SimpleTestCase):
    def test_normalise_payee(self):
        self.assertEqual(p.normalise_payee('Sky Digital Ltd, ref 12345'), 'SKY DIGITAL')

    def test_transaction_fields(self):
        f = p.transaction_fields({
            'id': 'tx_1', 'created': '2026-11-12T06:00:00.000Z', 'amount': -4550,
            'merchant': None, 'counterparty': {'name': 'Sky Digital'}, 'scheme': 'bacs',
            'category': 'bills', 'decline_reason': '',
        })
        self.assertEqual(f['amount'], Decimal('-45.50'))
        self.assertEqual(f['payee'], 'Sky Digital')
        self.assertEqual(f['payee_key'], 'SKY DIGITAL')
        self.assertEqual(f['payment_method'], p.DIRECT_DEBIT)
        self.assertFalse(f['declined'])

    def test_incoming_bacs_is_a_credit(self):
        f = p.transaction_fields({'id': 't', 'created': '2026-11-25T01:00:00Z', 'amount': 300000,
                                  'counterparty': {'name': 'Acme Payroll'}, 'scheme': 'bacs'})
        self.assertEqual(f['payment_method'], p.BACS_CREDIT)
        self.assertEqual(f['amount'], Decimal('3000'))

    def test_merchant_name_wins_and_card_scheme(self):
        f = p.transaction_fields({
            'id': 'tx_2', 'created': '2026-11-05T10:00:00Z', 'amount': -1099,
            'merchant': {'name': 'Netflix'}, 'description': 'NETFLIX.COM', 'scheme': 'mastercard',
        })
        self.assertEqual(f['payee'], 'Netflix')
        self.assertEqual(f['payment_method'], p.CARD)


def _tx(id, date, amount, payee, scheme='bacs', declined=False):
    return {
        'id': id, 'date': date, 'amount': Decimal(str(amount)), 'payee': payee,
        'payee_key': p.normalise_payee(payee), 'scheme': scheme,
        'payment_method': p.payment_method_for(scheme), 'declined': declined,
    }


class RecurringAndSuggestionTests(SimpleTestCase):
    def test_find_recurring(self):
        txs = [
            _tx(1, D(2026, 9, 14), -45, 'Sky Digital'),
            _tx(2, D(2026, 10, 12), -45, 'Sky Digital'),
            _tx(3, D(2026, 11, 12), -47.5, 'Sky Digital'),
            _tx(4, D(2026, 10, 3), -20, 'One-off shop', 'mastercard'),
            _tx(5, D(2026, 9, 1), -100, 'pot_123', 'uk_retail_pot'),
            _tx(6, D(2026, 10, 1), -100, 'pot_123', 'uk_retail_pot'),
        ]
        rec = p.find_recurring(txs)
        self.assertEqual([r['payee_key'] for r in rec], ['SKY DIGITAL'])
        self.assertEqual(rec[0]['amount'], Decimal('47.5'))
        self.assertEqual(rec[0]['usual_day'], 12)
        self.assertEqual(rec[0]['first_date'], D(2026, 9, 14))

    def test_same_amount_items_are_ambiguous(self):
        rec = [{'payee_key': 'STREAMCO', 'amount': Decimal('9.99'), 'last_date': D(2026, 11, 1), 'first_date': D(2026, 10, 1)}]
        items = [{'id': 'a', 'name': 'Music', 'amount': 9.99}, {'id': 'b', 'name': 'Cloud', 'amount': 9.99}]
        s = p.suggest_links(rec, items)[0]
        self.assertTrue(s['ambiguous'])
        self.assertIsNone(s['suggested_item_id'])
        self.assertEqual(len(s['candidates']), 2)

    def test_name_breaks_the_tie(self):
        rec = [{'payee_key': 'SPOTIFY', 'amount': Decimal('9.99'), 'last_date': D(2026, 11, 1), 'first_date': D(2026, 10, 1)}]
        items = [{'id': 'a', 'name': 'Spotify', 'amount': 9.99}, {'id': 'b', 'name': 'Cloud', 'amount': 9.99}]
        s = p.suggest_links(rec, items)[0]
        self.assertFalse(s['ambiguous'])
        self.assertEqual(s['suggested_item_id'], 'a')


class IncomeDirectionTests(SimpleTestCase):
    def test_recurring_keeps_money_in_and_out_apart(self):
        txs = [
            _tx(1, D(2026, 9, 25), 3000, 'Acme Payroll'), _tx(2, D(2026, 10, 23), 3000, 'Acme Payroll'),
            _tx(3, D(2026, 9, 12), -45, 'Sky'), _tx(4, D(2026, 10, 12), -45, 'Sky'),
        ]
        rec = {r['payee_key']: r for r in p.find_recurring(txs)}
        self.assertTrue(rec['ACME PAYROLL']['incoming'])
        self.assertEqual(rec['ACME PAYROLL']['amount'], Decimal('3000'))
        self.assertFalse(rec['SKY']['incoming'])

    def test_income_only_suggested_for_income_items(self):
        rec = [{'payee_key': 'ACME PAYROLL', 'incoming': True, 'amount': Decimal('3000'),
                'first_date': D(2026, 9, 25), 'last_date': D(2026, 10, 23)}]
        items = [{'id': 'bill', 'name': 'Rent', 'amount': 3000, 'incoming': False},
                 {'id': 'pay', 'name': 'Salary', 'amount': 3000, 'incoming': True}]
        self.assertEqual(p.suggest_links(rec, items)[0]['suggested_item_id'], 'pay')

    def test_income_matches_money_in_only(self):
        occs = [{'key': 'pay', 'payee_match': 'ACME', 'due_date': D(2026, 11, 25), 'incoming': True}]
        txs = [_tx(1, D(2026, 11, 25), -10, 'Acme shop'), _tx(2, D(2026, 11, 25), 3000, 'Acme Payroll')]
        self.assertEqual(p.match_occurrences(occs, txs), [('pay', 2)])


class MatchingTests(SimpleTestCase):
    def test_closest_in_window_and_never_reused(self):
        occs = [
            {'key': 'a', 'payee_match': 'SKY', 'due_date': D(2026, 11, 12)},
            {'key': 'b', 'payee_match': 'SKY', 'due_date': D(2026, 11, 13)},
        ]
        txs = [_tx(1, D(2026, 11, 12), -45, 'Sky Digital'), _tx(2, D(2026, 11, 30), -45, 'Sky Digital')]
        self.assertEqual(p.match_occurrences(occs, txs), [('a', 1)])

    def test_used_and_declined_are_skipped(self):
        occs = [{'key': 'a', 'payee_match': 'SKY', 'due_date': D(2026, 11, 12)}]
        txs = [_tx(1, D(2026, 11, 12), -45, 'Sky'), _tx(2, D(2026, 11, 11), -45, 'Sky', declined=True)]
        self.assertEqual(p.match_occurrences(occs, txs, used_ids=[1]), [])


# --- Database / endpoint tests ---

TODAY = D(2026, 11, 20)  # a Friday
NOW = datetime.datetime(2026, 11, 20, 12, 0, tzinfo=datetime.timezone.utc)


def _month(y, m):
    import calendar
    start = D(y, m, 1)
    return Month.objects.create(
        month_id=f'{y}-{m:02d}', month_name=start.strftime('%B %Y'),
        start_date=start, end_date=D(y, m, calendar.monthrange(y, m)[1]),
    )


def _store(monzo_id, date, amount, payee, scheme='bacs'):
    created = datetime.datetime.combine(date, datetime.time(9), datetime.timezone.utc)
    return BankTransaction.objects.create(
        monzo_id=monzo_id, account_id='acc_1', created=created, amount=Decimal(str(amount)),
        payee=payee, payee_key=p.normalise_payee(payee), scheme=scheme,
        payment_method=p.payment_method_for(scheme, incoming=amount > 0),
    )


@mock.patch('budget.api._today', return_value=TODAY)
@mock.patch('budget.payment_service.timezone.now', return_value=NOW)
class PaymentsFlowTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.user = User.objects.create_user(username='u', password='pw')
        self.client.login(username='u', password='pw')
        self.oct = _month(2026, 10)
        self.nov = _month(2026, 11)
        self.broadband = self._item('Broadband', 45)
        self.netflix = self._item('Netflix', 10.99)
        # Sky: Direct Debit scheduled the 12th, went up to £47.50 in November.
        _store('s1', D(2026, 9, 14), -45, 'Sky Digital')
        _store('s2', D(2026, 10, 12), -45, 'Sky Digital')
        _store('s3', D(2026, 11, 12), -47.50, 'Sky Digital')
        # Netflix: card, the 5th — nothing yet in November.
        _store('n1', D(2026, 9, 5), -10.99, 'Netflix', 'mastercard')
        _store('n2', D(2026, 10, 5), -10.99, 'Netflix', 'mastercard')

    def _item(self, name, value):
        item = BudgetItem.objects.create(item_name=name, item_type='expense', owner='shared', expense_pot='bills')
        BudgetItemVersion.objects.create(budget_item=item, month=self.oct, effective_from_month=self.oct, value=value)
        return item

    def _link(self, item, payee):
        return self.client.put(f'/api/budgetitems/{item.pk}/payment-link/',
                               {'payee_match': payee}, content_type='application/json')

    def test_link_learns_day_and_matches(self, *_):
        r = self._link(self.broadband, 'sky digital')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['payment_day'], 12)
        self.assertEqual(r.json()['payment_method'], 'direct_debit')
        self.assertEqual(ItemPayment.objects.filter(budget_item=self.broadband).count(), 2)

        cal = self.client.get('/api/payments/calendar/2026-11/').json()
        [entry] = [e for e in cal['entries'] if e['item_name'] == 'Broadband']
        self.assertEqual(entry['due_date'], '2026-11-12')
        self.assertEqual(entry['status'], 'paid')
        self.assertEqual(entry['payment']['amount'], 47.5)
        self.assertIn('Netflix', [u['item_name'] for u in cal['unscheduled']])

    def test_amount_change_notification_and_reconcile(self, *_):
        self._link(self.broadband, 'SKY DIGITAL')
        from .notifications import generate_notifications
        generate_notifications(TODAY)
        n = Notification.objects.get(kind='amount_changed')
        self.assertEqual(n.month, self.nov)
        self.assertEqual(n.data['actual'], 47.5)

        listed = self.client.get('/api/notifications/').json()
        self.assertEqual(listed[0]['actions'][0], 'reconcile')

        r = self.client.post(f'/api/notifications/{n.pk}/action/', {'action': 'reconcile'},
                             content_type='application/json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['status'], 'resolved')
        v = BudgetItemVersion.objects.get(budget_item=self.broadband, month=self.nov)
        self.assertEqual(v.value, Decimal('47.50'))
        self.assertFalse(v.is_one_off)
        # Re-running doesn't raise it again.
        generate_notifications(TODAY)
        self.assertEqual(Notification.objects.filter(kind='amount_changed', status='open').count(), 0)

    def test_one_off_only_for_current_month(self, *_):
        self._link(self.broadband, 'SKY DIGITAL')
        n = Notification.objects.create(kind='amount_changed', budget_item=self.broadband, month=self.oct,
                                        data={'actual': 50})
        r = self.client.post(f'/api/notifications/{n.pk}/action/', {'action': 'one_off'},
                             content_type='application/json')
        self.assertEqual(r.status_code, 400)

    def test_reconcile_from_past_month_applies_from_this_month(self, *_):
        n = Notification.objects.create(kind='amount_changed', budget_item=self.broadband, month=self.oct,
                                        data={'actual': 50})
        self.client.post(f'/api/notifications/{n.pk}/action/', {'action': 'reconcile'},
                         content_type='application/json')
        self.assertFalse(BudgetItemVersion.objects.filter(budget_item=self.broadband, month=self.oct, value=50).exists())
        self.assertTrue(BudgetItemVersion.objects.filter(budget_item=self.broadband, month=self.nov, value=50).exists())

    def test_missed_payment_and_mark_paid(self, *_):
        self._link(self.netflix, 'Netflix')
        from .notifications import generate_notifications
        generate_notifications(TODAY)
        n = Notification.objects.get(kind='missed')
        self.assertEqual(n.budget_item, self.netflix)
        self.assertEqual(n.data['due_date'], '2026-11-05')
        r = self.client.post(f'/api/notifications/{n.pk}/action/', {'action': 'mark_paid'},
                             content_type='application/json')
        self.assertEqual(r.json()['status'], 'resolved')
        payment = ItemPayment.objects.get(budget_item=self.netflix, due_date=D(2026, 11, 5))
        self.assertEqual(payment.source, 'manual')
        # Manual ticks can be undone; automatic matches can't.
        self.assertEqual(self.client.delete(f'/api/payments/mark/{payment.pk}/').status_code, 204)

    def test_auto_match_cannot_be_unmarked(self, *_):
        self._link(self.broadband, 'SKY DIGITAL')
        auto = ItemPayment.objects.filter(budget_item=self.broadband).first()
        self.assertEqual(self.client.delete(f'/api/payments/mark/{auto.pk}/').status_code, 400)

    def test_new_payee_only_for_recent_first_payment(self, *_):
        _store('sp1', D(2026, 10, 15), -9.99, 'Spotify', 'mastercard')
        _store('sp2', D(2026, 11, 15), -9.99, 'Spotify', 'mastercard')
        from .notifications import generate_notifications
        generate_notifications(TODAY)
        keys = set(Notification.objects.filter(kind='new_payee').values_list('payee_key', flat=True))
        # Sky and Netflix have paid since September — suggestions, not alerts.
        self.assertEqual(keys, {'SPOTIFY'})
        suggestions = {s['payee_key'] for s in self.client.get('/api/payments/suggestions/').json()}
        self.assertEqual(suggestions, {'SKY DIGITAL', 'NETFLIX', 'SPOTIFY'})

    def test_dismiss_new_payee_ignores_it(self, *_):
        n = Notification.objects.create(kind='new_payee', payee_key='SKY DIGITAL', data={})
        self.client.post(f'/api/notifications/{n.pk}/action/', {'action': 'dismiss'},
                         content_type='application/json')
        self.assertTrue(IgnoredPayee.objects.filter(payee_key='SKY DIGITAL').exists())
        suggestions = {s['payee_key'] for s in self.client.get('/api/payments/suggestions/').json()}
        self.assertNotIn('SKY DIGITAL', suggestions)

    def test_link_action_on_new_payee(self, *_):
        n = Notification.objects.create(kind='new_payee', payee_key='SKY DIGITAL', data={})
        r = self.client.post(f'/api/notifications/{n.pk}/action/',
                             {'action': 'link', 'budget_item_id': str(self.broadband.pk)},
                             content_type='application/json')
        self.assertEqual(r.json()['status'], 'resolved')
        self.broadband.refresh_from_db()
        self.assertEqual(self.broadband.payee_match, 'SKY DIGITAL')

    def test_weekly_item_appears_every_week(self, *_):
        cleaner = BudgetItem.objects.create(item_name='Cleaner', item_type='expense', owner='shared',
                                            expense_pot='bills', calculation_type='weekly_count',
                                            weekly_payment_day=1, payee_match='CLEANCO')
        BudgetItemVersion.objects.create(budget_item=cleaner, month=self.oct, effective_from_month=self.oct, value=30)
        _store('c1', D(2026, 11, 2), -30, 'CleanCo', 'payport_faster_payments')
        _store('c2', D(2026, 11, 9), -30, 'CleanCo', 'payport_faster_payments')
        from .payment_service import rematch
        rematch([self.nov])
        cal = self.client.get('/api/payments/calendar/2026-11/').json()
        mine = [e for e in cal['entries'] if e['item_name'] == 'Cleaner']
        self.assertEqual([e['due_date'][-2:] for e in mine], ['02', '09', '16', '23', '30'])
        self.assertTrue(all(e['expected_amount'] == 30 for e in mine))
        # Each week is ticked against its own payment.
        self.assertEqual([e['status'] for e in mine], ['paid', 'paid', 'overdue', 'upcoming', 'upcoming'])

    def test_search_payees_by_other_name(self, *_):
        # "Broadband" never appears in the payee — search by what Monzo calls it.
        r = self.client.get('/api/payments/payees/search/', {'q': 'sky'}).json()
        self.assertEqual([p['payee_key'] for p in r], ['SKY DIGITAL'])
        self.assertEqual(r[0]['count'], 3)
        self.assertEqual(r[0]['last_amount'], 47.5)
        self.assertEqual(r[0]['amounts'], [47.5, 45.0])
        self.assertEqual(r[0]['usual_day'], 12)
        self.assertIsNone(r[0]['linked_item'])
        # Raw text with punctuation also matches.
        self.assertEqual(len(self.client.get('/api/payments/payees/search/', {'q': 'Sky Dig'}).json()), 1)
        self.assertEqual(self.client.get('/api/payments/payees/search/', {'q': 'zzz'}).json(), [])

    def test_search_payees_by_amount_and_shows_links(self, *_):
        self._link(self.netflix, 'NETFLIX')
        r = self.client.get('/api/payments/payees/search/', {'amount': 10.99}).json()
        self.assertEqual([p['payee_key'] for p in r], ['NETFLIX'])
        self.assertEqual(r[0]['linked_item'], 'Netflix')
        self.assertEqual(self.client.get('/api/payments/payees/search/').json(), [])

    def test_income_item_links_and_ticks_off(self, *_):
        salary = BudgetItem.objects.create(item_name='Salary', item_type='income', owner='keith')
        BudgetItemVersion.objects.create(budget_item=salary, month=self.oct, effective_from_month=self.oct, value=3000)
        _store('p1', D(2026, 9, 25), 3000, 'Acme Payroll')
        _store('p2', D(2026, 10, 23), 3000, 'Acme Payroll')
        _store('p3', D(2026, 8, 25), 3000, 'Acme Payroll')
        # Search finds it among money in, not among payments out.
        self.assertEqual(self.client.get('/api/payments/payees/search/', {'q': 'acme'}).json(), [])
        found = self.client.get('/api/payments/payees/search/', {'q': 'acme', 'incoming': 'true'}).json()
        self.assertEqual(found[0]['payee_key'], 'ACME PAYROLL')
        r = self._link(salary, found[0]['payee_key']).json()
        self.assertEqual((r['payment_day'], r['payment_method']), (25, 'bacs_credit'))
        cal = self.client.get('/api/payments/calendar/2026-10/').json()
        [entry] = [e for e in cal['entries'] if e['item_name'] == 'Salary']
        self.assertEqual(entry['due_date'], '2026-10-23')  # Sun 25th → Fri 23rd
        self.assertEqual(entry['payment']['amount'], 3000)
        self.assertEqual(entry['item_type'], 'income')

    def test_manual_day_without_payee(self, *_):
        r = self.client.put(f'/api/budgetitems/{self.netflix.pk}/payment-link/',
                            {'payment_day': 3, 'payment_day_manual': True}, content_type='application/json')
        self.assertEqual(r.status_code, 200)
        cal = self.client.get('/api/payments/calendar/2026-11/').json()
        [entry] = [e for e in cal['entries'] if e['item_name'] == 'Netflix']
        self.assertEqual(entry['due_date'], '2026-11-03')
        self.assertEqual(entry['status'], 'overdue')


@mock.patch('budget.payment_service.timezone.now', return_value=NOW)
class SyncTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.user = User.objects.create_user(username='u', password='pw')
        self.client.login(username='u', password='pw')
        _month(2026, 10)
        _month(2026, 11)
        self.calls = []

    def _fake_get(self, pages):
        def fake_get(url, params=None, headers=None, timeout=None):
            if url.endswith('/accounts'):
                return _fake_response(200, {'accounts': [{'id': 'acc_1', 'type': 'uk_retail_joint', 'closed': False}]})
            if url.endswith('/transactions'):
                self.calls.append(dict(params))
                return _fake_response(200, {'transactions': pages.pop(0) if pages else []})
            raise AssertionError(url)
        return fake_get

    @staticmethod
    def _raw(i, day):
        return {'id': f'tx_{i}', 'created': f'2026-11-{day:02d}T09:00:00Z', 'amount': -1000,
                'counterparty': {'name': f'Payee {i}'}, 'scheme': 'bacs'}

    def test_pages_and_clamps_to_89_days(self, *_):
        MonzoConnection.objects.create(user=self.user, access_token='tok')
        pages = [[self._raw(1, 1), self._raw(2, 2)], [self._raw(3, 3)]]
        with mock.patch.dict(os.environ, MONZO_ENV), \
                mock.patch('budget.monzo.TRANSACTION_PAGE_SIZE', 2), \
                mock.patch('budget.monzo.requests.get', side_effect=self._fake_get(pages)):
            r = self.client.post('/api/payments/sync/').json()
        self.assertEqual(r['fetched'], 3)
        self.assertEqual(BankTransaction.objects.count(), 3)
        self.assertEqual(self.calls[0]['since'], (NOW - datetime.timedelta(days=89)).isoformat().replace('+00:00', 'Z'))
        self.assertEqual(self.calls[1]['since'], 'tx_2')  # cursor paging
        self.assertEqual(BankTransaction.objects.get(monzo_id='tx_1').account_type, 'uk_retail_joint')

    def test_backfills_a_year_just_after_connecting(self, *_):
        conn = MonzoConnection.objects.create(user=self.user, access_token='tok',
                                              authorised_at=NOW - datetime.timedelta(minutes=2))
        with mock.patch.dict(os.environ, MONZO_ENV), \
                mock.patch('budget.monzo.requests.get', side_effect=self._fake_get([[]])):
            self.client.post('/api/payments/sync/')
        self.assertEqual(self.calls[0]['since'], (NOW - datetime.timedelta(days=365)).isoformat().replace('+00:00', 'Z'))
        conn.refresh_from_db()
        self.assertIsNotNone(conn.history_backfilled_at)
        self.assertIsNotNone(conn.transactions_synced_at)

    def test_one_failing_connection_does_not_stop_the_other(self, *_):
        other = User.objects.create_user(username='k', password='pw', first_name='Keith')
        MonzoConnection.objects.create(user=self.user, access_token='good')
        MonzoConnection.objects.create(user=other, access_token='bad')

        def fake_get(url, params=None, headers=None, timeout=None):
            if headers['Authorization'] == 'Bearer bad':
                return _fake_response(403)
            return self._fake_get([[self._raw(1, 1)]])(url, params, headers, timeout)

        with mock.patch.dict(os.environ, MONZO_ENV), mock.patch('budget.monzo.requests.get', side_effect=fake_get):
            r = self.client.post('/api/payments/sync/').json()
        self.assertEqual(r['fetched'], 1)
        self.assertEqual(len(r['errors']), 1)
        self.assertTrue(r['errors'][0].startswith('Keith:'))

    def test_sync_without_connection(self, *_):
        self.assertEqual(self.client.post('/api/payments/sync/').status_code, 400)


class PotBalanceTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.user = User.objects.create_user(username='u', password='pw')
        self.client.login(username='u', password='pw')
        MonzoConnection.objects.create(user=self.user, access_token='tok')

    def _fake_get(self, url, params=None, headers=None, timeout=None):
        if url.endswith('/accounts'):
            return _fake_response(200, {'accounts': [{'id': 'acc_joint', 'closed': False}]})
        if url.endswith('/pots'):
            return _fake_response(200, {'pots': [
                {'id': 'pot_bills', 'name': 'Bills', 'balance': 123456, 'deleted': False},
                {'id': 'pot_food', 'name': 'Food', 'balance': 5000, 'deleted': False},
            ]})
        raise AssertionError(url)

    def test_link_bills_pot_and_read_balance(self):
        with mock.patch.dict(os.environ, MONZO_ENV), mock.patch('budget.monzo.requests.get', side_effect=self._fake_get):
            self.assertEqual(self.client.get('/api/payments/pots/').json(), {'pots': {}, 'errors': []})
            available = self.client.get('/api/payments/pots/available/').json()
            self.assertEqual([p['name'] for p in available], ['Bills', 'Food'])
            r = self.client.put('/api/payments/pots/bills/', {'pot_id': 'pot_bills'}, content_type='application/json')
            self.assertEqual(r.json()['pot_ids'], {'bills': 'pot_bills'})
            pots = self.client.get('/api/payments/pots/').json()['pots']
        self.assertEqual(pots['bills'], {'pot_id': 'pot_bills', 'name': 'Bills', 'balance': 1234.56})

    def test_unknown_pot_key_and_unlink(self):
        bad = self.client.put('/api/payments/pots/holiday/', {'pot_id': 'x'}, content_type='application/json')
        self.assertEqual(bad.status_code, 400)
        self.client.put('/api/payments/pots/bills/', {'pot_id': 'pot_bills'}, content_type='application/json')
        r = self.client.put('/api/payments/pots/bills/', {'pot_id': ''}, content_type='application/json')
        self.assertEqual(r.json()['pot_ids'], {})
