"use client";

import { UserSwitchOutlined, CrownOutlined, CheckCircleOutlined, StopOutlined } from "@ant-design/icons";
import { Button, Card, Select, Space, Table, Tag, Typography, message, Popconfirm } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import AdminShell from "@/components/layout/AdminShell";
import AuthGuard from "@/components/layout/AuthGuard";
import apiClient from "@/lib/api";
import { dateDesc, sortByDateDesc } from "@/lib/sort";
import type { PaginatedResponse } from "@/types/api";

interface UserItem {
  id: number;
  email: string;
  nickname: string | null;
  role: string;
  status: string;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export default function UsersPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const { data, refetch } = useQuery({
    queryKey: ["users", page, pageSize, roleFilter, statusFilter],
    queryFn: async () => (await apiClient.get<PaginatedResponse<UserItem>>("/admin/users", { params: { page, size: pageSize, role: roleFilter, status_filter: statusFilter } })).data,
  });

  async function updateUser(userId: number, field: string, value: string) {
    await apiClient.patch(`/admin/users/${userId}`, { [field]: value });
    message.success("已更新");
    refetch();
  }

  return (
    <AuthGuard><AdminShell>
      <Space className="mb-4 w-full justify-between">
        <div><Typography.Title level={2}>用户管理</Typography.Title><Typography.Text type="secondary">管理所有用户、角色与状态。</Typography.Text></div>
      </Space>

      <Card className="mb-4">
        <Space wrap>
          <Space><UserSwitchOutlined /> 角色</Space>
          <Select allowClear className="w-24" placeholder="全部" value={roleFilter} onChange={(v) => { setRoleFilter(v || null); setPage(1); }}
            options={[{ value: "admin", label: "管理员" }, { value: "user", label: "普通用户" }]} />
          <Space><CheckCircleOutlined /> 状态</Space>
          <Select allowClear className="w-24" placeholder="全部" value={statusFilter} onChange={(v) => { setStatusFilter(v || null); setPage(1); }}
            options={[{ value: "active", label: "正常" }, { value: "inactive", label: "禁用" }, { value: "banned", label: "封禁" }]} />
        </Space>
      </Card>

      <Table<UserItem>
        rowKey="id"
        dataSource={sortByDateDesc(data?.items ?? [], (item) => item.last_login_at ?? item.created_at)}
        pagination={{ current: page, pageSize, total: data?.total ?? 0, showTotal: (total) => `共 ${total} 人`, onChange: (nextPage) => setPage(nextPage) }}
        onRow={(record) => ({ onClick: () => router.push(`/users/${record.id}`), className: "cursor-pointer" })}
        columns={[
          { title: "ID", dataIndex: "id" },
          { title: "邮箱", dataIndex: "email" },
          { title: "昵称", dataIndex: "nickname", render: (v) => v ?? "--" },
          { title: "角色", dataIndex: "role", render: (value) => <Tag color={value === "admin" ? "red" : "blue"}>{value === "admin" ? "管理员" : "用户"}</Tag> },
          { title: "状态", dataIndex: "status", render: (value) => {
            if (value === "active") return <Tag color="green">正常</Tag>;
            if (value === "inactive") return <Tag color="orange">禁用</Tag>;
            return <Tag color="red">封禁</Tag>;
          }},
          { title: "最近登录", dataIndex: "last_login_at", render: (v) => v ?? "从未登录", defaultSortOrder: "descend", sorter: (a, b) => -dateDesc(a.last_login_at ?? a.created_at, b.last_login_at ?? b.created_at) },
          {
            title: "快速操作",
            render: (_, record) => (
              <Space size="small" onClick={(e) => e.stopPropagation()}>
                <Popconfirm title="设为管理员？" onConfirm={() => updateUser(record.id, "role", "admin")} okText="确认" cancelText="取消">
                  <Button size="small" disabled={record.role === "admin"} icon={<CrownOutlined />}>提升</Button>
                </Popconfirm>
                {record.status !== "active" ? (
                  <Button size="small" icon={<CheckCircleOutlined />} onClick={() => updateUser(record.id, "status", "active")} className="text-green-600">解禁</Button>
                ) : (
                  <Popconfirm title="确认封禁？" onConfirm={() => updateUser(record.id, "status", "banned")} okText="封禁" cancelText="取消">
                    <Button size="small" danger icon={<StopOutlined />}>封禁</Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />
    </AdminShell></AuthGuard>
  );
}
