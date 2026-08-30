# api.py for a Django Budget Management Application using django-ninja

from ninja import NinjaAPI, Schema
from ninja.security import django_auth
from django.shortcuts import get_object_or_404
from django.db import transaction
from typing import List, Optional
import datetime
import uuid
import calendar
import os

from .models import (
    Month, BudgetItem, BudgetItemVersion, TabItem, TabRepayment, NurserySettings,
    FireAccount, BalanceSnapshot, EarningsVersion, Mortgage, FireSettings,
)
from django.db.models import Prefetch
from django.middleware.csrf import get_token

api = NinjaAPI(auth=django_auth)


# auth=None is REQUIRED: the deploy pipeline polls this unauthenticated to
# decide whether a release is healthy or must be rolled back. Inheriting the
# API-wide django_auth would return 401 and fail every deploy.
@api.get("/health", auth=None, response={200: dict, 503: dict})
def health(request):
    # `os.environ.get("GIT_SHA") or "unknown"`, NOT the two-arg form: the
    # Dockerfile's `ARG GIT_SHA` / `ENV GIT_SHA=${GIT_SHA}` bakes an EMPTY
    # STRING into the image (not an absent var) when a build omits
    # --build-arg, and .get(key, default) only substitutes on a missing key.
    sha = os.environ.get("GIT_SHA") or "unknown"
    try:
        # BudgetItem.objects.first() is the probe, deliberately not
        # .exists(): .exists() compiles to `SELECT 1`, which is satisfied by
        # any schema at all, while .first() SELECTs every column the model
        # declares — a removed/renamed column (see ee4ce43's bare
        # RemoveField) raises here instead of only on a real user request.
        BudgetItem.objects.first()
    except Exception as e:
        # Broad by design: this endpoint's job is to report, never to raise.
        # Only the exception class name goes out — no message, no SQL — this
        # is unauthenticated on a public-facing app.
        return 503, {"status": "degraded", "sha": sha, "error": type(e).__name__}
    return {"status": "ok", "sha": sha}

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
    expense_pot: str
    category: str
    is_tab_repayment: bool
    is_extra: bool
    childcare_link: str
    is_auto_extra: bool
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
    expense_pot: str = ''
    category: str = ''
    is_tab_repayment: bool = False
    is_extra: bool = False
    childcare_link: str = ''
    is_auto_extra: bool = False
    calculation_type: str
    weekly_payment_day: Optional[int] = None
    last_payment_month_id: Optional[str] = None
    value: float
    is_one_off: bool = False

class BudgetItemEditSchema(Schema):
    item_name: Optional[str] = None
    item_type: Optional[str] = None
    owner: Optional[str] = None
    expense_pot: Optional[str] = None
    category: Optional[str] = None
    is_tab_repayment: Optional[bool] = None
    is_extra: Optional[bool] = None
    childcare_link: Optional[str] = None
    is_auto_extra: Optional[bool] = None
    calculation_type: Optional[str] = None
    weekly_payment_day: Optional[int] = None
    last_payment_month_id: Optional[str] = None

class BudgetItemVersionSchema(Schema):
    budget_item_id: uuid.UUID
    item_name: str
    item_type: str
    owner: str
    expense_pot: str
    category: str
    is_tab_repayment: bool
    is_extra: bool
    childcare_link: str
    is_auto_extra: bool
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

# --- Helpers ---

def _serialize_version(budget_item, effective_version, month_obj):
    """Build a BudgetItemVersionSchema payload for the given item + effective version + month."""
    calculated_value = float(effective_version.value)
    occurrences = None
    if budget_item.calculation_type == 'weekly_count' and budget_item.weekly_payment_day:
        occurrences = calculate_weekly_occurrences(month_obj.start_date.year, month_obj.start_date.month, budget_item.weekly_payment_day)
        calculated_value = float(effective_version.value) * occurrences
    return BudgetItemVersionSchema(
        budget_item_id=budget_item.budget_item_id,
        item_name=budget_item.item_name,
        item_type=budget_item.item_type,
        owner=budget_item.owner,
        expense_pot=budget_item.expense_pot,
        category=budget_item.category,
        is_tab_repayment=budget_item.is_tab_repayment,
        is_extra=budget_item.is_extra,
        childcare_link=budget_item.childcare_link,
        is_auto_extra=budget_item.is_auto_extra,
        calculation_type=budget_item.calculation_type,
        weekly_payment_day=budget_item.weekly_payment_day,
        value=float(effective_version.value),
        effective_value=calculated_value,
        effective_from_month_name=effective_version.effective_from_month.month_name,
        is_one_off=effective_version.is_one_off,
        occurrences=occurrences,
    )


