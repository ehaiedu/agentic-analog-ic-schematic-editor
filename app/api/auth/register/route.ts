import { getD1 } from "@/db";
import { ensureDatabase } from "@/db/runtime";
import { createDemoDocument } from "@/lib/schematic";
import {
  createSession,
  json,
  normalizeUsername,
  passwordRecord,
  rejectCrossOriginWrite,
  validateCredentials,
} from "@/lib/auth";
import { isDevelopmentAccountUsername } from "@/lib/developmentAccount";

export async function POST(request: Request) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return crossOrigin;
  let body: { username?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式不正确" }, { status: 400 });
  }

  const error = validateCredentials(body.username, body.password);
  if (error) return json({ error }, { status: 400 });

  const username = (body.username as string).trim();
  const normalizedUsername = normalizeUsername(username);
  if (isDevelopmentAccountUsername(normalizedUsername)) {
    return json({ error: "这个用户名不可用" }, { status: 409 });
  }
  const password = body.password as string;
  await ensureDatabase();
  const db = getD1();

  const duplicate = await db.prepare("SELECT id FROM users WHERE normalized_username = ?")
    .bind(normalizedUsername)
    .first<{ id: string }>();
  if (duplicate) return json({ error: "这个用户名已经被注册" }, { status: 409 });

  const userId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const now = Date.now();
  const passwordData = await passwordRecord(password);
  const starterName = "CMOS 反相器示例";
  const starter = { ...createDemoDocument(), project: starterName };

  try {
    await db.batch([
      db.prepare(`INSERT INTO users
        (id, username, normalized_username, password_hash, password_salt, password_iterations, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          userId,
          username,
          normalizedUsername,
          passwordData.hash,
          passwordData.salt,
          passwordData.iterations,
          now,
        ),
      db.prepare(`INSERT INTO projects
        (id, owner_id, name, description, document_json, revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(projectId, userId, starterName, "首次登录自动创建的可编辑示例", JSON.stringify(starter), 1, now, now),
    ]);
  } catch {
    return json({ error: "这个用户名已经被注册" }, { status: 409 });
  }

  const cookie = await createSession(request, userId);
  return json(
    { user: { id: userId, username, createdAt: now }, starterProjectId: projectId },
    { status: 201, headers: { "set-cookie": cookie } },
  );
}
