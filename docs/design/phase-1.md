# Phase 1 — MVP 完整详细设计文档

> **Status**: Phase 1 MVP Design (v1.1 — 增加回测系统)  
> **Date**: 2026-06-09  
> **Purpose**: Phase 1 完整实现规格。之后将基于本文档拆分为可执行的开发 Tasks。
>
> **关联设计文档**:
> - [001-preliminary-design.md](./001-preliminary-design.md) — 总体架构
> - [002-database-schema.md](./002-database-schema.md) — 数据库 DDL
> - [003-api-specification.md](./003-api-specification.md) — API 规格
> - [004-analysis-engine.md](./004-analysis-engine.md) — 分析引擎
> - [007-backtest-system.md](./007-backtest-system.md) — 回测系统

---

## 1. Phase 1 目标与范围

### 1.1 一句话目标

> 管理端 + 后端 + 用户 API 可用，能展示 K 线，支持 Admin 自定义策略定时生成买卖信号，能回测验证策略，能 AI 分析信号，能通过邮件提醒用户。

### 1.2 包含功能

| # | 功能 | 概要 |
|---|---|---|
| F1 | **管理端前端 (Next.js)** | 登录、Dashboard、标的管理(含K线)、策略管理(预设+自定义脚本)、回测、信号查看、提醒模板 |
| F2 | **后端服务 (FastAPI)** | 全部 API、认证、数据同步、信号生成调度、回测执行、AI 分析、邮件发送 |
| F3 | **用户认证系统** | 注册、登录、JWT 双令牌、角色(admin/user) |
| F4 | **K 线展示** | TradingView Lightweight Charts，日线 OHLC + MA20/MA60/Volume，后端预计算 |
| F5 | **策略系统** | Admin 可创建系统预设策略(MA交叉参数) 或 自定义 Python 脚本策略（沙箱执行） |
| F6 | **定时信号生成** | APScheduler 每日收盘后自动扫描全部活跃策略，生成买卖信号存入 DB |
| F7 | **策略回测** | 对任意策略(预设/自定义脚本)跑回测，输出收益/回撤/Sharpe/胜率/盈亏比 + 权益曲线 |
| F8 | **AI 信号分析** | 信号触发时调用 LLM (DeepSeek) 生成结构化分析报告（为什么买、风险、止损） |
| F9 | **邮件提醒** | 信号生成后匹配用户提醒规则，通过 Resend 发送邮件通知 |

### 1.3 明确不包含 (挪至 Phase 2)

| 不包含 | 说明 |
|---|---|
| 支付/订阅 | 全部用户免费，无会员等级限制 |
| ML 增强分析 (Layer 2) | Phase 2 |
| 指标插件系统 | Phase 2，Phase 1 仅内置 MA/SMA/EMA/RSI/MACD |
| Push 通知 / WebSocket | Phase 2，Phase 1 仅邮件 |
| 通知偏好/摘要模式 | Phase 2，Phase 1 全部实时邮件 |
| 多语言 | Phase 1 仅中文 |
| 自选/Watchlist | Phase 2 |
| 支付宝/微信支付 | Phase 2 |
| 审计日志 | Phase 2 |
| 全面限流 | Phase 1 仅简单全局限流 |
| 参数优化 (Optuna) | Phase 2，Phase 1 回测仅单次运行 |
| 回测 HTML 报告 | Phase 2，Phase 1 用 JSON metrics + 前端权益曲线图 |

---

## 2. 架构总览

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Phase 1 MVP                                  │
│                                                                       │
│  ┌──────────────┐     ┌─────────────────────────────────────────┐    │
│  │ Admin Panel  │────▶│           FastAPI Backend                │    │
│  │ (Next.js 14) │     │                                          │    │
│  │              │     │  ┌─────────┐  ┌──────────┐  ┌────────┐  │    │
│  │ - Login      │     │  │ Auth    │  │ Stocks   │  │Analysis│  │    │
│  │ - Dashboard  │     │  │ Module  │  │ Module   │  │Module  │  │    │
│  │ - Stocks/K线 │     │  └─────────┘  └──────────┘  └────────┘  │    │
│  │ - Strategies │     │  ┌─────────┐  ┌──────────┐  ┌────────┐  │    │
│  │ - Backtest   │     │  │Strategy │  │ Backtest │  │  AI    │  │    │
│  │ - Signals    │     │  │Module   │  │ Module   │  │Analysis│  │    │
│  │ - Alerts     │     │  └─────────┘  └──────────┘  └────────┘  │    │
│  └──────────────┘     │  ┌─────────┐  ┌──────────┐             │    │
│                        │  │Scheduler│  │  Email   │             │    │
│    User API Clients    │  │(APS)    │  │ (Resend) │             │    │
│    (future mobile/web)─▶│  └─────────┘  └──────────┘             │    │
│                        │  ┌──────────────────────┐              │    │
│                        │  │  Alert Module        │              │    │
│                        │  └──────────────────────┘              │    │
│                        └─────────────────────────────────────────┘    │
│                                     │                                  │
│                        ┌────────────┴────────────┐                    │
│                        │                         │                    │
│                   ┌────┴─────┐            ┌──────┴──────┐             │
│                   │  MySQL 8 │            │   Redis 7   │             │
│                   │  (主库)   │            │ (缓存/限流)  │             │
│                   └──────────┘            └─────────────┘             │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.1 技术栈 (Phase 1)

| 层 | 技术 | 用途 |
|---|---|---|
| 后端框架 | FastAPI 0.115+ | REST API + 后台任务 |
| ORM | SQLAlchemy 2.0 (async) | 数据访问 |
| 迁移 | Alembic 1.14+ | Schema 管理 |
| 定时任务 | APScheduler 4.x | 数据同步、信号扫描 |
| 数据库 | MySQL 8.0 | 主存储 |
| 缓存 | Redis 7.x | 行情缓存、限流计数、回测队列 |
| 数据源 | yfinance | 美股日线 |
| 技术指标 | pandas-ta-classic | MA/RSI/MACD 计算 |
| 回测引擎 | vectorbt 1.0+ | 矢量化回测，10k+ 参数组合 |
| AI | DeepSeek V4-Flash (OpenAI-compatible) | 信号分析 |
| 邮件 | Resend | 提醒邮件发送 |
| 前端 | Next.js 14 + Ant Design 5 | 管理面板 |
| 图表 | TradingView Lightweight Charts 5.2 | K 线渲染 + 回测权益曲线 |
| 部署 | Docker Compose | 本地开发 |

---

## 3. 数据库表 (Phase 1 子集)

Phase 1 使用 13 张表（完整 26 张中的子集）：

```
User ─── UserSession
  │
  ├── AlertRule ─── AlertLog
  ├── BacktestResult (回测结果)
  │
Stock ─── StockPriceDaily
  │
  ├── AnalysisConfig (策略定义，含 custom_script)
  │
  └── AnalysisSignal
       └── AIAnalysisResult
```

