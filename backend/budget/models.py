# models.py for a Django Budget Management Application

from django.conf import settings
from django.db import models
import uuid

class Month(models.Model):
    """
    Represents a specific month for which a budget is defined.
    Each month has a unique ID (YYYY-MM format), a descriptive name, and start/end dates.
    """
    month_id = models.CharField(
        primary_key=True,
        max_length=7, # e.g., "2025-01"
        help_text="Unique identifier for the month in YYYY-MM format."
    )
    month_name = models.CharField(
        max_length=50,
        unique=True,  # Ensure month names like "January 2025" are unique
        help_text="Name of the month, e.g., 'January 2025'."
    )
    start_date = models.DateField(
        help_text="The first day of the month."
    )
    end_date = models.DateField(
        help_text="The last day of the month."
    )

    class Meta:
        verbose_name = "Month"
        verbose_name_plural = "Months"
        ordering = ['start_date'] # Order months chronologically

    def __str__(self):
        return self.month_name

class BudgetItem(models.Model):
    """
    Represents a general category of a budget item, such as 'Rent', 'Groceries', or 'Salary'.
    These items can be expenses or income.
    Includes an 'owner' field to specify who is responsible for the item,
    and fields for weekly calculation logic.
    """
    ITEM_TYPE_CHOICES = [
        ('expense', 'Expense'),
        ('income', 'Income'),
        ('savings', 'Savings'),
    ]

    OWNER_CHOICES = [
        ('shared', 'Shared'),
        ('keith', 'Keith'),
        ('tild', 'Tild'),
    ]

    CALCULATION_TYPE_CHOICES = [
        ('fixed', 'Fixed Monthly Value'),
        ('weekly_count', 'Weekly Value by Occurrence Count'),
    ]

    EXPENSE_POT_CHOICES = [
        ('bills', 'Bills Pot'),
        ('groceries', 'Groceries Pot'),
    ]

    CATEGORY_CHOICES = [
        ('house', 'House'),
        ('groceries', 'Groceries'),
        ('subscriptions', 'Subscriptions'),
        ('car', 'Car'),
        ('children', 'Children'),
    ]

    budget_item_id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
        help_text="Unique identifier for the budget item."
    )
    item_name = models.CharField(
        max_length=100,
        help_text="Name of the budget item, e.g., 'Rent', 'Electricity Bill'."
    )
    item_type = models.CharField(
        max_length=10,
        choices=ITEM_TYPE_CHOICES,
        default='expense',
        help_text="Type of the item: 'expense' or 'income'."
    )
    owner = models.CharField(
        max_length=50,
        choices=OWNER_CHOICES,
        default='shared', # Default owner set to 'shared'
        help_text="The owner or responsible party for this budget item."
    )
    expense_pot = models.CharField(
        max_length=20,
        choices=EXPENSE_POT_CHOICES,
        blank=True,
        default='',
        help_text="Optional sub-classification for an expense: bills pot or groceries pot."
    )
    category = models.CharField(
        max_length=20,
        choices=CATEGORY_CHOICES,
        blank=True,
        default='',
        help_text="Optional bill category used to group expenses on the budget page."
    )
    is_tab_repayment = models.BooleanField(
        default=False,
        help_text="If true, each month's value is automatically added as a tab repayment."
    )
    is_extra = models.BooleanField(
        default=False,
        help_text="If true, contributions still cover this item but it is treated as a buffer/savings line — excluded from the joint Expenses total and reflected in Remaining."
    )
    CHILDCARE_LINK_CHOICES = [
        ('', '—'),
        ('ellis_nursery', 'Ellis nursery'),
        ('gaspard_care', 'Gaspard breakfast/after-school'),
        ('gaspard_holiday', 'Gaspard holiday club'),
    ]
    childcare_link = models.CharField(
        max_length=20,
        choices=CHILDCARE_LINK_CHOICES,
        blank=True,
        default='',
        help_text="If set, this item's monthly value is auto-synced from the childcare "
                  "calculators: 'ellis_nursery' → Ellis's Transfer to TFC, 'gaspard_care' → "
                  "Gaspard's breakfast + after-school net, 'gaspard_holiday' → his holiday-club net."
    )
    is_auto_extra = models.BooleanField(
        default=False,
        help_text="If true, this Extra item's value auto-balances each month so the joint Remaining stays at the stored value (treated as the target buffer)."
    )
    calculation_type = models.CharField(
        max_length=20,
        choices=CALCULATION_TYPE_CHOICES,
        default='fixed',
        help_text="Defines how the item's monthly value is calculated."
    )
    weekly_payment_day = models.IntegerField(
        null=True,
        blank=True,
        help_text="Day of the week for weekly_count items (1=Mon, ..., 7=Sun). Only relevant if Calculation Type is 'Weekly Value by Occurrence Count'."
    )
    # This field sets the last month an item is active.
    last_payment_month = models.ForeignKey(
        Month,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='terminating_items',
        help_text="Optional: The last month this item will be active. It will not appear in subsequent months."
    )


    class Meta:
        verbose_name = "Budget Item"
        verbose_name_plural = "Budget Items"
        ordering = ['item_name']

    def __str__(self):
        return (f"{self.item_name} ({self.get_item_type_display()}) - Owner: {self.get_owner_display()}"
                f"{f' [{self.get_expense_pot_display()}]' if self.expense_pot else ''}"
                f"{f' (Calc: {self.get_calculation_type_display()})' if self.calculation_type != 'fixed' else ''}")

