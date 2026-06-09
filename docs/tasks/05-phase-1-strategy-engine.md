# Task 05 — Phase 1 Strategy Engine

> **Estimated time**: 3-4 days
> **Dependencies**: Task 04 (stock data service), Task 03 (auth)
> **Status**: Not started
> **参考设计文档**:
> - [001-preliminary-design.md](../design/001-preliminary-design.md) — 总体架构
> - [phase-1.md](../design/phase-1.md) — Phase 1 MVP 详细设计
> - [003-api-specification.md](../design/003-api-specification.md) — API规格
> - [004-analysis-engine.md](../design/004-analysis-engine.md) — 分析引擎设计

---

## 1. Objective

Implement the complete strategy system: 3 strategy types (ma_cross, multi_indicator, custom_script), script sandbox, strategy CRUD API, and signal generation. The signal generation logic MUST be extractable as a standalone function `generate_signals(df, config) -> pd.Series` importable from `analysis_engine.py` for reuse by BacktestService (Task 07).

---

## 2. Files to Create/Modify

| # | File Path | Action | Description |
|---|-----------|--------|-------------|
| 1 | `backend/app/services/analysis_engine.py` | CREATE | SignalEngine class + standalone `generate_signals()` |
| 2 | `backend/app/services/script_executor.py` | CREATE | ScriptExecutor: sandboxed custom script execution |
| 3 | `backend/app/schemas/analysis.py` | CREATE | Pydantic schemas for strategies & signals |
| 4 | `backend/app/api/v1/admin/strategies.py` | CREATE | Admin strategy CRUD endpoints |
| 5 | `backend/app/api/v1/analysis.py` | CREATE | Public signal query endpoint |
| 6 | `backend/app/api/v1/admin/signals.py` | CREATE | Admin signal listing endpoint |
| 7 | `backend/app/api/v1/router.py` | MODIFY | Register new routers |
| 8 | `backend/app/models/analysis.py` | MODIFY | Add `custom_script` to strategy_type enum, add `created_by`, `script_content`, `script_params`, `description` fields |

---

## 3. File: `backend/app/services/analysis_engine.py`

### 3.1 Complete Implementation

