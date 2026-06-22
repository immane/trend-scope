# Task 09 — Phase 1 Alert & Email System

> **Estimated time**: 2-3 days
> **Status**: Completed ✅
> **Depends On**: [Task 05 — 策略引擎](05-phase-1-strategy-engine.md), [Task 06 — 定时任务](06-phase-1-scheduler.md), [Task 08 — AI分析](08-phase-1-ai-analysis.md)
> **Required By**: [Task 10 — 管理端前端](10-phase-1-admin-frontend.md)
> **参考设计文档**:
> - [001-preliminary-design.md](../design/001-preliminary-design.md) — 总体架构
> - [phase-1.md](../design/phase-1.md) — Phase 1 MVP 详细设计
> - [003-api-specification.md](../design/003-api-specification.md) — API规格
> - [006-notification-system.md](../design/006-notification-system.md) — 通知系统设计
> - [007-notification.md](../research/007-notification.md) — 通知研究

---

## 1. Objective

Implement the complete alert/notification system: alert rule CRUD API for users, signal-to-alert matching engine, 24-hour deduplication, email dispatch via Resend with HTML templates (AI analysis inline when available, fallback message otherwise), and admin alert log viewer.

---

## 2. Files to Create/Modify

| # | File Path | Action | Description |
|---|-----------|--------|-------------|
| 1 | `backend/app/services/email_service.py` | CREATE | EmailService class — Resend SDK wrapper |
| 2 | `backend/app/services/alert_service.py` | CREATE | AlertService class — rule matching + email dispatch |
| 3 | `backend/app/schemas/alert.py` | CREATE | Pydantic request/response schemas |
| 4 | `backend/app/api/v1/alerts.py` | CREATE | User alert rule CRUD endpoints |
| 5 | `backend/app/api/v1/admin/alerts.py` | CREATE | Admin alert log listing endpoint |
| 6 | `backend/app/api/v1/router.py` | MODIFY | Register alerts + admin/alerts routers |
| 7 | `backend/app/scheduler/jobs.py` | MODIFY | Ensure `dispatch_alerts` imports and calls AlertService |

---

## 3. Prerequisites — Existing Code That Must Already Exist

Before starting this task, the following files from earlier tasks MUST be in place:

| Prerequisite | Source Task | What's needed |
|---|---|---|
| `backend/app/models/alert.py` with `AlertRule` + `AlertLog` ORM | Task 02 | Full model with relationships, unique constraint on (user_id, stock_id, alert_type) |
| `backend/app/models/analysis.py` with `AnalysisSignal` | Task 02/05 | `signal_type`, `signal_subtype`, `strength`, `trigger_price`, `triggered_date`, `trigger_details`, `stock_id`, `config_id` |
| `backend/app/models/ai_analysis.py` with `AIAnalysisResult` | Task 02/08 | `signal_id` (unique), `analysis_json` (JSON) |
| `backend/app/models/stock.py` with `Stock` | Task 02 | `symbol`, `name` |
| `backend/app/models/user.py` with `User` | Task 02 | `id`, `email`, `nickname` |
| `backend/app/core/config.py` with `RESEND_API_KEY` + `EMAIL_FROM` | Task 01 | Settings fields already defined |
| `backend/app/core/deps.py` with `get_db`, `get_current_user`, `get_current_admin_user` | Task 03 | Dependency injection functions |
| `backend/app/scheduler/jobs.py` with `dispatch_alerts` stub | Task 06 | Job function that imports and calls AlertService |

### 3.1 Existing Settings (Do NOT recreate)

These are already defined in `backend/app/core/config.py` from Task 01:

```python
RESEND_API_KEY: str = ""
EMAIL_FROM: str = "Trend-Scope <alerts@trend-scope.com>"
```

**DO NOT modify `config.py` unless a new setting is needed.** This task requires no new settings.

---

## 4. File: `backend/app/services/email_service.py`

### 4.1 Complete Implementation

