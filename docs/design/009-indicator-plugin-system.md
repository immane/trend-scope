# 009 - Indicator Plugin System Design

> **Status**: Draft v1
> **Date**: 2026-06-09
> **Purpose**: Complete design and implementation specification for the Trend-Scope technical indicator plugin system — covering plugin architecture, base classes, data models, registry/discovery, 12 built-in indicators, multi-level parameter overrides, multi-timeframe analysis, computation service, API endpoints, performance optimization, plugin distribution, and testing.

> **References**:
> - [001-preliminary-design.md](./001-preliminary-design.md) — architecture overview & table design
> - [002-database-schema.md](./002-database-schema.md) — DDL for indicator_presets, indicator_cache, etc.
> - [004-indicator-system.md](../research/004-indicator-system.md) — library selection & formulas

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Data Models](#2-data-models)
3. [BaseIndicator Abstract Class](#3-baseindicator-abstract-class)
4. [IndicatorRegistry](#4-indicatorregistry)
5. [Built-in Indicator Implementations](#5-built-in-indicator-implementations)
   - 5.1 [SMA Indicator](#51-sma-indicator)
   - 5.2 [EMA Indicator](#52-ema-indicator)
   - 5.3 [WMA Indicator](#53-wma-indicator)
   - 5.4 [HMA Indicator](#54-hma-indicator)
   - 5.5 [MACD Indicator](#55-macd-indicator)
   - 5.6 [RSI Indicator](#56-rsi-indicator)
   - 5.7 [Bollinger Bands Indicator](#57-bollinger-bands-indicator)
   - 5.8 [ATR Indicator](#58-atr-indicator)
   - 5.9 [Volume Indicators (OBV, VWAP, Volume Profile)](#59-volume-indicators-obv-vwap-volume-profile)
   - 5.10 [Stochastic Indicator](#510-stochastic-indicator)
   - 5.11 [ADX Indicator](#511-adx-indicator)
   - 5.12 [Ichimoku Indicator](#512-ichimoku-indicator)
   - 5.13 [Fibonacci Indicator](#513-fibonacci-indicator)
   - 5.14 [Builtin Package Init](#514-builtin-package-init)
6. [Multi-Level Parameter Override System](#6-multi-level-parameter-override-system)
7. [MultiTimeframeAnalyzer](#7-multitimeframeanalyzer)
8. [Indicator Computation Service](#8-indicator-computation-service)
9. [API Endpoints](#9-api-endpoints)
10. [Performance Optimization](#10-performance-optimization)
11. [Plugin Distribution & Versioning](#11-plugin-distribution--versioning)
12. [Testing](#12-testing)

---

## 1. Architecture Overview

### 1.1 System Layers

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           API Layer (FastAPI)                                │
│  POST /analysis/{stock_id}/indicators    GET /analysis/presets               │
│  POST /admin/presets                     GET /admin/stocks/{id}/overrides    │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────────────────┐
│                       IndicatorService (Async)                               │
│  compute() / precompute_all() / get_presets() / save_preset()               │
│  Orchestrates: ParameterResolver → MultiTimeframeAnalyzer → Cache           │
└──────────┬─────────────────────┬──────────────────────┬─────────────────────┘
           │                     │                      │
┌──────────▼──────┐  ┌───────────▼──────────┐  ┌────────▼────────────────────┐
│ParameterResolver│  │MultiTimeframeAnalyzer│  │   IndicatorRegistry          │
│5-level cascade  │  │Resample + Confluence │  │   (Singleton)                │
│Request→Stock→   │  │1d→W-FRI→ME→QE       │  │                              │
│Tier→System→Lib  │  │Signal confluence     │  │  ┌──────────────────────┐   │
└─────────────────┘  └──────────────────────┘  │  │ Discovery Methods    │   │
                                                │  │ a. discover_builtin()│   │
                                                │  │ b. discover_entry_   │   │
                                                │  │    points()          │   │
                                                │  │ c. discover_custom() │   │
┌───────────────────────────────────────────────┤  └──────────────────────┘   │
│            Indicator Implementations          │                              │
│                                               │  Instance Cache:             │
│  SMA  EMA  WMA  HMA  MACD  RSI  BB  ATR      │  (name, frozenset(params))   │
│  OBV  VWAP  VolumeProfile  Stoch  ADX        │                              │
│  Ichimoku  Fibonacci                          │  Error Isolation:             │
│                                               │  One bad plugin → logged,     │
│  All use pandas-ta-classic internally         │  others still work           │
│  with TA-Lib optional acceleration            │                              │
│                                               │  Dynamic Reload for dev      │
└───────────────────────────────────────────────┴──────────────────────────────┘
```

### 1.2 Plugin Registration Flow

```
Application Startup
        │
        ▼
┌───────────────────────────────────────────────────┐
│  IndicatorRegistry startup                         │
│                                                     │
│  1. discover_builtin()                              │
│     └─► Scan backend/app/services/indicators/builtin/│
│         ├─ sma.py  → finds SMAIndicator(BaseIndicator)│
│         ├─ ema.py  → finds EMAIndicator             │
│         └─ ...     → finds remaining builtins       │
│                                                     │
│  2. discover_entry_points()                         │
│     └─► importlib.metadata.entry_points(            │
│           group="trendscope.indicators")            │
│         Finds pip-installed third-party plugins     │
│         declared via pyproject.toml entry_points     │
│                                                     │
│  3. discover_custom(path)  [optional, on-demand]    │
│     └─► Scan arbitrary directory for .py files      │
│         Loads via importlib.util                    │
│                                                     │
│  Each step wrapped in try/except:                    │
│  broken plugin → logged warning → continue          │
└───────────────────────────────────────────────────┘
```

### 1.3 Indicator Computation Flow

```
API Request: POST /analysis/SPY/indicators
Body: {indicators: [{name: "rsi", params: {length: 14}}, ...], timeframe: "1w"}
        │
        ▼
IndicatorService.compute(stock_id=1, indicators=[...], timeframe="1w")
        │
        ├─► ParameterResolver.resolve("rsi", stock_id=1, tier=pro, {length: 14})
        │     → 5-level cascade → {length: 14, overbought: 70, oversold: 30}
        │
        ├─► MultiTimeframeAnalyzer.analyze(df_daily, specs, stock_id)
        │     ├─ resample df_daily → W-FRI (if timeframe != 1d)
        │     ├─ for each indicator:
        │     │    ├─ check indicator_cache (Redis TTL 24h)
        │     │    ├─ cache miss → IndicatorRegistry.get_instance("rsi", params)
        │     │    │                → RSIIndicator.compute(df_weekly)
        │     │    │                → IndicatorResult
        │     │    └─ cache hit → return cached result
        │     └─ combine timeframe signals (confluence)
        │
        └─► MultiIndicatorResponse
              {results: {rsi: ...}, signals: {rsi_confluence: {...}}}
```

---

## 2. Data Models

### 2.1 Complete Pydantic Models

```python
"""
backend/app/services/indicators/models.py

Data models for the indicator plugin system.
All models use Pydantic v2 for validation and serialization.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, ClassVar, Optional

import pandas as pd
from pydantic import BaseModel, Field, field_validator, model_validator


# =============================================================================
# Enums
# =============================================================================


class IndicatorCategory(str, Enum):
    """Top-level classification of indicator types."""
    OVERLAP = "overlap"           # Plotted on price chart (MA, BB)
    MOMENTUM = "momentum"         # Oscillators (RSI, MACD, Stoch)
    TREND = "trend"               # Trend strength/direction (ADX, Ichimoku)
    VOLATILITY = "volatility"     # Volatility measures (ATR, BB Width)
    VOLUME = "volume"             # Volume-based (OBV, VWAP, Volume Profile)
    PATTERN = "pattern"           # Pattern recognition (Fibonacci, CDL)
    COMPOSITE = "composite"       # Multi-indicator composites


class ParamType(str, Enum):
    """Allowed parameter types for indicator params."""
    INT = "int"
    FLOAT = "float"
    BOOL = "bool"
    STR = "str"
    SELECT = "select"


class OutputType(str, Enum):
    """Visualization type for indicator output columns."""
    LINE = "line"
    HISTOGRAM = "histogram"
    BAND = "band"
    OSCILLATOR = "oscillator"


class PaneType(str, Enum):
    """Which chart pane the output renders on."""
    MAIN = "main"
    VOLUME = "volume"
    SEPARATE = "separate"


# =============================================================================
# Parameter & Output Definitions
# =============================================================================


class ParamDef(BaseModel):
    """Definition of a single indicator parameter.

    Used for auto-generating UI forms and validation.
    """
    name: str = Field(..., description="Parameter key, e.g. 'length'")
    type: ParamType = Field(..., description="Data type of the parameter")
    default: Any = Field(..., description="Default value")
    min: Optional[int | float] = Field(
        default=None, description="Minimum allowed value (int/float only)")
    max: Optional[int | float] = Field(
        default=None, description="Maximum allowed value (int/float only)")
    description: str = Field(default="", description="Human-readable description")
    required: bool = Field(default=False,
                           description="Whether this param is required")
    options: Optional[list[str]] = Field(
        default=None, description="Select options (type=select only)")

    @field_validator("options")
    @classmethod
    def _validate_select_has_options(
        cls, v: Optional[list[str]], info
    ) -> Optional[list[str]]:
        if info.data.get("type") == ParamType.SELECT and (
            v is None or len(v) == 0
        ):
            raise ValueError(
                "ParamType.SELECT requires non-empty 'options' list")
        return v


class OutputDef(BaseModel):
    """Definition of a single indicator output column."""
    name: str = Field(
        ..., description="Column name in the output DataFrame, e.g. 'rsi'")
    type: OutputType = Field(
        default=OutputType.LINE, description="Visualization type")
    display_name: str = Field(
        default="", description="Human-readable name for UI labels")
    color: str = Field(
        default="#2962FF", description="Default line/bar color (hex)")
    pane: PaneType = Field(
        default=PaneType.MAIN, description="Which chart pane this renders on")

    @field_validator("display_name", mode="before")
    @classmethod
    def _default_display_name(cls, v: str, info) -> str:
        if not v:
            return info.data.get("name", "").replace("_", " ").title()
        return v


# =============================================================================
# IndicatorMetadata
# =============================================================================


class IndicatorMetadata(BaseModel):
    """Immutable metadata for indicator discovery and UI rendering.

    Single source of truth for what an indicator is and needs/produces.
    """
    name: str = Field(
        ..., description="Unique machine name, e.g. 'rsi', 'sma'")
    display_name: str = Field(
        ..., description="Human-readable name, e.g. 'Relative Strength Index'")
    category: IndicatorCategory = Field(..., description="Indicator category")
    description: str = Field(
        default="", description="Full description (Markdown supported)")
    params: list[ParamDef] = Field(
        default_factory=list, description="Accepted parameters")
    outputs: list[OutputDef] = Field(
        default_factory=list, description="Output column definitions")
    version: str = Field(
        default="1.0.0", description="SemVer version of this indicator")
    author: str = Field(
        default="Trend-Scope", description="Author or organization")
    tags: list[str] = Field(default_factory=list, description="Search tags")
    required_columns: list[str] = Field(
        default_factory=list, description="Minimum input DF columns")
    api_version: str = Field(
        default="1.0", description="Framework API version required")
    min_bars: int = Field(
        default=1,
        description="Minimum number of bars needed to compute")


# =============================================================================
# IndicatorResult
# =============================================================================


class IndicatorResult(BaseModel):
    """Standardized output container for all indicator computations.

    The `data` DataFrame always has a DatetimeIndex and columns matching
    the `metadata.outputs[*].name` list.
    """
    model_config = {"arbitrary_types_allowed": True}

    name: str = Field(..., description="Indicator name matching metadata.name")
    params_used: dict[str, Any] = Field(
        default_factory=dict,
        description="Actual params used in computation")
    data: pd.DataFrame = Field(
        ...,
        description="Computed indicator values with DatetimeIndex")
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Extra metadata (POC price, signal flags, etc.)")

    @field_validator("data", mode="before")
    @classmethod
    def _ensure_datetime_index(cls, v: pd.DataFrame) -> pd.DataFrame:
        if not isinstance(v.index, pd.DatetimeIndex):
            raise ValueError(
                "IndicatorResult.data must have a DatetimeIndex")
        return v


# =============================================================================
# Request / Response Schemas
# =============================================================================


class IndicatorRequest(BaseModel):
    """A single indicator computation request."""
    name: str = Field(..., description="Indicator name, e.g. 'rsi', 'macd'")
    params: dict[str, Any] = Field(
        default_factory=dict, description="Parameter overrides")


class MultiIndicatorRequest(BaseModel):
    """Request body for POST /analysis/{stock_id}/indicators."""
    indicators: list[IndicatorRequest] = Field(
        ..., min_length=1, max_length=20,
        description="Indicators to compute")
    timeframe: str = Field(
        default="1d", description="Timeframe: 1d, 1w, 1M, 3M")


class IndicatorOutput(BaseModel):
    """Serialized indicator result for API response."""
    name: str
    params_used: dict[str, Any]
    latest: dict[str, Any] = Field(
        default_factory=dict, description="Most recent values")
    series: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Full series (optional, paginated)")

    @classmethod
    def from_result(
        cls, result: IndicatorResult, include_series: bool = False
    ) -> "IndicatorOutput":
        df = result.data
        latest_raw = df.iloc[-1].to_dict() if len(df) > 0 else {}
        latest = {}
        for k, v in latest_raw.items():
            if isinstance(v, (pd.Timestamp,)):
                latest[k] = v.isoformat()
            elif isinstance(v, float) and (pd.isna(v) or v != v):
                latest[k] = None
            elif isinstance(v, (int, float, str, bool, type(None))):
                latest[k] = v
            else:
                latest[k] = str(v)

        series: list[dict[str, Any]] = []
        if include_series:
            df_reset = df.reset_index()
            df_reset.columns = ["date"] + list(df.columns)
            series = df_reset.where(
                pd.notna(df_reset), None).to_dict(orient="records")
            for row in series:
                if isinstance(row.get("date"), pd.Timestamp):
                    row["date"] = row["date"].isoformat()

        return cls(
            name=result.name,
            params_used=result.params_used,
            latest=latest,
            series=series,
        )


class MultiIndicatorResponse(BaseModel):
    """Response for POST /analysis/{stock_id}/indicators."""
    stock_id: int
    stock_symbol: str
    timeframe: str
    results: dict[str, IndicatorOutput] = Field(default_factory=dict)
    signals: dict[str, Any] = Field(
        default_factory=dict,
        description="Combined signals across indicators")
    computed_at: str = Field(
        default="", description="ISO 8601 timestamp")


class IndicatorPresetCreate(BaseModel):
    """Schema for creating a preset."""
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    tier_id: Optional[int] = Field(
        default=None, description="Minimum tier; None = all tiers")
    items: dict[str, dict[str, Any]] = Field(
        ..., description="Indicator name to params mapping")


class IndicatorPresetOut(BaseModel):
    """Schema for returning a preset."""
    id: int
    name: str
    description: Optional[str]
    tier_id: Optional[int]
    is_system: bool
    items: dict[str, dict[str, Any]]
    created_at: str


class StockIndicatorOverrideCreate(BaseModel):
    """Schema for setting a per-stock override."""
    indicator_name: str = Field(..., min_length=1, max_length=100)
    params: dict[str, Any] = Field(
        ..., description="Override parameters")


class StockIndicatorOverrideOut(BaseModel):
    """Schema for returning a per-stock override."""
    id: int
    stock_id: int
    indicator_name: str
    params: dict[str, Any]


class IndicatorMetaOut(BaseModel):
    """Schema for listing available indicators (metadata only)."""
    name: str
    display_name: str
    category: str
    description: str
    params: list[ParamDef]
    outputs: list[OutputDef]
    version: str
    author: str
    tags: list[str]
    required_columns: list[str]
    min_bars: int
```


---

## 3. BaseIndicator Abstract Class

```python
"""
backend/app/services/indicators/base.py

Abstract base class for all indicator plugins.
Every indicator (built-in, third-party, or custom) MUST extend this class.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Any, ClassVar, Optional

import pandas as pd

from .models import IndicatorMetadata, IndicatorResult, ParamDef, ParamType

logger = logging.getLogger(__name__)


class BaseIndicator(ABC):
    """Abstract base class for all technical indicators.

    Subclasses must:
      1. Define `metadata` as a ClassVar[IndicatorMetadata]
      2. Implement `compute(self, df: pd.DataFrame, **params) -> IndicatorResult`
      3. Optionally override `validate_params(self, **params) -> dict`

    Lifecycle:
      - Registration: IndicatorRegistry discovers subclasses via dir scan
      - Instantiation: registry.get_instance(name, params) — cached by params hash
      - Computation: instance.compute(df) runs the indicator
    """

    metadata: ClassVar[IndicatorMetadata]

    def __init__(self, params: Optional[dict[str, Any]] = None) -> None:
        self._params: dict[str, Any] = {}
        if params:
            self._params = self.validate_params(**params)

    # ------------------------------------------------------------------
    # Abstract method — must be implemented by every indicator
    # ------------------------------------------------------------------

    @abstractmethod
    def compute(self, df: pd.DataFrame, **params) -> IndicatorResult:
        """Compute the indicator on the given OHLCV DataFrame.

        Args:
            df: DataFrame with columns matching `metadata.required_columns`
                and a DatetimeIndex.
            **params: Runtime parameter overrides (merged with instance params).

        Returns:
            IndicatorResult with computed data, params used, and metadata.

        Raises:
            ValueError: If required columns are missing.
            TypeError: If df is not a DataFrame.
        """
        ...

    # ------------------------------------------------------------------
    # Parameter validation — can be overridden per indicator
    # ------------------------------------------------------------------

    def validate_params(self, **params: Any) -> dict[str, Any]:
        """Validate and normalize parameters against metadata param definitions.

        This method:
          - Fills missing params with defaults from metadata
          - Validates types (coerces int/float where safe)
          - Enforces min/max constraints
          - Checks `required` flag
          - Validates select options

        Override for indicator-specific validation beyond the schema.

        Returns:
            Validated and normalized params dict.

        Raises:
            ValueError: On invalid param name, type, range, or missing required.
        """
        validated: dict[str, Any] = {}

        # Build a lookup from metadata.params
        param_defs: dict[str, ParamDef] = {
            p.name: p for p in self.metadata.params
        }

        # Check for unknown params
        for key in params:
            if key not in param_defs:
                raise ValueError(
                    f"Unknown parameter '{key}' for indicator "
                    f"'{self.metadata.name}'. "
                    f"Valid params: {sorted(param_defs.keys())}"
                )

        # Validate each defined param
        for pdef in self.metadata.params:
            if pdef.name in params:
                value = params[pdef.name]
            elif pdef.required:
                raise ValueError(
                    f"Required parameter '{pdef.name}' missing "
                    f"for '{self.metadata.name}'"
                )
            elif pdef.default is not None:
                value = pdef.default
            else:
                continue

            # Type coercion and validation
            value = self._coerce_param(pdef, value)

            # Range validation
            if pdef.type in (ParamType.INT, ParamType.FLOAT):
                if pdef.min is not None and value < pdef.min:
                    raise ValueError(
                        f"Param '{pdef.name}' = {value} "
                        f"below minimum {pdef.min}"
                    )
                if pdef.max is not None and value > pdef.max:
                    raise ValueError(
                        f"Param '{pdef.name}' = {value} "
                        f"above maximum {pdef.max}"
                    )

            # Select validation
            if pdef.type == ParamType.SELECT and pdef.options is not None:
                if value not in pdef.options:
                    raise ValueError(
                        f"Param '{pdef.name}' = '{value}' "
                        f"not in options: {pdef.options}"
                    )

            validated[pdef.name] = value

        return validated

    def _coerce_param(self, pdef: ParamDef, value: Any) -> Any:
        """Coerce a parameter value to its declared type."""
        if pdef.type == ParamType.INT:
            if isinstance(value, float) and value == int(value):
                return int(value)
            if not isinstance(value, int):
                raise TypeError(
                    f"Param '{pdef.name}' expected int, "
                    f"got {type(value).__name__}"
                )
            return value
        elif pdef.type == ParamType.FLOAT:
            if isinstance(value, int):
                return float(value)
            if not isinstance(value, (int, float)):
                raise TypeError(
                    f"Param '{pdef.name}' expected float, "
                    f"got {type(value).__name__}"
                )
            return float(value)
        elif pdef.type == ParamType.BOOL:
            if not isinstance(value, bool):
                raise TypeError(
                    f"Param '{pdef.name}' expected bool, "
                    f"got {type(value).__name__}"
                )
            return value
        elif pdef.type in (ParamType.STR, ParamType.SELECT):
            return str(value)
        return value

    # ------------------------------------------------------------------
    # Utility
    # ------------------------------------------------------------------

    @classmethod
    def get_metadata(cls) -> IndicatorMetadata:
        """Return the indicator metadata. Override for dynamic metadata."""
        return cls.metadata

    def get_params(self) -> dict[str, Any]:
        """Return the current validated parameter dict."""
        return dict(self._params)

    def __repr__(self) -> str:
        meta = self.metadata
        return (
            f"<{meta.display_name} v{meta.version}"
            f" params={self._params}>"
        )

    @staticmethod
    def _validate_dataframe(
        df: pd.DataFrame, required: list[str]
    ) -> None:
        """Check that df has required columns and a DatetimeIndex."""
        if not isinstance(df, pd.DataFrame):
            raise TypeError(
                f"Expected pd.DataFrame, got {type(df).__name__}")
        if len(df) == 0:
            raise ValueError("Empty DataFrame")
        missing = [c for c in required if c not in df.columns]
        if missing:
            raise ValueError(
                f"Missing required columns: {missing}. "
                f"Available: {list(df.columns)}"
            )
```

---

## 4. IndicatorRegistry

```python
"""
backend/app/services/indicators/registry.py

Central plugin registry with three discovery mechanisms:
  - discover_builtin()    — scan the builtin/ directory
  - discover_entry_points() — importlib.metadata entry_points
  - discover_custom(path) — scan an arbitrary directory

Features:
  - Singleton pattern (module-level instance)
  - Instance caching by (name, frozenset(params))
  - Error isolation: one broken plugin never crashes others
  - Dynamic reload for development
"""

from __future__ import annotations

import hashlib
import importlib
import importlib.util
import inspect
import json
import logging
import os
from pathlib import Path
from typing import Any, Optional, Type

from .base import BaseIndicator
from .models import IndicatorMetadata

logger = logging.getLogger(__name__)


class IndicatorRegistry:
    """Singleton registry for all available indicator plugins.

    Usage:
        from backend.app.services.indicators.registry import indicator_registry

        # At startup:
        indicator_registry.discover_builtin()
        indicator_registry.discover_entry_points()

        # Lookup:
        cls = indicator_registry.get("rsi")
        instance = indicator_registry.get_instance("rsi", {"length": 14})

        # List:
        all_meta = indicator_registry.list_all()
        momentum = indicator_registry.list_all(category="momentum")
    """

    _instance: Optional["IndicatorRegistry"] = None

    def __new__(cls) -> "IndicatorRegistry":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialize()
        return cls._instance

    def _initialize(self) -> None:
        self._registry: dict[str, Type[BaseIndicator]] = {}
        self._instances: dict[tuple, BaseIndicator] = {}

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------

    def register(
        self,
        indicator_class: Type[BaseIndicator],
        name: Optional[str] = None,
    ) -> Type[BaseIndicator]:
        """Register an indicator class.

        Args:
            indicator_class: A BaseIndicator subclass with metadata defined.
            name: Override the metadata.name (for aliasing).

        Returns:
            The registered class (for decorator use).

        Raises:
            TypeError: If metadata is missing.
            ValueError: If name is already registered.
        """
        if not hasattr(indicator_class, "metadata"):
            raise TypeError(
                f"{indicator_class.__name__} must define a "
                f"'metadata' ClassVar[IndicatorMetadata]"
            )

        meta: IndicatorMetadata = indicator_class.metadata
        reg_name = name or meta.name

        if reg_name in self._registry:
            existing = self._registry[reg_name]
            if existing is not indicator_class:
                raise ValueError(
                    f"Indicator '{reg_name}' already registered "
                    f"by {existing.__name__}"
                )
            return indicator_class

        self._registry[reg_name] = indicator_class
        logger.info(
            "Registered indicator: %s (%s)",
            reg_name, indicator_class.__name__,
        )
        return indicator_class

    def unregister(self, name: str) -> None:
        """Remove an indicator from the registry (for dynamic reload)."""
        self._registry.pop(name, None)
        keys_to_remove = [k for k in self._instances if k[0] == name]
        for k in keys_to_remove:
            del self._instances[k]
        logger.info("Unregistered indicator: %s", name)

    # ------------------------------------------------------------------
    # Discovery Methods
    # ------------------------------------------------------------------

    def discover_builtin(
        self,
        package_path: Optional[str] = None,
        package_name: Optional[str] = None,
    ) -> int:
        """Scan the builtin/ directory for BaseIndicator subclasses.

        Each .py file (excluding __init__.py and files starting with _) is
        imported and scanned for classes extending BaseIndicator. Failures
        in one module do not affect others.

        Args:
            package_path: Filesystem path to the builtin directory.
            package_name: Python import path prefix.

        Returns:
            Number of indicators successfully loaded.
        """
        if package_path is None:
            package_path = str(
                Path(__file__).resolve().parent / "builtin")
        if package_name is None:
            package_name = (
                "backend.app.services.indicators.builtin")

        if not os.path.isdir(package_path):
            logger.warning(
                "Builtin indicators directory not found: %s",
                package_path,
            )
            return 0

        count = 0
        for fname in sorted(os.listdir(package_path)):
            if fname.startswith("_") or not fname.endswith(".py"):
                continue

            module_name = fname[:-3]  # strip .py
            full_module = f"{package_name}.{module_name}"

            try:
                module = importlib.import_module(full_module)
                found = self._extract_indicators(module)
                count += found
                if found > 0:
                    logger.debug(
                        "Loaded %d indicator(s) from %s",
                        found, full_module,
                    )
            except Exception:
                logger.exception(
                    "Failed to load builtin indicator module "
                    "'%s' — skipping", full_module
                )

        logger.info(
            "discover_builtin: loaded %d indicators total", count)
        return count

    def discover_entry_points(
        self, group: str = "trendscope.indicators"
    ) -> int:
        """Discover indicators from installed packages via entry_points.

        A third-party package declares in pyproject.toml:

            [project.entry-points."trendscope.indicators"]
            my_custom = "my_package.indicators:MyCustomIndicator"

        The entry point value must resolve to a BaseIndicator subclass.

        Args:
            group: The entry_points group name to scan.

        Returns:
            Number of indicators loaded.
        """
        count = 0

        try:
            # Python 3.12+ style
            eps = importlib.metadata.entry_points(group=group)
        except TypeError:
            # Python 3.9-3.11 fallback
            try:
                all_eps = importlib.metadata.entry_points()
                if hasattr(all_eps, "select"):
                    eps = all_eps.select(group=group)
                else:
                    eps = all_eps.get(group, [])
            except Exception:
                logger.exception("Failed to query entry_points")
                return 0

        if not eps:
            logger.debug(
                "No entry_points found for group '%s'", group)
            return 0

        for ep in eps:
            try:
                indicator_class = ep.load()
                if (
                    not inspect.isclass(indicator_class)
                    or not issubclass(
                        indicator_class, BaseIndicator)
                ):
                    logger.warning(
                        "Entry point '%s' -> %s is not a "
                        "BaseIndicator subclass — skipping",
                        ep.name, indicator_class,
                    )
                    continue
                self.register(indicator_class)
                count += 1
                logger.info(
                    "Loaded entry_point indicator: %s from %s",
                    ep.name, ep.value,
                )
            except Exception:
                logger.exception(
                    "Failed to load entry point '%s' from '%s' "
                    "— skipping", ep.name, ep.value
                )

        logger.info(
            "discover_entry_points: loaded %d indicators", count)
        return count

    def discover_custom(
        self, path: Optional[str] = None
    ) -> int:
        """Scan a user-defined directory for indicator .py files.

        Each .py file is loaded via importlib.util. All BaseIndicator
        subclasses found are registered.

        Args:
            path: Directory path. Defaults to <indicators>/custom/.

        Returns:
            Number of indicators loaded.
        """
        if path is None:
            path = str(
                Path(__file__).resolve().parent / "custom")

        if not os.path.isdir(path):
            logger.debug(
                "Custom indicators directory not found: %s", path)
            return 0

        count = 0
        for fname in sorted(os.listdir(path)):
            if fname.startswith("_") or not fname.endswith(".py"):
                continue

            filepath = os.path.join(path, fname)
            module_name = f"custom_{fname[:-3]}"

            try:
                spec = importlib.util.spec_from_file_location(
                    module_name, filepath)
                if spec is None or spec.loader is None:
                    logger.warning(
                        "Could not create module spec for %s",
                        filepath,
                    )
                    continue
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                found = self._extract_indicators(module)
                count += found
                if found > 0:
                    logger.info(
                        "Loaded %d custom indicator(s) from %s",
                        found, filepath,
                    )
            except Exception:
                logger.exception(
                    "Failed to load custom indicator '%s' "
                    "— skipping", fname
                )

        logger.info(
            "discover_custom: loaded %d indicators from %s",
            count, path,
        )
        return count

    def _extract_indicators(self, module) -> int:
        """Scan a module for BaseIndicator subclasses and register them.

        Returns:
            Number of indicators registered from this module.
        """
        count = 0
        for _name, obj in inspect.getmembers(
            module, inspect.isclass
        ):
            if (
                not issubclass(obj, BaseIndicator)
                or obj is BaseIndicator
            ):
                continue
            if not hasattr(obj, "metadata"):
                continue
            try:
                self.register(obj)
                count += 1
            except Exception:
                logger.exception(
                    "Failed to register indicator %s",
                    obj.__name__,
                )
        return count

    # ------------------------------------------------------------------
    # Dynamic Reload (for development)
    # ------------------------------------------------------------------

    def reload_builtin(self) -> int:
        """Clear all builtin registrations and rediscover.

        Useful during development when indicator code changes.
        Does NOT affect entry_point or custom plugins.

        Returns:
            Number of indicators reloaded.
        """
        builtin_names = [
            name
            for name, cls in self._registry.items()
            if (
                hasattr(cls, "__module__")
                and "builtin" in cls.__module__
            )
        ]
        for name in builtin_names:
            self.unregister(name)

        # Clear importlib cache for builtin modules
        modules_to_clear = [
            mod
            for mod in list(importlib.sys.modules.keys())
            if "indicators.builtin" in mod
        ]
        for mod in modules_to_clear:
            importlib.sys.modules.pop(mod, None)

        return self.discover_builtin()

    # ------------------------------------------------------------------
    # Lookup
    # ------------------------------------------------------------------

    def get(
        self, name: str
    ) -> Optional[Type[BaseIndicator]]:
        """Get an indicator class by name.

        Returns None if not found (caller should handle gracefully).
        """
        return self._registry.get(name)

    def get_instance(
        self,
        name: str,
        params: Optional[dict[str, Any]] = None,
    ) -> BaseIndicator:
        """Get or create a configured indicator instance.

        Instances are cached by (name, frozenset(params)) so that
        computing the same indicator with the same params across many
        stocks reuses the same instance.

        Args:
            name: Indicator name (matches metadata.name).
            params: Parameter overrides dict.

        Returns:
            Configured BaseIndicator instance.

        Raises:
            ValueError: If indicator name is not registered.
        """
        p = params or {}
        cache_key = (name, frozenset(sorted(p.items())))

        if cache_key not in self._instances:
            cls = self._registry.get(name)
            if cls is None:
                available = sorted(self._registry.keys())
                raise ValueError(
                    f"Indicator '{name}' not found. "
                    f"Available: {available}"
                )
            self._instances[cache_key] = cls(p)
            logger.debug(
                "Created instance: %s with params %s", name, p)

        return self._instances[cache_key]

    # ------------------------------------------------------------------
    # Listing
    # ------------------------------------------------------------------

    def list_all(
        self, category: Optional[str] = None
    ) -> list[IndicatorMetadata]:
        """Return metadata for all registered indicators.

        Args:
            category: Filter by IndicatorCategory value (e.g. 'momentum').

        Returns:
            List of IndicatorMetadata sorted by display_name.
        """
        metas = [
            cls.metadata for cls in self._registry.values()]
        if category:
            metas = [
                m for m in metas
                if m.category.value == category
            ]
        return sorted(metas, key=lambda m: m.display_name)

    def list_names(
        self, category: Optional[str] = None
    ) -> list[str]:
        """Return indicator names, optionally filtered by category."""
        if category:
            return sorted(
                name
                for name, cls in self._registry.items()
                if cls.metadata.category.value == category
            )
        return sorted(self._registry.keys())

    def list_by_category(self) -> dict[str, list[str]]:
        """Group indicator names by category.

        Returns:
            e.g. {
                "overlap": ["ema", "hma", "sma", "wma"],
                "momentum": ["macd", "rsi", ...], ...
            }
        """
        grouped: dict[str, list[str]] = {}
        for name, cls in self._registry.items():
            cat = cls.metadata.category.value
            grouped.setdefault(cat, []).append(name)
        return {
            k: sorted(v)
            for k, v in sorted(grouped.items())
        }

    def count(self) -> int:
        """Return total number of registered indicators."""
        return len(self._registry)

    # ------------------------------------------------------------------
    # Utility
    # ------------------------------------------------------------------

    @staticmethod
    def params_hash(params: dict[str, Any]) -> str:
        """Generate SHA-256 hash for a params dict (sorted, stable).

        Used for cache keys in indicator_cache table.
        """
        canonical = json.dumps(
            params, sort_keys=True, default=str)
        return hashlib.sha256(canonical.encode()).hexdigest()

    def clear_instance_cache(self) -> None:
        """Clear all cached indicator instances."""
        self._instances.clear()

    def __len__(self) -> int:
        return len(self._registry)


# =============================================================================
# Global singleton
# =============================================================================

indicator_registry = IndicatorRegistry()


# =============================================================================
# Decorator for explicit registration
# =============================================================================

def register_indicator(name: Optional[str] = None):
    """Decorator to explicitly register an indicator class.

    Usage:
        @register_indicator(name="my_rsi")
        class MyRSI(BaseIndicator):
            metadata = IndicatorMetadata(name="my_rsi", ...)
            ...
    """
    def decorator(cls):
        indicator_registry.register(cls, name=name)
        return cls
    return decorator
```


---

## 5. Built-in Indicator Implementations

All built-in indicators use **pandas-ta-classic** as the primary computation engine, with optional **TA-Lib** acceleration (automatically detected by pandas-ta). Each includes full metadata, compute(), parameter validation, error handling, and output column definitions.

### 5.1 SMA Indicator

```python
"""
backend/app/services/indicators/builtin/sma.py

Simple Moving Average indicator.
"""

from typing import ClassVar

import pandas as pd

from ..base import BaseIndicator
from ..models import (
    IndicatorCategory,
    IndicatorMetadata,
    IndicatorResult,
    OutputDef,
    OutputType,
    PaneType,
    ParamDef,
    ParamType,
)


class SMAIndicator(BaseIndicator):
    metadata = IndicatorMetadata(
        name="sma",
        display_name="Simple Moving Average",
        category=IndicatorCategory.OVERLAP,
        description=(
            "Calculates the arithmetic mean of closing prices over a "
            "specified period. Equal weight to all N periods. "
            "Lag = (N-1)/2 periods. Best used for trend identification "
            "and dynamic support/resistance."
        ),
        params=[
            ParamDef(
                name="length", type=ParamType.INT, default=20,
                min=1, max=500, required=True,
                description="Number of periods for the moving average",
            ),
        ],
        outputs=[
            OutputDef(
                name="sma", type=OutputType.LINE, display_name="SMA",
                color="#2962FF", pane=PaneType.MAIN,
            ),
        ],
        version="1.0.0",
        author="Trend-Scope",
        tags=["overlap", "trend", "moving_average", "benchmark"],
        required_columns=["close"],
        min_bars=2,
    )

    def compute(
        self, df: pd.DataFrame, **params
    ) -> IndicatorResult:
        merged = self._merge_params(params)
        self._validate_dataframe(df, ["close"])

        length = merged["length"]
        result_df = pd.DataFrame(
            {"sma": df["close"].rolling(window=length).mean()},
            index=df.index,
        )

        return IndicatorResult(
            name="sma",
            params_used=merged,
            data=result_df,
        )

    def _merge_params(self, runtime: dict) -> dict:
        base = dict(getattr(self, "_params", {}))
        base.update(runtime)
        for p in self.metadata.params:
            if p.name not in base and p.default is not None:
                base[p.name] = p.default
        return base
```

### 5.2 EMA Indicator

```python
"""
backend/app/services/indicators/builtin/ema.py

Exponential Moving Average indicator.
"""

from typing import ClassVar

import pandas as pd

from ..base import BaseIndicator
from ..models import (
    IndicatorCategory,
    IndicatorMetadata,
    IndicatorResult,
    OutputDef,
    OutputType,
    PaneType,
    ParamDef,
    ParamType,
)


class EMAIndicator(BaseIndicator):
    metadata = IndicatorMetadata(
        name="ema",
        display_name="Exponential Moving Average",
        category=IndicatorCategory.OVERLAP,
        description=(
            "Gives more weight to recent prices using an exponential "
            "decay factor alpha = 2/(N+1). Reacts faster to price "
            "changes than SMA. Uses span=length with adjust=False, "
            "matching TradingView and TA-Lib output."
        ),
        params=[
            ParamDef(
                name="length", type=ParamType.INT, default=20,
                min=1, max=500, required=True,
                description="Number of periods for the EMA",
            ),
        ],
        outputs=[
            OutputDef(
                name="ema", type=OutputType.LINE, display_name="EMA",
                color="#00C853", pane=PaneType.MAIN,
            ),
        ],
        version="1.0.0",
        author="Trend-Scope",
        tags=["overlap", "trend", "moving_average", "responsive"],
        required_columns=["close"],
        min_bars=2,
    )

    def compute(
        self, df: pd.DataFrame, **params
    ) -> IndicatorResult:
        merged = self._merge_params(params)
        self._validate_dataframe(df, ["close"])

        length = merged["length"]
        close = df["close"]

        try:
            # Use pandas-ta-classic if available for TA-Lib acceleration
            import pandas_ta as ta
            ema_series = ta.ema(close, length=length)
        except (ImportError, Exception):
            ema_series = close.ewm(
                span=length, adjust=False).mean()

        result_df = pd.DataFrame(
            {"ema": ema_series}, index=df.index)

        return IndicatorResult(
            name="ema",
            params_used=merged,
            data=result_df,
        )

    def _merge_params(self, runtime: dict) -> dict:
        base = dict(getattr(self, "_params", {}))
        base.update(runtime)
        for p in self.metadata.params:
            if p.name not in base and p.default is not None:
                base[p.name] = p.default
        return base
```

### 5.3 WMA Indicator

```python
"""
backend/app/services/indicators/builtin/wma.py

Weighted Moving Average indicator.
"""

from typing import ClassVar

import numpy as np
import pandas as pd

from ..base import BaseIndicator
from ..models import (
    IndicatorCategory,
    IndicatorMetadata,
    IndicatorResult,
    OutputDef,
    OutputType,
    PaneType,
    ParamDef,
    ParamType,
)


class WMAIndicator(BaseIndicator):
    metadata = IndicatorMetadata(
        name="wma",
        display_name="Weighted Moving Average",
        category=IndicatorCategory.OVERLAP,
        description=(
            "Linear weighting — most recent bar has weight N, "
            "oldest has weight 1. Denominator is the triangular "
            "number N(N+1)/2. Provides better responsiveness than "
            "SMA while being smoother than EMA."
        ),
        params=[
            ParamDef(
                name="length", type=ParamType.INT, default=20,
                min=1, max=500, required=True,
                description="Number of periods for the WMA",
            ),
        ],
        outputs=[
            OutputDef(
                name="wma", type=OutputType.LINE, display_name="WMA",
                color="#FF6D00", pane=PaneType.MAIN,
            ),
        ],
        version="1.0.0",
        author="Trend-Scope",
        tags=["overlap", "trend", "moving_average", "weighted"],
        required_columns=["close"],
        min_bars=2,
    )

    def compute(
        self, df: pd.DataFrame, **params
    ) -> IndicatorResult:
        merged = self._merge_params(params)
        self._validate_dataframe(df, ["close"])

        length = int(merged["length"])
        close = df["close"]

        weights = np.arange(1, length + 1, dtype=np.float64)
        weight_sum = weights.sum()

        def _wma_window(x: np.ndarray) -> float:
            return float(np.dot(x, weights) / weight_sum)

        wma_series = close.rolling(window=length).apply(
            _wma_window, raw=True)

        result_df = pd.DataFrame(
            {"wma": wma_series}, index=df.index)

        return IndicatorResult(
            name="wma",
            params_used=merged,
            data=result_df,
        )

    def _merge_params(self, runtime: dict) -> dict:
        base = dict(getattr(self, "_params", {}))
        base.update(runtime)
        for p in self.metadata.params:
            if p.name not in base and p.default is not None:
                base[p.name] = p.default
        return base
```

### 5.4 HMA Indicator

```python
"""
backend/app/services/indicators/builtin/hma.py

Hull Moving Average indicator — near-zero lag.
"""

from typing import ClassVar

import numpy as np
import pandas as pd

from ..base import BaseIndicator
from ..models import (
    IndicatorCategory,
    IndicatorMetadata,
    IndicatorResult,
    OutputDef,
    OutputType,
    PaneType,
    ParamDef,
    ParamType,
)


class HMAIndicator(BaseIndicator):
    metadata = IndicatorMetadata(
        name="hma",
        display_name="Hull Moving Average",
        category=IndicatorCategory.OVERLAP,
        description=(
            "Created by Alan Hull in 2005. Two-stage process that "
            "eliminates lag: WMA(2*WMA(N/2) - WMA(N), sqrt(N)). "
            "Result: extremely smooth, near-zero lag. Excellent for "
            "trend following without the delay of traditional MAs."
        ),
        params=[
            ParamDef(
                name="length", type=ParamType.INT, default=20,
                min=2, max=500, required=True,
                description="Period for the HMA (must be >= 2)",
            ),
        ],
        outputs=[
            OutputDef(
                name="hma", type=OutputType.LINE, display_name="HMA",
                color="#AA00FF", pane=PaneType.MAIN,
            ),
        ],
        version="1.0.0",
        author="Trend-Scope",
        tags=["overlap", "trend", "moving_average", "zero_lag", "hull"],
        required_columns=["close"],
        min_bars=2,
    )

    @staticmethod
    def _wma(series: pd.Series, length: int) -> pd.Series:
        """Compute Weighted Moving Average."""
        weights = np.arange(
            1, length + 1, dtype=np.float64)
        weight_sum = weights.sum()

        def _apply(x: np.ndarray) -> float:
            return float(np.dot(x, weights) / weight_sum)

        return series.rolling(window=length).apply(
            _apply, raw=True)

    def compute(
        self, df: pd.DataFrame, **params
    ) -> IndicatorResult:
        merged = self._merge_params(params)
        self._validate_dataframe(df, ["close"])

        length = int(merged["length"])
        close = df["close"]

        if length < 2:
            raise ValueError(
                f"HMA requires length >= 2, got {length}")

        half_length = max(1, length // 2)
        sqrt_length = max(1, int(np.sqrt(length)))

        try:
            import pandas_ta as ta
            hma_series = ta.hma(close, length=length)
        except (ImportError, Exception):
            wma_half = self._wma(close, half_length)
            wma_full = self._wma(close, length)
            raw_hull = 2.0 * wma_half - wma_full
            hma_series = self._wma(raw_hull, sqrt_length)

        result_df = pd.DataFrame(
            {"hma": hma_series}, index=df.index)

        return IndicatorResult(
            name="hma",
            params_used=merged,
            data=result_df,
        )

    def _merge_params(self, runtime: dict) -> dict:
        base = dict(getattr(self, "_params", {}))
        base.update(runtime)
        for p in self.metadata.params:
            if p.name not in base and p.default is not None:
                base[p.name] = p.default
        return base
```


### 5.5 MACD Indicator

```python
"""
backend/app/services/indicators/builtin/macd.py

MACD — Moving Average Convergence Divergence.
"""

from typing import ClassVar

import pandas as pd

from ..base import BaseIndicator
from ..models import (
    IndicatorCategory,
    IndicatorMetadata,
    IndicatorResult,
    OutputDef,
    OutputType,
    PaneType,
    ParamDef,
    ParamType,
)


class MACDIndicator(BaseIndicator):
    metadata = IndicatorMetadata(
        name="macd",
        display_name="MACD",
        category=IndicatorCategory.MOMENTUM,
        description=(
            "Moving Average Convergence Divergence. Three components "
            "from two EMAs:\n"
            "- MACD Line = EMA(fast) - EMA(slow)\n"
            "- Signal Line = EMA(MACD Line, signal)\n"
            "- Histogram = MACD Line - Signal Line\n\n"
            "Signals: MACD crosses above Signal -> bullish. "
            "Below -> bearish. Histogram above zero and rising -> "
            "uptrend accelerating."
        ),
        params=[
            ParamDef(
                name="fast", type=ParamType.INT, default=12,
                min=2, max=200,
                description="Fast EMA period"),
            ParamDef(
                name="slow", type=ParamType.INT, default=26,
                min=2, max=500,
                description="Slow EMA period"),
            ParamDef(
                name="signal", type=ParamType.INT, default=9,
                min=1, max=100,
                description="Signal line smoothing period"),
        ],
        outputs=[
            OutputDef(
                name="macd", type=OutputType.LINE,
                display_name="MACD Line", color="#2962FF",
                pane=PaneType.SEPARATE),
            OutputDef(
                name="macd_signal", type=OutputType.LINE,
                display_name="Signal Line", color="#FF6D00",
                pane=PaneType.SEPARATE),
            OutputDef(
                name="macd_hist", type=OutputType.HISTOGRAM,
                display_name="Histogram", color="#B0BEC5",
                pane=PaneType.SEPARATE),
        ],
        version="1.0.0",
        author="Trend-Scope",
        tags=["momentum", "oscillator", "trend", "divergence"],
        required_columns=["close"],
        min_bars=26,
    )

    def compute(
        self, df: pd.DataFrame, **params
    ) -> IndicatorResult:
        merged = self._merge_params(params)
        self._validate_dataframe(df, ["close"])

        fast = int(merged["fast"])
        slow = int(merged["slow"])
        signal = int(merged["signal"])
        close = df["close"]

        if fast >= slow:
            raise ValueError(
                f"MACD fast ({fast}) must be < slow ({slow})")

        try:
            import pandas_ta as ta
            macd_df = ta.macd(
                close, fast=fast, slow=slow, signal=signal)
            # Columns: MACD_12_26_9, MACDs_12_26_9, MACDh_12_26_9
            cols = list(macd_df.columns)
            macd_col = next(
                (c for c in cols
                 if c.startswith("MACD_")
                 and not c.startswith("MACDs_")
                 and not c.startswith("MACDh_")), cols[0])
            signal_col = next(
                (c for c in cols if c.startswith("MACDs_")),
                cols[1] if len(cols) > 1 else None)
            hist_col = next(
                (c for c in cols if c.startswith("MACDh_")),
                cols[2] if len(cols) > 2 else None)

            result = pd.DataFrame(index=df.index)
            result["macd"] = macd_df[macd_col]
            result["macd_signal"] = (
                macd_df[signal_col] if signal_col
                else pd.Series(float("nan"), index=df.index))
            result["macd_hist"] = (
                macd_df[hist_col] if hist_col
                else pd.Series(float("nan"), index=df.index))
        except (ImportError, Exception):
            ema_fast = close.ewm(
                span=fast, adjust=False).mean()
            ema_slow = close.ewm(
                span=slow, adjust=False).mean()
            macd_line = ema_fast - ema_slow
            signal_line = macd_line.ewm(
                span=signal, adjust=False).mean()
            histogram = macd_line - signal_line
            result = pd.DataFrame({
                "macd": macd_line,
                "macd_signal": signal_line,
                "macd_hist": histogram,
            }, index=df.index)

        return IndicatorResult(
            name="macd",
            params_used=merged,
            data=result,
        )

    def _merge_params(self, runtime: dict) -> dict:
        base = dict(getattr(self, "_params", {}))
        base.update(runtime)
        for p in self.metadata.params:
            if p.name not in base and p.default is not None:
                base[p.name] = p.default
        return base
```

### 5.6 RSI Indicator

```python
"""
backend/app/services/indicators/builtin/rsi.py

Relative Strength Index — Wilder's smoothing oscillator.
"""

from typing import ClassVar

import pandas as pd

from ..base import BaseIndicator
from ..models import (
    IndicatorCategory,
    IndicatorMetadata,
    IndicatorResult,
    OutputDef,
    OutputType,
    PaneType,
    ParamDef,
    ParamType,
)


class RSIIndicator(BaseIndicator):
    metadata = IndicatorMetadata(
        name="rsi",
        display_name="Relative Strength Index",
        category=IndicatorCategory.MOMENTUM,
        description=(
            "Measures speed and change of price movements on a 0-100 "
            "scale. Uses Wilder's smoothing (alpha=1/length).\n\n"
            "Levels: >70 Overbought, <30 Oversold, 50 Neutral.\n"
            "In strong trends, RSI can stay overbought/oversold for "
            "extended periods."
        ),
        params=[
            ParamDef(
                name="length", type=ParamType.INT, default=14,
                min=2, max=200, required=True,
                description="Lookback period"),
            ParamDef(
                name="overbought", type=ParamType.INT, default=70,
                min=50, max=100,
                description="Overbought threshold"),
            ParamDef(
                name="oversold", type=ParamType.INT, default=30,
                min=0, max=50,
                description="Oversold threshold"),
        ],
        outputs=[
            OutputDef(
                name="rsi", type=OutputType.LINE,
                display_name="RSI", color="#2962FF",
                pane=PaneType.SEPARATE),
            OutputDef(
                name="rsi_signal", type=OutputType.LINE,
                display_name="RSI Signal", color="#757575",
                pane=PaneType.SEPARATE),
        ],
        version="1.0.0",
        author="Trend-Scope",
        tags=["momentum", "oscillator", "overbought",
              "oversold", "wilder"],
        required_columns=["close"],
        min_bars=14,
    )

    def compute(
        self, df: pd.DataFrame, **params
    ) -> IndicatorResult:
        merged = self._merge_params(params)
        self._validate_dataframe(df, ["close"])

        length = int(merged["length"])
        overbought = int(merged["overbought"])
        oversold = int(merged["oversold"])
        close = df["close"]

        try:
            import pandas_ta as ta
            rsi_series = ta.rsi(close, length=length)
        except (ImportError, Exception):
            delta = close.diff()
            gain = delta.clip(lower=0)
            loss = (-delta).clip(lower=0)
            avg_gain = gain.ewm(
                alpha=1.0 / length, adjust=False).mean()
            avg_loss = loss.ewm(
                alpha=1.0 / length, adjust=False).mean()
            rs = avg_gain / avg_loss.replace(0, float("nan"))
            rsi_series = 100.0 - (100.0 / (1.0 + rs))

        # Signal classification
        signal = pd.Series(
            "neutral", index=df.index, dtype="object")
        signal[rsi_series > overbought] = "overbought"
        signal[rsi_series < oversold] = "oversold"

        result = pd.DataFrame({
            "rsi": rsi_series,
            "rsi_signal": signal,
        }, index=df.index)

        return IndicatorResult(
            name="rsi",
            params_used=merged,
            data=result,
        )

    def _merge_params(self, runtime: dict) -> dict:
        base = dict(getattr(self, "_params", {}))
        base.update(runtime)
        for p in self.metadata.params:
            if p.name not in base and p.default is not None:
                base[p.name] = p.default
        return base
```

### 5.7 Bollinger Bands Indicator

```python
"""
backend/app/services/indicators/builtin/bollinger.py

Bollinger Bands — volatility-based price envelope.
"""

from typing import ClassVar

import pandas as pd

from ..base import BaseIndicator
from ..models import (
    IndicatorCategory,
    IndicatorMetadata,
    IndicatorResult,
    OutputDef,
    OutputType,
    PaneType,
    ParamDef,
    ParamType,
)


class BollingerBandsIndicator(BaseIndicator):
    metadata = IndicatorMetadata(
        name="bollinger",
        display_name="Bollinger Bands",
        category=IndicatorCategory.VOLATILITY,
        description=(
            "Price envelope based on standard deviation from a moving "
            "average.\n"
            "- Middle Band = SMA(N)\n"
            "- Upper/Lower Band = Middle +/- K*sigma\n"
            "- %B = (Price - Lower) / (Upper - Lower)\n"
            "- Bandwidth = (Upper - Lower) / Middle\n\n"
            "Bollinger Squeeze: Bandwidth at multi-period low "
            "signals impending volatility expansion."
        ),
        params=[
            ParamDef(
                name="length", type=ParamType.INT, default=20,
                min=2, max=200, required=True,
                description="SMA period"),
            ParamDef(
                name="std", type=ParamType.FLOAT, default=2.0,
                min=0.5, max=5.0,
                description="Standard deviation multiplier"),
        ],
        outputs=[
            OutputDef(
                name="bb_upper", type=OutputType.LINE,
                display_name="Upper Band", color="#FF1744",
                pane=PaneType.MAIN),
            OutputDef(
                name="bb_middle", type=OutputType.LINE,
                display_name="Middle Band", color="#2962FF",
                pane=PaneType.MAIN),
            OutputDef(
                name="bb_lower", type=OutputType.LINE,
                display_name="Lower Band", color="#00C853",
                pane=PaneType.MAIN),
            OutputDef(
                name="bb_pct_b", type=OutputType.LINE,
                display_name="%B", color="#FF6D00",
                pane=PaneType.SEPARATE),
            OutputDef(
                name="bb_bandwidth", type=OutputType.LINE,
                display_name="Bandwidth", color="#AA00FF",
                pane=PaneType.SEPARATE),
        ],
        version="1.0.0",
        author="Trend-Scope",
        tags=["volatility", "overlap", "envelope",
              "squeeze", "bollinger"],
        required_columns=["close"],
        min_bars=20,
    )

    def compute(
        self, df: pd.DataFrame, **params
    ) -> IndicatorResult:
        merged = self._merge_params(params)
        self._validate_dataframe(df, ["close"])

        length = int(merged["length"])
        std_mult = float(merged["std"])
        close = df["close"]

        try:
            import pandas_ta as ta
            bb_df = ta.bbands(
                close, length=length, std=std_mult)
            cols = list(bb_df.columns)
            lower_col = next(
                (c for c in cols if c.startswith("BBL_")),
                cols[0] if len(cols) > 0 else None)
            mid_col = next(
                (c for c in cols if c.startswith("BBM_")),
                cols[1] if len(cols) > 1 else None)
            upper_col = next(
                (c for c in cols if c.startswith("BBU_")),
                cols[2] if len(cols) > 2 else None)
            bw_col = next(
                (c for c in cols if c.startswith("BBB_")),
                cols[3] if len(cols) > 3 else None)
            pctb_col = next(
                (c for c in cols if c.startswith("BBP_")),
                cols[4] if len(cols) > 4 else None)

            nan_series = pd.Series(
                float("nan"), index=df.index)
            result = pd.DataFrame(index=df.index)
            result["bb_lower"] = (
                bb_df[lower_col] if lower_col
                else nan_series)
            result["bb_middle"] = (
                bb_df[mid_col] if mid_col else nan_series)
            result["bb_upper"] = (
                bb_df[upper_col] if upper_col
                else nan_series)
            result["bb_bandwidth"] = (
                bb_df[bw_col] if bw_col else nan_series)
            result["bb_pct_b"] = (
                bb_df[pctb_col] if pctb_col
                else nan_series)
        except (ImportError, Exception):
            middle = close.rolling(window=length).mean()
            sigma = close.rolling(
                window=length).std(ddof=0)
            upper = middle + std_mult * sigma
            lower = middle - std_mult * sigma
            pct_b = (close - lower) / (
                upper - lower).replace(0, float("nan"))
            bandwidth = (upper - lower) / middle.replace(
                0, float("nan"))
            result = pd.DataFrame({
                "bb_lower": lower,
                "bb_middle": middle,
                "bb_upper": upper,
                "bb_pct_b": pct_b,
                "bb_bandwidth": bandwidth,
            }, index=df.index)

        return IndicatorResult(
            name="bollinger",
            params_used=merged,
            data=result,
        )

    def _merge_params(self, runtime: dict) -> dict:
        base = dict(getattr(self, "_params", {}))
        base.update(runtime)
        for p in self.metadata.params:
            if p.name not in base and p.default is not None:
                base[p.name] = p.default
        return base
```

### 5.8 ATR Indicator

```python
"""
backend/app/services/indicators/builtin/atr.py

Average True Range — volatility measurement.
"""

from typing import ClassVar

import pandas as pd

from ..base import BaseIndicator
from ..models import (
    IndicatorCategory,
    IndicatorMetadata,
    IndicatorResult,
    OutputDef,
    OutputType,
    PaneType,
    ParamDef,
    ParamType,
)


class ATRIndicator(BaseIndicator):
    metadata = IndicatorMetadata(
        name="atr",
        display_name="Average True Range",
        category=IndicatorCategory.VOLATILITY,
        description=(
            "Measures market volatility by decomposing the entire "
            "range of an asset price for a given period. Uses True "
            "Range = max(high-low, |high-prev_close|, "
            "|low-prev_close|) smoothed with Wilder's method.\n\n"
            "Higher ATR = higher volatility. Used for position "
            "sizing and stop-loss placement."
        ),
        params=[
            ParamDef(
                name="length", type=ParamType.INT, default=14,
                min=1, max=200, required=True,
                description="ATR lookback period"),
        ],
        outputs=[
            OutputDef(
                name="atr", type=OutputType.LINE,
                display_name="ATR", color="#FF6D00",
                pane=PaneType.SEPARATE),
            OutputDef(
                name="atr_pct", type=OutputType.LINE,
                display_name="ATR %", color="#AA00FF",
                pane=PaneType.SEPARATE),
        ],
        version="1.0.0",
        author="Trend-Scope",
        tags=["volatility", "risk", "stop_loss", "wilder"],
        required_columns=["high", "low", "close"],
        min_bars=15,
    )

    def compute(
        self, df: pd.DataFrame, **params
    ) -> IndicatorResult:
        merged = self._merge_params(params)
        self._validate_dataframe(df, ["high", "low", "close"])

        length = int(merged["length"])
        high = df["high"]
        low = df["low"]
        close = df["close"]

        try:
            import pandas_ta as ta
            atr_series = ta.atr(
                high=high, low=low, close=close, length=length)
        except (ImportError, Exception):
            prev_close = close.shift(1)
            tr1 = high - low
            tr2 = (high - prev_close).abs()
            tr3 = (low - prev_close).abs()
            true_range = pd.concat(
                [tr1, tr2, tr3], axis=1).max(axis=1)
            atr_series = true_range.ewm(
                alpha=1.0 / length, adjust=False).mean()

        atr_pct = (
            atr_series / close.replace(0, float("nan"))
        ) * 100.0

        result = pd.DataFrame({
            "atr": atr_series,
            "atr_pct": atr_pct,
        }, index=df.index)

        return IndicatorResult(
            name="atr",
            params_used=merged,
            data=result,
        )

    def _merge_params(self, runtime: dict) -> dict:
        base = dict(getattr(self, "_params", {}))
        base.update(runtime)
        for p in self.metadata.params:
            if p.name not in base and p.default is not None:
                base[p.name] = p.default
        return base
```


### 5.9 Volume Indicators (OBV, VWAP, Volume Profile)

```python
"""
backend/app/services/indicators/builtin/volume.py

Volume-based indicators: OBV, VWAP, Volume Profile.
"""

from typing import ClassVar, Optional

import numpy as np
import pandas as pd

from ..base import BaseIndicator
from ..models import (
    IndicatorCategory,
    IndicatorMetadata,
    IndicatorResult,
    OutputDef,
    OutputType,
    PaneType,
    ParamDef,
    ParamType,
)


# =============================================================================
# OBV Indicator
# =============================================================================


class OBVIndicator(BaseIndicator):
    """On-Balance Volume — cumulative volume signed by price direction."""

    metadata = IndicatorMetadata(
        name="obv",
        display_name="On-Balance Volume",
        category=IndicatorCategory.VOLUME,
        description=(
            "Running cumulative total of volume, signed by price "
            "direction. Divergence between OBV and price signals "
            "potential reversal.\n\n"
            "OBV rises when price closes higher (bullish volume). "
            "OBV falls when price closes lower (bearish volume)."
        ),
        params=[],
        outputs=[
            OutputDef(
                name="obv", type=OutputType.LINE,
                display_name="OBV", color="#2962FF",
                pane=PaneType.VOLUME),
        ],
        version="1.0.0",
        author="Trend-Scope",
        tags=["volume", "accumulation", "distribution",
              "divergence"],
        required_columns=["close", "volume"],
        min_bars=1,
    )

    def compute(
        self, df: pd.DataFrame, **params
    ) -> IndicatorResult:
        merged = self._merge_params(params)
        self._validate_dataframe(df, ["close", "volume"])

        try:
            import pandas_ta as ta
            obv_series = ta.obv(
                close=df["close"], volume=df["volume"])
        except (ImportError, Exception):
            direction = np.sign(df["close"].diff())
            obv_series = (
                direction * df["volume"]).fillna(0).cumsum()

        result = pd.DataFrame(
            {"obv": obv_series}, index=df.index)

        return IndicatorResult(
            name="obv", params_used=merged, data=result)

    def _merge_params(self, runtime: dict) -> dict:
        base = dict(getattr(self, "_params", {}))
        base.update(runtime)
        return base


# =============================================================================
# VWAP Indicator
# =============================================================================


class VWAPIndicator(BaseIndicator):
    """Volume-Weighted Average Price."""

    metadata = IndicatorMetadata(
        name="vwap",
        display_name="Volume-Weighted Average Price",
        category=IndicatorCategory.VOLUME,
        description=(
            "Cumulative VWAP using typical price (H+L+C)/3. "
            "Acts as dynamic support/resistance. Price above "
            "VWAP = bullish bias, below = bearish bias. "
            "Often used by institutional traders."
        ),
        params=[
            ParamDef(
                name="reset_period", type=ParamType.SELECT,
                default="none",
                options=["none", "daily", "weekly", "monthly"],
                description="When to reset VWAP accumulation"),
        ],
        outputs=[
            OutputDef(
                name="vwap", type=OutputType.LINE,
                display_name="VWAP", color="#00C853",
                pane=PaneType.MAIN),
        ],
        version="1.0.0",
        author="Trend-Scope",
        tags=["volume", "vwap", "institutional", "anchored"],
        required_columns=["high", "low", "close", "volume"],
        min_bars=1,
    )

    def compute(
        self, df: pd.DataFrame, **params
    ) -> IndicatorResult:
        merged = self._merge_params(params)
        self._validate_dataframe(
            df, ["high", "low", "close", "volume"])

        reset = merged.get("reset_period", "none")
        typical_price = (
            df["high"] + df["low"] + df["close"]) / 3.0
        pv = typical_price * df["volume"]

        if reset == "none":
            cum_pv = pv.cumsum()
            cum_vol = df["volume"].cumsum()
            vwap_series = cum_pv / cum_vol.replace(
                0, float("nan"))
        elif reset == "daily":
            vwap_series = (
                pv.groupby(df.index.date).cumsum()
                / df["volume"].groupby(df.index.date)
                .cumsum().replace(0, float("nan")))
        elif reset == "weekly":
            vwap_series = (
                pv.groupby(
                    df.index.isocalendar().week).cumsum()
                / df["volume"].groupby(
                    df.index.isocalendar().week)
                .cumsum().replace(0, float("nan")))
        elif reset == "monthly":
            vwap_series = (
                pv.groupby(df.index.month).cumsum()
                / df["volume"].groupby(df.index.month)
                .cumsum().replace(0, float("nan")))
        else:
            cum_pv = pv.cumsum()
            cum_vol = df["volume"].cumsum()
            vwap_series = cum_pv / cum_vol.replace(
                0, float("nan"))

        result = pd.DataFrame(
            {"vwap": vwap_series}, index=df.index)

        return IndicatorResult(
            name="vwap", params_used=merged, data=result)

    def _merge_params(self, runtime: dict) -> dict:
        base = dict(getattr(self, "_params", {}))
        base.update(runtime)
        for p in self.metadata.params:
            if p.name not in base and p.default is not None:
                base[p.name] = p.default
        return base


# =============================================================================
# Volume Profile Indicator
# =============================================================================


class VolumeProfileIndicator(BaseIndicator):
    """Volume Profile — distribution of volume across price levels."""

    metadata = IndicatorMetadata(
        name="volume_profile",
        display_name="Volume Profile",
        category=IndicatorCategory.VOLUME,
        description=(
            "Distribution of volume across price levels over a "
            "lookback period. Outputs POC (Point of Control), "
            "VAH (Value Area High), and VAL (Value Area Low). "
            "Key levels for support/resistance identification."
        ),
        params=[
            ParamDef(
                name="lookback", type=ParamType.INT, default=50,
                min=5, max=1000, required=True,
                description="Number of bars for volume distribution"),
            ParamDef(
                name="bins", type=ParamType.INT, default=100,
                min=10, max=500,
                description="Number of price bins for the profile"),
            ParamDef(
                name="value_area", type=ParamType.FLOAT,
                default=0.70, min=0.50, max=0.95,
                description="Value Area percentage (default 70%)"),
        ],
        outputs=[
            OutputDef(
                name="vp_poc", type=OutputType.LINE,
                display_name="POC", color="#FF1744",
                pane=PaneType.MAIN),
            OutputDef(
                name="vp_vah", type=OutputType.LINE,
                display_name="VAH", color="#FF6D00",
                pane=PaneType.MAIN),
            OutputDef(
                name="vp_val", type=OutputType.LINE,
                display_name="VAL", color="#00C853",
                pane=PaneType.MAIN),
        ],
        version="1.0.0",
        author="Trend-Scope",
        tags=["volume", "profile", "poc", "value_area",
              "support_resistance"],
        required_columns=["high", "low", "close", "volume"],
        min_bars=5,
    )

    def compute(
        self, df: pd.DataFrame, **params
    ) -> IndicatorResult:
        merged = self._merge_params(params)
        self._validate_dataframe(
            df, ["high", "low", "close", "volume"])

        lookback = int(merged["lookback"])
        bins = int(merged["bins"])
        value_area = float(merged["value_area"])
        n = len(df)

        typical_price = (
            df["high"] + df["low"] + df["close"]) / 3.0
        volume = df["volume"]

        poc_series = pd.Series(
            float("nan"), index=df.index, dtype="float64")
        vah_series = pd.Series(
            float("nan"), index=df.index, dtype="float64")
        val_series = pd.Series(
            float("nan"), index=df.index, dtype="float64")

        for i in range(lookback - 1, n):
            start = i - lookback + 1
            tp_window = typical_price.iloc[start:i + 1]
            vol_window = volume.iloc[start:i + 1]

            price_min = tp_window.min()
            price_max = tp_window.max()

            if price_min == price_max:
                poc = vah = val = price_min
            else:
                bin_edges = np.linspace(
                    price_min, price_max, bins + 1)
                profile = np.zeros(bins, dtype=np.float64)

                for j in range(len(tp_window)):
                    idx = int(np.digitize(
                        tp_window.iloc[j], bin_edges)) - 1
                    if 0 <= idx < bins:
                        profile[idx] += vol_window.iloc[j]

                total_vol = profile.sum()
                if total_vol == 0:
                    continue

                poc_idx = int(np.argmax(profile))
                poc = float(
                    bin_edges[poc_idx]
                    + bin_edges[poc_idx + 1]) / 2.0

                # Value Area: price levels around POC
                target_vol = total_vol * value_area
                accumulated = profile[poc_idx]
                low_idx = high_idx = poc_idx

                while (
                    accumulated < target_vol
                    and (low_idx > 0 or high_idx < bins - 1)
                ):
                    if low_idx > 0:
                        low_idx -= 1
                        accumulated += profile[low_idx]
                        if accumulated >= target_vol:
                            break
                    if high_idx < bins - 1:
                        high_idx += 1
                        accumulated += profile[high_idx]

                val = float(
                    bin_edges[low_idx]
                    + bin_edges[low_idx + 1]) / 2.0
                vah = float(
                    bin_edges[high_idx]
                    + bin_edges[high_idx + 1]) / 2.0

            poc_series.iloc[i] = poc
            vah_series.iloc[i] = vah
            val_series.iloc[i] = val

        result = pd.DataFrame({
            "vp_poc": poc_series,
            "vp_vah": vah_series,
            "vp_val": val_series,
        }, index=df.index)

        return IndicatorResult(
            name="volume_profile",
            params_used=merged,
            data=result,
        )

    def _merge_params(self, runtime: dict) -> dict:
        base = dict(getattr(self, "_params", {}))
        base.update(runtime)
        for p in self.metadata.params:
            if p.name not in base and p.default is not None:
                base[p.name] = p.default
        return base
```

### 5.10 Stochastic Indicator

```python
"""
backend/app/services/indicators/builtin/stochastic.py

Stochastic Oscillator (Slow Stochastic) — %K and %D lines.
"""

from typing import ClassVar

import pandas as pd

from ..base import BaseIndicator
from ..models import (
    IndicatorCategory,
    IndicatorMetadata,
    IndicatorResult,
    OutputDef,
    OutputType,
    PaneType,
    ParamDef,
    ParamType,
)


class StochasticIndicator(BaseIndicator):
    """Slow Stochastic Oscillator."""

    metadata = IndicatorMetadata(
        name="stochastic",
        display_name="Stochastic Oscillator",
        category=IndicatorCategory.MOMENTUM,
        description=(
            "Compares closing price to the high-low range over N "
            "periods.\n"
            "- Raw %K = 100 * (Close - Lowest Low) / "
            "(Highest High - Lowest Low)\n"
            "- Slow %K = SMA(Raw %K, slowing_period)\n"
            "- Slow %D = SMA(Slow %K, d_period)\n\n"
            "Overbought > 80, Oversold < 20."
        ),
        params=[
            ParamDef(
                name="k_period", type=ParamType.INT, default=14,
                min=2, max=200, required=True,
                description="%K lookback period"),
            ParamDef(
                name="d_period", type=ParamType.INT, default=3,
                min=1, max=50,
                description="%D smoothing period"),
            ParamDef(
                name="slowing", type=ParamType.INT, default=3,
                min=1, max=50,
                description="Slowing period for Slow Stochastic"),
            ParamDef(
                name="overbought", type=ParamType.INT, default=80,
                min=50, max=100,
                description="Overbought level"),
            ParamDef(
                name="oversold", type=ParamType.INT, default=20,
                min=0, max=50,
                description="Oversold level"),
        ],
        outputs=[
            OutputDef(
                name="stoch_k", type=OutputType.LINE,
                display_name="%K", color="#2962FF",
                pane=PaneType.SEPARATE),
            OutputDef(
                name="stoch_d", type=OutputType.LINE,
                display_name="%D", color="#FF6D00",
                pane=PaneType.SEPARATE),
        ],
        version="1.0.0",
        author="Trend-Scope",
        tags=["momentum", "oscillator", "overbought",
              "oversold", "stochastic"],
        required_columns=["high", "low", "close"],
        min_bars=14,
    )

    def compute(
        self, df: pd.DataFrame, **params
    ) -> IndicatorResult:
        merged = self._merge_params(params)
        self._validate_dataframe(df, ["high", "low", "close"])

        k_period = int(merged["k_period"])
        d_period = int(merged["d_period"])
        slowing = int(merged["slowing"])

        try:
            import pandas_ta as ta
            stoch_df = ta.stoch(
                high=df["high"], low=df["low"],
                close=df["close"],
                k=k_period, d=d_period, smooth_k=slowing,
            )
            cols = list(stoch_df.columns)
            k_col = next(
                (c for c in cols
                 if c.endswith(
                     f"k_{k_period}_{d_period}_{slowing}")),
                cols[0] if len(cols) > 0 else None)
            d_col = next(
                (c for c in cols
                 if c.endswith(
                     f"d_{k_period}_{d_period}_{slowing}")),
                cols[1] if len(cols) > 1 else None)

            result = pd.DataFrame(index=df.index)
            result["stoch_k"] = (
                stoch_df[k_col] if k_col
                else pd.Series(
                    float("nan"), index=df.index))
            result["stoch_d"] = (
                stoch_df[d_col] if d_col
                else pd.Series(
                    float("nan"), index=df.index))
        except (ImportError, Exception):
            lowest_low = df["low"].rolling(
                window=k_period).min()
            highest_high = df["high"].rolling(
                window=k_period).max()
            denom = highest_high - lowest_low
            raw_k = 100.0 * (
                df["close"] - lowest_low
            ) / denom.replace(0, float("nan"))
            slow_k = raw_k.rolling(window=slowing).mean()
            slow_d = slow_k.rolling(window=d_period).mean()

            result = pd.DataFrame({
                "stoch_k": slow_k,
                "stoch_d": slow_d,
            }, index=df.index)

        return IndicatorResult(
            name="stochastic",
            params_used=merged,
            data=result,
        )

    def _merge_params(self, runtime: dict) -> dict:
        base = dict(getattr(self, "_params", {}))
        base.update(runtime)
        for p in self.metadata.params:
            if p.name not in base and p.default is not None:
                base[p.name] = p.default
        return base
```

### 5.11 ADX Indicator

```python
"""
backend/app/services/indicators/builtin/adx.py

ADX — Average Directional Index with +DI and -DI.
"""

from typing import ClassVar

import pandas as pd

from ..base import BaseIndicator
from ..models import (
    IndicatorCategory,
    IndicatorMetadata,
    IndicatorResult,
    OutputDef,
    OutputType,
    PaneType,
    ParamDef,
    ParamType,
)


class ADXIndicator(BaseIndicator):
    """Average Directional Index — trend strength measurement."""

    metadata = IndicatorMetadata(
        name="adx",
        display_name="Average Directional Index",
        category=IndicatorCategory.TREND,
        description=(
            "Measures trend strength (not direction) on a 0-100 "
            "scale.\n"
            "- ADX < 20: Weak/No trend (ranging market)\n"
            "- ADX 20-25: Possible trend developing\n"
            "- ADX 25-40: Strong trend\n"
            "- ADX 40+: Very strong trend\n\n"
            "Direction: +DI > -DI = bullish, -DI > +DI = bearish."
        ),
        params=[
            ParamDef(
                name="length", type=ParamType.INT, default=14,
                min=2, max=200, required=True,
                description="ADX smoothing period"),
        ],
        outputs=[
            OutputDef(
                name="adx", type=OutputType.LINE,
                display_name="ADX", color="#2962FF",
                pane=PaneType.SEPARATE),
            OutputDef(
                name="adx_plus_di", type=OutputType.LINE,
                display_name="+DI", color="#00C853",
                pane=PaneType.SEPARATE),
            OutputDef(
                name="adx_minus_di", type=OutputType.LINE,
                display_name="-DI", color="#FF1744",
                pane=PaneType.SEPARATE),
        ],
        version="1.0.0",
        author="Trend-Scope",
        tags=["trend", "directional", "strength",
              "wilder", "adx"],
        required_columns=["high", "low", "close"],
        min_bars=30,
    )

    def compute(
        self, df: pd.DataFrame, **params
    ) -> IndicatorResult:
        merged = self._merge_params(params)
        self._validate_dataframe(df, ["high", "low", "close"])

        length = int(merged["length"])

        try:
            import pandas_ta as ta
            adx_df = ta.adx(
                high=df["high"], low=df["low"],
                close=df["close"], length=length)
            cols = list(adx_df.columns)
            adx_col = next(
                (c for c in cols if c.startswith("ADX_")),
                cols[0] if len(cols) > 0 else None)
            dmp_col = next(
                (c for c in cols if c.startswith("DMP_")),
                cols[1] if len(cols) > 1 else None)
            dmn_col = next(
                (c for c in cols if c.startswith("DMN_")),
                cols[2] if len(cols) > 2 else None)

            result = pd.DataFrame(index=df.index)
            result["adx"] = (
                adx_df[adx_col] if adx_col
                else pd.Series(
                    float("nan"), index=df.index))
            result["adx_plus_di"] = (
                adx_df[dmp_col] if dmp_col
                else pd.Series(
                    float("nan"), index=df.index))
            result["adx_minus_di"] = (
                adx_df[dmn_col] if dmn_col
                else pd.Series(
                    float("nan"), index=df.index))
        except (ImportError, Exception):
            high = df["high"]
            low = df["low"]
            close = df["close"]

            prev_close = close.shift(1)
            tr1 = high - low
            tr2 = (high - prev_close).abs()
            tr3 = (low - prev_close).abs()
            true_range = pd.concat(
                [tr1, tr2, tr3], axis=1).max(axis=1)
            atr_smoothed = true_range.ewm(
                alpha=1.0 / length, adjust=False).mean()

            up_move = high.diff()
            down_move = -low.diff()

            plus_dm = pd.Series(
                0.0, index=df.index, dtype="float64")
            minus_dm = pd.Series(
                0.0, index=df.index, dtype="float64")

            mask_plus = (up_move > down_move) & (up_move > 0)
            mask_minus = (down_move > up_move) & (down_move > 0)
            plus_dm[mask_plus] = up_move[mask_plus]
            minus_dm[mask_minus] = down_move[mask_minus]

            smooth_plus_dm = plus_dm.ewm(
                alpha=1.0 / length, adjust=False).mean()
            smooth_minus_dm = minus_dm.ewm(
                alpha=1.0 / length, adjust=False).mean()

            plus_di = (
                100.0 * smooth_plus_dm
                / atr_smoothed.replace(0, float("nan")))
            minus_di = (
                100.0 * smooth_minus_dm
                / atr_smoothed.replace(0, float("nan")))

            sum_di = plus_di + minus_di
            dx = (
                100.0 * (plus_di - minus_di).abs()
                / sum_di.replace(0, float("nan")))
            adx_series = dx.ewm(
                alpha=1.0 / length, adjust=False).mean()

            result = pd.DataFrame({
                "adx": adx_series,
                "adx_plus_di": plus_di,
                "adx_minus_di": minus_di,
            }, index=df.index)

        return IndicatorResult(
            name="adx",
            params_used=merged,
            data=result,
        )

    def _merge_params(self, runtime: dict) -> dict:
        base = dict(getattr(self, "_params", {}))
        base.update(runtime)
        for p in self.metadata.params:
            if p.name not in base and p.default is not None:
                base[p.name] = p.default
        return base
```


### 5.12 Ichimoku Indicator

```python
"""
backend/app/services/indicators/builtin/ichimoku.py

Ichimoku Kinko Hyo — five-line equilibrium chart.
"""

from typing import ClassVar

import pandas as pd

from ..base import BaseIndicator
from ..models import (
    IndicatorCategory,
    IndicatorMetadata,
    IndicatorResult,
    OutputDef,
    OutputType,
    PaneType,
    ParamDef,
    ParamType,
)


class IchimokuIndicator(BaseIndicator):
    """Ichimoku Kinko Hyo — complete cloud indicator."""

    metadata = IndicatorMetadata(
        name="ichimoku",
        display_name="Ichimoku Cloud",
        category=IndicatorCategory.TREND,
        description=(
            "Five-component equilibrium chart:\n"
            "- Tenkan-sen (Conversion): (9-high + 9-low)/2\n"
            "- Kijun-sen (Base): (26-high + 26-low)/2\n"
            "- Senkou Span A (Leading A): (Tenkan+Kijun)/2, "
            "shifted +26\n"
            "- Senkou Span B (Leading B): (52-high+52-low)/2, "
            "shifted +26\n"
            "- Chikou Span (Lagging): close shifted -26\n\n"
            "Price above Cloud -> uptrend. TK cross bullish. "
            "Cloud thickness indicates support/resistance."
        ),
        params=[
            ParamDef(
                name="tenkan_period", type=ParamType.INT,
                default=9, min=2, max=200, required=True,
                description="Tenkan-sen (Conversion Line) period"),
            ParamDef(
                name="kijun_period", type=ParamType.INT,
                default=26, min=2, max=200, required=True,
                description="Kijun-sen (Base Line) period"),
            ParamDef(
                name="senkou_b_period", type=ParamType.INT,
                default=52, min=2, max=300,
                description="Senkou Span B period"),
            ParamDef(
                name="displacement", type=ParamType.INT,
                default=26, min=1, max=100,
                description="Displacement period for cloud"),
        ],
        outputs=[
            OutputDef(
                name="ichimoku_tenkan", type=OutputType.LINE,
                display_name="Tenkan-sen", color="#E91E63",
                pane=PaneType.MAIN),
            OutputDef(
                name="ichimoku_kijun", type=OutputType.LINE,
                display_name="Kijun-sen", color="#2196F3",
                pane=PaneType.MAIN),
            OutputDef(
                name="ichimoku_senkou_a", type=OutputType.LINE,
                display_name="Senkou A", color="#66BB6A",
                pane=PaneType.MAIN),
            OutputDef(
                name="ichimoku_senkou_b", type=OutputType.LINE,
                display_name="Senkou B", color="#FF7043",
                pane=PaneType.MAIN),
            OutputDef(
                name="ichimoku_chikou", type=OutputType.LINE,
                display_name="Chikou Span", color="#AB47BC",
                pane=PaneType.MAIN),
        ],
        version="1.0.0",
        author="Trend-Scope",
        tags=["trend", "cloud", "ichimoku",
              "support_resistance", "equilibrium"],
        required_columns=["high", "low", "close"],
        min_bars=52,
    )

    def compute(
        self, df: pd.DataFrame, **params
    ) -> IndicatorResult:
        merged = self._merge_params(params)
        self._validate_dataframe(df, ["high", "low", "close"])

        tenkan_p = int(merged["tenkan_period"])
        kijun_p = int(merged["kijun_period"])
        senkou_b_p = int(merged["senkou_b_period"])
        displacement = int(merged["displacement"])

        try:
            import pandas_ta as ta
            ichi_df = ta.ichimoku(
                high=df["high"], low=df["low"],
                close=df["close"],
                tenkan=tenkan_p, kijun=kijun_p,
                senkou=senkou_b_p,
                include_chikou=True,
            )
            if isinstance(ichi_df, tuple):
                ichi_df = ichi_df[0]

            result = pd.DataFrame(index=df.index)
            col_map = {
                "ITS_": "ichimoku_tenkan",
                "IKS_": "ichimoku_kijun",
                "ISA_": "ichimoku_senkou_a",
                "ISB_": "ichimoku_senkou_b",
                "ICS_": "ichimoku_chikou",
            }
            nan_series = pd.Series(
                float("nan"), index=df.index)
            for prefix, target in col_map.items():
                col = next(
                    (c for c in list(ichi_df.columns)
                     if c.startswith(prefix)), None)
                result[target] = (
                    ichi_df[col] if col else nan_series)
        except (ImportError, Exception):
            high = df["high"]
            low = df["low"]
            close = df["close"]

            tenkan = (
                high.rolling(tenkan_p).max()
                + low.rolling(tenkan_p).min()) / 2.0
            kijun = (
                high.rolling(kijun_p).max()
                + low.rolling(kijun_p).min()) / 2.0
            senkou_a = (
                (tenkan + kijun) / 2.0).shift(displacement)
            senkou_b = (
                high.rolling(senkou_b_p).max()
                + low.rolling(senkou_b_p).min()
            ) / 2.0
            senkou_b = senkou_b.shift(displacement)
            chikou = close.shift(-displacement)

            result = pd.DataFrame({
                "ichimoku_tenkan": tenkan,
                "ichimoku_kijun": kijun,
                "ichimoku_senkou_a": senkou_a,
                "ichimoku_senkou_b": senkou_b,
                "ichimoku_chikou": chikou,
            }, index=df.index)

        return IndicatorResult(
            name="ichimoku",
            params_used=merged,
            data=result,
        )

    def _merge_params(self, runtime: dict) -> dict:
        base = dict(getattr(self, "_params", {}))
        base.update(runtime)
        for p in self.metadata.params:
            if p.name not in base and p.default is not None:
                base[p.name] = p.default
        return base
```

### 5.13 Fibonacci Indicator

```python
"""
backend/app/services/indicators/builtin/fibonacci.py

Fibonacci Retracement and Extension levels.
"""

from typing import ClassVar

import numpy as np
import pandas as pd

from ..base import BaseIndicator
from ..models import (
    IndicatorCategory,
    IndicatorMetadata,
    IndicatorResult,
    OutputDef,
    OutputType,
    PaneType,
    ParamDef,
    ParamType,
)

# Standard Fibonacci ratios
FIB_RETRACEMENT_RATIOS = [
    0.0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0]
FIB_EXTENSION_RATIOS = [
    -0.272, -0.618, -1.0, -1.618, -2.618]


class FibonacciIndicator(BaseIndicator):
    """Fibonacci Retracement and Extension levels."""

    metadata = IndicatorMetadata(
        name="fibonacci",
        display_name="Fibonacci Levels",
        category=IndicatorCategory.PATTERN,
        description=(
            "Computes Fibonacci retracement and extension levels "
            "from the most recent significant swing high and swing "
            "low within the lookback window.\n\n"
            "Key levels (61.8%, 50%, 38.2%) act as "
            "support/resistance in pullbacks. "
            "Extensions project targets beyond the range."
        ),
        params=[
            ParamDef(
                name="swing_lookback", type=ParamType.INT,
                default=50, min=10, max=500, required=True,
                description="Lookback window to find swing high/low"),
            ParamDef(
                name="min_swing_distance", type=ParamType.INT,
                default=5, min=2, max=50,
                description="Min bars between swing points"),
        ],
        outputs=[
            OutputDef(
                name="fib_swing_high", type=OutputType.LINE,
                display_name="Swing High", color="#FF1744",
                pane=PaneType.MAIN),
            OutputDef(
                name="fib_swing_low", type=OutputType.LINE,
                display_name="Swing Low", color="#00C853",
                pane=PaneType.MAIN),
            OutputDef(
                name="fib_0", type=OutputType.LINE,
                display_name="Fib 0%", color="#B0BEC5",
                pane=PaneType.MAIN),
            OutputDef(
                name="fib_0.382", type=OutputType.LINE,
                display_name="Fib 38.2%", color="#FF6D00",
                pane=PaneType.MAIN),
            OutputDef(
                name="fib_0.5", type=OutputType.LINE,
                display_name="Fib 50%", color="#FF6D00",
                pane=PaneType.MAIN),
            OutputDef(
                name="fib_0.618", type=OutputType.LINE,
                display_name="Fib 61.8%", color="#FF6D00",
                pane=PaneType.MAIN),
            OutputDef(
                name="fib_1", type=OutputType.LINE,
                display_name="Fib 100%", color="#B0BEC5",
                pane=PaneType.MAIN),
        ],
        version="1.0.0",
        author="Trend-Scope",
        tags=["pattern", "fibonacci", "retracement",
              "extension", "support_resistance"],
        required_columns=["high", "low", "close"],
        min_bars=10,
    )

    def compute(
        self, df: pd.DataFrame, **params
    ) -> IndicatorResult:
        merged = self._merge_params(params)
        self._validate_dataframe(df, ["high", "low", "close"])

        swing_lookback = int(merged["swing_lookback"])
        min_distance = int(merged["min_swing_distance"])
        n = len(df)

        result = pd.DataFrame(index=df.index, dtype="float64")
        result["fib_swing_high"] = float("nan")
        result["fib_swing_low"] = float("nan")
        for ratio in FIB_RETRACEMENT_RATIOS:
            col_name = f"fib_{ratio}"
            result[col_name] = float("nan")

        if n < swing_lookback:
            return IndicatorResult(
                name="fibonacci", params_used=merged,
                data=result)

        for i in range(swing_lookback - 1, n):
            start = max(0, i - swing_lookback + 1)
            window_high = df["high"].iloc[start:i + 1]
            window_low = df["low"].iloc[start:i + 1]

            swing_high_val = window_high.max()
            swing_low_val = window_low.min()

            if swing_high_val == swing_low_val:
                continue

            # Determine trend direction
            # Ensure peaks are far enough apart
            high_peak_idx = window_high.values.argmax()
            low_trough_idx = window_low.values.argmin()

            if abs(high_peak_idx - low_trough_idx) < min_distance:
                continue

            result.iloc[
                i, result.columns.get_loc("fib_swing_high")
            ] = swing_high_val
            result.iloc[
                i, result.columns.get_loc("fib_swing_low")
            ] = swing_low_val

            diff = swing_high_val - swing_low_val
            for ratio in FIB_RETRACEMENT_RATIOS:
                level = swing_high_val - diff * ratio
                col_name = f"fib_{ratio}"
                result.iloc[
                    i, result.columns.get_loc(col_name)
                ] = level

        return IndicatorResult(
            name="fibonacci",
            params_used=merged,
            data=result,
        )

    def _merge_params(self, runtime: dict) -> dict:
        base = dict(getattr(self, "_params", {}))
        base.update(runtime)
        for p in self.metadata.params:
            if p.name not in base and p.default is not None:
                base[p.name] = p.default
        return base
```

### 5.14 Builtin Package Init

```python
"""
backend/app/services/indicators/builtin/__init__.py

Builtin indicators package.
All indicator classes in this directory are auto-discovered by
IndicatorRegistry. Importing this package triggers registration
of all builtins.
"""

from .sma import SMAIndicator
from .ema import EMAIndicator
from .wma import WMAIndicator
from .hma import HMAIndicator
from .macd import MACDIndicator
from .rsi import RSIIndicator
from .bollinger import BollingerBandsIndicator
from .atr import ATRIndicator
from .volume import OBVIndicator, VWAPIndicator, VolumeProfileIndicator
from .stochastic import StochasticIndicator
from .adx import ADXIndicator
from .ichimoku import IchimokuIndicator
from .fibonacci import FibonacciIndicator

__all__ = [
    "SMAIndicator",
    "EMAIndicator",
    "WMAIndicator",
    "HMAIndicator",
    "MACDIndicator",
    "RSIIndicator",
    "BollingerBandsIndicator",
    "ATRIndicator",
    "OBVIndicator",
    "VWAPIndicator",
    "VolumeProfileIndicator",
    "StochasticIndicator",
    "ADXIndicator",
    "IchimokuIndicator",
    "FibonacciIndicator",
]
```

---

## 6. Multi-Level Parameter Override System

```python
"""
backend/app/services/indicators/parameter_resolver.py

5-Level Parameter Override Cascade:

  Level 1 (Highest Priority): Request params — per-API-call overrides
  Level 2: Stock overrides       — stock_indicator_overrides table (DB)
  Level 3: Tier presets          — indicator_presets filtered by tier_id (DB)
  Level 4: System defaults       — IndicatorMetadata.params defaults (hardcoded)
  Level 5: Library defaults      — pandas-ta / indicator base defaults (lowest)
"""

from __future__ import annotations

import logging
from typing import Any, Optional, Union

from sqlalchemy.ext.asyncio import AsyncSession

from .models import IndicatorMetadata
from .registry import indicator_registry

logger = logging.getLogger(__name__)


class ParameterResolver:
    """Resolves effective indicator parameters through the 5-level cascade.

    Caches resolved params at two levels:
      - In-memory LRU cache: (stock_id, indicator_name) -> params dict
      - At the IndicatorService layer: Redis cache with 24h TTL
    """

    _cache: dict[tuple[int, str], dict[str, Any]] = {}
    _cache_max_size: int = 1000

    @classmethod
    async def resolve(
        cls,
        indicator_name: str,
        stock_id: Optional[int] = None,
        user_tier_id: Optional[int] = None,
        request_params: Optional[dict[str, Any]] = None,
        db: Optional[AsyncSession] = None,
    ) -> dict[str, Any]:
        """Resolve effective parameters through the 5-level cascade.

        Priority (highest wins):
          1. request_params (API query params)
          2. stock_indicator_overrides (DB: per-stock)
          3. tier-based preset (DB: indicator_presets by tier_id)
          4. system defaults (IndicatorMetadata.params)
          5. library defaults (from pandas-ta, lowest)

        Args:
            indicator_name: Name of the indicator (e.g. 'rsi', 'macd').
            stock_id: Stock ID for per-stock override lookup.
            user_tier_id: User's subscription tier ID.
            request_params: Parameters from the API request.
            db: Async database session.

        Returns:
            Resolved params dict with all defaults filled.

        Raises:
            ValueError: If indicator_name is not registered.
        """
        request_params = request_params or {}

        # In-memory cache (no request params override)
        if stock_id is not None and not request_params:
            cache_key = (stock_id, indicator_name)
            if cache_key in cls._cache:
                return dict(cls._cache[cache_key])

        # Level 4+5: System + Library defaults
        indicator_cls = indicator_registry.get(indicator_name)
        if indicator_cls is None:
            raise ValueError(
                f"Unknown indicator: '{indicator_name}'. "
                f"Available: {indicator_registry.list_names()}"
            )

        metadata: IndicatorMetadata = indicator_cls.metadata
        effective: dict[str, Any] = {
            p.name: p.default
            for p in metadata.params
            if p.default is not None
        }

        # Level 3: Tier presets (from DB)
        if user_tier_id is not None and db is not None:
            try:
                tier_params = await cls._load_tier_preset(
                    db, indicator_name, user_tier_id)
                if tier_params:
                    effective.update(tier_params)
            except Exception:
                logger.exception(
                    "Failed to load tier preset for %s",
                    indicator_name)

        # Level 2: Stock overrides (from DB)
        if stock_id is not None and db is not None:
            try:
                stock_params = await cls._load_stock_override(
                    db, stock_id, indicator_name)
                if stock_params:
                    effective.update(stock_params)
            except Exception:
                logger.exception(
                    "Failed to load stock override "
                    "for stock=%s indicator=%s",
                    stock_id, indicator_name)

        # Level 1: Request params (highest priority)
        if request_params:
            effective.update(request_params)

        # Update in-memory cache
        if stock_id is not None:
            cls._cache_set(stock_id, indicator_name, effective)

        return effective

    @classmethod
    async def _load_tier_preset(
        cls, db: AsyncSession, indicator_name: str, tier_id: int,
    ) -> Optional[dict[str, Any]]:
        """Load params from matching indicator_preset_items for the tier."""
        from sqlalchemy import select

        from backend.app.models.indicator import (
            IndicatorPreset, IndicatorPresetItem)

        stmt = (
            select(IndicatorPresetItem.params)
            .join(
                IndicatorPreset,
                IndicatorPresetItem.preset_id
                == IndicatorPreset.id,
            )
            .where(
                (
                    IndicatorPreset.tier_id == tier_id
                ) | (
                    IndicatorPreset.tier_id.is_(None)
                ),
                IndicatorPresetItem.indicator_name
                == indicator_name,
            )
            .order_by(
                IndicatorPreset.tier_id.desc().nullslast(),
                IndicatorPreset.is_system.desc(),
            )
            .limit(1)
        )
        result = await db.execute(stmt)
        row = result.scalar_one_or_none()
        return row if isinstance(row, dict) else None

    @classmethod
    async def _load_stock_override(
        cls, db: AsyncSession, stock_id: int, indicator_name: str,
    ) -> Optional[dict[str, Any]]:
        """Load per-stock parameter overrides."""
        from sqlalchemy import select

        from backend.app.models.indicator import (
            StockIndicatorOverride)

        stmt = (
            select(StockIndicatorOverride.params)
            .where(
                StockIndicatorOverride.stock_id == stock_id,
                StockIndicatorOverride.indicator_name
                == indicator_name,
            )
            .limit(1)
        )
        result = await db.execute(stmt)
        row = result.scalar_one_or_none()
        return row if isinstance(row, dict) else None

    @classmethod
    def _cache_set(
        cls, stock_id: int, indicator_name: str,
        params: dict[str, Any],
    ) -> None:
        """Store in the in-memory LRU cache."""
        key = (stock_id, indicator_name)
        if len(cls._cache) >= cls._cache_max_size:
            oldest = next(iter(cls._cache))
            del cls._cache[oldest]
        cls._cache[key] = dict(params)

    @classmethod
    def clear_cache(cls) -> None:
        """Clear the in-memory resolution cache."""
        cls._cache.clear()


# ---------------------------------------------------------------------------
# Synchronous resolver for testing / offline use
# ---------------------------------------------------------------------------


class StaticParameterResolver:
    """Synchronous resolver using pre-loaded dicts instead of DB queries.

    For unit tests and offline environments.
    """

    def __init__(
        self,
        stock_overrides: Optional[
            dict[int, dict[str, dict[str, Any]]]] = None,
        tier_presets: Optional[
            dict[int, dict[str, dict[str, Any]]]] = None,
    ) -> None:
        self._stock_overrides = stock_overrides or {}
        self._tier_presets = tier_presets or {}

    def resolve(
        self,
        indicator_name: str,
        stock_id: Optional[int] = None,
        user_tier_id: Optional[int] = None,
        request_params: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """Synchronous resolve using in-memory dicts."""
        request_params = request_params or {}

        indicator_cls = indicator_registry.get(indicator_name)
        if indicator_cls is None:
            raise ValueError(
                f"Unknown indicator: '{indicator_name}'")

        metadata = indicator_cls.metadata
        effective: dict[str, Any] = {
            p.name: p.default
            for p in metadata.params
            if p.default is not None
        }

        # Layer 3: tier presets
        if user_tier_id is not None:
            tier_params = self._tier_presets.get(
                user_tier_id, {}).get(indicator_name)
            if tier_params:
                effective.update(tier_params)

        # Layer 2: stock overrides
        if stock_id is not None:
            stock_params = self._stock_overrides.get(
                stock_id, {}).get(indicator_name)
            if stock_params:
                effective.update(stock_params)

        # Layer 1: request params
        if request_params:
            effective.update(request_params)

        return effective
```


---

## 7. MultiTimeframeAnalyzer

```python
"""
backend/app/services/indicators/multi_timeframe.py

Multi-timeframe analysis: resample daily data, compute indicators on
each timeframe, and detect signal confluence across timeframes.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Optional

import pandas as pd

from .models import IndicatorResult
from .registry import indicator_registry

logger = logging.getLogger(__name__)

# Resample rules for Pandas (anchored to US market close)
TIMEFRAME_RESAMPLE_RULES = {
    "1d": None,
    "1w": "W-FRI",
    "1M": "ME",
    "3M": "QE",
}

# Required minimum bars per timeframe
TIMEFRAME_MIN_BARS = {"1d": 1, "1w": 4, "1M": 3, "3M": 2}


@dataclass
class TimeframeSpec:
    """Specification for which indicators on which timeframe."""
    timeframe: str
    indicators: list[str] = field(default_factory=list)
    params_overrides: dict[str, dict[str, Any]] = field(
        default_factory=dict)


@dataclass
class MultiTimeframeResult:
    """Container for multi-timeframe indicator results."""
    timeframe_results: dict[
        str, dict[str, IndicatorResult]] = field(
            default_factory=dict)
    confluence_signals: dict[str, Any] = field(
        default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)


class MultiTimeframeAnalyzer:
    """Runs indicators across multiple timeframes with confluence detection.

    Features:
      - Resample daily OHLCV to weekly/monthly/quarterly
      - Compute indicators independently per timeframe
      - Detect signal confluence: same direction on multiple
        timeframes = stronger signal
      - Lazy computation: resample once, compute many
      - In-memory caching of resampled dataframes
    """

    def __init__(self) -> None:
        self._resampled_cache: dict[
            tuple[int, str], pd.DataFrame] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def analyze(
        self,
        df_daily: pd.DataFrame,
        specs: list[TimeframeSpec],
        stock_id: Optional[int] = None,
        request_params: Optional[
            dict[str, dict[str, Any]]] = None,
    ) -> MultiTimeframeResult:
        """Run indicators across all specified timeframes.

        Args:
            df_daily: DataFrame with DatetimeIndex, columns:
                open, high, low, close, volume
            specs: List of TimeframeSpec
            stock_id: Optional stock ID for cache key
            request_params: Per-indicator param overrides:
                {indicator_name: {param: value}}

        Returns:
            MultiTimeframeResult with all computed indicators
            and confluence signals.
        """
        request_params = request_params or {}
        timeframe_results: dict[
            str, dict[str, IndicatorResult]] = {}
        df_map: dict[str, pd.DataFrame] = {"1d": df_daily}

        # Resample once per timeframe
        for spec in specs:
            if spec.timeframe == "1d":
                continue
            if spec.timeframe not in df_map:
                resampled = self._resample(
                    df_daily, spec.timeframe)
                min_bars = TIMEFRAME_MIN_BARS.get(
                    spec.timeframe, 1)
                if len(resampled) >= min_bars:
                    df_map[spec.timeframe] = resampled
                else:
                    logger.warning(
                        "Insufficient data for %s: %d bars "
                        "(need >= %d)",
                        spec.timeframe, len(resampled),
                        min_bars)
                    continue

        # Compute indicators per timeframe
        for spec in specs:
            if spec.timeframe not in df_map:
                continue

            df = df_map[spec.timeframe]
            tf_results: dict[str, IndicatorResult] = {}

            for indicator_name in spec.indicators:
                try:
                    params = {}
                    if indicator_name in spec.params_overrides:
                        params.update(
                            spec.params_overrides[
                                indicator_name])
                    if indicator_name in request_params:
                        params.update(
                            request_params[indicator_name])

                    instance = indicator_registry.get_instance(
                        indicator_name, params)
                    result = instance.compute(df, **params)
                    tf_results[indicator_name] = result
                except Exception:
                    logger.exception(
                        "Error computing %s on %s",
                        indicator_name, spec.timeframe)

            timeframe_results[spec.timeframe] = tf_results

        confluence = self._detect_confluence(
            timeframe_results)

        # Collect all indicator names across timeframes
        all_names: set[str] = set()
        for tf_res in timeframe_results.values():
            all_names.update(tf_res.keys())

        return MultiTimeframeResult(
            timeframe_results=timeframe_results,
            confluence_signals=confluence,
            metadata={
                "timeframes_analyzed": list(
                    timeframe_results.keys()),
                "indicators_analyzed": sorted(all_names),
            },
        )

    def analyze_single(
        self,
        df_daily: pd.DataFrame,
        indicator_name: str,
        timeframes: Optional[list[str]] = None,
        params: Optional[dict[str, Any]] = None,
    ) -> MultiTimeframeResult:
        """Compute one indicator on multiple timeframes."""
        timeframes = timeframes or ["1d", "1w", "1M"]
        specs = [
            TimeframeSpec(
                timeframe=tf,
                indicators=[indicator_name])
            for tf in timeframes
        ]
        return self.analyze(
            df_daily, specs,
            request_params={
                indicator_name: params or {}})

    # ------------------------------------------------------------------
    # Resampling
    # ------------------------------------------------------------------

    @staticmethod
    def _resample(
        df: pd.DataFrame, timeframe: str
    ) -> pd.DataFrame:
        """Resample daily OHLCV data to a higher timeframe."""
        rule = TIMEFRAME_RESAMPLE_RULES.get(timeframe)
        if rule is None:
            return df.copy()

        return df.resample(rule).agg({
            "open": "first",
            "high": "max",
            "low": "min",
            "close": "last",
            "volume": "sum",
        }).dropna()

    # ------------------------------------------------------------------
    # Signal Confluence Detection
    # ------------------------------------------------------------------

    def _detect_confluence(
        self,
        timeframe_results: dict[
            str, dict[str, IndicatorResult]],
    ) -> dict[str, Any]:
        """Detect aligned signals across timeframes.

        Rules:
          - RSI: Oversold on 2+ timeframes -> strong buy signal
          - MACD: Bullish cross on 2+ timeframes -> strong bullish
          - ADX: Trending (>25) on 2+ timeframes -> confirmed trend
        """
        signals: dict[str, Any] = {}
        timeframes = list(timeframe_results.keys())

        # Helper
        def _get_tf(
            name: str,
        ) -> list[dict[str, Any]]:
            results = []
            for tf in timeframes:
                result = timeframe_results.get(
                    tf, {}).get(name)
                if result is not None and len(result.data) > 0:
                    results.append({
                        "timeframe": tf,
                        "data": result.data,
                    })
            return results

        # RSI Confluence
        rsi_datas = _get_tf("rsi")
        if len(rsi_datas) >= 2:
            rsi_signals = []
            for entry in rsi_datas:
                last_rsi = float(
                    entry["data"]["rsi"].iloc[-1])
                rsi_signals.append({
                    "timeframe": entry["timeframe"],
                    "rsi": last_rsi,
                })

            oversold = sum(
                1 for s in rsi_signals if s["rsi"] < 30)
            overbought = sum(
                1 for s in rsi_signals if s["rsi"] > 70)

            if oversold >= 2:
                signals["rsi_confluence"] = {
                    "type": "oversold",
                    "strength": (
                        "strong"
                        if oversold == len(rsi_signals)
                        else "moderate"),
                    "details": rsi_signals,
                }
            elif overbought >= 2:
                signals["rsi_confluence"] = {
                    "type": "overbought",
                    "strength": (
                        "strong"
                        if overbought == len(rsi_signals)
                        else "moderate"),
                    "details": rsi_signals,
                }

        # MACD Confluence
        macd_datas = _get_tf("macd")
        if len(macd_datas) >= 2:
            macd_signals = []
            for entry in macd_datas:
                df_m = entry["data"]
                if len(df_m) >= 2:
                    macd_line = df_m["macd"]
                    signal_line = df_m["macd_signal"]
                    direction = (
                        "bullish"
                        if macd_line.iloc[-1]
                        > signal_line.iloc[-1]
                        else "bearish")
                    macd_signals.append({
                        "timeframe": entry["timeframe"],
                        "direction": direction,
                    })

            bullish = sum(
                1 for s in macd_signals
                if s["direction"] == "bullish")
            bearish = sum(
                1 for s in macd_signals
                if s["direction"] == "bearish")

            if bullish >= 2:
                signals["macd_confluence"] = {
                    "type": "bullish",
                    "strength": (
                        "strong"
                        if bullish == len(macd_signals)
                        else "moderate"),
                    "details": macd_signals,
                }
            elif bearish >= 2:
                signals["macd_confluence"] = {
                    "type": "bearish",
                    "strength": (
                        "strong"
                        if bearish == len(macd_signals)
                        else "moderate"),
                    "details": macd_signals,
                }

        # ADX Confluence
        adx_datas = _get_tf("adx")
        if len(adx_datas) >= 2:
            adx_signals = []
            for entry in adx_datas:
                df_a = entry["data"]
                if len(df_a) > 0:
                    adx_val = float(df_a["adx"].iloc[-1])
                    plus_di = float(
                        df_a["adx_plus_di"].iloc[-1])
                    minus_di = float(
                        df_a["adx_minus_di"].iloc[-1])
                    if adx_val > 25:
                        direction = (
                            "bullish"
                            if plus_di > minus_di
                            else "bearish")
                        adx_signals.append({
                            "timeframe": entry["timeframe"],
                            "adx": adx_val,
                            "direction": direction,
                        })

            if len(adx_signals) >= 2:
                bullish = sum(
                    1 for s in adx_signals
                    if s["direction"] == "bullish")
                bearish = sum(
                    1 for s in adx_signals
                    if s["direction"] == "bearish")

                if bullish >= 2:
                    signals["adx_confluence"] = {
                        "type": "bullish_trend",
                        "strength": (
                            "strong"
                            if bullish == len(adx_signals)
                            else "moderate"),
                        "details": adx_signals,
                    }
                elif bearish >= 2:
                    signals["adx_confluence"] = {
                        "type": "bearish_trend",
                        "strength": (
                            "strong"
                            if bearish == len(adx_signals)
                            else "moderate"),
                        "details": adx_signals,
                    }

        return signals

    def clear_caches(self) -> None:
        """Clear all internal caches."""
        self._resampled_cache.clear()
```

---

## 8. Indicator Computation Service

```python
"""
backend/app/services/indicator_service.py

Orchestration service for indicator computation, caching,
and preset management. Async, with DB and Redis integration.
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional

import pandas as pd
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .indicators.models import (
    IndicatorOutput,
    IndicatorPresetCreate,
    IndicatorPresetOut,
    IndicatorRequest,
    MultiIndicatorResponse,
    StockIndicatorOverrideCreate,
    StockIndicatorOverrideOut,
)
from .indicators.multi_timeframe import (
    MultiTimeframeAnalyzer,
    TimeframeSpec,
)
from .indicators.parameter_resolver import ParameterResolver
from .indicators.registry import indicator_registry

logger = logging.getLogger(__name__)


class IndicatorService:
    """Async service for computing technical indicators.

    Usage:
        service = IndicatorService(redis_client)
        response = await service.compute(
            stock_id=1, stock_symbol="SPY",
            indicators=[...], df=df, db=session)
        await service.precompute_all(session)
    """

    def __init__(
        self, redis_client: Optional[Any] = None
    ) -> None:
        self._mtf = MultiTimeframeAnalyzer()
        self._redis = redis_client

    # ------------------------------------------------------------------
    # Core Computation
    # ------------------------------------------------------------------

    async def compute(
        self,
        stock_id: int,
        stock_symbol: str,
        indicators: list[IndicatorRequest],
        df: pd.DataFrame,
        db: AsyncSession,
        user_tier_id: Optional[int] = None,
        timeframe: str = "1d",
    ) -> MultiIndicatorResponse:
        """Compute requested indicators for a stock.

        Args:
            stock_id: Database stock ID.
            stock_symbol: Ticker symbol.
            indicators: List of indicator requests.
            df: OHLCV DataFrame with DatetimeIndex.
            db: Async DB session.
            user_tier_id: User's subscription tier.
            timeframe: Target timeframe override.

        Returns:
            MultiIndicatorResponse with results and signals.
        """
        results: dict[str, IndicatorOutput] = {}
        resolved_params: dict[str, dict[str, Any]] = {}

        # Resolve params for each indicator
        for req in indicators:
            try:
                params = await ParameterResolver.resolve(
                    indicator_name=req.name,
                    stock_id=stock_id,
                    user_tier_id=user_tier_id,
                    request_params=req.params,
                    db=db,
                )
                resolved_params[req.name] = params
            except ValueError as e:
                logger.warning(
                    "Param resolution failed for %s: %s",
                    req.name, e)
                continue

        # Check cache for existing results
        uncached: list[IndicatorRequest] = []
        for req in indicators:
            if req.name not in resolved_params:
                continue
            cache_key = self._cache_key(
                stock_id, req.name,
                resolved_params[req.name], timeframe)
            cached = await self._get_cache(cache_key)
            if cached is not None:
                results[req.name] = cached
                logger.debug("Cache hit: %s", cache_key)
            else:
                uncached.append(req)

        confluence: dict[str, Any] = {}

        # Compute uncached indicators
        if uncached:
            # Build TimeframeSpec
            spec = TimeframeSpec(
                timeframe=timeframe,
                indicators=[
                    req.name for req in uncached
                    if req.name in resolved_params],
                params_overrides=resolved_params,
            )

            mtf_result = self._mtf.analyze(
                df_daily=df,
                specs=[spec],
                stock_id=stock_id,
                request_params=resolved_params,
            )

            tf_results = mtf_result.timeframe_results.get(
                timeframe, {})

            for req in uncached:
                if req.name in tf_results:
                    ir = tf_results[req.name]
                    output = IndicatorOutput.from_result(
                        ir, include_series=True)
                    results[req.name] = output

                    # Write to cache (DB + Redis)
                    cache_key = self._cache_key(
                        stock_id, req.name,
                        resolved_params[req.name],
                        timeframe)
                    await self._set_cache(
                        cache_key, output, db,
                        stock_id, req.name,
                        resolved_params[req.name],
                        timeframe)

            confluence = mtf_result.confluence_signals

        return MultiIndicatorResponse(
            stock_id=stock_id,
            stock_symbol=stock_symbol,
            timeframe=timeframe,
            results=results,
            signals=confluence,
            computed_at=datetime.now(
                timezone.utc).isoformat(),
        )

    # ------------------------------------------------------------------
    # Precomputation (called by APScheduler)
    # ------------------------------------------------------------------

    async def precompute_all(
        self,
        db: AsyncSession,
        stock_ids: Optional[list[int]] = None,
    ) -> dict[str, int]:
        """Precompute all indicators for all active stocks.

        Called by APScheduler after sync_daily_prices completes.
        Iterates over all active stocks, loads OHLCV data, and
        computes indicators using system default params.

        Performance target: 100 stocks * 12 indicators < 1.5s
        """
        from backend.app.models.stock import (
            Stock, StockPriceDaily)

        stmt = select(Stock.id, Stock.symbol).where(
            Stock.is_active == True)
        if stock_ids:
            stmt = stmt.where(Stock.id.in_(stock_ids))
        result = await db.execute(stmt)
        stocks = result.all()

        all_names = indicator_registry.list_names()
        total_computed = 0
        total_cached = 0

        for stock_id, symbol in stocks:
            try:
                price_stmt = (
                    select(StockPriceDaily)
                    .where(
                        StockPriceDaily.stock_id
                        == stock_id)
                    .order_by(
                        StockPriceDaily.trade_date.asc())
                )
                price_result = await db.execute(price_stmt)
                rows = price_result.scalars().all()

                if len(rows) < 20:
                    continue

                df = pd.DataFrame(
                    [{
                        "open": r.open,
                        "high": r.high,
                        "low": r.low,
                        "close": r.close,
                        "volume": r.volume,
                    } for r in rows],
                    index=pd.DatetimeIndex(
                        [r.trade_date for r in rows]),
                )

                for name in all_names:
                    try:
                        params = (
                            await ParameterResolver.resolve(
                                indicator_name=name,
                                stock_id=stock_id, db=db))
                        instance = (
                            indicator_registry.get_instance(
                                name, params))
                        ir = instance.compute(df)

                        output = IndicatorOutput.from_result(
                            ir, include_series=True)
                        cache_key = self._cache_key(
                            stock_id, name, params, "1d")
                        await self._set_cache(
                            cache_key, output, db,
                            stock_id, name, params, "1d")
                        total_computed += 1
                    except Exception:
                        logger.exception(
                            "Precompute failed: stock=%s "
                            "indicator=%s", stock_id, name)

                total_cached += 1
            except Exception:
                logger.exception(
                    "Precompute failed: stock_id=%s",
                    stock_id)

        return {
            "stocks_processed": total_cached,
            "indicators_computed": total_computed,
            "cached": total_computed,
        }

    # ------------------------------------------------------------------
    # Preset Management
    # ------------------------------------------------------------------

    async def get_presets(
        self,
        db: AsyncSession,
        tier_id: Optional[int] = None,
    ) -> list[IndicatorPresetOut]:
        """List indicator presets, optionally filtered by tier."""
        from backend.app.models.indicator import (
            IndicatorPreset, IndicatorPresetItem)

        stmt = select(IndicatorPreset)
        if tier_id is not None:
            stmt = stmt.where(
                (IndicatorPreset.tier_id == tier_id)
                | (IndicatorPreset.tier_id.is_(None)))
        stmt = stmt.order_by(
            IndicatorPreset.is_system.desc(),
            IndicatorPreset.created_at.desc())
        result = await db.execute(stmt)
        presets = result.scalars().all()

        out = []
        for preset in presets:
            items_stmt = (
                select(IndicatorPresetItem)
                .where(
                    IndicatorPresetItem.preset_id
                    == preset.id)
                .order_by(IndicatorPresetItem.sort_order))
            items_result = await db.execute(items_stmt)
            items = items_result.scalars().all()

            items_dict = {
                item.indicator_name: item.params
                for item in items
            }

            out.append(IndicatorPresetOut(
                id=preset.id,
                name=preset.name,
                description=preset.description,
                tier_id=preset.tier_id,
                is_system=bool(preset.is_system),
                items=items_dict,
                created_at=(
                    preset.created_at.isoformat()
                    if preset.created_at else ""),
            ))

        return out

    async def save_preset(
        self,
        db: AsyncSession,
        preset_data: IndicatorPresetCreate,
    ) -> IndicatorPresetOut:
        """Create a new indicator preset (admin)."""
        from backend.app.models.indicator import (
            IndicatorPreset, IndicatorPresetItem)

        preset = IndicatorPreset(
            name=preset_data.name,
            description=preset_data.description,
            tier_id=preset_data.tier_id,
            is_system=False,
        )
        db.add(preset)
        await db.flush()

        for idx, (
            indicator_name, params
        ) in enumerate(preset_data.items.items()):
            item = IndicatorPresetItem(
                preset_id=preset.id,
                indicator_name=indicator_name,
                params=params,
                sort_order=idx,
            )
            db.add(item)

        await db.commit()
        await db.refresh(preset)

        return IndicatorPresetOut(
            id=preset.id,
            name=preset.name,
            description=preset.description,
            tier_id=preset.tier_id,
            is_system=False,
            items=preset_data.items,
            created_at=(
                preset.created_at.isoformat()
                if preset.created_at else ""),
        )

    async def delete_preset(
        self, db: AsyncSession, preset_id: int
    ) -> bool:
        """Delete a user-created preset. System presets cannot."""
        from backend.app.models.indicator import (
            IndicatorPreset)

        result = await db.execute(
            select(IndicatorPreset).where(
                IndicatorPreset.id == preset_id))
        preset = result.scalar_one_or_none()
        if preset is None:
            return False
        if preset.is_system:
            raise ValueError(
                "Cannot delete system presets")
        await db.delete(preset)
        await db.commit()
        return True

    # ------------------------------------------------------------------
    # Stock Override Management
    # ------------------------------------------------------------------

    async def set_stock_override(
        self,
        db: AsyncSession,
        stock_id: int,
        indicator_name: str,
        params: dict[str, Any],
    ) -> StockIndicatorOverrideOut:
        """Create or update a per-stock indicator param override."""
        from backend.app.models.indicator import (
            StockIndicatorOverride)

        result = await db.execute(
            select(StockIndicatorOverride).where(
                StockIndicatorOverride.stock_id == stock_id,
                StockIndicatorOverride.indicator_name
                == indicator_name,
            ))
        override = result.scalar_one_or_none()

        if override:
            override.params = params
        else:
            override = StockIndicatorOverride(
                stock_id=stock_id,
                indicator_name=indicator_name,
                params=params,
            )
            db.add(override)

        await db.commit()
        await db.refresh(override)

        # Invalidate parameter resolution cache
        ParameterResolver.clear_cache()

        return StockIndicatorOverrideOut(
            id=override.id,
            stock_id=override.stock_id,
            indicator_name=override.indicator_name,
            params=override.params,
        )

    async def get_stock_overrides(
        self, db: AsyncSession, stock_id: int,
    ) -> list[StockIndicatorOverrideOut]:
        """List all overrides for a given stock."""
        from backend.app.models.indicator import (
            StockIndicatorOverride)

        stmt = (
            select(StockIndicatorOverride)
            .where(
                StockIndicatorOverride.stock_id
                == stock_id)
            .order_by(
                StockIndicatorOverride.indicator_name))
        result = await db.execute(stmt)
        rows = result.scalars().all()

        return [
            StockIndicatorOverrideOut(
                id=r.id,
                stock_id=r.stock_id,
                indicator_name=r.indicator_name,
                params=r.params,
            )
            for r in rows
        ]

    # ------------------------------------------------------------------
    # Caching Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _cache_key(
        stock_id: int,
        indicator_name: str,
        params: dict[str, Any],
        timeframe: str,
    ) -> str:
        """Generate a cache key for Redis."""
        params_json = json.dumps(
            params, sort_keys=True, default=str)
        params_hash = hashlib.sha256(
            params_json.encode()).hexdigest()[:16]
        return (
            f"indicator:{stock_id}:{indicator_name}:"
            f"{params_hash}:{timeframe}")

    async def _get_cache(
        self, key: str
    ) -> Optional[IndicatorOutput]:
        """Retrieve from Redis cache."""
        if self._redis is None:
            return None
        try:
            data = await self._redis.get(key)
            if data:
                parsed = json.loads(data)
                return IndicatorOutput(**parsed)
        except Exception:
            logger.exception(
                "Redis get failed for key %s", key)
        return None

    async def _set_cache(
        self,
        key: str,
        output: IndicatorOutput,
        db: AsyncSession,
        stock_id: int,
        indicator_name: str,
        params: dict[str, Any],
        timeframe: str,
    ) -> None:
        """Store in Redis (24h TTL) and optionally DB."""
        serialized = output.model_dump_json()

        # Redis
        if self._redis is not None:
            try:
                await self._redis.setex(
                    key, 86400, serialized)
            except Exception:
                logger.exception(
                    "Redis set failed for key %s", key)

        # DB cache table
        try:
            from backend.app.models.indicator import (
                IndicatorCache)
            params_hash = hashlib.sha256(
                json.dumps(
                    params, sort_keys=True, default=str)
                .encode()
            ).hexdigest()
            cache_entry = IndicatorCache(
                stock_id=stock_id,
                indicator_name=indicator_name,
                params_hash=params_hash,
                timeframe=timeframe,
                data=json.loads(serialized),
            )
            db.add(cache_entry)
            await db.commit()
        except Exception:
            logger.exception(
                "DB cache write failed for %s", key)
```


---

## 9. API Endpoints

### 9.1 Endpoint Specifications

All endpoints are mounted under `/api/v1/`.

#### POST /analysis/{stock_id}/indicators

Compute indicators on-demand (Pro tier only).

```
POST /api/v1/analysis/SPY/indicators
Authorization: Bearer <access_token>

Request Body:
{
  "indicators": [
    {"name": "rsi", "params": {"length": 14}},
    {"name": "macd", "params": {}},
    {"name": "bollinger", "params": {"std": 2.5}}
  ],
  "timeframe": "1d"
}

Response 200:
{
  "stock_id": 1,
  "stock_symbol": "SPY",
  "timeframe": "1d",
  "results": {
    "rsi": {
      "name": "rsi",
      "params_used": {"length": 14, "overbought": 70, "oversold": 30},
      "latest": {"rsi": 54.32, "rsi_signal": "neutral"},
      "series": [{"date": "2026-06-01", "rsi": 52.1, "rsi_signal": "neutral"}, ...]
    },
    "macd": { ... },
    "bollinger": { ... }
  },
  "signals": {
    "rsi_confluence": null,
    "macd_confluence": {"type": "bullish", "strength": "moderate", "details": [...]}
  },
  "computed_at": "2026-06-09T16:30:00Z"
}

Response 402:
{"detail": "Pro subscription required for indicator computation", "code": "TIER_REQUIRED"}

Response 429:
{"detail": "Rate limit exceeded", "code": "RATE_LIMIT_EXCEEDED"}
```

**Tier Access**: Pro only. Parameters resolved through the 5-level cascade.
**Rate Limit**: 1000 requests/day for Pro users.

#### POST /admin/presets

Create a new indicator preset.

```
POST /api/v1/admin/presets
Authorization: Bearer <admin_token>

Request Body:
{
  "name": "Aggressive Momentum Strategy",
  "description": "Shorter lookback periods for momentum indicators",
  "tier_id": 3,
  "items": {
    "rsi": {"length": 7, "overbought": 60, "oversold": 40},
    "macd": {"fast": 8, "slow": 17, "signal": 6},
    "stochastic": {"k_period": 5, "d_period": 2}
  }
}

Response 201:
{
  "id": 5,
  "name": "Aggressive Momentum Strategy",
  "description": "Shorter lookback periods for momentum indicators",
  "tier_id": 3,
  "is_system": false,
  "items": { ... },
  "created_at": "2026-06-09T16:30:00Z"
}
```

#### GET /analysis/presets

List available presets for the user's tier.

```
GET /api/v1/analysis/presets?tier_id=3

Response 200:
{
  "presets": [
    {
      "id": 1,
      "name": "Standard Indicators",
      "description": "Default indicator set with standard parameters",
      "tier_id": null,
      "is_system": true,
      "items": {"sma": {"length": 20}, "ema": {"length": 20}, ...},
      "created_at": "2026-06-01T00:00:00Z"
    },
    ...
  ]
}
```

#### GET /analysis/indicators

List all available indicators with metadata.

```
GET /api/v1/analysis/indicators
GET /api/v1/analysis/indicators?category=momentum

Response 200:
{
  "indicators": [
    {
      "name": "rsi",
      "display_name": "Relative Strength Index",
      "category": "momentum",
      "description": "Measures the speed and change of price movements...",
      "params": [
        {"name": "length", "type": "int", "default": 14, "min": 2, "max": 200, ...}
      ],
      "outputs": [
        {"name": "rsi", "type": "line", "display_name": "RSI", "color": "#2962FF", ...}
      ],
      "version": "1.0.0",
      "author": "Trend-Scope",
      "tags": ["momentum", "oscillator", "overbought", "oversold", "wilder"],
      "required_columns": ["close"],
      "min_bars": 14
    },
    ...
  ]
}
```

#### GET /admin/stocks/{id}/indicator-overrides

List per-stock indicator parameter overrides.

```
GET /api/v1/admin/stocks/42/indicator-overrides

Response 200:
{
  "stock_id": 42,
  "overrides": [
    {
      "id": 15,
      "stock_id": 42,
      "indicator_name": "rsi",
      "params": {"length": 7, "overbought": 80}
    },
    {
      "id": 16,
      "stock_id": 42,
      "indicator_name": "bollinger",
      "params": {"length": 10, "std": 1.5}
    }
  ]
}
```

#### POST /admin/stocks/{id}/indicator-overrides

Create or update a per-stock override.

```
POST /api/v1/admin/stocks/42/indicator-overrides

Request Body:
{
  "indicator_name": "rsi",
  "params": {"length": 7, "overbought": 80}
}

Response 200:
{
  "id": 15,
  "stock_id": 42,
  "indicator_name": "rsi",
  "params": {"length": 7, "overbought": 80}
}
```

#### DELETE /admin/presets/{id}

Delete a user-created preset (system presets are protected).

```
DELETE /api/v1/admin/presets/5

Response 204: No Content
Response 403: {"detail": "Cannot delete system presets", "code": "SYSTEM_PRESET_PROTECTED"}
```

### 9.2 FastAPI Router Implementation

```python
"""
backend/app/api/v1/analysis.py (indicator-specific routes)
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.deps import get_current_user, get_db
from backend.app.models.user import User
from backend.app.services.indicator_service import IndicatorService
from backend.app.services.stock_data import StockDataService
from backend.app.services.indicators.models import (
    IndicatorMetaOut,
    IndicatorPresetCreate,
    IndicatorPresetOut,
    IndicatorRequest,
    MultiIndicatorRequest,
    MultiIndicatorResponse,
    StockIndicatorOverrideCreate,
    StockIndicatorOverrideOut,
)
from backend.app.services.indicators.registry import indicator_registry

router = APIRouter(prefix="/analysis", tags=["analysis"])


@router.post(
    "/{stock_symbol}/indicators",
    response_model=MultiIndicatorResponse,
)
async def compute_indicators(
    stock_symbol: str,
    body: MultiIndicatorRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MultiIndicatorResponse:
    """Compute one or more technical indicators for a stock.

    Requires Pro tier subscription.
    """
    # Check tier
    from backend.app.services.subscription_service import (
        SubscriptionService)
    tier = await SubscriptionService.get_user_tier(
        db, current_user.id)
    if tier.slug not in ("pro",):
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Pro subscription required for indicator computation",
        )

    # Load stock and price data
    stock = await StockDataService.get_stock_by_symbol(
        db, stock_symbol)
    if stock is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Stock not found: {stock_symbol}")

    df = await StockDataService.get_ohlcv_dataframe(
        db, stock.id)

    service = IndicatorService()
    return await service.compute(
        stock_id=stock.id,
        stock_symbol=stock_symbol.upper(),
        indicators=body.indicators,
        df=df,
        db=db,
        user_tier_id=tier.id,
        timeframe=body.timeframe,
    )


@router.get(
    "/indicators",
    response_model=dict,
)
async def list_indicators(
    category: str | None = Query(
        default=None, description="Filter by category"),
):
    """List all available indicators with their metadata."""
    metas = indicator_registry.list_all(category=category)
    indicators_out = [
        IndicatorMetaOut(
            name=m.name,
            display_name=m.display_name,
            category=m.category.value,
            description=m.description,
            params=m.params,
            outputs=m.outputs,
            version=m.version,
            author=m.author,
            tags=m.tags,
            required_columns=m.required_columns,
            min_bars=m.min_bars,
        )
        for m in metas
    ]
    return {"indicators": [
        i.model_dump() for i in indicators_out
    ]}


@router.get(
    "/presets",
    response_model=dict,
)
async def list_presets(
    tier_id: int | None = Query(
        default=None, description="Filter by tier"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List available indicator presets."""
    service = IndicatorService()
    presets = await service.get_presets(db, tier_id=tier_id)
    return {"presets": [
        p.model_dump() for p in presets
    ]}
```

```python
"""
backend/app/api/v1/admin/indicators.py (admin routes)
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.deps import get_current_admin_user, get_db
from backend.app.models.user import User
from backend.app.services.indicator_service import IndicatorService
from backend.app.services.indicators.models import (
    IndicatorPresetCreate,
    IndicatorPresetOut,
    StockIndicatorOverrideCreate,
    StockIndicatorOverrideOut,
)

router = APIRouter(prefix="/admin", tags=["admin"])


@router.post(
    "/presets",
    response_model=IndicatorPresetOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_preset(
    body: IndicatorPresetCreate,
    _admin: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
) -> IndicatorPresetOut:
    """Create a new indicator preset."""
    service = IndicatorService()
    return await service.save_preset(db, body)


@router.delete(
    "/presets/{preset_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_preset(
    preset_id: int,
    _admin: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a user-created preset. System presets protected."""
    service = IndicatorService()
    deleted = await service.delete_preset(db, preset_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Preset {preset_id} not found")


@router.get(
    "/stocks/{stock_id}/indicator-overrides",
    response_model=dict,
)
async def list_stock_overrides(
    stock_id: int,
    _admin: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """List all indicator parameter overrides for a stock."""
    service = IndicatorService()
    overrides = await service.get_stock_overrides(
        db, stock_id)
    return {
        "stock_id": stock_id,
        "overrides": [
            o.model_dump() for o in overrides
        ],
    }


@router.post(
    "/stocks/{stock_id}/indicator-overrides",
    response_model=StockIndicatorOverrideOut,
)
async def create_stock_override(
    stock_id: int,
    body: StockIndicatorOverrideCreate,
    _admin: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
) -> StockIndicatorOverrideOut:
    """Create or update a per-stock indicator param override."""
    service = IndicatorService()
    return await service.set_stock_override(
        db, stock_id,
        body.indicator_name, body.params)
```

---

## 10. Performance Optimization

### 10.1 Strategy Overview

| Strategy | Implementation | Target |
|---|---|---|
| **Precomputation** | APScheduler job after daily data sync | Compute once, serve from cache |
| **Incremental Update** | Only recompute last N bars on new data | ~50x faster than full recompute |
| **Cache Layering** | Redis (24h TTL) → DB (indicator_cache) → in-memory | < 1ms for cached lookups |
| **Batch Computation** | Compute all indicators for one stock in single pass | 100 stocks * 12 indicators < 1.5s |
| **Instance Caching** | Same params reuse same BaseIndicator instance | Avoids re-init overhead |
| **Resample Once** | Resample daily DF → weekly/monthly once per MTF run | Eliminates redundant resampling |

### 10.2 Incremental Update Implementation

```python
"""
Extension to IndicatorService for incremental computation.
"""

async def incremental_update(
    self,
    db: AsyncSession,
    stock_id: int,
    new_bars: int = 5,
) -> None:
    """Recompute only the last N bars for all indicators.

    Called when new daily data arrives for 1-2 bars. Instead of
    recomputing the full history, we use a truncated DataFrame
    that includes max_lookback bars + new bars, where max_lookback
    is the maximum required lookback across all indicators.

    Args:
        db: Database session.
        stock_id: Stock to update.
        new_bars: Number of new bars that arrived.
    """
    from backend.app.models.stock import StockPriceDaily

    # Find the maximum lookback across all registered indicators
    max_lookback = max(
        (m.min_bars for m in indicator_registry.list_all()),
        default=20,
    )

    # Load last (max_lookback + new_bars) rows
    price_stmt = (
        select(StockPriceDaily)
        .where(StockPriceDaily.stock_id == stock_id)
        .order_by(StockPriceDaily.trade_date.desc())
        .limit(max_lookback + new_bars)
    )
    result = await db.execute(price_stmt)
    rows = result.scalars().all()[::-1]  # Reverse to ascending

    df = pd.DataFrame(
        [{"open": r.open, "high": r.high,
          "low": r.low, "close": r.close,
          "volume": r.volume} for r in rows],
        index=pd.DatetimeIndex([r.trade_date for r in rows]),
    )

    # Recompute all indicators on the truncated DataFrame
    for name in indicator_registry.list_names():
        try:
            params = await ParameterResolver.resolve(
                indicator_name=name, stock_id=stock_id, db=db)
            instance = indicator_registry.get_instance(
                name, params)
            ir = instance.compute(df)
            output = IndicatorOutput.from_result(
                ir, include_series=False)  # Only latest
            cache_key = self._cache_key(
                stock_id, name, params, "1d")
            await self._set_cache(
                cache_key, output, db,
                stock_id, name, params, "1d")
        except Exception:
            logger.exception(
                "Incremental update failed: "
                "stock=%s indicator=%s", stock_id, name)
```

### 10.3 APScheduler Job Integration

```python
"""
backend/app/scheduler/jobs.py

Scheduled jobs for indicator precomputation.
"""


async def job_precompute_indicators():
    """Called after sync_daily_prices completes.

    1. Get all active stocks
    2. Precompute all indicators using system defaults
    3. Store in DB cache + Redis (24h TTL)
    """
    from backend.app.core.deps import get_async_session
    from backend.app.services.indicator_service import (
        IndicatorService)
    from backend.app.core.config import settings

    async with get_async_session() as db:
        service = IndicatorService(
            redis_client=settings.redis_client)
        stats = await service.precompute_all(db)
        logger.info(
            "indicator precomputation complete: "
            "%s stocks, %s indicators cached",
            stats["stocks_processed"],
            stats["indicators_computed"],
        )


async def job_cleanup_stale_cache():
    """Clean up indicator_cache entries older than 24 hours."""
    from datetime import datetime, timedelta
    from backend.app.core.deps import get_async_session
    from backend.app.models.indicator import IndicatorCache
    from sqlalchemy import delete

    async with get_async_session() as db:
        cutoff = datetime.utcnow() - timedelta(hours=24)
        stmt = delete(IndicatorCache).where(
            IndicatorCache.computed_at < cutoff)
        result = await db.execute(stmt)
        await db.commit()
        logger.info(
            "Cleaned up %s stale indicator cache entries",
            result.rowcount,
        )
```

### 10.4 Benchmark Targets

| Scenario | Target | Notes |
|---|---|---|
| Single indicator, cached | < 1ms | Redis GET |
| Single indicator, uncached | < 50ms | pandas-ta computation |
| 12 indicators, one stock | < 300ms | Batch compute |
| 100 stocks * 12 indicators | < 1.5s | Precomputation, single pass |
| Multi-timeframe (3 TF * 3 ind) | < 200ms | Resample once |
| Incremental update (1 stock) | < 100ms | Only recent bars |

---

## 11. Plugin Distribution & Versioning

### 11.1 Plugin Manifest for External Plugins

External plugins are distributed as standard Python packages with a `trendscope.yaml` manifest:

```yaml
# trendscope.yaml (in the plugin package root)
manifest_version: "1.0"
plugin:
  name: "awesome-oscillators"
  display_name: "Awesome Oscillators Pack"
  version: "2.1.0"
  author: "MyCompany Inc."
  description: "Collection of custom oscillators including Fractal Efficiency"
  api_version: "1.0"
  license: "MIT"
  homepage: "https://github.com/mycompany/trendscope-awesome-oscillators"

indicators:
  - class: "awesome_oscillators.indicators:FractalEfficiencyIndicator"
    entry_point: "fractal_efficiency"
  - class: "awesome_oscillators.indicators:AdaptiveMACDIndicator"
    entry_point: "adaptive_macd"

dependencies:
  python: ">=3.12"
  trendscope: ">=1.0.0"
```

### 11.2 Version Compatibility Checking

```python
"""
backend/app/services/indicators/versioning.py

Semantic version compatibility checking between plugins and framework.
"""

from __future__ import annotations

import re
from typing import NamedTuple


class SemVer(NamedTuple):
    major: int
    minor: int
    patch: int

    @classmethod
    def parse(cls, version: str) -> "SemVer":
        """Parse a SemVer string like '1.2.3'."""
        match = re.match(
            r"^(\d+)\.(\d+)\.(\d+)", version.strip())
        if not match:
            raise ValueError(
                f"Invalid SemVer: {version}")
        return cls(
            int(match.group(1)),
            int(match.group(2)),
            int(match.group(3)),
        )

    def is_compatible_with(
        self, required: "SemVer"
    ) -> bool:
        """Check if self satisfies required version.

        Compatible if same major version and self >= required.
        """
        if self.major != required.major:
            return False
        if self.minor < required.minor:
            return False
        if (
            self.minor == required.minor
            and self.patch < required.patch
        ):
            return False
        return True

    def __str__(self) -> str:
        return f"{self.major}.{self.minor}.{self.patch}"


def check_plugin_compatibility(
    plugin_api_version: str,
    framework_api_version: str,
) -> tuple[bool, str]:
    """Check if a plugin is compatible with the framework.

    Args:
        plugin_api_version: The api_version from plugin metadata.
        framework_api_version: The framework's current api_version.

    Returns:
        (is_compatible, reason_string)
    """
    try:
        plugin_sv = SemVer.parse(plugin_api_version)
        framework_sv = SemVer.parse(framework_api_version)
    except ValueError as e:
        return False, f"Invalid version: {e}"

    if plugin_sv.major != framework_sv.major:
        return (
            False,
            f"Plugin requires API v{plugin_sv.major}.x, "
            f"framework is v{framework_sv}",
        )

    if plugin_sv > framework_sv:
        return (
            False,
            f"Plugin requires >= v{plugin_sv}, "
            f"framework is v{framework_sv}",
        )

    return True, "Compatible"
```

### 11.3 pip-installable Plugin via setuptools entry_points

**pyproject.toml** for a third-party plugin:

```toml
[build-system]
requires = ["setuptools>=75", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "trendscope-awesome-oscillators"
version = "2.1.0"
description = "Custom oscillators for Trend-Scope"
requires-python = ">=3.12"
dependencies = [
    "trend-scope>=1.0.0",
    "pandas>=2.0",
    "pandas-ta-classic>=0.6",
]

[project.entry-points."trendscope.indicators"]
fractal_efficiency = "awesome_oscillators.indicators:FractalEfficiencyIndicator"
adaptive_macd = "awesome_oscillators.indicators:AdaptiveMACDIndicator"
```

**Installation**:
```bash
pip install trendscope-awesome-oscillators
# Restart the server — indicator_registry.discover_entry_points() picks them up
```

### 11.4 Plugin Marketplace Concept (Future)

The plugin marketplace would be a web index of community-contributed plugins:

- **Registry**: JSON index hosted at `https://plugins.trendscope.app/index.json`
- **Metadata**: Each plugin listed with name, description, author, version, downloads
- **Installation**: `trendscope plugin install awesome-oscillators`
- **Verification**: Signed plugin packages, automated CI testing against framework
- **Categories**: Same as `IndicatorCategory` enum — overlap, momentum, trend, volatility, volume, pattern
- **Rating/Review**: User ratings and reviews for plugin quality

This is a Phase 9+ feature. Phase 3-8 uses only built-in indicators + manual pip installs.

---

## 12. Testing

### 12.1 Test Strategy

```python
"""
backend/tests/test_indicators/
├── conftest.py                    # Fixtures: sample OHLCV data, registry setup
├── test_registry_discovery.py    # Registry discovery tests
├── test_base_indicator.py        # BaseIndicator param validation
├── test_data_models.py           # Pydantic model validation
├── test_indicators/
│   ├── test_sma.py               # SMA against known values
│   ├── test_ema.py
│   ├── test_wma.py
│   ├── test_hma.py
│   ├── test_macd.py
│   ├── test_rsi.py
│   ├── test_bollinger.py
│   ├── test_atr.py
│   ├── test_volume.py            # OBV, VWAP, Volume Profile
│   ├── test_stochastic.py
│   ├── test_adx.py
│   ├── test_ichimoku.py
│   └── test_fibonacci.py
├── test_parameter_resolver.py    # 5-level parameter resolution
├── test_multi_timeframe.py       # Resampling and confluence
├── test_indicator_service.py     # Service integration tests
└── test_performance.py           # Benchmarks
```

### 12.2 Sample Data Fixture (conftest.py)

```python
"""
backend/tests/test_indicators/conftest.py

Shared fixtures for indicator tests.
"""

import numpy as np
import pandas as pd
import pytest


@pytest.fixture
def sample_ohlcv_daily() -> pd.DataFrame:
    """Generate 200 bars of synthetic OHLCV daily data."""
    np.random.seed(42)
    n = 200
    dates = pd.date_range(
        "2026-01-01", periods=n, freq="B")

    # Simulate a random walk with drift
    close = 100 + np.cumsum(np.random.randn(n) * 0.5)
    close = np.abs(close) + 50

    high = close + np.abs(np.random.randn(n) * 1.5)
    low = close - np.abs(np.random.randn(n) * 1.5)
    open_ = low + np.random.rand(n) * (high - low)

    # Ensure high >= open/close >= low
    high = np.maximum(high, np.maximum(open_, close))
    low = np.minimum(low, np.minimum(open_, close))

    volume = np.random.randint(1000000, 10000000, n)

    return pd.DataFrame({
        "open": open_,
        "high": high,
        "low": low,
        "close": close,
        "volume": volume,
    }, index=pd.DatetimeIndex(dates))


@pytest.fixture
def sample_ohlcv_known() -> pd.DataFrame:
    """Small known OHLCV dataset for exact-value testing."""
    dates = pd.date_range("2026-01-01", periods=10, freq="D")
    return pd.DataFrame({
        "open":  [100, 101, 102, 103, 104,
                  105, 106, 107, 108, 109],
        "high":  [102, 103, 104, 105, 106,
                  107, 108, 109, 110, 111],
        "low":   [99,  100, 101, 102, 103,
                  104, 105, 106, 107, 108],
        "close": [101, 102, 103, 104, 105,
                  106, 107, 108, 109, 110],
        "volume":[1e6, 2e6, 3e6, 2e6, 4e6,
                  5e6, 3e6, 2e6, 4e6, 3e6],
    }, index=pd.DatetimeIndex(dates))


@pytest.fixture(autouse=True)
def setup_registry():
    """Ensure registry is populated before each test."""
    from backend.app.services.indicators.registry import (
        indicator_registry)
    if indicator_registry.count() == 0:
        indicator_registry.discover_builtin()
    yield
```

### 12.3 Indicator Unit Test Example (RSI)

```python
"""
backend/tests/test_indicators/test_rsi.py

RSI indicator unit tests against known values.
"""

import numpy as np
import pandas as pd
import pytest

from backend.app.services.indicators.builtin.rsi import (
    RSIIndicator,
)


class TestRSIIndicator:
    """Tests for RSI indicator."""

    def test_metadata_structure(self):
        """Verify metadata has required fields."""
        meta = RSIIndicator.metadata
        assert meta.name == "rsi"
        assert meta.display_name == "Relative Strength Index"
        assert meta.category.value == "momentum"
        assert len(meta.params) == 3
        assert len(meta.outputs) == 2

    def test_default_params(self):
        """Default params should be set correctly."""
        indicator = RSIIndicator()
        params = indicator.get_params()
        assert params["length"] == 14
        assert params["overbought"] == 70
        assert params["oversold"] == 30

    def test_custom_params(self):
        """Custom params should override defaults."""
        indicator = RSIIndicator(
            {"length": 7, "overbought": 80})
        params = indicator.get_params()
        assert params["length"] == 7
        assert params["overbought"] == 80
        assert params["oversold"] == 30  # unchanged default

    def test_invalid_param_raises(self):
        """Invalid params should raise ValueError."""
        with pytest.raises(ValueError):
            RSIIndicator({"length": -1})
        with pytest.raises(ValueError):
            RSIIndicator({"unknown_param": 42})

    def test_compute_shape(
        self, sample_ohlcv_daily):
        """Output DataFrame should match input shape."""
        indicator = RSIIndicator()
        result = indicator.compute(sample_ohlcv_daily)
        assert len(result.data) == len(sample_ohlcv_daily)
        assert "rsi" in result.data.columns
        assert "rsi_signal" in result.data.columns

    def test_rsi_range(
        self, sample_ohlcv_daily):
        """RSI values should be in [0, 100] range."""
        indicator = RSIIndicator()
        result = indicator.compute(sample_ohlcv_daily)
        valid = result.data["rsi"].dropna()
        assert valid.min() >= 0
        assert valid.max() <= 100

    def test_rsi_known_values(self):
        """RSI computed against manually verified values."""
        # Simplified test: all-up trend should give RSI near 100
        n = 50
        dates = pd.date_range("2026-01-01", periods=n, freq="D")
        close_up = pd.Series(
            100 + np.arange(n) * 5, name="close")

        df = pd.DataFrame(
            {"close": close_up},
            index=pd.DatetimeIndex(dates))

        indicator = RSIIndicator({"length": 14})
        result = indicator.compute(df)
        last_rsi = result.data["rsi"].iloc[-1]
        # In a pure uptrend, RSI should be very high
        assert last_rsi > 95, f"Expected RSI > 95, got {last_rsi}"

    def test_signal_classification(
        self, sample_ohlcv_daily):
        """Signal column should contain expected categories."""
        indicator = RSIIndicator()
        result = indicator.compute(sample_ohlcv_daily)
        signals = result.data["rsi_signal"].dropna()
        valid_signals = {"overbought", "oversold", "neutral"}
        assert set(signals.unique()).issubset(valid_signals)

    def test_missing_columns_raises(self):
        """Compute with missing required columns should raise."""
        indicator = RSIIndicator()
        bad_df = pd.DataFrame(
            {"bad_column": [1, 2, 3]},
            index=pd.DatetimeIndex(
                pd.date_range("2026-01-01", periods=3)))
        with pytest.raises(ValueError, match="Missing required"):
            indicator.compute(bad_df)
```

### 12.4 Registry Discovery Tests

```python
"""
backend/tests/test_indicators/test_registry_discovery.py
"""

import pytest


class TestIndicatorRegistry:
    """Tests for the indicator registry."""

    def test_builtin_discovery(self):
        """All 12 builtin indicators should be discoverable."""
        from backend.app.services.indicators.registry import (
            indicator_registry,
        )
        expected = {
            "sma", "ema", "wma", "hma",
            "macd", "rsi", "bollinger", "atr",
            "obv", "vwap", "volume_profile",
            "stochastic", "adx", "ichimoku", "fibonacci",
        }
        registered = set(indicator_registry.list_names())
        assert expected.issubset(registered), (
            f"Missing: {expected - registered}")

    def test_count_minimum(self):
        """Registry should have at least 15 indicators."""
        from backend.app.services.indicators.registry import (
            indicator_registry,
        )
        assert indicator_registry.count() >= 15

    def test_get_valid_indicator(self):
        """get() should return the correct class."""
        from backend.app.services.indicators.registry import (
            indicator_registry,
        )
        from backend.app.services.indicators.builtin.rsi import (
            RSIIndicator,
        )
        cls = indicator_registry.get("rsi")
        assert cls is RSIIndicator

    def test_get_nonexistent_returns_none(self):
        """get() should return None for unknown indicators."""
        from backend.app.services.indicators.registry import (
            indicator_registry,
        )
        assert indicator_registry.get("nonexistent") is None

    def test_get_instance_raises_for_unknown(self):
        """get_instance() should raise for unknown indicators."""
        from backend.app.services.indicators.registry import (
            indicator_registry,
        )
        with pytest.raises(ValueError, match="not found"):
            indicator_registry.get_instance("nonexistent")

    def test_list_by_category(self):
        """list_by_category() should group correctly."""
        from backend.app.services.indicators.registry import (
            indicator_registry,
        )
        grouped = indicator_registry.list_by_category()
        assert "overlap" in grouped
        assert "momentum" in grouped
        assert "trend" in grouped
        assert "volatility" in grouped
        assert "volume" in grouped
        assert "sma" in grouped["overlap"]
        assert "rsi" in grouped["momentum"]

    def test_instance_caching(self):
        """Same params should return the same instance."""
        from backend.app.services.indicators.registry import (
            indicator_registry,
        )
        inst1 = indicator_registry.get_instance(
            "rsi", {"length": 14})
        inst2 = indicator_registry.get_instance(
            "rsi", {"length": 14})
        assert inst1 is inst2

    def test_different_params_different_instances(self):
        """Different params should return different instances."""
        from backend.app.services.indicators.registry import (
            indicator_registry,
        )
        inst1 = indicator_registry.get_instance(
            "rsi", {"length": 14})
        inst2 = indicator_registry.get_instance(
            "rsi", {"length": 7})
        assert inst1 is not inst2
```

### 12.5 Parameter Resolution Tests

```python
"""
backend/tests/test_indicators/test_parameter_resolver.py
"""

import pytest

from backend.app.services.indicators.parameter_resolver import (
    StaticParameterResolver,
)


class TestParameterResolution:
    """Tests for the 5-level parameter resolution cascade."""

    def test_resolve_defaults_only(self):
        """With no overrides, system defaults should be returned."""
        resolver = StaticParameterResolver()
        params = resolver.resolve("rsi")
        assert params["length"] == 14
        assert params["overbought"] == 70
        assert params["oversold"] == 30

    def test_request_params_highest_priority(self):
        """Request params should override everything."""
        resolver = StaticParameterResolver(
            stock_overrides={
                1: {"rsi": {"length": 7, "overbought": 80}},
            },
            tier_presets={
                3: {"rsi": {"length": 21}},
            },
        )
        params = resolver.resolve(
            indicator_name="rsi",
            stock_id=1,
            user_tier_id=3,
            request_params={"length": 5},
        )
        assert params["length"] == 5  # Request wins

    def test_stock_override_over_tier_preset(self):
        """Stock overrides should beat tier presets."""
        resolver = StaticParameterResolver(
            stock_overrides={
                1: {"rsi": {"overbought": 75}},
            },
            tier_presets={
                3: {"rsi": {"overbought": 85}},
            },
        )
        params = resolver.resolve(
            indicator_name="rsi",
            stock_id=1,
            user_tier_id=3,
        )
        assert params["overbought"] == 75  # Stock wins

    def test_tier_preset_over_system_default(self):
        """Tier presets should beat system defaults."""
        resolver = StaticParameterResolver(
            tier_presets={
                3: {"rsi": {"overbought": 65}},
            },
        )
        params = resolver.resolve(
            indicator_name="rsi",
            user_tier_id=3,
        )
        assert params["overbought"] == 65

    def test_unknown_indicator_raises(self):
        """Resolving unknown indicator should raise."""
        resolver = StaticParameterResolver()
        with pytest.raises(ValueError, match="Unknown"):
            resolver.resolve("nonexistent_indicator")
```

### 12.6 Multi-Timeframe Correctness Tests

```python
"""
backend/tests/test_indicators/test_multi_timeframe.py
"""

import numpy as np
import pandas as pd
import pytest

from backend.app.services.indicators.multi_timeframe import (
    MultiTimeframeAnalyzer,
    TimeframeSpec,
)


class TestMultiTimeframe:
    """Tests for multi-timeframe analysis."""

    @pytest.fixture
    def large_daily_data(self) -> pd.DataFrame:
        """Generate 500 bars of daily data for MTF testing."""
        np.random.seed(123)
        n = 500
        dates = pd.date_range(
            "2024-06-01", periods=n, freq="B")
        close = 100 + np.cumsum(np.random.randn(n) * 0.3)
        close = np.abs(close) + 50
        high = close + np.abs(np.random.randn(n) * 2)
        low = close - np.abs(np.random.randn(n) * 2)
        open_ = low + np.random.rand(n) * (high - low)
        high = np.maximum(high, np.maximum(open_, close))
        low = np.minimum(low, np.minimum(open_, close))
        volume = np.random.randint(1e6, 10e6, n)

        return pd.DataFrame({
            "open": open_, "high": high,
            "low": low, "close": close,
            "volume": volume,
        }, index=pd.DatetimeIndex(dates))

    def test_daily_passthrough(self, large_daily_data):
        """1d timeframe should not modify data."""
        analyzer = MultiTimeframeAnalyzer()
        resampled = analyzer._resample(large_daily_data, "1d")
        assert len(resampled) == len(large_daily_data)

    def test_weekly_resample_friday_anchor(
        self, large_daily_data):
        """Weekly resample should anchor to Friday."""
        analyzer = MultiTimeframeAnalyzer()
        weekly = analyzer._resample(
            large_daily_data, "1w")
        assert len(weekly) < len(large_daily_data)
        # Most weeks should end on Friday (weekday 4)
        fridays = sum(
            1 for d in weekly.index if d.weekday() == 4)
        total = len(weekly)
        assert fridays / total > 0.7, (
            f"Expected most weeks to end on Friday, "
            f"got {fridays}/{total}")

    def test_monthly_resample(self, large_daily_data):
        """Monthly resample should produce fewer bars."""
        analyzer = MultiTimeframeAnalyzer()
        monthly = analyzer._resample(
            large_daily_data, "1M")
        assert len(monthly) < len(large_daily_data)

    def test_ohlcv_aggregation_correctness(self):
        """Resample aggregation should be correct."""
        dates = pd.date_range(
            "2026-01-05", periods=10, freq="B")
        df = pd.DataFrame({
            "open":  [10, 11, 12, 13, 14,
                      15, 16, 17, 18, 19],
            "high":  [15, 16, 17, 18, 19,
                      20, 21, 22, 23, 24],
            "low":   [8,  9,  10, 11, 12,
                      13, 14, 15, 16, 17],
            "close": [12, 13, 14, 15, 16,
                      17, 18, 19, 20, 21],
            "volume":[100, 200, 100, 200, 100,
                      200, 100, 200, 100, 200],
        }, index=pd.DatetimeIndex(dates))

        analyzer = MultiTimeframeAnalyzer()
        # Resample to weekly (should create 1-2 bars)
        weekly = analyzer._resample(df, "1w")
        assert len(weekly) <= 2

        # Check that open is first, close is last, volume is sum
        if len(weekly) > 0:
            first_week = weekly.iloc[0]
            assert first_week["open"] == 10  # First day open
            assert first_week["volume"] >= 500  # Sum of volumes

    def test_mtf_analyze_computes_all_timeframes(
        self, large_daily_data):
        """Analyze should compute indicators for each timeframe."""
        analyzer = MultiTimeframeAnalyzer()
        specs = [
            TimeframeSpec(
                timeframe="1d",
                indicators=["rsi"]),
            TimeframeSpec(
                timeframe="1w",
                indicators=["rsi"]),
        ]
        result = analyzer.analyze(large_daily_data, specs)
        assert "1d" in result.timeframe_results
        assert "1w" in result.timeframe_results
        assert "rsi" in result.timeframe_results["1d"]
        assert "rsi" in result.timeframe_results["1w"]
```

### 12.7 Performance Benchmarks

```python
"""
backend/tests/test_indicators/test_performance.py

Performance benchmarks for indicator computation.
"""

import time

import numpy as np
import pandas as pd


def test_single_indicator_speed():
    """Single RSI computation on 200 bars should be < 50ms."""
    np.random.seed(42)
    n = 200
    dates = pd.date_range("2026-01-01", periods=n, freq="B")
    close = 100 + np.cumsum(np.random.randn(n) * 0.5)
    close = np.abs(close) + 50
    df = pd.DataFrame(
        {"close": close},
        index=pd.DatetimeIndex(dates))

    from backend.app.services.indicators.builtin.rsi import (
        RSIIndicator,
    )

    indicator = RSIIndicator()

    start = time.perf_counter()
    for _ in range(10):
        indicator.compute(df)
    elapsed = (time.perf_counter() - start) / 10

    assert elapsed < 0.05, (
        f"RSI too slow: {elapsed*1000:.1f}ms (target < 50ms)")


def test_batch_12_indicators_speed():
    """All 12 indicators on 500 bars should be < 300ms."""
    np.random.seed(42)
    n = 500
    dates = pd.date_range("2024-01-01", periods=n, freq="B")
    close = 100 + np.cumsum(np.random.randn(n) * 0.3)
    close = np.abs(close) + 50
    high = close + np.abs(np.random.randn(n) * 2)
    low = close - np.abs(np.random.randn(n) * 2)
    open_ = low + np.random.rand(n) * (high - low)
    high = np.maximum(high, np.maximum(open_, close))
    low = np.minimum(low, np.minimum(open_, close))
    volume = np.random.randint(1e6, 10e6, n)

    df = pd.DataFrame({
        "open": open_, "high": high,
        "low": low, "close": close,
        "volume": volume,
    }, index=pd.DatetimeIndex(dates))

    from backend.app.services.indicators.registry import (
        indicator_registry,
    )

    start = time.perf_counter()
    for name in indicator_registry.list_names():
        try:
            instance = indicator_registry.get_instance(name)
            instance.compute(df)
        except Exception:
            pass
    elapsed = time.perf_counter() - start

    assert elapsed < 0.3, (
        f"Batch too slow: {elapsed*1000:.1f}ms "
        f"(target < 300ms)")


def test_instance_cache_performance():
    """get_instance() should be instant after first call."""
    from backend.app.services.indicators.registry import (
        indicator_registry,
    )

    # First call (uncached)
    start = time.perf_counter()
    indicator_registry.get_instance("rsi", {"length": 14})
    first_call = time.perf_counter() - start

    # Second call (cached)
    start = time.perf_counter()
    for _ in range(1000):
        indicator_registry.get_instance(
            "rsi", {"length": 14})
    cached_avg = (time.perf_counter() - start) / 1000

    assert cached_avg < 0.001, (
        f"Cached get_instance too slow: "
        f"{cached_avg*1e6:.1f}us (target < 1000us)")
```

---

## Appendix A: Directory Structure

```
backend/app/services/indicators/
├── __init__.py                  # Public API: get_available_indicators(), compute_indicator()
├── base.py                      # BaseIndicator ABC
├── models.py                    # Pydantic data models
├── registry.py                  # IndicatorRegistry (singleton)
├── parameter_resolver.py        # 5-level parameter cascade
├── multi_timeframe.py           # MultiTimeframeAnalyzer
├── versioning.py                # SemVer compatibility checking
├── builtin/
│   ├── __init__.py              # Re-exports all builtins
│   ├── sma.py                   # SMAIndicator
│   ├── ema.py                   # EMAIndicator
│   ├── wma.py                   # WMAIndicator
│   ├── hma.py                   # HMAIndicator
│   ├── macd.py                  # MACDIndicator
│   ├── rsi.py                   # RSIIndicator
│   ├── bollinger.py             # BollingerBandsIndicator
│   ├── atr.py                   # ATRIndicator
│   ├── volume.py                # OBVIndicator, VWAPIndicator, VolumeProfileIndicator
│   ├── stochastic.py            # StochasticIndicator
│   ├── adx.py                   # ADXIndicator
│   ├── ichimoku.py              # IchimokuIndicator
│   └── fibonacci.py             # FibonacciIndicator
└── custom/
    └── .gitkeep                  # User-installed plugins directory

backend/app/services/
└── indicator_service.py         # IndicatorService (orchestration)

backend/app/api/v1/
├── analysis.py                  # Indicator compute + discovery endpoints
└── admin/
    └── indicators.py            # Admin preset + override management
```

## Appendix B: Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| **Primary indicator library** | pandas-ta-classic | Pure Python, 252+ indicators, optional TA-Lib acceleration, MIT license |
| **Plugin registry pattern** | Singleton + auto-discovery | Simpler than DI containers; startup-time scanning is < 50ms |
| **Instance caching** | (name, frozenset(params)) | Same params = same instance; thread-safe since indicators are stateless |
| **Error isolation** | Per-module try/except | One broken third-party plugin must not crash the entire system |
| **Parameter resolution** | 5-level cascade with DB | Allows per-stock tuning without code changes; cached for performance |
| **Cache strategy** | Redis (24h TTL) + DB table | 2-tier: Redis for speed, DB for durability and cold start |
| **Incremental update** | Truncated DataFrame with max lookback | Only recompute tail bars; avoids full recomputation |
| **Multi-timeframe** | Pandas resample with fixed anchors | W-FRI for weekly matches US market convention |
| **Plugin distribution** | setuptools entry_points | Standard Python packaging; no custom tooling needed |
| **Version compatibility** | SemVer major version check | Simple, well-understood; prevents breaking changes |

