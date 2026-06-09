# 008 - Membership/Subscription Payment Integration Research

> **Status**: Draft v1  
> **Date**: 2026-06-09  
> **Purpose**: Comprehensive research on global subscription payment integration for Trend-Scope, covering Stripe, Alipay, WeChat Pay, App Store IAP, architecture patterns, pricing page best practices, and revenue analytics.

---

## Table of Contents

1. [Stripe Integration (Primary)](#1-stripe-integration-primary-for-international-customers)
2. [Alipay Integration (Chinese Users)](#2-alipay-integration-chinese-users)
3. [WeChat Pay Integration (Chinese Users)](#3-wechat-pay-integration-chinese-users)
4. [App Store / Google Play IAP (Future Mobile)](#4-app-store--google-play-in-app-purchases)
5. [Recommended Architecture](#5-recommended-architecture)
6. [Pricing Page Best Practices](#6-pricing-page-best-practices)
7. [Revenue Analytics](#7-revenue-analytics)

---

## 1. Stripe Integration (Primary for International Customers)

### 1.1 Decision Matrix: Checkout vs Elements vs Payment Links

| Criteria | **Stripe Checkout** (Hosted) | **Stripe Elements** (Embedded) | **Payment Links** |
|---|---|---|---|
| **Setup complexity** | Low — minimal frontend code | Medium — custom UI build | Lowest — no code |
| **Customization** | Limited (branding options: logo, color, font) | Full control over UX | None |
| **Payment method coverage** | 100+ methods auto-displayed | Cards + manual method config | Same as Checkout |
| **Subscription management** | Built-in (Customer Portal) | Must build own subscription UI | No management UI |
| **PCI compliance burden** | SAQ-A (minimal) | SAQ-A (Stripe.js handles card data) | SAQ-A |
| **Client-side deps** | Redirect to stripe.com | stripe.js on your domain | Share link via email / QR |
| **Localization** | Auto (40+ languages) | Manual i18n required | Auto |
| **Tax handling** | Stripe Tax auto-calc | Stripe Tax auto-calc | Stripe Tax auto-calc |
| **Best for** | **Most SaaS startups** | High-control UX, marketplaces | One-off sales, invoices |

**Recommendation for Trend-Scope**: **Stripe Checkout (Hosted) + Customer Portal**. Fastest path to production, handles localization and payment methods automatically, and defers subscription UI to Stripe. Phase 2 could migrate to Stripe Elements if full-branded UX becomes critical.

### 1.2 Stripe Product & Price Model for Trend-Scope

In Stripe, you define **Products** (what you sell) and **Prices** (how much, in what currency, on what interval).

```
Product: "Trend-Scope Pro"
├── Price: pro-monthly-usd ($29.99/month, USD)
├── Price: pro-yearly-usd  ($299.00/year, USD)
├── Price: pro-monthly-cny (¥199.00/month, CNY)
└── Price: pro-yearly-cny  (¥1999.00/year, CNY)

Product: "Trend-Scope Basic"
├── Price: basic-monthly-usd ($9.99/month, USD)
├── Price: basic-yearly-usd  ($99.00/year, USD)
├── Price: basic-monthly-cny (¥69.00/month, CNY)
└── Price: basic-yearly-cny  (¥699.00/year, CNY)
```

Use Stripe `lookup_key` for programmatic price retrieval without hardcoding price IDs:

```python
# Retrieve price dynamically by lookup key
price = stripe.Price.retrieve("pro-monthly-usd")  # not a real ID — use list + search
# Better: store price IDs in a config/database, not in code
```

### 1.3 Python SDK Integration: Creating a Checkout Session

```python
# backend/app/services/payment/stripe_provider.py

import stripe
from stripe.error import StripeError
from app.core.config import settings

stripe.api_key = settings.STRIPE_SECRET_KEY

class StripeProvider:
    """Stripe payment provider implementing the PaymentProvider interface."""

    def __init__(self):
        self.webhook_secret = settings.STRIPE_WEBHOOK_SECRET

    async def create_checkout_session(
        self,
        user_id: str,
        customer_email: str,
        price_id: str,
        success_url: str,
        cancel_url: str,
        metadata: dict | None = None,
        allow_promotion_codes: bool = True,
        trial_period_days: int | None = None,
    ) -> dict:
        """
        Create a Stripe Checkout Session for subscription signup.

        Returns dict with `url` (redirect URL) and `session_id`.
        """
        try:
            # Find or create Stripe Customer
            customers = stripe.Customer.list(email=customer_email, limit=1)
            customer = customers.data[0] if customers.data else stripe.Customer.create(
                email=customer_email,
                metadata={"user_id": str(user_id)},
            )

            session_params = {
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
                "metadata": {
                    "user_id": str(user_id),
                    **(metadata or {}),
                },
                # Enable automatic tax if Stripe Tax is activated
                "automatic_tax": {"enabled": True},
                # Collect billing address for tax calculation
                "billing_address_collection": "required",
                # Allow customer to update details during checkout
                "customer_update": {
                    "name": "auto",
                    "address": "auto",
                },
                # Show yearly/monthly subscription display
                "subscription_data": {
                    "metadata": {"user_id": str(user_id)},
                },
            }

            if trial_period_days:
                session_params["subscription_data"]["trial_period_days"] = trial_period_days

            session = stripe.checkout.Session.create(**session_params)

            return {
                "url": session.url,
                "session_id": session.id,
            }

        except StripeError as e:
            # Log the error and re-raise or handle gracefully
            raise PaymentError(f"Stripe session creation failed: {e.user_message}") from e

    async def create_customer_portal_session(
        self,
        customer_id: str,
        return_url: str,
    ) -> dict:
        """Create a Stripe Customer Portal session for subscription management."""
        session = stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=return_url,
        )
        return {"url": session.url}
```

### 1.4 Webhook Handling

Stripe sends events to your webhook endpoint. **Always verify signatures** to confirm events originate from Stripe.

#### 1.4.1 Webhook Endpoint (FastAPI)

```python
# backend/app/api/v1/webhooks.py

import stripe
from fastapi import APIRouter, Request, Response, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.core.deps import get_db
from app.services.payment.payment_service import PaymentService

router = APIRouter(prefix="/webhooks", tags=["webhooks"])

@router.post("/stripe", status_code=200)
async def stripe_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Handle Stripe webhook events.
    
    Stripe sends raw body + Stripe-Signature header.
    We must read the raw body before FastAPI parses it.
    """
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")

    if not sig_header:
        raise HTTPException(status_code=400, detail="Missing stripe-signature header")

    try:
        event = stripe.Webhook.construct_event(
            payload=payload,
            sig_header=sig_header,
            secret=settings.STRIPE_WEBHOOK_SECRET,
        )
    except stripe.error.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid signature")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid payload")

    payment_service = PaymentService(db)

    # Route events to handlers
    event_handlers = {
        "checkout.session.completed": payment_service.handle_checkout_completed,
        "customer.subscription.updated": payment_service.handle_subscription_updated,
        "customer.subscription.deleted": payment_service.handle_subscription_deleted,
        "invoice.payment_succeeded": payment_service.handle_invoice_paid,
        "invoice.payment_failed": payment_service.handle_invoice_failed,
        "customer.subscription.trial_will_end": payment_service.handle_trial_ending,
    }

    handler = event_handlers.get(event["type"])
    if handler:
        await handler(event)

    return Response(status_code=200)
```

#### 1.4.2 Webhook Event Handlers

```python
# backend/app/services/payment/payment_service.py

from datetime import datetime, timedelta, timezone
import stripe
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.subscription import PaymentOrder, UserSubscription, SubscriptionTier

class PaymentService:
    """
    Central payment service. Routes events to appropriate provider
    and manages local subscription state.
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    # ─── Stripe Webhook Handlers ───────────────────────────────────────

    async def handle_checkout_completed(self, event: dict):
        """
        checkout.session.completed
        - Session completed payment → subscription created.
        - Provision access immediately.
        """
        session = event["data"]["object"]
        user_id = int(session["metadata"]["user_id"])
        stripe_customer_id = session["customer"]
        stripe_subscription_id = session["subscription"]

        if not stripe_subscription_id:
            # One-time payment, not subscription — ignore for now
            return

        # Retrieve full subscription from Stripe
        subscription = stripe.Subscription.retrieve(stripe_subscription_id)
        price_id = subscription["items"]["data"][0]["price"]["id"]

        # Find local tier by Stripe price ID
        tier = await self._get_tier_by_stripe_price(price_id)
        if not tier:
            raise ValueError(f"No tier found for Stripe price {price_id}")

        # Calculate subscription period
        current_period_start = datetime.fromtimestamp(
            subscription["current_period_start"], tz=timezone.utc
        )
        current_period_end = datetime.fromtimestamp(
            subscription["current_period_end"], tz=timezone.utc
        )

        # Check for idempotency — has this session already been processed?
        existing = await self.db.execute(
            select(PaymentOrder).where(
                PaymentOrder.provider_order_id == session["id"]
            )
        )
        if existing.scalar_one_or_none():
            return  # Already processed

        # Create payment order record
        payment = PaymentOrder(
            user_id=user_id,
            tier_id=tier.id,
            payment_provider="stripe",
            provider_order_id=session["id"],
            amount=session["amount_total"] / 100,  # Stripe amounts in cents
            currency=session["currency"].upper(),
            period="yearly" if "yearly" in price_id else "monthly",
            status="paid",
            paid_at=datetime.now(timezone.utc),
        )
        self.db.add(payment)

        # Create or update user subscription
        sub = await self._get_or_create_subscription(user_id, tier.id)
        sub.status = "active"
        sub.auto_renew = True
        sub.started_at = sub.started_at or current_period_start
        sub.expired_at = current_period_end
        sub.stripe_subscription_id = stripe_subscription_id
        sub.stripe_customer_id = stripe_customer_id

        await self.db.commit()

    async def handle_subscription_updated(self, event: dict):
        """
        customer.subscription.updated
        - Plan change, renewal, cancellation scheduling, status change.
        """
        subscription = event["data"]["object"]
        stripe_sub_id = subscription["id"]

        user_sub = await self._get_subscription_by_stripe_id(stripe_sub_id)
        if not user_sub:
            return

        new_status = subscription["status"]
        # Map Stripe status to local status
        status_map = {
            "active": "active",
            "past_due": "active",     # Keep active during grace period
            "unpaid": "active",        # Keep active during retries
            "canceled": "cancelled",
            "incomplete_expired": "expired",
            "trialing": "active",
        }
        mapped_status = status_map.get(new_status, user_sub.status)
        user_sub.status = mapped_status

        # Update expiration from Stripe
        user_sub.expired_at = datetime.fromtimestamp(
            subscription["current_period_end"], tz=timezone.utc
        )

        # Check for plan change (upgrade/downgrade)
        new_price_id = subscription["items"]["data"][0]["price"]["id"]
        new_tier = await self._get_tier_by_stripe_price(new_price_id)
        if new_tier and new_tier.id != user_sub.tier_id:
            user_sub.tier_id = new_tier.id

        await self.db.commit()

    async def handle_subscription_deleted(self, event: dict):
        """
        customer.subscription.deleted
        - Final cancellation. Revoke access.
        """
        subscription = event["data"]["object"]
        stripe_sub_id = subscription["id"]

        user_sub = await self._get_subscription_by_stripe_id(stripe_sub_id)
        if user_sub and user_sub.status != "cancelled":
            user_sub.status = "cancelled"
            user_sub.auto_renew = False
            await self.db.commit()

    async def handle_invoice_paid(self, event: dict):
        """
        invoice.payment_succeeded
        - Subscription payment succeeded. Extend expiration.
        - Use for recurring billing reconciliation.
        """
        invoice = event["data"]["object"]
        stripe_sub_id = invoice.get("subscription")
        if not stripe_sub_id:
            return

        user_sub = await self._get_subscription_by_stripe_id(stripe_sub_id)
        if not user_sub:
            return

        # Extend expiration to next billing period
        subscription = stripe.Subscription.retrieve(stripe_sub_id)
        user_sub.expired_at = datetime.fromtimestamp(
            subscription["current_period_end"], tz=timezone.utc
        )
        user_sub.status = "active"
        user_sub.auto_renew = True

        await self.db.commit()

    async def handle_invoice_failed(self, event: dict):
        """
        invoice.payment_failed
        - Payment failed. Subscription moves to past_due.
        - Send email notification to user.
        - Stripe handles retry logic (Smart Retries).
        """
        invoice = event["data"]["object"]
        stripe_sub_id = invoice.get("subscription")
        if not stripe_sub_id:
            return

        user_sub = await self._get_subscription_by_stripe_id(stripe_sub_id)
        if not user_sub:
            return

        # Mark as past_due — system retains access during grace period
        # After all retries exhausted, Stripe sends customer.subscription.updated
        # with status "unpaid" or "canceled"
        # For now, log and notify (notification service call here)

    async def handle_trial_ending(self, event: dict):
        """
        customer.subscription.trial_will_end
        - Sent 3 days before trial ends.
        - Notify user to add payment method.
        """
        subscription = event["data"]["object"]
        stripe_sub_id = subscription["id"]
        trial_end = datetime.fromtimestamp(
            subscription["trial_end"], tz=timezone.utc
        )
        # Send notification to user about trial ending
        # (notification service call here)

    # ─── Helper Methods ───────────────────────────────────────────────

    async def _get_tier_by_stripe_price(self, price_id: str) -> SubscriptionTier | None:
        """Resolve local tier from a Stripe price ID."""
        result = await self.db.execute(
            select(SubscriptionTier).where(
                SubscriptionTier.stripe_price_id == price_id
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

    async def _get_or_create_subscription(
        self, user_id: int, tier_id: int
    ) -> UserSubscription:
        result = await self.db.execute(
            select(UserSubscription).where(
                UserSubscription.user_id == user_id,
                UserSubscription.tier_id == tier_id,
            )
        )
        sub = result.scalar_one_or_none()
        if not sub:
            sub = UserSubscription(user_id=user_id, tier_id=tier_id)
            self.db.add(sub)
        return sub
```

#### 1.4.3 Webhook Security & Idempotency

```python
# Key principles for webhook handling:

# 1. SIGNATURE VERIFICATION (ALWAYS)
#    - Stripe: stripe.Webhook.construct_event(payload, sig_header, secret)
#    - Never process an event without verifying its signature.

# 2. IDEMPOTENCY
#    - Use provider_order_id (Stripe session ID / event ID) as unique key.
#    - Check if already processed before creating DB records.
#    - Database UNIQUE constraint on provider_order_id is a safety net.

# 3. ORDER MATTERS
#    - Stripe may deliver events out of order.
#    - Always retrieve the latest state from Stripe API rather than
#      trusting the event data alone for critical state transitions.

# 4. RETRY HANDLING
#    - Stripe retries webhook delivery with exponential backoff for up to 3 days.
#    - Return 2xx quickly (within 5 seconds) to acknowledge receipt.
#    - Process asynchronously for long-running tasks.

# 5. EVENT ID DEDUPLICATION
#    - Store processed event IDs in a set/database.
#    - Stripe guarantees at-least-once delivery, so handle duplicates gracefully.
```

### 1.5 Customer Portal Setup

Configure the Customer Portal in Stripe Dashboard:

```
Features to enable:
✓ Update payment method
✓ Cancel subscription (with cancellation feedback)
✓ Update billing address
✓ View invoice history
✓ Switch plans (if offering multiple tiers)
```

```python
async def create_portal_session(
    self,
    user_id: int,
    return_url: str,
) -> str:
    """Generate a Customer Portal URL for the user to manage their subscription."""
    user_sub = await self._get_active_subscription(user_id)
    if not user_sub or not user_sub.stripe_customer_id:
        raise ValueError("No active subscription found")

    session = stripe.billing_portal.Session.create(
        customer=user_sub.stripe_customer_id,
        return_url=return_url,
        configuration=settings.STRIPE_PORTAL_CONFIG_ID,  # Optional: custom config
    )
    return session.url
```

### 1.6 Tax Handling (Stripe Tax)

- **Stripe Tax** automatically calculates and collects US sales tax, EU VAT, GST, etc.
- Enable in Dashboard → Settings → Tax
- Set `"automatic_tax": {"enabled": True}` on Checkout Sessions
- Stripe determines tax rates based on customer location (address, IP, card BIN)
- Tax is reported in Stripe Tax reports for filing
- Cost: 0.5% per transaction (or included in Stripe Tax plan)
- For Trend-Scope (digital SaaS product), tax obligations depend on customer location:
  - **EU customers**: VAT at customer's local rate (OSS scheme)
  - **US customers**: Varies by state (economic nexus thresholds)
  - **Non-EU/non-US**: Generally no tax collected (check local laws)

### 1.7 Multi-Currency Support

```python
# Stripe supports 135+ currencies. Set up Prices per currency:

# Approach 1: Multiple Prices per Product
# Create a Price for each currency you want to accept
stripe.Price.create(
    product="prod_xxx",
    currency="cny",
    unit_amount=19900,  # ¥199.00
    recurring={"interval": "month"},
    metadata={"tier": "pro", "period": "monthly"},
)

# Approach 2: Adaptive Pricing (Stripe-managed currency conversion)
# Enable in Dashboard: Settings → Checkout → Adaptive Pricing
# Stripe auto-converts price and shows in customer's local currency

# Approach 3: Presentment currency on Checkout Session
session = stripe.checkout.Session.create(
    # ...
    currency="usd",  # Base currency
    # Enable Adaptive Pricing for price localization
    adaptive_pricing={"enabled": True},
)
```

**Recommendation**: Use Adaptive Pricing for auto-localization. Create manual CNY Prices for accurate Chinese pricing.

### 1.8 Proration

Stripe handles proration automatically when changing subscriptions mid-cycle:

```python
# Proration behavior is controlled via proration_behavior:
# - "create_prorations" (default): Generate prorated invoice items
# - "none": No proration, change takes effect next billing cycle
# - "always_invoice": Generate invoice immediately for prorated difference

subscription = stripe.Subscription.modify(
    subscription_id,
    items=[{
        "id": subscription["items"]["data"][0]["id"],
        "price": new_price_id,
    }],
    proration_behavior="create_prorations",
)
```

For Trend-Scope, use `"create_prorations"` (default) for instant upgrades — users get immediate access and pay the prorated difference. For downgrades, `"none"` lets them keep current tier until period end.

### 1.9 Coupon / Promotion Code System

```python
# Create a coupon in Stripe Dashboard or via API:
stripe.Coupon.create(
    duration="once",         # or "forever" or "repeating"
    percent_off=20,
    max_redemptions=100,
    redeem_by=int(datetime(2026, 12, 31).timestamp()),
    metadata={"campaign": "launch_2026"},
)

# Create a promotion code (user-facing code):
stripe.PromotionCode.create(
    coupon="coupon_id",
    code="LAUNCH20",
    metadata={"campaign": "launch_2026"},
)

# Checkout Session with promotion codes enabled:
# Set allow_promotion_codes=True (as shown in create_checkout_session above)
# User enters code at checkout → Stripe validates and applies discount
```

### 1.10 Test Mode vs Live Mode

```
Development workflow:
1. Create Stripe account → get test keys (sk_test_..., pk_test_...)
2. Use test mode for all development
3. Test card numbers:
   - 4242 4242 4242 4242 (Visa, success)
   - 4000 0000 0000 9995 (Declined)
   - 4000 0025 0000 3155 (Requires 3D Secure)
4. Test webhooks locally:
   $ stripe listen --forward-to localhost:8000/api/v1/webhooks/stripe
5. Before launch:
   - Complete Stripe activation (business details, bank account)
   - Switch to live keys (sk_live_..., pk_live_...)
   - Enable live mode webhooks in Dashboard
```

### 1.11 Pricing

| Transaction Type | Stripe Fee |
|---|---|
| Domestic cards (US) | 2.9% + $0.30 |
| International cards | 3.9% + $0.30 (or 2.9% + $0.30 if using local acquiring) |
| Alipay (via Stripe) | 2.9% + $0.30 |
| WeChat Pay (via Stripe) | 2.9% + $0.30 |
| Currency conversion | +1% |
| Stripe Tax | +0.5% per transaction |
| Stripe Billing (subscription management) | 0.5% on recurring charges |

---

## 2. Alipay Integration (Chinese Users)

### 2.1 Decision Tree

```
Can you use Stripe?
├── YES → Use Stripe's Alipay integration (SIMPLEST)
│   └── Add "alipay" to payment_method_types on Checkout Session
│   └── Stripe handles: UI, currency, settlement, refunds
│   └── No Chinese entity required!
│
└── NO (need direct integration) → Which Alipay product?
    ├── Alipay Global (Cross-border)
    │   ├── Requirements:
    │   │   ├── Business registration in home country
    │   │   ├── Website with business scope
    │   │   ├── Alipay merchant account (apply via global.alipay.com)
    │   │   └── No Chinese business license needed!
    │   ├── Products:
    │   │   ├── Cross-border website payment (电脑网站支付)
    │   │   ├── Cross-border QR code (当面付)
    │   │   └── Cross-border mobile web (手机网站支付)
    │   └── Settlement: USD/EUR/HKD to overseas bank account
    │
    └── Alipay CN (Domestic)
        ├── Requirements:
        │   ├── Chinese business license (营业执照)
        │   ├── ICP filing (ICP备案)
        │   ├── Chinese bank account for settlement
        │   └── Legal representative's Chinese ID
        └── NOT practical for overseas entities
```

### 2.2 Alipay via Stripe (Recommended)

Stripe supports Alipay as a payment method. Simply include `"alipay"` in the `payment_method_types` list on your Checkout Session:

```python
session = stripe.checkout.Session.create(
    mode="subscription",
    payment_method_types=["card", "alipay", "wechat_pay"],
    # ... other params
)
```

- Customers see Alipay as a payment option at Stripe Checkout
- Redirect to Alipay app/web to authorize payment
- Stripe handles settlement in your configured currency
- **No Chinese entity, business license, or ICP filing required**
- Fee: 2.9% + $0.30 per transaction

### 2.3 Standalone Alipay Global Integration (If Stripe Not Used)

#### 2.3.1 Alipay SDK for Python

```bash
pip install alipay-sdk-python    # Official Alipay SDK (aliyun)
# OR community alternative:
pip install python-alipay-sdk     # Community package (simpler API)
```

#### 2.3.2 Computer Website Payment (电脑网站支付)

```python
# backend/app/services/payment/alipay_provider.py

from alipay import AliPay
from app.core.config import settings

class AlipayProvider:
    """Standalone Alipay Global cross-border payment provider."""

    def __init__(self):
        # For Alipay Global (cross-border), use openapi.alipay.com
        # For Alipay CN (domestic), use openapi.alipay.com (same base URL)
        self.alipay = AliPay(
            appid=settings.ALIPAY_APP_ID,
            app_notify_url=settings.ALIPAY_NOTIFY_URL,  # Async webhook
            app_private_key_string=settings.ALIPAY_PRIVATE_KEY,
            alipay_public_key_string=settings.ALIPAY_PUBLIC_KEY,
            sign_type="RSA2",
            debug=settings.ALIPAY_DEBUG,  # True in sandbox
            # Use openapi-global for cross-border merchants
            # Use openapi for China domestic merchants
        )

    async def create_page_pay_order(
        self,
        out_trade_no: str,
        total_amount: float,
        subject: str,
        return_url: str,
    ) -> str:
        """
        Create an Alipay page payment (redirect to Alipay page).
        
        Returns the full payment page URL.
        """
        order_string = self.alipay.api_alipay_trade_page_pay(
            out_trade_no=out_trade_no,
            total_amount=round(total_amount, 2),
            subject=subject,
            return_url=return_url,       # Sync redirect after payment
            notify_url=settings.ALIPAY_NOTIFY_URL,  # Async webhook
            product_code="FAST_INSTANT_TRADE_PAY",  # For PC website pay
            timeout_express="30m",         # Order expiry
        )
        # Alipay returns a query string; construct full URL
        gateway = "https://openapi-global.alipay.com/gateway.do"
        return f"{gateway}?{order_string}"

    def verify_notify(self, data: dict) -> bool:
        """
        Verify async notification (notify_url callback) from Alipay.
        
        Must verify signature to confirm authenticity.
        """
        # Remove 'sign' and 'sign_type' from data before verification
        sign = data.pop("sign", None)
        sign_type = data.pop("sign_type", "RSA2")
        
        return self.alipay.verify(data, sign)

    async def handle_notify(self, data: dict) -> dict:
        """
        Process Alipay async notification.
        
        Returns dict to echo back to Alipay: {"success": True/False}
        """
        if not self.verify_notify(data):
            return {"success": False}

        trade_status = data.get("trade_status")
        out_trade_no = data.get("out_trade_no")
        trade_no = data.get("trade_no")  # Alipay transaction ID

        if trade_status in ("TRADE_SUCCESS", "TRADE_FINISHED"):
            # Update payment order → activate subscription
            await self._update_order(out_trade_no, trade_no, "paid")

        return {"success": True}
```

#### 2.3.3 Alipay Webhook Endpoint

```python
# backend/app/api/v1/webhooks.py (additional endpoint)

@router.post("/alipay", status_code=200)
async def alipay_notify(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Handle Alipay async notify callback.
    
    Alipay sends a POST with form-encoded data.
    Must echo "success" back to Alipay to stop retries.
    """
    form_data = await request.form()
    data = dict(form_data)

    provider = AlipayProvider()
    result = await provider.handle_notify(data)

    if result["success"]:
        return Response(content="success", media_type="text/plain")
    return Response(content="fail", media_type="text/plain")
```

### 2.4 Alipay Integration Summary

| Aspect | Via Stripe | Direct Alipay Global |
|---|---|---|
| Setup complexity | Low (config flag) | High (certificates, SDK) |
| Chinese entity required | No | No (Global), Yes (CN) |
| ICP filing required | No | No (Global), Yes (CN) |
| Settlement currency | Your Stripe currency | USD/EUR/HKD |
| Refund handling | Stripe Dashboard/API | Alipay API |
| Fee | 2.9% + $0.30 | ~0.6-1.5% (varies by volume) |
| Webhook security | Stripe signature | RSA signature verification |

---

## 3. WeChat Pay Integration (Chinese Users)

### 3.1 Decision Tree

```
Can you use Stripe?
├── YES → Use Stripe's WeChat Pay integration
│   └── Add "wechat_pay" to payment_method_types
│   └── LIMITED: Stripe's WeChat Pay only works for non-recurring payments
│   └── NOT recommended for subscription billing through Stripe alone
│
├── Need subscriptions + Chinese market?
│   └── Stripe for recurring billing + WeChat Pay for one-time add-ons
│   └── OR: Use WeChat Pay's subscription capability directly
│
└── Direct WeChat Pay Integration (API V3)
    ├── Requirements:
    │   ├── Chinese business entity (营业执照)
    │   ├── WeChat Official Account or Mini Program
    │   ├── ICP filing (ICP备案)
    │   ├── Chinese bank account for settlement
    │   └── WeChat Pay merchant account
    ├── Products for subscription:
    │   ├── JSAPI Pay (in-WeChat browser H5 payments)
    │   ├── Native Pay (QR code scan to pay)
    │   ├── H5 Pay (external mobile browser)
    │   └── App Pay (native app payments)
    └── NOTE: WeChat Pay does NOT natively support recurring subscriptions
        → Workaround: Use "contract sign" (代扣) or manual renewal reminders
```

### 3.2 WeChat Pay API V3 Architecture

WeChat Pay API V3 uses:
- **RESTful** design (JSON, not XML)
- **SHA256-RSA** signatures (asymmetric keys, not MD5/HMAC)
- **AES-256-GCM** encryption for sensitive fields in callbacks
- No HTTPS client certificate needed (just certificate serial number)

### 3.3 WeChat Pay Python SDK

```bash
# Community Python SDK for WeChat Pay API V3
pip install wechatpayv3
```

```python
# backend/app/services/payment/wechat_provider.py

from wechatpayv3 import WeChatPay, WeChatPayType
from app.core.config import settings

class WechatPayProvider:
    """WeChat Pay API V3 provider."""

    def __init__(self):
        self.client = WeChatPay(
            wechatpay_type=WeChatPayType.NATIVE,  # or JSAPI, H5, APP
            mchid=settings.WECHAT_MCH_ID,
            apiv3_key=settings.WECHAT_API_V3_KEY,
            private_key=settings.WECHAT_PRIVATE_KEY,        # PEM string
            cert_serial_no=settings.WECHAT_CERT_SERIAL_NO,  # Certificate serial
            appid=settings.WECHAT_APP_ID,
            notify_url=settings.WECHAT_NOTIFY_URL,
        )

    async def create_native_order(
        self,
        out_trade_no: str,
        amount: int,  # in cents/fen (分)
        description: str,
    ) -> dict:
        """
        Create Native Pay order → returns code_url for QR code display.
        
        Native Pay: Customer scans QR code with WeChat app.
        """
        response = self.client.pay.native(
            description=description,
            out_trade_no=out_trade_no,
            amount={"total": amount, "currency": "CNY"},
            notify_url=settings.WECHAT_NOTIFY_URL,
        )
        return {
            "code_url": response.get("code_url"),  # URL → generate QR code
            "prepay_id": response.get("prepay_id"),
        }

    async def create_jsapi_order(
        self,
        out_trade_no: str,
        amount: int,
        description: str,
        openid: str,  # User's WeChat OpenID (must be obtained via OAuth)
    ) -> dict:
        """
        Create JSAPI Pay order for in-WeChat browser payments.
        
        Requires WeChat OAuth to obtain user's OpenID.
        """
        response = self.client.pay.jsapi(
            description=description,
            out_trade_no=out_trade_no,
            amount={"total": amount, "currency": "CNY"},
            payer={"openid": openid},
            notify_url=settings.WECHAT_NOTIFY_URL,
        )
        return response

    async def create_h5_order(
        self,
        out_trade_no: str,
        amount: int,
        description: str,
    ) -> dict:
        """
        Create H5 Pay order for mobile browser (non-WeChat) payments.
        """
        response = self.client.pay.h5(
            description=description,
            out_trade_no=out_trade_no,
            amount={"total": amount, "currency": "CNY"},
            notify_url=settings.WECHAT_NOTIFY_URL,
        )
        return {"h5_url": response.get("h5_url")}

    def decrypt_notify(self, headers: dict, body: bytes) -> dict:
        """
        Verify signature and decrypt WeChat Pay callback.
        
        WeChat Pay encrypts notification body with AES-256-GCM.
        """
        # 1. Verify signature from HTTP headers
        #    - Wechatpay-Timestamp
        #    - Wechatpay-Nonce
        #    - Wechatpay-Signature
        #    - Wechatpay-Serial (platform certificate serial)

        # 2. Decrypt the resource
        notification = self.client.callback(
            headers=headers,
            body=body.decode("utf-8"),
        )
        
        # 3. notification contains decrypted order data
        return notification

    async def handle_notify(self, notification: dict) -> dict:
        """Process decrypted WeChat Pay notification."""
        event_type = notification.get("event_type")

        if event_type == "TRANSACTION.SUCCESS":
            resource = notification.get("resource", {})
            out_trade_no = resource.get("out_trade_no")
            transaction_id = resource.get("transaction_id")

            # Update payment order → activate subscription
            await self._update_order(out_trade_no, transaction_id, "paid")

        return {"code": "SUCCESS"}
```

### 3.4 WeChat Pay Webhook Endpoint

```python
# backend/app/api/v1/webhooks.py (additional endpoint)

@router.post("/wechat", status_code=200)
async def wechat_notify(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Handle WeChat Pay callback notification.
    
    Response must return HTTP 200 with JSON {"code": "SUCCESS"}
    within 5 seconds, otherwise WeChat retries.
    """
    headers = {
        "Wechatpay-Timestamp": request.headers.get("wechatpay-timestamp"),
        "Wechatpay-Nonce": request.headers.get("wechatpay-nonce"),
        "Wechatpay-Signature": request.headers.get("wechatpay-signature"),
        "Wechatpay-Serial": request.headers.get("wechatpay-serial"),
    }
    body = await request.body()

    provider = WechatPayProvider()
    notification = provider.decrypt_notify(headers, body)
    result = await provider.handle_notify(notification)

    return JSONResponse(content=result)
```

### 3.5 WeChat Pay Subscription Workaround

WeChat Pay does NOT support native recurring billing for subscription services. Workarounds:

```
Option A: Use Stripe for subscriptions, WeChat Pay for one-time purchases
Option B: WeChat "Contract Sign" (委托代扣) for auto-debit
          - Requires approval from WeChat (limited to certain industries)
          - Not generally available to small SaaS businesses
Option C: Manual renewal model
          - User purchases "credits" or "subscription time" via WeChat Pay
          - System tracks expiration and sends reminders
          - User manually purchases renewal
```

**Recommendation for Trend-Scope**: Use Stripe for all subscription billing (supports Alipay and WeChat Pay as payment methods). For users who only have WeChat Pay, they can pay via the Stripe Checkout page (Stripe handles the WeChat Pay integration behind the scenes). This avoids the need for a Chinese entity.

---

## 4. App Store / Google Play In-App Purchases

> **Note**: Only relevant if Trend-Scope launches a mobile app. The commission structure makes this less attractive for pure SaaS. Consider a companion app that uses existing Stripe subscriptions.

### 4.1 Apple In-App Purchase (StoreKit 2)

- **StoreKit 2**: Modern Swift API for IAP (iOS 15+, macOS 12+)
- **Server-side validation via App Store Server API**: JWT-signed transactions instead of receipt files
- **App Store Server Notifications**: Webhooks for subscription events (V2 available)

#### Server-Side Validation (Python)

```python
# backend/app/services/payment/app_store_provider.py

import jwt
import httpx
from app.core.config import settings

class AppStoreProvider:
    """Apple App Store server-side receipt validation."""

    APPLE_PRODUCTION_URL = "https://api.storekit.itunes.apple.com/inApps/v1"
    APPLE_SANDBOX_URL = "https://api.storekit.itunes.apple.com/inApps/v1/sandbox"

    async def verify_transaction(
        self,
        transaction_id: str,
        is_sandbox: bool = False,
    ) -> dict:
        """
        Verify an App Store transaction using App Store Server API.
        
        StoreKit 2: App sends transaction_id to your server.
        Your server calls Apple to verify and get subscription status.
        """
        base_url = self.APPLE_SANDBOX_URL if is_sandbox else self.APPLE_PRODUCTION_URL

        # Generate JWT for Apple API authentication
        token = self._generate_client_token()

        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{base_url}/transactions/{transaction_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
            response.raise_for_status()
            data = response.json()

            # data contains signed transaction info
            signed_transaction = data.get("signedTransactionInfo")
            if signed_transaction:
                # Decode the JWT payload (no verification needed — Apple signed it)
                transaction = jwt.decode(
                    signed_transaction,
                    options={"verify_signature": False},
                )
                return transaction

            return data

    async def get_subscription_status(
        self,
        original_transaction_id: str,
    ) -> dict:
        """Get the current status of a subscription."""
        base_url = self.APPLE_PRODUCTION_URL
        token = self._generate_client_token()

        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{base_url}/subscriptions/{original_transaction_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
            response.raise_for_status()
            return response.json()

    def _generate_client_token(self) -> str:
        """Generate a JWT for App Store Server API authentication."""
        now = int(time.time())
        payload = {
            "iss": settings.APPLE_ISSUER_ID,
            "iat": now,
            "exp": now + 3600,  # 1 hour
            "aud": "appstoreconnect-v1",
            "bid": settings.APPLE_BUNDLE_ID,
        }
        headers = {
            "alg": "ES256",
            "kid": settings.APPLE_KEY_ID,
            "typ": "JWT",
        }
        return jwt.encode(payload, settings.APPLE_PRIVATE_KEY, algorithm="ES256", headers=headers)

    async def handle_server_notification(self, payload: dict) -> dict:
        """
        Handle App Store Server Notification V2.
        
        Apple sends signed JWT payloads for subscription events:
        - SUBSCRIBED, DID_CHANGE_RENEWAL_STATUS, DID_FAIL_TO_RENEW, etc.
        """
        signed_payload = payload.get("signedPayload")
        if not signed_payload:
            return {"status": "error", "message": "No signed payload"}

        # Decode the JWT
        notification = jwt.decode(signed_payload, options={"verify_signature": False})
        notification_type = notification.get("notificationType")
        subtype = notification.get("subtype")
        data = notification.get("data", {})

        # Map notification types to actions
        handlers = {
            "SUBSCRIBED": self._handle_new_subscription,
            "DID_CHANGE_RENEWAL_STATUS": self._handle_renewal_change,
            "DID_FAIL_TO_RENEW": self._handle_renewal_failure,
            "EXPIRED": self._handle_expiration,
            "REFUND": self._handle_refund,
        }

        handler = handlers.get(notification_type)
        if handler:
            await handler(data, subtype)

        return {"status": "ok"}
```

#### Revenue Share (Apple)

| Annual Revenue | Commission |
|---|---|
| < $1M (Small Business Program) | 15% |
| > $1M | 30% |
| Year 2+ of auto-renewing subscription | 15% |

### 4.2 Google Play Billing

```python
# backend/app/services/payment/google_play_provider.py

import httpx
from google.oauth2 import service_account
from google.auth.transport.requests import Request
from app.core.config import settings

class GooglePlayProvider:
    """Google Play Billing server-side verification."""

    GOOGLE_API_URL = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications"

    async def verify_purchase(
        self,
        product_id: str,
        purchase_token: str,
    ) -> dict:
        """
        Verify a Google Play purchase.
        
        Always verify on server-side — never trust client-side data.
        """
        credentials = service_account.Credentials.from_service_account_info(
            settings.GOOGLE_PLAY_SERVICE_ACCOUNT,
            scopes=["https://www.googleapis.com/auth/androidpublisher"],
        )
        credentials.refresh(Request())
        access_token = credentials.token

        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.GOOGLE_API_URL}/{settings.GOOGLE_PLAY_PACKAGE_NAME}"
                f"/purchases/subscriptions/{product_id}/tokens/{purchase_token}",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            response.raise_for_status()
            purchase = response.json()

            # purchase contains:
            # - purchaseState: 0=purchased, 1=canceled, 2=pending
            # - autoRenewing: boolean
            # - expiryTime: ISO 8601 timestamp
            return purchase

    async def acknowledge_purchase(
        self,
        product_id: str,
        purchase_token: str,
    ) -> None:
        """
        Acknowledge a purchase (required within 3 days for subscriptions).
        
        Failure to acknowledge results in automatic refund.
        """
        credentials = service_account.Credentials.from_service_account_info(
            settings.GOOGLE_PLAY_SERVICE_ACCOUNT,
            scopes=["https://www.googleapis.com/auth/androidpublisher"],
        )
        credentials.refresh(Request())
        access_token = credentials.token

        async with httpx.AsyncClient() as client:
            await client.post(
                f"{self.GOOGLE_API_URL}/{settings.GOOGLE_PLAY_PACKAGE_NAME}"
                f"/purchases/subscriptions/{product_id}/tokens/{purchase_token}:acknowledge",
                headers={"Authorization": f"Bearer {access_token}"},
            )

    async def handle_rtdn_notification(self, notification: dict) -> dict:
        """
        Handle Google Play Real-Time Developer Notifications (RTDN).
        
        Google sends Pub/Sub messages for subscription events:
        - SUBSCRIPTION_PURCHASED, SUBSCRIPTION_RENEWED
        - SUBSCRIPTION_CANCELED, SUBSCRIPTION_EXPIRED, etc.
        """
        # Decode base64-encoded Pub/Sub message
        import base64, json
        message = notification.get("message", {})
        data = base64.b64decode(message.get("data", "")).decode("utf-8")
        subscription_notification = json.loads(data)

        notification_type = subscription_notification.get("notificationType")

        handlers = {
            1: self._handle_recovered,     # SUBSCRIPTION_RECOVERED
            2: self._handle_renewed,        # SUBSCRIPTION_RENEWED
            3: self._handle_canceled,       # SUBSCRIPTION_CANCELED
            4: self._handle_purchased,      # SUBSCRIPTION_PURCHASED
            7: self._handle_paused,         # SUBSCRIPTION_PAUSED
            13: self._handle_expired,       # SUBSCRIPTION_EXPIRED
        }

        handler = handlers.get(notification_type)
        if handler:
            await handler(subscription_notification)

        return {"status": "ok"}
```

#### Revenue Share (Google Play)

| First $1M annual revenue | 15% |
|---|---|
| Above $1M | 30% |
| Subscriptions after 12 months | 15% |

### 4.3 App Store IAP Decision

**Recommendation**: For a SaaS product like Trend-Scope, do NOT use App Store IAP as the primary payment method. The 15-30% commission is a massive revenue hit. Use a web-based Stripe checkout instead. If you must have a mobile app, use "reader" app rules or link to web-based subscription management. Apple's updated guidelines (post-Epic ruling) allow linking to external payment methods for reader apps.

---

## 5. Recommended Architecture

### 5.1 Abstract PaymentProvider Interface

```python
# backend/app/services/payment/base.py

from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum

class PaymentProviderType(Enum):
    STRIPE = "stripe"
    ALIPAY = "alipay"
    WECHAT = "wechat"
    APP_STORE = "apple"
    GOOGLE_PLAY = "google"

class SubscriptionStatus(Enum):
    ACTIVE = "active"
    PAST_DUE = "past_due"
    CANCELED = "canceled"
    EXPIRED = "expired"
    TRIALING = "trialing"
    PAUSED = "paused"

@dataclass
class CheckoutSessionResult:
    url: str | None                     # Redirect URL (Stripe Checkout / Alipay page)
    session_id: str                     # Provider's session ID
    qr_code: str | None = None          # QR code URL (Alipay F2F, WeChat Native)
    provider: PaymentProviderType

@dataclass
class SubscriptionResult:
    subscription_id: str
    status: SubscriptionStatus
    current_period_start: str           # ISO 8601
    current_period_end: str             # ISO 8601
    cancel_at_period_end: bool = False
    plan_id: str | None = None

class PaymentProvider(ABC):
    """Abstract interface for all payment providers."""

    @abstractmethod
    async def create_checkout_session(
        self,
        user_id: str,
        price_id: str,
        success_url: str,
        cancel_url: str,
        metadata: dict | None = None,
    ) -> CheckoutSessionResult:
        """Create a payment/checkout session. Returns URL or QR code."""
        ...

    @abstractmethod
    async def handle_webhook(
        self,
        payload: bytes,
        headers: dict,
    ) -> dict:
        """
        Process incoming webhook.
        
        Returns event data dict for downstream processing.
        Must verify signature before processing.
        """
        ...

    @abstractmethod
    async def get_subscription(
        self,
        subscription_id: str,
    ) -> SubscriptionResult:
        """Retrieve current subscription details."""
        ...

    @abstractmethod
    async def cancel_subscription(
        self,
        subscription_id: str,
        at_period_end: bool = True,
    ) -> SubscriptionResult:
        """Cancel a subscription immediately or at period end."""
        ...

    @abstractmethod
    async def update_subscription(
        self,
        subscription_id: str,
        new_price_id: str,
        prorate: bool = True,
    ) -> SubscriptionResult:
        """Change subscription plan (upgrade/downgrade)."""
        ...

    @abstractmethod
    async def get_portal_url(
        self,
        customer_id: str,
        return_url: str,
    ) -> str:
        """Return URL for customer self-service portal."""
        ...
```

### 5.2 Provider Selection by Region

```python
# backend/app/services/payment/provider_selector.py

from enum import Enum
from app.services.payment.stripe_provider import StripeProvider
from app.services.payment.alipay_provider import AlipayProvider

class Region(Enum):
    GLOBAL = "global"       # Default: Stripe
    CHINA = "china"         # Stripe + Alipay/WeChat options

def get_provider_for_user(
    user_country: str | None,
    user_currency: str | None = None,
) -> PaymentProvider:
    """
    Select appropriate payment provider based on user region.
    
    Strategy:
    - China users: Offer Stripe (with Alipay/WeChat enabled) + standalone Alipay
    - All other users: Stripe with local payment methods
    """
    # All users get Stripe as the primary provider
    # Stripe Checkout auto-displays relevant payment methods by country
    return StripeProvider()

def get_available_payment_methods(user_country: str | None) -> list[str]:
    """
    Return list of available payment method types for the user.
    
    Stripe Checkout auto-handles this, but useful for displaying
    payment method options on the pricing page.
    """
    methods = ["card"]

    if user_country == "CN":
        methods.extend(["alipay", "wechat_pay"])

    # WeChat Pay is also available in these regions via Stripe
    if user_country in ("HK", "SG", "MY", "JP"):
        methods.append("wechat_pay")

    return methods
```

### 5.3 Subscription State Machine

```
                    ┌──────────┐
                    │  NONE    │  User has no subscription
                    └────┬─────┘
                         │ checkout session created
                         ▼
                    ┌──────────┐
          ┌─────────│ TRIALING │  Free trial period
          │         └────┬─────┘
          │              │ trial ends, payment succeeds
          │              ▼
          │         ┌──────────┐
          │   ┌─────│  ACTIVE  │◄──────┐
          │   │     └────┬─────┘       │
          │   │          │ payment     │ payment
          │   │          │ fails       │ succeeds
          │   │          ▼             │
          │   │     ┌──────────┐       │
          │   │     │PAST_DUE  │───────┘  Retries exhausted,
          │   │     └────┬─────┘          no payment method
          │   │          │
          │   │          │ all retries exhausted
          │   │          ▼
          │   │     ┌──────────┐
          │   │     │ CANCELED │  Terminal state (auto-cancel)
          │   │     └──────────┘
          │   │
          │   │     ┌──────────┐
          │   └────►│ PAUSED   │  Trial ended, no payment method
          │         └────┬─────┘
          │              │ resume (add payment method)
          │              ▼
          │         ┌──────────┐
          └─────────│  ACTIVE  │
                    └──────────┘

State transitions:
  NONE → TRIALING         : Checkout session with trial completed
  NONE → ACTIVE           : Checkout session completed (no trial)
  TRIALING → ACTIVE       : Trial ends, first payment succeeds
  TRIALING → PAUSED       : Trial ends, no payment method
  PAUSED → ACTIVE         : User adds payment method
  ACTIVE → PAST_DUE       : Renewal payment fails
  PAST_DUE → ACTIVE       : Payment retry succeeds
  PAST_DUE → CANCELED     : All retries exhausted
  ACTIVE → CANCELED       : User cancels or admin cancels
  CANCELED → (terminal)   : Cannot be reactivated
```

### 5.4 Webhook Security Checklist

```
For each provider:

Stripe:
  ☑ Verify stripe-signature header using webhook secret
  ☑ Use stripe.Webhook.construct_event() — never manual verification
  ☑ Store processed event IDs to prevent replay
  ☑ Return 2xx within 5 seconds

Alipay:
  ☑ Verify RSA signature on notify_url callbacks
  ☑ Verify notify_id with Alipay API (anti-replay)
  ☑ Check trade_status before processing
  ☑ Echo "success" string in response

WeChat Pay:
  ☑ Verify signature from HTTP headers
  ☑ Decrypt AES-256-GCM encrypted notification body
  ☑ Verify platform certificate serial number
  ☑ Return {"code": "SUCCESS"} within 5 seconds

Apple App Store:
  ☑ Verify JWT signature on signedPayload
  ☑ Check notificationType against expected types
  ☑ Verify transaction with App Store Server API (server-to-server)

Google Play:
  ☑ Verify purchaseToken with Google Play Developer API
  ☑ Validate Pub/Sub message from RTDN
  ☑ Acknowledge purchases within 3 days
```

### 5.5 Idempotency Patterns

```python
# backend/app/services/payment/idempotency.py

import hashlib
import redis.asyncio as redis
from app.core.config import settings

class IdempotencyGuard:
    """
    Prevent duplicate processing of payment webhooks.
    
    Uses Redis for distributed idempotency keys with TTL.
    """

    def __init__(self, redis_client: redis.Redis):
        self.redis = redis_client
        self.ttl = 86400 * 7  # 7 days

    async def is_duplicate(self, event_id: str) -> bool:
        """
        Check if an event has already been processed.
        
        Uses Redis SETNX (SET if Not eXists) for atomic check-and-set.
        """
        key = f"webhook:processed:{event_id}"
        # SETNX returns True if key was set (first time), False if exists (duplicate)
        was_set = await self.redis.set(key, "1", nx=True, ex=self.ttl)
        return not was_set

    @staticmethod
    def generate_key(provider: str, event_id: str) -> str:
        """Generate a deterministic idempotency key."""
        raw = f"{provider}:{event_id}"
        return hashlib.sha256(raw.encode()).hexdigest()


# Usage in webhook handler:
idempotency = IdempotencyGuard(redis_client)

async def handle_checkout_completed(self, event: dict):
    event_id = event["id"]  # Stripe event ID: evt_xxx

    if await idempotency.is_duplicate(event_id):
        logger.info(f"Skipping duplicate event: {event_id}")
        return

    # Process the event...
```

### 5.6 Full Payment Flow Sequence

```
User → Frontend → Backend API → Payment Provider → Webhook → Backend → DB

1. LIST TIERS
   GET /api/v1/subscriptions/tiers
   → Returns tier list with prices (from DB, synced with Stripe)

2. CREATE CHECKOUT
   POST /api/v1/payments/create
   Body: { "tier_id": 2, "period": "monthly", "coupon": "LAUNCH20" }
   → Backend creates PaymentOrder (status=pending)
   → Calls StripeProvider.create_checkout_session()
   → Returns { "checkout_url": "https://checkout.stripe.com/..." }

3. REDIRECT TO CHECKOUT
   Frontend redirects to checkout_url
   → User completes payment on Stripe-hosted page
   → Stripe redirects to success_url

4. WEBHOOK
   Stripe → POST /api/v1/webhooks/stripe
   Event: checkout.session.completed
   → Backend verifies signature
   → Checks idempotency (event ID)
   → Updates PaymentOrder (status=paid)
   → Creates/Updates UserSubscription (status=active)
   → Returns 200 OK

5. CONFIRMATION PAGE
   Frontend success page polls:
   GET /api/v1/subscriptions/me
   → Shows active subscription details

6. ONGOING MANAGEMENT
   User clicks "Manage Subscription" → Backend creates Customer Portal session
   → User redirected to Stripe Customer Portal
   → Can update payment method, cancel, switch plans
   → Stripe sends webhooks for all changes
```

---

## 6. Pricing Page Best Practices

### 6.1 Structure

```
┌─────────────────────────────────────────────────────────┐
│  [Logo]              Trend-Scope              [Sign In]  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│     Choose Your Plan                                    │
│     [Monthly ◉] [Yearly ○  Save 17%]                    │
│                                                         │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Free    │  │  Basic       │  │  Pro          ⭐ │  │
│  │          │  │              │  │  [Most Popular]   │  │
│  │  $0/mo   │  │  $9.99/mo    │  │  $29.99/mo       │  │
│  │          │  │  $99/yr      │  │  $299/yr          │  │
│  │ [Start]  │  │  [Subscribe] │  │  [Subscribe]      │  │
│  │          │  │              │  │                   │  │
│  │  ✓ Day K │  │  ✓ Day/Week  │  │  ✓ All periods   │  │
│  │  ✓ 3 mo  │  │  ✓ 2 yr hist │  │  ✓ Full history  │  │
│  │  ✓ 5 wl  │  │  ✓ 30 wl     │  │  ✓ Unlimited wl  │  │
│  │  ✗ Sigs  │  │  ✓ Signals   │  │  ✓ All signals   │  │
│  │  ✗ Rsk   │  │  ✓ Risk lvl  │  │  ✓ Risk + report │  │
│  │  ✗ Alert │  │  ✓ Email     │  │  ✓ All alerts    │  │
│  └──────────┘  └──────────────┘  └──────────────────┘  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Enterprise — Custom pricing, dedicated support   │  │
│  │  [Contact Sales]                                  │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │  FAQ                                             │  │
│  │  Q: Can I cancel anytime?  A: Yes, no lock-in.   │  │
│  │  Q: Do you offer refunds? A: 14-day money back.  │  │
│  │  Q: Can I switch plans?   A: Yes, prorated.      │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Trust Signals                                   │  │
│  │  ★★★★★ "Best investment tool I've used"          │  │
│  │  ✓ 256-bit SSL encryption                        │  │
│  │  ✓ Stripe secure payment                         │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 6.2 Best Practices Checklist

```
Pricing Psychology:
  ☑ Highlight "Most Popular" tier (decoys to anchor value)
  ☑ Yearly discount: 15-20% (2 months free typically)
  ☑ Show monthly price prominently, yearly as "per month" equivalent
  ☑ Avoid "Free Trial" on Free tier (dilutes perceived value)
  ☑ Add "No credit card required" for Free tier

Feature Table:
  ☑ Feature comparison table for detailed comparison
  ☑ Group features: Data, Analysis, Alerts, Support
  ☑ Use ✓/✗ or green check/red cross — NOT empty cells (confusing)
  ☑ Progressive disclosure: show 5-8 key features, expandable full list

CTAs:
  ☑ Primary CTA on recommended tier: contrasting color
  ☑ Secondary CTAs on other tiers: outlined style
  ☑ "Start Free" on free tier, "Subscribe" on paid tiers
  ☑ Enterprise: "Contact Sales" with direct email/calendar link

Social Proof:
  ☑ Testimonials from real users (photos + names + titles)
  ☑ "Used by X,000+ investors" with logo bar
  ☑ Trust badges: SSL, Stripe, privacy policy

FAQ:
  ☑ Address top 5 concerns (cancel, refund, switch, data export, security)
  ☑ Link to full FAQ / knowledge base
  ☑ Include support contact for unaddressed questions
```

---

## 7. Revenue Analytics

### 7.1 Key Metrics

```python
# backend/app/services/analytics/revenue_metrics.py

from datetime import datetime, date, timedelta
from decimal import Decimal
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.subscription import (
    UserSubscription, PaymentOrder, SubscriptionTier
)
from app.models.user import User

class RevenueAnalytics:
    """Calculate SaaS revenue metrics."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def mrr(self) -> Decimal:
        """
        Monthly Recurring Revenue.
        
        Sum of normalized monthly revenue from all active subscriptions.
        """
        now = datetime.utcnow()
        result = await self.db.execute(
            select(func.sum(UserSubscription.tier.has(SubscriptionTier.price_monthly)))
            .where(UserSubscription.status == "active")
        )
        return result.scalar() or Decimal("0.00")

    async def arr(self) -> Decimal:
        """Annual Recurring Revenue = MRR × 12."""
        return await self.mrr() * 12

    async def churn_rate(self, days: int = 30) -> float:
        """
        Churn rate over a period.
        
        Churn = canceled subscriptions / total at start of period.
        """
        period_start = datetime.utcnow() - timedelta(days=days)

        # Total active at period start
        active_start = await self.db.scalar(
            select(func.count(UserSubscription.id))
            .where(
                UserSubscription.status == "active",
                UserSubscription.started_at <= period_start,
            )
        )

        # Canceled during period
        canceled = await self.db.scalar(
            select(func.count(UserSubscription.id))
            .where(
                UserSubscription.status == "cancelled",
                UserSubscription.updated_at >= period_start,
            )
        )

        if active_start == 0:
            return 0.0
        return (canceled / active_start) * 100

    async def ltv(self) -> Decimal:
        """
        Lifetime Value (LTV).
        
        LTV = ARPU / Monthly Churn Rate
        ARPU = MRR / active subscribers
        """
        active_count = await self.db.scalar(
            select(func.count(UserSubscription.id))
            .where(UserSubscription.status == "active")
        )
        if active_count == 0:
            return Decimal("0.00")

        mrr = await self.mrr()
        arpu = mrr / active_count
        churn = await self.churn_rate() / 100

        if churn == 0:
            return Decimal("999999.99")  # Infinite LTV if no churn
        return arpu / Decimal(str(churn))

    async def trial_conversion_rate(self, days: int = 30) -> float:
        """
        Trial conversion rate.
        
        What percentage of trial users convert to paid?
        """
        period_start = datetime.utcnow() - timedelta(days=days)

        # Users who started trials in the period
        total_trials = await self.db.scalar(
            select(func.count(UserSubscription.id))
            .where(
                UserSubscription.status == "trialing",
                UserSubscription.started_at >= period_start,
            )
        )

        # Users who converted from trial to active
        converted = await self.db.scalar(
            select(func.count(UserSubscription.id))
            .where(
                UserSubscription.status == "active",
                UserSubscription.started_at >= period_start,
                UserSubscription.trial_end.isnot(None),
            )
        )

        if total_trials == 0:
            return 0.0
        return (converted / total_trials) * 100

    async def conversion_by_tier(self, days: int = 30) -> list[dict]:
        """Checkout-to-paid conversion rate per tier."""
        period_start = datetime.utcnow() - timedelta(days=days)

        result = await self.db.execute(
            select(
                SubscriptionTier.name,
                func.count(PaymentOrder.id).filter(PaymentOrder.status == "paid").label("paid"),
                func.count(PaymentOrder.id).label("total"),
            )
            .join(PaymentOrder.tier)
            .where(PaymentOrder.created_at >= period_start)
            .group_by(SubscriptionTier.name)
        )
        
        tiers = []
        for row in result:
            paid = row.paid
            total = row.total
            rate = (paid / total * 100) if total > 0 else 0.0
            tiers.append({
                "tier": row.name,
                "paid_orders": paid,
                "total_orders": total,
                "conversion_rate": round(rate, 1),
            })
        return tiers

    async def revenue_dashboard(self) -> dict:
        """Generate a complete revenue dashboard."""
        return {
            "mrr": float(await self.mrr()),
            "arr": float(await self.arr()),
            "churn_rate_30d": round(await self.churn_rate(30), 2),
            "ltv": float(await self.ltv()),
            "trial_conversion_30d": round(await self.trial_conversion_rate(), 1),
            # Additional metrics...
        }
```

### 7.2 Revenue Analytics Implementation Notes

```
Data Sources:
  - PaymentOrder table: All payment transactions
  - UserSubscription table: Current subscription state
  - Stripe Dashboard / API: Official Stripe analytics + Sigma

Additional Metrics to Track:
  ☑ MRR growth rate (MoM)
  ☑ Net Revenue Retention (NRR) — expansion revenue from upgrades
  ☑ Customer Acquisition Cost (CAC) — marketing spend / new customers
  ☑ CAC:LTV ratio — target > 3:1
  ☑ Revenue by geography
  ☑ Revenue by payment method
  ☑ Average subscription duration

Recommended Tools:
  - Stripe Sigma: Built-in SQL analytics (included with Stripe)
  - ProfitWell / ChartMogul: SaaS analytics platforms
  - Metabase / Grafana: Self-hosted analytics dashboards
  - Export to data warehouse for custom analysis (BigQuery, Redshift)
```

---

## Decision Summary for Trend-Scope

| Decision | Recommendation | Rationale |
|---|---|---|
| **Primary payment provider** | Stripe | Global coverage, Alipay/WeChat via Stripe, lowest overhead |
| **Checkout UX** | Stripe Checkout (Hosted) | Fastest time-to-market, PCI simplicity, built-in localization |
| **Subscription UI** | Stripe Customer Portal | Zero custom UI for cancel/upgrade/payment method management |
| **Alipay standalone** | Not needed (Phase 7) | Stripe handles Alipay; direct integration only if Stripe restricted |
| **WeChat Pay standalone** | Not needed | WeChat Pay doesn't natively support subscriptions; Stripe bridge is adequate |
| **App Store IAP** | Defer to Phase 9+ | 15-30% commission; web-based payments preferred for SaaS |
| **Tax handling** | Stripe Tax | Auto-collects US sales tax, EU VAT; 0.5% per transaction |
| **Multi-currency** | Stripe Adaptive Pricing + manual CNY Prices | Auto-localize for 135+ currencies |
| **Revenue analytics** | Stripe Sigma + custom dashboard | Built-in for Stripe data; custom for business-specific metrics |
| **Pricing model** | Monthly + Yearly (17% discount) | Industry standard; yearly improves cash flow |

---

## References

- [Stripe Billing Documentation](https://docs.stripe.com/billing)
- [Stripe Checkout Sessions API](https://docs.stripe.com/api/checkout/sessions)
- [Stripe Webhooks Guide](https://docs.stripe.com/webhooks)
- [Stripe Python SDK](https://github.com/stripe/stripe-python)
- [Stripe Alipay Guide](https://stripe.com/payment-method/alipay)
- [Alipay Global Open Platform](https://global.alipay.com)
- [Alipay SDK for Python (Official)](https://github.com/alipay/alipay-sdk-python-all)
- [python-alipay-sdk (Community)](https://pypi.org/project/python-alipay-sdk/)
- [WeChat Pay API V3](https://pay.weixin.qq.com/doc/global/v3/en/4012357105)
- [wechatpayv3 (Python Community SDK)](https://pypi.org/project/wechatpayv3/)
- [Apple App Store Server API](https://developer.apple.com/documentation/storekit/in-app_purchase)
- [Google Play Developer API](https://developers.google.com/android-publisher)
