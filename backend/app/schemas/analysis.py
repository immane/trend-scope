from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class StrategyBase(BaseModel):
    stock_id: int | None = None
    name: str = Field(min_length=1, max_length=100)
    description: str | None = None
    strategy_type: str = Field(pattern=r"^(ma_cross|multi_indicator|custom_script)$")
    params: dict = Field(default_factory=dict)
    script_content: str | None = None
    script_params: dict | None = Field(default_factory=dict)
    confirm_bars: int = 0
    volume_confirm: bool = False
    is_active: bool = True


class StrategyCreate(StrategyBase):
    pass


class StrategyUpdate(BaseModel):
    stock_id: int | None = None
    name: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = None
    strategy_type: str | None = Field(None, pattern=r"^(ma_cross|multi_indicator|custom_script)$")
    params: dict | None = None
    script_content: str | None = None
    script_params: dict | None = None
    confirm_bars: int | None = None
    volume_confirm: bool | None = None
    is_active: bool | None = None


class StrategyOut(StrategyBase):
    id: int
    created_by: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class StrategyValidateRequest(BaseModel):
    script_content: str


class StrategyValidateResponse(BaseModel):
    valid: bool
    detail: str


class StrategyTestRunRequest(BaseModel):
    stock_id: int
    limit: int = Field(default=100, ge=2, le=500)


class SignalOut(BaseModel):
    id: int
    stock_id: int
    config_id: int
    signal_type: str
    signal_subtype: str | None = None
    strength: str
    confidence: Decimal | None = None
    trigger_price: Decimal
    trigger_details: dict
    triggered_date: date
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class PaginatedResponse(BaseModel):
    items: list[dict]
    total: int
    page: int
    size: int
    pages: int
