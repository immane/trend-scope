from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, DECIMAL, DateTime, ForeignKey, Integer, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.analysis import AnalysisSignal


class AIAnalysisResult(Base):
    __tablename__ = "ai_analysis_results"
    __table_args__ = {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4"}

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    signal_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("analysis_signals.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    model_provider: Mapped[str] = mapped_column(String(50), nullable=False, default="deepseek")
    model_name: Mapped[str] = mapped_column(String(100), nullable=False, default="deepseek-chat")
    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_cost: Mapped[float] = mapped_column(DECIMAL(10, 6), nullable=False, default=0.0)
    analysis_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    generated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    signal: Mapped[AnalysisSignal] = relationship("AnalysisSignal", back_populates="ai_analysis")
