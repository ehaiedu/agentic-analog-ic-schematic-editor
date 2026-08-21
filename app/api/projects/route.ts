import { getD1 } from "@/db";
import { ensureDatabase } from "@/db/runtime";
import { getSessionUser, json, rejectCrossOriginWrite } from "@/lib/auth";
import { createEmptyDocument, type SchematicDocument } from "@/lib/schematic";
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

function projectSummary(row: ProjectRow) {
  let document: SchematicDocument | null = null;
  try {
    document = parseSchematicDocument(JSON.parse(row.document_json));
  } catch {
    // Keep a corrupt project visible so the owner can rename or remove it.
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    nodeCount: document?.nodes.length ?? 0,
    edgeCount: document?.edges.length ?? 0,
    cell: document?.cell ?? "top",
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return json({ error: "请先登录" }, { status: 401 });
  await ensureDatabase();
  const result = await getD1().prepare(`SELECT id, name, description, document_json, revision, created_at, updated_at
    FROM projects WHERE owner_id = ? ORDER BY updated_at DESC`)
    .bind(user.id)
    .all<ProjectRow>();
  return json({ projects: result.results.map(projectSummary) });
}

export async function POST(request: Request) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return crossOrigin;
  const user = await getSessionUser(request);
  if (!user) return json({ error: "请先登录" }, { status: 401 });

  let body: { name?: unknown; description?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式不正确" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!name || name.length > 80) return json({ error: "项目名称需为 1–80 个字符" }, { status: 400 });
  if (description.length > 240) return json({ error: "项目说明不能超过 240 个字符" }, { status: 400 });

  const id = crypto.randomUUID();
  const now = Date.now();
  const document = createEmptyDocument(name, "top");
  const documentJson = serializeSchematic(document);
  await ensureDatabase();
  await getD1().prepare(`INSERT INTO projects
    (id, owner_id, name, description, document_json, revision, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, user.id, name, description, documentJson, 1, now, now)
    .run();
  return json({ project: projectSummary({
    id,
    name,
    description,
    document_json: documentJson,
    revision: 1,
    created_at: now,
    updated_at: now,
  }) }, { status: 201 });
}