```python
"""
Email Service — Resend API wrapper for sending signal alert emails.

Uses the `resend` Python SDK.  Set RESEND_API_KEY in .env before use.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any, Optional

import resend

from backend.app.core.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# HTML Email Template (inline, Chinese)
# ---------------------------------------------------------------------------

EMAIL_HTML_TEMPLATE = """\
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 24px 32px;">
    <h2 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 700;">
      {direction_emoji} {symbol} ({name}) {direction_cn}信号
    </h2>
  </div>
  <div style="padding: 24px 32px;">
    <h3 style="color: #1a202c; margin: 0 0 16px 0; font-size: 16px; font-weight: 600;">信号详情</h3>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
      <tr>
        <td style="padding: 8px 12px; background: #f7fafc; border-bottom: 1px solid #e2e8f0; color: #4a5568; font-size: 14px; width: 100px;">信号类型</td>
        <td style="padding: 8px 12px; background: #f7fafc; border-bottom: 1px solid #e2e8f0; color: #1a202c; font-size: 14px;">{signal_subtype_cn}</td>
      </tr>
      <tr>
        <td style="padding: 8px 12px; background: #ffffff; border-bottom: 1px solid #e2e8f0; color: #4a5568; font-size: 14px;">信号强度</td>
        <td style="padding: 8px 12px; background: #ffffff; border-bottom: 1px solid #e2e8f0; color: #1a202c; font-size: 14px;">{strength_cn}</td>
      </tr>
      <tr>
        <td style="padding: 8px 12px; background: #f7fafc; color: #4a5568; font-size: 14px;">触发价格</td>
        <td style="padding: 8px 12px; background: #f7fafc; color: #1a202c; font-size: 14px; font-weight: 600;">${price}</td>
      </tr>
      <tr>
        <td style="padding: 8px 12px; background: #ffffff; color: #4a5568; font-size: 14px;">触发日期</td>
        <td style="padding: 8px 12px; background: #ffffff; color: #1a202c; font-size: 14px;">{triggered_date}</td>
      </tr>
    </table>

{ai_section}

    <div style="border-top: 1px solid #e2e8f0; margin-top: 24px; padding-top: 16px;">
      <p style="color: #a0aec0; font-size: 12px; line-height: 1.5; margin: 0;">
        此邮件由 Trend-Scope 自动发送。如需取消提醒，请登录 <a href="https://trend-scope.com/alerts" style="color: #667eea; text-decoration: none;">提醒管理</a> 页面管理您的提醒规则。
      </p>
    </div>
  </div>
</div>
"""

AI_SECTION_TEMPLATE = """\
    <h3 style="color: #1a202c; margin: 0 0 12px 0; font-size: 16px; font-weight: 600;">AI 分析</h3>
    <div style="background: #f7fafc; border-radius: 6px; padding: 16px; margin-bottom: 16px;">
      <p style="color: #2d3748; font-size: 14px; line-height: 1.6; margin: 0 0 12px 0;">{ai_summary}</p>
      <h4 style="color: #e53e3e; margin: 0 0 8px 0; font-size: 14px; font-weight: 600;">风险提示</h4>
      <ul style="margin: 0; padding-left: 20px; color: #4a5568; font-size: 13px; line-height: 1.6;">
{risks_html}
      </ul>
      <h4 style="color: #38a169; margin: 16px 0 8px 0; font-size: 14px; font-weight: 600;">止损建议</h4>
      <p style="color: #2d3748; font-size: 13px; line-height: 1.5; margin: 0;">{stop_loss_html}</p>
    </div>
"""

NO_AI_SECTION = """\
    <div style="background: #edf2f7; border-radius: 6px; padding: 16px; margin-bottom: 16px; text-align: center;">
      <p style="color: #718096; font-size: 14px; margin: 0;">AI 分析生成中，请稍后登录查看。</p>
    </div>
"""


# ============================================================================
# EmailService
# ============================================================================

class EmailService:
    """Sends signal alert emails via the Resend API."""

    def __init__(self):
        resend.api_key = settings.RESEND_API_KEY

    # ------------------------------------------------------------------ #
    #  Public API
    # ------------------------------------------------------------------ #

    async def send_signal_alert(
        self,
        to_email: str,
        symbol: str,
        signal: Any,           # AnalysisSignal instance or duck-typed
        ai_analysis: Optional[dict] = None,
    ) -> str:
        """
        Send a signal alert email via Resend.

        Parameters
        ----------
        to_email : str
            Recipient email address.
        symbol : str
            Stock ticker symbol (e.g. "SPY").
        signal : AnalysisSignal
            The signal that triggered the alert. Must have: signal_type,
            signal_subtype, strength, trigger_price, triggered_date.
        ai_analysis : dict | None
            AI analysis result JSON. Will be parsed for summary, risks, stop_loss.

        Returns
        -------
        str
            Resend message ID (provider_message_id).
        """
        if not settings.RESEND_API_KEY:
            raise RuntimeError("RESEND_API_KEY is not configured")

        html_body = self._build_email_html(symbol, signal, ai_analysis)

        is_buy = signal.signal_type == "buy"
        direction_cn = "买入" if is_buy else "卖出"
        triggered_date = (
            str(signal.triggered_date)
            if not isinstance(signal.triggered_date, date)
            else signal.triggered_date.strftime("%Y-%m-%d")
        )

        params = {
            "from": settings.EMAIL_FROM,
            "to": [to_email],
            "subject": f"[Trend-Scope] {symbol} {direction_cn}信号 — {triggered_date}",
            "html": html_body,
        }

        try:
            response = resend.Emails.send(params)
            message_id = response.get("id", "")
            logger.info(
                "Email sent to %s for %s %s signal (message_id=%s)",
                to_email, symbol, signal.signal_type, message_id,
            )
            return message_id
        except Exception:
            logger.exception(
                "Failed to send email to %s for %s %s signal",
                to_email, symbol, signal.signal_type,
            )
            raise

    # ------------------------------------------------------------------ #
    #  HTML Builder
    # ------------------------------------------------------------------ #

    def _build_email_html(
        self,
        symbol: str,
        signal: Any,
        ai_analysis: Optional[dict] = None,
    ) -> str:
        """
        Build the complete HTML email body.

        Always renders the signal details table.  If ai_analysis is provided
        and contains usable data, renders the AI analysis section.  Otherwise
        renders a placeholder message.
        """
        is_buy = signal.signal_type == "buy"
        direction_cn = "买入" if is_buy else "卖出"
        direction_emoji = "\U0001f4c8" if is_buy else "\U0001f4c9"  # chart up/down
        name = getattr(signal, "stock_name", symbol)

        # Signal subtype mapping to Chinese
        subtype = signal.signal_subtype or signal.signal_type
        subtype_cn_map = {
            "golden_cross": "金叉买入",
            "death_cross": "死叉卖出",
            "composite_buy": "综合评分买入",
            "composite_sell": "综合评分卖出",
            "custom": "自定义策略",
            "buy": "买入信号",
            "sell": "卖出信号",
        }
        signal_subtype_cn = subtype_cn_map.get(subtype, subtype)

        # Strength mapping to Chinese
        strength_cn_map = {
            "weak": "弱",
            "normal": "正常",
            "strong": "强",
        }
        strength_cn = strength_cn_map.get(
            signal.strength or "normal", signal.strength or "正常"
        )

        price_f = float(signal.trigger_price)
        triggered_date = (
            str(signal.triggered_date)
            if not isinstance(signal.triggered_date, date)
            else signal.triggered_date.strftime("%Y-%m-%d")
        )

        # Build AI section
        ai_section_html = self._build_ai_section(ai_analysis)

        return EMAIL_HTML_TEMPLATE.format(
            direction_emoji=direction_emoji,
            symbol=symbol,
            name=name,
            direction_cn=direction_cn,
            signal_subtype_cn=signal_subtype_cn,
            strength_cn=strength_cn,
            price=f"{price_f:,.2f}",
            triggered_date=triggered_date,
            ai_section=ai_section_html,
        )

    def _build_ai_section(self, ai_analysis: Optional[dict]) -> str:
        """
        Build the AI analysis HTML section.

        Returns the filled AI_SECTION_TEMPLATE if ai_analysis has useful data,
        otherwise returns NO_AI_SECTION.
        """
        if not ai_analysis or not isinstance(ai_analysis, dict):
            return NO_AI_SECTION

        # The analysis_json from AIAnalysisResult has the shape:
        #   { "analysis": { "summary": "...", "risks": [...], "stop_loss": { ... } } }
        # The top-level key could be "analysis" or the content could be nested.
        analysis = ai_analysis.get("analysis", ai_analysis)

        summary = analysis.get("summary", "")
        if not summary:
            return NO_AI_SECTION

        # Risks
        risks = analysis.get("risks", [])
        if not risks:
            risks = ["市场整体趋势可能逆转", "信号可能为假突破", "建议结合基本面分析"]

        risks_html = "\n".join(
            f"        <li>{self._escape_html(r)}</li>" for r in risks
        )

        # Stop loss
        stop_loss = analysis.get("stop_loss", {})
        if isinstance(stop_loss, dict):
            sl_price = stop_loss.get("price", 0)
            sl_pct = stop_loss.get("percentage_down", 0)
            sl_reason = stop_loss.get("reasoning", "")
            stop_loss_html = (
                f"止损价位: <strong>${float(sl_price):,.2f}</strong> "
                f"(下跌 {float(sl_pct):.1f}%)"
            )
            if sl_reason:
                stop_loss_html += f" — {self._escape_html(sl_reason)}"
        else:
            stop_loss_html = "建议止损位设在近期低点下方 3-5%"

        return AI_SECTION_TEMPLATE.format(
            ai_summary=self._escape_html(summary),
            risks_html=risks_html,
            stop_loss_html=stop_loss_html,
        )

    @staticmethod
    def _escape_html(text: str) -> str:
        """Escape HTML special characters in a string."""
        return (
            text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
            .replace("'", "&#39;")
        )
```

