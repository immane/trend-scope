# Task 02: Phase 1 Database — ORM Models, Alembic Migrations & Seed Data

> **Status**: Ready for Implementation
> **Estimated Time**: 2-3 days
> **Depends On**: [Task 01 — 项目初始化](01-phase-1-project-init.md)
> **Required By**: [Task 03 — 认证系统](03-phase-1-auth.md), [Task 04 — 股票数据](04-phase-1-stock-data.md)
> **参考设计文档**:
> - [001-preliminary-design.md](../design/001-preliminary-design.md) — 总体架构
> - [phase-1.md](../design/phase-1.md) — Phase 1 MVP 详细设计
> - [002-database-schema.md](../design/002-database-schema.md) — 完整DDL

---

## 1. Objective

Create all 10 SQLAlchemy ORM models covering the 10 Phase 1 tables, initialize Alembic and generate the first migration, implement the `get_db` async generator, and create seed data (admin user + 10 ETFs).

---

## 2. Complete Table DDL (for Reference)

### 2.1 `users`

| Column | Type | Constraints |
|---|---|---|
| `id` | BIGINT | PK, AUTO_INCREMENT |
| `email` | VARCHAR(255) | UNIQUE, NOT NULL |
| `password_hash` | VARCHAR(255) | NOT NULL |
| `nickname` | VARCHAR(100) | NULL |
| `avatar_url` | VARCHAR(500) | NULL |
| `role` | ENUM('admin','user') | NOT NULL, DEFAULT 'user' |
| `status` | ENUM('active','inactive','banned') | NOT NULL, DEFAULT 'active' |
| `last_login_at` | DATETIME | NULL |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP |

### 2.2 `user_sessions`

| Column | Type | Constraints |
|---|---|---|
| `id` | BIGINT | PK, AUTO_INCREMENT |
| `user_id` | BIGINT | FK → users(id), NOT NULL |
| `refresh_token` | VARCHAR(500) | NOT NULL |
| `device_info` | VARCHAR(255) | NULL |
| `ip_address` | VARCHAR(45) | NULL |
| `expires_at` | DATETIME | NOT NULL |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP |

### 2.3 `stocks`

| Column | Type | Constraints |
|---|---|---|
| `id` | BIGINT | PK, AUTO_INCREMENT |
| `symbol` | VARCHAR(20) | UNIQUE, NOT NULL |
| `name` | VARCHAR(200) | NOT NULL |
| `type` | ENUM('ETF','Stock','Index') | NOT NULL |
| `market` | ENUM('US') | NOT NULL, DEFAULT 'US' |
| `sector` | VARCHAR(100) | NULL |
| `is_active` | BOOLEAN | DEFAULT TRUE |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP |

### 2.4 `stock_prices_daily`

| Column | Type | Constraints |
|---|---|---|
| `id` | BIGINT | PK, AUTO_INCREMENT |
| `stock_id` | BIGINT | FK → stocks(id), NOT NULL |
| `trade_date` | DATE | NOT NULL |
| `open` | DECIMAL(12,4) | NOT NULL |
| `high` | DECIMAL(12,4) | NOT NULL |
| `low` | DECIMAL(12,4) | NOT NULL |
| `close` | DECIMAL(12,4) | NOT NULL |
| `volume` | BIGINT | NOT NULL |
| `data_source` | VARCHAR(50) | DEFAULT 'yfinance' |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP |

UNIQUE KEY: `(stock_id, trade_date)`

### 2.5 `analysis_configs`

