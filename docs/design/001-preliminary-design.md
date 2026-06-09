# 001 - Preliminary Design Document

> **Status**: Draft v2 (Post-Research)  
> **Date**: 2026-06-09  
> **Purpose**: 综合 9 项研究后的完整架构设计。覆盖技术选型、模块划分、数据模型、API 轮廓、分析引擎、回测系统、AI 分析、通知、支付、开发阶段。
>
> **关联研究文档**:
> - [001-business-model.md](../research/001-business-model.md) — 商业模式与定价
> - [002-data-sources.md](../research/002-data-sources.md) — 数据源选型
> - [003-charting.md](../research/003-charting.md) — K 线图表方案
> - [004-indicator-system.md](../research/004-indicator-system.md) — 指标计算与插件系统
> - [005-analysis-engine.md](../research/005-analysis-engine.md) — 量化分析与 AI 方法
> - [006-backtest.md](../research/006-backtest.md) — 回测系统
> - [007-notification.md](../research/007-notification.md) — 通知系统
> - [008-subscription.md](../research/008-subscription.md) — 支付与订阅
> - [009-ai-analysis.md](../research/009-ai-analysis.md) — AI 内容生成

---

## 1. 项目概述

**Trend-Scope** — 面向美股指数基金投资者的分级会员制投资分析平台。

### 核心功能

| 功能 | 说明 | 研究参考 |
|---|---|---|
| 买卖点信号 | 均线交叉 (Phase 1) → 多指标综合 + ML 增强 (Phase 2) → LLM 确认 (Phase 3) | [005] |
| K 线图表 | TradingView Lightweight Charts v5.2.0，日/周/月K线 + 成交量 + 信号标记 | [003] |
| 技术指标插件系统 | 基于 pandas-ta-classic 的 252+ 指标，插件化自动发现/动态加载 | [004] |
| 风险提示 | 均线排列 + 波动率 + ATR 风险等级 | [005] |
| 回测系统 | vectorbt 引擎，Sharpe/MDD/胜率/盈亏比等完整指标，Optuna 参数优化 | [006] |
| AI 分析报告 | 为什么买卖、风险在哪、止损建议 (DeepSeek/Claude/GPT 多模型) | [009] |
| 提醒服务 | 邮件 (Resend) + Web Push (OneSignal) + 站内通知 (WebSocket) | [007] |
| 分级会员 | 免费 / Basic ($9.99/mo) / Pro ($29.99/mo)，按权益区分 | [001] |
| 支付集成 | Stripe Checkout (内置支付宝/微信) + Customer Portal | [008] |

### 项目边界

- **管理端（本项目）**: Next.js 14 后台管理系统，管理用户、标的、信号、会员等级、支付订单
- **用户端（后续独立项目）**: 独立 Web/移动端应用，通过 REST API + WebSocket 消费数据
- **后端 API**: 同时服务于管理端和用户端，按角色 (user/admin) 隔离权限，按会员等级限流

---

## 2. 技术选型

### 2.1 后端核心

| 组件 | 选型 | 版本 | 理由 | 研究参考 |
|---|---|---|---|---|
| 语言 | Python | 3.12+ | 数据分析生态 (pandas, numpy, scikit-learn) | - |
| Web 框架 | FastAPI | 0.115+ | 异步、自动 OpenAPI、WebSocket 原生支持 | - |
| ORM | SQLAlchemy | 2.0+ | 异步支持、成熟稳定 | - |
| 迁移工具 | Alembic | 1.14+ | 与 SQLAlchemy 原生集成 | - |
| 数据校验 | Pydantic | 2.x | FastAPI 内置，类型安全 | - |
| 认证 | python-jose + passlib | - | JWT (access 30min + refresh 30d) | - |
| 定时任务 | APScheduler | 4.x | Phase 1-3 轻量，无需额外中间件；Phase 4+ 可迁移 Celery | - |
| HTTP 客户端 | httpx | 0.28+ | 异步请求 | - |

### 2.2 数据源 (双层策略)

| 层级 | 选型 | 用途 | 费用 | 研究参考 |
|---|---|---|---|---|
| **主数据源** | yfinance | EOD OHLCV，20+ 年历史，批量下载 | 免费 | [002] |
| **实时行情** | Finnhub | 实时报价，60 req/min，WebSocket 50 symbols | 免费层 | [002] |
| **宏观经济** | FRED (fredapi) | 利率、失业率、GDP 等宏观数据 | 免费 | [002] |
| **付费备用** | Polygon.io Stocks Advanced | 实时全量、WebSocket、基本面 | $199/mo | [002] |
| **辅助付费** | Tiingo Power | EOD 综合价格、30+ 年历史 | $30/mo | [002] |

### 2.3 分析 & 量化库

| 组件 | 选型 | 版本 | 理由 | 研究参考 |
|---|---|---|---|---|
| 技术指标 | pandas-ta-classic | 0.6+ | 252 指标，纯 Python，MIT 协议，可选 TA-Lib 加速 | [004] |
| 回测引擎 | vectorbt | 1.0+ | 矢量化，NumPy/Numba/Rust，10000+ 参数组合 | [006] |
| 参数优化 | Optuna | 4.x | 贝叶斯 + TPE + 剪枝 | [006] |
| ML 模型 | scikit-learn, XGBoost, LightGBM | - | 特征信号预测 | [005] |
| 深度学习 (可选) | TensorFlow/Keras | - | LSTM 时序预测 | [005] |
| NLP/情绪 | FinBERT (ProsusAI/finbert) | - | 新闻/社交媒体情绪分析 | [005] |
| 回测报告 | QuantStats | 0.0.62+ | 一键 HTML tear sheet | [006] |

### 2.4 AI / LLM

| 层级 | 选型 | 价格 (每 1M token) | 用途 | 研究参考 |
|---|---|---|---|---|
| **Basic 主力** | DeepSeek V4-Flash | $0.14 / $0.28 | 日常分析 ($0.00043/次) | [009] |
| **Pro 主力** | Claude Haiku 4.5 | $1.00 / $5.00 | 高质量分析 ($0.0055/次) | [009] |
| **Pro 备选** | GPT-5.4-mini | $0.75 / $4.50 | 备用 | [009] |
| **自部署 (可选)** | Ollama + Qwen 2.5 7B | $0 | 免费层降级 | [009] |

### 2.5 数据库与缓存

| 组件 | 选型 | 版本 | 研究参考 |
|---|---|---|---|
| 主数据库 | MySQL | 8.0+ (utf8mb4, 时区 UTC) | [007] |
| 缓存/会话/限流 | Redis | 7.x | [007][008] |
| 异步任务队列 | ARQ (Redis-based) | 0.26+ | [006] |
| 数据库驱动 | asyncmy | 0.2.x | - |

### 2.6 通知服务