### 3.1 表清单

| 表 | 用途 | Phase |
|---|---|---|
| `users` | 用户账户 | P1 |
| `user_sessions` | JWT Refresh Token 持久化 | P1 |
| `stocks` | 标的资产 | P1 |
| `stock_prices_daily` | 日线 OHLCV | P1 |
| `analysis_configs` | 策略定义（预设 + 自定义脚本） | P1 |
| `analysis_signals` | 生成的买卖信号 | P1 |
| `backtest_results` | 回测结果（含 metrics + equity_curve） | P1 |
| `ai_analysis_results` | AI 分析报告 | P1 |
| `alert_rules` | 用户提醒规则 | P1 |
| `alert_logs` | 提醒发送日志 | P1 |

> 注：完整 DDL 参考 [002-database-schema.md](./002-database-schema.md)，Phase 1 只建上述表。Phase 2 将新增 `backtest_jobs` 用于异步任务队列管理。

### 3.2 关键字段说明

#### 3.2.1 analysis_configs — 策略定义

```sql
analysis_configs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    stock_id BIGINT NOT NULL,                     -- NULL = 全局策略(适用全部标的)
    name VARCHAR(100) NOT NULL,                   -- "MA20x60 金叉策略"
    description TEXT,                              -- 策略描述
    strategy_type ENUM('ma_cross', 'multi_indicator', 'custom_script') NOT NULL,
    
    -- 预设策略参数 (strategy_type = ma_cross / multi_indicator)
    params JSON NOT NULL DEFAULT '{}',            -- {"ma_short": 20, "ma_long": 60, "confirm_bars": 1}
    
    -- 自定义脚本 (strategy_type = custom_script)
    script_content TEXT,                           -- Admin 编写的 Python 脚本
    script_params JSON DEFAULT '{}',               -- 脚本的可调参数 {"threshold": 0.02}
    
    -- 执行控制
    confirm_bars INT DEFAULT 0,                    -- 确认 K 线数
    volume_confirm BOOLEAN DEFAULT FALSE,          -- 是否需要成交量确认
    is_active BOOLEAN DEFAULT TRUE,                -- 是否启用
    created_by BIGINT NOT NULL REFERENCES users(id),
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_active_stock (is_active, stock_id)
);
```

**策略类型说明**:

| strategy_type | 用法 | 参数来源 |
|---|---|---|
| `ma_cross` | 简单均线交叉 (MA_short 上穿/下穿 MA_long) | `params` JSON: `ma_short`, `ma_long` |
| `multi_indicator` | 多指标综合评分 (MA + RSI + MACD) | `params` JSON: 各指标参数和权重 |
| `custom_script` | Admin 自定义 Python 脚本 | `script_content` 字段 |

#### 3.2.2 自定义脚本规范

脚本必须定义一个 `analyze()` 函数：

```python
def analyze(df: 'pd.DataFrame', params: dict) -> 'pd.Series':
    """
    参数:
        df: DataFrame with columns ['open','high','low','close','volume'], 
            index = DatetimeIndex
        params: dict from analysis_configs.script_params
    
    返回:
        pd.Series, index 对齐 df.index:
            1  = 买入信号 (buy)
           -1  = 卖出信号 (sell)
            0  = 无信号 (hold)
    """
    # ... admin 自定义逻辑 ...
```

**沙箱限制**:
- 执行超时: 10 秒
- 可用库白名单: `pandas`, `numpy`, `pandas_ta` (or `talib`)
- 禁止: `os`, `sys`, `subprocess`, `socket`, `requests`, 文件 I/O
- 保存前自动执行测试：随机选取最近 100 个交易日数据试运行

#### 3.2.3 analysis_signals

```sql
analysis_signals (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    stock_id BIGINT NOT NULL REFERENCES stocks(id),
    config_id BIGINT NOT NULL REFERENCES analysis_configs(id),
    signal_type ENUM('buy', 'sell') NOT NULL,
    signal_subtype VARCHAR(50),                                    -- golden_cross, death_cross, custom
    strength ENUM('weak', 'normal', 'strong') DEFAULT 'normal',
    confidence DECIMAL(4,3),                                       -- 0.000-1.000
    trigger_price DECIMAL(12,4) NOT NULL,
    trigger_details JSON NOT NULL DEFAULT '{}',
    triggered_date DATE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_stock_triggered (stock_id, triggered_date DESC),
    INDEX idx_active_signals (is_active)
);
```

#### 3.2.4 回测结果 (Phase 1 简化版)

```sql
backtest_results (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),            -- 谁触发的回测
    stock_id BIGINT NOT NULL REFERENCES stocks(id),
    config_id BIGINT NOT NULL REFERENCES analysis_configs(id),
    status ENUM('running', 'completed', 'failed') DEFAULT 'running',
    
    -- 输入参数
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    initial_capital DECIMAL(14,2) NOT NULL DEFAULT 100000.00,
    slippage_pct DECIMAL(6,4) DEFAULT 0.0005,
    commission_pct DECIMAL(6,4) DEFAULT 0.0010,
    
    -- 结果指标
    total_return DECIMAL(8,4),                               -- 总收益率 (0.1532 = 15.32%)
    cagr DECIMAL(8,4),                                       -- 年化收益率
    max_drawdown DECIMAL(8,4),                               -- 最大回撤
    sharpe_ratio DECIMAL(8,4),                               -- 夏普比率
    sortino_ratio DECIMAL(8,4),
    calmar_ratio DECIMAL(8,4),
    win_rate DECIMAL(8,4),                                   -- 胜率
    profit_factor DECIMAL(8,4),                              -- 盈亏比
    num_trades INT,
    benchmark_return DECIMAL(8,4),                           -- SPY 同期收益率
    
    -- 曲线数据
    equity_curve JSON,                                       -- [{date, equity}, ...]
    drawdown_curve JSON,                                     -- [{date, drawdown_pct}, ...]
    monthly_returns JSON,                                    -- [{year_month, return_pct}, ...]
    trade_log JSON,                                          -- [{entry_date, exit_date, return}, ...]
    
    -- 元信息
    execution_time_ms INT,                                   -- 执行耗时 (ms)
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_config (config_id),
    INDEX idx_user_created (user_id, created_at DESC)
);
```

> **Phase 1 简化**: 不使用 `backtest_jobs` 表，回测同步执行或通过 FastAPI `BackgroundTasks` 异步执行，直接写入 `backtest_results`。Phase 2 迁移到 ARQ 队列时再引入 `backtest_jobs` 表。

#### 3.2.5 AI 分析结果

