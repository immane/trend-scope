# 002 - Database Schema Design

> **Status**: Draft v1
> **Date**: 2026-06-09
> **Purpose**: Production-ready single source of truth for all 25 database tables. Covers DDL, indexes, foreign keys, partitioning, retention policies, seed data, and migration conventions.
>
> **References**:
> - [001-preliminary-design.md](./001-preliminary-design.md) — architecture & table design origin
> - [001-business-model.md](../research/001-business-model.md) — tier pricing

---

## Table of Contents

1. [Global Conventions](#1-global-conventions)
2. [Entity-Relationship Diagram](#2-entity-relationship-diagram)
3. [DDL — User & Authentication](#3-ddl--user--authentication)
4. [DDL — Subscription & Payment](#4-ddl--subscription--payment)
5. [DDL — Stocks & Market Data](#5-ddl--stocks--market-data)
6. [DDL — Indicator System](#6-ddl--indicator-system)
7. [DDL — Analysis Engine](#7-ddl--analysis-engine)
8. [DDL — AI Analysis](#8-ddl--ai-analysis)
9. [DDL — Backtest](#9-ddl--backtest)
10. [DDL — Notification System](#10-ddl--notification-system)
11. [DDL — Watchlist](#11-ddl--watchlist)
12. [Indexing Strategy Summary](#12-indexing-strategy-summary)
13. [Partitioning Strategy](#13-partitioning-strategy)
14. [Data Retention Policies](#14-data-retention-policies)
15. [Seed Data](#15-seed-data)
16. [Migration Notes](#16-migration-notes)

---

## 1. Global Conventions

### 1.1 Naming

| Rule | Example |
|---|---|
| Table names: `snake_case` plural | `users`, `stock_prices_daily` |
| Column names: `snake_case` singular | `user_id`, `created_at` |
| Primary keys: `PRIMARY KEY (id)` | always `BIGINT UNSIGNED AUTO_INCREMENT` |
| Foreign keys: `fk_{table}_{ref}` | `fk_session_user` |
| Unique keys: `uk_{column(s)}` | `uk_email`, `uk_stock_date` |
| Indexes: `idx_{column(s)}` | `idx_user_sent`, `idx_status_retry` |

### 1.2 Data Types

| Domain | MySQL Type | Reason |
|---|---|---|
| Surrogate PK | `BIGINT UNSIGNED` | 2^64 range, avoids overflow |
| Boolean | `TINYINT(1)` | portable; `0`=false, `1`=true |
| Money | `DECIMAL(10,2)` | exact arithmetic, no float rounding |
| Prices (OHLC) | `DECIMAL(12,4)` | handles $0.0001–$999,999.9999 |
| Percentage/Ratio | `DECIMAL(8,4)` | e.g. 1.2345 for 123.45% |
| Timestamp | `DATETIME` (no timezone) | stored as UTC; `TIMESTAMP` limited to 2038 |
| Text | `VARCHAR(n)` for fixed; `TEXT` / `MEDIUMTEXT` for variable | — |
| JSON | `JSON` | native validation, indexed via generated columns if needed |
| Enum | `ENUM(...)` | compact storage, self-documenting constraint |

### 1.3 Character Set & Collation

- **Every table**: `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
- **Timezone**: All `DATETIME` values stored in UTC. Timezone conversion happens at the API layer using the user's `notification_preferences.timezone`.

### 1.4 Common Timestamp Columns

Every table with temporal tracking uses:
```sql
created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '...'
updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '...'
```
Tables with immutable data (logs, prices, cache) omit `updated_at`.

---

## 2. Entity-Relationship Diagram

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                                    users                                          │
│  id | email | password_hash | nickname | avatar_url | locale | role | status      │
│  last_login_at | created_at | updated_at                                         │
└──────┬───────┬───────┬──────────┬──────────┬─────────────┬──────────┬────────────┘
       │       │       │          │          │             │          │
       │       │       │          │          │             │          │
  ┌────▼──┐ ┌──▼───┐ ┌─▼─────┐ ┌──▼────┐ ┌──▼────────┐ ┌──▼───────┐ ┌──▼──────────┐
  │user   │ │user  │ │payment│ │back   │ │notification│ │push     │ │watchlists   │
  │sess.  │ │subs. │ │orders │ │test   │ │preferences │ │device   │ │             │
  └───────┘ └──┬───┘ └──┬────┘ │jobs   │ └────────────┘ │tokens   │ └──┬──────────┘
               │        │      └──┬────┘                └─────────┘    │
               │        │         │                                     │
          ┌────▼──┐     │    ┌────▼──────┐                    ┌─────────▼──────┐
          │subscr.│     │    │backtest   │                    │watchlist_items │
          │tiers  │     │    │results    │                    └───────┬────────┘
          └──┬────┘     │    └───────────┘                            │
             │          │                                              │
  ┌──────────┼──────────┼──────────────┬──────────────┬───────────────┤
  │          │          │              │              │               │
  │     ┌────▼──┐  ┌────▼──────┐  ┌───▼──────┐  ┌───▼────────┐      │
  │     │indic. │  │ analysis  │  │alert     │  │notification│      │
  │     │presets│  │ configs   │  │rules     │  │inbox       │      │
  │     └──┬────┘  └────┬──────┘  └──┬──┬────┘  └────────────┘      │
  │        │            │            │  │                            │
  │   ┌────▼─────┐  ┌───▼────────┐   │  │                            │
  │   │preset    │  │analysis    │   │  │                      ┌─────▼─────┐
  │   │items     │  │signals ────┼───┘  │                      │stocks     │
  │   └──────────┘  └──┬─────────┘      │                      └──┬──┬──┬──┘
  │                    │                │                         │  │  │
  │               ┌────▼────────┐  ┌────▼──────┐  ┌──────────┐   │  │  │
  │               │ai analysis  │  │alert_logs │  │digest    │   │  │  │
  │               │results      │  └────┬──────┘  │queue     │   │  │  │
  │               └─────────────┘       │         └──────────┘   │  │  │
  │                                     │                         │  │  │
  │                               ┌─────▼────────┐   ┌───────────▼──▼──▼───┐
  └───────────────────────────────┤notification  │   │ stock_prices_daily   │
                                  │dlq           │   │                      │
                                  └──────────────┘   └──────────────────────┘

  ┌─────────────────┐        ┌──────────────────────────┐
  │stock_indicator  │────────│ indicator_cache          │
  │overrides        │        └──────────────────────────┘
  └─────────────────┘
```

### 2.1 Relationship Summary

| Parent | Child | Type | ON DELETE |
|---|---|---|---|
| `users` | `user_sessions` | 1:N | CASCADE |
| `users` | `user_subscriptions` | 1:N | CASCADE |
| `users` | `payment_orders` | 1:N | CASCADE |
| `users` | `backtest_jobs` | 1:N | CASCADE |
| `users` | `notification_preferences` | 1:1 | CASCADE |
| `users` | `push_device_tokens` | 1:N | CASCADE |
| `users` | `watchlists` | 1:N | CASCADE |
| `users` | `alert_rules` | 1:N | CASCADE |
| `users` | `alert_logs` | 1:N | CASCADE |
| `users` | `notification_inbox` | 1:N | CASCADE |
| `users` | `digest_queue` | 1:N | CASCADE |
| `subscription_tiers` | `user_subscriptions` | 1:N | RESTRICT |
| `subscription_tiers` | `payment_orders` | 1:N | RESTRICT |
| `subscription_tiers` | `indicator_presets` | 1:N | SET NULL |
| `stocks` | `stock_prices_daily` | 1:N | CASCADE |
| `stocks` | `analysis_configs` | 1:N | CASCADE |
| `stocks` | `analysis_signals` | 1:N | CASCADE |
| `stocks` | `watchlist_items` | 1:N | CASCADE |
| `stocks` | `alert_rules` | 1:N | CASCADE |
| `stocks` | `alert_logs` | 1:N | CASCADE |
| `stocks` | `stock_indicator_overrides` | 1:N | CASCADE |
| `stocks` | `indicator_cache` | 1:N | CASCADE |
| `stocks` | `backtest_jobs` | 1:N | RESTRICT |
| `indicator_presets` | `indicator_preset_items` | 1:N | CASCADE |
| `analysis_configs` | `analysis_signals` | 1:N | CASCADE |
| `analysis_configs` | `backtest_jobs` | 1:N | RESTRICT |
| `analysis_signals` | `ai_analysis_results` | 1:N | CASCADE |
| `analysis_signals` | `alert_logs` | 1:N | SET NULL |
| `backtest_jobs` | `backtest_results` | 1:1 | CASCADE |
| `alert_rules` | `alert_logs` | 1:N | SET NULL |
| `alert_logs` | `notification_inbox` | 1:1 | SET NULL |
| `alert_logs` | `notification_dlq` | 1:N | SET NULL |
| `watchlists` | `watchlist_items` | 1:N | CASCADE |

---

## 3. DDL — User & Authentication

### 3.1 `users`

```sql
CREATE TABLE users (
    id              BIGINT UNSIGNED AUTO_INCREMENT
                        COMMENT 'PK: 用户唯一标识 / Primary key',
    email           VARCHAR(255) NOT NULL
                        COMMENT '邮箱地址 (登录账号) / Login email address',
    password_hash   VARCHAR(255) NOT NULL
                        COMMENT 'bcrypt 哈希密码 / bcrypt hashed password',
    nickname        VARCHAR(100) DEFAULT NULL
                        COMMENT '用户昵称 / Display nickname',
    avatar_url      VARCHAR(500) DEFAULT NULL
                        COMMENT '头像 URL / Avatar image URL',
    locale          ENUM('en','zh') NOT NULL DEFAULT 'zh'
                        COMMENT '语言偏好: en=English, zh=简体中文 / Language preference',
    role            ENUM('user','admin') NOT NULL DEFAULT 'user'
                        COMMENT '角色: user=普通用户, admin=管理员 / User role',
    status          ENUM('active','disabled','banned') NOT NULL DEFAULT 'active'
                        COMMENT '状态: active=正常, disabled=禁用, banned=封禁 / Account status',
    last_login_at   DATETIME NULL DEFAULT NULL
                        COMMENT '最近登录时间 (UTC) / Last login timestamp',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                        COMMENT '注册时间 (UTC) / Registration timestamp',
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                        COMMENT '更新时间 (UTC) / Last update timestamp',
    PRIMARY KEY (id),
    UNIQUE KEY uk_email (email)
        COMMENT '邮箱唯一索引 / Unique email constraint',
    INDEX idx_status (status)
        COMMENT '按状态筛选用户 / Filter users by status',
    INDEX idx_created_at (created_at)
        COMMENT '按注册时间排序 / Order by registration date'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='用户表 / User accounts';
```

### 3.2 `user_sessions`

```sql
CREATE TABLE user_sessions (
    id              BIGINT UNSIGNED AUTO_INCREMENT
                        COMMENT 'PK: 会话唯一标识 / Primary key',
    user_id         BIGINT UNSIGNED NOT NULL
                        COMMENT 'FK: 关联 users.id / Reference to user',
    refresh_token   VARCHAR(500) NOT NULL
                        COMMENT 'JWT Refresh Token (SHA-256 hashed before storage)',
    device_info     VARCHAR(500) DEFAULT NULL
                        COMMENT '设备信息 (User-Agent) / Device fingerprint',
    ip_address      VARCHAR(45) DEFAULT NULL
                        COMMENT '登录 IP 地址 (支持 IPv6) / Login IP address',
    expires_at      DATETIME NOT NULL
                        COMMENT 'Token 过期时间 (UTC, 签发后 30 天) / Token expiry (30 days)',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                        COMMENT '会话创建时间 (UTC) / Session creation timestamp',
    PRIMARY KEY (id),
    UNIQUE KEY uk_refresh_token (refresh_token)
        COMMENT 'Refresh Token 唯一索引 / Unique token constraint',
    INDEX idx_user_id (user_id)
        COMMENT '按用户查询活跃会话 / Find sessions by user',
    INDEX idx_expires_at (expires_at)
        COMMENT '定期清理过期会话 / Periodic cleanup of expired sessions',
    CONSTRAINT fk_session_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='用户会话表 (JWT Refresh Token) / User sessions for JWT refresh tokens';
```

---

## 4. DDL — Subscription & Payment

### 4.1 `subscription_tiers`

```sql
CREATE TABLE subscription_tiers (
    id                      BIGINT UNSIGNED AUTO_INCREMENT
                                COMMENT 'PK: 会员等级唯一标识 / Primary key',
    name                    VARCHAR(100) NOT NULL
                                COMMENT '等级名称: Free/Basic/Pro / Tier display name',
    slug                    VARCHAR(50) NOT NULL
                                COMMENT 'URL 标识: free/basic/pro / URL-friendly slug',
    stripe_price_id_monthly VARCHAR(255) DEFAULT NULL
                                COMMENT 'Stripe 月度价格 ID (Free 档为 NULL) / Stripe monthly price ID',
    stripe_price_id_yearly  VARCHAR(255) DEFAULT NULL
                                COMMENT 'Stripe 年度价格 ID (Free 档为 NULL) / Stripe yearly price ID',
    price_monthly           DECIMAL(10,2) NOT NULL DEFAULT 0.00
                                COMMENT '月度价格 (USD) / Monthly price in USD',
    price_yearly            DECIMAL(10,2) NOT NULL DEFAULT 0.00
                                COMMENT '年度价格 (USD, 17% off vs monthly) / Yearly price in USD',
    features                JSON NOT NULL
                                COMMENT '权益配置 JSON / Feature flags and limits JSON',
    daily_api_limit         INT UNSIGNED NOT NULL DEFAULT 100
                                COMMENT '每日 API 调用上限 / Daily API call limit',
    watchlist_limit         INT UNSIGNED NOT NULL DEFAULT 5
                                COMMENT '自选股数量上限 (0=无限制) / Max watchlist items (0=unlimited)',
    alert_limit             INT UNSIGNED NOT NULL DEFAULT 0
                                COMMENT '提醒规则数量上限 / Max alert rules',
    ai_analysis_limit       INT UNSIGNED NOT NULL DEFAULT 0
                                COMMENT '每日 AI 分析次数上限 / Daily AI analysis quota',
    backtest_limit          INT UNSIGNED NOT NULL DEFAULT 0
                                COMMENT '每日回测次数上限 / Daily backtest quota',
    sort_order              INT NOT NULL DEFAULT 0
                                COMMENT '排序权重 (数值越小越靠前) / Sort ordering',
    is_active               TINYINT(1) NOT NULL DEFAULT 1
                                COMMENT '是否启用: 0=下架, 1=启用 / Active flag',
    created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                                COMMENT '创建时间 (UTC) / Creation timestamp',
    updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                                COMMENT '更新时间 (UTC) / Last update timestamp',
    PRIMARY KEY (id),
    UNIQUE KEY uk_slug (slug)
        COMMENT 'slug 唯一索引 / Unique slug constraint'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='会员等级配置表 / Subscription tier definitions';
```

### 4.2 `user_subscriptions`

```sql
CREATE TABLE user_subscriptions (
    id                      BIGINT UNSIGNED AUTO_INCREMENT
                                COMMENT 'PK: 订阅记录唯一标识 / Primary key',
    user_id                 BIGINT UNSIGNED NOT NULL
                                COMMENT 'FK: 关联 users.id / Reference to user',
    tier_id                 BIGINT UNSIGNED NOT NULL
                                COMMENT 'FK: 关联 subscription_tiers.id / Reference to tier',
    stripe_subscription_id  VARCHAR(255) DEFAULT NULL
                                COMMENT 'Stripe Subscription 对象 ID / Stripe subscription ID',
    status                  ENUM('active','past_due','cancelled','expired') NOT NULL DEFAULT 'active'
                                COMMENT '订阅状态: active=生效中, past_due=逾期, cancelled=已取消, expired=已过期',
    started_at              DATETIME NOT NULL
                                COMMENT '订阅生效时间 (UTC) / Subscription start time',
    expired_at              DATETIME NOT NULL
                                COMMENT '订阅到期时间 (UTC) / Subscription end time',
    grace_until             DATETIME DEFAULT NULL
                                COMMENT '宽限期截止 (到期+3天, UTC) / Grace period end (expiry + 3 days)',
    auto_renew              TINYINT(1) NOT NULL DEFAULT 0
                                COMMENT '是否自动续费: 0=否, 1=是 / Auto-renew flag',
    created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                                COMMENT '创建时间 (UTC) / Creation timestamp',
    updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                                COMMENT '更新时间 (UTC) / Last update timestamp',
    PRIMARY KEY (id),
    INDEX idx_user_id (user_id)
        COMMENT '查询用户当前订阅 / Find active subscription by user',
    INDEX idx_user_status (user_id, status)
        COMMENT '查询用户特定状态订阅 / Find subscription by user + status',
    INDEX idx_status_expired (status, expired_at)
        COMMENT '定时任务: 到期降级扫描 / Cron: scan expired subscriptions',
    INDEX idx_stripe_sub (stripe_subscription_id)
        COMMENT 'Stripe Webhook 回调匹配 / Stripe webhook lookup',
    CONSTRAINT fk_usub_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_usub_tier
        FOREIGN KEY (tier_id) REFERENCES subscription_tiers(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='用户订阅记录表 / User subscription history';
```

### 4.3 `payment_orders`

```sql
CREATE TABLE payment_orders (
    id                          BIGINT UNSIGNED AUTO_INCREMENT
                                    COMMENT 'PK: 支付订单唯一标识 / Primary key',
    user_id                     BIGINT UNSIGNED NOT NULL
                                    COMMENT 'FK: 关联 users.id / Reference to user',
    tier_id                     BIGINT UNSIGNED NOT NULL
                                    COMMENT 'FK: 关联 subscription_tiers.id / Reference to tier',
    payment_provider            ENUM('stripe') NOT NULL DEFAULT 'stripe'
                                    COMMENT '支付渠道: Phase 1 仅 Stripe / Payment provider',
    provider_session_id         VARCHAR(255) DEFAULT NULL
                                    COMMENT 'Stripe Checkout Session ID / Stripe session ID',
    provider_payment_intent_id  VARCHAR(255) DEFAULT NULL
                                    COMMENT 'Stripe PaymentIntent ID / Stripe payment intent ID',
    amount                      DECIMAL(10,2) NOT NULL
                                    COMMENT '实付金额 (USD) / Actual amount paid',
    currency                    VARCHAR(10) NOT NULL DEFAULT 'USD'
                                    COMMENT '币种 / Payment currency',
    period                      ENUM('monthly','yearly') NOT NULL
                                    COMMENT '购买周期: monthly=月付, yearly=年付 / Billing period',
    status                      ENUM('pending','paid','failed','refunded','expired') NOT NULL DEFAULT 'pending'
                                    COMMENT '支付状态: pending=待付, paid=已付, failed=失败, refunded=已退, expired=过期',
    idempotency_key             VARCHAR(255) DEFAULT NULL
                                    COMMENT '幂等键 (UUID v4, 防重复支付) / Idempotency key for dedup',
    paid_at                     DATETIME DEFAULT NULL
                                    COMMENT '支付完成时间 (UTC) / Payment completion timestamp',
    created_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    COMMENT '创建时间 (UTC) / Creation timestamp',
    updated_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                                    COMMENT '更新时间 (UTC) / Last update timestamp',
    PRIMARY KEY (id),
    UNIQUE KEY uk_idempotency (idempotency_key)
        COMMENT '幂等键唯一索引 / Deduplication key',
    INDEX idx_user_id (user_id)
        COMMENT '查询用户支付历史 / Find payment history by user',
    INDEX idx_status (status)
        COMMENT '按支付状态筛选 / Filter by payment status',
    INDEX idx_created_at (created_at)
        COMMENT '收入报表按时间排序 / Revenue reports by date',
    CONSTRAINT fk_pay_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_pay_tier
        FOREIGN KEY (tier_id) REFERENCES subscription_tiers(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='支付订单表 / Payment order records';
```

---

## 5. DDL — Stocks & Market Data

### 5.1 `stocks`

```sql
CREATE TABLE stocks (
    id              BIGINT UNSIGNED AUTO_INCREMENT
                        COMMENT 'PK: 标的唯一标识 / Primary key',
    symbol          VARCHAR(20) NOT NULL
                        COMMENT '股票代码 (大写, 如 SPY, QQQ, TQQQ) / Ticker symbol (uppercase)',
    name            VARCHAR(200) NOT NULL
                        COMMENT '中文名称 / Chinese display name',
    type            ENUM('ETF','Stock','Index') NOT NULL
                        COMMENT '标的类型: ETF/Stock/Index / Asset type',
    subtype         VARCHAR(50) DEFAULT NULL
                        COMMENT '子类型: leveraged, inverse, broad_market, sector, bond, commodity / Subtype',
    market          ENUM('US') NOT NULL DEFAULT 'US'
                        COMMENT '交易市场 (Phase 1 仅美股) / Trading market',
    sector          VARCHAR(100) DEFAULT NULL
                        COMMENT '行业板块 (如 Technology, Healthcare) / Sector classification',
    is_active       TINYINT(1) NOT NULL DEFAULT 1
                        COMMENT '是否启用: 0=下架, 1=正常 / Active flag',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                        COMMENT '创建时间 (UTC) / Creation timestamp',
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                        COMMENT '更新时间 (UTC) / Last update timestamp',
    PRIMARY KEY (id),
    UNIQUE KEY uk_symbol (symbol)
        COMMENT '股票代码唯一索引 / Unique symbol constraint',
    INDEX idx_type_active (type, is_active)
        COMMENT '按类型+状态筛选标的 / Filter stocks by type and active status',
    INDEX idx_sector (sector)
        COMMENT '按行业板块筛选 / Filter by sector'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='股票/ETF 标的基础信息表 / Stock and ETF metadata';
```

### 5.2 `stock_prices_daily`

> **Growth estimate**: ~250 trading days/year × N stocks. With 500 tracked stocks, ~125K rows/year.
> **Partitioning**: By `YEAR(trade_date)` — see [Section 13](#13-partitioning-strategy).

```sql
CREATE TABLE stock_prices_daily (
    id              BIGINT UNSIGNED AUTO_INCREMENT
                        COMMENT 'PK: 行情记录唯一标识 / Primary key',
    stock_id        BIGINT UNSIGNED NOT NULL
                        COMMENT 'FK: 关联 stocks.id / Reference to stock',
    trade_date      DATE NOT NULL
                        COMMENT '交易日期 (美国市场日期) / Trading date (US market date)',
    open            DECIMAL(12,4) NOT NULL
                        COMMENT '开盘价 / Open price',
    high            DECIMAL(12,4) NOT NULL
                        COMMENT '最高价 / High price',
    low             DECIMAL(12,4) NOT NULL
                        COMMENT '最低价 / Low price',
    close           DECIMAL(12,4) NOT NULL
                        COMMENT '收盘价 / Close price',
    volume          BIGINT UNSIGNED NOT NULL
                        COMMENT '成交量 (股) / Trading volume',
    data_source     VARCHAR(50) NOT NULL DEFAULT 'yfinance'
                        COMMENT '数据来源: yfinance / finnhub / polygon / tiingo / Data source tracer',
    PRIMARY KEY (id, trade_date),
    UNIQUE KEY uk_stock_date (stock_id, trade_date)
        COMMENT '同一标的+日期唯一 / Unique stock per trading day',
    INDEX idx_stock_date (stock_id, trade_date)
        COMMENT '覆盖索引: K线查询 stock_id=? ORDER BY trade_date DESC / Covering index for K-line queries',
    INDEX idx_trade_date (trade_date)
        COMMENT '按交易日期批量操作 / Batch operations by date',
    CONSTRAINT fk_spd_stock
        FOREIGN KEY (stock_id) REFERENCES stocks(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='股票日线行情表 / Daily OHLCV price data'
  PARTITION BY RANGE (YEAR(trade_date)) (
      PARTITION p_pre2020 VALUES LESS THAN (2020),
      PARTITION p2020 VALUES LESS THAN (2021),
      PARTITION p2021 VALUES LESS THAN (2022),
      PARTITION p2022 VALUES LESS THAN (2023),
      PARTITION p2023 VALUES LESS THAN (2024),
      PARTITION p2024 VALUES LESS THAN (2025),
      PARTITION p2025 VALUES LESS THAN (2026),
      PARTITION p2026 VALUES LESS THAN (2027),
      PARTITION p2027 VALUES LESS THAN (2028),
      PARTITION p2028 VALUES LESS THAN (2029),
      PARTITION p_future VALUES LESS THAN MAXVALUE
  );
```

> **MySQL 8.0 partitioning note**: All columns used in the partitioning expression must be part of every unique key (including the primary key). Hence `PRIMARY KEY (id, trade_date)` — the composite PK satisfies this requirement.

---

## 6. DDL — Indicator System

### 6.1 `indicator_presets`

```sql
CREATE TABLE indicator_presets (
    id              BIGINT UNSIGNED AUTO_INCREMENT
                        COMMENT 'PK: 预设唯一标识 / Primary key',
    name            VARCHAR(100) NOT NULL
                        COMMENT '预设名称 (如 "均线标准策略") / Preset display name',
    description     TEXT DEFAULT NULL
                        COMMENT '预设描述 (Markdown) / Preset description in Markdown',
    tier_id         BIGINT UNSIGNED DEFAULT NULL
                        COMMENT 'FK: 最低会员等级要求 (NULL=全等级可用) / Minimum tier requirement',
    is_system       TINYINT(1) NOT NULL DEFAULT 0
                        COMMENT '是否系统预设: 0=用户自定义, 1=系统内置 (不可删除) / System preset flag',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                        COMMENT '创建时间 (UTC) / Creation timestamp',
    PRIMARY KEY (id),
    INDEX idx_tier_id (tier_id)
        COMMENT '按会员等级筛选可用预设 / Filter presets by tier',
    CONSTRAINT fk_ip_tier
        FOREIGN KEY (tier_id) REFERENCES subscription_tiers(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='指标预设配置表 / Indicator preset bundles';
```

### 6.2 `indicator_preset_items`

```sql
CREATE TABLE indicator_preset_items (
    id              BIGINT UNSIGNED AUTO_INCREMENT
                        COMMENT 'PK: 预设项唯一标识 / Primary key',
    preset_id       BIGINT UNSIGNED NOT NULL
                        COMMENT 'FK: 关联 indicator_presets.id / Reference to preset',
    indicator_name  VARCHAR(100) NOT NULL
                        COMMENT '指标名称: sma, ema, rsi, macd, bb, etc. / Indicator function name',
    params          JSON NOT NULL
                        COMMENT '指标参数 JSON: {"length": 20, "source": "close"} / Indicator parameters',
    sort_order      INT NOT NULL DEFAULT 0
                        COMMENT '显示排序 / Display ordering',
    PRIMARY KEY (id),
    INDEX idx_preset_id (preset_id)
        COMMENT '查询预设的所有指标项 / Load all items for a preset',
    CONSTRAINT fk_ipi_preset
        FOREIGN KEY (preset_id) REFERENCES indicator_presets(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='指标预设明细表 / Individual indicators within a preset';
```

### 6.3 `stock_indicator_overrides`

```sql
CREATE TABLE stock_indicator_overrides (
    id              BIGINT UNSIGNED AUTO_INCREMENT
                        COMMENT 'PK: 覆盖记录唯一标识 / Primary key',
    stock_id        BIGINT UNSIGNED NOT NULL
                        COMMENT 'FK: 关联 stocks.id / Reference to stock',
    indicator_name  VARCHAR(100) NOT NULL
                        COMMENT '指标名称 / Indicator function name',
    params          JSON NOT NULL
                        COMMENT '覆盖参数 JSON / Override parameters',
    PRIMARY KEY (id),
    UNIQUE KEY uk_stock_indicator (stock_id, indicator_name)
        COMMENT '同一指标对同一标的仅一份覆盖 / One override per stock per indicator',
    CONSTRAINT fk_sio_stock
        FOREIGN KEY (stock_id) REFERENCES stocks(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='标的级指标参数覆盖表 (5级优先级 Layer 2) / Per-stock indicator parameter overrides';
```

### 6.4 `indicator_cache`

> **Retention**: Computed values invalidated after 24 hours. Cleanup via APScheduler job or cron.

```sql
CREATE TABLE indicator_cache (
    id              BIGINT UNSIGNED AUTO_INCREMENT
                        COMMENT 'PK: 缓存记录唯一标识 / Primary key',
    stock_id        BIGINT UNSIGNED NOT NULL
                        COMMENT 'FK: 关联 stocks.id / Reference to stock',
    indicator_name  VARCHAR(100) NOT NULL
                        COMMENT '指标名称 / Indicator function name',
    params_hash     VARCHAR(64) NOT NULL
                        COMMENT '参数 SHA-256 哈希 / SHA-256 hash of sorted params JSON',
    timeframe       VARCHAR(10) NOT NULL DEFAULT '1d'
                        COMMENT '时间框架: 1d, 1w, 1M / Aggregation timeframe',
    data            JSON NOT NULL
                        COMMENT '指标计算缓存结果: [{"date":"...","value":...},...] / Precomputed indicator series',
    computed_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                        COMMENT '计算完成时间 (UTC) / Computation timestamp',
    PRIMARY KEY (id),
    UNIQUE KEY uk_cache_key (stock_id, indicator_name, params_hash, timeframe)
        COMMENT '缓存去重键 (stock + indicator + params + timeframe) / Cache dedup key',
    INDEX idx_computed_at (computed_at)
        COMMENT '按计算时间清理过期缓存 / Evict stale cache entries',
    CONSTRAINT fk_ic_stock
        FOREIGN KEY (stock_id) REFERENCES stocks(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='技术指标预计算缓存表 / Precomputed indicator value cache (TTL 24h)';
```

---

## 7. DDL — Analysis Engine

### 7.1 `analysis_configs`

```sql
CREATE TABLE analysis_configs (
    id              BIGINT UNSIGNED AUTO_INCREMENT
                        COMMENT 'PK: 分析配置唯一标识 / Primary key',
    stock_id        BIGINT UNSIGNED NOT NULL
                        COMMENT 'FK: 关联 stocks.id / Reference to stock',
    name            VARCHAR(100) NOT NULL
                        COMMENT '配置名称 (如 "SPY 均线交叉策略") / Config display name',
    strategy_type   ENUM('ma_cross','multi_indicator','ml_enhanced') NOT NULL DEFAULT 'ma_cross'
                        COMMENT '策略类型: ma_cross=均线交叉, multi_indicator=多指标综合, ml_enhanced=ML增强',
    params          JSON NOT NULL
                        COMMENT '策略参数 JSON (灵活替代固定列) / Flexible strategy parameters',
    confirm_bars    INT UNSIGNED NOT NULL DEFAULT 0
                        COMMENT '确认K线数 (交叉后需连续N根K线确认) / Confirmation bars after crossover',
    volume_confirm  TINYINT(1) NOT NULL DEFAULT 0
                        COMMENT '是否启用成交量确认: 0=否, 1=是 / Volume confirmation toggle',
    is_active       TINYINT(1) NOT NULL DEFAULT 1
                        COMMENT '是否启用: 0=停用, 1=启用 / Active flag',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                        COMMENT '创建时间 (UTC) / Creation timestamp',
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                        COMMENT '更新时间 (UTC) / Last update timestamp',
    PRIMARY KEY (id),
    INDEX idx_stock_id (stock_id)
        COMMENT '查询标的的所有分析配置 / List configs for a stock',
    INDEX idx_stock_active (stock_id, is_active)
        COMMENT '定时任务: 扫描活跃配置生成信号 / Cron: scan active configs',
    INDEX idx_strategy_type (strategy_type)
        COMMENT '按策略类型筛选 / Filter by strategy type',
    CONSTRAINT fk_ac_stock
        FOREIGN KEY (stock_id) REFERENCES stocks(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='分析策略配置表 / Analysis strategy configurations';
```

### 7.2 `analysis_signals`

> **Growth estimate**: ~1 signal per stock per 20 trading days × N stocks × M configs. With 500 stocks and 2 configs each, ~12,500 signals/year.
> **Active signals query** is the primary access pattern: `stock_id + is_active + triggered_date`.

```sql
CREATE TABLE analysis_signals (
    id              BIGINT UNSIGNED AUTO_INCREMENT
                        COMMENT 'PK: 信号唯一标识 / Primary key',
    stock_id        BIGINT UNSIGNED NOT NULL
                        COMMENT 'FK: 关联 stocks.id / Reference to stock',
    config_id       BIGINT UNSIGNED NOT NULL
                        COMMENT 'FK: 关联 analysis_configs.id / Reference to config',
    signal_type     ENUM('golden_cross','death_cross','bullish_alignment','bearish_alignment','composite_buy','composite_sell') NOT NULL
                        COMMENT '信号类型 / Signal type classification',
    strength        ENUM('weak','normal','strong') NOT NULL DEFAULT 'normal'
                        COMMENT '信号强度: weak=弱, normal=一般, strong=强 / Signal strength',
    confidence      DECIMAL(4,3) DEFAULT NULL
                        COMMENT '置信度 (0.000-1.000) / Confidence score, higher = more reliable',
    signal_details  JSON NOT NULL
                        COMMENT '信号详情 JSON (触发时的指标值、价格、条件等) / Signal trigger details',
    price           DECIMAL(12,4) NOT NULL
                        COMMENT '触发时的收盘价 / Close price at trigger time',
    triggered_date  DATE NOT NULL
                        COMMENT '信号触发日期 (美国市场日期) / Signal trigger date',
    is_active       TINYINT(1) NOT NULL DEFAULT 1
                        COMMENT '信号是否仍有效: 0=已过期/被whipsaw, 1=有效 / Signal still valid',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                        COMMENT '创建时间 (UTC) / Creation timestamp',
    PRIMARY KEY (id),
    INDEX idx_stock_active_date (stock_id, is_active, triggered_date)
        COMMENT '覆盖索引: 查询某标的活跃信号按日期排序 (最高频查询) / Primary query: active signals for stock',
    INDEX idx_config_id (config_id)
        COMMENT '按策略配置查询信号 / Filter signals by config',
    INDEX idx_signal_type (signal_type)
        COMMENT '按信号类型统计 / Aggregate by signal type',
    INDEX idx_triggered_date (triggered_date)
        COMMENT '按触发日期过滤 / Filter by trigger date',
    CONSTRAINT fk_as_stock
        FOREIGN KEY (stock_id) REFERENCES stocks(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_as_config
        FOREIGN KEY (config_id) REFERENCES analysis_configs(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='分析信号表 / Technical analysis signal records';
```

---

## 8. DDL — AI Analysis

### 8.1 `ai_analysis_results`

```sql
CREATE TABLE ai_analysis_results (
    id                  BIGINT UNSIGNED AUTO_INCREMENT
                            COMMENT 'PK: AI 分析结果唯一标识 / Primary key',
    signal_id           BIGINT UNSIGNED NOT NULL
                            COMMENT 'FK: 关联 analysis_signals.id / Reference to signal',
    model_provider      VARCHAR(50) NOT NULL
                            COMMENT '模型提供商: deepseek, openai, anthropic, ollama / LLM provider',
    model_name          VARCHAR(100) NOT NULL
                            COMMENT '模型名称: deepseek-chat, claude-haiku-4-5, gpt-5.4-mini / Model identifier',
    prompt_hash         VARCHAR(64) NOT NULL
                            COMMENT 'Prompt SHA-256 哈希 (用于缓存去重) / SHA-256 of prompt for dedup',
    prompt_tokens       INT UNSIGNED NOT NULL DEFAULT 0
                            COMMENT '输入 Token 数 / Prompt token count',
    completion_tokens   INT UNSIGNED NOT NULL DEFAULT 0
                            COMMENT '输出 Token 数 / Completion token count',
    total_cost          DECIMAL(10,6) NOT NULL DEFAULT 0.000000
                            COMMENT '本次分析费用 (USD) / Total cost in USD',
    analysis_json       JSON NOT NULL
                            COMMENT '结构化分析结果 JSON (summary, why_buy, risks, stop_loss, targets, confidence)',
    generated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                            COMMENT '生成时间 (UTC) / Generation timestamp',
    PRIMARY KEY (id),
    INDEX idx_signal_id (signal_id)
        COMMENT '查询信号的 AI 分析结果 / Get AI analysis for a signal',
    INDEX idx_model_provider (model_provider, model_name)
        COMMENT '按模型统计用量与成本 / Aggregate usage and cost by model',
    INDEX idx_generated_at (generated_at)
        COMMENT '成本报表按时间范围 / Cost reports by date range',
    CONSTRAINT fk_aiar_signal
        FOREIGN KEY (signal_id) REFERENCES analysis_signals(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='AI 分析结果表 / LLM-generated analysis results for signals';
```

---

## 9. DDL — Backtest

### 9.1 `backtest_jobs`

```sql
CREATE TABLE backtest_jobs (
    id              BIGINT UNSIGNED AUTO_INCREMENT
                        COMMENT 'PK: 回测任务唯一标识 / Primary key',
    user_id         BIGINT UNSIGNED NOT NULL
                        COMMENT 'FK: 关联 users.id / Reference to user',
    stock_id        BIGINT UNSIGNED NOT NULL
                        COMMENT 'FK: 关联 stocks.id / Reference to stock',
    config_id       BIGINT UNSIGNED NOT NULL
                        COMMENT 'FK: 关联 analysis_configs.id / Reference to strategy config',
    status          ENUM('queued','running','completed','failed') NOT NULL DEFAULT 'queued'
                        COMMENT '任务状态: queued=排队, running=运行中, completed=完成, failed=失败',
    params          JSON NOT NULL
                        COMMENT '回测参数 JSON (时间范围, 初始资金, 滑点, 手续费等) / Backtest parameters',
    started_at      DATETIME DEFAULT NULL
                        COMMENT '开始执行时间 (UTC) / Execution start timestamp',
    completed_at    DATETIME DEFAULT NULL
                        COMMENT '完成时间 (UTC) / Completion timestamp',
    error_message   TEXT DEFAULT NULL
                        COMMENT '失败原因 / Error message if failed',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                        COMMENT '创建时间 (UTC) / Creation timestamp',
    PRIMARY KEY (id),
    INDEX idx_user_id (user_id)
        COMMENT '查询用户回测历史 / List backtest jobs by user',
    INDEX idx_user_status (user_id, status)
        COMMENT '查询用户特定状态回测 / Filter jobs by user + status',
    INDEX idx_status (status)
        COMMENT 'Worker 拉取待执行任务 / Worker pulls queued jobs',
    INDEX idx_created_at (created_at)
        COMMENT '按创建时间排序 / Order by creation date',
    CONSTRAINT fk_bj_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_bj_stock
        FOREIGN KEY (stock_id) REFERENCES stocks(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_bj_config
        FOREIGN KEY (config_id) REFERENCES analysis_configs(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='回测任务表 / Backtest job queue and execution records';
```

### 9.2 `backtest_results`

```sql
CREATE TABLE backtest_results (
    id                  BIGINT UNSIGNED AUTO_INCREMENT
                            COMMENT 'PK: 回测结果唯一标识 / Primary key',
    job_id              BIGINT UNSIGNED NOT NULL
                            COMMENT 'FK: 关联 backtest_jobs.id (1:1) / Reference to backtest job',
    total_return        DECIMAL(8,4) DEFAULT NULL
                            COMMENT '总收益率 (如 0.2530 = 25.30%) / Total return',
    cagr                DECIMAL(8,4) DEFAULT NULL
                            COMMENT '年化复合增长率 / Compound annual growth rate',
    max_drawdown        DECIMAL(8,4) DEFAULT NULL
                            COMMENT '最大回撤 (如 -0.1850 = -18.50%) / Maximum drawdown',
    sharpe_ratio        DECIMAL(8,4) DEFAULT NULL
                            COMMENT '夏普比率 (>1.0 good) / Sharpe ratio',
    sortino_ratio       DECIMAL(8,4) DEFAULT NULL
                            COMMENT '索提诺比率 (>1.5 good) / Sortino ratio',
    calmar_ratio        DECIMAL(8,4) DEFAULT NULL
                            COMMENT '卡玛比率 (CAGR/MDD) / Calmar ratio',
    win_rate            DECIMAL(8,4) DEFAULT NULL
                            COMMENT '胜率 (>0.40 acceptable) / Win rate',
    profit_factor       DECIMAL(8,4) DEFAULT NULL
                            COMMENT '盈亏比 (>1.5 good) / Profit factor',
    num_trades          INT DEFAULT NULL
                            COMMENT '交易次数 / Number of trades',
    avg_holding_days    DECIMAL(6,1) DEFAULT NULL
                            COMMENT '平均持仓天数 / Average holding period in days',
    benchmark_return    DECIMAL(8,4) DEFAULT NULL
                            COMMENT '同期基准收益率 (SPY/QQQ Buy & Hold) / Benchmark return over same period',
    equity_curve        JSON NOT NULL
                            COMMENT '权益曲线: [{"date":"...","equity":...},...] / Equity curve time series',
    drawdown_curve      JSON DEFAULT NULL
                            COMMENT '回撤曲线: [{"date":"...","drawdown":...},...] / Drawdown curve time series',
    monthly_returns     JSON DEFAULT NULL
                            COMMENT '月度收益热力图数据 / Monthly returns heatmap data',
    trade_log           JSON DEFAULT NULL
                            COMMENT '完整交易日志: [{entry_date, exit_date, return, ...},...] / Full trade log',
    report_html         MEDIUMTEXT DEFAULT NULL
                            COMMENT 'QuantStats 一键 HTML tear sheet / QuantStats generated HTML report',
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                            COMMENT '创建时间 (UTC) / Creation timestamp',
    PRIMARY KEY (id),
    UNIQUE KEY uk_job_id (job_id)
        COMMENT '一个回测任务仅一份结果 / One result per job',
    CONSTRAINT fk_br_job
        FOREIGN KEY (job_id) REFERENCES backtest_jobs(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='回测结果表 / Backtest result metrics and report data';
```

---

## 10. DDL — Notification System

### 10.1 `notification_preferences`

```sql
CREATE TABLE notification_preferences (
    id              BIGINT UNSIGNED AUTO_INCREMENT
                        COMMENT 'PK: 偏好记录唯一标识 / Primary key',
    user_id         BIGINT UNSIGNED NOT NULL
                        COMMENT 'FK: 关联 users.id (1:1) / Reference to user',
    email_enabled   TINYINT(1) NOT NULL DEFAULT 1
                        COMMENT '是否启用邮件通知 / Email notifications enabled',
    push_enabled    TINYINT(1) NOT NULL DEFAULT 0
                        COMMENT '是否启用 Web Push 通知 / Push notifications enabled',
    inapp_enabled   TINYINT(1) NOT NULL DEFAULT 1
                        COMMENT '是否启用站内通知 / In-app notifications enabled',
    sms_enabled     TINYINT(1) NOT NULL DEFAULT 0
                        COMMENT '是否启用短信通知 (Phase 7+) / SMS notifications enabled',
    digest_mode     ENUM('realtime','daily','weekly') NOT NULL DEFAULT 'realtime'
                        COMMENT '通知摘要模式: realtime=实时, daily=每日摘要, weekly=每周摘要 / Digest frequency',
    quiet_start     TIME DEFAULT NULL
                        COMMENT '免打扰开始时间 (用户本地时区) / Do-not-disturb start time',
    quiet_end       TIME DEFAULT NULL
                        COMMENT '免打扰结束时间 (用户本地时区) / Do-not-disturb end time',
    timezone        VARCHAR(50) NOT NULL DEFAULT 'America/New_York'
                        COMMENT '用户时区 (如 America/New_York, Asia/Shanghai) / User timezone',
    PRIMARY KEY (id),
    UNIQUE KEY uk_user_id (user_id)
        COMMENT '一个用户仅一份通知偏好 / One preference row per user',
    CONSTRAINT fk_np_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='用户通知偏好表 / Per-user notification channel preferences';
```

### 10.2 `alert_rules`

```sql
CREATE TABLE alert_rules (
    id              BIGINT UNSIGNED AUTO_INCREMENT
                        COMMENT 'PK: 提醒规则唯一标识 / Primary key',
    user_id         BIGINT UNSIGNED NOT NULL
                        COMMENT 'FK: 关联 users.id / Reference to user',
    stock_id        BIGINT UNSIGNED NOT NULL
                        COMMENT 'FK: 关联 stocks.id / Reference to stock',
    alert_type      ENUM('golden_cross','death_cross','any_signal','price_above','price_below','risk_change') NOT NULL
                        COMMENT '提醒类型: golden_cross=金叉, death_cross=死叉, any_signal=任意信号, price_above=价格上破, price_below=价格下破, risk_change=风险等级变化',
    threshold       DECIMAL(12,4) DEFAULT NULL
                        COMMENT '价格阈值 (仅 price_above/price_below 使用) / Price threshold for price alerts',
    channels        JSON NOT NULL
                        COMMENT '通知渠道: ["email","push","inapp"] / Notification channels array',
    is_active       TINYINT(1) NOT NULL DEFAULT 1
                        COMMENT '是否启用: 0=暂停, 1=启用 / Active flag',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                        COMMENT '创建时间 (UTC) / Creation timestamp',
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                        COMMENT '更新时间 (UTC) / Last update timestamp',
    PRIMARY KEY (id),
    INDEX idx_user_active (user_id, is_active)
        COMMENT '查询用户启用的提醒规则 / List active rules for user',
    INDEX idx_stock_id (stock_id)
        COMMENT '按标的查找关联规则 / Find rules by stock',
    CONSTRAINT fk_ar_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ar_stock
        FOREIGN KEY (stock_id) REFERENCES stocks(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='提醒规则表 / User alert rule definitions';
```

### 10.3 `alert_logs`

> **Growth estimate**: Up to N users × M alerts × frequency. With 10K active users and 5 alerts each triggering weekly, ~2.6M rows/year.
> **Partitioning**: By month (`TO_DAYS(sent_at)`) — see [Section 13](#13-partitioning-strategy).

```sql
CREATE TABLE alert_logs (
    id                  BIGINT UNSIGNED AUTO_INCREMENT
                            COMMENT 'PK: 通知发送日志唯一标识 / Primary key',
    alert_rule_id       BIGINT UNSIGNED DEFAULT NULL
                            COMMENT 'FK: 关联 alert_rules.id (规则删除后保留日志) / Reference to alert rule',
    user_id             BIGINT UNSIGNED NOT NULL
                            COMMENT 'FK: 关联 users.id / Reference to user',
    stock_id            BIGINT UNSIGNED NOT NULL
                            COMMENT 'FK: 关联 stocks.id / Reference to stock',
    signal_id           BIGINT UNSIGNED DEFAULT NULL
                            COMMENT 'FK: 关联 analysis_signals.id (信号删除后保留日志) / Reference to triggering signal',
    channel             ENUM('email','push','inapp','sms') NOT NULL
                            COMMENT '发送渠道: email=邮件, push=Web Push, inapp=站内, sms=短信 / Delivery channel',
    template_key        VARCHAR(100) NOT NULL
                            COMMENT '模板标识: golden_cross_zh, death_cross_en, etc. / Notification template key',
    message             TEXT NOT NULL
                            COMMENT '最终渲染的消息内容 / Rendered message content',
    status              ENUM('sent','failed','bounced','clicked') NOT NULL DEFAULT 'sent'
                            COMMENT '发送状态: sent=已发送, failed=失败, bounced=退信, clicked=已点击',
    provider_message_id VARCHAR(255) DEFAULT NULL
                            COMMENT '渠道服务商消息 ID (如 Resend email ID) / Provider message identifier',
    error_message       VARCHAR(1000) DEFAULT NULL
                            COMMENT '失败原因 (如有) / Error message if failed',
    sent_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                            COMMENT '发送时间 (UTC) / Send timestamp',
    PRIMARY KEY (id, sent_at),
    INDEX idx_user_sent (user_id, sent_at)
        COMMENT '查询用户近期通知 / Recent notifications for a user',
    INDEX idx_alert_rule_id (alert_rule_id)
        COMMENT '按规则统计通知量 / Aggregate by alert rule',
    INDEX idx_signal_id (signal_id)
        COMMENT '查询信号关联的通知 / Notifications for a signal',
    INDEX idx_status (status)
        COMMENT '失败重试筛选 / Filter by delivery status',
    INDEX idx_sent_at (sent_at)
        COMMENT '按时间范围统计 / Aggregate by time range',
    CONSTRAINT fk_al_rule
        FOREIGN KEY (alert_rule_id) REFERENCES alert_rules(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_al_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_al_stock
        FOREIGN KEY (stock_id) REFERENCES stocks(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_al_signal
        FOREIGN KEY (signal_id) REFERENCES analysis_signals(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='通知发送日志表 / Notification delivery audit log'
  PARTITION BY RANGE (TO_DAYS(sent_at)) (
      PARTITION p202601 VALUES LESS THAN (TO_DAYS('2026-02-01')),
      PARTITION p202602 VALUES LESS THAN (TO_DAYS('2026-03-01')),
      PARTITION p202603 VALUES LESS THAN (TO_DAYS('2026-04-01')),
      PARTITION p202604 VALUES LESS THAN (TO_DAYS('2026-05-01')),
      PARTITION p202605 VALUES LESS THAN (TO_DAYS('2026-06-01')),
      PARTITION p202606 VALUES LESS THAN (TO_DAYS('2026-07-01')),
      PARTITION p202607 VALUES LESS THAN (TO_DAYS('2026-08-01')),
      PARTITION p202608 VALUES LESS THAN (TO_DAYS('2026-09-01')),
      PARTITION p202609 VALUES LESS THAN (TO_DAYS('2026-10-01')),
      PARTITION p202610 VALUES LESS THAN (TO_DAYS('2026-11-01')),
      PARTITION p202611 VALUES LESS THAN (TO_DAYS('2026-12-01')),
      PARTITION p202612 VALUES LESS THAN (TO_DAYS('2027-01-01')),
      PARTITION p2027q1  VALUES LESS THAN (TO_DAYS('2027-04-01')),
      PARTITION p2027q2  VALUES LESS THAN (TO_DAYS('2027-07-01')),
      PARTITION p2027q3  VALUES LESS THAN (TO_DAYS('2027-10-01')),
      PARTITION p_future VALUES LESS THAN MAXVALUE
  );
```

> **Partition maintenance note**: New monthly partitions must be created proactively via a scheduled job. See [Section 13.3](#133-partition-maintenance-automation).

### 10.4 `notification_inbox`

> **Retention**: Auto-delete records older than 30 days (APScheduler job).

```sql
CREATE TABLE notification_inbox (
    id              BIGINT UNSIGNED AUTO_INCREMENT
                        COMMENT 'PK: 站内通知唯一标识 / Primary key',
    user_id         BIGINT UNSIGNED NOT NULL
                        COMMENT 'FK: 关联 users.id / Reference to user',
    alert_log_id    BIGINT UNSIGNED DEFAULT NULL
                        COMMENT 'FK: 关联 alert_logs.id (日志删除后保留通知) / Reference to alert log',
    title           VARCHAR(200) NOT NULL
                        COMMENT '通知标题 / Notification title',
    body            TEXT NOT NULL
                        COMMENT '通知正文 / Notification body',
    is_read         TINYINT(1) NOT NULL DEFAULT 0
                        COMMENT '是否已读: 0=未读, 1=已读 / Read status',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                        COMMENT '创建时间 (UTC) / Creation timestamp',
    PRIMARY KEY (id),
    INDEX idx_user_unread (user_id, is_read, created_at)
        COMMENT '覆盖索引: 查询用户未读通知 (最高频查询) / Primary query: unread inbox for user',
    INDEX idx_created_at (created_at)
        COMMENT '定期清理: 删除 30 天前的通知 / Cron: purge old notifications',
    CONSTRAINT fk_ni_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ni_alert_log
        FOREIGN KEY (alert_log_id) REFERENCES alert_logs(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='站内通知收件箱 / In-app notification inbox (auto-delete 30d)';
```

### 10.5 `push_device_tokens`

```sql
CREATE TABLE push_device_tokens (
    id              BIGINT UNSIGNED AUTO_INCREMENT
                        COMMENT 'PK: 设备记录唯一标识 / Primary key',
    user_id         BIGINT UNSIGNED NOT NULL
                        COMMENT 'FK: 关联 users.id / Reference to user',
    platform        ENUM('web','ios','android') NOT NULL DEFAULT 'web'
                        COMMENT '设备平台: web=浏览器, ios=iPhone, android=安卓 / Device platform',
    token           VARCHAR(500) NOT NULL
                        COMMENT 'OneSignal Player ID / Push notification device token',
    is_active       TINYINT(1) NOT NULL DEFAULT 1
                        COMMENT '是否有效: 0=已失效, 1=有效 / Token validity',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                        COMMENT '创建时间 (UTC) / Creation timestamp',
    PRIMARY KEY (id),
    UNIQUE KEY uk_user_device (user_id, token)
        COMMENT '同用户同设备仅注册一次 / Deduplicate token per user',
    INDEX idx_user_active (user_id, is_active)
        COMMENT '查询用户有效设备 / Active devices for user',
    CONSTRAINT fk_pdt_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='推送设备注册表 / Push notification device token registry';
```

### 10.6 `digest_queue`

```sql
CREATE TABLE digest_queue (
    id              BIGINT UNSIGNED AUTO_INCREMENT
                        COMMENT 'PK: 摘要记录唯一标识 / Primary key',
    user_id         BIGINT UNSIGNED NOT NULL
                        COMMENT 'FK: 关联 users.id / Reference to user',
    digest_type     ENUM('daily','weekly') NOT NULL
                        COMMENT '摘要类型: daily=每日摘要, weekly=每周摘要 / Digest type',
    content_json    JSON NOT NULL
                        COMMENT '摘要内容 JSON (信号列表, 市场概览, AI 总结) / Digest content',
    sent_at         DATETIME DEFAULT NULL
                        COMMENT '发送时间 (UTC, NULL=待发送) / Send timestamp',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                        COMMENT '创建时间 (UTC) / Creation timestamp',
    PRIMARY KEY (id),
    INDEX idx_user_type_created (user_id, digest_type, created_at)
        COMMENT '查询用户特定类型摘要 / Find digests by user and type',
    INDEX idx_sent_at (sent_at)
        COMMENT '定期清理已发送摘要 / Cleanup sent digests',
    CONSTRAINT fk_dq_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='通知摘要队列表 / Daily/weekly digest aggregation queue';
```

### 10.7 `notification_dlq`

```sql
CREATE TABLE notification_dlq (
    id              BIGINT UNSIGNED AUTO_INCREMENT
                        COMMENT 'PK: DLQ 记录唯一标识 / Primary key',
    alert_log_id    BIGINT UNSIGNED DEFAULT NULL
                        COMMENT 'FK: 关联 alert_logs.id (日志删除后保留) / Reference to alert log',
    channel         ENUM('email','push','inapp','sms') NOT NULL
                        COMMENT '失败渠道 / Failed delivery channel',
    payload         JSON NOT NULL
                        COMMENT '失败时的完整发送负载 / Full payload at failure time',
    error_message   VARCHAR(2000) DEFAULT NULL
                        COMMENT '最终失败原因 / Final error message',
    retry_count     INT UNSIGNED NOT NULL DEFAULT 0
                        COMMENT '已重试次数 / Number of retry attempts',
    max_retries     INT UNSIGNED NOT NULL DEFAULT 3
                        COMMENT '最大重试次数 (超过后标记 failed) / Max retry attempts',
    next_retry_at   DATETIME DEFAULT NULL
                        COMMENT '下次重试时间 (指数退避: 1s→2s→4s) / Next retry timestamp with exponential backoff',
    status          ENUM('pending','retrying','failed','resolved') NOT NULL DEFAULT 'pending'
                        COMMENT '处理状态: pending=待重试, retrying=重试中, failed=彻底失败, resolved=已解决',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                        COMMENT '入队时间 (UTC) / Enqueue timestamp',
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                        COMMENT '更新时间 (UTC) / Last update timestamp',
    PRIMARY KEY (id),
    INDEX idx_status_retry (status, next_retry_at)
        COMMENT '覆盖索引: 定时任务拉取待重试消息 / Cron: pull pending retries',
    INDEX idx_created_at (created_at)
        COMMENT '按时间清理已解决/彻底失败记录 / Cleanup resolved/failed entries',
    INDEX idx_alert_log_id (alert_log_id)
        COMMENT '关联原日志查询 / Link to original alert log',
    CONSTRAINT fk_ndq_alert_log
        FOREIGN KEY (alert_log_id) REFERENCES alert_logs(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='通知死信队列表 / Notification dead-letter queue for failed deliveries';
```

---

## 11. DDL — Watchlist

### 11.1 `watchlists`

```sql
CREATE TABLE watchlists (
    id              BIGINT UNSIGNED AUTO_INCREMENT
                        COMMENT 'PK: 自选列表唯一标识 / Primary key',
    user_id         BIGINT UNSIGNED NOT NULL
                        COMMENT 'FK: 关联 users.id / Reference to user',
    name            VARCHAR(100) NOT NULL DEFAULT 'Default Watchlist'
                        COMMENT '列表名称 / Watchlist name',
    sort_order      INT NOT NULL DEFAULT 0
                        COMMENT '排序权重 / Display ordering',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                        COMMENT '创建时间 (UTC) / Creation timestamp',
    PRIMARY KEY (id),
    INDEX idx_user_id (user_id)
        COMMENT '查询用户所有自选列表 / List watchlists for user',
    CONSTRAINT fk_wl_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='自选列表表 / User watchlist definitions';
```

### 11.2 `watchlist_items`

```sql
CREATE TABLE watchlist_items (
    id              BIGINT UNSIGNED AUTO_INCREMENT
                        COMMENT 'PK: 自选项唯一标识 / Primary key',
    watchlist_id    BIGINT UNSIGNED NOT NULL
                        COMMENT 'FK: 关联 watchlists.id / Reference to watchlist',
    stock_id        BIGINT UNSIGNED NOT NULL
                        COMMENT 'FK: 关联 stocks.id / Reference to stock',
    added_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                        COMMENT '添加时间 (UTC) / Timestamp when added',
    PRIMARY KEY (id),
    UNIQUE KEY uk_watchlist_stock (watchlist_id, stock_id)
        COMMENT '同一列表不重复添加同一标的 / Deduplicate stock per watchlist',
    INDEX idx_stock_id (stock_id)
        COMMENT '反向查找: 哪些列表包含某标的 / Which watchlists contain a stock',
    CONSTRAINT fk_wi_watchlist
        FOREIGN KEY (watchlist_id) REFERENCES watchlists(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_wi_stock
        FOREIGN KEY (stock_id) REFERENCES stocks(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='自选标的明细表 / Watchlist-stock junction table';
```

---

## 12. Indexing Strategy Summary

### 12.1 Index Classification

| Type | Purpose | Example |
|---|---|---|
| **Primary Key** | Row identity, clustered index in InnoDB | `PRIMARY KEY (id)` |
| **Unique Index** | Business uniqueness constraints | `UNIQUE KEY uk_email (email)` |
| **Single-Column Index** | Filter/join on one column | `INDEX idx_user_id (user_id)` |
| **Composite Index** | Multi-column queries (left-prefix rule) | `INDEX idx_stock_active_date (stock_id, is_active, triggered_date)` |
| **Covering Index** | Index-only scan (all queried columns in index) | `idx_user_unread (user_id, is_read, created_at)` for `SELECT ... WHERE user_id=? AND is_read=0 ORDER BY created_at DESC` |

### 12.2 Large-Table Index Rationale

#### `stock_prices_daily` (estimated: millions of rows)

| Index | Query Pattern | Rationale |
|---|---|---|
| `PRIMARY KEY (id, trade_date)` | Point lookup by id | Required for partitioning |
| `uk_stock_date (stock_id, trade_date)` | `INSERT ... ON DUPLICATE KEY UPDATE` | Upsert for data sync, deduplication |
| `idx_stock_date (stock_id, trade_date)` | `WHERE stock_id=? ORDER BY trade_date DESC LIMIT 200` | Covering index for K-line queries — the #1 API endpoint |
| `idx_trade_date (trade_date)` | `WHERE trade_date=?` | Bulk data sync by date range |

> **Why two indexes on `(stock_id, trade_date)`?**  
> `uk_stock_date` is the unique constraint (enforces one row per stock per day).  
> `idx_stock_date` is an explicit non-unique covering index for the descending date sort, ensuring `ORDER BY trade_date DESC` uses the index rather than filesort.

#### `analysis_signals` (estimated: hundred-thousands)

| Index | Query Pattern | Rationale |
|---|---|---|
| `idx_stock_active_date (stock_id, is_active, triggered_date)` | `WHERE stock_id=? AND is_active=1 ORDER BY triggered_date DESC` | Covering index for the most frequent query: "show me active signals for a stock" |
| `idx_config_id (config_id)` | `WHERE config_id=?` | Filter by strategy config |
| `idx_signal_type (signal_type)` | `WHERE signal_type=?` | Aggregate stats by signal type |
| `idx_triggered_date (triggered_date)` | `WHERE triggered_date BETWEEN ? AND ?` | Daily signal scanning cron job |

#### `alert_logs` (estimated: millions of rows/year)

| Index | Query Pattern | Rationale |
|---|---|---|
| `PRIMARY KEY (id, sent_at)` | Point lookup | Required for partitioning |
| `idx_user_sent (user_id, sent_at)` | `WHERE user_id=? ORDER BY sent_at DESC LIMIT 50` | User's recent notification history |
| `idx_alert_rule_id (alert_rule_id)` | `WHERE alert_rule_id=?` | Aggregate by rule |
| `idx_status (status)` | `WHERE status='failed'` | Retry failed deliveries |

#### `notification_inbox` (fast-growing, short-lived)

| Index | Query Pattern | Rationale |
|---|---|---|
| `idx_user_unread (user_id, is_read, created_at)` | `WHERE user_id=? AND is_read=0 ORDER BY created_at DESC` | Covering index for unread count + list (WebSocket push fetch) |
| `idx_created_at (created_at)` | `WHERE created_at < NOW() - INTERVAL 30 DAY` | Daily cleanup job |

### 12.3 Indexing Principles Applied

1. **Leftmost prefix**: Composite indexes are ordered by selectivity — equality columns first, range/order columns last.
2. **Covering indexes for hot paths**: K-line API, active signals, unread inbox — these are the 3 highest-QPS queries.
3. **No redundant indexes**: `idx_stock_date` is sufficient for queries on `stock_id` alone (leftmost prefix), so no separate `INDEX (stock_id)`.
4. **Partition-aware**: All partitioned tables include the partition key in their primary key and unique indexes.

---

## 13. Partitioning Strategy

### 13.1 `stock_prices_daily` — Partition by Year

**Strategy**: `PARTITION BY RANGE (YEAR(trade_date))`

| Property | Value |
|---|---|
| Partition granularity | 1 partition per year |
| Partition key | `YEAR(trade_date)` |
| Records per partition | ~125K/year (500 stocks × 250 trading days) |
| Target partition count | 10-15 partitions (2020–2028 + future) |
| Query pruning | `WHERE trade_date >= '2026-01-01'` automatically targets only the p2026 partition |

**Why yearly?**
- Yearly partitions keep ~125K rows each — well within InnoDB's sweet spot.
- K-line queries are typically date-ranged (e.g., last 200 bars), spanning at most 2 partitions.
- Yearly is the natural data lifecycle boundary: bulk-load a new year, archive old years.
- Partition count stays manageable (< 20).

**DDL template for adding new years:**
```sql
ALTER TABLE stock_prices_daily
  REORGANIZE PARTITION p_future INTO (
      PARTITION p2029 VALUES LESS THAN (2030),
      PARTITION p_future VALUES LESS THAN MAXVALUE
  );
```

### 13.2 `alert_logs` — Partition by Month

**Strategy**: `PARTITION BY RANGE (TO_DAYS(sent_at))`

| Property | Value |
|---|---|
| Partition granularity | 1 partition per month |
| Partition key | `TO_DAYS(sent_at)` (integer days since year 1) |
| Records per partition | ~200K/month (10K active users × 5 alerts × 4 weeks) |
| Target partition count | 12-24 partitions (rolling window) |

**Why monthly?**
- Alert logs grow fast and are primarily queried by recent date ranges.
- Monthly partitions align with the 90-day archive retention window (drop partitions > 3 months old).
- `TO_DAYS()` is deterministic, indexable, and efficient for pruning.
- Monthly granularity prevents any single partition from growing beyond ~500K rows.

**Why not `YEAR(sent_at)`?**
- `YEAR()` returns a value too coarse for alert_logs' growth rate (~2.6M rows/year). A single partition with 2.6M rows would not benefit from partition pruning for typical "last 7 days" queries.

**DDL template for adding new months:**
```sql
ALTER TABLE alert_logs
  REORGANIZE PARTITION p_future INTO (
      PARTITION p202701 VALUES LESS THAN (TO_DAYS('2027-02-01')),
      PARTITION p_future VALUES LESS THAN MAXVALUE
  );
```

### 13.3 Partition Maintenance Automation

An APScheduler job (daily at 00:00 UTC) handles:

```
FOR alert_logs:
    1. Calculate next month boundary (e.g., 2027-02-01).
    2. REORGANIZE PARTITION p_future to add p{YYYYMM} for next month.
    3. DROP partitions where sent_at < NOW() - INTERVAL 120 DAY.
       (90 days retention + 30 days buffer)

FOR stock_prices_daily:
    1. In December: add p{next_year} partition.
    2. Never drop historical price partitions (business critical).
```

**Important**: Partition DDL in MySQL 8.0 online DDL is non-blocking for `REORGANIZE PARTITION`, but can still briefly lock metadata. Schedule during low-traffic windows (e.g., 03:00 UTC).

### 13.4 Tables NOT Partitioned

| Table | Reason |
|---|---|
| `analysis_signals` | Growth rate is moderate (~12.5K/year); standard indexes suffice |
| `notification_inbox` | Records are short-lived (30d TTL); partitioning overhead not justified |
| `backtest_results` | Low row count (one per job); no benefit |
| All other tables | <100K rows expected long-term |

---

## 14. Data Retention Policies

### 14.1 Summary

| Table | Retention | Cleanup Method | Justification |
|---|---|---|---|
| `stock_prices_daily` | **Keep all** (never delete) | N/A | Business critical; historical data is the product's core asset |
| `indicator_cache` | **24 hours** (TTL) | `DELETE FROM indicator_cache WHERE computed_at < NOW() - INTERVAL 24 HOUR` | Recalculated daily after market sync; stale cache is misleading |
| `alert_logs` | **90 days** (archive) | `ALTER TABLE alert_logs DROP PARTITION p{old}` | Compliance + cost; old logs have no user-facing value |
| `notification_inbox` | **30 days** (auto-delete) | `DELETE FROM notification_inbox WHERE created_at < NOW() - INTERVAL 30 DAY LIMIT 1000` | UX cleanliness; users don't need old notifications |
| `backtest_results` | **365 days** (Pro users only) | `DELETE FROM backtest_results WHERE created_at < NOW() - INTERVAL 365 DAY` | Storage cost; older results are stale (market regimes change) |
| `notification_dlq` | **90 days** (resolved/failed) | `DELETE FROM notification_dlq WHERE created_at < NOW() - INTERVAL 90 DAY AND status IN ('failed','resolved')` | Debug window; clean up dead entries |
| `digest_queue` | **90 days** (sent only) | `DELETE FROM digest_queue WHERE sent_at IS NOT NULL AND sent_at < NOW() - INTERVAL 90 DAY` | Keep pending digests; clean sent history |
| `user_sessions` | **30 days after expiry** | `DELETE FROM user_sessions WHERE expires_at < NOW() - INTERVAL 30 DAY` | Purge expired refresh tokens |

### 14.2 Cleanup Job Schedule

All cleanup operations run as a single APScheduler job `cleanup_expired_data` daily at 04:00 UTC:

```python
# Pseudocode
async def cleanup_expired_data():
    await db.execute(delete(indicator_cache).where(
        indicator_cache.c.computed_at < utcnow() - timedelta(hours=24)
    ))
    await db.execute(delete(notification_inbox).where(
        notification_inbox.c.created_at < utcnow() - timedelta(days=30)
    ))
    await db.execute(delete(backtest_results).where(
        backtest_results.c.created_at < utcnow() - timedelta(days=365)
    ))
    # ... etc
```

---

## 15. Seed Data

### 15.1 `subscription_tiers`

```sql
INSERT INTO subscription_tiers (name, slug, stripe_price_id_monthly, stripe_price_id_yearly, price_monthly, price_yearly, features, daily_api_limit, watchlist_limit, alert_limit, ai_analysis_limit, backtest_limit, sort_order, is_active) VALUES

-- FREE
('Free', 'free', NULL, NULL, 0.00, 0.00,
 '{
   "kline_periods": ["day"],
   "kline_history_days": 90,
   "kline_delay": true,
   "signal_types": [],
   "indicators": ["sma", "ema"],
   "risk_level": false,
   "channels": [],
   "data_export": false,
   "support": "faq"
 }',
 100, 5, 0, 0, 0, 0, 1),

-- BASIC
('Basic', 'basic', 'price_basic_monthly_placeholder', 'price_basic_yearly_placeholder', 9.99, 99.00,
 '{
   "kline_periods": ["day", "week"],
   "kline_history_days": 730,
   "kline_delay": false,
   "signal_types": ["golden_cross", "death_cross"],
   "indicators": ["sma", "ema", "rsi", "macd"],
   "risk_level": true,
   "channels": ["email"],
   "data_export": false,
   "support": "email"
 }',
 1000, 30, 10, 10, 0, 10, 1),

-- PRO
('Pro', 'pro', 'price_pro_monthly_placeholder', 'price_pro_yearly_placeholder', 29.99, 299.00,
 '{
   "kline_periods": ["day", "week", "month", "quarter", "year"],
   "kline_history_days": 3650,
   "kline_delay": false,
   "signal_types": ["golden_cross", "death_cross", "bullish_alignment", "bearish_alignment", "composite_buy", "composite_sell"],
   "indicators": ["*"],
   "risk_level": true,
   "risk_report_detailed": true,
   "channels": ["email", "push", "inapp"],
   "data_export": "csv",
   "support": "priority"
 }',
 10000, 0, 30, 50, 10, 20, 1);
```

### 15.2 Pricing Reference (from [001-preliminary-design.md](./001-preliminary-design.md))

| Tier | Monthly | Yearly | Yearly Savings |
|---|---|---|---|
| Free | $0 | $0 | — |
| Basic | $9.99 | $99.00 | 17% off ($20.88 saved) |
| Pro | $29.99 | $299.00 | 17% off ($60.88 saved) |

### 15.3 `features` JSON Field Explanation

| Key | Type | Free | Basic | Pro |
|---|---|---|---|---|
| `kline_periods` | `string[]` | `["day"]` | `["day","week"]` | `["day","week","month","quarter","year"]` |
| `kline_history_days` | `int` | 90 (3 months) | 730 (2 years) | 3650 (10 years) |
| `kline_delay` | `bool` | `true` (1 day) | `false` | `false` |
| `signal_types` | `string[]` | `[]` | `["golden_cross","death_cross"]` | all 6 types |
| `indicators` | `string[]` | `["sma","ema"]` | `["sma","ema","rsi","macd"]` | `["*"]` = all 252+ |
| `risk_level` | `bool` | `false` | `true` | `true` |
| `risk_report_detailed` | `bool` | — | — | `true` |
| `channels` | `string[]` | `[]` | `["email"]` | `["email","push","inapp"]` |
| `data_export` | `string\|bool` | `false` | `false` | `"csv"` |
| `support` | `string` | `"faq"` | `"email"` | `"priority"` |

> **`kline_history_days` note**: These values represent the *maximum* lookback. The actual available data depends on `stock_prices_daily` content. Free tier users receive API-level filtering; data is not physically deleted.

---

## 16. Migration Notes

### 16.1 Alembic Conventions

The project uses **Alembic 1.14+** with SQLAlchemy 2.0+ async driver (`asyncmy`).

**Configuration** (`alembic.ini`):
```ini
[alembic]
script_location = backend/alembic
sqlalchemy.url = mysql+asyncmy://user:pass@localhost:3306/trend_scope

[alembic:exclude_tables]
# Exclude these from autogenerate (managed outside Alembic)
exclude_tables = spatial_ref_sys
```

**Migration template** (`alembic/env.py`):
```python
# Key settings
target_metadata = Base.metadata  # from app.models.base
compare_type = True              # detect column type changes
compare_server_default = True    # detect DEFAULT changes
render_as_batch = False          # MySQL does not need batch mode
```

### 16.2 Naming Convention

All constraint names use explicit naming to ensure predictable migration diffs:

```python
# In backend/app/models/base.py
from sqlalchemy import MetaData

convention = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uk_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

metadata = MetaData(naming_convention=convention)

class Base(DeclarativeBase):
    metadata = metadata
```

This ensures Alembic's `--autogenerate` produces consistent, readable constraint names matching the DDL in this document.

### 16.3 Handling Schema Changes (Production)

| Change Type | Recommended Approach | Risk |
|---|---|---|
| Add nullable column | `ALTER TABLE ... ADD COLUMN` — safe, instant in MySQL 8.0 InnoDB | Low |
| Add non-nullable column | 1. Add as nullable with DEFAULT; 2. Backfill data; 3. Alter to NOT NULL | Medium (step 3 locks table briefly) |
| Add index | `CREATE INDEX ... ALGORITHM=INPLACE LOCK=NONE` — non-blocking online DDL | Low |
| Drop column | 1. Stop writing to column in code; 2. Deploy; 3. Drop column | Low |
| Rename column | MySQL 8.0: `ALTER TABLE ... RENAME COLUMN ... ALGORITHM=INSTANT` (instant) | Low |
| Change column type | **Avoid if possible**. If required: 1. Add new column; 2. Dual-write; 3. Backfill; 4. Switch reads; 5. Drop old column | High |
| Add foreign key | `ALTER TABLE ... ADD CONSTRAINT ...` — metadata lock only | Low |
| Add partition | `REORGANIZE PARTITION p_future ...` — non-blocking | Low (schedule off-peak) |
| Drop table | 1. Remove all FK references first; 2. Stop writes in code; 3. Deploy; 4. Drop table | Medium |

### 16.4 Migration Checklist (Per-Migration PR)

- [ ] Generated via `alembic revision --autogenerate -m "description"`
- [ ] Reviewed diff manually — autogenerate can miss enum changes, partition DDL, and JSON column details
- [ ] `upgrade()` and `downgrade()` are both functional and tested
- [ ] Backward compatible (existing code works before and after migration)
- [ ] Partition DDL changes tested on staging with production-like data volume
- [ ] Index creation uses `ALGORITHM=INPLACE LOCK=NONE` to avoid table locks
- [ ] All migrations include Chinese+English comment in the docstring

### 16.5 Initial Migration

The first migration (`001_initial_schema.py`) creates all 25 tables in dependency order:

```
1.  subscription_tiers          (no FKs)
2.  users                       (no FKs)
3.  stocks                      (no FKs)
4.  user_sessions               (→ users)
5.  user_subscriptions          (→ users, subscription_tiers)
6.  payment_orders              (→ users, subscription_tiers)
7.  stock_prices_daily          (→ stocks)  [partitioned]
8.  indicator_presets           (→ subscription_tiers)
9.  indicator_preset_items      (→ indicator_presets)
10. stock_indicator_overrides   (→ stocks)
11. indicator_cache             (→ stocks)
12. analysis_configs            (→ stocks)
13. analysis_signals            (→ stocks, analysis_configs)
14. ai_analysis_results         (→ analysis_signals)
15. backtest_jobs               (→ users, stocks, analysis_configs)
16. backtest_results            (→ backtest_jobs)
17. notification_preferences    (→ users)
18. alert_rules                 (→ users, stocks)
19. alert_logs                  (→ alert_rules, users, stocks, analysis_signals)  [partitioned]
20. notification_inbox          (→ users, alert_logs)
21. push_device_tokens          (→ users)
22. digest_queue                (→ users)
23. notification_dlq            (→ alert_logs)
24. watchlists                  (→ users)
25. watchlist_items             (→ watchlists, stocks)
```

### 16.6 Seed Data Migration

`002_seed_subscription_tiers.py` inserts the three tier rows from [Section 15.1](#151-subscription_tiers) using raw SQL (`alembic.op.execute`) since seed data is not auto-generated.

---

## Appendix A: Glossary

| Term | Chinese | English Definition |
|---|---|---|
| OHLCV | 开盘/最高/最低/收盘/成交量 | Open, High, Low, Close, Volume |
| K-line | K线 | Candlestick chart |
| Golden Cross | 金叉 | Short MA crosses above long MA (bullish) |
| Death Cross | 死叉 | Short MA crosses below long MA (bearish) |
| Backtest | 回测 | Historical strategy simulation |
| Sharpe Ratio | 夏普比率 | Risk-adjusted return measure |
| Max Drawdown | 最大回撤 | Largest peak-to-trough decline |
| DLQ | 死信队列 | Dead Letter Queue |
| Idempotency | 幂等性 | Same operation yields same result regardless of repetition |
| Partition Pruning | 分区裁剪 | MySQL automatically skips irrelevant partitions based on WHERE clause |

## Appendix B: Estimated Row Counts (Year 1 — 10K Users)

| Table | Estimated Rows | Data Size |
|---|---|---|
| `users` | 10,000 | ~2 MB |
| `user_sessions` | 10,000 (active) | ~5 MB |
| `user_subscriptions` | 10,000 | ~1 MB |
| `payment_orders` | 15,000 | ~3 MB |
| `stocks` | 500 | ~0.1 MB |
| `stock_prices_daily` | 1,250,000 (10yr × 500 stocks) | ~80 MB |
| `indicator_cache` | 50,000 (in-memory mostly) | ~50 MB |
| `analysis_signals` | 12,500 | ~5 MB |
| `ai_analysis_results` | 25,000 | ~50 MB |
| `backtest_jobs` | 5,000 | ~2 MB |
| `backtest_results` | 5,000 | ~50 MB |
| `alert_logs` | 500,000 | ~100 MB |
| `notification_inbox` | 200,000 (30d rolling) | ~30 MB |
| **TOTAL** | **~2.1M rows** | **~380 MB** |

> Extrapolated to Year 3 (50K users, 2,000 stocks): ~10M rows, ~1.5 GB. Well within single-instance MySQL 8.0 capacity.

---

## Appendix C: Revision History

| Version | Date | Changes |
|---|---|---|
| v1 | 2026-06-09 | Initial release: 25 tables, complete DDL, indexes, FKs, partitioning, retention, seed data, migration guide. |
