# 005 — AI-Driven Quantitative Analysis Methods for a Stock Analysis Engine

## 1. Traditional Quantitative Analysis Methods

### 1.1 Moving Average Crossover Strategies

The golden cross (50-day MA crosses above 200-day) and death cross (50-day crosses below 200-day) are classic trend-following signals. Implementation:

```python
import pandas as pd
import numpy as np

def ma_crossover_signals(df: pd.DataFrame,
                         fast: int = 50,
                         slow: int = 200) -> pd.DataFrame:
    df = df.copy()
    df['ma_fast'] = df['close'].rolling(fast).mean()
    df['ma_slow'] = df['close'].rolling(slow).mean()

    # Golden cross: fast crosses above slow
    df['golden_cross'] = (
        (df['ma_fast'] > df['ma_slow']) &
        (df['ma_fast'].shift(1) <= df['ma_slow'].shift(1))
    )
    # Death cross: fast crosses below slow
    df['death_cross'] = (
        (df['ma_fast'] < df['ma_slow']) &
        (df['ma_fast'].shift(1) >= df['ma_slow'].shift(1))
    )
    return df
```

**Limitations**: Lagging by nature; prone to whipsaws in ranging markets. Sensitivity tuning via EMA vs SMA and period optimization can help but not eliminate false signals.

### 1.2 Multi-Timeframe MA Alignment

Rather than reacting to a single crossover, this method checks whether MAs are stacked in a bullish or bearish hierarchy across timeframes.

```python
def ma_alignment(df: pd.DataFrame,
                 periods: tuple = (20, 50, 100, 200)) -> float:
    """
    Returns alignment score: +1 (fully bullish), -1 (fully bearish),
    or intermediate values for partial alignment.
    """
    mas = {p: df['close'].rolling(p).mean().iloc[-1] for p in periods}
    sorted_periods = sorted(periods)
    pairs = list(zip(sorted_periods, sorted_periods[1:]))

    score = 0.0
    for short, long in pairs:
        if mas[short] > mas[long]:
            score += 1
        elif mas[short] < mas[long]:
            score -= 1

    return score / len(pairs)  # Normalize to [-1, 1]
```

**Bullish alignment**: 20 > 50 > 100 > 200 (shorter MAs above longer ones).  
**Bearish alignment**: 200 > 100 > 50 > 20 (inverted).

### 1.3 Mean Reversion Strategies

Mean reversion assumes price oscillates around a fair value and will revert when extended.

#### Bollinger Bands

```python
def bollinger_band_signal(df: pd.DataFrame,
                          period: int = 20,
                          std_dev: float = 2.0) -> pd.Series:
    df = df.copy()
    df['bb_mid'] = df['close'].rolling(period).mean()
    bb_std = df['close'].rolling(period).std()
    df['bb_upper'] = df['bb_mid'] + std_dev * bb_std
    df['bb_lower'] = df['bb_mid'] - std_dev * bb_std

    # %B: position within bands (0 = lower, 0.5 = mid, 1 = upper)
    df['bb_pct_b'] = (df['close'] - df['bb_lower']) / (df['bb_upper'] - df['bb_lower'])

    # Signal: oversold below lower band, overbought above upper band
    df['bb_signal'] = 0
    df.loc[df['bb_pct_b'] < 0.05, 'bb_signal'] = 1    # Oversold — potential buy
    df.loc[df['bb_pct_b'] > 0.95, 'bb_signal'] = -1   # Overbought — potential sell
    return df['bb_signal']
```

#### RSI Extremes

```python
def rsi_signal(df: pd.DataFrame,
               period: int = 14,
               oversold: int = 30,
               overbought: int = 70) -> pd.Series:
    delta = df['close'].diff()
    gain = delta.where(delta > 0, 0.0)
    loss = (-delta).where(delta < 0, 0.0)
    avg_gain = gain.rolling(period).mean()
    avg_loss = loss.rolling(period).mean()
    rs = avg_gain / avg_loss
    df['rsi'] = 100 - (100 / (1 + rs))

    signal = pd.Series(0, index=df.index)
    signal[df['rsi'] < oversold] = 1    # Oversold — buy
    signal[df['rsi'] > overbought] = -1 # Overbought — sell
    return signal
```

**Key insight**: Mean reversion works best in ranging markets. In strong trends, RSI can stay oversold/overbought for extended periods — combine with trend filter.

### 1.4 Momentum Strategies

#### MACD

```python
def macd_signal(df: pd.DataFrame,
                fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    df = df.copy()
    df['ema_fast'] = df['close'].ewm(span=fast, adjust=False).mean()
    df['ema_slow'] = df['close'].ewm(span=slow, adjust=False).mean()
    df['macd'] = df['ema_fast'] - df['ema_slow']
    df['macd_signal'] = df['macd'].ewm(span=signal, adjust=False).mean()
    df['macd_hist'] = df['macd'] - df['macd_signal']

    # Crossover signal
    df['macd_buy'] = (df['macd'] > df['macd_signal']) & (df['macd'].shift(1) <= df['macd_signal'].shift(1))
    df['macd_sell'] = (df['macd'] < df['macd_signal']) & (df['macd'].shift(1) >= df['macd_signal'].shift(1))
    return df
```

#### Rate of Change (ROC)

```python
def roc_signal(df: pd.DataFrame, period: int = 12, threshold: float = 0.05) -> pd.Series:
    roc = df['close'].pct_change(period)
    signal = pd.Series(0, index=df.index)
    signal[roc > threshold] = 1       # Strong upward momentum
    signal[roc < -threshold] = -1     # Strong downward momentum
    return signal
```

### 1.5 Volume-Price Analysis (VPA)

Volume confirms price action. High volume on up days = institutional accumulation. High volume on down days = distribution.