```sql
ai_analysis_results (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    signal_id BIGINT NOT NULL REFERENCES analysis_signals(id) ON DELETE CASCADE,
    model_provider VARCHAR(50) NOT NULL DEFAULT 'deepseek',
    model_name VARCHAR(100) NOT NULL DEFAULT 'deepseek-chat',
    prompt_tokens INT DEFAULT 0,
    completion_tokens INT DEFAULT 0,
    total_cost DECIMAL(10,6) DEFAULT 0.000000,
    analysis_json JSON NOT NULL,
    generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_signal_analysis (signal_id)
);
```

#### 3.2.6 提醒规则和日志

```sql
alert_rules (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    stock_id BIGINT NOT NULL REFERENCES stocks(id),
    alert_type ENUM('any_signal', 'buy_signal', 'sell_signal') NOT NULL DEFAULT 'any_signal',
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_user_stock_type (user_id, stock_id, alert_type)
);

alert_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    alert_rule_id BIGINT REFERENCES alert_rules(id),
    user_id BIGINT NOT NULL REFERENCES users(id),
    stock_id BIGINT NOT NULL REFERENCES stocks(id),
    signal_id BIGINT REFERENCES analysis_signals(id),
    channel ENUM('email') NOT NULL DEFAULT 'email',
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    status ENUM('sent', 'failed') DEFAULT 'sent',
    provider_message_id VARCHAR(255),
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_user_sent (user_id, sent_at DESC)
);
```

---

## 4. 后端模块设计

```
backend/app/
├── main.py                          # FastAPI 应用入口、中间件注册、router 挂载、startup/shutdown
├── api/v1/
│   ├── router.py                    # 聚合所有子路由
│   ├── auth.py                      # POST register/login/refresh
│   ├── users.py                     # GET/PATCH /users/me
│   ├── stocks.py                    # GET /stocks, GET /stocks/{id}, GET /stocks/{id}/kline
│   ├── analysis.py                  # GET signals, GET AI analysis
│   ├── backtest.py                  # POST /backtest/run, GET /backtest/{id}, GET /backtest/history
│   ├── alerts.py                    # GET/POST/DELETE /alerts
│   └── admin/                       # 管理端路由 (需 admin role)
│       ├── __init__.py
│       ├── dashboard.py             # GET /admin/dashboard/stats
│       ├── users.py                 # GET/POST /admin/users
│       ├── stocks.py                # GET/POST/PATCH/DELETE /admin/stocks
│       ├── strategies.py            # GET/POST/PATCH/DELETE /admin/strategies
│       ├── backtest.py              # GET /admin/backtests (全部回测记录)
│       ├── signals.py               # GET /admin/signals
│       └── alerts.py                # GET /admin/alerts
├── core/
│   ├── config.py                    # pydantic-settings
│   ├── security.py                  # JWT + password hashing
│   ├── deps.py                     # get_db, get_current_user, get_admin_user
│   └── exceptions.py               # AppException, global handlers
├── models/                          # SQLAlchemy ORM
│   ├── base.py
│   ├── user.py
│   ├── stock.py
│   ├── analysis.py
│   ├── backtest.py                  # ★ BacktestResult model
│   ├── ai_analysis.py
│   └── alert.py
├── schemas/                         # Pydantic request/response
│   ├── auth.py
│   ├── user.py
│   ├── stock.py
│   ├── analysis.py
│   ├── backtest.py                  # ★ BacktestRunRequest, BacktestResultOut, BacktestHistoryItem
│   ├── alert.py
│   └── common.py
├── services/
│   ├── stock_data.py                # DataService: yfinance 封装
│   ├── analysis_engine.py           # SignalEngine: 3 种 strategy_type 分发
│   ├── script_executor.py           # ScriptExecutor: 沙箱执行
│   ├── backtest_service.py          # ★ BacktestService: vectorbt 回测执行
│   ├── ai_analysis_service.py       # AIAnalysisService: LLM 分析
│   ├── alert_service.py             # AlertService: 提醒匹配 + 发送
│   └── email_service.py            # EmailService: Resend API
├── scheduler/
│   ├── jobs.py                      # 定时任务定义
│   └── runner.py                    # APScheduler 启动
├── middleware/
│   └── rate_limit.py               # 简单全局限流
└── tests/
```

### 4.1 策略引擎 (analysis_engine.py)

```python
class SignalEngine:
    """策略引擎：根据 analysis_config 类型分发执行"""
    
    async def scan_all_active(self, db: AsyncSession) -> list[AnalysisSignal]:
        """扫描所有活跃策略，返回新生成的信号列表"""
        
    async def scan_single(self, config: AnalysisConfig, db: AsyncSession) -> AnalysisSignal | None:
        """扫描单个策略"""
        df = await self._get_price_data(config.stock_id)
        if config.strategy_type == "ma_cross":
            signal = self._run_ma_cross(df, config)
        elif config.strategy_type == "multi_indicator":
            signal = self._run_multi_indicator(df, config)
        elif config.strategy_type == "custom_script":
            signal = await self._run_custom_script(df, config)
        return signal
```

### 4.2 脚本执行器 (script_executor.py)

```python
class ScriptExecutor:
    """自定义策略脚本沙箱执行器"""
    ALLOWED_MODULES = {'pandas', 'numpy', 'pandas_ta', 'talib'}
    TIMEOUT = 10  # seconds
    
    async def validate(self, script: str) -> tuple[bool, str]: ...
    async def execute(self, script: str, df: pd.DataFrame, params: dict) -> pd.Series: ...
```

> **安全提示**: 自定义脚本功能有安全风险。Phase 1 用 `RestrictedPython` 做沙箱，仅 Admin 可用。Phase 2 可考虑 Docker 容器化执行。

### 4.3 回测服务 (backtest_service.py) — ★ 新增

```python
import vectorbt as vbt

class BacktestService:
    """回测服务：对策略执行历史回测"""
    
    async def run_backtest(
        self, db: AsyncSession,
        stock_id: int, config_id: int,
        start_date: date, end_date: date,
        initial_capital: float = 100000.0,
        slippage_pct: float = 0.0005,
        commission_pct: float = 0.001,
    ) -> BacktestResult:
        """
        执行回测并存储结果。
        1. 加载历史价格数据
        2. 根据 strategy_type 生成信号数组
        3. vectorbt Portfolio.from_signals 模拟交易
        4. 计算指标：Total Return, CAGR, MDD, Sharpe, Win Rate, Profit Factor
        5. 生成权益曲线 + 回撤曲线
        6. 与 SPY buy-and-hold 对比
        7. 写入 backtest_results 表
        """
    
    def _generate_signals(self, df: pd.DataFrame, config: AnalysisConfig) -> pd.Series:
        """根据策略配置生成信号数组 (与 SignalEngine 共用逻辑)"""
    
    def _compute_metrics(self, portfolio: vbt.Portfolio, benchmark_return: float) -> dict:
        """计算回测指标"""
    
    def _generate_equity_curve(self, portfolio: vbt.Portfolio) -> list[dict]:
        """生成权益曲线 [{date, equity}, ...]"""
    
    def _generate_benchmark(self, df: pd.DataFrame, start_date, end_date) -> float:
        """计算 SPY/QQQ buy-and-hold 同期收益"""
```

