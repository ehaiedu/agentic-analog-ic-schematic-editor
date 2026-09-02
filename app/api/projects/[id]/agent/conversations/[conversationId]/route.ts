import { getD1 } from "@/db";
import { getSessionUser, json, rejectCrossOriginWrite } from "@/lib/auth";
import {
  ownedConversation,
  parseMetrics,
  publicAttachment,
  type AgentAttachmentRow,
  type AgentMessageRow,
} from "@/lib/agentHistory.server";
import { normalizeAgentModelRoute } from "@/lib/agentModels";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; conversationId: string }> },
) {
  const user = await getSessionUser(request);
  if (!user) return json({ error: "请先登录" }, { status: 401 });
  const { id: projectId, conversationId } = await context.params;
  const conversation = await ownedConversation(projectId, conversationId, user.id);
  if (!conversation) return json({ error: "会话不存在" }, { status: 404 });
  const [messageResult, attachmentResult] = await Promise.all([
    getD1().prepare(`SELECT id, conversation_id, sequence, role, kind, status, title, text, code,
      metrics_json, evidence_level, model_id, created_at FROM agent_messages
      WHERE conversation_id = ? AND project_id = ? AND owner_id = ? ORDER BY sequence`)
      .bind(conversationId, projectId, user.id)
      .all<AgentMessageRow>(),
    getD1().prepare(`SELECT id, conversation_id, message_id, direction, file_name, media_type, size_bytes,
      width, height, sha256, created_at FROM agent_attachments
      WHERE conversation_id = ? AND project_id = ? AND owner_id = ? ORDER BY created_at, id`)
      .bind(conversationId, projectId, user.id)
      .all<AgentAttachmentRow>(),
  ]);
  const attachmentsByMessage = new Map<string, ReturnType<typeof publicAttachment>[]>();
  attachmentResult.results.forEach((row) => {
    if (!row.message_id) return;
    const items = attachmentsByMessage.get(row.message_id) ?? [];
    items.push(publicAttachment(row, projectId));
    attachmentsByMessage.set(row.message_id, items);
  });
  return json({
    conversation: {
      id: conversation.id,
      title: conversation.title,
      activeFamily: conversation.active_family,
      modelRoute: normalizeAgentModelRoute(conversation.model_route) ?? "auto",
      createdAt: conversation.created_at,
      updatedAt: conversation.updated_at,
    },
    messages: messageResult.results.map((row) => ({
      id: row.id,
      sequence: row.sequence,
      role: row.role,
      kind: row.kind,
      status: row.status,
      title: row.title,
      text: row.text,
      code: row.code || undefined,
      metrics: parseMetrics(row.metrics_json),
      evidenceLevel: row.evidence_level || undefined,
      modelId: row.model_id || undefined,
      createdAt: row.created_at,
      attachments: attachmentsByMessage.get(row.id) ?? [],
    })),
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; conversationId: string }> },
) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return crossOrigin;
  const user = await getSessionUser(request);
  if (!user) return json({ error: "请先登录" }, { status: 401 });
  const { id: projectId, conversationId } = await context.params;
  if (!await ownedConversation(projectId, conversationId, user.id)) return json({ error: "会话不存在" }, { status: 404 });
  let body: { title?: unknown; activeFamily?: unknown; modelRoute?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return json({ error: "请求格式不正确" }, { status: 400 });
  }
  const title = typeof body.title === "string" ? body.title.trim() : undefined;
  const family = typeof body.activeFamily === "string" ? body.activeFamily : undefined;
  const modelRoute = body.modelRoute === undefined ? undefined : normalizeAgentModelRoute(body.modelRoute);
  if (title !== undefined && (!title || title.length > 80)) return json({ error: "会话标题无效" }, { status: 400 });
  if (family !== undefined && !["", "comparator", "opamp"].includes(family)) return json({ error: "电路家族无效" }, { status: 400 });
  if (body.modelRoute !== undefined && !modelRoute) return json({ error: "模型路由无效" }, { status: 400 });
  if (title === undefined && family === undefined && modelRoute === undefined) return json({ error: "没有可更新字段" }, { status: 400 });
  const now = Date.now();
  await getD1().prepare(`UPDATE agent_conversations SET
    title = COALESCE(?, title), active_family = COALESCE(?, active_family), model_route = COALESCE(?, model_route), updated_at = ?
    WHERE id = ? AND project_id = ? AND owner_id = ?`)
    .bind(title ?? null, family ?? null, modelRoute ?? null, now, conversationId, projectId, user.id)
    .run();
  return json({ conversation: { id: conversationId, title, activeFamily: family, modelRoute, updatedAt: now } });
}
