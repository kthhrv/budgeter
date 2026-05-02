# api.py for a Django Budget Management Application using django-ninja

from ninja import NinjaAPI, Schema
from ninja.security import django_auth
from django.shortcuts import get_object_or_404
from django.db import transaction
from typing import List, Optional
import datetime
import uuid
import calendar

from .models import Month, BudgetItem, BudgetItemVersion, TabItem, TabRepayment
from django.middleware.csrf import get_token

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
    groceries_pot: bool
    is_tab_repayment: bool
    is_extra: bool
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
    groceries_pot: bool
    is_tab_repayment: bool = False
    is_extra: bool = False
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
    groceries_pot: Optional[bool] = None
    is_tab_repayment: Optional[bool] = None
    is_extra: Optional[bool] = None
    calculation_type: Optional[str] = None
    weekly_payment_day: Optional[int] = None
    last_payment_month_id: Optional[str] = None

class BudgetItemVersionSchema(Schema):
    budget_item_id: uuid.UUID
    item_name: str
    item_type: str
    owner: str
    bills_pot: bool
    groceries_pot: bool
    is_tab_repayment: bool
    is_extra: bool
    calculation_type: str
    weekly_payment_day: Optional[int] = None
    value: float
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
    get_token(request) # Ensure CSRF cookie is set
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
                owner=budget_item.owner, bills_pot=budget_item.bills_pot, groceries_pot=budget_item.groceries_pot, is_tab_repayment=budget_item.is_tab_repayment,
                is_extra=budget_item.is_extra,
                calculation_type=budget_item.calculation_type, weekly_payment_day=budget_item.weekly_payment_day,
                value=float(effective_version.value),
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
        owner=budget_item.owner, bills_pot=budget_item.bills_pot, groceries_pot=budget_item.groceries_pot, is_tab_repayment=budget_item.is_tab_repayment,
        is_extra=budget_item.is_extra,
        calculation_type=budget_item.calculation_type, weekly_payment_day=budget_item.weekly_payment_day,
        value=float(budget_item_version.value),
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


# --- Tab Schemas ---

class TabItemSchema(Schema):
    id: uuid.UUID
    description: str
    paid_by: str
    total_cost: float
    amount_owed: float
    date_added: str

    @staticmethod
    def resolve_date_added(obj):
        return obj.date_added.isoformat()

class TabItemInputSchema(Schema):
    description: str
    paid_by: str
    total_cost: float
    amount_owed: float
    date_added: str

class TabRepaymentSchema(Schema):
    id: str
    amount: float
    paid_by: str
    date: str
    note: str
    is_auto: bool = False

class TabRepaymentInputSchema(Schema):
    amount: float
    paid_by: str
    date: str
    note: str = ''

class TabSummarySchema(Schema):
    items: List[TabItemSchema]
    repayments: List[TabRepaymentSchema]
    total_owed_to_keith: float
    total_owed_to_tild: float
    total_repaid_by_keith: float
    total_repaid_by_tild: float
    net_balance: float
    net_description: str


# --- Tab Endpoints ---

