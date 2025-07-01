# tests.py for a Django Budget Management Application API

from django.test import TestCase, Client
from django.urls import reverse # Useful for complex URLs, though not strictly necessary for ninja
import datetime
import json
import uuid

# Import your models and the API instance
from .models import Month, BudgetItem, BudgetItemVersion
from .api import api # Assuming api.py is in the same app directory


class BudgetAPITestCase(TestCase):
    """
    Test suite for the Django Ninja API endpoints related to budget management.
    """

    def setUp(self):
        """
        Set up initial data for tests, including months and budget items.
        """
        self.client = Client() # Initialize a Django test client

        # Create some Month instances
        self.month_jan = Month.objects.create(
            month_name="January 2025",
            start_date=datetime.date(2025, 1, 1),
            end_date=datetime.date(2025, 1, 31)
        )
        self.month_feb = Month.objects.create(
            month_name="February 2025",
            start_date=datetime.date(2025, 2, 1),
            end_date=datetime.date(2025, 2, 28)
        )
        self.month_mar = Month.objects.create(
            month_name="March 2025",
            start_date=datetime.date(2025, 3, 1),
            end_date=datetime.date(2025, 3, 31)
        )
        self.month_apr = Month.objects.create(
            month_name="April 2025",
            start_date=datetime.date(2025, 4, 1),
            end_date=datetime.date(2025, 4, 30)
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

        # Set an initial version for Rent in January
        BudgetItemVersion.objects.create(
            budget_item=self.item_rent,
            month=self.month_jan,
            value=1200.00,
            effective_from_month=self.month_jan
        )
        # Set an initial version for Salary in January
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
            "month_name": "May 2025",
            "start_date": "2025-05-01",
            "end_date": "2025-05-31"
        }
        response = self.client.post(
            '/api/months/',
            json.dumps(new_month_data),
            content_type="application/json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(Month.objects.count(), 5) # 4 existing + 1 new
        data = response.json()
        self.assertEqual(data['month_name'], "May 2025")
        self.assertIsNotNone(data['month_id'])

    # --- Test BudgetItem Endpoints ---

    def test_create_budget_item(self):
        """
        Test the POST /budgetitems/ endpoint for creating a new budget item category.
        """
        new_item_data = {
            "item_name": "Utilities",
            "item_type": "expense",
            "description": "Electricity and water bills"
        }
        response = self.client.post(
            '/api/budgetitems/',
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
        (e.g., February 2025 should use January 2025 values)
        """
        response = self.client.get(f'/api/months/{self.month_feb.month_id}/items/')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data), 2) # Rent and Salary should roll over

        rent_item = next((item for item in data if item['item_name'] == 'Rent'), None)
        self.assertIsNotNone(rent_item)
        self.assertEqual(rent_item['effective_value'], 1200.00)
        self.assertEqual(rent_item['effective_from_month_name'], self.month_jan.month_name) # Still effective from Jan

        salary_item = next((item for item in data if item['item_name'] == 'Salary'), None)
        self.assertIsNotNone(salary_item)
        self.assertEqual(salary_item['effective_value'], 3000.00)
        self.assertEqual(salary_item['effective_from_month_name'], self.month_jan.month_name) # Still effective from Jan


    def test_set_budget_item_value_new_version(self):
        """
        Test PUT /months/{month_id}/items/{budget_item_id}/value/ to create a new version.
        (e.g., Rent changes for March 2025)
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
        (e.g., re-set Salary for January)
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

    def test_list_items_for_month_after_new_version(self):
        """
        Test GET /months/{month_id}/items/ for a month after a new version was set for a prior month.
        (e.g., April 2025 should use March 2025 Rent value, and Feb 2025 Salary value)
        """
        # First, set a new Rent value for March
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
        self.assertEqual(rent_item['effective_value'], 1250.00) # Should be the new March value
        self.assertEqual(rent_item['effective_from_month_name'], self.month_mar.month_name)

        salary_item = next((item for item in data if item['item_name'] == 'Salary'), None)
        self.assertIsNotNone(salary_item)
        self.assertEqual(salary_item['effective_value'], 3000.00) # Should still be January value
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


