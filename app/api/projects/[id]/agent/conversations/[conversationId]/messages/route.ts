import { getD1 } from "@/db";
import { ensureDatabase } from "@/db/runtime";
import { getSessionUser, json, rejectCrossOriginWrite } from "@/lib/auth";
import { ownedConversation, type AgentMessageStatus } from "@/lib/agentHistory.server";

const ROLES = new Set(["user", "assistant"]);
const STATUSES = new Set<AgentMessageStatus>(["info", "proposed", "approved", "running", "passed", "failed"]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; conversationId: string }> },
) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return crossOrigin;
  const user = await getSessionUser(request);
  if (!user) return json({ error: "请先登录" }, { status: 401 });
  const { id: projectId, conversationId } = await context.params;
  if (!await ownedConversation(projectId, conversationId, user.id)) return json({ error: "会话不存在" }, { status: 404 });
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: "请求格式不正确" }, { status: 400 });
  }
  const role = typeof body.role === "string" && ROLES.has(body.role) ? body.role : "";
  const status = typeof body.status === "string" && STATUSES.has(body.status as AgentMessageStatus)
    ? body.status as AgentMessageStatus
    : "info";
  const messageText = typeof body.text === "string" ? body.text : "";
  const code = typeof body.code === "string" ? body.code : "";
  const kind = typeof body.kind === "string" ? body.kind.slice(0, 80) : "";
  const title = typeof body.title === "string" ? body.title.slice(0, 120) : "";
  const evidenceLevel = typeof body.evidenceLevel === "string" ? body.evidenceLevel.slice(0, 80) : "";
  const modelId = typeof body.modelId === "string" ? body.modelId.slice(0, 160) : "";
  if (!role || messageText.length > 200_000 || code.length > 1_000_000) {
    return json({ error: "消息角色或内容无效" }, { status: 400 });
  }
  const metrics = body.metrics && typeof body.metrics === "object" && !Array.isArray(body.metrics) ? body.metrics : {};
  const metricsJson = JSON.stringify(metrics);
  if (metricsJson.length > 200_000) return json({ error: "指标内容过大" }, { status: 413 });
  const attachmentIds = Array.isArray(body.attachmentIds)
    ? [...new Set(body.attachmentIds.filter((value): value is string => typeof value === "string"))].slice(0, 8)
    : [];
  await ensureDatabase();
  if (attachmentIds.length) {
    const placeholders = attachmentIds.map(() => "?").join(",");
    const found = await getD1().prepare(`SELECT id FROM agent_attachments WHERE id IN (${placeholders})
      AND conversation_id = ? AND project_id = ? AND owner_id = ? AND message_id IS NULL`)
      .bind(...attachmentIds, conversationId, projectId, user.id)
      .all<{ id: string }>();
    if (found.results.length !== attachmentIds.length) return json({ error: "附件不存在或已绑定" }, { status: 409 });
  }
  const latest = await getD1().prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM agent_messages WHERE conversation_id = ?")
    .bind(conversationId)
    .first<{ sequence: number }>();
  const sequence = Number(latest?.sequence ?? 0) + 1;
  const messageId = typeof body.id === "string" && /^[A-Za-z0-9_.:-]{1,160}$/u.test(body.id)
    ? body.id
    : crypto.randomUUID();
  const now = Date.now();
  const derivedTitle = sequence === 1 && role === "user"
    ? messageText.trim().replace(/\s+/g, " ").slice(0, 40)
    : "";
  const statements = [
    getD1().prepare(`INSERT INTO agent_messages
      (id, conversation_id, project_id, owner_id, sequence, role, kind, status, title, text, code,
       metrics_json, evidence_level, model_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(messageId, conversationId, projectId, user.id, sequence, role, kind, status, title, messageText, code,
        metricsJson, evidenceLevel, modelId, now),
    derivedTitle
      ? getD1().prepare("UPDATE agent_conversations SET updated_at = ?, title = ? WHERE id = ? AND owner_id = ?")
        .bind(now, derivedTitle, conversationId, user.id)
      : getD1().prepare("UPDATE agent_conversations SET updated_at = ? WHERE id = ? AND owner_id = ?")
        .bind(now, conversationId, user.id),
  ];
  attachmentIds.forEach((attachmentId) => statements.push(
    getD1().prepare("UPDATE agent_attachments SET message_id = ? WHERE id = ? AND message_id IS NULL AND owner_id = ?")
      .bind(messageId, attachmentId, user.id),
  ));
  try {
    await getD1().batch(statements);
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) return json({ error: "消息顺序冲突，请重试" }, { status: 409 });
    throw error;
  }
  return json({ message: { id: messageId, sequence, createdAt: now, title: derivedTitle || undefined } }, { status: 201 });
}
