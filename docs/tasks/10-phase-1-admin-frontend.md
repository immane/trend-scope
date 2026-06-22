# Task 10: Phase 1 Admin Frontend — Next.js 14 Admin Panel

> **Status**: Completed ✅
> **Estimated Time**: 4-5 days
> **Depends On**: [Task 03 — 认证系统](03-phase-1-auth.md), [Task 04 — 股票数据](04-phase-1-stock-data.md), [Task 05 — 策略引擎](05-phase-1-strategy-engine.md), [Task 07 — 回测系统](07-phase-1-backtest.md), [Task 08 — AI分析](08-phase-1-ai-analysis.md), [Task 09 — 提醒邮件](09-phase-1-alert-email.md)
> **Required By**: [Task 11 — 集成测试](11-phase-1-integration-test.md)
> **参考设计文档**:
> - [001-preliminary-design.md](../design/001-preliminary-design.md) — 总体架构
> - [phase-1.md](../design/phase-1.md) — Phase 1 MVP 详细设计
> - [003-charting.md](../research/003-charting.md) — K线图表研究

> **Prerequisite**: The `admin/` directory must already exist from Task 01 (`npx create-next-app@14 admin --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"`). All backend APIs at `http://localhost:8000/api/v1` must be running.

---

## 1. Objective

Build the complete Next.js 14 admin panel (all 8 page routes) using App Router, Ant Design 5.x, TradingView Lightweight Charts, Monaco Editor, React Query v5, and axios. The panel provides full CRUD for stocks and strategies, a K-line chart viewer, an embedded backtest panel, signal/alert logs, and an AI analysis modal.

---

## 2. Tech Stack & Dependencies

Add these to `admin/package.json` (the project was already scaffolded with Next.js 14, TypeScript 5.x, Tailwind in Task 01):

```json
{
  "dependencies": {
    "@ant-design/icons": "^5.6.1",
    "@monaco-editor/react": "^4.7.0",
    "@tanstack/react-query": "^5.62.0",
    "@tradingview/lightweight-charts": "^5.2.0",
    "antd": "^5.24.0",
    "axios": "^1.7.9",
    "dayjs": "^1.11.13"
  }
}
```

Run: `npm install` inside `admin/`.

---

## 3. Environment Variables

Create `admin/.env.local`:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1
```

---

## 4. Files to Create (in order)

```
admin/src/
├── types/
│   └── api.ts                          # 4.1  All TypeScript interfaces
├── lib/
│   ├── api.ts                          # 4.2  Axios instance + typed helpers
│   └── auth.ts                         # 4.3  JWT token utilities
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx                 # 4.4  AntD Menu sidebar
│   │   ├── Header.tsx                  # 4.5  Top bar with user email + logout
│   │   └── AuthGuard.tsx               # 4.6  Auth check wrapper
│   ├── charts/
│   │   ├── KlineChart.tsx              # 4.13 Dynamic import wrapper
│   │   └── KlineChartInner.tsx         # 4.13 TradingView LWC K-line chart
│   └── backtest/
│       └── BacktestPanel.tsx           # 4.17 Embedded backtest UI
└── app/
    ├── layout.tsx                      # 4.7  Root layout with AntD + auth
    ├── login/
    │   └── page.tsx                    # 4.8  Login form
    ├── dashboard/
    │   └── page.tsx                    # 4.9  Dashboard stats + recent signals
    ├── stocks/
    │   ├── page.tsx                    # 4.10 Stock list table
    │   ├── create/
    │   │   └── page.tsx                # 4.11 Add stock form
    │   └── [id]/
    │       └── page.tsx                # 4.12 Stock detail + K-line
    ├── strategies/
    │   ├── page.tsx                    # 4.14 Strategy list table
    │   ├── create/
    │   │   └── page.tsx                # 4.15 Create strategy form
    │   └── [id]/
    │       └── page.tsx                # 4.16 Strategy detail + tabs + backtest
    ├── backtest/
    │   └── page.tsx                    # 4.18 Backtest history
    ├── signals/
    │   └── page.tsx                    # 4.19 Signal list + AI modal
    └── alerts/
        └── page.tsx                    # 4.20 Alert logs
```

---

## Phase 10A: Foundation (do first, blocks everything else)

### 4.1 `types/api.ts` — TypeScript Interfaces

All interfaces match backend Pydantic schemas. Create this file FIRST since every other file imports from it.

```typescript
// admin/src/types/api.ts

// ─── Auth ───────────────────────────────────────────────
export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name?: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface User {
  id: number;
  email: string;
  name: string | null;
  role: "admin" | "user";
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
}

export interface UserSession {
  session_id: string;
  user_id: number;
  ip_address: string;
  user_agent: string;
  created_at: string;
  expires_at: string;
}

// ─── Stock & K-line ────────────────────────────────────
export type StockType = "ETF" | "Stock" | "Index";

export interface Stock {
  id: number;
  symbol: string;
  name: string;
  type: StockType;
  sector: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
}

export interface StockCreate {
  symbol: string;
  name: string;
  type: StockType;
  sector?: string;
}

export interface StockUpdate {
  symbol?: string;
  name?: string;
  type?: StockType;
  sector?: string;
  is_active?: boolean;
}

export interface KlinePoint {
  date: string;         // "YYYY-MM-DD"
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ma20: number | null;
  ma60: number | null;
}

export interface KlineResponse {
  symbol: string;
  period: string;
  data: KlinePoint[];
}

// ─── Strategy / Analysis Config ─────────────────────────
export type StrategyType = "ma_cross" | "multi_indicator" | "custom_script";

export interface MaCrossParams {
  ma_short: number;   // default 20
  ma_long: number;    // default 60
  confirm_bars: number; // default 0
  volume_confirm: boolean; // default false
}

export interface MultiIndicatorParams {
  indicators: {
    name: string;        // "MA" | "RSI" | "MACD"
    weight: number;      // 0.0-1.0, sum across indicators = 1.0
  }[];
}

export interface StrategyCreate {
  name: string;
  description?: string;
  stock_id: number;
  strategy_type: StrategyType;
  params?: MaCrossParams | MultiIndicatorParams;
  script_content?: string;
  script_params?: Record<string, unknown>;
  is_active?: boolean;
}

export interface StrategyUpdate {
  name?: string;
  description?: string;
  stock_id?: number;
  strategy_type?: StrategyType;
  params?: MaCrossParams | MultiIndicatorParams;
  script_content?: string;
  script_params?: Record<string, unknown>;
  is_active?: boolean;
}

export interface StrategyOut {
  id: number;
  name: string;
  description: string | null;
  stock_id: number;
  stock_symbol: string;    // joined from stocks table
  stock_name: string;      // joined from stocks table
  strategy_type: StrategyType;
  params: Record<string, unknown> | null;
  script_content: string | null;
  script_params: Record<string, unknown> | null;
  is_active: boolean;
  last_signal_at: string | null;
  created_at: string;
  updated_at: string | null;
}

// ─── Signals ────────────────────────────────────────────
export type SignalType = "buy" | "sell";
export type SignalSubType = "golden_cross" | "death_cross" | "rsi_oversold"
  | "rsi_overbought" | "macd_cross_up" | "macd_cross_down"
  | "custom_long" | "custom_short";

export interface AnalysisSignal {
  id: number;
  stock_id: number;
  config_id: number;
  signal_type: SignalType;
  signal_subtype: SignalSubType;
  strategy_name: string;
  strength: number;       // 0.0-1.0
  triggered_date: string;
  price: number;
  is_active: boolean;
  created_at: string;
}

export interface SignalOut {
  id: number;
  stock_id: number;
  stock_symbol: string;
  stock_name: string;
  config_id: number;
  strategy_name: string;
  signal_type: SignalType;
  signal_subtype: SignalSubType;
  strength: number;
  triggered_date: string;
  price: number;
  is_active: boolean;
  created_at: string;
}

// ─── Signal Marker (for chart overlay) ──────────────────
export interface SignalMarker {
  date: string;
  type: SignalType;
  text: string;          // e.g. "Gold Cross"
  price: number;
}

// ─── Backtest ───────────────────────────────────────────
export interface BacktestRunRequest {
  stock_id: number;
  config_id: number;
  start_date: string;    // "YYYY-MM-DD"
  end_date: string;      // "YYYY-MM-DD"
  initial_capital: number;
  slippage_pct: number;  // e.g. 0.0005
  commission_pct: number; // e.g. 0.001
}

export interface BacktestMetrics {
  total_return: number;    // decimal, e.g. 0.3521
  cagr: number;
  max_drawdown: number;    // negative, e.g. -0.1832
  sharpe_ratio: number;
  sortino_ratio: number;
  calmar_ratio: number;
  win_rate: number;
  profit_factor: number;
  num_trades: number;
  benchmark_return: number; // e.g. 0.2815
}

export interface EquityPoint {
  date: string;
  equity: number;
}

export interface DrawdownPoint {
  date: string;
  drawdown_pct: number;
}

export interface MonthlyReturn {
  year_month: string;  // "2023-01"
  return_pct: number;
}

export interface BacktestResult {
  id: number;
  config_id: number;
  stock_id: number;
  status: "pending" | "running" | "completed" | "failed";
  start_date: string;
  end_date: string;
  initial_capital: number;
  metrics: BacktestMetrics | null;
  equity_curve: EquityPoint[];
  drawdown_curve: DrawdownPoint[];
  monthly_returns: MonthlyReturn[];
  execution_time_ms: number;
  created_at: string;
}

export interface BacktestHistoryItem {
  id: number;
  config_id: number;
  strategy_name: string;
  stock_symbol: string;
  stock_name: string;
  status: string;
  start_date: string;
  end_date: string;
  initial_capital: number;
  total_return: number | null;
  sharpe_ratio: number | null;
  max_drawdown: number | null;
  created_at: string;
}

