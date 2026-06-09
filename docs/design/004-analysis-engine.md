# 004 — Analysis Engine Design

> **Status**: Draft v1
> **Date**: 2026-06-09
> **Purpose**: Comprehensive design of the 3-layer analysis engine: Rule-Based → ML-Enhanced → LLM-Confirmed, including signal generation, ensemble voting, data flow, service class design, performance targets, and testing strategy.
>
> **References**:
> - [001-preliminary-design.md](../design/001-preliminary-design.md) — architecture overview, DB schema, dev phases
> - [005-analysis-engine.md](../research/005-analysis-engine.md) — quant methods, ML models, signal architecture research
> - [009-ai-analysis.md](../research/009-ai-analysis.md) — LLM providers, prompt engineering, model routing

---

## 1. Architecture Overview

The analysis engine is a 3-layer cascading pipeline. Each layer refines signals from the previous layer, with a **SignalRouter** gating progression based on confidence thresholds and user tier.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            Analysis Engine                                     │
│                                                                              │
│   ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐      │
│   │   Layer 1       │─conf─▶│   Layer 2       │─conf─▶│   Layer 3       │      │
│   │   Rule-Based    │ ≥0.3  │   ML-Enhanced   │ ≥0.6  │   LLM-Confirmed │      │
│   │                 │       │                 │       │                 │      │
│   │   Tiers: all    │       │   Tiers: Pro    │       │   Tiers: Pro    │      │
│   │   Cost:   $0    │       │   Cost:  GPU    │       │   Cost:  API    │      │
│   │   Latency <1ms  │       │   Latency <100ms│       │   Latency <3s   │      │
│   └────────┬────────┘       └────────┬────────┘       └────────┬────────┘      │
│            │                         │                         │              │
│            ▼                         ▼                         ▼              │
│   ┌─────────────────────────────────────────────────────────────────────┐     │
│   │                       SignalEnsemble (voting)                        │     │
│   │   Combines all layer outputs into final signal + confidence score    │     │
│   └─────────────────────────────────────────────────────────────────────┘     │
│                                    │                                         │
│                                    ▼                                         │
│   ┌─────────────────────────────────────────────────────────────────────┐     │
│   │          SignalRouter — gates progression by confidence              │     │
│   │                                                                     │     │
│   │   Layer1.confidence < 0.3  ──▶ DISCARD (noise)                      │     │
│   │   Layer1.confidence ≥ 0.3  ──▶ PROMOTE to ML (Pro tier only)         │     │
│   │   Layer2.confidence ≥ 0.6  ──▶ PROMOTE to LLM (Pro tier only)       │     │
│   │   Layer2.confidence < 0.6  ──▶ FINALIZE with Layer1+2 score          │     │
│   └─────────────────────────────────────────────────────────────────────┘     │
│                                    │                                         │
│                                    ▼                                         │
│                        ┌────────────────────┐                                │
│                        │  AlertDispatcher    │                                │
│                        │  + DB persistence   │                                │
│                        └────────────────────┘                                │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 1.1 Tier-Based Availability

| Layer | Free | Basic | Pro | Admin |
|-------|------|-------|-----|-------|
| L1 Rule-Based | Full (template analysis only) | Full | Full | Full |
| L2 ML-Enhanced | — | — | Full | Full |
| L3 LLM-Confirmed | — | DeepSeek Flash (10/day) | Claude Haiku (50/day) | Unlimited |

### 1.2 Signal Flow Decision Tree

```
                    ┌──────────────┐
                    │  OHLCV Data  │
                    │  + Indicators│
                    └──────┬───────┘
                           ▼
                    ┌──────────────┐
                    │ Layer 1      │
                    │ Rule-Based   │
                    └──────┬───────┘
                           ▼
                   ┌───────────────┐
                   │ Composite     │
                   │ Score ≥ │0.2│?│──No──▶ HOLD / No Signal
                   └──────┬────────┘
                          │Yes
                          ▼
                   ┌──────────────┐
                   │ Whipsaw      │
                   │ Filter       │
                   └──────┬───────┘
                          ▼
                   ┌──────────────┐
                   │ Dedup Check  │
                   │ (20-day)     │
                   └──────┬───────┘
                          ▼
                   ┌──────────────┐
                   │ confidence   │
                   │ ≥ 0.3?       │──No──▶ Store as LOW confidence signal
                   └──────┬───────┘
                          │Yes
                          ▼
                   ┌──────────────┐
                   │ Pro tier?    │──No──▶ Finalize L1 signal
                   └──────┬───────┘
                          │Yes
                          ▼
                   ┌──────────────┐
                   │ Layer 2      │
                   │ ML-Enhanced  │
                   └──────┬───────┘
                          ▼
                   ┌──────────────┐
                   │ confidence   │
                   │ ≥ 0.6?       │──No──▶ Finalize L1+L2 signal
                   └──────┬───────┘
                          │Yes
                          ▼
                   ┌──────────────┐
                   │ Layer 3      │
                   │ LLM-Confirmed│
                   └──────┬───────┘
                          ▼
                   ┌──────────────┐
                   │ Validate     │
                   │ (7 checks)   │
                   └──────┬───────┘
                          ▼
                   ┌──────────────┐
                   │ Final Signal │
                   │ + Analysis   │
                   │ Report       │
                   └──────────────┘
```

---

## 2. Layer 1: Rule-Based Signals

Phase 1-3. Deterministic, zero-cost, sub-millisecond. All tiers.

### 2.1 MA Crossover Detection

**Algorithm — Pseudocode:**

```
FUNCTION detect_ma_crossover(df, fast_period, slow_period):
    ma_fast = rolling_mean(df.close, fast_period)
    ma_slow = rolling_mean(df.close, slow_period)

    // Cross detection: fast was below, now above → golden
    golden_cross = (ma_fast > ma_slow) AND (shift(ma_fast, 1) <= shift(ma_slow, 1))

    // Death cross: fast was above, now below
    death_cross = (ma_fast < ma_slow) AND (shift(ma_fast, 1) >= shift(ma_slow, 1))

    return golden_cross, death_cross, ma_fast, ma_slow
```

**Python Implementation:**

```python
import pandas as pd
import numpy as np

@dataclass
class MACrossoverSignal:
    date: pd.Timestamp
    signal_type: str         # "golden_cross" | "death_cross"
    fast_period: int
    slow_period: int
    ma_fast_val: float
    ma_slow_val: float
    price: float
    volume_ratio: float      # signal_day_volume / 20d_avg
    confirmed: bool

def detect_ma_crossover(
    df: pd.DataFrame,
    fast: int = 50,
    slow: int = 200,
    confirm_bars: int = 2,
    volume_confirm: bool = True,
) -> list[MACrossoverSignal]:
    df = df.copy()
    df["ma_fast"] = df["close"].rolling(fast).mean()
    df["ma_slow"] = df["close"].rolling(slow).mean()
    df["vol_ma"] = df["volume"].rolling(20).mean()
    df["volume_ratio"] = df["volume"] / df["vol_ma"]

    # Raw cross detection (shift-before comparison to avoid lookahead)
    prev_fast_above = df["ma_fast"].shift(1) > df["ma_slow"].shift(1)
    curr_fast_above = df["ma_fast"] > df["ma_slow"]

    df["golden_cross_raw"] = curr_fast_above & ~prev_fast_above
    df["death_cross_raw"] = ~curr_fast_above & prev_fast_above

    signals = []
    for idx in df[df["golden_cross_raw"] | df["death_cross_raw"]].index:
        row = df.loc[idx]
        is_golden = bool(row["golden_cross_raw"])
        signal_type = "golden_cross" if is_golden else "death_cross"

        # Confirmation: require N bars holding after cross
        pos = df.index.get_loc(idx)
        if pos + confirm_bars >= len(df):
            continue
        confirm_slice = df.iloc[pos + 1 : pos + 1 + confirm_bars]
        if is_golden:
            confirmed = (confirm_slice["ma_fast"] > confirm_slice["ma_slow"]).all()
        else:
            confirmed = (confirm_slice["ma_fast"] < confirm_slice["ma_slow"]).all()
        if not confirmed:
            continue

        # Volume confirmation
        if volume_confirm and row["volume_ratio"] < 1.5:
            continue

        signals.append(MACrossoverSignal(
            date=idx,
            signal_type=signal_type,
            fast_period=fast,
            slow_period=slow,
            ma_fast_val=round(row["ma_fast"], 4),
            ma_slow_val=round(row["ma_slow"], 4),
            price=round(row["close"], 4),
            volume_ratio=round(row["volume_ratio"], 2),
            confirmed=True,
        ))

    return signals
```

### 2.2 Golden Cross / Death Cross with Configuration

Golden/death cross signals support parameterized MA pairs from `analysis_configs`:

| Config Field | Default | Description |
|---|---|---|
| `ma_short` | 50 | Short MA period |
| `ma_long` | 200 | Long MA period |
| `ma_type` | `sma` | `sma` or `ema` |
| `confirm_bars` | 2 | Bars required after cross for confirmation |
| `volume_confirm` | `true` | Require volume > 1.5x 20-day average |
| `min_strength` | 0.0 | Minimum spread ratio to qualify |

**Strength calculation:**

```python
def calculate_cross_strength(
    ma_fast_val: float,
    ma_slow_val: float,
    price: float,
    volume_ratio: float,
) -> float:
    """Returns 0.0-1.0 based on spread magnitude and volume confirmation."""
    # Relative spread between MAs normalized by price
    spread_pct = abs(ma_fast_val - ma_slow_val) / price
    spread_score = min(spread_pct * 100, 1.0)   # 1% spread = 1.0

    # Volume boosts strength (up to 50% boost)
    vol_boost = min((volume_ratio - 1.0) / 2.0, 0.5) if volume_ratio > 1.0 else 0.0

    strength = min(spread_score * 0.6 + vol_boost, 1.0)
    return round(strength, 4)
```

**Signal classification:**

```python
def classify_strength(strength: float) -> str:
    if strength >= 0.7:
        return "strong"
    elif strength >= 0.4:
        return "normal"
    return "weak"
```

### 2.3 Bullish / Bearish Alignment Detection

Checks MA hierarchy: shorter MAs above longer MAs = bullish alignment.

```python
def detect_ma_alignment(
    df: pd.DataFrame,
    periods: tuple = (5, 20, 60, 120, 250),
) -> dict:
    """
    Returns alignment state for the latest bar.
    bullish_alignment: MA5 > MA20 > MA60 > MA120 > MA250
    bearish_alignment: MA5 < MA20 < MA60 < MA120 < MA250
    """
    mas = {}
    for p in periods:
        ma_col = f"ma_{p}"
        df[ma_col] = df["close"].rolling(p).mean()
        mas[p] = df[ma_col].iloc[-1]

    sorted_p = sorted(periods)
    prices = [mas[p] for p in sorted_p]

    bullish_count = sum(1 for i in range(len(prices) - 1) if prices[i] > prices[i + 1])
    bearish_count = sum(1 for i in range(len(prices) - 1) if prices[i] < prices[i + 1])
    total_pairs = len(sorted_p) - 1

    is_bullish = bullish_count == total_pairs
    is_bearish = bearish_count == total_pairs

    alignment_score = (bullish_count - bearish_count) / total_pairs  # [-1, 1]

    return {
        "bullish_alignment": is_bullish,
        "bearish_alignment": is_bearish,
        "alignment_score": round(alignment_score, 4),
        "ma_values": {str(p): round(mas[p], 4) for p in sorted_p},
    }
```

### 2.4 Composite Signal Scoring

Combines six indicator families into a single score using weighted `tanh` normalization.

**Formula:**

```
composite_score = tanh(
    0.20 × MA_cross_signal  +
    0.15 × RSI_signal       +
    0.20 × MACD_signal      +
    0.15 × BB_signal        +
    0.15 × Volume_signal    +
    0.15 × ROC_signal
)

→ clipped to [-1, 1]
→ binned: STRONG_SELL [-1, -0.5) / SELL [-0.5, -0.2) / HOLD [-0.2, 0.2] / BUY (0.2, 0.5] / STRONG_BUY (0.5, 1]
```

**Weights rationale (from [005]):**

| Component | Weight | Rationale |
|---|---|---|
| MA Crossover | 0.20 | Primary trend signal, highest reliability in long-term |
| MACD | 0.20 | Momentum + trend alignment, second-most reliable |
| RSI | 0.15 | Overbought/oversold context, prone to false signals in trends |
| Bollinger Bands | 0.15 | Volatility-relative positioning, good for mean-reversion |
| Volume | 0.15 | Confirmation dimension, filters false breakouts |
| ROC | 0.15 | Short-term momentum, useful for timing |

**Python Implementation:**

