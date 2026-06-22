"use client";

import { Button, Space, Switch, Table, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import AdminShell from "@/components/layout/AdminShell";
import AuthGuard from "@/components/layout/AuthGuard";
import apiClient from "@/lib/api";
import type { PaginatedResponse, Strategy } from "@/types/api";

export default function StrategiesPage() {
  const router = useRouter();
  const { data, refetch } = useQuery({ queryKey: ["strategies"], queryFn: async () => (await apiClient.get<PaginatedResponse<Strategy>>("/admin/strategies")).data });
  return <AuthGuard><AdminShell><Space className="mb-4 w-full justify-between"><Typography.Title level={2}>策略管理</Typography.Title><Button type="primary" onClick={() => router.push("/strategies/create")}>创建策略</Button></Space><Table rowKey="id" dataSource={data?.items ?? []} pagination={false} columns={[{ title: "名称", dataIndex: "name" }, { title: "类型", dataIndex: "strategy_type" }, { title: "标的", dataIndex: "stock_id" }, { title: "启用", dataIndex: "is_active", render: (value, record) => <Switch checked={value} onChange={async (checked) => { await apiClient.patch(`/admin/strategies/${record.id}`, { is_active: checked }); refetch(); }} /> }, { title: "操作", render: (_, record) => <Button onClick={() => router.push(`/strategies/${record.id}`)}>详情</Button> }]} /></AdminShell></AuthGuard>;
}