// ─── AI Analysis ────────────────────────────────────────
export interface AIAnalysisResponse {
  id: number;
  signal_id: number;
  summary: string;
  why_buy: string | null;
  why_sell: string | null;
  risks: string | null;
  stop_loss: number | null;
  targets: number[] | null;
  confidence: number | null;
  disclaimer: string | null;
  created_at: string;
}

// ─── Alerts ─────────────────────────────────────────────
export type AlertChannel = "email" | "sms" | "push";
export type AlertStatus = "sent" | "failed" | "pending";

export interface AlertRuleCreate {
  stock_id: number;
  signal_types: SignalType[];
  channel: AlertChannel;
  is_enabled?: boolean;
}

export interface AlertRuleOut {
  id: number;
  user_id: number;
  stock_id: number;
  signal_types: SignalType[];
  channel: AlertChannel;
  is_enabled: boolean;
  created_at: string;
  updated_at: string | null;
}

export interface AlertLogOut {
  id: number;
  rule_id: number;
  signal_id: number;
  user_email: string;
  stock_symbol: string;
  signal_type: SignalType;
  channel: AlertChannel;
  title: string;
  status: AlertStatus;
  sent_at: string | null;
  error_message: string | null;
  created_at: string;
}

// ─── Dashboard ──────────────────────────────────────────
export interface DashboardStats {
  total_users: number;
  total_stocks: number;
  active_strategies: number;
  today_signals: number;
  recent_signals: SignalOut[];
}

// ─── Generic Pagination ─────────────────────────────────
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
  pages: number;
}

// ─── Chart Period ───────────────────────────────────────
export type ChartPeriod = "1M" | "3M" | "6M" | "1Y" | "ALL";

export const PERIOD_LIMIT_MAP: Record<ChartPeriod, number> = {
  "1M": 22,
  "3M": 66,
  "6M": 132,
  "1Y": 252,
  "ALL": 2000,
};

// ─── API Error ──────────────────────────────────────────
export interface ApiError {
  detail: string;
  code?: string;
}
```

### 4.2 `lib/api.ts` — Axios Instance + Typed Helpers

```typescript
// admin/src/lib/api.ts
import axios, { AxiosError } from "axios";
import { message } from "antd";
import type { ApiError } from "@/types/api";

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000/api/v1",
  timeout: 30000,
  headers: { "Content-Type": "application/json" },
});

// ── Request interceptor: attach Bearer token ──
apiClient.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("access_token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// ── Response interceptor: handle 401 → redirect to login ──
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiError>) => {
    if (error.response?.status === 401) {
      if (typeof window !== "undefined" && !window.location.pathname.includes("/login")) {
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        window.location.href = "/login";
      }
    }
    // Surface backend error messages via antd message
    if (error.response?.status && error.response?.status >= 400) {
      const detail = error.response.data?.detail || error.message;
      message.error(detail);
    }
    return Promise.reject(error);
  }
);

// ── Typed helper functions ──
export const api = {
  async get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
    const res = await apiClient.get<T>(url, { params });
    return res.data;
  },

  async post<T>(url: string, data?: unknown): Promise<T> {
    const res = await apiClient.post<T>(url, data);
    return res.data;
  },

  async patch<T>(url: string, data?: unknown): Promise<T> {
    const res = await apiClient.patch<T>(url, data);
    return res.data;
  },

  async delete(url: string): Promise<void> {
    await apiClient.delete(url);
  },
};

export default apiClient;
```

### 4.3 `lib/auth.ts` — JWT Token Utilities

```typescript
// admin/src/lib/auth.ts
const ACCESS_KEY = "access_token";
const REFRESH_KEY = "refresh_token";

interface JwtPayload {
  sub: string;     // user id as string
  iat: number;
  exp: number;
  type: "access" | "refresh";
}

