"use client";

import { NotificationOutlined, PushpinOutlined, PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import { Button, Card, Form, Input, message, Popconfirm, Space, Switch, Table, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import AdminShell from "@/components/layout/AdminShell";
import AuthGuard from "@/components/layout/AuthGuard";
import apiClient from "@/lib/api";
import type { PaginatedResponse } from "@/types/api";

interface AnnouncementItem {
  id: number; title: string; content: string;
  is_published: boolean; is_pinned: boolean;
  created_at: string; updated_at: string;
}

export default function AnnouncementsPage() {
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form] = Form.useForm();
  const { data, refetch } = useQuery({
    queryKey: ["announcements", page],
    queryFn: async () => (await apiClient.get<PaginatedResponse<AnnouncementItem>>("/admin/announcements", { params: { page, size: 20 } })).data,
  });

  async function toggle(id: number, field: string, value: boolean) {
    await apiClient.patch(`/admin/announcements/${id}`, { [field]: value });
    refetch();
  }

  async function submit(values: Record<string, unknown>) {
    if (editId) {
      await apiClient.patch(`/admin/announcements/${editId}`, values);
    } else {
      await apiClient.post("/admin/announcements", values);
    }
    message.success(editId ? "已更新" : "已创建");
    setShowCreate(false); setEditId(null); form.resetFields(); refetch();
  }

  function startEdit(item: AnnouncementItem) {
    setEditId(item.id); setShowCreate(true);
    form.setFieldsValue({ title: item.title, content: item.content, is_published: item.is_published, is_pinned: item.is_pinned });
  }

  return (
    <AuthGuard><AdminShell>
      <Space className="mb-4 w-full justify-between">
        <div><Typography.Title level={2} className="!mb-0"><NotificationOutlined className="mr-2" />内容管理</Typography.Title><Typography.Text type="secondary">管理系统公告和通知。</Typography.Text></div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setShowCreate(true); setEditId(null); form.resetFields(); }}>新建公告</Button>
      </Space>

      {showCreate && (
        <Card className="mb-4" title={editId ? "编辑公告" : "新建公告"}>
          <Form form={form} layout="vertical" onFinish={submit} initialValues={{ is_published: true, is_pinned: false }}>
            <Form.Item name="title" label="标题" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="content" label="内容 (支持 HTML)" rules={[{ required: true }]}><Input.TextArea rows={6} /></Form.Item>
            <Space>
              <Form.Item name="is_published" label="已发布" valuePropName="checked"><Switch /></Form.Item>
              <Form.Item name="is_pinned" label="置顶" valuePropName="checked"><Switch /></Form.Item>
            </Space>
            <Space><Button type="primary" htmlType="submit">保存</Button><Button onClick={() => { setShowCreate(false); setEditId(null); }}>取消</Button></Space>
          </Form>
        </Card>
      )}

      <Table<AnnouncementItem> rowKey="id" dataSource={data?.items ?? []}
        pagination={{ current: page, pageSize: 20, total: data?.total ?? 0, showTotal: (t) => `共 ${t} 条`, onChange: (p) => setPage(p) }}
        columns={[
          { title: "ID", dataIndex: "id", width: 60 },
          { title: "标题", dataIndex: "title", render: (v, r) => <Space>{r.is_pinned && <PushpinOutlined className="text-red-500" />}<strong>{v}</strong></Space> },
          { title: "发布", dataIndex: "is_published", render: (v, r) => <Switch checked={v} onChange={(checked) => toggle(r.id, "is_published", checked)} /> },
          { title: "置顶", dataIndex: "is_pinned", render: (v, r) => <Switch checked={v} onChange={(checked) => toggle(r.id, "is_pinned", checked)} /> },
          { title: "创建时间", dataIndex: "created_at" },
          { title: "操作", render: (_, r) => (
            <Space size="small">
              <Button size="small" onClick={() => startEdit(r)}>编辑</Button>
              <Popconfirm title="确认删除？" onConfirm={async () => { await apiClient.delete(`/admin/announcements/${r.id}`); message.success("已删除"); refetch(); }}>
                <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
              </Popconfirm>
            </Space>
          )},
        ]}
      />
    </AdminShell></AuthGuard>
  );
}
