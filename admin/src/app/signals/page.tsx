"use client";

import { Button, Table, Typography, message } from "antd";
import { useQuery } from "@tanstack/react-query";
import AdminShell from "@/components/layout/AdminShell";
import AuthGuard from "@/components/layout/AuthGuard";
import apiClient from "@/lib/api";
import type { PaginatedResponse, Signal } from "@/types/api";

export default function SignalsPage() {
  const { data } = useQuery({ queryKey: ["signals"], queryFn: async () => (await apiClient.get<PaginatedResponse<Signal>>("/admin/signals")).data });
  return <AuthGuard><AdminShell><Typography.Title level={2}>信号</Typography.Title><Table rowKey="id" dataSource={data?.items ?? []} pagination={false} columns={[{ title: "ID", dataIndex: "id" }, { title: "Stock", dataIndex: "stock_id" }, { title: "策略", dataIndex: "config_id" }, { title: "类型", dataIndex: "signal_type" }, { title: "价格", dataIndex: "trigger_price" }, { title: "日期", dataIndex: "triggered_date" }, { title: "AI", render: (_, record) => <Button onClick={async () => { await apiClient.post(`/analysis/signals/${record.id}/ai`); message.success("AI 分析已生成"); }}>生成分析</Button> }]} /></AdminShell></AuthGuard>;
}
