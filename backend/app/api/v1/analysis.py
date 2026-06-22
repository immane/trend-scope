from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db
from app.models.ai_analysis import AIAnalysisResult
from app.models.analysis import AnalysisSignal
from app.models.user import User
from app.schemas.ai_analysis import AIAnalysisOut
from app.schemas.analysis import SignalOut
from app.services.ai_analysis_service import AIAnalysisService

router = APIRouter(prefix="/analysis", tags=["analysis"])


@router.get("/signals", response_model=dict)
async def list_public_signals(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    stock_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    query = select(AnalysisSignal).where(AnalysisSignal.is_active.is_(True))
    count_query = select(func.count(AnalysisSignal.id)).where(AnalysisSignal.is_active.is_(True))
    if stock_id is not None:
        query = query.where(AnalysisSignal.stock_id == stock_id)
        count_query = count_query.where(AnalysisSignal.stock_id == stock_id)
    total = (await db.execute(count_query)).scalar() or 0
    rows = (await db.execute(query.order_by(AnalysisSignal.triggered_date.desc()).offset((page - 1) * size).limit(size))).scalars().all()
    return {"items": [SignalOut.model_validate(row).model_dump(mode="json") for row in rows], "total": total, "page": page, "size": size, "pages": (total + size - 1) // size}


@router.get("/signals/{signal_id}", response_model=SignalOut)
async def get_signal(signal_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    signal = (await db.execute(select(AnalysisSignal).where(AnalysisSignal.id == signal_id, AnalysisSignal.is_active.is_(True)))).scalar_one_or_none()
    if signal is None:
        raise HTTPException(status_code=404, detail="Signal not found")
    return signal


@router.get("/signals/{signal_id}/ai", response_model=AIAnalysisOut)
async def get_ai_analysis(signal_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    analysis = (await db.execute(select(AIAnalysisResult).where(AIAnalysisResult.signal_id == signal_id))).scalar_one_or_none()
    if analysis is None:
        raise HTTPException(status_code=404, detail="AI analysis not found")
    return analysis


@router.post("/signals/{signal_id}/ai", response_model=AIAnalysisOut)
async def generate_ai_analysis(signal_id: int, force: bool = False, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    try:
        return await AIAnalysisService(db).analyze_and_store(signal_id, force=force)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
