# 006 — Backtesting Systems Research

> **Scope:** Python backtesting frameworks, key metrics, realistic simulation considerations, report generation, strategy optimization methodologies, and recommended architecture for Trend-Scope.
> **Date:** 2026-06-09
> **Status:** Research Complete

---

## 1. Backtesting Framework Comparison

### 1.1 vectorbt (polakowo)

- **Type:** Vectorized (NumPy/Numba/Rust)
- **Stars:** ~7.8k | **Version:** v1.0.0 (Apr 2026) | **Status:** Actively maintained
- **License:** Apache 2.0 with Commons Clause (fair-code)

**Strengths:**
- Blazing fast — runs thousands of parameter combinations simultaneously via array broadcasting
- Optional Rust engine for precompiled speed (no JIT warm-up)
- Rich indicator ecosystem (TA-Lib, Pandas TA, custom indicator factories)
- Built-in walk-forward optimization, portfolio analytics, QuantStats integration
- Interactive Plotly/ipywidgets dashboards for strategy exploration
- Parameter sweeps with heatmap visualization (e.g., 10,000 SMA combos across 3 symbols)

**Limitations:**
- No native live trading — pure research engine
- Steep learning curve (requires vectorized thinking, no per-bar logic)
- Advanced features gated behind VectorBT PRO (commercial)
- Strategy logic must fit into entry/exit signal arrays

**Best for:** Quant researchers, multi-asset strategies, ML/factor testing, large-scale parameter sweeps

---

### 1.2 backtrader (mementum)

- **Type:** Event-driven (per-bar iteration)
- **Stars:** ~21.9k | **Version:** ~1.9.x | **Status:** Feature-complete, minimal maintenance
- **License:** GPL-3.0

**Strengths:**
- Most popular Python backtesting library by community size
- Extensive documentation + tutorials + active community forum
- 122 built-in indicators + TA-Lib support
- Live trading via Interactive Brokers, Oanda, Alpaca, Visual Chart
- Multi-timeframe / multi-data feed support
- Flexible broker simulation: Market, Limit, Stop, StopTrail, OCO orders
- Sizers for automated position sizing, schedulers, trading calendars
- Plotting via matplotlib

**Limitations:**
- No longer under active development — feature-complete but slow to fix bugs
- Pure Python loops — slow for large datasets or optimization
- No JIT/vectorization — parameter sweeps are sequential and time-consuming
- Pyfolio integration deprecated

**Best for:** Retail traders, strategy prototyping, live trading integration, education

---

### 1.3 zipline-reloaded (stefan-jansen)

- **Type:** Event-driven (Quantopian heritage)
- **Stars:** ~1.8k | **Version:** v3.1.1 (Jul 2025) | **Status:** Maintained
- **License:** Apache-2.0

**Strengths:**
- Institutional-grade pipeline API for universe selection and factor ranking
- Clean `initialize()` / `handle_data()` event-driven pattern
- Built-in risk and commission models, slippage simulation
- Cython-accelerated core for reasonable performance
- Extensive use in "Machine Learning for Algorithmic Trading" book
- Active community at exchange.ml4trading.io

**Limitations:**
- Complex setup (requires data ingestion via NASDAQ/Quandl API key)
- Slower than vectorized alternatives (per-bar Python execution)
- Primarily research-focused, minimal live trading support
- Requires pandas >= 2.2, NumPy >= 2.0 — strict dependency chain
- Pipeline API has steep learning curve

**Best for:** Equity factor investing, academic research, pipeline-based workflows

---

### 1.4 bt (pmorissette)

- **Type:** Flexible tree-based composition
- **Stars:** ~2.9k | **Version:** v1.2.0 (Apr 2026) | **Status:** Maintained (alpha)
- **License:** MIT

**Strengths:**
- Unique tree structure for composing complex, modular portfolio strategies
- Algorithm stacks — mix and match reusable Algo blocks
- Built atop ffn (financial function library) for statistics
- Each tree node has its own price index for allocation decisions
- Good for strategies that require hierarchical portfolio logic (e.g., risk parity, multi-tier allocation)