---

## 5. File: `backend/app/services/alert_service.py`

### 5.1 Complete Implementation

```python
"""
Alert Service — matches alert rules to signals and dispatches emails.

Called by:
  - Scheduler job `dispatch_alerts` for automated end-of-day processing
  - Could also be called directly after manual signal creation
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import settings
from backend.app.models.alert import AlertRule, AlertLog
from backend.app.models.analysis import AnalysisSignal
from backend.app.models.stock import Stock
from backend.app.models.user import User
from backend.app.models.ai_analysis import AIAnalysisResult
from backend.app.services.email_service import EmailService

logger = logging.getLogger(__name__)

# SQLite-compatible DEDUP_SQL for checking if a user already received an alert
# for the same stock within the last 24 hours. Uses datetime math rather than
# NOW() directly for testability.
DEDUP_SQL = """
    SELECT 1 FROM alert_logs
    WHERE user_id = :user_id
      AND stock_id = :stock_id
      AND signal_id = :signal_id
      AND sent_at > :cutoff
    LIMIT 1
"""


# ============================================================================
# AlertService
# ============================================================================

class AlertService:
    """Matches alert rules to signals and dispatches email notifications."""

    # ------------------------------------------------------------------ #
    #  Public API
    # ------------------------------------------------------------------ #

    async def match_rules(
        self, db: AsyncSession, signal_id: int,
    ) -> list[tuple[AlertRule, User]]:
        """
        Find all (AlertRule, User) pairs that should be notified for a signal.

        Matching logic:
          1. Load the AnalysisSignal by id.
          2. Find all active alert_rules where stock_id matches the signal's stock_id
             AND alert_type matches the signal's type:
               - buy_signal  matches buy signals only
               - sell_signal matches sell signals only
               - any_signal  matches both buy and sell
          3. For each matching rule + user, exclude if the user already received
             an alert for the same (user_id, stock_id, signal_id) in the past 24 hours.
          4. Return list of (rule, user) tuples.

        Returns
        -------
        list[tuple[AlertRule, User]]
            Pairs ready for dispatch. Empty list if no matches.
        """
        # Step 1: Load signal
        signal = await db.get(AnalysisSignal, signal_id)
        if signal is None:
            logger.warning("Signal not found: id=%d", signal_id)
            return []

        # Step 2: Determine which alert_type values match this signal
        signal_type = signal.signal_type  # "buy" or "sell"
        if signal_type == "buy":
            matching_types = ["buy_signal", "any_signal"]
        elif signal_type == "sell":
            matching_types = ["sell_signal", "any_signal"]
        else:
            logger.warning("Unknown signal_type: %s for signal_id=%d", signal_type, signal_id)
            return []

        # Query matching active rules
        rules_query = (
            select(AlertRule, User)
            .join(User, AlertRule.user_id == User.id)
            .where(
                AlertRule.stock_id == signal.stock_id,
                AlertRule.alert_type.in_(matching_types),
                AlertRule.is_active == True,
            )
        )
        result = await db.execute(rules_query)
        rule_user_pairs = result.all()  # list of (AlertRule, User) tuples

        if not rule_user_pairs:
            logger.info(
                "No matching alert rules for signal_id=%d (type=%s, stock_id=%d)",
                signal_id, signal_type, signal.stock_id,
            )
            return []

        # Step 3: Dedup — exclude users who received alert for same signal in past 24h
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)

        matched: list[tuple[AlertRule, User]] = []
        for rule, user in rule_user_pairs:
            existing = await db.execute(
                select(AlertLog).where(
                    AlertLog.user_id == user.id,
                    AlertLog.stock_id == signal.stock_id,
                    AlertLog.signal_id == signal_id,
                    AlertLog.sent_at > cutoff,
                )
            )
            if existing.scalar_one_or_none() is not None:
                logger.debug(
                    "Skipping user_id=%d for signal_id=%d — alert already sent within 24h",
                    user.id, signal_id,
                )
                continue
            matched.append((rule, user))

        logger.info(
            "match_rules: signal_id=%d matched %d users (total rules=%d)",
            signal_id, len(matched), len(rule_user_pairs),
        )
        return matched

    # ------------------------------------------------------------------ #

    async def match_and_send(
        self, db: AsyncSession, signal_id: int,
    ) -> int:
        """
        Full pipeline: match rules → load AI analysis → send emails → log.

        Parameters
        ----------
        db : AsyncSession
        signal_id : int
            ID of the newly created AnalysisSignal.

        Returns
        -------
        int
            Number of alert emails successfully sent.
        """
        # Step 1: Load signal
        signal = await db.get(AnalysisSignal, signal_id)
        if signal is None:
            logger.warning("match_and_send: signal_id=%d not found", signal_id)
            return 0

        # Step 2: Load stock info
        stock = await db.get(Stock, signal.stock_id)
        symbol = stock.symbol if stock else "UNKNOWN"

        # Step 3: Load AI analysis (may be None if not yet generated)
        ai_result = await db.execute(
            select(AIAnalysisResult).where(
                AIAnalysisResult.signal_id == signal_id
            )
        )
        ai_row = ai_result.scalar_one_or_none()
        ai_analysis = ai_row.analysis_json if ai_row else None

        # Step 4: Match rules
        matches = await self.match_rules(db, signal_id)
        if not matches:
            return 0

        # Step 5: Send emails
        email_service = EmailService()
        sent_count = 0

        for rule, user in matches:
            try:
                message_id = await email_service.send_signal_alert(
                    to_email=user.email,
                    symbol=symbol,
                    signal=signal,
                    ai_analysis=ai_analysis,
                )
                status = "sent"
            except Exception:
                logger.exception(
                    "Email failed for user_id=%d signal_id=%d", user.id, signal_id
                )
                message_id = None
                status = "failed"

            # Step 6: Write alert_log
            is_buy = signal.signal_type == "buy"
            subtype_cn_map = {
                "golden_cross": "金叉买入" if is_buy else "死叉卖出",
                "death_cross": "死叉卖出",
                "composite_buy": "综合评分买入",
                "composite_sell": "综合评分卖出",
                "custom": "自定义策略",
            }
            subtype = signal.signal_subtype or signal.signal_type
            subtype_cn = subtype_cn_map.get(subtype, subtype)
            direction_cn = "买入" if is_buy else "卖出"

            triggered_date = (
                signal.triggered_date.strftime("%Y-%m-%d")
                if hasattr(signal.triggered_date, "strftime")
                else str(signal.triggered_date)
            )

            log_entry = AlertLog(
                alert_rule_id=rule.id,
                user_id=user.id,
                stock_id=signal.stock_id,
                signal_id=signal_id,
                channel="email",
                title=f"{symbol} {direction_cn}信号 — {subtype_cn}",
                message=(
                    f"股票: {symbol}\n"
                    f"信号类型: {subtype_cn}\n"
                    f"信号强度: {signal.strength}\n"
                    f"触发价格: ${float(signal.trigger_price):,.2f}\n"
                    f"触发日期: {triggered_date}"
                ),
                status=status,
                provider_message_id=message_id,
            )
            db.add(log_entry)

            if status == "sent":
                sent_count += 1

        # Commit all alert_log entries
        await db.commit()

        logger.info(
            "match_and_send: signal_id=%d → %d sent, %d total matched",
            signal_id, sent_count, len(matches),
        )
        return sent_count
```

