# Trend-Scope

> 面向美股指数基金投资者的智能投资分析平台

[![Phase](https://img.shields.io/badge/Phase-1%20MVP%20Design%20Complete-blue)]()
[![Python](https://img.shields.io/badge/Python-3.12+-3776AB?logo=python)]()
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?logo=fastapi)]()
[![Next.js](https://img.shields.io/badge/Next.js-14-000000?logo=next.js)]()
[![MySQL](https://img.shields.io/badge/MySQL-8.0-4479A1?logo=mysql)]()
[![License](https://img.shields.io/badge/License-MIT-green)]()

---

## 项目简介

**Trend-Scope** 是一个面向美股指数基金（ETF）投资者的智能投资分析平台。帮助投资者自动发现买卖信号，通过 AI 分析信号背后逻辑，量化回测验证策略，并及时推送提醒。

### 为什么选择 Trend-Scope？

- 🎯 **专注于 ETF**: 而非个股，聚焦 SPY / QQQ / TQQQ / SOXL 等主流指数基金
- 🤖 **AI 驱动分析**: 不是简单告诉你"该买"，而是解释"为什么买、风险在哪、止损在哪"
- 🔬 **回测验证**: 在投入真金白银前，用历史数据验证你的策略效果
- 📧 **自动提醒**: 信号触发即时邮件通知，不错过交易时机
- 🧩 **灵活的策略系统**: 系统预设策略 + 完全自定义 Python 脚本，满足从新手到专业的需求

---

## 当前状态

### Phase 1 MVP（设计完成 ✅，开发中 🚧）

**Phase 1 将交付一个完整的、可用的最小产品**，包含以下核心功能:

| 功能 | 描述 |
|---|---|
| 📊 **K 线图表** | TradingView 专业级 K 线图，支持 MA 叠加、成交量、买卖信号标记 |
| 🔔 **策略信号** | 三种策略类型：MA 均线交叉、多指标综合评分、完全自定义 Python 脚本 |
| 🧪 **策略回测** | vectorbt 引擎，10 项核心指标（收益率、回撤、Sharpe、胜率、盈亏比等） |
| 🤖 **AI 分析** | DeepSeek AI 对每个信号生成结构化分析：为什么买/卖、风险在哪、止损建议 |
| 📧 **邮件提醒** | 信号触发时自动发送邮件通知，含 AI 分析摘要 |
| 🖥️ **管理后台** | Next.js 14 全功能管理面板，可视化配置策略、查看信号和回测结果 |

**Phase 1 技术栈**:

| 层 | 技术 |
|---|---|
| 后端框架 | FastAPI (Python 3.12+) |
| 数据库 | MySQL 8.0 + Redis 7 |
| 数据源 | yfinance (免费美股日线) |
| AI | DeepSeek V4-Flash (OpenAI 兼容) |
| 回测引擎 | vectorbt |
| 定时任务 | APScheduler |
| 邮件 | Resend |
| 前端 | Next.js 14 + Ant Design 5 + TradingView Lightweight Charts |
| 部署 | Docker Compose |

### Phase 2（规划中 📋）

Phase 2 将在 Phase 1 验证产品价值后，添加商业化和高级功能:

| 模块 | 内容 |
|---|---|
| 💳 **支付与会员** | Stripe 订阅支付（内置支付宝/微信），三级会员制 (Free / Basic / Pro) |
| 📱 **通知增强** | Web Push + 站内通知 (WebSocket) + 每日/每周摘要 |
| 🧠 **ML 增强分析** | XGBoost / LSTM 信号预测、FinBERT 情绪分析 |
| 🔌 **指标插件系统** | 252+ 指标，插件化自动发现和动态加载 |
| 📈 **回测增强** | 异步任务队列、HTML 报告、Optuna 参数自动优化 |
| 🌐 **用户端** | 独立 Web/移动端应用（通过 API 消费） |
| 📊 **更多功能** | 自选列表、多语言、API Key 第三方接入 |

---

## 项目架构

```
trend-scope/
├── backend/              # FastAPI 后端
│   ├── app/
│   │   ├── api/v1/       # REST API 端点
│   │   ├── core/         # 配置、安全、依赖注入
│   │   ├── models/       # SQLAlchemy ORM 模型
│   │   ├── schemas/      # Pydantic 请求/响应模型
│   │   ├── services/     # 业务逻辑层
│   │   ├── scheduler/    # APScheduler 定时任务
│   │   └── middleware/   # 限流等中间件
│   ├── alembic/          # 数据库迁移
│   └── tests/            # 测试
├── admin/                # Next.js 14 管理面板
│   └── src/
│       ├── app/          # 页面路由
│       ├── components/   # UI 组件 (K线图、回测面板等)
│       ├── lib/          # API 客户端、工具函数
│       └── types/        # TypeScript 类型定义
├── docs/                 # 完整设计文档
│   ├── design/           # 12 个架构设计文档
│   │   ├── 001-preliminary-design.md    # 总体架构设计 v2
│   │   ├── 002-database-schema.md       # 26 张表完整 DDL
│   │   ├── 003-api-specification.md     # 55+ API 完整规格
│   │   ├── 004-analysis-engine.md       # 三层分析引擎
│   │   ├── 005-payment-subscription.md  # 支付订阅
│   │   ├── 006-notification-system.md   # 通知系统
│   │   ├── 007-backtest-system.md       # 回测系统
│   │   ├── 008-ai-analysis-system.md    # AI 分析
│   │   ├── 009-indicator-plugin-system.md # 指标插件
│   │   ├── 010-deployment-guide.md      # 部署指南
│   │   ├── phase-1.md                   # Phase 1 MVP 完整设计
│   │   └── phase-2.md                   # Phase 2 功能规划
│   ├── research/         # 9 个技术研究文档
│   │   ├── 001-business-model.md        # 商业模式与定价
│   │   ├── 002-data-sources.md          # 数据源选型
│   │   ├── 003-charting.md              # K线图表方案
│   │   ├── 004-indicator-system.md      # 指标系统
│   │   ├── 005-analysis-engine.md       # 量化分析
│   │   ├── 006-backtest.md              # 回测框架
│   │   ├── 007-notification.md          # 通知服务
│   │   ├── 008-subscription.md          # 支付订阅
│   │   └── 009-ai-analysis.md           # AI 内容生成
│   └── tasks/            # 11 个模块化开发任务
│       ├── 01-phase-1-project-init.md   # 项目初始化
│       ├── 02-phase-1-database.md       # 数据库层
│       ├── 03-phase-1-auth.md           # 认证系统
│       ├── 04-phase-1-stock-data.md     # 股票数据与K线
│       ├── 05-phase-1-strategy-engine.md # 策略引擎
│       ├── 06-phase-1-scheduler.md      # 定时任务
│       ├── 07-phase-1-backtest.md       # 回测系统
│       ├── 08-phase-1-ai-analysis.md    # AI 分析
│       ├── 09-phase-1-alert-email.md    # 提醒邮件
│       ├── 10-phase-1-admin-frontend.md  # 管理端前端
│       └── 11-phase-1-integration-test.md # 集成测试
├── docker-compose.yml
└── .env.example
```

---

## 快速开始 (开发中)

```bash
# 1. 启动基础设施
docker-compose up -d mysql redis

# 2. 初始化后端
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
python seed_data.py
uvicorn app.main:app --reload --port 8000

# 3. 启动管理面板
cd admin
npm install
npm run dev

# 4. 访问
# API 文档: http://localhost:8000/docs
# 管理面板: http://localhost:3000
```

---

## 文档导航

### 想了解整体架构？
→ [001-preliminary-design.md](docs/design/001-preliminary-design.md)

### 想看 Phase 1 具体做什么？
→ [phase-1.md](docs/design/phase-1.md)

### 想看详细开发任务？
→ [tasks/](docs/tasks/) (11 个独立任务文件)

### 想看技术选型背后的研究？
→ [research/](docs/research/) (9 个研究文档)

### 想看数据库怎么设计的？
→ [002-database-schema.md](docs/design/002-database-schema.md)

### 想看所有 API 接口？
→ [003-api-specification.md](docs/design/003-api-specification.md)

### 想了解怎么部署？
→ [010-deployment-guide.md](docs/design/010-deployment-guide.md)

---

## 路线图

```
Phase 1 (当前)                        Phase 2 (计划)
┌─────────────────────────┐           ┌─────────────────────────┐
│ ✓ 用户认证              │           │ ○ 支付与会员体系         │
│ ✓ K线图表               │           │ ○ Push / WebSocket 通知  │
│ ✓ 策略引擎 (预设+自定义) │           │ ○ ML 增强信号分析       │
│ ✓ 策略回测验证          │           │ ○ 指标插件系统 (252+)   │
│ ✓ AI 信号分析           │           │ ○ 回测增强 (Optuna)     │
│ ✓ 邮件提醒              │           │ ○ 用户端应用            │
│ ✓ 管理面板              │           │ ○ 多语言支持            │
│                         │           │ ○ API Key 第三方接入     │
│ 预计开发: 4-5 周        │           │ 启动: Phase 1 完成后     │
└─────────────────────────┘           └─────────────────────────┘
```

---

## 合作方信息

- **项目名称**: Trend-Scope
- **定位**: 美股 ETF 智能分析 SaaS
- **目标用户**: 全球美股投资者
- **商业模式**: 三级会员订阅制 (Free / Basic / Pro)
- **技术栈**: Python (FastAPI) + TypeScript (Next.js) + MySQL + Redis
- **开发状态**: Phase 1 MVP 设计完成，开发中
- **GitHub**: [https://github.com/immane/trend-scope](https://github.com/immane/trend-scope)

---

> ⚠️ **免责声明**: Trend-Scope 提供的所有信号、分析和建议仅供参考，不构成投资建议。投资有风险，入市需谨慎。
