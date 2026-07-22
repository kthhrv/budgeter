from django.db import migrations, models


def copy_nursery_linked_to_target(apps, schema_editor):
    """Existing nursery-linked items point at Ellis's nursery TFC transfer."""
    BudgetItem = apps.get_model('budget', 'BudgetItem')
    BudgetItem.objects.filter(is_nursery_linked=True).update(childcare_link='ellis_nursery')


def reverse_target_to_nursery_linked(apps, schema_editor):
    BudgetItem = apps.get_model('budget', 'BudgetItem')
    BudgetItem.objects.exclude(childcare_link='').update(is_nursery_linked=True)


class Migration(migrations.Migration):

    dependencies = [
        ('budget', '0019_budgetitem_is_auto_extra'),
    ]

    operations = [
        migrations.AddField(
            model_name='budgetitem',
            name='childcare_link',
            field=models.CharField(
                blank=True,
                choices=[('', '—'), ('ellis_nursery', 'Ellis nursery'), ('gaspard_care', 'Gaspard care')],
                default='',
                help_text="If set, this item's monthly value is auto-synced from the Nursery cost "
                          "calculator: 'ellis_nursery' → Ellis's Transfer to TFC, 'gaspard_care' → "
                          "Gaspard's school-childcare net.",
                max_length=20,
            ),
        ),
        migrations.RunPython(copy_nursery_linked_to_target, reverse_target_to_nursery_linked),
        migrations.RemoveField(
            model_name='budgetitem',
            name='is_nursery_linked',
        ),
    ]
