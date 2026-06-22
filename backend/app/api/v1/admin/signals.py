from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_admin_user, get_db
from app.models.analysis import AnalysisSignal
from app.models.user import User
from app.schemas.analysis import SignalOut

router = APIRouter(prefix="/admin/signals", tags=["admin-signals"])


@router.get("", response_model=dict)
async def list_signals(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    stock_id: int | None = None,
    config_id: int | None = None,
    signal_type: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    query = select(AnalysisSignal)
    count_query = select(func.count(AnalysisSignal.id))
    filters = []
    if stock_id is not None:
        filters.append(AnalysisSignal.stock_id == stock_id)
    if config_id is not None:
        filters.append(AnalysisSignal.config_id == config_id)
    if signal_type is not None:
        filters.append(AnalysisSignal.signal_type == signal_type)
    if filters:
        query = query.where(*filters)
        count_query = count_query.where(*filters)
    total = (await db.execute(count_query)).scalar() or 0
    rows = (await db.execute(query.order_by(AnalysisSignal.triggered_date.desc(), AnalysisSignal.id.desc()).offset((page - 1) * size).limit(size))).scalars().all()
    items = [SignalOut.model_validate(row).model_dump(mode="json") for row in rows]
    return {"items": items, "total": total, "page": page, "size": size, "pages": (total + size - 1) // size}
