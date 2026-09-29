import json

from django.contrib.auth.models import User
from django.test import Client, TestCase

from .models import NurserySettings


class NurserySettingsSharedTests(TestCase):
    """The childcare calculator blob belongs to the household, not the login."""

    def setUp(self):
        self.tild = Client()
        User.objects.create_user(username='tild', password='pw')
        self.tild.login(username='tild', password='pw')

        self.keith = Client()
        User.objects.create_user(username='keith', password='pw')
        self.keith.login(username='keith', password='pw')

    def test_settings_saved_by_one_user_are_read_by_the_other(self):
        blob = {'ellis': {'scheme': '30hr'}, 'gaspard': {'days': ['Monday']}}
        resp = self.tild.put(
            '/api/nursery/settings/',
            data=json.dumps({'data': blob}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)

        resp = self.keith.get('/api/nursery/settings/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['data'], blob)
        self.assertEqual(NurserySettings.objects.count(), 1)

    def test_first_read_creates_the_single_household_row(self):
        self.keith.get('/api/nursery/settings/')
        self.tild.get('/api/nursery/settings/')
        self.assertEqual(NurserySettings.objects.count(), 1)
        self.assertEqual(self.tild.get('/api/nursery/settings/').json(), {'data': {}})
