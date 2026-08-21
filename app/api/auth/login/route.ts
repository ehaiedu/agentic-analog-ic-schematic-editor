import { getD1 } from "@/db";
import { ensureDatabase } from "@/db/runtime";
import {
  createSession,
  derivePasswordHash,
  equalPasswordHash,
  json,
  normalizeUsername,
  rejectCrossOriginWrite,
  validateCredentials,
} from "@/lib/auth";
import { ensureDevelopmentAccount } from "@/lib/developmentAccount.server";
import { isDevelopmentAccountUsername } from "@/lib/developmentAccount";
import { getDevelopmentAccountCredentials } from "@/lib/developmentAccountGate.server";

type LoginRow = {
  id: string;
  username: string;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  created_at: number;
};

export async function POST(request: Request) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return crossOrigin;
  let body: { username?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式不正确" }, { status: 400 });
  }

  const validationError = validateCredentials(body.username, body.password);
  if (validationError) return json({ error: "用户名或密码不正确" }, { status: 401 });

  const normalizedUsername = normalizeUsername(body.username as string);
  const developmentCredentials = getDevelopmentAccountCredentials(request);
  let row: LoginRow | null;
  if (isDevelopmentAccountUsername(normalizedUsername)) {
    if (!developmentCredentials || body.password !== developmentCredentials.password) {
      return json({ error: "用户名或密码不正确" }, { status: 401 });
    }
    row = await ensureDevelopmentAccount(developmentCredentials);
  } else {
    await ensureDatabase();
    row = await getD1().prepare(`SELECT id, username, password_hash, password_salt,
        password_iterations, created_at
      FROM users WHERE normalized_username = ?`)
      .bind(normalizedUsername)
      .first<LoginRow>();
  }
  if (!row) return json({ error: "用户名或密码不正确" }, { status: 401 });

  const candidate = await derivePasswordHash(
    body.password as string,
    row.password_salt,
    row.password_iterations,
  );
  if (!equalPasswordHash(candidate, row.password_hash)) return json({ error: "用户名或密码不正确" }, { status: 401 });

  const cookie = await createSession(request, row.id);
  return json(
    { user: { id: row.id, username: row.username, createdAt: row.created_at } },
    { headers: { "set-cookie": cookie } },
  );
}
