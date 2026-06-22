"use client";

import { DashboardOutlined, LineChartOutlined, BellOutlined, ExperimentOutlined, StockOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Layout, Menu, Button, Typography } from "antd";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

const { Header, Sider, Content } = Layout;

const items = [
  { key: "/dashboard", icon: <DashboardOutlined />, label: "Dashboard" },
  { key: "/stocks", icon: <StockOutlined />, label: "标的管理" },
  { key: "/strategies", icon: <ThunderboltOutlined />, label: "策略管理" },
  { key: "/backtest", icon: <ExperimentOutlined />, label: "回测历史" },
  { key: "/signals", icon: <LineChartOutlined />, label: "信号" },
  { key: "/alerts", icon: <BellOutlined />, label: "提醒日志" },
];

export default function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const selected = items.find((item) => pathname.startsWith(item.key))?.key || "/dashboard";

  function logout() {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    router.push("/login");
  }

  return (
    <Layout className="min-h-screen">
      <Sider width={232} className="bg-slate-950">
        <div className="px-5 py-5">
          <Typography.Title level={4} className="!m-0 !text-white">Trend-Scope</Typography.Title>
          <p className="mt-1 text-xs text-slate-400">Phase 1 Admin</p>
        </div>
        <Menu theme="dark" mode="inline" selectedKeys={[selected]} items={items} onClick={({ key }) => router.push(key)} />
      </Sider>
      <Layout>
        <Header className="flex items-center justify-between bg-white px-6 shadow-sm">
          <Typography.Text strong>管理后台</Typography.Text>
          <Button onClick={logout}>退出登录</Button>
        </Header>
        <Content className="bg-slate-50 p-6">{children}</Content>
      </Layout>
    </Layout>
  );
}
