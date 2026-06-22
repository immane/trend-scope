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