```python
"""
Signal Engine — dispatches analysis configs to generate trade signals.

Provides a standalone `generate_signals()` function that both SignalEngine
and BacktestService (Task 07) import as the single source of truth.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Optional

import numpy as np
import pandas as pd
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.analysis import AnalysisConfig, AnalysisSignal
from backend.app.services.script_executor import ScriptExecutor

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Standalone function — single source of truth for both engine and backtest
# ---------------------------------------------------------------------------

def generate_signals(df: pd.DataFrame, config) -> pd.Series:
    """
    Generate trade signals for an entire price history.

    Parameters
    ----------
    df : pd.DataFrame
        DatetimeIndex, columns: [open, high, low, close, volume].
    config : AnalysisConfig (or duck-typed equivalent with .strategy_type, .params,
             .script_content, .script_params)

    Returns
    -------
    pd.Series
        Same index as df.  1 = buy, -1 = sell, 0 = hold.
        ALREADY shifted(1) so there is no look-ahead bias — the signal for bar
        i is based on data up to bar i-1 and becomes actionable at bar i's open.
    """
    strategy_type = config.strategy_type.value if hasattr(config.strategy_type, 'value') else config.strategy_type

    if strategy_type == "ma_cross":
        return _generate_ma_cross(df, config)
    elif strategy_type == "multi_indicator":
        return _generate_multi_indicator(df, config)
    elif strategy_type == "custom_script":
        return _generate_custom_script(df, config)
    else:
        raise ValueError(f"Unknown strategy_type: {strategy_type}")


# ---------------------------------------------------------------------------
# MA Cross strategy
# ---------------------------------------------------------------------------

def _generate_ma_cross(df: pd.DataFrame, config) -> pd.Series:
    params = config.params if hasattr(config, 'params') else config
    if isinstance(params, str):
        import json
        params = json.loads(params)

    fast = params.get("ma_short", 20)
    slow = params.get("ma_long", 60)
    ma_type = params.get("ma_type", "sma")

    close = df["close"]

    if ma_type == "ema":
        fast_ma = close.ewm(span=fast, adjust=False).mean()
        slow_ma = close.ewm(span=slow, adjust=False).mean()
    else:
        fast_ma = close.rolling(fast).mean()
        slow_ma = close.rolling(slow).mean()

    # Cross detection (no look-ahead: use .shift(1) comparison)
    prev_fast_above = fast_ma.shift(1) > slow_ma.shift(1)
    prev_slow_above = slow_ma.shift(1) > fast_ma.shift(1)
    curr_fast_above = fast_ma > slow_ma

    golden_cross = curr_fast_above & (~prev_fast_above) & prev_slow_above
    death_cross = (~curr_fast_above) & prev_fast_above & (~prev_slow_above)

    # Build signal series: shift(1) so entry/exit is at NEXT bar's open
    raw = pd.Series(0, index=df.index, dtype=int)
    raw[golden_cross] = 1
    raw[death_cross] = -1

    # Deduplicate: keep only first signal after a flip
    signals = _dedup_signals(raw)

    return signals


def _dedup_signals(raw: pd.Series) -> pd.Series:
    """Ensure buy/sell alternate: keep only the first signal after a flip."""
    result = raw.copy()
    in_position = False
    for i in range(len(result)):
        if not in_position and result.iloc[i] == 1:
            in_position = True
        elif in_position and result.iloc[i] == -1:
            in_position = False
        elif in_position and result.iloc[i] == 1:
            result.iloc[i] = 0
        elif not in_position and result.iloc[i] == -1:
            result.iloc[i] = 0
    return result


# ---------------------------------------------------------------------------
# Multi-Indicator strategy
# ---------------------------------------------------------------------------

def _generate_multi_indicator(df: pd.DataFrame, config) -> pd.Series:
    params = config.params if hasattr(config, 'params') else config
    if isinstance(params, str):
        import json
        params = json.loads(params)

    weights = params.get("weights", {
        "ma_cross": 0.20, "rsi": 0.15, "macd": 0.20,
        "bb": 0.15, "volume": 0.15, "roc": 0.15,
    })
    threshold_buy = params.get("threshold_buy", 0.3)
    threshold_sell = params.get("threshold_sell", -0.3)

    close = df["close"]
    volume = df["volume"]

    # 1. MA Cross component
    ma_fast_p = params.get("ma_short", 10)
    ma_slow_p = params.get("ma_long", 30)
    ma_fast = close.rolling(ma_fast_p).mean()
    ma_slow = close.rolling(ma_slow_p).mean()
    ma_sig = pd.Series(0.0, index=df.index)
    ma_sig[ma_fast > ma_slow] = 1.0
    ma_sig[ma_fast < ma_slow] = -1.0

    # 2. RSI component
    rsi_period = params.get("rsi_period", 14)
    rsi = _compute_rsi(close, rsi_period)
    rsi_sig = pd.Series(0.0, index=df.index)
    rsi_sig[rsi < 30] = 1.0       # oversold -> bullish
    rsi_sig[rsi > 70] = -1.0      # overbought -> bearish

    # 3. MACD component
    macd_fast = params.get("macd_fast", 12)
    macd_slow_p = params.get("macd_slow", 26)
    macd_signal_period = params.get("macd_signal", 9)
    ema_f = close.ewm(span=macd_fast, adjust=False).mean()
    ema_s = close.ewm(span=macd_slow_p, adjust=False).mean()
    macd_line = ema_f - ema_s
    macd_signal = macd_line.ewm(span=macd_signal_period, adjust=False).mean()
    macd_hist = macd_line - macd_signal
    macd_sig = pd.Series(0.0, index=df.index)
    macd_sig[macd_hist > 0] = 1.0
    macd_sig[macd_hist < 0] = -1.0

    # 4. Bollinger Bands
    bb_period = params.get("bb_period", 20)
    bb_mid = close.rolling(bb_period).mean()
    bb_std = close.rolling(bb_period).std()
    bb_upper = bb_mid + 2 * bb_std
    bb_lower = bb_mid - 2 * bb_std
    bb_sig = pd.Series(0.0, index=df.index)
    bb_sig[close < bb_lower] = 1.0
    bb_sig[close > bb_upper] = -1.0

    # 5. Volume component
    vol_period = params.get("vol_ma_period", 20)
    vol_factor = params.get("vol_factor", 1.5)
    vol_ma = volume.rolling(vol_period).mean()
    price_dir = np.sign(close.diff().fillna(0))
    vol_sig = pd.Series(0.0, index=df.index)
    high_vol = volume > (vol_ma * vol_factor)
    vol_sig[high_vol & (price_dir > 0)] = 1.0
    vol_sig[high_vol & (price_dir < 0)] = -1.0

    # 6. ROC component
    roc_period = params.get("roc_period", 10)
    roc = close.pct_change(roc_period)
    roc_sig = pd.Series(0.0, index=df.index)
    roc_sig[roc > 0] = 1.0
    roc_sig[roc < 0] = -1.0

    # Weighted composite
    composite = (
        weights.get("ma_cross", 0.20) * ma_sig +
        weights.get("rsi", 0.15) * rsi_sig +
        weights.get("macd", 0.20) * macd_sig +
        weights.get("bb", 0.15) * bb_sig +
        weights.get("volume", 0.15) * vol_sig +
        weights.get("roc", 0.15) * roc_sig
    )
    composite = composite.fillna(0.0)
    composite = np.tanh(composite)  # smooth to [-1, 1]

    # Generate signals from composite score
    raw = pd.Series(0, index=df.index, dtype=int)
    if threshold_buy > 0:
        raw[composite > threshold_buy] = 1
    if threshold_sell < 0:
        raw[composite < threshold_sell] = -1

    return _dedup_signals(raw)


def _compute_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = (-delta).clip(lower=0)
    avg_gain = gain.ewm(alpha=1/period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1/period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100.0 - (100.0 / (1.0 + rs))


# ---------------------------------------------------------------------------
# Custom Script strategy
# ---------------------------------------------------------------------------

def _generate_custom_script(df: pd.DataFrame, config) -> pd.Series:
    script = config.script_content if hasattr(config, 'script_content') else ""
    script_params = config.script_params if hasattr(config, 'script_params') else {}
    if isinstance(script_params, str):
        import json
        script_params = json.loads(script_params)

    executor = ScriptExecutor()
    return executor.execute_sync(script, df.copy(), script_params)


# ============================================================================
# SignalEngine — orchestrates scanning and persistence
# ============================================================================

class SignalEngine:
    """Orchestrates strategy scanning, dedup, confirmation, and persistence."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ---- Public API -------------------------------------------------------

    async def scan_all_active(self) -> list[AnalysisSignal]:
        """
        Iterate all active AnalysisConfigs, call scan_single for each,
        return list of newly-created AnalysisSignal instances.
        """
        result = await self.db.execute(
            select(AnalysisConfig).where(AnalysisConfig.is_active == True)
        )
        configs = result.scalars().all()

        logger.info("Scanning %d active strategy configs", len(configs))
        signals: list[AnalysisSignal] = []
        for config in configs:
            try:
                sig = await self.scan_single(config)
                if sig is not None:
                    signals.append(sig)
            except Exception:
                logger.exception("Error scanning config id=%d name=%s", config.id, config.name)
        logger.info("Scan complete: %d new signals generated", len(signals))
        return signals

    async def scan_single(self, config: AnalysisConfig) -> Optional[AnalysisSignal]:
        """
        Load price data for the stock, dispatch by strategy_type,
        detect if the latest bar has a new actionable signal.
        Returns a persisted AnalysisSignal or None.
        """
        from backend.app.models.stock import StockPriceDaily

        # Load enough history for indicator warm-up (max needed: 250 bars)
        prices_query = (
            select(StockPriceDaily)
            .where(StockPriceDaily.stock_id == config.stock_id)
            .order_by(StockPriceDaily.trade_date.desc())
            .limit(300)
        )
        rows = (await self.db.execute(prices_query)).scalars().all()
        if len(rows) < 50:
            logger.warning("Insufficient price data for stock_id=%d", config.stock_id)
            return None

        rows = sorted(rows, key=lambda r: r.trade_date)
        df = pd.DataFrame([{
            "open": float(r.open),
            "high": float(r.high),
            "low": float(r.low),
            "close": float(r.close),
            "volume": float(r.volume),
        } for r in rows], index=pd.DatetimeIndex([r.trade_date for r in rows]))

        # Generate signals for entire history (shifted — no look-ahead)
        sig_series = generate_signals(df, config)

        # Look for a new signal on the LAST bar (most recent trading day)
        last_idx = sig_series.index[-1]
        last_val = sig_series.iloc[-1]

        if last_val == 0:
            return None

        signal_type = "buy" if last_val == 1 else "sell"
        trigger_date = last_idx.date() if hasattr(last_idx, 'date') else last_idx
        trigger_price = float(df["close"].iloc[-1])

        # Dedup check: same stock+config+signal_type within 20 trading days
        is_dup = await self._is_duplicate(
            config.stock_id, config.id, signal_type, trigger_date
        )
        if is_dup:
            logger.debug("Duplicate signal suppressed: config=%d type=%s date=%s",
                         config.id, signal_type, trigger_date)
            return None

        # Confirmation check (confirm_bars + volume_confirm)
        if not self._confirm_signal(signal_type, df, config):
            logger.debug("Signal failed confirmation: config=%d type=%s", config.id, signal_type)
            return None

        # Determine signal subtype and strength
        subtype = self._subtype_for(signal_type, config)
        strength = self._compute_strength(df, config)

        return await self._build_signal(
            stock_id=config.stock_id,
            config_id=config.id,
            signal_type=signal_type,
            subtype=subtype,
            strength=strength,
            price=trigger_price,
            details={
                "trigger_date": str(trigger_date),
                "strategy_type": config.strategy_type.value if hasattr(config.strategy_type, 'value') else config.strategy_type,
                "config_name": config.name,
                "last_close": trigger_price,
            },
        )

    # ---- Internal helpers ------------------------------------------------

    async def _is_duplicate(
        self, stock_id: int, config_id: int, signal_type: str, trigger_date: date
    ) -> bool:
        cutoff = trigger_date - timedelta(days=20)
        existing = await self.db.execute(
            select(AnalysisSignal).where(
                AnalysisSignal.stock_id == stock_id,
                AnalysisSignal.config_id == config_id,
                AnalysisSignal.signal_type == signal_type,
                AnalysisSignal.triggered_date >= cutoff,
                AnalysisSignal.is_active == True,
            )
        )
        return existing.scalar_one_or_none() is not None

    def _confirm_signal(self, signal_type: str, df: pd.DataFrame, config: AnalysisConfig) -> bool:
        """
        confirm_bars: require MA relationship to persist for N bars after cross.
        volume_confirm: require signal day volume > 1.5x 20-day average volume.
        """
        confirm = getattr(config, 'confirm_bars', 0) or 0
        volume_confirm = getattr(config, 'volume_confirm', False)

        # Volume confirmation
        if volume_confirm:
            vol = df["volume"]
            vol_ma_20 = vol.rolling(20).mean()
            if vol.iloc[-1] < vol_ma_20.iloc[-1] * 1.5:
                return False

        # confirm_bars (only for ma_cross)
        if confirm > 0 and config.strategy_type not in (None,):
            st = config.strategy_type.value if hasattr(config.strategy_type, 'value') else config.strategy_type
            if st == "ma_cross" and len(df) > confirm:
                params = config.params
                if isinstance(params, str):
                    import json
                    params = json.loads(params)
                fast = params.get("ma_short", 20)
                slow = params.get("ma_long", 60)
                fast_ma = df["close"].rolling(fast).mean()
                slow_ma = df["close"].rolling(slow).mean()
                recent = slice(-confirm - 1, -1) if len(df) > confirm + 1 else slice(-confirm, None)
                recent_fast = fast_ma.iloc[recent]
                recent_slow = slow_ma.iloc[recent]
                if signal_type == "buy":
                    if not (recent_fast > recent_slow).all():
                        return False
                else:
                    if not (recent_fast < recent_slow).all():
                        return False

        return True

    def _subtype_for(self, signal_type: str, config: AnalysisConfig) -> str:
        st = config.strategy_type.value if hasattr(config.strategy_type, 'value') else config.strategy_type
        if st == "ma_cross":
            return "golden_cross" if signal_type == "buy" else "death_cross"
        elif st == "multi_indicator":
            return "composite_buy" if signal_type == "buy" else "composite_sell"
        else:
            return "custom"

    def _compute_strength(self, df: pd.DataFrame, config: AnalysisConfig) -> str:
        """Compute signal strength: weak / normal / strong."""
        vol = df["volume"]
        vol_ma_20 = vol.rolling(20).mean()
        vol_ratio = float(vol.iloc[-1] / vol_ma_20.iloc[-1]) if vol_ma_20.iloc[-1] > 0 else 1.0

        if vol_ratio > 2.0:
            return "strong"
        elif vol_ratio > 1.5:
            return "normal"
        return "weak"

    async def _build_signal(
        self, stock_id: int, config_id: int, signal_type: str,
        subtype: str, strength: str, price: float, details: dict,
    ) -> AnalysisSignal:
        signal = AnalysisSignal(
            stock_id=stock_id,
            config_id=config_id,
            signal_type=signal_type,
            signal_subtype=subtype,
            strength=strength,
            confidence=0.5,      # default; overridden by AI later
            trigger_price=price,
            trigger_details=details,
            triggered_date=details["trigger_date"],
            is_active=True,
        )
        self.db.add(signal)
        await self.db.commit()
        await self.db.refresh(signal)
        return signal
```

