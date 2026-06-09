# 008 — AI Analysis System Design

> **Status**: Draft v1
> **Date**: 2026-06-09
> **Purpose**: Comprehensive production design for the multi-provider LLM analysis system. Covers provider abstraction, model routing with fallback, prompt engineering, safety validation, caching, rate limiting, cost control, and complete Python implementations.
>
> **References**:
> - [001-preliminary-design.md](./001-preliminary-design.md) — architecture overview & tier system
> - [002-database-schema.md](./002-database-schema.md) — `ai_analysis_results` table DDL
> - [003-api-specification.md](./003-api-specification.md) — `/analysis/{stock_id}/ai` endpoint
> - [009-ai-analysis.md](../research/009-ai-analysis.md) — provider research & cost analysis

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Provider Abstraction Layer](#2-provider-abstraction-layer)
3. [Model Router](#3-model-router)
4. [Prompt Engineering](#4-prompt-engineering)
5. [Output Structure](#5-output-structure)
6. [Safety & Validation](#6-safety--validation)
7. [Caching Strategy](#7-caching-strategy)
8. [Rate Limiting & Cost Control](#8-rate-limiting--cost-control)
9. [RuleBasedAnalyzer (Free Tier)](#9-rulebasedanalyzer-free-tier)
10. [AIAnalysisService (Main Orchestrator)](#10-aianalysisservice-main-orchestrator)
11. [Admin Monitoring](#11-admin-monitoring)
12. [Cost Projections](#12-cost-projections)

---

## 1. Architecture Overview

### 1.1 Multi-Provider LLM Routing with Fallback Chain

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          AIAnalysisService                                   │
│                                                                              │
│  analyze_signal(user_id, signal_id) → AIAnalysisResult                      │
│                                                                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌───────┐ │
│  │ 1. Cache │───▶│ 2. Rate  │───▶│ 3. Route │───▶│ 4. Gen   │───▶│5. Val │ │
│  │   Check  │    │   Limit  │    │   (AIR)  │    │  (LLM)   │    │ idate │ │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘    └───────┘ │
│       │                                │                                  │   │
│       │ HIT → return cached            ▼                                  │   │
│       ▼                          ┌──────────────────┐                    │   │
│  ┌──────────┐                    │    AIRouter       │                    │   │
│  │  Redis   │                    │                   │                    │   │
│  │ ai_anal: │                    │  route(tier) →    │                    │   │
│  │ {sym}:   │                    │   ProviderChain   │                    │   │
│  │ {sig}:   │                    │                   │                    │   │
│  │ {date}:  │                    │  ┌─────────────┐  │   ┌────────────┐  │   │
│  │ {model}: │                    │  │ Free Tier   │  │   │ RuleBased  │  │   │
│  │ {hash}   │                    │  │   → none    │──┼──▶│ Analyzer   │  │   │
│  └──────────┘                    │  └─────────────┘  │   └────────────┘  │   │
│                                  │                    │                   │   │
│  ┌──────────┐    ┌─────────┐     │  ┌─────────────┐  │   ┌────────────┐  │   │
│  │ 6. Store │◀───│ 7. Save │     │  │ Basic Tier  │  │   │ DeepSeek   │  │   │
│  │   to DB  │    │  Cache  │     │  │ DS Flash →  │──┼──▶│ V4-Flash   │  │   │
│  └──────────┘    └─────────┘     │  │ Gemini →    │  │   │ (API $0.14 │  │   │
│       │                          │  │ RuleBased   │  │   │  /1M tok)  │  │   │
│       ▼                          │  └─────────────┘  │   └────────────┘  │   │
│  ┌──────────┐                    │        │           │        │           │   │
│  │ ai_anal  │                    │        │ FAIL      │        │ FAIL      │   │
│  │ ysis_re  │                    │        ▼           │        ▼           │   │
│  │ sults    │                    │  ┌─────────────┐  │   ┌────────────┐  │   │
│  └──────────┘                    │  │ Fallback #1 │  │   │ Gemini     │  │   │
│                                  │  │ Gemini Flash│──┼──▶│ 2.5 Flash  │  │   │
│                                  │  └─────────────┘  │   └────────────┘  │   │
│                                  │        │           │        │           │   │
│                                  │        │ FAIL      │        │ FAIL      │   │
│                                  │        ▼           │        ▼           │   │
│                                  │  ┌─────────────┐  │   ┌────────────┐  │   │
│                                  │  │ Fallback #2 │  │   │ RuleBased  │  │   │
│                                  │  │ RuleBased   │──┼──▶│ Analyzer   │  │   │
│                                  │  └─────────────┘  │   │ (always OK)│  │   │
│                                  │                    │   └────────────┘  │   │
│                                  │  ┌─────────────┐  │                   │   │
│                                  │  │ Pro Tier    │  │   ┌────────────┐  │   │
│                                  │  │ Claude →    │  │   │ Claude     │  │   │
│                                  │  │ DS Pro →    │──┼──▶│ Haiku 4.5  │  │   │
│                                  │  │ GPT →       │  │   │ ($1/$5     │  │   │
│                                  │  │ RuleBased   │  │   │  /1M tok)  │  │   │
│                                  │  └─────────────┘  │   └────────────┘  │   │
│                                  └──────────────────┘                    │   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Data Flow Sequence

```
User Request                    AIAnalysisService                    LLM Providers
    │                                │                                    │
    │ POST /analysis/{id}/ai         │                                    │
    │──────────────────────────────▶│                                    │
    │                                │                                    │
    │                                │── 1. Load user tier + rate limit   │
    │                                │── 2. Load signal + stock + prices  │
    │                                │── 3. Check Redis cache             │
    │                                │   ├─ HIT → return cached JSON      │
    │                                │   └─ MISS ↓                        │
    │                                │── 4. Build prompt (PromptBuilder)  │
    │                                │── 5. AIRouter.route(tier)          │
    │                                │── 6. health_check() each provider  │
    │                                │                                    │
    │                                │── 7a. Try primary provider ───────▶│
    │                                │   ◀──────── success ───────────────│
    │                                │                                    │
    │                                │── OR ──                            │
    │                                │── 7b. Primary fails (timeout/err)─▶│
    │                                │── 7c. Try fallback #1 ────────────▶│
    │                                │   ◀──────── success ───────────────│
    │                                │                                    │
    │                                │── OR ──                            │
    │                                │── 7d. All LLMs fail ──────────────▶│
    │                                │── 7e. RuleBasedAnalyzer (template)  │
    │                                │                                    │
    │                                │── 8. Post-generation validator     │
    │                                │   (7 checks + factual grounding)   │
    │                                │── 9. Store to ai_analysis_results  │
    │                                │── 10. Set Redis cache (24h TTL)    │
    │                                │── 11. Track cost to Redis budget   │
    │                                │                                    │
    │  ◀────── AIAnalysisResponse ───│                                    │
    │                                │                                    │
```

### 1.3 Provider Timeout Strategy

| Provider Type | Timeout | Rationale |
|---|---|---|
| Cloud API (OpenAI, DeepSeek, Anthropic, Gemini) | **5 seconds** | Normal response < 2s; 5s covers network latency + retries |
| Local (Ollama) | **30 seconds** | On-device inference with 7B model on CPU/GPU |
| RuleBasedAnalyzer | **< 10ms** | Template string formatting only |

---

## 2. Provider Abstraction Layer

### 2.1 Base Class

```python
# backend/app/services/ai_providers/base.py

from __future__ import annotations

import hashlib
import json
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

import orjson


@dataclass(slots=True)
class AIAnalysisResult:
    """Canonical result from any LLM provider or rule-based analyzer."""

    symbol: str
    signal_type: str
    signal_strength: str
    analysis: dict[str, Any]
    disclaimer: str
    generated_at: str

    # Provider metadata
    provider: str       # "openai" | "deepseek" | "anthropic" | "ollama" | "rule_based"
    model_name: str     # e.g. "gpt-5.4-mini", "deepseek-v4-flash"
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    generation_time_ms: int = 0
    cached: bool = False

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens


@dataclass(slots=True)
class AIRequest:
    """Input for a single analysis generation."""

    symbol: str
    signal_type: str
    prompt: str
    system_prompt: str
    json_schema: dict[str, Any]
    model: str = "auto"
    max_tokens: int = 1500
    temperature: float = 0.3
    locale: str = "en"

    def prompt_hash(self) -> str:
        """Stable hash of prompt content for caching."""
        payload = f"{self.prompt}|{self.system_prompt}|{self.signal_type}"
        return hashlib.sha256(payload.encode()).hexdigest()[:16]


class BaseLLMProvider(ABC):
    """Abstract base for all LLM providers — cloud and local."""

    @abstractmethod
    async def generate(
        self,
        prompt: str,
        system: str,
        json_schema: dict[str, Any],
        model: str = "",
        max_tokens: int = 1500,
        temperature: float = 0.3,
    ) -> AIAnalysisResult:
        """Generate a structured analysis from the LLM."""
        ...

    @abstractmethod
    async def health_check(self) -> bool:
        """Returns True if the provider is reachable and functional."""
        ...

    @property
    @abstractmethod
    def cost_per_1k_tokens(self) -> tuple[float, float]:
        """Return (input_cost_per_1k_tokens, output_cost_per_1k_tokens) in USD."""
        ...

    # ------------------------------------------------------------------
    # Shared utilities
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_json_response(raw: str) -> dict[str, Any]:
        """Robust JSON extraction from LLM output that may contain markdown fences."""
        text = raw.strip()
        if text.startswith("```"):
            fence_end = text.find("\n")
            if fence_end != -1:
                text = text[fence_end + 1:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()
        return orjson.loads(text)

    @staticmethod
    def _elapsed_ms(start: float) -> int:
        return int((time.monotonic() - start) * 1000)

    def _calc_cost(self, input_tokens: int, output_tokens: int) -> float:
        inp_price, out_price = self.cost_per_1k_tokens
        return (input_tokens / 1000) * inp_price + (output_tokens / 1000) * out_price
```

### 2.2 OpenAI Provider

```python
# backend/app/services/ai_providers/openai_provider.py

from __future__ import annotations

import time
from typing import Any

from openai import AsyncOpenAI
from openai.types.chat import ChatCompletion

from backend.app.services.ai_providers.base import AIAnalysisResult, BaseLLMProvider


class OpenAIProvider(BaseLLMProvider):
    """OpenAI GPT models via native OpenAI SDK.

    Models: gpt-5.4-mini, gpt-5.4
    JSON mode: native response_format={"type": "json_object"}

    Pricing per 1K tokens (input, output):
      - gpt-5.4-mini:  ($0.00075, $0.00450)
      - gpt-5.4:       ($0.00250, $0.01500)

    Source: https://openai.com/api/pricing/
    """

    PRICING: dict[str, tuple[float, float]] = {
        "gpt-5.4-mini": (0.00075, 0.00450),
        "gpt-5.4":      (0.00250, 0.01500),
    }

    DEFAULT_MODEL = "gpt-5.4-mini"
    PROVIDER_NAME = "openai"

    def __init__(self, api_key: str, base_url: str | None = None) -> None:
        self.client = AsyncOpenAI(api_key=api_key, base_url=base_url)

    # ------------------------------------------------------------------
    # BaseLLMProvider interface
    # ------------------------------------------------------------------

    async def generate(
        self,
        prompt: str,
        system: str,
        json_schema: dict[str, Any],
        model: str = "",
        max_tokens: int = 1500,
        temperature: float = 0.3,
    ) -> AIAnalysisResult:
        model_name = model or self.DEFAULT_MODEL
        start = time.monotonic()

        response: ChatCompletion = await self.client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            max_tokens=max_tokens,
            temperature=temperature,
            response_format={"type": "json_object"},
        )

        elapsed = self._elapsed_ms(start)
        usage = response.usage
        input_tokens = usage.prompt_tokens if usage else 0
        output_tokens = usage.completion_tokens if usage else 0

        content_raw = response.choices[0].message.content or "{}"
        parsed = self._parse_json_response(content_raw)

        inp_price, out_price = self.PRICING.get(
            model_name, self.PRICING[self.DEFAULT_MODEL]
        )

        return AIAnalysisResult(
            symbol=parsed.get("symbol", ""),
            signal_type=parsed.get("signal_type", ""),
            signal_strength=parsed.get("signal_strength", "normal"),
            analysis=parsed.get("analysis", {}),
            disclaimer=parsed.get("disclaimer", ""),
            generated_at=parsed.get("generated_at", ""),
            provider=self.PROVIDER_NAME,
            model_name=model_name,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=(input_tokens / 1000) * inp_price + (output_tokens / 1000) * out_price,
            generation_time_ms=elapsed,
        )

    async def health_check(self) -> bool:
        try:
            await self.client.models.list()
            return True
        except Exception:
            return False

    @property
    def cost_per_1k_tokens(self) -> tuple[float, float]:
        return self.PRICING[self.DEFAULT_MODEL]
```

### 2.3 DeepSeek Provider

```python
# backend/app/services/ai_providers/deepseek_provider.py

from __future__ import annotations

import time
from typing import Any

from openai import AsyncOpenAI

from backend.app.services.ai_providers.base import AIAnalysisResult, BaseLLMProvider


class DeepSeekProvider(BaseLLMProvider):
    """DeepSeek V4 models — OpenAI-compatible API at different base_url.

    Models: deepseek-v4-flash, deepseek-v4-pro

    Pricing per 1K tokens (input, output):
      - deepseek-v4-flash:  ($0.00014, $0.00028)
      - deepseek-v4-pro:    ($0.000435, $0.00087)

    API docs: https://api-docs.deepseek.com/

    DeepSeek supports context caching — cache-hit input pricing is
    even lower ($0.000028/1K). The SDK does not expose this yet, so
    we use standard pricing and track actual usage.
    """

    PRICING: dict[str, tuple[float, float]] = {
        "deepseek-v4-flash": (0.00014, 0.00028),
        "deepseek-v4-pro":   (0.000435, 0.00087),
    }

    DEFAULT_MODEL = "deepseek-v4-flash"
    PROVIDER_NAME = "deepseek"
    BASE_URL = "https://api.deepseek.com"

    def __init__(self, api_key: str) -> None:
        self.client = AsyncOpenAI(api_key=api_key, base_url=self.BASE_URL)

    # ------------------------------------------------------------------
    # BaseLLMProvider interface
    # ------------------------------------------------------------------

    async def generate(
        self,
        prompt: str,
        system: str,
        json_schema: dict[str, Any],
        model: str = "",
        max_tokens: int = 1500,
        temperature: float = 0.3,
    ) -> AIAnalysisResult:
        model_name = model or self.DEFAULT_MODEL
        start = time.monotonic()

        response = await self.client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            max_tokens=max_tokens,
            temperature=temperature,
            response_format={"type": "json_object"},
        )

        elapsed = self._elapsed_ms(start)
        usage = response.usage
        input_tokens = usage.prompt_tokens if usage else 0
        output_tokens = usage.completion_tokens if usage else 0

        content_raw = response.choices[0].message.content or "{}"
        parsed = self._parse_json_response(content_raw)

        inp_price, out_price = self.PRICING.get(
            model_name, self.PRICING[self.DEFAULT_MODEL]
        )

        return AIAnalysisResult(
            symbol=parsed.get("symbol", ""),
            signal_type=parsed.get("signal_type", ""),
            signal_strength=parsed.get("signal_strength", "normal"),
            analysis=parsed.get("analysis", {}),
            disclaimer=parsed.get("disclaimer", ""),
            generated_at=parsed.get("generated_at", ""),
            provider=self.PROVIDER_NAME,
            model_name=model_name,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=(input_tokens / 1000) * inp_price + (output_tokens / 1000) * out_price,
            generation_time_ms=elapsed,
        )

    async def health_check(self) -> bool:
        try:
            await self.client.models.list()
            return True
        except Exception:
            return False

    @property
    def cost_per_1k_tokens(self) -> tuple[float, float]:
        return self.PRICING[self.DEFAULT_MODEL]
```

### 2.4 Anthropic Provider

```python
# backend/app/services/ai_providers/anthropic_provider.py

from __future__ import annotations

import json
import time
from typing import Any

from anthropic import AsyncAnthropic

from backend.app.services.ai_providers.base import AIAnalysisResult, BaseLLMProvider


class AnthropicProvider(BaseLLMProvider):
    """Anthropic Claude models via native Anthropic SDK.

    Models: claude-haiku-4-5, claude-sonnet-4-6

    Pricing per 1K tokens (input, output):
      - claude-haiku-4-5:  ($0.00100, $0.00500)
      - claude-sonnet-4-6: ($0.00300, $0.01500)

    Source: https://docs.anthropic.com/en/docs/about-claude/pricing

    Note: Claude API uses `system` parameter separately from messages.
    It returns text (not native JSON), so we parse manually.
    """

    PRICING: dict[str, tuple[float, float]] = {
        "claude-haiku-4-5":  (0.00100, 0.00500),
        "claude-sonnet-4-6": (0.00300, 0.01500),
    }

    DEFAULT_MODEL = "claude-haiku-4-5"
    PROVIDER_NAME = "anthropic"

    def __init__(self, api_key: str) -> None:
        self.client = AsyncAnthropic(api_key=api_key)

    # ------------------------------------------------------------------
    # BaseLLMProvider interface
    # ------------------------------------------------------------------

    async def generate(
        self,
        prompt: str,
        system: str,
        json_schema: dict[str, Any],
        model: str = "",
        max_tokens: int = 1500,
        temperature: float = 0.3,
    ) -> AIAnalysisResult:
        model_name = model or self.DEFAULT_MODEL

        # Embed JSON schema instruction into system prompt
        schema_instruction = (
            f"\n\nYou MUST respond with a single JSON object matching this schema. "
            f"No markdown, no explanation outside the JSON.\n"
            f"Schema: {json.dumps(json_schema)}"
        )
        full_system = system + schema_instruction

        start = time.monotonic()

        response = await self.client.messages.create(
            model=model_name,
            max_tokens=max_tokens,
            temperature=temperature,
            system=full_system,
            messages=[{"role": "user", "content": prompt}],
        )

        elapsed = self._elapsed_ms(start)
        input_tokens = response.usage.input_tokens
        output_tokens = response.usage.output_tokens
        raw_text = response.content[0].text

        parsed = self._parse_json_response(raw_text)

        inp_price, out_price = self.PRICING.get(
            model_name, self.PRICING[self.DEFAULT_MODEL]
        )

        return AIAnalysisResult(
            symbol=parsed.get("symbol", ""),
            signal_type=parsed.get("signal_type", ""),
            signal_strength=parsed.get("signal_strength", "normal"),
            analysis=parsed.get("analysis", {}),
            disclaimer=parsed.get("disclaimer", ""),
            generated_at=parsed.get("generated_at", ""),
            provider=self.PROVIDER_NAME,
            model_name=model_name,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=(input_tokens / 1000) * inp_price + (output_tokens / 1000) * out_price,
            generation_time_ms=elapsed,
        )

    async def health_check(self) -> bool:
        try:
            await self.client.models.list(limit=1)
            return True
        except Exception:
            return False

    @property
    def cost_per_1k_tokens(self) -> tuple[float, float]:
        return self.PRICING[self.DEFAULT_MODEL]
```

### 2.5 Ollama (Local) Provider

```python
# backend/app/services/ai_providers/ollama_provider.py

from __future__ import annotations

import json
import time
from typing import Any

import httpx

from backend.app.services.ai_providers.base import AIAnalysisResult, BaseLLMProvider


class OllamaProvider(BaseLLMProvider):
    """Local LLM via Ollama REST API.

    Models: qwen2.5:7b, llama3.3:latest, mistral:latest

    Pricing: $0.00 (local GPU/CPU only; electricity not tracked).

    Ollama API docs: https://github.com/ollama/ollama/blob/main/docs/api.md

    Note: Ollama's `format: "json"` mode uses grammars to constrain output.
    Reliability is lower than cloud providers — the RuleBasedAnalyzer
    serves as the ultimate fallback.
    """

    PRICING: dict[str, tuple[float, float]] = {
        "qwen2.5:7b":      (0.0, 0.0),
        "llama3.3:latest": (0.0, 0.0),
        "mistral:latest":  (0.0, 0.0),
    }

    DEFAULT_MODEL = "qwen2.5:7b"
    PROVIDER_NAME = "ollama"

    def __init__(self, host: str = "http://localhost:11434", timeout: float = 30.0) -> None:
        self._base_url = host.rstrip("/")
        self._timeout = timeout
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self._base_url,
                timeout=httpx.Timeout(self._timeout),
            )
        return self._client

    # ------------------------------------------------------------------
    # BaseLLMProvider interface
    # ------------------------------------------------------------------

    async def generate(
        self,
        prompt: str,
        system: str,
        json_schema: dict[str, Any],
        model: str = "",
        max_tokens: int = 1500,
        temperature: float = 0.3,
    ) -> AIAnalysisResult:
        model_name = model or self.DEFAULT_MODEL
        start = time.monotonic()

        client = await self._get_client()

        payload: dict[str, Any] = {
            "model": model_name,
            "prompt": f"{system}\n\n{prompt}",
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            },
            "format": {
                "type": "object",
                "properties": json_schema.get("properties", {}),
                "required": json_schema.get("required", []),
            },
        }

        resp = await client.post("/api/generate", json=payload)
        resp.raise_for_status()
        data = resp.json()

        elapsed = self._elapsed_ms(start)

        parsed = self._parse_json_response(data.get("response", "{}"))

        return AIAnalysisResult(
            symbol=parsed.get("symbol", ""),
            signal_type=parsed.get("signal_type", ""),
            signal_strength=parsed.get("signal_strength", "normal"),
            analysis=parsed.get("analysis", {}),
            disclaimer=parsed.get("disclaimer", ""),
            generated_at=parsed.get("generated_at", ""),
            provider=self.PROVIDER_NAME,
            model_name=model_name,
            input_tokens=data.get("prompt_eval_count", 0),
            output_tokens=data.get("eval_count", 0),
            cost_usd=0.0,
            generation_time_ms=elapsed,
        )

    async def health_check(self) -> bool:
        try:
            client = await self._get_client()
            resp = await client.get("/api/tags")
            return resp.status_code == 200
        except Exception:
            return False

    @property
    def cost_per_1k_tokens(self) -> tuple[float, float]:
        return (0.0, 0.0)
```

### 2.6 Provider Factory

```python
# backend/app/services/ai_providers/factory.py

from __future__ import annotations

from typing import Any

from backend.app.services.ai_providers.anthropic_provider import AnthropicProvider
from backend.app.services.ai_providers.base import BaseLLMProvider
from backend.app.services.ai_providers.deepseek_provider import DeepSeekProvider
from backend.app.services.ai_providers.ollama_provider import OllamaProvider
from backend.app.services.ai_providers.openai_provider import OpenAIProvider


class ProviderFactory:
    """Creates and caches LLM provider instances from configuration."""

    _instances: dict[str, BaseLLMProvider] = {}

    @classmethod
    def build_all(cls, settings: Any) -> dict[str, BaseLLMProvider]:
        """Build all configured providers from app settings."""
        providers: dict[str, BaseLLMProvider] = {}

        # OpenAI
        if getattr(settings, "openai_api_key", ""):
            providers["openai"] = OpenAIProvider(api_key=settings.openai_api_key)

        # DeepSeek (OpenAI-compatible, different base_url)
        if getattr(settings, "deepseek_api_key", ""):
            providers["deepseek"] = DeepSeekProvider(api_key=settings.deepseek_api_key)

        # Anthropic
        if getattr(settings, "anthropic_api_key", ""):
            providers["anthropic"] = AnthropicProvider(api_key=settings.anthropic_api_key)

        # Ollama (local)
        ollama_host = getattr(settings, "ollama_host", "")
        if ollama_host:
            providers["ollama"] = OllamaProvider(
                host=ollama_host,
                timeout=getattr(settings, "ollama_timeout", 30.0),
            )

        cls._instances = providers
        return providers

    @classmethod
    def get(cls, provider_key: str) -> BaseLLMProvider | None:
        return cls._instances.get(provider_key)
```

---

## 3. Model Router

### 3.1 ProviderChain and Tier Configuration

```python
# backend/app/services/ai_providers/router.py

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from enum import Enum
from typing import Any

from backend.app.services.ai_providers.base import AIAnalysisResult, BaseLLMProvider

logger = logging.getLogger(__name__)


class ProviderRef(Enum):
    """Canonical provider identifiers used in tier configuration."""
    OPENAI = "openai"
    DEEPSEEK = "deepseek"
    ANTHROPIC = "anthropic"
    OLLAMA = "ollama"
    RULE_BASED = "rule_based"


@dataclass(slots=True)
class ProviderChain:
    """Ordered list of (provider_ref, model_name) pairs for failover.

    The last entry should always be ProviderRef.RULE_BASED as the
    ultimate safety net.
    """
    steps: list[tuple[ProviderRef, str]]  # [(ref, model_name), ...]
    timeout_per_step: float = 5.0
    local_timeout: float = 30.0


# ---------------------------------------------------------------------------
# Tier → ProviderChain mapping
# ---------------------------------------------------------------------------

TIER_PROVIDER_CHAINS: dict[str, ProviderChain] = {
    "free": ProviderChain(
        steps=[
            (ProviderRef.RULE_BASED, "template"),
        ],
        timeout_per_step=5.0,
    ),
    "basic": ProviderChain(
        steps=[
            (ProviderRef.DEEPSEEK, "deepseek-v4-flash"),
            (ProviderRef.OLLAMA, "qwen2.5:7b"),
            (ProviderRef.RULE_BASED, "template"),
        ],
        timeout_per_step=5.0,
        local_timeout=30.0,
    ),
    "pro": ProviderChain(
        steps=[
            (ProviderRef.ANTHROPIC, "claude-haiku-4-5"),
            (ProviderRef.DEEPSEEK, "deepseek-v4-pro"),
            (ProviderRef.OPENAI, "gpt-5.4-mini"),
            (ProviderRef.OLLAMA, "qwen2.5:7b"),
            (ProviderRef.RULE_BASED, "template"),
        ],
        timeout_per_step=5.0,
        local_timeout=30.0,
    ),
}
```

### 3.2 AIRouter Implementation

```python
# backend/app/services/ai_providers/router.py (continued)


class AIRouter:
    """Routes analysis requests through provider chains with automatic failover.

    Responsibilities:
      1. Tier-based provider chain selection
      2. Health check before attempting each provider
      3. Automatic failover on timeout, error, or unhealthy status
      4. Ultimate fallback to RuleBasedAnalyzer (always available)
    """

    def __init__(
        self,
        providers: dict[str, BaseLLMProvider],
        rule_based_analyzer: Any,
        tier_chains: dict[str, ProviderChain] | None = None,
    ) -> None:
        self._providers = providers
        self._rule_based = rule_based_analyzer
        self._tier_chains = tier_chains or TIER_PROVIDER_CHAINS
        self._health_cache: dict[str, tuple[bool, float]] = {}
        self._health_cache_ttl = 30.0

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def route(
        self, user_tier: str, preferred_model: str | None = None
    ) -> ProviderChain:
        """Return the ProviderChain for a user tier.

        If preferred_model is specified and the user tier allows it,
        insert it as the first step before the normal chain.
        """
        chain = self._tier_chains.get(user_tier)
        if chain is None:
            raise ValueError(f"Unknown tier: {user_tier}")

        if preferred_model:
            ref = self._resolve_model_ref(preferred_model)
            if ref is not None:
                new_steps = [(ref, preferred_model)] + [
                    s for s in chain.steps if s[0] != ref
                ]
                chain = ProviderChain(
                    steps=new_steps,
                    timeout_per_step=chain.timeout_per_step,
                    local_timeout=chain.local_timeout,
                )

        return chain

    async def generate_with_fallback(
        self,
        prompt: str,
        system: str,
        json_schema: dict[str, Any],
        chain: ProviderChain,
        stock_context: dict[str, Any] | None = None,
    ) -> AIAnalysisResult:
        """Attempt generation through the provider chain with automatic failover.

        For each step:
          1. Skip if provider not configured
          2. Health check (cached 30s)
          3. Generate with timeout
          4. On success → return
          5. On failure → log, proceed to next

        Final RuleBasedAnalyzer step always succeeds.
        """
        last_error: Exception | None = None

        for step_idx, (provider_ref, model_name) in enumerate(chain.steps):
            # --- Rule-based: always available, skip health check ---
            if provider_ref == ProviderRef.RULE_BASED:
                logger.info(
                    "Falling back to RuleBasedAnalyzer (step %d/%d)",
                    step_idx + 1, len(chain.steps),
                )
                try:
                    return await self._rule_based.generate(
                        prompt=prompt,
                        system=system,
                        json_schema=json_schema,
                        model=model_name,
                        stock_context=stock_context,
                    )
                except Exception as e:
                    logger.critical("RuleBasedAnalyzer failed! %s", e)
                    raise RuntimeError(
                        "All providers including RuleBasedAnalyzer failed"
                    ) from e

            # --- Cloud/Local LLM ---
            provider = self._providers.get(provider_ref.value)
            if provider is None:
                logger.debug("Provider %s not configured, skipping", provider_ref.value)
                continue

            # Health check (cached)
            healthy = await self._cached_health_check(provider_ref.value, provider)
            if not healthy:
                logger.warning("Provider %s unhealthy, skipping", provider_ref.value)
                continue

            # Timeout per provider type
            timeout = (
                chain.local_timeout
                if provider_ref == ProviderRef.OLLAMA
                else chain.timeout_per_step
            )

            try:
                result = await asyncio.wait_for(
                    provider.generate(
                        prompt=prompt,
                        system=system,
                        json_schema=json_schema,
                        model=model_name,
                    ),
                    timeout=timeout,
                )
                logger.info(
                    "Generated via %s/%s (%.0fms, $%.6f)",
                    provider_ref.value, model_name,
                    result.generation_time_ms, result.cost_usd,
                )
                return result

            except asyncio.TimeoutError:
                logger.warning(
                    "Provider %s timed out after %.0fs",
                    provider_ref.value, timeout,
                )
                last_error = asyncio.TimeoutError(f"{provider_ref.value} timeout")
            except Exception as e:
                logger.warning("Provider %s failed: %s", provider_ref.value, e)
                last_error = e

        raise RuntimeError(f"All providers exhausted. Last error: {last_error}")

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    async def _cached_health_check(
        self, provider_key: str, provider: BaseLLMProvider
    ) -> bool:
        """Health check with 30-second cache to avoid hammering APIs."""
        now = asyncio.get_running_loop().time()
        cached = self._health_cache.get(provider_key)
        if cached is not None:
            healthy, timestamp = cached
            if now - timestamp < self._health_cache_ttl:
                return healthy

        try:
            healthy = await asyncio.wait_for(provider.health_check(), timeout=3.0)
        except Exception:
            healthy = False

        self._health_cache[provider_key] = (healthy, now)
        return healthy

    def _resolve_model_ref(self, model_name: str) -> ProviderRef | None:
        """Resolve a model name to its provider reference."""
        model_lower = model_name.lower()
        if "gpt" in model_lower:
            return ProviderRef.OPENAI
        if "deepseek" in model_lower:
            return ProviderRef.DEEPSEEK
        if "claude" in model_lower:
            return ProviderRef.ANTHROPIC
        if any(x in model_lower for x in ("qwen", "llama", "mistral")):
            return ProviderRef.OLLAMA
        return None
```

---

## 4. Prompt Engineering

### 4.1 System Prompt (Financial Analyst Persona, 6 Rules)

```python
# backend/app/services/ai_providers/prompt_builder.py

from __future__ import annotations

import hashlib
from typing import Any

# ---------------------------------------------------------------------------
# System prompts — English + Chinese
# ---------------------------------------------------------------------------

SYSTEM_PROMPT_EN = """You are a professional financial analyst specializing in technical analysis of U.S. stock market ETFs and indices. Your role is to interpret technical indicators and provide objective, data-driven analysis.

IMPORTANT RULES:
1. NEVER provide explicit "buy" or "sell" recommendations. Instead, describe what the signals historically indicate and what investors should monitor.
2. Always include the disclaimer text exactly as shown in the output schema.
3. Ground ALL analysis in the provided data. Do NOT hallucinate prices, dates, or indicator values that are not in the input. If you are uncertain about a value, omit it rather than guessing.
4. Express confidence as a decimal between 0.0 and 1.0 based on: signal strength, indicator alignment (how many indicators agree), volume confirmation, and current market context (VIX, sector trend).
5. Responses MUST be valid JSON matching the specified schema exactly. No markdown wrappers, no extra text outside the JSON object.
6. Write in the same language as the user's request (Chinese or English). Match the user's locale."""

SYSTEM_PROMPT_ZH = """你是一位专注于美股指数基金技术分析的专业金融分析师。你的职责是解读技术指标，提供客观、数据驱动的分析。

重要规则：
1. 绝对不要提供明确的"买入"或"卖出"建议。而是描述该信号历史上预示什么，以及投资者应该关注哪些因素。
2. 必须在输出中包含免责声明。
3. 所有分析必须基于提供的数据。不要凭空编造价格、日期或指标值。如果不确定某个数值，宁可省略也不要猜测。
4. 置信度用 0.0 到 1.0 之间的小数表示，综合考虑：信号强度、指标一致性（有多少个指标共振）、成交量确认、当前市场环境（VIX、板块趋势）。
5. 响应必须是符合指定 JSON Schema 的有效 JSON。不要添加 markdown 标记或 JSON 之外的文字。
6. 使用与用户请求相同的语言回复（中文或英文）。"""
```

### 4.2 User Prompt Template (5 Sections)

```python
# backend/app/services/ai_providers/prompt_builder.py (continued)

# ---------------------------------------------------------------------------
# Prompt section templates
# ---------------------------------------------------------------------------

SECTION_STOCK_CONTEXT = """## Stock Context
- Symbol: {symbol} ({name})
- Type: {stock_type}
- Sector: {sector}
- Current Price: ${current_price} (as of {trade_date})"""

SECTION_TECHNICAL_CONTEXT = """## Technical Context
- Signal Type: {signal_type}
- Signal Strength: {signal_strength}
- Confidence Score: {confidence}
- Trigger Date: {triggered_date}
{indicator_lines}
- Trend Description: {trend_description}"""

SECTION_PRICE_ACTION = """## Recent Price Action (Last {days} Trading Days)
```
Date         Open      High      Low       Close     Volume
{price_table_rows}
```"""

SECTION_MARKET_CONTEXT = """## Market Context
- Benchmark ({benchmark}): {benchmark_change_pct}% (20-day)
- Sector ({sector}): {sector_change_pct}% (1-week)
- VIX: {vix_value}
- Macro Indicators: {macro_indicators}"""

SECTION_ANALYSIS_REQUIREMENTS_EN = """## Analysis Requirements
Generate a structured analysis with:
1. Summary: 1-2 sentence overview of what this signal means for {symbol}
2. why_buy (for bullish signals): 3-5 specific, data-backed reasons this signal is significant
3. risks: 3-5 specific risk factors that could invalidate this signal
4. stop_loss: Suggested stop-loss price with reasoning (based on recent support / moving averages)
5. targets: 2-3 price targets based on visible resistance levels, with type (resistance / all_time_high / fibonacci / moving_average)
6. confidence: Overall confidence level (0.0-1.0) based on signal strength + indicator alignment + market context
7. time_horizon: Expected holding period for this signal (e.g. "1-2 weeks", "2-4 weeks", "1-3 months")

Respond ONLY with valid JSON matching the output schema. No markdown wrapper."""

SECTION_ANALYSIS_REQUIREMENTS_ZH = """## 分析要求
生成结构化分析，包含：
1. summary: 用 1-2 句话说明该信号对 {symbol} 的意义
2. why_buy (看涨信号): 3-5 条基于数据的具体理由
3. risks: 3-5 条可能导致信号失效的具体风险因素
4. stop_loss: 建议止损价位及理由（基于近期支撑位/均线）
5. targets: 2-3 个基于可见阻力位的目标价位，标注类型（resistance / all_time_high / fibonacci / moving_average）
6. confidence: 综合置信度 (0.0-1.0)，基于信号强度 + 指标共振 + 市场环境
7. time_horizon: 建议持仓周期

仅输出符合 JSON Schema 的有效 JSON，不要添加 markdown 包装。"""
```

### 4.3 Few-Shot Examples

```python
# backend/app/services/ai_providers/prompt_builder.py (continued)

# ---------------------------------------------------------------------------
# Few-shot examples
# ---------------------------------------------------------------------------

FEW_SHOT_GOLDEN_CROSS_EN = """
## Example — SPY Golden Cross Analysis

### Input:
Symbol: SPY (SPDR S&P 500 ETF Trust), Price: $510.50
Signal: golden_cross (MA20 crossed above MA60 at $508/$505), Strength: strong
RSI: 52, MACD: 2.15 / Signal: 1.80, Volume: 1.3x avg
VIX: 18.5, S&P 500 20-day trend: +2.3%

### Expected Output:
{
  "symbol": "SPY",
  "signal_type": "golden_cross",
  "signal_strength": "strong",
  "analysis": {
    "summary": "SPY triggered a strong golden cross with MA20 crossing above MA60 at 1.3x average volume. The technical setup suggests bullish momentum in the 2-4 week timeframe, supported by neutral RSI and moderate VIX levels.",
    "why_buy": [
      "MA20 ($508) crossed above MA60 ($505) with 1.3x average volume, indicating institutional participation and conviction behind the move",
      "RSI at 52 is neutral, providing ample room for upside before reaching overbought territory (70+)",
      "Price ($510.50) holding above both moving averages confirms the bullish crossover validity",
      "VIX at 18.5 indicates moderate market fear — historically a favorable environment for entering trend-following positions"
    ],
    "risks": [
      "Immediate resistance at $515 (previous swing high from 2 weeks ago) could cap short-term upside",
      "If price falls below MA20 ($508), the golden cross signal weakens significantly and may be a whipsaw",
      "VIX could spike above 25 if macro data (CPI, FOMC) disappoints, triggering a broad market sell-off",
      "Volume confirmation was a single-day event — need 3-5 days of follow-through above 1.0x average"
    ],
    "stop_loss": {
      "price": 498.00,
      "pct": 2.45,
      "reasoning": "Below MA60 ($505) and recent swing low support at $500. A close below this level would invalidate the golden cross and signal a failed breakout."
    },
    "targets": [
      {"price": 515.00, "pct": 0.88, "type": "resistance"},
      {"price": 525.00, "pct": 2.84, "type": "resistance"},
      {"price": 540.00, "pct": 5.78, "type": "all_time_high"}
    ],
    "confidence": 0.72,
    "time_horizon": "2-4 weeks"
  },
  "disclaimer": "This analysis is AI-generated for informational purposes only and does not constitute investment advice. Past performance does not guarantee future results. All investments involve risk.\\n\\n本分析由AI自动生成，仅供参考，不构成任何投资建议。投资有风险，入市需谨慎。",
  "generated_at": "2026-06-09T16:00:00Z"
}
"""

FEW_SHOT_DEATH_CROSS_ZH = """
## 示例 — QQQ 死叉分析

### 输入：
标的: QQQ (Invesco QQQ Trust), 价格: $480.00
信号: death_cross (MA20 下穿 MA60 于 $485/$490), 强度: strong
RSI: 38, MACD: -1.50 / 信号线: -0.80, 成交量: 1.5x 均量
VIX: 25.3, 纳斯达克 20 日趋势: -3.1%

### 期望输出：
{
  "symbol": "QQQ",
  "signal_type": "death_cross",
  "signal_strength": "strong",
  "analysis": {
    "summary": "QQQ 触发强死叉信号，MA20 在放量情况下下穿 MA60。RSI 走弱至 38，MACD 负值扩大，短期下行压力增大。建议关注 $470 和 $455 支撑位的有效性。",
    "why_buy": [],
    "risks": [
      "成交量放大至均量 1.5 倍，显示卖压显著增强，市场参与者正在积极减仓",
      "RSI 跌至 38 且仍在下降趋势中，尚未到达超卖区域（30 以下），仍有下行空间",
      "VIX 升至 25.3，处于较高波动区间，可能引发进一步的恐慌性抛售",
      "纳斯达克整体趋势为 -3.1%，板块性回调可能放大 QQQ 的跌幅"
    ],
    "stop_loss": {
      "price": null,
      "pct": null,
      "reasoning": "此为看跌信号，不适合设定传统止损。建议关注关键支撑位的持有效果。"
    },
    "targets": [
      {"price": 470.00, "pct": -2.08, "type": "support"},
      {"price": 455.00, "pct": -5.21, "type": "support"},
      {"price": 440.00, "pct": -8.33, "type": "support"}
    ],
    "confidence": 0.68,
    "time_horizon": "1-3 weeks"
  },
  "disclaimer": "本分析由AI自动生成，仅供参考，不构成任何投资建议。过去表现不代表未来收益。投资有风险，入市需谨慎。\\n\\nThis analysis is AI-generated for informational purposes only and does not constitute investment advice.",
  "generated_at": "2026-06-09T16:00:00Z"
}
"""
```

### 4.4 Full PromptBuilder Implementation

```python
# backend/app/services/ai_providers/prompt_builder.py (continued)


class PromptBuilder:
    """Builds structured prompts from database entities for LLM consumption.

    Produces optimized prompts that are token-efficient while providing
    all context needed for quality financial analysis.
    """

    VERSION = "v2.0"

    def __init__(self, locale: str = "en") -> None:
        self.locale = locale

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def build_system_prompt(self) -> str:
        """Return the system prompt for the current locale."""
        if self.locale == "zh":
            return SYSTEM_PROMPT_ZH
        return SYSTEM_PROMPT_EN

    def build_user_prompt(
        self,
        stock: Any,
        signal: Any,
        price_data: list[Any],
        market_context: dict[str, Any],
        indicators: dict[str, Any] | None = None,
        include_few_shot: bool = True,
    ) -> str:
        """Build the full user prompt with all 5 sections.

        Args:
            stock: ORM model with symbol, name, type, sector, market fields.
            signal: ORM model with signal_type, strength, confidence, price, etc.
            price_data: List of StockPriceDaily ORM rows (most recent last).
            market_context: Dict with benchmark, benchmark_change_pct,
                            sector_change_pct, vix, macro_indicators.
            indicators: Dict of indicator_name → value for the signal date.
            include_few_shot: Whether to append a few-shot example.

        Returns:
            Complete prompt string ready for LLM consumption.
        """
        sections: list[str] = []

        # Section 1: Stock Context
        sections.append(self._build_stock_context(stock, signal))

        # Section 2: Technical Context
        sections.append(self._build_technical_context(signal, indicators))

        # Section 3: Recent Price Action
        sections.append(self._build_price_action(price_data))

        # Section 4: Market Context
        sections.append(self._build_market_context(market_context, stock))

        # Section 5: Analysis Requirements
        sections.append(self._build_analysis_requirements(stock))

        # Few-shot example
        if include_few_shot:
            sections.append(self._build_few_shot(signal))

        return "\n\n".join(sections)

    def prompt_hash(
        self, symbol: str, signal_type: str, signal_date: str
    ) -> str:
        """Compute a stable hash for caching purposes."""
        payload = f"{symbol}|{signal_type}|{signal_date}|{self.VERSION}|{self.locale}"
        return hashlib.sha256(payload.encode()).hexdigest()[:16]

    # ------------------------------------------------------------------
    # Section builders
    # ------------------------------------------------------------------

    def _build_stock_context(self, stock: Any, signal: Any) -> str:
        return SECTION_STOCK_CONTEXT.format(
            symbol=getattr(stock, "symbol", "?"),
            name=getattr(stock, "name", "?"),
            stock_type=getattr(stock, "type", "ETF"),
            sector=getattr(stock, "sector", "Broad Market"),
            current_price=f"{float(getattr(signal, 'price', 0)):,.2f}",
            trade_date=str(getattr(signal, "triggered_date", "")),
        )

    def _build_technical_context(
        self, signal: Any, indicators: dict[str, Any] | None
    ) -> str:
        lines: list[str] = []
        details = getattr(signal, "signal_details", {}) or {}

        if indicators:
            for name, value in indicators.items():
                if value is not None:
                    if isinstance(value, (int, float)):
                        lines.append(f"- {name.upper()}: {value:.2f}")
                    else:
                        lines.append(f"- {name.upper()}: {value}")
        else:
            for key in (
                "ma_short_val", "ma_long_val", "rsi14",
                "macd_line", "macd_signal", "macd_histogram",
                "bb_upper", "bb_middle", "bb_lower", "volume_ratio",
            ):
                val = details.get(key)
                if val is not None:
                    label = key.replace("_", " ").title()
                    lines.append(
                        f"- {label}: {val:.2f}"
                        if isinstance(val, (int, float))
                        else f"- {label}: {val}"
                    )

        trend_map = {
            "golden_cross": "Bullish — MA short crossed above MA long",
            "death_cross": "Bearish — MA short crossed below MA long",
            "bullish_alignment": "Bullish — MAs in ascending order",
            "bearish_alignment": "Bearish — MAs in descending order",
        }

        return SECTION_TECHNICAL_CONTEXT.format(
            signal_type=getattr(signal, "signal_type", ""),
            signal_strength=getattr(signal, "strength", "normal"),
            confidence=f"{float(getattr(signal, 'confidence', 0)):.2f}" if getattr(signal, 'confidence', None) else "N/A",
            triggered_date=str(getattr(signal, "triggered_date", "")),
            indicator_lines="\n".join(lines) if lines else "- (indicator data not available)",
            trend_description=trend_map.get(
                getattr(signal, "signal_type", ""), "Neutral — monitor for development"
            ),
        )

    def _build_price_action(self, price_data: list[Any]) -> str:
        if not price_data:
            return "## Recent Price Action\n(No price data available)"

        rows = price_data[-30:]
        lines: list[str] = []

        for row in rows:
            d = self._date_str(row, "trade_date")
            o = self._price_val(row, "open")
            h = self._price_val(row, "high")
            l = self._price_val(row, "low")
            c = self._price_val(row, "close")
            v = self._vol_str(row, "volume")
            lines.append(f"{d}  {o:>8}  {h:>8}  {l:>8}  {c:>8}  {v:>10}")

        return SECTION_PRICE_ACTION.format(
            days=len(rows),
            price_table_rows="\n".join(lines),
        )

    def _build_market_context(
        self, market_context: dict[str, Any], stock: Any
    ) -> str:
        return SECTION_MARKET_CONTEXT.format(
            benchmark=market_context.get("benchmark", "SPY"),
            benchmark_change_pct=f"{market_context.get('benchmark_change_pct', 0):+.2f}",
            sector=getattr(stock, "sector", "Broad Market"),
            sector_change_pct=f"{market_context.get('sector_change_pct', 0):+.2f}",
            vix_value=market_context.get("vix", "N/A"),
            macro_indicators=market_context.get("macro_indicators", "No notable events"),
        )

    def _build_analysis_requirements(self, stock: Any) -> str:
        symbol = getattr(stock, "symbol", "")
        if self.locale == "zh":
            return SECTION_ANALYSIS_REQUIREMENTS_ZH.format(symbol=symbol)
        return SECTION_ANALYSIS_REQUIREMENTS_EN.format(symbol=symbol)

    def _build_few_shot(self, signal: Any) -> str:
        if self.locale == "zh":
            signal_type = getattr(signal, "signal_type", "")
            if signal_type in ("death_cross", "bearish_alignment"):
                return FEW_SHOT_DEATH_CROSS_ZH
        return FEW_SHOT_GOLDEN_CROSS_EN

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _date_str(row: Any, attr: str) -> str:
        val = getattr(row, attr, None) if hasattr(row, attr) else row.get(attr, "")
        if hasattr(val, "strftime"):
            return val.strftime("%Y-%m-%d")
        return str(val)

    @staticmethod
    def _price_val(row: Any, attr: str) -> float:
        val = getattr(row, attr, None) if hasattr(row, attr) else row.get(attr, 0)
        return float(val or 0)

    @staticmethod
    def _vol_str(row: Any, attr: str) -> str:
        val = getattr(row, attr, None) if hasattr(row, attr) else row.get(attr, 0)
        v = int(val or 0)
        if v >= 1_000_000:
            return f"{v / 1_000_000:.1f}M"
        if v >= 1_000:
            return f"{v / 1_000:.0f}K"
        return str(v)
```

### 4.5 Language Variant Summary

| Section | English (`locale="en"`) | Chinese (`locale="zh"`) |
|---|---|---|
| System Prompt | Professional financial analyst, 6 rules in English | 专业金融分析师, 6 条中文规则 |
| Stock Context | Symbol, Name, Sector, Type, Price (EN labels) | 相同结构, 中文标签 |
| Technical Context | Signal, Strength, Indicators (EN) | 中文: 信号类型, 强度, 指标值 |
| Price Action | `Date` column, EN labels | Same table format, no translation needed |
| Market Context | Benchmark, Sector, VIX (EN) | 中文: 基准指数, 板块, 波动率指数 |
| Analysis Requirements | 7 numbered requirements (EN) | 7 条中文分析要求 |
| Few-Shot | SPY Golden Cross (EN) | QQQ Death Cross (中文) |
| Disclaimer | Bilingual EN + ZH | 双语 中文 + 英文 |

---

## 5. Output Structure

### 5.1 Production JSON Schema

```python
# backend/app/services/ai_providers/schema.py

OUTPUT_JSON_SCHEMA: dict = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "required": [
        "symbol", "signal_type", "signal_strength",
        "analysis", "disclaimer", "generated_at",
    ],
    "properties": {
        "symbol": {
            "type": "string",
            "minLength": 1,
            "maxLength": 20,
            "description": "Stock symbol. Must match the input symbol.",
        },
        "signal_type": {
            "type": "string",
            "enum": [
                "golden_cross", "death_cross",
                "bullish_alignment", "bearish_alignment",
                "composite_buy", "composite_sell",
            ],
        },
        "signal_strength": {
            "type": "string",
            "enum": ["weak", "normal", "strong"],
        },
        "analysis": {
            "type": "object",
            "required": ["summary", "risks", "confidence", "time_horizon"],
            "properties": {
                "summary": {
                    "type": "string",
                    "minLength": 50,
                    "maxLength": 500,
                    "description": "1-2 sentence overview.",
                },
                "why_buy": {
                    "type": "array",
                    "minItems": 0,
                    "maxItems": 5,
                    "items": {"type": "string", "minLength": 10, "maxLength": 300},
                    "description": "Reasons this signal is significant (3-5 points).",
                },
                "risks": {
                    "type": "array",
                    "minItems": 2,
                    "maxItems": 5,
                    "items": {"type": "string", "minLength": 10, "maxLength": 300},
                    "description": "Risk factors (2-5 points).",
                },
                "stop_loss": {
                    "type": "object",
                    "required": ["price", "reasoning"],
                    "properties": {
                        "price": {
                            "type": ["number", "null"],
                            "minimum": 0,
                            "description": "Stop-loss price. Null if not applicable.",
                        },
                        "pct": {
                            "type": ["number", "null"],
                            "minimum": 0,
                            "maximum": 50,
                            "description": "Percentage below current price.",
                        },
                        "reasoning": {
                            "type": "string",
                            "minLength": 10,
                            "maxLength": 300,
                        },
                    },
                },
                "targets": {
                    "type": "array",
                    "minItems": 0,
                    "maxItems": 4,
                    "items": {
                        "type": "object",
                        "required": ["price", "type"],
                        "properties": {
                            "price": {"type": "number", "minimum": 0},
                            "pct": {"type": "number"},
                            "type": {
                                "type": "string",
                                "enum": [
                                    "resistance", "all_time_high",
                                    "fibonacci", "moving_average", "support",
                                ],
                            },
                        },
                    },
                },
                "confidence": {
                    "type": "number",
                    "minimum": 0.0,
                    "maximum": 1.0,
                },
                "time_horizon": {
                    "type": "string",
                    "minLength": 3,
                    "maxLength": 50,
                    "description": "e.g. '1-2 weeks', '2-4 weeks', '1-3 months'.",
                },
            },
        },
        "disclaimer": {
            "type": "string",
            "minLength": 50,
            "maxLength": 1000,
            "description": "Legal disclaimer in English and Chinese.",
        },
        "generated_at": {
            "type": "string",
            "format": "date-time",
            "description": "ISO 8601 UTC timestamp.",
        },
    },
}
```

### 5.2 Example Output

```json
{
  "symbol": "SPY",
  "signal_type": "golden_cross",
  "signal_strength": "strong",
  "analysis": {
    "summary": "SPY triggered a strong golden cross with MA20 crossing above MA60 at 1.3x average volume. The technical setup suggests bullish momentum in the 2-4 week timeframe.",
    "why_buy": [
      "MA20 ($508) crossed above MA60 ($505) with 1.3x average volume, indicating institutional participation",
      "RSI at 52 is neutral, providing ample room for upside before overbought territory",
      "Price ($510.50) holding above both moving averages confirms bullish crossover validity"
    ],
    "risks": [
      "Immediate resistance at $515 (previous swing high) could cap short-term upside",
      "If price falls below MA20 ($508), the golden cross signal weakens significantly",
      "VIX could spike above 25 if macro data disappoints, triggering broad market sell-off"
    ],
    "stop_loss": {
      "price": 505.50,
      "pct": 3.8,
      "reasoning": "Below MA60 ($505) and recent swing low support. A close below invalidates the golden cross."
    },
    "targets": [
      {"price": 540.00, "pct": 2.9, "type": "resistance"},
      {"price": 555.00, "pct": 5.8, "type": "all_time_high"}
    ],
    "confidence": 0.75,
    "time_horizon": "2-4 weeks"
  },
  "disclaimer": "This analysis is AI-generated for informational purposes only and does not constitute investment advice. Past performance does not guarantee future results. All investments involve risk. Consult a licensed financial advisor before making any investment decisions.\n\n本分析由AI自动生成，仅供参考，不构成任何投资建议。过去表现不代表未来收益。投资有风险，入市需谨慎。",
  "generated_at": "2026-06-09T16:30:00Z"
}
```

---

## 6. Safety & Validation

### 6.1 Post-Generation Validator (7 Checks)

```python
# backend/app/services/ai_providers/validator.py

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

FORBIDDEN_PHRASES: list[str] = [
    "will definitely", "will certainly", "guaranteed", "guarantee",
    "100% sure", "100% certain", "no risk", "risk-free",
    "can't lose", "cannot lose", "sure thing", "sure bet",
    "一定会", "肯定", "绝对", "保证", "零风险", "100%确定",
    "稳赚", "必涨", "必跌", "无风险",
]


@dataclass(slots=True)
class ValidationResult:
    """Result of post-generation validation checks."""

    valid: bool
    checks_passed: int
    checks_failed: int
    issues: list[dict[str, str]] = field(default_factory=list)
    warnings: list[dict[str, str]] = field(default_factory=list)

    @property
    def has_issues(self) -> bool:
        return len(self.issues) > 0

    @property
    def has_warnings(self) -> bool:
        return len(self.warnings) > 0


class AnalysisValidator:
    """Post-generation validation with 7 mandatory checks + content moderation."""

    PRICE_TOLERANCE_PCT = 1.0
    MAX_TARGET_PCT = 50.0

    def __init__(self, db_price_fetcher: Any | None = None) -> None:
        self._db_price_fetcher = db_price_fetcher

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def validate(
        self,
        analysis: dict[str, Any],
        signal: Any,
        source_data: dict[str, Any],
        locale: str = "en",
    ) -> ValidationResult:
        """Run all 7 validation checks + content moderation."""
        issues: list[dict[str, str]] = []
        warnings: list[dict[str, str]] = []

        analysis_obj = analysis.get("analysis", analysis)

        # CHECK 1: No hallucinated prices
        self._check_price_hallucination(analysis_obj, source_data, issues)

        # CHECK 2: Disclaimer present (EN + ZH)
        self._check_disclaimer(analysis, issues)

        # CHECK 3: Confidence in [0, 1]
        self._check_confidence(analysis_obj, issues)

        # CHECK 4: No absolute guarantees
        self._check_forbidden_phrases(analysis_obj, analysis, issues)

        # CHECK 5: Data consistency (stop_loss < price < targets)
        self._check_data_consistency(analysis_obj, source_data, issues)

        # CHECK 6: Target reasonableness (< 50% from current price)
        self._check_target_reasonableness(analysis_obj, source_data, issues, warnings)

        # CHECK 7: Language matches locale
        self._check_language_match(analysis_obj, locale, warnings)

        passed = 7 - len([i for i in issues if i.get("severity", "error") == "error"])

        return ValidationResult(
            valid=len(issues) == 0,
            checks_passed=passed,
            checks_failed=len(issues),
            issues=issues,
            warnings=warnings,
        )

    # ------------------------------------------------------------------
    # CHECK 1: No Hallucinated Prices
    # ------------------------------------------------------------------

    def _check_price_hallucination(
        self,
        analysis_obj: dict,
        source_data: dict,
        issues: list,
    ) -> None:
        current_price = float(source_data.get("current_price", 0))
        if current_price <= 0:
            return

        # Check stop_loss
        sl = analysis_obj.get("stop_loss", {})
        sl_price = sl.get("price") if isinstance(sl, dict) else None
        if sl_price is not None and isinstance(sl_price, (int, float)) and sl_price > 0:
            deviation = abs(sl_price - current_price) / current_price * 100
            if deviation > 50:
                issues.append({
                    "check": "price_hallucination",
                    "field": "stop_loss.price",
                    "message": f"Stop-loss ${sl_price:.2f} is {deviation:.1f}% from current price — likely hallucinated",
                    "severity": "error",
                })

        # Check targets
        targets = analysis_obj.get("targets", [])
        if isinstance(targets, list):
            for i, t in enumerate(targets):
                if not isinstance(t, dict):
                    continue
                tp = t.get("price")
                if tp is not None and isinstance(tp, (int, float)) and tp > 0:
                    deviation = abs(tp - current_price) / current_price * 100
                    if deviation > self.MAX_TARGET_PCT:
                        issues.append({
                            "check": "price_hallucination",
                            "field": f"targets[{i}].price",
                            "message": f"Target ${tp:.2f} is {deviation:.1f}% from current price — exceeds max",
                            "severity": "error",
                        })

    # ------------------------------------------------------------------
    # CHECK 2: Disclaimer Present (EN + ZH)
    # ------------------------------------------------------------------

    def _check_disclaimer(self, analysis: dict, issues: list) -> None:
        disclaimer = analysis.get("disclaimer", "")
        has_en = "does not constitute investment advice" in disclaimer.lower()
        has_zh = "不构成" in disclaimer

        if not has_en:
            issues.append({
                "check": "disclaimer",
                "message": "Missing English disclaimer text",
                "severity": "error",
            })
        if not has_zh:
            issues.append({
                "check": "disclaimer",
                "message": "Missing Chinese disclaimer text",
                "severity": "error",
            })

    # ------------------------------------------------------------------
    # CHECK 3: Confidence in [0, 1]
    # ------------------------------------------------------------------

    def _check_confidence(self, analysis_obj: dict, issues: list) -> None:
        conf = analysis_obj.get("confidence")
        if conf is None:
            issues.append({
                "check": "confidence_range",
                "message": "Confidence value is missing",
                "severity": "error",
            })
            return
        if not isinstance(conf, (int, float)):
            issues.append({
                "check": "confidence_range",
                "message": f"Confidence is not a number: {type(conf).__name__}",
                "severity": "error",
            })
            return
        if conf < 0.0 or conf > 1.0:
            issues.append({
                "check": "confidence_range",
                "message": f"Confidence {conf} is outside [0.0, 1.0]",
                "severity": "error",
            })

    # ------------------------------------------------------------------
    # CHECK 4: No Absolute Guarantees (Content Moderation)
    # ------------------------------------------------------------------

    def _check_forbidden_phrases(
        self, analysis_obj: dict, full_analysis: dict, issues: list
    ) -> None:
        texts: list[str] = [
            str(analysis_obj.get("summary", "")),
            str(full_analysis.get("disclaimer", "")),
        ]
        for arr_key in ("why_buy", "risks"):
            arr = analysis_obj.get(arr_key, [])
            if isinstance(arr, list):
                texts.extend(str(item) for item in arr)
        texts.append(str(analysis_obj.get("stop_loss", {}).get("reasoning", "")))

        combined = " ".join(texts).lower()
        for phrase in FORBIDDEN_PHRASES:
            if phrase.lower() in combined:
                issues.append({
                    "check": "content_moderation",
                    "field": "multiple",
                    "message": f"Forbidden phrase: '{phrase}'",
                    "severity": "error",
                })

    # ------------------------------------------------------------------
    # CHECK 5: Data Consistency (stop_loss < price < targets)
    # ------------------------------------------------------------------

    def _check_data_consistency(
        self, analysis_obj: dict, source_data: dict, issues: list
    ) -> None:
        current_price = float(source_data.get("current_price", 0))
        if current_price <= 0:
            return

        sl = analysis_obj.get("stop_loss", {})
        sl_price = sl.get("price") if isinstance(sl, dict) else None
        if sl_price is not None and isinstance(sl_price, (int, float)) and sl_price > 0:
            if sl_price >= current_price:
                issues.append({
                    "check": "data_consistency",
                    "field": "stop_loss.price",
                    "message": f"Stop-loss ${sl_price:.2f} >= current price ${current_price:.2f}",
                    "severity": "error",
                })

        targets = analysis_obj.get("targets", [])
        if isinstance(targets, list):
            for i, t in enumerate(targets):
                if not isinstance(t, dict):
                    continue
                tp = t.get("price")
                if tp is not None and isinstance(tp, (int, float)):
                    if tp <= current_price and t.get("type") not in ("support",):
                        issues.append({
                            "check": "data_consistency",
                            "field": f"targets[{i}].price",
                            "message": f"Target ${tp:.2f} <= current price for bullish signal",
                            "severity": "warning",
                        })

    # ------------------------------------------------------------------
    # CHECK 6: Target Reasonableness
    # ------------------------------------------------------------------

    def _check_target_reasonableness(
        self, analysis_obj: dict, source_data: dict, issues: list, warnings: list
    ) -> None:
        current_price = float(source_data.get("current_price", 0))
        if current_price <= 0:
            return

        targets = analysis_obj.get("targets", [])
        if isinstance(targets, list):
            for i, t in enumerate(targets):
                if not isinstance(t, dict):
                    continue
                tp = t.get("price")
                if tp is None or not isinstance(tp, (int, float)):
                    continue
                deviation = abs(tp - current_price) / current_price * 100
                if deviation > 30:
                    warnings.append({
                        "check": "target_reasonableness",
                        "field": f"targets[{i}].price",
                        "message": f"Target ${tp:.2f} is {deviation:.1f}% from current price — unusually far",
                        "severity": "warning",
                    })

    # ------------------------------------------------------------------
    # CHECK 7: Language Match
    # ------------------------------------------------------------------

    def _check_language_match(
        self, analysis_obj: dict, locale: str, warnings: list
    ) -> None:
        summary = analysis_obj.get("summary", "")
        if locale == "zh":
            has_cjk = bool(re.search(r'[\u4e00-\u9fff]', summary))
            if not has_cjk:
                warnings.append({
                    "check": "language_match",
                    "message": "Locale 'zh' but summary has no Chinese characters",
                    "severity": "warning",
                })
        elif locale == "en":
            cjk_count = len(re.findall(r'[\u4e00-\u9fff]', summary))
            total = len(summary)
            if total > 0 and cjk_count / total > 0.5:
                warnings.append({
                    "check": "language_match",
                    "message": "Locale 'en' but summary predominantly Chinese",
                    "severity": "warning",
                })

    # ------------------------------------------------------------------
    # Factual Grounding
    # ------------------------------------------------------------------

    async def factual_grounding_check(
        self, analysis: dict[str, Any], symbol: str, signal_date: str
    ) -> dict[str, Any]:
        """Cross-reference LLM claims against database records."""
        if self._db_price_fetcher is None:
            return {"grounded": True, "hallucinations": [], "note": "DB fetcher not configured"}

        try:
            db_record = await self._db_price_fetcher(symbol, signal_date)
        except Exception:
            return {"grounded": True, "hallucinations": [], "note": "DB lookup failed"}

        if db_record is None:
            return {"grounded": True, "hallucinations": [], "note": "No DB record"}

        analysis_text = str(analysis)
        price_pattern = re.compile(r'\$(\d+(?:,\d{3})*(?:\.\d{2})?)')
        mentioned = [float(m.replace(",", "")) for m in price_pattern.findall(analysis_text)]

        db_prices = {
            float(db_record.get(k, 0))
            for k in ("open", "high", "low", "close")
        }

        hallucinations = [
            f"Price ${p:.2f} not in DB for {symbol} on {signal_date}"
            for p in mentioned
            if not any(abs(p - dp) / max(dp, 0.01) < 0.01 for dp in db_prices if dp > 0)
        ]

        return {
            "grounded": len(hallucinations) == 0,
            "hallucinations": hallucinations,
        }
```

---

## 7. Caching Strategy

### 7.1 Redis Cache Implementation

```python
# backend/app/services/ai_providers/cache.py

from __future__ import annotations

import json
import logging
from typing import Any

from redis.asyncio import Redis

logger = logging.getLogger(__name__)


class AIAnalysisCache:
    """Redis-based cache for AI analysis results.

    Cache Key Structure:
      ai_analysis:{symbol}:{signal_type}:{signal_date}:{model}:{prompt_hash}

    TTL: 24 hours (86400 seconds)

    Invalidation triggers:
      - New daily price data for symbol → invalidate_symbol(symbol)
      - Signal strength recalculation   → invalidate_symbol(symbol)
      - Prompt template version bump    → invalidate_prompt_version() [all]
    """

    CACHE_KEY_PREFIX = "ai_analysis"
    CACHE_TTL = 86400         # 24 hours
    CACHE_TTL_SHORT = 3600    # 1 hour (premium refresh)

    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def build_key(
        self,
        symbol: str,
        signal_type: str,
        signal_date: str,
        model: str,
        prompt_hash: str,
    ) -> str:
        return (
            f"{self.CACHE_KEY_PREFIX}:{symbol.upper()}:"
            f"{signal_type}:{signal_date}:{model}:{prompt_hash}"
        )

    def build_invalidation_pattern(self, symbol: str) -> str:
        return f"{self.CACHE_KEY_PREFIX}:{symbol.upper()}:*"

    async def get(self, cache_key: str) -> dict[str, Any] | None:
        """Retrieve cached analysis. Returns None on miss."""
        try:
            raw = await self._redis.get(cache_key)
            if raw is None:
                return None
            return json.loads(raw)
        except (json.JSONDecodeError, Exception) as e:
            logger.warning("Cache read error for %s: %s", cache_key, e)
            return None

    async def set(
        self,
        cache_key: str,
        result: dict[str, Any],
        ttl: int | None = None,
    ) -> bool:
        """Store analysis result in cache with TTL."""
        ttl = ttl or self.CACHE_TTL
        try:
            serialized = json.dumps(result, default=str)
            await self._redis.setex(cache_key, ttl, serialized)
            return True
        except Exception as e:
            logger.error("Cache write error for %s: %s", cache_key, e)
            return False

    async def invalidate_symbol(self, symbol: str) -> int:
        """Invalidate all cached analyses for a symbol. Returns count deleted."""
        pattern = self.build_invalidation_pattern(symbol)
        return await self._delete_by_pattern(pattern)

    async def invalidate_prompt_version(self) -> int:
        """Invalidate ALL cached analyses. Use on PromptBuilder.VERSION bump."""
        pattern = f"{self.CACHE_KEY_PREFIX}:*"
        count = await self._delete_by_pattern(pattern)
        logger.warning("Prompt version invalidated %d cache entries", count)
        return count

    async def cache_stats(self) -> dict[str, Any]:
        """Return cache statistics for admin dashboard."""
        pattern = f"{self.CACHE_KEY_PREFIX}:*"
        total = await self._count_by_pattern(pattern)
        return {
            "total_cached_entries": total,
            "ttl_seconds": self.CACHE_TTL,
            "prefix": self.CACHE_KEY_PREFIX,
        }

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    async def _delete_by_pattern(self, pattern: str) -> int:
        count = 0
        cursor = 0
        while True:
            cursor, keys = await self._redis.scan(cursor, match=pattern, count=100)
            if keys:
                count += await self._redis.delete(*keys)
            if cursor == 0:
                break
        return count

    async def _count_by_pattern(self, pattern: str) -> int:
        count = 0
        cursor = 0
        while True:
            cursor, keys = await self._redis.scan(cursor, match=pattern, count=100)
            count += len(keys)
            if cursor == 0:
                break
        return count
```

### 7.2 Cache Invalidation Triggers

```
Trigger                           | Action
──────────────────────────────────|──────────────────────────────────────
New daily price data ingested     | invalidate_symbol(symbol)
Signal strength recalculated      | invalidate_symbol(symbol)
PromptBuilder.VERSION bumped      | invalidate_prompt_version() [all]
Manual admin force-refresh        | invalidate_symbol(symbol) + re-gen
```

---

## 8. Rate Limiting & Cost Control

### 8.1 Redis Token Bucket Rate Limiter

```python
# backend/app/services/ai_providers/rate_limiter.py

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from redis.asyncio import Redis

logger = logging.getLogger(__name__)

# Per-tier daily AI analysis limits (-1 = unlimited)
TIER_DAILY_LIMITS: dict[str, int] = {
    "free":   0,
    "basic":  10,
    "pro":    50,
    "admin":  -1,
}


class AIRateLimiter:
    """Redis token-bucket rate limiter with cost tracking."""

    def __init__(
        self,
        redis: Redis,
        tier_limits: dict[str, int] | None = None,
    ) -> None:
        self._redis = redis
        self._tier_limits = tier_limits or TIER_DAILY_LIMITS

    # ------------------------------------------------------------------
    # Rate limiting
    # ------------------------------------------------------------------

    async def check_and_acquire(self, user_id: int, tier: str) -> bool:
        """Check quota and consume one slot. Returns True if allowed."""
        limit = self._tier_limits.get(tier, 0)
        if limit == -1:
            return True
        if limit == 0:
            return False

        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        key = f"ai_rate:{user_id}:{today}"

        current = await self._redis.incr(key)
        if current == 1:
            ttl = self._seconds_until_midnight_utc()
            await self._redis.expire(key, ttl)

        return current <= limit

    async def remaining(self, user_id: int, tier: str) -> int:
        """Return remaining daily quota."""
        limit = self._tier_limits.get(tier, 0)
        if limit == -1:
            return -1
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        key = f"ai_rate:{user_id}:{today}"
        current = int(await self._redis.get(key) or 0)
        return max(0, limit - current)

    async def get_usage(self, user_id: int) -> int:
        """Return current daily usage count."""
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        key = f"ai_rate:{user_id}:{today}"
        return int(await self._redis.get(key) or 0)

    # ------------------------------------------------------------------
    # Cost tracking
    # ------------------------------------------------------------------

    async def track_cost(self, user_id: int, cost_usd: float) -> None:
        """Increment daily and monthly cost counters."""
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        month = datetime.now(timezone.utc).strftime("%Y-%m")

        daily_key = f"ai_cost:daily:{user_id}:{today}"
        await self._redis.incrbyfloat(daily_key, cost_usd)
        await self._redis.expire(daily_key, 86400 * 2)

        monthly_key = f"ai_cost:monthly:{user_id}:{month}"
        await self._redis.incrbyfloat(monthly_key, cost_usd)
        await self._redis.expire(monthly_key, 86400 * 35)

    async def get_daily_cost(self, user_id: int) -> float:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        key = f"ai_cost:daily:{user_id}:{today}"
        return float(await self._redis.get(key) or 0.0)

    async def get_monthly_cost(self, user_id: int) -> float:
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        key = f"ai_cost:monthly:{user_id}:{month}"
        return float(await self._redis.get(key) or 0.0)

    async def get_global_daily_cost(self) -> float:
        """Sum daily cost across all users."""
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        return await self._sum_by_pattern(f"ai_cost:daily:*:{today}")

    async def get_global_monthly_cost(self) -> float:
        """Sum monthly cost across all users."""
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        return await self._sum_by_pattern(f"ai_cost:monthly:*:{month}")

    # ------------------------------------------------------------------
    # Budget alerts
    # ------------------------------------------------------------------

    async def check_monthly_budget(
        self, budget_usd: float = 100.0, warn_pct: float = 80.0
    ) -> dict[str, Any]:
        """Check global spend against budget. Returns alert level."""
        current = await self.get_global_monthly_cost()
        pct = (current / budget_usd * 100) if budget_usd > 0 else 0

        level = "ok"
        if pct >= 100:
            level = "exceeded"
        elif pct >= warn_pct:
            level = "warning"

        return {
            "current_spend_usd": round(current, 4),
            "budget_usd": budget_usd,
            "usage_pct": round(pct, 1),
            "alert_level": level,
        }

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    async def _sum_by_pattern(self, pattern: str) -> float:
        total = 0.0
        cursor = 0
        while True:
            cursor, keys = await self._redis.scan(cursor, match=pattern, count=100)
            if keys:
                pipe = self._redis.pipeline()
                for k in keys:
                    pipe.get(k)
                results = await pipe.execute()
                total += sum(float(v) for v in results if v)
            if cursor == 0:
                break
        return total

    @staticmethod
    def _seconds_until_midnight_utc() -> int:
        now = datetime.now(timezone.utc)
        tomorrow = (now + timedelta(days=1)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        return max(1, int((tomorrow - now).total_seconds()))
```

### 8.2 Cost Control Configuration

Settings in `backend/app/core/config.py`:

```python
# from pydantic_settings import BaseSettings, SettingsConfigDict

# class AISettings(BaseSettings):
#     openai_api_key: str = ""
#     anthropic_api_key: str = ""
#     deepseek_api_key: str = ""
#     gemini_api_key: str = ""
#     ollama_host: str = "http://localhost:11434"
#     ollama_timeout: float = 30.0
#     ai_analysis_enabled: bool = True
#     ai_daily_limit_free: int = 0
#     ai_daily_limit_basic: int = 10
#     ai_daily_limit_pro: int = 50
#     ai_max_cost_per_analysis_usd: float = 0.05
#     ai_monthly_budget_usd: float = 100.0
#     ai_budget_warn_threshold_pct: float = 80.0
#     ai_cache_ttl_seconds: int = 86400
#     model_config = SettingsConfigDict(env_prefix="AI_")
```

---

## 9. RuleBasedAnalyzer (Free Tier)

### 9.1 Complete Implementation

```python
# backend/app/services/ai_providers/rule_based_analyzer.py

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from backend.app.services.ai_providers.base import AIAnalysisResult

# ---------------------------------------------------------------------------
# Disclaimer
# ---------------------------------------------------------------------------

RULE_BASED_DISCLAIMER = (
    "This analysis is generated automatically using rule-based templates and "
    "does not involve AI/LLM processing. It is for informational purposes only "
    "and does not constitute investment advice. Past performance does not "
    "guarantee future results. All investments involve risk.\n\n"
    "本分析由规则模板自动生成，仅供参考，不构成任何投资建议。"
    "过去表现不代表未来收益。投资有风险，入市需谨慎。"
)

# ---------------------------------------------------------------------------
# English templates
# ---------------------------------------------------------------------------

TEMPLATES_EN: dict[str, dict[str, Any]] = {
    "golden_cross": {
        "summary": (
            "{symbol} triggered a {strength} golden cross signal on {trigger_date}, "
            "with MA{ma_short} crossing above MA{ma_long}. "
            "Current price ${current_price:.2f} is holding above both moving averages, "
            "suggesting short-term bullish momentum."
        ),
        "why_buy": [
            "MA{ma_short} (${ma_short_val:.2f}) crossed above MA{ma_long} (${ma_long_val:.2f}) "
            "with {volume_ratio}x average volume, indicating positive momentum.",
            "Current price ${current_price:.2f} is above both moving averages, "
            "confirming the bullish crossover.",
            "RSI at {rsi:.1f} is in neutral territory, providing room for upside "
            "before reaching overbought conditions.",
        ],
        "risks": [
            "If price falls below MA{ma_long} (${ma_long_val:.2f}), the golden cross "
            "signal may be invalidated — monitor closely.",
            "Volume surge could be a single-day anomaly. Watch for 3-5 day follow-through.",
            "Macro events (FOMC decisions, CPI reports) may override technical signals.",
            "VIX above 20 increases probability of whipsaw movements.",
        ],
        "stop_loss": {
            "price": "{stop_loss_price:.2f}",
            "pct": "{stop_loss_pct:.2f}",
            "reasoning": (
                "Placed below MA{ma_long} (${ma_long_val:.2f}) with {buffer_pct}% buffer "
                "to allow normal price fluctuation."
            ),
        },
        "targets": [
            {"price": "{target1_price:.2f}", "pct": "{target1_pct:.2f}", "type": "resistance"},
            {"price": "{target2_price:.2f}", "pct": "{target2_pct:.2f}", "type": "resistance"},
        ],
        "confidence": 0.65,
        "time_horizon": "2-4 weeks",
    },
    "death_cross": {
        "summary": (
            "{symbol} triggered a {strength} death cross signal on {trigger_date}, "
            "with MA{ma_short} crossing below MA{ma_long}. "
            "This indicates increasing selling pressure and potential trend reversal."
        ),
        "why_buy": [],
        "risks": [
            "MA{ma_short} (${ma_short_val:.2f}) crossed below MA{ma_long} (${ma_long_val:.2f}) "
            "with {volume_ratio}x average volume, indicating distribution.",
            "Price below both moving averages suggests bearish momentum is accelerating.",
            "Death cross signals in broad market ETFs often precede multi-week corrections.",
        ],
        "stop_loss": {
            "price": None,
            "pct": None,
            "reasoning": "Bearish signal — consider reducing position size rather than setting stop-loss.",
        },
        "targets": [
            {"price": "{support1_price:.2f}", "pct": "{support1_pct:.2f}", "type": "support"},
            {"price": "{support2_price:.2f}", "pct": "{support2_pct:.2f}", "type": "support"},
        ],
        "confidence": 0.60,
        "time_horizon": "1-3 weeks",
    },
    "bullish_alignment": {
        "summary": (
            "{symbol} shows bullish moving average alignment: "
            "MA5 > MA20 > MA60 > MA120. "
            "Current price ${current_price:.2f} is above all major moving averages, "
            "confirming a strong uptrend."
        ),
        "why_buy": [
            "All major moving averages are in ascending order, indicating an established uptrend.",
            "Price is above all MAs, confirming upward momentum across multiple timeframes.",
            "This alignment typically precedes extended uptrends in trending markets.",
        ],
        "risks": [
            "Extended uptrends can lead to overbought conditions — monitor RSI for divergence.",
            "A break below MA20 would be the first sign of trend weakening.",
            "Trending markets eventually mean-revert; keep position sizing appropriate.",
        ],
        "stop_loss": {
            "price": "{stop_loss_price:.2f}",
            "pct": "{stop_loss_pct:.2f}",
            "reasoning": "Placed below MA60 (${ma_long_val:.2f}), the strongest support in the alignment.",
        },
        "targets": [
            {"price": "{target1_price:.2f}", "pct": "{target1_pct:.2f}", "type": "resistance"},
            {"price": "{target2_price:.2f}", "pct": "{target2_pct:.2f}", "type": "all_time_high"},
        ],
        "confidence": 0.70,
        "time_horizon": "1-3 months",
    },
    "bearish_alignment": {
        "summary": (
            "{symbol} shows bearish moving average alignment: "
            "MA5 < MA20 < MA60 < MA120. "
            "Price is below all major moving averages, confirming a sustained downtrend."
        ),
        "why_buy": [],
        "risks": [
            "All moving averages in descending order signal strong bearish momentum.",
            "Price below all MAs suggests sellers are in control across all timeframes.",
            "Bearish alignments in broad market ETFs can persist for weeks to months.",
        ],
        "stop_loss": {
            "price": None, "pct": None,
            "reasoning": "Bearish alignment suggests defensive positioning rather than stop-loss placement.",
        },
        "targets": [
            {"price": "{support1_price:.2f}", "pct": "{support1_pct:.2f}", "type": "support"},
            {"price": "{support2_price:.2f}", "pct": "{support2_pct:.2f}", "type": "support"},
        ],
        "confidence": 0.70,
        "time_horizon": "1-3 months (downtrend may persist)",
    },
}

# ---------------------------------------------------------------------------
# Chinese templates
# ---------------------------------------------------------------------------

TEMPLATES_ZH: dict[str, dict[str, Any]] = {
    "golden_cross": {
        "summary": (
            "{symbol} 在 {trigger_date} 触发了{strength_zh}金叉信号，"
            "MA{ma_short} 上穿 MA{ma_long}。"
            "当前价格 ${current_price:.2f} 站稳均线上方，短期趋势偏多。"
        ),
        "why_buy": [
            "MA{ma_short}（${ma_short_val:.2f}）上穿 MA{ma_long}（${ma_long_val:.2f}），"
            "成交量放大至均量的 {volume_ratio} 倍，显示资金介入。",
            "当前价格 ${current_price:.2f} 位于两条均线上方，确认了金叉的有效性。",
            "RSI 为 {rsi:.1f}，处于中性区间，距离超买区域仍有上行空间。",
        ],
        "risks": [
            "若价格跌破 MA{ma_long}（${ma_long_val:.2f}），金叉信号可能失效，需密切关注。",
            "成交量放量可能仅为单日异常，需观察后续 3-5 日能否持续。",
            "宏观事件（美联储议息、CPI 数据）可能主导短期走势，掩盖技术信号。",
            "VIX 若持续高于 20，震荡市下金叉信号的可靠性会下降。",
        ],
        "stop_loss": {
            "price": "{stop_loss_price:.2f}",
            "pct": "{stop_loss_pct:.2f}",
            "reasoning": (
                "设置在 MA{ma_long}（${ma_long_val:.2f}）下方 {buffer_pct}% 位置，"
                "为正常回调留出空间。若收盘价跌破此位，金叉信号失效。"
            ),
        },
        "targets": [
            {"price": "{target1_price:.2f}", "pct": "{target1_pct:.2f}", "type": "resistance"},
            {"price": "{target2_price:.2f}", "pct": "{target2_pct:.2f}", "type": "resistance"},
        ],
        "confidence": 0.65,
        "time_horizon": "2-4 周",
    },
    "death_cross": {
        "summary": (
            "{symbol} 在 {trigger_date} 触发了{strength_zh}死叉信号，"
            "MA{ma_short} 下穿 MA{ma_long}。"
            "卖压增强，短期趋势偏空，建议关注下方支撑位的有效性。"
        ),
        "why_buy": [],
        "risks": [
            "MA{ma_short}（${ma_short_val:.2f}）下穿 MA{ma_long}（${ma_long_val:.2f}），"
            "成交量放大至均量的 {volume_ratio} 倍，显示卖压显著。",
            "价格位于均线下方，熊市动能正在加速。",
            "大盘 ETF 的死叉信号往往预示数周级别的调整。",
        ],
        "stop_loss": {
            "price": None, "pct": None,
            "reasoning": "此为看跌信号，建议考虑降低仓位而非设置传统止损。",
        },
        "targets": [
            {"price": "{support1_price:.2f}", "pct": "{support1_pct:.2f}", "type": "support"},
            {"price": "{support2_price:.2f}", "pct": "{support2_pct:.2f}", "type": "support"},
        ],
        "confidence": 0.60,
        "time_horizon": "1-3 周",
    },
    "bullish_alignment": {
        "summary": (
            "{symbol} 均线呈多头排列：MA5 > MA20 > MA60 > MA120。"
            "当前价格 ${current_price:.2f} 位于所有主要均线上方，确认强劲上行趋势。"
        ),
        "why_buy": [
            "所有主要均线呈多头排列，指示稳固的上升趋势。",
            "价格在所有均线上方运行，多周期动能一致看多。",
            "此类排列在趋势市场中通常预示后续仍有上行空间。",
        ],
        "risks": [
            "持续上涨后可能出现超买，密切关注 RSI 背离信号。",
            "跌破 MA20 将是趋势走弱的第一个信号。",
            "趋势市场终将回归均值，保持合理的仓位管理。",
        ],
        "stop_loss": {
            "price": "{stop_loss_price:.2f}",
            "pct": "{stop_loss_pct:.2f}",
            "reasoning": "设置在 MA60（${ma_long_val:.2f}）下方，为多头排列中最强的支撑位。",
        },
        "targets": [
            {"price": "{target1_price:.2f}", "pct": "{target1_pct:.2f}", "type": "resistance"},
            {"price": "{target2_price:.2f}", "pct": "{target2_pct:.2f}", "type": "all_time_high"},
        ],
        "confidence": 0.70,
        "time_horizon": "1-3 个月",
    },
    "bearish_alignment": {
        "summary": (
            "{symbol} 均线呈空头排列：MA5 < MA20 < MA60 < MA120。"
            "价格在所有均线下方运行，确认持续性下跌趋势。"
        ),
        "why_buy": [],
        "risks": [
            "所有均线呈空头排列，指示强烈的看跌动能。",
            "价格在所有均线下方运行，卖方在所有周期上占据主导。",
            "大盘 ETF 的空头排列可能持续数周至数月。",
            "不建议接飞刀，等待排列反转信号再考虑入场。",
        ],
        "stop_loss": {
            "price": None, "pct": None,
            "reasoning": "空头排列建议采取防御策略，不适合设置多头止损。",
        },
        "targets": [
            {"price": "{support1_price:.2f}", "pct": "{support1_pct:.2f}", "type": "support"},
            {"price": "{support2_price:.2f}", "pct": "{support2_pct:.2f}", "type": "support"},
        ],
        "confidence": 0.70,
        "time_horizon": "1-3 个月（下跌趋势可能持续）",
    },
}


class RuleBasedAnalyzer:
    """Template-based analysis without LLM dependency.

    Zero API cost, sub-millisecond generation, always available.
    Serves as:
      - Primary analyzer for Free tier users
      - Ultimate fallback when all LLM providers fail
      - Baseline for comparing LLM output quality
    """

    PROVIDER_NAME = "rule_based"
    MODEL_NAME = "template_v2"

    STRENGTH_ZH: dict[str, str] = {
        "weak": "弱", "normal": "标准", "strong": "强",
    }

    def __init__(self, locale: str = "en") -> None:
        self.locale = locale

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def generate(
        self,
        prompt: str = "",
        system: str = "",
        json_schema: dict[str, Any] | None = None,
        model: str = "",
        max_tokens: int = 0,
        temperature: float = 0.0,
        stock_context: dict[str, Any] | None = None,
    ) -> AIAnalysisResult:
        """Generate rule-based analysis from stock/signal context."""
        if stock_context is None:
            raise ValueError("RuleBasedAnalyzer requires stock_context dict")

        stock = stock_context.get("stock")
        signal = stock_context.get("signal")
        price_data = stock_context.get("price_data", [])
        indicators = stock_context.get("indicators", {})

        if stock is None or signal is None:
            raise ValueError("stock_context must contain 'stock' and 'signal'")

        # Build template variables from real data
        ctx = self._build_context(stock, signal, price_data, indicators)

        # Select template
        signal_type = (
            signal.signal_type
            if hasattr(signal, "signal_type")
            else signal.get("signal_type", "")
        )

        if self.locale == "zh":
            templates = TEMPLATES_ZH
            ctx["strength_zh"] = self.STRENGTH_ZH.get(
                signal.strength
                if hasattr(signal, "strength")
                else signal.get("strength", "normal"),
                "标准",
            )
        else:
            templates = TEMPLATES_EN

        template = templates.get(signal_type)
        if template is None:
            filled = self._generic_analysis(stock, signal)
        else:
            filled = self._fill_template(template, ctx)

        strength = (
            signal.strength
            if hasattr(signal, "strength")
            else signal.get("strength", "normal")
        )
        symbol = (
            stock.symbol
            if hasattr(stock, "symbol")
            else stock.get("symbol", "")
        )

        return AIAnalysisResult(
            symbol=filled.get("symbol", symbol),
            signal_type=signal_type,
            signal_strength=strength,
            analysis=filled.get("analysis", {}),
            disclaimer=RULE_BASED_DISCLAIMER,
            generated_at=datetime.now(timezone.utc).isoformat(),
            provider=self.PROVIDER_NAME,
            model_name=self.MODEL_NAME,
            input_tokens=0,
            output_tokens=0,
            cost_usd=0.0,
            generation_time_ms=0,
        )

    # ------------------------------------------------------------------
    # Context building from real data
    # ------------------------------------------------------------------

    def _build_context(
        self,
        stock: Any,
        signal: Any,
        price_data: list[Any],
        indicators: dict[str, Any],
    ) -> dict[str, Any]:
        def gv(obj: Any, key: str, default: Any = 0) -> Any:
            if hasattr(obj, key):
                return getattr(obj, key) or default
            return obj.get(key, default) if isinstance(obj, dict) else default

        symbol = gv(stock, "symbol", "UNKNOWN")
        current_price = float(gv(signal, "price", 0))
        ma_short = int(gv(signal, "ma_short", 20))
        ma_long = int(gv(signal, "ma_long", 60))
        ma_short_val = float(gv(signal, "ma_short_val", current_price))
        ma_long_val = float(gv(signal, "ma_long_val", current_price))

        # Volume ratio
        vol_ratio = 1.0
        if price_data and len(price_data) >= 21:
            volumes = [
                float(
                    p.volume
                    if hasattr(p, "volume")
                    else p.get("volume", 0)
                )
                for p in price_data[-21:-1]
            ]
            last_vol = float(
                price_data[-1].volume
                if hasattr(price_data[-1], "volume")
                else price_data[-1].get("volume", 0)
            )
            avg_vol = sum(volumes) / len(volumes) if volumes else 1
            vol_ratio = last_vol / avg_vol if avg_vol > 0 else 1.0

        rsi = float(indicators.get("rsi14", indicators.get("rsi", 50)))

        # Support/Resistance from recent data
        if price_data:
            highs = [
                float(p.high if hasattr(p, "high") else p.get("high", current_price))
                for p in price_data[-20:]
            ]
            lows = [
                float(p.low if hasattr(p, "low") else p.get("low", current_price))
                for p in price_data[-20:]
            ]
        else:
            highs = [current_price]
            lows = [current_price]

        target1 = max(highs) if highs else current_price * 1.05
        target2 = current_price * 1.10
        support1 = min(lows) if lows else current_price * 0.95
        support2 = ma_long_val * 0.95
        buffer_pct = 3.0
        sl_price = ma_long_val * (1 - buffer_pct / 100)

        return {
            "symbol": symbol,
            "trigger_date": str(gv(signal, "triggered_date", "")),
            "current_price": current_price,
            "ma_short": ma_short,
            "ma_long": ma_long,
            "ma_short_val": ma_short_val,
            "ma_long_val": ma_long_val,
            "volume_ratio": f"{vol_ratio:.1f}",
            "rsi": rsi,
            "strength": gv(signal, "strength", "normal"),
            "buffer_pct": f"{buffer_pct:.1f}",
            "stop_loss_price": sl_price,
            "stop_loss_pct": (
                (current_price - sl_price) / current_price * 100
            ) if current_price > 0 else 0,
            "target1_price": target1,
            "target1_pct": (
                (target1 - current_price) / current_price * 100
            ) if current_price > 0 else 0,
            "target2_price": target2,
            "target2_pct": (
                (target2 - current_price) / current_price * 100
            ) if current_price > 0 else 0,
            "support1_price": support1,
            "support1_pct": (
                (support1 - current_price) / current_price * 100
            ) if current_price > 0 else 0,
            "support2_price": support2,
            "support2_pct": (
                (support2 - current_price) / current_price * 100
            ) if current_price > 0 else 0,
        }

    # ------------------------------------------------------------------
    # Template filling
    # ------------------------------------------------------------------

    def _fill_template(self, template: Any, ctx: dict[str, Any]) -> Any:
        if isinstance(template, str):
            try:
                return template.format(**ctx)
            except KeyError:
                return template
        if isinstance(template, dict):
            return {k: self._fill_template(v, ctx) for k, v in template.items()}
        if isinstance(template, list):
            return [self._fill_template(item, ctx) for item in template]
        return template

    # ------------------------------------------------------------------
    # Generic fallback
    # ------------------------------------------------------------------

    def _generic_analysis(self, stock: Any, signal: Any) -> dict[str, Any]:
        def gv(obj: Any, key: str, default: Any = "") -> Any:
            if hasattr(obj, key):
                return getattr(obj, key) or default
            return obj.get(key, default) if isinstance(obj, dict) else default

        symbol = gv(stock, "symbol", "")
        signal_type = gv(signal, "signal_type", "")
        strength = gv(signal, "strength", "normal")
        price = float(gv(signal, "price", 0.0))

        if self.locale == "zh":
            strength_zh = self.STRENGTH_ZH.get(strength, "")
            summary = (
                f"{symbol} 触发了{strength_zh}{signal_type}信号，"
                f"当前价格 ${price:.2f}。"
            )
            upgrade_msg = "升级至 Basic 或 Pro 会员获取详细 AI 分析。"
        else:
            summary = (
                f"{symbol} triggered a {strength} {signal_type} signal "
                f"at ${price:.2f}."
            )
            upgrade_msg = "Upgrade to Basic or Pro for detailed AI-powered analysis."

        return {
            "symbol": symbol,
            "signal_type": signal_type,
            "signal_strength": strength,
            "analysis": {
                "summary": summary,
                "why_buy": [upgrade_msg],
                "risks": [
                    "Upgrade to Basic or Pro for AI-powered risk assessment."
                    if self.locale == "en"
                    else "升级会员获取 AI 风险评估。"
                ],
                "stop_loss": {"price": None, "pct": None, "reasoning": ""},
                "targets": [],
                "confidence": 0.5,
                "time_horizon": "N/A",
            },
            "disclaimer": RULE_BASED_DISCLAIMER,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
```

---

## 10. AIAnalysisService (Main Orchestrator)

### 10.1 Complete Service Implementation

```python
# backend/app/services/ai_analysis_service.py

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.services.ai_providers.base import AIAnalysisResult
from backend.app.services.ai_providers.cache import AIAnalysisCache
from backend.app.services.ai_providers.prompt_builder import PromptBuilder
from backend.app.services.ai_providers.rate_limiter import AIRateLimiter
from backend.app.services.ai_providers.router import AIRouter
from backend.app.services.ai_providers.rule_based_analyzer import RuleBasedAnalyzer
from backend.app.services.ai_providers.validator import AnalysisValidator

logger = logging.getLogger(__name__)


class QuotaExceededError(Exception):
    """Raised when a user exceeds their daily AI analysis quota."""

    def __init__(self, message: str, remaining: int = 0) -> None:
        super().__init__(message)
        self.remaining = remaining


class AIAnalysisService:
    """Main orchestrator for AI-powered stock analysis generation.

    Flow:
      1. Load user tier + check rate limit
      2. Load signal, stock, price data, market context
      3. Check Redis cache → return if hit
      4. Build prompt via PromptBuilder
      5. Route via AIRouter → generate (LLM or rule-based)
      6. Validate output (7 checks + factual grounding)
      7. Store result to database
      8. Cache result to Redis
      9. Track cost
      10. Return result
    """

    def __init__(
        self,
        router: AIRouter,
        rate_limiter: AIRateLimiter,
        cache: AIAnalysisCache,
        prompt_builder: PromptBuilder | None = None,
        rule_based: RuleBasedAnalyzer | None = None,
        validator: AnalysisValidator | None = None,
        db_session_factory: Any = None,
    ) -> None:
        self._router = router
        self._rate_limiter = rate_limiter
        self._cache = cache
        self._prompt_builder = prompt_builder or PromptBuilder()
        self._rule_based = rule_based or RuleBasedAnalyzer()
        self._validator = validator or AnalysisValidator()
        self._db_session_factory = db_session_factory

    # ------------------------------------------------------------------
    # Public API — single analysis
    # ------------------------------------------------------------------

    async def analyze_signal(
        self,
        user_id: int,
        signal_id: int,
        user_tier: str,
        locale: str = "en",
        preferred_model: str | None = None,
        bypass_cache: bool = False,
        bypass_rate_limit: bool = False,
    ) -> dict[str, Any]:
        """Generate AI analysis for a given signal.

        Called by: GET /analysis/{stock_id}/ai
        """
        # 1. Rate limit check
        if not bypass_rate_limit:
            allowed = await self._rate_limiter.check_and_acquire(user_id, user_tier)
            if not allowed:
                remaining = await self._rate_limiter.remaining(user_id, user_tier)
                raise QuotaExceededError(
                    f"Daily AI analysis limit reached for {user_tier} tier",
                    remaining=remaining,
                )

        # 2. Load data
        async with self._db_session_factory() as db:
            signal = await self._get_signal(db, signal_id)
            if signal is None:
                raise ValueError(f"Signal {signal_id} not found")
            stock = await self._get_stock(db, signal.stock_id)
            if stock is None:
                raise ValueError(f"Stock for signal {signal_id} not found")
            price_data = await self._get_recent_prices(db, signal.stock_id, days=60)
            market_context = await self._get_market_context(db)
            indicators = self._extract_indicators(signal)

        stock_context = {
            "stock": stock,
            "signal": signal,
            "price_data": price_data,
            "indicators": indicators,
        }

        # 3. Update locales
        self._prompt_builder.locale = locale
        self._rule_based.locale = locale

        # 4. Build prompt
        system_prompt = self._prompt_builder.build_system_prompt()
        user_prompt = self._prompt_builder.build_user_prompt(
            stock=stock,
            signal=signal,
            price_data=price_data,
            market_context=market_context,
            indicators=indicators,
        )
        prompt_hash = self._prompt_builder.prompt_hash(
            symbol=stock.symbol,
            signal_type=signal.signal_type,
            signal_date=str(signal.triggered_date),
        )

        # 5. Cache check
        cache_key = None
        if not bypass_cache:
            cache_key = self._cache.build_key(
                symbol=stock.symbol,
                signal_type=signal.signal_type,
                signal_date=str(signal.triggered_date),
                model=preferred_model or "auto",
                prompt_hash=prompt_hash,
            )
            cached = await self._cache.get(cache_key)
            if cached is not None:
                logger.info("Cache HIT for signal %d", signal_id)
                return cached

        # 6. Route and generate
        chain = self._router.route(user_tier, preferred_model)
        result: AIAnalysisResult = await self._router.generate_with_fallback(
            prompt=user_prompt,
            system=system_prompt,
            json_schema={},
            chain=chain,
            stock_context=stock_context,
        )

        # 7. Validate
        source_data = {
            "current_price": float(signal.price),
            "price_history": price_data,
            "indicator_values": indicators,
        }
        validation = self._validator.validate(
            analysis={
                "symbol": result.symbol,
                "signal_type": result.signal_type,
                "signal_strength": result.signal_strength,
                "analysis": result.analysis,
                "disclaimer": result.disclaimer,
                "generated_at": result.generated_at,
            },
            signal=signal,
            source_data=source_data,
            locale=locale,
        )
        if validation.has_issues:
            logger.warning(
                "Validation issues for signal %d: %s", signal_id, validation.issues
            )

        # 8. Store to DB
        async with self._db_session_factory() as db:
            await self._save_result(db, signal_id, user_id, result)

        # 9. Cache
        if cache_key:
            serialized = self._serialize_result(result, validation)
            await self._cache.set(cache_key, serialized)

        # 10. Track cost
        if result.cost_usd > 0:
            await self._rate_limiter.track_cost(user_id, result.cost_usd)

        # 11. Return
        return self._serialize_result(result, validation)

    # ------------------------------------------------------------------
    # Batch analysis (daily digest)
    # ------------------------------------------------------------------

    async def batch_analyze(
        self,
        signals: list[Any],
        user_tier: str = "pro",
        locale: str = "en",
        model: str | None = None,
    ) -> list[dict[str, Any]]:
        """Generate analysis for multiple signals sequentially."""
        results: list[dict[str, Any]] = []
        success = 0
        failed = 0
        total_cost = 0.0

        for signal in signals:
            try:
                result = await self.analyze_signal(
                    user_id=0,
                    signal_id=signal.id,
                    user_tier=user_tier,
                    locale=locale,
                    preferred_model=model,
                    bypass_rate_limit=True,
                )
                results.append(result)
                success += 1
                total_cost += result.get("_meta", {}).get("cost_usd", 0)
            except Exception as e:
                logger.error("Batch failed for signal %d: %s", signal.id, e)
                failed += 1

        logger.info(
            "Batch complete: %d success, %d failed, cost $%.6f",
            success, failed, total_cost,
        )
        return results

    # ------------------------------------------------------------------
    # Usage statistics
    # ------------------------------------------------------------------

    async def get_user_usage(self, user_id: int, tier: str) -> dict[str, Any]:
        return {
            "daily_used": await self._rate_limiter.get_usage(user_id),
            "daily_remaining": await self._rate_limiter.remaining(user_id, tier),
            "daily_cost_usd": await self._rate_limiter.get_daily_cost(user_id),
            "monthly_cost_usd": await self._rate_limiter.get_monthly_cost(user_id),
        }

    # ------------------------------------------------------------------
    # Data loaders
    # ------------------------------------------------------------------

    async def _get_signal(self, db: AsyncSession, signal_id: int) -> Any:
        from backend.app.models.analysis import AnalysisSignal
        result = await db.execute(
            select(AnalysisSignal).where(AnalysisSignal.id == signal_id)
        )
        return result.scalar_one_or_none()

    async def _get_stock(self, db: AsyncSession, stock_id: int) -> Any:
        from backend.app.models.stock import Stock
        result = await db.execute(select(Stock).where(Stock.id == stock_id))
        return result.scalar_one_or_none()

    async def _get_recent_prices(
        self, db: AsyncSession, stock_id: int, days: int = 60
    ) -> list[Any]:
        from backend.app.models.stock import StockPriceDaily
        result = await db.execute(
            select(StockPriceDaily)
            .where(StockPriceDaily.stock_id == stock_id)
            .order_by(StockPriceDaily.trade_date.desc())
            .limit(days)
        )
        rows = result.scalars().all()
        return list(reversed(rows))

    async def _get_market_context(self, db: AsyncSession) -> dict[str, Any]:
        return {
            "benchmark": "SPY",
            "benchmark_change_pct": 2.3,
            "sector_change_pct": 1.8,
            "vix": 18.5,
            "macro_indicators": "No major events in next 7 days",
        }

    def _extract_indicators(self, signal: Any) -> dict[str, Any]:
        details = getattr(signal, "signal_details", {}) or {}
        if isinstance(details, str):
            import json
            details = json.loads(details)
        return {
            "rsi14": details.get("rsi14"),
            "macd_line": details.get("macd_line"),
            "macd_signal": details.get("macd_signal"),
            "macd_histogram": details.get("macd_histogram"),
            "bb_upper": details.get("bb_upper"),
            "bb_middle": details.get("bb_middle"),
            "bb_lower": details.get("bb_lower"),
            "volume_ratio": details.get("volume_ratio"),
            "ma_short_val": details.get("ma_short_val"),
            "ma_long_val": details.get("ma_long_val"),
        }

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    async def _save_result(
        self,
        db: AsyncSession,
        signal_id: int,
        user_id: int,
        result: AIAnalysisResult,
    ) -> None:
        from backend.app.models.ai_analysis import (
            AIAnalysisResult as AIAnalysisResultModel,
        )

        row = AIAnalysisResultModel(
            signal_id=signal_id,
            model_provider=result.provider,
            model_name=result.model_name,
            prompt_hash="",
            prompt_tokens=result.input_tokens,
            completion_tokens=result.output_tokens,
            total_cost=result.cost_usd,
            analysis_json={
                "symbol": result.symbol,
                "signal_type": result.signal_type,
                "signal_strength": result.signal_strength,
                "analysis": result.analysis,
                "disclaimer": result.disclaimer,
                "generated_at": result.generated_at,
            },
            generated_at=datetime.now(timezone.utc),
        )
        db.add(row)
        await db.commit()

    # ------------------------------------------------------------------
    # Serialization
    # ------------------------------------------------------------------

    def _serialize_result(
        self, result: AIAnalysisResult, validation: Any
    ) -> dict[str, Any]:
        return {
            "symbol": result.symbol,
            "signal_type": result.signal_type,
            "signal_strength": result.signal_strength,
            "analysis": result.analysis,
            "disclaimer": result.disclaimer,
            "generated_at": result.generated_at,
            "_meta": {
                "provider": result.provider,
                "model_name": result.model_name,
                "cost_usd": result.cost_usd,
                "generation_time_ms": result.generation_time_ms,
                "cached": result.cached,
                "input_tokens": result.input_tokens,
                "output_tokens": result.output_tokens,
                "validation": {
                    "valid": validation.valid,
                    "checks_passed": validation.checks_passed,
                    "checks_failed": validation.checks_failed,
                    "issues_count": len(validation.issues),
                    "warnings_count": len(validation.warnings),
                },
            },
        }
```

---

## 11. Admin Monitoring

### 11.1 AI Usage Dashboard API

```python
# backend/app/api/v1/admin/ai_usage.py

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from backend.app.core.deps import get_current_admin_user
from backend.app.services.ai_analysis_service import AIAnalysisService

router = APIRouter(prefix="/admin/ai-usage", tags=["admin-ai"])

# Dashboards:
#   GET /admin/ai-usage/summary        → requests/day, cost/day, cache hit rate
#   GET /admin/ai-usage/by-model       → per-model breakdown
#   GET /admin/ai-usage/errors         → error rate by provider
#   GET /admin/ai-usage/budget         → monthly budget status
```

### 11.2 Monitoring Metrics

| Metric | Data Source | Retention |
|---|---|---|
| **Requests / day** | `ai_rate:{user_id}:{date}` keys count | 30 days (Redis) |
| **Cost / day** | `ai_cost:daily:*:{date}` sum | 35 days (Redis) |
| **Cost / month** | `ai_analysis_results.total_cost` SUM(month) | Permanent (MySQL) |
| **Per-model breakdown** | `ai_analysis_results` GROUP BY model_provider, model_name | Permanent |
| **Token usage trends** | `ai_analysis_results.prompt_tokens + completion_tokens` | Permanent |
| **Error rate by provider** | Application logs + alert_logs | 90 days (MySQL) |
| **Cache hit rate** | `ai_analysis_results` WHERE cached=TRUE vs total | Permanent |
| **Avg generation time** | `ai_analysis_results` — derived from generated_at vs request time | Permanent |

### 11.3 Dashboard Admin API Stubs

```
GET  /admin/ai-usage/summary?days=30
  → { total_requests, total_cost_usd, cache_hit_pct, avg_gen_ms, by_tier: {...} }

GET  /admin/ai-usage/by-model?days=30
  → [ { model_provider, model_name, requests, total_tokens, total_cost } ]

GET  /admin/ai-usage/errors?days=7
  → [ { provider, error_count, error_rate_pct, last_error_at } ]

GET  /admin/ai-usage/budget
  → { current_spend, monthly_budget, usage_pct, alert_level, projected_month_end }

GET  /admin/ai-usage/recent?limit=50
  → [ { user_id, symbol, signal_type, model, cost, generated_at, cached } ]
```

---

## 12. Cost Projections

### 12.1 Per-Model Cost Breakdown

| Model | Input $/1K tok | Output $/1K tok | Est. Input Tokens | Est. Output Tokens | Cost/Analysis |
|---|---|---|---|---|---|
| DeepSeek V4-Flash | $0.00014 | $0.00028 | 1,500 | 800 | **$0.000434** |
| DeepSeek V4-Pro | $0.000435 | $0.00087 | 1,500 | 800 | **$0.001349** |
| GPT-5.4-mini | $0.00075 | $0.00450 | 1,500 | 800 | **$0.004725** |
| GPT-5.4 | $0.00250 | $0.01500 | 1,500 | 800 | **$0.015750** |
| Claude Haiku 4.5 | $0.00100 | $0.00500 | 1,500 | 800 | **$0.005500** |
| Claude Sonnet 4.6 | $0.00300 | $0.01500 | 1,500 | 800 | **$0.016500** |
| Gemini 2.5 Flash | $0.00030 | $0.00150 | 1,500 | 800 | **$0.001650** |
| Ollama (Qwen 2.5 7B) | $0.00 | $0.00 | — | — | **$0.00** |
| RuleBasedAnalyzer | $0.00 | $0.00 | — | — | **$0.00** |

### 12.2 Monthly Cost at Scale

| Users | Free (0 analy) | Basic (10/mo × DS Flash) | Pro (50/mo × Claude Haiku) | **Total/Month** |
|---|---|---|---|---|
| 100 | 60 × $0 | 30 × $0.0043 | 10 × $0.275 | **~$3.30** |
| 1,000 | 600 × $0 | 300 × $0.043 | 100 × $2.75 | **~$33.00** |
| 10,000 | 6,000 × $0 | 3,000 × $0.43 | 1,000 × $27.50 | **~$330.00** |
| 100,000 | 60,000 × $0 | 30,000 × $4.30 | 10,000 × $275.00 | **~$3,300.00** |

*Assumptions: 60% Free / 30% Basic / 10% Pro split, each user uses full daily quota.*

### 12.3 Break-Even vs Rule-Based Approach

**Rule-based only**: $0/month (no LLM costs). But:
- Zero differentiation from competitors
- No persuasive reason to upgrade from Free → Basic → Pro
- Cannot generate nuanced stop-loss/target suggestions

**LLM-powered (this design)**:
- Basic tier: $0.0043/analysis × 10/day × 30 days = **$1.29/user/month** (vs $9.99 revenue = **7.7x ROI**)
- Pro tier: $0.0055/analysis × 50/day × 30 days = **$8.25/user/month** (vs $29.99 revenue = **3.6x ROI**)
- Total AI cost as % of revenue: ~13% (Basic) to ~27% (Pro)
- At 1,000 users: $33/mo cost vs $9,400/mo revenue = **0.35% of revenue**

**Recommended approach**: The LLM cost is negligible (<1% of revenue at scale). The differentiation and conversion uplift far outweigh the cost.

### 12.4 Model Downgrade on Budget Exhaustion

When the monthly budget is exhausted (e.g., $100/month cap):

```
Tier     Normal Model       →  Budget-Exhausted Model
───────────────────────────────────────────────────────
Free     RuleBased          →  RuleBased (no change)
Basic    DeepSeek V4-Flash  →  Ollama Qwen 2.5 7B → RuleBased
Pro      Claude Haiku 4.5   →  DeepSeek V4-Flash → RuleBased
```

This is implemented by overriding `TIER_PROVIDER_CHAINS` when `check_monthly_budget().alert_level == "exceeded"`.

---

## Appendix A: File Structure

```
backend/app/services/
├── ai_analysis_service.py            # Main orchestrator (§10)
├── ai_providers/
│   ├── __init__.py
│   ├── base.py                       # BaseLLMProvider, AIAnalysisResult, AIRequest (§2.1)
│   ├── openai_provider.py            # OpenAIProvider (§2.2)
│   ├── deepseek_provider.py          # DeepSeekProvider (§2.3)
│   ├── anthropic_provider.py         # AnthropicProvider (§2.4)
│   ├── ollama_provider.py            # OllamaProvider (§2.5)
│   ├── factory.py                    # ProviderFactory (§2.6)
│   ├── router.py                     # AIRouter, ProviderChain (§3)
│   ├── prompt_builder.py             # PromptBuilder + templates (§4)
│   ├── schema.py                     # OUTPUT_JSON_SCHEMA (§5)
│   ├── validator.py                  # AnalysisValidator (§6)
│   ├── cache.py                      # AIAnalysisCache (§7)
│   ├── rate_limiter.py               # AIRateLimiter (§8)
│   └── rule_based_analyzer.py        # RuleBasedAnalyzer (§9)
```

## Appendix B: Environment Variables

```bash
# AI Provider API Keys
AI_OPENAI_API_KEY=sk-...
AI_DEEPSEEK_API_KEY=sk-...
AI_ANTHROPIC_API_KEY=sk-ant-...
AI_GEMINI_API_KEY=...

# Local LLM
AI_OLLAMA_HOST=http://localhost:11434
AI_OLLAMA_TIMEOUT=30.0

# Feature Flags
AI_ANALYSIS_ENABLED=true

# Rate Limits
AI_DAILY_LIMIT_FREE=0
AI_DAILY_LIMIT_BASIC=10
AI_DAILY_LIMIT_PRO=50

# Cost Control
AI_MAX_COST_PER_ANALYSIS_USD=0.05
AI_MONTHLY_BUDGET_USD=100.0
AI_BUDGET_WARN_THRESHOLD_PCT=80.0

# Caching
AI_CACHE_TTL_SECONDS=86400
```

---

## Appendix C: Change Log

| Version | Date | Change |
|---|---|---|
| v1 | 2026-06-09 | Initial design: 12 sections covering full AI analysis system |
