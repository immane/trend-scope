from datetime import date, timedelta
from decimal import Decimal

import math
import pandas as pd
import yfinance as yf
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.analysis import AnalysisSignal
from app.models.stock import Stock, StockPriceDaily


class DataService:
    def fetch_historical(self, symbol: str, period: str = "2y", interval: str = "1d") -> pd.DataFrame:
        ticker = yf.Ticker(symbol)
        df = ticker.history(period=period, interval=interval, auto_adjust=True)
        if df.empty:
            return self._generate_dev_fallback(symbol, period=period) if settings.APP_ENV != "production" else df
        df.index = pd.to_datetime(df.index).date
        df.index.name = "Date"
        return df

    async def sync_latest(self, db: AsyncSession, symbol: str) -> int:
        result = await db.execute(select(Stock).where(Stock.symbol == symbol.upper()))
        stock = result.scalar_one_or_none()
        if stock is None:
            raise ValueError(f"Stock with symbol '{symbol}' not found")

        result = await db.execute(
            select(func.max(StockPriceDaily.trade_date)).where(StockPriceDaily.stock_id == stock.id)
        )
        last_date = result.scalar()
        start = (last_date + timedelta(days=1)) if last_date else None
        if start is not None and start >= date.today():
            return 0

        ticker = yf.Ticker(stock.symbol)
        df = ticker.history(start=start or "2010-01-01", auto_adjust=True)
        if df.empty:
            if settings.APP_ENV == "production":
                return 0
            df = self._generate_dev_fallback(stock.symbol, start=start or date(2010, 1, 1))
            if df.empty:
                return 0
        df.index = pd.to_datetime(df.index).date

        new_count = 0
        for index, row in df.iterrows():
            trade_date = index if isinstance(index, date) else index.date()
            if last_date and trade_date <= last_date:
                continue
            existing = await db.execute(
                select(StockPriceDaily).where(
                    and_(
                        StockPriceDaily.stock_id == stock.id,
                        StockPriceDaily.trade_date == trade_date,
                    )
                )
            )
            if existing.scalar_one_or_none() is not None:
                continue
            db.add(
                StockPriceDaily(
                    stock_id=stock.id,
                    trade_date=trade_date,
                    open=Decimal(str(round(float(row["Open"]), 4))),
                    high=Decimal(str(round(float(row["High"]), 4))),
                    low=Decimal(str(round(float(row["Low"]), 4))),
                    close=Decimal(str(round(float(row["Close"]), 4))),
                    volume=int(row["Volume"]),
                    data_source="dev_fallback" if bool(row.get("_dev_fallback", False)) else "yfinance",
                )
            )
            new_count += 1

        await db.flush()
        return new_count

    async def get_kline(self, db: AsyncSession, stock_id: int, limit: int = 200) -> list[dict]:
        result = await db.execute(
            select(StockPriceDaily)
            .where(StockPriceDaily.stock_id == stock_id)
            .order_by(StockPriceDaily.trade_date.desc())
            .limit(limit)
        )
        prices = list(result.scalars().all())
        if not prices:
            return []
        prices.reverse()

        records = [
            {
                "date": price.trade_date,
                "open": float(price.open),
                "high": float(price.high),
                "low": float(price.low),
                "close": float(price.close),
                "volume": price.volume,
            }
            for price in prices
        ]
        df = pd.DataFrame(records)
        df["ma20"] = df["close"].rolling(window=20).mean()
        df["ma60"] = df["close"].rolling(window=60).mean()

        delta = df["close"].diff()
        gain = delta.clip(lower=0)
        loss = (-delta).clip(lower=0)
        avg_gain = gain.rolling(window=14).mean()
        avg_loss = loss.rolling(window=14).mean()
        rs = avg_gain / avg_loss.replace(0, float("nan"))
        df["rsi14"] = 100.0 - (100.0 / (1.0 + rs))
        df.loc[(avg_loss == 0) & (avg_gain > 0), "rsi14"] = 100.0
        df.loc[(avg_loss == 0) & (avg_gain == 0), "rsi14"] = 50.0

        min_date = prices[0].trade_date
        max_date = prices[-1].trade_date
        signal_result = await db.execute(
            select(AnalysisSignal)
            .options(selectinload(AnalysisSignal.ai_analysis))
            .where(
                and_(
                    AnalysisSignal.stock_id == stock_id,
                    AnalysisSignal.triggered_date >= min_date,
                    AnalysisSignal.triggered_date <= max_date,
                    AnalysisSignal.is_active.is_(True),
                )
            )
        )
        signal_map = {}
        for signal in signal_result.scalars().all():
            signal_map[signal.triggered_date] = {
                "id": signal.id,
                "type": signal.signal_type,
                "subtype": signal.signal_subtype,
                "strength": signal.strength,
                "price": float(signal.trigger_price),
                "ai_summary": (
                    signal.ai_analysis.analysis_json.get("summary")
                    if signal.ai_analysis and signal.ai_analysis.analysis_json
                    else None
                ),
            }

        kline_data = []
        for _, row in df.iterrows():
            kline_data.append(
                {
                    "time": str(row["date"]),
                    "open": round(float(row["open"]), 2),
                    "high": round(float(row["high"]), 2),
                    "low": round(float(row["low"]), 2),
                    "close": round(float(row["close"]), 2),
                    "volume": int(row["volume"]),
                    "ma20": round(float(row["ma20"]), 2) if not pd.isna(row["ma20"]) else None,
                    "ma60": round(float(row["ma60"]), 2) if not pd.isna(row["ma60"]) else None,
                    "rsi14": round(float(row["rsi14"]), 2) if not pd.isna(row["rsi14"]) else None,
                    "signal": signal_map.get(row["date"]),
                }
            )
        return kline_data

    async def get_active_stocks(self, db: AsyncSession) -> list[Stock]:
        result = await db.execute(select(Stock).where(Stock.is_active.is_(True)).order_by(Stock.symbol))
        return list(result.scalars().all())

    def _generate_dev_fallback(
        self,
        symbol: str,
        start: date | str | None = None,
        period: str = "2y",
    ) -> pd.DataFrame:
        """Generate deterministic local-dev OHLCV when public data providers are unavailable."""
        end_ts = pd.Timestamp.today().normalize()
        if start is None:
            years = 2
            if period.endswith("y") and period[:-1].isdigit():
                years = int(period[:-1])
            start_ts = end_ts - pd.DateOffset(years=years)
        else:
            start_ts = pd.Timestamp(start)
        dates = pd.bdate_range(start=start_ts, end=end_ts)
        if len(dates) == 0:
            return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume", "_dev_fallback"])

        seed = sum(ord(char) for char in symbol.upper())
        base = 25 + seed % 80
        leverage = 3.0 if symbol.upper() in {"TQQQ", "SOXL"} else 1.0
        rows = []
        previous_close = float(base)
        for idx, current_date in enumerate(dates):
            trend = 1 + idx * (0.00055 * leverage)
            cycle = math.sin(idx / 18 + seed) * (0.10 * leverage)
            short_cycle = math.sin(idx / 5 + seed / 7) * (0.025 * leverage)
            close = max(1.0, base * trend * (1 + cycle + short_cycle))
            open_price = previous_close * (1 + math.sin(idx / 9 + seed) * 0.005)
            high = max(open_price, close) * 1.015
            low = min(open_price, close) * 0.985
            volume = int(5_000_000 + (seed % 50) * 100_000 + abs(math.sin(idx / 11)) * 2_000_000)
            rows.append(
                {
                    "Open": round(open_price, 4),
                    "High": round(high, 4),
                    "Low": round(low, 4),
                    "Close": round(close, 4),
                    "Volume": volume,
                    "_dev_fallback": True,
                }
            )
            previous_close = close
        df = pd.DataFrame(rows, index=dates)
        df.index = pd.to_datetime(df.index).date
        df.index.name = "Date"
        return df
