from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel


class AIAnalysisOut(BaseModel):
    id: int
    signal_id: int
    model_provider: str
    model_name: str
    prompt_tokens: int
    completion_tokens: int
    total_cost: Decimal
    analysis_json: dict
    generated_at: datetime

    model_config = {"from_attributes": True}


class AIConfigUpdate(BaseModel):
    api_key: str | None = None
    base_url: str | None = None
    model: str | None = None
    enabled: bool | None = None


class AIConfigOut(BaseModel):
    api_key: str
    base_url: str
    model: str
    enabled: bool
    configured: bool
