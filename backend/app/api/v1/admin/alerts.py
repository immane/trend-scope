from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_admin_user, get_db
from app.models.alert import AlertLog
from app.models.user import User
from app.schemas.alert import AlertLogOut

router = APIRouter(prefix="/admin/alerts", tags=["admin-alerts"])


@router.get("", response_model=dict)
async def list_alert_logs(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), user_id: int | None = None, status: str | None = None, db: AsyncSession = Depends(get_db), _: User = Depends(get_admin_user)):
    query = select(AlertLog)
    count_query = select(func.count(AlertLog.id))
    filters = []
    if user_id is not None:
        filters.append(AlertLog.user_id == user_id)
    if status is not None:
        filters.append(AlertLog.status == status)
    if filters:
        query = query.where(*filters)
        count_query = count_query.where(*filters)
    total = (await db.execute(count_query)).scalar() or 0
    rows = (await db.execute(query.order_by(AlertLog.sent_at.desc()).offset((page - 1) * size).limit(size))).scalars().all()
    return {"items": [AlertLogOut.model_validate(row).model_dump(mode="json") for row in rows], "total": total, "page": page, "size": size, "pages": (total + size - 1) // size}
