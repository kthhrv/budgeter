"""Fake Monzo transactions so the payments calendar can be tried without Monzo.

For the demo environment and local dev: writes ~3 months of BankTransaction
rows built from the current budget items (one payee per item, a fixed day
each). One item's latest payment is a bit higher than budgeted and one is
left unpaid this month, so the amount-changed and missed notifications have
something to show. Rows are prefixed `demo_` and `--clear` removes them.

    uv run manage.py seed_demo_transactions [--link] [--clear]

Refuses to run when APP_ENV=prod.
"""
import datetime
import os
import random
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from budget import payment_service, payments
from budget.api import _effective_version_for_month, _prefetched_budget_items
from budget.models import BankTransaction, ItemPayment, Month, Notification
from budget.notifications import generate_notifications

PREFIX = 'demo_'


class Command(BaseCommand):
    help = "Seed fake Monzo transactions for the payments calendar (not on prod)."

    def add_arguments(self, parser):
        parser.add_argument('--link', action='store_true', help="Also link each item to its fake payee.")
        parser.add_argument('--clear', action='store_true', help="Remove previously seeded demo transactions and stop.")

    def handle(self, *args, link=False, clear=False, **opts):
        if os.environ.get('APP_ENV') == 'prod':
            raise CommandError("Refusing to seed fake transactions on prod.")
        demo = BankTransaction.objects.filter(monzo_id__startswith=PREFIX)
        ItemPayment.objects.filter(transaction__in=demo).delete()
        removed = demo.count()
        demo.delete()
        if clear:
            Notification.objects.all().delete()
            self.stdout.write(f"Removed {removed} demo transactions.")
            return

        today = payment_service.local_date(timezone.now())
        month = Month.objects.filter(start_date=today.replace(day=1)).first()
        if month is None:
            raise CommandError("Open the current month on the Budget tab first (no Month row yet).")
        rng = random.Random(42)
        items = []
        for item in _prefetched_budget_items():
            if (not payment_service.is_calendar_item(item) or item.calculation_type != 'fixed'
                    or payment_service._is_expired(item, month)):
                continue
            version = _effective_version_for_month(item, month)
            if version is None or not version.value:
                continue
            items.append((item, version.value))

        created = 0
        for idx, (item, value) in enumerate(items):
            payee = f"{item.item_name} Ltd"
            # The first two items pay early in the month so this month's
            # price rise / missing payment are already visible.
            day = idx + 1 if idx < 2 else rng.randint(3, 28)
            scheme = 'bacs' if idx % 3 else 'mastercard'
            for back in (3, 2, 1, 0):
                y, m = today.year, today.month - back
                while m < 1:
                    y, m = y - 1, m + 12
                scheduled = payments.clamp_day(y, m, day)
                date = payments.due_date_for(scheduled, payments.payment_method_for(scheme))
                if date > today:
                    continue
                if back == 0 and idx == 1:
                    continue  # left unpaid → "missed"
                amount = Decimal(value)
                if back == 0 and idx == 0:
                    amount = (amount * Decimal('1.05')).quantize(Decimal('0.01'))  # price rise
                BankTransaction.objects.create(
                    monzo_id=f"{PREFIX}{item.pk}_{y}{m:02d}",
                    account_id='demo_account', account_type='uk_retail_joint',
                    created=datetime.datetime.combine(date, datetime.time(7), datetime.timezone.utc),
                    amount=-amount, payee=payee, payee_key=payments.normalise_payee(payee),
                    scheme=scheme, payment_method=payments.payment_method_for(scheme),
                )
                created += 1
            if link:
                payment_service.link_item(item, payee, today=today)

        payment_service.relearn_items()
        matched = payment_service.rematch(payment_service.recent_months(today))
        generate_notifications(today)
        self.stdout.write(self.style.SUCCESS(
            f"Seeded {created} demo transactions for {len(items)} items; {matched} matched."
        ))
