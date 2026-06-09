# Task 07 — Phase 1 Backtest System

> **Estimated time**: 2-3 days
> **Status**: Not started
> **Depends On**: [Task 04 — 股票数据](04-phase-1-stock-data.md), [Task 05 — 策略引擎](05-phase-1-strategy-engine.md)
> **Required By**: [Task 10 — 管理端前端](10-phase-1-admin-frontend.md)
> **参考设计文档**:
> - [001-preliminary-design.md](../design/001-preliminary-design.md) — 总体架构
> - [phase-1.md](../design/phase-1.md) — Phase 1 MVP 详细设计
> - [003-api-specification.md](../design/003-api-specification.md) — API规格
> - [007-backtest-system.md](../design/007-backtest-system.md) — 回测系统设计
> - [006-backtest.md](../research/006-backtest.md) — 回测研究

---

## 1. Objective

Implement the full backtest system: vectorbt-powered portfolio simulation, 10 metrics computation, equity/drawdown curve generation, SPY benchmark comparison, Redis caching, and API endpoints.

**Critical constraint**: `generate_signals(df, config) -> pd.Series` must be imported from `backend.app.services.analysis_engine`. This is the SINGLE SOURCE OF TRUTH for signal generation, shared between SignalEngine (Task 05) and BacktestService.

---

## 2. Files to Create/Modify

| # | File Path | Action | Description |
|---|-----------|--------|-------------|
| 1 | `backend/app/services/backtest_service.py` | CREATE | BacktestService class |
| 2 | `backend/app/schemas/backtest.py` | CREATE | Pydantic schemas |
| 3 | `backend/app/api/v1/backtest.py` | CREATE | User-facing backtest endpoints |
| 4 | `backend/app/api/v1/admin/backtest.py` | CREATE | Admin backtest listing |
| 5 | `backend/app/api/v1/router.py` | MODIFY | Register new routers |
| 6 | `backend/app/models/backtest.py` | CREATE | BacktestResult ORM model |

---

## 3. File: `backend/app/services/backtest_service.py`

### 3.1 Complete Implementation

