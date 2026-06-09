# Task 06 — Phase 1 Scheduler

> **Estimated time**: 1-2 days
> **Dependencies**: Task 05 (SignalEngine), Task 04 (DataService). Task 08 (AI analysis) and Task 09 (alerts) are stubbed.
> **Status**: Not started

---

## 1. Objective

Set up APScheduler with 4 sequential daily jobs for the end-of-day pipeline, Redis queue for inter-job communication, dashboard stats endpoint, and a manual trigger endpoint for debugging.

---

## 2. Files to Create/Modify

| # | File Path | Action | Description |
|---|-----------|--------|-------------|
| 1 | `backend/app/scheduler/__init__.py` | CREATE | Package init + scheduler singleton export |
| 2 | `backend/app/scheduler/jobs.py` | CREATE | 4 async job functions |
| 3 | `backend/app/scheduler/runner.py` | CREATE | Scheduler init + FastAPI lifespan integration |
| 4 | `backend/app/api/v1/admin/dashboard.py` | CREATE | Dashboard stats + scheduler status |
| 5 | `backend/app/api/v1/admin/router.py` | CREATE (or MODIFY) | Register dashboard + trigger routes |
| 6 | `backend/app/main.py` | MODIFY | Wire scheduler lifespan |
| 7 | `backend/app/core/config.py` | MODIFY | Add Redis URL config (if not present) |

---

## 3. File: `backend/app/scheduler/__init__.py`

```python
"""APScheduler package — exports the scheduler instance for lifespan management."""

from backend.app.scheduler.runner import scheduler

__all__ = ["scheduler"]
```

---

## 4. File: `backend/app/scheduler/runner.py`

### 4.1 Complete Implementation

```python
"""
APScheduler initialization and FastAPI lifespan integration.

The scheduler is a module-level singleton.  It is started on FastAPI startup
and shut down on shutdown via the lifespan context manager.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI

from backend.app.scheduler.jobs import (
    sync_daily_prices,
    scan_signals,
    generate_ai_analysis,
    dispatch_alerts,
)

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler(
    timezone="America/New_York",
    job_defaults={
        "coalesce": True,           # skip missed runs if scheduler was down
        "max_instances": 1,         # prevent overlapping runs
        "misfire_grace_time": 300,  # 5 min grace window
    },
)


def _register_jobs() -> None:
    """Register all Phase 1 scheduled jobs."""
    # Job 1: Sync daily prices — Mon-Fri at 16:30 ET
    scheduler.add_job(
        sync_daily_prices,
        trigger="cron",
        day_of_week="mon-fri",
        hour=16,
        minute=30,
        id="sync_daily_prices",
        name="Sync daily OHLCV data",
        replace_existing=True,
    )

    # Job 2: Scan signals — runs 2 minutes after job 1
    scheduler.add_job(
        scan_signals,
        trigger="cron",
        day_of_week="mon-fri",
        hour=16,
        minute=32,
        id="scan_signals",
        name="Scan strategies for new signals",
        replace_existing=True,
    )

    # Job 3: Generate AI analysis — runs 2 minutes after job 2
    scheduler.add_job(
        generate_ai_analysis,
        trigger="cron",
        day_of_week="mon-fri",
        hour=16,
        minute=34,
        id="generate_ai_analysis",
        name="Generate AI analysis for new signals",
        replace_existing=True,
    )

    # Job 4: Dispatch alerts — runs 2 minutes after job 3
    scheduler.add_job(
        dispatch_alerts,
        trigger="cron",
        day_of_week="mon-fri",
        hour=16,
        minute=36,
        id="dispatch_alerts",
        name="Dispatch email alerts for new signals",
        replace_existing=True,
    )

    logger.info("Registered 4 APScheduler jobs: sync_daily_prices, scan_signals, "
                "generate_ai_analysis, dispatch_alerts")


@asynccontextmanager
async def scheduler_lifespan(app: FastAPI):
    """FastAPI lifespan: start scheduler on startup, shutdown on teardown."""
    _register_jobs()
    scheduler.start()
    logger.info("APScheduler started (timezone=America/New_York)")
    try:
        yield
    finally:
        scheduler.shutdown(wait=False)
        logger.info("APScheduler shut down")
```

**Wiring into `backend/app/main.py`:**

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from backend.app.scheduler.runner import scheduler_lifespan

# ... other imports ...

