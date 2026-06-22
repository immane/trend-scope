"use client";

import { CloudDownloadOutlined, DatabaseOutlined, DeleteOutlined, ReloadOutlined, SyncOutlined } from "@ant-design/icons";
import { Button, Card, Col, Popconfirm, Row, Space, Statistic, Table, Tag, Typography, message } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import AdminShell from "@/components/layout/AdminShell";
import AuthGuard from "@/components/layout/AuthGuard";
import apiClient from "@/lib/api";
import { formatInteger } from "@/lib/format";
import type { PaginatedResponse } from "@/types/api";

interface PriceDataItem {
  stock_id: number;
  symbol: string;
  stock_name: string;
  total_rows: number;
  earliest_date: string | null;
  latest_date: string | null;
  data_source: string;
}

function sourceTag(source: string) {
  if (source === "yfinance") return <Tag color="blue">yfinance</Tag>;
  if (source === "dev_fallback") return <Tag color="orange">dev fallback</Tag>;
  if (source === "none") return <Tag color="default">无数据</Tag>;
  return <Tag>{source}</Tag>;
}

export default function DataManagementPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const { data, refetch } = useQuery({
    queryKey: ["price-data", page, pageSize],
    queryFn: async () => (await apiClient.get<PaginatedResponse<PriceDataItem>>("/admin/price-data", { params: { page, size: pageSize } })).data,
  });

  async function handleDelete(stockId: number, symbol: string) {
    await apiClient.delete(`/admin/price-data/${stockId}`);
    message.success(`已删除 ${symbol} 的全部价格数据`);
    refetch();
  }

  async function handleSync(stockId: number, symbol: string) {
    message.loading({ content: `正在同步 ${symbol} 行情...`, key: "sync" });
    const { data: result } = await apiClient.post(`/admin/stocks/${stockId}/sync`);
    message.success({ content: `${symbol} 同步完成，新增 ${result.new_rows} 行`, key: "sync" });
    refetch();
  }

  const totalRows = data?.items.reduce((sum, item) => sum + item.total_rows, 0) ?? 0;
  const sources = Array.from(new Set(data?.items.map((item) => item.data_source) ?? []));

  return (
    <AuthGuard>
      <AdminShell>
        <div className="mb-4">
          <Typography.Title level={2} className="!mb-1">数据管理</Typography.Title>
          <Typography.Text type="secondary">查看已下载的行情数据概况，管理历史价格数据源和存储。</Typography.Text>
        </div>

        <Row gutter={[16, 16]} className="mb-6">
          <Col xs={12} md={8} lg={6}>
            <Card hoverable>
              <div className="mb-3 flex items-center justify-between">
                <Typography.Text type="secondary">标的数量</Typography.Text>
                <DatabaseOutlined style={{ fontSize: 24, color: "#2563eb" }} />
              </div>
              <Statistic value={data?.total ?? 0} />
            </Card>
          </Col>
          <Col xs={12} md={8} lg={6}>
            <Card hoverable>
              <div className="mb-3 flex items-center justify-between">
                <Typography.Text type="secondary">总数据行数</Typography.Text>
                <CloudDownloadOutlined style={{ fontSize: 24, color: "#059669" }} />
              </div>
              <Statistic value={totalRows} formatter={(value) => formatInteger(value as number)} />
            </Card>
          </Col>
          <Col xs={12} md={8} lg={6}>
            <Card hoverable>
              <div className="mb-3 flex items-center justify-between">
                <Typography.Text type="secondary">数据来源</Typography.Text>
                <SyncOutlined style={{ fontSize: 24, color: "#ea580c" }} />
              </div>
              <Space wrap>{sources.map((src) => sourceTag(src))}</Space>
            </Card>
          </Col>
          <Col xs={12} md={8} lg={6}>
            <Card hoverable>
              <div className="mb-3 flex items-center justify-between">
                <Typography.Text type="secondary">操作</Typography.Text>
                <ReloadOutlined style={{ fontSize: 24, color: "#7c3aed" }} />
              </div>
              <Button onClick={() => refetch()} icon={<ReloadOutlined />} block>刷新列表</Button>
            </Card>
          </Col>
        </Row>

        <Table<PriceDataItem>
          rowKey="stock_id"
          dataSource={data?.items ?? []}
          pagination={{ current: page, pageSize, total: data?.total ?? 0, showSizeChanger: true, showTotal: (total) => `共 ${total} 个标的`, onChange: (nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize); } }}
          columns={[
            { title: "标的", dataIndex: "symbol", render: (value, record) => <Space><strong>{value}</strong><Typography.Text type="secondary">{record.stock_name}</Typography.Text></Space> },
            { title: "数据行数", dataIndex: "total_rows", render: (value) => formatInteger(value), sorter: (a, b) => a.total_rows - b.total_rows },
            { title: "最早日期", dataIndex: "earliest_date", render: (value) => value ?? "--" },
            { title: "最近日期", dataIndex: "latest_date", render: (value) => value ?? "--" },
            { title: "数据源", dataIndex: "data_source", render: sourceTag },
            {
              title: "操作",
              render: (_, record) => (
                <Space size="small">
                  <Button size="small" icon={<SyncOutlined />} onClick={() => handleSync(record.stock_id, record.symbol)}>同步</Button>
                  <Popconfirm title={`确认删除 ${record.symbol} 的全部价格数据？`} onConfirm={() => handleDelete(record.stock_id, record.symbol)} okText="删除" cancelText="取消">
                    <Button size="small" danger icon={<DeleteOutlined />}>清除数据</Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </AdminShell>
    </AuthGuard>
  );
}
