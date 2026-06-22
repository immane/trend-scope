from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger as _BigInteger, DECIMAL, Date, DateTime, Enum, ForeignKey, Integer, JSON, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

BigInteger = _BigInteger().with_variant(Integer, "sqlite")

if TYPE_CHECKING:
    from app.models.analysis import AnalysisConfig
    from app.models.stock import Stock
    from app.models.user import User


class BacktestResult(Base):
    __tablename__ = "backtest_results"
    __table_args__ = {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4"}

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False, index=True)
    stock_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("stocks.id"), nullable=False, index=True)
    config_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("analysis_configs.id"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(
        Enum("running", "completed", "failed", name="backtest_status"),
        nullable=False,
        default="running",
    )
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    initial_capital: Mapped[float] = mapped_column(DECIMAL(14, 2), nullable=False, default=100000.00)
    slippage_pct: Mapped[float] = mapped_column(DECIMAL(6, 4), nullable=False, default=0.0005)
    commission_pct: Mapped[float] = mapped_column(DECIMAL(6, 4), nullable=False, default=0.0010)
    total_return: Mapped[float | None] = mapped_column(DECIMAL(8, 4), nullable=True)
    cagr: Mapped[float | None] = mapped_column(DECIMAL(8, 4), nullable=True)
    max_drawdown: Mapped[float | None] = mapped_column(DECIMAL(8, 4), nullable=True)
    sharpe_ratio: Mapped[float | None] = mapped_column(DECIMAL(8, 4), nullable=True)
    sortino_ratio: Mapped[float | None] = mapped_column(DECIMAL(8, 4), nullable=True)
    calmar_ratio: Mapped[float | None] = mapped_column(DECIMAL(8, 4), nullable=True)
    win_rate: Mapped[float | None] = mapped_column(DECIMAL(8, 4), nullable=True)
    profit_factor: Mapped[float | None] = mapped_column(DECIMAL(8, 4), nullable=True)
    num_trades: Mapped[int | None] = mapped_column(Integer, nullable=True)
    benchmark_return: Mapped[float | None] = mapped_column(DECIMAL(8, 4), nullable=True)
    equity_curve: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    drawdown_curve: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    monthly_returns: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    trade_log: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    execution_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    user: Mapped[User] = relationship("User", back_populates="backtest_results")
    stock: Mapped[Stock] = relationship("Stock", back_populates="backtest_results")
    config: Mapped[AnalysisConfig] = relationship("AnalysisConfig", back_populates="backtest_results")
