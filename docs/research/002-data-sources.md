# 002 — Stock Market Data Sources

**Date:** 2026-06-09
**Status:** Complete
**Scope:** US stock market data providers — free and paid — for a US equities analysis platform.

---

## Executive Summary

After evaluating 12+ providers across pricing, reliability, coverage, latency, and Python integration quality, the recommended strategy is:

| Layer | Provider | Rationale |
|-------|----------|-----------|
| **Primary (free)** | **yfinance** + **Finnhub** | yfinance for historical EOD OHLCV (zero cost, 20+ years); Finnhub for real-time quotes (60 req/min free, WebSocket 50 symbols) |
| **Fallback (paid)** | **Polygon.io Stocks Advanced** ($199/mo) | Real-time data, 20+ years history, WebSocket, unlimited calls — best value at the sub-$200 tier |
| **Economic data** | **FRED** (fredapi) | Free, comprehensive US macroeconomic data from the St. Louis Fed |

---

## IEX Cloud Shutdown Note (2024)

IEX Cloud terminated service in August 2024 (acquired by Blue Sky Data). Any existing platform using IEX Cloud must migrate. This event underscores the importance of provider diversification and having a fallback data source.

---

## Free Data Sources

### 1. Yahoo Finance (yfinance)

**Python library:** `yfinance` (community-maintained, not an official Yahoo product)

| Dimension | Detail |
|-----------|--------|
| **Cost** | Free (no API key required) |
| **Coverage** | US stocks, ETFs, mutual funds, indices, futures, currencies, crypto |
| **Historical depth** | 20+ years for major US equities |
| **Data quality** | Generally accurate for EOD OHLCV; adjusted close accounts for splits/dividends |
| **Latency** | EOD data available ~30 min after close; "real-time" quotes often delayed 15+ min |
| **Rate limits** | Unofficial — Yahoo applies aggressive IP-based throttling. Common thresholds: ~2,000 requests/hour per IP. Burst requests trigger `YFRateLimitError` |
| **Reliability** | No SLA. Yahoo can (and does) change page structure, break the scraper, or block IPs without notice |

#### Known Issues & Workarounds

1. **Rate limiting** — Yahoo has tightened throttling significantly since 2024. Use `yf.download(tickers, period="max", group_by="ticker")` to batch symbols in one request.
2. **IP blocking** — Yahoo fingerprints TLS sessions. Workaround: rotate `requests.Session` objects, add random delays, use proxy pools.
3. **Missing data on delisted stocks** — yfinance silently returns empty DataFrames for delisted tickers.
4. **No corporate actions endpoint** — Splits and dividends are accessible via `ticker.actions` but not as a dedicated, paginated API.
5. **Breaking changes** — The library has had multiple breaking updates (v0.2.x series). Pin versions in production.

```python
# Recommended yfinance usage pattern
import yfinance as yf
import time

def fetch_with_retry(tickers, max_retries=3):
    for attempt in range(max_retries):
        try:
            data = yf.download(tickers, period="max", group_by="ticker", auto_adjust=False)
            return data
        except Exception as e:
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
            else:
                raise
```

---

### 2. Alpha Vantage

**API key required:** Yes (free registration)

| Dimension | Free Tier | Premium ($49.99/mo) | Premium ($99.99/mo) | Premium ($249/mo) |
|-----------|-----------|---------------------|---------------------|-------------------|
| **Requests/day** | 25 | Unlimited | Unlimited | Unlimited |
| **Requests/min** | 5 | 75 | 150 | 300 |
| **Historical depth** | 20+ years | 20+ years | 20+ years | 20+ years |
| **Real-time** | No (EOD only) | Yes (US stocks) | Yes (US stocks) | Yes (all markets) |
| **Coverage** | US stocks, forex, crypto | Same + real-time | Same | Full |
| **WebSocket** | No | No | No | No |

**Key endpoints (free):** `TIME_SERIES_DAILY`, `TIME_SERIES_INTRADAY` (limited), `GLOBAL_QUOTE`, `SYMBOL_SEARCH`, `OVERVIEW`, `SECTOR`

**Assessment:** Alpha Vantage has one of the most restrictive free tiers (25 req/day). It is not suitable as a primary free source for anything beyond a hobby project. The premium tiers are competitively priced but lack WebSocket support entirely. Documentation is solid, but support responsiveness is mixed.

