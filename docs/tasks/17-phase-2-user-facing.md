# Task 17 — Phase 2 User-Facing Application

> **Status**: Planning  
> **Estimated Time**: 6–8 days  
> **Depends On**: Task 15 (Payment — for subscriber-only features)  
> **Required By**: —  
> **参考设计文档**:
> - [phase-2.md](../design/phase-2.md) — P2-6 用户端功能
> - [001-preliminary-design.md](../design/001-preliminary-design.md) — 总体架构
> - [003-api-specification.md](../design/003-api-specification.md) — API 规格
> - [ai/context.md](../ai/context.md) — Phase 1 用户 API 已实现

---

## 1. 目标

Phase 1 已有完整用户 API（auth/stocks/signals/ai/alerts），本 Task 构建独立的用户端 Web 应用消费这些 API，并提供自选列表、API Key 等面向终端用户的功能。

---

## 2. 子任务

### 2.1 用户端 Web 应用

**技术选型**: Next.js 14（与 Admin 共享组件和类型定义）

**项目结构**: `frontend/` 与 `admin/` 平级

**页面路由**:

| Route | 功能 | 依赖会员 |
|---|---|---|
| `/` | Landing page | Free |
| `/login` | 登录/注册 | Free |
| `/dashboard` | 用户仪表板 | Free |
| `/stocks` | 标的列表 + K线 | Free |
| `/stocks/[id]` | K线详情 + 信号标记 | Free |
| `/signals` | 信号列表 | Free |
| `/signals/[id]` | 信号详情 + AI 分析 | Free |
| `/strategies` | 我的策略列表 | Basic+ |
| `/strategies/create` | 创建策略 | Basic+ |
| `/backtest` | 回测历史 | Basic+ |
| `/backtest/[id]` | 回测详情 | Basic+ |
| `/watchlist` | 自选列表 | Free |
| `/alerts` | 我的提醒规则 | Free |
| `/settings` | 账户设置 | Free |
| `/settings/subscription` | 订阅管理 | Free |
| `/billing` | 升级/管理订阅 | Free |

**与 Admin 共享的资源**:
- `lib/api.ts` — API 客户端
- `lib/format.ts` — 数值格式化
- `lib/sort.ts` — 日期排序
- `types/api.ts` — TypeScript 类型
- 部分 UI 组件可提取到 `packages/shared-ui/`

### 2.2 自选列表 (Watchlist)

**新增模型**:
```python
class Watchlist(Base):
    __tablename__ = "watchlists"
    id: int (PK)
    user_id: int (FK users)
    name: str
    created_at: datetime

class WatchlistItem(Base):
    __tablename__ = "watchlist_items"
    id: int (PK)
    watchlist_id: int (FK watchlists)
    stock_id: int (FK stocks)
    added_at: datetime
```

**API**:
- `GET/POST /watchlists` — 自选列表 CRUD
- `POST/DELETE /watchlists/{id}/items` — 添加/移除标的

**前端**: 自选列表页展示每个标的的现价/涨跌/迷你 sparkline

### 2.3 API Key 管理

**新增模型**:
```python
class APIKey(Base):
    __tablename__ = "api_keys"
    id: int (PK)
    user_id: int (FK users)
    name: str  # 用户自定义名称
    key_hash: str  # SHA256 hash
    key_prefix: str  # 前 8 位，用于识别
    scopes: JSON  # ["stocks:read", "signals:read", "backtest:run"]
    last_used_at: datetime | None
    expires_at: datetime | None
    is_active: bool
    created_at: datetime
```

**认证中间件**: `X-API-Key` header → 查找 `APIKey` → 验证 hash → 注入 `current_user`

**API**:
- `POST /api-keys` — 生成新 API Key（仅创建时返回完整 key）
- `GET /api-keys` — 列出所有 keys（不返回完整 key）
- `DELETE /api-keys/{id}` — 吊销 key

**前端**: `/settings/api-keys` — 管理页

### 2.4 多语言

**方案**: `next-i18next` 或 `next-intl`

**语言**: 中文 (zh) + 英文 (en)

**覆盖范围**: 至少实现导航、表单标签、提示信息的中英双语。策略脚本描述和 AI 分析保持源语言。

### 2.5 自选列表通知

**扩展 AlertRule**: 允许 `stock_id=NULL` 且 `watchlist_id=NOT NULL`

当自选列表中任一标的有符合规则的信号时触发通知。

---

## 3. 数据库表

| 表 | 用途 |
|---|---|
| `watchlists` | 自选列表 |
| `watchlist_items` | 自选列表项目 |
| `api_keys` | 第三方 API 密钥 |

---

## 4. API 端点

| 方法 | 路径 | 用途 |
|---|---|---|
| GET/POST | `/watchlists` | 自选列表 CRUD |
| POST/DELETE | `/watchlists/{id}/items` | 添加/移除标的 |
| POST | `/api-keys` | 生成 API Key |
| GET | `/api-keys` | 列出 API Keys |
| DELETE | `/api-keys/{id}` | 吊销 API Key |

---

## 5. 测试

- [ ] 用户端应用的登录/注册流程通过
- [ ] 自选列表添加/移除标的 API 通过
- [ ] API Key 认证中间件生效
- [ ] 中英双语切换各页面正常

---

## 6. 验收标准

1. 用户端应用可独立运行在 `http://localhost:3001`
2. 自选列表可添加标的并查看实时价格
3. API Key 可用于第三方程序访问 API
4. 中英双语切换功能正常
