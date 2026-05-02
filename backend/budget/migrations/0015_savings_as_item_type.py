from django.db import migrations, models


def flag_to_type(apps, schema_editor):
    BudgetItem = apps.get_model('budget', 'BudgetItem')
    BudgetItem.objects.filter(is_savings=True).update(item_type='savings')


def type_to_flag(apps, schema_editor):
    BudgetItem = apps.get_model('budget', 'BudgetItem')
    BudgetItem.objects.filter(item_type='savings').update(item_type='expense', is_savings=True)


class Migration(migrations.Migration):

    dependencies = [
        ('budget', '0014_budgetitem_is_savings'),
    ]

    operations = [
        migrations.AlterField(
            model_name='budgetitem',
            name='item_type',
            field=models.CharField(
                choices=[('expense', 'Expense'), ('income', 'Income'), ('savings', 'Savings')],
                default='expense',
                help_text="Type of the item: 'expense', 'income', or 'savings'.",
                max_length=10,
            ),
        ),
        migrations.RunPython(flag_to_type, type_to_flag),
        migrations.RemoveField(
            model_name='budgetitem',
            name='is_savings',
        ),
    ]
