import { getD1 } from "@/db";
import { ensureDatabase } from "@/db/runtime";
import { getSessionUser, json, rejectCrossOriginWrite } from "@/lib/auth";
import { parseSchematicDocument } from "@/lib/schematicValidation";
import { serializeSchematic } from "@/lib/persistence";

type ProjectRow = {
  id: string;
  name: string;
  description: string;
  document_json: string;
  revision: number;
  created_at: number;
  updated_at: number;
};

async function ownedProject(id: string, ownerId: string): Promise<ProjectRow | null> {
  await ensureDatabase();
  return getD1().prepare(`SELECT id, name, description, document_json, revision, created_at, updated_at
    FROM projects WHERE id = ? AND owner_id = ?`)
    .bind(id, ownerId)
    .first<ProjectRow>();
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(request);
  if (!user) return json({ error: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  const row = await ownedProject(id, user.id);
  if (!row) return json({ error: "项目不存在" }, { status: 404 });

  try {
    return json({
      project: {
        id: row.id,
        name: row.name,
        description: row.description,
        document: parseSchematicDocument(JSON.parse(row.document_json)),
        revision: row.revision,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch {
    return json({ error: "项目数据已损坏，无法打开" }, { status: 422 });
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return crossOrigin;
  const user = await getSessionUser(request);
  if (!user) return json({ error: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  const row = await ownedProject(id, user.id);
  if (!row) return json({ error: "项目不存在" }, { status: 404 });

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 5_000_000) {
    return json({ error: "项目数据超过 5 MB 限制" }, { status: 413 });
  }

  let body: { name?: unknown; description?: unknown; document?: unknown; revision?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式不正确" }, { status: 400 });
  }

  if (!Number.isInteger(body.revision) || (body.revision as number) < 1) {
    return json({ error: "缺少有效的项目版本号，请刷新后重试" }, { status: 400 });
  }
  const expectedRevision = body.revision as number;

  const name = body.name === undefined ? row.name : typeof body.name === "string" ? body.name.trim() : "";
  const description = body.description === undefined
    ? row.description
    : typeof body.description === "string" ? body.description.trim() : "";
  if (!name || name.length > 80) return json({ error: "项目名称需为 1–80 个字符" }, { status: 400 });
  if (description.length > 240) return json({ error: "项目说明不能超过 240 个字符" }, { status: 400 });

  let documentJson = row.document_json;
  if (body.document !== undefined) {
    try {
      const document = parseSchematicDocument(body.document);
      documentJson = serializeSchematic({ ...document, project: name });
      if (documentJson.length > 5_000_000) {
        return json({ error: "项目数据超过 5 MB 限制" }, { status: 413 });
      }
    } catch {
      return json({ error: "原理图数据格式不正确" }, { status: 400 });
    }
  } else if (name !== row.name) {
    try {
      const document = parseSchematicDocument(JSON.parse(row.document_json));
      documentJson = serializeSchematic({ ...document, project: name });
    } catch {
      return json({ error: "项目数据已损坏，无法重命名" }, { status: 422 });
    }
  }

  const updatedAt = Date.now();
  const result = await getD1().prepare(`UPDATE projects
    SET name = ?, description = ?, document_json = ?, revision = revision + 1, updated_at = ?
    WHERE id = ? AND owner_id = ? AND revision = ?`)
    .bind(name, description, documentJson, updatedAt, id, user.id, expectedRevision)
    .run();
  if (!result.meta.changes) {
    return json({ error: "项目已在其他页面发生修改，请刷新后重试", code: "revision_conflict" }, { status: 409 });
  }
  return json({ project: { id, name, description, revision: expectedRevision + 1, updatedAt } });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return crossOrigin;
  const user = await getSessionUser(request);
  if (!user) return json({ error: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  await ensureDatabase();
  const result = await getD1().prepare("DELETE FROM projects WHERE id = ? AND owner_id = ?")
    .bind(id, user.id)
    .run();
  if (!result.meta.changes) return json({ error: "项目不存在" }, { status: 404 });
  return new Response(null, { status: 204 });
}