```python
def vpa_score(df: pd.DataFrame, lookback: int = 20) -> pd.Series:
    df = df.copy()
    df['price_change'] = df['close'].diff()
    df['vol_ratio'] = df['volume'] / df['volume'].rolling(lookback).mean()
    df['up_vol'] = df['volume'].where(df['price_change'] > 0, 0)
    df['down_vol'] = df['volume'].where(df['price_change'] < 0, 0)

    # Force Index: price change * volume
    df['force_index'] = df['price_change'] * df['volume']

    # Accumulation/Distribution
    df['vf_score'] = (
        (df['up_vol'].rolling(lookback).sum() - df['down_vol'].rolling(lookback).sum())
        / df['volume'].rolling(lookback).sum()
    )
    return df['vf_score']  # +1 = net accumulation, -1 = net distribution
```

### 1.6 Market Regime Detection (Trending vs Ranging)

Using ADX (Average Directional Index) to distinguish trending from ranging conditions:

```python
def detect_regime(df: pd.DataFrame,
                  adx_period: int = 14,
                  adx_threshold: int = 25) -> str:
    """Classify current market regime."""
    df = df.copy()
    df['tr'] = np.maximum(
        df['high'] - df['low'],
        np.maximum(
            abs(df['high'] - df['close'].shift(1)),
            abs(df['low'] - df['close'].shift(1))
        )
    )
    df['atr'] = df['tr'].rolling(adx_period).mean()

    df['up_move'] = df['high'] - df['high'].shift(1)
    df['down_move'] = df['low'].shift(1) - df['low']
    df['plus_dm'] = np.where((df['up_move'] > df['down_move']) & (df['up_move'] > 0), df['up_move'], 0)
    df['minus_dm'] = np.where((df['down_move'] > df['up_move']) & (df['down_move'] > 0), df['down_move'], 0)

    plus_di = 100 * (df['plus_dm'].rolling(adx_period).mean() / df['atr'])
    minus_di = 100 * (df['minus_dm'].rolling(adx_period).mean() / df['atr'])
    dx = 100 * abs(plus_di - minus_di) / (plus_di + minus_di)
    df['adx'] = dx.rolling(adx_period).mean()

    current_adx = df['adx'].iloc[-1]
    if current_adx > adx_threshold:
        return 'trending_bullish' if plus_di.iloc[-1] > minus_di.iloc[-1] else 'trending_bearish'
    return 'ranging'
```

**Application**: Use trend-following strategies (MA crosses, MACD) in trending regimes; switch to mean-reversion (Bollinger Bands, RSI) in ranging regimes.

### 1.7 Sector Rotation Analysis

Track relative strength across sectors to identify rotation patterns:

```python
def sector_rotation_score(sector_returns: pd.DataFrame,
                          lookback: int = 63) -> pd.DataFrame:
    """
    sector_returns: DataFrame with columns = sector ETFs, rows = daily returns.
    Returns RS (Relative Strength) score per sector.
    """
    cum_ret = (1 + sector_returns.rolling(lookback).apply(
        lambda x: np.prod(1 + x) - 1
    ))

    # Rank sectors by relative strength
    rs_rank = cum_ret.rank(axis=1, ascending=False)
    return rs_rank
```

---

## 2. AI/ML Methods for Stock Analysis

### 2.1 LSTM/GRU for Time Series Price Prediction

```python
import numpy as np
import pandas as pd
from sklearn.preprocessing import MinMaxScaler
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import LSTM, GRU, Dense, Dropout
from tensorflow.keras.callbacks import EarlyStopping

def build_lstm_model(input_shape: tuple, units: int = 64, dropout: float = 0.2):
    model = Sequential([
        LSTM(units, return_sequences=True, input_shape=input_shape),
        Dropout(dropout),
        LSTM(units // 2, return_sequences=False),
        Dropout(dropout),
        Dense(32, activation='relu'),
        Dense(1)
    ])
    model.compile(optimizer='adam', loss='mse', metrics=['mae'])
    return model

def prepare_sequences(data: np.ndarray, seq_length: int = 60):
    X, y = [], []
    for i in range(seq_length, len(data)):
        X.append(data[i-seq_length:i])
        y.append(data[i, 0])  # Predict next close price
    return np.array(X), np.array(y)
```

**Key considerations**:
- Normalize features (MinMaxScaler) — never fit on test data.
- Use walk-forward validation, not random train/test split.
- Financial time series are non-stationary; consider differencing or log returns as targets.
- GRU often performs comparably to LSTM with fewer parameters and faster training.

### 2.2 XGBoost / LightGBM for Feature-Based Signal Prediction

Tree-based models excel at capturing non-linear interactions between technical indicators. Frame as classification (buy/sell/hold):

```python
import xgboost as xgb
import lightgbm as lgb
from sklearn.model_selection import TimeSeriesSplit

def build_feature_matrix(df: pd.DataFrame) -> pd.DataFrame:
    """Engineer features from OHLCV data."""
    df = df.copy()
    # Price features
    for p in [5, 10, 20, 50, 200]:
        df[f'ma_{p}'] = df['close'].rolling(p).mean() / df['close']
        df[f'volatility_{p}'] = df['close'].pct_change().rolling(p).std()

    # Momentum features
    for p in [5, 10, 20]:
        df[f'roc_{p}'] = df['close'].pct_change(p)
        df[f'rsi_{p}'] = compute_rsi(df['close'], p)  # Assume compute_rsi defined

    # Volume features
    df['vol_ratio_5'] = df['volume'] / df['volume'].rolling(5).mean()
    df['vol_ratio_20'] = df['volume'] / df['volume'].rolling(20).mean()

    # Target: forward return
    df['target'] = np.where(df['close'].shift(-5) > df['close'] * 1.02, 1,
                   np.where(df['close'].shift(-5) < df['close'] * 0.98, 2, 0))
    return df.dropna()

def train_xgboost_signal(X: pd.DataFrame, y: pd.Series) -> xgb.XGBClassifier:
    tscv = TimeSeriesSplit(n_splits=5)
    model = xgb.XGBClassifier(
        n_estimators=200, max_depth=5, learning_rate=0.05,
        subsample=0.8, colsample_bytree=0.8,
        objective='multi:softprob', eval_metric='mlogloss',
        random_state=42
    )
    # Walk-forward training
    for train_idx, val_idx in tscv.split(X):
        X_train, X_val = X.iloc[train_idx], X.iloc[val_idx]
        y_train, y_val = y.iloc[train_idx], y.iloc[val_idx]
        model.fit(X_train, y_train, eval_set=[(X_val, y_val)], verbose=False)
    return model
```

