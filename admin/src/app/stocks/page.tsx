"use client";

import { Button, Space, Table, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import AdminShell from "@/components/layout/AdminShell";
import AuthGuard from "@/components/layout/AuthGuard";
import apiClient from "@/lib/api";
import type { PaginatedResponse, Stock } from "@/types/api";

export default function StocksPage() {
  const router = useRouter();
  const { data } = useQuery({ queryKey: ["stocks"], queryFn: async () => (await apiClient.get<PaginatedResponse<Stock>>("/admin/stocks")).data });
  return <AuthGuard><AdminShell>
    <Space className="mb-4 w-full justify-between"><Typography.Title level={2}>标的管理</Typography.Title><Button type="primary" onClick={() => router.push("/stocks/create")}>新增标的</Button></Space>
    <Table rowKey="id" dataSource={data?.items ?? []} pagination={false} onRow={(record) => ({ onClick: () => router.push(`/stocks/${record.id}`) })} columns={[{ title: "Symbol", dataIndex: "symbol" }, { title: "名称", dataIndex: "name" }, { title: "类型", dataIndex: "type" }, { title: "状态", dataIndex: "is_active", render: (v) => v ? "启用" : "停用" }]} />
  </AdminShell></AuthGuard>;
}