@api.get("/tabs/", response=TabSummarySchema)
def get_tabs(request):
    items = TabItem.objects.all()
    manual_repayments = TabRepayment.objects.all()

    # Build repayment list: manual + auto from budget items flagged is_tab_repayment
    repayments_list = []
    for r in manual_repayments:
        repayments_list.append({
            'id': str(r.id), 'amount': float(r.amount), 'paid_by': r.paid_by,
            'date': r.date.isoformat(), 'note': r.note, 'is_auto': False,
        })

    # Auto-repayments: for each budget item with is_tab_repayment, compute effective value per month
    auto_items = BudgetItem.objects.filter(is_tab_repayment=True)
    all_months = Month.objects.all().order_by('start_date')
    for bi in auto_items:
        for month_obj in all_months:
            if bi.last_payment_month and month_obj.start_date > bi.last_payment_month.end_date:
                continue
            # Same rollover logic as list_budget_items_for_month
            effective_version = None
            try:
                effective_version = BudgetItemVersion.objects.get(budget_item=bi, month=month_obj)
            except BudgetItemVersion.DoesNotExist:
                effective_version = BudgetItemVersion.objects.filter(
                    budget_item=bi,
                    effective_from_month__start_date__lte=month_obj.start_date,
                    is_one_off=False
                ).order_by('-effective_from_month__start_date').first()
            if not effective_version:
                continue
            calc_value = float(effective_version.value)
            if bi.calculation_type == 'weekly_count' and bi.weekly_payment_day:
                calc_value *= calculate_weekly_occurrences(
                    month_obj.start_date.year, month_obj.start_date.month, bi.weekly_payment_day
                )
            repayments_list.append({
                'id': f'auto-{bi.budget_item_id}-{month_obj.month_id}',
                'amount': calc_value,
                'paid_by': bi.owner,
                'date': month_obj.start_date.isoformat(),
                'note': f'{bi.item_name} ({month_obj.month_name})',
                'is_auto': True,
            })

    total_owed_to_keith = sum(float(i.amount_owed) for i in items if i.paid_by == 'keith')
    total_owed_to_tild = sum(float(i.amount_owed) for i in items if i.paid_by == 'tild')
    total_repaid_by_keith = sum(r['amount'] for r in repayments_list if r['paid_by'] == 'keith')
    total_repaid_by_tild = sum(r['amount'] for r in repayments_list if r['paid_by'] == 'tild')

    # Positive = Keith owes Tild, Negative = Tild owes Keith
    net_balance = (total_owed_to_tild - total_repaid_by_keith) - (total_owed_to_keith - total_repaid_by_tild)

    if net_balance > 0:
        net_description = f'Keith owes Tild £{abs(net_balance):.2f}'
    elif net_balance < 0:
        net_description = f'Tild owes Keith £{abs(net_balance):.2f}'
    else:
        net_description = 'All settled up!'

    # Sort repayments by date
    repayments_list.sort(key=lambda r: r['date'], reverse=True)

    return {
        "items": list(items),
        "repayments": repayments_list,
        "total_owed_to_keith": total_owed_to_keith,
        "total_owed_to_tild": total_owed_to_tild,
        "total_repaid_by_keith": total_repaid_by_keith,
        "total_repaid_by_tild": total_repaid_by_tild,
        "net_balance": net_balance,
        "net_description": net_description,
    }

@api.post("/tabs/items/", response=TabItemSchema)
def create_tab_item(request, payload: TabItemInputSchema):
    return TabItem.objects.create(
        description=payload.description,
        paid_by=payload.paid_by,
        total_cost=payload.total_cost,
        amount_owed=payload.amount_owed,
        date_added=datetime.date.fromisoformat(payload.date_added),
    )

@api.delete("/tabs/items/{item_id}/", response={204: None})
def delete_tab_item(request, item_id: uuid.UUID):
    item = get_object_or_404(TabItem, id=item_id)
    item.delete()
    return 204, None

@api.post("/tabs/repayments/", response=TabRepaymentSchema)
def create_tab_repayment(request, payload: TabRepaymentInputSchema):
    r = TabRepayment.objects.create(
        amount=payload.amount,
        paid_by=payload.paid_by,
        date=datetime.date.fromisoformat(payload.date),
        note=payload.note,
    )
    return {'id': str(r.id), 'amount': float(r.amount), 'paid_by': r.paid_by, 'date': r.date.isoformat(), 'note': r.note, 'is_auto': False}

@api.delete("/tabs/repayments/{repayment_id}/", response={204: None})
def delete_tab_repayment(request, repayment_id: uuid.UUID):
    repayment = get_object_or_404(TabRepayment, id=repayment_id)
    repayment.delete()
    return 204, None
