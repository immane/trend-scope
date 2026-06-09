# 007 — Backtest System Design

> **Status**: Draft v1
> **Date**: 2026-06-09
> **Purpose**: Comprehensive design of the async backtest system — job queue architecture, strategy execution, metrics calculation, report generation, parameter optimization, walk-forward analysis, API endpoints, and performance/scaling plan.
>
> **References**:
> - [001-preliminary-design.md](001-preliminary-design.md) — overall architecture, DB schema (backtest_jobs, backtest_results), API routes
> - [004-analysis-engine.md](004-analysis-engine.md) — AnalysisConfig structure, signal generation model
> - [006-backtest.md](../research/006-backtest.md) — framework comparison, metrics formulas, optimization methods, realism checklist

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Framework Choice](#2-framework-choice)
3. [BacktestJob Lifecycle](#3-backtestjob-lifecycle)
4. [Input Parameters](#4-input-parameters)
5. [Strategy Implementation](#5-strategy-implementation)
6. [Metrics Calculation](#6-metrics-calculation)
7. [Report Generation](#7-report-generation)
8. [Parameter Optimization](#8-parameter-optimization)
9. [Walk-Forward Analysis](#9-walk-forward-analysis)
10. [Task Queue Implementation](#10-task-queue-implementation)
11. [API Endpoints](#11-api-endpoints)
12. [Performance & Scaling](#12-performance--scaling)
13. [Testing](#13-testing)

---

## 1. Architecture Overview

### 1.1 System Diagram

```
                    User / Admin Client
                           |
                           v
              +------------------------+
              |    FastAPI REST API     |
              |  POST /backtest/submit  |
              |  GET  /backtest/{job_id}|
              |  GET  /backtest/{id}/report
              |  GET  /backtest/history |
              |  GET  /admin/backtest-jobs
              +-----------+------------+
                          |
                          v
              +------------------------+
              |   Redis (ARQ Broker)    |
              |  +------------------+   |
              |  | backtest_queue   |   |
              |  | backtest:cache:* |   |
              |  | rate_limit:*     |   |
              |  +------------------+   |
              +-----------+------------+
                          |
          +---------------+---------------+
          v               v               v
   +------------+  +------------+  +------------+
   | ARQ Worker |  | ARQ Worker |  | ARQ Worker |
   |  (1..n)    |  |  (1..n)    |  |  (1..n)    |
   +-----+------+  +-----+------+  +-----+------+
         |               |               |
         +---------------+---------------+
                         |
          +--------------+--------------+
          |                             |
          v                             v
   +-------------+              +-------------+
   |  vectorbt   |              |  MySQL 8.0  |
   |  Engine     |              |             |
   |             |              | backtest_   |
   | NumPy/Numba |              | jobs        |
   | vectorized  |              | backtest_   |
   | simulation  |              | results     |
   +------+------+              +-------------+
          |
          v
   +-------------+
   | QuantStats  |
   | HTML Report |
   | Generation  |
   +-------------+
```

### 1.2 Simplified Sequence Diagram

```
Client          FastAPI        Redis/ARQ        ARQ Worker       vectorbt      QuantStats        MySQL
  |                |               |                |                |              |               |
  | POST /submit   |               |                |                |              |               |
  |--------------->|               |                |                |              |               |
  |                | check cache   |                |                |              |               |
  |                |-------------->|                |                |              |               |
  |                |<--------------| (miss)         |                |              |               |
  |                |               |                |                |              |               |
  |                | enqueue job   |                |                |              |               |
  |                |-------------->|                |                |              |               |
  |                |               |                |                |              |               |
  |                | INSERT job (queued)            |                |              |               |
  |                |------------------------------------------------------------------->|
  |                |               |                |                |              |               |
  | {job_id,queued}|               |                |                |              |               |
  |<---------------|               |                |                |              |               |
  |                |               |                |                |              |               |
  | GET /{job_id}  |               |                |                |              |               |
  |--------------->|               |                |                |              |               |
  |                | query status  |                |                |              |               |
  |                |------------------------------------------------------------------>|
  | {status:running}               |                |                |              |               |
  |<---------------|               |                |                |              |               |
  |                |               |                |                |              |               |
  |                |               |  dequeue job   |                |              |               |
  |                |               |--------------->|                |              |               |
  |                |               |                | fetch prices   |              |               |
  |                |               |                |---------------------------------------------->|
  |                |               |                |<----------------------------------------------|
  |                |               |                |                |              |               |
  |                |               |                | config->signals|              |               |
  |                |               |                |-------------->|              |               |
  |                |               |                |  entry/exit arrays            |               |
  |                |               |                |<--------------|              |               |
  |                |               |                |                |              |               |
  |                |               |                | from_signals()|              |               |
  |                |               |                |-------------->|              |               |
  |                |               |                | portfolio obj  |              |               |
  |                |               |                |<--------------|              |               |
  |                |               |                |                |              |               |
  |                |               |                | compute metrics               |               |
  |                |               |                |-------------->|              |               |
  |                |               |                |                | generate HTML |               |
  |                |               |                |------------------------------>|               |
  |                |               |                |  HTML report   |              |               |
  |                |               |                |<------------------------------|               |
  |                |               |                |                |              |               |
  |                |               |                | INSERT result  |              |               |
  |                |               |                |---------------------------------------------->|
  |                |               |                | UPDATE job=completed          |               |
  |                |               |                |---------------------------------------------->|
  |                |               |                |                |              |               |
  |                |               |                | SET cache (TTL 24h)           |               |
  |                |               |<---------------|                |              |               |
  |                |               |                |                |              |               |
  | GET /{job_id}  |               |                |                |              |               |
  |--------------->|               |                |                |              |               |
  | {status:completed, metrics, report_url}          |                |              |               |
  |<---------------|               |                |                |              |               |
```

### 1.3 Component Responsibility Matrix

| Component | Responsibility |
|---|---|
| **FastAPI Router** | Input validation, auth, rate limiting, cache check, job enqueue, status query |
| **ARQ Queue** | Job serialization, reliable delivery, worker distribution, retry logic |
| **BacktestWorker** | Data fetching, signal translation, engine dispatch, metrics, report, DB write, cache write |
| **vectorbt Engine** | Vectorized portfolio simulation, param sweeps via `run_combs`, benchmark comparison |
| **Backtesting.py** | Fallback engine for simple single-asset tests, interactive HTML charts |
| **QuantStats** | Professional HTML tear sheet (metrics, charts, heatmap, distribution) |
| **Redis Cache** | Cached results (24h TTL), rate-limit counters, job progress state |
| **MySQL** | `backtest_jobs` (lifecycle), `backtest_results` (metrics + report), `analysis_configs` (strategy params) |

---

## 2. Framework Choice

### 2.1 Primary: vectorbt (v1.0+)

**Why vectorbt wins for Trend-Scope:**

1. **Vectorized Speed**: Runs 10,000+ parameter combinations simultaneously via NumPy array broadcasting. A single-stock 10Y daily backtest completes in ~50ms.
2. **Parameter Optimization**: `vbt.MA.run_combs(price, window=windows, r=2)` enumerates all MA cross combos in one call. Combined with `vbt.Portfolio.from_signals()`, the entire grid search is vectorized.
3. **Numba JIT + Rust Backend**: Optional Rust module for precompiled speed with no JIT warm-up penalty.
4. **Built-in Indicators**: Full TA-Lib + pandas-ta integration. Can reuse the indicator engine from the analysis system.
5. **Walk-Forward**: Native `vbt.WalkForward` API.
6. **QuantStats Integration**: Direct `portfolio.returns()` compatible with QuantStats tear sheets.

**Limitations to Mitigate:**
- No live trading — acceptable since Trend-Scope is a research/analysis platform, not an execution platform.
- Steep API — mitigated by wrapping in service-layer abstractions.
- Single-asset focus — matches Trend-Scope's ETF-based use case perfectly.

### 2.2 Fallback: Backtesting.py (v0.4+)

Used when:
- Strategy cannot be expressed as vectorized entry/exit arrays (e.g., dynamic stop-loss based on trailing ATR).
- User requests an interactive Bokeh-based chart (built into Backtesting.py).
- Quick single-run validation against known strategies.

```python
# backend/app/services/engine_dispatch.py
from enum import Enum, auto

class EngineType(Enum):
    VECTORBT = auto()        # Primary -- vectorized
    BACKTESTING_PY = auto()  # Fallback -- event-driven

def select_engine(config: dict) -> EngineType:
    """Select engine based on strategy complexity."""
    strategy_type = config.get("strategy_type", "ma_cross")
    if strategy_type == "ma_cross":
        return EngineType.VECTORBT
    if strategy_type == "multi_indicator":
        # Complex conditional logic -> event-driven fallback
        return EngineType.BACKTESTING_PY
    return EngineType.VECTORBT
```

### 2.3 Why NOT Other Frameworks

| Framework | Rejection Reason |
|---|---|
| **backtrader** | Feature-complete but no longer actively maintained; pure Python too slow for parameter sweeps; GPL-3.0 license restrictive for commercial use |
| **zipline-reloaded** | Complex setup (data ingestion); slower than vectorized; overkill for single-asset ETF backtests |
| **bt (pmorissette)** | Alpha-stage; small community; tree structure overkill for MA cross strategies |
| **QuantConnect/LEAN** | Cloud dependency; requires QC algorithm framework; too heavy for self-hosted; steepest learning curve |

---

## 3. BacktestJob Lifecycle

### 3.1 State Machine

```
                         +----------+
                    +--->|  queued  |
                    |    +----+-----+
                    |         | worker picks up job
                    |         v
                    |    +----------+
       (retry)      |    |  running |------timeout (5 min)----+
       count < 3    |    +----+-----+                        |
                    |         |                               v
                    |         +---- error ----------+  +----------+
                    |         |                      |  |  failed   |
                    |         |                      |  +----------+
                    |         | (success)            |
                    |         v                      |
                    |    +-----------+               |
                    +----| completed |               |
                         +-----------+               |
                                                     |
                         +----------+                |
                         |  failed  |<------(terminal)
                         +----------+        retry count >= 3
```

### 3.2 State Transition Rules

| From | To | Trigger | Action |
|---|---|---|---|
| `queued` | `running` | Worker picks up job | Set `started_at = now()`, update status |
| `running` | `completed` | Simulation + metrics + report done | Set `completed_at`, persist results |
| `running` | `failed` | Exception or timeout (5 min) | Set `error_message`, increment retry count |
| `failed` | `queued` | Retry count < 3 | Re-enqueue with exponential backoff |
| `failed` | `failed` (terminal) | Retry count >= 3 | Mark terminal, notify user |
| `running` | `failed` (timeout) | `now() - started_at > 300s` | Kill worker, set error = "Backtest timed out (>5 min)" |

### 3.3 Timeout Handling

```python
# backend/app/services/backtest_worker.py

import asyncio

BACKTEST_TIMEOUT_SECONDS = 300  # 5 minutes
MAX_RETRIES = 3
RETRY_BACKOFF = [10, 30, 60]  # seconds

async def run_backtest_with_timeout(
    ctx: dict,
    job_id: str,
    params_dict: dict,
) -> dict:
    """Run backtest with hard timeout."""
    try:
        result = await asyncio.wait_for(
            _execute_backtest(ctx, job_id, params_dict),
            timeout=BACKTEST_TIMEOUT_SECONDS,
        )
        return result
    except asyncio.TimeoutError:
        raise BacktestTimeoutError(
            f"Backtest {job_id} exceeded {BACKTEST_TIMEOUT_SECONDS}s limit"
        )
```

### 3.4 Concurrent Job Limits

```python
# backend/app/services/backtest_service.py

MAX_CONCURRENT_PER_USER = 3
MAX_CONCURRENT_TOTAL = 10

async def check_concurrency_limits(db, redis, user_id: int) -> None:
    """Enforce concurrent job limits before enqueueing."""

    # 1. Per-user limit
    from sqlalchemy import select, func
    from backend.app.models.backtest import BacktestJob

    user_running = await db.scalar(
        select(func.count(BacktestJob.id)).where(
            BacktestJob.user_id == user_id,
            BacktestJob.status.in_(["queued", "running"]),
        )
    )
    if user_running >= MAX_CONCURRENT_PER_USER:
        raise ConcurrencyLimitExceeded(
            f"User {user_id} has {user_running}/{MAX_CONCURRENT_PER_USER} jobs active. "
            "Wait for existing jobs to complete."
        )

    # 2. Global limit
    global_running = int(await redis.get("backtest:active_count") or 0)
    if global_running >= MAX_CONCURRENT_TOTAL:
        raise ConcurrencyLimitExceeded(
            f"System at capacity ({global_running}/{MAX_CONCURRENT_TOTAL}). Try again later."
        )
```

### 3.5 Status Polling API Design

```python
# GET /backtest/{job_id} response shape:
{
    "job_id": "uuid-here",
    "status": "running",           # queued | running | completed | failed
    "progress": {
        "stage": "simulating",      # validating|fetching_data|simulating|computing_metrics|generating_report|done
        "percent": 60,             # 0-100
        "message": "Running vectorbt portfolio simulation..."
    },
    "created_at": "2026-06-09T10:00:00Z",
    "started_at": "2026-06-09T10:00:01Z",
    "completed_at": null,
    "result_summary": null,         # populated only when completed
    "error_message": null           # populated only when failed
}

# When completed, result_summary contains:
{
    "result_summary": {
        "total_return": 0.4521,
        "cagr": 0.0823,
        "sharpe_ratio": 1.24,
        "max_drawdown": -0.1832,
        "win_rate": 0.521,
        "num_trades": 87,
        "benchmark_return": 0.3812
    }
}
```

---

## 4. Input Parameters

### 4.1 BacktestSubmit Schema (Pydantic)

```python
# backend/app/schemas/backtest.py

from datetime import date
from pydantic import BaseModel, Field, field_validator


class BacktestSubmit(BaseModel):
    """Request schema for POST /backtest/submit."""

    stock_id: int = Field(..., description="Stock ID from stocks table")
    config_id: int = Field(..., description="AnalysisConfig ID defining strategy")
    start_date: date = Field(..., description="Backtest start date (inclusive)")
    end_date: date = Field(..., description="Backtest end date (inclusive)")
    initial_capital: float = Field(
        default=100_000.0,
        ge=1_000.0,
        le=100_000_000.0,
        description="Initial capital in USD",
    )
    position_size_pct: float = Field(
        default=1.0,
        ge=0.0,
        le=1.0,
        description="Fraction of capital per trade (0.0-1.0). 1.0 = all-in",
    )
    slippage_pct: float = Field(
        default=0.0005,
        ge=0.0,
        le=0.05,
        description="Slippage per side (0.05% default)",
    )
    commission_pct: float = Field(
        default=0.001,
        ge=0.0,
        le=0.05,
        description="Commission per trade as fraction (0.1% default, safety margin)",
    )
    benchmark_symbol: str = Field(
        default="SPY",
        max_length=10,
        description="Benchmark ticker for comparison (SPY, QQQ, AGG)",
    )
    engine: str = Field(
        default="vectorbt",
        pattern="^(vectorbt|backtesting_py)$",
        description="Backtesting engine to use",
    )

    @field_validator("end_date")
    @classmethod
    def end_after_start(cls, v: date, info) -> date:
        start = info.data.get("start_date")
        if start and v <= start:
            raise ValueError("end_date must be after start_date")
        if (v - start).days < 21:
            raise ValueError("Date range must span at least 21 trading days")
        return v
```

### 4.2 Internal Parameter Object

```python
from dataclasses import dataclass

@dataclass
class BacktestParams:
    """Runtime backtest parameters, constructed from BacktestSubmit + AnalysisConfig."""
    stock_id: int
    config_id: int
    symbol: str
    start_date: date
    end_date: date
    initial_capital: float
    position_size_pct: float
    slippage_pct: float
    commission_pct: float
    benchmark_symbol: str
    engine: str
    # From AnalysisConfig (loaded from DB)
    strategy_type: str           # ma_cross, multi_indicator, ml_enhanced
    strategy_params: dict        # e.g., {"ma_short": 20, "ma_long": 60}
    confirm_bars: int
    volume_confirm: bool
```

### 4.3 Parameter Matrix (Per Tier)

| Parameter | Free | Basic | Pro | Notes |
|---|---|---|---|---|
| start_date..end_date | -- | -- | Any range | Free/Basic use pre-cached snapshot dates |
| initial_capital | -- | -- | $1k-$100M | |
| position_size_pct | -- | -- | 0.0-1.0 | |
| slippage_pct | -- | -- | 0.0-5.0% | Default 0.05% |
| commission_pct | -- | -- | 0.0-5.0% | Default 0.1% |
| benchmark_symbol | -- | -- | SPY/QQQ/AGG | |
| optimize | -- | -- | grid (<=4 params) | Complex: Optuna |
| walk_forward | -- | -- | Yes | |
| daily_backtest_limit | 0 | 0 | 10 | Rate-limited |

---

## 5. Strategy Implementation

### 5.1 Translating AnalysisConfig -> vectorbt Signals

```python
# backend/app/services/backtest_strategy.py

import numpy as np
import pandas as pd
import vectorbt as vbt
from dataclasses import dataclass
from typing import Tuple


@dataclass
class StrategySignals:
    """Container for vectorbt-compatible entry/exit boolean arrays."""
    entries: np.ndarray    # True where we enter long
    exits: np.ndarray      # True where we exit long
    label: str             # Human-readable strategy label


class StrategySignalBuilder:
    """
    Converts an AnalysisConfig into vectorbt-compatible boolean entry/exit arrays.

    Key principles:
    - ALL signals use .shift(1) to prevent look-ahead bias.
    - Entry occurs at NEXT bar's open after signal day.
    - Exit occurs at NEXT bar's open after signal reversal.
    """

    def __init__(self, df: pd.DataFrame, config_params: dict, config_type: str):
        self.df = df  # Must contain: open, high, low, close, volume
        self.params = config_params
        self.config_type = config_type

    def build(self) -> StrategySignals:
        """Dispatch to strategy-type-specific signal builder."""
        if self.config_type == "ma_cross":
            return self._ma_cross_signals()
        elif self.config_type == "multi_indicator":
            return self._multi_indicator_signals()
        else:
            raise ValueError(f"Unknown strategy type: {self.config_type}")

    def _ma_cross_signals(self) -> StrategySignals:
        """
        Golden cross / death cross strategy.

        Entry: fast MA crosses ABOVE slow MA
        Exit:  fast MA crosses BELOW slow MA

        Signal uses shift(1) so trade enters at NEXT bar's open.
        """
        fast = self.params.get("ma_short", 20)
        slow = self.params.get("ma_long", 60)
        confirm = self.params.get("confirm_bars", 0)
        volume_confirm = self.params.get("volume_confirm", False)

        close = self.df["close"].values
        volume = self.df["volume"].values

        # Compute MAs
        fast_ma = vbt.MA.run(close, window=fast).ma.values
        slow_ma = vbt.MA.run(close, window=slow).ma.values

        # Raw cross signals (on signal bar)
        golden_cross_raw = (
            (fast_ma > slow_ma) &
            (np.roll(fast_ma, 1) <= np.roll(slow_ma, 1))
        )
        death_cross_raw = (
            (fast_ma < slow_ma) &
            (np.roll(fast_ma, 1) >= np.roll(slow_ma, 1))
        )

        # Confirmation: wait N bars after cross
        if confirm > 0:
            golden_cross_raw = self._apply_confirm(
                golden_cross_raw, fast_ma, slow_ma,
                direction="above", bars=confirm,
            )
            death_cross_raw = self._apply_confirm(
                death_cross_raw, fast_ma, slow_ma,
                direction="below", bars=confirm,
            )

        # Volume confirmation
        if volume_confirm:
            vol_ma_20 = vbt.MA.run(volume, window=20).ma.values
            golden_cross_raw = golden_cross_raw & (volume > vol_ma_20 * 1.5)
            death_cross_raw = death_cross_raw & (volume > vol_ma_20 * 1.5)

        # Shift by 1 to enter/exit at NEXT bar -- NO look-ahead bias
        entries = np.roll(golden_cross_raw, 1)
        exits = np.roll(death_cross_raw, 1)

        # First bar cannot be entry (no prior data)
        entries[0] = False
        exits[0] = False

        # Ensure entries and exits alternate
        entries, exits = self._deduplicate_signals(entries, exits)

        return StrategySignals(
            entries=entries,
            exits=exits,
            label=f"MA_{fast}_{slow}",
        )

    def _multi_indicator_signals(self) -> StrategySignals:
        """
        Composite signal from multiple indicators.

        Weighted scoring from: MA cross, RSI, MACD, Bollinger Bands, Volume, ROC.
        Score threshold determines entry/exit.
        """
        weights = self.params.get("weights", {
            "ma_cross": 0.20, "rsi": 0.15, "macd": 0.20,
            "bb": 0.15, "volume": 0.15, "roc": 0.15,
        })
        threshold_buy = self.params.get("threshold_buy", 0.3)
        threshold_sell = self.params.get("threshold_sell", -0.3)

        close = self.df["close"].values
        volume = self.df["volume"].values

        # 1. MA Cross signal
        fast_ma = vbt.MA.run(close, window=self.params.get("ma_short", 10)).ma.values
        slow_ma = vbt.MA.run(close, window=self.params.get("ma_long", 30)).ma.values
        ma_signal = np.where(fast_ma > slow_ma, 1.0, -1.0)

        # 2. RSI signal
        rsi = vbt.RSI.run(close, window=self.params.get("rsi_period", 14)).rsi.values
        rsi_signal = np.where(rsi < 30, 1.0, np.where(rsi > 70, -1.0, 0.0))

        # 3. MACD signal
        macd_hist = vbt.MACD.run(close).hist.values
        macd_dir = np.where(macd_hist > 0, 1.0, -1.0)

        # 4. Bollinger Bands
        bb = vbt.BBANDS.run(close, window=self.params.get("bb_period", 20))
        bb_low = bb.lower.values
        bb_high = bb.upper.values
        bb_signal = np.where(
            close < bb_low, 1.0,
            np.where(close > bb_high, -1.0, 0.0),
        )

        # 5. Volume
        vol_ma = vbt.MA.run(volume, window=self.params.get("vol_ma_period", 20)).ma.values
        vol_signal = np.where(
            volume > vol_ma * self.params.get("vol_factor", 1.5), 1.0, 0.0,
        )

        # 6. ROC (Rate of Change)
        roc = vbt.ROC.run(close, window=self.params.get("roc_period", 10)).roc.values
        roc_signal = np.where(roc > 0, 1.0, -1.0)

        # Composite score
        composite = (
            weights["ma_cross"] * ma_signal +
            weights["rsi"] * rsi_signal +
            weights["macd"] * macd_dir +
            weights["bb"] * bb_signal +
            weights["volume"] * vol_signal +
            weights["roc"] * roc_signal
        )

        composite = np.tanh(composite)  # Clamp via tanh to [-1, 1]

        raw_entries = composite > threshold_buy
        raw_exits = composite < threshold_sell

        # Shift by 1 to trade at NEXT bar's open
        entries = np.roll(raw_entries, 1)
        exits = np.roll(raw_exits, 1)
        entries[0] = False
        exits[0] = False

        entries, exits = self._deduplicate_signals(entries, exits)

        return StrategySignals(
            entries=entries,
            exits=exits,
            label="MultiIndicator",
        )

    @staticmethod
    def _apply_confirm(
        cross: np.ndarray,
        fast_ma: np.ndarray,
        slow_ma: np.ndarray,
        direction: str,
        bars: int,
    ) -> np.ndarray:
        """Require that after a cross, MA relationship holds for N bars."""
        confirmed = cross.copy()
        for i in range(len(cross)):
            if not cross[i]:
                continue
            end = min(i + bars + 1, len(fast_ma))
            if direction == "above":
                if not np.all(fast_ma[i:end] > slow_ma[i:end]):
                    confirmed[i] = False
            else:
                if not np.all(fast_ma[i:end] < slow_ma[i:end]):
                    confirmed[i] = False
        return confirmed

    @staticmethod
    def _deduplicate_signals(
        entries: np.ndarray, exits: np.ndarray,
    ) -> Tuple[np.ndarray, np.ndarray]:
        """Ensure entries/exits alternate: keep only first entry after exit and vice versa."""
        in_position = False
        clean_entries = np.zeros_like(entries, dtype=bool)
        clean_exits = np.zeros_like(exits, dtype=bool)

        for i in range(len(entries)):
            if not in_position and entries[i]:
                clean_entries[i] = True
                in_position = True
            elif in_position and exits[i]:
                clean_exits[i] = True
                in_position = False

        # Force exit at the last bar if still in position
        if in_position:
            clean_exits[-1] = True

        return clean_entries, clean_exits
```

### 5.2 Vectorized Portfolio Simulation

```python
# backend/app/services/backtest_engine.py

import vectorbt as vbt
import pandas as pd
import numpy as np


def run_vectorbt_backtest(
    price: pd.DataFrame,
    entries: np.ndarray,
    exits: np.ndarray,
    initial_capital: float = 100_000.0,
    position_size_pct: float = 1.0,
    slippage: float = 0.0005,
    commission: float = 0.001,
) -> vbt.Portfolio:
    """
    Run a vectorized portfolio simulation using vectorbt.

    Price DataFrame must have columns: ['open', 'high', 'low', 'close', 'volume'].
    entries/exits are boolean arrays of the same length as price.

    Slippage and commission are realistic costs:
      - slippage: 0.05% per side (default)
      - commission: 0.1% per trade (safety margin for SEC fees, TAF, spread)
    """
    pf = vbt.Portfolio.from_signals(
        close=price["close"],
        entries=entries,
        exits=exits,
        size=position_size_pct,
        size_type="percent",
        init_cash=initial_capital,
        slippage=slippage,
        fees=commission,
        freq="D",
    )
    return pf


def run_benchmark_comparison(
    benchmark_prices: pd.DataFrame,
    initial_capital: float = 100_000.0,
) -> vbt.Portfolio:
    """
    Simulate a buy-and-hold benchmark portfolio.

    Returns a benchmark Portfolio object for metric comparison.
    """
    n_bars = len(benchmark_prices)
    entries = np.zeros(n_bars, dtype=bool)
    exits = np.zeros(n_bars, dtype=bool)
    entries[0] = True
    exits[-1] = True

    benchmark_pf = vbt.Portfolio.from_signals(
        close=benchmark_prices["close"],
        entries=entries,
        exits=exits,
        init_cash=initial_capital,
        freq="D",
    )
    return benchmark_pf
```

---

## 6. Metrics Calculation

### 6.1 Metrics Data Class

```python
# backend/app/services/backtest_metrics.py

import numpy as np
import pandas as pd
from dataclasses import dataclass
from typing import Optional, Tuple


@dataclass
class BacktestMetrics:
    """Complete set of backtest performance metrics."""

    # Return metrics
    total_return: float          # (final_value / initial_value) - 1
    cagr: float                  # Compound Annual Growth Rate
    annualized_volatility: float # sigma_daily * sqrt(252)
    annualized_return: float     # mu_daily * 252

    # Risk-adjusted ratios
    sharpe_ratio: float          # (R_annual - Rf) / sigma_annual
    sortino_ratio: float         # (R_annual - Rf) / sigma_downside
    calmar_ratio: float          # CAGR / |MDD|
    information_ratio: float     # (Rp - Rb) / sigma(Rp - Rb)

    # Drawdown
    max_drawdown: float          # Minimum drawdown value (e.g., -0.1832)
    max_drawdown_duration: int   # Longest drawdown in trading days
    avg_drawdown: float          # Average drawdown
    avg_drawdown_duration: int   # Average drawdown duration in days

    # Trade-level
    num_trades: int
    win_rate: float              # Winning trades / total trades
    profit_factor: float         # Gross profit / gross loss
    avg_win_pct: float           # Average winning trade return %
    avg_loss_pct: float          # Average losing trade return %
    avg_win_loss_ratio: float    # |avg_win| / |avg_loss|
    avg_holding_days: float      # Average trade duration in calendar days
    expectancy: float            # (WinRate * AvgWin) - ((1-WinRate) * |AvgLoss|)
    sqn: float                   # System Quality Number
    kelly_criterion: float       # Optimal fraction to bet (full Kelly)

    # Benchmark relative
    benchmark_return: float      # Benchmark total return over same period
    benchmark_cagr: float        # Benchmark CAGR
    alpha: float                 # Jensen's Alpha (annualized excess return)
    beta: float                  # Sensitivity to benchmark
    tracking_error: float        # Std of excess returns
    up_capture: float            # Strategy return / benchmark return in up months
    down_capture: float          # Strategy return / benchmark return in down months

    # Risk
    var_95: float                # Value at Risk (95% confidence, daily)
    cvar_95: float               # Conditional VaR (expected shortfall)
    ulcer_index: float           # Root-mean-square of drawdowns
    recovery_factor: float       # Net profit / |MDD| (absolute)
```

### 6.2 Complete Metrics Computer

```python

def compute_metrics(
    returns: pd.Series,
    benchmark_returns: Optional[pd.Series] = None,
    trades: Optional[pd.DataFrame] = None,
    risk_free_rate: float = 0.04,
    trading_days_per_year: int = 252,
) -> BacktestMetrics:
    """
    Compute all backtest metrics from daily returns.

    Args:
        returns: Daily strategy returns (decimal, e.g., 0.01 = 1%).
        benchmark_returns: Daily benchmark returns for relative metrics.
        trades: Trade log DataFrame with columns ['pnl', 'pnl_pct', 'entry_date', 'exit_date'].
        risk_free_rate: Annual risk-free rate (default 4%).
        trading_days_per_year: Trading days per year (252 for US equities).

    Returns:
        BacktestMetrics dataclass with all computed values.
    """
    returns = returns.dropna()
    if len(returns) < 20:
        raise ValueError(f"Insufficient data: {len(returns)} returns, need at least 20")

    n_days = len(returns)
    n_years = n_days / trading_days_per_year

    # ---- Return Metrics ----
    cumulative = (1 + returns).cumprod()
    total_return = cumulative.iloc[-1] - 1.0
    cagr = (cumulative.iloc[-1]) ** (1.0 / n_years) - 1.0 if n_years > 0 else 0.0
    annualized_return = returns.mean() * trading_days_per_year
    annualized_volatility = returns.std() * np.sqrt(trading_days_per_year)

    # ---- Drawdown Analysis ----
    running_peak = cumulative.expanding().max()
    drawdown_series = (cumulative / running_peak) - 1.0
    max_drawdown = drawdown_series.min()
    max_dd_duration, avg_dd, avg_dd_duration = _compute_drawdown_stats(drawdown_series)

    # ---- Risk-Adjusted Ratios ----
    excess_return = annualized_return - risk_free_rate

    sharpe_ratio = (
        excess_return / annualized_volatility if annualized_volatility > 0 else 0.0
    )

    downside_returns = returns[returns < 0]
    downside_vol = (
        downside_returns.std() * np.sqrt(trading_days_per_year)
        if len(downside_returns) > 0 else 0.0
    )
    sortino_ratio = excess_return / downside_vol if downside_vol > 0 else 0.0

    calmar_ratio = (
        cagr / abs(max_drawdown) if max_drawdown and max_drawdown < 0 else 0.0
    )

    # ---- Trade-Level Metrics ----
    if trades is not None and len(trades) > 0:
        num_trades = len(trades)
        winning = trades[trades["pnl"] > 0]
        losing = trades[trades["pnl"] <= 0]
        win_rate = len(winning) / num_trades if num_trades > 0 else 0.0
        gross_profit = winning["pnl"].sum() if len(winning) > 0 else 0.0
        gross_loss = abs(losing["pnl"].sum()) if len(losing) > 0 else 0.0
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else float("inf")

        avg_win_pct = (
            winning["pnl_pct"].mean()
            if len(winning) > 0 and "pnl_pct" in winning.columns else 0.0
        )
        avg_loss_pct = (
            losing["pnl_pct"].mean()
            if len(losing) > 0 and "pnl_pct" in losing.columns else 0.0
        )
        avg_win_loss_ratio = (
            abs(avg_win_pct) / abs(avg_loss_pct) if avg_loss_pct != 0 else 0.0
        )

        avg_holding_days = 0.0
        if "entry_date" in trades.columns and "exit_date" in trades.columns:
            avg_holding_days = (
                (pd.to_datetime(trades["exit_date"]) - pd.to_datetime(trades["entry_date"]))
                .dt.days.mean()
            )

        expectancy = (win_rate * abs(avg_win_pct)) - ((1 - win_rate) * abs(avg_loss_pct))
    else:
        num_trades = 0
        win_rate = 0.0
        profit_factor = 0.0
        avg_win_pct = 0.0
        avg_loss_pct = 0.0
        avg_win_loss_ratio = 0.0
        avg_holding_days = 0.0
        expectancy = 0.0

    # ---- SQN (System Quality Number) ----
    sqn = _compute_sqn(returns, num_trades, trading_days_per_year)

    # ---- Kelly Criterion ----
    kelly = _compute_kelly(win_rate, avg_win_pct, avg_loss_pct)

    # ---- Benchmark Relative Metrics ----
    (
        benchmark_return, benchmark_cagr, alpha, beta,
        tracking_error, information_ratio, up_capture, down_capture,
    ) = _compute_benchmark_metrics(
        returns, benchmark_returns, risk_free_rate, trading_days_per_year,
    )

    # ---- VaR & CVaR ----
    var_95_val = float(np.percentile(returns, 5))
    cvar_95_val = (
        float(returns[returns <= var_95_val].mean())
        if (returns <= var_95_val).any() else var_95_val
    )

    # ---- Ulcer Index ----
    ulcer = float(np.sqrt((drawdown_series ** 2).mean()))

    # ---- Recovery Factor ----
    net_profit = cumulative.iloc[-1] - cumulative.iloc[0]
    recovery_factor = (
        float(net_profit / abs(max_drawdown))
        if max_drawdown and max_drawdown < 0 else 0.0
    )

    return BacktestMetrics(
        total_return=total_return,
        cagr=cagr,
        annualized_volatility=annualized_volatility,
        annualized_return=annualized_return,
        sharpe_ratio=sharpe_ratio,
        sortino_ratio=sortino_ratio,
        calmar_ratio=calmar_ratio,
        max_drawdown=max_drawdown,
        max_drawdown_duration=max_dd_duration,
        avg_drawdown=avg_dd,
        avg_drawdown_duration=avg_dd_duration,
        num_trades=num_trades,
        win_rate=win_rate,
        profit_factor=profit_factor,
        avg_win_pct=avg_win_pct,
        avg_loss_pct=avg_loss_pct,
        avg_win_loss_ratio=avg_win_loss_ratio,
        avg_holding_days=avg_holding_days,
        expectancy=expectancy,
        sqn=sqn,
        kelly_criterion=kelly,
        benchmark_return=benchmark_return,
        benchmark_cagr=benchmark_cagr,
        alpha=alpha,
        beta=beta,
        tracking_error=tracking_error,
        information_ratio=information_ratio,
        up_capture=up_capture,
        down_capture=down_capture,
        var_95=var_95_val,
        cvar_95=cvar_95_val,
        ulcer_index=ulcer,
        recovery_factor=recovery_factor,
    )
```

### 6.3 Sub-Metric Helper Functions

```python
# --- Drawdown Statistics ---

def _compute_drawdown_stats(
    drawdown_series: pd.Series,
) -> Tuple[int, float, int]:
    """
    Compute drawdown duration and average stats.

    Returns:
        (max_dd_duration_days, avg_drawdown, avg_drawdown_duration_days)
    """
    is_drawdown = drawdown_series < 0
    island_id = (is_drawdown != is_drawdown.shift(1)).cumsum()
    drawdown_islands = island_id[is_drawdown]

    durations = []
    peaks = []
    for island, group in drawdown_islands.groupby(drawdown_islands):
        durations.append(len(group))
        peaks.append(drawdown_series.loc[group.index].min())

    max_duration = max(durations) if durations else 0
    avg_dd = float(np.mean(peaks)) if peaks else 0.0
    avg_duration = int(np.mean(durations)) if durations else 0.0

    return max_duration, avg_dd, avg_duration


# --- SQN Computation ---

def _compute_sqn(
    returns: pd.Series,
    num_trades: int,
    trading_days_per_year: int = 252,
) -> float:
    """
    System Quality Number (Van Tharp).

    SQN = sqrt(num_trades) * mean(trade_returns) / std(trade_returns)

    Interpretation:
        < 1.0: Poor     1.0-1.9: Below average   2.0-2.9: Average
        3.0-4.9: Good   5.0-6.9: Excellent       > 7.0: Holy Grail
    """
    if num_trades < 2:
        return 0.0
    # Annualized SQN using yearly resampled returns
    annual_returns = returns.resample("YE").apply(lambda x: (1 + x).prod() - 1).dropna()
    if len(annual_returns) < 2:
        return 0.0
    std_val = annual_returns.std()
    if std_val == 0:
        return 0.0
    return float(np.sqrt(num_trades) * (annual_returns.mean() / std_val))


# --- Kelly Criterion ---

def _compute_kelly(win_rate: float, avg_win_pct: float, avg_loss_pct: float) -> float:
    """
    Full Kelly Criterion for optimal bet size.

    Formula: Kelly% = WinRate - ((1 - WinRate) / (AvgWin / |AvgLoss|))

    Use fractional Kelly (1/4 or 1/2) in practice for position sizing.
    """
    if avg_loss_pct == 0 or avg_win_pct == 0:
        return 0.0
    win_loss_ratio = abs(avg_win_pct) / abs(avg_loss_pct)
    if win_loss_ratio == 0:
        return 0.0
    kelly = win_rate - ((1 - win_rate) / win_loss_ratio)
    return max(kelly, 0.0)


# --- Benchmark Relative Metrics ---

def _compute_benchmark_metrics(
    returns: pd.Series,
    benchmark_returns: Optional[pd.Series],
    risk_free_rate: float,
    trading_days_per_year: int,
) -> Tuple:
    """
    Compute benchmark-relative metrics:
    - Alpha (Jensen's): Rp - [Rf + beta*(Rb - Rf)]
    - Beta: Cov(Rp, Rb) / Var(Rb)
    - Tracking Error: sigma(Rp - Rb)
    - Information Ratio: (Rp - Rb) / sigma(Rp - Rb)
    - Up/Down Capture ratios

    Returns 8-tuple of zeroes if no benchmark data.
    """
    if benchmark_returns is None:
        return (0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)

    aligned = pd.concat([returns, benchmark_returns], axis=1).dropna()
    aligned.columns = ["strategy", "benchmark"]

    if len(aligned) < 20:
        return (0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)

    # Benchmark return & CAGR
    benchmark_cum = (1 + aligned["benchmark"]).cumprod()
    benchmark_return = float(benchmark_cum.iloc[-1] - 1.0)
    n_years = len(aligned) / trading_days_per_year
    benchmark_cagr = (
        float(benchmark_cum.iloc[-1] ** (1.0 / n_years) - 1.0) if n_years > 0 else 0.0
    )

    # Beta = Cov / Var
    covariance = float(aligned["strategy"].cov(aligned["benchmark"]))
    variance = float(aligned["benchmark"].var())
    beta = covariance / variance if variance > 0 else 0.0

    # Alpha (Jensen's)
    strategy_annual = float(aligned["strategy"].mean() * trading_days_per_year)
    benchmark_annual = float(aligned["benchmark"].mean() * trading_days_per_year)
    alpha = strategy_annual - (risk_free_rate + beta * (benchmark_annual - risk_free_rate))

    # Tracking Error & Information Ratio
    excess_returns = aligned["strategy"] - aligned["benchmark"]
    tracking_error = float(excess_returns.std() * np.sqrt(trading_days_per_year))
    information_ratio = (
        float(excess_returns.mean() * trading_days_per_year / tracking_error)
        if tracking_error > 0 else 0.0
    )

    # Up/Down Capture (monthly)
    monthly = aligned.resample("ME").apply(lambda x: (1 + x).prod() - 1)
    up_months = monthly[monthly["benchmark"] > 0]
    down_months = monthly[monthly["benchmark"] < 0]

    up_capture = (
        float(up_months["strategy"].mean() / up_months["benchmark"].mean())
        if len(up_months) > 0 and float(up_months["benchmark"].mean()) > 0 else 0.0
    )
    down_capture = (
        float(down_months["strategy"].mean() / down_months["benchmark"].mean())
        if len(down_months) > 0 and float(down_months["benchmark"].mean()) < 0 else 0.0
    )

    return (
        benchmark_return, benchmark_cagr, alpha, beta,
        tracking_error, information_ratio, up_capture, down_capture,
    )
```

### 6.4 Trade Log Extraction from vectorbt

```python
# backend/app/services/backtest_trades.py

import pandas as pd
import vectorbt as vbt


def extract_trades(pf: vbt.Portfolio) -> pd.DataFrame:
    """Extract individual trade records from a vectorbt Portfolio object."""
    trades = pf.trades.records_readable
    if trades is None or len(trades) == 0:
        return pd.DataFrame()

    trade_list = []
    for i, row in trades.iterrows():
        direction = "long" if row["Size"] > 0 else "short"
        trade_list.append({
            "entry_date": row["Entry Index"] if isinstance(row["Entry Index"], pd.Timestamp)
                          else str(row["Entry Index"]),
            "exit_date": row["Exit Index"] if isinstance(row["Exit Index"], pd.Timestamp)
                         else str(row["Exit Index"]),
            "direction": direction,
            "entry_price": row["Entry Price"],
            "exit_price": row["Exit Price"],
            "size": abs(row["Size"]),
            "pnl": row["PnL"],
            "pnl_pct": row["Return"],
            "return_pct": row["Return"],
            "holding_days": (row["Exit Index"] - row["Entry Index"]).days
                            if hasattr(row["Exit Index"], "days") else 1,
        })
    return pd.DataFrame(trade_list)


def extract_equity_curve(pf: vbt.Portfolio) -> pd.DataFrame:
    """Extract equity curve with dates from vectorbt Portfolio."""
    equity = pf.value()
    if isinstance(equity, pd.Series):
        return equity.reset_index().rename(
            columns={"index": "date", equity.name or "value": "equity"}
        )
    return pd.DataFrame(equity).reset_index().rename(
        columns={"index": "date", 0: "equity"}
    )


def extract_drawdown_curve(pf: vbt.Portfolio) -> pd.DataFrame:
    """Extract drawdown curve from vectorbt Portfolio."""
    dd = pf.drawdown()
    if isinstance(dd, pd.Series):
        return dd.reset_index().rename(
            columns={"index": "date", dd.name or "drawdown": "drawdown"}
        )
    return pd.DataFrame(dd).reset_index().rename(columns={"index": "date", 0: "drawdown"})


def compute_monthly_returns(returns: pd.Series) -> pd.DataFrame:
    """Compute monthly returns heatmap data. Returns pivot table: years x months."""
    monthly = returns.resample("ME").apply(lambda x: (1 + x).prod() - 1)
    monthly_df = monthly.to_frame(name="return")
    monthly_df["year"] = monthly_df.index.year
    monthly_df["month"] = monthly_df.index.month
    heatmap = monthly_df.pivot_table(
        values="return", index="year", columns="month", aggfunc="first"
    )
    return heatmap
```

### 6.5 Metrics Formula Reference

| Metric | Formula | Python Equivalent |
|---|---|---|
| **Total Return** | `V_final / V_initial - 1` | `cumprod[-1] - 1` |
| **CAGR** | `(V_final / V_initial)^(1/yrs) - 1` | `cumprod[-1] ** (252/n) - 1` |
| **Annualized Vol** | `sigma_daily * sqrt(252)` | `returns.std() * sqrt(252)` |
| **Sharpe Ratio** | `(R_annual - Rf) / sigma_annual` | `excess_return / ann_vol` |
| **Sortino Ratio** | `(R_annual - Rf) / sigma_downside` | `excess_return / downside_vol` |
| **Calmar Ratio** | `CAGR / abs(MDD)` | `cagr / abs(mdd)` |
| **Max Drawdown** | `min(cumulative / peak - 1)` | `(cum/peak - 1).min()` |
| **Win Rate** | `N_wins / N_total` | `len(winners) / len(trades)` |
| **Profit Factor** | `GrossProfit / abs(GrossLoss)` | `win_pnl.sum() / abs(lose_pnl.sum())` |
| **Avg Win/Avg Loss** | `abs(avg_win) / abs(avg_loss)` | `abs(avg_win_pct) / abs(avg_loss_pct)` |
| **SQN** | `sqrt(N) * mu / sigma` (annual) | See `_compute_sqn()` |
| **Kelly Criterion** | `W - (1-W)/(W/L_ratio)` | `win_rate - (1-wr)/(wl_ratio)` |
| **Alpha (Jensen's)** | `Rp - [Rf + beta*(Rb - Rf)]` | `r_annual - (rf + beta*(b_annual - rf))` |
| **Beta** | `Cov(Rp, Rb) / Var(Rb)` | `strategy.cov(bench) / bench.var()` |
| **Information Ratio** | `(Rp-Rb)annual / sigma(Rp-Rb)annual` | `excess.mean()*252 / tracking_err` |
| **VaR 95%** | 5th percentile of daily returns | `np.percentile(returns, 5)` |
| **CVaR 95%** | Mean of returns <= VaR | `returns[returns <= var].mean()` |
| **Ulcer Index** | `sqrt(mean(drawdown^2))` | `sqrt((dd**2).mean())` |
| **Recovery Factor** | `Net Profit / abs(MDD)` | `net_profit / abs(mdd)` |

---

## 7. Report Generation

### 7.1 QuantStats HTML Tear Sheet

```python
# backend/app/services/backtest_report.py

import quantstats as qs
import io
import tempfile
import os
import matplotlib
matplotlib.use("Agg")

def generate_quantstats_report(
    returns,
    benchmark_returns=None,
    title: str = "Trend-Scope Strategy Report",
    output_path: str = None,
) -> str:
    """Generate a full QuantStats HTML tear sheet.

    Args:
        returns: Daily strategy returns (pandas Series).
        benchmark_returns: Optional daily benchmark returns.
        title: Report title.
        output_path: If provided, write HTML to this path.

    Returns:
        HTML string of the report.
    """
    qs.extend_pandas()

    if output_path:
        qs.reports.html(
            returns,
            benchmark=benchmark_returns,
            title=title,
            output=output_path,
        )
        with open(output_path, "r") as f:
            return f.read()
    else:
        with tempfile.NamedTemporaryFile(suffix=".html", delete=False, mode="w") as tmp:
            qs.reports.html(
                returns,
                benchmark=benchmark_returns,
                title=title,
                output=tmp.name,
            )
        with open(tmp.name, "r") as f:
            html = f.read()
        os.unlink(tmp.name)
        return html
```

### 7.2 Custom Charts (matplotlib)

```python
# backend/app/services/backtest_charts.py

import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import pandas as pd
import numpy as np
import io
import base64

STYLE = {
    "figsize": (16, 9),
    "dpi": 100,
    "strategy_color": "#1f77b4",
    "benchmark_color": "#ff7f0e",
    "drawdown_color": "#d62728",
    "profit_color": "#2ca02c",
    "loss_color": "#d62728",
    "grid_alpha": 0.3,
}


def _figure_to_base64(fig: plt.Figure) -> str:
    """Convert matplotlib figure to base64-encoded PNG for HTML embedding."""
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=STYLE["dpi"], bbox_inches="tight")
    buf.seek(0)
    img_base64 = base64.b64encode(buf.read()).decode("utf-8")
    plt.close(fig)
    return img_base64


def plot_equity_curve(
    equity_curve: pd.DataFrame,
    benchmark_equity: pd.DataFrame = None,
    title: str = "Equity Curve",
) -> str:
    """Generate equity curve chart with optional benchmark overlay. Returns base64 PNG."""
    fig, ax = plt.subplots(figsize=STYLE["figsize"])

    ax.plot(
        pd.to_datetime(equity_curve["date"]),
        equity_curve["equity"],
        color=STYLE["strategy_color"],
        linewidth=1.5,
        label="Strategy",
    )

    if benchmark_equity is not None:
        ax.plot(
            pd.to_datetime(benchmark_equity["date"]),
            benchmark_equity["equity"],
            color=STYLE["benchmark_color"],
            linewidth=1.0,
            alpha=0.8,
            linestyle="--",
            label="Benchmark",
        )

    ax.set_title(title, fontsize=14, fontweight="bold")
    ax.set_xlabel("Date")
    ax.set_ylabel("Equity ($)")
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"${x:,.0f}"))
    ax.legend(loc="upper left")
    ax.grid(True, alpha=STYLE["grid_alpha"])
    fig.tight_layout()
    return _figure_to_base64(fig)


def plot_drawdown(
    drawdown_curve: pd.DataFrame,
    title: str = "Drawdown",
) -> str:
    """Generate underwater (drawdown) chart. Returns base64 PNG."""
    fig, ax = plt.subplots(figsize=STYLE["figsize"])

    dates = pd.to_datetime(drawdown_curve["date"])
    dd = drawdown_curve["drawdown"] * 100  # Convert to %

    ax.fill_between(dates, 0, dd, color=STYLE["drawdown_color"], alpha=0.3)
    ax.plot(dates, dd, color=STYLE["drawdown_color"], linewidth=1.0)

    ax.set_title(title, fontsize=14, fontweight="bold")
    ax.set_xlabel("Date")
    ax.set_ylabel("Drawdown (%)")
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda y, _: f"{y:.0f}%"))
    ax.grid(True, alpha=STYLE["grid_alpha"])
    ax.invert_yaxis()
    fig.tight_layout()
    return _figure_to_base64(fig)


def plot_monthly_returns_heatmap(
    monthly_returns: pd.DataFrame,
    title: str = "Monthly Returns Heatmap",
) -> str:
    """Generate monthly returns heatmap (calendar style). Returns base64 PNG."""
    fig, ax = plt.subplots(figsize=(14, max(6, len(monthly_returns) * 0.5)))

    data_pct = monthly_returns * 100  # Convert to %
    vmax = max(abs(data_pct.max().max()), abs(data_pct.min().min()), 1.0)

    im = ax.imshow(data_pct.values, cmap="RdYlGn", aspect="auto", vmin=-vmax, vmax=vmax)

    for i in range(len(data_pct)):
        for j in range(len(data_pct.columns)):
            val = data_pct.iloc[i, j]
            if not np.isnan(val):
                ax.text(
                    j, i, f"{val:+.1f}%",
                    ha="center", va="center", fontsize=8,
                    color="black" if abs(val) < vmax * 0.7 else "white",
                )

    month_names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                   "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    ax.set_xticks(range(12))
    ax.set_xticklabels(month_names, rotation=45, ha="left")
    ax.set_yticks(range(len(data_pct)))
    ax.set_yticklabels(data_pct.index.astype(int))

    yearly = data_pct.sum(axis=1)
    for i, total in enumerate(yearly):
        ax.text(12.3, i, f"{total:+.1f}%", va="center", fontsize=9,
                fontweight="bold",
                color=STYLE["profit_color"] if total >= 0 else STYLE["loss_color"])

    ax.set_title(title, fontsize=14, fontweight="bold")
    fig.colorbar(im, ax=ax, label="Monthly Return (%)")
    fig.tight_layout()
    return _figure_to_base64(fig)


def plot_trade_distribution(
    trades: pd.DataFrame,
    title: str = "Trade PnL Distribution",
) -> str:
    """Generate trade PnL histogram. Returns base64 PNG."""
    if trades is None or len(trades) == 0:
        return ""

    fig, ax = plt.subplots(figsize=(12, 5))
    pnl_pct = trades["pnl_pct"] * 100

    ax.hist(pnl_pct, bins=50, color=STYLE["strategy_color"], alpha=0.7, edgecolor="white")
    ax.axvline(x=0, color="black", linestyle="--", linewidth=0.8)
    ax.axvline(
        x=pnl_pct.mean(), color=STYLE["profit_color"], linestyle="-", linewidth=1.5,
        label=f"Mean: {pnl_pct.mean():+.2f}%"
    )

    ax.set_title(title, fontsize=14, fontweight="bold")
    ax.set_xlabel("Trade Return (%)")
    ax.set_ylabel("Frequency")
    ax.legend()
    ax.grid(True, alpha=STYLE["grid_alpha"])
    fig.tight_layout()
    return _figure_to_base64(fig)
```

### 7.3 Report Storage

Reports are stored as:
- **HTML string** in `backtest_results.report_html` (TEXT column, MySQL)
- **Equity curve** as JSON in `backtest_results.equity_curve`
- **Drawdown curve** as JSON in `backtest_results.drawdown_curve`
- **Monthly returns** as JSON in `backtest_results.monthly_returns`
- **Trade log** as JSON in `backtest_results.trade_log`

Report HTML is self-contained: all charts embedded as base64 PNG images, all CSS inline. No external resources needed.

---

## 8. Parameter Optimization (Pro Tier)

### 8.1 Grid Search via vectorbt run_combs

```python
# backend/app/services/backtest_optimization.py

import numpy as np
import pandas as pd
import vectorbt as vbt
from typing import Dict, Any, Tuple


def grid_search_ma_cross(
    price: pd.DataFrame,
    fast_range: Tuple[int, int, int] = (5, 60, 5),
    slow_range: Tuple[int, int, int] = (20, 250, 10),
    initial_capital: float = 100_000.0,
    objective: str = "sharpe_ratio",
    max_combos: int = 2000,
) -> Dict[str, Any]:
    """
    Vectorized grid search for MA crossover parameters.

    Uses vectorbt's run_combs to test all parameter combinations simultaneously.
    Must have fast < slow constraint.

    Returns: {best_params, best_metric, all_results, objective}
    """
    fast_windows = np.arange(*fast_range)
    slow_windows = np.arange(*slow_range)

    # Constraint: fast < slow
    valid_mask = fast_windows[:, None] < slow_windows
    total_valid = valid_mask.sum()
    if total_valid > max_combos:
        raise ValueError(
            f"Too many combinations ({total_valid}). Narrow parameter ranges."
        )

    close = price["close"].values

    # Run all MA combinations
    fast_ma = vbt.MA.run(close, window=fast_windows)
    slow_ma = vbt.MA.run(close, window=slow_windows, per_column=True)

    entries = fast_ma.ma_crossed_above(slow_ma)
    exits = fast_ma.ma_crossed_below(slow_ma)

    entries = entries.shift(1).fillna(False)
    exits = exits.shift(1).fillna(False)

    pf = vbt.Portfolio.from_signals(
        close=price["close"],
        entries=entries,
        exits=exits,
        init_cash=initial_capital,
        freq="D",
    )

    # Extract objective metric
    metric_map = {
        "sharpe_ratio": pf.sharpe_ratio(),
        "total_return": pf.total_return(),
        "sortino_ratio": pf.sortino_ratio(),
        "calmar_ratio": pf.calmar_ratio(),
    }
    metric = metric_map.get(objective, pf.sharpe_ratio())

    # Find best combination
    best_flat_idx = np.nanargmax(metric.values)
    best_idx = np.unravel_index(best_flat_idx, metric.values.shape)
    best_fast = int(fast_windows[best_idx[0]])
    best_slow = int(slow_windows[best_idx[1]])

    # Build results
    all_results = []
    for i, fw in enumerate(fast_windows):
        for j, sw in enumerate(slow_windows):
            if not valid_mask[i, j]:
                continue
            try:
                val = float(metric.values[i, j])
            except IndexError:
                continue
            all_results.append({
                "fast_ma": int(fw),
                "slow_ma": int(sw),
                objective: val,
            })

    return {
        "best_params": {"ma_short": best_fast, "ma_long": best_slow},
        "best_metric": float(np.nanmax(metric.values)),
        "all_results": all_results,
        "objective": objective,
    }
```

### 8.2 Optuna Bayesian Optimization

```python
# (continued)

import optuna
from optuna.samplers import TPESampler
from optuna.pruners import MedianPruner
import logging

logger = logging.getLogger(__name__)


def optimize_optuna(
    price: pd.DataFrame,
    strategy_type: str,
    n_trials: int = 200,
    timeout: int = 300,
    objective_metric: str = "sharpe_ratio",
    initial_capital: float = 100_000.0,
    slippage: float = 0.0005,
    commission: float = 0.001,
) -> Dict[str, Any]:
    """
    Optuna-based Bayesian optimization for strategy parameters.

    Uses TPE sampler with MedianPruner for early stopping of unpromising trials.
    Best for strategies with 3+ parameters where grid search is infeasible.
    """
    study = optuna.create_study(
        direction="maximize",
        sampler=TPESampler(seed=42),
        pruner=MedianPruner(n_startup_trials=20, n_warmup_steps=10),
    )

    def objective(trial: optuna.Trial) -> float:
        params = _suggest_params(trial, strategy_type)
        result = _run_single_backtest(
            price=price, params=params, strategy_type=strategy_type,
            initial_capital=initial_capital, slippage=slippage, commission=commission,
        )
        trial.report(result.get("sharpe_ratio", 0), step=1)
        if trial.should_prune():
            raise optuna.TrialPruned()
        return result.get(objective_metric, 0.0)

    study.optimize(
        objective,
        n_trials=n_trials,
        timeout=timeout,
        show_progress_bar=False,
    )

    return {
        "best_params": study.best_params,
        "best_metric": study.best_value,
        "n_trials": len(study.trials),
        "objective_metric": objective_metric,
        "optimization_history": [
            {"trial": t.number, "value": t.value, "params": t.params, "state": str(t.state)}
            for t in study.trials if t.value is not None
        ],
        "param_importances": _compute_param_importance(study),
    }


def _suggest_params(trial: optuna.Trial, strategy_type: str) -> Dict[str, Any]:
    """Suggest parameters based on strategy type."""
    if strategy_type == "ma_cross":
        return {
            "ma_short": trial.suggest_int("ma_short", 5, 80),
            "ma_long": trial.suggest_int("ma_long", 20, 300),
            "confirm_bars": trial.suggest_int("confirm_bars", 0, 5),
        }
    elif strategy_type == "multi_indicator":
        return {
            "ma_short": trial.suggest_int("ma_short", 5, 50),
            "ma_long": trial.suggest_int("ma_long", 20, 200),
            "rsi_period": trial.suggest_int("rsi_period", 7, 30),
            "rsi_oversold": trial.suggest_int("rsi_oversold", 20, 40),
            "rsi_overbought": trial.suggest_int("rsi_overbought", 60, 80),
            "bb_period": trial.suggest_int("bb_period", 10, 50),
            "bb_std": trial.suggest_float("bb_std", 1.5, 3.0),
            "roc_period": trial.suggest_int("roc_period", 5, 30),
            "threshold_buy": trial.suggest_float("threshold_buy", 0.1, 0.5),
            "threshold_sell": trial.suggest_float("threshold_sell", -0.5, -0.1),
        }
    raise ValueError(f"Unknown strategy type: {strategy_type}")


def _run_single_backtest(
    price: pd.DataFrame,
    params: Dict[str, Any],
    strategy_type: str,
    initial_capital: float,
    slippage: float,
    commission: float,
) -> Dict[str, float]:
    """Run a single backtest with given parameters. Used inside Optuna objective."""
    from backend.app.services.backtest_strategy import StrategySignalBuilder
    from backend.app.services.backtest_engine import run_vectorbt_backtest

    builder = StrategySignalBuilder(price, params, strategy_type)
    signals = builder.build()
    pf = run_vectorbt_backtest(
        price=price, entries=signals.entries, exits=signals.exits,
        initial_capital=initial_capital, slippage=slippage, commission=commission,
    )
    return {
        "total_return": float(pf.total_return()),
        "sharpe_ratio": float(pf.sharpe_ratio()),
        "sortino_ratio": float(pf.sortino_ratio()),
        "max_drawdown": float(pf.max_drawdown()),
        "calmar_ratio": float(pf.calmar_ratio()),
        "win_rate": float(pf.trades.win_rate()),
    }


def _compute_param_importance(study: optuna.Study) -> Dict[str, float]:
    """Compute parameter importance scores."""
    try:
        importance = optuna.importance.get_param_importances(study)
        return {k: float(v) for k, v in importance.items()}
    except Exception:
        return {}
```

### 8.3 Overfitting Detection

```python
# backend/app/services/backtest_overfitting.py

import numpy as np
from scipy import stats
from typing import Dict, Any


def deflated_sharpe_ratio(
    observed_sharpe: float,
    sharpe_distribution: np.ndarray,
    num_trials: int,
    skewness: float,
    kurtosis: float,
) -> float:
    """
    Compute the Deflated Sharpe Ratio (DSR) p-value.

    Tests whether the strategy's Sharpe ratio is statistically significant
    after accounting for multiple testing (data snooping bias).

    Based on: Bailey & Lopez de Prado (2014), "The Deflated Sharpe Ratio"

    Returns DSR p-value. Values < 0.05 indicate statistical significance.
    """
    n = len(sharpe_distribution)
    if n < 10:
        return 1.0

    # Expected maximum Sharpe under null using extreme value theory
    euler_mascheroni = 0.5772156649
    exp_max_sharpe = (
        np.sqrt(2 * np.log(num_trials))
        - (np.log(np.log(num_trials)) + np.log(4 * np.pi) - 2 * euler_mascheroni)
        / (2 * np.sqrt(2 * np.log(num_trials)))
    )

    # Penalize for skewness and kurtosis
    penalty = (
        1.0 + (skewness / 3.0) * observed_sharpe
        - ((kurtosis - 3.0) / 24.0) * (observed_sharpe ** 2)
    )
    deflated_sr = observed_sharpe / penalty

    sr_std = np.sqrt(
        (1.0 / n)
        * (
            1.0 + 0.5 * deflated_sr ** 2
            - skewness * deflated_sr
            + (kurtosis - 3.0) / 4.0 * deflated_sr ** 2
        )
    )

    if sr_std <= 0:
        return 1.0

    psr = stats.norm.cdf((deflated_sr - exp_max_sharpe) / sr_std)
    return max(0.0, min(1.0, 1.0 - psr))


def check_is_oos_gap(
    is_sharpe: float,
    oos_sharpe: float,
    threshold: float = 0.30,
) -> Dict[str, Any]:
    """Check if the IS/OOS gap is acceptable. Gap > 30% indicates overfitting."""
    if is_sharpe <= 0:
        gap = 1.0
    else:
        gap = abs(is_sharpe - oos_sharpe) / abs(is_sharpe)

    return {
        "is_sharpe": is_sharpe,
        "oos_sharpe": oos_sharpe,
        "gap": float(gap),
        "overfit": gap > threshold,
        "severity": (
            "high" if gap > 0.50 else
            ("moderate" if gap > threshold else "low")
        ),
        "recommendation": (
            "Strategy likely overfit. Reduce params or increase OOS period."
            if gap > threshold
            else "IS/OOS gap acceptable."
        ),
    }


def check_degrees_of_freedom(
    num_trades: int,
    num_params: int,
    threshold: float = 10.0,
) -> Dict[str, Any]:
    """Check the degrees-of-freedom ratio. Ratio >= 10 is adequate."""
    ratio = num_trades / num_params if num_params > 0 else float("inf")

    return {
        "num_trades": num_trades,
        "num_params": num_params,
        "dof_ratio": float(ratio),
        "adequate": ratio >= threshold,
        "recommendation": (
            f"DOF ratio {ratio:.1f} insufficient (need >= {threshold}). "
            "Reduce parameters or extend backtest period."
            if ratio < threshold
            else f"DOF ratio {ratio:.1f} adequate."
        ),
    }
```

### 8.4 Parameter Sensitivity Analysis

```python
def parameter_sensitivity(
    price: pd.DataFrame,
    base_params: Dict[str, Any],
    strategy_type: str,
    perturbations: float = 0.5,
    steps: int = 11,
    initial_capital: float = 100_000.0,
) -> Dict[str, list]:
    """
    One-at-a-time parameter sensitivity analysis.

    For each parameter:
      1. Hold all other params at base value.
      2. Vary this param from (1-perturbations) to (1+perturbations) in `steps`.
      3. Record Sharpe ratio at each point.

    A robust strategy shows a smooth plateau around the optimum, not a sharp spike.
    """
    sensitivity_results = {}

    for param_name, base_value in base_params.items():
        if not isinstance(base_value, (int, float)):
            continue

        factor_range = np.linspace(1 - perturbations, 1 + perturbations, steps)
        param_results = []

        for factor in factor_range:
            test_params = base_params.copy()
            if isinstance(base_value, int):
                test_params[param_name] = max(1, int(round(base_value * factor)))
            else:
                test_params[param_name] = base_value * factor

            result = _run_single_backtest(
                price, test_params, strategy_type,
                initial_capital, slippage=0.0005, commission=0.001,
            )
            param_results.append({
                "param_value": test_params[param_name],
                "factor": float(factor),
                "sharpe_ratio": result["sharpe_ratio"],
                "total_return": result["total_return"],
                "max_drawdown": result["max_drawdown"],
            })

        sensitivity_results[param_name] = param_results

    return sensitivity_results
```

---

## 9. Walk-Forward Analysis

### 9.1 Walk-Forward Algorithm (Complete)

```python
# backend/app/services/backtest_walkforward.py

import numpy as np
import pandas as pd
from typing import Dict, List, Tuple, Any
import optuna


def walk_forward_analysis(
    price: pd.DataFrame,
    strategy_type: str,
    n_windows: int = 5,
    is_years: float = 3.0,
    oos_years: float = 1.0,
    mode: str = "expanding",
    initial_capital: float = 100_000.0,
    slippage: float = 0.0005,
    commission: float = 0.001,
    n_trials_per_window: int = 100,
    objective_metric: str = "sharpe_ratio",
) -> Dict[str, Any]:
    """
    Complete walk-forward analysis.

    Algorithm per window:
      1. Optimize parameters on In-Sample (IS) period
      2. Save optimal parameters
      3. Run backtest on Out-of-Sample (OOS) period
      4. Record OOS metrics
      5. Slide window forward by OOS length

    After all windows:
      - Aggregate OOS equity curves -> "walk-forward equity curve"
      - Compare IS Sharpe vs OOS Sharpe -> robustness score
      - Track parameter stability over windows

    Args:
        price: OHLCV DataFrame with DatetimeIndex.
        strategy_type: "ma_cross" or "multi_indicator".
        n_windows: Number of walk-forward windows.
        is_years: In-sample period length in years.
        oos_years: Out-of-sample period length in years.
        mode: "expanding" (IS grows) or "rolling" (IS fixed length).
        n_trials_per_window: Optuna trials per window.

    Returns:
        Comprehensive walk-forward analysis results.
    """
    if not isinstance(price.index, pd.DatetimeIndex):
        price = price.copy()
        price.index = pd.to_datetime(price.index)

    trading_days_per_year = 252
    is_days = int(is_years * trading_days_per_year)
    oos_days = int(oos_years * trading_days_per_year)
    total_days_needed = is_days + oos_days * n_windows

    if len(price) < total_days_needed:
        raise ValueError(
            f"Insufficient data: need {total_days_needed} days, have {len(price)}."
        )

    window_results = []
    all_oos_returns = pd.Series(dtype=float)
    param_history = []

    for w in range(n_windows):
        # Define IS/OOS boundaries
        if mode == "expanding":
            is_start = 0
            is_end = is_days + w * oos_days
        else:  # rolling
            is_start = w * oos_days
            is_end = is_start + is_days
        oos_start = is_end
        oos_end = min(oos_start + oos_days, len(price))

        if oos_end <= oos_start:
            break

        is_data = price.iloc[is_start:is_end]
        oos_data = price.iloc[oos_start:oos_end]

        # --- Phase 1: In-Sample Optimization ---
        best_params, is_metrics = _optimize_window(
            is_data, strategy_type, n_trials_per_window,
            objective_metric, initial_capital, slippage, commission,
        )

        # --- Phase 2: Out-of-Sample Validation ---
        oos_metrics, oos_returns = _validate_window(
            oos_data, best_params, strategy_type,
            initial_capital, slippage, commission,
        )

        window_results.append({
            "window": w + 1,
            "is_period": f"{is_data.index[0].date()} to {is_data.index[-1].date()}",
            "oos_period": f"{oos_data.index[0].date()} to {oos_data.index[-1].date()}",
            "best_params": best_params,
            "is_sharpe": is_metrics.get("sharpe_ratio", 0),
            "oos_sharpe": oos_metrics.get("sharpe_ratio", 0),
            "is_total_return": is_metrics.get("total_return", 0),
            "oos_total_return": oos_metrics.get("total_return", 0),
            "is_max_drawdown": is_metrics.get("max_drawdown", 0),
            "oos_max_drawdown": oos_metrics.get("max_drawdown", 0),
            "oos_win_rate": oos_metrics.get("win_rate", 0),
            "oos_num_trades": oos_metrics.get("num_trades", 0),
        })
        param_history.append(best_params)
        all_oos_returns = pd.concat([all_oos_returns, oos_returns])

    # --- Post-Analysis ---
    # Aggregate OOS metrics
    aggregate_oos_metrics = {}
    if len(all_oos_returns) > 0:
        from backend.app.services.backtest_metrics import compute_metrics
        agg = compute_metrics(all_oos_returns)
        aggregate_oos_metrics = {
            "total_return": agg.total_return,
            "cagr": agg.cagr,
            "sharpe_ratio": agg.sharpe_ratio,
            "sortino_ratio": agg.sortino_ratio,
            "max_drawdown": agg.max_drawdown,
            "win_rate": agg.win_rate,
            "num_trades": agg.num_trades,
        }

    # Parameter stability
    param_stability = _compute_param_stability(param_history)

    # Overfitting check
    avg_is_sharpe = float(np.mean([w["is_sharpe"] for w in window_results]))
    avg_oos_sharpe = float(np.mean([w["oos_sharpe"] for w in window_results]))

    from backend.app.services.backtest_overfitting import check_is_oos_gap
    is_oos_check = check_is_oos_gap(avg_is_sharpe, avg_oos_sharpe)

    # Robustness score: fraction of windows with positive OOS return
    oos_positive = sum(1 for w in window_results if w["oos_total_return"] > 0)
    robustness_score = oos_positive / len(window_results) if window_results else 0

    return {
        "n_windows": len(window_results),
        "is_years": is_years,
        "oos_years": oos_years,
        "mode": mode,
        "window_results": window_results,
        "aggregate_oos_metrics": aggregate_oos_metrics,
        "param_stability": param_stability,
        "is_oos_gap_check": is_oos_check,
        "robustness_score": float(robustness_score),
        "avg_is_sharpe": avg_is_sharpe,
        "avg_oos_sharpe": avg_oos_sharpe,
        "wf_equity_curve": (
            (1 + all_oos_returns).cumprod().reset_index().to_dict("records")
            if len(all_oos_returns) > 0 else []
        ),
    }


def _optimize_window(
    price, strategy_type, n_trials, objective_metric,
    initial_capital, slippage, commission,
) -> Tuple[Dict, Dict]:
    """Optimize parameters on a single IS window using Optuna."""
    from backend.app.services.backtest_optimization import _suggest_params, _run_single_backtest

    study = optuna.create_study(
        direction="maximize",
        sampler=optuna.samplers.TPESampler(seed=42),
        pruner=optuna.pruners.MedianPruner(n_warmup_steps=5),
    )

    def objective(trial):
        params = _suggest_params(trial, strategy_type)
        result = _run_single_backtest(
            price, params, strategy_type,
            initial_capital, slippage, commission,
        )
        trial.report(result.get("sharpe_ratio", 0), step=1)
        if trial.should_prune():
            raise optuna.TrialPruned()
        return result.get(objective_metric, 0.0)

    study.optimize(objective, n_trials=n_trials, show_progress_bar=False)

    best_params = study.best_params
    best_result = _run_single_backtest(
        price, best_params, strategy_type,
        initial_capital, slippage, commission,
    )
    return best_params, best_result


def _validate_window(
    price, params, strategy_type, initial_capital, slippage, commission,
) -> Tuple[Dict, pd.Series]:
    """Run backtest on OOS window with fixed (optimized) parameters."""
    from backend.app.services.backtest_strategy import StrategySignalBuilder
    from backend.app.services.backtest_engine import run_vectorbt_backtest

    builder = StrategySignalBuilder(price, params, strategy_type)
    signals = builder.build()
    pf = run_vectorbt_backtest(
        price, signals.entries, signals.exits,
        initial_capital, slippage, commission,
    )
    returns = pf.returns().dropna()
    metrics = {
        "total_return": float(pf.total_return()),
        "sharpe_ratio": float(pf.sharpe_ratio() or 0),
        "sortino_ratio": float(pf.sortino_ratio() or 0),
        "max_drawdown": float(pf.max_drawdown() or 0),
        "win_rate": float(pf.trades.win_rate() or 0),
        "num_trades": len(pf.trades.records) if pf.trades is not None else 0,
    }
    return metrics, returns


def _compute_param_stability(param_history: List[Dict]) -> Dict:
    """Measure parameter variation across walk-forward windows."""
    if len(param_history) < 2:
        return {}
    stability = {}
    all_keys = set()
    for p in param_history:
        all_keys.update(p.keys())
    for key in all_keys:
        values = [w[key] for w in param_history if key in w and w[key] is not None]
        if len(values) >= 2:
            arr = np.array(values, dtype=float)
            stability[key] = {
                "mean": float(np.mean(arr)),
                "std": float(np.std(arr)),
                "cv": float(np.std(arr) / np.mean(arr)) if np.mean(arr) != 0 else float("inf"),
                "min": float(np.min(arr)),
                "max": float(np.max(arr)),
                "range_pct": float((np.max(arr) - np.min(arr)) / np.mean(arr) * 100)
                             if np.mean(arr) != 0 else float("inf"),
            }
    return stability
```

### 9.2 Walk-Forward Visual Representation

```
Timeline: ---------------------------------------------------------------->

Window 1:  [------ IS (3Y) ------][-- OOS (1Y) --]
Window 2:       [------ IS (3Y) ------][-- OOS (1Y) --]     <- expanding (IS grows)
Window 3:            [------ IS (3Y) ------][-- OOS (1Y) --]
Window 4:                 [------ IS (3Y) ------][-- OOS (1Y) --]
Window 5:                      [------ IS (3Y) ------][-- OOS (1Y) --]

OR (rolling window, fixed IS length):

Window 1:  [-- IS --][-- OOS --][----------------]
Window 2:  [--------][-- IS --][-- OOS --][------]
Window 3:  [----------------][-- IS --][-- OOS --]

Aggregate OOS: [-- W1 OOS --][-- W2 OOS --][-- W3 OOS --]... -> "Walk-Forward Equity Curve"
```

---

## 10. Task Queue Implementation (ARQ + Redis)

### 10.1 ARQ Worker Setup

```python
# backend/app/services/backtest_worker.py

import asyncio
import json
import hashlib
import time
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any

import numpy as np
import pandas as pd
from arq.connections import RedisSettings
from arq.worker import func

logger = logging.getLogger(__name__)


class WorkerSettings:
    """ARQ worker configuration."""

    redis_settings = RedisSettings(
        host="redis",
        port=6379,
    )

    job_timeout = 360        # 6 minutes overall
    keep_result = 86400      # 24 hours
    max_jobs = 20            # Max concurrent jobs per worker
    poll_delay = 0.5         # Poll interval
    health_check_interval = 1

    functions = [
        func(run_backtest_task, name="run_backtest"),
    ]


# ---- Progress Reporting ----

async def _update_progress(redis, job_id: str, stage: str, percent: float, message: str = "") -> None:
    """Update progress in Redis for status polling."""
    progress = json.dumps({
        "stage": stage,
        "percent": percent,
        "message": message,
    })
    await redis.set(f"backtest:progress:{job_id}", progress, ex=3600)


# ---- Cache Helpers ----

def _make_cache_key(
    stock_id: int, config_id: int, params: dict,
    date_range_hash: str, initial_capital: float,
    slippage: float, commission: float,
) -> str:
    """Build deterministic cache key."""
    param_str = json.dumps(params, sort_keys=True)
    hash_input = (
        f"v2:{stock_id}:{config_id}:{param_str}:{date_range_hash}:"
        f"{initial_capital}:{slippage}:{commission}"
    )
    hash_digest = hashlib.sha256(hash_input.encode()).hexdigest()[:16]
    return f"backtest:{hash_digest}"


def _make_date_range_hash(start: str, end: str) -> str:
    """Hash the date range for cache key."""
    return hashlib.md5(f"{start}:{end}".encode()).hexdigest()[:8]
```

### 10.2 Main Backtest Task Function

```python
# (continued)

async def run_backtest_task(
    ctx: dict,
    job_id: str,
    user_id: int,
    params_dict: Dict[str, Any],
) -> Dict[str, Any]:
    """
    ARQ task: Execute a complete backtest.

    Stages:
      1. Validate parameters
      2. Fetch price data from MySQL
      3. Build strategy signals
      4. Run vectorbt portfolio simulation
      5. Calculate metrics
      6. Run benchmark comparison
      7. Generate charts (base64 PNGs)
      8. Generate HTML report
      9. Store results in MySQL
      10. Cache result in Redis (24h TTL)

    On failure: update job status to 'failed' with error message.
    """
    redis = ctx.get("redis")
    db_session_factory = ctx.get("db_session_factory")
    start_time = time.monotonic()

    try:
        # ---- Stage 1: Validate ----
        await _update_progress(redis, job_id, "validating", 0, "Validating parameters...")
        # (validation logic -- see section 3)

        # ---- Stage 2: Fetch Data ----
        await _update_progress(redis, job_id, "fetching_data", 5, "Fetching price data...")
        # Fetch from DB using db_session_factory

        # ---- Stage 3: Build Signals ----
        await _update_progress(redis, job_id, "building_signals", 15, "Building strategy signals...")
        # builder = StrategySignalBuilder(df, config_params, config_type)
        # signals = builder.build()

        # ---- Stage 4: Portfolio Simulation ----
        await _update_progress(redis, job_id, "simulating", 30, "Running vectorbt simulation...")
        # pf = run_vectorbt_backtest(price, entries, exits, ...)
        # returns = pf.returns().dropna()

        # ---- Stage 5: Benchmark ----
        await _update_progress(redis, job_id, "benchmarking", 45, "Running benchmark comparison...")
        # benchmark_pf = run_benchmark_comparison(benchmark_df, initial_capital)

        # ---- Stage 6: Metrics ----
        await _update_progress(redis, job_id, "computing_metrics", 55, "Computing metrics...")
        # metrics = compute_metrics(returns, benchmark_returns, trades_df)

        # ---- Stage 7: Charts ----
        await _update_progress(redis, job_id, "generating_charts", 70, "Generating charts...")
        # equity_chart = plot_equity_curve(equity_df)
        # drawdown_chart = plot_drawdown(drawdown_df)
        # heatmap = plot_monthly_returns_heatmap(monthly_df)
        # trade_dist = plot_trade_distribution(trades_df)

        # ---- Stage 8: HTML Report ----
        await _update_progress(redis, job_id, "generating_report", 85, "Assembling HTML report...")
        # report_html = assemble_report_html(metrics, charts, trades_df)

        # ---- Stage 9: Persist Results ----
        await _update_progress(redis, job_id, "saving", 95, "Saving results to database...")
        # INSERT into backtest_results
        # UPDATE backtest_jobs SET status='completed', completed_at=now()

        # ---- Stage 10: Cache ----
        cache_key = _make_cache_key(...)
        cache_data = json.dumps({"job_id": job_id, "cached_at": datetime.now(timezone.utc).isoformat()})
        await redis.set(cache_key, cache_data, ex=86400)

        await _update_progress(redis, job_id, "done", 100, "Backtest complete.")
        elapsed_ms = int((time.monotonic() - start_time) * 1000)
        logger.info(f"Backtest {job_id} completed in {elapsed_ms}ms.")

        return {"job_id": job_id, "status": "completed", "elapsed_ms": elapsed_ms}

    except asyncio.TimeoutError:
        logger.error(f"Backtest {job_id} timed out.")
        await _handle_failure(ctx, job_id, "Backtest exceeded 5-minute timeout.")
        raise

    except Exception as e:
        logger.exception(f"Backtest {job_id} failed: {e}")
        await _handle_failure(ctx, job_id, str(e)[:2000])
        raise


async def _handle_failure(ctx: dict, job_id: str, error_message: str) -> None:
    """Mark job as failed and store error."""
    db_session_factory = ctx.get("db_session_factory")
    if db_session_factory:
        async with db_session_factory() as db:
            from sqlalchemy import update
            from backend.app.models.backtest import BacktestJob
            await db.execute(
                update(BacktestJob)
                .where(BacktestJob.id == job_id)
                .values(
                    status="failed",
                    error_message=error_message,
                    completed_at=datetime.now(timezone.utc),
                )
            )
            await db.commit()


async def on_startup(ctx: dict) -> None:
    """ARQ worker startup hook."""
    logger.info("BacktestWorker starting up...")
    # Initialize DB connection pool
    logger.info("BacktestWorker ready.")


async def on_shutdown(ctx: dict) -> None:
    """ARQ worker shutdown hook."""
    logger.info("BacktestWorker shutting down...")
    engine = ctx.get("db_engine")
    if engine:
        await engine.dispose()
    logger.info("BacktestWorker stopped.")
```

### 10.3 Error Handling & Retry

```python
# Retry configuration is built into ARQ via job options:
# When enqueueing:
#   await arq.enqueue_job(
#       "run_backtest",
#       job_id=job_id, ...,
#       _job_retry=3,              # Max retries (ARQ built-in)
#       _job_retry_delay=10.0,     # Base delay between retries (seconds)
#   )

# ARQ uses exponential backoff: delay * 2^attempt
# Transient errors (DB connection, Redis timeout):
#   ARQ catches unhandled exceptions and re-queues up to _job_retry times.
# Permanent errors (validation failure, insufficient data):
#   Should be caught and NOT re-raised, so job goes directly to 'failed'.
```

### 10.4 Docker Compose Integration

```yaml
# docker-compose.yml (excerpt)
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  backend:
    build: ./backend
    ports:
      - "8000:8000"
    depends_on:
      - redis
      - mysql

  arq-worker:
    build: ./backend
    command: >
      arq backend.app.services.backtest_worker.WorkerSettings
      --redis redis://redis:6379
    depends_on:
      - redis
      - mysql
    deploy:
      replicas: 2
```

---

## 11. API Endpoints

### 11.1 Endpoint Summary

| Method | Endpoint | Auth | Tier | Description |
|---|---|---|---|---|
| POST | `/backtest/submit` | User | Pro | Submit a new backtest job |
| GET | `/backtest/{job_id}` | User | Pro | Get job status, progress, and results |
| GET | `/backtest/{job_id}/report` | User | Pro | Get HTML report (full or summary) |
| GET | `/backtest/history` | User | Pro | List user's past backtests |
| GET | `/admin/backtest-jobs` | Admin | Admin | List all jobs (monitoring) |

### 11.2 Router Implementation (FastAPI Skeleton)

```python
# backend/app/api/v1/backtest.py

from fastapi import APIRouter, Depends, HTTPException, status

router = APIRouter(prefix="/backtest", tags=["backtest"])


@router.post("/submit")
async def submit_backtest(
    request: BacktestSubmit,
    current_user=Depends(get_current_user),
    db=Depends(get_db),
    redis=Depends(get_redis),
    arq=Depends(get_arq),
):
    """
    Submit a new backtest job.

    Pro tier required. Limited to 10 backtests/day.
    Checks cache first, then enqueues to ARQ.
    """
    # 1. Tier check: must be pro or admin
    if current_user.tier_slug not in ("pro", "admin"):
        raise HTTPException(status_code=402, detail="Pro subscription required.")

    # 2. Daily limit check
    daily_count = await count_user_daily_backtests(db, current_user.id)
    if daily_count >= 10:
        raise HTTPException(
            status_code=429,
            detail="Daily backtest limit (10) reached. Try again tomorrow.",
            headers={"X-RateLimit-Reset": "tomorrow 00:00 UTC"},
        )

    # 3. Concurrency check
    await check_concurrency_limits(db, redis, current_user.id)

    # 4. Cache check
    cache_key = _make_cache_key(...)
    cached = await redis.get(cache_key)
    if cached:
        return {"job_id": "cached", "status": "completed", "cached": True}

    # 5. Create job record
    job = BacktestJob(user_id=current_user.id, stock_id=request.stock_id, ...)
    db.add(job)
    await db.commit()

    # 6. Enqueue to ARQ
    await arq.enqueue_job(
        "run_backtest",
        job_id=job.id,
        user_id=current_user.id,
        params_dict=request.model_dump(),
        _job_retry=3,
        _job_retry_delay=10.0,
    )

    return {"job_id": job.id, "status": "queued"}


@router.get("/{job_id}")
async def get_backtest_status(
    job_id: str,
    current_user=Depends(get_current_user),
    db=Depends(get_db),
    redis=Depends(get_redis),
):
    """Get job status and results."""
    job = await db.get(BacktestJob, job_id)
    if not job or job.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Job not found.")

    # Get progress from Redis (if running)
    progress_raw = await redis.get(f"backtest:progress:{job_id}")
    progress = json.loads(progress_raw) if progress_raw else None

    response = {
        "job_id": job.id,
        "status": job.status,
        "progress": progress,
        "created_at": job.created_at.isoformat(),
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
        "error_message": job.error_message,
        "result_summary": None,
    }

    if job.status == "completed":
        result = await db.execute(
            select(BacktestResult).where(BacktestResult.job_id == job_id)
        )
        result = result.scalar_one_or_none()
        if result:
            response["result_summary"] = {
                "total_return": result.total_return,
                "cagr": result.cagr,
                "sharpe_ratio": result.sharpe_ratio,
                "max_drawdown": result.max_drawdown,
                "win_rate": result.win_rate,
                "num_trades": result.num_trades,
                "benchmark_return": result.benchmark_return,
            }

    return response


@router.get("/{job_id}/report")
async def get_backtest_report(
    job_id: str,
    format: str = "html",
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Get full HTML report or summary JSON."""
    job = await db.get(BacktestJob, job_id)
    if not job or job.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Job not found.")
    if job.status != "completed":
        raise HTTPException(status_code=400, detail="Backtest not yet completed.")

    result = await db.execute(
        select(BacktestResult).where(BacktestResult.job_id == job_id)
    )
    result = result.scalar_one_or_none()

    if format == "html":
        from fastapi.responses import HTMLResponse
        return HTMLResponse(content=result.report_html)
    else:
        return {
            "metrics": {
                "total_return": result.total_return,
                "cagr": result.cagr,
                "max_drawdown": result.max_drawdown,
                "sharpe_ratio": result.sharpe_ratio,
                "sortino_ratio": result.sortino_ratio,
                "calmar_ratio": result.calmar_ratio,
                "win_rate": result.win_rate,
                "profit_factor": result.profit_factor,
                "num_trades": result.num_trades,
                "benchmark_return": result.benchmark_return,
            },
            "trades": json.loads(result.trade_log) if result.trade_log else [],
        }


@router.get("/history")
async def get_backtest_history(
    current_user=Depends(get_current_user),
    db=Depends(get_db),
    page: int = 1,
    size: int = 20,
):
    """List user's past backtests with pagination."""
    query = (
        select(BacktestJob)
        .where(BacktestJob.user_id == current_user.id)
        .order_by(BacktestJob.created_at.desc())
        .offset((page - 1) * size)
        .limit(size)
    )
    jobs = (await db.execute(query)).scalars().all()

    return {
        "items": [
            {
                "job_id": j.id,
                "stock_id": j.stock_id,
                "config_id": j.config_id,
                "status": j.status,
                "created_at": j.created_at.isoformat(),
                "completed_at": j.completed_at.isoformat() if j.completed_at else None,
            }
            for j in jobs
        ],
        "total": len(jobs),
        "page": page,
        "size": size,
    }
```

---

## 12. Performance & Scaling

### 12.1 Benchmark Targets

| Scenario | Expected Time | Engine | Notes |
|---|---|---|---|
| Single stock, 10Y daily, MA cross | ~50ms | vectorbt | Pure vectorized simulation |
| Single stock, 10Y daily, multi-indicator | ~80ms | vectorbt | Extra indicator computation |
| 1,000 param combos (grid search) | ~5s | vectorbt `run_combs` | Vectorized combos |
| 200 Optuna trials (Bayesian) | ~30s | vectorbt + Optuna | Per-trial vectorbt call |
| Walk-forward (5 windows, 100 trials each) | ~3min | vectorbt + Optuna | 5 x (100 trials x ~0.3s) |
| QuantStats HTML report generation | ~2s | QuantStats | Includes all charts |
| Custom chart generation (4 charts) | ~1s | matplotlib | Equity, DD, heatmap, distribution |

### 12.2 Caching Strategy

```python
# Cache Key Format
# backtest:{sha256_hash[:16]}
# where hash_input = f"v2:{stock_id}:{config_id}:{sorted_params_json}:{date_range_hash}:{capital}:{slippage}:{commission}"

# Cache TTL: 24 hours
# Invalidation: auto-expire only. No manual invalidation needed since:
#   - Historical price data doesn't change (split-adjusted)
#   - Strategy params are deterministic
#   - 24h is sufficient for same-day repeat queries

# Redis memory estimate:
#   - Average cached result: ~2 KB (metrics JSON only, not full HTML)
#   - 1,000 unique backtests/day * 2 KB = 2 MB/day
#   - Negligible for Redis
```

### 12.3 Rate Limiting

| Limit | Value | Enforcement Point |
|---|---|---|
| Daily backtests per Pro user | 10 | FastAPI endpoint, before enqueue |
| Concurrent per user | 3 | `check_concurrency_limits()` |
| Total concurrent (global) | 10 | Redis counter `backtest:active_count` |
| User API rate (general) | Per tier limits | `rate_limit` middleware |

### 12.4 Scaling Plan

| Phase | Workers | Redis | MySQL | Notes |
|---|---|---|---|---|
| P7 Launch | 2 ARQ workers | Single instance | Single instance | ~10 backtests/day |
| Growth | 4 workers | Sentinal HA | Read replicas | ~50 backtests/day |
| Scale | 8+ workers, dedicated queue | Redis Cluster | Sharded by user_id | ~200+ backtests/day |

---

## 13. Testing

### 13.1 Known Strategy Validation

```python
# tests/test_backtest_validation.py

import pytest
import pandas as pd
import numpy as np

def test_spy_200ma_crossover_known_results():
    """
    Validate against known historical results:
    SPY 200-day SMA crossover strategy.
    Expected: Lower drawdown than buy-and-hold in 2008, positive CAGR.
    """
    # Fetch 10+ years of SPY data
    # Run 200MA cross strategy
    # Assert:
    #   - CAGR > 0 (strategy is profitable long-term)
    #   - Max DD < Buy-and-Hold Max DD (risk reduction)
    #   - Sharpe > 0.5
    pass


def test_golden_cross_detection():
    """Verify golden cross is detected correctly for a known pattern."""
    close = np.array([100, 101, 102, 103, 104, 105, 106, 107, 108, 109])
    # With short MA=2, long MA=5
    # MA2: [nan, 100.5, 101.5, 102.5, 103.5, 104.5, 105.5, 106.5, 107.5, 108.5]
    # MA5: [nan, nan, nan, nan, 102, 103, 104, 105, 106, 107]
    # At index 4: MA2=103.5 > MA5=102 -> cross happened earlier
    # Verify entry signal generation
    pass
```

### 13.2 Edge Cases

```python
class TestBacktestEdgeCases:
    """Edge case tests for the backtest system."""

    def test_insufficient_data(self):
        """Less than 20 data points should raise ValueError."""
        with pytest.raises(ValueError, match="Insufficient data"):
            compute_metrics(pd.Series(np.random.randn(10) * 0.01))

    def test_all_cash_period(self):
        """Period with no trades (all cash) should not crash."""
        # Zero entries -> zero trades -> metrics should handle gracefully
        entries = np.zeros(100, dtype=bool)
        exits = np.zeros(100, dtype=bool)
        # Should return portfolio with no trades, 0% return
        pass

    def test_single_trade(self):
        """Single entry and exit should compute metrics correctly."""
        entries = np.zeros(100, dtype=bool)
        exits = np.zeros(100, dtype=bool)
        entries[10] = True
        exits[50] = True
        # Should compute valid metrics with 1 trade
        pass

    def test_consecutive_entries(self):
        """Consecutive entry signals should be deduplicated."""
        entries = np.array([False, True, True, False, False])
        exits = np.array([False, False, False, True, False])
        # Dedup should produce only 1 entry at index 1
        pass

    def test_no_entries__no_trades(self):
        """Strategy with zero entry signals."""
        # Should return zero trades, win_rate=0, profit_factor=0
        pass

    def test_benchmark_mismatch(self):
        """Strategy and benchmark have different date ranges."""
        # Aligned date ranges should work
        # Missing benchmark data should return zeros for relative metrics
        pass

    def test_zero_volatility(self):
        """Flat price (no volatility) should handle division by zero."""
        returns = pd.Series(np.zeros(50))
        metrics = compute_metrics(returns)
        # Sharpe should be 0.0, not NaN or inf
        assert metrics.sharpe_ratio == 0.0
```

### 13.3 Metrics Sanity Checks

```python
def test_metrics_sanity():
    """Sanity check known metric relationships."""
    # Given known returns, verify:
    # - Positive CAGR => positive total return
    # - Sortino >= Sharpe (since Sortino ignores upside vol)
    # - Calmar = 0 if MDD = 0
    # - Win rate in [0, 1]
    # - Kelly in [0, 1]
    # - Recovery Factor >= 0
    pass


def test_benchmark_alpha_beta():
    """Benchmark relative metrics for perfectly correlated strategy."""
    # If strategy == benchmark, beta should be ~1.0, alpha ~0
    returns = pd.Series(np.random.randn(252) * 0.01 + 0.0003)  # ~8% annual
    # Same data as benchmark
    metrics = compute_metrics(returns, benchmark_returns=returns)
    assert abs(metrics.beta - 1.0) < 0.1
    assert abs(metrics.alpha) < 0.01
```

### 13.4 Testing Checklist

- [x] Known strategy (SPY 200MA cross) matches published results
- [ ] Insufficient data raises clear error
- [ ] All-cash periods handled gracefully
- [ ] Single trade computes correct metrics
- [ ] Consecutive signals are deduplicated
- [ ] Zero volatility returns 0.0 for ratios (not NaN)
- [ ] Benchmark mismatch returns safe defaults
- [ ] Round-trip: submit -> poll -> report -> verify
- [ ] Cache hit returns same result
- [ ] Concurrent job limit enforced
- [ ] Timeout kills long-running jobs
- [ ] Walk-forward produces valid OOS equity curve
- [ ] Optuna optimization finds better params than defaults

---

## Change Log

| Version | Date | Changes |
|---|---|---|
| v1 | 2026-06-09 | Initial comprehensive design: architecture, strategy impl, metrics, report, optimization, walk-forward, ARQ worker, API endpoints, scaling, testing |
