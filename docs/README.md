# Trend-Scope

> 面向美股指数基金投资者的智能投资分析平台

[![Phase](https://img.shields.io/badge/Phase-1%20MVP%20Complete-green)]()
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
- 🧩 **灵活的策略系统**: 11 种预设模板 + 完全自定义 Python 脚本，支持结构化协议（分仓/置信度/原因/AI上下文）

---

## 当前状态

### Phase 1 MVP（已完成 ✅ — 2026-06-23）

| 功能 | 描述 |
|---|---|
| 📊 **K 线图表** | lightweight-charts v5 专业级 K 线图，支持 MA 叠加、成交量、MACD |
| 🔔 **策略信号** | 结构化策略协议：支持目标仓位/置信度/原因/AI上下文 |
| 🧪 **策略回测** | 自研回测引擎，10 项核心指标，权益曲线/回撤曲线，目标仓位调仓模型 |
| 🤖 **AI 分析** | DeepSeek AI 对信号生成结构化分析报告，运行时配置即时生效 |
| 📧 **邮件提醒** | 信号触发时自动发送邮件通知，含 AI 分析摘要 |
| 🖥️ **管理后台** | Next.js 14 金融暗色管理面板，22 个路由，Monaco 代码编辑器，暗色金融图表 |

**Phase 1 技术栈**:

| 层 | 技术 |
|---|---|
| 后端框架 | FastAPI (Python 3.12+) |
| 数据库 | MySQL 8.0 + Redis 7 |
| ORM | SQLAlchemy 2.0 (async) + Alembic 迁移 |
| 数据源 | Yahoo chart v8 API 直连 + yfinance 兜底 |
| AI | DeepSeek (支持任何 OpenAI 兼容 API) |
| 回测引擎 | 自研 BacktestService (pandas 模拟) |
| 定时任务 | APScheduler |
| 邮件 | Resend |
| 前端 | Next.js 14 + Ant Design 6 + Tailwind CSS 3 + lightweight-charts v5 + Monaco Editor |
| 部署 | Docker Compose |
| 测试 | 27 个 pytest 测试 (SQLite 测试库) |

### Phase 2（规划中 📋）

| 模块 | 内容 |
|---|---|
| 💳 **支付与会员** | Stripe 订阅支付，三级会员制 (Free / Basic / Pro) |
| 📱 **通知增强** | Web Push + 站内通知 (WebSocket) + 每日/每周摘要 |
| 🧠 **ML 增强分析** | XGBoost / LSTM 信号预测、FinBERT 情绪分析 |
| 🔌 **指标插件系统** | 252+ 指标，插件化自动发现和动态加载 |
| 📈 **回测增强** | 异步任务队列、HTML 报告、Optuna 参数自动优化 |
| 🌐 **用户端** | 独立 Web/移动端应用（通过 API 消费） |

---

## 项目架构

```
trend-scope/
├── backend/              # FastAPI 后端
│   ├── app/
│   │   ├── api/v1/       # REST API (用户端 + admin 端)
│   │   │   └── admin/    # 管理 API (stocks/strategies/backtest/signals/alerts/ai-config/...)
│   │   ├── core/         # 配置、安全、依赖注入
│   │   ├── models/       # SQLAlchemy ORM 模型 (10 张表)
│   │   ├── schemas/      # Pydantic 请求/响应模型
│   │   ├── services/     # 业务逻辑层 (回测/策略/AI/邮件/数据/配置)
│   │   ├── scheduler/    # APScheduler 定时任务
│   │   └── tests/        # 27 个 pytest 测试
│   ├── alembic/          # 数据库迁移
│   ├── seed_data.py      # 种子数据 (admin + 10 ETFs)
│   └── Dockerfile
├── admin/                # Next.js 14 管理面板
│   └── src/
│       ├── app/          # 22 个页面路由
│       ├── components/   # UI 组件 (AdminShell/KlineChart/StrategyCodeEditor/...)
│       ├── lib/          # API 客户端、格式化、排序工具
│       └── types/        # TypeScript 类型定义
├── docs/                 # 文档
│   ├── README.md         # 项目首页
│   ├── design/           # 12 个架构设计文档
│   ├── research/         # 9 个技术研究文档
│   ├── tasks/            # 11 个模块化开发任务 (全部已完成)
│   ├── help/             # 帮助文档 (快速开始、管理指南、策略协议、AI配置)
│   └── ai/               # AI 会话上下文
├── docker-compose.yml
├── mkdocs.yml
└── .env.example
```

---

## 快速开始

```bash
# 1. 克隆项目
git clone https://github.com/immane/trend-scope
cd trend-scope

# 2. 一键启动
cp .env.example .env
docker compose up -d

# 3. 访问
# 管理面板: http://localhost:3000
# API 文档:  http://localhost:8000/docs

# 管理员账号: admin@trend-scope.com / Admin123!
```

首次启动后会自动创建 10 个标的 (SPY/QQQ/TQQQ/SOXL 等) 和管理员。

详细入门指南：`docs/help/quickstart.md`

---

## 文档导航

### 🚀 快速开始
→ `docs/help/quickstart.md` — 从零到第一次回测

### 🖥️ 管理指南
→ `docs/help/admin-guide.md` — 完整后台使用说明

### 🧩 策略协议
→ `docs/help/strategy-script.md` — Python 策略脚本完整参考

### 🤖 AI 配置
→ `docs/help/ai-config.md` — AI 接口设置指南

### 📐 架构设计
→ `docs/design/` (12 个设计文档)

### 📊 技术研究
→ `docs/research/` (9 个研究文档)

---

## 路线图

```
Phase 1 ✅ 已完成 (2026-06-23)            Phase 2 📋 规划中
┌─────────────────────────────┐          ┌─────────────────────────┐
│ ✓ 用户认证                   │          │ ○ 支付与会员体系         │
│ ✓ K线图表 (lightweight v5)  │          │ ○ Push / WebSocket 通知  │
│ ✓ 策略引擎 (结构化协议)      │          │ ○ ML 增强信号分析        │
│ ✓ 策略回测验证 (自研引擎)    │          │ ○ 指标插件系统           │
│ ✓ AI 信号分析 (运行时配置)   │          │ ○ 回测增强 (Optuna)      │
│ ✓ 邮件提醒                   │          │ ○ 用户端应用             │
│ ✓ 金融暗色管理面板           │          │ ○ 多语言支持             │
│ ✓ 22 个管理路由 + 27 个测试  │          │ ○ API Key 第三方接入     │
└─────────────────────────────┘          └─────────────────────────┘
```

---

## 合作方信息

- **项目名称**: Trend-Scope
- **定位**: 美股 ETF 智能分析 SaaS
- **目标用户**: 全球美股投资者
- **商业模式**: 三级会员订阅制 (Free / Basic / Pro)
- **技术栈**: Python (FastAPI) + TypeScript (Next.js) + MySQL + Redis
- **开发状态**: Phase 1 MVP 已完成
- **GitHub**: [https://github.com/immane/trend-scope](https://github.com/immane/trend-scope)

---

> ⚠️ **免责声明**: Trend-Scope 提供的所有信号、分析和建议仅供参考，不构成投资建议。投资有风险，入市需谨慎。