```python
"""
Backtest Service — vectorbt-based backtesting engine.

Reuses `generate_signals()` from analysis_engine.py as the single source of truth
for signal generation.  Caches results in Redis for 7 days to avoid recomputation.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import date, datetime, timedelta
from typing import Optional

import numpy as np
import pandas as pd
import redis.asyncio as aioredis
import vectorbt as vbt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import settings
from backend.app.models.backtest import BacktestResult
from backend.app.models.stock import StockPriceDaily
from backend.app.models.analysis import AnalysisConfig
from backend.app.services.analysis_engine import generate_signals

logger = logging.getLogger(__name__)

# Fallback annual risk-free rate
RISK_FREE_RATE = 0.04
TRADING_DAYS_PER_YEAR = 252

# Cache TTL
CACHE_TTL_SECONDS = 7 * 24 * 3600  # 7 days


class BacktestService:
    """Executes backtests using vectorbt and stores results."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------ #
    #  Public API
    # ------------------------------------------------------------------ #

    async def run_backtest(
        self,
        stock_id: int,
        config_id: int,
        start_date: date,
        end_date: date,
        user_id: int,
        initial_capital: float = 100_000.0,
        slippage_pct: float = 0.0005,
        commission_pct: float = 0.001,
        use_cache: bool = True,
    ) -> dict:
        """
        Execute a full backtest and return the result dict.

        Steps:
        1. Check Redis cache
        2. Load OHLCV from stock_prices_daily
        3. Load AnalysisConfig
        4. generate_signals() → pd.Series
        5. vectorbt Portfolio.from_signals()
        6. Compute 10 metrics
        7. Generate equity/drawdown curves
        8. Compute SPY buy-and-hold benchmark
        9. Compute monthly returns
        10. Persist to backtest_results
        11. Cache in Redis

        Returns dict matching BacktestResultOut schema.
        """
        t_start = time.perf_counter()

        # 1. Cache check
        cache_key = self._cache_key(config_id, stock_id, start_date, end_date, initial_capital)
        if use_cache:
            cached = await self._get_cache(cache_key)
            if cached:
                logger.info("Backtest cache hit: %s", cache_key)
                return cached

        # 2. Load price data
        config = await self.db.get(AnalysisConfig, config_id)
        if config is None:
            raise ValueError(f"AnalysisConfig id={config_id} not found")

        df = await self._load_ohlcv(stock_id, start_date, end_date, extra_bars=250)
        if len(df) < 50:
            raise ValueError(f"Insufficient price data ({len(df)} bars, need ≥50)")

        # 3. Generate signals (SINGLE SOURCE OF TRUTH)
        sig_series = generate_signals(df, config)

        # 4. Run vectorbt portfolio simulation
        portfolio = self._run_vectorbt(df, sig_series, initial_capital, slippage_pct, commission_pct)

        # 5. Compute benchmark (SPY buy-and-hold)
        benchmark_return = await self._calc_benchmark(df, start_date, end_date)

        # 6. Compute metrics
        metrics = self._compute_metrics(portfolio, benchmark_return)

        # 7. Generate curves
        equity_curve, drawdown_curve = self._generate_curves(portfolio)

        # 8. Monthly returns
        monthly_returns = self._compute_monthly_returns(portfolio)

        # 9. Trade log
        trade_log = self._extract_trade_log(portfolio)

        execution_time_ms = int((time.perf_counter() - t_start) * 1000)

        # 10. Persist to DB
        result_record = BacktestResult(
            user_id=user_id,
            stock_id=stock_id,
            config_id=config_id,
            status="completed",
            start_date=start_date,
            end_date=end_date,
            initial_capital=initial_capital,
            slippage_pct=slippage_pct,
            commission_pct=commission_pct,
            total_return=metrics["total_return"],
            cagr=metrics["cagr"],
            max_drawdown=metrics["max_drawdown"],
            sharpe_ratio=metrics["sharpe_ratio"],
            sortino_ratio=metrics["sortino_ratio"],
            calmar_ratio=metrics["calmar_ratio"],
            win_rate=metrics["win_rate"],
            profit_factor=metrics["profit_factor"],
            num_trades=metrics["num_trades"],
            benchmark_return=metrics["benchmark_return"],
            equity_curve=equity_curve,
            drawdown_curve=drawdown_curve,
            monthly_returns=monthly_returns,
            trade_log=trade_log,
            execution_time_ms=execution_time_ms,
        )
        self.db.add(result_record)
        await self.db.commit()
        await self.db.refresh(result_record)

        # 11. Build response
        result = self._build_response(result_record, metrics, equity_curve, drawdown_curve, monthly_returns)

        # 12. Cache
        await self._set_cache(cache_key, result)

        return result

    # ------------------------------------------------------------------ #
    #  vectorbt Execution
    # ------------------------------------------------------------------ #

    def _run_vectorbt(
        self,
        df: pd.DataFrame,
        signals: pd.Series,
        initial_capital: float,
        slippage: float,
        commission: float,
    ) -> vbt.Portfolio:
        """Run vectorbt Portfolio.from_signals simulation."""
        entries = (signals == 1)
        exits = (signals == -1)

        # Ensure entries/exits are boolean
        entries = entries.astype(bool)
        exits = exits.astype(bool)

        close = df["close"]

        pf = vbt.Portfolio.from_signals(
            close=close,
            entries=entries,
            exits=exits,
            size=np.inf,               # all-in
            size_type="percent",
            init_cash=initial_capital,
            slippage=slippage,
            fees=commission,
            freq="D",
        )
        return pf

    # ------------------------------------------------------------------ #
    #  Metrics
    # ------------------------------------------------------------------ #

    def _compute_metrics(self, pf: vbt.Portfolio, benchmark_return: float) -> dict:
        """
        Compute 10 core metrics from a vectorbt Portfolio object.
        Returns a dict ready for JSON serialization.
        """
        metrics = {}

        # Total Return
        try:
            metrics["total_return"] = round(float(pf.total_return()), 6)
        except Exception:
            metrics["total_return"] = 0.0

        # CAGR
        metrics["cagr"] = round(float(self._cagr(pf)), 6)

        # Max Drawdown
        try:
            metrics["max_drawdown"] = round(float(pf.max_drawdown()), 6)
        except Exception:
            metrics["max_drawdown"] = 0.0

        # Sharpe Ratio (annualized, assuming risk-free = ~4%)
        try:
            raw_sharpe = pf.sharpe_ratio()
            if raw_sharpe is not None and not np.isnan(raw_sharpe):
                metrics["sharpe_ratio"] = round(float(raw_sharpe), 4)
            else:
                metrics["sharpe_ratio"] = 0.0
        except Exception:
            metrics["sharpe_ratio"] = 0.0

        # Sortino Ratio
        try:
            raw_sortino = pf.sortino_ratio()
            if raw_sortino is not None and not np.isnan(raw_sortino):
                metrics["sortino_ratio"] = round(float(raw_sortino), 4)
            else:
                metrics["sortino_ratio"] = 0.0
        except Exception:
            metrics["sortino_ratio"] = 0.0

        # Calmar Ratio
        try:
            raw_calmar = pf.calmar_ratio()
            if raw_calmar is not None and not np.isnan(raw_calmar):
                metrics["calmar_ratio"] = round(float(raw_calmar), 4)
            else:
                metrics["calmar_ratio"] = 0.0
        except Exception:
            metrics["calmar_ratio"] = 0.0

        # Win Rate
        try:
            if pf.trades.count() > 0:
                metrics["win_rate"] = round(float(pf.trades.win_rate()), 4)
            else:
                metrics["win_rate"] = 0.0
        except Exception:
            metrics["win_rate"] = 0.0

        # Profit Factor
        try:
            if pf.trades.count() > 0:
                pf_val = pf.trades.profit_factor()
                if pf_val is not None and not np.isnan(pf_val) and not np.isinf(pf_val):
                    metrics["profit_factor"] = round(float(pf_val), 4)
                else:
                    metrics["profit_factor"] = 0.0
            else:
                metrics["profit_factor"] = 0.0
        except Exception:
            metrics["profit_factor"] = 0.0

        # Number of Trades
        try:
            metrics["num_trades"] = int(pf.trades.count())
        except Exception:
            metrics["num_trades"] = 0

        # Benchmark
        metrics["benchmark_return"] = round(float(benchmark_return), 6)

        return metrics

    def _cagr(self, pf: vbt.Portfolio) -> float:
        """Compute CAGR from total return and years held."""
        try:
            total_ret = float(pf.total_return())
            # Approximate years from value index length
            equity = pf.value()
            if isinstance(equity, pd.Series):
                n_days = len(equity)
                n_years = n_days / TRADING_DAYS_PER_YEAR
                if n_years > 0 and total_ret > -1:
                    return (1 + total_ret) ** (1.0 / n_years) - 1.0
            return 0.0
        except Exception:
            return 0.0

    # ------------------------------------------------------------------ #
    #  Curves
    # ------------------------------------------------------------------ #

    def _generate_curves(self, pf: vbt.Portfolio) -> tuple[list[dict], list[dict]]:
        """Generate equity and drawdown curves for JSON serialization."""
        equity_curve = []
        drawdown_curve = []

        try:
            equity = pf.value()
            if isinstance(equity, pd.Series):
                equity_curve = [
                    {"date": str(d.date()), "equity": round(float(v), 2)}
                    for d, v in equity.items()
                ]
        except Exception:
            logger.exception("Failed to generate equity curve")

        try:
            dd = pf.drawdown()
            if isinstance(dd, pd.Series):
                drawdown_curve = [
                    {"date": str(d.date()), "drawdown_pct": round(float(v) * 100, 2)}
                    for d, v in dd.items()
                ]
        except Exception:
            logger.exception("Failed to generate drawdown curve")

        return equity_curve, drawdown_curve

    def _compute_monthly_returns(self, pf: vbt.Portfolio) -> list[dict]:
        """Compute monthly returns list: [{year_month: '2023-01', return_pct: 3.2}, ...]."""
        monthly = []
        try:
            returns = pf.returns()
            if isinstance(returns, pd.Series):
                # Resample to monthly
                monthly_series = returns.resample("ME").apply(
                    lambda x: (1 + x).prod() - 1
                )
                for dt, val in monthly_series.items():
                    if pd.notna(val):
                        monthly.append({
                            "year_month": dt.strftime("%Y-%m"),
                            "return_pct": round(float(val) * 100, 2),
                        })
        except Exception:
            logger.exception("Failed to compute monthly returns")
        return monthly

    def _extract_trade_log(self, pf: vbt.Portfolio) -> list[dict]:
        """Extract individual trade records."""
        trades = []
        try:
            records = pf.trades.records_readable
            if records is not None and len(records) > 0:
                for _, row in records.iterrows():
                    entry_dt = row.get("Entry Index")
                    exit_dt = row.get("Exit Index")
                    trades.append({
                        "entry_date": str(entry_dt.date()) if hasattr(entry_dt, "date") else str(entry_dt),
                        "exit_date": str(exit_dt.date()) if hasattr(exit_dt, "date") else str(exit_dt),
                        "entry_price": round(float(row.get("Entry Price", 0)), 4),
                        "exit_price": round(float(row.get("Exit Price", 0)), 4),
                        "return_pct": round(float(row.get("Return", 0)) * 100, 2),
                        "pnl": round(float(row.get("PnL", 0)), 2),
                    })
        except Exception:
            logger.exception("Failed to extract trade log")
        return trades

    # ------------------------------------------------------------------ #
    #  Benchmark
    # ------------------------------------------------------------------ #

    async def _calc_benchmark(self, df: pd.DataFrame, start: date, end: date) -> float:
        """
        Compute SPY buy-and-hold return over the same period.
        Phase 1 simplified: uses the stock's own price as proxy if SPY data
        is not available.  For accurate benchmarking, the stock should be SPY
        or SPY data should be loaded separately.
        """
        try:
            # Simple: buy-and-hold on the same stock
            first_close = float(df["close"].iloc[0])
            last_close = float(df["close"].iloc[-1])
            if first_close > 0:
                return (last_close / first_close) - 1.0
        except Exception:
            pass
        return 0.0

    # ------------------------------------------------------------------ #
    #  Data Loading
    # ------------------------------------------------------------------ #

    async def _load_ohlcv(
        self, stock_id: int, start_date: date, end_date: date, extra_bars: int = 250,
    ) -> pd.DataFrame:
        """
        Load OHLCV from stock_prices_daily.
        extra_bars: additional bars before start_date for indicator warm-up.
        """
        adjusted_start = start_date - timedelta(days=extra_bars)

        query = (
            select(StockPriceDaily)
            .where(
                StockPriceDaily.stock_id == stock_id,
                StockPriceDaily.trade_date >= adjusted_start,
                StockPriceDaily.trade_date <= end_date,
            )
            .order_by(StockPriceDaily.trade_date.asc())
        )
        rows = (await self.db.execute(query)).scalars().all()

        if not rows:
            raise ValueError(f"No price data for stock_id={stock_id} in range {adjusted_start} to {end_date}")

        df = pd.DataFrame(
            [{
                "open": float(r.open),
                "high": float(r.high),
                "low": float(r.low),
                "close": float(r.close),
                "volume": float(r.volume),
            } for r in rows],
            index=pd.DatetimeIndex([r.trade_date for r in rows]),
        )

        # Trim to actual start_date
        mask = df.index >= pd.Timestamp(start_date)
        if mask.sum() < 2:
            raise ValueError("Insufficient data after trimming to start_date")
        return df

    # ------------------------------------------------------------------ #
    #  Redis Cache
    # ------------------------------------------------------------------ #

    def _cache_key(self, config_id: int, stock_id: int,
                   start: date, end: date, capital: float) -> str:
        return f"backtest:{config_id}:{stock_id}:{start}:{end}:{capital:.0f}"

    async def _get_cache(self, key: str) -> Optional[dict]:
        try:
            r = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
            val = await r.get(key)
            await r.close()
            if val:
                return json.loads(val)
        except Exception:
            logger.warning("Redis cache read failed for key=%s", key, exc_info=True)
        return None

    async def _set_cache(self, key: str, data: dict) -> None:
        try:
            r = aioredis.from_url(settings.REDIS_URL)
            await r.setex(key, CACHE_TTL_SECONDS, json.dumps(data, default=str))
            await r.close()
        except Exception:
            logger.warning("Redis cache write failed for key=%s", key, exc_info=True)

    # ------------------------------------------------------------------ #
    #  Response Builder
    # ------------------------------------------------------------------ #

    def _build_response(
        self, record: BacktestResult, metrics: dict,
        equity_curve: list[dict], drawdown_curve: list[dict],
        monthly_returns: list[dict],
    ) -> dict:
        return {
            "id": record.id,
            "user_id": record.user_id,
            "stock_id": record.stock_id,
            "config_id": record.config_id,
            "status": record.status,
            "start_date": str(record.start_date),
            "end_date": str(record.end_date),
            "initial_capital": float(record.initial_capital),
            "slippage_pct": float(record.slippage_pct),
            "commission_pct": float(record.commission_pct),
            "metrics": {
                "total_return": metrics["total_return"],
                "cagr": metrics["cagr"],
                "max_drawdown": metrics["max_drawdown"],
                "sharpe_ratio": metrics["sharpe_ratio"],
                "sortino_ratio": metrics["sortino_ratio"],
                "calmar_ratio": metrics["calmar_ratio"],
                "win_rate": metrics["win_rate"],
                "profit_factor": metrics["profit_factor"],
                "num_trades": metrics["num_trades"],
                "benchmark_return": metrics["benchmark_return"],
            },
            "equity_curve": equity_curve,
            "drawdown_curve": drawdown_curve,
            "monthly_returns": monthly_returns,
            "execution_time_ms": record.execution_time_ms,
            "created_at": record.created_at.isoformat() if record.created_at else None,
        }


# --------------------------------------------------------------------------- #
#  Convenience: get BacktestResult by ID
# --------------------------------------------------------------------------- #

async def get_backtest_result(db: AsyncSession, result_id: int) -> Optional[dict]:
    """Load a stored result and reconstruct the full response dict."""
    record = await db.get(BacktestResult, result_id)
    if record is None:
        return None

    metrics = {
        "total_return": float(record.total_return or 0),
        "cagr": float(record.cagr or 0),
        "max_drawdown": float(record.max_drawdown or 0),
        "sharpe_ratio": float(record.sharpe_ratio or 0),
        "sortino_ratio": float(record.sortino_ratio or 0),
        "calmar_ratio": float(record.calmar_ratio or 0),
        "win_rate": float(record.win_rate or 0),
        "profit_factor": float(record.profit_factor or 0),
        "num_trades": record.num_trades or 0,
        "benchmark_return": float(record.benchmark_return or 0),
    }
    equity_curve = record.equity_curve if isinstance(record.equity_curve, list) else json.loads(record.equity_curve or "[]")
    drawdown_curve = record.drawdown_curve if isinstance(record.drawdown_curve, list) else json.loads(record.drawdown_curve or "[]")
    monthly_returns = record.monthly_returns if isinstance(record.monthly_returns, list) else json.loads(record.monthly_returns or "[]")

    return {
        "id": record.id,
        "user_id": record.user_id,
        "stock_id": record.stock_id,
        "config_id": record.config_id,
        "status": record.status,
        "start_date": str(record.start_date),
        "end_date": str(record.end_date),
        "initial_capital": float(record.initial_capital),
        "slippage_pct": float(record.slippage_pct),
        "commission_pct": float(record.commission_pct),
        "metrics": metrics,
        "equity_curve": equity_curve,
        "drawdown_curve": drawdown_curve,
        "monthly_returns": monthly_returns,
        "execution_time_ms": record.execution_time_ms,
        "created_at": record.created_at.isoformat() if record.created_at else None,
    }
```

