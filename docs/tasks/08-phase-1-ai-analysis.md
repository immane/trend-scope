# Task 08 — Phase 1 AI Analysis

> **Estimated time**: 2-3 days
> **依赖 (Depends On)**: T05 — 信号数据, T06 — 调度器触发
> **被依赖 (Required By)**: T09 — 提醒邮件, T10 — 管理端前端
> **Status**: Not started
> **参考设计文档**:
> - [001-preliminary-design.md](../design/001-preliminary-design.md) — 总体架构
> - [phase-1.md](../design/phase-1.md) — Phase 1 MVP 详细设计
> - [003-api-specification.md](../design/003-api-specification.md) — API规格
> - [008-ai-analysis-system.md](../design/008-ai-analysis-system.md) — AI分析设计
> - [009-ai-analysis.md](../research/009-ai-analysis.md) — AI研究

---

## 1. Objective

Implement AI-powered signal analysis using the DeepSeek API (OpenAI-compatible) with fallback to deterministic Chinese-language templates when the LLM is unavailable. Also create API endpoints for retrieving and regenerating AI analyses.

---

## 2. Files to Create/Modify

| # | File Path | Action | Description |
|---|-----------|--------|-------------|
| 1 | `backend/app/services/ai_analysis_service.py` | CREATE | AIAnalysisService class |
| 2 | `backend/app/schemas/ai_analysis.py` | CREATE | Pydantic schemas |
| 3 | `backend/app/api/v1/analysis.py` | MODIFY | Add AI analysis endpoints |
| 4 | `backend/app/models/ai_analysis.py` | CREATE | AIAnalysisResult ORM model |
| 5 | `backend/app/core/config.py` | MODIFY | Add DeepSeek API key config |

---

## 3. File: `backend/app/services/ai_analysis_service.py`

### 3.1 Complete Implementation

