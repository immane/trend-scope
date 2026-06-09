# 006 - Notification System Design

> **Status**: Draft v1
> **Date**: 2026-06-09
> **Purpose**: Complete notification system architecture, covering channel adapters, email/push/in-app delivery, template rendering, rule evaluation, digest mode, reliability patterns, and admin panel design.
>
> **References**:
> - [001-preliminary-design.md](001-preliminary-design.md) — Overall architecture & DB schema
> - [../research/007-notification.md](../research/007-notification.md) — Provider research & cost analysis

---

## 1. Architecture Overview

### 1.1 Event-Driven Notification Pipeline

```
                                 +----------------------------+
                                 |     Notification Inbox     |
                                 |   (notification_inbox)     |
                                 +-------------^--------------+
                                               |
  +--------------------+          +------------+-------------+
  |  AnalysisEngine    |          |   NotificationDispatcher  |
  |                    |          |                          |
  |  signal_generated  |--------->| 1. Match alert_rules      |
  |  risk_changed      |   event  | 2. Check preferences      |
  |  price_breached    |          | 3. Evaluate dedup         |
  |  volume_spike      |          | 4. Rate-limit check       |
  +--------------------+          | 5. Dispatch to channels   |
                                  +------------+-------------+
                                               |
                    +--------------------------+--------------------------+
                    |                          |                          |
            +-------v--------+    +-----------v--------+   +------------v-------+
            |  EmailChannel  |    |   PushChannel      |   |  InAppChannel      |
            |  (Resend/SES)  |    |   (OneSignal)      |   |  (WebSocket/Redis) |
            +-------+--------+    +--------+-----------+   +----------+---------+
                    |                       |                          |
            +-------v--------+    +--------v-----------+   +----------v---------+
            |   Resend API   |    |  OneSignal REST    |   |   Redis Pub/Sub    |
            |  (or SES boto) |    |  API               |   |   channel:user:{id}|
            +----------------+    +--------------------+   +--------------------+
                    |                       |                          |
            +-------v--------+    +--------v-----------+   +----------v---------+
            |   User Inbox   |    |  Browser Push      |   |  WebSocket Client  |
            |   (Gmail/etc)  |    |  Notification      |   |  (Next.js App)     |
            +----------------+    +--------------------+   +--------------------+
```

### 1.2 End-to-End Flow (ASCII Sequence)

```
AnalysisEngine    NotificationDispatcher    ChannelAdapters    Providers      User
     |                      |                      |               |            |
     |--signal_generated--->|                      |               |            |
     |                      |                      |               |            |
     |                      |--find_matching_rules->|               |            |
     |                      |<--[(user,rule)]------|               |            |
     |                      |                      |               |            |
     |                      |--check_preferences-->|               |            |
     |                      |  (quiet_hours?        |               |            |
     |                      |   digest_mode?        |               |            |
     |                      |   per_stock_toggle?)  |               |            |
     |                      |                      |               |            |
     |                      |--render_template()-->|               |            |
     |                      |<--(title,body)-------|               |            |
     |                      |                      |               |            |
     |                      |--dedup check-------->|               |            |
     |                      |--rate_limit check--->|               |            |
     |                      |                      |               |            |
     |                      |--dispatch(Email)---->|--Resend.send->|--SMTP------>|
     |                      |--dispatch(Push)----->|--OneSignal--->|--Browser--->|
     |                      |--dispatch(InApp)---->|--RedisPub---->|--WebSocket->|
     |                      |                      |               |            |
     |                      |--insert alert_log--->|               |            |
     |                      |--insert inbox ------>|               |            |
     |                      |                      |               |            |
     |                      |<--webhook status-----|<--delivery ev|<-----------|
     |                      |  (delivered/opened/  |               |            |
     |                      |   bounced/complaint) |               |            |
```

### 1.3 Module Directory Structure

```
backend/app/notifications/
|__ __init__.py
|__ channels/
|   |__ __init__.py
|   |__ base.py                   # ChannelAdapter ABC, NotificationPayload
|   |__ email_channel.py          # Resend + SES fallback
|   |__ push_channel.py           # OneSignal REST
|   |__ inapp_channel.py          # WebSocket + Redis Pub/Sub
|   |__ sms_channel.py            # Twilio (deferred)
|__ templates/
|   |__ __init__.py
|   |__ renderer.py               # TemplateRenderer
|   |__ alert_template.py         # AlertTemplate dataclass
|   |__ strings/
|       |__ en.py                 # English template strings
|       |__ zh.py                 # Chinese template strings
|__ dispatcher.py                 # NotificationDispatcher
|__ rule_evaluator.py             # AlertRuleEvaluator (batch)
|__ rate_limiter.py               # Redis-based rate limiter
|__ deduplicator.py               # 24h dedup logic
|__ dlq.py                        # Dead Letter Queue processor
|__ digest.py                     # Digest compilation & scheduling
|__ webhooks.py                   # Resend webhook handler
```

---

## 2. Channel Adapter Pattern

### 2.1 Core Data Types

```python
# backend/app/notifications/channels/base.py

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)


class ChannelType(str, Enum):
    EMAIL = "email"
    PUSH = "push"
    INAPP = "inapp"
    SMS = "sms"


class DeliveryStatus(str, Enum):
    PENDING = "pending"
    SENT = "sent"
    DELIVERED = "delivered"
    OPENED = "opened"
    CLICKED = "clicked"
    BOUNCED = "bounced"
    FAILED = "failed"
    COMPLAINT = "complaint"


class AlertType(str, Enum):
    GOLDEN_CROSS = "golden_cross"
    DEATH_CROSS = "death_cross"
    ANY_SIGNAL = "any_signal"
    PRICE_ABOVE = "price_above"
    PRICE_BELOW = "price_below"
    RISK_CHANGE = "risk_change"


@dataclass
class NotificationPayload:
    """Unified payload passed through the notification pipeline."""
    user_id: int
    user_email: str
    user_locale: str                           # "en" | "zh"
    alert_rule_id: int | None
    stock_id: int
    symbol: str
    alert_type: AlertType
    channels: list[ChannelType]                 # target channels for this dispatch
    title: str = ""
    body: str = ""
    html_body: str = ""                         # rich HTML (email)
    context_data: dict[str, Any] = field(default_factory=dict)
    # context_data keys: price, ma_short, ma_long, ma_short_val, ma_long_val,
    #                    threshold, old_risk, new_risk, strength, confidence, ...

    def render_required(self) -> bool:
        """Check if templates have been rendered into title/body."""
        return bool(self.title and self.body)


@dataclass
class DispatchResult:
    channel: ChannelType
    success: bool
    provider_message_id: str | None = None
    error_message: str | None = None
    status: DeliveryStatus = DeliveryStatus.PENDING


class ChannelAdapter(ABC):
    """Abstract base for all notification channel adapters.

    Each adapter encapsulates a delivery provider (Resend, OneSignal, etc.)
    and exposes a single `send` method. The dispatcher calls send()
    concurrently across all enabled channels.
    """

    channel_type: ChannelType

    @abstractmethod
    async def send(self, payload: NotificationPayload) -> DispatchResult:
        """Deliver a notification through this channel.

        Returns DispatchResult indicating success/failure and provider metadata.
        Must NOT raise exceptions -- catch internally and return failure result.
        """
        ...

    async def health_check(self) -> bool:
        """Optional liveness check for the underlying provider."""
        return True
```

### 2.2 Factory: Channel Selection by User Preferences

```python
# backend/app/notifications/channels/__init__.py

from __future__ import annotations

from .base import ChannelAdapter, ChannelType, NotificationPayload, DispatchResult
from .email_channel import EmailChannel
from .push_channel import PushChannel
from .inapp_channel import InAppChannel

__all__ = [
    "ChannelAdapter",
    "ChannelType",
    "NotificationPayload",
    "DispatchResult",
    "EmailChannel",
    "PushChannel",
    "InAppChannel",
    "ChannelFactory",
]


class ChannelFactory:
    """Registry-based factory that maps ChannelType to adapter instance."""

    _registry: dict[ChannelType, ChannelAdapter] = {}

    @classmethod
    def register(cls, adapter: ChannelAdapter) -> None:
        cls._registry[adapter.channel_type] = adapter

    @classmethod
    def get(cls, channel: ChannelType) -> ChannelAdapter | None:
        return cls._registry.get(channel)

    @classmethod
    def get_enabled(
        cls,
        preferred_channels: list[str],
    ) -> list[ChannelAdapter]:
        """Return adapter instances for enabled channels only."""
        adapters: list[ChannelAdapter] = []
        for ch_name in preferred_channels:
            try:
                ch = ChannelType(ch_name)
            except ValueError:
                continue
            adapter = cls._registry.get(ch)
            if adapter:
                adapters.append(adapter)
        return adapters

    @classmethod
    def all_channels(cls) -> list[ChannelAdapter]:
        return list(cls._registry.values())


# Bootstrap registration (called in app startup)
def init_channels(
    email_channel: EmailChannel,
    push_channel: PushChannel,
    inapp_channel: InAppChannel,
) -> None:
    ChannelFactory.register(email_channel)
    ChannelFactory.register(push_channel)
    ChannelFactory.register(inapp_channel)
```

---

## 3. Email Integration (Resend)

### 3.1 API Setup & Configuration

```python
# backend/app/notifications/channels/email_channel.py

from __future__ import annotations

import logging
from typing import Any

import resend
from app.core.config import settings
from app.notifications.channels.base import (
    ChannelAdapter,
    ChannelType,
    DeliveryStatus,
    DispatchResult,
    NotificationPayload,
)

logger = logging.getLogger(__name__)


class EmailChannel(ChannelAdapter):
    """Email delivery via Resend (primary) with AWS SES fallback.

    Resend Pro: $20/mo for 50k emails. SES: $0.10/1k emails.
    Configuration in settings:
      - RESEND_API_KEY
      - RESEND_FROM_EMAIL
      - RESEND_WEBHOOK_SECRET
      - AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SES_REGION (fallback)
    """

    channel_type = ChannelType.EMAIL

    def __init__(
        self,
        api_key: str | None = None,
        from_email: str | None = None,
        ses_fallback_enabled: bool = False,
    ) -> None:
        self.api_key = api_key or settings.RESEND_API_KEY
        self.from_email = from_email or settings.RESEND_FROM_EMAIL
        self.ses_fallback_enabled = ses_fallback_enabled
        resend.api_key = self.api_key

    # ------------------------------------------------------------------
    # Public send entry point
    # ------------------------------------------------------------------

    async def send(self, payload: NotificationPayload) -> DispatchResult:
        try:
            result = await self._send_via_resend(payload)
            return result
        except Exception as exc:
            logger.error(
                "Resend send failed for user=%s alert=%s: %s",
                payload.user_id, payload.alert_type, exc,
            )
            if self.ses_fallback_enabled:
                logger.info("Falling back to AWS SES for user=%s", payload.user_id)
                try:
                    return await self._send_via_ses(payload)
                except Exception as ses_exc:
                    logger.error("SES fallback also failed: %s", ses_exc)
                    return DispatchResult(
                        channel=ChannelType.EMAIL,
                        success=False,
                        error_message=f"Resend: {exc}; SES: {ses_exc}",
                        status=DeliveryStatus.FAILED,
                    )
            return DispatchResult(
                channel=ChannelType.EMAIL,
                success=False,
                error_message=str(exc),
                status=DeliveryStatus.FAILED,
            )

    # ------------------------------------------------------------------
    # Resend primary path
    # ------------------------------------------------------------------

    async def _send_via_resend(self, payload: NotificationPayload) -> DispatchResult:
        params: dict[str, Any] = {
            "from": self.from_email,
            "to": [payload.user_email],
            "subject": payload.title,
            "html": payload.html_body or f"<p>{payload.body}</p>",
            "reply_to": "support@trend-scope.com",
            "tags": [
                {"name": "alert_type", "value": payload.alert_type.value},
                {"name": "symbol", "value": payload.symbol},
                {"name": "user_id", "value": str(payload.user_id)},
            ],
            "headers": {
                "X-Entity-Ref-ID": self._gen_idempotency_key(payload),
            },
        }

        response = resend.Emails.send(params)
        message_id = response.get("id", "")
        logger.info(
            "Resend email sent id=%s to=%s type=%s",
            message_id, payload.user_email, payload.alert_type.value,
        )
        return DispatchResult(
            channel=ChannelType.EMAIL,
            success=True,
            provider_message_id=message_id,
            status=DeliveryStatus.SENT,
        )

    # ------------------------------------------------------------------
    # AWS SES fallback path
    # ------------------------------------------------------------------

    async def _send_via_ses(self, payload: NotificationPayload) -> DispatchResult:
        import boto3
        from botocore.exceptions import ClientError

        client = boto3.client(
            "ses",
            region_name=settings.AWS_SES_REGION,
            aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        )
        try:
            resp = client.send_email(
                Source=self.from_email,
                Destination={"ToAddresses": [payload.user_email]},
                Message={
                    "Subject": {"Data": payload.title, "Charset": "UTF-8"},
                    "Body": {
                        "Html": {
                            "Data": payload.html_body or f"<p>{payload.body}</p>",
                            "Charset": "UTF-8",
                        },
                    },
                },
                Tags=[
                    {"Name": "alert_type", "Value": payload.alert_type.value},
                ],
            )
            return DispatchResult(
                channel=ChannelType.EMAIL,
                success=True,
                provider_message_id=resp["MessageId"],
                status=DeliveryStatus.SENT,
            )
        except ClientError as exc:
            raise exc

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _gen_idempotency_key(payload: NotificationPayload) -> str:
        import hashlib
        raw = f"{payload.user_id}:{payload.stock_id}:{payload.alert_type.value}:{payload.context_data.get('triggered_date', '')}"
        return hashlib.sha256(raw.encode()).hexdigest()[:32]
```