---

## 4. File: `backend/app/services/script_executor.py`

### 4.1 Complete Implementation

```python
"""
Script Executor — sandboxed execution of custom strategy scripts.

Uses AST validation + import whitelist.  For Phase 1 RestrictedPython is the
preferred sandbox; if unavailable, falls back to restricted exec with whitelist.

Script interface:  def analyze(df, params) -> pd.Series
  - df: DataFrame with columns [open, high, low, close, volume]
  - params: dict from analysis_configs.script_params
  - returns: pd.Series (1=buy, -1=sell, 0=hold) aligned to df.index
"""

from __future__ import annotations

import ast
import logging
import multiprocessing
import sys
import time
import traceback
from io import StringIO
from typing import Any

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

ALLOWED_IMPORTS = {"pandas", "numpy", "pandas_ta", "talib"}
ALLOWED_BUILTINS = {
    "abs", "all", "any", "bool", "dict", "enumerate", "float", "int",
    "len", "list", "max", "min", "range", "round", "set", "str",
    "sum", "tuple", "zip", "True", "False", "None", "print",
}
FORBIDDEN_MODULES = {"os", "sys", "subprocess", "socket", "requests", "urllib",
                     "http", "ftplib", "shutil", "importlib", "__builtins__",
                     "pathlib", "io", "open", "eval", "exec", "compile"}

TIMEOUT_SECONDS = 10
MOCK_ROW_COUNT = 100

MOCK_DF = pd.DataFrame({
    "open":   np.random.uniform(100, 200, MOCK_ROW_COUNT),
    "high":   np.random.uniform(100, 200, MOCK_ROW_COUNT),
    "low":    np.random.uniform(100, 200, MOCK_ROW_COUNT),
    "close":  np.random.uniform(100, 200, MOCK_ROW_COUNT),
    "volume": np.random.uniform(1e6, 1e7, MOCK_ROW_COUNT),
}, index=pd.date_range("2024-01-01", periods=MOCK_ROW_COUNT, freq="B"))


class ScriptExecutor:
    """Validates and executes custom strategy scripts in a sandbox."""

    TIMEOUT = TIMEOUT_SECONDS

    # ------------------------------------------------------------------ #
    #  Public API
    # ------------------------------------------------------------------ #

    def validate(self, script: str) -> tuple[bool, str]:
        """
        Validate a strategy script without saving.
        
        Returns (is_valid, message).
        Checks: AST parse, import whitelist, function signature, test-run.
        """
        # 1. AST parse check
        try:
            tree = ast.parse(script)
        except SyntaxError as e:
            return False, f"语法错误: {e.msg} (line {e.lineno})"

        # 2. Import whitelist check
        for node in ast.walk(tree):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        base = alias.name.split(".")[0]
                        if base in FORBIDDEN_MODULES:
                            return False, f"禁止导入模块: {base}"
                        if base not in ALLOWED_IMPORTS:
                            return False, f"不允许导入模块: {base} (仅允许: {ALLOWED_IMPORTS})"
                else:
                    if node.module:
                        base = node.module.split(".")[0]
                        if base in FORBIDDEN_MODULES:
                            return False, f"禁止导入模块: {base}"
                        if base not in ALLOWED_IMPORTS:
                            return False, f"不允许导入模块: {base} (仅允许: {ALLOWED_IMPORTS})"

            # Forbid os/system calls
            if isinstance(node, ast.Call):
                if isinstance(node.func, ast.Name):
                    if node.func.id in {"eval", "exec", "compile", "open", "__import__"}:
                        return False, f"禁止调用: {node.func.id}"

        # 3. Must define analyze(df, params)
        func_found = False
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and node.name == "analyze":
                args = [a.arg for a in node.args.args]
                if len(args) != 2:
                    return False, f"analyze() 必须接受2个参数 (df, params)，实际 {len(args)}"
                func_found = True
                break
        if not func_found:
            return False, "脚本必须定义 analyze(df, params) 函数"

        # 4. Test run on mock data
        try:
            result = self.execute_sync(script, MOCK_DF.copy(), {}, timeout=TIMEOUT_SECONDS)
            if not isinstance(result, pd.Series):
                return False, f"analyze() 必须返回 pd.Series，实际返回 {type(result).__name__}"
            if not set(result.unique()).issubset({1, -1, 0}):
                return False, f"信号值必须为 1/-1/0，实际包含: {set(result.unique()) - {1, -1, 0}}"
        except TimeoutError:
            return False, f"脚本执行超时 ({TIMEOUT_SECONDS}s)"
        except Exception as e:
            return False, f"试运行失败: {type(e).__name__}: {e}"

        return True, "脚本验证通过"

    def execute_sync(
        self, script: str, df: pd.DataFrame, params: dict,
        timeout: int = TIMEOUT_SECONDS,
    ) -> pd.Series:
        """
        Execute a strategy script synchronously in a subprocess sandbox.

        Parameters
        ----------
        script : str
            Python source code defining analyze(df, params).
        df : pd.DataFrame
            OHLCV data with DatetimeIndex.
        params : dict
            Parameter dict passed to analyze().
        timeout : int
            Seconds before TimeoutError is raised.

        Returns
        -------
        pd.Series
            Signal series with values 1/-1/0.
        """
        ctx = multiprocessing.get_context("spawn")
        queue: multiprocessing.Queue = ctx.Queue()

        def _target(q, src, data, prm):
            try:
                # Capture stdout
                old_stdout = sys.stdout
                sys.stdout = StringIO()

                # Restricted globals
                safe_globals = {
                    "__builtins__": {
                        k: __builtins__[k]
                        for k in ALLOWED_BUILTINS
                        if k in __builtins__
                    },
                    "pd": pd,
                    "np": np,
                    "pd_Series": pd.Series,
                    "pd_DataFrame": pd.DataFrame,
                }
                # Try loading pandas_ta / talib if installed
                for mod_name in ("pandas_ta", "talib"):
                    try:
                        safe_globals[mod_name] = __import__(mod_name)
                    except ImportError:
                        pass

                safe_locals: dict[str, Any] = {}
                exec(script, safe_globals, safe_locals)
                analyze_fn = safe_locals.get("analyze")
                if not callable(analyze_fn):
                    q.put(("error", "analyze() 未定义或不可调用"))
                    return

                result = analyze_fn(data, prm)
                if not isinstance(result, pd.Series):
                    q.put(("error", f"analyze() 返回 {type(result).__name__}，期望 pd.Series"))
                    return

                q.put(("ok", result))
            except Exception as e:
                q.put(("error", f"{type(e).__name__}: {e}\n{traceback.format_exc()}"))
            finally:
                sys.stdout = old_stdout

        proc = ctx.Process(target=_target, args=(queue, script, df, params))
        proc.start()
        proc.join(timeout)

        if proc.is_alive():
            proc.terminate()
            proc.join(1)
            raise TimeoutError(f"Script execution exceeded {timeout}s timeout")

        if queue.empty():
            raise RuntimeError("Script subprocess completed without returning a result")

        status, payload = queue.get()
        if status == "error":
            raise RuntimeError(payload)
        return payload

    # ------------------------------------------------------------------ #
    #  Async variant (delegates to sync with run_in_executor)
    # ------------------------------------------------------------------ #

    async def execute(
        self, script: str, df: pd.DataFrame, params: dict,
    ) -> pd.Series:
        """Async wrapper — runs execute_sync in default thread pool."""
        import asyncio
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self.execute_sync, script, df, params)
```

