from __future__ import annotations

from sqlalchemy import select

from app.core.deps import get_db_context
from app.models.analysis import AnalysisSignal
from app.services.ai_analysis_service import AIAnalysisService
from app.services.alert_service import AlertService
from app.services.analysis_engine import SignalEngine
from app.services.stock_data import DataService


async def sync_daily_prices() -> dict:
    async with get_db_context() as db:
        stocks = await DataService().get_active_stocks(db)
        total = 0
        for stock in stocks:
            total += await DataService().sync_latest(db, stock.symbol)
        return {"stocks": len(stocks), "new_rows": total}


async def scan_signals() -> dict:
    async with get_db_context() as db:
        signals = await SignalEngine(db).scan_all_active()
        return {"signals": len(signals), "signal_ids": [signal.id for signal in signals]}


async def generate_ai_analysis() -> dict:
    async with get_db_context() as db:
        rows = (await db.execute(select(AnalysisSignal).where(AnalysisSignal.is_active.is_(True)).order_by(AnalysisSignal.id.desc()).limit(100))).scalars().all()
        count = 0
        for signal in rows:
            await AIAnalysisService(db).analyze_and_store(signal.id)
            count += 1
        return {"analyses": count}


async def dispatch_alerts() -> dict:
    async with get_db_context() as db:
        rows = (await db.execute(select(AnalysisSignal).where(AnalysisSignal.is_active.is_(True)).order_by(AnalysisSignal.id.desc()).limit(100))).scalars().all()
        count = 0
        for signal in rows:
            count += len(await AlertService(db).dispatch_signal(signal.id))
        return {"alerts": count}
