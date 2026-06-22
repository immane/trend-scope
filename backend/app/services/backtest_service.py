from __future__ import annotations

import time
from datetime import date
from decimal import Decimal

import pandas as pd
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analysis import AnalysisConfig
from app.models.backtest import BacktestResult
from app.models.stock import Stock, StockPriceDaily
from app.services.analysis_engine import generate_signals
from app.services.stock_data import DataService


class BacktestService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def run_backtest(
        self,
        stock_id: int,
        config_id: int,
        start_date: date,
        end_date: date,
        user_id: int,
        initial_capital: float = 100000.0,
        slippage_pct: float = 0.0005,
        commission_pct: float = 0.001,
    ) -> BacktestResult:
        started = time.perf_counter()
        result = BacktestResult(
            user_id=user_id,
            stock_id=stock_id,
            config_id=config_id,
            status="running",
            start_date=start_date,
            end_date=end_date,
            initial_capital=Decimal(str(initial_capital)),
            slippage_pct=Decimal(str(slippage_pct)),
            commission_pct=Decimal(str(commission_pct)),
        )
        self.db.add(result)
        await self.db.flush()
        try:
            config = (await self.db.execute(select(AnalysisConfig).where(AnalysisConfig.id == config_id))).scalar_one_or_none()
            if config is None:
                raise ValueError("Strategy not found")
            df = await self._load_prices(stock_id, start_date, end_date)
            if len(df) < 2:
                stock = (await self.db.execute(select(Stock).where(Stock.id == stock_id))).scalar_one_or_none()
                if stock is not None:
                    await DataService().sync_latest(self.db, stock.symbol)
                    df = await self._load_prices(stock_id, start_date, end_date)
            if len(df) < 2:
                raise ValueError("Not enough price data")
            signals = generate_signals(df, config)
            metrics = self._simulate(df, signals, initial_capital, slippage_pct, commission_pct)
            for key, value in metrics.items():
                setattr(result, key, value)
            result.status = "completed"
        except Exception as exc:
            result.status = "failed"
            result.error_message = str(exc)
        result.execution_time_ms = int((time.perf_counter() - started) * 1000)
        await self.db.flush()
        await self.db.refresh(result)
        return result

    async def _load_prices(self, stock_id: int, start_date: date, end_date: date) -> pd.DataFrame:
        rows = (await self.db.execute(
            select(StockPriceDaily)
            .where(StockPriceDaily.stock_id == stock_id, StockPriceDaily.trade_date >= start_date, StockPriceDaily.trade_date <= end_date)
            .order_by(StockPriceDaily.trade_date)
        )).scalars().all()
        if not rows:
            return pd.DataFrame(columns=pd.Index(["open", "high", "low", "close", "volume"]))
        return pd.DataFrame([
            {"date": row.trade_date, "open": float(row.open), "high": float(row.high), "low": float(row.low), "close": float(row.close), "volume": int(row.volume)}
            for row in rows
        ]).set_index("date")

    def _simulate(self, df: pd.DataFrame, signals: pd.Series, initial_capital: float, slippage_pct: float, commission_pct: float) -> dict:
        cash = initial_capital
        shares = 0.0
        entry_value = 0.0
        wins = 0
        losses = 0
        gross_profit = 0.0
        gross_loss = 0.0
        trades = []
        equity = []
        for current_date, row in df.iterrows():
            price = float(row["close"])
            signal = int(signals.loc[current_date]) if current_date in signals.index else 0
            if signal > 0 and shares == 0:
                fill = price * (1 + slippage_pct)
                shares = cash / fill
                commission = cash * commission_pct
                cash -= commission
                entry_value = cash
                trades.append({"date": str(current_date), "side": "buy", "price": round(fill, 4)})
            elif signal < 0 and shares > 0:
                fill = price * (1 - slippage_pct)
                value = shares * fill
                commission = value * commission_pct
                cash = value - commission
                pnl = cash - entry_value
                if pnl >= 0:
                    wins += 1
                    gross_profit += pnl
                else:
                    losses += 1
                    gross_loss += abs(pnl)
                shares = 0.0
                trades.append({"date": str(current_date), "side": "sell", "price": round(fill, 4), "pnl": round(pnl, 2)})
            equity_value = cash if shares == 0 else shares * price
            equity.append({"date": str(current_date), "value": round(equity_value, 2)})

        final_value = equity[-1]["value"]
        values = pd.Series([point["value"] for point in equity], index=pd.to_datetime([point["date"] for point in equity]))
        returns = values.pct_change().fillna(0)
        running_max = values.cummax()
        drawdown = (values / running_max - 1).fillna(0)
        total_return = final_value / initial_capital - 1
        years = max(len(values) / 252, 1 / 252)
        cagr = (final_value / initial_capital) ** (1 / years) - 1
        returns_std = float(returns.std() or 0.0)
        sharpe = (float(returns.mean()) / returns_std * (252 ** 0.5)) if returns_std else 0.0
        downside = returns[returns < 0]
        downside_std = float(downside.std() or 0.0) if len(downside) > 1 else 0.0
        sortino = (float(returns.mean()) / downside_std * (252 ** 0.5)) if downside_std else 0.0
        max_drawdown = abs(float(drawdown.min()))
        benchmark_return = float(df["close"].iloc[-1] / df["close"].iloc[0] - 1)
        return {
            "total_return": Decimal(str(round(total_return, 4))),
            "cagr": Decimal(str(round(cagr, 4))),
            "max_drawdown": Decimal(str(round(max_drawdown, 4))),
            "sharpe_ratio": Decimal(str(round(float(sharpe), 4))),
            "sortino_ratio": Decimal(str(round(float(sortino), 4))),
            "calmar_ratio": Decimal(str(round(cagr / max_drawdown, 4))) if max_drawdown else Decimal("0"),
            "win_rate": Decimal(str(round(wins / max(wins + losses, 1), 4))),
            "profit_factor": Decimal(str(round(gross_profit / gross_loss, 4))) if gross_loss else Decimal("0"),
            "num_trades": wins + losses,
            "benchmark_return": Decimal(str(round(benchmark_return, 4))),
            "equity_curve": {"points": equity},
            "drawdown_curve": {"points": [{"date": str(idx.date()), "value": round(float(value), 4)} for idx, value in drawdown.items()]},
            "monthly_returns": {str(k): round(float(v), 4) for k, v in returns.resample("ME").apply(lambda x: (1 + x).prod() - 1).items()},
            "trade_log": {"trades": trades},
        }