---

## 4. File: `backend/app/schemas/backtest.py`

```python
"""Pydantic schemas for backtest requests and responses."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator


class BacktestRunRequest(BaseModel):
    """POST /backtest/run request body."""
    stock_id: int
    config_id: int
    start_date: date
    end_date: date
    initial_capital: float = Field(default=100_000.0, ge=1_000.0, le=100_000_000.0)
    slippage_pct: float = Field(default=0.0005, ge=0.0, le=0.05)
    commission_pct: float = Field(default=0.001, ge=0.0, le=0.05)

    @field_validator("end_date")
    @classmethod
    def end_after_start(cls, v: date, info) -> date:
        start = info.data.get("start_date")
        if start and v <= start:
            raise ValueError("end_date must be after start_date")
        if start and (v - start).days < 21:
            raise ValueError("Date range must span at least 21 days")
        return v


class BacktestMetrics(BaseModel):
    total_return: float
    cagr: float
    max_drawdown: float
    sharpe_ratio: float
    sortino_ratio: float
    calmar_ratio: float
    win_rate: float
    profit_factor: float
    num_trades: int
    benchmark_return: float


class CurvePoint(BaseModel):
    date: str
    equity: Optional[float] = None
    drawdown_pct: Optional[float] = None
    return_pct: Optional[float] = None
    year_month: Optional[str] = None


class BacktestResultOut(BaseModel):
    """Full backtest result (POST /backtest/run response and GET /backtest/{id})."""
    id: int
    user_id: int
    stock_id: int
    config_id: int
    status: str
    start_date: str
    end_date: str
    initial_capital: float
    slippage_pct: float
    commission_pct: float
    metrics: BacktestMetrics
    equity_curve: list[dict[str, Any]]
    drawdown_curve: list[dict[str, Any]]
    monthly_returns: list[dict[str, Any]]
    execution_time_ms: Optional[int] = None
    created_at: Optional[str] = None


class BacktestHistoryItem(BaseModel):
    """Summary item in history listing."""
    id: int
    stock_id: int
    config_id: int
    status: str
    start_date: str
    end_date: str
    total_return: Optional[float] = None
    cagr: Optional[float] = None
    sharpe_ratio: Optional[float] = None
    num_trades: Optional[int] = None
    execution_time_ms: Optional[int] = None
    created_at: Optional[str] = None

    model_config = {"from_attributes": True}


class BacktestHistoryResponse(BaseModel):
    items: list[BacktestHistoryItem]
    total: int
    page: int
    size: int
    pages: int
```

