import { getAgentMedia, getD1 } from "@/db";
import { ensureDatabase } from "@/db/runtime";
import { getSessionUser, json, rejectCrossOriginWrite } from "@/lib/auth";

interface MediaRow {
  object_key: string;
  media_type: string;
  file_name: string;
  sha256: string;
  message_id?: string | null;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const user = await getSessionUser(request);
  if (!user) return json({ error: "请先登录" }, { status: 401 });
  const { id: projectId, attachmentId } = await context.params;
  await ensureDatabase();
  const row = await getD1().prepare(`SELECT object_key, media_type, file_name, sha256 FROM agent_attachments
    WHERE id = ? AND project_id = ? AND owner_id = ?`)
    .bind(attachmentId, projectId, user.id)
    .first<MediaRow>();
  if (!row) return json({ error: "附件不存在" }, { status: 404 });
  const object = await getAgentMedia().get(row.object_key);
  if (!object) return json({ error: "图片工件缺失" }, { status: 410 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-type", row.media_type);
  headers.set("cache-control", "private, max-age=3600");
  headers.set("etag", `\"${row.sha256}\"`);
  headers.set("content-disposition", `${row.media_type.startsWith("image/") ? "inline" : "attachment"}; filename=\"${row.file_name}\"`);
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-security-policy", "default-src 'none'; sandbox");
  return new Response(object.body, { headers });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return crossOrigin;
  const user = await getSessionUser(request);
  if (!user) return json({ error: "请先登录" }, { status: 401 });
  const { id: projectId, attachmentId } = await context.params;
  await ensureDatabase();
  const row = await getD1().prepare(`SELECT object_key, media_type, file_name, sha256, message_id FROM agent_attachments
    WHERE id = ? AND project_id = ? AND owner_id = ?`)
    .bind(attachmentId, projectId, user.id)
    .first<MediaRow>();
  if (!row) return json({ error: "附件不存在" }, { status: 404 });
  if (row.message_id) return json({ error: "已进入历史的图片不能单独删除" }, { status: 409 });
  await getAgentMedia().delete(row.object_key);
  await getD1().prepare("DELETE FROM agent_attachments WHERE id = ? AND project_id = ? AND owner_id = ? AND message_id IS NULL")
    .bind(attachmentId, projectId, user.id)
    .run();
  return new Response(null, { status: 204 });
}