---

## 6. File: `backend/app/schemas/alert.py`

### 6.1 Complete Implementation

```python
"""
Pydantic schemas for alert rules and alert logs.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Alert Rule
# ---------------------------------------------------------------------------

class AlertRuleCreate(BaseModel):
    """Request body for POST /alerts."""
    stock_id: int = Field(..., gt=0, description="Stock ID to monitor")
    alert_type: Literal["any_signal", "buy_signal", "sell_signal"] = Field(
        default="any_signal",
        description="Which signal types trigger this alert",
    )


class AlertRuleOut(BaseModel):
    """Response for alert rule endpoints."""
    id: int
    stock_id: int
    stock_symbol: str = Field(..., description="Stock ticker symbol (joined from stocks table)")
    alert_type: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class AlertRuleListResponse(BaseModel):
    """Paginated list of alert rules."""
    items: list[AlertRuleOut]
    total: int
    page: int
    size: int
    pages: int


# ---------------------------------------------------------------------------
# Alert Log
# ---------------------------------------------------------------------------

class AlertLogOut(BaseModel):
    """Response for alert log listing."""
    id: int
    user_email: str = Field(..., description="User email (joined from users table)")
    stock_symbol: str = Field(..., description="Stock ticker symbol (joined from stocks table)")
    signal_type: Optional[str] = Field(None, description="Signal type (buy/sell) of the associated signal")
    channel: str
    title: str
    status: str
    sent_at: datetime

    model_config = {"from_attributes": True}


class AlertLogListResponse(BaseModel):
    """Paginated list of alert logs."""
    items: list[AlertLogOut]
    total: int
    page: int
    size: int
    pages: int
```

---

## 7. File: `backend/app/api/v1/alerts.py`

### 7.1 Complete Implementation

```python
"""
User Alert Rule CRUD API.
Router prefix: /api/v1/alerts

All endpoints require authentication.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.deps import get_db, get_current_user
from backend.app.models.alert import AlertRule
from backend.app.models.stock import Stock
from backend.app.models.user import User
from backend.app.schemas.alert import (
    AlertRuleCreate,
    AlertRuleOut,
    AlertRuleListResponse,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["alerts"])


# ---------------------------------------------------------------------------
# GET /alerts — List current user's alert rules
# ---------------------------------------------------------------------------

@router.get("", response_model=AlertRuleListResponse)
async def list_my_alerts(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List alert rules for the authenticated user, with stock symbols joined."""
    # Count
    count_q = select(func.count(AlertRule.id)).where(
        AlertRule.user_id == current_user.id
    )
    total = (await db.execute(count_q)).scalar() or 0

    # Query with stock join
    rows = (await db.execute(
        select(AlertRule, Stock.symbol)
        .join(Stock, AlertRule.stock_id == Stock.id)
        .where(AlertRule.user_id == current_user.id)
        .order_by(AlertRule.created_at.desc())
        .offset((page - 1) * size)
        .limit(size)
    )).all()

    items = []
    for rule, symbol in rows:
        items.append(AlertRuleOut(
            id=rule.id,
            stock_id=rule.stock_id,
            stock_symbol=symbol,
            alert_type=rule.alert_type,
            is_active=rule.is_active,
            created_at=rule.created_at,
        ))

    return AlertRuleListResponse(
        items=items,
        total=total,
        page=page,
        size=size,
        pages=max(1, (total + size - 1) // size),
    )


# ---------------------------------------------------------------------------
# POST /alerts — Create alert rule
# ---------------------------------------------------------------------------

@router.post("", response_model=AlertRuleOut, status_code=status.HTTP_201_CREATED)
async def create_alert_rule(
    body: AlertRuleCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new alert rule. Returns 409 if duplicate exists."""

    # Check for duplicate (same user + stock + alert_type)
    existing = await db.execute(
        select(AlertRule).where(
            AlertRule.user_id == current_user.id,
            AlertRule.stock_id == body.stock_id,
            AlertRule.alert_type == body.alert_type,
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="该标的的相同类型提醒规则已存在",
        )

    # Verify stock exists
    stock = await db.get(Stock, body.stock_id)
    if stock is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"标的 ID={body.stock_id} 不存在",
        )

    rule = AlertRule(
        user_id=current_user.id,
        stock_id=body.stock_id,
        alert_type=body.alert_type,
        is_active=True,
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)

    return AlertRuleOut(
        id=rule.id,
        stock_id=rule.stock_id,
        stock_symbol=stock.symbol,
        alert_type=rule.alert_type,
        is_active=rule.is_active,
        created_at=rule.created_at,
    )


# ---------------------------------------------------------------------------
# DELETE /alerts/{id} — Delete alert rule
# ---------------------------------------------------------------------------

@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_alert_rule(
    rule_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete an alert rule. Only the owner can delete their own rules."""
    rule = await db.get(AlertRule, rule_id)
    if rule is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="提醒规则不存在",
        )

    if rule.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权删除该提醒规则",
        )

    await db.delete(rule)
    await db.commit()
```