```python
"""
AI Analysis Service — DeepSeek-powered signal analysis with template fallback.

Uses OpenAI-compatible client pointed at DeepSeek's API endpoint.
If the LLM is unavailable, falls back to hardcoded Chinese-language templates.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional

from openai import AsyncOpenAI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import settings
from backend.app.models.analysis import AnalysisSignal, AnalysisConfig
from backend.app.models.stock import Stock, StockPriceDaily
from backend.app.models.ai_analysis import AIAnalysisResult

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Prompt configuration
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are a professional financial analyst specializing in technical analysis of \
U.S. stock market ETFs and indices. Your role is to interpret technical indicators \
and provide objective, data-driven analysis.

IMPORTANT RULES:
1. Always include the disclaimer text in Chinese at the end.
2. Ground ALL analysis in the provided data. Do NOT hallucinate prices or indicator values.
3. Confidence must be between 0.0 and 1.0.
4. Do not use words like "guaranteed", "certain", "definitely", "100%".
5. Your stop_loss and target prices must be consistent with the current price context.
6. Be specific about technical reasons — reference the actual indicator values provided.
7. Output must be valid JSON matching the required schema exactly.
8. You MUST respond in Chinese (简体中文).
"""

ANALYSIS_PROMPT_TEMPLATE = """\
## Stock Context
- Symbol: {symbol}
- Name: {name}
- Current Price: ${price}
- Signal Date: {date}

## Technical Context
{technical_context}

## Recent Price Action (Last {days} Trading Days)
{price_table}

## Analysis Requirements
Based on the above data, provide a structured JSON analysis following this exact schema:
```json
{{
  "symbol": "{symbol}",
  "signal_type": "{signal_type}",
  "analysis": {{
    "summary": "string (concise 2-3 sentence summary in Chinese)",
    "why_{direction}": ["string (reason 1)", "string (reason 2)", "string (reason 3)"],
    "risks": ["string (risk 1)", "string (risk 2)", "string (risk 3)"],
    "stop_loss": {{
      "price": {price},
      "percentage_down": 5.0,
      "reasoning": "string (in Chinese)"
    }},
    "targets": [
      {{"price": {price_high}, "percentage_up": 5.0, "type": "resistance"}}
    ],
    "confidence": 0.70,
    "time_horizon": "2-4 weeks"
  }},
  "disclaimer": "⚠️ 以上为AI生成的参考分析，不构成投资建议。投资有风险，入市需谨慎。过往表现不代表未来收益。请结合自身情况做出独立判断。",
  "generated_at": "{timestamp}"
}}
```

Return ONLY valid JSON with no markdown fences or additional text.
"""

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

FORBIDDEN_WORDS = [
    "guaranteed", "certain", "definitely", "100%",
    "一定", "保证", "绝对", "100%",
]


# ---------------------------------------------------------------------------
# Template fallbacks (Chinese)
# ---------------------------------------------------------------------------

BUY_TEMPLATE: dict[str, Any] = {
    "analysis": {
        "summary": "{symbol} 于 {date} 触发买入信号 ({subtype})。当前价格 ${price}。"
                   "技术指标显示短期动能增强，建议关注后续确认信号。",
        "why_buy": [
            "策略 {strategy_name} 发出买入信号，信号强度: {strength}",
            "触发价格为 ${price}，技术面呈现积极特征",
            "成交量配合良好，市场关注度提升",
        ],
        "risks": [
            "市场整体趋势可能逆转，信号可能为假突破",
            "短期波动可能导致止损触发",
            "建议结合基本面分析综合判断",
        ],
        "stop_loss": {
            "price": round({price} * 0.95, 2),
            "percentage_down": 5.0,
            "reasoning": "建议止损位设在近期支撑位下方3-5%",
        },
        "targets": [
            {"price": round({price} * 1.05, 2), "percentage_up": 5.0, "type": "resistance"},
        ],
        "confidence": 0.5,
        "time_horizon": "2-4 周",
    },
}

SELL_TEMPLATE: dict[str, Any] = {
    "analysis": {
        "summary": "{symbol} 于 {date} 触发卖出信号 ({subtype})。当前价格 ${price}。"
                   "技术指标显示短期动能减弱，建议关注风险控制。",
        "why_sell": [
            "策略 {strategy_name} 发出卖出信号，信号强度: {strength}",
            "触发价格为 ${price}，技术面呈现压力特征",
            "趋势动能减弱，短期回调风险上升",
        ],
        "risks": [
            "卖出后市场可能快速反弹（假信号风险）",
            "中长期趋势可能未改变，卖出可能过早",
            "舆情或突发事件可能导致价格反向波动",
        ],
        "stop_loss": {
            "price": round({price} * 1.05, 2),
            "percentage_down": 5.0,
            "reasoning": "若价格反弹突破该位，信号可能失效",
        },
        "targets": [
            {"price": round({price} * 0.95, 2), "percentage_up": -5.0, "type": "support"},
        ],
        "confidence": 0.5,
        "time_horizon": "2-4 周",
    },
}


# ============================================================================
# AIAnalysisService
# ============================================================================

class AIAnalysisService:
    """Generates structured AI analysis for trade signals using DeepSeek."""

    def __init__(self):
        self.client = AsyncOpenAI(
            api_key=settings.DEEPSEEK_API_KEY,
            base_url="https://api.deepseek.com/v1",
        )
        self.model = "deepseek-chat"

    # ------------------------------------------------------------------ #
    #  Public API
    # ------------------------------------------------------------------ #

    async def analyze_and_store(
        self, db: AsyncSession, signal_id: int,
    ) -> AIAnalysisResult:
        """
        Full pipeline for a signal: fetch context → build prompt → call LLM
        → validate → store → return.

        If signal_id already has an analysis, returns the existing one.
        Falls back to template if LLM fails.
        """
        # Check for existing analysis
        existing = await db.execute(
            select(AIAnalysisResult).where(AIAnalysisResult.signal_id == signal_id)
        )
        existing_row = existing.scalar_one_or_none()
        if existing_row:
            logger.info("AI analysis already exists for signal_id=%d", signal_id)
            return existing_row

        # Load signal + stock + prices
        signal = await db.get(AnalysisSignal, signal_id)
        if signal is None:
            raise ValueError(f"AnalysisSignal id={signal_id} not found")

        stock = await db.get(Stock, signal.stock_id)
        if stock is None:
            raise ValueError(f"Stock id={signal.stock_id} not found")

        config = await db.get(AnalysisConfig, signal.config_id)

        prices_df = await self._load_recent_prices(db, signal.stock_id, days=60)

        # Try LLM, fall back to template on failure
        try:
            analysis_json = await self._generate_with_llm(signal, stock, config, prices_df)
            model_provider = "deepseek"
            model_name = self.model
            prompt_tokens = analysis_json.get("usage", {}).get("prompt_tokens", 0)
            completion_tokens = analysis_json.get("usage", {}).get("completion_tokens", 0)
            total_cost = analysis_json.get("usage", {}).get("total_cost", Decimal("0"))
            content = analysis_json.get("content", {})
        except Exception:
            logger.exception("LLM analysis failed for signal_id=%d, using template", signal_id)
            content = self._template_fallback(signal, stock, config)
            model_provider = "template"
            model_name = "fallback-template"
            prompt_tokens = 0
            completion_tokens = 0
            total_cost = Decimal("0")

        # Store
        result = AIAnalysisResult(
            signal_id=signal_id,
            model_provider=model_provider,
            model_name=model_name,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_cost=total_cost,
            analysis_json=content,
        )
        db.add(result)
        await db.commit()
        await db.refresh(result)
        return result

    # ------------------------------------------------------------------ #
    #  LLM Call
    # ------------------------------------------------------------------ #

    async def _generate_with_llm(
        self,
        signal: AnalysisSignal,
        stock: Stock,
        config: Optional[AnalysisConfig],
        prices_df: list[dict],
    ) -> dict:
        """Call DeepSeek API and return parsed + validated JSON."""
        prompt = self._build_prompt(signal, stock, config, prices_df)

        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
            max_tokens=2048,
        )

        usage = response.usage
        prompt_tokens = usage.prompt_tokens if usage else 0
        completion_tokens = usage.completion_tokens if usage else 0
        # DeepSeek pricing: $0.14/M input, $0.28/M output (approx; adjust per actual)
        total_cost = Decimal(str(
            prompt_tokens * 0.14 / 1_000_000 + completion_tokens * 0.28 / 1_000_000
        ))

        raw = response.choices[0].message.content
        analysis_json = json.loads(raw)

        # Validate
        is_valid, validation_msg = self._validate_response(analysis_json, signal, stock)
        if not is_valid:
            logger.warning("LLM response failed validation: %s", validation_msg)
            raise ValueError(f"Validation failed: {validation_msg}")

        return {
            "content": analysis_json,
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_cost": total_cost,
            },
        }

    # ------------------------------------------------------------------ #
    #  Prompt Building (5 sections)
    # ------------------------------------------------------------------ #

    def _build_prompt(
        self,
        signal: AnalysisSignal,
        stock: Stock,
        config: Optional[AnalysisConfig],
        prices_df: list[dict],
    ) -> str:
        # Stock context
        symbol = stock.symbol
        name = stock.name or symbol
        price = float(signal.trigger_price)
        date = str(signal.triggered_date)

        # Technical context
        details = signal.trigger_details if isinstance(signal.trigger_details, dict) else {}
        technical_lines = [
            f"- 信号类型: {signal.signal_type}",
            f"- 信号子类型: {signal.signal_subtype or 'N/A'}",
            f"- 信号强度: {signal.strength}",
        ]
        if config:
            technical_lines.append(f"- 策略名称: {config.name}")
            technical_lines.append(f"- 策略类型: {config.strategy_type.value if hasattr(config.strategy_type, 'value') else config.strategy_type}")
        for k, v in details.items():
            if k not in ("config_name", "strategy_type", "trigger_date", "last_close"):
                technical_lines.append(f"- {k}: {v}")

        # Price table (last 30-60 days)
        price_table_lines = ["| Date | Open | High | Low | Close | Volume |"]
        price_table_lines.append("|------|------|------|-----|-------|--------|")
        for row in prices_df[-30:]:
            price_table_lines.append(
                f"| {row['date']} | {row['open']:.2f} | {row['high']:.2f} | "
                f"{row['low']:.2f} | {row['close']:.2f} | {int(row['volume']):,} |"
            )

        direction = "buy" if signal.signal_type == "buy" else "sell"
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        prompt = ANALYSIS_PROMPT_TEMPLATE.format(
            symbol=symbol,
            name=name,
            price=price,
            date=date,
            technical_context="\n".join(technical_lines),
            days=min(30, len(prices_df)),
            price_table="\n".join(price_table_lines),
            signal_type=signal.signal_type,
            direction=direction,
            price_high=round(price * 1.05, 2),
            timestamp=timestamp,
        )
        return prompt

    # ------------------------------------------------------------------ #
    #  Response Validation (7 checks)
    # ------------------------------------------------------------------ #

    def _validate_response(
        self, analysis_json: dict, signal: AnalysisSignal, stock: Stock,
    ) -> tuple[bool, str]:
        """7-point validation. Returns (is_valid, reason)."""
        # 1. Required top-level keys
        required_keys = {"symbol", "signal_type", "analysis", "disclaimer", "generated_at"}
        missing = required_keys - set(analysis_json.keys())
        if missing:
            return False, f"Missing keys: {missing}"

        # 2. Disclaimer present
        disclaimer = analysis_json.get("disclaimer", "")
        if not disclaimer or len(disclaimer) < 20:
            return False, "Disclaimer missing or too short"

        # 3. Confidence in [0, 1]
        analysis = analysis_json.get("analysis", {})
        confidence = analysis.get("confidence")
        if confidence is None or not (0.0 <= float(confidence) <= 1.0):
            return False, f"Confidence out of range: {confidence}"

        # 4. No forbidden words
        full_text = json.dumps(analysis_json, ensure_ascii=False).lower()
        for word in FORBIDDEN_WORDS:
            if word in full_text:
                return False, f"Forbidden word found: {word}"

        # 5. Data consistency (no hallucinated prices far from trigger)
        trigger = float(signal.trigger_price)
        stop_loss = analysis.get("stop_loss", {})
        sl_price = stop_loss.get("price")
        if sl_price is not None:
            sl_pct = abs(float(sl_price) - trigger) / trigger
            if sl_pct > 0.30:  # stop-loss >30% away is unreasonable
                return False, f"Stop-loss price {sl_price} too far from trigger {trigger}"

        for tgt in analysis.get("targets", []):
            tgt_price = tgt.get("price")
            if tgt_price is not None:
                tgt_pct = abs(float(tgt_price) - trigger) / trigger
                if tgt_pct > 0.50:  # target >50% away is unreasonable
                    return False, f"Target price {tgt_price} too far from trigger {trigger}"

        # 6. Reasonable targets (at least 1)
        if not analysis.get("targets"):
            return False, "No price targets provided"

        # 7. Language check (should contain Chinese characters or be from template)
        if "⚠️" not in disclaimer:
            return False, "Disclaimer must contain warning emoji"

        return True, "OK"

    # ------------------------------------------------------------------ #
    #  Template Fallback
    # ------------------------------------------------------------------ #

    def _template_fallback(
        self, signal: AnalysisSignal, stock: Stock, config: Optional[AnalysisConfig],
    ) -> dict:
        """Generate analysis from hardcoded Chinese templates."""
        symbol = stock.symbol
        name = stock.name or symbol
        price = float(signal.trigger_price)
        subtype = signal.signal_subtype or signal.signal_type
        strength = signal.strength
        strategy_name = config.name if config else "Unknown"
        date = str(signal.triggered_date)

        is_buy = signal.signal_type == "buy"
        template = BUY_TEMPLATE if is_buy else SELL_TEMPLATE

        # Deep-copy and string-substitute
        import copy
        result = copy.deepcopy(template)

        def _sub(obj):
            if isinstance(obj, str):
                return obj.format(
                    symbol=symbol, name=name, price=price, date=date,
                    subtype=subtype, strength=strength,
                    strategy_name=strategy_name,
                )
            elif isinstance(obj, dict):
                return {k: _sub(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [_sub(v) for v in obj]
            return obj

        analysis = _sub(template["analysis"])

        return {
            "symbol": symbol,
            "signal_type": signal.signal_type,
            "analysis": analysis,
            "disclaimer": (
                "⚠️ 以上为AI生成的参考分析，不构成投资建议。"
                "投资有风险，入市需谨慎。过往表现不代表未来收益。"
                "请结合自身情况做出独立判断。"
            ),
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }

    # ------------------------------------------------------------------ #
    #  Data loading
    # ------------------------------------------------------------------ #

    async def _load_recent_prices(
        self, db: AsyncSession, stock_id: int, days: int = 60,
    ) -> list[dict]:
        from datetime import date, timedelta
        cutoff = date.today() - timedelta(days=days + 10)

        query = (
            select(StockPriceDaily)
            .where(
                StockPriceDaily.stock_id == stock_id,
                StockPriceDaily.trade_date >= cutoff,
            )
            .order_by(StockPriceDaily.trade_date.asc())
        )
        rows = (await db.execute(query)).scalars().all()

        return [
            {
                "date": str(r.trade_date),
                "open": float(r.open),
                "high": float(r.high),
                "low": float(r.low),
                "close": float(r.close),
                "volume": float(r.volume),
            }
            for r in rows
        ]
```

