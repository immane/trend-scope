# Task 15 — Phase 2 Payment & Membership System

> **Status**: Planning  
> **Estimated Time**: 5–6 days  
> **Depends On**: Task 12 (CI/CD for production deployment)  
> **Required By**: Task 16 (Notification Enhancement), Task 17 (User-facing Features)  
> **参考设计文档**:
> - [phase-2.md](../design/phase-2.md) — P2-1 支付与会员
> - [005-payment-subscription.md](../design/005-payment-subscription.md) — 支付订阅设计
> - [008-subscription.md](../research/008-subscription.md) — 订阅支付研究
> - [001-business-model.md](../research/001-business-model.md) — 商业模式

---

## 1. 目标

实现 Stripe 订阅支付集成，支持三级会员制 (Free/Basic/Pro)，并在管理端提供 MRR/Churn 分析。

---

## 2. 子任务

### 2.1 Stripe Checkout 集成

**安装**: `pip install stripe`

**新增模型**:
```python
class PaymentOrder(Base, TimestampMixin):
    __tablename__ = "payment_orders"
    id: int (PK)
    user_id: int (FK users)
    stripe_session_id: str (unique)
    stripe_subscription_id: str | None
    amount: Decimal(10,2)
    currency: str = "usd"
    status: Enum["pending","paid","failed","refunded"]
    tier: str  # "basic" / "pro"
```

**API**:
- `POST /payments/checkout`: 创建 Stripe Checkout Session → 返回 redirect URL
- `POST /payments/webhook`: Stripe webhook 接收端 → 更新 PaymentOrder + UserSubscription

**Webhook 事件处理**:
- `checkout.session.completed` → 激活订阅
- `invoice.paid` → 续费
- `invoice.payment_failed` → 进入宽限期
- `customer.subscription.deleted` → 降级为 Free

### 2.2 会员等级管理

**新增模型**:
```python
class SubscriptionTier(Base):
    __tablename__ = "subscription_tiers"
    id: int (PK)
    name: str  # "free" / "basic" / "pro"
    price_monthly: Decimal
    price_yearly: Decimal
    stripe_price_id_monthly: str
    stripe_price_id_yearly: str
    max_api_calls_per_day: int
    max_ai_analyses_per_day: int
    max_kline_periods: str  # "1y,2y,5y"
    max_backtests_per_day: int
    is_active: bool
```

```python
class UserSubscription(Base):
    __tablename__ = "user_subscriptions"
    id: int (PK)
    user_id: int (FK users, unique)
    tier_id: int (FK subscription_tiers)
    stripe_customer_id: str
    stripe_subscription_id: str
    status: Enum["active","past_due","canceled","expired"]
    current_period_start: datetime
    current_period_end: datetime
    grace_period_ends: datetime | None
```

### 2.3 会员权益限流

**中间件** (`backend/app/middleware/tier_limit.py`):
- 读取 `UserSubscription` 获取当前等级
- 按 API 端点检查 limit
- 超限返回 `429 Too Many Requests` + `X-RateLimit-*` headers

**Admin 配置**:
- `GET/PATCH /admin/subscription-tiers`: 管理订阅等级
- `GET /admin/revenue`: MRR/ARR/Churn/LTV 仪表板

### 2.4 宽限期与自动降级

**APScheduler Job**:
- 每天检查 `current_period_end < now()`
- 3 天宽限后自动降级为 Free
- 降级时记录 `audit_log`

### 2.5 Admin Revenue Dashboard

**前端页面**: `/revenue`

**数据**:
- MRR (Monthly Recurring Revenue)
- ARR (Annual Run Rate)
- Churn Rate
- LTV
- Active subscriptions by tier

**实现**: 直接从 `payment_orders` 和 `user_subscriptions` 聚合

---

## 3. 数据库表

| 表 | 用途 |
|---|---|
| `subscription_tiers` | 会员等级定义 |
| `user_subscriptions` | 用户订阅状态 |
| `payment_orders` | 支付订单记录 |

---

## 4. API 端点

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/payments/checkout` | 创建 Stripe Checkout |
| POST | `/payments/webhook` | Stripe webhook |
| GET | `/payments/subscription` | 用户当前订阅状态 |
| GET | `/admin/subscription-tiers` | 管理订阅等级 |
| PATCH | `/admin/subscription-tiers/{id}` | 修改订阅等级 |
| GET | `/admin/revenue` | 营收仪表板数据 |

---

## 5. 前端页面

| Route | 功能 |
|---|---|
| `/revenue` | 营收仪表板 (MRR/ARR/Churn/LTV) |
| `/settings/subscription` | 用户自助订阅管理 |

---

## 6. 测试

- [ ] Stripe Checkout webhook 完整流程通过
- [ ] 会员限流 middleware 对不同 tier 生效
- [ ] 宽限期过后自动降级
- [ ] Revenue 统计数字正确

---

## 7. 验收标准

1. 用户可通过 Stripe Checkout 完成支付并自动激活订阅
2. Free/Basic/Pro 三级 API 限流生效
3. 订阅过期 3 天后自动降级为 Free
4. Admin 营收仪表板展示 MRR/ARR/Churn