**LightGBM advantage**: Native handling of categorical features, faster training, leaf-wise tree growth. Use `lgb.LGBMClassifier` with similar params.

### 2.3 Transformer Models for Financial Time Series

Transformers capture long-range dependencies better than LSTMs. Three leading architectures:

| Model | Key Innovation | Best For |
|-------|---------------|----------|
| **Informer** | ProbSparse self-attention, reduces O(L²) to O(L log L) | Long sequences (1000+ steps) |
| **Autoformer** | Auto-correlation mechanism replaces self-attention | Seasonal/cyclic patterns |
| **PatchTST** | Splits series into patches, channels-independent | Multivariate forecasting |

```python
# Conceptual PatchTST-style architecture (simplified)
import torch
import torch.nn as nn

class PatchEmbedding(nn.Module):
    """Split time series into overlapping/non-overlapping patches."""
    def __init__(self, d_model: int, patch_len: int, stride: int):
        super().__init__()
        self.patch_len = patch_len
        self.stride = stride
        self.linear = nn.Linear(patch_len, d_model)

    def forward(self, x):  # x: (B, C, L)
        patches = x.unfold(-1, self.patch_len, self.stride)  # (B, C, N, P)
        patches = patches.permute(0, 2, 3, 1)                # (B, N, P, C)
        patches = patches.reshape(patches.shape[0], patches.shape[1], -1)
        return self.linear(patches)  # (B, N, d_model)
```

**Practical note**: Transformers require significant data (years of daily data or intraday). For stocks with limited history, LSTM/XGBoost are more appropriate.

### 2.4 Reinforcement Learning for Trading

FinRL provides a standardized framework. Stable-Baselines3 offers battle-tested RL algorithms:

```python
# Conceptual FinRL setup
from finrl.meta.env_stock_trading.env_stocktrading import StockTradingEnv
from stable_baselines3 import PPO, A2C, SAC

def create_trading_env(df: pd.DataFrame,
                       initial_capital: float = 10000,
                       max_shares: int = 100) -> StockTradingEnv:
    env_config = {
        "initial_amount": initial_capital,
        "transaction_cost_pct": 0.001,
        "state_space": len(df.columns) - 1,  # All columns except date
        "action_space": 3,  # -1 sell, 0 hold, 1 buy
        "tech_indicator_list": df.columns.tolist(),
        "reward_scaling": 1e-4,
        "hmax": max_shares,
    }
    return StockTradingEnv(df=df, **env_config)

def train_rl_agent(env, total_timesteps: int = 100000):
    model = PPO("MlpPolicy", env, verbose=0, learning_rate=3e-4, n_steps=2048)
    model.learn(total_timesteps=total_timesteps)
    return model
```

**Action space design**: Discrete (buy/sell/hold) vs continuous (position sizing). Discrete is simpler and more interpretable.  
**Reward function**: Sharpe ratio, Sortino ratio, or risk-adjusted returns. Avoid pure profit — it encourages excessive risk-taking.

### 2.5 Sentiment Analysis from News/Social Media

FinBERT is a BERT variant fine-tuned on financial text (SEC filings, earnings calls, analyst reports):

```python
from transformers import AutoTokenizer, AutoModelForSequenceClassification
import torch

def finbert_sentiment(texts: list[str],
                      model_name: str = "ProsusAI/finbert") -> pd.DataFrame:
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForSequenceClassification.from_pretrained(model_name)

    results = []
    for text in texts:
        inputs = tokenizer(text, return_tensors="pt",
                          max_length=512, truncation=True)
        with torch.no_grad():
            outputs = model(**inputs)
            probs = torch.softmax(outputs.logits, dim=-1).squeeze()
        results.append({
            'text': text[:100],
            'positive': probs[0].item(),
            'negative': probs[1].item(),
            'neutral': probs[2].item(),
        })
    return pd.DataFrame(results)

def aggregate_sentiment(scores: pd.DataFrame,
                        window_hours: int = 24) -> float:
    """Weighted sentiment: positive - negative, recent-weighted."""
    return (scores['positive'].mean() - scores['negative'].mean())
```

**Sources to monitor**: SEC EDGAR filings, major financial news (Reuters, Bloomberg), earnings call transcripts, Reddit (r/wallstreetbets for sentiment extremes), StockTwits.

### 2.6 Anomaly Detection for Risk Alerts

```python
from sklearn.ensemble import IsolationForest
from sklearn.svm import OneClassSVM

def detect_anomalies(df: pd.DataFrame,
                     features: list[str],
                     contamination: float = 0.01) -> pd.Series:
    """Detect anomalous market behavior for risk alerts."""
    X = df[features].dropna()
    model = IsolationForest(
        contamination=contamination,
        random_state=42,
        n_estimators=100
    )
    df['anomaly'] = model.fit_predict(X)  # -1 = anomaly, 1 = normal
    df['anomaly_score'] = model.decision_function(X)
    return df['anomaly']
```

**Features to monitor**: Price volatility spikes, volume surges, correlation breakdowns, gap opens, unusual options activity.

### 2.7 Clustering for Market Regime Classification

```python
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler

def classify_market_regimes(df: pd.DataFrame,
                            n_regimes: int = 4) -> pd.DataFrame:
    """Cluster market days into regimes (bull, bear, volatile, calm)."""
    features = df[[
        'close_pct_change', 'volume_ratio', 'atr_pct',
        'rsi_14', 'ma_spread_50_200'
    ]].dropna()
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(features)

    kmeans = KMeans(n_clusters=n_regimes, random_state=42, n_init=10)
    df.loc[features.index, 'regime'] = kmeans.fit_predict(X_scaled)

    # Label regimes by their characteristics
    for cluster in range(n_regimes):
        cluster_data = df[df['regime'] == cluster]
        avg_return = cluster_data['close_pct_change'].mean()
        avg_vol = cluster_data['atr_pct'].mean()
        print(f"Regime {cluster}: avg_return={avg_return:.4f}, avg_vol={avg_vol:.4f}")
    return df
```

