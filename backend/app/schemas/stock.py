from datetime import datetime

from pydantic import BaseModel, Field


class SignalPoint(BaseModel):
    id: int
    type: str
    subtype: str | None = None
    strength: str | None = None
    price: float
    ai_summary: str | None = None


class KlinePoint(BaseModel):
    time: str
    open: float
    high: float
    low: float
    close: float
    volume: int
    ma5: float | None = None
    ma10: float | None = None
    ma20: float | None = None
    ma60: float | None = None
    ma120: float | None = None
    macd_dif: float | None = None
    macd_dea: float | None = None
    macd_hist: float | None = None
    rsi14: float | None = None
    signal: SignalPoint | None = None


class KlineResponse(BaseModel):
    symbol: str
    period: str = "day"
    data: list[KlinePoint]


class StockOut(BaseModel):
    id: int
    symbol: str
    name: str
    type: str
    market: str
    sector: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class StockCreate(BaseModel):
    symbol: str = Field(min_length=1, max_length=20)
    name: str = Field(min_length=1, max_length=200)
    type: str = Field(pattern=r"^(ETF|Stock|Index)$")
    market: str = Field(default="US", pattern=r"^US$")
    sector: str | None = Field(None, max_length=100)


class StockUpdate(BaseModel):
    name: str | None = Field(None, max_length=200)
    type: str | None = Field(None, pattern=r"^(ETF|Stock|Index)$")
    sector: str | None = Field(None, max_length=100)
    is_active: bool | None = None
