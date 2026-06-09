# 003 - TradingView Lightweight Charts Research

> **Status**: Research Complete
> **Date**: 2026-06-09
> **Purpose**: Evaluate TradingView Lightweight Charts for K-line (candlestick) charting, covering features, licensing, Next.js integration, and alternatives.

---

## 1. Library Overview

### 1.1 What Is Lightweight Charts?

TradingView Lightweight Charts is a **free, open-source HTML5 Canvas-based financial charting library**. It is purpose-built for rendering interactive financial charts (candlestick, line, area, histogram, baseline) with minimal footprint.

| Key Metric | Value |
|---|---|
| **Latest Version** | 5.2.0 (April 2026) |
| **GitHub Stars** | 16.1k |
| **Weekly npm Downloads** | ~482,000 |
| **License** | Apache 2.0 |
| **Bundle Size (Minified)** | 186.3 kB |
| **Bundle Size (Min + GZip)** | 59.6 kB (distributed over wire) |
| **Dependencies** | 1 (`fancy-canvas`) |
| **Rendering Engine** | HTML5 Canvas (no DOM, no SVG) |
| **Languages** | TypeScript (47.5%), JavaScript (31.3%) |

### 1.2 TradingView Product Line Comparison

TradingView offers **three** charting solutions at different tiers:

| Dimension | Lightweight Charts | Advanced Charts | Trading Platform |
|---|---|---|---|
| **License** | Apache 2.0 (open source) | Proprietary (closed source) | Proprietary |
| **Free** | Yes (always) | Yes* (with TradingView logo/branding) | No |
| **Can Remove Logo** | Must attribute (Apache 2.0 NOTICE) | Paid license required | Paid license required |
| **Component Size** | ~45 KB (gzipped ~60 KB from research) | ~670 KB | ~900 KB |
| **Chart Types** | Candlestick, Bar, Line, Area, Histogram, Baseline | 17+ (Heikin Ashi, Renko, Kagi, etc.) | 17+ (same as Advanced) |
| **Built-in Indicators** | None (DIY) | 100+ pre-built | 100+ pre-built |
| **Drawing Tools** | None (custom via plugins) | 110+ intelligent drawing tools | 110+ drawing tools |
| **Price Scales** | 2 | Up to 8 | Up to 8 |
| **Log Scale** | Yes | Yes | Yes |
| **Mobile Friendly** | Yes (touch-optimized) | Yes | Yes |
| **Chart Trading** | No | No | Yes |
| **Watchlists** | No | No | Yes |
| **Symbol Comparison** | No | Yes | Yes |
| **Data Retrieval Model** | Push: you call `setData()` / `update()` | Pull: library requests data via Datafeed API | Pull: library requests data via Broker API |

> **\*Free for Advanced Charts**: Available only to **companies** for public web projects/apps. Private/personal use is not permitted for Advanced Charts or Trading Platform libraries. Lightweight Charts has no such restriction.

### 1.3 Licensing (Apache 2.0)

Lightweight Charts is licensed under **Apache License 2.0**, which permits:
- **Commercial use**: Yes, no restrictions
- **Private use**: Yes
- **Modification**: Yes
- **Distribution**: Yes
- **Patent grant**: Yes

**Attribution requirement**: The Apache 2.0 license requires displaying an attribution notice on the page accessible to users. TradingView provides `attributionLogo` chart option (`LayoutOptions.attributionLogo`) which renders a link to tradingview.com on the chart itself, satisfying this requirement.

```typescript
// Enable built-in attribution (satisfies Apache 2.0 NOTICE requirement)
const chart = createChart(container, {
  layout: {
    attributionLogo: true, // renders "Powered by TradingView" link on chart
  },
});
```

### 1.4 Bundle Size & Performance

Bundlephobia analysis (v5.2.0):
- **Minified**: 186.3 kB
- **Gzipped**: 59.6 kB
- **Download time**: 68ms (Emerging 4G), 1.19s (Slow 3G)
- **Tree-shakeable**: Yes (ES modules)
- **Dependency**: `fancy-canvas` (~5% of bundle)

Performance characteristics:
- Renders on **HTML5 Canvas** (no DOM nodes per data point → excellent for large datasets)
- Handles **tens of thousands of bars** without frame drops
- **Streaming updates**: The `update()` method efficiently patches the last bar without re-rendering entire dataset
- **Zoom/Pan**: GPU-accelerated via Canvas redraw

---

## 2. Core Features Implementation

### 2.1 Candlestick Series (OHLC Data Binding)

The library uses a **typed series model** in v5+. Each series type is a variable used with `addSeries(seriesType)`:

```typescript
import { createChart, CandlestickSeries } from 'lightweight-charts';

const chart = createChart(container, {
  width: 800,
  height: 400,
  layout: {
    background: { type: 'solid', color: '#1a1a2e' },
    textColor: '#d1d4dc',
  },
  timeScale: {
    timeVisible: true,
    secondsVisible: false,
  },
});

const candlestickSeries = chart.addSeries(CandlestickSeries, {
  upColor: '#26a69a',
  downColor: '#ef5350',
  borderUpColor: '#26a69a',
  borderDownColor: '#ef5350',
  wickUpColor: '#26a69a',
  wickDownColor: '#ef5350',
});

// Time format: YYYY-MM-DD string
candlestickSeries.setData([
  { time: '2024-01-02', open: 473.45, high: 476.80, low: 471.52, close: 474.10 },
  { time: '2024-01-03', open: 474.10, high: 478.20, low: 472.30, close: 476.50 },
  { time: '2024-01-04', open: 476.50, high: 479.00, low: 470.10, close: 471.80 },
]);
```