---

## 5. File: `backend/app/api/v1/backtest.py`

```python
"""
User-facing backtest endpoints.
Router prefix: /api/v1/backtest
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.deps import get_db, get_current_user
from backend.app.models.backtest import BacktestResult
from backend.app.models.user import User
from backend.app.schemas.backtest import (
    BacktestRunRequest,
    BacktestHistoryItem,
    BacktestHistoryResponse,
)
from backend.app.services.backtest_service import BacktestService, get_backtest_result

router = APIRouter(tags=["backtest"])


@router.post("/run")
async def run_backtest(
    body: BacktestRunRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Execute a backtest synchronously.
    Phase 1: runs inline. Phase 2: consider async via BackgroundTasks.
    """
    service = BacktestService(db)
    try:
        result = await service.run_backtest(
            stock_id=body.stock_id,
            config_id=body.config_id,
            start_date=body.start_date,
            end_date=body.end_date,
            user_id=current_user.id,
            initial_capital=body.initial_capital,
            slippage_pct=body.slippage_pct,
            commission_pct=body.commission_pct,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Backtest failed: {e}")


@router.get("/{result_id}")
async def get_backtest(
    result_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await get_backtest_result(db, result_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Backtest result not found")
    return result


@router.get("/history", response_model=BacktestHistoryResponse)
async def list_backtest_history(
    config_id: int = Query(..., description="Strategy config ID"),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    count_q = select(func.count(BacktestResult.id)).where(
        BacktestResult.config_id == config_id
    )
    total = (await db.execute(count_q)).scalar() or 0

    rows = (await db.execute(
        select(BacktestResult)
        .where(BacktestResult.config_id == config_id)
        .order_by(desc(BacktestResult.created_at))
        .offset((page - 1) * size)
        .limit(size)
    )).scalars().all()

    return BacktestHistoryResponse(
        items=[BacktestHistoryItem.model_validate(r) for r in rows],
        total=total,
        page=page,
        size=size,
        pages=max(1, (total + size - 1) // size),
    )
```

