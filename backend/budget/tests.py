# tests.py for a Django Budget Management Application API

from django.test import TestCase, Client
from django.urls import reverse # Useful for complex URLs, though not strictly necessary for ninja
from unittest.mock import patch
import datetime
import json
import uuid

# Import your models and the API instance
from .models import Month, BudgetItem, BudgetItemVersion
from .api import api # Assuming api.py is in the same app directory


class FakeDate(datetime.date):
    @classmethod
    def today(cls):
        return cls(2025, 10, 15)


class BudgetAPITestCase(TestCase):
    """
    Test suite for the Django Ninja API endpoints related to budget management.
    """

    def setUp(self):
        """
        Set up initial data for tests, including months and budget items.
        """
        self.client = Client() # Initialize a Django test client

        # Patch datetime.date in budget.api to freeze time at 2025-10-15
        # This ensures that "2025-10" is considered the current month for these tests
        self.date_patcher = patch('budget.api.datetime.date', FakeDate)
        self.date_patcher.start()
        self.addCleanup(self.date_patcher.stop)

        # Create some Month instances (using current and future months to allow editing)
        self.month_jan = Month.objects.create(
            month_id="2025-10",
            month_name="October 2025",
            start_date=datetime.date(2025, 10, 1),
            end_date=datetime.date(2025, 10, 31)
        )
        self.month_feb = Month.objects.create(
            month_id="2025-11",
            month_name="November 2025",
            start_date=datetime.date(2025, 11, 1),
            end_date=datetime.date(2025, 11, 30)
        )
        self.month_mar = Month.objects.create(
            month_id="2025-12",
            month_name="December 2025",
            start_date=datetime.date(2025, 12, 1),
            end_date=datetime.date(2025, 12, 31)
        )
        self.month_apr = Month.objects.create(
            month_id="2026-01",
            month_name="January 2026",
            start_date=datetime.date(2026, 1, 1),
            end_date=datetime.date(2026, 1, 31)
        )

        # Create some BudgetItem instances
        self.item_rent = BudgetItem.objects.create(
            item_name="Rent",
            item_type="expense",
            description="Monthly apartment rent"
        )
        self.item_salary = BudgetItem.objects.create(
            item_name="Salary",
            item_type="income",
            description="Monthly salary income"
        )
        self.item_groceries = BudgetItem.objects.create(
            item_name="Groceries",
            item_type="expense",
            description="Food expenses"
        )

        # Set an initial version for Rent in October
        BudgetItemVersion.objects.create(
            budget_item=self.item_rent,
            month=self.month_jan,
            value=1200.00,
            effective_from_month=self.month_jan
        )
        # Set an initial version for Salary in October
        BudgetItemVersion.objects.create(
            budget_item=self.item_salary,
            month=self.month_jan,
            value=3000.00,
            effective_from_month=self.month_jan
        )


    # --- Test Month Endpoints ---

    def test_create_month(self):
        """
        Test the POST /months/ endpoint for creating a new month.
        """
        new_month_data = {
            "month": "2026-02"
        }
        response = self.client.post(
            '/api/months/',
            json.dumps(new_month_data),
            content_type="application/json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(Month.objects.count(), 5) # 4 existing + 1 new
        data = response.json()
        self.assertEqual(data['month_name'], "February 2026")
        self.assertEqual(data['month_id'], "2026-02")

    # --- Test BudgetItem Endpoints ---

    def test_create_budget_item(self):
        """
        Test the POST /months/{month_id}/budgetitems/ endpoint for creating a new budget item category.
        """
        new_item_data = {
            "item_name": "Utilities",
            "item_type": "expense",
            "description": "Electricity and water bills",
            "owner": "shared",
            "bills_pot": False,
            "calculation_type": "fixed",
            "value": 150.00,
            "notes": "Initial utilities budget",
            "is_one_off": False
        }
        response = self.client.post(
            f'/api/months/{self.month_jan.month_id}/budgetitems/',
            json.dumps(new_item_data),
            content_type="application/json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(BudgetItem.objects.count(), 4) # 3 existing + 1 new
        data = response.json()
        self.assertEqual(data['item_name'], "Utilities")
        self.assertIsNotNone(data['budget_item_id'])

    def test_edit_budget_item(self):
        """
        Test the PUT /budgetitems/{budget_item_id}/ endpoint for editing an existing budget item category.
        """
        updated_description = "Food and household supplies"
        update_data = {
            "description": updated_description
        }
        response = self.client.put(
            f'/api/budgetitems/{self.item_groceries.budget_item_id}/',
            json.dumps(update_data),
            content_type="application/json"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.item_groceries.refresh_from_db()
        self.assertEqual(self.item_groceries.description, updated_description)
        self.assertEqual(data['description'], updated_description)


    # --- Test BudgetItemVersion and Rollover Logic ---

    def test_list_items_for_month_initial_versions(self):
        """
        Test GET /months/{month_id}/items/ for a month with direct versions.
        """
        response = self.client.get(f'/api/months/{self.month_jan.month_id}/items/')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data), 2) # Rent and Salary

        rent_item = next((item for item in data if item['item_name'] == 'Rent'), None)
        self.assertIsNotNone(rent_item)
        self.assertEqual(rent_item['effective_value'], 1200.00)
        self.assertEqual(rent_item['effective_from_month_name'], self.month_jan.month_name)

        salary_item = next((item for item in data if item['item_name'] == 'Salary'), None)
        self.assertIsNotNone(salary_item)
        self.assertEqual(salary_item['effective_value'], 3000.00)
        self.assertEqual(salary_item['effective_from_month_name'], self.month_jan.month_name)

    def test_list_items_for_month_rollover(self):
        """
        Test GET /months/{month_id}/items/ for a month where values should roll over.
        (e.g., November 2025 should use October 2025 values)
        """
        response = self.client.get(f'/api/months/{self.month_feb.month_id}/items/')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data), 2) # Rent and Salary should roll over

        rent_item = next((item for item in data if item['item_name'] == 'Rent'), None)
        self.assertIsNotNone(rent_item)
        self.assertEqual(rent_item['effective_value'], 1200.00)
        self.assertEqual(rent_item['effective_from_month_name'], self.month_jan.month_name) # Still effective from Oct

        salary_item = next((item for item in data if item['item_name'] == 'Salary'), None)
        self.assertIsNotNone(salary_item)
        self.assertEqual(salary_item['effective_value'], 3000.00)
        self.assertEqual(salary_item['effective_from_month_name'], self.month_jan.month_name) # Still effective from Oct


    def test_set_budget_item_value_new_version(self):
        """
        Test PUT /months/{month_id}/items/{budget_item_id}/value/ to create a new version.
        (e.g., Rent changes for December 2025)
        """
        new_rent_value = 1250.00
        new_notes = "Rent increased by landlord"
        update_data = {
            "value": new_rent_value,
            "notes": new_notes
        }
        response = self.client.put(
            f'/api/months/{self.month_mar.month_id}/items/{self.item_rent.budget_item_id}/value/',
            json.dumps(update_data),
            content_type="application/json"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['effective_value'], new_rent_value)
        self.assertEqual(data['effective_from_month_name'], self.month_mar.month_name) # New effective month
        self.assertEqual(data['notes'], new_notes)

        # Verify that a new BudgetItemVersion record was created
        self.assertEqual(BudgetItemVersion.objects.filter(
            budget_item=self.item_rent,
            month=self.month_mar
        ).count(), 1)

    def test_set_budget_item_value_update_existing_version(self):
        """
        Test PUT /months/{month_id}/items/{budget_item_id}/value/ to update an existing version.
        (e.g., re-set Salary for October)
        """
        updated_salary_value = 3100.00
        update_data = {
            "value": updated_salary_value
        }
        response = self.client.put(
            f'/api/months/{self.month_jan.month_id}/items/{self.item_salary.budget_item_id}/value/',
            json.dumps(update_data),
            content_type="application/json"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['effective_value'], updated_salary_value)
        self.assertEqual(data['effective_from_month_name'], self.month_jan.month_name)

        # Verify that the existing BudgetItemVersion record was updated, not a new one created
        self.assertEqual(BudgetItemVersion.objects.filter(
            budget_item=self.item_salary,
            month=self.month_jan
        ).count(), 1)
        # Check the value in the database
        updated_version = BudgetItemVersion.objects.get(
            budget_item=self.item_salary,
            month=self.month_jan
        )
        self.assertEqual(float(updated_version.value), updated_salary_value)

    def test_calculate_weekly_occurrences_with_day_limit(self):
        """
        Test the calculate_weekly_occurrences helper function with the day < 28 limit.
        """
        from .api import calculate_weekly_occurrences # Import the helper function directly

        # October 2025 has 5 Tuesdays (day_of_week = 2): 7, 14, 21, 28.
        # With the day < 28 limit, the 28th should not be counted.
        # Expected occurrences: 3
        occurrences_oct_tuesday = calculate_weekly_occurrences(2025, 10, 2)
        self.assertEqual(occurrences_oct_tuesday, 3)

        # November 2025 has 4 Mondays (day_of_week = 1): 3, 10, 17, 24.
        # All are less than 28, so all should be counted.
        # Expected occurrences: 4
        occurrences_nov_monday = calculate_weekly_occurrences(2025, 11, 1)
        self.assertEqual(occurrences_nov_monday, 4)

        # December 2025 has 5 Thursdays (day_of_week = 4): 4, 11, 18, 25.
        # All are less than 28, so all should be counted.
        # Expected occurrences: 4
        occurrences_dec_thursday = calculate_weekly_occurrences(2025, 12, 4)
        self.assertEqual(occurrences_dec_thursday, 4)

        # January 2026 has 5 Thursdays (day_of_week = 4): 1, 8, 15, 22, 29.
        # With the day < 28 limit, the 29th should not be counted.
        # Expected occurrences: 4
        occurrences_jan_thursday = calculate_weekly_occurrences(2026, 1, 4)
        self.assertEqual(occurrences_jan_thursday, 4)

    def test_edit_previous_month_value_forbidden(self):

        # Create a month from 2024 (in the past)
        past_month = Month.objects.create(
            month_id="2024-12",
            month_name="December 2024",
            start_date=datetime.date(2024, 12, 1),
            end_date=datetime.date(2024, 12, 31)
        )
        
        # Create a budget item version for that past month
        BudgetItemVersion.objects.create(
            budget_item=self.item_rent,
            month=past_month,
            value=1100.00,
            effective_from_month=past_month
        )
        
        # Try to update the value for the past month
        update_data = {
            "value": 1150.00,
            "notes": "Trying to update past month"
        }
        response = self.client.put(
            f'/api/months/{past_month.month_id}/items/{self.item_rent.budget_item_id}/value/',
            json.dumps(update_data),
            content_type="application/json"
        )
        
        # Should return 403 Forbidden
        self.assertEqual(response.status_code, 403)
        data = response.json()
        self.assertIn("Cannot edit budget items for previous months", data['detail'])
        
    def test_delete_previous_month_item_forbidden(self):
        """
        Test that deleting budget items for previous months returns 403 Forbidden.
        """
        # Create a month from 2024 (in the past)
        past_month = Month.objects.create(
            month_id="2024-11",
            month_name="November 2024",
            start_date=datetime.date(2024, 11, 1),
            end_date=datetime.date(2024, 11, 30)
        )
        
        # Try to delete an item for the past month
        response = self.client.delete(
            f'/api/months/{past_month.month_id}/items/{self.item_rent.budget_item_id}/'
        )
        
        # Should return 403 Forbidden
        self.assertEqual(response.status_code, 403)
        data = response.json()
        self.assertIn("Cannot delete budget items for previous months", data['detail'])


    def test_list_items_for_month_after_new_version(self):
        """
        Test GET /months/{month_id}/items/ for a month after a new version was set for a prior month.
        (e.g., January 2026 should use December 2025 Rent value, and Nov 2025 Salary value)
        """
        # First, set a new Rent value for December
        BudgetItemVersion.objects.create(
            budget_item=self.item_rent,
            month=self.month_mar,
            value=1250.00,
            effective_from_month=self.month_mar
        )

        response = self.client.get(f'/api/months/{self.month_apr.month_id}/items/')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data), 2) # Rent and Salary

        rent_item = next((item for item in data if item['item_name'] == 'Rent'), None)
        self.assertIsNotNone(rent_item)
        self.assertEqual(rent_item['effective_value'], 1250.00) # Should be the new December value
        self.assertEqual(rent_item['effective_from_month_name'], self.month_mar.month_name)

        salary_item = next((item for item in data if item['item_name'] == 'Salary'), None)
        self.assertIsNotNone(salary_item)
        self.assertEqual(salary_item['effective_value'], 3000.00) # Should still be October value
        self.assertEqual(salary_item['effective_from_month_name'], self.month_jan.month_name)

    def test_list_items_with_no_version(self):
        """
        Test that an item with no version set at all is not returned (or handled gracefully).
        In current API, it won't be returned by default.
        """
        response = self.client.get(f'/api/months/{self.month_jan.month_id}/items/')
        data = response.json()
        # Verify Groceries (which has no versions) is not in the list
        self.assertIsNone(next((item for item in data if item['item_name'] == 'Groceries'), None))

    def test_edit_previous_month_value_forbidden(self):
        """
        Test that editing budget item values for previous months returns 403 Forbidden.
        """
        # Create a month from 2024 (in the past)
        past_month = Month.objects.create(
            month_id="2024-12",
            month_name="December 2024",
            start_date=datetime.date(2024, 12, 1),
            end_date=datetime.date(2024, 12, 31)
        )
        
        # Create a budget item version for that past month
        BudgetItemVersion.objects.create(
            budget_item=self.item_rent,
            month=past_month,
            value=1100.00,
            effective_from_month=past_month
        )
        
        # Try to update the value for the past month
        update_data = {
            "value": 1150.00,
            "notes": "Trying to update past month"
        }
        response = self.client.put(
            f'/api/months/{past_month.month_id}/items/{self.item_rent.budget_item_id}/value/',
            json.dumps(update_data),
            content_type="application/json"
        )
        
        # Should return 403 Forbidden
        self.assertEqual(response.status_code, 403)
        data = response.json()
        self.assertIn("Cannot edit budget items for previous months", data['detail'])
        
    def test_delete_previous_month_item_forbidden(self):
        """
        Test that deleting budget items for previous months returns 403 Forbidden.
        """
        # Create a month from 2024 (in the past)
        past_month = Month.objects.create(
            month_id="2024-11",
            month_name="November 2024",
            start_date=datetime.date(2024, 11, 1),
            end_date=datetime.date(2024, 11, 30)
        )
        
        # Try to delete an item for the past month
        response = self.client.delete(
            f'/api/months/{past_month.month_id}/items/{self.item_rent.budget_item_id}/'
        )
        
        # Should return 403 Forbidden
        self.assertEqual(response.status_code, 403)
        data = response.json()
        self.assertIn("Cannot delete budget items for previous months", data['detail'])


