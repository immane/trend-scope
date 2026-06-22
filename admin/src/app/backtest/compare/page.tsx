"use client";

import { Alert, Card, Col, Row, Space, Statistic, Table, Tag, Typography } from "antd";
import { useQueries } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import AdminShell from "@/components/layout/AdminShell";
import AuthGuard from "@/components/layout/AuthGuard";
import apiClient from "@/lib/api";
import type { BacktestItem, CurvePoint } from "@/types/api";

const colors = ["#2563eb", "#dc2626", "#059669", "#7c3aed", "#ea580c", "#0891b2", "#be123c", "#4d7c0f", "#9333ea", "#0f766e", "#ca8a04"];

function numberValue(value?: string | number | null) {
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function percentText(value?: string | number | null) {
  const numeric = numberValue(value);
  return numeric == null ? "--" : `${(numeric * 100).toFixed(2)}%`;
}

function decimalText(value?: string | number | null) {
  const numeric = numberValue(value);
  return numeric == null ? "--" : numeric.toFixed(2);
}

function normalizeEquity(points: CurvePoint[]) {
  if (!points.length) return [];
  const first = points[0].value || 1;
  return points.map((point) => ({ date: point.date, value: point.value / first - 1 }));
}

function MultiLineChart({ series, valueLabel }: { series: Array<{ name: string; color: string; points: CurvePoint[] }>; valueLabel: (value: number) => string }) {
  const width = 920;
  const height = 320;
  const padding = 42;
  const allPoints = series.flatMap((item) => item.points);
  if (!allPoints.length) return <Typography.Text type="secondary">暂无曲线数据</Typography.Text>;
  const values = allPoints.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (index: number, total: number) => padding + (index / Math.max(total - 1, 1)) * (width - padding * 2);
  const y = (value: number) => height - padding - ((value - min) / span) * (height - padding * 2);

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[760px] rounded-lg bg-white">
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#e2e8f0" />
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#e2e8f0" />
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const value = min + span * tick;
          const yPos = y(value);
          return <g key={tick}><line x1={padding} y1={yPos} x2={width - padding} y2={yPos} stroke="#f1f5f9" /><text x={6} y={yPos + 4} fontSize="11" fill="#64748b">{valueLabel(value)}</text></g>;
        })}
        {series.map((item) => {
          const path = item.points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index, item.points.length).toFixed(2)},${y(point.value).toFixed(2)}`).join(" ");
          return <path key={item.name} d={path} fill="none" stroke={item.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />;
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
          <Col xs={24} md={8}><Card><Statistic title="最佳策略收益" value={best ? percentText(best.total_return) : "--"} /></Card></Col>
          <Col xs={24} md={8}><Card><Statistic title="最佳回测 ID" value={best ? `#${best.id}` : "--"} /></Card></Col>
        </Row>

        <Card title="归一化收益曲线（起点统一为 0%，便于比较）" extra={<Space wrap>{completed.map((item, index) => <Tag key={item.id} color={colors[index % colors.length]}>#{item.id} 策略 {item.config_id}</Tag>)}</Space>}>
          <MultiLineChart series={normalizedSeries} valueLabel={percentText} />
        </Card>

        <Card title="最大回撤过程对比（越接近 0 越好）">
          <MultiLineChart series={drawdownSeries} valueLabel={percentText} />
        </Card>

        <Card title="指标对比表">
          <Table
            rowKey="id"
            dataSource={completed}
            pagination={false}
            columns={[
              { title: "回测 ID", dataIndex: "id", render: (id) => `#${id}` },
              { title: "标的 ID", dataIndex: "stock_id" },
              { title: "策略 ID", dataIndex: "config_id" },
              { title: "区间", render: (_, row) => `${row.start_date} 至 ${row.end_date}` },
              { title: "总收益", dataIndex: "total_return", render: percentText, sorter: (a, b) => (numberValue(a.total_return) ?? 0) - (numberValue(b.total_return) ?? 0) },
              { title: "Benchmark", dataIndex: "benchmark_return", render: percentText },
              { title: "最大回撤", dataIndex: "max_drawdown", render: percentText, sorter: (a, b) => (numberValue(a.max_drawdown) ?? 0) - (numberValue(b.max_drawdown) ?? 0) },
              { title: "Sharpe", dataIndex: "sharpe_ratio", render: decimalText },
              { title: "胜率", dataIndex: "win_rate", render: percentText },
              { title: "交易次数", dataIndex: "num_trades" },
              { title: "盈亏比", dataIndex: "profit_factor", render: decimalText },
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