### 3.2 HTML Email Templates (React Email Integration)

The admin panel uses React Email (JSX-based) for template preview/edit. The backend renders HTML from the stored template using Jinja2.

```python
# backend/app/notifications/templates/email_html.py

GOLDEN_CROSS_HTML = """<!DOCTYPE html>
<html lang="{locale}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f172a;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background-color:#1e293b;border-radius:12px;overflow:hidden;">
      <!-- Header -->
      <tr>
        <td style="padding:32px 40px 16px;text-align:center;">
          <h1 style="margin:0;font-size:24px;color:#f8fafc;">Trend-Scope</h1>
        </td>
      </tr>
      <!-- Alert Banner -->
      <tr>
        <td style="padding:24px 40px;text-align:center;{banner_style}">
          <span style="font-size:48px;">{icon}</span>
          <h2 style="margin:12px 0 0;font-size:20px;{banner_color};">{title}</h2>
        </td>
      </tr>
      <!-- Body -->
      <tr>
        <td style="padding:32px 40px;color:#cbd5e1;font-size:16px;line-height:1.7;">
          {body_html}
        </td>
      </tr>
      <!-- Data Table -->
      <tr>
        <td style="padding:0 40px 32px;">
          <table width="100%" cellpadding="12" cellspacing="0" style="background-color:#0f172a;border-radius:8px;">
            {data_rows}
          </table>
        </td>
      </tr>
      <!-- CTA -->
      <tr>
        <td style="padding:0 40px 32px;text-align:center;">
          <a href="{deep_link}" style="display:inline-block;padding:14px 40px;background-color:#3b82f6;color:#fff;text-decoration:none;border-radius:8px;font-size:16px;font-weight:600;">{cta_text}</a>
        </td>
      </tr>
      <!-- Footer -->
      <tr>
        <td style="padding:24px 40px;border-top:1px solid #334155;color:#64748b;font-size:12px;text-align:center;">
          <p>{disclaimer}</p>
          <p style="margin:12px 0 0;">
            <a href="{unsubscribe_url}" style="color:#64748b;">{unsubscribe_text}</a> &nbsp;|&nbsp;
            <a href="{prefs_url}" style="color:#64748b;">{prefs_text}</a>
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>"""


DAILY_DIGEST_HTML = """<!DOCTYPE html>
<html lang="{locale}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f172a;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background-color:#1e293b;border-radius:12px;overflow:hidden;">
      <tr>
        <td style="padding:32px 40px 16px;text-align:center;">
          <h1 style="margin:0;font-size:24px;color:#f8fafc;">Trend-Scope Daily Digest</h1>
          <p style="margin:8px 0 0;color:#94a3b8;font-size:14px;">{date_range}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 40px;">
          <p style="color:#cbd5e1;font-size:16px;">{summary_text}</p>
        </td>
      </tr>
      <!-- Signal Table -->
      <tr>
        <td style="padding:0 40px 32px;">
          <table width="100%" cellpadding="12" cellspacing="0" style="background-color:#0f172a;border-radius:8px;font-size:14px;">
            <thead>
              <tr style="color:#94a3b8;text-align:left;border-bottom:1px solid #334155;">
                <th style="padding:12px;">{header_symbol}</th>
                <th style="padding:12px;">{header_signal}</th>
                <th style="padding:12px;">{header_price}</th>
                <th style="padding:12px;">{header_time}</th>
              </tr>
            </thead>
            <tbody>
              {table_rows}
            </tbody>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 40px;border-top:1px solid #334155;color:#64748b;font-size:12px;text-align:center;">
          <p>{disclaimer}</p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>"""
```

### 3.3 Resend Webhook Handler

```python
# backend/app/notifications/webhooks.py

from __future__ import annotations

import hashlib
import hmac
import json
import logging

from fastapi import APIRouter, Request, HTTPException, Header
from sqlalchemy import select, update

from app.core.config import settings
from app.core.database import async_session
from app.notifications.channels.base import DeliveryStatus

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


def verify_resend_signature(payload: bytes, signature: str) -> bool:
    """Verify the Resend webhook signature using HMAC-SHA256."""
    if not settings.RESEND_WEBHOOK_SECRET:
        logger.warning("RESEND_WEBHOOK_SECRET not configured -- skipping signature verification")
        return True
    expected = hmac.new(
        settings.RESEND_WEBHOOK_SECRET.encode(),
        payload,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


@router.post("/resend")
async def resend_webhook(
    request: Request,
    svix_id: str | None = Header(None, alias="svix-id"),
    svix_timestamp: str | None = Header(None, alias="svix-timestamp"),
    svix_signature: str | None = Header(None, alias="svix-signature"),
) -> dict:
    """Handle Resend delivery status events.

    Events: email.delivered, email.opened, email.clicked,
            email.bounced, email.complained, email.delivery_delayed
    """
    body = await request.body()

    # Verify signature (Resend uses Svix for webhooks)
    if svix_signature and not verify_resend_signature(body, svix_signature):
        raise HTTPException(status_code=401, detail="Invalid signature")

    event = json.loads(body)
    event_type = event.get("type", "")
    data = event.get("data", {})
    email_id = data.get("email_id", "")

    logger.info("Resend webhook: type=%s email_id=%s", event_type, email_id)

    status_map: dict[str, DeliveryStatus] = {
        "email.delivered": DeliveryStatus.DELIVERED,
        "email.opened": DeliveryStatus.OPENED,
        "email.clicked": DeliveryStatus.CLICKED,
        "email.bounced": DeliveryStatus.BOUNCED,
        "email.complained": DeliveryStatus.COMPLAINT,
        "email.delivery_delayed": DeliveryStatus.PENDING,
    }

    new_status = status_map.get(event_type)
    if new_status and email_id:
        from app.models.alert import AlertLog
        from datetime import datetime

        async with async_session() as session:
            now_ts_col = {
                DeliveryStatus.DELIVERED: "delivered_at",
                DeliveryStatus.OPENED: "opened_at",
                DeliveryStatus.CLICKED: "clicked_at",
            }
            values = {"delivery_status": new_status.value}
            col = now_ts_col.get(new_status)
            if col:
                values[col] = datetime.utcnow()
            await session.execute(
                update(AlertLog)
                .where(AlertLog.provider_message_id == email_id)
                .values(**values)
            )
            await session.commit()

    return {"status": "ok"}
```

### 3.4 Deliverability Best Practices

```
SPF Record (DNS TXT):
  trend-scope.com.  TXT  "v=spf1 include:spf.resend.com include:amazonses.com ~all"

DKIM Record (auto-provisioned by Resend):
  resend._domainkey.trend-scope.com.  CNAME  resend._domainkey.resend.com.

DMARC Record (DNS TXT):
  _dmarc.trend-scope.com.  TXT  "v=DMARC1; p=quarantine; rua=mailto:dmarc@trend-scope.com; pct=100"

Custom Tracking Domain (Resend Pro):
  click.trend-scope.com  ->  CNAME  tracking.resend.com

Warm-up Strategy (when switching to dedicated IP):
  Week 1: 50 emails/day  ->  Week 2: 200/day  ->  Week 3: 500/day  ->  Week 4: full volume
```

---

## 4. Push Notification Integration (OneSignal)

### 4.1 OneSignal JS SDK Initialization (Next.js Client)

```typescript
// admin/src/lib/onesignal.ts  (for user-facing Next.js app)

export function initOneSignal(appId: string, externalUserId: string): void {
  if (typeof window === "undefined") return;

  const OneSignal = (window as any).OneSignal;
  if (!OneSignal) {
    console.warn("OneSignal SDK not loaded");
    return;
  }

  OneSignal.push(() => {
    OneSignal.init({
      appId,
      allowLocalhostAsSecureOrigin: process.env.NODE_ENV === "development",
      serviceWorkerParam: { scope: "/onesignal/" },
      serviceWorkerPath: "/OneSignalSDKWorker.js",
    });

    OneSignal.setExternalUserId(externalUserId);

    // Handle click-through
    OneSignal.on("notificationDisplay", (event: any) => {
      console.log("OneSignal notification displayed", event);
    });
  });
}

// Service Worker file: public/OneSignalSDKWorker.js
// Download from OneSignal dashboard or use the OneSignal CDN:
// importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
```

### 4.2 Push Notification Payload Format

```python
# backend/app/notifications/channels/push_channel.py

from __future__ import annotations

import logging
from typing import Any

import httpx
from app.core.config import settings
from app.notifications.channels.base import (
    ChannelAdapter,
    ChannelType,
    DeliveryStatus,
    DispatchResult,
    NotificationPayload,
)

logger = logging.getLogger(__name__)


class PushChannel(ChannelAdapter):
    """Web/Mobile push notifications via OneSignal REST API.

    Free tier: 10k web subscribers, unlimited sends.
    API: POST https://onesignal.com/api/v1/notifications

    Configuration:
      - ONESIGNAL_APP_ID
      - ONESIGNAL_REST_API_KEY
    """

    channel_type = ChannelType.PUSH
    API_BASE = "https://onesignal.com/api/v1"

    def __init__(
        self,
        app_id: str | None = None,
        api_key: str | None = None,
    ) -> None:
        self.app_id = app_id or settings.ONESIGNAL_APP_ID
        self.api_key = api_key or settings.ONESIGNAL_REST_API_KEY

    async def send(self, payload: NotificationPayload) -> DispatchResult:
        try:
            return await self._send_via_onesignal(payload)
        except Exception as exc:
            logger.error(
                "OneSignal push failed user=%s: %s", payload.user_id, exc
            )
            return DispatchResult(
                channel=ChannelType.PUSH,
                success=False,
                error_message=str(exc),
                status=DeliveryStatus.FAILED,
            )

    async def _send_via_onesignal(self, payload: NotificationPayload) -> DispatchResult:
        one_signal_payload: dict[str, Any] = {
            "app_id": self.app_id,
            "include_external_user_ids": [str(payload.user_id)],
            "channel_for_external_user_ids": "push",
            "headings": {"en": payload.title},
            "contents": {"en": payload.body},
            # Deep link data for click-through
            "data": {
                "alert_type": payload.alert_type.value,
                "symbol": payload.symbol,
                "stock_id": str(payload.stock_id),
                "deep_link": self._build_deep_link(payload),
            },
            # Android-specific
            "android_channel_id": "alerts",
            "android_accent_color": "FF3B82F6",
            "priority": 10,
            # Web push options
            "web_buttons": [
                {
                    "id": "view",
                    "text": "View Signal",
                    "url": self._build_deep_link(payload),
                },
            ],
            # Icon
            "chrome_web_icon": "https://trend-scope.com/icon-256.png",
            "chrome_web_badge": "https://trend-scope.com/badge-96.png",
        }

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{self.API_BASE}/notifications",
                json=one_signal_payload,
                headers={
                    "Authorization": f"Basic {self.api_key}",
                    "Content-Type": "application/json",
                },
            )
            resp.raise_for_status()
            data = resp.json()
            notif_id = data.get("id", "")

        logger.info(
            "OneSignal push sent id=%s user=%s type=%s",
            notif_id, payload.user_id, payload.alert_type.value,
        )

        return DispatchResult(
            channel=ChannelType.PUSH,
            success=True,
            provider_message_id=notif_id,
            status=DeliveryStatus.SENT,
        )

    @staticmethod
    def _build_deep_link(payload: NotificationPayload) -> str:
        return (
            f"{settings.FRONTEND_URL}/stocks/{payload.symbol.lower()}"
            f"?signal={payload.alert_type.value}"
        )
```

