# Trend-Scope — AI Session Context

> **Date**: 2026-06-23
> **Session**: ses-20260623-001
> **Purpose**: 保存当前 AI 会话的完整上下文，以便后续会话快速恢复。

---

## 项目概述

**Trend-Scope** — 面向美股指数基金投资者的分级会员制投资分析平台。

- **目标用户**: 美股 ETF/指数基金投资者 (SPY, QQQ, TQQQ, SOXL 等)
- **核心价值**: 自动化策略信号 + AI 分析 + 回测验证 + 邮件提醒
- **商业模式**: 三级会员制 (Free/Basic $9.99/Pro $29.99)，Phase 2 实现支付

## 当前阶段

**Phase 1 MVP (已完成 ✅ — 2026-06-23)**

Phase 1 已实现:
1. 后端 FastAPI (认证、数据同步、策略引擎、回测、AI分析、邮件) ✅
2. 管理端 Next.js 14 (金融暗色 Admin UI、22 个路由、Dashboard、K线图表、策略编辑器、回测详情/对比、信号/AI分析、提醒、用户/规则/公告/数据管理) ✅
3. 用户 API (注册/登录、K线查询、信号查询、AI分析、提醒管理) ✅
4. 10 张核心数据库表 (MySQL 8.0) + Alembic 迁移 ✅
5. 4 个 APScheduler 定时任务 (数据同步→信号扫描→AI分析→提醒分发) ✅
6. 11 种策略模板 + 11 种自定义 Python 脚本策略 (结构化协议支持分仓/置信度/原因/AI上下文) ✅
7. 回测系统 (10项指标、权益曲线、回撤曲线、月度收益、交易日志、目标仓位调仓模型) ✅
8. 真实 K线图表 (lightweight-charts v5，蜡烛图+MA+成交量+MACD，多时间周期) ✅
9. 回测多策略对比 (归一化收益曲线叠加、指标对比表) ✅
10. 数据管理 (标的价格数据概况、删除、批量同步) ✅
11. 27 个自动化测试 (含回测会计准确性测试和目标仓位测试，SQLite) ✅
12. Docker Compose 一键部署 (自动迁移+种子数据) ✅
13. 5 个公共结构化策略 (波动率目标/Donchian突破/RSI趋势/低波动动量/回撤防御) ✅
14. AI 接口运行时配置 (管理面板在线配置，即时生效，无需重启) ✅
15. 完整 Help 文档 (快速开始、管理指南、策略协议、AI配置) ✅

## 实际技术栈与设计文档差异

| 设计文档 | 实际实现 | 原因 |
|---|---|---|
| vectorbt 回测引擎 | 自研 BacktestService (pandas 模拟) | vectorbt 依赖重，自研更可控 |
| RestrictedPython 沙箱 | AST 手动校验 + `exec()` 白名单 | 更简单可靠 |
| 3 种策略类型分离 | 统一为 `custom_script` Python 脚本 | 所有模板生成 Python 代码，编辑所见即所得 |
| yfinance 行情源 | Yahoo chart API 直连 + yfinance 兜底 + dev fallback | yfinance 在容器内被限流，API 直连可用 |
| 4 张 Phase 1 表 | 10 张 (users, user_sessions, stocks, stock_prices_daily, analysis_configs, analysis_signals, backtest_results, ai_analysis_results, alert_rules, alert_logs) | 实际需要完整业务闭环 |
| 策略返回 Series | 兼容 Series，扩展支持 DataFrame 结构化协议 | 支持 target_position/confidence/reason/ai_context |

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
│       ├── price_data.py     # 价格数据管理
│       ├── rules.py          # 提醒规则管理
│       ├── users.py          # 用户管理
│       ├── announcements.py  # 公告管理
│       └── ai_config.py     # AI 接口运行时配置
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
│   ├── alert.py              # AlertRule, AlertLog
│   └── announcement.py       # Announcement
├── services/
│   ├── stock_data.py         # DataService: yfinance+API直连+dev_fallback+富报价
│   ├── analysis_engine.py    # SignalEngine: generate_signals()+generate_strategy_frame()
│   ├── script_executor.py    # AST校验+沙箱执行（支持 Series & DataFrame 返回）
│   ├── backtest_service.py   # 自研回测引擎（信号模式 + 目标仓位调仓模式）
│   ├── ai_analysis_service.py # DeepSeek+fallback模板（运行时配置优先）
│   ├── ai_config.py          # AI 运行时配置存储
│   ├── email_service.py      # Resend邮件
│   └── alert_service.py      # 信号→规则匹配→邮件派发+去重
├── scheduler/
│   ├── jobs.py               # 4个定时Job函数
│   └── runner.py             # APScheduler生命周期
├── schemas/                  # Pydantic 请求/响应模型
└── tests/                    # 27个测试(含回测精度测试，SQLite backend)
```

## 当前 Admin 前端页面 (22 routes)

| Route | 功能 |
|---|---|
| `/login` | JWT 登录，金融暗色品牌入口 |
| `/dashboard` | 金融暗色 Hero + 统计卡片 + 调度状态 + 最近回测 |
| `/stocks` | 标的管理 (现价/涨跌/sparkline走势图/同步/编辑/删除) |
| `/stocks/create` | 新增标的 |
| `/stocks/[id]` | 详情: 富报价 + K线图(蜡烛+MA+量+MACD) + 52周区间 + 各周期收益 |
| `/strategies` | 策略管理 (启用开关/分页/日期倒序) |
| `/strategies/create` | 创建策略 (11模板+Monaco代码编辑器) |
| `/strategies/[id]` | 策略详情 (编辑代码/参数/回测历史/日期倒序) |
| `/backtest` | 回测历史 (分页/日期倒序/多选对比) |
| `/backtest/[id]` | 回测详情 (金融暗色图表: 渐变面积+发光线条+网格+零轴+数值标签) |
| `/backtest/compare?ids=` | 回测对比 (暗色金融图表: 多线叠加+暗色容器+阴影+终点圆点) |
| `/signals` | 信号列表 (日期倒序/类型筛选) |
| `/signals/[id]` | 信号详情 + AI 分析报告 |
| `/alerts` | 提醒日志 (日期倒序) |
| `/alerts/[id]` | 提醒日志详情 + 邮件内容预览 |
| `/rules` | 提醒规则管理 (用户/状态筛选、启停、日期倒序) |
| `/users` | 用户管理 (角色/状态筛选、提升管理员、封禁/解禁、日期倒序) |
| `/users/[id]` | 用户详情 + 基本资料修改 + 最近提醒/回测(日期倒序) |
| `/announcements` | 内容管理 (公告创建/编辑/发布/置顶/删除、日期倒序) |
| `/data` | 数据管理 (标的价格概况/日期倒序/删除/单标同步) |
| `/ai-config` | AI 接口设置 (API Key/Base URL/模型/开关，运行时即时生效) |

## 数据库表与关系

```
User ─── UserSession
  │
  ├── AlertRule ── AlertLog
  ├── BacktestResult (config_id → AnalysisConfig)
  │
