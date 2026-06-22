from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional

import json
import math
import time
import urllib.request

import pandas as pd
import yfinance as yf
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.analysis import AnalysisSignal
from app.models.stock import Stock, StockPriceDaily


class DataService:
    @staticmethod
    def _date_to_unix(d: date) -> int:
        return int(datetime.combine(d, datetime.min.time(), tzinfo=timezone.utc).timestamp())

    @staticmethod
    def _fetch_from_yahoo_api(symbol: str, start: date | None = None, end: date | None = None, period: str = "2y") -> pd.DataFrame | None:
        """Fetch OHLCV from Yahoo Finance v8 chart API directly (bypasses yfinance rate-limiting)."""
        try:
            if start is not None and end is not None:
                url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?period1={DataService._date_to_unix(start)}&period2={DataService._date_to_unix(end)}&interval=1d"
            else:
                range_map = {"1mo": "1mo", "3mo": "3mo", "6mo": "6mo", "1y": "1y", "2y": "2y", "5y": "5y", "10y": "10y"}
                range_val = range_map.get(period, "2y")
                url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range={range_val}"

            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=20) as response:
                data = json.loads(response.read().decode())
                result = data["chart"]["result"][0]
                timestamps = result["timestamp"]
                quote = result["indicators"]["quote"][0]
                df = pd.DataFrame(
                    {
                        "Open": quote["open"],
                        "High": quote["high"],
                        "Low": quote["low"],
                        "Close": quote["close"],
                        "Volume": quote["volume"],
                    },
                    index=[date.fromtimestamp(ts) for ts in timestamps],
                )
                df.index = pd.to_datetime(df.index).date
                df.index.name = "Date"
                df = df.dropna(subset=["Open", "Close"])
                if df.empty:
                    return None
                df["Volume"] = df["Volume"].fillna(0).astype(int)
                return df
        except Exception:
            return None
    def fetch_historical(self, symbol: str, period: str = "2y", interval: str = "1d") -> pd.DataFrame:
        df = self._fetch_from_yahoo_api(symbol, period=period)
        if df is not None and not df.empty:
            return df
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
            df_from_api = self._fetch_from_yahoo_api(stock.symbol, start=start if isinstance(start, date) else None)
            if df_from_api is not None and not df_from_api.empty:
                df = df_from_api
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
        df["ma5"] = df["close"].rolling(window=5).mean()
        df["ma10"] = df["close"].rolling(window=10).mean()
        df["ma20"] = df["close"].rolling(window=20).mean()
        df["ma60"] = df["close"].rolling(window=60).mean()
        df["ma120"] = df["close"].rolling(window=120).mean()

        ema12 = df["close"].ewm(span=12, adjust=False).mean()
        ema26 = df["close"].ewm(span=26, adjust=False).mean()
        df["macd_dif"] = ema12 - ema26
        df["macd_dea"] = df["macd_dif"].ewm(span=9, adjust=False).mean()
        df["macd_hist"] = (df["macd_dif"] - df["macd_dea"]) * 2

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
                    "ma5": round(float(row["ma5"]), 2) if not pd.isna(row["ma5"]) else None,
                    "ma10": round(float(row["ma10"]), 2) if not pd.isna(row["ma10"]) else None,
                    "ma20": round(float(row["ma20"]), 2) if not pd.isna(row["ma20"]) else None,
                    "ma60": round(float(row["ma60"]), 2) if not pd.isna(row["ma60"]) else None,
                    "ma120": round(float(row["ma120"]), 2) if not pd.isna(row["ma120"]) else None,
                    "macd_dif": round(float(row["macd_dif"]), 4) if not pd.isna(row["macd_dif"]) else None,
                    "macd_dea": round(float(row["macd_dea"]), 4) if not pd.isna(row["macd_dea"]) else None,
                    "macd_hist": round(float(row["macd_hist"]), 4) if not pd.isna(row["macd_hist"]) else None,
                    "rsi14": round(float(row["rsi14"]), 2) if not pd.isna(row["rsi14"]) else None,
                    "signal": signal_map.get(row["date"]),
                }
            )
        return kline_data

    async def get_active_stocks(self, db: AsyncSession) -> list[Stock]:
        result = await db.execute(select(Stock).where(Stock.is_active.is_(True)).order_by(Stock.symbol))
        return list(result.scalars().all())

    async def get_rich_quote(self, db: AsyncSession, stock_id: int) -> dict | None:
        stock = (await db.execute(select(Stock).where(Stock.id == stock_id))).scalar_one_or_none()
        if stock is None:
            return None

        # Latest day
        latest_row = await db.execute(
            select(StockPriceDaily).where(StockPriceDaily.stock_id == stock_id).order_by(StockPriceDaily.trade_date.desc()).limit(1)
        )
        latest = latest_row.scalar_one_or_none()

        # Previous day
        prev_row = await db.execute(
            select(StockPriceDaily).where(StockPriceDaily.stock_id == stock_id).order_by(StockPriceDaily.trade_date.desc()).offset(1).limit(1)
        )
        prev = prev_row.scalar_one_or_none()

        # 52-week high/low
        one_year_ago = date.today() - timedelta(days=365)
        fty2 = await db.execute(
            select(func.max(StockPriceDaily.high), func.min(StockPriceDaily.low))
            .where(StockPriceDaily.stock_id == stock_id, StockPriceDaily.trade_date >= one_year_ago)
        )
        high52, low52 = fty2.one()

        # 30-day avg volume
        avg_vol = await db.execute(
            select(func.avg(StockPriceDaily.volume))
            .where(StockPriceDaily.stock_id == stock_id)
            .order_by(StockPriceDaily.trade_date.desc())
            .limit(30)
        )
        avg_volume_30d = avg_vol.scalar()

        # Day range
        day_range = await db.execute(
            select(func.max(StockPriceDaily.high), func.min(StockPriceDaily.low))
            .where(StockPriceDaily.stock_id == stock_id)
            .order_by(StockPriceDaily.trade_date.desc())
            .limit(1)
        )
        day_high, day_low = day_range.one()

        # Total data rows
        total_rows = (await db.execute(
            select(func.count(StockPriceDaily.id)).where(StockPriceDaily.stock_id == stock_id)
        )).scalar() or 0

        # Recent stats
        recent = await db.execute(
            select(StockPriceDaily.close)
            .where(StockPriceDaily.stock_id == stock_id)
            .order_by(StockPriceDaily.trade_date.desc())
            .limit(252)
        )
        closes_recent = [float(row.close) for row in recent.all()]
        closes_recent.reverse()

        change_1d = float(latest.close - prev.close) if latest and prev else None
        change_1d_pct = round(float((latest.close - prev.close) / prev.close), 4) if latest and prev and prev.close else None

        def pct_change(closes: list[float], days: int) -> float | None:
            if len(closes) < max(days, 2):
                return None
            return round((closes[-1] - closes[-min(days + 1, len(closes))]) / closes[-min(days + 1, len(closes))], 4)

        earliest = await db.execute(
            select(StockPriceDaily.trade_date).where(StockPriceDaily.stock_id == stock_id).order_by(StockPriceDaily.trade_date.asc()).limit(1)
        )
        earliest_date = earliest.scalar_one_or_none()

        return {
            "id": stock.id,
            "symbol": stock.symbol,
            "name": stock.name,
            "type": stock.type,
            "market": stock.market,
            "sector": stock.sector,
            "is_active": stock.is_active,
            "latest_price": round(float(latest.close), 2) if latest else None,
            "previous_close": round(float(prev.close), 2) if prev else None,
            "day_open": round(float(latest.open), 2) if latest else None,
            "day_high": round(float(day_high), 2) if day_high else None,
            "day_low": round(float(day_low), 2) if day_low else None,
            "volume_latest": latest.volume if latest else None,
            "avg_volume_30d": int(round(avg_volume_30d)) if avg_volume_30d else None,
            "change_1d": change_1d,
            "change_1d_pct": change_1d_pct,
            "fifty_two_week_high": round(float(high52), 2) if high52 else None,
            "fifty_two_week_low": round(float(low52), 2) if low52 else None,
            "total_rows": total_rows,
            "earliest_date": str(earliest_date) if earliest_date else None,
            "latest_date": str(latest.trade_date) if latest else None,
            "return_1w": pct_change(closes_recent, 5),
            "return_1m": pct_change(closes_recent, 21),
            "return_3m": pct_change(closes_recent, 63),
            "return_6m": pct_change(closes_recent, 126),
            "return_1y": pct_change(closes_recent, len(closes_recent) - 1) if len(closes_recent) > 1 else None,
            "recent_closes": [round(v, 2) for v in (closes_recent[-252:] if closes_recent else [])],
        }

    async def get_stocks_with_price_summaries(self, db: AsyncSession, limit: int = 50) -> list[dict]:
        stocks_result = await db.execute(select(Stock).order_by(Stock.symbol).limit(limit))
        stocks = list(stocks_result.scalars().all())

        if not stocks:
            return []

        stock_ids = [s.id for s in stocks]
        latest_price_subq = (
            select(
                StockPriceDaily.stock_id,
                StockPriceDaily.close,
                StockPriceDaily.trade_date,
                func.row_number()
                .over(partition_by=StockPriceDaily.stock_id, order_by=StockPriceDaily.trade_date.desc())
                .label("rn"),
            )
            .where(StockPriceDaily.stock_id.in_(stock_ids))
            .subquery()
        )
        latest_prices_raw = await db.execute(
            select(
                latest_price_subq.c.stock_id,
                latest_price_subq.c.close,
            ).where(latest_price_subq.c.rn == 1)
        )
        latest_prices: dict[int, float] = {row.stock_id: float(row.close) for row in latest_prices_raw.all()}
        latest_dates: dict[int, str] = {}
        for stock_id in stock_ids:
            date_row = await db.execute(
                select(StockPriceDaily.trade_date)
                .where(StockPriceDaily.stock_id == stock_id)
                .order_by(StockPriceDaily.trade_date.desc())
                .limit(1)
            )
            trade_date = date_row.scalar_one_or_none()
            if trade_date:
                latest_dates[stock_id] = str(trade_date)

        prev_prices_raw = await db.execute(
            select(
                latest_price_subq.c.stock_id,
                latest_price_subq.c.close,
            ).where(latest_price_subq.c.rn == 2)
        )
        prev_prices: dict[int, float] = {row.stock_id: float(row.close) for row in prev_prices_raw.all()}

        sparklines: dict[int, list[float]] = {}
        for stock_id in stock_ids:
            spark_raw = await db.execute(
                select(StockPriceDaily.close)
                .where(StockPriceDaily.stock_id == stock_id)
                .order_by(StockPriceDaily.trade_date.desc())
                .limit(15)
            )
            closes = [float(row.close) for row in spark_raw.all()]
            closes.reverse()
            sparklines[stock_id] = closes

        summaries = []
        for stock in stocks:
            latest = latest_prices.get(stock.id)
            previous = prev_prices.get(stock.id)
            change_pct = None
            if latest is not None and previous is not None and previous:
                change_pct = round((latest - previous) / previous, 4)
            summaries.append({
                "id": stock.id,
                "symbol": stock.symbol,
                "name": stock.name,
                "type": stock.type,
                "market": stock.market,
                "sector": stock.sector,
                "is_active": stock.is_active,
                "created_at": str(stock.created_at),
                "updated_at": str(stock.updated_at),
                "latest_price": round(latest, 4) if latest is not None else None,
                "previous_close": round(previous, 4) if previous is not None else None,
                "change_pct": change_pct,
                "latest_date": latest_dates.get(stock.id),
                "sparkline": [round(v, 4) for v in sparklines.get(stock.id, [])],
            })
        return summaries

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