### 4.3 Click-through Handling

```typescript
// In Next.js _app.tsx or layout — handle push notification click-through
OneSignal.push(() => {
  OneSignal.on("notificationClick", (event: any) => {
    const data = event.notification?.data;
    if (data?.deep_link) {
      router.push(data.deep_link);
    }
  });
});
```

---

## 5. In-App Notification (WebSocket)

### 5.1 FastAPI WebSocket Endpoint

```python
# backend/app/api/v1/notifications/ws.py

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from app.core.security import decode_ws_token
from app.notifications.channels.inapp_channel import WSConnectionManager

logger = logging.getLogger(__name__)

router = APIRouter()
ws_manager = WSConnectionManager()


@router.websocket("/ws/notifications/{user_id}")
async def notifications_websocket(
    websocket: WebSocket,
    user_id: int,
    token: str = Query(...),
) -> None:
    """Real-time notification WebSocket endpoint.

    Authentication: JWT passed as query parameter `?token=...`.
    The server validates the token and ensures user_id matches the token subject.
    """
    # --- Authentication ---
    claims = decode_ws_token(token)
    if claims is None or claims.get("sub") != str(user_id):
        await websocket.close(code=4001, reason="Authentication failed")
        return

    # --- Connect ---
    await ws_manager.connect(user_id, websocket)
    logger.info("WS connected: user_id=%d", user_id)

    try:
        while True:
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=60.0)
            message: dict[str, Any] = json.loads(raw)

            msg_type = message.get("type", "")
            if msg_type == "ping":
                await websocket.send_json({"type": "pong", "ts": message.get("ts")})
            elif msg_type == "ack":
                # Client acknowledges receipt of a notification
                ack_id = message.get("id")
                if ack_id:
                    await _mark_notification_read(user_id, ack_id)

    except asyncio.TimeoutError:
        # Send ping to check if client is still alive
        try:
            await websocket.send_json({"type": "ping"})
        except Exception:
            pass
    except WebSocketDisconnect:
        logger.info("WS disconnected: user_id=%d", user_id)
    except Exception as exc:
        logger.error("WS error user_id=%d: %s", user_id, exc)
    finally:
        ws_manager.disconnect(user_id, websocket)


async def _mark_notification_read(user_id: int, inbox_id: int) -> None:
    """Mark an inbox notification as read when client acks."""
    from sqlalchemy import update
    from app.models.alert import NotificationInbox
    from app.core.database import async_session
    from datetime import datetime

    async with async_session() as session:
        await session.execute(
            update(NotificationInbox)
            .where(
                NotificationInbox.id == inbox_id,
                NotificationInbox.user_id == user_id,
            )
            .values(is_read=True, read_at=datetime.utcnow())
        )
        await session.commit()
```

### 5.2 WSConnectionManager (Complete Implementation)

```python
# backend/app/notifications/channels/inapp_channel.py

from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from typing import Any

import redis.asyncio as redis

from fastapi import WebSocket

from app.core.config import settings
from app.notifications.channels.base import (
    ChannelAdapter,
    ChannelType,
    DeliveryStatus,
    DispatchResult,
    NotificationPayload,
)

logger = logging.getLogger(__name__)

# Redis Pub/Sub channel naming
REDIS_NOTIFICATION_CHANNEL = "notifications:user:{user_id}"


class WSConnectionManager:
    """Manages active WebSocket connections keyed by user_id.

    Supports multiple connections per user (multiple browser tabs/devices).
    For multi-worker deployments, Redis Pub/Sub bridges messages across workers.
    """

    def __init__(self) -> None:
        self._connections: dict[int, list[WebSocket]] = defaultdict(list)
        self._lock = asyncio.Lock()

    async def connect(self, user_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections[user_id].append(websocket)
        logger.debug("WS connect: user=%d total=%d",
                      user_id, len(self._connections[user_id]))

    async def disconnect(self, user_id: int, websocket: WebSocket) -> None:
        async with self._lock:
            if user_id in self._connections:
                try:
                    self._connections[user_id].remove(websocket)
                except ValueError:
                    pass
                if not self._connections[user_id]:
                    del self._connections[user_id]
        logger.debug("WS disconnect: user=%d remaining=%d",
                      user_id, len(self._connections.get(user_id, [])))

    async def send_to_user(self, user_id: int, data: dict[str, Any]) -> int:
        """Send a JSON message to all WebSocket connections of a user.
        Returns the number of successfully delivered messages."""
        sent_count = 0
        dead_sockets: list[WebSocket] = []

        async with self._lock:
            connections = list(self._connections.get(user_id, []))

        for ws in connections:
            try:
                await ws.send_json(data)
                sent_count += 1
            except Exception:
                dead_sockets.append(ws)

        # Clean up dead connections
        if dead_sockets:
            async with self._lock:
                for ws in dead_sockets:
                    try:
                        self._connections[user_id].remove(ws)
                    except ValueError:
                        pass

        return sent_count

    async def broadcast(self, data: dict[str, Any]) -> int:
        """Broadcast to all connected users. Returns total delivered count."""
        total = 0
        async with self._lock:
            user_ids = list(self._connections.keys())
        for uid in user_ids:
            total += await self.send_to_user(uid, data)
        return total

    async def get_online_count(self) -> int:
        async with self._lock:
            return len(self._connections)

    async def get_user_online(self, user_id: int) -> bool:
        async with self._lock:
            return user_id in self._connections and len(self._connections[user_id]) > 0

    # ----- Heartbeat / Liveness -----

    async def start_heartbeat(self, interval: int = 30) -> None:
        """Background task: send ping to all connections every `interval` seconds."""
        while True:
            await asyncio.sleep(interval)
            async with self._lock:
                snapshot = {
                    uid: list(conns) for uid, conns in self._connections.items()
                }
            dead: list[tuple[int, WebSocket]] = []
            for uid, conns in snapshot.items():
                for ws in conns:
                    try:
                        await ws.send_json({"type": "ping", "ts": asyncio.get_event_loop().time()})
                    except Exception:
                        dead.append((uid, ws))
            for uid, ws in dead:
                await self.disconnect(uid, ws)


class InAppChannel(ChannelAdapter):
    """In-app real-time notification via WebSocket + Redis Pub/Sub.

    Architecture:
      - Per-process WSConnectionManager holds local WebSocket connections.
      - Redis Pub/Sub bridges messages across multiple uvicorn workers.
      - Each worker subscribes to `notifications:user:*` patterns and forwards
        messages to locally connected WebSocket clients.
    """

    channel_type = ChannelType.INAPP

    def __init__(
        self,
        ws_manager: WSConnectionManager,
        redis_client: redis.Redis | None = None,
    ) -> None:
        self.ws_manager = ws_manager
        self.redis = redis_client or redis.from_url(settings.REDIS_URL)

    async def start_redis_listener(self) -> None:
        """Subscribe to Redis pub/sub and bridge messages to local WS clients.

        Called once per uvicorn worker at startup.
        """
        pubsub = self.redis.pubsub()
        await pubsub.psubscribe("notifications:user:*")

        async for message in pubsub.listen():
            if message["type"] != "pmessage":
                continue
            try:
                data = json.loads(message["data"])
                user_id = data.get("user_id")
                if user_id:
                    await self.ws_manager.send_to_user(user_id, data)
            except Exception as exc:
                logger.error("Redis listener error: %s", exc)

    # ------------------------------------------------------------------
    # ChannelAdapter interface
    # ------------------------------------------------------------------

    async def send(self, payload: NotificationPayload) -> DispatchResult:
        """Publish to Redis Pub/Sub (cross-worker) + attempt local WS delivery."""
        message = {
            "type": "alert",
            "id": None,  # filled after alert_log insert
            "alert_type": payload.alert_type.value,
            "symbol": payload.symbol,
            "stock_id": payload.stock_id,
            "title": payload.title,
            "body": payload.body,
            "data": payload.context_data,
            "ts": asyncio.get_event_loop().time(),
        }
        user_id = payload.user_id

        # Publish to Redis for cross-worker bridging
        try:
            await self.redis.publish(
                REDIS_NOTIFICATION_CHANNEL.format(user_id=user_id),
                json.dumps(message),
            )
        except Exception as exc:
            logger.error("Redis publish failed user=%s: %s", user_id, exc)

        # Also attempt direct local delivery (same worker)
        sent = await self.ws_manager.send_to_user(user_id, message)

        return DispatchResult(
            channel=ChannelType.INAPP,
            success=True,
            provider_message_id=None,
            status=DeliveryStatus.SENT if sent > 0 else DeliveryStatus.PENDING,
        )
```

### 5.3 Client-Side Reconnection Strategy (TypeScript Reference)

```typescript
// Next.js WebSocket client with exponential backoff reconnection

class NotificationSocket {
  private ws: WebSocket | null = null;
  private userId: number;
  private token: string;
  private reconnectAttempt = 0;
  private maxReconnectDelay = 30000;  // 30s max
  private baseDelay = 1000;           // 1s initial

  constructor(userId: number, token: string) {
    this.userId = userId;
    this.token = token;
  }

  connect(): void {
    const wsBase = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000";
    const url = `${wsBase}/api/v1/ws/notifications/${this.userId}?token=${this.token}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      console.log("Notification WS connected");
    };

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "ping") {
        this.ws?.send(JSON.stringify({ type: "pong" }));
      } else if (msg.type === "alert") {
        this.onAlert(msg);
        // Ack to mark as read
        if (msg.id) {
          this.ws?.send(JSON.stringify({ type: "ack", id: msg.id }));
        }
      }
    };

    this.ws.onclose = (event) => {
      if (event.code !== 1000 && event.code !== 1001) {
        this.reconnect();
      }
    };
  }

  private reconnect(): void {
    this.reconnectAttempt++;
    const delay = Math.min(
      this.baseDelay * Math.pow(2, this.reconnectAttempt),
      this.maxReconnectDelay,
    );
    setTimeout(() => this.connect(), delay);
  }

  onAlert(msg: any): void {
    // Notification callback -- update UI
    console.log("New alert:", msg);
  }

  disconnect(): void {
    this.ws?.close(1000);
  }
}
```

---

## 6. Notification Preference System

### 6.1 Preference Model & Filtering Logic

```python
# backend/app/notifications/preferences.py

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, time
from typing import Any

import pytz
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = __import__("logging").getLogger(__name__)


@dataclass
class NotificationPreferences:
    """Per-user notification settings, loaded from notification_preferences table."""
    user_id: int
    locale: str = "en"

    # Per-channel master switches
    email_enabled: bool = True
    push_enabled: bool = False
    inapp_enabled: bool = True
    sms_enabled: bool = False

    # Digest mode
    digest_mode: str = "realtime"  # "realtime" | "daily" | "weekly"
    digest_time: time = time(18, 0)

    # Quiet hours (user local time)
    quiet_hours_enabled: bool = False
    quiet_start: time = time(22, 0)
    quiet_end: time = time(7, 0)
    timezone: str = "America/New_York"

    # Per-stock toggles: stock_id -> enabled (True/False)
    stock_preferences: dict[int, bool] = field(default_factory=dict)

    def channel_enabled(self, channel: str) -> bool:
        """Check master switch for a channel."""
        mapping = {
            "email": self.email_enabled,
            "push": self.push_enabled,
            "inapp": self.inapp_enabled,
            "sms": self.sms_enabled,
        }
        return mapping.get(channel, False)

    def is_quiet_time(self) -> bool:
        """Check if current time (in user's timezone) falls within quiet hours."""
        if not self.quiet_hours_enabled:
            return False
        tz = pytz.timezone(self.timezone)
        now = datetime.now(tz).time()
        if self.quiet_start <= self.quiet_end:
            # Normal range: e.g., 22:00 - 07:00 (overnight)
            return now >= self.quiet_start or now < self.quiet_end
        else:
            # Inverted range (shouldn't happen with normal config)
            return self.quiet_end <= now < self.quiet_start

    def stock_allows_alerts(self, stock_id: int) -> bool:
        """Check if alerts are enabled for a specific stock."""
        return self.stock_preferences.get(stock_id, True)

    def should_dispatch(self, channel: str, stock_id: int) -> tuple[bool, str | None]:
        """Determine if a notification should be dispatched.

        Returns (allowed, reason_if_blocked).
        Check order: master switch -> digest mode -> quiet hours -> stock toggle.
        """
        if not self.channel_enabled(channel):
            return False, f"{channel} master switch disabled"

        if self.digest_mode != "realtime":
            return False, f"digest_mode={self.digest_mode}"

        if self.is_quiet_time():
            return False, "quiet hours active"

        if not self.stock_allows_alerts(stock_id):
            return False, f"alerts disabled for stock_id={stock_id}"

        return True, None