**Python integration:**
```python
from alpha_vantage.timeseries import TimeSeries
import os

api_key = os.environ["ALPHA_VANTAGE_KEY"]
ts = TimeSeries(key=api_key, output_format="pandas")
data, meta = ts.get_daily("AAPL", outputsize="full")
```

Official wrapper: `pip install alpha_vantage` — functional but not actively maintained (last updated 2022). A direct `requests` approach is preferred for reliability.

---

### 3. IEX Cloud — DISCONTINUED

IEX Cloud shut down in August 2024. The service was acquired by Blue Sky Data and is no longer available as a standalone API. Former IEX Cloud users should migrate to Polygon.io, Finnhub, or Twelve Data.

---

### 4. Twelve Data

| Dimension | Free Tier | Basic ($29/mo) | Pro ($79/mo) | Enterprise ($329/mo) |
|-----------|-----------|----------------|--------------|----------------------|
| **API credits/day** | 800 | 610+ | 2,584+ | Unlimited |
| **WebSocket credits** | 8 (trial) | 500+ | 2,500+ | Unlimited |
| **Historical depth** | Limited | Full | Full | Full |
| **Real-time** | Delayed | Yes | Yes | Yes |
| **Coverage** | US stocks, forex, crypto | All | All | All global markets |

**Assessment:** Twelve Data has excellent documentation, clean API design, and advertises 99.95% uptime. The free tier (800 req/day) is genuinely usable for development. WebSocket is available even on the trial tier. The Python SDK is well-maintained.

**Python integration:**
```python
from twelvedata import TDClient

td = TDClient(apikey="YOUR_API_KEY")
ts = td.time_series(symbol="AAPL", interval="1day", outputsize=5000)
df = ts.as_pandas()
```

Official library: `pip install twelvedata` — active, well-documented, supports async.

---

### 5. Finnhub

| Dimension | Free Tier | All-In-One ($3,500/mo annual) |
|-----------|-----------|-------------------------------|
| **API calls/min** | 60 | 300–900 |
| **WebSocket** | 50 symbols | Unlimited symbols |
| **Historical OHLC** | Not on free tier | 30+ years |
| **Real-time** | Yes (15-min delay for LSE) | Yes |
| **Coverage** | US only | Global |
| **Fundamentals** | Basic company profile v2 | Full financials (30+ years) |

**Assessment:** Finnhub has the most generous free tier in the market (60 req/min). The WebSocket on the free tier supports 50 symbols — unmatched among free providers. The main limitation: historical OHLC data requires a paid plan. The free tier is excellent for real-time quotes, company news, and basic fundamentals.

The jump to paid is steep ($3,500/mo), making Finnhub best as a free-tier supplement rather than a paid upgrade path.

**Python integration:**
```python
import finnhub

client = finnhub.Client(api_key="YOUR_API_KEY")
quote = client.quote("AAPL")
candles = client.stock_candles("AAPL", "D", 1590988249, 1650988249)
```

Official library: `pip install finnhub-python` — simple, well-maintained, synchronous only (wrap in `asyncio` for async).

---

### 6. Polygon.io (Free Tier)

| Dimension | Free Tier |
|-----------|-----------|
| **API calls/min** | 5 |
| **Historical data** | 2 years |
| **Data types** | EOD OHLCV, minute aggregates, reference data, corporate actions, technical indicators |
| **Real-time** | No (delayed EOD) |
| **WebSocket** | No |
| **Coverage** | All US stocks |

**Assessment:** The free tier is useful only for development/testing — 5 req/min and 2 years of history is too limited for production analysis. The free API key requires registration. Data quality is excellent and the API is well-designed. This is a "try before you buy" tier.

---

### 7. Tiingo

| Dimension | Starter (Free) | Power ($30/mo individual / $50/mo commercial) |
|-----------|----------------|-----------------------------------------------|
| **Requests/hour** | 50 | 10,000 |
| **Requests/day** | 1,000 | 100,000 |
| **Bandwidth/month** | 1 GB | 40 GB |
| **Unique symbols/month** | 500 | 107,558 |
| **Historical depth** | 30+ years | 30+ years |
| **Real-time** | IEX feed included | IEX feed included |
| **Fundamentals** | Limited (add-on) | 15+ years (add-on) |

