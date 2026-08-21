"use client";

import {
  CircuitBoard,
  Clock3,
  FolderOpen,
  LayoutGrid,
  List,
  LogOut,
  Pencil,
  Plus,
  Search,
  Trash2,
  Waves,
  X,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type User = { id: string; username: string; createdAt: number };
type Project = {
  id: string;
  name: string;
  description: string;
  nodeCount: number;
  edgeCount: number;
  cell: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
};

function formatTime(value: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

export function ProjectDashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [editor, setEditor] = useState<{ project?: Project; name: string; description: string } | null>(null);
  const [dialogError, setDialogError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [meResponse, projectsResponse] = await Promise.all([
        fetch("/api/auth/me", { cache: "no-store" }),
        fetch("/api/projects", { cache: "no-store" }),
      ]);
      if (meResponse.status === 401 || projectsResponse.status === 401) {
        window.location.replace("/login");
        return;
      }
      if (!meResponse.ok || !projectsResponse.ok) throw new Error("load_failed");
      const mePayload = await meResponse.json() as { user: User };
      const projectsPayload = await projectsResponse.json() as { projects: Project[] };
      setUser(mePayload.user);
      setProjects(projectsPayload.projects);
    } catch {
      setError("项目列表加载失败，请确认服务仍在运行");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!editor) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) setEditor(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [editor, saving]);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("zh-CN");
    if (!query) return projects;
    return projects.filter((project) => `${project.name} ${project.description} ${project.cell}`.toLocaleLowerCase("zh-CN").includes(query));
  }, [projects, search]);

  const saveProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editor) return;
    setSaving(true);
    setDialogError("");
    try {
      const response = await fetch(editor.project ? `/api/projects/${editor.project.id}` : "/api/projects", {
        method: editor.project ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: editor.name,
          description: editor.description,
          ...(editor.project ? { revision: editor.project.revision } : {}),
        }),
      });
      const payload = await response.json() as { error?: string; project?: Project };
      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }
      if (!response.ok) {
        setDialogError(payload.error ?? "项目保存失败");
        return;
      }
      setEditor(null);
      if (!editor.project && payload.project) {
        window.location.assign(`/projects/${payload.project.id}`);
        return;
      }
      await load();
    } catch {
      setDialogError("无法连接服务器，请确认服务仍在运行");
    } finally {
      setSaving(false);
    }
  };

  const deleteProject = async (project: Project) => {
    if (!window.confirm(`确认删除“${project.name}”？此操作无法撤销。`)) return;
    setPendingDelete(project.id);
    setError("");
    try {
      const response = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }
      if (!response.ok) {
        setError("删除失败，请稍后重试");
        return;
      }
      setProjects((current) => current.filter((item) => item.id !== project.id));
    } catch {
      setError("删除失败，无法连接服务器");
    } finally {
      setPendingDelete(null);
    }
  };

  const logout = async () => {
    setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("logout_failed");
      window.location.replace("/login");
    } catch {
      setError("退出登录失败，请确认服务仍在运行后重试");
    }
  };

  const initials = user?.username.slice(0, 2).toUpperCase() ?? "AS";

  return (
    <main className="projects-shell">
      <header className="projects-topbar">
        <Link className="projects-brand" href="/projects"><span><Waves size={18} /></span><strong>Analog Studio</strong></Link>
        <div className="projects-topbar-center">项目工作区</div>
        <div className="projects-user"><span className="projects-user-copy"><strong>{user?.username ?? "正在载入"}</strong><small>本地账户</small></span><span className="projects-avatar">{initials}</span><button title="退出登录" onClick={logout}><LogOut size={16} /></button></div>
      </header>

      <section className="projects-content">
        <div className="projects-heading-row">
          <div><p>WORKSPACE</p><h1>项目</h1><span>管理你的模拟 IC 原理图工程</span></div>
          <button className="project-primary-button" onClick={() => { setDialogError(""); setEditor({ name: "", description: "" }); }}><Plus size={17} />新建项目</button>
        </div>

        <div className="projects-toolbar">
          <label className="projects-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索项目、Cell 或说明" /></label>
          <div className="projects-view-toggle" aria-label="项目显示方式">
            <button className={view === "grid" ? "active" : ""} title="卡片视图" onClick={() => setView("grid")}><LayoutGrid size={16} /></button>
            <button className={view === "list" ? "active" : ""} title="列表视图" onClick={() => setView("list")}><List size={16} /></button>
          </div>
        </div>

        {error && projects.length > 0 && <div className="projects-error" role="alert">{error}<button onClick={() => setError("")}>×</button></div>}

        {loading ? (
          <div className="projects-loading"><span /><p>正在读取账户项目…</p></div>
        ) : error && projects.length === 0 ? (
          <div className="projects-empty projects-load-failed"><span><CircuitBoard size={31} /></span><h2>项目列表暂时不可用</h2><p>{error}</p><button onClick={() => void load()}>重新载入</button></div>
        ) : filtered.length === 0 ? (
          <div className="projects-empty"><span><CircuitBoard size={31} /></span><h2>{projects.length ? "没有匹配的项目" : "创建第一个项目"}</h2><p>{projects.length ? "换一个关键词试试。" : "新建一个空白模拟 IC 原理图工程，器件、连线和网表都会保存到你的账户。"}</p>{!projects.length && <button onClick={() => { setDialogError(""); setEditor({ name: "", description: "" }); }}><Plus size={16} />新建项目</button>}</div>
        ) : (
          <div className={`project-collection ${view}`}>
            {filtered.map((project) => (
              <article className="project-card" key={project.id}>
                <a className="project-card-main" href={`/projects/${project.id}`}>
                  <span className="project-icon"><CircuitBoard size={23} /></span>
                  <span className="project-copy"><strong>{project.name}</strong><small>{project.description || "暂无项目说明"}</small></span>
                </a>
                <div className="project-stats"><span><b>{project.nodeCount}</b> 器件</span><span><b>{project.edgeCount}</b> 连线</span><span>Cell: <b>{project.cell}</b></span></div>
                <div className="project-card-foot"><span><Clock3 size={13} />{formatTime(project.updatedAt)}</span><div><button title="重命名" onClick={() => { setDialogError(""); setEditor({ project, name: project.name, description: project.description }); }}><Pencil size={14} /></button><button className="danger" title="删除项目" disabled={pendingDelete === project.id} onClick={() => void deleteProject(project)}><Trash2 size={14} /></button><a title="打开项目" href={`/projects/${project.id}`}><FolderOpen size={14} /></a></div></div>
              </article>
            ))}
          </div>
        )}
      </section>

      {editor && <div className="project-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditor(null); }}>
        <section className="project-dialog" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title">
          <header><div><span>{editor.project ? "EDIT PROJECT" : "NEW PROJECT"}</span><h2 id="project-dialog-title">{editor.project ? "编辑项目信息" : "新建原理图项目"}</h2></div><button title="关闭" onClick={() => setEditor(null)}><X size={18} /></button></header>
          <form onSubmit={saveProject}>
            <label><span>项目名称</span><input value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} maxLength={80} placeholder="例如：两级运算放大器" autoFocus required /></label>
            <label><span>项目说明 <small>可选</small></span><textarea value={editor.description} onChange={(event) => setEditor({ ...editor, description: event.target.value })} maxLength={240} placeholder="记录工艺、目标或版本信息" /></label>
            {dialogError && <div className="project-dialog-error" role="alert">{dialogError}</div>}
            <p>{editor.project ? "重命名会同步更新原理图中的项目标识。" : "创建后会直接进入空白原理图编辑器。"}</p>
            <footer><button type="button" onClick={() => setEditor(null)}>取消</button><button className="primary" type="submit" disabled={saving}>{saving ? "保存中…" : editor.project ? "保存修改" : "创建并打开"}</button></footer>
          </form>
        </section>
      </div>}
    </main>
  );
}