---

## 8. File: `backend/app/api/v1/admin/alerts.py`

### 8.1 Complete Implementation

```python
"""
Admin Alert Log Listing API.
Router prefix: /api/v1/admin/alerts

All endpoints require admin role.
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.deps import get_db, get_current_admin_user
from backend.app.models.alert import AlertLog
from backend.app.models.analysis import AnalysisSignal
from backend.app.models.stock import Stock
from backend.app.models.user import User
from backend.app.schemas.alert import AlertLogOut, AlertLogListResponse

logger = logging.getLogger(__name__)
router = APIRouter(tags=["admin-alerts"])


# ---------------------------------------------------------------------------
# GET /admin/alerts — Paginated alert log listing
# ---------------------------------------------------------------------------

@router.get("", response_model=AlertLogListResponse)
async def list_alert_logs(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    user_id: Optional[int] = Query(None, description="Filter by user ID"),
    stock_id: Optional[int] = Query(None, description="Filter by stock ID"),
    status: Optional[str] = Query(None, pattern="^(sent|failed)$", description="Filter by status"),
    from_date: Optional[str] = Query(None, alias="from", description="Start date (YYYY-MM-DD)"),
    to_date: Optional[str] = Query(None, alias="to", description="End date (YYYY-MM-DD)"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin_user),
):
    """List all alert logs with pagination and optional filters (admin only)."""

    # Build count and data queries
    count_q = select(func.count(AlertLog.id))
    base_q = (
        select(
            AlertLog,
            User.email.label("user_email"),
            Stock.symbol.label("stock_symbol"),
            AnalysisSignal.signal_type.label("signal_type"),
        )
        .join(User, AlertLog.user_id == User.id)
        .join(Stock, AlertLog.stock_id == Stock.id)
        .outerjoin(AnalysisSignal, AlertLog.signal_id == AnalysisSignal.id)
    )

    # Apply filters
    if user_id is not None:
        count_q = count_q.where(AlertLog.user_id == user_id)
        base_q = base_q.where(AlertLog.user_id == user_id)
    if stock_id is not None:
        count_q = count_q.where(AlertLog.stock_id == stock_id)
        base_q = base_q.where(AlertLog.stock_id == stock_id)
    if status is not None:
        count_q = count_q.where(AlertLog.status == status)
        base_q = base_q.where(AlertLog.status == status)
    if from_date:
        count_q = count_q.where(func.date(AlertLog.sent_at) >= from_date)
        base_q = base_q.where(func.date(AlertLog.sent_at) >= from_date)
    if to_date:
        count_q = count_q.where(func.date(AlertLog.sent_at) <= to_date)
        base_q = base_q.where(func.date(AlertLog.sent_at) <= to_date)

    total = (await db.execute(count_q)).scalar() or 0

    rows = (await db.execute(
        base_q
        .order_by(AlertLog.sent_at.desc())
        .offset((page - 1) * size)
        .limit(size)
    )).all()

    items = [
        AlertLogOut(
            id=row.id,
            user_email=row.user_email,
            stock_symbol=row.stock_symbol,
            signal_type=row.signal_type,
            channel=row.channel,
            title=row.title,
            status=row.status,
            sent_at=row.sent_at,
        )
        for row in rows
    ]

    return AlertLogListResponse(
        items=items,
        total=total,
        page=page,
        size=size,
        pages=max(1, (total + size - 1) // size),
    )
```

---

## 9. File: `backend/app/api/v1/router.py` (MODIFICATION)

### 9.1 Changes Required

Add these imports and router registrations to the existing `router.py`:

```python
# NEW IMPORTS — add alongside existing imports:
from backend.app.api.v1.alerts import router as alerts_router
from backend.app.api.v1.admin.alerts import router as admin_alerts_router

# Inside create_v1_router() or wherever routers are registered, ADD:
v1_router.include_router(alerts_router, prefix="/alerts")
v1_router.include_router(admin_alerts_router, prefix="/admin/alerts")
```

### 9.2 Complete `router.py` Expected State After Modification

The router registration block should ultimately include these lines:

```python
# User endpoints (auth required)
v1_router.include_router(auth_router, prefix="/auth")
v1_router.include_router(users_router, prefix="/users")
v1_router.include_router(stocks_router, prefix="/stocks")
v1_router.include_router(analysis_router, prefix="")         # /analysis/...
v1_router.include_router(alerts_router, prefix="/alerts")     # NEW
v1_router.include_router(backtest_router, prefix="/backtest")

# Admin endpoints (admin role required)
v1_router.include_router(admin_dashboard_router, prefix="/admin")
v1_router.include_router(admin_users_router, prefix="/admin/users")
v1_router.include_router(admin_stocks_router, prefix="/admin/stocks")
v1_router.include_router(admin_strategies_router, prefix="/admin/strategies")
v1_router.include_router(admin_signals_router, prefix="/admin/signals")
v1_router.include_router(admin_backtests_router, prefix="/admin/backtests")
v1_router.include_router(admin_alerts_router, prefix="/admin/alerts")  # NEW
```