app = FastAPI(
    title="Trend-Scope API",
    version="0.1.0",
    lifespan=scheduler_lifespan,
)
```

---

## 5. File: `backend/app/scheduler/jobs.py`

### 5.1 Complete Implementation

```python
"""
Scheduled job functions for the Phase 1 daily pipeline.

Execution order (sequential via staggered cron times):
  1. sync_daily_prices  — fetch latest OHLCV for all active stocks
  2. scan_signals       — run all active strategies, detect new signals
  3. generate_ai_analysis — call LLM for each new signal
  4. dispatch_alerts    — match alert rules and send emails
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

import redis.asyncio as aioredis

from backend.app.core.config import settings

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

# Redis key constants
REDIS_KEY_NEW_SIGNALS = "new_signals"


async def _get_redis() -> aioredis.Redis:
    """Return a Redis connection from the configured URL."""
    return aioredis.from_url(
        settings.REDIS_URL,
        encoding="utf-8",
        decode_responses=True,
    )


async def sync_daily_prices() -> None:
    """
    Sync latest OHLCV data for all active stocks.
    Runs Mon-Fri at 16:30 ET.
    """
    logger.info("[JOB] sync_daily_prices starting")
    from backend.app.core.deps import get_db_context
    from backend.app.services.stock_data import DataService

    async with get_db_context() as db:
        data_service = DataService(db)
        try:
            count = await data_service.sync_all_active()
            logger.info("[JOB] sync_daily_prices complete: %d stocks synced", count)
        except Exception:
            logger.exception("[JOB] sync_daily_prices failed")


async def scan_signals() -> None:
    """
    Scan all active strategy configs and generate new signals.
    Pushes new signal IDs into the Redis list "new_signals".
    Runs at 16:32 ET (after sync_daily_prices).
    """
    logger.info("[JOB] scan_signals starting")
    from backend.app.core.deps import get_db_context
    from backend.app.services.analysis_engine import SignalEngine

    async with get_db_context() as db:
        engine = SignalEngine(db)
        try:
            new_signals = await engine.scan_all_active()
            logger.info("[JOB] scan_signals complete: %d new signals", len(new_signals))

            if new_signals:
                redis = await _get_redis()
                signal_ids = [s.id for s in new_signals]
                await redis.lpush(REDIS_KEY_NEW_SIGNALS, *signal_ids)
                logger.info("[JOB] Pushed %d signal IDs to Redis '%s'",
                            len(signal_ids), REDIS_KEY_NEW_SIGNALS)
                await redis.close()
        except Exception:
            logger.exception("[JOB] scan_signals failed")


async def generate_ai_analysis() -> None:
    """
    Generate AI analysis for all new signals in the Redis queue.
    Runs at 16:34 ET (after scan_signals).
    """
    logger.info("[JOB] generate_ai_analysis starting")
    from backend.app.core.deps import get_db_context

    redis = await _get_redis()
    signal_ids_raw = await redis.lrange(REDIS_KEY_NEW_SIGNALS, 0, -1)
    await redis.close()

    if not signal_ids_raw:
        logger.info("[JOB] generate_ai_analysis: no new signals to process")
        return

    signal_ids = [int(sid) for sid in signal_ids_raw]
    logger.info("[JOB] generate_ai_analysis: processing %d signals", len(signal_ids))

    try:
        from backend.app.services.ai_analysis_service import AIAnalysisService

        async with get_db_context() as db:
            ai_service = AIAnalysisService()
            success_count = 0
            fail_count = 0
            total_cost = 0.0

            for sid in signal_ids:
                try:
                    result = await ai_service.analyze_and_store(db, sid)
                    success_count += 1
                    total_cost += result.total_cost
                except Exception:
                    logger.exception("[JOB] AI analysis failed for signal_id=%d", sid)
                    fail_count += 1

            logger.info("[JOB] generate_ai_analysis complete: %d ok, %d failed, cost=$%.6f",
                        success_count, fail_count, total_cost)
    except ImportError:
        logger.warning("[JOB] generate_ai_analysis: AIAnalysisService not available (stub)")
    except Exception:
        logger.exception("[JOB] generate_ai_analysis failed")


async def dispatch_alerts() -> None:
    """
    Match alert rules for new signals and send email notifications.
    Clears the Redis "new_signals" key after processing.
    Runs at 16:36 ET (after generate_ai_analysis).
    """
    logger.info("[JOB] dispatch_alerts starting")

    redis = await _get_redis()
    signal_ids_raw = await redis.lrange(REDIS_KEY_NEW_SIGNALS, 0, -1)

    if not signal_ids_raw:
        logger.info("[JOB] dispatch_alerts: no new signals to process")
        await redis.close()
        return

    signal_ids = [int(sid) for sid in signal_ids_raw]
    logger.info("[JOB] dispatch_alerts: processing %d signals", len(signal_ids))

    try:
        from backend.app.core.deps import get_db_context
        from backend.app.services.alert_service import AlertService

        async with get_db_context() as db:
            alert_service = AlertService()
            sent_count = 0
            fail_count = 0

            for sid in signal_ids:
                try:
                    results = await alert_service.match_and_send(db, sid)
                    sent_count += results
                except Exception:
                    logger.exception("[JOB] Alert dispatch failed for signal_id=%d", sid)
                    fail_count += 1

            logger.info("[JOB] dispatch_alerts complete: %d sent, %d failed",
                        sent_count, fail_count)
    except ImportError:
        logger.warning("[JOB] dispatch_alerts: AlertService not available (stub)")
    except Exception:
        logger.exception("[JOB] dispatch_alerts failed")
    finally:
        await redis.delete(REDIS_KEY_NEW_SIGNALS)
        await redis.close()
```

---

## 6. File: `backend/app/api/v1/admin/dashboard.py`

### 6.1 Complete Implementation

```python
"""
Admin dashboard statistics and scheduler control.
Router prefix: /api/v1/admin
"""

from __future__ import annotations

import logging
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.deps import get_db, get_current_admin_user
from backend.app.models import User, Stock, AnalysisConfig, AnalysisSignal, AlertLog
from backend.app.scheduler import scheduler

logger = logging.getLogger(__name__)
router = APIRouter(tags=["admin-dashboard"])


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class DashboardStats(BaseModel):
    total_users: int
    total_stocks: int
    active_strategies: int
    signals_today: int
    alerts_today: int
    active_alerts: int


class JobStatus(BaseModel):
    id: str
    name: str
    next_run_time: str | None
    trigger: str


class DashboardResponse(BaseModel):
    stats: DashboardStats
    scheduled_jobs: list[JobStatus]
    server_time: str


class TriggerJobResponse(BaseModel):
    job_id: str
    status: str
    message: str


# ---------------------------------------------------------------------------
# GET /admin/dashboard/stats
# ---------------------------------------------------------------------------

@router.get("/dashboard/stats", response_model=DashboardResponse)
async def get_dashboard_stats(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin_user),
):
    today = date.today()

    # Count queries
    total_users = (await db.execute(
        select(func.count(User.id))
    )).scalar() or 0

    total_stocks = (await db.execute(
        select(func.count(Stock.id)).where(Stock.is_active == True)
    )).scalar() or 0

    active_strategies = (await db.execute(
        select(func.count(AnalysisConfig.id)).where(AnalysisConfig.is_active == True)
    )).scalar() or 0

    signals_today = (await db.execute(
        select(func.count(AnalysisSignal.id)).where(
            AnalysisSignal.triggered_date == today
        )
    )).scalar() or 0

    alerts_today = (await db.execute(
        select(func.count(AlertLog.id)).where(
            func.date(AlertLog.sent_at) == today
        )
    )).scalar() or 0

    active_alerts = (await db.execute(
        select(func.count(AlertLog.id)).where(AlertLog.status == "sent")
    )).scalar() or 0

    # APScheduler job statuses
    jobs = []
    for job in scheduler.get_jobs():
        jobs.append(JobStatus(
            id=job.id,
            name=job.name,
            next_run_time=str(job.next_run_time) if job.next_run_time else None,
            trigger=str(job.trigger),
        ))

    return DashboardResponse(
        stats=DashboardStats(
            total_users=total_users,
            total_stocks=total_stocks,
            active_strategies=active_strategies,
            signals_today=signals_today,
            alerts_today=alerts_today,
            active_alerts=active_alerts,
        ),
        scheduled_jobs=jobs,
        server_time=datetime.utcnow().isoformat() + "Z",
    )


# ---------------------------------------------------------------------------
# POST /admin/scheduler/trigger/{job_name}
# ---------------------------------------------------------------------------

VALID_JOB_NAMES = {
    "sync_daily_prices",
    "scan_signals",
    "generate_ai_analysis",
    "dispatch_alerts",
}


@router.post("/scheduler/trigger/{job_name}", response_model=TriggerJobResponse)
async def trigger_job(
    job_name: str,
    _: User = Depends(get_current_admin_user),
):
    if job_name not in VALID_JOB_NAMES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid job_name. Must be one of: {sorted(VALID_JOB_NAMES)}",
        )

    job = scheduler.get_job(job_name)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_name}' not registered")

    try:
        job.func  # verify callable
        # Execute the job function asynchronously
        import asyncio
        if asyncio.iscoroutinefunction(job.func):
            await job.func()
        else:
            job.func()
        return TriggerJobResponse(
            job_id=job_name,
            status="triggered",
            message=f"Job '{job_name}' executed successfully",
        )
    except Exception as e:
        logger.exception("Manual trigger of '%s' failed", job_name)
        raise HTTPException(status_code=500, detail=f"Job execution failed: {e}")
```

---

## 7. File: `backend/app/core/config.py` (modification)

Ensure Redis URL is configured:

```python
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # ... existing fields ...

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}
```

---

## 8. File: `backend/app/core/deps.py` (modification)

Add a `get_db_context` context manager for use in scheduler jobs (which run outside request scope):

```python
from contextlib import asynccontextmanager
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from backend.app.core.config import settings

engine = create_async_engine(settings.DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


@asynccontextmanager
async def get_db_context():
    """Async context manager for DB sessions outside of requests (e.g. scheduler jobs)."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
