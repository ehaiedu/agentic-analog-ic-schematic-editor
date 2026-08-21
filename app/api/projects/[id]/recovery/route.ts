import { getD1 } from "@/db";
import { ensureDatabase } from "@/db/runtime";
import { getSessionUser, json, rejectCrossOriginWrite } from "@/lib/auth";
import { serializeSchematic } from "@/lib/persistence";
import { parseSchematicDocument } from "@/lib/schematicValidation";

async function ownsProject(projectId: string, ownerId: string): Promise<boolean> {
  await ensureDatabase();
  const row = await getD1().prepare("SELECT id FROM projects WHERE id = ? AND owner_id = ?")
    .bind(projectId, ownerId)
    .first<{ id: string }>();
  return Boolean(row);
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(request);
  if (!user) return json({ error: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  if (!await ownsProject(id, user.id)) return json({ error: "项目不存在" }, { status: 404 });
  const row = await getD1().prepare(`SELECT document_json, base_storage_revision, design_revision, created_at
    FROM project_recovery WHERE project_id = ? AND owner_id = ?`)
    .bind(id, user.id)
    .first<{
      document_json: string;
      base_storage_revision: number;
      design_revision: number;
      created_at: number;
    }>();
  if (!row) return json({ recovery: null });
  try {
    return json({
      recovery: {
        document: parseSchematicDocument(JSON.parse(row.document_json)),
        baseStorageRevision: row.base_storage_revision,
        designRevision: row.design_revision,
        createdAt: row.created_at,
      },
    });
  } catch {
    return json({ error: "自动恢复数据已损坏" }, { status: 422 });
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return crossOrigin;
  const user = await getSessionUser(request);
  if (!user) return json({ error: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  if (!await ownsProject(id, user.id)) return json({ error: "项目不存在" }, { status: 404 });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 5_000_000) {
    return json({ error: "恢复数据超过 5 MB 限制" }, { status: 413 });
  }
  let body: { document?: unknown; baseStorageRevision?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式不正确" }, { status: 400 });
  }
  if (!Number.isInteger(body.baseStorageRevision) || (body.baseStorageRevision as number) < 1) {
    return json({ error: "缺少有效的正式项目版本号" }, { status: 400 });
  }
  let document;
  try {
    document = parseSchematicDocument(body.document);
  } catch {
    return json({ error: "原理图恢复数据格式不正确" }, { status: 400 });
  }
  const documentJson = serializeSchematic(document);
  if (documentJson.length > 5_000_000) return json({ error: "恢复数据超过 5 MB 限制" }, { status: 413 });
  const createdAt = Date.now();
  await getD1().prepare(`INSERT INTO project_recovery
    (project_id, owner_id, document_json, base_storage_revision, design_revision, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      owner_id = excluded.owner_id,
      document_json = excluded.document_json,
      base_storage_revision = excluded.base_storage_revision,
      design_revision = excluded.design_revision,
      created_at = excluded.created_at`)
    .bind(
      id,
      user.id,
      documentJson,
      body.baseStorageRevision as number,
      document.revisions.designRevision,
      createdAt,
    )
    .run();
  return json({ recovery: { designRevision: document.revisions.designRevision, createdAt } });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return crossOrigin;
  const user = await getSessionUser(request);
  if (!user) return json({ error: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  await ensureDatabase();
  await getD1().prepare("DELETE FROM project_recovery WHERE project_id = ? AND owner_id = ?")
    .bind(id, user.id)
    .run();
  return new Response(null, { status: 204 });
}