| 组件 | 选型 | 费用 | 研究参考 |
|---|---|---|---|
| 邮件主力 | Resend | $20/mo (50k 封) | [007] |
| 邮件备用 | AWS SES | $0.10/千封 | [007] |
| Web Push | OneSignal | 免费 (10k 订阅者) | [007] |
| 站内通知 | WebSocket + Redis Pub/Sub | $0 | [007] |
| 短信 | 延期 (Twilio $0.012/条) | - | [007] |

### 2.7 管理端前端

| 组件 | 选型 | 版本 | 研究参考 |
|---|---|---|---|
| 框架 | Next.js | 14.x (App Router) | - |
| 语言 | TypeScript | 5.x | - |
| UI 库 | Ant Design | 5.x (企业级后台) | - |
| 图表 | TradingView Lightweight Charts | 5.2.0 | [003] |
| 状态管理 | React Query (TanStack) | 5.x | - |
| 表格 | @tanstack/react-table | 8.x | - |

### 2.8 支付集成

| 渠道 | 方式 | 覆盖 | 研究参考 |
|---|---|---|---|
| Stripe | Stripe Checkout (Hosted) + Customer Portal | 国际信用卡 + 内置支付宝/微信 | [008] |
| 独立支付宝/微信 | 延期 (Stripe 内置已覆盖) | 中国大陆 | [008] |
| App Store IAP | 延期 (15-30% 抽成过高) | 若出移动版 | [008] |

### 2.9 部署

| 组件 | 方式 |
|---|---|
| 容器化 | Docker Compose (mysql + redis + backend + admin) |
| 进程管理 | uvicorn (后端) / next dev (管理端) |
| 反向代理 | Nginx (生产) |

---

## 3. 项目目录结构

```
trend-scope/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   └── v1/
│   │   │       ├── router.py              # 聚合所有子路由
│   │   │       ├── auth.py                # 认证 (public + user)
│   │   │       ├── users.py               # 用户信息 (user)
│   │   │       ├── stocks.py              # 股票/K线 (user)
│   │   │       ├── analysis.py            # 信号/指标/AI分析 (user)
│   │   │       ├── backtest.py            # 回测提交/查询/报告 (user)
│   │   │       ├── watchlist.py           # 自选管理 (user)
│   │   │       ├── alerts.py              # 提醒管理 (user)
│   │   │       ├── subscriptions.py       # 订阅/支付 (user)
│   │   │       ├── webhooks.py            # Stripe/Finnhub 回调 (public)
│   │   │       └── admin/                 # 管理端专有
│   │   │           ├── dashboard.py       # 关键指标统计
│   │   │           ├── users.py           # 用户 CRUD
│   │   │           ├── stocks.py          # 标的管理 CRUD
│   │   │           ├── tiers.py           # 会员等级配置
│   │   │           ├── signals.py         # 信号审核/修正
│   │   │           ├── analysis_configs.py # 分析策略配置
│   │   │           └── payments.py        # 支付订单/Revenue 分析
│   │   ├── core/
│   │   │   ├── config.py                  # pydantic-settings 配置
│   │   │   ├── security.py               # JWT 创建/验证、密码哈希
│   │   │   ├── deps.py                   # Depends 依赖注入
│   │   │   └── exceptions.py            # 全局异常处理
│   │   ├── models/
│   │   │   ├── base.py                    # Base + TimestampMixin
│   │   │   ├── user.py                    # User, UserSession
│   │   │   ├── stock.py                   # Stock, StockPriceDaily
│   │   │   ├── analysis.py               # AnalysisConfig, AnalysisSignal
│   │   │   ├── indicator.py              # IndicatorPreset, StockIndicatorOverride, IndicatorCache
│   │   │   ├── backtest.py               # BacktestJob, BacktestResult
│   │   │   ├── ai_analysis.py            # AIAnalysisResult (LLM 分析结果)
│   │   │   ├── subscription.py           # SubscriptionTier, UserSubscription, PaymentOrder
│   │   │   ├── watchlist.py              # Watchlist, WatchlistItem
│   │   │   └── alert.py                  # AlertRule, AlertLog, NotificationPreference, PushDeviceToken
│   │   ├── schemas/
│   │   │   ├── auth.py
│   │   │   ├── user.py
│   │   │   ├── stock.py                   # StockOut, KlinePoint, KlineResponse (含预计算指标)
│   │   │   ├── analysis.py               # SignalOut, IndicatorOut, MultiIndicatorRequest
│   │   │   ├── backtest.py               # BacktestSubmit, BacktestStatus, BacktestReport
│   │   │   ├── ai_analysis.py            # AIAnalysisRequest, AIAnalysisResponse
│   │   │   ├── subscription.py           # TierOut, SubscriptionOut, PaymentCreate
│   │   │   ├── watchlist.py
│   │   │   ├── alert.py
│   │   │   └── common.py                 # PaginatedResponse, ErrorResponse, HealthResponse
│   │   ├── services/
│   │   │   ├── stock_data.py             # yfinance + Finnhub 多层数据适配器
│   │   │   ├── data_adapter.py           # 多数据源抽象层 (统一 OHLCV 接口)
│   │   │   ├── analysis_engine.py        # 三层分析引擎 (rule → ML → LLM)
│   │   │   ├── indicator_engine.py       # 指标注册表 + 计算 + 多时间框架
│   │   │   ├── indicators/               # 内置指标插件目录
│   │   │   │   ├── __init__.py
│   │   │   │   ├── base.py              # BaseIndicator ABC
│   │   │   │   ├── ma.py                # SMA, EMA, WMA, HMA
│   │   │   │   ├── macd.py
│   │   │   │   ├── rsi.py
│   │   │   │   ├── bollinger.py
│   │   │   │   └── ...
│   │   │   ├── backtest_service.py       # 异步回测执行 + 任务队列管理
│   │   │   ├── ai_analysis_service.py    # LLM 多提供者路由 + 缓存 + 限流
│   │   │   ├── ai_providers/             # LLM 提供者实现
│   │   │   │   ├── base.py              # BaseLLMProvider ABC
│   │   │   │   ├── openai_provider.py
│   │   │   │   ├── deepseek_provider.py
│   │   │   │   ├── anthropic_provider.py
│   │   │   │   └── ollama_provider.py
│   │   │   ├── alert_service.py          # 事件驱动通知分发
│   │   │   ├── channels/                 # 通知渠道适配器
│   │   │   │   ├── base.py              # ChannelAdapter ABC
│   │   │   │   ├── email_channel.py     # Resend
│   │   │   │   ├── push_channel.py      # OneSignal
│   │   │   │   ├── inapp_channel.py     # WebSocket
│   │   │   │   └── sms_channel.py       # Twilio (延期)
│   │   │   ├── subscription_service.py   # 订阅状态机 + 到期降级
│   │   │   └── payment_service.py        # StripeProvider + 幂等处理
│   │   ├── scheduler/
│   │   │   ├── jobs.py                   # 定时任务：数据同步、信号扫描、每日摘要
│   │   │   └── runner.py                 # APScheduler 启动/管理
│   │   ├── middleware/
│   │   │   ├── rate_limit.py             # Redis 令牌桶，按会员等级限流
│   │   │   ├── audit_log.py              # 管理端操作审计
│   │   │   └── subscription_guard.py     # 会员权益校验中间件
│   │   └── main.py                       # FastAPI app 入口
│   ├── alembic/
│   ├── tests/
│   ├── requirements.txt
│   └── Dockerfile
├── admin/                                # Next.js 14 管理端
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx                # AntD ConfigProvider + AuthGuard
│   │   │   ├── login/page.tsx
│   │   │   ├── dashboard/page.tsx        # MRR/用户数/信号概览
│   │   │   ├── users/
│   │   │   ├── stocks/
│   │   │   │   ├── page.tsx              # 标的列表
│   │   │   │   ├── create/page.tsx       # 添加标的
│   │   │   │   └── [id]/page.tsx         # 详情 (K线 + 信号历史)
│   │   │   ├── signals/page.tsx          # 信号审核/修正
│   │   │   ├── analysis/
│   │   │   │   ├── configs/page.tsx      # 分析策略配置
│   │   │   │   └── backtest/page.tsx     # 回测任务管理
│   │   │   ├── tiers/                    # 会员等级管理
│   │   │   ├── payments/page.tsx         # 支付订单 + Revenue
│   │   │   └── alerts/page.tsx           # 提醒模板管理
│   │   ├── components/
│   │   │   ├── layout/                   # Sidebar, Header, AuthGuard
│   │   │   ├── charts/
│   │   │   │   ├── KlineChart.tsx        # LWC 封装 (动态导入 ssr:false)
│   │   │   │   └── EquityCurve.tsx       # 回测权益曲线
│   │   │   ├── signals/SignalBadge.tsx
│   │   │   └── common/
│   │   ├── lib/
│   │   │   ├── api.ts                    # 后端 API 客户端
│   │   │   ├── auth.ts                   # Token 管理
│   │   │   └── chart-themes.ts           # LWC 明暗主题
│   │   └── types/
│   ├── package.json
│   ├── next.config.js
│   └── Dockerfile
├── docker-compose.yml
├── .env.example
├── .gitignore
└── docs/
    ├── design/
    │   ├── 001-preliminary-design.md     # 本文件
    │   ├── 002-database-schema.md        # (待) 完整 DDL
    │   ├── 003-api-specification.md      # (待) OpenAPI 详细规格
    │   └── 004-deployment-guide.md       # (待) 部署指南
    └── research/
        ├── 001-business-model.md
        ├── 002-data-sources.md
        ├── 003-charting.md
        ├── 004-indicator-system.md
        ├── 005-analysis-engine.md
        ├── 006-backtest.md
        ├── 007-notification.md
        ├── 008-subscription.md
        └── 009-ai-analysis.md
```

