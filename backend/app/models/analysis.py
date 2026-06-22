from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger as _BigInteger, Boolean, DECIMAL, Date, DateTime, Enum, ForeignKey, Index, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

BigInteger = _BigInteger().with_variant(Integer, "sqlite")

if TYPE_CHECKING:
    from app.models.ai_analysis import AIAnalysisResult
    from app.models.alert import AlertLog
    from app.models.backtest import BacktestResult
    from app.models.stock import Stock
    from app.models.user import User


class AnalysisConfig(Base, TimestampMixin):
    __tablename__ = "analysis_configs"
    __table_args__ = (
        Index("idx_active_stock", "is_active", "stock_id"),
        {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4"},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    stock_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("stocks.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    strategy_type: Mapped[str] = mapped_column(
        Enum("ma_cross", "multi_indicator", "custom_script", name="strategy_type"),
        nullable=False,
    )
    params: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    script_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    script_params: Mapped[dict | None] = mapped_column(JSON, nullable=True, default=dict)
    confirm_bars: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    volume_confirm: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)

    stock: Mapped[Stock | None] = relationship("Stock", back_populates="configs", foreign_keys=[stock_id])
    creator: Mapped[User] = relationship("User", back_populates="analysis_configs", foreign_keys=[created_by])
    signals: Mapped[list[AnalysisSignal]] = relationship(
        "AnalysisSignal",
        back_populates="config",
        cascade="all, delete-orphan",
    )
    backtest_results: Mapped[list[BacktestResult]] = relationship("BacktestResult", back_populates="config")


class AnalysisSignal(Base):
    __tablename__ = "analysis_signals"
    __table_args__ = (
        Index("idx_stock_triggered", "stock_id", "triggered_date"),
        Index("idx_active_signals", "is_active"),
        {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4"},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    stock_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("stocks.id"), nullable=False)
    config_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("analysis_configs.id"), nullable=False, index=True)
    signal_type: Mapped[str] = mapped_column(Enum("buy", "sell", name="signal_type"), nullable=False)
    signal_subtype: Mapped[str | None] = mapped_column(String(50), nullable=True)
    strength: Mapped[str] = mapped_column(
        Enum("weak", "normal", "strong", name="signal_strength"),
        nullable=False,
        default="normal",
    )
    confidence: Mapped[float | None] = mapped_column(DECIMAL(4, 3), nullable=True)
    trigger_price: Mapped[float] = mapped_column(DECIMAL(12, 4), nullable=False)
    trigger_details: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    triggered_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    stock: Mapped[Stock] = relationship("Stock", back_populates="signals")
    config: Mapped[AnalysisConfig] = relationship("AnalysisConfig", back_populates="signals")
    ai_analysis: Mapped[AIAnalysisResult | None] = relationship(
        "AIAnalysisResult",
        back_populates="signal",
        uselist=False,
        cascade="all, delete-orphan",
    )
    alert_logs: Mapped[list[AlertLog]] = relationship("AlertLog", back_populates="signal")
