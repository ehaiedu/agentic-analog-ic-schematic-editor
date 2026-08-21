import type { Metadata } from "next";
import { ProjectDashboard } from "../../components/ProjectDashboard";

export const metadata: Metadata = { title: "项目 · Agentic Analog IC Schematic Editor" };

export default function ProjectsPage() {
  return <ProjectDashboard />;
}
