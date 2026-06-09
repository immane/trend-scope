# Task 04: Phase 1 Stock Data — yfinance Integration, CRUD & K-line API

> **Status**: Ready for Implementation
> **Estimated Time**: 2-3 days
> **Depends On**: [Task 02 — 数据库层](02-phase-1-database.md), [Task 03 — 认证系统](03-phase-1-auth.md)
> **Required By**: [Task 05 — 策略引擎](05-phase-1-strategy-engine.md), [Task 07 — 回测系统](07-phase-1-backtest.md)
> **参考设计文档**:
> - [001-preliminary-design.md](../design/001-preliminary-design.md) — 总体架构
> - [phase-1.md](../design/phase-1.md) — Phase 1 MVP 详细设计
> - [003-api-specification.md](../design/003-api-specification.md) — API规格
> - [002-data-sources.md](../research/002-data-sources.md) — 数据源研究

---

## 1. Objective

Integrate yfinance for fetching US stock daily OHLCV data, implement incremental sync logic, build the stock CRUD APIs (public list/detail/kline + admin CRUD), and the K-line endpoint that returns precomputed MA20, MA60, RSI14 indicators with optional signal annotations.

---

## 2. Files to Create

### 2.1 `backend/app/services/stock_data.py`

The core service class wrapping yfinance and DB queries.

