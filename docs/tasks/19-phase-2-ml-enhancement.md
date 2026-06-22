# Task 19 — Phase 2 ML Enhancement (Analysis Engine Layer 2)

> **Status**: Planning  
> **Estimated Time**: 7–8 days  
> **Depends On**: Task 18 (Indicator Plugin — indicators as ML features)  
> **Required By**: —  
> **参考设计文档**:
> - [phase-2.md](../design/phase-2.md) — P2-4 ML 增强
> - [004-analysis-engine.md](../design/004-analysis-engine.md) — 分析引擎 Layer 2
> - [005-analysis-engine.md](../research/005-analysis-engine.md) — 分析引擎研究
> - [009-ai-analysis.md](../research/009-ai-analysis.md) — AI 分析研究
> - [ai/context.md](../ai/context.md) — 当前策略协议支持 ai_context 字段

---

## 1. 目标

为策略脚本提供 ML 预计算特征列，实现"ML 特征落库 → 策略脚本消费 → 闭环验证"的工作流。ML 本身不做交易决策，而是作为策略脚本的增强输入。

---

## 2. 子任务

### 2.1 ML 特征工程管道

**位置**: `backend/app/services/ml/feature_pipeline.py`

**输入**: 标的 OHLCV + 指标 Registry 输出

**输出**: 追加了 ML 特征列的 DataFrame

**特征组**:

| 特征类别 | 示例 | 数量 |
|---|---|---|
| 价格特征 | returns_1d/5d/20d, log_return, high_low_ratio | 12 |
| 波动特征 | rolling_vol_5d/20d, atr_ratio, vol_regime | 8 |
| 趋势特征 | ma_cross_dist, adx, slope_20d, trend_strength | 8 |
| 成交量特征 | volume_ratio, obv_slope, vwap_distance | 6 |
| 指标特征 | rsi, macd_hist, bollinger_width, stochastic_k | 12 |
| 市场特征 | relative_strength_vs_spy, sector_correlation | 4 |
| 时序特征 | lag_1/3/5 returns, seasonality_dummy | 6 |

> **解耦设计**: 特征管道独立于策略脚本。策略脚本只需接收含 ML 特征的 `df`，无需了解 ML 实现。

### 2.2 XGBoost 信号分类

**位置**: `backend/app/services/ml/classifier.py`

**训练数据**: 所有标的历史日线 + Phase 1 所有回测信号的标签

**流程**:
1. 标签构造: `signal` 列作为 `y` (1: buy, -1: sell, 0: hold)
2. 特征标准化: `StandardScaler` 拟合后序列化
3. 训练: `XGBClassifier` + `RandomizedSearchCV`
4. 输出: 每个日期的 `buy_probability`、`sell_probability`、`hold_probability`

**模型管理**:
```python
class MLModel(Base):
    __tablename__ = "ml_models"
    id: int (PK)
    name: str
    model_type: str  # "xgboost" / "lstm" / "finbert"
    version: str
    metrics: JSON  # {"accuracy": 0.72, "precision": 0.68, ...}
    feature_columns: JSON
    scaler_bytes: bytes
    model_bytes: bytes
    trained_at: datetime
    is_active: bool
```

### 2.3 LSTM 时序预测

**位置**: `backend/app/services/ml/lstm_predictor.py`

**输入**: 过去 60 天的 OHLCV 序列

**输出**: 未来 5 天的方向预测 (up/flat/down) + 概率

**框架**: PyTorch (轻量 LSTM)

**训练**: 离线训练，每周更新一次模型

**输出列**: `lstm_forecast_direction`、`lstm_forecast_confidence`

### 2.4 FinBERT 情绪分析

**位置**: `backend/app/services/ml/sentiment.py`

**输入**: 策略脚本的 `ai_context` 文本 + 外部新闻/社交数据 (如有)

**输出**: `sentiment_score` (0-1, 越高越正面)

**模型**: `ProsusAI/finbert` (HuggingFace)

**缓存**: Redis, TTL 24h

### 2.5 ML 特征落库与策略消费

**这是本 Task 的核心解耦设计**:

**ML 特征落库流程**:
1. 每日定时 Job 对所有活跃标的运行 `FeaturePipeline`
2. 产出追加了 ML 列的 DataFrame
3. 存入 `ml_features` 表

**新增模型**:
```python
class MLFeature(Base):
    __tablename__ = "ml_features"
    id: int (PK)
    stock_id: int (FK stocks)
    date: date
    xgb_buy_prob: float | None
    xgb_sell_prob: float | None
    lstm_direction: int | None  # 1/0/-1
    lstm_confidence: float | None
    sentiment_score: float | None
    risk_score: float | None
    regime: str | None  # "trend" / "range" / "stress"
```

**策略脚本消费**:

策略执行时 `_load_prices()` 自动 JOIN `ml_features`，将 ML 列追加为 `df` 的额外列。策略脚本无需感知 ML 存在：

```python
def analyze(df, params):
    # df 现在自动包含 ML 预计算列
    # df["xgb_buy_prob"], df["sentiment_score"], df["regime"], ...

    output = pd.DataFrame(index=df.index)
    output["target_position"] = 0.0

    # 规则 + ML 综合决策
    trend_ok = df["close"] > df["close"].rolling(120).mean()
    ml_ok = (df["xgb_buy_prob"] > 0.65) & (df["sentiment_score"] > 0.5)
    output.loc[trend_ok & ml_ok, "target_position"] = 0.8
    output.loc[trend_ok & ml_ok, "confidence"] = df.loc[trend_ok & ml_ok, "xgb_buy_prob"]
    output.loc[trend_ok & ml_ok, "reason"] = "Trend confirmed by XGBoost + positive sentiment"
    return output
```

### 2.6 模型 A/B 测试

**方案**:
1. 策略配置新增 `ml_model_id: int | None`
2. 同一策略使用不同 ML 模型版本运行回测
3. 对比回测结果 → 选择更优模型

**前端**: 策略回测 Tab 新增「ML 模型版本」下拉菜单

---

## 3. 数据库表

| 表 | 用途 |
|---|---|
| `ml_models` | ML 模型版本管理 |
| `ml_features` | 每日 ML 预计算特征 |
| `ml_training_jobs` | 模型训练任务 (可选，Phase 2 后期) |

---

## 4. API 端点

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/admin/ml/models` | ML 模型列表 |
| POST | `/admin/ml/models/train` | 触发模型训练 |
| GET | `/admin/ml/features/{stock_id}` | 查看某标的 ML 特征 |
| PATCH | `/admin/strategies/{id}` | ml_model_id 字段关联模型 |

---

## 5. 测试

- [ ] FeaturePipeline 输出的 DataFrame 包含所有 ML 列
- [ ] XGBoost 模型训练/预测/序列化/反序列化完整流程
- [ ] 策略脚本可访问 `df["xgb_buy_prob"]` 列
- [ ] 不同 ML 模型的 A/B 回测对比正确

---

## 6. 验收标准

1. ML 特征每日自动生成并落库
2. 策略脚本可通过 `df["xgb_buy_prob"]` 消费 ML 预测
3. XGBoost 模型每周自动更新
4. A/B 测试可对比不同 ML 模型的回测效果