```

---

## 9. Redis Key Design

| Key | Type | Producer | Consumer(s) | Description |
|-----|------|----------|-------------|-------------|
| `new_signals` | List | `scan_signals` (LPUSH) | `generate_ai_analysis`, `dispatch_alerts` (LRANGE) | Signal IDs awaiting processing |

**Lifecycle:**
1. `scan_signals` → `LPUSH new_signals <id1> <id2> ...`
2. `generate_ai_analysis` → `LRANGE new_signals 0 -1` → process → (does NOT delete)
3. `dispatch_alerts` → `LRANGE new_signals 0 -1` → process → `DELETE new_signals`

---

## 10. Test Specifications

### 10.1 Unit Tests

| Test | Description | Expected |
|------|-------------|----------|
| `test_scheduler_registers_4_jobs` | Start scheduler lifespan | `scheduler.get_jobs()` returns 4 jobs |
| `test_sync_daily_prices_calls_data_service` | Mock DataService | `sync_all_active()` called once |
| `test_scan_signals_pushes_to_redis` | Mock SignalEngine returns 2 signals | `LPUSH new_signals` called with 2 IDs |
| `test_generate_ai_analysis_no_signals_skips` | Redis LRANGE returns empty | No AIAnalysis calls, log says "no new signals" |
| `test_generate_ai_analysis_handles_missing_service` | AIAnalysisService not importable (stub) | Logs warning, no crash |
| `test_dispatch_alerts_clears_redis` | Mock AlertService returns 0 sent | `DELETE new_signals` called |
| `test_dashboard_stats_returns_counts` | Mock DB with known counts | Response contains correct numbers |
| `test_trigger_job_valid_name` | POST /admin/scheduler/trigger/scan_signals | 200, job executes |
| `test_trigger_job_invalid_name` | POST /admin/scheduler/trigger/invalid | 400 error |

### 10.2 Integration Tests

| Test | Description |
|------|-------------|
| `test_full_pipeline_mocked` | Mock all services, verify 4 jobs execute in order via manual triggers |
| `test_scheduler_lifespan_startup_shutdown` | Verify scheduler starts on app startup and stops on shutdown |

---

## 11. Acceptance Criteria Checklist

- [ ] APScheduler initialized with timezone "America/New_York"
- [ ] 4 jobs registered: sync_daily_prices, scan_signals, generate_ai_analysis, dispatch_alerts
- [ ] Jobs scheduled Mon-Fri at 16:30, 16:32, 16:34, 16:36 ET respectively
- [ ] `coalesce=True` prevents missed-run pileup
- [ ] `max_instances=1` prevents overlapping job runs
- [ ] Scheduler starts on FastAPI startup, shuts down on teardown
- [ ] `sync_daily_prices` calls DataService.sync_all_active() and logs result count
- [ ] `scan_signals` calls SignalEngine.scan_all_active() and pushes IDs to Redis "new_signals"
- [ ] `generate_ai_analysis` reads from "new_signals", calls AIAnalysisService per signal, logs cost
- [ ] `generate_ai_analysis` gracefully handles missing AIAnalysisService (stub)
- [ ] `dispatch_alerts` reads from "new_signals", calls AlertService per signal, DELETEs the key
- [ ] `dispatch_alerts` gracefully handles missing AlertService (stub)
- [ ] `GET /admin/dashboard/stats` returns user/stock/strategy/signal/alert counts
- [ ] `GET /admin/dashboard/stats` returns APScheduler job statuses
- [ ] `POST /admin/scheduler/trigger/{job_name}` manually triggers a valid job (admin only)
- [ ] `POST /admin/scheduler/trigger/{invalid}` returns 400
- [ ] Redis key "new_signals" is deleted by `dispatch_alerts` after processing
- [ ] All jobs log start and completion with message counts

---

## 12. Dependencies

- **Task 05**: `SignalEngine` class (scan_all_active, scan_single)
- **Task 04**: `DataService` class (sync_all_active)
- **Task 03**: Auth system (`get_current_admin_user` dependency)
- **Task 08**: `AIAnalysisService` (stubbed — tested via ImportError handling)
- **Task 09**: `AlertService` (stubbed — tested via ImportError handling)

---

## 13. Estimated Time

| Sub-task | Hours |
|----------|-------|
| Scheduler runner + lifespan integration | 2h |
| 4 job functions with Redis + logging | 4h |
| Dashboard stats endpoint | 2h |
| Manual trigger endpoint | 1h |
| Config / deps updates | 1h |
| pytest: scheduler + dashboard | 3h |
| Integration testing | 2h |
| **Total** | **~15h** |
