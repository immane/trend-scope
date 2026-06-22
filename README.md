<div align="center">

<!-- Trend-Scope Logo -->
<svg width="96" height="96" viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="96" height="96" rx="24" fill="url(#g)"/>
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="96" y2="96">
      <stop offset="0%" stop-color="#2563eb"/>
      <stop offset="100%" stop-color="#0891b2"/>
    </linearGradient>
  </defs>
  <path d="M24 64V36l12-6v28l-12 6z" fill="rgba(255,255,255,.9)"/>
  <path d="M42 56V28l12-6v28l-12 6z" fill="rgba(255,255,255,.7)"/>
  <path d="M60 68V40l12-6v28l-12 6z" fill="rgba(255,255,255,.9)"/>
  <rect x="20" y="68" width="56" height="3" rx="1.5" fill="rgba(255,255,255,.5)"/>
</svg>

# Trend-Scope

### 面向美股指数基金投资者的智能投资分析平台

[![Phase](https://img.shields.io/badge/Phase-1%20MVP%20Complete-green?style=for-the-badge)]()
[![Tests](https://img.shields.io/badge/Tests-29%20passed-brightgreen?style=for-the-badge)]()
[![Python](https://img.shields.io/badge/Python-3.12+-3776AB?style=for-the-badge&logo=python&logoColor=white)]()
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?style=for-the-badge&logo=fastapi&logoColor=white)]()
[![Next.js](https://img.shields.io/badge/Next.js-14-000000?style=for-the-badge&logo=next.js&logoColor=white)]()
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)]()
[![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)]()

</div>

---

## 📖 目录

- [项目简介](#-项目简介)
- [核心功能](#-核心功能)
- [技术栈](#-技术栈)
- [快速开始](#-快速开始)
- [项目架构](#-项目架构)
- [管理后台](#-管理后台)
- [策略系统](#-策略系统)
- [回测引擎](#-回测引擎)
- [AI 分析](#-ai-分析)
- [数据库模型](#-数据库模型)
- [API 文档](#-api-文档)
- [测试](#-测试)
- [文档导航](#-文档导航)
- [路线图](#-路线图)
- [开发指南](#-开发指南)
- [免责声明](#-免责声明)

---

## 🚀 项目简介

**Trend-Scope** 是一个面向美股 ETF 投资者的智能量化分析 SaaS 平台。它将**策略信号**、**AI 分析**、**回测验证**和**邮件提醒**整合为一体化工作流，帮助投资者从数据到决策的全链路自动化。

> 不是简单告诉你"该买"，而是解释"为什么买、风险在哪、止损在哪"

### 为什么选择 Trend-Scope？

| 特性 | 说明 |
|---|---|
| 🎯 **专注 ETF** | SPY / QQQ / TQQQ / SOXL 等主流指数基金 |
| 🤖 **AI 驱动** | 每个信号自动生成结构化分析报告 |
| 🔬 **回测验证** | 在投入真金白银前用历史数据验证策略 |
| 📧 **自动提醒** | 信号触发时邮件通知，含 AI 分析摘要 |
| 🧩 **灵活策略** | 11 种预设模板 + 完全自定义 Python 脚本 |
| 🎨 **金融暗色 UI** | 产品级后台管理面板，22 个路由全覆盖 |
| 🐳 **一键部署** | Docker Compose 启动即用 |

---

## ✨ 核心功能

### 📊 K 线图表
- lightweight-charts v5 专业级蜡烛图
- 多面板：价格 + 成交量 + MACD
- 多时间周期切换
- MA5 / MA10 / MA20 / MA60 / MA120 叠加
- 买卖信号标记与 AI 摘要

### 🧩 策略引擎
- **11 种内置模板**：MA Cross, EMA Cross, RSI, MACD, Bollinger, Donchian, Momentum, Z-Score, Volume Breakout, Trend+RSI, Buy&Hold
- **自定义 Python 脚本**：完整 pandas/numpy 支持
- **结构化协议**：支持 `target_position`（0~1 分仓）、`confidence`、`reason`、`ai_context`
- **沙箱保护**：AST 静态校验 + 白名单内置函数

### 🔬 回测引擎
- 自研 pandas 模拟引擎
- **10 项核心指标**：总收益、CAGR、最大回撤、Sharpe、Sortino、Calmar、胜率、盈亏比、交易次数、Benchmark 收益
- **两种模式**：全仓信号模式 + 目标仓位调仓模式
- 权益曲线、回撤曲线、月度收益分布、交易明细
- 多策略对比：归一化收益叠加 + 指标排序表
- DECIMAL(18,6) 精度，防浮点溢出

### 🤖 AI 信号分析
- DeepSeek AI 自动分析（支持 OpenAI 兼容 API）
- 结构化输出：摘要、原因、风险、止损建议、置信度
- 运行时配置即时生效，无需重启
- 无 API Key 时自动降级为模板分析

### 📧 提醒分发
- 信号 → 规则匹配 → 邮件派发（Resend）
- 去重机制防止重复发送
- 提醒规则支持：仅买入 / 仅卖出 / 任意信号

### 🖥️ 管理后台
- Next.js 14 + Ant Design 6 + Tailwind CSS 3
- 金融类暗色主题：深蓝黑背景、玻璃拟态卡片、网格纹理
- 可折叠侧栏 + 移动端抽屉菜单
- Monaco 代码编辑器集成
- 暗色金融 SVG 图表（渐变面积、发光线、零轴、数值标签）

---

## 🛠 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| **后端框架** | FastAPI 0.115+ | 异步高性能 API |
| **数据库** | MySQL 8.0 + Redis 7 | 主存储 + 缓存 |
| **ORM** | SQLAlchemy 2.0 (async) | 异步 ORM + Alembic 迁移 |
| **数据源** | Yahoo chart v8 API + yfinance | 直连 API 优先，容器内稳定 |
| **策略沙箱** | AST 校验 + `exec()` 白名单 | 安全执行用户脚本 |
| **回测引擎** | 自研 (pandas 模拟) | 信号模式 + 目标仓位模式 |
| **AI 服务** | DeepSeek V4 / OpenAI 兼容 | 运行时配置、fallback 模板 |
| **定时任务** | APScheduler 4 | 数据同步→信号扫描→AI分析→提醒分发 |
| **邮件** | Resend API | 邮件模板发送 |
| **前端框架** | Next.js 14 + React 18 | App Router + RSC |
| **UI 库** | Ant Design 6 + Tailwind CSS 3 | 暗色金融主题 |
| **图表** | lightweight-charts v5 + SVG | K 线图 + 回测图表 |
| **编辑器** | Monaco Editor | Python 代码编辑 |
| **状态管理** | TanStack React Query v5 | 数据获取与缓存 |
| **部署** | Docker Compose | 一键启动全部服务 |
| **测试** | pytest 29 tests | SQLite 测试库，无需 MySQL |

---

## ⚡ 快速开始

### 前置条件
- Docker & Docker Compose
- (可选) DeepSeek API Key

### 一键启动

```bash
# 1. 克隆项目
git clone https://github.com/immane/trend-scope.git
cd trend-scope

# 2. 配置环境变量（可选，默认值可直接使用）
cp .env.example .env

# 3. 启动全部服务
docker compose up -d

# 4. 访问
# 管理面板: http://localhost:3000
# API 文档:  http://localhost:8000/docs
# Swagger:   http://localhost:8000/redoc
```

### 首次登录

```
邮箱: admin@trend-scope.com
密码: Admin123!
```

### 第一步操作

1. 进入「数据管理」→ 点击「同步全部行情」
2. 进入「策略管理」→ 创建策略或使用预设模板
3. 进入策略详情 → 运行回测
4. 进入「信号」→ 查看信号 → 点击「生成分析」
5. 进入「AI 设置」→ 配置 DeepSeek API Key

> 📖 详细指南：`docs/help/quickstart.md`

---

## 🏗 项目架构

```
trend-scope/
├── backend/                        # FastAPI 后端 (64 Python 文件, ~4300 行)
│   ├── app/
│   │   ├── api/v1/                 # REST API 端点
│   │   │   ├── auth.py             #   注册/登录/刷新 JWT
│   │   │   ├── users.py            #   用户资料 CRUD
│   │   │   ├── stocks.py           #   K 线查询、富报价
│   │   │   ├── analysis.py         #   信号查询、AI 分析
│   │   │   ├── backtest.py         #   回测运行/历史
│   │   │   ├── alerts.py           #   提醒规则 CRUD
│   │   │   └── admin/              #   管理 API (11 个模块)
│   │   │       ├── stocks.py       #     标的管理 CRUD
│   │   │       ├── strategies.py   #     策略 CRUD/校验/试运行
│   │   │       ├── backtest.py     #     回测列表/详情
│   │   │       ├── signals.py      #     信号列表
│   │   │       ├── dashboard.py    #     统计+调度状态
│   │   │       ├── alerts.py       #     提醒日志
│   │   │       ├── rules.py        #     提醒规则管理
│   │   │       ├── users.py        #     用户管理
│   │   │       ├── announcements.py#     公告管理
│   │   │       ├── price_data.py   #     价格数据管理
│   │   │       └── ai_config.py    #     AI 运行时配置
│   │   ├── core/                   # 配置、安全、依赖注入
│   │   ├── models/                 # ORM 模型 (10 张表)
│   │   ├── schemas/                # Pydantic 请求/响应模型
│   │   ├── services/               # 业务逻辑层
│   │   │   ├── backtest_service.py #   自研回测引擎
│   │   │   ├── analysis_engine.py  #   信号生成+策略标准化
│   │   │   ├── script_executor.py  #   AST 校验+沙箱执行
│   │   │   ├── ai_analysis_service.py # AI 分析
│   │   │   ├── ai_config.py        #   AI 运行时配置存储
│   │   │   ├── stock_data.py       #   行情数据同步
│   │   │   ├── email_service.py    #   Resend 邮件
│   │   │   └── alert_service.py    #   信号→规则→邮件
│   │   ├── scheduler/              # APScheduler 定时任务
│   │   └── tests/                  # 29 个 pytest 测试
│   ├── alembic/                    # 数据库迁移
│   ├── seed_data.py                # 种子数据 (admin + 10 ETFs)
│   └── Dockerfile
├── admin/                          # Next.js 14 管理面板 (34 文件, ~3400 行)
│   └── src/
│       ├── app/                    # 22 个页面路由
│       │   ├── login/              #   金融暗色登录页
│       │   ├── dashboard/          #   Hero + 统计卡片
│       │   ├── stocks/             #   标的管理 + K线详情
│       │   ├── strategies/         #   策略管理 + Monaco 编辑器
│       │   ├── backtest/           #   回测历史 + 详情 + 对比
│       │   ├── signals/            #   信号列表 + AI 分析
│       │   ├── alerts/             #   提醒日志
│       │   ├── rules/              #   提醒规则
│       │   ├── users/              #   用户管理
│       │   ├── announcements/      #   内容管理
│       │   ├── data/               #   数据管理
│       │   └── ai-config/          #   AI 接口设置
│       ├── components/             # UI 组件
│       │   ├── layout/             #   AdminShell + AuthGuard
│       │   └── strategy/           #   Monaco 代码编辑器
│       └── lib/                    # API 客户端、格式化、排序
├── docs/                           # 文档
│   ├── README.md                   #   mkdocs 首页
│   ├── design/                     #   12 个架构设计文档
│   ├── research/                   #   9 个技术研究文档
│   ├── tasks/                      #   11 个开发任务 (全部已完成 ✅)
│   ├── help/                       #   帮助文档
│   │   ├── quickstart.md           #     快速开始
│   │   ├── admin-guide.md          #     管理后台指南
│   │   ├── strategy-script.md      #     策略脚本参考
│   │   └── ai-config.md            #     AI 配置指南
│   └── ai/                         #   AI 会话上下文
├── docker-compose.yml
├── mkdocs.yml
└── .env.example
```

---

## 🖥️ 管理后台

Trend-Scope 提供 **22 个路由** 的完整管理面板，采用金融暗色主题设计。

| 路由 | 功能 |
|---|---|
| `/login` | JWT 登录，暗色金融品牌入口 |
| `/dashboard` | 统计卡片 + 调度状态 + 最近回测 |
| `/stocks` | 标的管理（现价/涨跌/走势图/同步） |
| `/stocks/[id]` | K 线图 + 富报价 + 52 周区间 |
| `/strategies` | 策略管理（启用开关/分页） |
| `/strategies/create` | 创建策略（11 模板 + Monaco 编辑器） |
| `/strategies/[id]` | 编辑代码/参数 + 运行回测 |
| `/backtest` | 回测历史（多选对比） |
| `/backtest/[id]` | 权益曲线 + 回撤曲线 + 交易明细 |
| `/backtest/compare` | 多策略归一化收益对比 |
| `/signals` | 信号列表 + 生成 AI 分析 |
| `/signals/[id]` | 信号详情 + AI 分析报告 |
| `/alerts` | 提醒日志 |
| `/rules` | 提醒规则管理 |
| `/users` | 用户管理（角色/状态） |
| `/announcements` | 公告管理 |
| `/data` | 行情数据概况 |
| `/ai-config` | AI 接口运行时配置 |

> 📖 完整管理指南：`docs/help/admin-guide.md`

---

## 🧩 策略系统

### 策略协议

Trend-Scope 支持**两种策略输出协议**，完全向后兼容：

```python
def analyze(df, params):
    """
    df:     pandas.DataFrame (columns: open/high/low/close/volume)
    params: dict (from strategy script_params)
    returns: pd.Series or pd.DataFrame
    """
```

#### 旧版：信号 Series
```python
def analyze(df, params):
    fast = df["close"].rolling(20).mean()
    slow = df["close"].rolling(60).mean()
    signal = pd.Series(0, index=df.index)
    signal[(fast.shift(1) <= slow.shift(1)) & (fast > slow)] = 1   # buy
    signal[(fast.shift(1) >= slow.shift(1)) & (fast < slow)] = -1  # sell
    return signal.shift(1).fillna(0)
```

#### 新版：结构化 DataFrame
```python
def analyze(df, params):
    output = pd.DataFrame(index=df.index)
    output["target_position"] = 0.8        # 80% 仓位
    output["confidence"] = 0.75            # 置信度
    output["reason"] = "MA bullish crossover"
    output["ai_context"] = "Check earnings risk before full allocation"
    output["signal"] = ...                 # 离散信号
    return output
```

| 字段 | 类型 | 范围 | 用途 |
|---|---|---|---|
| `signal` | int | -1/0/1 | 离散买卖信号 |
| `target_position` | float | -1.0 ~ 1.0 | 目标仓位比例 |
| `confidence` | float | 0.0 ~ 1.0 | 策略置信度 |
| `reason` | str | — | 信号原因 |
| `ai_context` | str | — | AI 分析上下文 |

### 公共策略

系统内置 5 个公共结构化策略（`stock_id=None`，适用于所有标的）：

| 策略 | 类型 |
|---|---|
| Public Adaptive Trend Vol Target | 均线趋势 + 波动率目标仓位 |
| Public Donchian Breakout Risk Managed | Donchian 通道突破趋势 |
| Public RSI Trend Mean Reversion | 趋势过滤 RSI 均值回归 |
| Public Low Vol Momentum | 低波动动量 |
| Public Drawdown Defense Buy Hold | 回撤防御型持有 |

> 📖 完整策略协议：`docs/help/strategy-script.md`

---

## 🔬 回测引擎

### 回测模式

| 模式 | 触发条件 | 说明 |
|---|---|---|
| **信号模式** | 返回 `signal` 列 | 全仓买入/清仓卖出 |
| **目标仓位模式** | 返回 `target_position` 列 | 每日按目标敞口调仓，支持分仓 |

### 回测指标

| 指标 | 说明 |
|---|---|
| `total_return` | 策略总收益率 |
| `cagr` | 年化复合收益率 |
| `max_drawdown` | 最大回撤 |
| `sharpe_ratio` | 夏普比率（年化） |
| `sortino_ratio` | 索提诺比率 |
| `calmar_ratio` | 卡玛比率 (CAGR / MaxDD) |
| `win_rate` | 胜率 |
| `profit_factor` | 盈亏比 |
| `num_trades` | 已平仓交易次数 |
| `benchmark_return` | 买入持有收益率 |

### 会计模型

- 买入：成交额 + 手续费占用完整现金
- 卖出：净卖出收入 − 完整入场成本 = PnL
- 持仓权益：`cash + shares × close`
- 滑点：买入加滑点，卖出减滑点
- 所有指标使用原始精度序列计算，不受显示四舍五入影响

---

## 🤖 AI 分析

### 两种工作模式

| 模式 | 触发条件 | 效果 |
|---|---|---|
| **DeepSeek 模式** | API Key 已配置 | 实时 AI 生成结构化分析 |
| **模板模式** | 无 API Key | 基于信号数据自动生成模板分析 |

### 配置方式

**方式一：环境变量**（全局生效）

```bash
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxx
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
```

**方式二：运行时配置**（管理面板设置，即时生效，无需重启）

进入 `/ai-config` 页面，填写 API Key / Base URL / Model，开启开关即生效。

运行时配置优先于环境变量。支持任何 OpenAI 兼容的 API 提供商。

### AI 分析输出

```json
{
  "summary": "SPY 在 2024-06-15 触发买入信号...",
  "reasons": ["MA20 上穿 MA60", "成交量确认"],
  "risks": ["技术信号可能失效", "市场波动可能导致滑点"],
  "stop_loss": {"price": 450.50, "reasoning": "按触发价下方 5% 风险缓冲"},
  "confidence": 0.72,
  "disclaimer": "以上为AI生成的参考分析，不构成投资建议。"
}
```

> 📖 AI 配置指南：`docs/help/ai-config.md`

---

## 🗄 数据库模型

```
User ─── UserSession
  │
  ├── AlertRule ── AlertLog
  ├── BacktestResult (config_id → AnalysisConfig)
  ├── Announcement
  │
Stock ─── StockPriceDaily
  │
  ├── AnalysisConfig (策略定义，含 custom_script 和 script_params)
  │
  └── AnalysisSignal
       └── AIAnalysisResult (1:1, unique)
```

**10 张核心表**：
- `users` — 用户表（含角色/状态）
- `user_sessions` — 会话表（refresh token）
- `stocks` — 标的基本信息
- `stock_prices_daily` — 日线 OHLCV
- `analysis_configs` — 策略配置（含脚本和参数）
- `analysis_signals` — 触发信号
- `ai_analysis_results` — AI 分析报告
- `backtest_results` — 回测结果（DECIMAL(18,6)）
- `alert_rules` — 提醒规则
- `alert_logs` — 提醒日志

> ➡️ 完整 DDL：`docs/design/002-database-schema.md`

---

## 📡 API 文档

启动服务后访问 Swagger UI：

| 地址 | 说明 |
|---|---|
| `http://localhost:8000/docs` | Swagger UI（交互式 API 文档） |
| `http://localhost:8000/redoc` | ReDoc（只读 API 文档） |

**API 模块**：

| 模块 | 前缀 | 端点数 |
|---|---|---|
| Auth | `/auth` | 3 (register/login/refresh) |
| Users | `/users` | 2 (profile/update) |
| Stocks | `/stocks` | 3 (list/kline/quote) |
| Analysis | `/analysis` | 4 (signals/ai) |
| Backtest | `/backtest` | 2 (run/history) |
| Alerts | `/alerts` | CRUD |
| Admin | `/admin/*` | 20+ (全量管理端点) |

> ➡️ 完整 API 规格：`docs/design/003-api-specification.md`

---

## 🧪 测试

### 测试统计

| 类别 | 文件 | 测试数 |
|---|---|---|
| 认证 API | `test_auth_api.py` | 5 |
| 业务逻辑 | `test_phase1_business.py` | 5 |
| 安全模块 | `test_security.py` | 5 |
| 股票数据 | `test_stock_data.py` | 9 |
| 回测精度 | `test_backtest_accuracy.py` | 6 |
| **合计** | — | **29** |

### 运行测试

```bash
cd backend

# 全部测试（SQLite，无需 MySQL）
pytest app/tests

# 策略&回测专项
pytest app/tests/test_backtest_accuracy.py app/tests/test_phase1_business.py

# 带覆盖率
pytest app/tests --cov=app --cov-report=term
```

---

## 📚 文档导航

| 文档 | 位置 |
|---|---|
| 📄 **项目 README** | `README.md`（本文件） |
| 🚀 **快速开始** | `docs/help/quickstart.md` |
| 🖥️ **管理后台指南** | `docs/help/admin-guide.md` |
| 🧩 **策略脚本参考** | `docs/help/strategy-script.md` |
| 🤖 **AI 配置指南** | `docs/help/ai-config.md` |
| 📐 **架构设计** | `docs/design/` (12 个文档) |
| 📊 **技术研究** | `docs/research/` (9 个文档) |
| ✅ **开发任务** | `docs/tasks/` (11 个任务，全部已完成) |
| 🤖 **AI 会话上下文** | `docs/ai/context.md` |

MkDocs 文档站：运行 `mkdocs serve` 后在 `http://localhost:8001` 查看完整文档。

---

## 🗺 路线图

```
Phase 1 ✅ 已完成 (2026-06-23)          Phase 2 📋 规划中
┌───────────────────────────────┐       ┌─────────────────────────┐
│ ✓ 用户认证 (JWT 双令牌)        │       │ ○ 支付与会员 (Stripe)     │
│ ✓ K线图表 (lightweight v5)    │       │ ○ Push / WebSocket 通知  │
│ ✓ 策略引擎 (结构化协议)        │       │ ○ ML 增强 (XGBoost/LSTM) │
│ ✓ 回测引擎 (自研, 10项指标)    │       │ ○ 指标插件系统 (252+)    │
│ ✓ AI 分析 (DeepSeek/模板)     │       │ ○ 参数优化 (Optuna)      │
│ ✓ 邮件提醒 (Resend + 去重)    │       │ ○ 用户端 Web/移动应用    │
│ ✓ 管理面板 (22 路由, 暗色UI)  │       │ ○ 多语言 + API Key       │
│ ✓ 10 张核心表 + Alembic 迁移  │       │ ○ CI/CD Pipeline         │
│ ✓ Docker 一键部署             │       │ ○ E2E 测试               │
│ ✓ 29 个测试 (SQLite)          │       │                          │
└───────────────────────────────┘       └─────────────────────────┘
```

---

## 🔧 开发指南

### 项目结构

```bash
# 后端开发
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 前端开发
cd admin
npm install
npm run dev

# 数据库迁移
cd backend
alembic upgrade head           # 执行迁移
alembic revision --autogenerate -m "..."  # 生成迁移

# 种子数据
cd backend
python seed_data.py

# 运行测试
pytest app/tests
```

### 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `APP_ENV` | `development` | 环境（development/production） |
| `DATABASE_URL` | `mysql+asyncmy://...` | MySQL 连接串 |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis 连接串 |
| `JWT_SECRET_KEY` | — | JWT 签名密钥 |
| `DEEPSEEK_API_KEY` | — | AI API 密钥 |
| `RESEND_API_KEY` | — | 邮件 API 密钥 |
| `CORS_ORIGINS` | `http://localhost:3000` | CORS 允许源 |

---

## ⚠️ 免责声明

> **Trend-Scope 提供的所有信号、分析和建议仅供参考，不构成投资建议。投资有风险，入市需谨慎。**
>
> 本平台旨在辅助投资者分析市场数据，不保证任何策略的盈利或准确性。历史回测结果不代表未来表现。用户应独立判断并在必要时咨询专业人士。

---

## 📄 License

MIT License &copy; 2026 Trend-Scope

---

<div align="center">

**Trend-Scope** — 让每一次交易决策都有据可依

[⭐ Star on GitHub](https://github.com/immane/trend-scope) · [📖 文档](https://github.com/immane/trend-scope/tree/main/docs)

</div>
