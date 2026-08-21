import type { Metadata } from "next";
import { AuthPage } from "../../components/AuthPage";

export const metadata: Metadata = { title: "注册 · Agentic Analog IC Schematic Editor" };

export default function RegisterPage() {
  return <AuthPage mode="register" />;
}
