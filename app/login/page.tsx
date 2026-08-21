import type { Metadata } from "next";
import { AuthPage } from "../../components/AuthPage";

export const metadata: Metadata = { title: "登录 · Analog Studio" };

export default function LoginPage() {
  return <AuthPage mode="login" />;
}