---

## 5. File: `backend/app/schemas/analysis.py`

### 5.1 Complete Implementation

```python
"""Pydantic schemas for strategy configs and analysis signals."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Strategy Config
# ---------------------------------------------------------------------------

class StrategyConfigCreate(BaseModel):
    stock_id: int = Field(..., description="Stock ID (NULL = global)")
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=2000)
    strategy_type: str = Field(..., pattern="^(ma_cross|multi_indicator|custom_script)$")
    params: dict[str, Any] = Field(default_factory=dict)
    script_content: Optional[str] = Field(None, max_length=50000)
    script_params: dict[str, Any] = Field(default_factory=dict)
    confirm_bars: int = Field(default=0, ge=0, le=10)
    volume_confirm: bool = Field(default=False)
    is_active: bool = Field(default=True)


class StrategyConfigUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=2000)
    params: Optional[dict[str, Any]] = None
    script_content: Optional[str] = Field(None, max_length=50000)
    script_params: Optional[dict[str, Any]] = None
    confirm_bars: Optional[int] = Field(None, ge=0, le=10)
    volume_confirm: Optional[bool] = None
    is_active: Optional[bool] = None


class StrategyConfigOut(BaseModel):
    id: int
    stock_id: int
    name: str
    description: Optional[str] = None
    strategy_type: str
    params: dict[str, Any]
    script_content: Optional[str] = None
    script_params: dict[str, Any]
    confirm_bars: int
    volume_confirm: bool
    is_active: bool
    created_by: int
    script_validated: Optional[bool] = None
    validation_message: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class StrategyListResponse(BaseModel):
    items: list[StrategyConfigOut]
    total: int
    page: int
    size: int
    pages: int


# ---------------------------------------------------------------------------
# Script Validation / Test-Run
# ---------------------------------------------------------------------------

class StrategyValidateResponse(BaseModel):
    is_valid: bool
    message: str


class StrategyTestRunRequest(BaseModel):
    days: int = Field(default=100, ge=30, le=365)


class StrategyTestRunSignal(BaseModel):
    date: str
    signal_type: str  # buy / sell
    price: float


class StrategyTestRunResponse(BaseModel):
    tested_bars: int
    signals_detected: int
    signals: list[StrategyTestRunSignal]


# ---------------------------------------------------------------------------
# Signals
# ---------------------------------------------------------------------------

class SignalOut(BaseModel):
    id: int
    stock_id: int
    config_id: int
    signal_type: str  # buy / sell
    signal_subtype: Optional[str] = None
    strength: str     # weak / normal / strong
    confidence: Optional[float] = None
    trigger_price: float
    trigger_details: dict[str, Any]
    triggered_date: date
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class SignalListResponse(BaseModel):
    items: list[SignalOut]
    total: int
    page: int
    size: int
    pages: int
```

