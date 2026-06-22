# Phase 2 — 后续功能规划

> **Status**: ✅ Planning — Phase 1 Completed 2026-06-23  
> **Date**: 2026-06-09 (Initial) / 2026-06-23 (Updated)  
> **Purpose**: Phase 1 之后的功能路线图。基于 Phase 1 实际实现情况重新校准各项优先级和范围。
>
> **参考设计文档**:
> - [001-preliminary-design.md](./001-preliminary-design.md) — 总体架构
> - [002-database-schema.md](./002-database-schema.md) — 完整 26 张表 DDL
> - [005-payment-subscription.md](./005-payment-subscription.md) — 支付订阅
> - [007-backtest-system.md](./007-backtest-system.md) — 回测增强 (Phase 1 已含完整基础回测)
> - [008-ai-analysis-system.md](./008-ai-analysis-system.md) — AI 分析
> - [009-indicator-plugin-system.md](./009-indicator-plugin-system.md) — 指标插件

---

## Phase 1 完成基线

Phase 1 MVP 已完整交付，以下功能已在 Phase 1 中实现，**不再列入 Phase 2**：

| 功能 | Phase 1 实际实现 | 原以为属于 Phase 2 |
|---|---|---|
| 回测多策略对比 | 已实现：归一化收益曲线叠加 + 指标对比表 | P2-3 不再需要 |
| 权益/回撤曲线 | 已实现：产品级暗色金融 SVG 图表 | P2-3 不再需要 |
| 11 种策略模板 | 已实现：MA/EMA/RSI/MACD/Bollinger/Donchian/Mom/Z/Vol/Trend+RSI/Buy&Hold | 原以为仅 3 种 |
| 结构化策略协议 | 已实现：target_position/confidence/reason/ai_context | 新增协议，Phase 2 扩展 |
| 自定义 Python 脚本 | 已实现：pandas/numpy + AST 沙箱，支持 DataFrame 返回 | P2-5 的基础已在 P1 |
| AI 运行时配置 | 已实现：管理面板 `PATCH /admin/ai-config`，即时生效 | P2-8 部分已提前 |
| 多 API 提供商支持 | 已实现：任何 OpenAI 兼容 API 均可配置 | P2-8 部分已提前 |
| 公共策略库 | 已实现：5 个 stock_id=None 的公共结构化策略 | 新增 |

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

> **Phase 1 已知**: 当前用户认证已实现 JWT + 角色系统 (admin/user)，支付接入可直接复用。无需改动认证体系。

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
| 多语言模板 | 英文 / 中文通知模板 | - |

> **Phase 1 已知**: 邮件通知已实现 (Resend + 去重 + 信号→规则→邮件流程)，Phase 2 在其基础上扩展渠道。

---

### P2-3: 回测系统增强

**参考**: [007-backtest-system.md](./007-backtest-system.md)

> **Phase 1 已实现**: 自研 BacktestService (pandas 模拟，非 vectorbt)；10 项核心指标；权益/回撤曲线（产品级暗色 SVG 图表）；月度收益分布；交易明细；多策略归一化对比；信号模式 + 目标仓位调仓模式；滑点/手续费会计修正；精度保存 (DECIMAL(18,6) + 原始序列计算指标)。

| 功能 | 说明 | 数据库表 |
|---|---|---|
| 异步回测队列 | ARQ (Redis) 任务队列，支持并发/进度查询 | `backtest_jobs` ★ 新增 |
| HTML 报告 | QuantStats tear sheet 一键生成 | - |
| 参数优化 | Grid Search + Optuna Bayesian 自动寻优 | - |
| 过拟合检测 | Walk-Forward Analysis + Deflated Sharpe Ratio | - |
| 回测分享 | 生成回测报告分享链接 | - |
| 做空支持 | 扩展 target_position 负数段，完整双向交易 | - |
| 多资产回测 | 一个回测配置包含多个标的，策略择时轮动 | - |

> **Phase 1 已知**: 回测引擎已是自研（非 vectorbt），直接在此基础上添加异步队列和优化器即可。基础对比和图表已完工，Phase 2 聚焦性能和自动化。

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
| ML 特征落库 | 将 ML 特征作为策略 `df` 的扩展列，策略脚本可直接消费 |

