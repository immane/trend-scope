# 009 - AI-Powered Content Generation for Stock Analysis

> **Status**: Research v1
> **Date**: 2026-06-09
> **Purpose**: 调研 AI 生成股票分析内容的方案，包括 LLM 厂商选型、Prompt 工程、数据结构化、成本控制与 Python 实现模式。

---

## 1. LLM Provider Comparison

### 1.1 主流云端 LLM 厂商

| Provider | Model | Input ($/1M tokens) | Output ($/1M tokens) | Context | JSON Mode | Financial Analysis Quality | Language |
|---|---|---|---|---|---|---|---|
| **OpenAI** | GPT-5.4 (flagship) | $2.50 | $15.00 | 270K | ✓ native | ★★★★★ | 多语言 |
| OpenAI | GPT-5.4-mini | $0.75 | $4.50 | 270K | ✓ native | ★★★★☆ | 多语言 |
| **Anthropic** | Claude Sonnet 4.6 | $3.00 | $15.00 | 1M | ✓ native | ★★★★★ | 多语言 |
| Anthropic | Claude Haiku 4.5 | $1.00 | $5.00 | 200K | ✓ native | ★★★★☆ | 多语言 |
| Anthropic | Claude Opus 4.7 | $5.00 | $25.00 | 1M | ✓ native | ★★★★★ | 多语言 |
| **Google** | Gemini 2.5 Pro | $1.25~$2.50 | $10.00~$15.00 | 1M | ✓ | ★★★★★ | 多语言 |
| Google | Gemini 2.5 Flash | $0.30 | $1.50 | 1M | ✓ | ★★★★☆ | 多语言 |
| **DeepSeek** | V4-Pro | $0.435 (cache miss) | $0.87 | 1M | ✓ | ★★★★☆ | 中/英 (+ 多语言) |
| DeepSeek | V4-Flash | $0.14 | $0.28 | 1M | ✓ | ★★★☆☆ | 中/英 |
| DeepSeek | V4-Flash (cache hit) | $0.0028 | $0.28 | 1M | ✓ | ★★★☆☆ | 中/英 |
| **Qwen (Alibaba)** | Qwen3.7-Plus | ~$0.40 | ~$1.60 | 128K~1M | ✓ | ★★★☆☆ | 中/英 (偏中文) |
| **Moonshot (Kimi)** | K2.5 | $0.60 | $3.00 | 128K | ✓ | ★★★★☆ | 中/英 (偏中文) |
| Moonshot | K2.6 | $0.95 | $4.00 | 256K | ✓ | ★★★★☆ | 中/英 (偏中文) |
| **Ollama (Local)** | Llama 3.3 70B | Free (own GPU) | Free | 128K | ✓ | ★★★☆☆ | 多语言 |
| Ollama | Mistral Large | Free (own GPU) | Free | 128K | ✓ | ★★★☆☆ | 多语言 |
| Ollama | Qwen 2.5 72B | Free (own GPU) | Free | 128K | ✓ | ★★★☆☆ | 中/英 |

> **Price accuracy note**: Prices based on official docs as of June 2026. All providers reserve the right to adjust. DeepSeek cache hit pricing is exceptionally cheap for repeated/similar prompts.

### 1.2 厂商详细评估

#### OpenAI (GPT-5.4 / GPT-5.4-mini)

- **Pros**: 最成熟的 JSON mode (structured output), 最佳金融理解力, 丰富的生态系统
- **Cons**: 价格最高, 中文金融术语偶有不准, 国内需 VPN 访问
- **Best for**: 付费用户的高级分析 (Pro 档), 英文市场分析
- **API 兼容**: 最广泛, 几乎所有 LLM 框架都支持 OpenAI-compatible 格式

#### Anthropic (Claude Sonnet 4.6 / Haiku 4.5)

- **Pros**: 1M token 超大上下文窗口 (可一次性传入大量历史K线数据), JSON mode 原生支持, 推理质量极高
- **Cons**: 价格与 OpenAI 同级, 国内访问受限, 长上下文 token 消耗快
- **Best for**: 需要长上下文 (200天K线数据 + 多指标) 的深度分析
- **Unique**: 200K 上下文可容纳完整的 `stock_prices_daily` 记录 (~500 days per stock)

#### Google (Gemini 2.5 Flash / Pro)

- **Pros**: **免费层** (Flash: 免费 tier 有 generous 日限额), 1M context, 多模态原生支持
- **Cons**: 免费层不可商用（需查最新TOS）, JSON output 不如 OpenAI/Anthropic 稳定, 国内访问需特殊配置
- **Best for**: Free tier 的基本 AI 功能, 开发测试阶段

#### DeepSeek (V4-Flash / V4-Pro)

- **Pros**: **价格极低** (V4-Flash cache hit: $0.0028/1M input!), OpenAI API 兼容格式, 中文原生优秀, 无需 VPN 即可访问 API
- **Cons**: 服务器偶尔过载 (高峰期货延迟), 金融分析质量略低于 GPT-5.4/Claude, 数据合规性待确认 (中国服务器)
- **Best for**: **推荐首选** — 中文市场的高性价比方案, Basic tier 的主力模型

#### Qwen (Alibaba Cloud)

- **Pros**: 中文模型市场领导者之一, 价格适中, 阿里云生态集成方便
- **Cons**: 金融分析能力弱于 OpenAI/Claude, 英文能力中等
- **Best for**: 纯中文市场的备选方案

#### Moonshot (Kimi)

- **Pros**: 中文理解力极强, K2.5 在中文基准上表现优异, 价格有竞争力
- **Cons**: 英文能力不及主流国际厂商, 生态较小
- **Best for**: 中文市场的高质量备选, 可替代 DeepSeek 用于中文分析

#### 本地/自托管 (Ollama + Llama 3 / Mistral / Qwen)

- **Pros**: 零 API 成本, 数据不出服务器, 无访问限制, 高可用
- **Cons**: 需要 GPU (建议 ≥24GB VRAM for 70B models), 推理速度慢, 金融知识可能过时
- **Best for**: **Free tier**: 用 Ollama 跑 Qwen 2.5 7B 提供基本的中文分析, 成本为 $0
- **Hardware**: Apple M-series (M2 Ultra / M3 Max) 可运行 70B 量级, 或云 GPU ($0.50~$2/hr)

### 1.3 推荐选型策略 (Trend-Scope 三档方案)

| Tier | Primary Model | Fallback Model | Est. Cost per Analysis |
|---|---|---|---|
| **Free** | Ollama (Qwen 2.5 7B local) | Gemini Flash (free tier) | $0.00 |
| **Basic** | DeepSeek V4-Flash | DeepSeek V4-Pro | ~$0.005 |
| **Pro** | Claude Sonnet / GPT-5.4-mini | GPT-5.4 | ~$0.02~$0.05 |

---

