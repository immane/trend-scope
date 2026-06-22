# Trend-Scope Strategy Script Help

本文档说明 Trend-Scope 管理端“自定义策略代码”的完整协议。当前系统兼容旧版信号脚本，也支持新版结构化策略输出，便于后续接入 AI 分析、仓位控制和策略解释。

## 1. 基本入口

每个策略脚本必须定义：

```python
def analyze(df, params):
    ...
    return result
```

参数说明：

| 参数 | 类型 | 说明 |
|---|---|---|
| `df` | `pandas.DataFrame` | K 线数据，index 为交易日期 |
| `params` | `dict` | 策略参数，由管理端 `script_params` 传入 |

`df` 可用列：

| 列 | 说明 |
|---|---|
| `open` | 开盘价 |
| `high` | 最高价 |
| `low` | 最低价 |
| `close` | 收盘价 |
| `volume` | 成交量 |

脚本环境内置：

| 名称 | 说明 |
|---|---|
| `pd` | pandas |
| `np` | numpy |
| `abs`, `bool`, `float`, `int`, `len`, `max`, `min`, `range`, `round`, `sum` | 安全内置函数 |

禁止导入：`os`, `sys`, `subprocess`, `socket`, `requests`, `pathlib`, `shutil`。

禁止调用：`open`, `exec`, `eval`, `compile`, `__import__`。

## 2. 旧版返回协议：信号 Series

旧脚本可以继续返回 `pd.Series`：

```python
def analyze(df, params):
    fast = df["close"].rolling(20).mean()
    slow = df["close"].rolling(60).mean()
    signal = pd.Series(0, index=df.index)
    signal[(fast.shift(1) <= slow.shift(1)) & (fast > slow)] = 1
    signal[(fast.shift(1) >= slow.shift(1)) & (fast < slow)] = -1
    return signal.shift(1).fillna(0)
```

信号含义：

| 值 | 含义 |
|---|---|
| `1` | 买入 / 开多 |
| `0` | 不操作 |
| `-1` | 卖出 / 清仓 |

旧版回测行为：

1. `1` 且当前无仓位：全仓买入。
2. `-1` 且当前有仓位：清仓卖出。
3. 只支持单标的做多。
4. 会计模型会计入滑点和手续费。

## 3. 新版返回协议：结构化 DataFrame

新版脚本推荐返回 `pd.DataFrame`，index 必须与 `df.index` 对齐。

```python
def analyze(df, params):
    close = df["close"]
    ma20 = close.rolling(20).mean()
    ma60 = close.rolling(60).mean()

    output = pd.DataFrame(index=df.index)
    output["signal"] = 0
    output["target_position"] = 0.0
    output["confidence"] = 0.0
    output["reason"] = None
    output["ai_context"] = None

    bullish = ma20 > ma60
    output.loc[bullish, "target_position"] = 0.8
    output.loc[bullish, "confidence"] = 0.72
    output.loc[bullish, "reason"] = "MA20 above MA60"
    output.loc[bullish, "ai_context"] = "Trend filter is bullish; check news and volatility before increasing allocation."

    output["target_position"] = output["target_position"].shift(1).fillna(0)
    output["signal"] = output["target_position"].diff().fillna(output["target_position"]).apply(lambda x: 1 if x > 0 else -1 if x < 0 else 0)
    return output
```

支持列：

| 列 | 类型 | 范围 | 用途 |
|---|---|---|---|
| `signal` | int | `-1`, `0`, `1` | 离散信号；用于信号扫描和兼容旧逻辑 |
| `target_position` | float | `-1.0` 到 `1.0` | 目标仓位；`0.5` 表示 50% 多头，`0` 表示空仓，`-1` 预留为空头 |
| `confidence` | float | `0.0` 到 `1.0` | 策略置信度，会写入信号详情 |
| `reason` | str | 任意短文本 | 信号原因，会写入 `trigger_details` 和回测交易日志 |
| `ai_context` | str | 任意短文本 | 给后续 AI 分析服务的上下文，不在脚本内直接调用 AI |

系统会自动标准化：

1. `signal` 会被裁剪到 `-1..1` 并取整。
2. `target_position` 会被裁剪到 `-1..1`。
3. `confidence` 会被裁剪到 `0..1`。
4. 返回缺失日期会按 `df.index` 补齐。

## 4. 回测如何处理 `target_position`

当返回结果包含 `target_position` 时，回测采用目标仓位调仓模型：

