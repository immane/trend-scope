from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_admin_user, get_db
from app.models.analysis import AnalysisConfig
from app.models.stock import Stock
from app.models.user import User
from app.schemas.analysis import StrategyCreate, StrategyOut, StrategyTestRunRequest, StrategyUpdate, StrategyValidateRequest, StrategyValidateResponse
from app.services.analysis_engine import SignalEngine
from app.services.script_executor import ScriptExecutor, ScriptValidationError

router = APIRouter(prefix="/admin/strategies", tags=["admin-strategies"])


def _page(items: list[StrategyOut], total: int, page: int, size: int) -> dict:
    return {"items": [item.model_dump(mode="json") for item in items], "total": total, "page": page, "size": size, "pages": (total + size - 1) // size}


async def _ensure_stock(db: AsyncSession, stock_id: int | None) -> None:
    if stock_id is None:
        return
    stock = (await db.execute(select(Stock).where(Stock.id == stock_id))).scalar_one_or_none()
    if stock is None:
        raise HTTPException(status_code=404, detail="Stock not found")


def _validate_custom(body) -> None:
    if getattr(body, "strategy_type", None) == "custom_script":
        try:
            ScriptExecutor().validate(body.script_content or "")
        except ScriptValidationError as exc:
            raise HTTPException(status_code=400, detail=f"脚本验证失败: {exc}") from exc


@router.get("", response_model=dict)
async def list_strategies(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    stock_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    query = select(AnalysisConfig)
    count_query = select(func.count(AnalysisConfig.id))
    if stock_id is not None:
        query = query.where(AnalysisConfig.stock_id == stock_id)
        count_query = count_query.where(AnalysisConfig.stock_id == stock_id)
    total = (await db.execute(count_query)).scalar() or 0
    rows = (await db.execute(query.order_by(AnalysisConfig.id.desc()).offset((page - 1) * size).limit(size))).scalars().all()
    return _page([StrategyOut.model_validate(row) for row in rows], total, page, size)


@router.post("", response_model=StrategyOut, status_code=status.HTTP_201_CREATED)
async def create_strategy(body: StrategyCreate, db: AsyncSession = Depends(get_db), admin: User = Depends(get_admin_user)):
    await _ensure_stock(db, body.stock_id)
    _validate_custom(body)
    config = AnalysisConfig(**body.model_dump(), created_by=admin.id)
    db.add(config)
    await db.flush()
    await db.refresh(config)
    return config


@router.get("/{strategy_id}", response_model=StrategyOut)
async def get_strategy(strategy_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(get_admin_user)):
    config = (await db.execute(select(AnalysisConfig).where(AnalysisConfig.id == strategy_id))).scalar_one_or_none()
    if config is None:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return config


@router.patch("/{strategy_id}", response_model=StrategyOut)
async def update_strategy(strategy_id: int, body: StrategyUpdate, db: AsyncSession = Depends(get_db), _: User = Depends(get_admin_user)):
    config = (await db.execute(select(AnalysisConfig).where(AnalysisConfig.id == strategy_id))).scalar_one_or_none()
    if config is None:
        raise HTTPException(status_code=404, detail="Strategy not found")
    data = body.model_dump(exclude_unset=True)
    await _ensure_stock(db, data.get("stock_id"))
    for key, value in data.items():
        setattr(config, key, value)
    if config.strategy_type == "custom_script":
        _validate_custom(config)
    await db.flush()
    await db.refresh(config)
    return config


@router.delete("/{strategy_id}", status_code=status.HTTP_200_OK)
async def delete_strategy(strategy_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(get_admin_user)):
    config = (await db.execute(select(AnalysisConfig).where(AnalysisConfig.id == strategy_id))).scalar_one_or_none()
    if config is None:
        raise HTTPException(status_code=404, detail="Strategy not found")
    config.is_active = False
    await db.flush()
    return {"detail": "Strategy deactivated"}


@router.post("/validate", response_model=StrategyValidateResponse)
async def validate_script(body: StrategyValidateRequest, _: User = Depends(get_admin_user)):
    try:
        ScriptExecutor().validate(body.script_content)
    except ScriptValidationError as exc:
        return StrategyValidateResponse(valid=False, detail=str(exc))
    return StrategyValidateResponse(valid=True, detail="OK")


@router.post("/{strategy_id}/test-run", response_model=dict)
async def test_run(strategy_id: int, body: StrategyTestRunRequest, db: AsyncSession = Depends(get_db), _: User = Depends(get_admin_user)):
    config = (await db.execute(select(AnalysisConfig).where(AnalysisConfig.id == strategy_id))).scalar_one_or_none()
    if config is None:
        raise HTTPException(status_code=404, detail="Strategy not found")
    signals = await SignalEngine(db).test_run(config, body.stock_id, body.limit)
    return {"signals": signals, "count": len(signals)}
