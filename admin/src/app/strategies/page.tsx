"use client";

import { Button, Space, Switch, Table, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import AdminShell from "@/components/layout/AdminShell";
import AuthGuard from "@/components/layout/AuthGuard";
import apiClient from "@/lib/api";
import type { PaginatedResponse, Strategy } from "@/types/api";

export default function StrategiesPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const { data, refetch } = useQuery({ queryKey: ["strategies", page, pageSize], queryFn: async () => (await apiClient.get<PaginatedResponse<Strategy>>("/admin/strategies", { params: { page, size: pageSize } })).data });
  return <AuthGuard><AdminShell><Space className="mb-4 w-full justify-between"><Typography.Title level={2}>策略管理</Typography.Title><Button type="primary" onClick={() => router.push("/strategies/create")}>创建策略</Button></Space><Table rowKey="id" dataSource={data?.items ?? []} pagination={{ current: page, pageSize, total: data?.total ?? 0, showSizeChanger: true, showTotal: (total) => `共 ${total} 条`, onChange: (nextPage, nextSize) => { setPage(nextPage); if (nextSize !== pageSize) { setPageSize(nextSize); setPage(1); } } }} columns={[{ title: "名称", dataIndex: "name" }, { title: "类型", dataIndex: "strategy_type" }, { title: "标的", dataIndex: "stock_id" }, { title: "启用", dataIndex: "is_active", render: (value, record) => <Switch checked={value} onChange={async (checked) => { await apiClient.patch(`/admin/strategies/${record.id}`, { is_active: checked }); refetch(); }} /> }, { title: "操作", render: (_, record) => <Button onClick={() => router.push(`/strategies/${record.id}`)}>详情</Button> }]} /></AdminShell></AuthGuard>;
}
