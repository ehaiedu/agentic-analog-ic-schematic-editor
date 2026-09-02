import { getD1 } from "@/db";
import { ensureDatabase } from "@/db/runtime";
import { getSessionUser, json, rejectCrossOriginWrite } from "@/lib/auth";
import { ownedProject, type AgentConversationRow } from "@/lib/agentHistory.server";
import { normalizeAgentModelRoute } from "@/lib/agentModels";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(request);
  if (!user) return json({ error: "请先登录" }, { status: 401 });
  const { id: projectId } = await context.params;
  if (!await ownedProject(projectId, user.id)) return json({ error: "项目不存在" }, { status: 404 });
  const result = await getD1().prepare(`SELECT id, project_id, owner_id, title, active_family, model_route, created_at, updated_at
    FROM agent_conversations WHERE project_id = ? AND owner_id = ? ORDER BY updated_at DESC, created_at DESC`)
    .bind(projectId, user.id)
    .all<AgentConversationRow>();
  return json({ conversations: result.results.map((row) => ({
    id: row.id,
    title: row.title,
    activeFamily: row.active_family,
    modelRoute: normalizeAgentModelRoute(row.model_route) ?? "auto",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })) });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return crossOrigin;
  const user = await getSessionUser(request);
  if (!user) return json({ error: "请先登录" }, { status: 401 });
  const { id: projectId } = await context.params;
  if (!await ownedProject(projectId, user.id)) return json({ error: "项目不存在" }, { status: 404 });
  let body: { title?: unknown; activeFamily?: unknown; modelRoute?: unknown } = {};
  try {
    body = await request.json() as typeof body;
  } catch {
    // Empty JSON is equivalent to a default new conversation.
  }
  const title = typeof body.title === "string" ? body.title.trim() : "新对话";
  const family = typeof body.activeFamily === "string" && ["", "comparator", "opamp"].includes(body.activeFamily)
    ? body.activeFamily
    : "";
  const modelRoute = normalizeAgentModelRoute(body.modelRoute) ?? "auto";
  if (!title || title.length > 80) return json({ error: "会话标题需为 1–80 个字符" }, { status: 400 });
  const now = Date.now();
  const conversationId = crypto.randomUUID();
  await ensureDatabase();
  await getD1().prepare(`INSERT INTO agent_conversations
    (id, project_id, owner_id, title, active_family, model_route, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(conversationId, projectId, user.id, title, family, modelRoute, now, now)
    .run();
  return json({ conversation: { id: conversationId, title, activeFamily: family, modelRoute, createdAt: now, updatedAt: now } }, { status: 201 });
}
