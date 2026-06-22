from __future__ import annotations

from datetime import date
from decimal import Decimal

import pandas as pd
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analysis import AnalysisConfig, AnalysisSignal
from app.models.stock import Stock, StockPriceDaily
from app.services.script_executor import ScriptExecutor


def _strategy_type(config) -> str:
    value = getattr(config, "strategy_type", config)
    return value.value if hasattr(value, "value") else str(value)


def _params(config, attr: str = "params") -> dict:
    value = getattr(config, attr, None)
    return value if isinstance(value, dict) else {}


def _sma_or_ema(close: pd.Series, window: int, ma_type: str) -> pd.Series:
    if ma_type == "ema":
        return close.ewm(span=window, adjust=False).mean()
    return close.rolling(window=window).mean()


def generate_signals(df: pd.DataFrame, config) -> pd.Series:
    strategy_type = _strategy_type(config)
    if df.empty:
        return pd.Series(dtype="int64", index=df.index)
    if strategy_type == "ma_cross":
        return _generate_ma_cross(df, config)
    if strategy_type == "multi_indicator":
        return _generate_multi_indicator(df, config)
    if strategy_type == "custom_script":
        return _generate_custom_script(df, config)
    raise ValueError(f"Unknown strategy_type: {strategy_type}")


def _generate_ma_cross(df: pd.DataFrame, config) -> pd.Series:
    params = _params(config)
    short = int(params.get("ma_short", 20))
    long = int(params.get("ma_long", 60))
    ma_type = str(params.get("ma_type", "sma"))
    close = df["close"].astype(float)
    fast = _sma_or_ema(close, short, ma_type)
    slow = _sma_or_ema(close, long, ma_type)
    previous_fast = fast.shift(1)
    previous_slow = slow.shift(1)
    signals = pd.Series(0, index=df.index, dtype="int64")
    signals[(previous_fast <= previous_slow) & (fast > slow)] = 1
    signals[(previous_fast >= previous_slow) & (fast < slow)] = -1
    return signals.shift(1).fillna(0).astype(int)


def _generate_multi_indicator(df: pd.DataFrame, config) -> pd.Series:
    params = _params(config)
    close = df["close"].astype(float)
    volume = df.get("volume", pd.Series(0, index=df.index)).astype(float)

    ma_short = close.rolling(int(params.get("ma_short", 20))).mean()
    ma_long = close.rolling(int(params.get("ma_long", 60))).mean()
    delta = close.diff()
    gain = delta.clip(lower=0).rolling(int(params.get("rsi_period", 14))).mean()
    loss = (-delta.clip(upper=0)).rolling(int(params.get("rsi_period", 14))).mean()
    rsi = 100 - (100 / (1 + gain / loss.replace(0, pd.NA)))
    ema_fast = close.ewm(span=12, adjust=False).mean()
    ema_slow = close.ewm(span=26, adjust=False).mean()
    macd = ema_fast - ema_slow
    macd_signal = macd.ewm(span=9, adjust=False).mean()
    volume_ma = volume.rolling(20).mean()

    score = pd.Series(0, index=df.index, dtype="float64")
    score += (ma_short > ma_long).astype(int)
    score -= (ma_short < ma_long).astype(int)
    score += (rsi < float(params.get("rsi_oversold", 35))).astype(int)
    score -= (rsi > float(params.get("rsi_overbought", 70))).astype(int)
    score += (macd > macd_signal).astype(int)
    score -= (macd < macd_signal).astype(int)
    if bool(params.get("volume_confirm", False)):
        score = score.where(volume >= volume_ma, 0)

    threshold = float(params.get("score_threshold", 2))
    signals = pd.Series(0, index=df.index, dtype="int64")
    signals[score >= threshold] = 1
    signals[score <= -threshold] = -1
    return signals.shift(1).fillna(0).astype(int)


def _generate_custom_script(df: pd.DataFrame, config) -> pd.Series:
    output = ScriptExecutor().run(getattr(config, "script_content", None) or "", df, _params(config, "script_params"))
    return output.reindex(df.index).fillna(0).astype(int).clip(-1, 1)


class SignalEngine:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def scan_config(self, config: AnalysisConfig, stock: Stock | None = None) -> list[AnalysisSignal]:
        stocks = [stock] if stock is not None else await self._stocks_for_config(config)
        created: list[AnalysisSignal] = []
        for item in stocks:
            df = await self._load_prices(item.id)
            if len(df) < 2:
                continue
            series = generate_signals(df, config)
            last_signal = int(series.iloc[-1])
            if last_signal == 0:
                continue
            triggered_date = df.index[-1]
            existing = await self.db.execute(
                select(AnalysisSignal).where(
                    and_(
                        AnalysisSignal.stock_id == item.id,
                        AnalysisSignal.config_id == config.id,
                        AnalysisSignal.triggered_date == triggered_date,
                        AnalysisSignal.signal_type == ("buy" if last_signal > 0 else "sell"),
                    )
                )
            )
            if existing.scalar_one_or_none() is not None:
                continue
            signal = AnalysisSignal(
                stock_id=item.id,
                config_id=config.id,
                signal_type="buy" if last_signal > 0 else "sell",
                signal_subtype=_strategy_type(config),
                strength="normal",
                confidence=Decimal("0.700"),
                trigger_price=Decimal(str(round(float(df.iloc[-1]["close"]), 4))),
                trigger_details={"strategy_type": _strategy_type(config)},
                triggered_date=triggered_date,
                is_active=True,
            )
            self.db.add(signal)
            created.append(signal)
        await self.db.flush()
        return created

    async def scan_all_active(self) -> list[AnalysisSignal]:
        result = await self.db.execute(select(AnalysisConfig).where(AnalysisConfig.is_active.is_(True)))
        created: list[AnalysisSignal] = []
        for config in result.scalars().all():
            created.extend(await self.scan_config(config))
        return created

    async def test_run(self, config: AnalysisConfig, stock_id: int, limit: int = 100) -> list[dict]:
        df = await self._load_prices(stock_id, limit=limit)
        series = generate_signals(df, config)
        return [
            {"date": str(idx), "signal": int(value), "close": float(df.loc[idx, "close"])}
            for idx, value in series.items()
            if int(value) != 0
        ]

    async def _stocks_for_config(self, config: AnalysisConfig) -> list[Stock]:
        query = select(Stock).where(Stock.is_active.is_(True))
        if config.stock_id is not None:
            query = query.where(Stock.id == config.stock_id)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def _load_prices(self, stock_id: int, limit: int | None = None) -> pd.DataFrame:
        query = select(StockPriceDaily).where(StockPriceDaily.stock_id == stock_id).order_by(StockPriceDaily.trade_date.desc())
        if limit is not None:
            query = query.limit(limit)
        rows = list((await self.db.execute(query)).scalars().all())
        rows.reverse()
        return pd.DataFrame(
            [
                {
                    "date": row.trade_date,
                    "open": float(row.open),
                    "high": float(row.high),
                    "low": float(row.low),
                    "close": float(row.close),
                    "volume": int(row.volume),
                }
                for row in rows
            ]
        ).set_index("date") if rows else pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
