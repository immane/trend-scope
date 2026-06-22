# Trend-Scope — AI Session Context

> **Date**: 2026-06-22
> **Session**: ses-20260622-001
> **Purpose**: 保存当前 AI 会话的完整上下文，以便后续会话快速恢复。

---

## 项目概述

**Trend-Scope** — 面向美股指数基金投资者的分级会员制投资分析平台。

- **目标用户**: 美股 ETF/指数基金投资者 (SPY, QQQ, TQQQ, SOXL 等)
- **核心价值**: 自动化策略信号 + AI 分析 + 回测验证 + 邮件提醒
- **商业模式**: 三级会员制 (Free/Basic $9.99/Pro $29.99)，Phase 2 实现支付

## 当前阶段

**Phase 1 MVP (已完成 ✅)**

Phase 1 已实现:
1. 后端 FastAPI (认证、数据同步、策略引擎、回测、AI分析、邮件) ✅
2. 管理端 Next.js 14 (Dashboard、标的管理+K线图表、策略管理+代码编辑器、回测详情+对比、信号查看、提醒日志、数据管理) ✅
3. 用户 API (注册/登录、K线查询、信号查询、AI分析、提醒管理) ✅
4. 10 张核心数据库表 (MySQL 8.0) + Alembic 迁移 ✅
5. 4 个 APScheduler 定时任务 (数据同步→信号扫描→AI分析→提醒分发) ✅
6. 11 种策略模板 (均以 Python 可编辑脚本执行) ✅
7. 回测系统 (10项指标、权益曲线、回撤曲线、月度收益、交易日志) ✅
8. 真实 K线图表 (lightweight-charts v5，蜡烛图+MA+成交量+MACD，多时间周期) ✅
9. 回测多策略对比 (归一化收益曲线叠加、指标对比表) ✅
10. 数据管理 (标的价格数据概况、删除、批量同步) ✅
11. 24 个自动化测试 (SQLite 测试库，无需 MySQL) ✅
12. Docker Compose 一键部署 (自动迁移+种子数据) ✅

## 实际技术栈与设计文档差异

| 设计文档 | 实际实现 | 原因 |
|---|---|---|
| vectorbt 回测引擎 | 自研 BacktestService (pandas 模拟) | vectorbt 依赖重，自研更可控 |
| RestrictedPython 沙箱 | AST 手动校验 + `exec()` 白名单 | 更简单可靠 |
| 3 种策略类型分离 | 统一为 `custom_script` Python 脚本 | 所有模板生成 Python 代码，编辑所见即所得 |
| yfinance 行情源 | Yahoo chart API 直连 + yfinance 兜底 + dev fallback | yfinance 在容器内被限流，API 直连可用 |
| 4 张 Phase 1 表 | 10 张 (users, user_sessions, stocks, stock_prices_daily, analysis_configs, analysis_signals, backtest_results, ai_analysis_results, alert_rules, alert_logs) | 实际需要完整业务闭环 |

## 当前后端文件结构

```
backend/app/
├── api/v1/
│   ├── auth.py              # 注册/登录/刷新 JWT
│   ├── users.py             # 用户资料 CRUD
│   ├── stocks.py            # 股票查询、K线、富报价
│   ├── analysis.py          # 信号查询、AI分析
│   ├── backtest.py          # 回测运行/历史
│   ├── alerts.py            # 提醒规则 CRUD
│   ├── router.py            # API 路由注册
│   └── admin/
│       ├── __init__.py
│       ├── stocks.py         # 标的管理CRUD、sync-all、summaries
│       ├── strategies.py     # 策略CRUD、校验、试运行
│       ├── signals.py        # 信号列表
│       ├── backtest.py       # 回测列表/详情(含策略名)
│       ├── dashboard.py      # 统计+调度状态+手动触发
│       ├── alerts.py         # 提醒日志
│       └── price_data.py     # 价格数据管理
├── core/
│   ├── config.py             # Pydantic Settings
│   ├── deps.py               # get_db, get_current_user, get_admin_user
│   ├── security.py           # JWT + bcrypt
│   └── exceptions.py         # 全局异常处理
├── models/
│   ├── base.py               # Base, TimestampMixin
│   ├── user.py               # User, UserSession
│   ├── stock.py              # Stock, StockPriceDaily
│   ├── analysis.py           # AnalysisConfig, AnalysisSignal
│   ├── backtest.py           # BacktestResult (DECIMAL(18,6))
│   ├── ai_analysis.py        # AIAnalysisResult
│   └── alert.py              # AlertRule, AlertLog
├── services/
│   ├── stock_data.py         # DataService: yfinance+API直连+dev_fallback+富报价
│   ├── analysis_engine.py    # SignalEngine: generate_signals()+扫描
│   ├── script_executor.py    # AST校验+沙箱执行
│   ├── backtest_service.py   # 自研回测引擎
│   ├── ai_analysis_service.py # DeepSeek+fallback模板
│   ├── email_service.py      # Resend邮件
│   └── alert_service.py      # 信号→规则匹配→邮件派发+去重
├── scheduler/
│   ├── jobs.py               # 4个定时Job函数
│   └── runner.py             # APScheduler生命周期
├── schemas/                  # Pydantic 请求/响应模型
└── tests/                    # 24个测试(SQLite backend)
```