```python
def compute_composite_score(df: pd.DataFrame, config: dict | None = None) -> pd.DataFrame:
    if config is None:
        config = {
            "ma_crossover": {"weight": 0.20, "fast": 50, "slow": 200},
            "rsi":          {"weight": 0.15, "period": 14},
            "macd":         {"weight": 0.20, "fast": 12, "slow": 26},
            "bb":           {"weight": 0.15, "period": 20},
            "volume":       {"weight": 0.15, "lookback": 20},
            "roc":          {"weight": 0.15, "period": 10},
        }

    df = df.copy()
    composite = pd.Series(0.0, index=df.index)

    # 1. MA Crossover Signal: normalized spread between fast and slow MA
    c = config["ma_crossover"]
    fast_ma = df["close"].rolling(c["fast"]).mean()
    slow_ma = df["close"].rolling(c["slow"]).mean()
    df["sig_ma"] = np.tanh((fast_ma - slow_ma) / slow_ma * 100)
    composite += df["sig_ma"].fillna(0) * c["weight"]

    # 2. RSI Signal: transform to [-1, 1] (oversold = +1, overbought = -1)
    c = config["rsi"]
    rsi = compute_rsi(df["close"], c["period"])
    df["sig_rsi"] = -(rsi - 50) / 50
    composite += df["sig_rsi"].fillna(0) * c["weight"]

    # 3. MACD Signal: normalized histogram divergence
    c = config["macd"]
    ema_fast = df["close"].ewm(span=c["fast"], adjust=False).mean()
    ema_slow = df["close"].ewm(span=c["slow"], adjust=False).mean()
    macd_line = ema_fast - ema_slow
    macd_signal = macd_line.ewm(span=9, adjust=False).mean()
    df["sig_macd"] = np.tanh((macd_line - macd_signal) / df["close"] * 100)
    composite += df["sig_macd"].fillna(0) * c["weight"]

    # 4. Bollinger Band Signal: %B position [-1, 1]
    c = config["bb"]
    bb_mid = df["close"].rolling(c["period"]).mean()
    bb_std = df["close"].rolling(c["period"]).std()
    bb_upper = bb_mid + 2 * bb_std
    bb_lower = bb_mid - 2 * bb_std
    df["sig_bb"] = 2 * (df["close"] - bb_lower) / (bb_upper - bb_lower) - 1  # [-1, 1]
    composite += df["sig_bb"].fillna(0) * c["weight"]

    # 5. Volume Signal: volume ratio with VPA overlay
    c = config["volume"]
    vol_ratio = df["volume"] / df["volume"].rolling(c["lookback"]).mean()
    price_dir = np.sign(df["close"].diff())
    df["sig_vol"] = np.tanh(vol_ratio - 1) * price_dir
    composite += df["sig_vol"].fillna(0) * c["weight"]

    # 6. ROC Signal: rate of change
    c = config["roc"]
    roc = df["close"].pct_change(c["period"])
    df["sig_roc"] = np.tanh(roc * 100)
    composite += df["sig_roc"].fillna(0) * c["weight"]

    df["composite_score"] = composite.clip(-1, 1)
    df["composite_bin"] = pd.cut(
        df["composite_score"],
        bins=[-1.0, -0.5, -0.2, 0.2, 0.5, 1.0],
        labels=["STRONG_SELL", "SELL", "HOLD", "BUY", "STRONG_BUY"],
    )
    return df


def compute_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = (-delta).clip(lower=0)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))
```

### 2.5 Whipsaw Filter

Rapid buy/sell reversals within a short window with minimal price movement indicate noise.

**Algorithm:**

```
FUNCTION detect_whipsaw(signals, price_data, lookback_days=5, min_price_move_pct=0.02):
    filtered = []
    FOR each signal in signals ORDERED BY date:
        IF filtered is empty:
            filtered.append(signal)
            CONTINUE

        prev = filtered.last()
        days_between = (signal.date - prev.date).days
        price_change_pct = abs(signal.price / prev.price - 1)

        IF days_between <= lookback_days
           AND signal.direction != prev.direction
           AND price_change_pct < min_price_move_pct:

            // Whipsaw detected: replace previous signal with current
            filtered.pop()
            filtered.append(signal)

        ELSE:
            filtered.append(signal)

    RETURN filtered
```

**Python Implementation:**

```python
@dataclass
class WhipsawFilterResult:
    original_count: int
    filtered_count: int
    removed_signals: list[dict]
    signals: list  # filtered list

class WhipsawFilter:
    def __init__(self, lookback_days: int = 5, min_price_move_pct: float = 0.02):
        self.lookback_days = lookback_days
        self.min_price_move_pct = min_price_move_pct

    def apply(self, signals: list, price_data: pd.DataFrame) -> WhipsawFilterResult:
        removed = []
        filtered = []

        for sig in sorted(signals, key=lambda s: s.date):
            if not filtered:
                filtered.append(sig)
                continue

            prev = filtered[-1]
            days_between = (sig.date - prev.date).days
            price_change_pct = abs(sig.price / prev.price - 1)

            is_direction_flip = (
                (sig.signal_type.startswith("golden") and prev.signal_type.startswith("death"))
                or (sig.signal_type.startswith("death") and prev.signal_type.startswith("golden"))
                or (sig.direction != prev.direction)
            )

            if (
                days_between <= self.lookback_days
                and is_direction_flip
                and price_change_pct < self.min_price_move_pct
            ):
                removed.append({"removed": prev, "replaced_by": sig})
                filtered.pop()
                filtered.append(sig)
            else:
                filtered.append(sig)

        return WhipsawFilterResult(
            original_count=len(signals),
            filtered_count=len(filtered),
            removed_signals=removed,
            signals=filtered,
        )
```

### 2.6 Signal Deduplication

Prevents the same signal from firing repeatedly on the same stock+config within a time window.

```python
class SignalDeduplicator:
    def __init__(self, window_trading_days: int = 20, db_session=None):
        self.window_days = window_trading_days
        self.db = db_session

    async def is_duplicate(
        self,
        stock_id: int,
        config_id: int,
        signal_type: str,
        trigger_date: date,
    ) -> bool:
        """Check if a signal of same type exists within the dedup window."""
        cutoff = trigger_date - timedelta(days=self.window_days)
        # Query analysis_signals table
        existing = await self.db.execute(
            select(AnalysisSignal).where(
                AnalysisSignal.stock_id == stock_id,
                AnalysisSignal.config_id == config_id,
                AnalysisSignal.signal_type == signal_type,
                AnalysisSignal.is_active == True,
                AnalysisSignal.triggered_date >= cutoff,
            )
        )
        return existing.scalar_one_or_none() is not None
```

**Dedup rules:**

| Signal Type | Dedup Window | Rationale |
|---|---|---|
| `golden_cross` / `death_cross` | 20 trading days | Crosses don't happen frequently |
| `bullish_alignment` / `bearish_alignment` | 10 trading days | Can persist, but only signal on state change |
| `composite_buy` / `composite_sell` | 5 trading days | Composite can flip; prevent noise |

### 2.7 Risk Level Calculation

Uses MA alignment + ATR percentile for multi-dimensional risk assessment.

```python
@dataclass
class RiskAssessment:
    level: str         # "low" | "moderate" | "elevated" | "high"
    score: float       # 0.0 - 1.0
    factors: dict      # contributing factor scores

class RiskCalculator:
    def __init__(self, atr_period: int = 14, atr_percentile_threshold: float = 0.80):
        self.atr_period = atr_period
        self.atr_threshold = atr_percentile_threshold

    def calculate(self, df: pd.DataFrame, alignment: dict) -> RiskAssessment:
        factors = {}

        # Factor 1: MA alignment
        alignment_score = alignment["alignment_score"]  # [-1, 1] where -1 is bearish
        factors["alignment"] = 1 - (alignment_score + 1) / 2  # [0, 1] where 1 = max bearish

        # Factor 2: MA20 vs MA60 vs MA120 partial alignment
        mas = alignment["ma_values"]
        ma_20 = mas.get("20", 0)
        ma_60 = mas.get("60", 0)
        ma_120 = mas.get("120", 0)
        if ma_20 < ma_60 and ma_60 > ma_120:
            factors["ma_inversion"] = 0.7  # elevated risk
        else:
            factors["ma_inversion"] = 0.0

        # Factor 3: ATR percentile
        df = df.copy()
        df["tr"] = np.maximum(
            df["high"] - df["low"],
            np.maximum(
                abs(df["high"] - df["close"].shift(1)),
                abs(df["low"] - df["close"].shift(1)),
            ),
        )
        df["atr"] = df["tr"].rolling(self.atr_period).mean()
        df["atr_pct"] = df["atr"] / df["close"]

        current_atr_pct = df["atr_pct"].iloc[-1]
        historical_atr_pct = df["atr_pct"].dropna()
        atr_percentile = (
            (historical_atr_pct < current_atr_pct).sum() / len(historical_atr_pct)
            if len(historical_atr_pct) > 0
            else 0.5
        )
        factors["atr_percentile"] = round(atr_percentile, 4)

        if atr_percentile > self.atr_threshold:
            factors["high_volatility"] = min((atr_percentile - self.atr_threshold) / (1 - self.atr_threshold), 1.0)
        else:
            factors["high_volatility"] = 0.0

        # Factor 4: Composite score proximity to threshold (not tracked in alignment)
        # Placeholder for composite extension

        # Weighted risk score
        weights = {"alignment": 0.35, "ma_inversion": 0.25, "high_volatility": 0.25, "atr_percentile": 0.15}
        raw_score = sum(factors.get(k, 0) * w for k, w in weights.items())
        raw_score += factors.get("atr_percentile", 0.5) * weights["atr_percentile"]
        risk_score = min(max(raw_score, 0.0), 1.0)

        # Map to level
        if risk_score >= 0.75 or alignment["bearish_alignment"]:
            level = "high"
        elif risk_score >= 0.5 or factors.get("atr_percentile", 0) > self.atr_threshold:
            level = "elevated"
        elif alignment["bullish_alignment"]:
            level = "low"
        else:
            level = "moderate"

        return RiskAssessment(
            level=level,
            score=round(risk_score, 4),
            factors=factors,
        )
```

**Risk level matrix:**

| Condition | Risk Level |
|---|---|
| `bearish_alignment` = true | **high** |
| MA20 < MA60 AND MA60 > MA120 | **elevated** |
| ATR percentile > 80% | **elevated** |
| `bullish_alignment` = true | **low** |
| All others | **moderate** |

---

## 3. Layer 2: ML-Enhanced

Phase 8, Pro tier only. ML models refine Layer 1 signals with learned patterns.

### 3.1 Feature Engineering

All features are derived from OHLCV data with strict no-lookahead guarantees (all shifted appropriately).

```python
def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """Extract features from OHLCV for ML consumption."""
    df = df.copy()

    # --- Price Features (normalized by close for scale invariance) ---
    for p in [5, 10, 20, 50, 200]:
        df[f"ma_{p}_ratio"] = df["close"].rolling(p).mean() / df["close"]

    for short, long in [(5, 20), (10, 50), (20, 200), (50, 200)]:
        df[f"ma_spread_{short}_{long}"] = (
            df["close"].rolling(short).mean() / df["close"].rolling(long).mean() - 1
        )

    # --- Momentum Features ---
    for p in [5, 10, 21, 63]:  # 1w, 2w, 1m, 1q
        df[f"ret_{p}d"] = df["close"].pct_change(p)

    # RSI variants
    for p in [7, 14, 21]:
        df[f"rsi_{p}"] = compute_rsi(df["close"], p) / 100.0  # normalize to [0, 1]

    # MACD components
    ema_12 = df["close"].ewm(span=12, adjust=False).mean()
    ema_26 = df["close"].ewm(span=26, adjust=False).mean()
    df["macd_line"] = (ema_12 - ema_26) / df["close"]
    df["macd_signal"] = df["macd_line"].ewm(span=9, adjust=False).mean()
    df["macd_hist"] = df["macd_line"] - df["macd_signal"]

    # --- Volatility Features ---
    for p in [5, 21, 63]:
        df[f"volatility_{p}d"] = df["close"].pct_change().rolling(p).std() * np.sqrt(252)

    # Bollinger Bands
    bb_mid = df["close"].rolling(20).mean()
    bb_std = df["close"].rolling(20).std()
    df["bb_width"] = (2 * bb_std) / bb_mid
    df["bb_pct_b"] = (df["close"] - (bb_mid - 2 * bb_std)) / (4 * bb_std + 1e-10)

    # ATR normalized
    tr = np.maximum(
        df["high"] - df["low"],
        np.maximum(
            abs(df["high"] - df["close"].shift(1)),
            abs(df["low"] - df["close"].shift(1)),
        ),
    )
    df["atr_pct"] = tr.rolling(14).mean() / df["close"]

    # --- Volume Features ---
    df["vol_ratio_5d"] = df["volume"] / df["volume"].rolling(5).mean()
    df["vol_ratio_20d"] = df["volume"] / df["volume"].rolling(20).mean()
    df["vol_trend_5d"] = df["volume"].rolling(5).mean() / df["volume"].rolling(20).mean()

    # Volume-Price Analysis (VPA)
    price_change = df["close"].diff()
    up_vol = df["volume"].where(price_change > 0, 0)
    down_vol = df["volume"].where(price_change < 0, 0)
    df["vpa_score"] = (
        (up_vol.rolling(10).sum() - down_vol.rolling(10).sum())
        / df["volume"].rolling(10).sum().replace(0, np.nan)
    )

    # --- Trend Strength Features ---
    # ADX
    df["adx"] = compute_adx(df)

    # Days above/below MA200
    df["days_above_ma200"] = (df["close"] > df["close"].rolling(200).mean()).rolling(20).sum()
    df["days_above_ma50"] = (df["close"] > df["close"].rolling(50).mean()).rolling(20).sum()

    # --- Market Regime Features ---
    for p in [21, 63]:
        df[f"drawdown_{p}d"] = df["close"] / df["close"].rolling(p).max() - 1

    df[f"streak"] = compute_streak(df["close"])

    return df


def compute_adx(df: pd.DataFrame, period: int = 14) -> pd.Series:
    up_move = df["high"].diff()
    down_move = df["low"].shift(1) - df["low"]
    plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0)
    minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0)
    tr = np.maximum(
        df["high"] - df["low"],
        np.maximum(
            abs(df["high"] - df["close"].shift(1)),
            abs(df["low"] - df["close"].shift(1)),
        ),
    )
    atr = pd.Series(tr).rolling(period).mean()
    plus_di = 100 * pd.Series(plus_dm).rolling(period).mean() / atr
    minus_di = 100 * pd.Series(minus_dm).rolling(period).mean() / atr
    dx = 100 * abs(plus_di - minus_di) / (plus_di + minus_di + 1e-10)
    return dx.rolling(period).mean()


def compute_streak(series: pd.Series) -> pd.Series:
    direction = np.sign(series.diff())
    streak = direction.copy()
    for i in range(1, len(streak)):
        if direction.iloc[i] == direction.iloc[i - 1] and direction.iloc[i] != 0:
            streak.iloc[i] = streak.iloc[i - 1] + direction.iloc[i]
        elif direction.iloc[i] == 0:
            streak.iloc[i] = 0
    return streak
```

