from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('budget', '0018_budgetitem_is_nursery_linked'),
    ]

    operations = [
        migrations.AddField(
            model_name='budgetitem',
            name='is_auto_extra',
            field=models.BooleanField(default=False, help_text="If true, this Extra item's value auto-balances each month so the joint Remaining stays at the stored value (treated as the target buffer)."),
        ),
    ]
