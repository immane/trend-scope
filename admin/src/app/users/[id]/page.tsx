"use client";

import { CrownOutlined, MailOutlined, UserOutlined } from "@ant-design/icons";
import { Button, Card, Col, Descriptions, Form, Input, message, Popconfirm, Row, Select, Space, Table, Tag, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import AdminShell from "@/components/layout/AdminShell";
import AuthGuard from "@/components/layout/AuthGuard";
import apiClient from "@/lib/api";
import type { AlertLog, BacktestItem, PaginatedResponse } from "@/types/api";

interface UserDetail {
  id: number; email: string; nickname: string | null; avatar_url: string | null;
  role: string; status: string; last_login_at: string | null; created_at: string; updated_at: string;
}

export default function UserDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [form] = Form.useForm();
  const { data: user, refetch } = useQuery({
    queryKey: ["user-detail", params.id],
    queryFn: async () => {
      const resp = await apiClient.get<UserDetail>(`/admin/users/${params.id}`);
      form.setFieldsValue(resp.data);
      return resp.data;
    },
  });
  const { data: alerts } = useQuery({
    queryKey: ["user-alerts", params.id],
    queryFn: async () => (await apiClient.get<PaginatedResponse<AlertLog>>("/admin/alerts", { params: { user_id: Number(params.id), size: 10 } })).data,
  });
  const { data: backtests } = useQuery({
    queryKey: ["user-backtests", params.id],
    queryFn: async () => (await apiClient.get<PaginatedResponse<BacktestItem>>("/admin/backtests", { params: { size: 10 } })).data,
  });

  async function save(values: Record<string, unknown>) {
    await apiClient.patch(`/admin/users/${params.id}`, values);
    message.success("已保存");
    refetch();
  }

  return (
    <AuthGuard><AdminShell>
      <Space className="mb-4 w-full justify-between">
        <div><Typography.Title level={2} className="!mb-0">用户 #{params.id}</Typography.Title>
          <Typography.Text type="secondary">{user?.email}</Typography.Text>
        </div>
        <Button onClick={() => router.push("/users")}>返回列表</Button>
      </Space>

      <Row gutter={[16, 16]} className="mb-4">
        <Col xs={24} lg={12}>
          <Card title={<span><UserOutlined className="mr-2" />基本资料</span>}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="ID">{user?.id}</Descriptions.Item>
              <Descriptions.Item label="邮箱">{user?.email}</Descriptions.Item>
              <Descriptions.Item label="昵称">{user?.nickname ?? "--"}</Descriptions.Item>
              <Descriptions.Item label="角色"><Tag color={user?.role === "admin" ? "red" : "blue"} icon={user?.role === "admin" ? <CrownOutlined /> : null}>{user?.role === "admin" ? "管理员" : "用户"}</Tag></Descriptions.Item>
              <Descriptions.Item label="状态">{user?.status === "active" ? <Tag color="green">正常</Tag> : user?.status === "inactive" ? <Tag color="orange">禁用</Tag> : <Tag color="red">封禁</Tag>}</Descriptions.Item>
              <Descriptions.Item label="最近登录">{user?.last_login_at ?? "从未登录"}</Descriptions.Item>
              <Descriptions.Item label="注册时间">{user?.created_at}</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="修改用户">
            <Form form={form} layout="vertical" onFinish={save}>
              <Form.Item name="nickname" label="昵称"><Input /></Form.Item>
              <Form.Item name="role" label="角色">
                <Select disabled={user?.id === 1} options={[{ value: "admin", label: "管理员" }, { value: "user", label: "普通用户" }]} />
              </Form.Item>
              <Form.Item name="status" label="状态">
                <Select options={[{ value: "active", label: "正常" }, { value: "inactive", label: "禁用" }, { value: "banned", label: "封禁" }]} />
              </Form.Item>
              <Space>
                <Button type="primary" htmlType="submit">保存修改</Button>
                <Popconfirm title={`确认${user?.status === "active" ? "封禁" : "解禁"}此用户？`} onConfirm={() => {
                  const newStatus = user?.status === "active" ? "banned" : "active";
                  apiClient.patch(`/admin/users/${params.id}`, { status: newStatus }).then(() => { message.success("已更新"); refetch(); });
                }}>
                  <Button danger={user?.status === "active"}>{user?.status === "active" ? "封禁用户" : "解禁用户"}</Button>
                </Popconfirm>
              </Space>
            </Form>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title={<span><MailOutlined className="mr-2" />最近提醒 ({alerts?.total ?? 0})</span>}>
            <Table<AlertLog> rowKey="id" size="small" dataSource={alerts?.items ?? []} pagination={false}
              columns={[
                { title: "ID", dataIndex: "id" },
                { title: "信号", dataIndex: "signal_id" },
                { title: "状态", dataIndex: "status", render: (v) => <Tag color={v === "sent" ? "green" : "red"}>{v === "sent" ? "已发送" : "失败"}</Tag> },
                { title: "时间", dataIndex: "sent_at" },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="最近回测">
            <Table<BacktestItem> rowKey="id" size="small" dataSource={(backtests?.items ?? []).filter(b => b.user_id === Number(params.id)).slice(0, 10)} pagination={false}
              columns={[
                { title: "ID", dataIndex: "id" },
                { title: "状态", dataIndex: "status", render: (v) => <Tag color={v === "completed" ? "green" : "red"}>{v === "completed" ? "已完成" : "失败"}</Tag> },
                { title: "时间", dataIndex: "created_at" },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </AdminShell></AuthGuard>
  );
}
