"use client";

import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, EditOutlined, SaveOutlined, SyncOutlined } from "@ant-design/icons";
import { Button, Card, Col, Form, Input, message, Popconfirm, Row, Select, Space, Tag, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import AdminShell from "@/components/layout/AdminShell";
import AuthGuard from "@/components/layout/AuthGuard";
import apiClient from "@/lib/api";
import { formatMoney } from "@/lib/format";
import KlineChart from "./KlineChart";

interface RichQuote {
  id: number; symbol: string; name: string; type: string; market: string; sector: string | null;
  is_active: boolean;
  latest_price: number | null; previous_close: number | null;
  day_open: number | null; day_high: number | null; day_low: number | null;
  volume_latest: number | null; avg_volume_30d: number | null;
  change_1d: number | null; change_1d_pct: number | null;
  fifty_two_week_high: number | null; fifty_two_week_low: number | null;
  total_rows: number; earliest_date: string | null; latest_date: string | null;
  return_1w: number | null; return_1m: number | null; return_3m: number | null;
  return_6m: number | null; return_1y: number | null;
  recent_closes: number[];
}

function RateItem({ label, value }: { label: string; value: number | null }) {
  if (value == null) return <div className="text-center"><div className="text-xs text-slate-400">{label}</div><div className="text-sm text-slate-300">--</div></div>;
  const isUp = value >= 0;
  return (
    <div className="text-center">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`text-sm font-semibold ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
        {isUp ? "+" : ""}{(value * 100).toFixed(2)}%
      </div>
    </div>
  );
}

function Week52Bar({ high, low, current }: { high: number; low: number; current: number }) {
  if (!high || !low || !current) return null;
  const range = high - low || 1;
  const pct = ((current - low) / range) * 100;
  return (
    <div className="rounded bg-slate-800 p-2">
      <div className="mb-1 flex justify-between text-xs text-slate-400"><span>52周最低 ${low.toFixed(2)}</span><span>52周最高 ${high.toFixed(2)}</span></div>
      <div className="relative h-1.5 rounded-full bg-slate-700">
        <div className="absolute h-1.5 rounded-full bg-blue-500" style={{ width: `${Math.max(2, Math.min(98, pct))}%`, left: `${Math.max(0, Math.min(98, pct - 2))}%` }}>
          <div className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full border-2 border-white bg-blue-500" />
        </div>
      </div>
      <div className="mt-0.5 text-center text-xs text-slate-400">当前 ${current.toFixed(2)} ({pct.toFixed(0)}% 位置)</div>
    </div>
  );
}

export default function StockDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [form] = Form.useForm();
  const { data: quote } = useQuery({ queryKey: ["quote", params.id], queryFn: async () => (await apiClient.get<RichQuote>(`/stocks/${params.id}/quote`)).data });

  async function sync() {
    message.loading({ content: `同步 ${quote?.symbol}...`, key: "syncStock" });
    const { data } = await apiClient.post(`/admin/stocks/${params.id}/sync`);
    message.success({ content: `同步完成，+${data.new_rows} 行`, key: "syncStock" });
  }

  function startEdit() {
    if (!quote) return;
    form.setFieldsValue({ name: quote.name, sector: quote.sector, type: quote.type });
    setEditing(true);
  }

  async function saveEdit() {
    const values = await form.validateFields();
    await apiClient.patch(`/admin/stocks/${params.id}`, values);
    setEditing(false);
    message.success("已保存");
  }

  async function handleDelete() {
    await apiClient.delete(`/admin/stocks/${params.id}`);
    message.success(`${quote?.symbol} 已停用`);
    router.push("/stocks");
  }

  const isUp = (quote?.change_1d_pct ?? 0) >= 0;
  const changeColor = isUp ? "text-emerald-400" : "text-rose-400";

  return (
    <AuthGuard><AdminShell>
      {/* ---- Header ---- */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Space align="center">
            <Typography.Title level={2} className="!mb-0 !text-white">{quote?.symbol}</Typography.Title>
            <Tag color={quote?.is_active ? "green" : "red"}>{quote?.is_active ? "启用" : "停用"}</Tag>
          </Space>
          <div className="mt-1 flex items-center gap-2 text-sm text-slate-400">
            <span>{quote?.name}</span>
            <span>·</span>
            <Tag className="!m-0" color="default">{quote?.market}</Tag>
            <Tag className="!m-0" color="blue">{quote?.type}</Tag>
            {quote?.sector && <Tag className="!m-0">{quote.sector}</Tag>}
          </div>
        </div>
        <Space>
          <Button icon={<SyncOutlined />} onClick={sync}>同步行情</Button>
          <Button icon={<EditOutlined />} onClick={startEdit}>编辑</Button>
          <Popconfirm title="确认停用此标的？" onConfirm={handleDelete} okText="停用" cancelText="取消">
            <Button danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      </div>

      {editing && (
        <Card className="mb-4 bg-slate-800" title="编辑标的信息">
          <Form form={form} layout="inline">
            <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="type" label="类型"><Select options={["ETF", "Stock", "Index"].map((v) => ({ value: v, label: v }))} /></Form.Item>
            <Form.Item name="sector" label="行业"><Input /></Form.Item>
            <Space><Button type="primary" icon={<SaveOutlined />} onClick={saveEdit}>保存</Button><Button onClick={() => setEditing(false)}>取消</Button></Space>
          </Form>
        </Card>
      )}

      {/* ---- Price & Change ---- */}
      <div className="mb-4 rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 p-5">
        <div className="flex flex-wrap items-baseline gap-4">
          <span className="text-4xl font-bold text-white">
            {quote?.latest_price != null ? formatMoney(quote.latest_price) : "--"}
          </span>
          {quote?.change_1d != null && (
            <span className={`flex items-center gap-1 text-xl font-semibold ${changeColor}`}>
              {isUp ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
              {quote.change_1d >= 0 ? "+" : ""}{quote.change_1d?.toFixed(2)}
            </span>
          )}
          {quote?.change_1d_pct != null && (
            <span className={`text-lg font-medium ${changeColor}`}>
              ({isUp ? "+" : ""}{(quote.change_1d_pct * 100).toFixed(2)}%)
            </span>
          )}
          {quote?.latest_date && (
            <span className="ml-auto text-xs text-slate-400">数据截至 {quote.latest_date}</span>
          )}
        </div>
      </div>

      {/* ---- Key Stats Row ---- */}
      <Row gutter={[12, 12]} className="mb-4">
        {([
          ["今日开盘", quote?.day_open, formatMoney] as const,
          ["今日最高", quote?.day_high, formatMoney] as const,
          ["今日最低", quote?.day_low, formatMoney] as const,
          ["昨收", quote?.previous_close, formatMoney] as const,
        ]).map(([label, value, fmt]) => (
          <Col key={label} xs={12} md={6} lg={3}>
            <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3 shadow-sm">
              <div className="text-xs text-slate-400">{label}</div>
              <div className="text-base font-semibold text-slate-100">{fmt(value ?? null)}</div>
            </div>
          </Col>
        ))}
        {([
          ["成交量", quote?.volume_latest] as const,
          ["30日均量", quote?.avg_volume_30d] as const,
        ]).map(([label, value]) => (
          <Col key={label as string} xs={12} md={6} lg={3}>
            <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3 shadow-sm">
              <div className="text-xs text-slate-400">{label}</div>
              <div className="text-base font-semibold text-slate-100">{value != null ? value.toLocaleString() : "--"}</div>
            </div>
          </Col>
        ))}
        <Col xs={24} md={12} lg={6}>
          <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3 shadow-sm">
            <div className="text-xs text-slate-400">数据量</div>
            <div className="text-base font-semibold text-slate-100">{quote?.total_rows != null ? `${quote.total_rows} 个交易日` : "--"}</div>
            <div className="text-xs text-slate-400">{quote?.earliest_date ?? "--"} ~ {quote?.latest_date ?? "--"}</div>
          </div>
        </Col>
      </Row>

      {/* ---- 52w range + period returns ---- */}
      <Row gutter={[12, 12]} className="mb-4">
        <Col xs={24} lg={14}>
          <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 p-4 shadow-sm">
            <div className="mb-3 text-sm font-semibold text-slate-200">52 周价格区间</div>
            {quote?.fifty_two_week_high && quote.fifty_two_week_low && quote.latest_price ? (
              <Week52Bar high={quote.fifty_two_week_high} low={quote.fifty_two_week_low} current={quote.latest_price} />
            ) : <div className="text-sm text-slate-400">数据不足，需要至少 1 年历史行情。</div>}
          </div>
        </Col>
        <Col xs={24} lg={10}>
          <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 p-4 shadow-sm">
            <div className="mb-3 text-sm font-semibold text-slate-200">各周期表现</div>
            <div className="grid grid-cols-5 gap-2">
              <RateItem label="1周" value={quote?.return_1w ?? null} />
              <RateItem label="1月" value={quote?.return_1m ?? null} />
              <RateItem label="3月" value={quote?.return_3m ?? null} />
              <RateItem label="6月" value={quote?.return_6m ?? null} />
              <RateItem label="1年" value={quote?.return_1y ?? null} />
            </div>
          </div>
        </Col>
      </Row>

      {/* ---- Chart ---- */}
      <KlineChart stockId={params.id} />
    </AdminShell></AuthGuard>
  );
}
