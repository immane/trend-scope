# Trend-Scope — AI Session Context

> **Date**: 2026-06-09  
> **Session**: ses-20260609-001  
> **Purpose**: 保存当前 AI 会话的完整上下文，以便后续会话快速恢复。

---

## 项目概述

**Trend-Scope** — 面向美股指数基金投资者的分级会员制投资分析平台。

- **目标用户**: 美股 ETF/指数基金投资者 (SPY, QQQ, TQQQ, SOXL 等)
- **核心价值**: 自动化策略信号 + AI 分析 + 回测验证 + 邮件提醒
- **商业模式**: 三级会员制 (Free/Basic $9.99/Pro $29.99)，Phase 2 实现支付

## 当前阶段

**Phase 1 MVP (设计完成，待实现)**

Phase 1 包含:
1. 后端 FastAPI (认证、数据同步、策略引擎、回测、AI分析、邮件)
2. 管理端 Next.js 14 (Dashboard、标的管理/K线、策略管理/自定义脚本、回测面板、信号查看、提醒日志)
3. 用户 API (注册/登录、K线查询、信号查询、AI分析、提醒管理)
4. 13 张数据库表 (MySQL 8.0)
5. 4 个 APScheduler 定时任务 (数据同步→信号扫描→AI分析→提醒分发)
6. 3 种策略类型 (MA均线交叉、多指标综合、自定义Python脚本)
7. 回测系统 (vectorbt, 10项指标, SPY基准对比)

## 文档结构

```
docs/
├── design/                          # 架构设计文档
│   ├── 001-preliminary-design.md    # 总体架构 v2 (研究后更新)
│   ├── 002-database-schema.md       # 完整 26 表 DDL
│   ├── 003-api-specification.md     # 55+ API 完整规格
│   ├── 004-analysis-engine.md       # 三层分析引擎设计
│   ├── 005-payment-subscription.md  # 支付订阅设计 (Phase 2)
│   ├── 006-notification-system.md   # 通知系统设计
│   ├── 007-backtest-system.md       # 回测系统设计
│   ├── 008-ai-analysis-system.md    # AI 分析系统设计
│   ├── 009-indicator-plugin-system.md # 指标插件系统 (Phase 2)
│   ├── 010-deployment-guide.md      # 部署指南
│   ├── phase-1.md                   # Phase 1 MVP 完整详细设计 (v1.1)
│   └── phase-2.md                   # Phase 2 功能规划
├── research/                        # 技术研究文档
│   ├── 001-business-model.md        # 商业模式与定价
│   ├── 002-data-sources.md          # 数据源选型 (免费+付费)
│   ├── 003-charting.md              # K线图表方案 (TradingView LWC)
│   ├── 004-indicator-system.md      # 指标计算与插件系统
│   ├── 005-analysis-engine.md       # 量化分析与 AI 方法
│   ├── 006-backtest.md              # 回测框架对比
│   ├── 007-notification.md          # 通知服务选型
│   ├── 008-subscription.md          # 支付与订阅 (Stripe/支付宝/微信)
│   └── 009-ai-analysis.md           # AI 内容生成 (LLM选型/Prompt/安全)
├── tasks/                           # 模块化开发任务
│   ├── 01-phase-1-project-init.md   # T1 项目初始化
│   ├── 02-phase-1-database.md       # T2 数据库层
│   ├── 03-phase-1-auth.md           # T3 认证系统
│   ├── 04-phase-1-stock-data.md     # T4 股票与K线
│   ├── 05-phase-1-strategy-engine.md # T5 策略引擎
│   ├── 06-phase-1-scheduler.md      # T6 定时任务
│   ├── 07-phase-1-backtest.md       # T7 回测系统
│   ├── 08-phase-1-ai-analysis.md    # T8 AI分析
│   ├── 09-phase-1-alert-email.md    # T9 提醒邮件
│   ├── 10-phase-1-admin-frontend.md  # T10 管理端前端
│   └── 11-phase-1-integration-test.md # T11 集成测试
├── sessions/
│   └── session-2026-06-09.json      # 本次会话记录
├── ai/
│   └── context.md                   # 本文件
└── README.md                        # 项目总览 (给用户/合作方)
```

## 关键技术决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 后端框架 | FastAPI 0.115+ | 异步、自动OpenAPI、WebSocket |
| 数据库 | MySQL 8.0 + Redis 7 | 按用户要求 |
| 数据源 | yfinance (主) + Finnhub (备用) | 免费优先 |
| AI 模型 | DeepSeek V4-Flash | $0.00043/次, OpenAI兼容, 中文优秀 |
| 回测引擎 | vectorbt 1.0+ | 矢量化快速, NumPy加速 |
| 脚本沙箱 | RestrictedPython | 白名单+超时, 轻量 |
| 前端图表 | TradingView LWC 5.2 | Apache 2.0 免费商用 |
| 邮件 | Resend | $20/月 50k封, API简洁 |

## Phase 1 实施依赖顺序

```
T1 (项目初始化)
  → T2 (数据库层)
    → T3 (认证系统)
      → T4 (股票与K线)
        → T5 (策略引擎)
          → T6 (定时任务)
          → T7 (回测系统) [并行于 T5 完成]
            → T8 (AI分析) [依赖 T6 的调度触发]
              → T9 (提醒邮件)
                → T10 (管理端前端) [依赖全部后端 API]
                  → T11 (集成测试)
```

> **注意**: T7 (回测) 和 T8 (AI分析) 可以与 T5 部分并行开发（因为它们有自己的服务类），但它们依赖 T5 的 `generate_signals()` 函数作为信号生成的单一来源。

## 后续会话建议

1. 按 tasks/ 文件顺序执行 T1-T11
2. 每完成一个 Task 更新 phase-1.md 的勾选状态
3. Phase 1 完成后评估是否启动 Phase 2 (支付/会员/ML/指标插件)
4. 数据源稳定性监控 — yfinance 若不稳定则切换 Finnhub