**Time formats supported**:
- `YYYY-MM-DD` string (day-level, recommended for daily K-line)
- `YYYY-MM-DD HH:mm:ss` (minute-level)
- Unix timestamp in seconds (`number`, use `UTCTimestamp` type)

**OHLC Data interface**:
```typescript
interface CandlestickData {
  time: Time;         // 'YYYY-MM-DD' | UTCTimestamp
  open: number;
  high: number;
  low: number;
  close: number;
  color?: string;       // override up/down color per candle
  borderColor?: string;
  wickColor?: string;
}
```

### 2.2 Volume Histogram (Separate Pane)

Volume is best rendered as a HistogramSeries on a **separate pane** (scale) below the candlestick chart:

```typescript
import { HistogramSeries } from 'lightweight-charts';

// Volume on a separate price scale (pane)
const volumeSeries = chart.addSeries(HistogramSeries, {
  color: '#26a69a50',
  priceFormat: {
    type: 'volume',
  },
  priceScaleId: 'volume', // separate scale
}, 1); // pane index 1 = below the main chart

// Configure the volume pane height
chart.panes()[0].setHeight(300); // main chart
chart.panes()[1].setHeight(100); // volume pane

// Color each volume bar based on price direction
const volumeData = klineData.map((d, i) => ({
  time: d.time,
  value: d.volume,
  color: i > 0 && d.close >= klineData[i - 1].close
    ? 'rgba(38, 166, 154, 0.5)'   // green (up)
    : 'rgba(239, 83, 80, 0.5)',   // red (down)
}));
volumeSeries.setData(volumeData);
```

**Overlay vs Separate Pane decision**:
- **Separate pane** (recommended): Volume on its own scale prevents distortion of the price Y-axis. This is the industry standard (matching TradingView.com, Yahoo Finance, etc.).
- **Overlay**: Place volume on same pane as candlestick if vertical space is limited. Requires `priceScaleId: 'overlay'` and careful opacity handling.

### 2.3 Multiple Indicator Overlays

Since Lightweight Charts has **no built-in indicators**, you must **compute indicator values yourself** (server-side in Python with pandas/numpy or client-side) and add them as LineSeries.

#### Moving Average Lines (Overlay on Candlestick Pane)

```typescript
import { LineSeries } from 'lightweight-charts';

// Compute MA values from close prices (server or client)
function calcSMA(data: number[], period: number): number[] {
  return data.map((_, i) => {
    if (i < period - 1) return NaN;
    const slice = data.slice(i - period + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / period;
  });
}

const closes = klineData.map(d => d.close);
const ma20 = calcSMA(closes, 20);
const ma60 = calcSMA(closes, 60);

// MA20 line (overlaid on candlestick pane)
const ma20Series = chart.addSeries(LineSeries, {
  color: '#ff9800',
  lineWidth: 1,
  priceScaleId: 'right', // same scale as candlesticks
});
ma20Series.setData(ma20Data);

// MA60 line
const ma60Series = chart.addSeries(LineSeries, {
  color: '#2196f3',
  lineWidth: 1,
  priceScaleId: 'right',
});
ma60Series.setData(ma60Data);
```

#### Bollinger Bands (Custom Computation + Overlay)

```typescript
function calcBollinger(closes: number[], period = 20, multiplier = 2) {
  const sma = calcSMA(closes, period);
  return sma.map((mean, i) => {
    if (isNaN(mean)) return { upper: NaN, middle: NaN, lower: NaN };
    const slice = closes.slice(i - period + 1, i + 1);
    const variance = slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period;
    const stdDev = Math.sqrt(variance);
    return {
      middle: mean,
      upper: mean + multiplier * stdDev,
      lower: mean - multiplier * stdDev,
    };
  });
}

// Upper band
chart.addSeries(LineSeries, {
  color: '#9c27b050',
  lineWidth: 1,
}).setData(bollingerData.map((d, i) => ({ time: klineData[i].time, value: d.upper })));

// Middle band
chart.addSeries(LineSeries, {
  color: '#9c27b0',
  lineWidth: 1,
}).setData(bollingerData.map((d, i) => ({ time: klineData[i].time, value: d.middle })));

// Lower band
chart.addSeries(LineSeries, {
  color: '#9c27b050',
  lineWidth: 1,
}).setData(bollingerData.map((d, i) => ({ time: klineData[i].time, value: d.lower })));
```

> **RSI, MACD, etc.**: These use a different value range (0-100), so they belong in a **separate pane**:
> ```typescript
> const rsiSeries = chart.addSeries(LineSeries, {
>   color: '#e91e63',
>   priceScaleId: 'indicator', // separate scale
> }, 2); // pane index 2
> ```

### 2.4 Marker System (Buy/Sell Signals)

Lightweight Charts v5 uses a **plugin-based marker system**. Markers are attached to series via `createSeriesMarkers()`:

```typescript
import {
  createSeriesMarkers,
  CandlestickSeries,
} from 'lightweight-charts';

const series = chart.addSeries(CandlestickSeries);

// Create markers plugin attached to series
const markersPlugin = createSeriesMarkers(series, {
  autoScale: true,   // ensure markers are visible in price range
  zOrder: 'aboveSeries', // render above candles
});

// Set markers: golden cross (buy) and death cross (sell)
markersPlugin.setMarkers([
  {
    time: '2024-06-15',
    position: 'belowBar',
    color: '#4caf50',
    shape: 'arrowUp',
    text: '金叉',
    size: 2,
  },
  {
    time: '2024-09-20',
    position: 'aboveBar',
    color: '#f44336',
    shape: 'arrowDown',
    text: '死叉',
    size: 1,
  },
]);
```

