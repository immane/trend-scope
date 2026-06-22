"use client";

import { Button, Space, Table, Tag, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type Key } from "react";
import AdminShell from "@/components/layout/AdminShell";
import AuthGuard from "@/components/layout/AuthGuard";
import apiClient from "@/lib/api";
import { formatInteger, formatPercent, formatRatio } from "@/lib/format";
import { dateDesc, sortByDateDesc } from "@/lib/sort";
import type { BacktestItem, PaginatedResponse } from "@/types/api";

function statusTag(status: string) {
  const color = status === "completed" ? "green" : status === "failed" ? "red" : "blue";
  const label = status === "completed" ? "已完成" : status === "failed" ? "失败" : "运行中";
  return <Tag color={color}>{label}</Tag>;
}

export default function BacktestPage() {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Key[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const { data } = useQuery({
    queryKey: ["backtests", page, pageSize],
    queryFn: async () => (await apiClient.get<PaginatedResponse<BacktestItem>>("/admin/backtests", { params: { page, size: pageSize } })).data,
  });
  return <AuthGuard><AdminShell>
    <Space className="mb-4 w-full justify-between" align="start">
      <div>
        <Typography.Title level={2} className="!mb-1">回测历史</Typography.Title>
        <Typography.Text type="secondary">共 {data?.total ?? 0} 条记录。点击任意回测记录，查看收益曲线、回撤曲线、交易明细和完整风险指标。</Typography.Text>
      </div>
      <Button type="primary" disabled={selectedIds.length < 2} onClick={() => router.push(`/backtest/compare?ids=${selectedIds.join(",")}`)}>
        对比所选回测（{selectedIds.length}）
      </Button>
    </Space>
    <Table
      rowKey="id"
      dataSource={sortByDateDesc(data?.items ?? [], (item) => item.created_at)}
      pagination={{ current: page, pageSize, total: data?.total ?? 0, showSizeChanger: true, showTotal: (total) => `共 ${total} 条`, onChange: (nextPage, nextSize) => { setPage(nextPage); if (nextSize !== pageSize) { setPageSize(nextSize); setPage(1); } } }}
      rowSelection={{ selectedRowKeys: selectedIds, onChange: setSelectedIds }}
      onRow={(record) => ({ onClick: () => router.push(`/backtest/${record.id}`), className: "cursor-pointer" })}
      columns={[
        { title: "回测 ID", dataIndex: "id" },
        { title: "标的", dataIndex: "stock_id", render: (value, record) => record.stock_symbol ? `${record.stock_symbol} (#${value})` : `#${value}` },
        { title: "策略", dataIndex: "config_id", render: (value, record) => record.strategy_name ? `${record.strategy_name} (#${value})` : `策略 #${value}` },
        { title: "状态", dataIndex: "status", render: statusTag },
        { title: "策略收益率", dataIndex: "total_return", render: formatPercent },
        { title: "最大回撤", dataIndex: "max_drawdown", render: formatPercent },
        { title: "Sharpe 夏普", dataIndex: "sharpe_ratio", render: formatRatio },
        { title: "交易次数", dataIndex: "num_trades", render: formatInteger },
        { title: "创建时间", dataIndex: "created_at", defaultSortOrder: "descend", sorter: (a, b) => -dateDesc(a.created_at, b.created_at) },
        { title: "详情", render: (_, record) => <Button onClick={(event) => { event.stopPropagation(); router.push(`/backtest/${record.id}`); }}>查看详情</Button> },
      ]}
    />
  </AdminShell></AuthGuard>;
}
