import json

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase


class HouseholdNurserySettingsMigrationTests(TransactionTestCase):
    """0035 must keep the configured calculator blob, not a fresh default copy."""

    migrate_from = [('budget', '0034_consolidate_childcare_links')]
    migrate_to = [('budget', '0035_household_nursery_settings')]

    def _migrate(self, targets):
        executor = MigrationExecutor(connection)
        executor.migrate(targets)
        return executor.loader.project_state(targets).apps

    def tearDown(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

    def test_richest_blob_wins_over_newer_default_copy(self):
        apps = self._migrate(self.migrate_from)
        User = apps.get_model('auth', 'User')
        NurserySettings = apps.get_model('budget', 'NurserySettings')

        configured = {
            'ellis': {'scheme': '30hr'},
            'gaspard': {'days': ['Monday', 'Tuesday']},
            'adhoc': [{'date': '2026-09-03', 'cost': 12}],
            'monthOverrides': {'2026-09': 5},
        }
        defaults = {'ellis': {'scheme': '30hr'}, 'gaspard': {}, 'childcare': {}}

        NurserySettings.objects.create(user=User.objects.create(username='tild'), data=configured)
        # Created (and therefore updated) later, like a first open of the tab.
        NurserySettings.objects.create(user=User.objects.create(username='keith'), data=defaults)
        NurserySettings.objects.create(user=User.objects.create(username='e2e'), data={})

        apps = self._migrate(self.migrate_to)
        NurserySettings = apps.get_model('budget', 'NurserySettings')
        rows = list(NurserySettings.objects.all())
        self.assertEqual(len(rows), 1)
        self.assertEqual(json.dumps(rows[0].data, sort_keys=True), json.dumps(configured, sort_keys=True))