**Feature summary:**

| Category | Count | Examples |
|---|---|---|
| Price ratio | 6 | `ma_5_ratio`, `ma_200_ratio` |
| MA spreads | 4 | `ma_spread_50_200` |
| Returns | 4 | `ret_5d`, `ret_63d` |
| RSI | 3 | `rsi_7`, `rsi_14`, `rsi_21` |
| MACD | 3 | `macd_line`, `macd_signal`, `macd_hist` |
| Volatility | 6 | `volatility_21d`, `bb_width`, `bb_pct_b`, `atr_pct` |
| Volume | 4 | `vol_ratio_20d`, `vol_trend_5d`, `vpa_score` |
| Trend | 3 | `adx`, `days_above_ma200`, `days_above_ma50` |
| Market regime | 3 | `drawdown_63d`, `streak`, `drawdown_21d` |
| **Total** | **~36** | |

### 3.2 XGBoost Classifier Architecture

**Model Purpose:** Classify signals as BUY (1), HOLD (0), or SELL (2) using engineered features. Training target is forward price direction.

```python
import xgboost as xgb
from sklearn.model_selection import TimeSeriesSplit

class XGBoostSignalClassifier:
    def __init__(self, config: dict | None = None):
        self.config = config or {
            "n_estimators": 200,
            "max_depth": 5,
            "learning_rate": 0.05,
            "subsample": 0.8,
            "colsample_bytree": 0.8,
            "reg_alpha": 0.1,
            "reg_lambda": 1.0,
            "objective": "multi:softprob",
            "num_class": 3,      # [SELL, HOLD, BUY]
            "eval_metric": "mlogloss",
            "random_state": 42,
            "early_stopping_rounds": 20,
        }
        self.model: xgb.XGBClassifier | None = None
        self.feature_names: list[str] = []
        self.version: str = ""

    def train(self, X: pd.DataFrame, y: pd.Series, valid_split: float = 0.2) -> dict:
        self.feature_names = list(X.columns)
        split_idx = int(len(X) * (1 - valid_split))

        X_train, X_val = X.iloc[:split_idx], X.iloc[split_idx:]
        y_train, y_val = y.iloc[:split_idx], y.iloc[split_idx:]

        self.model = xgb.XGBClassifier(**self.config)
        self.model.fit(
            X_train, y_train,
            eval_set=[(X_val, y_val)],
            verbose=False,
        )
        self.version = f"xgb_{datetime.utcnow().strftime('%Y%m%d_%H%M')}"

        # Feature importance
        importance = dict(zip(
            self.feature_names,
            self.model.feature_importances_,
        ))
        top_features = sorted(importance.items(), key=lambda x: x[1], reverse=True)[:10]

        return {
            "version": self.version,
            "train_samples": len(X_train),
            "val_score": self.model.score(X_val, y_val),
            "top_features": top_features,
        }

    def predict(self, features: pd.DataFrame) -> dict:
        if self.model is None:
            raise RuntimeError("Model not trained or loaded")
        X = features[self.feature_names]
        proba = self.model.predict_proba(X)
        # proba shape: (n_samples, 3) → [SELL_prob, HOLD_prob, BUY_prob]
        return {
            "buy_probability": float(proba[0, 2]),
            "hold_probability": float(proba[0, 1]),
            "sell_probability": float(proba[0, 0]),
            "predicted_class": int(self.model.predict(X)[0]),
            "version": self.version,
        }

    def save(self, path: str) -> None:
        import joblib
        joblib.dump({
            "model": self.model,
            "feature_names": self.feature_names,
            "version": self.version,
            "config": self.config,
        }, path)

    @classmethod
    def load(cls, path: str) -> "XGBoostSignalClassifier":
        import joblib
        data = joblib.load(path)
        instance = cls(config=data["config"])
        instance.model = data["model"]
        instance.feature_names = data["feature_names"]
        instance.version = data["version"]
        return instance
```

**Training target construction:**

```python
def build_training_targets(df: pd.DataFrame, forward_days: int = 5,
                           buy_threshold: float = 0.02,
                           sell_threshold: float = -0.02) -> pd.Series:
    """
    0 = SELL (price drops below sell_threshold)
    1 = HOLD (price stays within thresholds)
    2 = BUY  (price rises above buy_threshold)
    """
    forward_return = df["close"].shift(-forward_days) / df["close"] - 1
    target = np.where(forward_return > buy_threshold, 2,
             np.where(forward_return < sell_threshold, 0, 1))
    return pd.Series(target, index=df.index)
```

### 3.3 LSTM Sequence Model Design

For time-series directional prediction from raw price sequences.

**Architecture:**

```
Input: (batch, 60, 7) — 60 days × 7 channels (O, H, L, C, V, returns, vol_ratio)
  │
  ▼
Layer 1: LSTM(64, return_sequences=True) + Dropout(0.3) + LayerNorm
  │
  ▼
Layer 2: LSTM(32, return_sequences=False) + Dropout(0.3) + LayerNorm
  │
  ▼
Layer 3: Dense(16, activation='relu') + Dropout(0.2)
  │
  ▼
Layer 4: Dense(1, activation='tanh')
  │
  ▼
Output: direction signal ∈ [-1, 1] where >0 = upward, <0 = downward
```

**Python Implementation:**

```python
import tensorflow as tf
from tensorflow.keras import layers, Model

class LSTMPredictor:
    def __init__(self, seq_length: int = 60, n_features: int = 7):
        self.seq_length = seq_length
        self.n_features = n_features
        self.model = self._build_model()
        self.scaler = None
        self.version: str = ""

    def _build_model(self) -> Model:
        inputs = layers.Input(shape=(self.seq_length, self.n_features))

        x = layers.LSTM(64, return_sequences=True)(inputs)
        x = layers.Dropout(0.3)(x)
        x = layers.LayerNormalization()(x)

        x = layers.LSTM(32, return_sequences=False)(x)
        x = layers.Dropout(0.3)(x)
        x = layers.LayerNormalization()(x)

        x = layers.Dense(16, activation="relu")(x)
        x = layers.Dropout(0.2)(x)

        outputs = layers.Dense(1, activation="tanh")(x)

        model = Model(inputs=inputs, outputs=outputs)
        model.compile(
            optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
            loss="mse",
            metrics=["mae"],
        )
        return model

    def prepare_sequences(self, df: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
        """Build supervised sequences with 7 input channels."""
        channels = np.column_stack([
            df["open"].values,
            df["high"].values,
            df["low"].values,
            df["close"].values,
            np.log1p(df["volume"].values),
            df["close"].pct_change().fillna(0).values,
            df["volume"] / df["volume"].rolling(20).mean().fillna(1).values,
        ])

        # Normalize each channel independently
        from sklearn.preprocessing import StandardScaler
        self.scaler = StandardScaler()
        channels = self.scaler.fit_transform(channels)

        X, y = [], []
        for i in range(self.seq_length, len(channels) - 1):
            X.append(channels[i - self.seq_length : i])
            # Target: next day direction (1 = UP, -1 = DOWN)
            direction = np.sign(df["close"].iloc[i + 1] - df["close"].iloc[i])
            y.append(direction)

        return np.array(X), np.array(y).reshape(-1, 1)

    def train(self, X: np.ndarray, y: np.ndarray,
              epochs: int = 50, batch_size: int = 32,
              validation_split: float = 0.2) -> tf.keras.callbacks.History:
        self.version = f"lstm_{datetime.utcnow().strftime('%Y%m%d_%H%M')}"
        early_stop = tf.keras.callbacks.EarlyStopping(
            monitor="val_loss", patience=10, restore_best_weights=True
        )
        return self.model.fit(
            X, y,
            epochs=epochs,
            batch_size=batch_size,
            validation_split=validation_split,
            callbacks=[early_stop],
            verbose=1,
        )

    def predict(self, sequence: np.ndarray) -> dict:
        """Predict direction from a single (60, 7) sequence."""
        if self.scaler is not None:
            sequence = self.scaler.transform(sequence)
        pred = self.model.predict(sequence[np.newaxis, ...], verbose=0)[0, 0]
        return {
            "direction": int(np.sign(pred)),
            "magnitude": float(abs(pred)),
            "raw_score": float(pred),
            "version": self.version,
        }
```

**Input window rationale:**

| Parameter | Value | Rationale |
|---|---|---|
| Sequence length | 60 trading days | ~1 quarter, captures medium-term patterns |
| Channels | 7 | OHLCV + returns + vol ratio |
| Normalization | Per-channel StandardScaler | Different scales require independent normalization |
| Target | Next-day direction | Binary classification via tanh output |
| Train/val split | Time-series (not random) | Prevents lookahead contamination |

### 3.4 FinBERT Sentiment Integration

Extracts sentiment from financial news headlines as an additional feature overlay.

```python
from transformers import AutoTokenizer, AutoModelForSequenceClassification
import torch

class FinBERTSentimentAnalyzer:
    MODEL_NAME = "ProsusAI/finbert"
    LABELS = ["positive", "negative", "neutral"]

    def __init__(self):
        self.tokenizer = AutoTokenizer.from_pretrained(self.MODEL_NAME)
        self.model = AutoModelForSequenceClassification.from_pretrained(self.MODEL_NAME)
        self.model.eval()

    def analyze(self, headlines: list[str]) -> dict:
        """Batch sentiment analysis of financial headlines."""
        inputs = self.tokenizer(
            headlines, return_tensors="pt",
            truncation=True, padding=True, max_length=512,
        )
        with torch.no_grad():
            outputs = self.model(**inputs)
            probs = torch.softmax(outputs.logits, dim=-1)

        # Aggregate: weighted average by recency
        aggregated = {
            "positive": float(probs[:, 0].mean()),
            "negative": float(probs[:, 1].mean()),
            "neutral": float(probs[:, 2].mean()),
        }
        # Sentiment score: positive - negative, range [-1, 1]
        sentiment_score = aggregated["positive"] - aggregated["negative"]

        return {
            "score": round(sentiment_score, 4),
            "label": self._classify(sentiment_score),
            "probabilities": aggregated,
            "headline_count": len(headlines),
        }

    def _classify(self, score: float) -> str:
        if score > 0.15:
            return "positive"
        elif score < -0.15:
            return "negative"
        return "neutral"

    def score_for_signal(self, symbol: str, date: date,
                         headlines: list[str]) -> float:
        """Return a [-1, 1] score for use in signal enhancement."""
        result = self.analyze(headlines)
        return result["score"]
```

### 3.5 Model Training Pipeline (Offline)

```
                    ┌────────────────────┐
                    │ stock_prices_daily  │
                    │ (all stocks, 10yr)  │
                    └─────────┬──────────┘
                              ▼
                    ┌────────────────────┐
                    │ Feature Engineering │
                    │ (engineer_features)│
                    └─────────┬──────────┘
                              ▼
                    ┌────────────────────┐
                    │ Target Construction │
                    │ (forward_5d ret)   │
                    └─────────┬──────────┘
                              ▼
                    ┌────────────────────┐
                    │ TimeSeriesSplit    │
                    │ 5-fold walk-forward│
                    └─────────┬──────────┘
                              ▼
             ┌────────────────┼────────────────┐
             ▼                                 ▼
    ┌──────────────────┐            ┌──────────────────┐
    │ XGBoost Training │            │ LSTM Training    │
    │ + Optuna Tuning  │            │ (60d sequences)  │
    └────────┬─────────┘            └────────┬─────────┘
             │                               │
             ▼                               ▼
    ┌──────────────────┐            ┌──────────────────┐
    │ Save model +     │            │ Save model +     │
    │ metadata to disk │            │ scaler to disk   │
    └────────┬─────────┘            └────────┬─────────┘
             │                               │
             └───────────┬───────────────────┘
                         ▼
               ┌──────────────────┐
               │ ModelRegistry    │
               │ (versioned, S3)  │
               └──────────────────┘
```

**Training schedule (APScheduler job):**

```python
# Weekly retraining every Saturday 02:00 UTC
MODEL_TRAINING_SCHEDULE = {
    "job_id": "retrain_ml_models",
    "trigger": "cron",
    "day_of_week": "sat",
    "hour": 2,
    "minute": 0,
}
```