def _effective_version_for_month(item, month_obj):
    """Pick the effective BudgetItemVersion for `item` in `month_obj` from prefetched `item.versions.all()`.

    Versions must be prefetched ordered by `-effective_from_month__start_date`.
    Prefers an exact month match (which may be a one-off); otherwise falls back to the most
    recent non-one-off version effective on or before this month.
    """
    exact = None
    fallback = None
    for v in item.versions.all():
        if v.month_id == month_obj.month_id:
            exact = v
            break
    if exact is not None:
        return exact
    for v in item.versions.all():
        if not v.is_one_off and v.effective_from_month.start_date <= month_obj.start_date:
            fallback = v
            break  # versions are sorted desc — first match is most recent
    return fallback


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
    _ensure_auto_extra_singleton(month)
    return month

@api.get("/auth/me", response=UserSchema)
def get_me(request):
    get_token(request) # Ensure CSRF cookie is set
    return request.user

@api.get("/months/", response=List[MonthSchema])
def list_all_months(request):
    return Month.objects.all().order_by('start_date')

AUTO_EXTRA_DEFAULT_TARGET = 500


def _ensure_auto_extra_singleton(month_obj):
    """Create the singleton auto-balance Extra item on first encounter of a current/future month.

    Skipped for past months so we don't backdate the buffer onto historical budgets.
    """
    if BudgetItem.objects.filter(is_auto_extra=True).exists():
        return
    today = datetime.date.today()
    current_month_start = datetime.date(today.year, today.month, 1)
    if month_obj.start_date < current_month_start:
        return
    with transaction.atomic():
        # Re-check inside the transaction to avoid a race creating two singletons.
        if BudgetItem.objects.filter(is_auto_extra=True).exists():
            return
        item = BudgetItem.objects.create(
            item_name='Extra',
            item_type='expense',
            owner='shared',
            expense_pot='',
            is_extra=True,
            is_auto_extra=True,
            calculation_type='fixed',
        )
        BudgetItemVersion.objects.create(
            budget_item=item,
            month=month_obj,
            effective_from_month=month_obj,
            value=AUTO_EXTRA_DEFAULT_TARGET,
            is_one_off=False,
        )


def _prefetched_budget_items():
    """All BudgetItems with versions prefetched in the order _effective_version_for_month requires."""
    versions_qs = (
        BudgetItemVersion.objects
        .select_related('effective_from_month', 'month')
        .order_by('-effective_from_month__start_date')
    )
    return (
        BudgetItem.objects
        .select_related('last_payment_month')
        .prefetch_related(Prefetch('versions', queryset=versions_qs))
    )


def _serialized_items_for_month(items, month_obj):
    """Effective, serialized budget items for a month, honouring last_payment_month expiry."""
    out = []
    for item in items:
        if item.last_payment_month and month_obj.start_date > item.last_payment_month.end_date:
            continue
        version = _effective_version_for_month(item, month_obj)
        if version is None:
            continue
        out.append(_serialize_version(item, version, month_obj))
    return out


@api.get("/months/{month_id}/items/", response=List[BudgetItemVersionSchema])
def list_budget_items_for_month(request, month_id: str):
    month_obj = get_object_or_404(Month, month_id=month_id)
    return _serialized_items_for_month(_prefetched_budget_items(), month_obj)

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
        budget_item_version, _ = BudgetItemVersion.objects.update_or_create(
            budget_item=budget_item, month=month,
            defaults={'value': payload.value, 'effective_from_month': month, 'is_one_off': payload.is_one_off}
        )
    budget_item.refresh_from_db()
    return _serialize_version(budget_item, budget_item_version, month)

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


@api.post("/months/{month_id}/budgetitems/", response={200: BudgetItemSchema, 409: dict})
def create_budget_item(request, month_id: str, payload: BudgetItemInputSchema):
    month = get_object_or_404(Month, month_id=month_id)

    if payload.is_auto_extra and BudgetItem.objects.filter(is_auto_extra=True).exists():
        return 409, {"detail": "An Auto-balance Extra item already exists. Edit it instead of creating a new one."}

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

    # Auto-repayments: for each budget item with is_tab_repayment, compute effective value per month.
    # Only surface months that have started — future months shouldn't show a repayment yet.
    today = datetime.date.today()
    versions_qs = (
        BudgetItemVersion.objects
        .select_related('effective_from_month', 'month')
        .order_by('-effective_from_month__start_date')
    )
    auto_items = list(
        BudgetItem.objects
        .filter(is_tab_repayment=True)
        .select_related('last_payment_month')
        .prefetch_related(Prefetch('versions', queryset=versions_qs))
    )
    all_months = list(Month.objects.filter(start_date__lte=today).order_by('start_date'))
    for bi in auto_items:
        for month_obj in all_months:
            if bi.last_payment_month and month_obj.start_date > bi.last_payment_month.end_date:
                continue
            effective_version = _effective_version_for_month(bi, month_obj)
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


