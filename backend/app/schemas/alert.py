from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class AlertRuleCreate(BaseModel):
    stock_id: int
    alert_type: str = Field(default="any_signal", pattern=r"^(any_signal|buy_signal|sell_signal)$")


class AlertRuleUpdate(BaseModel):
    alert_type: str | None = Field(None, pattern=r"^(any_signal|buy_signal|sell_signal)$")
    is_active: bool | None = None


class AlertRuleOut(BaseModel):
    id: int
    user_id: int
    stock_id: int
    alert_type: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AlertLogOut(BaseModel):
    id: int
    alert_rule_id: int | None
    user_id: int
    stock_id: int
    signal_id: int | None
    channel: str
    title: str
    message: str
    status: str
    provider_message_id: str | None = None
    sent_at: datetime

    model_config = {"from_attributes": True}
