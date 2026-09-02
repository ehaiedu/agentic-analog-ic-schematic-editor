import { getAgentMedia, getD1 } from "@/db";
import { ensureDatabase } from "@/db/runtime";
import { getSessionUser, json, rejectCrossOriginWrite } from "@/lib/auth";
import { ownedConversation, publicAttachment, type AgentAttachmentRow } from "@/lib/agentHistory.server";

const MEDIA_TYPES = new Set([
  "image/png", "image/jpeg", "image/webp",
  "text/plain", "text/markdown", "text/csv", "text/x-python", "text/x-scss",
  "application/json", "application/pdf",
]);
const EXTENSION_TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  txt: "text/plain", md: "text/markdown", csv: "text/csv", py: "text/x-python",
  json: "application/json", yaml: "text/plain", yml: "text/plain", pdf: "application/pdf",
  sp: "text/plain", scs: "text/plain", cir: "text/plain", cdl: "text/plain", va: "text/plain",
  vams: "text/plain", il: "text/plain", skill: "text/plain",
};
const MAX_IMAGE_BYTES = 5_000_000;
const MAX_FILE_BYTES = 20_000_000;

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 120) || "image";
}

function mediaTypeForFile(file: File): string {
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  if (file.type === "application/octet-stream") return EXTENSION_TYPES[extension] ?? "";
  if (MEDIA_TYPES.has(file.type)) return file.type;
  return EXTENSION_TYPES[extension] ?? "";
}

function isImageType(mediaType: string): boolean {
  return mediaType.startsWith("image/");
}

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
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "附件请求格式不正确" }, { status: 400 });
  }
  const file = form.get("file");
  const mediaType = file instanceof File ? mediaTypeForFile(file) : "";
  if (!(file instanceof File) || !mediaType || file.size <= 0 || file.size > MAX_FILE_BYTES || (isImageType(mediaType) && file.size > MAX_IMAGE_BYTES)) {
    return json({ error: "仅支持 20 MB 以内的 PDF、文本、Python、SPICE、JSON、CSV 或图片附件" }, { status: 400 });
  }
  const width = Math.max(0, Math.min(20_000, Number(form.get("width") ?? 0) || 0));
  const height = Math.max(0, Math.min(20_000, Number(form.get("height") ?? 0) || 0));
  const direction = form.get("direction") === "output" ? "output" : "input";
  const bytes = await file.arrayBuffer();
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  const attachmentId = crypto.randomUUID();
  const objectKey = `${user.id}/${projectId}/${conversationId}/${attachmentId}-${safeName(file.name)}`;
  await getAgentMedia().put(objectKey, bytes, {
    httpMetadata: { contentType: file.type, cacheControl: "private, max-age=3600" },
    customMetadata: { sha256, ownerId: user.id, projectId, conversationId },
  });
  const now = Date.now();
  await ensureDatabase();
  try {
    await getD1().prepare(`INSERT INTO agent_attachments
      (id, conversation_id, message_id, project_id, owner_id, direction, object_key, file_name,
       media_type, size_bytes, width, height, sha256, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(attachmentId, conversationId, projectId, user.id, direction, objectKey, safeName(file.name),
        mediaType, file.size, width, height, sha256, now)
      .run();
  } catch (error) {
    await getAgentMedia().delete(objectKey);
    throw error;
  }
  const row: AgentAttachmentRow = {
    id: attachmentId,
    conversation_id: conversationId,
    message_id: null,
    direction,
    file_name: safeName(file.name),
    media_type: mediaType,
    size_bytes: file.size,
    width,
    height,
    sha256,
    created_at: now,
  };
  return json({ attachment: publicAttachment(row, projectId) }, { status: 201 });
}
