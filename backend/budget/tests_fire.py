from django.test import TestCase, Client
from django.contrib.auth.models import User
from .models import (
    Month, BudgetItem, BudgetItemVersion,
    FireAccount, BalanceSnapshot, EarningsVersion, Mortgage, Property, FireSettings,
)
import datetime
import json


class FireAPITestCase(TestCase):
    def setUp(self):
        self.client = Client()
        self.user = User.objects.create_user(username='testuser', password='password')
        self.client.login(username='testuser', password='password')

    def _post(self, url, data):
        return self.client.post(url, json.dumps(data), content_type='application/json')

    def _put(self, url, data):
        return self.client.put(url, json.dumps(data), content_type='application/json')

    # --- Accounts & snapshots ---

    def test_create_and_list_account(self):
        resp = self._post('/api/fire/accounts/', {
            'name': 'Royal London pension', 'owner': 'tild', 'kind': 'pension', 'provider': 'Royal London',
        })
        self.assertEqual(resp.status_code, 200)
        resp = self.client.get('/api/fire/accounts/')
        data = resp.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]['name'], 'Royal London pension')
        self.assertEqual(data[0]['snapshots'], [])

    def test_set_balance_same_date_corrects_in_place(self):
        account = FireAccount.objects.create(name='ISA', owner='tild', kind='isa')
        url = f'/api/fire/accounts/{account.id}/balance/'
        self._put(url, {'date': '2026-08-01', 'balance': 10000})
        resp = self._put(url, {'date': '2026-08-01', 'balance': 10500})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(account.snapshots.count(), 1)
        self.assertEqual(float(account.snapshots.first().balance), 10500)

    def test_snapshots_returned_newest_first(self):
        account = FireAccount.objects.create(name='ISA', owner='tild', kind='isa')
        BalanceSnapshot.objects.create(account=account, date=datetime.date(2026, 6, 1), balance=100)
        BalanceSnapshot.objects.create(account=account, date=datetime.date(2026, 8, 1), balance=300)
        BalanceSnapshot.objects.create(account=account, date=datetime.date(2026, 7, 1), balance=200)
        data = self.client.get('/api/fire/accounts/').json()
        dates = [s['date'] for s in data[0]['snapshots']]
        self.assertEqual(dates, ['2026-08-01', '2026-07-01', '2026-06-01'])

    def test_delete_account_cascades_snapshots(self):
        account = FireAccount.objects.create(name='ISA', owner='tild', kind='isa')
        BalanceSnapshot.objects.create(account=account, date=datetime.date(2026, 8, 1), balance=100)
        resp = self.client.delete(f'/api/fire/accounts/{account.id}/')
        self.assertEqual(resp.status_code, 204)
        self.assertEqual(BalanceSnapshot.objects.count(), 0)

    # --- Earnings versions ---

    def test_create_earnings_version(self):
        resp = self._post('/api/fire/earnings/', {
            'owner': 'tild', 'effective_from': '2026-04-01',
            'gross_annual_salary': 60000, 'employee_pension_pct': 5,
            'employer_pension_pct': 3,
        })
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data['employee_pension_is_salary_sacrifice'])
        self.assertEqual(data['effective_from'], '2026-04-01')

    def test_duplicate_earnings_version_rejected(self):
        EarningsVersion.objects.create(owner='tild', effective_from=datetime.date(2026, 4, 1), gross_annual_salary=60000)
        resp = self._post('/api/fire/earnings/', {
            'owner': 'tild', 'effective_from': '2026-04-01', 'gross_annual_salary': 65000,
        })
        self.assertEqual(resp.status_code, 409)

    def test_earnings_listed_newest_first(self):
        EarningsVersion.objects.create(owner='tild', effective_from=datetime.date(2025, 4, 1), gross_annual_salary=55000)
        EarningsVersion.objects.create(owner='tild', effective_from=datetime.date(2026, 4, 1), gross_annual_salary=60000)
        data = self.client.get('/api/fire/earnings/').json()
        self.assertEqual([e['effective_from'] for e in data], ['2026-04-01', '2025-04-01'])

    # --- Property & mortgages ---

    def test_property_with_two_loans(self):
        resp = self._post('/api/fire/properties/', {
            'name': 'Home', 'value': 400000, 'value_date': '2026-01-01',
        })
        self.assertEqual(resp.status_code, 200)
        property_id = resp.json()['id']

        for name, balance in [('Part 1', 200000), ('Further advance', 50000)]:
            resp = self._post('/api/fire/mortgages/', {
                'property_id': property_id, 'name': name,
                'balance': balance, 'balance_date': '2026-08-01',
                'interest_rate_pct': 4.5, 'monthly_payment': 1000,
            })
            self.assertEqual(resp.status_code, 200)

        data = self.client.get('/api/fire/properties/').json()
        self.assertEqual(len(data), 1)
        self.assertEqual([m['name'] for m in data[0]['mortgages']], ['Part 1', 'Further advance'])

    def test_edit_and_delete_single_loan(self):
        prop = Property.objects.create(name='Home', value=400000, value_date=datetime.date(2026, 1, 1))
        loan = Mortgage.objects.create(property=prop, name='Part 1', balance=250000,
                                       balance_date=datetime.date(2026, 8, 1),
                                       interest_rate_pct=4.5, monthly_payment=1500)
        resp = self._put(f'/api/fire/mortgages/{loan.id}/', {
            'property_id': str(prop.id), 'name': 'Part 1', 'balance': 248000,
            'balance_date': '2026-08-28', 'interest_rate_pct': 4.5, 'monthly_payment': 1500,
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['balance'], 248000)
        resp = self.client.delete(f'/api/fire/mortgages/{loan.id}/')
        self.assertEqual(resp.status_code, 204)
        self.assertEqual(Mortgage.objects.count(), 0)
        self.assertEqual(Property.objects.count(), 1)  # loan deletion keeps the property

    def test_delete_property_cascades_loans(self):
        prop = Property.objects.create(name='Home', value=400000, value_date=datetime.date(2026, 1, 1))
        Mortgage.objects.create(property=prop, name='Part 1', balance=250000,
                                balance_date=datetime.date(2026, 8, 1),
                                interest_rate_pct=4.5, monthly_payment=1500)
        resp = self.client.delete(f'/api/fire/properties/{prop.id}/')
        self.assertEqual(resp.status_code, 204)
        self.assertEqual(Mortgage.objects.count(), 0)

    # --- Settings ---

    def test_settings_created_with_defaults_for_both_owners(self):
        data = self.client.get('/api/fire/settings/').json()
        self.assertEqual({s['owner'] for s in data}, {'keith', 'tild'})
        for s in data:
            self.assertEqual(s['expected_real_return_pct'], 3.5)
            self.assertEqual(s['safe_withdrawal_rate_pct'], 4.0)

    def test_update_settings(self):
        resp = self._put('/api/fire/settings/tild/', {
            'date_of_birth': '1990-05-01', 'expected_real_return_pct': 4.0,
            'safe_withdrawal_rate_pct': 3.5, 'target_retirement_age': 55,
            'pension_access_age': 58, 'include_state_pension': False,
            'expected_annual_savings': 6000,
        })
        self.assertEqual(resp.status_code, 200)
        obj = FireSettings.objects.get(owner='tild')
        self.assertEqual(obj.date_of_birth, datetime.date(1990, 5, 1))
        self.assertEqual(obj.target_retirement_age, 55)
        self.assertEqual(obj.pension_access_age, 58)
        self.assertFalse(obj.include_state_pension)
        self.assertEqual(float(obj.expected_annual_savings), 6000)

    def test_expected_annual_savings_clears_to_null(self):
        FireSettings.objects.create(owner='tild', expected_annual_savings=6000)
        resp = self._put('/api/fire/settings/tild/', {
            'expected_real_return_pct': 3.5, 'safe_withdrawal_rate_pct': 4.0,
            'pension_access_age': 57, 'include_state_pension': True,
        })
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(FireSettings.objects.get(owner='tild').expected_annual_savings)

    def test_settings_defaults_include_phase2_fields(self):
        data = self.client.get('/api/fire/settings/').json()
        for s in data:
            self.assertEqual(s['pension_access_age'], 57)
            self.assertTrue(s['include_state_pension'])

    def test_update_settings_unknown_owner(self):
        resp = self._put('/api/fire/settings/nobody/', {
            'expected_real_return_pct': 4.0, 'safe_withdrawal_rate_pct': 4.0,
        })
        self.assertEqual(resp.status_code, 400)

    # --- Monthly items history ---

    def _make_month(self, year, month_num):
        import calendar as cal
        start = datetime.date(year, month_num, 1)
        end = datetime.date(year, month_num, cal.monthrange(year, month_num)[1])
        return Month.objects.create(
            month_id=f'{year}-{month_num:02d}',
            month_name=start.strftime('%B %Y'),
            start_date=start, end_date=end,
        )

    def test_monthly_items_returns_started_months_oldest_first(self):
        today = datetime.date.today()
        m_current = self._make_month(today.year, today.month)
        prev = (today.replace(day=1) - datetime.timedelta(days=1))
        m_prev = self._make_month(prev.year, prev.month)
        # A future month must not appear
        nxt = (today.replace(day=28) + datetime.timedelta(days=8)).replace(day=1)
        self._make_month(nxt.year, nxt.month)

        item = BudgetItem.objects.create(item_name='Rent', item_type='expense', owner='shared')
        BudgetItemVersion.objects.create(budget_item=item, month=m_prev, effective_from_month=m_prev, value=1200)

        data = self.client.get('/api/fire/monthly-items/?count=12').json()
        self.assertEqual([m['month_id'] for m in data], [m_prev.month_id, m_current.month_id])
        # Value rolls forward from the previous month into the current one
        self.assertEqual(data[1]['items'][0]['effective_value'], 1200)

    def test_monthly_items_requires_auth(self):
        self.client.logout()
        resp = self.client.get('/api/fire/monthly-items/')
        self.assertEqual(resp.status_code, 401)
