"use client";

import { RobotOutlined } from "@ant-design/icons";
import { Button, Card, Col, Row, Statistic, Tag, Typography, message } from "antd";
import { useQuery } from "@tanstack/react-query";
import AdminShell from "@/components/layout/AdminShell";
import AuthGuard from "@/components/layout/AuthGuard";
import apiClient from "@/lib/api";

interface SignalDetail {
  id: number;
  stock_id: number;
  config_id: number;
  signal_type: string;
  signal_subtype: string | null;
  strength: string;
  confidence: number | null;
  trigger_price: number;
  trigger_details: Record<string, unknown>;
  triggered_date: string;
  is_active: boolean;
  created_at: string;
  strategy_name?: string;
  stock_symbol?: string;
  ai_analysis?: { id: number; analysis_json: Record<string, unknown>; model_provider: string; generated_at: string } | null;
}

export default function SignalDetailPage({ params }: { params: { id: string } }) {
  const { data } = useQuery({
    queryKey: ["signal-detail", params.id],
    queryFn: async () => {
      const sig = (await apiClient.get(`/admin/signals?size=200`)).data.items.find((s: SignalDetail) => s.id === Number(params.id));
      if (!sig) throw new Error("not found");
      try { sig.ai_analysis = (await apiClient.get(`/analysis/signals/${params.id}/ai`)).data; } catch {}
      return sig as SignalDetail;
    },
  });

  async function generateAI() {
    await apiClient.post(`/analysis/signals/${params.id}/ai`);
    message.success("AI 分析已生成");
    window.location.reload();
  }

  return (
    <AuthGuard><AdminShell>
      <Typography.Title level={2}>信号详情 #{params.id}</Typography.Title>
      <Row gutter={[16, 16]} className="mb-4">
        <Col span={4}><Card><Statistic title="标的" value={data?.stock_symbol ?? data?.stock_id ?? "--"} /></Card></Col>
        <Col span={4}><Card><Statistic title="策略" value={data?.strategy_name ?? `#${data?.config_id}`} /></Card></Col>
        <Col span={4}><Card><Statistic title="信号类型" valueRender={() => <Tag color={data?.signal_type === "buy" ? "green" : "red"}>{data?.signal_type === "buy" ? "买入" : "卖出"}</Tag>} /></Card></Col>
        <Col span={4}><Card><Statistic title="强度" value={data?.strength} /></Card></Col>
        <Col span={4}><Card><Statistic title="触发价格" value={data?.trigger_price != null ? `$${data.trigger_price}` : "--"} /></Card></Col>
        <Col span={4}><Card><Statistic title="触发日期" value={data?.triggered_date} /></Card></Col>
      </Row>

      <Card className="mb-4" title="触发详情"><pre className="rounded bg-slate-50 p-3 text-sm">{JSON.stringify(data?.trigger_details ?? {}, null, 2)}</pre></Card>

      <Card title={<span><RobotOutlined className="mr-2" />AI 分析</span>} extra={<Button onClick={generateAI}>生成/重新生成分析</Button>} className="mb-4">
        {data?.ai_analysis ? (
          <>
            <Typography.Text type="secondary">模型: {data.ai_analysis.model_provider} · 生成时间: {data.ai_analysis.generated_at}</Typography.Text>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="mb-1 text-xs font-semibold text-slate-500">核心摘要</div>
                <div className="text-sm">{String(data.ai_analysis.analysis_json?.summary ?? "--")}</div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="mb-1 text-xs font-semibold text-slate-500">置信度</div>
                <div className="text-sm">{(Number((data.ai_analysis.analysis_json as Record<string, unknown>)?.confidence ?? 0) * 100).toFixed(1)}%</div>
              </div>
            </div>
            <div className="mt-2 rounded bg-slate-950 p-4">
              <pre className="text-xs text-slate-100 whitespace-pre-wrap">{JSON.stringify(data.ai_analysis.analysis_json, null, 2)}</pre>
            </div>
          </>
        ) : (
          <Typography.Text type="secondary">暂无 AI 分析报告。点击上方按钮生成。</Typography.Text>
        )}
      </Card>
    </AdminShell></AuthGuard>
  );
}
