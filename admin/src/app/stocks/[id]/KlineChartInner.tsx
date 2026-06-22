"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, ColorType, CandlestickSeries, HistogramSeries, LineSeries, CrosshairMode, type Time } from "lightweight-charts";
import apiClient from "@/lib/api";

interface KlinePoint {
  time: string;
  open: number; high: number; low: number; close: number; volume: number;
  ma5: number | null; ma10: number | null; ma20: number | null; ma60: number | null; ma120: number | null;
  macd_dif: number | null; macd_dea: number | null; macd_hist: number | null;
}

const RANGES = [
  { label: "1月", limit: 22 },
  { label: "3月", limit: 66 },
  { label: "6月", limit: 132 },
  { label: "1年", limit: 252 },
  { label: "2年", limit: 500 },
];

const MA_COLORS: Record<string, string> = {
  ma5: "#f59e0b", ma10: "#8b5cf6", ma20: "#2563eb", ma60: "#ea580c", ma120: "#059669",
};

export default function KlineChartInner({ stockId }: { stockId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<KlinePoint[]>([]);
  const [limit, setLimit] = useState(252);
  const [loading, setLoading] = useState(true);
  const last = data[data.length - 1];
  const prev = data.length > 1 ? data[data.length - 2] : null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiClient.get<{ data: KlinePoint[] }>(`/stocks/${stockId}/kline?limit=${limit}`).then(({ data: resp }) => {
      if (cancelled) return;
      setData(resp.data);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [stockId, limit]);

  useEffect(() => {
    if (!containerRef.current || !data.length) return;
    const container = containerRef.current;
    container.innerHTML = "";

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 640,
      layout: { background: { type: ColorType.Solid, color: "#0f172a" }, textColor: "#94a3b8" },
      grid: { vertLines: { color: "rgba(148,163,184,0.08)" }, horzLines: { color: "rgba(148,163,184,0.08)" } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "#475569", style: 2, labelBackgroundColor: "#1e293b" }, horzLine: { color: "#475569", style: 2, labelBackgroundColor: "#1e293b" } },
      rightPriceScale: { borderColor: "rgba(148,163,184,0.2)" },
      timeScale: { borderColor: "rgba(148,163,184,0.2)", timeVisible: true, secondsVisible: false },
    });

    const makeTime = (t: string): Time => t as Time;

    // === PANE 1: Candles + MAs on main (right) price scale ===
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#00b894", downColor: "#e74c3c",
      borderUpColor: "#00b894", borderDownColor: "#e74c3c",
      wickUpColor: "#00b894", wickDownColor: "#e74c3c",
    });
    candleSeries.setData(data.map((d) => ({ time: makeTime(d.time), open: d.open, high: d.high, low: d.low, close: d.close })));

    // MA overlays
    for (const [key, color] of Object.entries(MA_COLORS)) {
      const series = chart.addSeries(LineSeries, { color, lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false });
      const k = key as keyof KlinePoint;
      const pts = data.filter((d) => d[k] != null).map((d) => ({ time: makeTime(d.time), value: Number(d[k]) }));
      if (pts.length) series.setData(pts);
    }

    // === PANE 2: Volume (separate price scale, invisible) ===
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.86, bottom: 0 } });
    volumeSeries.setData(data.map((d) => ({
      time: makeTime(d.time),
      value: d.volume,
      color: d.close >= d.open ? "rgba(0,184,148,0.3)" : "rgba(231,76,60,0.3)",
    })));

    // === PANE 3: MACD (separate price scale) ===
    const macdHistSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: "macd",
      priceFormat: { precision: 4 },
    });
    chart.priceScale("macd").applyOptions({ scaleMargins: { top: 0.92, bottom: 0 } });

    const macdDifSeries = chart.addSeries(LineSeries, {
      priceScaleId: "macd",
      color: "#f59e0b",
      lineWidth: 1,
      priceFormat: { precision: 4 },
      crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
    });
    const macdDeaSeries = chart.addSeries(LineSeries, {
      priceScaleId: "macd",
      color: "#60a5fa",
      lineWidth: 1,
      priceFormat: { precision: 4 },
      crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
    });

    macdHistSeries.setData(data.filter((d) => d.macd_hist != null).map((d) => ({
      time: makeTime(d.time),
      value: d.macd_hist!,
      color: d.macd_hist! >= 0 ? "rgba(0,184,148,0.6)" : "rgba(231,76,60,0.6)",
    })));
    macdDifSeries.setData(data.filter((d) => d.macd_dif != null).map((d) => ({ time: makeTime(d.time), value: d.macd_dif! })));
    macdDeaSeries.setData(data.filter((d) => d.macd_dea != null).map((d) => ({ time: makeTime(d.time), value: d.macd_dea! })));

    chart.timeScale().fitContent();
    const handleResize = () => chart.applyOptions({ width: container.clientWidth });
    window.addEventListener("resize", handleResize);
    return () => { window.removeEventListener("resize", handleResize); chart.remove(); };
  }, [data]);

  const changePct = last && prev ? ((last.close - prev.close) / prev.close * 100) : null;
  const isUp = changePct ? Number(changePct) >= 0 : true;

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 px-4 py-2">
        <div className="flex items-center gap-4">
          {last ? (
            <>
              <span className="text-2xl font-bold text-white">${last.close.toFixed(2)}</span>
              <span className={`text-sm font-semibold ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
                {isUp ? "+" : ""}{changePct}%
              </span>
              <span className="hidden text-xs text-slate-400 md:inline">
                O <span className="text-slate-200">${last.open.toFixed(2)}</span>
                {"  "}H <span className="text-slate-200">${last.high.toFixed(2)}</span>
                {"  "}L <span className="text-slate-200">${last.low.toFixed(2)}</span>
                {"  "}C <span className="text-slate-200">${last.close.toFixed(2)}</span>
              </span>
            </>
          ) : loading ? (
            <span className="text-sm text-slate-400">加载中...</span>
          ) : null}
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button key={r.limit} onClick={() => setLimit(r.limit)}
              className={`rounded px-3 py-1 text-xs font-medium ${limit === r.limit ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
            >{r.label}</button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-slate-700/50 px-4 py-1 text-[11px]">
        {Object.entries(MA_COLORS).map(([key, color]) => (
          <span key={key} className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: color }} />
            <span className="text-slate-400">{key.toUpperCase()}</span>
            <span className="text-slate-200">{last?.[key as keyof KlinePoint] != null ? Number(last[key as keyof KlinePoint]).toFixed(2) : "--"}</span>
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 rounded bg-amber-400" /><span className="text-slate-400">DIF</span>
          <span className="text-slate-200">{last?.macd_dif?.toFixed(4) ?? "--"}</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 rounded bg-blue-400" /><span className="text-slate-400">DEA</span>
          <span className="text-slate-200">{last?.macd_dea?.toFixed(4) ?? "--"}</span>
        </span>
        <span className="ml-auto text-slate-400">成交量 <span className="text-slate-300">{last?.volume?.toLocaleString() ?? "--"}</span></span>
      </div>

      {/* Chart */}
      <div ref={containerRef} className="w-full" style={{ minHeight: 640 }} />
    </div>
  );
}