**Assessment:** Tiingo is targeted at quantitative researchers. The free tier is usable (1,000 req/day, 500 unique symbols). They offer academic pricing. The real-time IEX feed is a nice differentiator on the free tier. Their EOD "Composite Prices" are cleaned and adjusted — higher quality than raw exchange data. No WebSocket.

**Python integration:**
```python
import requests

headers = {"Content-Type": "application/json"}
url = "https://api.tiingo.com/tiingo/daily/AAPL/prices?startDate=2020-01-01&token=YOUR_KEY"
data = requests.get(url, headers=headers).json()
```

No official Python library — use `requests` or `pandas-datareader` with the Tiingo source.

---

### 8. FRED (Federal Reserve Economic Data)

| Dimension | Detail |
|-----------|--------|
| **Cost** | Free (API key required, free registration) |
| **Rate limit** | 120 requests/minute |
| **Coverage** | 816,000+ US and international economic time series |
| **Key datasets** | GDP, CPI, unemployment, interest rates, money supply, industrial production, housing |
| **Historical depth** | Varies — many series go back to 1940s |
| **Data types** | Not stock prices — macroeconomic indicators, regional data, releases |

**Python integration:**
```python
from fredapi import Fred

fred = Fred(api_key="YOUR_API_KEY")
gdp = fred.get_series("GDP")
unemployment = fred.get_series("UNRATE")
sp500 = fred.get_series("SP500")  # S&P 500 index level
fed_funds = fred.get_series("DFF")  # Federal Funds Rate
```

Library: `pip install fredapi` — actively maintained, pandas-native output, supports series search, releases, vintage data.

---

## Paid Data Sources

### 1. Polygon.io (Paid Plans)

| Dimension | Starter ($29/mo) | Developer ($79/mo) | Advanced ($199/mo) |
|-----------|------------------|--------------------|--------------------|
| **API calls** | Unlimited | Unlimited | Unlimited |
| **Historical depth** | 5 years | 10 years | 20+ years |
| **Data types** | EOD, minute, reference, corp actions, flat files, WebSocket, snapshot, second aggregates | + trades | + real-time, quotes, financials & ratios |
| **Real-time** | 15-min delayed | 15-min delayed | Real-time |
| **WebSocket** | Yes | Yes | Yes |
| **Coverage** | All US stocks | All US stocks | All US stocks |

**Assessment:** Polygon.io is the best mid-tier paid provider. The Advanced plan at $199/mo includes real-time data, WebSocket, 20+ years of history, unlimited API calls, and fundamental data — everything a US stock analysis platform needs. API design is RESTful and well-documented. Python client is first-class.

**Python integration:**
```python
from polygon import RESTClient

client = RESTClient(api_key="YOUR_API_KEY")

# Aggregates (OHLCV bars)
aggs = client.get_aggs("AAPL", 1, "day", "2023-01-01", "2023-12-31")

# Real-time WebSocket
from polygon import WebSocketClient
ws = WebSocketClient(api_key="YOUR_API_KEY")
ws.run("AM.AAPL")  # Minute aggregates channel
```

Official library: `pip install polygon-api-client` — async-first, pydantic models, well-maintained.

---

### 2. IEX Cloud Paid — DISCONTINUED

See note above. IEX Cloud is no longer available.

---

### 3. Alpha Vantage Premium

| Plan | Price | Key Features |
|------|-------|-------------|
| **Basic** | $49.99/mo | 75 req/min, real-time US stocks |
| **Intermediate** | $99.99/mo | 150 req/min, real-time US stocks |
| **Ultimate** | $249/mo | 300 req/min, real-time all markets |

**Assessment:** Competitively priced but lacks WebSocket support entirely — a significant gap for any platform needing live updates. Best suited for batch-oriented workflows (EOD analysis, screening). The NASDAQ vendor status is a credibility signal.

---

### 4. Intrinio

Intrinio targets the institutional/professional market with à la carte pricing:

| Product | Price | Key Features |
|---------|-------|-------------|
| **EquitiesEdge** | $1,250/mo | Real-time stock prices, no exchange fees, API + WebSocket |
| **CBOE One Delayed** | $3,000/yr | 15-min delayed, full market coverage |
| **EOD Historical Stock Prices** | $3,100/yr | 50+ years of split/dividend-adjusted history |
| **IEX Real-Time** | $6,000/yr | Real-time IEX feed, API + WebSocket |
| **Nasdaq Basic** | $9,000/yr | Real-time, Nasdaq-sourced |
| **US Fundamentals** | $9,600/yr | 15+ years of standardized financials from SEC filings |
| **Stock Prices Tick History** | $6,000/yr | Tick-level backtesting data |
| **OptionsEdge** | $1,250/mo | Real-time options data (Greeks, IV, synthetic prices) |