---

## 6. File: `backend/app/api/v1/admin/strategies.py`

### 6.1 Complete Implementation

```python
"""
Admin Strategy CRUD API.
Router prefix: /api/v1/admin/strategies
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.deps import get_db, get_current_admin_user
from backend.app.models.analysis import AnalysisConfig
from backend.app.models.user import User
from backend.app.schemas.analysis import (
    StrategyConfigCreate,
    StrategyConfigUpdate,
    StrategyConfigOut,
    StrategyListResponse,
    StrategyValidateResponse,
    StrategyTestRunRequest,
    StrategyTestRunResponse,
    StrategyTestRunSignal,
)
from backend.app.services.analysis_engine import generate_signals
from backend.app.services.script_executor import ScriptExecutor

logger = logging.getLogger(__name__)
router = APIRouter(tags=["admin-strategies"])


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

@router.get("", response_model=StrategyListResponse)
async def list_strategies(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    stock_id: int | None = Query(None),
    is_active: bool | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin_user),
):
    base = select(AnalysisConfig)
    count_base = select(func.count(AnalysisConfig.id))

    if stock_id is not None:
        base = base.where(AnalysisConfig.stock_id == stock_id)
        count_base = count_base.where(AnalysisConfig.stock_id == stock_id)
    if is_active is not None:
        base = base.where(AnalysisConfig.is_active == is_active)
        count_base = count_base.where(AnalysisConfig.is_active == is_active)

    total = (await db.execute(count_base)).scalar() or 0
    rows = (await db.execute(
        base.order_by(AnalysisConfig.updated_at.desc())
            .offset((page - 1) * size)
            .limit(size)
    )).scalars().all()

    return StrategyListResponse(
        items=[StrategyConfigOut.model_validate(r) for r in rows],
        total=total,
        page=page,
        size=size,
        pages=max(1, (total + size - 1) // size),
    )


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

@router.post("", response_model=StrategyConfigOut, status_code=201)
async def create_strategy(
    body: StrategyConfigCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    # Auto-validate custom script before saving
    script_validated = None
    validation_message = None
    if body.strategy_type == "custom_script" and body.script_content:
        executor = ScriptExecutor()
        is_valid, msg = executor.validate(body.script_content)
        script_validated = is_valid
        validation_message = msg
        if not is_valid:
            raise HTTPException(status_code=400, detail=f"脚本验证失败: {msg}")

    config = AnalysisConfig(
        stock_id=body.stock_id,
        name=body.name,
        description=body.description,
        strategy_type=body.strategy_type,
        params=body.params,
        script_content=body.script_content,
        script_params=body.script_params,
        confirm_bars=body.confirm_bars,
        volume_confirm=body.volume_confirm,
        is_active=body.is_active,
        created_by=current_user.id,
    )
    db.add(config)
    await db.commit()
    await db.refresh(config)

    result = StrategyConfigOut.model_validate(config)
    result.script_validated = script_validated
    result.validation_message = validation_message
    return result


# ---------------------------------------------------------------------------
# Get by ID
# ---------------------------------------------------------------------------

@router.get("/{config_id}", response_model=StrategyConfigOut)
async def get_strategy(
    config_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin_user),
):
    config = await db.get(AnalysisConfig, config_id)
    if not config:
        raise HTTPException(status_code=404, detail="策略不存在")
    return StrategyConfigOut.model_validate(config)


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------

@router.patch("/{config_id}", response_model=StrategyConfigOut)
async def update_strategy(
    config_id: int,
    body: StrategyConfigUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin_user),
):
    config = await db.get(AnalysisConfig, config_id)
    if not config:
        raise HTTPException(status_code=404, detail="策略不存在")

    update_data = body.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(config, key, value)
    await db.commit()
    await db.refresh(config)
    return StrategyConfigOut.model_validate(config)


# ---------------------------------------------------------------------------
# Delete (soft)
# ---------------------------------------------------------------------------

@router.delete("/{config_id}", status_code=204)
async def delete_strategy(
    config_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin_user),
):
    config = await db.get(AnalysisConfig, config_id)
    if not config:
        raise HTTPException(status_code=404, detail="策略不存在")
    config.is_active = False
    await db.commit()


# ---------------------------------------------------------------------------
# Validate script (without saving)
# ---------------------------------------------------------------------------

@router.post("/{config_id}/validate", response_model=StrategyValidateResponse)
async def validate_script(
    config_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin_user),
):
    config = await db.get(AnalysisConfig, config_id)
    if not config:
        raise HTTPException(status_code=404, detail="策略不存在")
    if config.strategy_type.value != "custom_script":
        raise HTTPException(status_code=400, detail="仅自定义脚本策略支持验证")
    if not config.script_content:
        return StrategyValidateResponse(is_valid=False, message="脚本内容为空")

    executor = ScriptExecutor()
    is_valid, msg = executor.validate(config.script_content)
    return StrategyValidateResponse(is_valid=is_valid, message=msg)


# ---------------------------------------------------------------------------
# Test-Run
# ---------------------------------------------------------------------------

@router.post("/{config_id}/test-run", response_model=StrategyTestRunResponse)
async def test_run_strategy(
    config_id: int,
    body: StrategyTestRunRequest = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin_user),
):
    from backend.app.models.stock import StockPriceDaily

    config = await db.get(AnalysisConfig, config_id)
    if not config:
        raise HTTPException(status_code=404, detail="策略不存在")

    days = body.days if body else 100
    rows = (await db.execute(
        select(StockPriceDaily)
        .where(StockPriceDaily.stock_id == config.stock_id)
        .order_by(StockPriceDaily.trade_date.desc())
        .limit(days + 50)   # extra for indicator warm-up
    )).scalars().all()

    if len(rows) < 30:
        raise HTTPException(status_code=400, detail="历史数据不足")

    rows = sorted(rows, key=lambda r: r.trade_date)
    df_dates = [r.trade_date for r in rows]
    df = pd.DataFrame([{
        "open": float(r.open), "high": float(r.high),
        "low": float(r.low), "close": float(r.close),
        "volume": float(r.volume),
    } for r in rows], index=pd.DatetimeIndex(df_dates))

    sig_series = generate_signals(df, config)
    recent = sig_series.iloc[-days:]

    signals = []
    for idx in recent[recent != 0].index:
        signals.append(StrategyTestRunSignal(
            date=str(idx.date()),
            signal_type="buy" if recent[idx] == 1 else "sell",
            price=float(df.loc[idx, "close"]),
        ))

    return StrategyTestRunResponse(
        tested_bars=min(days, len(recent)),
        signals_detected=len(signals),
        signals=signals,
    )
```

