# 003 — API Specification

> **Status**: Draft v1
> **Date**: 2026-06-09
> **Base URL**: `https://api.trend-scope.com/api/v1`
> **Protocol**: HTTPS only (TLS 1.3)
> **Content-Type**: `application/json; charset=utf-8`

---

## 1. General Conventions

### 1.1 Authentication

All authenticated endpoints require the `Authorization` header:

```
Authorization: Bearer <access_token>
```

| Token | Lifetime | Purpose |
|---|---|---|
| Access Token | 30 minutes | API request authentication |
| Refresh Token | 30 days (renewable) | Obtain new access tokens; stored server-side in `user_sessions` |

Refresh flow: `POST /auth/refresh` with the refresh token in the request body returns a new access token.

### 1.2 Pagination

```
GET /resource?page=1&size=20&sort_by=created_at&order=desc
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `page` | integer | `1` | 1-indexed page number |
| `size` | integer | `20` | Items per page (max 100) |
| `sort_by` | string | varies | Field name to sort by |
| `order` | string | `desc` | `asc` or `desc` |

Response wrapper for paginated endpoints:

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "size": 20,
  "pages": 0
}
```

### 1.3 Error Format

All errors follow a consistent structure:

```json
{
  "detail": "Human-readable error message in the request locale",
  "code": "ERROR_CODE",
  "errors": [
    {
      "field": "email",
      "message": "Invalid email format"
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `detail` | string | Human-readable error message |
| `code` | string | Machine-readable error code (snake_case, UPPER) |
| `errors` | array \| null | Per-field validation errors (422 only) |

### 1.4 HTTP Status Codes

| Code | Meaning | When |
|---|---|---|
| `200` | OK | Successful GET, PATCH, PUT |
| `201` | Created | Successful POST creating a resource |
| `204` | No Content | Successful DELETE |
| `302` | Found | Redirect to external URL (Stripe Checkout) |
| `400` | Bad Request | Malformed input, invalid parameters |
| `401` | Unauthorized | Missing or invalid access token |
| `403` | Forbidden | Insufficient role or tier, or expired subscription |
| `404` | Not Found | Resource does not exist |
| `409` | Conflict | Duplicate resource, state conflict |
| `422` | Unprocessable Entity | Validation error (Pydantic) |
| `429` | Too Many Requests | Rate limit exceeded |
| `500` | Internal Server Error | Unexpected server error |
| `503` | Service Unavailable | Upstream data source unavailable |

### 1.5 Date & DateTime Format

- **Date**: `YYYY-MM-DD` (ISO 8601 date), timezone UTC
- **DateTime**: `YYYY-MM-DDTHH:mm:ssZ` (ISO 8601), timezone UTC
- **Decimal**: String in JSON Schema, runtime `Decimal` — always rounded to 4 decimal places for prices, 6 for costs

### 1.6 Rate Limit Headers

Every response includes:

| Header | Description |
|---|---|
| `X-RateLimit-Limit` | Max requests per window |
| `X-RateLimit-Remaining` | Remaining in current window |
| `X-RateLimit-Reset` | Unix timestamp when the window resets |
| `X-RateLimit-Tier` | Tier slug used for the limit (`free`, `basic`, `pro`) |

Limits by tier:

| Tier | Requests/min | Requests/day |
|---|---|---|
| Free | 10 | 100 |
| Basic | 60 | 1,000 |
| Pro | 300 | 10,000 |

### 1.7 Language / Locale

User locale is determined from the `Accept-Language` header, falling back to the user's stored `locale` preference (`en` or `zh`). Error messages and AI analysis output respect this setting.

---

## 2. Authentication APIs

### 2.1 POST /auth/register

**Description**: Register a new user account.
**(Zh)**: 注册新用户账号。

- **Auth**: None
- **Tier**: All

**Request Body**:

```json
{
  "email": "user@example.com",
  "password": "SecureP@ss123!",
  "nickname": "TraderJoe",
  "locale": "en"
}
```

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `email` | string | Yes | Valid email, max 255 chars, unique | User email address, used for login and notifications |
| `password` | string | Yes | 8-128 chars, 1 uppercase, 1 lowercase, 1 digit | Account password (hashed server-side with bcrypt) |
| `nickname` | string | No | 1-100 chars | Display name |
| `locale` | string | No | `"en"` or `"zh"`, default `"zh"` | Language preference for UI and notifications |

**Response `201`**:

```json
{
  "id": 1,
  "email": "user@example.com",
  "nickname": "TraderJoe",
  "locale": "en",
  "role": "user",
  "status": "active",
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "dGhpcyBpcyBhIHJlZnJl...",
  "token_type": "bearer",
  "expires_in": 1800,
  "created_at": "2026-06-09T12:00:00Z"
}
```

| Field | Type | Description |
|---|---|---|
| `id` | integer | User ID |
| `email` | string | Registered email |
| `nickname` | string \| null | Display name |
| `locale` | string | Language preference |
| `role` | string | Always `"user"` on registration |
| `status` | string | Always `"active"` |
| `access_token` | string | JWT access token (30 min expiry) |
| `refresh_token` | string | Opaque refresh token (30 day expiry, stored in `user_sessions`) |
| `token_type` | string | Always `"bearer"` |
| `expires_in` | integer | Access token lifetime in seconds (1800) |
| `created_at` | datetime | Account creation timestamp |

**Error Responses**:

| Code | Detail |
|---|---|
| `422` | `{ "code": "VALIDATION_ERROR", "detail": "...", "errors": [...] }` |
| `409` | `{ "code": "EMAIL_ALREADY_EXISTS", "detail": "A user with this email already exists" }` |

**Rate Limit**: 5 requests/minute per IP.

---

### 2.2 POST /auth/login

**Description**: Authenticate and receive tokens.
**(Zh)**: 用户登录，获取访问令牌。

- **Auth**: None
- **Tier**: All

**Request Body**:

```json
{
  "email": "user@example.com",
  "password": "SecureP@ss123!",
  "device_info": "Chrome 125 / macOS 14.5"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `email` | string | Yes | Registered email |
| `password` | string | Yes | Account password |
| `device_info` | string | No | Optional device/browser fingerprint for session tracking |

**Response `200`**:

```json
{
  "id": 1,
  "email": "user@example.com",
  "nickname": "TraderJoe",
  "locale": "en",
  "role": "user",
  "status": "active",
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "dGhpcyBpcyBhIHJlZnJl...",
  "token_type": "bearer",
  "expires_in": 1800,
  "last_login_at": "2026-06-09T14:30:00Z"
}
```

| Field | Type | Description |
|---|---|---|
| `id` | integer | User ID |
| `email` | string | User email |
| `nickname` | string \| null | Display name |
| `locale` | string | Language preference |
| `role` | string | `"user"` or `"admin"` |
| `status` | string | Account status: `"active"`, `"disabled"`, `"banned"` |
| `access_token` | string | JWT access token |
| `refresh_token` | string | Opaque refresh token |
| `token_type` | string | `"bearer"` |
| `expires_in` | integer | 1800 seconds |
| `last_login_at` | datetime | Previous login timestamp |

**Error Responses**:

| Code | Detail |
|---|---|
| `401` | `{ "code": "INVALID_CREDENTIALS", "detail": "Invalid email or password" }` |
| `403` | `{ "code": "ACCOUNT_DISABLED", "detail": "Account is disabled. Contact support." }` |
| `403` | `{ "code": "ACCOUNT_BANNED", "detail": "Account has been banned." }` |

**Rate Limit**: 10 requests/minute per IP.

---

### 2.3 POST /auth/refresh

**Description**: Exchange a refresh token for a new access token. The old refresh token is rotated (consumed and replaced).
**(Zh)**: 使用刷新令牌获取新的访问令牌。

- **Auth**: None (refresh token in body)
- **Tier**: All

**Request Body**:

```json
{
  "refresh_token": "dGhpcyBpcyBhIHJlZnJl..."
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `refresh_token` | string | Yes | Opaque refresh token from login or previous refresh |

**Response `200`**:

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "bmV3IHJlZnJlc2ggdG9rZW4...",
  "token_type": "bearer",
  "expires_in": 1800
}
```

| Field | Type | Description |
|---|---|---|
| `access_token` | string | New JWT access token |
| `refresh_token` | string | New refresh token (old one invalidated) |
| `token_type` | string | `"bearer"` |
| `expires_in` | integer | 1800 seconds |

**Error Responses**:

| Code | Detail |
|---|---|
| `401` | `{ "code": "INVALID_REFRESH_TOKEN", "detail": "Refresh token is invalid or expired" }` |
| `401` | `{ "code": "REFRESH_TOKEN_REVOKED", "detail": "Refresh token has been revoked (possible token theft)" }` |

**Rate Limit**: 20 requests/minute per IP.

---

### 2.4 POST /auth/logout

**Description**: Revoke the current refresh token (server-side invalidation).
**(Zh)**: 登出，作废当前刷新令牌。

- **Auth**: Bearer (access token)
- **Tier**: All

**Request Body**:

```json
{
  "refresh_token": "dGhpcyBpcyBhIHJlZnJl..."
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `refresh_token` | string | Yes | The refresh token to revoke |

**Response `200`**:

```json
{
  "detail": "Successfully logged out"
}
```

**Error Responses**:

| Code | Detail |
|---|---|
| `401` | `{ "code": "UNAUTHORIZED", "detail": "..." }` |

---

## 3. User APIs

### 3.1 GET /users/me

**Description**: Get the authenticated user's profile and subscription summary.
**(Zh)**: 获取当前用户的个人信息和订阅概览。

- **Auth**: Bearer
- **Tier**: All (including Free)

**Response `200`**:

```json
{
  "id": 1,
  "email": "user@example.com",
  "nickname": "TraderJoe",
  "avatar_url": "https://cdn.trend-scope.com/avatars/1.png",
  "locale": "en",
  "role": "user",
  "status": "active",
  "subscription": {
    "tier": {
      "id": 2,
      "name": "Basic",
      "slug": "basic"
    },
    "status": "active",
    "started_at": "2026-05-01T00:00:00Z",
    "expired_at": "2026-07-01T00:00:00Z",
    "auto_renew": true,
    "grace_until": null
  },
  "quota": {
    "daily_api_remaining": 950,
    "daily_api_limit": 1000,
    "watchlist_used": 3,
    "watchlist_limit": 30,
    "alert_used": 2,
    "alert_limit": 10,
    "ai_analysis_remaining": 8,
    "ai_analysis_limit": 10
  },
  "last_login_at": "2026-06-09T14:30:00Z",
  "created_at": "2026-04-15T08:00:00Z",
  "updated_at": "2026-06-09T14:30:00Z"
}
```

| Field | Type | Description |
|---|---|---|
| `id` | integer | User ID |
| `email` | string | Email address |
| `nickname` | string \| null | Display name |
| `avatar_url` | string \| null | Avatar image URL |
| `locale` | string | `"en"` or `"zh"` |
| `role` | string | `"user"` or `"admin"` |
| `status` | string | `"active"`, `"disabled"`, `"banned"` |
| `subscription` | object \| null | Current subscription info; `null` for pure free-tier users |
| `subscription.tier` | object | Tier summary |
| `subscription.status` | string | `"active"`, `"past_due"`, `"cancelled"`, `"expired"` |
| `subscription.started_at` | datetime | Subscription start |
| `subscription.expired_at` | datetime | Current period end |
| `subscription.auto_renew` | boolean | Auto-renewal status |
| `subscription.grace_until` | datetime \| null | Grace period deadline (3 days after expiry) |
| `quota` | object | Real-time usage counters |
| `quota.daily_api_remaining` | integer | Remaining API calls today |
| `quota.daily_api_limit` | integer | Daily API call limit |
| `quota.watchlist_used` | integer | Current watchlist items count |
| `quota.watchlist_limit` | integer | Max watchlist items allowed |
| `quota.alert_used` | integer | Active alerts count |
| `quota.alert_limit` | integer | Max active alerts |
| `quota.ai_analysis_remaining` | integer | Remaining AI analyses today |
| `quota.ai_analysis_limit` | integer | Daily AI analysis limit |
| `last_login_at` | datetime \| null | Last login time |
| `created_at` | datetime | Account creation |
| `updated_at` | datetime | Last profile update |

---

### 3.2 PATCH /users/me

**Description**: Update the authenticated user's profile.
**(Zh)**: 更新当前用户的个人信息。

- **Auth**: Bearer
- **Tier**: All

**Request Body** (all fields optional):

```json
{
  "nickname": "NewTraderName",
  "locale": "zh",
  "avatar_url": "https://cdn.trend-scope.com/avatars/1.png"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `nickname` | string | No | 1-100 chars |
| `locale` | string | No | `"en"` or `"zh"` |
| `avatar_url` | string | No | Valid URL, max 500 chars |

**Response `200`**:

```json
{
  "id": 1,
  "email": "user@example.com",
  "nickname": "NewTraderName",
  "avatar_url": "https://cdn.trend-scope.com/avatars/1.png",
  "locale": "zh",
  "role": "user",
  "status": "active",
  "updated_at": "2026-06-09T15:00:00Z"
}
```

---

## 4. Stock APIs

### 4.1 GET /stocks

**Description**: Search and list available stocks/ETFs.
**(Zh)**: 搜索和列出可用的股票/ETF标的。

- **Auth**: Bearer
- **Tier**: All (Free: limited fields)

**Query Parameters**:

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `q` | string | No | — | Search by symbol or name (LIKE match) |
| `type` | string | No | — | Filter by type: `"ETF"`, `"Stock"`, `"Index"` |
| `market` | string | No | `"US"` | Market filter |
| `is_active` | boolean | No | `true` | Show only active stocks |
| `page` | integer | No | `1` | Page number |
| `size` | integer | No | `20` | Items per page (max 50) |

**Response `200`**:

```json
{
  "items": [
    {
      "id": 1,
      "symbol": "SPY",
      "name": "SPDR S&P 500 ETF Trust",
      "type": "ETF",
      "subtype": "broad_market",
      "market": "US",
      "sector": "Large Blend",
      "is_active": true,
      "last_price": 527.80,
      "last_price_date": "2026-06-09",
      "change_pct": 1.25
    }
  ],
  "total": 1,
  "page": 1,
  "size": 20,
  "pages": 1
}
```

| Field | Type | Description |
|---|---|---|
| `id` | integer | Stock ID |
| `symbol` | string | Ticker symbol (e.g., `"SPY"`) |
| `name` | string | Full name |
| `type` | string | `"ETF"`, `"Stock"`, `"Index"` |
| `subtype` | string \| null | `"broad_market"`, `"leveraged"`, `"inverse"`, `"sector"`, etc. |
| `market` | string | Market code (currently `"US"`) |
| `sector` | string \| null | Sector classification |
| `is_active` | boolean | Active status |
| `last_price` | number \| null | Most recent close price |
| `last_price_date` | date \| null | Date of last price |
| `change_pct` | number \| null | Percentage change from previous close |

---

### 4.2 GET /stocks/{stock_id}

**Description**: Get detailed info for a single stock.
**(Zh)**: 获取单个标的的详细信息。

- **Auth**: Bearer
- **Tier**: All

**Path Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `stock_id` | integer | Stock ID |

**Response `200`**:

```json
{
  "id": 1,
  "symbol": "SPY",
  "name": "SPDR S&P 500 ETF Trust",
  "type": "ETF",
  "subtype": "broad_market",
  "market": "US",
  "sector": "Large Blend",
  "is_active": true,
  "last_price": 527.80,
  "last_price_date": "2026-06-09",
  "change_pct": 1.25,
  "latest_signal": {
    "id": 42,
    "signal_type": "golden_cross",
    "strength": "strong",
    "triggered_date": "2026-06-09",
    "price": 527.80
  },
  "risk_level": "low",
  "created_at": "2025-01-01T00:00:00Z",
  "updated_at": "2026-06-09T16:30:00Z"
}
```

| Field | Type | Description |
|---|---|---|
| `latest_signal` | object \| null | Most recent active signal (Basic+ tiers only; `null` for Free) |
| `latest_signal.id` | integer | Signal ID |
| `latest_signal.signal_type` | string | Signal type enum |
| `latest_signal.strength` | string | `"weak"`, `"normal"`, `"strong"` |
| `latest_signal.triggered_date` | date | Signal trigger date |
| `latest_signal.price` | number | Price at signal |
| `risk_level` | string \| null | `"low"`, `"moderate"`, `"elevated"`, `"high"` (Basic+ only) |

**Error Responses**:

| Code | Detail |
|---|---|
| `404` | `{ "code": "STOCK_NOT_FOUND", "detail": "Stock with id 999 not found" }` |

---

### 4.3 GET /stocks/{stock_id}/kline

**Description**: Get OHLCV kline/candlestick data with precomputed indicators.
**(Zh)**: 获取K线数据（OHLCV），包含预计算的技术指标。

- **Auth**: Bearer
- **Tier**: All (period and lookback restricted by tier)

**Path Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `stock_id` | integer | Stock ID |

**Query Parameters**:

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `period` | string | No | `"1d"` | Bar interval: `"1d"` (daily), `"1w"` (weekly), `"1M"` (monthly) |
| `from` | date | No | — | Start date (inclusive). If omitted, uses `limit` to count backward |
| `to` | date | No | today | End date (inclusive) |
| `limit` | integer | No | `200` | Max bars to return (capped by tier) |
| `indicators` | string | No | `"ma"` | Comma-separated indicator names to include: `"ma,rsi,macd,bollinger"`. Default `"ma"` for Free, fuller set for higher tiers |

**Tier Restrictions**:

| Tier | Allowed Periods | Max Limit | Max Lookback | Allowed Indicators |
|---|---|---|---|---|
| Free | `1d` (1-day delay) | 60 | 3 months | `ma` (SMA/EMA) only |
| Basic | `1d`, `1w` | 200 | 2 years | `ma`, `rsi`, `macd` |
| Pro | `1d`, `1w`, `1M` | 500 | Unlimited (10+ years) | All (252+) |

**Response `200`**:

```json
{
  "symbol": "SPY",
  "stock_id": 1,
  "period": "1d",
  "from": "2025-11-01",
  "to": "2026-06-09",
  "count": 150,
  "data": [
    {
      "time": "2026-06-09",
      "open": 525.10,
      "high": 528.50,
      "low": 524.20,
      "close": 527.80,
      "volume": 65000000,
      "ma5": 523.40,
      "ma10": 520.10,
      "ma20": 521.45,
      "ma60": 515.30,
      "ma120": 508.75,
      "ema12": 522.80,
      "ema26": 518.60,
      "rsi14": 58.2,
      "macd": {
        "macd_line": 4.20,
        "signal_line": 3.85,
        "histogram": 0.35
      },
      "bollinger": {
        "upper": 535.20,
        "middle": 521.45,
        "lower": 507.70,
        "percent_b": 0.73,
        "bandwidth": 0.053
      },
      "signal": {
        "type": "golden_cross",
        "strength": "strong"
      },
      "volume_ma20": 58000000,
      "volume_ratio": 1.12
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `symbol` | string | Stock symbol |
| `stock_id` | integer | Stock ID |
| `period` | string | Bar interval used |
| `from` | date | Actual start date returned |
| `to` | date | Actual end date returned |
| `count` | integer | Number of bars returned |
| `data` | array | Kline data points (ascending by time) |
| `data[].time` | date | Trading date |
| `data[].open` | number | Open price |
| `data[].high` | number | High price |
| `data[].low` | number | Low price |
| `data[].close` | number | Close price |
| `data[].volume` | integer | Volume |
| `data[].ma5` | number \| null | SMA 5 (if `ma` requested) |
| `data[].ma10` | number \| null | SMA 10 |
| `data[].ma20` | number \| null | SMA 20 |
| `data[].ma60` | number \| null | SMA 60 |
| `data[].ma120` | number \| null | SMA 120 |
| `data[].ema12` | number \| null | EMA 12 |
| `data[].ema26` | number \| null | EMA 26 |
| `data[].rsi14` | number \| null | RSI 14 (0-100) |
| `data[].macd` | object \| null | MACD components (if tier allows) |
| `data[].macd.macd_line` | number | MACD line (EMA12 - EMA26) |
| `data[].macd.signal_line` | number | Signal line (EMA9 of MACD line) |
| `data[].macd.histogram` | number | Histogram (MACD - Signal) |
| `data[].bollinger` | object \| null | Bollinger Bands (20, 2σ) |
| `data[].bollinger.upper` | number | Upper band |
| `data[].bollinger.middle` | number | Middle band (SMA 20) |
| `data[].bollinger.lower` | number | Lower band |
| `data[].bollinger.percent_b` | number | %B (0-1+) |
| `data[].bollinger.bandwidth` | number | Bandwidth ratio |
| `data[].signal` | object \| null | Signal present on this bar (if any) |
| `data[].signal.type` | string | Signal type enum |
| `data[].signal.strength` | string | `"weak"`, `"normal"`, `"strong"` |
| `data[].volume_ma20` | number \| null | 20-day average volume |
| `data[].volume_ratio` | number \| null | Volume / 20-day avg |

**Error Responses**:

| Code | Detail |
|---|---|
| `404` | `{ "code": "STOCK_NOT_FOUND" }` |
| `403` | `{ "code": "PERIOD_NOT_ALLOWED", "detail": "Your tier does not allow period '1M'. Upgrade to Pro." }` |
| `403` | `{ "code": "INDICATOR_NOT_ALLOWED", "detail": "Indicator 'macd' requires Basic tier or higher" }` |

---

## 5. Analysis APIs

### 5.1 GET /analysis/{stock_id}/latest

**Description**: Get the latest active signals for a stock.
**(Zh)**: 获取标的最新活跃信号。

- **Auth**: Bearer
- **Tier**: Basic, Pro

**Path Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `stock_id` | integer | Stock ID |

**Response `200`**:

```json
{
  "stock_id": 1,
  "symbol": "SPY",
  "risk_level": "low",
  "signals": [
    {
      "id": 42,
      "config_id": 5,
      "config_name": "Standard MA Strategy",
      "signal_type": "golden_cross",
      "strength": "strong",
      "confidence": 0.85,
      "price": 527.80,
      "triggered_date": "2026-06-09",
      "signal_details": {
        "ma_short": 20,
        "ma_short_val": 521.45,
        "ma_long": 60,
        "ma_long_val": 515.30,
        "volume_confirm": true,
        "volume_ratio": 1.12,
        "indicators": {
          "rsi14": 58.2,
          "macd_line": 4.20,
          "macd_signal": 3.85,
          "macd_histogram": 0.35
        }
      },
      "is_active": true,
      "created_at": "2026-06-09T16:30:00Z"
    }
  ],
  "generated_at": "2026-06-09T16:30:05Z"
}
```

| Field | Type | Description |
|---|---|---|
| `stock_id` | integer | Stock ID |
| `symbol` | string | Stock symbol |
| `risk_level` | string | `"low"`, `"moderate"`, `"elevated"`, `"high"` |
| `signals` | array | Active signals (most recent first) |
| `signals[].id` | integer | Signal ID |
| `signals[].config_id` | integer | Analysis config ID |
| `signals[].config_name` | string | Config display name |
| `signals[].signal_type` | string | Signal type enum |
| `signals[].strength` | string | `"weak"`, `"normal"`, `"strong"` |
| `signals[].confidence` | number | 0.000-1.000 |
| `signals[].price` | number | Price at signal |
| `signals[].triggered_date` | date | Signal date |
| `signals[].signal_details` | object | Triggering indicator values |
| `signals[].is_active` | boolean | Whether signal is still active |
| `signals[].created_at` | datetime | Record created |
| `generated_at` | datetime | Analysis generation timestamp |

---

### 5.2 GET /analysis/{stock_id}/history

**Description**: Get signal history for a stock (paginated).
**(Zh)**: 获取标的信号历史记录（分页）。

- **Auth**: Bearer
- **Tier**: Basic, Pro

**Path Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `stock_id` | integer | Stock ID |

**Query Parameters**:

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `signal_type` | string | No | — | Filter by signal type |
| `from` | date | No | — | Start date |
| `to` | date | No | — | End date |
| `is_active` | boolean | No | — | Filter active/inactive signals |
| `page` | integer | No | `1` | Page number |
| `size` | integer | No | `20` | Items per page |

**Response `200`**: Same item structure as `GET /analysis/{stock_id}/latest`, wrapped in pagination:

```json
{
  "stock_id": 1,
  "symbol": "SPY",
  "items": [ /* signal objects */ ],
  "total": 42,
  "page": 1,
  "size": 20,
  "pages": 3
}
```

---

### 5.3 GET /analysis/indicators

**Description**: List all available technical indicators with metadata.
**(Zh)**: 列出所有可用的技术指标及其元数据。

- **Auth**: Bearer
- **Tier**: All (filtered by tier)

**Query Parameters**:

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `category` | string | No | — | Filter: `"overlap"`, `"momentum"`, `"trend"`, `"volatility"`, `"volume"`, `"pattern"` |
| `q` | string | No | — | Search by name or display_name |

**Response `200`**:

```json
{
  "indicators": [
    {
      "name": "rsi",
      "display_name": "Relative Strength Index",
      "category": "momentum",
      "description": "Measures the speed and change of price movements on a 0-100 scale.",
      "version": "1.0.0",
      "tags": ["oscillator", "overbought", "oversold"],
      "params": {
        "length": {
          "default": 14,
          "min": 2,
          "max": 200,
          "type": "int",
          "description": "Lookback period"
        },
        "overbought": {
          "default": 70,
          "min": 50,
          "max": 100,
          "type": "int",
          "description": "Overbought threshold"
        },
        "oversold": {
          "default": 30,
          "min": 0,
          "max": 50,
          "type": "int",
          "description": "Oversold threshold"
        }
      },
      "outputs": ["rsi", "rsi_signal"],
      "required_columns": ["close"]
    }
  ]
}
```

---

### 5.4 POST /analysis/{stock_id}/indicators

**Description**: Compute one or more indicators on-the-fly for a stock with custom parameters.
**(Zh)**: 按自定义参数实时计算一个或多个技术指标。

- **Auth**: Bearer
- **Tier**: Pro

**Path Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `stock_id` | integer | Stock ID |

**Request Body**:

```json
{
  "indicators": [
    {
      "name": "rsi",
      "params": {
        "length": 14,
        "overbought": 70,
        "oversold": 30
      }
    },
    {
      "name": "macd",
      "params": {
        "fast": 12,
        "slow": 26,
        "signal": 9
      }
    },
    {
      "name": "bollinger",
      "params": {
        "length": 20,
        "std_dev": 2.0
      }
    }
  ],
  "timeframe": "1d",
  "include_series": false,
  "series_limit": 0
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `indicators` | array | Yes | List of indicator specs (1-10 indicators) |
| `indicators[].name` | string | Yes | Indicator name (must be in registry) |
| `indicators[].params` | object | No | Custom parameters (merged with defaults) |
| `timeframe` | string | No | `"1d"`, `"1w"`, `"1M"` (default `"1d"`) |
| `include_series` | boolean | No | If `true`, returns full time series (default `false`) |
| `series_limit` | integer | No | Max series points to return (0 = all). Ignored if `include_series` is `false`. |

**Response `200`**:

```json
{
  "stock_id": 1,
  "symbol": "SPY",
  "timeframe": "1d",
  "computed_at": "2026-06-09T16:30:05Z",
  "results": {
    "rsi": {
      "params_used": {
        "length": 14,
        "overbought": 70,
        "oversold": 30
      },
      "latest": {
        "date": "2026-06-09",
        "rsi": 58.2,
        "rsi_signal": "neutral"
      },
      "series": [
        { "date": "2026-06-09", "rsi": 58.2, "rsi_signal": "neutral" }
      ]
    },
    "macd": {
      "params_used": {
        "fast": 12,
        "slow": 26,
        "signal": 9
      },
      "latest": {
        "date": "2026-06-09",
        "macd_line": 4.20,
        "signal_line": 3.85,
        "histogram": 0.35
      },
      "series": []
    },
    "bollinger": {
      "params_used": {
        "length": 20,
        "std_dev": 2.0
      },
      "latest": {
        "date": "2026-06-09",
        "upper": 535.20,
        "middle": 521.45,
        "lower": 507.70,
        "percent_b": 0.73,
        "bandwidth": 0.053
      },
      "series": []
    }
  },
  "signals": {
    "rsi_oversold": false,
    "rsi_overbought": false,
    "macd_bullish_cross": true,
    "bollinger_squeeze": false
  }
}
```

| Field | Type | Description |
|---|---|---|
| `stock_id` | integer | Stock ID |
| `symbol` | string | Stock symbol |
| `timeframe` | string | Timeframe used |
| `computed_at` | datetime | Computation timestamp |
| `results` | object | Map of indicator_name → result |
| `results.{name}.params_used` | object | Effective parameters used (after cascade resolution) |
| `results.{name}.latest` | object | Most recent indicator values |
| `results.{name}.series` | array | Full time series (empty if `include_series` was false) |
| `signals` | object | Map of signal_name → boolean indicating if triggered |

**Error Responses**:

| Code | Detail |
|---|---|
| `403` | `{ "code": "TIER_REQUIRED", "detail": "Custom indicator computation requires Pro tier" }` |
| `400` | `{ "code": "UNKNOWN_INDICATOR", "detail": "Indicator 'unknown' not found in registry" }` |
| `400` | `{ "code": "INVALID_PARAMS", "detail": "length=500 exceeds maximum 200" }` |

---

### 5.5 POST /analysis/{stock_id}/optimize

**Description**: Run parameter optimization (grid search / Bayesian) for an indicator on historical data.
**(Zh)**: 对标的技术指标参数进行网格搜索/贝叶斯优化。

- **Auth**: Bearer
- **Tier**: Pro

**Path Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `stock_id` | integer | Stock ID |

**Request Body**:

```json
{
  "indicator_name": "rsi",
  "param_grid": {
    "length": [7, 10, 14, 21, 28],
    "overbought": [65, 70, 75, 80],
    "oversold": [20, 25, 30, 35]
  },
  "objective": "signal_accuracy",
  "lookback_days": 365,
  "validation_days": 90,
  "optimization_method": "grid"
}
```

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `indicator_name` | string | Yes | — | Indicator to optimize |
| `param_grid` | object | Yes | — | Parameter name → array of values to test |
| `objective` | string | No | `"signal_accuracy"` | Optimization objective: `"signal_accuracy"`, `"max_profit"`, `"max_sharpe"`, `"min_drawdown"` |
| `lookback_days` | integer | No | `365` | Days of historical data for training (in-sample) |
| `validation_days` | integer | No | `90` | Days for validation (out-of-sample) |
| `optimization_method` | string | No | `"grid"` | `"grid"` (grid search) or `"bayesian"` (Optuna TPE) |

**Response `200`**:

```json
{
  "indicator_name": "rsi",
  "stock_id": 1,
  "symbol": "SPY",
  "best_params": {
    "length": 14,
    "overbought": 70,
    "oversold": 30
  },
  "objective": "signal_accuracy",
  "objective_value": 0.68,
  "in_sample_metric": 0.72,
  "out_of_sample_metric": 0.64,
  "overfit_warning": false,
  "all_results": [
    {
      "params": { "length": 7, "overbought": 65, "oversold": 20 },
      "is_metric": 0.58,
      "oos_metric": 0.52,
      "num_signals": 34
    }
  ],
  "optimization_time_ms": 2500
}
```

| Field | Type | Description |
|---|---|---|
| `best_params` | object | Best parameter combination found |
| `objective_value` | number | Best objective value (on validation set) |
| `in_sample_metric` | number | Performance on training data |
| `out_of_sample_metric` | number | Performance on validation data |
| `overfit_warning` | boolean | `true` if IS/OOS gap > 30% |
| `all_results` | array | Full grid search / trial results |
| `optimization_time_ms` | integer | Wall-clock time in milliseconds |

---

### 5.6 GET /analysis/{stock_id}/ai

**Description**: Get AI-generated analysis report for the latest signal on a stock. Cached for 24h.
**(Zh)**: 获取标的最新信号的AI分析报告（24小时缓存）。

- **Auth**: Bearer
- **Tier**: Basic (10/day), Pro (50/day)

**Path Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `stock_id` | integer | Stock ID |

**Query Parameters**:

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `signal_id` | integer | No | latest | Specific signal ID to analyze |
| `model` | string | No | tier default | Preferred model: `"deepseek-v4-flash"`, `"claude-haiku-4-5"`, `"gpt-5.4-mini"`, `"deepseek-v4-pro"` |
| `force_refresh` | boolean | No | `false` | Bypass cache and regenerate (counts against quota) |

**Response `200`**:

```json
{
  "id": 7,
  "signal_id": 42,
  "symbol": "SPY",
  "signal_type": "golden_cross",
  "signal_strength": "strong",
  "model_provider": "deepseek",
  "model_name": "deepseek-v4-flash",
  "cached": true,
  "analysis": {
    "summary": "SPY triggered a strong golden cross with MA20 crossing above MA60 at above-average volume. The technical setup suggests bullish momentum in the 2-4 week timeframe.",
    "why_buy": [
      "MA20 ($521.45) crossed above MA60 ($515.30) with 1.12x average volume, indicating institutional participation",
      "RSI at 58.2 is neutral, providing ample room for upside before overbought territory (70+)",
      "Price ($527.80) holding above both moving averages confirms the bullish crossover",
      "VIX at 18.5 indicates moderate market fear — historically a favorable entry environment"
    ],
    "risks": [
      "Immediate resistance at $535 (Bollinger upper band)",
      "If price falls below MA20 ($521.45), the golden cross signal weakens significantly",
      "VIX could spike above 25 if macro data disappoints, triggering broad sell-off"
    ],
    "stop_loss": {
      "price": 505.50,
      "percentage_down": 4.22,
      "reasoning": "Below MA60 ($515.30) and recent swing low ($508 support level)"
    },
    "targets": [
      { "price": 540.00, "percentage_up": 2.31, "type": "resistance" },
      { "price": 555.00, "percentage_up": 5.15, "type": "all_time_high" }
    ],
    "confidence": 0.72,
    "time_horizon": "2-4 weeks"
  },
  "token_usage": {
    "prompt_tokens": 1250,
    "completion_tokens": 680,
    "total_tokens": 1930,
    "cost_usd": 0.00043
  },
  "disclaimer": "⚠️ 本分析由AI自动生成，仅供参考，不构成任何投资建议。过去的表现不代表未来的收益。投资有风险，入市需谨慎。\n⚠️ This analysis is AI-generated for informational purposes only and does not constitute investment advice. Past performance does not guarantee future results.",
  "generated_at": "2026-06-09T16:30:00Z"
}
```

| Field | Type | Description |
|---|---|---|
| `id` | integer | AI analysis result ID |
| `signal_id` | integer | Associated signal ID |
| `symbol` | string | Stock symbol |
| `signal_type` | string | Signal type |
| `signal_strength` | string | Signal strength |
| `model_provider` | string | LLM provider used |
| `model_name` | string | Specific model used |
| `cached` | boolean | Whether this was served from cache |
| `analysis.summary` | string | 1-2 sentence overview |
| `analysis.why_buy` | array | 3-5 reasons supporting the signal (buy signals only) |
| `analysis.risks` | array | 3-5 risk factors |
| `analysis.stop_loss` | object | Recommended stop-loss level |
| `analysis.stop_loss.price` | number | Stop-loss price |
| `analysis.stop_loss.percentage_down` | number | Percentage below current price |
| `analysis.stop_loss.reasoning` | string | Rationale for stop-loss placement |
| `analysis.targets` | array | Price targets |
| `analysis.targets[].price` | number | Target price |
| `analysis.targets[].percentage_up` | number | Percentage above current price |
| `analysis.targets[].type` | string | `"resistance"`, `"all_time_high"`, `"fibonacci"`, `"moving_average"` |
| `analysis.confidence` | number | 0.0-1.0 confidence score |
| `analysis.time_horizon` | string | Expected timeframe (e.g., `"2-4 weeks"`) |
| `token_usage` | object | Token consumption and cost |
| `disclaimer` | string | Bilingual legal disclaimer |
| `generated_at` | datetime | Generation timestamp |

**Error Responses**:

| Code | Detail |
|---|---|
| `403` | `{ "code": "AI_QUOTA_EXCEEDED", "detail": "Daily AI analysis limit (10) reached. Upgrade to Pro for 50/day." }` |
| `404` | `{ "code": "NO_SIGNAL_FOUND", "detail": "No active signal found for AI analysis" }` |
| `503` | `{ "code": "AI_SERVICE_UNAVAILABLE", "detail": "All AI providers are currently unavailable. Please try again later." }` |

---

## 6. Backtest APIs

### 6.1 POST /backtest/submit

**Description**: Submit a backtest job. Runs asynchronously via ARQ task queue.
**(Zh)**: 提交回测任务（异步执行）。

- **Auth**: Bearer
- **Tier**: Pro (10 backtests/day)

**Request Body**:

```json
{
  "stock_id": 1,
  "config_id": 5,
  "name": "SPY Golden Cross Backtest",
  "date_from": "2023-01-01",
  "date_to": "2026-06-01",
  "capital": 100000.00,
  "slippage": 0.001,
  "commission": 0.001,
  "use_walk_forward": false,
  "walk_forward_windows": 0
}
```

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `stock_id` | integer | Yes | — | Stock to backtest |
| `config_id` | integer | Yes | — | Analysis config (strategy) to use |
| `name` | string | No | auto-generated | Backtest run name |
| `date_from` | date | Yes | — | Start date (inclusive) |
| `date_to` | date | Yes | — | End date (inclusive) |
| `capital` | number | No | `100000.00` | Initial capital in USD |
| `slippage` | number | No | `0.001` | Slippage per side (0.1% = 0.001) |
| `commission` | number | No | `0.001` | Commission per trade (0.1% = 0.001) |
| `use_walk_forward` | boolean | No | `false` | Enable walk-forward optimization |
| `walk_forward_windows` | integer | No | `0` | Number of walk-forward windows (0 = single run) |

**Response `201`**:

```json
{
  "job_id": 1,
  "status": "queued",
  "name": "SPY Golden Cross Backtest",
  "stock_id": 1,
  "config_id": 5,
  "date_from": "2023-01-01",
  "date_to": "2026-06-01",
  "capital": 100000.00,
  "created_at": "2026-06-09T16:30:00Z",
  "estimated_duration_seconds": 30
}
```

| Field | Type | Description |
|---|---|---|
| `job_id` | integer | Backtest job ID |
| `status` | string | `"queued"`, `"running"`, `"completed"`, `"failed"` |
| `estimated_duration_seconds` | integer | Estimated wall-clock time |

**Error Responses**:

| Code | Detail |
|---|---|
| `403` | `{ "code": "TIER_REQUIRED", "detail": "Backtesting requires Pro tier" }` |
| `403` | `{ "code": "BACKTEST_QUOTA_EXCEEDED", "detail": "Daily backtest limit (10) reached" }` |
| `404` | `{ "code": "CONFIG_NOT_FOUND", "detail": "Analysis config not found" }` |
| `400` | `{ "code": "INVALID_DATE_RANGE", "detail": "date_to must be after date_from" }` |

---

### 6.2 GET /backtest/{job_id}

**Description**: Query the status and summary of a backtest job.
**(Zh)**: 查询回测任务状态和结果摘要。

- **Auth**: Bearer
- **Tier**: Pro

**Path Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `job_id` | integer | Backtest job ID |

**Response `200`**:

```json
{
  "job_id": 1,
  "status": "completed",
  "progress_pct": 100,
  "name": "SPY Golden Cross Backtest",
  "stock_id": 1,
  "symbol": "SPY",
  "config_id": 5,
  "config_name": "Standard MA Strategy",
  "date_from": "2023-01-01",
  "date_to": "2026-06-01",
  "capital": 100000.00,
  "summary": {
    "total_return": 0.2340,
    "cagr": 0.0698,
    "sharpe_ratio": 1.15,
    "max_drawdown": -0.1850,
    "win_rate": 0.52,
    "num_trades": 87,
    "profit_factor": 1.65,
    "benchmark_return": 0.3100
  },
  "started_at": "2026-06-09T16:30:01Z",
  "completed_at": "2026-06-09T16:30:28Z",
  "created_at": "2026-06-09T16:30:00Z"
}
```

| Field | Type | Description |
|---|---|---|
| `job_id` | integer | Job ID |
| `status` | string | `"queued"`, `"running"`, `"completed"`, `"failed"` |
| `progress_pct` | integer | 0-100 progress percentage |
| `summary` | object \| null | Key metrics (populated when status is `"completed"`) |
| `summary.total_return` | number | Total return as decimal (0.2340 = 23.40%) |
| `summary.cagr` | number | Compound Annual Growth Rate |
| `summary.sharpe_ratio` | number | Sharpe ratio (annualized) |
| `summary.max_drawdown` | number | Maximum drawdown as decimal (-0.1850 = -18.50%) |
| `summary.win_rate` | number | Win rate (0.52 = 52%) |
| `summary.num_trades` | integer | Total number of trades |
| `summary.profit_factor` | number | Gross profit / gross loss |
| `summary.benchmark_return` | number | Buy-and-hold benchmark return over same period |
| `started_at` | datetime \| null | Execution start |
| `completed_at` | datetime \| null | Execution completion |
| `created_at` | datetime | Job creation |

**If status is `"failed"`**:

```json
{
  "job_id": 1,
  "status": "failed",
  "progress_pct": 45,
  "error_message": "Insufficient data: only 15 trading days available, minimum 50 required",
  "created_at": "2026-06-09T16:30:00Z",
  "completed_at": "2026-06-09T16:30:05Z"
}
```

---

### 6.3 GET /backtest/{job_id}/report

**Description**: Get the full backtest report with all metrics, equity curve, drawdown curve, monthly returns, and trade log.
**(Zh)**: 获取完整回测报告，包含所有指标、权益曲线、回撤曲线、月度收益和交易记录。

- **Auth**: Bearer
- **Tier**: Pro

**Path Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `job_id` | integer | Backtest job ID |

**Query Parameters**:

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `format` | string | No | `"json"` | `"json"` or `"html"` (QuantStats full tear sheet) |

**Response `200` (JSON format)**:

```json
{
  "job_id": 1,
  "status": "completed",
  "metrics": {
    "total_return": 0.2340,
    "cagr": 0.0698,
    "annual_volatility": 0.1520,
    "sharpe_ratio": 1.15,
    "sortino_ratio": 1.82,
    "calmar_ratio": 0.38,
    "max_drawdown": -0.1850,
    "max_drawdown_days": 145,
    "win_rate": 0.52,
    "profit_factor": 1.65,
    "avg_win_pct": 0.032,
    "avg_loss_pct": -0.025,
    "avg_win_loss_ratio": 1.28,
    "num_trades": 87,
    "num_winning": 45,
    "num_losing": 42,
    "avg_holding_days": 12.5,
    "expectancy": 0.0051,
    "sqn": 3.2,
    "kelly_fraction": 0.18,
    "alpha": 0.015,
    "beta": 0.85,
    "var_95": -0.028,
    "cvar_95": -0.041,
    "recovery_factor": 1.26,
    "ulcer_index": 0.12,
    "benchmark_return": 0.3100,
    "benchmark_cagr": 0.0940,
    "benchmark_sharpe": 1.42,
    "benchmark_max_drawdown": -0.2200
  },
  "equity_curve": [
    { "date": "2023-01-03", "equity": 100000.00, "benchmark_equity": 100000.00 }
  ],
  "drawdown_curve": [
    { "date": "2023-01-03", "drawdown_pct": 0.0 }
  ],
  "monthly_returns": [
    { "year": 2023, "month": 1, "return_pct": 2.34 },
    { "year": 2023, "month": 2, "return_pct": -1.20 }
  ],
  "trade_log": [
    {
      "entry_date": "2023-01-15",
      "exit_date": "2023-02-10",
      "entry_price": 390.50,
      "exit_price": 402.30,
      "return_pct": 3.02,
      "direction": "long",
      "bars_held": 18
    }
  ],
  "report_html_url": "https://cdn.trend-scope.com/reports/bt_1.html"
}
```

| Field | Type | Description |
|---|---|---|
| `metrics` | object | All computed metrics |
| `metrics.annual_volatility` | number | Annualized volatility |
| `metrics.sortino_ratio` | number | Sortino ratio (downside-only volatility) |
| `metrics.calmar_ratio` | number | CAGR / \|MDD\| |
| `metrics.max_drawdown_days` | integer | Longest drawdown duration in trading days |
| `metrics.avg_win_pct` | number | Average winning trade return |
| `metrics.avg_loss_pct` | number | Average losing trade return |
| `metrics.avg_win_loss_ratio` | number | Ratio of avg win to avg loss |
| `metrics.num_winning` | integer | Count of winning trades |
| `metrics.num_losing` | integer | Count of losing trades |
| `metrics.avg_holding_days` | number | Average trade duration in days |
| `metrics.expectancy` | number | (Win Rate × Avg Win) - ((1 - Win Rate) × \|Avg Loss\|) |
| `metrics.sqn` | number | System Quality Number |
| `metrics.kelly_fraction` | number | Fractional Kelly criterion |
| `metrics.alpha` | number | Jensen's Alpha vs benchmark |
| `metrics.beta` | number | Beta vs benchmark |
| `metrics.var_95` | number | Value at Risk (95% confidence, daily) |
| `metrics.cvar_95` | number | Conditional VaR / Expected Shortfall |
| `metrics.recovery_factor` | number | Net profit / \|max drawdown in absolute terms\| |
| `metrics.ulcer_index` | number | RMS of percentage drawdowns |
| `metrics.benchmark_return` | number | Benchmark total return |
| `metrics.benchmark_cagr` | number | Benchmark CAGR |
| `metrics.benchmark_sharpe` | number | Benchmark Sharpe |
| `metrics.benchmark_max_drawdown` | number | Benchmark max drawdown |
| `equity_curve` | array | Daily equity values |
| `equity_curve[].date` | date | Date |
| `equity_curve[].equity` | number | Strategy equity |
| `equity_curve[].benchmark_equity` | number | Benchmark equity |
| `drawdown_curve` | array | Daily drawdown |
| `drawdown_curve[].drawdown_pct` | number | Drawdown as decimal (e.g., -0.05 = -5%) |
| `monthly_returns` | array | Monthly return grid |
| `monthly_returns[].return_pct` | number | Monthly return percentage |
| `trade_log` | array | Individual trade records |
| `trade_log[].entry_date` | date | Trade entry date |
| `trade_log[].exit_date` | date | Trade exit date |
| `trade_log[].entry_price` | number | Entry price |
| `trade_log[].exit_price` | number | Exit price |
| `trade_log[].return_pct` | number | Trade return |
| `trade_log[].direction` | string | `"long"` or `"short"` |
| `trade_log[].bars_held` | integer | Duration in bars |
| `report_html_url` | string \| null | URL to QuantStats HTML tear sheet |

**Error Responses**:

| Code | Detail |
|---|---|
| `404` | `{ "code": "JOB_NOT_FOUND" }` |
| `400` | `{ "code": "JOB_NOT_COMPLETED", "detail": "Backtest job is still running" }` |

---

## 7. Watchlist APIs

### 7.1 GET /watchlist

**Description**: List the authenticated user's watchlists.
**(Zh)**: 列出当前用户的自选列表。

- **Auth**: Bearer
- **Tier**: All (limit by tier)

**Response `200`**:

```json
{
  "items": [
    {
      "id": 1,
      "name": "Default Watchlist",
      "sort_order": 0,
      "item_count": 3,
      "items": [
        {
          "id": 10,
          "stock_id": 1,
          "symbol": "SPY",
          "name": "SPDR S&P 500 ETF Trust",
          "last_price": 527.80,
          "change_pct": 1.25,
          "added_at": "2026-05-01T08:00:00Z"
        }
      ],
      "created_at": "2026-04-15T08:00:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "size": 20,
  "pages": 1
}
```

| Field | Type | Description |
|---|---|---|
| `items[].id` | integer | Watchlist ID |
| `items[].name` | string | Watchlist name |
| `items[].sort_order` | integer | Display order |
| `items[].item_count` | integer | Number of stocks in this watchlist |
| `items[].items` | array | Watchlist items (stocks) |
| `items[].items[].id` | integer | Watchlist item ID |
| `items[].items[].stock_id` | integer | Stock ID |
| `items[].items[].symbol` | string | Stock symbol |
| `items[].items[].name` | string | Stock name |
| `items[].items[].last_price` | number \| null | Latest close price |
| `items[].items[].change_pct` | number \| null | Daily change % |
| `items[].items[].added_at` | datetime | When added to watchlist |

---

### 7.2 POST /watchlist

**Description**: Create a new watchlist.
**(Zh)**: 创建新的自选列表。

- **Auth**: Bearer
- **Tier**: Free (1 list), Basic (5), Pro (unlimited)

**Request Body**:

```json
{
  "name": "Tech ETFs",
  "sort_order": 1
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Watchlist name (1-100 chars) |
| `sort_order` | integer | No | Display order |

**Response `201`**: Returns the created watchlist object (same structure as GET item).

---

### 7.3 PUT /watchlist/{id}/items

**Description**: Replace all items in a watchlist (add/remove stocks).
**(Zh)**: 批量替换自选列表中的标的。

- **Auth**: Bearer
- **Tier**: All (total items across all watchlists limited by tier)

**Path Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `id` | integer | Watchlist ID |

**Request Body**:

```json
{
  "stock_ids": [1, 2, 5]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `stock_ids` | array | Yes | Ordered list of stock IDs (replaces all existing items) |

**Response `200`**: Returns the updated watchlist object.

**Error Responses**:

| Code | Detail |
|---|---|
| `403` | `{ "code": "WATCHLIST_LIMIT_EXCEEDED", "detail": "Watchlist item limit (5) reached. Upgrade to add more stocks." }` |

---

### 7.4 POST /watchlist/{id}/items

**Description**: Add a single stock to a watchlist.
**(Zh)**: 添加单个标的到自选列表。

- **Auth**: Bearer
- **Tier**: All (subject to limit)

**Request Body**:

```json
{
  "stock_id": 3
}
```

**Response `201`**: Returns the added watchlist item.

### 7.5 DELETE /watchlist/{id}/items/{item_id}

**Description**: Remove a stock from a watchlist.
**(Zh)**: 从自选列表中移除标的。

- **Auth**: Bearer
- **Tier**: All

**Response `204`**: No content.

---

## 8. Alert APIs

### 8.1 GET /alerts

**Description**: List the authenticated user's alert rules.
**(Zh)**: 列出当前用户的提醒规则。

- **Auth**: Bearer
- **Tier**: Basic (10 alerts), Pro (30 alerts)

**Query Parameters**:

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `is_active` | boolean | No | — | Filter active/inactive |
| `stock_id` | integer | No | — | Filter by stock |
| `alert_type` | string | No | — | Filter by type |

**Response `200`**:

```json
{
  "items": [
    {
      "id": 1,
      "user_id": 1,
      "stock_id": 1,
      "symbol": "SPY",
      "alert_type": "golden_cross",
      "threshold": null,
      "channels": ["email", "push"],
      "is_active": true,
      "last_triggered_at": "2026-06-09T16:30:00Z",
      "created_at": "2026-05-01T08:00:00Z",
      "updated_at": "2026-06-09T16:30:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "size": 20,
  "pages": 1
}
```

| Field | Type | Description |
|---|---|---|
| `id` | integer | Alert rule ID |
| `user_id` | integer | Owner user ID |
| `stock_id` | integer | Monitored stock |
| `symbol` | string | Stock symbol |
| `alert_type` | string | `"golden_cross"`, `"death_cross"`, `"bullish_alignment"`, `"bearish_alignment"`, `"price_above"`, `"price_below"`, `"volume_spike"`, `"risk_change"`, `"any_signal"` |
| `threshold` | number \| null | Price threshold (for `price_above`/`price_below` types) |
| `channels` | array | Notification channels: `["email"]`, `["push"]`, `["inapp"]` (multiple allowed) |
| `is_active` | boolean | Enabled/disabled |
| `last_triggered_at` | datetime \| null | Last time this alert fired |

---

### 8.2 POST /alerts

**Description**: Create a new alert rule.
**(Zh)**: 创建新的提醒规则。

- **Auth**: Bearer
- **Tier**: Basic, Pro

**Request Body**:

```json
{
  "stock_id": 1,
  "alert_type": "golden_cross",
  "threshold": null,
  "channels": ["email", "push"],
  "is_active": true
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `stock_id` | integer | Yes | Stock to monitor |
| `alert_type` | string | Yes | Alert trigger type |
| `threshold` | number | Conditional | Required for `price_above`/`price_below` |
| `channels` | array | Yes | At least one channel: `"email"`, `"push"`, `"inapp"` |
| `is_active` | boolean | No | Default `true` |

**Response `201`**: Returns the created alert object.

**Error Responses**:

| Code | Detail |
|---|---|
| `403` | `{ "code": "ALERT_LIMIT_EXCEEDED", "detail": "Alert limit (10) reached. Upgrade to Pro for 30 alerts." }` |
| `403` | `{ "code": "PUSH_NOT_AVAILABLE", "detail": "Push notifications require Pro tier" }` |

---

### 8.3 PATCH /alerts/{id}

**Description**: Update an alert rule.
**(Zh)**: 更新提醒规则。

- **Auth**: Bearer
- **Tier**: Basic, Pro

**Request Body** (all fields optional):

```json
{
  "channels": ["email"],
  "is_active": false
}
```

**Response `200`**: Returns the updated alert object.

### 8.4 DELETE /alerts/{id}

**Description**: Delete an alert rule.
**(Zh)**: 删除提醒规则。

- **Auth**: Bearer
- **Tier**: Basic, Pro

**Response `204`**: No content.

---

## 9. Notification APIs

### 9.1 GET /notifications/inbox

**Description**: Get the authenticated user's notification inbox (paginated).
**(Zh)**: 获取站内通知收件箱（分页）。

- **Auth**: Bearer
- **Tier**: All

**Query Parameters**:

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `is_read` | boolean | No | — | Filter read/unread |
| `page` | integer | No | `1` | Page number |
| `size` | integer | No | `20` | Items per page |

**Response `200`**:

```json
{
  "items": [
    {
      "id": 1,
      "alert_type": "golden_cross",
      "title": "SPY Golden Cross Alert",
      "body": "SPY triggered a golden cross! MA20 crossed above MA60 at $527.80",
      "data": {
        "symbol": "SPY",
        "price": 527.80,
        "signal_id": 42
      },
      "is_read": false,
      "read_at": null,
      "created_at": "2026-06-09T16:30:00Z"
    }
  ],
  "unread_count": 3,
  "total": 25,
  "page": 1,
  "size": 20,
  "pages": 2
}
```

| Field | Type | Description |
|---|---|---|
| `id` | integer | Notification ID |
| `alert_type` | string | Original alert type |
| `title` | string | Notification title |
| `body` | string | Notification body text |
| `data` | object \| null | Structured context data (symbol, price, signal_id, etc.) |
| `is_read` | boolean | Read status |
| `read_at` | datetime \| null | When marked as read |
| `created_at` | datetime | Created at |
| `unread_count` | integer | Total unread notifications (useful for badge) |

---

### 9.2 PATCH /notifications/inbox/{id}/read

**Description**: Mark a notification as read.
**(Zh)**: 标记通知为已读。

- **Auth**: Bearer
- **Tier**: All

**Response `200`**:

```json
{
  "id": 1,
  "is_read": true,
  "read_at": "2026-06-09T17:00:00Z"
}
```

---

### 9.3 PATCH /notifications/inbox/read-all

**Description**: Mark all notifications as read.
**(Zh)**: 标记所有通知为已读。

- **Auth**: Bearer
- **Tier**: All

**Response `200`**:

```json
{
  "marked_count": 25
}
```

---

### 9.4 GET /notifications/preferences

**Description**: Get the authenticated user's notification preferences.
**(Zh)**: 获取通知偏好设置。

- **Auth**: Bearer
- **Tier**: All

**Response `200`**:

```json
{
  "locale": "en",
  "email_enabled": true,
  "push_enabled": false,
  "inapp_enabled": true,
  "sms_enabled": false,
  "digest_mode": "realtime",
  "quiet_start": "22:00",
  "quiet_end": "07:00",
  "timezone": "America/New_York"
}
```

| Field | Type | Description |
|---|---|---|
| `locale` | string | `"en"` or `"zh"` |
| `email_enabled` | boolean | Email channel master switch |
| `push_enabled` | boolean | Web push master switch (Pro only) |
| `inapp_enabled` | boolean | In-app notification master switch |
| `sms_enabled` | boolean | SMS master switch (future) |
| `digest_mode` | string | `"realtime"`, `"daily"`, `"weekly"` |
| `quiet_start` | string | Do-not-disturb start time (HH:mm, user timezone) |
| `quiet_end` | string | Do-not-disturb end time (HH:mm) |
| `timezone` | string | IANA timezone string |

---

### 9.5 PUT /notifications/preferences

**Description**: Update notification preferences (full replace).
**(Zh)**: 更新通知偏好设置（全量替换）。

- **Auth**: Bearer
- **Tier**: All

**Request Body**:

```json
{
  "locale": "en",
  "email_enabled": true,
  "push_enabled": false,
  "inapp_enabled": true,
  "sms_enabled": false,
  "digest_mode": "daily",
  "quiet_start": "22:00",
  "quiet_end": "07:00",
  "timezone": "America/New_York"
}
```

**Response `200`**: Returns the updated preferences object.

---

### 9.6 POST /notifications/push-token

**Description**: Register a push device token (for OneSignal web push / FCM / APNs).
**(Zh)**: 注册推送设备令牌。

- **Auth**: Bearer
- **Tier**: Pro (push only available for Pro)

**Request Body**:

```json
{
  "platform": "web",
  "token": "onesignal-push-token-or-vapid-subscription",
  "device_info": "Chrome 125 / macOS 14.5"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `platform` | string | Yes | `"web"`, `"ios"`, `"android"` |
| `token` | string | Yes | Push provider token (max 500 chars) |
| `device_info` | string | No | Optional device description |

**Response `201`**:

```json
{
  "id": 1,
  "platform": "web",
  "is_active": true,
  "created_at": "2026-06-09T17:00:00Z"
}
```

---

## 10. Subscription APIs

### 10.1 GET /subscriptions/me

**Description**: Get the authenticated user's subscription details and billing history.
**(Zh)**: 获取当前用户的订阅详情和账单历史。

- **Auth**: Bearer
- **Tier**: All

**Response `200`**:

```json
{
  "current": {
    "id": 1,
    "tier": {
      "id": 2,
      "name": "Basic",
      "slug": "basic"
    },
    "status": "active",
    "started_at": "2026-05-01T00:00:00Z",
    "expired_at": "2026-07-01T00:00:00Z",
    "auto_renew": true,
    "grace_until": null,
    "created_at": "2026-05-01T00:00:00Z"
  },
  "billing_history": [
    {
      "id": 5,
      "amount": 9.99,
      "currency": "USD",
      "period": "monthly",
      "status": "paid",
      "paid_at": "2026-06-01T00:00:00Z",
      "created_at": "2026-06-01T00:00:00Z"
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `current` | object \| null | Active subscription (null if on free tier) |
| `current.tier.id` | integer | Tier ID |
| `current.tier.name` | string | Tier display name |
| `current.tier.slug` | string | Tier slug (`"free"`, `"basic"`, `"pro"`) |
| `current.status` | string | `"active"`, `"past_due"`, `"cancelled"`, `"expired"` |
| `billing_history` | array | Past payment orders |

---

### 10.2 GET /subscriptions/tiers

**Description**: List all available subscription tiers with features.
**(Zh)**: 列出所有可用的订阅等级及权益。

- **Auth**: None
- **Tier**: All

**Response `200`**:

```json
{
  "tiers": [
    {
      "id": 1,
      "name": "Free",
      "slug": "free",
      "price_monthly": 0.00,
      "price_yearly": 0.00,
      "features": {
        "kline": ["1d_delayed"],
        "kline_history_months": 3,
        "indicators": { "overlap": ["sma", "ema"] },
        "watchlist_limit": 5,
        "alert_limit": 0,
        "ai_analysis_limit": 0,
        "daily_api_limit": 100,
        "signals": false,
        "risk_level": false,
        "backtest": false,
        "multi_timeframe": false,
        "data_export": false
      },
      "sort_order": 0,
      "is_active": true
    },
    {
      "id": 2,
      "name": "Basic",
      "slug": "basic",
      "price_monthly": 9.99,
      "price_yearly": 99.00,
      "stripe_price_id_monthly": "price_xxx_basic_monthly",
      "stripe_price_id_yearly": "price_xxx_basic_yearly",
      "features": {
        "kline": ["1d", "1w"],
        "kline_history_months": 24,
        "indicators": {
          "overlap": ["sma", "ema"],
          "momentum": ["rsi", "macd"],
          "volatility": ["bollinger"]
        },
        "watchlist_limit": 30,
        "alert_limit": 10,
        "ai_analysis_limit": 10,
        "daily_api_limit": 1000,
        "signals": ["golden_cross", "death_cross"],
        "risk_level": true,
        "backtest": false,
        "multi_timeframe": false,
        "data_export": false
      },
      "sort_order": 1,
      "is_active": true
    },
    {
      "id": 3,
      "name": "Pro",
      "slug": "pro",
      "price_monthly": 29.99,
      "price_yearly": 299.00,
      "stripe_price_id_monthly": "price_xxx_pro_monthly",
      "stripe_price_id_yearly": "price_xxx_pro_yearly",
      "features": {
        "kline": ["1d", "1w", "1M"],
        "kline_history_months": null,
        "indicators": "all",
        "watchlist_limit": null,
        "alert_limit": 30,
        "ai_analysis_limit": 50,
        "daily_api_limit": 10000,
        "signals": "all",
        "risk_level": true,
        "backtest": true,
        "multi_timeframe": true,
        "data_export": true,
        "notification_channels": ["email", "push", "inapp"]
      },
      "sort_order": 2,
      "is_active": true
    }
  ]
}
```

---

## 11. Payment APIs

### 11.1 POST /payments/create-checkout

**Description**: Create a Stripe Checkout session and return the redirect URL.
**(Zh)**: 创建 Stripe Checkout 会话，返回支付页面跳转 URL。

- **Auth**: Bearer
- **Tier**: All

**Request Body**:

```json
{
  "tier_id": 2,
  "period": "monthly",
  "success_url": "https://app.trend-scope.com/subscription/success",
  "cancel_url": "https://app.trend-scope.com/subscription/cancel",
  "promotion_code": "LAUNCH20"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `tier_id` | integer | Yes | Subscription tier ID (from `GET /subscriptions/tiers`) |
| `period` | string | Yes | `"monthly"` or `"yearly"` |
| `success_url` | string | Yes | Redirect URL after successful payment |
| `cancel_url` | string | Yes | Redirect URL if user cancels checkout |
| `promotion_code` | string | No | Optional promo code |

**Response `200`**:

```json
{
  "url": "https://checkout.stripe.com/c/pay/cs_test_xxx",
  "session_id": "cs_test_xxx"
}
```

| Field | Type | Description |
|---|---|---|
| `url` | string | Stripe Checkout page URL (frontend should redirect the user here) |
| `session_id` | string | Stripe Checkout session ID for reference |

**Error Responses**:

| Code | Detail |
|---|---|
| `404` | `{ "code": "TIER_NOT_FOUND", "detail": "Tier not found" }` |
| `400` | `{ "code": "ALREADY_SUBSCRIBED", "detail": "You already have an active subscription. Use the billing portal to change plans." }` |

---

### 11.2 GET /payments/billing-portal

**Description**: Get the Stripe Customer Portal URL for managing subscription, payment methods, and invoices.
**(Zh)**: 获取 Stripe 客户门户 URL，用于管理订阅、支付方式和发票。

- **Auth**: Bearer
- **Tier**: All (with existing Stripe subscription)

**Query Parameters**:

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `return_url` | string | No | app home | URL to redirect back after portal session |

**Response `200`**:

```json
{
  "url": "https://billing.stripe.com/p/session/test_xxx"
}
```

**Error Responses**:

| Code | Detail |
|---|---|
| `404` | `{ "code": "NO_STRIPE_SUBSCRIPTION", "detail": "No Stripe subscription found for this user" }` |

---

## 12. Webhook APIs (Public)

### 12.1 POST /webhooks/stripe

**Description**: Stripe webhook endpoint. Receives events for checkout completion, subscription updates, invoice payments, etc. **Must verify Stripe signature header**.
**(Zh)**: Stripe Webhook 回调端点。接收支付完成、订阅更新、发票支付等事件。必须验证 Stripe 签名。

- **Auth**: None (Stripe signature verification required)
- **Tier**: N/A
- **Content-Type**: `application/json`
- **Required Header**: `Stripe-Signature: <t=...,v1=...>`

**Request Body**: Raw JSON bytes from Stripe. The Stripe event object structure.

**Response `200`**:

```json
{
  "received": true
}
```

**Error Responses**:

| Code | Detail |
|---|---|
| `400` | `{ "code": "INVALID_SIGNATURE", "detail": "Stripe signature verification failed" }` |
| `400` | `{ "code": "MISSING_SIGNATURE", "detail": "Missing Stripe-Signature header" }` |

**Idempotency**: Stripe event IDs are deduplicated. Returning 200 for duplicate events is safe.

---

### 12.2 POST /webhooks/finnhub

**Description**: Finnhub trade data webhook endpoint. Receives real-time price updates when WebSocket connection drops (fallback mode).
**(Zh)**: Finnhub 行情数据 Webhook 端点。当 WebSocket 连接中断时，接收实时价格更新（降级模式）。

- **Auth**: Finnhub token verification
- **Tier**: N/A

**Request Body**: Finnhub trade data format.

**Response `200`**:

```json
{
  "received": true
}
```

---

## 13. Admin APIs

All admin endpoints require:
- **Auth**: Bearer token
- **Role**: `admin`
- **Header**: `Authorization: Bearer <admin_access_token>`

### 13.1 GET /admin/dashboard/stats

**Description**: Get key platform metrics for the admin dashboard.
**(Zh)**: 获取管理后台关键平台指标。

**Response `200`**:

```json
{
  "users": {
    "total": 1520,
    "active_today": 89,
    "new_this_week": 34,
    "by_tier": {
      "free": 1200,
      "basic": 250,
      "pro": 70
    }
  },
  "revenue": {
    "mrr": 4747.00,
    "arr_estimate": 56964.00,
    "this_month": 4820.50,
    "last_month": 4510.00,
    "growth_pct": 6.88
  },
  "signals": {
    "total_generated": 4520,
    "active_signals": 87,
    "by_type": {
      "golden_cross": 45,
      "death_cross": 22,
      "bullish_alignment": 12,
      "bearish_alignment": 8
    }
  },
  "stocks": {
    "total": 50,
    "active": 48,
    "with_active_signals": 15
  },
  "backtests": {
    "total_jobs": 320,
    "running": 3,
    "queued": 1,
    "completed": 310,
    "failed": 6
  },
  "ai_usage": {
    "total_analyses": 1250,
    "total_cost_usd": 15.42,
    "by_model": {
      "deepseek-v4-flash": { "count": 1100, "cost_usd": 0.47 },
      "claude-haiku-4-5": { "count": 120, "cost_usd": 0.66 },
      "gpt-5.4-mini": { "count": 30, "cost_usd": 0.14 }
    }
  },
  "payments": {
    "total_orders": 850,
    "success_rate_pct": 94.5,
    "pending": 5,
    "failed_today": 1
  },
  "generated_at": "2026-06-09T16:30:00Z"
}
```

| Field | Type | Description |
|---|---|---|
| `users.total` | integer | Total registered users |
| `users.active_today` | integer | Users who made at least 1 API call today |
| `users.new_this_week` | integer | New registrations this calendar week |
| `users.by_tier` | object | User count per tier slug |
| `revenue.mrr` | number | Monthly Recurring Revenue (sum of active subscription prices) |
| `revenue.arr_estimate` | number | MRR × 12 |
| `revenue.this_month` | number | Revenue this calendar month |
| `revenue.last_month` | number | Revenue last calendar month |
| `revenue.growth_pct` | number | MoM revenue growth percentage |
| `signals.total_generated` | integer | Total signals ever generated |
| `signals.active_signals` | integer | Currently active signals |
| `signals.by_type` | object | Active signal count by type |
| `stocks.total` | integer | Total stocks in system |
| `stocks.active` | integer | Active stocks |
| `stocks.with_active_signals` | integer | Stocks with at least 1 active signal |
| `backtests.total_jobs` | integer | Total backtest jobs |
| `backtests.running` | integer | Currently running |
| `backtests.queued` | integer | Queued |
| `backtests.completed` | integer | Completed successfully |
| `backtests.failed` | integer | Failed |
| `ai_usage.total_analyses` | integer | Total AI analyses performed |
| `ai_usage.total_cost_usd` | number | Total AI API cost |
| `ai_usage.by_model` | object | Breakdown by model |
| `payments.total_orders` | integer | Total payment orders |
| `payments.success_rate_pct` | number | Payment success rate |
| `generated_at` | datetime | Snapshot timestamp |

---

### 13.2 GET /admin/users

**Description**: List and search users (admin view).
**(Zh)**: 用户列表与搜索（管理视图）。

**Query Parameters**:

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `q` | string | No | — | Search by email or nickname |
| `role` | string | No | — | `"user"` or `"admin"` |
| `status` | string | No | — | `"active"`, `"disabled"`, `"banned"` |
| `tier` | string | No | — | Filter by subscription tier slug |
| `sort_by` | string | No | `"created_at"` | `"email"`, `"created_at"`, `"last_login_at"` |
| `page` | integer | No | `1` | Page number |
| `size` | integer | No | `20` | Items per page |

**Response `200`**:

```json
{
  "items": [
    {
      "id": 1,
      "email": "user@example.com",
      "nickname": "TraderJoe",
      "locale": "en",
      "role": "user",
      "status": "active",
      "subscription_tier": "basic",
      "subscription_status": "active",
      "last_login_at": "2026-06-09T14:30:00Z",
      "created_at": "2026-04-15T08:00:00Z"
    }
  ],
  "total": 1520,
  "page": 1,
  "size": 20,
  "pages": 76
}
```

| Field | Type | Description |
|---|---|---|
| `subscription_tier` | string \| null | Current tier slug |
| `subscription_status` | string \| null | Current subscription status |

---

### 13.3 GET /admin/users/{id}

**Description**: Get detailed user info (admin view).
**(Zh)**: 获取用户详细信息（管理视图）。

**Response `200`**: Full user profile including subscription history, payment orders, recent API usage, and audit log.

```json
{
  "id": 1,
  "email": "user@example.com",
  "nickname": "TraderJoe",
  "avatar_url": null,
  "locale": "en",
  "role": "user",
  "status": "active",
  "subscription": { /* same as GET /subscriptions/me but for this user */ },
  "payment_orders": [ /* recent payment orders */ ],
  "api_usage_today": 45,
  "api_limit": 1000,
  "alerts_count": 3,
  "watchlist_items_count": 8,
  "backtest_jobs_count": 12,
  "ai_analyses_today": 2,
  "last_login_at": "2026-06-09T14:30:00Z",
  "created_at": "2026-04-15T08:00:00Z",
  "updated_at": "2026-06-09T14:30:00Z"
}
```

---

### 13.4 PATCH /admin/users/{id}

**Description**: Update user status, role, or assign subscription.
**(Zh)**: 更新用户状态、角色或分配订阅。

**Request Body** (all fields optional):

```json
{
  "status": "banned",
  "role": "user",
  "nickname": "Updated Name"
}
```

| Field | Type | Description |
|---|---|---|
| `status` | string | `"active"`, `"disabled"`, `"banned"` |
| `role` | string | `"user"` or `"admin"` |
| `nickname` | string | Display name |

**Response `200`**: Updated user object.

---

### 13.5 POST /admin/users

**Description**: Create a user (admin-initiated).
**(Zh)**: 管理员创建用户。

**Request Body**:

```json
{
  "email": "newuser@example.com",
  "password": "TempP@ss123!",
  "nickname": "New User",
  "locale": "en",
  "role": "user"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `email` | string | Yes | User email |
| `password` | string | Yes | Initial password |
| `nickname` | string | No | Display name |
| `locale` | string | No | `"en"` or `"zh"` |
| `role` | string | No | `"user"` (default) or `"admin"` |

**Response `201`**: Created user object.

---

### 13.6 GET /admin/stocks

**Description**: List and manage stocks (admin view).
**(Zh)**: 标的管理列表。

**Query Parameters**: Same as `GET /stocks`, plus:

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `has_data` | boolean | No | — | Filter by whether price data exists |

**Response `200`**: Paginated stock list with additional admin fields (data source, last sync time).

---

### 13.7 POST /admin/stocks

**Description**: Add a new stock to the system.
**(Zh)**: 添加新标的。

**Request Body**:

```json
{
  "symbol": "IWM",
  "name": "iShares Russell 2000 ETF",
  "type": "ETF",
  "subtype": "broad_market",
  "market": "US",
  "sector": "Small Blend",
  "is_active": true
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `symbol` | string | Yes | Ticker symbol (unique) |
| `name` | string | Yes | Full name |
| `type` | string | Yes | `"ETF"`, `"Stock"`, `"Index"` |
| `subtype` | string | No | Classification |
| `market` | string | No | Default `"US"` |
| `sector` | string | No | Sector name |
| `is_active` | boolean | No | Default `true` |

**Response `201`**: Created stock object.

---

### 13.8 PATCH /admin/stocks/{id}

**Description**: Update a stock.
**(Zh)**: 编辑标的。

**Response `200`**: Updated stock object.

### 13.9 DELETE /admin/stocks/{id}

**Description**: Soft-delete (deactivate) a stock.
**(Zh)**: 下架标的（软删除）。

**Response `204`**: No content.

---

### 13.10 GET /admin/tiers

**Description**: List subscription tiers (admin).
**(Zh)**: 会员等级列表。

**Response `200`**: Array of tier objects (same structure as `GET /subscriptions/tiers`).

---

### 13.11 POST /admin/tiers

**Description**: Create a new subscription tier.
**(Zh)**: 创建新的会员等级。

**Request Body**:

```json
{
  "name": "Enterprise",
  "slug": "enterprise",
  "stripe_price_id_monthly": "price_xxx_ent_monthly",
  "stripe_price_id_yearly": "price_xxx_ent_yearly",
  "price_monthly": 99.99,
  "price_yearly": 999.00,
  "features": { /* ... */ },
  "daily_api_limit": 50000,
  "watchlist_limit": null,
  "alert_limit": 100,
  "ai_analysis_limit": 200,
  "sort_order": 3,
  "is_active": true
}
```

**Response `201`**: Created tier object.

---

### 13.12 PATCH /admin/tiers/{id}

**Description**: Update a subscription tier.
**(Zh)**: 更新会员等级。

**Response `200`**: Updated tier object.

---

### 13.13 GET /admin/signals

**Description**: List all signals for review/moderation (admin).
**(Zh)**: 信号审核列表。

**Query Parameters**:

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `signal_type` | string | No | — | Filter by type |
| `strength` | string | No | — | `"weak"`, `"normal"`, `"strong"` |
| `stock_id` | integer | No | — | Filter by stock |
| `is_active` | boolean | No | — | Filter active/inactive |
| `from` | date | No | — | Start date |
| `to` | date | No | — | End date |
| `page` | integer | No | `1` | Page number |
| `size` | integer | No | `20` | Items per page |

**Response `200`**: Paginated signal list with full detail.

---

### 13.14 PATCH /admin/signals/{id}

**Description**: Override/correct a signal (admin).
**(Zh)**: 修正信号（管理员覆写）。

**Request Body** (all fields optional):

```json
{
  "strength": "weak",
  "is_active": false,
  "admin_note": "False signal due to data anomaly on 2026-06-09"
}
```

| Field | Type | Description |
|---|---|---|
| `strength` | string | `"weak"`, `"normal"`, `"strong"` |
| `is_active` | boolean | Deactivate a false signal |
| `admin_note` | string | Reason for correction |

**Response `200`**: Updated signal object.

---

### 13.15 GET /admin/analysis-configs

**Description**: List all analysis configs (admin).
**(Zh)**: 分析策略配置列表。

**Response `200`**: Paginated config list.

---

### 13.16 POST /admin/analysis-configs

**Description**: Create a global analysis config template.
**(Zh)**: 创建全局分析策略配置。

**Request Body**:

```json
{
  "name": "Aggressive MA Strategy",
  "strategy_type": "ma_cross",
  "params": {
    "ma_short": 5,
    "ma_long": 20
  },
  "confirm_bars": 1,
  "volume_confirm": false,
  "is_active": true
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Config name |
| `strategy_type` | string | Yes | `"ma_cross"`, `"multi_indicator"`, `"ml_enhanced"` |
| `params` | object | Yes | Flexible JSON params (depends on strategy_type) |
| `confirm_bars` | integer | No | Consecutive bars to confirm signal |
| `volume_confirm` | boolean | No | Require volume above average |
| `is_active` | boolean | No | Default `true` |

**Response `201`**: Created config object.

---

### 13.17 PATCH /admin/analysis-configs/{id}

**Description**: Update an analysis config.
**(Zh)**: 更新分析策略配置。

**Response `200`**: Updated config object.

---

### 13.18 GET /admin/payments

**Description**: List payment orders (admin).
**(Zh)**: 支付订单列表。

**Query Parameters**:

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `status` | string | No | — | `"pending"`, `"paid"`, `"failed"`, `"refunded"` |
| `user_id` | integer | No | — | Filter by user |
| `from` | date | No | — | Start date |
| `to` | date | No | — | End date |
| `page` | integer | No | `1` | Page number |
| `size` | integer | No | `20` | Items per page |

**Response `200`**: Paginated payment orders with user and tier info.

```json
{
  "items": [
    {
      "id": 100,
      "user_id": 42,
      "user_email": "user@example.com",
      "tier_name": "Pro",
      "amount": 29.99,
      "currency": "USD",
      "period": "monthly",
      "payment_provider": "stripe",
      "status": "paid",
      "paid_at": "2026-06-01T00:00:00Z",
      "created_at": "2026-06-01T00:00:00Z"
    }
  ],
  "total": 850,
  "page": 1,
  "size": 20,
  "pages": 43
}
```

---

### 13.19 GET /admin/backtest-jobs

**Description**: Monitor all backtest jobs (admin).
**(Zh)**: 回测任务监控。

**Query Parameters**:

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `status` | string | No | — | `"queued"`, `"running"`, `"completed"`, `"failed"` |
| `user_id` | integer | No | — | Filter by user |
| `page` | integer | No | `1` | — |
| `size` | integer | No | `20` | — |

**Response `200`**: Paginated backtest jobs with user and stock info.

---

### 13.20 GET /admin/ai-usage

**Description**: AI usage statistics (admin).
**(Zh)**: AI 使用量统计。

**Query Parameters**:

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `from` | date | No | 30 days ago | Start date |
| `to` | date | No | today | End date |
| `group_by` | string | No | `"day"` | `"day"`, `"model"`, `"tier"`, `"user"` |

**Response `200`**:

```json
{
  "period": { "from": "2026-05-10", "to": "2026-06-09" },
  "summary": {
    "total_analyses": 1250,
    "total_cost_usd": 15.42,
    "avg_cost_per_analysis": 0.0123,
    "cache_hit_rate_pct": 42.5
  },
  "by_model": [
    { "model": "deepseek-v4-flash", "count": 1100, "cost_usd": 0.47 },
    { "model": "claude-haiku-4-5", "count": 120, "cost_usd": 0.66 },
    { "model": "gpt-5.4-mini", "count": 30, "cost_usd": 0.14 }
  ],
  "by_tier": [
    { "tier": "free", "count": 0, "cost_usd": 0.0 },
    { "tier": "basic", "count": 1050, "cost_usd": 0.45 },
    { "tier": "pro", "count": 200, "cost_usd": 1.10 }
  ],
  "daily": [
    { "date": "2026-06-09", "count": 45, "cost_usd": 0.52 }
  ]
}
```

---

### 13.21 GET /admin/webhook-integrations

**Description**: List all webhook integrations across users (admin).
**(Zh)**: 查看所有用户的 Webhook 集成。

**Response `200`**: Paginated webhook integration list.

---

## 14. WebSocket API

### 14.1 /ws/notifications/{user_id}

**Description**: Real-time notification delivery via WebSocket. The client connects and receives instant push notifications for alerts, system messages, and inbox updates.
**(Zh)**: 通过 WebSocket 实时推送通知。

- **Protocol**: `wss://api.trend-scope.com/ws/v1/notifications/{user_id}`
- **Auth**: Query parameter token: `wss://api.trend-scope.com/ws/v1/notifications/1?token=<access_token>`

#### Connection

```
Client → Server: WebSocket upgrade request with ?token=<jwt_access_token>
Server → Client: {"type": "connected", "user_id": 1}
```

#### Authentication Flow

1. Client initiates WebSocket connection with `token` query parameter containing a valid JWT access token
2. Server validates the token, extracts `user_id`, and verifies it matches the path parameter
3. If valid: sends `connected` message
4. If invalid: sends `error` message and closes with code 4001

#### Message Format

All messages are JSON with a `type` field:

| type | Direction | Description |
|---|---|---|
| `connected` | S → C | Successful authentication |
| `notification` | S → C | New notification (alert triggered) |
| `inbox_update` | S → C | Inbox unread count changed |
| `ping` | S → C | Heartbeat request |
| `pong` | C → S | Heartbeat response |
| `error` | S → C | Error occurred, connection will close |
| `ack` | C → S | Acknowledge receipt of a notification |

#### Server → Client Messages

**`connected`** (after successful auth):
```json
{
  "type": "connected",
  "user_id": 1,
  "unread_count": 3,
  "server_time": "2026-06-09T16:30:00Z"
}
```

**`notification`** (new alert):
```json
{
  "type": "notification",
  "id": "notif_abc123",
  "inbox_id": 42,
  "alert_type": "golden_cross",
  "title": "SPY Golden Cross Alert",
  "body": "SPY triggered a golden cross! MA20 crossed above MA60 at $527.80",
  "data": {
    "symbol": "SPY",
    "signal_id": 42,
    "price": 527.80,
    "triggered_date": "2026-06-09"
  },
  "created_at": "2026-06-09T16:30:00Z"
}
```

**`inbox_update`** (unread count changed):
```json
{
  "type": "inbox_update",
  "unread_count": 5
}
```

**`ping`** (heartbeat, every 30 seconds):
```json
{
  "type": "ping",
  "ts": "2026-06-09T16:30:30Z"
}
```

**`error`**:
```json
{
  "type": "error",
  "code": "AUTH_EXPIRED",
  "detail": "Access token expired. Please refresh and reconnect."
}
```

#### Client → Server Messages

**`pong`** (heartbeat response):
```json
{
  "type": "pong",
  "ts": "2026-06-09T16:30:30Z"
}
```

**`ack`** (acknowledge notification):
```json
{
  "type": "ack",
  "id": "notif_abc123"
}
```

#### Heartbeat & Timeouts

| Parameter | Value |
|---|---|
| Server ping interval | 30 seconds |
| Client pong timeout | 10 seconds |
| Connection timeout (no auth) | 5 seconds |
| Max reconnection attempts | 5 (exponential backoff: 1s, 2s, 4s, 8s, 16s) |

#### Close Codes

| Code | Meaning |
|---|---|
| `1000` | Normal closure |
| `4001` | Authentication failed (invalid/expired token) |
| `4002` | User ID mismatch |
| `4003` | Tier not allowed (Free tier) |
| `4004` | Rate limit exceeded (max 3 concurrent connections per user) |

#### Implementation Notes

- Uses Redis Pub/Sub as message broker across multiple uvicorn workers
- Channel pattern: `user:{user_id}:notifications`
- In-app notifications are persisted to `notification_inbox` table before broadcasting
- Client should maintain a local unread counter and update on `inbox_update` messages
- If token expires mid-session (30 min), the server sends `error` with code `AUTH_EXPIRED`. Client should refresh the token via `POST /auth/refresh` and reconnect.

---

## Appendix A: Enum Reference

### Signal Types (`signal_type`)

| Value | Description |
|---|---|
| `golden_cross` | Short MA crosses above long MA (bullish) |
| `death_cross` | Short MA crosses below long MA (bearish) |
| `bullish_alignment` | MA5 > MA20 > MA60 > MA120 |
| `bearish_alignment` | MA5 < MA20 < MA60 < MA120 |
| `composite_buy` | Weighted composite score > 0.5 |
| `composite_sell` | Weighted composite score < -0.5 |

### Alert Types (`alert_type`)

| Value | Description |
|---|---|
| `golden_cross` | Golden cross occurred |
| `death_cross` | Death cross occurred |
| `bullish_alignment` | MA alignment turned bullish |
| `bearish_alignment` | MA alignment turned bearish |
| `price_above` | Price crossed above threshold |
| `price_below` | Price crossed below threshold |
| `volume_spike` | Unusual volume detected |
| `risk_change` | Risk level changed |
| `any_signal` | Any signal triggered |

### Risk Levels (`risk_level`)

| Value | Condition |
|---|---|
| `low` | Bullish alignment, normal volatility |
| `moderate` | Mixed indicators, normal market |
| `elevated` | High volatility (ATR > 80th percentile) or MA60 weakening |
| `high` | Bearish alignment or extreme volatility |

### Subscription Status

| Value | Description |
|---|---|
| `active` | Subscription is active and paid |
| `past_due` | Payment failed, in retry period |
| `cancelled` | Cancelled (may still have access until period end) |
| `expired` | Period ended, no renewal |

### Payment Order Status

| Value | Description |
|---|---|
| `pending` | Checkout created, not yet paid |
| `paid` | Payment confirmed |
| `failed` | Payment failed |
| `refunded` | Refund issued |
| `expired` | Checkout session expired without payment |

### Backtest Job Status

| Value | Description |
|---|---|
| `queued` | Waiting in queue |
| `running` | Currently executing |
| `completed` | Finished successfully |
| `failed` | Error during execution |

### Notification Digest Mode

| Value | Description |
|---|---|
| `realtime` | Send immediately when triggered |
| `daily` | Aggregate and send once daily at 18:00 US/Eastern |
| `weekly` | Aggregate and send Sunday at 18:00 US/Eastern |

---

## Appendix B: Common Error Codes

| Code | HTTP Status | Description |
|---|---|---|
| `VALIDATION_ERROR` | 422 | Request validation failed |
| `UNAUTHORIZED` | 401 | Missing or invalid access token |
| `TOKEN_EXPIRED` | 401 | Access token expired |
| `FORBIDDEN` | 403 | Insufficient role (`admin` required) |
| `TIER_REQUIRED` | 403 | Higher subscription tier required |
| `TIER_QUOTA_EXCEEDED` | 403 | Tier-specific quota exceeded |
| `ACCOUNT_DISABLED` | 403 | User account is disabled |
| `ACCOUNT_BANNED` | 403 | User account is banned |
| `NOT_FOUND` | 404 | Generic resource not found |
| `STOCK_NOT_FOUND` | 404 | Stock does not exist |
| `CONFIG_NOT_FOUND` | 404 | Analysis config does not exist |
| `EMAIL_ALREADY_EXISTS` | 409 | Duplicate email on registration |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password |
| `INVALID_REFRESH_TOKEN` | 401 | Refresh token invalid or expired |
| `RATE_LIMIT_EXCEEDED` | 429 | General rate limit hit |
| `AI_QUOTA_EXCEEDED` | 403 | Daily AI analysis limit reached |
| `BACKTEST_QUOTA_EXCEEDED` | 403 | Daily backtest limit reached |
| `WATCHLIST_LIMIT_EXCEEDED` | 403 | Watchlist item limit reached |
| `ALERT_LIMIT_EXCEEDED` | 403 | Alert rule limit reached |
| `JOB_NOT_COMPLETED` | 400 | Backtest job not yet finished |
| `AI_SERVICE_UNAVAILABLE` | 503 | All AI providers down |
| `UPSTREAM_UNAVAILABLE` | 503 | External data source unavailable |

---

## Appendix C: Versioning

- API versioning via URL path: `/api/v1/`
- Breaking changes result in a new major version (`/api/v2/`)
- Non-breaking additions (new fields, new endpoints) are added to the current version
- Deprecated fields/endpoints are documented with a `Deprecation` header and sunset date
- Current version: `v1`