---

## 4. File: `backend/app/schemas/ai_analysis.py`

```python
"""Pydantic schemas for AI analysis responses."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from pydantic import BaseModel, Field


class StopLoss(BaseModel):
    price: float
    percentage_down: float
    reasoning: str


class PriceTarget(BaseModel):
    price: float
    percentage_up: float
    type: str  # resistance / support / extension


class AnalysisDetail(BaseModel):
    summary: str
    why_buy: Optional[list[str]] = None
    why_sell: Optional[list[str]] = None
    risks: list[str]
    stop_loss: StopLoss
    targets: list[PriceTarget]
    confidence: float = Field(ge=0.0, le=1.0)
    time_horizon: str


class AIAnalysisContent(BaseModel):
    symbol: str
    signal_type: str
    analysis: AnalysisDetail
    disclaimer: str
    generated_at: str


class AIAnalysisResponse(BaseModel):
    """GET /analysis/{stock_id}/ai/{signal_id} response."""
    id: int
    signal_id: int
    model_provider: str
    model_name: str
    prompt_tokens: int
    completion_tokens: int
    total_cost: float
    analysis_json: AIAnalysisContent
    generated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class RegenerateResponse(BaseModel):
    """POST regenerate response."""
    id: int
    signal_id: int
    model_provider: str
    model_name: str
    message: str
```