---

## 4. 数据库核心模型

### 4.1 ER 概要 (v2)

```
User ─────── UserSession
  │
  ├── UserSubscription ─── SubscriptionTier
  ├── PaymentOrder
  ├── Watchlist ─── WatchlistItem ─── Stock
  │                                    │
  ├── AlertRule ─── AlertLog           ├── StockPriceDaily
  ├── NotificationPreference           ├── AnalysisConfig ─── AnalysisSignal
  ├── PushDeviceToken                  │                        └── AIAnalysisResult
  ├── NotificationInbox                ├── IndicatorPreset ─── IndicatorPresetItem
  ├── DigestQueue                      ├── StockIndicatorOverride
  └── BacktestJob ─── BacktestResult   └── IndicatorCache
```

### 4.2 核心表定义 (v2 — 新增表加 ★ 标记)

```sql
-- ==================== 用户与认证 ====================
users (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    nickname VARCHAR(100),
    avatar_url VARCHAR(500),
    locale ENUM('en', 'zh') DEFAULT 'zh',        -- 语言偏好
    role ENUM('user', 'admin') DEFAULT 'user',
    status ENUM('active', 'disabled', 'banned') DEFAULT 'active',
    last_login_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

user_sessions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    refresh_token VARCHAR(500) UNIQUE NOT NULL,
    device_info VARCHAR(500),
    ip_address VARCHAR(45),
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ==================== 会员与支付 ====================
subscription_tiers (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,                     -- Free / Basic / Pro
    slug VARCHAR(50) UNIQUE NOT NULL,               -- free / basic / pro
    stripe_price_id_monthly VARCHAR(255),           -- Stripe Price ID
    stripe_price_id_yearly VARCHAR(255),
    price_monthly DECIMAL(10,2) NOT NULL,           -- 9.99 / 29.99
    price_yearly DECIMAL(10,2) NOT NULL,            -- 99.00 / 299.00
    features JSON NOT NULL,
    daily_api_limit INT NOT NULL DEFAULT 100,
    watchlist_limit INT NOT NULL DEFAULT 5,
    alert_limit INT NOT NULL DEFAULT 0,
    ai_analysis_limit INT NOT NULL DEFAULT 0,       -- ★ 每日 AI 分析次数
    sort_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

user_subscriptions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    tier_id BIGINT NOT NULL REFERENCES subscription_tiers(id),
    stripe_subscription_id VARCHAR(255),            -- ★ Stripe 订阅 ID
    status ENUM('active', 'past_due', 'cancelled', 'expired') DEFAULT 'active',
    started_at DATETIME NOT NULL,
    expired_at DATETIME NOT NULL,
    grace_until DATETIME,                           -- ★ 宽限期截止
    auto_renew BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

payment_orders (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    tier_id BIGINT NOT NULL REFERENCES subscription_tiers(id),
    payment_provider ENUM('stripe') NOT NULL,       -- Phase 1 仅 Stripe
    provider_session_id VARCHAR(255),               -- Stripe Checkout Session ID
    provider_payment_intent_id VARCHAR(255),        -- Stripe PaymentIntent ID
    amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'USD',
    period ENUM('monthly', 'yearly') NOT NULL,
    status ENUM('pending', 'paid', 'failed', 'refunded', 'expired') DEFAULT 'pending',
    idempotency_key VARCHAR(255) UNIQUE,            -- ★ 幂等键
    paid_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_idempotency (idempotency_key)
);

-- ==================== 股票与行情 ====================
stocks (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    symbol VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    type ENUM('ETF', 'Stock', 'Index') NOT NULL,
    subtype VARCHAR(50),                            -- ★ leveraged, inverse, broad_market 等
    market ENUM('US') DEFAULT 'US',
    sector VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

stock_prices_daily (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    stock_id BIGINT NOT NULL REFERENCES stocks(id),
    trade_date DATE NOT NULL,
    open DECIMAL(12,4) NOT NULL,
    high DECIMAL(12,4) NOT NULL,
    low DECIMAL(12,4) NOT NULL,
    close DECIMAL(12,4) NOT NULL,
    volume BIGINT NOT NULL,
    data_source VARCHAR(50) DEFAULT 'yfinance',     -- ★ 数据来源追踪
    UNIQUE KEY uk_stock_date (stock_id, trade_date),
    INDEX idx_stock_date (stock_id, trade_date DESC)
);

-- ==================== 指标系统 ★ ====================
indicator_presets (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,                     -- "均线标准策略"
    description TEXT,
    tier_id BIGINT REFERENCES subscription_tiers(id), -- NULL = 全等级可用
    is_system BOOLEAN DEFAULT FALSE,                -- 系统预设不可删除
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

indicator_preset_items (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    preset_id BIGINT NOT NULL REFERENCES indicator_presets(id) ON DELETE CASCADE,
    indicator_name VARCHAR(100) NOT NULL,           -- "sma", "rsi", "macd"
    params JSON NOT NULL,                           -- {"length": 20}
    sort_order INT DEFAULT 0
);

stock_indicator_overrides (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    stock_id BIGINT NOT NULL REFERENCES stocks(id),
    indicator_name VARCHAR(100) NOT NULL,
    params JSON NOT NULL,
    UNIQUE KEY uk_stock_indicator (stock_id, indicator_name)
);

indicator_cache (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    stock_id BIGINT NOT NULL REFERENCES stocks(id),
    indicator_name VARCHAR(100) NOT NULL,
    params_hash VARCHAR(64) NOT NULL,               -- SHA256 of sorted params
    timeframe VARCHAR(10) NOT NULL DEFAULT '1d',    -- 1d, 1w, 1M
    data JSON NOT NULL,                             -- [{date, value}, ...]
    computed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_cache_key (stock_id, indicator_name, params_hash, timeframe),
    INDEX idx_expiry (computed_at)
);

-- ==================== 分析信号 ====================
analysis_configs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    stock_id BIGINT NOT NULL REFERENCES stocks(id),
    name VARCHAR(100) NOT NULL,
    strategy_type ENUM('ma_cross', 'multi_indicator', 'ml_enhanced') DEFAULT 'ma_cross',
    params JSON NOT NULL,                           -- 灵活参数，替代固定 ma_short/ma_long 列
    confirm_bars INT DEFAULT 0,
    volume_confirm BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

analysis_signals (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    stock_id BIGINT NOT NULL REFERENCES stocks(id),
    config_id BIGINT NOT NULL REFERENCES analysis_configs(id),
    signal_type ENUM('golden_cross', 'death_cross', 'bullish_alignment', 'bearish_alignment', 'composite_buy', 'composite_sell') NOT NULL,
    strength ENUM('weak', 'normal', 'strong') DEFAULT 'normal',
    confidence DECIMAL(4,3),                        -- ★ 置信度 0.000-1.000
    signal_details JSON NOT NULL,                   -- ★ 灵活存储触发指标值
    price DECIMAL(12,4) NOT NULL,
    triggered_date DATE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_stock_active (stock_id, is_active, triggered_date)
);

-- ==================== AI 分析 ★ ====================
ai_analysis_results (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    signal_id BIGINT NOT NULL REFERENCES analysis_signals(id) ON DELETE CASCADE,
    model_provider VARCHAR(50) NOT NULL,            -- deepseek, openai, anthropic, ollama
    model_name VARCHAR(100) NOT NULL,               -- deepseek-chat, claude-haiku-4-5
    prompt_hash VARCHAR(64) NOT NULL,
    prompt_tokens INT DEFAULT 0,
    completion_tokens INT DEFAULT 0,
    total_cost DECIMAL(10,6) DEFAULT 0.000000,      -- USD
    analysis_json JSON NOT NULL,                    -- 结构化分析结果
    generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_signal (signal_id),
    INDEX idx_model (model_provider, model_name)
);

-- ==================== 回测 ★ ====================
backtest_jobs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    stock_id BIGINT NOT NULL REFERENCES stocks(id),
    config_id BIGINT NOT NULL REFERENCES analysis_configs(id),
    status ENUM('queued', 'running', 'completed', 'failed') DEFAULT 'queued',
    params JSON NOT NULL,                           -- 回测参数
    started_at DATETIME,
    completed_at DATETIME,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

backtest_results (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    job_id BIGINT NOT NULL REFERENCES backtest_jobs(id) ON DELETE CASCADE,
    total_return DECIMAL(8,4),
    cagr DECIMAL(8,4),
    max_drawdown DECIMAL(8,4),
    sharpe_ratio DECIMAL(8,4),
    sortino_ratio DECIMAL(8,4),
    calmar_ratio DECIMAL(8,4),
    win_rate DECIMAL(8,4),
    profit_factor DECIMAL(8,4),
    num_trades INT,
    avg_holding_days DECIMAL(6,1),
    benchmark_return DECIMAL(8,4),                  -- SPY/QQQ 同期收益
    equity_curve JSON NOT NULL,                     -- [{date, equity}, ...]
    drawdown_curve JSON,
    monthly_returns JSON,
    trade_log JSON,
    report_html TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ==================== 提醒系统 ★ ====================
notification_preferences (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE REFERENCES users(id),
    email_enabled BOOLEAN DEFAULT TRUE,
    push_enabled BOOLEAN DEFAULT FALSE,
    inapp_enabled BOOLEAN DEFAULT TRUE,
    sms_enabled BOOLEAN DEFAULT FALSE,
    digest_mode ENUM('realtime', 'daily', 'weekly') DEFAULT 'realtime',
    quiet_start TIME,                               -- 免打扰开始 (user local time)
    quiet_end TIME,
    timezone VARCHAR(50) DEFAULT 'America/New_York'
);

alert_rules (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    stock_id BIGINT NOT NULL REFERENCES stocks(id),
    alert_type ENUM('golden_cross', 'death_cross', 'any_signal', 'price_above', 'price_below', 'risk_change') NOT NULL,
    threshold DECIMAL(12,4),
    channels JSON NOT NULL,                         -- ["email", "push", "inapp"]
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

alert_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    alert_rule_id BIGINT REFERENCES alert_rules(id),
    user_id BIGINT NOT NULL REFERENCES users(id),
    stock_id BIGINT NOT NULL REFERENCES stocks(id),
    channel ENUM('email', 'push', 'inapp', 'sms') NOT NULL,
    template_key VARCHAR(100) NOT NULL,
    message TEXT NOT NULL,
    status ENUM('sent', 'failed', 'bounced', 'clicked') DEFAULT 'sent',
    provider_message_id VARCHAR(255),
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

notification_inbox (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    alert_log_id BIGINT REFERENCES alert_logs(id),
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_unread (user_id, is_read, created_at DESC)
);

push_device_tokens (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    platform ENUM('web', 'ios', 'android') DEFAULT 'web',
    token VARCHAR(500) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_user_device (user_id, token)
);

digest_queue (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    digest_type ENUM('daily', 'weekly') NOT NULL,
    content_json JSON NOT NULL,
    sent_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ==================== 自选 (不变) ====================
watchlists (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    name VARCHAR(100) NOT NULL DEFAULT '默认自选',
    sort_order INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

watchlist_items (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    watchlist_id BIGINT NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
    stock_id BIGINT NOT NULL REFERENCES stocks(id),
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_watchlist_stock (watchlist_id, stock_id)
);
```

