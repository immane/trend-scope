# Trend-Scope AI 接口配置指南

## 概述

Trend-Scope 内置 AI 分析功能，可对每个交易信号自动生成结构化的分析报告。系统支持两种配置方式：

1. **环境变量配置**（`Dockerfile` / `.env`）
2. **运行时配置**（管理面板在线配置，即时生效，无需重启）

运行时配置会覆盖环境变量；留空则自动回退到环境变量值。

## 环境变量配置

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | （空） | API 密钥 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com/v1` | API 网关地址 |
| `DEEPSEEK_MODEL` | `deepseek-chat` | 模型名称 |

在 `.env` 或 `docker compose` 环境变量中设置即可。

## 运行时配置

1. 登录管理面板 → 侧边栏「AI 设置」
2. 查看当前连接信息（API 密钥已脱敏显示）
3. 修改配置：
   - **API Key**：填写你的 API 密钥，留空则使用环境变量
   - **Base URL**：API 网关地址，默认 `https://api.deepseek.com/v1`
   - **模型名称**：如 `deepseek-chat`、`deepseek-reasoner`
   - **启用开关**：控制是否启用运行时 AI 分析
4. 点击"保存配置"

配置即时生效。下次信号触发后点击"生成分析"，系统将使用你的新配置调用 AI。

## 支持的模型

系统使用 OpenAI 兼容的 API 协议，支持任何兼容的模型提供商：

| Provider | Base URL | Model Example |
|---|---|---|
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o` |
| 自托管 | 自定义 URL | 自定义 |

## AI 分析输出

AI 生成的分析为结构化 JSON，包含：

| 字段 | 说明 |
|---|---|
| `summary` | 核心摘要 |
| `reasons` | 买入/卖出原因列表 |
| `risks` | 风险提示 |
| `stop_loss` | 止损建议（价格+理由） |
| `confidence` | 置信度 |
| `disclaimer` | 免责声明 |

## 策略脚本中集成 AI

当前不推荐在策略脚本中直接调用 AI API。推荐模式：

1. 策略脚本在 `ai_context` 列中写入上下文文本
2. 信号保存时携带 `ai_context` 到 `trigger_details`
3. AI 分析服务读取上下文生成解释

详见 `docs/help/strategy-script.md` 第 5 章「AI 接入建议」。