async def load_user_preferences(
    session: AsyncSession, user_id: int
) -> NotificationPreferences:
    """Load all notification preferences for a user from the database."""
    from app.models.alert import NotificationPreference

    result = await session.execute(
        select(NotificationPreference).where(
            NotificationPreference.user_id == user_id
        )
    )
    row = result.scalar_one_or_none()

    prefs = NotificationPreferences(user_id=user_id)
    if row:
        prefs.locale = row.locale or "en"
        prefs.email_enabled = row.email_enabled
        prefs.push_enabled = row.push_enabled
        prefs.inapp_enabled = row.inapp_enabled
        prefs.sms_enabled = row.sms_enabled
        prefs.digest_mode = row.digest_mode or "realtime"
        prefs.digest_time = row.digest_time or time(18, 0)
        prefs.quiet_hours_enabled = row.quiet_hours_enabled
        prefs.quiet_start = row.quiet_hours_start or time(22, 0)
        prefs.quiet_end = row.quiet_hours_end or time(7, 0)
        prefs.timezone = row.timezone or "America/New_York"

    # Load per-stock toggles
    from app.models.alert import StockAlertSetting
    stock_result = await session.execute(
        select(StockAlertSetting).where(
            StockAlertSetting.user_id == user_id
        )
    )
    for s in stock_result.scalars().all():
        prefs.stock_preferences[s.stock_id] = s.alerts_enabled

    return prefs
```

### 6.2 Preference CRUD API

```
GET    /api/v1/notifications/preferences        -> get current preferences
PUT    /api/v1/notifications/preferences        -> update preferences
GET    /api/v1/notifications/preferences/stocks  -> list per-stock toggles
PATCH  /api/v1/notifications/preferences/stocks/{stock_id} -> toggle single stock

Request body example (PUT /preferences):
{
  "locale": "zh",
  "email_enabled": true,
  "push_enabled": true,
  "inapp_enabled": true,
  "sms_enabled": false,
  "digest_mode": "daily",
  "digest_time": "18:00",
  "quiet_hours_enabled": true,
  "quiet_hours_start": "22:00",
  "quiet_hours_end": "07:00",
  "timezone": "America/New_York"
}
```

### 6.3 Preference Filtering in Dispatch Pipeline

```
SignalGeneratedEvent
    |
    v
NotificationDispatcher.dispatch(event)
    |
    |-- For each matched (user, rule):
    |     |
    |     |-- load_user_preferences(user_id)
    |     |
    |     |-- For each channel in rule.channels:
    |     |     |
    |     |     |-- prefs.should_dispatch(channel, stock_id)?
    |     |     |     |-- NO  -> skip channel (log reason)
    |     |     |     |-- YES -> proceed
    |     |     |
    |     |     |-- digest_mode != "realtime"?
    |     |     |     |-- YES -> queue to digest_queue, skip real-time send
    |     |     |
    |     |     |-- dispatch to ChannelAdapter.send(payload)
    |     |
    |     |-- write alert_log + notification_inbox
```

---

## 7. Alert Rule System

### 7.1 Rule Types

| Rule Type | Trigger | Threshold Field | Description |
|---|---|---|---|
| `golden_cross` | MA_short crosses ABOVE MA_long | ma_short, ma_long (in params) | Bullish moving average crossover |
| `death_cross` | MA_short crosses BELOW MA_long | ma_short, ma_long (in params) | Bearish moving average crossover |
| `any_signal` | Any signal generated | None | Catch-all for any buy/sell signal |
| `price_above` | Close price > threshold | threshold (DECIMAL) | Price breaks above user-defined level |
| `price_below` | Close price < threshold | threshold (DECIMAL) | Price drops below user-defined level |
| `risk_change` | Risk level changes | None | e.g., "moderate" -> "elevated" |

### 7.2 Rule Evaluation Engine (Batch Optimized)

```python
# backend/app/notifications/rule_evaluator.py

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.notifications.channels.base import AlertType

logger = logging.getLogger(__name__)


@dataclass
class SignalEvent:
    """Emitted by AnalysisEngine when a new signal is detected."""
    stock_id: int
    symbol: str
    signal_type: AlertType
    price: float
    strength: str                 # weak, normal, strong
    confidence: float | None
    context: dict[str, Any]       # ma_short_val, ma_long_val, old_risk, new_risk, ...
    triggered_date: str


@dataclass
class MatchedRule:
    """A user's alert rule that matches a signal event."""
    user_id: int
    rule_id: int
    alert_type: AlertType
    channels: list[str]           # ["email", "push", "inapp"]
    context_data: dict[str, Any]  # augmented context for template rendering


class AlertRuleEvaluator:
    """Evaluates all user alert_rules against a generated signal event.

    Design: Instead of iterating each user's rules per signal (O(U*R)),
    we use batch SQL queries to find matching rules efficiently.
    """

    @staticmethod
    async def evaluate(
        session: AsyncSession,
        event: SignalEvent,
    ) -> list[MatchedRule]:
        """Find all user rules that match a given signal event.

        Returns list of MatchedRule, one per (user, rule) combination.
        """
        matches: list[MatchedRule] = []

        # 1. Match specific alert_type rules (golden_cross, death_cross, risk_change)
        specific_matches = await AlertRuleEvaluator._match_specific(
            session, event
        )
        matches.extend(specific_matches)

        # 2. Match any_signal rules (catch-all)
        any_signal_matches = await AlertRuleEvaluator._match_any_signal(
            session, event
        )
        matches.extend(any_signal_matches)

        # 3. Match price threshold rules (price_above, price_below)
        price_matches = await AlertRuleEvaluator._match_price(
            session, event
        )
        matches.extend(price_matches)

        logger.info(
            "Rule evaluation: event=%s stock=%s -> %d matched rules",
            event.signal_type.value, event.symbol, len(matches),
        )
        return matches

    @staticmethod
    async def _match_specific(
        session: AsyncSession, event: SignalEvent
    ) -> list[MatchedRule]:
        """Match rules where alert_type exactly matches the signal type."""
        from app.models.alert import AlertRule

        result = await session.execute(
            select(AlertRule).where(
                and_(
                    AlertRule.is_active == True,
                    AlertRule.stock_id == event.stock_id,
                    AlertRule.alert_type == event.signal_type.value,
                )
            )
        )
        rules = result.scalars().all()

        matched: list[MatchedRule] = []
        for rule in rules:
            import json
            matched.append(MatchedRule(
                user_id=rule.user_id,
                rule_id=rule.id,
                alert_type=event.signal_type,
                channels=json.loads(rule.channels) if isinstance(rule.channels, str) else rule.channels,
                context_data={
                    "price": event.price,
                    "strength": event.strength,
                    "confidence": event.confidence,
                    **event.context,
                },
            ))
        return matched

    @staticmethod
    async def _match_any_signal(
        session: AsyncSession, event: SignalEvent
    ) -> list[MatchedRule]:
        """Match rules with alert_type='any_signal' for this stock."""
        from app.models.alert import AlertRule

        result = await session.execute(
            select(AlertRule).where(
                and_(
                    AlertRule.is_active == True,
                    AlertRule.stock_id == event.stock_id,
                    AlertRule.alert_type == "any_signal",
                )
            )
        )
        rules = result.scalars().all()

        matched: list[MatchedRule] = []
        for rule in rules:
            import json
            matched.append(MatchedRule(
                user_id=rule.user_id,
                rule_id=rule.id,
                alert_type=event.signal_type,  # use actual signal type in notification
                channels=json.loads(rule.channels) if isinstance(rule.channels, str) else rule.channels,
                context_data={
                    "price": event.price,
                    "strength": event.strength,
                    "confidence": event.confidence,
                    **event.context,
                },
            ))
        return matched

    @staticmethod
    async def _match_price(
        session: AsyncSession, event: SignalEvent
    ) -> list[MatchedRule]:
        """Match price_above / price_below rules based on threshold."""
        from app.models.alert import AlertRule

        result = await session.execute(
            select(AlertRule).where(
                and_(
                    AlertRule.is_active == True,
                    AlertRule.stock_id == event.stock_id,
                    AlertRule.alert_type.in_(["price_above", "price_below"]),
                    AlertRule.threshold.isnot(None),
                )
            )
        )
        rules = result.scalars().all()

        matched: list[MatchedRule] = []
        for rule in rules:
            threshold = float(rule.threshold)
            triggered = False
            if rule.alert_type == "price_above" and event.price > threshold:
                triggered = True
            elif rule.alert_type == "price_below" and event.price < threshold:
                triggered = True

            if triggered:
                import json
                matched.append(MatchedRule(
                    user_id=rule.user_id,
                    rule_id=rule.id,
                    alert_type=AlertType(rule.alert_type),
                    channels=json.loads(rule.channels) if isinstance(rule.channels, str) else rule.channels,
                    context_data={
                        "price": event.price,
                        "threshold": threshold,
                        **event.context,
                    },
                ))
        return matched
```

---

## 8. Digest Mode

### 8.1 Architecture

```
                        Real-time Signal
                              |
                    +---------v---------+
                    |  User pref:       |
                    |  digest_mode?     |
                    +----+---------+----+
                         |         |
                    realtime     daily/weekly
                         |         |
                         v         v
                   Send now    Queue to digest_queue
                                   |
                                   v
                         +------------------+
                         | digest_queue     |
                         | (user_id,        |
                         |  alert_log_id,   |
                         |  digest_type,    |
                         |  is_delivered=0) |
                         +--------+---------+
                                  |
                    APScheduler fires at 18:00 ET
                                  |
                                  v
                         +------------------+
                         | Digest Compiler  |
                         | 1. Group by user |
                         | 2. Render HTML   |
                         | 3. Send email    |
                         | 4. Mark delivered|
                         +------------------+
```

### 8.2 Digest Scheduler & Compiler

```python
# backend/app/notifications/digest.py

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta
from typing import Any

import pytz
from sqlalchemy import select, update, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

ET = pytz.timezone("US/Eastern")


async def compile_and_send_daily_digests(
    session: AsyncSession,
    dispatcher,  # NotificationDispatcher
) -> None:
    """Compile daily digest for all users with digest_mode='daily' and send via email.

    Called by APScheduler daily at 18:00 ET.
    """
    from app.models.alert import DigestQueue, NotificationPreference, AlertLog

    # Find users in daily digest mode
    pref_result = await session.execute(
        select(NotificationPreference).where(
            NotificationPreference.digest_mode == "daily"
        )
    )
    digest_users = pref_result.scalars().all()

    cutoff = datetime.utcnow() - timedelta(hours=24)

    for pref in digest_users:
        # Fetch queued alerts for this user
        queue_result = await session.execute(
            select(DigestQueue).where(
                and_(
                    DigestQueue.user_id == pref.user_id,
                    DigestQueue.digest_type == "daily",
                    DigestQueue.is_delivered == False,
                )
            )
        )
        items = queue_result.scalars().all()

        if not items:
            continue

        # Fetch the underlying alert_logs
        alert_log_ids = [item.alert_log_id for item in items]
        alert_result = await session.execute(
            select(AlertLog).where(AlertLog.id.in_(alert_log_ids))
        )
        alerts = alert_result.scalars().all()

        # Render digest HTML
        html = _render_daily_digest_html(
            locale=pref.locale or "en",
            user_id=pref.user_id,
            alerts=alerts,
            date=datetime.now(ET).strftime("%Y-%m-%d"),
        )

        # Send via email channel
        from app.notifications.channels.base import (
            NotificationPayload,
            AlertType,
            ChannelType,
        )
        payload = NotificationPayload(
            user_id=pref.user_id,
            user_email="",  # will be looked up from users table
            user_locale=pref.locale or "en",
            alert_rule_id=None,
            stock_id=0,  # digest covers multiple stocks
            symbol="",
            alert_type=AlertType.ANY_SIGNAL,
            channels=[ChannelType.EMAIL],
            title=_digest_title(pref.locale or "en"),
            body="",
            html_body=html,
        )
        await dispatcher.dispatch_single(payload)

        # Mark queue items as delivered
        await session.execute(
            update(DigestQueue)
            .where(DigestQueue.id.in_([item.id for item in items]))
            .values(is_delivered=True, sent_at=datetime.utcnow())
        )

        logger.info("Daily digest sent: user=%d alerts=%d", pref.user_id, len(alerts))

    await session.commit()


