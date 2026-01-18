# api.py for a Django Budget Management Application using django-ninja

from ninja import NinjaAPI, Schema
from ninja.security import django_auth
from django.shortcuts import get_object_or_404
from django.db import transaction
from typing import List, Optional
import datetime
import uuid
import calendar

from .models import Month, BudgetItem, BudgetItemVersion

api = NinjaAPI(auth=django_auth)

# --- Schemas ---

class UserSchema(Schema):
    username: str
    email: str
    first_name: str
    last_name: str

class MonthSchema(Schema):
    month_id: str
    month_name: str

class MonthInputSchema(Schema):
    month: str

class BudgetItemSchema(Schema):
    budget_item_id: uuid.UUID
    item_name: str
    item_type: str
    owner: str
    bills_pot: bool
    calculation_type: str
    weekly_payment_day: Optional[int] = None
    last_payment_month_id: Optional[str] = None

    @staticmethod
    def resolve_last_payment_month_id(obj):
        return obj.last_payment_month.month_id if obj.last_payment_month else None

class BudgetItemInputSchema(Schema):
    item_name: str
    item_type: str
    owner: str
    bills_pot: bool
    calculation_type: str
    weekly_payment_day: Optional[int] = None
    last_payment_month_id: Optional[str] = None
    value: float 
    is_one_off: bool = False

class BudgetItemEditSchema(Schema):
    item_name: Optional[str] = None
    item_type: Optional[str] = None
    owner: Optional[str] = None
    bills_pot: Optional[bool] = None
    calculation_type: Optional[str] = None
    weekly_payment_day: Optional[int] = None
    last_payment_month_id: Optional[str] = None

class BudgetItemVersionSchema(Schema):
    budget_item_id: uuid.UUID
    item_name: str
    item_type: str
    owner: str
    bills_pot: bool
    calculation_type: str
    weekly_payment_day: Optional[int] = None
    effective_value: float
    effective_from_month_name: str
    is_one_off: bool
    occurrences: Optional[int] = None

class BudgetItemVersionInputSchema(Schema):
    value: float
    is_one_off: bool = False

# --- Helper ---
def calculate_weekly_occurrences(year, month_num, day_of_week):
    count = 0
    cal = calendar.Calendar()
    for week in cal.monthdays2calendar(year, month_num):
        for day, weekday_num in week:
            if day != 0 and weekday_num + 1 == day_of_week:
                count += 1
    return count

# --- Endpoints ---

@api.post("/months/", response={200: MonthSchema, 400: dict})
def create_month(request, payload: MonthInputSchema):
    month_id = payload.month
    try:
        year, month_num = map(int, month_id.split('-'))
        if not (1 <= month_num <= 12):
            raise ValueError("Month must be between 01 and 12.")
    except (ValueError, AttributeError):
        return 400, {"detail": "Invalid month format. Expected YYYY-MM."}
    start_date = datetime.date(year, month_num, 1)
    _, last_day_of_month = calendar.monthrange(year, month_num)
    end_date = datetime.date(year, month_num, last_day_of_month)
    month_name = start_date.strftime("%B %Y")
    month, created = Month.objects.get_or_create(
        month_id=month_id,
        defaults={'month_name': month_name, 'start_date': start_date, 'end_date': end_date}
    )
    return month

@api.get("/auth/me", response=UserSchema)
def get_me(request):
    return request.user

@api.get("/months/", response=List[MonthSchema])
def list_all_months(request):
    return Month.objects.all().order_by('start_date')

@api.get("/months/{month_id}/items/", response=List[BudgetItemVersionSchema])
def list_budget_items_for_month(request, month_id: str):
    month_obj = get_object_or_404(Month, month_id=month_id)
    budget_items_data = []

    for budget_item in BudgetItem.objects.all():
        if budget_item.last_payment_month and month_obj.start_date > budget_item.last_payment_month.end_date:
            continue

        effective_version = None
        try:
            effective_version = BudgetItemVersion.objects.get(budget_item=budget_item, month=month_obj)
        except BudgetItemVersion.DoesNotExist:
            effective_version = BudgetItemVersion.objects.filter(
                budget_item=budget_item,
                effective_from_month__start_date__lte=month_obj.start_date,
                is_one_off=False
            ).order_by('-effective_from_month__start_date').first()

        if effective_version:
            calculated_value = float(effective_version.value)
            occurrences = None
            if budget_item.calculation_type == 'weekly_count' and budget_item.weekly_payment_day:
                occurrences = calculate_weekly_occurrences(month_obj.start_date.year, month_obj.start_date.month, budget_item.weekly_payment_day)
                calculated_value = float(effective_version.value) * occurrences
            
            budget_items_data.append(BudgetItemVersionSchema(
                budget_item_id=budget_item.budget_item_id, item_name=budget_item.item_name, item_type=budget_item.item_type,
                owner=budget_item.owner, bills_pot=budget_item.bills_pot,
                calculation_type=budget_item.calculation_type, weekly_payment_day=budget_item.weekly_payment_day,
                effective_value=calculated_value, effective_from_month_name=effective_version.effective_from_month.month_name,
                is_one_off=effective_version.is_one_off,
                occurrences=occurrences
            ))
    return budget_items_data