**Typical clusters**: Low-vol bull, high-vol bull, low-vol bear, high-vol bear. Strategy selection depends on active regime.

### 2.8 Technical Indicators as ML Features

```python
def generate_ml_features(df: pd.DataFrame) -> pd.DataFrame:
    """Comprehensive feature generation for ML models."""
    import pandas_ta as ta

    df = df.copy()

    # Trend indicators
    df.ta.sma(length=20, append=True)
    df.ta.ema(length=50, append=True)
    df.ta.macd(append=True)
    df.ta.adx(append=True)

    # Momentum
    df.ta.rsi(length=14, append=True)
    df.ta.stoch(append=True)
    df.ta.willr(append=True)

    # Volatility
    df.ta.bbands(length=20, append=True)
    df.ta.atr(length=14, append=True)
    df.ta.kc(length=20, append=True)  # Keltner Channels

    # Volume
    df.ta.obv(append=True)
    df.ta.cmf(append=True)  # Chaikin Money Flow
    df.ta.mfi(append=True)  # Money Flow Index

    # Custom: MA spreads
    for short, long in [(5, 20), (10, 50), (20, 200)]:
        df[f'ma_spread_{short}_{long}'] = (
            df['close'].rolling(short).mean() / df['close'].rolling(long).mean() - 1
        )
    return df.dropna()
```

---

## 3. LLM Integration for Analysis

### 3.1 Using LLMs to Generate Natural Language Analysis

LLMs (GPT-4, Claude, Gemini) excel at synthesizing structured data into human-readable analysis. They can:
- Explain *why* a signal fired (contextualizing indicators)
- Identify risks specific to a position
- Compare a stock against sector/peers
- Generate trade rationale for audit trails

### 3.2 Prompt Engineering for Financial Analysis

#### Signal Analysis Prompt

```python
SIGNAL_ANALYSIS_PROMPT = """You are a quantitative analyst. Analyze why this stock triggered a buy signal.

Stock: {symbol}
Current Price: ${price}
Date: {date}

Technical Context:
- 20-day MA: ${ma_20}
- 50-day MA: ${ma_50} (above/below 20-day: {ma_alignment})
- 200-day MA: ${ma_200} (trend: {trend_direction})
- RSI(14): {rsi} ({rsi_condition})
- MACD: {macd} (histogram: {macd_hist} - {macd_direction})
- Volume: {volume_ratio}x average
- Bollinger %B: {bb_pct_b}
- ADX: {adx} (regime: {regime})

Triggered Signals:
{triggered_signals}

Recent News Sentiment (FinBERT):
{news_sentiment}

Fundamental Snapshot:
- P/E: {pe_ratio}
- EPS Growth (YoY): {eps_growth}
- Market Cap: {market_cap}

Provide:
1. TECHNICAL REASON: Explain the technical setup that triggered the signal.
2. WEAKNESSES: Identify 2-3 potential weaknesses or reasons this may be a false signal.
3. CONFIRMATION: What additional confirmation would increase conviction?
4. RISK_ASSESSMENT: Quantify risk (low/medium/high) with rationale.
5. CONFIDENCE_SCORE: 0-100 score for this signal's reliability.
"""
```

#### Risk Analysis Prompt

```python
RISK_ANALYSIS_PROMPT = """You are a risk manager. Assess the risks for this position.

Position: {symbol} ({position_type})
Entry: ${entry_price} | Current: ${current_price}
Unrealized P&L: {pnl_pct}%
Stop Loss: ${stop_loss} ({stop_distance}% from entry)
Holding Period: {holding_days} days

Market Conditions:
- Regime: {regime}
- VIX: {vix_level} ({vix_interpretation})
- Sector RS Rank: {sector_rank}/{total_sectors}
- Correlation to SPY: {spy_correlation}

Concentration Risk:
- Position Size: {position_pct}% of portfolio
- Sector Exposure: {sector_pct}% of portfolio

Identify:
1. MARKET_RISK: Beta, correlation, and systematic risk factors.
2. IDIOSYNCRATIC_RISK: Stock-specific risks (earnings, news, liquidity).
3. TAIL_RISK: Black swan scenarios and their potential impact.
4. STOP_LOSS_RATIONALE: Should stop be tightened, maintained, or widened?
5. ADJUSTMENT: Recommend any position adjustments.
"""
```

### 3.3 Structured Output with JSON Schema

Enforce structured output for downstream processing:

```python
import json
from openai import OpenAI

def analyze_signal(symbol: str, context: dict) -> dict:
    client = OpenAI()

    messages = [
        {"role": "system", "content": "You are a quantitative trading analyst. Return ONLY valid JSON matching the schema."},
        {"role": "user", "content": SIGNAL_ANALYSIS_PROMPT.format(**context)}
    ]

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=messages,
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "signal_analysis",
                "strict": True,
                "schema": {
                    "type": "object",
                    "properties": {
                        "technical_reason": {"type": "string"},
                        "weaknesses": {
                            "type": "array",
                            "items": {"type": "string"}
                        },
                        "confirmation_needed": {"type": "string"},
                        "risk_assessment": {
                            "type": "object",
                            "properties": {
                                "level": {"enum": ["low", "medium", "high"]},
                                "rationale": {"type": "string"},
                                "key_risks": {
                                    "type": "array",
                                    "items": {"type": "string"}
                                }
                            },
                            "required": ["level", "rationale", "key_risks"]
                        },
                        "confidence_score": {"type": "integer", "minimum": 0, "maximum": 100},
                        "recommended_action": {
                            "type": "object",
                            "properties": {
                                "action": {"enum": ["BUY", "SELL", "HOLD", "WAIT"]},
                                "position_size_pct": {"type": "number"},
                                "stop_loss": {"type": "number"},
                                "take_profit": {"type": "number"},
                                "time_horizon": {"enum": ["day_trade", "swing", "position", "investment"]}
                            },
                            "required": ["action", "position_size_pct", "stop_loss", "time_horizon"]
                        }
                    },
                    "required": ["technical_reason", "weaknesses", "risk_assessment",
                                 "confidence_score", "recommended_action"]
                }
            }
        },
        temperature=0.3
    )
    return json.loads(response.choices[0].message.content)
```