| Column | Type | Constraints |
|---|---|---|
| `id` | BIGINT | PK, AUTO_INCREMENT |
| `stock_id` | BIGINT | FK → stocks(id), NULL (NULL = global strategy) |
| `name` | VARCHAR(100) | NOT NULL |
| `description` | TEXT | NULL |
| `strategy_type` | ENUM('ma_cross','multi_indicator','custom_script') | NOT NULL |
| `params` | JSON | NOT NULL, DEFAULT '{}' |
| `script_content` | TEXT | NULL |
| `script_params` | JSON | NULL, DEFAULT '{}' |
| `confirm_bars` | INT | DEFAULT 0 |
| `volume_confirm` | BOOLEAN | DEFAULT FALSE |
| `is_active` | BOOLEAN | DEFAULT TRUE |
| `created_by` | BIGINT | FK → users(id), NOT NULL |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP |

### 2.6 `analysis_signals`

| Column | Type | Constraints |
|---|---|---|
| `id` | BIGINT | PK, AUTO_INCREMENT |
| `stock_id` | BIGINT | FK → stocks(id), NOT NULL |
| `config_id` | BIGINT | FK → analysis_configs(id), NOT NULL |
| `signal_type` | ENUM('buy','sell') | NOT NULL |
| `signal_subtype` | VARCHAR(50) | NULL |
| `strength` | ENUM('weak','normal','strong') | DEFAULT 'normal' |
| `confidence` | DECIMAL(4,3) | NULL |
| `trigger_price` | DECIMAL(12,4) | NOT NULL |
| `trigger_details` | JSON | NOT NULL, DEFAULT '{}' |
| `triggered_date` | DATE | NOT NULL |
| `is_active` | BOOLEAN | DEFAULT TRUE |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP |

### 2.7 `backtest_results`

| Column | Type | Constraints |
|---|---|---|
| `id` | BIGINT | PK, AUTO_INCREMENT |
| `user_id` | BIGINT | FK → users(id), NOT NULL |
| `stock_id` | BIGINT | FK → stocks(id), NOT NULL |
| `config_id` | BIGINT | FK → analysis_configs(id), NOT NULL |
| `status` | ENUM('running','completed','failed') | DEFAULT 'running' |
| `start_date` | DATE | NOT NULL |
| `end_date` | DATE | NOT NULL |
| `initial_capital` | DECIMAL(14,2) | DEFAULT 100000.00 |
| `slippage_pct` | DECIMAL(6,4) | DEFAULT 0.0005 |
| `commission_pct` | DECIMAL(6,4) | DEFAULT 0.0010 |
| `total_return` | DECIMAL(8,4) | NULL |
| `cagr` | DECIMAL(8,4) | NULL |
| `max_drawdown` | DECIMAL(8,4) | NULL |
| `sharpe_ratio` | DECIMAL(8,4) | NULL |
| `sortino_ratio` | DECIMAL(8,4) | NULL |
| `calmar_ratio` | DECIMAL(8,4) | NULL |
| `win_rate` | DECIMAL(8,4) | NULL |
| `profit_factor` | DECIMAL(8,4) | NULL |
| `num_trades` | INT | NULL |
| `benchmark_return` | DECIMAL(8,4) | NULL |
| `equity_curve` | JSON | NULL |
| `drawdown_curve` | JSON | NULL |
| `monthly_returns` | JSON | NULL |
| `trade_log` | JSON | NULL |
| `execution_time_ms` | INT | NULL |
| `error_message` | TEXT | NULL |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP |

### 2.8 `ai_analysis_results`