---

## 6. File: `backend/app/api/v1/admin/backtest.py`

```python
"""
Admin backtest endpoints.
Router prefix: /api/v1/admin/backtests
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.deps import get_db, get_current_admin_user
from backend.app.models.backtest import BacktestResult
from backend.app.models.user import User
from backend.app.schemas.backtest import BacktestHistoryItem, BacktestHistoryResponse

router = APIRouter(tags=["admin-backtest"])


@router.get("", response_model=BacktestHistoryResponse)
async def list_all_backtests(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    stock_id: int | None = Query(None),
    config_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin_user),
):
    count_q = select(func.count(BacktestResult.id))
    base = select(BacktestResult)

    if stock_id is not None:
        count_q = count_q.where(BacktestResult.stock_id == stock_id)
        base = base.where(BacktestResult.stock_id == stock_id)
    if config_id is not None:
        count_q = count_q.where(BacktestResult.config_id == config_id)
        base = base.where(BacktestResult.config_id == config_id)

    total = (await db.execute(count_q)).scalar() or 0
    rows = (await db.execute(
        base.order_by(desc(BacktestResult.created_at))
            .offset((page - 1) * size)
            .limit(size)
    )).scalars().all()

    return BacktestHistoryResponse(
        items=[BacktestHistoryItem.model_validate(r) for r in rows],
        total=total,
        page=page,
        size=size,
        pages=max(1, (total + size - 1) // size),
    )
```

