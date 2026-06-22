"use client";

import { Button, Select, Space, Table, Tag, Typography, message } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import AdminShell from "@/components/layout/AdminShell";
import AuthGuard from "@/components/layout/AuthGuard";
import apiClient from "@/lib/api";
import { dateDesc, sortByDateDesc } from "@/lib/sort";
import type { PaginatedResponse, Signal } from "@/types/api";

export default function SignalsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const { data, refetch } = useQuery({
    queryKey: ["signals", page, pageSize, typeFilter],
    queryFn: async () => (await apiClient.get<PaginatedResponse<Signal>>("/admin/signals", { params: { page, size: pageSize, signal_type: typeFilter } })).data,
  });
  return <AuthGuard><AdminShell>
    <Space className="mb-4 w-full justify-between">
      <div><Typography.Title level={2}>信号</Typography.Title><Typography.Text type="secondary">点击信号行查看详情和 AI 分析。</Typography.Text></div>
    </Space>
    <Space className="mb-4">
      <Select allowClear className="w-28" placeholder="类型" value={typeFilter} onChange={(v) => { setTypeFilter(v || null); setPage(1); }}
        options={[{ value: "buy", label: "买入" }, { value: "sell", label: "卖出" }]} />
    </Space>
    <Table rowKey="id" dataSource={sortByDateDesc(data?.items ?? [], (item) => item.triggered_date)}
      onRow={(record) => ({ onClick: () => router.push(`/signals/${record.id}`), className: "cursor-pointer" })}
      pagination={{ current: page, pageSize, total: data?.total ?? 0, showSizeChanger: true, showTotal: (total) => `共 ${total} 条`, onChange: (nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize); } }}
      columns={[
        { title: "ID", dataIndex: "id" },
        { title: "Stock", dataIndex: "stock_id" },
        { title: "策略", dataIndex: "config_id" },
        { title: "类型", dataIndex: "signal_type", render: (v) => <Tag color={v === "buy" ? "green" : "red"}>{v === "buy" ? "买入" : "卖出"}</Tag> },
        { title: "价格", dataIndex: "trigger_price" },
        { title: "日期", dataIndex: "triggered_date", defaultSortOrder: "descend", sorter: (a, b) => -dateDesc(a.triggered_date, b.triggered_date) },
        { title: "操作", render: (_, record) => (
          <Space size="small" onClick={(e) => e.stopPropagation()}>
            <Button size="small" onClick={async () => { await apiClient.post(`/analysis/signals/${record.id}/ai`); message.success("AI 分析已生成"); }}>生成分析</Button>
            <Button size="small" danger onClick={async () => { await apiClient.patch(`/admin/strategies/${record.config_id}`, { is_active: false }); message.success("已停用"); refetch(); }}>停用信号</Button>
          </Space>
        )},
      ]}
    />
  </AdminShell></AuthGuard>;
}
