"use client";

import { Button, Card, Form, Input, Typography, message } from "antd";
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
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6">
      <Card className="w-full max-w-md shadow-2xl">
        <Typography.Title level={3}>Trend-Scope 管理端</Typography.Title>
        <Typography.Paragraph type="secondary">使用管理员账号登录后配置标的、策略、回测和提醒。</Typography.Paragraph>
        <Form layout="vertical" onFinish={onFinish} initialValues={{ email: "admin@trend-scope.com" }}>
          <Form.Item name="email" label="邮箱" rules={[{ required: true, type: "email" }]}><Input /></Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true }]}><Input.Password /></Form.Item>
          <Button type="primary" htmlType="submit" block>登录</Button>
        </Form>
      </Card>
    </main>
  );
}
