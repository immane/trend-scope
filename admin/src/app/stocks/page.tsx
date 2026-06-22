"use client";

import { ArrowDownOutlined, ArrowUpOutlined, CloudDownloadOutlined, DeleteOutlined, EditOutlined, StockOutlined, SyncOutlined } from "@ant-design/icons";
import { Button, message, Popconfirm, Space, Table, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import AdminShell from "@/components/layout/AdminShell";
import AuthGuard from "@/components/layout/AuthGuard";
import apiClient from "@/lib/api";
import { formatMoney } from "@/lib/format";
import type { PaginatedResponse, StockSummary } from "@/types/api";

function Sparkline({ data, isPositive }: { data: number[]; isPositive: boolean }) {
  if (data.length < 2) return <Typography.Text type="secondary">--</Typography.Text>;
  const width = 100;
  const height = 30;
  const padding = 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const points = data.map((value, index) => {
    const x = padding + (index / Math.max(data.length - 1, 1)) * (width - padding * 2);
    const y = height - padding - ((value - min) / span) * (height - padding * 2);
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width={width} height={height} className="inline-block align-middle">
      <path d={points} fill="none" stroke={isPositive ? "#059669" : "#dc2626"} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function StocksPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [syncingAll, setSyncingAll] = useState(false);
  const { data, refetch } = useQuery({
    queryKey: ["stocks", page, pageSize],
    queryFn: async () => (await apiClient.get<PaginatedResponse<StockSummary>>("/admin/stocks/summaries", { params: { page, size: pageSize } })).data,
  });

  async function syncAll() {
    setSyncingAll(true);
    message.loading({ content: "正在同步全部标的行情...", key: "syncAll" });
    const { data: result } = await apiClient.post("/admin/stocks/sync-all");
    message.success({ content: `同步完成，共 ${result.total_new_rows} 行新数据`, key: "syncAll" });
    setSyncingAll(false);
    refetch();
  }

  async function syncOne(stockId: number, symbol: string) {
    message.loading({ content: `同步 ${symbol}...`, key: `sync-${stockId}` });
    const { data: result } = await apiClient.post(`/admin/stocks/${stockId}/sync`);
    message.success({ content: `${symbol} +${result.new_rows} 行`, key: `sync-${stockId}` });
    refetch();
  }

  async function handleDelete(stockId: number, symbol: string) {
    await apiClient.delete(`/admin/stocks/${stockId}`);
    message.success(`${symbol} 已停用`);
    refetch();
  }

  return <AuthGuard><AdminShell>
    <Space className="mb-4 w-full justify-between">
      <Typography.Title level={2}>标的管理</Typography.Title>
      <Space>
        <Button icon={<CloudDownloadOutlined />} loading={syncingAll} onClick={syncAll}>同步全部行情</Button>
        <Button type="primary" onClick={() => router.push("/stocks/create")}>新增标的</Button>
      </Space>
    </Space>
    <Table<StockSummary>
      rowKey="id"
      dataSource={data?.items ?? []}
      pagination={{ current: page, pageSize, total: data?.total ?? 0, showSizeChanger: true, showTotal: (total) => `共 ${total} 条`, onChange: (nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize); } }}
      onRow={(record) => ({ onClick: () => router.push(`/stocks/${record.id}`), className: "cursor-pointer" })}
      columns={[
        { title: "Symbol", dataIndex: "symbol", render: (value, record) => <Space><StockOutlined /><strong>{value}</strong><Typography.Text type="secondary">{record.name}</Typography.Text></Space> },
        { title: "类型", dataIndex: "type" },
        { title: "行业", dataIndex: "sector", render: (value) => value ?? "--" },
        {
          title: "现价",
          dataIndex: "latest_price",
          render: (value, record) => {
            if (value == null) return <Typography.Text type="secondary">无行情</Typography.Text>;
            const isUp = (record.change_pct ?? 0) >= 0;
            return (
              <Space direction="vertical" size={0} className="w-full">
                <Typography.Text strong className={isUp ? "text-emerald-600" : "text-rose-600"}>
                  {formatMoney(value)}
                </Typography.Text>
                {record.change_pct != null && (
                  <Typography.Text className={`text-xs ${isUp ? "text-emerald-500" : "text-rose-500"}`}>
                    {isUp ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
                    {` ${Math.abs(record.change_pct * 100).toFixed(2)}%`}
                  </Typography.Text>
                )}
              </Space>
            );
          },
          sorter: (a, b) => (a.latest_price ?? 0) - (b.latest_price ?? 0),
        },
        {
          title: "走势 (15日)",
          dataIndex: "sparkline",
          render: (value: number[], record) => {
            if (!value || value.length < 2) return <Typography.Text type="secondary">--</Typography.Text>;
            return <Sparkline data={value} isPositive={(record.change_pct ?? 0) >= 0} />;
          },
        },
        { title: "状态", dataIndex: "is_active", render: (v) => v ? "启用" : "停用" },
        {
          title: "最后更新",
          dataIndex: "latest_date",
          render: (value) => value ? <Typography.Text type="secondary" className="text-xs">{value}</Typography.Text> : <Typography.Text type="secondary">待同步</Typography.Text>,
        },
        {
          title: "同步",
          render: (_, record) => (
            <Button size="small" icon={<SyncOutlined />} onClick={(e) => { e.stopPropagation(); syncOne(record.id, record.symbol); }}>同步</Button>
          ),
        },
        {
          title: "操作",
          render: (_, record) => (
            <Space size="small">
              <Button size="small" icon={<EditOutlined />} onClick={(e) => { e.stopPropagation(); router.push(`/stocks/${record.id}`); }}>编辑</Button>
              <Popconfirm title={`确认停用 ${record.symbol}？`} onConfirm={() => handleDelete(record.id, record.symbol)} okText="停用" cancelText="取消">
                <Button size="small" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()}>删除</Button>
              </Popconfirm>
            </Space>
          ),
        },
      ]}
    />
  </AdminShell></AuthGuard>;
}