---

## 5. API 设计概要

### 5.1 路由分组

```
/api/v1/
├── auth/                    # 公开
├── webhooks/                # 公开 (Stripe/Finnhub 回调)
├── stocks/                  # 需认证
├── analysis/                # 需认证 (信号 + 指标 + AI)
├── backtest/                # 需认证 (Pro only)
├── watchlist/               # 需认证
├── alerts/                  # 需认证
├── notifications/           # 需认证 (偏好 + 收件箱)
├── subscriptions/           # 需认证
├── payments/                # 需认证
└── admin/                   # 需认证 + admin role
```

### 5.2 用户端 API (User-Facing)

| Method | Endpoint | 说明 | 会员限制 | Phase |
|---|---|---|---|---|
| POST | `/auth/register` | 注册 | 无 | P1 |
| POST | `/auth/login` | 登录 | 无 | P1 |
| POST | `/auth/refresh` | 刷新 Token | 无 | P1 |
| GET | `/users/me` | 我的信息 | 所有 | P1 |
| PATCH | `/users/me` | 更新信息/语言偏好 | 所有 | P1 |
| GET | `/stocks` | 搜索/列表 | 所有 | P2 |
| GET | `/stocks/{id}` | 详情 | 所有 | P2 |
| GET | `/stocks/{id}/kline?period=day&limit=200` | K线 (OHLC + 预计算 MA20/MA60/RSI) | 按等级限制周期 | P2 |
| GET | `/analysis/{stock_id}/latest` | 最新信号 | Basic/Pro | P3 |
| GET | `/analysis/{stock_id}/history` | 信号历史 | Basic/Pro | P3 |
| POST | `/analysis/{stock_id}/indicators` | 多指标计算 | Pro | P3 |
| POST | `/analysis/{stock_id}/optimize` | 参数网格搜索优化 | Pro | P3 |
| GET | `/analysis/{stock_id}/ai` | AI 分析报告 (缓存) | Basic(10/d)/Pro(50/d) | P5 |
| POST | `/backtest/submit` | 提交回测任务 | Pro | P4 |
| GET | `/backtest/{job_id}` | 查询回测状态 | Pro | P4 |
| GET | `/backtest/{job_id}/report` | 下载回测报告 | Pro | P4 |
| GET/POST | `/watchlist` | 自选列表管理 | 按等级限制数量 | P2 |
| GET/POST/PATCH/DELETE | `/alerts` | 提醒 CRUD | Basic/Pro | P5 |
| GET | `/notifications/inbox` | 站内通知 | 所有 | P5 |
| PATCH | `/notifications/inbox/{id}/read` | 标记已读 | 所有 | P5 |
| GET/PUT | `/notifications/preferences` | 通知偏好 | 所有 | P5 |
| POST | `/notifications/push-token` | 注册推送设备 | 所有 | P5 |
| GET | `/subscriptions/me` | 我的订阅状态 | 所有 | P4 |
| GET | `/subscriptions/tiers` | 可用会员等级 | 所有 | P4 |
| POST | `/payments/create-checkout` | 创建 Stripe Checkout | 所有 | P4 |
| GET | `/payments/billing-portal` | Stripe Customer Portal URL | 所有 | P4 |

