from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.stocks import paginated_response
from app.core.deps import get_admin_user, get_db
from app.models.stock import Stock
from app.models.user import User
from app.schemas.stock import StockCreate, StockOut, StockUpdate
from app.services.stock_data import DataService

router = APIRouter(prefix="/admin/stocks", tags=["admin-stocks"])


@router.get("", response_model=dict)
async def list_stocks_admin(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    query = select(Stock)
    count_query = select(func.count(Stock.id))
    if search:
        pattern = f"%{search}%"
        query = query.where((Stock.symbol.ilike(pattern)) | (Stock.name.ilike(pattern)))
        count_query = count_query.where((Stock.symbol.ilike(pattern)) | (Stock.name.ilike(pattern)))
    total = (await db.execute(count_query)).scalar() or 0
    result = await db.execute(query.order_by(Stock.symbol).offset((page - 1) * size).limit(size))
    items = [StockOut.model_validate(stock) for stock in result.scalars().all()]
    return paginated_response(items, total, page, size)


@router.post("", response_model=StockOut, status_code=status.HTTP_201_CREATED)
async def create_stock(
    body: StockCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    symbol = body.symbol.upper()
    existing = await db.execute(select(Stock).where(Stock.symbol == symbol))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Stock symbol already exists")
    stock = Stock(
        symbol=symbol,
        name=body.name,
        type=body.type,
        market=body.market,
        sector=body.sector,
        is_active=True,
    )
    db.add(stock)
    await db.flush()
    await db.refresh(stock)
    return stock


@router.patch("/{stock_id}", response_model=StockOut)
async def update_stock(
    stock_id: int,
    body: StockUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    result = await db.execute(select(Stock).where(Stock.id == stock_id))
    stock = result.scalar_one_or_none()
    if stock is None:
        raise HTTPException(status_code=404, detail="Stock not found")
    if body.name is not None:
        stock.name = body.name
    if body.type is not None:
        stock.type = body.type
    if body.sector is not None:
        stock.sector = body.sector
    if body.is_active is not None:
        stock.is_active = body.is_active
    await db.flush()
    await db.refresh(stock)
    return stock


@router.delete("/{stock_id}", status_code=status.HTTP_200_OK)
async def delete_stock(
    stock_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    result = await db.execute(select(Stock).where(Stock.id == stock_id))
    stock = result.scalar_one_or_none()
    if stock is None:
        raise HTTPException(status_code=404, detail="Stock not found")
    stock.is_active = False
    await db.flush()
    return {"detail": "Stock deactivated", "code": "OK"}


@router.get("/summaries", response_model=dict)
async def list_stocks_with_prices(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    all_summaries = await DataService().get_stocks_with_price_summaries(db, limit=200)
    total = len(all_summaries)
    start = (page - 1) * size
    items = all_summaries[start : start + size]
    return {"items": items, "total": total, "page": page, "size": size, "pages": (total + size - 1) // size}


@router.post("/sync-all", response_model=dict)
async def sync_all_stocks(
    _: User = Depends(get_admin_user),
):
    from app.core.deps import get_db_context

    async with get_db_context() as db:
        stocks = (await db.execute(select(Stock).where(Stock.is_active.is_(True)))).scalars().all()

    results = []
    total = 0
    for stock in stocks:
        try:
            async with get_db_context() as db:
                count = await DataService().sync_latest(db, stock.symbol)
                results.append({"symbol": stock.symbol, "new_rows": count})
                total += count
        except Exception as exc:
            results.append({"symbol": stock.symbol, "error": str(exc)})
    return {"total_new_rows": total, "stocks_synced": len(stocks), "details": results}


@router.post("/{stock_id}/sync", response_model=dict)
async def sync_stock_prices(
    stock_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    result = await db.execute(select(Stock).where(Stock.id == stock_id))
    stock = result.scalar_one_or_none()
    if stock is None:
        raise HTTPException(status_code=404, detail="Stock not found")
    count = await DataService().sync_latest(db, symbol=stock.symbol)
    return {"symbol": stock.symbol, "new_rows": count, "detail": "Sync complete"}
