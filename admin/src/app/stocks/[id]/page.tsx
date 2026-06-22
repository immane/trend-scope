"use client";

import { Card, Table, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import AdminShell from "@/components/layout/AdminShell";
import AuthGuard from "@/components/layout/AuthGuard";
import apiClient from "@/lib/api";
import type { Stock } from "@/types/api";

export default function StockDetailPage({ params }: { params: { id: string } }) {
  const { data: stock } = useQuery({ queryKey: ["stock", params.id], queryFn: async () => (await apiClient.get<Stock>(`/stocks/${params.id}`)).data });
  const { data: kline } = useQuery({ queryKey: ["kline", params.id], queryFn: async () => (await apiClient.get(`/stocks/${params.id}/kline?limit=120`)).data });
  return <AuthGuard><AdminShell><Typography.Title level={2}>{stock?.symbol ?? "标的详情"}</Typography.Title><Card title={stock?.name}><Table rowKey="time" size="small" dataSource={kline?.data ?? []} pagination={{ pageSize: 20 }} columns={["time", "open", "high", "low", "close", "volume", "ma20", "ma60", "rsi14"].map((key) => ({ title: key, dataIndex: key }))} /></Card></AdminShell></AuthGuard>;
}
