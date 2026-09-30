import datetime

from django.db import migrations, models

# Split the single 'childcare' budget line (0034) into one item per child, so
# each can be funded from its own pot: Ellis's nursery stays in the bills pot,
# while Gaspard's school clubs are billed in lumps at half-term start/end and
# so accumulate in a dedicated 'gaspard_childcare' pot instead.
#
# The consolidated item was created for October 2026 and has never carried a
# month of its own before then, so it is re-pointed in place at Ellis (link
# 'ellis_nursery', renamed only if it still has the default name) and a new
# Gaspard item takes over his share from October 2026. Any month from October
# therefore shows the same total as before, split across two lines. No-op on
# databases without a 'childcare'-linked item (tests, fresh installs).

SPLIT_MONTH = ('2026-10', 'October 2026', datetime.date(2026, 10, 1), datetime.date(2026, 10, 31))


def get_split_month(Month):
    month_id, name, start, end = SPLIT_MONTH
    month, _ = Month.objects.get_or_create(
        month_id=month_id,
        defaults={'month_name': name, 'start_date': start, 'end_date': end},
    )
    return month


def split(apps, schema_editor):
    BudgetItem = apps.get_model('budget', 'BudgetItem')
    BudgetItemVersion = apps.get_model('budget', 'BudgetItemVersion')
    Month = apps.get_model('budget', 'Month')

    combined = list(BudgetItem.objects.filter(childcare_link='childcare'))
    if not combined:
        return

    for item in combined:
        item.childcare_link = 'ellis_nursery'
        if item.item_name == 'Childcare':
            item.item_name = 'Ellis nursery'
        item.save(update_fields=['childcare_link', 'item_name'])

    if BudgetItem.objects.filter(childcare_link='gaspard_childcare').exists():
        return

    october = get_split_month(Month)
    gaspard = BudgetItem.objects.create(
        item_name='Gaspard childcare',
        item_type='expense',
        owner='shared',
        expense_pot='gaspard_childcare',
        category='children',
        childcare_link='gaspard_childcare',
    )
    # Value is a placeholder: linked items have their effective value
    # substituted client-side from the childcare calculators.
    BudgetItemVersion.objects.create(
        budget_item=gaspard,
        month=october,
        effective_from_month=october,
        value=0,
    )


class Migration(migrations.Migration):

    dependencies = [
        ('budget', '0035_household_nursery_settings'),
    ]

    operations = [
        migrations.AlterField(
            model_name='budgetitem',
            name='expense_pot',
            field=models.CharField(blank=True, choices=[('bills', 'Bills Pot'), ('groceries', 'Groceries Pot'), ('gaspard_childcare', "Gaspard's Childcare Pot")], default='', help_text="Optional sub-classification for an expense: which pot it is funded from (bills, groceries or Gaspard's childcare). The budget tab shows a 'Transfer to …' line per pot.", max_length=20),
        ),
        migrations.AlterField(
            model_name='budgetitem',
            name='childcare_link',
            field=models.CharField(blank=True, choices=[('', '—'), ('ellis_nursery', 'Ellis nursery'), ('gaspard_childcare', 'Gaspard childcare (after-school + clubs)'), ('childcare', 'Childcare, both children (legacy)'), ('gaspard_care', 'Gaspard after-school (legacy)'), ('gaspard_holiday', 'Gaspard holiday club (legacy)'), ('gaspard_term_club', 'Gaspard term-time clubs (legacy)')], default='', help_text="If set, this item's monthly value is auto-synced from the childcare calculators. 'ellis_nursery' → Ellis's nursery net for the month. 'gaspard_childcare' → Gaspard's after-school, term-time-club and holiday-club attendance for the month (TFC clubs at their net 80%, non-TFC at full price); pair it with the gaspard_childcare pot. The two are kept apart because Ellis is funded from the bills pot and Gaspard from his own. The other values are legacy links (see migrations 0034 and 0036) and remain only on historical items.", max_length=20),
        ),
        migrations.RunPython(split, migrations.RunPython.noop),
    ]