function decodeJwt(token: string): JwtPayload | null {
  try {
    const base64 = token.split(".")[1]!;
    const json = atob(base64.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function setTokens(access: string, refresh: string): void {
  localStorage.setItem(ACCESS_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export function isAuthenticated(): boolean {
  const token = getAccessToken();
  if (!token) return false;
  const payload = decodeJwt(token);
  if (!payload) return false;
  // Check token not expired (with 10s grace period)
  return payload.exp * 1000 > Date.now() + 10_000;
}

export function getCurrentUser(): { id: number; role: string } | null {
  const token = getAccessToken();
  if (!token) return null;
  const payload = decodeJwt(token);
  if (!payload) return null;
  return { id: Number(payload.sub), role: payload.type === "access" ? "user" : "user" };
  // Note: role is NOT in the JWT in this design; fetch /users/me for role if needed.
}

export async function refreshAccessToken(): Promise<boolean> {
  const refresh = getRefreshToken();
  if (!refresh) return false;

  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_BASE_URL}/auth/refresh`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refresh }),
      }
    );
    if (!res.ok) {
      clearTokens();
      return false;
    }
    const data = await res.json();
    setTokens(data.access_token, data.refresh_token);
    return true;
  } catch {
    clearTokens();
    return false;
  }
}
```

### 4.4 `components/layout/Sidebar.tsx` — AntD Menu Sidebar

```tsx
// admin/src/components/layout/Sidebar.tsx
"use client";

import { usePathname, useRouter } from "next/navigation";
import { Menu } from "antd";
import type { MenuProps } from "antd";
import {
  DashboardOutlined,
  StockOutlined,
  CodeOutlined,
  BarChartOutlined,
  ThunderboltOutlined,
  BellOutlined,
} from "@ant-design/icons";
import { useState } from "react";

const menuItems: MenuProps["items"] = [
  { key: "/dashboard", icon: <DashboardOutlined />, label: "Dashboard" },
  { key: "/stocks", icon: <StockOutlined />, label: "标的管理" },
  { key: "/strategies", icon: <CodeOutlined />, label: "策略管理" },
  { key: "/backtest", icon: <BarChartOutlined />, label: "回测记录" },
  { key: "/signals", icon: <ThunderboltOutlined />, label: "信号管理" },
  { key: "/alerts", icon: <BellOutlined />, label: "提醒日志" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

  const selectedKey = "/" + (pathname.split("/").slice(1, 3).join("/") || "dashboard");
  // Handle nested routes: /stocks/create -> select /stocks; /strategies/3 -> select /strategies
  const rootKey = menuItems.find(
    (item) => item && "key" in item && selectedKey.startsWith(item.key as string)
  )?.key as string | undefined;

  return (
    <div style={{ height: "100vh", overflow: "auto" }}>
      <div
        style={{
          height: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          fontSize: collapsed ? 16 : 20,
          color: "#1677ff",
          borderBottom: "1px solid #f0f0f0",
        }}
      >
        {collapsed ? "TS" : "TrendScope"}
      </div>
      <Menu
        mode="inline"
        selectedKeys={[rootKey || selectedKey]}
        items={menuItems}
        onClick={({ key }) => router.push(key)}
        inlineCollapsed={collapsed}
        style={{ borderInlineEnd: "none" }}
      />
    </div>
  );
}
```

### 4.5 `components/layout/Header.tsx` — Top Bar

```tsx
// admin/src/components/layout/Header.tsx
"use client";

import { Layout, Space, Typography, Button } from "antd";
import { LogoutOutlined, UserOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { clearTokens } from "@/lib/auth";
import { useEffect, useState } from "react";

const { Header: AntHeader } = Layout;
const { Text } = Typography;

export default function Header() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    // Try to decode email from JWT or fetch /users/me
    // Simple approach: read from localStorage (set during login)
    const stored = localStorage.getItem("user_email");
    if (stored) setEmail(stored);
  }, []);

  const handleLogout = () => {
    clearTokens();
    localStorage.removeItem("user_email");
    router.push("/login");
  };

  return (
    <AntHeader
      style={{
        background: "#fff",
        padding: "0 24px",
        display: "flex",
        justifyContent: "flex-end",
        alignItems: "center",
        borderBottom: "1px solid #f0f0f0",
      }}
    >
      <Space>
        <UserOutlined />
        <Text>{email || "Admin"}</Text>
        <Button type="text" icon={<LogoutOutlined />} onClick={handleLogout} danger>
          退出
        </Button>
      </Space>
    </AntHeader>
  );
}
```

### 4.6 `components/layout/AuthGuard.tsx` — Auth Check Wrapper (Client Component)

```tsx
// admin/src/components/layout/AuthGuard.tsx
"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Spin } from "antd";
import { isAuthenticated } from "@/lib/auth";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (pathname === "/login") {
      setChecking(false);
      return;
    }
    if (!isAuthenticated()) {
      router.replace("/login");
    } else {
      setChecking(false);
    }
  }, [pathname, router]);

  if (checking || pathname === "/login") {
    return <>{children}</>;
  }

  if (!isAuthenticated()) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
        <Spin size="large" tip="Redirecting to login..." />
      </div>
    );
  }

  return <>{children}</>;
}
```

### 4.7 `app/layout.tsx` — Root Layout with AntD ConfigProvider

```tsx
// admin/src/app/layout.tsx
"use client";

import { ConfigProvider, Layout, App as AntApp } from "antd";
import zhCN from "antd/locale/zh_CN";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { usePathname } from "next/navigation";
import AuthGuard from "@/components/layout/AuthGuard";
import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import "./globals.css"; // Tailwind base + any custom styles

const { Sider, Content } = Layout;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } }));
  const pathname = usePathname();

  const isLoginPage = pathname === "/login";

  return (
    <html lang="zh-CN">
      <body>
        <QueryClientProvider client={queryClient}>
          <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: "#1677ff" } }}>
            <AntApp>
              <AuthGuard>
                {isLoginPage ? (
                  children
                ) : (
                  <Layout style={{ minHeight: "100vh" }}>
                    <Sider
                      width={220}
                      style={{ background: "#fff" }}
                      breakpoint="lg"
                      collapsible
                    >
                      <Sidebar />
                    </Sider>
                    <Layout>
                      <Header />
                      <Content style={{ margin: 24, padding: 24, background: "#fff", borderRadius: 8, minHeight: 360 }}>
                        {children}
                      </Content>
                    </Layout>
                  </Layout>
                )}
              </AuthGuard>
            </AntApp>
          </ConfigProvider>
        </QueryClientProvider>
      </body>
    </html>
  );
}
```

### 4.8 `app/login/page.tsx` — Login Form

```tsx
// admin/src/app/login/page.tsx
"use client";

import { Button, Card, Form, Input, Typography, message } from "antd";
import { UserOutlined, LockOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { setTokens } from "@/lib/auth";
import type { TokenResponse, LoginRequest } from "@/types/api";

const { Title } = Typography;

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const onFinish = async (values: LoginRequest) => {
    setLoading(true);
    try {
      const data = await api.post<TokenResponse>("/auth/login", values);
      setTokens(data.access_token, data.refresh_token);
      // Store email for header display
      localStorage.setItem("user_email", values.email);
      message.success("登录成功");
      router.push("/dashboard");
    } catch (err: any) {
      // Interceptor already shows message.error; add specific handling if needed
      if (err?.response?.status === 422) {
        message.error("请检查邮箱格式和密码");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      }}
    >
      <Card style={{ width: 400, boxShadow: "0 8px 32px rgba(0,0,0,0.15)" }}>
        <Title level={3} style={{ textAlign: "center", marginBottom: 32 }}>
          TrendScope Admin
        </Title>
        <Form<LoginRequest> layout="vertical" onFinish={onFinish} size="large">
          <Form.Item
            name="email"
            rules={[
              { required: true, message: "请输入邮箱" },
              { type: "email", message: "请输入有效的邮箱地址" },
            ]}
          >
            <Input prefix={<UserOutlined />} placeholder="邮箱" autoComplete="email" />
          </Form.Item>
          <Form.Item
            name="password"
            rules={[{ required: true, message: "请输入密码" }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="密码" autoComplete="current-password" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block>
              登录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
```


## Phase 10B: Dashboard

### 4.9 `app/dashboard/page.tsx` — Dashboard

```tsx
// admin/src/app/dashboard/page.tsx
"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, Col, Row, Statistic, Table, Tag, Button } from "antd";
import {
  UserOutlined,
  StockOutlined,
  CodeOutlined,
  ThunderboltOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { api } from "@/lib/api";
import type { DashboardStats, SignalOut, SignalType } from "@/types/api";

const signalTypeColor: Record<SignalType, string> = {
  buy: "green",
  sell: "red",
};

const signalColumns = [
  { title: "日期", dataIndex: "triggered_date", key: "date", width: 120 },
  { title: "标的", dataIndex: "stock_symbol", key: "symbol", width: 80 },
  {
    title: "类型",
    dataIndex: "signal_type",
    key: "type",
    width: 80,
    render: (t: SignalType) => <Tag color={signalTypeColor[t]}>{t === "buy" ? "买入" : "卖出"}</Tag>,
  },
  { title: "策略", dataIndex: "strategy_name", key: "strategy", ellipsis: true },
  {
    title: "强度",
    dataIndex: "strength",
    key: "strength",
    width: 80,
    render: (v: number) => (v * 100).toFixed(0) + "%",
  },
];

export default function DashboardPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching } = useQuery<DashboardStats>({
    queryKey: ["dashboard-stats"],
    queryFn: () => api.get<DashboardStats>("/admin/dashboard/stats"),
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
        <h2 style={{ margin: 0 }}>Dashboard</h2>
        <Button
          icon={<ReloadOutlined />}
          loading={isFetching}
          onClick={() => queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] })}
        >
          刷新
        </Button>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic title="用户总数" value={data?.total_users ?? 0} prefix={<UserOutlined />} loading={isLoading} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic title="标的总数" value={data?.total_stocks ?? 0} prefix={<StockOutlined />} loading={isLoading} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic title="活跃策略数" value={data?.active_strategies ?? 0} prefix={<CodeOutlined />} loading={isLoading} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic title="今日信号数" value={data?.today_signals ?? 0} prefix={<ThunderboltOutlined />} loading={isLoading} />
          </Card>
        </Col>
      </Row>

      <Card title="最近信号" style={{ marginTop: 24 }}>
        <Table<SignalOut>
          columns={signalColumns}
          dataSource={data?.recent_signals ?? []}
          rowKey="id"
          loading={isLoading}
          pagination={false}
          size="small"
        />
      </Card>
    </div>
  );
}
```


## Phase 10C: Stock Management

### 4.10 `app/stocks/page.tsx` — Stock List

```tsx
// admin/src/app/stocks/page.tsx
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Table, Button, Input, Tag, Switch, Popconfirm, Space, message } from "antd";
import { PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import type { Stock, StockType, PaginatedResponse } from "@/types/api";

const typeColor: Record<StockType, string> = {
  ETF: "blue",
  Stock: "green",
  Index: "orange",
};

export default function StocksPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, isLoading } = useQuery<PaginatedResponse<Stock>>({
    queryKey: ["stocks", search, page, pageSize],
    queryFn: () =>
      api.get<PaginatedResponse<Stock>>("/admin/stocks", {
        search,
        page,
        size: pageSize,
      }),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      api.patch(`/admin/stocks/${id}`, { is_active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["stocks"] }),
  });

  const deleteStock = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/stocks/${id}`),
    onSuccess: () => {
      message.success("标的已删除");
      queryClient.invalidateQueries({ queryKey: ["stocks"] });
    },
  });

  const columns = [
    { title: "Symbol", dataIndex: "symbol", key: "symbol", width: 100 },
    { title: "名称", dataIndex: "name", key: "name" },
    {
      title: "类型",
      dataIndex: "type",
      key: "type",
      width: 80,
      render: (t: StockType) => <Tag color={typeColor[t]}>{t}</Tag>,
    },
    { title: "行业", dataIndex: "sector", key: "sector", render: (s: string | null) => s || "-" },
    {
      title: "启用",
      dataIndex: "is_active",
      key: "is_active",
      width: 80,
      render: (v: boolean, record: Stock) => (
        <Switch
          checked={v}
          size="small"
          onChange={(checked) => toggleActive.mutate({ id: record.id, is_active: checked })}
        />
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 160,
      render: (_: unknown, record: Stock) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => router.push(`/stocks/${record.id}`)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定删除该标的？"
            description="删除后不可恢复"
            onConfirm={() => deleteStock.mutate(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <Input.Search
          placeholder="搜索 Symbol 或名称..."
          prefix={<SearchOutlined />}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          style={{ width: 300 }}
          allowClear
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push("/stocks/create")}>
          添加标的
        </Button>
      </div>
      <Table<Stock>
        columns={columns}
        dataSource={data?.items ?? []}
        rowKey="id"
        loading={isLoading}
        pagination={{
          current: page,
          pageSize,
          total: data?.total ?? 0,
          showSizeChanger: true,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />
    </div>
  );
}
```

### 4.11 `app/stocks/create/page.tsx` — Add Stock Form

```tsx
// admin/src/app/stocks/create/page.tsx
"use client";

import { useMutation } from "@tanstack/react-query";
import { Card, Form, Input, Select, Button, message, Breadcrumb } from "antd";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { StockCreate, StockType } from "@/types/api";

export default function CreateStockPage() {
  const router = useRouter();
  const [form] = Form.useForm<StockCreate>();

  const mutation = useMutation({
    mutationFn: (values: StockCreate) => api.post<unknown>("/admin/stocks", values),
    onSuccess: () => {
      message.success("标的创建成功");
      router.push("/stocks");
    },
  });

  return (
    <div>
      <Breadcrumb
        items={[
          { title: <a href="/stocks">标的管理</a> },
          { title: "添加标的" },
        ]}
        style={{ marginBottom: 16 }}
      />
      <Card title="添加新标的" style={{ maxWidth: 600 }}>
        <Form form={form} layout="vertical" onFinish={(values) => mutation.mutate(values)}>
          <Form.Item
            name="symbol"
            label="Symbol"
            rules={[{ required: true, message: "请输入股票代码" }]}
            normalize={(value: string) => value?.toUpperCase()}
          >
            <Input placeholder="如 AAPL, SPY, QQQ" />
          </Form.Item>
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: "请输入标的名称" }]}
          >
            <Input placeholder="如 Apple Inc., SPDR S&P 500 ETF" />
          </Form.Item>
          <Form.Item
            name="type"
            label="类型"
            rules={[{ required: true, message: "请选择类型" }]}
            initialValue="Stock"
          >
            <Select
              options={[
                { label: "ETF", value: "ETF" },
                { label: "Stock", value: "Stock" },
                { label: "Index", value: "Index" },
              ]}
            />
          </Form.Item>
          <Form.Item name="sector" label="行业板块">
            <Input placeholder="如 Technology, Healthcare 等" />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={mutation.isPending}>
                创建
              </Button>
              <Button onClick={() => router.back()}>取消</Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
```

### 4.12 `app/stocks/[id]/page.tsx` — Stock Detail with K-line Chart

```tsx
// admin/src/app/stocks/[id]/page.tsx
"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Card, Descriptions, Space, Table, Button, Tag, Breadcrumb, Spin } from "antd";
import { EditOutlined } from "@ant-design/icons";
import dynamic from "next/dynamic";
import { api } from "@/lib/api";
import type { Stock, KlineResponse, SignalOut, StockType, SignalType } from "@/types/api";

// Dynamic import: TradingView chart must be client-side only
const KlineChart = dynamic(() => import("@/components/charts/KlineChart"), { ssr: false });

const typeColor: Record<StockType, string> = { ETF: "blue", Stock: "green", Index: "orange" };
const signalTypeColor: Record<SignalType, string> = { buy: "green", sell: "red" };

const signalColumns = [
  { title: "日期", dataIndex: "triggered_date", key: "date", width: 120 },
  {
    title: "类型",
    dataIndex: "signal_type",
    key: "type",
    width: 80,
    render: (t: SignalType) => <Tag color={signalTypeColor[t]}>{t === "buy" ? "▲ 买入" : "▼ 卖出"}</Tag>,
  },
  { title: "策略", dataIndex: "strategy_name", key: "strategy" },
  {
    title: "强度",
    dataIndex: "strength",
    key: "strength",
    width: 80,
    render: (v: number) => (v * 100).toFixed(0) + "%",
  },
  {
    title: "操作",
    key: "actions",
    width: 120,
    dataIndex: "id",
    render: () => <Button type="link" size="small">AI 分析</Button>,
  },
];

export default function StockDetailPage() {
  const params = useParams<{ id: string }>();
  const stockId = Number(params.id);

  const { data: stock, isLoading: stockLoading } = useQuery<Stock>({
    queryKey: ["stock", stockId],
    queryFn: () => api.get<Stock>(`/stocks/${stockId}`),
    enabled: !!stockId,
  });

  const { data: kline, isLoading: klineLoading } = useQuery<KlineResponse>({
    queryKey: ["kline", stockId, "day", 252],
    queryFn: () => api.get<KlineResponse>(`/stocks/${stockId}/kline`, { period: "day", limit: 252 }),
    enabled: !!stockId,
  });

  const { data: signals } = useQuery<SignalOut[]>({
    queryKey: ["signals", stockId],
    queryFn: () => api.get<SignalOut[]>(`/analysis/${stockId}/signals`),
    enabled: !!stockId,
  });

  if (stockLoading) return <Spin size="large" style={{ display: "block", margin: "100px auto" }} />;

  return (
    <div>
      <Breadcrumb
        items={[
          { title: <a href="/stocks">标的管理</a> },
          { title: stock?.symbol || "加载中..." },
        ]}
        style={{ marginBottom: 16 }}
      />

      <Card style={{ marginBottom: 16 }}>
        <Descriptions column={4} size="small">
          <Descriptions.Item label="Symbol">{stock?.symbol}</Descriptions.Item>
          <Descriptions.Item label="名称">{stock?.name}</Descriptions.Item>
          <Descriptions.Item label="类型">
            {stock && <Tag color={typeColor[stock.type]}>{stock.type}</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="行业">{stock?.sector || "-"}</Descriptions.Item>
        </Descriptions>
        <Button icon={<EditOutlined />} style={{ marginTop: 8 }}>
          编辑
        </Button>
      </Card>

      {/* K-line Chart */}
      <Card title="K 线图" loading={klineLoading} style={{ marginBottom: 16 }}>
        {kline && (
          <KlineChart
            data={kline.data}
            signals={[]}
          />
        )}
      </Card>

      {/* Recent Signals */}
      <Card title="最近信号">
        <Table<SignalOut>
          columns={signalColumns}
          dataSource={signals ?? []}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 10 }}
        />
      </Card>
    </div>
  );
 }
```


### 4.13 `components/charts/KlineChart.tsx` + `KlineChartInner.tsx` — TradingView LWC Wrapper

**File 1: Dynamic wrapper** (`components/charts/KlineChart.tsx`):

```tsx
// admin/src/components/charts/KlineChart.tsx
import dynamic from "next/dynamic";
import type { KlinePoint, SignalMarker } from "@/types/api";

const KlineChartInner = dynamic(() => import("./KlineChartInner"), { ssr: false });

interface KlineChartProps {
  data: KlinePoint[];
  signals: SignalMarker[];
}

export default function KlineChart(props: KlineChartProps) {
  return <KlineChartInner {...props} />;
}
```

**File 2: Inner chart component** (`components/charts/KlineChartInner.tsx`):

```tsx
// admin/src/components/charts/KlineChartInner.tsx
"use client";

import { useRef, useEffect } from "react";
import {
  createChart,
  IChartApi,
  ColorType,
  CrosshairMode,
} from "@tradingview/lightweight-charts";
import { Radio, Space, theme } from "antd";
import type { KlinePoint, SignalMarker, ChartPeriod } from "@/types/api";

interface Props {
  data: KlinePoint[];
  signals: SignalMarker[];
}

const PERIOD_OPTIONS: { label: string; value: ChartPeriod }[] = [
  { label: "1M", value: "1M" },
  { label: "3M", value: "3M" },
  { label: "6M", value: "6M" },
  { label: "1Y", value: "1Y" },
  { label: "ALL", value: "ALL" },
];

export default function KlineChartInner({ data, signals }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const { token } = theme.useToken();

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    // Clean up previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = 500;

    const chart = createChart(container, {
      width,
      height,
      layout: {
        background: { type: ColorType.Solid, color: token.colorBgContainer },
        textColor: token.colorText,
      },
      grid: {
        vertLines: { color: token.colorBorderSecondary },
        horzLines: { color: token.colorBorderSecondary },
      },
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: {
        timeVisible: true,
        borderColor: token.colorBorderSecondary,
      },
      rightPriceScale: {
        borderColor: token.colorBorderSecondary,
        visible: true,
      },
    });

    chartRef.current = chart;

    // Candlestick series (OHLC)
    const candleData = data.map((d) => ({
      time: d.date,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));
    const candleSeries = chart.addCandlestickSeries({
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderUpColor: "#26a69a",
      borderDownColor: "#ef5350",
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
    });
    candleSeries.setData(candleData);

    // MA20 — orange line
    const ma20Data = data
      .filter((d) => d.ma20 !== null)
      .map((d) => ({ time: d.date, value: d.ma20! }));
    if (ma20Data.length > 0) {
      const ma20Line = chart.addLineSeries({
        color: "#FF9800",
        lineWidth: 1,
        priceLineVisible: false,
      });
      ma20Line.setData(ma20Data);
    }

    // MA60 — blue line
    const ma60Data = data
      .filter((d) => d.ma60 !== null)
      .map((d) => ({ time: d.date, value: d.ma60! }));
    if (ma60Data.length > 0) {
      const ma60Line = chart.addLineSeries({
        color: "#2196F3",
        lineWidth: 1,
        priceLineVisible: false,
      });
      ma60Line.setData(ma60Data);
    }

    // Volume — histogram on separate pane
    const volumeData = data.map((d) => ({
      time: d.date,
      value: d.volume,
      color: d.close >= d.open ? "rgba(38, 166, 154, 0.4)" : "rgba(239, 83, 80, 0.4)",
    }));
    const volumeSeries = chart.addHistogramSeries({
      color: "#26a69a",
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volumeSeries.setData(volumeData);

    // Signal markers — buy below bar, sell above bar
    if (signals.length > 0) {
      const markerData = signals
        .filter((s) => data.some((d) => d.date === s.date))
        .map((s) => ({
          time: s.date,
          position: s.type === "buy" ? ("belowBar" as const) : ("aboveBar" as const),
          color: s.type === "buy" ? "#26a69a" : "#ef5350",
          shape: s.type === "buy" ? ("arrowUp" as const) : ("arrowDown" as const),
          text: s.text,
          size: 2,
        }));
      candleSeries.setMarkers(markerData);
    }

    chart.timeScale().fitContent();

    // Resize handler
    const handleResize = () => {
      if (chartRef.current && containerRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [data, signals, token]);

  return (
    <div>
      <Space style={{ marginBottom: 8 }}>
        <span>周期:</span>
        <Radio.Group
          options={PERIOD_OPTIONS}
          defaultValue="1Y"
          optionType="button"
          buttonStyle="solid"
          size="small"
        />
      </Space>
      <div ref={containerRef} style={{ width: "100%", minHeight: 500 }} />
    </div>
  );
}
```


## Phase 10D: Strategy Management

### 4.14 `app/strategies/page.tsx` — Strategy List

```tsx
// admin/src/app/strategies/page.tsx
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Table, Button, Tag, Switch, Popconfirm, Space, message } from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined, BarChartOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import type { StrategyOut, StrategyType, PaginatedResponse } from "@/types/api";

const strategyTypeTag: Record<StrategyType, { color: string; label: string }> = {
  ma_cross: { color: "blue", label: "均线交叉" },
  multi_indicator: { color: "purple", label: "多指标" },
  custom_script: { color: "orange", label: "自定义脚本" },
};

export default function StrategiesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, isLoading } = useQuery<PaginatedResponse<StrategyOut>>({
    queryKey: ["strategies", page, pageSize],
    queryFn: () =>
      api.get<PaginatedResponse<StrategyOut>>("/admin/strategies", { page, size: pageSize }),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      api.patch(`/admin/strategies/${id}`, { is_active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["strategies"] }),
  });

  const deleteStrategy = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/strategies/${id}`),
    onSuccess: () => {
      message.success("策略已删除");
      queryClient.invalidateQueries({ queryKey: ["strategies"] });
    },
  });

  const columns = [
    { title: "名称", dataIndex: "name", key: "name", width: 200 },
    {
      title: "类型",
      dataIndex: "strategy_type",
      key: "type",
      width: 120,
      render: (t: StrategyType) => <Tag color={strategyTypeTag[t].color}>{strategyTypeTag[t].label}</Tag>,
    },
    {
      title: "标的",
      dataIndex: "stock_symbol",
      key: "stock",
      width: 100,
      render: (sym: string) => <Tag>{sym}</Tag>,
    },
    {
      title: "启用",
      dataIndex: "is_active",
      key: "active",
      width: 80,
      render: (v: boolean, record: StrategyOut) => (
        <Switch
          checked={v}
          size="small"
          onChange={(checked) => toggleActive.mutate({ id: record.id, is_active: checked })}
        />
      ),
    },
    {
      title: "最近信号",
      dataIndex: "last_signal_at",
      key: "last_signal",
      width: 120,
      render: (d: string | null) => d || "-",
    },
    {
      title: "操作",
      key: "actions",
      width: 240,
      render: (_: unknown, record: StrategyOut) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => router.push(`/strategies/${record.id}`)}>编辑</Button>
          <Button type="link" size="small" icon={<BarChartOutlined />} onClick={() => router.push(`/strategies/${record.id}?tab=backtest`)}>回测</Button>
          <Popconfirm title="确定删除该策略？" onConfirm={() => deleteStrategy.mutate(record.id)} okText="确定" cancelText="取消">
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>策略管理</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push("/strategies/create")}>新建策略</Button>
      </div>
      <Table<StrategyOut> columns={columns} dataSource={data?.items ?? []} rowKey="id" loading={isLoading}
        pagination={{ current: page, pageSize, total: data?.total ?? 0, showSizeChanger: true, onChange: (p, ps) => { setPage(p); setPageSize(ps); } }} />
    </div>
  );
}
```

### 4.15 `app/strategies/create/page.tsx` — Create Strategy Form

```tsx
// admin/src/app/strategies/create/page.tsx
"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, Form, Input, Select, Radio, InputNumber, Switch, Button, Space, Breadcrumb, message } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";
import dynamic from "next/dynamic";
import { api } from "@/lib/api";
import type { StrategyCreate, Stock, StrategyType } from "@/types/api";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

export default function CreateStrategyPage() {
  const router = useRouter();
  const [form] = Form.useForm<StrategyCreate>();
  const [strategyType, setStrategyType] = useState<StrategyType>("ma_cross");

  const { data: stocks } = useQuery<Stock[]>({
    queryKey: ["stocks-list-for-select"],
    queryFn: () => api.get<Stock[]>("/stocks"),
  });

  const createMutation = useMutation({
    mutationFn: (values: StrategyCreate) => api.post("/admin/strategies", values),
    onSuccess: () => { message.success("策略创建成功"); router.push("/strategies"); },
  });

  return (
    <div>
      <Breadcrumb items={[{ title: <a href="/strategies">策略管理</a> }, { title: "新建策略" }]} style={{ marginBottom: 16 }} />
      <Card title="新建策略" style={{ maxWidth: 800 }}>
        <Form form={form} layout="vertical"
          initialValues={{ strategy_type: "ma_cross", script_content: "# 自定义策略脚本\n# 可用变量: df (pandas DataFrame), params (dict)\n# 必须返回: list of signals [{\"date\": \"YYYY-MM-DD\", \"type\": \"buy\"/\"sell\"}]\n\ndef analyze(df, params):\n    signals = []\n    # TODO: write strategy logic\n    return signals\n", script_params: "{}" }}
          onFinish={(values) => {
            if (values.strategy_type === "custom_script" && typeof values.script_params === "string") {
              try { values.script_params = JSON.parse(values.script_params); }
              catch { message.error("脚本参数 JSON 格式错误"); return; }
            }
            createMutation.mutate(values);
          }}>
          <Form.Item name="name" label="策略名称" rules={[{ required: true, message: "请输入策略名称" }]}>
            <Input placeholder="如 MA20x60 金叉" />
          </Form.Item>
          <Form.Item name="description" label="描述"><Input.TextArea rows={2} placeholder="策略说明（可选）" /></Form.Item>
          <Form.Item name="stock_id" label="标的" rules={[{ required: true, message: "请选择标的" }]}>
            <Select showSearch placeholder="选择股票/ETF" optionFilterProp="label"
              options={stocks?.map((s) => ({ label: `${s.symbol} - ${s.name}`, value: s.id }))}
              loading={!stocks} />
          </Form.Item>
          <Form.Item name="strategy_type" label="策略类型" rules={[{ required: true }]}>
            <Radio.Group onChange={(e) => setStrategyType(e.target.value)}>
              <Radio.Button value="ma_cross">系统预设-均线交叉</Radio.Button>
              <Radio.Button value="multi_indicator">系统预设-多指标</Radio.Button>
              <Radio.Button value="custom_script">自定义脚本</Radio.Button>
            </Radio.Group>
          </Form.Item>
          {strategyType === "ma_cross" && (
            <>
              <Space size="large" wrap>
                <Form.Item name={["params", "ma_short"]} label="短期均线" initialValue={20}><InputNumber min={2} max={200} /></Form.Item>
                <Form.Item name={["params", "ma_long"]} label="长期均线" initialValue={60}><InputNumber min={2} max={500} /></Form.Item>
                <Form.Item name={["params", "confirm_bars"]} label="确认K线数" initialValue={0}><InputNumber min={0} max={10} /></Form.Item>
              </Space>
              <Form.Item name={["params", "volume_confirm"]} label="成交量确认" valuePropName="checked" initialValue={false}><Switch /></Form.Item>
            </>
          )}
          {strategyType === "custom_script" && (
            <>
              <Form.Item name="script_content" label="Python 脚本" rules={[{ required: true }]}>
                <MonacoEditor height={400} language="python" theme="vs-dark"
                  options={{ minimap: { enabled: false }, fontSize: 13, lineNumbers: "on", scrollBeyondLastLine: false, automaticLayout: true }} />
              </Form.Item>
              <Form.Item name="script_params" label="脚本参数 (JSON)"><Input.TextArea rows={4} placeholder='{"threshold": 0.05, "period": 14}' /></Form.Item>
            </>
          )}
          <Form.Item style={{ marginTop: 24 }}>
            <Space>
              <Button type="primary" htmlType="submit" loading={createMutation.isPending}>创建策略</Button>
              <Button onClick={() => router.back()}>取消</Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
```

### 4.16 `app/strategies/[id]/page.tsx` — Strategy Detail with Tabs + Embedded Backtest

```tsx
// admin/src/app/strategies/[id]/page.tsx
"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, Tabs, Form, Input, InputNumber, Switch, Button, Space, Breadcrumb, Spin, message, Descriptions, Tag, Table } from "antd";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { api } from "@/lib/api";
import type { StrategyOut, StrategyUpdate, StrategyType, SignalOut, SignalType } from "@/types/api";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });
const BacktestPanel = dynamic(() => import("@/components/backtest/BacktestPanel"), { ssr: false });

const strategyTypeTag: Record<StrategyType, { color: string; label: string }> = {
  ma_cross: { color: "blue", label: "均线交叉" },
  multi_indicator: { color: "purple", label: "多指标" },
  custom_script: { color: "orange", label: "自定义脚本" },
};
const signalTypeColor: Record<SignalType, string> = { buy: "green", sell: "red" };

export default function StrategyDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const strategyId = Number(params.id);
  const [form] = Form.useForm<StrategyUpdate>();
  const initialTab = searchParams.get("tab") || "info";
  const [activeTab, setActiveTab] = useState(initialTab);

  const { data: strategy, isLoading } = useQuery<StrategyOut>({
    queryKey: ["strategy", strategyId],
    queryFn: () => api.get<StrategyOut>(`/admin/strategies/${strategyId}`),
    enabled: !!strategyId,
  });

  const { data: signals } = useQuery<SignalOut[]>({
    queryKey: ["strategy-signals", strategyId],
    queryFn: () => api.get<SignalOut[]>(`/admin/signals?config_id=${strategyId}`),
    enabled: !!strategyId,
  });

  useEffect(() => { if (strategy) form.setFieldsValue(strategy); }, [strategy, form]);

  const updateMutation = useMutation({
    mutationFn: (values: StrategyUpdate) => api.patch(`/admin/strategies/${strategyId}`, values),
    onSuccess: () => { message.success("策略已更新"); queryClient.invalidateQueries({ queryKey: ["strategy", strategyId] }); },
  });

  if (isLoading) return <Spin size="large" style={{ display: "block", margin: "100px auto" }} />;

  const signalColumns = [
    { title: "日期", dataIndex: "triggered_date", key: "date", width: 120 },
    { title: "类型", dataIndex: "signal_type", key: "type", width: 100, render: (t: SignalType) => <Tag color={signalTypeColor[t]}>{t === "buy" ? "▲ 买入" : "▼ 卖出"}</Tag> },
    { title: "子类型", dataIndex: "signal_subtype", key: "subtype", width: 130 },
    { title: "价格", dataIndex: "price", key: "price", width: 80 },
    { title: "强度", dataIndex: "strength", key: "strength", width: 80, render: (v: number) => (v * 100).toFixed(0) + "%" },
  ];

  const tabItems = [
    { key: "info", label: "策略信息", children: (
      <Card style={{ maxWidth: 800 }}>
        <Form form={form} layout="vertical" onFinish={(values) => updateMutation.mutate(values)}>
          <Form.Item name="name" label="策略名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="description" label="描述"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="is_active" label="启用" valuePropName="checked"><Switch /></Form.Item>
          {strategy?.strategy_type === "ma_cross" && (
            <Space size="large" wrap>
              <Form.Item name={["params", "ma_short"]} label="短期均线"><InputNumber min={2} max={200} /></Form.Item>
              <Form.Item name={["params", "ma_long"]} label="长期均线"><InputNumber min={2} max={500} /></Form.Item>
              <Form.Item name={["params", "confirm_bars"]} label="确认K线数"><InputNumber min={0} max={10} /></Form.Item>
            </Space>
          )}
          {strategy?.strategy_type === "custom_script" && (
            <Form.Item name="script_content" label="Python 脚本">
              <MonacoEditor height={400} language="python" theme="vs-dark"
                options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, automaticLayout: true }} />
            </Form.Item>
          )}
          <Form.Item style={{ marginTop: 16 }}>
            <Space>
              <Button type="primary" htmlType="submit" loading={updateMutation.isPending}>保存修改</Button>
              <Button onClick={() => router.push("/strategies")}>返回列表</Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
    )},
    { key: "signals", label: "历史信号", children: (
      <Table<SignalOut> columns={signalColumns} dataSource={signals ?? []} rowKey="id" size="small" pagination={{ pageSize: 20 }} />
    )},
    { key: "backtest", label: "回测", children: strategy ? (
      <BacktestPanel configId={strategy.id} stockId={strategy.stock_id} stockSymbol={strategy.stock_symbol} />
    ) : <Spin /> },
  ];

  return (
    <div>
      <Breadcrumb items={[{ title: <a href="/strategies">策略管理</a> }, { title: strategy?.name || "加载中..." }]} style={{ marginBottom: 16 }} />
      {strategy && (
        <Descriptions column={4} size="small" style={{ marginBottom: 16 }}>
          <Descriptions.Item label="名称">{strategy.name}</Descriptions.Item>
          <Descriptions.Item label="标的">{strategy.stock_symbol} - {strategy.stock_name}</Descriptions.Item>
          <Descriptions.Item label="类型"><Tag color={strategyTypeTag[strategy.strategy_type].color}>{strategyTypeTag[strategy.strategy_type].label}</Tag></Descriptions.Item>
          <Descriptions.Item label="状态"><Tag color={strategy.is_active ? "green" : "default"}>{strategy.is_active ? "启用" : "停用"}</Tag></Descriptions.Item>
        </Descriptions>
      )}
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
    </div>
  );
}
```

### 4.17 `components/backtest/BacktestPanel.tsx` — Embedded Backtest UI

```tsx
// admin/src/components/backtest/BacktestPanel.tsx
"use client";

import { useMutation } from "@tanstack/react-query";
import { Card, Form, DatePicker, InputNumber, Button, Row, Col, Statistic, Spin, Descriptions } from "antd";
import { RiseOutlined, FallOutlined, TrophyOutlined, LineChartOutlined, CheckCircleOutlined, SwapOutlined } from "@ant-design/icons";
import { useState, useRef, useEffect } from "react";
import { createChart, IChartApi, ColorType } from "@tradingview/lightweight-charts";
import dayjs from "dayjs";
import { api } from "@/lib/api";
import type { BacktestRunRequest, BacktestResult } from "@/types/api";

interface BacktestPanelProps {
  configId: number;
  stockId: number;
  stockSymbol: string;
}

export default function BacktestPanel({ configId, stockId, stockSymbol }: BacktestPanelProps) {
  const [result, setResult] = useState<BacktestResult | null>(null);
  const equityContainerRef = useRef<HTMLDivElement>(null);
  const drawdownContainerRef = useRef<HTMLDivElement>(null);
  const equityChartRef = useRef<IChartApi | null>(null);
  const drawdownChartRef = useRef<IChartApi | null>(null);

  const backtestMutation = useMutation({
    mutationFn: (values: BacktestRunRequest) =>
      api.post<BacktestResult>("/backtest/run", { ...values, config_id: configId, stock_id: stockId }),
    onSuccess: (data) => setResult(data),
  });

  const onFinish = (values: { date_range: [dayjs.Dayjs, dayjs.Dayjs]; initial_capital: number; slippage_pct: number; commission_pct: number }) => {
    backtestMutation.mutate({
      stock_id: stockId, config_id: configId,
      start_date: values.date_range[0].format("YYYY-MM-DD"),
      end_date: values.date_range[1].format("YYYY-MM-DD"),
      initial_capital: values.initial_capital,
      slippage_pct: values.slippage_pct / 100,
      commission_pct: values.commission_pct / 100,
    });
  };

  // Equity curve chart
  useEffect(() => {
    if (!equityContainerRef.current || !result?.equity_curve?.length) return;
    if (equityChartRef.current) { equityChartRef.current.remove(); equityChartRef.current = null; }
    const chart = createChart(equityContainerRef.current, {
      width: equityContainerRef.current.clientWidth, height: 350,
      layout: { background: { type: ColorType.Solid, color: "#fff" }, textColor: "#333" },
      grid: { vertLines: { color: "#f0f0f0" }, horzLines: { color: "#f0f0f0" } },
      rightPriceScale: { borderColor: "#d9d9d9" },
      timeScale: { timeVisible: true, borderColor: "#d9d9d9" },
    });
    equityChartRef.current = chart;
    const equitySeries = chart.addLineSeries({ color: "#1677ff", lineWidth: 2, priceLineVisible: false });
    equitySeries.setData(result.equity_curve.map((p) => ({ time: p.date, value: p.equity })));
    chart.timeScale().fitContent();
    return () => { if (equityChartRef.current) { equityChartRef.current.remove(); equityChartRef.current = null; } };
  }, [result]);

  // Drawdown curve chart
  useEffect(() => {
    if (!drawdownContainerRef.current || !result?.drawdown_curve?.length) return;
    if (drawdownChartRef.current) { drawdownChartRef.current.remove(); drawdownChartRef.current = null; }
    const chart = createChart(drawdownContainerRef.current, {
      width: drawdownContainerRef.current.clientWidth, height: 200,
      layout: { background: { type: ColorType.Solid, color: "#fff" }, textColor: "#333" },
      grid: { vertLines: { color: "#f0f0f0" }, horzLines: { color: "#f0f0f0" } },
      rightPriceScale: { borderColor: "#d9d9d9" },
      timeScale: { timeVisible: true, borderColor: "#d9d9d9" },
    });
    drawdownChartRef.current = chart;
    const ddSeries = chart.addAreaSeries({ lineColor: "#ef5350", topColor: "rgba(239, 83, 80, 0.3)", bottomColor: "rgba(239, 83, 80, 0.05)", lineWidth: 1, priceLineVisible: false });
    ddSeries.setData(result.drawdown_curve.map((p) => ({ time: p.date, value: p.drawdown_pct * 100 })));
    chart.timeScale().fitContent();
    return () => { if (drawdownChartRef.current) { drawdownChartRef.current.remove(); drawdownChartRef.current = null; } };
  }, [result]);

  return (
    <div>
      <Card size="small" title="回测参数" style={{ marginBottom: 16 }}>
        <Form layout="inline"
          initialValues={{ date_range: [dayjs().subtract(3, "year"), dayjs()], initial_capital: 100000, slippage_pct: 0.05, commission_pct: 0.1 }}
          onFinish={onFinish}>
          <Form.Item name="date_range" label="日期范围" rules={[{ required: true }]}><DatePicker.RangePicker style={{ width: 260 }} /></Form.Item>
          <Form.Item name="initial_capital" label="初始资金"><InputNumber min={1000} max={10000000} step={10000} style={{ width: 140 }} prefix="$" /></Form.Item>
          <Form.Item name="slippage_pct" label="滑点(%)"><InputNumber min={0} max={5} step={0.01} style={{ width: 90 }} /></Form.Item>
          <Form.Item name="commission_pct" label="手续费(%)"><InputNumber min={0} max={5} step={0.01} style={{ width: 90 }} /></Form.Item>
          <Form.Item><Button type="primary" htmlType="submit" loading={backtestMutation.isPending}>开始回测</Button></Form.Item>
        </Form>
      </Card>
      {backtestMutation.isPending && <Spin style={{ display: "block", margin: "24px auto" }} />}
      {result && !backtestMutation.isPending && (
        <>
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={12} sm={8} md={4}>
              <Card size="small"><Statistic title="总收益" value={(result.metrics!.total_return * 100).toFixed(2)} suffix="%"
                  valueStyle={{ color: result.metrics!.total_return >= 0 ? "#3f8600" : "#cf1322" }}
                  prefix={result.metrics!.total_return >= 0 ? <RiseOutlined /> : <FallOutlined />} /></Card></Col>
            <Col xs={12} sm={8} md={4}><Card size="small"><Statistic title="CAGR" value={(result.metrics!.cagr * 100).toFixed(2)} suffix="%" prefix={<LineChartOutlined />} /></Card></Col>
            <Col xs={12} sm={8} md={4}><Card size="small"><Statistic title="最大回撤" value={(result.metrics!.max_drawdown * 100).toFixed(2)} suffix="%" valueStyle={{ color: "#cf1322" }} prefix={<FallOutlined />} /></Card></Col>
            <Col xs={12} sm={8} md={4}><Card size="small"><Statistic title="Sharpe" value={result.metrics!.sharpe_ratio.toFixed(2)}
                  valueStyle={{ color: result.metrics!.sharpe_ratio >= 1 ? "#3f8600" : "#cf1322" }} prefix={<TrophyOutlined />} /></Card></Col>
            <Col xs={12} sm={8} md={4}><Card size="small"><Statistic title="胜率" value={(result.metrics!.win_rate * 100).toFixed(1)} suffix="%" prefix={<CheckCircleOutlined />} /></Card></Col>
            <Col xs={12} sm={8} md={4}><Card size="small"><Statistic title="盈亏比" value={result.metrics!.profit_factor.toFixed(2)} prefix={<SwapOutlined />} /></Card></Col>
          </Row>
          {result.metrics!.benchmark_return !== undefined && (
            <Card size="small" style={{ marginBottom: 16 }}>
              <Descriptions column={1} size="small">
                <Descriptions.Item label="基准 (SPY) 收益">{(result.metrics!.benchmark_return * 100).toFixed(2)}%</Descriptions.Item>
                <Descriptions.Item label="相对基准">
                  <span style={{ color: result.metrics!.total_return > result.metrics!.benchmark_return ? "#3f8600" : "#cf1322" }}>
                    {result.metrics!.total_return > result.metrics!.benchmark_return ? "跑赢 " : "跑输 "}
                    {Math.abs(result.metrics!.total_return - result.metrics!.benchmark_return).toFixed(2)}%
                  </span>
                </Descriptions.Item>
                <Descriptions.Item label="交易次数">{result.metrics!.num_trades}</Descriptions.Item>
                <Descriptions.Item label="执行耗时">{result.execution_time_ms} ms</Descriptions.Item>
              </Descriptions>
            </Card>
          )}
          <Card title="权益曲线" style={{ marginBottom: 16 }}><div ref={equityContainerRef} style={{ width: "100%", minHeight: 350 }} /></Card>
          <Card title="回撤曲线"><div ref={drawdownContainerRef} style={{ width: "100%", minHeight: 200 }} /></Card>
        </>
      )}
    </div>
  );
}
```


## Phase 10E: Backtest History, Signals & Alerts

### 4.18 `app/backtest/page.tsx` — Backtest History

```tsx
// admin/src/app/backtest/page.tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { Table, Button, Modal } from "antd";
import { EyeOutlined } from "@ant-design/icons";
import { useState } from "react";
import dynamic from "next/dynamic";
import { api } from "@/lib/api";
import type { BacktestHistoryItem, PaginatedResponse } from "@/types/api";

const BacktestPanel = dynamic(() => import("@/components/backtest/BacktestPanel"), { ssr: false });

export default function BacktestHistoryPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedBacktest, setSelectedBacktest] = useState<BacktestHistoryItem | null>(null);

  const { data, isLoading } = useQuery<PaginatedResponse<BacktestHistoryItem>>({
    queryKey: ["backtest-history", page, pageSize],
    queryFn: () => api.get<PaginatedResponse<BacktestHistoryItem>>("/admin/backtests", { page, size: pageSize }),
  });

  const columns = [
    { title: "策略", dataIndex: "strategy_name", key: "strategy" },
    { title: "标的", dataIndex: "stock_symbol", key: "stock", width: 80 },
    { title: "起始", dataIndex: "start_date", key: "start", width: 110 },
    { title: "结束", dataIndex: "end_date", key: "end", width: 110 },
    { title: "总收益", dataIndex: "total_return", key: "return", width: 100,
      render: (v: number | null) => v !== null ? <span style={{ color: v >= 0 ? "#3f8600" : "#cf1322" }}>{(v * 100).toFixed(2)}%</span> : "-" },
    { title: "Sharpe", dataIndex: "sharpe_ratio", key: "sharpe", width: 80, render: (v: number | null) => v?.toFixed(2) ?? "-" },
    { title: "MDD", dataIndex: "max_drawdown", key: "mdd", width: 100,
      render: (v: number | null) => v !== null ? <span style={{ color: "#cf1322" }}>{(v * 100).toFixed(2)}%</span> : "-" },
    { title: "日期", dataIndex: "created_at", key: "created_at", width: 180, render: (d: string) => new Date(d).toLocaleString() },
    { title: "操作", key: "actions", width: 80,
      render: (_: unknown, record: BacktestHistoryItem) => (
        <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => setSelectedBacktest(record)}>查看</Button>
      )},
  ];

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>回测记录</h2>
      <Table<BacktestHistoryItem> columns={columns} dataSource={data?.items ?? []} rowKey="id" loading={isLoading}
        pagination={{ current: page, pageSize, total: data?.total ?? 0, showSizeChanger: true, onChange: (p, ps) => { setPage(p); setPageSize(ps); } }} />
      <Modal title="回测详情" open={!!selectedBacktest} onCancel={() => setSelectedBacktest(null)} footer={null} width={1000} destroyOnClose>
        {selectedBacktest && <BacktestPanel configId={selectedBacktest.config_id} stockId={selectedBacktest.stock_id} stockSymbol={selectedBacktest.stock_symbol} />}
      </Modal>
    </div>
  );
}
```

### 4.19 `app/signals/page.tsx` — Signal List with AI Analysis Modal

```tsx
// admin/src/app/signals/page.tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { Table, Tag, Button, Modal, Descriptions, Space, Select, Spin, Alert } from "antd";
import { RobotOutlined } from "@ant-design/icons";
import { useState } from "react";
import { api } from "@/lib/api";
import type { SignalOut, SignalType, AIAnalysisResponse, PaginatedResponse } from "@/types/api";

const signalTypeColor: Record<SignalType, string> = { buy: "green", sell: "red" };

export default function SignalsPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filterType, setFilterType] = useState<SignalType | undefined>();
  const [aiModalSignal, setAiModalSignal] = useState<SignalOut | null>(null);

  const { data, isLoading } = useQuery<PaginatedResponse<SignalOut>>({
    queryKey: ["signals", page, pageSize, filterType],
    queryFn: () => api.get<PaginatedResponse<SignalOut>>("/admin/signals", { page, size: pageSize, signal_type: filterType }),
  });

  const { data: aiAnalysis, isLoading: aiLoading } = useQuery<AIAnalysisResponse>({
    queryKey: ["ai-analysis", aiModalSignal?.id],
    queryFn: () => api.get<AIAnalysisResponse>(`/analysis/${aiModalSignal!.stock_id}/ai/${aiModalSignal!.id}`),
    enabled: !!aiModalSignal,
  });

  const columns = [
    { title: "日期", dataIndex: "triggered_date", key: "date", width: 120 },
    { title: "标的", dataIndex: "stock_symbol", key: "symbol", width: 80 },
    { title: "类型", dataIndex: "signal_type", key: "type", width: 100,
      render: (t: SignalType) => <Tag color={signalTypeColor[t]}>{t === "buy" ? "▲ 买入" : "▼ 卖出"}</Tag> },
    { title: "子类型", dataIndex: "signal_subtype", key: "subtype", width: 120 },
    { title: "策略", dataIndex: "strategy_name", key: "strategy" },
    { title: "强度", dataIndex: "strength", key: "strength", width: 80,
      render: (v: number) => {
        const pct = (v * 100).toFixed(0);
        let color = "default";
        if (v >= 0.7) color = "green"; else if (v >= 0.4) color = "orange"; else color = "red";
        return <Tag color={color}>{pct}%</Tag>;
      }},
    { title: "价格", dataIndex: "price", key: "price", width: 80 },
    { title: "操作", key: "actions", width: 100,
      render: (_: unknown, record: SignalOut) => (
        <Button type="link" size="small" icon={<RobotOutlined />} onClick={() => setAiModalSignal(record)}>AI 分析</Button>
      )},
  ];

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>信号管理</h2>
      <Space style={{ marginBottom: 16 }} wrap>
        <Select placeholder="信号类型" allowClear style={{ width: 120 }} value={filterType}
          onChange={(v) => { setFilterType(v); setPage(1); }}
          options={[{ label: "买入", value: "buy" }, { label: "卖出", value: "sell" }]} />
      </Space>
      <Table<SignalOut> columns={columns} dataSource={data?.items ?? []} rowKey="id" loading={isLoading}
        pagination={{ current: page, pageSize, total: data?.total ?? 0, showSizeChanger: true, onChange: (p, ps) => { setPage(p); setPageSize(ps); } }} />
      <Modal title={aiModalSignal ? `AI 分析 — ${aiModalSignal.stock_symbol} ${aiModalSignal.triggered_date}` : ""}
        open={!!aiModalSignal} onCancel={() => setAiModalSignal(null)} footer={null} width={700} destroyOnClose>
        {aiLoading && <Spin style={{ display: "block", margin: "24px auto" }} />}
        {aiAnalysis && (
          <>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="总结">{aiAnalysis.summary}</Descriptions.Item>
              {aiAnalysis.why_buy && <Descriptions.Item label="买入理由">{aiAnalysis.why_buy}</Descriptions.Item>}
              {aiAnalysis.why_sell && <Descriptions.Item label="卖出理由">{aiAnalysis.why_sell}</Descriptions.Item>}
              {aiAnalysis.risks && <Descriptions.Item label="风险">{aiAnalysis.risks}</Descriptions.Item>}
              {aiAnalysis.stop_loss !== null && <Descriptions.Item label="止损位">${aiAnalysis.stop_loss}</Descriptions.Item>}
              {aiAnalysis.targets && aiAnalysis.targets.length > 0 && <Descriptions.Item label="目标价">{aiAnalysis.targets.map((t, i) => `$${t}`).join(", ")}</Descriptions.Item>}
              {aiAnalysis.confidence !== null && <Descriptions.Item label="置信度">{((aiAnalysis.confidence || 0) * 100).toFixed(0)}%</Descriptions.Item>}
            </Descriptions>
            {aiAnalysis.disclaimer && <Alert type="warning" message={aiAnalysis.disclaimer} style={{ marginTop: 16 }} showIcon />}
          </>
        )}
        {!aiLoading && !aiAnalysis && <Alert type="info" message="暂无 AI 分析数据" />}
      </Modal>
    </div>
  );
}
```

### 4.20 `app/alerts/page.tsx` — Alert Logs

```tsx
// admin/src/app/alerts/page.tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { Table, Tag, Select, Space } from "antd";
import { useState } from "react";
import { api } from "@/lib/api";
import type { AlertLogOut, SignalType, AlertStatus, PaginatedResponse } from "@/types/api";

const signalTypeColor: Record<SignalType, string> = { buy: "green", sell: "red" };
const statusColor: Record<AlertStatus, string> = { sent: "green", failed: "red", pending: "orange" };
const statusLabel: Record<AlertStatus, string> = { sent: "已发送", failed: "失败", pending: "等待中" };

export default function AlertsPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filterStatus, setFilterStatus] = useState<AlertStatus | undefined>();

  const { data, isLoading } = useQuery<PaginatedResponse<AlertLogOut>>({
    queryKey: ["alerts", page, pageSize, filterStatus],
    queryFn: () => api.get<PaginatedResponse<AlertLogOut>>("/admin/alerts", { page, size: pageSize, status: filterStatus }),
  });

  const columns = [
    { title: "时间", dataIndex: "created_at", key: "time", width: 180, render: (d: string) => new Date(d).toLocaleString() },
    { title: "用户", dataIndex: "user_email", key: "user", width: 200, ellipsis: true },
    { title: "标的", dataIndex: "stock_symbol", key: "stock", width: 80 },
    { title: "信号", dataIndex: "signal_type", key: "signal", width: 80, render: (t: SignalType) => <Tag color={signalTypeColor[t]}>{t}</Tag> },
    { title: "渠道", dataIndex: "channel", key: "channel", width: 60, render: (c: string) => c.toUpperCase() },
    { title: "标题", dataIndex: "title", key: "title", ellipsis: true },
    { title: "状态", dataIndex: "status", key: "status", width: 100, render: (s: AlertStatus) => <Tag color={statusColor[s]}>{statusLabel[s]}</Tag> },
    { title: "错误", dataIndex: "error_message", key: "error", width: 200, ellipsis: true, render: (e: string | null) => e || "-" },
  ];

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>提醒日志</h2>
      <Space style={{ marginBottom: 16 }} wrap>
        <Select placeholder="状态筛选" allowClear style={{ width: 140 }} value={filterStatus}
          onChange={(v) => { setFilterStatus(v); setPage(1); }}
          options={[{ label: "已发送", value: "sent" }, { label: "失败", value: "failed" }, { label: "等待中", value: "pending" }]} />
      </Space>
      <Table<AlertLogOut> columns={columns} dataSource={data?.items ?? []} rowKey="id" loading={isLoading}
        pagination={{ current: page, pageSize, total: data?.total ?? 0, showSizeChanger: true, onChange: (p, ps) => { setPage(p); setPageSize(ps); } }} />
    </div>
  );
}
```


## 5. Build & Run Instructions

1. Ensure all backend APIs are running: `docker-compose up -d` from project root.
2. Navigate to admin directory: `cd admin`.
3. Install dependencies: `npm install`.
4. Verify `.env.local` has `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1`.
5. Start dev server: `npm run dev`.
6. Access at `http://localhost:3000`.
7. Login with admin credentials (seeded in Task 02: `admin@trendscope.com` / `admin123`).

## 6. Implementation Order (Critical Path)

Files must be created in this exact order due to import dependency chains:

| Phase | File | Blocked By |
|-------|------|------------|
| **10A** | `types/api.ts` | — |
| **10A** | `lib/api.ts` | types/api.ts |
| **10A** | `lib/auth.ts` | — |
| **10A** | `components/layout/Sidebar.tsx` | — |
| **10A** | `components/layout/Header.tsx` | lib/auth.ts |
| **10A** | `components/layout/AuthGuard.tsx` | lib/auth.ts |
| **10A** | `app/layout.tsx` | Sidebar, Header, AuthGuard |
| **10A** | `app/login/page.tsx` | lib/api.ts, lib/auth.ts, types/api.ts |
| **10B** | `app/dashboard/page.tsx` | types/api.ts, lib/api.ts |
| **10C** | `app/stocks/page.tsx` | types/api.ts, lib/api.ts |
| **10C** | `app/stocks/create/page.tsx` | lib/api.ts, types/api.ts |
| **10C** | `components/charts/KlineChart.tsx` | types/api.ts |
| **10C** | `components/charts/KlineChartInner.tsx` | KlineChart.tsx |
| **10C** | `app/stocks/[id]/page.tsx` | KlineChart, lib/api.ts |
| **10D** | `app/strategies/page.tsx` | types/api.ts, lib/api.ts |
| **10D** | `app/strategies/create/page.tsx` | lib/api.ts, types/api.ts |
| **10D** | `components/backtest/BacktestPanel.tsx` | lib/api.ts, types/api.ts |
| **10D** | `app/strategies/[id]/page.tsx` | BacktestPanel, types/api.ts |
| **10E** | `app/backtest/page.tsx` | BacktestPanel, types/api.ts |
| **10E** | `app/signals/page.tsx` | lib/api.ts, types/api.ts |
| **10E** | `app/alerts/page.tsx` | lib/api.ts, types/api.ts |

**Tip**: Files within the same phase can be created in parallel if they have no inter-dependencies. After Phase 10A foundation files are done, Phases 10B, 10C, 10D, and 10E can be developed in parallel by different developers.

---

## 7. Acceptance Criteria Checklist

- [ ] `npm run build` succeeds with zero TypeScript errors
- [ ] `npm run dev` starts without errors; navigating to `http://localhost:3000` redirects to `/login`
- [ ] Login page renders with email/password fields and submit button
- [ ] Successful login sets tokens in localStorage and redirects to `/dashboard`
- [ ] AuthGuard blocks unauthenticated access — direct navigation to `/dashboard` redirects to `/login`
- [ ] Dashboard shows 4 AntD Statistic cards (用户总数, 标的总数, 活跃策略数, 今日信号数) with real data
- [ ] Dashboard recent signals table shows last 10 signals with colored type tags and strength percentage
- [ ] Refresh button on dashboard invalidates queries and refetches data
- [ ] Stock list page shows paginated table with Symbol, Name, Type (color Tag), Sector, Active (Switch), Actions
- [ ] Search by symbol/name filters the stock list
- [ ] "+" button navigates to stock creation form
- [ ] Stock creation form validates: symbol required (auto-uppercase), name required, type required
- [ ] Successful stock creation redirects to `/stocks` with success message
- [ ] "Delete" on a stock shows Popconfirm; confirming deletes the stock via API
- [ ] Toggling Active Switch calls PATCH API and refreshes the row
- [ ] Stock detail page shows symbol, name, type tag, sector in Descriptions
- [ ] K-line chart renders OHLC candlesticks with MA20 (orange) and MA60 (blue) lines
- [ ] Volume histogram renders below the main chart on a separate scale
- [ ] K-line chart resizes responsively on browser window change
- [ ] Time period radio buttons (1M/3M/6M/1Y/ALL) displayed above the chart
- [ ] Signal markers render on chart: green arrowUp belowBar (buy), red arrowDown aboveBar (sell)
- [ ] Dark/light theme adapts chart background and text from AntD theme context
- [ ] Strategy list shows paginated table with Name, Type (colored Tag), Stock, Active (Switch), Last Signal
- [ ] Toggling Active Switch PATCHes `/admin/strategies/{id}` and refetches
- [ ] "回测" button navigates to `/strategies/{id}?tab=backtest`
- [ ] Create strategy page renders name, description, stock select, strategy type radio buttons
- [ ] Selecting "均线交叉" reveals MA params (ma_short, ma_long, confirm_bars, volume_confirm)
- [ ] Selecting "自定义脚本" reveals Monaco Editor (height 400, language=python, dark theme) + JSON params TextArea
- [ ] Monaco Editor loads with default template; user can freely type/edit
- [ ] Submitting create strategy calls POST `/admin/strategies` and redirects to list
- [ ] Strategy detail page has 3 tabs: 策略信息, 历史信号, 回测
- [ ] Tab 1: editable form pre-populated; Save calls PATCH
- [ ] Tab 2: paginated signal table filtered to current strategy
- [ ] Tab 3: BacktestPanel with DatePicker.RangePicker, initial_capital, slippage, commission, "开始回测" button
- [ ] Submitting backtest calls POST `/backtest/run`; shows loading spinner
- [ ] Backtest completion renders 6 Statistic cards: 总收益 (green/red), CAGR, 最大回撤 (red), Sharpe, 胜率, 盈亏比
- [ ] Benchmark row shows SPY return and "跑赢/跑输" comparison
- [ ] Equity curve chart renders as blue LineSeries
- [ ] Drawdown curve chart renders as red AreaSeries
- [ ] Backtest history page shows paginated table; clicking "查看" opens modal
- [ ] Signal list page: filters by signal_type; paginates; "AI 分析" button opens modal
- [ ] AI analysis modal: summary, why_buy/sell, risks, stop_loss, targets, confidence, disclaimer
- [ ] Alert logs page: table with status filter; color-coded status tags
- [ ] Sidebar highlights correct menu item for current route
- [ ] Clicking "退出" clears tokens and redirects to `/login`
- [ ] All pages use Breadcrumb navigation where applicable
- [ ] No console errors or React key warnings in browser devtools
- [ ] All API calls show proper loading/error states (Spin, message.error, etc.)
- [ ] Page layouts are responsive (sidebar collapses, tables scroll horizontally on mobile)

---

## 8. Optional: Playwright Smoke Test

Install Playwright in `admin/`: `npm init playwright@latest`

Create `admin/e2e/smoke.spec.ts`:

```typescript
// admin/e2e/smoke.spec.ts
import { test, expect } from "@playwright/test";

const BASE = "http://localhost:3000";

test.describe("Admin Panel Smoke Test", () => {
  test("login → dashboard → navigate all pages → logout", async ({ page }) => {
    // 1. Navigate; should redirect to login
    await page.goto(BASE);
    await expect(page).toHaveURL(/\/login/);

    // 2. Login
    await page.fill('input[placeholder="邮箱"]', "admin@trendscope.com");
    await page.fill('input[placeholder="密码"]', "admin123");
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });

    // 3. Dashboard loads
    await expect(page.getByText("用户总数")).toBeVisible({ timeout: 5000 });

    // 4. Navigate to stocks
    await page.click("text=标的管理");
    await expect(page).toHaveURL(/\/stocks/);

    // 5. Navigate to strategies
    await page.click("text=策略管理");
    await expect(page).toHaveURL(/\/strategies/);
    await expect(page.getByText("新建策略")).toBeVisible();

    // 6. Navigate to backtest history
    await page.click("text=回测记录");
    await expect(page).toHaveURL(/\/backtest/);

    // 7. Navigate to signals
    await page.click("text=信号管理");
    await expect(page).toHaveURL(/\/signals/);

    // 8. Navigate to alerts
    await page.click("text=提醒日志");
    await expect(page).toHaveURL(/\/alerts/);

    // 9. Logout
    await page.click("text=退出");
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
  });
});
```

---

> **Next**: After all pages pass the acceptance criteria, proceed to Task 11 (integration tests).
