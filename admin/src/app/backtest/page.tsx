"use client";

import { Button, Space, Table, Tag, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type Key } from "react";
import AdminShell from "@/components/layout/AdminShell";
import AuthGuard from "@/components/layout/AuthGuard";
import apiClient from "@/lib/api";
import type { BacktestItem, PaginatedResponse } from "@/types/api";

function formatPercent(value?: string | null) {
  if (value == null) return "--";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "--";
  return `${(numeric * 100).toFixed(2)}%`;
}

function statusTag(status: string) {
  const color = status === "completed" ? "green" : status === "failed" ? "red" : "blue";
  const label = status === "completed" ? "已完成" : status === "failed" ? "失败" : "运行中";
  return <Tag color={color}>{label}</Tag>;
}

export default function BacktestPage() {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Key[]>([]);
  const { data } = useQuery({ queryKey: ["backtests"], queryFn: async () => (await apiClient.get<PaginatedResponse<BacktestItem>>("/admin/backtests")).data });
  return <AuthGuard><AdminShell>
    <Space className="mb-4 w-full justify-between" align="start">
      <div>
        <Typography.Title level={2} className="!mb-1">回测历史</Typography.Title>
        <Typography.Text type="secondary">点击任意回测记录，查看收益曲线、回撤曲线、交易明细和完整风险指标。</Typography.Text>
      </div>
      <Button type="primary" disabled={selectedIds.length < 2} onClick={() => router.push(`/backtest/compare?ids=${selectedIds.join(",")}`)}>
        对比所选回测（{selectedIds.length}）
      </Button>
    </Space>
    <Table
      rowKey="id"
      dataSource={data?.items ?? []}
      pagination={false}
      rowSelection={{ selectedRowKeys: selectedIds, onChange: setSelectedIds }}
      onRow={(record) => ({ onClick: () => router.push(`/backtest/${record.id}`), className: "cursor-pointer" })}
      columns={[
        { title: "回测 ID", dataIndex: "id" },
        { title: "标的 ID", dataIndex: "stock_id" },
        { title: "策略 ID", dataIndex: "config_id" },
        { title: "状态", dataIndex: "status", render: statusTag },
        { title: "策略收益率", dataIndex: "total_return", render: formatPercent },
        { title: "最大回撤", dataIndex: "max_drawdown", render: formatPercent },
        { title: "Sharpe 夏普", dataIndex: "sharpe_ratio", render: (value) => value ?? "--" },
        { title: "交易次数", dataIndex: "num_trades", render: (value) => value ?? "--" },
        { title: "创建时间", dataIndex: "created_at" },
        { title: "详情", render: (_, record) => <Button onClick={(event) => { event.stopPropagation(); router.push(`/backtest/${record.id}`); }}>查看详情</Button> },
      ]}
    />
  </AdminShell></AuthGuard>;
}
