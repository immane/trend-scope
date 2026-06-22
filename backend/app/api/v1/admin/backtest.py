from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import get_admin_user, get_db
from app.models.analysis import AnalysisConfig
from app.models.backtest import BacktestResult
from app.models.stock import Stock
from app.models.user import User
from app.schemas.backtest import BacktestOut

router = APIRouter(prefix="/admin/backtests", tags=["admin-backtests"])


def _backtest_query():
    return select(BacktestResult).options(selectinload(BacktestResult.config), selectinload(BacktestResult.stock))


def _dump(row: BacktestResult) -> dict:
    d = BacktestOut.model_validate(row).model_dump(mode="json")
    if row.config:
        d["strategy_name"] = row.config.name
    if row.stock:
        d["stock_symbol"] = row.stock.symbol
    return d


@router.get("", response_model=dict)
async def list_backtests(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), stock_id: int | None = None, config_id: int | None = None, db: AsyncSession = Depends(get_db), _: User = Depends(get_admin_user)):
    query = _backtest_query()
    count_query = select(func.count(BacktestResult.id))
    if stock_id is not None:
        query = query.where(BacktestResult.stock_id == stock_id)
        count_query = count_query.where(BacktestResult.stock_id == stock_id)
    if config_id is not None:
        query = query.where(BacktestResult.config_id == config_id)
        count_query = count_query.where(BacktestResult.config_id == config_id)
    total = (await db.execute(count_query)).scalar() or 0
    rows = (await db.execute(query.order_by(BacktestResult.id.desc()).offset((page - 1) * size).limit(size))).scalars().all()
    return {"items": [_dump(row) for row in rows], "total": total, "page": page, "size": size, "pages": (total + size - 1) // size}


@router.get("/{backtest_id}", response_model=BacktestOut)
async def get_backtest_admin(backtest_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(get_admin_user)):
    result = (await db.execute(_backtest_query().where(BacktestResult.id == backtest_id))).scalar_one_or_none()
    if result is None:
        raise HTTPException(status_code=404, detail="Backtest not found")
    return _dump(result)
