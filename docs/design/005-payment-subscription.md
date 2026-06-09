# 005 — Payment & Subscription System Design

> **Status**: Draft v1
> **Date**: 2026-06-09
> **Purpose**: Comprehensive design for the Trend-Scope payment and subscription system, covering pricing model, Stripe integration, subscription state machine, abstract provider interface, API endpoints, tier management middleware, revenue analytics, edge cases, and testing strategy.
>
> **Depends on**:
> - [001-preliminary-design.md](001-preliminary-design.md) — overall architecture, DB schema, tier matrix
> - [../research/008-subscription.md](../research/008-subscription.md) — payment provider research
> - [../research/001-business-model.md](../research/001-business-model.md) — pricing benchmark

---

## Table of Contents

1. [Pricing Model](#1-pricing-model)
2. [Stripe Integration Architecture](#2-stripe-integration-architecture)
3. [Subscription State Machine](#3-subscription-state-machine)
4. [PaymentProvider Abstract Interface](#4-paymentprovider-abstract-interface)
5. [API Integration](#5-api-integration)
6. [Tier Management (Admin)](#6-tier-management-admin)
7. [Subscription Guard Middleware](#7-subscription-guard-middleware)
8. [Revenue Analytics](#8-revenue-analytics)
9. [Edge Cases & Error Handling](#9-edge-cases--error-handling)
10. [Testing Strategy](#10-testing-strategy)

---

## 1. Pricing Model

### 1.1 Three-Tier Structure

| Tier | Monthly | Yearly (17% off) | Target Persona |
|---|---|---|---|
| **Free** | $0 | — | Passive accumulators, lead gen |
| **Basic** | $9.99/mo | $99.00/yr ($8.25/mo) | Active tacticians (core target) |
| **Pro** | $29.99/mo | $299.00/yr ($24.92/mo) | Leveraged ETF traders, professionals |

### 1.2 Feature Matrix

| Feature | Free | Basic | Pro |
|---|---|---|---|
| **K-line periods** | Daily (1-day delay) | Daily, Weekly | Daily, Weekly, Monthly, Quarterly, Yearly |
| **K-line history** | 3 months | 2 years | Full (10+ years) |
| **Watchlist limit** | 5 symbols | 30 symbols | Unlimited |
| **Buy/sell signals** | None | Golden/Death Cross | All signals (alignment + composite) |
| **Technical indicators** | MA (SMA/EMA) | MA + RSI + MACD | All 252+ indicators |
| **AI analysis** | None | 10/day (DeepSeek) | 50/day (Claude/GPT) |
| **Backtesting** | None | None | 10/day |
| **Risk level** | None | Basic | Detailed report |
| **Alert channels** | None | Email | Email + Push + In-app |
| **Alert count** | 0 | 10 | 30 |
| **API rate limit** | 100 req/day | 1,000 req/day | 10,000 req/day |
| **Data export** | None | None | CSV |
| **Support** | FAQ | Email | Priority |

### 1.3 Downgrade / Expiry Behavior

- 3-day grace period after subscription expiry (full access maintained)
- After grace period → auto-downgrade to Free tier
- Watchlist: items beyond Free limit become **read-only** (can view/remove, cannot add)
- Alerts: items beyond Free limit are **paused** (not deleted)
- AI analysis quota: reset to Free tier (counter zeroed; cached results remain viewable)

---

## 2. Stripe Integration Architecture

### 2.1 Product & Price Setup in Stripe Dashboard

```
Product: "Trend-Scope Basic"
├── Price: basic-monthly-usd   ($9.99/mo,  USD,  lookup_key="basic_monthly_usd")
├── Price: basic-yearly-usd    ($99.00/yr,  USD,  lookup_key="basic_yearly_usd")
├── Price: basic-monthly-cny   (¥69.00/mo,  CNY,  lookup_key="basic_monthly_cny")
└── Price: basic-yearly-cny    (¥699.00/yr, CNY,  lookup_key="basic_yearly_cny")

Product: "Trend-Scope Pro"
├── Price: pro-monthly-usd     ($29.99/mo,  USD,  lookup_key="pro_monthly_usd")
├── Price: pro-yearly-usd      ($299.00/yr, USD,  lookup_key="pro_yearly_usd")
├── Price: pro-monthly-cny     (¥199.00/mo, CNY,  lookup_key="pro_monthly_cny")
└── Price: pro-yearly-cny      (¥1999.00/yr,CNY,  lookup_key="pro_yearly_cny")
```

**Total**: 2 Products × 2 billing intervals × 2 currencies = **8 Prices**.

**Alternative: Adaptive Pricing** — Enable `adaptive_pricing` on Checkout Sessions. Stripe auto-converts USD prices to the customer's local currency (~135 currencies). If using Adaptive Pricing, only 4 USD Prices are needed; CNY Prices become optional.

**Recommendation**: Create all 8 Prices for precise CNY pricing, plus enable Adaptive Pricing as a fallback for other currencies.

### 2.2 Checkout Session Creation Flow

#### Sequence Diagram

```
 ┌──────┐     ┌─────────┐     ┌──────────────┐     ┌────────┐     ┌───────┐
 │ User │     │ Frontend│     │  Backend API │     │ Stripe │     │ Redis │
 └──┬───┘     └────┬────┘     └──────┬───────┘     └───┬────┘     └───┬───┘
    │  Select tier │                 │                  │              │
    │─────────────►│                 │                  │              │
    │              │  POST /payments │                  │              │
    │              │  /create-checkout│                 │              │
    │              │────────────────►│                  │              │
    │              │                 │  Find-or-create  │              │
    │              │                 │  Customer        │              │
    │              │                 │─────────────────►│              │
    │              │                 │◄─────────────────│              │
    │              │                 │                  │              │
    │              │                 │  Create Checkout │              │
    │              │                 │  Session         │              │
    │              │                 │─────────────────►│              │
    │              │                 │◄────session──────│              │
    │              │                 │                  │              │
    │              │                 │  SETNX idempotency_key           │
    │              │                 │─────────────────────────────────►│
    │              │                 │◄────────OK───────────────────────│
    │              │                 │                  │              │
    │              │  {checkout_url} │                  │              │
    │              │◄────────────────│                  │              │
    │              │                 │                  │              │
    │  Redirect to │  Stripe Checkout (stripe.com)                     │
    │◄─────────────│                 │                  │              │
    │              │                 │                  │              │
    │  Complete payment on Stripe-hosted page                          │
    │─────────────────────────────────────────────────►│              │
    │◄────────────────────────────────────────────────│              │
    │              │                 │                  │              │
    │  Redirect to success_url       │                  │              │
    │─────────────►│                 │                  │              │
    │              │  Poll GET /subscriptions/me       │              │
    │              │────────────────►│                  │              │
    │              │◄───{active}────│                  │              │
    │              │                 │                  │              │
```

#### Python Implementation

```python
# backend/app/services/payment/stripe_provider.py

import stripe
from stripe.error import StripeError
from dataclasses import dataclass
from typing import Optional
from app.core.config import settings

stripe.api_key = settings.STRIPE_SECRET_KEY


@dataclass
class CheckoutSessionResult:
    url: str
    session_id: str


class StripeProvider:
    """Stripe payment provider implementing the PaymentProvider interface."""

    def __init__(self):
        self.webhook_secret = settings.STRIPE_WEBHOOK_SECRET

    # ------------------------------------------------------------------
    # Checkout Session
    # ------------------------------------------------------------------

    async def create_checkout_session(
        self,
        user_id: int,
        customer_email: str,
        price_id: str,
        success_url: str,
        cancel_url: str,
        metadata: Optional[dict] = None,
        allow_promotion_codes: bool = True,
        trial_period_days: Optional[int] = None,
        locale: str = "auto",
    ) -> CheckoutSessionResult:
        """
        Create a Stripe Checkout Session for subscription signup.

        Args:
            user_id: Internal user ID.
            customer_email: User's email address.
            price_id: Stripe Price ID (e.g. 'price_xxx').
            success_url: Redirect URL after successful payment.
            cancel_url: Redirect URL if user cancels.
            metadata: Additional key-value pairs stored on the session.
            allow_promotion_codes: Enable promo code field in Checkout.
            trial_period_days: Number of free trial days (e.g. 14).
            locale: Checkout UI language - 'auto', 'en', 'zh', etc.

        Returns:
            CheckoutSessionResult with redirect URL and session ID.

        Raises:
            PaymentError: If Stripe API call fails.
        """
        try:
            # 1. Find or create Stripe Customer
            customers = stripe.Customer.list(email=customer_email, limit=1)
            if customers.data:
                customer = customers.data[0]
                # Update metadata if user_id changed
                if customer.metadata.get("user_id") != str(user_id):
                    stripe.Customer.modify(
                        customer.id,
                        metadata={**customer.metadata, "user_id": str(user_id)},
                    )
            else:
                customer = stripe.Customer.create(
                    email=customer_email,
                    metadata={"user_id": str(user_id)},
                )

            # 2. Build session parameters
            session_params: dict = {
                "customer": customer.id,
                "mode": "subscription",
                "payment_method_types": ["card", "alipay", "wechat_pay"],
                "line_items": [{
                    "price": price_id,
                    "quantity": 1,
                }],
                "success_url": success_url + "?session_id={CHECKOUT_SESSION_ID}",
                "cancel_url": cancel_url,
                "allow_promotion_codes": allow_promotion_codes,
                "locale": locale,
                "metadata": {
                    "user_id": str(user_id),
                    **(metadata or {}),
                },
                # Enable Stripe Tax auto-calculation
                "automatic_tax": {"enabled": True},
                # Collect billing address for accurate tax calculation
                "billing_address_collection": "required",
                # Allow customer to update name/address during checkout
                "customer_update": {
                    "name": "auto",
                    "address": "auto",
                },
                # Subscription metadata
                "subscription_data": {
                    "metadata": {
                        "user_id": str(user_id),
                    },
                },
            }

            # 3. Apply free trial if requested
            if trial_period_days:
                session_params["subscription_data"]["trial_period_days"] = trial_period_days

            # 4. Enable adaptive pricing for multi-currency
            session_params.setdefault("adaptive_pricing", {"enabled": True})

            # 5. Create the session
            session = stripe.checkout.Session.create(**session_params)

            return CheckoutSessionResult(
                url=session.url,
                session_id=session.id,
            )

        except StripeError as e:
            raise PaymentError(
                f"Failed to create Stripe Checkout Session: {e.user_message}"
            ) from e

    # ------------------------------------------------------------------
    # Customer Portal
    # ------------------------------------------------------------------

    async def create_portal_session(
        self,
        customer_id: str,
        return_url: str,
        configuration: Optional[str] = None,
    ) -> str:
        """
        Create a Stripe Customer Portal session.

        The Customer Portal allows users to self-manage:
        - Upgrade/downgrade plans
        - Update payment method
        - View invoice history
        - Cancel subscription

        Args:
            customer_id: Stripe Customer ID.
            return_url: URL to redirect after portal actions.
            configuration: Optional Stripe Portal Configuration ID.

        Returns:
            Portal URL string.
        """
        params: dict = {
            "customer": customer_id,
            "return_url": return_url,
        }
        if configuration:
            params["configuration"] = configuration

        session = stripe.billing_portal.Session.create(**params)
        return session.url

    # ------------------------------------------------------------------
    # Subscription Operations
    # ------------------------------------------------------------------

    async def get_subscription(self, subscription_id: str) -> dict:
        """Retrieve a Stripe subscription by ID."""
        return stripe.Subscription.retrieve(subscription_id)

    async def cancel_subscription(
        self,
        subscription_id: str,
        at_period_end: bool = True,
    ) -> dict:
        """
        Cancel a subscription.

        Args:
            subscription_id: Stripe subscription ID.
            at_period_end: If True, cancel at end of billing period.
                           If False, cancel immediately (with optional refund).
        """
        if at_period_end:
            # Schedule cancellation at period end (user retains access)
            return stripe.Subscription.modify(
                subscription_id,
                cancel_at_period_end=True,
            )
        else:
            # Immediate cancellation
            return stripe.Subscription.delete(subscription_id)

    async def update_subscription(
        self,
        subscription_id: str,
        new_price_id: str,
        proration_behavior: str = "create_prorations",
    ) -> dict:
        """
        Change subscription plan (upgrade/downgrade).

        Args:
            subscription_id: Stripe subscription ID.
            new_price_id: Target Stripe Price ID.
            proration_behavior:
                - 'create_prorations': Generate prorated invoice items
                  (default — instant upgrade, user pays difference).
                - 'none': No proration; change takes effect next cycle.
                - 'always_invoice': Generate immediate invoice for difference.

        Returns:
            Updated Stripe Subscription object (dict).
        """
        subscription = stripe.Subscription.retrieve(subscription_id)
        current_item_id = subscription["items"]["data"][0]["id"]

        return stripe.Subscription.modify(
            subscription_id,
            items=[{
                "id": current_item_id,
                "price": new_price_id,
            }],
            proration_behavior=proration_behavior,
        )

    async def reactivate_subscription(self, subscription_id: str) -> dict:
        """Reactivate a canceled subscription before period end."""
        return stripe.Subscription.modify(
            subscription_id,
            cancel_at_period_end=False,
        )
```

### 2.3 Webhook Event Handling

#### Sequence Diagram

```
 ┌────────┐          ┌──────────────┐          ┌───────┐          ┌────────┐
 │ Stripe │          │ /webhooks/   │          │ Redis │          │  DB    │
 │        │          │   stripe     │          │       │          │        │
 └───┬────┘          └──────┬───────┘          └───┬───┘          └───┬────┘
     │  POST with           │                      │                  │
     │  Stripe-Signature    │                      │                  │
     │  header + raw body   │                      │                  │
     │─────────────────────►│                      │                  │
     │                      │                      │                  │
     │                      │  1. construct_event()│                  │
     │                      │  (verify signature)  │                  │
     │                      │                      │                  │
     │                      │  2. SETNX event_id   │                  │
     │                      │─────────────────────►│                  │
     │                      │◄───0=duplicate───────│                  │
     │                      │  (skip if duplicate) │                  │
     │                      │                      │                  │
     │                      │  3. Route to handler │                  │
     │                      │                      │                  │
     │                      │  4. Retrieve latest  │                  │
     │                      │  state from Stripe   │                  │
     │                      │───(stripe.Subscription│                 │
     │                      │    .retrieve)────────►                  │
     │                      │◄───subscription──────│                  │
     │                      │                      │                  │
     │                      │  5. Write to DB      │                  │
     │                      │─────────────────────────────────────────►
     │                      │◄────────────────────────────────────────
     │                      │                      │                  │
     │  200 OK              │                      │                  │
     │◄─────────────────────│                      │                  │
```

#### Webhook Endpoint

```python
# backend/app/api/v1/webhooks.py

import stripe
import structlog
from fastapi import APIRouter, Request, Response, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.core.deps import get_db, get_redis
from app.services.payment.idempotency import IdempotencyGuard
from app.services.payment.payment_service import PaymentService
from redis.asyncio import Redis

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/webhooks", tags=["webhooks"])


# ------------------------------------------------------------------
# Event type → handler method mapping
# ------------------------------------------------------------------
EVENT_HANDLERS: dict[str, str] = {
    "checkout.session.completed":       "handle_checkout_completed",
    "checkout.session.expired":         "handle_checkout_expired",
    "customer.subscription.updated":    "handle_subscription_updated",
    "customer.subscription.deleted":    "handle_subscription_deleted",
    "customer.subscription.trial_will_end": "handle_trial_ending",
    "invoice.payment_succeeded":        "handle_invoice_paid",
    "invoice.payment_failed":           "handle_invoice_failed",
    "invoice.payment_action_required":  "handle_payment_action_required",
    "charge.refunded":                  "handle_refund",
    "charge.dispute.created":           "handle_dispute_created",
    "charge.dispute.closed":            "handle_dispute_closed",
}


@router.post("/stripe")
async def stripe_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
):
    """
    Handle Stripe webhook events.

    Stripe sends the raw body with a Stripe-Signature header. We must:
    1. Read the raw body bytes (before FastAPI parses it).
    2. Verify the signature using stripe.Webhook.construct_event().
    3. Check idempotency via Redis SETNX on the event ID.
    4. Route to the appropriate event handler.
    5. Return 200 quickly — Stripe retries on non-2xx.
    """
    # Step 1: Read raw body and signature header
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")

    if not sig_header:
        raise HTTPException(status_code=400, detail="Missing Stripe-Signature header")

    # Step 2: Verify signature
    try:
        event = stripe.Webhook.construct_event(
            payload=payload,
            sig_header=sig_header,
            secret=settings.STRIPE_WEBHOOK_SECRET,
        )
    except stripe.error.SignatureVerificationError:
        logger.warning("stripe_webhook_invalid_signature")
        raise HTTPException(status_code=400, detail="Invalid signature")
    except ValueError:
        logger.warning("stripe_webhook_invalid_payload")
        raise HTTPException(status_code=400, detail="Invalid payload")

    event_id = event["id"]
    event_type = event["type"]

    logger.info("stripe_webhook_received", event_type=event_type, event_id=event_id)

    # Step 3: Idempotency check
    guard = IdempotencyGuard(redis)
    is_duplicate = await guard.is_duplicate(provider="stripe", event_id=event_id)
    if is_duplicate:
        logger.info("stripe_webhook_duplicate_skipped", event_id=event_id)
        return Response(status_code=200)

    # Step 4: Route to handler
    handler_name = EVENT_HANDLERS.get(event_type)
    if handler_name is None:
        logger.info("stripe_webhook_unhandled_type", event_type=event_type)
        return Response(status_code=200)

    payment_service = PaymentService(db, redis)
    handler = getattr(payment_service, handler_name, None)
    if handler is None:
        logger.error("stripe_webhook_handler_missing", handler=handler_name)
        return Response(status_code=500)

    try:
        await handler(event)
    except Exception:
        logger.exception("stripe_webhook_handler_failed", event_type=event_type, event_id=event_id)
        # Still return 200 to prevent Stripe retry storm; errors are logged
        # and can be manually reconciled.

    return Response(status_code=200)
```

#### Webhook Event Handlers

```python
# backend/app/services/payment/payment_service.py

from datetime import datetime, timedelta, timezone
from decimal import Decimal
import stripe
import structlog
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from redis.asyncio import Redis
from app.models.subscription import (
    PaymentOrder,
    UserSubscription,
    SubscriptionTier,
)
from app.models.user import User

logger = structlog.get_logger(__name__)


class PaymentService:
    """
    Central payment service. Routes Stripe webhook events to handlers
    and manages local subscription state in the database.

    Design principles:
    - Always retrieve latest state from Stripe API (events may arrive out of order).
    - Use database-level checks as second line of defense against duplicates.
    - Keep handlers fast; defer heavy work (notifications, analytics) to background tasks.
    """

    def __init__(self, db: AsyncSession, redis: Redis):
        self.db = db
        self.redis = redis

    # ------------------------------------------------------------------
    # checkout.session.completed
    # ------------------------------------------------------------------

    async def handle_checkout_completed(self, event: dict) -> None:
        """
        Session completed → subscription created. Provision access.
        """
        session = event["data"]["object"]
        user_id = int(session["metadata"]["user_id"])
        stripe_subscription_id = session.get("subscription")

        if not stripe_subscription_id:
            # One-time payment, not a subscription — ignore
            return

        # Check database-level idempotency (safety net beyond Redis guard)
        existing = await self.db.scalar(
            select(PaymentOrder.id).where(
                PaymentOrder.provider_session_id == session["id"]
            )
        )
        if existing:
            logger.info("checkout_already_processed", session_id=session["id"])
            return

        # Retrieve latest subscription from Stripe
        subscription = stripe.Subscription.retrieve(
            stripe_subscription_id,
            expand=["items.data.price"],
        )
        price = subscription["items"]["data"][0]["price"]
        price_id = price["id"]

        # Resolve local tier by Stripe Price ID
        tier = await self._resolve_tier(price_id)
        if not tier:
            logger.error("tier_not_found_for_price", price_id=price_id, user_id=user_id)
            return

        period_start = datetime.fromtimestamp(
            subscription["current_period_start"], tz=timezone.utc
        )
        period_end = datetime.fromtimestamp(
            subscription["current_period_end"], tz=timezone.utc
        )
        is_trial = subscription.get("status") == "trialing"

        # Determine billing period from price metadata or lookup_key
        billing_period = "yearly" if "yearly" in price.get("lookup_key", "") else "monthly"

        # Create PaymentOrder
        payment_order = PaymentOrder(
            user_id=user_id,
            tier_id=tier.id,
            payment_provider="stripe",
            provider_session_id=session["id"],
            provider_payment_intent_id=session.get("payment_intent"),
            amount=Decimal(str(session.get("amount_total", 0) / 100)),
            currency=(session.get("currency") or "usd").upper(),
            period=billing_period,
            status="paid",
            paid_at=datetime.now(timezone.utc),
        )
        self.db.add(payment_order)

        # Upsert UserSubscription
        sub = await self._get_or_create_subscription(user_id)
        sub.tier_id = tier.id
        sub.stripe_subscription_id = stripe_subscription_id
        sub.stripe_customer_id = session["customer"]
        sub.status = "trialing" if is_trial else "active"
        sub.auto_renew = True
        sub.started_at = period_start
        sub.expired_at = period_end
        sub.grace_until = None
        sub.current_period_start = period_start
        sub.current_period_end = period_end

        await self.db.commit()

        # Invalidate Redis tier cache
        await self.redis.delete(f"user_tier:{user_id}")

        logger.info(
            "checkout_completed",
            user_id=user_id,
            tier_slug=tier.slug,
            status=sub.status,
        )

    # ------------------------------------------------------------------
    # checkout.session.expired
    # ------------------------------------------------------------------

    async def handle_checkout_expired(self, event: dict) -> None:
        """Checkout session expired before payment — clean up pending order."""
        session = event["data"]["object"]
        user_id = int(session["metadata"]["user_id"])

        await self.db.execute(
            update(PaymentOrder)
            .where(
                PaymentOrder.provider_session_id == session["id"],
                PaymentOrder.status == "pending",
            )
            .values(status="expired")
        )
        await self.db.commit()
        logger.info("checkout_expired", user_id=user_id, session_id=session["id"])

    # ------------------------------------------------------------------
    # customer.subscription.updated
    # ------------------------------------------------------------------

    async def handle_subscription_updated(self, event: dict) -> None:
        """
        Subscription changed — plan upgrade/downgrade, renewal, status change.

        Always re-fetch from Stripe to handle out-of-order events.
        """
        subscription = event["data"]["object"]
        stripe_sub_id = subscription["id"]

        # Fetch latest state from Stripe
        try:
            subscription = stripe.Subscription.retrieve(
                stripe_sub_id,
                expand=["items.data.price"],
            )
        except stripe.error.InvalidRequestError:
            logger.warning("subscription_not_found_in_stripe", sub_id=stripe_sub_id)
            return

        user_sub = await self._get_subscription_by_stripe_id(stripe_sub_id)
        if not user_sub:
            logger.warning("local_subscription_not_found", stripe_sub_id=stripe_sub_id)
            return

        stripe_status = subscription["status"]
        current_price = subscription["items"]["data"][0]["price"]
        new_price_id = current_price["id"]

        # Map Stripe status → local status
        _STRIPE_TO_LOCAL_STATUS = {
            "active":            "active",
            "past_due":          "past_due",
            "unpaid":            "past_due",
            "canceled":          "canceled",
            "incomplete":        "active",    # still provisioning
            "incomplete_expired": "expired",
            "trialing":          "trialing",
            "paused":            "active",    # treat paused as active
        }
        new_status = _STRIPE_TO_LOCAL_STATUS.get(stripe_status, user_sub.status)

        # Detect plan change
        new_tier = await self._resolve_tier(new_price_id)
        if new_tier and new_tier.id != user_sub.tier_id:
            logger.info(
                "plan_changed",
                user_id=user_sub.user_id,
                old_tier=user_sub.tier_id,
                new_tier=new_tier.id,
            )
            user_sub.tier_id = new_tier.id

        # Update timestamps
        user_sub.status = new_status
        user_sub.current_period_start = datetime.fromtimestamp(
            subscription["current_period_start"], tz=timezone.utc
        )
        user_sub.current_period_end = datetime.fromtimestamp(
            subscription["current_period_end"], tz=timezone.utc
        )
        user_sub.expired_at = user_sub.current_period_end
        user_sub.auto_renew = not subscription.get("cancel_at_period_end", False)

        # Handle cancellation scheduling
        if subscription.get("cancel_at_period_end"):
            user_sub.cancel_at_period_end = True
            user_sub.grace_until = None
        else:
            user_sub.cancel_at_period_end = False

        await self.db.commit()
        await self.redis.delete(f"user_tier:{user_sub.user_id}")

    # ------------------------------------------------------------------
    # customer.subscription.deleted
    # ------------------------------------------------------------------

    async def handle_subscription_deleted(self, event: dict) -> None:
        """
        Subscription fully deleted/canceled. Revoke access after grace period.
        """
        subscription = event["data"]["object"]
        stripe_sub_id = subscription["id"]

        user_sub = await self._get_subscription_by_stripe_id(stripe_sub_id)
        if not user_sub:
            return

        if user_sub.status == "canceled":
            return  # Already handled

        # Set status and start grace period
        user_sub.status = "canceled"
        user_sub.auto_renew = False
        user_sub.grace_until = datetime.now(timezone.utc) + timedelta(days=3)
        user_sub.cancel_at_period_end = False

        await self.db.commit()
        await self.redis.delete(f"user_tier:{user_sub.user_id}")

        logger.info(
            "subscription_canceled",
            user_id=user_sub.user_id,
            grace_until=user_sub.grace_until.isoformat(),
        )

    # ------------------------------------------------------------------
    # invoice.payment_succeeded
    # ------------------------------------------------------------------

    async def handle_invoice_paid(self, event: dict) -> None:
        """
        Renewal payment succeeded. Extend subscription.
        """
        invoice = event["data"]["object"]
        stripe_sub_id = invoice.get("subscription")
        if not stripe_sub_id:
            return

        user_sub = await self._get_subscription_by_stripe_id(stripe_sub_id)
        if not user_sub:
            return

        # Fetch latest subscription from Stripe
        subscription = stripe.Subscription.retrieve(stripe_sub_id)
        period_end = datetime.fromtimestamp(
            subscription["current_period_end"], tz=timezone.utc
        )

        user_sub.status = "active"
        user_sub.expired_at = period_end
        user_sub.current_period_end = period_end
        user_sub.auto_renew = True
        user_sub.grace_until = None

        # Create a PaymentOrder record for this invoice
        invoice_amount = invoice.get("amount_paid", 0)
        payment_order = PaymentOrder(
            user_id=user_sub.user_id,
            tier_id=user_sub.tier_id,
            payment_provider="stripe",
            provider_session_id=invoice.get("id"),
            provider_payment_intent_id=invoice.get("payment_intent"),
            amount=Decimal(str(invoice_amount / 100)),
            currency=(invoice.get("currency") or "usd").upper(),
            period="monthly",  # Could also check price lookup_key
            status="paid",
            paid_at=datetime.now(timezone.utc),
        )
        self.db.add(payment_order)

        await self.db.commit()
        await self.redis.delete(f"user_tier:{user_sub.user_id}")

    # ------------------------------------------------------------------
    # invoice.payment_failed
    # ------------------------------------------------------------------

    async def handle_invoice_failed(self, event: dict) -> None:
        """
        Payment failed. Mark past_due. Stripe handles retry logic.

        Stripe Smart Retries:
        - Retries based on machine learning (optimal timing).
        - Sends customer emails for failed payments.
        - After all retries exhausted → customer.subscription.updated with
          status='unpaid' or 'canceled'.
        """
        invoice = event["data"]["object"]
        stripe_sub_id = invoice.get("subscription")
        if not stripe_sub_id:
            return

        user_sub = await self._get_subscription_by_stripe_id(stripe_sub_id)
        if not user_sub:
            return

        # Mark past_due but keep access (grace period managed by Stripe)
        user_sub.status = "past_due"

        await self.db.commit()
        await self.redis.delete(f"user_tier:{user_sub.user_id}")

        # TODO: Send notification to user
        # await notification_service.send_payment_failed(user_sub.user_id, invoice)

        logger.info(
            "invoice_payment_failed",
            user_id=user_sub.user_id,
            invoice_id=invoice["id"],
            attempt_count=invoice.get("attempt_count", 1),
        )

    # ------------------------------------------------------------------
    # invoice.payment_action_required
    # ------------------------------------------------------------------

    async def handle_payment_action_required(self, event: dict) -> None:
        """Payment requires 3D Secure or other customer action."""
        invoice = event["data"]["object"]
        # TODO: Send email with link to confirm 3D Secure
        logger.info("payment_action_required", invoice_id=invoice["id"])

    # ------------------------------------------------------------------
    # customer.subscription.trial_will_end
    # ------------------------------------------------------------------

    async def handle_trial_ending(self, event: dict) -> None:
        """
        Trial ending in 3 days — sent by Stripe automatically.
        Notify user to add payment method.
        """
        subscription = event["data"]["object"]
        # TODO: Send notification
        logger.info(
            "trial_ending",
            sub_id=subscription["id"],
            trial_end=subscription.get("trial_end"),
        )

    # ------------------------------------------------------------------
    # charge.refunded
    # ------------------------------------------------------------------

    async def handle_refund(self, event: dict) -> None:
        """A charge was refunded."""
        charge = event["data"]["object"]
        payment_intent_id = charge.get("payment_intent")
        if not payment_intent_id:
            return

        await self.db.execute(
            update(PaymentOrder)
            .where(
                PaymentOrder.provider_payment_intent_id == payment_intent_id,
                PaymentOrder.status == "paid",
            )
            .values(
                status="refunded",
                updated_at=datetime.now(timezone.utc),
            )
        )
        await self.db.commit()
        logger.info("refund_processed", payment_intent_id=payment_intent_id)

    # ------------------------------------------------------------------
    # charge.dispute.created / charge.dispute.closed
    # ------------------------------------------------------------------

    async def handle_dispute_created(self, event: dict) -> None:
        """A dispute/chargeback was filed."""
        dispute = event["data"]["object"]
        charge_id = dispute.get("charge")
        logger.warning(
            "dispute_created",
            charge_id=charge_id,
            reason=dispute.get("reason"),
            amount=dispute.get("amount"),
        )
        # TODO: Flag user account, pause access
        # TODO: Notify admin

    async def handle_dispute_closed(self, event: dict) -> None:
        """A dispute was resolved."""
        dispute = event["data"]["object"]
        logger.info(
            "dispute_closed",
            status=dispute.get("status"),
            charge_id=dispute.get("charge"),
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    async def _resolve_tier(self, price_id: str) -> SubscriptionTier | None:
        """Resolve local tier from a Stripe Price ID."""
        result = await self.db.execute(
            select(SubscriptionTier).where(
                (SubscriptionTier.stripe_price_id_monthly == price_id)
                | (SubscriptionTier.stripe_price_id_yearly == price_id)
            )
        )
        return result.scalar_one_or_none()

    async def _get_subscription_by_stripe_id(self, stripe_sub_id: str) -> UserSubscription | None:
        result = await self.db.execute(
            select(UserSubscription).where(
                UserSubscription.stripe_subscription_id == stripe_sub_id
            )
        )
        return result.scalar_one_or_none()

    async def _get_or_create_subscription(self, user_id: int) -> UserSubscription:
        result = await self.db.execute(
            select(UserSubscription).where(UserSubscription.user_id == user_id)
        )
        sub = result.scalar_one_or_none()
        if not sub:
            sub = UserSubscription(user_id=user_id)
            self.db.add(sub)
            await self.db.flush()
        return sub
```

### 2.4 Idempotency Guard

```python
# backend/app/services/payment/idempotency.py

import hashlib
from redis.asyncio import Redis
import structlog

logger = structlog.get_logger(__name__)


class IdempotencyGuard:
    """
    Prevent duplicate processing of payment webhooks using Redis SETNX.

    How it works:
    1. Generate a deterministic key: hash(provider + ":" + event_id)
    2. Execute Redis SETNX (SET if Not eXists) — atomic check-and-set
    3. If the key was set (first occurrence) → process the event
    4. If the key already existed → skip as duplicate

    Keys expire after 7 days (matching Stripe's 3-day retry window plus buffer).

    Why Redis vs. database:
    - Redis SETNX is O(1) and network-optimized
    - Avoids DB write contention on high-frequency webhook endpoints
    - TTL is built-in; no cleanup job needed
    - Database UNIQUE constraint on idempotency_key is a safety net
    """

    KEY_PREFIX = "idem"
    DEFAULT_TTL_SECONDS = 86400 * 7  # 7 days

    def __init__(self, redis: Redis):
        self.redis = redis

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def is_duplicate(self, *, provider: str, event_id: str) -> bool:
        """
        Check if an event has already been processed.

        Args:
            provider: Payment provider name (e.g. 'stripe', 'alipay').
            event_id: Provider-assigned event ID (e.g. 'evt_xxx' for Stripe).

        Returns:
            True if the event is a duplicate (already processed).
            False if this is the first occurrence (proceed to process).
        """
        key = self._build_key(provider, event_id)

        # SETNX: sets key only if it does not exist, with TTL
        # Returns 1 if set, 0 if already existed
        was_set = await self.redis.set(
            key,
            "1",
            nx=True,           # Only set if Not eXists
            ex=self.DEFAULT_TTL_SECONDS,
        )

        is_dup = was_set is None  # Redis returns None when NX fails

        if is_dup:
            logger.debug("idempotency_guard_duplicate", provider=provider, event_id=event_id)
        else:
            logger.debug("idempotency_guard_first_seen", provider=provider, event_id=event_id)

        return is_dup

    async def is_duplicate_with_key(
        self, *, provider: str, idempotency_key: str
    ) -> bool:
        """
        Check idempotency for API-initiated operations (checkout creation).

        Used when creating PaymentOrder records to prevent double-charge
        from retried API calls.

        Args:
            provider: Payment provider name.
            idempotency_key: Client-generated idempotency key (passed in API request).

        Returns:
            True if duplicate.
        """
        key = f"{self.KEY_PREFIX}:api:{provider}:{idempotency_key}"
        was_set = await self.redis.set(key, "1", nx=True, ex=self.DEFAULT_TTL_SECONDS)
        return was_set is None

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _build_key(self, provider: str, event_id: str) -> str:
        """Build a deterministic Redis key with hashing."""
        raw = f"{provider}:{event_id}"
        hashed = hashlib.sha256(raw.encode()).hexdigest()[:16]
        return f"{self.KEY_PREFIX}:{hashed}"
```

### 2.5 Tax Handling

| Aspect | Implementation |
|---|---|
| **Tax calculation** | Stripe Tax auto-calculates based on customer location (address, IP, card BIN) |
| **Enablement** | Dashboard → Settings → Tax → Activate |
| **Checkout** | `"automatic_tax": {"enabled": True}` on Session |
| **Address collection** | `"billing_address_collection": "required"` |
| **Supported taxes** | US Sales Tax, EU VAT (OSS), GST, HST, etc. |
| **Reporting** | Stripe Tax Reports for filing |
| **Cost** | 0.5% per transaction (or included in Stripe plan) |

### 2.6 Stripe Product/Price Bootstrap Script

```python
# backend/scripts/bootstrap_stripe_products.py
"""
One-time script to create Products and Prices in Stripe.
Run: python -m scripts.bootstrap_stripe_products
"""

import stripe
from app.core.config import settings

stripe.api_key = settings.STRIPE_SECRET_KEY

TIERS = [
    {
        "name": "Trend-Scope Basic",
        "slug": "basic",
        "prices": [
            {"lookup_key": "basic_monthly_usd", "unit_amount": 999,    "currency": "usd", "interval": "month"},
            {"lookup_key": "basic_yearly_usd",  "unit_amount": 9900,   "currency": "usd", "interval": "year"},
            {"lookup_key": "basic_monthly_cny", "unit_amount": 6900,   "currency": "cny", "interval": "month"},
            {"lookup_key": "basic_yearly_cny",  "unit_amount": 69900,  "currency": "cny", "interval": "year"},
        ],
    },
    {
        "name": "Trend-Scope Pro",
        "slug": "pro",
        "prices": [
            {"lookup_key": "pro_monthly_usd",   "unit_amount": 2999,   "currency": "usd", "interval": "month"},
            {"lookup_key": "pro_yearly_usd",    "unit_amount": 29900,  "currency": "usd", "interval": "year"},
            {"lookup_key": "pro_monthly_cny",   "unit_amount": 19900,  "currency": "cny", "interval": "month"},
            {"lookup_key": "pro_yearly_cny",    "unit_amount": 199900, "currency": "cny", "interval": "year"},
        ],
    },
]

def bootstrap():
    for tier in TIERS:
        product = stripe.Product.create(
            name=tier["name"],
            metadata={"slug": tier["slug"]},
            statement_descriptor=f"TRENDSCOPE {tier['slug'].upper()[:10]}",
        )
        print(f"Created Product: {product.id} ({tier['name']})")

        for p in tier["prices"]:
            price = stripe.Price.create(
                product=product.id,
                currency=p["currency"],
                unit_amount=p["unit_amount"],
                recurring={"interval": p["interval"]},
                lookup_key=p["lookup_key"],
                metadata={
                    "tier_slug": tier["slug"],
                    "period": p["interval"],
                },
            )
            print(f"  Price: {price.id} — {p['lookup_key']}")


if __name__ == "__main__":
    bootstrap()
```

---

## 3. Subscription State Machine

### 3.1 State Diagram

```
                         ┌──────────┐
                         │   NONE   │  Initial state
                         └────┬─────┘
                              │
             ┌────────────────┼────────────────┐
             │ checkout       │ checkout        │
             │ completed      │ completed       │
             │ (with trial)   │ (no trial)      │
             ▼                │                 │
       ┌──────────┐           │                 │
       │ TRIALING │           │                 │
       └────┬─────┘           │                 │
            │                 │                 │
   ┌────────┼────────┐        │                 │
   │ trial  │ trial  │        │                 │
   │ ends,  │ ends,  │        ▼                 │
   │ payment│ no pay-│  ┌──────────┐            │
   │ succeeds│ ment │  │  ACTIVE  │◄───────────┘
   │        │ method │  └────┬─────┘
   │        ▼        │       │
   │  ┌──────────┐   │       ├──────────────────┐
   │  │ PAUSED   │   │       │ payment          │ payment
   │  └────┬─────┘   │       │ fails            │ succeeds
   │       │ resume  │       ▼                  │
   │       │ (add    │  ┌──────────┐            │
   │       │ payment)│  │PAST_DUE  │────────────┘
   │       └─────────┘  └────┬─────┘
   │                         │
   │           ┌─────────────┼──────────────┐
   │           │ retries     │ all retries  │ user / admin
   │           │ exhausted   │ exhausted    │ cancels
   │           ▼             │              │
   │     ┌──────────┐        │              │
   │     │ EXPIRED  │        ▼              ▼
   │     └────┬─────┘  ┌──────────────────────┐
   │          │        │      CANCELED        │  Terminal state
   │          │        │  (terminal)          │
   │          │        └──────────────────────┘
   │          │ re-subscribe
   │          │ (new checkout)
   │          ▼
   │    ┌──────────┐
   └────►  ACTIVE  │
        └──────────┘
```

### 3.2 State Transition Rules

| From | To | Trigger | Conditions |
|---|---|---|---|
| `NONE` | `TRIALING` | `checkout.session.completed` | Session has `trial_period_days > 0` |
| `NONE` | `ACTIVE` | `checkout.session.completed` | No trial period |
| `TRIALING` | `ACTIVE` | `invoice.payment_succeeded` | First invoice after trial paid |
| `TRIALING` | `PAUSED` | Trial expired, no payment method | Stripe subscription.status = `incomplete_expired` |
| `PAUSED` | `ACTIVE` | User adds payment method | Resume via Customer Portal |
| `ACTIVE` | `PAST_DUE` | `invoice.payment_failed` | Renewal payment fails |
| `PAST_DUE` | `ACTIVE` | `invoice.payment_succeeded` | Retry payment succeeds |
| `PAST_DUE` | `EXPIRED` | All retries exhausted | Stripe subscription.status = `unpaid` → `canceled` |
| `ACTIVE` | `CANCELED` | `customer.subscription.deleted` | User cancels or admin cancels |
| `EXPIRED` | `ACTIVE` | New checkout completed | User re-subscribes |
| `CANCELED` | _(terminal)_ | Cannot transition out | New subscription = new UserSubscription row |

### 3.3 Grace Period Logic

```
Grace period: 3 calendar days after subscription expiration.

Timeline:
  Day 0 (T):  Subscription expires
  Day T+1:    User still has full access
  Day T+2:    User still has full access
  Day T+3:    Last day of full access
  Day T+4:    Auto-downgrade to Free tier

Implementation:
  - On customer.subscription.deleted → set grace_until = now() + 3 days
  - APScheduler daily job checks grace_until < now() → downgrade
  - Subscription guard middleware checks:
      1. If status == 'active' → allow (current tier)
      2. If status == 'canceled' AND now() < grace_until → allow (current tier)
      3. If status == 'canceled' AND now() >= grace_until → allow (free tier only)
```

### 3.4 Proration Strategy

| Scenario | Proration Behavior | Implementation |
|---|---|---|
| **Upgrade** (e.g. Basic → Pro) | Immediate access, user charged prorated difference | `proration_behavior="create_prorations"` |
| **Downgrade** (e.g. Pro → Basic) | Current tier retained until period end, then switches | `proration_behavior="none"` |
| **Annual → Monthly** | Current annual continues until expiry, then monthly starts | `proration_behavior="none"` |
| **Monthly → Annual** | Immediate annual access, credit for unused monthly portion | `proration_behavior="create_prorations"` |

```python
# backend/app/services/payment/subscription_service.py

from enum import Enum

class ProrationStrategy(Enum):
    UPGRADE = "create_prorations"    # charge prorated difference now
    DOWNGRADE = "none"               # switch at period end


async def change_plan(
    provider: StripeProvider,
    subscription_id: str,
    new_price_id: str,
    current_tier_slug: str,
    new_tier_slug: str,
) -> dict:
    """
    Change subscription plan with correct proration behavior.

    Tiers are ordered: free (0) < basic (1) < pro (2)
    """
    TIER_RANK = {"free": 0, "basic": 1, "pro": 2}

    is_upgrade = TIER_RANK.get(new_tier_slug, 0) > TIER_RANK.get(current_tier_slug, 0)
    strategy = ProrationStrategy.UPGRADE if is_upgrade else ProrationStrategy.DOWNGRADE

    return await provider.update_subscription(
        subscription_id=subscription_id,
        new_price_id=new_price_id,
        proration_behavior=strategy.value,
    )
```

### 3.5 Auto-Renewal vs Manual Renewal

- **Auto-renewal (default)**: Stripe charges the saved payment method at each billing cycle. Managed entirely by Stripe.
- **Manual renewal**: User cancels via Customer Portal → `cancel_at_period_end=True`. Subscription remains active until period end, then expires. To resume, user must create a new checkout session.
- **Reactivation**: If user cancels but changes mind before period end, call `stripe.Subscription.modify(sub_id, cancel_at_period_end=False)`.

### 3.6 Grace Period Enforcement Job

```python
# backend/app/scheduler/jobs.py

from datetime import datetime, timezone
from sqlalchemy import select, update
from app.models.subscription import UserSubscription, SubscriptionTier


async def enforce_grace_periods(db):
    """
    Daily job: downgrade users past their grace period to Free tier.

    For each subscription where:
    - status = 'canceled'
    - grace_until < now()
    - tier != free tier

    → downgrade to Free tier (tier_id = free)
    → set status = 'expired'
    → invalidate Redis cache
    """
    now = datetime.now(timezone.utc)

    # Find free tier ID (assumed to exist)
    free_tier = await db.scalar(
        select(SubscriptionTier.id).where(SubscriptionTier.slug == "free")
    )
    if not free_tier:
        return

    expired_subs = await db.execute(
        select(UserSubscription).where(
            UserSubscription.status == "canceled",
            UserSubscription.grace_until.isnot(None),
            UserSubscription.grace_until < now,
        )
    )

    for sub in expired_subs.scalars().all():
        sub.tier_id = free_tier
        sub.status = "expired"
        sub.auto_renew = False

    await db.commit()
```

---

## 4. PaymentProvider Abstract Interface

### 4.1 Abstract Base Class

```python
# backend/app/services/payment/base.py

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


# ------------------------------------------------------------------
# Enums
# ------------------------------------------------------------------

class PaymentProviderType(str, Enum):
    STRIPE = "stripe"
    ALIPAY = "alipay"
    WECHAT = "wechat"
    APP_STORE = "apple"
    GOOGLE_PLAY = "google"


class SubscriptionStatus(str, Enum):
    NONE = "none"           # No subscription
    TRIALING = "trialing"   # In free trial
    ACTIVE = "active"       # Paid and current
    PAST_DUE = "past_due"   # Payment failed, retrying
    PAUSED = "paused"       # Trial ended, no payment method
    EXPIRED = "expired"     # Grace period ended
    CANCELED = "canceled"   # Terminal


# ------------------------------------------------------------------
# Data Classes
# ------------------------------------------------------------------

@dataclass
class CheckoutSessionResult:
    """Result of creating a checkout session."""
    url: Optional[str] = None          # Redirect URL (Stripe Checkout / Alipay page)
    session_id: str = ""               # Provider's session ID
    qr_code: Optional[str] = None      # QR code URL (Alipay F2F, WeChat Native)
    provider: PaymentProviderType = PaymentProviderType.STRIPE


@dataclass
class SubscriptionInfo:
    """Normalized subscription data from any provider."""
    provider_subscription_id: str
    provider_customer_id: str
    status: SubscriptionStatus
    current_period_start: str          # ISO 8601
    current_period_end: str            # ISO 8601
    cancel_at_period_end: bool = False
    price_id: Optional[str] = None
    plan_name: Optional[str] = None
    is_trial: bool = False
    trial_end: Optional[str] = None


@dataclass
class PortalSessionResult:
    """Result of creating a customer portal session."""
    url: str


# ------------------------------------------------------------------
# Abstract Provider
# ------------------------------------------------------------------

class PaymentProvider(ABC):
    """
    Abstract interface for all payment providers.

    Each provider implementation handles:
    - Creating checkout/payment sessions
    - Processing webhooks (signature verification + event routing)
    - Retrieving and managing subscriptions
    - Providing self-service portal URLs

    Adding a new provider:
    1. Subclass PaymentProvider
    2. Implement all abstract methods
    3. Register in PaymentProviderFactory
    """

    @abstractmethod
    async def create_checkout_session(
        self,
        user_id: int,
        customer_email: str,
        price_id: str,
        success_url: str,
        cancel_url: str,
        metadata: Optional[dict] = None,
        trial_period_days: Optional[int] = None,
    ) -> CheckoutSessionResult:
        """
        Create a checkout/payment session.

        Args:
            user_id: Internal user ID.
            customer_email: User's email.
            price_id: Provider-specific price identifier.
            success_url: Post-payment redirect URL.
            cancel_url: Cancellation redirect URL.
            metadata: Extra data to attach to the session.
            trial_period_days: Free trial length (if applicable).

        Returns:
            CheckoutSessionResult with URL (and optionally QR code).
        """
        ...

    @abstractmethod
    async def handle_webhook(
        self,
        payload: bytes,
        headers: dict,
    ) -> tuple[str, dict]:
        """
        Verify webhook signature and extract event data.

        Must verify the request is genuinely from the provider before
        returning any data.

        Args:
            payload: Raw request body bytes.
            headers: HTTP request headers.

        Returns:
            Tuple of (event_type: str, event_data: dict).

        Raises:
            InvalidSignatureError: If signature verification fails.
        """
        ...

    @abstractmethod
    async def get_subscription(
        self,
        subscription_id: str,
    ) -> SubscriptionInfo:
        """
        Retrieve current subscription details from the provider.

        Args:
            subscription_id: Provider's subscription ID.

        Returns:
            Normalized SubscriptionInfo.
        """
        ...

    @abstractmethod
    async def cancel_subscription(
        self,
        subscription_id: str,
        at_period_end: bool = True,
    ) -> SubscriptionInfo:
        """
        Cancel a subscription.

        Args:
            subscription_id: Provider's subscription ID.
            at_period_end: Cancel at end of period (True) or immediately (False).

        Returns:
            Updated SubscriptionInfo.
        """
        ...

    @abstractmethod
    async def update_subscription(
        self,
        subscription_id: str,
        new_price_id: str,
        proration_behavior: str = "create_prorations",
    ) -> SubscriptionInfo:
        """
        Change subscription plan.

        Args:
            subscription_id: Provider's subscription ID.
            new_price_id: Target price ID.
            proration_behavior: 'create_prorations', 'none', or 'always_invoice'.

        Returns:
            Updated SubscriptionInfo.
        """
        ...

    @abstractmethod
    async def get_portal_url(
        self,
        customer_id: str,
        return_url: str,
    ) -> PortalSessionResult:
        """
        Get self-service customer portal URL.

        Args:
            customer_id: Provider's customer ID.
            return_url: URL to return to after portal actions.

        Returns:
            PortalSessionResult with URL.
        """
        ...


# ------------------------------------------------------------------
# Custom Exceptions
# ------------------------------------------------------------------

class PaymentError(Exception):
    """Base exception for payment processing errors."""

class InvalidSignatureError(PaymentError):
    """Webhook signature verification failed."""

class ProviderUnavailableError(PaymentError):
    """Payment provider is unavailable or misconfigured."""

class DuplicateEventError(PaymentError):
    """Event has already been processed (idempotency)."""

class SubscriptionNotFoundError(PaymentError):
    """Subscription not found in provider system."""
```

### 4.2 StripeProvider (Concrete)

Already implemented in [Section 2.2](#22-checkout-session-creation-flow) and [Section 2.3](#23-webhook-event-handling). The `StripeProvider` class implements the `PaymentProvider` abstract interface.

### 4.3 Future Provider Stubs

```python
# backend/app/services/payment/alipay_provider.py

from app.services.payment.base import (
    PaymentProvider, CheckoutSessionResult, SubscriptionInfo,
    SubscriptionStatus, PaymentProviderType,
)

class AlipayProvider(PaymentProvider):
    """
    Alipay Global cross-border payment provider.

    Phase 7+ implementation. Not needed for Phase 1-6 since Stripe
    Checkout includes Alipay natively.

    Requirements:
    - Alipay Global merchant account (global.alipay.com)
    - RSA2 key pair for signature
    - No Chinese business license needed (cross-border product)
    """

    async def create_checkout_session(self, **kwargs) -> CheckoutSessionResult:
        raise NotImplementedError("Alipay standalone integration deferred to Phase 7+")

    async def handle_webhook(self, payload: bytes, headers: dict) -> tuple[str, dict]:
        raise NotImplementedError("Alipay standalone integration deferred to Phase 7+")

    async def get_subscription(self, subscription_id: str) -> SubscriptionInfo:
        raise NotImplementedError("Alipay standalone integration deferred to Phase 7+")

    async def cancel_subscription(self, subscription_id: str, at_period_end: bool = True) -> SubscriptionInfo:
        raise NotImplementedError("Alipay standalone integration deferred to Phase 7+")

    async def update_subscription(self, subscription_id: str, new_price_id: str, proration_behavior: str = "create_prorations") -> SubscriptionInfo:
        raise NotImplementedError("Alipay standalone integration deferred to Phase 7+")

    async def get_portal_url(self, customer_id: str, return_url: str):
        raise NotImplementedError("Alipay standalone integration deferred to Phase 7+")


# backend/app/services/payment/wechat_provider.py

from app.services.payment.base import (
    PaymentProvider, CheckoutSessionResult, SubscriptionInfo,
    SubscriptionStatus, PaymentProviderType,
)

class WechatProvider(PaymentProvider):
    """
    WeChat Pay provider.

    Phase 7+ implementation. WeChat Pay API V3 does not natively support
    recurring subscriptions; this would implement a workaround model
    (manual renewal / credits / contract sign).

    Requirements:
    - Chinese business entity (营业执照)
    - WeChat Official Account or Mini Program
    - ICP filing (ICP备案)
    - WeChat Pay merchant account
    """

    async def create_checkout_session(self, **kwargs) -> CheckoutSessionResult:
        raise NotImplementedError("WeChat Pay standalone integration deferred to Phase 7+")

    async def handle_webhook(self, payload: bytes, headers: dict) -> tuple[str, dict]:
        raise NotImplementedError("WeChat Pay standalone integration deferred to Phase 7+")

    async def get_subscription(self, subscription_id: str) -> SubscriptionInfo:
        raise NotImplementedError("WeChat Pay standalone integration deferred to Phase 7+")

    async def cancel_subscription(self, subscription_id: str, at_period_end: bool = True) -> SubscriptionInfo:
        raise NotImplementedError("WeChat Pay standalone integration deferred to Phase 7+")

    async def update_subscription(self, subscription_id: str, new_price_id: str, proration_behavior: str = "create_prorations") -> SubscriptionInfo:
        raise NotImplementedError("WeChat Pay standalone integration deferred to Phase 7+")

    async def get_portal_url(self, customer_id: str, return_url: str):
        raise NotImplementedError("WeChat Pay standalone integration deferred to Phase 7+")
```

### 4.4 Provider Factory

```python
# backend/app/services/payment/provider_factory.py

from app.services.payment.base import PaymentProvider, PaymentProviderType, PaymentError
from app.services.payment.stripe_provider import StripeProvider


class PaymentProviderFactory:
    """
    Factory to get the appropriate payment provider instance.

    Currently returns StripeProvider for all cases.
    Provider selection by region/method will be added in Phase 7+.
    """

    _providers: dict[PaymentProviderType, type[PaymentProvider]] = {
        PaymentProviderType.STRIPE: StripeProvider,
        # Phase 7+:
        # PaymentProviderType.ALIPAY: AlipayProvider,
        # PaymentProviderType.WECHAT: WechatProvider,
    }

    @classmethod
    def get_provider(cls, provider_type: PaymentProviderType = PaymentProviderType.STRIPE) -> PaymentProvider:
        provider_class = cls._providers.get(provider_type)
        if not provider_class:
            raise PaymentError(f"Unknown payment provider: {provider_type}")
        return provider_class()

    @classmethod
    def get_default(cls) -> PaymentProvider:
        return cls.get_provider(PaymentProviderType.STRIPE)
```

---

## 5. API Integration

### 5.1 Endpoints

```python
# backend/app/api/v1/payments.py

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, Literal
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.core.deps import get_db, get_current_user_id, get_redis
from app.services.payment.provider_factory import PaymentProviderFactory
from app.services.payment.idempotency import IdempotencyGuard
from app.services.payment.stripe_provider import StripeProvider
from app.models.user import User
from app.models.subscription import UserSubscription, SubscriptionTier
from redis.asyncio import Redis
import structlog

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/payments", tags=["payments"])


# ------------------------------------------------------------------
# Schemas
# ------------------------------------------------------------------

class CreateCheckoutRequest(BaseModel):
    tier_slug: str = Field(..., description="Tier slug: 'basic' or 'pro'")
    period: Literal["monthly", "yearly"] = Field(..., description="Billing period")
    success_url: str = Field(..., description="URL to redirect after successful payment")
    cancel_url: str = Field(..., description="URL to redirect if user cancels")
    promo_code: Optional[str] = Field(None, description="Optional promotion code")
    idempotency_key: Optional[str] = Field(None, description="Client-generated idempotency key")

class CreateCheckoutResponse(BaseModel):
    checkout_url: str
    session_id: str

class PortalSessionResponse(BaseModel):
    portal_url: str

class PaymentOrderOut(BaseModel):
    id: int
    amount: float
    currency: str
    period: str
    status: str
    paid_at: Optional[str]
    created_at: str

    class Config:
        from_attributes = True


# ------------------------------------------------------------------
# POST /payments/create-checkout
# ------------------------------------------------------------------

@router.post("/create-checkout", response_model=CreateCheckoutResponse)
async def create_checkout_session(
    req: CreateCheckoutRequest,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
):
    """
    Create a Stripe Checkout Session for subscription signup.

    The client should redirect the user to the returned `checkout_url`.
    After payment, the webhook handler will update the subscription status.
    """
    # 1. Idempotency check (prevent double-charge from retried API calls)
    if req.idempotency_key:
        guard = IdempotencyGuard(redis)
        is_dup = await guard.is_duplicate_with_key(
            provider="stripe",
            idempotency_key=req.idempotency_key,
        )
        if is_dup:
            raise HTTPException(status_code=409, detail="Duplicate request")

    # 2. Resolve tier
    tier = await db.scalar(
        __import__("sqlalchemy").select(SubscriptionTier).where(
            SubscriptionTier.slug == req.tier_slug,
            SubscriptionTier.is_active == True,
        )
    )
    if not tier:
        raise HTTPException(status_code=404, detail=f"Tier not found: {req.tier_slug}")
    if tier.slug == "free":
        raise HTTPException(status_code=400, detail="Cannot subscribe to free tier")

    # 3. Resolve Stripe Price ID
    price_id = (
        tier.stripe_price_id_yearly if req.period == "yearly"
        else tier.stripe_price_id_monthly
    )
    if not price_id:
        raise HTTPException(
            status_code=500,
            detail=f"No Stripe Price ID configured for {req.tier_slug} {req.period}",
        )

    # 4. Get user email
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # 5. Create Checkout Session
    provider = PaymentProviderFactory.get_default()
    result = await provider.create_checkout_session(
        user_id=user_id,
        customer_email=user.email,
        price_id=price_id,
        success_url=req.success_url,
        cancel_url=req.cancel_url,
        metadata={
            "tier_slug": req.tier_slug,
            "period": req.period,
        },
    )

    logger.info(
        "checkout_session_created",
        user_id=user_id,
        tier=req.tier_slug,
        period=req.period,
        session_id=result.session_id,
    )

    return CreateCheckoutResponse(
        checkout_url=result.url,
        session_id=result.session_id,
    )


# ------------------------------------------------------------------
# GET /payments/billing-portal
# ------------------------------------------------------------------

@router.get("/billing-portal", response_model=PortalSessionResponse)
async def get_billing_portal(
    return_url: str,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Get a Stripe Customer Portal URL for subscription management.

    The Customer Portal allows users to:
    - Upgrade/downgrade plans
    - Update payment methods
    - View invoice history
    - Cancel subscriptions
    """
    # Find user's active subscription
    sub = await db.scalar(
        __import__("sqlalchemy").select(UserSubscription).where(
            UserSubscription.user_id == user_id,
            UserSubscription.status.in_(["active", "past_due", "trialing"]),
        )
    )
    if not sub or not sub.stripe_customer_id:
        raise HTTPException(status_code=404, detail="No active subscription found")

    provider = PaymentProviderFactory.get_default()
    result = await provider.get_portal_url(
        customer_id=sub.stripe_customer_id,
        return_url=return_url,
    )

    return PortalSessionResponse(portal_url=result.url)


# ------------------------------------------------------------------
# GET /payments/history
# ------------------------------------------------------------------

@router.get("/history", response_model=list[PaymentOrderOut])
async def get_payment_history(
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Get the user's payment history."""
    result = await db.execute(
        __import__("sqlalchemy").select(
            __import__("app.models.subscription").PaymentOrder
        )
        .where(
            __import__("app.models.subscription").PaymentOrder.user_id == user_id,
        )
        .order_by(
            __import__("app.models.subscription").PaymentOrder.created_at.desc()
        )
        .limit(50)
    )
    orders = result.scalars().all()
    return [PaymentOrderOut.model_validate(o) for o in orders]
```

### 5.2 Webhook Endpoint

Already covered in [Section 2.3](#23-webhook-event-handling).

### 5.3 Webhook Signature Verification Detail

```python
# Stripe webhook verification flow:

# 1. Stripe sends POST with:
#    - Header: Stripe-Signature: t=1234567890,v1=<signature>,v0=<fallback>
#    - Body: raw JSON bytes

# 2. Our endpoint:
payload = await request.body()                    # MUST be raw bytes
sig_header = request.headers["stripe-signature"]

event = stripe.Webhook.construct_event(
    payload=payload,                              # raw bytes
    sig_header=sig_header,                        # signature header value
    secret=settings.STRIPE_WEBHOOK_SECRET,        # whsec_xxx from Dashboard
)

# 3. What construct_event does internally:
#    - Splits sig_header into timestamp and signatures
#    - Computes HMAC-SHA256(payload, secret)
#    - Compares against each provided signature
#    - Checks timestamp is within tolerance (±5 min by default)
#    - Extracts tolerance from v1 signature prefix

# 4. Common failures:
#    - Using parsed JSON instead of raw bytes → signature mismatch
#    - Wrong webhook secret (test vs. live)
#    - Middleware that transforms the body (e.g., compression, body parsers)
```

---

## 6. Tier Management (Admin)

### 6.1 Admin CRUD API

```python
# backend/app/api/v1/admin/tiers.py

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.deps import get_db, get_current_admin
from app.models.subscription import SubscriptionTier

router = APIRouter(prefix="/admin/tiers", tags=["admin-tiers"])


# ------------------------------------------------------------------
# Schemas
# ------------------------------------------------------------------

class TierFeatures(BaseModel):
    """JSON schema for the `features` column of subscription_tiers."""
    kline_periods: list[str] = Field(
        default=["1d"],
        description="Available K-line periods: 1d, 1w, 1M, 3M, 1y"
    )
    kline_history_days: int = Field(
        default=90,
        description="Max K-line history in days"
    )
    watchlist_limit: int = Field(
        default=5,
        description="Max watchlist symbols (-1 = unlimited)"
    )
    signals: list[str] = Field(
        default=[],
        description="Available signal types"
    )
    indicators: list[str] = Field(
        default=["sma", "ema"],
        description="Available technical indicators"
    )
    ai_analysis_limit: int = Field(
        default=0,
        description="Daily AI analysis quota (-1 = unlimited)"
    )
    ai_providers: list[str] = Field(
        default=[],
        description="Available AI provider models"
    )
    backtest_limit: int = Field(
        default=0,
        description="Daily backtest quota"
    )
    risk_level: bool = Field(default=False)
    alert_channels: list[str] = Field(default=[])
    alert_limit: int = Field(default=0)
    api_daily_limit: int = Field(default=100)
    data_export: bool = Field(default=False)
    support_level: str = Field(default="faq")

    class Config:
        extra = "allow"  # Allow future feature additions


class TierCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    slug: str = Field(..., min_length=1, max_length=50, pattern=r"^[a-z][a-z0-9_]*$")
    stripe_price_id_monthly: Optional[str] = None
    stripe_price_id_yearly: Optional[str] = None
    price_monthly: float = Field(0, ge=0)
    price_yearly: float = Field(0, ge=0)
    features: TierFeatures = Field(default_factory=TierFeatures)
    daily_api_limit: int = Field(100, ge=0)
    watchlist_limit: int = Field(5, ge=-1)
    alert_limit: int = Field(0, ge=-1)
    ai_analysis_limit: int = Field(0, ge=-1)
    sort_order: int = 0
    is_active: bool = True

class TierUpdate(BaseModel):
    name: Optional[str] = None
    stripe_price_id_monthly: Optional[str] = None
    stripe_price_id_yearly: Optional[str] = None
    price_monthly: Optional[float] = Field(None, ge=0)
    price_yearly: Optional[float] = Field(None, ge=0)
    features: Optional[TierFeatures] = None
    daily_api_limit: Optional[int] = Field(None, ge=0)
    watchlist_limit: Optional[int] = Field(None, ge=-1)
    alert_limit: Optional[int] = Field(None, ge=-1)
    ai_analysis_limit: Optional[int] = Field(None, ge=-1)
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None

class TierOut(BaseModel):
    id: int
    name: str
    slug: str
    stripe_price_id_monthly: Optional[str]
    stripe_price_id_yearly: Optional[str]
    price_monthly: float
    price_yearly: float
    features: dict
    daily_api_limit: int
    watchlist_limit: int
    alert_limit: int
    ai_analysis_limit: int
    sort_order: int
    is_active: bool
    created_at: str

    class Config:
        from_attributes = True


# ------------------------------------------------------------------
# Endpoints
# ------------------------------------------------------------------

@router.get("", response_model=list[TierOut])
async def list_tiers(db: AsyncSession = Depends(get_db)):
    """List all subscription tiers (admin)."""
    result = await db.execute(
        select(SubscriptionTier).order_by(SubscriptionTier.sort_order)
    )
    return [TierOut.model_validate(t) for t in result.scalars().all()]


@router.post("", response_model=TierOut, status_code=201)
async def create_tier(
    data: TierCreate,
    db: AsyncSession = Depends(get_db),
    _admin=Depends(get_current_admin),
):
    """Create a new subscription tier."""
    existing = await db.scalar(
        select(SubscriptionTier).where(SubscriptionTier.slug == data.slug)
    )
    if existing:
        raise HTTPException(status_code=409, detail="Tier slug already exists")

    tier = SubscriptionTier(
        name=data.name,
        slug=data.slug,
        stripe_price_id_monthly=data.stripe_price_id_monthly,
        stripe_price_id_yearly=data.stripe_price_id_yearly,
        price_monthly=data.price_monthly,
        price_yearly=data.price_yearly,
        features=data.features.model_dump(),
        daily_api_limit=data.daily_api_limit,
        watchlist_limit=data.watchlist_limit,
        alert_limit=data.alert_limit,
        ai_analysis_limit=data.ai_analysis_limit,
        sort_order=data.sort_order,
        is_active=data.is_active,
    )
    db.add(tier)
    await db.commit()
    await db.refresh(tier)
    return TierOut.model_validate(tier)


@router.get("/{tier_id}", response_model=TierOut)
async def get_tier(tier_id: int, db: AsyncSession = Depends(get_db)):
    tier = await db.get(SubscriptionTier, tier_id)
    if not tier:
        raise HTTPException(status_code=404, detail="Tier not found")
    return TierOut.model_validate(tier)


@router.patch("/{tier_id}", response_model=TierOut)
async def update_tier(
    tier_id: int,
    data: TierUpdate,
    db: AsyncSession = Depends(get_db),
    _admin=Depends(get_current_admin),
):
    tier = await db.get(SubscriptionTier, tier_id)
    if not tier:
        raise HTTPException(status_code=404, detail="Tier not found")

    update_data = data.model_dump(exclude_unset=True)
    if "features" in update_data and update_data["features"] is not None:
        update_data["features"] = update_data["features"].model_dump()

    for field, value in update_data.items():
        setattr(tier, field, value)

    await db.commit()
    await db.refresh(tier)
    return TierOut.model_validate(tier)


@router.delete("/{tier_id}", status_code=204)
async def delete_tier(
    tier_id: int,
    db: AsyncSession = Depends(get_db),
    _admin=Depends(get_current_admin),
):
    tier = await db.get(SubscriptionTier, tier_id)
    if not tier:
        raise HTTPException(status_code=404, detail="Tier not found")
    if tier.slug == "free":
        raise HTTPException(status_code=400, detail="Cannot delete the free tier")
    if tier.is_system:
        raise HTTPException(status_code=400, detail="Cannot delete system tiers")

    # Check for active subscribers
    active_count = await db.scalar(
        select(__import__("sqlalchemy").func.count())
        .select_from(__import__("app.models.subscription").UserSubscription)
        .where(
            __import__("app.models.subscription").UserSubscription.tier_id == tier_id,
            __import__("app.models.subscription").UserSubscription.status.in_(
                ["active", "trialing", "past_due"]
            ),
        )
    )
    if active_count and active_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete tier with {active_count} active subscribers",
        )

    await db.delete(tier)
    await db.commit()
```

### 6.2 Features JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "SubscriptionTierFeatures",
  "type": "object",
  "properties": {
    "kline_periods": {
      "type": "array",
      "items": { "type": "string", "enum": ["1d", "1w", "1M", "3M", "1y"] },
      "description": "Available K-line periods"
    },
    "kline_history_days": {
      "type": "integer",
      "minimum": 0,
      "description": "Max K-line history in days (0 = unlimited)"
    },
    "watchlist_limit": {
      "type": "integer",
      "minimum": -1,
      "description": "Max watchlist symbols (-1 = unlimited)"
    },
    "signals": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "golden_cross", "death_cross",
          "bullish_alignment", "bearish_alignment",
          "composite_buy", "composite_sell"
        ]
      }
    },
    "indicators": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Available technical indicator names"
    },
    "ai_analysis_limit": {
      "type": "integer",
      "minimum": -1,
      "description": "Daily AI analysis quota (-1 = unlimited)"
    },
    "ai_providers": {
      "type": "array",
      "items": { "type": "string" },
      "description": "AI model provider names (e.g. deepseek, openai, anthropic)"
    },
    "backtest_limit": {
      "type": "integer",
      "minimum": -1,
      "description": "Daily backtest quota"
    },
    "risk_level": {
      "type": "boolean",
      "description": "Whether risk level analysis is available"
    },
    "alert_channels": {
      "type": "array",
      "items": { "type": "string", "enum": ["email", "push", "inapp"] }
    },
    "alert_limit": {
      "type": "integer",
      "minimum": -1,
      "description": "Max alert rules (-1 = unlimited)"
    },
    "api_daily_limit": {
      "type": "integer",
      "minimum": 0,
      "description": "Daily API request quota"
    },
    "data_export": {
      "type": "boolean",
      "description": "Whether CSV export is available"
    },
    "support_level": {
      "type": "string",
      "enum": ["faq", "email", "priority"]
    }
  },
  "required": [
    "kline_periods",
    "kline_history_days",
    "watchlist_limit",
    "signals",
    "indicators",
    "ai_analysis_limit",
    "ai_providers",
    "backtest_limit",
    "risk_level",
    "alert_channels",
    "alert_limit",
    "api_daily_limit",
    "data_export",
    "support_level"
  ]
}
```

### 6.3 Coupon / Promotion Code System

```python
# backend/app/services/payment/coupon_service.py

import stripe
from app.core.config import settings

stripe.api_key = settings.STRIPE_SECRET_KEY


class CouponService:
    """
    Manage Stripe Coupons and Promotion Codes.

    Coupons are managed 100% in Stripe (Dashboard or API).
    Our system only needs to:
    1. Enable promotion codes on Checkout Sessions (allow_promotion_codes=True)
    2. Provide admin endpoints to create/list coupons via Stripe API
    """

    # ------------------------------------------------------------------
    # Create Coupon
    # ------------------------------------------------------------------

    @staticmethod
    def create_coupon(
        name: str,
        percent_off: float | None = None,
        amount_off: int | None = None,        # in cents
        duration: str = "once",               # once, forever, repeating
        duration_in_months: int | None = None, # for 'repeating'
        max_redemptions: int | None = None,
        redeem_by: int | None = None,          # Unix timestamp
        currency: str = "usd",
        metadata: dict | None = None,
    ) -> dict:
        """
        Create a coupon in Stripe.

        Args:
            name: Display name.
            percent_off: Percentage discount (e.g. 20 for 20% off).
            amount_off: Fixed amount discount in cents.
            duration: 'once' (first invoice), 'forever' (all invoices),
                      'repeating' (N months).
            duration_in_months: Number of months for 'repeating'.
            max_redemptions: Maximum number of uses.
            redeem_by: Expiration timestamp.
        """
        params = {
            "name": name,
            "duration": duration,
            "metadata": metadata or {},
        }
        if percent_off is not None:
            params["percent_off"] = percent_off
            params["currency"] = currency  # Only for amount_off, but Stripe may require
        if amount_off is not None:
            params["amount_off"] = amount_off
            params["currency"] = currency
        if duration_in_months is not None:
            params["duration_in_months"] = duration_in_months
        if max_redemptions is not None:
            params["max_redemptions"] = max_redemptions
        if redeem_by is not None:
            params["redeem_by"] = redeem_by

        # For percent_off, currency is NOT required by Stripe
        if percent_off is not None and "currency" in params:
            del params["currency"]

        return stripe.Coupon.create(**params)

    # ------------------------------------------------------------------
    # Create Promotion Code
    # ------------------------------------------------------------------

    @staticmethod
    def create_promotion_code(
        coupon_id: str,
        code: str,
        metadata: dict | None = None,
    ) -> dict:
        """
        Create a user-facing promotion code linked to a coupon.

        Example:
            Coupon: 20% off first payment
            Promotion Code: "LAUNCH20" (user enters this at checkout)
        """
        return stripe.PromotionCode.create(
            coupon=coupon_id,
            code=code,
            metadata=metadata or {},
        )

    # ------------------------------------------------------------------
    # List Coupons
    # ------------------------------------------------------------------

    @staticmethod
    def list_coupons(limit: int = 20) -> list[dict]:
        return stripe.Coupon.list(limit=limit).data

    @staticmethod
    def list_promotion_codes(coupon_id: str | None = None, limit: int = 20) -> list[dict]:
        params = {"limit": limit}
        if coupon_id:
            params["coupon"] = coupon_id
        return stripe.PromotionCode.list(**params).data

    # ------------------------------------------------------------------
    # Delete
    # ------------------------------------------------------------------

    @staticmethod
    def delete_coupon(coupon_id: str) -> dict:
        return stripe.Coupon.delete(coupon_id)

    @staticmethod
    def update_promotion_code(promo_id: str, active: bool) -> dict:
        return stripe.PromotionCode.modify(promo_id, active=active)
```

---

## 7. Subscription Guard Middleware

### 7.1 FastAPI Middleware

```python
# backend/app/middleware/subscription_guard.py

"""
Subscription guard — enforce feature limits based on user's subscription tier.

Architecture:
  1. JWT `user_id` extracted by auth middleware → stored in request.state
  2. This middleware checks Redis for cached tier → validates against route metadata
  3. Feature-specific guards (watchlist count, alert count, AI quota) are
     enforced at the service layer, not in middleware, because they require
     database lookups.

Redis caching:
  - Key: user_tier:{user_id}
  - Value: JSON of {tier_slug, tier_id, features_dict, expired_at}
  - TTL: 5 minutes (short enough to reflect tier changes quickly)
  - Invalidation: On any subscription status change (webhook handler)
"""

import json
import time
from typing import Callable, Optional
from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
from redis.asyncio import Redis
import structlog

logger = structlog.get_logger(__name__)


class SubscriptionGuard(BaseHTTPMiddleware):
    """
    Middleware that attaches tier information to every authenticated request.

    This does NOT block requests — it enriches the request context so that
    endpoint handlers and service-layer guards can make tier-aware decisions.

    To block a request based on tier, use the `require_tier` dependency
    or call `guard.require_feature()` in the endpoint handler.
    """

    CACHE_TTL = 300                       # seconds
    CACHE_PREFIX = "user_tier"
    FREE_TIER_DEFAULTS = {
        "tier_slug": "free",
        "tier_id": None,
        "features": {
            "kline_periods": ["1d"],
            "kline_history_days": 90,
            "watchlist_limit": 5,
            "signals": [],
            "indicators": ["sma", "ema"],
            "ai_analysis_limit": 0,
            "ai_providers": [],
            "backtest_limit": 0,
            "risk_level": False,
            "alert_channels": [],
            "alert_limit": 0,
            "api_daily_limit": 100,
            "data_export": False,
            "support_level": "faq",
        },
    }

    def __init__(self, app, redis: Redis, exclude_paths: Optional[list[str]] = None):
        super().__init__(app)
        self.redis = redis
        self.exclude_paths = set(exclude_paths or [])

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Skip non-API and excluded paths
        if not request.url.path.startswith("/api/"):
            return await call_next(request)
        if request.url.path in self.exclude_paths:
            return await call_next(request)

        user_id: Optional[int] = getattr(request.state, "user_id", None)
        if user_id is None:
            # Anonymous request — attach free tier
            request.state.tier = self.FREE_TIER_DEFAULTS
            return await call_next(request)

        # Fetch tier from Redis cache
        tier_data = await self._get_cached_tier(user_id)
        if tier_data is None:
            # Cache miss — fetch from DB
            tier_data = await self._fetch_and_cache_tier(request, user_id)

        request.state.tier = tier_data
        return await call_next(request)

    # ------------------------------------------------------------------
    # Redis Cache
    # ------------------------------------------------------------------

    async def _get_cached_tier(self, user_id: int) -> Optional[dict]:
        key = f"{self.CACHE_PREFIX}:{user_id}"
        raw = await self.redis.get(key)
        if raw:
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                pass
        return None

    async def _fetch_and_cache_tier(self, request: Request, user_id: int) -> dict:
        """Fetch tier from DB, cache in Redis, return dict."""
        from sqlalchemy import select
        from app.models.subscription import UserSubscription, SubscriptionTier
        from app.core.deps import get_db

        # Get DB session (FastAPI dependency)
        db_gen = get_db()
        db = await db_gen.__anext__()

        try:
            now = __import__("datetime").datetime.now(__import__("datetime").timezone.utc)

            sub = await db.scalar(
                select(UserSubscription).where(
                    UserSubscription.user_id == user_id,
                    UserSubscription.status.in_(["active", "trialing", "past_due"]),
                )
            )

            if sub and sub.status == "canceled":
                # Check grace period
                if sub.grace_until and sub.grace_until > now:
                    # Still in grace — use subscribed tier
                    pass
                else:
                    sub = None  # Fall through to free tier

            if sub:
                tier = await db.get(SubscriptionTier, sub.tier_id)
                if tier and tier.is_active:
                    tier_data = {
                        "tier_slug": tier.slug,
                        "tier_id": tier.id,
                        "features": tier.features,
                        "expired_at": sub.expired_at.isoformat() if sub.expired_at else None,
                        "status": sub.status,
                    }
                else:
                    tier_data = self.FREE_TIER_DEFAULTS
            else:
                tier_data = self.FREE_TIER_DEFAULTS

            # Cache in Redis
            await self.redis.setex(
                f"{self.CACHE_PREFIX}:{user_id}",
                self.CACHE_TTL,
                json.dumps(tier_data),
            )

            return tier_data

        finally:
            await db_gen.aclose()
```

### 7.2 Feature Guard Dependencies

```python
# backend/app/core/deps.py (additions)

from fastapi import Depends, HTTPException, Request


async def get_current_tier(request: Request) -> dict:
    """Dependency that returns the current user's tier info."""
    tier = getattr(request.state, "tier", None)
    if tier is None:
        raise HTTPException(status_code=500, detail="Tier not resolved")
    return tier


def require_minimum_tier(min_slug: str):
    """
    Dependency factory: require at least `min_slug` tier.

    Usage:
        @router.get("/premium-feature")
        async def premium_endpoint(
            tier: dict = Depends(require_minimum_tier("basic"))
        ):
            ...
    """
    TIER_LEVEL = {"free": 0, "basic": 1, "pro": 2}
    min_level = TIER_LEVEL.get(min_slug, 0)

    async def checker(tier: dict = Depends(get_current_tier)):
        current_slug = tier.get("tier_slug", "free")
        current_level = TIER_LEVEL.get(current_slug, 0)
        if current_level < min_level:
            raise HTTPException(
                status_code=403,
                detail=f"This feature requires at least {min_slug} tier",
            )
        return tier

    return checker


def require_feature(feature_name: str, min_value=None):
    """
    Dependency factory: require a specific feature boolean or minimum count.

    Usage:
        @router.post("/analysis/ai")
        async def ai_analysis(
            tier: dict = Depends(require_feature("ai_analysis_limit", 1))
        ):
            ...
    """
    async def checker(tier: dict = Depends(get_current_tier)):
        features = tier.get("features", {})
        value = features.get(feature_name)
        if value is None:
            raise HTTPException(
                status_code=403,
                detail=f"Feature '{feature_name}' is not available on your plan",
            )
        if isinstance(value, bool) and not value:
            raise HTTPException(
                status_code=403,
                detail=f"Feature '{feature_name}' is not available on your plan",
            )
        if min_value is not None and isinstance(value, (int, float)):
            if value < min_value:
                raise HTTPException(
                    status_code=403,
                    detail=f"Feature '{feature_name}' requires minimum {min_value}",
                )
        return tier

    return checker
```

### 7.3 Service-Layer Feature Guards

```python
# backend/app/services/subscription_guard.py

"""
Service-layer tier enforcement.

Called within endpoint handlers when feature limits depend on
current usage counts (which require DB lookups).
"""

from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.watchlist import Watchlist, WatchlistItem
from app.models.alert import AlertRule, AlertLog
from app.models.ai_analysis import AIAnalysisResult


class TierGuard:
    """
    Check feature limits against current usage.

    Usage in endpoint handler:
        guard = TierGuard(db)
        await guard.check_watchlist_limit(user_id, tier)
        await guard.check_alert_limit(user_id, tier)
        await guard.check_ai_analysis_limit(user_id, tier)
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    async def check_watchlist_limit(self, user_id: int, tier: dict) -> None:
        """
        Check if user can add more watchlist items.

        Raises HTTPException 403 if limit exceeded.
        """
        limit = tier["features"].get("watchlist_limit", 5)
        if limit == -1:
            return  # Unlimited

        watchlist = await self.db.scalar(
            select(Watchlist).where(Watchlist.user_id == user_id)
        )
        if not watchlist:
            return

        count = await self.db.scalar(
            select(func.count(WatchlistItem.id)).where(
                WatchlistItem.watchlist_id == watchlist.id
            )
        )

        if count >= limit:
            raise HTTPException(
                status_code=403,
                detail=f"Watchlist limit reached ({count}/{limit}). Upgrade to add more.",
            )

    async def check_alert_limit(self, user_id: int, tier: dict) -> None:
        """
        Check if user can create more alert rules.

        Raises HTTPException 403 if limit exceeded.
        """
        limit = tier["features"].get("alert_limit", 0)
        if limit == -1:
            return

        count = await self.db.scalar(
            select(func.count(AlertRule.id)).where(
                AlertRule.user_id == user_id,
                AlertRule.is_active == True,
            )
        )

        if count >= limit:
            raise HTTPException(
                status_code=403,
                detail=f"Alert limit reached ({count}/{limit}). Upgrade to add more.",
            )

    async def check_ai_analysis_limit(self, user_id: int, tier: dict) -> None:
        """
        Check if user has remaining AI analysis quota for today.

        Raises HTTPException 429 if limit exceeded.
        """
        limit = tier["features"].get("ai_analysis_limit", 0)
        if limit == -1:
            return

        from datetime import datetime, timezone, timedelta
        today_start = datetime.now(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        )

        count = await self.db.scalar(
            select(func.count(AIAnalysisResult.id)).where(
                AIAnalysisResult.user_id == user_id,
                AIAnalysisResult.generated_at >= today_start,
            )
        )

        if count >= limit:
            raise HTTPException(
                status_code=429,
                detail=f"Daily AI analysis limit reached ({count}/{limit}). "
                       f"Resets at midnight UTC. Upgrade to increase.",
            )

    async def check_api_rate_limit(self, user_id: int, tier: dict) -> tuple[int, int]:
        """
        Check API rate limit using Redis token bucket.
        Returns (remaining, limit).
        """
        limit = tier["features"].get("api_daily_limit", 100)
        # Implementation delegates to rate_limit middleware
        # See 001-preliminary-design.md §9.3 for token bucket details
        return limit, limit
```

---

## 8. Revenue Analytics

### 8.1 Metric Definitions

| Metric | Formula | Description |
|---|---|---|
| **MRR** | SUM(normalized_monthly_revenue) across all active subscriptions | Monthly Recurring Revenue |
| **ARR** | MRR × 12 | Annualized Run Rate |
| **Churn Rate** | canceled_in_period / active_at_period_start × 100% | Customer churn over a period |
| **Revenue Churn** | lost_mrr / mrr_at_start × 100% | Revenue churn rate |
| **Expansion MRR** | MRR from upgrades minus MRR from downgrades | Net negative churn measure |
| **LTV** | ARPU / monthly_churn_rate | Lifetime Value |
| **ARPU** | MRR / active_subscribers | Average Revenue Per User |
| **Trial Conv.** | converted / started_trial × 100% | Trial-to-paid conversion rate |

### 8.2 SQL Queries

```sql
-- ============================================================================
-- 1. Monthly Recurring Revenue (MRR)
-- ============================================================================
-- Normalized: yearly subs = price_yearly / 12
SELECT
    SUM(
        CASE
            WHEN us.period = 'yearly' THEN t.price_yearly / 12.0
            ELSE t.price_monthly
        END
    ) AS mrr
FROM user_subscriptions us
JOIN subscription_tiers t ON t.id = us.tier_id
WHERE us.status IN ('active', 'past_due', 'trialing');

-- ============================================================================
-- 2. MRR by Tier
-- ============================================================================
SELECT
    t.slug AS tier,
    COUNT(us.id) AS subscriber_count,
    SUM(
        CASE
            WHEN us.period = 'yearly' THEN t.price_yearly / 12.0
            ELSE t.price_monthly
        END
    ) AS mrr
FROM user_subscriptions us
JOIN subscription_tiers t ON t.id = us.tier_id
WHERE us.status IN ('active', 'past_due', 'trialing')
GROUP BY t.slug, t.price_monthly, t.price_yearly;

-- ============================================================================
-- 3. Annual Recurring Revenue (ARR)
-- ============================================================================
SELECT SUM(
    CASE
        WHEN us.period = 'yearly' THEN t.price_yearly
        ELSE t.price_monthly * 12
    END
) AS arr
FROM user_subscriptions us
JOIN subscription_tiers t ON t.id = us.tier_id
WHERE us.status IN ('active', 'past_due', 'trialing');

-- ============================================================================
-- 4. Churn Rate (30-day)
-- ============================================================================
WITH period_start AS (
    SELECT DATE_SUB(NOW(), INTERVAL 30 DAY) AS start_date
),
active_at_start AS (
    SELECT COUNT(*) AS cnt
    FROM user_subscriptions us, period_start ps
    WHERE us.status IN ('active', 'trialing', 'past_due')
      AND us.started_at <= ps.start_date
),
canceled_in_period AS (
    SELECT COUNT(*) AS cnt
    FROM user_subscriptions us, period_start ps
    WHERE us.status = 'canceled'
      AND us.updated_at >= ps.start_date
)
SELECT
    ROUND(canceled_in_period.cnt * 100.0 / NULLIF(active_at_start.cnt, 0), 2) AS churn_rate_pct
FROM active_at_start, canceled_in_period;

-- ============================================================================
-- 5. Revenue Churn Rate (30-day)
-- ============================================================================
WITH period_start AS (
    SELECT DATE_SUB(NOW(), INTERVAL 30 DAY) AS start_date
),
mrr_at_start AS (
    SELECT SUM(
        CASE
            WHEN us.period = 'yearly' THEN t.price_yearly / 12.0
            ELSE t.price_monthly
        END
    ) AS mrr
    FROM user_subscriptions us
    JOIN subscription_tiers t ON t.id = us.tier_id
    CROSS JOIN period_start ps
    WHERE us.status IN ('active', 'trialing', 'past_due')
      AND us.started_at <= ps.start_date
),
lost_mrr AS (
    SELECT SUM(
        CASE
            WHEN us.period = 'yearly' THEN t.price_yearly / 12.0
            ELSE t.price_monthly
        END
    ) AS mrr
    FROM user_subscriptions us
    JOIN subscription_tiers t ON t.id = us.tier_id
    CROSS JOIN period_start ps
    WHERE us.status = 'canceled'
      AND us.updated_at >= ps.start_date
)
SELECT
    ROUND(lost_mrr.mrr * 100.0 / NULLIF(mrr_at_start.mrr, 0), 2) AS revenue_churn_pct
FROM mrr_at_start, lost_mrr;

-- ============================================================================
-- 6. LTV Estimation
-- ============================================================================
-- LTV = ARPU / monthly_churn_rate
WITH mrr AS (
    SELECT SUM(
        CASE
            WHEN us.period = 'yearly' THEN t.price_yearly / 12.0
            ELSE t.price_monthly
        END
    ) AS mrr
    FROM user_subscriptions us
    JOIN subscription_tiers t ON t.id = us.tier_id
    WHERE us.status IN ('active', 'past_due', 'trialing')
),
active_subs AS (
    SELECT COUNT(*) AS cnt
    FROM user_subscriptions
    WHERE status IN ('active', 'past_due', 'trialing')
),
churn AS (
    SELECT
        COUNT(CASE WHEN status = 'canceled'
                   AND updated_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END) * 100.0
        / NULLIF(COUNT(CASE WHEN started_at <= DATE_SUB(NOW(), INTERVAL 30 DAY)
                             AND status IN ('active', 'trialing', 'past_due') THEN 1 END), 0)
        / 100.0 AS monthly_churn
    FROM user_subscriptions
)
SELECT
    ROUND(mrr.mrr / active_subs.cnt, 2) AS arpu,
    ROUND(churn.monthly_churn * 100, 2) AS monthly_churn_pct,
    ROUND(
        (mrr.mrr / active_subs.cnt) / NULLIF(churn.monthly_churn, 0),
        2
    ) AS ltv
FROM mrr, active_subs, churn;

-- ============================================================================
-- 7. Trial Conversion Rate (30-day)
-- ============================================================================
WITH period_start AS (
    SELECT DATE_SUB(NOW(), INTERVAL 30 DAY) AS start_date
),
trials_started AS (
    SELECT COUNT(DISTINCT us.user_id) AS cnt
    FROM user_subscriptions us, period_start ps
    WHERE us.status = 'trialing'
      AND us.started_at >= ps.start_date
),
converted AS (
    SELECT COUNT(DISTINCT us.user_id) AS cnt
    FROM user_subscriptions us, period_start ps
    WHERE us.status IN ('active', 'past_due')
      AND us.started_at >= ps.start_date
      AND us.trial_end IS NOT NULL
      AND us.trial_end >= ps.start_date
)
SELECT
    ROUND(converted.cnt * 100.0 / NULLIF(trials_started.cnt, 0), 2) AS trial_conversion_pct
FROM trials_started, converted;

-- ============================================================================
-- 8. Revenue by Geography (requires billing address from Stripe)
-- ============================================================================
SELECT
    po.country,
    COUNT(po.id) AS order_count,
    SUM(po.amount) AS total_revenue,
    AVG(po.amount) AS avg_order_value
FROM payment_orders po
WHERE po.status = 'paid'
  AND po.created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
GROUP BY po.country
ORDER BY total_revenue DESC;

-- ============================================================================
-- 9. New Subscriptions per Day (last 30 days)
-- ============================================================================
SELECT
    DATE(us.started_at) AS date,
    t.slug AS tier,
    COUNT(*) AS new_subscriptions
FROM user_subscriptions us
JOIN subscription_tiers t ON t.id = us.tier_id
WHERE us.started_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
  AND t.slug != 'free'
GROUP BY DATE(us.started_at), t.slug
ORDER BY date DESC, tier;

-- ============================================================================
-- 10. Net Revenue Retention (NRR) — Expansion MRR
-- ============================================================================
-- NRR = (starting MRR + expansion - contraction - churn) / starting MRR
-- Calculated in application code using a cohort of subscribers
-- from 30 days ago, comparing their current MRR to their MRR then.
```

### 8.3 Revenue Analytics Service

```python
# backend/app/services/analytics/revenue_analytics.py

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from sqlalchemy import select, func, text, case
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.subscription import (
    PaymentOrder, UserSubscription, SubscriptionTier,
)


class RevenueAnalytics:
    """Calculate SaaS revenue metrics from the database."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # MRR
    # ------------------------------------------------------------------

    async def mrr(self) -> Decimal:
        """Monthly Recurring Revenue — normalized to monthly."""
        result = await self.db.execute(
            select(func.sum(
                case(
                    (UserSubscription.period == "yearly",
                     SubscriptionTier.price_yearly / 12),
                    else_=SubscriptionTier.price_monthly,
                )
            ))
            .select_from(UserSubscription)
            .join(SubscriptionTier, SubscriptionTier.id == UserSubscription.tier_id)
            .where(UserSubscription.status.in_(["active", "past_due", "trialing"]))
        )
        return result.scalar() or Decimal("0.00")

    async def arr(self) -> Decimal:
        """Annual Recurring Revenue = MRR × 12."""
        mrr_val = await self.mrr()
        return mrr_val * 12

    # ------------------------------------------------------------------
    # Churn
    # ------------------------------------------------------------------

    async def churn_rate(self, days: int = 30) -> float:
        """Customer churn rate over `days` days."""
        period_start = datetime.now(timezone.utc) - timedelta(days=days)

        active_at_start = await self.db.scalar(
            select(func.count(UserSubscription.id)).where(
                UserSubscription.status.in_(["active", "trialing", "past_due"]),
                UserSubscription.started_at <= period_start,
            )
        )

        canceled = await self.db.scalar(
            select(func.count(UserSubscription.id)).where(
                UserSubscription.status == "canceled",
                UserSubscription.updated_at >= period_start,
            )
        )

        if not active_at_start:
            return 0.0
        return round(canceled / active_at_start * 100, 2)

    async def revenue_churn_rate(self, days: int = 30) -> float:
        """Revenue churn rate over `days` days."""
        period_start = datetime.now(timezone.utc) - timedelta(days=days)

        mrr_start = await self.db.scalar(
            select(func.sum(
                case(
                    (UserSubscription.period == "yearly",
                     SubscriptionTier.price_yearly / 12),
                    else_=SubscriptionTier.price_monthly,
                )
            ))
            .select_from(UserSubscription)
            .join(SubscriptionTier, SubscriptionTier.id == UserSubscription.tier_id)
            .where(
                UserSubscription.status.in_(["active", "trialing", "past_due"]),
                UserSubscription.started_at <= period_start,
            )
        ) or Decimal("0")

        lost_mrr = await self.db.scalar(
            select(func.sum(
                case(
                    (UserSubscription.period == "yearly",
                     SubscriptionTier.price_yearly / 12),
                    else_=SubscriptionTier.price_monthly,
                )
            ))
            .select_from(UserSubscription)
            .join(SubscriptionTier, SubscriptionTier.id == UserSubscription.tier_id)
            .where(
                UserSubscription.status == "canceled",
                UserSubscription.updated_at >= period_start,
            )
        ) or Decimal("0")

        if mrr_start == 0:
            return 0.0
        return round(float(lost_mrr / mrr_start) * 100, 2)

    # ------------------------------------------------------------------
    # LTV
    # ------------------------------------------------------------------

    async def ltv(self) -> Decimal:
        """
        LTV = ARPU / monthly_churn_rate.

        Uses a conservative approach:
        - ARPU from current active subscribers
        - Churn rate over 30 days
        """
        active_count = await self.db.scalar(
            select(func.count(UserSubscription.id)).where(
                UserSubscription.status.in_(["active", "past_due"]),
            )
        )
        if not active_count:
            return Decimal("0.00")

        mrr_val = await self.mrr()
        arpu = mrr_val / active_count

        churn = await self.churn_rate(30) / 100.0
        if churn <= 0.001:
            # Cap at 100 months if churn is effectively zero
            return arpu * 100

        return arpu / Decimal(str(churn))

    # ------------------------------------------------------------------
    # Trial Conversion
    # ------------------------------------------------------------------

    async def trial_conversion_rate(self, days: int = 30) -> float:
        """% of trial users who converted to paid in the period."""
        period_start = datetime.now(timezone.utc) - timedelta(days=days)

        total_trials = await self.db.scalar(
            select(func.count(UserSubscription.id)).where(
                UserSubscription.status.in_(["trialing", "active", "past_due"]),
                UserSubscription.started_at >= period_start,
                UserSubscription.trial_end.isnot(None),
            )
        )

        converted = await self.db.scalar(
            select(func.count(UserSubscription.id)).where(
                UserSubscription.status.in_(["active", "past_due"]),
                UserSubscription.started_at >= period_start,
                UserSubscription.trial_end.isnot(None),
                UserSubscription.trial_end >= period_start,
            )
        )

        if not total_trials:
            return 0.0
        return round(converted / total_trials * 100, 2)

    # ------------------------------------------------------------------
    # Dashboard
    # ------------------------------------------------------------------

    async def dashboard(self) -> dict:
        """Complete revenue dashboard for admin."""
        active_count = await self.db.scalar(
            select(func.count(UserSubscription.id)).where(
                UserSubscription.status.in_(["active", "past_due"]),
            )
        ) or 0

        return {
            "mrr": float(await self.mrr()),
            "arr": float(await self.arr()),
            "active_subscribers": active_count,
            "arpu": float(await self.mrr()) / active_count if active_count else 0.0,
            "churn_rate_30d": await self.churn_rate(30),
            "revenue_churn_30d": await self.revenue_churn_rate(30),
            "ltv": float(await self.ltv()),
            "trial_conversion_30d": await self.trial_conversion_rate(30),
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
```

---

## 9. Edge Cases & Error Handling

### 9.1 Payment Failure Retry

```
Flow:
  Day 0:   Invoice created, payment attempted → fails
           Stripe sends invoice.payment_failed webhook
           We mark user_subscription.status = 'past_due'
           User retains full access

  Day 1-7: Stripe Smart Retries (ML-optimized timing)
           Multiple retry attempts at optimal times
           Stripe sends dunning emails to customer

  Day ~7:  All retries exhausted
           Stripe sends customer.subscription.updated (status='unpaid')
           We mark user_subscription.status = 'canceled'
           Grace period of 3 days begins

  Day ~10: Grace period ends → downgrade to Free tier

Our responsibility:
  - Listen for invoice.payment_failed → mark past_due
  - Stripe handles all retry logic and customer communication
  - Listen for customer.subscription.updated (status='canceled'/'unpaid')
    → cancel + start grace period
```

### 9.2 Double-Charge Prevention (Idempotency)

```
Defense layers (defense in depth):

Layer 1: Redis SETNX
  - Guard.is_duplicate(event_id) checks Redis before processing
  - TTL = 7 days (exceeds Stripe's 3-day retry window)
  - O(1) atomic check-and-set

Layer 2: Database UNIQUE constraint
  - payment_orders.idempotency_key UNIQUE
  - payment_orders.provider_session_id (application-level dedup)
  - Catches any edge case where Redis key expired

Layer 3: Stripe Idempotency Keys
  - For API-initiated operations (create_checkout_session),
    pass an Idempotency-Key header to Stripe
  - Stripe returns the same response for duplicate keys within 24h
  - stripe.checkout.Session.create(..., idempotency_key="ik_xxx")
```

### 9.3 Subscription Cancellation During Billing Cycle

```
Scenario: User on annual plan cancels 3 months in (9 months remaining)

Flow:
  1. User cancels via Customer Portal
     → Stripe sets cancel_at_period_end = true
     → customer.subscription.updated webhook fires
     → We set user_subscription.cancel_at_period_end = true
     → Status remains 'active'

  2. User retains Pro access for remaining 9 months

  3. At period end:
     → Stripe sends customer.subscription.deleted
     → We set status = 'canceled', grace_until = now + 3 days

  4. After 3-day grace:
     → Downgrade to Free tier

If user changes mind before period end:
  → User clicks "Resume" in Customer Portal
  → Stripe clears cancel_at_period_end
  → We clear cancel_at_period_end in local DB
  → Subscription continues normally
```

### 9.4 Refund Handling

```
Refund initiated via Stripe Dashboard (admin action):

  1. Admin issues refund in Stripe Dashboard
  2. Stripe sends charge.refunded webhook
  3. PaymentService.handle_refund():
     - Find PaymentOrder by provider_payment_intent_id
     - Update status from 'paid' → 'refunded'
     - DO NOT automatically cancel subscription
       (admin decides whether to also cancel)

  If refund + cancel needed:
  - Admin cancels subscription in Stripe Dashboard
  - customer.subscription.deleted webhook handles cancellation
```

### 9.5 Dispute / Chargeback Handling

```
Flow:
  1. Customer files dispute with their bank
  2. Stripe sends charge.dispute.created webhook
  3. Our response:
     - Log the dispute details
     - Flag the user account (optional: restrict access)
     - NOTIFY ADMIN (email/Slack)
     - Stripe deducts amount + $15 dispute fee
     - DO NOT auto-cancel subscription (let admin decide)

  4. Dispute resolution:
     - Won: Stripe sends charge.dispute.closed (status='won')
       → Re-instate funds
     - Lost: Stripe sends charge.dispute.closed (status='lost')
       → funds + fee permanently lost
       → Admin should cancel subscription + ban user if fraudulent

  Prevention:
  - Clear refund policy in ToS
  - Responsive support (resolve issues before they become disputes)
  - Maintain evidence: payment records, IP logs, ToS acceptance timestamp
```

### 9.6 Webhook Delivery Failures

```
Stripe Webhook Reliability:
  - Stripe retries webhook delivery for up to 3 days
  - Exponential backoff: 0s → 60s → 5min → 20min → 1h → 2h → 8h → ...
  - Events ordered but not guaranteed (use API to get latest state)
  - Dashboard shows all delivery attempts and failures

Our responsibilities:
  1. Return 2xx quickly (within 5 seconds)
  2. Never do heavy processing synchronously in the webhook handler
  3. Always fetch latest state from Stripe API (don't trust event order)
  4. Monitor Stripe Dashboard for persistent failures
  5. Implement a reconciliation job if needed

Monitoring:
  - Stripe Dashboard: Developers → Webhooks → Events
  - stripe listen --forward-to (local dev)
  - Health check endpoint: GET /health reports webhook processing stats
```

---

## 10. Testing Strategy

### 10.1 Stripe Test Mode Setup

```bash
# Environment variables for test mode
STRIPE_SECRET_KEY=sk_test_xxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxx

# Test card numbers:
# ┌──────────────────────────────────────┬───────────┬──────────────────────┐
# │ Card Number                         │ Brand     │ Behavior             │
# ├──────────────────────────────────────┼───────────┼──────────────────────┤
# │ 4242 4242 4242 4242                 │ Visa      │ Success              │
# │ 5555 5555 5555 4444                 │ Mastercard│ Success              │
# │ 4000 0025 0000 3155                 │ Visa      │ 3D Secure required   │
# │ 4000 0000 0000 9995                 │ Visa      │ Declined             │
# │ 4000 0000 0000 0341                 │ Visa      │ Attach to setup      │
# │ 4000 0000 0000 3220                 │ Visa      │ 3DS2 frictionless    │
# └──────────────────────────────────────┴───────────┴──────────────────────┘

# Test WeChat Pay / Alipay:
# - Use Stripe test mode + WeChat/Alipay sandbox QR codes
# - Redirect flow: authorize then return to success_url
```

### 10.2 Webhook Testing with Stripe CLI

```bash
# 1. Install Stripe CLI
brew install stripe/stripe-cli/stripe

# 2. Login
stripe login

# 3. Forward webhooks to local server
stripe listen --forward-to localhost:8000/api/v1/webhooks/stripe

# Output:
# > Ready! Your webhook signing secret is whsec_xxxx
# Copy this to .env → STRIPE_WEBHOOK_SECRET

# 4. Trigger test events
stripe trigger checkout.session.completed
stripe trigger customer.subscription.updated
stripe trigger customer.subscription.deleted
stripe trigger invoice.payment_succeeded
stripe trigger invoice.payment_failed
stripe trigger charge.refunded

# 5. List recent events
stripe events list --limit 10

# 6. View a specific event
stripe events retrieve evt_xxxx
```

### 10.3 Mock Provider for Unit Tests

```python
# backend/tests/conftest.py (payment fixtures)

import pytest
from unittest.mock import AsyncMock, MagicMock
from datetime import datetime, timezone
from app.services.payment.base import (
    PaymentProvider, CheckoutSessionResult, SubscriptionInfo,
    SubscriptionStatus, PaymentProviderType,
)


class MockPaymentProvider(PaymentProvider):
    """
    In-memory payment provider for unit testing.

    Simulates Stripe behavior without real API calls.
    Allows injecting webhook events and verifying state transitions.
    """

    def __init__(self):
        self._subscriptions: dict[str, dict] = {}
        self._customers: dict[str, dict] = {}
        self._next_sub_id = 1
        self._next_customer_id = 1

        # Call counters for test assertions
        self.checkout_calls: list[dict] = []
        self.cancel_calls: list[dict] = []
        self.update_calls: list[dict] = []

    # ------------------------------------------------------------------
    # create_checkout_session
    # ------------------------------------------------------------------

    async def create_checkout_session(
        self,
        user_id: int,
        customer_email: str,
        price_id: str,
        success_url: str,
        cancel_url: str,
        metadata: dict | None = None,
        trial_period_days: int | None = None,
    ) -> CheckoutSessionResult:
        session_id = f"cs_test_{self._next_sub_id}"
        customer_id = f"cus_test_{user_id}"

        self._customers[customer_id] = {
            "id": customer_id,
            "email": customer_email,
            "user_id": user_id,
        }

        self.checkout_calls.append({
            "user_id": user_id,
            "price_id": price_id,
            "trial_period_days": trial_period_days,
        })

        self._next_sub_id += 1
        return CheckoutSessionResult(
            url=f"https://checkout.stripe.com/test/{session_id}",
            session_id=session_id,
            provider=PaymentProviderType.STRIPE,
        )

    # ------------------------------------------------------------------
    # handle_webhook
    # ------------------------------------------------------------------

    async def handle_webhook(
        self, payload: bytes, headers: dict
    ) -> tuple[str, dict]:
        import json
        event = json.loads(payload)
        event_type = event.get("type", "unknown")
        return event_type, event.get("data", {}).get("object", {})

    # ------------------------------------------------------------------
    # get_subscription
    # ------------------------------------------------------------------

    async def get_subscription(
        self, subscription_id: str
    ) -> SubscriptionInfo:
        sub = self._subscriptions.get(subscription_id)
        if not sub:
            raise Exception(f"Subscription not found: {subscription_id}")
        return SubscriptionInfo(
            provider_subscription_id=subscription_id,
            provider_customer_id=sub.get("customer_id", ""),
            status=SubscriptionStatus(sub["status"]),
            current_period_start=sub.get("period_start", ""),
            current_period_end=sub.get("period_end", ""),
            cancel_at_period_end=sub.get("cancel_at_period_end", False),
            price_id=sub.get("price_id"),
            is_trial=sub.get("status") == "trialing",
        )

    # ------------------------------------------------------------------
    # cancel_subscription
    # ------------------------------------------------------------------

    async def cancel_subscription(
        self,
        subscription_id: str,
        at_period_end: bool = True,
    ) -> SubscriptionInfo:
        sub = self._subscriptions.get(subscription_id)
        if not sub:
            raise Exception(f"Subscription not found: {subscription_id}")

        self.cancel_calls.append({
            "subscription_id": subscription_id,
            "at_period_end": at_period_end,
        })

        if at_period_end:
            sub["cancel_at_period_end"] = True
        else:
            sub["status"] = "canceled"

        return await self.get_subscription(subscription_id)

    # ------------------------------------------------------------------
    # update_subscription
    # ------------------------------------------------------------------

    async def update_subscription(
        self,
        subscription_id: str,
        new_price_id: str,
        proration_behavior: str = "create_prorations",
    ) -> SubscriptionInfo:
        sub = self._subscriptions.get(subscription_id)
        if not sub:
            raise Exception(f"Subscription not found: {subscription_id}")

        self.update_calls.append({
            "subscription_id": subscription_id,
            "new_price_id": new_price_id,
            "proration_behavior": proration_behavior,
        })

        sub["price_id"] = new_price_id
        return await self.get_subscription(subscription_id)

    # ------------------------------------------------------------------
    # get_portal_url
    # ------------------------------------------------------------------

    async def get_portal_url(self, customer_id: str, return_url: str) -> str:
        return f"https://billing.stripe.com/test/portal/{customer_id}"

    # ------------------------------------------------------------------
    # Test helpers (inject state)
    # ------------------------------------------------------------------

    def set_subscription(self, sub_id: str, data: dict):
        """Inject a subscription for testing."""
        self._subscriptions[sub_id] = data

    def make_webhook_event(self, event_type: str, data: dict) -> tuple[bytes, dict]:
        """Build a webhook payload for simulate_webhook()."""
        import json
        payload = json.dumps({
            "type": event_type,
            "data": {"object": data},
        }).encode()
        return payload, {"stripe-signature": "test_sig"}


# ------------------------------------------------------------------
# Pytest Fixtures
# ------------------------------------------------------------------

@pytest.fixture
def mock_payment_provider():
    return MockPaymentProvider()


@pytest.fixture
def free_tier_fixture():
    """Create a Free tier in the test database."""
    ...


@pytest.fixture
def basic_tier_fixture():
    """Create a Basic tier with Stripe price IDs."""
    ...


@pytest.fixture
def active_subscription_fixture(db, basic_tier_fixture, user_fixture):
    """Create an active Basic subscription for a test user."""
    ...
```

### 10.4 Unit Test Examples

```python
# backend/tests/services/test_payment_service.py

import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch
from app.services.payment.payment_service import PaymentService
from app.services.payment.idempotency import IdempotencyGuard


class TestIdempotencyGuard:
    """Tests for the Redis-based idempotency guard."""

    async def test_first_event_not_duplicate(self, mock_redis):
        guard = IdempotencyGuard(mock_redis)
        mock_redis.set.return_value = True  # SETNX succeeded

        is_dup = await guard.is_duplicate(provider="stripe", event_id="evt_123")
        assert is_dup is False

    async def test_second_event_is_duplicate(self, mock_redis):
        guard = IdempotencyGuard(mock_redis)
        mock_redis.set.return_value = None  # SETNX failed

        is_dup = await guard.is_duplicate(provider="stripe", event_id="evt_123")
        assert is_dup is True

    async def test_duplicate_with_key(self, mock_redis):
        guard = IdempotencyGuard(mock_redis)
        mock_redis.set.return_value = None

        is_dup = await guard.is_duplicate_with_key(
            provider="stripe",
            idempotency_key="client_key_abc",
        )
        assert is_dup is True


class TestCheckoutCompleted:
    """Tests for checkout.session.completed handler."""

    async def test_new_subscription_created(self, db, mock_redis):
        """Happy path: checkout completed creates subscription."""
        # TODO: Implement with test fixtures
        pass

    async def test_existing_session_skipped(self, db, mock_redis):
        """Duplicate session event should be skipped."""
        pass

    async def test_tier_not_found_handled(self, db, mock_redis):
        """Missing tier for Stripe price should log error, not crash."""
        pass


class TestInvoiceFailed:
    """Tests for invoice.payment_failed handler."""

    async def test_marks_past_due(self):
        """Payment failure should set status to past_due."""
        pass

    async def test_access_retained_during_retries(self):
        """User should retain access while Stripe retries."""
        pass


class TestGracePeriod:
    """Tests for grace period enforcement."""

    async def test_access_during_grace_period(self):
        """User has full access for 3 days after cancellation."""
        pass

    async def test_downgrade_after_grace_period(self):
        """After grace period, user is downgraded to Free."""
        pass
```

### 10.5 Integration Test (End-to-End)

```python
# backend/tests/integration/test_payment_flow.py

"""
End-to-end payment flow test using MockPaymentProvider.

Covers:
  1. Create checkout session → returns URL
  2. Simulate webhook: checkout.session.completed → subscription created
  3. Verify subscription status in DB
  4. Simulate webhook: invoice.payment_failed → past_due
  5. Simulate webhook: customer.subscription.deleted → canceled + grace
  6. Run grace period enforcement → downgraded to free

Run with: pytest tests/integration/test_payment_flow.py -v
"""

import pytest
from datetime import datetime, timedelta, timezone
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.models.subscription import UserSubscription, PaymentOrder


@pytest.mark.integration
class TestPaymentFlow:

    async def test_full_checkout_to_cancel_flow(
        self,
        db,
        mock_redis,
        mock_payment_provider,
        test_user,
        basic_tier,
    ):
        """Full lifecycle: checkout → active → past_due → canceled → downgrade."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # 1. Authenticate
            login_resp = await client.post("/api/v1/auth/login", json={
                "email": test_user.email,
                "password": "testpass123",
            })
            token = login_resp.json()["access_token"]
            headers = {"Authorization": f"Bearer {token}"}

            # 2. Create checkout session
            checkout_resp = await client.post(
                "/api/v1/payments/create-checkout",
                json={
                    "tier_slug": "basic",
                    "period": "monthly",
                    "success_url": "https://app.example.com/success",
                    "cancel_url": "https://app.example.com/cancel",
                },
                headers=headers,
            )
            assert checkout_resp.status_code == 200
            assert "checkout_url" in checkout_resp.json()

            # 3. Simulate checkout.session.completed webhook
            session_id = checkout_resp.json()["session_id"]
            mock_payment_provider.set_subscription(
                f"sub_{session_id}",
                {
                    "status": "active",
                    "customer_id": f"cus_{test_user.id}",
                    "price_id": basic_tier.stripe_price_id_monthly,
                    "period_start": datetime.now(timezone.utc).isoformat(),
                    "period_end": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
                    "cancel_at_period_end": False,
                },
            )

            payload, sig = mock_payment_provider.make_webhook_event(
                "checkout.session.completed",
                {
                    "id": session_id,
                    "metadata": {"user_id": str(test_user.id)},
                    "customer": f"cus_{test_user.id}",
                    "subscription": f"sub_{session_id}",
                    "amount_total": 999,
                    "currency": "usd",
                },
            )
            webhook_resp = await client.post(
                "/api/v1/webhooks/stripe",
                content=payload,
                headers=sig,
            )
            assert webhook_resp.status_code == 200

            # 4. Verify subscription in DB
            sub = await db.scalar(
                __import__("sqlalchemy").select(UserSubscription).where(
                    UserSubscription.user_id == test_user.id,
                )
            )
            assert sub is not None
            assert sub.status == "active"
            assert sub.tier_id == basic_tier.id

            # 5. Verify PaymentOrder in DB
            order = await db.scalar(
                __import__("sqlalchemy").select(PaymentOrder).where(
                    PaymentOrder.user_id == test_user.id,
                    PaymentOrder.provider_session_id == session_id,
                )
            )
            assert order is not None
            assert order.status == "paid"

            # 6. Simulate invoice.payment_failed
            payload, sig = mock_payment_provider.make_webhook_event(
                "invoice.payment_failed",
                {
                    "id": "in_test_001",
                    "subscription": f"sub_{session_id}",
                    "attempt_count": 1,
                },
            )
            webhook_resp = await client.post(
                "/api/v1/webhooks/stripe",
                content=payload,
                headers=sig,
            )
            assert webhook_resp.status_code == 200

            # Refresh and verify past_due
            await db.refresh(sub)
            assert sub.status == "past_due"

            # 7. Simulate subscription.deleted (all retries exhausted)
            payload, sig = mock_payment_provider.make_webhook_event(
                "customer.subscription.deleted",
                {
                    "id": f"sub_{session_id}",
                    "status": "canceled",
                },
            )
            webhook_resp = await client.post(
                "/api/v1/webhooks/stripe",
                content=payload,
                headers=sig,
            )
            assert webhook_resp.status_code == 200

            # Refresh and verify canceled + grace
            await db.refresh(sub)
            assert sub.status == "canceled"
            assert sub.grace_until is not None
```
