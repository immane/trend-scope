"use client";

import { MailOutlined, CheckCircleOutlined, CloseCircleOutlined } from "@ant-design/icons";
import { Card, Col, Row, Statistic, Tag, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import AdminShell from "@/components/layout/AdminShell";
import AuthGuard from "@/components/layout/AuthGuard";
import apiClient from "@/lib/api";

interface AlertDetail {
  id: number;
  alert_rule_id: number | null;
  user_id: number;
  stock_id: number;
  signal_id: number | null;
  channel: string;
  title: string;
  message: string;
  status: string;
  provider_message_id: string | null;
  sent_at: string;
}

export default function AlertDetailPage({ params }: { params: { id: string } }) {
  const { data } = useQuery({
    queryKey: ["alert-detail", params.id],
    queryFn: async () => {
      const resp = (await apiClient.get(`/admin/alerts?size=1000`)).data;
      return resp.items.find((a: AlertDetail) => a.id === Number(params.id)) as AlertDetail | undefined;
    },
  });

  return (
    <AuthGuard><AdminShell>
      <Typography.Title level={2}>提醒日志 #{params.id}</Typography.Title>

      <Row gutter={[16, 16]} className="mb-4">
        <Col span={6}><Card><Statistic title="用户 ID" value={data?.user_id ?? "--"} /></Card></Col>
        <Col span={6}><Card><Statistic title="标的 ID" value={data?.stock_id ?? "--"} /></Card></Col>
        <Col span={6}><Card><Statistic title="信号 ID" value={data?.signal_id ?? "--"} /></Card></Col>
        <Col span={6}><Card><Statistic title="渠道" value={data?.channel === "email" ? "邮件" : data?.channel} /></Card></Col>
      </Row>

      <Row gutter={[16, 16]} className="mb-4">
        <Col span={6}><Card><Statistic title="状态" valueRender={() => data?.status === "sent" ? <Tag icon={<CheckCircleOutlined />} color="green">已发送</Tag> : <Tag icon={<CloseCircleOutlined />} color="red">失败</Tag>} /></Card></Col>
        <Col span={6}><Card><Statistic title="发送时间" value={data?.sent_at ?? "--"} /></Card></Col>
        <Col span={12}><Card><Statistic title="Provider Message ID" value={data?.provider_message_id ?? "--"} valueStyle={{ fontSize: 14 }} /></Card></Col>
      </Row>

      <Card className="mb-4" title={<span><MailOutlined className="mr-2" />邮件主题</span>}><Typography.Text strong>{data?.title ?? "--"}</Typography.Text></Card>

      <Card title="邮件内容"><div className="max-h-96 overflow-auto rounded border border-slate-700/60 bg-slate-950/50 p-4 text-sm leading-relaxed text-slate-200" dangerouslySetInnerHTML={{ __html: data?.message ?? "--" }} /></Card>
    </AdminShell></AuthGuard>
  );
}