**Marker shapes available**: `'circle' | 'square' | 'arrowUp' | 'arrowDown'`

**Marker positions**: `'aboveBar' | 'belowBar' | 'inBar'`

**Price-level markers** (for target prices, stop-loss):
```typescript
import { createSeriesMarkers } from 'lightweight-charts';

const markersPlugin = createSeriesMarkers(series);
markersPlugin.setMarkers([
  {
    time: '2024-06-15',
    position: { type: 'price', price: 500.00 },
    color: '#4caf50',
    shape: 'circle',
    text: '止损',
  },
]);
```

**Up/Down markers** (simpler alternative for direction-only marks):
```typescript
import { createUpDownMarkers } from 'lightweight-charts';

const upDownPlugin = createUpDownMarkers(series);
upDownPlugin.setData([
  { time: '2024-06-15', sign: 'up' },  // green arrow above bar
  { time: '2024-09-20', sign: 'down' }, // red arrow below bar
]);
```

### 2.5 Time Scale (Daily/Weekly/Monthly Switching)

Lightweight Charts does **not** auto-aggregate data. To switch periods, you must **provide the corresponding aggregated data**:

```typescript
// Fetch and set daily data
async function switchToDaily(stockId: number) {
  const data = await fetchKline(stockId, 'day', 365);
  candlestickSeries.setData(data);
  chart.timeScale().fitContent();
}

// Fetch and set weekly data
async function switchToWeekly(stockId: number) {
  const data = await fetchKline(stockId, 'week', 156);
  candlestickSeries.setData(data);
  chart.timeScale().fitContent();
}

// Fetch and set monthly data
async function switchToMonthly(stockId: number) {
  const data = await fetchKline(stockId, 'month', 60);
  candlestickSeries.setData(data);
  chart.timeScale().fitContent();
}
```

Time scale customization:

```typescript
const chart = createChart(container, {
  timeScale: {
    timeVisible: true,        // show time on horizontal axis
    secondsVisible: false,    // hide seconds
    rightOffset: 5,           // space between last bar and right edge
    barSpacing: 8,            // minimum bar spacing in pixels
    minBarSpacing: 4,         // when zoomed out
    fixLeftEdge: false,       // don't pin left edge
    lockVisibleTimeRangeOnResize: false,
    rightBarStaysOnScroll: true,
    borderColor: '#2b2b43',
    borderVisible: true,
    visible: true,
  },
});
```

Custom time formatter (localization):

```typescript
chart.applyOptions({
  localization: {
    dateFormat: 'yyyy/MM/dd', // Japanese/Chinese convention
    locale: 'zh-CN',
  },
  timeScale: {
    tickMarkFormatter: (time: BusinessDay | UTCTimestamp) => {
      // Custom format for tick marks
      if (typeof time === 'object') {
        // BusinessDay { year, month, day }
        return `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
      }
      return new Date(time * 1000).toLocaleDateString('zh-CN');
    },
  },
});
```

### 2.6 Price Scale Formatting

Built-in formatters:

```typescript
const chart = createChart(container, {
  rightPriceScale: {
    scaleMargins: { top: 0.1, bottom: 0.2 },
    borderColor: '#2b2b43',
    visible: true,
    autoScale: true,
    mode: 0, // 0 = Normal, 1 = Logarithmic, 2 = Percentage, 3 = IndexedTo100
    entireTextOnly: false, // show partial labels
  },
  localization: {
    priceFormatter: (price: number) => {
      // Custom price format: $XXX.XX
      return `$${price.toFixed(2)}`;
    },
  },
});

// Per-series price format
const series = chart.addSeries(CandlestickSeries, {
  priceFormat: {
    type: 'price',   // 'price' | 'volume' | 'percent' | 'custom'
    precision: 2,    // decimal places
    minMove: 0.01,   // minimum tick size
  },
});
```

---

## 3. Advanced Features

### 3.1 Real-Time Data Update (WebSocket Streaming)

For live price updates during market hours, use the `update()` method to mutate the last candle:

```typescript
// Initial historical data load
candlestickSeries.setData(historicalData); // 200 candles

// WebSocket listener for real-time ticks
websocket.on('tick', (tick: Tick) => {
  const currentTime = formatDate(tick.timestamp); // '2024-12-15'

  // Update the last candle (same time key → updates in-place)
  candlestickSeries.update({
    time: currentTime,
    open: tick.open,
    high: tick.high,
    low: tick.low,
    close: tick.close,
  });
});
```

Key behaviors of `update()`:
- If `time` matches the **last data item's time**, the existing bar is **replaced** (last candle update)
- If `time` is **greater** than the last item, a **new bar** is appended
- Only the changed bar is re-rendered (not the entire chart)
- Use `historicalUpdate: true` for updating non-last bars (slower, use sparingly)

**Full WebSocket integration hook**:
```typescript
function useRealtimeChart(series: ISeriesApi<'Candlestick'>, symbol: string) {
  useEffect(() => {
    const ws = new WebSocket(`wss://api.example.com/ws/${symbol}`);

    ws.onmessage = (event) => {
      const tick = JSON.parse(event.data);
      series.update({
        time: tick.timestamp, // UTCTimestamp or 'YYYY-MM-DD'
        open: tick.open,
        high: tick.high,
        low: tick.low,
        close: tick.close,
      });
    };

    return () => ws.close();
  }, [series, symbol]);
}
```

### 3.2 Crosshair / Tooltip Customization

```typescript
import { CrosshairMode } from 'lightweight-charts';

