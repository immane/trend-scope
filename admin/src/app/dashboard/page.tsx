"use client";

import { BellOutlined, ExperimentOutlined, LineChartOutlined, SettingOutlined, StockOutlined, ThunderboltOutlined, UserOutlined } from "@ant-design/icons";
import { Card, Col, List, Row, Statistic, Tag, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import AdminShell from "@/components/layout/AdminShell";
import AuthGuard from "@/components/layout/AuthGuard";
import apiClient from "@/lib/api";
import type { BacktestItem, PaginatedResponse } from "@/types/api";

const statCards = [
  { key: "users", title: "用户总数", icon: <UserOutlined style={{ fontSize: 24, color: "#2563eb" }} /> },
  { key: "stocks", title: "标的总数", icon: <StockOutlined style={{ fontSize: 24, color: "#059669" }} /> },
  { key: "strategies", title: "策略数量", icon: <ThunderboltOutlined style={{ fontSize: 24, color: "#ea580c" }} /> },
  { key: "signals", title: "信号数量", icon: <LineChartOutlined style={{ fontSize: 24, color: "#7c3aed" }} /> },
  { key: "alerts", title: "提醒次数", icon: <BellOutlined style={{ fontSize: 24, color: "#dc2626" }} /> },
];

export default function DashboardPage() {
  const { data } = useQuery({ queryKey: ["dashboard"], queryFn: async () => (await apiClient.get("/admin/dashboard/stats")).data });
  const { data: backtests } = useQuery({ queryKey: ["backtests-dashboard"], queryFn: async () => (await apiClient.get<PaginatedResponse<BacktestItem>>("/admin/backtests", { params: { size: 5 } })).data });
  const recentCompleted = (backtests?.items ?? []).filter((item) => item.status === "completed").slice(0, 5);
  const recentFailed = (backtests?.items ?? []).filter((item) => item.status === "failed").slice(0, 3);

  return (
    <AuthGuard><AdminShell>
      <Typography.Title level={2}>Dashboard</Typography.Title>
      <Typography.Paragraph type="secondary">趋势分析与信号生成平台 — 策略管理、回测验证、AI 分析、邮件提醒一站式管理面板。</Typography.Paragraph>

      <Row gutter={[16, 16]} className="mb-6">
        {statCards.map((item) => (
          <Col xs={12} md={8} lg={4} key={item.key}>
            <Card hoverable>
              <div className="mb-3 flex items-center justify-between">
                <Typography.Text type="secondary">{item.title}</Typography.Text>
                {item.icon}
              </div>
              <Statistic value={data?.[item.key] ?? 0} />
            </Card>
          </Col>
        ))}
        <Col xs={12} md={8} lg={4}>
          <Card hoverable>
            <div className="mb-3 flex items-center justify-between">
              <Typography.Text type="secondary">回测总数</Typography.Text>
              <ExperimentOutlined style={{ fontSize: 24, color: "#0891b2" }} />
            </div>
            <Statistic value={backtests?.total ?? 0} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Card title={<span><SettingOutlined className="mr-2" />调度服务状态</span>}>
            {(data?.jobs ?? []).length > 0 ? (
              <List
                size="small"
                dataSource={data?.jobs ?? []}
                renderItem={(job: { id: string; name: string; next_run_time: string | null }) => (
                  <List.Item extra={job.next_run_time ? <Tag color="green">下次: {job.next_run_time}</Tag> : <Tag color="orange">待触发</Tag>}>
                    <List.Item.Meta title={job.name} description={`ID: ${job.id}`} />
                  </List.Item>
                )}
              />
            ) : (
              <Typography.Text type="secondary">调度服务未启动或暂无已注册的定时任务。容器启动时自动注册。</Typography.Text>
            )}
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <Card title={<span><ExperimentOutlined className="mr-2" />最近回测</span>}>
            {recentCompleted.length > 0 ? (
              <List
                size="small"
                dataSource={recentCompleted}
                renderItem={(item) => (
                  <List.Item>
                    <List.Item.Meta
                      title={<span>#{item.id} <Tag color="green">已完成</Tag></span>}
                      description={item.strategy_name || `策略 ${item.config_id}`}
                    />
                  </List.Item>
                )}
              />
            ) : (
              <Typography.Text type="secondary">暂无已完成的回测记录。</Typography.Text>
            )}
            {recentFailed.length > 0 && (
              <>
                <Typography.Text type="secondary" className="mt-2 block">失败记录：</Typography.Text>
                <List
                  size="small"
                  dataSource={recentFailed}
                  renderItem={(item) => (
                    <List.Item>
                      <List.Item.Meta
                        title={<span>#{item.id} <Tag color="red">失败</Tag></span>}
                        description={item.error_message || "未知错误"}
                      />
                    </List.Item>
                  )}
                />
              </>
            )}
          </Card>
        </Col>
      </Row>
    </AdminShell></AuthGuard>
  );
}