### 3.4 RAG: Retrieval Augmented Generation

Feed OHLCV, news, fundamentals, and filings to the LLM as context:

```python
from typing import Optional

def build_rag_context(symbol: str,
                      df_ohlcv: pd.DataFrame,
                      news_df: pd.DataFrame,
                      fundamentals: dict) -> str:
    """Construct prompt context from structured data sources."""

    # Price data summary (last 60 days)
    recent = df_ohlcv.tail(60)
    price_context = f"""
OHLCV Summary ({symbol}, last 60 days):
- Open: ${recent['open'].iloc[0]:.2f} → Close: ${recent['close'].iloc[-1]:.2f}
- Range: ${recent['low'].min():.2f} – ${recent['high'].max():.2f}
- Volatility: {recent['close'].pct_change().std() * np.sqrt(252):.2%} annualized
- Avg Volume: {recent['volume'].mean():,.0f}
- 20-day return: {recent['close'].iloc[-1] / recent['close'].iloc[-20] - 1:.2%}
"""

    # News summary
    news_context = "\nRecent News Headlines:\n"
    for _, row in news_df.head(10).iterrows():
        news_context += f"- [{row['date']}] ({row['sentiment']:.2f}) {row['headline']}\n"

    # Fundamentals
    fund_context = f"""
Fundamentals:
- P/E: {fundamentals.get('pe_ratio', 'N/A')}
- EPS (TTM): {fundamentals.get('eps', 'N/A')}
- Revenue Growth: {fundamentals.get('revenue_growth', 'N/A')}
- Debt/Equity: {fundamentals.get('debt_equity', 'N/A')}
- Free Cash Flow: {fundamentals.get('fcf', 'N/A')}
"""

    return f"{price_context}\n{news_context}\n{fund_context}"
```

**RAG pipeline flow**:
1. Query relevant data (OHLCV from DB, news from vector store, fundamentals from API).
2. Compute technical indicators and signal states.
3. Build structured prompt context.
4. Call LLM with context + task instruction.
5. Parse structured JSON response.
6. Store analysis for audit trail.

### 3.5 Cost Optimization: LLM vs Traditional Analysis

| Criterion | Traditional (Rule-Based) | LLM Analysis |
|-----------|------------------------|--------------|
| **Cost per signal** | $0.00 | $0.01–$0.05 (GPT-4o) |
| **Latency** | <1ms | 2–10s |
| **Interpretability** | Deterministic rules | Natural language + reasoning |
| **Edge cases** | Must be pre-coded | Handles novel situations |
| **False positive handling** | Fixed thresholds | Contextual reasoning |

**Recommended tiered architecture**:

```python
def tiered_analysis(signal_strength: float,
                    signal_type: str,
                    market_cap: float) -> str:
    """Route analysis to appropriate tier based on signal importance."""

    # Tier 1: Traditional only (free, fast)
    if signal_strength < 0.3:
        return "traditional_only"

    # Tier 2: ML + Traditional (compute cost only)
    if signal_strength < 0.6 or market_cap < 1e9:  # Small cap
        return "ml_enhanced"

    # Tier 3: Full LLM analysis (API cost, high value)
    return "llm_full_analysis"
```

**When to use LLM**:
- Signal strength > 60%
- Portfolio position size > 5%
- Unusual market conditions (VIX spike, earnings surprise, macro event)
- User explicitly requests natural language explanation
- Generating trade journal / audit entries

**When to skip LLM**:
- Routine scans of 100+ stocks
- Low-confidence signals (< 30%)
- Real-time intraday screening (latency budget)
- Paper trading / backtesting at scale

---

## 4. Signal Generation Architecture

### 4.1 Phase 1: Rule-Based Signals

Deterministic, fast, zero-cost. Foundation layer.

```python
from dataclasses import dataclass
from enum import Enum

class SignalType(Enum):
    GOLDEN_CROSS = "golden_cross"
    DEATH_CROSS = "death_cross"
    RSI_OVERSOLD = "rsi_oversold"
    RSI_OVERBOUGHT = "rsi_overbought"
    MACD_CROSSOVER = "macd_crossover"
    BB_SQUEEZE = "bb_squeeze"
    VOLUME_SPIKE = "volume_spike"

@dataclass
class BaseSignal:
    symbol: str
    signal_type: SignalType
    direction: int  # 1=long, -1=short, 0=neutral
    timestamp: pd.Timestamp
    price: float
    strength: float  # 0.0 to 1.0

def generate_rule_signals(df: pd.DataFrame, symbol: str) -> list[BaseSignal]:
    signals = []
    latest = df.iloc[-1]

    # Golden Cross
    if latest.get('golden_cross', False):
        signals.append(BaseSignal(
            symbol, SignalType.GOLDEN_CROSS, 1,
            df.index[-1], latest['close'],
            strength=min(1.0, abs(latest['ma_fast'] - latest['ma_slow']) / latest['close'] * 10)
        ))
    # ... additional rules ...
    return signals
```

### 4.2 Phase 2: ML-Enhanced Signals

ML models act as a filter/ranker on top of rule-based signals:

```python
class MLSignalEnhancer:
    def __init__(self, xgb_model, lstm_model, sentiment_model):
        self.xgb = xgb_model
        self.lstm = lstm_model
        self.sentiment = sentiment_model

    def enhance(self, signal: BaseSignal,
                features: np.ndarray,
                sequence: np.ndarray) -> BaseSignal:
        """Enhance signal strength using ML predictions."""
        # XGBoost probability
        xgb_prob = self.xgb.predict_proba(features.reshape(1, -1))[0, 1]

        # LSTM direction prediction
        lstm_pred = self.lstm.predict(sequence[np.newaxis, ...])[0, 0]
        lstm_direction = 1 if lstm_pred > sequence[-1, 0] else -1

        # Sentiment overlay
        sentiment_score = self.sentiment.get_current(signal.symbol)

        # Weighted combination
        enhanced_strength = (
            signal.strength * 0.3 +
            xgb_prob * 0.3 +
            (1.0 if lstm_direction == signal.direction else 0.2) * 0.2 +
            (sentiment_score + 1) / 2 * 0.2  # Normalize to [0,1]
        )
        signal.strength = min(1.0, enhanced_strength)
        return signal
```

### 4.3 Phase 3: LLM-Confirmed Signals

LLM serves as the final gate for high-value signals:

```python
def llm_confirm_signal(signal: BaseSignal, context: dict) -> dict | None:
    """LLM reviews signal and either confirms, rejects, or amends it."""
    analysis = analyze_signal(signal.symbol, context)

    # Gate: if LLM confidence < threshold, discard signal
    if analysis['confidence_score'] < 50:
        return None

    # If LLM suggests different action, override
    if analysis['recommended_action']['action'] == 'WAIT':
        signal.strength *= 0.5  # Downgrade but don't discard

    return analysis
```

### 4.4 Signal Confidence Scoring

```python
def compute_confidence(signal: BaseSignal,
                       regime: str,
                       volume_profile: float,
                       historical_accuracy: dict) -> float:
    """Multi-factor confidence score for a signal."""

    scores = {}

    # 1. Regime alignment (trend signals in trending markets)
    if signal.signal_type in (SignalType.GOLDEN_CROSS, SignalType.MACD_CROSSOVER):
        scores['regime'] = 1.0 if 'trending' in regime else 0.3
    elif signal.signal_type in (SignalType.RSI_OVERSOLD, SignalType.BB_SQUEEZE):
        scores['regime'] = 0.8 if regime == 'ranging' else 0.4

    # 2. Volume confirmation
    scores['volume'] = min(1.0, volume_profile)

    # 3. Historical accuracy of this signal type
    scores['history'] = historical_accuracy.get(signal.signal_type.value, 0.5)

    # 4. Signal strength from ML
    scores['ml_strength'] = signal.strength

    # Weighted combination
    weights = {'regime': 0.25, 'volume': 0.20, 'history': 0.25, 'ml_strength': 0.30}
    confidence = sum(scores[k] * weights[k] for k in weights)

    return round(confidence, 4)
```

### 4.5 False Signal Filtering (Whipsaw Detection)

```python
def detect_whipsaw(signals: list[BaseSignal],
                   df: pd.DataFrame,
                   lookback: int = 5) -> list[BaseSignal]:
    """Filter out whipsaw signals — rapid buy/sell reversals."""
    filtered = []
    for i, sig in enumerate(signals):
        if i == 0:
            filtered.append(sig)
            continue

        prev = signals[i - 1]
        # Check if this is a reversal within lookback days
        days_between = (sig.timestamp - prev.timestamp).days
        if days_between <= lookback and sig.direction != prev.direction:
            # Whipsaw: check if price moved meaningfully
            price_change = abs(sig.price / prev.price - 1)
            if price_change < 0.02:  # Less than 2% move
                filtered.pop()       # Remove previous signal
                filtered.append(sig) # Replace with current
                continue

        filtered.append(sig)
    return filtered
```

---

## 5. Signal Combination & Weighting

### 5.1 Composite Signal from Multiple Indicators

```python
def composite_signal(df: pd.DataFrame,
                     config: dict = None) -> pd.DataFrame:
    """
    Combine multiple indicators into a single composite signal.
    Returns a DataFrame with individual signals and composite score.
    """
    if config is None:
        config = {
            'ma_crossover': {'weight': 0.20, 'fast': 50, 'slow': 200},
            'rsi': {'weight': 0.15, 'period': 14},
            'macd': {'weight': 0.20, 'fast': 12, 'slow': 26},
            'bb': {'weight': 0.15, 'period': 20},
            'volume': {'weight': 0.15, 'lookback': 20},
            'roc': {'weight': 0.15, 'period': 10},
        }

    df = df.copy()
    composite = pd.Series(0.0, index=df.index)

    # MA Crossover: normalized spread between fast and slow MA
    if 'ma_crossover' in config:
        c = config['ma_crossover']
        fast_ma = df['close'].rolling(c['fast']).mean()
        slow_ma = df['close'].rolling(c['slow']).mean()
        df['sig_ma'] = np.tanh((fast_ma - slow_ma) / slow_ma * 100)
        composite += df['sig_ma'].fillna(0) * c['weight']

    # RSI: transform to [-1, 1] signal
    if 'rsi' in config:
        c = config['rsi']
        rsi = compute_rsi_vectorized(df['close'], c['period'])
        df['sig_rsi'] = -(rsi - 50) / 50  # Overbought = negative, oversold = positive
        composite += df['sig_rsi'].fillna(0) * c['weight']

    # MACD: normalized histogram
    if 'macd' in config:
        c = config['macd']
        ema_fast = df['close'].ewm(span=c['fast']).mean()
        ema_slow = df['close'].ewm(span=c['slow']).mean()
        macd_line = ema_fast - ema_slow
        macd_signal = macd_line.ewm(span=9).mean()
        df['sig_macd'] = np.tanh((macd_line - macd_signal) / df['close'] * 100)
        composite += df['sig_macd'].fillna(0) * c['weight']

    df['composite_signal'] = composite.clip(-1, 1)
    df['signal_action'] = pd.cut(
        df['composite_signal'],
        bins=[-1, -0.5, -0.2, 0.2, 0.5, 1],
        labels=['STRONG_SELL', 'SELL', 'HOLD', 'BUY', 'STRONG_BUY']
    )
    return df
```

