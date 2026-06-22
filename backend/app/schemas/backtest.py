from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class BacktestRunRequest(BaseModel):
    stock_id: int
    config_id: int
    start_date: date
    end_date: date
    initial_capital: float = Field(default=100000.0, gt=0)
    slippage_pct: float = Field(default=0.0005, ge=0)
    commission_pct: float = Field(default=0.001, ge=0)


class BacktestOut(BaseModel):
    id: int
    user_id: int
    stock_id: int
    config_id: int
    status: str
    start_date: date
    end_date: date
    initial_capital: Decimal
    slippage_pct: Decimal
    commission_pct: Decimal
    total_return: Decimal | None = None
    cagr: Decimal | None = None
    max_drawdown: Decimal | None = None
    sharpe_ratio: Decimal | None = None
    sortino_ratio: Decimal | None = None
    calmar_ratio: Decimal | None = None
    win_rate: Decimal | None = None
    profit_factor: Decimal | None = None
    num_trades: int | None = None
    benchmark_return: Decimal | None = None
    equity_curve: dict | None = None
    drawdown_curve: dict | None = None
    monthly_returns: dict | None = None
    trade_log: dict | None = None
    execution_time_ms: int | None = None
    error_message: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