# --- Nursery settings ---

class NurserySettingsSchema(Schema):
    data: dict

class NurserySettingsInputSchema(Schema):
    data: dict


@api.get("/nursery/settings/", response=NurserySettingsSchema)
def get_nursery_settings(request):
    obj, _ = NurserySettings.objects.get_or_create(user=request.user)
    return {"data": obj.data or {}}


@api.put("/nursery/settings/", response=NurserySettingsSchema)
def update_nursery_settings(request, payload: NurserySettingsInputSchema):
    obj, _ = NurserySettings.objects.get_or_create(user=request.user)
    obj.data = payload.data
    obj.save(update_fields=["data", "updated_at"])
    return {"data": obj.data}


# --- FIRE Schemas ---

class BalanceSnapshotSchema(Schema):
    id: uuid.UUID
    date: str
    balance: float
    source: str

    @staticmethod
    def resolve_date(obj):
        return obj.date.isoformat()

class FireAccountSchema(Schema):
    id: uuid.UUID
    name: str
    owner: str
    kind: str
    provider: str
    snapshots: List[BalanceSnapshotSchema]

    @staticmethod
    def resolve_snapshots(obj):
        return list(obj.snapshots.all())  # model ordering: newest first

class FireAccountInputSchema(Schema):
    name: str
    owner: str
    kind: str
    provider: str = ''

class BalanceSnapshotInputSchema(Schema):
    date: str
    balance: float

class EarningsVersionSchema(Schema):
    id: uuid.UUID
    owner: str
    effective_from: str
    gross_annual_salary: float
    employee_pension_pct: float
    employee_pension_is_salary_sacrifice: bool
    employer_pension_pct: float
    note: str

    @staticmethod
    def resolve_effective_from(obj):
        return obj.effective_from.isoformat()

class EarningsVersionInputSchema(Schema):
    owner: str
    effective_from: str
    gross_annual_salary: float
    employee_pension_pct: float = 0
    employee_pension_is_salary_sacrifice: bool = True
    employer_pension_pct: float = 0
    note: str = ''

class MortgageSchema(Schema):
    id: uuid.UUID
    name: str
    property_value: float
    property_value_date: str
    balance: float
    balance_date: str
    interest_rate_pct: float
    monthly_payment: float

    @staticmethod
    def resolve_property_value_date(obj):
        return obj.property_value_date.isoformat()

    @staticmethod
    def resolve_balance_date(obj):
        return obj.balance_date.isoformat()

class MortgageInputSchema(Schema):
    name: str = 'Home'
    property_value: float
    property_value_date: str
    balance: float
    balance_date: str
    interest_rate_pct: float
    monthly_payment: float

class FireSettingsSchema(Schema):
    owner: str
    date_of_birth: Optional[str] = None
    expected_real_return_pct: float
    safe_withdrawal_rate_pct: float
    target_retirement_age: Optional[int] = None

    @staticmethod
    def resolve_date_of_birth(obj):
        return obj.date_of_birth.isoformat() if obj.date_of_birth else None

class FireSettingsInputSchema(Schema):
    date_of_birth: Optional[str] = None
    expected_real_return_pct: float
    safe_withdrawal_rate_pct: float
    target_retirement_age: Optional[int] = None

class MonthItemsSchema(Schema):
    month_id: str
    month_name: str
    items: List[BudgetItemVersionSchema]


# --- FIRE Endpoints ---

@api.get("/fire/accounts/", response=List[FireAccountSchema])
def list_fire_accounts(request):
    return FireAccount.objects.prefetch_related('snapshots')

@api.post("/fire/accounts/", response=FireAccountSchema)
def create_fire_account(request, payload: FireAccountInputSchema):
    return FireAccount.objects.create(**payload.dict())

@api.put("/fire/accounts/{account_id}/", response=FireAccountSchema)
def edit_fire_account(request, account_id: uuid.UUID, payload: FireAccountInputSchema):
    account = get_object_or_404(FireAccount, id=account_id)
    for attr, value in payload.dict().items():
        setattr(account, attr, value)
    account.save()
    return account

@api.delete("/fire/accounts/{account_id}/", response={204: None})
def delete_fire_account(request, account_id: uuid.UUID):
    account = get_object_or_404(FireAccount, id=account_id)
    account.delete()
    return 204, None

@api.put("/fire/accounts/{account_id}/balance/", response=BalanceSnapshotSchema)
def set_fire_account_balance(request, account_id: uuid.UUID, payload: BalanceSnapshotInputSchema):
    """Record (or correct — same date overwrites) the account balance on a date."""
    account = get_object_or_404(FireAccount, id=account_id)
    snapshot, _ = BalanceSnapshot.objects.update_or_create(
        account=account,
        date=datetime.date.fromisoformat(payload.date),
        defaults={'balance': payload.balance, 'source': 'manual'},
    )
    return snapshot

