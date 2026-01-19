from django.test import TestCase, Client
from .models import Month, BudgetItem, BudgetItemVersion
from django.contrib.auth.models import User
from .api import calculate_weekly_occurrences
import datetime
import json

class BudgetWeeklyTestCase(TestCase):
    def setUp(self):
        self.client = Client()
        self.user = User.objects.create_user(username='testuser', password='password')
        self.client.login(username='testuser', password='password')
        self.month_jan_2026 = Month.objects.create(
            month_id="2026-01",
            month_name="January 2026",
            start_date=datetime.date(2026, 1, 1),
            end_date=datetime.date(2026, 1, 31)
        )
    
    def test_weekly_occurrences_function(self):
        # Jan 2026 starts Thursday (4).
        # Thu(4), Fri(5), Sat(6) should have 5 occurrences.
        # Sun(7), Mon(1), Tue(2), Wed(3) should have 4 occurrences.
        
        self.assertEqual(calculate_weekly_occurrences(2026, 1, 4), 5) # Thursday
        self.assertEqual(calculate_weekly_occurrences(2026, 1, 7), 4) # Sunday

    def test_weekly_item_api_calculation(self):
        # Create item with Sunday (7)
        item = BudgetItem.objects.create(
            item_name="Weekly Sunday",
            item_type="expense",
            calculation_type="weekly_count",
            weekly_payment_day=7,
            owner="shared"
        )
        # Create version with value 10
        BudgetItemVersion.objects.create(
            budget_item=item,
            month=self.month_jan_2026,
            value=10.00,
            effective_from_month=self.month_jan_2026
        )
        
        response = self.client.get(f'/api/months/2026-01/items/')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        item_data = next(i for i in data if i['item_name'] == "Weekly Sunday")
        
        # Expect 4 * 10 = 40
        self.assertEqual(item_data['effective_value'], 40.0)
        self.assertEqual(item_data['value'], 10.0)
        self.assertEqual(item_data['occurrences'], 4)

        # Update item to Thursday (4)
        item.weekly_payment_day = 4
        item.save()
        
        response = self.client.get(f'/api/months/2026-01/items/')
        data = response.json()
        item_data = next(i for i in data if i['item_name'] == "Weekly Sunday")
        
        # Expect 5 * 10 = 50
        self.assertEqual(item_data['effective_value'], 50.0)
        self.assertEqual(item_data['occurrences'], 5)