**Assessment:** Intrinio offers institutional-grade data quality with transparent per-product pricing. Their data is well-normalized and clean. The EquitiesEdge product is compelling for real-time needs without exchange fees. Overkill for a personal/small-team platform; ideal for funded startups and fintech companies.

---

### 5. Xignite

Xignite is an enterprise market data API provider offering à la carte pricing per asset class and region. No public pricing — custom quotes only. Typical enterprise contracts start at $10K–50K/yr. Coverage includes global stocks, fundamentals, fixed income, commodities, and FX. Used by firms like SoFi, Betterment, and Robinhood (early days).

**Assessment:** Enterprise-only. Not suitable for indie developers or small teams due to opaque pricing and minimum commitments. Worth evaluating only if the platform reaches scale and needs exchange-licensed data.

---

### 6. Bloomberg / Refinitiv (Enterprise)

**Bloomberg Terminal:** ~$24,000/yr per seat. Includes Bloomberg API (BLPAPI) for programmatic access. Industry standard for professional finance.

**Refinitiv Eikon:** ~$22,000/yr per seat. Refinitiv Data Platform APIs for cloud-based access.

**Assessment:** These are the gold standard for data quality and coverage but are priced for institutions. They require desktop terminal software and have complex licensing. Not practical for a self-funded platform. Mentioned for completeness.

---

### 7. Tiingo Paid

| Plan | Price | Key Features |
|------|-------|-------------|
| **Power (Individual)** | $30/mo or $300/yr | 10,000 req/hr, 100,000 req/day, 40 GB/mo bandwidth, all 107K+ symbols |
| **Power (Commercial Internal)** | $50/mo or $499/yr | Same as individual but allows internal business use |
| **Redistribution** | Custom | Contact sales |

**Assessment:** Tiingo's paid tiers are extremely affordable for the data volume provided. The $30/mo individual plan is one of the best values in market data. Key limitation: no WebSocket for real-time streaming — you poll the REST API. Best for quantitative research and EOD analysis.

---

## Comprehensive Comparison

### Free Tier Comparison

| Provider | Req/Min | Req/Day | Historical | Real-Time | WebSocket | Python Library Quality |
|----------|---------|---------|------------|-----------|-----------|------------------------|
| **yfinance** | ~100 (unofficial) | ~2,000 | 20+ years | Delayed (15m) | No | Good (community) |
| **Alpha Vantage** | 5 | 25 | 20+ years | No (free) | No | Fair (outdated) |
| **Finnhub** | 60 | Unlimited | None (free) | Yes (delayed) | Yes (50 sym) | Good (official) |
| **Twelve Data** | 8 credits | 800 | Limited | Delayed | 8 trial credits | Good (official) |
| **Polygon.io** | 5 | ~7,200 | 2 years | EOD only | No | Excellent (official) |
| **Tiingo** | 50/hr | 1,000 | 30+ years | IEX feed | No | Fair (no official) |
| **FRED** | 120/min | Unlimited | Varies (decades) | N/A (macro data) | No | Good (community) |

### Paid Plan Comparison (mid-tier, ~$30–$200/mo)

| Provider | Plan | Price/Mo | Req/Min | Historical | Real-Time | WebSocket | Fundamentals |
|----------|------|----------|---------|------------|-----------|-----------|--------------|
| **Polygon.io** | Advanced | $199 | Unlimited | 20+ years | Yes | Yes | Yes |
| **Twelve Data** | Pro | $79 | Unlimited | Full | Yes | Yes | Limited |
| **Tiingo** | Power | $30 | 10,000/hr | 30+ years | IEX poll | No | Add-on |
| **Alpha Vantage** | Intermediate | $99.99 | 150 | 20+ years | Yes | No | Limited |
| **EODHD** | Basic | ~€20 | Unlimited | 30+ years | Delayed | No | Yes |

### Enterprise Comparison