---

## 5. File: `backend/app/api/v1/analysis.py` (MODIFICATION — add to existing file)

Add these endpoints after the existing `get_stock_signals`:

```python
from backend.app.schemas.ai_analysis import AIAnalysisResponse, RegenerateResponse
from backend.app.services.ai_analysis_service import AIAnalysisService
from backend.app.models.ai_analysis import AIAnalysisResult


@router.get("/analysis/{stock_id}/ai/{signal_id}", response_model=AIAnalysisResponse)
async def get_ai_analysis(
    stock_id: int,
    signal_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result_row = await db.execute(
        select(AIAnalysisResult).where(AIAnalysisResult.signal_id == signal_id)
    )
    result = result_row.scalar_one_or_none()

    if result is None:
        raise HTTPException(status_code=404, detail="AI analysis not found for this signal")

    return AIAnalysisResponse.model_validate(result)


@router.post("/analysis/{stock_id}/ai/{signal_id}/regenerate", response_model=RegenerateResponse)
async def regenerate_ai_analysis(
    stock_id: int,
    signal_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin_user),
):
    # Delete existing
    existing = await db.execute(
        select(AIAnalysisResult).where(AIAnalysisResult.signal_id == signal_id)
    )
    old = existing.scalar_one_or_none()
    if old:
        await db.delete(old)
        await db.commit()

    # Re-generate
    ai_service = AIAnalysisService()
    new_result = await ai_service.analyze_and_store(db, signal_id)

    return RegenerateResponse(
        id=new_result.id,
        signal_id=new_result.signal_id,
        model_provider=new_result.model_provider,
        model_name=new_result.model_name,
        message="AI analysis regenerated successfully",
    )
```

