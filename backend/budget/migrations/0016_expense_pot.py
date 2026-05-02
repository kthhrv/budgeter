from django.db import migrations, models


def flags_to_pot(apps, schema_editor):
    BudgetItem = apps.get_model('budget', 'BudgetItem')
    BudgetItem.objects.filter(bills_pot=True).update(expense_pot='bills')
    BudgetItem.objects.filter(groceries_pot=True).update(expense_pot='groceries')


def pot_to_flags(apps, schema_editor):
    BudgetItem = apps.get_model('budget', 'BudgetItem')
    BudgetItem.objects.filter(expense_pot='bills').update(bills_pot=True)
    BudgetItem.objects.filter(expense_pot='groceries').update(groceries_pot=True)


class Migration(migrations.Migration):

    dependencies = [
        ('budget', '0015_savings_as_item_type'),
    ]

    operations = [
        migrations.AddField(
            model_name='budgetitem',
            name='expense_pot',
            field=models.CharField(
                blank=True,
                choices=[('bills', 'Bills Pot'), ('groceries', 'Groceries Pot')],
                default='',
                help_text='Optional sub-classification for an expense: bills pot or groceries pot.',
                max_length=20,
            ),
        ),
        migrations.RunPython(flags_to_pot, pot_to_flags),
        migrations.RemoveField(model_name='budgetitem', name='bills_pot'),
        migrations.RemoveField(model_name='budgetitem', name='groceries_pot'),
    ]