| Column | Type | Constraints |
|---|---|---|
| `id` | BIGINT | PK, AUTO_INCREMENT |
| `signal_id` | BIGINT | FK → analysis_signals(id) ON DELETE CASCADE, UNIQUE |
| `model_provider` | VARCHAR(50) | DEFAULT 'deepseek' |
| `model_name` | VARCHAR(100) | DEFAULT 'deepseek-chat' |
| `prompt_tokens` | INT | DEFAULT 0 |
| `completion_tokens` | INT | DEFAULT 0 |
| `total_cost` | DECIMAL(10,6) | DEFAULT 0.000000 |
| `analysis_json` | JSON | NOT NULL |
| `generated_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP |

### 2.9 `alert_rules`

| Column | Type | Constraints |
|---|---|---|
| `id` | BIGINT | PK, AUTO_INCREMENT |
| `user_id` | BIGINT | FK → users(id), NOT NULL |
| `stock_id` | BIGINT | FK → stocks(id), NOT NULL |
| `alert_type` | ENUM('any_signal','buy_signal','sell_signal') | DEFAULT 'any_signal' |
| `is_active` | BOOLEAN | DEFAULT TRUE |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP |

UNIQUE KEY: `(user_id, stock_id, alert_type)`

### 2.10 `alert_logs`

| Column | Type | Constraints |
|---|---|---|
| `id` | BIGINT | PK, AUTO_INCREMENT |
| `alert_rule_id` | BIGINT | FK → alert_rules(id), NULL |
| `user_id` | BIGINT | FK → users(id), NOT NULL |
| `stock_id` | BIGINT | FK → stocks(id), NOT NULL |
| `signal_id` | BIGINT | FK → analysis_signals(id), NULL |
| `channel` | ENUM('email') | DEFAULT 'email' |
| `title` | VARCHAR(200) | NOT NULL |
| `message` | TEXT | NOT NULL |
| `status` | ENUM('sent','failed') | DEFAULT 'sent' |
| `provider_message_id` | VARCHAR(255) | NULL |
| `sent_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP |

---

## 3. Files to Create

### 3.1 `backend/app/models/base.py`

```python
from datetime import datetime
from sqlalchemy import DateTime, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=func.now(), onupdate=func.now(), nullable=False
    )
```

### 3.2 `backend/app/models/user.py`

```python
from datetime import datetime
from typing import List, Optional
from sqlalchemy import BigInteger, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    nickname: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    avatar_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    role: Mapped[str] = mapped_column(
        Enum("admin", "user", name="user_role"), nullable=False, default="user"
    )
    status: Mapped[str] = mapped_column(
        Enum("active", "inactive", "banned", name="user_status"),
        nullable=False,
        default="active",
    )
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    sessions: Mapped[List["UserSession"]] = relationship(
        "UserSession", back_populates="user", cascade="all, delete-orphan"
    )
    alert_rules: Mapped[List["AlertRule"]] = relationship(
        "AlertRule", back_populates="user", cascade="all, delete-orphan"
    )
    backtest_results: Mapped[List["BacktestResult"]] = relationship(
        "BacktestResult", back_populates="user"
    )
    analysis_configs: Mapped[List["AnalysisConfig"]] = relationship(
        "AnalysisConfig", back_populates="creator", foreign_keys="AnalysisConfig.created_by"
    )


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)
    refresh_token: Mapped[str] = mapped_column(String(500), nullable=False)
    device_info: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    ip_address: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), nullable=False)

    user: Mapped["User"] = relationship("User", back_populates="sessions")
```

### 3.3 `backend/app/models/stock.py`

