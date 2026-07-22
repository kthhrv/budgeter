from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('budget', '0020_budgetitem_childcare_link'),
    ]

    operations = [
        migrations.AlterField(
            model_name='budgetitem',
            name='childcare_link',
            field=models.CharField(
                blank=True,
                choices=[
                    ('', '—'),
                    ('ellis_nursery', 'Ellis nursery'),
                    ('gaspard_care', 'Gaspard breakfast/after-school'),
                    ('gaspard_holiday', 'Gaspard holiday club'),
                ],
                default='',
                help_text="If set, this item's monthly value is auto-synced from the childcare "
                          "calculators: 'ellis_nursery' → Ellis's Transfer to TFC, 'gaspard_care' → "
                          "Gaspard's breakfast + after-school net, 'gaspard_holiday' → his holiday-club net.",
                max_length=20,
            ),
        ),
    ]
