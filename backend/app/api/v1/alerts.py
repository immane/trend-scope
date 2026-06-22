from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db
from app.models.alert import AlertRule
from app.models.stock import Stock
from app.models.user import User
from app.schemas.alert import AlertRuleCreate, AlertRuleOut, AlertRuleUpdate

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("", response_model=dict)
async def list_rules(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    total = (await db.execute(select(func.count(AlertRule.id)).where(AlertRule.user_id == current_user.id))).scalar() or 0
    rows = (await db.execute(select(AlertRule).where(AlertRule.user_id == current_user.id).order_by(AlertRule.id.desc()).offset((page - 1) * size).limit(size))).scalars().all()
    return {"items": [AlertRuleOut.model_validate(row).model_dump(mode="json") for row in rows], "total": total, "page": page, "size": size, "pages": (total + size - 1) // size}


@router.post("", response_model=AlertRuleOut, status_code=status.HTTP_201_CREATED)
async def create_rule(body: AlertRuleCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    stock = (await db.execute(select(Stock).where(Stock.id == body.stock_id))).scalar_one_or_none()
    if stock is None:
        raise HTTPException(status_code=404, detail="Stock not found")
    rule = AlertRule(user_id=current_user.id, stock_id=body.stock_id, alert_type=body.alert_type, is_active=True)
    db.add(rule)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="Alert rule already exists") from exc
    await db.refresh(rule)
    return rule


@router.patch("/{rule_id}", response_model=AlertRuleOut)
async def update_rule(rule_id: int, body: AlertRuleUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    rule = (await db.execute(select(AlertRule).where(AlertRule.id == rule_id, AlertRule.user_id == current_user.id))).scalar_one_or_none()
    if rule is None:
        raise HTTPException(status_code=404, detail="Alert rule not found")
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(rule, key, value)
    await db.flush()
    await db.refresh(rule)
    return rule


@router.delete("/{rule_id}", status_code=status.HTTP_200_OK)
async def delete_rule(rule_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    rule = (await db.execute(select(AlertRule).where(AlertRule.id == rule_id, AlertRule.user_id == current_user.id))).scalar_one_or_none()
    if rule is None:
        raise HTTPException(status_code=404, detail="Alert rule not found")
    rule.is_active = False
    await db.flush()
    return {"detail": "Alert rule deactivated"}
