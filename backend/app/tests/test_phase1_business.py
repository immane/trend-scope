from datetime import date, timedelta
from decimal import Decimal

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.deps import AsyncSessionLocal
from app.main import app
from app.models.alert import AlertRule
from app.models.analysis import AnalysisConfig, AnalysisSignal
from app.models.stock import Stock, StockPriceDaily
from app.services.ai_analysis_service import AIAnalysisService
from app.services.alert_service import AlertService
from app.services.analysis_engine import SignalEngine
from app.services.backtest_service import BacktestService


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as async_client:
        yield async_client


@pytest.fixture
async def admin_headers(client: AsyncClient):
    response = await client.post("/api/v1/auth/login", json={"email": "admin@trend-scope.com", "password": "Admin123!"})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


async def seed_prices(stock_id: int = 1, days: int = 90):
    async with AsyncSessionLocal() as db:
        for offset in range(days):
            close = Decimal("100") + Decimal(offset if offset < 45 else 90 - offset)
            db.add(
                StockPriceDaily(
                    stock_id=stock_id,
                    trade_date=date(2024, 1, 1) + timedelta(days=offset),
                    open=close,
                    high=close + Decimal("1"),
                    low=close - Decimal("1"),
                    close=close,
                    volume=1_000_000 + offset,
                    data_source="test",
                )
            )
        await db.commit()


@pytest.mark.asyncio
async def test_strategy_api_and_test_run(client: AsyncClient, admin_headers: dict):
    await seed_prices()
    response = await client.post(
        "/api/v1/admin/strategies",
        json={"stock_id": 1, "name": "MA Test", "strategy_type": "ma_cross", "params": {"ma_short": 3, "ma_long": 8}},
        headers=admin_headers,
    )
    assert response.status_code == 201
    strategy_id = response.json()["id"]

    response = await client.post(f"/api/v1/admin/strategies/{strategy_id}/test-run", json={"stock_id": 1, "limit": 90}, headers=admin_headers)
    assert response.status_code == 200
    assert "signals" in response.json()

    response = await client.get("/api/v1/admin/strategies", headers=admin_headers)
    assert response.status_code == 200
    assert response.json()["total"] >= 1


@pytest.mark.asyncio
async def test_signal_backtest_ai_and_alert_flow(client: AsyncClient, admin_headers: dict):
    await seed_prices()
    async with AsyncSessionLocal() as db:
        config = AnalysisConfig(stock_id=1, name="MA Test", strategy_type="ma_cross", params={"ma_short": 3, "ma_long": 8}, created_by=1)
        db.add(config)
        await db.commit()
        await db.refresh(config)

        signals = await SignalEngine(db).scan_config(config)
        if not signals:
            signal = AnalysisSignal(
                stock_id=1,
                config_id=config.id,
                signal_type="buy",
                signal_subtype="ma_cross",
                strength="normal",
                confidence=Decimal("0.700"),
                trigger_price=Decimal("120"),
                trigger_details={},
                triggered_date=date(2024, 3, 1),
                is_active=True,
            )
            db.add(signal)
            await db.flush()
        else:
            signal = signals[0]

        backtest = await BacktestService(db).run_backtest(1, config.id, date(2024, 1, 1), date(2024, 3, 30), 1)
        assert backtest.status == "completed"
        assert backtest.equity_curve

        analysis = await AIAnalysisService(db).analyze_and_store(signal.id)
        assert "summary" in analysis.analysis_json

        db.add(AlertRule(user_id=1, stock_id=1, alert_type="any_signal", is_active=True))
        await db.flush()
        logs = await AlertService(db).dispatch_signal(signal.id)
        assert len(logs) == 1
        assert logs[0].status == "sent"


@pytest.mark.asyncio
async def test_backtest_and_dashboard_endpoints(client: AsyncClient, admin_headers: dict):
    await seed_prices()
    strategy = await client.post(
        "/api/v1/admin/strategies",
        json={"stock_id": 1, "name": "Endpoint MA", "strategy_type": "ma_cross", "params": {"ma_short": 3, "ma_long": 8}},
        headers=admin_headers,
    )
    assert strategy.status_code == 201
    response = await client.post(
        "/api/v1/backtest/run",
        json={"stock_id": 1, "config_id": strategy.json()["id"], "start_date": "2024-01-01", "end_date": "2024-03-30"},
        headers=admin_headers,
    )
    assert response.status_code == 200
    assert response.json()["status"] == "completed"
    backtest_id = response.json()["id"]

    response = await client.get(f"/api/v1/admin/backtests/{backtest_id}", headers=admin_headers)
    assert response.status_code == 200
    assert response.json()["id"] == backtest_id

    response = await client.get("/api/v1/admin/dashboard/stats", headers=admin_headers)
    assert response.status_code == 200
    assert response.json()["stocks"] >= 10


@pytest.mark.asyncio
async def test_backtest_auto_syncs_missing_dev_data():
    async with AsyncSessionLocal() as db:
        stock = Stock(symbol="AUTO", name="Auto Sync ETF", type="ETF", market="US", is_active=True)
        db.add(stock)
        await db.flush()
        config = AnalysisConfig(stock_id=stock.id, name="Auto MA", strategy_type="ma_cross", params={"ma_short": 20, "ma_long": 60}, created_by=1)
        db.add(config)
        await db.commit()
        await db.refresh(stock)
        await db.refresh(config)

        result = await BacktestService(db).run_backtest(stock.id, config.id, date(2024, 1, 1), date(2024, 12, 31), 1)

        assert result.status == "completed"
        assert result.equity_curve
        assert result.error_message is None


@pytest.mark.asyncio
async def test_custom_script_strategy_can_be_created_and_backtested(client: AsyncClient, admin_headers: dict):
    await seed_prices()
    script = """
def analyze(df, params):
    short = int(params.get("short", 3))
    long = int(params.get("long", 8))
    fast = df["close"].rolling(short).mean()
    slow = df["close"].rolling(long).mean()
    signal = pd.Series(0, index=df.index)
    signal[(fast.shift(1) <= slow.shift(1)) & (fast > slow)] = 1
    signal[(fast.shift(1) >= slow.shift(1)) & (fast < slow)] = -1
    return signal.shift(1).fillna(0)
"""
    response = await client.post("/api/v1/admin/strategies/validate", json={"script_content": script}, headers=admin_headers)
    assert response.status_code == 200
    assert response.json()["valid"] is True

    response = await client.post(
        "/api/v1/admin/strategies",
        json={
            "stock_id": 1,
            "name": "Custom Script Test",
            "strategy_type": "custom_script",
            "params": {},
            "script_content": script,
            "script_params": {"short": 3, "long": 8},
        },
        headers=admin_headers,
    )
    assert response.status_code == 201
    strategy_id = response.json()["id"]

    response = await client.post(
        "/api/v1/backtest/run",
        json={"stock_id": 1, "config_id": strategy_id, "start_date": "2024-01-01", "end_date": "2024-03-30"},
        headers=admin_headers,
    )
    assert response.status_code == 200
    assert response.json()["status"] == "completed"
