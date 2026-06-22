"use client";

import { Alert, Button, Card, Form, Input, InputNumber, Select, Space, Typography, message } from "antd";
import { useRouter } from "next/navigation";
import AdminShell from "@/components/layout/AdminShell";
import AuthGuard from "@/components/layout/AuthGuard";
import StrategyCodeEditor, { DEFAULT_STRATEGY_SCRIPT, STRATEGY_TEMPLATES, getStrategyTemplate } from "@/components/strategy/StrategyCodeEditor";
import apiClient from "@/lib/api";

interface StrategyFormValues {
  name: string;
  stock_id?: number;
  template_key: string;
  description?: string;
  script_content?: string;
  script_params_text?: string;
}

function parseJsonObject(value?: string) {
  if (!value?.trim()) return {};
  const parsed = JSON.parse(value);
  if (parsed == null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("JSON 必须是对象，例如 {\"short\": 20}");
  }
  return parsed as Record<string, unknown>;
}

export default function CreateStrategyPage() {
  const router = useRouter();
  const [form] = Form.useForm<StrategyFormValues>();

  function applyTemplate(templateKey: string) {
    const template = getStrategyTemplate(templateKey);
    form.setFieldsValue({
      name: form.getFieldValue("name") || template.label,
      script_content: template.script,
      script_params_text: JSON.stringify(template.params, null, 2),
      description: template.description,
    });
  }

  async function validateScript() {
    const script = form.getFieldValue("script_content") || DEFAULT_STRATEGY_SCRIPT;
    const { data } = await apiClient.post("/admin/strategies/validate", { script_content: script });
    if (data.valid) message.success("脚本校验通过");
    else message.error(`脚本校验失败：${data.detail}`);
  }

  async function onFinish(values: StrategyFormValues) {
    let scriptParams: Record<string, unknown> = {};
    try {
      scriptParams = parseJsonObject(values.script_params_text);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "脚本参数 JSON 格式错误");
      return;
    }

    const payload = {
      stock_id: values.stock_id || null,
      name: values.name,
      strategy_type: "custom_script",
      description: values.description,
      params: { template_key: values.template_key },
      script_content: values.script_content || DEFAULT_STRATEGY_SCRIPT,
      script_params: scriptParams,
    };
    await apiClient.post("/admin/strategies", payload);
    message.success("已创建策略");
    router.push("/strategies");
  }

  return (
    <AuthGuard>
      <AdminShell>
        <Typography.Title level={2}>创建策略</Typography.Title>
        <Card>
          <Form
            form={form}
            layout="vertical"
            onFinish={onFinish}
            initialValues={{ template_key: "ma_cross", name: "MA Cross 均线交叉", script_content: DEFAULT_STRATEGY_SCRIPT, script_params_text: '{\n  "short": 20,\n  "long": 60\n}', description: getStrategyTemplate("ma_cross").description }}
          >
            <Form.Item name="name" label="策略名称" rules={[{ required: true, message: "请输入策略名称" }]}><Input /></Form.Item>
            <Form.Item name="stock_id" label="适用标的 ID（留空代表全局策略）"><InputNumber className="w-full" /></Form.Item>
            <Form.Item name="template_key" label="策略代码模板" rules={[{ required: true }]}>
              <Select
                showSearch
                optionFilterProp="label"
                onChange={applyTemplate}
                options={STRATEGY_TEMPLATES.map((template) => ({ value: template.key, label: template.label }))}
              />
            </Form.Item>

            <Alert className="mb-4" type="info" showIcon message="所有策略都以 Python 脚本形式保存" description="选择 MA Cross、RSI、MACD、布林带等模板后，下面会显示对应 Python 代码。你可以直接编辑代码，保存后的代码就是实际回测和信号生成逻辑。" />
            <Form.Item name="script_content" label="Python 策略代码" rules={[{ required: true, message: "请输入策略代码" }]}>
              <StrategyCodeEditor />
            </Form.Item>
            <Form.Item name="script_params_text" label="脚本参数 JSON">
              <Input.TextArea rows={5} spellCheck={false} />
            </Form.Item>
            <Space className="mb-4"><Button onClick={validateScript}>校验脚本</Button></Space>

            <Form.Item name="description" label="策略描述"><Input.TextArea rows={3} /></Form.Item>
            <Button type="primary" htmlType="submit">保存策略</Button>
          </Form>
        </Card>
      </AdminShell>
    </AuthGuard>
  );
}