| Provider | Starting Price | Real-Time | WebSocket | Global Coverage | Python SDK |
|----------|---------------|-----------|-----------|----------------|------------|
| **Intrinio** | $3,000/yr (delayed) | Yes ($1,250/mo+) | Yes | US focused | Yes |
| **Xignite** | Custom quote (~$10K+) | Yes | Yes | Yes | Yes |
| **Finnhub** | $3,500/mo | Yes | Yes | Yes | Yes |
| **Bloomberg** | ~$24,000/yr/seat | Yes | Yes (BLPAPI) | Yes | Yes |
| **Refinitiv** | ~$22,000/yr/seat | Yes | Yes | Yes | Yes |

---

## Key Comparison Dimensions

### Real-Time vs Delayed

| Provider | Free Real-Time | Paid Real-Time | Delay Note |
|----------|---------------|----------------|------------|
| Finnhub | Yes | Yes | 15-min delay on LSE; US is near-real-time |
| Polygon.io | No | Yes ($199/mo) | Real-time on Advanced plan |
| Tiingo | IEX feed | IEX feed | Covers ~2.3% of US market volume |
| Alpha Vantage | No | Yes ($49.99/mo+) | — |
| Twelve Data | Delayed | Yes ($29/mo+) | — |
| yfinance | Delayed 15m+ | N/A | Unofficial |

### Historical Data Depth

| Provider | Free Depth | Paid Depth |
|----------|-----------|------------|
| Tiingo | 30+ years | 30+ years |
| Alpha Vantage | 20+ years | 20+ years |
| Polygon.io | 2 years | 20+ years |
| yfinance | 20+ years | N/A |
| FRED | 50+ years (select series) | N/A |
| Finnhub | None | 30+ years |

### WebSocket Support

| Provider | Free WebSocket | Paid WebSocket |
|----------|---------------|----------------|
| Finnhub | 50 symbols | Unlimited |
| Polygon.io | No | Yes (Starter+) |
| Intrinio | No | Yes (select products) |
| Twelve Data | 8 trial credits | Yes |
| Alpha Vantage | No | No |
| Tiingo | No | No |
| yfinance | No | N/A |

### Corporate Actions

| Provider | Splits | Dividends | Adjustment Method |
|----------|--------|-----------|-------------------|
| yfinance | Yes (`ticker.actions`) | Yes (`ticker.actions`) | Auto-adjusted close |
| Polygon.io | Yes (reference data) | Yes (reference data) | Raw + split-adjusted |
| Tiingo | Included in EOD prices | Included in EOD prices | Composite adjusted prices |
| Alpha Vantage | Yes (`DIGITAL_CURRENCY_*`) | Yes (`DIVIDENDS`) | Separate endpoint |
| Finnhub | No (free) | Yes (paid) | — |
| Intrinio | Yes | Yes | Separate adjustment factors |
| FRED | N/A | N/A | N/A |

---

## Recommended Strategy

### Primary Stack (Free)

```
yfinance  ────► Historical EOD OHLCV (batch downloads, backtesting)
Finnhub   ────► Real-time quotes + WebSocket (50 symbols live)
FRED      ────► Macroeconomic context (interest rates, GDP, CPI)
```

**Why this combination:**
- **yfinance** gives you 20+ years of adjusted OHLCV data at zero cost with bulk download capability. Despite reliability caveats, it remains the most practical free option for historical data.
- **Finnhub** provides 60 req/min (generous) and a 50-symbol WebSocket for live price updates — unmatched among free providers.
- **FRED** adds macroeconomic context that no stock-only API provides.

**Risk mitigation for yfinance:** Cache all downloaded data locally (Parquet files). If yfinance breaks, you already have the full historical corpus. Use Finnhub as the live fallback even for EOD if needed.

### Fallback Stack (Paid)

```
Polygon.io ($199/mo)  ────► Everything: real-time, WebSocket, 20+ years history, fundamentals
Tiingo ($30/mo)       ────► Secondary: EOD composite prices, IEX real-time, high-quality adjusted data
```

**Why Polygon.io as the primary paid:**
- Single provider for all data needs (prices, fundamentals, real-time, WebSocket)
- Unlimited API calls — no per-request cost anxiety
- Excellent Python SDK with async support
- REST + WebSocket parity
- Reasonable price point ($199/mo) for the feature set

**Why Tiingo as a complement:**
- Their EOD "Composite Prices" are cleaner than raw exchange data
- IEX real-time feed included (even on free tier)
- $30/mo individual plan is excellent value
- 30+ years of history with good adjustment methodology

