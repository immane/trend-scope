from __future__ import annotations

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.alert import AlertLog, AlertRule
from app.models.analysis import AnalysisSignal
from app.models.stock import Stock
from app.models.user import User
from app.services.email_service import EmailService


class AlertService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def dispatch_signal(self, signal_id: int) -> list[AlertLog]:
        signal = (await self.db.execute(select(AnalysisSignal).where(AnalysisSignal.id == signal_id))).scalar_one_or_none()
        if signal is None:
            return []
        alert_types = ["any_signal", f"{signal.signal_type}_signal"]
        rules = (await self.db.execute(select(AlertRule).where(AlertRule.stock_id == signal.stock_id, AlertRule.alert_type.in_(alert_types), AlertRule.is_active.is_(True)))).scalars().all()
        logs: list[AlertLog] = []
        stock = (await self.db.execute(select(Stock).where(Stock.id == signal.stock_id))).scalar_one_or_none()
        for rule in rules:
            existing = (await self.db.execute(select(AlertLog).where(and_(AlertLog.alert_rule_id == rule.id, AlertLog.signal_id == signal.id)))).scalar_one_or_none()
            if existing is not None:
                continue
            user = (await self.db.execute(select(User).where(User.id == rule.user_id))).scalar_one_or_none()
            if user is None:
                continue
            subject = f"{stock.symbol if stock else signal.stock_id} {signal.signal_type.upper()} Signal"
            message = f"Signal {signal.signal_type} at {signal.trigger_price} on {signal.triggered_date}"
            try:
                provider_id = await EmailService().send_signal_alert(user.email, subject, f"<p>{message}</p>")
                status = "sent"
            except Exception as exc:
                provider_id = None
                status = "failed"
                message = f"{message}; error={exc}"
            log = AlertLog(alert_rule_id=rule.id, user_id=rule.user_id, stock_id=signal.stock_id, signal_id=signal.id, channel="email", title=subject, message=message, status=status, provider_message_id=provider_id)
            self.db.add(log)
            logs.append(log)
        await self.db.flush()
        return logs