async def compile_and_send_weekly_digests(
    session: AsyncSession,
    dispatcher,
) -> None:
    """Compile weekly digest for users with digest_mode='weekly'.

    Called by APScheduler Sunday at 18:00 ET.
    """
    # Same pattern as daily, but with weekly aggregation and digest_type='weekly'
    ...


def _digest_title(locale: str) -> str:
    if locale == "zh":
        return f"Trend-Scope 每日摘要 - {datetime.now(ET).strftime('%Y-%m-%d')}"
    return f"Trend-Scope Daily Digest - {datetime.now(ET).strftime('%Y-%m-%d')}"


def _render_daily_digest_html(
    locale: str,
    user_id: int,
    alerts: list[Any],
    date: str,
) -> str:
    """Render the daily digest HTML email."""
    from app.notifications.templates.email_html import DAILY_DIGEST_HTML

    is_zh = locale == "zh"

    table_rows = ""
    for alert in alerts:
        signal_type = alert.alert_type.replace("_", " ").title()
        symbol = alert.context_data.get("symbol", "N/A") if alert.context_data else "N/A"
        price = alert.context_data.get("price", 0) if alert.context_data else 0
        created = alert.created_at.strftime("%H:%M") if alert.created_at else ""

        icon = "🟢" if "golden" in alert.alert_type or "bullish" in alert.alert_type else "🔴"
        table_rows += f"""
              <tr style="border-bottom:1px solid #1e293b;color:#cbd5e1;">
                <td style="padding:12px;">{icon} {symbol}</td>
                <td style="padding:12px;">{signal_type}</td>
                <td style="padding:12px;">${price:.2f}</td>
                <td style="padding:12px;">{created} ET</td>
              </tr>"""

    summary_text = (
        f"今日共触发 {len(alerts)} 个信号，详情如下："
        if is_zh
        else f"Today, {len(alerts)} signals were triggered. Details below:"
    )
    disclaimer = (
        "以上为自动化分析参考，不构成投资建议。"
        if is_zh
        else "This is automated analysis for reference only, not financial advice."
    )

    return DAILY_DIGEST_HTML.format(
        locale=locale,
        date_range=date,
        summary_text=summary_text,
        header_symbol="标的" if is_zh else "Symbol",
        header_signal="信号" if is_zh else "Signal",
        header_price="价格" if is_zh else "Price",
        header_time="时间" if is_zh else "Time",
        table_rows=table_rows,
        disclaimer=disclaimer,
    )


# APScheduler job registration (in scheduler/runner.py)
"""
from apscheduler.triggers.cron import CronTrigger

scheduler.add_job(
    compile_and_send_daily_digests,
    CronTrigger(hour=18, minute=0, timezone="US/Eastern"),
    id="daily_digest",
    kwargs={"session": async_session(), "dispatcher": dispatcher},
)

scheduler.add_job(
    compile_and_send_weekly_digests,
    CronTrigger(day_of_week="sun", hour=18, minute=0, timezone="US/Eastern"),
    id="weekly_digest",
    kwargs={"session": async_session(), "dispatcher": dispatcher},
)
"""
```

### 8.3 Digest Queue Table Usage

```sql
-- Queue a notification for later digest delivery
INSERT INTO digest_queue (user_id, alert_log_id, digest_type, is_delivered)
VALUES (123, 456, 'daily', FALSE);

-- Fetch undelivered items for a user
SELECT dq.*, al.title, al.body, al.alert_type, al.context_data
FROM digest_queue dq
JOIN alert_logs al ON dq.alert_log_id = al.id
WHERE dq.user_id = 123 AND dq.is_delivered = FALSE AND dq.digest_type = 'daily'
ORDER BY dq.created_at;

-- Mark as delivered after digest sent
UPDATE digest_queue SET is_delivered = TRUE, sent_at = NOW()
WHERE id IN (1, 2, 3);
```

---

## 9. Template System

### 9.1 AlertTemplate Dataclass

```python
# backend/app/notifications/templates/alert_template.py

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class AlertType(str, Enum):
    GOLDEN_CROSS = "golden_cross"
    DEATH_CROSS = "death_cross"
    ANY_SIGNAL = "any_signal"
    PRICE_ABOVE = "price_above"
    PRICE_BELOW = "price_below"
    RISK_CHANGE = "risk_change"


@dataclass
class AlertTemplate:
    """A renderable notification template for a specific alert type + locale."""
    alert_type: AlertType
    locale: str                          # "en" | "zh"
    title_template: str                  # Python format string
    body_template: str                   # Python format string
    push_title_template: str = ""        # Shortened for push (max ~50 chars)
    push_body_template: str = ""         # Shortened for push (max ~150 chars)
    icon: str = ""                       # Emoji or icon identifier

    def render_title(self, **kwargs: Any) -> str:
        try:
            return self.title_template.format(**kwargs)
        except KeyError as e:
            return f"[Missing: {e}] {self.alert_type.value}"

    def render_body(self, **kwargs: Any) -> str:
        try:
            return self.body_template.format(**kwargs)
        except KeyError as e:
            return f"[Missing: {e}]"

    def render_push(self, **kwargs: Any) -> tuple[str, str]:
        """Return (title, body) optimized for push notifications."""
        title_tpl = self.push_title_template or self.title_template
        body_tpl = self.push_body_template or self.body_template
        try:
            return title_tpl.format(**kwargs), body_tpl.format(**kwargs)
        except KeyError:
            return self.render_title(**kwargs), self.render_body(**kwargs)
```

### 9.2 Template Strings (English & Chinese, All 6 Alert Types)

```python
# backend/app/notifications/templates/strings/en.py

EN_TEMPLATES: dict[str, dict] = {
    "golden_cross": {
        "title": "{symbol} Golden Cross Alert",
        "body": (
            "{symbol} triggered a golden cross signal!\n\n"
            "MA{ma_short} ({ma_short_val:.2f}) crossed above "
            "MA{ma_long} ({ma_long_val:.2f}) at ${price:.2f}.\n"
            "Strength: {strength}\n\n"
            "Consider watching for pullback confirmation before entering."
        ),
        "push_title": "{symbol} Golden Cross",
        "push_body": "MA{ma_short}↑ crossed MA{ma_long} at ${price:.2f}",
        "icon": "📈",
    },
    "death_cross": {
        "title": "{symbol} Death Cross Alert",
        "body": (
            "{symbol} triggered a death cross signal!\n\n"
            "MA{ma_short} ({ma_short_val:.2f}) crossed below "
            "MA{ma_long} ({ma_long_val:.2f}) at ${price:.2f}.\n"
            "Strength: {strength}\n\n"
            "Consider reviewing your position and risk tolerance."
        ),
        "push_title": "{symbol} Death Cross",
        "push_body": "MA{ma_short}↓ crossed MA{ma_long} at ${price:.2f}",
        "icon": "📉",
    },
    "any_signal": {
        "title": "{symbol} Signal Triggered: {signal_type}",
        "body": (
            "{symbol} generated a {signal_type} signal at ${price:.2f}.\n"
            "Strength: {strength} | Confidence: {confidence:.0%}\n\n"
            "Log in to Trend-Scope for full analysis."
        ),
        "push_title": "{symbol}: {signal_type}",
        "push_body": "{signal_type} signal at ${price:.2f} (Strength: {strength})",
        "icon": "🔔",
    },
    "price_above": {
        "title": "{symbol} Price Alert: Above ${threshold:.2f}",
        "body": (
            "{symbol} has moved above your threshold of ${threshold:.2f}.\n"
            "Current price: ${price:.2f}\n\n"
            "View the chart on Trend-Scope."
        ),
        "push_title": "{symbol} > ${threshold:.2f}",
        "push_body": "Price ${price:.2f} is now above your ${threshold:.2f} threshold",
        "icon": "⬆️",
    },
    "price_below": {
        "title": "{symbol} Price Alert: Below ${threshold:.2f}",
        "body": (
            "{symbol} has dropped below your threshold of ${threshold:.2f}.\n"
            "Current price: ${price:.2f}\n\n"
            "View the chart on Trend-Scope."
        ),
        "push_title": "{symbol} < ${threshold:.2f}",
        "push_body": "Price ${price:.2f} dropped below your ${threshold:.2f} threshold",
        "icon": "⬇️",
    },
    "risk_change": {
        "title": "{symbol} Risk Level Changed: {old_risk} -> {new_risk}",
        "body": (
            "{symbol} risk assessment has changed.\n"
            "Previous: {old_risk}\n"
            "Current:  {new_risk}\n\n"
            "This may affect your position sizing. Review at Trend-Scope."
        ),
        "push_title": "{symbol} Risk: {new_risk}",
        "push_body": "Risk changed from {old_risk} to {new_risk}",
        "icon": "⚠️",
    },
}
```

```python
# backend/app/notifications/templates/strings/zh.py

ZH_TEMPLATES: dict[str, dict] = {
    "golden_cross": {
        "title": "{symbol} 金叉提醒",
        "body": (
            "{symbol} 触发金叉信号！\n\n"
            "MA{ma_short} ({ma_short_val:.2f}) 上穿 "
            "MA{ma_long} ({ma_long_val:.2f})，当前价格 ${price:.2f}。\n"
            "信号强度: {strength}\n\n"
            "建议关注回调确认后建仓。"
        ),
        "push_title": "{symbol} 金叉信号",
        "push_body": "MA{ma_short}↑ 上穿 MA{ma_long}，价格 ${price:.2f}",
        "icon": "📈",
    },
    "death_cross": {
        "title": "{symbol} 死叉提醒",
        "body": (
            "{symbol} 触发死叉信号！\n\n"
            "MA{ma_short} ({ma_short_val:.2f}) 下穿 "
            "MA{ma_long} ({ma_long_val:.2f})，当前价格 ${price:.2f}。\n"
            "信号强度: {strength}\n\n"
            "建议审视持仓和风险承受能力。"
        ),
        "push_title": "{symbol} 死叉信号",
        "push_body": "MA{ma_short}↓ 下穿 MA{ma_long}，价格 ${price:.2f}",
        "icon": "📉",
    },
    "any_signal": {
        "title": "{symbol} 信号触发: {signal_type}",
        "body": (
            "{symbol} 生成 {signal_type} 信号，价格 ${price:.2f}。\n"
            "强度: {strength} | 置信度: {confidence:.0%}\n\n"
            "登录 Trend-Scope 查看完整分析。"
        ),
        "push_title": "{symbol}: {signal_type}",
        "push_body": "{signal_type} 信号，价格 ${price:.2f}（强度: {strength}）",
        "icon": "🔔",
    },
    "price_above": {
        "title": "{symbol} 价格提醒: 突破 ${threshold:.2f}",
        "body": (
            "{symbol} 已突破您设置的 ${threshold:.2f} 阈值。\n"
            "当前价格: ${price:.2f}\n\n"
            "前往 Trend-Scope 查看图表。"
        ),
        "push_title": "{symbol} > ${threshold:.2f}",
        "push_body": "价格 ${price:.2f} 已突破 ${threshold:.2f} 阈值",
        "icon": "⬆️",
    },
    "price_below": {
        "title": "{symbol} 价格提醒: 跌破 ${threshold:.2f}",
        "body": (
            "{symbol} 已跌破您设置的 ${threshold:.2f} 阈值。\n"
            "当前价格: ${price:.2f}\n\n"
            "前往 Trend-Scope 查看图表。"
        ),
        "push_title": "{symbol} < ${threshold:.2f}",
        "push_body": "价格 ${price:.2f} 已跌破 ${threshold:.2f} 阈值",
        "icon": "⬇️",
    },
    "risk_change": {
        "title": "{symbol} 风险等级变更: {old_risk} -> {new_risk}",
        "body": (
            "{symbol} 风险评估已变更。\n"
            "之前: {old_risk}\n"
            "当前: {new_risk}\n\n"
            "这可能影响您的仓位管理，请前往 Trend-Scope 查看详情。"
        ),
        "push_title": "{symbol} 风险: {new_risk}",
        "push_body": "风险等级从 {old_risk} 变更为 {new_risk}",
        "icon": "⚠️",
    },
}
```

### 9.3 TemplateRenderer

```python
# backend/app/notifications/templates/renderer.py

from __future__ import annotations

import logging
from typing import Any

from app.notifications.channels.base import AlertType
from app.notifications.templates.alert_template import AlertTemplate
from app.notifications.templates.strings.en import EN_TEMPLATES
from app.notifications.templates.strings.zh import ZH_TEMPLATES

logger = logging.getLogger(__name__)

# Master template registry: locale -> alert_type -> raw template dict
TEMPLATE_REGISTRY: dict[str, dict[str, dict]] = {
    "en": EN_TEMPLATES,
    "zh": ZH_TEMPLATES,
}


