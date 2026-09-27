import datetime

from django.db import migrations

# Consolidate the per-component childcare links (ellis_nursery, gaspard_care,
# gaspard_holiday, gaspard_term_club) into one 'childcare' item that carries
# the whole monthly cost. Legacy-linked items are expired at September 2026 so
# history keeps rendering unchanged, and a single 'Childcare' item takes over
# from October 2026. No-op on databases with no legacy-linked items (tests,
# fresh installs).

LEGACY_LINKS = ['ellis_nursery', 'gaspard_care', 'gaspard_holiday', 'gaspard_term_club']

MONTHS = {
    '2026-09': ('September 2026', datetime.date(2026, 9, 1), datetime.date(2026, 9, 30)),
    '2026-10': ('October 2026', datetime.date(2026, 10, 1), datetime.date(2026, 10, 31)),
}


def get_month(Month, month_id):
    name, start, end = MONTHS[month_id]
    month, _ = Month.objects.get_or_create(
        month_id=month_id,
        defaults={'month_name': name, 'start_date': start, 'end_date': end},
    )
    return month


def consolidate(apps, schema_editor):
    BudgetItem = apps.get_model('budget', 'BudgetItem')
    BudgetItemVersion = apps.get_model('budget', 'BudgetItemVersion')
    Month = apps.get_model('budget', 'Month')

    legacy = BudgetItem.objects.filter(childcare_link__in=LEGACY_LINKS)
    if not legacy.exists():
        return

    september = get_month(Month, '2026-09')
    october = get_month(Month, '2026-10')

    # Expire every legacy-linked item still active in October or later; items
    # already expired before October keep their earlier end month.
    for item in legacy:
        last = item.last_payment_month
        if last is None or last.start_date >= october.start_date:
            item.last_payment_month = september
            item.save(update_fields=['last_payment_month'])

    if BudgetItem.objects.filter(childcare_link='childcare').exists():
        return

    childcare = BudgetItem.objects.create(
        item_name='Childcare',
        item_type='expense',
        owner='shared',
        expense_pot='bills',
        category='children',
        childcare_link='childcare',
    )
    # Value is a placeholder: linked items have their effective value
    # substituted client-side from the childcare calculators.
    BudgetItemVersion.objects.create(
        budget_item=childcare,
        month=october,
        effective_from_month=october,
        value=0,
    )


class Migration(migrations.Migration):

    dependencies = [
        ('budget', '0033_alter_budgetitem_childcare_link_and_more'),
    ]

    operations = [
        migrations.RunPython(consolidate, migrations.RunPython.noop),
    ]