**回测指标清单** (Phase 1):

| 指标 | 公式 | 说明 |
|---|---|---|
| Total Return | (final / initial) - 1 | 总收益率 |
| CAGR | (final / initial)^(1/years) - 1 | 年化收益率 |
| Max Drawdown | max((peak - trough) / peak) | 最大回撤 |
| Sharpe Ratio | (Rp - Rf) / σp | > 1.0 优秀 |
| Sortino Ratio | (Rp - Rf) / σd | 下行风险调整 |
| Calmar Ratio | CAGR / |MDD\| | > 1.0 优秀 |
| Win Rate | winning / total | 胜率 |
| Profit Factor | gross_profit / gross_loss | > 1.5 优秀 |
| Number of Trades | count | 交易次数 |
| Benchmark Return | SPY buy-and-hold | 基准收益 |

**回测现实化参数**:
- 滑点: ≥ 0.05%/边 (默认)
- 手续费: 0.1%/笔 (安全边际)
- 无未来函数: 信号全部 `shift(1)`

---

## 5. API 端点 (Phase 1)

### 5.1 公开端点

| Method | Path | 说明 | 认证 |
|---|---|---|---|
| POST | `/api/v1/auth/register` | 用户注册 | 无 |
| POST | `/api/v1/auth/login` | 用户登录，返回 tokens | 无 |
| POST | `/api/v1/auth/refresh` | 刷新 Access Token | Refresh Token |

### 5.2 用户端端点 (需认证)

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/v1/users/me` | 当前用户信息 |
| PATCH | `/api/v1/users/me` | 更新个人信息 |
| GET | `/api/v1/stocks` | 标的列表 (搜索/分页) |
| GET | `/api/v1/stocks/{id}` | 标的详情 |
| GET | `/api/v1/stocks/{id}/kline?period=day&limit=200` | K 线数据 (含预计算 MA) |
| GET | `/api/v1/analysis/{stock_id}/signals` | 最近信号列表 |
| GET | `/api/v1/analysis/{stock_id}/ai/{signal_id}` | AI 分析报告 |
| GET | `/api/v1/alerts` | 我的提醒规则 |
| POST | `/api/v1/alerts` | 创建提醒规则 |
| DELETE | `/api/v1/alerts/{id}` | 删除提醒规则 |

### 5.3 回测端点 (需认证 + admin)

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/v1/backtest/run` | 提交回测任务，同步/异步执行 |
| GET | `/api/v1/backtest/{id}` | 查询回测结果 (含 metrics + equity_curve) |
| GET | `/api/v1/backtest/history?config_id={id}` | 某策略的历史回测记录 |
| GET | `/api/v1/admin/backtests` | 全部回测记录 (Admin) |

### 5.4 管理端端点 (需认证 + admin role)

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/v1/admin/dashboard/stats` | 统计概览 |
| GET | `/api/v1/admin/users` | 用户列表 |
| POST | `/api/v1/admin/users` | 创建用户 |
| GET | `/api/v1/admin/stocks` | 标的列表 (管理) |
| POST | `/api/v1/admin/stocks` | 添加标的 |
| PATCH | `/api/v1/admin/stocks/{id}` | 编辑标的 |
| DELETE | `/api/v1/admin/stocks/{id}` | 下架标的 |
| GET | `/api/v1/admin/strategies` | 策略列表 |
| POST | `/api/v1/admin/strategies` | 创建策略 (含自定义脚本) |
| GET | `/api/v1/admin/strategies/{id}` | 策略详情 + 脚本内容 |
| PATCH | `/api/v1/admin/strategies/{id}` | 编辑策略 |
| DELETE | `/api/v1/admin/strategies/{id}` | 删除策略 |
| POST | `/api/v1/admin/strategies/{id}/validate` | 验证自定义脚本 |
| POST | `/api/v1/admin/strategies/{id}/test-run` | 策略试运行 |
| GET | `/api/v1/admin/signals` | 全部信号列表 |
| GET | `/api/v1/admin/alerts` | 全部提醒日志 |

### 5.5 回测 API 请求/响应示例

```json
// POST /api/v1/backtest/run
{
  "stock_id": 1,
  "config_id": 3,
  "start_date": "2023-01-01",
  "end_date": "2026-06-09",
  "initial_capital": 100000.00,
  "slippage_pct": 0.0005,
  "commission_pct": 0.001
}

// Response (回测完成)
{
  "id": 42,
  "status": "completed",
  "start_date": "2023-01-01",
  "end_date": "2026-06-09",
  "initial_capital": 100000.00,
  "metrics": {
    "total_return": 0.3521,
    "cagr": 0.0914,
    "max_drawdown": -0.1832,
    "sharpe_ratio": 1.12,
    "sortino_ratio": 1.85,
    "calmar_ratio": 0.50,
    "win_rate": 0.452,
    "profit_factor": 1.62,
    "num_trades": 42,
    "benchmark_return": 0.2815
  },
  "equity_curve": [
    {"date": "2023-01-03", "equity": 100000.00},
    {"date": "2023-01-04", "equity": 100520.00}
  ],
  "drawdown_curve": [
    {"date": "2023-01-03", "drawdown_pct": 0},
    {"date": "2023-03-15", "drawdown_pct": -0.052}
  ],
  "monthly_returns": [
    {"year_month": "2023-01", "return_pct": 0.032},
    {"year_month": "2023-02", "return_pct": -0.015}
  ],
  "execution_time_ms": 245,
  "created_at": "2026-06-09T17:30:00Z"
}
```

### 5.6 通用约定 (Phase 1)

- 分页: `?page=1&size=20` → `{ items: [...], total: N, page: 1, size: 20, pages: M }`
- 错误: `{ detail: "描述", code: "ERROR_CODE" }`
- 日期: `YYYY-MM-DD` (ISO 8601 date only)
- 认证: `Authorization: Bearer <access_token>`
- CORS: 允许 admin 域名

---

## 6. 策略系统详细设计

### 6.1 策略类型

```
┌─────────────────── Strategy Types ───────────────────┐
│                                                       │
│  ① System Preset (MA Cross)                           │
│     - Admin 通过 UI 表单配置参数                       │
│     - strategy_type = 'ma_cross'                      │
│     - params = {"ma_short": 20, "ma_long": 60}        │
│     - 后端内置均线交叉算法                              │
│                                                       │
│  ② System Preset (Multi Indicator)                    │
│     - Admin 选择指标组合和权重                         │
│     - strategy_type = 'multi_indicator'               │
│     - params = {"indicators": [...], "weights": {...}}│
│                                                       │
│  ③ Custom Script (完全自定义)                         │
│     - Admin 在代码编辑器中写 Python                    │
│     - strategy_type = 'custom_script'                 │
│     - script_content = "def analyze(df, params):..."  │
│     - 保存前自动语法检查 + 试运行                      │
│     - 回测可用于验证脚本策略                           │
│                                                       │
└───────────────────────────────────────────────────────┘
```

### 6.2 策略管理流程

```
Admin 操作流程:
  1. 进入策略管理页面 → 查看已有策略列表
  2. 点击「新建策略」→ 选择类型 (预设/自定义)
  3. [预设] 填写名称、选择标的、设置参数 → 保存
     [自定义] 填写名称、选择标的、编写 Python 脚本 →「验证脚本」→「试运行」→ 保存
  4. 策略列表 → 点击「回测」→ 设置日期范围/资金 → 查看回测结果 → 决定是否启用
  
