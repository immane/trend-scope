from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, Boolean, DateTime, Enum, ForeignKey, Index, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.analysis import AnalysisSignal
    from app.models.stock import Stock
    from app.models.user import User


class AlertRule(Base, TimestampMixin):
    __tablename__ = "alert_rules"
    __table_args__ = (
        UniqueConstraint("user_id", "stock_id", "alert_type", name="uq_user_stock_type"),
        Index("idx_alert_rule_active", "is_active"),
        {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4"},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False, index=True)
    stock_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("stocks.id"), nullable=False, index=True)
    alert_type: Mapped[str] = mapped_column(
        Enum("any_signal", "buy_signal", "sell_signal", name="alert_type"),
        nullable=False,
        default="any_signal",
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    user: Mapped[User] = relationship("User", back_populates="alert_rules")
    stock: Mapped[Stock] = relationship("Stock", back_populates="alert_rules")
    logs: Mapped[list[AlertLog]] = relationship("AlertLog", back_populates="alert_rule")


class AlertLog(Base):
    __tablename__ = "alert_logs"
    __table_args__ = (
        Index("idx_user_sent", "user_id", "sent_at"),
        {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4"},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    alert_rule_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("alert_rules.id"), nullable=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False, index=True)
    stock_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("stocks.id"), nullable=False, index=True)
    signal_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("analysis_signals.id"), nullable=True)
    channel: Mapped[str] = mapped_column(Enum("email", name="alert_channel"), nullable=False, default="email")
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        Enum("sent", "failed", name="alert_status"),
        nullable=False,
        default="sent",
    )
    provider_message_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sent_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    alert_rule: Mapped[AlertRule | None] = relationship("AlertRule", back_populates="logs")
    user: Mapped[User] = relationship("User")
    stock: Mapped[Stock] = relationship("Stock", back_populates="alert_logs")
    signal: Mapped[AnalysisSignal | None] = relationship("AnalysisSignal", back_populates="alert_logs")