### 5.2 Weighting Schemes

```python
class WeightingScheme:
    @staticmethod
    def equal(signals: dict) -> dict:
        """Equal weight across all signals."""
        n = len(signals)
        return {k: 1/n for k in signals}

    @staticmethod
    def performance_based(signals: dict,
                          historical_pnl: dict) -> dict:
        """Weight by historical P&L contribution."""
        total = sum(max(0, historical_pnl.get(k, 0)) for k in signals)
        if total == 0:
            return WeightingScheme.equal(signals)
        return {k: max(0, historical_pnl.get(k, 0)) / total for k in signals}

    @staticmethod
    def dynamic(signals: dict,
                regime: str,
                config: dict) -> dict:
        """Adjust weights based on market regime."""
        # Base weights
        weights = config.get('base_weights', WeightingScheme.equal(signals))

        # Regime-specific adjustments
        if 'trending' in regime:
            # Boost trend-following indicators
            for k in ['ma_crossover', 'macd', 'adx']:
                if k in weights:
                    weights[k] *= 1.5
            # Reduce mean-reversion
            for k in ['rsi', 'bb']:
                if k in weights:
                    weights[k] *= 0.5
        elif regime == 'ranging':
            # Reverse the adjustments
            for k in ['ma_crossover', 'macd', 'adx']:
                if k in weights:
                    weights[k] *= 0.5
            for k in ['rsi', 'bb']:
                if k in weights:
                    weights[k] *= 1.5

        # Renormalize
        total = sum(weights.values())
        return {k: v / total for k, v in weights.items()}
```

### 5.3 Ensemble Methods for Signal Voting

```python
from sklearn.ensemble import VotingClassifier

class SignalEnsemble:
    """Voting ensemble across multiple signal generation methods."""

    def __init__(self):
        self.models = {}
        self.weights = {}

    def add_model(self, name: str, model, weight: float = 1.0):
        self.models[name] = model
        self.weights[name] = weight

    def vote(self, features: np.ndarray,
             df: pd.DataFrame) -> dict:
        votes = {'BUY': 0.0, 'SELL': 0.0, 'HOLD': 0.0}

        # Rule-based vote
        rule_signals = generate_rule_signals(df, '')
        for sig in rule_signals:
            action = 'BUY' if sig.direction == 1 else 'SELL'
            votes[action] += sig.strength * self.weights.get('rule', 1.0)

        # ML model votes
        for name, model in self.models.items():
            if hasattr(model, 'predict_proba'):
                proba = model.predict_proba(features.reshape(1, -1))[0]
                for i, action in enumerate(['SELL', 'HOLD', 'BUY']):
                    if i < len(proba):
                        votes[action] += proba[i] * self.weights.get(name, 1.0)

        # Determine winning vote
        winning_action = max(votes, key=votes.get)
        total_votes = sum(votes.values())
        confidence = votes[winning_action] / total_votes if total_votes > 0 else 0.0

        return {
            'action': winning_action,
            'confidence': confidence,
            'vote_breakdown': votes
        }
```

---

## 6. Python Libraries for Quant

### 6.1 Backtesting Frameworks

| Library | Style | Strengths | Weaknesses |
|---------|-------|-----------|------------|
| **vectorbt** | Vectorized | Extremely fast, hyperparameter optimization built-in | Less flexible for complex logic |
| **bt** | Tree-structured | Intuitive algo composition, ffn integration | Smaller community |
| **zipline-reloaded** | Pipeline-based | Production-grade, Quantopian heritage | Steep learning curve, maintenance mode |
| **backtrader** | Event-driven | Most flexible, live trading support, large community | Slower on large datasets |

```python
# vectorbt example: MA crossover backtest
import vectorbt as vbt

def backtest_ma_crossover(close: pd.Series,
                          fast: int, slow: int) -> vbt.Portfolio:
    fast_ma = vbt.MA.run(close, window=fast)
    slow_ma = vbt.MA.run(close, window=slow)
    entries = fast_ma.ma_crossed_above(slow_ma)
    exits = fast_ma.ma_crossed_below(slow_ma)
    return vbt.Portfolio.from_signals(close, entries, exits)

# Hyperparameter optimization (vectorized)
fast_windows = np.arange(10, 60, 5)
slow_windows = np.arange(50, 250, 10)
results = vbt.MA.run_combs(
    close, fast_windows, slow_windows,
    short_entries=False, short_exits=False
)
```

### 6.2 Technical Analysis Libraries

| Library | Description |
|---------|-------------|
| **ta-lib** | C-based, 150+ indicators, battle-tested, fastest |
| **pandas-ta** | Pure Python, 130+ indicators, pandas-native, easy to use |
| **ta** | Simple wrapper, good for prototyping |
| **finta** | Clean API, fewer indicators |

```python
# pandas-ta usage
import pandas_ta as ta

# Chain multiple indicators
df.ta.strategy(
    ta.CommonStrategy,  # SMA, EMA, MACD, RSI, BBANDS, etc.
    append=True
)

# Individual indicator with custom params
df.ta.bbands(length=20, std=2, append=True)
df.ta.rsi(length=14, append=True)
```

### 6.3 Machine Learning

```python
# Classification (signal prediction)
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.svm import SVC
from xgboost import XGBClassifier
from lightgbm import LGBMClassifier

# Feature preprocessing
from sklearn.preprocessing import StandardScaler, RobustScaler
from sklearn.feature_selection import SelectKBest, mutual_info_classif

# Time series cross-validation
from sklearn.model_selection import TimeSeriesSplit

# Hyperparameter tuning
import optuna  # Preferred for financial ML
```