## 2. Prompt Engineering for Financial Analysis

### 2.1 System Prompt Design

```
You are a professional financial analyst specializing in technical analysis
of U.S. stock market ETFs and indices. Your role is to interpret technical
indicators and provide objective, data-driven analysis.

IMPORTANT RULES:
1. NEVER provide explicit "buy" or "sell" recommendations. Instead, describe
   what the signals historically indicate.
2. Always include the disclaimer: "本分析仅供参考，不构成投资建议。过去表现不代表未来收益。"
3. Ground ALL analysis in the provided data. Do NOT hallucinate prices,
   dates, or indicator values that are not in the input.
4. Express confidence as a decimal 0.0-1.0 based on signal strength,
   indicator alignment, and market context.
5. Responses MUST be in valid JSON matching the specified schema.
6. Write in the same language as the user's request (Chinese or English).
```

### 2.2 Structured Output Schema

```json
{
  "symbol": "string (e.g. SPY, QQQ)",
  "signal_type": "golden_cross | death_cross | bullish_alignment | bearish_alignment | price_breakout | custom",
  "signal_strength": "weak | moderate | strong | very_strong",
  "analysis": {
    "summary": "string (1-2 sentence overview, bilingual supported)",
    "why_buy": ["string array (3-5 bullet points)"],
    "risks": ["string array (3-5 bullet points)"],
    "stop_loss": {
      "price": "number | null",
      "percentage_down": "number | null",
      "reasoning": "string"
    },
    "targets": [
      {
        "price": "number",
        "percentage_up": "number",
        "type": "resistance | all_time_high | fibonacci | moving_average"
      }
    ],
    "confidence": "number (0.0-1.0)",
    "time_horizon": "string (e.g. 1-2 weeks, 1-3 months)"
  },
  "disclaimer": "本分析仅供参考，不构成投资建议。过去表现不代表未来收益。This is not financial advice.",
  "generated_at": "ISO 8601 datetime"
}
```

### 2.3 Full Prompt Template (Golden Cross Buy Signal)

```text
## System
{system_prompt_from_2.1}

## Stock Context
- Symbol: {symbol} ({name})
- Sector: {sector}
- Market: {market}
- Current Price: ${current_price} (as of {date})

## Technical Context
- Signal Type: golden_cross (MA{short} crossed above MA{long})
- Signal Strength: {strength} (volume confirmation: {volume_confirmed})
- MA{short} value: ${ma_short_val}
- MA{long} value: ${ma_long_val}
- RSI(14): {rsi_value}
- MACD: {macd_line} / Signal: {macd_signal} / Histogram: {macd_histogram}
- Bollinger Band: Upper ${bb_upper} / Middle ${bb_middle} / Lower ${bb_lower}
- Volume: {volume} (vs 20-day avg: {volume_ratio}x)
- Trend: {trend_description}

## Recent Price Action (Last {days} Days)
```
Date       Open    High    Low     Close   Volume
{price_table_rows}
```

## Market Context
- Sector Performance (1W): {sector_change_pct}%
- VIX: {vix_value}
- S&P 500 20-day trend: {spx_trend}
- Upcoming Events: {events_text}

## Analysis Requirements
Generate a structured analysis with:
1. Why this golden cross is significant (why_buy)
2. What risks could invalidate the signal (risks)
3. Where to set stop-loss with reasoning (stop_loss)
4. Price targets based on resistance/support levels (targets)
5. Overall confidence level (0.0-1.0)
6. Recommended time horizon

Respond ONLY with valid JSON matching the output schema. No markdown wrapper.
```

### 2.4 Few-Shot Example (Golden Cross on SPY)

```text
## Example Input
Symbol: SPY, Price: $510.50, MA20 crossed above MA60 at $508/$505
RSI: 52, Volume: 1.3x avg, VIX: 18.5

## Example Output
{
  "symbol": "SPY",
  "signal_type": "golden_cross",
  "signal_strength": "strong",
  "analysis": {
    "summary": "SPY triggered a strong golden cross with MA20 crossing above MA60 at above-average volume. The technical setup suggests bullish momentum in the 2-4 week timeframe.",
    "why_buy": [
      "MA20 ($508) crossed above MA60 ($505) with 1.3x average volume, indicating institutional participation",
      "RSI at 52 is neutral, providing ample room for upside before overbought territory (70+)",
      "Price ($510.50) holding above both moving averages confirms the bullish crossover",
      "VIX at 18.5 indicates moderate market fear — historically a favorable entry environment"
    ],
    "risks": [
      "Immediate resistance at $515 (previous swing high from 2 weeks ago)",
      "If price falls below MA20 ($508), the golden cross signal weakens significantly",
      "VIX could spike above 25 if macro data disappoints, triggering broad sell-off",
      "Volume confirmation may be a one-day anomaly — need follow-through above 1.0x avg"
    ],
    "stop_loss": {
      "price": 498.0,
      "percentage_down": 2.45,
      "reasoning": "Below MA60 ($505) and recent swing low ($500 support level)"
    },
    "targets": [
      {"price": 515.0, "percentage_up": 0.88, "type": "resistance"},
      {"price": 525.0, "percentage_up": 2.84, "type": "resistance"},
      {"price": 540.0, "percentage_up": 5.78, "type": "all_time_high"}
    ],
    "confidence": 0.72,
    "time_horizon": "2-4 weeks"
  },
  "disclaimer": "本分析仅供参考，不构成投资建议。This is not financial advice.",
  "generated_at": "2026-06-09T16:00:00Z"
}
```

### 2.5 Prompt for Death Cross (Sell Signal)

```text
## (Same structure as golden cross, but with adjusted analysis requirements)

## Analysis Requirements
Generate a structured analysis with:
1. Why this death cross should concern investors (as "why_sell" in analysis)
2. What factors could make this a false signal (risks of selling too early)
3. Where a potential bounce support level exists (instead of stop-loss, suggest "watch_levels")
4. Downside targets based on support levels
5. Overall confidence level
6. Recommended defensive actions (reduce position, hedge, wait)

## Key Differences from Buy Signal
- Frame risks as "risks of overreacting" (false death cross)
- Emphasize support levels rather than resistance
- "stop_loss" becomes "support_levels" where a bounce is possible
```

### 2.6 Risk Assessment Prompt (No Signal)

```text
## Use when no specific signal exists, but user wants risk analysis

## Analysis Requirements
1. Current risk level (low / moderate / elevated / high) with rationale
2. Key support and resistance levels
3. Technical indicator summary (RSI, MACD, Bollinger, Volume)
4. Market context impact on this specific stock
5. What signals to watch for in the next 1-2 weeks
```

### 2.7 Weekly Market Summary Prompt