```python
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Optional

import pandas as pd
import yfinance as yf
from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.stock import Stock, StockPriceDaily
from app.models.analysis import AnalysisSignal


# Python 3.10+ type alias for DataFrame
from pandas import DataFrame


class DataService:
    """Service for fetching, syncing, and querying stock price data."""

    def fetch_historical(
        self, symbol: str, period: str = "2y", interval: str = "1d"
    ) -> DataFrame:
        """
        Download historical OHLCV data from yfinance.
        Returns a DataFrame with columns: Open, High, Low, Close, Volume
        and a DatetimeIndex named 'Date'.
        """
        ticker = yf.Ticker(symbol)
        df = ticker.history(period=period, interval=interval, auto_adjust=True)
        if df.empty:
            return df
        df.index = pd.to_datetime(df.index).date
        df.index.name = "Date"
        return df

    async def sync_latest(self, db: AsyncSession, symbol: str) -> int:
        """
        Incremental sync: find the last trade_date in DB for this stock,
        download new rows from yfinance, and upsert them.
        Returns the number of new rows inserted.
        """
        # Find stock by symbol
        result = await db.execute(select(Stock).where(Stock.symbol == symbol))
        stock = result.scalar_one_or_none()
        if stock is None:
            raise ValueError(f"Stock with symbol '{symbol}' not found")

        # Find last trade_date
        result = await db.execute(
            select(func.max(StockPriceDaily.trade_date)).where(
                StockPriceDaily.stock_id == stock.id
            )
        )
        last_date = result.scalar()
        start = (last_date + timedelta(days=1)) if last_date else None

        # Fetch data
        if start is not None and start >= date.today():
            return 0  # Already up to date

        ticker = yf.Ticker(symbol)
        df = ticker.history(start=start or "2010-01-01", auto_adjust=True)
        if df.empty:
            return 0

        df.index = pd.to_datetime(df.index).date

        # Insert new rows (upsert via merge)
        new_count = 0
        for idx, row in df.iterrows():
            trade_date = idx if isinstance(idx, date) else idx.date()
            if last_date and trade_date <= last_date:
                continue

            # Use INSERT ... ON DUPLICATE KEY UPDATE pattern
            existing = await db.execute(
                select(StockPriceDaily).where(
                    and_(
                        StockPriceDaily.stock_id == stock.id,
                        StockPriceDaily.trade_date == trade_date,
                    )
                )
            )
            price_row = existing.scalar_one_or_none()

            if price_row is None:
                price_row = StockPriceDaily(
                    stock_id=stock.id,
                    trade_date=trade_date,
                    open=Decimal(str(round(float(row["Open"]), 4))),
                    high=Decimal(str(round(float(row["High"]), 4))),
                    low=Decimal(str(round(float(row["Low"]), 4))),
                    close=Decimal(str(round(float(row["Close"]), 4))),
                    volume=int(row["Volume"]),
                    data_source="yfinance",
                )
                db.add(price_row)
                new_count += 1

        await db.flush()
        return new_count

    async def get_kline(
        self,
        db: AsyncSession,
        stock_id: int,
        limit: int = 200,
    ) -> list[dict]:
        """
        Query daily price data for a stock, compute MA20/MA60/RSI14,
        and attach any active signals for each date.
        Returns a list of K-line data points sorted by date ascending.
        """
        # Fetch prices ordered by date DESC, then limit
        result = await db.execute(
            select(StockPriceDaily)
            .where(StockPriceDaily.stock_id == stock_id)
            .order_by(StockPriceDaily.trade_date.desc())
            .limit(limit)
        )
        prices = list(result.scalars().all())

        if not prices:
            return []

        # Reverse to chronological order
        prices.reverse()

        # Convert to DataFrame for indicator computation
        records = [
            {
                "date": p.trade_date,
                "open": float(p.open),
                "high": float(p.high),
                "low": float(p.low),
                "close": float(p.close),
                "volume": p.volume,
            }
            for p in prices
        ]
        df = pd.DataFrame(records)

        # Compute technical indicators
        df["ma20"] = df["close"].rolling(window=20).mean()
        df["ma60"] = df["close"].rolling(window=60).mean()

        # RSI14 computation
        delta = df["close"].diff()
        gain = delta.clip(lower=0)
        loss = (-delta).clip(lower=0)
        avg_gain = gain.rolling(window=14).mean()
        avg_loss = loss.rolling(window=14).mean()
        rs = avg_gain / avg_loss.replace(0, float("nan"))
        df["rsi14"] = 100.0 - (100.0 / (1.0 + rs))

        # Fetch signals for this stock within the date range
        min_date = prices[0].trade_date
        max_date = prices[-1].trade_date
        signal_result = await db.execute(
            select(AnalysisSignal)
            .where(
                and_(
                    AnalysisSignal.stock_id == stock_id,
                    AnalysisSignal.triggered_date >= min_date,
                    AnalysisSignal.triggered_date <= max_date,
                    AnalysisSignal.is_active == True,
                )
            )
            .order_by(AnalysisSignal.triggered_date)
        )
        signals = list(signal_result.scalars().all())

        # Build signal lookup dict: date -> signal info
        signal_map: dict[date, dict] = {}
        for s in signals:
            signal_map[s.triggered_date] = {
                "id": s.id,
                "type": s.signal_type,
                "subtype": s.signal_subtype,
                "strength": s.strength,
                "price": float(s.trigger_price),
                "ai_summary": (
                    s.ai_analysis.analysis_json.get("summary", "")
                    if s.ai_analysis and s.ai_analysis.analysis_json
                    else None
                ),
            }

        # Build response
        kline_data = []
        for _, row in df.iterrows():
            point = {
                "time": str(row["date"]),
                "open": round(float(row["open"]), 2),
                "high": round(float(row["high"]), 2),
                "low": round(float(row["low"]), 2),
                "close": round(float(row["close"]), 2),
                "volume": int(row["volume"]),
                "ma20": round(float(row["ma20"]), 2) if not pd.isna(row["ma20"]) else None,
                "ma60": round(float(row["ma60"]), 2) if not pd.isna(row["ma60"]) else None,
                "rsi14": round(float(row["rsi14"]), 2) if not pd.isna(row["rsi14"]) else None,
                "signal": signal_map.get(row["date"], None),
            }
            kline_data.append(point)

        return kline_data

    async def get_active_stocks(self, db: AsyncSession) -> list[Stock]:
        """Get all active stocks."""
        result = await db.execute(select(Stock).where(Stock.is_active == True))
        return list(result.scalars().all())
```

### 2.2 `backend/app/schemas/stock.py`

Pydantic schemas for stock API.