> **Phase 1 已知**: 策略脚本已有 `ai_context` 字段可传递 AI/ML 上下文。Phase 2 可将 ML 输出作为策略 `df` 的附加列 (`sentiment_score`、`ai_risk_score`、`ai_regime`)，实现策略脚本消费 ML 结果的闭环。

---

### P2-5: 指标插件系统

**参考**: [009-indicator-plugin-system.md](./009-indicator-plugin-system.md)

| 功能 | 说明 | 数据库表 |
|---|---|---|
| BaseIndicator ABC | 标准化指标接口 | - |
| IndicatorRegistry | 自动发现 + 动态加载 + 缓存 | - |
| 40+ 内置指标 | SMA/EMA/MACD/RSI/Bollinger/ATR/OBV/VWAP/Stochastic/ADX/Ichimoku/Fibonacci 等 | - |
| 多时间框架 | 日/周/月/季 自动 resample | - |
| 参数覆盖 | 5 级参数优先级 (请求→标的→等级→系统→默认) | `indicator_presets`, `stock_indicator_overrides` |
| 指标缓存 | 预计算 + Redis 缓存 | `indicator_cache` |
| entry_points 插件 | pip-installable 第三方指标包 | - |
| 指标 → 策略模板 | 将系统中的指标直接生成策略模板，降低策略编写门槛 | - |

> **Phase 1 已知**: Phase 1 策略用 `pd.rolling/ewm` 直接计算，已有 11 个模板。插件系统将在结构化策略协议基础上提供可复用的指标库，策略脚本可 `import` 或调用。

---

### P2-6: 用户端功能

| 功能 | 说明 | 数据库表 |
|---|---|---|
| 独立 Web 应用 | 用户端 Next.js 独立应用 | - |
| 移动 App | React Native / Flutter | - |
| 自选列表 | 用户自定义 watchlist | `watchlists`, `watchlist_items` |
| 多语言 | 英文界面 | - |
| API Key | 第三方应用接入 (X-API-Key) | `api_keys` |
| WebSocket 行情 | 实时价格推送 | - |

> **Phase 1 已知**: 用户 API 已完整实现 (auth/stocks/signals/ai/alerts)。用户端只需消费这些 API，后端无需大改。

---

### P2-7: 平台增强

| 功能 | 说明 |
|---|---|
| 实时数据源 | Finnhub WebSocket 集成，替换纯 EOD |
| 付费数据源 | Polygon.io Advanced 按需接入 |
| 数据源适配器 | Multi-Provider Adapter Layer (数据源自动切换) |
| 审计日志 | Admin 操作审计 (`audit_log` 表) |
| Prometheus + Grafana | 生产监控 |
| CI/CD Pipeline | GitHub Actions 自动部署 |
| E2E 测试 | Playwright 管理面板测试 (已有 29 个后端 pytest) |
| 支付宝/微信支付 | 如 Stripe 不可用时的备用方案 |
| 策略脚本超时隔离 | `signal.alarm` 或进程级超时，防止死循环卡进程 |
| 策略版本快照 | 回测时保存脚本内容 hash + 参数快照，确保历史复现 |

> **Phase 1 已知**: 数据源已实现 Yahoo API 直连 + yfinance 兜底 + dev fallback 三层架构。Docker Compose 本地部署已可用。Phase 2 聚焦生产级加固。

---

### P2-8: AI 分析增强

**参考**: [008-ai-analysis-system.md](./008-ai-analysis-system.md)

| 功能 | 说明 |
|---|---|
| AI 驱动的动态策略 | 策略脚本消费 AI 预计算特征（`ai_regime` / `ai_risk_score`），AI 不直接做决策 |
| 批量分析 | 每日摘要自动生成，同时对多条信号做批量 AI 分析 |
| 分析缓存 | Redis 24h TTL + prompt hash 去重 |
| 成本追踪 | 每用户每日 token 消耗统计 |
| 自定义 Prompt | Admin 可调整分析 Prompt 模板 |
| 模型降级链 | Primary → Fallback → Rule-based template |
| 本地模型 | Ollama + Qwen 2.5 自部署 (降本) |