### Data Pipeline Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Data Pipeline                       │
├───────────┬───────────┬────────────┬────────────────┤
│ yfinance  │  Finnhub  │   FRED     │  Polygon.io    │
│ (EOD)     │ (Live)    │  (Macro)   │  (Paid/fallbck)│
└─────┬─────┴─────┬─────┴──────┬─────┴───────┬────────┘
      │           │            │             │
      ▼           ▼            ▼             ▼
┌─────────────────────────────────────────────────────┐
│              Data Adapter Layer                       │
│  (standardized OHLCV format, error handling, retry)  │
└────────────────────────┬────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│              Local Cache (Parquet)                    │
│  - Historical: daily rollups                         │
│  - Real-time: in-memory buffer for WebSocket ticks   │
└────────────────────────┬────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│              Analysis / Dashboard                     │
└─────────────────────────────────────────────────────┘
```

---

## Integration Notes

### yfinance Batch Download Pattern

```python
import yfinance as yf
import pandas as pd
from pathlib import Path

CACHE_DIR = Path("data/cache/ohlcv")

def load_ticker_list(filepath: str) -> list[str]:
    """Load ticker list (e.g., S&P 500 constituents)."""
    return pd.read_csv(filepath)["ticker"].tolist()

def download_and_cache(tickers: list[str], period: str = "max"):
    """Download OHLCV in batches and cache to Parquet."""
    for i in range(0, len(tickers), 50):  # batch 50 at a time
        batch = tickers[i : i + 50]
        try:
            data = yf.download(batch, period=period, group_by="ticker")
            for ticker in batch:
                if ticker in data.columns.levels[0]:
                    df = data[ticker].dropna()
                    df.to_parquet(CACHE_DIR / f"{ticker}.parquet")
            time.sleep(0.5)  # rate limit courtesy delay
        except Exception as e:
            print(f"Batch {i}-{i+50} failed: {e}")
```

### Finnhub WebSocket Setup

```python
import finnhub
import json
import websocket

def on_message(ws, message):
    data = json.loads(message)
    if data.get("type") == "trade":
        print(f"{data['data'][0]['s']}: ${data['data'][0]['p']}")

def on_error(ws, error):
    print(f"WebSocket error: {error}")

def start_finnhub_ws(api_key: str, symbols: list[str]):
    ws = websocket.WebSocketApp(
        f"wss://ws.finnhub.io?token={api_key}",
        on_message=on_message,
        on_error=on_error,
    )
    for symbol in symbols:
        ws.send(json.dumps({"type": "subscribe", "symbol": symbol}))
    ws.run_forever()
```

### FRED Macro Context

```python
from fredapi import Fred

fred = Fred(api_key="YOUR_KEY")

# Key series for US stock analysis
indicators = {
    "GDP": "GDP",                    # Gross Domestic Product
    "UNRATE": "UNRATE",              # Unemployment Rate
    "CPIAUCSL": "CPIAUCSL",          # Consumer Price Index
    "DFF": "DFF",                    # Fed Funds Rate
    "T10Y2Y": "T10Y2Y",              # 10Y-2Y Treasury Spread
    "SP500": "SP500",                # S&P 500 Index
    "VIXCLS": "VIXCLS",              # VIX closing price
    "INDPRO": "INDPRO",              # Industrial Production Index
}

macro_df = pd.DataFrame({
    name: fred.get_series(series_id)
    for name, series_id in indicators.items()
})
```

---

## References

- [Alpha Vantage Premium](https://www.alphavantage.co/premium/)
- [Polygon.io Pricing](https://polygon.io/pricing)
- [Finnhub Pricing](https://finnhub.io/pricing)
- [Twelve Data Pricing](https://twelvedata.com/pricing)
- [Tiingo Pricing](https://www.tiingo.com/about/pricing)
- [Intrinio Pricing](https://intrinio.com/pricing)
- [FRED API Documentation](https://fred.stlouisfed.org/docs/api/fred/)
- [yfinance GitHub](https://github.com/ranaroussi/yfinance)
- [fredapi GitHub](https://github.com/mortada/fredapi)
- [Financial Data APIs Comparison (Kyle Redelinghuys, 2025)](https://www.ksred.com/the-complete-guide-to-financial-data-apis-building-your-own-stock-market-data-pipeline-in-2025/)
