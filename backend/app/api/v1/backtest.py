from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db
from app.models.backtest import BacktestResult
from app.models.user import User
from app.schemas.backtest import BacktestOut, BacktestRunRequest
from app.services.backtest_service import BacktestService

router = APIRouter(prefix="/backtest", tags=["backtest"])


@router.post("/run", response_model=BacktestOut)
async def run_backtest(body: BacktestRunRequest, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await BacktestService(db).run_backtest(**body.model_dump(), user_id=current_user.id)
    return result


@router.get("/history", response_model=dict)
async def history(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), config_id: int | None = None, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    query = select(BacktestResult).where(BacktestResult.user_id == current_user.id)
    count_query = select(func.count(BacktestResult.id)).where(BacktestResult.user_id == current_user.id)
    if config_id is not None:
        query = query.where(BacktestResult.config_id == config_id)
        count_query = count_query.where(BacktestResult.config_id == config_id)
    total = (await db.execute(count_query)).scalar() or 0
    rows = (await db.execute(query.order_by(BacktestResult.id.desc()).offset((page - 1) * size).limit(size))).scalars().all()
    return {"items": [BacktestOut.model_validate(row).model_dump(mode="json") for row in rows], "total": total, "page": page, "size": size, "pages": (total + size - 1) // size}


@router.get("/{backtest_id}", response_model=BacktestOut)
async def get_backtest(backtest_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = (await db.execute(select(BacktestResult).where(BacktestResult.id == backtest_id, BacktestResult.user_id == current_user.id))).scalar_one_or_none()
    if result is None:
        raise HTTPException(status_code=404, detail="Backtest not found")
    return result