---

## 6. File: `backend/app/models/ai_analysis.py`

```python
"""SQLAlchemy model for ai_analysis_results."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger, DateTime, Float, ForeignKey,
    Integer, JSON, String, Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.models.base import Base


class AIAnalysisResult(Base):
    __tablename__ = "ai_analysis_results"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    signal_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("analysis_signals.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    model_provider: Mapped[str] = mapped_column(String(50), nullable=False, default="deepseek")
    model_name: Mapped[str] = mapped_column(String(100), nullable=False, default="deepseek-chat")
    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_cost: Mapped[Decimal] = mapped_column(Float, nullable=False, default=0.0)
    analysis_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    generated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow,
    )

    # Relationship
    signal = relationship("AnalysisSignal", back_populates="ai_analysis")
```

---

## 7. File: `backend/app/core/config.py` (MODIFICATION)

Add:

```python
class Settings(BaseSettings):
    # ... existing fields ...

    # DeepSeek API
    DEEPSEEK_API_KEY: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}
```

---

## 8. APScheduler Job Integration

The `generate_ai_analysis` job defined in Task 06 (`backend/app/scheduler/jobs.py`) calls `AIAnalysisService.analyze_and_store()` for each signal in the Redis queue. The import there handles the case where `AIAnalysisService` is not yet available (stub mode):

