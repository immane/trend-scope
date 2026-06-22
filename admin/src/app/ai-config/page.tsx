"use client";

import { KeyOutlined, LinkOutlined, RobotOutlined, ApiOutlined } from "@ant-design/icons";
import { Button, Card, Form, Input, Switch, Typography, message, Space, Tag } from "antd";
import { useQuery } from "@tanstack/react-query";
import AdminShell from "@/components/layout/AdminShell";
import AuthGuard from "@/components/layout/AuthGuard";
import apiClient from "@/lib/api";

interface AIConfigData {
  api_key: string;
  base_url: string;
  model: string;
  enabled: boolean;
  configured: boolean;
}

export default function AIConfigPage() {
  const [form] = Form.useForm();
  const { data, refetch } = useQuery({
    queryKey: ["ai-config"],
    queryFn: async () => (await apiClient.get<AIConfigData>("/admin/ai-config")).data,
  });

  async function onFinish(values: { api_key?: string; base_url?: string; model?: string; enabled?: boolean }) {
    const payload: Record<string, unknown> = {};
    if (values.api_key && values.api_key.trim() !== "") {
      payload.api_key = values.api_key.trim();
    }
    if (values.base_url && values.base_url.trim() !== "") {
      payload.base_url = values.base_url.trim();
    }
    if (values.model && values.model.trim() !== "") {
      payload.model = values.model.trim();
    }
    if (typeof values.enabled === "boolean") {
      payload.enabled = values.enabled;
    }
    if (Object.keys(payload).length === 0) {
      message.warning("没有需要更新的配置项");
      return;
    }
    await apiClient.patch("/admin/ai-config", payload);
    message.success("AI 配置已更新");
    refetch();
  }

  function fillFromEnv() {
    form.setFieldsValue({
      api_key: data?.api_key || "",
      base_url: data?.base_url || "https://api.deepseek.com/v1",
      model: data?.model || "deepseek-chat",
      enabled: data?.enabled || false,
    });
  }

  return (
    <AuthGuard><AdminShell>
      <Space className="mb-4 w-full justify-between">
        <div>
          <Typography.Title level={2} className="!mb-0"><RobotOutlined className="mr-2" />AI 接口设置</Typography.Title>
          <Typography.Text type="secondary">配置 AI 分析服务使用的模型、API 地址和密钥。运行时生效，无需重启。</Typography.Text>
        </div>
        <Tag color={data?.configured ? "green" : "default"}>{data?.configured ? "已配置" : "未配置"}</Tag>
      </Space>

      <Card className="mb-4" title={<span><ApiOutlined className="mr-2" />当前连接信息</span>}>
        <Space direction="vertical" size="middle" className="w-full">
          <div>
            <Typography.Text type="secondary">API 地址：</Typography.Text>
            <Typography.Text code>{data?.base_url || "未设置"}</Typography.Text>
          </div>
          <div>
            <Typography.Text type="secondary">模型：</Typography.Text>
            <Tag color="blue">{data?.model || "未设置"}</Tag>
          </div>
          <div>
            <Typography.Text type="secondary">API Key：</Typography.Text>
            <Typography.Text code>{data?.api_key || "未设置"}</Typography.Text>
          </div>
          <div>
            <Typography.Text type="secondary">运行时开关：</Typography.Text>
            <Tag color={data?.enabled ? "green" : "orange"}>{data?.enabled ? "已启用" : "已关闭"}</Tag>
          </div>
        </Space>
      </Card>

      <Card
        title={<span><KeyOutlined className="mr-2" />修改 AI 配置</span>}
        extra={<Button onClick={fillFromEnv}>填充当前值</Button>}
      >
        <Typography.Paragraph type="secondary">
          默认使用环境变量 <Typography.Text code>DEEPSEEK_API_KEY</Typography.Text> / <Typography.Text code>DEEPSEEK_BASE_URL</Typography.Text> / <Typography.Text code>DEEPSEEK_MODEL</Typography.Text>。
          运行时配置会覆盖环境变量且即时生效，适用于切换 API 密钥、更换模型或连接自托管服务。
          直接填写完整 API Key 时会覆盖环境变量；留空则回退到环境变量。
        </Typography.Paragraph>

        <Form form={form} layout="vertical" onFinish={onFinish} className="max-w-lg">
          <Form.Item name="api_key" label="API Key" extra="留空则使用环境变量 DEEPSEEK_API_KEY">
            <Input.Password
              prefix={<KeyOutlined />}
              placeholder="sk-xxxxxxxxxxxxxxxx"
              autoComplete="off"
            />
          </Form.Item>

          <Form.Item name="base_url" label="Base URL" extra="API 网关地址，默认 https://api.deepseek.com/v1">
            <Input prefix={<LinkOutlined />} placeholder="https://api.deepseek.com/v1" />
          </Form.Item>

          <Form.Item name="model" label="模型名称" extra="例如 deepseek-chat / deepseek-reasoner">
            <Input placeholder="deepseek-chat" />
          </Form.Item>

          <Form.Item name="enabled" label="启用运行时 AI 分析" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Button type="primary" htmlType="submit">保存配置</Button>
        </Form>
      </Card>
    </AdminShell></AuthGuard>
  );
}
