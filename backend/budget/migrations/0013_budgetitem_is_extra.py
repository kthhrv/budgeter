from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('budget', '0012_budgetitem_is_tab_repayment'),
    ]

    operations = [
        migrations.AddField(
            model_name='budgetitem',
            name='is_extra',
            field=models.BooleanField(default=False, help_text='If true, contributions still cover this item but it is treated as a buffer/savings line — excluded from the joint Expenses total and reflected in Remaining.'),
        ),
    ]