### 5.3 管理端 API (Admin)

| Method | Endpoint | 说明 |
|---|---|---|
| GET | `/admin/dashboard/stats` | MRR/用户数/信号数/支付概览 |
| GET/POST | `/admin/users` | 用户列表/创建 |
| GET/PATCH | `/admin/users/{id}` | 用户详情/编辑/封禁 |
| GET/POST | `/admin/stocks` | 标的管理 |
| PATCH/DELETE | `/admin/stocks/{id}` | 编辑/下架 |
| POST/PATCH | `/admin/tiers` | 会员等级配置 |
| GET | `/admin/signals` | 信号审核列表 |
| PATCH | `/admin/signals/{id}` | 修正信号 |
| POST/PATCH | `/admin/analysis-configs` | 分析策略配置 |
| GET | `/admin/payments` | 支付订单列表 |
| GET | `/admin/backtest-jobs` | 回测任务监控 |
| GET | `/admin/ai-usage` | AI 使用量统计 |

### 5.4 Webhook 端点 (公开)

| Method | Endpoint | 用途 |
|---|---|---|
| POST | `/webhooks/stripe` | Stripe 事件回调 (验签 + 幂等) |
| POST | `/webhooks/finnhub` | Finnhub 实时行情 WebSocket 降级回调 |

### 5.5 通用 API 约定

- 分页: `?page=1&size=20` → `{ items: [], total, page, size, pages }`
- 排序: `?sort_by=created_at&order=desc`
- 错误: `{ detail: "message", code: "ERROR_CODE" }`
- 全局限流: Redis 令牌桶，按会员等级限制每日/每分钟请求数
- 日期格式: ISO 8601 (`YYYY-MM-DD`)
- 认证: `Authorization: Bearer <access_token>` (用户端 + 管理端)
- API Key: 后续为第三方集成添加 `X-API-Key` 模式 (Phase 6+)

---

## 6. 分析引擎设计

### 6.1 分层分析架构

```
┌─────────────────────────────────────────────────────────┐
│                    Analysis Engine                       │
│                                                         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │ Layer 1     │───▶│ Layer 2     │───▶│ Layer 3     │  │
│  │ Rule-Based  │    │ ML-Enhanced │    │ LLM-Confirmed│  │
│  │ (all tiers) │    │ (Pro tier)  │    │ (Pro tier)  │  │
│  │ < 1ms       │    │ < 100ms     │    │ < 3s         │  │
│  └─────────────┘    └─────────────┘    └─────────────┘  │
│                                                         │
│  Signal Router: 根据 confidence 决定是否进入下一层      │
└─────────────────────────────────────────────────────────┘
```

### 6.2 Layer 1: 规则型信号 (Phase 1-3)

| 信号 | 条件 | 强度 |
|---|---|---|
| 金叉 (golden_cross) | MA_short 上穿 MA_long | normal / strong (放量) |
| 死叉 (death_cross) | MA_short 下穿 MA_long | normal / strong (放量) |
| 多头排列 (bullish_alignment) | MA5 > MA20 > MA60 > MA120 | strong |
| 空头排列 (bearish_alignment) | MA5 < MA20 < MA60 < MA120 | strong |
| 复合买入 (composite_buy) | 加权综合分 > 0.5 | normal |
| 复合卖出 (composite_sell) | 加权综合分 < -0.5 | normal |

