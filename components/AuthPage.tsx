"use client";

import {
  ArrowRight,
  CheckCircle2,
  CircuitBoard,
  Cpu,
  Eye,
  EyeOff,
  LockKeyhole,
  Network,
  UserRound,
  Waves,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";

type AuthMode = "login" | "register";

export function AuthPage({ mode }: { mode: AuthMode }) {
  const isRegister = mode === "register";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [developmentAccountReady, setDevelopmentAccountReady] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const formTouchedRef = useRef(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/me", { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (response.ok) window.location.replace("/projects");
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (isRegister) return;
    const controller = new AbortController();
    fetch("/api/auth/development-account", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<{ username?: unknown; password?: unknown }>;
      })
      .then((credentials) => {
        if (
          credentials
          && typeof credentials.username === "string"
          && typeof credentials.password === "string"
          && !formTouchedRef.current
          && !submittingRef.current
        ) {
          setUsername(credentials.username);
          setPassword(credentials.password);
          setDevelopmentAccountReady(true);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [isRegister]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) {
        setDevelopmentAccountReady(false);
        setError(payload.error ?? "操作失败，请稍后重试");
        return;
      }
      window.location.replace("/projects");
    } catch {
      setDevelopmentAccountReady(false);
      setError("无法连接服务器，请确认局域网服务正在运行");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const markFormEdited = () => {
    formTouchedRef.current = true;
    setDevelopmentAccountReady(false);
  };

  return (
    <main className="account-shell">
      <section className="account-brand-panel">
        <div className="account-brand">
          <span className="account-brand-mark"><Waves size={24} /></span>
          <div><strong>Analog Agent Studio</strong><span>模拟 IC 原理图工作台</span></div>
        </div>
        <div className="account-intro">
          <p className="account-eyebrow">SCHEMATIC DESIGN ENVIRONMENT</p>
          <h1>让每一个模拟电路项目<br />都有清晰的归属。</h1>
          <p>账户、项目与原理图统一保存。登录后可以从任何一台局域网设备继续工作。</p>
          <div className="account-feature-list">
            <div><CircuitBoard size={18} /><span><strong>可交互原理图</strong><small>器件放置、正交连线与网表预览</small></span></div>
            <div><Network size={18} /><span><strong>项目隔离存储</strong><small>每个账户只能访问自己的项目</small></span></div>
            <div><Cpu size={18} /><span><strong>面向模拟 IC</strong><small>保留 Cadence 风格器件与参数表达</small></span></div>
          </div>
        </div>
        <p className="account-brand-foot">LAN WORKSPACE · 数据保存在部署主机</p>
      </section>

      <section className="account-form-panel">
        <div className="account-form-wrap">
          <div className="account-mobile-brand"><Waves size={18} /> Analog Agent Studio</div>
          <div className="account-form-heading">
            <span className="account-step">{isRegister ? "创建工作区账户" : "欢迎回来"}</span>
            <h2>{isRegister ? "注册账户" : "登录 Analog Agent Studio"}</h2>
            <p>{isRegister ? "注册后会自动生成一个 CMOS 反相器示例项目。" : "使用你的账户继续管理和编辑原理图项目。"}</p>
          </div>

          <div className="account-mode-tabs" role="tablist" aria-label="账户操作">
            <a className={!isRegister ? "active" : ""} href="/login">登录</a>
            <a className={isRegister ? "active" : ""} href="/register">注册</a>
          </div>

          <form className="account-form" onSubmit={submit}>
            <label>
              <span>用户名</span>
              <div className="account-input"><UserRound size={17} /><input
                value={username}
                onChange={(event) => {
                  markFormEdited();
                  setUsername(event.target.value);
                }}
                minLength={3}
                maxLength={32}
                autoComplete="username"
                placeholder="3–32 个字符"
                autoFocus
                required
              /></div>
            </label>
            <label>
              <span>密码</span>
              <div className="account-input"><LockKeyhole size={17} /><input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => {
                  markFormEdited();
                  setPassword(event.target.value);
                }}
                minLength={8}
                maxLength={128}
                autoComplete={isRegister ? "new-password" : "current-password"}
                placeholder="至少 8 个字符"
                required
              /><button type="button" title={showPassword ? "隐藏密码" : "显示密码"} onClick={() => setShowPassword((value) => !value)}>
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button></div>
            </label>

            {isRegister && <div className="account-password-note"><CheckCircle2 size={14} />密码会在服务器上加盐加密后保存</div>}
            {developmentAccountReady && <div className="account-password-note" role="status" aria-live="polite"><CheckCircle2 size={14} />本地开发账号已填好，直接点击登录即可</div>}
            {error && <div className="account-error" role="alert">{error}</div>}

            <button className="account-submit" type="submit" disabled={submitting}>
              <span>{submitting ? "处理中…" : isRegister ? "创建账户" : "登录"}</span><ArrowRight size={17} />
            </button>
          </form>

          <p className="account-switch">
            {isRegister ? "已经有账户？" : "还没有账户？"}
            <a href={isRegister ? "/login" : "/register"}>{isRegister ? "返回登录" : "立即注册"}</a>
          </p>
        </div>
      </section>
    </main>
  );
}