**Limitations:**
- Alpha-stage software — potential bugs, limited community
- Slower than vectorized engines (flexibility traded for performance)
- Limited built-in charting vs competitors
- Smallest community of the six compared

**Best for:** Hierarchical portfolio strategies, risk budgeting, modular strategy composition

---

### 1.5 Backtesting.py (kernc)

- **Type:** Event-driven, lightweight
- **Stars:** ~8.5k | **Version:** ~0.4.x | **Status:** Active
- **License:** AGPL-3.0

**Strengths:**
- Simplest API — Strategy class with `init()` and `next()` methods
- Blazing fast for event-driven (uses bokeh for interactive charts)
- Built-in optimizer (grid search + maximizing any stat)
- Library of composable base strategies (SMA, crossover, etc.)
- Indicator-library-agnostic (works with TA-Lib, tulipy, or custom)
- Interactive HTML plots with OHLC, equity curve, drawdown, trade markers
- Comprehensive built-in stats: Sharpe, Sortino, Calmar, SQN, Kelly Criterion

**Limitations:**
- Single-asset, single-timeframe focus
- No multi-asset portfolio simulation
- No live trading support
- Not suited for walk-forward optimization or complex parameter sweeps
- AGPL license may be restrictive for commercial use

**Best for:** Quick strategy prototyping, single-asset testing, beginners, educational use

---

### 1.6 QuantConnect / LEAN Engine

- **Type:** Event-driven, multi-asset, cloud + local
- **Stars:** ~11k (LEAN) | **Version:** Regular releases | **Status:** Very active
- **License:** Apache-2.0 (LEAN engine is open source)

**Strengths:**
- Institutional-grade: used by hedge funds and professional quants
- Cloud platform with free tier (10k backtest executions/month)
- Multi-asset: equities, options, futures, forex, crypto
- C# and Python support
- Extensive data library (free US equities, futures, forex, crypto data)
- Built-in brokerage integration (IB, Oanda, Coinbase, etc.)
- Version control, collaboration, live deployment from cloud
- Rich reporting: rolling beta, drawdown analysis, portfolio turnover, crisis analysis

**Limitations:**
- Cloud dependency for many features (local LEAN CLI is complex)
- Steep learning curve (project structure, algorithm framework)
- Cloud backtests can be slow during high demand
- Code must conform to QC algorithm framework structure
- Advanced features require paid tier

**Best for:** Professional/institutional traders, multi-asset strategies, live deployment, team collaboration

---

### 1.7 Comparison Table

| Feature | vectorbt | backtrader | zipline-reloaded | bt | Backtesting.py | QuantConnect/LEAN |
|---|---|---|---|---|---|---|
| **Backtesting Speed** | ★★★★★ (vectorized + Rust) | ★★☆☆☆ (pure Python) | ★★★☆☆ (Cython) | ★★☆☆☆ | ★★★★☆ (optimized) | ★★★☆☆ (cloud) |
| **Multi-Asset** | ★★★★★ | ★★★★☆ | ★★★★★ | ★★★★★ | ★☆☆☆☆ | ★★★★★ |
| **Multi-Timeframe** | ★★★☆☆ | ★★★★★ | ★★★★☆ | ★★☆☆☆ | ★☆☆☆☆ | ★★★★★ |
| **Learning Curve** | Steep | Moderate | Steep | Moderate | Easy | Steep |
| **Documentation** | Good | Excellent | Good | Fair | Good | Excellent |
| **Live Trading** | ✗ (PRO only) | ✓ (IB, Oanda) | ✗ | ✗ | ✗ | ✓ (many brokers) |
| **Built-in Indicators** | ★★★★★ (TA-Lib + custom) | ★★★★★ (122 built-in) | ★★★☆☆ | ★★☆☆☆ | ★★★☆☆ (agnostic) | ★★★★★ |
| **Parameter Optimization** | ★★★★★ (vectorized sweeps) | ★★★☆☆ (sequential) | ★★☆☆☆ | ★★☆☆☆ | ★★★★☆ (grid search) | ★★★★☆ (cloud) |
| **Walk-Forward Opt** | ★★★★★ | ★★☆☆☆ | ★★☆☆☆ | ★★☆☆☆ | ★☆☆☆☆ | ★★★★☆ |
| **Active Maintenance** | ★★★★★ (v1.0 in 2026) | ★☆☆☆☆ (mature/stable) | ★★★★☆ | ★★★☆☆ | ★★★★☆ | ★★★★★ |
| **Community Size** | Large | Largest (22k stars) | Medium | Small | Large (~8.5k) | Large |
| **License** | Apache 2.0 + Commons | GPL-3.0 | Apache-2.0 | MIT | AGPL-3.0 | Apache-2.0 |
| **Slippage Modeling** | ★★★☆☆ | ★★★★★ | ★★★★☆ | ★★☆☆☆ | ★★★☆☆ | ★★★★★ |
| **Commission Models** | ★★★☆☆ | ★★★★★ | ★★★★☆ | ★★★☆☆ | ★★★★☆ | ★★★★★ |
| **US Stock/ETF Data** | Yahoo Finance | CSV/Yahoo | NASDAQ/Quandl | Custom | Custom | Built-in (free) |