```python
from typing import List, Optional
from sqlalchemy import BigInteger, Boolean, Date, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Stock(Base):
    __tablename__ = "stocks"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(String(20), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    type: Mapped[str] = mapped_column(
        Enum("ETF", "Stock", "Index", name="stock_type"), nullable=False
    )
    market: Mapped[str] = mapped_column(
        Enum("US", name="stock_market"), nullable=False, default="US"
    )
    sector: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=func.now(), onupdate=func.now(), nullable=False
    )

    prices: Mapped[List["StockPriceDaily"]] = relationship(
        "StockPriceDaily", back_populates="stock", cascade="all, delete-orphan"
    )
    signals: Mapped[List["AnalysisSignal"]] = relationship(
        "AnalysisSignal", back_populates="stock"
    )
    configs: Mapped[List["AnalysisConfig"]] = relationship(
        "AnalysisConfig", back_populates="stock", foreign_keys="AnalysisConfig.stock_id"
    )
    alert_rules: Mapped[List["AlertRule"]] = relationship(
        "AlertRule", back_populates="stock"
    )
    backtest_results: Mapped[List["BacktestResult"]] = relationship(
        "BacktestResult", back_populates="stock"
    )


class StockPriceDaily(Base):
    __tablename__ = "stock_prices_daily"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    stock_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("stocks.id"), nullable=False)
    trade_date: Mapped[date] = mapped_column(Date, nullable=False)
    open: Mapped[float] = mapped_column(DECIMAL_PRECISION, nullable=False)
    high: Mapped[float] = mapped_column(DECIMAL_PRECISION, nullable=False)
    low: Mapped[float] = mapped_column(DECIMAL_PRECISION, nullable=False)
    close: Mapped[float] = mapped_column(DECIMAL_PRECISION, nullable=False)
    volume: Mapped[int] = mapped_column(BigInteger, nullable=False)
    data_source: Mapped[str] = mapped_column(String(50), default="yfinance")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), nullable=False)

    stock: Mapped["Stock"] = relationship("Stock", back_populates="prices")
```

**IMPORTANT**: The `DECIMAL_PRECISION` constant is defined as `DECIMAL(12,4)` for price columns. Replace `DECIMAL_PRECISION` with the exact `DECIMAL(12,4)` type. You need to import `DECIMAL` from SQLAlchemy:

```python
from sqlalchemy import DECIMAL
# ...
open: Mapped[float] = mapped_column(DECIMAL(12, 4), nullable=False)
high: Mapped[float] = mapped_column(DECIMAL(12, 4), nullable=False)
low: Mapped[float] = mapped_column(DECIMAL(12, 4), nullable=False)
close: Mapped[float] = mapped_column(DECIMAL(12, 4), nullable=False)
```

### 3.4 `backend/app/models/analysis.py`

```python
from datetime import date, datetime
from typing import List, Optional
from sqlalchemy import (
    BigInteger, Boolean, Date, DateTime, DECIMAL, Enum,
    ForeignKey, Integer, JSON, String, Text, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class AnalysisConfig(Base, TimestampMixin):
    __tablename__ = "analysis_configs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    stock_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("stocks.id"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    strategy_type: Mapped[str] = mapped_column(
        Enum("ma_cross", "multi_indicator", "custom_script", name="strategy_type"),
        nullable=False,
    )
    params: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    script_content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    script_params: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True, default=dict)
    confirm_bars: Mapped[int] = mapped_column(Integer, default=0)
    volume_confirm: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)

    stock: Mapped[Optional["Stock"]] = relationship(
        "Stock", back_populates="configs", foreign_keys=[stock_id]
    )
    creator: Mapped["User"] = relationship("User", back_populates="analysis_configs", foreign_keys=[created_by])
    signals: Mapped[List["AnalysisSignal"]] = relationship(
        "AnalysisSignal", back_populates="config", cascade="all, delete-orphan"
    )
    backtest_results: Mapped[List["BacktestResult"]] = relationship(
        "BacktestResult", back_populates="config"
    )


class AnalysisSignal(Base):
    __tablename__ = "analysis_signals"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    stock_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("stocks.id"), nullable=False)
    config_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("analysis_configs.id"), nullable=False
    )
    signal_type: Mapped[str] = mapped_column(
        Enum("buy", "sell", name="signal_type"), nullable=False
    )
    signal_subtype: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    strength: Mapped[str] = mapped_column(
        Enum("weak", "normal", "strong", name="signal_strength"),
        nullable=False,
        default="normal",
    )
    confidence: Mapped[Optional[float]] = mapped_column(DECIMAL(4, 3), nullable=True)
    trigger_price: Mapped[float] = mapped_column(DECIMAL(12, 4), nullable=False)
    trigger_details: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    triggered_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), nullable=False)

    stock: Mapped["Stock"] = relationship("Stock", back_populates="signals")
    config: Mapped["AnalysisConfig"] = relationship("AnalysisConfig", back_populates="signals")
    ai_analysis: Mapped[Optional["AIAnalysisResult"]] = relationship(
        "AIAnalysisResult", back_populates="signal", uselist=False, cascade="all, delete-orphan"
    )
    alert_logs: Mapped[List["AlertLog"]] = relationship(
        "AlertLog", back_populates="signal"
    )
```