**综合评分公式** (from [005]):

```
composite_score = tanh(
    0.20 × MA_cross_signal +
    0.15 × RSI_signal +
    0.20 × MACD_signal +
    0.15 × BB_signal +
    0.15 × Volume_signal +
    0.15 × ROC_signal
)
→ clipped to [-1, 1] → bin to STRONG_SELL / SELL / HOLD / BUY / STRONG_BUY
```

### 6.3 Layer 2: ML 增强 (Phase 4+, Pro)

- **XGBoost**: 特征信号 → 分类概率 (日线特征 + 技术指标 + 市场环境)
- **LSTM**: 时序预测方向 (过去 60 天 OHLCV)
- **FinBERT**: 新闻/社交媒体情绪得分
- **触发条件**: Layer 1 信号 confidence ≥ 0.3 时进入

### 6.4 Layer 3: LLM 确认 (Phase 5+, Pro)

- **触发条件**: Layer 1+2 信号 confidence ≥ 0.6
- **流程**: 构建 Prompt (Stock Context + Technical Context + Price Action) → LLM 生成结构化分析 → 验证事实一致性 → 存储结果
- **模型路由**: DeepSeek V4-Flash (Basic) / Claude Haiku 4.5 (Pro 主力) / GPT-5.4-mini (Pro 备用)
- **输出**: 为什么买卖 + 风险列表 + 止损位 + 目标位 + 置信度 (详见 [009])

### 6.5 确认机制与防抖

- `confirm_bars`: 交叉后需连续 N 根 K 线确认
- `volume_confirm`: 交叉日成交量需 > 20日均量 × 1.5
- **Whipsaw Filter**: 5 日内买卖信号反转且价格波动 < 2% → 移除前信号
- 信号去重: 同一 (stock_id, config_id, signal_type) 在 20 个交易日内不重复生成

### 6.6 风险等级评估 (from [005])

```
risk_level =
    IF bearish_alignment THEN "high"
    IF MA20 < MA60 AND MA60 > MA120 THEN "elevated"
    IF bullish_alignment THEN "low"
    IF ATR_percentile > 80 THEN "elevated" (高波动)
    ELSE "moderate"
```

### 6.7 数据同步策略 (from [002])

```
APScheduler Job: sync_daily_prices
  执行时间: 美东 16:30
  源: yfinance (EOD) + Finnhub (实时验证)
  策略:
    - 增量: 按 trade_date 去重
    - 回溯: 新标的首次拉取 2 年
    - 分批: 10 标的/批，间隔 2s
    - 退避: 429 → 暂停 60s
    - 本地缓存: Parquet 文件 + MySQL 双写

APScheduler Job: scan_signals
  执行时间: sync_daily_prices 完成后
  处理: 计算指标 → 检测信号 → 确认 → 写入 → 触发提醒

APScheduler Job: precompute_indicators
  执行时间: sync_daily_prices 完成后
  处理: 预计算活跃标的的全部指标 → 写入 indicator_cache → 设置 24h Redis TTL
```

---

## 7. 会员体系设计 (from [001])

### 7.1 三档权益矩阵

| 维度 | 免费 (Free) | 基础 (Basic) | 专业 (Pro) |
|---|---|---|---|
| **价格 (月/年)** | $0 | **$9.99 / $99** (17% off) | **$29.99 / $299** (17% off) |
| **K 线周期** | 日线 (延迟1日) | 日/周线 | 全部 (日/周/月/季/年) |
| **K 线历史** | 3 个月 | 2 年 | 全部 (10年+) |
| **自选上限** | 5 | 30 | 无限制 |
| **买卖信号** | 无 | 金叉/死叉 | 全部信号 (含排列+复合) |
| **技术指标** | MA (SMA/EMA) | MA + RSI + MACD | 全部 252+ |
| **AI 分析** | 无 | 10 次/天 (DeepSeek) | 50 次/天 (Claude/GPT) |
| **回测** | 无 | 无 | 10 次/天 |
| **风险等级** | 无 | 有 | 有 + 详细报告 |
| **提醒渠道** | 无 | 邮件 | 邮件 + Push + 站内 |
| **提醒数量** | 0 | 10 | 30 |
| **API 日限额** | 100 | 1000 | 10000 |
| **数据导出** | 无 | 无 | CSV |
| **客服** | FAQ | 邮件 | 优先 |

### 7.2 到期/降级策略

- 到期当天赠送 **3 天宽限期**，宽限期内维持原权限
- 宽限期后自动降为免费档
- 自选超出部分转为只读（可查看和移除，不可添加）
- 提醒超出数量部分自动暂停
- AI 分析次数清零，缓存的分析结果仍可查看

---

## 8. 支付集成方案 (from [008])

### 8.1 Stripe Checkout (主方案)

```
流程:
  1. 用户选择 tier + period → 前端 POST /payments/create-checkout
  2. 后端 stripe.checkout.Session.create(
       mode="subscription",
       line_items=[{price: stripe_price_id, quantity: 1}],
       payment_method_types=["card", "alipay", "wechat_pay"],  # 内置支持
       allow_promotion_codes=True,
       automatic_tax={enabled: true},
       success_url / cancel_url
     )
  3. 返回 {url} → 前端 302 跳转 Stripe Checkout 页面
  4. 支付完成 → Stripe Webhook → POST /webhooks/stripe
     → construct_event() 验签
     → IdempotencyGuard (Redis SETNX, 7 天)
     → 事件分发:
       - checkout.session.completed → 创建 PaymentOrder
       - customer.subscription.updated → 更新 UserSubscription
       - customer.subscription.deleted → 标记过期
       - invoice.payment_succeeded → 续期
       - invoice.payment_failed → 标记 past_due，发提醒
```

### 8.2 Customer Portal (订阅管理)

用户通过 `GET /payments/billing-portal` 获取 Stripe Customer Portal URL，可自助：
- 升级/降级套餐 (升即生效 proration，降下周期生效)
- 更新支付方式
- 查看发票历史
- 取消订阅

### 8.3 支付宝/微信支付

**Phase 1-6: 不需要独立集成**。Stripe Checkout 已内置支持支付宝和微信支付，只需在 `payment_method_types` 中添加即可，无需中国营业执照或 ICP 备案。

**Phase 7+ (如果 Stripe 不可用)**: 再考虑独立接入支付宝 Global API 或微信支付 API V3。

### 8.4 支付架构

```python
# 统一抽象接口
class PaymentProvider(ABC):
    async def create_checkout_session(user, tier, period, success_url, cancel_url) -> CheckoutSession
    async def handle_webhook(payload, signature) -> None
    async def get_subscription(subscription_id) -> Subscription
    async def cancel_subscription(subscription_id) -> None
    async def update_subscription(subscription_id, new_price_id) -> None
    async def get_portal_url(user, return_url) -> str

# Phase 1 仅 Stripe
class StripeProvider(PaymentProvider):
    ...
```