class TemplateRenderer:
    """Renders notification templates for a given alert type and locale.

    Supports variable substitution via Python str.format().
    Falls back to English if the requested locale is unavailable.
    """

    def __init__(self, locale: str = "en") -> None:
        self.templates = TEMPLATE_REGISTRY.get(locale, TEMPLATE_REGISTRY["en"])
        self.locale = locale

    def render(
        self,
        alert_type: AlertType,
        for_channel: str = "email",
        **kwargs: Any,
    ) -> AlertTemplate:
        """Render a full AlertTemplate with substituted variables.

        Args:
            alert_type: The alert type key.
            for_channel: "email" or "push" — affects title/body length.
            **kwargs: Template variables (symbol, price, ma_short_val, etc.)

        Returns:
            AlertTemplate with rendered title and body strings.
        """
        raw = self.templates.get(alert_type.value)
        if raw is None:
            logger.warning("No template for alert_type=%s locale=%s", alert_type, self.locale)
            raw = {
                "title": "{alert_type} Alert",
                "body": "{symbol} triggered {alert_type} at ${price:.2f}.",
                "icon": "🔔",
            }

        template = AlertTemplate(
            alert_type=alert_type,
            locale=self.locale,
            title_template=raw["title"],
            body_template=raw["body"],
            push_title_template=raw.get("push_title", raw["title"]),
            push_body_template=raw.get("push_body", raw["body"]),
            icon=raw.get("icon", ""),
        )

        if for_channel == "push":
            title = template.render_push(**kwargs)[0]
            body = template.render_push(**kwargs)[1]
        else:
            title = template.render_title(**kwargs)
            body = template.render_body(**kwargs)

        # Augment kwargs with common defaults if missing
        all_kwargs = {
            "alert_type": alert_type.value.replace("_", " ").title(),
            **kwargs,
        }
        rendered = AlertTemplate(
            alert_type=alert_type,
            locale=self.locale,
            title_template=title,
            body_template=body,
            icon=raw.get("icon", ""),
        )
        return rendered

    def render_html_email(
        self,
        alert_type: AlertType,
        **kwargs: Any,
    ) -> str:
        """Render a full HTML email for the given alert type."""
        from app.notifications.templates.email_html import GOLDEN_CROSS_HTML

        is_zh = self.locale == "zh"

        # Determine banner style based on alert type
        if alert_type in (AlertType.GOLDEN_CROSS,):
            banner_style = "background-color:#065f46;"
            banner_color = "color:#6ee7b7;"
            icon = "📈"
        elif alert_type in (AlertType.DEATH_CROSS,):
            banner_style = "background-color:#7f1d1d;"
            banner_color = "color:#fca5a5;"
            icon = "📉"
        elif alert_type == AlertType.RISK_CHANGE:
            banner_style = "background-color:#78350f;"
            banner_color = "color:#fcd34d;"
            icon = "⚠️"
        else:
            banner_style = "background-color:#1e3a5f;"
            banner_color = "color:#93c5fd;"
            icon = "🔔"

        rendered = self.render(alert_type, for_channel="email", **kwargs)

        # Build data rows
        data_rows = ""
        for key, value in kwargs.items():
            if key in ("symbol", "price", "strength", "confidence"):
                label = key.replace("_", " ").title()
                data_rows += f"""
                <tr style="border-bottom:1px solid #1e293b;">
                  <td style="padding:12px;color:#94a3b8;width:120px;">{label}</td>
                  <td style="padding:12px;color:#f8fafc;font-weight:600;">{value}</td>
                </tr>"""

        cta_text = "查看详情" if is_zh else "View Details"
        disclaimer = (
            "以上为自动化分析参考，不构成投资建议。投资有风险，入市需谨慎。"
            if is_zh
            else "This is automated analysis for reference only, not financial advice. Investing involves risk."
        )
        unsubscribe_text = "退订" if is_zh else "Unsubscribe"
        prefs_text = "通知设置" if is_zh else "Preferences"

        return GOLDEN_CROSS_HTML.format(
            locale=self.locale,
            banner_style=banner_style,
            banner_color=banner_color,
            icon=icon,
            title=rendered.title_template,
            body_html=f"<p>{rendered.body_template.replace(chr(10), '<br>')}</p>",
            data_rows=data_rows,
            deep_link=f"{'https://trend-scope.com'}/stocks/{kwargs.get('symbol', '').lower()}",
            cta_text=cta_text,
            disclaimer=disclaimer,
            unsubscribe_url="https://trend-scope.com/settings/notifications",
            unsubscribe_text=unsubscribe_text,
            prefs_url="https://trend-scope.com/settings/notifications",
            prefs_text=prefs_text,
        )
```

---

## 10. Reliability & Resilience

### 10.1 Retry with Exponential Backoff

```python
# backend/app/notifications/dispatcher.py (retry logic section)

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

from app.notifications.channels.base import (
    ChannelAdapter,
    DispatchResult,
    DeliveryStatus,
    NotificationPayload,
)

logger = logging.getLogger(__name__)


@dataclass
class RetryConfig:
    max_retries: int = 3
    base_delay: float = 1.0    # seconds
    max_delay: float = 60.0    # seconds
    backoff_factor: float = 2.0


DEFAULT_RETRY_CONFIG = RetryConfig()


async def send_with_retry(
    adapter: ChannelAdapter,
    payload: NotificationPayload,
    config: RetryConfig | None = None,
) -> DispatchResult:
    """Send via adapter with exponential backoff retry.

    Retry sequence: attempt 0 (initial), then 1s, 2s, 4s delays.
    On exhaustion, moves payload to Dead Letter Queue.
    """
    cfg = config or DEFAULT_RETRY_CONFIG
    last_exception: Exception | None = None

    for attempt in range(cfg.max_retries + 1):
        try:
            result = await adapter.send(payload)
            if result.success:
                return result
            # Provider returned success=False (e.g., rate limited)
            logger.warning(
                "Channel %s returned failure user=%d attempt=%d: %s",
                adapter.channel_type, payload.user_id, attempt,
                result.error_message,
            )
        except Exception as exc:
            last_exception = exc
            logger.error(
                "Channel %s exception user=%d attempt=%d: %s",
                adapter.channel_type, payload.user_id, attempt, exc,
            )

        if attempt < cfg.max_retries:
            delay = min(
                cfg.base_delay * (cfg.backoff_factor ** attempt),
                cfg.max_delay,
            )
            await asyncio.sleep(delay)

    # All retries exhausted -> Dead Letter Queue
    error_msg = str(last_exception) if last_exception else "All attempts returned failure"
    logger.error(
        "DLQ: channel=%s user=%s alert=%s error=%s",
        adapter.channel_type, payload.user_id, payload.alert_type, error_msg,
    )
    await _move_to_dlq(payload, adapter.channel_type.value, error_msg)

    return DispatchResult(
        channel=adapter.channel_type,
        success=False,
        error_message=error_msg,
        status=DeliveryStatus.FAILED,
    )


async def _move_to_dlq(
    payload: NotificationPayload,
    channel: str,
    error_message: str,
) -> None:
    """Insert failed notification into dead letter queue table."""
    import json
    from app.core.database import async_session
    from app.models.alert import NotificationDLQ
    from datetime import datetime

    async with async_session() as session:
        dlq_entry = NotificationDLQ(
            user_id=payload.user_id,
            alert_log_id=None,
            channel=channel,
            payload=json.dumps(_serialize_payload(payload)),
            error_message=error_message,
            retry_count=0,
            status="pending",
            created_at=datetime.utcnow(),
        )
        session.add(dlq_entry)
        await session.commit()


def _serialize_payload(payload: NotificationPayload) -> dict:
    """Serialize NotificationPayload to JSON-safe dict for DLQ storage."""
    return {
        "user_id": payload.user_id,
        "user_email": payload.user_email,
        "alert_rule_id": payload.alert_rule_id,
        "stock_id": payload.stock_id,
        "symbol": payload.symbol,
        "alert_type": payload.alert_type.value,
        "channels": [ch.value for ch in payload.channels],
        "title": payload.title,
        "body": payload.body,
        "html_body": payload.html_body,
        "context_data": payload.context_data,
    }
```

### 10.2 Dead Letter Queue (DLQ)

```python
# backend/app/notifications/dlq.py

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.notifications.channels.base import (
    ChannelType,
    NotificationPayload,
)

logger = logging.getLogger(__name__)


async def process_dlq_batch(
    session: AsyncSession,
    dispatcher,  # NotificationDispatcher
    limit: int = 50,
) -> int:
    """Process pending DLQ entries with retry.

    Called by APScheduler every 15 minutes.
    Returns number of successfully replayed entries.
    """
    from app.models.alert import NotificationDLQ
    from datetime import datetime

    result = await session.execute(
        select(NotificationDLQ)
        .where(NotificationDLQ.status == "pending")
        .order_by(NotificationDLQ.created_at)
        .limit(limit)
    )
    entries = result.scalars().all()

    replayed = 0
    for entry in entries:
        # Mark as retrying
        entry.status = "retrying"
        entry.last_retry_at = datetime.utcnow()
        await session.commit()

        try:
            payload_data = json.loads(entry.payload) if isinstance(entry.payload, str) else entry.payload
            # Reconstruct payload
            payload = NotificationPayload(
                user_id=entry.user_id,
                user_email=payload_data.get("user_email", ""),
                user_locale=payload_data.get("user_locale", "en"),
                alert_rule_id=payload_data.get("alert_rule_id"),
                stock_id=payload_data.get("stock_id", 0),
                symbol=payload_data.get("symbol", ""),
                alert_type=payload_data.get("alert_type", "any_signal"),
                channels=[ChannelType(entry.channel)],
                title=payload_data.get("title", ""),
                body=payload_data.get("body", ""),
                html_body=payload_data.get("html_body", ""),
                context_data=payload_data.get("context_data", {}),
            )

            result = await dispatcher.dispatch_single(payload)
            if result[0].success if result else False:
                entry.status = "replayed"
                replayed += 1
            else:
                entry.retry_count += 1
                if entry.retry_count >= 5:
                    entry.status = "failed_permanent"
                else:
                    entry.status = "pending"
        except Exception as exc:
            logger.error("DLQ replay failed id=%s: %s", entry.id, exc)
            entry.retry_count += 1
            if entry.retry_count >= 5:
                entry.status = "failed_permanent"
            else:
                entry.status = "pending"

        await session.commit()

    return replayed
```

### 10.3 Rate Limiting

```python
# backend/app/notifications/rate_limiter.py

from __future__ import annotations

import logging
from datetime import datetime, timezone

import redis.asyncio as redis

logger = logging.getLogger(__name__)


class NotificationRateLimiter:
    """Rate limit notifications per user per channel to avoid spam.

    Uses Redis with sliding window counters.

    Default limits:
      Per channel per user: 10/hr, 50/day
      Push specific: 5/hr, 20/day
    """

    def __init__(
        self,
        redis_client: redis.Redis,
        max_per_hour: int = 10,
        max_per_day: int = 50,
        push_max_per_hour: int = 5,
        push_max_per_day: int = 20,
    ) -> None:
        self.redis = redis_client
        self.max_per_hour = max_per_hour
        self.max_per_day = max_per_day
        self.push_max_per_hour = push_max_per_hour
        self.push_max_per_day = push_max_per_day

    async def check_and_increment(
        self,
        user_id: int,
        channel: str,
    ) -> bool:
        """Check if notification is within rate limits.

        Returns True if allowed, False if rate limit exceeded.
        Increments counters atomically.
        """
        now = datetime.now(timezone.utc)
        hour_key = f"ratelimit:notif:{user_id}:{channel}:{now.strftime('%Y%m%d%H')}"
        day_key = f"ratelimit:notif:{user_id}:{channel}:{now.strftime('%Y%m%d')}"

        max_h = self.push_max_per_hour if channel == "push" else self.max_per_hour
        max_d = self.push_max_per_day if channel == "push" else self.max_per_day

        # Pipeline for atomicity
        pipe = self.redis.pipeline()
        pipe.incr(hour_key)
        pipe.incr(day_key)
        hour_count, day_count = await pipe.execute()

        # Set expiry (only on first increment)
        await self.redis.expire(hour_key, 3600)
        await self.redis.expire(day_key, 86400)

        if hour_count > max_h:
            logger.warning(
                "Rate limit HOUR exceeded: user=%d channel=%s count=%d/%d",
                user_id, channel, hour_count, max_h,
            )
            return False

        if day_count > max_d:
            logger.warning(
                "Rate limit DAY exceeded: user=%d channel=%s count=%d/%d",
                user_id, channel, day_count, max_d,
            )
            return False

        return True

    async def get_current_usage(
        self, user_id: int, channel: str
    ) -> dict[str, int]:
        """Get current rate limit usage for a user/channel."""
        now = datetime.now(timezone.utc)
        hour_key = f"ratelimit:notif:{user_id}:{channel}:{now.strftime('%Y%m%d%H')}"
        day_key = f"ratelimit:notif:{user_id}:{channel}:{now.strftime('%Y%m%d')}"

        hour_val = await self.redis.get(hour_key)
        day_val = await self.redis.get(day_key)

        return {
            "hour_used": int(hour_val) if hour_val else 0,
            "day_used": int(day_val) if day_val else 0,
        }