> **Note**: Exact router variable names may differ from the original `router.py`. Match the existing naming convention used in that file.

---

## 10. File: `backend/app/scheduler/jobs.py` (MODIFICATION)

### 10.1 Changes Required

The `dispatch_alerts` job function already exists as a stub in Task 06. It already imports and calls `AlertService`. Verify the import path matches:

```python
# In backend/app/scheduler/jobs.py, the dispatch_alerts function should:

async def dispatch_alerts() -> None:
    """Match alert rules for new signals and send email notifications."""
    logger.info("[JOB] dispatch_alerts starting")

    redis = await _get_redis()
    signal_ids_raw = await redis.lrange(REDIS_KEY_NEW_SIGNALS, 0, -1)

    if not signal_ids_raw:
        logger.info("[JOB] dispatch_alerts: no new signals to process")
        await redis.close()
        return

    signal_ids = [int(sid) for sid in signal_ids_raw]
    logger.info("[JOB] dispatch_alerts: processing %d signals", len(signal_ids))

    try:
        from backend.app.core.deps import get_db_context
        from backend.app.services.alert_service import AlertService  # This import MUST resolve

        async with get_db_context() as db:
            alert_service = AlertService()
            sent_count = 0
            fail_count = 0

            for sid in signal_ids:
                try:
                    count = await alert_service.match_and_send(db, sid)
                    sent_count += count
                except Exception:
                    logger.exception("[JOB] Alert dispatch failed for signal_id=%d", sid)
                    fail_count += 1

            logger.info("[JOB] dispatch_alerts complete: %d sent, %d failed",
                        sent_count, fail_count)
    except ImportError:
        logger.warning("[JOB] dispatch_alerts: AlertService not available (stub)")
    except Exception:
        logger.exception("[JOB] dispatch_alerts failed")
    finally:
        await redis.delete(REDIS_KEY_NEW_SIGNALS)
        await redis.close()
```

**No code changes required** if Task 06 already ships with this exact implementation. If the stub differs, update it to match the above.

---

## 11. Package Dependencies

### 11.1 New Python Packages

Add to `backend/requirements.txt`:

```
resend>=2.0.0
```

### 11.2 Verification

```bash
pip install resend
python -c "import resend; print('resend OK')"
```

---

## 12. Environment Variables

No new environment variables are needed. The following must already be set (from Task 01):

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RESEND_API_KEY` | Yes | — | Resend API key (starts with `re_`) |
| `EMAIL_FROM` | No | `Trend-Scope <alerts@trend-scope.com>` | Verified sender domain |

Verify in `.env`:
```bash
RESEND_API_KEY=re_xxxxxxxxxxxx
```

---

## 13. Data Flow — Full Signal-to-Email Pipeline

```
┌─────────────────────────────────────────────────────────────────────────┐
│  signal_id=42 (buy, stock_id=3, AAPL)                                   │
│                                                                          │
│  AlertService.match_rules(db, 42)                                       │
│    ├─ SELECT alert_rules WHERE stock_id=3 AND alert_type IN             │
│    │   ('buy_signal','any_signal') AND is_active=true                   │
│    ├─ JOIN users ON alert_rules.user_id = users.id                      │
│    └─ For each (rule, user):                                            │
│         SELECT alert_logs WHERE user_id=X AND stock_id=3                │
│           AND signal_id=42 AND sent_at > NOW()-24h                      │
│         ✓ Not found → include in results                                │
│         ✗ Found → skip (dedup)                                          │
│                                                                          │
│  AlertService.match_and_send(db, 42)                                    │
│    ├─ Load signal → stock → AI analysis (may be None)                  │
│    ├─ match_rules() → [(rule1, user1), (rule2, user2)]                  │
│    ├─ For each match:                                                    │
│    │   ├─ EmailService.send_signal_alert(user.email, "AAPL", signal, ai) │
│    │   │   ├─ _build_email_html(...) → HTML string                      │
│    │   │   └─ resend.Emails.send(params) → message_id                   │
│    │   └─ INSERT alert_logs (status=sent|failed, provider_message_id)   │
│    └─ await db.commit()                                                 │
│                                                                          │
│  Result: 2 emails sent, 2 alert_log rows written                        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 14. Test Specifications

All tests go in `backend/tests/test_alerts.py`. Use `pytest-asyncio` and `httpx.AsyncClient` or `TestClient` with async.

### 14.1 Fixtures Needed

```python
import pytest
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch, MagicMock

# Reuse fixtures from conftest.py:
#   - async_client (TestClient or httpx.AsyncClient)
#   - db_session (AsyncSession)
#   - auth_headers (dict with Authorization: Bearer <token> for a test user)
#   - admin_headers (dict for an admin user)
#   - test_user (User ORM instance)
#   - test_stock (Stock ORM instance, e.g. SPY with stock_id=1)

# Additional fixtures needed:
@pytest.fixture
async def test_signal(db_session, test_stock):
    """Create a test buy signal."""
    from backend.app.models.analysis import AnalysisSignal, AnalysisConfig
    # Ensure a config exists
    config = AnalysisConfig(
        stock_id=test_stock.id,
        name="Test MA Cross",
        strategy_type="ma_cross",
        params={"ma_short": 20, "ma_long": 60},
        created_by=1,
    )
    db_session.add(config)
    await db_session.commit()
    await db_session.refresh(config)

    signal = AnalysisSignal(
        stock_id=test_stock.id,
        config_id=config.id,
        signal_type="buy",
        signal_subtype="golden_cross",
        strength="strong",
        trigger_price=150.00,
        trigger_details={"config_name": "Test MA Cross"},
        triggered_date=datetime.utcnow().date(),
        is_active=True,
    )
    db_session.add(signal)
    await db_session.commit()
    await db_session.refresh(signal)
    return signal
```

### 14.2 Unit Tests