class BudgetItemVersion(models.Model):
    """
    Represents a specific version of a budget item's value for a given month.
    This model is crucial for the versioning and rollover logic.
    A new record is created only when the value of a budget item changes for a month,
    or when it's initially set. The 'effective_from_month' determines when this value
    becomes active.
    """
    budget_item_version_id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
        help_text="Unique identifier for this specific version of a budget item."
    )
    budget_item = models.ForeignKey(
        BudgetItem,
        on_delete=models.CASCADE,
        related_name='versions',
        help_text="The budget item this version belongs to."
    )
    month = models.ForeignKey(
        Month,
        on_delete=models.CASCADE,
        related_name='budget_item_versions',
        help_text="The month for which this specific value was set/recorded."
    )
    value = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        help_text="The budgeted amount for this item for this month/version. "
                  "For 'weekly_count' items, this is the weekly value."
    )
    effective_from_month = models.ForeignKey(
        Month,
        on_delete=models.CASCADE,
        related_name='effective_budget_item_versions',
        help_text="The month from which this budget item's value becomes effective. "
                  "This is key for the rollover logic."
    )
    created_at = models.DateTimeField(
        auto_now_add=True,
        help_text="Timestamp when this budget item version was created."
    )
    is_one_off = models.BooleanField(
        default=False,
        help_text="If true, this version is a one-off and does not roll over to future months."
    )

    class Meta:
        verbose_name = "Budget Item Version"
        verbose_name_plural = "Budget Item Versions"
        unique_together = ('budget_item', 'month')
        ordering = ['budget_item__item_name', 'month__start_date']

    def __str__(self):
        return (f"{self.budget_item.item_name} (Value: {self.value}) "
                f"for {self.month.month_name} (Effective from: {self.effective_from_month.month_name})"
                f"{' (One-off)' if self.is_one_off else ''}")