```python
from datetime import date as DateType, datetime
from typing import Optional
from pydantic import BaseModel, Field


class SignalPoint(BaseModel):
    id: int
    type: str
    subtype: Optional[str] = None
    strength: Optional[str] = None
    price: float
    ai_summary: Optional[str] = None


class KlinePoint(BaseModel):
    time: str
    open: float
    high: float
    low: float
    close: float
    volume: int
    ma20: Optional[float] = None
    ma60: Optional[float] = None
    rsi14: Optional[float] = None
    signal: Optional[SignalPoint] = None


class KlineResponse(BaseModel):
    symbol: str
    period: str = "day"
    data: list[KlinePoint]


class StockOut(BaseModel):
    id: int
    symbol: str
    name: str
    type: str
    market: str
    sector: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class StockCreate(BaseModel):
    symbol: str = Field(min_length=1, max_length=20)
    name: str = Field(min_length=1, max_length=200)
    type: str = Field(pattern=r"^(ETF|Stock|Index)$")
    market: str = Field(default="US", pattern=r"^US$")
    sector: Optional[str] = Field(None, max_length=100)


class StockUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=200)
    type: Optional[str] = Field(None, pattern=r"^(ETF|Stock|Index)$")
    sector: Optional[str] = Field(None, max_length=100)
    is_active: Optional[bool] = None
```

### 2.3 `backend/app/api/v1/stocks.py`

Public stock endpoints (list, detail, K-line).

```python
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db
from app.models.stock import Stock
from app.schemas.stock import StockOut, KlineResponse
from app.services.stock_data import DataService

router = APIRouter(prefix="/stocks", tags=["stocks"])


@router.get("", response_model=dict)
async def list_stocks(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None, description="Search symbol or name"),
    db: AsyncSession = Depends(get_db),
):
    """
    List active stocks with optional search and pagination.
    Authentication required.
    """
    query = select(Stock)
    count_query = select(func.count(Stock.id))

    if search:
        pattern = f"%{search}%"
        query = query.where(
            (Stock.symbol.ilike(pattern)) | (Stock.name.ilike(pattern))
        )
        count_query = count_query.where(
            (Stock.symbol.ilike(pattern)) | (Stock.name.ilike(pattern))
        )

    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    query = query.order_by(Stock.symbol).offset((page - 1) * size).limit(size)
    result = await db.execute(query)
    items = [StockOut.model_validate(s) for s in result.scalars().all()]

    pages = (total + size - 1) // size
    return {
        "items": [i.model_dump() for i in items],
        "total": total,
        "page": page,
        "size": size,
        "pages": pages,
    }


@router.get("/{stock_id}", response_model=StockOut)
async def get_stock(stock_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Stock).where(Stock.id == stock_id))
    stock = result.scalar_one_or_none()
    if stock is None:
        raise HTTPException(status_code=404, detail="Stock not found")
    return stock


@router.get("/{stock_id}/kline", response_model=KlineResponse)
async def get_kline(
    stock_id: int,
    limit: int = Query(200, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    """
    Get K-line data for a stock with precomputed indicators and signal annotations.
    """
    result = await db.execute(select(Stock).where(Stock.id == stock_id))
    stock = result.scalar_one_or_none()
    if stock is None:
        raise HTTPException(status_code=404, detail="Stock not found")

    ds = DataService()
    kline_data = await ds.get_kline(db, stock_id=stock.id, limit=limit)

    return KlineResponse(symbol=stock.symbol, period="day", data=kline_data)
```

### 2.4 `backend/app/api/v1/admin/stocks.py`

Admin-only CRUD endpoints for stock management.

