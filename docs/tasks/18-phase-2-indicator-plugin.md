# Task 18 — Phase 2 Indicator Plugin System

> **Status**: Planning  
> **Estimated Time**: 5–6 days  
> **Depends On**: Phase 1 Complete (strategy protocol already supports structured output)  
> **Required By**: Task 19 (ML Enhancement — indicators as features)  
> **参考设计文档**:
> - [phase-2.md](../design/phase-2.md) — P2-5 指标插件
> - [009-indicator-plugin-system.md](../design/009-indicator-plugin-system.md) — 指标插件设计
> - [004-indicator-system.md](../research/004-indicator-system.md) — 指标系统研究
> - [ai/context.md](../ai/context.md) — Phase 1 策略用 pd.rolling/ewm 直接计算

---

## 1. 目标

为策略脚本提供标准化的可复用指标库，替代 Phase 1 中硬编码的 `pd.rolling/ewm` 调用。指标插件系统与策略协议解耦：策略脚本可 `import` 系统指标或继续使用原生 pandas。

---

## 2. 子任务

### 2.1 BaseIndicator 抽象基类

**位置**: `backend/app/indicators/base.py`

```python
class BaseIndicator(ABC):
    name: str
    version: str = "1.0"
    description: str = ""

    @abstractmethod
    def compute(self, df: pd.DataFrame, params: dict) -> pd.Series | pd.DataFrame:
        """Calculate indicator values. Returns Series or DataFrame aligned with df.index."""
        ...

    @classmethod
    def default_params(cls) -> dict:
        """Return default parameter values."""
        return {}
```

**约定**:
- `compute()` 接收完整 `df`（含 OHLCV），返回与 `df.index` 对齐的结果
- 不修改输入 `df`
- 所有 NaN 由调用方处理

### 2.2 IndicatorRegistry 自动发现

**位置**: `backend/app/indicators/registry.py`

**功能**:
1. 扫描 `backend/app/indicators/` 下所有 `.py` 文件
2. 找到 `BaseIndicator` 子类
3. 实例化并缓存
4. 按 `name` 索引

**全局入口**:
```python
from app.indicators import registry
ma20 = registry.get("sma").compute(df, {"period": 20})
```

### 2.3 40+ 内置指标

**Phase 2 一期实现**:

| 类别 | 指标 | 数量 |
|---|---|---|
| 趋势 | SMA, EMA, WMA, HMA, KAMA, SuperTrend, Parabolic SAR | 7 |
| 动量 | RSI, Stochastic, Williams %R, CCI, MFI, ROC | 6 |
| 波动 | Bollinger Bands, ATR, Keltner Channel, Donchian Channel, Ulcer Index | 5 |
| 成交量 | OBV, VWAP, Chaikin Money Flow, Volume Profile, Force Index | 5 |
| 均线交叉 | MACD, PPO, TRIX, Vortex | 4 |
| 支撑阻力 | Pivot Points, Fibonacci Retracement, Ichimoku Cloud | 3 |
| 统计 | Z-Score, Beta, Correlation, Linear Regression, Hurst Exponent | 5 |
| 自定义 | (用户可通过插件扩展) | ∞ |

**实现示例**:
```python
# backend/app/indicators/trend.py
class SMAIndicator(BaseIndicator):
    name = "sma"
    def compute(self, df, params):
        period = int(params.get("period", 20))
        return df["close"].rolling(period).mean()

class SuperTrendIndicator(BaseIndicator):
    name = "supertrend"
    def compute(self, df, params):
        period = int(params.get("period", 10))
        multiplier = float(params.get("multiplier", 3.0))
        # ... ATR-based bands
```

### 2.4 策略脚本集成

**旧写法**（Phase 1，仍然兼容）:
```python
def analyze(df, params):
    fast = df["close"].rolling(20).mean()
    slow = df["close"].rolling(60).mean()
```

**新写法**（Phase 2，推荐）:
```python
def analyze(df, params):
    fast = registry.get("ema").compute(df, {"period": 20})
    slow = registry.get("ema").compute(df, {"period": 60})
    rsi = registry.get("rsi").compute(df, {"period": 14})
```

**全局注入**: `ScriptExecutor` 将 `registry` 注入脚本的 globals

### 2.5 指标缓存

**方案**: Redis 缓存指标的预计算结果

**缓存键**: `indicator:{name}:{stock_id}:{params_hash}:{date_range}`

**流程**: 策略执行时检查缓存 → 命中则直接返回 → 未命中则计算并写入

**Admin 管理**: `/data` 页面新增「清除指标缓存」按钮

### 2.6 指标预设与参数覆盖

**新增模型**:
```python
class IndicatorPreset(Base):
    __tablename__ = "indicator_presets"
    id: int (PK)
    name: str  # "default_ma_cross"
    description: str
    indicators: JSON  # [{"name": "sma", "params": {"period": 20}}, ...]
    created_by: int (FK users)

class StockIndicatorOverride(Base):
    __tablename__ = "stock_indicator_overrides"
    id: int (PK)
    stock_id: int (FK stocks)
    indicator_name: str
    params: JSON  # 覆盖默认参数
```

**API**: Admin 端点管理预设和覆盖

### 2.7 指标 → 策略模板生成

**功能**: 选择几个指标 + 逻辑条件 → 自动生成策略 Python 脚本

**前端**: 「指标组合器」页面
1. 从下拉菜单选择指标（如 SMA(20), RSI(14)）
2. 设置条件（SMA(20) > SMA(60) AND RSI(14) < 30 → Buy）
3. 预览生成的 Python 代码
4. 「保存为策略」

> 此功能与 Task 14 的策略可视化构建器互补，Task 14 侧重条件表达式输入，本功能侧重指标选择和参数调优。

---

## 3. 数据库表

| 表 | 用途 |
|---|---|
| `indicator_presets` | 指标预设组合 |
| `stock_indicator_overrides` | 标的级别指标参数覆盖 |
| `indicator_cache` | (Redis) 预计算结果缓存 |

---

## 4. API 端点

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/admin/indicators` | 列出所有可用指标及参数 |
| GET/POST | `/admin/indicator-presets` | 指标预设 CRUD |
| GET/POST | `/admin/stock-indicator-overrides` | 标的覆盖管理 |
| POST | `/admin/strategies/generate-from-indicators` | 指标组合 → 策略脚本 |

---

## 5. 测试

- [ ] 每个内置指标的 `compute()` 返回合法的 Series/DataFrame
- [ ] `Registry` 自动发现所有指标子类
- [ ] 策略脚本通过 `registry.get("rsi")` 可正常调用指标
- [ ] 指标缓存命中时性能提升 > 10x
- [ ] 指标组合器生成的策略脚本通过 `validate` 检查

---

## 6. 验收标准

1. 40+ 指标通过 Registry 可调用
2. 策略脚本可通过 `registry.get("rsi")` 替代手写 RSI 计算
3. 指标缓存有效减少大区间回测的计算时间
4. 指标组合器可用拖拽方式生成有效策略