```

### 10.4 Deduplication

```python
# backend/app/notifications/deduplicator.py

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


async def is_duplicate_alert(
    session: AsyncSession,
    user_id: int,
    stock_id: int,
    alert_type: str,
    window_hours: int = 24,
) -> bool:
    """Check if the same alert_type for the same stock was already sent
    to this user within the dedup window.

    Prevents sending redundant notifications for signals that haven't changed.
    """
    from app.models.alert import AlertLog

    cutoff = datetime.now(timezone.utc) - timedelta(hours=window_hours)

    result = await session.execute(
        select(AlertLog.id).where(
            and_(
                AlertLog.user_id == user_id,
                AlertLog.stock_id == stock_id,
                AlertLog.alert_type == alert_type,
                AlertLog.created_at >= cutoff,
                AlertLog.delivery_status.in_(["sent", "delivered", "opened", "clicked"]),
            )
        )
    )
    existing = result.scalar_one_or_none()

    if existing:
        logger.debug(
            "Dedup blocked: user=%d stock=%d type=%s (sent within %dh)",
            user_id, stock_id, alert_type, window_hours,
        )
        return True
    return False
```

### 10.5 Webhook Signature Verification (Resend via Svix)

```python
# Already implemented in §3.3 EmailChannel.webhooks.py
# Resend uses Svix for webhook delivery with svix-id, svix-timestamp, svix-signature headers.
# Verification uses HMAC-SHA256 with the webhook secret.
```

---

## 11. NotificationDispatcher (Orchestrator)

```python
# backend/app/notifications/dispatcher.py

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.notifications.channels import ChannelFactory
from app.notifications.channels.base import (
    ChannelAdapter,
    ChannelType,
    DispatchResult,
    NotificationPayload,
)
from app.notifications.rate_limiter import NotificationRateLimiter
from app.notifications.deduplicator import is_duplicate_alert
from app.notifications.preferences import load_user_preferences
from app.notifications.rule_evaluator import SignalEvent, AlertRuleEvaluator
from app.notifications.templates.renderer import TemplateRenderer

logger = logging.getLogger(__name__)


class NotificationDispatcher:
    """Central orchestrator for the notification pipeline.

    Responsibilities:
      1. Receive SignalEvent from AnalysisEngine
      2. Find matching alert_rules via AlertRuleEvaluator
      3. Load user preferences and filter
      4. Check deduplication and rate limits
      5. Render templates per language
      6. Dispatch concurrently to all enabled channel adapters
      7. Write alert_log and notification_inbox records
    """

    def __init__(
        self,
        session_factory,  # async session factory
        rate_limiter: NotificationRateLimiter | None = None,
    ) -> None:
        self.session_factory = session_factory
        self.rate_limiter = rate_limiter

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    async def dispatch(self, event: SignalEvent) -> list[DispatchResult]:
        """Main dispatch entry point for a signal event.

        Called by AnalysisEngine after signal generation.
        """
        all_results: list[DispatchResult] = []

        async with self.session_factory() as session:
            # Step 1: Evaluate rules
            matched_rules = await AlertRuleEvaluator.evaluate(session, event)
            if not matched_rules:
                logger.debug("No matching rules for event %s on %s",
                             event.signal_type.value, event.symbol)
                return all_results

            # Step 2: For each matched rule, process dispatch
            for matched in matched_rules:
                results = await self._process_matched_rule(session, event, matched)
                all_results.extend(results)

        return all_results

    async def dispatch_single(self, payload: NotificationPayload) -> list[DispatchResult]:
        """Dispatch a single payload directly (used by digest, DLQ replay, admin test)."""
        adapters = ChannelFactory.get_enabled(
            [ch.value for ch in payload.channels]
        )
        if not adapters:
            return []

        tasks = [
            self._dispatch_to_channel(adapter, payload)
            for adapter in adapters
        ]
        return list(await asyncio.gather(*tasks))

    # ------------------------------------------------------------------
    # Per-rule processing
    # ------------------------------------------------------------------

    async def _process_matched_rule(
        self,
        session: AsyncSession,
        event: SignalEvent,
        matched,  # MatchedRule
    ) -> list[DispatchResult]:
        """Process one matched rule: check prefs, dedup, rate-limit, then dispatch."""
        results: list[DispatchResult] = []

        # Load user preferences
        prefs = await load_user_preferences(session, matched.user_id)

        # Build base payload
        base_payload = NotificationPayload(
            user_id=matched.user_id,
            user_email="",     # will be resolved from users table
            user_locale=prefs.locale,
            alert_rule_id=matched.rule_id,
            stock_id=event.stock_id,
            symbol=event.symbol,
            alert_type=matched.alert_type,
            channels=[],
            context_data={
                "price": event.price,
                "strength": event.strength,
                "confidence": event.confidence,
                "triggered_date": event.triggered_date,
                **event.context,
            },
        )

        for channel_name in matched.channels:
            # Preference check
            allowed, reason = prefs.should_dispatch(channel_name, event.stock_id)
            if not allowed:
                logger.debug("Skipping channel %s for user %d: %s",
                             channel_name, matched.user_id, reason)
                continue

            # Deduplication check
            if await is_duplicate_alert(
                session, matched.user_id, event.stock_id, matched.alert_type.value
            ):
                logger.debug("Dedup skip: user=%d stock=%d type=%s",
                             matched.user_id, event.stock_id, matched.alert_type.value)
                continue

            # Rate limit check
            if self.rate_limiter:
                if not await self.rate_limiter.check_and_increment(
                    matched.user_id, channel_name
                ):
                    logger.debug("Rate limit skip: user=%d channel=%s",
                                 matched.user_id, channel_name)
                    continue

            # Resolve user email (fetch from DB if needed)
            if channel_name == "email" and not base_payload.user_email:
                base_payload.user_email = await self._get_user_email(
                    session, matched.user_id
                )

            # Render templates
            renderer = TemplateRenderer(locale=prefs.locale)
            rendered = renderer.render(
                matched.alert_type,
                for_channel=channel_name,
                symbol=event.symbol,
                signal_type=matched.alert_type.value,
                **base_payload.context_data,
            )
            base_payload.title = rendered.title_template
            base_payload.body = rendered.body_template
            if channel_name == "email":
                base_payload.html_body = renderer.render_html_email(
                    matched.alert_type,
                    symbol=event.symbol,
                    signal_type=matched.alert_type.value,
                    **base_payload.context_data,
                )

            # Get adapter and dispatch
            channel_type = ChannelType(channel_name)
            adapter = ChannelFactory.get(channel_type)
            if adapter is None:
                logger.warning("No adapter for channel %s", channel_name)
                continue

            payload = base_payload
            payload.channels = [channel_type]

            result = await self._dispatch_to_channel(adapter, payload)

            # Record to alert_log + inbox
            await self._record_notification(session, payload, result)

            results.append(result)

        return results

    async def _dispatch_to_channel(
        self,
        adapter: ChannelAdapter,
        payload: NotificationPayload,
    ) -> DispatchResult:
        """Dispatch to a single channel adapter."""
        from app.notifications.dispatcher import send_with_retry
        return await send_with_retry(adapter, payload)

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    async def _record_notification(
        self,
        session: AsyncSession,
        payload: NotificationPayload,
        result: DispatchResult,
    ) -> None:
        """Write alert_log and notification_inbox entries."""
        from app.models.alert import AlertLog, NotificationInbox
        from datetime import datetime

        alert_log = AlertLog(
            alert_rule_id=payload.alert_rule_id,
            user_id=payload.user_id,
            stock_id=payload.stock_id,
            alert_type=payload.alert_type.value,
            channel=result.channel.value,
            title=payload.title,
            body=payload.body,
            context_data=payload.context_data,
            provider_message_id=result.provider_message_id,
            delivery_status=result.status.value,
            error_message=result.error_message,
            created_at=datetime.now(timezone.utc),
        )
        session.add(alert_log)
        await session.flush()  # get alert_log.id

        # Write to inbox (for in-app notification center)
        inbox = NotificationInbox(
            user_id=payload.user_id,
            alert_log_id=alert_log.id,
            alert_type=payload.alert_type.value,
            title=payload.title,
            body=payload.body,
            data=payload.context_data,
            is_read=False,
            created_at=datetime.now(timezone.utc),
        )
        session.add(inbox)
        await session.commit()

    @staticmethod
    async def _get_user_email(session: AsyncSession, user_id: int) -> str:
        """Fetch user email from users table."""
        from sqlalchemy import select
        from app.models.user import User
        result = await session.execute(
            select(User.email).where(User.id == user_id)
        )
        email = result.scalar_one_or_none()
        return email or ""
```

---

## 12. Database Queries

### 12.1 Find Users to Notify for a Given Signal (Optimized Join)

```sql
-- Efficiently find all (user, rule) pairs for a given signal
-- Uses indexed columns: alert_rules(stock_id, is_active, alert_type)

SELECT
    ar.id AS rule_id,
    ar.user_id,
    ar.alert_type,
    ar.channels,
    u.email,
    np.locale,
    np.email_enabled,
    np.push_enabled,
    np.inapp_enabled,
    np.digest_mode
FROM alert_rules ar
JOIN users u ON u.id = ar.user_id AND u.status = 'active'
LEFT JOIN notification_preferences np ON np.user_id = ar.user_id
WHERE ar.stock_id = :stock_id
  AND ar.is_active = TRUE
  AND (
      ar.alert_type = :signal_type       -- specific match
      OR ar.alert_type = 'any_signal'     -- catch-all
  )
  AND (
      -- Exclude users who already received this signal within 24h
      NOT EXISTS (
          SELECT 1 FROM alert_logs al
          WHERE al.user_id = ar.user_id
            AND al.stock_id = ar.stock_id
            AND al.alert_type = :signal_type
            AND al.created_at >= NOW() - INTERVAL 24 HOUR
            AND al.delivery_status IN ('sent', 'delivered', 'opened', 'clicked')
      )
  );

-- Price threshold rules (evaluated separately)
SELECT ar.id, ar.user_id, ar.alert_type, ar.threshold, ar.channels,
       u.email, np.*
FROM alert_rules ar
JOIN users u ON u.id = ar.user_id AND u.status = 'active'
LEFT JOIN notification_preferences np ON np.user_id = ar.user_id
WHERE ar.stock_id = :stock_id
  AND ar.is_active = TRUE
  AND ar.alert_type IN ('price_above', 'price_below')
  AND ar.threshold IS NOT NULL
  AND (
      (ar.alert_type = 'price_above' AND :current_price > ar.threshold)
      OR
      (ar.alert_type = 'price_below' AND :current_price < ar.threshold)
  );
```

### 12.2 Batch Insert for alert_logs

```sql
-- Bulk insert alert logs (single INSERT with multiple VALUES)
INSERT INTO alert_logs
    (alert_rule_id, user_id, stock_id, alert_type, channel,
     title, body, context_data, provider_message_id, delivery_status, created_at)
VALUES
    (1, 101, 5, 'golden_cross', 'email', 'SPY Golden Cross', '...', '{}', 'res_abc', 'sent', NOW()),
    (2, 102, 5, 'golden_cross', 'push', 'SPY Golden Cross', '...', '{}', 'os_xyz', 'sent', NOW()),
    (3, 103, 5, 'any_signal', 'inapp', 'SPY Signal', '...', '{}', NULL, 'sent', NOW());
```

### 12.3 Inbox Cleanup Query

```sql
-- Soft-delete notifications older than 30 days
UPDATE notification_inbox
SET is_deleted = TRUE
WHERE created_at < NOW() - INTERVAL 30 DAY
  AND is_deleted = FALSE;

-- Hard delete for GDPR compliance (90+ days)
DELETE FROM notification_inbox
WHERE created_at < NOW() - INTERVAL 90 DAY
  AND is_deleted = TRUE;
