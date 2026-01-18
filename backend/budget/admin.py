# admin.py for a Django Budget Management Application

from django.contrib import admin
from .models import Month, BudgetItem, BudgetItemVersion

class BudgetItemVersionInline(admin.TabularInline):
    """
    Inline admin for BudgetItemVersion to be displayed within the Month admin.
    This allows managing budget item versions directly from the Month detail page.
    """
    model = BudgetItemVersion
    extra = 0 # Do not show extra empty forms by default
    fields = ('budget_item', 'value', 'effective_from_month', 'is_one_off')
    readonly_fields = ('created_at',) # created_at should not be editable here either
    # Specify the foreign key field name that links BudgetItemVersion to Month
    fk_name = 'month'
    # If you want to enable raw ID fields for the foreign keys within the inline:
    # raw_id_fields = ('budget_item', 'effective_from_month',)

@admin.register(Month)
class MonthAdmin(admin.ModelAdmin):
    """
    Admin configuration for the Month model.
    Displays month name, start date, and end date in the list view.
    Allows searching by month name.
    Includes BudgetItemVersionInline to view/edit items associated with the month.
    """
    list_display = ('month_id', 'month_name', 'start_date', 'end_date')
    search_fields = ('month_id', 'month_name',)
    list_filter = ('start_date',)
    inlines = [BudgetItemVersionInline]

@admin.register(BudgetItem)
class BudgetItemAdmin(admin.ModelAdmin):
    """
    Admin configuration for the BudgetItem model.
    Displays item name, type, description, owner, and bills_pot in the list view.
    Allows searching by item name and filtering by item type, owner, and bills_pot.
    """
    list_display = ('item_name', 'item_type', 'owner', 'bills_pot', 'budget_item_id') # Added 'bills_pot'
    search_fields = ('item_name', 'owner',)
    list_filter = ('item_type', 'owner', 'bills_pot',) # Added 'bills_pot' to list filters
    readonly_fields = ('budget_item_id',) # budget_item_id is UUIDField and should not be editable

@admin.register(BudgetItemVersion)
class BudgetItemVersionAdmin(admin.ModelAdmin):
    """
    Admin configuration for the BudgetItemVersion model.
    Displays related budget item, month, value, effective from month, creation timestamp, and is_one_off.
    Allows filtering by budget item, month, effective from month, and is_one_off.
    """
    list_display = (
        'budget_item',
        'month',
        'value',
        'effective_from_month',
        'is_one_off',
        'created_at',
        'budget_item_version_id'
    )
    list_filter = (
        'budget_item',
        'month',
        'effective_from_month',
        'is_one_off',
        'created_at'
    )
    search_fields = (
        'budget_item__item_name',
        'month__month_name'
    )
    readonly_fields = ('budget_item_version_id', 'created_at',)
    # raw_id_fields = ('budget_item', 'month', 'effective_from_month',)