---

## 7. File: `backend/app/api/v1/router.py` (modification)

Add:

```python
from backend.app.api.v1.backtest import router as backtest_router
from backend.app.api.v1.admin.backtest import router as admin_backtest_router

# Inside create_v1_router():
v1_router.include_router(backtest_router, prefix="/backtest")
v1_router.include_router(admin_backtest_router, prefix="/admin/backtests")
```

---

## 8. File: `backend/app/models/backtest.py` (CREATE)

```python
"""SQLAlchemy model for backtest_results."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional

from sqlalchemy import (
    BigInteger, Date, DateTime, Float, ForeignKey,
    Integer, JSON, String, Text, Enum,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.models.base import Base


class BacktestResult(Base):
    __tablename__ = "backtest_results"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    stock_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("stocks.id", ondelete="CASCADE"), nullable=False
    )
    config_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("analysis_configs.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(
        Enum("running", "completed", "failed", name="backtest_status_enum"),
        nullable=False, default="running",
    )

    # Input parameters
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    initial_capital: Mapped[float] = mapped_column(Float, nullable=False, default=100_000.0)
    slippage_pct: Mapped[float] = mapped_column(Float, nullable=False, default=0.0005)
    commission_pct: Mapped[float] = mapped_column(Float, nullable=False, default=0.001)

    # Results — metrics
    total_return: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cagr: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    max_drawdown: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    sharpe_ratio: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    sortino_ratio: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    calmar_ratio: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    win_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    profit_factor: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    num_trades: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    benchmark_return: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Curves
    equity_curve: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    drawdown_curve: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    monthly_returns: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    trade_log: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)

    # Meta
    execution_time_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow,
    )

    # Relationships
    user = relationship("User", back_populates="backtest_results")
    stock = relationship("Stock", back_populates="backtest_results")
    config = relationship("AnalysisConfig", back_populates="backtest_results")
```

