# Trend-Scope Admin — 快速开始

本文档帮助你快速启动 Trend-Scope 并完成第一次策略回测。

## 一键启动

```bash
# 1. 克隆项目
git clone https://github.com/immane/trend-scope
cd trend-scope

# 2. 复制环境变量
cp .env.example .env

# 3. 启动全部服务（首次启动会自动执行数据库迁移和种子数据）
docker compose up -d

# 4. 访问
# 管理面板: http://localhost:3000
# API 文档:  http://localhost:8000/docs
```

首次启动后 MySQL 会自动创建 10 个标的 (SPY/QQQ/TQQQ/SOXL 等) 和一个管理员账号。

## 管理员登录

```
邮箱: admin@trend-scope.com
密码: Admin123!
```

## 同步数据

登录管理面板后，进入「数据管理」页面，点击"同步全部行情"为每个标的拉取历史日线数据。

## 创建第一个策略

1. 进入「策略管理」→「创建策略」
2. 选择策略模板（如 MA Cross 均线交叉）
3. 选择标的（如 TSLA）
4. 点击保存

## 运行第一次回测

1. 进入策略详情 → 选择策略
2. 在"运行新回测"中填入 Stock ID、选择日期区间
3. 点击"运行"
4. 切换 Tab 到"回测历史"查看结果

## 查看信号

1. 进入「Dashboard」查看全局统计
2. 进入「信号」查看触发的买卖信号
3. 点击任意信号行查看详情和 AI 分析
4. 在信号详情中点击"生成分析"触发 AI 解读

## 配置 AI

1. 进入「AI 设置」
2. 填入 DeepSeek API Key
3. 可选修改模型名称或 Base URL
4. 启用开关后信号 AI 分析即使用你的配置

AI 配置即时生效，无需重启服务。
