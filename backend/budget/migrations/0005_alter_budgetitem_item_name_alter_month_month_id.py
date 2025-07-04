# Generated by Django 5.2.3 on 2025-06-29 07:04

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('budget', '0004_budgetitemversion_is_one_off_alter_month_month_id'),
    ]

    operations = [
        migrations.AlterField(
            model_name='budgetitem',
            name='item_name',
            field=models.CharField(help_text="Name of the budget item, e.g., 'Rent', 'Electricity Bill'.", max_length=100),
        ),
        migrations.AlterField(
            model_name='month',
            name='month_id',
            field=models.CharField(help_text='Unique identifier for the month in Westencontre-MM format.', max_length=7, primary_key=True, serialize=False),
        ),
    ]