---

## 2. Key Backtesting Metrics

### 2.1 Return Metrics

**Total Return:**
```
Total Return = (Ending Value / Starting Value) - 1
```

**CAGR (Compound Annual Growth Rate):**
```
CAGR = (Ending Value / Starting Value)^(1/years) - 1

# Python (252 trading days/year):
cagr = (end_value / start_value) ** (252 / len(daily_returns)) - 1
```

### 2.2 Risk Metrics

**Annualized Volatility (Standard Deviation):**
```
Volatility_annual = σ_daily × √252

# Where:
σ_daily = std(daily_returns)
```

**Maximum Drawdown (MDD):**
```
drawdown_t = (cumulative_return_t / running_peak_t) - 1
MDD = min(drawdown_t) over all t

# Python:
cumulative = (1 + returns).cumprod()
running_peak = cumulative.expanding().max()
drawdown = (cumulative / running_peak) - 1
mdd = drawdown.min()
```

**Max Drawdown Duration:**
- Longest consecutive period between a peak and its full recovery
- Measured in trading days

### 2.3 Risk-Adjusted Return Ratios

**Sharpe Ratio:**
```
Sharpe = (R_annual - Rf) / σ_annual

# R_annual = mean(daily_returns) * 252
# Rf = risk-free rate (e.g., 0.04 for 4%)
# σ_annual = std(daily_returns) * sqrt(252)
```

Interpretation: `> 1.0` good, `> 2.0` excellent, `> 3.0` exceptional. Most retail strategies fall in 0.5–1.5 range.

**Sortino Ratio:**
```
Sortino = (R_annual - Rf) / σ_downside

# σ_downside = std(negative_daily_returns) * sqrt(252)
# Only penalizes downside volatility — positive volatility is ignored
```

Interpretation: Higher is better. More relevant than Sharpe for strategies with asymmetric returns.

**Calmar Ratio:**
```
Calmar = CAGR / |MDD|
```

Interpretation: `> 0.5` adequate, `> 1.0` good, `> 2.0` excellent. Captures return per unit of worst-case loss.

### 2.4 Trade-Level Metrics

**Win Rate:**
```
Win Rate = (Number of Winning Trades) / (Total Closed Trades)
```

**Profit Factor:**
```
Profit Factor = (Gross Profit from Winners) / (Gross Loss from Losers)
```

Interpretation: `> 1.0` profitable, `> 1.5` good, `> 2.0` excellent.

**Average Win / Average Loss Ratio:**
```
Avg Win/Avg Loss = |Avg Winning Trade %| / |Avg Losing Trade %|
```

Interpretation: `> 1.5` desirable. Combined with Win Rate > 40% produces a positive expectancy.