const chart = createChart(container, {
  crosshair: {
    mode: CrosshairMode.Normal, // 'Normal' | 'Magnet' | 'Hidden'
    vertLine: {
      color: '#758696',
      width: 1,
      style: 2, // 0=Solid, 1=Dotted, 2=Dashed, 3=LargeDashed, 4=SparseDotted
      labelBackgroundColor: '#758696',
    },
    horzLine: {
      color: '#758696',
      width: 1,
      style: 2,
      labelBackgroundColor: '#758696',
    },
  },
});

// Custom tooltip via mouse event subscription
chart.subscribeCrosshairMove((param) => {
  if (!param.point || !param.time) return;

  const data = param.seriesData.get(candlestickSeries) as CandlestickData;
  if (!data) return;

  // Update a custom React tooltip/DOM element
  setTooltip({
    time: param.time,
    open: data.open,
    high: data.high,
    low: data.low,
    close: data.close,
    x: param.point.x,
    y: param.point.y,
  });
});
```

### 3.3 Drawing Tools

Lightweight Charts does **not** ship with built-in drawing tools (trend lines, fibonacci, rectangles). These must be implemented manually via the **plugin/primitives API**:

#### Using Pane Primitives (v5) for custom drawings:

```typescript
import { IPanePrimitive, IPanePrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';

class TrendLinePrimitive implements IPanePrimitive {
  private _p1: Point;
  private _p2: Point;

  constructor(p1: Point, p2: Point) {
    this._p1 = p1;
    this._p2 = p2;
  }

  paneViews(): IPanePrimitivePaneView[] {
    return [{
      renderer: (): IPrimitivePaneRenderer => ({
        draw: (ctx: CanvasRenderingContext2D) => {
          ctx.beginPath();
          ctx.moveTo(this._p1.x, this._p1.y);
          ctx.lineTo(this._p2.x, this._p2.y);
          ctx.strokeStyle = '#ff9800';
          ctx.lineWidth = 2;
          ctx.stroke();
        },
      }),
      zOrder: 'aboveSeries',
    }];
  }
}

// Attach to chart pane
chart.panes()[0].attachPrimitive(new TrendLinePrimitive(p1, p2));
```

> **Recommendation**: For this project (Phase 1), drawing tools are **out of scope**. Trend-Scope focuses on signal display (golden/death cross markers), which is well-supported by the marker system. If advanced drawing is needed later, consider community plugins from the [plugin-examples](https://github.com/tradingview/lightweight-charts/tree/master/plugin-examples) directory.

### 3.4 Zoom and Pan Behavior

Default interactions (all enabled out of the box):
- **Mouse wheel**: vertical zoom
- **Pinch gesture**: zoom in/out
- **Drag**: pan horizontally
- **Double-click**: reset zoom
- **Touch**: all gestures work on mobile

Configuration options:

```typescript
const chart = createChart(container, {
  handleScroll: {
    vertTouchDrag: true,     // drag vertically on touch
    horzTouchDrag: true,     // drag horizontally on touch
    mouseWheel: true,        // scroll wheel zoom
    pressedMouseMove: true,  // drag with mouse button held
  },
  handleScale: {
    axisPressedMouseMove: { time: true, price: false },
    axisDoubleClickReset: true,
    // Pinch/gesture zoom
    pinch: true,
  },
  kineticScroll: {
    touch: true,
    mouse: false,
  },
});

// Time scale navigation
const timeScale = chart.timeScale();
timeScale.scrollToRealTime();        // jump to latest bar
timeScale.scrollToPosition(100, false); // scroll to position
timeScale.setVisibleLogicalRange({ from: 50, to: 150 }); // set visible range
timeScale.fitContent();              // fit all data on screen

// Subscribe to visible range changes (for lazy loading)
timeScale.subscribeVisibleLogicalRangeChange((range) => {
  if (range && range.from < 10) {
    loadMoreHistoricalData(); // infinite scroll to the left
  }
});
```

### 3.5 Responsive Design & Dark/Light Theme

The chart must be **manually resized** when the container changes:

```typescript
// React: use ResizeObserver
useEffect(() => {
  const observer = new ResizeObserver((entries) => {
    const { width, height } = entries[0].contentRect;
    chart.resize(width, height);
  });
  observer.observe(containerRef.current!);
  return () => observer.disconnect();
}, [chart]);
```

**Dark/Light theme switch**:

```typescript
type ChartTheme = {
  background: string;
  textColor: string;
  gridColor: string;
  upColor: string;
  downColor: string;
  borderColor: string;
};

const themes: Record<'dark' | 'light', ChartTheme> = {
  dark: {
    background: '#1a1a2e',
    textColor: '#d1d4dc',
    gridColor: '#2b2b4330',
    upColor: '#26a69a',
    downColor: '#ef5350',
    borderColor: '#2b2b43',
  },
  light: {
    background: '#ffffff',
    textColor: '#191919',
    gridColor: '#f0f0f0',
    upColor: '#089981',
    downColor: '#f23645',
    borderColor: '#e0e0e0',
  },
};

function applyTheme(chart: IChartApi, series: ISeriesApi<'Candlestick'>, theme: ChartTheme) {
  chart.applyOptions({
    layout: {
      background: { type: 'solid', color: theme.background },
      textColor: theme.textColor,
    },
    grid: {
      vertLines: { color: theme.gridColor },
      horzLines: { color: theme.gridColor },
    },
  });
  series.applyOptions({
    upColor: theme.upColor,
    downColor: theme.downColor,
    borderUpColor: theme.upColor,
    borderDownColor: theme.downColor,
    wickUpColor: theme.upColor,
    wickDownColor: theme.downColor,
  });
}
```

### 3.6 Watermark / Branding

Two built-in watermark options:

```typescript
import { createTextWatermark, createImageWatermark } from 'lightweight-charts';

// Text watermark
const textWatermark = createTextWatermark(chart.panes()[0], {
  lines: [
    { text: 'Trend-Scope', color: '#ffffff10', fontSize: 48, fontFamily: 'Arial' },
    { text: '仅限会员查看', color: '#ffffff08', fontSize: 24 },
  ],
  horzAlign: 'center',
  vertAlign: 'center',
});

// Image watermark
const imageWatermark = createImageWatermark(chart.panes()[0], {
  href: '/logo-watermark.png',
  imageSize: { width: 200, height: 60 },
  horzAlign: 'center',
  vertAlign: 'center',
  alpha: 0.1,
});
```

---

## 4. Integration with Next.js 14

### 4.1 SSR Compatibility

The library relies on **Canvas API** and **browser-only APIs** (no server-side rendering). Use **Next.js dynamic import with `ssr: false`**:

```tsx
// components/charts/KlineChart.tsx
'use client';

import dynamic from 'next/dynamic';

const KlineChart = dynamic(() => import('./KlineChartInner'), {
  ssr: false,
  loading: () => <div className="chart-skeleton">图表加载中...</div>,
});

export default KlineChart;
```

```tsx
// components/charts/KlineChartInner.tsx
'use client';

import { useEffect, useRef } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createSeriesMarkers,
} from 'lightweight-charts';
import type { IChartApi, ISeriesApi, CandlestickData } from 'lightweight-charts';

