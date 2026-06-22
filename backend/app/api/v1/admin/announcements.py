from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_admin_user, get_current_user, get_db
from app.models.announcement import Announcement
from app.models.user import User

router = APIRouter(prefix="/admin/announcements", tags=["admin-announcements"])


@router.get("", response_model=dict)
async def list_announcements(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    total = (await db.execute(select(func.count(Announcement.id)))).scalar() or 0
    rows = (await db.execute(
        select(Announcement).order_by(Announcement.is_pinned.desc(), Announcement.id.desc())
        .offset((page - 1) * size).limit(size)
    )).scalars().all()
    items = [{
        "id": r.id, "title": r.title, "content": r.content,
        "is_published": r.is_published, "is_pinned": r.is_pinned,
        "created_by": r.created_by,
        "created_at": str(r.created_at), "updated_at": str(r.updated_at),
    } for r in rows]
    return {"items": items, "total": total, "page": page, "size": size, "pages": (total + size - 1) // size}


@router.post("", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_announcement(body: dict, db: AsyncSession = Depends(get_db), admin: User = Depends(get_admin_user)):
    announcement = Announcement(
        title=body["title"],
        content=body["content"],
        is_published=body.get("is_published", True),
        is_pinned=body.get("is_pinned", False),
        created_by=admin.id,
    )
    db.add(announcement)
    await db.flush()
    await db.refresh(announcement)
    return {"id": announcement.id, "title": announcement.title, "is_published": announcement.is_published, "is_pinned": announcement.is_pinned}


@router.patch("/{announcement_id}", response_model=dict)
async def update_announcement(announcement_id: int, body: dict, db: AsyncSession = Depends(get_db), _: User = Depends(get_admin_user)):
    announcement = (await db.execute(select(Announcement).where(Announcement.id == announcement_id))).scalar_one_or_none()
    if announcement is None:
        raise HTTPException(status_code=404, detail="Not found")
    for key in ("title", "content", "is_published", "is_pinned"):
        if key in body and body[key] is not None:
            setattr(announcement, key, body[key])
    await db.flush()
    return {"id": announcement.id, "title": announcement.title, "is_published": announcement.is_published, "is_pinned": announcement.is_pinned}


@router.delete("/{announcement_id}", status_code=status.HTTP_200_OK)
async def delete_announcement(announcement_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(get_admin_user)):
    announcement = (await db.execute(select(Announcement).where(Announcement.id == announcement_id))).scalar_one_or_none()
    if announcement is None:
        raise HTTPException(status_code=404, detail="Not found")
    await db.delete(announcement)
    await db.flush()
    return {"detail": "Deleted"}


# Public endpoint
announcements_public = APIRouter(prefix="/announcements", tags=["announcements"])


@announcements_public.get("", response_model=dict)
async def list_public_announcements(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    rows = (await db.execute(
        select(Announcement).where(Announcement.is_published.is_(True))
        .order_by(Announcement.is_pinned.desc(), Announcement.id.desc()).limit(20)
    )).scalars().all()
    return {"items": [{"id": r.id, "title": r.title, "content": r.content, "is_pinned": r.is_pinned, "created_at": str(r.created_at)} for r in rows]}