| # | Test | Description | Expected |
|---|------|-------------|----------|
| T1 | `test_create_alert_rule` | POST /alerts with valid body | 201, AlertRuleOut with correct stock_symbol |
| T2 | `test_create_duplicate_alert_rule` | POST /alerts with same (user, stock, alert_type) twice | 409, detail "该标的的相同类型提醒规则已存在" |
| T3 | `test_create_alert_rule_stock_not_found` | POST /alerts with stock_id=999999 | 404 |
| T4 | `test_list_my_alerts` | Create 2 rules for current user, 1 for another user. GET /alerts | 200, items=2 (only current user's) |
| T5 | `test_list_my_alerts_empty` | GET /alerts with no rules | 200, items=[], total=0 |
| T6 | `test_delete_alert_rule` | Create rule, DELETE /alerts/{id} | 204, then GET /alerts returns 0 items |
| T7 | `test_delete_alert_rule_not_found` | DELETE /alerts/999999 | 404 |
| T8 | `test_delete_alert_rule_wrong_user` | Create rule as user A, delete as user B | 403, "无权删除该提醒规则" |
| T9 | `test_match_rules_buy_signal` | Create buy_signal rule, match against buy signal | Returns 1 (rule, user) pair |
| T10 | `test_match_rules_sell_signal_not_matched_by_buy_rule` | Create buy_signal rule, match against sell signal | Returns 0 pairs |
| T11 | `test_match_rules_any_signal_matches_buy` | Create any_signal rule, match against buy signal | Returns 1 pair |
| T12 | `test_match_rules_any_signal_matches_sell` | Create any_signal rule, match against sell signal | Returns 1 pair |
| T13 | `test_match_rules_dedup_24h` | Alert sent 1 hour ago for same signal → match_rules | Returns 0 pairs (deduped) |
| T14 | `test_match_rules_no_dedup_after_25h` | Alert sent 25 hours ago for same signal → match_rules | Returns 1 pair (outside 24h window) |
| T15 | `test_match_rules_inactive_rule_skipped` | Rule with is_active=False | Returns 0 pairs |
| T16 | `test_match_rules_signal_not_found` | match_rules with signal_id=999999 | Returns [] |
| T17 | `test_admin_list_alert_logs` | GET /admin/alerts with 3 logs | 200, items=3, total=3 |
| T18 | `test_admin_list_alert_logs_pagination` | GET /admin/alerts?page=2&size=5 | 200, correct page/size/pages |
| T19 | `test_admin_list_alert_logs_filter_user` | GET /admin/alerts?user_id=2 | 200, only logs for that user |
| T20 | `test_admin_list_alert_logs_filter_status` | GET /admin/alerts?status=failed | 200, only failed logs |
| T21 | `test_admin_list_alert_logs_filter_dates` | GET /admin/alerts?from=2026-01-01&to=2026-06-30 | 200, only logs in range |
| T22 | `test_admin_list_alert_logs_not_admin` | GET /admin/alerts as regular user | 403 |

### 14.3 Integration / Mock Tests

| # | Test | Description | Expected |
|---|------|-------------|----------|
| I1 | `test_match_and_send_integration` | Full flow with mocked Resend. Create alert rule → call match_and_send(signal_id) | Returns sent_count=1, alert_log row created with status="sent" |
| I2 | `test_match_and_send_no_rules` | match_and_send with signal that has no matching rules | Returns 0, no alert_log rows |
| I3 | `test_match_and_send_ai_analysis_inline` | Signal has AIAnalysisResult with analysis_json. Mock Resend. | Email HTML contains AI summary text from analysis_json |
| I4 | `test_match_and_send_no_ai_analysis` | Signal has no AIAnalysisResult. Mock Resend. | Email HTML contains "AI 分析生成中" placeholder |
| I5 | `test_match_and_send_email_failure` | Mock Resend.Emails.send to raise exception | alert_log row created with status="failed", provider_message_id=None |
| I6 | `test_email_html_contains_signal_details` | Call _build_email_html with mock signal | HTML contains symbol, signal_subtype_cn, strength_cn, price |
| I7 | `test_email_html_contains_ai_summary` | Call _build_email_html with ai_analysis containing summary | HTML contains the summary text |
| I8 | `test_email_html_contains_risks_list` | Call _build_email_html with ai_analysis containing 3 risks | HTML contains 3 `<li>` risk items |
| I9 | `test_email_html_contains_stop_loss` | Call _build_email_html with ai_analysis containing stop_loss dict | HTML contains stop loss price and reasoning |
| I10 | `test_email_subject_format` | Generate email params for buy/sell signal | Subject matches `[Trend-Scope] {symbol} {'买入'|'卖出'}信号 — {date}` |
| I11 | `test_email_html_escape` | Call _escape_html with `<script>alert("xss")</script>` | Returns escaped string with `&lt;` and `&gt;` |
| I12 | `test_resend_api_key_unset` | Call send_signal_alert with RESEND_API_KEY="" | Raises RuntimeError with message about RESEND_API_KEY |

### 14.4 Mock Setup Example

```python
@pytest.mark.asyncio
async def test_match_and_send_integration(db_session, test_signal, test_user, test_stock):
    """Full pipeline test with mocked Resend."""
    from backend.app.services.alert_service import AlertService
    from backend.app.models.alert import AlertRule, AlertLog
    from sqlalchemy import select

    # Create alert rule
    rule = AlertRule(
        user_id=test_user.id,
        stock_id=test_stock.id,
        alert_type="buy_signal",
        is_active=True,
    )
    db_session.add(rule)
    await db_session.commit()

    service = AlertService()

    with patch("resend.Emails.send", return_value={"id": "msg_test_123"}):
        sent_count = await service.match_and_send(db_session, test_signal.id)

    assert sent_count == 1

    # Verify alert_log was created
    log_result = await db_session.execute(
        select(AlertLog).where(
            AlertLog.signal_id == test_signal.id,
            AlertLog.user_id == test_user.id,
        )
    )
    log_entry = log_result.scalar_one()
    assert log_entry.status == "sent"
    assert log_entry.provider_message_id == "msg_test_123"
    assert log_entry.channel == "email"
```

---

## 15. Acceptance Criteria Checklist

### 15.1 Alert Rule CRUD API

- [ ] `POST /api/v1/alerts` with valid body creates rule, returns 201 + AlertRuleOut with stock_symbol
- [ ] `POST /api/v1/alerts` with duplicate (user_id, stock_id, alert_type) returns 409
- [ ] `POST /api/v1/alerts` with nonexistent stock_id returns 404
- [ ] `GET /api/v1/alerts` returns current user's rules only, with stock symbols joined
- [ ] `GET /api/v1/alerts` supports pagination (page/size query params)
- [ ] `DELETE /api/v1/alerts/{id}` deletes rule, returns 204
- [ ] `DELETE /api/v1/alerts/{id}` on another user's rule returns 403
- [ ] `DELETE /api/v1/alerts/{id}` on nonexistent rule returns 404
- [ ] All alert endpoints return 401 when no auth token provided

### 15.2 Rule Matching Engine

- [ ] `AlertService.match_rules()` correctly filters by alert_type:
  - [ ] `buy_signal` rule matches buy signals only
  - [ ] `sell_signal` rule matches sell signals only
  - [ ] `any_signal` rule matches both buy and sell signals
- [ ] `match_rules()` excludes rules where `is_active=False`
- [ ] `match_rules()` excludes users who have an alert_log entry for the same (user_id, stock_id, signal_id) with `sent_at > NOW() - 24h`
- [ ] `match_rules()` returns empty list when signal not found
- [ ] `match_rules()` returns empty list when no rules match

### 15.3 Email Dispatch

- [ ] `EmailService.send_signal_alert()` calls `resend.Emails.send()` with correct params
- [ ] Email subject follows format: `[Trend-Scope] {symbol} {'买入'|'卖出'}信号 — {date}`
- [ ] Email from address is `Trend-Scope <alerts@trend-scope.com>`
- [ ] Email HTML contains signal details table (signal subtype, strength, trigger price)
- [ ] Email HTML contains AI analysis section when ai_analysis is provided:
  - [ ] Summary text
  - [ ] Risk list items
  - [ ] Stop loss recommendation
- [ ] Email HTML contains "AI 分析生成中" placeholder when no AI analysis available
- [ ] Email HTML contains unsubscribe footer text
- [ ] HTML escapes special characters to prevent XSS
- [ ] Resend message_id is returned from `send_signal_alert()`
- [ ] Raises RuntimeError if RESEND_API_KEY is empty

### 15.4 Alert Logging

- [ ] `AlertService.match_and_send()` creates `alert_log` entry for each matched user
- [ ] `alert_log.status` is `"sent"` when email succeeds, `"failed"` when email fails
- [ ] `alert_log.provider_message_id` is set to the Resend message_id on success
- [ ] `alert_log.alert_rule_id` references the matching rule
- [ ] `alert_log.title` and `alert_log.message` contain signal info in Chinese

### 15.5 Admin Alert Log Viewer

- [ ] `GET /api/v1/admin/alerts` returns paginated list of all alert logs
- [ ] `GET /api/v1/admin/alerts?user_id=X` filters by user
- [ ] `GET /api/v1/admin/alerts?stock_id=X` filters by stock
- [ ] `GET /api/v1/admin/alerts?status=sent` filters by status
- [ ] `GET /api/v1/admin/alerts?status=failed` filters by failed
- [ ] `GET /api/v1/admin/alerts?from=2026-01-01&to=2026-06-30` filters by date range
- [ ] Each item includes user_email, stock_symbol, signal_type (from joins)
- [ ] Admin endpoints return 403 for non-admin users

### 15.6 Scheduler Integration

- [ ] `dispatch_alerts` job in `scheduler/jobs.py` imports `AlertService` from `backend.app.services.alert_service`
- [ ] `dispatch_alerts` calls `alert_service.match_and_send(db, sid)` for each signal in Redis queue
- [ ] `dispatch_alerts` deletes `new_signals` Redis key after processing
- [ ] `dispatch_alerts` gracefully handles ImportError when AlertService is not available (stub mode)
- [ ] `dispatch_alerts` logs sent count and failed count for each signal

### 15.7 General

- [ ] All Chinese text uses proper Chinese characters (no mojibake)
- [ ] All imports use `backend.app.` prefix consistently with existing project conventions
- [ ] `resend` package added to `backend/requirements.txt`
- [ ] All tests pass with `pytest backend/tests/test_alerts.py -v`
- [ ] No new settings added to `config.py` (RESEND_API_KEY and EMAIL_FROM already exist)

---

## 16. Estimated Time

| Sub-task | Hours |
|----------|-------|
| EmailService (class + HTML template + Resend SDK) | 3h |
| AlertService (match_rules + match_and_send + dedup) | 4h |
| Pydantic schemas (alert.py) | 1h |
| User alert CRUD API (alerts.py) | 3h |
| Admin alert log API (admin/alerts.py) | 2h |
| Router registration (router.py modification) | 0.5h |
| Install resend package + verify | 0.5h |
| pytest: unit tests | 4h |
| pytest: mock Resend integration tests | 3h |
| End-to-end manual testing (real Resend send) | 1h |
| **Total** | **~22h** |

---

## 17. Troubleshooting

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| `ModuleNotFoundError: No module named 'resend'` | Package not installed | `pip install resend` |
| `resend.api_key` not set | RESEND_API_KEY empty in .env | Add `RESEND_API_KEY=re_...` to `.env` |
| Resend returns 403 | Invalid API key or domain not verified | Check Resend dashboard, verify sender domain |
| Emails go to spam | SPF/DKIM/DMARC not configured | Configure DNS records in Resend dashboard |
| `UNIQUE constraint failed: (user_id, stock_id, alert_type)` | Duplicate alert rule | The API should return 409 before this happens; if not, check the duplicate-check query |
| ImportError in dispatch_alerts | AlertService file path doesn't match import | Verify file is at `backend/app/services/alert_service.py` |
| alert_log has `signal_type=None` | LEFT JOIN on signal may be NULL | Use outerjoin correctly as shown in admin/alerts.py |

---

## 18. File Checklist Before Marking Complete

- [ ] `backend/app/services/email_service.py` created
- [ ] `backend/app/services/alert_service.py` created
- [ ] `backend/app/schemas/alert.py` created
- [ ] `backend/app/api/v1/alerts.py` created
- [ ] `backend/app/api/v1/admin/alerts.py` created
- [ ] `backend/app/api/v1/router.py` modified (alerts + admin/alerts routers registered)
- [ ] `backend/requirements.txt` modified (added `resend>=2.0.0`)
- [ ] `pip install resend` executed
- [ ] `RESEND_API_KEY` set in `.env`
- [ ] `backend/tests/test_alerts.py` created with all 22 unit + 12 integration tests
- [ ] All tests pass: `pytest backend/tests/test_alerts.py -v`