---

## 7. File: `backend/app/api/v1/analysis.py`

```python
"""
Public analysis endpoints.
Router prefix: /api/v1
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.deps import get_db, get_current_user
from backend.app.models.analysis import AnalysisSignal
from backend.app.models.user import User
from backend.app.schemas.analysis import SignalOut, SignalListResponse

router = APIRouter(tags=["analysis"])


@router.get("/analysis/{stock_id}/signals", response_model=SignalListResponse)
async def get_stock_signals(
    stock_id: int,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    count_q = select(func.count(AnalysisSignal.id)).where(
        AnalysisSignal.stock_id == stock_id
    )
    total = (await db.execute(count_q)).scalar() or 0

    rows = (await db.execute(
        select(AnalysisSignal)
        .where(AnalysisSignal.stock_id == stock_id)
        .order_by(AnalysisSignal.triggered_date.desc())
        .offset((page - 1) * size)
        .limit(size)
    )).scalars().all()

    return SignalListResponse(
        items=[SignalOut.model_validate(r) for r in rows],
        total=total,
        page=page,
        size=size,
        pages=max(1, (total + size - 1) // size),
    )
```

---

## 8. File: `backend/app/api/v1/admin/signals.py`

```python
"""
Admin signal listing.
Router prefix: /api/v1/admin/signals
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.deps import get_db, get_current_admin_user
from backend.app.models.analysis import AnalysisSignal
from backend.app.models.user import User
from backend.app.schemas.analysis import SignalOut, SignalListResponse

router = APIRouter(tags=["admin-signals"])


@router.get("", response_model=SignalListResponse)
async def list_all_signals(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    stock_id: int | None = Query(None),
    config_id: int | None = Query(None),
    signal_type: str | None = Query(None, pattern="^(buy|sell)$"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin_user),
):
    count_q = select(func.count(AnalysisSignal.id))
    base = select(AnalysisSignal)

    if stock_id is not None:
        count_q = count_q.where(AnalysisSignal.stock_id == stock_id)
        base = base.where(AnalysisSignal.stock_id == stock_id)
    if config_id is not None:
        count_q = count_q.where(AnalysisSignal.config_id == config_id)
        base = base.where(AnalysisSignal.config_id == config_id)
    if signal_type is not None:
        count_q = count_q.where(AnalysisSignal.signal_type == signal_type)
        base = base.where(AnalysisSignal.signal_type == signal_type)

    total = (await db.execute(count_q)).scalar() or 0
    rows = (await db.execute(
        base.order_by(AnalysisSignal.triggered_date.desc())
            .offset((page - 1) * size)
            .limit(size)
    )).scalars().all()

    return SignalListResponse(
        items=[SignalOut.model_validate(r) for r in rows],
        total=total,
        page=page,
        size=size,
        pages=max(1, (total + size - 1) // size),
    )
```