Stock ─── StockPriceDaily
  │
  ├── AnalysisConfig (策略定义，含 custom_script 和 script_params)
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
| 回测 | 自研 BacktestService (pandas模拟) | 支持旧信号模式和新目标仓位调仓模式 |
| 图表 | lightweight-charts v5 + 暗色 SVG 金融图表 | 多面板(蜡烛+量+MACD)；权益/回撤曲线为产品级暗色面板 |
| 策略协议 | Series(-1/0/1) 兼容 + DataFrame 结构化协议 | 支持 target_position/confidence/reason/ai_context |
| Admin UI 风格 | 金融类暗色主题 | 深蓝黑背景、暗色网格、玻璃拟态卡片、暗色表格、金/青强调色 |
| 侧边栏 | 原生 flex 布局，非 AntD Layout | 深色渐变侧栏，可折叠，移动端抽屉式菜单 |
| AntD 主题 | `ConfigProvider` 在 client `providers.tsx` | 使用 `theme.darkAlgorithm` |
| AI 配置 | 运行时 `ai_config` 覆盖环境变量 | 管理面板即时生效，无需重启 |
| 数值格式化 | 共享 `format.ts` + `sort.ts` | formatMoney/formatPercent/formatInteger/formatRatio + dateDesc/sortByDateDesc |

## 本轮会话变更摘要 (2026-06-23)

### Admin UI 优化
- 金融暗色主题全面覆盖：全局视觉系统、表格、卡片、按钮、输入框、Tag、Hero、图表
- 后台壳层升级：可折叠侧栏、移动端抽屉、半透明顶栏、品牌 Logo
- 登录页/Dashboard 重新设计
- 回测图表升级为专业金融暗色面板：渐变面积、发光线、网格、零轴、数值标签

### 日期列表倒序
- 新增 `admin/src/lib/sort.ts` 共享排序工具
- 12 个页面表格和详情列表默认日期倒序

### 策略协议升级
- 策略可返回 `pd.DataFrame`（兼容旧 `pd.Series`）
- 新增标准化字段：`target_position` / `confidence` / `reason` / `ai_context`
- 回测引擎新增目标仓位调仓模式，支持分仓
- 信号扫描读取结构化字段，写入 `trigger_details`
- 新增 5 个公共结构化策略并 TSLA 回测验证
- 新增 `docs/help/strategy-script.md` 完整 Help 文档

### 回测会计模型修正
- 买入股数按成交额加手续费计算，不再先买后扣费
- 持仓权益 = `cash + shares * close`
- 交易 PnL = 净卖出收入 − 完整入场成本
- 指标精度改用原始权益序列
- 新增 `test_backtest_accuracy.py` 3 个确定性复算测试

### AI 接口设置
- 新增 `backend/app/services/ai_config.py` 运行时配置存储
- `GET/PATCH /admin/ai-config` API 端点
- 管理面板 `/ai-config` 页面
- AI 服务优先读运行时配置，即时生效

## 待后续会话处理

1. 真实数据覆盖量不足：当前每个标的约 500 行 (~2 年)，需要更长历史
2. 生产环境部署 (当前仅 Docker Compose 本地开发)
3. CI/CD pipeline
4. 前端单元测试 / E2E 测试
5. Admin UI 可补充 Playwright 视觉回归测试