@api.delete("/fire/snapshots/{snapshot_id}/", response={204: None})
def delete_balance_snapshot(request, snapshot_id: uuid.UUID):
    snapshot = get_object_or_404(BalanceSnapshot, id=snapshot_id)
    snapshot.delete()
    return 204, None

@api.get("/fire/earnings/", response=List[EarningsVersionSchema])
def list_earnings_versions(request):
    return EarningsVersion.objects.all()

@api.post("/fire/earnings/", response={200: EarningsVersionSchema, 409: dict})
def create_earnings_version(request, payload: EarningsVersionInputSchema):
    data = payload.dict()
    data['effective_from'] = datetime.date.fromisoformat(data['effective_from'])
    if EarningsVersion.objects.filter(owner=data['owner'], effective_from=data['effective_from']).exists():
        return 409, {"detail": "An earnings version already exists for that owner and date. Edit it instead."}
    return EarningsVersion.objects.create(**data)

@api.put("/fire/earnings/{version_id}/", response=EarningsVersionSchema)
def edit_earnings_version(request, version_id: uuid.UUID, payload: EarningsVersionInputSchema):
    version = get_object_or_404(EarningsVersion, id=version_id)
    data = payload.dict()
    data['effective_from'] = datetime.date.fromisoformat(data['effective_from'])
    for attr, value in data.items():
        setattr(version, attr, value)
    version.save()
    return version

@api.delete("/fire/earnings/{version_id}/", response={204: None})
def delete_earnings_version(request, version_id: uuid.UUID):
    version = get_object_or_404(EarningsVersion, id=version_id)
    version.delete()
    return 204, None

@api.get("/fire/mortgages/", response=List[MortgageSchema])
def list_mortgages(request):
    return Mortgage.objects.all()

@api.post("/fire/mortgages/", response=MortgageSchema)
def create_mortgage(request, payload: MortgageInputSchema):
    data = payload.dict()
    data['property_value_date'] = datetime.date.fromisoformat(data['property_value_date'])
    data['balance_date'] = datetime.date.fromisoformat(data['balance_date'])
    return Mortgage.objects.create(**data)

@api.put("/fire/mortgages/{mortgage_id}/", response=MortgageSchema)
def edit_mortgage(request, mortgage_id: uuid.UUID, payload: MortgageInputSchema):
    mortgage = get_object_or_404(Mortgage, id=mortgage_id)
    data = payload.dict()
    data['property_value_date'] = datetime.date.fromisoformat(data['property_value_date'])
    data['balance_date'] = datetime.date.fromisoformat(data['balance_date'])
    for attr, value in data.items():
        setattr(mortgage, attr, value)
    mortgage.save()
    return mortgage

@api.delete("/fire/mortgages/{mortgage_id}/", response={204: None})
def delete_mortgage(request, mortgage_id: uuid.UUID):
    mortgage = get_object_or_404(Mortgage, id=mortgage_id)
    mortgage.delete()
    return 204, None

@api.get("/fire/settings/", response=List[FireSettingsSchema])
def list_fire_settings(request):
    """Settings for both owners — created with defaults on first read so the frontend always gets two rows."""
    return [FireSettings.objects.get_or_create(owner=owner)[0] for owner, _ in FireSettings.OWNER_CHOICES]

@api.put("/fire/settings/{owner}/", response={200: FireSettingsSchema, 400: dict})
def update_fire_settings(request, owner: str, payload: FireSettingsInputSchema):
    if owner not in dict(FireSettings.OWNER_CHOICES):
        return 400, {"detail": "Unknown owner."}
    obj, _ = FireSettings.objects.get_or_create(owner=owner)
    obj.date_of_birth = datetime.date.fromisoformat(payload.date_of_birth) if payload.date_of_birth else None
    obj.expected_real_return_pct = payload.expected_real_return_pct
    obj.safe_withdrawal_rate_pct = payload.safe_withdrawal_rate_pct
    obj.target_retirement_age = payload.target_retirement_age
    obj.save()
    return obj

@api.get("/fire/monthly-items/", response=List[MonthItemsSchema])
def fire_monthly_items(request, count: int = 12):
    """Effective budget items for the last `count` started months, oldest first.

    Feeds the FIRE page's spending/saving averages — the frontend applies the
    same totals logic the budget dashboard uses, per month.
    """
    today = datetime.date.today()
    months = list(
        Month.objects.filter(start_date__lte=today).order_by('-start_date')[:max(1, min(count, 36))]
    )
    items = list(_prefetched_budget_items())
    return [
        MonthItemsSchema(
            month_id=m.month_id,
            month_name=m.month_name,
            items=_serialized_items_for_month(items, m),
        )
        for m in reversed(months)
    ]