系统自动流程:
  1. 美东 16:30 APScheduler 触发 sync_daily_prices
  2. 同步完成后触发 scan_signals
  3. 遍历所有 active 的 analysis_configs → 生成信号
  4. 新信号触发 AI 分析 → 存入 ai_analysis_results
  5. 新信号触发提醒匹配 → 发送邮件
```

### 6.3 信号去重逻辑

```python
# 同一 (stock_id, config_id, signal_type) 在 20 个交易日内不重复生成
async def _is_duplicate(self, db, stock_id, config_id, signal_type, date):
    cutoff = date - timedelta(days=20)
    existing = await db.execute(
        select(AnalysisSignal).where(
            AnalysisSignal.stock_id == stock_id,
            AnalysisSignal.config_id == config_id,
            AnalysisSignal.signal_type == signal_type,
            AnalysisSignal.triggered_date >= cutoff,
            AnalysisSignal.is_active == True,
        )
    )
    return existing.scalar_one_or_none() is not None
```

---

## 7. 定时任务 (APScheduler)

### 7.1 任务定义

| Job | 触发时间 | 功能 |
|---|---|---|
| `sync_daily_prices` | 美东 16:30 (Mon-Fri) | 拉取所有 active stocks 的最近交易日日线 |
| `scan_signals` | sync_daily_prices 完成后 | 扫描所有 active strategies 生成信号 |
| `generate_ai_analysis` | scan_signals 完成后 | 为所有新信号生成 AI 分析 |
| `dispatch_alerts` | generate_ai_analysis 完成后 | 为新信号匹配提醒规则并发送邮件 |

### 7.2 实现代码骨架

```python
# scheduler/jobs.py
from apscheduler.schedulers.asyncio import AsyncIOScheduler

scheduler = AsyncIOScheduler(timezone="America/New_York")

async def sync_daily_prices():
    """同步日线数据"""
    async for db in get_db():
        data_service = DataService(db)
        for stock in await data_service.get_active_stocks():
            await data_service.sync_latest(stock.symbol)

async def scan_signals():
    """扫描所有活跃策略"""
    async for db in get_db():
        engine = SignalEngine(db)
        new_signals = await engine.scan_all_active()
        if new_signals:
            await redis_client.lpush("new_signals", *[s.id for s in new_signals])

async def generate_ai_analysis():
    """为未分析的新信号生成 AI 分析"""
    async for db in get_db():
        ai_service = AIAnalysisService()
        for sid in await redis_client.lrange("new_signals", 0, -1):
            await ai_service.analyze_and_store(db, int(sid))

async def dispatch_alerts():
    """为新信号发送提醒"""
    async for db in get_db():
        alert_service = AlertService()
        for sid in await redis_client.lrange("new_signals", 0, -1):
            await alert_service.match_and_send(db, int(sid))
        await redis_client.delete("new_signals")
```

---

## 8. 回测系统详细设计 (★ 新增)

### 8.1 回测在 Phase 1 中的定位

回测是 Phase 1 策略开发闭环的关键环节：

```
策略创建/编辑 → 回测验证 → 评估效果 → 决定是否启用 → 定时生成信号
     ↑                                                    │
     └────────────── 根据回测结果调整参数 ←────────────────┘
```

**Phase 1 回测特点**:
- 同步执行 (向量化回测通常 < 5 秒，无需异步队列)
- 针对单个策略 + 单个标的
- 存储完整结果 (metrics + 曲线数据)，方便后续查看对比
- Admin 从策略管理页触发，结果同页展示

### 8.2 回测流程

```
Admin 触发回测:
  1. 在策略详情/列表页点击「回测」
  2. 设置: 日期范围 (默认 最近 3 年)、初始资金 (默认 $100,000)
  3. 提交 POST /backtest/run
  4. 后端:
     a. 从 stock_prices_daily 加载历史 OHLCV
     b. 根据 strategy_type 生成信号数组 (复用 SignalEngine 逻辑)
     c. vectorbt Portfolio.from_signals 模拟交易
     d. 计算 10 项核心指标
     e. 生成权益曲线 + 回撤曲线 + 月度收益
     f. 计算 SPY buy-and-hold 同期收益作基准对比
     g. 写入 backtest_results → 返回结果
  5. 前端展示:
     ┌─ 指标卡片 (6 个: 收益率/年化/回撤/Sharpe/胜率/盈亏比) ─┐
     ├─ 权益曲线图 (与 SPY 基准叠加) ─────────────────────────┤
     ├─ 回撤曲线图 ──────────────────────────────────────────┤
     └─ 月度收益热力图 ───────────────────────────────────────┘
```

### 8.3 信号生成与回测的关系

回测和实时信号扫描**共用同一套信号生成逻辑**，确保回测结果与实际信号一致：

```python
class BacktestService:
    def _generate_signals(self, df: pd.DataFrame, config: AnalysisConfig) -> pd.Series:
        """与 SignalEngine 完全一致的信号生成"""
        if config.strategy_type == "ma_cross":
            return self._ma_cross_signals(df, config.params)
        elif config.strategy_type == "multi_indicator":
            return self._multi_indicator_signals(df, config.params)
        elif config.strategy_type == "custom_script":
            return self._execute_custom_script(df, config.script_content, config.script_params)
```

### 8.4 vectorbt 回测核心代码

```python
import vectorbt as vbt
import pandas as pd
import numpy as np

