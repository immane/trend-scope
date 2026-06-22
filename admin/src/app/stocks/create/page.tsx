"use client";

import { Button, Card, Form, Input, Select, Typography, message } from "antd";
import { useRouter } from "next/navigation";
import AdminShell from "@/components/layout/AdminShell";
import AuthGuard from "@/components/layout/AuthGuard";
import apiClient from "@/lib/api";

export default function CreateStockPage() {
  const router = useRouter();
  async function onFinish(values: Record<string, unknown>) {
    await apiClient.post("/admin/stocks", values);
    message.success("已创建标的");
    router.push("/stocks");
  }
  return <AuthGuard><AdminShell><Typography.Title level={2}>新增标的</Typography.Title><Card><Form layout="vertical" onFinish={onFinish} initialValues={{ type: "ETF", market: "US" }}><Form.Item name="symbol" label="Symbol" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="type" label="类型"><Select options={["ETF", "Stock", "Index"].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="market" label="市场"><Input /></Form.Item><Form.Item name="sector" label="行业"><Input /></Form.Item><Button type="primary" htmlType="submit">保存</Button></Form></Card></AdminShell></AuthGuard>;
}
