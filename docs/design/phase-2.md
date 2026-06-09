# Phase 2 — 后续功能规划

> **Status**: Draft — 需根据 Phase 1 完成情况更新  
> **Date**: 2026-06-09  
> **Purpose**: Phase 1 之后的功能路线图。各项的优先级和范围将根据 Phase 1 的反馈和市场情况进行调整。
>
> **参考设计文档**:
> - [001-preliminary-design.md](./001-preliminary-design.md) — 总体架构
> - [002-database-schema.md](./002-database-schema.md) — 完整 26 张表 DDL
> - [005-payment-subscription.md](./005-payment-subscription.md) — 支付订阅
> - [007-backtest-system.md](./007-backtest-system.md) — 回测增强 (Phase 1 已含基础回测)
> - [008-ai-analysis-system.md](./008-ai-analysis-system.md) — AI 分析
> - [009-indicator-plugin-system.md](./009-indicator-plugin-system.md) — 指标插件

---

## ⚠️ 重要说明

Phase 2 各模块的详细规格、优先级和排期需要在 Phase 1 完成后根据以下因素重新评估：

- Phase 1 的用户反馈和实际使用数据
- 技术债务清理优先级
- 数据源稳定性（yfinance 是否持续可用）
- DeepSeek API 的长期可用性和定价变化
- 是否有实际付费用户需求驱动会员体系开发
- 自定义策略脚本的实际使用率和安全评估

**切勿在 Phase 1 完成前启动 Phase 2 的任何开发工作。**

---

## Phase 2 功能总览

### P2-1: 支付与会员体系

**参考**: [005-payment-subscription.md](./005-payment-subscription.md)

| 功能 | 说明 | 数据库表 |
|---|---|---|
| Stripe Checkout 集成 | 创建 checkout session + webhook 处理 | `payment_orders` |
| Customer Portal | 用户自助管理订阅 | - |
| 三级会员制 | Free / Basic ($9.99/mo) / Pro ($29.99/mo) | `subscription_tiers`, `user_subscriptions` |
| 会员权益限流 | API 限额、K 线周期限制、AI 次数限制 | 新增 middleware |
| Revenue 分析 | MRR/ARR/Churn/LTV 统计 (Admin) | - |
| 优惠券系统 | Stripe Promotion Code | - |
| 宽限期/降级策略 | 3 天宽限 + 自动降级 | 新增 APScheduler job |

**更新点**: Phase 1 期间需确认目标用户群的付费意愿和价格接受度。

---

### P2-2: 通知系统增强

**参考**: [006-notification-system.md](./006-notification-system.md)

| 功能 | 说明 | 数据库表 |
|---|---|---|
| Web Push 通知 | OneSignal 集成，浏览器推送 | `push_device_tokens` |
| 站内通知 | WebSocket + Redis Pub/Sub 实时推送 | `notification_inbox` |
| 通知偏好 | 渠道开关、免打扰时段、摘要模式 | `notification_preferences` |
| 每日/每周摘要 | 定时汇总邮件 | `digest_queue` |
| SMS 通知 | Twilio (按需) | - |
| 通知可靠性 | 重试、DLQ、去重 | `notification_dlq` |
| 多语言模板 | 英文 + 中文通知模板 | - |

**更新点**: Phase 1 仅邮件通知，Phase 2 根据用户分布决定是否加 Push/SMS。

---

### P2-3: 回测系统增强

**参考**: [007-backtest-system.md](./007-backtest-system.md)

> **Phase 1 已实现**: 基础回测 (同步执行、vectorbt、10 项核心指标、权益/回撤曲线、SPY 基准对比)。
> Phase 2 增强以下功能：

| 功能 | 说明 | 数据库表 |
|---|---|---|
| 异步回测队列 | ARQ (Redis) 任务队列，支持并发/进度查询 | `backtest_jobs` ★ 新增 |
| HTML 报告 | QuantStats tear sheet 一键生成 | - |
| 参数优化 | Grid Search + Optuna Bayesian 自动寻优 | - |
| 过拟合检测 | Walk-Forward + Deflated Sharpe Ratio | - |
| 回测对比 | 多个策略回测结果横向对比 | - |
| 回测分享 | 生成回测报告分享链接 | - |

**更新点**: Phase 1 回测性能基线决定 ARQ 迁移的必要性和优先级。

---

### P2-4: ML 增强分析 (分析引擎 Layer 2)

**参考**: [004-analysis-engine.md](./004-analysis-engine.md), [005-analysis-engine.md](../research/005-analysis-engine.md)

| 功能 | 说明 |
|---|---|
| XGBoost 信号分类 | 日线特征 + 技术指标特征 → 信号概率 |
| LSTM 时序预测 | 60 天 OHLCV → 方向预测 |
| FinBERT 情绪 | 新闻/社交媒体情绪得分 |
| ML 模型训练管道 | 离线训练 + 模型版本管理 |
| 信号置信度评分 | 规则 + ML 综合置信度 |
| 模型 A/B 测试 | 新旧模型效果对比 |

**更新点**: 需评估 Phase 1 的规则型信号准确率，决定 ML 增强的 ROI。需要大量历史数据训练。

---

### P2-5: 指标插件系统

