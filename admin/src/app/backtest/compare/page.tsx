"use client";

import { Alert, Card, Col, Row, Space, Statistic, Table, Tag, Typography } from "antd";
import { useQueries } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import AdminShell from "@/components/layout/AdminShell";
import AuthGuard from "@/components/layout/AuthGuard";
import apiClient from "@/lib/api";
import { formatPercent, formatRatio } from "@/lib/format";
import { dateDesc, sortByDateDesc } from "@/lib/sort";
import type { BacktestItem, CurvePoint } from "@/types/api";

const colors = ["#38bdf8", "#f43f5e", "#10b981", "#d6a84f", "#a78bfa", "#22d3ee", "#fb7185", "#84cc16", "#f59e0b", "#14b8a6", "#eab308"];

function numberValue(value?: string | number | null) {
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeEquity(points: CurvePoint[]) {
  if (!points.length) return [];
  const first = points[0].value || 1;
  return points.map((point) => ({ date: point.date, value: point.value / first - 1 }));
}

function MultiLineChart({ series, valueLabel }: { series: Array<{ name: string; color: string; points: CurvePoint[] }>; valueLabel: (value: number) => string }) {
  const width = 1040;
  const height = 380;
  const pad = { top: 28, right: 38, bottom: 54, left: 76 };
  const allPoints = series.flatMap((item) => item.points);
  if (!allPoints.length) return <Typography.Text type="secondary">暂无曲线数据</Typography.Text>;
  const values = allPoints.map((point) => point.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const range = rawMax - rawMin || Math.max(Math.abs(rawMax), 1);
  const min = rawMin - range * 0.08;
  const max = rawMax + range * 0.08;
  const span = max - min || 1;
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const x = (index: number, total: number) => pad.left + (index / Math.max(total - 1, 1)) * chartWidth;
  const y = (value: number) => pad.top + (1 - (value - min) / span) * chartHeight;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((tick) => min + span * tick);
  const longest = series.reduce((winner, item) => (item.points.length > winner.points.length ? item : winner), series[0]);
  const dateTicks = Array.from(new Set([0, 0.25, 0.5, 0.75, 1].map((tick) => Math.min(longest.points.length - 1, Math.round((longest.points.length - 1) * tick)))));
  const zeroY = min < 0 && max > 0 ? y(0) : null;

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-700/70 bg-slate-950/70 p-3 shadow-inner shadow-black/30">
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[820px]">
        <defs>
          <linearGradient id="compare-chart-bg" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#020617" />
            <stop offset="58%" stopColor="#08111f" />
            <stop offset="100%" stopColor="#020617" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width={width} height={height} rx="18" fill="url(#compare-chart-bg)" />
        <rect x={pad.left} y={pad.top} width={chartWidth} height={chartHeight} rx="12" fill="rgba(15,23,42,0.42)" stroke="rgba(71,85,105,0.48)" />
        {ticks.map((value) => {
          const yPos = y(value);
          return <g key={value}><line x1={pad.left} y1={yPos} x2={width - pad.right} y2={yPos} stroke="rgba(51,65,85,0.72)" strokeDasharray="4 8" /><text x={pad.left - 12} y={yPos + 4} textAnchor="end" fontSize="11" fill="#94a3b8">{valueLabel(value)}</text></g>;
        })}
        {dateTicks.map((index) => {
          const xPos = x(index, longest.points.length);
          return <g key={index}><line x1={xPos} y1={pad.top} x2={xPos} y2={pad.top + chartHeight} stroke="rgba(30,41,59,0.7)" /><text x={xPos} y={height - 18} textAnchor="middle" fontSize="11" fill="#64748b">{longest.points[index].date.slice(5)}</text></g>;
        })}
        {zeroY != null ? <line x1={pad.left} y1={zeroY} x2={width - pad.right} y2={zeroY} stroke="#d6a84f" strokeDasharray="6 6" opacity="0.72" /> : null}
        {series.map((item) => {
          const path = item.points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index, item.points.length).toFixed(2)},${y(point.value).toFixed(2)}`).join(" ");
          const last = item.points[item.points.length - 1];
          const lastX = x(item.points.length - 1, item.points.length);
          const lastY = y(last.value);
          return (
            <g key={item.name}>
              <path d={path} fill="none" stroke="rgba(0,0,0,0.38)" strokeWidth="6" strokeLinejoin="round" strokeLinecap="round" />
              <path d={path} fill="none" stroke={item.color} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
              <circle cx={lastX} cy={lastY} r="4.5" fill="#020617" stroke={item.color} strokeWidth="2.4" />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function BacktestCompareContent() {
  const params = useSearchParams();
  const ids = (params.get("ids") || "").split(",").map((id) => Number(id)).filter((id) => Number.isFinite(id));
  const queries = useQueries({
    queries: ids.map((id) => ({ queryKey: ["backtest-compare", id], queryFn: async () => (await apiClient.get<BacktestItem>(`/admin/backtests/${id}`)).data })),
  });
  const backtests = queries.map((query) => query.data).filter(Boolean) as BacktestItem[];
  const completed = backtests.filter((item) => item.status === "completed");
  const best = [...completed].sort((a, b) => (numberValue(b.total_return) ?? -999) - (numberValue(a.total_return) ?? -999))[0];
  const normalizedSeries = completed.map((item, index) => ({ name: `#${item.id}`, color: colors[index % colors.length], points: normalizeEquity(item.equity_curve?.points ?? []) }));
  const drawdownSeries = completed.map((item, index) => ({ name: `#${item.id}`, color: colors[index % colors.length], points: item.drawdown_curve?.points ?? [] }));

  return (
    <AuthGuard><AdminShell>
      <Space direction="vertical" size="large" className="w-full">
        <div>
          <Typography.Title level={2} className="!mb-1">回测对比</Typography.Title>
          <Typography.Text type="secondary">建议选择同一个标的、同一个时间段、不同策略或参数的回测记录进行横向比较。</Typography.Text>
        </div>

        {ids.length < 2 ? <Alert type="warning" showIcon message="请选择至少两个回测记录进行对比" /> : null}

        <Row gutter={[16, 16]}>
          <Col xs={24} md={8}><Card><Statistic title="参与对比数量" value={completed.length} /></Card></Col>
          <Col xs={24} md={8}><Card><Statistic title="最佳策略收益" value={best ? formatPercent(best.total_return) : "--"} /></Card></Col>
          <Col xs={24} md={8}><Card><Statistic title="最佳回测" value={best ? `${best.strategy_name || `ID ${best.id}`} (#${best.id})` : "--"} /></Card></Col>
        </Row>

        <Card title="归一化收益曲线（起点统一为 0%，便于比较）" extra={<Space wrap>{completed.map((item, index) => <Tag key={item.id} color={colors[index % colors.length]}>#{item.id} {item.strategy_name || `策略 ${item.config_id}`}</Tag>)}</Space>}>
          <MultiLineChart series={normalizedSeries} valueLabel={formatPercent} />
        </Card>

        <Card title="最大回撤过程对比（越接近 0 越好）">
          <MultiLineChart series={drawdownSeries} valueLabel={formatPercent} />
        </Card>

        <Card title="指标对比表">
          <Table
            rowKey="id"
            dataSource={sortByDateDesc(completed, (item) => item.end_date)}
            pagination={false}
            columns={[
              { title: "回测 ID", dataIndex: "id", render: (id) => `#${id}` },
              { title: "标的", dataIndex: "stock_id", render: (value, record) => record.stock_symbol ? `${record.stock_symbol} (#${value})` : `#${value}` },
              { title: "策略", dataIndex: "config_id", render: (value, record) => record.strategy_name ? `${record.strategy_name} (#${value})` : `策略 #${value}` },
              { title: "区间", render: (_, row) => `${row.start_date} 至 ${row.end_date}`, defaultSortOrder: "descend", sorter: (a, b) => -dateDesc(a.end_date, b.end_date) },
              { title: "总收益", dataIndex: "total_return", render: formatPercent, sorter: (a, b) => (numberValue(a.total_return) ?? 0) - (numberValue(b.total_return) ?? 0) },
              { title: "Benchmark", dataIndex: "benchmark_return", render: formatPercent },
              { title: "最大回撤", dataIndex: "max_drawdown", render: formatPercent, sorter: (a, b) => (numberValue(a.max_drawdown) ?? 0) - (numberValue(b.max_drawdown) ?? 0) },
              { title: "Sharpe", dataIndex: "sharpe_ratio", render: formatRatio },
              { title: "胜率", dataIndex: "win_rate", render: formatPercent },
              { title: "交易次数", dataIndex: "num_trades" },
              { title: "盈亏比", dataIndex: "profit_factor", render: formatRatio },
            ]}
          />
        </Card>
      </Space>
    </AdminShell></AuthGuard>
  );
}

export default function BacktestComparePage() {
  return (
    <Suspense fallback={null}>
      <BacktestCompareContent />
    </Suspense>
  );
}
