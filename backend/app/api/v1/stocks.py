from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db
from app.models.stock import Stock
from app.models.user import User
from app.schemas.stock import KlinePoint, KlineResponse, StockOut
from app.services.stock_data import DataService

router = APIRouter()


def paginated_response(items: list[StockOut], total: int, page: int, size: int) -> dict:
    return {
        "items": [item.model_dump(mode="json") for item in items],
        "total": total,
        "page": page,
        "size": size,
        "pages": (total + size - 1) // size,
    }


@router.get("", response_model=dict)
async def list_stocks(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    query = select(Stock).where(Stock.is_active.is_(True))
    count_query = select(func.count(Stock.id)).where(Stock.is_active.is_(True))
    if search:
        pattern = f"%{search}%"
        query = query.where((Stock.symbol.ilike(pattern)) | (Stock.name.ilike(pattern)))
        count_query = count_query.where((Stock.symbol.ilike(pattern)) | (Stock.name.ilike(pattern)))

    total = (await db.execute(count_query)).scalar() or 0
    result = await db.execute(query.order_by(Stock.symbol).offset((page - 1) * size).limit(size))
    items = [StockOut.model_validate(stock) for stock in result.scalars().all()]
    return paginated_response(items, total, page, size)


@router.get("/{stock_id}", response_model=StockOut)
async def get_stock(
    stock_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Stock).where(Stock.id == stock_id, Stock.is_active.is_(True)))
    stock = result.scalar_one_or_none()
    if stock is None:
        raise HTTPException(status_code=404, detail="Stock not found")
    return stock


@router.get("/{stock_id}/kline", response_model=KlineResponse)
async def get_kline(
    stock_id: int,
    limit: int = Query(200, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Stock).where(Stock.id == stock_id, Stock.is_active.is_(True)))
    stock = result.scalar_one_or_none()
    if stock is None:
        raise HTTPException(status_code=404, detail="Stock not found")
    data = await DataService().get_kline(db, stock_id=stock.id, limit=limit)
    return KlineResponse(
        symbol=stock.symbol,
        period="day",
        data=[KlinePoint.model_validate(point) for point in data],
    )
