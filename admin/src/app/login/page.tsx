"use client";

import { BarChartOutlined, LockOutlined, MailOutlined } from "@ant-design/icons";
import { Button, Card, Form, Input, Space, Typography, message } from "antd";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();

  async function onFinish(values: { email: string; password: string }) {
    try {
      const { data } = await apiClient.post("/auth/login", values);
      localStorage.setItem("access_token", data.access_token);
      localStorage.setItem("refresh_token", data.refresh_token);
      router.push("/dashboard");
    } catch {
      message.error("登录失败，请检查账号密码");
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-6 py-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(56,189,248,0.18),transparent_28rem),radial-gradient(circle_at_80%_80%,rgba(214,168,79,0.16),transparent_24rem)]" />
      <div className="absolute left-1/2 top-1/2 h-[620px] w-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10" />
      <Card className="relative w-full max-w-md border-slate-700/70 bg-slate-950/80 shadow-2xl shadow-black/50 backdrop-blur-xl">
        <Space direction="vertical" size={18} className="w-full">
          <div className="admin-brand-mark">
            <BarChartOutlined className="text-xl text-white" />
          </div>
          <div>
            <span className="admin-kicker">Admin Console</span>
            <Typography.Title level={3} className="!mb-2">Trend-Scope 管理端</Typography.Title>
            <Typography.Paragraph type="secondary" className="!mb-0">使用管理员账号登录后配置标的、策略、回测和提醒。</Typography.Paragraph>
          </div>
        </Space>
        <Form layout="vertical" onFinish={onFinish} initialValues={{ email: "admin@trend-scope.com" }}>
          <Form.Item name="email" label="邮箱" rules={[{ required: true, type: "email" }]}><Input prefix={<MailOutlined />} size="large" /></Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true }]}><Input.Password prefix={<LockOutlined />} size="large" /></Form.Item>
          <Button type="primary" htmlType="submit" size="large" block>进入控制台</Button>
        </Form>
      </Card>
    </main>
  );
}
