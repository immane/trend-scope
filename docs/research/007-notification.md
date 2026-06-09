# 007 - Notification & Alert System Research

> **Status**: Research Complete
> **Date**: 2026-06-09
> **Purpose**: Comprehensive evaluation of notification channels, architecture patterns, service pricing, and implementation strategies for Trend-Scope alert system.

---

## Table of Contents

1. [Service Selection Summary](#1-service-selection-summary)
2. [Notification Channels](#2-notification-channels)
    - [2.1 Email Services Comparison](#21-email-services-comparison)
    - [2.2 Push Notifications](#22-push-notifications)
    - [2.3 SMS](#23-sms)
    - [2.4 In-App Notifications](#24-in-app-notifications)
3. [Notification Architecture](#3-notification-architecture)
4. [Alert Types & Triggers](#4-alert-types--triggers)
5. [Delivery & Reliability](#5-delivery--reliability)
6. [Implementation Guide](#6-implementation-guide)
7. [Database Schema](#7-database-schema)
8. [Cost Projections](#8-cost-projections)

---

## 1. Service Selection Summary

| Channel | Recommended Provider | Phase | Rationale |
|---|---|---|---|
| Email | **Resend** (primary) + AWS SES (scale fallback) | P5 | Best DX, React Email templates, clean API, $20/50k |
| Push (Web) | **OneSignal** Free tier | P5+ | Free web push, 10k subscribers, simple JS SDK |
| Push (Mobile) | **FCM** / **APNs** (direct) | Future | No cost, native integration when mobile apps exist |
| SMS | **Twilio SMS** | Future | Best global coverage, $0.012/msg US, proven |
| In-App | **WebSocket** + Redis pub/sub | P5+ | Real-time, zero external cost, FastAPI-native |
| Scheduled Digests | **APScheduler** (already in stack) | P5 | No new dependency, cron-based morning/evening |

### Channel Availability by Membership Tier

| Tier | Email | Web Push | SMS | In-App | Max Alerts |
|---|---|---|---|---|---|
| Free | - | - | - | - | 0 |
| Basic | Yes | - | - | Yes | 5 |
| Pro | Yes | Yes | Future | Yes | 20 |

---

## 2. Notification Channels

### 2.1 Email Services Comparison

#### Pricing Summary (as of June 2026)

| Service | Free Tier | Starting Paid | 50k Emails/mo | 100k Emails/mo | 500k Emails/mo | Overage Rate |
|---|---|---|---|---|---|---|
| **Resend** | 3k/mo (100/day) | $20/mo | $20/mo | $90/mo | $90/mo + $360 = $450 | $0.90/1k |
| **SendGrid** | 100/day | $19.95/mo | ~$20/mo | ~$35/mo | ~$150/mo | ~$0.45/1k (varies) |
| **AWS SES** | 3k/mo (12mo) | $0 pay-as-you-go | $5.00/mo | $10.00/mo | $50.00/mo | $0.10/1k |
| **Mailgun** | 100/day | $15/mo (10k) | $35/mo | $90/mo | $90+$440=$530 | $1.10-1.80/1k |
| **Postmark** | 100/mo | $15/mo (10k) | $15+$72=$87 | $15+$117=$132 | $15+$637=$652 | $1.20-1.80/1k |

> **SES note**: Prices are per 1,000 emails. 50k emails = 50 × $0.10 = $5.00. No base monthly fee. Attachments incur $0.12/GB extra.

#### Detailed Comparison

##### Resend (Recommended Primary)

| Aspect | Rating | Notes |
|---|---|---|
| Developer Experience | Excellent | Modern REST API, official Python SDK, React Email for templates |
| Deliverability | Very Good | DKIM/SPF/DMARC auto-setup, shared pristine IPs |
| Template Support | Excellent | React Email (JSX-based), HTML, visual previews |
| API Quality | Excellent | Clean, consistent REST API, webhooks for all events |
| Free Tier | 3k/mo | Good for development/testing |
| SOC 2 | Yes | Type II certified |
| Unique | Multi-region sending, AI credits for content generation |

**Python SDK usage:**
```python
import resend

resend.api_key = "re_xxxx"

resend.Emails.send({
    "from": "Trend-Scope <alerts@trend-scope.com>",
    "to": ["user@example.com"],
    "subject": "SPY Golden Cross Alert",
    "html": "<h2>SPY triggered Golden Cross!</h2>",
    "tags": [{"name": "alert_type", "value": "golden_cross"}],
})
```

##### SendGrid (Twilio) - Viable Alternative

| Aspect | Rating | Notes |
|---|---|---|
| Market Share | Largest | Sends 200B+ emails/month, mature ecosystem |
| Deliverability | Excellent | Vast IP pool, proven at extreme scale |
| Template Support | Good | Dynamic templates with Handlebars, WYSIWYG editor |
| API Quality | Good | Well-documented but older REST API design |
| Python SDK | Good | Official `sendgrid-python` package |
| Free Tier | 100/day | Sufficient for early dev |
| Drawback | Complex UI | Twilio merger created a bloated console |

##### AWS SES - Cheapest at Scale

| Aspect | Rating | Notes |
|---|---|---|
| Cost | Best | $0.10/1k emails, 62% cheaper than Resend at 100k+ |
| Deliverability | Good | Requires manual SPF/DKIM/DMARC setup, reputation management |
| Template Support | Basic | SES templates (Handlebars-like), no visual builder |
| API Quality | Adequate | AWS SDK (boto3), complex IAM permission model |
| Free Tier | 3k/mo (12mo) | Generous, especially if on EC2 (additional 62k free) |
| Drawback | Setup Complexity | Domain verification, IAM roles, suppression list management manual |

**When to use SES**: As a fallback/cost-optimization for high-volume digests or after exceeding Resend plan limits.

##### Mailgun - Developer-Focused

| Aspect | Rating | Notes |
|---|---|---|
| API Quality | Good | Clean REST API, good docs, multiple SDKs |
| Deliverability | Good | Dedicated IP available at 50k+ volume |
| Template Support | Good | Template builder with API |
| Pricing | Mid-range | $35/mo for 50k, overage $1.30/1k |
| Unique | Inbound email routing, email validation service |

##### Postmark - Fastest Delivery

| Aspect | Rating | Notes |
|---|---|---|
| Delivery Speed | Best | Avg 1.2s delivery, "up to 4x faster than competitors" |
| Transactional Focus | Excellent | Purpose-built for transactional, not marketing |
| API Quality | Good | Clean, well-documented |
| Pricing | Premium | $15/mo for 10k + $1.80/1k overage |
| Free Tier | 100/mo | Very limited for testing |

#### Email Provider Decision Matrix

```
Priority: Good DX, moderate volume (<100k), FastAPI integration
Pick:     Resend ($20/mo = 50k emails)
Fallback: AWS SES (cost control at scale)

For Trend-Scope Phase 5 (early users < 1k):
- Resend Free tier is sufficient during development
- Upgrade to Pro ($20/mo) when approaching 3k/mo
- Switch/add SES if volume exceeds 100k/mo and cost becomes a concern
```

### 2.2 Push Notifications

#### Service Comparison

| Service | Web Push | iOS | Android | Free Tier | Pricing |
|---|---|---|---|---|---|
| **OneSignal** | Yes | Yes | Yes | 10k web subscribers, unlimited mobile | Growth: $19/mo + $0.004/web sub + $0.012/mobile MAU |
| **FCM** (Firebase) | Yes | - | Yes | Unlimited | Free |
| **APNs** | - | Yes | - | Unlimited | Free (Apple Developer account needed) |
| **Web Push API** | Yes | - | - | Unlimited | Free (browser-native) |

#### Recommendation: OneSignal (Phase 5), FCM+APNs (Future Mobile)

**For Phase 5 (Web-first)**:
- OneSignal Free tier: 10k web push subscribers, unlimited sends
- Simple JavaScript SDK integration in the Next.js admin/future user frontend
- Single API for push token management

**OneSignal Web Push integration outline:**
```javascript
// In Next.js / React user frontend
import OneSignal from 'onesignal-cordova-plugin'; // or Web SDK

// Initialize
window.OneSignal = window.OneSignal || [];
OneSignal.push(function() {
    OneSignal.init({
        appId: "YOUR_APP_ID",
    });
});

// Register user
OneSignal.push(function() {
    OneSignal.setExternalUserId("user_123");
});
```

**Python backend - sending a push via OneSignal API:**
```python
import httpx

async def send_push_notification(user_id: str, title: str, message: str):
    async with httpx.AsyncClient() as client:
        await client.post(
            "https://onesignal.com/api/v1/notifications",
            headers={"Authorization": "Basic YOUR_REST_API_KEY"},
            json={
                "app_id": "YOUR_APP_ID",
                "include_external_user_ids": [user_id],
                "headings": {"en": title},
                "contents": {"en": message},
                "data": {"alert_type": "golden_cross", "symbol": "SPY"},
            },
        )
```

**For Future Mobile Apps**: Use FCM (Android) and APNs (iOS) directly. Both are free and give full control. At that point, evaluate whether to keep OneSignal as an abstraction layer or manage both natively.

#### Web Push API (Browser-Native, No Service Needed)

For a lightweight approach without external dependencies:
```javascript
// Register service worker
navigator.serviceWorker.register('/sw.js');

// Request permission
const permission = await Notification.requestPermission();

// Subscribe to push
const registration = await navigator.serviceWorker.ready;
const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array('PUBLIC_VAPID_KEY'),
});

// Send subscription object to backend
await fetch('/api/v1/push/subscribe', {
    method: 'POST',
    body: JSON.stringify(subscription),
});
```

Python backend sends push using `pywebpush` library.

> **Decision**: Phase 5 uses **OneSignal Free** for simplicity (single SDK for web+future mobile). Evaluate Web Push API directly if costs become an issue.

### 2.3 SMS

| Service | US Price/msg | Global Coverage | Free Tier | Notes |
|---|---|---|---|---|
| **Twilio SMS** | $0.0083 + $0.0035-0.0045 carrier = **~$0.012** | 180+ countries | Trial credit | Industry standard |
| **AWS SNS** | $0.00581 (US) | 200+ countries | 100 SMS/mo | AWS integrated, cheaper |
| **Alibaba Cloud SMS** | ~$0.002 (China) | China-focused | Pay as you go | Chinese users only |

> SMS is **not recommended for Phase 5**. Cost per message is high (~$0.01-0.02/msg), and SMS is best for urgent alerts. For a stock analysis platform, email + push cover the use case. Add SMS as a Pro tier premium feature after validating demand.

**If SMS is added later**:
- US/International users: **Twilio** (best global infrastructure, $0.012/msg)
- Chinese users: **Alibaba Cloud SMS** (required for CN mobile numbers)
- Cost-conscious: **AWS SNS** (30-50% cheaper than Twilio for US)

### 2.4 In-App Notifications

#### WebSocket Real-Time Delivery

Architecture for delivering alerts to the browser in real-time:

```
Backend                          Redis                   Frontend
───────                          ─────                   ────────
Alert generated ──► Publish to ──► channel:user:123
                                        │
                                        ▼
                   WebSocket Manager ◄── Subscribe
                         │
                         ▼
                   Send via WS ──────► Browser receives
                                       update notification
```

**FastAPI WebSocket endpoint:**
```python
from fastapi import WebSocket, WebSocketDisconnect
from app.core.deps import get_current_user_ws

class WSConnectionManager:
    def __init__(self):
        self.connections: dict[int, list[WebSocket]] = {}

    async def connect(self, user_id: int, ws: WebSocket):
        await ws.accept()
        if user_id not in self.connections:
            self.connections[user_id] = []
        self.connections[user_id].append(ws)

    def disconnect(self, user_id: int, ws: WebSocket):
        if user_id in self.connections:
            self.connections[user_id].remove(ws)

    async def send_to_user(self, user_id: int, data: dict):
        for ws in self.connections.get(user_id, []):
            try:
                await ws.send_json(data)
            except Exception:
                pass

manager = WSConnectionManager()

@router.websocket("/ws/alerts")
async def alerts_websocket(ws: WebSocket, current_user = Depends(get_current_user_ws)):
    await manager.connect(current_user.id, ws)
    try:
        while True:
            await ws.receive_text()  # keep-alive
    except WebSocketDisconnect:
        manager.disconnect(current_user.id, ws)
```

For production with multiple uvicorn workers, use **Redis Pub/Sub** as the message broker:
```python
import redis.asyncio as redis

async def broadcast_alert(user_id: int, alert_data: dict):
    r = redis.Redis()
    await r.publish(f"user:{user_id}:alerts", json.dumps(alert_data))
```

#### Notification Center / Inbox UI Pattern

Database-backed notification center stores all alerts for a user:

```
┌─────────────────────────────────────┐
│ 🔔 Notifications              (3)   │
├─────────────────────────────────────┤
│ 🔴 SPY Golden Cross             2m  │
│    MA20 crossed above MA60 at $605  │
├─────────────────────────────────────┤
│    QQQ Death Cross              1h  │
│    MA20 crossed below MA60 at $520  │
├─────────────────────────────────────┤
│ ⚠️  IWM Risk: Moderate → Elevated 3h│
├─────────────────────────────────────┤
│         Mark all as read             │
└─────────────────────────────────────┘
```

- **Unread badge count**: `SELECT COUNT(*) FROM notification_inbox WHERE user_id = ? AND is_read = FALSE`
- **Mark read**: Single item or bulk API call
- **Pagination**: 20 items per page, cursor-based
- **Expiry**: Soft-delete or archive after 30 days

---

## 3. Notification Architecture

### 3.1 Event-Driven Design

```
┌──────────────┐     ┌──────────────┐     ┌───────────────┐
│ Signal       │────►│ Event        │────►│ Notification  │
│ Generated    │     │ Emitted      │     │ Dispatcher    │
│ (analysis    │     │ (internal    │     │               │
│  engine)     │     │  event bus)  │     │               │
└──────────────┘     └──────────────┘     └───────┬───────┘
                                                  │
                          ┌───────────────────────┼───────────────────────┐
                          │                       │                       │
                          ▼                       ▼                       ▼
                    ┌──────────┐           ┌──────────┐           ┌──────────┐
                    │ Email    │           │ Push     │           │ In-App   │
                    │ Channel  │           │ Channel  │           │ Channel  │
                    │ (Resend) │           │(OneSignal│           │(WebSocket│
                    │          │           │  /FCM)   │           │  /Redis) │
                    └──────────┘           └──────────┘           └──────────┘
```

**Event flow**:
1. `AnalysisEngine` runs daily scan job (APScheduler)
2. Detects new signal → creates `AnalysisSignal` record
3. Emits internal event: `SignalGeneratedEvent(signal_id, stock_id, signal_type, ...)`
4. `NotificationDispatcher` receives event → queries matching alerts
5. For each matching alert → checks user preferences (quiet hours, channel settings)
6. Dispatches to enabled channels via `ChannelAdapter` interface

### 3.2 Channel Adapter Pattern

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass

@dataclass
class NotificationPayload:
    user_id: int
    alert_id: int
    alert_type: str
    title: str
    body: str
    data: dict  # {symbol, price, ma_short, ma_long, etc.}
    channels: list[str]  # ["email", "push", "sms"]


class ChannelAdapter(ABC):
    @abstractmethod
    async def send(self, payload: NotificationPayload) -> bool:
        ...


class EmailChannel(ChannelAdapter):
    async def send(self, payload: NotificationPayload) -> bool:
        # Resend API call
        ...

class PushChannel(ChannelAdapter):
    async def send(self, payload: NotificationPayload) -> bool:
        # OneSignal API call
        ...

class SMSChannel(ChannelAdapter):
    async def send(self, payload: NotificationPayload) -> bool:
        # Twilio API call
        ...

class InAppChannel(ChannelAdapter):
    async def send(self, payload: NotificationPayload) -> bool:
        # Redis pub/sub + WebSocket broadcast
        ...
```

### 3.3 Template System

Template rendering with multi-language support:

```python
from enum import Enum
from string import Template

class AlertTemplate(Enum):
    GOLDEN_CROSS = "golden_cross"
    DEATH_CROSS = "death_cross"
    PRICE_ABOVE = "price_above"
    PRICE_BELOW = "price_below"
    RISK_CHANGE = "risk_change"
    VOLUME_SPIKE = "volume_spike"
    BULLISH_ALIGNMENT = "bullish_alignment"
    BEARISH_ALIGNMENT = "bearish_alignment"
    SUBSCRIPTION_EXPIRING = "subscription_expiring"
    WEEKLY_DIGEST = "weekly_digest"
    SYSTEM = "system"


TEMPLATES = {
    "en": {
        AlertTemplate.GOLDEN_CROSS: {
            "title": "{symbol} Golden Cross Alert",
            "body": (
                "{symbol} triggered a golden cross! "
                "MA{ma_short}({ma_short_val:.2f}) crossed above "
                "MA{ma_long}({ma_long_val:.2f}) at ${price:.2f}"
            ),
        },
        AlertTemplate.DEATH_CROSS: {
            "title": "{symbol} Death Cross Alert",
            "body": (
                "{symbol} triggered a death cross! "
                "MA{ma_short}({ma_short_val:.2f}) crossed below "
                "MA{ma_long}({ma_long_val:.2f}) at ${price:.2f}"
            ),
        },
        AlertTemplate.PRICE_ABOVE: {
            "title": "{symbol} Price Alert",
            "body": "{symbol} reached ${price:.2f} (above your threshold of ${threshold:.2f})",
        },
        AlertTemplate.PRICE_BELOW: {
            "title": "{symbol} Price Alert",
            "body": "{symbol} dropped to ${price:.2f} (below your threshold of ${threshold:.2f})",
        },
        AlertTemplate.RISK_CHANGE: {
            "title": "{symbol} Risk Level Changed",
            "body": "{symbol} risk level changed from {old_level} to {new_level}",
        },
        AlertTemplate.VOLUME_SPIKE: {
            "title": "{symbol} Unusual Volume",
            "body": "{symbol} volume ({volume:,}) is {multiplier:.1f}x the 20-day average",
        },
        AlertTemplate.BULLISH_ALIGNMENT: {
            "title": "{symbol} Bullish Alignment",
            "body": "{symbol} trend alignment is now bullish (MA5 > MA20 > MA60 > MA120)",
        },
        AlertTemplate.BEARISH_ALIGNMENT: {
            "title": "{symbol} Bearish Alignment",
            "body": "{symbol} trend alignment is now bearish (MA5 < MA20 < MA60 < MA120)",
        },
        AlertTemplate.SUBSCRIPTION_EXPIRING: {
            "title": "Subscription Expiring Soon",
            "body": "Your {tier_name} subscription expires in {days_remaining} days. Renew to keep your alerts active.",
        },
        AlertTemplate.WEEKLY_DIGEST: {
            "title": "Weekly Market Summary - {date_range}",
            "body": "Your weekly digest is ready. {signal_count} new signals, {alert_count} alerts triggered.",
        },
        AlertTemplate.SYSTEM: {
            "title": "Trend-Scope: {subject}",
            "body": "{message}",
        },
    },
    "zh": {
        AlertTemplate.GOLDEN_CROSS: {
            "title": "{symbol} 金叉提醒",
            "body": (
                "{symbol} 触发金叉信号！"
                "MA{ma_short}({ma_short_val:.2f}) 上穿 "
                "MA{ma_long}({ma_long_val:.2f})，当前价格 ${price:.2f}"
            ),
        },
        AlertTemplate.DEATH_CROSS: {
            "title": "{symbol} 死叉提醒",
            "body": (
                "{symbol} 触发死叉信号！"
                "MA{ma_short}({ma_short_val:.2f}) 下穿 "
                "MA{ma_long}({ma_long_val:.2f})，当前价格 ${price:.2f}"
            ),
        },
        # ... (other Chinese templates)
    },
}


class TemplateRenderer:
    def __init__(self, user_locale: str = "en"):
        self.locale = user_locale if user_locale in TEMPLATES else "en"

    def render(self, template: AlertTemplate, **kwargs) -> tuple[str, str]:
        t = TEMPLATES[self.locale][template]
        title = t["title"].format(**kwargs)
        body = t["body"].format(**kwargs)
        return title, body
```

### 3.4 Notification Preferences Model

```python
# User notification preference settings
class UserNotificationPref:
    user_id: int
    locale: str  # "en" | "zh"

    # Per-channel master switches
    email_enabled: bool = True
    push_enabled: bool = True
    sms_enabled: bool = False
    inapp_enabled: bool = True

    # Quiet hours (UTC)
    quiet_hours_enabled: bool = False
    quiet_hours_start: time = 22:00  # 10 PM
    quiet_hours_end: time = 07:00    # 7 AM
    quiet_hours_timezone: str = "US/Eastern"

    # Digest mode (daily summary instead of real-time)
    digest_mode: bool = False
    digest_time: time = 18:00  # 6 PM daily

    # Per-stock alert toggles
    stock_alert_settings: dict  # {stock_id: bool}


# Per-alert configuration (stored in alert record)
class AlertConfig:
    id: int
    user_id: int
    stock_id: int
    alert_type: str  # golden_cross, death_cross, price_above, etc.
    threshold: Decimal | None  # for price alerts
    channels: list[str]  # ["email", "push"]
    is_active: bool = True
```

**Preference evaluation flow:**
```python
async def should_send_notification(user_id: int, alert_id: int, channel: str) -> bool:
    prefs = await get_user_prefs(user_id)
    alert = await get_alert(alert_id)

    # 1. Master switch
    if not prefs.channel_enabled(channel):
        return False

    # 2. Stock-level check
    if not prefs.stock_alert_settings.get(alert.stock_id, True):
        return False

    # 3. Quiet hours check
    if prefs.quiet_hours_enabled:
        user_now = datetime.now(prefs.quiet_hours_timezone).time()
        if prefs.quiet_hours_start <= prefs.quiet_hours_end:
            # Normal range (e.g., 22:00 - 07:00)
            if user_now >= prefs.quiet_hours_start or user_now < prefs.quiet_hours_end:
                return False  # Queue for later delivery or skip
        else:
            # Inverted range
            if prefs.quiet_hours_end <= user_now < prefs.quiet_hours_start:
                if prefs.digest_mode:
                    await queue_for_digest(user_id, alert_id, channel)
                return False

    # 4. Digest mode
    if prefs.digest_mode and channel != "inapp":
        await queue_for_digest(user_id, alert_id, channel)
        return False  # Don't send real-time; include in next digest

    return True
```

---

## 4. Alert Types & Triggers

### 4.1 Alert Type Catalog

| # | Alert Type | Trigger Source | Channels | Priority | Rate Limit |
|---|---|---|---|---|---|
| 1 | Golden Cross | `AnalysisEngine.scan_signals()` | Email, Push, In-App | High | 1 per stock per direction per 5 trading days |
| 2 | Death Cross | `AnalysisEngine.scan_signals()` | Email, Push, In-App | High | 1 per stock per direction per 5 trading days |
| 3 | Bullish Alignment | `AnalysisEngine.check_alignment()` | Email, Push, In-App | Medium | 1 per stock per alignment change |
| 4 | Bearish Alignment | `AnalysisEngine.check_alignment()` | Email, Push, In-App | Medium | 1 per stock per alignment change |
| 5 | Price Above Threshold | `AnalysisEngine.check_price()` (intraday) | Email, Push, In-App | Medium | Once per threshold breach |
| 6 | Price Below Threshold | `AnalysisEngine.check_price()` (intraday) | Email, Push, In-App | Medium | Once per threshold breach |
| 7 | Volume Spike | `AnalysisEngine.check_volume()` | Email, In-App | Low | 1 per stock per day |
| 8 | Risk Level Change | `AnalysisEngine.evaluate_risk()` | Email, Push, In-App | Medium | Once per level change |
| 9 | Subscription Expiring | `SubscriptionService.check_expiry()` | Email | High | 7, 3, 1 days before + day of |
| 10 | Weekly Market Digest | APScheduler cron (Sun 18:00) | Email | Low | 1 per week |
| 11 | System Announcement | Admin dashboard manual trigger | Email, Push, In-App | Medium | As needed |

### 4.2 Trigger Flow Detail

**Daily signal scan (APScheduler)**:
```
1. sync_daily_prices  →  Pull latest price data from yfinance
2. scan_signals       →  Calculate MAs, detect crosses, evaluate risk
3. emit_events        →  For each new signal:
    ├── Golden Cross → SignalGeneratedEvent
    ├── Death Cross  → SignalGeneratedEvent
    ├── Risk Change  → RiskChangedEvent
    └── Volume Spike  → VolumeSpikeEvent
4. dispatch_alerts    →  NotificationDispatcher processes events
```

**Price alert check (more frequent)**:
```
APScheduler every 15 minutes during market hours (9:30-16:00 ET):
1. Fetch latest prices for stocks with active price alerts
2. Compare against thresholds
3. Emit PriceAlertTriggeredEvent if threshold crossed
4. Mark alert as triggered (no repeat until price crosses back)
```

### 4.3 Alert Deduplication

```python
async def is_duplicate_alert(
    user_id: int, stock_id: int, alert_type: str, window_hours: int = 24
) -> bool:
    """Prevent sending the same alert type for the same stock to the same user within window."""
    cutoff = datetime.utcnow() - timedelta(hours=window_hours)
    existing = await db.execute(
        select(AlertLog).where(
            AlertLog.user_id == user_id,
            AlertLog.stock_id == stock_id,
            AlertLog.alert_type == alert_type,
            AlertLog.sent_at >= cutoff,
        )
    )
    return existing.scalar_one_or_none() is not None
```

---

## 5. Delivery & Reliability

### 5.1 Retry Logic with Exponential Backoff

```python
import asyncio
from dataclasses import dataclass

@dataclass
class RetryConfig:
    max_retries: int = 3
    base_delay: float = 1.0   # seconds
    max_delay: float = 60.0   # seconds
    backoff_factor: float = 2.0


async def send_with_retry(
    adapter: ChannelAdapter,
    payload: NotificationPayload,
    config: RetryConfig = RetryConfig(),
) -> bool:
    last_exception = None
    for attempt in range(config.max_retries + 1):
        try:
            success = await adapter.send(payload)
            if success:
                return True
        except Exception as e:
            last_exception = e

        if attempt < config.max_retries:
            delay = min(
                config.base_delay * (config.backoff_factor ** attempt),
                config.max_delay,
            )
            await asyncio.sleep(delay)

    # All retries exhausted → dead letter queue
    await move_to_dlq(payload, str(last_exception))
    return False
```

### 5.2 Dead Letter Queue (DLQ)

Failed notifications stored in a database table for manual review/replay:

```sql
CREATE TABLE notification_dlq (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    alert_id BIGINT,
    channel VARCHAR(20) NOT NULL,
    payload JSON NOT NULL,
    error_message TEXT,
    retry_count INT DEFAULT 0,
    status ENUM('pending', 'retrying', 'failed_permanent', 'replayed') DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_retry_at DATETIME,
    INDEX idx_status (status),
    INDEX idx_user (user_id)
);
```

**DLQ retry job** (APScheduler, every 15 minutes):
```python
async def process_dlq():
    items = await fetch_dlq_items(status="pending", limit=50)
    for item in items:
        success = await retry_notification(item)
        if success:
            await mark_replayed(item.id)
        else:
            item.retry_count += 1
            if item.retry_count >= 5:
                await mark_permanent_failure(item.id)
```

### 5.3 Rate Limiting

```python
import redis.asyncio as redis
from datetime import datetime

class NotificationRateLimiter:
    """Rate limit notifications per user per channel to avoid spam."""

    def __init__(self, redis_client: redis.Redis):
        self.redis = redis_client

    async def check_and_increment(
        self,
        user_id: int,
        channel: str,
        max_per_hour: int = 10,
        max_per_day: int = 50,
    ) -> bool:
        """Returns True if within limits, False if exceeded."""
        hour_key = f"ratelimit:notif:{user_id}:{channel}:{datetime.utcnow().strftime('%Y%m%d%H')}"
        day_key = f"ratelimit:notif:{user_id}:{channel}:{datetime.utcnow().strftime('%Y%m%d')}"

        hour_count = await self.redis.incr(hour_key)
        day_count = await self.redis.incr(day_key)

        await self.redis.expire(hour_key, 3600)
        await self.redis.expire(day_key, 86400)

        if hour_count > max_per_hour or day_count > max_per_day:
            return False
        return True
```

### 5.4 Delivery Status Tracking

```python
class DeliveryStatus(enum.Enum):
    PENDING = "pending"         # Queued for delivery
    SENT = "sent"               # Handed off to provider
    DELIVERED = "delivered"     # Provider confirmed delivery
    OPENED = "opened"           # Email opened (if tracking)
    CLICKED = "clicked"         # Link clicked (if tracking)
    BOUNCED = "bounced"         # Hard/soft bounce
    FAILED = "failed"           # Delivery failure
    COMPLAINT = "complaint"     # Marked as spam


# Webhook endpoint for Resend delivery events
@router.post("/webhooks/resend")
async def resend_webhook(payload: dict):
    event_type = payload.get("type")
    email_id = payload["data"]["email_id"]

    if event_type == "email.delivered":
        await update_delivery_status(email_id, DeliveryStatus.DELIVERED)
    elif event_type == "email.opened":
        await update_delivery_status(email_id, DeliveryStatus.OPENED)
    elif event_type == "email.clicked":
        await update_delivery_status(email_id, DeliveryStatus.CLICKED)
    elif event_type == "email.bounced":
        await update_delivery_status(email_id, DeliveryStatus.BOUNCED)
    elif event_type == "email.complained":
        await update_delivery_status(email_id, DeliveryStatus.COMPLAINT)
```

### 5.5 External Webhook Integrations

Support webhooks so power users can pipe alerts to Slack, Discord, or custom systems:

```python
# User configures a webhook URL in their notification settings
class WebhookIntegration:
    id: int
    user_id: int
    url: str  # https://hooks.slack.com/services/...
    secret: str  # for HMAC signature
    event_types: list[str]  # ["golden_cross", "death_cross", ...]
    is_active: bool = True


async def send_webhook(integration: WebhookIntegration, alert_data: dict):
    payload = {
        "event": alert_data["alert_type"],
        "symbol": alert_data["symbol"],
        "message": alert_data["body"],
        "timestamp": datetime.utcnow().isoformat(),
    }
    signature = hmac.new(
        integration.secret.encode(),
        json.dumps(payload).encode(),
        hashlib.sha256,
    ).hexdigest()

    async with httpx.AsyncClient() as client:
        await client.post(
            integration.url,
            json=payload,
            headers={"X-TrendScope-Signature": signature},
            timeout=10,
        )
```

---

## 6. Implementation Guide

### 6.1 Python Libraries

```txt
# requirements.txt additions

# Email
resend>=1.0.0              # Resend SDK
# OR
boto3>=1.34.0              # AWS SES (alternative)
sendgrid>=6.0.0            # SendGrid (alternative)

# Push notifications
pywebpush>=1.14.0          # Web Push API (browser-native)
httpx>=0.28.0              # OneSignal REST API calls

# SMS (future)
twilio>=9.0.0              # Twilio SDK

# Async & scheduling
apscheduler>=4.0.0         # Already in stack - digest schedules
redis>=5.0.0               # Already in stack - pub/sub, rate limiting
celery>=5.3.0              # Optional: if migrating from APScheduler for heavy async
aiosmtplib>=3.0.0          # SMTP library (if self-hosting email)

# Template engines
jinja2>=3.1.0              # For HTML email templates
```

### 6.2 Integration with FastAPI Background Tasks vs Celery

**Phase 5 Recommendation: FastAPI BackgroundTasks**

For low-to-medium volume (hundreds of alerts/day), FastAPI's built-in `BackgroundTasks` is sufficient:
```python
from fastapi import BackgroundTasks, APIRouter

router = APIRouter()

@router.post("/alerts/test")
async def test_alert(alert_data: AlertCreate, background_tasks: BackgroundTasks):
    background_tasks.add_task(dispatch_notification, alert_data)
    return {"status": "queued"}
```

**Pros**: No extra infrastructure. Simple. Works for Phase 5.
**Cons**: No retry, no monitoring, blocks if server restarts.

**Phase 6+ Migration: Celery**

When alert volume grows (thousands+ alerts/day or price alerts at 15-min intervals), migrate to Celery:

```python
# celery_app.py
from celery import Celery

celery_app = Celery(
    "trendscope",
    broker="redis://localhost:6379/0",
    backend="redis://localhost:6379/1",
)

# tasks/notifications.py
@celery_app.task(
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    acks_late=True,
)
def send_email_alert(self, user_id, alert_data):
    try:
        # Resend API call
        resend.Emails.send(...)
    except Exception as exc:
        raise self.retry(exc=exc)

# Dispatch call
from tasks.notifications import send_email_alert
send_email_alert.delay(user_id=123, alert_data={...})
```

**Celery features**: Retry with backoff, task monitoring (Flower), scheduled tasks (Celery Beat replaces APScheduler), priority queues, rate limiting built-in.

### 6.3 Digest Scheduler

```python
# scheduler/jobs.py
from apscheduler.triggers.cron import CronTrigger

async def send_daily_digests():
    """Send daily digest to users with digest_mode enabled."""
    users = await get_digest_users()  # users with digest_mode=True
    for user in users:
        alerts_today = await get_queued_digest_alerts(user.id)
        if not alerts_today:
            continue

        title, body = render_digest(user, alerts_today)
        await dispatcher.send(user, channel="email", title=title, body=body)
        await clear_digest_queue(user.id)


async def send_weekly_summaries():
    """Sunday evening: weekly market summary for all paying users."""
    # Similar to daily digest but aggregates weekly stats


# Register in scheduler/runner.py
scheduler.add_job(
    send_daily_digests,
    CronTrigger(hour=18, minute=0, timezone="US/Eastern"),
    id="daily_digest",
)
scheduler.add_job(
    send_weekly_summaries,
    CronTrigger(day_of_week="sun", hour=18, minute=0, timezone="US/Eastern"),
    id="weekly_summary",
)
```

### 6.4 Full Directory Structure for Notification Module

```
backend/app/
├── notifications/
│   ├── __init__.py
│   ├── channels/
│   │   ├── __init__.py
│   │   ├── base.py              # ChannelAdapter ABC
│   │   ├── email_channel.py     # Resend implementation
│   │   ├── push_channel.py      # OneSignal implementation
│   │   ├── sms_channel.py       # Twilio (future)
│   │   └── inapp_channel.py     # WebSocket + Redis
│   ├── templates/
│   │   ├── __init__.py
│   │   ├── renderer.py          # TemplateRenderer + i18n
│   │   └── locales/
│   │       ├── en.py            # English templates
│   │       └── zh.py            # Chinese templates
│   ├── dispatcher.py            # NotificationDispatcher
│   ├── rate_limiter.py          # Redis-based rate limiting
│   ├── deduplicator.py          # Duplicate detection
│   ├── dlq.py                   # Dead letter queue processor
│   └── webhooks.py              # Resend/OneSignal webhook endpoints
```

---

## 7. Database Schema

### 7.1 Extended Schema (replaces Phase 1 draft tables)

```sql
-- ==================== Notification Preferences ====================
CREATE TABLE notification_preferences (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    locale VARCHAR(10) DEFAULT 'en',
    email_enabled BOOLEAN DEFAULT TRUE,
    push_enabled BOOLEAN DEFAULT TRUE,
    sms_enabled BOOLEAN DEFAULT FALSE,
    inapp_enabled BOOLEAN DEFAULT TRUE,
    quiet_hours_enabled BOOLEAN DEFAULT FALSE,
    quiet_hours_start TIME,
    quiet_hours_end TIME,
    quiet_hours_timezone VARCHAR(50) DEFAULT 'US/Eastern',
    digest_mode BOOLEAN DEFAULT FALSE,
    digest_time TIME DEFAULT '18:00:00',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ==================== Stock-Level Alert Settings ====================
CREATE TABLE stock_alert_settings (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stock_id BIGINT NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
    alerts_enabled BOOLEAN DEFAULT TRUE,
    UNIQUE KEY uk_user_stock (user_id, stock_id)
);

-- ==================== Alert Rules ====================
CREATE TABLE alert_rules (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stock_id BIGINT NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
    alert_type ENUM(
        'golden_cross', 'death_cross',
        'bullish_alignment', 'bearish_alignment',
        'price_above', 'price_below',
        'volume_spike', 'risk_change',
        'subscription_expiring', 'weekly_digest', 'system'
    ) NOT NULL,
    threshold DECIMAL(12,4),            -- Price threshold for price alerts
    channels JSON NOT NULL DEFAULT '["email"]',
    -- ["email", "push", "sms", "inapp"]
    is_active BOOLEAN DEFAULT TRUE,
    last_triggered_at DATETIME,         -- For deduplication window
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_stock (user_id, stock_id),
    INDEX idx_alert_type (alert_type),
    INDEX idx_active_type (is_active, alert_type)
);

-- ==================== Alert Logs ====================
CREATE TABLE alert_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    alert_rule_id BIGINT REFERENCES alert_rules(id) ON DELETE SET NULL,
    user_id BIGINT NOT NULL REFERENCES users(id),
    stock_id BIGINT NOT NULL REFERENCES stocks(id),
    alert_type VARCHAR(50) NOT NULL,
    channel VARCHAR(20) NOT NULL,       -- email, push, sms, inapp, webhook
    title VARCHAR(500) NOT NULL,
    body TEXT NOT NULL,
    context_data JSON,                  -- {symbol, price, ma_short, ma_long, ...}
    provider_message_id VARCHAR(255),   -- Resend email_id, OneSignal notif_id
    delivery_status ENUM(
        'pending', 'sent', 'delivered', 'opened', 'clicked',
        'bounced', 'failed', 'complaint'
    ) DEFAULT 'pending',
    error_message TEXT,
    sent_at DATETIME,
    delivered_at DATETIME,
    opened_at DATETIME,
    clicked_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_delivery_status (delivery_status),
    INDEX idx_created (created_at)
);

-- ==================== Notification Inbox ====================
CREATE TABLE notification_inbox (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    alert_log_id BIGINT REFERENCES alert_logs(id) ON DELETE SET NULL,
    alert_type VARCHAR(50) NOT NULL,
    title VARCHAR(500) NOT NULL,
    body TEXT NOT NULL,
    data JSON,
    is_read BOOLEAN DEFAULT FALSE,
    read_at DATETIME,
    is_deleted BOOLEAN DEFAULT FALSE,   -- Soft delete
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_unread (user_id, is_read),
    INDEX idx_user_created (user_id, created_at DESC)
);

-- ==================== Digest Queue ====================
CREATE TABLE digest_queue (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    alert_log_id BIGINT NOT NULL REFERENCES alert_logs(id) ON DELETE CASCADE,
    digest_type ENUM('daily', 'weekly') DEFAULT 'daily',
    is_delivered BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_delivered (user_id, is_delivered, created_at)
);

-- ==================== Webhook Integrations ====================
CREATE TABLE webhook_integrations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    url VARCHAR(500) NOT NULL,
    secret VARCHAR(64) NOT NULL,        -- HMAC signing secret
    event_types JSON NOT NULL,          -- ["golden_cross", "death_cross", ...]
    is_active BOOLEAN DEFAULT TRUE,
    last_delivery_at DATETIME,
    last_delivery_status VARCHAR(20),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ==================== Dead Letter Queue ====================
CREATE TABLE notification_dlq (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    alert_log_id BIGINT REFERENCES alert_logs(id),
    user_id BIGINT NOT NULL,
    channel VARCHAR(20) NOT NULL,
    payload JSON NOT NULL,
    error_message TEXT,
    retry_count INT DEFAULT 0,
    status ENUM('pending', 'retrying', 'failed_permanent', 'replayed') DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_retry_at DATETIME,
    INDEX idx_status (status)
);

-- ==================== Push Device Tokens ====================
CREATE TABLE push_device_tokens (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform ENUM('web', 'ios', 'android') NOT NULL,
    token VARCHAR(500) NOT NULL,
    device_info VARCHAR(500),
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_token (token),
    INDEX idx_user_platform (user_id, platform)
);
```

---

## 8. Cost Projections

### 8.1 Email Cost Scenarios

| User Count | Avg Alerts/User/mo | Total Emails/mo | Resend Cost | AWS SES Cost |
|---|---|---|---|---|
| 100 users | 15 | 1,500 | **$0** (Free tier) | $0.15 |
| 500 users | 20 | 10,000 | **$0** (Free - 3k; $6.30 overage) | $1.00 |
| 1,000 users | 20 | 20,000 | **$20**/mo (Pro) | $2.00 |
| 5,000 users | 25 | 125,000 | **$90 + $22.50 = $112.50** | $12.50 |
| 10,000 users | 30 | 300,000 | **$90 + $225 = $315** | $30.00 |
| 50,000 users | 30 | 1,500,000 | **$90 + $1,305 = $1,395** | $150.00 |

> **Conclusion**: Resend at scale ($315/mo for 10k users) is reasonable. SES ($30/mo for 10k users) is dramatically cheaper but requires more DevOps. **Start with Resend Pro ($20/mo); switch to SES if monthly cost exceeds $100.**

### 8.2 Push Notification Cost Scenarios

| User Count | Web Push Subscribers | OneSignal Cost |
|---|---|---|
| 100 | 30 | **$0** (Free - 10k subs) |
| 1,000 | 300 | **$0** |
| 10,000 | 3,000 | **$0** |
| 50,000 | 15,000 | $0.004 × 15,000 = **$60/mo** |
| 100,000 | 30,000 | $0.004 × 30,000 = **$120/mo** |

> **Web Push is effectively free until ~12,500 subscribers.** OneSignal Free covers 10k web subs. For Trend-Scope, this won't be a cost concern until substantial scale.

### 8.3 SMS Cost Scenarios (Future Reference)

| Messages/mo | Twilio Cost (US) | AWS SNS Cost (US) |
|---|---|---|
| 100 | $1.20 | $0.58 |
| 1,000 | $12.00 | $5.81 |
| 10,000 | $120.00 | $58.10 |

> SMS is 10-20x more expensive per message than email. Reserve for Pro tier only, and cap Pro users at 20 SMS alerts/month.

### 8.4 Total Monthly Cost Projection

| Phase | Users | Channels | Est. Monthly Cost |
|---|---|---|---|
| P5 (Launch) | <500 | Email (Resend Free) | **$0/mo** |
| P5+ Growth | 500-5k | Email (Resend Pro) + Web Push (OneSignal Free) | **$20/mo** |
| P6+ Scale | 5k-50k | Email (SES) + Push (OneSignal) + In-App (Redis) | **$50-100/mo** |
| Future | 50k+ | Email (SES) + Push (OneSignal) + SMS (Twilio) | **$200-500/mo** |

---

## Appendix A: Quick Start - Resend Email Integration

```python
# backend/app/notifications/channels/email_channel.py
import resend
from app.core.config import settings

resend.api_key = settings.RESEND_API_KEY

async def send_email(
    to: str,
    subject: str,
    html: str,
    from_: str = "Trend-Scope <alerts@trend-scope.com>",
) -> str:
    """Send email via Resend. Returns the email ID for tracking."""
    response = resend.Emails.send({
        "from": from_,
        "to": [to],
        "subject": subject,
        "html": html,
    })
    return response["id"]
```

**Required environment variables:**
```bash
RESEND_API_KEY=re_xxxxxxxxxxxx
RESEND_FROM_EMAIL=alerts@trend-scope.com
ONESIGNAL_APP_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
ONESIGNAL_REST_API_KEY=xxxxxxxxxxxxxxxxxxxx
TWILIO_ACCOUNT_SID=ACxxxxxxxxxx        # (future)
TWILIO_AUTH_TOKEN=xxxxxxxxxxxx         # (future)
```

---

## Appendix B: Service Comparison Quick Reference

| Factor | Resend | SendGrid | AWS SES | Mailgun | Postmark |
|---|---|---|---|---|---|
| **Cost @ 50k** | $20/mo | ~$20/mo | $5/mo | $35/mo | $87/mo |
| **Cost @ 100k** | $90/mo | ~$35/mo | $10/mo | $90/mo | $132/mo |
| **Python SDK** | Yes (official) | Yes (official) | boto3 | Yes (community) | No official |
| **Template Engine** | React Email | Handlebars | SES Templates | Template API | Basic Templates |
| **Delivery Speed** | Fast | Fast | Good | Good | Fastest |
| **Webhook Events** | All | All | Via SNS | All | All |
| **Domain Setup** | Easy | Moderate | Complex | Easy | Easy |
| **SOC 2** | Yes | Yes | Yes | Yes | Yes |
| **Free Tier** | 3k/mo | 100/day | 3k/mo (12mo) | 100/day | 100/mo |

> **For Trend-Scope**: Resend offers the best balance of developer experience, cost, and features for a Phase 5 launch. AWS SES is the logical cost-optimization path at scale.

---

## Change Record

| Version | Date | Change |
|---|---|---|
| v1 | 2026-06-09 | Initial comprehensive research. Service pricing, architecture patterns, DB schema, implementation guide. |
