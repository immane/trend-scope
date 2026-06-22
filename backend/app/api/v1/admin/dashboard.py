from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_admin_user, get_db
from app.models.alert import AlertLog
from app.models.analysis import AnalysisConfig, AnalysisSignal
from app.models.stock import Stock
from app.models.user import User
from app.scheduler.jobs import dispatch_alerts, generate_ai_analysis, scan_signals, sync_daily_prices
from app.scheduler.runner import scheduler

router = APIRouter(prefix="/admin/dashboard", tags=["admin-dashboard"])


@router.get("/stats", response_model=dict)
async def stats(db: AsyncSession = Depends(get_db), _: User = Depends(get_admin_user)):
    return {
        "users": (await db.execute(select(func.count(User.id)))).scalar() or 0,
        "stocks": (await db.execute(select(func.count(Stock.id)))).scalar() or 0,
        "strategies": (await db.execute(select(func.count(AnalysisConfig.id)))).scalar() or 0,
        "signals": (await db.execute(select(func.count(AnalysisSignal.id)))).scalar() or 0,
        "alerts": (await db.execute(select(func.count(AlertLog.id)))).scalar() or 0,
        "scheduler_running": scheduler.running,
        "jobs": [{"id": job.id, "name": job.name, "next_run_time": str(job.next_run_time) if job.next_run_time else None} for job in scheduler.get_jobs()],
    }


@router.post("/trigger/{job_id}", response_model=dict)
async def trigger(job_id: str, _: User = Depends(get_admin_user)):
    jobs = {
        "sync_daily_prices": sync_daily_prices,
        "scan_signals": scan_signals,
        "generate_ai_analysis": generate_ai_analysis,
        "dispatch_alerts": dispatch_alerts,
    }
    if job_id not in jobs:
        return {"detail": "Unknown job", "job_id": job_id}
    result = await jobs[job_id]()
    return {"job_id": job_id, "result": result}
