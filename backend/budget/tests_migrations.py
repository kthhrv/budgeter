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


class SplitChildcarePotMigrationTests(TransactionTestCase):
    """0036 re-points the combined Childcare line at Ellis and adds Gaspard's own line."""

    migrate_from = [('budget', '0035_household_nursery_settings')]
    migrate_to = [('budget', '0036_split_childcare_pot')]

    def _migrate(self, targets):
        executor = MigrationExecutor(connection)
        executor.migrate(targets)
        return executor.loader.project_state(targets).apps

    def tearDown(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

    def _seed_combined(self, apps, name='Childcare'):
        import datetime
        BudgetItem = apps.get_model('budget', 'BudgetItem')
        BudgetItemVersion = apps.get_model('budget', 'BudgetItemVersion')
        Month = apps.get_model('budget', 'Month')
        october = Month.objects.create(
            month_id='2026-10', month_name='October 2026',
            start_date=datetime.date(2026, 10, 1), end_date=datetime.date(2026, 10, 31),
        )
        item = BudgetItem.objects.create(
            item_name=name, item_type='expense', owner='shared',
            expense_pot='bills', category='children', childcare_link='childcare',
        )
        BudgetItemVersion.objects.create(
            budget_item=item, month=october, effective_from_month=october, value=0,
        )
        return item

    def test_combined_line_becomes_ellis_and_gaspard_gets_his_own_pot(self):
        apps = self._migrate(self.migrate_from)
        combined = self._seed_combined(apps)

        apps = self._migrate(self.migrate_to)
        BudgetItem = apps.get_model('budget', 'BudgetItem')

        ellis = BudgetItem.objects.get(pk=combined.pk)
        self.assertEqual(ellis.childcare_link, 'ellis_nursery')
        self.assertEqual(ellis.item_name, 'Ellis nursery')
        self.assertEqual(ellis.expense_pot, 'bills')
        self.assertIsNone(ellis.last_payment_month)

        gaspard = BudgetItem.objects.get(childcare_link='gaspard_childcare')
        self.assertEqual(gaspard.expense_pot, 'gaspard_childcare')
        self.assertEqual(gaspard.owner, 'shared')
        self.assertEqual(gaspard.category, 'children')
        BudgetItemVersion = apps.get_model('budget', 'BudgetItemVersion')
        versions = list(BudgetItemVersion.objects.filter(budget_item=gaspard))
        self.assertEqual(len(versions), 1)
        self.assertEqual(versions[0].effective_from_month.month_id, '2026-10')

        self.assertFalse(BudgetItem.objects.filter(childcare_link='childcare').exists())

    def test_keeps_a_custom_name_on_the_combined_line(self):
        apps = self._migrate(self.migrate_from)
        combined = self._seed_combined(apps, name='Kids')

        apps = self._migrate(self.migrate_to)
        BudgetItem = apps.get_model('budget', 'BudgetItem')
        self.assertEqual(BudgetItem.objects.get(pk=combined.pk).item_name, 'Kids')

    def test_noop_without_a_combined_line(self):
        apps = self._migrate(self.migrate_from)
        apps = self._migrate(self.migrate_to)
        BudgetItem = apps.get_model('budget', 'BudgetItem')
        self.assertEqual(BudgetItem.objects.count(), 0)
