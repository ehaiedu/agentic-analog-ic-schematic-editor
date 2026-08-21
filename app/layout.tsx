import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Analog Studio",
  description: "面向模拟 IC 的多用户原理图编辑与项目管理工作台",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
