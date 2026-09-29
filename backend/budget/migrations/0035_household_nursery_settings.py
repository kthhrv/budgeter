import json

from django.db import migrations

# The childcare calculator blob used to be stored per login, so each user saw
# (and edited) their own copy: whoever hadn't configured the calculators got an
# empty one, and the budget's linked Childcare line went with it. There is one
# household, so keep one row and drop the user key.
#
# Which row to keep: the calculator page writes defaults back on first open, so
# recency would happily pick a fresh, untouched copy over the configured one.
# Prefer rows with both children's settings, then the largest blob (a
# configured one carries ad-hoc entries, overrides and pattern history that a
# default one does not), then the most recently updated.


def keep_one_row(apps, schema_editor):
    NurserySettings = apps.get_model('budget', 'NurserySettings')
    rows = list(NurserySettings.objects.all())
    if len(rows) <= 1:
        return

    def rank(row):
        data = row.data or {}
        return (
            bool(data.get('ellis')) and bool(data.get('gaspard')),
            len(json.dumps(data, sort_keys=True)),
            row.updated_at,
        )

    keep = max(rows, key=rank)
    NurserySettings.objects.exclude(pk=keep.pk).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('budget', '0034_consolidate_childcare_links'),
    ]

    operations = [
        migrations.RunPython(keep_one_row, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name='nurserysettings',
            name='user',
        ),
    ]