```python
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_admin_user, get_db
from app.models.stock import Stock
from app.models.user import User  # for type hint
from app.schemas.stock import StockOut, StockCreate, StockUpdate
from app.services.stock_data import DataService

router = APIRouter(prefix="/admin/stocks", tags=["admin-stocks"])


@router.get("", response_model=dict)
async def list_stocks_admin(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    search: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    query = select(Stock)
    count_query = select(func.count(Stock.id))

    if search:
        pattern = f"%{search}%"
        query = query.where(
            (Stock.symbol.ilike(pattern)) | (Stock.name.ilike(pattern))
        )
        count_query = count_query.where(
            (Stock.symbol.ilike(pattern)) | (Stock.name.ilike(pattern))
        )

    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    query = query.order_by(Stock.symbol).offset((page - 1) * size).limit(size)
    result = await db.execute(query)
    items = [StockOut.model_validate(s) for s in result.scalars().all()]

    pages = (total + size - 1) // size
    return {"items": [i.model_dump() for i in items], "total": total, "page": page, "size": size, "pages": pages}


@router.post("", response_model=StockOut, status_code=201)
async def create_stock(
    body: StockCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    # Check for duplicate symbol
    existing = await db.execute(select(Stock).where(Stock.symbol == body.symbol.upper()))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Stock symbol already exists")

    stock = Stock(
        symbol=body.symbol.upper(),
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


@router.delete("/{stock_id}", status_code=200)
async def delete_stock(
    stock_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    """
    Soft-delete: set is_active=False.
    """
    result = await db.execute(select(Stock).where(Stock.id == stock_id))
    stock = result.scalar_one_or_none()
    if stock is None:
        raise HTTPException(status_code=404, detail="Stock not found")

    stock.is_active = False
    await db.flush()
    return {"detail": "Stock deactivated", "code": "OK"}


@router.post("/{stock_id}/sync", response_model=dict)
async def sync_stock_prices(
    stock_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    """
    Trigger incremental sync of price data for a specific stock.
    """
    result = await db.execute(select(Stock).where(Stock.id == stock_id))
    stock = result.scalar_one_or_none()
    if stock is None:
        raise HTTPException(status_code=404, detail="Stock not found")

    ds = DataService()
    count = await ds.sync_latest(db, symbol=stock.symbol)

    return {"symbol": stock.symbol, "new_rows": count, "detail": "Sync complete"}
```

### 2.5 `backend/app/api/v1/admin/__init__.py`

```python
from fastapi import APIRouter
from app.api.v1.admin.stocks import router as stocks_router

admin_router = APIRouter()
admin_router.include_router(stocks_router)
```

### 2.6 Update `backend/app/api/v1/router.py`

Add stocks and admin router registrations:

```python
from fastapi import APIRouter
from app.api.v1 import auth, users, stocks
from app.api.v1.admin import admin_router

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(stocks.router, tags=["stocks"])
api_router.include_router(admin_router, tags=["admin"])
```

---

## 3. API Endpoint Specifications

### 3.1 `GET /api/v1/stocks?page=1&size=20&search=SPY`

**Response 200**:
```json
{
  "items": [{
    "id": 1, "symbol": "SPY", "name": "SPDR S&P 500 ETF Trust",
    "type": "ETF", "market": "US", "sector": "Large Cap",
    "is_active": true, "created_at": "...", "updated_at": "..."
  }],
  "total": 10, "page": 1, "size": 20, "pages": 1
}
```

### 3.2 `GET /api/v1/stocks/{id}`

Same shape as `StockOut` item.

### 3.3 `GET /api/v1/stocks/{id}/kline?limit=200`

```json
{
  "symbol": "SPY",
  "period": "day",
  "data": [{
    "time": "2026-06-09",
    "open": 525.10, "high": 528.50, "low": 524.20, "close": 527.80,
    "volume": 65000000,
    "ma20": 521.45, "ma60": 515.30, "rsi14": 58.20,
    "signal": {
      "id": 142, "type": "buy", "subtype": "golden_cross",
      "strength": "strong", "price": 527.80,
      "ai_summary": "Golden cross detected on SPY at..."
    }
  }]
}
```

### 3.4 `POST /api/v1/admin/stocks`

**Request**: `{"symbol": "AAPL", "name": "Apple Inc.", "type": "Stock", "market": "US", "sector": "Technology"}`

**Response 201**: `StockOut`

### 3.5 `PATCH /api/v1/admin/stocks/{id}`

Partial update of name, type, sector, is_active.

### 3.6 `DELETE /api/v1/admin/stocks/{id}`

Soft-delete (sets `is_active=False`).