def run_vectorbt_backtest(
    df: pd.DataFrame,          # OHLCV with DatetimeIndex
    signals: pd.Series,        # 1=buy, -1=sell, 0=hold, same index
    initial_capital: float,
    slippage: float,
    commission: float,
) -> dict:
    """执行 vectorbt 回测，返回 metrics + curves"""
    
    # 将信号转为 entries/exits
    entries = (signals == 1)
    exits = (signals == -1)
    
    # 矢量化回测
    portfolio = vbt.Portfolio.from_signals(
        close=df['close'],
        entries=entries,
        exits=exits,
        size=np.inf,                    # all-in
        size_type='percent',
        init_cash=initial_capital,
        slippage=slippage,
        fees=commission,
        freq='D',
    )
    
    # 计算指标
    metrics = {
        "total_return": float(portfolio.total_return()),
        "cagr": float(_calc_cagr(portfolio)),
        "max_drawdown": float(portfolio.max_drawdown()),
        "sharpe_ratio": float(portfolio.sharpe_ratio()),
        "sortino_ratio": float(portfolio.sortino_ratio()),
        "calmar_ratio": float(portfolio.calmar_ratio()),
        "win_rate": float(portfolio.trades.win_rate()),
        "profit_factor": float(portfolio.trades.profit_factor()),
        "num_trades": int(portfolio.trades.count()),
    }
    
    # 权益曲线
    equity = portfolio.value()
    equity_curve = [
        {"date": d.strftime("%Y-%m-%d"), "equity": round(float(v), 2)}
        for d, v in equity.items()
    ]
    
    # 回撤曲线
    dd = portfolio.drawdown()
    drawdown_curve = [
        {"date": d.strftime("%Y-%m-%d"), "drawdown_pct": round(float(v) * 100, 2)}
        for d, v in dd.items()
    ]
    
    return {"metrics": metrics, "equity_curve": equity_curve, "drawdown_curve": drawdown_curve}
```

### 8.5 回测结果缓存

同一 (config_id, stock_id, start_date, end_date, capital) 的回测结果应缓存避免重复计算：

```python
# Redis key pattern
backtest_cache_key = f"backtest:{config_id}:{stock_id}:{start_date}:{end_date}:{capital}"
# TTL: 7 days (策略变化概率低)
```

---

## 9. AI 分析集成

### 9.1 模型选择

Phase 1 仅使用 **DeepSeek V4-Flash**：
- API endpoint: `https://api.deepseek.com/v1/chat/completions`
- 兼容 OpenAI SDK，设置 `base_url` + `api_key` 即可
- 成本: ~$0.00043/次分析
- 每月 1000 次分析 ≈ $0.43

### 9.2 分析流程

```
信号生成
  → AIAnalysisService.analyze_and_store(signal_id)
    → 查询 stock + signal + 最近 60 天价格数据
    → 构建 Prompt
    → 调用 DeepSeek API (OpenAI-compatible)
    → 解析 JSON 响应
    → 安全验证 (7 项检查: 价格不为幻觉、免责声明存在、置信度合理等)
    → 存入 ai_analysis_results
    → 若失败 → 降级到规则模板
```

### 9.3 规则模板降级 (LLM 不可用时)

```python
TEMPLATES = {
    "buy": {
        "summary_template": "{symbol} 于 {date} 触发买入信号 ({signal_subtype})。当前价格 ${price}。",
        "why_buy": [
            "策略 {strategy_name} 发出买入信号",
            "信号强度: {strength}",
            "触发价格: ${price}"
        ],
        "risks": [
            "市场整体趋势可能逆转",
            "信号可能为假突破",
            "建议结合基本面分析"
        ],
        "stop_loss": "建议止损位设在近期低点下方 3-5%"
    },
    "sell": { /* ... 类似 */ }
}
```

### 9.4 K 线 API 返回的 AI 分析数据

```json
// GET /api/v1/stocks/SPY/kline?period=day&limit=200
{
  "symbol": "SPY",
  "period": "day",
  "data": [{
    "time": "2026-06-09",
    "open": 525.1, "high": 528.5, "low": 524.2, "close": 527.8,
    "volume": 65000000,
    "ma20": 521.45, "ma60": 515.30,
    "signal": {
      "id": 142, "type": "buy", "subtype": "golden_cross",
      "strength": "strong", "price": 527.8,
      "ai_summary": "SPY 于 6月9日触发强金叉信号。MA20上穿MA60且成交量放大..."
    }
  }]
}
```

---

## 10. 邮件提醒系统

### 10.1 流程

```
Signal 生成 (analysis_signals 写入)
  → AlertService.match_and_send(signal_id)
    → 查询该 stock 的所有活跃 alert_rules
    → 检查 alert_type 是否匹配信号类型
    → 对每个匹配的 user:
        → 构建邮件内容 (信号信息 + AI 分析摘要)
        → EmailService.send(to=user.email, subject, html)
        → 写入 alert_logs
```

### 10.2 邮件模板

```
主题: [Trend-Scope] {symbol} 买入信号提醒 — {date}

正文:
📈 {symbol} ({name}) 买入信号

信号类型: {signal_subtype_cn}
信号强度: {strength}
触发价格: ${price}

📊 AI 分析摘要:
{ai_summary}

⚠️ 风险提示:
{risks}

🛑 建议止损:
{stop_loss}

---
此邮件由 Trend-Scope 自动发送。
```

### 10.3 Resend 集成

```python
# services/email_service.py
import resend

class EmailService:
    def __init__(self):
        resend.api_key = settings.RESEND_API_KEY
    
    async def send_signal_alert(
        self, to_email: str, symbol: str, signal: AnalysisSignal, 
        ai_analysis: dict | None
    ) -> str:
        params = {
            "from": "Trend-Scope <alerts@trend-scope.com>",
            "to": [to_email],
            "subject": f"[Trend-Scope] {symbol} {'买入' if signal.signal_type == 'buy' else '卖出'}信号 — {signal.triggered_date}",
            "html": self._build_email_html(symbol, signal, ai_analysis),
        }
        response = resend.Emails.send(params)
        return response["id"]
```

---

## 11. 管理端前端 (Next.js)

### 11.1 页面路由

```
/admin/
├── login/                    # 登录页
├── dashboard/                # 首页 Dashboard
│   └── page.tsx             # 用户数、标的数、策略数、今日信号数、最近信号
├── stocks/                   # 标的管理
│   ├── page.tsx             # 标的列表
│   ├── create/page.tsx      # 添加标的
│   └── [id]/page.tsx        # 标的详情 (K 线图 + 最近信号)
├── strategies/               # 策略管理
│   ├── page.tsx             # 策略列表 (含「回测」按钮)
│   ├── create/page.tsx      # 新建策略 (预设 or 自定义脚本)
│   └── [id]/page.tsx        # 策略详情/编辑 + 回测面板 + 历史信号
├── backtest/                 # ★ 回测记录
│   └── page.tsx             # 全部回测历史 (按策略/标的筛选，查看详情)
├── signals/                  # 信号管理
│   └── page.tsx             # 全部信号列表 + AI 分析查看
└── alerts/                   # 提醒管理
    └── page.tsx             # 全部提醒日志
```