### 3.5 `backend/app/models/backtest.py`

```python
from datetime import date, datetime
from typing import List, Optional
from sqlalchemy import (
    BigInteger, Date, DateTime, DECIMAL, Enum, ForeignKey, Integer, JSON, Text, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class BacktestResult(Base):
    __tablename__ = "backtest_results"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False, index=True)
    stock_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("stocks.id"), nullable=False)
    config_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("analysis_configs.id"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(
        Enum("running", "completed", "failed", name="backtest_status"),
        nullable=False,
        default="running",
    )

    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    initial_capital: Mapped[float] = mapped_column(DECIMAL(14, 2), nullable=False, default=100000.00)
    slippage_pct: Mapped[float] = mapped_column(DECIMAL(6, 4), default=0.0005)
    commission_pct: Mapped[float] = mapped_column(DECIMAL(6, 4), default=0.0010)

    total_return: Mapped[Optional[float]] = mapped_column(DECIMAL(8, 4), nullable=True)
    cagr: Mapped[Optional[float]] = mapped_column(DECIMAL(8, 4), nullable=True)
    max_drawdown: Mapped[Optional[float]] = mapped_column(DECIMAL(8, 4), nullable=True)
    sharpe_ratio: Mapped[Optional[float]] = mapped_column(DECIMAL(8, 4), nullable=True)
    sortino_ratio: Mapped[Optional[float]] = mapped_column(DECIMAL(8, 4), nullable=True)
    calmar_ratio: Mapped[Optional[float]] = mapped_column(DECIMAL(8, 4), nullable=True)
    win_rate: Mapped[Optional[float]] = mapped_column(DECIMAL(8, 4), nullable=True)
    profit_factor: Mapped[Optional[float]] = mapped_column(DECIMAL(8, 4), nullable=True)
    num_trades: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    benchmark_return: Mapped[Optional[float]] = mapped_column(DECIMAL(8, 4), nullable=True)

    equity_curve: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    drawdown_curve: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    monthly_returns: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    trade_log: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    execution_time_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), nullable=False)

    user: Mapped["User"] = relationship("User", back_populates="backtest_results")
    stock: Mapped["Stock"] = relationship("Stock", back_populates="backtest_results")
    config: Mapped["AnalysisConfig"] = relationship("AnalysisConfig", back_populates="backtest_results")
```

### 3.6 `backend/app/models/ai_analysis.py`

```python
from datetime import datetime
from sqlalchemy import BigInteger, DateTime, DECIMAL, ForeignKey, Integer, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class AIAnalysisResult(Base):
    __tablename__ = "ai_analysis_results"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    signal_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("analysis_signals.id", ondelete="CASCADE"),
        nullable=False, unique=True,
    )
    model_provider: Mapped[str] = mapped_column(String(50), nullable=False, default="deepseek")
    model_name: Mapped[str] = mapped_column(String(100), nullable=False, default="deepseek-chat")
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_cost: Mapped[float] = mapped_column(DECIMAL(10, 6), default=0.0)
    analysis_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    generated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), nullable=False)

    signal: Mapped["AnalysisSignal"] = relationship("AnalysisSignal", back_populates="ai_analysis")
```

### 3.7 `backend/app/models/alert.py`

