import datetime

from django.db import migrations

# Skinners' Kent Primary School 2026/27 half-terms (skps.org.uk/793/term-dates),
# the same source as SCHOOL_TERMS in frontend/src/utils/childcareCalc.js — keep
# the two in step. One row per HALF-term because that's the billing cycle for
# school clubs: a 'per_term' item's bill lands in the month a row starts
# (timing 'start') or ends ('end'). Start/end are the first/last school days.
TERMS = [
    ("Autumn 1 2026", datetime.date(2026, 9, 3), datetime.date(2026, 10, 16)),
    ("Autumn 2 2026", datetime.date(2026, 11, 2), datetime.date(2026, 12, 18)),
    ("Spring 1 2027", datetime.date(2027, 1, 5), datetime.date(2027, 2, 12)),
    ("Spring 2 2027", datetime.date(2027, 2, 22), datetime.date(2027, 3, 25)),
    ("Summer 1 2027", datetime.date(2027, 4, 12), datetime.date(2027, 5, 28)),
    ("Summer 2 2027", datetime.date(2027, 6, 8), datetime.date(2027, 7, 19)),
]


def seed_terms(apps, schema_editor):
    SchoolTerm = apps.get_model("budget", "SchoolTerm")
    for name, start, end in TERMS:
        SchoolTerm.objects.get_or_create(name=name, defaults={"start_date": start, "end_date": end})


def unseed_terms(apps, schema_editor):
    SchoolTerm = apps.get_model("budget", "SchoolTerm")
    SchoolTerm.objects.filter(name__in=[t[0] for t in TERMS]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("budget", "0031_schoolterm_budgetitem_term_payment_timing_and_more"),
    ]

    operations = [
        migrations.RunPython(seed_terms, unseed_terms),
    ]