```text
## Purpose: Generate weekly digest of multiple stock signals

{for each stock in watchlist}
- {symbol}: {latest_signal_or_status}, Price {current_price}, Change {weekly_change_pct}%
{end}

## Analysis Requirements
Generate a weekly summary in Chinese, including:
1. 本周重要信号一览 (3-5 key takeaways)
2. 各标的分析摘要 (1-2 lines per stock)
3. 下周关注要点 (events, levels to watch)
4. 风险提示 (market-wide risks)

Respond with:
{
  "week": "YYYY-WW",
  "title": "本周市场分析周报",
  "highlights": ["string array"],
  "stock_summaries": [{"symbol": "...", "status": "...", "analysis": "..."}],
  "next_week_focus": ["string array"],
  "risk_alert": "string",
  "disclaimer": "..."
}
```

### 2.8 Chain-of-Thought (CoT) Prompting

For complex analyses, add a CoT section to improve reasoning quality:

```text
## Thinking Process (Internal — do NOT include in output)

Before writing the analysis, think step-by-step:
1. What does the signal type historically mean for {symbol}?
2. What is the strength of the signal based on volume, indicator alignment, and timeframe?
3. What are the 3 most critical support/resistance levels visible in the price data?
4. What macro or sector factors could override this technical signal?
5. What would invalidate this signal (e.g., price closing below MA{x})?

Now write the final analysis based on this reasoning.
```

> **Note**: CoT increases token usage by 50-100% but significantly improves analysis quality. Use selectively for Pro tier or high-value signals (strong golden cross, rare signals).

---

## 3. Data Preparation for AI Analysis

### 3.1 Data Points to Feed the LLM

| Category | Data | Priority | Token Estimate |
|---|---|---|---|
| **OHLCV** | Last 20-60 trading days of open, high, low, close, volume | Required | ~800-2400 tokens |
| **Moving Averages** | MA5, MA10, MA20, MA60, MA120, MA250 values at signal date | Required | ~80 tokens |
| **Oscillators** | RSI(14), MACD line/signal/histogram, Stochastic %K/%D | Recommended | ~60 tokens |
| **Bollinger Bands** | Upper, middle, lower band values (20, 2σ) | Recommended | ~30 tokens |
| **Volume Profile** | Avg volume (20d), volume at signal × avg | Recommended | ~15 tokens |
| **Signal Details** | Type, strength, trigger date, confirm status | Required | ~30 tokens |
| **Support/Resistance** | Recent swing highs/lows, round numbers, fib levels | Recommended | ~40 tokens |
| **Market Context** | VIX, SPX trend, sector performance, upcoming FOMC/earnings | Recommended | ~50 tokens |
| **Fundamentals** | P/E, market cap, dividend yield (for ETFs) | Optional | ~30 tokens |

