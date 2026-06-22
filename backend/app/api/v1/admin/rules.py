from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_admin_user, get_db
from app.models.alert import AlertRule
from app.models.stock import Stock
from app.models.user import User

router = APIRouter(prefix="/admin/rules", tags=["admin-rules"])


@router.get("", response_model=dict)
async def list_rules(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    user_id: int | None = None,
    is_active: bool | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    query = select(AlertRule)
    count_query = select(func.count(AlertRule.id))
    if user_id is not None:
        query = query.where(AlertRule.user_id == user_id)
        count_query = count_query.where(AlertRule.user_id == user_id)
    if is_active is not None:
        query = query.where(AlertRule.is_active.is_(is_active))
        count_query = count_query.where(AlertRule.is_active.is_(is_active))
    total = (await db.execute(count_query)).scalar() or 0
    rows = (await db.execute(query.order_by(AlertRule.id.desc()).offset((page - 1) * size).limit(size))).scalars().all()
    items = []
    for rule in rows:
        user = (await db.execute(select(User).where(User.id == rule.user_id))).scalar_one_or_none()
        stock = (await db.execute(select(Stock).where(Stock.id == rule.stock_id))).scalar_one_or_none()
        items.append({
            "id": rule.id, "user_id": rule.user_id, "stock_id": rule.stock_id,
            "alert_type": rule.alert_type, "is_active": rule.is_active,
            "user_email": user.email if user else None,
            "stock_symbol": stock.symbol if stock else None,
            "created_at": str(rule.created_at), "updated_at": str(rule.updated_at),
        })
    return {"items": items, "total": total, "page": page, "size": size, "pages": (total + size - 1) // size}


@router.patch("/{rule_id}", response_model=dict)
async def update_rule(rule_id: int, body: dict, db: AsyncSession = Depends(get_db), _: User = Depends(get_admin_user)):
    rule = (await db.execute(select(AlertRule).where(AlertRule.id == rule_id))).scalar_one_or_none()
    if rule is None:
        raise HTTPException(status_code=404, detail="Rule not found")
    if "is_active" in body:
        rule.is_active = bool(body["is_active"])
    if "alert_type" in body and body["alert_type"] in ("any_signal", "buy_signal", "sell_signal"):
        rule.alert_type = body["alert_type"]
    await db.flush()
    await db.refresh(rule)
    return {"id": rule.id, "is_active": rule.is_active, "alert_type": rule.alert_type}
