"use client";

import { BarChartOutlined, BellOutlined, CloseOutlined, CloudDownloadOutlined, DashboardOutlined, ExperimentOutlined, LineChartOutlined, LogoutOutlined, MenuFoldOutlined, MenuOutlined, MenuUnfoldOutlined, NotificationOutlined, StockOutlined, ThunderboltOutlined, UserOutlined } from "@ant-design/icons";
import { Menu, Button, Typography, Space, Tag, Grid } from "antd";
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
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const screens = Grid.useBreakpoint();
  const isMobile = screens.md === false;
  const currentItem = items.find((item) => item.key === selected);

  useEffect(() => {
    apiClient.get("/admin/dashboard/stats").then(({ data }) => setStats(data)).catch(() => {});
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  function logout() {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    router.push("/login");
  }

  return (
    <div className="admin-shell flex h-screen overflow-hidden">
      {isMobile && mobileOpen && <button aria-label="关闭菜单遮罩" className="admin-mobile-mask" onClick={() => setMobileOpen(false)} />}

      <aside className={`admin-sidebar flex h-full shrink-0 flex-col ${collapsed && !isMobile ? "w-[76px]" : "w-[260px]"} ${mobileOpen ? "is-open" : ""}`}>
        <div className={`px-4 py-4 ${collapsed && !isMobile ? "px-3" : ""}`}>
          <div className={`mb-4 flex items-center gap-3 ${collapsed && !isMobile ? "justify-center" : ""}`}>
            <div className="admin-brand-mark">
              <BarChartOutlined className="text-xl text-white" />
            </div>
            {(!collapsed || isMobile) && (
              <div className="min-w-0">
                <Typography.Title level={5} className="!m-0 !text-white">Trend-Scope</Typography.Title>
                <Typography.Text className="text-xs text-slate-400">Investment Command Center</Typography.Text>
              </div>
            )}
            {isMobile && (
              <Button type="text" icon={<CloseOutlined />} className="ml-auto !text-slate-300 hover:!text-white" onClick={() => setMobileOpen(false)} />
            )}
          </div>
          {stats && (!collapsed || isMobile) && (
            <div className="grid grid-cols-3 gap-2 rounded-2xl border border-slate-700/70 bg-white/[0.06] p-2.5 shadow-inner shadow-white/5">
              <div className="rounded-xl bg-slate-950/30 px-2 py-2 text-center"><Typography.Text className="block text-[11px] text-slate-400">标的</Typography.Text><Typography.Text className="text-sm font-semibold text-white">{stats.stocks}</Typography.Text></div>
              <div className="rounded-xl bg-slate-950/30 px-2 py-2 text-center"><Typography.Text className="block text-[11px] text-slate-400">策略</Typography.Text><Typography.Text className="text-sm font-semibold text-white">{stats.strategies}</Typography.Text></div>
              <div className="rounded-xl bg-slate-950/30 px-2 py-2 text-center"><Typography.Text className="block text-[11px] text-slate-400">信号</Typography.Text><Typography.Text className="text-sm font-semibold text-white">{stats.signals}</Typography.Text></div>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto border-t border-slate-800">
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[selected]}
            items={items}
            inlineCollapsed={collapsed && !isMobile}
            className="!border-r-0 py-3"
            onClick={({ key }) => router.push(key)}
          />
        </div>

        <div className={`shrink-0 border-t border-slate-800 px-4 py-3 ${collapsed && !isMobile ? "text-center" : ""}`}>
          {collapsed && !isMobile ? (
            <Button type="text" size="small" icon={<LogoutOutlined />} className="!text-slate-400 hover:!text-white" onClick={logout} />
          ) : (
            <Space className="w-full justify-between">
              <Tag color={stats ? "green" : "default"}>{stats ? "系统运行中" : "连接中"}</Tag>
              <Button type="text" size="small" icon={<LogoutOutlined />} className="!text-slate-400 hover:!text-white" onClick={logout}>
                退出
              </Button>
            </Space>
          )}
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="admin-topbar flex h-16 shrink-0 items-center justify-between px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {isMobile ? (
              <Button icon={<MenuOutlined />} onClick={() => setMobileOpen(true)} />
            ) : (
              <Button type="text" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setCollapsed((value) => !value)} />
            )}
            <div className="min-w-0">
              <Typography.Text strong className="block text-base !text-slate-100">{currentItem?.label ?? "管理后台"}</Typography.Text>
              <Typography.Text className="text-xs !text-slate-400">Trend-Scope Admin Console</Typography.Text>
            </div>
          </div>
          <Space size="middle">
            <Tag color={stats ? "blue" : "default"} className="hidden sm:inline-flex">{stats ? "实时数据" : "加载中"}</Tag>
            <Button onClick={logout} icon={<LogoutOutlined />} size="small">退出登录</Button>
          </Space>
        </header>
        <main className="admin-main flex-1 overflow-y-auto p-6 lg:p-8">
          <div className="admin-content">{children}</div>
        </main>
      </div>
    </div>
  );
}