**参考**: [009-indicator-plugin-system.md](./009-indicator-plugin-system.md)

| 功能 | 说明 | 数据库表 |
|---|---|---|
| BaseIndicator ABC | 标准化指标接口 | - |
| IndicatorRegistry | 自动发现 + 动态加载 + 缓存 | - |
| 14 个内置指标 | SMA/EMA/MACD/RSI/Bollinger/ATR/OBV/VWAP/Stochastic/ADX/Ichimoku/Fibonacci | - |
| 多时间框架 | 日/周/月/季 自动 resample | - |
| 参数覆盖 | 5 级参数优先级 (请求→标的→等级→系统→默认) | `indicator_presets`, `stock_indicator_overrides` |
| 指标缓存 | 预计算 + Redis 缓存 | `indicator_cache` |
| entry_points 插件 | pip-installable 第三方指标包 | - |

**更新点**: Phase 1 仅 MA/RSI/MACD 三种内置指标，Phase 2 完整插件化。

---

### P2-6: 用户端功能

| 功能 | 说明 | 数据库表 |
|---|---|---|
| 自选列表 | 用户自定义 watchlist | `watchlists`, `watchlist_items` |
| 多语言 | 英文界面 (已有中文) | - |
| API Key | 第三方应用接入 (X-API-Key) | 新增 `api_keys` 表 |
| WebSocket 行情 | 实时价格推送 (Finnhub 转发) | - |

**更新点**: 取决于用户端项目（独立 Web/移动 App）何时启动。

---

### P2-7: 平台增强

| 功能 | 说明 |
|---|---|
| 实时数据源 | Finnhub WebSocket 集成，替换纯 EOD |
| 付费数据源 | Polygon.io Advanced ($199/mo) 按需接入 |
| 数据源适配器 | Multi-Provider Adapter Layer (数据源自动切换) |
| 审计日志 | Admin 操作审计 (audit_log 表) |
| Prometheus + Grafana | 生产监控 |
| CI/CD | GitHub Actions 自动部署 |
| 支付宝/微信独立集成 | 如 Stripe 不可用时的备用方案 |
| App Store IAP | 若出移动客户端 |

---

### P2-8: AI 分析增强

**参考**: [008-ai-analysis-system.md](./008-ai-analysis-system.md)

| 功能 | 说明 |
|---|---|
| 多模型支持 | Claude/GPT/DeepSeek 多提供商路由 |
| 模型降级链 | Primary → Fallback → Rule-based template |
| 安全验证器 | 7 项安全检查 (已在 Phase 1 实现基础版) |
| 分析缓存 | Redis 24h TTL + prompt hash 去重 |
| 成本追踪 | 每用户每日 token 消耗统计 |
| 自定义 Prompt | Admin 可调整分析 Prompt |
| 批量分析 | 每日摘要自动生成 |
| 本地模型 | Ollama + Qwen 2.5 自部署 (降本) |

**更新点**: Phase 1 仅 DeepSeek 单一模型 + 规则降级。多模型路由在 Phase 2 按需添加。

---

## Phase 2 数据库表补充

Phase 2 需要新建以下表 (已在 [002-database-schema.md](./002-database-schema.md) 中定义 DDL)：

| 表 | Phase | 用途 |
|---|---|---|
| `subscription_tiers` | P2-1 | 会员等级 |
| `user_subscriptions` | P2-1 | 用户订阅 |
| `payment_orders` | P2-1 | 支付订单 |
| `indicator_presets` | P2-5 | 指标预设 |
| `indicator_preset_items` | P2-5 | 预设指标项 |
| `stock_indicator_overrides` | P2-5 | 标的指标覆盖 |
| `indicator_cache` | P2-5 | 指标预计算缓存 |
| `backtest_jobs` | P2-3 | 异步回测任务队列 (Phase 1 无此表，直接写入 backtest_results) |
| `backtest_results` | P1 | 回测结果 (Phase 1 已建) |
| `notification_preferences` | P2-2 | 通知偏好 |
| `notification_inbox` | P2-2 | 站内通知 |
| `push_device_tokens` | P2-2 | 推送设备 |
| `digest_queue` | P2-2 | 摘要队列 |
| `notification_dlq` | P2-2 | 通知死信 |
| `watchlists` | P2-6 | 自选列表 |
| `watchlist_items` | P2-6 | 自选项目 |

---

## Phase 2 预估开发顺序

```
Phase 1 完成 + 稳定运行
    │
    ├── P2-1 支付与会员 (如有付费需求验证)
    │       └── P2-2 通知增强 (付费用户更需多渠道路通知)
    │
    ├── P2-3 回测系统 (高价值功能，驱动 Pro 转化)
    │
    ├── P2-6 用户端功能 (取决于用户端项目启动时间)
    │
    ├── P2-5 指标插件系统 (提升策略灵活性)
    │
    ├── P2-4 ML 增强 (需足够训练数据)
    │
    └── P2-7 + P2-8 (平台增强 + AI 增强)
```

> **注意**: 以上顺序为建议，实际排期以 Phase 1 完成后的评估为准。

---

## 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1 | 2026-06-09 | 初稿：基于 Phase 1 范围划定 Phase 2 全部功能模块 |
