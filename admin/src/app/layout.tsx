import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import "./globals.css";
import { QueryClientProvider } from "./providers";

export const metadata: Metadata = {
  title: "Trend-Scope Admin",
  description: "Trend-Scope Management Panel",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <AntdRegistry>
          <ConfigProvider
            locale={zhCN}
            theme={{
              token: {
                colorPrimary: "#1677ff",
              },
            }}
          >
            <QueryClientProvider>{children}</QueryClientProvider>
          </ConfigProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
