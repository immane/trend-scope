from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger as _BigInteger, Boolean, DECIMAL, Date, DateTime, Enum, ForeignKey, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

BigInteger = _BigInteger().with_variant(Integer, "sqlite")

if TYPE_CHECKING:
    from app.models.alert import AlertRule, AlertLog
    from app.models.analysis import AnalysisConfig, AnalysisSignal
    from app.models.backtest import BacktestResult


class Stock(Base, TimestampMixin):
    __tablename__ = "stocks"
    __table_args__ = {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4"}

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(String(20), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    type: Mapped[str] = mapped_column(Enum("ETF", "Stock", "Index", name="stock_type"), nullable=False)
    market: Mapped[str] = mapped_column(Enum("US", name="stock_market"), nullable=False, default="US")
    sector: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)

    prices: Mapped[list[StockPriceDaily]] = relationship(
        "StockPriceDaily",
        back_populates="stock",
        cascade="all, delete-orphan",
    )
    signals: Mapped[list[AnalysisSignal]] = relationship("AnalysisSignal", back_populates="stock")
    configs: Mapped[list[AnalysisConfig]] = relationship(
        "AnalysisConfig",
        back_populates="stock",
        foreign_keys="AnalysisConfig.stock_id",
    )
    alert_rules: Mapped[list[AlertRule]] = relationship("AlertRule", back_populates="stock")
    alert_logs: Mapped[list[AlertLog]] = relationship("AlertLog", back_populates="stock")
    backtest_results: Mapped[list[BacktestResult]] = relationship("BacktestResult", back_populates="stock")


class StockPriceDaily(Base):
    __tablename__ = "stock_prices_daily"
    __table_args__ = (
        UniqueConstraint("stock_id", "trade_date", name="uq_stock_date"),
        Index("idx_stock_date", "stock_id", "trade_date"),
        {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4"},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    stock_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("stocks.id"), nullable=False)
    trade_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    open: Mapped[float] = mapped_column(DECIMAL(12, 4), nullable=False)
    high: Mapped[float] = mapped_column(DECIMAL(12, 4), nullable=False)
    low: Mapped[float] = mapped_column(DECIMAL(12, 4), nullable=False)
    close: Mapped[float] = mapped_column(DECIMAL(12, 4), nullable=False)
    volume: Mapped[int] = mapped_column(BigInteger, nullable=False)
    data_source: Mapped[str] = mapped_column(String(50), nullable=False, default="yfinance")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    stock: Mapped[Stock] = relationship("Stock", back_populates="prices")