**Total input tokens per analysis**: ~1,100-2,700 tokens (well within all models' context windows)

### 3.2 Data Serialization Format

Use tabular format for price data (most token-efficient):

```text
## Recent Price Action (Last 30 Days)
Date       Open    High    Low     Close     Volume
2026-05-01 508.20  512.50  505.80  510.30    52.3M
2026-05-02 510.30  515.00  509.50  514.20    48.7M
...
```

Alternative: CSV-style inline (even more token-efficient):
```text
Prices (Date,Open,High,Low,Close,Volume):
05-01: 508.20,512.50,505.80,510.30,52.3M
05-02: 510.30,515.00,509.50,514.20,48.7M
```

> **Recommendation**: Use tabular with abbreviated dates — ~40 tokens/row vs ~60 for full ISO dates.

### 3.3 Token Optimization Strategies

| Strategy | Token Savings | Trade-off |
|---|---|---|
| Abbreviate dates (MM-DD vs YYYY-MM-DD) | ~15% | Slight ambiguity on year |
| Round prices to 2 decimals | ~10% | Minor precision loss |
| Use 1 char decimal indicators ($, M, K) | ~5% | Natural language friendly |
| Limit price history to 30 days | ~40% vs 60 days | May miss longer-term patterns |
| Omit Bollinger/Stochastic for Basic tier | ~10% | Less comprehensive analysis |
| Use CSV-style inline for indicator values | ~20% vs verbose format | Less readable to humans |

### 3.4 Caching Strategy

```python
# cache_key = hash(f"{symbol}:{signal_type}:{analysis_date}:{model}:{prompt_version}")
# If same stock + same signal date + same model = serve cached result
# TTL: 24 hours for standard analysis, 1 hour for real-time queries
```

---

## 4. AI Analysis Output Structure

Full output specification (see Section 2.2 for JSON schema).

### 4.1 Output Field Reference

| Field | Type | Required | Description |
|---|---|---|---|
| `symbol` | string | Yes | Stock symbol |
| `signal_type` | enum | Yes | golden_cross, death_cross, bullish_alignment, bearish_alignment, etc. |
| `signal_strength` | enum | Yes | weak / moderate / strong / very_strong |
| `analysis.summary` | string | Yes | 1-2 sentence overview |
| `analysis.why_buy` | string[] | Conditional | Required for buy signals. 3-5 bullet points |
| `analysis.risks` | string[] | Yes | 3-5 identified risk factors |
| `analysis.stop_loss.price` | number | Conditional | Suggested stop-loss price |
| `analysis.stop_loss.percentage_down` | number | Conditional | Percentage from current price |
| `analysis.stop_loss.reasoning` | string | Conditional | Why this level was chosen |
| `analysis.targets` | object[] | Conditional | Price targets with type and percentage |
| `analysis.confidence` | number | Yes | 0.0 to 1.0 |
| `analysis.time_horizon` | string | Yes | Expected holding period |
| `disclaimer` | string | Yes | Legal disclaimer text |
| `generated_at` | ISO 8601 | Yes | Generation timestamp |

### 4.2 Database Storage Mapping

The AI analysis output maps to a new database table:

```sql
-- Extends the existing analysis_signal with AI-generated content
ai_analysis_results (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    signal_id BIGINT NOT NULL REFERENCES analysis_signals(id),
    model_provider VARCHAR(50) NOT NULL,   -- 'openai', 'anthropic', 'deepseek', 'ollama'
    model_name VARCHAR(100) NOT NULL,       -- 'gpt-5.4-mini', 'deepseek-v4-flash', etc.
    prompt_version VARCHAR(20) DEFAULT 'v1',
    analysis_json JSON NOT NULL,            -- Full structured output
    input_tokens INT NOT NULL,
    output_tokens INT NOT NULL,
    cost_usd DECIMAL(10,6) NOT NULL,
    generation_time_ms INT NOT NULL,
    cached BOOLEAN DEFAULT FALSE,
    user_id BIGINT REFERENCES users(id),    -- NULL if system-generated
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_signal (signal_id),
    INDEX idx_user_date (user_id, created_at)
);
```

---

## 5. Safety & Compliance

### 5.1 Required Disclaimer

Every AI-generated analysis MUST include:

```
本分析由AI自动生成，仅供参考，不构成任何投资建议。
过去的表现不代表未来的收益。投资有风险，入市需谨慎。
在进行任何投资决策前，请咨询持牌金融顾问。

This analysis is AI-generated for informational purposes only and does not
constitute investment advice. Past performance does not guarantee future
results. All investments involve risk. Consult a licensed financial advisor
before making any investment decisions.
```

### 5.2 Regulatory Considerations

| Jurisdiction | Concern | Mitigation |
|---|---|---|
| **US (SEC)** | Investment advice without registration | Always show disclaimer; avoid explicit "buy now" language |
| **China (CSRC)** | Cross-border financial data services | DeepSeek API runs on Chinese servers → compliant; use "仅供参考" disclaimers |
| **EU (MiFID II)** | Retail investment advice regulation | Classify as "information service" not "investment advice" |
| **General** | AI hallucination of financial data | Cross-reference all LLM price claims with database values (see 5.4) |

### 5.3 Content Moderation Guardrails

```python
# Post-generation validation rules
POST_GENERATION_CHECKS = [
    "no_hallucinated_prices",      # Prices in output must match input data ±0.5%
    "disclaimer_present",          # Output must contain disclaimer text
    "confidence_range",            # 0.0 ≤ confidence ≤ 1.0
    "no_guarantees",               # Must NOT contain "guaranteed", "certain", "100%"
    "data_consistency",            # Symbol and signal_type must match input
    "reasonable_targets",          # Target prices within 30% of current price
    "language_match",              # Language must match requested locale
]
```

### 5.4 Factual Grounding Strategy

```python
def validate_ai_analysis(analysis: dict, source_data: dict) -> dict:
    """
    Cross-reference LLM output with real data to catch hallucinations.
    Returns validation results with any flagged issues.
    """
    issues = []

    # Check that mentioned prices exist in source data
    current_price = source_data["current_price"]

    for target in analysis.get("targets", []):
        if target["price"] > current_price * 1.30:  # Target >30% above current
            issues.append(f"Target price ${target['price']} exceeds 30% threshold")

    sl = analysis.get("stop_loss", {})
    if sl.get("price") and sl["price"] > current_price:
        issues.append("Stop-loss price above current price — illogical")

    # Check mentioned indicator values against source
    for indicator in ["rsi", "macd", "ma_values"]:
        if indicator in str(analysis) and indicator not in str(source_data):
            issues.append(f"LLM referenced {indicator} not in source data")

    return {"valid": len(issues) == 0, "issues": issues}
```

### 5.5 Rate Limiting per User Tier

```python
# AI analysis rate limits (per user per day)
TIER_AI_LIMITS = {
    "free":     0,    # No AI analysis
    "basic":    10,   # ~$0.05/day at DeepSeek pricing
    "pro":      50,   # ~$0.25~/day at GPT-5.4-mini pricing
    "admin":    None, # Unlimited
}
```

---

## 6. Cost Optimization Strategies

### 6.1 Estimated Cost per Analysis

| Model | Input Tokens | Output Tokens | Input Cost | Output Cost | Total |
|---|---|---|---|---|---|
| DeepSeek V4-Flash | 1,500 | 800 | $0.00021 | $0.00022 | **$0.00043** |
| DeepSeek V4-Pro | 1,500 | 800 | $0.00065 | $0.00070 | **$0.00135** |
| DeepSeek V4-Flash (cache) | 1,500 (90% cache hit) | 800 | $0.00006 | $0.00022 | **$0.00028** |
| GPT-5.4-mini | 1,500 | 800 | $0.00113 | $0.00360 | **$0.00473** |
| GPT-5.4 | 1,500 | 800 | $0.00375 | $0.01200 | **$0.01575** |
| Claude Sonnet 4.6 | 1,500 | 800 | $0.00450 | $0.01200 | **$0.01650** |
| Claude Haiku 4.5 | 1,500 | 800 | $0.00150 | $0.00400 | **$0.00550** |
| Gemini 2.5 Flash | 1,500 | 800 | $0.00045 | $0.00120 | **$0.00165** |
| Ollama (local) | — | — | $0.00 | $0.00 | **$0.00** (GPU electricity only) |

### 6.2 Monthly Cost Projection (per 100 users)

| Tier | Users | Analyses/Month/User | Model | Cost/User/Month | Total Tier Cost |
|---|---|---|---|---|---|
| Free | 60 | 0 | Ollama | $0.00 | $0.00 |
| Basic | 30 | 10 | DeepSeek V4-Flash | $0.03 | $0.90 |
| Pro | 10 | 50 | GPT-5.4-mini | $0.24 | $2.40 |
| **Total** | **100** | — | — | — | **~$3.30/month** |

At scale (10,000 users): ~$330/month for AI analysis. This is negligible compared to payment processing fees and server costs.

### 6.3 Tier-Based Model Routing

```python
TIER_MODEL_MAP = {
    "free": {
        "primary": None,                               # No AI
        "fallback": None,
    },
    "basic": {
        "primary": LLMProvider.DEEPSEEK,               # V4-Flash
        "fallback": LLMProvider.GEMINI,                # Flash (free tier)
    },
    "pro": {
        "primary": LLMProvider.ANTHROPIC,              # Claude Haiku
        "analysis_on_demand": LLMProvider.OPENAI,      # GPT-5.4-mini for deep analysis
        "fallback": LLMProvider.DEEPSEEK,              # V4-Pro
    },
}
```

### 6.4 Caching Strategy

```python
# Cache key design
CACHE_KEY_PATTERN = "ai_analysis:{symbol}:{signal_type}:{signal_date}:{model}:{prompt_hash}"

# Caching policy
CACHE_TTL = 86400          # 24h for same signal
CACHE_TTL_PREMIUM = 3600   # 1h for premium (fresher analysis)

# Invalidation triggers
CACHE_INVALIDATE_ON = [
    "new_price_data",       # New daily close invalidates cached analysis
    "signal_strength_change",  # Signal was recalculated
    "prompt_version_bump",  # Prompt template updated
]
```

### 6.5 Batch Processing Schedule

```python
# Off-peak generation (APScheduler jobs)
BATCH_SCHEDULES = {
    "daily_analysis_generation": {
        "time": "05:00 UTC",         # After market close (US), before Asia open
        "action": "Generate analysis for all new signals from the day",
        "model": "DeepSeek V4-Flash",  # Cheap batch model
        "batch_size": 10,
    },
    "premium_analysis_refresh": {
        "time": "13:00 UTC",         # Mid-day refresh for Pro users
        "action": "Regenerate with premium model for Pro-tier stocks",
        "model": "Claude Haiku 4.5",
        "batch_size": 5,
    },
}
```

### 6.6 Token Budget Tracking

```python
class TokenBudgetTracker:
    """Track and enforce per-user token/cost budgets."""

    def __init__(self, redis_client):
        self.redis = redis_client

    async def check_and_reserve(self, user_id: int, tier: str,
                                estimated_tokens: int) -> bool:
        key = f"ai_budget:{user_id}:{date.today()}"
        limit = TIER_AI_LIMITS.get(tier, 0)
        current = int(await self.redis.get(key) or 0)

        if limit is None:  # Unlimited
            return True
        if current >= limit:
            return False

        await self.redis.incr(key)
        await self.redis.expire(key, 86400)
        return True
```

---

## 7. Python Implementation Patterns

### 7.1 Multi-Provider Abstraction Layer

```python
# backend/app/services/ai/providers/base.py
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional
import time

@dataclass
class AIAnalysisRequest:
    symbol: str
    signal_type: str
    prompt: str
    system_prompt: str
    model: str
    max_tokens: int = 1500
    temperature: float = 0.3

@dataclass
class AIAnalysisResponse:
    content: dict | str
    input_tokens: int
    output_tokens: int
    cost_usd: float
    generation_time_ms: int
    model_used: str
    provider: str

class BaseLLMProvider(ABC):
    @abstractmethod
    async def generate(self, request: AIAnalysisRequest) -> AIAnalysisResponse: ...

    @abstractmethod
    async def health_check(self) -> bool: ...

    @abstractmethod
    def calculate_cost(self, input_tokens: int, output_tokens: int,
                       model: str) -> float: ...


# backend/app/services/ai/providers/openai_provider.py
from openai import AsyncOpenAI

class OpenAIProvider(BaseLLMProvider):
    PRICING = {
        "gpt-5.4":       (2.50, 15.00),
        "gpt-5.4-mini":  (0.75, 4.50),
    }

    def __init__(self, api_key: str, base_url: Optional[str] = None):
        self.client = AsyncOpenAI(api_key=api_key, base_url=base_url)

    async def generate(self, request: AIAnalysisRequest) -> AIAnalysisResponse:
        start = time.monotonic()
        response = await self.client.chat.completions.create(
            model=request.model,
            messages=[
                {"role": "system", "content": request.system_prompt},
                {"role": "user", "content": request.prompt},
            ],
            max_tokens=request.max_tokens,
            temperature=request.temperature,
            response_format={"type": "json_object"},
        )
        elapsed_ms = int((time.monotonic() - start) * 1000)

        usage = response.usage
        input_tokens = usage.prompt_tokens
        output_tokens = usage.completion_tokens
        cost = self.calculate_cost(input_tokens, output_tokens, request.model)

        import json
        content = json.loads(response.choices[0].message.content)

        return AIAnalysisResponse(
            content=content,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=cost,
            generation_time_ms=elapsed_ms,
            model_used=request.model,
            provider="openai",
        )

    def calculate_cost(self, input_tokens: int, output_tokens: int,
                       model: str) -> float:
        input_price, output_price = self.PRICING.get(model, (0, 0))
        return (input_tokens / 1_000_000) * input_price + \
               (output_tokens / 1_000_000) * output_price

    async def health_check(self) -> bool:
        try:
            await self.client.models.list()
            return True
        except Exception:
            return False


# backend/app/services/ai/providers/deepseek_provider.py
class DeepSeekProvider(OpenAIProvider):
    """DeepSeek API is OpenAI-compatible — just change base_url and pricing."""

    PRICING = {
        "deepseek-v4-flash": (0.14, 0.28),
        "deepseek-v4-pro":   (0.435, 0.87),
    }

    def __init__(self, api_key: str):
        super().__init__(
            api_key=api_key,
            base_url="https://api.deepseek.com",
        )


# backend/app/services/ai/providers/anthropic_provider.py
from anthropic import AsyncAnthropic

class AnthropicProvider(BaseLLMProvider):
    PRICING = {
        "claude-sonnet-4-6":  (3.00, 15.00),
        "claude-haiku-4-5":   (1.00, 5.00),
        "claude-opus-4-7":    (5.00, 25.00),
    }

    def __init__(self, api_key: str):
        self.client = AsyncAnthropic(api_key=api_key)

    async def generate(self, request: AIAnalysisRequest) -> AIAnalysisResponse:
        start = time.monotonic()
        response = await self.client.messages.create(
            model=request.model,
            max_tokens=request.max_tokens,
            system=request.system_prompt,
            messages=[{"role": "user", "content": request.prompt}],
        )
        elapsed_ms = int((time.monotonic() - start) * 1000)

        input_tokens = response.usage.input_tokens
        output_tokens = response.usage.output_tokens
        cost = self.calculate_cost(input_tokens, output_tokens, request.model)

        import json
        # Claude returns text; extract JSON from it
        raw = response.content[0].text
        content = json.loads(raw)

        return AIAnalysisResponse(
            content=content,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=cost,
            generation_time_ms=elapsed_ms,
            model_used=request.model,
            provider="anthropic",
        )

    def calculate_cost(self, input_tokens: int, output_tokens: int,
                       model: str) -> float:
        input_price, output_price = self.PRICING.get(model, (0, 0))
        return (input_tokens / 1_000_000) * input_price + \
               (output_tokens / 1_000_000) * output_price

    async def health_check(self) -> bool:
        try:
            await self.client.models.list()
            return True
        except Exception:
            return False


# backend/app/services/ai/providers/ollama_provider.py
from ollama import AsyncClient

class OllamaProvider(BaseLLMProvider):
    PRICING = {}  # Free — no API cost

    def __init__(self, host: str = "http://localhost:11434"):
        self.client = AsyncClient(host=host)

    async def generate(self, request: AIAnalysisRequest) -> AIAnalysisResponse:
        start = time.monotonic()

        full_prompt = f"{request.system_prompt}\n\n{request.prompt}"
        response = await self.client.generate(
            model=request.model,
            prompt=full_prompt,
            options={
                "temperature": request.temperature,
                "num_predict": request.max_tokens,
            },
            format="json",
        )
        elapsed_ms = int((time.monotonic() - start) * 1000)

        import json
        content = json.loads(response["response"])

        return AIAnalysisResponse(
            content=content,
            input_tokens=response.get("prompt_eval_count", 0),
            output_tokens=response.get("eval_count", 0),
            cost_usd=0.0,
            generation_time_ms=elapsed_ms,
            model_used=request.model,
            provider="ollama",
        )

    def calculate_cost(self, *args, **kwargs) -> float:
        return 0.0

    async def health_check(self) -> bool:
        try:
            await self.client.list()
            return True
        except Exception:
            return False
```

### 7.2 Provider Router with Fallback

```python
# backend/app/services/ai/router.py
from typing import Optional
from enum import Enum
import logging

logger = logging.getLogger(__name__)

class LLMProvider(Enum):
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    DEEPSEEK = "deepseek"
    GEMINI = "gemini"
    OLLAMA = "ollama"

class AIRouter:
    """Routes analysis requests to the appropriate provider with fallback."""

    def __init__(self, providers: dict[LLMProvider, BaseLLMProvider],
                 tier_map: dict):
        self.providers = providers
        self.tier_map = tier_map

    async def generate_analysis(
        self,
        request: AIAnalysisRequest,
        user_tier: str,
        preferred_provider: Optional[LLMProvider] = None,
    ) -> AIAnalysisResponse:
        tier_config = self.tier_map.get(user_tier, {})
        if not tier_config:
            raise ValueError(f"No AI access for tier: {user_tier}")

        # Determine provider order: preferred → tier primary → tier fallback
        providers_to_try = []
        if preferred_provider:
            providers_to_try.append(preferred_provider)
        providers_to_try.append(tier_config.get("primary"))
        if tier_config.get("fallback"):
            providers_to_try.append(tier_config["fallback"])

        last_error = None
        for provider_enum in providers_to_try:
            if provider_enum is None:
                continue
            provider = self.providers.get(provider_enum)
            if provider is None:
                continue

            try:
                healthy = await provider.health_check()
                if not healthy:
                    logger.warning(f"Provider {provider_enum} unhealthy, skipping")
                    continue

                return await provider.generate(request)
            except Exception as e:
                logger.error(f"Provider {provider_enum} failed: {e}")
                last_error = e
                continue

        raise RuntimeError(
            f"All providers failed for tier {user_tier}. Last error: {last_error}"
        )
```

### 7.3 Error Handling and Retry Logic

```python
# backend/app/services/ai/retry.py
import asyncio
from functools import wraps

def ai_retry(max_retries: int = 3, base_delay: float = 1.0):
    """Retry decorator with exponential backoff for transient LLM errors."""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            last_exception = None
            for attempt in range(max_retries + 1):
                try:
                    return await func(*args, **kwargs)
                except RateLimitError as e:
                    if attempt < max_retries:
                        delay = base_delay * (2 ** attempt)
                        logger.warning(
                            f"Rate limited, retrying in {delay}s (attempt {attempt+1}/{max_retries})"
                        )
                        await asyncio.sleep(delay)
                        last_exception = e
                    else:
                        raise
                except (ConnectionError, TimeoutError) as e:
                    if attempt < max_retries:
                        delay = base_delay * (2 ** attempt)
                        await asyncio.sleep(delay)
                        last_exception = e
                    else:
                        raise
                except Exception:
                    # Non-retryable errors (bad request, auth, etc.)
                    raise
            raise last_exception
        return wrapper
    return decorator
```

### 7.4 Streaming Response (Optional for UI)

```python
from fastapi.responses import StreamingResponse
import json

async def stream_analysis(
    provider: BaseLLMProvider,
    request: AIAnalysisRequest,
):
    """Stream AI analysis to the client for real-time UI updates."""
    async def generate():
        async for chunk in provider.stream_generate(request):
            yield f"data: {json.dumps(chunk)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )
```

### 7.5 Rate Limiting Wrapper

```python
# backend/app/services/ai/rate_limiter.py
from datetime import datetime, timedelta
import asyncio

class AIRateLimiter:
    """Token-bucket rate limiter for AI API calls."""

    def __init__(self, redis_client, tier_limits: dict):
        self.redis = redis_client
        self.tier_limits = tier_limits

    async def acquire(self, user_id: int, tier: str) -> bool:
        """Try to acquire an AI analysis slot. Returns True if allowed."""
        limit = self.tier_limits.get(tier)
        if limit is None:  # Unlimited
            return True
        if limit == 0:     # No access
            return False

        today = datetime.utcnow().strftime("%Y-%m-%d")
        key = f"ai_rate_limit:{user_id}:{today}"

        current = await self.redis.incr(key)
        if current == 1:
            await self.redis.expire(key, 86400)

        return current <= limit

    async def remaining(self, user_id: int, tier: str) -> int:
        limit = self.tier_limits.get(tier, 0)
        if limit is None:
            return -1  # Unlimited
        today = datetime.utcnow().strftime("%Y-%m-%d")
        key = f"ai_rate_limit:{user_id}:{today}"
        current = int(await self.redis.get(key) or 0)
        return max(0, limit - current)
```

### 7.6 Complete Analysis Service

```python
# backend/app/services/ai/analysis_service.py
from typing import Optional
import hashlib
import json

class AIAnalysisService:
    """High-level service that orchestrates AI analysis generation."""

    def __init__(
        self,
        router: AIRouter,
        rate_limiter: AIRateLimiter,
        cache: Redis,
        db_session_factory,
        prompt_builder: PromptBuilder,
        validator: AnalysisValidator,
    ):
        self.router = router
        self.rate_limiter = rate_limiter
        self.cache = cache
        self.db_session_factory = db_session_factory
        self.prompt_builder = prompt_builder
        self.validator = validator

    async def analyze_signal(
        self,
        user_id: int,
        signal_id: int,
        preferred_model: Optional[str] = None,
    ) -> AIAnalysisResponse:
        # 1. Check user tier and rate limit
        user = await self._get_user(user_id)
        if not await self.rate_limiter.acquire(user_id, user.tier.slug):
            raise QuotaExceededError("Daily AI analysis limit reached")

        # 2. Load signal and stock data
        signal = await self._get_signal(signal_id)
        stock = await self._get_stock(signal.stock_id)
        price_data = await self._get_recent_prices(stock.id, days=30)
        market_context = await self._get_market_context()

        # 3. Build prompt
        prompt, system_prompt = self.prompt_builder.build(
            stock=stock,
            signal=signal,
            price_data=price_data,
            market_context=market_context,
        )

        # 4. Check cache
        cache_key = self._cache_key(stock.symbol, signal, preferred_model)
        cached = await self.cache.get(cache_key)
        if cached:
            response = AIAnalysisResponse(**json.loads(cached))
            response.cached = True
            return response

        # 5. Route to provider
        request = AIAnalysisRequest(
            symbol=stock.symbol,
            signal_type=signal.signal_type,
            prompt=prompt,
            system_prompt=system_prompt,
            model=preferred_model or "auto",
            max_tokens=1500,
            temperature=0.3,
        )
        response = await self.router.generate_analysis(
            request, user.tier.slug,
        )

        # 6. Validate output
        validation = self.validator.validate(response.content, signal)
        if not validation["valid"]:
            logger.warning(f"Validation issues: {validation['issues']}")

        # 7. Add disclaimer
        response.content["disclaimer"] = DISCLAIMER_TEXT
        response.content["generated_at"] = datetime.utcnow().isoformat()

        # 8. Store result
        await self._save_result(signal_id, user_id, response)

        # 9. Cache result
        await self.cache.setex(cache_key, 86400, json.dumps(response.__dict__))

        return response

    def _cache_key(self, symbol: str, signal, model: str) -> str:
        prompt_hash = hashlib.md5(
            self.prompt_builder.version.encode()
        ).hexdigest()[:8]
        return f"ai_analysis:{symbol}:{signal.signal_type}:{signal.triggered_date}:{model}:{prompt_hash}"
```

### 7.7 Prompt Builder

```python
# backend/app/services/ai/prompt_builder.py
from datetime import datetime

class PromptBuilder:
    """Builds prompts from database data for LLM consumption."""

    version = "v1.0"

    SYSTEM_PROMPT = (
        "You are a professional financial analyst specializing in technical "
        "analysis of U.S. stock market ETFs and indices. Your role is to "
        "interpret technical indicators and provide objective, data-driven "
        "analysis.\n\n"
        "IMPORTANT RULES:\n"
        "1. NEVER provide explicit buy/sell recommendations. Describe what "
        "signals historically indicate.\n"
        "2. Always include the disclaimer in the output.\n"
        "3. Ground ALL analysis in the provided data. Do NOT hallucinate "
        "prices, dates, or indicator values.\n"
        "4. Express confidence as a decimal 0.0-1.0.\n"
        "5. Responses MUST be valid JSON matching the specified schema.\n"
        "6. Write in the same language as the user's request."
    )

    def build(self, stock, signal, price_data: list,
              market_context: dict) -> tuple[str, str]:
        """Build user prompt and return (prompt, system_prompt)."""

        # Build price table (last 30 rows)
        price_table = self._format_price_table(price_data)

        # Build indicator values
        indicators = self._format_indicators(signal)

        prompt = f"""## Stock Context
- Symbol: {stock.symbol} ({stock.name})
- Sector: {stock.sector or 'N/A'}
- Market: {stock.market}
- Current Price: {self._fmt(signal.price)} (as of {signal.triggered_date})

## Technical Context
- Signal Type: {signal.signal_type}
- Signal Strength: {signal.strength}
{indicators}

## Recent Price Action (Last {len(price_data)} Days)
```
{price_table}
```

## Market Context
- Sector Performance (1W): {market_context.get('sector_change_pct', 'N/A')}%
- VIX: {market_context.get('vix', 'N/A')}
- S&P 500 Trend: {market_context.get('spx_trend', 'N/A')}

## Analysis Requirements
Generate a structured analysis with:
1. Why this signal is significant
2. What risks could invalidate the signal
3. Where to set stop-loss with reasoning
4. Price targets based on resistance/support levels
5. Overall confidence level (0.0-1.0)
6. Recommended time horizon

Respond ONLY with valid JSON matching the output schema. No markdown wrapper."""

        return prompt, self.SYSTEM_PROMPT

    def _format_price_table(self, price_data: list) -> str:
        lines = ["Date       Open    High    Low     Close     Volume"]
        for row in price_data[-30:]:
            d = row.trade_date.strftime("%Y-%m-%d") if hasattr(row.trade_date, 'strftime') else str(row.trade_date)
            o, h, l, c, v = row.open, row.high, row.low, row.close, row.volume
            lines.append(f"{d} {o:.2f}   {h:.2f}   {l:.2f}   {c:.2f}     {v:,.0f}")
        return "\n".join(lines)

    def _format_indicators(self, signal) -> str:
        parts = []
        if signal.ma_short_val:
            parts.append(f"- MA Short: {self._fmt(signal.ma_short_val)}")
        if signal.ma_long_val:
            parts.append(f"- MA Long: {self._fmt(signal.ma_long_val)}")
        return "\n".join(parts)

    @staticmethod
    def _fmt(val) -> str:
        return f"${val:,.2f}" if isinstance(val, (int, float)) else str(val)
```

---

## 8. Alternative: Non-LLM Analysis Generation

### 8.1 Rule-Based Template System

For Free tier users (no AI budget), generate analysis using deterministic templates:

```python
# backend/app/services/analysis/template_engine.py

TEMPLATES = {
    "golden_cross_strong": {
        "summary": (
            "{symbol} 在 {trigger_date} 触发强金叉信号，"
            "MA{ma_short} 上穿 MA{ma_long}，成交量放大 {volume_ratio}x。"
            "该信号在历史上对应较高的短期上行概率。"
        ),
        "why_buy": [
            "MA{ma_short}（{ma_short_val}）上穿 MA{ma_long}（{ma_long_val}），"
            "且成交量放大至均量的 {volume_ratio} 倍，显示机构资金介入。",
            "当前价格 {current_price} 站稳均线上方，短期趋势偏多。",
            "RSI {rsi} 处于中性区间，仍有上行空间。"
        ],
        "risks": [
            "若价格跌破 MA{ma_long}（{ma_long_val}），金叉信号失效，"
            "建议严格止损。",
            "成交量放量可能仅为单日异常，需观察后续 3-5 日能否持续。",
            "宏观事件（如 FOMC 会议、CPI 数据）可能导致市场短期剧烈波动。"
        ],
        "stop_loss": {
            "price": "{stop_loss_price}",
            "percentage_down": "{stop_loss_pct}",
            "reasoning": "设置在 MA{ma_long} 下方 {buffer_pct}% 位置，"
                         "为正常回调留出空间。"
        },
        "targets": [
            {"price": "{target1_price}", "percentage_up": "{target1_pct}",
             "type": "resistance"},
            {"price": "{target2_price}", "percentage_up": "{target2_pct}",
             "type": "resistance"},
        ],
        "confidence": 0.65,
        "time_horizon": "2-4 周",
    },
    "death_cross_strong": {
        "summary": (
            "{symbol} 在 {trigger_date} 触发强死叉信号，"
            "MA{ma_short} 下穿 MA{ma_long}，成交量放大。"
            "该信号提示短期下行风险增加。"
        ),
        "risks": [
            "MA{ma_short}（{ma_short_val}）下穿 MA{ma_long}（{ma_long_val}），"
            "且成交量放大，显示卖压增强。",
            "若价格持续在 MA{ma_long} 下方运行，可能进一步下探支撑位。"
        ],
        "support_levels": [
            {"price": "{support1_price}", "type": "前低支撑"},
            {"price": "{support2_price}", "type": "MA 200 支撑"},
        ],
        "confidence": 0.60,
        "time_horizon": "1-3 周",
    },
}

class RuleBasedAnalyzer:
    """Generates structured analysis using rule-based templates.
    Zero API cost, instant results, always available."""

    def analyze(self, stock, signal, price_data, indicators) -> dict:
        template_key = f"{signal.signal_type}_{signal.strength}"
        template = TEMPLATES.get(template_key, TEMPLATES.get(signal.signal_type))

        if not template:
            return self._generic_analysis(stock, signal)

        # Compute derived values for template filling
        context = self._build_context(stock, signal, price_data, indicators)

        # Recursively fill template strings
        return self._fill_template(template, context)

    def _build_context(self, stock, signal, price_data, indicators) -> dict:
        current_price = float(signal.price)
        ma_long_val = float(signal.ma_long_val or current_price)

        # Calculate support/resistance from recent price data
        recent_high = max(float(p.high) for p in price_data[-20:])
        recent_low = min(float(p.low) for p in price_data[-20:])

        return {
            "symbol": stock.symbol,
            "trigger_date": str(signal.triggered_date),
            "ma_short": signal.ma_short or 20,
            "ma_long": signal.ma_long or 60,
            "ma_short_val": f"${signal.ma_short_val:,.2f}" if signal.ma_short_val else "N/A",
            "ma_long_val": f"${signal.ma_long_val:,.2f}" if signal.ma_long_val else "N/A",
            "current_price": f"${current_price:,.2f}",
            "volume_ratio": self._calc_volume_ratio(price_data, signal),
            "rsi": f"{indicators.get('rsi', 'N/A')}",
            "stop_loss_price": f"${ma_long_val * 0.97:,.2f}",
            "stop_loss_pct": f"{((current_price - ma_long_val * 0.97) / current_price * 100):.1f}%",
            "buffer_pct": "3",
            "target1_price": f"${recent_high:,.2f}",
            "target1_pct": f"{((recent_high - current_price) / current_price * 100):.1f}%",
            "target2_price": f"${current_price * 1.10:,.2f}",
            "target2_pct": "10.0%",
            "support1_price": f"${recent_low:,.2f}",
            "support2_price": f"${ma_long_val * 0.95:,.2f}",
        }

    def _fill_template(self, template: dict, ctx: dict) -> dict:
        """Recursively format template strings with context values."""
        if isinstance(template, str):
            return template.format(**ctx)
        elif isinstance(template, dict):
            return {k: self._fill_template(v, ctx) for k, v in template.items()}
        elif isinstance(template, list):
            return [self._fill_template(item, ctx) for item in template]
        return template

    def _calc_volume_ratio(self, price_data, signal) -> str:
        if len(price_data) < 21:
            return "N/A"
        avg_vol = sum(float(p.volume) for p in price_data[-21:-1]) / 20
        last_vol = float(price_data[-1].volume)
        return f"{last_vol / avg_vol:.1f}"

    def _generic_analysis(self, stock, signal) -> dict:
        """Fallback for signal types without specific templates."""
        return {
            "symbol": stock.symbol,
            "signal_type": signal.signal_type,
            "signal_strength": signal.strength,
            "analysis": {
                "summary": f"{stock.symbol} 触发 {signal.signal_type} 信号，强度为 {signal.strength}。",
                "why_buy": ["请升级会员以获取 AI 详细分析。"],
                "risks": ["请升级会员以获取 AI 风险评估。"],
                "stop_loss": {"price": None, "percentage_down": None, "reasoning": ""},
                "targets": [],
                "confidence": 0.5,
                "time_horizon": "N/A",
            },
            "disclaimer": DISCLAIMER_TEXT,
            "generated_at": datetime.utcnow().isoformat(),
        }
```

### 8.2 Hybrid Approach (Recommended)

| Tier | Method | Model | Cost |
|---|---|---|---|
| **Free** | Rule-based templates (always available, instant) | N/A | $0.00 |
| **Basic** | DeepSeek V4-Flash for signal analysis, templates for risk-only | DeepSeek API | ~$0.005/analysis |
| **Pro** | Full LLM analysis (Claude Haiku / GPT-5.4-mini) | Best available | ~$0.02/analysis |

The template engine also serves as a fallback when all LLM providers are unavailable.

---

## 9. Provider Configuration

```python
# backend/app/core/config.py (additions)

class AISettings(BaseSettings):
    # Multi-provider API keys
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    deepseek_api_key: str = ""
    gemini_api_key: str = ""

    # Ollama (local)
    ollama_host: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5:7b"  # For free tier

    # Feature flags
    ai_analysis_enabled: bool = True

    # Tier → model mapping
    ai_tier_primary_model: dict = {
        "free": None,
        "basic": "deepseek-v4-flash",
        "pro": "claude-haiku-4-5",
    }
    ai_tier_fallback_model: dict = {
        "free": None,
        "basic": "gemini-2.5-flash",
        "pro": "deepseek-v4-pro",
    }

    # Rate limits (analyses per user per day)
    ai_daily_limit_free: int = 0
    ai_daily_limit_basic: int = 10
    ai_daily_limit_pro: int = 50

    # Cost controls
    ai_max_cost_per_analysis_usd: float = 0.05
    ai_monthly_cost_budget_usd: float = 100.0

    # Caching
    ai_cache_ttl_seconds: int = 86400

    model_config = SettingsConfigDict(env_prefix="AI_")
```

---

## 10. Decision Summary

| Decision | Choice | Rationale |
|---|---|---|
| **Primary LLM** | DeepSeek V4-Flash | Cheapest ($0.14/$0.28 per 1M), OpenAI-compatible, excellent Chinese |
| **Pro LLM** | Claude Haiku 4.5 / GPT-5.4-mini | Best quality-to-cost ratio for financial analysis |
| **Free Tier AI** | Ollama (Qwen 2.5 7B) or rule-based | Zero API cost, acceptable Chinese quality |
| **Fallback Strategy** | 3-tier: primary → fallback → rule-based template | Graceful degradation, 100% uptime |
| **Output Format** | JSON with strict schema | Consistent parsing, DB-friendly storage |
| **Cost Control** | Per-tier daily limits + budget caps | Predictable costs at scale |
| **Compliance** | Mandatory disclaimer, no-explicit-buy language | Risk mitigation across jurisdictions |
| **Caching** | signal_date + symbol + model hash, 24h TTL | Eliminates duplicate API costs |
| **Batch Processing** | Off-peak (05:00 UTC) daily generation | Lower latency for users, cheaper if using batch API |

---

## 11. References

- [OpenAI API Pricing](https://openai.com/api/pricing/)
- [Anthropic Claude Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [Google Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [DeepSeek API Pricing](https://api-docs.deepseek.com/quick_start/pricing)
- [Alibaba Cloud Model Studio Pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing)
- [Kimi (Moonshot) API Platform](https://platform.kimi.ai/)
- [Ollama — Local LLM Runner](https://ollama.com/)
- [OpenAI Structured Outputs Guide](https://platform.openai.com/docs/guides/structured-outputs)
- [Anthropic JSON Mode](https://docs.anthropic.com/en/docs/build-with-claude/tool-use)

---

## 12. Change Log

| Version | Date | Change |
|---|---|---|
| v1 | 2026-06-09 | 初稿: LLM厂商对比、Prompt工程、数据准备、输出结构、安全合规、成本优化、Python实现、规则引擎替代方案 |
