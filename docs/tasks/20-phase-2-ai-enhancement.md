# Task 20 — Phase 2 AI Analysis Enhancement

> **Status**: Planning  
> **Estimated Time**: 4–5 days  
> **Depends On**: Phase 1 Complete (AI runtime config already implemented)  
> **Required By**: —  
> **参考设计文档**:
> - [phase-2.md](../design/phase-2.md) — P2-8 AI 增强
> - [008-ai-analysis-system.md](../design/008-ai-analysis-system.md) — AI 分析系统设计
> - [009-ai-analysis.md](../research/009-ai-analysis.md) — AI 分析技术研究
> - [ai/context.md](../ai/context.md) — 当前 AIAnalysisService + ai_config 实现

---

## 1. 目标

在 Phase 1 已有的 DeepSeek 单一模型 + 运行时配置基础上，扩展多模型路由、批量分析、成本控制和本地模型支持。Phase 1 已实现 `PATCH /admin/ai-config` 即时生效和任何 OpenAI 兼容 API 支持。

---

## 2. 子任务

### 2.1 多模型路由

**位置**: `backend/app/services/ai_router.py`

**模型注册表**: 扩展现有 `ai_config` 为多 provider 配置

```python
class AIProvider(Base):
    __tablename__ = "ai_providers"
    id: int (PK)
    name: str  # "deepseek" / "openai" / "claude" / "ollama"
    base_url: str
    api_key: str  # encrypted at rest
    default_model: str
    priority: int  # 1=primary, 2=fallback, 3=last-resort
    max_tokens_per_day: int  # cost control
    is_active: bool
```

**路由策略**:
1. Primary provider (priority=1) → 调用
2. 失败 → fallback (priority=2) → 调用
3. 全部失败 → 本地模板 (Phase 1 已有)

**路由条件**:
- Provider `is_active` 且未超 `max_tokens_per_day`
- 异常类型区分：网络错误 → 重试当前 provider；API 错误 (401/429) → 降级到下一个

### 2.2 批量分析

**目标**: 每天收盘后批量分析所有当日触发的信号，减少 API 调用延迟

**方案**: APScheduler Job + asyncio.gather

**实现**:
- `backend/app/services/batch_ai_service.py`
- 调度: 每日收盘后 30 分钟 (跟随信号扫描 Job)
- 批量并发 (max 5 concurrent)
- 每条信号独立调用，失败不影响其他

**Admin 端点**:
- `POST /admin/ai/batch-analyze`: 手动触发批量分析
- `GET /admin/ai/batch-status`: 查看进度

### 2.3 AI 预计算特征 (策略消费)

**这是本 Task 与策略系统的核心解耦集成点**:

AI 不直接做交易决策。而是每天收盘后对每个标的生成预计算特征，注入策略脚本的 `df`。

**AI 预计算列**:

| 列 | 类型 | 来源 | 说明 |
|---|---|---|---|
| `ai_regime` | str | AI batch | 市场状态: "trend" / "range" / "stress" |
| `ai_risk_score` | float | AI batch | 风险评分 0-1 |
| `ai_macro_bias` | float | AI batch | 宏观偏向 -1 到 1 |
| `ai_news_sentiment` | float | AI batch | 新闻综合情绪 0-1 |
| `ai_earnings_risk` | str | AI batch | 财报风险: "low" / "medium" / "high" |

**流程**:
1. 每日定时 Job: 调用 AI → 分析每个标的 → 落库 `ai_features`
2. 策略执行时自动 JOIN `ai_features` → `df` 含 AI 列
3. 策略脚本消费:
```python
def analyze(df, params):
    # df["ai_regime"], df["ai_risk_score"], df["ai_macro_bias"] 自动可用
    safe_regime = df["ai_regime"] == "trend"
    low_risk = df["ai_risk_score"] < 0.4
    output.loc[safe_regime & low_risk, "target_position"] = 0.8
```

> **关键约束**: AI 不在脚本内实时调用，而是预计算 → 落库 → 策略消费，确保回测可复现。