### 11.2 关键页面设计

#### 11.2.1 策略详情页 — 含回测面板 (strategies/[id]/page.tsx)

```
┌──────────────────────────────────────────────────────────────────┐
│  策略: MA20x60 金叉 — SPY                       [启用] [编辑] [返回]│
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  [策略信息]  [历史信号]  [★ 回测]                                 │
│                                                                  │
│  ┌─ 回测参数 ─────────────────────────────────────────────────┐  │
│  │  起始日期: [2023-01-01]  结束日期: [2026-06-09]             │  │
│  │  初始资金: [$100,000]     滑点: [0.05%]  手续费: [0.1%]    │  │
│  │  [开始回测]  [使用默认参数]                                │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─ 回测结果 ─────────────────────────────────────────────────┐  │
│  │  ┌──────────┬──────────┬──────────┬──────────┐             │  │
│  │  │ 总收益    │ 年化(CAGR)│ 最大回撤  │ Sharpe   │             │  │
│  │  │ +35.21%  │ +9.14%   │ -18.32%  │ 1.12     │             │  │
│  │  ├──────────┼──────────┼──────────┼──────────┤             │  │
│  │  │ 胜率      │ 盈亏比    │ 交易次数  │ 基准(SPY) │             │  │
│  │  │ 45.2%    │ 1.62     │ 42       │ +28.15%  │             │  │
│  │  └──────────┴──────────┴──────────┴──────────┘             │  │
│  │                                                             │  │
│  │  ┌─ 权益曲线 ──────────────────────────────────────────┐   │  │
│  │  │  📈 策略权益 (蓝) vs SPY 基准 (灰)                   │   │  │
│  │  │  120k│      ╱╲                                      │   │  │
│  │  │  115k│     ╱  ╲    ╱╲                               │   │  │
│  │  │  110k│    ╱    ╲  ╱  ╲                              │   │  │
│  │  │  105k│   ╱      ╲╱    ╲                             │   │  │
│  │  │  100k│──╱              ╲──                          │   │  │
│  │  └──────────────────────────────────────────────────────┘   │  │
│  │                                                             │  │
│  │  ┌─ 回撤曲线 ──────────────────────────────────────────┐   │  │
│  │  │  0%│         ╱╲                                     │   │  │
│  │  │ -5%│        ╱  ╲                                    │   │  │
│  │  │-10%│    ╱──╱    ╲                                   │   │  │
│  │  │-15%│───╱          ╲──                               │   │  │
│  │  │-20%│                ╲                               │   │  │
│  │  └──────────────────────────────────────────────────────┘   │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### 11.3 前端技术要点

- **K线图组件**: `dynamic(() => import('./KlineChartInner'), { ssr: false })`
- **权益/回撤曲线**: TradingView Lightweight Charts `LineSeries` 复用 K 线图表库
- **代码编辑器**: Monaco Editor (`@monaco-editor/react`) 用于自定义脚本输入
- **状态管理**: React Query (TanStack Query)
- **UI 框架**: Ant Design 5.x (Table, Form, Select, Button, Modal, Tabs, Card, Tag, Statistic)

---

## 12. 数据流 / 时序图

### 12.1 每日信号生成周期

```
时间线 (美东):
─────────────────────────────────────────────────────────────────

16:00  市场收盘

16:30  APScheduler 触发 sync_daily_prices
       ├── DataService: yfinance.download() for each active stock
       ├── 去重写入 stock_prices_daily
       └── 完成

16:30+  APScheduler 触发 scan_signals
       ├── SignalEngine: 加载所有 active analysis_configs
       ├── 对每个 config → 执行策略 → 检测信号 → 写入 analysis_signals
       ├── 新信号 ID → Redis "new_signals" queue
       └── 完成

16:35+  APScheduler 触发 generate_ai_analysis
       ├── 从 Redis 读取 new_signals → DeepSeek API → 写入 ai_analysis_results
       └── 完成

16:35+  APScheduler 触发 dispatch_alerts
       ├── 匹配 alert_rules → EmailService → Resend → 写入 alert_logs
       └── 清理 Redis "new_signals"
```

### 12.2 Admin 回测流程

```
Admin UI                          Backend API                       Database
    │                                 │                                │
    │  POST /backtest/run             │                                │
    │  {config_id, stock_id, dates}   │                                │
    │ ───────────────────────────────▶│                                │
    │                                 │  BacktestService.run()         │
    │                                 │  ├─ 加载历史 OHLCV             │────────▶
    │                                 │  ├─ 生成信号数组               │
    │                                 │  ├─ vectorbt Portfolio 模拟    │
    │                                 │  ├─ 计算 10 项指标             │
    │                                 │  ├─ 生成曲线数据               │
    │                                 │  └─ INSERT backtest_results    │────────▶
    │                                 │                                │  (写入)
    │  返回: {id, metrics, curves}    │                                │
    │ ◀───────────────────────────────│                                │
    │                                 │                                │
    │  前端渲染指标卡片 + 权益曲线图   │                                │
