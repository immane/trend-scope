"use client";

import { Alert, Button, Card, DatePicker, Empty, Form, Input, InputNumber, Select, Space, Switch, Table, Tabs, Tag, Typography, message } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AdminShell from "@/components/layout/AdminShell";
import AuthGuard from "@/components/layout/AuthGuard";
import StrategyCodeEditor, { DEFAULT_STRATEGY_SCRIPT, STRATEGY_TEMPLATES, getStrategyTemplate } from "@/components/strategy/StrategyCodeEditor";
import apiClient from "@/lib/api";
import { formatInteger, formatPercent } from "@/lib/format";
import { dateDesc, sortByDateDesc } from "@/lib/sort";
import type { BacktestItem, PaginatedResponse, Strategy } from "@/types/api";

interface StrategyEditValues {
  name: string;
  stock_id?: number | null;
  template_key: string;
  script_content?: string;
  script_params_text?: string;
  description?: string | null;
  is_active?: boolean;
}

function parseJsonObject(value?: string) {
  if (!value?.trim()) return {};
  const parsed = JSON.parse(value);
  if (parsed == null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("JSON 必须是对象，例如 {\"short\": 20}");
  }
  return parsed as Record<string, unknown>;
}

function stringifyJson(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

export default function StrategyDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [form] = Form.useForm<StrategyEditValues>();
  const { data, refetch } = useQuery({ queryKey: ["strategy", params.id], queryFn: async () => (await apiClient.get<Strategy>(`/admin/strategies/${params.id}`)).data });
  const { data: backtestsData, refetch: refetchBacktests } = useQuery({
    queryKey: ["strategy-backtests", params.id],
    queryFn: async () => (await apiClient.get<PaginatedResponse<BacktestItem>>("/admin/backtests", { params: { config_id: Number(params.id), size: 50 } })).data,
  });
  const backtests = backtestsData?.items ?? [];

  function applyTemplate(templateKey: string) {
    const template = getStrategyTemplate(templateKey);
    form.setFieldsValue({
      script_content: template.script,
      script_params_text: stringifyJson(template.params),
      description: form.getFieldValue("description") || template.description,
    });
  }

  useEffect(() => {
    if (!data) return;
    const templateKey = typeof data.params?.template_key === "string" ? data.params.template_key : data.strategy_type === "ma_cross" ? "ma_cross" : data.strategy_type === "multi_indicator" ? "trend_rsi_filter" : "ma_cross";
    const template = getStrategyTemplate(templateKey);
    const legacyParams = data.strategy_type === "ma_cross" ? { short: Number(data.params?.ma_short ?? 20), long: Number(data.params?.ma_long ?? 60) } : template.params;
    form.setFieldsValue({
      name: data.name,
      stock_id: data.stock_id,
      template_key: templateKey,
      script_content: data.script_content || template.script || DEFAULT_STRATEGY_SCRIPT,
      script_params_text: stringifyJson(data.script_params && Object.keys(data.script_params).length ? data.script_params : legacyParams),
      description: data.description,
      is_active: data.is_active,
    });
  }, [data, form]);

  async function validateScript() {
    const script = form.getFieldValue("script_content") || DEFAULT_STRATEGY_SCRIPT;
    const { data: result } = await apiClient.post("/admin/strategies/validate", { script_content: script });
    if (result.valid) message.success("脚本校验通过，可以保存");
    else message.error(`脚本校验失败：${result.detail}`);
  }

  async function save(values: StrategyEditValues) {
    let scriptParams: Record<string, unknown> = {};
    try {
      scriptParams = parseJsonObject(values.script_params_text);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "脚本参数 JSON 格式错误");
      return;
    }

    await apiClient.patch(`/admin/strategies/${params.id}`, {
      name: values.name,
      stock_id: values.stock_id || null,
      strategy_type: "custom_script",
      description: values.description,
      is_active: values.is_active,
      params: { template_key: values.template_key },
      script_content: values.script_content || DEFAULT_STRATEGY_SCRIPT,
      script_params: scriptParams,
    });
    message.success("策略已保存");
    refetch();
  }

  async function run(values: { range: [unknown, unknown]; stock_id: number }) {
    const [start, end] = values.range as Array<{ toISOString: () => string }>;
    const response = await apiClient.post("/backtest/run", { stock_id: values.stock_id, config_id: Number(params.id), start_date: start.toISOString().slice(0, 10), end_date: end.toISOString().slice(0, 10) });
    message.success(`回测已完成，结果 ID: ${response.data.id}`);
    refetchBacktests();
  }

  return (
    <AuthGuard>
      <AdminShell>
        <Typography.Title level={2}>{data?.name ?? "策略详情"}</Typography.Title>
        <Tabs
          items={[
            {
              key: "edit",
              label: "编辑策略",
              children: (
                <Card>
                  <Form form={form} layout="vertical" onFinish={save}>
                    <Form.Item name="name" label="策略名称" rules={[{ required: true }]}><Input /></Form.Item>
                    <Form.Item name="stock_id" label="适用标的 ID（留空代表全局策略）"><InputNumber className="w-full" /></Form.Item>
                    <Form.Item name="template_key" label="策略代码模板" rules={[{ required: true }]}>
                      <Select
                        showSearch
                        optionFilterProp="label"
                        onChange={applyTemplate}
                        options={STRATEGY_TEMPLATES.map((template) => ({ value: template.key, label: template.label }))}
                      />
                    </Form.Item>
                    <Form.Item name="is_active" label="启用策略" valuePropName="checked"><Switch /></Form.Item>

                    <Alert className="mb-4" type="info" showIcon message="当前策略以 Python 脚本执行" description="选择任意模板都会展示其 Python 实现。修改并保存后，回测和定时信号都会使用这段脚本。旧的 MA/multi_indicator 策略也可以在这里保存为代码化策略。" />
                    <Form.Item name="script_content" label="Python 策略代码" rules={[{ required: true, message: "请输入策略代码" }]}>
                      <StrategyCodeEditor />
                    </Form.Item>
                    <Form.Item name="script_params_text" label="脚本参数 JSON"><Input.TextArea rows={5} spellCheck={false} /></Form.Item>
                    <Button className="mb-4" onClick={validateScript}>校验脚本</Button>

                    <Form.Item name="description" label="策略描述"><Input.TextArea rows={3} /></Form.Item>
                    <Space><Button type="primary" htmlType="submit">保存修改</Button><Button onClick={() => refetch()}>重新加载</Button></Space>
                  </Form>
                </Card>
              ),
            },
            {
              key: "backtest",
              label: `回测记录 (${(backtests ?? []).length})`,
              children: (
                <Space direction="vertical" size="large" className="w-full">
                  <Card title="运行新回测">
                    <Form layout="inline" onFinish={run} initialValues={{ stock_id: data?.stock_id ?? 1 }}>
                      <Form.Item name="stock_id" label="Stock ID" rules={[{ required: true }]}><InputNumber /></Form.Item>
                      <Form.Item name="range" label="区间" rules={[{ required: true }]}><DatePicker.RangePicker /></Form.Item>
                      <Button type="primary" htmlType="submit">运行</Button>
                    </Form>
                  </Card>

                  <Card title="该策略的历史回测记录">
                    {backtests.length === 0 ? (
                      <Empty description="该策略尚未运行过回测。选择区间接上方运行新回测。" />
                    ) : (
                      <Table<BacktestItem>
                        rowKey="id"
                        dataSource={sortByDateDesc(backtests, (item) => item.created_at)}
                        pagination={false}
                        onRow={(record) => ({ onClick: () => router.push(`/backtest/${record.id}`), className: "cursor-pointer" })}
                        columns={[
                          { title: "回测 ID", dataIndex: "id", render: (id) => <Button type="link" className="!p-0" onClick={(e) => { e.stopPropagation(); router.push(`/backtest/${id}`); }}>#{id}</Button> },
                          { title: "状态", dataIndex: "status", render: (status) => {
                            if (status === "completed") return <Tag color="green">已完成</Tag>;
                            if (status === "failed") return <Tag color="red">失败</Tag>;
                            return <Tag color="blue">运行中</Tag>;
                          }},
                          { title: "区间", render: (_, row) => `${row.start_date} 至 ${row.end_date}` },
                          { title: "收益率", dataIndex: "total_return", render: formatPercent },
                          { title: "最大回撤", dataIndex: "max_drawdown", render: formatPercent },
                          { title: "Sharpe", dataIndex: "sharpe_ratio", render: (value) => value ?? "--" },
                          { title: "交易数", dataIndex: "num_trades", render: formatInteger },
                          { title: "创建时间", dataIndex: "created_at", defaultSortOrder: "descend", sorter: (a, b) => -dateDesc(a.created_at, b.created_at) },
                        ]}
                      />
                    )}
                  </Card>
                </Space>
              ),
            },
            {
              key: "raw",
              label: "原始数据",
              children: <Card title="当前策略 JSON"><pre className="overflow-auto rounded bg-slate-950 p-4 text-xs text-slate-100">{JSON.stringify(data, null, 2)}</pre></Card>,
            },
          ]}
        />
      </AdminShell>
    </AuthGuard>
  );
}
