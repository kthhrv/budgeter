# models.py for a Django Budget Management Application

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
    bills_pot = models.BooleanField(
        default=False,
        help_text="If true, this item is considered part of the 'bills pot'."
    )
    groceries_pot = models.BooleanField(
        default=False,
        help_text="If true, this item is considered part of the 'groceries pot'."
    )
    is_tab_repayment = models.BooleanField(
        default=False,
        help_text="If true, each month's value is automatically added as a tab repayment."
    )
    is_extra = models.BooleanField(
        default=False,
        help_text="If true, contributions still cover this item but it is treated as a buffer/savings line — excluded from the joint Expenses total and reflected in Remaining."
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
                f"{' [Bills Pot]' if self.bills_pot else ''}"
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
