"use client";

import { Input, Select, Space, Switch, Table, Tag, Typography, message } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import AdminShell from "@/components/layout/AdminShell";
import AuthGuard from "@/components/layout/AuthGuard";
import apiClient from "@/lib/api";
import { dateDesc, sortByDateDesc } from "@/lib/sort";
import type { PaginatedResponse } from "@/types/api";

interface RuleItem {
  id: number; user_id: number; stock_id: number; alert_type: string;
  is_active: boolean; user_email: string | null; stock_symbol: string | null;
  created_at: string; updated_at: string;
}

export default function RulesPage() {
  const [page, setPage] = useState(1);
  const [userId, setUserId] = useState<string>("");
  const [activeFilter, setActiveFilter] = useState<boolean | null>(null);
  const { data, refetch } = useQuery({
    queryKey: ["rules", page, userId, activeFilter],
    queryFn: async () => (await apiClient.get<PaginatedResponse<RuleItem>>("/admin/rules", { params: { page, size: 20, user_id: userId || undefined, is_active: activeFilter } })).data,
  });

  async function toggle(id: number, checked: boolean) {
    await apiClient.patch(`/admin/rules/${id}`, { is_active: checked });
    message.success(checked ? "已启用" : "已停用");
    refetch();
  }

  return (
    <AuthGuard><AdminShell>
      <Space className="mb-4 w-full justify-between"><div><Typography.Title level={2}>提醒规则管理</Typography.Title><Typography.Text type="secondary">查看和管理所有用户的提醒规则。</Typography.Text></div></Space>
      <Space className="mb-4">
        <Input className="w-32" placeholder="用户 ID" value={userId} onChange={(e) => { setUserId(e.target.value); setPage(1); }} allowClear />
        <Select className="w-28" allowClear placeholder="状态" value={activeFilter} onChange={(v) => { setActiveFilter(v ?? null); setPage(1); }} options={[{ value: true, label: "已启用" }, { value: false, label: "已停用" }]} />
      </Space>
      <Table<RuleItem> rowKey="id" dataSource={sortByDateDesc(data?.items ?? [], (item) => item.created_at)}
        pagination={{ current: page, pageSize: 20, total: data?.total ?? 0, showTotal: (total) => `共 ${total} 条`, onChange: (p) => setPage(p) }}
        columns={[
          { title: "ID", dataIndex: "id" },
          { title: "用户", dataIndex: "user_id", render: (v, r) => <Space><span>{v}</span><Typography.Text type="secondary">{r.user_email}</Typography.Text></Space> },
          { title: "标的", dataIndex: "stock_id", render: (v, r) => r.stock_symbol ?? `#${v}` },
          { title: "类型", dataIndex: "alert_type", render: (v) => v === "buy_signal" ? <Tag color="green">仅买入</Tag> : v === "sell_signal" ? <Tag color="red">仅卖出</Tag> : <Tag>任意信号</Tag> },
          { title: "启用", dataIndex: "is_active", render: (v, r) => <Switch checked={v} onChange={(checked) => toggle(r.id, checked)} /> },
          { title: "创建时间", dataIndex: "created_at", defaultSortOrder: "descend", sorter: (a, b) => -dateDesc(a.created_at, b.created_at) },
        ]}
      />
    </AdminShell></AuthGuard>
  );
}