@api.put("/months/{month_id}/items/{budget_item_id}/value/", response={200: BudgetItemVersionSchema, 403: dict})
def set_budget_item_value_for_month(request, month_id: str, budget_item_id: uuid.UUID, payload: BudgetItemVersionInputSchema):
    month = get_object_or_404(Month, month_id=month_id)
    budget_item = get_object_or_404(BudgetItem, budget_item_id=budget_item_id)
    
    # Check if the month is in the past (before current month)
    current_date = datetime.date.today()
    current_month_start = datetime.date(current_date.year, current_date.month, 1)
    
    if month.start_date < current_month_start:
        return 403, {"detail": "Cannot edit budget items for previous months"}
    
    with transaction.atomic():
        budget_item_version, created = BudgetItemVersion.objects.update_or_create(
            budget_item=budget_item, month=month,
            defaults={'value': payload.value, 'effective_from_month': month, 'is_one_off': payload.is_one_off}
        )
    budget_item.refresh_from_db()
    calculated_value = float(budget_item_version.value)
    occurrences = None
    if budget_item.calculation_type == 'weekly_count' and budget_item.weekly_payment_day:
        occurrences = calculate_weekly_occurrences(month.start_date.year, month.start_date.month, budget_item.weekly_payment_day)
        calculated_value = float(budget_item_version.value) * occurrences
    return BudgetItemVersionSchema(
        budget_item_id=budget_item.budget_item_id, item_name=budget_item.item_name, item_type=budget_item.item_type,
        owner=budget_item.owner, bills_pot=budget_item.bills_pot,
        calculation_type=budget_item.calculation_type, weekly_payment_day=budget_item.weekly_payment_day,
        effective_value=calculated_value, effective_from_month_name=budget_item_version.effective_from_month.month_name,
        is_one_off=budget_item_version.is_one_off,
        occurrences=occurrences
    )

@api.delete("/months/{month_id}/items/{budget_item_id}/", response={204: None, 403: dict})
def delete_budget_item_from_month(request, month_id: str, budget_item_id: uuid.UUID):
    current_month = get_object_or_404(Month, month_id=month_id)
    budget_item = get_object_or_404(BudgetItem, budget_item_id=budget_item_id)
    
    # Check if the month is in the past (before current month)
    current_date = datetime.date.today()
    current_month_start = datetime.date(current_date.year, current_date.month, 1)
    
    if current_month.start_date < current_month_start:
        return 403, {"detail": "Cannot delete budget items for previous months"}

    # Calculate the previous month's date and ID
    prev_month_date = current_month.start_date - datetime.timedelta(days=1)
    prev_month_id = prev_month_date.strftime("%Y-%m")
    
    # Ensure the previous month exists in the database.
    year, month_num = map(int, prev_month_id.split('-'))
    start_date = datetime.date(year, month_num, 1)
    _, last_day_of_month = calendar.monthrange(year, month_num)
    end_date = datetime.date(year, month_num, last_day_of_month)
    month_name = start_date.strftime("%B %Y")

    previous_month, created = Month.objects.get_or_create(
        month_id=prev_month_id,
        defaults={
            'month_name': month_name,
            'start_date': start_date,
            'end_date': end_date
        }
    )

    # Set the last payment month to the previous month
    budget_item.last_payment_month = previous_month
    budget_item.save()

    return 204, None


@api.post("/months/{month_id}/budgetitems/", response=BudgetItemSchema)
def create_budget_item(request, month_id: str, payload: BudgetItemInputSchema):
    month = get_object_or_404(Month, month_id=month_id)
    
    with transaction.atomic():
        budget_item_data = payload.dict(exclude={'value', 'is_one_off', 'last_payment_month_id'})
        if payload.last_payment_month_id:
            budget_item_data['last_payment_month'] = get_object_or_404(Month, month_id=payload.last_payment_month_id)
        if budget_item_data.get('calculation_type') != 'weekly_count':
            budget_item_data['weekly_payment_day'] = None
        
        budget_item = BudgetItem.objects.create(**budget_item_data)
        
        BudgetItemVersion.objects.create(
            budget_item=budget_item, month=month, effective_from_month=month,
            value=payload.value, is_one_off=payload.is_one_off
        )
    return budget_item

@api.get("/budgetitems/", response=List[BudgetItemSchema])
def list_all_budget_items(request):
    return BudgetItem.objects.all()

@api.put("/budgetitems/{budget_item_id}/", response=BudgetItemSchema)
def edit_budget_item(request, budget_item_id: uuid.UUID, payload: BudgetItemEditSchema):
    budget_item = get_object_or_404(BudgetItem, budget_item_id=budget_item_id)
    update_data = payload.dict(exclude_unset=True)

    if 'last_payment_month_id' in update_data:
        month_id = update_data.pop('last_payment_month_id')
        budget_item.last_payment_month = get_object_or_404(Month, month_id=month_id) if month_id else None
    
    new_calc_type = update_data.get('calculation_type', budget_item.calculation_type)
    
    if new_calc_type != 'weekly_count':
        update_data['weekly_payment_day'] = None
    elif 'weekly_payment_day' in update_data and new_calc_type == 'weekly_count':
        # Allow setting weekly_payment_day if we are currently or becoming weekly_count
        pass
    elif 'calculation_type' in update_data and update_data['calculation_type'] == 'weekly_count' and not budget_item.weekly_payment_day and 'weekly_payment_day' not in update_data:
        # If switching to weekly but no day provided, we might want a default or just leave it None/handled by Schema
        pass

    for attr, value in update_data.items():
        setattr(budget_item, attr, value)
    budget_item.save()
    return budget_item