**Expectancy:**
```
Expectancy = (Win Rate × Avg Win) - ((1 - Win Rate) × |Avg Loss|)
```

**SQN (System Quality Number):**
```
SQN = sqrt(N_trades) × mean(trade_returns) / std(trade_returns)

# Interpretation:
# < 1.0: Poor
# 1.0–1.9: Below average
# 2.0–2.9: Average
# 3.0–4.9: Good
# 5.0–6.9: Excellent
# > 7.0: Holy Grail
```

**Kelly Criterion (fractional):**
```
Kelly % = Win Rate - ((1 - Win Rate) / (Avg Win / Avg Loss))

# Fractional Kelly (1/4 or 1/2) is typically used for position sizing
```

### 2.5 Additional Metrics

| Metric | Formula / Description |
|---|---|
| **Alpha** | Excess return vs benchmark (Jensen's Alpha) |
| **Beta** | Covariance with benchmark / benchmark variance |
| **Omega Ratio** | Probability-weighted ratio of gains vs losses at a threshold |
| **Value at Risk (VaR 95%)** | 5th percentile of historical daily returns |
| **CVaR (Expected Shortfall)** | Average loss beyond VaR threshold |
| **Turnover Rate** | Average portfolio replacement rate per period |
| **Recovery Factor** | Net profit / max drawdown (absolute) |
| **Ulcer Index** | RMS of percentage drawdowns; penalizes depth and duration |

### 2.6 Benchmark Comparison

Always run the strategy against buy-and-hold of relevant benchmarks:
- **SPY** (S&P 500) for broad US equity
- **QQQ** (Nasdaq-100) for tech-heavy strategies
- **AGG** (Aggregate Bond) for fixed-income

Compare: CAGR, Sharpe, MDD, rolling 1Y/3Y/5Y returns, information ratio.

**Rolling Returns:**
```python
def rolling_returns(returns, window_days=252):
    """1Y rolling returns"""
    rolling = (1 + returns).rolling(window_days).apply(np.prod) - 1
    return rolling
```

---

## 3. Realistic Backtesting Considerations

### 3.1 Slippage Modeling

Slippage is the difference between the expected trade price and the actual execution price.

| Slippage Type | How to Model | Typical Values |
|---|---|---|
| **Fixed %** | Reduce fill price by fixed % | 0.05%–0.1% per side |
| **Volatility-based** | Slippage = k × σ × sqrt(trade_size/daily_vol) | k = 0.1–0.5 |
| **Bid-ask spread** | Half-spread for market orders | 0.01%–0.05% for liquid stocks |
| **Fixed cents/share** | Deduct $0.01–$0.05 per share | US equities |

```python
# vectorbt slippage example
pf = vbt.Portfolio.from_signals(
    price, entries, exits,
    slippage=0.001  # 0.1% slippage per trade
)
```

### 3.2 Commission Simulation

**US Broker Reality (2026):**
- Most major brokers charge **$0 commission** for US stock/ETF trades
- However, for realistic backtests, include small per-share or per-trade costs to account for:
  - **SEC fees**: ~$8 per $1M sold (0.0008%)
  - **TAF fees**: ~$0.000166 per share sold (varies)
  - **Exchange fees**: minimal for retail

```python
# Conservative commission model for robustness:
commission = 0.001  # 0.1% per trade (generous safety margin)
min_commission = 10.0  # $10 minimum per trade (legacy but safe)
```

### 3.3 Survivorship Bias

**Problem:** Using only currently-listed stocks inflates historical performance because delisted/bankrupt companies are excluded.

**Mitigation:**
- Use point-in-time data snapshots (e.g., from Norgate Data, Sharadar, or WRDS CRSP)
- For free data, accept the limitation but note it in reports
- Acknowledge that backtest results are likely **overstated by 1–3% annually** due to survivorship bias
- Consider using ETF data (SPY, QQQ) which naturally handles survivorship

### 3.4 Look-Ahead Bias Prevention

Common pitfalls:
- Using the entire date range to compute indicators (leaks future info)
- Using split/dividend-adjusted data that incorporates future corporate actions
- Computing ranking percentiles on the full cross-section instead of expanding
- Using `df.rolling().mean()` without understanding the window direction

**Fix:**
```python
# Ensure no look-ahead — use .shift(1) before generating signals
signal = (fast_ma.shift(1) > slow_ma.shift(1))

# Walk-forward: always use expanding-only statistics
rank = df.expanding().rank()  # ✓
rank = df.rank()              # ✗ (uses future data)
```

### 3.5 Market Impact

For retail traders trading <1% of daily volume, market impact is negligible. For Trend-Scope (retail-focused), this can be ignored unless simulating large portfolios (>$10M).

For institutional/large-scale:
```
Market Impact = σ × (Trade_Size / Daily_Volume)^0.5 × spread_cost
```

### 3.6 Out-of-Sample Testing

**Data Split:**
- **In-sample (IS):** 60–70% of historical data for strategy development/optimization
- **Out-of-sample (OOS):** 30–40% for validation — never optimize on this

**Walk-Forward Optimization (WFO):**
```
Split timeline into windows:
┌─────────┬──────────────┐
│ Train   │ Test         │  Window 1
│ 2018-19 │ 2020         │
├─────────┼──────────────┤
│ 2019-20 │ 2021         │  Window 2 (anchored or rolling)
├─────────┼──────────────┤
│ 2020-21 │ 2022         │  Window 3
└─────────┴──────────────┘

For each window:
  1. Optimize params on Train (in-sample)
  2. Test on Test (out-of-sample)
  3. Record metrics
  4. Slide window forward

Final score = aggregate of all OOS windows
```

**TimeSeriesSplit (scikit-learn):**
```python
from sklearn.model_selection import TimeSeriesSplit

tscv = TimeSeriesSplit(n_splits=5)
for train_idx, test_idx in tscv.split(data):
    train = data.iloc[train_idx]
    test = data.iloc[test_idx]
    # Optimize on train, evaluate on test
```

### 3.7 Key Realism Checklist

- [ ] Slippage ≥ 0.05% per side
- [ ] Commission ≥ $0.005/share or 0.05%/trade as safety margin
- [ ] Survivorship bias documented as a known limitation
- [ ] All signals use `.shift(1)` to prevent look-ahead
- [ ] Out-of-sample period ≥ 30% of total data
- [ ] Benchmark comparison included (SPY/QQQ buy-and-hold)
- [ ] At least 50+ trades in backtest for statistical significance
- [ ] Walk-forward optimization for any optimized parameters
- [ ] Strategy works across multiple market regimes (bull, bear, sideways)

---

## 4. Backtest Report Generation

### 4.1 Report Components

A professional backtest report should include:

1. **Strategy Summary Card:**
   - Strategy name, asset, date range, parameter values
   - Total return, CAGR, Sharpe, MDD at a glance

2. **Equity Curve:**
   - Strategy vs benchmark cumulative returns
   - Log scale option for long periods

3. **Drawdown Chart:**
   - Underwater plot (time vs % drawdown)
   - Peak markers, recovery duration

4. **Monthly Returns Heatmap:**
   - Green/red color-coded calendar-style grid
   - Annual summaries on margins

5. **Rolling Returns (1Y, 3Y, 5Y):**
   - Line chart showing rolling CAGR
   - Distribution histogram of rolling returns

6. **Trade Distribution:**
   - Histogram of trade PnL distribution
   - Trade duration vs return scatter plot
   - Win/loss streaks analysis

7. **Monte Carlo Simulation:**
   - Resample trade sequence 1,000+ times
   - Plot 90%/50%/10% percentile equity curves
   - Probability of profit, expected max drawdown distribution

8. **Statistics Table:**
   - All metrics from Section 2 in a formatted table

### 4.2 Implementation Options

**Option A: QuantStats (Simplest, Recommended)**
```python
import quantstats as qs

# HTML report in one line
qs.reports.html(returns, benchmark='SPY', output='report.html',
                 title='Trend-Scope Strategy Report')

# Key features:
# - Full tear sheet with all metrics
# - Interactive Plotly charts
# - Clean, professional HTML output
```

**Option B: Custom matplotlib/seaborn**
```python
import matplotlib.pyplot as plt
import seaborn as sns

# Full control over layout
fig, axes = plt.subplots(3, 2, figsize=(16, 12))
# axes[0,0]: equity curve
# axes[0,1]: drawdown
# axes[1,0]: monthly returns heatmap
# axes[1,1]: rolling returns
# axes[2,0]: trade PnL distribution
# axes[2,1]: Monte Carlo simulation
```

**Option C: Jinja2 + HTML/CSS template**
- Template-driven for consistent branding
- Embed Plotly/Bokeh interactive charts
- Optional PDF generation via WeasyPrint or Playwright

### 4.3 PDF Generation
```python
# WeasyPrint — HTML to PDF, good CSS support
from weasyprint import HTML
HTML('report.html').write_pdf('report.pdf')

# Or use Playwright for better chart rendering
```

---

## 5. Strategy Optimization

### 5.1 Grid Search

Exhaustive enumeration of parameter combinations:

```python
# vectorbt: vectorized grid search (fast)
windows = np.arange(2, 101)
fast_ma, slow_ma = vbt.MA.run_combs(price, window=windows, r=2)
pf = vbt.Portfolio.from_signals(price, entries, exits)
pf.total_return().vbt.heatmap(
    x_level='fast_window', y_level='slow_window')

# Backtesting.py: built-in optimizer
stats, heatmap = bt.optimize(
    n1=range(5, 50, 5),
    n2=range(10, 100, 10),
    maximize='Sharpe Ratio',
    constraint=lambda p: p.n1 < p.n2
)
```

**Pros:** Complete coverage, deterministic.  
**Cons:** Curse of dimensionality (exponential growth). 5 params × 10 values = 100,000 combos.

### 5.2 Bayesian Optimization

Uses Gaussian processes to intelligently sample parameter space:

```python
import optuna

def objective(trial):
    fast_period = trial.suggest_int('fast', 5, 50)
    slow_period = trial.suggest_int('slow', 20, 200)
    # ... run backtest with these params ...
    return sharpe_ratio

study = optuna.create_study(direction='maximize')
study.optimize(objective, n_trials=200)

best_params = study.best_params
```

**Pros:** 5–10× fewer trials than grid search for same result, handles high-dimensional spaces.  
**Cons:** Non-deterministic, may not find global optimum, requires careful study design.

### 5.3 Other Optimization Libraries

| Library | Approach | Best For |
|---|---|---|
| **Optuna** | Bayesian + TPE + pruning | General purpose, with pruning for early stop |
| **Hyperopt** | TPE (Tree Parzen Estimator) | Classic choice, good for Tree of Parzen |
| **scikit-optimize** | Gaussian Process + random forest | Simpler API, good for smaller spaces |
| **Ray Tune** | Distributed, multiple algorithms | Large-scale distributed optimization |
| **Nevergrad** | Gradient-free, multi-method | Robust, Facebook's library |

### 5.4 Parameter Sensitivity Analysis

After optimization, test how sensitive the strategy is to parameter perturbations:

```python
# One-at-a-time sensitivity
for param_name, base_value in best_params.items():
    values = np.linspace(base_value * 0.5, base_value * 1.5, 11)
    for v in values:
        sharpe = run_backtest(**{param_name: v})
        # Plot Sharpe vs parameter value
```

A robust strategy shows a **smooth plateau** around the optimum, not a sharp spike.

### 5.5 Avoiding Overfitting

**Signs of Overfitting:**
- IS/OOS performance gap > 30% (e.g., IS Sharpe 2.5, OOS Sharpe 0.6)
- Extreme parameter sensitivity (tiny change → big performance swing)
- Too many free parameters relative to number of trades
- Strategy only works in one market regime

**Guidelines:**
- **Degrees of Freedom Ratio:** Number of trades / number of optimizable parameters ≥ 10
- **Purging:** Remove overlapping train/test data to prevent leakage
- **Combinatorial purged cross-validation (CPCV):** Advanced method for time series
- **Deflated Sharpe Ratio:** Statistical test for strategy significance after multiple testing

### 5.6 Walk-Forward Analysis Methodology

```
For each window:
  1. Optimize parameters on In-Sample window (e.g., 3 years)
  2. Save optimal parameters
  3. Run backtest on Out-of-Sample window (e.g., 1 year)
  4. Record OOS metrics
  5. Slide forward by OOS length

Analysis:
  - Aggregate OOS equity curves → "walk-forward equity curve"
  - Compare OOS Sharpe vs IS Sharpe → robustness score
  - Track parameter stability → do optimal params change wildly?
  - Perfomed over multiple starting points → robustness to timing luck
```

---

## 6. Recommended Architecture for Trend-Scope

### 6.1 Core Backtesting Service

```
┌─────────────────────────────────────────────────────────┐
│                    Trend-Scope Backend                    │
├─────────────────────────────────────────────────────────┤
│  FastAPI REST API                                        │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────────┐ │
│  │ POST     │  │ GET      │  │ GET                   │ │
│  │ /backtest│  │ /backtest│  │ /backtest/{id}/report │ │
│  │ (submit) │  │ /{id}    │  │ (download)            │ │
│  └────┬─────┘  └────┬─────┘  └───────────┬───────────┘ │
│       │              │                     │             │
│  ┌────▼──────────────▼─────────────────────▼──────────┐ │
│  │              Job Queue (ARQ / Redis)               │ │
│  │  ┌──────────────────────────────────────────────┐  │ │
│  │  │  BacktestWorker:                             │  │ │
│  │  │  1. Validate parameters                      │  │ │
│  │  │  2. Fetch data (cache or Yahoo Finance)      │  │ │
│  │  │  3. Run vectorbt/backtesting.py              │  │ │
│  │  │  4. Calculate metrics                        │  │ │
│  │  │  5. Generate report (QuantStats HTML)        │  │ │
│  │  │  6. Store result in PostgreSQL              │  │ │
│  │  │  7. Notify user (WebSocket / email)          │  │ │
│  │  └──────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │  Result Cache (Redis)                              │ │
│  │  Key: strategy_hash:params_hash → result_json      │ │
│  │  TTL: 24 hours                                     │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │  PostgreSQL                                         │ │
│  │  - backtest_jobs (id, user, strategy, params, ...)  │ │
│  │  - backtest_results (id, metrics JSON, report URL)  │ │
│  │  - strategy_definitions                             │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 6.2 Technology Stack Recommendation

| Layer | Technology | Rationale |
|---|---|---|
| **Web Framework** | FastAPI | Async, auto-docs, WebSocket support |
| **Task Queue** | ARQ (async) or Celery | ARQ better for async Python; Celery more battle-tested |
| **Message Broker** | Redis | Lightweight, also used for caching |
| **Database** | PostgreSQL + SQLAlchemy | Reliable, JSONB for flexible metrics storage |
| **ORM** | SQLAlchemy 2.0 async | Works natively with FastAPI |
| **Caching** | Redis | Fast key-value store; cache backtest results |
| **File Storage** | Local or S3 | Store generated HTML/PDF reports |
| **Backtesting Engine** | vectorbt (primary) | Speed + vectorized optimization |
| **Fallback Engine** | Backtesting.py | Simpler strategies, quicker setup |
| **Report Generation** | QuantStats | Production-quality HTML tear sheets |

### 6.3 Async Job Flow

```python
# FastAPI endpoint
@app.post("/backtest")
async def submit_backtest(request: BacktestRequest):
    job_id = str(uuid.uuid4())

    # Check cache first
    cache_key = f"bt:{request.strategy_hash}:{request.params_hash}"
    cached = await redis.get(cache_key)
    if cached:
        return {"job_id": job_id, "status": "completed", "cached": True, ...}

    # Enqueue job
    await arq.enqueue_job(
        'run_backtest',
        job_id=job_id,
        strategy=request.strategy,
        params=request.params,
        start_date=request.start_date,
        end_date=request.end_date,
    )

    # Store job in DB
    await db.execute(
        insert(BacktestJob).values(
            id=job_id,
            status="queued",
            user_id=request.user_id,
            ...
        )
    )

    return {"job_id": job_id, "status": "queued"}


@app.get("/backtest/{job_id}")
async def get_backtest_status(job_id: str):
    job = await db.get(BacktestJob, job_id)
    if job.status == "completed":
        result = await db.get(BacktestResult, job_id)
        return {"status": "completed", "metrics": result.metrics, "report_url": result.report_url}
    return {"status": job.status}
```

### 6.4 Caching Strategy

```python
def make_cache_key(strategy_name: str, params: dict, symbol: str,
                   start: str, end: str) -> str:
    """Deterministic cache key for strategy + params + data range."""
    param_str = json.dumps(params, sort_keys=True)
    hash_input = f"{strategy_name}:{param_str}:{symbol}:{start}:{end}"
    return f"backtest:v1:{hashlib.sha256(hash_input.encode()).hexdigest()[:16]}"
```

Cache invalidation: auto-expire after 24 hours or on explicit user request. For data changes (e.g., new trading days), use a versioned cache prefix.

### 6.5 Rate Limiting

Backtests are CPU-intensive. Protect the service:

```python
# Token bucket or sliding window per user
# Max 5 concurrent backtests per user
# Max 50 backtests per hour per user (free tier)
# Rate limit based on estimated computation cost:
#   - Simple SMA cross: 1 credit
#   - Multi-asset + optimization: 10 credits
#   - Walk-forward: 25 credits
```

### 6.6 Recommendation Summary

| Decision | Recommendation | Rationale |
|---|---|---|
| **Primary engine** | vectorbt | Fastest, best for optimization, large parameter sweeps |
| **Secondary engine** | Backtesting.py | Simpler API for quick tests, lightweight |
| **Async queue** | ARQ + Redis | Native async Python, simpler than Celery |
| **API framework** | FastAPI | Modern, async, automatic OpenAPI docs |
| **Report engine** | QuantStats | Battle-tested, professional HTML output |
| **Optimization lib** | Optuna | Best Python hyperparameter optimization framework |
| **Database** | PostgreSQL | JSONB for flexible schema, reliable |
| **Deployment** | Docker + docker-compose | Reproducible, easy scaling |

---

## 7. References

- [vectorbt Documentation](https://vectorbt.dev/)
- [vectorbt GitHub](https://github.com/polakowo/vectorbt) — 7.8k stars, v1.0.0 (2026)
- [backtrader GitHub](https://github.com/mementum/backtrader) — 21.9k stars
- [zipline-reloaded GitHub](https://github.com/stefan-jansen/zipline-reloaded) — 1.8k stars, v3.1.1
- [bt GitHub](https://github.com/pmorissette/bt) — 2.9k stars, v1.2.0 (2026)
- [Backtesting.py GitHub](https://github.com/kernc/backtesting.py) — 8.5k stars
- [QuantConnect LEAN](https://github.com/QuantConnect/Lean) — 11k stars
- [Sharpe, Sortino, and Calmar Ratios with Python — CodeArmo](https://www.codearmo.com/blog/sharpe-sortino-and-calmar-ratios-python)
- [Optuna Hyperparameter Optimization](https://optuna.org/)
- [QuantStats Report Library](https://github.com/ranaroussi/quantstats)
- [Walk-Forward Optimization — Wikipedia](https://en.wikipedia.org/wiki/Walk_forward_optimization)
- de Prado, M.L. (2018). *Advances in Financial Machine Learning*. Wiley.
- Jansen, S. (2020). *Machine Learning for Algorithmic Trading*. Packt.