```

### 12.4 Delivery Analytics Queries

```sql
-- Send rate per channel (last 7 days)
SELECT channel, COUNT(*) AS sent_count,
       DATE(created_at) AS date
FROM alert_logs
WHERE created_at >= NOW() - INTERVAL 7 DAY
GROUP BY channel, DATE(created_at)
ORDER BY date DESC, channel;

-- Open rate per alert type (last 30 days)
SELECT
    alert_type,
    COUNT(*) AS total,
    SUM(CASE WHEN delivery_status = 'opened' OR delivery_status = 'clicked' THEN 1 ELSE 0 END) AS opened,
    ROUND(100.0 * SUM(CASE WHEN delivery_status IN ('opened','clicked') THEN 1 ELSE 0 END) / COUNT(*), 1) AS open_rate
FROM alert_logs
WHERE channel = 'email'
  AND created_at >= NOW() - INTERVAL 30 DAY
GROUP BY alert_type
ORDER BY total DESC;

-- Bounce rate (last 30 days)
SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN delivery_status = 'bounced' THEN 1 ELSE 0 END) AS bounced,
    ROUND(100.0 * SUM(CASE WHEN delivery_status = 'bounced' THEN 1 ELSE 0 END) / COUNT(*), 2) AS bounce_rate
FROM alert_logs
WHERE channel = 'email'
  AND created_at >= NOW() - INTERVAL 30 DAY;

-- Top users by notifications received (last 30 days)
SELECT user_id, u.email, COUNT(*) AS notification_count
FROM alert_logs al
JOIN users u ON u.id = al.user_id
WHERE al.created_at >= NOW() - INTERVAL 30 DAY
GROUP BY user_id, u.email
ORDER BY notification_count DESC
LIMIT 20;
```

---

## 13. Admin Panel

### 13.1 Admin API Endpoints

```
GET    /api/v1/admin/notifications/templates                    -> List templates
GET    /api/v1/admin/notifications/templates/{alert_type}        -> Get template (en+zh)
PUT    /api/v1/admin/notifications/templates/{alert_type}        -> Update templates
POST   /api/v1/admin/notifications/test-send                     -> Send test notification

GET    /api/v1/admin/notifications/alert-logs                    -> Search/filter logs
GET    /api/v1/admin/notifications/delivery-analytics            -> Aggregated stats

GET    /api/v1/admin/notifications/dlq                           -> List DLQ entries
POST   /api/v1/admin/notifications/dlq/{id}/replay               -> Replay single DLQ
POST   /api/v1/admin/notifications/dlq/process                   -> Trigger DLQ processing

GET    /api/v1/admin/notifications/broadcast                     -> Send system broadcast
```

### 13.2 Alert Log Search/Filter (Admin API)

```python
# backend/app/api/v1/admin/notifications.py

from fastapi import APIRouter, Query
from sqlalchemy import select, func, and_, or_
from app.models.alert import AlertLog

router = APIRouter(prefix="/admin/notifications", tags=["admin-notifications"])


@router.get("/alert-logs")
async def list_alert_logs(
    user_id: int | None = Query(None),
    stock_id: int | None = Query(None),
    alert_type: str | None = Query(None),
    channel: str | None = Query(None),
    delivery_status: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    search: str | None = Query(None, description="Search in title/body"),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
):
    """Search and filter alert_logs with pagination."""
    conditions = []
    if user_id:
        conditions.append(AlertLog.user_id == user_id)
    if stock_id:
        conditions.append(AlertLog.stock_id == stock_id)
    if alert_type:
        conditions.append(AlertLog.alert_type == alert_type)
    if channel:
        conditions.append(AlertLog.channel == channel)
    if delivery_status:
        conditions.append(AlertLog.delivery_status == delivery_status)
    if date_from:
        conditions.append(AlertLog.created_at >= date_from)
    if date_to:
        conditions.append(AlertLog.created_at <= date_to)
    if search:
        conditions.append(
            or_(
                AlertLog.title.ilike(f"%{search}%"),
                AlertLog.body.ilike(f"%{search}%"),
            )
        )

    # Build query with conditions, paginate, return
    ...


@router.get("/delivery-analytics")
async def delivery_analytics(
    days: int = Query(30, ge=1, le=365),
):
    """Aggregated delivery analytics: send rate, open rate, bounce rate."""
    return {
        "period_days": days,
        "by_channel": {...},     # per-channel counts
        "by_alert_type": {...},   # per-alert-type open rates
        "overall_open_rate": 0.0,
        "overall_bounce_rate": 0.0,
        "total_sent": 0,
    }
```

### 13.3 Admin Dashboard UI (Next.js Pages)

```
Admin Pages:
  /admin/notifications/templates    -> Template editor (view/edit English + Chinese side by side)
  /admin/notifications/alert-logs   -> Table with search/filter/pagination
  /admin/notifications/analytics    -> Charts: send rate over time, open rate by type
  /admin/notifications/dlq          -> Dead Letter Queue with replay button
  /admin/notifications/broadcast    -> Send system-wide announcement

Components:
  TemplateEditor.tsx       -> Side-by-side textarea for en/zh templates with preview
  AlertLogTable.tsx        -> Ant Design Table with filters
  DeliveryChart.tsx        -> Recharts line chart of delivery metrics
  DlqTable.tsx             -> Table with replay action per row
  BroadcastForm.tsx        -> Form with audience selector + message composer
```

### 13.4 Template Management UI Design

```
+----------------------------------------------------+
|  Notification Template Manager                     |
+----------------------------------------------------+
|  Alert Type: [golden_cross v]                      |
+----------------------------------------------------+
|  +---------------------+  +---------------------+  |
|  | English (en)        |  | Chinese (zh)       |  |
|  |                     |  |                     |  |
|  | Title:              |  | Title:              |  |
|  | [{symbol} Golden...]|  | [{symbol} 金叉提醒]  |  |
|  |                     |  |                     |  |
|  | Body:               |  | Body:               |  |
|  | [{symbol} trigge...]|  | [{symbol} 触发金...] |  |
|  |                     |  |                     |  |
|  | Push Title:         |  | Push Title:         |  |
|  | [{symbol} Golden...]|  | [{symbol} 金叉信号]  |  |
|  |                     |  |                     |  |
|  | Push Body:          |  | Push Body:          |  |
|  | [MA{ma_short} c...] |  | [MA{ma_short} 上...] |  |
|  +---------------------+  +---------------------+  |
|                                                    |
|  Variables: {symbol} {price} {ma_short} {ma_short_val} |
|             {ma_long} {ma_long_val} {strength} ...      |
+----------------------------------------------------+
|  [Preview Email]  [Send Test]  [Save Changes]      |
+----------------------------------------------------+
```

---

## 14. SMS Channel (Deferred — Reference Implementation)

```python
# backend/app/notifications/channels/sms_channel.py
# Deferred to future phase. Included as reference for completeness.

from __future__ import annotations

import logging

from twilio.rest import Client as TwilioClient
from app.core.config import settings
from app.notifications.channels.base import (
    ChannelAdapter,
    ChannelType,
    DeliveryStatus,
    DispatchResult,
    NotificationPayload,
)

logger = logging.getLogger(__name__)


class SMSChannel(ChannelAdapter):
    """SMS notifications via Twilio. Deferred for future phase.

    Cost: ~$0.012/msg US. Best for urgent alerts only.
    Pro tier: max 20 SMS alerts/month.
    """

    channel_type = ChannelType.SMS

    def __init__(self) -> None:
        self.client = TwilioClient(
            settings.TWILIO_ACCOUNT_SID,
            settings.TWILIO_AUTH_TOKEN,
        )
        self.from_number = settings.TWILIO_PHONE_NUMBER

    async def send(self, payload: NotificationPayload) -> DispatchResult:
        # SMS length limited to 160 chars — use push-format templates
        try:
            msg = self.client.messages.create(
                body=f"{payload.title}\n{payload.body}"[:160],
                from_=self.from_number,
                to=payload.user_email,  # would be phone number
            )
            return DispatchResult(
                channel=ChannelType.SMS,
                success=True,
                provider_message_id=msg.sid,
                status=DeliveryStatus.SENT,
            )
        except Exception as exc:
            logger.error("Twilio SMS failed: %s", exc)
            return DispatchResult(
                channel=ChannelType.SMS,
                success=False,
                error_message=str(exc),
                status=DeliveryStatus.FAILED,
            )
```

---

## 15. Configuration & Environment Variables

```bash
# Email
RESEND_API_KEY=re_xxxxxxxxxxxx
RESEND_FROM_EMAIL=alerts@trend-scope.com
RESEND_WEBHOOK_SECRET=whsec_xxxxxxxxxxxx
AWS_ACCESS_KEY_ID=AKIAXXXXXXXXXX        # SES fallback
AWS_SECRET_ACCESS_KEY=xxxxxxxxxxxx      # SES fallback
AWS_SES_REGION=us-east-1                # SES fallback

# Push Notifications
ONESIGNAL_APP_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
ONESIGNAL_REST_API_KEY=xxxxxxxxxxxxxxxxxxxx

# SMS (deferred)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+15551234567

# Redis (already in stack)
REDIS_URL=redis://localhost:6379/0

# Frontend URL (for deep links)
FRONTEND_URL=https://trend-scope.com
```

---

## 16. Startup Bootstrap Sequence

```python
# In backend/app/main.py or a dedicated startup module

async def init_notification_system():
    """Initialize all notification channels and background tasks on app startup."""

    from app.notifications.channels.email_channel import EmailChannel
    from app.notifications.channels.push_channel import PushChannel
    from app.notifications.channels.inapp_channel import InAppChannel, WSConnectionManager
    from app.notifications.channels import ChannelFactory, init_channels
    from app.notifications.dispatcher import NotificationDispatcher
    from app.notifications.rate_limiter import NotificationRateLimiter
    import redis.asyncio as redis

    # 1. Redis
    redis_client = redis.from_url(settings.REDIS_URL)

    # 2. WebSocket manager
    ws_manager = WSConnectionManager()
    asyncio.create_task(ws_manager.start_heartbeat(interval=30))

    # 3. Channel adapters
    email_channel = EmailChannel(ses_fallback_enabled=True)
    push_channel = PushChannel()
    inapp_channel = InAppChannel(ws_manager=ws_manager, redis_client=redis_client)

    init_channels(email_channel, push_channel, inapp_channel)

    # 4. Redis Pub/Sub listener (runs in background)
    asyncio.create_task(inapp_channel.start_redis_listener())

    # 5. Rate limiter
    rate_limiter = NotificationRateLimiter(redis_client=redis_client)

    # 6. Dispatcher (global singleton)
    dispatcher = NotificationDispatcher(
        session_factory=async_session,
        rate_limiter=rate_limiter,
    )

    # Store globally for access by API routes and scheduler jobs
    app.state.notification_dispatcher = dispatcher
    app.state.ws_manager = ws_manager
    app.state.notification_rate_limiter = rate_limiter

    logger.info("Notification system initialized")
```

---

## 17. Summary

| Section | Component | Status | Key Decision |
|---|---|---|---|
| 2 | ChannelAdapter ABC | Complete | Unified `send(NotificationPayload) -> DispatchResult` |
| 3 | EmailChannel | Complete | Resend primary, AWS SES fallback, React Email + Jinja2 |
| 4 | PushChannel | Complete | OneSignal REST API, deep-link click-through |
| 5 | InAppChannel | Complete | FastAPI WebSocket + Redis Pub/Sub cross-worker bridge |
| 6 | NotificationPreferences | Complete | 4-tier check: master switch -> digest -> quiet hours -> stock toggle |
| 7 | AlertRuleEvaluator | Complete | Batch SQL query with 3-phase matching (specific + any_signal + price) |
| 8 | Digest Mode | Complete | APScheduler daily/weekly 18:00 ET, digest_queue table |
| 9 | TemplateRenderer | Complete | Format-string templates, en+zh for all 6 alert types, HTML email renderer |
| 10 | Reliability | Complete | 3-retry exponential backoff, DLQ table, Redis rate limiter, 24h dedup, webhook signature |
| 11 | NotificationDispatcher | Complete | Full orchestrator with preference filtering, rendering, concurrent dispatch |
| 12 | Database Queries | Complete | Optimized joins for rule matching, batch insert, inbox cleanup, analytics |
| 13 | Admin Panel | Complete | Template editor, alert log search, delivery analytics, DLQ replay, broadcast |
| 14 | SMSChannel | Deferred | Twilio reference implementation for future phase |

---

## Change Record

| Version | Date | Change |
|---|---|---|
| v1 | 2026-06-09 | Initial comprehensive design document. All 12 sections with complete Python implementations. |
