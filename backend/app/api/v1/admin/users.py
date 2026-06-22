from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_admin_user, get_db
from app.models.user import User
from app.schemas.stock import StockOut  # not used, using inline dict

router = APIRouter(prefix="/admin/users", tags=["admin-users"])


@router.get("", response_model=dict)
async def list_users(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None),
    role: str | None = Query(None),
    status_filter: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    query = select(User)
    count_query = select(func.count(User.id))
    if search:
        pattern = f"%{search}%"
        query = query.where((User.email.ilike(pattern)) | (User.nickname.ilike(pattern)))
        count_query = count_query.where((User.email.ilike(pattern)) | (User.nickname.ilike(pattern)))
    if role:
        query = query.where(User.role == role)
        count_query = count_query.where(User.role == role)
    if status_filter:
        query = query.where(User.status == status_filter)
        count_query = count_query.where(User.status == status_filter)
    total = (await db.execute(count_query)).scalar() or 0
    rows = (await db.execute(query.order_by(User.id.desc()).offset((page - 1) * size).limit(size))).scalars().all()
    items = [{
        "id": u.id,
        "email": u.email,
        "nickname": u.nickname,
        "avatar_url": u.avatar_url,
        "role": u.role,
        "status": u.status,
        "last_login_at": str(u.last_login_at) if u.last_login_at else None,
        "created_at": str(u.created_at),
        "updated_at": str(u.updated_at),
    } for u in rows]
    return {"items": items, "total": total, "page": page, "size": size, "pages": (total + size - 1) // size}


@router.get("/{user_id}", response_model=dict)
async def get_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "id": user.id,
        "email": user.email,
        "nickname": user.nickname,
        "avatar_url": user.avatar_url,
        "role": user.role,
        "status": user.status,
        "last_login_at": str(user.last_login_at) if user.last_login_at else None,
        "created_at": str(user.created_at),
        "updated_at": str(user.updated_at),
    }


@router.patch("/{user_id}", response_model=dict)
async def update_user(
    user_id: int,
    body: dict,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    if admin.id == user_id and body.get("role") == "user":
        raise HTTPException(status_code=400, detail="Cannot demote your own admin role")
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    allowed = {"nickname", "avatar_url", "role", "status"}
    for key, value in body.items():
        if key in allowed and value is not None:
            if key == "role" and value not in ("admin", "user"):
                raise HTTPException(status_code=400, detail="Role must be 'admin' or 'user'")
            if key == "status" and value not in ("active", "inactive", "banned"):
                raise HTTPException(status_code=400, detail="Status must be 'active', 'inactive', or 'banned'")
            setattr(user, key, value)
    await db.flush()
    await db.refresh(user)
    return {
        "id": user.id,
        "email": user.email,
        "nickname": user.nickname,
        "role": user.role,
        "status": user.status,
        "last_login_at": str(user.last_login_at) if user.last_login_at else None,
    }
