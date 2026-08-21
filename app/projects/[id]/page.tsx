import type { Metadata } from "next";
import { ProjectEditorLoader } from "../../../components/ProjectEditorLoader";

export const metadata: Metadata = { title: "原理图编辑器 · Analog Studio" };

export default async function ProjectEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectEditorLoader projectId={id} />;
}
