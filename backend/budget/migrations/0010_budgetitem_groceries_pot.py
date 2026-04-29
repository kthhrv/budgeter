from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('budget', '0009_remove_budgetitem_description_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='budgetitem',
            name='groceries_pot',
            field=models.BooleanField(default=False, help_text="If true, this item is considered part of the 'groceries pot'."),
        ),
    ]
