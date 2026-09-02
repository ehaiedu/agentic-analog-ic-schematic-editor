import type { Metadata } from "next";
import { ProjectDashboard } from "../../components/ProjectDashboard";

export const metadata: Metadata = { title: "项目 · Analog Studio" };

export default function ProjectsPage() {
  return <ProjectDashboard />;
}