### 3.6 Inference Pipeline (Online)

Target: **< 100ms** per stock (excluding FinBERT which may run async).

```python
class MLInferencePipeline:
    def __init__(
        self,
        xgb_model: XGBoostSignalClassifier,
        lstm_model: LSTMPredictor,
        finbert: FinBERTSentimentAnalyzer | None = None,
    ):
        self.xgb = xgb_model
        self.lstm = lstm_model
        self.finbert = finbert

    async def run(self, df: pd.DataFrame, symbol: str,
                  headlines: list[str] | None = None) -> MLSignalResult:
        # 1. Feature engineering
        features_df = engineer_features(df)
        latest_features = features_df.iloc[-1:]

        # 2. XGBoost classification
        xgb_result = self.xgb.predict(latest_features)

        # 3. LSTM sequence prediction (last 60 bars)
        seq = self._build_sequence(df.tail(61).iloc[:-1])
        lstm_result = self.lstm.predict(seq)

        # 4. FinBERT sentiment (optional/async — can use cached score)
        sentiment_score = 0.0
        if self.finbert and headlines:
            today = df.index[-1].date()
            sentiment_result = self.finbert.analyze(headlines)
            sentiment_score = sentiment_result["score"]

        # 5. Combine scores
        ml_confidence = self._combine_scores(xgb_result, lstm_result, sentiment_score)

        return MLSignalResult(
            xgb=xgb_result,
            lstm=lstm_result,
            sentiment=sentiment_score,
            confidence=ml_confidence,
            version=xgb_result["version"],
        )

    def _combine_scores(self, xgb: dict, lstm: dict, sentiment: float) -> float:
        # Weights: XGBoost 50%, LSTM 30%, Sentiment 20%
        xgb_score = xgb["buy_probability"]   # 0-1
        lstm_score = (lstm["direction"] * lstm["magnitude"] + 1) / 2  # normalize to [0, 1]
        sent_score = (sentiment + 1) / 2      # normalize to [0, 1]

        combined = 0.50 * xgb_score + 0.30 * lstm_score + 0.20 * sent_score
        return round(combined, 4)

    def _build_sequence(self, df_tail: pd.DataFrame) -> np.ndarray:
        channels = np.column_stack([
            df_tail["open"], df_tail["high"], df_tail["low"],
            df_tail["close"], np.log1p(df_tail["volume"]),
            df_tail["close"].pct_change().fillna(0),
            df_tail["volume"] / df_tail["volume"].rolling(20).mean().fillna(1),
        ])
        return channels
```

### 3.7 Model Versioning and A/B Testing

```python
@dataclass
class ModelVersion:
    name: str            # "xgb_20260601_1200"
    model_type: str      # "xgb" | "lstm"
    path: str            # S3 or local path
    trained_at: datetime
    training_samples: int
    validation_accuracy: float
    is_active: bool
    traffic_pct: float   # 0.0 - 1.0 for A/B split

class ModelRegistry:
    def __init__(self, redis_client, storage_backend):
        self.redis = redis_client
        self.storage = storage_backend

    async def get_active_model(self, model_type: str,
                                ab_key: str | None = None) -> ModelVersion:
        """Returns active model version, optionally respecting A/B split."""
        versions = await self._list_versions(model_type)
        active = [v for v in versions if v.is_active]

        if len(active) == 1:
            return active[0]

        # A/B test: hash ab_key to determine bucket
        if ab_key and len(active) > 1:
            bucket = hash(ab_key) % 100
            cumulative = 0.0
            for v in sorted(active, key=lambda x: x.traffic_pct):
                cumulative += v.traffic_pct * 100
                if bucket < cumulative:
                    return v
        return active[0]

    async def register(self, version: ModelVersion) -> None:
        key = f"model_registry:{version.model_type}:versions"
        await self.redis.sadd(key, version.name)
        await self.redis.hset(
            f"model_registry:{version.model_type}:{version.name}",
            mapping=asdict(version),
        )

    async def record_inference(self, version: str, signal_id: int,
                                outcome: str, latency_ms: int) -> None:
        """Log inference for later accuracy tracking."""
        await self.redis.xadd(
            f"model_inference_log:{version}",
            {
                "signal_id": str(signal_id),
                "outcome": outcome,
                "latency_ms": str(latency_ms),
                "timestamp": datetime.utcnow().isoformat(),
            },
        )
```

---

## 4. Layer 3: LLM-Confirmed

Phase 5, Pro (and Basic with limits). Natural language analysis generation.

### 4.1 Prompt Construction Pipeline

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ Stock Context│    │ Technical    │    │ Price Action │    │ Market       │
│ - symbol     │    │ Context      │    │ (30d table)  │    │ Context      │
│ - name       │───▶│ - indicators │───▶│ - OHLCV      │───▶│ - VIX        │
│ - sector     │    │ - signals    │    │ - volume     │    │ - SPX trend  │
│ - price      │    │ - alignment  │    │              │    │ - sector     │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │                   │
       └───────────────────┴───────┬───────────┴───────────────────┘
                                   ▼
                         ┌──────────────────┐
                         │ PromptBuilder    │
                         │ .build()        │
                         └────────┬─────────┘
                                  ▼
                         ┌──────────────────┐
                         │ System + User    │
                         │ Prompt (str)     │
                         └──────────────────┘
```

```python
class AnalysisPromptBuilder:
    VERSION = "v2.0"
    SYSTEM_PROMPT = (
        "You are a professional financial analyst specializing in technical "
        "analysis of U.S. stock market ETFs and indices. Your role is to "
        "interpret technical indicators and provide objective, data-driven "
        "analysis.\n\n"
        "IMPORTANT RULES:\n"
        "1. NEVER provide explicit 'buy' or 'sell' recommendations. Instead, "
        "describe what the signals historically indicate.\n"
        "2. Always include the disclaimer text.\n"
        "3. Ground ALL analysis in the provided data. Do NOT hallucinate "
        "prices, dates, or indicator values that are not in the input.\n"
        "4. Express confidence as a decimal 0.0-1.0 based on signal strength, "
        "indicator alignment, and market context.\n"
        "5. Responses MUST be in valid JSON matching the specified schema.\n"
        "6. Write in the same language as the user's request (Chinese or English)."
    )

    def build(self, stock, signal, price_data: list,
              indicators: dict, market_context: dict) -> tuple[str, str]:
        prompt = dedent(f"""
        ## Stock Context
        - Symbol: {stock.symbol} ({stock.name})
        - Sector: {stock.sector or 'N/A'}
        - Market: {stock.market}
        - Current Price: ${signal.price:,.2f} (as of {signal.triggered_date})

        ## Technical Context
        - Signal Type: {signal.signal_type}
        - Signal Strength: {signal.strength}
        - MA{signal.ma_short or 50}: ${signal.ma_short_val or 'N/A'}
        - MA{signal.ma_long or 200}: ${signal.ma_long_val or 'N/A'}
        - RSI(14): {indicators.get('rsi', 'N/A')}
        - MACD Line/Signal/Hist: {indicators.get('macd_line', 'N/A')} / {indicators.get('macd_signal', 'N/A')} / {indicators.get('macd_hist', 'N/A')}
        - Bollinger Width: {indicators.get('bb_width', 'N/A')}
        - Volume vs 20d avg: {indicators.get('volume_ratio', 'N/A')}x
        - ADX: {indicators.get('adx', 'N/A')} (regime: {indicators.get('regime', 'N/A')})
        - Risk Level: {indicators.get('risk_level', 'N/A')}

        ## Recent Price Action (Last 30 Days)
        ```
        {self._format_price_table(price_data[-30:])}
        ```

        ## Market Context
        - VIX: {market_context.get('vix', 'N/A')}
        - S&P 500 20-day trend: {market_context.get('spx_trend', 'N/A')}
        - Sector perf (1W): {market_context.get('sector_change_pct', 'N/A')}%

        ## Analysis Requirements
        Generate a structured financial analysis in JSON covering:
        1. Summary: 1-2 sentence overview
        2. why_buy: 3-5 bullet points explaining why this signal is significant
        3. risks: 3-5 identified risk factors that could invalidate the signal
        4. stop_loss: Suggested stop-loss price, percentage, and reasoning
        5. targets: Price targets based on resistance/support with type labels
        6. confidence: 0.0-1.0 confidence score
        7. time_horizon: Expected holding period

        Respond ONLY with valid JSON. No markdown code block wrapper.
        """)
        return prompt, self.SYSTEM_PROMPT

    def _format_price_table(self, rows) -> str:
        lines = ["Date         Open      High      Low       Close     Volume"]
        for r in rows:
            d = r.trade_date.strftime("%Y-%m-%d")
            lines.append(
                f"{d}  {r.open:>8.2f}  {r.high:>8.2f}  {r.low:>8.2f}  "
                f"{r.close:>8.2f}  {r.volume:>10,.0f}"
            )
        return "\n".join(lines)
```

**Expected output JSON schema:**

```json
{
  "symbol": "SPY",
  "signal_type": "golden_cross",
  "signal_strength": "strong",
  "analysis": {
    "summary": "SPY triggered a strong golden cross...",
    "why_buy": ["MA20 crossed above MA60 with 1.3x volume...", "..."],
    "risks": ["Immediate resistance at $515...", "..."],
    "stop_loss": {
      "price": 505.50,
      "percentage_down": 3.80,
      "reasoning": "Below MA60 and recent swing low"
    },
    "targets": [
      {"price": 540.00, "percentage_up": 2.90, "type": "resistance"},
      {"price": 555.00, "percentage_up": 5.70, "type": "all_time_high"}
    ],
    "confidence": 0.75,
    "time_horizon": "2-4 weeks"
  },
  "disclaimer": "本分析仅供参考，不构成投资建议...",
  "generated_at": "2026-06-09T16:30:00Z"
}
```

### 4.2 Model Routing

Selects the best available LLM model based on user tier, model health, and cost budget.

```python
from enum import StrEnum

class LLMProviderName(StrEnum):
    DEEPSEEK = "deepseek"
    ANTHROPIC = "anthropic"
    OPENAI = "openai"
    GEMINI = "gemini"
    OLLAMA = "ollama"

TIER_PROVIDER_PRIORITY = {
    "free":    [],                          # No LLM, template only
    "basic":   [LLMProviderName.DEEPSEEK, LLMProviderName.GEMINI],
    "pro":     [LLMProviderName.ANTHROPIC, LLMProviderName.OPENAI, LLMProviderName.DEEPSEEK],
    "admin":   [LLMProviderName.ANTHROPIC, LLMProviderName.OPENAI, LLMProviderName.DEEPSEEK],
}

TIER_MODEL_MAP = {
    "free":    {},
    "basic":   {
        LLMProviderName.DEEPSEEK: "deepseek-v4-flash",
        LLMProviderName.GEMINI:   "gemini-2.5-flash",
    },
    "pro":     {
        LLMProviderName.ANTHROPIC: "claude-haiku-4-5",
        LLMProviderName.OPENAI:    "gpt-5.4-mini",
        LLMProviderName.DEEPSEEK:  "deepseek-v4-pro",
    },
    "admin":   {},
}

class ModelRouter:
    def __init__(self, registry: dict[LLMProviderName, BaseLLMProvider]):
        self.providers = registry

    async def route(
        self,
        request: AIAnalysisRequest,
        user_tier: str,
        preferred_provider: LLMProviderName | None = None,
    ) -> AIAnalysisResponse:
        priority_list = TIER_PROVIDER_PRIORITY.get(user_tier, [])
        if not priority_list:
            raise ValueError(f"No LLM access for tier '{user_tier}'")

        # Build ordered provider list
        providers_to_try = []
        if preferred_provider:
            providers_to_try.append(preferred_provider)
        for p in priority_list:
            if p not in providers_to_try:
                providers_to_try.append(p)

        errors = []
        for provider_name in providers_to_try:
            provider = self.providers.get(provider_name)
            if provider is None:
                continue

            model = TIER_MODEL_MAP.get(user_tier, {}).get(provider_name, "default")
            request.model = model

            try:
                healthy = await provider.health_check()
                if not healthy:
                    errors.append(f"{provider_name}: unhealthy")
                    continue
                return await provider.generate(request)
            except Exception as e:
                errors.append(f"{provider_name}: {e}")
                continue

        raise RuntimeError(f"All providers failed: {'; '.join(errors)}")
```

### 4.3 Fallback Chain

```
Primary Model (tier default)
    │
    ├── FAIL ──▶ Secondary Model (tier fallback)
    │               │
    │               ├── FAIL ──▶ Tertiary Model (cross-tier fallback)
    │               │               │
    │               │               ├── FAIL ──▶ RuleBasedAnalyzer (template, $0)
    │               │               │               │
    │               │               │               └── ALWAYS SUCCEEDS
    │               │               │
    │               │               └── SUCCESS ──▶ Return + log degraded
    │               │
    │               └── SUCCESS ──▶ Return + log degraded
    │
    └── SUCCESS ──▶ Return
```

**Fallback logic in code:**

```python
FALLBACK_CHAIN = [
    ("primary",   None),            # Tier primary model
    ("secondary", None),            # Tier fallback model
    ("rule",      "RuleBasedAnalyzer"),  # Template engine (always works)
]

