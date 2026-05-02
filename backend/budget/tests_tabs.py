from django.test import TestCase, Client
from django.contrib.auth.models import User
from .models import TabItem, TabRepayment, Month, BudgetItem, BudgetItemVersion
import datetime
import json


class TabsAPITestCase(TestCase):
    def setUp(self):
        self.client = Client()
        self.user = User.objects.create_user(username='testuser', password='password')
        self.client.login(username='testuser', password='password')

    def _post(self, url, data):
        return self.client.post(url, json.dumps(data), content_type='application/json')

    # --- GET /api/tabs/ ---

    def test_get_tabs_empty(self):
        resp = self.client.get('/api/tabs/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['items'], [])
        self.assertEqual(data['repayments'], [])
        self.assertEqual(data['net_balance'], 0)
        self.assertEqual(data['net_description'], 'All settled up!')

    def test_get_tabs_single_item_tild_paid(self):
        TabItem.objects.create(description='Dinner', paid_by='tild', total_cost=100, amount_owed=50, date_added=datetime.date(2025, 6, 1))
        resp = self.client.get('/api/tabs/')
        data = resp.json()
        self.assertEqual(len(data['items']), 1)
        self.assertEqual(data['total_owed_to_tild'], 50)
        self.assertEqual(data['total_owed_to_keith'], 0)
        self.assertGreater(data['net_balance'], 0)
        self.assertIn('Keith owes Tild', data['net_description'])

    def test_get_tabs_single_item_keith_paid(self):
        TabItem.objects.create(description='TV', paid_by='keith', total_cost=700, amount_owed=350, date_added=datetime.date(2025, 6, 1))
        resp = self.client.get('/api/tabs/')
        data = resp.json()
        self.assertEqual(data['total_owed_to_keith'], 350)
        self.assertLess(data['net_balance'], 0)
        self.assertIn('Tild owes Keith', data['net_description'])

    def test_net_balance_with_repayment(self):
        TabItem.objects.create(description='Holiday', paid_by='tild', total_cost=1000, amount_owed=500, date_added=datetime.date(2025, 6, 1))
        TabRepayment.objects.create(amount=200, paid_by='keith', date=datetime.date(2025, 7, 1))
        resp = self.client.get('/api/tabs/')
        data = resp.json()
        self.assertAlmostEqual(data['net_balance'], 300, places=2)

    def test_items_cancel_out(self):
        TabItem.objects.create(description='A', paid_by='tild', total_cost=400, amount_owed=200, date_added=datetime.date(2025, 6, 1))
        TabItem.objects.create(description='B', paid_by='keith', total_cost=400, amount_owed=200, date_added=datetime.date(2025, 6, 1))
        resp = self.client.get('/api/tabs/')
        data = resp.json()
        self.assertAlmostEqual(data['net_balance'], 0, places=2)
        self.assertEqual(data['net_description'], 'All settled up!')

    def test_fully_repaid(self):
        TabItem.objects.create(description='Dinner', paid_by='tild', total_cost=100, amount_owed=50, date_added=datetime.date(2025, 6, 1))
        TabRepayment.objects.create(amount=50, paid_by='keith', date=datetime.date(2025, 7, 1))
        resp = self.client.get('/api/tabs/')
        data = resp.json()
        self.assertAlmostEqual(data['net_balance'], 0, places=2)

    # --- POST /api/tabs/items/ ---

    def test_create_tab_item(self):
        resp = self._post('/api/tabs/items/', {
            'description': 'Fridge', 'paid_by': 'tild', 'total_cost': 500, 'amount_owed': 250, 'date_added': '2025-06-15'
        })
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['description'], 'Fridge')
        self.assertEqual(data['paid_by'], 'tild')
        self.assertEqual(data['total_cost'], 500)
        self.assertEqual(data['amount_owed'], 250)
        self.assertEqual(TabItem.objects.count(), 1)

    # --- DELETE /api/tabs/items/{id}/ ---

    def test_delete_tab_item(self):
        item = TabItem.objects.create(description='X', paid_by='keith', total_cost=100, amount_owed=50, date_added=datetime.date(2025, 1, 1))
        resp = self.client.delete(f'/api/tabs/items/{item.id}/')
        self.assertEqual(resp.status_code, 204)
        self.assertEqual(TabItem.objects.count(), 0)

    # --- POST /api/tabs/repayments/ ---

    def test_create_repayment(self):
        resp = self._post('/api/tabs/repayments/', {
            'amount': 100, 'paid_by': 'keith', 'date': '2025-08-01', 'note': 'Bank transfer'
        })
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['amount'], 100)
        self.assertEqual(data['paid_by'], 'keith')
        self.assertEqual(data['note'], 'Bank transfer')
        self.assertEqual(TabRepayment.objects.count(), 1)

    def test_create_repayment_no_note(self):
        resp = self._post('/api/tabs/repayments/', {
            'amount': 50, 'paid_by': 'tild', 'date': '2025-09-01'
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['note'], '')

    # --- DELETE /api/tabs/repayments/{id}/ ---

    def test_delete_repayment(self):
        r = TabRepayment.objects.create(amount=75, paid_by='keith', date=datetime.date(2025, 7, 1))
        resp = self.client.delete(f'/api/tabs/repayments/{r.id}/')
        self.assertEqual(resp.status_code, 204)
        self.assertEqual(TabRepayment.objects.count(), 0)

    # --- Auth required ---

    def test_unauthenticated_get_tabs(self):
        self.client.logout()
        resp = self.client.get('/api/tabs/')
        self.assertEqual(resp.status_code, 401)

    def test_unauthenticated_create_item(self):
        self.client.logout()
        resp = self._post('/api/tabs/items/', {
            'description': 'X', 'paid_by': 'tild', 'total_cost': 100, 'amount_owed': 50, 'date_added': '2025-01-01'
        })
        self.assertEqual(resp.status_code, 401)


class AutoRepaymentTestCase(TestCase):
    """Tests for budget items flagged as is_tab_repayment appearing as auto-repayments."""

    def setUp(self):
        self.client = Client()
        self.user = User.objects.create_user(username='testuser', password='password')
        self.client.login(username='testuser', password='password')
        self.jan = Month.objects.create(
            month_id='2026-01', month_name='January 2026',
            start_date=datetime.date(2026, 1, 1), end_date=datetime.date(2026, 1, 31)
        )
        self.feb = Month.objects.create(
            month_id='2026-02', month_name='February 2026',
            start_date=datetime.date(2026, 2, 1), end_date=datetime.date(2026, 2, 28)
        )

    def test_auto_repayment_appears_in_tabs(self):
        bi = BudgetItem.objects.create(
            item_name='Tild Repayment', item_type='expense', owner='tild', is_tab_repayment=True
        )
        BudgetItemVersion.objects.create(
            budget_item=bi, month=self.jan, effective_from_month=self.jan, value=100, is_one_off=False
        )
        resp = self.client.get('/api/tabs/')
        data = resp.json()
        auto = [r for r in data['repayments'] if r['is_auto']]
        self.assertEqual(len(auto), 2)  # Jan + Feb (rolls over)
        self.assertEqual(auto[0]['amount'], 100)
        self.assertEqual(auto[0]['paid_by'], 'tild')
        self.assertIn('Tild Repayment', auto[0]['note'])

    def test_auto_repayment_affects_net_balance(self):
        # Tild paid for dinner, Keith owes 200
        TabItem.objects.create(description='Dinner', paid_by='tild', total_cost=400, amount_owed=200, date_added=datetime.date(2026, 1, 1))
        # Keith has an auto-repayment of 100 per month (2 months = 200)
        bi = BudgetItem.objects.create(
            item_name='Keith Repayment', item_type='expense', owner='keith', is_tab_repayment=True
        )
        BudgetItemVersion.objects.create(
            budget_item=bi, month=self.jan, effective_from_month=self.jan, value=100, is_one_off=False
        )
        resp = self.client.get('/api/tabs/')
        data = resp.json()
        # Keith repaid 200 total via auto, owes 200 → net = 0
        self.assertAlmostEqual(data['net_balance'], 0, places=2)
        self.assertEqual(data['net_description'], 'All settled up!')

    def test_auto_repayment_not_deletable(self):
        """Auto-repayment IDs start with 'auto-' and should not match any TabRepayment UUID."""
        bi = BudgetItem.objects.create(
            item_name='Repayment', item_type='expense', owner='keith', is_tab_repayment=True
        )
        BudgetItemVersion.objects.create(
            budget_item=bi, month=self.jan, effective_from_month=self.jan, value=50, is_one_off=False
        )
        resp = self.client.get('/api/tabs/')
        auto_id = resp.json()['repayments'][0]['id']
        self.assertTrue(auto_id.startswith('auto-'))
        # Trying to delete it should 404 (not a real TabRepayment)
        resp = self.client.delete(f'/api/tabs/repayments/{auto_id}/')
        self.assertIn(resp.status_code, [404, 422])

    def test_non_tab_repayment_items_excluded(self):
        bi = BudgetItem.objects.create(
            item_name='Rent', item_type='expense', owner='shared', is_tab_repayment=False
        )
        BudgetItemVersion.objects.create(
            budget_item=bi, month=self.jan, effective_from_month=self.jan, value=800, is_one_off=False
        )
        resp = self.client.get('/api/tabs/')
        auto = [r for r in resp.json()['repayments'] if r['is_auto']]
        self.assertEqual(len(auto), 0)

    def test_auto_repayment_does_not_populate_future_months(self):
        # Create a month far in the future. The auto-repayment shouldn't appear
        # for it since the month hasn't started yet.
        future = Month.objects.create(
            month_id='2099-01', month_name='January 2099',
            start_date=datetime.date(2099, 1, 1), end_date=datetime.date(2099, 1, 31)
        )
        bi = BudgetItem.objects.create(
            item_name='Tild Repayment', item_type='expense', owner='tild', is_tab_repayment=True
        )
        BudgetItemVersion.objects.create(
            budget_item=bi, month=self.jan, effective_from_month=self.jan, value=100, is_one_off=False
        )
        resp = self.client.get('/api/tabs/')
        auto = [r for r in resp.json()['repayments'] if r['is_auto']]
        # Notes should reference Jan and Feb but never the future month.
        notes = [r['note'] for r in auto]
        self.assertFalse(any('January 2099' in n for n in notes))
        # Sanity check the future Month object is in the DB but not surfaced.
        self.assertEqual(Month.objects.filter(month_id=future.month_id).count(), 1)

    def test_auto_repayment_respects_last_payment_month(self):
        bi = BudgetItem.objects.create(
            item_name='One-time Repayment', item_type='expense', owner='keith',
            is_tab_repayment=True, last_payment_month=self.jan
        )
        BudgetItemVersion.objects.create(
            budget_item=bi, month=self.jan, effective_from_month=self.jan, value=150, is_one_off=False
        )
        resp = self.client.get('/api/tabs/')
        auto = [r for r in resp.json()['repayments'] if r['is_auto']]
        # Only January, not February (last_payment_month = Jan)
        self.assertEqual(len(auto), 1)
        self.assertIn('January 2026', auto[0]['note'])

    def test_auto_repayment_sorted_by_date_descending(self):
        bi = BudgetItem.objects.create(
            item_name='Monthly', item_type='expense', owner='tild', is_tab_repayment=True
        )
        BudgetItemVersion.objects.create(
            budget_item=bi, month=self.jan, effective_from_month=self.jan, value=50, is_one_off=False
        )
        resp = self.client.get('/api/tabs/')
        auto = [r for r in resp.json()['repayments'] if r['is_auto']]
        self.assertEqual(len(auto), 2)
        # Feb before Jan (descending)
        self.assertIn('February', auto[0]['note'])
        self.assertIn('January', auto[1]['note'])
