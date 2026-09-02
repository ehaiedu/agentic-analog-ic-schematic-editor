import { getD1 } from "@/db";
import { ensureDatabase } from "@/db/runtime";

export type AgentMessageStatus = "info" | "proposed" | "approved" | "running" | "passed" | "failed";

export interface AgentConversationRow {
  id: string;
  project_id: string;
  owner_id: string;
  title: string;
  active_family: string;
  model_route: string;
  created_at: number;
  updated_at: number;
}

export interface AgentMessageRow {
  id: string;
  conversation_id: string;
  sequence: number;
  role: string;
  kind: string;
  status: AgentMessageStatus;
  title: string;
  text: string;
  code: string;
  metrics_json: string;
  evidence_level: string;
  model_id: string;
  created_at: number;
}

export interface AgentAttachmentRow {
  id: string;
  conversation_id: string;
  message_id: string | null;
  direction: "input" | "output";
  file_name: string;
  media_type: string;
  size_bytes: number;
  width: number;
  height: number;
  sha256: string;
  created_at: number;
}

export async function ownedProject(projectId: string, ownerId: string): Promise<boolean> {
  await ensureDatabase();
  const row = await getD1().prepare("SELECT id FROM projects WHERE id = ? AND owner_id = ?")
    .bind(projectId, ownerId)
    .first<{ id: string }>();
  return Boolean(row);
}

export async function ownedConversation(
  projectId: string,
  conversationId: string,
  ownerId: string,
): Promise<AgentConversationRow | null> {
  await ensureDatabase();
  return getD1().prepare(`SELECT id, project_id, owner_id, title, active_family, model_route, created_at, updated_at
    FROM agent_conversations WHERE id = ? AND project_id = ? AND owner_id = ?`)
    .bind(conversationId, projectId, ownerId)
    .first<AgentConversationRow>();
}

export function publicAttachment(row: AgentAttachmentRow, projectId: string) {
  return {
    id: row.id,
    direction: row.direction,
    name: row.file_name,
    mediaType: row.media_type,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    sha256: row.sha256,
    createdAt: row.created_at,
    url: `/api/projects/${encodeURIComponent(projectId)}/agent/media/${encodeURIComponent(row.id)}`,
  };
}

export function parseMetrics(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}