---

## 9. File: `backend/app/api/v1/router.py` (modification)

Add these imports and router registrations:

```python
from backend.app.api.v1.analysis import router as analysis_router
from backend.app.api.v1.admin.strategies import router as admin_strategies_router
from backend.app.api.v1.admin.signals import router as admin_signals_router

# Inside create_v1_router():
v1_router.include_router(analysis_router, prefix="")
v1_router.include_router(admin_strategies_router, prefix="/admin/strategies")
v1_router.include_router(admin_signals_router, prefix="/admin/signals")
```

---

## 10. File: `backend/app/models/analysis.py` (modification)

### 10.1 `analysis_configs` — Updated ORM model

```python
"""
SQLAlchemy models for analysis engine tables.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import (
    BigInteger, Boolean, Date, DateTime, Enum, Float, ForeignKey,
    Integer, JSON, String, Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.models.base import Base, TimestampMixin


class AnalysisConfig(Base, TimestampMixin):
    __tablename__ = "analysis_configs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    stock_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("stocks.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    strategy_type: Mapped[str] = mapped_column(
        Enum("ma_cross", "multi_indicator", "custom_script", name="strategy_type_enum"),
        nullable=False, default="ma_cross",
    )
    params: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    script_content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    script_params: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    confirm_bars: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    volume_confirm: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    # Relationships
    stock = relationship("Stock", back_populates="analysis_configs")
    creator = relationship("User", back_populates="analysis_configs")
    signals = relationship("AnalysisSignal", back_populates="config")


class AnalysisSignal(Base, TimestampMixin):
    __tablename__ = "analysis_signals"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    stock_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("stocks.id", ondelete="CASCADE"), nullable=False
    )
    config_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("analysis_configs.id", ondelete="CASCADE"), nullable=False
    )
    signal_type: Mapped[str] = mapped_column(
        Enum("buy", "sell", name="signal_type_enum"), nullable=False
    )
    signal_subtype: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    strength: Mapped[str] = mapped_column(
        Enum("weak", "normal", "strong", name="signal_strength_enum"),
        nullable=False, default="normal",
    )
    confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    trigger_price: Mapped[float] = mapped_column(Float, nullable=False)
    trigger_details: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    triggered_date: Mapped[date] = mapped_column(Date, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Relationships
    stock = relationship("Stock", back_populates="analysis_signals")
    config = relationship("AnalysisConfig", back_populates="signals")
    ai_analysis = relationship("AIAnalysisResult", back_populates="signal", uselist=False)
```

---

## 11. Test Specifications

### 11.1 Unit Tests for `generate_signals()`

| Test | Input | Expected Output |
|------|-------|----------------|
| `test_ma_cross_golden_detected` | 120-row OHLCV with deliberate MA20 crossing above MA60 on last bar | Signal on last bar == 1 (buy) |
| `test_ma_cross_death_detected` | 120-row OHLCV with MA20 crossing below MA60 on last bar | Signal on last bar == -1 (sell) |
| `test_ma_cross_no_signal_when_already_crossed` | MAs already crossed 30 bars ago, no new cross | Last bar signal == 0 |
| `test_multi_indicator_composite_buy` | OHLCV with RSI < 30, MACD positive, price near BB lower | Composite > threshold_buy → last bar == 1 |
| `test_custom_script_simple` | Script: `def analyze(df, params): s = pd.Series(0, index=df.index); s.iloc[-1] = 1 if df["close"].iloc[-1] > df["close"].iloc[-2] else 0; return s` | Last bar == 1 if close[-1] > close[-2] |
| `test_signals_no_lookahead` | Verify that signal for bar T uses data ONLY up to bar T-1 | All shifts correct, no future data leakage |