---

## 9. 认证与安全

### 9.1 JWT 双令牌

| 令牌 | 有效期 | 用途 |
|---|---|---|
| Access Token | 30 分钟 | API 请求鉴权 |
| Refresh Token | 30 天 (可续) | 续期 Access Token，存储在 user_sessions 表 |

### 9.2 权限模型

```
Role:
  - user  → 访问用户端 API，操作自身数据
  - admin → 访问管理端 API，操作全局数据

会员限流 (subscription_guard middleware):
  1. 从 JWT 提取 user_id
  2. 查 Redis 获取当前订阅 tier
  3. 校验 tier 权益 (K线周期/自选数/提醒数/API限额/AI次数)
```

### 9.3 限流实现

```
Redis Token Bucket:
  Key:  rate_limit:{user_id}:{endpoint}:{window}
  Window: 1min (短窗口) + 1day (长窗口)
  Response headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
```

### 9.4 安全决策

| 决策 | 结论 | 理由 |
|---|---|---|
| Bearer Token vs API Key | 用户端用 Bearer Token，Phase 6+ 加 API Key | [009] 建议分阶段 |
| IP 白名单 | 管理端可选 | 按需开启 |
| 2FA | Phase 1 不做 | 后期按需添加 |
| Webhook 验签 | Stripe 必须验签 (construct_event) | [008] |
| CORS | 白名单 (管理端 + 用户端域名) | - |

---

## 10. K 线图表 (from [003])

### 10.1 技术选型

- **TradingView Lightweight Charts v5.2.0** — Apache 2.0 免费商用，59.6 kB gzipped，Canvas 渲染
- **不选择** TradingView Advanced Charts — 需付费且指标非控制

### 10.2 Next.js 集成方式

```typescript
// components/charts/KlineChart.tsx
import dynamic from 'next/dynamic';

const KlineChart = dynamic(() => import('./KlineChartInner'), {
  ssr: false,       // 关键：禁用 SSR (Canvas API 仅浏览器)
  loading: () => <Spin />,
});
```

### 10.3 图表布局

```
┌────────────────── KlineChart ──────────────────┐
│  CandlestickSeries (OHLC)                       │
│  + LineSeries (MA20, orange)                    │
│  + LineSeries (MA60, blue)                      │
│  + LineSeries (MA120, purple)                   │
│  + Markers (buy ▲ green, sell ▼ red)            │
├─────────────────────────────────────────────────┤
│  HistogramSeries (Volume, separate pane)        │
│  + LineSeries (Volume MA20, gray)               │
├─────────────────────────────────────────────────┤
│  TimeScale buttons: 1D | 1W | 1M | 3M | 1Y     │
└─────────────────────────────────────────────────┘
```

### 10.4 后端 K 线 API 返回格式

```json
// GET /stocks/SPY/kline?period=day&limit=200
{
  "symbol": "SPY",
  "period": "day",
  "data": [{
    "time": "2026-06-09",
    "open": 525.10, "high": 528.50, "low": 524.20, "close": 527.80,
    "volume": 65000000,
    "ma20": 521.45, "ma60": 515.30, "ma120": 508.75,
    "rsi14": 58.2,
    "signal": null  // or {type: "golden_cross", strength: "strong"}
  }]
}
```

---

## 11. 回测系统 (from [006])

### 11.1 架构

```
POST /backtest/submit  →  ARQ Queue  →  vectorbt engine  →  QuantStats report
        │                      │
   BacktestJob(status=queued)  BacktestJob(status=running→completed)

GET /backtest/{id}  →  {status, progress, result_summary}
GET /backtest/{id}/report  →  HTML tear sheet (含 equity curve, drawdown, monthly heatmap)
```

### 11.2 核心指标

| 指标 | 公式 | 参考值 |
|---|---|---|
| Sharpe Ratio | (Rp - Rf) / σp | > 1.0 good |
| Sortino Ratio | (Rp - Rf) / σd | > 1.5 good |
| Max Drawdown | max(peak - trough) / peak | < 20% good |
| Win Rate | winning / total | > 40% acceptable |
| Profit Factor | gross_profit / gross_loss | > 1.5 good |
| CAGR | (final/initial)^(1/years) - 1 | 对比 benchmark |

### 11.3 现实化参数

- 滑点: ≥ 0.05%/边
- 手续费: 0.1%/笔 (安全边际)
- 无未来函数: 全部 shift(1)
- 样本外: ≥ 30%
- 最少交易: ≥ 50 笔

### 11.4 参数优化 (Optuna)

- 简单策略 (<4参数): Grid Search (vectorbt `run_combs`)
- 复杂策略: Optuna Bayesian + TPE + Median Pruning
- 过拟合检测: Deflated Sharpe Ratio, IS/OOS gap < 30%

---

## 12. 通知系统 (from [007])

### 12.1 事件驱动架构

```
AnalysisEngine.signal_generated
    → SignalGeneratedEvent
        → NotificationDispatcher
            → 检查用户偏好 (quiet hours, digest mode, per-stock toggles)
            → ChannelAdapter.dispatch()
                ├── EmailChannel (Resend)
                ├── PushChannel (OneSignal)
                ├── InAppChannel (WebSocket + Redis Pub/Sub)
                └── SMSChannel (延期)
```

### 12.2 摘要模式

- **Real-time**: 信号触发即时发送 (Pro 默认)
- **Daily Digest**: 美东 18:00 汇总当天所有信号 (Basic 默认)
- **Weekly Digest**: 周日 18:00 汇总本周市场表现

### 12.3 模板系统 (中英双语)

```
TEMPLATES["zh"]["golden_cross"] = (
    "📈 {symbol} 金叉信号触发！\n"
    "MA{short}({short_val}) 上穿 MA{long}({long_val})\n"
    "当前价格: ${price}\n"
    "建议: 关注回调确认后建仓"
)
```

### 12.4 可靠性

- 重试: 3 次指数退避 (1s → 2s → 4s)
- 死信队列: `notification_dlq` 表
- 用户限流: Redis 10/hr, 50/day per user per channel
- Webhook 验签: Resend 签名验证

---

## 13. AI 分析报告 (from [009])

### 13.1 模型分层路由

```
用户请求 AI 分析
  → AIAnalysisService.analyze()
    → 检查会员等级 + 日配额
    → 检查缓存 (ai_analysis:{symbol}:{signal}:{date}:{model}:{hash})
    → AIRouter.route(priority)
       Free:  → RuleBasedAnalyzer (模板填充, $0)
       Basic: → DeepSeek Flash ($0.00043/次) → fallback Gemini Flash → fallback 模板
       Pro:   → Claude Haiku ($0.0055/次) → fallback GPT-mini → fallback DeepSeek Flash
    → 事实验证 (7 checks) → 存储 → 返回
```