## 当前 Admin 前端页面 (16 routes)

| Route | 功能 |
|---|---|
| `/login` | JWT 登录，token 持久化 |
| `/dashboard` | 统计卡片 + 调度状态 + 最近回测 |
| `/stocks` | 标的管理 (现价/涨跌/走势图/同步/编辑/删除) |
| `/stocks/create` | 新增标的 |
| `/stocks/[id]` | 详情: 富报价信息 + TradingView K线图(蜡烛+MA+量+MACD) + 52周区间 + 各周期收益 |
| `/strategies` | 策略管理 (启用开关/分页) |
| `/strategies/create` | 创建策略 (11模板+Monaco代码编辑器) |
| `/strategies/[id]` | 策略详情 (编辑代码/参数/回测历史) |
| `/backtest` | 回测历史 (分页/多选对比/策略名) |
| `/backtest/[id]` | 回测详情 (完整的权益曲线+回撤曲线+月度收益+交易明细+风险指标) |
| `/backtest/compare?ids=` | 回测对比 (多线归一化收益+回撤+指标排序表) |
| `/signals` | 信号列表 + AI 生成按钮 |
| `/alerts` | 提醒日志 |
| `/data` | 数据管理 (标的价格数据概况/删除/单标同步) |

## 数据库表与关系

```
User ─── UserSession
  │
  ├── AlertRule ── AlertLog
  ├── BacktestResult (config_id → AnalysisConfig)
  │
Stock ─── StockPriceDaily
  │
  ├── AnalysisConfig (策略定义，含 custom_script)
  │
  └── AnalysisSignal
       └── AIAnalysisResult (1:1, unique)
```

## 关键技术决策更新

| 决策 | 当前选择 | 说明 |
|---|---|---|
| 数据源 | Yahoo chart v8 API 直连 | yfinance 在 Docker 容器被限流，直连 API 正常 |
| 开发环境 | 非 production 自动降级到 dev_fallback 合成数据 | 本地离线也可开发和回测 |
| 测试 | SQLite + 模型 BigInteger→Integer variant | 不依赖 MySQL |
| 回测 | 自研 BacktestService (pandas模拟) | DECIMAL(18,6) 列防溢出 |
| 图表 | lightweight-charts v5 | 多面板(蜡烛+量+MACD)，priceScaleId 分离标尺 |
| 策略 | 11 种内置模板，均以 Python 脚本保存和编辑 | MA/EMA/RSI/MACD/Bollinger/Donchian/Momentum/Z-Score/Volume/Trend+RSI/Buy&Hold |
| 侧边栏 | 原生 flex 布局，非 AntD Layout | 修复高度自适应和底部状态栏 |
| 数值格式化 | 共享 `format.ts` (千位分隔符) | formatMoney/formatPercent/formatInteger/formatRatio |

## 待后续会话处理

1. 真实数据覆盖量不足：当前每个标的仅约 2 年日线 (500 行)，需要更长时间跨度
2. 前端 TradingView LWC 图表尚未完全替代（当前使用 lightweight-charts）
3. Phase 2 准备：支付/会员/ML/指标插件
4. 生产环境部署 (当前仅 Docker Compose 本地开发)
5. CI/CD pipeline
6. 前端单元测试 / E2E 测试