1. 每根 K 线读取目标仓位。
2. 目标仓位会向前填充，直到下一次变化。
3. 回测按当前权益计算目标敞口。
4. 调仓时计入滑点和手续费。
5. 权益始终按 `cash + shares * close` 计算。
6. 交易日志会记录 `target_position`, `confidence`, `reason`。

示例：

| `target_position` | 含义 |
|---|---|
| `0.0` | 空仓 |
| `0.3` | 30% 多头仓位 |
| `1.0` | 满仓多头 |
| `-0.5` | 50% 空头仓位，当前为预留能力，实际生产策略应谨慎使用 |

## 5. AI 接入建议

当前不建议在策略脚本中直接调用 AI API，原因：

1. 脚本沙箱禁止 `requests` 和网络访问。
2. 回测需要可复现，直接调用外部模型会导致结果不可重复。
3. AI 调用成本高、耗时不可控，不适合在每根 K 线上同步执行。

推荐模式：

1. 策略脚本输出 `ai_context`、`reason`、关键指标数值。
2. 信号扫描保存这些字段到 `trigger_details`。
3. AI 分析服务读取信号和上下文，异步生成解释。
4. 如果未来需要 AI 参与决策，应先将 AI 输出落库为可复现的特征，再由策略脚本读取这些特征。

推荐结构：

```python
output["ai_context"] = "RSI below 30 while price is near 60-day support; ask AI to check earnings/news risk."
```

未来可扩展的 AI 特征列示例：

| 列 | 说明 |
|---|---|
| `sentiment_score` | 新闻/财报/社媒情绪分数 |
| `ai_risk_score` | AI 风险评分 |
| `ai_regime` | AI 判断的市场状态，如 trend/range/stress |
| `ai_summary` | AI 生成的短文本摘要 |

## 6. 避免未来函数

策略必须避免使用当天收盘后才知道的信息在当天成交。

推荐：所有用当天收盘计算出的信号，都 `shift(1)` 后返回。

正确：

```python
signal[(fast.shift(1) <= slow.shift(1)) & (fast > slow)] = 1
return signal.shift(1).fillna(0)
```

风险写法：

```python
signal[fast > slow] = 1
return signal
```

风险原因：当天 `fast > slow` 依赖当天收盘价，如果同一天按收盘价成交，会有未来函数/同根 K 线偷看问题。

## 7. 推荐模板：分仓 + 解释 + AI 上下文

```python
def analyze(df, params):
    fast_period = int(params.get("fast", 20))
    slow_period = int(params.get("slow", 60))
    risk_on_position = float(params.get("risk_on_position", 0.8))
    risk_off_position = float(params.get("risk_off_position", 0.0))

    close = df["close"]
    fast = close.rolling(fast_period).mean()
    slow = close.rolling(slow_period).mean()
    volatility = close.pct_change().rolling(20).std()

    risk_on = (fast > slow) & (volatility < volatility.rolling(120).median())

    output = pd.DataFrame(index=df.index)
    output["target_position"] = risk_off_position
    output.loc[risk_on, "target_position"] = risk_on_position

    output["target_position"] = output["target_position"].shift(1).fillna(0)
    delta = output["target_position"].diff().fillna(output["target_position"])
    output["signal"] = delta.apply(lambda value: 1 if value > 0 else -1 if value < 0 else 0)

    output["confidence"] = 0.55
    output.loc[risk_on, "confidence"] = 0.75
    output["reason"] = "Risk-off or insufficient trend"
    output.loc[risk_on, "reason"] = "Fast MA above slow MA and volatility is controlled"
    output["ai_context"] = "Use AI to verify macro/news risk before increasing exposure."
    return output
```

## 8. 当前限制

1. 策略仍是单标的运行，不支持一个脚本直接做多资产组合。
2. `target_position` 已支持分仓，空头为预留能力，生产使用前应补更严格的风控测试。
3. 不支持限价单、止损单、止盈单、VWAP 等订单类型。
4. 不支持脚本内联网调用 AI 或外部 API。
5. 脚本运行仍在 Python 进程内执行，未来若开放给不可信用户，需要更强隔离、超时和资源限制。
6. 历史回测应保存策略脚本快照和参数快照，确保策略修改后仍可复现旧结果。

## 9. 实践建议

1. 新策略优先返回 `DataFrame`，不要只返回 `Series`。
2. 每个信号都写 `reason`。
3. AI 相关信息写入 `ai_context`，不要在脚本内直接调用模型。
4. 每个策略都保留参数化能力，不要硬编码窗口和阈值。
5. 回测前先用小样本 `test-run` 看输出是否符合预期。
6. 所有基于收盘价生成的信号都默认 `shift(1)`。