```python
from datetime import datetime
from typing import List, Optional
from sqlalchemy import (
    BigInteger, Boolean, DateTime, Enum, ForeignKey, String, Text, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class AlertRule(Base, TimestampMixin):
    __tablename__ = "alert_rules"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)
    stock_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("stocks.id"), nullable=False)
    alert_type: Mapped[str] = mapped_column(
        Enum("any_signal", "buy_signal", "sell_signal", name="alert_type"),
        nullable=False,
        default="any_signal",
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    user: Mapped["User"] = relationship("User", back_populates="alert_rules")
    stock: Mapped["Stock"] = relationship("Stock", back_populates="alert_rules")
    logs: Mapped[List["AlertLog"]] = relationship(
        "AlertLog", back_populates="alert_rule", cascade="all, delete-orphan"
    )


class AlertLog(Base):
    __tablename__ = "alert_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    alert_rule_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("alert_rules.id"), nullable=True
    )
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)
    stock_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("stocks.id"), nullable=False)
    signal_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("analysis_signals.id"), nullable=True
    )
    channel: Mapped[str] = mapped_column(
        Enum("email", name="alert_channel"), nullable=False, default="email"
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        Enum("sent", "failed", name="alert_status"), nullable=False, default="sent"
    )
    provider_message_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    sent_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), nullable=False)

    alert_rule: Mapped[Optional["AlertRule"]] = relationship("AlertRule", back_populates="logs")
    signal: Mapped[Optional["AnalysisSignal"]] = relationship("AnalysisSignal", back_populates="alert_logs")
```

### 3.8 `backend/app/models/__init__.py`

```python
from app.models.base import Base, TimestampMixin
from app.models.user import User, UserSession
from app.models.stock import Stock, StockPriceDaily
from app.models.analysis import AnalysisConfig, AnalysisSignal
from app.models.backtest import BacktestResult
from app.models.ai_analysis import AIAnalysisResult
from app.models.alert import AlertRule, AlertLog

__all__ = [
    "Base",
    "TimestampMixin",
    "User",
    "UserSession",
    "Stock",
    "StockPriceDaily",
    "AnalysisConfig",
    "AnalysisSignal",
    "BacktestResult",
    "AIAnalysisResult",
    "AlertRule",
    "AlertLog",
]
```

### 3.9 `backend/app/core/deps.py`

```python
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from app.core.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.APP_ENV == "development",
    pool_size=20,
    max_overflow=10,
    pool_recycle=3600,
    pool_pre_ping=True,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
```

### 3.10 Alembic Configuration

#### `backend/alembic.ini`

```ini
[alembic]
script_location = alembic
prepend_sys_path = .
sqlalchemy.url = mysql+asyncmy://trendscope:trendscope123@localhost:3306/trend_scope

[loggers]
keys = root,sqlalchemy,alembic

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARN
handlers = console

[logger_sqlalchemy]
level = WARN
handlers =
qualname = sqlalchemy.engine

[logger_alembic]
level = INFO
handlers =
qualname = alembic

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
datefmt = %H:%M:%S
```

#### `backend/alembic/env.py`

```python
import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context
from app.models import Base
from app.core.config import settings

config = context.config
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

**Steps to initialize Alembic**:
```bash
cd backend
alembic init alembic
# Then overwrite alembic/env.py with the version above
```

### 3.11 `backend/seed_data.py`

```python
"""
Seed script: creates admin user and 10 ETF stocks.
Run after initial migration: python seed_data.py
"""
import asyncio
from passlib.context import CryptContext
from sqlalchemy import select
from app.core.deps import AsyncSessionLocal
from app.models import User, Stock

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

ADMIN_EMAIL = "admin@trend-scope.com"
ADMIN_PASSWORD = "Admin123!"

