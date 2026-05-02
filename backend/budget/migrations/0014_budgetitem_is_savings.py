from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('budget', '0013_budgetitem_is_extra'),
    ]

    operations = [
        migrations.AddField(
            model_name='budgetitem',
            name='is_savings',
            field=models.BooleanField(default=False, help_text="If true, this personal expense is treated as savings — shown as its own line on the owner's card but still subtracted from Remaining."),
        ),
    ]