class TabItem(models.Model):
    """
    Something one person paid for that the other person owes a share of.
    """
    PAID_BY_CHOICES = [
        ('keith', 'Keith'),
        ('tild', 'Tild'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    description = models.CharField(max_length=200, help_text="What was purchased.")
    paid_by = models.CharField(max_length=50, choices=PAID_BY_CHOICES, help_text="Who paid for it.")
    total_cost = models.DecimalField(max_digits=10, decimal_places=2, help_text="Total cost of the item.")
    amount_owed = models.DecimalField(max_digits=10, decimal_places=2, help_text="How much the other person owes (defaults to 50% but can be overridden).")
    date_added = models.DateField(help_text="When the expense occurred.")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Tab Item"
        verbose_name_plural = "Tab Items"
        ordering = ['-date_added']

    def __str__(self):
        return f"{self.description} - £{self.total_cost} (paid by {self.paid_by})"


class TabRepayment(models.Model):
    """
    A repayment towards the running tab balance.
    """
    PAID_BY_CHOICES = [
        ('keith', 'Keith'),
        ('tild', 'Tild'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    amount = models.DecimalField(max_digits=10, decimal_places=2, help_text="Amount repaid.")
    paid_by = models.CharField(max_length=50, choices=PAID_BY_CHOICES, help_text="Who made the repayment.")
    date = models.DateField(help_text="When the repayment was made.")
    note = models.CharField(max_length=200, blank=True, default='', help_text="Optional note.")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Tab Repayment"
        verbose_name_plural = "Tab Repayments"
        ordering = ['-date']

    def __str__(self):
        return f"£{self.amount} by {self.paid_by} on {self.date}"


class FireAccount(models.Model):
    """
    A pot of wealth tracked for the FIRE calculator: a pension, ISA, cash
    savings account or general investment account. Balances live in
    BalanceSnapshot rows so history is preserved and corrections are just
    newer entries.
    """
    OWNER_CHOICES = [
        ('shared', 'Shared'),
        ('keith', 'Keith'),
        ('tild', 'Tild'),
    ]

    KIND_CHOICES = [
        ('pension', 'Pension'),
        ('isa', 'ISA'),
        ('cash', 'Cash savings'),
        ('gia', 'General investment'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, help_text="Display name, e.g. 'Royal London pension'.")
    owner = models.CharField(
        max_length=50,
        choices=OWNER_CHOICES,
        help_text="Whose wealth this is — drives the per-person vs joint FIRE views."
    )
    kind = models.CharField(
        max_length=20,
        choices=KIND_CHOICES,
        help_text="Pension wealth is locked until pension access age; the other kinds are "
                  "accessible and can bridge an early retirement."
    )
    provider = models.CharField(max_length=100, blank=True, default='', help_text="Optional provider name, e.g. 'Monzo'.")
    monzo_pot_id = models.CharField(
        max_length=100, blank=True, default='',
        help_text="If set, 'Sync from Monzo' writes this pot's balance as a snapshot on this account."
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "FIRE Account"
        verbose_name_plural = "FIRE Accounts"
        ordering = ['owner', 'name']

    def __str__(self):
        return f"{self.name} ({self.get_kind_display()}, {self.get_owner_display()})"


class BalanceSnapshot(models.Model):
    """
    The balance of a FireAccount on a given date. One row per account per
    date — re-entering the same date corrects it in place, while a new date
    supersedes older entries (latest date wins as the current balance).
    """
    SOURCE_CHOICES = [
        ('manual', 'Manual'),
        ('monzo', 'Monzo sync'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.ForeignKey(FireAccount, on_delete=models.CASCADE, related_name='snapshots')
    date = models.DateField(help_text="The date this balance was observed.")
    balance = models.DecimalField(max_digits=12, decimal_places=2, help_text="Balance on that date.")
    source = models.CharField(max_length=10, choices=SOURCE_CHOICES, default='manual')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Balance Snapshot"
        verbose_name_plural = "Balance Snapshots"
        unique_together = ('account', 'date')
        ordering = ['-date']

    def __str__(self):
        return f"{self.account.name}: £{self.balance} on {self.date}"


class EarningsVersion(models.Model):
    """
    A person's gross salary and pension contribution terms, effective from a
    date. Like BudgetItemVersion, a change is a new row with a later
    effective_from — the most recent row on or before a date is the one in
    force, so history is preserved for past-accuracy and future rows can
    pre-record a known pay change.
    """
    OWNER_CHOICES = [
        ('keith', 'Keith'),
        ('tild', 'Tild'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.CharField(max_length=50, choices=OWNER_CHOICES)
    effective_from = models.DateField(help_text="The date these terms start applying from.")
    gross_annual_salary = models.DecimalField(max_digits=12, decimal_places=2, help_text="Gross annual salary before any salary sacrifice.")
    employee_pension_pct = models.DecimalField(
        max_digits=5, decimal_places=2, default=0,
        help_text="Employee pension contribution as % of gross salary."
    )
    employee_pension_is_salary_sacrifice = models.BooleanField(
        default=True,
        help_text="If true, the employee contribution is salary-sacrificed (reduces taxable gross)."
    )
    employer_pension_pct = models.DecimalField(
        max_digits=5, decimal_places=2, default=0,
        help_text="Employer pension contribution as % of gross salary."
    )
    note = models.CharField(max_length=200, blank=True, default='', help_text="Optional note, e.g. 'promotion'.")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Earnings Version"
        verbose_name_plural = "Earnings Versions"
        unique_together = ('owner', 'effective_from')
        ordering = ['-effective_from']

    def __str__(self):
        return f"{self.get_owner_display()}: £{self.gross_annual_salary} from {self.effective_from}"


class Property(models.Model):
    """
    A property whose equity feeds the FIRE mortgage view. One property can
    carry several Mortgage loans (a mortgage split into fixed-rate parts, a
    further advance) — equity and LTV are computed against their combined
    balance.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, default='Home', help_text="Display name for the property.")
    value = models.DecimalField(max_digits=12, decimal_places=2, help_text="Estimated current property value.")
    value_date = models.DateField(help_text="When the property value estimate was made.")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Property"
        verbose_name_plural = "Properties"
        ordering = ['name']

    def __str__(self):
        return f"{self.name}: £{self.value}"


class Mortgage(models.Model):
    """
    One loan secured on a Property — a whole mortgage, or one part of a
    split product with its own rate and payment. The balance is a stated
    figure with a date, projected forward by amortisation — correct it by
    updating balance + balance_date whenever a statement arrives.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    property = models.ForeignKey(
        Property, on_delete=models.CASCADE, related_name='mortgages',
        help_text="The property this loan is secured on."
    )
    name = models.CharField(max_length=100, default='Mortgage', help_text="Loan label, e.g. 'Part 1 (fixed to 2029)' or 'Further advance'.")
    balance = models.DecimalField(max_digits=12, decimal_places=2, help_text="Outstanding balance of this loan as of balance_date.")
    balance_date = models.DateField(help_text="The date the stated balance was correct.")
    interest_rate_pct = models.DecimalField(max_digits=5, decimal_places=2, help_text="Annual interest rate %.")
    monthly_payment = models.DecimalField(max_digits=10, decimal_places=2, help_text="Monthly payment for this loan (capital + interest).")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Mortgage"
        verbose_name_plural = "Mortgages"
        ordering = ['created_at']

    def __str__(self):
        return f"{self.name}: £{self.balance} @ {self.interest_rate_pct}%"


class FireSettings(models.Model):
    """
    Per-person FIRE assumptions, keyed by owner (not by login) because the
    joint projection needs both people's assumptions regardless of who is
    looking at it. All rates are in today's money — expected return should be
    a real (after-inflation) figure.
    """
    OWNER_CHOICES = [
        ('keith', 'Keith'),
        ('tild', 'Tild'),
    ]

    owner = models.CharField(max_length=50, choices=OWNER_CHOICES, primary_key=True)
    date_of_birth = models.DateField(null=True, blank=True, help_text="Used to convert projection dates to ages and pick the pension access age.")
    expected_real_return_pct = models.DecimalField(
        max_digits=5, decimal_places=2, default=3.5,
        help_text="Expected annual investment return AFTER inflation, %."
    )
    safe_withdrawal_rate_pct = models.DecimalField(
        max_digits=5, decimal_places=2, default=4.0,
        help_text="Withdrawal rate defining the FI number (annual spending ÷ this %)."
    )
    target_retirement_age = models.IntegerField(null=True, blank=True, help_text="Optional target age, used for the Coast FIRE number.")
    pension_access_age = models.IntegerField(
        default=57,
        help_text="Age pension wealth unlocks. 57 from April 2028 (Finance Act 2021); "
                  "set 58 to anticipate the expected-but-unlegislated rise alongside state pension age 68."
    )
    include_state_pension = models.BooleanField(
        default=True,
        help_text="If true, the full new state pension is added to retirement income from state pension age."
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "FIRE Settings"
        verbose_name_plural = "FIRE Settings"

    def __str__(self):
        return f"FIRE settings for {self.get_owner_display()}"


class MonzoConnection(models.Model):
    """
    Per-user Monzo OAuth tokens for the FIRE tab's pot sync. Tokens live only
    in the volume-mounted SQLite database (never the repo — it's public); the
    client id/secret come from envars like every other secret. The client must
    be registered as *confidential* at developers.monzo.com or Monzo won't
    issue a refresh token and the connection dies when the access token does.
    """
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="monzo_connection",
    )
    access_token = models.TextField()
    refresh_token = models.TextField(blank=True, default='')
    monzo_user_id = models.CharField(max_length=100, blank=True, default='')
    token_expires_at = models.DateTimeField(null=True, blank=True)
    last_synced_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Monzo Connection"
        verbose_name_plural = "Monzo Connections"

    def __str__(self):
        return f"Monzo connection for {self.user}"


class NurserySettings(models.Model):
    """Per-user nursery calculator state (stored as a single JSON blob)."""
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="nursery_settings",
    )
    data = models.JSONField(default=dict, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Nursery Settings"
        verbose_name_plural = "Nursery Settings"

    def __str__(self):
        return f"Nursery settings for {self.user}"
