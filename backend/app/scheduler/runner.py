from __future__ import annotations

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.scheduler.jobs import dispatch_alerts, generate_ai_analysis, scan_signals, sync_daily_prices

scheduler = AsyncIOScheduler(timezone="America/New_York", job_defaults={"coalesce": True, "max_instances": 1})


def register_jobs() -> None:
    scheduler.add_job(sync_daily_prices, "cron", day_of_week="mon-fri", hour=16, minute=30, id="sync_daily_prices", replace_existing=True)
    scheduler.add_job(scan_signals, "cron", day_of_week="mon-fri", hour=16, minute=32, id="scan_signals", replace_existing=True)
    scheduler.add_job(generate_ai_analysis, "cron", day_of_week="mon-fri", hour=16, minute=34, id="generate_ai_analysis", replace_existing=True)
    scheduler.add_job(dispatch_alerts, "cron", day_of_week="mon-fri", hour=16, minute=36, id="dispatch_alerts", replace_existing=True)


def start_scheduler() -> None:
    if not scheduler.running:
        register_jobs()
        scheduler.start()


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
