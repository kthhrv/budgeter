# Generated by Django 5.2.3 on 2025-06-28 11:37

import django.db.models.deletion
import uuid
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
    ]

    operations = [
        migrations.CreateModel(
            name='BudgetItem',
            fields=[
                ('budget_item_id', models.UUIDField(default=uuid.uuid4, editable=False, help_text='Unique identifier for the budget item.', primary_key=True, serialize=False)),
                ('item_name', models.CharField(help_text="Name of the budget item, e.g., 'Rent', 'Electricity Bill'.", max_length=100, unique=True)),
                ('item_type', models.CharField(choices=[('expense', 'Expense'), ('income', 'Income')], default='expense', help_text="Type of the item: 'expense' or 'income'.", max_length=10)),
                ('description', models.TextField(blank=True, help_text='Optional detailed description of the budget item.', null=True)),
            ],
            options={
                'verbose_name': 'Budget Item',
                'verbose_name_plural': 'Budget Items',
                'ordering': ['item_name'],
            },
        ),
        migrations.CreateModel(
            name='Month',
            fields=[
                ('month_id', models.UUIDField(default=uuid.uuid4, editable=False, help_text='Unique identifier for the month.', primary_key=True, serialize=False)),
                ('month_name', models.CharField(help_text="Name of the month, e.g., 'January 2025'.", max_length=50, unique=True)),
                ('start_date', models.DateField(help_text='The first day of the month.')),
                ('end_date', models.DateField(help_text='The last day of the month.')),
            ],
            options={
                'verbose_name': 'Month',
                'verbose_name_plural': 'Months',
                'ordering': ['start_date'],
            },
        ),
        migrations.CreateModel(
            name='BudgetItemVersion',
            fields=[
                ('budget_item_version_id', models.UUIDField(default=uuid.uuid4, editable=False, help_text='Unique identifier for this specific version of a budget item.', primary_key=True, serialize=False)),
                ('value', models.DecimalField(decimal_places=2, help_text='The budgeted amount for this item for this month/version.', max_digits=10)),
                ('created_at', models.DateTimeField(auto_now_add=True, help_text='Timestamp when this budget item version was created.')),
                ('notes', models.TextField(blank=True, help_text='Optional notes regarding this specific version (e.g., reason for change).', null=True)),
                ('budget_item', models.ForeignKey(help_text='The budget item this version belongs to.', on_delete=django.db.models.deletion.CASCADE, related_name='versions', to='budget.budgetitem')),
                ('effective_from_month', models.ForeignKey(help_text="The month from which this budget item's value becomes effective. This is key for the rollover logic.", on_delete=django.db.models.deletion.CASCADE, related_name='effective_budget_item_versions', to='budget.month')),
                ('month', models.ForeignKey(help_text='The month for which this specific value was set/recorded.', on_delete=django.db.models.deletion.CASCADE, related_name='budget_item_versions', to='budget.month')),
            ],
            options={
                'verbose_name': 'Budget Item Version',
                'verbose_name_plural': 'Budget Item Versions',
                'ordering': ['budget_item__item_name', 'month__start_date'],
                'unique_together': {('budget_item', 'month')},
            },
        ),
    ]
