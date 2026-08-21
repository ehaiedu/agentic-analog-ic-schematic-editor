"use client";

import { AlertTriangle, ArrowLeft, LoaderCircle, Waves } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { SchematicDocument } from "../lib/schematic";
import { AnalogWorkbench } from "./AnalogWorkbench";

type ProjectPayload = {
  id: string;
  name: string;
  description: string;
  document: SchematicDocument;
  revision: number;
  createdAt: number;
  updatedAt: number;
};

export function ProjectEditorLoader({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<ProjectPayload | null>(null);
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch(`/api/projects/${projectId}`, { cache: "no-store", signal: controller.signal }),
      fetch("/api/auth/me", { cache: "no-store", signal: controller.signal }),
      fetch(`/api/projects/${projectId}/recovery`, { cache: "no-store", signal: controller.signal }),
    ]).then(async ([projectResponse, meResponse, recoveryResponse]) => {
      if (projectResponse.status === 401 || meResponse.status === 401) {
        window.location.replace("/login");
        return;
      }
      const projectData = await projectResponse.json() as { project?: ProjectPayload; error?: string };
      const meData = await meResponse.json() as { user?: { username: string } };
      const recoveryData = recoveryResponse.ok
        ? await recoveryResponse.json() as {
            recovery?: {
              document: SchematicDocument;
              baseStorageRevision: number;
              designRevision: number;
              createdAt: number;
            } | null;
          }
        : { recovery: null };
      if (!meResponse.ok || !meData.user) {
        setError("账户状态读取失败，请返回项目列表后重试");
        return;
      }
      if (!projectResponse.ok || !projectData.project) {
        setError(projectData.error ?? "项目无法打开");
        return;
      }
      const recovery = recoveryData.recovery;
      const recover = recovery
        && recovery.designRevision > projectData.project.document.revisions.designRevision
        && window.confirm(
          `检测到 ${new Date(recovery.createdAt).toLocaleString("zh-CN")} 的自动恢复副本。\n`
          + `正式版本：storage r${projectData.project.revision} / design r${projectData.project.document.revisions.designRevision}\n`
          + `恢复版本：基于 storage r${recovery.baseStorageRevision} / design r${recovery.designRevision}\n\n是否恢复未正式保存的编辑？`,
        );
      setProject(recover
        ? { ...projectData.project, document: recovery.document }
        : projectData.project);
      setUsername(meData.user.username);
    }).catch((reason: unknown) => {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError("无法连接项目服务");
    });
    return () => controller.abort();
  }, [projectId]);

  if (error) return <main className="editor-loader-shell"><section><AlertTriangle size={28} /><h1>无法打开项目</h1><p>{error}</p><Link href="/projects"><ArrowLeft size={15} />返回项目列表</Link></section></main>;
  if (!project) return <main className="editor-loader-shell"><section className="loading"><Waves size={26} /><LoaderCircle className="spin" size={20} /><p>正在载入原理图工程…</p></section></main>;

  return <AnalogWorkbench
    key={project.id}
    initialDocument={project.document}
    projectId={project.id}
    projectName={project.name}
    projectRevision={project.revision}
    username={username}
  />;
}
