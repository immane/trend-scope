"use client";

import { Card, Col, Row, Statistic, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import AdminShell from "@/components/layout/AdminShell";
import AuthGuard from "@/components/layout/AuthGuard";
import apiClient from "@/lib/api";

export default function DashboardPage() {
  const { data } = useQuery({ queryKey: ["dashboard"], queryFn: async () => (await apiClient.get("/admin/dashboard/stats")).data });
  return (
    <AuthGuard><AdminShell>
      <Typography.Title level={2}>Dashboard</Typography.Title>
      <Row gutter={[16, 16]}>
        {["users", "stocks", "strategies", "signals", "alerts"].map((key) => (
          <Col xs={24} md={8} lg={4} key={key}><Card><Statistic title={key} value={data?.[key] ?? 0} /></Card></Col>
        ))}
      </Row>
      <Card className="mt-4" title="Scheduler"><pre>{JSON.stringify(data?.jobs ?? [], null, 2)}</pre></Card>
    </AdminShell></AuthGuard>
  );
}