**Optuna for financial hyperparameter optimization**:
```python
import optuna

def objective(trial, X, y, tscv):
    params = {
        'n_estimators': trial.suggest_int('n_estimators', 50, 500),
        'max_depth': trial.suggest_int('max_depth', 3, 15),
        'learning_rate': trial.suggest_float('learning_rate', 0.01, 0.3, log=True),
        'subsample': trial.suggest_float('subsample', 0.5, 1.0),
        'colsample_bytree': trial.suggest_float('colsample_bytree', 0.3, 1.0),
        'reg_alpha': trial.suggest_float('reg_alpha', 1e-8, 10.0, log=True),
        'reg_lambda': trial.suggest_float('reg_lambda', 1e-8, 10.0, log=True),
    }
    model = xgb.XGBClassifier(**params, random_state=42)

    # Walk-forward CV
    scores = []
    for train_idx, val_idx in tscv.split(X):
        model.fit(X.iloc[train_idx], y.iloc[train_idx])
        scores.append(model.score(X.iloc[val_idx], y.iloc[val_idx]))

    return np.mean(scores)  # Maximize validation accuracy
```

### 6.4 LLM and NLP

```python
# FinBERT for sentiment
# pip install transformers torch
from transformers import pipeline

finbert = pipeline("text-classification",
                   model="ProsusAI/finbert",
                   return_all_scores=True)

# OpenAI / Anthropic for analysis generation
# pip install openai anthropic
from openai import OpenAI
client = OpenAI()
```

### 6.5 FinGPT / FinRL Ecosystem

```python
# FinGPT: LLM-based financial analysis
# github.com/AI4Finance-Foundation/FinGPT
# Provides:
# - Market sentiment analysis from news
# - Automated financial report analysis
# - Trading signal generation from LLM

# FinRL: Reinforcement learning for trading
# github.com/AI4Finance-Foundation/FinRL
from finrl.config import INDICATORS
from finrl.meta.preprocessor.yahoodownloader import YahooDownloader

# Download and process
df = YahooDownloader(
    start_date='2020-01-01', end_date='2024-01-01',
    ticker_list=['AAPL', 'MSFT', 'GOOGL']
).fetch_data()
```

---

## 7. Recommended Analysis Engine Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Data Ingestion Layer                    │
│  OHLCV ← Yahoo/Alpha Vantage  |  News ← NewsAPI/GDELT    │
│  Fundamentals ← FMP/Polygon   |  Social ← Reddit/Twitter │
└──────────────────────┬───────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────┐
│                  Feature Engineering                       │
│  pandas-ta indicators  |  Custom features  |  Scaling     │
└──────────────────────┬───────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────┐
│            Phase 1: Rule-Based Signal Generation          │
│  MA Crossovers | RSI/BB | MACD | VPA | ADX Regime        │
│  Output: list of BaseSignal objects with strength         │
└──────────────────────┬───────────────────────────────────┘
                       ▼
              ┌────────┴────────┐
              │  Signal Strength │
              │     < 0.3?      │
              └────────┬────────┘
                  Yes  │  No
                   ┌───┘  └───┐
                   ▼           ▼
            [Discard]   ┌──────────────────────────┐
                        │  Phase 2: ML Enhancement │
                        │  XGBoost | LSTM |        │
                        │  Sentiment Overlay       │
                        └──────────┬───────────────┘
                                   ▼
                          ┌────────┴────────┐
                          │ Signal Strength  │
                          │     > 0.6?      │
                          └────────┬────────┘
                              Yes  │  No
                           ┌───┘      └───┐
                           ▼               ▼
              ┌──────────────────┐   [Finalize with
              │ Phase 3: LLM     │    ML score]
              │ Confirmation     │
              │ (GPT-4o/Claude)  │
              └────────┬─────────┘
                       ▼
              ┌──────────────────┐
              │ Final Signal +   │
              │ Analysis Report  │
              └──────────────────┘
```

---

## 8. Implementation Roadmap

| Phase | Components | Timeline | Dependencies |
|-------|-----------|----------|-------------|
| **1. Foundation** | Data pipeline, pandas-ta, rule-based signals, regime detection | Week 1–2 | yfinance, pandas, numpy |
| **2. Backtesting** | vectorbt integration, performance metrics, walk-forward validation | Week 3–4 | vectorbt, pandas-ta |
| **3. ML Enhancement** | Feature matrix, XGBoost/LightGBM training, Optuna tuning | Week 5–7 | scikit-learn, xgboost, lightgbm, optuna |
| **4. Deep Learning** | LSTM price prediction, sentiment pipeline (FinBERT) | Week 8–10 | TensorFlow/PyTorch, transformers |
| **5. LLM Integration** | Prompt templates, JSON schema parsing, RAG pipeline, cost controls | Week 11–13 | openai/anthropic SDKs |
| **6. Production** | Signal combination, ensemble voting, confidence scoring, monitoring | Week 14–16 | FastAPI, PostgreSQL, Redis |

---

## 9. Key References

- **vectorbt**: [github.com/polakowo/vectorbt](https://github.com/polakowo/vectorbt)
- **FinRL**: [github.com/AI4Finance-Foundation/FinRL](https://github.com/AI4Finance-Foundation/FinRL)
- **FinGPT**: [github.com/AI4Finance-Foundation/FinGPT](https://github.com/AI4Finance-Foundation/FinGPT)
- **FinBERT**: [huggingface.co/ProsusAI/finbert](https://huggingface.co/ProsusAI/finbert)
- **PatchTST**: [arxiv.org/abs/2211.14730](https://arxiv.org/abs/2211.14730)
- **Informer**: [arxiv.org/abs/2012.07436](https://arxiv.org/abs/2012.07436)
- **Autoformer**: [arxiv.org/abs/2106.13008](https://arxiv.org/abs/2106.13008)
- **pandas-ta**: [github.com/twopirllc/pandas-ta](https://github.com/twopirllc/pandas-ta)
- **Stable-Baselines3**: [github.com/DLR-RM/stable-baselines3](https://github.com/DLR-RM/stable-baselines3)
- **Optuna**: [github.com/optuna/optuna](https://github.com/optuna/optuna)