```

---

## 13. 开发任务概览 (Task Breakdown)

### T1: 项目初始化与基础设施 (2-3 天)

- [ ] T1.1: 创建项目目录结构 (`backend/`, `admin/`)
- [ ] T1.2: Docker Compose 配置 (MySQL + Redis + backend + admin)
- [ ] T1.3: `.env.example` + 环境变量配置
- [ ] T1.4: `backend/requirements.txt` + 虚拟环境
- [ ] T1.5: FastAPI app 骨架 (`main.py`, 基础 middleware)
- [ ] T1.6: `admin/` Next.js 项目初始化 (`create-next-app`, Ant Design, Tailwind)

### T2: 数据库层 (2-3 天)

- [ ] T2.1: SQLAlchemy Base + TimestampMixin
- [ ] T2.2: ORM 模型: `user.py`, `stock.py`, `analysis.py`, `backtest.py`, `ai_analysis.py`, `alert.py`
- [ ] T2.3: Alembic 初始化 + 首次迁移 (创建全部 13 张表) ★
- [ ] T2.4: 种子数据: admin 用户 + 10 只主流 ETF

### T3: 认证系统 (2-3 天)

- [ ] T3.1: JWT 工具函数 (`core/security.py`)
- [ ] T3.2: 依赖注入 (`core/deps.py`)
- [ ] T3.3: Auth API (register/login/refresh)
- [ ] T3.4: User API (GET/PATCH /users/me)
- [ ] T3.5: Pydantic schemas + 异常处理
- [ ] T3.6: pytest: auth 全流程测试

### T4: 数据层 — 股票与 K 线 (2-3 天)

- [ ] T4.1: `DataService`: yfinance fetch_historical + sync_latest + get_kline
- [ ] T4.2: Stock API: GET /stocks, /stocks/{id}, /stocks/{id}/kline
- [ ] T4.3: Admin Stock API: CRUD
- [ ] T4.4: Pydantic schemas: stock.py
- [ ] T4.5: pytest: 数据同步 + K 线查询

### T5: 策略系统 (3-4 天)

- [ ] T5.1: `SignalEngine`: _run_ma_cross, _run_multi_indicator, 去重/确认
- [ ] T5.2: `ScriptExecutor`: AST 校验, import 白名单, RestrictedPython 沙箱, 超时
- [ ] T5.3: Strategy API: CRUD + validate + test-run
- [ ] T5.4: Signal API: 最近信号 + 全部信号
- [ ] T5.5: Pydantic schemas: analysis.py
- [ ] T5.6: pytest: 3 种策略类型测试

### T6: 定时任务 (1-2 天)

- [ ] T6.1: APScheduler 初始化 + FastAPI lifespan 集成
- [ ] T6.2: `sync_daily_prices` + `scan_signals` jobs
- [ ] T6.3: Redis 队列 (new_signals)
- [ ] T6.4: APScheduler 管理 API

### T7: 回测系统 ★ (2-3 天)

- [ ] T7.1: `BacktestService`: vectorbt 回测执行
  - 信号生成 (复用 SignalEngine 逻辑)
  - Portfolio 模拟 (entries/exits)
  - 10 项指标计算
  - 权益曲线/回撤曲线/月度收益生成
  - SPY 基准对比
- [ ] T7.2: 回测缓存 (Redis: 相同参数 7 天内不重复计算)
- [ ] T7.3: Backtest API:
  - `POST /backtest/run` — 执行回测
  - `GET /backtest/{id}` — 查询结果
  - `GET /backtest/history?config_id={id}` — 历史记录
  - `GET /admin/backtests` — 全部记录
- [ ] T7.4: Pydantic schemas: `backtest.py`
- [ ] T7.5: 前端回测面板: 参数表单 + 指标卡片 + 权益曲线图 + 回撤曲线图
- [ ] T7.6: pytest: 回测指标计算正确性验证 (与已知值对比)

### T8: AI 分析 (2-3 天)

- [ ] T8.1: `AIAnalysisService`: DeepSeek client + Prompt 构建 + 7 项安全验证 + 降级模板
- [ ] T8.2: `generate_ai_analysis` APScheduler job
- [ ] T8.3: AI Analysis API: GET + regenerate
- [ ] T8.4: Pydantic schemas + pytest

### T9: 提醒系统 (2-3 天)

- [ ] T9.1: `EmailService`: Resend SDK 封装
- [ ] T9.2: `AlertService`: 规则匹配 + 邮件发送 + HTML 模板
- [ ] T9.3: `dispatch_alerts` APScheduler job
- [ ] T9.4: Alert API: CRUD + 日志查看
- [ ] T9.5: Pydantic schemas + pytest

### T10: 管理端前端 (4-5 天)

- [ ] T10.1: 项目布局 (layout, Sidebar, Header, AuthGuard)
- [ ] T10.2: 登录页
- [ ] T10.3: Dashboard
- [ ] T10.4: 标的管理 (列表 + 创建 + 详情含K线)
- [ ] T10.5: 策略管理 (列表 + 创建 + 详情)
  - 预设策略表单
  - Monaco Editor 自定义脚本编辑器 + 验证/试运行
- [ ] T10.6: 回测面板 ★ (在策略详情页内嵌)
  - 参数表单 → 调用 API → 指标卡片 (AntD Statistic) + 权益/回撤曲线图 (LWC LineSeries)
- [ ] T10.7: 回测历史页 ★ (全部记录，按策略/标的筛选)
- [ ] T10.8: 信号查看 (列表 + AI 分析弹窗)
- [ ] T10.9: 提醒日志
- [ ] T10.10: API 客户端封装 (`lib/api.ts`, `lib/auth.ts`)
- [ ] T10.11: K 线图表组件 (TradingView LWC: OHLC + MA + 信号标记 + 成交量 + 周期切换)

### T11: 集成测试与文档 (2-3 天)

- [ ] T11.1: 端到端测试 (pytest: 数据同步 → 信号生成 → AI分析 → 提醒发送 → 回测执行)
- [ ] T11.2: 前端集成测试 (Playwright: 登录 → 创建策略 → 回测 → 查看信号)
- [ ] T11.3: 性能测试 (K 线 200 条 < 200ms, 回测 3Y 数据 < 5s)
- [ ] T11.4: README.md 更新
- [ ] T11.5: API 文档确认 (FastAPI /docs)

---

## 14. Phase 1 关键决策记录

| 决策 | 选择 | 理由 |
|---|---|---|
| 数据源 | yfinance (仅 EOD) | Phase 1 不需要实时，yfinance 足够 |
| 定时任务 | APScheduler | 轻量，无需额外中间件 |
| 回测引擎 | vectorbt | 矢量化快速 (< 500ms)，NumPy/Numba 加速，10k+ 参数组合 |
| 回测执行 | 同步 (FastAPI 直接执行) | 3Y 数据 < 5s，无需异步队列；Phase 2 迁 ARQ |
| 策略+回测信号 | 复用同一套 SignalEngine | 确保回测结果与实际信号一致 |
| AI 模型 | DeepSeek V4-Flash | 最便宜 ($0.00043/次)，OpenAI-compatible，中文优秀 |
| 脚本沙箱 | RestrictedPython | Python 沙箱，比 Docker 更轻量 |
| 前端图表 | TradingView LWC 5.2 | Apache 2.0 免费商用，K线+曲线统一库 |
| 邮件 | Resend | 免费 100 封/天 (dev)，API 简洁 |
| 信号去重 | 20 交易日窗口 | 避免同一交叉反复触发 |

---

## 15. 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|---|---|---|---|
| yfinance 不稳定被限流 | 中 | 数据缺失 | 增量同步+重试+缓存，Phase 2 加 Finnhub |
| 自定义脚本安全漏洞 | 中 | 服务器风险 | RestrictedPython + 白名单 + 超时 + 仅 Admin |
| vectorbt 内存溢出 (大数据) | 低 | 回测失败 | 日期范围限制 (最多 10 年)，数据采样 |
| DeepSeek API 不可用 | 低 | AI 分析缺失 | 降级到规则模板 |
| Resend 邮件进垃圾箱 | 中 | 用户收不到 | SPF/DKIM/DMARC 配置 |
| K 线大数据量性能 | 低 | 前端卡顿 | 后端预计算，前端分页加载 |
| 回测结果与实际信号不一致 | 低 | Admin 信任度下降 | 共用 SignalEngine 逻辑，单元测试验证一致性 |

---

> **下一步**: 基于本文档生成详细的 Phase 1 Task 清单 (`phase-1-tasks.md`)，每个 Task 带验收标准、预估工时、依赖关系。
