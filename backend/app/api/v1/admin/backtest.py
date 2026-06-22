from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_admin_user, get_db
from app.models.backtest import BacktestResult
from app.models.user import User
from app.schemas.backtest import BacktestOut

router = APIRouter(prefix="/admin/backtests", tags=["admin-backtests"])


@router.get("", response_model=dict)
async def list_backtests(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), stock_id: int | None = None, config_id: int | None = None, db: AsyncSession = Depends(get_db), _: User = Depends(get_admin_user)):
    query = select(BacktestResult)
    count_query = select(func.count(BacktestResult.id))
    filters = []
    if stock_id is not None:
        filters.append(BacktestResult.stock_id == stock_id)
    if config_id is not None:
        filters.append(BacktestResult.config_id == config_id)
    if filters:
        query = query.where(*filters)
        count_query = count_query.where(*filters)
    total = (await db.execute(count_query)).scalar() or 0
    rows = (await db.execute(query.order_by(BacktestResult.id.desc()).offset((page - 1) * size).limit(size))).scalars().all()
    return {"items": [BacktestOut.model_validate(row).model_dump(mode="json") for row in rows], "total": total, "page": page, "size": size, "pages": (total + size - 1) // size}


@router.get("/{backtest_id}", response_model=BacktestOut)
async def get_backtest_admin(backtest_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(get_admin_user)):
    result = (await db.execute(select(BacktestResult).where(BacktestResult.id == backtest_id))).scalar_one_or_none()
    if result is None:
        raise HTTPException(status_code=404, detail="Backtest not found")
    return result
