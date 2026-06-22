"use client";

import {
  QueryClient,
  QueryClientProvider as TanStackProvider,
} from "@tanstack/react-query";
import { ConfigProvider, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { useState } from "react";

export function QueryClientProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 60 * 1000,
          },
        },
      }),
  );

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: "#38bdf8",
          colorInfo: "#38bdf8",
          colorSuccess: "#10b981",
          colorWarning: "#d6a84f",
          colorError: "#f43f5e",
          colorTextBase: "#e5eefb",
          colorBgBase: "#080d16",
          colorBgLayout: "#070b12",
          colorBgContainer: "#101827",
          colorBorder: "#243244",
          borderRadius: 12,
          borderRadiusLG: 18,
          fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        },
        components: {
          Button: {
            borderRadius: 10,
            controlHeight: 36,
            fontWeight: 600,
          },
          Card: {
            borderRadiusLG: 18,
            headerFontSize: 15,
            headerFontSizeSM: 14,
          },
          Table: {
            borderColor: "#233044",
            headerBg: "#111b2b",
            headerColor: "#8da2bd",
            rowHoverBg: "#142236",
          },
          Tag: {
            borderRadiusSM: 999,
          },
        },
      }}
    >
      <TanStackProvider client={queryClient}>{children}</TanStackProvider>
    </ConfigProvider>
  );
}
