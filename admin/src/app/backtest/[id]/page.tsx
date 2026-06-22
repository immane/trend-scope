"use client";

import { ArrowDownOutlined, ArrowUpOutlined, BarChartOutlined, FundProjectionScreenOutlined, LineChartOutlined, RiseOutlined, SwapOutlined, WarningOutlined } from "@ant-design/icons";
import { Alert, Card, Col, Descriptions, Row, Space, Statistic, Table, Tag, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import AdminShell from "@/components/layout/AdminShell";
import AuthGuard from "@/components/layout/AuthGuard";
import apiClient from "@/lib/api";
import { formatInteger, formatMoney, formatPercent, formatRatio } from "@/lib/format";
import type { BacktestItem, CurvePoint, TradeRecord } from "@/types/api";

function numberValue(value?: string | number | null) {
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function statusTag(status?: string) {
  if (status === "completed") return <Tag color="green">已完成</Tag>;
  if (status === "failed") return <Tag color="red">失败</Tag>;
  return <Tag color="blue">运行中</Tag>;
}

function LineSvg({ points, color, fill, valueLabel }: { points: CurvePoint[]; color: string; fill?: string; valueLabel: (value: number) => string }) {
  const width = 880;
  const height = 260;
  const padding = 36;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (index: number) => padding + (index / Math.max(points.length - 1, 1)) * (width - padding * 2);
  const y = (value: number) => height - padding - ((value - min) / span) * (height - padding * 2);
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(point.value).toFixed(2)}`).join(" ");
  const area = `${path} L${x(points.length - 1).toFixed(2)},${height - padding} L${padding},${height - padding} Z`;
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[720px] rounded-lg bg-slate-950/60">
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#334155" />
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#334155" />
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const value = min + span * tick;
          const yPos = y(value);
          return <g key={tick}><line x1={padding} y1={yPos} x2={width - padding} y2={yPos} stroke="#1e293b" /><text x={8} y={yPos + 4} fontSize="11" fill="#94a3b8">{valueLabel(value)}</text></g>;
        })}
        {fill ? <path d={area} fill={fill} opacity="0.18" /> : null}
        <path d={path} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(0)} cy={y(first.value)} r="4" fill={color} />
        <circle cx={x(points.length - 1)} cy={y(last.value)} r="4" fill={color} />
        <text x={padding} y={height - 10} fontSize="12" fill="#94a3b8">{first.date}</text>
        <text x={width - padding - 92} y={height - 10} fontSize="12" fill="#94a3b8">{last.date}</text>
      </svg>
    </div>
  );
}

function MonthlyBars({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data).slice(-18);
  if (!entries.length) return <Typography.Text type="secondary">暂无月度收益数据</Typography.Text>;
  const maxAbs = Math.max(...entries.map(([, value]) => Math.abs(value)), 0.01);
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {entries.map(([month, value]) => (
        <div key={month} className="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3">
          <div className="mb-2 flex items-center justify-between text-sm"><span className="text-slate-300">{month.slice(0, 7)}</span><strong className={value >= 0 ? "text-emerald-400" : "text-rose-400"}>{formatPercent(value)}</strong></div>
          <div className="h-2 rounded bg-slate-800"><div className={`h-2 rounded ${value >= 0 ? "bg-emerald-500" : "bg-rose-500"}`} style={{ width: `${Math.max(6, (Math.abs(value) / maxAbs) * 100)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

export default function BacktestDetailPage({ params }: { params: { id: string } }) {
  const { data, isLoading } = useQuery({ queryKey: ["backtest", params.id], queryFn: async () => (await apiClient.get<BacktestItem>(`/admin/backtests/${params.id}`)).data });
  const equityPoints = data?.equity_curve?.points ?? [];
  const drawdownPoints = data?.drawdown_curve?.points ?? [];
  const trades = data?.trade_log?.trades ?? [];
  const totalReturn = numberValue(data?.total_return) ?? 0;
  const benchmarkReturn = numberValue(data?.benchmark_return) ?? 0;
  const excessReturn = totalReturn - benchmarkReturn;

  return (
    <AuthGuard><AdminShell>
      <Space direction="vertical" size="large" className="w-full">
        <div>
          <Space wrap>
            <Typography.Title level={2} className="!mb-0">回测详情 #{params.id}</Typography.Title>
            {statusTag(data?.status)}
            {data?.error_message ? <Tag color="red">有错误</Tag> : <Tag color="green">指标已生成</Tag>}
          </Space>
          <Typography.Text type="secondary">清晰标识收益、回撤、风险调整收益和每笔交易，便于判断策略是否真的有效。</Typography.Text>
        </div>

        {data?.error_message ? <Alert type="error" showIcon message="回测执行失败" description={data.error_message} /> : null}

        <Row gutter={[16, 16]}>
          <Col xs={24} md={8} xl={4}><Card><Statistic title="策略总收益率" value={formatPercent(data?.total_return)} prefix={totalReturn >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} valueStyle={{ color: totalReturn >= 0 ? "#10b981" : "#f43f5e" }} /></Card></Col>
          <Col xs={24} md={8} xl={4}><Card><Statistic title="最大回撤" value={formatPercent(data?.max_drawdown)} prefix={<WarningOutlined />} valueStyle={{ color: "#f43f5e" }} /></Card></Col>
          <Col xs={24} md={8} xl={4}><Card><Statistic title="年化收益 CAGR" value={formatPercent(data?.cagr)} prefix={<RiseOutlined />} /></Card></Col>
          <Col xs={24} md={8} xl={4}><Card><Statistic title="Sharpe 夏普比率" value={formatRatio(data?.sharpe_ratio)} prefix={<BarChartOutlined />} /></Card></Col>
          <Col xs={24} md={8} xl={4}><Card><Statistic title="胜率" value={formatPercent(data?.win_rate)} prefix={<FundProjectionScreenOutlined />} /></Card></Col>
          <Col xs={24} md={8} xl={4}><Card><Statistic title="已平仓交易数" value={formatInteger(data?.num_trades)} prefix={<SwapOutlined />} /></Card></Col>
        </Row>

        <Card title="收益对比（策略 vs 买入持有）" extra={<Tag color={excessReturn >= 0 ? "green" : "orange"}>超额收益 {formatPercent(excessReturn)}</Tag>}>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={8}><Statistic title="策略收益" value={formatPercent(data?.total_return)} valueStyle={{ color: totalReturn >= 0 ? "#10b981" : "#f43f5e" }} /></Col>
            <Col xs={24} md={8}><Statistic title="买入持有 Benchmark" value={formatPercent(data?.benchmark_return)} /></Col>
            <Col xs={24} md={8}><Statistic title="初始资金" value={formatMoney(data?.initial_capital)} /></Col>
          </Row>
        </Card>

        <Card title={<Space><LineChartOutlined />权益曲线：账户净值变化</Space>}>
          {equityPoints.length ? <LineSvg points={equityPoints} color="#38bdf8" fill="#38bdf8" valueLabel={(value) => `$${Math.round(value / 1000)}k`} /> : <Typography.Text type="secondary">暂无权益曲线数据</Typography.Text>}
        </Card>

        <Card title={<Space><WarningOutlined />回撤曲线：从历史高点下跌幅度</Space>}>
          {drawdownPoints.length ? <LineSvg points={drawdownPoints} color="#f43f5e" fill="#f43f5e" valueLabel={(value) => formatPercent(value)} /> : <Typography.Text type="secondary">暂无回撤曲线数据</Typography.Text>}
        </Card>

        <Card title="完整分析指标说明">
          <Descriptions bordered column={{ xs: 1, md: 2, xl: 3 }} size="small">
            <Descriptions.Item label="Sortino 索提诺比率">{formatRatio(data?.sortino_ratio)}</Descriptions.Item>
            <Descriptions.Item label="Calmar 卡玛比率">{formatRatio(data?.calmar_ratio)}</Descriptions.Item>
            <Descriptions.Item label="Profit Factor 盈亏比">{formatRatio(data?.profit_factor)}</Descriptions.Item>
            <Descriptions.Item label="滑点设置">{formatPercent(data?.slippage_pct)}</Descriptions.Item>
            <Descriptions.Item label="手续费设置">{formatPercent(data?.commission_pct)}</Descriptions.Item>
            <Descriptions.Item label="执行耗时">{data?.execution_time_ms == null ? "--" : `${formatInteger(data.execution_time_ms)} ms`}</Descriptions.Item>
            <Descriptions.Item label="回测区间">{data?.start_date ?? "--"} 至 {data?.end_date ?? "--"}</Descriptions.Item>
            <Descriptions.Item label="标的">{data?.stock_id == null ? "--" : `${data.stock_symbol || `ID ${data.stock_id}`} (#${data.stock_id})`}</Descriptions.Item>
            <Descriptions.Item label="策略">{data?.config_id == null ? "--" : `${data.strategy_name || `ID ${data.config_id}`} (#${data.config_id})`}</Descriptions.Item>
          </Descriptions>
        </Card>

        <Card title="月度收益分布">
          <MonthlyBars data={data?.monthly_returns ?? {}} />
        </Card>

        <Card title="交易明细（买入/卖出与单笔盈亏）">
          <Table<TradeRecord>
            rowKey={(record, index) => `${record.date}-${record.side}-${index}`}
            dataSource={trades}
            loading={isLoading}
            pagination={{ pageSize: 10 }}
            columns={[
              { title: "交易日期", dataIndex: "date" },
              { title: "方向", dataIndex: "side", render: (side) => side === "buy" ? <Tag color="green">买入</Tag> : <Tag color="red">卖出</Tag> },
              { title: "成交价", dataIndex: "price", render: (value) => formatMoney(value) },
              { title: "单笔盈亏", dataIndex: "pnl", render: (value) => value == null ? "--" : <span className={Number(value) >= 0 ? "text-emerald-600" : "text-rose-600"}>{formatMoney(value)}</span> },
            ]}
          />
        </Card>
      </Space>
    </AdminShell></AuthGuard>
  );
}
