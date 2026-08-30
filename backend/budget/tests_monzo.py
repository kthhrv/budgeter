from unittest import mock

from django.test import TestCase, Client
from django.contrib.auth.models import User
from .models import FireAccount, BalanceSnapshot, MonzoConnection
import datetime
import os


def _fake_response(status_code=200, payload=None):
    response = mock.Mock()
    response.status_code = status_code
    response.json.return_value = payload or {}
    return response


MONZO_ENV = {"MONZO_CLIENT_ID": "client-id", "MONZO_CLIENT_SECRET": "client-secret"}


class MonzoAPITestCase(TestCase):
    def setUp(self):
        self.client = Client()
        self.user = User.objects.create_user(username='testuser', password='password')
        self.client.login(username='testuser', password='password')

    def _connect(self):
        return MonzoConnection.objects.create(
            user=self.user, access_token='tok', refresh_token='refresh-tok',
        )

    # --- status ---

    def test_status_unconfigured_and_disconnected(self):
        with mock.patch.dict(os.environ, {"MONZO_CLIENT_ID": "", "MONZO_CLIENT_SECRET": ""}):
            data = self.client.get('/api/fire/monzo/status/').json()
        self.assertFalse(data['configured'])
        self.assertFalse(data['connected'])

    def test_status_connected(self):
        self._connect()
        with mock.patch.dict(os.environ, MONZO_ENV):
            data = self.client.get('/api/fire/monzo/status/').json()
        self.assertTrue(data['configured'])
        self.assertTrue(data['connected'])

    # --- OAuth flow ---

    def test_connect_requires_configuration(self):
        with mock.patch.dict(os.environ, {"MONZO_CLIENT_ID": "", "MONZO_CLIENT_SECRET": ""}):
            resp = self.client.get('/api/fire/monzo/connect/')
        self.assertEqual(resp.status_code, 400)

    def test_connect_redirects_to_monzo_with_state(self):
        with mock.patch.dict(os.environ, MONZO_ENV):
            resp = self.client.get('/api/fire/monzo/connect/')
        self.assertEqual(resp.status_code, 302)
        self.assertTrue(resp['Location'].startswith('https://auth.monzo.com/?'))
        state = self.client.session['monzo_oauth_state']
        self.assertIn(f'state={state}', resp['Location'])
        self.assertIn('redirect_uri=', resp['Location'])

    def test_connect_forces_https_redirect_uri_outside_debug(self):
        # TLS terminates upstream of Django, so the request scheme is http in
        # prod; the redirect_uri sent to Monzo must still be https or Monzo
        # rejects the mismatch with its registered URI.
        from django.test import override_settings
        with mock.patch.dict(os.environ, MONZO_ENV), override_settings(DEBUG=False):
            resp = self.client.get('/api/fire/monzo/connect/')
        self.assertIn('redirect_uri=https%3A%2F%2Ftestserver%2Fapi%2Ffire%2Fmonzo%2Fcallback%2F', resp['Location'])

    def test_connect_keeps_http_redirect_uri_in_debug(self):
        from django.test import override_settings
        with mock.patch.dict(os.environ, MONZO_ENV), override_settings(DEBUG=True):
            resp = self.client.get('/api/fire/monzo/connect/')
        self.assertIn('redirect_uri=http%3A%2F%2Ftestserver%2Fapi%2Ffire%2Fmonzo%2Fcallback%2F', resp['Location'])

    def test_callback_rejects_state_mismatch(self):
        session = self.client.session
        session['monzo_oauth_state'] = 'expected'
        session.save()
        with mock.patch.dict(os.environ, MONZO_ENV):
            resp = self.client.get('/api/fire/monzo/callback/?code=abc&state=wrong')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(MonzoConnection.objects.count(), 0)

    def test_callback_exchanges_code_and_stores_tokens(self):
        session = self.client.session
        session['monzo_oauth_state'] = 'good-state'
        session.save()
        token_payload = {
            'access_token': 'new-access', 'refresh_token': 'new-refresh',
            'user_id': 'user_123', 'expires_in': 21600,
        }
        with mock.patch.dict(os.environ, MONZO_ENV), \
                mock.patch('budget.monzo.requests.post', return_value=_fake_response(200, token_payload)) as post:
            resp = self.client.get('/api/fire/monzo/callback/?code=abc&state=good-state')
        self.assertEqual(resp.status_code, 302)
        self.assertEqual(resp['Location'], '/')
        connection = MonzoConnection.objects.get(user=self.user)
        self.assertEqual(connection.access_token, 'new-access')
        self.assertEqual(connection.refresh_token, 'new-refresh')
        self.assertIsNotNone(connection.token_expires_at)
        sent = post.call_args.kwargs['data']
        self.assertEqual(sent['grant_type'], 'authorization_code')
        self.assertEqual(sent['code'], 'abc')

    # --- pots & sync ---

    def _mock_monzo_get(self, pots):
        """requests.get stub serving /accounts then /pots."""
        def fake_get(url, params=None, headers=None, timeout=None):
            if url.endswith('/accounts'):
                return _fake_response(200, {'accounts': [{'id': 'acc_1', 'closed': False}]})
            if url.endswith('/pots'):
                return _fake_response(200, {'pots': pots})
            raise AssertionError(f'unexpected URL {url}')
        return fake_get

    def test_pots_lists_open_pots_in_pounds(self):
        self._connect()
        pots = [
            {'id': 'pot_1', 'name': 'Cash ISA', 'balance': 1234599, 'currency': 'GBP', 'deleted': False},
            {'id': 'pot_2', 'name': 'Old pot', 'balance': 100, 'currency': 'GBP', 'deleted': True},
        ]
        with mock.patch.dict(os.environ, MONZO_ENV), \
                mock.patch('budget.monzo.requests.get', side_effect=self._mock_monzo_get(pots)):
            data = self.client.get('/api/fire/monzo/pots/').json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]['id'], 'pot_1')
        self.assertAlmostEqual(data[0]['balance'], 12345.99)

    def test_sync_writes_snapshots_for_linked_accounts(self):
        self._connect()
        linked = FireAccount.objects.create(name='Monzo ISA', owner='tild', kind='isa', monzo_pot_id='pot_1')
        FireAccount.objects.create(name='Unlinked', owner='tild', kind='cash')
        gone = FireAccount.objects.create(name='Stale link', owner='tild', kind='cash', monzo_pot_id='pot_gone')
        pots = [{'id': 'pot_1', 'name': 'Cash ISA', 'balance': 500000, 'currency': 'GBP', 'deleted': False}]
        with mock.patch.dict(os.environ, MONZO_ENV), \
                mock.patch('budget.monzo.requests.get', side_effect=self._mock_monzo_get(pots)):
            resp = self.client.post('/api/fire/monzo/sync/')
        data = resp.json()
        self.assertEqual(data['synced'], 1)
        self.assertEqual(len(data['skipped']), 1)
        snap = BalanceSnapshot.objects.get(account=linked)
        self.assertEqual(float(snap.balance), 5000.00)
        self.assertEqual(snap.source, 'monzo')
        self.assertEqual(snap.date, datetime.date.today())
        self.assertFalse(BalanceSnapshot.objects.filter(account=gone).exists())
        self.assertIsNotNone(MonzoConnection.objects.get(user=self.user).last_synced_at)

    def test_sync_same_day_overwrites_snapshot(self):
        self._connect()
        linked = FireAccount.objects.create(name='Monzo ISA', owner='tild', kind='isa', monzo_pot_id='pot_1')
        BalanceSnapshot.objects.create(account=linked, date=datetime.date.today(), balance=1, source='monzo')
        pots = [{'id': 'pot_1', 'name': 'Cash ISA', 'balance': 200000, 'currency': 'GBP', 'deleted': False}]
        with mock.patch.dict(os.environ, MONZO_ENV), \
                mock.patch('budget.monzo.requests.get', side_effect=self._mock_monzo_get(pots)):
            self.client.post('/api/fire/monzo/sync/')
        self.assertEqual(linked.snapshots.count(), 1)
        self.assertEqual(float(linked.snapshots.first().balance), 2000.00)

    def test_sync_refreshes_expired_token_once(self):
        connection = self._connect()
        FireAccount.objects.create(name='Monzo ISA', owner='tild', kind='isa', monzo_pot_id='pot_1')
        pots = [{'id': 'pot_1', 'name': 'Cash ISA', 'balance': 100, 'currency': 'GBP', 'deleted': False}]
        good_get = self._mock_monzo_get(pots)
        calls = {'n': 0}

        def get_with_expired_first(url, params=None, headers=None, timeout=None):
            calls['n'] += 1
            if calls['n'] == 1:
                return _fake_response(401)
            return good_get(url, params=params, headers=headers, timeout=timeout)

        refresh_payload = {'access_token': 'fresh', 'refresh_token': 'fresh-refresh', 'expires_in': 21600}
        with mock.patch.dict(os.environ, MONZO_ENV), \
                mock.patch('budget.monzo.requests.get', side_effect=get_with_expired_first), \
                mock.patch('budget.monzo.requests.post', return_value=_fake_response(200, refresh_payload)):
            resp = self.client.post('/api/fire/monzo/sync/')
        self.assertEqual(resp.json()['synced'], 1)
        connection.refresh_from_db()
        self.assertEqual(connection.access_token, 'fresh')
        self.assertEqual(connection.refresh_token, 'fresh-refresh')

    def test_sync_surfaces_sca_approval_hint_on_403(self):
        self._connect()
        FireAccount.objects.create(name='Monzo ISA', owner='tild', kind='isa', monzo_pot_id='pot_1')
        with mock.patch.dict(os.environ, MONZO_ENV), \
                mock.patch('budget.monzo.requests.get', return_value=_fake_response(403)):
            resp = self.client.post('/api/fire/monzo/sync/')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('approve', resp.json()['detail'].lower())

    def test_sync_requires_linked_accounts(self):
        self._connect()
        with mock.patch.dict(os.environ, MONZO_ENV):
            resp = self.client.post('/api/fire/monzo/sync/')
        self.assertEqual(resp.status_code, 400)

    def test_disconnect(self):
        self._connect()
        resp = self.client.post('/api/fire/monzo/disconnect/')
        self.assertEqual(resp.status_code, 204)
        self.assertEqual(MonzoConnection.objects.count(), 0)
