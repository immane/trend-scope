from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth import UserOut
from app.core.deps import get_current_user, get_db
from app.models.user import User

router = APIRouter()


class UserUpdate(BaseModel):
    nickname: str | None = Field(None, max_length=100)
    avatar_url: str | None = Field(None, max_length=500)


@router.get("/me", response_model=UserOut)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch("/me", response_model=UserOut)
async def update_me(
    body: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if body.nickname is not None:
        current_user.nickname = body.nickname
    if body.avatar_url is not None:
        current_user.avatar_url = body.avatar_url
    await db.flush()
    await db.refresh(current_user)
    return current_user
