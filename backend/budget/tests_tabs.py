from django.test import TestCase, Client
from django.contrib.auth.models import User
from .models import TabItem, TabRepayment
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
