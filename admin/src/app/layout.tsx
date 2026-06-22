import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
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
          <QueryClientProvider>{children}</QueryClientProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
