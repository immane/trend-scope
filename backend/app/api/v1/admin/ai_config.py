from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_admin_user, get_db
from app.models.user import User
from app.schemas.ai_analysis import AIConfigOut, AIConfigUpdate
from app.services.ai_config import ai_config

router = APIRouter(prefix="/admin/ai-config", tags=["admin-ai-config"])


@router.get("", response_model=AIConfigOut)
async def get_ai_config(_: User = Depends(get_admin_user)):
    return ai_config.snapshot()


@router.patch("", response_model=AIConfigOut)
async def update_ai_config(body: AIConfigUpdate, db: AsyncSession = Depends(get_db), _: User = Depends(get_admin_user)):
    ai_config.update(
        api_key=body.api_key,
        base_url=body.base_url,
        model=body.model,
        enabled=body.enabled,
    )
    await db.commit()
    return ai_config.snapshot()
