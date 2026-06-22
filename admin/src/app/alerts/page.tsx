"use client";

import { Table, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import AdminShell from "@/components/layout/AdminShell";
import AuthGuard from "@/components/layout/AuthGuard";
import apiClient from "@/lib/api";
import { dateDesc, sortByDateDesc } from "@/lib/sort";
import type { AlertLog, PaginatedResponse } from "@/types/api";

export default function AlertsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const { data } = useQuery({ queryKey: ["alerts", page, pageSize], queryFn: async () => (await apiClient.get<PaginatedResponse<AlertLog>>("/admin/alerts", { params: { page, size: pageSize } })).data });
  return <AuthGuard><AdminShell><Typography.Title level={2}>提醒日志</Typography.Title><Table rowKey="id" dataSource={sortByDateDesc(data?.items ?? [], (item) => item.sent_at)} onRow={(record) => ({ onClick: () => router.push(`/alerts/${record.id}`), className: "cursor-pointer" })} pagination={{ current: page, pageSize, total: data?.total ?? 0, showSizeChanger: true, showTotal: (total) => `共 ${total} 条`, onChange: (nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize); } }} columns={[{ title: "ID", dataIndex: "id" }, { title: "用户", dataIndex: "user_id" }, { title: "Stock", dataIndex: "stock_id" }, { title: "信号", dataIndex: "signal_id" }, { title: "标题", dataIndex: "title" }, { title: "状态", dataIndex: "status" }, { title: "发送时间", dataIndex: "sent_at", defaultSortOrder: "descend", sorter: (a, b) => -dateDesc(a.sent_at, b.sent_at) }]} /></AdminShell></AuthGuard>;
}