### 2.4 分析缓存

**方案**: Redis 缓存 AI 分析结果

**缓存键**: `ai:signal:{signal_id}` (24h TTL)

**缓存键 (provider 结果)**: `ai:provider:{provider}:{prompt_hash}` (1h TTL)

**命中逻辑**: 请求 AI 分析时先查缓存 → 命中直接返回 → 未命中才调用 API

### 2.5 成本追踪

**新增模型**:
```python
class AICostLog(Base):
    __tablename__ = "ai_cost_logs"
    id: int (PK)
    user_id: int (FK users)
    provider: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    cost_usd: Decimal(10,6)
    endpoint: str  # "signal_analysis" / "batch_feature" / "custom"
    created_at: datetime
```

**Admin 仪表板**:
- `/admin/ai/costs`: 按 provider / user / date 的 token 消耗和费用
- 每日成本趋势图
- 超出预算告警

### 2.6 本地模型支持 (Ollama)

**目标**: 成本敏感场景下用本地 Qwen 2.5 / Llama 降本

**集成**:
- 新增 AI provider: `ollama` (base_url = `http://ollama:11434/v1`)
- 模型: `qwen2.5:7b`, `llama3.2:3b`
- Docker Compose 新增 `ollama` 服务

**权衡**:
- 本地模型质量低于云 API，适合简单信号分类
- 保持 provider 降级链: DeepSeek → OpenAI → Ollama → Template

### 2.7 自定义 Prompt 模板

**Admin 配置**: `/admin/ai/prompts`

**Prompt 变量**:
```
{symbol} {signal_type} {trigger_price} {triggered_date}
{strategy_name} {reason} {ai_context} {confidence}
```

Admin 可创建多个 prompt 模板并设置默认值。

**模型变更**:
```python
class AIPromptTemplate(Base):
    __tablename__ = "ai_prompt_templates"
    id: int (PK)
    name: str
    system_prompt: str
    user_prompt_template: str
    is_default: bool
```

**API**: `GET/POST/PATCH/DELETE /admin/ai/prompts`

---

## 3. 数据库表

| 表 | 用途 |
|---|---|
| `ai_providers` | AI 多提供商配置 |
| `ai_cost_logs` | token 消耗和费用 |
| `ai_features` | AI 预计算特征 (供策略消费) |
| `ai_prompt_templates` | 自定义 Prompt 模板 |

---

## 4. API 端点

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/admin/ai/providers` | 列出 AI 提供商 |
| POST/PATCH | `/admin/ai/providers/{id}` | 管理提供商配置 |
| POST | `/admin/ai/batch-analyze` | 触发批量分析 |
| GET | `/admin/ai/batch-status` | 批量分析进度 |
| GET | `/admin/ai/costs` | 成本统计分析 |
| GET/POST | `/admin/ai/prompts` | 自定义 Prompt 模板管理 |

---

## 5. 前端页面

| Route | 功能 |
|---|---|
| `/ai/providers` | AI 提供商管理 (多 provider 路由) |
| `/ai/costs` | AI 使用成本仪表板 |
| `/ai/prompts` | 自定义 Prompt 模板管理 |

---

## 6. 测试

- [ ] Provider 降级链: DeepSeek 失败 → OpenAI → Template
- [ ] 批量分析 10 个信号并发
- [ ] AI 预计算特征正确落库并被策略脚本消费
- [ ] 分析缓存命中时跳过 API 调用
- [ ] Ollama 本地模型可正常返回分析结果
- [ ] 成本追踪统计正确

---

## 7. 验收标准

1. 多 provider 自动降级: DeepSeek → OpenAI → Ollama → Template
2. 批量分析在收盘后 30 分钟内完成所有信号
3. AI 预计算特征 `ai_regime` / `ai_risk_score` 可在策略脚本中访问
4. Admin 可创建/编辑 Prompt 模板
5. 成本仪表板显示每日 token 消耗和费用