```python
try:
    from backend.app.services.ai_analysis_service import AIAnalysisService
    ai_service = AIAnalysisService()
    result = await ai_service.analyze_and_store(db, sid)
except ImportError:
    logger.warning("AIAnalysisService not available (stub)")
```

---

## 9. Output JSON Schema (what the LLM returns)

```json
{
  "symbol": "SPY",
  "signal_type": "buy",
  "analysis": {
    "summary": "SPY 于 2026-06-09 触发强金叉买入信号。MA20上穿MA60，成交量放大2.3倍，技术面呈现多头排列。",
    "why_buy": [
      "MA20(521.45) 上穿 MA60(515.30)，形成金叉形态",
      "成交量较20日均量放大2.3倍，显示买方动能强劲",
      "RSI(14)=42 处于中性偏低区域，仍有上行空间"
    ],
    "risks": [
      "市场整体处于高位，系统性回调风险不可忽视",
      "若MA20回落跌破MA60，信号将失效形成假突破",
      "VIX指数若大幅上升，可能引发恐慌性抛售"
    ],
    "stop_loss": {
      "price": 505.50,
      "percentage_down": 3.8,
      "reasoning": "止损设在MA60(515.30)下方2%，约505.50，跌破则趋势破坏"
    },
    "targets": [
      {"price": 540.00, "percentage_up": 2.9, "type": "resistance"},
      {"price": 555.00, "percentage_up": 5.7, "type": "next resistance"}
    ],
    "confidence": 0.75,
    "time_horizon": "2-4 周"
  },
  "disclaimer": "⚠️ 以上为AI生成的参考分析，不构成投资建议。投资有风险，入市需谨慎。过往表现不代表未来收益。请结合自身情况做出独立判断。",
  "generated_at": "2026-06-09T16:30:00Z"
}
```

---

## 10. Test Specifications

### 10.1 Unit Tests

| Test | Description | Expected |
|------|-------------|----------|
| `test_build_prompt_contains_all_sections` | Call `_build_prompt` with mock data | Returns str containing "Stock Context", "Technical Context", "Recent Price Action", "Analysis Requirements" |
| `test_build_prompt_price_table_has_30_rows` | 60 days of mock price data | Table section has exactly 30 data rows |
| `test_validate_response_all_checks_pass` | Valid analysis JSON | `(True, "OK")` |
| `test_validate_response_missing_disclaimer` | JSON without disclaimer key | `(False, "...")` |
| `test_validate_response_confidence_out_of_range` | confidence=1.5 | `(False, "...")` |
| `test_validate_response_forbidden_word` | text contains "guaranteed" | `(False, "...")` |
| `test_validate_response_hallucinated_stop_loss` | stop_loss price 50% away from trigger | `(False, "...")` |
| `test_validate_response_no_targets` | targets=[] | `(False, "...")` |
| `test_template_fallback_buy` | buy signal | Returns dict with why_buy (3 items), risks (3 items), stop_loss, Chinese text |
| `test_template_fallback_sell` | sell signal | Returns dict with why_sell (3 items), risks (3 items), Chinese text |
| `test_template_has_disclaimer` | Any template output | disclaimer contains "⚠️" |
| `test_analyze_and_store_returns_existing` | Signal already has AIAnalysisResult | Returns existing record (no LLM call) |
| `test_cost_calculation` | prompt_tokens=1000, completion_tokens=500 | total_cost ≈ 0.00014 + 0.00014 = 0.00028 |

