# Task 12 — Phase 2 Platform Hardening & Production Readiness

> **Status**: Planning  
> **Estimated Time**: 3–4 days  
> **Depends On**: Phase 1 Complete  
> **Required By**: Task 15 (Payment), Task 17 (User-facing)  
> **参考设计文档**:
> - [phase-2.md](../design/phase-2.md) — P2-7 平台增强
> - [010-deployment-guide.md](../design/010-deployment-guide.md) — 部署指南
> - [001-preliminary-design.md](../design/001-preliminary-design.md) — 总体架构
> - [ai/context.md](../ai/context.md) — 当前文件结构和状态

---

## 1. 目标

在启动 Phase 2 功能开发前，先加固平台基础设施，确保后续开发有安全的生产级 CI/CD 和测试保障。

---

## 2. 子任务

### 2.1 CI/CD Pipeline

**GitHub Actions Workflow**:
- `.github/workflows/ci.yml`
  - `backend`: pytest + ruff lint
  - `admin`: npm run build + eslint
- `.github/workflows/deploy.yml`
  - 构建 Docker 镜像 → push 到 GitHub Container Registry
  - 通过 SSH 触发生产服务器 `docker compose pull && up -d`

**检查项**:
- [ ] CI 在 PR 上自动运行并显示 status badge
- [ ] lint 和 test 全部通过才允许 merge
- [ ] deploy workflow 需要 manual approval 或 main branch 触发

### 2.2 E2E 测试 (Playwright)

**安装**: `admin/` 下添加 Playwright

**测试覆盖**:
- [ ] 登录流程：admin 登录 → redirect to dashboard
- [ ] 回测流程：创建策略 → 运行回测 → 查看详情
- [ ] 信号流程：查看信号 → 生成 AI 分析
- [ ] 关键页面截图 (visual regression baseline)

**运行**: `npx playwright test` 或整合进 CI

### 2.3 策略脚本超时隔离

**当前风险**: 自定义 Python 脚本如果包含 `while True` 或超大历史数据回测，会在同一进程无限阻塞，导致整个后端卡死。

**方案**:
1. 在 `ScriptExecutor.run()` 加入 `signal.alarm()` 超时 (Unix) 或线程级超时
2. 默认超时 30 秒，通过 `params` 可配置
3. 超时后抛出 `ScriptTimeoutError`，回测标记为 `failed`

**实现位置**: `backend/app/services/script_executor.py`

**测试**:
- [ ] 死循环脚本触发超时并返回错误
- [ ] 正常脚本不受影响

### 2.4 策略版本快照

**当前问题**: 回测结果只记录 `config_id`，不记录当时的脚本内容和参数。如果后续修改策略，历史回测无法严格复现。

**方案**:
1. 在 `BacktestResult` 新增列：
   - `script_hash`: `sha256(script_content + json(script_params))`
   - `protocol_version`: 字符串，如 `"1.0"`
2. 回测执行时自动填入
3. Admin 面板回测详情中展示 `script_hash`

**数据库变更**:
```sql
ALTER TABLE backtest_results
  ADD COLUMN script_hash VARCHAR(64) DEFAULT NULL,
  ADD COLUMN protocol_version VARCHAR(20) DEFAULT '1.0';
```

**Alembic 迁移**: 新增 migration

### 2.5 生产 Docker Compose

**区分开发/生产配置**:
- `docker-compose.override.yml` (dev: volumes, reload, exposed ports)
- `docker-compose.prod.yml` (prod: no volumes, single port, healthchecks)

**新增**:
- Nginx 反向代理 (可选，或直接用 FastAPI + Next.js standalone)
- MySQL backup cron
- 日志输出到 stdout/stderr (适用于 Docker 日志驱动)

### 2.6 审计日志

**新增模型**:
```python
class AuditLog(Base, TimestampMixin):
    __tablename__ = "audit_log"
    id: int (PK)
    user_id: int (FK users)
    action: str       # "strategy.create" / "backtest.run" / "user.ban"
    target_type: str  # "strategy" / "backtest" / "user"
    target_id: int
    details: JSON     # 变更前后差异
    ip_address: str
```

**集成点**:
- Admin API 各端点关键操作写入 audit_log
- 管理面板新增 `/audit` 页面查看审计日志

---

## 3. 数据库表

| 表 | 用途 |
|---|---|
| `audit_log` | 操作审计日志（新增） |
| `backtest_results` | 新增 `script_hash` 和 `protocol_version` 列 |

---

## 4. API 端点

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/admin/audit` | 审计日志列表（分页/筛选） |

---

## 5. 前端页面

| Route | 功能 |
|---|---|
| `/audit` | 审计日志查看 |

---

## 6. 测试

- [ ] CI pipeline 在 GitHub Actions 通过
- [ ] Playwright E2E 至少覆盖 login + backtest 流程
- [ ] Script timeout 测试通过
- [ ] Script hash 在回测结果中正确记录
- [ ] Audit log 写入和查询通过

---

## 7. 验收标准

1. GitHub Actions CI badge 在 README 中显示绿色
2. 策略死循环不会卡死后端进程
3. 回测详情页能展示 `script_hash`
4. Admin 审计日志页可查询操作记录
5. Docker Compose 生产配置可运行