---

## 9. API Endpoint Specification

### 9.1 POST `/api/v1/backtest/run`

**Request:**
```json
{
  "stock_id": 1,
  "config_id": 3,
  "start_date": "2023-01-01",
  "end_date": "2026-06-09",
  "initial_capital": 100000.00,
  "slippage_pct": 0.0005,
  "commission_pct": 0.001
}
```

**Response (200):**
```json
{
  "id": 42,
  "user_id": 1,
  "stock_id": 1,
  "config_id": 3,
  "status": "completed",
  "start_date": "2023-01-01",
  "end_date": "2026-06-09",
  "initial_capital": 100000.00,
  "slippage_pct": 0.0005,
  "commission_pct": 0.001,
  "metrics": {
    "total_return": 0.3521,
    "cagr": 0.0914,
    "max_drawdown": -0.1832,
    "sharpe_ratio": 1.12,
    "sortino_ratio": 1.85,
    "calmar_ratio": 0.50,
    "win_rate": 0.452,
    "profit_factor": 1.62,
    "num_trades": 42,
    "benchmark_return": 0.2815
  },
  "equity_curve": [
    {"date": "2023-01-03", "equity": 100000.00},
    {"date": "2023-01-04", "equity": 100520.00}
  ],
  "drawdown_curve": [
    {"date": "2023-01-03", "drawdown_pct": 0.0},
    {"date": "2023-03-15", "drawdown_pct": -5.20}
  ],
  "monthly_returns": [
    {"year_month": "2023-01", "return_pct": 3.20},
    {"year_month": "2023-02", "return_pct": -1.50}
  ],
  "execution_time_ms": 245,
  "created_at": "2026-06-09T17:30:00Z"
}
```

### 9.2 GET `/api/v1/backtest/{id}`

Returns the same shape as POST response.

### 9.3 GET `/api/v1/backtest/history?config_id=3&page=1&size=20`

```json
{
  "items": [
    {
      "id": 42,
      "stock_id": 1,
      "config_id": 3,
      "status": "completed",
      "start_date": "2023-01-01",
      "end_date": "2026-06-09",
      "total_return": 0.3521,
      "cagr": 0.0914,
      "sharpe_ratio": 1.12,
      "num_trades": 42,
      "execution_time_ms": 245,
      "created_at": "2026-06-09T17:30:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "size": 20,
  "pages": 1
}
```

