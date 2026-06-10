from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4

import pandas as pd
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core.deps import AsyncSessionLocal
from app.main import app
from app.models.stock import Stock, StockPriceDaily
from app.services.stock_data import DataService


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as async_client:
        yield async_client


@pytest.fixture
async def admin_token(client: AsyncClient) -> str:
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": "admin@trend-scope.com", "password": "Admin123!"},
    )
    assert response.status_code == 200
    return response.json()["access_token"]


@pytest.fixture
async def regular_token(client: AsyncClient) -> str:
    email = f"regular-{uuid4().hex}@example.com"
    response = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "test123456"},
    )
    assert response.status_code == 201
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "test123456"},
    )
    assert response.status_code == 200
    return response.json()["access_token"]


@pytest.mark.asyncio
async def test_list_search_and_get_stock(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}
    response = await client.get("/api/v1/stocks?page=1&size=20", headers=headers)
    assert response.status_code == 200
    assert response.json()["total"] >= 10

    response = await client.get("/api/v1/stocks?search=SPY", headers=headers)
    assert response.status_code == 200
    assert any(item["symbol"] == "SPY" for item in response.json()["items"])

    response = await client.get("/api/v1/stocks/1", headers=headers)
    assert response.status_code == 200
    assert response.json()["symbol"] == "SPY"


@pytest.mark.asyncio
async def test_stocks_require_auth(client: AsyncClient):
    response = await client.get("/api/v1/stocks")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_admin_create_update_delete_stock(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}
    symbol = f"T{uuid4().hex[:6]}".upper()
    create_response = await client.post(
        "/api/v1/admin/stocks",
        json={"symbol": symbol, "name": "Temp ETF", "type": "ETF", "market": "US", "sector": "Temp"},
        headers=headers,
    )
    assert create_response.status_code == 201
    stock_id = create_response.json()["id"]

    duplicate_response = await client.post(
        "/api/v1/admin/stocks",
        json={"symbol": symbol, "name": "Duplicate", "type": "ETF", "market": "US"},
        headers=headers,
    )
    assert duplicate_response.status_code == 409

    update_response = await client.patch(
        f"/api/v1/admin/stocks/{stock_id}",
        json={"sector": "Updated"},
        headers=headers,
    )
    assert update_response.status_code == 200
    assert update_response.json()["sector"] == "Updated"

    delete_response = await client.delete(f"/api/v1/admin/stocks/{stock_id}", headers=headers)
    assert delete_response.status_code == 200

    public_response = await client.get(f"/api/v1/stocks/{stock_id}", headers=headers)
    assert public_response.status_code == 404


@pytest.mark.asyncio
async def test_non_admin_cannot_create_stock(client: AsyncClient, regular_token: str):
    response = await client.post(
        "/api/v1/admin/stocks",
        json={"symbol": f"N{uuid4().hex[:6]}", "name": "No Access", "type": "ETF", "market": "US"},
        headers={"Authorization": f"Bearer {regular_token}"},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_kline_empty_and_with_indicator_data(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}
    symbol = f"K{uuid4().hex[:6]}".upper()
    create_response = await client.post(
        "/api/v1/admin/stocks",
        json={"symbol": symbol, "name": "Kline ETF", "type": "ETF", "market": "US"},
        headers=headers,
    )
    stock_id = create_response.json()["id"]

    empty_response = await client.get(f"/api/v1/stocks/{stock_id}/kline?limit=10", headers=headers)
    assert empty_response.status_code == 200
    assert empty_response.json()["data"] == []

    async with AsyncSessionLocal() as db:
        for offset in range(65):
            db.add(
                StockPriceDaily(
                    stock_id=stock_id,
                    trade_date=date(2024, 1, 1) + timedelta(days=offset),
                    open=Decimal("100.0000") + offset,
                    high=Decimal("101.0000") + offset,
                    low=Decimal("99.0000") + offset,
                    close=Decimal("100.5000") + offset,
                    volume=1000000 + offset,
                    data_source="test",
                )
            )
        await db.commit()

    response = await client.get(f"/api/v1/stocks/{stock_id}/kline?limit=65", headers=headers)
    assert response.status_code == 200
    data = response.json()["data"]
    assert len(data) == 65
    assert data[-1]["ma20"] is not None
    assert data[-1]["ma60"] is not None
    assert data[-1]["rsi14"] is not None


def test_fetch_historical_uses_yfinance(monkeypatch: pytest.MonkeyPatch):
    class FakeTicker:
        def __init__(self, symbol: str):
            self.symbol = symbol

        def history(self, period: str, interval: str, auto_adjust: bool):
            assert self.symbol == "SPY"
            assert period == "1mo"
            assert interval == "1d"
            assert auto_adjust is True
            return pd.DataFrame(
                {"Open": [100.0], "High": [101.0], "Low": [99.0], "Close": [100.5], "Volume": [1000]},
                index=pd.to_datetime(["2024-01-02"]),
            )

    monkeypatch.setattr("app.services.stock_data.yf.Ticker", FakeTicker)

    df = DataService().fetch_historical("SPY", period="1mo")

    assert not df.empty
    assert df.index.name == "Date"
    assert str(df.index[0]) == "2024-01-02"


@pytest.mark.asyncio
async def test_sync_latest_inserts_only_new_rows(monkeypatch: pytest.MonkeyPatch):
    symbol = f"S{uuid4().hex[:6]}".upper()

    class FakeTicker:
        def __init__(self, ticker_symbol: str):
            assert ticker_symbol == symbol

        def history(self, start, auto_adjust: bool):
            assert auto_adjust is True
            return pd.DataFrame(
                {
                    "Open": [100.0, 101.0],
                    "High": [101.0, 102.0],
                    "Low": [99.0, 100.0],
                    "Close": [100.5, 101.5],
                    "Volume": [1000, 1100],
                },
                index=pd.to_datetime(["2024-01-02", "2024-01-03"]),
            )

    monkeypatch.setattr("app.services.stock_data.yf.Ticker", FakeTicker)

    async with AsyncSessionLocal() as db:
        stock = Stock(symbol=symbol, name="Sync ETF", type="ETF", market="US", is_active=True)
        db.add(stock)
        await db.commit()

        first_count = await DataService().sync_latest(db, symbol)
        await db.commit()
        second_count = await DataService().sync_latest(db, symbol)

        rows = (
            await db.execute(select(StockPriceDaily).where(StockPriceDaily.stock_id == stock.id))
        ).scalars().all()

    assert first_count == 2
    assert second_count == 0
    assert len(rows) == 2
    assert rows[0].data_source == "yfinance"


@pytest.mark.asyncio
async def test_admin_sync_stock_endpoint_uses_data_service(
    client: AsyncClient,
    admin_token: str,
    monkeypatch: pytest.MonkeyPatch,
):
    async def fake_sync_latest(self, db, symbol: str):
        assert symbol.startswith("Y")
        return 3

    monkeypatch.setattr(DataService, "sync_latest", fake_sync_latest)

    headers = {"Authorization": f"Bearer {admin_token}"}
    symbol = f"Y{uuid4().hex[:6]}".upper()
    create_response = await client.post(
        "/api/v1/admin/stocks",
        json={"symbol": symbol, "name": "Sync Endpoint ETF", "type": "ETF", "market": "US"},
        headers=headers,
    )
    assert create_response.status_code == 201

    response = await client.post(f"/api/v1/admin/stocks/{create_response.json()['id']}/sync", headers=headers)

    assert response.status_code == 200
    assert response.json() == {"symbol": symbol, "new_rows": 3, "detail": "Sync complete"}