interface Props {
  data: CandlestickData[];
  ma20Data: { time: string; value: number }[];
  ma60Data: { time: string; value: number }[];
  volumeData: { time: string; value: number; color: string }[];
  markers: any[];
  theme?: 'dark' | 'light';
  onCrosshairMove?: (data: any) => void;
}

export default function KlineChartInner({
  data,
  ma20Data,
  ma60Data,
  volumeData,
  markers,
  theme = 'dark',
  onCrosshairMove,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 500,
      layout: {
        background: { type: 'solid', color: theme === 'dark' ? '#1a1a2e' : '#ffffff' },
        textColor: theme === 'dark' ? '#d1d4dc' : '#191919',
      },
      grid: {
        vertLines: { color: theme === 'dark' ? '#2b2b4330' : '#f0f0f0' },
        horzLines: { color: theme === 'dark' ? '#2b2b4330' : '#f0f0f0' },
      },
      crosshair: { mode: 1 },
      timeScale: { timeVisible: true },
    });

    const candlestick = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
    });
    candlestick.setData(data);

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    }, 1);
    volume.setData(volumeData);

    const ma20 = chart.addSeries(LineSeries, { color: '#ff9800', lineWidth: 1 });
    ma20.setData(ma20Data);

    const ma60 = chart.addSeries(LineSeries, { color: '#2196f3', lineWidth: 1 });
    ma60.setData(ma60Data);

    if (markers.length > 0) {
      const markersPlugin = createSeriesMarkers(candlestick, { autoScale: true });
      markersPlugin.setMarkers(markers);
    }

    if (onCrosshairMove) {
      chart.subscribeCrosshairMove((param) => {
        if (param.time) onCrosshairMove(param);
      });
    }

    // Resize observer
    const resizeObserver = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      chart.resize(width, height);
    });
    resizeObserver.observe(containerRef.current);

    chartRef.current = chart;
    candlestickRef.current = candlestick;

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, []); // mount once

  // Update data when props change
  useEffect(() => {
    if (candlestickRef.current && data.length > 0) {
      candlestickRef.current.setData(data);
    }
  }, [data]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
```

### 4.2 React Wrapper Libraries

| Library | npm | Notes |
|---|---|---|
| **lightweight-charts** | native | Best option — use directly with `useRef` + `useEffect`. v5 types are excellent. |
| **react-lightweight-charts** | Community | Abandoned, last updated 2022. Does not support v5 series model. |
| **react-tradingview-widget** | Community | Wraps the **iframe widget**, not the library. Only for TradingView-hosted charts, no custom data. |

**Recommendation**: Use the library directly. The canonical React pattern (container ref + useEffect + data sync) is straightforward and well-documented. No wrapper library needed.

### 4.3 State Management (Next.js App Router)

Sync chart with external controls (date range picker, indicator toggles, period selector):

```tsx
// app/stocks/[id]/page.tsx (Server Component → data fetch)
import { fetchKlineData } from '@/lib/api';
import KlineChart from '@/components/charts/KlineChart';

export default async function StockDetailPage({ params }: { params: { id: string } }) {
  const initialData = await fetchKlineData(params.id, 'day', 200);
  return <StockDetailClient stockId={params.id} initialData={initialData} />;
}
```

```tsx
// components/stocks/StockDetailClient.tsx (Client Component → state + controls)
'use client';

import { useState } from 'react';
import { Select, DatePicker } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { fetchKlineData, fetchSignals } from '@/lib/api';
import KlineChart from '@/components/charts/KlineChart';

export default function StockDetailClient({ stockId, initialData }) {
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day');
  const [showMA20, setShowMA20] = useState(true);
  const [showMA60, setShowMA60] = useState(true);

  const { data: klineData } = useQuery({
    queryKey: ['kline', stockId, period],
    queryFn: () => fetchKlineData(stockId, period, 200),
    initialData,
  });

  const { data: signals } = useQuery({
    queryKey: ['signals', stockId],
    queryFn: () => fetchSignals(stockId),
  });

  const chartData = buildChartData(klineData, signals, { showMA20, showMA60 });

  return (
    <div>
      <div className="controls">
        <Select value={period} onChange={setPeriod}
          options={[
            { label: '日K', value: 'day' },
            { label: '周K', value: 'week' },
            { label: '月K', value: 'month' },
          ]}
        />
        <Checkbox checked={showMA20} onChange={e => setShowMA20(e.target.checked)}>MA20</Checkbox>
        <Checkbox checked={showMA60} onChange={e => setShowMA60(e.target.checked)}>MA60</Checkbox>
      </div>
      <KlineChart data={chartData.data} ma20Data={chartData.ma20Data} ... />
    </div>
  );
}
```

---

## 5. Alternatives Comparison

### 5.1 Feature Comparison Table

| Feature | Lightweight Charts | ECharts | Highcharts Stock | D3.js |
|---|---|---|---|---|
| **License** | Apache 2.0 (free) | Apache 2.0 (free) | Commercial (paid) | ISC (free) |
| **Bundle Size** | ~60 kB gzipped | ~300 kB gzipped | ~150 kB gzipped | Variable (DIY) |
| **Rendering** | Canvas | Canvas / SVG | SVG (Canvas for large data) | SVG / Canvas |
| **Candlestick** | Built-in | Built-in | Built-in | DIY |
| **Volume** | HistogramSeries | Built-in | Built-in | DIY |
| **Technical Indicators** | DIY (manual compute) | DIY + community plugins | 40+ built-in | DIY |
| **Markers/Signals** | createSeriesMarkers | markPoint/markLine | Annotations API | DIY |
| **Crosshair/Tooltip** | Built-in + customizable | Built-in + customizable | Built-in + customizable | DIY |
| **Drawing Tools** | Custom via primitives | Brush select + custom | 15+ built-in (annotations) | DIY |
| **WebSocket Streaming** | series.update() | appendData() | addPoint() | DIY |
| **Responsive** | Manual resize | Auto (chart.resize()) | Auto | Manual |
| **Dark/Light Theme** | Manual applyOptions | Built-in theme system | Built-in theme system | Manual |
| **TypeScript** | First-class (47% TS) | Good support | Good support | @types/d3 |
| **Next.js SSR** | ✅ dynamic(ssr:false) | ⚠️ need ssr:false (canvas) | ⚠️ need ssr:false | ⚠️ need ssr:false |
| **Financial UI** | Purpose-built | General purpose | Purpose-built | General purpose |
| **Learning Curve** | Low (focused API) | Medium | Low-Medium | High |
| **Community** | 16.1k stars | 61k stars | Active | 109k stars |
| **Commercial Use Fee** | $0 | $0 | ~$500+/year | $0 |

### 5.2 Detailed Alternative Analysis

#### ECharts (Apache 2.0)
- **Pros**: Massive Chinese community, built-in candlestick+volume, richer chart types (heatmap, treemap), automatic responsive resize, `dataZoom` component for range selection.
- **Cons**: General-purpose library — candlestick is one of 50+ chart types, not optimized for financial UX. Missing: price line tool, up/down color per-volume bar, financial crosshair behavior, `Time` type abstraction. Heavier bundle.
- **Verdict**: Good fallback if financial-specific features aren't needed. For a K-line-first app, Lightweight Charts is more focused.

#### Highcharts Stock (Commercial)
- **Pros**: Most complete out-of-the-box: 40+ indicators, annotations, responsive, excellent docs, `<HighchartsReact>` component for React/Next.js.
- **Cons**: **Paid** (~$500-$1,000/year for commercial use). Overkill for Trend-Scope's Phase 1 needs (MA, RSI, volume). Vendor lock-in.
- **Verdict**: Best for enterprise with budget. Trend-Scope should use free alternatives first.

#### D3.js (Free, ISC)
- **Pros**: Maximum flexibility, build anything, huge ecosystem, SVG for accessibility.
- **Cons**: **Steep learning curve**. Candlestick, crosshair, zoom, indicators — everything from scratch. Dev time: weeks vs hours for Lightweight Charts.
- **Verdict**: Only if you need complete visual control (e.g., custom chart types not supported by any library). Not recommended for Trend-Scope.

#### lightweight-charts-python (Server-Side Rendering)
- [lightweight-charts-python](https://github.com/louisnw01/lightweight-charts-python) is a **Python wrapper** that renders charts to static images (PNG/HTML) using a headless browser.
- **Use case**: Generating static chart images for email reports, PDF exports, or server-side pre-rendering.
- **Not suitable for**: Interactive browser charts (the JavaScript library is for that).
- **Relevance to Trend-Scope**: Could be used in the backend for generating email alert screenshots. Not a primary charting solution.

### 5.3 Recommendation for Trend-Scope

**Primary**: Lightweight Charts — free, lightweight, purpose-built for financial K-line charts, excellent TypeScript support, Apache 2.0 license compatible with commercial use.

**Backup/ECharts**: If additional non-financial chart types are needed (pie charts for portfolio allocation, bar charts for comparison), add ECharts as a secondary library.

---

## 6. Code Examples

### 6.1 Basic Candlestick Chart Setup

```typescript
import { createChart, CandlestickSeries } from 'lightweight-charts';

const container = document.getElementById('chart')!;
const chart = createChart(container, {
  width: container.clientWidth,
  height: 500,
  layout: {
    background: { type: 'solid', color: '#1a1a2e' },
    textColor: '#d1d4dc',
    attributionLogo: true,
  },
  grid: {
    vertLines: { color: '#2b2b4320' },
    horzLines: { color: '#2b2b4320' },
  },
  crosshair: { mode: 1 },
  rightPriceScale: {
    borderColor: '#2b2b43',
    scaleMargins: { top: 0.1, bottom: 0.2 },
  },
  timeScale: {
    borderColor: '#2b2b43',
    timeVisible: true,
  },
});

const candlestickSeries = chart.addSeries(CandlestickSeries, {
  upColor: '#26a69a',
  downColor: '#ef5350',
  borderUpColor: '#26a69a',
  borderDownColor: '#ef5350',
  wickUpColor: '#26a69a',
  wickDownColor: '#ef5350',
});

candlestickSeries.setData([
  { time: '2024-01-02', open: 473.45, high: 476.80, low: 471.52, close: 474.10 },
  { time: '2024-01-03', open: 474.10, high: 478.20, low: 472.30, close: 476.50 },
  { time: '2024-01-04', open: 476.50, high: 479.00, low: 470.10, close: 471.80 },
]);

chart.timeScale().fitContent();
```

### 6.2 Adding MA20 and MA60 Overlays (Computed Server-Side)

Backend (Python/FastAPI) computes indicators and returns alongside OHLC data:

```python
# backend/app/services/analysis_engine.py
import pandas as pd

def compute_indicators(df: pd.DataFrame) -> dict:
    """Compute MA20 and MA60 from OHLC DataFrame."""
    df = df.copy()
    df['ma20'] = df['close'].rolling(window=20).mean()
    df['ma60'] = df['close'].rolling(window=60).mean()
    return df[['trade_date', 'ma20', 'ma60']].to_dict(orient='records')
```

Frontend renders as LineSeries overlays:

```typescript
import { LineSeries } from 'lightweight-charts';

// Assume API response includes kline + indicators
const response = await fetch(`/api/v1/stocks/${stockId}/kline?period=day&limit=200`);
const { kline, indicators } = await response.json();

// K-line
candlestickSeries.setData(kline.map(d => ({
  time: d.trade_date,
  open: Number(d.open),
  high: Number(d.high),
  low: Number(d.low),
  close: Number(d.close),
})));

// MA20
const ma20Series = chart.addSeries(LineSeries, {
  color: '#ff9800',
  lineWidth: 1,
  priceLineVisible: false,
  lastValueVisible: true,
});
ma20Series.setData(indicators.map(d => ({
  time: d.trade_date,
  value: d.ma20,
})).filter(d => d.value !== null && !isNaN(d.value)));

// MA60
const ma60Series = chart.addSeries(LineSeries, {
  color: '#2196f3',
  lineWidth: 1,
  priceLineVisible: false,
  lastValueVisible: true,
});
ma60Series.setData(indicators.map(d => ({
  time: d.trade_date,
  value: d.ma60,
})).filter(d => d.value !== null && !isNaN(d.value)));
```

### 6.3 Adding Buy/Sell Markers

```typescript
import { createSeriesMarkers } from 'lightweight-charts';

// Fetch signals from the analysis API
const signals = await fetchSignals(stockId);
// signals: [{ triggered_date: '2024-06-15', signal_type: 'golden_cross', price: 476.50 }, ...]

const markersPlugin = createSeriesMarkers(candlestickSeries, {
  autoScale: true,
  zOrder: 'aboveSeries',
});

markersPlugin.setMarkers(signals.map(s => {
  const isBuy = s.signal_type === 'golden_cross';
  return {
    time: s.triggered_date,
    position: isBuy ? 'belowBar' : 'aboveBar',
    color: isBuy ? '#4caf50' : '#f44336',
    shape: isBuy ? 'arrowUp' : 'arrowDown',
    text: isBuy ? '金叉' : '死叉',
    size: s.strength === 'strong' ? 2 : 1,
  };
}));
```

### 6.4 Volume Sub-Chart

```typescript
import { HistogramSeries } from 'lightweight-charts';

const volumeSeries = chart.addSeries(HistogramSeries, {
  color: '#26a69a50',
  priceFormat: { type: 'volume' },
  priceScaleId: 'volume',
}, 1); // pane 1 = volume pane

const volumeData = kline.map((d, i) => {
  const isUp = i > 0 ? d.close >= kline[i - 1].close : d.close >= d.open;
  return {
    time: d.time || d.trade_date,
    value: Number(d.volume),
    color: isUp ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)',
  };
});
volumeSeries.setData(volumeData);

