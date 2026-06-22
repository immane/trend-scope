from __future__ import annotations

from datetime import date

from pydantic import BaseModel


class StockPriceDataSummary(BaseModel):
    stock_id: int
    symbol: str
    stock_name: str
    total_rows: int
    earliest_date: date | None = None
    latest_date: date | None = None
    data_source: str | None = None

    model_config = {"from_attributes": True}


class StockPriceDataDeleteRequest(BaseModel):
    stock_id: int
    before_date: str | None = None