### 11.2 Unit Tests for `SignalEngine`

| Test | Input | Expected |
|------|-------|----------|
| `test_scan_single_returns_none_when_no_signal` | MA flat, no cross | None |
| `test_scan_single_dedup_blocks_repeat` | Same (stock, config, signal_type) within 20 days | None (second call) |
| `test_scan_single_confirm_bars_fails` | Cross on bar T but MAs flip back on T+1 | None (confirm_bars=3 fails) |
| `test_scan_single_confirm_bars_passes` | Cross holds for 3 bars | Signal recorded |
| `test_scan_all_active_iterates_all` | 3 active configs in DB, 2 produce signals | Returns list of 2 AnalysisSignals |

### 11.3 Unit Tests for `ScriptExecutor`

| Test | Input | Expected |
|------|-------|----------|
| `test_validate_valid_script` | Valid analyze() with pandas import | (True, "脚本验证通过") |
| `test_validate_syntax_error` | Script with missing colon | (False, message contains "语法错误") |
| `test_validate_forbidden_import` | Script imports `os` | (False, message contains "禁止导入") |
| `test_validate_no_analyze_fn` | Script with only variable assignments | (False, "脚本必须定义 analyze(df, params) 函数") |
| `test_validate_timeout` | Script with `import time; time.sleep(15)` | (False, message contains "超时") |
| `test_validate_wrong_return_type` | analyze() returns int | (False, message contains "pd.Series") |
| `test_execute_returns_correct_series` | Script that returns 1 on last bar | pd.Series with last value = 1 |
| `test_execute_timeout` | Script with sleep(15) | raises TimeoutError |
| `test_execute_runtime_error` | Script that divides by zero | raises RuntimeError |

### 11.4 API Integration Tests

| Test | Method | Path | Expected Status | Expected |
|------|--------|------|----------------|----------|
| `test_create_ma_cross` | POST | /admin/strategies | 201 | StrategyConfigOut with strategy_type=ma_cross |
| `test_create_custom_script_invalid` | POST | /admin/strategies | 400 | error detail contains "脚本验证失败" |
| `test_create_custom_script_valid` | POST | /admin/strategies | 201 | script_validated=True |
| `test_list_strategies` | GET | /admin/strategies | 200 | paginated list |
| `test_list_filter_by_stock` | GET | /admin/strategies?stock_id=1 | 200 | only configs for stock_id=1 |
| `test_get_strategy` | GET | /admin/strategies/{id} | 200 | full detail with script_content |
| `test_update_strategy` | PATCH | /admin/strategies/{id} | 200 | updated fields |
| `test_delete_strategy` | DELETE | /admin/strategies/{id} | 204 | is_active set to False |
| `test_validate_existing_script` | POST | /admin/strategies/{id}/validate | 200 | StrategyValidateResponse |
| `test_test_run` | POST | /admin/strategies/{id}/test-run | 200 | StrategyTestRunResponse with signals |
| `test_get_stock_signals` | GET | /analysis/{stock_id}/signals | 200 | paginated SignalListResponse |
| `test_admin_list_signals` | GET | /admin/signals | 200 | all signals |

---

## 12. Acceptance Criteria Checklist

- [ ] `generate_signals(df, config) -> pd.Series` is a standalone, importable function
- [ ] `SignalEngine.scan_all_active()` iterates all active configs and persists new signals
- [ ] MA cross strategy correctly detects golden_cross and death_cross on latest bar
- [ ] Multi-indicator strategy computes weighted composite score and thresholds correctly
- [ ] Custom script strategy delegates to ScriptExecutor and returns proper Series
- [ ] Signal deduplication prevents same (stock, config, type) within 20 trading days
- [ ] Confirm bars check validates MA relationship persists for N bars
- [ ] Volume confirmation requires signal day volume > 1.5x 20-day avg
- [ ] ScriptExecutor validates import whitelist (pandas/numpy/pandas_ta/talib only)
- [ ] ScriptExecutor rejects forbidden modules (os, sys, subprocess, socket, requests, etc.)
- [ ] ScriptExecutor enforces 10-second timeout on both validation and execution
- [ ] Admin can create, read, update, soft-delete strategies via API
- [ ] Custom script auto-validates on create; rejects invalid scripts
- [ ] POST /admin/strategies/{id}/validate validates without saving
- [ ] POST /admin/strategies/{id}/test-run runs strategy on recent 100 bars
- [ ] GET /analysis/{stock_id}/signals returns paginated signals for authenticated users
- [ ] GET /admin/signals returns all signals with filters (admin only)
- [ ] All signals use shift(1) — no look-ahead bias
- [ ] `generate_signals()` produces identical results when called from SignalEngine and BacktestService
- [ ] pytest coverage ≥ 80% for analysis_engine.py and script_executor.py

---

## 13. Dependencies

- **Task 04**: Stock data service (`DataService` and `StockPriceDaily` model must exist)
- **Task 03**: Auth system (`get_current_user`, `get_current_admin_user` dependencies)

---

## 14. Estimated Time

| Sub-task | Hours |
|----------|-------|
| `generate_signals()` + MA cross + multi-indicator | 4h |
| SignalEngine class (scan, dedup, confirm, persist) | 6h |
| ScriptExecutor (validate + execute + sandbox) | 6h |
| Pydantic schemas (`analysis.py`) | 2h |
| Admin Strategy CRUD API | 4h |
| Public Signal API + Admin Signal API | 2h |
| Model updates (`analysis.py`) | 2h |
| Router registration | 0.5h |
| pytest: 3 strategy types + ScriptExecutor | 6h |
| Integration testing + bug fixes | 4h |
| **Total** | **~36.5h** |