ETF_SEEDS = [
    {"symbol": "SPY",  "name": "SPDR S&P 500 ETF Trust",            "type": "ETF", "sector": "Large Cap"},
    {"symbol": "QQQ",  "name": "Invesco QQQ Trust",                  "type": "ETF", "sector": "Technology"},
    {"symbol": "IWM",  "name": "iShares Russell 2000 ETF",           "type": "ETF", "sector": "Small Cap"},
    {"symbol": "DIA",  "name": "SPDR Dow Jones Industrial Average",  "type": "ETF", "sector": "Large Cap"},
    {"symbol": "VTI",  "name": "Vanguard Total Stock Market ETF",    "type": "ETF", "sector": "Broad Market"},
    {"symbol": "TQQQ", "name": "ProShares UltraPro QQQ",             "type": "ETF", "sector": "Leveraged"},
    {"symbol": "SOXL", "name": "Direxion Daily Semiconductor Bull",  "type": "ETF", "sector": "Leveraged"},
    {"symbol": "TLT",  "name": "iShares 20+ Year Treasury Bond ETF", "type": "ETF", "sector": "Bond"},
    {"symbol": "GLD",  "name": "SPDR Gold Shares",                   "type": "ETF", "sector": "Commodity"},
    {"symbol": "XLE",  "name": "Energy Select Sector SPDR Fund",     "type": "ETF", "sector": "Energy"},
]


async def seed():
    async with AsyncSessionLocal() as db:
        # Check if admin already exists
        result = await db.execute(select(User).where(User.email == ADMIN_EMAIL))
        if result.scalar_one_or_none() is None:
            admin = User(
                email=ADMIN_EMAIL,
                password_hash=pwd_context.hash(ADMIN_PASSWORD),
                nickname="Admin",
                role="admin",
                status="active",
            )
            db.add(admin)
            await db.flush()
            print(f"[OK] Admin user created: {ADMIN_EMAIL} / {ADMIN_PASSWORD}")

        # Seed ETFs
        for etf in ETF_SEEDS:
            result = await db.execute(select(Stock).where(Stock.symbol == etf["symbol"]))
            if result.scalar_one_or_none() is None:
                stock = Stock(
                    symbol=etf["symbol"],
                    name=etf["name"],
                    type=etf["type"],
                    market="US",
                    sector=etf["sector"],
                    is_active=True,
                )
                db.add(stock)
                print(f"[OK] Stock added: {etf['symbol']} — {etf['name']}")

        await db.commit()
        print("[DONE] Seed data complete.")

if __name__ == "__main__":
    asyncio.run(seed())
```

---

## 4. Verification Steps

```bash
# 1. Ensure Docker services are running
docker compose up -d

# 2. Run Alembic migration (from backend/ directory)
cd backend
alembic upgrade head
# Should create all 10 tables in MySQL.

# 3. Verify tables exist
docker compose exec mysql mysql -u trendscope -ptrendscope123 trend_scope -e "SHOW TABLES;"
# Expected output:
#   ai_analysis_results
#   alert_logs
#   alert_rules
#   alembic_version
#   analysis_configs
#   analysis_signals
#   backtest_results
#   stock_prices_daily
#   stocks
#   user_sessions
#   users

# 4. Run seed data
python seed_data.py
# Expected: Admin user created + 10 ETF stocks added.

# 5. Verify seed data
docker compose exec mysql mysql -u trendscope -ptrendscope123 trend_scope -e "SELECT id, symbol, name, type FROM stocks;"
# Expected: 10 rows with the ETF symbols.

# 6. Verify admin user
docker compose exec mysql mysql -u trendscope -ptrendscope123 trend_scope -e "SELECT id, email, nickname, role FROM users;"
# Expected: 1 row — admin@trend-scope.com, Admin, admin

