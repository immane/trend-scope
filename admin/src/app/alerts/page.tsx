"use client";

import { Table, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import AdminShell from "@/components/layout/AdminShell";
import AuthGuard from "@/components/layout/AuthGuard";
import apiClient from "@/lib/api";
import type { AlertLog, PaginatedResponse } from "@/types/api";

export default function AlertsPage() {
  const { data } = useQuery({ queryKey: ["alerts"], queryFn: async () => (await apiClient.get<PaginatedResponse<AlertLog>>("/admin/alerts")).data });
  return <AuthGuard><AdminShell><Typography.Title level={2}>提醒日志</Typography.Title><Table rowKey="id" dataSource={data?.items ?? []} pagination={false} columns={[{ title: "ID", dataIndex: "id" }, { title: "用户", dataIndex: "user_id" }, { title: "Stock", dataIndex: "stock_id" }, { title: "信号", dataIndex: "signal_id" }, { title: "标题", dataIndex: "title" }, { title: "状态", dataIndex: "status" }, { title: "发送时间", dataIndex: "sent_at" }]} /></AdminShell></AuthGuard>;
}
