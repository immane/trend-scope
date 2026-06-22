from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_admin_user, get_db
from app.models.stock import Stock, StockPriceDaily
from app.models.user import User
from app.schemas.price_data import StockPriceDataSummary

router = APIRouter(prefix="/admin/price-data", tags=["admin-price-data"])


@router.get("", response_model=dict)
async def list_price_data(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    subquery = (
        select(
            StockPriceDaily.stock_id,
            func.count(StockPriceDaily.id).label("total_rows"),
            func.min(StockPriceDaily.trade_date).label("earliest_date"),
            func.max(StockPriceDaily.trade_date).label("latest_date"),
            func.max(StockPriceDaily.data_source).label("data_source"),
        )
        .group_by(StockPriceDaily.stock_id)
        .subquery()
    )
    query = (
        select(
            Stock.id,
            Stock.symbol,
            Stock.name,
            func.coalesce(subquery.c.total_rows, 0).label("total_rows"),
            subquery.c.earliest_date,
            subquery.c.latest_date,
            subquery.c.data_source,
        )
        .outerjoin(subquery, Stock.id == subquery.c.stock_id)
        .order_by(func.coalesce(subquery.c.total_rows, 0).desc(), Stock.symbol)
        .offset((page - 1) * size)
        .limit(size)
    )
    count_query = select(func.count(Stock.id))

    total = (await db.execute(count_query)).scalar() or 0
    rows = (await db.execute(query)).all()

    items = []
    for row in rows:
        items.append({
            "stock_id": row.id,
            "symbol": row.symbol,
            "stock_name": row.name,
            "total_rows": row.total_rows,
            "earliest_date": str(row.earliest_date) if row.earliest_date else None,
            "latest_date": str(row.latest_date) if row.latest_date else None,
            "data_source": row.data_source or "none",
        })
    return {"items": items, "total": total, "page": page, "size": size, "pages": (total + size - 1) // size}


@router.delete("/{stock_id}", response_model=dict)
async def delete_price_data(
    stock_id: int,
    before_date: str | None = Query(None, description="删除指定日期之前的数据，格式 YYYY-MM-DD。不传则删除全部。"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    stock = (await db.execute(select(Stock).where(Stock.id == stock_id))).scalar_one_or_none()
    if stock is None:
        raise HTTPException(status_code=404, detail="Stock not found")

    if before_date:
        result = await db.execute(
            text("DELETE FROM stock_prices_daily WHERE stock_id = :sid AND trade_date < :bd"),
            {"sid": stock_id, "bd": before_date},
        )
    else:
        result = await db.execute(
            text("DELETE FROM stock_prices_daily WHERE stock_id = :sid"),
            {"sid": stock_id},
        )

    deleted = getattr(result, "rowcount", 0)
    await db.commit()

    remaining = (await db.execute(
        select(func.count(StockPriceDaily.id)).where(StockPriceDaily.stock_id == stock_id)
    )).scalar() or 0

    return {"detail": f"Deleted {deleted} rows for {stock.symbol}", "deleted": deleted, "remaining": remaining}