### 9.4 GET `/api/v1/admin/backtests?page=1&size=20&stock_id=1&config_id=3`

Same response shape as history, admin-only.

---

## 10. Test Specifications

### 10.1 Unit Tests

| Test | Input | Expected |
|------|-------|----------|
| `test_generate_signals_import` | `from backend.app.services.analysis_engine import generate_signals` | Import succeeds |
| `test_backtest_ma_cross_on_known_data` | OHLCV with known MA cross, fixed config | `total_return` and `num_trades` match expected (hand-calculated) |
| `test_cagr_zero_trades` | Portfolio with 0 trades | `cagr` = 0.0, no exception |
| `test_metrics_handle_nan` | Edge-case OHLCV causing NaN metrics | All metrics present, no NaN in JSON |
| `test_equity_curve_starts_at_initial_capital` | initial_capital=50000 | First equity point = 50000.0 |
| `test_cache_hit_returns_cached` | Same params twice, second call | Second result has same `id` as first (cache hit) |
| `test_cache_miss_creates_new` | Different params | New record created |
| `test_insufficient_data_raises` | OHLCV with <50 bars | ValueError raised |
| `test_end_date_before_start_date_rejected` | end_date < start_date | 400 validation error |

### 10.2 API Integration Tests

| Test | Method | Path | Expected |
|------|--------|------|----------|
| `test_run_backtest` | POST | /backtest/run | 200, result with metrics |
| `test_get_backtest` | GET | /backtest/{id} | 200, full result |
| `test_get_backtest_not_found` | GET | /backtest/99999 | 404 |
| `test_history` | GET | /backtest/history?config_id=1 | 200, paginated |
| `test_admin_list` | GET | /admin/backtests | 200 (admin only) |
| `test_run_backtest_unauthorized` | POST | /backtest/run (no token) | 401 |

### 10.3 Consistency Test

| Test | Description |
|------|-------------|
| `test_signal_consistency` | Run `generate_signals()` with same df+config from both SignalEngine and BacktestService code paths. Assert Series are identical. |

---

## 11. Acceptance Criteria Checklist

- [ ] `generate_signals(df, config)` is importable from `backend.app.services.analysis_engine`
- [ ] `BacktestService.run_backtest()` produces correct results for ma_cross strategy
- [ ] `BacktestService.run_backtest()` produces correct results for multi_indicator strategy
- [ ] `BacktestService.run_backtest()` produces correct results for custom_script strategy
- [ ] All 10 metrics computed: total_return, cagr, max_drawdown, sharpe_ratio, sortino_ratio, calmar_ratio, win_rate, profit_factor, num_trades, benchmark_return
- [ ] Equity curve generated as `[{date, equity}, ...]`
- [ ] Drawdown curve generated as `[{date, drawdown_pct}, ...]`
- [ ] Monthly returns generated as `[{year_month, return_pct}, ...]`
- [ ] Benchmark return computed (SPY buy-and-hold simulation)
- [ ] Redis cache: same params within 7 days returns cached result
- [ ] Redis cache key format: `backtest:{config_id}:{stock_id}:{start}:{end}:{capital}`
- [ ] `POST /backtest/run` validates date range (end > start, min 21 days)
- [ ] `POST /backtest/run` validates capital bounds (1,000 – 100,000,000)
- [ ] `POST /backtest/run` validates slippage/commission bounds (0 – 5%)
- [ ] `GET /backtest/{id}` returns full result with curves
- [ ] `GET /backtest/history?config_id=X` returns paginated history
- [ ] `GET /admin/backtests` returns all backtests (admin only)
- [ ] BacktestResult properly persisted to DB with all fields
- [ ] No look-ahead bias: signals use data only up to T-1 for trade at T
- [ ] Signal generation produces identical output whether called from BacktestService or SignalEngine
- [ ] pytest coverage ≥ 75% for backtest_service.py

---

## 12. Estimated Time

| Sub-task | Hours |
|----------|-------|
| `BacktestService` core (run_backtest + metrics + curves) | 8h |
| Redis cache layer | 2h |
| `backtest.py` schemas | 1.5h |
| API endpoints (user + admin) | 3h |
| ORM model (`backtest.py`) | 1h |
| Router registration | 0.5h |
| pytest: unit + integration | 5h |
| **Total** | **~21h** |