// Set pane heights
chart.panes()[0].setHeight(350);
chart.panes()[1].setHeight(120);
```

### 6.5 Real-Time Price Update (WebSocket)

```typescript
function useRealtimeKline(
  chart: IChartApi,
  candlestickSeries: ISeriesApi<'Candlestick'>,
  volumeSeries: ISeriesApi<'Histogram'>,
  ma20Series: ISeriesApi<'Line'>,
  ma60Series: ISeriesApi<'Line'>,
  symbol: string,
) {
  useEffect(() => {
    const ws = new WebSocket(`wss://api.trend-scope.com/ws/${symbol}`);

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === 'tick') {
        // Update last candle in real-time
        const bar: CandlestickData = {
          time: msg.time, // '2024-12-15'
          open: msg.open,
          high: msg.high,
          low: msg.low,
          close: msg.close,
        };
        candlestickSeries.update(bar);

        // Update volume
        volumeSeries.update({ time: msg.time, value: msg.volume });

        // Update MAs (recomputed server-side and pushed)
        if (msg.ma20 !== undefined) {
          ma20Series.update({ time: msg.time, value: msg.ma20 });
        }
        if (msg.ma60 !== undefined) {
          ma60Series.update({ time: msg.time, value: msg.ma60 });
        }
      }

      if (msg.type === 'signal') {
        // New signal detected — update markers
        const plugin = createSeriesMarkers(candlestickSeries);
        plugin.setMarkers(msg.markers);
      }
    };

    ws.onerror = (err) => console.error('WebSocket error:', err);

    return () => ws.close();
  }, [symbol]);
}
```

### 6.6 Complete KlineChart Component (Next.js Ready)

```tsx
// admin/src/components/charts/KlineChart.tsx
'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from 'antd';

