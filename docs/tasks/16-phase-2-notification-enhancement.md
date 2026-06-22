# Task 16 — Phase 2 Notification System Enhancement

> **Status**: Planning  
> **Estimated Time**: 4–5 days  
> **Depends On**: Task 15 (Payment — for subscriber-targeted notifications)  
> **Required By**: —  
> **参考设计文档**:
> - [phase-2.md](../design/phase-2.md) — P2-2 通知增强
> - [006-notification-system.md](../design/006-notification-system.md) — 通知系统设计
> - [007-notification.md](../research/007-notification.md) — 通知技术研究

---

## 1. 目标

在 Phase 1 邮件通知基础上扩展 Web Push、站内通知和每日/每周摘要，构建多渠道通知体系。Phase 1 已有完整的 Resend 邮件 + alert_rules + alert_logs + 去重流程。

---

## 2. 子任务

### 2.1 Web Push 通知

**方案**: OneSignal SDK 集成

**新增模型**:
```python
class PushDeviceToken(Base):
    __tablename__ = "push_device_tokens"
    id: int (PK)
    user_id: int (FK users)
    device_token: str
    platform: str  # "web" / "ios" / "android"
    is_active: bool
    created_at: datetime
```

**API**:
- `POST /notifications/push/register`: 注册设备
- `DELETE /notifications/push/unregister`: 注销设备

**触发点**: `AlertService.dispatch_signal()` 增加 push 发送分支

**前端**: Admin Shell 增加 OneSignal SDK 初始化

### 2.2 站内通知 (WebSocket)

**方案**: FastAPI WebSocket + Redis Pub/Sub

**新增模型**:
```python
class NotificationInbox(Base):
    __tablename__ = "notification_inbox"
    id: int (PK)
    user_id: int (FK users)
    title: str
    message: str
    category: str  # "signal" / "system" / "promotion"
    is_read: bool = False
    created_at: datetime
```

**WebSocket 端点**:
- `WS /notifications/ws?token=xxx`: 建立 WebSocket 连接
- 信号触发时 `AlertService` → Redis Pub/Sub → WebSocket 推送

**API**:
- `GET /notifications/inbox`: 站内通知列表
- `PATCH /notifications/inbox/{id}/read`: 标记已读

**前端**: 顶栏通知 bell icon + 未读红点 + 下拉列表

### 2.3 通知偏好

**新增模型**:
```python
class NotificationPreference(Base):
    __tablename__ = "notification_preferences"
    id: int (PK)
    user_id: int (FK users, unique)
    email_enabled: bool = True
    push_enabled: bool = True
    inbox_enabled: bool = True
    sms_enabled: bool = False
    do_not_disturb_start: time | None
    do_not_disturb_end: time | None
    digest_mode: Enum["realtime", "daily", "weekly"]
```

**API**:
- `GET/PATCH /notifications/preferences`: 用户通知偏好 CRUD

### 2.4 每日/每周摘要

**方案**: APScheduler timed job

**新增模型**:
```python
class DigestQueue(Base):
    __tablename__ = "digest_queue"
    id: int (PK)
    user_id: int (FK users)
    digest_type: str  # "daily" / "weekly"
    date_range: str  # "2026-06-22/2026-06-23"
    signals_count: int
    top_signals: JSON
    sent_at: datetime | None
```

**实现**:
- `backend/app/services/digest_service.py`: 汇总每日/每周信号 → 渲染邮件模板 → 发送
- 调度: 每日 18:00 (daily) / 每周一 08:00 (weekly)

### 2.5 通知可靠性增强

**死信队列**:
```python
class NotificationDLQ(Base):
    __tablename__ = "notification_dlq"
    id: int (PK)
    alert_log_id: int (FK alert_logs)
    channel: str  # "email" / "push" / "inbox" / "sms"
    error_message: str
    retry_count: int
    next_retry_at: datetime
```

**重试策略**: 指数退避 1m → 5m → 15m → 1h → 6h → 放弃

---

## 3. 数据库表

| 表 | 用途 |
|---|---|
| `push_device_tokens` | Web Push 设备注册 |
| `notification_inbox` | 站内通知收件箱 |
| `notification_preferences` | 用户通知偏好 |
| `digest_queue` | 摘要生成队列 |
| `notification_dlq` | 通知死信队列 |

---

## 4. API 端点

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/notifications/push/register` | 注册推送设备 |
| DELETE | `/notifications/push/unregister` | 注销设备 |
| WS | `/notifications/ws` | WebSocket 实时推送 |
| GET | `/notifications/inbox` | 站内通知列表 |
| PATCH | `/notifications/inbox/{id}/read` | 标记已读 |
| GET/PATCH | `/notifications/preferences` | 通知偏好 CRUD |

---

## 5. 前端

| 改动 | 说明 |
|---|---|
| Admin Shell 顶栏 | 通知 bell icon + 未读计数 + 下拉列表 |
| `/settings/notifications` | 用户通知偏好设置页面 |

---

## 6. 测试

- [ ] Web Push 注册/注销 API 通过
- [ ] WebSocket 连接 → 信号触发 → 站内通知送达
- [ ] 通知偏好修改后各渠道开关生效
- [ ] 每日摘要邮件正确汇总信号
- [ ] DLQ 重试机制验证

---

## 7. 验收标准

1. 信号触发后用户收到邮件 + Web Push + 站内通知
2. 关闭某渠道后不再收到该渠道通知
3. 每日摘要邮件包含当天信号汇总
4. 通知失败后自动重试