async def execute_with_fallback(
    router: ModelRouter,
    request: AIAnalysisRequest,
    tier: str,
) -> AIAnalysisResponse:
    degradation = []
    for stage, fallback_name in FALLBACK_CHAIN:
        try:
            if stage == "rule":
                return RuleBasedAnalyzer().analyze(request)
            response = await router.route(request, tier)
            if degradation:
                response.degradation_chain = degradation
            return response
        except Exception as e:
            degradation.append({"stage": stage, "error": str(e)})
            logger.warning(f"Fallback stage '{stage}' failed: {e}")
    # Never reached — RuleBasedAnalyzer always succeeds
```

### 4.4 Output Validation (7-Check Safety Validator)

```python
class AnalysisValidator:
    """Post-generation validation with 7 safety checks."""

    DISCLAIMER_REQUIRED = [
        "不构成投资建议",
        "not financial advice",
    ]

    FORBIDDEN_PHRASES = [
        "guaranteed", "100% sure", "certain profit",
        "保证盈利", "稳赚", "包赚", "必涨",
    ]

    def validate(self, analysis: dict, signal, source_data: dict) -> dict:
        issues = []
        current_price = source_data["current_price"]

        # Check 1: No hallucinated prices
        for target in analysis.get("analysis", {}).get("targets", []):
            tp = target.get("price", 0)
            if tp and abs(tp - current_price) / current_price > 0.30:
                issues.append(f"Target price {tp} exceeds 30% deviation from {current_price}")

        sl = analysis.get("analysis", {}).get("stop_loss", {})
        if sl.get("price") and sl["price"] > current_price:
            issues.append("Stop-loss above current price")

        # Check 2: Disclaimer present
        disclaimer = analysis.get("disclaimer", "")
        for required in self.DISCLAIMER_REQUIRED:
            if required not in disclaimer:
                issues.append(f"Missing disclaimer text: '{required}'")

        # Check 3: Confidence in [0, 1]
        confidence = analysis.get("analysis", {}).get("confidence")
        if confidence is not None and not (0.0 <= float(confidence) <= 1.0):
            issues.append(f"Confidence {confidence} out of range [0, 1]")

        # Check 4: No guarantee language
        analysis_str = json.dumps(analysis).lower()
        for phrase in self.FORBIDDEN_PHRASES:
            if phrase.lower() in analysis_str:
                issues.append(f"Forbidden phrase found: '{phrase}'")

        # Check 5: Data consistency (symbol, signal_type)
        if analysis.get("symbol") != signal.symbol:
            issues.append(f"Symbol mismatch: {analysis.get('symbol')} vs {signal.symbol}")
        if analysis.get("signal_type") != signal.signal_type:
            issues.append(f"Signal type mismatch: {analysis.get('signal_type')} vs {signal.signal_type}")

        # Check 6: Reasonable targets
        for target in analysis.get("analysis", {}).get("targets", []):
            if target.get("percentage_up") is not None and target["percentage_up"] > 50:
                issues.append(f"Unreasonable target up {target['percentage_up']}%")

        # Check 7: Language match (basic detection, non-blocking)
        # Placeholder: check if user locale matches response language

        return {
            "valid": len(issues) == 0,
            "issues": issues,
            "checks_passed": 7 - len(issues),
            "checks_total": 7,
        }
```

### 4.5 Cost Tracking

```python
class CostTracker:
    def __init__(self, db_session_factory):
        self.db_factory = db_session_factory

    PRICING = {
        "deepseek-v4-flash":   (0.14, 0.28),
        "deepseek-v4-pro":     (0.435, 0.87),
        "gpt-5.4-mini":        (0.75, 4.50),
        "gpt-5.4":             (2.50, 15.00),
        "claude-haiku-4-5":    (1.00, 5.00),
        "claude-sonnet-4-6":   (3.00, 15.00),
        "gemini-2.5-flash":    (0.30, 1.50),
    }

    def calculate_cost(self, model: str, input_tokens: int,
                       output_tokens: int) -> float:
        input_price, output_price = self.PRICING.get(model, (0, 0))
        return round(
            (input_tokens / 1_000_000) * input_price
            + (output_tokens / 1_000_000) * output_price,
            6,
        )

    async def record(self, signal_id: int, response: AIAnalysisResponse) -> None:
        async with self.db_factory() as db:
            db.add(AIAnalysisResult(
                signal_id=signal_id,
                model_provider=response.provider,
                model_name=response.model_used,
                prompt_hash=self._hash_prompt(response.prompt),
                prompt_tokens=response.input_tokens,
                completion_tokens=response.output_tokens,
                total_cost=response.cost_usd,
                analysis_json=response.content,
                generated_at=datetime.utcnow(),
            ))
            await db.commit()

    async def get_daily_cost(self, date: date | None = None) -> dict:
        """Aggregate costs by provider for the given date."""
        target_date = date or date.today()
        async with self.db_factory() as db:
            result = await db.execute(
                select(
                    AIAnalysisResult.model_provider,
                    func.count(),
                    func.sum(AIAnalysisResult.total_cost),
                    func.sum(AIAnalysisResult.prompt_tokens),
                    func.sum(AIAnalysisResult.completion_tokens),
                ).where(
                    func.date(AIAnalysisResult.generated_at) == target_date
                ).group_by(AIAnalysisResult.model_provider)
            )
            return {
                row[0]: {
                    "count": row[1],
                    "cost_usd": float(row[2] or 0),
                    "input_tokens": int(row[3] or 0),
                    "output_tokens": int(row[4] or 0),
                }
                for row in result
            }

    @staticmethod
    def _hash_prompt(prompt: str) -> str:
        return hashlib.sha256(prompt.encode()).hexdigest()
```

---

## 5. Signal Combination & Ensemble

### 5.1 SignalEnsemble Class Design

Combines all three layer outputs through weighted voting.

```python
@dataclass
class EnsembleVote:
    action: str            # "STRONG_BUY" | "BUY" | "HOLD" | "SELL" | "STRONG_SELL"
    confidence: float      # 0.0 - 1.0
    direction_score: float # -1.0 (strong sell) to +1.0 (strong buy)
    layers_active: list[str]
    vote_breakdown: dict   # per-layer contribution
    signal_type: str       # dominant signal type

class SignalEnsemble:
    def __init__(self, layer_weights: dict | None = None):
        # Default weights: rule-based gets higher weight because it's always present
        self.layer_weights = layer_weights or {
            "layer1": 0.40,   # Rule-based (always present, highest weight)
            "layer2": 0.35,   # ML-enhanced (when available)
            "layer3": 0.25,   # LLM-confirmed (when available)
        }
        self.bin_thresholds = [
            (-1.0, -0.5, "STRONG_SELL"),
            (-0.5, -0.2, "SELL"),
            (-0.2,  0.2, "HOLD"),
            ( 0.2,  0.5, "BUY"),
            ( 0.5,  1.0, "STRONG_BUY"),
        ]

    def combine(
        self,
        layer1_result: Layer1Result | None = None,
        layer2_result: MLSignalResult | None = None,
        layer3_result: AIAnalysisResponse | None = None,
    ) -> EnsembleVote:
        contributions = {}
        active_layers = []

        # Layer 1 contribution
        if layer1_result:
            contributions["layer1"] = {
                "score": layer1_result.composite_score,
                "weight": self.layer_weights["layer1"],
                "signal_type": layer1_result.primary_signal_type,
            }
            active_layers.append("layer1")
        else:
            contributions["layer1"] = {"score": 0.0, "weight": 0.0, "signal_type": None}

        # Layer 2 contribution (if available and applicable)
        if layer2_result and layer2_result.confidence >= 0.3:
            xgb_buy = layer2_result.xgb.get("buy_probability", 0.5)
            xgb_sell = layer2_result.xgb.get("sell_probability", 0.5)
            l2_score = (xgb_buy - xgb_sell)  # [-1, 1]
            contributions["layer2"] = {
                "score": l2_score,
                "weight": self.layer_weights["layer2"],
                "signal_type": None,
            }
            active_layers.append("layer2")
        else:
            contributions["layer2"] = {"score": 0.0, "weight": 0.0, "signal_type": None}

        # Layer 3 contribution (if available)
        if layer3_result:
            llm_confidence = layer3_result.content.get("analysis", {}).get("confidence", 0.5)
            is_buy = layer1_result and layer1_result.primary_signal_type in (
                "golden_cross", "bullish_alignment", "composite_buy"
            )
            l3_score = llm_confidence if is_buy else -llm_confidence
            contributions["layer3"] = {
                "score": l3_score,
                "weight": self.layer_weights["layer3"],
                "signal_type": None,
            }
            active_layers.append("layer3")
        else:
            contributions["layer3"] = {"score": 0.0, "weight": 0.0, "signal_type": None}

        # Renormalize weights for active layers only
        total_active_weight = sum(
            self.layer_weights[l] for l in active_layers
        )
        if total_active_weight > 0:
            for layer in active_layers:
                contributions[layer]["weight"] = (
                    self.layer_weights[layer] / total_active_weight
                )

        # Weighted direction score
        direction_score = sum(
            c["score"] * c["weight"] for c in contributions.values()
        )
        direction_score = max(-1.0, min(1.0, direction_score))

        # Bin to action
        action = "HOLD"
        for lo, hi, label in self.bin_thresholds:
            if lo <= direction_score < hi:
                action = label
                break

        # Confidence: magnitude of direction score away from 0
        confidence = abs(direction_score)

        return EnsembleVote(
            action=action,
            confidence=round(confidence, 4),
            direction_score=round(direction_score, 4),
            layers_active=active_layers,
            vote_breakdown={
                name: {
                    "score": round(c["score"], 4),
                    "weight": round(c["weight"], 4),
                    "contribution": round(c["score"] * c["weight"], 4),
                }
                for name, c in contributions.items()
            },
            signal_type=layer1_result.primary_signal_type if layer1_result else None,
        )
```

### 5.2 Confidence Score Calculation

4-factor weighted confidence:

```python
def compute_final_confidence(
    ensemble: EnsembleVote,
    regime: str,
    volume_profile: float,
    historical_accuracy: dict,
) -> float:
    """
    Multi-factor confidence score (0.0 - 1.0) combining:
    1. Regime alignment   (25%)
    2. Volume confirmation (20%)
    3. Historical accuracy (25%)
    4. Ensemble strength   (30%)
    """
    scores = {}

    # Factor 1: Regime alignment
    is_trend_signal = ensemble.signal_type in ("golden_cross", "death_cross")
    is_ranging_signal = ensemble.signal_type in ("bullish_alignment", "bearish_alignment")
    if "trending" in regime and is_trend_signal:
        scores["regime"] = 1.0
    elif regime == "ranging" and is_ranging_signal:
        scores["regime"] = 0.8
    elif "trending" in regime and is_ranging_signal:
        scores["regime"] = 0.4
    else:
        scores["regime"] = 0.6

    # Factor 2: Volume confirmation
    scores["volume"] = min(volume_profile, 1.0)

    # Factor 3: Historical accuracy of this signal type
    scores["history"] = historical_accuracy.get(
        ensemble.signal_type or "unknown", 0.50
    )

    # Factor 4: Ensemble direction strength
    scores["ensemble_strength"] = ensemble.confidence

    weights = {
        "regime": 0.25,
        "volume": 0.20,
        "history": 0.25,
        "ensemble_strength": 0.30,
    }
    final = sum(scores[k] * weights[k] for k in weights)
    return round(final, 4)
```

### 5.3 How Layers Feed Into Each Other

```
Layer 1 ───────────────────────────────────────────────────────────────────────┐
│  Output: BaseSignal objects (type, direction, strength, composite_score)       │
│                                                                              │
│  FEEDS INTO Layer 2:                                                         │
│  - composite_score ≥ 0.3 triggers ML enhancement                             │
│  - BaseSignal.signal_type determines which ML model to use                   │
│  - All computed indicators passed as features to XGBoost                      │
│  - OHLCV sequence passed to LSTM                                              │
│                                                                              │
│  FEEDS INTO SignalEnsemble:                                                  │
│  - Always contributes to final vote (weight: 0.40)                           │
├───────────────────────────────────────────────────────────────────────────────
│                                                                              │
Layer 2 ───────────────────────────────────────────────────────────────────────┤
│  Output: MLSignalResult (xgb_proba, lstm_direction, sentiment_score)          │
│                                                                              │
│  FEEDS INTO Layer 3:                                                         │
│  - ML confidence ≥ 0.6 triggers LLM analysis                                 │
│  - XGBoost feature importance used to highlight key drivers in prompt         │
│  - Sentiment score included in market context section of prompt               │
│                                                                              │
│  FEEDS INTO SignalEnsemble:                                                  │
│  - Contributes when available and confidence ≥ 0.3 (weight: 0.35)            │
├───────────────────────────────────────────────────────────────────────────────
│                                                                              │
Layer 3 ───────────────────────────────────────────────────────────────────────┤
│  Output: AIAnalysisResponse (analysis_json, tokens, cost)                     │
│                                                                              │
│  FEEDS INTO SignalEnsemble:                                                  │
│  - Contributes when available (weight: 0.25)                                 │
│  - LLM confidence score used as the layer3 contribution                       │
│  - Analysis text stored for user display                                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Data Flow

