from __future__ import annotations

from decimal import Decimal

from openai import AsyncOpenAI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.ai_analysis import AIAnalysisResult
from app.models.analysis import AnalysisSignal
from app.models.stock import Stock


class AIAnalysisService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def analyze_and_store(self, signal_id: int, force: bool = False) -> AIAnalysisResult:
        existing = (await self.db.execute(select(AIAnalysisResult).where(AIAnalysisResult.signal_id == signal_id))).scalar_one_or_none()
        if existing is not None and not force:
            return existing
        signal = (await self.db.execute(select(AnalysisSignal).where(AnalysisSignal.id == signal_id))).scalar_one_or_none()
        if signal is None:
            raise ValueError("Signal not found")
        stock = (await self.db.execute(select(Stock).where(Stock.id == signal.stock_id))).scalar_one_or_none()
        payload = await self._build_analysis(signal, stock)
        if existing is None:
            existing = AIAnalysisResult(signal_id=signal_id, analysis_json=payload)
            self.db.add(existing)
        else:
            existing.analysis_json = payload
        existing.model_provider = "deepseek" if settings.DEEPSEEK_API_KEY else "template"
        existing.model_name = settings.DEEPSEEK_MODEL if settings.DEEPSEEK_API_KEY else "fallback-template"
        existing.prompt_tokens = 0
        existing.completion_tokens = 0
        existing.total_cost = Decimal("0")
        await self.db.flush()
        await self.db.refresh(existing)
        return existing

    async def _build_analysis(self, signal: AnalysisSignal, stock: Stock | None) -> dict:
        symbol = stock.symbol if stock else str(signal.stock_id)
        direction = "买入" if signal.signal_type == "buy" else "卖出"
        fallback = {
            "summary": f"{symbol} 在 {signal.triggered_date} 触发{direction}信号，触发价格为 {float(signal.trigger_price):.2f}。该分析基于当前策略信号自动生成。",
            "reasons": [f"策略 {signal.signal_subtype or signal.config_id} 触发{direction}条件", "价格行为满足预设技术规则", "信号已写入系统用于后续提醒"],
            "risks": ["技术信号可能失效", "市场波动可能导致滑点", "需要结合仓位和风险承受能力"],
            "stop_loss": {"price": round(float(signal.trigger_price) * (0.95 if signal.signal_type == "buy" else 1.05), 2), "reasoning": "按触发价附近 5% 风险缓冲估算"},
            "confidence": float(signal.confidence or 0.7),
            "disclaimer": "以上为AI生成的参考分析，不构成投资建议。投资有风险，入市需谨慎。",
        }
        if not settings.DEEPSEEK_API_KEY:
            return fallback
        try:
            client = AsyncOpenAI(api_key=settings.DEEPSEEK_API_KEY, base_url=settings.DEEPSEEK_BASE_URL)
            response = await client.chat.completions.create(
                model=settings.DEEPSEEK_MODEL,
                messages=[
                    {"role": "system", "content": "你是专业的技术分析助手。请用简体中文输出简短 JSON。"},
                    {"role": "user", "content": f"分析 {symbol} {direction} 信号，价格 {signal.trigger_price}，日期 {signal.triggered_date}"},
                ],
                response_format={"type": "json_object"},
            )
            import json

            return json.loads(response.choices[0].message.content or "{}") or fallback
        except Exception:
            return fallback