> **Phase 1 已知**: AI 运行时配置已实现（`PATCH /admin/ai-config` 即时生效），支持任何 OpenAI 兼容 API（DeepSeek/OpenAI/自托管）。Phase 2 在此基础上增加多模型路由和成本控制。

---

### P2-9: 策略生态增强 (Phase 1 反馈新增)

| 功能 | 说明 |
|---|---|
| 策略市场 | Admin/用户可发布策略模板，社区可浏览和复用 |
| 策略性能排行榜 | 按 Sharpe/收益/回撤排行，促进策略迭代 |
| 策略参数一键优化 | 管理面板点击按钮触发 Optuna，自动生成最优参数组合 |
| 策略条件表达式 | 简单的可视化策略构建器（MA > MA60 AND RSI < 30 → Buy），降低非程序员使用门槛 |
| 策略回测结果导出 | CSV/JSON 下载 |

---

## Phase 2 数据库表补充

Phase 2 需要新建以下表 (DDL 参考 [002-database-schema.md](./002-database-schema.md))：

| 表 | Phase | 用途 |
|---|---|---|
| `subscription_tiers` | P2-1 | 会员等级 |
| `user_subscriptions` | P2-1 | 用户订阅 |
| `payment_orders` | P2-1 | 支付订单 |
| `indicator_presets` | P2-5 | 指标预设 |
| `indicator_preset_items` | P2-5 | 预设指标项 |
| `stock_indicator_overrides` | P2-5 | 标的指标覆盖 |
| `indicator_cache` | P2-5 | 指标预计算缓存 |
| `backtest_jobs` | P2-3 | 异步回测任务队列 |
| `notification_preferences` | P2-2 | 通知偏好 |
| `notification_inbox` | P2-2 | 站内通知 |
| `push_device_tokens` | P2-2 | 推送设备 |
| `digest_queue` | P2-2 | 摘要队列 |
| `notification_dlq` | P2-2 | 通知死信 |
| `watchlists` | P2-6 | 自选列表 |
| `watchlist_items` | P2-6 | 自选项目 |
| `api_keys` | P2-6 | 第三方 API 密钥 |
| `audit_log` | P2-7 | 操作审计日志 |

---

## Phase 2 预估开发顺序

```
Phase 1 完成 ✅ (2026-06-23)
    │
    ├── P2-7 平台加固 (CI/CD、E2E 测试、策略超时隔离、版本快照)
    │       高优先级：为生产部署和后续开发提供基础保障
    │
    ├── P2-3 回测增强 (异步队列、Optuna 参数优化)
    │       高价值：直接提升策略开发效率，驱动 Pro 转化
    │
    ├── P2-9 策略生态 (排行榜、一键优化、条件表达式)
    │       新增需求：降低策略使用门槛，扩大用户群
    │
    ├── P2-1 支付与会员 (如有付费需求验证)
    │       └── P2-2 通知增强 (付费用户更需多渠道通知)
    │
    ├── P2-6 用户端功能 (取决于用户端项目启动时间)
    │
    ├── P2-5 指标插件系统 (提升策略开发灵活性)
    │
    ├── P2-4 ML 增强 (需足够训练数据积累)
    │
    └── P2-8 AI 增强 (多模型路由 + 批量分析 + 成本控制)
```

---

## Phase 1 → Phase 2 过渡建议

1. **立即可做**: CI/CD pipeline、E2E 测试、`steamlit` 回测参数优化原型
2. **短期优先**: 异步回测队列 (当前同步回测对长区间/多策略不友好)、策略版本快照
3. **需要验证**: 付费意愿 → 决定 P2-1 启动时机；数据覆盖量 → 决定 P2-4 ML 训练可行性
4. **注意**: Phase 1 的数据源稳定性 (Yahoo API 直连) 在容器化环境已验证可用，无需立即切换到付费数据源

---

## 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1 | 2026-06-09 | 初稿：基于 Phase 1 范围划定 Phase 2 全部功能模块 |
| v2 | 2026-06-23 | 基于 Phase 1 实际完成情况全面修订：修正过时引用 (vectorbt→自研)、移除已实现功能 (多策略对比/图表)、新增 P2-9 策略生态、更新开发顺序、添加过渡建议 |