### 13.2 输出结构

```json
{
  "symbol": "SPY",
  "signal_type": "golden_cross",
  "signal_strength": "strong",
  "analysis": {
    "summary": "SPY 触发强金叉...",
    "why_buy": ["均线交叉确认...", "成交量放大...", "RSI 55 有上行空间..."],
    "risks": ["前高 $525 阻力...", "VIX 20 以上波动偏高...", "FOMC 会议风险..."],
    "stop_loss": {"price": 505.50, "percentage_down": 3.8, "reasoning": "跌破 MA60 和近期低点"},
    "targets": [{"price": 540, "percentage_up": 2.9, "type": "近期阻力"}, {"price": 555, "percentage_up": 5.7, "type": "历史高点"}],
    "confidence": 0.75,
    "time_horizon": "2-4 周"
  },
  "disclaimer": "⚠️ 以上为 AI 生成的参考分析，不构成投资建议。投资有风险，入市需谨慎。\n⚠️ This is AI-generated analysis for reference only, not financial advice.",
  "generated_at": "2026-06-09T16:30:00Z"
}
```

### 13.3 安全合规

- 输出中禁用 "买入"/"卖出" 等确定性建议词 — 用 "关注"、"警惕"、"参考"
- 中英双语免责声明
- 7 项事后验证 (价格不为幻觉、免责声明存在、置信度 0-1、无保证性承诺、数据一致性、目标合理性、语言匹配)
- 缓存命中直接返回，不重复消耗 token

---

## 14. 指标插件系统 (from [004])

### 14.1 架构

```python
# BaseIndicator ABC
class BaseIndicator(ABC):
    metadata: ClassVar[IndicatorMetadata]  # name, params, outputs, category
    @abstractmethod
    def compute(df: pd.DataFrame, **params) -> IndicatorResult: ...

# Registry with auto-discovery
class IndicatorRegistry:
    def discover_builtin()     # 扫描 indicators/ 目录
    def discover_entry_points() # setuptools entry_points: trendscope.indicators
    def discover_custom(path)   # 自定义目录
    def get(name) -> BaseIndicator
    def list_all() -> list[IndicatorMetadata]
```

### 14.2 参数覆盖层级 (5 级)

```
Request params (最高优先级)
  → Stock overrides (stock_indicator_overrides 表)
    → Tier presets (indicator_presets 按会员等级)
      → System defaults (代码硬编码)
        → Library defaults (pandas-ta 默认)
```

### 14.3 多时间框架

```
MultiTimeframeAnalyzer:
  - 日线 → W-FRI resample → 月线 ME resample → 季线 QE resample
  - 信号汇集 (confluence): 日线看涨 + 周线看涨 → stronger signal
  - 性能: 100 stocks × 3 timeframes × 12 indicators ≈ 1.2s (预计算缓存后 ≈ 0)
```

---

## 15. 开发阶段规划 (v2)

| Phase | 内容 | 新增模块 | 产出 |
|---|---|---|---|
| **P1** | 项目骨架 + DB + 认证 | core/, models/, auth API, Docker Compose | 能注册/登录的 API |
| **P2** | 数据层 + K线 | stock_data.py, data_adapter.py, stocks API | 能查日线 K 线 |
| **P3** | 规则型分析引擎 | analysis_engine.py (Layer 1), indicator_engine.py, signals API | 能看金叉/死叉 |
| **P4** | 会员 + 支付 (Stripe) | payment_service.py, subscription_service.py, Stripe webhook | 能付费订阅 |
| **P5** | 提醒 + AI 分析 | alert_service.py, ai_analysis_service.py, 通知渠道 | 能收提醒 + AI 报告 |
| **P6** | 管理前端 | Next.js admin 全部页面 | 管理端可用 |
| **P7** | 回测系统 | backtest_service.py, ARQ queue, QuantStats | 能跑策略回测 |
| **P8** | ML 增强 (Layer 2) | XGBoost/LSTM 集成, FinBERT | 更精准信号 |
| **P9** | 插件市场 + 扩展 | entry_points 指标插件, 多数据源扩展 | 社区贡献 |

---

## 16. 已解决的研究问题 (来自 v1 §11)

| # | 原问题 | 结论 | 出处 |
|---|---|---|---|
| Q1 | yfinance 稳定性 | yfinance 主数据源 + Finnhub 实时备用 + Parquet 本地缓存 | [002] |
| Q2 | 支付宝/微信营业执照 | Phase 1-6 不需要。Stripe Checkout 内置支持支付宝/微信支付 | [008] |
| Q3 | 邮件服务选型 | Resend Pro ($20/mo) 主力 + AWS SES 备用 | [007] |
| Q4 | 推送通知实现 | OneSignal Web Push (Free) + WebSocket 站内通知 | [007] |
| Q5 | LWC 在 Next.js 集成 | dynamic(ssr:false) + useRef/useEffect，无需 wrapper 库 | [003] |
| Q6 | Redis 是否 Phase 1 需要 | 是。限流、会话缓存、分析结果缓存均需 Redis | [006][007] |
| Q7 | MySQL 字符集和时区 | utf8mb4_unicode_ci，UTC 存储，API 层转换 | - |
| Q8 | 日志监控 | Phase 1: structlog 日志 + 本地文件；Phase 6+: Prometheus + Grafana | - |
| Q9 | API 文档 | FastAPI 内置 Swagger UI (/docs)，无需独立文档站 | - |
| Q10 | WebSocket 行情推送 | 用户端需要时通过 Finnhub WebSocket 转发，API 设计预留 | [002] |

---

## 17. 仍待研究的问题

| # | 问题 | 相关 Phase | 优先级 |
|---|---|---|---|
| Q11 | ARQ vs Celery for async tasks — 最终选择 | P7 | 中 |
| Q12 | 前端 K 线组件是否需要 Web Worker 处理大数据量 | P6 | 低 |
| Q13 | 是否需要 CDN 加速 K 线历史数据加载 | P6 | 低 |
| Q14 | 用户端技术栈选型 (React Native / Flutter / 小程序) | 用户端项目 | 中 |
| Q15 | GDPR / CCPA 数据合规 (若服务欧盟/加州用户) | P1 | 低 |
| Q16 | 杠杆 ETF (TQQQ/SOXL) 的衰减损耗计算模型 | P3 | 中 |
| Q17 | Finnhub WebSocket 数据实时推送到前端的架构 | P2 | 低 |

---

## 18. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1 | 2026-06-09 | 初稿：技术选型、目录结构、DB 模型、API 轮廓、8 阶段规划 |
| v2 | 2026-06-09 | Post-Research 更新：整合 9 项研究结论。新增分层分析引擎、指标插件系统、回测系统、AI 分析、通知架构、支付简化(Stripe 内置支付宝/微信)、K线详细设计、16 个未解决问题收束。新增 15 张数据库表、20+ API 端点。 |