### 10.2 API Integration Tests

| Test | Method | Path | Expected |
|------|--------|------|----------|
| `test_get_ai_analysis` | GET | /analysis/{stock_id}/ai/{signal_id} | 200, AIAnalysisResponse |
| `test_get_ai_analysis_not_found` | GET | /analysis/{stock_id}/ai/{signal_id} | 404 |
| `test_regenerate_ai_analysis` | POST | /analysis/{stock_id}/ai/{signal_id}/regenerate | 200, new analysis (admin) |
| `test_regenerate_not_admin` | POST | (as normal user) | 403 |

### 10.3 Mock Tests (LLM)

| Test | Description |
|------|-------------|
| `test_llm_success_flow` | Mock `AsyncOpenAI` to return valid JSON. Call `analyze_and_store`. | Returns AIAnalysisResult with "deepseek" provider |
| `test_llm_failure_falls_back_to_template` | Mock `AsyncOpenAI` to raise exception. | Returns AIAnalysisResult with "template" provider |
| `test_llm_validation_failure_falls_back` | Mock returns JSON missing disclaimer. | Falls back to template |

---

## 11. Acceptance Criteria Checklist

- [ ] `AIAnalysisService.analyze_and_store()` loads signal, stock, config, and 60 days of price data
- [ ] Prompt includes 5 required sections: stock context, technical context, recent price action table, analysis requirements
- [ ] DeepSeek API called with `response_format={"type": "json_object"}`
- [ ] DeepSeek API called with correct `base_url="https://api.deepseek.com/v1"` and model `"deepseek-chat"`
- [ ] Response validated with all 7 checks:
  - [ ] Required keys present (symbol, signal_type, analysis, disclaimer, generated_at)
  - [ ] Disclaimer present and ≥ 20 chars
  - [ ] Confidence between 0.0 and 1.0
  - [ ] No forbidden words ("guaranteed", "certain", "definitely", "100%", Chinese equivalents)
  - [ ] Stop-loss price within 30% of trigger (anti-hallucination)
  - [ ] At least 1 price target
  - [ ] Disclaimer contains warning emoji
- [ ] Template fallback: buy template has why_buy (3 items), risks (3 items), stop_loss, targets
- [ ] Template fallback: sell template has why_sell (3 items), risks (3 items), stop_loss, targets
- [ ] Template output is in Chinese (简体中文)
- [ ] Template includes proper disclaimer text
- [ ] Existing analysis returns cached (no duplicate LLM calls)
- [ ] Token usage and cost tracked and stored (`prompt_tokens`, `completion_tokens`, `total_cost`)
- [ ] `GET /analysis/{stock_id}/ai/{signal_id}` returns AIAnalysisResponse
- [ ] `POST /analysis/{stock_id}/ai/{signal_id}/regenerate` deletes old, creates new (admin only)
- [ ] AIAnalysisResult has UNIQUE constraint on signal_id
- [ ] `generate_ai_analysis` scheduler job (Task 06) imports and calls `AIAnalysisService.analyze_and_store()`
- [ ] Graceful degradation: if DEEPSEEK_API_KEY is empty, service should raise clear error
- [ ] All Chinese text uses `\u26a0\ufe0f` emoji only (no other emojis)
- [ ] pytest coverage ≥ 75% for ai_analysis_service.py

---

## 12. Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DEEPSEEK_API_KEY` | Yes | — | DeepSeek API key (sk-...) |

---

## 13. Dependencies

- **Task 05**: `AnalysisSignal` model, `AnalysisConfig` model
- **Task 06**: Scheduler job `generate_ai_analysis` (imports this service)
- **Task 03**: Auth system (`get_current_user`, `get_current_admin_user`)

---

## 14. Estimated Time

| Sub-task | Hours |
|----------|-------|
| AIAnalysisService core (prompt building + LLM call + validation) | 6h |
| Template fallback system (buy + sell templates) | 2h |
| 7-point response validation | 2h |
| AIAnalysisResult model | 1h |
| AI analysis API endpoints (GET + regenerate) | 2h |
| Pydantic schemas | 1.5h |
| Config (DEEPSEEK_API_KEY) | 0.5h |
| pytest: unit + mock LLM + integration | 5h |
| **Total** | **~20h** |
