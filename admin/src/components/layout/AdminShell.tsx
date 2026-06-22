"use client";

import { BarChartOutlined, BellOutlined, CloudDownloadOutlined, DashboardOutlined, ExperimentOutlined, LineChartOutlined, LogoutOutlined, NotificationOutlined, StockOutlined, ThunderboltOutlined, UserOutlined } from "@ant-design/icons";
import { Menu, Button, Typography, Space, Tag } from "antd";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import apiClient from "@/lib/api";

const items = [
  { key: "/dashboard", icon: <DashboardOutlined />, label: "Dashboard" },
  { key: "/stocks", icon: <StockOutlined />, label: "标的管理" },
  { key: "/strategies", icon: <ThunderboltOutlined />, label: "策略管理" },
  { key: "/backtest", icon: <ExperimentOutlined />, label: "回测历史" },
  { key: "/signals", icon: <LineChartOutlined />, label: "信号" },
  { key: "/alerts", icon: <BellOutlined />, label: "提醒日志" },
  { key: "/rules", icon: <BellOutlined />, label: "提醒规则" },
  { key: "/users", icon: <UserOutlined />, label: "用户管理" },
  { key: "/announcements", icon: <NotificationOutlined />, label: "内容管理" },
  { key: "/data", icon: <CloudDownloadOutlined />, label: "数据管理" },
];

export default function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const selected = items.find((item) => pathname.startsWith(item.key))?.key || "/dashboard";
  const [stats, setStats] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    apiClient.get("/admin/dashboard/stats").then(({ data }) => setStats(data)).catch(() => {});
  }, []);

  function logout() {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    router.push("/login");
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="flex h-full w-[240px] shrink-0 flex-col bg-slate-950">
        {/* Brand */}
        <div className="px-5 py-4">
          <div className="mb-3 flex items-center gap-3">
            <BarChartOutlined className="text-2xl text-blue-400" />
            <div>
              <Typography.Title level={5} className="!m-0 !text-white">Trend-Scope</Typography.Title>
              <Typography.Text className="text-xs text-slate-400">Phase 1 MVP</Typography.Text>
            </div>
          </div>
          {stats && (
            <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-slate-800 p-2">
              <div className="text-center"><Typography.Text className="block text-xs text-slate-400">标的</Typography.Text><Typography.Text className="text-sm font-semibold text-white">{stats.stocks}</Typography.Text></div>
              <div className="text-center"><Typography.Text className="block text-xs text-slate-400">策略</Typography.Text><Typography.Text className="text-sm font-semibold text-white">{stats.strategies}</Typography.Text></div>
              <div className="text-center"><Typography.Text className="block text-xs text-slate-400">信号</Typography.Text><Typography.Text className="text-sm font-semibold text-white">{stats.signals}</Typography.Text></div>
            </div>
          )}
        </div>

        {/* Menu - fills remaining space */}
        <div className="flex-1 overflow-y-auto border-t border-slate-800">
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[selected]}
            items={items}
            className="!border-r-0"
            onClick={({ key }) => router.push(key)}
          />
        </div>

        {/* Footer - always at bottom */}
        <div className="shrink-0 border-t border-slate-800 px-5 py-3">
          <Space className="w-full justify-between">
            <Tag color={stats ? "green" : "default"}>{stats ? "运行中" : "加载中..."}</Tag>
            <Button type="text" size="small" icon={<LogoutOutlined />} className="text-slate-400 hover:text-white" onClick={logout}>
              退出
            </Button>
          </Space>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-6 shadow">
          <div className="flex items-center gap-3">
            <BarChartOutlined className="text-lg text-blue-400" />
            <Typography.Text strong className="text-base text-white">管理后台</Typography.Text>
          </div>
          <Button ghost onClick={logout} icon={<LogoutOutlined />} size="small" className="border-slate-500 text-slate-300 hover:text-white">退出登录</Button>
        </header>
        <main className="flex-1 overflow-y-auto bg-slate-50 p-6">{children}</main>
      </div>
    </div>
  );
}