const KlineChartInner = dynamic(() => import('./KlineChartInner'), {
  ssr: false,
  loading: () => (
    <div style={{ width: '100%', height: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Skeleton active paragraph={{ rows: 8 }} />
    </div>
  ),
});

export default function KlineChart(props: {
  data: any[];
  indicators: any[];
  volume: any[];
  signals: any[];
  theme?: 'dark' | 'light';
}) {
  const { data, indicators, volume, signals, theme = 'dark' } = props;

  const ma20Data = indicators.map((d: any) => ({ time: d.trade_date, value: d.ma20 })).filter((d: any) => d.value != null);
  const ma60Data = indicators.map((d: any) => ({ time: d.trade_date, value: d.ma60 })).filter((d: any) => d.value != null);
  const volumeData = volume.map((d: any, i: number) => ({
    time: d.trade_date,
    value: d.volume,
    color: i > 0 ? (d.close >= volume[i - 1].close ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)') : 'rgba(38,166,154,0.5)',
  }));

  const markers = signals.map((s: any) => ({
    time: s.triggered_date,
    position: s.signal_type === 'golden_cross' ? 'belowBar' : 'aboveBar',
    color: s.signal_type === 'golden_cross' ? '#4caf50' : '#f44336',
    shape: s.signal_type === 'golden_cross' ? 'arrowUp' : 'arrowDown',
    text: s.signal_type === 'golden_cross' ? '金叉' : '死叉',
    size: s.strength === 'strong' ? 2 : 1,
  }));

  return (
    <KlineChartInner
      data={data.map((d: any) => ({
        time: d.trade_date,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      }))}
      ma20Data={ma20Data}
      ma60Data={ma60Data}
      volumeData={volumeData}
      markers={markers}
      theme={theme}
    />
  );
}
```

---

## 7. Summary & Decision

### Why Lightweight Charts Is the Right Choice

| Factor | Assessment |
|---|---|
| **Cost** | $0. Apache 2.0 — no licensing fees, no vendor lock-in. |
| **Size** | 60 kB gzipped — faster than a typical hero image. Won't bloat the Next.js bundle. |
| **Performance** | Canvas-based. Renders thousands of candles at 60fps. `update()` patches in-place for real-time streaming. |
| **Focus** | Designed specifically for financial K-line charts. The API models financial concepts natively (candlestick, OHLC, crosshair, time scale, price scale). |
| **TypeScript** | First-class TS. All types exported. `CandlestickData`, `Time`, `SeriesMarker` — no guessing. |
| **Extensibility** | Plugin architecture (markers, watermarks, primitives, custom series). Room to grow. |
| **Attribution** | Built-in `attributionLogo` option satisfies the Apache 2.0 NOTICE requirement — no custom branding code needed. |

### Known Limitations (and Mitigations)

| Limitation | Mitigation |
|---|---|
| No built-in indicators | Compute server-side (Python/pandas) or client-side. Returns precise control over formulas. |
| No drawing tools | Out of scope for Phase 1. Can implement via pane primitives later. |
| Time period = data responsibility | Backend aggregates daily/weekly/monthly. This is actually a feature — you control the pipeline. |
| Manual resize handling | Trivial with ResizeObserver. 10 lines of code. |
| No SSR | Dynamic import `{ ssr: false }` — standard Next.js pattern for Canvas libs. |

### Integration Path for Trend-Scope

```
Backend (FastAPI)
  ├── /api/v1/stocks/{id}/kline?period=day&limit=200
  │   → Returns OHLC data + pre-computed MA20/MA60/RSI
  ├── /api/v1/analysis/{stock_id}/latest
  │   → Returns signal markers (golden_cross, death_cross)
  └── WebSocket /ws/{symbol}
      → Streams real-time ticks + updated indicators

Frontend (Next.js /admin)
  └── components/charts/KlineChart.tsx
      ├── dynamic(ssr:false) import
      ├── useRef + useEffect → createChart()
      ├── CandlestickSeries (K-line)
      ├── HistogramSeries (volume, separate pane)
      ├── LineSeries × N (MA20, MA60 — overlay)
      ├── createSeriesMarkers (buy/sell signals)
      └── subscribeCrosshairMove → tooltip state
```

---

## 8. References

- [Lightweight Charts GitHub](https://github.com/tradingview/lightweight-charts)
- [Lightweight Charts Documentation (v5.2)](https://tradingview.github.io/lightweight-charts/)
- [TradingView Product Comparison](https://www.tradingview.com/charting-library-docs/latest/product-comparison/)
- [TradingView Free Charting Libraries](https://www.tradingview.com/free-charting-libraries/)
- [npm: lightweight-charts](https://www.npmjs.com/package/lightweight-charts)
- [Bundlephobia: lightweight-charts](https://bundlephobia.com/result?p=lightweight-charts)
- [Plugin Examples](https://tradingview.github.io/lightweight-charts/plugin-examples/)
- [README.md (latest)](https://github.com/tradingview/lightweight-charts/blob/master/README.md)

---

| Version | Date | Change |
|---|---|---|
| v1 | 2026-06-09 | Initial research — complete library evaluation, comparison, code examples. |