### 3.7 `POST /api/v1/admin/stocks/{id}/sync`

Triggers yfinance incremental sync. Returns `{"symbol": "SPY", "new_rows": 1, "detail": "Sync complete"}`.

---

## 4. Test Specifications

### 4.1 `backend/tests/test_stock_data.py`

```python
import pytest
from datetime import date, timedelta
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.models.stock import Stock, StockPriceDaily
from app.services.stock_data import DataService


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
async def admin_token(client: AsyncClient):
    r = await client.post("/api/v1/auth/login", json={
        "email": "admin@trend-scope.com", "password": "Admin123!"
    })
    assert r.status_code == 200
    return r.json()["access_token"]


@pytest.mark.asyncio
async def test_list_stocks(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}
    r = await client.get("/api/v1/stocks?page=1&size=20", headers=headers)
    assert r.status_code == 200
    data = r.json()
    assert "items" in data
    assert "total" in data
    assert data["total"] >= 10  # Seed data has 10 ETFs

@pytest.mark.asyncio
async def test_list_stocks_search(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}
    r = await client.get("/api/v1/stocks?search=SPY", headers=headers)
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) >= 1
    assert items[0]["symbol"] == "SPY"

@pytest.mark.asyncio
async def test_get_stock_by_id(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}
    r = await client.get("/api/v1/stocks/1", headers=headers)
    assert r.status_code == 200
    assert r.json()["symbol"] == "SPY"

@pytest.mark.asyncio
async def test_get_stock_not_found(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}
    r = await client.get("/api/v1/stocks/99999", headers=headers)
    assert r.status_code == 404

@pytest.mark.asyncio
async def test_admin_create_stock(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}
    r = await client.post("/api/v1/admin/stocks", json={
        "symbol": "TEST",
        "name": "Test Stock",
        "type": "ETF",
        "market": "US",
        "sector": "Test",
    }, headers=headers)
    assert r.status_code == 201
    assert r.json()["symbol"] == "TEST"

@pytest.mark.asyncio
async def test_admin_create_duplicate_stock(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}
    r = await client.post("/api/v1/admin/stocks", json={
        "symbol": "SPY",
        "name": "Duplicate",
        "type": "ETF",
        "market": "US",
    }, headers=headers)
    assert r.status_code == 409

@pytest.mark.asyncio
async def test_admin_update_stock(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}
    r = await client.patch("/api/v1/admin/stocks/1", json={
        "sector": "Updated Sector"
    }, headers=headers)
    assert r.status_code == 200
    assert r.json()["sector"] == "Updated Sector"

@pytest.mark.asyncio
async def test_admin_delete_stock_soft(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}
    r = await client.delete("/api/v1/admin/stocks/1", headers=headers)
    assert r.status_code == 200
    # Verify is_active is false
    r2 = await client.get("/api/v1/stocks/1", headers=headers)
    assert r2.status_code == 404  # Inactive stocks not returned by public list

@pytest.mark.asyncio
async def test_non_admin_cannot_create_stock(client: AsyncClient, admin_token: str):
    # Register regular user
    r = await client.post("/api/v1/auth/register", json={
        "email": "regtest@example.com", "password": "test123456"
    })
    r = await client.post("/api/v1/auth/login", json={
        "email": "regtest@example.com", "password": "test123456"
    })
    user_token = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {user_token}"}

    r = await client.post("/api/v1/admin/stocks", json={
        "symbol": "NOACCESS", "name": "No Access", "type": "ETF", "market": "US"
    }, headers=headers)
    assert r.status_code == 403

@pytest.mark.asyncio
async def test_kline_empty_when_no_data(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}
    r = await client.get("/api/v1/stocks/1/kline?limit=10", headers=headers)
    # May return empty data if no prices synced yet
    assert r.status_code == 200
    data = r.json()
    assert data["symbol"] == "SPY"
    assert "data" in data

@pytest.mark.asyncio
async def test_data_service_fetch_historical():
    ds = DataService()
    df = ds.fetch_historical("SPY", period="1mo")
    assert not df.empty
    assert "Open" in df.columns
    assert "Close" in df.columns
    assert "Volume" in df.columns


@pytest.mark.asyncio
async def test_data_service_sync_latest(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}

    # Create a test stock first
    r = await client.post("/api/v1/admin/stocks", json={
        "symbol": "AAPL", "name": "Apple Inc.", "type": "Stock", "market": "US", "sector": "Technology"
    }, headers=headers)
    assert r.status_code == 201
    stock_id = r.json()["id"]

    # Trigger sync
    r = await client.post(f"/api/v1/admin/stocks/{stock_id}/sync", headers=headers)
    assert r.status_code == 200
    result = r.json()
    assert result["symbol"] == "AAPL"
    assert result["new_rows"] > 0

    # Verify kline now returns data
    r = await client.get(f"/api/v1/stocks/{stock_id}/kline?limit=200", headers=headers)
    assert r.status_code == 200
    assert len(r.json()["data"]) > 0
```