# 7. Verify table schemas (spot check)
docker compose exec mysql mysql -u trendscope -ptrendscope123 trend_scope -e "DESCRIBE analysis_configs;"
# Verify: strategy_type column shows ENUM with correct values
```

---

## 5. Acceptance Criteria

- [ ] All 10 ORM models defined across 6 model files (base, user, stock, analysis, backtest, ai_analysis, alert)
- [ ] `Base` class uses SQLAlchemy 2.0 `DeclarativeBase` style
- [ ] `TimestampMixin` provides `created_at` and `updated_at` with automatic defaults
- [ ] All foreign key relationships defined with correct `back_populates` on both sides
- [ ] All ENUM columns use the correct SQLAlchemy `Enum` type with named enum types
- [ ] `analysis_configs.stock_id` is nullable (for global strategies)
- [ ] `ai_analysis_results.signal_id` has `unique=True` and `ondelete="CASCADE"`
- [ ] `alert_rules` has a composite unique constraint on `(user_id, stock_id, alert_type)` — implement this in the migration or as `__table_args__` on the model
- [ ] `stock_prices_daily` has a composite unique constraint on `(stock_id, trade_date)` — implement this in migration or `__table_args__`
- [ ] `stock_prices_daily` has index on `(stock_id, trade_date DESC)`
- [ ] `analysis_signals` has index on `(stock_id, triggered_date DESC)` and `(is_active)`
- [ ] Alembic `env.py` works with async SQLAlchemy engine
- [ ] `alembic upgrade head` creates all 10 tables + `alembic_version` without errors
- [ ] `get_db()` async generator correctly manages session lifecycle (commit/rollback/close)
- [ ] `seed_data.py` creates 1 admin user and 10 ETF stocks
- [ ] Seed data is idempotent (re-running does not create duplicates)
- [ ] Admin user password is bcrypt-hashed (NOT plaintext)
- [ ] All imports in `backend/app/models/__init__.py` re-export all models correctly
- [ ] `backend/app/core/deps.py` creates engine and session factory from `settings.DATABASE_URL`
- [ ] Models use type hints `Mapped[T]` and `Optional[T]` correctly

---

## 6. Implementation Notes

### 6.1 Unique Constraints via `__table_args__`

For tables requiring composite unique keys, add `__table_args__`:

```python
# In StockPriceDaily model:
from sqlalchemy import UniqueConstraint

class StockPriceDaily(Base):
    __tablename__ = "stock_prices_daily"
    __table_args__ = (
        UniqueConstraint("stock_id", "trade_date", name="uq_stock_date"),
        {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4"},
    )
    # ...

# In AlertRule model:
class AlertRule(Base, TimestampMixin):
    __tablename__ = "alert_rules"
    __table_args__ = (
        UniqueConstraint("user_id", "stock_id", "alert_type", name="uq_user_stock_type"),
        {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4"},
    )
    # ...
```

### 6.2 Composite Indexes

For composite indexes, add them directly on `mapped_column` or use `Index` in `__table_args__`:

```python
from sqlalchemy import Index

class AnalysisSignal(Base):
    # ...
    __table_args__ = (
        Index("idx_stock_triggered", "stock_id", "triggered_date"),
        Index("idx_active_signals", "is_active"),
        {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4"},
    )
```

### 6.3 Date Type Import

The `stock_prices_daily.trade_date` and `analysis_signals.triggered_date` and `backtest_results.start_date/end_date` all use Python `date` type. Import from `datetime`:

```python
from datetime import date
```

---

## 7. Estimated Time Breakdown

| Subtask | Est. Time |
|---|---|
| `base.py` + `TimestampMixin` | 0.25h |
| `user.py` (User + UserSession models) | 0.5h |
| `stock.py` (Stock + StockPriceDaily models) | 0.75h |
| `analysis.py` (AnalysisConfig + AnalysisSignal) | 1h |
| `backtest.py` (BacktestResult) | 0.5h |
| `ai_analysis.py` (AIAnalysisResult) | 0.25h |
| `alert.py` (AlertRule + AlertLog) | 0.5h |
| `models/__init__.py` with all exports | 0.25h |
| `deps.py` (engine + get_db) | 0.5h |
| Alembic init + env.py (async) + first migration | 1.5h |
| `seed_data.py` | 0.5h |
| Testing + verification | 1.5h |
| **Total** | **~8h (1.5-2 days)** |