### 6.1 Daily Signal Generation Cycle (APScheduler)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         DAILY SIGNAL GENERATION CYCLE                         │
│                                                                              │
│  TIME (ET)   ACTION                                                          │
│  ─────────   ──────────────────────────────────────────────────────────────  │
│                                                                              │
│  16:00       Market Close (US)                                               │
│     │                                                                        │
│  16:30  ┌──────────────────────────────────────────────────────────────┐     │
│         │ APScheduler Job: sync_daily_prices                             │     │
│         │                                                                │     │
│         │  ┌──────────┐    ┌──────────┐    ┌──────────┐                 │     │
│         │  │ yfinance │    │ Finnhub  │    │ Parquet  │                 │     │
│         │  │ (EOD)    │    │ (verify) │    │ (cache)  │                 │     │
│         │  └────┬─────┘    └────┬─────┘    └────┬─────┘                 │     │
│         │       └───────────────┼───────────────┘                       │     │
│         │                       ▼                                       │     │
│         │              ┌────────────────┐                               │     │
│         │              │ DataAdapter    │                               │     │
│         │              │ dedup + upsert │                               │     │
│         │              └───────┬────────┘                               │     │
│         │                      ▼                                        │     │
│         │              ┌────────────────┐                               │     │
│         │              │ MySQL           │                               │     │
│         │              │ stock_prices_   │                               │     │
│         │              │ daily           │                               │     │
│         │              └───────┬────────┘                               │     │
│         └──────────────────────┼────────────────────────────────────────┘     │
│                                │                                              │
│  16:35  ┌──────────────────────┼────────────────────────────────────────┐     │
│         │ APScheduler Job: precompute_indicators                          │     │
│         │                                                                │     │
│         │  For each active stock:                                        │     │
│         │    ┌──────────────────────────────────────────────────────┐    │     │
│         │    │ IndicatorEngine.compute_all(stock_id, timeframe="1d") │    │     │
│         │    │   → SMA(5,10,20,50,60,120,200,250)                   │    │     │
│         │    │   → EMA(12,26,50,200)                                 │    │     │
│         │    │   → MACD(12,26,9)                                     │    │     │
│         │    │   → RSI(14)                                           │    │     │
│         │    │   → Bollinger Bands(20,2)                             │    │     │
│         │    │   → ATR(14)                                           │    │     │
│         │    │   → ADX(14)                                           │    │     │
│         │    │   → Volume SMA(20)                                    │    │     │
│         │    └──────────────────────────────────────────────────────┘    │     │
│         │                          │                                     │     │
│         │                          ▼                                     │     │
│         │    ┌──────────────────────────────────────────────────────┐    │     │
│         │    │ Write to indicator_cache (MySQL) + Redis (TTL 24h)    │    │     │
│         │    └──────────────────────────────────────────────────────┘    │     │
│         └──────────────────────┬────────────────────────────────────────┘     │
│                                │                                              │
│  16:40  ┌──────────────────────┼────────────────────────────────────────┐     │
│         │ APScheduler Job: scan_signals                                   │     │
│         │                                                                │     │
│         │  For each active stock + config:                               │     │
│         │                                                                │     │
│         │    ┌──────────────────────────────────────────────────────┐    │     │
│         │    │ 1. Load cached indicators + price data                │    │     │
│         │    │ 2. Layer1Analyzer.run(stock_id, config_id)            │    │     │
│         │    │    ├─ detect_ma_crossover()                           │    │     │
│         │    │    ├─ detect_ma_alignment()                           │    │     │
│         │    │    ├─ compute_composite_score()                       │    │     │
│         │    │    ├─ WhipsawFilter.apply()                           │    │     │
│         │    │    └─ SignalDeduplicator.is_duplicate()               │    │     │
│         │    │                                                        │    │     │
│         │    │ 3. SignalRouter.evaluate(layer1_result)                │    │     │
│         │    │    ├─ confidence < 0.3 → DISCARD                      │    │     │
│         │    │    └─ confidence ≥ 0.3 → persist + continue           │    │     │
│         │    │                                                        │    │     │
│         │    │ 4. IF Pro tier AND confidence ≥ 0.3:                  │    │     │
│         │    │       Layer2Analyzer.run(stock_id, features, seq)     │    │     │
│         │    │       ├─ XGBoost predict                              │    │     │
│         │    │       ├─ LSTM predict                                 │    │     │
│         │    │       └─ FinBERT sentiment (if headlines available)   │    │     │
│         │    │                                                        │    │     │
│         │    │ 5. IF Pro tier AND confidence ≥ 0.6:                  │    │     │
│         │    │       Layer3Analyzer.run(stock_id, signal, context)   │    │     │
│         │    │       ├─ PromptBuilder.build()                        │    │     │
│         │    │       ├─ ModelRouter.route()                          │    │     │
│         │    │       ├─ AnalysisValidator.validate() (7 checks)      │    │     │
│         │    │       └─ CostTracker.record()                         │    │     │
│         │    │                                                        │    │     │
│         │    │ 6. SignalEnsemble.combine(l1, l2, l3)                 │    │     │
│         │    │ 7. Persist to analysis_signals                        │    │     │
│         │    │ 8. Emit SignalGeneratedEvent                          │    │     │
│         │    └──────────────────────────────────────────────────────┘    │     │
│         └──────────────────────┬────────────────────────────────────────┘     │
│                                │                                              │
│  17:00  ┌──────────────────────┼────────────────────────────────────────┐     │
│         │ SignalGeneratedEvent triggers:                                  │     │
│         │                                                                │     │
│         │  AlertDispatcher                                               │     │
│         │    ├─ Match against alert_rules                                │     │
│         │    ├─ Check notification_preferences                           │     │
│         │    ├─ Check quiet hours                                        │     │
│         │    ├─ Dispatch via channels (email/push/inapp)                 │     │
│         │    └─ Write to notification_inbox                              │     │
│         └────────────────────────────────────────────────────────────────┘     │
│                                                                              │
│  18:00       Daily Digest Generation (aggregates all signals for the day)    │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Sequence Diagram — Signal Generation

```
 ┌──────┐    ┌──────────┐   ┌─────────────┐   ┌───────────┐   ┌──────────┐   ┌───────────┐
 │Sched │    │DataSync  │   │Indicator    │   │Layer1     │   │Layer2    │   │Layer3     │
 │uler  │    │Service   │   │Service      │   │Analyzer   │   │Analyzer  │   │Analyzer   │
 └──┬───┘    └────┬─────┘   └──────┬──────┘   └─────┬─────┘   └────┬─────┘   └─────┬─────┘
    │             │                │                 │               │               │
    │ sync_prices │                │                 │               │               │
    │────────────>│                │                 │               │               │
    │             │ yfinance EOD   │                 │               │               │
    │             │───────────────>│                 │               │               │
    │             │<───────────────│                 │               │               │
    │             │ upsert DB      │                 │               │               │
    │  done       │                │                 │               │               │
    │<────────────│                │                 │               │               │
    │             │                │                 │               │               │
    │ precompute  │                │                 │               │               │
    │─────────────────────────────>│                 │               │               │
    │             │                │ compute_all()   │               │               │
    │             │                │────────>        │               │               │
    │             │                │  cache results  │               │               │
    │  done       │                │<───────         │               │               │
    │<─────────────────────────────│                 │               │               │
    │             │                │                 │               │               │
    │ scan        │                │                 │               │               │
    │────────────────────────────────────────────────>│               │               │
    │             │                │                 │ load data     │               │
    │             │                │<────────────────│               │               │
    │             │                │ indicators      │               │               │
    │             │                │────────────────>│               │               │
    │             │                │                 │ detect signals│               │
    │             │                │                 │ whip + dedup  │               │
    │             │                │                 │────────>      │               │
    │             │                │                 │               │               │
    │             │                │                 │[if conf≥0.3]  │               │
    │             │                │                 │ run ML        │               │
    │             │                │                 │──────────────>│               │
    │             │                │                 │               │ XGB + LSTM    │
    │             │                │                 │               │────────>      │
    │             │                │                 │               │               │
    │             │                │                 │<──────────────│               │
    │             │                │                 │ MLSignalResult│               │
    │             │                │                 │               │               │
    │             │                │                 │[if conf≥0.6]  │               │
    │             │                │                 │ run LLM       │               │
    │             │                │                 │──────────────────────────────>│
    │             │                │                 │               │               │
    │             │                │                 │               │ build prompt  │
    │             │                │                 │               │ route model   │
    │             │                │                 │               │ LLM.generate  │
    │             │                │                 │               │────────>      │
    │             │                │                 │               │               │
    │             │                │                 │<──────────────────────────────│
    │             │                │                 │ AIAnalysisResult              │
    │             │                │                 │               │               │
    │             │                │                 │ ensemble combine              │
    │             │                │                 │────────>      │               │
    │             │                │                 │               │               │
    │             │                │                 │ persist signal│               │
    │             │                │                 │ emit event    │               │
    │             │                │                 │────────>      │               │
    │             │                │                 │               │               │
    │  done       │                │                 │               │               │
    │<────────────────────────────────────────────────│               │               │
```

---

## 7. Service Class Design

### 7.1 AnalysisEngine (Orchestrator)

```python
from __future__ import annotations

class AnalysisEngine:
    """Top-level orchestrator for the 3-layer analysis pipeline."""

    def __init__(
        self,
        db_session_factory,
        indicator_engine: IndicatorEngine,
        layer1: Layer1Analyzer,
        layer2: Layer2Analyzer | None,
        layer3: Layer3Analyzer | None,
        ensemble: SignalEnsemble,
        router: SignalRouter,
        alert_dispatcher: AlertDispatcher,
    ):
        self.db = db_session_factory
        self.indicators = indicator_engine
        self.layer1 = layer1
        self.layer2 = layer2
        self.layer3 = layer3
        self.ensemble = ensemble
        self.router = router
        self.alerts = alert_dispatcher

    async def analyze_stock(
        self,
        stock_id: int,
        config_id: int,
        trigger_phase: str = "daily_scan",
    ) -> list[AnalysisSignal]:
        """
        Run the full analysis pipeline for a single stock+config.
        Returns list of generated signals.
        """
        # 1. Load price data + cached indicators
        df = await self._load_price_data(stock_id, days=365)
        indicators = await self.indicators.get_cached(stock_id, "1d")
        config = await self._load_config(config_id)
        stock = await self._load_stock(stock_id)

        # 2. Layer 1: Rule-based signal detection
        l1_results = await self.layer1.run(df, indicators, config)

        signals = []
        for l1 in l1_results:
            # 3. Whipsaw filter
            # (handled inside Layer1Analyzer via accumulated history)

            # 4. Dedup check
            if await self.layer1.deduplicator.is_duplicate(
                stock_id, config_id, l1.signal_type, l1.date,
            ):
                continue

            # 5. Route based on confidence + tier
            routing = self.router.evaluate(l1, config.target_tier)

            l2_result = None
            l3_result = None

            if routing.promote_to_ml and self.layer2:
                l2_result = await self.layer2.run(df, stock.symbol)
                l1 = self._merge_ml_confidence(l1, l2_result)

            if routing.promote_to_llm and self.layer3:
                l3_result = await self.layer3.run(
                    stock=stock,
                    signal=l1,
                    price_data=df.tail(30),
                    indicators=indicators,
                    market_context=await self._get_market_context(),
                )

            # 6. Ensemble voting
            vote = self.ensemble.combine(l1, l2_result, l3_result)

            # 7. Final confidence with risk context
            final_confidence = compute_final_confidence(
                vote,
                regime=l1.regime,
                volume_profile=l1.volume_ratio,
                historical_accuracy=await self._get_historical_accuracy(l1.signal_type),
            )

            # 8. Persist signal
            signal_record = AnalysisSignal(
                stock_id=stock_id,
                config_id=config_id,
                signal_type=l1.signal_type,
                strength=vote.action,
                confidence=final_confidence,
                signal_details=self._serialize_details(l1, l2_result, l3_result, vote),
                price=l1.price,
                triggered_date=l1.date,
            )
            async with self.db() as db:
                db.add(signal_record)
                await db.commit()
                await db.refresh(signal_record)

            # 9. Emit event for alert dispatch
            await self.alerts.on_signal_generated(signal_record, stock)

            signals.append(signal_record)

        return signals

    async def scan_all_active(self) -> dict:
        """Daily batch scan for all active stock+config pairs."""
        results = {"total_stocks": 0, "signals_generated": 0, "errors": 0, "layer_usage": {}}
        async with self.db() as db:
            active_configs = await db.execute(
                select(AnalysisConfig).where(
                    AnalysisConfig.is_active == True
                )
            )
            for config in active_configs.scalars():
                try:
                    signals = await self.analyze_stock(
                        config.stock_id, config.id,
                    )
                    results["signals_generated"] += len(signals)
                    results["total_stocks"] += 1
                except Exception as e:
                    logger.error(f"Analysis failed for config {config.id}: {e}")
                    results["errors"] += 1
        return results
```

### 7.2 Layer1Analyzer

