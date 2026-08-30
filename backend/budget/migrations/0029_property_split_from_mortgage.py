# Hand-written: splits Property out of Mortgage so one property can carry
# several loans (a split mortgage product, a further advance). Existing
# Mortgage rows become a Property (from their embedded value fields) with the
# row itself relabelled as the loan.

import uuid

import django.db.models.deletion
from django.db import migrations, models


def forwards(apps, schema_editor):
    Mortgage = apps.get_model('budget', 'Mortgage')
    Property = apps.get_model('budget', 'Property')
    for mortgage in Mortgage.objects.all():
        prop = Property.objects.create(
            name=mortgage.name or 'Home',
            value=mortgage.property_value,
            value_date=mortgage.property_value_date,
        )
        mortgage.property = prop
        mortgage.name = 'Mortgage'
        mortgage.save()


def backwards(apps, schema_editor):
    Mortgage = apps.get_model('budget', 'Mortgage')
    for mortgage in Mortgage.objects.select_related('property'):
        mortgage.property_value = mortgage.property.value
        mortgage.property_value_date = mortgage.property.value_date
        mortgage.name = mortgage.property.name
        mortgage.save()


class Migration(migrations.Migration):

    dependencies = [
        ('budget', '0028_fireaccount_monzo_pot_id_monzoconnection'),
    ]

    operations = [
        migrations.CreateModel(
            name='Property',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('name', models.CharField(default='Home', help_text='Display name for the property.', max_length=100)),
                ('value', models.DecimalField(decimal_places=2, help_text='Estimated current property value.', max_digits=12)),
                ('value_date', models.DateField(help_text='When the property value estimate was made.')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
            options={
                'verbose_name': 'Property',
                'verbose_name_plural': 'Properties',
                'ordering': ['name'],
            },
        ),
        migrations.AddField(
            model_name='mortgage',
            name='property',
            field=models.ForeignKey(
                help_text='The property this loan is secured on.',
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='mortgages',
                to='budget.property',
            ),
        ),
        migrations.RunPython(forwards, backwards),
        migrations.AlterField(
            model_name='mortgage',
            name='property',
            field=models.ForeignKey(
                help_text='The property this loan is secured on.',
                on_delete=django.db.models.deletion.CASCADE,
                related_name='mortgages',
                to='budget.property',
            ),
        ),
        migrations.RemoveField(model_name='mortgage', name='property_value'),
        migrations.RemoveField(model_name='mortgage', name='property_value_date'),
        migrations.AlterField(
            model_name='mortgage',
            name='name',
            field=models.CharField(default='Mortgage', help_text="Loan label, e.g. 'Part 1 (fixed to 2029)' or 'Further advance'.", max_length=100),
        ),
        migrations.AlterModelOptions(
            name='mortgage',
            options={'ordering': ['created_at'], 'verbose_name': 'Mortgage', 'verbose_name_plural': 'Mortgages'},
        ),
        # help_text-only updates (state parity with the model; no DB change)
        migrations.AlterField(
            model_name='mortgage',
            name='balance',
            field=models.DecimalField(decimal_places=2, help_text='Outstanding balance of this loan as of balance_date.', max_digits=12),
        ),
        migrations.AlterField(
            model_name='mortgage',
            name='monthly_payment',
            field=models.DecimalField(decimal_places=2, help_text='Monthly payment for this loan (capital + interest).', max_digits=10),
        ),
    ]