---

## 5. K-line Indicator Computation Details

### MA20 (20-day Simple Moving Average)
```python
ma20 = close_prices.rolling(window=20).mean()
```

### MA60 (60-day Simple Moving Average)
```python
ma60 = close_prices.rolling(window=60).mean()
```

### RSI14 (14-day Relative Strength Index)
```python
delta = close_prices.diff()
gain = delta.clip(lower=0)
loss = (-delta).clip(lower=0)
avg_gain = gain.rolling(window=14).mean()
avg_loss = loss.rolling(window=14).mean()
rs = avg_gain / avg_loss
rsi = 100 - (100 / (1 + rs))
```

### Signal Annotation
Active `AnalysisSignal` records for the stock within the queried date range are fetched via a JOIN with `AIAnalysisResult`. Each date with a signal gets the `signal` field populated; dates without signals get `signal: null`.

---

## 6. Acceptance Criteria

- [ ] `DataService.fetch_historical()` works for any valid US symbol, returns DataFrame with OHLCV
- [ ] `DataService.sync_latest()` detects last `trade_date` in DB, fetches only new rows, deduplicates on `(stock_id, trade_date)`
- [ ] `DataService.get_kline()` returns correctly formatted list with MA20/MA60/RSI14 computed
- [ ] `get_kline()` attaches active signal data (with optional AI summary) for matching dates
- [ ] `GET /stocks` returns paginated list with search by symbol or name
- [ ] `GET /stocks/{id}` returns single stock details
- [ ] `GET /stocks/{id}/kline?limit=200` returns `{symbol, period, data: [...]}` in correct shape
- [ ] K-line response includes computed MA20, MA60, RSI14 as nullable floats (null for early periods with insufficient data)
- [ ] `POST /admin/stocks` creates a new stock (admin only)
- [ ] `PATCH /admin/stocks/{id}` updates stock fields (admin only)
- [ ] `DELETE /admin/stocks/{id}` soft-deletes (sets `is_active=False`)
- [ ] `POST /admin/stocks/{id}/sync` triggers incremental yfinance sync (admin only)
- [ ] Non-admin users get 403 on all `/admin/*` endpoints
- [ ] Unauthenticated users get 401 on all stocks endpoints
- [ ] Decimal precision: prices stored as `Decimal(12,4)`, volume as `BIGINT`
- [ ] All tests in `test_stock_data.py` pass

---

## 7. Estimated Time Breakdown

| Subtask | Est. Time |
|---|---|
| `stock_data.py` — DataService class (3 methods) | 3h |
| `schemas/stock.py` — Pydantic models | 0.75h |
| `api/v1/stocks.py` — public endpoints (3) | 1h |
| `api/v1/admin/stocks.py` — admin CRUD (5 endpoints) | 1.5h |
| `api/v1/admin/__init__.py` + router update | 0.25h |
| K-line indicator computation (MA20/MA60/RSI14) | 1.5h |
| Signal annotation in K-line | 1h |
| Tests — stock data service + API | 2.5h |
| Docker verification + debugging | 1.5h |
| **Total** | **~13h (2-2.5 days)** |