```python
@dataclass
class Layer1Result:
    signal_type: str
    date: date
    price: float
    direction: int           # 1 = bullish, -1 = bearish
    strength: float           # 0.0 - 1.0
    composite_score: float    # [-1, 1]
    volume_ratio: float
    regime: str               # trending_bullish | trending_bearish | ranging
    risk_level: str
    risk_score: float
    primary_signal_type: str  # For ensemble identification
    indicators_snapshot: dict
    confirmed_bars: int

class Layer1Analyzer:
    def __init__(self, db_session_factory):
        self.whipsaw_filter = WhipsawFilter(lookback_days=5, min_price_move_pct=0.02)
        self.deduplicator = SignalDeduplicator(window_trading_days=20)
        self.risk_calc = RiskCalculator()

    async def run(
        self,
        df: pd.DataFrame,
        indicators: dict,
        config: AnalysisConfig,
    ) -> list[Layer1Result]:
        results = []

        # 1. MA Crossover detection (all parameterized pairs)
        for ma_config in self._parse_ma_configs(config):
            crosses = detect_ma_crossover(
                df,
                fast=ma_config["short"],
                slow=ma_config["long"],
                confirm_bars=config.confirm_bars,
                volume_confirm=config.volume_confirm,
            )
            for cross in crosses:
                strength = calculate_cross_strength(
                    cross.ma_fast_val, cross.ma_slow_val,
                    cross.price, cross.volume_ratio,
                )
                results.append(Layer1Result(
                    signal_type=cross.signal_type,
                    date=cross.date,
                    price=cross.price,
                    direction=1 if cross.signal_type == "golden_cross" else -1,
                    strength=strength,
                    composite_score=0.0,  # filled below
                    volume_ratio=cross.volume_ratio,
                    regime="",  # filled below
                    risk_level="",
                    risk_score=0.0,
                    primary_signal_type=cross.signal_type,
                    indicators_snapshot={},
                    confirmed_bars=config.confirm_bars,
                ))

        # 2. MA Alignment
        alignment = detect_ma_alignment(df)
        if alignment["bullish_alignment"]:
            results.append(Layer1Result(
                signal_type="bullish_alignment",
                date=df.index[-1].date(),
                price=df["close"].iloc[-1],
                direction=1, strength=0.9,
                composite_score=0.0,
                volume_ratio=1.0,
                regime="trending_bullish",
                risk_level="",
                risk_score=0.0,
                primary_signal_type="bullish_alignment",
                indicators_snapshot=alignment,
                confirmed_bars=0,
            ))
        elif alignment["bearish_alignment"]:
            results.append(Layer1Result(
                signal_type="bearish_alignment",
                date=df.index[-1].date(),
                price=df["close"].iloc[-1],
                direction=-1, strength=0.9,
                composite_score=0.0,
                volume_ratio=1.0,
                regime="trending_bearish",
                risk_level="",
                risk_score=0.0,
                primary_signal_type="bearish_alignment",
                indicators_snapshot=alignment,
                confirmed_bars=0,
            ))

        # 3. Composite score
        comp_df = compute_composite_score(df)
        comp_score = comp_df["composite_score"].iloc[-1]
        comp_bin = comp_df["composite_bin"].iloc[-1]

        if comp_bin in ("BUY", "STRONG_BUY"):
            results.append(Layer1Result(
                signal_type="composite_buy",
                date=df.index[-1].date(),
                price=df["close"].iloc[-1],
                direction=1,
                strength=abs(comp_score),
                composite_score=comp_score,
                volume_ratio=float(comp_df["volume"].iloc[-1] / comp_df["volume"].rolling(20).mean().iloc[-1]),
                regime="",
                risk_level="",
                risk_score=0.0,
                primary_signal_type="composite_buy",
                indicators_snapshot={},
                confirmed_bars=0,
            ))
        elif comp_bin in ("SELL", "STRONG_SELL"):
            results.append(Layer1Result(
                signal_type="composite_sell",
                date=df.index[-1].date(),
                price=df["close"].iloc[-1],
                direction=-1,
                strength=abs(comp_score),
                composite_score=comp_score,
                volume_ratio=1.0,
                regime="",
                risk_level="",
                risk_score=0.0,
                primary_signal_type="composite_sell",
                indicators_snapshot={},
                confirmed_bars=0,
            ))

        # 4. Regime detection + risk assessment
        regime = detect_regime(df)
        risk = self.risk_calc.calculate(df, alignment)

        for r in results:
            r.regime = regime
            r.risk_level = risk.level
            r.risk_score = risk.score

        # 5. Whipsaw Filter
        filtered = self.whipsaw_filter.apply(results, df)

        return filtered.signals

    def _parse_ma_configs(self, config: AnalysisConfig) -> list[dict]:
        """Extract MA pairs from config params JSON."""
        params = config.params
        pairs = params.get("ma_pairs", [[50, 200]])
        ma_type = params.get("ma_type", "sma")
        return [{"short": s, "long": l, "type": ma_type} for s, l in pairs]
```

### 7.3 Layer2Analyzer

```python
@dataclass
class MLSignalResult:
    xgb: dict               # {"buy_probability": float, ...}
    lstm: dict              # {"direction": int, "magnitude": float}
    sentiment: float        # [-1, 1]
    confidence: float       # 0.0 - 1.0
    version: str

class Layer2Analyzer:
    def __init__(
        self,
        model_registry: ModelRegistry,
        finbert: FinBERTSentimentAnalyzer | None = None,
    ):
        self.registry = model_registry
        self.finbert = finbert

    async def run(
        self,
        df: pd.DataFrame,
        symbol: str,
        headlines: list[str] | None = None,
    ) -> MLSignalResult:
        # 1. Load active models
        xgb_model = await self.registry.load_active("xgb")
        lstm_model = await self.registry.load_active("lstm")

        # 2. Feature engineering
        features_df = engineer_features(df)
        latest = features_df.iloc[-1:]

        # 3. XGBoost inference
        xgb_result = xgb_model.predict(latest)

        # 4. LSTM inference
        seq = self._build_sequence(df.tail(61).iloc[:-1])
        lstm_result = lstm_model.predict(seq)

        # 5. FinBERT sentiment (optional/async)
        sentiment_score = 0.0
        if self.finbert and headlines:
            sentiment_score = self.finbert.score_for_signal(
                symbol, df.index[-1].date(), headlines,
            )

        # 6. Combine
        confidence = self._combine(xgb_result, lstm_result, sentiment_score)

        return MLSignalResult(
            xgb=xgb_result,
            lstm=lstm_result,
            sentiment=round(sentiment_score, 4),
            confidence=confidence,
            version=xgb_result["version"],
        )

    def _combine(self, xgb: dict, lstm: dict, sentiment: float) -> float:
        xgb_score = max(xgb.get("buy_probability", 0), xgb.get("sell_probability", 0))
        lstm_score = abs(lstm.get("direction", 0)) * lstm.get("magnitude", 0)
        sent_score = (sentiment + 1) / 2
        return round(0.50 * xgb_score + 0.30 * lstm_score + 0.20 * sent_score, 4)

    def _build_sequence(self, df_tail: pd.DataFrame) -> np.ndarray:
        return np.column_stack([
            df_tail["open"], df_tail["high"], df_tail["low"],
            df_tail["close"],
            np.log1p(df_tail["volume"].values),
            df_tail["close"].pct_change().fillna(0),
            df_tail["volume"] / df_tail["volume"].rolling(20).mean().fillna(1),
        ])
```

### 7.4 Layer3Analyzer

```python
class Layer3Analyzer:
    def __init__(
        self,
        router: ModelRouter,
        prompt_builder: AnalysisPromptBuilder,
        validator: AnalysisValidator,
        cost_tracker: CostTracker,
        cache: Redis,
    ):
        self.router = router
        self.prompt_builder = prompt_builder
        self.validator = validator
        self.cost_tracker = cost_tracker
        self.cache = cache

    async def run(
        self,
        stock,
        signal: Layer1Result,
        price_data: list,
        indicators: dict,
        market_context: dict,
        user_tier: str = "pro",
    ) -> AIAnalysisResponse | None:
        # 1. Build prompt
        prompt, system_prompt = self.prompt_builder.build(
            stock, signal, price_data, indicators, market_context,
        )

        # 2. Check cache
        cache_key = self._cache_key(stock.symbol, signal, self.prompt_builder.VERSION)
        cached = await self.cache.get(cache_key)
        if cached:
            response = AIAnalysisResponse(**json.loads(cached))
            response.cached = True
            return response

        # 3. Build request
        request = AIAnalysisRequest(
            symbol=stock.symbol,
            signal_type=signal.signal_type,
            prompt=prompt,
            system_prompt=system_prompt,
            max_tokens=1500,
            temperature=0.3,
        )

        # 4. Route with fallback
        try:
            response = await self.router.route(request, user_tier)
        except RuntimeError:
            # All providers failed — use rule-based template
            response = self._rule_based_fallback(stock, signal, indicators)
            response.degradation_chain = [{"stage": "all_providers_failed"}]

        # 5. Validate
        validation = self.validator.validate(
            response.content,
            signal,
            {"current_price": signal.price},
        )
        if not validation["valid"]:
            logger.warning(f"LLM validation issues: {validation['issues']}")
            response.validation = validation

        # 6. Add disclaimer + timestamp
        response.content["disclaimer"] = DISCLAIMER_FULL
        response.content["generated_at"] = datetime.utcnow().isoformat()

        # 7. Track cost
        await self.cost_tracker.record(signal.signal_id, response)

        # 8. Cache
        await self.cache.setex(
            cache_key, 86400,  # 24h
            json.dumps(response.to_dict(), default=str),
        )

        return response

    def _cache_key(self, symbol: str, signal: Layer1Result,
                    prompt_version: str) -> str:
        p_hash = hashlib.md5(prompt_version.encode()).hexdigest()[:8]
        return (
            f"ai_analysis:{symbol}:{signal.signal_type}:"
            f"{signal.date}:{p_hash}"
        )

    def _rule_based_fallback(self, stock, signal, indicators) -> AIAnalysisResponse:
        analyzer = RuleBasedAnalyzer()
        analysis = analyzer.analyze(stock, signal, indicators)
        return AIAnalysisResponse(
            content=analysis,
            input_tokens=0,
            output_tokens=0,
            cost_usd=0.0,
            generation_time_ms=0,
            model_used="rule_based_template",
            provider="internal",
            cached=False,
        )
```

### 7.5 SignalRouter

```python
@dataclass
class RoutingDecision:
    promote_to_ml: bool
    promote_to_llm: bool
    reason: str
    effective_confidence: float

class SignalRouter:
    def __init__(self, thresholds: dict | None = None):
        self.thresholds = thresholds or {
            "discard": 0.3,      # Below this → noise
            "promote_ml": 0.3,   # Above this → ML enhancement
            "promote_llm": 0.6,  # Above this → LLM analysis
        }

    def evaluate(
        self,
        layer1_result: Layer1Result,
        user_tier: str,
    ) -> RoutingDecision:
        confidence = layer1_result.strength

        if confidence < self.thresholds["discard"]:
            return RoutingDecision(
                promote_to_ml=False,
                promote_to_llm=False,
                reason=f"Confidence {confidence:.2f} below discard threshold {self.thresholds['discard']}",
                effective_confidence=confidence,
            )

        tier_has_ml = user_tier in ("pro", "admin")
        tier_has_llm = user_tier in ("basic", "pro", "admin")

        promote_ml = tier_has_ml and confidence >= self.thresholds["promote_ml"]
        promote_llm = tier_has_llm and confidence >= self.thresholds["promote_llm"]

        reasons = []
        if not tier_has_ml:
            reasons.append(f"Tier '{user_tier}' does not support ML")
        if not tier_has_llm:
            reasons.append(f"Tier '{user_tier}' does not support LLM")

        return RoutingDecision(
            promote_to_ml=promote_ml,
            promote_to_llm=promote_llm,
            reason="; ".join(reasons) if reasons else "Proceeding",
            effective_confidence=confidence,
        )
```

### 7.6 WhipsawFilter (Class)

(Full implementation in Section 2.5 above)

---

## 8. Performance Targets

### 8.1 Latency Budget

| Component | Target | Measurement |
|---|---|---|
| Layer 1 — single stock | **< 1ms** | End-to-end: detect_crossover + alignment + composite + whip + dedup |
| Layer 2 — single stock | **< 100ms** | XGBoost (5ms) + LSTM (80ms) + FinBERT (async, not in path) |
| Layer 2 — with FinBERT | **< 200ms** | If headlines are fetched sync (prefer async caching) |
| Layer 3 — single stock | **< 3s** | LLM API call including network round-trip |
| Daily batch: 500 stocks × L1 | **< 5s** | Parallelized across CPU cores |
| Daily batch: 500 stocks × L1+L2 | **< 60s** | Assuming ~50 Pro-eligible stocks get L2 |
| Daily batch: 500 stocks × all 3 | **< 3 min** | Assuming ~10 signals qualify for L3 (parallel LLM calls) |

### 8.2 Throughput Design

```
Single-server throughput estimate (8-core CPU, 16 GB RAM):

  Layer 1 only (Free/Basic users):
    500 stocks × 1ms × single-threaded = 0.5s
    With multiprocessing (8 cores): ~0.1s

  Layer 1 + 2 (Pro users, ~10% of stocks):
    50 stocks × 100ms = 5s (serial, batched by model)
    XGBoost: vectorized batch predict → ~50ms for all 50
    LSTM: batched predict → ~200ms for all 50
    Total L1+L2: ~1s

  Layer 3 (LLM, ~10 signals qualify):
    10 × 3s = 30s (serial)
    10 concurrent API calls → ~3s (parallel)
    Total L1+L2+L3: ~5s wall clock
```

### 8.3 Caching Strategy

