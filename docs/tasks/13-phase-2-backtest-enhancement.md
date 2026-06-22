# Task 13 — Phase 2 Backtest System Enhancement

> **Status**: Planning  
> **Estimated Time**: 5–6 days  
> **Depends On**: Phase 1 Complete  
> **Required By**: Task 14 (Strategy Ecosystem)  
> **参考设计文档**:
> - [phase-2.md](../design/phase-2.md) — P2-3 回测增强
> - [007-backtest-system.md](../design/007-backtest-system.md) — 回测系统设计
> - [006-backtest.md](../research/006-backtest.md) — 回测技术研究
> - [ai/context.md](../ai/context.md) — 当前 BacktestService 实现

---

## 1. 目标

基于 Phase 1 自研回测引擎，添加异步任务队列、参数优化、做空支持和多资产回测能力。Phase 1 已有完整的信号模式和目标仓位调仓模式，本 Task 在其上扩展。

---

## 2. 子任务

### 2.1 异步回测任务队列

**当前痛点**: 回测在 API 请求线程内同步执行，长区间/多策略回测会阻塞请求甚至超时。

**方案**: ARQ (Async Redis Queue)

**新增模型**:
```python
class BacktestJob(Base):
    __tablename__ = "backtest_jobs"
    id: int (PK)
    backtest_result_id: int (FK → backtest_results)
    status: Enum["queued", "running", "completed", "failed"]
    progress_pct: float  # 0-100
    started_at: datetime
    completed_at: datetime
    error_message: str | None
```

**接口变更**:
- `POST /backtest/run` 改为返回 `job_id` (status: queued)
- `GET /backtest/jobs/{job_id}` 轮询进度
- WebSocket 或 SSE 推送完成事件（可选，可用轮询替代）

**实现**:
- `backend/app/services/backtest_worker.py`: ARQ worker 函数
- `docker-compose.yml`: 新增 `arq-worker` 服务
- Admin 面板回测列表显示队列状态和进度条

### 2.2 Optuna 参数优化

**目标**: 对任意策略自动寻找最优参数组合。

**方案**:
- 新增 `backend/app/services/optimizer.py`
- `POST /backtest/optimize`: 接收 `config_id` + 参数空间定义
- 目标函数最大化 Sharpe 或最小化 MaxDD + 最大化 收益
- 结果保存: `params_optimize_results` 表或 JSON 列

**UI 集成**:
- 策略详情页「一键优化」按钮
- 弹出参数空间配置 (param name → min/max/step)
- 优化完成后展示 convergence plot + top-10 参数组

### 2.3 Walk-Forward 过拟合检测

**目标**: 验证策略在样本外数据上的表现。

**方案**:
1. 将历史数据切分为连续窗口 (rolling window)
2. 每段窗口: 训练集调参 → 验证集记录表现
3. 汇总所有验证集结果 → Walk-Forward 指标
4. 计算 Deflated Sharpe Ratio (DSR)

**输出**:
- Walk-Forward 净值曲线 (与一次回测对比)
- DSR (p-value): 策略的 Sharpe 是否统计显著
- 过拟合概率评分

### 2.4 做空支持

**Phase 1 现状**: `target_position` 已支持负值语法，但实际做空逻辑未完整测试。

**需求**:
- 回测引擎验证做空路径：借入→卖出→买入平仓
- 做空的滑点和手续费方向性处理
- 做空保证金管理 (Reg T 50% 初始保证金 + 25% 维持保证金)
- Admin 面板策略编辑器显示 `min_position` / `max_position` 约束

**测试**:
- [ ] 纯做空策略回测 (target_position = -1 → 0)
- [ ] 多空双向策略回测 (target_position = [-0.5, 0.5])
- [ ] 做空保证金不足时正确爆仓/强平

### 2.5 多资产回测

**目标**: 一个回测配置可包含多个标的 (如 SPY + QQQ + TLT)，策略在它们之间分配仓位。

**方案**:
- `BacktestResult` 新增 `stock_ids: JSON` (array)
- 回测引擎收到多个标的的 `df` dict
- 策略每根 K 线对所有标的打分，引擎按分数排序分配仓位
- 交易日志标记 `stock_id`

**接口**:
- `POST /backtest/run`: `stock_ids: [1, 2, 3]`
- 策略脚本签名扩展: `def analyze(frames: dict[int, DataFrame], params: dict)`

> 此功能与 Phase 1 策略协议兼容：`frames` 中的每个 DataFrame 结构与 Phase 1 相同。旧策略脚本无需改动即可在单标的上运行。

---

## 3. 数据库表

| 表 | 用途 |
|---|---|
| `backtest_jobs` | 异步任务队列 |
| `backtest_results` | 新增 `stock_ids`, `optimize_params`, `walk_forward_metrics` 列 |

---

## 4. API 端点

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/backtest/run` | 创建异步回测任务 |
| GET | `/backtest/jobs/{job_id}` | 查询任务进度 |
| POST | `/backtest/optimize` | 创建参数优化任务 |
| GET | `/admin/backtest-optimize/{job_id}` | 查看优化结果 |
| GET | `/backtest/walk-forward` | 执行 Walk-Forward 分析 |

---

## 5. 前端页面

| Route | 功能 |
|---|---|
| `/backtest` | 回测列表页显示队列状态和进度条 |
| `/strategies/[id]` | 新增「一键优化」按钮 /「做空开关」/「Walk-Forward」面板 |

---

## 6. 测试

- [ ] 异步回测队列创建/轮询/完成流程通过
- [ ] Optuna 100-trial 优化不超时
- [ ] Walk-Forward DSR p < 0.05 有效识别过拟合
- [ ] 做空策略完整来回流程 PnL 计算正确
- [ ] 多资产回测 (2 标的) 交易日志正确标记 stock_id

---

## 7. 验收标准

1. 回测不阻塞 API 请求 (异步执行)
2. Optuna 优化可找到比默认参数更好的参数组
3. Walk-Forward 报告显示样本外表现
4. 做空策略可正常回测并输出双向下单
5. 多资产回测可同时持有 SPY + QQQ 仓位
