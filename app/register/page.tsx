import type { Metadata } from "next";
import { AuthPage } from "../../components/AuthPage";

export const metadata: Metadata = { title: "注册 · Analog Agent Studio" };

export default function RegisterPage() {
  return <AuthPage mode="register" />;
}