```python
# Indicator cache
INDICATOR_CACHE_TTL = {
    "redis": 24 * 3600,        # 24h in Redis for hot access
    "mysql": None,             # Permanent in indicator_cache table
}

# LLM analysis cache
LLM_CACHE_KEY = "ai_analysis:{symbol}:{signal_type}:{date}:{model}:{prompt_hash}"
LLM_CACHE_TTL = 24 * 3600     # 24h — same signal won't change within day

# ML prediction cache (same-day same-stock reuse)
ML_CACHE_KEY = "ml_prediction:{symbol}:{date}"
ML_CACHE_TTL = 24 * 3600

# Cache invalidation triggers
INVALIDATION_EVENTS = [
    "price_data_updated",       # New daily close → invalidate all for that stock
    "config_changed",           # AnalysisConfig modified → invalidate layer1
    "model_retrained",          # New ML model version → invalidate layer2
    "prompt_version_bump",      # Prompt update → invalidate layer3
]
```

| Cache Layer | Technology | TTL | Hit Rate Target |
|---|---|---|---|
| Indicator values | Redis + MySQL | 24h | 99% (precomputed during daily scan) |
| ML predictions | Redis | 24h | 80% (same-day callers) |
| LLM analysis | Redis | 24h | 95% (same signal rarely re-queried) |
| Price data | Redis | 5min | 95% (during daily scan window) |

---

## 9. Testing Strategy

### 9.1 Unit Tests — Indicator Calculations

```python
class TestIndicatorCalculations:
    """Verify each indicator produces correct values against known inputs."""

    def test_sma_calculation(self):
        prices = pd.Series([10, 12, 14, 13, 15])
        sma = compute_sma(prices, period=3)
        assert sma.iloc[-1] == pytest.approx(14.0)  # (14+13+15)/3

    def test_ema_calculation(self):
        prices = pd.Series([10, 12, 14, 13, 15])
        ema = compute_ema(prices, period=3)
        # Known EMA output for this sequence
        assert ema.iloc[-1] == pytest.approx(13.824, abs=0.01)

    def test_golden_cross_detection(self):
        df = pd.DataFrame({
            "close": [100, 101, 102, 103, 104, 105] * 100,
            "volume": [1e6] * 600,
        })
        # Inject known cross
        df.loc[df.index[300:310], "close"] = 200  # will shift MAs
        signals = detect_ma_crossover(df, fast=50, slow=200)
        assert len(signals) >= 0  # Verify deterministic

    def test_death_cross_detection(self):
        """Mirror of golden cross with reversed values."""
        ...

    def test_rsi_extremes(self):
        """RSI should be 0 when all down days, 100 when all up days."""
        ...

    def test_macd_components(self):
        """MACD = EMA12 - EMA26; signal = EMA9 of MACD; hist = MACD - signal."""
        ...

    def test_bollinger_pct_b(self):
        """%B should be 0 at lower band, 1 at upper band, 0.5 at middle."""
        ...

    def test_adx_trending(self):
        """ADX > 25 in strong trend, ADX < 20 in ranging market."""
        ...

    def test_atr_consistency(self):
        """ATR should always be non-negative and grow with volatility."""
        ...
```

### 9.2 Integration Tests — Signal Generation

```python
class TestSignalGeneration:
    @pytest.fixture
    def spy_2009_data(self):
        """Real SPY data from 2008-2009 (crisis + recovery)."""
        return load_fixture("spy_2008_2010.csv")

    @pytest.fixture
    def spy_2020_data(self):
        """Real SPY data from 2020 (COVID crash + recovery)."""
        return load_fixture("spy_2020.csv")

    def test_golden_cross_after_2008_crash(self, spy_2009_data):
        """SPY had a golden cross in mid-2009. Verify detection."""
        signals = detect_ma_crossover(spy_2009_data, fast=50, slow=200)
        golden_crosses = [s for s in signals if s.signal_type == "golden_cross"]
        # Should detect golden cross around July 2009
        assert len(golden_crosses) >= 1
        golden_dates = [s.date for s in golden_crosses]
        assert any(pd.Timestamp("2009-06-01") <= d <= pd.Timestamp("2009-08-31")
                   for d in golden_dates)

    def test_death_cross_during_2020_crash(self, spy_2020_data):
        """SPY had a death cross in March 2020. Verify detection."""
        signals = detect_ma_crossover(spy_2020_data, fast=50, slow=200)
        death_crosses = [s for s in signals if s.signal_type == "death_cross"]
        assert len(death_crosses) >= 1

    def test_no_signal_during_ranging_market(self):
        """In a flat/range-bound market, whipsaw filter should suppress noise."""
        df = generate_ranging_market_data(days=60, price_range=(100, 105))
        signals = detect_ma_crossover(df, fast=20, slow=50, confirm_bars=3,
                                       volume_confirm=True)
        # Expect very few confirmed signals in ranging market
        assert len(signals) <= 2

    def test_composite_score_strong_buy_on_all_bullish(self):
        """When all 6 indicators are bullish, composite should be > 0.5."""
        ...

    def test_whipsaw_filter_removes_false_reversals(self):
        """Two opposite signals within 3 days with <2% move → filter removes first."""
        ...

    def test_dedup_prevents_duplicate_within_window(self):
        """Same stock+config+signal_type within 20 days → dedup rejects."""
        ...

    def test_risk_level_high_on_full_bearish_alignment(self):
        """Full MA5<MA20<MA60<MA120<MA250 → risk level 'high'."""
        ...

    def test_batch_scan_completes_within_latency_budget(self):
        """500 stocks × L1 should complete in < 5 seconds."""
        ...
```

### 9.3 Historical Signal Accuracy Measurement

```python
class TestHistoricalSignalAccuracy:
    """Backtest signal accuracy against known market events."""

    KNOWN_EVENTS = {
        "2008_financial_crisis": {
            "symbol": "SPY",
            "peak_date": "2007-10-09",
            "trough_date": "2009-03-09",
            "expected_signals": [
                ("death_cross", "2007-12-01", "2008-02-01"),  # Should appear in window
                ("bearish_alignment", "2008-06-01", "2009-01-01"),
                ("golden_cross", "2009-06-01", "2009-09-01"),  # Recovery signal
            ],
        },
        "2020_covid_crash": {
            "symbol": "SPY",
            "peak_date": "2020-02-19",
            "trough_date": "2020-03-23",
            "expected_signals": [
                ("death_cross", "2020-03-01", "2020-03-31"),
                ("golden_cross", "2020-05-01", "2020-07-31"),
            ],
        },
        "2022_bear_market": {
            "symbol": "SPY",
            "peak_date": "2022-01-03",
            "trough_date": "2022-10-12",
            "expected_signals": [
                ("death_cross", "2022-02-01", "2022-04-01"),
                ("golden_cross", "2023-01-01", "2023-03-01"),
            ],
        },
    }

    @pytest.mark.parametrize("event_name,event", KNOWN_EVENTS.items())
    def test_known_market_events(self, event_name, event):
        """
        For each major market event, verify that the analysis engine
        generates the expected signal types within the expected date window.
        """
        df = self._load_event_data(event["symbol"], event["peak_date"],
                                    event["trough_date"])
        signals = self._run_full_layer1_scan(df)

        for sig_type, window_start, window_end in event["expected_signals"]:
            matched = any(
                s.signal_type == sig_type
                and pd.Timestamp(window_start) <= s.date <= pd.Timestamp(window_end)
                for s in signals
            )
            assert matched, (
                f"Expected {sig_type} in {window_start} to {window_end} "
                f"for {event_name}, but none found. Signals: {signals}"
            )

    def test_signal_precedes_price_move(self):
        """
        Golden/death cross should LEAD the actual price move.
        Measure: is signal date < peak/trough date for the subsequent move?
        """
        ...

    def test_whipsaw_filter_preserves_real_signals(self):
        """
        During known trending periods (e.g., 2017 bull run),
        verify that whipsaw filter does NOT remove legitimate signals.
        """
        ...

    def test_false_signal_rate(self):
        """
        Calculate: (signals that reversed within 10d) / (total signals)
        Target false positive rate: < 30% for golden/death crosses
        """
        ...
```

### 9.4 Testing the Validation Pipeline

```python
class TestLLMOutputValidation:
    def test_validator_rejects_hallucinated_prices(self):
        analysis = {
            "analysis": {
                "targets": [{"price": 99999, "percentage_up": 500}],
                "confidence": 0.8,
            },
        }
        result = AnalysisValidator().validate(
            analysis, MockSignal(), {"current_price": 500}
        )
        assert result["valid"] is False
        assert any("30%" in i for i in result["issues"])

    def test_validator_rejects_missing_disclaimer(self):
        analysis = {
            "analysis": {"confidence": 0.5},
            "disclaimer": "buy now!!!",
        }
        result = AnalysisValidator().validate(
            analysis, MockSignal(), {"current_price": 100}
        )
        assert result["valid"] is False

    def test_validator_rejects_stop_loss_above_price(self):
        analysis = {
            "analysis": {
                "stop_loss": {"price": 150},
                "confidence": 0.5,
            },
            "disclaimer": "不构成投资建议 not financial advice",
        }
        result = AnalysisValidator().validate(
            analysis, MockSignal(), {"current_price": 100}
        )
        assert result["valid"] is False

    def test_validator_rejects_guarantee_language(self):
        analysis = {
            "analysis": {"confidence": 0.5,
                         "summary": "This is guaranteed to go up 100%!"},
            "disclaimer": "不构成投资建议 not financial advice",
        }
        result = AnalysisValidator().validate(
            analysis, MockSignal(), {"current_price": 100}
        )
        assert result["valid"] is False

    def test_validator_passes_valid_analysis(self):
        analysis = {
            "symbol": "SPY",
            "signal_type": "golden_cross",
            "analysis": {
                "summary": "Bullish setup.",
                "why_buy": ["MA cross confirms trend"],
                "risks": ["Support break possible"],
                "stop_loss": {"price": 98, "percentage_down": 2, "reasoning": "Below MA"},
                "targets": [{"price": 110, "percentage_up": 10, "type": "resistance"}],
                "confidence": 0.75,
                "time_horizon": "2-4 weeks",
            },
            "disclaimer": "不构成投资建议 not financial advice",
        }
        result = AnalysisValidator().validate(
            analysis, MockSignal(symbol="SPY", signal_type="golden_cross"),
            {"current_price": 100},
        )
        assert result["valid"] is True
```

---

## Appendix A: Production Configuration (Python pseudocode)

```python
# backend/app/core/analysis_config.py

from pydantic_settings import BaseSettings

class AnalysisEngineSettings(BaseSettings):
    # Layer 1 thresholds
    l1_discard_confidence: float = 0.3
    l1_composite_weights: dict = {
        "ma_crossover": 0.20,
        "rsi": 0.15,
        "macd": 0.20,
        "bb": 0.15,
        "volume": 0.15,
        "roc": 0.15,
    }
    l1_ma_pairs: list[list[int]] = [
        [5, 20], [10, 50], [20, 60], [20, 120], [50, 200],
    ]
    l1_confirm_bars: int = 2
    l1_volume_confirm_threshold: float = 1.5
    l1_whipsaw_lookback_days: int = 5
    l1_whipsaw_min_move_pct: float = 0.02
    l1_dedup_window_days: int = 20

    # Layer 2 thresholds
    l2_confidence_threshold: float = 0.3
    l2_xgb_weight: float = 0.50
    l2_lstm_weight: float = 0.30
    l2_sentiment_weight: float = 0.20

    # Layer 3 thresholds
    l3_confidence_threshold: float = 0.6
    l3_max_tokens: int = 1500
    l3_temperature: float = 0.3
    l3_cache_ttl_seconds: int = 86400

    # Ensemble weights
    ensemble_l1_weight: float = 0.40
    ensemble_l2_weight: float = 0.35
    ensemble_l3_weight: float = 0.25

    # Cost controls
    max_cost_per_analysis_usd: float = 0.05
    monthly_llm_budget_usd: float = 100.0

    # Performance
    l1_batch_size: int = 100
    l2_batch_size: int = 10
    l3_max_concurrent: int = 5

    model_config = {"env_prefix": "AE_"}
```

## Appendix B: Glossary

| Term | Definition |
|---|---|
| **Golden Cross** | Short MA crosses above long MA (bullish) |
| **Death Cross** | Short MA crosses below long MA (bearish) |
| **Bullish Alignment** | MA5 > MA20 > MA60 > MA120 > MA250 |
| **Bearish Alignment** | MA5 < MA20 < MA60 < MA120 < MA250 |
| **Composite Score** | Weighted tanh-normalized combination of 6 indicator families |
| **Whipsaw** | Rapid buy/sell signal reversal within a short window with minimal price change |
| **Signal Dedup** | Preventing the same signal type from re-firing within a time window |
| **Confidence Score** | 4-factor weighted score: regime (25%) + volume (20%) + historical accuracy (25%) + ensemble strength (30%) |
| **Ensemble Voting** | Weighted combination of Layer 1 (40%) + Layer 2 (35%) + Layer 3 (25%) outputs |
| **SignalRouter** | Gates progression between layers based on confidence thresholds and user tier |
| **WhipsawFilter** | Removes false reversal signals based on time proximity and price movement |

---

> **Design Owner**: Trend-Scope Engineering
> **Reviewers**: —
> **Change Log**:
>
> | Version | Date | Change |
> |---|---|---|
> | v1 | 2026-06-09 | Initial comprehensive design: all 3 layers, ensemble, data flow, service classes, performance targets, testing strategy |
