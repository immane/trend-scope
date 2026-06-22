# Task 14 — Phase 2 Strategy Ecosystem

> **Status**: Planning  
> **Estimated Time**: 4–5 days  
> **Depends On**: Task 13 (Backtest Enhancement — Optuna optimization)  
> **Required By**: —  
> **参考设计文档**:
> - [phase-2.md](../design/phase-2.md) — P2-9 策略生态
> - [004-analysis-engine.md](../design/004-analysis-engine.md) — 分析引擎
> - [ai/context.md](../ai/context.md) — 策略协议和公共策略

---

## 1. 目标

在 Phase 1 策略系统基础上构建策略生态：排行榜、市场、一键优化和可视化构建器，降低策略使用门槛并促进社区贡献。

---

## 2. 子任务

### 2.1 策略性能排行榜

**目标**: 按 Sharpe / 收益 / 回撤对所有策略排序，驱动策略迭代竞争。

**后端**:
- `GET /admin/strategy-leaderboard`: 聚合所有策略最近一次回测的指标
- 支持按指标排序和过滤 (stock_id, strategy_type, 时间范围)
- 排行榜缓存 (Redis, 每小时刷新)

**前端**:
- 新增 `/strategies/leaderboard` 页面
- 表格列: 排名 / 策略名 / 标的 / 收益率 / MaxDD / Sharpe / 交易数 / 最近回测时间
- 点击行跳转策略详情

### 2.2 策略市场

**目标**: Admin 可将策略发布为公共模板，其他用户可一键复制使用。

**新增模型**:
```python
class StrategyMarketplace(Base, TimestampMixin):
    __tablename__ = "strategy_marketplace"
    id: int (PK)
    name: str
    description: str
    author_id: int (FK users)
    source_config_id: int (FK analysis_configs)
    script_content: str  # 快照，独立于源配置
    script_params: dict
    category: str  # "trend" / "mean_reversion" / "momentum" / "ml"
    downloads: int
    avg_rating: float
    is_published: bool
```

**API**:
- `GET /marketplace/strategies`: 浏览策略市场
- `POST /marketplace/strategies`: 发布策略
- `POST /marketplace/strategies/{id}/fork`: 一键复制到我的策略

**前端**:
- `/strategies/marketplace` 页面
- 卡片式布局：策略名、描述、作者、评分、下载数
- 「Fork」按钮一键导入

### 2.3 策略参数一键优化

**目标**: 策略详情页点击按钮，触发 Optuna 自动优化，返回最优参数。

**集成**: Task 13 的 Optuna 优化器 + 前端触发

**前端交互**:
1. 策略详情页「一键优化」按钮
2. 在弹出的 modal 中选择优化目标 (Max Sharpe / Min MaxDD / Max Return)
3. 选择 trials 数量 (50/100/200)
4. 提交后显示进度条，完成展示 top-10 参数组
5. 「应用最优参数」按钮直接更新策略的 `script_params`

### 2.4 策略条件表达式 (Visual Builder Lite)

**目标**: 非程序员通过简单条件表达式创建策略。

**语法** (类似 TradingView Pine Script 条件):
```
MA(20) > MA(60) AND RSI(14) < 30 → BUY
MA(20) < MA(60) OR RSI(14) > 70 → SELL
```

**后端**:
- `POST /admin/strategies/build`: 接收 JSON 条件树 → 生成 Python 脚本
- 条件树结构:
```json
{
  "buy": {
    "operator": "AND",
    "conditions": [
      {"indicator": "ma", "period": 20, "compare": ">", "indicator2": "ma", "period2": 60},
      {"indicator": "rsi", "period": 14, "compare": "<", "value": 30}
    ]
  },
  "sell": { ... }
}
```

**前端**:
- `/strategies/builder` 页面
- 可视化条件编辑器：拖拽指标 → 设置比较 → AND/OR 组合
- 实时预览生成的 Python 代码
- 「保存为策略」按钮

### 2.5 策略回测结果导出

**目标**: 下载回测结果为 CSV/JSON。

**API**:
- `GET /backtest/{id}/export?format=csv|json`
- CSV: 权益曲线日数据
- JSON: 完整回测结果

**前端**: 回测详情页新增「导出 CSV」「导出 JSON」按钮

---

## 3. 数据库表

| 表 | 用途 |
|---|---|
| `strategy_marketplace` | 策略市场发布表 |

---

## 4. API 端点

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/admin/strategy-leaderboard` | 策略排行榜 |
| GET | `/marketplace/strategies` | 浏览策略市场 |
| POST | `/marketplace/strategies` | 发布策略 |
| POST | `/marketplace/strategies/{id}/fork` | 复制策略 |
| POST | `/admin/strategies/build` | 条件表达式生成策略 |
| GET | `/backtest/{id}/export` | 导出回测结果 |

---

## 5. 前端页面

| Route | 功能 |
|---|---|
| `/strategies/leaderboard` | 策略排行榜 |
| `/strategies/marketplace` | 策略市场 |
| `/strategies/builder` | 可视化策略构建器 |

---

## 6. 测试

- [ ] 排行榜按 Sharpe 排序正确
- [ ] 策略市场 Fork 后生成独立策略配置
- [ ] 条件表达式生成的 Python 脚本通过 validate 检查
- [ ] CSV/JSON 导出内容完整

---

## 7. 验收标准

1. 排行榜展示所有策略的最近回测指标
2. 策略市场可发布/Fork/下载策略
3. 条件表达式可生成有效 Python 策略脚本
4. 回测结果可下载为 CSV/JSON
